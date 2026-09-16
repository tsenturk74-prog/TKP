import math
import pandas as pd
from tkp_r17_autogluon import (
    build_rows, temporal_split, normalize_race_probabilities, FEATURE_COLUMNS, CATEGORICAL_FEATURES,
    DYNAMIC_FORM_FEATURES, prepare_training_frame, prepare_live_frame, build_form_index,
)


def _races():
    out=[]
    for d in range(1,11):
        horses=[]
        for n in range(1,4):
            horses.append({
                'horse_no':str(n),'horse_name':f'H{n}','winner':1 if n==1 else 0,
                'finish_position':n,'result_time':'1.23.45','official_time':'1.23.45',
                'agf':20-n,'tr':10+n,'sp':50+n,'g800':n,'jbyg':n,'tr_puan':80-n,
                'ypuan':60-n,'s_value':40-n,'value_score':30-n,'start_no':n,'weight_kg':56+n,
                'score':0.8-(n*.1),'tkp_display_score':0.9-(n*.1),
                'prediction_visible_tkp_snapshot':0.9-(n*.1),
                'accurate_avg_speed_mps':15+n/10,'accurate_finish_signal':0.6-n/20,
                'jockey_name':f'J{n}','trainer_name':f'T{n}','owner_name':f'O{n}',
                'priorStarts':10+n,'priorWins':2,'priorAccurateStarts':5,
                '_training_backfill':{'fields':{'ypuan':'same_horse_previous'}} if d<5 else None,
            })
        out.append({
            'race_date':f'2026-01-{d:02d}','hippodrome':'X','surface':'KUM','breed':'ARAP',
            'distance':1200+d*10,'condition_family':'H4','condition_text':'Handikap 4',
            'leg':1,'file_id':d,'id':d,'horses':horses,'payouts':{'x':999}
        })
    return out


def test_build_rows_has_binary_target_and_no_result_leakage():
    df=build_rows(_races())
    assert len(df)==30
    assert set(df['winner'].unique())=={0,1}
    forbidden={'finish_position','result_time','official_time','payouts','winner_source'}
    assert not forbidden.intersection(FEATURE_COLUMNS)
    assert not forbidden.intersection(df.columns.difference(['winner']))
    assert 'backfill_fraction' in df.columns
    assert df['race_key'].nunique()==10


def test_post_race_accurate_gps_fields_excluded_from_features():
    """R17.9 audit (2026-09-14): accurate_avg_speed_mps/accurate_closing_speed_mps/
    accurate_max_speed_mps/accurate_finish_signal yalnız SONUÇLA birlikte, yarış
    bittikten SONRA toplanır (bkz. stats-engine.js 2026-08-09 KÖK DÜZELTME).
    Bunlar ham haliyle asla FEATURE_COLUMNS'a giremez; yalnız sızıntısız
    öncül (prior*) türevleri kullanılabilir. Bu regresyon aynı hatanın
    Python eğitim pipeline'ında tekrar edilmesini engeller."""
    from tkp_r17_autogluon import LEAK_FIELDS
    post_race_gps={'accurate_avg_speed_mps','accurate_closing_speed_mps','accurate_max_speed_mps','accurate_finish_signal'}
    assert not post_race_gps.intersection(FEATURE_COLUMNS),'yarış-sonrası GPS alanları özellik listesinde olmamalı'
    assert post_race_gps.issubset(LEAK_FIELDS),'yarış-sonrası GPS alanları LEAK_FIELDS içinde belgelenmeli'
    df=build_rows(_races())
    assert not post_race_gps.intersection(df.columns),'yarış-sonrası GPS alanları eğitim satırlarına hiç girmemeli'
    # Sızıntısız öncül türevleri hâlâ kullanılabilir olmalı.
    assert {'priorAccurateAvgSpeed','priorAccurateFinishSignal','priorAccurateStarts'}.issubset(FEATURE_COLUMNS)


def test_temporal_split_is_chronological_and_non_overlapping():
    df=build_rows(_races())
    train,val,hold=temporal_split(df,val_fraction=.2,holdout_fraction=.2)
    assert len(train)>0 and len(val)>0 and len(hold)>0
    assert train['race_date'].max() < val['race_date'].min()
    assert val['race_date'].max() < hold['race_date'].min()
    assert set(train['race_key']).isdisjoint(set(val['race_key']))
    assert set(val['race_key']).isdisjoint(set(hold['race_key']))


def test_normalize_race_probabilities_sums_to_one_per_race():
    df=pd.DataFrame({'race_key':['A','A','B','B','B'],'raw_p':[.2,.6,.1,.1,.3]})
    out=normalize_race_probabilities(df,'raw_p','p_win')
    sums=out.groupby('race_key')['p_win'].sum().to_dict()
    assert abs(sums['A']-1)<1e-12
    assert abs(sums['B']-1)<1e-12
    assert all(math.isfinite(x) and 0<=x<=1 for x in out['p_win'])


