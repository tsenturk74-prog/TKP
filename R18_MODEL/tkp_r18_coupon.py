#!/usr/bin/env python3
from __future__ import annotations
import itertools, math
import numpy as np
import pandas as pd


def _z(s):
    x=pd.to_numeric(s,errors='coerce').fillna(0.0).astype(float)
    sd=float(x.std(ddof=0))
    return (x-float(x.mean()))/(sd if sd>1e-9 else 1.0)

def r18_2_normal_frame(scored):
    """Build the Normal-coupon probability surface used by R18.2.

    R18.2 protects a horse when either the calibrated challenger or the
    frozen Champion regards it as strong.  The max-disagreement blend is
    then re-normalized inside each race.  Monte-Carlo ranking is aligned to
    the same probability surface so ranking and coverage cannot disagree.
    """
    x=scored.copy()
    challenger=pd.to_numeric(x.get('calibrated_probability',x.get('win_probability',0)),errors='coerce').fillna(0.0).clip(lower=0.0)
    champion_src=x['champion_probability'] if 'champion_probability' in x.columns else challenger
    champion=pd.to_numeric(champion_src,errors='coerce').fillna(0.0).clip(lower=0.0)
    raw=np.maximum(0.5*challenger.to_numpy(float),0.5*champion.to_numpy(float))
    raw=pd.Series(raw,index=x.index,dtype=float)
    sums=raw.groupby(x['race_key']).transform('sum')
    counts=raw.groupby(x['race_key']).transform('count').clip(lower=1)
    x['calibrated_probability']=np.where(sums>0,raw/sums,1.0/counts)
    x['mc_win_rate']=x['calibrated_probability']
    x['normal_strategy']='R18_2_MAX_DISAGREEMENT'
    return x

def _avoid_map(avoid):
    if not avoid: return {}
    out={}
    for leg in avoid.get('legs',[]): out[int(leg['leg'])]=set(map(str,leg.get('picks',[])))
    return out

def _rank_leg(g,family,avoid_set):
    x=g.copy(); p=pd.to_numeric(x.get('calibrated_probability',x.get('win_probability',0)),errors='coerce').fillna(0).clip(lower=0)
    market=pd.to_numeric(x.get('market_probability',0),errors='coerce').fillna(0).clip(lower=1e-6)
    if family=='normal':
        score=np.log(np.clip(p,1e-8,1)) + .20*pd.to_numeric(x.get('mc_win_rate',p),errors='coerce').fillna(p)
    elif family=='surprise':
        value=np.log(np.clip(p/market,1e-6,100))
        score=np.log(np.clip(p,1e-8,1)) + .70*value
    else:
        consensus=(_z(x.get('tr_puan',0))+_z(x.get('ypuan',0))+_z(x.get('g800',0))+_z(x.get('jockey_power',0)))/4
        score=np.log(np.clip(p,1e-8,1)) + .28*consensus
    if avoid_set:
        score=score-pd.Series([.22 if str(v) in avoid_set else 0.0 for v in x['horse_no_text']],index=x.index)
    x['_family_score']=score
    return x.sort_values(['_family_score','horse_no_text'],ascending=[False,True])


def _prune_states(states):
    kept={}
    by_singles={}
    for key,val in states.items():
        by_singles.setdefault(key[1],[]).append((key,val))
    for singles,items in by_singles.items():
        best_obj=-1e300
        for (cost,_),val in sorted(items,key=lambda kv:kv[0][0]):
            obj=float(val[0])
            if obj>best_obj+1e-12:
                kept[(cost,singles)]=val
                best_obj=obj
    return kept

def optimize_meeting(scored,family='normal',budget=1500,avoid=None,max_width=7):
    family=str(family).lower();
    if family not in ('normal','surprise','expert'): raise ValueError('family normal/surprise/expert olmalı')
    budget=max(1,int(budget)); amap=_avoid_map(avoid)
    groups=[]
    for leg,g in scored.groupby('leg',sort=True):
        ranked=_rank_leg(g,family,amap.get(int(leg),set()))
        rows=[]
        for _,r in ranked.iterrows():
            rows.append({'no':str(r.get('horse_no_text')),'p':float(r.get('calibrated_probability',r.get('win_probability',0)) or 0)})
        if not rows: raise ValueError(f'{leg}. ayakta at yok')
        groups.append((int(leg),rows[:max_width]))
    if len(groups)!=6: raise ValueError(f'Altılı için 6 ayak gerekli; bulundu={len(groups)}')
    # Dynamic program over (product cost, singles count). This avoids the former
    # max_width^6 Cartesian explosion while optimizing the exact same separable
    # objective under the hard budget cap.
    states={(1,0):(0.0,(),1.0)}
    for _,rows in groups:
        opts=[]
        running=0.0
        for w in range(1,len(rows)+1):
            running+=float(rows[w-1]['p'])
            leg_cov=max(1e-12,running)
            leg_obj=math.log(leg_cov)-.012*math.log(w)
            opts.append((w,leg_obj,leg_cov,1 if w==1 else 0))
        nxt={}
        for (cost0,singles0),(obj0,widths0,cov0) in states.items():
            for w,leg_obj,leg_cov,single_inc in opts:
                cost=cost0*w
                singles=singles0+single_inc
                if cost>budget or singles>2: continue
                obj=obj0+leg_obj; cov=cov0*leg_cov; key=(cost,singles)
                prev=nxt.get(key)
                if prev is None or obj>prev[0]+1e-12:
                    nxt[key]=(obj,widths0+(w,),cov)
        states=_prune_states(nxt)
        if not states: break
    candidates=[]
    for (cost,singles),(obj,widths,cov) in states.items():
        if singles in (1,2): candidates.append((obj,cost,widths,cov))
    if not candidates:
        raise ValueError('1-2 TEK ve bütçe koşulunu sağlayan kupon bulunamadı')
    best=max(candidates,key=lambda x:(x[0],-x[1]))
    _,cost,widths,coverage=best; legs=[]
    for (leg,rows),w in zip(groups,widths): legs.append({'leg':leg,'picks':[r['no'] for r in rows[:w]],'width':w,'coverage':sum(r['p'] for r in rows[:w])})
    sig='|'.join(f"{x['leg']}:{','.join(x['picks'])}" for x in legs)
    return {'family':family,'budget':budget,'cost':int(cost),'singles':sum(1 for w in widths if w==1),'coverage_probability':float(coverage),'legs':legs,'signature':sig}

def optimize_portfolio(scored,budget=1500):
    # Keep the R18.1 Normal as the diversification anchor so the already
    # validated Surprise/Expert lanes do not drift when Normal is upgraded.
    anchor=optimize_meeting(scored,'normal',budget,max_width=7)
    normal_frame=r18_2_normal_frame(scored)
    normal=optimize_meeting(normal_frame,'normal',budget,max_width=9)
    normal['strategy']='R18_2_MAX_DISAGREEMENT'
    surprise=optimize_meeting(scored,'surprise',budget,avoid=anchor,max_width=7)
    expert=optimize_meeting(scored,'expert',budget,avoid=anchor,max_width=7)
    surprise['strategy']='R18_1_VALUE'
    expert['strategy']='R18_1_EXPERT_CONSENSUS'
    return {'normal':normal,'surprise':surprise,'expert':expert}
