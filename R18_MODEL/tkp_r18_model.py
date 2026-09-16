#!/usr/bin/env python3
from __future__ import annotations
import math
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from tkp_r18_features import FEATURE_COLUMNS

# champion_score is a frozen external reference, not a trainable feature.
# Keeping it in FEATURE_COLUMNS preserves live/report schema compatibility, while
# excluding it here prevents the challenger from learning the champion's answer.
INDEPENDENT_FEATURES=[f for f in FEATURE_COLUMNS if f!='champion_score']
MODEL_FEATURES=INDEPENDENT_FEATURES+['market_logit','market_rank_pct']
PAIR_FEATURES=list(INDEPENDENT_FEATURES)

def _market_prob(df):
    out=df.copy()
    agf=pd.to_numeric(out.get('agf',0),errors='coerce').fillna(0).clip(lower=0)
    sums=agf.groupby(out['race_key']).transform('sum')
    counts=agf.groupby(out['race_key']).transform('count').clip(lower=1)
    out['market_probability']=np.where(sums>0,agf/sums,1.0/counts)
    eps=1e-5
    p=np.clip(out['market_probability'].astype(float),eps,1-eps)
    out['market_logit']=np.log(p/(1-p))
    out['market_rank_pct']=out.groupby('race_key')['market_probability'].rank(method='average',ascending=False,pct=True)
    return out

def _race_normalize(df,col,out_col):
    out=df.copy(); x=pd.to_numeric(out[col],errors='coerce').fillna(0).clip(lower=0)
    sums=x.groupby(out['race_key']).transform('sum'); counts=x.groupby(out['race_key']).transform('count').clip(lower=1)
    out[out_col]=np.where(sums>0,x/sums,1.0/counts)
    return out

def _model(random_state=17):
    return Pipeline([('scale',StandardScaler()),('lr',LogisticRegression(max_iter=1000,class_weight='balanced',C=0.7,random_state=random_state))])

def _matrix(df,cols):
    x=df.reindex(columns=cols).copy()
    for c in cols: x[c]=pd.to_numeric(x[c],errors='coerce').fillna(0.0)
    return x

def _positive(model,x):
    p=model.predict_proba(x)
    idx=list(model.classes_).index(1)
    return p[:,idx]


def _pairwise_training_frame(df):
    xs=[]; ys=[]
    for _,g in df.groupby('race_key',sort=False):
        win=g[g['winner']==1]
        lose=g[g['winner']==0]
        if len(win)!=1 or lose.empty: continue
        w=_matrix(win,PAIR_FEATURES).to_numpy(float)[0]
        l=_matrix(lose,PAIR_FEATURES).to_numpy(float)
        diffs=w[None,:]-l
        xs.append(diffs); ys.extend([1]*len(diffs))
        xs.append(-diffs); ys.extend([0]*len(diffs))
    if not xs:
        return pd.DataFrame(columns=PAIR_FEATURES),np.array([],dtype=int)
    return pd.DataFrame(np.vstack(xs),columns=PAIR_FEATURES),np.asarray(ys,dtype=int)

