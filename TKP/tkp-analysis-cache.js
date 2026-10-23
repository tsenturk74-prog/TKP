'use strict';
// Persistent diagnostic cache. Unchanged data has no age-based expiry.
// Content/model changes invalidate it. Coupon selection never uses this cache.
(function(global){
  const TKP_ANALYSIS_CACHE_SETTINGS_KEY='analysis_cache_v1';
  const TKP_ANALYSIS_CACHE_FINGERPRINT_VERSION='TOMMY_ANALYSIS_V3';
  const TKP_ANALYSIS_CACHE_DEFAULT_TTL_MS=Infinity;

  function store(db){
    if(!db || typeof db!=='object') return null;
    db.settings = db.settings && typeof db.settings==='object' ? db.settings : {};
    const s = db.settings[TKP_ANALYSIS_CACHE_SETTINGS_KEY];
    if(!s || typeof s!=='object' || !s.entries) db.settings[TKP_ANALYSIS_CACHE_SETTINGS_KEY]={entries:{}};
    return db.settings[TKP_ANALYSIS_CACHE_SETTINGS_KEY];
  }

  function contentSignature(values){
    let a=2166136261>>>0,b=5381;
    for(const value of values){
      const text=JSON.stringify(value??null);
      for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619)>>>0;b=(Math.imul(b,33)^text.charCodeAt(i))>>>0;}
    }
    return `${a.toString(36)}:${b.toString(36)}`;
  }
  function fingerprint(db){
    const state=db?.learning_state||{};
    // Import/result signatures persist across restarts. Legacy data uses content,
    // never just counts or a session counter that can reset to a different value.
    const data=state.dataset_signature&&state.outcome_signature
      ?[state.dataset_signature,state.outcome_signature,(db.files||[]).length,(db.races||[]).length].join(':')
      :contentSignature([db.files,db.races]);
    const predictions=typeof global.sideBetPredictionLogRevisionSignature==='function'
      ?global.sideBetPredictionLogRevisionSignature(db):contentSignature([db.prediction_log]);
    const auxiliary=typeof global.tkpAuxiliaryAnalysisSignature==='function'
      ?global.tkpAuxiliaryAnalysisSignature(db,['bets','forward_tracking_log']):contentSignature([db.bets,db.forward_tracking_log]);
    return [TKP_ANALYSIS_CACHE_FINGERPRINT_VERSION,data,predictions,auxiliary,
      global.TKP_SCORE_MODEL_VERSION||'',global.TKP_V55_ALGORITHM_VERSION||'',
      global.TKP_RESEARCH_ANALYTICS_VERSION||''].join('|');
  }

  function tkpAnalysisCacheRead(db, cacheKey, {ttlMs=TKP_ANALYSIS_CACHE_DEFAULT_TTL_MS}={}){
    try{
      const s=db?.settings?.[TKP_ANALYSIS_CACHE_SETTINGS_KEY]; if(!s?.entries) return null;
      const entry=s.entries[cacheKey];
      if(!entry || typeof entry!=='object') return null;
      if(entry.fingerprint!==fingerprint(db)) return null; // veri veya model değişti
      if(!(Number(entry.computedAt)>0) || (Date.now()-Number(entry.computedAt))>ttlMs) return null; // yok veya TTL doldu
      return entry.value;
    }catch(_e){ return null; }
  }

  function tkpAnalysisCacheWrite(db, cacheKey, value){
    try{
      const s=store(db); if(!s) return false;
      s.entries[cacheKey]={value, fingerprint:fingerprint(db), computedAt:Date.now()};
      return true;
    }catch(_e){ return false; }
  }

  function tkpAnalysisCacheInvalidate(db, cacheKey){
    try{
      const s=store(db); if(!s) return;
      if(cacheKey) delete s.entries[cacheKey]; else s.entries={};
    }catch(_e){}
  }

  global.tkpAnalysisCacheRead=tkpAnalysisCacheRead;
  global.tkpAnalysisCacheWrite=tkpAnalysisCacheWrite;
  global.tkpAnalysisCacheInvalidate=tkpAnalysisCacheInvalidate;
  global.TKP_ANALYSIS_CACHE_TTL_MS=TKP_ANALYSIS_CACHE_DEFAULT_TTL_MS;
})(typeof window!=='undefined'?window:globalThis);
