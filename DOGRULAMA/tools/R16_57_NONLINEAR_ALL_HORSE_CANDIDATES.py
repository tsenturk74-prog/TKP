#!/usr/bin/env python3
"""Non-lineer TEK aday araştırması.

Her at bir gözlemdir; sonuç yalnız etiket olarak kullanılır. 60/20/20 tarihsel
ayrım korunur. Burada "top 1" mevcut TKP lideri demek değildir: model tüm atları
skorlar, kendi en yüksek adayını seçer ve onun farklı olup olmadığı ayrıca raporlanır.
"""
import sys, gzip, json, struct
from collections import defaultdict
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier, ExtraTreesClassifier

IN = sys.argv[1] if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else 'R16_57_NONLINEAR_ALL_HORSE_CANDIDATES.json'
if not IN:
    raise SystemExit('Kullanım: R16_57_NONLINEAR_ALL_HORSE_CANDIDATES.py backup.tkbz [report.json]')

FEATURES = ['TKP score','AGF','TR puan','Y.PUAN','HNDKP','VALUE','JBYG','galop',
            'BMB','TR BMB','TR hidden','TR ganyan','önceki galibiyet','kondisyon kazanma',
            'Accurate','800m galop','SP']
MARKET = list(range(0,7)) + [8,9,10,11,12]
FORM = [0,7,12,13,14,15,16]
CORE = list(range(0,7))

def num(v):
    try:
        x=float(v)
        return x if np.isfinite(x) else None
    except (TypeError, ValueError): return None
def truth(v): return v is True or v == 1 or v == '1'
def take(b, pos, n): return b[pos:pos+n], pos+n
def load(path):
    b=gzip.decompress(open(path,'rb').read()); pos=0
    magic,pos=take(b,pos,4)
    if magic != b'TKPB': raise ValueError('TKPB başlığı yok')
    _,pos=take(b,pos,4)
    ln=struct.unpack('>I',b[pos:pos+4])[0]; pos+=4
    meta=json.loads(b[pos:pos+ln]); pos+=ln; out={}
    for col in meta.get('collections',[]):
        arr=[]
        for _ in range(col['chunks']):
            ln=struct.unpack('>I',b[pos:pos+4])[0]; pos+=4
            arr.extend(json.loads(b[pos:pos+ln])); pos+=ln
        out[col['name']]=arr
    return out
def rank(values, desc=True):
    known=[(i,v) for i,v in enumerate(values) if v is not None]
    known.sort(key=lambda x:x[1], reverse=desc); out=[0.0]*len(values); m=max(1,len(known))
    for k,(i,_) in enumerate(known): out[i]=(m-k)/m
    return out
def races(db):
    out=[]
    for r in db.get('races',[]):
        horses=[h for h in r.get('horses',[]) if str(h.get('horse_no','')).strip()]
        winner=next((h for h in horses if truth(h.get('winner')) or str(h.get('finish_position'))=='1'),None)
        if not winner: continue
        raw=[]
        for h in horses:
            raw.append([
                num(h.get('prediction_score_snapshot',h.get('score',h.get('pre_race_tkp_score')))), num(h.get('agf')),num(h.get('tr_puan')),num(h.get('ypuan')),num(h.get('hndkp')),num(h.get('value_score')),num(h.get('jbyg')),num(h.get('galop_rank',h.get('glp_rank'))),
                1.0 if truth(h.get('bmb')) else 0.0,1.0 if truth(h.get('tr_bmb_candidate')) else 0.0,1.0 if truth(h.get('tr_hidden_fav')) else 0.0,num(h.get('tr_ganyan')),num(h.get('priorWins')),num(h.get('condWinPct')),num(h.get('priorAccurateFinishSignal')),num(h.get('g800')),num(h.get('sp'))
            ])
        cols=list(zip(*raw)); norms=[]
        for j,c in enumerate(cols):
            if j in (8,9,10): norms.append([float(x or 0) for x in c])
            else: norms.append(rank(c, desc=j not in (7,11,15,16)))
        X=np.asarray(list(zip(*norms)),dtype=float)
        y=np.asarray([1 if str(h.get('horse_no'))==str(winner.get('horse_no')) else 0 for h in horses],dtype=int)
        out.append({'id':str(r.get('id','')),'date':str(r.get('race_date','')),'seq':int(r.get('sequence_no') or 0),'x':X,'y':y,'snapshot':int(np.argmax(X[:,0]))})
    return sorted(out,key=lambda r:(r['date'],r['seq'],r['id']))
