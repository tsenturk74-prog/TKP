import gzip,json,struct,math,sys,numpy as np
p=sys.argv[1];raw=gzip.open(p,'rb').read();o=0
def take(n):
 global o;b=raw[o:o+n];o+=n;return b
def u32():
 global o;n=struct.unpack('>I',raw[o:o+4])[0];o+=4;return n
take(4);u32();env=json.loads(take(u32()));r=[]
for d in env['collections']:
 for _ in range(d['chunks']):
  c=json.loads(take(u32()))
  if d['name']=='races':r.extend(c)
r=[x for x in r if x.get('result_integrity_status')=='VERIFIED'];r.sort(key=lambda x:(x.get('race_date',''),int(x.get('file_id') or 0),int(x.get('leg') or 0)))
def fin(v):
 try:x=float(v);return x if math.isfinite(x) else None
 except:return None
def order(hs,f,d):
 vals=[fin(h.get(f)) for h in hs]
 if sum(v is not None for v in vals)<2:return None
 a=np.array([(-1e99 if d==1 else 1e99) if v is None else v for v in vals]);return np.argsort(-a if d==1 else a,kind='mergesort')
def evalblock(rows):
 out={'Frozen':[],'R16Hierarchy':[]};src={}
 for race in rows:
  hs=race['horses'];w=next(i for i,h in enumerate(hs) if h.get('winner')==1 or h.get('finish_position')==1)
  fr=order(hs,'prediction_order_snapshot',-1)
  if fr is None: fr=order(hs,'prediction_score_snapshot',1)
  if fr is None: fr=np.arange(len(hs))
  hr=None;name='frozen'
  for f,d,nm in [('adaptive_position',-1,'adaptive_position'),('sidebet_adaptive_rank',-1,'sidebet_adaptive'),('online_hybrid_rank',-1,'online_hybrid'),('prediction_order_snapshot',-1,'frozen'),('prediction_score_snapshot',1,'frozen_score')]:
   q=order(hs,f,d)
   if q is not None:hr=q;name=nm;break
  if hr is None:hr=fr
  src[name]=src.get(name,0)+1
  for nm,q in [('Frozen',fr),('R16Hierarchy',hr)]:out[nm].append(int(np.where(q==w)[0][0])+1)
 ret={'sources':src}
 for nm,a in out.items():
  a=np.array(a);ret[nm]={'n':len(a),'top1':round(np.mean(a==1)*100,2),'top3':round(np.mean(a<=3)*100,2),'top5':round(np.mean(a<=5)*100,2),'mrr':round(np.mean(1/a),4)}
 return ret
folds=np.array_split(np.arange(len(r)),5)
for i,ix in enumerate(folds,1):
 rows=[r[j] for j in ix];print(i,rows[0]['race_date'],rows[-1]['race_date'],evalblock(rows))
print('ALL',evalblock(r))
