import unittest
from unittest.mock import patch
import pandas as pd

class FakeModel:
    def predict(self, df):
        out=df.copy()
        # deterministic per-race probabilities from horse number order
        vals=[]
        for _,g in out.groupby('race_key',sort=False):
            n=len(g); raw=list(range(n,0,-1)); s=sum(raw); vals.extend([x/s for x in raw])
        out['market_probability']=out.get('agf',0)
        out['residual_score']=0.5
        out['expert_score']=0.5
        out['pairwise_score']=0.5
        out['champion_probability']=0.5
        out['win_probability']=vals
        out['value_score']=1.0
        out['model_source']='test'
        return out

class FakeCal:
    def transform(self, df):
        out=df.copy(); out['calibrated_probability']=out['win_probability']; return out

class ServiceTests(unittest.TestCase):
    def test_invalid_schema_is_rejected(self):
        from tkp_r18_service import score_payload
        with self.assertRaises(ValueError):
            score_payload(FakeModel(),FakeCal(),{}, {'schema':'wrong','races':[]}, simulations=10)

    @patch('tkp_r18_service.monte_carlo_races')
    @patch('tkp_r18_service.prepare_live_rows')
    def test_predict_contract_and_shadow_gate(self,prep,mc):
        from tkp_r18_service import score_payload,SCHEMA_IN,SCHEMA_OUT
        prep.return_value=pd.DataFrame([
            {'race_key':'r1','race_date':'2026-09-14','file_id':1,'race_id':1,'meeting_uid':'m','altili_no':2,'leg':1,'horse_name':'A','horse_no_text':'1','surface':'KUM','distance_group':'SHORT','condition_family':'','agf':60},
            {'race_key':'r1','race_date':'2026-09-14','file_id':1,'race_id':1,'meeting_uid':'m','altili_no':2,'leg':1,'horse_name':'B','horse_no_text':'2','surface':'KUM','distance_group':'SHORT','condition_family':'','agf':40},
        ])
        def _mc(df,simulations,seed):
            out=df.copy(); out['mc_win_rate']=out['calibrated_probability']; out['confidence_low']=0.1; out['confidence_high']=0.9; out['uncertainty']=0.2; out['mc_simulations']=simulations; return out
        mc.side_effect=_mc
        gate={'normal':{'pass':False,'production_pass':False},'surprise':{'pass':False,'production_pass':False},'expert':{'pass':False,'production_pass':False},'production_pass':False}
        out=score_payload(FakeModel(),FakeCal(),gate,{'schema':SCHEMA_IN,'races':[{'id':1}]},simulations=10000)
        self.assertEqual(out['schema'],SCHEMA_OUT)
        self.assertFalse(out['promotion_gate']['production_pass'])
        self.assertEqual(len(out['rows']),2)
        self.assertEqual(out['rows'][0]['mc_simulations'],10000)
        self.assertIn('win_probability',out['rows'][0])
        self.assertIn('value_score',out['rows'][0])

if __name__=='__main__': unittest.main()
