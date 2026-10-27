/* TKP R17.4 — unified EV / ROI / risk portfolio engine.
 * Live ranking inputs only: R17 P_WIN (preferred), TKP probability/score fallback,
 * and pre-race market evidence (AGF or verified decimal odds). No result/payout
 * field enters live probability. Historical realised ROI is used only as a prior/
 * safety gate, never as a horse-ranking feature.
 */
(function(global){'use strict';
  const VERSION='R17.4-EV-ROI-RISK-PORTFOLIO-20260913';
  const DEFAULTS=Object.freeze({
    // Conservative haircut for pool friction/takeout and payout-model uncertainty.
    payoutHaircut:{altili:.58,cifte:.78,sirali:.68,triple:.64,quartet:.60,quintet:.56},
    minRawEv:{altili:.02,cifte:.08,sirali:.12,triple:.15,quartet:.18,quintet:.20},
    hardBlockHistoricalRoiPct:-20,
    catastrophicRoiPct:-60,
    minSidebetSample:100,
    roiPriorWeight:.18,
    maxPayoutMultiple:1000000
  });
  const cache=new Map();
  function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function horseNo(h){return String(h?.horse_no??h?.horseNo??'').trim();}
  function activeHorses(race){return (race?.horses||[]).filter(h=>h&&horseNo(h)&&!h.non_runner);}
  function normalize(values){const clean=values.map(v=>Math.max(0,Number(v)||0)),s=clean.reduce((a,b)=>a+b,0);return s>0?clean.map(v=>v/s):clean.map(()=>values.length?1/values.length:0);}
  function r17P(race,h){try{if(typeof global.tkpR17IsActive==='function'&&global.tkpR17IsActive()!==true)return null;const p=typeof global.tkpR17PWinForHorse==='function'?num(global.tkpR17PWinForHorse(race,h)):null;if(p!==null&&p>=0)return p;}catch(_){return null;}const p=num(h?.r17_p_win);return p!==null&&p>=0?p:null;}
  function modelWeights(race){
    const rows=activeHorses(race);let raw=rows.map(h=>r17P(race,h));
    let source='R17_PWIN',known=raw.filter(v=>v!==null).length;
    if(!rows.length)return {rows,weights:[],source:'YOK',coverage:0};
    if(known!==rows.length){
      raw=rows.map(h=>{const p=num(h?.tkp_probability);if(p!==null&&p>0)return p;const s=num(h?.score??h?.prediction_score_snapshot??h?.tkp_display_score);return s!==null&&s>0?s:0;});
      source='TKP_FALLBACK';known=raw.filter(v=>v>0).length;
    }
    if(!raw.some(v=>Number(v)>0)){raw=rows.map(h=>Math.max(0,num(h?.agf)||0));source='AGF_FALLBACK';known=raw.filter(v=>v>0).length;}
    return {rows,weights:normalize(raw),source,coverage:rows.length?known/rows.length:0};
  }
  function marketWeights(race){
    const rows=activeHorses(race);if(!rows.length)return {rows,weights:[],source:'YOK',coverage:0};
    const agf=rows.map(h=>num(h?.agf));
    if(agf.every(v=>v!==null&&v>0))return {rows,weights:normalize(agf),source:'AGF',coverage:1};
    const odds=rows.map(h=>{const x=num(h?.sp);return h?.sp_is_decimal_odds===true&&h?.sp_verified_pre_race===true&&x!==null&&x>1?1/x:null;});
    if(odds.every(v=>v!==null))return {rows,weights:normalize(odds),source:'SP',coverage:1};
    const tkpMarket=rows.map(h=>num(h?.tkp_market_probability));
    if(tkpMarket.every(v=>v!==null&&v>=0)&&tkpMarket.some(v=>v>0))return {rows,weights:normalize(tkpMarket),source:'TKP_MARKET',coverage:1};
    return {rows,weights:modelWeights(race).weights.slice(),source:'MODEL_PROXY',coverage:0};
  }
  function weightMap(bundle){const m=new Map();bundle.rows.forEach((h,i)=>m.set(horseNo(h),bundle.weights[i]||0));return m;}
  function poolMass(pool,map){const seen=new Set();let s=0;(pool||[]).forEach(x=>{const k=typeof x==='object'?horseNo(x):String(x);if(!k||seen.has(k))return;seen.add(k);s+=Number(map.get(k))||0;});return clamp(s,0,1);}
  function orderedProbability(race,pools,bundle){
    const map=weightMap(bundle),all=[...map.keys()],weights=map;
    if(!pools?.length||!all.length)return 0;
    const sig=`${bundle.source}|${all.map(k=>k+':'+(weights.get(k)||0).toFixed(8)).join(',')}|${pools.map(p=>(p||[]).map(x=>typeof x==='object'?horseNo(x):String(x)).sort().join('.')).join('/')}`;
    if(cache.has(sig))return cache.get(sig);
    const allowed=pools.map(p=>new Set((p||[]).map(x=>typeof x==='object'?horseNo(x):String(x))));
    const total=all.reduce((s,k)=>s+(weights.get(k)||0),0)||1;
    const memo=new Map();
    function rec(pos,used,remaining){
      if(pos>=allowed.length)return 1;
      const u=[...used].sort().join(','),mk=pos+'|'+u;if(memo.has(mk))return memo.get(mk);
      let ans=0;for(const k of allowed[pos]){if(used.has(k)||!weights.has(k))continue;const w=weights.get(k)||0;if(w<=0||remaining<=0)continue;used.add(k);ans+=(w/remaining)*rec(pos+1,used,remaining-w);used.delete(k);}memo.set(mk,ans);return ans;
    }
    const out=clamp(rec(0,new Set(),total),0,1);if(cache.size>400)cache.clear();cache.set(sig,out);return out;
  }
  function historicalEvidence(product){
    const actual=global.TKP_V296_COST_ROI_POLICY?.actualEvidence||{};
    if(product==='altili')return actual.altili||null;
    const aliases={sirali:'sirali',triple:'triple',quartet:'quartet',quintet:'quintet',cifte:'cifte'};
    return actual.sideBets?.[aliases[product]||product]||null;
  }
  function historicalRisk(product){
    const e=historicalEvidence(product)||{},roi=(num(e.roiPct)||0)/100,cost=Math.max(1,num(e.cost)||1),dd=Math.max(0,num(e.maxDrawdown)||0),streak=Math.max(0,num(e.longestLosingStreak)||0),sample=Math.max(0,num(e.tickets)||0);
    return {roi,sample,ddRatio:clamp(dd/cost,0,1),streakPenalty:clamp(streak/30,0,1),evidence:e};
  }
  function decision(product,modelP,marketP,meta={}){
    const p=clamp(Number(modelP)||0,0,1),m=clamp(Number(marketP)||0,0,1),hist=historicalRisk(product),haircut=DEFAULTS.payoutHaircut[product]??.60;
    const payoutMultiple=m>1e-12?Math.min(DEFAULTS.maxPayoutMultiple,haircut/m):0;
    const rawEv=p*payoutMultiple-1;
    const sourceCoverage=clamp(Number(meta.sourceCoverage??1),0,1),marketCoverage=clamp(Number(meta.marketCoverage??1),0,1);
    const uncertainty=clamp((1-sourceCoverage)*.55+(1-marketCoverage)*.25+(p<.01?.10:0),0,1);
    const priorWeight=clamp(DEFAULTS.roiPriorWeight+(hist.sample<DEFAULTS.minSidebetSample?.12:0),.10,.40);
    const blendedEv=(1-priorWeight)*rawEv+priorWeight*hist.roi;
    const riskAdjustedScore=blendedEv-.16*uncertainty-.08*hist.ddRatio-.05*hist.streakPenalty;
    const hardBlock=product!=='altili'&&hist.sample>=DEFAULTS.minSidebetSample&&hist.roi*100<=DEFAULTS.hardBlockHistoricalRoiPct;
    const catastrophic=hist.sample>=DEFAULTS.minSidebetSample&&hist.roi*100<=DEFAULTS.catastrophicRoiPct;
    const minEv=DEFAULTS.minRawEv[product]??.10;
    const play=!hardBlock&&!catastrophic&&rawEv>=minEv&&blendedEv>0&&riskAdjustedScore>0;
    const review=!play&&!hardBlock&&rawEv>0&&riskAdjustedScore>-.05;
    const label=play?'OYNA':(review?'İNCELEME':'PAS');
    return {version:VERSION,product,play,review,label,hardBlock,catastrophic,modelProbability:p,marketProbability:m,payoutMultiple,rawEv,blendedEv,riskAdjustedScore,uncertainty,historicalRoiPct:hist.roi*100,historicalSample:hist.sample,maxDrawdownRatio:hist.ddRatio,longestLosingStreak:num(hist.evidence?.longestLosingStreak)||0,
      reason:`R17.4 ${label} · P(model) %${(p*100).toFixed(2)} / P(piyasa) %${(m*100).toFixed(2)} · ham EV %${(rawEv*100).toFixed(1)} · risk-ayarlı %${(riskAdjustedScore*100).toFixed(1)} · eski ROI %${(hist.roi*100).toFixed(1)} (n=${hist.sample})`};
  }
  function evaluateOrderedSideBet(product,races,pools,options={}){
    const rs=Array.isArray(races)?races:[races];if(!rs.length)return decision(product,0,0,{});
    let mp=1,kp=1,sc=1,kc=1;
    // Çifte: pools positions correspond to separate races. Other products: one race, ordered positions.
    if(product==='cifte'&&rs.length>=2){
      for(let i=0;i<2;i++){const mb=modelWeights(rs[i]),kb=marketWeights(rs[i]);mp*=poolMass(pools[i]||[],weightMap(mb));kp*=poolMass(pools[i]||[],weightMap(kb));sc*=mb.coverage;kc*=kb.coverage;}
    }else{
      const mb=modelWeights(rs[0]),kb=marketWeights(rs[0]);mp=orderedProbability(rs[0],pools,mb);kp=orderedProbability(rs[0],pools,kb);sc=mb.coverage;kc=kb.coverage;
    }
    const out=decision(product,mp,kp,{sourceCoverage:sc,marketCoverage:kc});out.cost=Number(options.cost)||0;return out;
  }
  function evaluateAltiliCoupon(coupon){
    if(!coupon||coupon.error||!Array.isArray(coupon.legs)||!coupon.legs.length)return decision('altili',0,0,{});
    let mp=1,kp=1,sc=1,kc=1;const legs=[];
    for(const leg of coupon.legs){const race=leg?.r||leg?.race||leg?.x?.r;if(!race)continue;const mb=modelWeights(race),kb=marketWeights(race),mm=weightMap(mb),km=weightMap(kb),picks=leg?.picks||[];const m=poolMass(picks,mm),k=poolMass(picks,km);mp*=m;kp*=k;sc*=mb.coverage;kc*=kb.coverage;legs.push({leg:Number(race?.leg)||legs.length+1,modelCoverage:m,marketCoverage:k});}
    const out=decision('altili',mp,kp,{sourceCoverage:sc,marketCoverage:kc});out.cost=Number(coupon.cost)||0;out.legs=legs;out.couponType=String(coupon.typeKey||coupon.role||'');return out;
  }
  function rankAltiliCoupons(built){
    const rows=[];for(const key of ['main','alt','surprise']){const c=built?.[key];if(!c||c.disabled||c.error)continue;const ev=evaluateAltiliCoupon(c);rows.push({key,coupon:c,decision:ev});}
    rows.sort((a,b)=>b.decision.riskAdjustedScore-a.decision.riskAdjustedScore||b.decision.modelProbability-a.decision.modelProbability||a.key.localeCompare(b.key));
    rows.forEach((row,i)=>{row.coupon.r17Portfolio={...row.decision,rank:i+1,recommended:i===0,allocationWeight:0};});
    const positives=rows.filter(r=>r.decision.riskAdjustedScore>0),base=positives.length?positives:rows.slice(0,1),sum=base.reduce((s,r)=>s+Math.max(.001,r.decision.riskAdjustedScore+.05),0)||1;
    base.forEach(r=>{r.coupon.r17Portfolio.allocationWeight=Math.max(.001,r.decision.riskAdjustedScore+.05)/sum;});
    if(built)built.r17Portfolio={version:VERSION,ranked:rows.map(r=>({key:r.key,rank:r.coupon.r17Portfolio.rank,label:r.decision.label,rawEv:r.decision.rawEv,riskAdjustedScore:r.decision.riskAdjustedScore,allocationWeight:r.coupon.r17Portfolio.allocationWeight})),recommended:rows[0]?.key||null};
    return rows;
  }
  function clearCache(){cache.clear();}
  global.TKP_R17_EV_ROI_PORTFOLIO=Object.freeze({VERSION,DEFAULTS,modelWeights,marketWeights,evaluateOrderedSideBet,evaluateAltiliCoupon,rankAltiliCoupons,clearCache});
})(globalThis);
