#!/usr/bin/env python3
import argparse, gzip, json, math, os, struct
from pathlib import Path
import pandas as pd

MAGIC=b'TKPB'
LEAK_FIELDS={
    'winner','finish_position','result_rank','result_score','result_time','official_time',
    'payouts','result_integrity_status','result_integrity_source','result_verified_depth',
    'pre_result_score','v27_backtest_rank','v27_backtest_score','v37_backtest_source',
    # KÖK DÜZELTME (2026-09-14, R17.9 audit): "Accurate" (GPS hız/bitiriş) verisi
    # yalnızca SONUÇ ile birlikte, yarış BİTTİKTEN SONRA toplanır (bkz.
    # stats-engine.js'deki 2026-08-09 KÖK DÜZELTME notu — canlı JS motoru bu
    # dersi zaten öğrenmişti, Python eğitim pipeline'ı öğrenmemişti). Bir
    # yarışın KENDİ accurate_avg_speed_mps/accurate_closing_speed_mps/
    # accurate_max_speed_mps/accurate_finish_signal değeri, o yarışın kuponu
    # kurulurken HİÇBİR ZAMAN mevcut değildir — ham haliyle FEATURE olamaz.
    # Sızıntısız eşdeğerleri (priorAccurateAvgSpeed/priorAccurateFinishSignal/
    # priorAccurateStarts, atın DAHA ÖNCEKİ yarışlarının ortalaması) zaten
    # NUMERIC_FEATURES içinde ve kullanılmaya devam ediyor.
    'accurate_avg_speed_mps','accurate_closing_speed_mps','accurate_max_speed_mps','accurate_finish_signal'
}

NUMERIC_FEATURES=[
    'distance','leg','horse_no','agf','agf_rank','tr','tr_rank','sp','sp_rank','g800','g800_rank',
    'jbyg','jbyg_rank','tr_puan','tr_ganyan','tr_ganyan_rank','ypuan','s_value','value_score','value_rank',
    'start_no','weight_kg','hndkp','hndkp_rank','score','tkp_display_score','prediction_visible_tkp_snapshot',
    'workout_400','workout_600','workout_800','priorStarts','priorWins','priorSurpriseHits','priorAccurateStarts',
    'priorAccurateAvgSpeed','priorAccurateFinishSignal','jockey_win_pct','trainer_win_pct','owner_win_pct',
    'team_strength_pct','team_strength_rank','jockey_trainer_rank','gpr_starts','gpr_wins','gpr_strength',
    'condWinStarts','condWinWins','condWinPct','condSurpriseHits','bestLb','backfill_fraction',
    'last3_form_score','track_type_win_rate','distance_fit_score','jockey_form_30d','handicap_blend_score'
]
# R17.9: dinamik katsayı/ağırlık katmanı. Hepsi zaman-nedensel (yalnız GEÇMİŞ
# koşulardan) hesaplanır; mevcut koşunun sonucu asla kendi özelliğine sızmaz.
DYNAMIC_FORM_FEATURES=['last3_form_score','track_type_win_rate','distance_fit_score','jockey_form_30d']
HANDICAP_BLEND_WEIGHTS={'agf_rank':.35,'hndkp_rank':.30,'tr_rank':.20,'jbyg_rank':.15}
CATEGORICAL_FEATURES=[
    'hippodrome','surface','breed','condition_family','condition_text','distance_group',
    'jockey_name','trainer_name','owner_name','ekuri_group','workout_jockey'
]
FEATURE_COLUMNS=NUMERIC_FEATURES+CATEGORICAL_FEATURES
META_COLUMNS=['race_key','race_date','file_id','race_id','horse_name','horse_no_text']


