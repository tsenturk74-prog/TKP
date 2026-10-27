import sys, unittest
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT))

class CouponTests(unittest.TestCase):
    def scored(self):
        rows=[]
        for leg in range(1,7):
            probs=[.45,.25,.15,.09,.06]
            for i,p in enumerate(probs):
                rows.append({'race_key':f'r{leg}','leg':leg,'horse_no_text':str(i+1),'horse_name':f'H{i+1}',
                    'calibrated_probability':p,'mc_win_rate':p,'market_probability':[.55,.18,.12,.09,.06][i],
                    'value_score':p/max([.55,.18,.12,.09,.06][i],.01),'tr_puan':80-5*i,'ypuan':75-3*i,'g800':70-2*i,'jockey_power':.7-.05*i})
        return pd.DataFrame(rows)

    def test_coupon_respects_budget_and_has_one_or_two_singles(self):
        from tkp_r18_coupon import optimize_meeting
        c=optimize_meeting(self.scored(),family='normal',budget=1500)
        self.assertLessEqual(c['cost'],1500)
        self.assertIn(c['singles'],(1,2))
        self.assertEqual(len(c['legs']),6)
        self.assertTrue(all(len(x['picks'])>=1 for x in c['legs']))

    def test_surprise_and_expert_use_distinct_family_scores(self):
        from tkp_r18_coupon import optimize_meeting
        df=self.scored()
        normal=optimize_meeting(df,'normal',1500)
        surprise=optimize_meeting(df,'surprise',1500,avoid=normal)
        expert=optimize_meeting(df,'expert',1500,avoid=normal)
        self.assertEqual(surprise['family'],'surprise')
        self.assertEqual(expert['family'],'expert')
        self.assertNotEqual(surprise['signature'],normal['signature'])

if __name__=='__main__': unittest.main()

class CouponPerformanceTests(unittest.TestCase):
    def test_optimizer_does_not_require_cartesian_product_enumeration(self):
        import tkp_r18_coupon as mod
        original=mod.itertools.product
        def forbidden(*a,**k):
            raise AssertionError('cartesian enumeration forbidden')
        mod.itertools.product=forbidden
        try:
            c=mod.optimize_meeting(CouponTests().scored(),'normal',1500)
            self.assertLessEqual(c['cost'],1500)
        finally:
            mod.itertools.product=original

class CouponFrontierTests(unittest.TestCase):
    def test_prune_states_removes_costlier_lower_objective_states(self):
        from tkp_r18_coupon import _prune_states
        states={(10,1):(1.0,(2,),.5),(12,1):(.9,(3,),.6),(15,1):(1.2,(4,),.7),(8,2):(.5,(1,),.4)}
        p=_prune_states(states)
        self.assertIn((10,1),p)
        self.assertNotIn((12,1),p)
        self.assertIn((15,1),p)
        self.assertIn((8,2),p)

class R182NormalStrategyTests(unittest.TestCase):
    def test_r18_2_normal_probability_preserves_champion_or_challenger_strength(self):
        from tkp_r18_coupon import r18_2_normal_frame
        df=pd.DataFrame([
            {'race_key':'r1','leg':1,'horse_no_text':'1','calibrated_probability':.60,'champion_probability':.10,'mc_win_rate':.60},
            {'race_key':'r1','leg':1,'horse_no_text':'2','calibrated_probability':.10,'champion_probability':.60,'mc_win_rate':.10},
            {'race_key':'r1','leg':1,'horse_no_text':'3','calibrated_probability':.30,'champion_probability':.30,'mc_win_rate':.30},
        ])
        out=r18_2_normal_frame(df)
        probs=dict(zip(out.horse_no_text,out.calibrated_probability))
        self.assertAlmostEqual(sum(probs.values()),1.0,places=9)
        self.assertGreater(probs['1'],probs['3'])
        self.assertGreater(probs['2'],probs['3'])
        self.assertEqual(set(out['normal_strategy']),{'R18_2_MAX_DISAGREEMENT'})

    def test_portfolio_publishes_r18_2_normal_strategy(self):
        from tkp_r18_coupon import optimize_portfolio
        df=CouponTests().scored().copy()
        df['champion_probability']=df['calibrated_probability']
        port=optimize_portfolio(df,budget=1500)
        self.assertEqual(port['normal']['strategy'],'R18_2_MAX_DISAGREEMENT')
        self.assertLessEqual(port['normal']['cost'],1500)