def stack(rs, cols): return np.vstack([r['x'][:,cols] for r in rs]),np.concatenate([r['y'] for r in rs])
def select_metrics(rs, model, cols):
    hits=changed=0; conf=[]; gaps=[]
    for r in rs:
        p=model.predict_proba(r['x'][:,cols])[:,1]; order=np.argsort(-p); pick=int(order[0])
        hits+=int(r['y'][pick]); changed+=int(pick != r['snapshot']); conf.append(float(p[pick])); gaps.append(float(p[pick]-(p[order[1]] if len(order)>1 else 0)))
    n=len(rs); z=1.96; q=hits/max(1,n); d=1+z*z/n; wil=(q+z*z/(2*n)-z*np.sqrt((q*(1-q)+z*z/(4*n))/n))/d
    return {'races':n,'hits':hits,'rate':round(q,4),'wilson':round(float(wil),4),'changed':changed,'changed_rate':round(changed/max(1,n),4),'mean_top_probability':round(float(np.mean(conf)),4),'mean_gap':round(float(np.mean(gaps)),4)}
def make_model(kind):
    if kind=='logistic': return LogisticRegression(C=.25,max_iter=600,class_weight='balanced',solver='lbfgs')
    if kind=='hist': return HistGradientBoostingClassifier(learning_rate=.07,max_leaf_nodes=9,l2_regularization=5.0,min_samples_leaf=70,max_iter=120,random_state=51)
    if kind=='trees': return ExtraTreesClassifier(n_estimators=90,max_features=.75,min_samples_leaf=22,class_weight='balanced',n_jobs=-1,random_state=51)
    raise ValueError(kind)
def main():
    rs=races(load(IN)); a=int(len(rs)*.60); b=int(len(rs)*.80); train,val,hold=rs[:a],rs[a:b],rs[b:]
    specs=[('logistic_full','logistic',list(range(17))),('hist_full','hist',list(range(17))),('trees_full','trees',list(range(17))),('hist_market','hist',MARKET),('hist_form','hist',FORM)]
    results=[]
    for name,kind,cols in specs:
        model=make_model(kind); X,y=stack(train,cols); model.fit(X,y)
        results.append({'model':name,'family':kind,'features':[FEATURES[i] for i in cols],'validation':select_metrics(val,model,cols),'holdout':select_metrics(hold,model,cols)})
    results.sort(key=lambda x:(-x['validation']['wilson'],-x['validation']['rate']))
    report={'version':'R16.57-NONLINEAR-ALL-HORSE-CANDIDATE-WALKFORWARD','contract':'Her koşuda tüm atlar adaydır. Modeller yalnız yarış öncesi 17 sinyali görür. Sonuç yalnız etikettir. Model seçimi validation ile yapılır; holdout yalnız sonuç raporudur.','all_official_result_races':len(rs),'split':{'train':len(train),'validation':len(val),'holdout':len(hold)},'results':results,'interpretation':'changed_rate mevcut snapshot liderinden farklı aday oranıdır; daha yüksek olması tek başına iyi değildir. Holdout üstünlüğü olmadan model canlı TEK üretmez.'}
    json.dump(report,open(OUT,'w'),ensure_ascii=False,indent=2); print(json.dumps(report,ensure_ascii=False,indent=2))
main()