def _num(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def read_tkbz(path):
    with gzip.open(path,'rb') as f:
        if f.read(4)!=MAGIC: raise ValueError('TKPB magic bulunamadı')
        version=struct.unpack('>I',f.read(4))[0]
        env_len=struct.unpack('>I',f.read(4))[0]
        envelope=json.loads(f.read(env_len))
        collections={}
        for desc in envelope.get('collections',[]):
            rows=[]
            for _ in range(int(desc.get('chunks') or 0)):
                n=struct.unpack('>I',f.read(4))[0]
                rows.extend(json.loads(f.read(n)))
            collections[str(desc.get('name'))]=rows
    return version,envelope,collections


def race_key(r):
    uid=str(r.get('race_uid') or '').strip()
    if uid:
        return uid
    meeting=str(r.get('meeting_uid') or '').strip()
    suffix=f"{r.get('leg','')}|{r.get('id','')}"
    if meeting:
        return f"{meeting}|{suffix}"
    return f"{r.get('race_date','')}|{r.get('hippodrome','')}|{r.get('file_id','')}|{suffix}"


def target_winner(h):
    if int(_num(h.get('winner')) or 0)==1:
        return 1
    fp=_num(h.get('finish_position'))
    bf=((h.get('_training_backfill') or {}).get('fields') or {}).get('finish_position')
    # A surrogate rank is never accepted as an outcome target.
    if fp==1 and bf not in ('surrogate:rank',):
        return 1
    return 0


def add_dynamic_form_features(df):
    """R17.9 dinamik katsayı/ağırlık katmanı.

    Beş yeni özellik ekler: last3_form_score, track_type_win_rate,
    distance_fit_score, jockey_form_30d (hepsi zaman-nedensel: her satır
    yalnız KENDİSİNDEN ÖNCEKİ race_date'e sahip satırları kullanır — mevcut
    koşunun sonucu asla kendi satırına sızmaz) ve handicap_blend_score
    (yalnız cari satırın kendi AGF/HNDKP/TR/JBYG sıra bilgisini harmanlar,
    zaman ekseni içermez, sızıntı riski yoktur).
    """
    out=df.sort_values(['race_date','race_key']).reset_index(drop=True).copy()
    fp=pd.to_numeric(out.get('_finish_position_raw'),errors='coerce')
    win=pd.to_numeric(out.get('winner'),errors='coerce').fillna(0)
    # Yakın form sinyali: 1. sıraya ne kadar yakın bitirdiği (0..1), sonuç yoksa nötr.
    near_win=(1.0/fp.clip(lower=1)).where(fp.notna(), win)

    def causal_rolling_mean(series,group_keys,window=None):
        g=pd.DataFrame({'v':series,'k':group_keys})
        grp=g.groupby('k')['v']
        shifted=grp.shift(1)
        if window is None:
            roll=shifted.groupby(g['k']).expanding().mean().reset_index(level=0,drop=True)
        else:
            roll=shifted.groupby(g['k']).rolling(window,min_periods=1).mean().reset_index(level=0,drop=True)
        return roll

    horse=out['horse_name'].astype(str)
    out['last3_form_score']=causal_rolling_mean(near_win,horse,window=3).fillna(0.0)
    surf_key=horse+'|'+out['surface'].astype(str)
    out['track_type_win_rate']=causal_rolling_mean(win,surf_key).fillna(0.0)
    dist_key=horse+'|'+out['distance_group'].astype(str)
    out['distance_fit_score']=causal_rolling_mean(win,dist_key).fillna(0.0)
    jockey=out.get('jockey_name',pd.Series(['']*len(out))).astype(str)
    dates=pd.to_datetime(out['race_date'],errors='coerce')
    jform=pd.Series(0.0,index=out.index)
    if jockey.ne('').any() and dates.notna().any():
        tmp=pd.DataFrame({'jockey':jockey,'date':dates,'win':win}).reset_index(drop=True)
        tmp['idx']=tmp.index
        for name,g in tmp.groupby('jockey',sort=False):
            if not name: continue
            gi=g.sort_values('date')
            d=gi['date'].to_numpy(); w=gi['win'].to_numpy(dtype=float); idx=gi['idx'].to_numpy()
            vals=[]
            for i in range(len(gi)):
                cur=d[i]
                if pd.isna(cur):
                    vals.append(0.0); continue
                mask=(d<cur)&(d>=cur-pd.Timedelta(days=30))
                vals.append(float(w[mask].mean()) if mask.any() else 0.0)
            jform.iloc[idx]=vals
    out['jockey_form_30d']=jform.fillna(0.0)

    out['handicap_blend_score']=compute_handicap_blend_score(out)
    return out.drop(columns=['_finish_position_raw'],errors='ignore')


def compute_handicap_blend_score(df):
    """Cari satırın kendi AGF/HNDKP/TR/JBYG sırasını harmanlar (zaman ekseni
    yok, sadece aynı race_key içindeki diğer atlara göre normalize eder).
    Sızıntı riski yok: sonuç alanı kullanılmaz."""
    size=df.groupby('race_key')['race_key'].transform('size')
    blend=pd.Series(0.0,index=df.index); wsum=pd.Series(0.0,index=df.index)
    for fld,weight in HANDICAP_BLEND_WEIGHTS.items():
        if fld not in df: continue
        rank=pd.to_numeric(df[fld],errors='coerce')
        valid=rank.notna()&(rank>0)&(size>1)
        norm=1.0-((rank-1)/(size-1).clip(lower=1))
        blend=blend+norm.where(valid,0.0)*weight
        wsum=wsum+weight*valid.astype(float)
    return (blend/wsum.replace(0,pd.NA)).fillna(0.5)


def build_form_index(df):
    """Eğitim setinin en güncel durumunu (as-of-now) at/jokey bazında özetler.
    Canlı bültende geçmiş satırlar mevcut olmadığı için prepare_live_frame bu
    indeksi kullanır. Yalnız GEÇMİŞ (eğitim kesim tarihine kadar olan) veriden
    üretilir; hiçbir canlı/gelecek sonuç girmez."""
    if df is None or df.empty:
        return {'schema':'TKP_R17_FORM_INDEX_V1','horse':{},'jockey':{}}
    d=df.copy()
    d['win']=pd.to_numeric(d['winner'],errors='coerce').fillna(0)
    d['race_date_dt']=pd.to_datetime(d['race_date'],errors='coerce')
    horse_idx={}
    for name,g in d.groupby('horse_name'):
        if not name: continue
        g=g.sort_values('race_date')
        by_surface={str(s):float(gs['win'].mean()) for s,gs in g.groupby('surface') if str(s)}
        by_distance={str(dg):float(gd['win'].mean()) for dg,gd in g.groupby('distance_group') if str(dg)}
        horse_idx[str(name)]={
            'last3_form_score':float(g['win'].tail(3).mean()) if len(g) else 0.0,
            'track_type_win_rate':by_surface,'distance_fit_score':by_distance,
            'as_of':str(g['race_date'].iloc[-1])
        }
    jockey_idx={}
    cutoff=d['race_date_dt'].max()
    for name,g in d.groupby('jockey_name'):
        if not name: continue
        rate=0.0
        if pd.notna(cutoff):
            recent=g[(g['race_date_dt']>cutoff-pd.Timedelta(days=30))&(g['race_date_dt']<=cutoff)]
            rate=float(recent['win'].mean()) if len(recent) else 0.0
        jockey_idx[str(name)]={'jockey_form_30d':rate,'as_of':str(cutoff.date()) if pd.notna(cutoff) else None}
    return {'schema':'TKP_R17_FORM_INDEX_V1','horse':horse_idx,'jockey':jockey_idx}


def apply_form_index(live_df,form_index):
    """Canlı bülten satırlarına en güncel at/jokey form indeksini (varsa)
    yazar. Indeks yoksa veya at/jokey daha önce görülmemişse nötr (0.0)
    bırakılır — prepare_live_frame'in imputation adımı bunu 0.0'a sabitler."""
    out=live_df.copy()
    idx=form_index or {}
    horse_idx=idx.get('horse') or {}
    jockey_idx=idx.get('jockey') or {}
    for c in DYNAMIC_FORM_FEATURES:
        if c not in out: out[c]=None
    for i,row in out.iterrows():
        h=horse_idx.get(str(row.get('horse_name') or ''))
        if h:
            out.at[i,'last3_form_score']=h.get('last3_form_score')
            out.at[i,'track_type_win_rate']=(h.get('track_type_win_rate') or {}).get(str(row.get('surface') or ''))
            out.at[i,'distance_fit_score']=(h.get('distance_fit_score') or {}).get(str(row.get('distance_group') or ''))
        j=jockey_idx.get(str(row.get('jockey_name') or ''))
        if j:
            out.at[i,'jockey_form_30d']=j.get('jockey_form_30d')
    return out


def build_rows(races):
    rows=[]
    for r in races or []:
        rk=race_key(r)
        hs=r.get('horses') or []
        for h in hs:
            bf=(h.get('_training_backfill') or {}).get('fields') or {}
            row={
                'race_key':rk,'race_date':str(r.get('race_date') or ''),'file_id':r.get('file_id'),
                'race_id':r.get('id'),'horse_name':str(h.get('horse_name') or ''),'horse_no_text':str(h.get('horse_no') or ''),
                'winner':target_winner(h),
                'hippodrome':str(r.get('hippodrome') or ''),'surface':str(r.get('surface') or ''),'breed':str(r.get('breed') or ''),
                'condition_family':str(r.get('condition_family') or ''),'condition_text':str(r.get('condition_text') or ''),
                'distance_group':str(r.get('distance_group') or ''),'distance':_num(r.get('distance')),'leg':_num(r.get('leg')),
                'backfill_fraction':len(bf)/max(1,18),
                # Yalnız dinamik form özelliklerini nedensel (geçmişe dönük,
                # shift(1) uygulanmış) kurmak için geçici alan. FEATURE_COLUMNS'a
                # asla girmez; add_dynamic_form_features() sonunda düşürülür.
                '_finish_position_raw':_num(h.get('finish_position')),
            }
            for fld in NUMERIC_FEATURES:
                if fld in ('distance','leg','backfill_fraction') or fld in DYNAMIC_FORM_FEATURES or fld=='handicap_blend_score':
                    continue
                row[fld]=_num(h.get(fld))
            for fld in CATEGORICAL_FEATURES:
                if fld in row: continue
                row[fld]=str(h.get(fld) or '')
            rows.append(row)
    df=pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=META_COLUMNS+FEATURE_COLUMNS+['winner'])
    df=add_dynamic_form_features(df)
    for c in NUMERIC_FEATURES:
        if c not in df: df[c]=None
    for c in CATEGORICAL_FEATURES:
        if c not in df: df[c]=''
    return df[META_COLUMNS+FEATURE_COLUMNS+['winner']]



