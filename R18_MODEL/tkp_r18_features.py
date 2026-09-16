#!/usr/bin/env python3
from __future__ import annotations
import math
from collections import defaultdict, deque
import pandas as pd

FORBIDDEN_FIELDS={
    'winner','finish_position','result_rank','result_score','result_time','official_time','payouts',
    'pre_result_score','v27_backtest_rank','v27_backtest_score','sidebet_target_position'
}
FEATURE_COLUMNS=[
    'recent_form','agf','tr_puan','ypuan','g800','surface_fit','distance_fit','jockey_power','handicap_kg_score','champion_score',
    'agf_rank','tr_rank','hndkp_rank','sp','start_no','distance','leg','prior_starts','prior_wins'
]
META_COLUMNS=['race_key','race_date','file_id','race_id','meeting_uid','altili_no','leg','horse_name','horse_no_text','surface','distance_group','condition_family']

def num(v, default=0.0):
    try:
        x=float(v)
        return x if math.isfinite(x) else default
    except Exception:
        return default

def race_key(r):
    uid=str(r.get('race_uid') or '').strip()
    if uid: return uid
    meeting=str(r.get('meeting_uid') or '').strip()
    suffix=f"{r.get('leg','')}|{r.get('id','')}"
    if meeting: return f"{meeting}|{suffix}"
    return f"{r.get('race_date','')}|{r.get('hippodrome','')}|{r.get('file_id','')}|{suffix}"

def distance_group(distance):
    d=num(distance)
    if d<=0: return 'UNKNOWN'
    if d<=1400: return 'SHORT'
    if d<=1900: return 'MIDDLE'
    return 'LONG'

def target(h):
    if int(num(h.get('winner')))==1: return 1
    # Only explicit finish_position is used as a target, never as a feature.
    return 1 if num(h.get('finish_position'),999)==1 else 0

def _recent_form(hist):
    if not hist: return 0.5
    # Last three prior finishes; winner=1.0, 2nd=.75, 3rd=.55, then decays.
    vals=[]
    for fp in list(hist)[-3:]:
        fp=max(1,int(fp))
        vals.append(max(0.05,1.0-0.22*(fp-1)))
    weights=[1.0,1.25,1.55][-len(vals):]
    return sum(v*w for v,w in zip(vals,weights))/sum(weights)

def _row_from(r,h,state):
    name=str(h.get('horse_name') or '').strip().upper()
    prev=state.get(name,{})
    surface=str(r.get('surface') or 'UNKNOWN').upper()
    d=num(r.get('distance'))
    sh=prev.get('surface',{}).get(surface,{'starts':0,'wins':0})
    near=[x for x in prev.get('distance',[]) if abs(x[0]-d)<=250]
    surface_fit=(sh['wins']+0.75)/(sh['starts']+1.5) if sh['starts'] else 0.5
    distance_fit=(sum(x[1] for x in near)+0.75)/(len(near)+1.5) if near else 0.5
    jbyg=num(h.get('jbyg'))
    jwin=num(h.get('jockey_win_pct'))
    jockey_power=0.60*(jbyg/100.0 if jbyg>1 else jbyg)+0.40*(jwin/100.0 if jwin>1 else jwin)
    hnd=num(h.get('hndkp')); kg=num(h.get('weight_kg'))
    handicap_kg=(hnd/100.0)-max(0.0,kg-55.0)*0.018
    tr=num(h.get('tr_puan'),None)
    if tr is None: tr=num(h.get('tr_ganyan'),None)
    if tr is None: tr=num(h.get('tr'))
    return {
      'race_key':race_key(r),'race_date':str(r.get('race_date') or ''),'file_id':r.get('file_id'),'race_id':r.get('id'),
      'meeting_uid':str(r.get('meeting_uid') or ''),'altili_no':int(num(r.get('altili_no'),1)),'leg':int(num(r.get('leg'),0)),
      'horse_name':str(h.get('horse_name') or ''),'horse_no_text':str(h.get('horse_no') or ''),
      'surface':surface,'distance_group':str(r.get('distance_group') or distance_group(d)),
      'condition_family':str(r.get('condition_family') or r.get('condition_text') or ''),
      'recent_form':_recent_form(prev.get('finishes',[])), 'agf':num(h.get('agf')),
      'tr_puan':tr,'ypuan':num(h.get('ypuan')),'g800':num(h.get('g800') or h.get('workout_800')),
      'surface_fit':surface_fit,'distance_fit':distance_fit,'jockey_power':jockey_power,'handicap_kg_score':handicap_kg,
      'champion_score':num(h.get('prediction_visible_tkp_snapshot') if h.get('prediction_visible_tkp_snapshot') is not None else h.get('pre_race_tkp_score')),
      'agf_rank':num(h.get('agf_rank')),'tr_rank':num(h.get('tr_rank')),'hndkp_rank':num(h.get('hndkp_rank')),
      'sp':num(h.get('sp')),'start_no':num(h.get('start_no')),'distance':d,
      'prior_starts':num(h.get('priorStarts'),prev.get('starts',0)),'prior_wins':num(h.get('priorWins'),prev.get('wins',0))
    }

def build_training_rows(races):
    rows=[]; state={}
    ordered=sorted(list(races or []),key=lambda r:(str(r.get('race_date') or ''),str(r.get('meeting_uid') or ''),num(r.get('leg')),num(r.get('id'))))
    for r in ordered:
        local=[]
        for h in r.get('horses') or []:
            row=_row_from(r,h,state); row['winner']=target(h); local.append((h,row)); rows.append(row)
        # Update history only after all rows in the race have been materialized.
        for h,row in local:
            name=str(h.get('horse_name') or '').strip().upper()
            s=state.setdefault(name,{'finishes':deque(maxlen=12),'surface':defaultdict(lambda:{'starts':0,'wins':0}),'distance':deque(maxlen=30),'starts':0,'wins':0})
            fp=int(num(h.get('finish_position'),99))
            if fp<99: s['finishes'].append(fp)
            surf=row['surface']; s['surface'][surf]['starts']+=1; s['surface'][surf]['wins']+=row['winner']
            s['distance'].append((row['distance'],row['winner'])); s['starts']+=1; s['wins']+=row['winner']
    df=pd.DataFrame(rows)
    if df.empty: return pd.DataFrame(columns=META_COLUMNS+FEATURE_COLUMNS+['winner'])
    return df

def prepare_live_rows(races):
    # Live records can only use pre-race fields already stored on the bulletin horse.
    rows=[]
    for r in races or []:
        for h in r.get('horses') or []:
            row=_row_from(r,h,{})
            # Use persisted pre-race aggregates when available.
            ps=num(h.get('priorStarts')); pw=num(h.get('priorWins'))
            if ps>0:
                row['recent_form']=max(0.05,min(0.95,(pw+0.75)/(ps+1.5)))
            rows.append(row)
    return pd.DataFrame(rows)
