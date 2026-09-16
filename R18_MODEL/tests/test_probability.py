import sys, unittest
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]; sys.path.insert(0,str(ROOT))

class ProbabilityTests(unittest.TestCase):
    def frame(self):
        rows=[]
        for r in range(8):
            for i,p in enumerate([.55,.30,.15]):
                rows.append({'race_key':f'r{r}','horse_no_text':str(i+1),'win_probability':p,'winner':1 if i==(r%3) else 0})
        return pd.DataFrame(rows)

    def test_calibration_preserves_race_probability_sum(self):
        from tkp_r18_probability import ProbabilityCalibrator
        df=self.frame(); c=ProbabilityCalibrator().fit(df)
        out=c.transform(df)
        self.assertTrue((((out.groupby('race_key').calibrated_probability.sum()-1).abs())<1e-9).all())

    def test_monte_carlo_runs_exact_10000_and_is_deterministic(self):
        from tkp_r18_probability import monte_carlo_races
        df=self.frame().query("race_key=='r0'").copy(); df['calibrated_probability']=df['win_probability']
        a=monte_carlo_races(df,simulations=10000,seed=42)
        b=monte_carlo_races(df,simulations=10000,seed=42)
        self.assertEqual(int(a.attrs['simulations']),10000)
        self.assertEqual(a.mc_wins.tolist(),b.mc_wins.tolist())
        self.assertEqual(int(a.mc_wins.sum()),10000)
        self.assertTrue(((a.confidence_low>=0)&(a.confidence_high<=1)).all())

if __name__=='__main__': unittest.main()