def prepare_live_frame(races,form_index=None):
    """Convert current bulletin races to the exact training feature contract.

    No outcome/result field is consumed. Missing live inputs use the same neutral
    sentinels as training so the sidecar can score partial collector payloads
    without contaminating them with historical outcomes.

    form_index (optional): output of build_form_index() from the last training
    run. build_rows() alone cannot compute the 4 rolling dynamic-form features
    for a live bulletin (no history in the batch), so it yields neutral 0.0 for
    them; form_index supplies the at/jokey'in en güncel (eğitim kesim tarihine
    kadar olan) değerlerini. handicap_blend_score her zaman canlı satırdan
    taze hesaplanır (zaman ekseni gerektirmez).
    """
    raw=build_rows(races).drop(columns=['winner'],errors='ignore').copy()
    if form_index:
        raw=apply_form_index(raw,form_index)
    imputed=0
    for c in NUMERIC_FEATURES:
        if c not in raw: raw[c]=None
        x=pd.to_numeric(raw[c],errors='coerce')
        n=int(x.isna().sum())
        if n:
            x=x.fillna(0.0); imputed+=n
        raw[c]=x
    for c in CATEGORICAL_FEATURES:
        if c not in raw: raw[c]=''
        x=raw[c].astype('string').fillna('').str.strip()
        miss=(x==''); n=int(miss.sum())
        if n:
            x=x.mask(miss,'UNKNOWN'); imputed+=n
        raw[c]=x.astype(str)
    cols=META_COLUMNS+FEATURE_COLUMNS
    for c in cols:
        if c not in raw: raw[c]=0.0 if c in NUMERIC_FEATURES else ''
    raw=raw[cols]
    return raw, {'races':int(raw.race_key.nunique()) if len(raw) else 0,'rows':int(len(raw)),'imputed_cells':imputed}


