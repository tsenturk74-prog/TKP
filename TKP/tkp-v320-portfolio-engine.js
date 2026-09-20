(function(global){'use strict';
/**
 * TKP V1.1.333 — Forward-safe diversified 3-coupon portfolio
 *
 * The V330 speed baseline stays untouched. This final coupon authority constrains
 * the shared TEK inside the same DP that allocates every coupon's width/cost.
 * Normal and Uzman + Kulis share the candidate; Sürpriz stays independent.
 *
 * No outcome, finish or payout value is read here.
 */
const VERSION='V1.1.333-FORWARD-SAFE-DIVERSIFIED-PORTFOLIO';
const PROFILES=Object.freeze({
  main:Object.freeze({key:'main',label:'Normal',alpha:.60,temp:1.45,targetBudgetTL:800,sourceBias:.10,overlapPenalty:0}),
  alt:Object.freeze({key:'alt',label:'Sürpriz',alpha:.80,temp:1.45,targetBudgetTL:900,sourceBias:.42,overlapPenalty:.72,highUpsideShadow:true}),
  surprise:Object.freeze({key:'surprise',label:'Uzman + Kulis',alpha:0,temp:1.00,targetBudgetTL:900,sourceBias:.22,overlapPenalty:.10})
});
const EVIDENCE=Object.freeze({archiveMeetingsAudited:509,completeFrozenMeetings:387,trainMeetings:232,validationMeetings:77,holdoutMeetings:78,portfolioValidationHits:15,portfolioHoldoutHits:15,portfolioHoldoutPct:19.23,totalNominalBudgetTL:2600,min2HoldoutHits:12,min2HoldoutPct:15.38,retrospectiveOnly:true,forwardEvidenceRequired:true});
// The historical replay selected one high-confidence candidate, never a forced pair.
// No qualified candidate is a no-op; it never invents a TEK.
const SHARED_GOLD_TEK_POLICY=Object.freeze({
  version:'V1.1.333-GOLD-SHADOW-UNTIL-LIVE-LOCKED',
  label:'GOLD ortak TEK',
  sharedCouponKeys:Object.freeze(['main','surprise']),
  maxSingles:1,minAgf:60,minAgfGap:50,maxFieldSize:12,maxWeightKg:60,
  preRaceOnly:true,requiresVerifiedLiveSnapshot:true,
  replay:Object.freeze({retrospectiveReplay:true,notForwardEvidence:true})
});
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d;}
function finite(v){return Number.isFinite(Number(v));}
function liveHorse(h){try{return !(typeof global.isNonRunner==='function'&&global.isNonRunner(h));}catch(_){return true;}}
function no(h){return String(h?.horse_no??'');}
function baseNo(h){try{return String(typeof global.ekuriBase==='function'?global.ekuriBase(h?.horse_no):h?.horse_no);}catch(_){return no(h);}}
function legKey(leg,index=0){const r=leg?.r||leg?.x?.r||{};return String(r?.leg??leg?.leg??index+1);}
function zMap(rows,getter){
  const vals=rows.map(h=>{const x=Number(getter(h));return Number.isFinite(x)?x:NaN;});
  const known=vals.filter(Number.isFinite);if(!known.length)return new Map(rows.map(h=>[h,0]));
  const mean=known.reduce((a,b)=>a+b,0)/known.length;
  const variance=known.reduce((s,x)=>s+(x-mean)*(x-mean),0)/known.length;
  const sd=Math.sqrt(Math.max(variance,1e-12));
  return new Map(rows.map((h,i)=>[h,Number.isFinite(vals[i])?(vals[i]-mean)/sd:0]));
}
function modelValue(h){
  for(const v of [h?.score,h?.tkp_score,h?.pre_race_tkp_score,h?.altili_winner_score]){const x=Number(v);if(Number.isFinite(x))return x;}
  return 0;
}
function marketValue(h){
  const agf=Number(h?.agf);if(Number.isFinite(agf)&&agf>=0)return Math.log1p(agf);
  const rank=Number(h?.agf_rank);return Number.isFinite(rank)&&rank>0?Math.log1p(100/Math.max(1,rank)):0;
}
function profileOrder(race,source,profileKey,opts={}){
  const p=PROFILES[profileKey]||PROFILES.main;
  const rows=Array.from(source||race?.horses||[]).filter(h=>h&&liveHorse(h));
  if(!rows.length)return [];
  // R16.63: Son dağıtım katmanı Benter'i eski AGF/puan formülüyle ezemez.
  // Rol/çeşitlilik yalnız seçim faydasını etkiler; gerçek olasılık kütlesi
  // yeniden softmax edilmez. Eküri ortaklarının olasılıkları toplanır.
  if(typeof global.tkpProbabilityPortfolioOrderForRace==='function'){
    const estimated=global.tkpProbabilityPortfolioOrderForRace(race,rows,profileKey);
    const groups=new Map(),sourceRanks=new Map(rows.map((h,i)=>[no(h),i]));
    const avoid=opts.avoidBases instanceof Set?opts.avoidBases:new Set();
    for(const h of estimated){
      const key=baseNo(h)||no(h),prob=Number(h.tkp_probability);
      if(!Number.isFinite(prob)||prob<0)continue;
      if(groups.has(key))groups.get(key).prob+=prob;
      else groups.set(key,{horse:h,prob});
    }
    const result=Array.from(groups.values()),total=result.reduce((s,row)=>s+row.prob,0);
    if(result.length&&total>0){
      for(const row of result){
        row.prob/=total;
        const key=baseNo(row.horse)||no(row.horse),rank=sourceRanks.get(no(row.horse))||0;
        row.utility=Math.log(Math.max(1e-12,row.prob))+p.sourceBias*(1-rank/Math.max(1,rows.length-1))-(avoid.has(key)?p.overlapPenalty:0);
      }
      result.sort((a,b)=>b.utility-a.utility||b.prob-a.prob||no(a.horse).localeCompare(no(b.horse),undefined,{numeric:true}));
      let cum=0;return result.map(row=>{cum+=row.prob;return {...row,cum};});
    }
  }
  const mz=zMap(rows,modelValue),az=zMap(rows,marketValue);
  const sourceRank=new Map(rows.map((h,i)=>[baseNo(h)||no(h),i]));
  const avoid=opts.avoidBases instanceof Set?opts.avoidBases:new Set();
  const utility=new Map(rows.map(h=>{
    const key=baseNo(h)||no(h),rank=sourceRank.get(key)||0,sourceBonus=p.sourceBias*(1-rank/Math.max(1,rows.length-1));
    const overlap=avoid.has(key)?p.overlapPenalty:0;
    return [h,(p.alpha*n(mz.get(h))+(1-p.alpha)*n(az.get(h)))/Math.max(.05,p.temp)+sourceBonus-overlap];
  }));
  rows.sort((a,b)=>n(utility.get(b))-n(utility.get(a))||n(modelValue(b))-n(modelValue(a))||n(marketValue(b))-n(marketValue(a))||TKP_TR_COLLATOR_NUM.compare(no(a),no(b)));
  const seen=new Set(),unique=[];
  for(const h of rows){const k=baseNo(h);if(k&&seen.has(k))continue;if(k)seen.add(k);unique.push(h);}
  const maxU=Math.max(...unique.map(h=>n(utility.get(h))),0),ex=unique.map(h=>Math.exp(n(utility.get(h))-maxU)),den=ex.reduce((a,b)=>a+b,0)||1;
  let cum=0;
  return unique.map((h,i)=>{const prob=ex[i]/den;cum+=prob;return {horse:h,prob,cum,utility:n(utility.get(h))};});
}
function frozenRank(h){
  for(const v of [h?.prediction_order_snapshot,h?.predicted_rank,h?.pre_race_rank])if(finite(v)&&Number(v)>0)return Number(v);
  return null;
}
function verifiedLiveSnapshot(h){
  if(!h)return false;
  if(h.prediction_snapshot_provenance==='HISTORICAL_ARCHIVE_RECONSTRUCTED'||Number(h.prediction_snapshot_verified_pre_race)===0)return false;
  return Number(h.prediction_snapshot_verified_pre_race)===1||h.prediction_score_locked===true||Number(h.prediction_score_locked)===1||h.prediction_snapshot_provenance==='LIVE_PRE_RACE_LOCKED';
}
function rankOf(h,field){const x=Number(h?.[field]);return Number.isFinite(x)&&x>0?x:null;}
function weightKg(h){
  for(const v of [h?.weight_kg,h?.weightKg,h?.weight,h?.kilo,h?.kg,h?.siklet,h?.siklet_kg]){
    const m=String(v??'').replace(',','.').match(/\d+(?:\.\d+)?/);if(m)return Number(m[0]);
  }
  return null;
}
function frozenOrder(race,source){
  const rows=Array.from(source||race?.horses||[]).filter(h=>h&&liveHorse(h));
  if(rows.some(h=>frozenRank(h)!==null))return rows.slice().sort((a,b)=>(frozenRank(a)??9999)-(frozenRank(b)??9999)||n(modelValue(b))-n(modelValue(a))||TKP_TR_COLLATOR_NUM.compare(no(a),no(b)));
  try{if(typeof global.altiliWinnerOrderForRace==='function')return global.altiliWinnerOrderForRace(race,rows.slice())||rows;}catch(_){}
  return rows.slice().sort((a,b)=>n(modelValue(b))-n(modelValue(a))||n(marketValue(b))-n(marketValue(a))||TKP_TR_COLLATOR_NUM.compare(no(a),no(b)));
}
function passesCommonRankGate(rows,first){
  const commonKnown=rows.some(h=>rankOf(h,'common_rank')!==null);
  if(commonKnown&&rankOf(first,'common_rank')!==1)return false;
  const sideKnown=rows.some(h=>rankOf(h,'sidebet_p1_rank')!==null);
  return !sideKnown||rankOf(first,'sidebet_p1_rank')===1;
}
function strongSingleDecision(race,order,first,second){
  if(typeof global.dynamicSingleDecision!=='function')return null;
  try{
    const d=global.dynamicSingleDecision({r:race,scored:order,strictPool:order},first,second||null);
    if(!d||d.isSingle!==true||d.scoreOk!==true||d.profileOk!==true||d.profileGapOk!==true||d.sampleOk!==true||d.evidenceOk!==true||d.weightOk!==true)return null;
    return d;
  }catch(_){return null;}
}
function goldCandidateForLeg(leg,index=0){
  const race=leg?.r||leg?.x?.r;if(!race)return null;
  const rows=Array.from(race?.horses||leg?.allHorses||leg?.displayOrder||[]).filter(h=>h&&liveHorse(h));
  if(rows.length<2||rows.length>SHARED_GOLD_TEK_POLICY.maxFieldSize||!rows.every(verifiedLiveSnapshot)||!rows.some(h=>frozenRank(h)!==null))return null;
  const order=frozenOrder(race,rows),first=order[0]||null,second=order[1]||null;
  if(!first||!second||frozenRank(first)!==1||!passesCommonRankGate(rows,first))return null;
  if(rankOf(first,'agf_rank')!==1||n(first?.agf,-1)<SHARED_GOLD_TEK_POLICY.minAgf)return null;
  const firstWeight=weightKg(first);if(!(firstWeight>0&&firstWeight<=SHARED_GOLD_TEK_POLICY.maxWeightKg))return null;
  try{if(typeof global.canBeCouponSingle==='function'&&!global.canBeCouponSingle(first))return null;}catch(_){return null;}
  const agfGap=n(first?.agf,0)-n(second?.agf,0);if(agfGap<SHARED_GOLD_TEK_POLICY.minAgfGap)return null;
  const decision=strongSingleDecision(race,order,first,second);if(!decision)return null;
  return {legKey:legKey(leg,index),leg:Number(race?.leg??leg?.leg??index+1),horseNo:no(first),baseNo:baseNo(first),agf:n(first?.agf,0),agfGap,weightKg:firstWeight,fieldSize:rows.length,confidence:n(decision?.confidence,0),reason:'P1+ortak sıra+AGF#1 · GOLD eşikleri'};
}
function selectSharedGoldSingles(built){
  const source=['main','surprise','alt'].map(k=>built?.[k]).find(c=>Array.isArray(c?.legs)&&c.legs.length===6);
  const plan=new Map();if(!source)return plan;
  const candidates=source.legs.map((leg,index)=>goldCandidateForLeg(leg,index)).filter(Boolean);
  candidates.sort((a,b)=>b.agf-a.agf||b.agfGap-a.agfGap||b.confidence-a.confidence||a.leg-b.leg);
  for(const candidate of candidates.slice(0,SHARED_GOLD_TEK_POLICY.maxSingles))plan.set(candidate.legKey,candidate);
  return plan;
}
function planForLeg(plan,leg,index){return plan instanceof Map?plan.get(legKey(leg,index))||null:null;}
function movePinnedFirst(rows,pin){
  if(!pin)return rows;
  const wanted=String(pin.baseNo||pin.horseNo),at=rows.findIndex(row=>String(baseNo(row?.horse))===wanted||no(row?.horse)===String(pin.horseNo));
  if(at<0)return null;
  const moved=[rows[at]].concat(rows.slice(0,at),rows.slice(at+1));
  let cum=0;return moved.map(row=>{cum+=n(row?.prob,0);return {...row,cum};});
}
function bestCounts(orders,maxCombos,maxK=10,fixedSingles=null,sharedMode=false,allowedSingles=null){
  const fixed=fixedSingles instanceof Set?fixedSingles:new Set(Array.isArray(fixedSingles)?fixedSingles:[]);
  const allowed=allowedSingles===null?null:(allowedSingles instanceof Set?allowedSingles:new Set(allowedSingles));
  let states=new Map([[1,{score:0,counts:[]}]]);
  for(let index=0;index<orders.length;index++){
    const rows=orders[index],next=new Map(),mk=Math.min(maxK,rows.length);if(mk<1)return null;
    const minK=fixed.has(index)?1:((sharedMode||allowed&& !allowed.has(index))&&mk>1?2:1),maxForLeg=fixed.has(index)?1:mk;
    for(const [prod,state] of states.entries())for(let k=minK;k<=maxForLeg;k++){
      const q=prod*k;if(q>maxCombos)break;
      const mass=Math.max(1e-12,n(rows[k-1]?.cum,0)),score=state.score+Math.log(mass),prev=next.get(q);
      if(!prev||score>prev.score+1e-12||(Math.abs(score-prev.score)<=1e-12&&q<prod))next.set(q,{score,counts:state.counts.concat(k)});
    }
    states=next;if(!states.size)return null;
  }
  let best=null;
  for(const [prod,state] of states.entries())if(!best||state.score>best.score+1e-12||(Math.abs(state.score-best.score)<=1e-12&&prod<best.prod))best={prod,score:state.score,counts:state.counts};
  return best;
}
function couponUnit(coupon){const u=n(coupon?.unit,0);return u>0?u:1;}
function userCap(coupon,fallback=1400){for(const v of [coupon?.userCapTL,coupon?.maxBudgetTL,coupon?.inputCapTL,coupon?.budgetTL]){const x=n(v,0);if(x>0)return Math.max(700,Math.min(1400,x));}return fallback;}
function allocationTarget(coupon,profile){
  const cap=userCap(coupon,profile.targetBudgetTL),difficultyTarget=n(coupon?.budgetTL,0);
  return difficultyTarget>0?Math.min(cap,Math.max(Math.min(1000,cap),difficultyTarget)):cap;
}
function planSummary(plan){return Array.from(plan instanceof Map?plan.values():[]).map(x=>({...x}));}
function sourceForLeg(leg){
  const sources=[leg?.portfolioCandidatePool,leg?.displayOrder,leg?.ordered,leg?.strictPool,leg?.allHorses,leg?.r?.horses,leg?.picks];
  const out=[],seen=new Set();
  for(const source of sources)for(const h of Array.from(source||[])){const k=no(h);if(!h||!k||seen.has(k))continue;seen.add(k);out.push(h);}
  return out;
}
function trustedSingleIndexes(coupon,pins,orders){
  const candidates=[];
  coupon.legs.forEach((leg,index)=>{if(pins[index]){candidates.push({index,confidence:999});return;}const plan=leg?.confidencePlan,first=orders?.[index]?.[0]?.horse;
    const sameCandidate=first&&(leg.picks||[]).length===1&&baseNo(first)===baseNo(leg.picks[0]);
    if(sameCandidate&&first.tkp_benter_status!=='DEGER_YOK'&&plan?.reliable===true&&plan?.strategySingle===true&&plan?.strategySingleFallback!==true&&plan?.xBreakSingle!==true){candidates.push({index,confidence:n(plan?.confidence,0)});}});
  candidates.sort((a,b)=>b.confidence-a.confidence||a.index-b.index);
  return new Set(candidates.slice(0,2).map(x=>x.index));
}
function applyCoupon(coupon,profileKey,sharedPlan=null,sharedEnabled=false){
  const p=PROFILES[profileKey]||PROFILES.main;if(!coupon||coupon.error||coupon.disabled||!Array.isArray(coupon.legs)||coupon.legs.length!==6)return coupon;
  const target=allocationTarget(coupon,p),unit=couponUnit(coupon),maxCombos=Math.floor((target+1e-9)/Math.max(.0001,unit));
  const pins=coupon.legs.map((leg,index)=>sharedEnabled?planForLeg(sharedPlan,leg,index):null);
  const avoidBases=coupon?.portfolioAvoidBases instanceof Set?coupon.portfolioAvoidBases:new Set(coupon?.portfolioAvoidBases||[]);
  const orders=coupon.legs.map((leg,index)=>movePinnedFirst(profileOrder(leg?.r,sourceForLeg(leg),p.key,{avoidBases:coupon.portfolioAvoidByLeg instanceof Map?(coupon.portfolioAvoidByLeg.get(legKey(leg,index))||new Set()):avoidBases}),pins[index]));
  if(orders.some(x=>!Array.isArray(x)||!x.length))return coupon;
  const fixedSingles=new Set(pins.map((pin,index)=>pin?index:-1).filter(index=>index>=0));
  const solution=bestCounts(orders,maxCombos,10,fixedSingles,sharedEnabled,trustedSingleIndexes(coupon,pins,orders));if(!solution)return coupon;
  coupon.legs.forEach((leg,i)=>{
    const order=orders[i].map(x=>x.horse),count=solution.counts[i],pin=pins[i];
    leg.picks=order.slice(0,count);leg.displayOrder=order.slice();leg.ordered=order.slice();leg.allHorses=order.slice();leg.coverageMode=p.key;
    leg.portfolioProbability={version:VERSION,alpha:p.alpha,temp:p.temp,count,mass:n(orders[i][count-1]?.cum,0),source:typeof global.tkpProbabilityPortfolioOrderForRace==='function'?'BENTER':'LEGACY',validated:false};
    if(pin){
      leg.sharedGoldTek=true;leg.sharedTek=true;leg.sharedGoldTekPlan={...pin};
      leg.confidencePlan={reliable:true,strategySingle:true,sharedPortfolioSingle:true,reason:'V1.1.333 GOLD ortak TEK · Normal + Uzman'};
    }else{
      delete leg.sharedGoldTek;delete leg.sharedTek;delete leg.sharedGoldTekPlan;
      leg.confidencePlan=count===1?{reliable:true,strategySingle:true,reason:'V1.1.333 doğrulanmış ön-teklif TEK'}:{reliable:false,reason:'V1.1.333 olasılık kütlesi kapsaması'};
    }
  });
  coupon.combos=solution.prod;coupon.cost=Math.round(solution.prod*unit*100)/100;coupon.budgetTL=target;coupon.leftover=Math.round((target-coupon.cost)*100)/100;
  coupon.reliableSingles=coupon.legs.filter(l=>(l.picks||[]).length===1).length;
  coupon.algorithmVersion=VERSION;coupon.portfolioProfile={...p,version:VERSION,preRaceOnly:true,evidence:EVIDENCE,highUpsideShadow:p.highUpsideShadow===true};
  coupon.sharedGoldTek=sharedEnabled?planSummary(sharedPlan):[];
  coupon.note=((coupon.note||'')+' · '+`${p.label}: ayrışık aday havuzlu portföy; hedef ${target} TL.${p.highUpsideShadow?' · Yüksek ikramiye hedefi shadow modunda, ROI garantisi değildir.':''}${sharedEnabled?' · GOLD ortak TEK Normal + Uzman+Kulis arasında kilitli.':''}`).trim();
  return coupon;
}
function couponSupportsSharedPlan(coupon,profileKey,plan){
  if(!coupon||coupon.error||coupon.disabled||!Array.isArray(coupon.legs)||coupon.legs.length!==6||!(plan instanceof Map)||!plan.size)return false;
  const supported=Array.from(plan.values()).every(pin=>coupon.legs.some((leg,index)=>{
    if(legKey(leg,index)!==String(pin.legKey))return false;
    const race=leg?.r||leg?.x?.r;
    const rows=Array.from(race?.horses||leg?.allHorses||leg?.displayOrder||leg?.ordered||leg?.picks||[]).filter(h=>h&&liveHorse(h));
    return rows.some(h=>String(baseNo(h))===String(pin.baseNo)||no(h)===String(pin.horseNo));
  }));
  if(!supported)return false;
  const p=PROFILES[profileKey]||PROFILES.main,target=allocationTarget(coupon,p),unit=couponUnit(coupon),maxCombos=Math.floor((target+1e-9)/Math.max(.0001,unit));
  const pins=coupon.legs.map((leg,index)=>planForLeg(plan,leg,index));
  const orders=coupon.legs.map((leg,index)=>movePinnedFirst(profileOrder(leg?.r,sourceForLeg(leg),p.key),pins[index]));
  if(orders.some(x=>!Array.isArray(x)||!x.length))return false;
  const fixedSingles=new Set(pins.map((pin,index)=>pin?index:-1).filter(index=>index>=0));
  return !!bestCounts(orders,maxCombos,10,fixedSingles,true,trustedSingleIndexes(coupon,pins,orders));
}
function applySet(built){
  if(!built||typeof built!=='object')return built;
  const selectedPlan=selectSharedGoldSingles(built);
  // This is an atomic portfolio lock: either the same candidate can be pinned in
  // both Normal and Uzman + Kulis, or neither coupon is changed by this policy.
  const sharedEnabled=selectedPlan.size>0&&couponSupportsSharedPlan(built.main,'main',selectedPlan)&&couponSupportsSharedPlan(built.surprise,'surprise',selectedPlan);
  const sharedPlan=sharedEnabled?selectedPlan:new Map();
  applyCoupon(built.main,'main',sharedPlan,sharedEnabled);
  applyCoupon(built.surprise,'surprise',sharedPlan,sharedEnabled);
  const anchorByLeg=new Map();for(const coupon of [built.main,built.surprise])for(const [index,leg] of (coupon?.legs||[]).entries()){
    const key=legKey(leg,index);if(!anchorByLeg.has(key))anchorByLeg.set(key,new Set());
    for(const h of leg?.picks||[])anchorByLeg.get(key).add(baseNo(h)||no(h));
  }
  if(built.alt){built.alt.portfolioAvoidByLeg=anchorByLeg;built.alt.portfolioAvoidBases=new Set();}
  applyCoupon(built.alt,'alt',null,false);
  const summary=planSummary(sharedPlan);
  built.sharedGoldTek={version:SHARED_GOLD_TEK_POLICY.version,enabled:sharedEnabled,sharedCouponKeys:Array.from(SHARED_GOLD_TEK_POLICY.sharedCouponKeys),plan:summary,preRaceOnly:true};
  built.portfolio320={version:VERSION,evidence:EVIDENCE,profiles:PROFILES,totalNominalTargetTL:Object.values(PROFILES).reduce((s,p)=>s+p.targetBudgetTL,0),preRaceOnly:true,sharedGoldTek:built.sharedGoldTek,forwardEvidenceRequired:true,surpriseHighUpsideShadow:true};
  return built;
}
function score(race,horse,profileKey,source){const rows=profileOrder(race,source||race?.horses||[] ,profileKey);const row=rows.find(x=>x.horse===horse||no(x.horse)===no(horse));return row?row.prob:0;}
// R16.64: One selective 2 -> 3 expansion per coupon. This policy threshold
// is a transparent heuristic, not a fitted or forward-validated coefficient.
function rebalanceThirdHorse(coupon,profileKey='main'){
  if(!coupon||coupon.error||coupon.disabled||coupon.thirdHorseDecision?.applied||coupon.legs?.length!==6||typeof global.tkpProbabilityPortfolioOrderForRace!=='function')return coupon;
  const legs=coupon.legs,unit=couponUnit(coupon),widths=legs.map(l=>(l.picks||[]).length);
  const product=xs=>xs.reduce((a,b)=>a*b,1),beforeCost=product(widths)*unit;
  const singles=widths.filter(k=>k===1).length;
  if(singles<1||singles>2||beforeCost<1000-1e-8||beforeCost>1400+1e-8)return coupon;
  const cap=Math.min(1400,userCap(coupon),Math.max(beforeCost,n(coupon.budgetTL,userCap(coupon))));
  const group=h=>{const e=typeof global.ekuriGroup==='function'?global.ekuriGroup(no(h)):null;return e?'E:'+e:'N:'+baseNo(h);};
  const protectedHorse=(leg,h)=>{
    if(leg.protectedFlag||h.__tkpStrategySingle||h.__tkpStrategyFallbackSingle)return true;
    if(typeof global.tkpLegacyXKulisForce==='function'&&global.tkpLegacyXKulisForce(h))return true;
    return ['protectedValueNos','protectedSignalNos','protectedBombNos'].some(key=>{
      const set=leg[key];return set&&typeof set.has==='function'&&(set.has(no(h))||set.has(baseNo(h)));
    });
  };
  const data=[];
  for(const leg of legs){
    const pool=sourceForLeg(leg),rows=global.tkpProbabilityPortfolioOrderForRace(leg.r||leg.x?.r,pool,profileKey),probs=new Map();
    for(const h of rows){const p=Number(h.tkp_probability);if(!Number.isFinite(p)||p<0)return coupon;const key=group(h);probs.set(key,(probs.get(key)||0)+p);}
    const total=Array.from(probs.values()).reduce((a,b)=>a+b,0);if(Math.abs(total-1)>1e-5)return coupon;
    const selected=new Set(leg.picks.map(group));if(selected.size!==leg.picks.length)return coupon;
    const prob=h=>probs.get(group(h))||0,mass=leg.picks.reduce((s,h)=>s+prob(h),0);if(!(mass>0))return coupon;
    const candidate=pool.filter(h=>liveHorse(h)&&!selected.has(group(h))).sort((a,b)=>prob(b)-prob(a)||no(a).localeCompare(no(b)))[0];
    const removable=leg.picks.filter(h=>!protectedHorse(leg,h)).sort((a,b)=>prob(a)-prob(b)||no(a).localeCompare(no(b)))[0];
    data.push({prob,mass,candidate,removable});
  }
  let best=null;
  for(let target=0;target<6;target++){
    const d=data[target],leg=legs[target];
    // A stale TEK/maxCoverage=1 marker can remain after an earlier 1 -> 2
    // expansion. Adding a horse preserves every protected selection; only
    // actual one-horse legs are locked against this 2 -> 3 policy.
    if(widths[target]!==2||!d.candidate)continue;
    const weaker=Math.min(...leg.picks.map(d.prob)),added=d.prob(d.candidate);
    if(!(added>0)||added+1e-12<.8*weaker)continue;
    const donors=legs.map((l,i)=>i).filter(i=>i!==target&&widths[i]>=4&&widths[i]-1>=Math.max(3,n(legs[i].minCoverage,0))&&data[i].removable);
    // At most 32 subsets: each donor gives up at most one unprotected horse.
    for(let mask=0;mask<(1<<donors.length);mask++){
      const counts=widths.slice(),removed=[];counts[target]=3;
      let gain=Math.log((d.mass+added)/d.mass);
      for(let bit=0;bit<donors.length;bit++)if(mask&(1<<bit)){
        const i=donors[bit],q=data[i];counts[i]--;removed.push(i);
        gain+=Math.log(Math.max(1e-12,(q.mass-q.prob(q.removable))/q.mass));
      }
      const cost=product(counts)*unit;
      if(cost<1000-1e-8||cost>cap+1e-8||gain<=1e-9)continue;
      if(!best||gain>best.gain+1e-12||(Math.abs(gain-best.gain)<=1e-12&&cost<best.cost))best={target,removed,counts,cost,gain,added,weaker};
    }
  }
  coupon.thirdHorseDecision={version:'R16.64',applied:!!best,closenessRatio:.8,budgetCapTL:cap,preRaceOnly:true,validated:false,reason:best?'Üçüncü atın kapsam kazancı, daraltılan ayakların kaybından yüksek.':'Bütçe ve kapsam koşullarını sağlayan üçüncü at değişimi yok.'};
  if(!best)return coupon;
  legs[best.target].picks=legs[best.target].picks.concat(data[best.target].candidate);
  legs[best.target].maxCoverage=Math.max(3,n(legs[best.target].maxCoverage,3));
  for(const i of best.removed)legs[i].picks=legs[i].picks.filter(h=>h!==data[i].removable);
  for(const [i,leg] of legs.entries())if(i===best.target||best.removed.includes(i)){
    if(leg.portfolioProbability)leg.portfolioProbability={...leg.portfolioProbability,count:leg.picks.length,mass:leg.picks.reduce((s,h)=>s+data[i].prob(h),0),validated:false};
  }
  coupon.combos=product(best.counts);coupon.cost=Math.round(best.cost*100)/100;
  coupon.leftover=Math.round((cap-coupon.cost)*100)/100;
  if(coupon.structurePolicy)coupon.structurePolicy={...coupon.structurePolicy,actualSingles:singles,actualNarrowLegs:best.counts.filter(k=>k===2||k===3).length};
  Object.assign(coupon.thirdHorseDecision,{targetLeg:legKey(legs[best.target],best.target),addedHorse:no(data[best.target].candidate),donors:best.removed.map(i=>({leg:legKey(legs[i],i),removedHorse:no(data[i].removable)})),beforeCostTL:beforeCost,afterCostTL:coupon.cost,estimatedCoverageRatio:Math.exp(best.gain)});
  return coupon;
}
function rerank(race,source,profileKey){return profileOrder(race,source,profileKey).map(x=>x.horse);}
global.TKP_V320_PORTFOLIO={VERSION,PROFILES,EVIDENCE,SHARED_GOLD_TEK_POLICY,profileOrder,bestCounts,goldCandidateForLeg,selectSharedGoldSingles,couponSupportsSharedPlan,applyCoupon,applySet,score,rerank,rebalanceThirdHorse};
global.TKP_REAL509_PORTFOLIO=global.TKP_V320_PORTFOLIO;
})(window);
