/**
 * online-ranking-engine.js
 *
 * V36 şampiyon/destek modeli:
 * - Mevcut canlı algoritmanın birinci adayı korunur.
 * - Tarihsel sonuçlardan öğrenen, sonuç alanını tahmin girdisine katmayan
 *   pairwise sıralama modeli 2-5 kapsamını ve yan bahis konumlarını destekler.
 * - Veri imzası değişince model otomatik yeniden eğitilir.
 */
(function(global){
  'use strict';

  const VERSION='V45-VALIDATED30-BH1-HARDODB1-CSSCS-CHAMPION';
  const originalAdaptive=global.adaptiveOrderForRace;
  const originalAltili=global.altiliWinnerOrderForRace;
  const originalSidePositions=global.sideBetPositionRankingsForRace;
  const originalStrategic=global.strategicOrderForRace;
  let modelCache=new Map();
  let sidePositionCache=new WeakMap();
  const trainingJobs=new Map();
  let observedDatasetSignature='';

  const FEATURES=[
    {key:'tkp',label:'TKP',prior:1.50,get:h=>numberOrNull(h?.prediction_score_snapshot??h?.score),direction:'high'},
    // AGF/TR/SP arşivde büyük ölçüde aynı piyasa sırasıdır; üç kez sayılmaz.
    {key:'market',label:'AGF/Piyasa',prior:.55,get:h=>firstNumber(h?.agf_rank,h?.tr_rank,h?.sp_rank),direction:'low'},
    {key:'odsOrder',label:'ODS Sıra',prior:.06,get:h=>positiveOrNull(h?.ods_row_order),direction:'low'},
    {key:'sonuc',label:'SONUÇ',prior:.24,get:h=>numberOrNull(h?.result_rank),direction:'low'},
    {key:'hndkp',label:'HNDKP',prior:.32,get:h=>numberOrNull(h?.hndkp_rank),direction:'low'},
    {key:'value',label:'VALUE',prior:.08,get:h=>numberOrNull(h?.value_rank),direction:'low'},
    {key:'ypuan',label:'Y.PUAN',prior:.14,get:h=>positiveOrNull(h?.ypuan),direction:'high'},
    {key:'g800',label:'800G',prior:.05,get:h=>positiveOrNull(h?.g800),direction:'low'},
    {key:'jbyg',label:'J-BYG',prior:.05,get:h=>positiveOrNull(h?.jbyg),direction:'low'},
    {key:'team',label:'Ekip Gücü',prior:.08,get:h=>positiveOrNull(h?.team_strength_rank),direction:'low'},
    {key:'gpr',label:'G.PR',prior:.12,get:h=>{
      const direct=numberOrNull(h?.gpr_strength);
      if(direct!=null) return direct;
      const starts=positiveOrNull(h?.condWinStarts??h?.priorStarts);
      const wins=numberOrNull(h?.condWinWins??h?.priorWins);
      return starts!=null&&wins!=null?Math.max(0,Math.min(1,wins/starts)):null;
    },direction:'high'},
    {key:'profile',label:'Profil Gücü',prior:.14,get:(h,r)=>{
      const stored=numberOrNull(h?.profile_strength_pct??h?.profile_strength);
      if(stored!=null) return stored;
      try{return typeof global.profileStrengthPct==='function'?numberOrNull(global.profileStrengthPct(r,h)):null;}catch(_){return null;}
    },direction:'high'},
    {key:'ganyanTr',label:'Ganyan TR',prior:.04,get:h=>positiveOrNull(h?.tr_ganyan),direction:'high'},
    // Accurate mevcut yarışın sonucu ile birlikte gelir. Tahmin girdisi yalnız
    // daha önceki koşulardan kronolojik üretilmiş sızıntısız ortalamadır.
    {key:'accurate',label:'Geçmiş Accurate',prior:.03,get:h=>positiveOrNull(h?.priorAccurateAvgSpeed??h?.prior_accurate_avg_speed),direction:'high'},
    {key:'bmb',label:'Gerçek BMB',prior:.05,get:h=>Number(h?.bmb)===1?1:0,direction:'high'}
  ];

  function numberOrNull(value){
    if(value===null||value===''||value===undefined) return null;
    const n=Number(value); return Number.isFinite(n)?n:null;
  }
  function positiveOrNull(value){ const n=numberOrNull(value); return n!=null&&n>0?n:null; }
  function firstNumber(){ for(const value of arguments){ const n=numberOrNull(value); if(n!=null&&n>0) return n; } return null; }
  function liveHorses(race){
    return (race?.horses||[]).filter(horse=>!(typeof global.isNonRunner==='function'&&global.isNonRunner(horse)));
  }
  function resultRaces(targetRace=null){
    let rows=[];
    try{ rows=typeof global.learningEligibleRaces==='function'?global.learningEligibleRaces():(db?.races||[]); }catch(_){ rows=db?.races||[]; }
    const resolved=rows.filter(race=>liveHorses(race).some(horse=>Number(horse?.winner)===1||Number(horse?.finish_position)===1));
    return targetRace&&typeof global.tkpTrainingRowsBeforeTarget==='function'
      ? global.tkpTrainingRowsBeforeTarget(resolved,targetRace)
      : resolved;
  }
  function datasetSignature(){
    try{
      if(typeof global.tkpOutcomeLearningSignature==='function')return global.tkpOutcomeLearningSignature(db);
    }catch(_){ }
    const stored=db?.learning_state?.dataset_signature;
    if(stored)return String(stored);
    try{
      if(typeof global.learningDatasetSignature==='function') return global.learningDatasetSignature(db);
    }catch(_){ }
    const rows=resultRaces();
    return `${rows.length}|${db?.learning_state?.dataset_signature||''}`;
  }
  function vectorsForRace(race){
    const trace=global.__tkpCollectPerformanceTrace?(global.__tkpOnlinePerformanceTrace||(global.__tkpOnlinePerformanceTrace={features:{},vectors:0,gradient:0})):null;
    const vectorStarted=trace?performance.now():0;
    const horses=liveHorses(race);
    const raw=FEATURES.map(feature=>{
      const started=trace?performance.now():0;
      const values=horses.map(horse=>feature.get(horse,race));
      if(trace)trace.features[feature.key]=(trace.features[feature.key]||0)+(performance.now()-started);
      return values;
    });
    const vectors=new Map();
    for(const horse of horses) vectors.set(horse,[]);
    FEATURES.forEach((feature,index)=>{
      const available=raw[index].filter(Number.isFinite);
      const min=available.length?Math.min(...available):0;
      const max=available.length?Math.max(...available):0;
      horses.forEach((horse,horseIndex)=>{
        const value=raw[index][horseIndex];
        let normalized=.5;
        if(Number.isFinite(value)&&available.length>=2){
          normalized=max>min?(value-min)/(max-min):.5;
          if(feature.direction==='low') normalized=1-normalized;
        }
        vectors.get(horse)[index]=normalized;
      });
    });
    if(trace)trace.vectors+=performance.now()-vectorStarted;
    return {horses,vectors};
  }
  function trainPosition(rows,position){
    const pairs=[];
    let targetRaces=0;
    for(const race of rows){
      if(typeof global.tkpCouponCheck==='function')global.tkpCouponCheck();
      const prepared=vectorsForRace(race);
      const target=prepared.horses.find(horse=>Number(horse?.finish_position)===position||(position===1&&Number(horse?.winner)===1));
      if(!target) continue;
      const targetVector=prepared.vectors.get(target);
      let added=false;
      for(const horse of prepared.horses){
        if(horse===target) continue;
        const finish=Number(horse?.finish_position);
        // p2-p5, kendinden önce bitiren atlarla değil; o konum seçildiğinde
        // geride kalan adaylarla karşılaştırılarak öğrenilir.
        if(position>1&&Number.isFinite(finish)&&finish<position) continue;
        const other=prepared.vectors.get(horse);
        pairs.push(targetVector.map((value,index)=>value-other[index]));
        added=true;
      }
      if(added) targetRaces++;
    }
    let weights=FEATURES.map(feature=>feature.prior);
    const prior=weights.slice();
    // KULLANICI KARARI (2026-08-09): Ortak (joint) gradyan inişinde G.PR gibi tek
    // başına gerçek ama zayıf sinyaller (kazananlarda ham değer kaybedenlere göre
    // ~1,7 kat yüksek), TKP/AGF-Piyasa/Accurate gibi baskın sinyaller çoğu yarışı
    // zaten doğru açıklayınca, yalnız "zor" yarışlarda değerlendirilip orada işaret
    // ettiği yön ters çıktığı için ağırlığı düzenli negatife inip 0'a kırpılıyordu.
    // Bu istatistiksel olarak tutarlı (çoklu doğrusal bağlantı) ama kullanıcı bu
    // sinyallerin bazı yarışlarda gerçekten belirleyici olduğunu gözlemlediği için
    // TAMAMEN sıfırlanmalarını istemiyor. Öğrenme sonrası her özelliğin ağırlığı
    // kendi başlangıç önceliğinin (prior) en az %25'ine sabitlenir -- model zayıf
    // bulduğu sinyalleri güçlü şekilde küçültebilir ama tamamen susturamaz.
    const FLOOR_RATIO=0.25;
    if(pairs.length){
      const gradientStarted=global.__tkpCollectPerformanceTrace?performance.now():0;
      for(let epoch=0;epoch<120;epoch++){
        if(typeof global.tkpCouponCheck==='function')global.tkpCouponCheck();
        const gradient=weights.map((weight,index)=>-.018*(weight-prior[index]));
        for(const pair of pairs){
          let z=0;
          for(let index=0;index<pair.length;index++) z+=weights[index]*pair[index];
          const miss=1/(1+Math.exp(Math.max(-20,Math.min(20,z))));
          for(let index=0;index<pair.length;index++) gradient[index]+=miss*pair[index]/pairs.length;
        }
        weights=weights.map((weight,index)=>weight+.55*gradient[index]);
      }
      if(global.__tkpCollectPerformanceTrace)global.__tkpOnlinePerformanceTrace.gradient+=performance.now()-gradientStarted;
    }
    weights=weights.map((weight,index)=>Math.max(prior[index]*FLOOR_RATIO,weight));
    const sum=weights.reduce((total,value)=>total+value,0)||1;
    weights=weights.map(value=>value/sum);
    return {position,weights,targetRaces,pairs:pairs.length,trust:Math.max(0,Math.min(1,targetRaces/100))};
  }
  function priorPosition(position){
    const raw=FEATURES.map(feature=>Math.max(0,Number(feature.prior)||0));
    const sum=raw.reduce((total,value)=>total+value,0)||1;
    return {position,weights:raw.map(value=>value/sum),targetRaces:0,pairs:0,trust:0,provisional:true};
  }
  function validStoredPosition(value,position){
    return value&&Number(value.position)===Number(position)&&Array.isArray(value.weights)
      &&value.weights.length===FEATURES.length&&value.weights.every(weight=>Number.isFinite(Number(weight)));
  }
  function storedPositions(signature){
    const cache=db?.learning_state?.online_ranking_cache;
    if(!cache||cache.version!==VERSION||cache.signature!==signature||!cache.positions)return {};
    const out={};
    for(let position=1;position<=5;position++){
      const value=cache.positions[position]||cache.positions[String(position)];
      if(validStoredPosition(value,position))out[position]={...value,weights:value.weights.map(Number),provisional:false};
    }
    return out;
  }
  async function persistPositions(signature,positions){
    if(!db||!positions||!Object.keys(positions).length)return false;
    db.learning_state=db.learning_state&&typeof db.learning_state==='object'?db.learning_state:{};
    const cache={version:VERSION,signature,positions,trainedAt:new Date().toISOString()};
    db.learning_state.online_ranking_cache=cache;
    const api=global.TKPSegmentedIDB;
    if(!api||typeof api.updateMetaPatch!=='function')return false;
    try{
      const generation=String(db?.__segmented_storage?.baseGeneration||global.persistenceStatus?.().generation||'');
      await api.updateMetaPatch({learning_state:{online_ranking_cache:cache}},{expectedGeneration:generation,timeoutMs:30000});
      return true;
    }catch(error){
      global.__tkpOnlineRankingPersistError=String(error?.message||error);
      return false;
    }
  }
  async function trainPositionAsync(rows,position,options={}){
    const timing={position,totalMs:0,maxRaceChunkMs:0,maxGradientChunkMs:0};const totalStarted=performance.now();let chunkStarted=totalStarted;
    const pairs=[];let targetRaces=0;
    for(let raceIndex=0;raceIndex<rows.length;raceIndex++){
      const race=rows[raceIndex];
      // P1/P2/P3/P5 share the same input features. Reuse only within this
      // training request; a later import or another dataset gets a fresh map.
      let prepared=options.preparedVectors?.get(race);
      if(!prepared){prepared=vectorsForRace(race);options.preparedVectors?.set(race,prepared);}
      const target=prepared.horses.find(horse=>Number(horse?.finish_position)===position||(position===1&&Number(horse?.winner)===1));
      if(target){
        const targetVector=prepared.vectors.get(target);let added=false;
        for(const horse of prepared.horses){
          if(horse===target)continue;
          const finish=Number(horse?.finish_position);
          if(position>1&&Number.isFinite(finish)&&finish<position)continue;
          const other=prepared.vectors.get(horse);pairs.push(targetVector.map((value,index)=>value-other[index]));added=true;
        }
        if(added)targetRaces++;
      }
      if(performance.now()-chunkStarted>=8){
        options.checkpoint?.();
        timing.maxRaceChunkMs=Math.max(timing.maxRaceChunkMs,performance.now()-chunkStarted);
        if(options.yieldToUi)await options.yieldToUi();else if(typeof global.tkpYield==='function')await global.tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));
        chunkStarted=performance.now();
      }
    }
    timing.maxRaceChunkMs=Math.max(timing.maxRaceChunkMs,performance.now()-chunkStarted);
    let weights=FEATURES.map(feature=>feature.prior),prior=weights.slice();const FLOOR_RATIO=.25;
    if(pairs.length){
      const featureCount=FEATURES.length,pairCount=pairs.length;
      const matrix=new Float64Array(pairCount*featureCount);
      for(let row=0;row<pairCount;row++)matrix.set(pairs[row],row*featureCount);
      chunkStarted=performance.now();
      for(let epoch=0;epoch<120;epoch++){
        options.checkpoint?.();
        const gradient=weights.map((weight,index)=>-.018*(weight-prior[index]));
        for(let offset=0;offset<matrix.length;offset+=featureCount){
          let z=0;for(let index=0;index<featureCount;index++)z+=weights[index]*matrix[offset+index];
          const miss=1/(1+Math.exp(Math.max(-20,Math.min(20,z))));
          for(let index=0;index<featureCount;index++)gradient[index]+=miss*matrix[offset+index]/pairCount;
        }
        weights=weights.map((weight,index)=>weight+.55*gradient[index]);
        if(epoch>0&&epoch%4===0){timing.maxGradientChunkMs=Math.max(timing.maxGradientChunkMs,performance.now()-chunkStarted);if(options.yieldToUi)await options.yieldToUi();else if(typeof global.tkpYield==='function')await global.tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));chunkStarted=performance.now();}
      }
      timing.maxGradientChunkMs=Math.max(timing.maxGradientChunkMs,performance.now()-chunkStarted);
    }
    weights=weights.map((weight,index)=>Math.max(prior[index]*FLOOR_RATIO,weight));
    const sum=weights.reduce((total,value)=>total+value,0)||1;weights=weights.map(value=>value/sum);
    timing.totalMs=performance.now()-totalStarted;
    global.__tkpOnlineAsyncTrainingTiming=global.__tkpOnlineAsyncTrainingTiming||[];global.__tkpOnlineAsyncTrainingTiming.push(timing);
    if(global.__tkpOnlineAsyncTrainingTiming.length>200) global.__tkpOnlineAsyncTrainingTiming.splice(0,global.__tkpOnlineAsyncTrainingTiming.length-200);
    return {position,weights,targetRaces,pairs:pairs.length,trust:Math.max(0,Math.min(1,targetRaces/100))};
  }
  function currentModel(targetRace=null){
    const targetDate=String(targetRace?.race_date||targetRace?.date||'');
    const outcomeSignature=datasetSignature();
    if(!observedDatasetSignature)observedDatasetSignature=outcomeSignature;
    const signature=outcomeSignature+'|CUT:'+targetDate;
    if(modelCache.has(signature)) return modelCache.get(signature);
    const rows=resultRaces(targetRace);
    // Altılı yalnız P1 ister. P2-P5'i burada peşinen eğitmek ilk kuponda dört
    // gereksiz tam arşiv taraması yapıyordu; pozisyonlar ilk gerçek kullanımda açılır.
    const positions=storedPositions(signature);
    const value={version:VERSION,signature,resultRaces:rows.length,positions,trainedAt:new Date().toISOString()};
    modelCache.set(signature,value);
    while(modelCache.size>96) modelCache.delete(modelCache.keys().next().value);
    return value;
  }
  function learnedScores(race,horses,position,purpose='prediction'){
    const raceModel=currentModel(race);
    if(!raceModel.positions[position])raceModel.positions[position]=global.__tkpSideBetPanelNoScan===true?priorPosition(position):trainPosition(resultRaces(race),position);
    const model=raceModel.positions[position]||raceModel.positions[1];
    const prepared=vectorsForRace({...race,horses});
    const scores=new Map();
    let registryModel=null;
    try{
      if(typeof global.tkpPurposeWeightsForRace==='function'){
        registryModel=global.tkpPurposeWeightsForRace(race,purpose==='sidebet_position'?'sidebet_position':purpose,position,{noScan:global.__tkpSideBetPanelNoScan===true});
      }
    }catch(_){ registryModel=null; }
    for(const horse of prepared.horses){
      const vector=prepared.vectors.get(horse);
      let onlineScore=0;
      for(let index=0;index<vector.length;index++) onlineScore+=vector[index]*model.weights[index];
      onlineScore*=100;
      // Ayrıntılı analizde kayıtlı TÜM sinyaller (TKP, AGF, koşu uyumu, geçmiş, Son-6,
      // profil, BMB/ODB, Y.PUAN, KG, derece, ST, J-BYG, 400/800G, ekip, HNDKP, S,
      // ODS TR, VALUE, SP, geçmiş Accurate ve X) challenger katmanında da korunur.
      // Böylece online model yalnız kendi kısa özellik listesiyle yan bahis sırasını ezemez.
      let registryScore=null;
      try{
        if(registryModel&&typeof global.tkpPurposeCompositeScore==='function'){
          registryScore=global.tkpPurposeCompositeScore(race,horse,purpose,position,registryModel);
        }
      }catch(_){ registryScore=null; }
      let combined=Number.isFinite(Number(registryScore))?onlineScore*.40+Number(registryScore)*.60:onlineScore;
      // V51: yalnız daha önceki forward-tracking kaçırmalarından öğrenilen küçük challenger desteği.
      // P1 preserveFirst akışında korunur; bu boost esas olarak P2-P5/yan bahis kapsamını düzeltir.
      try{ if(typeof global.tkpFailureLearningHorseBoost==='function') combined+=Number(global.tkpFailureLearningHorseBoost(race,horse))||0; }catch(_){ }
      scores.set(horse,combined);
    }
    return {scores,model};
  }
  function hybridOrder(race,current,position,learnedShare,preserveFirst,purpose='prediction'){
    if(!Array.isArray(current)||current.length<2) return current||[];
    const existing=currentModel(race).positions[position];
    // A zero-trust challenger has exactly zero contribution to the final order.
    // Do not compute unused historical features while the UI uses that prior.
    if((existing&&Number(existing.trust)===0)||(!existing&&global.__tkpSideBetPanelNoScan===true))return current.slice();
    const {scores,model}=learnedScores(race,current,position,purpose);
    const share=Math.max(0,Math.min(learnedShare,learnedShare*model.trust));
    const currentRank=new Map(current.map((horse,index)=>[horse,100*(current.length-index)/current.length]));
    const first=preserveFirst?current[0]:null;
    const rest=preserveFirst?current.slice(1):current.slice();
    rest.sort((left,right)=>{
      const leftScore=(currentRank.get(left)||0)*(1-share)+(scores.get(left)||0)*share;
      const rightScore=(currentRank.get(right)||0)*(1-share)+(scores.get(right)||0)*share;
      return rightScore-leftScore
        || (Number(right?.score)||0)-(Number(left?.score)||0)
        || TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no),String(right?.horse_no));
    });
    return first?[first,...rest]:rest;
  }
  function rankingSourceSignature(prefix,race,horses){
    const source=horses||race?.horses||[];
    let failureSig='';
    try{if(typeof global.tkpFailureLearningModel==='function'){const m=global.tkpFailureLearningModel(race);failureSig=[m?.rows||0,m?.mainMiss||0,m?.singleLoss||0].join(':');}}catch(_){ }
    try{
      if(typeof global.adaptiveOrderSignature==='function'){
        return prefix+'|'+currentModel(race).signature+'|'+failureSig+'|'+global.adaptiveOrderSignature(race,source);
      }
    }catch(_){ }
    return prefix+'|'+datasetSignature()+'|'+failureSig+'|'+(race?.id||'')+'|'+(race?.file_id||'')+'|'+(race?.leg||'')+'|'+
      Array.from(source||[]).map(horse=>`${horse?.horse_no}:${Number(horse?.score)||0}:${Number(horse?.finish_position)||0}:${Number(horse?.winner)||0}`).join(',');
  }
  function cloneSidePositionRankings(rankings){
    const copy={};
    for(let position=1;position<=5;position++) copy['p'+position]=(rankings?.['p'+position]||[]).slice();
    return copy;
  }

  // V1.1.152 — GERÇEK HOLDOUT İLE DOĞRULANMIŞ KAPSAMA CHALLENGER'I
  // Ağırlıklar 2026-07-29 ve öncesindeki doğrulanmış yarışlardan türetilip,
  // 2026-07-30 ve sonrasındaki kilitli yarışlarda ayrı holdout olarak kontrol edildi.
  // Amaç lideri zorla değiştirmek değil; mevcut birinciyi KORUYUP 2-5 kapsamını
  // genişletmek. Holdout kilitli kümede P1 korunurken P3/P5 yükseldiği için yalnız
  // alt sıralarda %30 payla kullanılır. winner/finish/result_time/accurate-current
  // gibi sonuç sonrası alanlar bu skora kesinlikle girmez.
  const VALIDATED_COVERAGE_SHARE=.30;
  const VALIDATED_COVERAGE_WEIGHTS={
    agf_rank:.15,result_rank:0,tr_rank:.04,hndkp_rank:.09,sp_rank:.02,value_rank:.05,
    pre:.08,bmb:0,ypuan:.39,g800:.05,jbyg:.13
  };
  function validatedCoverageScores(race,current){
    const rows=Array.from(current||[]);
    const field=Math.max(1,rows.length);
    const preValues=rows.map(h=>Number(h?.pre_race_tkp_score)||0);
    const preMin=preValues.length?Math.min(...preValues):0;
    const preMax=preValues.length?Math.max(...preValues):0;
    const rankValue=(value,maxRank=field)=>{
      const n=Number(value); if(!Number.isFinite(n)||n<1) return 0;
      const cap=Math.max(1,Number(maxRank)||field);
      return Math.max(0,(cap+1-n)/cap);
    };
    const score=new Map();
    rows.forEach((horse,index)=>{
      const pre=Number(horse?.pre_race_tkp_score)||0;
      const preNorm=preMax>preMin?(pre-preMin)/(preMax-preMin):0;
      const ypuan=Math.max(0,Math.min(1,(Number(horse?.ypuan)||0)/35));
      const values={
        agf_rank:rankValue(horse?.agf_rank),result_rank:rankValue(horse?.result_rank),tr_rank:rankValue(horse?.tr_rank),
        hndkp_rank:rankValue(horse?.hndkp_rank),sp_rank:rankValue(horse?.sp_rank),value_rank:rankValue(horse?.value_rank),
        pre:preNorm,bmb:Number(horse?.bmb)===1?1:0,ypuan,
        // Collector'ın kanonik sıra alanları kullanılır. Ham/proxy alanı sıra gibi
        // yorumlamak GLP/G800 desteğini yanlış ata taşıyabilir.
        g800:rankValue(horse?.g800_rank??horse?.g800),jbyg:rankValue(horse?.jbyg_rank??horse?.jbyg,7)
      };
      let total=0; for(const [key,weight] of Object.entries(VALIDATED_COVERAGE_WEIGHTS)) total+=weight*(values[key]||0);
      score.set(horse,total*100);
    });
    return score;
  }
  function validatedCoverageOrder(race,current){
    if(!Array.isArray(current)||current.length<3) return current||[];
    const first=current[0]; // P1 HOLDOUT'TA KORUNDU: lider asla challenger yüzünden değişmez.
    const scores=validatedCoverageScores(race,current);
    const rankBase=new Map(current.map((horse,index)=>[horse,100*(current.length-index)/current.length]));
    const rest=current.slice(1);
    rest.sort((left,right)=>{
      const ls=(rankBase.get(left)||0)*(1-VALIDATED_COVERAGE_SHARE)+(scores.get(left)||0)*VALIDATED_COVERAGE_SHARE;
      const rs=(rankBase.get(right)||0)*(1-VALIDATED_COVERAGE_SHARE)+(scores.get(right)||0)*VALIDATED_COVERAGE_SHARE;
      return rs-ls || (Number(right?.score)||0)-(Number(left?.score)||0)
        || TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no),String(right?.horse_no));
    });
    return [first,...rest];
  }


  // V44 — BH1 KAPSAMA KURALI (yalnız P5 kurtarma):
  // 107 kilitli PRE-RACE yarışta validated %30 sırasına yalnız EN GÜÇLÜ gerçek BH adayı
  // eklenince P1 ve P3 değişmeden P5 %75,70 -> %77,57 yükseldi. İki BH eklemek P5'i
  // düşürdüğü için yalnız bir aday kullanılabilir. BH hiçbir zaman lider/TEK üretmez;
  // yalnız mevcut P5 dışındaysa 5. sıraya alınır ve eski P5 6. sıraya kayar.
  function bhCoverageOrder(race,current){
    if(!Array.isArray(current)||current.length<6) return current||[];
    let candidates=[];
    try{
      if(typeof global.tkpBombHunterCandidates==='function') candidates=global.tkpBombHunterCandidates(race)||[];
    }catch(_){ candidates=[]; }
    const row=(candidates||[]).find(item=>item?.h && Number(item?.h?.agf_rank||99)>=6 && Number(item?.score)>0.18);
    if(!row?.h) return current;
    const no=String(row.h.horse_no||'');
    const idx=current.findIndex(h=>String(h?.horse_no||'')===no);
    if(idx<0 || idx<=4) return current; // zaten ilk 5'teyse dokunma; P1-P4 asla değişmez.
    const out=current.slice();
    const bh=out.splice(idx,1)[0];
    const displaced=out.splice(4,1)[0];
    out.splice(4,0,bh);
    out.splice(5,0,displaced);
    bh.bh_coverage_pick=1;
    bh.bh_coverage_rank=5;
    return out;
  }


  // V45 — ZOR/KARIŞIK AYAK ODB1 KAPSAMA KURALI:
  // ODB yalnız gerçek zor ayakta (aynı eşik: difficultRaceMinimumCount => 62+) ve
  // yalnız en güçlü ilk ODB adayı için kullanılır. BH1 P5'i korur; ODB en fazla P6'ya
  // taşınır. Böylece P1-P5/TEK değişmez, fakat zor ayakta kuponun zaten zorunlu minimum
  // 6'lı kapsamına ODB gerçekten girer. Aynı at BH ile zaten ilk 6'daysa tekrar eklenmez.
  function championRaceDifficulty(race,current){
    try{
      if(typeof global.raceDifficultyIndex==='function'){
        const exact=Number(global.raceDifficultyIndex({r:race,scored:current}));
        if(Number.isFinite(exact)) return Math.max(0,Math.min(100,exact));
      }
    }catch(_){ }
    const live=Array.from(current||[]).filter(h=>h&&!isNonRunner(h));
    if(!live.length) return 0;
    const agf=live.slice().sort((a,b)=>(Number(b?.agf)||0)-(Number(a?.agf)||0));
    const a1=Number(agf[0]?.agf)||0,a2=Number(agf[1]?.agf)||0;
    const top3=agf.slice(0,3).reduce((sum,h)=>sum+(Number(h?.agf)||0),0);
    const s1=Number(live[0]?.score)||0,s2=Number(live[1]?.score)||0;
    const gap=Math.max(0,s1-s2);
    let d=0;
    d+=a1<12?28:a1<18?22:a1<25?12:3;
    d+=(a1-a2)<3?18:(a1-a2)<7?10:2;
    d+=top3<38?20:top3<50?12:3;
    d+=gap<.15?14:gap<.40?8:2;
    d+=live.length>=14?10:live.length>=10?6:2;
    const condition=String(race?.condition_family||race?.condition_text||'').toLocaleUpperCase('tr-TR');
    if(condition.includes('HAND')||condition.includes('MAIDEN')) d+=10;
    if(condition.includes('ŞARTLI 3')||condition.includes('SARTLI 3')) d+=7;
    return Math.max(0,Math.min(100,d));
  }
  function hardRaceOdbCoverageOrder(race,current){
    if(!Array.isArray(current)||current.length<7) return current||[];
    const difficulty=championRaceDifficulty(race,current);
    if(difficulty<62 || typeof global.isOdbCandidate!=='function') return current;
    const idx=current.findIndex(h=>{
      try{return !!global.isOdbCandidate(h,race);}catch(_){return false;}
    });
    if(idx<0 || idx<=5) return current; // zaten ilk 6'da: BH/ana sıra tarafından kapsandı.
    const out=current.slice();
    const odb=out.splice(idx,1)[0];
    const displaced=out.splice(5,1)[0];
    out.splice(5,0,odb);
    out.splice(6,0,displaced);
    odb.odb_hard_coverage_pick=1;
    odb.odb_hard_coverage_rank=6;
    odb.odb_hard_difficulty=Math.round(difficulty);
    return out;
  }

  function verifiedSignalComparison(){
    const rows=resultRaces();
    const defs=[
      {key:'bmb',label:'BMB',test:h=>Number(h?.bmb)===1},
      {key:'odb',label:'ODB',test:h=>Number(h?.odb)===1}
    ];
    const out={};
    for(const def of defs){
      let sample=0,p1=0,p3=0,p5=0,candidates=0;
      for(const race of rows){
        const marked=liveHorses(race).filter(def.test);
        if(!marked.length) continue;
        // Payda yalnız bu sinyalin yarış öncesi kaydında gerçekten bulunduğu koşulardır.
        sample++; candidates+=marked.length;
        const bestFinish=Math.min(...marked.map(h=>{
          const pos=Number(h?.finish_position);
          return Number.isFinite(pos)&&pos>0?pos:(Number(h?.winner)===1?1:999);
        }));
        if(bestFinish<=1)p1++;
        if(bestFinish<=3)p3++;
        if(bestFinish<=5)p5++;
      }
      out[def.key]={key:def.key,label:`${def.label} · ${sample} koşu`,sample,candidates,
        p1:sample?100*p1/sample:null,p3:sample?100*p3/sample:null,p5:sample?100*p5/sample:null};
    }
    return out;
  }

  function verifiedStrategyComparison(){
    const allResolved=(db?.prediction_log||[]).filter(row=>row?.resolved===1&&Number(row?.predicted_rank)>=1);
    // Eski gerçek yarış-öncesi loglarda strategy_version alanı yoktu. Bunları çöpe
    // atmak ekranda 312 sonuçlu koşu varken 0 koşu gösteriyordu. Sürümü uydurmadan
    // tek bir "etiketsiz eski sürüm" tabanında değerlendir.
    const rows=allResolved;
    const grouped=new Map();
    for(const row of rows){
      const version=row.strategy_version?String(row.strategy_version):'LEGACY_UNVERSIONED';
      if(!grouped.has(version)) grouped.set(version,new Map());
      const raceKey=[row.race_date,row.hippodrome,Number(row.altili_no)||1,row.leg,row.prediction_fp].join('|');
      const races=grouped.get(version);
      if(!races.has(raceKey)) races.set(raceKey,[]);
      races.get(raceKey).push(row);
    }
    const stats=[];
    for(const [version,races] of grouped){
      let sample=0,p1=0,p3=0,p5=0,lastTs='';
      for(const entries of races.values()){
        const winner=entries.find(row=>Number(row.winner)===1);
        if(!winner) continue;
        const rank=Number(winner.predicted_rank);
        if(!Number.isFinite(rank)||rank<1) continue;
        sample++; p1+=rank<=1?1:0; p3+=rank<=3?1:0; p5+=rank<=5?1:0;
        for(const row of entries) if(String(row.ts||'')>lastTs) lastTs=String(row.ts||'');
      }
      if(sample) stats.push({version,sample,p1:100*p1/sample,p3:100*p3/sample,p5:100*p5/sample,lastTs});
    }
    stats.sort((a,b)=>String(b.lastTs).localeCompare(String(a.lastTs))||b.sample-a.sample);
    let currentVersion=VERSION;
    try{ if(typeof TKP_SIDE_BET_STRATEGY_VERSION==='string') currentVersion=TKP_SIDE_BET_STRATEGY_VERSION; }catch(_){ }
    const exactCurrent=stats.find(item=>item.version===currentVersion)||null;
    const current=exactCurrent||{version:currentVersion,sample:0,p1:null,p3:null,p5:null,pending:true};
    const baseline=stats.filter(item=>item.version!==currentVersion).sort((a,b)=>b.sample-a.sample||String(b.lastTs).localeCompare(String(a.lastTs)))[0]
      || {version:'Önceki doğrulanmış sürüm',sample:0,p1:null,p3:null,p5:null};
    let decision='Yeni hibrit sürüm mevcut sonuçlarla izleniyor; otomatik ana model değişikliği yapılmayacak.';
    if(current.sample>0&&baseline.sample>0){ // V1.1.305: 20 yarış zorunluluğu kaldırıldı
      const p1Safe=current.p1>=baseline.p1-1;
      const coverageGain=current.p5>baseline.p5;
      decision=p1Safe&&coverageGain
        ? `Hibrit ${current.sample} gerçek koşuda birinciliği koruyup ilk 5 kapsamını artırdı; şampiyon olarak izlenebilir.`
        : `Hibrit henüz güvenli üstünlük göstermedi; önceki şampiyon korunuyor.`;
    }
    return {
      source:'Kayıtlı yarış öncesi gerçek tahminler',
      current:{...baseline,label:`${baseline.version==='LEGACY_UNVERSIONED'?'Eski sürüm (etiketsiz)':'Önceki sürüm'} · ${baseline.sample} koşu`},
      hybrid:{...current,label:current.sample?`Devredeki hibrit · ${current.sample} koşu`:'Devredeki hibrit · ileri test kaydı bekleniyor'},
      decision,
      strategies:stats,
      signals:verifiedSignalComparison(),
      diagnostics:{resolvedRows:allResolved.length,versionedRows:allResolved.filter(row=>row.strategy_version).length,unversionedRows:allResolved.filter(row=>!row.strategy_version).length}
    };
  }

  if(typeof originalAdaptive==='function'){
    global.adaptiveOrderForRace=function(race,horses){
      if(global.__tkpBoundedCurrentReplay===true)return originalAdaptive(race,horses);
      const current=originalAdaptive(race,horses);
      const ordered=hybridOrder(race,current,1,.28,true);
      ordered.forEach((horse,index)=>{ horse.online_hybrid_rank=index+1; });
      return ordered;
    };
  }
  if(typeof originalStrategic==='function'){
    global.strategicOrderForRace=function(race,horses){
      if(global.__tkpBoundedCurrentReplay===true)return originalStrategic(race,horses);
      const current=originalStrategic(race,horses);
      // Güçlü TKP yolunda adaptiveOrder zaten hibriti uyguladı. Düşük TKP/Y.PUAN
      // geri dönüş yolunda da aynı güvenli destek çalışsın; iki kez uygulanmasın.
      if(current.some(horse=>Number.isFinite(Number(horse?.online_hybrid_rank)))) return current;
      const ordered=hybridOrder(race,current,1,.28,true);
      ordered.forEach((horse,index)=>{ horse.online_hybrid_rank=index+1; });
      return ordered;
    };
  }
  if(typeof originalAltili==='function'){
    global.altiliWinnerOrderForRace=function(race,horses){
      if(global.__tkpBoundedCurrentReplay===true)return originalAltili(race,horses);
      const trace=global.__tkpCollectPerformanceTrace?(global.__tkpOnlinePerformanceTrace||(global.__tkpOnlinePerformanceTrace={features:{},vectors:0,gradient:0})):null;
      let started=trace?performance.now():0;
      const current=originalAltili(race,horses);
      if(trace){trace.originalAltili=(trace.originalAltili||0)+(performance.now()-started);started=performance.now();}
      const learned=hybridOrder(race,current,1,.55,true);
      if(trace){trace.hybrid=(trace.hybrid||0)+(performance.now()-started);started=performance.now();}
      // Champion: P1 kilitli + validated %30 P2-P5 rerank. Ardından en güçlü BH
      // P5 kurtarma; yalnız zor/karışık ayakta en güçlü ODB P6 kurtarma. P1-P4 ve TEK
      // değişmez; ODB yalnız zor ayakta zaten 6+ kapsanan Altılı kuponuna destek olur.
      const validated=validatedCoverageOrder(race,learned);
      if(trace){trace.validated=(trace.validated||0)+(performance.now()-started);started=performance.now();}
      const bhCovered=bhCoverageOrder(race,validated);
      if(trace){trace.bh=(trace.bh||0)+(performance.now()-started);started=performance.now();}
      const ordered=hardRaceOdbCoverageOrder(race,bhCovered);
      if(trace)trace.odb=(trace.odb||0)+(performance.now()-started);
      ordered.forEach((horse,index)=>{ horse.altili_winner_rank=index+1; horse.online_hybrid_rank=index+1; });
      return ordered;
    };
  }
  if(typeof originalSidePositions==='function'){
    global.sideBetPositionRankingsForRace=function(race,horses){
      const cacheTarget=(race&&typeof race==='object')?race:(Array.isArray(horses)?horses:null);
      const signature=rankingSourceSignature('ONLINE_SIDE_CSSCS',race,horses)+'|'+(global.__tkpSideBetPanelNoScan===true?'NOSCAN':'FULL');
      const cached=cacheTarget?sidePositionCache.get(cacheTarget):null;
      if(cached&&cached.signature===signature) return cloneSidePositionRankings(cached.rankings);
      const current=originalSidePositions(race,horses);
      // Arşiv walk-forward seçimi: C-S-S-C-S.
      // P1 ve P4 = ortak/Champion sıra; P2/P3/P5 = pozisyona özel side model.
      // Böylece Çifte'nin P1'i de ortak şampiyondan gelir; sıralı bahislerde 2./3./5.
      // pozisyonlarda side modelin ölçülen üstünlüğü kullanılır.
      let common=[];
      try{ common=typeof global.strategicOrderForRace==='function' ? global.strategicOrderForRace(race,horses) : []; }catch(_){ common=[]; }
      const out={};
      for(let position=1;position<=5;position++){
        const useCommon=(position===1||position===4) && common.length;
        out['p'+position]=useCommon
          ? common.slice()
          : hybridOrder(race,current['p'+position]||[],position,.30,false,'sidebet_position');
        out['p'+position].forEach((horse,index)=>{ horse['sidebet_p'+position+'_rank']=index+1; });
      }
      if(cacheTarget) sidePositionCache.set(cacheTarget,{signature,rankings:out});
      return cloneSidePositionRankings(out);
    };
  }

  global.tkpOnlineRankingStatus=function(){
    const model=currentModel();
    for(let position=1;position<=5;position++)if(!model.positions[position])model.positions[position]=trainPosition(resultRaces(),position);
    const p1=model.positions[1];
    const weights=FEATURES.map((feature,index)=>({key:feature.key,label:feature.label,weight:p1.weights[index]||0}))
      .sort((a,b)=>b.weight-a.weight);
    const positionWeights={};
    for(let position=1;position<=5;position++){
      positionWeights[position]=FEATURES.map((feature,index)=>({key:feature.key,label:feature.label,weight:model.positions[position]?.weights?.[index]||0}));
    }
    const verified=verifiedStrategyComparison();
    return {
      version:VERSION,
      mode:'P1 kilit + Validated %30 + BH1 P5 + zor ayakta ODB1 P6 · Yan bahis C-S-S-C-S',
      resultRaces:model.resultRaces,
      trainedAt:model.trainedAt,
      weights,
      positionWeights,
      comparison:verified,
      decision:verified.decision
    };
  };
  global.tkpVerifiedStrategyComparison=verifiedStrategyComparison;
  global.tkpPretrainOnlinePositionsAsync=async function(race,positions=[1],options={}){
    const raceModel=currentModel(race),rows=resultRaces(race);
    const trainingOptions={...options,preparedVectors:new Map()};
    let changed=false;
    for(const rawPosition of positions){
      const position=Math.max(1,Math.min(5,Number(rawPosition)||1));
      if(raceModel.positions[position]&&!raceModel.positions[position].provisional)continue;
      raceModel.positions[position]=await trainPositionAsync(rows,position,trainingOptions);
      changed=true;
    }
    if(changed)sidePositionCache=new WeakMap();
    return true;
  };
  global.tkpPrimeOnlinePositionsForImmediateRender=function(race,positions=[1]){
    const raceModel=currentModel(race);
    for(const rawPosition of positions){
      const position=Math.max(1,Math.min(5,Number(rawPosition)||1));
      if(!raceModel.positions[position])raceModel.positions[position]=priorPosition(position);
    }
    return {signature:raceModel.signature,provisional:positions.some(position=>raceModel.positions[position]?.provisional===true)};
  };
  global.tkpScheduleOnlinePositionsTraining=function(races,positions=[1]){
    const race=(Array.isArray(races)?races[0]:races)||null;
    if(!race)return false;
    const raceModel=currentModel(race);
    const wanted=[...new Set(positions.map(position=>Math.max(1,Math.min(5,Number(position)||1))))]
      .filter(position=>!raceModel.positions[position]||raceModel.positions[position].provisional===true);
    if(!wanted.length)return false;
    const jobKey=`${raceModel.signature}|${wanted.join(',')}`;
    if(trainingJobs.has(jobKey))return false;
    const run=async()=>{
      try{
        const rows=resultRaces(race),trained={},trainingOptions={preparedVectors:new Map(),yieldToUi:async()=>{
          while(Number(global.__tkpSideBetBuildDepth)>0||global.__tkpCouponCriticalPath===true)await new Promise(resolve=>setTimeout(resolve,30));
          if(typeof global.tkpYield==='function')await global.tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));
        }};
        await trainingOptions.yieldToUi();
        for(const position of wanted)trained[position]=await trainPositionAsync(rows,position,trainingOptions);
        if(datasetSignature()+'|CUT:'+String(race?.race_date||race?.date||'')!==raceModel.signature)return false;
        const merged={...storedPositions(raceModel.signature),...trained};
        for(const [position,value] of Object.entries(trained))raceModel.positions[position]={...value,provisional:false};
        await persistPositions(raceModel.signature,merged);
        global.__tkpOnlineBackgroundTraining={status:'complete',signature:raceModel.signature,positions:wanted,at:new Date().toISOString()};
        return true;
      }finally{trainingJobs.delete(jobKey);}
    };
    trainingJobs.set(jobKey,true);
    global.__tkpOnlineBackgroundTraining={status:'queued',signature:raceModel.signature,positions:wanted,at:new Date().toISOString()};
    if(typeof global.tkpQueueTask==='function')global.tkpQueueTask(`online-rank:${jobKey}`,run,{priority:'background',replace:false,minIdleMs:1800});
    else if(typeof global.tkpRunWhenUserIdle==='function')global.tkpRunWhenUserIdle(run,{minIdleMs:1800,retryMs:250,maxWaitMs:0});
    else setTimeout(()=>{void run();},1200);
    return true;
  };
  // Haftalık challenger takipçisi aynı doğrulanmış %30 katmanı gerçek fonksiyonuyla
  // shadow olarak çağırabilsin. Kopya/proxy formül yoktur; verilen dizi kopyalanır ve
  // canlı Champion sırasına yan etki yapılmaz.
  global.tkpValidatedCoverageOrder=function(race,current){
    return validatedCoverageOrder(race,Array.isArray(current)?current.slice():[]);
  };
  global.tkpInvalidateOnlineRankingModel=function(){ modelCache=new Map(); sidePositionCache=new WeakMap(); observedDatasetSignature=''; };
  if(global.addEventListener)global.addEventListener('tkp:db-changed',()=>{
    const next=datasetSignature();
    if(!observedDatasetSignature){observedDatasetSignature=next;return;}
    if(next!==observedDatasetSignature){modelCache=new Map();sidePositionCache=new WeakMap();observedDatasetSignature=next;}
  });
})(window);