def prepare_training_frame(df):
    if df.empty:
        return df.copy(), {'dropped_invalid_target_races':0,'kept_races':0,'kept_rows':0,'imputed_cells':0}
    out=df.copy()
    target_counts=out.groupby('race_key')['winner'].sum()
    valid=set(target_counts[target_counts==1].index)
    dropped=int(out['race_key'].nunique()-len(valid))
    out=out[out['race_key'].isin(valid)].copy()
    imputed=0
    for c in NUMERIC_FEATURES:
        x=pd.to_numeric(out[c],errors='coerce')
        n=int(x.isna().sum())
        if n:
            # Constant sentinel avoids borrowing future holdout distribution.
            x=x.fillna(0.0)
            imputed+=n
        out[c]=x
    for c in CATEGORICAL_FEATURES:
        x=out[c].astype('string').fillna('').str.strip()
        miss=(x=='')
        n=int(miss.sum())
        if n:
            x=x.mask(miss,'UNKNOWN')
            imputed+=n
        out[c]=x.astype(str)
    return out, {'dropped_invalid_target_races':dropped,'kept_races':int(out.race_key.nunique()),'kept_rows':int(len(out)),'imputed_cells':imputed}

def temporal_split(df,val_fraction=.15,holdout_fraction=.15):
    if df.empty: return df.copy(),df.copy(),df.copy()
    race_dates=(df[['race_key','race_date']].drop_duplicates().sort_values(['race_date','race_key']).reset_index(drop=True))
    n=len(race_dates)
    if n<3: raise ValueError('Temporal split için en az 3 yarış gerekli')
    hold_n=max(1,int(round(n*holdout_fraction)))
    val_n=max(1,int(round(n*val_fraction)))
    if hold_n+val_n>=n:
        hold_n=1; val_n=1
    train_keys=set(race_dates.iloc[:n-val_n-hold_n]['race_key'])
    val_keys=set(race_dates.iloc[n-val_n-hold_n:n-hold_n]['race_key'])
    hold_keys=set(race_dates.iloc[n-hold_n:]['race_key'])
    return (df[df.race_key.isin(train_keys)].copy(),df[df.race_key.isin(val_keys)].copy(),df[df.race_key.isin(hold_keys)].copy())