class R18ModelStack:
    def __init__(self,min_expert_races=30,random_state=17):
        self.min_expert_races=int(min_expert_races); self.random_state=int(random_state)
        self.global_model=None; self.experts={}; self.pairwise=None; self.blend=(0.20,0.20,0.20,0.15,0.25)

    def fit(self,train,val=None):
        tr=_market_prob(train)
        if tr['winner'].nunique()<2: raise ValueError('R18 eğitiminde iki target sınıfı gerekli')
        self.global_model=_model(self.random_state).fit(_matrix(tr,MODEL_FEATURES),tr['winner'].astype(int))
        self.experts={}
        for key,g in tr.groupby(['surface','distance_group'],dropna=False):
            if g['race_key'].nunique()<self.min_expert_races or g['winner'].nunique()<2: continue
            self.experts[tuple(map(str,key))]=_model(self.random_state+3).fit(_matrix(g,MODEL_FEATURES),g['winner'].astype(int))
        # Winner-vs-loser pair differences. Both directions keep the pairwise model symmetric.
        pair_x,pair_y=_pairwise_training_frame(tr)
        if len(pair_x):
            self.pairwise=_model(self.random_state+7).fit(pair_x,pair_y)
        if val is not None and len(val): self._select_blend(val)
        return self

    def _component_scores(self,df):
        x=_market_prob(df)
        x['residual_score']=_positive(self.global_model,_matrix(x,MODEL_FEATURES))
        champ_src=x['champion_score'] if 'champion_score' in x.columns else pd.Series(0.0,index=x.index)
        champ_raw=pd.to_numeric(champ_src,errors='coerce').fillna(0).clip(lower=0)
        x['_champ_raw']=champ_raw
        x=_race_normalize(x,'_champ_raw','champion_probability').drop(columns=['_champ_raw'])
        exp=pd.Series(x['residual_score'].to_numpy(float),index=x.index,dtype=float)
        for key,idx in x.groupby(['surface','distance_group'],dropna=False).groups.items():
            model=self.experts.get(tuple(map(str,key)))
            if model is not None: exp.loc[list(idx)]=_positive(model,_matrix(x.loc[idx],MODEL_FEATURES))
        x['expert_score']=exp.reindex(x.index).to_numpy(float)
        if self.pairwise is None:
            x['pairwise_score']=x['residual_score']
        else:
            pair_scores=[]
            for _,g in x.groupby('race_key',sort=False):
                m=_matrix(g,PAIR_FEATURES).to_numpy(float); n=len(g)
                if n<=1:
                    scores=np.ones(n,float)
                else:
                    ii,jj=np.where(~np.eye(n,dtype=bool))
                    diffs=m[ii]-m[jj]
                    probs=_positive(self.pairwise,pd.DataFrame(diffs,columns=PAIR_FEATURES))
                    sums=np.bincount(ii,weights=probs,minlength=n)
                    counts=np.bincount(ii,minlength=n)
                    scores=np.divide(sums,counts,out=np.full(n,.5,float),where=counts>0)
                pair_scores.extend(zip(g.index.tolist(),scores.tolist()))
            s=pd.Series({i:v for i,v in pair_scores}); x['pairwise_score']=s.reindex(x.index).fillna(.5).to_numpy()
        return x

    def _blend_from_components(self,x,blend):
        out=x.copy(); wm,wr,we,wp,wc=blend
        if 'champion_probability' not in out.columns:
            out['champion_probability']=out['market_probability']
        eps=1e-8
        raw=(np.clip(out['market_probability'],eps,1)**wm * np.clip(out['residual_score'],eps,1)**wr *
             np.clip(out['expert_score'],eps,1)**we * np.clip(out['pairwise_score'],eps,1)**wp *
             np.clip(out['champion_probability'],eps,1)**wc)
        out['blend_raw']=raw
        return _race_normalize(out,'blend_raw','win_probability')

    def _score_with_blend(self,df,blend):
        return self._blend_from_components(self._component_scores(df),blend)

    def _select_blend(self,val):
        candidates=[
          (0.20,0.20,0.20,0.15,0.25),(0.15,0.15,0.15,0.15,0.40),(0.10,0.15,0.15,0.10,0.50),
          (0.25,0.15,0.15,0.10,0.35),(0.15,0.25,0.15,0.10,0.35),(0.20,0.20,0.15,0.20,0.25),
          (0.10,0.10,0.10,0.10,0.60),(0.25,0.25,0.15,0.15,0.20)
        ]
        components=self._component_scores(val)
        best=None
        for b in candidates:
            scored=self._blend_from_components(components,b)
            p=np.clip(scored['win_probability'].to_numpy(float),1e-9,1-1e-9); y=scored['winner'].to_numpy(int)
            loss=float(np.mean(-(y*np.log(p)+(1-y)*np.log(1-p))))
            if best is None or loss<best[0]: best=(loss,b)
        if best: self.blend=best[1]

    def predict(self,df):
        if self.global_model is None: raise RuntimeError('R18 model fit edilmedi')
        x=self._score_with_blend(df,self.blend)
        x['model_source']=x.apply(lambda r:'expert' if (str(r.get('surface')),str(r.get('distance_group'))) in self.experts else 'global',axis=1)
        market=np.clip(x['market_probability'].astype(float),1e-6,1)
        x['value_score']=x['win_probability']/market
        return x
