/*
 * R19.46 — sonuç sonrası, görünür kart için düşük öncelikli model hazırlığı.
 * P1 altılı, P2–P5 yan bahis sırasıdır. Eğitim ve kalıcılık mevcut
 * online-ranking-engine kuyruğundadır; bu modül sonuç/kupon alanını değiştirmez.
 */
(function(global){
  'use strict';
  let lastEnqueuedSignature='';
  let pending=null;
  let awaitingSignature='';
  let status={state:'idle',signature:'',date:''};
  const dateOf=r=>String(r?.race_date||r?.date||'').slice(0,10);
  const resultKnown=r=>(r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  function nextCardRace(payload,today){
    const races=Array.isArray(payload?.races)?payload.races:[];
    return races.map(item=>item?.r||item).find(r=>{
      const day=dateOf(r);
      return /^\d{4}-\d{2}-\d{2}$/.test(day)&&day>=today&&!resultKnown(r)
        &&(r?.horses||[]).filter(h=>h&&!h.non_runner&&h.horse_no!=null).length>=2;
    })||null;
  }
  function safeToTrain(){
    return global.document?.hidden===true || (typeof global.document?.hasFocus==='function'&&!global.document.hasFocus());
  }
  function flush(){
    if(!pending||!safeToTrain())return false;
    const {signature,race}=pending;
    if(typeof global.tkpScheduleOnlinePositionsTraining!=='function'){
      status={state:'trainer-unavailable',signature,date:dateOf(race)};return false;
    }
    // The existing trainer yields and deduplicates. Never start it while the
    // application has focus: real-archive testing measured a >0.5s gap.
    const queued=global.tkpScheduleOnlinePositionsTraining([race],[1,2,3,4,5]);
    if(queued){
      lastEnqueuedSignature=signature;
      pending=null;
      status={state:'queued',signature,date:dateOf(race)};
      return true;
    }
    // A false return does not prove that this model was trained. Keep the
    // signature available for a later retry, rather than silently losing it.
    status={state:'not-queued',signature,date:dateOf(race)};
    return false;
  }
  function onOutcomeChange(previousSignature,nextSignature){
    const signature=String(nextSignature||'');
    if(!previousSignature||!signature||previousSignature===signature||signature===lastEnqueuedSignature)return false;
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});
    const race=nextCardRace(global.__lastPredictionPayload,today);
    if(!race){awaitingSignature=signature;status={state:'waiting-for-current-card',signature,date:''};return false;}
    awaitingSignature='';
    pending={signature,race};
    status={state:'waiting-for-unfocused-window',signature,date:dateOf(race)};
    return safeToTrain()?flush():true;
  }
  function onCardChange(){
    if(!awaitingSignature||awaitingSignature===lastEnqueuedSignature)return false;
    const signature=awaitingSignature;
    return onOutcomeChange('previous',signature);
  }
  global.addEventListener?.('blur',flush);
  global.document?.addEventListener?.('visibilitychange',flush);
  global.tkpContinuousLearning=Object.freeze({onOutcomeChange,onCardChange,nextCardRace,flush,getStatus:()=>({...status})});
})(globalThis);
