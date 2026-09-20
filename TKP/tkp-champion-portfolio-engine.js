/**
 * tkp-champion-portfolio-engine.js
 *
 * V47 — Champion Portfolio Layer
 * Mevcut TKP çekirdeğini sökmeden üç ayrı kupon karakteri ve yan bahis pozisyon
 * katmanını güçlendirir:
 *   - main      : Normal / en yüksek isabet çekirdeği
 *   - alt       : Sürpriz / value + piyasa ayrışması
 *   - surprise  : Uzman + Kulis / yorumcu, X, Y.PUAN ve Champion hibriti
 *
 * Bu dosya sonuç, ikramiye veya finish alanlarını tahmin girdisi olarak kullanmaz.
 * Bu alanlar yalnız kalite/sonuç raporunda okunabilir.
 */
(function(global){
  'use strict';

  const VERSION='V47-CHAMPION-PORTFOLIO-ADAPTIVE-THREE-COUPON-SIDEBET';
  const originalPortfolioOrder=global.tkpPortfolioOrderForRace;
  const originalExpertOrder=global.tkpV55ExpertOrderForRace;
  const originalExpertEvidence=global.tkpV55ExpertEvidence;
  const originalSidePositions=global.sideBetPositionRankingsForRace;
  const originalProductSidePositions=global.tkpSideBetProductPositionRankingsForRace;
  const originalBuildCouponSetFast=global.buildCouponSetFast;
  const originalBuildCouponSetAdaptive=global.tkpBuildCouponSetAdaptive;
  let portfolioCache=new WeakMap();
  let sideCache=new WeakMap();
  let productSideCache=new WeakMap();
  let expertOrderCache=new WeakMap();
  let portfolioScoreCache=new WeakMap();

  const MODE_CONFIGS={
    main:{
      key:'main',label:'Normal',stable:.68,anchorWeight:.18,coreGuard:4,
      weights:{champion:.32,online:.16,registry:.12,allTable:.12,market:.10,profile:.07,tr:.04,ypuan:.03,value:.02,kulis:.02}
    },
    alt:{
      key:'alt',label:'Sürpriz',stable:.24,anchorWeight:.08,coreGuard:5,
      weights:{champion:.16,online:.10,registry:.12,allTable:.15,value:.19,bmbOdb:.14,ypuan:.09,marketGap:.08,surprise:.11,tr:.05,profile:.04,kulis:.04}
    },
    surprise:{
      key:'surprise',label:'Uzman + Kulis',stable:.30,anchorWeight:.10,coreGuard:5,
      weights:{expert:.27,champion:.16,allTable:.13,ypuan:.12,kulis:.12,registry:.09,online:.07,tr:.05,profile:.04,value:.03,bmbOdb:.02}
    }
  };
  MODE_CONFIGS.expert=MODE_CONFIGS.surprise;

  function num(value,fallback=null){
    if(value==null||value==='') return fallback;
    const n=Number(String(value).replace(',','.'));
    return Number.isFinite(n)?n:fallback;
  }
  function championGcTrValue(horse){
    const sources=[horse?.tr_ganyan_source,horse?.tr_source].map(v=>String(v??'').trim().toUpperCase());
    if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
    for(const raw of [horse?.tr_ganyan,horse?.tr_puan]){
      if(raw==null||String(raw).trim()==='')continue;
      const value=Number(String(raw).replace(',','.'));if(Number.isFinite(value))return value;
    }
    return NaN;
  }
  function clamp(value,min=0,max=1){ return Math.max(min,Math.min(max,Number(value)||0)); }
  function clamp100(value){ return Math.max(0,Math.min(100,Number(value)||0)); }
  function horseNo(h){ return String(h?.horse_no??'').trim(); }
  function isNR(h){ try{return typeof global.isNonRunner==='function'&&global.isNonRunner(h);}catch(_){return false;} }
  function live(source){ return (source||[]).filter(h=>h&&!isNR(h)); }
  function sameHorse(a,b){
    const aa=String(a??'').trim(),bb=String(b??'').trim();
    if(!aa||!bb) return false;
    if(aa===bb) return true;
    try{return typeof global.sameEkuri==='function'&&global.sameEkuri(aa,bb);}catch(_){return false;}
  }
  function stableDedupe(rows,race,mode){
    try{ if(typeof global.dedupeEkuri==='function') return global.dedupeEkuri(rows,race,mode,true); }
    catch(_){ }
    const seen=new Set(),out=[];
    for(const h of rows||[]){ const no=horseNo(h); if(!no||seen.has(no)) continue; seen.add(no); out.push(h); }
    return out;
  }
  function orderPct(order,horse){
    const rows=order||[]; if(!rows.length) return .5;
    const idx=rows.findIndex(h=>sameHorse(horseNo(h),horseNo(horse)));
    if(idx<0) return .5;
    return rows.length<=1?1:clamp(1-idx/(rows.length-1));
  }
  function raceRankPct(rows,horse,getter,direction='high'){
    const values=rows.map(h=>num(getter(h),null)).filter(Number.isFinite);
    const current=num(getter(horse),null);
    if(!Number.isFinite(current)||!values.length) return null;
    const min=Math.min(...values),max=Math.max(...values);
    if(max<=min) return .5;
    const raw=(current-min)/(max-min);
    return direction==='low'?1-raw:raw;
  }
  function rankFieldPct(rows,horse,field,maxRank=null){
    const rank=num(horse?.[field],null); if(!Number.isFinite(rank)||rank<=0) return null;
    const n=Math.max(2,Math.min(maxRank||rows.length||12,rows.length||12));
    return clamp(1-(rank-1)/Math.max(1,n-1));
  }
  function championScore(r,h){
    try{ if(typeof global.altiliWinnerScoreForHorse==='function') return clamp100(global.altiliWinnerScoreForHorse(r,h))/100; }catch(_){ }
    const score=num(h?.score,0); return clamp(score/Math.max(1,score+.7));
  }
  function onlineScore(rows,h){
    const pct=rankFieldPct(rows,h,'online_hybrid_rank');
    if(pct!=null) return pct;
    return raceRankPct(rows,h,x=>x?.score,'high');
  }
  function registryScore(r,h,purpose='prediction',position=1){
    try{ if(typeof global.tkpPurposeCompositeScore==='function') return clamp100(global.tkpPurposeCompositeScore(r,h,purpose,position))/100; }catch(_){ }
    try{ if(typeof global.adaptiveCompositeScore==='function') return clamp100(global.adaptiveCompositeScore(r,h))/100; }catch(_){ }
    return null;
  }
  function allTableScore(r,h,mode='prediction',position=1){
    try{ if(typeof global.tkpAutoTableCompositeScore==='function'){
      const v=global.tkpAutoTableCompositeScore(r,h,mode,position); return v==null?null:clamp(v);
    }}catch(_){ }
    return null;
  }
  function marketScore(rows,h){
    const agf=num(h?.agf,null);
    if(Number.isFinite(agf)&&agf>0) return clamp(agf/100);
    return rankFieldPct(rows,h,'agf_rank');
  }
  function marketGapScore(rows,h){
    const rank=num(h?.agf_rank,null);
    if(!Number.isFinite(rank)||rank<=0) return null;
    // Sürpriz için orta/kuyruk piyasa pozisyonu ödüllendirilir; tamamen ilgisiz dip atlar değil.
    if(rank>=4&&rank<=10) return clamp(.45+(rank-4)*.075);
    if(rank>10) return .35;
    return rank===3?.25:.08;
  }
  function profileScore(r,rows,h){
    try{ if(typeof global.profileStrengthPct==='function') return clamp(num(global.profileStrengthPct(r,h),0)/100); }catch(_){ }
    return raceRankPct(rows,h,x=>x?.profile_strength_pct??x?.team_strength_pct??x?.prof,'high');
  }
  function ypuanScore(rows,h){ return raceRankPct(rows,h,x=>x?.ypuan??x?.y_puan,'high'); }
  function trScore(rows,h){ return raceRankPct(rows,h,championGcTrValue,'high'); }
  function valueScore(r,rows,h){
    let v=raceRankPct(rows,h,x=>x?.value_score??x?.value,'high');
    const valueRank=rankFieldPct(rows,h,'value_rank');
    if(valueRank!=null) v=v==null?valueRank:Math.max(v,valueRank);
    try{ if(typeof global.valueBandScore==='function') v=Math.max(v??0,clamp(num(global.valueBandScore(h,r),0)/100)); }catch(_){ }
    try{ if(typeof global.valueBandMatch==='function'&&global.valueBandMatch(h,r)) v=Math.max(v??0,.72); }catch(_){ }
    return v;
  }
  function bmbOdbScore(r,h){
    let v=0;
    if(num(h?.bmb,0)===1) v=Math.max(v,1);
    if(num(h?.odb,0)===1) v=Math.max(v,.9);
    try{ if(typeof global.isOdbCandidate==='function'&&global.isOdbCandidate(h,r)) v=Math.max(v,.9); }catch(_){ }
    try{ const p=typeof global.trGanyanProfileForHorse==='function'?global.trGanyanProfileForHorse(r,h):null; if(p?.hardCoupon)v=Math.max(v,.95); if(p?.isBmb)v=Math.max(v,.82); }catch(_){ }
    return v||null;
  }
  function kulisScore(rows,h,race=null){
    // Raw X scores, parser cards and mutable counters are intentionally excluded.
    // The sole Kulis input is an approved, pre-race locked commentator ledger
    // consensus, and even that has a hard-limited ranking contribution.
    try{
      if(typeof global.tkpCommentatorConsensus==='function'){
        const cc=global.tkpCommentatorConsensus(race,h);
        if(cc?.available)return clamp(num(cc.limited_boost,0)/8);
      }
    }catch(_){ }
    return null;
  }
  function expertScore(r,rows,h){
    try{ if(typeof originalExpertEvidence==='function') return clamp100(originalExpertEvidence(r,h,rows).score)/100; }catch(_){ }
    try{ if(typeof global.tkpV55ExpertEvidence==='function'&&global.tkpV55ExpertEvidence!==expertEvidenceWrapped) return clamp100(global.tkpV55ExpertEvidence(r,h,rows).score)/100; }catch(_){ }
    return null;
  }
  function surpriseScore(r,rows,h){
    try{ if(typeof global.tkpSurpriseEvidenceForHorse==='function') return clamp(num(global.tkpSurpriseEvidenceForHorse(r,h,rows).score,0)); }catch(_){ }
    return null;
  }
  function featureMapForHorse(r,rows,h,mode,position){
    return {
      champion:championScore(r,h),
      online:onlineScore(rows,h),
      registry:registryScore(r,h,position>1?'sidebet_position':'prediction',position),
      allTable:allTableScore(r,h,position>1?'sidebet_position':'prediction',position),
      market:marketScore(rows,h),
      marketGap:marketGapScore(rows,h),
      profile:profileScore(r,rows,h),
      ypuan:ypuanScore(rows,h),
      tr:trScore(rows,h),
      value:valueScore(r,rows,h),
      bmbOdb:bmbOdbScore(r,h),
      // Kulis governance is Expert-only.  Normal/Sürpriz keep their prior
      // programme/data factors and cannot change merely because a source passes
      // commentator review later.
      kulis:mode==='surprise'?kulisScore(rows,h,r):null,
      expert:expertScore(r,rows,h),
      surprise:surpriseScore(r,rows,h)
    };
  }
  function portfolioScore(r,h,mode='main',position=1,baseOrder=null){
    if(!h||isNR(h)) return 0;
    const cfg=MODE_CONFIGS[mode]||MODE_CONFIGS.main;
    const rows=live(baseOrder&&baseOrder.length?baseOrder:(r?.horses||[]));
    const cacheTarget=r&&typeof r==='object'?r:null;
    const cacheKey=`${cfg.key}|${Math.max(1,Number(position)||1)}|${horseNo(h)}`;
    const featureSig=quickSignatureFor('PORTFOLIO_SCORE|'+cfg.key+'|'+position,r,rows.slice().sort((a,b)=>TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b))));
    const scoreBucket=cacheTarget?portfolioScoreCache.get(cacheTarget):null;
    const scoreCached=scoreBucket?.get(cacheKey);
    if(scoreCached?.signature===featureSig)return scoreCached.score;
    const feats=featureMapForHorse(r,rows,h,cfg.key,position);
    let total=0,weight=0;
    for(const [key,w] of Object.entries(cfg.weights)){
      const v=feats[key];
      if(v==null||!Number.isFinite(Number(v))) continue;
      total+=Number(w)*clamp(v); weight+=Number(w);
    }
    const base=weight?total/weight:championScore(r,h);
    // 60 kg üstü at genel adaylıktan silinmez; yalnız TEK/çok dar tercih riskini düşürür.
    let penalty=0;
    try{ if(typeof global.horseWeightKg==='function'&&Number(global.horseWeightKg(h))>60) penalty+=mode==='main'?.05:.03; }catch(_){ }
    const score=clamp100((base-penalty)*100);
    if(cacheTarget){const bucket=scoreBucket||new Map();bucket.set(cacheKey,{signature:featureSig,score});portfolioScoreCache.set(cacheTarget,bucket);}
    return score;
  }
  function enforceCoreGuard(ordered,anchorOrder,race,mode){
    const cfg=MODE_CONFIGS[mode]||MODE_CONFIGS.main;
    const guard=Math.max(0,Number(cfg.coreGuard)||0);
    if(!guard||!anchorOrder?.length) return ordered;
    const out=ordered.slice();
    for(const core of anchorOrder.slice(0,Math.min(2,anchorOrder.length))){
      const idx=out.findIndex(h=>sameHorse(horseNo(h),horseNo(core)));
      if(idx>guard-1){ const [item]=out.splice(idx,1); out.splice(Math.min(guard-1,out.length),0,item); }
    }
    return stableDedupe(out,race,mode);
  }
  function orderForRace(race,poolArg=null,mode='main'){
    const requested=String(mode||'main');
    const cfg=MODE_CONFIGS[requested]||MODE_CONFIGS.main;
    const input=live(poolArg&&poolArg.length?poolArg:(race?.horses||[]));
    if(!input.length) return [];
    const cacheTarget=race&&typeof race==='object'?race:null;
    const cached=cacheTarget?portfolioCache.get(cacheTarget):null;
    const quickSig=quickSignatureFor('PORTFOLIO|'+cfg.key,race,input);
    if(cached?.[cfg.key]?.quickSignature===quickSig) return cached[cfg.key].ordered.slice();
    const sig=signatureFor('PORTFOLIO|'+cfg.key,race,input);
    if(cached?.[cfg.key]?.signature===sig) return cached[cfg.key].ordered.slice();

    let base=input.slice();
    try{
      if(typeof originalPortfolioOrder==='function' && originalPortfolioOrder!==orderForRace){
        base=live(originalPortfolioOrder(race,input.slice(),cfg.key));
      }
    }catch(_){ base=input.slice(); }
    const anchor=(()=>{try{return typeof global.altiliWinnerOrderForRace==='function'?live(global.altiliWinnerOrderForRace(race,input.slice())):base.slice();}catch(_){return base.slice();}})();
    const baseOrder=base.length?base:input;
    const stable=Number(cfg.stable)||.5;
    const scored=input.map(h=>{
      const p=portfolioScore(race,h,cfg.key,1,baseOrder)/100;
      const b=orderPct(baseOrder,h);
      const a=orderPct(anchor,h);
      const anchorWeight=clamp(num(cfg.anchorWeight,.18),0,.35);
      const mixed=p*(1-stable)+b*stable;
      const combined=mixed*(1-anchorWeight)+a*anchorWeight;
      return {h,score:combined,portfolio:p,base:b,anchor:a};
    }).sort((left,right)=>right.score-left.score||right.portfolio-left.portfolio||right.anchor-left.anchor||TKP_TR_COLLATOR_NUM.compare(horseNo(left.h),horseNo(right.h)));
    let ordered=scored.map(row=>row.h);
    ordered=enforceCoreGuard(ordered,anchor,race,cfg.key);
    ordered.forEach((h,index)=>{
      try{
        h.tkp_champion_portfolio_mode=cfg.key;
        h[`tkp_${cfg.key}_portfolio_rank`]=index+1;
        h[`tkp_${cfg.key}_portfolio_score`]=Math.round((scored.find(row=>row.h===h)?.score||0)*10000)/100;
      }catch(_){ }
    });
    if(cacheTarget){
      const bucket=cached||{}; bucket[cfg.key]={signature:sig,quickSignature:quickSignatureFor('PORTFOLIO|'+cfg.key,race,input),ordered:ordered.slice()}; portfolioCache.set(cacheTarget,bucket);
    }
    return ordered.slice();
  }
  function sidePositionScore(r,h,position,currentOrder,product='generic'){
    const pos=Math.max(1,Math.min(5,Number(position)||1));
    const rows=live(currentOrder&&currentOrder.length?currentOrder:(r?.horses||[]));
    const mode=pos===1?'main':(pos>=4?'alt':'surprise');
    const pScore=portfolioScore(r,h,mode,pos,rows)/100;
    const current=orderPct(rows,h);
    const champion=championScore(r,h);
    const val=valueScore(r,rows,h)||0;
    const bmb=bmbOdbScore(r,h)||0;
    // Plackett-Luce/Harville tarzı sıralı bahislerde pozisyon ilerledikçe salt liderlik
    // azalır, pozisyona özel value/uzman sinyali artar.
    const mix={
      1:{p:.42,c:.34,ch:.20,v:.04,b:.00},
      2:{p:.46,c:.25,ch:.15,v:.10,b:.04},
      3:{p:.48,c:.20,ch:.10,v:.15,b:.07},
      4:{p:.46,c:.18,ch:.08,v:.18,b:.10},
      5:{p:.44,c:.16,ch:.06,v:.22,b:.12}
    }[pos];
    const productBoost=product==='quintet'&&pos>=4?.03:product==='quartet'&&pos>=3?.02:0;
    return clamp100(100*(pScore*mix.p+current*mix.c+champion*mix.ch+val*mix.v+bmb*mix.b+productBoost));
  }
  function wrapPositionRankings(current, race, horses, product='generic'){
    const out={};
    for(let pos=1;pos<=5;pos++){
      const key='p'+pos;
      const rows=live((current&&current[key])||horses||race?.horses||[]);
      const scores=new Map(rows.map(h=>[h,sidePositionScore(race,h,pos,rows,product)]));
      const sorted=rows.slice().sort((a,b)=>(scores.get(b)||0)-(scores.get(a)||0)||TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b)));
      sorted.forEach((h,index)=>{try{h[`tkp_champion_side_${product}_p${pos}_rank`]=index+1;h[`tkp_champion_side_${product}_p${pos}_score`]=scores.get(h)||0;}catch(_){ }});
      out[key]=sorted;
    }
    return out;
  }
  function signatureFor(prefix,race,horses){
    let sig='';
    try{ if(typeof global.adaptiveOrderSignature==='function') sig=global.adaptiveOrderSignature(race,horses||[]); }catch(_){ sig=''; }
    const ds=global.db?.learning_state?.dataset_signature||`${global.db?.files?.length||0}:${global.db?.races?.length||0}`;
    const hp=(horses||[]).map(h=>[horseNo(h),h?.score,h?.agf,h?.agf_rank,h?.ypuan,h?.value_score,h?.value_rank,h?.bmb,h?.odb,0,h?.expert_positive_votes,h?.expert_consensus_total,h?.tkp_common_evidence].join(':')).join(';');
    const commentatorRevision=typeof global.tkpCommentatorGovernanceRevision==='function'?global.tkpCommentatorGovernanceRevision():0;
    return [VERSION,prefix,ds,`CE:${commentatorRevision}`,sig,hp].join('|');
  }
  function quickSignatureFor(prefix,race,horses){
    const ds=global.db?.learning_state?.dataset_signature||`${global.db?.files?.length||0}:${global.db?.races?.length||0}`;
    const rp=[race?.id,race?.file_id,race?.race_uid,race?.race_date,race?.leg,race?.distance,race?.surface,race?.track_type,race?.condition_family,race?.condition_text].join(':');
    const hp=(horses||[]).map(h=>[horseNo(h),h?.score,h?.prediction_score_snapshot,h?.agf,h?.agf_rank,h?.ypuan,h?.value_score,h?.value_rank,h?.bmb,h?.odb,0,h?.expert_positive_votes,h?.expert_consensus_total,h?.tkp_common_evidence].join(':')).join(';');
    const commentatorRevision=typeof global.tkpCommentatorGovernanceRevision==='function'?global.tkpCommentatorGovernanceRevision():0;
    return [VERSION,prefix,ds,`CE:${commentatorRevision}`,rp,hp].join('|');
  }
  function positionRankings(race,horses){
    const input=live(horses&&horses.length?horses:(race?.horses||[]));
    const cacheTarget=race&&typeof race==='object'?race:null;
    const cached=cacheTarget?sideCache.get(cacheTarget):null;
    const quickSig=quickSignatureFor('SIDE_GENERIC',race,input);
    if(cached&&cached.quickSignature===quickSig) return cloneRankings(cached.rankings);
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(race)){
      let frozen={};
      try{frozen=typeof originalSidePositions==='function'?originalSidePositions(race,input.slice()):{};}catch(_){frozen={};}
      if(cacheTarget)sideCache.set(cacheTarget,{quickSignature:quickSig,rankings:frozen});
      return cloneRankings(frozen);
    }
    const sig=signatureFor('SIDE_GENERIC',race,input);
    if(cached&&cached.signature===sig) return cloneRankings(cached.rankings);
    let current={};
    try{ current=typeof originalSidePositions==='function'?originalSidePositions(race,input.slice()):{}; }catch(_){ current={}; }
    const rankings=wrapPositionRankings(current,race,input,'generic');
    if(cacheTarget) sideCache.set(cacheTarget,{signature:sig,quickSignature:quickSignatureFor('SIDE_GENERIC',race,input),rankings});
    return cloneRankings(rankings);
  }
  function productRankings(race,horses,product='triple'){
    const input=live(horses&&horses.length?horses:(race?.horses||[]));
    const cacheTarget=race&&typeof race==='object'?race:null;
    const cached=cacheTarget?productSideCache.get(cacheTarget):null;
    const quickSig=quickSignatureFor('SIDE_PRODUCT|'+product,race,input);
    if(cached?.[product]?.quickSignature===quickSig) return cloneRankings(cached[product].rankings);
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(race)){
      let frozen={};
      try{frozen=typeof originalProductSidePositions==='function'?originalProductSidePositions(race,input.slice(),product):{};}catch(_){frozen={};}
      if(cacheTarget){const bucket=cached||{};bucket[product]={quickSignature:quickSig,rankings:frozen};productSideCache.set(cacheTarget,bucket);}
      return cloneRankings(frozen);
    }
    const sig=signatureFor('SIDE_PRODUCT|'+product,race,input);
    if(cached?.[product]?.signature===sig) return cloneRankings(cached[product].rankings);
    let current={};
    try{ current=typeof originalProductSidePositions==='function'?originalProductSidePositions(race,input.slice(),product):{}; }catch(_){ current={}; }
    if(!current||!current.p1){ try{ current=positionRankings(race,input); }catch(_){ current={}; } }
    const rankings=wrapPositionRankings(current,race,input,product);
    if(cacheTarget){ const bucket=cached||{}; bucket[product]={signature:sig,quickSignature:quickSignatureFor('SIDE_PRODUCT|'+product,race,input),rankings}; productSideCache.set(cacheTarget,bucket); }
    return cloneRankings(rankings);
  }
  function cloneRankings(rankings){
    const out={}; for(let pos=1;pos<=5;pos++) out['p'+pos]=(rankings?.['p'+pos]||[]).slice(); return out;
  }
  function softStrengths(race,horses,mode='main'){
    const rows=live(horses&&horses.length?horses:(race?.horses||[]));
    const scores=rows.map(h=>({h,score:Math.max(.001,portfolioScore(race,h,mode,1,rows))}));
    const max=Math.max(0,...scores.map(x=>x.score));
    const temp=mode==='main'?16:mode==='surprise'?18:20;
    const vals=scores.map(x=>({h:x.h,value:Math.exp((x.score-max)/temp)}));
    const sum=vals.reduce((s,x)=>s+x.value,0)||1;
    return vals.map(x=>({horse:x.h,p:x.value/sum,strength:x.value}));
  }
  function sequenceProbability(race,sequence,mode='main'){
    const all=softStrengths(race,race?.horses||[],mode).map(x=>({horse:x.horse,strength:x.strength}));
    const remaining=all.slice();
    let prob=1;
    for(const item of sequence||[]){
      const no=typeof item==='object'?horseNo(item):String(item);
      const idx=remaining.findIndex(x=>sameHorse(horseNo(x.horse),no));
      if(idx<0) return 0;
      const denom=remaining.reduce((s,x)=>s+x.strength,0)||1;
      prob*=remaining[idx].strength/denom;
      remaining.splice(idx,1);
    }
    return prob;
  }
  function bestSequences(race,horses=null,n=3,limit=12,mode='main'){
    const field=race?.horses?.length?race.horses:(horses||[]);
    const allowed=new Set((horses&&horses.length?horses:field).map(horseNo));
    const rows=softStrengths(race,field,mode)
      .sort((a,b)=>b.p-a.p);
    let beam=[{seq:[],prob:1,remaining:rows.map(x=>({horse:x.horse,strength:x.strength}))}];
    for(let depth=0;depth<n;depth++){
      const next=[];
      for(const state of beam){
        const denom=state.remaining.reduce((s,x)=>s+x.strength,0)||1;
        for(let i=0;i<state.remaining.length;i++){
          const item=state.remaining[i];
          if(!allowed.has(horseNo(item.horse)))continue;
          next.push({seq:state.seq.concat([item.horse]),prob:state.prob*(item.strength/denom),remaining:state.remaining.slice(0,i).concat(state.remaining.slice(i+1))});
        }
      }
      next.sort((a,b)=>b.prob-a.prob); beam=next.slice(0,Math.max(1,Number(limit)||12));
    }
    return beam.map(x=>({sequence:x.seq,probability:x.prob,n}));
  }
  function auditCoupon(coupon,mode){
    if(!coupon||coupon.error||!Array.isArray(coupon.legs)) return coupon;
    const singles=coupon.legs.filter(l=>(l.picks||[]).length===1).length;
    const avgPicks=coupon.legs.length?coupon.legs.reduce((s,l)=>s+(l.picks||[]).length,0)/coupon.legs.length:0;
    const modes={main:'Normal',alt:'Sürpriz',surprise:'Uzman + Kulis'};
    coupon.championPortfolio={version:VERSION,mode,modeLabel:modes[mode]||mode,singles,avgPicks:Math.round(avgPicks*100)/100};
    coupon.note=(coupon.note?coupon.note+' · ':'')+`Champion Portfolio ${modes[mode]||mode}: adaptif tablo + ${mode==='alt'?'value/ters piyasa':mode==='surprise'?'uzman/kulis':'güven'} dinamiği.`;
    return coupon;
  }
  function auditCouponSet(set){
    if(!set||typeof set!=='object') return set;
    auditCoupon(set.main,'main');
    auditCoupon(set.alt,'alt');
    auditCoupon(set.surprise,'surprise');
    return set;
  }
  function expertEvidenceWrapped(r,h,pool){
    const ev=(()=>{try{return typeof originalExpertEvidence==='function'?originalExpertEvidence(r,h,pool):null;}catch(_){return null;}})()||{score:0,parts:[],sourceCount:0,labels:[]};
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(r)) return ev;
    const rows=live(pool&&pool.length?pool:(r?.horses||[]));
    const all=allTableScore(r,h,'prediction',1);
    if(all!=null){
      const score=clamp100(Number(ev.score||0)*.86+all*100*.14);
      return {...ev,score:Math.round(score*10)/10,parts:(ev.parts||[]).concat([{key:'allTable',label:'TÜM TABLO',value:Math.round(all*1000)/10,weight:14,available:true}]),sourceCount:Number(ev.sourceCount||0)+1,labels:[...(ev.labels||[]),'TÜM TABLO']};
    }
    return ev;
  }
  function expertOrderWrapped(r,poolArg){
    const input=live(poolArg&&poolArg.length?poolArg:(r?.horses||[]));
    const cacheTarget=r&&typeof r==='object'?r:null;
    const quickSig=quickSignatureFor('EXPERT_ORDER',r,input);
    const cached=cacheTarget?expertOrderCache.get(cacheTarget):null;
    if(cached?.quickSignature===quickSig)return cached.ordered.slice();
    // Arşiv yarışında Uzman/Kulis görünümü yarış-öncesi sıra snapshot'ını
    // göstermelidir. Portfolio katmanını yeniden hesaplamak aynı 509 yarışlık
    // kanıt taramasını tekrarlayıp arşiv ekranını kilitler; canlı yol aşağıdaki
    // hibrit sıralama ile devam eder.
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(r)){
      const frozen=typeof global.tkpArchivedOrderedRows==='function'
        ?global.tkpArchivedOrderedRows({r,scored:input})
        :input.slice();
      if(cacheTarget)expertOrderCache.set(cacheTarget,{quickSignature:quickSig,ordered:frozen.slice()});
      return frozen.slice();
    }
    let base=input.slice();
    try{ if(typeof originalExpertOrder==='function') base=live(originalExpertOrder(r,input.slice())); }catch(_){ base=input.slice(); }
    const ordered=orderForRace(r,base,'surprise');
    if(cacheTarget)expertOrderCache.set(cacheTarget,{quickSignature:quickSignatureFor('EXPERT_ORDER',r,input),ordered:ordered.slice()});
    return ordered;
  }

  global.TKP_CHAMPION_PORTFOLIO_VERSION=VERSION;
  global.tkpChampionPortfolioScore=portfolioScore;
  global.tkpChampionPortfolioOrderForRace=orderForRace;
  global.tkpPortfolioOrderForRace=orderForRace;
  global.tkpChampionSideBetPositionRankingsForRace=positionRankings;
  global.tkpChampionSideBetProductPositionRankingsForRace=productRankings;
  global.tkpChampionSequenceProbability=sequenceProbability;
  global.tkpChampionBestSequences=bestSequences;
  global.tkpChampionCouponAudit=auditCoupon;
  global.tkpChampionCouponSetAudit=auditCouponSet;
  if(typeof originalExpertEvidence==='function') global.tkpV55ExpertEvidence=expertEvidenceWrapped;
  if(typeof originalExpertOrder==='function') global.tkpV55ExpertOrderForRace=expertOrderWrapped;
  if(typeof originalSidePositions==='function') global.sideBetPositionRankingsForRace=positionRankings;
  if(typeof originalProductSidePositions==='function') global.tkpSideBetProductPositionRankingsForRace=productRankings;
  if(typeof originalBuildCouponSetFast==='function'){
    global.buildCouponSetFast=function(){ return auditCouponSet(originalBuildCouponSetFast.apply(this,arguments)); };
  }
  if(typeof originalBuildCouponSetAdaptive==='function'){
    global.tkpBuildCouponSetAdaptive=function(){ return auditCouponSet(originalBuildCouponSetAdaptive.apply(this,arguments)); };
  }
  global.tkpInvalidateChampionPortfolio=function(){
    portfolioCache=new WeakMap();
    sideCache=new WeakMap();
    productSideCache=new WeakMap();
    expertOrderCache=new WeakMap();
    portfolioScoreCache=new WeakMap();
  };
  if(global.addEventListener){
    global.addEventListener('tkp:db-changed',()=>{
      try{ portfolioCache=new WeakMap(); sideCache=new WeakMap(); productSideCache=new WeakMap(); expertOrderCache=new WeakMap(); portfolioScoreCache=new WeakMap(); }catch(_){ }
    });
  }
})(typeof window!=='undefined'?window:globalThis);
