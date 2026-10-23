(function(root){'use strict';
const VERSION='CONDITION-TEMPLATE-V1';
const snapshotIndexes=new WeakMap();
const preparing=new WeakMap();
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'});
const identity=h=>String(h?.horse_no??h??'').replace(/-E\d+$/i,'');
const unique=p=>[...new Set((p||[]).map(identity).filter(Boolean))];
const running=h=>!h.non_runner&&!h.nonrunner&&!h.non&&!h.is_non_runner;
function combinations(pools){
 const pp=(pools||[]).map(unique),n=pp.length;if(!n||n>5||pp.some(p=>!p.length))return 0;
 const masks=new Map();pp.forEach((p,i)=>p.forEach(no=>masks.set(no,(masks.get(no)||0)|(1<<i))));
 const dp=Array(1<<n).fill(0);dp[0]=1;
 for(const mask of masks.values())for(let used=(1<<n)-1;used>=0;used--){
  const count=dp[used];if(!count)continue;
  for(let i=0;i<n;i++)if((mask&(1<<i))&&!(used&(1<<i)))dp[used|(1<<i)]+=count;
 }
 return dp[(1<<n)-1];
}
function trim(pools,unit,limit){
 if(!(unit>0)||!(limit>=0))throw new RangeError('Invalid ticket cost');
 const out=(pools||[]).map(unique);let c=combinations(out),guard=0;
 while(c*unit>limit&&guard++<100){
  let chosen=-1,best=-1;
  for(let i=out.length-1;i>=0;i--){if(out[i].length<=1)continue;
   const trial=out.map((p,j)=>j===i?p.slice(0,-1):p),cc=combinations(trial);
   if(cc>0&&cc*unit<=limit){chosen=i;break;}
   if(chosen<0||out[i].length>best){chosen=i;best=out[i].length;}
  }
  if(chosen<0)break;out[chosen].pop();c=combinations(out);
 }
 if(c*unit>limit||!c)return {pools:[],combinations:0,cost:0};
 return {pools:out,combinations:c,cost:c*unit};
}
function official(r){return /^VERIFIED(?:_TJK_PAYOUT)?$/.test(String(r?.result_integrity_status||''));}
function positions(r,depth){
 const out=Array.from({length:depth},()=>[]);
 for(const h of r?.horses||[]){if(!running(h))continue;const pos=Number(h.winner)===1?1:Number(h.finish_position);
  if(pos>=1&&pos<=depth)out[pos-1].push(identity(h));}
 return out;
}
function outcome(r,pools){
 const actual=positions(r,pools.length);if(!official(r)||actual.some(p=>!p.length))return {resolved:false,hit:null};
 const pp=pools.map(unique);let hit=false;
 function visit(i,used){if(i===actual.length){hit=true;return;}for(const no of actual[i])if(pp[i].includes(no)&&!used.has(no)){used.add(no);visit(i+1,used);used.delete(no);}}
 visit(0,new Set());return {resolved:true,hit};
}
function rank(r,pos,model='common',prior=null){
 const rows=(r.horses||[]).filter(running);
 const field=model==='agf'?'agf_rank':'prediction_order_snapshot';
 const score=h=>{
  const cr=Number(h.prediction_order_snapshot)||999,ar=Number(h.agf_rank)||999;
  if(model==='condition'&&prior)return prior(h,pos,r);
  return -(Number(h[field])||999);
 };
 return rows.slice().sort((a,b)=>score(b)-score(a)||(Number(a.prediction_order_snapshot)||999)-(Number(b.prediction_order_snapshot)||999)||identity(a).localeCompare(identity(b),undefined,{numeric:true}));
}
function raceKey(r){return [r.file_id||r.meeting_uid||'',r.id||r.race_uid||'',r.race_date||r.date||'',r.hippodrome||'',r.altili_no||1,r.leg||0].join('|');}
function get(log,r){const index=snapshotIndexes.get(log);if(index?.length===log.length)return index.byKey.get(raceKey(r))||null;return log.length<=500?log.find(x=>x.race_key===raceKey(r))||null:null;}
async function prepare(log){
 if(snapshotIndexes.get(log)?.length===log.length)return;
 if(preparing.has(log))return preparing.get(log);
 const task=(async()=>{const byKey=new Map();let length=log.length;
  for(let at=0;at<length;at+=500){for(const row of log.slice(at,at+500))byKey.set(row.race_key,row);await new Promise(resolve=>setTimeout(resolve,0));length=log.length;}
  snapshotIndexes.set(log,{length:log.length,byKey});})();
 preparing.set(log,task);try{await task;}finally{preparing.delete(log);}
}
function sync(log,r,rows,now=new Date().toISOString()){
 const key=raceKey(r),date=String(r.race_date||r.date||'').slice(0,10);
 let index=snapshotIndexes.get(log);
 if(!index||index.length!==log.length){index={length:log.length,byKey:new Map(log.map(x=>[x.race_key,x]))};snapshotIndexes.set(log,index);}
 let rec=index.byKey.get(key);let changed=false;
 const resolved=(r.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0);
 if(!rec){
  // A past unresolved race may merely have missing results; never backfill a live snapshot.
  const today=dateFormat.format(new Date(now));
  if(resolved||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<today||!rows?.length)return false;
  const start=Date.parse(r.race_start_at||r.start_at||'');if(Number.isFinite(start)&&Date.parse(now)>=start)return false;
  rec={race_key:key,race_date:date,file_id:r.file_id,race_id:r.id,hippodrome:r.hippodrome,leg:r.leg,condition_family:r.condition_family,surface:r.surface,distance:r.distance,breed:r.breed,captured_at:now,version:VERSION,evidence_class:'PRE_RESULT_CANDIDATE_SNAPSHOT',candidates:rows.slice(0,6).map(row=>({horse_no:String(row.horse.horse_no),horse_name:row.horse.horse_name||'',warnings:(row.warnings||[]).slice(),signals:JSON.parse(JSON.stringify(row.signals||[])),winRate:row.winRate??null,finish_position:null,win:null,top3:null,top5:null}))};
  log.push(rec);index.byKey.set(key,rec);index.length=log.length;changed=true;
 }
 if(!official(r))return changed;
 const actual=new Map((r.horses||[]).map(h=>[identity(h),h])),runnerCount=(r.horses||[]).filter(running).length;
 const complete=n=>positions(r,Math.min(n,runnerCount)).every(p=>p.length);
 for(const c of rec.candidates){const h=actual.get(identity(c));if(!h)continue;
  const pos=Number(h.winner)===1?1:Number(h.finish_position)||null;
  const next={non_runner:!running(h),finish_position:pos,win:running(h)?(pos?pos===1:complete(1)?false:null):null,
   top3:running(h)?(pos?pos<=3:complete(3)?false:null):null,top5:running(h)?(pos?pos<=5:complete(5)?false:null):null};
  if(running(h))for(const k of ['finish_position','win','top3','top5'])if(next[k]===null&&c[k]!=null)next[k]=c[k];
  if(Object.keys(next).some(k=>c[k]!==next[k])){Object.assign(c,next);changed=true;}
 }
 if(changed&&resolved){rec.results_updated_at=now;rec.result_integrity_status=r.result_integrity_status;}
 return changed;
}
const api=Object.freeze({VERSION,identity,combinations,trim,official,positions,outcome,rank,raceKey,sync,get,prepare});
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TKP_BET_TEMPLATE_ENGINE=api;
if(typeof document!=='undefined'){
 let queued=false;const pending=new Map();
 const collection=()=>{const d=root.db;if(!d)return null;if(!Array.isArray(d.surprise_condition_shadow_log))d.surprise_condition_shadow_log=[];return d.surprise_condition_shadow_log;};
 root.tkpSurpriseConditionSnapshot=r=>{const log=collection();return log?get(log,r):null;};
 root.tkpSyncSurpriseConditionRows=(r,rows=[])=>{
  const key=raceKey(r),existing=pending.get(key);
  pending.set(key,{r,rows:existing?.rows?.length?existing.rows:rows,at:existing?.at||new Date().toISOString()});if(queued)return;queued=true;
  setTimeout(async()=>{try{
   const log=collection();if(!log)return;await prepare(log);let changed=false;
   for(const {r,rows,at} of pending.values())changed=sync(log,r,rows,at)||changed;pending.clear();
   if(changed&&typeof root.tkpPersistCollections==='function')await root.tkpPersistCollections(['surprise_condition_shadow_log'],{label:'surprise-condition-results'});
  }catch(error){console.error('Sürpriz sonuç takibi kaydedilemedi',error);}finally{queued=false;
   if(pending.size){const p=pending.values().next().value;root.tkpSyncSurpriseConditionRows(p.r,p.rows);}
  }},0);
 };
 root.tkpSyncSurpriseConditionResults=races=>{for(const x of races||[]){const r=x?.r||x;if(r)root.tkpSyncSurpriseConditionRows(r,[]);}};
 root.tkpScheduleSurpriseConditionCapture=races=>{
  const today=dateFormat.format(new Date()),candidates=(races||[]).filter(x=>{
   const r=x?.r||x,start=Date.parse(r?.race_start_at||r?.start_at||'');
   return String(r?.race_date||'')>=today&&!(r?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0)&&(!Number.isFinite(start)||Date.now()<start);
  });
  if(!candidates.length)return;
  const run=async()=>{for(const x of candidates){if(typeof root.tkpBombHunterSync==='function')root.tkpBombHunterSync([x]);await new Promise(resolve=>setTimeout(resolve,0));}};
  if(typeof root.tkpQueueTask==='function')root.tkpQueueTask('surprise-condition-capture',run,{priority:'background',replace:true,minIdleMs:1800});else setTimeout(run,0);
 };
}
})(typeof globalThis!=='undefined'?globalThis:this);