def test_prepare_training_frame_drops_races_without_exactly_one_winner_and_fills_features():
    from tkp_r17_autogluon import prepare_training_frame
    races=_races()
    races.append({
      'race_date':'2026-01-11','hippodrome':'X','surface':'KUM','breed':'ARAP','distance':1300,'leg':1,'id':99,
      'horses':[{'horse_no':'1','horse_name':'NORESULT','winner':0,'agf':None},{'horse_no':'2','horse_name':'NORESULT2','winner':0,'agf':None}]
    })
    raw=build_rows(races)
    df,quality=prepare_training_frame(raw)
    assert df['race_key'].nunique()==10
    assert quality['dropped_invalid_target_races']==1
    assert int(df[FEATURE_COLUMNS].isna().sum().sum())==0
    assert not (df[CATEGORICAL_FEATURES]=='').any().any()

def test_prepare_live_frame_uses_same_feature_contract_without_targets():
    from tkp_r17_autogluon import prepare_live_frame
    races=[{
      'race_uid':'LIVE1','race_date':'2026-09-13','hippodrome':'İstanbul','surface':'ÇİM','breed':'İNGİLİZ',
      'distance':1400,'leg':2,'horses':[
        {'horse_no':'1','horse_name':'A','agf':31.2,'weight_kg':61,'jockey_name':'J1'},
        {'horse_no':'2','horse_name':'B','agf':None,'weight_kg':55,'jockey_name':''}
      ]
    }]
    live,quality=prepare_live_frame(races)
    assert list(live['race_key'].unique())==['LIVE1']
    assert len(live)==2
    assert 'winner' not in live.columns
    assert int(live[FEATURE_COLUMNS].isna().sum().sum())==0
    assert not (live[CATEGORICAL_FEATURES]=='').any().any()
    assert quality['rows']==2 and quality['races']==1


def test_bankroll_metrics_and_portfolio_reports_use_real_cost_return():
    from tkp_r17_autogluon import bankroll_metrics, sidebet_portfolio_report, actual_altili_report
    m=bankroll_metrics([{'cost':10,'return':0},{'cost':10,'return':30},{'cost':20,'return':0}])
    assert m['cost']==40
    assert m['return']==30
    assert m['net']==-10
    assert round(m['roi_pct'],6)==-25.0
    assert m['max_drawdown']>=10
    assert m['longest_losing_streak']>=1

    side=sidebet_portfolio_report([
      {'product':'sirali_ikili','primary':1,'variant':'primary','evaluation':{'known':1,'cost':10,'return':20,'hit':1}},
      {'product':'sirali_ikili','primary':1,'variant':'primary','evaluation':{'known':1,'cost':10,'return':0,'hit':0}},
      {'product':'tabela','primary':1,'variant':'primary','evaluation':{'known':1,'cost':5,'return':0,'hit':0}},
    ])
    assert side['overall']['tickets']==3
    assert side['overall']['cost']==25
    assert 'sirali_ikili' in side['by_product']

    alt=actual_altili_report([
      {'betGameType':'altili','cost':100,'payout':150,'date':'2026-01-01'},
      {'betGameType':'besli','cost':100,'payout':999,'date':'2026-01-01'},
      {'betGameType':'altili','cost':50,'payout':0,'date':'2026-01-02'},
    ])
    assert alt['tickets']==2
    assert alt['cost']==150
    assert alt['return']==150
    assert alt['roi_pct']==0


def test_model_ganyan_roi_compares_ranked_pick_to_official_payout():
    from tkp_r17_autogluon import model_ganyan_roi
    df=pd.DataFrame([
      {'race_key':'R1','horse_no_text':'1','winner':1,'p':0.7},
      {'race_key':'R1','horse_no_text':'2','winner':0,'p':0.3},
      {'race_key':'R2','horse_no_text':'3','winner':0,'p':0.8},
      {'race_key':'R2','horse_no_text':'4','winner':1,'p':0.2},
    ])
    payout_map={'R1':{'1':4.0},'R2':{'4':10.0}}
    r=model_ganyan_roi(df,'p',payout_map)
    assert r['bets']==2
    assert r['hits']==1
    assert r['cost']==2.0
    assert r['return']==4.0
    assert r['roi_pct']==100.0


def test_combined_portfolio_report_contains_altili_and_sidebet():
    from tkp_r17_autogluon import combined_portfolio_report
    report=combined_portfolio_report(
      bets=[{'betGameType':'altili','cost':100,'payout':150,'date':'2026-01-01'}],
      sidebet_tickets=[{'product':'cifte','primary':1,'variant':'primary','evaluation':{'known':1,'cost':10,'return':20,'hit':1}}]
    )
    assert report['altili']['cost']==100
    assert report['sidebets']['overall']['cost']==10
    assert report['combined']['cost']==110
    assert report['combined']['return']==170


def test_race_key_meeting_uid_fallback_is_race_specific():
    from tkp_r17_autogluon import race_key
    base={'meeting_uid':'MEET1','race_date':'2026-09-13','hippodrome':'IST','file_id':1}
    r1={**base,'id':101,'leg':1}
    r2={**base,'id':102,'leg':2}
    assert race_key(r1) != race_key(r2)
    assert 'MEET1' in race_key(r1)


