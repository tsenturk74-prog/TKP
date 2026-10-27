/**
 * surprise-portfolio-engine.js
 *
 * Ana Tahmin 1-5 sırasını değiştirmeden kupon ve yan bahis kapsamına farklı bir
 * senaryo kazandırır. Yalnız yarıştan önce bilinen alanları kullanır; winner,
 * finish_position ve yarıştan sonra gelen Accurate alanları bu motora girmez.
 */
(function(global){
  'use strict';

  const VERSION='V53-LEAKFREE-SURPRISE-PORTFOLIO';
  let preparedCache=new WeakMap();

  function numberOrNull(value){
    if(value===null||value===undefined||value==='') return null;
    const parsed=Number(String(value).replace(',','.'));
    return Number.isFinite(parsed)?parsed:null;
  }
  function clamp01(value){ return Math.max(0,Math.min(1,Number(value)||0)); }
  function horseNo(horse){ return String(horse?.horse_no??'').trim(); }
  function nonRunner(horse){
    try{ return typeof global.isNonRunner==='function'&&global.isNonRunner(horse); }
    catch(_){ return /\(KOŞMAZ\)/i.test(String(horse?.horse_name||'')); }
  }
  function rankStrength(value,fieldSize,maxRank=null){
    const rank=numberOrNull(value);
    const cap=Math.max(2,Math.min(maxRank||fieldSize||12,fieldSize||12));
    if(rank===null||rank<1||rank>cap) return .5;
    return clamp01(1-(rank-1)/Math.max(1,cap-1));
  }
  function normalizedHigh(value,maxValue){
    const current=numberOrNull(value), maximum=numberOrNull(maxValue);
    if(current===null||maximum===null||maximum<=0) return .5;
    return clamp01(current/maximum);
  }
  function lastSixStats(horse){
    try{
      if(typeof global.tkpLastSixStats==='function') return global.tkpLastSixStats(horse);
    }catch(_){ }
    const raw=String(horse?.son6_raw??horse?.son6Raw??horse?.last6??'');
    const positions=(raw.match(/[0-9]/g)||[]).slice(-6).map(Number);
    const points={0:.02,1:1,2:.82,3:.68,4:.50,5:.38,6:.28,7:.18,8:.10,9:.05};
    const form=positions.length?positions.reduce((sum,pos)=>sum+(points[pos]??0),0)/positions.length:0;
    return {starts:positions.length,wins:positions.filter(pos=>pos===1).length,form:clamp01(form)};
  }
  function isOdb(horse,race){
    try{ return typeof global.isOdbCandidate==='function'&&global.isOdbCandidate(horse,race); }
    catch(_){ return false; }
  }
  function preRaceTkp(horse){
    return numberOrNull(horse?.prediction_score_snapshot??horse?.pre_race_tkp_score??horse?.score);
  }
  function priorSpeed(horse){
    return numberOrNull(horse?.priorAccurateAvgSpeed??horse?.prior_accurate_avg_speed);
  }

  function preparedEvidence(race,baseOrder){
    const source=(Array.isArray(baseOrder)&&baseOrder.length?baseOrder:(race?.horses||[]))
      .filter(horse=>horse&&!nonRunner(horse));
    const cacheTarget=race&&typeof race==='object'?race:null;
    const dbSig=typeof global.tkpFastDbSignature==='function'?global.tkpFastDbSignature(global.db):`${global.db?.files?.length||0}:${global.db?.races?.length||0}`;
    const inputSig=dbSig+'|'+source.map(horse=>[horseNo(horse),horse?.prediction_score_snapshot,horse?.pre_race_tkp_score,horse?.score,horse?.agf,horse?.agf_rank,horse?.result_rank,horse?.value_score,horse?.value_rank,horse?.hndkp_rank,horse?.jbyg,horse?.ypuan,horse?.tr_ganyan,horse?.bmb,horse?.odb,horse?.priorStarts,horse?.priorWins,horse?.son6_raw].join(':')).join(';');
    const cached=cacheTarget?preparedCache.get(cacheTarget):null;
    if(cached?.signature===inputSig)return cached.value;
    const seen=new Set();
    const horses=source.filter(horse=>{
      const no=horseNo(horse);
      if(!no||seen.has(no)) return false;
      seen.add(no); return true;
    });
    const field=Math.max(2,horses.length);
    const baseRank=new Map(horses.map((horse,index)=>[horseNo(horse),index+1]));
    const maxYpuan=Math.max(0,...horses.map(horse=>numberOrNull(horse?.ypuan)||0));
    const maxValue=Math.max(0,...horses.map(horse=>numberOrNull(horse?.value_score)||0));
    const maxTkp=Math.max(0,...horses.map(horse=>preRaceTkp(horse)||0));
    const speedValues=horses.map(priorSpeed).filter(Number.isFinite);
    const minSpeed=speedValues.length?Math.min(...speedValues):null;
    const maxSpeed=speedValues.length?Math.max(...speedValues):null;

    const rows=horses.map(horse=>{
      const rank=baseRank.get(horseNo(horse))||field;
      const agfRank=numberOrNull(horse?.agf_rank);
      const resultRank=numberOrNull(horse?.result_rank);
      const valueRank=numberOrNull(horse?.value_rank);
      const hndkpRank=numberOrNull(horse?.hndkp_rank);
      const jbygRank=numberOrNull(horse?.jbyg??horse?.jbyg_rank??horse?.team_strength_rank);
      const ypuan=numberOrNull(horse?.ypuan)||0;
      const recent=lastSixStats(horse);
      const speed=priorSpeed(horse);
      const speedSignal=Number.isFinite(speed)&&Number.isFinite(minSpeed)&&Number.isFinite(maxSpeed)
        ? (maxSpeed>minSpeed?clamp01((speed-minSpeed)/(maxSpeed-minSpeed)):.5)
        : .5;
      const marketTail=agfRank!==null&&agfRank>=5;
      const valueTail=valueRank!==null&&valueRank<=2&&agfRank!==null&&agfRank>=6;
      const consensusTail=ypuan>0&&maxYpuan>0&&ypuan/maxYpuan>=.70&&agfRank!==null&&agfRank>=6;
      const classicTail=resultRank!==null&&resultRank>=6&&resultRank<=8&&agfRank!==null&&agfRank>=6&&agfRank<=11;
      const trProfile=typeof global.trGanyanProfileForHorse==='function'?global.trGanyanProfileForHorse(race,horse,horses):null;
      const moneySignal=Number(horse?.bmb)===1||isOdb(horse,race)||!!trProfile?.hardCoupon||!!trProfile?.isBmb;
      const priorStarts=Math.max(0,numberOrNull(horse?.priorStarts)||0);
      const priorWins=Math.max(0,numberOrNull(horse?.priorWins)||0);
      const priorRate=priorStarts>0?clamp01(priorWins/priorStarts):0;

      // Ana skor küçük tutulur; amaç favori sırasını yeniden üretmek değil, favori
      // çekirdeğinin arkasındaki farklı ve kanıtlı kuyruk adaylarını sıralamaktır.
      let score=0;
      score+=rankStrength(rank,field)*.14;
      score+=normalizedHigh(ypuan,maxYpuan)*.16;
      score+=(valueRank!==null?rankStrength(valueRank,field):normalizedHigh(horse?.value_score,maxValue))*.12;
      score+=rankStrength(hndkpRank,field)*.08;
      score+=clamp01(recent.form)*.12;
      score+=recent.wins>0?.05:0;
      score+=moneySignal?.15:0;
      score+=rankStrength(jbygRank,field,7)*.05;
      score+=speedSignal*.05;
      score+=normalizedHigh(preRaceTkp(horse),maxTkp)*.05;
      score+=priorRate*.08;
      score+=marketTail?.04:0;
      score+=classicTail?.18:0;
      score+=consensusTail?.18:0;
      score+=valueTail?.12:0;

      const evidence=[
        classicTail?'SONUÇ/AGF kuyruk bandı':'',
        consensusTail?'Y.PUAN-piyasa ayrışması':'',
        valueTail?'VALUE-piyasa ayrışması':'',
        trProfile?.hardCoupon?'TR-GİZLİ FVR':'',
        trProfile?.isBmb?'TR-BMB':'',
        (Number(horse?.bmb)===1||isOdb(horse,race))?'BMB/ODB':'',
        recent.wins>0?'Son 6 galibiyeti':'',
        jbygRank!==null&&jbygRank<=3?'J-BYG ilk 3':'',
        speedSignal>=.75&&speedValues.length>=3?'Geçmiş Accurate hız':'',
        priorRate>0?'Geçmiş galibiyet':'',
      ].filter(Boolean);
      return {horse,rank,score:Math.round(score*10000)/10000,evidence,classicTail,consensusTail,valueTail,moneySignal};
    });
    const value={horses,rows,baseRank};
    if(cacheTarget)preparedCache.set(cacheTarget,{signature:inputSig,value});
    return value;
  }

  function surpriseEvidenceForHorse(race,horse,baseOrder){
    const prepared=preparedEvidence(race,baseOrder);
    return prepared.rows.find(row=>horseNo(row.horse)===horseNo(horse))||{horse,rank:999,score:0,evidence:[]};
  }

  // Tek bir birleşik skor, aynı tür kanıtları üst üste yığıp bütün bütçeyi yine
  // favori kuyruğuna verebilir. Bu nedenle ilk kuyruk adayı üç bağımsız sürpriz
  // şeridinden seçilir: klasik SONUÇ/AGF bandı, piyasa ayrışması ve para/form
  // sinyali. Klasik şeritte derinlik kontrollü bir karşıtlık puanıdır; salt en
  // zayıf at değil, yeterli ön-yarış kanıtı olan daha derin aday öne çıkar.
  function diversifiedTail(rows){
    const remaining=rows.slice(), anchors=[];
    const takeBest=(predicate,scoreFn)=>{
      const candidates=remaining.filter(predicate).sort((left,right)=>
        scoreFn(right)-scoreFn(left)||right.score-left.score||left.rank-right.rank
      );
      const chosen=candidates[0];
      if(!chosen) return;
      anchors.push(chosen);
      remaining.splice(remaining.indexOf(chosen),1);
    };
    takeBest(row=>row.classicTail,row=>row.score+Math.min(6,Math.max(0,row.rank-4))*.08);
    takeBest(row=>row.consensusTail||row.valueTail,row=>row.score+(row.consensusTail ? .08 : 0)+(row.valueTail ? .05 : 0));
    takeBest(row=>row.moneySignal||row.evidence.includes('Son 6 galibiyeti'),row=>row.score+(row.moneySignal ? .08 : 0));
    remaining.sort((left,right)=>right.score-left.score||left.rank-right.rank||TKP_TR_COLLATOR_NUM.compare(horseNo(left.horse),horseNo(right.horse)));
    return anchors.concat(remaining);
  }

  function portfolioOrderForRace(race,baseOrder,mode='surprise'){
    const prepared=preparedEvidence(race,baseOrder);
    if(mode==='main'||prepared.horses.length<=4) return prepared.horses.slice();
    const coreCount=5;
    const core=prepared.horses.slice(0,coreCount);
    const coreNos=new Set(core.map(horseNo));
    const tailRows=prepared.rows.filter(row=>!coreNos.has(horseNo(row.horse)));
    const tail=(mode==='alt'||mode==='surprise'?diversifiedTail(tailRows):tailRows)
      .map(row=>row.horse);
    return core.concat(tail);
  }

  function portfolioHedgesForRace(race,baseOrder,limit=2){
    const prepared=preparedEvidence(race,baseOrder);
    return diversifiedTail(prepared.rows
      .filter(row=>row.rank>4&&(row.evidence.length>0||row.score>=.34)))
      .slice(0,Math.max(0,Number(limit)||0));
  }

  function isPortfolioCandidate(race,horse,baseOrder){
    const row=surpriseEvidenceForHorse(race,horse,baseOrder);
    return row.rank>4&&(row.evidence.length>0||row.score>=.34);
  }

  global.TKP_SURPRISE_PORTFOLIO_VERSION=VERSION;
  global.tkpSurpriseEvidenceForHorse=surpriseEvidenceForHorse;
  global.tkpPortfolioOrderForRace=portfolioOrderForRace;
  global.tkpPortfolioHedgesForRace=portfolioHedgesForRace;
  global.tkpIsPortfolioCandidate=isPortfolioCandidate;
  global.tkpInvalidateSurprisePortfolioCache=()=>{preparedCache=new WeakMap();};
  if(global.addEventListener)global.addEventListener('tkp:db-changed',()=>{preparedCache=new WeakMap();});
})(window);
