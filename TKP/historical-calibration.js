(function(global){
'use strict';
const VERSION='V1.1.333-HISTORICAL-ALL509-SNAPSHOT-R16.49';
const LEARNING_MODULE_VERSION='V1.1.333-HISTORICAL-ALL509-SNAPSHOT-R16.49';
const CUTOFF_ISO='2026-08-26T15:00:00+03:00';
const MIN_SEED_FILES=503;
const SOURCE='HISTORICAL_CALIBRATION_FULL';
const ARCHIVE_LAYOUT_VERSION='R16.79-ARCHIVE-REPLAN-1';
const SIDEBET_SNAPSHOT_VERSION=VERSION+'-SIDEBET-ALL-AVAILABLE-V3';
const fnv=(text)=>{let h=2166136261>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h.toString(16).padStart(8,'0');};
const arr=v=>Array.isArray(v)?v:[];
const num=v=>Number(v)||0;
const fold=v=>String(v||'').toLocaleUpperCase('tr-TR').trim();
function fileDate(f){return String(f?.race_date||'').slice(0,10);}
function fileOrder(a,b){const da=fileDate(a),db=fileDate(b);if(da&&db&&da!==db)return da<db?-1:1;return (num(a?.raw_sequence_no)||num(a?.sequence_no)||999999)-(num(b?.raw_sequence_no)||num(b?.sequence_no)||999999)||num(a?.altili_no)-num(b?.altili_no)||TKP_TR_COLLATOR_NUM.compare(String(a?.id||''),String(b?.id||''));}
function eligibleFile(f){const d=fileDate(f);if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;if(d<'2026-08-26')return true;if(d>'2026-08-26')return false;const ts=String(f?.imported_at||f?.created_at||f?.collected_at||'');if(!ts)return false;const t=Date.parse(ts);return Number.isFinite(t)&&t<Date.parse(CUTOFF_ISO);}
function markHistoricalSet(source=global.db){
  if(!source||typeof source!=='object')return {ready:false,count:0};
  source.settings=source.settings&&typeof source.settings==='object'?source.settings:{};
  const ordered=arr(source.files).filter(eligibleFile).slice().sort(fileOrder);
  const selected=ordered,ids=new Set(selected.map(f=>String(f.id)));
  for(const f of arr(source.files)){
    const on=ids.has(String(f.id));
    if(on){f.historical_calibration_set=1;f.historical_calibration_version=VERSION;}
    else if(Number(f.historical_calibration_set)===1&&String(f.historical_calibration_version||'')===VERSION){delete f.historical_calibration_set;delete f.historical_calibration_version;}
  }
  for(const r of arr(source.races)){
    const on=ids.has(String(r.file_id));
    if(on){r.historical_calibration_set=1;r.historical_calibration_version=VERSION;}
    else if(Number(r.historical_calibration_set)===1&&String(r.historical_calibration_version||'')===VERSION){delete r.historical_calibration_set;delete r.historical_calibration_version;}
  }
  const ready=selected.length>=MIN_SEED_FILES;
  const orderedIds=selected.map(f=>String(f.id));
  const prev=source.settings.historical_calibration&&typeof source.settings.historical_calibration==='object'?source.settings.historical_calibration:{};
  const sameSelection=String(prev.version||'')===VERSION&&Array.isArray(prev.ordered_file_ids)&&prev.ordered_file_ids.length===orderedIds.length&&prev.ordered_file_ids.every((id,i)=>String(id)===orderedIds[i]);
  source.settings.historical_calibration={
    ...(sameSelection?prev:{}),version:VERSION,cutoff:CUTOFF_ISO,min_seed_files:MIN_SEED_FILES,file_count:selected.length,ready,
    policy:'ALL_SIX_LEG_ARCHIVE_SNAPSHOTS_RESULT_GATED_EVALUATION',ordered_file_ids:orderedIds,live_from:CUTOFF_ISO
  };
  if(!sameSelection){source.settings.historical_calibration.completed=false;source.settings.historical_calibration.cursor=0;delete source.settings.historical_calibration.data_hash;delete source.settings.historical_calibration.completed_at;}
  return {ready,count:selected.length,files:selected,ids};
}

function historicalLearningDatasetKey(source,marked){
  const currentModel=String(global.TKP_SCORE_MODEL_VERSION||global.TKP_V55_ALGORITHM_VERSION||'');
  let resultRaces=0,horseRows=0;
  const ids=marked?.ids||new Set();
  for(const r of arr(source?.races)){
    if(!ids.has(String(r?.file_id)))continue;
    if(arr(r?.horses).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0))resultRaces++;
    horseRows+=arr(r?.horses).length;
  }
  return [LEARNING_MODULE_VERSION,currentModel,marked?.count||0,resultRaces,horseRows,arr(source?.prediction_log).length].join('|');
}
function historicalLearningModulesComplete(source,marked){
  const state=source?.settings?.historical_learning_modules;
  if(!state||String(state.version||'')!==LEARNING_MODULE_VERSION||state.completed!==true)return false;
  return String(state.dataset_key||'')===historicalLearningDatasetKey(source,marked);
}
function historicalSnapshotCoverage(source,files){
  const ids=new Set(arr(files).map(f=>String(f?.id)));
  let races=0,total=0,locked=0;
  for(const race of arr(source?.races)){
    if(!ids.has(String(race?.file_id)))continue;
    const horses=arr(race?.horses).filter(h=>h&&!(typeof global.isNonRunner==='function'&&global.isNonRunner(h)));
    if(!horses.length)continue;
    races++;
    for(const horse of horses){
      total++;
      if(Number(horse.prediction_score_locked)===1&&Number.isFinite(Number(horse.prediction_score_snapshot))&&
        String(horse.prediction_score_model_version||'')===String(global.TKP_SCORE_MODEL_VERSION||'')) locked++;
    }
  }
  return {races,total,locked,missing:Math.max(0,total-locked),ratio:total?locked/total:1};
}
function historicalSixLegFiles(source,files){
  const racesByFile=new Map();
  for(const race of arr(source?.races)){
    const key=String(race?.file_id||'');let rows=racesByFile.get(key);
    if(!rows){rows=[];racesByFile.set(key,rows);}rows.push(race);
  }
  return arr(files).filter(file=>{
    const byLeg=new Map();
    for(const race of racesByFile.get(String(file?.id))||[]){
      const leg=num(race?.leg);if(leg<1||leg>6||byLeg.has(leg))continue;
      const hasHorses=arr(race?.horses).some(h=>h&&!(typeof global.isNonRunner==='function'&&global.isNonRunner(h)));
      if(hasHorses)byLeg.set(leg,race);
    }
    return [1,2,3,4,5,6].every(leg=>byLeg.has(leg));
  });
}
function historicalSnapshotHasAllCoupons(snapshot){
  if(!snapshot?.coupons||String(snapshot?.source)!==SOURCE||Number(snapshot?.historical_calibration)!==1||snapshot.archive_coupon_layout_version!==ARCHIVE_LAYOUT_VERSION)return false;
  return ['main','alt','surprise'].every(kind=>{
    const coupon=snapshot.coupons?.[kind];
    return coupon&&!coupon.error&&arr(coupon.legs).length===6&&arr(coupon.legs).every(leg=>num(leg?.leg)>=1&&arr(leg?.picks).length>0);
  });
}
function historicalCouponSnapshotCoverage(source,files){
  // Eski toplantı ekrandan çağrıldığında da kupon görülebilsin: yalnız 6/6 sonucu
  // tamamlanmış dosyalar değil, gerçek altı ayağı ve at satırları bulunan tüm arşiv.
  // Sonucu eksik olan snapshot değerlendirmede PENDING kalır; uydurma sonuç yazılmaz.
  const expected=historicalSixLegFiles(source,files);
  const snapshotIds=new Set(arr(source?.auto_coupon_log)
    .filter(historicalSnapshotHasAllCoupons)
    .map(snapshot=>String(snapshot?.id||'')));
  const covered=expected.filter(file=>snapshotIds.has(snapshotKey(file)));
  return {expected:expected.length,covered:covered.length,missing:Math.max(0,expected.length-covered.length),files:expected.filter(file=>!snapshotIds.has(snapshotKey(file)))};
}
function needsRebuild(source=global.db){
  if(!source||typeof source!=='object')return false;
  const marked=markHistoricalSet(source);
  if(!marked.ready)return false;
  const cal=source.settings?.historical_calibration;
  if(!cal||String(cal.version||'')!==VERSION||cal.completed!==true)return true;
  if(Number(cal.file_count||0)!==marked.count)return true;
  if(!historicalLearningModulesComplete(source,marked))return true;
  const currentModel=String(global.TKP_SCORE_MODEL_VERSION||global.TKP_V55_ALGORITHM_VERSION||'');
  if(!currentModel)return false;
  const coverage=historicalSnapshotCoverage(source,marked.files);
  if(coverage.total===0)return true;
  // Eski sürüm %80 kilidi yeterli sayıyordu. Bu, kalan %20'nin hiç snapshot
  // almadan arşivde 0 puan görünmesine yol açtı. Tarihsel setin tamamı için
  // güncel model snapshot'ı zorunludur; canlı gün verisi yine kapsam dışıdır.
  if(coverage.missing>0)return true;
  // Back Test, kupon seçimini bugünkü motordan yeniden üretmez. Altı gerçek ayağı
  // bulunan her tarihsel toplantı için üç kupon snapshotı da bulunmalıdır. Bu kontrol yalnız
  // eksik kaydı tespit eder; başlangıçta kendiliğinden ağır iş başlatmaz.
  return historicalCouponSnapshotCoverage(source,marked.files).missing>0;
}

const historicalFileIndexes=new WeakMap();
function historicalFileForRow(row,source){
  const files=arr(source.files);let index=historicalFileIndexes.get(files);
  const id=String(row.file_id);let hit=index?.byId.get(id);
  if(!index||!hit||index.length!==files.length||(hit&&(files[hit.index]!==hit.file||String(hit.file.id)!==id))){
    const byId=new Map();files.forEach((file,index)=>{const key=String(file.id);if(!byId.has(key))byId.set(key,{file,index});});
    index={length:files.length,byId};historicalFileIndexes.set(files,index);hit=byId.get(id);
  }
  return hit?.file;
}
function isHistoricalRow(row,source=global.db){
  if(!row||!source)return false;
  if(Number(row.historical_calibration_set)===1)return true;
  const file=historicalFileForRow(row,source);
  return Number(file?.historical_calibration_set)===1;
}
function pairAllowed(row,target,source=global.db){return isHistoricalRow(row,source)&&isHistoricalRow(target,source);}
function couponRows(c){return c?.error?{error:String(c.error)}:{cost:num(c?.cost),unit:num(c?.unit),legs:arr(c?.legs).map((leg,i)=>({leg:num(leg?.x?.r?.leg??leg?.r?.leg??leg?.race?.leg)||i+1,picks:arr(leg?.picks).map(h=>String(h?.horse_no??h)).filter(Boolean)}))};}
function rebuildHistoricalVisibleTkp(source,file,rowsOverride=null){
  let changed=0;
  const rows=Array.isArray(rowsOverride)?rowsOverride:arr(source.races).filter(x=>String(x.file_id)===String(file.id));
  for(const r of rows){
    for(const h of arr(r.horses)){
      if(!h)continue;
      let common=0;try{const ce=typeof global.tkpCommonEvidenceForHorse==='function'?global.tkpCommonEvidenceForHorse(r,h):null;common=Number(ce?.value)||0;}catch(_){common=0;}
      const legacy=Math.max(0,Number(h.tkp_legacy_score??h.pre_race_tkp_score??h.score)||0);
      let raw=common>0?common*10+legacy:Math.max(Number(h.tkp_display_raw_score)||0,legacy);
      if(!Number.isFinite(raw)||raw<0)raw=0;raw=Math.round(raw*100)/100;
      const shown=Math.round(Math.max(0,Math.min(10,raw/3))*100)/100;
      h.tkp_common_evidence=common;h.tkp_legacy_score=legacy;h.tkp_display_raw_score=raw;h.tkp_display_score=shown;h.tkp_display_scale_version='DIV3_MAX10_V1';
      h.prediction_tkp_display_raw_snapshot=raw;h.prediction_tkp_display_score_snapshot=shown;h.prediction_tkp_display_scale_snapshot='DIV3_MAX10_V1';changed++;
    }
  }
  return changed;
}
function meetingRaceResults(source,file,rowsOverride=null){
  const rows=(Array.isArray(rowsOverride)?rowsOverride:arr(source.races).filter(r=>String(r.file_id)===String(file.id))).slice().sort((a,b)=>num(a.leg)-num(b.leg));
  return rows.map(r=>{
    let scored=arr(r.horses).filter(h=>!(typeof global.isNonRunner==='function'&&global.isNonRunner(h))).slice();
    try{if(typeof global.strategicOrderForRace==='function')scored=global.strategicOrderForRace(r,scored);}catch(_){scored.sort((a,b)=>num(b.score)-num(a.score)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));}
    scored.forEach((h,i)=>{h._strategy_rank=i+1;if(!num(h.prediction_order_snapshot))h.prediction_order_snapshot=i+1;});
    return {r,scored,top:scored[0]||null,second:scored[1]||null,third:scored[2]||null,margin:scored.length>1?num(scored[0]?.score)-num(scored[1]?.score):0};
  });
}

