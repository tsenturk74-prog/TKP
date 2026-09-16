#!/usr/bin/env python3
from __future__ import annotations
import math
import unicodedata
from collections import defaultdict, deque
import pandas as pd

FORBIDDEN_FIELDS={
    'winner','finish_position','result_rank','result_score','result_time','official_time','payouts',
    'pre_result_score','v27_backtest_rank','v27_backtest_score','sidebet_target_position'
}
FEATURE_COLUMNS=[
    'recent_form','agf','tr_puan','ypuan','g800','surface_fit','distance_fit','jockey_power','handicap_kg_score','champion_score',
    'agf_rank','tr_rank','hndkp_rank','sp','start_no','distance','leg','prior_starts','prior_wins',
    # Archived table statistics that were previously retained only for display.
    # They are pre-race fields and materially improve form/value/track modelling.
    'tr_ganyan','tr_ganyan_rank','g800_rank','jbyg','jbyg_rank','s_value','value_score','value_rank',
    'weight_kg','hndkp','workout_400','workout_600','workout_800',
    'jockey_win_pct','trainer_win_pct','owner_win_pct','team_strength_pct','team_strength_rank',
    'jockey_trainer_rank','gpr_starts','gpr_wins','gpr_strength','cond_win_starts','cond_win_wins',
    'cond_win_pct','cond_surprise_hits','best_lb','last3_form_score','track_type_win_rate',
    'distance_fit_score','jockey_form_30d','handicap_blend_score'
]
META_COLUMNS=['race_key','race_date','file_id','race_id','meeting_uid','altili_no','leg','horse_name','horse_no_text','surface','distance_group','condition_family']

def num(v, default=0.0):
    try:
        x=float(v)
        return x if math.isfinite(x) else default
    except Exception:
        return default

def _text(v):
    return str(v or '').strip()

def _identity(v):
    text=unicodedata.normalize('NFKD',_text(v)).encode('ascii','ignore').decode('ascii')
    return ' '.join(text.upper().split())

def _first(obj, *keys):
    for key in keys:
        value=obj.get(key)
        if value is not None and value!='':
            return value
    return None

def _horse_num(h, field):
    aliases={
        'cond_win_starts':('condWinStarts','condition_win_starts'),
        'cond_win_wins':('condWinWins','condition_win_wins'),
        'cond_win_pct':('condWinPct','condition_win_pct'),
        'cond_surprise_hits':('condSurpriseHits','condition_surprise_hits'),
        'best_lb':('bestLb','best_lb'),
        'last3_form_score':('last3_form_score','last3FormScore'),
        'track_type_win_rate':('track_type_win_rate','trackTypeWinRate'),
        'distance_fit_score':('distance_fit_score','distanceFitScore'),
        'jockey_form_30d':('jockey_form_30d','jockeyForm30d'),
        'handicap_blend_score':('handicap_blend_score','handicapBlendScore'),
    }
    return num(_first(h,field,*aliases.get(field,())),0.0)

def _flag(v):
    if isinstance(v,bool): return v
    return str(v or '').strip().lower() in {'1','true','yes','y','evet','kazandi','winner'}

def _verified_result(race, horses):
    """Accept legacy rows, but honor explicit archive verification/quarantine flags."""
    status=_text(_first(race,'result_integrity_status','result_status','qc_status')).upper()
    if status and any(x in status for x in ('QUARANT','REJECT','INVALID','CONFLICT','BEKLEY','PENDING')):
        return False
    explicit=_first(race,'result_verified','results_verified','official_result_verified','verified')
    if explicit is not None and not _flag(explicit):
        return False
    winners=[h for h in horses if int(num(h.get('winner'),0))==1 or num(h.get('finish_position'),999)==1]
    return len(winners)==1

def normalize_race(race, source='races'):
    """Map archive/table aliases into the canonical race shape."""
    r=dict(race or {})
    r['source_table']=_text(r.get('source_table') or source) or source
    r['id']=_first(r,'id','race_id','raceId') or ''
    r['file_id']=_first(r,'file_id','fileId','source_file_id') or ''
    r['race_date']=_first(r,'race_date','date','raceDate') or ''
    r['hippodrome']=_first(r,'hippodrome','track','venue') or ''
    r['meeting_uid']=_first(r,'meeting_uid','meetingUid','meeting_id','meetingId') or ''
    r['leg']=_first(r,'leg','leg_no','legNo','race_no','raceNo') or 0
    r['distance']=_first(r,'distance','distance_m','meters') or 0
    r['surface']=_first(r,'surface','track_surface','pist') or 'UNKNOWN'
    r['condition_family']=_first(r,'condition_family','condition_text','condition') or ''
    horses=r.get('horses')
    if not isinstance(horses,list):
        horses=r.get('rows') if isinstance(r.get('rows'),list) else []
    normalized=[]
    for horse in horses:
        h=dict(horse or {})
        h['horse_name']=_first(h,'horse_name','horse','name','at_adi') or ''
        h['horse_id']=_first(h,'horse_id','horseId','id') or ''
        h['horse_no']=_first(h,'horse_no','horseNo','no','program_no') or ''
        h['finish_position']=_first(h,'finish_position','result_position','official_position','place','finish') 
        winner=_first(h,'winner','is_winner','won')
        h['winner']=1 if _flag(winner) or num(h.get('finish_position'),999)==1 else 0
        normalized.append(h)
    r['horses']=normalized
    return r

