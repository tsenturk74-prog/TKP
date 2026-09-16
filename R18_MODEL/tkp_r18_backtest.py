#!/usr/bin/env python3
from __future__ import annotations
import argparse, gzip, json, math, struct
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from tkp_r18_features import build_training_rows, canonicalize_collections
from tkp_r18_model import R18ModelStack, _market_prob
from tkp_r18_probability import ProbabilityCalibrator, monte_carlo_races
from tkp_r18_coupon import optimize_portfolio

MAGIC=b'TKPB'

def read_tkbz(path):
    with gzip.open(path,'rb') as f:
        if f.read(4)!=MAGIC: raise ValueError('TKPB magic bulunamadı')
        version=struct.unpack('>I',f.read(4))[0]; env_len=struct.unpack('>I',f.read(4))[0]; env=json.loads(f.read(env_len))
        cols={}
        for desc in env.get('collections',[]):
            rows=[]
            for _ in range(int(desc.get('chunks') or 0)):
                n=struct.unpack('>I',f.read(4))[0]; rows.extend(json.loads(f.read(n)))
            cols[str(desc.get('name'))]=rows
    return version,env,cols


def pre_race_provenance_check(races):
    total=0; frozen=0
    for r in races or []:
        for h in r.get('horses') or []:
            total+=1
            if h.get('prediction_visible_tkp_snapshot') is not None:
                frozen+=1
    coverage=(frozen/total) if total else 0.0
    return {'pass':bool(total and frozen==total),'total_horses':total,'frozen_champion_snapshot_horses':frozen,'coverage':coverage}

def summarize_coupon_records(records):
    rec=list(records or []); exact={str(i):0 for i in range(7)}; total_cost=0.0; singles=0; single_hits=0
    for r in rec:
        h=max(0,min(6,int(r.get('hits') or 0))); exact[str(h)]+=1
        total_cost+=float(r.get('cost') or 0); singles+=int(r.get('singles') or 0); single_hits+=int(r.get('single_hits') if r.get('single_hits') is not None else r.get('singleHit') or 0)
    return {'meetings':len(rec),'exact':exact,'avg_cost':(total_cost/len(rec) if rec else 0.0),'total_cost':total_cost,
            'single_hit_rate':(single_hits/singles if singles else 0.0),'singles':singles,'single_hits':single_hits}

def summarize_portfolio_records(records_by_family):
    families=('normal','surprise','expert')
    maps={f:{str(r.get('meeting_uid') or ''):r for r in (records_by_family.get(f) or [])} for f in families}
    common=set(maps['normal']) & set(maps['surprise']) & set(maps['expert'])
    any6=0; any5=0
    for uid in common:
        hits=[int((maps[f][uid] or {}).get('hits') or 0) for f in families]
        any6+=int(max(hits)>=6)
        any5+=int(max(hits)>=5)
    n=len(common)
    return {'meetings':n,'any_coupon_6of6':any6,'any_coupon_6of6_rate':(any6/n if n else 0.0),
            'any_coupon_5plus':any5,'any_coupon_5plus_rate':(any5/n if n else 0.0)}

def aligned_portfolio_summary(challenger_records, champion_records):
    families=('normal','surprise','expert')
    cmaps={f:{str(r.get('meeting_uid') or ''):r for r in (challenger_records.get(f) or [])} for f in families}
    bmaps={f:{str(r.get('meeting_uid') or ''):r for r in (champion_records.get(f) or [])} for f in families}
    common=set.intersection(*(set(cmaps[f]) for f in families),*(set(bmaps[f]) for f in families)) if families else set()
    c={f:[cmaps[f][u] for u in common] for f in families}
    b={f:[bmaps[f][u] for u in common] for f in families}
    return summarize_portfolio_records(c), summarize_portfolio_records(b)

def coupon_promotion_gate(challenger,champion):
    c6=int(challenger.get('exact',{}).get('6',0)); b6=int(champion.get('exact',{}).get('6',0)); c5=int(challenger.get('exact',{}).get('5',0)); b5=int(champion.get('exact',{}).get('5',0))
    material=(c6>=math.ceil(b6*1.05)) if b6>0 else c6>b6
    efficient=(c6==b6 and c5>=b5 and float(challenger.get('avg_cost',1e9))<=float(champion.get('avg_cost',1e9)))
    single_ok=float(challenger.get('single_hit_rate',0))>=float(champion.get('single_hit_rate',0))-0.02
    passed=bool(c6>=b6 and single_ok and (material or efficient))
    return {'pass':passed,'material_6of6_gain':material,'equal_but_more_efficient':efficient,'single_ok':single_ok,'challenger_6of6':c6,'champion_6of6':b6}