def normalize_race_probabilities(df,raw_col='raw_p',out_col='p_win'):
    out=df.copy()
    raw=pd.to_numeric(out[raw_col],errors='coerce').fillna(0).clip(lower=0)
    out['_raw_nonneg']=raw
    sums=out.groupby('race_key')['_raw_nonneg'].transform('sum')
    counts=out.groupby('race_key')['_raw_nonneg'].transform('count').clip(lower=1)
    out[out_col]=raw.where(sums>0,1.0/counts)
    out.loc[sums>0,out_col]=raw[sums>0]/sums[sums>0]
    return out.drop(columns=['_raw_nonneg'])


def metric_report(df,p_col):
    if df.empty: return {'races':0,'horses':0,'top1_hit':None,'brier':None,'log_loss':None}
    eps=1e-12
    y=pd.to_numeric(df['winner'],errors='coerce').fillna(0).astype(int)
    p=pd.to_numeric(df[p_col],errors='coerce').fillna(0).clip(eps,1-eps)
    brier=float(((p-y)**2).mean())
    logloss=float((-(y*p.map(math.log)+(1-y)*(1-p).map(math.log))).mean())
    winners=df.loc[df.groupby('race_key')[p_col].idxmax()]
    top1=float(winners['winner'].mean()) if len(winners) else None
    return {'races':int(df.race_key.nunique()),'horses':int(len(df)),'top1_hit':top1,'brier':brier,'log_loss':logloss}




