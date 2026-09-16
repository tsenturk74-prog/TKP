import sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

class FeatureContractTests(unittest.TestCase):
    def test_feature_contract_exposes_required_signals_and_no_result_fields(self):
        from tkp_r18_features import FEATURE_COLUMNS, FORBIDDEN_FIELDS
        required={'recent_form','agf','tr_puan','ypuan','g800','surface_fit','distance_fit','jockey_power','handicap_kg_score'}
        self.assertTrue(required.issubset(set(FEATURE_COLUMNS)))
        self.assertTrue({'winner','finish_position','result_score','payouts'}.issubset(set(FORBIDDEN_FIELDS)))
        self.assertFalse(set(FEATURE_COLUMNS)&set(FORBIDDEN_FIELDS))

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
