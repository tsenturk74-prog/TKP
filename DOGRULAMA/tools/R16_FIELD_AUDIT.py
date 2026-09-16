import gzip,json,struct,math,sys,collections,numpy as np
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
r=[x for x in r if x.get('result_integrity_status')=='VERIFIED'];r.sort(key=lambda x:(x.get('race_date',''),int(x.get('file_id') or 0),int(x.get('leg') or 0)));r=r[-577:]
# candidate score/rank fields, directions
cand={
'agf':1,'hndkp':1,'tr_ganyan':1,'jbyg':-1,'jbyg_rate':1,'g800':-1,'result_score':-1,'pre_result_score':1,'prediction_score_snapshot':1,'prediction_order_snapshot':-1,'score':1,'pre_race_tkp_score':1,
'adaptive_position_score':1,'adaptive_position':-1,'v27_backtest_score':1,'v27_backtest_rank':-1,'sidebet_adaptive_score':1,'sidebet_adaptive_rank':-1,'sidebet_p1_score':1,'sidebet_p1_rank':-1,'altili_winner_score':1,'altili_winner_rank':-1,'online_hybrid_rank':-1,
'tkp_display_raw_score':1,'tkp_display_score':1,'value_score':1,'sp':1,'s_value':1,'star_value':1,'tr_profile_score':1,'team_strength_pct':1,'g800_rank':-1,'glp_rank':-1,'jbyg_rank':-1,'team_strength_rank':-1}
def fin(v):
 try:x=float(v);return x if math.isfinite(x) else None
 except:return None
for field,d in cand.items():
 ranks=[];avail=0;sur=[]
 for race in r:
  hs=race.get('horses') or [];w=next((i for i,h in enumerate(hs) if h.get('winner')==1 or h.get('finish_position')==1),None)
  if w is None:continue
  vals=[fin(h.get(field)) for h in hs];known=sum(v is not None for v in vals)
  if known<2:continue
  score=np.array([(-1e99 if d==1 else 1e99) if v is None else v for v in vals]);order=np.argsort(-score if d==1 else score,kind='mergesort');rk=int(np.where(order==w)[0][0])+1;ranks.append(rk);avail+=1;sur.append(float(hs[w].get('agf') or 0)<=10)
 if avail<50:continue
 a=np.array(ranks);s=np.array(sur,bool)
 print(f'{field:28} n={avail:3d} T1={np.mean(a==1)*100:5.2f} T3={np.mean(a<=3)*100:5.2f} T5={np.mean(a<=5)*100:5.2f} MRR={np.mean(1/a):.4f} SurT3={((a<=3)&s).sum()/max(1,s.sum())*100:5.2f}')