def bankroll_metrics(entries):
    clean=[]
    for e in entries or []:
        cost=float(_num(e.get('cost')) or 0.0)
        ret=float(_num(e.get('return')) or _num(e.get('payout')) or 0.0)
        clean.append({'cost':cost,'return':ret})
    cost=sum(x['cost'] for x in clean); ret=sum(x['return'] for x in clean); net=ret-cost
    equity=0.0; peak=0.0; max_dd=0.0; streak=0; max_streak=0; hits=0
    for x in clean:
        pnl=x['return']-x['cost']; equity+=pnl; peak=max(peak,equity); max_dd=max(max_dd,peak-equity)
        if x['return']>0:
            hits+=1; streak=0
        else:
            streak+=1; max_streak=max(max_streak,streak)
    return {
        'tickets':len(clean),'cost':round(cost,6),'return':round(ret,6),'net':round(net,6),
        'roi_pct':round((net/cost*100.0) if cost>0 else 0.0,6),
        'hit_rate':round((hits/len(clean)) if clean else 0.0,6),
        'max_drawdown':round(max_dd,6),'longest_losing_streak':int(max_streak)
    }


def sidebet_portfolio_report(tickets):
    by_product={}
    overall=[]
    for t in tickets or []:
        ev=t.get('evaluation') or {}
        if not int(_num(ev.get('known')) or 0): continue
        if t.get('primary') not in (None,1,True): continue
        if str(t.get('variant') or 'primary')!='primary': continue
        row={'cost':float(_num(ev.get('cost')) or _num(t.get('cost')) or 0.0),
             'return':float(_num(ev.get('return')) or 0.0)}
        product=str(t.get('product') or 'unknown')
        by_product.setdefault(product,[]).append(row); overall.append(row)
    return {'overall':bankroll_metrics(overall),'by_product':{k:bankroll_metrics(v) for k,v in sorted(by_product.items())}}


def actual_altili_report(bets):
    rows=[]
    for b in bets or []:
        if str(b.get('betGameType') or '').lower()!='altili': continue
        rows.append({'cost':float(_num(b.get('cost')) or 0.0),'return':float(_num(b.get('payout')) or 0.0)})
    return bankroll_metrics(rows)


def combined_portfolio_report(bets,sidebet_tickets):
    altili_rows=[]
    for b in bets or []:
        if str(b.get('betGameType') or '').lower()=='altili':
            altili_rows.append({'cost':float(_num(b.get('cost')) or 0.0),'return':float(_num(b.get('payout')) or 0.0)})
    side_rows=[]
    for t in sidebet_tickets or []:
        ev=t.get('evaluation') or {}
        if not int(_num(ev.get('known')) or 0): continue
        if t.get('primary') not in (None,1,True): continue
        if str(t.get('variant') or 'primary')!='primary': continue
        side_rows.append({'cost':float(_num(ev.get('cost')) or _num(t.get('cost')) or 0.0),'return':float(_num(ev.get('return')) or 0.0)})
    altili=bankroll_metrics(altili_rows)
    side=sidebet_portfolio_report(sidebet_tickets)
    combined=bankroll_metrics(altili_rows+side_rows)
    return {'altili':altili,'sidebets':side,'combined':combined}


def ganyan_payout_map(races):
    out={}
    for r in races or []:
        rk=race_key(r); m={}
        for p in (r.get('payouts') or []):
            if not isinstance(p,dict) or str(p.get('key') or '')!='ganyan': continue
            combo=str(p.get('combo') or '').strip(); amount=_num(p.get('amount'))
            if combo and amount is not None: m[combo]=float(amount)
        if m: out[rk]=m
    return out


def model_ganyan_roi(df,p_col,payout_map):
    rows=[]; hits=0
    if df is None or df.empty: return {'bets':0,'hits':0,**bankroll_metrics([])}
    for rk,g in df.groupby('race_key',sort=False):
        if rk not in payout_map or g.empty: continue
        pick=g.loc[pd.to_numeric(g[p_col],errors='coerce').fillna(-1).idxmax()]
        no=str(pick.get('horse_no_text') or '').strip()
        ret=float(payout_map.get(rk,{}).get(no,0.0) or 0.0) if int(pick.get('winner') or 0)==1 else 0.0
        if ret>0: hits+=1
        rows.append({'cost':1.0,'return':ret})
    m=bankroll_metrics(rows)
    return {'bets':m.pop('tickets'),'hits':hits,**m}

