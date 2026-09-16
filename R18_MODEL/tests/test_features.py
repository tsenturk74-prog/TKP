import sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

class FeatureContractTests(unittest.TestCase):
    def test_canonicalizer_merges_tables_and_normalizes_result_aliases(self):
        from tkp_r18_features import canonicalize_collections
        races,audit=canonicalize_collections({
            'races':[{'race_id':'A','date':'2026-01-01','horses':[
                {'horseId':'h1','name':'Şampiyon At','official_position':1},
                {'horseId':'h2','name':'Diger','place':2}]}],
            'side_table':[{'race_id':'A','date':'2026-01-01','horses':[
                {'horseId':'h1','name':'Şampiyon At','place':1}]}],
            'partial':[{'race_id':'B','date':'2026-01-02','horses':[
                {'horseId':'h3','name':'Yeni At','result_position':1}]}],
        })
        self.assertEqual(len(races),2)
        self.assertEqual(audit['duplicates'],1)
        self.assertEqual(audit['races_accepted'],2)
        self.assertEqual(races[0]['horses'][0]['winner'],1)

    def test_incomplete_meeting_can_train_as_race(self):
        from tkp_r18_backtest import _valid_training_frame
        df=_valid_training_frame([{'id':'one','race_date':'2026-01-01','meeting_uid':'M','leg':1,'horses':[
            {'horse_name':'A','finish_position':1},{'horse_name':'B','finish_position':2}]}])
        self.assertEqual(df.race_key.nunique(),1)

    def test_feature_contract_exposes_required_signals_and_no_result_fields(self):
        from tkp_r18_features import FEATURE_COLUMNS, FORBIDDEN_FIELDS
        required={'recent_form','agf','tr_puan','ypuan','g800','surface_fit','distance_fit','jockey_power','handicap_kg_score'}
        self.assertTrue(required.issubset(set(FEATURE_COLUMNS)))
        self.assertTrue({'winner','finish_position','result_score','payouts'}.issubset(set(FORBIDDEN_FIELDS)))
        self.assertFalse(set(FEATURE_COLUMNS)&set(FORBIDDEN_FIELDS))

    def test_conflicting_duplicate_results_are_quarantined(self):
        from tkp_r18_features import canonicalize_collections
        races,audit=canonicalize_collections({
            'a':[{'race_id':'D','horses':[{'horse_no':'1','finish_position':1},{'horse_no':'2','finish_position':2}]}],
            'b':[{'race_id':'D','horses':[{'horse_no':'1','finish_position':2},{'horse_no':'2','finish_position':1}]}],
        })
        self.assertEqual(audit['conflicting_duplicates'],1)
        self.assertFalse(races[0]['result_verified_for_training'])

    def test_build_training_rows_uses_history_only(self):
        from tkp_r18_features import build_training_rows
        races=[
          {'id':1,'race_date':'2026-01-01','hippodrome':'X','leg':1,'distance':1200,'surface':'Kum','horses':[
            {'horse_no':'1','horse_name':'A','agf':30,'tr':60,'ypuan':70,'g800':50,'jbyg':40,'hndkp':55,'weight_kg':58,'winner':1,'finish_position':1},
            {'horse_no':'2','horse_name':'B','agf':70,'tr':50,'ypuan':60,'g800':48,'jbyg':35,'hndkp':50,'weight_kg':57,'winner':0,'finish_position':2}]},
          {'id':2,'race_date':'2026-01-02','hippodrome':'X','leg':1,'distance':1200,'surface':'Kum','horses':[
            {'horse_no':'1','horse_name':'A','agf':35,'tr':62,'ypuan':72,'g800':51,'jbyg':41,'hndkp':56,'weight_kg':58,'winner':0,'finish_position':2},
            {'horse_no':'2','horse_name':'B','agf':65,'tr':49,'ypuan':59,'g800':49,'jbyg':36,'hndkp':51,'weight_kg':57,'winner':1,'finish_position':1}]},
        ]
        df=build_training_rows(races)
        second=df[df.race_key.str.contains('2026-01-02')]
        a=second[second.horse_name=='A'].iloc[0]
        self.assertAlmostEqual(float(a['recent_form']),1.0,places=6)
        self.assertNotIn('finish_position',df.columns)
        self.assertIn('winner',df.columns)

    def test_zero_frozen_champion_score_never_falls_back_to_mutable_score(self):
        from tkp_r18_features import build_training_rows
        races=[{'id':1,'race_date':'2026-01-01','hippodrome':'X','leg':1,'horses':[
          {'horse_no':'1','horse_name':'A','prediction_visible_tkp_snapshot':0,'tkp_display_score':99,'score':123,'winner':1},
          {'horse_no':'2','horse_name':'B','prediction_visible_tkp_snapshot':10,'tkp_display_score':88,'score':77,'winner':0}]}]
        df=build_training_rows(races)
        self.assertEqual(float(df[df.horse_name=='A'].iloc[0].champion_score),0.0)

if __name__=='__main__': unittest.main()

class ChampionSignalTests(unittest.TestCase):
    def test_existing_champion_score_is_available_as_prerace_feature(self):
        from tkp_r18_features import FEATURE_COLUMNS, build_training_rows
        self.assertIn('champion_score',FEATURE_COLUMNS)
        races=[{'id':1,'race_date':'2026-01-01','hippodrome':'X','leg':1,'horses':[{'horse_no':'1','horse_name':'A','prediction_visible_tkp_snapshot':88,'tkp_display_score':999,'winner':1},{'horse_no':'2','horse_name':'B','prediction_visible_tkp_snapshot':55,'tkp_display_score':999,'winner':0}]}]
        df=build_training_rows(races)
        self.assertEqual(float(df[df.horse_name=='A'].iloc[0].champion_score),88.0)

class LiveFeaturePreservationTests(unittest.TestCase):
    def test_live_rows_preserve_persisted_pre_race_aggregates(self):
        from tkp_r18_features import prepare_live_rows
        rows=prepare_live_rows([{
            'id':'live-1','race_date':'2026-09-16','meeting_uid':'M',
            'leg':1,'distance':1400,'surface':'KUM',
            'horses':[{
                'horse_no':'1','horse_name':'A','agf':30,
                'recent_form':0.82,'surface_fit':0.71,'distance_fit':0.64,
                'jockey_power':0.58,'handicap_kg_score':0.44,
                'priorStarts':12,'priorWins':4,
            }]
        }])
        row=rows.iloc[0]
        self.assertAlmostEqual(float(row['recent_form']),0.82)
        self.assertAlmostEqual(float(row['surface_fit']),0.71)
        self.assertAlmostEqual(float(row['distance_fit']),0.64)
        self.assertAlmostEqual(float(row['jockey_power']),0.58)
        self.assertAlmostEqual(float(row['handicap_kg_score']),0.44)

    def test_live_form_falls_back_to_counts_when_not_persisted(self):
        from tkp_r18_features import prepare_live_rows
        rows=prepare_live_rows([{
            'id':'live-2','race_date':'2026-09-16','meeting_uid':'M',
            'leg':1,'horses':[{'horse_no':'1','horse_name':'A',
                              'priorStarts':8,'priorWins':4}]
        }])
        self.assertAlmostEqual(float(rows.iloc[0]['recent_form']),4.75/9.5)