def _valid_training_frame(races):
    eligible=[r for r in (races or []) if r.get('result_verified_for_training',True)]
    df=build_training_rows(eligible)
    if df.empty: return df
    valid_races=set(df.groupby('race_key')['winner'].sum().loc[lambda x:x==1].index)
    # Training is race-level: incomplete meetings still provide valid, leakage-safe
    # labeled races. The six-leg requirement belongs only to coupon evaluation.
    return df[df.race_key.isin(valid_races)].copy()

def temporal_meeting_split(df,train_fraction=.70,val_fraction=.15):
    meetings=df[['meeting_uid','race_date']].drop_duplicates().sort_values(['race_date','meeting_uid']).reset_index(drop=True)
    n=len(meetings); a=max(1,int(n*train_fraction)); b=max(a+1,int(n*(train_fraction+val_fraction))); b=min(b,n-1)
    tr=set(meetings.iloc[:a].meeting_uid); va=set(meetings.iloc[a:b].meeting_uid); ho=set(meetings.iloc[b:].meeting_uid)
    return df[df.meeting_uid.isin(tr)].copy(),df[df.meeting_uid.isin(va)].copy(),df[df.meeting_uid.isin(ho)].copy()

def probability_metrics(df,p_col):
    if df.empty: return {'races':0,'top1_hit':0.0,'brier':None,'log_loss':None}
    y=df.winner.astype(int).to_numpy(); p=np.clip(pd.to_numeric(df[p_col],errors='coerce').fillna(0).to_numpy(float),1e-9,1-1e-9)
    top=df.loc[df.groupby('race_key')[p_col].idxmax()]
    return {'races':int(df.race_key.nunique()),'top1_hit':float(top.winner.mean()),'brier':float(np.mean((p-y)**2)),
            'log_loss':float(np.mean(-(y*np.log(p)+(1-y)*np.log(1-p))))}

def evaluate_candidate_coupons(scored,budget=1500):
    records={'normal':[],'surprise':[],'expert':[]}
    for meeting,g in scored.groupby('meeting_uid',sort=False):
        legs=g[['race_key','leg']].drop_duplicates()
        if len(legs)!=6 or set(pd.to_numeric(legs['leg'],errors='coerce').astype(int)) != set(range(1,7)): continue
        try: port=optimize_portfolio(g,budget=budget)
        except Exception: continue
        winners={int(leg):str(x.iloc[0].horse_no_text) for leg,x in g[g.winner==1].groupby('leg') if len(x)==1}
        if len(winners)!=6: continue
        for family,c in port.items():
            hits=0; single_hits=0
            for leg in c['legs']:
                hit=winners.get(int(leg['leg'])) in set(map(str,leg['picks'])); hits+=int(hit)
                if len(leg['picks'])==1: single_hits+=int(hit)
            records[family].append({'meeting_uid':meeting,'hits':hits,'cost':c['cost'],'singles':c['singles'],'single_hits':single_hits,'signature':c['signature']})
    return {k:summarize_coupon_records(v) for k,v in records.items()},records

def align_coupon_records(challenger_records, champion_records):
    crows=list(challenger_records or []); brows=list(champion_records or [])
    common=set(str(r.get('meeting_uid') or '') for r in crows) & set(str(r.get('meeting_uid') or '') for r in brows)
    c=[r for r in crows if str(r.get('meeting_uid') or '') in common]
    b=[r for r in brows if str(r.get('meeting_uid') or '') in common]
    return summarize_coupon_records(c),summarize_coupon_records(b)

def load_champion_records(path,meeting_uids):
    if not path or not Path(path).exists(): return None
    data=json.loads(Path(path).read_text(encoding='utf-8-sig')); out=data.get('out') or {}; want=set(map(str,meeting_uids))
    mapping={'normal':'main','surprise':'alt','expert':'surprise'}; result={}
    for family,key in mapping.items():
        rows=[]
        for r in (out.get(key) or {}).get('records',[]):
            uid=str(r.get('meetingUid') or r.get('meeting_uid') or '')
            if uid not in want: continue
            rows.append({'meeting_uid':uid,'hits':int(r.get('hits') or 0),'cost':float(r.get('cost') or 0),'singles':int(r.get('singles') or 0),'single_hits':int(r.get('singleHit') or 0)})
        result[family]=rows
    return result

