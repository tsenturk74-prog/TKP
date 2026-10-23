'use strict';
/* TKP R17 AutoGluon bridge. Prediction payload is shadow-only unless promotion_gate.pass=true. */
(function(global){
  const state={schema:null,modelId:null,promotionGate:null,rows:new Map(),loadedAt:null};
  const no=h=>String(h?.horse_no??h?.horseNo??'').trim();
  const raceKey=r=>String(r?.race_uid||(r?.meeting_uid?`${r.meeting_uid}|${r?.leg??''}|${r?.id??''}`:null)||`${r?.race_date||''}|${r?.hippodrome||''}|${r?.file_id||''}|${r?.leg||''}|${r?.id||''}`);
  const key=(r,h)=>`${raceKey(r)}|${no(h)}`;
  function tkpR17LoadPredictionPayload(payload){
    if(!payload||payload.schema!=='TKP_R17_PWIN_V1'||!Array.isArray(payload.rows)){
      return {loaded:0,error:'Geçersiz R17 prediction payload'};
    }
    const identities=new Set();for(const row of payload.rows){const id=String(row?.race_key||'').trim()+'|'+String(row?.horse_no??'').trim();if(identities.has(id))return {loaded:0,error:'Tekrarlanan yarış/at kimliği; tahmin yüklenmedi.'};identities.add(id);}
    state.schema=payload.schema;state.modelId=payload.model_id||null; state.promotionGate=payload.promotion_gate||null; state.rows.clear();
    let loaded=0;
    for(const row of payload.rows){
      const rk=String(row?.race_key||'').trim(), hn=String(row?.horse_no??'').trim(), p=Number(row?.p_win);
      if(!rk||!hn||!Number.isFinite(p)||p<0||p>1) continue;
      const cp=Number(row?.catboost_p_win),dp=row?.deep_surprise_p==null||row.deep_surprise_p===''?NaN:Number(row.deep_surprise_p);
      state.rows.set(`${rk}|${hn}`,{...row,p_win:p,catboost_p_win:(Number.isFinite(cp)&&cp>=0&&cp<=1)?cp:null,deep_surprise_p:(Number.isFinite(dp)&&dp>=0&&dp<=1)?dp:null}); loaded++;
    }
    state.loadedAt=new Date().toISOString();
    try{
      if(global.db?.settings){
        global.db.settings.r17_autogluon={schema:state.schema,loaded_at:state.loadedAt,promotion_gate:state.promotionGate,loaded_rows:loaded};
      }
    }catch(_){ }
    return {loaded,model_id:state.modelId,active:tkpR17IsActive(),promotion_gate:state.promotionGate};
  }
  function tkpR17IsActive(){
    const gate=state.promotionGate||{};
    if(typeof gate.production_pass==='boolean') return gate.production_pass===true;
    return gate.pass===true;
  }
  function tkpR17PWinForHorse(race,horse){
    const row=state.rows.get(key(race,horse)); return row?Number(row.p_win):null;
  }
  function tkpR17CatBoostPWinForHorse(race,horse){
    const row=state.rows.get(key(race,horse));const p=Number(row?.catboost_p_win);return Number.isFinite(p)?p:null;
  }
  function tkpDeepSurprisePForHorse(race,horse){const row=state.rows.get(key(race,horse));const raw=row?.deep_surprise_p;if(raw==null)return null;const p=Number(raw);return Number.isFinite(p)?p:null;}
  function tkpDeepSurpriseOutsideTop5(race,baseOrder,limit=2){const rows=Array.from(baseOrder||race?.horses||[]).filter(Boolean);const tail=rows.slice(5).map(h=>({h,p:tkpDeepSurprisePForHorse(race,h)})).filter(x=>Number.isFinite(x.p)).sort((a,b)=>b.p-a.p);return tail.slice(0,Math.max(0,Number(limit)||0)).map(x=>x.h);}
  function tkpR17CatBoostRescueOrderForRace(race,baseOrder){
    const rows=Array.from(baseOrder||race?.horses||[]).filter(Boolean);if(rows.length<2)return rows.slice();
    const first=rows[0],rest=rows.slice(1),cat=rest.slice().sort((a,b)=>{
      const ap=tkpR17CatBoostPWinForHorse(race,a),bp=tkpR17CatBoostPWinForHorse(race,b),av=Number.isFinite(ap),bv=Number.isFinite(bp);
      if(av!==bv)return av?-1:1;if(av&&Math.abs(ap-bp)>1e-12)return bp-ap;return rows.indexOf(a)-rows.indexOf(b);
    });
    // Champion P1 kesin kilitli. CatBoost yalnız P2+ sıralamasını rescue eder.
    return [first,...cat];
  }
  function tkpR17CatBoostTop1ShadowForRace(race,horses){
    const rows=Array.from(horses||race?.horses||[]).filter(Boolean).map(h=>({h,p:tkpR17CatBoostPWinForHorse(race,h)})).filter(x=>Number.isFinite(x.p)).sort((a,b)=>b.p-a.p);
    if(!rows.length)return null;return {horse_no:no(rows[0].h),p:rows[0].p,gap:rows.length>1?rows[0].p-rows[1].p:null,override_enabled:false};
  }
  function tkpR17OrderForRace(race,horses){
    const rows=Array.from(horses||race?.horses||[]);
    if(!tkpR17IsActive()) return rows.slice();
    return rows.slice().sort((a,b)=>{
      const ap=tkpR17PWinForHorse(race,a),bp=tkpR17PWinForHorse(race,b);
      const av=Number.isFinite(ap),bv=Number.isFinite(bp);
      if(av!==bv) return av?-1:1;
      if(av&&Math.abs(ap-bp)>1e-12) return bp-ap;
      return (Number(b?.score)||0)-(Number(a?.score)||0)||no(a).localeCompare(no(b),'tr',{numeric:true});
    });
  }
  function tkpR17AttachShadowProbabilities(race,horses){
    for(const h of Array.from(horses||race?.horses||[])){
      const p=tkpR17PWinForHorse(race,h); if(Number.isFinite(p)) h.r17_p_win=p;
      const cp=tkpR17CatBoostPWinForHorse(race,h);if(Number.isFinite(cp))h.r17_catboost_p_win=cp;
      const dp=tkpDeepSurprisePForHorse(race,h);if(Number.isFinite(dp))h.r19_deep_surprise_p=dp;
    }
    return horses||race?.horses||[];
  }
  async function tkpR17ScoreLiveRaces(races,options={}){
    const list=Array.isArray(races)?races:[];
    if(!list.length) return {loaded:0,skipped:true,reason:'Koşu yok'};
    const endpoint=String(options.endpoint||'http://127.0.0.1:3763/predict');
    const requestBody=JSON.stringify({schema:'TKP_R17_LIVE_RACES_V1',races:list});
    const response=await global.fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:requestBody
    });
    if(!response||!response.ok) throw new Error(`R17 sidecar HTTP ${response?.status||'ERR'}`);
    const payload=await response.json();
    // Do not associate an older DS response with inputs edited while scoring.
    const inputUnchanged=JSON.stringify({schema:'TKP_R17_LIVE_RACES_V1',races:list})===requestBody;
    if(!inputUnchanged)for(const row of payload.rows||[])row.deep_surprise_p=null;
    let decisionSignature='';
    try{const current=global.lastRaceResults||(typeof lastRaceResults!=='undefined'?lastRaceResults:[]);if(current?.length)decisionSignature=global.tkpLiveCouponFingerprint?.(current)||'';}catch(_){}
    const loaded=tkpR17LoadPredictionPayload(payload);
    try{if(!loaded.error&&inputUnchanged)global.tkpDeepSurpriseReconcileAfterScores?.(list,{decisionSignature});}catch(error){global.console?.warn?.('Deep Surprise takip eşleştirmesi tamamlanamadı',error);}
    return loaded;
  }
  function tkpR17ScheduleLiveScore(races,options={}){
    const list=Array.isArray(races)?races:[];
    if(!list.length) return {scheduled:false,reason:'Koşu yok'};
    const delay=Math.max(0,Number(options.delayMs)||0);
    global.setTimeout(()=>{
      Promise.resolve(tkpR17ScoreLiveRaces(list,options)).catch(error=>{
        try{global.console?.warn?.('[TKP R17] Canlı sidecar kullanılamadı; R16.94 devam ediyor.',error?.message||error);}catch(_){}
      });
    },delay);
    return {scheduled:true,rows:list.reduce((n,r)=>n+(Array.isArray(r?.horses)?r.horses.length:0),0)};
  }
  function tkpR17Status(){return {schema:state.schema,model_id:state.modelId,loaded:state.rows.size,loadedAt:state.loadedAt,active:tkpR17IsActive(),promotion_gate:state.promotionGate};}
  global.tkpR17LoadPredictionPayload=tkpR17LoadPredictionPayload;
  global.tkpR17IsActive=tkpR17IsActive;
  global.tkpR17PWinForHorse=tkpR17PWinForHorse;
  global.tkpR17CatBoostPWinForHorse=tkpR17CatBoostPWinForHorse;
  global.tkpDeepSurprisePForHorse=tkpDeepSurprisePForHorse;
  global.tkpDeepSurpriseOutsideTop5=tkpDeepSurpriseOutsideTop5;
  global.tkpR17CatBoostRescueOrderForRace=tkpR17CatBoostRescueOrderForRace;
  global.tkpR17CatBoostTop1ShadowForRace=tkpR17CatBoostTop1ShadowForRace;
  global.tkpR17OrderForRace=tkpR17OrderForRace;
  global.tkpR17AttachShadowProbabilities=tkpR17AttachShadowProbabilities;
  global.tkpR17Status=tkpR17Status;
  global.tkpR17ScoreLiveRaces=tkpR17ScoreLiveRaces;
  global.tkpR17ScheduleLiveScore=tkpR17ScheduleLiveScore;
})(globalThis);
