/**
 * tkp-indexes.js — V26 korumalı performans indeksleri
 *
 * Bu dosya mevcut çalışan algoritmayı değiştirmez. Sadece büyük veri setlerinde
 * tekrar tekrar yapılan db.files/db.races taramalarını tek imza altında önbellekler.
 * Hata olursa fonksiyonlar boş/fallback döner; ana sistem eski yoldan çalışmaya devam eder.
 */
(function(global){
  'use strict';

  const INDEX_VERSION = 'V26_INDEX_1';
  let cached = null;
  let cachedKey = '';
  let buildCount = 0;
  let lastBuildMs = 0;

  function arr(v){ return Array.isArray(v) ? v : []; }
  function currentDb(){ try { return (typeof db !== 'undefined' && db) ? db : global.db; } catch(_){ return global.db; } }
  function trustedGcTr(h){
    try{if(typeof global.tkpTrustedGcTrValue==='function'){const v=global.tkpTrustedGcTrValue(h);return v===null?'':v;}}catch(_){ }
    const sources=[h?.tr_ganyan_source,h?.tr_source].map(v=>String(v??'').trim().toUpperCase());
    if(!sources.includes('GANYAN_CANAVARI_TR'))return '';
    const v=Number(h?.tr_ganyan??h?.tr_puan);return Number.isFinite(v)?v:'';
  }
  function safeFold(v){
    try { return typeof fold === 'function' ? fold(v) : String(v||'').toLocaleLowerCase('tr-TR'); }
    catch(_){ return String(v||'').toLowerCase(); }
  }
  function horseHasResult(h){
    return Number(h?.winner)===1 || Number(h?.finish_position)===1 || Number(h?.finish_position)>0;
  }
  function raceHasAnyResult(r){ return arr(r?.horses).some(horseHasResult); }
  function raceHasWinner(r){ return arr(r?.horses).some(h=>Number(h?.winner)===1 || Number(h?.finish_position)===1); }
  function resultRaceCount(races){
    let n=0;
    for(const r of arr(races)) if(raceHasAnyResult(r)) n++;
    return n;
  }
  function makeKey(sourceDb){
    const files=arr(sourceDb?.files), races=arr(sourceDb?.races);
    if(typeof global.tkpFastDbSignature==='function'){
      try{ return INDEX_VERSION+'|'+global.tkpFastDbSignature(sourceDb); }catch(_){ }
    }
    // learningDatasetSignature detaylı ama pahalı olabilir. Önce hafif imza; sonuç/at
    // değişikliklerinde kaydetme olayı zaten tkp:db-changed ile cache'i temizler.
    return [INDEX_VERSION, files.length, races.length, arr(sourceDb?.bets).length, arr(sourceDb?.prediction_log).length, resultRaceCount(races)].join('|');
  }
  function meetingKeyForRace(r, file){
    return String(r?.file_id || r?.meeting_id || [r?.race_date||file?.race_date||'', safeFold(r?.hippodrome||file?.hippodrome||''), r?.sequence_no||file?.sequence_no||''].join('|'));
  }

  function buildIndexes(sourceDb){
    const start = (global.performance && performance.now) ? performance.now() : Date.now();
    const files=arr(sourceDb?.files), races=arr(sourceDb?.races), bets=arr(sourceDb?.bets);
    const filesById = new Map();
    const racesByFileId = new Map();
    const horsesByRaceId = new Map();
    const activeFileIds = new Set();
    const fileSeqById = new Map();
    const meetingMap = new Map();
    const resultMeetingMap = new Map();
    const filesByDateHip = new Map();
    const racesByDateHip = new Map();
    let maxSequenceNo = 0;
    const activeRaces = [];
    let horseCount = 0;
    let winnerCount = 0;
    let resultRaces = 0;

    for(const f of files){
      filesById.set(String(f.id), f);
      filesById.set(f.id, f);
      const seq=Number(f.sequence_no)||0;
      fileSeqById.set(String(f.id), seq);
      if(seq>maxSequenceNo) maxSequenceNo=seq;
      const dateHip=[String(f.race_date||''),safeFold(f.hippodrome||'')].join('|');
      if(!filesByDateHip.has(dateHip)) filesByDateHip.set(dateHip, []);
      filesByDateHip.get(dateHip).push(f);
      if(f.status === 'ACTIVE') activeFileIds.add(String(f.id));
    }

    for(const r of races){
      if(!r) continue;
      const fid = String(r.file_id);
      if(!racesByFileId.has(fid)) racesByFileId.set(fid, []);
      racesByFileId.get(fid).push(r);
      if(!racesByFileId.has(r.file_id)) racesByFileId.set(r.file_id, racesByFileId.get(fid));
      if(r.id!=null) horsesByRaceId.set(String(r.id), arr(r.horses));
      horseCount += arr(r.horses).length;
      if(raceHasWinner(r)) resultRaces++;
      for(const h of arr(r.horses)) if(Number(h?.winner)===1 || Number(h?.finish_position)===1) winnerCount++;
      if(r.active !== 0 && activeFileIds.has(fid)) activeRaces.push(r);
      const file = filesById.get(fid) || filesById.get(r.file_id) || null;
      const dateHip=[String(r.race_date||file?.race_date||''),safeFold(r.hippodrome||file?.hippodrome||'')].join('|');
      if(!racesByDateHip.has(dateHip)) racesByDateHip.set(dateHip, []);
      racesByDateHip.get(dateHip).push(r);
      const key = meetingKeyForRace(r, file);
      if(!meetingMap.has(key)) meetingMap.set(key, []);
      meetingMap.get(key).push(r);
      if(raceHasAnyResult(r)){
        if(!resultMeetingMap.has(key)) resultMeetingMap.set(key, []);
        // Tüm ayaklar aynı meeting grubunda lazım; aşağıda meetingMap üzerinden süzülecek.
      }
    }

    for(const rows of racesByFileId.values()) rows.sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0));
    activeRaces.sort((a,b)=>{
      const fa=fileSeqById.get(String(a.file_id)) || Number(a.sequence_no)||0;
      const fb=fileSeqById.get(String(b.file_id)) || Number(b.sequence_no)||0;
      return fa-fb || (Number(a.leg)||0)-(Number(b.leg)||0) || (Number(a.id)||0)-(Number(b.id)||0);
    });
    const meetingGroups = [...meetingMap.values()].map(rows=>rows.slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0)));
    const resultMeetingGroups = meetingGroups.filter(rows=>rows.length>=3 && rows.some(raceHasAnyResult));

    lastBuildMs = Math.round((((global.performance && performance.now) ? performance.now() : Date.now()) - start)*10)/10;
    buildCount++;
    return {
      version: INDEX_VERSION,
      filesById,
      racesByFileId,
      horsesByRaceId,
      activeFileIds,
      fileSeqById,
      activeRaces,
      meetingGroups,
      resultMeetingGroups,
      filesByDateHip,
      racesByDateHip,
      maxSequenceNo,
      summary:{ files:files.length, races:races.length, horses:horseCount, winners:winnerCount, resultRaces, bets:bets.length },
      builtAt:new Date().toISOString(),
      buildMs:lastBuildMs,
      buildCount
    };
  }

  function tkpInvalidateIndexes(){ cached = null; cachedKey = ''; tkpInvalidateMasterRows(); }
  function tkpGetIndexes(sourceDb){
    const d = sourceDb || currentDb();
    if(!d) return buildIndexes({files:[],races:[],bets:[]});
    const key = makeKey(d);
    if(cached && cachedKey === key) return cached;
    cached = buildIndexes(d);
    cachedKey = key;
    return cached;
  }
  function tkpRowsByFileId(fileId){
    try { return (tkpGetIndexes().racesByFileId.get(String(fileId)) || tkpGetIndexes().racesByFileId.get(fileId) || []).slice(); }
    catch(_){ return []; }
  }
  function tkpFileById(fileId){
    try { return tkpGetIndexes().filesById.get(String(fileId)) || tkpGetIndexes().filesById.get(fileId) || null; }
    catch(_){ return null; }
  }
  function tkpMeetingGroups(withResultsOnly){
    try { return (withResultsOnly ? tkpGetIndexes().resultMeetingGroups : tkpGetIndexes().meetingGroups).map(rows=>rows.slice()); }
    catch(_){ return []; }
  }
  // 10M KÖK FIX: Eski cache ilk aramada bütün at satırlarını üretiyordu. Tablo
  // yalnız birkaç yüz satır gösterecek olsa bile milyonlarca nesne/GC baskısı
  // oluşuyordu. Sınırlı çağrılar artık limit kadar satır üretir ve ayrı cache'te
  // tutulur; limitsiz çağrı yalnız açık bir tam dışa-aktarım yolunun tercihidir.
  let masterRowsCache = { key:'', rows:null, limited:new Map() };
  function tkpMasterRowsFast(maxRows){
    const d = currentDb();
    if(!d) return [];
    const ix = tkpGetIndexes(d);
    const key = cachedKey;
    if(masterRowsCache.key!==key)masterRowsCache={key,rows:null,limited:new Map()};
    const requested=Number(maxRows)>0?Math.floor(Number(maxRows)):0;
    if(requested>0&&masterRowsCache.limited.has(requested))return masterRowsCache.limited.get(requested).slice();
    if(requested<=0&&!masterRowsCache.rows){
      const out=[];
      for(const r of arr(d.races)){
        const f = ix.filesById.get(String(r.file_id)) || ix.filesById.get(r.file_id) || null;
        for(const h of arr(r.horses)){
          out.push(typeof global.tkpHistoricalHorseFeatureVector==='function'
            ? global.tkpHistoricalHorseFeatureVector(r,h,f)
            : {
              file:f?.filename||r.filename,status:f?.status||'',date:r.race_date,hippodrome:r.hippodrome,leg:r.leg,
              surface:r.surface,breed:r.breed,condition:r.condition_text,distance:r.distance,horse_no:h.horse_no,horse:h.horse_name,
              agf:h.agf,kg:h.weight_kg,best_time:h.best_time,g800:h.g800,hndkp:h.hndkp,s_value:h.s_value,tr:trustedGcTr(h),
              value:h.value_score,sp:h.sp,result_score:h.result_score,bmb:h.bmb,finish_position:h.finish_position,winner:h.winner
            });
        }
      }
      masterRowsCache.rows=out;
    }
    if(requested<=0)return masterRowsCache.rows;
    const out=[];
    outer:for(const r of arr(d.races)){
      const f = ix.filesById.get(String(r.file_id)) || ix.filesById.get(r.file_id) || null;
      for(const h of arr(r.horses)){
        out.push(typeof global.tkpHistoricalHorseFeatureVector==='function'
          ? global.tkpHistoricalHorseFeatureVector(r,h,f)
          : {file:f?.filename||r.filename,status:f?.status||'',date:r.race_date,hippodrome:r.hippodrome,leg:r.leg,surface:r.surface,breed:r.breed,condition:r.condition_text,distance:r.distance,horse_no:h.horse_no,horse:h.horse_name,agf:h.agf,kg:h.weight_kg,best_time:h.best_time,g800:h.g800,hndkp:h.hndkp,s_value:h.s_value,tr:trustedGcTr(h),value:h.value_score,sp:h.sp,result_score:h.result_score,bmb:h.bmb,finish_position:h.finish_position,winner:h.winner});
        if(out.length>=requested)break outer;
      }
    }
    masterRowsCache.limited.set(requested,out);
    return out.slice();
  }
  function tkpInvalidateMasterRows(){ masterRowsCache = { key:'', rows:null,limited:new Map() }; }

  function tkpDateHipKey(date,hip){ return [String(date||''),safeFold(hip||'')].join('|'); }
  function tkpFilesByDateHip(date,hip){
    try { return (tkpGetIndexes().filesByDateHip.get(tkpDateHipKey(date,hip)) || []).slice(); }
    catch(_){ return []; }
  }
  function tkpRacesByDateHip(date,hip){
    try { return (tkpGetIndexes().racesByDateHip.get(tkpDateHipKey(date,hip)) || []).slice(); }
    catch(_){ return []; }
  }
  function tkpMaxSequenceNo(){
    try { return Number(tkpGetIndexes().maxSequenceNo)||0; }
    catch(_){ return 0; }
  }

  global.tkpInvalidateIndexes = tkpInvalidateIndexes;
  global.tkpGetIndexes = tkpGetIndexes;
  global.tkpRowsByFileId = tkpRowsByFileId;
  global.tkpFileById = tkpFileById;
  global.tkpMeetingGroups = tkpMeetingGroups;
  global.tkpMasterRowsFast = tkpMasterRowsFast;
  global.tkpFilesByDateHip = tkpFilesByDateHip;
  global.tkpRacesByDateHip = tkpRacesByDateHip;
  global.tkpMaxSequenceNo = tkpMaxSequenceNo;
  global.addEventListener && global.addEventListener('tkp:db-changed', event=>{
    const detail=event?.detail||{};
    // Bahis/ayar/log kaydı files+races indeksini değiştirmez. Eski koşulsuz
    // listener sonraki ilk tablo açılışında 3.054 koşu / 33.594 atı yeniden
    // indeksliyordu. Yalnız gerçek yarış-verisi veya rollback bunu gerektirir.
    if(detail.learningChanged||detail.rollback)tkpInvalidateIndexes();
  });
})(window);