def canonicalize_collections(collections):
    """Merge race-like tables and return provenance/audit without future leakage."""
    seen={}; audit={'tables_seen':0,'races_seen':0,'races_accepted':0,'horses_seen':0,
                   'horses_accepted':0,'unlabeled_races':0,'duplicates':0,'sources':{}}
    for source, values in (collections or {}).items():
        if not isinstance(values,list):
            continue
        audit['tables_seen']+=1
        source_stats=audit['sources'].setdefault(str(source),{'rows':0,'races':0,'accepted':0,'horses':0})
        for raw in values:
            if not isinstance(raw,dict): continue
            race=normalize_race(raw,source)
            if not race['horses']: continue
            race['result_verified_for_training']=_verified_result(race,race['horses'])
            source_stats['rows']+=1; source_stats['races']+=1
            audit['races_seen']+=1; audit['horses_seen']+=len(race['horses'])
            key=race_key(race)
            if key in seen:
                audit['duplicates']+=1
                previous=seen[key]
                prev_sig=tuple(sorted((str(h.get('horse_no')),int(h.get('winner') or 0),str(h.get('finish_position') or '')) for h in previous.get('horses',[])))
                next_sig=tuple(sorted((str(h.get('horse_no')),int(h.get('winner') or 0),str(h.get('finish_position') or '')) for h in race.get('horses',[])))
                if prev_sig!=next_sig:
                    audit['conflicting_duplicates']=audit.get('conflicting_duplicates',0)+1
                    previous['result_verified_for_training']=False
                continue
            if not race['result_verified_for_training']:
                audit['unlabeled_races']+=1
            seen[key]=race; source_stats['accepted']+=1
            audit['races_accepted']+=1; audit['horses_accepted']+=len(race['horses'])
    audit['verified_races']=sum(1 for r in seen.values() if r.get('result_verified_for_training'))
    audit['label_coverage']=(audit['verified_races'] / len(seen)) if seen else 0.0
    return list(seen.values()),audit

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
    name=_identity(h.get('horse_id') or h.get('horse_name'))
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
    row={
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
    for field in FEATURE_COLUMNS:
        if field not in row and field!='champion_score':
            row[field]=_horse_num(h,field)
    return row

def build_training_rows(races):
    rows=[]; state={}
    ordered=sorted(list(races or []),key=lambda r:(str(r.get('race_date') or ''),str(r.get('meeting_uid') or ''),num(r.get('leg')),num(r.get('id'))))
    for r in ordered:
        local=[]
        for h in r.get('horses') or []:
            row=_row_from(r,h,state); row['winner']=target(h); local.append((h,row)); rows.append(row)
        # Update history only after all rows in the race have been materialized.
        for h,row in local:
            name=_identity(h.get('horse_id') or h.get('horse_name'))
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
    # Prefer persisted pre-race aggregates when available.  Rebuilding a row with
    # an empty history otherwise silently turns trained signals into 0.5 defaults.
    rows=[]
    for r in races or []:
        for h in r.get('horses') or []:
            row=_row_from(r,h,{})
            aliases={
                'recent_form': ('recent_form','form_index','formScore','recentForm'),
                'surface_fit': ('surface_fit','pist_form','surfaceForm'),
                'distance_fit': ('distance_fit','mesafe_form','distanceForm'),
                'jockey_power': ('jockey_power','jockeyPower'),
                'handicap_kg_score': ('handicap_kg_score','handicapKgScore'),
            }
            for field, keys in aliases.items():
                value=_first(h,*keys)
                if value is not None:
                    row[field]=num(value,row[field])
            for field, keys in {
                'agf_rank': ('agf_rank','agfRank'),
                'tr_rank': ('tr_rank','trRank'),
                'hndkp_rank': ('hndkp_rank','hndkpRank'),
                'prior_starts': ('prior_starts','priorStarts'),
                'prior_wins': ('prior_wins','priorWins'),
            }.items():
                value=_first(h,*keys)
                if value is not None:
                    row[field]=num(value,row[field])
            # Use persisted counts only when no explicit pre-race form exists.
            ps=num(h.get('priorStarts')); pw=num(h.get('priorWins'))
            explicit_form=_first(h,'recent_form','form_index','formScore','recentForm')
            if explicit_form is None and ps>0:
                row['recent_form']=max(0.05,min(0.95,(pw+0.75)/(ps+1.5)))
            rows.append(row)
    return pd.DataFrame(rows)