def load_champion_reference(path,meeting_uids):
    rows=load_champion_records(path,meeting_uids)
    if rows is None: return None
    return {family:summarize_coupon_records(records) for family,records in rows.items()}

def permutation_ablation(model,calibrator,hold,seed=41):
    baseline=calibrator.transform(model.predict(hold))
    base=probability_metrics(baseline,'calibrated_probability')['log_loss']; rng=np.random.default_rng(seed); out={}
    for fld in ['agf','tr_puan','ypuan','g800','recent_form','surface_fit','distance_fit','jockey_power','handicap_kg_score','champion_score']:
        x=hold.copy(); x[fld]=rng.permutation(x[fld].to_numpy())
        s=calibrator.transform(model.predict(x)); loss=probability_metrics(s,'calibrated_probability')['log_loss']
        out[fld]={'log_loss_delta':float(loss-base)}
    return out

def independent_signal_check(model,calibrator,hold):
    """R18.3 DÜZELTME (2026-09-14, harici denetim): 'champion_score' bileşeni
    blend'de en yüksek ağırlığı (wc, varsayılan 0.35) taşıyor ve kendi
    permutation_ablation() listesinden BİLEREK/YANLIŞLIKLA hariç tutulmuştu.
    Ablasyon sonucu champion_score'un TEK BAŞINA log_loss delta'sı (~0.045)
    diğer TÜM özelliklerin toplamından büyük çıktı; champion_score sıfırlanınca
    (hiç yokmuş gibi) model performansı SAF AGF piyasa taban çizgisiyle
    istatistiksel olarak ayırt edilemez hale geliyor. Yani "challenger
    champion'ı yeniyor" iddiası kısmen DÖNGÜSEL: challenger, champion'ın
    kendi skorunu girdi olarak zaten içeriyor. Bu fonksiyon champion_score
    olmadan modelin saf AGF piyasasından GERÇEKTEN ayrışıp ayrışmadığını
    ölçer; ayrışmıyorsa circularity_pass=False döner ve production_pass
    bu kontrolü de geçmeden asla true olamaz (bkz. coupon_promotion_gate
    çağrısı, run_backtest içinde production_pass hesaplaması)."""
    zeroed=hold.copy(); zeroed['champion_score']=0.0
    zero_scored=calibrator.transform(model.predict(zeroed))
    zero_metrics=probability_metrics(zero_scored,'calibrated_probability')
    market=_market_prob(hold.copy()); market_metrics=probability_metrics(market,'market_probability')
    # Payı: champion_score olmadan model, saf piyasa tabanını GERÇEKTEN
    # (gürültü payının ötesinde) geçmeli. Küçük örneklemde tesadüfi tek
    # yarışlık farklar production gate'i açmamalı.
    independent_gain=(zero_metrics['log_loss']<=market_metrics['log_loss']*0.90 and
                       zero_metrics['top1_hit']>=market_metrics['top1_hit']+0.10)
    return {'pass':bool(independent_gain),'zeroed_champion_metrics':zero_metrics,
            'market_baseline_metrics':market_metrics,
            'reason':('champion_score hariç bağımsız sinyal saf AGF tabanını aşıyor' if independent_gain
                       else 'champion_score sıfırlanınca performans saf AGF tabanından ayırt edilemiyor — döngüsellik riski')}

