(function(g){'use strict';
const VERSION='TOP3-SINGLE-HISTORY-V1',MIN_SAMPLE=30;
const norm=s=>String(s??'').toLocaleUpperCase('tr-TR').replace(/[İIı]/g,'I');
const identity=r=>[r?.race_date,norm(r?.hippodrome),Number(r?.altili_no)||1,Number(r?.leg)||0].join('|');
const group=n=>String(n).match(/-E\d+$/i)?.[0].toUpperCase()||String(n);
const same=(a,b)=>group(a)===group(b);
const running=h=>h&&!['scratched','non_runner','is_non_runner','usa_scratched','atr_non_runner'].some(k=>Number(h[k])===1)&&!(typeof g.isNonRunner==='function'&&g.isNonRunner(h));
const agfBand=n=>n>=1&&n<=3?String(n):n<=6&&n>0?'4-6':n>6?'7+':'missing';
const profBand=n=>n==null||!Number.isFinite(Number(n))?'missing':Number(n)>=75?'75+':Number(n)>=60?'60-74':Number(n)>=40?'40-59':Number(n)>=20?'20-39':'under20';
function features(h,rank){return {rank,agf:agfBand(Number(h.agf_rank)),prof:profBand(h.prof??h.profile_strength_pct??h.prediction_profile_strength_snapshot??h.profile_power)};}
function topThree(rows){const out=[],seen=new Set();for(const h of rows||[]){if(!running(h))continue;const k=group(h.horse_no);if(seen.has(k))continue;seen.add(k);out.push(h);if(out.length===3)break;}return out;}
function buildCases(source,cutoff){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(cutoff))return [];
  const proof=new Map(),official=new Map(),conflicts=new Set();
  for(const p of source?.prediction_log||[]){
    if(!p.race_date||p.race_date>=cutoff||p.evidence_class!=='LIVE_PRE_RACE_LOCKED'||!p.immutable_snapshot_hash
      ||!(Date.parse(p.captured_at)<Date.parse(p.race_start_at)))continue;
    const k=identity(p);if(!proof.has(k))proof.set(k,new Map());
    const batch=[p.immutable_snapshot_hash,p.captured_at,p.race_start_at].join('|'),batches=proof.get(k);
    if(!batches.has(batch))batches.set(batch,[]);batches.get(batch).push(p);
  }
  for(const r of source?.races||[]){
    if(!r.race_date||r.race_date>=cutoff||r.result_integrity_status!=='VERIFIED')continue;
    const w=(r.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);
    if(w.length!==1)continue;const k=identity(r),no=String(w[0].horse_no);
    if(official.has(k)&&!same(official.get(k),no))conflicts.add(k);else official.set(k,no);
  }
  const earliest=new Map();
  for(const rec of source?.forward_tracking_log||[]){
    if(!rec.race_date||rec.race_date>=cutoff||rec.evidence_lane!=='LIVE_FORWARD'||rec.historical_calibration
      ||!rec.evaluated_at||!rec.winner_no)continue;
    const k=identity(rec),batches=proof.get(k),winner=official.get(k);
    if(!batches||!winner||conflicts.has(k)||!same(winner,rec.winner_no))continue;
    const batch=[...batches.values()].filter(logs=>{
      const ranks=logs.map(p=>Number(p.common_rank??p.predicted_rank));
      return logs.length>=3&&new Set(logs.map(p=>String(p.horse_no))).size===logs.length
        &&new Set(ranks).size===ranks.length&&ranks.every(n=>Number.isInteger(n)&&n>=1&&n<=logs.length)
        &&Date.parse(rec.created_at)<Date.parse(logs[0].race_start_at);
    }).sort((a,b)=>String(a[0].captured_at).localeCompare(String(b[0].captured_at)))[0];
    if(!batch)continue;
    // Forward rows corroborate timing/results only. Train exclusively on the locked batch.
    const rows=topThree(batch.slice().sort((a,b)=>Number(a.common_rank??a.predicted_rank)-Number(b.common_rank??b.predicted_rank)));
    if(rows.length!==3)continue;
    if(!earliest.has(k)||String(rec.created_at)<String(earliest.get(k).created_at))earliest.set(k,{key:k,date:rec.race_date,created_at:rec.created_at,winner,rows:rows.map((h,i)=>({horseNo:String(h.horse_no),...features(h,i+1),win:same(h.horse_no,winner)?1:0})),surface:batch[0].surface,breed:batch[0].breed,featureSource:'LOCKED_PREDICTION_BATCH'});
  }
  return [...earliest.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
}
let memo=null;
function casesFor(source,cutoff){
  const f=source?.forward_tracking_log,p=source?.prediction_log,r=source?.races;
  const revision=typeof _tkpDbRevision==='number'?_tkpDbRevision:0;
  const signature=[cutoff,f?.length,p?.length,r?.length,revision,f?.[f.length-1]?.evaluated_at].join('|');
  if(memo?.source===source&&memo.signature===signature&&memo.f===f&&memo.p===p&&memo.r===r)return memo.cases;
  const cases=buildCases(source,cutoff);memo={source,signature,f,p,r,cases};return cases;
}
function estimate(cases,f,race){
  const samples=cases.flatMap(c=>c.rows.map(h=>({...h,surface:c.surface,breed:c.breed})));
  const bases=[['rank_agf_profile_course',h=>h.rank===f.rank&&h.agf===f.agf&&h.prof===f.prof&&norm(h.surface)===norm(race.surface)&&norm(h.breed)===norm(race.breed)],
    ['rank_agf_profile',h=>h.rank===f.rank&&h.agf===f.agf&&h.prof===f.prof],['rank_agf',h=>h.rank===f.rank&&h.agf===f.agf],['rank',h=>h.rank===f.rank]];
  for(const [basis,test] of bases){const rows=samples.filter(test);if(rows.length<MIN_SAMPLE)continue;const wins=rows.reduce((n,h)=>n+h.win,0);return {sample:rows.length,wins,rate:(wins+2)/(rows.length+8),basis};}
  return {sample:0,wins:0,rate:null,basis:'insufficient'};
}
function select(race,order,options={}){
  const hs=topThree(order);if(!hs.length)return {horse:null,audit:{version:VERSION,candidates:[],reason:'NO_ELIGIBLE_CANDIDATE',sample:0}};
  let source=options.source;try{if(!source)source=typeof db!=='undefined'?db:g.db;}catch(_){source=null;}
  const cutoff=String(race?.race_date||'').slice(0,10),cases=options.cases||casesFor(source,cutoff);
  const probabilities=new Map((options.probabilities||[]).map(o=>[String(o.h?.horse_no),Number(o.p)||0]));
  const rows=hs.map((horse,i)=>({horse,horseNo:String(horse.horse_no),rank:i+1,probability:probabilities.get(String(horse.horse_no))||0,...estimate(cases,features(horse,i+1),race||{})}));
  const allowed=options.eligibleNos?new Set(options.eligibleNos.map(String)):null;
  const candidates=rows.filter(x=>!allowed||allowed.has(x.horseNo));
  if(!candidates.length)return {horse:null,audit:{version:VERSION,cutoff,candidates:rows.map(({horse,...x})=>x),reason:'NO_ELIGIBLE_CANDIDATE',sample:0}};
  const fallback=candidates.slice().sort((a,b)=>b.probability-a.probability||a.rank-b.rank)[0];
  const eligible=candidates.filter(x=>x.sample>=MIN_SAMPLE&&x.rate!=null).sort((a,b)=>b.rate-a.rate||b.probability-a.probability||a.rank-b.rank);
  let best=fallback,reason='INSUFFICIENT_VERIFIED_HISTORY';
  const historicalFallback=eligible.find(x=>x.horseNo===fallback.horseNo);
  if(historicalFallback&&eligible.length>1){best=eligible[0];if(best.horseNo!==historicalFallback.horseNo&&best.rate<historicalFallback.rate+.02)best=historicalFallback;reason='HISTORICAL_TOP3_COMPARISON';}
  return {horse:best.horse,estimatedRate:reason==='HISTORICAL_TOP3_COMPARISON'?best.rate:best.probability||null,audit:{version:VERSION,cutoff,reason,sample:best.sample,selectedRank:best.rank,horseNo:best.horseNo,selectedRate:best.rate,candidates:rows.map(({horse,...x})=>x)}};
}
g.TKP_TOP3_SINGLE=Object.freeze({VERSION,MIN_SAMPLE,buildCases,select,topThree,reset(){memo=null;}});
})(globalThis);
