(function(root,factory){
  const api=factory(root||globalThis);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)Object.assign(root,api);
})(typeof globalThis!=='undefined'?globalThis:this,function(g){
'use strict';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));
const isoDate=v=>{const m=String(v||'').match(/^(20\d{2})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';};
const finishKnown=h=>Number.isInteger(Number(h?.finish_position))&&Number(h.finish_position)>0;
const calibratorCache=new Map();
function clearMarginalGainCache(){calibratorCache.clear();}
try{if(typeof g?.addEventListener==='function')g.addEventListener('tkp:db-changed',e=>{const d=e?.detail||{};if(d.resultsChanged||d.outcomeChanged||d.learningChanged)clearMarginalGainCache();});}catch(_e){}
function historicalScore(h,r){
  const candidates=[h?.prediction_score_snapshot,h?.predictionScoreSnapshot,h?.pre_race_score,h?.score_pre_result];
  for(const value of candidates){const n=Number(value);if(Number.isFinite(n))return n;}
  const locked=Boolean(h?.prediction_score_locked||r?.prediction_score_locked||r?.pre_race_snapshot_locked||r?.strict_no_result_leakage_from);
  if(locked){const n=Number(h?.score);if(Number.isFinite(n))return n;}
  return null;
}
function liveScore(h){
  for(const value of [h?.score,h?.prediction_score_snapshot,h?.tkp_score,h?.model_score]){const n=Number(value);if(Number.isFinite(n))return n;}
  return null;
}

function pavaFit(rows){
  const points=(rows||[]).map(r=>({score:Number(r.score),y:clamp(r.y),weight:Math.max(1e-9,Number(r.weight)||1)}))
    .filter(r=>Number.isFinite(r.score)).sort((a,b)=>a.score-b.score);
  if(!points.length)return [];
  const grouped=[];
  for(const p of points){
    const last=grouped[grouped.length-1];
    if(last&&last.maxScore===p.score){last.sumY+=p.y*p.weight;last.weight+=p.weight;last.p=last.sumY/last.weight;last.count++;continue;}
    grouped.push({minScore:p.score,maxScore:p.score,sumY:p.y*p.weight,weight:p.weight,p:p.y,count:1});
  }
  const blocks=[];
  for(const row of grouped){
    blocks.push({...row});
    while(blocks.length>=2){
      const b=blocks[blocks.length-1],a=blocks[blocks.length-2];
      if(a.p<=b.p+1e-15)break;
      blocks.splice(blocks.length-2,2,{
        minScore:a.minScore,maxScore:b.maxScore,sumY:a.sumY+b.sumY,weight:a.weight+b.weight,
        p:(a.sumY+b.sumY)/(a.weight+b.weight),count:a.count+b.count
      });
    }
  }
  return blocks;
}
function pavaPredict(blocks,score){
  const s=Number(score);if(!Number.isFinite(s)||!blocks?.length)return null;
  if(s<=blocks[0].maxScore)return clamp(blocks[0].p,1e-6,1-1e-6);
  for(let i=1;i<blocks.length;i++)if(s<=blocks[i].maxScore)return clamp(blocks[i].p,1e-6,1-1e-6);
  return clamp(blocks[blocks.length-1].p,1e-6,1-1e-6);
}
function wilsonLowerBound(successes,total,z=1.96){
  const n=Number(total),x=Number(successes);if(!(n>0)||!Number.isFinite(x))return 0;
  const p=x/n,z2=z*z,den=1+z2/n;
  return clamp((p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/den);
}
function buildWalkForwardCalibrator(targetRace,db,options={}){
  const minObs=Math.max(1,Number(options.minObservations)||200);
  const targetDate=isoDate(targetRace?.race_date||targetRace?.date);
  if(!targetDate)return {fallback:true,reason:'TARGET_DATE_UNREADABLE',observations:0,predict:()=>null};
  const races=db?.races||[];
  const cacheKey=`${targetDate}|${minObs}|${races.length}|${db?.files?.length||0}|${db?.auto_coupon_log?.length||0}`;
  if(options.noCache!==true&&calibratorCache.has(cacheKey))return calibratorCache.get(cacheKey);
  const points=[];let maxTrainingDate='';
  for(const race of races){
    const d=isoDate(race?.race_date||race?.date);if(!d||d>=targetDate)continue;
    if(race?.strict_no_result_leakage_from&&isoDate(race.strict_no_result_leakage_from)&&isoDate(race.strict_no_result_leakage_from)<d)continue;
    const horses=(race?.horses||[]).filter(finishKnown);if(!horses.length)continue;
    for(const h of horses){
      const score=historicalScore(h,race);if(!Number.isFinite(score))continue;
      points.push({score,y:Number(h.finish_position)===1?1:0});
      if(d>maxTrainingDate)maxTrainingDate=d;
    }
  }
  if(points.length<minObs){const out={fallback:true,reason:'INSUFFICIENT_HISTORY',observations:points.length,maxTrainingDate,predict:()=>null};if(options.noCache!==true)calibratorCache.set(cacheKey,out);return out;}
  const blocks=pavaFit(points);
  if(!blocks.length){const out={fallback:true,reason:'PAVA_EMPTY',observations:points.length,maxTrainingDate,predict:()=>null};if(options.noCache!==true)calibratorCache.set(cacheKey,out);return out;}
  const out={fallback:false,observations:points.length,maxTrainingDate,blocks,predict:(score)=>pavaPredict(blocks,score)};if(options.noCache!==true)calibratorCache.set(cacheKey,out);while(calibratorCache.size>32)calibratorCache.delete(calibratorCache.keys().next().value);return out;
}
function blendedProbability(h,cal,options={}){
  const score=liveScore(h),pIso=cal?.predict?.(score);
  if(!Number.isFinite(pIso))return null;
  const r18=Number(h?.win_probability??h?.r18_win_probability??h?.winProbability);
  const useBlend=options.blendR18!==false&&Number.isFinite(r18)&&r18>=0&&r18<=1;
  if(!useBlend)return clamp(pIso,1e-6,1-1e-6);
  const w=clamp(options.r18Weight==null?.35:options.r18Weight,0,0.8);
  return clamp((1-w)*pIso+w*r18,1e-6,1-1e-6);
}
function coverageProbabilities(ranked,cal,options={}){
  const rows=(ranked||[]).map((h,index)=>({h,index,p:blendedProbability(h,cal,options)}));
  if(rows.some(r=>!Number.isFinite(r.p)))return [];
  const sum=Math.max(1e-12,rows.reduce((s,r)=>s+r.p,0));
  let cumulative=0;
  return rows.map(r=>{
    const p=r.p/sum;cumulative=Math.min(1,cumulative+p);
    return {horse:r.h,horse_no:String(r.h?.horse_no??''),probability:p,cumulative};
  });
}
function marginalGainCoverageForLeg(leg,ranked,options={}){
  const enabled=g.__tkpUseMarginalGainOptimizer!==false;
  const cal=buildWalkForwardCalibrator(leg?.r||{},options.db||g.db||{},options);
  if(!enabled||cal.fallback)return {use:false,reason:enabled?cal.reason:'OPT_OUT',calibrator:cal,coverage:[]};
  const coverage=coverageProbabilities(ranked,cal,options);
  if(!coverage.length)return {use:false,reason:'PROBABILITY_UNAVAILABLE',calibrator:cal,coverage:[]};
  return {use:true,reason:'PAVA',calibrator:cal,coverage};
}
function dpUtilityBridge(leg,ranked,legacyProbabilities,options={}){
  const result=marginalGainCoverageForLeg(leg,ranked,options);
  const shadow=Boolean(g.__tkpMarginalGainShadow);
  if(shadow){
    if(!Array.isArray(g.__tkpMarginalGainShadowLog))g.__tkpMarginalGainShadowLog=[];
    g.__tkpMarginalGainShadowLog.push({ts:new Date().toISOString(),date:leg?.r?.race_date||'',leg:leg?.r?.leg||null,reason:result.reason,observations:result.calibrator?.observations||0,coverage:result.coverage.map(x=>x.cumulative),legacy:(legacyProbabilities||[]).slice()});
    if(g.__tkpMarginalGainShadowLog.length>500)g.__tkpMarginalGainShadowLog.splice(0,g.__tkpMarginalGainShadowLog.length-500);
    return {use:false,reason:'SHADOW',probabilities:legacyProbabilities||[],meta:result};
  }
  return result.use?{use:true,reason:'PAVA',probabilities:result.coverage.map(x=>x.cumulative),meta:result}:{use:false,reason:result.reason,probabilities:legacyProbabilities||[],meta:result};
}
return {pavaFit,pavaPredict,wilsonLowerBound,buildWalkForwardCalibrator,coverageProbabilities,marginalGainCoverageForLeg,dpUtilityBridge,tkpMarginalGainDpUtilityBridge:dpUtilityBridge,clearMarginalGainCache};
});
