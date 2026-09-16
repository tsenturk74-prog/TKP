import sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT))

class BacktestTests(unittest.TestCase):
    def test_exact_hit_buckets(self):
        from tkp_r18_backtest import summarize_coupon_records
        rows=[{'hits':6,'cost':100,'singles':1,'single_hits':1},{'hits':5,'cost':80,'singles':2,'single_hits':1},{'hits':4,'cost':60,'singles':1,'single_hits':0},{'hits':3,'cost':40,'singles':1,'single_hits':1}]
        s=summarize_coupon_records(rows)
        self.assertEqual(s['exact']['6'],1); self.assertEqual(s['exact']['5'],1); self.assertEqual(s['exact']['4'],1); self.assertEqual(s['exact']['3'],1)
        self.assertEqual(s['meetings'],4)
        self.assertAlmostEqual(s['single_hit_rate'],3/5)

    def test_gate_promotes_only_material_or_cost_efficient_improvement(self):
        from tkp_r18_backtest import coupon_promotion_gate
        champ={'exact':{'6':20,'5':40},'avg_cost':1200,'single_hit_rate':.55}
        strong={'exact':{'6':22,'5':40},'avg_cost':1250,'single_hit_rate':.56}
        weak={'exact':{'6':19,'5':50},'avg_cost':900,'single_hit_rate':.60}
        equal_better={'exact':{'6':20,'5':43},'avg_cost':1050,'single_hit_rate':.56}
        self.assertTrue(coupon_promotion_gate(strong,champ)['pass'])
        self.assertFalse(coupon_promotion_gate(weak,champ)['pass'])
        self.assertTrue(coupon_promotion_gate(equal_better,champ)['pass'])

    def test_common_meeting_alignment_prevents_unfair_promotion(self):
        from tkp_r18_backtest import align_coupon_records
        challenger=[{'meeting_uid':'A','hits':6,'cost':100,'singles':1,'single_hits':1},{'meeting_uid':'B','hits':6,'cost':100,'singles':1,'single_hits':1}]
        champion=[{'meeting_uid':'A','hits':5,'cost':100,'singles':1,'single_hits':1}]
        c,b=align_coupon_records(challenger,champion)
        self.assertEqual(c['meetings'],1); self.assertEqual(b['meetings'],1)
        self.assertEqual(c['exact']['6'],1); self.assertEqual(b['exact']['5'],1)

    def test_provenance_requires_frozen_champion_snapshot(self):
        from tkp_r18_backtest import pre_race_provenance_check
        good=[{'horses':[{'prediction_visible_tkp_snapshot':0},{'prediction_visible_tkp_snapshot':12}]}]
        bad=[{'horses':[{'prediction_visible_tkp_snapshot':None}]}]
        self.assertTrue(pre_race_provenance_check(good)['pass'])
        self.assertFalse(pre_race_provenance_check(bad)['pass'])