def champion_probabilities(df):
    out=df.copy()
    base=pd.to_numeric(out['tkp_display_score'],errors='coerce')
    alt=pd.to_numeric(out['score'],errors='coerce')
    out['champion_raw']=base.where(base.notna(),alt).fillna(0).clip(lower=0)
    return normalize_race_probabilities(out,'champion_raw','champion_p_win')


def _predict_positive(predictor, x):
    proba=predictor.predict_proba(x)
    if isinstance(proba,pd.Series): return pd.to_numeric(proba,errors='coerce')
    for key in (1,'1',True):
        if key in proba.columns: return pd.to_numeric(proba[key],errors='coerce')
    return pd.to_numeric(proba.iloc[:,-1],errors='coerce')




def promotion_gate_decision(challenger, champion, challenger_roi, champion_roi, historical_provenance_ok=False, allow_historical_production=False):
    roi_coverage=min(int((challenger_roi or {}).get('bets') or 0),int((champion_roi or {}).get('bets') or 0))
    roi_pass=bool(roi_coverage>=100 and (challenger_roi or {}).get('roi_pct',-1e9)>=(champion_roi or {}).get('roi_pct',1e9))
    model_pass=bool(
        challenger.get('log_loss') is not None and champion.get('log_loss') is not None and
        challenger['log_loss']<champion['log_loss'] and challenger['brier']<=champion['brier'] and
        challenger['top1_hit']>=champion['top1_hit'] and roi_pass
    )
    provenance_pass=bool(historical_provenance_ok)
    production_pass=bool(model_pass and (provenance_pass or allow_historical_production))
    return {
        'pass':model_pass,
        'production_pass':production_pass,
        'provenance_pass':provenance_pass,
        'manual_historical_override':bool(allow_historical_production),
        'roi_pass':roi_pass,
        'roi_coverage_races':roi_coverage,
        'rule':'model gate: challenger log_loss < champion AND brier <= champion AND top1_hit >= champion AND normalized ganyan ROI >= champion (min 100 payout-known races); production gate additionally requires verified pre-race provenance or explicit override'
    }

def train_autogluon(df,model_dir,time_limit=1800,presets='medium_quality',payout_map=None,historical_provenance_ok=False,allow_historical_production=False):
    try:
        from autogluon.tabular import TabularPredictor
    except Exception as e:
        raise RuntimeError('AutoGluon kurulu değil. Python 3.10-3.13 ortamında autogluon kurulmalı.') from e
    train,val,hold=temporal_split(df)
    train_cols=FEATURE_COLUMNS+['winner']
    predictor=TabularPredictor(label='winner',problem_type='binary',eval_metric='log_loss',positive_class=1,path=str(model_dir))
    predictor.fit(train_data=train[train_cols],tuning_data=val[train_cols],time_limit=int(time_limit),presets=presets)
    hold=hold.copy()
    hold['raw_p']=_predict_positive(predictor,hold[FEATURE_COLUMNS]).to_numpy()
    hold=normalize_race_probabilities(hold,'raw_p','p_win')
    hold=champion_probabilities(hold)
    report={
        'challenger':metric_report(hold,'p_win'),
        'champion':metric_report(hold,'champion_p_win'),
        'model_names':list(predictor.model_names()),
        'best_model':predictor.model_best,
        'train_races':int(train.race_key.nunique()),'validation_races':int(val.race_key.nunique()),'holdout_races':int(hold.race_key.nunique())
    }
    c=report['challenger']; b=report['champion']
    payout_map=payout_map or {}
    c_roi=model_ganyan_roi(hold,'p_win',payout_map)
    b_roi=model_ganyan_roi(hold,'champion_p_win',payout_map)
    c['ganyan_roi']=c_roi; b['ganyan_roi']=b_roi
    report['promotion_gate']=promotion_gate_decision(
        c,b,c_roi,b_roi,
        historical_provenance_ok=historical_provenance_ok,
        allow_historical_production=allow_historical_production
    )
    return predictor,report,hold