// Arşiv kupon snapshotı için 30 bin atı yeniden modellemek gerekmez. Yedekteki
// kilitli tahmin sırası/puanı gerçek hesap çıktısıdır; önce onu kullan, yalnız
// kilidi olmayan satırda mevcut skor sıralamasına düş. Sonuç/winner sıralamaya
// kesinlikle katılmaz. Böylece REAL509 ilk hazırlığı da UI'yi kilitlemez.
function meetingRaceResultsFromLockedSnapshots(source,file,rowsOverride=null){
  const rows=(Array.isArray(rowsOverride)?rowsOverride:arr(source.races).filter(r=>String(r.file_id)===String(file.id))).slice().sort((a,b)=>num(a.leg)-num(b.leg));
  return rows.map(r=>{
    const scored=arr(r.horses).filter(h=>h&&!(typeof global.isNonRunner==='function'&&global.isNonRunner(h))).map(h=>({...h})).sort((a,b)=>{
      const ar=num(a?.prediction_order_snapshot)||num(a?.predicted_rank)||9999;
      const br=num(b?.prediction_order_snapshot)||num(b?.predicted_rank)||9999;
      return ar-br||num(b?.prediction_score_snapshot)-num(a?.prediction_score_snapshot)||num(b?.score)-num(a?.score)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||''));
    });
    scored.forEach((h,i)=>{h._strategy_rank=i+1;});
    return {r,scored,strictPool:scored,top:scored[0]||null,second:scored[1]||null,third:scored[2]||null,margin:num(scored[0]?.prediction_score_snapshot??scored[0]?.score)-num(scored[1]?.prediction_score_snapshot??scored[1]?.score)};
  });
}

