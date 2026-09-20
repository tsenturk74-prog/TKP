'use strict';
/* TKP R17 AutoGluon bridge. Prediction payload is shadow-only unless promotion_gate.pass=true. */
(function(global){
  const state={schema:null,promotionGate:null,rows:new Map(),loadedAt:null};
  const no=h=>String(h?.horse_no??h?.horseNo??'').trim();
  const raceKey=r=>String(r?.race_uid||r?.meeting_uid||`${r?.race_date||''}|${r?.hippodrome||''}|${r?.file_id||''}|${r?.leg||''}|${r?.id||''}`);
  const key=(r,h)=>`${raceKey(r)}|${no(h)}`;
  function tkpR17LoadPredictionPayload(payload){
    if(!payload||payload.schema!=='TKP_R17_PWIN_V1'||!Array.isArray(payload.rows)){
      return {loaded:0,error:'Geçersiz R17 prediction payload'};
    }
    state.schema=payload.schema; state.promotionGate=payload.promotion_gate||null; state.rows.clear();
    let loaded=0;
    for(const row of payload.rows){
      const rk=String(row?.race_key||'').trim(), hn=String(row?.horse_no??'').trim(), p=Number(row?.p_win);
      if(!rk||!hn||!Number.isFinite(p)||p<0||p>1) continue;
      state.rows.set(`${rk}|${hn}`,{...row,p_win:p}); loaded++;
    }
    state.loadedAt=new Date().toISOString();
    try{
      if(global.db?.settings){
        global.db.settings.r17_autogluon={schema:state.schema,loaded_at:state.loadedAt,promotion_gate:state.promotionGate,loaded_rows:loaded};
      }
    }catch(_){ }
    return {loaded,active:tkpR17IsActive(),promotion_gate:state.promotionGate};
  }
  function tkpR17IsActive(){
    const gate=state.promotionGate||{};
    if(typeof gate.production_pass==='boolean') return gate.production_pass===true;
    return gate.pass===true;
  }
  function tkpR17PWinForHorse(race,horse){
    const row=state.rows.get(key(race,horse)); return row?Number(row.p_win):null;
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
    }
    return horses||race?.horses||[];
  }
  async function tkpR17ScoreLiveRaces(races,options={}){
    const list=Array.isArray(races)?races:[];
    if(!list.length) return {loaded:0,skipped:true,reason:'Koşu yok'};
    const endpoint=String(options.endpoint||'http://127.0.0.1:3763/predict');
    const response=await global.fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({schema:'TKP_R17_LIVE_RACES_V1',races:list})
    });
    if(!response||!response.ok) throw new Error(`R17 sidecar HTTP ${response?.status||'ERR'}`);
    const payload=await response.json();
    return tkpR17LoadPredictionPayload(payload);
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
  function tkpR17Status(){return {schema:state.schema,loaded:state.rows.size,loadedAt:state.loadedAt,active:tkpR17IsActive(),promotion_gate:state.promotionGate};}
  global.tkpR17LoadPredictionPayload=tkpR17LoadPredictionPayload;
  global.tkpR17IsActive=tkpR17IsActive;
  global.tkpR17PWinForHorse=tkpR17PWinForHorse;
  global.tkpR17OrderForRace=tkpR17OrderForRace;
  global.tkpR17AttachShadowProbabilities=tkpR17AttachShadowProbabilities;
  global.tkpR17Status=tkpR17Status;
  global.tkpR17ScoreLiveRaces=tkpR17ScoreLiveRaces;
  global.tkpR17ScheduleLiveScore=tkpR17ScheduleLiveScore;
})(globalThis);
