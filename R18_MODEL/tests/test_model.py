import sys, unittest
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

class ModelStackTests(unittest.TestCase):
    def fixture(self):
        rows=[]
        for race_i in range(24):
            rk=f'r{race_i}'
            surf='KUM' if race_i%2==0 else 'ÇİM'
            dg='SHORT' if race_i%3 else 'MIDDLE'
            for h in range(3):
                rows.append(dict(race_key=rk,race_date=f'2026-01-{race_i+1:02d}',horse_no_text=str(h+1),horse_name=f'H{h+1}',surface=surf,distance_group=dg,
                    recent_form=.8-.2*h,agf=55-15*h,tr_puan=80-10*h,ypuan=75-8*h,g800=70-7*h,surface_fit=.7-.1*h,distance_fit=.65-.08*h,jockey_power=.6-.1*h,handicap_kg_score=.3-.05*h,
                    agf_rank=h+1,tr_rank=h+1,hndkp_rank=h+1,sp=3+2*h,start_no=h+1,distance=1400,leg=(race_i%6)+1,prior_starts=5,prior_wins=2-h/2,winner=1 if h==0 else 0))
        return pd.DataFrame(rows)

    def test_probabilities_sum_to_one_per_race(self):
        from tkp_r18_model import R18ModelStack
        df=self.fixture(); train=df[df.race_key.isin([f'r{i}' for i in range(18)])]; val=df[~df.index.isin(train.index)]
        m=R18ModelStack(min_expert_races=4,random_state=7).fit(train,val)
        scored=m.predict(val)
        sums=scored.groupby('race_key').win_probability.sum()
        self.assertTrue(((sums-1).abs()<1e-9).all())
        self.assertTrue({'market_probability','residual_score','expert_score','pairwise_score','win_probability'}.issubset(scored.columns))

    def test_unseen_race_type_falls_back_to_global(self):
        from tkp_r18_model import R18ModelStack
        df=self.fixture(); m=R18ModelStack(min_expert_races=4,random_state=7).fit(df)
        x=df[df.race_key=='r0'].copy(); x['surface']='SENTETİK'; x['distance_group']='LONG'; x['race_key']='new'
        scored=m.predict(x)
        self.assertEqual(len(scored),3)
        self.assertTrue(scored.expert_score.notna().all())

if __name__=='__main__': unittest.main()

class BlendPerformanceTests(unittest.TestCase):
    def test_blend_selection_computes_expensive_components_once(self):
        from tkp_r18_model import R18ModelStack
        m=R18ModelStack(); calls={'n':0}
        base=pd.DataFrame([
            {'race_key':'r1','winner':1,'market_probability':.6,'residual_score':.7,'expert_score':.65,'pairwise_score':.7},
            {'race_key':'r1','winner':0,'market_probability':.4,'residual_score':.3,'expert_score':.35,'pairwise_score':.3},
            {'race_key':'r2','winner':0,'market_probability':.45,'residual_score':.4,'expert_score':.42,'pairwise_score':.4},
            {'race_key':'r2','winner':1,'market_probability':.55,'residual_score':.6,'expert_score':.58,'pairwise_score':.6},
        ])
        def fake(_):
            calls['n']+=1
            return base.copy()
        m._component_scores=fake
        m._select_blend(base)
        self.assertEqual(calls['n'],1)

class PairwiseBuilderTests(unittest.TestCase):
    def test_pairwise_builder_creates_both_directions_without_rowwise_dataframes(self):
        from tkp_r18_model import _pairwise_training_frame
        df=ModelStackTests().fixture().query("race_key in ['r0','r1']")
        x,y=_pairwise_training_frame(df)
        self.assertEqual(len(x),8)  # 2 races * 2 losers * 2 directions
        self.assertEqual(int(y.sum()),4)
        self.assertEqual(list(x.columns),list(__import__('tkp_r18_model').PAIR_FEATURES))

class ChampionBlendTests(unittest.TestCase):
    def test_model_emits_champion_probability_component(self):
        from tkp_r18_model import R18ModelStack
        df=ModelStackTests().fixture().copy()
        df['champion_score']=[90,60,30]*24
        m=R18ModelStack(min_expert_races=4,random_state=7).fit(df)
        scored=m.predict(df[df.race_key=='r0'])
        self.assertIn('champion_probability',scored.columns)
        self.assertAlmostEqual(float(scored.champion_probability.sum()),1.0,places=9)
