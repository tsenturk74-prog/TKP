'use strict';
/* R18.2 promoted analytics bridge. Champion order remains untouched unless the family gate explicitly passes. */
(function(global){
  const state={schema:null,promotionGate:null,rows:new Map(),coupons:{},loadedAt:null};
  const no=h=>String(h?.horse_no??h?.horseNo??'').trim();
  const raceKey=r=>{ const uid=String(r?.race_uid||'').trim(); if(uid) return uid; const meeting=String(r?.meeting_uid||'').trim(); if(meeting) return `${meeting}|${r?.leg||''}|${r?.id||''}`; return `${r?.race_date||''}|${r?.hippodrome||''}|${r?.file_id||''}|${r?.leg||''}|${r?.id||''}`; };
  const key=(r,h)=>`${raceKey(r)}|${no(h)}`;
  function familyGate(family){ const g=state.promotionGate||{}; return (g[String(family||'normal')]||{}); }
  function tkpR18FamilyActive(family='normal'){
    const g=familyGate(family);
    return g.production_pass===true && (state.promotionGate?.production_pass===true || state.promotionGate?.production_pass==null);
  }
  function tkpR18LoadAnalyticsPayload(payload){
    if(!payload||payload.schema!=='TKP_R18_ANALYTICS_V1'||!Array.isArray(payload.rows)) return {loaded:0,error:'Geçersiz R18 analytics payload'};
    state.schema=payload.schema; state.promotionGate=payload.promotion_gate||null; state.coupons=payload.coupons||{}; state.rows.clear();
    let loaded=0;
    for(const row of payload.rows){
      const rk=String(row?.race_key||'').trim(),hn=String(row?.horse_no??'').trim(),p=Number(row?.win_probability);
      if(!rk||!hn||!Number.isFinite(p)||p<0||p>1) continue;
      state.rows.set(`${rk}|${hn}`,{...row,win_probability:p}); loaded++;
    }
    state.loadedAt=new Date().toISOString();
    try{ if(global.db?.settings) global.db.settings.r18_analytics={schema:state.schema,loaded_at:state.loadedAt,promotion_gate:state.promotionGate,loaded_rows:loaded}; }catch(_){ }
    return {loaded,active:{normal:tkpR18FamilyActive('normal'),surprise:tkpR18FamilyActive('surprise'),expert:tkpR18FamilyActive('expert')},promotion_gate:state.promotionGate};
  }
  function tkpR18RowForHorse(race,horse){ return state.rows.get(key(race,horse))||null; }
  function tkpR18AttachShadowAnalytics(race,horses){
    for(const h of Array.from(horses||race?.horses||[])){
      const row=tkpR18RowForHorse(race,h); if(!row) continue;
      h.r18_win_probability=Number(row.win_probability);
      h.r18_mc_win_rate=Number(row.mc_win_rate);
      h.r18_value_score=Number(row.value_score);
      h.r18_uncertainty=Number(row.uncertainty);
    }
    return horses||race?.horses||[];
  }
  function tkpR18OrderForRace(race,horses,family='normal'){
    const rows=Array.from(horses||race?.horses||[]);
    if(!tkpR18FamilyActive(family)) return rows.slice();
    return rows.slice().sort((a,b)=>{
      const ar=tkpR18RowForHorse(race,a),br=tkpR18RowForHorse(race,b),ap=Number(ar?.win_probability),bp=Number(br?.win_probability);
      const av=Number.isFinite(ap),bv=Number.isFinite(bp); if(av!==bv) return av?-1:1; if(av&&Math.abs(ap-bp)>1e-12) return bp-ap;
      return (Number(b?.score)||0)-(Number(a?.score)||0)||no(a).localeCompare(no(b),'tr',{numeric:true});
    });
  }
  function tkpR18CouponAdvice(family='normal'){ const c=state.coupons?.[family]; return tkpR18FamilyActive(family)&&c?c:null; }
  async function tkpR18ScoreLiveRaces(races,options={}){
    const list=Array.isArray(races)?races:[]; if(!list.length) return {loaded:0,skipped:true,reason:'Koşu yok'};
    const endpoint=String(options.endpoint||'http://127.0.0.1:3764/predict'); const budget=Math.min(1500,Math.max(1,Number(options.budget)||1500));
    const response=await global.fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema:'TKP_R18_LIVE_RACES_V1',races:list,budget})});
    if(!response||!response.ok) throw new Error(`R18 sidecar HTTP ${response?.status||'ERR'}`);
    return tkpR18LoadAnalyticsPayload(await response.json());
  }
  function tkpR18ScheduleLiveScore(races,options={}){
    const list=Array.isArray(races)?races:[]; if(!list.length) return {scheduled:false,reason:'Koşu yok'};
    global.setTimeout(()=>Promise.resolve(tkpR18ScoreLiveRaces(list,options)).catch(error=>{try{global.console?.warn?.('[TKP R18] Shadow sidecar kullanılamadı; Champion devam ediyor.',error?.message||error);}catch(_){}}),Math.max(0,Number(options.delayMs)||0));
    return {scheduled:true,rows:list.reduce((n,r)=>n+(Array.isArray(r?.horses)?r.horses.length:0),0)};
  }
  function tkpR18Status(){return {schema:state.schema,loaded:state.rows.size,loadedAt:state.loadedAt,promotion_gate:state.promotionGate,active:{normal:tkpR18FamilyActive('normal'),surprise:tkpR18FamilyActive('surprise'),expert:tkpR18FamilyActive('expert')}};}
  Object.assign(global,{tkpR18LoadAnalyticsPayload,tkpR18FamilyActive,tkpR18RowForHorse,tkpR18AttachShadowAnalytics,tkpR18OrderForRace,tkpR18CouponAdvice,tkpR18ScoreLiveRaces,tkpR18ScheduleLiveScore,tkpR18Status});
})(globalThis);
