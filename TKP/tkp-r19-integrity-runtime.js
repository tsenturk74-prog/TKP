/* TKP R19.2 — data integrity / freshness / post-result coordination.
   This layer does not invent pre-race evidence. It repairs only persisted/frozen
   evidence and coordinates the existing learning/resolution engines cooperatively. */
(function(global){
'use strict';
const VERSION='R19.2-INTEGRITY-20260916';
const STATE_KEY='r19_2_integrity';
let running=false,scheduled=false,lastAudit=null;

function upperTr(v){return String(v??'').trim().toLocaleUpperCase('tr-TR');}
function asciiTr(v){return upperTr(v).replace(/İ/g,'I').replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C');}
function trackKey(v){
  try{if(typeof global.canonicalHippodrome==='function')v=global.canonicalHippodrome(v);}catch(_e){}
  return asciiTr(v).replace(/\s+/g,' ');
}
function tkpIntegrityRaceKey(r){return [String(r?.race_date||r?.date||'').slice(0,10),trackKey(r?.hippodrome||''),Number(r?.altili_no)||1,Number(r?.leg||r?.sequence_no)||0].join('|');}
function stamp(row){return String(row?.evaluated_at||row?.integrity_checked_at||row?.updated_at||row?.captured_at||row?.created_at||'');}
function cloneObj(v){try{return JSON.parse(JSON.stringify(v));}catch(_e){return v&&typeof v==='object'?{...v}:v;}}
function mergeObjectMissing(target,source){
  if(!source||typeof source!=='object')return target;
  for(const [k,v] of Object.entries(source)){
    if(v===undefined||v===null||v==='')continue;
    if(k==='coupons'&&v&&typeof v==='object'){
      target.coupons=target.coupons&&typeof target.coupons==='object'?target.coupons:{};
      for(const [ck,cv] of Object.entries(v))if((!Array.isArray(target.coupons[ck])||!target.coupons[ck].length)&&Array.isArray(cv)&&cv.length)target.coupons[ck]=cloneObj(cv);
      continue;
    }
    if((target[k]===undefined||target[k]===null||target[k]==='') && !(Array.isArray(target[k])&&target[k].length)) target[k]=cloneObj(v);
  }
  return target;
}
function tkpIntegrityPreferResolved(a,b){
  const score=x=>((String(x?.integrity||'').toUpperCase()==='RESOLVED'||x?.evaluated_at)?1000000:0)+(String(x?.winner_no||'').trim()?100000:0)+(Date.parse(stamp(x))||0)/1e8;
  return score(b)>score(a)?b:a;
}
function tkpIntegrityDedupeByKey(rows,keyFn,preferFn=tkpIntegrityPreferResolved){
  const out=[],idx=new Map();let removed=0,merged=0;
  for(const raw of Array.isArray(rows)?rows:[]){
    if(!raw||typeof raw!=='object'){out.push(raw);continue;}
    const key=String(keyFn(raw)||'');
    if(!key){out.push(raw);continue;}
    if(!idx.has(key)){idx.set(key,out.length);out.push(raw);continue;}
    const pos=idx.get(key),prev=out[pos],preferred=preferFn(prev,raw),other=preferred===prev?raw:prev;
    const next=mergeObjectMissing(preferred,other);
    out[pos]=next;removed++;merged++;
  }
  return {rows:out,removed,merged};
}
function tkpIntegrityMergeForwardRows(rows){
  return tkpIntegrityDedupeByKey(rows,r=>String(r?.race_key||'')||tkpIntegrityRaceKey(r),tkpIntegrityPreferResolved);
}
function stablePrimitive(v){
  if(v===null||v===undefined)return null;
  if(Array.isArray(v))return v.map(stablePrimitive);
  if(typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stablePrimitive(v[k]);return o;}
  return v;
}
function exactKey(row){try{return JSON.stringify(stablePrimitive(row));}catch(_e){return '';}}
function latestResultDate(source){let latest='';for(const r of source?.races||[]){let known=false;try{known=typeof global.raceHasConfirmedResult==='function'?global.raceHasConfirmedResult(r?.horses||[]):(r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);}catch(_e){}if(known){const d=String(r?.race_date||r?.date||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>latest)latest=d;}}return latest;}
function latestForwardDate(source){let latest='';for(const r of source?.forward_tracking_log||[]){if(!r?.evaluated_at||!String(r?.winner_no||'').trim())continue;const d=String(r?.race_date||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>latest)latest=d;}return latest;}
function latestWeeklyDate(source){let latest='';for(const r of source?.weekly_model_log||[]){const d=String(r?.race_date||r?.week_end||r?.week_start||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>latest)latest=d;}return latest;}
function tkpIntegrityAudit(source=global.db){
  if(!source)return {ok:false,version:VERSION};
  const audit={ok:true,version:VERSION,at:new Date().toISOString(),latest_result_date:latestResultDate(source),latest_forward_date:latestForwardDate(source),latest_weekly_date:latestWeeklyDate(source),counts:{}};
  for(const k of ['races','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','sidebet_ticket_log','v55_diagnostic_log','surprise_cohort_tracking_log'])audit.counts[k]=Array.isArray(source[k])?source[k].length:0;
  lastAudit=audit;return audit;
}
async function yieldUi(){if(typeof global.tkpYieldToUi==='function')return global.tkpYieldToUi();if(typeof global.tkpYield==='function')return global.tkpYield();return new Promise(r=>setTimeout(r,0));}
async function normalizeFrozenVisibleTkp(source,full){
  if(!Array.isArray(source?.races))return {changed:0};let changed=0,seen=0;
  const races=source.races,from=full?0:Math.max(0,races.length-240);
  for(let i=from;i<races.length;i++){
    const r=races[i];for(const h of r?.horses||[]){
      if(!h||Number(h?.prediction_score_locked)!==1||!Number.isFinite(Number(h?.prediction_score_snapshot)))continue;
      const before=Number(h?.tkp_display_score);
      try{if(typeof global.tkpWriteVisibleDisplayScore==='function')global.tkpWriteVisibleDisplayScore(h,Number(h.prediction_score_snapshot));}catch(_e){}
      const after=Number(h?.tkp_display_score);if(Number.isFinite(after)&&after!==before)changed++;
    }
    if((++seen&31)===0)await yieldUi();
  }
  return {changed};
}
async function repairForwardExisting(source,full){
  const log=Array.isArray(source?.forward_tracking_log)?source.forward_tracking_log:[];
  if(!log.length||!Array.isArray(source?.races)||typeof global.tkpForwardTrackingEvaluateRecord!=='function')return {changed:0};
  const raceMap=new Map();for(const r of source.races)raceMap.set(tkpIntegrityRaceKey(r),r);
  let changed=0,start=full?0:Math.max(0,log.length-2000);
  for(let i=start;i<log.length;i++){
    const rec=log[i],race=raceMap.get(String(rec?.race_key||'')||tkpIntegrityRaceKey(rec));
    if(race){try{if(global.tkpForwardTrackingEvaluateRecord(rec,race))changed++;}catch(_e){}}
    if((i&63)===63)await yieldUi();
  }
  return {changed};
}
async function syncTrackers(source,full){
  if(!Array.isArray(source?.races))return {weekly:false,sidebet:false};
  const latest=latestResultDate(source),cutoff=latest&&latest.length===10?new Date(Date.parse(latest+'T00:00:00Z')-(full?366:21)*86400000).toISOString().slice(0,10):'';
  const rows=source.races.filter(r=>!cutoff||String(r?.race_date||'').slice(0,10)>=cutoff);
  let weekly=false,sidebet=false;
  const prevBulk=global.__tkpBulkPipelineActive===true;global.__tkpBulkPipelineActive=true;
  try{
    if(typeof global.tkpWeeklyModelTrackerSync==='function'){
      for(let i=0;i<rows.length;i+=24){try{if(global.tkpWeeklyModelTrackerSync(rows.slice(i,i+24).map(r=>({r}))))weekly=true;}catch(_e){}await yieldUi();}
    }
    if(typeof global.tkpWeeklyModelTrackerResolveExactSideBetTickets==='function'){
      for(let i=0;i<rows.length;i+=48){try{if(global.tkpWeeklyModelTrackerResolveExactSideBetTickets(rows.slice(i,i+48)))sidebet=true;}catch(_e){}await yieldUi();}
    }
    if(typeof global.tkpSurpriseCohortSync==='function'){
      for(let i=0;i<rows.length;i+=24){try{global.tkpSurpriseCohortSync(rows.slice(i,i+24).map(r=>({r})));}catch(_e){}await yieldUi();}
    }
  }finally{global.__tkpBulkPipelineActive=prevBulk;}
  return {weekly,sidebet};
}
function dedupeCollections(source){
  const changed=[];const stats={};
  const f=tkpIntegrityMergeForwardRows(source.forward_tracking_log||[]);if(f.removed){source.forward_tracking_log=f.rows;changed.push('forward_tracking_log');}stats.forward=f.removed;
  const s=tkpIntegrityDedupeByKey(source.sidebet_ticket_log||[],r=>r?.lock_key||r?.ticket_id||'',tkpIntegrityPreferResolved);if(s.removed){source.sidebet_ticket_log=s.rows;changed.push('sidebet_ticket_log');}stats.sidebet=s.removed;
  for(const name of ['auto_coupon_log','weekly_model_log','v55_diagnostic_log','surprise_cohort_tracking_log']){
    const d=tkpIntegrityDedupeByKey(source[name]||[],r=>exactKey(r),(a)=>a);if(d.removed){source[name]=d.rows;changed.push(name);}stats[name]=d.removed;
  }
  return {changed:[...new Set(changed)],stats};
}
function cheapSignature(source){const a=tkpIntegrityAudit(source);return [a.counts.races,a.counts.prediction_log,a.counts.auto_coupon_log,a.counts.forward_tracking_log,a.counts.weekly_model_log,a.counts.sidebet_ticket_log,a.latest_result_date,a.latest_forward_date].join('|');}
async function persistChanged(source,names,meta){
  names=[...new Set(names)].filter(Boolean);if(!names.length)return true;
  try{if(typeof global.tkpPersistCollections==='function')return await global.tkpPersistCollections(names,{metaPatch:{settings:source.settings,learning_state:source.learning_state},label:'r19-integrity-repair'});}catch(_e){}
  try{if(typeof global.saveDB==='function')return await global.saveDB(false,false);}catch(_e){}
  return false;
}
async function tkpRunIntegrityRepair(options={}){
  const source=global.db;if(!source||running)return false;running=true;
  const full=options.full===true;const started=Date.now();const changed=[];let error='';
  try{
    source.settings=source.settings&&typeof source.settings==='object'?source.settings:{};
    const before=cheapSignature(source),dedupe=dedupeCollections(source);changed.push(...dedupe.changed);
    const tkp=await normalizeFrozenVisibleTkp(source,full);if(tkp.changed)changed.push('races');
    const fwd=await repairForwardExisting(source,full);if(fwd.changed)changed.push('forward_tracking_log');
    const trackers=await syncTrackers(source,full);if(trackers.weekly)changed.push('weekly_model_log');if(trackers.sidebet)changed.push('sidebet_ticket_log');
    const afterAudit=tkpIntegrityAudit(source);source.settings[STATE_KEY]={version:VERSION,completed_at:new Date().toISOString(),duration_ms:Date.now()-started,signature:cheapSignature(source),latest_result_date:afterAudit.latest_result_date,latest_forward_date:afterAudit.latest_forward_date,latest_weekly_date:afterAudit.latest_weekly_date,deduped:dedupe.stats,tkp_normalized:tkp.changed,forward_repaired:fwd.changed,full};
    await persistChanged(source,[...changed],source.settings[STATE_KEY]);
    try{global.dispatchEvent?.(new CustomEvent('tkp:integrity-updated',{detail:source.settings[STATE_KEY]}));}catch(_e){}
    return {ok:true,before,after:source.settings[STATE_KEY],changed:[...new Set(changed)]};
  }catch(e){error=String(e?.message||e);console.warn('R19.2 integrity repair:',e);return {ok:false,error};}
  finally{running=false;}
}
function tkpScheduleIntegrityRepair(options={}){
  if(scheduled||running)return false;scheduled=true;
  const run=async()=>{scheduled=false;return tkpRunIntegrityRepair(options);};
  if(typeof global.tkpQueueTask==='function')global.tkpQueueTask(options.full?'r19-integrity-full':'r19-integrity-incremental',run,{priority:'background',replace:true,minIdleMs:options.full?3000:1500});
  else setTimeout(run,options.full?2500:900);
  return true;
}
function tkpIntegrityStatus(){return lastAudit||tkpIntegrityAudit(global.db);}

global.TKP_R19_INTEGRITY_VERSION=VERSION;
global.tkpIntegrityRaceKey=tkpIntegrityRaceKey;
global.tkpIntegrityDedupeByKey=tkpIntegrityDedupeByKey;
global.tkpIntegrityPreferResolved=tkpIntegrityPreferResolved;
global.tkpIntegrityMergeForwardRows=tkpIntegrityMergeForwardRows;
global.tkpIntegrityAudit=tkpIntegrityAudit;
global.tkpRunIntegrityRepair=tkpRunIntegrityRepair;
global.tkpScheduleIntegrityRepair=tkpScheduleIntegrityRepair;
global.tkpIntegrityStatus=tkpIntegrityStatus;

if(typeof global.addEventListener==='function'){
  global.addEventListener('tkp:db-changed',ev=>{
    const d=ev?.detail||{};if(String(d?.label||'').startsWith('r19-integrity'))return;
    const cols=Array.isArray(d.collections)?d.collections:[];
    if(d.outcomeChanged||d.resultsChanged||cols.includes('races')||cols.includes('auto_coupon_log'))tkpScheduleIntegrityRepair({full:false,reason:'db-change'});
  });
  global.addEventListener('load',()=>setTimeout(()=>tkpScheduleIntegrityRepair({full:true,reason:'startup'}),2200),{once:true});
}
})(typeof globalThis!=='undefined'?globalThis:window);
