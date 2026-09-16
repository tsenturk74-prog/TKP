#!/usr/bin/env python3
from __future__ import annotations
import math
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression


def _race_norm(df,src,dst):
    out=df.copy(); x=pd.to_numeric(out[src],errors='coerce').fillna(0).clip(lower=0)
    sums=x.groupby(out['race_key']).transform('sum'); counts=x.groupby(out['race_key']).transform('count').clip(lower=1)
    out[dst]=np.where(sums>0,x/sums,1.0/counts)
    return out

class ProbabilityCalibrator:
    def __init__(self): self.model=None
    def fit(self,validation,p_col='win_probability'):
        p=np.clip(pd.to_numeric(validation[p_col],errors='coerce').fillna(0.5).to_numpy(float),1e-6,1-1e-6)
        x=np.log(p/(1-p)).reshape(-1,1); y=pd.to_numeric(validation['winner'],errors='coerce').fillna(0).astype(int).to_numpy()
        if len(set(y.tolist()))>=2:
            self.model=LogisticRegression(C=1.0,max_iter=500).fit(x,y)
        return self
    def transform(self,df,p_col='win_probability'):
        out=df.copy(); p=np.clip(pd.to_numeric(out[p_col],errors='coerce').fillna(0.5).to_numpy(float),1e-6,1-1e-6)
        if self.model is None: raw=p
        else:
            x=np.log(p/(1-p)).reshape(-1,1); raw=self.model.predict_proba(x)[:,list(self.model.classes_).index(1)]
        out['_cal_raw']=raw
        out=_race_norm(out,'_cal_raw','calibrated_probability')
        return out.drop(columns=['_cal_raw'])

def _wilson(k,n,z=1.96):
    if n<=0: return (0.0,1.0)
    p=k/n; den=1+z*z/n
    center=(p+z*z/(2*n))/den
    half=(z*math.sqrt((p*(1-p)+z*z/(4*n))/n))/den
    return max(0.0,center-half),min(1.0,center+half)

def monte_carlo_races(df,simulations=10000,seed=17,jitter=0.12):
    simulations=int(simulations)
    if simulations<=0: raise ValueError('simulations pozitif olmalı')
    rng=np.random.default_rng(seed)
    frames=[]
    for race_no,(_,g) in enumerate(df.groupby('race_key',sort=False)):
        gg=g.copy(); p=np.clip(pd.to_numeric(gg.get('calibrated_probability',gg.get('win_probability')),errors='coerce').fillna(0).to_numpy(float),1e-9,1)
        p=p/p.sum() if p.sum()>0 else np.repeat(1/len(p),len(p))
        # Random-utility simulation: log probability plus small normal model uncertainty and Gumbel race noise.
        base=np.log(p)
        eps=rng.normal(0.0,float(jitter),size=(simulations,len(p)))
        gumbel=rng.gumbel(0.0,1.0,size=(simulations,len(p)))
        winners=np.argmax(base+eps+gumbel,axis=1)
        counts=np.bincount(winners,minlength=len(p))
        rates=counts/simulations
        lows=[]; highs=[]
        for k in counts:
            lo,hi=_wilson(int(k),simulations); lows.append(lo); highs.append(hi)
        gg['mc_wins']=counts; gg['mc_win_rate']=rates; gg['confidence_low']=lows; gg['confidence_high']=highs
        gg['uncertainty']=gg['confidence_high']-gg['confidence_low']
        frames.append(gg)
    out=pd.concat(frames,axis=0).sort_index() if frames else df.copy()
    out.attrs['simulations']=simulations
    return out
