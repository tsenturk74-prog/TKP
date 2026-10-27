#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import joblib

from tkp_r18_features import prepare_live_rows
from tkp_r18_probability import monte_carlo_races
from tkp_r18_coupon import optimize_portfolio

SCHEMA_IN='TKP_R18_LIVE_RACES_V1'
SCHEMA_OUT='TKP_R18_ANALYTICS_V1'


def _bool_gate(gate, family):
    if not isinstance(gate,dict): return False
    row=gate.get(family) or {}
    return bool(row.get('production_pass') is True)


def score_payload(model,calibrator,promotion_gate,payload,simulations=10000):
    if not isinstance(payload,dict) or payload.get('schema')!=SCHEMA_IN:
        raise ValueError(f'Geçersiz live schema; {SCHEMA_IN} bekleniyor')
    races=payload.get('races') or []
    live=prepare_live_rows(races)
    gate=promotion_gate or {'production_pass':False}
    if live.empty:
        return {'schema':SCHEMA_OUT,'promotion_gate':gate,'rows':[],'coupons':{},'shadow_only':True}
    scored=model.predict(live)
    scored=calibrator.transform(scored)
    scored=monte_carlo_races(scored,simulations=int(simulations),seed=181)
    rows=[]
    sort_cols=[c for c in ['race_date','race_key','calibrated_probability'] if c in scored.columns]
    asc=[True,True,False][:len(sort_cols)]
    view=scored.sort_values(sort_cols,ascending=asc) if sort_cols else scored
    for _,r in view.iterrows():
        rows.append({
            'race_key':str(r.get('race_key') or ''),'race_date':str(r.get('race_date') or ''),
            'file_id':r.get('file_id'),'race_id':r.get('race_id'),'meeting_uid':str(r.get('meeting_uid') or ''),
            'leg':int(r.get('leg') or 0),'horse_no':str(r.get('horse_no_text') or ''),'horse_name':str(r.get('horse_name') or ''),
            'win_probability':round(float(r.get('calibrated_probability',r.get('win_probability',0)) or 0),8),
            'mc_win_rate':round(float(r.get('mc_win_rate',0) or 0),8),
            'confidence_low':round(float(r.get('confidence_low',0) or 0),8),
            'confidence_high':round(float(r.get('confidence_high',0) or 0),8),
            'uncertainty':round(float(r.get('uncertainty',0) or 0),8),
            'market_probability':round(float(r.get('market_probability',0) or 0),8),
            'residual_score':round(float(r.get('residual_score',0) or 0),8),
            'pairwise_score':round(float(r.get('pairwise_score',0) or 0),8),
            'expert_score':round(float(r.get('expert_score',0) or 0),8),
            'champion_probability':round(float(r.get('champion_probability',0) or 0),8),
            'value_score':round(float(r.get('value_score',0) or 0),8),
            'model_source':str(r.get('model_source') or ''),'mc_simulations':int(r.get('mc_simulations') or simulations),
        })
    coupons={}
    if 'leg' in scored.columns and scored['leg'].nunique()==6:
        try:
            port=optimize_portfolio(scored,budget=min(1500,max(1,int(payload.get('budget') or 1500))))
            for fam,c in port.items():
                c=dict(c); c['active']=_bool_gate(gate,fam); coupons[fam]=c
        except Exception:
            coupons={}
    production=bool(gate.get('production_pass') is True) if isinstance(gate,dict) else False
    return {'schema':SCHEMA_OUT,'promotion_gate':gate,'rows':rows,'coupons':coupons,'shadow_only':not production}


def load_runtime(model_path,report_path):
    mp=Path(model_path)
    if not mp.exists(): raise FileNotFoundError(f'R18 model dosyası bulunamadı: {mp}')
    bundle=joblib.load(mp)
    model=bundle.get('model'); calibrator=bundle.get('calibrator')
    if model is None or calibrator is None: raise ValueError('R18 model paketi eksik')
    report=bundle.get('report') or {}
    rp=Path(report_path)
    if rp.exists():
        try: report=json.loads(rp.read_text(encoding='utf-8-sig'))
        except Exception: pass
    gate=(report.get('promotion_gate') or {'production_pass':False})
    return model,calibrator,gate


class R18Handler(BaseHTTPRequestHandler):
    model=None; calibrator=None; promotion_gate={'production_pass':False}; simulations=10000; max_body=12*1024*1024
    def _headers(self,status=200):
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','Content-Type'); self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.end_headers()
    def _json(self,obj,status=200): self._headers(status); self.wfile.write(json.dumps(obj,ensure_ascii=False).encode('utf-8'))
    def do_OPTIONS(self): self._headers(204)
    def do_GET(self):
        if self.path.rstrip('/')=='/health': self._json({'ok':True,'schema':'TKP_R18_SERVICE_V1','promotion_gate':self.promotion_gate}); return
        self._json({'ok':False,'error':'not_found'},404)
    def do_POST(self):
        if self.path.rstrip('/')!='/predict': self._json({'ok':False,'error':'not_found'},404); return
        try:
            n=int(self.headers.get('Content-Length') or 0)
            if n<=0 or n>self.max_body: raise ValueError('Geçersiz istek boyutu')
            payload=json.loads(self.rfile.read(n).decode('utf-8'))
            self._json(score_payload(self.model,self.calibrator,self.promotion_gate,payload,self.simulations))
        except ValueError as e: self._json({'ok':False,'error':str(e)},400)
        except Exception as e: self._json({'ok':False,'error':str(e)},500)
    def log_message(self,fmt,*args): print('[R18]',fmt%args)


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--host',default='127.0.0.1'); ap.add_argument('--port',type=int,default=3764); ap.add_argument('--model',default='R18_MODEL/r18_model.joblib'); ap.add_argument('--report',default='R18_MODEL/r18_training_report.json'); ap.add_argument('--simulations',type=int,default=10000)
    args=ap.parse_args(); model,cal,gate=load_runtime(args.model,args.report); R18Handler.model=model; R18Handler.calibrator=cal; R18Handler.promotion_gate=gate; R18Handler.simulations=args.simulations
    srv=ThreadingHTTPServer((args.host,args.port),R18Handler); print(f'R18 sidecar http://{args.host}:{args.port} · production={bool(gate.get("production_pass"))}')
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    finally: srv.server_close()

if __name__=='__main__': main()