def _causal_races():
    """H1 her koşuyu kazanır; H2..H4 hiç kazanmaz. Yüzey d%2==0 ise KUM, aksi
    halde ÇİM. Jokey J1 -> H1/H3, J0 -> H2/H4. handikap sıraları at no ile aynı."""
    out=[]
    for d in range(1,8):
        horses=[]
        for n in range(1,5):
            horses.append({
                'horse_no':str(n),'horse_name':f'H{n}','winner':1 if n==1 else 0,'finish_position':n,
                'agf':20-n,'agf_rank':n,'hndkp_rank':n,'tr_rank':n,'jbyg_rank':n,
                'jockey_name':f'J{n%2}','trainer_name':'T',
            })
        out.append({
            'race_date':f'2026-01-{d:02d}','hippodrome':'X','surface':'KUM' if d%2==0 else 'ÇİM','breed':'ARAP',
            'distance_group':'ORTA','distance':1400,'leg':1,'file_id':d,'id':d,'horses':horses,
        })
    return out


def test_dynamic_form_features_are_causal_no_same_race_leakage():
    df=build_rows(_causal_races())
    first=df[df['race_date']=='2026-01-01']
    # İlk koşuda hiçbir at/jokey için geçmiş yok: hepsi nötr (0.0) olmalı.
    assert (first['last3_form_score']==0.0).all()
    assert (first['track_type_win_rate']==0.0).all()
    assert (first['distance_fit_score']==0.0).all()
    assert (first['jockey_form_30d']==0.0).all()
    # İkinci koşuda H1 (1 önceki galibiyet/1 önceki koşu) last3_form_score=1.0 olmalı.
    second_h1=df[(df['race_date']=='2026-01-02')&(df['horse_name']=='H1')].iloc[0]
    assert abs(second_h1['last3_form_score']-1.0)<1e-9
    assert int(df[DYNAMIC_FORM_FEATURES].isna().sum().sum())==0


def test_handicap_blend_score_uses_only_current_row_ranks():
    df=build_rows(_causal_races())
    row=df[(df['race_date']=='2026-01-01')&(df['horse_name']=='H1')].iloc[0]
    # rank=1 (en iyi), 4 atlı koşuda normalize edilmiş üst sınır 1.0 olmalı.
    assert abs(row['handicap_blend_score']-1.0)<1e-9
    last=df[(df['race_date']=='2026-01-01')&(df['horse_name']=='H4')].iloc[0]
    assert abs(last['handicap_blend_score']-0.0)<1e-9


def test_form_index_projects_latest_state_for_unseen_future_race():
    raw=build_rows(_causal_races())
    df,_q=prepare_training_frame(raw)
    idx=build_form_index(df)
    assert idx['horse']['H1']['last3_form_score']==1.0
    assert idx['jockey']['J1']['jockey_form_30d']==0.5
    live=[{
        'race_uid':'LIVE8','race_date':'2026-01-08','hippodrome':'X','surface':'KUM','distance_group':'ORTA',
        'distance':1400,'leg':1,
        'horses':[{'horse_no':str(n),'horse_name':f'H{n}','agf':20-n,'agf_rank':n,'hndkp_rank':n,'tr_rank':n,
                   'jbyg_rank':n,'jockey_name':f'J{n%2}'} for n in range(1,5)]
    }]
    live_df,_quality=prepare_live_frame(live,form_index=idx)
    h1=live_df[live_df['horse_name']=='H1'].iloc[0]
    assert abs(h1['last3_form_score']-1.0)<1e-9
    assert abs(h1['jockey_form_30d']-0.5)<1e-9
    unknown=live_df.copy()
    assert int(unknown[DYNAMIC_FORM_FEATURES].isna().sum().sum())==0


def test_form_index_neutral_for_unseen_horse_and_jockey():
    raw=build_rows(_causal_races())
    df,_q=prepare_training_frame(raw)
    idx=build_form_index(df)
    live=[{
        'race_uid':'LIVE_NEW','race_date':'2026-01-08','hippodrome':'X','surface':'KUM','distance_group':'ORTA',
        'distance':1400,'leg':1,
        'horses':[{'horse_no':'9','horse_name':'YENİ_AT','agf':10,'agf_rank':1,'jockey_name':'YENİ_JOKEY'}]
    }]
    live_df,_quality=prepare_live_frame(live,form_index=idx)
    row=live_df.iloc[0]
    assert row['last3_form_score']==0.0
    assert row['jockey_form_30d']==0.0


def test_historical_model_gate_is_not_automatic_production_promotion():
    from tkp_r17_autogluon import promotion_gate_decision
    c={'log_loss':.20,'brier':.06,'top1_hit':.45}
    b={'log_loss':.27,'brier':.08,'top1_hit':.30}
    c_roi={'bets':464,'roi_pct':150}
    b_roi={'bets':464,'roi_pct':2}
    gate=promotion_gate_decision(c,b,c_roi,b_roi,historical_provenance_ok=False)
    assert gate['pass'] is True
    assert gate['production_pass'] is False
    assert gate['provenance_pass'] is False
    override=promotion_gate_decision(c,b,c_roi,b_roi,historical_provenance_ok=False,allow_historical_production=True)
    assert override['production_pass'] is True