def run_backtest(tkbz,champion_json=None,budget=1500,simulations=10000,model_out=None,report_out=None,include_ablation=False):
    _,_,cols=read_tkbz(tkbz)
    races,audit=canonicalize_collections(cols)
    provenance=pre_race_provenance_check(races); df=_valid_training_frame(races); train,val,hold=temporal_meeting_split(df)
    model=R18ModelStack(min_expert_races=25,random_state=18).fit(train,val)
    val_scored=model.predict(val); calibrator=ProbabilityCalibrator().fit(val_scored)
    ablation={}
    if include_ablation:
        ablation=permutation_ablation(model,calibrator,hold)
    independent=independent_signal_check(model,calibrator,hold)
    hold_scored=calibrator.transform(model.predict(hold)); hold_scored=monte_carlo_races(hold_scored,simulations=simulations,seed=181)
    market=_market_prob(hold.copy()); market_metrics=probability_metrics(market,'market_probability'); challenger_metrics=probability_metrics(hold_scored,'calibrated_probability')
    candidate,records=evaluate_candidate_coupons(hold_scored,budget=budget)
    hold_meetings=hold[['meeting_uid']].drop_duplicates().meeting_uid.tolist(); champion_records=load_champion_records(champion_json,hold_meetings)
    champion=({family:summarize_coupon_records(rows) for family,rows in champion_records.items()} if champion_records else None)
    aligned_candidate={}; aligned_champion={}; gates={}
    calibration_pass=challenger_metrics['log_loss']<=market_metrics['log_loss'] and challenger_metrics['brier']<=market_metrics['brier']*1.02
    if champion_records:
        for family in ('normal','surprise','expert'):
            ca,ch=align_coupon_records(records.get(family,[]),champion_records.get(family,[])); aligned_candidate[family]=ca; aligned_champion[family]=ch
            g=coupon_promotion_gate(ca,ch); g['calibration_pass']=calibration_pass; g['circularity_pass']=independent['pass']
            g['pass']=bool(g['pass'] and calibration_pass); g['common_meetings']=ca['meetings']
            g['production_pass']=bool(g['pass'] and provenance.get('pass') and independent['pass']); gates[family]=g
    else:
        aligned_candidate=candidate; aligned_champion=champion or {}
        gates={f:{'pass':False,'production_pass':False,'reason':'Champion reference missing'} for f in ('normal','surprise','expert')}
    candidate_portfolio=summarize_portfolio_records(records)
    champion_portfolio=summarize_portfolio_records(champion_records) if champion_records else None
    if champion_records:
        aligned_candidate_portfolio,aligned_champion_portfolio=aligned_portfolio_summary(records,champion_records)
    else:
        aligned_candidate_portfolio,aligned_champion_portfolio=candidate_portfolio,None
    report={'schema':'TKP_R18_3_TRAINING_REPORT_V1','archive_files':len(cols.get('files',[])),'archive_races':len(races),
            'ingestion_audit':audit,
            'eligible_meetings':int(df.meeting_uid.nunique()),'train_meetings':int(train.meeting_uid.nunique()),'validation_meetings':int(val.meeting_uid.nunique()),'holdout_meetings':int(hold.meeting_uid.nunique()),
            'budget_ceiling':int(budget),'monte_carlo_simulations':int(simulations),'blend_weights':model.blend,
            'probability_metrics':{'challenger':challenger_metrics,'market_baseline':market_metrics},'candidate_coupons':candidate,'champion_coupons':champion,
            'aligned_candidate_coupons':aligned_candidate,'aligned_champion_coupons':aligned_champion,
            'portfolio_summary':{'candidate':candidate_portfolio,'champion':champion_portfolio,
                                 'aligned_candidate':aligned_candidate_portfolio,'aligned_champion':aligned_champion_portfolio},
            'promotion_gate':{'normal':gates['normal'],'surprise':gates['surprise'],'expert':gates['expert'],'production_pass':bool(any((gates[f] or {}).get('production_pass') for f in ('normal','surprise','expert'))),'provenance_pass':bool(provenance.get('pass')),'circularity_pass':independent['pass']},
            'provenance':provenance,'independent_signal_check':independent,'ablation':ablation,'holdout_meeting_uids':hold_meetings}
    if model_out:
        # Holdout remains untouched for an honest report. The persisted live
        # model, however, should learn from every historical race available
        # before that holdout rather than discarding the validation partition.
        production_training=pd.concat([train,val],ignore_index=True)
        production_model=R18ModelStack(min_expert_races=25,random_state=18).fit(production_training)
        production_report=dict(report)
        production_report['production_training_meetings']=int(production_training.meeting_uid.nunique())
        production_report['production_training_rows']=int(len(production_training))
        production_report['production_model_rule']='train_plus_validation; holdout remains evaluation-only'
        joblib.dump({'model':production_model,'calibrator':calibrator,'report':production_report},model_out)
    if report_out:
        Path(report_out).parent.mkdir(parents=True,exist_ok=True); Path(report_out).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report,hold_scored,records

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('tkbz'); ap.add_argument('--champion-json'); ap.add_argument('--budget',type=int,default=1500); ap.add_argument('--simulations',type=int,default=10000); ap.add_argument('--model-out',default='R18_MODEL/r18_model.joblib'); ap.add_argument('--report',default='R18_MODEL/r18_training_report.json'); ap.add_argument('--ablation',action='store_true')
    args=ap.parse_args(); report,_,_=run_backtest(args.tkbz,args.champion_json,args.budget,args.simulations,args.model_out,args.report,args.ablation); print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
