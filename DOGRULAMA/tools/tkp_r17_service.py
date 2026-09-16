#!/usr/bin/env python3
import argparse, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tkp_r17_autogluon import FEATURE_COLUMNS, DYNAMIC_FORM_FEATURES, _predict_positive, normalize_race_probabilities, prepare_live_frame

SCHEMA_IN='TKP_R17_LIVE_RACES_V1'
SCHEMA_OUT='TKP_R17_PWIN_V1'


def score_payload(predictor,payload,promotion_gate,form_index=None):
    if not isinstance(payload,dict) or payload.get('schema')!=SCHEMA_IN:
        raise ValueError('Geçersiz live schema; TKP_R17_LIVE_RACES_V1 bekleniyor')
    races=payload.get('races') or []
    live,quality=prepare_live_frame(races,form_index=form_index)
    if live.empty:
        return {'schema':SCHEMA_OUT,'promotion_gate':promotion_gate or {'pass':False},'quality':quality,'rows':[]}
    scored=live.copy()
    scored['raw_p']=_predict_positive(predictor,scored[FEATURE_COLUMNS]).to_numpy()
    scored=normalize_race_probabilities(scored,'raw_p','p_win')
    rows=[]
    for _,r in scored.sort_values(['race_date','race_key','p_win'],ascending=[True,True,False]).iterrows():
        rows.append({
            'race_key':str(r['race_key']),'race_date':str(r['race_date']),'file_id':r['file_id'],'race_id':r['race_id'],
            'horse_no':str(r['horse_no_text']),'horse_name':str(r['horse_name']),'p_win':round(float(r['p_win']),8),
            'dynamic_form':{f:round(float(r.get(f) or 0.0),6) for f in DYNAMIC_FORM_FEATURES+['handicap_blend_score']}
        })
    return {'schema':SCHEMA_OUT,'promotion_gate':promotion_gate or {'pass':False},'quality':quality,'rows':rows}


def load_runtime(model_dir,report_path,form_index_path=None):
    try:
        from autogluon.tabular import TabularPredictor
    except Exception as e:
        raise RuntimeError('AutoGluon kurulu değil. Önce KUR_AUTOGLOUON.bat çalıştırın.') from e
    model_path=Path(model_dir)
    if not model_path.exists(): raise FileNotFoundError(f'R17 model klasörü bulunamadı: {model_path}')
    predictor=TabularPredictor.load(str(model_path))
    gate={'pass':False,'rule':'model raporu yok'}
    rp=Path(report_path)
    if rp.exists():
        try:
            report=json.loads(rp.read_text(encoding='utf-8-sig'))
            gate=report.get('promotion_gate') or gate
        except Exception:
            pass
    form_index=None
    fip=Path(form_index_path) if form_index_path else rp.with_name('r17_form_index.json')
    if fip.exists():
        try:
            form_index=json.loads(fip.read_text(encoding='utf-8-sig'))
        except Exception:
            form_index=None
    return predictor,gate,form_index


class R17Handler(BaseHTTPRequestHandler):
    predictor=None; promotion_gate={'pass':False}; form_index=None; max_body=12*1024*1024
    def _headers(self,status=200):
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
        self.end_headers()
    def _json(self,obj,status=200):
        self._headers(status); self.wfile.write(json.dumps(obj,ensure_ascii=False).encode('utf-8'))
    def do_OPTIONS(self): self._headers(204)
    def do_GET(self):
        if self.path.rstrip('/')=='/health':
            self._json({'ok':True,'schema':'TKP_R17_SERVICE_V1','promotion_gate':self.promotion_gate}); return
        self._json({'ok':False,'error':'not_found'},404)
    def do_POST(self):
        if self.path.rstrip('/')!='/predict': self._json({'ok':False,'error':'not_found'},404); return
        try:
            n=int(self.headers.get('Content-Length') or 0)
            if n<=0 or n>self.max_body: raise ValueError('Geçersiz istek boyutu')
            payload=json.loads(self.rfile.read(n).decode('utf-8'))
            self._json(score_payload(self.predictor,payload,self.promotion_gate,form_index=self.form_index))
        except ValueError as e:
            self._json({'ok':False,'error':str(e)},400)
        except Exception as e:
            self._json({'ok':False,'error':str(e)},500)
    def log_message(self,fmt,*args):
        print('[R17]',fmt%args)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--host',default='127.0.0.1')
    ap.add_argument('--port',type=int,default=3763)
    ap.add_argument('--model-dir',default='R17_MODEL/autogluon_model')
    ap.add_argument('--report',default='R17_MODEL/r17_training_report.json')
    ap.add_argument('--form-index',default=None,help='r17_form_index.json yolu (varsayılan: report ile aynı klasör)')
    args=ap.parse_args()
    predictor,gate,form_index=load_runtime(args.model_dir,args.report,args.form_index)
    R17Handler.predictor=predictor; R17Handler.promotion_gate=gate; R17Handler.form_index=form_index
    srv=ThreadingHTTPServer((args.host,args.port),R17Handler)
    production_active=gate.get('production_pass') if isinstance(gate.get('production_pass'),bool) else gate.get('pass')
    print(f'R17 AutoGluon sidecar http://{args.host}:{args.port} · model_pass={bool(gate.get("pass"))} · production={bool(production_active)}')
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    finally: srv.server_close()

if __name__=='__main__': main()
