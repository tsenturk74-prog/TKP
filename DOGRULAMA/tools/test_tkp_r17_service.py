import pandas as pd
from tkp_r17_service import score_payload

class FakePredictor:
    def predict_proba(self, x):
        # deterministic positive-class probability from AGF; not a model test
        p=pd.to_numeric(x['agf'],errors='coerce').fillna(0)/100.0
        return pd.DataFrame({0:1-p,1:p})

def test_score_payload_returns_normalized_pwin_and_preserves_promotion_gate():
    payload={'schema':'TKP_R17_LIVE_RACES_V1','races':[{
      'race_uid':'R1','race_date':'2026-09-13','hippodrome':'İstanbul','surface':'ÇİM','distance':1400,'leg':1,
      'horses':[{'horse_no':'1','horse_name':'A','agf':20},{'horse_no':'2','horse_name':'B','agf':60}]
    }]}
    out=score_payload(FakePredictor(),payload,{'pass':False,'rule':'test'})
    assert out['schema']=='TKP_R17_PWIN_V1'
    assert out['promotion_gate']['pass'] is False
    assert len(out['rows'])==2
    assert abs(sum(r['p_win'] for r in out['rows'])-1)<1e-12
    assert max(out['rows'],key=lambda r:r['p_win'])['horse_no']=='2'

def test_score_payload_rejects_invalid_schema():
    try:
        score_payload(FakePredictor(),{'schema':'BAD','races':[]},{'pass':False})
    except ValueError as e:
        assert 'schema' in str(e).lower()
    else:
        raise AssertionError('invalid schema accepted')