def export_live_predictions(predictor, live_df, out_json):
    x=live_df.copy()
    x['raw_p']=_predict_positive(predictor,x[FEATURE_COLUMNS]).to_numpy()
    x=normalize_race_probabilities(x,'raw_p','p_win')
    payload={'schema':'TKP_R17_PWIN_V1','rows':[]}
    for _,r in x.sort_values(['race_date','race_key','p_win'],ascending=[True,True,False]).iterrows():
        # JS tarafı (tkp-r17-autogluon-bridge.js) satırı {...row,p_win} ile
        # açıp horse'a yayar; dynamic_form alt objesi ekstra alan olarak
        # yoksayılmaz, Dashboard'da ayrıştırma için doğrudan okunabilir.
        payload['rows'].append({
            'race_key':r['race_key'],'race_date':r['race_date'],'file_id':r['file_id'],'race_id':r['race_id'],
            'horse_no':r['horse_no_text'],'horse_name':r['horse_name'],'p_win':round(float(r['p_win']),8),
            'dynamic_form':{f:round(float(r.get(f) or 0.0),6) for f in DYNAMIC_FORM_FEATURES+['handicap_blend_score']}
        })
    Path(out_json).parent.mkdir(parents=True,exist_ok=True)
    Path(out_json).write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    return payload


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('tkbz')
    ap.add_argument('--dataset',default='R17_MODEL/r17_training.csv')
    ap.add_argument('--model-dir',default='R17_MODEL/autogluon_model')
    ap.add_argument('--report',default='R17_MODEL/r17_training_report.json')
    ap.add_argument('--time-limit',type=int,default=1800)
    ap.add_argument('--presets',default='medium_quality')
    ap.add_argument('--build-only',action='store_true')
    ap.add_argument('--historical-provenance-ok',action='store_true',help='Only use when all training/holdout market inputs are proven pre-race snapshots')
    ap.add_argument('--allow-historical-production',action='store_true',help='Explicitly override provenance guard; not recommended')
    ap.add_argument('--form-index',default=None,help='r17_form_index.json çıktı yolu (varsayılan: report ile aynı klasör)')
    args=ap.parse_args()
    _,_,cols=read_tkbz(args.tkbz)
    raw_df=build_rows(cols.get('races',[]))
    df,quality=prepare_training_frame(raw_df)
    Path(args.dataset).parent.mkdir(parents=True,exist_ok=True)
    df.to_csv(args.dataset,index=False,encoding='utf-8-sig')
    form_index=build_form_index(df)
    form_index_path=Path(args.form_index) if args.form_index else Path(args.report).with_name('r17_form_index.json')
    form_index_path.parent.mkdir(parents=True,exist_ok=True)
    form_index_path.write_text(json.dumps(form_index,ensure_ascii=False,indent=2),encoding='utf-8')
    base={'schema':'TKP_R17_TRAINING_REPORT_V2_ROI','rows':len(df),'races':int(df.race_key.nunique()),'features':FEATURE_COLUMNS,'dataset':args.dataset,'quality':quality,'form_index_path':str(form_index_path),'dynamic_features':DYNAMIC_FORM_FEATURES+['handicap_blend_score']}
    base['portfolio_evidence']=combined_portfolio_report(cols.get('bets',[]),cols.get('sidebet_ticket_log',[]))
    if args.build_only:
        Path(args.report).write_text(json.dumps(base,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(base,ensure_ascii=False,indent=2)); return
    payout_map=ganyan_payout_map(cols.get('races',[]))
    _,report,hold=train_autogluon(df,args.model_dir,args.time_limit,args.presets,payout_map=payout_map,historical_provenance_ok=args.historical_provenance_ok,allow_historical_production=args.allow_historical_production)
    base.update(report)
    Path(args.report).write_text(json.dumps(base,ensure_ascii=False,indent=2),encoding='utf-8')
    hold.to_csv(Path(args.report).with_name('r17_holdout_predictions.csv'),index=False,encoding='utf-8-sig')
    print(json.dumps(base,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
