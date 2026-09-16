'use strict';
// =====================================================================================
// V1.1.324 KALICI ANALİZ ÖNBELLEĞİ (3 GÜNLÜK TTL)
// =====================================================================================
// KÖK MİMARİ FIX (kullanıcı talebi): "İleri Analiz" (research-analytics.js, Ayrıntılı
// Analiz sekmesi) yalnız oturum-içi bellek önbelleğine (_buildCache) sahipti -- sayfa
// yenilenince veya sistem kapanıp yeniden açılınca bu önbellek sıfırlanıyor, arşiv
// verisi hiç değişmemiş olsa bile TÜM analiz baştan hesaplanıyordu.
//
// Bu dosya, db içine (dolayısıyla normal yedek/IndexedDB akışıyla kalıcı) yazılan,
// veri parmak izi + model sürümü + 3 günlük TTL ile korunan genel amaçlı bir önbellek
// katmanı sağlar. tkp-adaptive-cache-persist.js'teki rolling-hash zincirleme yaklaşımı
// KADAR sağlam değildir (yalnız sayım + son yarış kimliği + model sürümü karşılaştırır,
// arşiv İÇİNDE bir yerde sessiz düzeltme olursa yakalamaz) -- ama "İleri Analiz" salt
// teşhis/izleme amaçlı olduğu, kupon/bahis kararını asla etkilemediği için bu daha basit
// ve ucuz doğrulama yeterlidir. Parmak izi DEĞİŞMEDİYSE ve son hesaplamadan 3 günden
// AZ geçtiyse depolanan sonuç aynen döndürülür; aksi halde (yeni veri VEYA 3 gün dolduysa
// VEYA skor modeli güncellendiyse) yeniden hesaplanır. "3 günde bir kendini güncellesin"
// isteği TTL ile karşılanır: veri hiç değişmese bile 3 günde bir zorunlu tazeleme olur.
//
// Kapsam: yalnız İleri Analiz/Ayrıntılı Analiz gibi ağır, teşhis amaçlı, kupon kararını
// etkilemeyen hesaplamalar için kullanılmalı. Kupon üretimi, TEK kararı, canlı skor gibi
// para etkileyen yollarda KULLANILMAMALIDIR -- onlar zaten kendi (daha katı) önbellek/
// invalidation mekanizmalarına sahip.
// =====================================================================================
(function(global){
  const TKP_ANALYSIS_CACHE_SETTINGS_KEY='analysis_cache_v1';
  const TKP_ANALYSIS_CACHE_FINGERPRINT_VERSION='V2_FORWARD_TRACKING';
  const TKP_ANALYSIS_CACHE_DEFAULT_TTL_MS=3*24*60*60*1000; // 3 gün

  function store(db){
    if(!db || typeof db!=='object') return null;
    db.settings = db.settings && typeof db.settings==='object' ? db.settings : {};
    const s = db.settings[TKP_ANALYSIS_CACHE_SETTINGS_KEY];
    if(!s || typeof s!=='object' || !s.entries) db.settings[TKP_ANALYSIS_CACHE_SETTINGS_KEY]={entries:{}};
    return db.settings[TKP_ANALYSIS_CACHE_SETTINGS_KEY];
  }

  function fingerprint(db){
    const races=Array.isArray(db?.races)?db.races:[];
    const files=Array.isArray(db?.files)?db.files:[];
    const preds=Array.isArray(db?.prediction_log)?db.prediction_log:[];
    const lastRace=races[races.length-1]||null;
    const lastFile=files[files.length-1]||null;
    const forward=Array.isArray(db?.forward_tracking_log)?db.forward_tracking_log:[];
    const lastForward=forward[forward.length-1]||null;
    const modelVersion=String(global.TKP_SCORE_MODEL_VERSION||global.TKP_V55_ALGORITHM_VERSION||'');
    let runtimeRevision='';try{runtimeRevision=typeof _tkpDbRevision==='number'?_tkpDbRevision:'';}catch(_e){}
    return [
      TKP_ANALYSIS_CACHE_FINGERPRINT_VERSION,
      files.length, races.length, preds.length,
      lastRace?.id ?? '', lastRace?.race_date ?? '',
      lastFile?.id ?? '', lastFile?.status ?? '',
      // İleri takipte sonuç alanları aynı satır üzerinde güncellenir; yalnız
      // collection sayısı kontrol edilirse eski teşhis yüzdeleri günlerce kalır.
      forward.length, lastForward?.race_key ?? '', lastForward?.evaluated_at ?? '', lastForward?.created_at ?? '',
      runtimeRevision,
      modelVersion
    ].join('|');
  }

  function tkpAnalysisCacheRead(db, cacheKey, {ttlMs=TKP_ANALYSIS_CACHE_DEFAULT_TTL_MS}={}){
    try{
      const s=store(db); if(!s) return null;
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