async function meetingRaceResultsShared(source,file,rowsOverride=null,scoringContext=null){
  const rows=(Array.isArray(rowsOverride)?rowsOverride:arr(source.races).filter(r=>String(r.file_id)===String(file.id))).slice().sort((a,b)=>num(a.leg)-num(b.leg));
  const out=[];
  for(const r of rows){
    if(typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow({minIdleMs:1100,retryMs:100});
    let scored=[];
    if(typeof global.tkpScoreAndSealRace==='function'){
      const pack=await global.tkpScoreAndSealRace(r,{
        ...(scoringContext||{}),
        recompute:true,
        forceHistoricalLock:true
      });
      scored=arr(pack?.scored);
    }else{
      throw new Error('Paylaşılan TKP skor motoru hazır değil: tkpScoreAndSealRace');
    }
    scored.forEach((h,i)=>{h._strategy_rank=i+1;h.prediction_order_snapshot=i+1;});
    out.push({r,scored,top:scored[0]||null,second:scored[1]||null,third:scored[2]||null,margin:scored.length>1?num(scored[0]?.score)-num(scored[1]?.score):0});
    if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
  }
  return out;
}

async function resolveHistoricalPredictionLogBulk(source,files){
  const log=arr(source.prediction_log);if(!log.length)return 0;
  const fileIds=new Set(files.map(f=>String(f.id))),filesById=new Map(arr(source.files).map(f=>[String(f.id),f]));
  const exact=new Map(),undated=new Map();
  for(const rec of log){
    if(rec?.resolved===1)continue;
    const base=`${num(rec?.leg)}|${fold(rec?.hippodrome)}|${num(rec?.altili_no)||1}`;
    const date=String(rec?.race_date||'').slice(0,10),key=date?`${date}|${base}`:base,target=date?exact:undated;
    let rows=target.get(key);if(!rows){rows=[];target.set(key,rows);}rows.push(rec);
  }
  let changed=0,seen=0;
  for(const r of arr(source.races)){
    if(!fileIds.has(String(r?.file_id)))continue;
    const f=filesById.get(String(r.file_id))||{},alt=num(r.altili_no)||num(f.altili_no)||1,date=String(r.race_date||f.race_date||'').slice(0,10),base=`${num(r.leg)}|${fold(r.hippodrome||f.hippodrome)}|${alt}`;
    const candidates=[...(date?(exact.get(`${date}|${base}`)||[]):[]),...(undated.get(base)||[])];
    if(candidates.length){
      const byName=new Map(arr(r.horses).map(h=>[fold(h.horse_name),h]));
      for(const rec of candidates){if(rec.resolved===1)continue;const h=byName.get(fold(rec.horse_name));if(h){rec.resolved=1;rec.winner=h.winner===1?1:0;rec.finish_position=h.finish_position||null;rec.resolved_at=new Date().toISOString();changed++;}}
    }
    seen++;if((seen&127)===127){if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();else await new Promise(r=>setTimeout(r,0));}
  }
  if(changed){try{if(typeof global.invalidateAdaptiveLearningCache==='function')global.invalidateAdaptiveLearningCache();}catch(_){}try{if(typeof global.invalidateSideBetCache==='function')global.invalidateSideBetCache();}catch(_){}try{if(typeof global.tkpClearPerformanceCaches==='function')global.tkpClearPerformanceCaches();}catch(_){}}
  return changed;
}

function snapshotKey(file){return `HC-${String(file.sequence_no||'').padStart(3,'0')}-${fnv([file.race_date,fold(file.hippodrome),file.altili_no].join('|'))}`;}
function sameHistoricalHorse(a,b){
  const aa=String(a??'').trim(),bb=String(b??'').trim();
  if(!aa||!bb)return false;
  if(aa===bb)return true;
  try{if(typeof global.sameEkuri==='function'&&global.sameEkuri(aa,bb))return true;}catch(_){ }
  try{if(typeof global.ekuriBase==='function'&&String(global.ekuriBase(aa))===String(global.ekuriBase(bb)))return true;}catch(_){ }
  return false;
}
function evaluateHistoricalCouponRows(coupon,raceResults){
  if(!coupon||coupon.error||arr(coupon.legs).length!==6)return {known:0,full:0,hit_legs:0,known_legs:0,cost:num(coupon?.cost),return:null,roi:null};
  const races=new Map(arr(raceResults).map(x=>[num(x?.r?.leg),x?.r]));
  let known=0,hit=0,singles=0,singleHit=0;const legHits=[];
  for(const leg of arr(coupon.legs).slice().sort((a,b)=>num(a?.leg)-num(b?.leg))){
    const race=races.get(num(leg?.leg)),winner=arr(race?.horses).find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
    if(!winner){legHits.push(null);continue;}
    known++;
    const picks=arr(leg?.picks).map(String),ok=picks.some(no=>sameHistoricalHorse(no,winner.horse_no));
    legHits.push(ok);if(ok)hit++;
    if(picks.length===1){singles++;if(ok)singleHit++;}
  }
  let trailing=0;for(let i=legHits.length-1;i>=0;i--){if(legHits[i]===true)trailing++;else break;}
  const full=known===6&&hit===6?1:0,cost=num(coupon.cost);
  const lastRace=races.get(6)||races.get(Math.max(...races.keys()));
  const payout=arr(lastRace?.payouts).find(p=>String(p?.key||'')==='altili'&&!p?.rollover);
  const payoutKnown=payout?1:0,ret=payoutKnown?(full?num(payout.amount):0):null;
  const roi=ret===null||!(cost>0)?null:(ret-cost)/cost;
  return {known:known===6?1:0,full,hit_legs:hit,known_legs:known,trailing_hit:trailing,singles,single_hit:singleHit,cost,return:ret,payout_known:payoutKnown,roi};
}
async function persistHistoricalCoupon(source,file,raceResults,built,options={}){
  source.auto_coupon_log=arr(source.auto_coupon_log);
  const id=snapshotKey(file),coupons={main:couponRows(built?.main),alt:couponRows(built?.alt),surprise:couponRows(built?.surprise)};
  const createdAt=`${file.race_date||'2000-01-01'}T00:00:00.000Z`;
  const fullyResolved=arr(raceResults).length===6&&arr(raceResults).every(x=>arr(x?.r?.horses).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1));
  const evaluations={
    main:evaluateHistoricalCouponRows(coupons.main,raceResults),
    alt:evaluateHistoricalCouponRows(coupons.alt,raceResults),
    surprise:evaluateHistoricalCouponRows(coupons.surprise,raceResults)
  };
  const snap={schema_version:6,algorithm_version:ARCHIVE_LAYOUT_VERSION,id,key:[file.race_date,fold(file.hippodrome),num(file.altili_no)||1].join('|'),created_at:createdAt,source:SOURCE,source_label:'Geçmiş yeniden hesaplama',backtest_eligible:1,manual_adjustment:0,historical_calibration:1,archive_snapshot:1,pre_race_only:0,snapshot_time_verified:0,snapshot_locked_at:createdAt,resolution_state:fullyResolved?'RESOLVED_ARCHIVE':'PENDING',race_date:file.race_date||'',hippodrome:fold(file.hippodrome||''),altili_no:num(file.altili_no)||1,meeting_uid:file.meeting_uid||file.id,budgets:{main:built?.main?.budgetTL||1400,surprise:built?.alt?.budgetTL||1400,expert:built?.surprise?.budgetTL||1400},coupons,evaluations};
  const previous=source.auto_coupon_log.find(x=>String(x?.id)===id&&String(x?.source)===SOURCE);
  snap.archive_coupon_layout_version=ARCHIVE_LAYOUT_VERSION;
  snap.reconstructed_at=new Date().toISOString();
  snap.snapshot_time_verified=0;snap.pre_race_only=0;
  if(previous){snap.previous_archive_coupon=previous.previous_archive_coupon||{coupons:previous.coupons,evaluations:previous.evaluations,algorithm_version:previous.algorithm_version,created_at:previous.created_at};}
  source.auto_coupon_log=source.auto_coupon_log.filter(x=>String(x?.id)!==id&&!(String(x?.source)===SOURCE&&String(x?.meeting_uid)===String(snap.meeting_uid)));
  source.auto_coupon_log.push(snap);
  // KÖK FIX (donma): tkpForwardTrackingSync altı ayağı TEK senkron blokta işliyordu.
  // Her ayak için Strateji Lab/Bomba Avcısı/profil hesapları ağır olduğundan, 509
  // toplantılık ilk kurulumda tek dosyanın bu adımı 9-20+ sn ana iş parçacığını
  // tıkıyordu (donma tanısında "SNAPSHOT / KALICI KAYIT" olarak görüldü). Aynı
  // fonksiyon, aynı veri, aynı sıra — yalnız artık ayak başına çağrılıp aralarda
  // UI'ye nefes alma payı bırakılıyor. Toplu modda saveDB zaten ertelendiği için
  // (tkpForwardTrackingSync içindeki bulk guard'ı) sonuç ve sıralama değişmez.
  try{
    if(options.syncForward!==false&&typeof global.tkpForwardTrackingSync==='function'){
      for(const one of arr(raceResults)){
        try{global.tkpForwardTrackingSync([one]);}catch(_e){}
        if(typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow({minIdleMs:0,retryMs:60});
        if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
        else await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
  }catch(_){ }
  try{if(options.syncForward!==false&&typeof global.tkpForwardTrackingAttachCouponSnapshot==='function')global.tkpForwardTrackingAttachCouponSnapshot(snap);}catch(_){ }
  return snap;
}
function buildHistoricalArchiveCouponSet(raceResults,budget=1400){
  if(!global.TKP_ARCHIVE_COUPON_PLANNER)throw new Error('Arşiv kupon planlayıcısı yüklenmedi.');
  const built=global.TKP_ARCHIVE_COUPON_PLANNER.build(raceResults,Math.max(1000,Math.min(1400,budget)));
  const errors=['main','alt','surprise'].filter(k=>built[k]?.error||!built[k]?.legs?.length);
  if(errors.length)throw new Error(errors.map(k=>k+': '+(built[k]?.error||'kupon eksik')).join(' · '));
  return built;
}
function persistHistoricalSideBetSnapshots(snapshot,raceResults){
  if(!snapshot||!arr(raceResults).length||typeof global.tkpWeeklyModelTrackerAppendExactSideBetTickets!=='function')return 0;
  const specs=[];
  for(let i=0;i<raceResults.length;i++){
    const x=raceResults[i],next=raceResults[i+1]||null;
    const nos=arr(x?.scored).slice(0,5).map(h=>String(h?.horse_no||'')).filter(Boolean),nextNos=arr(next?.scored).slice(0,3).map(h=>String(h?.horse_no||'')).filter(Boolean);
    // Türkçe locale'de "sirali" -> "SİRALI" olur. Önceki ASCII regexp bu yüzden
    // sıralı ikili/üçlü/5'li ve çifteyi atlıyor, yalnız TABELA'yı kaydediyordu.
    const bets=arr(x?.r?.available_bets).map(v=>fold(v)
      .replace(/[İI]/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C')
      .replace(/[^A-Z0-9]+/g,'_')).join('|');
    const add=(product,pools,races,payoutKeys=[],unordered=false)=>{if(pools.every(pool=>pool.length)){let c=1;for(const pool of pools)c*=pool.length;specs.push({product,primary:true,pools,combinations:c,cost:c,unit:1,payout_keys:payoutKeys,unordered,races});}};
    if(/SIRALI_IKILI/.test(bets)&&nos.length>=2)add('sirali_ikili',[nos.slice(0,3),nos.slice(0,3)],[x.r],['sirali_ikili']);
    if(/SIRALI_UCLU|UCLU_BAHIS/.test(bets)&&nos.length>=3)add('sirali_uclu',[nos.slice(0,4),nos.slice(0,4),nos.slice(0,4)],[x.r],['sirali_uclu','uclu_bahis']);
    if(/TABELA/.test(bets)&&nos.length>=4)add('tabela',[nos.slice(0,5),nos.slice(0,5),nos.slice(0,5),nos.slice(0,5)],[x.r],['tabela_sirali','tabela_sirasiz'],true);
    if(/SIRALI_5LI/.test(bets)&&nos.length>=5)add('sirali_5li',[nos,nos,nos,nos,nos],[x.r],['sirali_5li']);
    if(next&&/CIFTE/.test(bets)&&nos.length&&nextNos.length)add('cifte',[nos.slice(0,3),nextNos.slice(0,3)],[x.r,next.r],['cifte']);
  }
  const added=global.tkpWeeklyModelTrackerAppendExactSideBetTickets(snapshot,specs);
  // Tek toplantılık manuel kullanımda hemen çöz; 509 toplu backfill sırasında ise
  // 8 bin bileti toplantı başına tekrar DB taramamak için döngü sonunda TEK seferde çöz.
  try{if(added&&global.__tkpBulkPipelineActive!==true&&typeof global.tkpWeeklyModelTrackerResolveExactSideBetTickets==='function')global.tkpWeeklyModelTrackerResolveExactSideBetTickets(raceResults);}catch(_){ }
  return added;
}

function historicalPortfolioTrainingSummary(source=global.db){
  const coupons={main:{label:'Normal',events:0,full:0,legHits:0,knownLegs:0,cost:0,financialCost:0,financialEvents:0,ret:0,singles:0,singleHit:0},
    alt:{label:'Sürpriz',events:0,full:0,legHits:0,knownLegs:0,cost:0,financialCost:0,financialEvents:0,ret:0,singles:0,singleHit:0},
    surprise:{label:'Uzman + Kulis',events:0,full:0,legHits:0,knownLegs:0,cost:0,financialCost:0,financialEvents:0,ret:0,singles:0,singleHit:0}};
  const snapshots=arr(source?.auto_coupon_log).filter(row=>String(row?.source||'')===SOURCE&&Number(row?.historical_calibration)===1&&row?.coupons);
  for(const snap of snapshots){
    for(const key of Object.keys(coupons)){
      const c=snap?.coupons?.[key],e=snap?.evaluations?.[key];
      if(!c||c.error||arr(c?.legs).length!==6)continue;
      const g=coupons[key];g.events++;
      if(e){g.full+=num(e.full);g.legHits+=num(e.hit_legs);g.knownLegs+=num(e.known_legs);g.cost+=num(e.cost);g.singles+=num(e.singles);g.singleHit+=num(e.single_hit);
        if(Number(e.payout_known)===1&&e.return!==null&&e.return!==undefined){g.financialEvents++;g.financialCost+=num(e.cost);g.ret+=num(e.return);}}
    }
  }
  for(const g of Object.values(coupons)){
    g.fullRate=g.events?g.full/g.events:0;g.legRate=g.knownLegs?g.legHits/g.knownLegs:0;g.singleRate=g.singles?g.singleHit/g.singles:0;
    g.roi=g.financialEvents&&g.cost?(g.ret-g.cost)/g.cost:null;
  }
  const sidebets={};const historicalTickets=arr(source?.sidebet_ticket_log).filter(row=>String(row?.source||'')===SOURCE&&Number(row?.primary)===1);
  for(const row of historicalTickets){
    const key=String(row?.product||'').replace('sirali5li','sirali_5li');if(!key)continue;
    const g=sidebets[key]||(sidebets[key]={events:0,resolved:0,hits:0,cost:0,financialEvents:0,ret:0});
    g.events++;
    if(Number(row?.evaluation?.known)===1){g.resolved++;g.hits+=num(row.evaluation.hit);
      if(Number(row.evaluation.payout_known)===1){g.financialEvents++;g.cost+=num(row.evaluation.cost??row.cost);g.ret+=num(row.evaluation.return);}}
  }
  for(const g of Object.values(sidebets)){g.hitRate=g.resolved?g.hits/g.resolved:0;g.roi=g.financialEvents&&g.cost?(g.ret-g.cost)/g.cost:null;}
  const out={version:VERSION,generated_at:new Date().toISOString(),snapshotMeetings:snapshots.length,coupons,sidebets,sidebetTickets:historicalTickets.length,
    policy:'FROZEN_ARCHIVE_SELECTIONS_PLUS_OFFICIAL_RESULT_EVALUATION_RESEARCH_PRIOR'};
  if(source){
    source.learning_state=source.learning_state&&typeof source.learning_state==='object'?source.learning_state:{};
    source.learning_state.historical_portfolio_training=out;
  }
  return out;
}

async function ensureHistoricalCouponSnapshots(options={}){
  if(running)return {running:true};
  const source=global.db;if(!source)return {error:'DB yok'};
  const marked=markHistoricalSet(source);
  // Öğrenme cutoff seti 503 olarak korunur; görünür arşiv kupon/snapshot kapsamı
  // ise yedekteki altı ayaklı toplantıların TAMAMIDIR (REAL509).
  const archiveFiles=arr(source.files);
  const coverage=historicalCouponSnapshotCoverage(source,archiveFiles);
  const sidebetState=source?.settings?.historical_sidebet_snapshot_backfill;
  const sidebetReady=String(sidebetState?.version||'')===SIDEBET_SNAPSHOT_VERSION&&sidebetState?.completed===true;
  if(!coverage.missing&&sidebetReady)return {...coverage,completed:true,created:0,sidebets:Number(sidebetState?.tickets)||0};
  running=true;global.__tkpHistoricalCalibrationRunning=true;
  const _prevBulk=global.__tkpBulkPipelineActive===true;global.__tkpBulkPipelineActive=true;
  const workFiles=sidebetReady?coverage.files:historicalSixLegFiles(source,archiveFiles);
  const job=typeof global.tkpStartJob==='function'?global.tkpStartJob('REAL509 archive coupon + sidebet snapshots',{budgetMs:4,total:workFiles.length,chunkSize:2}):null;
  const waitOptions={minIdleMs:2500,retryMs:140,maxWaitMs:0};
  let created=0,failed=0,sidebets=0;
  try{
    // Eski V1 tablosu Türkçe I/İ normalizasyon hatası nedeniyle yalnız TABELA
    // snapshotlarını içeriyordu. Yalnız bu tarihsel kaynağa ait satırlar yeniden
    // kurulur; canlı/manuel yan bahis kayıtlarına dokunulmaz.
    if(!sidebetReady)source.sidebet_ticket_log=arr(source.sidebet_ticket_log).filter(row=>String(row?.source||'')!==SOURCE);
    const racesByFile=new Map();
    for(const race of arr(source.races)){const key=String(race?.file_id||'');let rows=racesByFile.get(key);if(!rows){rows=[];racesByFile.set(key,rows);}rows.push(race);}
    for(let i=0;i<workFiles.length;i++){
      if(options.foreground!==true&&typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow(waitOptions);
      const file=workFiles[i],fileRaces=racesByFile.get(String(file.id))||[];
      try{
        const raceResults=meetingRaceResultsFromLockedSnapshots(source,file,fileRaces);
        let snapshot=arr(source.auto_coupon_log).find(row=>String(row.id)===snapshotKey(file)&&historicalSnapshotHasAllCoupons(row));
        if(!snapshot){
          const built=buildHistoricalArchiveCouponSet(raceResults,1400);
          snapshot=await persistHistoricalCoupon(source,file,raceResults,built,{syncForward:false});
          created++;
        }
        sidebets+=persistHistoricalSideBetSnapshots(snapshot,raceResults);
      }catch(error){failed++;console.warn('Historical coupon snapshot',file?.sequence_no,error);}
      // Kullanıcı tahmin/kupon başlatırsa bir sonraki arşiv dosyasına geçmeden bekle.
      if(options.foreground!==true&&typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow(waitOptions);
      if(job&&typeof global.tkpJobCheckpoint==='function')await global.tkpJobCheckpoint(job,i+1,workFiles.length,{force:true});
      else if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
      else await new Promise(resolve=>setTimeout(resolve,0));
    }
    // Bütün tarihsel yan bahis biletlerini bir kez resmi sonuçlarla çöz. Seçimler
    // frozen snapshotlardan, değerlendirme yalnız resmi bitiriş/payout kayıtlarından gelir.
    try{if(typeof global.tkpWeeklyModelTrackerResolveExactSideBetTickets==='function')global.tkpWeeklyModelTrackerResolveExactSideBetTickets(arr(source.races));}catch(error){console.warn('Historical sidebet bulk resolve',error);}
    const after=historicalCouponSnapshotCoverage(source,archiveFiles),now=new Date().toISOString();
    source.settings=source.settings&&typeof source.settings==='object'?source.settings:{};
    source.settings.historical_coupon_snapshot_backfill={version:VERSION,expected:after.expected,covered:after.covered,missing:after.missing,created,failed,completed:after.missing===0,completed_at:after.missing===0?now:null,updated_at:now};
    source.settings.historical_sidebet_snapshot_backfill={version:SIDEBET_SNAPSHOT_VERSION,tickets:arr(source.sidebet_ticket_log).filter(row=>String(row?.source||'')===SOURCE).length,created:sidebets,failed,completed:failed===0,completed_at:failed===0?now:null,updated_at:now};
    const portfolio=historicalPortfolioTrainingSummary(source);
    source.settings.historical_portfolio_training={version:VERSION,snapshotMeetings:portfolio.snapshotMeetings,sidebetTickets:portfolio.sidebetTickets,updated_at:now};
    source.settings.backtest_snapshot_revision=Math.max(0,num(source.settings.backtest_snapshot_revision))+1;
    try{if(typeof global.tkpInvalidateFastBacktestCache==='function')global.tkpInvalidateFastBacktestCache();}catch(_){ }
    // Sadece kupon düzeni değişti; yarış/özellik verisi değişmedi. Tam model
    // önbelleğini temizlemek sonraki tahmini gereksiz soğuk eğitime sokuyordu.
    try{
      if(typeof global.tkpPersistCollections==='function')await global.tkpPersistCollections(['auto_coupon_log','weekly_model_log','sidebet_ticket_log'],{metaPatch:{settings:source.settings,learning_state:source.learning_state},label:'historical-all509-snapshots'});
      else if(typeof global.saveDB==='function')await global.saveDB(false,true);
    }catch(_){ }
    try{global.dispatchEvent?.(new CustomEvent('tkp:db-changed',{detail:{backtestChanged:true,historicalSnapshotBackfill:true}}));}catch(_){ }
    if(job&&typeof global.tkpFinishJob==='function')global.tkpFinishJob(job);
    return {...after,created,failed,sidebets:source.settings.historical_sidebet_snapshot_backfill.tickets,completed:after.missing===0&&failed===0};
  }catch(error){if(job&&typeof global.tkpFinishJob==='function')global.tkpFinishJob(job,error);throw error;}
  finally{running=false;global.__tkpHistoricalCalibrationRunning=false;global.__tkpBulkPipelineActive=_prevBulk;}
}
async function dataSignatureAsync(source,files,job=null){
  let h=2166136261>>>0;
  const mix=text=>{const t=String(text);for(let i=0;i<t.length;i++){h^=t.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}};
  mix(VERSION);mix('|');mix(CUTOFF_ISO);mix('|');mix(files.length);
  const racesByFile=new Map();
  for(const r of arr(source.races)){const k=String(r.file_id);let rows=racesByFile.get(k);if(!rows){rows=[];racesByFile.set(k,rows);}rows.push(r);}
  for(let fi=0;fi<files.length;fi++){
    const f=files[fi];mix('~');mix(`${f.sequence_no}|${f.race_date}|${fold(f.hippodrome)}|${f.altili_no||1}`);
    const races=(racesByFile.get(String(f.id))||[]).slice().sort((a,b)=>num(a.leg)-num(b.leg));
    for(const r of races){mix('~');mix(`${r.leg}:`);for(const hrow of arr(r.horses)){mix(`${hrow.horse_no},${hrow.finish_position||0},${hrow.winner||0},${hrow.score||0},${hrow.agf||0};`);}}
    if(job&&typeof global.tkpJobCheckpoint==='function')await global.tkpJobCheckpoint(job,fi+1,files.length);
    else if((fi&7)===7&&typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
  }
  return (h>>>0).toString(16).padStart(8,'0');
}

async function runHistoricalLearningModules(source,files,job=null){
  const marked={count:files.length,ids:new Set(files.map(f=>String(f.id)))};
  const datasetKey=historicalLearningDatasetKey(source,marked);
  source.settings=source.settings&&typeof source.settings==='object'?source.settings:{};
  const prev=source.settings.historical_learning_modules&&typeof source.settings.historical_learning_modules==='object'?source.settings.historical_learning_modules:{};
  if(prev.completed===true&&String(prev.version||'')===LEARNING_MODULE_VERSION&&String(prev.dataset_key||'')===datasetKey)return prev;
  const rows=arr(source.races).filter(r=>marked.ids.has(String(r?.file_id)));
  const modules={};
  const step=async(name,fn)=>{
    if(typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow({minIdleMs:1000,retryMs:120});
    try{const value=await fn();modules[name]={ok:true,at:new Date().toISOString(),value:value===undefined?null:value};}
    catch(error){modules[name]={ok:false,at:new Date().toISOString(),error:String(error?.message||error)};throw error;}
    if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
  };
  await step('forward_tracking',async()=>typeof global.tkpForwardTrackingBackfillAll==='function'?global.tkpForwardTrackingBackfillAll():false);
  await step('surprise_bh_bmb_odb',async()=>typeof global.tkpSurpriseCohortBackfillHistoricalAsync==='function'?global.tkpSurpriseCohortBackfillHistoricalAsync(rows,{db:source,limit:10000}):{skipped:true});
  await step('x_kulis',async()=>typeof global.tkpLearnXKulisFromResults==='function'?global.tkpLearnXKulisFromResults():false);
  await step('champion_tommy_core_learning',async()=>typeof global.tkpEnsureLearningState==='function'?global.tkpEnsureLearningState():false);
  await step('adaptive_learning',async()=>typeof global.tkpRefreshLearningCache==='function'?global.tkpRefreshLearningCache(true):false);
  await step('best_rules',async()=>typeof global.buildRulesAsync==='function'?global.buildRulesAsync():null);
  await step('coupon_sidebet_snapshot_portfolio',async()=>historicalPortfolioTrainingSummary(source));
  await step('performance_cache',async()=>typeof global.tkpPrewarmPerformanceCaches==='function'?global.tkpPrewarmPerformanceCaches({force:true}):false);
  const failed=Object.entries(modules).filter(([,v])=>!v.ok).map(([k])=>k);
  const now=new Date().toISOString();
  const state={version:LEARNING_MODULE_VERSION,dataset_key:datasetKey,file_count:files.length,race_count:rows.length,modules,completed:failed.length===0,completed_at:failed.length===0?now:null};
  source.settings.historical_learning_modules=state;
  return state;
}

async function finalizeLearningSnapshot(source,files,job=null){
  const sig=await dataSignatureAsync(source,files,job),now=new Date().toISOString();
  source.learning_state=source.learning_state&&typeof source.learning_state==='object'?source.learning_state:{};
  const state=source.learning_state;
  state.historical_calibration_snapshot={version:VERSION,data_hash:sig,file_count:files.length,race_count:arr(source.races).filter(r=>isHistoricalRow(r,source)).length,coupon_snapshots:arr(source.auto_coupon_log).filter(x=>String(x?.source)===SOURCE).length,cutoff:CUTOFF_ISO,deterministic:true,portable:true,completed_at:now};
  state.dataset_signature=`HC275:${sig}:${arr(source.races).length}:${arr(source.prediction_log).length}`;
  state.status='GÜNCELLENDİ';state.updated_at=now;
  source.settings.historical_calibration.completed=true;source.settings.historical_calibration.completed_at=now;source.settings.historical_calibration.data_hash=sig;source.settings.historical_calibration.cursor=files.length;
  source.settings.strict_no_result_leakage_from='2026-08-26';source.settings.strict_no_result_leakage_from_iso=CUTOFF_ISO;
  source.changelog=arr(source.changelog);source.changelog.push({ts:now,type:'HISTORICAL_CALIBRATION',message:`Tarihsel cutoff seti tam kalibrasyon/backfill tamamlandı. Hash ${sig}. 26.08.2026 15:00 sonrası canlı sızıntı koruması aktiftir.`});
  try{if(typeof global.invalidateActiveRacesCache==='function')global.invalidateActiveRacesCache();}catch(_){ }
  try{if(typeof global.invalidateAdaptiveLearningCache==='function')global.invalidateAdaptiveLearningCache();}catch(_){ }
  try{if(typeof global.tkpInvalidateLearningModelCaches==='function')global.tkpInvalidateLearningModelCaches();}catch(_){ }
  if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
  try{if(typeof global.tkpEnsureLearningState==='function')global.tkpEnsureLearningState();}catch(_){ }
  if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
  try{if(typeof global.tkpRefreshLearningCache==='function')global.tkpRefreshLearningCache(true);}catch(_){ }
  return state.historical_calibration_snapshot;
}
let running=false;
async function rebuild(options={}){
  if(running)return {running:true};
  const rebuildTimingStart=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const source=global.db;if(!source)return {error:'DB yok'};
  const marked=markHistoricalSet(source);if(!marked.ready)return {ready:false,count:marked.count,need:MIN_SEED_FILES};
  if(source.settings?.historical_calibration?.completed&&!options.force){
    const couponCoverage=historicalCouponSnapshotCoverage(source,marked.files);
    if(couponCoverage.missing>0)return ensureHistoricalCouponSnapshots(options);
    if(!needsRebuild(source))return source.learning_state?.historical_calibration_snapshot||{completed:true};
  }
  running=true;global.__tkpHistoricalCalibrationRunning=true;const _prevBulk=global.__tkpBulkPipelineActive===true;global.__tkpBulkPipelineActive=true;
  const job=typeof global.tkpStartJob==='function'?global.tkpStartJob('Historical calibration',{budgetMs:4,total:marked.count}):null;
  try{
    // Restore worker kronolojiyi önceden kurar. Yalnız lock geçersizse chunked fallback.
    try{
      if(typeof global.tkpChronologyLockIsValid==='function'&&!global.tkpChronologyLockIsValid(source)){
        if(typeof global.tkpResequenceFilesChronologicallyAsync==='function')await global.tkpResequenceFilesChronologicallyAsync(source,{reason:'historical-calibration',markDirty:true,logChange:false});
        else if(typeof global.tkpResequenceFilesChronologically==='function')global.tkpResequenceFilesChronologically(source,{full:true,reason:'restore',markDirty:true,logChange:false});
      }
    }catch(error){console.warn('Historical chronology',error);}
    const again=markHistoricalSet(source),files=again.files;
    const racesByFile=new Map();for(const r of arr(source.races)){const k=String(r.file_id);let rows=racesByFile.get(k);if(!rows){rows=[];racesByFile.set(k,rows);}rows.push(r);}
    try{await resolveHistoricalPredictionLogBulk(source,files);}catch(error){console.warn('Historical prediction-log bulk resolve',error);}
    if(typeof global.tkpPrepareSharedScoringContext!=='function')throw new Error('Paylaşılan TKP skor bağlamı hazır değil');
    const scoringContext=await global.tkpPrepareSharedScoringContext({archivedFastOpen:false,historical:true});
    let cursor=Math.max(0,Math.min(files.length,num(source.settings.historical_calibration.cursor)));
    const coverageBefore=historicalSnapshotCoverage(source,files);
    // Tamamlanmış görünen eski kalibrasyonda eksik/yanlış model snapshot'ı varsa
    // cursor sonunu kullanma; bütün tarihsel dosyaları arşiv kaynaklarından
    // yeniden puanlayıp eksiksiz kilitle.
    if(coverageBefore.missing>0)cursor=0;
    for(let i=cursor;i<files.length;i++){
      // V1.1.291: canlı ekran / collector / kullanıcı etkileşimi her zaman önceliklidir.
      // Historical iş RAM'de kaldığı cursor'dan devam eder; canlı baskı varken CPU kullanmaz.
      if(typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow({minIdleMs:1200,retryMs:120});
      const file=files[i],fileRaces=racesByFile.get(String(file.id))||[];
      const raceResults=await meetingRaceResultsShared(source,file,fileRaces,scoringContext);
      if(raceResults.length){
        try{if(typeof global.savePredictionSnapshot==='function')global.savePredictionSnapshot({file},raceResults);}catch(_){ }
        let built=null;
        try{
          if(typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow({minIdleMs:900,retryMs:100});
          const unifiedBudget=typeof global.tkpCouponBudgetFor==='function'?global.tkpCouponBudgetFor(1200,'main'):1200;
          built=typeof global.tkpBuildCouponSetAdaptiveAsync==='function'?await global.tkpBuildCouponSetAdaptiveAsync(raceResults,{main:unifiedBudget,main2:unifiedBudget,surprise:unifiedBudget,normalMode:'standard'}):typeof global.buildCouponSetFastAsync==='function'?await global.buildCouponSetFastAsync(raceResults,{main:unifiedBudget,main2:unifiedBudget,surprise:unifiedBudget,normalMode:'standard'}):null;
        }catch(error){console.warn('Historical coupon build',file.sequence_no,error);}
        if(built){
          const couponSnapshot=await persistHistoricalCoupon(source,file,raceResults,built);
          persistHistoricalSideBetSnapshots(couponSnapshot,raceResults);
        }
      }
      source.settings.historical_calibration.cursor=i+1;
      // ÖNEMLİ: Eski sürüm her 4 dosyada tüm DB'yi persist ediyordu. 503 dosyada
      // yaklaşık 126 ağır yazım gerçek UI kilitlenmesinin ana sebeplerinden biriydi.
      // Artık her dosyada yalnız cooperative checkpoint, yalnız sonda TEK persist.
      if(job&&typeof global.tkpJobCheckpoint==='function')await global.tkpJobCheckpoint(job,i+1,files.length);
      else if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
      else if(typeof global.tkpYield==='function')await global.tkpYield();
      else await new Promise(r=>setTimeout(r,0));
    }
    const learningModules=await runHistoricalLearningModules(source,files,job);
    if(!learningModules?.completed)throw new Error('Tarihsel öğrenme modülleri tamamlanamadı');
    const snapshot=await finalizeLearningSnapshot(source,files,job);
    snapshot.learning_modules=learningModules;
    try{if(typeof global.setRulesDirty==='function')global.setRulesDirty(false);}catch(_){ }
    try{
      if(typeof global.tkpPersistCollections==='function')await global.tkpPersistCollections(['races','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','sidebet_ticket_log','changelog'],{metaPatch:{settings:source.settings,learning_state:source.learning_state},label:'historical-calibration-final'});
      else if(typeof global.saveDB==='function')await global.saveDB(false,true);
    }catch(_){ }
    if(job&&typeof global.tkpFinishJob==='function')global.tkpFinishJob(job);
    // V1.1.326 TANI: bu fonksiyon (tam tarihsel kalibrasyon) hiç ölçülmüyordu --
    // "açılışta 1-2 dk kasıyor" şikayeti aslında bu arkaplan görevi olabilir (idle
    // task olarak kuyruklanır, ana thread'i teknik olarak kilitlemez ama sürekli CPU
    // kullanır ve düşük donanımda hissedilir yavaşlığa yol açabilir). Artık Sistem
    // sekmesinde görünür.
    if(typeof global.tkpRecordPerformance==='function')global.tkpRecordPerformance('historical-calibration:rebuild ('+files.length+' dosya, cursor '+cursor+'\u2192'+files.length+')',rebuildTimingStart);
    return snapshot;
  }catch(error){if(job&&typeof global.tkpFinishJob==='function')global.tkpFinishJob(job,error);throw error;}
  finally{running=false;global.__tkpHistoricalCalibrationRunning=false;global.__tkpBulkPipelineActive=_prevBulk;}
}
let scheduled=false;
function schedule(){
  const source=global.db;if(!source||scheduled)return false;markHistoricalSet(source);
  const couponCoverage=historicalCouponSnapshotCoverage(source,arr(source.files));
  source.settings=source.settings||{};
  source.settings.historical_snapshot_missing=Number(couponCoverage?.missing)||0;
  const side=source.settings?.historical_sidebet_snapshot_backfill;
  const sideReady=String(side?.version||'')===SIDEBET_SNAPSHOT_VERSION&&side?.completed===true;
  if(!couponCoverage?.missing&&sideReady){
    historicalPortfolioTrainingSummary(source);
    return false;
  }
  // R16.49: kullanıcı tüm eski 3 Altılı + tüm yan bahis snapshotlarını otomatik istedi.
  // Ağır iş UI'dan tamamen ayrıdır: yalnız kullanıcı 2.5 sn boştaysa başlar, her dosya
  // arasında yield/safe-window bekler ve tek final persist yapar. Düğme gerekmez.
  scheduled=true;
  const run=()=>ensureHistoricalCouponSnapshots({foreground:false}).catch(error=>console.warn('REAL509 snapshot arka plan tamamlama',error)).finally(()=>{scheduled=false;});
  // Eenmalige reparatie: start na een korte rustige periode zodat de bestaande
  // historische tabellen daadwerkelijk worden gevuld zonder op een verborgen
  // onderhoudsactie te wachten.
  if(typeof global.tkpQueueTask==='function')global.tkpQueueTask('historical-portfolio-snapshot-backfill',run,{priority:'background',replace:false,minIdleMs:15000});
  else if(typeof global.tkpRunWhenUserIdle==='function')global.tkpRunWhenUserIdle(run,{minIdleMs:15000,retryMs:500,maxWaitMs:0});
  else setTimeout(run,15000);
  return true;
}
global.tkpBuildHistoricalArchiveCouponSet=buildHistoricalArchiveCouponSet;
global.tkpHistoricalArchiveResultsForFile=meetingRaceResultsFromLockedSnapshots;
global.tkpPersistHistoricalArchiveCoupon=persistHistoricalCoupon;
global.TKP_HISTORICAL_CALIBRATION_VERSION=VERSION;
global.TKP_HISTORICAL_CALIBRATION_CUTOFF=CUTOFF_ISO;
global.tkpMarkHistoricalCalibrationSet=markHistoricalSet;
global.tkpHistoricalCalibrationNeedsRebuild=needsRebuild;
global.tkpHistoricalCouponSnapshotCoverage=historicalCouponSnapshotCoverage;
global.tkpHistoricalPortfolioTrainingSummary=historicalPortfolioTrainingSummary;
global.tkpEnsureHistoricalCouponSnapshots=ensureHistoricalCouponSnapshots;
global.tkpHistoricalLearningModulesComplete=historicalLearningModulesComplete;
global.tkpRunHistoricalLearningModules=runHistoricalLearningModules;
global.tkpHistoricalCalibrationRace=isHistoricalRow;
global.tkpHistoricalCalibrationPairAllowed=pairAllowed;
global.tkpRebuildHistoricalCalibration503=rebuild;
global.tkpScheduleHistoricalCalibration503=schedule;
})(globalThis);
