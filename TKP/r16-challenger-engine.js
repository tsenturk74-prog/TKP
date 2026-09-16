'use strict';
/*
 * TKP R16 Challenger Engine — 2026-09-01
 *
 * Goals:
 *  1) Champion/market anchor: do not throw away a strong baseline.
 *  2) Market residual: look for model-vs-market disagreement rather than re-copying AGF.
 *  3) Pairwise rank consensus: compare horses within the same race across independent pre-race rankers.
 *  4) Race-type experts: use chronology-safe adaptive/registry models for the current race profile.
 *  5) Meta ensemble: merge the above for coverage ordering, while a selective gate controls P1/TEK.
 *  6) Side-bet position models: keep P1..P5 product/position models separate.
 *
 * IMPORTANT: Live ranking functions below never read winner / finish_position / payout fields.
 * Outcome fields are used only by tkpR16HistoricalPreview(), which is explicitly a backtest/report function.
 */
(function(global){
  const VERSION='R16-CHALLENGER-SELECTIVE-TEK-20260901';
  const CFG=Object.freeze({
    adaptiveGapMin:20,
    sideGapMin:20,
    // Conservative: if two strong independent gates disagree, abstain instead of guessing.
    abstainOnStrongConflict:true,
    // Meta weights affect P2+ coverage; P1 is changed only by the selective gate.
    meta:Object.freeze({champion:.34,pairwise:.22,expert:.18,marketResidual:.10,adaptive:.10,sideP1:.06}),
    history:Object.freeze({recentRows:68,minPreviewRows:8})
  });

  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number(v)||0));
  const liveHorse=h=>!!h && !(typeof global.isNonRunner==='function' && global.isNonRunner(h));
  const no=h=>String(h?.horse_no??'');
  const eq=(a,b)=>no(a)!==''&&no(a)===no(b);
  const kg=h=>{
    const raw=h?.weight_kg??h?.weightKg??h?.weight??h?.kilo??h?.kg??h?.siklet??h?.siklet_kg??'';
    const m=String(raw).replace(',','.').match(/\d+(?:\.\d+)?/);
    return m?Number(m[0]):null;
  };
  function raceSource(race,horses){
    return Array.from(horses||race?.horses||[]).filter(liveHorse);
  }
  function rankPct(order){
    const out=new Map(),n=(order||[]).length;
    (order||[]).forEach((h,i)=>out.set(h,n<=1?1:1-i/(n-1)));
    return out;
  }
  function rankPctByNumber(order){
    const out=new Map(),n=(order||[]).length;
    (order||[]).forEach((h,i)=>out.set(no(h),n<=1?1:1-i/(n-1)));
    return out;
  }
  function orderByField(rows,field,lower=false){
    return rows.slice().sort((a,b)=>{
      const av=Number(a?.[field]),bv=Number(b?.[field]);
      const ak=Number.isFinite(av),bk=Number.isFinite(bv);
      if(ak!==bk)return ak?-1:1;
      if(ak&&Math.abs(av-bv)>1e-12)return lower?av-bv:bv-av;
      return (Number(b?.score)||0)-(Number(a?.score)||0)||no(a).localeCompare(no(b),'tr',{numeric:true});
    });
  }
  function safeCall(fn,...args){try{return typeof fn==='function'?fn(...args):null;}catch(_){return null;}}

  function adaptiveInfo(race,rows){
    const ordered=safeCall(global.adaptiveOrderForRace,race,rows.slice());
    if(!Array.isArray(ordered)||ordered.length<2)return null;
    const first=ordered[0],second=ordered[1];
    const s1=Number(first?.adaptive_position_score),s2=Number(second?.adaptive_position_score);
    if(!Number.isFinite(s1)||!Number.isFinite(s2))return null;
    return {first,second,gap:s1-s2,score1:s1,score2:s2,ordered};
  }
  function sideInfo(race,rows){
    const ordered=safeCall(global.sideBetAdaptiveOrderForRace,race,rows.slice());
    if(!Array.isArray(ordered)||ordered.length<2)return null;
    const first=ordered[0],second=ordered[1];
    const s1=Number(first?.sidebet_adaptive_score),s2=Number(second?.sidebet_adaptive_score);
    if(!Number.isFinite(s1)||!Number.isFinite(s2))return null;
    return {first,second,gap:s1-s2,score1:s1,score2:s2,ordered};
  }

  const _singleCache=new WeakMap();
  function singleSignature(race,rows){
    const dbSig=typeof global.tkpFastDbSignature==='function'?global.tkpFastDbSignature(global.db):`${global.db?.files?.length||0}|${global.db?.races?.length||0}`;
    return [VERSION,dbSig,race?.id||race?.file_id||'',race?.leg||'',rows.map(h=>[
      no(h),h?.score,h?.prediction_score_snapshot,h?.agf,h?.agf_rank,h?.tr_ganyan,h?.jbyg,h?.g800,h?.hndkp,h?.ypuan,kg(h)
    ].join(':')).join(';')].join('|');
  }

  function tkpR16SelectiveSingleForRace(race,horses=null){
    const rows=raceSource(race,horses);
    if(!race||rows.length<2)return {isSingle:false,source:'R16_ABSTAIN',reason:'Aday yetersiz',version:VERSION};
    // Archived read-only views must never recompute a live decision with today's model.
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(race)){
      return {isSingle:false,source:'R16_ARCHIVE_SHADOW',reason:'Arşiv görünümünde canlı R16 yeniden çalıştırılmaz',version:VERSION};
    }
    const sig=singleSignature(race,rows),hit=_singleCache.get(race);
    if(hit?.signature===sig)return {...hit.value};

    const A=adaptiveInfo(race,rows);
    const adaptiveStrong=!!(A&&A.gap>=CFG.adaptiveGapMin);
    // Side model is more expensive. Only ask it when needed for a second independent opinion/fallback.
    const S=sideInfo(race,rows);
    const sideStrong=!!(S&&S.gap>=CFG.sideGapMin);

    let pick=null,source='R16_ABSTAIN',gap=0;
    if(adaptiveStrong&&sideStrong&&CFG.abstainOnStrongConflict&&!eq(A.first,S.first)){
      const out={isSingle:false,source:'R16_CONFLICT_ABSTAIN',reason:'İki güçlü model farklı at seçti; TEK yok',adaptiveGap:A.gap,sideGap:S.gap,version:VERSION};
      _singleCache.set(race,{signature:sig,value:out});return {...out};
    }
    if(adaptiveStrong){pick=A.first;gap=A.gap;source=sideStrong&&eq(A.first,S.first)?'R16_ADAPTIVE+SIDE':'R16_ADAPTIVE';}
    else if(sideStrong){pick=S.first;gap=S.gap;source='R16_SIDE_POSITION';}

    if(!pick){
      const out={isSingle:false,source:'R16_ABSTAIN',reason:`Ayrışma yetersiz · A ${A?A.gap.toFixed(1):'—'} / S ${S?S.gap.toFixed(1):'—'}`,adaptiveGap:A?.gap??null,sideGap:S?.gap??null,version:VERSION};
      _singleCache.set(race,{signature:sig,value:out});return {...out};
    }
    const evidenceGap=Math.max(adaptiveStrong?A.gap:0,sideStrong?S.gap:0);
    // This is a gate strength indicator, NOT a literal win probability.
    const confidence=Math.round(clamp(.55+.012*Math.max(0,evidenceGap-15),.55,.88)*100);
    const out={isSingle:true,candidate:pick,first:pick,source,gap,adaptiveGap:A?.gap??null,sideGap:S?.gap??null,
      confidence,threshold:60,version:VERSION,reason:`${source.replace('R16_','').replace('+',' + ')} ayrışma ${evidenceGap.toFixed(1)} · seçici TEK`};
    _singleCache.set(race,{signature:sig,value:out});return {...out};
  }

  function tkpR16SelectiveSingleForLeg(x){
    const d=tkpR16SelectiveSingleForRace(x?.r,x?.scored||x?.r?.horses||[]);
    return {...d,x};
  }

  function tkpR16MeetingSingleCandidates(chosen,maxCount=2){
    const rows=[];
    for(let i=0;i<(chosen||[]).length;i++){
      const x=chosen[i],d=tkpR16SelectiveSingleForLeg(x);
      if(d?.isSingle&&d.candidate)rows.push({i,x,h:d.candidate,decision:d,confidence:d.confidence||0,gap:Number(d.gap)||0});
    }
    rows.sort((a,b)=>(Number(b.decision?.confidence)||0)-(Number(a.decision?.confidence)||0)||(Number(b.gap)||0)-(Number(a.gap)||0)||a.i-b.i);
    return rows.slice(0,Math.max(0,Number(maxCount)||0));
  }

  function tkpR16MarketResidualScores(race,rows,championOrder){
    const champ=rankPctByNumber(championOrder),agf=rankPctByNumber(orderByField(rows,'agf',false));
    const out=new Map();
    for(const h of rows){
      const c=champ.get(no(h))??.5,m=agf.get(no(h))??.5;
      // Positive residual = model rates horse above market. Keep neutral .5 center.
      out.set(h,clamp(.5+.5*(c-m)));
    }
    return out;
  }
  function tkpR16PairwiseScores(rows,orders){
    const rankMaps=(orders||[]).filter(a=>Array.isArray(a)&&a.length).map(rankPctByNumber);
    const out=new Map();
    for(const h of rows){
      const vals=rankMaps.map(m=>m.get(no(h))).filter(Number.isFinite);
      if(!vals.length){out.set(h,.5);continue;}
      // Pairwise Borda-like consensus: percentile rank in each within-race expert.
      out.set(h,vals.reduce((a,b)=>a+b,0)/vals.length);
    }
    return out;
  }
  function tkpR16RaceTypeExpertScores(race,rows){
    const out=new Map();
    let legacy=null,registry=null;
    try{legacy=typeof global.adaptiveWeightsForRace==='function'?global.adaptiveWeightsForRace(race,1):null;}catch(_){ }
    try{registry=typeof global.tkpPurposeWeightsForRace==='function'?global.tkpPurposeWeightsForRace(race,'prediction',1):null;}catch(_){ }
    for(const h of rows){
      let a=50,b=50;
      try{if(legacy&&typeof global.adaptiveCompositeScore==='function')a=Number(global.adaptiveCompositeScore(race,h,legacy))||50;}catch(_){ }
      try{if(registry&&typeof global.tkpPurposeCompositeScore==='function')b=Number(global.tkpPurposeCompositeScore(race,h,'prediction',1,registry))||50;}catch(_){ }
      out.set(h,clamp((.45*a+.55*b)/100));
    }
    return out;
  }

  const _metaCache=new WeakMap();
  function tkpR16MetaOrderForRace(race,horses=null){
    const rows=raceSource(race,horses);
    if(rows.length<2)return rows;
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(race)){
      // Respect frozen historical order; historical performance is evaluated separately.
      const frozen=typeof global.tkpArchivedOrderedRows==='function'?global.tkpArchivedOrderedRows({r:race,scored:rows}):rows.slice();
      return Array.isArray(frozen)?frozen:rows;
    }
    // R17 AutoGluon remains shadow-only until its holdout promotion gate passes.
    safeCall(global.tkpR17AttachShadowProbabilities,race,rows);
    if(safeCall(global.tkpR17IsActive)===true){
      const promoted=safeCall(global.tkpR17OrderForRace,race,rows.slice());
      if(Array.isArray(promoted)&&promoted.length===rows.length){
        promoted.forEach((h,i)=>{h.r16_meta_rank=i+1;h.r17_promoted_rank=i+1;});
        return promoted;
      }
    }
    const sig=singleSignature(race,rows)+'|META',cached=_metaCache.get(race);if(cached?.signature===sig)return cached.order.slice();
    const champion=safeCall(global.altiliWinnerOrderForRace,race,rows.slice())||rows.slice();
    const adaptive=safeCall(global.adaptiveOrderForRace,race,rows.slice())||[];
    const side=safeCall(global.sideBetAdaptiveOrderForRace,race,rows.slice())||[];
    const final=safeCall(global.tkpFinalRankOrderForRace,race,rows.slice())||[];
    const online=rows.some(h=>Number.isFinite(Number(h?.online_hybrid_rank)))?orderByField(rows,'online_hybrid_rank',true):[];
    const champPct=rankPctByNumber(champion),adaptivePct=rankPctByNumber(adaptive),sidePct=rankPctByNumber(side);
    const pair=tkpR16PairwiseScores(rows,[champion,adaptive,side,final,online]);
    const expert=tkpR16RaceTypeExpertScores(race,rows),residual=tkpR16MarketResidualScores(race,rows,champion);
    const W=CFG.meta,scores=new Map();
    for(const h of rows){
      const s=W.champion*(champPct.get(no(h))??.5)+W.pairwise*(pair.get(h)??.5)+W.expert*(expert.get(h)??.5)+
        W.marketResidual*(residual.get(h)??.5)+W.adaptive*(adaptivePct.get(no(h))??.5)+W.sideP1*(sidePct.get(no(h))??.5);
      scores.set(h,s);h.r16_meta_score=Math.round(s*10000)/100; // 0..100 display scale
    }
    let order=rows.slice().sort((a,b)=>(scores.get(b)||0)-(scores.get(a)||0)||(Number(b.score)||0)-(Number(a.score)||0)||no(a).localeCompare(no(b),'tr',{numeric:true}));
    // P1 is not freely re-optimized. It changes only when the selective gate is strong enough.
    const d=tkpR16SelectiveSingleForRace(race,rows);
    const anchor=d?.isSingle&&d.candidate?d.candidate:champion[0];
    if(anchor){order=order.filter(h=>!eq(h,anchor));order.unshift(anchor);}
    order.forEach((h,i)=>{h.r16_meta_rank=i+1;});
    _metaCache.set(race,{signature:sig,order:order.slice()});return order;
  }

  function tkpR16SideBetPositionModels(race,horses=null){
    const rows=raceSource(race,horses);
    const current=safeCall(global.sideBetPositionRankingsForRace,race,rows.slice());
    if(current&&typeof current==='object')return current;
    // Safe fallback: meta order copied only when position-specific engine is unavailable.
    const fallback=tkpR16MetaOrderForRace(race,rows);
    return {p1:fallback.slice(),p2:fallback.slice(),p3:fallback.slice(),p4:fallback.slice(),p5:fallback.slice()};
  }

  function historicalInfo(horses,rankField,scoreField,winner){
    const a=(horses||[]).find(h=>Number(h?.[rankField])===1),b=(horses||[]).find(h=>Number(h?.[rankField])===2);
    if(!a||!b||!winner)return null;
    const s1=Number(a?.[scoreField]),s2=Number(b?.[scoreField]);if(!Number.isFinite(s1)||!Number.isFinite(s2))return null;
    return {horse:a,gap:s1-s2,win:eq(a,winner),weight:kg(a)};
  }
  function historicalPick(race){
    const hs=race?.horses||[],winner=hs.find(h=>Number(h?.finish_position)===1||Number(h?.winner)===1);if(!winner)return null;
    const A=historicalInfo(hs,'adaptive_position','adaptive_position_score',winner);
    const S=historicalInfo(hs,'sidebet_adaptive_rank','sidebet_adaptive_score',winner);
    const ok=(x,t)=>!!(x&&x.gap>=t);
    const a=ok(A,CFG.adaptiveGapMin)?A:null,s=ok(S,CFG.sideGapMin)?S:null;
    if(a&&s&&!eq(a.horse,s.horse))return null;
    const p=a||s;if(!p)return null;
    return {win:p.win,horse:p.horse,source:a&&s?'A+S':a?'A':'S',gap:p.gap};
  }
  function stat(rows){const n=rows.length,w=rows.reduce((s,x)=>s+(x.win?1:0),0);return {n,w,precision:n?100*w/n:null};}
  function tkpR16HistoricalPreview(){
    const races=(global.db?.races||[]).filter(r=>r?.result_integrity_status==='VERIFIED').slice().sort((a,b)=>String(a?.race_date||'').localeCompare(String(b?.race_date||''))||(Number(a?.file_id)||0)-(Number(b?.file_id)||0)||(Number(a?.leg)||0)-(Number(b?.leg)||0));
    // "Recent" window is the last N chronology-ordered races that actually contain
    // the historical adaptive/side-adaptive pre-race evidence, NOT the last N successful
    // selections. This prevents a selective model from inflating its recent precision.
    const evidence=[];
    for(const r of races){
      const hs=r?.horses||[],winner=hs.find(h=>Number(h?.finish_position)===1||Number(h?.winner)===1);if(!winner)continue;
      const A=historicalInfo(hs,'adaptive_position','adaptive_position_score',winner);
      const S=historicalInfo(hs,'sidebet_adaptive_rank','sidebet_adaptive_score',winner);
      if(!A&&!S)continue;
      const p=historicalPick(r);evidence.push({race:r,pick:p?{...p,race:r}:null});
    }
    const picks=evidence.map(x=>x.pick).filter(Boolean);
    const recentEvidence=evidence.slice(-CFG.history.recentRows);
    const recent=recentEvidence.map(x=>x.pick).filter(Boolean),all=stat(picks),last=stat(recent);
    const meetings=new Map();for(const p of picks){const key=String(p.race?.file_id??`${p.race?.race_date}|${p.race?.hippodrome}`);if(!meetings.has(key))meetings.set(key,[]);meetings.get(key).push(p);}
    let oneN=0,oneW=0,twoN=0,twoW=0;for(const arr of meetings.values()){
      arr.sort((a,b)=>(Number(b.gap)||0)-(Number(a.gap)||0));
      if(arr.length){oneN++;if(arr[0].win)oneW++;}
      if(arr.length>=2){twoN++;if(arr[0].win&&arr[1].win)twoW++;}
    }
    return {version:VERSION,verifiedRaces:races.length,evidenceRaces:evidence.length,picks:picks.length,all,recent:last,recentWindow:recentEvidence.length,meetings:meetings.size,
      bestOne:{n:oneN,w:oneW,precision:oneN?100*oneW/oneN:null},bestTwo:{n:twoN,w:twoW,precision:twoN?100*twoW/twoN:null},config:CFG,
      caveat:'Bu oranlar yalnız arşivde adaptive/side-adaptive yarış-öncesi snapshotı bulunan seçici örneklerdir; canlı ileri test garantisi değildir.'};
  }
  function pct(v){return Number.isFinite(Number(v))?`%${Number(v).toFixed(1)}`:'—';}
  function tkpR16PreviewHtml(){
    const p=tkpR16HistoricalPreview();
    return `<div class="card" style="border-left:5px solid #0f766e;margin-bottom:10px;"><h3 style="margin:0 0 5px;">🎯 R16 Challenger · Seçici TEK Önizleme</h3>`+
      `<p class="muted" style="margin:0 0 8px;">Amaç bütün yarışlarda zorla TEK vermek değil; yalnız ayrışma kanıtı güçlü olduğunda banko seçmek. Adaptive gap ≥ ${CFG.adaptiveGapMin}, Side-P1 gap ≥ ${CFG.sideGapMin}; KG yalnız risk/feature girdisidir, hard veto değildir; güçlü modeller çatışırsa sistem çekimser kalır.</p>`+
      `<div class="tableWrap compactBacktest tkpCenteredStats"><table><thead><tr><th>Ölçüm</th><th>Seçim</th><th>Tuttu</th><th>Başarı</th></tr></thead><tbody>`+
      `<tr><td>Arşivde tüm seçici TEK</td><td class="num">${p.all.n}</td><td class="num">${p.all.w}</td><td class="num"><b>${pct(p.all.precision)}</b></td></tr>`+
      `<tr><td>En yeni ${p.recentWindow} seçici TEK</td><td class="num">${p.recent.n}</td><td class="num">${p.recent.w}</td><td class="num"><b>${pct(p.recent.precision)}</b></td></tr>`+
      `<tr><td>Toplantıda en güçlü 1 TEK</td><td class="num">${p.bestOne.n}</td><td class="num">${p.bestOne.w}</td><td class="num"><b>${pct(p.bestOne.precision)}</b></td></tr>`+
      `<tr><td>Toplantıda en güçlü 2 TEK birlikte</td><td class="num">${p.bestTwo.n}</td><td class="num">${p.bestTwo.w}</td><td class="num"><b>${pct(p.bestTwo.precision)}</b></td></tr>`+
      `</tbody></table></div><p class="muted" style="margin:6px 0 0;">${p.caveat} Doğrulanmış yarış: ${p.verifiedRaces}. R16 ileri-test logu büyüdükçe arşiv oranından çok canlı oran esas alınacaktır.</p></div>`;
  }
  function tkpR16RenderPreview(){
    const el=typeof document!=='undefined'?document.getElementById('r16SelectivePreview'):null;if(!el)return false;
    try{el.innerHTML=tkpR16PreviewHtml();return true;}catch(e){el.innerHTML=`<div class="empty">R16 önizleme hesaplanamadı: ${String(e?.message||e)}</div>`;return false;}
  }

  global.TKP_R16_CONFIG=CFG;global.TKP_R16_VERSION=VERSION;
  global.tkpR16SelectiveSingleForRace=tkpR16SelectiveSingleForRace;
  global.tkpR16SelectiveSingleForLeg=tkpR16SelectiveSingleForLeg;
  global.tkpR16MeetingSingleCandidates=tkpR16MeetingSingleCandidates;
  global.tkpR16MarketResidualScores=tkpR16MarketResidualScores;
  global.tkpR16PairwiseScores=tkpR16PairwiseScores;
  global.tkpR16RaceTypeExpertScores=tkpR16RaceTypeExpertScores;
  global.tkpR16MetaOrderForRace=tkpR16MetaOrderForRace;
  global.tkpR16SideBetPositionModels=tkpR16SideBetPositionModels;
  global.tkpR16HistoricalPreview=tkpR16HistoricalPreview;
  global.tkpR16PreviewHtml=tkpR16PreviewHtml;
  global.tkpR16RenderPreview=tkpR16RenderPreview;

  // R16.2 STARTUP/BACKTEST FREEZE FIX: 2.886+ doğrulanmış yarışı sayfa
  // açıldıktan 300 ms sonra otomatik tarama. Önizleme artık kullanıcı Back Test
  // panelinde açıkça istediğinde çalışır; startup ve Back Test kritik yoluyla CPU
  // yarıştırılmaz.
  global.tkpR16RenderPreviewLazy=function(){
    const run=()=>tkpR16RenderPreview();
    if(typeof global.tkpQueueTask==='function'){
      global.tkpQueueTask('r16-preview-lazy',run,{priority:'background',replace:true,minIdleMs:500});
      return true;
    }
    setTimeout(run,0);return true;
  };
})(typeof globalThis!=='undefined'?globalThis:window);