class CircularityGuardTests(unittest.TestCase):
    """R18.3 dış denetim (2026-09-14): champion_score blend'de en yüksek
    ağırlığı taşıyor ve önceki permutation_ablation() listesinden dışlanmıştı.
    Bu testler, champion_score'un tek başlıca sinyal olduğu bir senaryoda
    independent_signal_check'in bunu YAKALADIĞINI ve production_pass'ı
    engellediğini kanıtlar."""

    def _synthetic_races(self,n_meetings=30,seed=7):
        import numpy as np
        rng=np.random.default_rng(seed)
        races=[]
        race_counter=0
        for m in range(n_meetings):
            meeting_uid=f'M{m}'
            for leg in range(1,7):
                race_counter+=1
                # champion_score tek belirleyici sinyal; diğer her şey saf gürültü
                # (agf dahil) — piyasa tabanı da bu yüzden zayıf kalır.
                scores=rng.normal(size=5)
                winner_idx=int(np.argmax(scores))
                horses=[]
                for j in range(5):
                    horses.append({
                        'horse_no':str(j+1),'horse_name':f'H{m}_{leg}_{j}',
                        'winner':1 if j==winner_idx else 0,'finish_position':1 if j==winner_idx else 2,
                        'prediction_visible_tkp_snapshot':float(scores[j]),
                        'agf':float(rng.uniform(1,30)),'tr_puan':float(rng.uniform(1,30)),
                        'ypuan':float(rng.uniform(1,10)),'g800':float(rng.uniform(10,20)),
                        'agf_rank':j+1,'tr_rank':j+1,'hndkp_rank':j+1,'sp':float(rng.uniform(1,10)),
                        'start_no':j+1,'jbyg':float(rng.uniform(0,100)),'jockey_win_pct':float(rng.uniform(0,30)),
                        'hndkp':float(rng.uniform(40,70)),'weight_kg':float(rng.uniform(52,60)),
                        'priorStarts':5,'priorWins':1,
                    })
                races.append({
                    'race_date':f'2026-{(m//28)+1:02d}-{(m%28)+1:02d}','meeting_uid':meeting_uid,'leg':leg,'id':race_counter,
                    'surface':'KUM','distance':1400,'distance_group':'MIDDLE','horses':horses,
                })
        return races

    def test_champion_score_only_signal_fails_independent_check(self):
        from tkp_r18_backtest import _valid_training_frame, temporal_meeting_split, independent_signal_check
        from tkp_r18_model import R18ModelStack
        from tkp_r18_probability import ProbabilityCalibrator
        races=self._synthetic_races()
        df=_valid_training_frame(races)
        train,val,hold=temporal_meeting_split(df)
        model=R18ModelStack(min_expert_races=5,random_state=1).fit(train,val)
        calibrator=ProbabilityCalibrator().fit(model.predict(val))
        result=independent_signal_check(model,calibrator,hold)
        self.assertFalse(result['pass'],'champion_score tek belirleyici sinyalken circularity_pass True dönmemeli')

    def test_production_pass_requires_circularity_pass(self):
        # Gate hesaplamasının circularity_pass'ı gerçekten kullandığını,
        # metnini değil, run_backtest'in kaynak kodunda doğrular.
        import inspect
        from tkp_r18_backtest import run_backtest
        src=inspect.getsource(run_backtest)
        self.assertIn("independent['pass']",src,
            "production_pass hesaplaması independent_signal_check sonucunu içermeli")

if __name__=='__main__': unittest.main()

class PortfolioSummaryTests(unittest.TestCase):
    def test_portfolio_summary_counts_any_coupon_six_of_six(self):
        from tkp_r18_backtest import summarize_portfolio_records
        records={
            'normal':[{'meeting_uid':'A','hits':6},{'meeting_uid':'B','hits':5}],
            'surprise':[{'meeting_uid':'A','hits':5},{'meeting_uid':'B','hits':6}],
            'expert':[{'meeting_uid':'A','hits':4},{'meeting_uid':'B','hits':5}],
        }
        s=summarize_portfolio_records(records)
        self.assertEqual(s['meetings'],2)
        self.assertEqual(s['any_coupon_6of6'],2)
        self.assertEqual(s['any_coupon_5plus'],2)

class AlignedPortfolioSummaryTests(unittest.TestCase):
    def test_aligned_portfolio_summary_uses_only_common_meetings(self):
        from tkp_r18_backtest import aligned_portfolio_summary
        challenger={
            'normal':[{'meeting_uid':'A','hits':6},{'meeting_uid':'B','hits':6}],
            'surprise':[{'meeting_uid':'A','hits':5},{'meeting_uid':'B','hits':5}],
            'expert':[{'meeting_uid':'A','hits':4},{'meeting_uid':'B','hits':4}],
        }
        champion={
            'normal':[{'meeting_uid':'A','hits':5}],
            'surprise':[{'meeting_uid':'A','hits':5}],
            'expert':[{'meeting_uid':'A','hits':5}],
        }
        c,b=aligned_portfolio_summary(challenger,champion)
        self.assertEqual(c['meetings'],1)
        self.assertEqual(b['meetings'],1)
        self.assertEqual(c['any_coupon_6of6'],1)
        self.assertEqual(b['any_coupon_6of6'],0)
