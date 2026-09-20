// Uygulamanın tüm paylaşılan/mutable durumu, yapılandırma sabitleri ve
// önbellek (cache) haritaları. Diğer modüller state'i BURADAN import eder;
// doğrudan dışarıdan atama (reassignment) yerine setter fonksiyonları kullanılır.


const PLASE7_UNIT_PRICE = 2.00;

const PREDICTION_COVERAGE_TARGET = 0.70;

let _profileMatchCache = new Map();
let _profileCandidatesCache = new WeakMap();
let _profileCandidatesIndexCache = {revision:-1,rows:null,index:null};

function invalidateProfileMatchCache(){
  _profileMatchCache.clear();
  _profileCandidatesCache = new WeakMap();
  _profileCandidatesIndexCache = {revision:-1,rows:null,index:null};
  try{ if(typeof _detailedRankStatsCache!=='undefined') _detailedRankStatsCache.clear(); }catch(_e){}
  try{ if(typeof _detailedBmbStatsCache!=='undefined') _detailedBmbStatsCache.clear(); }catch(_e){}
}

let _statsByConditionCache = new Map();

let _bmbWinRateByConditionCache = null;
let _matchedResultRankStatsCache = new Map();
let _learningEligibleRacesCache = {db:null,races:null,files:null,raceCount:-1,fileCount:-1,revision:-1,value:null};
// Backtest cutoffs are immutable per replay meeting. Cache the filtered
// historical pool by cutoff so each profile does not rescan the full archive.
const _learningEligibleRacesBacktestCache = new Map();
function invalidateLearningEligibleRacesCache(){ _learningEligibleRacesCache={db:null,races:null,files:null,raceCount:-1,fileCount:-1,revision:-1,value:null}; }

function tkpClearHorseHistoryBestCache(){if(globalThis.__tkpHorseHistoryBestCache)globalThis.__tkpHorseHistoryBestCache.clear();globalThis.__tkpSimilarFieldHistoryIndex=null;}
function invalidateConditionStatsCache(){ _statsByConditionCache.clear(); _matchedResultRankStatsCache.clear(); _bmbWinRateByConditionCache = null; tkpClearHorseHistoryBestCache(); if(globalThis.__tkpSimilarFieldPoolCache) globalThis.__tkpSimilarFieldPoolCache.clear(); if(globalThis.__tkpSimilarFieldSpeedsCache) globalThis.__tkpSimilarFieldSpeedsCache.clear(); }

let _winnerProfileCache = new Map();

function invalidateWinnerProfileCache(){ _winnerProfileCache.clear(); }

const COUPON_CARD_TITLES={main:'💪 1) Normal', main2:'Kaldırıldı', surprise:'🧠 2) Uzman + Kulis', alt:'💣 3) Sürpriz'};

const DB_SCHEMA_VERSION = 6;
const STORAGE_KEY = 'tkp_core_db_v1';
const STORAGE_BACKUP_KEY = 'tkp_core_db_v1_previous_good';
const STORAGE_COLLECTOR_IMPORT_BACKUP_KEY = 'tkp_collector_before_last_import';

// Kronoloji kilidinin sürümü şemadan ayrıdır. Böylece eski v6 yedekler ilk
// açılışta bir kez doğrulanır; sonraki temiz açılışlarda milyonlarca bağlı log
// satırını tekrar taramaya gerek kalmaz.
const TKP_CHRONOLOGY_LOCK_VERSION = 2;
const TKP_CHRONOLOGY_SORT_POLICY = 'DATE_ASC_SEQUENCE_RENUMBERED_RAW_RACE_NO_ASC_V1';
// Açılış hijyen işaretleri şema sürümünden ayrı tutulur. Temiz, uygulamanın kendi
// kalıcı verisinde marker + dizi uzunlukları yeterlidir; milyonlarca yarışa her
// açılışta yeniden dokunmak hem gereksiz hem de ana iş parçacığını kilitler.
// Haricî geri yükleme/legacy yolunda bu güven varsayımı kullanılmaz.
const TKP_STARTUP_HYGIENE_MARKER_VERSION = 2;

const SEED = { schema_version:DB_SCHEMA_VERSION, files:[], races:[], bets:[], changelog:[], prediction_log:[], auto_coupon_log:[], forward_tracking_log:[], weekly_model_log:[], v55_diagnostic_log:[], sidebet_ticket_log:[], commentator_evidence_log:[], surprise_cohort_tracking_log:[], bomb_hunter_shadow_log:[], settings:{best_min_single:5, perfect_min_single:12, perfect_min_rate:0.75, perfect_min_lb:0.5, max_rule_size:2, max_history_analysis_races:0, strict_no_result_leakage_from:'2026-08-23'} };


// V1.1.307 — USER SETTINGS REGRESSION LOCK
// Kullanıcının Ayarlar ekranından değiştirdiği değerler öğrenme/runtime alanlarından
// ayrı korunur. Migration veya yeni sürüm bu alanları yanlışlıkla değiştirirse
// checksum'lı guard DB içinden veya küçük localStorage yedeğinden geri yükler.
const TKP_USER_SETTINGS_SCHEMA_VERSION = 2;
const TKP_USER_SETTINGS_BACKUP_KEY = 'tkp_user_settings_guard_v2';
const TKP_LEGACY_USER_SETTINGS_BACKUP_KEY = 'tkp_user_settings_guard_v1';
// Bu alanlar gerçek kullanıcı ayarıdır; yeni özellikler bunları sessizce değiştiremez.
const TKP_PROTECTED_USER_SETTING_KEYS = Object.freeze(['best_min_single','perfect_min_single','perfect_min_rate','perfect_min_lb','max_rule_size','max_history_analysis_races']);
// Hesaplama sırasında üretilen/runtime alanları kullanıcı ayarından ayrıdır. Bunlar
// guard tarafından geri yazılmaz; aksi halde yeni veri geldikçe öğrenme sonuçları
// eski snapshot'a zorla dönerdi.
const TKP_RUNTIME_SETTING_KEYS = new Set(['strict_no_result_leakage_from','strict_no_result_leakage_from_iso','tkp_score_model_version','x_kulis_last','historical_no_data','historical_layer_complete','historical_training_quality_gate','historical_calibration','historical_learning_modules','similar_reference_pools','weekly_model_tracker','tr_profile_backfill_version','tr_profile_backfill_last','historical_snapshot_backfill_version','historical_snapshot_backfill_stats','verified_bet_optimizer','walkforward_500','bh_historical_500_profile','backtest_snapshot_revision','backtest_snapshot_updated_at']);
const TKP_LEGACY_PROTECTED_USER_SETTING_KEYS = Object.freeze(['best_min_single','perfect_min_single','perfect_min_rate','max_rule_size']);
function tkpStableValue(value){if(Array.isArray(value))return '['+value.map(tkpStableValue).join(',')+']';if(value&&typeof value==='object'){return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+tkpStableValue(value[k])).join(',')+'}';}const out=JSON.stringify(value);return out===undefined?'undefined':out;}
function tkpStableSettingsString(obj){const src=obj&&typeof obj==='object'?obj:{};return Object.keys(src).sort().map(k=>`${JSON.stringify(k)}:${tkpStableValue(src[k])}`).join('|');}
function tkpSettingsChecksum(obj){const str=tkpStableSettingsString(obj);let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
function tkpLegacySettingsChecksum(obj){const src=obj&&typeof obj==='object'?obj:{};const str=TKP_LEGACY_PROTECTED_USER_SETTING_KEYS.map(k=>`${k}:${JSON.stringify(src[k])}`).join('|');let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
function tkpProtectedUserSettings(settings){const src=settings&&typeof settings==='object'?settings:{},out={};for(const k of Object.keys(src)){if(!TKP_RUNTIME_SETTING_KEYS.has(k))out[k]=clone(src[k]);}for(const k of TKP_PROTECTED_USER_SETTING_KEYS){if(!Object.prototype.hasOwnProperty.call(out,k))out[k]=clone(SEED.settings[k]);}return out;}
function tkpValidSettingsGuard(guard){if(!guard||typeof guard!=='object'||!guard.values||typeof guard.values!=='object')return false;const schema=Number(guard.schema_version);if(schema===1)return String(guard.checksum||'')===tkpLegacySettingsChecksum(guard.values);return schema===TKP_USER_SETTINGS_SCHEMA_VERSION&&String(guard.checksum||'')===tkpSettingsChecksum(guard.values);}
function tkpReadLocalSettingsGuard(){try{if(typeof localStorage==='undefined')return null;for(const key of [TKP_USER_SETTINGS_BACKUP_KEY,TKP_LEGACY_USER_SETTINGS_BACKUP_KEY]){const raw=localStorage.getItem(key);if(!raw)continue;const g=JSON.parse(raw);if(tkpValidSettingsGuard(g))return g;}return null;}catch(_e){return null;}}
function tkpWriteLocalSettingsGuard(guard){try{if(typeof localStorage!=='undefined')localStorage.setItem(TKP_USER_SETTINGS_BACKUP_KEY,JSON.stringify(guard));return true;}catch(_e){return false;}}
function tkpBuildSettingsGuard(settings,reason='snapshot'){const values=tkpProtectedUserSettings(settings);return {schema_version:TKP_USER_SETTINGS_SCHEMA_VERSION,values,checksum:tkpSettingsChecksum(values),updated_at:new Date().toISOString(),reason:String(reason||'snapshot')};}
function tkpCommitUserSettingsGuard(targetDb=db,reason='user-save'){if(!targetDb||typeof targetDb!=='object')return null;targetDb.settings=targetDb.settings&&typeof targetDb.settings==='object'?targetDb.settings:{};const guard=tkpBuildSettingsGuard(targetDb.settings,reason);targetDb.settings_guard=guard;tkpWriteLocalSettingsGuard(guard);return guard;}
function tkpApplyUserSettingsGuard(targetDb){if(!targetDb||typeof targetDb!=='object')return {restored:false,source:'none'};targetDb.settings=targetDb.settings&&typeof targetDb.settings==='object'?targetDb.settings:{};let guard=tkpValidSettingsGuard(targetDb.settings_guard)?targetDb.settings_guard:null,source=guard?'db':'none';if(!guard){const local=tkpReadLocalSettingsGuard();if(local){guard=local;source='local';}}if(!guard){tkpCommitUserSettingsGuard(targetDb,'initial-snapshot');return {restored:false,source:'initial'};}const keys=Number(guard.schema_version)===1?TKP_LEGACY_PROTECTED_USER_SETTING_KEYS:Object.keys(guard.values);let changed=false;for(const k of keys){if(JSON.stringify(targetDb.settings[k])!==JSON.stringify(guard.values[k])){targetDb.settings[k]=clone(guard.values[k]);changed=true;}}targetDb.settings_guard={...guard,restored_at:changed?new Date().toISOString():(guard.restored_at||''),restore_source:source};tkpWriteLocalSettingsGuard(targetDb.settings_guard);return {restored:changed,source};}
function tkpEnforceUserSettingsGuard(targetDb=db){return tkpApplyUserSettingsGuard(targetDb);}
if(typeof globalThis!=='undefined'){globalThis.tkpCommitUserSettingsGuard=tkpCommitUserSettingsGuard;globalThis.tkpApplyUserSettingsGuard=tkpApplyUserSettingsGuard;globalThis.tkpEnforceUserSettingsGuard=tkpEnforceUserSettingsGuard;globalThis.TKP_PROTECTED_USER_SETTING_KEYS=TKP_PROTECTED_USER_SETTING_KEYS;}

let db = null;
// Klasik scriptlerde `let db` window özelliği oluşturmaz. Tarihsel kalibrasyon,
// yedek worker köprüsü ve bağımsız modüller aynı canlı DB nesnesini globalThis.db
// üzerinden okuyordu; köprü olmayınca REAL509 snapshot işi sessizce "DB yok"
// diyerek çıkıyordu. Getter/setter tek nesneyi paylaşır, kopya üretmez.
try{
  Object.defineProperty(globalThis,'db',{configurable:true,enumerable:false,get(){return db;},set(value){db=value;}});
}catch(_){globalThis.db=db;}

let currentRules = [];

let rulesDirty = true;

function tkpRuleCacheSignature(){
  // KÖK FIX (V1.1.236): buildRules() SADECE sonucu kesinleşmiş yarışlara
  // (learningEligibleRaces()) bağlıdır. Eski imza ham db.files/db.races uzunluğuna
  // (ya da genel dataset_signature'a) dayanıyordu; Veri Toplayıcı'dan gelen HENÜZ
  // KOŞULMAMIŞ yeni bir tahmin kaydı bile bu sayıyı artırıp önbelleği geçersiz
  // kılıyor, ardından renderPredictionScreen -> getCurrentRules() tam ~29 sn'lik
  // buildRules() yeniden hesabını senkron biçimde tetikleyip arayüzü kilitliyor ve
  // tarayıcı "sayfa yanıt vermiyor" uyarısı veriyordu. İmza artık öğrenmeye giren
  // (sonucu olan) yarış sayısı + son öğrenme-uygun yarışın kimliği + kural boyutu
  // ayarına dayanır; yeni/bekleyen bir tahmin eklenmesi bunları değiştirmez.
  const eligible = typeof learningEligibleRaces==='function' ? learningEligibleRaces() : [];
  const last = eligible.length ? eligible[eligible.length-1] : null;
  const lastKey = last ? `${last.file_id??''}:${last.leg??''}:${last.race_date||last.date||''}` : '';
  const maxRuleSize = db?.settings?.max_rule_size??'';
  // Aynı yarış sayısında sonradan düzeltilen derece/sonuç da kural cache'ini
  // yenilemelidir. Kalıcı outcome imzası saveDB'de yalnız gerçek sonuç değişince
  // güncellenir; canlı AGF/yorum/ayar değişimi kuralları boşuna bozmaz.
  const outcome=String(db?.learning_state?.outcome_signature||'');
  return `${eligible.length}|${lastKey}|${maxRuleSize}|${outcome}`;
}
function tkpHydrateRuleCache(){
  const cache=db?.learning_state?.rule_cache;
  if(!cache||!Array.isArray(cache.rules))return null;
  const currentSignature=tkpRuleCacheSignature();
  let signatureMatches=cache.dataset_signature===currentSignature;
  // V1.1.237 ve daha eski yedekler kural önbelleğini eski, bütün-veri imzasıyla
  // saklıyordu (örn. "503:3018:..."). Yedek ilk açıldığında bu imza hâlâ mevcut
  // veri kümesinin hesaplanan imzasıyla birebir aynıysa kurallar geçerlidir; onları
  // çöpe atıp ana thread'de saniyeler süren buildRules() çalıştırmak yerine bir kez
  // yeni, yalnız sonuçlu yarışlara bağlı imzaya taşırız. Sonraki sonuçsuz kolektör
  // eklemeleri yeni imzayı bozmaz.
  if(!signatureMatches){
    // learningDatasetSignature(db) burada çağrılmaz: 300+ MB yedekte bütün atları
    // senkron tarar ve bizzat önlemeye çalıştığımız donmayı yeniden üretir. Eski
    // sürüm bu değeri learning_state'e zaten kalıcı olarak yazmıştır.
    const legacy=String(db?.learning_state?.dataset_signature||'');
    if(legacy&&cache.dataset_signature===legacy){
      cache.dataset_signature=currentSignature;
      signatureMatches=true;
    }
  }
  if(!signatureMatches)return null;
  const featureMap=new Map((typeof atomicFeatures==='function'?atomicFeatures(learningEligibleRaces()):[]).map(f=>[f.name,f]));
  const rows=[];
  for(const saved of cache.rules){
    const features=(saved.feature_names||[]).map(name=>featureMap.get(name));
    if(!features.length||features.some(f=>!f))return null;
    rows.push({...saved,recentN:Number.isFinite(Number(saved.recentN))?Number(saved.recentN):Math.min(20,Number(saved.single)||0),features,name:saved.name||features.map(f=>f.name).join(' + ')});
  }
  return rows;
}
function tkpStoreRuleCache(rows){
  if(!db)return;
  db.learning_state=db.learning_state&&typeof db.learning_state==='object'?db.learning_state:{};
  db.learning_state.rule_cache={dataset_signature:tkpRuleCacheSignature(),created_at:new Date().toISOString(),rules:(rows||[]).map(row=>({
    name:row.name,feature_names:(row.features||[]).map(f=>f.name),single:row.single,singleWins:row.singleWins,rate:row.rate,recentRate:row.recentRate,recentN:Number(row.recentN)||0,lb:row.lb,selectedHorses:row.selectedHorses,selectedWins:row.selectedWins,eligible:row.eligible,files:row.files,hippos:row.hippos
  }))};
}
// V1.1.284 TEMİZLİK: eski senkron getCurrentRules() (buildRules() zincirini ana
// thread'de bloklayan sürüm) hiçbir üretim kod yolundan artık çağrılmıyordu --
// tüm çağıranlar getCurrentRulesAsync()'e taşınmıştı. Ölü kod olarak kaldırıldı;
// davranış tamamen aynı, tek giriş noktası artık getCurrentRulesAsync().
// V1.1.241 HIZ KÖK FIX: renderPredictionScreen() (zaten async) cache-miss anında
// getCurrentRules() -> buildRules() zincirini senkron çağırıp ana iş parçacığını
// kilitliyordu (503 dosya ölçeğinde ~12-29 sn). Cache HİT durumunda hiçbir davranış
// değişmedi -- bu fonksiyon önce aynı senkron cache okuma/hydrate yolunu dener;
// yalnız gerçekten tam yeniden hesaplama gerekiyorsa (cache miss) buildRulesAsync()
// kullanır, böylece tarayıcı hesaplama sürerken girdi/çizim işleyebilir. Sonuç
// (kurallar, sıralama, imza) eski senkron sürümle bit-bit aynıdır.
let _tkpRuleCachePersistQueued=false;
function tkpRuleCacheDiag(path,started,extra={}){
  const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const info={path,duration_ms:Math.max(0,now-started),at:new Date().toISOString(),...extra};
  try{if(typeof globalThis!=='undefined')globalThis.__tkpLastRuleCacheDiagnostic=info;}catch(_e){}
  try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('rules:getCurrent:'+path,started);}catch(_e){}
  return info;
}
function tkpPersistFinalRuleCacheSoon(){
  if(_tkpRuleCachePersistQueued||!db?.learning_state?.rule_cache)return false;
  const api=_segmentedStorageApi();
  if(!api||typeof api.updateMetaPatch!=='function')return false;
  _tkpRuleCachePersistQueued=true;
  const run=async()=>{
    const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    try{
      const generation=String(db?.__segmented_storage?.baseGeneration||persistenceStatus().generation||'');
      await api.updateMetaPatch({learning_state:{rule_cache:db.learning_state.rule_cache}},{expectedGeneration:generation,timeoutMs:30000});
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('rules:persist-final-cache',started);
      return true;
    }catch(error){
      try{if(typeof globalThis!=='undefined')globalThis.__tkpRuleCachePersistError=String(error?.message||error);}catch(_e){}
      return false;
    }finally{_tkpRuleCachePersistQueued=false;}
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask('rule-cache-persist',run,{priority:'background',replace:true,minIdleMs:500});
  else if(typeof tkpRunWhenUserIdle==='function')tkpRunWhenUserIdle(run,{minIdleMs:700,retryMs:150,maxWaitMs:5000});
  else setTimeout(run,0);
  return true;
}
async function getCurrentRulesAsync(){
  const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  if (!rulesDirty){tkpRuleCacheDiag('memory-hit',started,{rules:currentRules.length});return currentRules;}
  // Persisted rule hydration is read-only, but it still walks the historical
  // race/horse set to rebuild feature references.  Always yield before and
  // after that work so a menu click can paint first on Win8.1/older Chromium.
  const cached=await tkpHydrateRuleCacheAsync();
  if (cached){
    currentRules=cached;
    rulesDirty=false;
    tkpRuleCacheDiag('persisted-final-hit',started,{rules:currentRules.length});
    return currentRules;
  }
  // V1.1.285 HIZ KÖK FIX: tam yeniden hesap yerine (mümkünse) yalnız yeni yarış
  // dilimini tarayan incremental motor kullanılır. tkp-incremental-rules.js
  // yüklenmemişse (ör. eski bir sürümle karışık dosya seti) sessizce ve güvenle
  // eski, kanıtlanmış buildRulesAsync() tam-taramasına düşer -- davranış hiçbir
  // koşulda bozulmaz, yalnız hız değişir. Sonuç (kurallar, sıralama, imza,
  // oran/lb değerleri) iki yolda da bit-bit aynıdır -- bkz.
  // tests/incremental-rules-parity.test.js.
  currentRules = typeof tkpBuildRulesIncrementalAsync==='function' ? await tkpBuildRulesIncrementalAsync() : await buildRulesAsync();
  tkpStoreRuleCache(currentRules);
  rulesDirty = false;
  tkpPersistFinalRuleCacheSoon();
  const incr=(typeof globalThis!=='undefined')?globalThis.__tkpIncrementalRuleCacheDiagnostic:null;
  const path=incr?.reusable?(incr.startN<incr.raceCount?'incremental-extend':'incremental-materialize'):'full-rebuild';
  tkpRuleCacheDiag(path,started,{rules:currentRules.length,startN:incr?.startN||0,raceCount:incr?.raceCount||0});
  return currentRules;
}
async function tkpHydrateRuleCacheAsync(){
  if(typeof tkpYield==='function') await tkpYield();
  const cached=tkpHydrateRuleCache();
  if(typeof tkpYield==='function') await tkpYield();
  return cached;
}
// Read-only UI renders must never start the expensive full rule miner.  They may
// use rules already hydrated in memory.  A dirty cache is deliberately not
// hydrated synchronously here: this function is called from paint paths, and a
// synchronous historical walk can turn a tab click into a frozen page.  The
// explicit/background async path above owns hydration and refreshes the pane.
function tkpPeekCurrentRules(){
  if(!rulesDirty)return currentRules;
  return null;
}

let previewPayload = null;

let lastRaceResults = null;

let activeCoupons = {main:null, main2:null, alt:null, surprise:null};

let persistMode = 'none';
let _persistReadOnly = false;
let _lastSerializedSnapshot = '';
let _dbMigrationDirty = false;
// Açılışta büyük arşivi tekrar yazmak, ilk ekran çizildikten sonra dahi belleği
// sıçratıp uygulamayı kilitleyebiliyordu. Worker zaten geri yüklenen ham veriyi
// atomik manifest ile kalıcılaştırır; aşağıdaki işaret yalnız sonraki AÇIK kullanıcı
// kaydında temizlenir. Böylece güvenlik bakımı kaybolmaz ama açılışta gizli yazım
// başlamaz.
const TKP_STARTUP_DEFERRED_PERSIST_REASONS = new Set([
  'startup-hygiene','restore-hygiene','recovery','legacy-migration','backup-migration','bootstrap'
]);
let _tkpDeferredStartupPersistence = null;
// V1.0.75: yedek yazımı kısıtlaması (bkz. _flushSaveQueue).
let _lastBackupWriteAt = 0;
let _renderInProgress = false;
const BACKUP_MIN_INTERVAL_MS = 30000;

// KÖK ÇÖZÜM: "Kalıcı depolama bulunamadı" uyarısı en çok TKP_CORE_CLAUDE.html dosyası
// çift tıklanıp file:// olarak açıldığında çıkıyor -- Chrome/Edge bu protokolde
// localStorage'ı genelde engelliyor. IndexedDB ise file:// altında çoğu tarayıcıda
// çalışır. Ana veri yeni parçalı IndexedDB v2 katmanında tutulur; eski tek-JSON
// IndexedDB yalnız bir defalık geriye uyumlu göç kaynağıdır. Bu SAYEDE kullanıcı hiçbir sunucu kurmadan (çift tık ile) de
// verisini kaybetmeden çalışabilir. İkisi de başarısız olursa (ör. bazı gizli/kısıtlı
// tarayıcı modları), uygulama bellekte çalışmaya devam eder ve gerçek kayıt hatası
// gösterilir. Otomatik dosya indirme yapılmaz; manuel .tkbz yedekleme düğmesi korunur.
const _idbName = 'tkp_core_idb_v1';
const _idbStore = 'kv';
// Ana TKP verisi ve otomatik güvenlik kopyaları büyük veri olarak kabul edilir.
// Bu anahtarlar hiçbir koşulda localStorage'a yazılmaz; localStorage kotası birkaç
// MB ile sınırlı olduğu için büyük arşivde kota hatası ve veri kaybı üretir.
const _CORE_PERSIST_KEYS = new Set([
  STORAGE_KEY,
  STORAGE_BACKUP_KEY,
  STORAGE_COLLECTOR_IMPORT_BACKUP_KEY
]);
const IDB_OPEN_TIMEOUT_MS = 10000;
const IDB_READ_TIMEOUT_MS = 30000;
const IDB_WRITE_TIMEOUT_MS = 120000;
let _idbPromise = null;
function _withTimeout(promise, ms){
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if(!done){ done=true; resolve(null); } }, ms);
    promise.then((v) => { if(!done){ done=true; clearTimeout(timer); resolve(v); } });
  });
}
function _openIdb(){
  if (_idbPromise) return _idbPromise;
  const raw = new Promise((resolve) => {
    try {
      if (!window.indexedDB){ resolve(null); return; }
      const req = indexedDB.open(_idbName, 1);
      req.onupgradeneeded = () => { try{ req.result.createObjectStore(_idbStore); }catch(e){} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // KÖK ÇÖZÜM: Aynı dosya başka bir sekmede/pencerede açık kaldıysa
      // eski bağlantı yeni isteği BLOKLAR ve ne onsuccess ne onerror ateşlenir --
      // sayfa sonsuza dek asılı kalırdı. onblocked eklendi, ayrıca tüm işlem
      // 10 sn ile sınırlandırıldı; süre dolarsa depolama olmadan (bellek-içi)
      // devam edilir, kullanıcı asla kilitte kalmaz.
      req.onblocked = () => resolve(null);
    } catch(e){ resolve(null); }
  });
  _idbPromise = _withTimeout(raw, IDB_OPEN_TIMEOUT_MS);
  return _idbPromise;
}
async function _idbGet(key){
  const db = await _openIdb();
  if (!db) return undefined;
  return _withTimeout(new Promise((resolve) => {
    try {
      const tx = db.transaction(_idbStore, 'readonly');
      const req = tx.objectStore(_idbStore).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch(e){ resolve(undefined); }
  }), IDB_READ_TIMEOUT_MS);
}
async function _idbSet(key, value){
  const db = await _openIdb();
  if (!db) return false;
  return _withTimeout(new Promise((resolve) => {
    try {
      const tx = db.transaction(_idbStore, 'readwrite');
      tx.objectStore(_idbStore).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch(e){ resolve(false); }
  }), IDB_WRITE_TIMEOUT_MS);
}

let _lastAutoBackupAt = 0;
function _autoSafetyBackupIfNeeded(){
  // Otomatik dosya indirme kullanıcı akışını bozduğu için kapalıdır.
  // Manuel .tkbz yedekleme düğmesi veri güvenliği için korunur.
}


let _persistVerified = false;
let _persistLastError = '';
let _saveScheduled = false;
let _saveScheduledImmediate = false;
let _saveRunning = false;
let _saveNeedsAnotherPass = false;
let _saveRenderRequested = false;
let _saveResolvers = [];
let _dbBatchDepth = 0;
let _dbBatchRenderRequested = false;
let _dbBatchPersistRequested = false;
let _dbBatchImmediatePersistRequested = false;
let _lastLearningDatasetSignature = '';
let _lastOutcomeLearningSignature = '';
let _tkpDbRevision = 0;
let _tkpSerializedBytes = 0;

function tkpHashString(input){
  let hash = 2166136261;
  const s = String(input ?? '');
  for(let i=0;i<s.length;i++){
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// R16.93 AGF: full integrity hashes retain every field, but persistence yields
// between records. Moving a synchronous scan to an idle queue alone does not help.
async function tkpDrainSignatureSteps(steps){
  let lastYield=Date.now(),step;
  do{
    step=steps.next();
    if(!step.done&&Date.now()-lastYield>=8){
      await new Promise(resolve=>setTimeout(resolve,0));
      lastYield=Date.now();
    }
  }while(!step.done);
  return step.value;
}

function learningDatasetSignature(sourceDb=db){
  const steps=learningDatasetSignatureSteps(sourceDb);let step;
  do{step=steps.next();}while(!step.done);
  return step.value;
}
async function learningDatasetSignatureAsync(sourceDb=db){
  return tkpDrainSignatureSteps(learningDatasetSignatureSteps(sourceDb));
}
function* learningDatasetSignatureSteps(sourceDb=db){
  if(!sourceDb) return 'EMPTY';
  let hash = 2166136261;
  const mix = value => {
    const s=String(value ?? '');
    for(let i=0;i<s.length;i++){
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash,16777619);
    }
  };
  const files=Array.isArray(sourceDb.files)?sourceDb.files:[];
  const races=Array.isArray(sourceDb.races)?sourceDb.races:[];
  // 5M KAYIT KORUMASI: Çok büyük arşivde bütün atları her saveDB çağrısında
  // baştan taramak ana ekranı dakikalarca kilitler. Küçük/orta veride eski tam
  // imza korunur; büyük veride koleksiyon boyları ve dengeli örnekler üzerinden
  // O(koleksiyon sayısı) ölçeklenebilir imza kullanılır. Her kalıcı yazım ayrıca
  // _tkpDbRevision'ı artırdığı için aynı uzunlukta yerinde güncelleme de cache'i
  // güvenle geçersiz kılar.
  // Changelog/ileri-takip gibi milyonluk yardımcı loglar öğrenme tablosunun veri
  // kümesi değildir. Bunların büyümesi veya normal saveDB revizyonu adaptif tabloyu
  // yeniden hesaplatamaz. Ölçek kararı yalnız öğrenmenin gerçek yarış/at girdisine
  // göre verilir.
  const topLevelRows=Object.values(sourceDb).reduce((sum,value)=>sum+(Array.isArray(value)?value.length:0),0);
  let horseRows=0;
  if(races.length<=50000)for(const race of races)horseRows+=Array.isArray(race?.horses)?race.horses.length:0;
  const largeLearningSet=races.length>50000||horseRows>500000;
  if(largeLearningSet){
    const sample=(arr,index)=>arr.length?arr[Math.max(0,Math.min(arr.length-1,index))]:null;
    const mixRow=row=>{
      if(row==null){mix('NULL');return;}
      if(typeof row!=='object'){mix(row);return;}
      mix(row.id);mix(row.file_id);mix(row.race_uid);mix(row.meeting_uid);mix(row.race_date);mix(row.hippodrome);
      mix(row.leg);mix(row.horse_no);mix(row.finish_position);mix(row.updated_at);mix(row.result_updated_at);mix(row.status);
    };
    mix('TKP_LARGE_LEARNING_DB_3');mix(files.length);mix(races.length);
    for(const value of [files,races]){
      mix(value.length);mixRow(sample(value,0));mixRow(sample(value,Math.floor(value.length/2)));mixRow(sample(value,value.length-1));
    }
    return `LARGE:${topLevelRows}:${(hash>>>0).toString(36)}`;
  }
  mix(files.length); mix(races.length);
  for(const f of files){
    yield;
    mix(f.id); mix(f.status); mix(f.sequence_no); mix(f.race_date); mix(f.altili_no);
    mix(f.result_updated_at); mix(f.has_confirmed_results);
  }
  const analysisFields=[
    'accurate_avg_speed_mps','accurate_max_speed_mps','accurate_closing_speed_mps',
    'accurate_finish_signal','accurate_finish_time_sec','accurate_fark','accurate_delta',
    'priorAccurateAvgSpeed','priorAccurateFinishSignal','priorAccurateStarts',
    'start_no','start_no_source','bmb','bmb_source','result_score','result_rank','jbyg','jbyg_rank',
    'jbyg_rate','jbyg_source','g800','g800_rank','galop_rank','workout_400','workout_600',
    'workout_800','hndkp','hndkp_rank','s_value','tr','tr_rank','tr_ganyan','tr_puan',
    'tr_ganyan_source','value_score','value_rank','sp','sp_rank','son6_raw','star_value',
    'team_strength_pct','team_strength_rank','gpr_starts','gpr_wins','gpr_strength',
    'condWinStarts','condWinWins','condWinPct','priorStarts','priorWins','priorSurpriseHits',
    'condSurpriseHits','x_kulis_score','x_kulis_direction','x_ypuan_delta','x_tkp_score_delta',
    'x_final_rank','x_base_rank','x_final_tkp_score','x_final_ypuan','x_kulis_applied',
    'expert_consensus_total','expert_positive_votes','expert_top2_votes','expert_single_votes',
    'expert_omission_votes','expert_consensus_ratio','official_time','result_time'
  ];
  for(const r of races){
    yield;
    mix(r.id); mix(r.file_id); mix(r.active); mix(r.race_date); mix(r.hippodrome);
    mix(r.leg); mix(r.distance); mix(r.surface); mix(r.breed); mix(r.condition_family||r.condition_text);
    mix(r.result_integrity_status); mix(r.result_integrity_source); mix(r.result_verified_depth);
    const horses=Array.isArray(r.horses)?r.horses:[];
    mix(horses.length);
    for(const h of horses){
      mix(h.horse_no); mix(h.horse_name); mix(h.finish_position); mix(h.winner);
      // score görünüm sırasında yeniden üretilebilen türetilmiş bir değerdir;
      // değişmesi doğrulanmış yeni veri değildir ve öğrenme tablosunu yenileyemez.
      mix(h.agf); mix(h.agf_rank); mix(h.ypuan); mix(h.weight_kg); mix(h.best_time);
      // Kaynak/analiz alanlarının tamamı aynı veri imzasına girer. Önceki imza
      // yalnız ortalama Accurate hızını gördüğü için kapanış/tempo/bitiriş gibi
      // güncellemeler eski analitik HTML'i geçerli sanabiliyordu.
      for(const field of analysisFields)mix(h[field]);
    }
  }
  return `${files.length}:${races.length}:${(hash>>>0).toString(36)}`;
}

// Yalnız sonucu kesinleşmiş yarışların öğrenme girdisi. Günün henüz koşulmamış
// bülteni, hazır kuponu veya galop desteği kaydedildiğinde genel DB imzası doğal
// olarak değişir; fakat çevrim içi sıralama modelinin eğitim kümesi değişmez.
// Eski kod bu iki durumu ayırmadığı için her canlı veri alımından sonra 509 arşivi
// yeniden eğitiyor ve Win8.1'de ayak ekranını dakikalarca bekletiyordu.
let _tkpOutcomeLearningSignatureCache={revision:-1,source:null,value:''};
function tkpOutcomeLearningSignature(sourceDb=db,force=false){
  const steps=tkpOutcomeLearningSignatureSteps(sourceDb,force);let step;
  do{step=steps.next();}while(!step.done);
  return step.value;
}
async function tkpOutcomeLearningSignatureAsync(sourceDb=db,force=false){
  return tkpDrainSignatureSteps(tkpOutcomeLearningSignatureSteps(sourceDb,force));
}
function* tkpOutcomeLearningSignatureSteps(sourceDb=db,force=false){
  if(!sourceDb)return 'OUTCOME:EMPTY';
  if(!force&&sourceDb===db&&_tkpOutcomeLearningSignatureCache.source===sourceDb
    &&_tkpOutcomeLearningSignatureCache.revision===_tkpDbRevision
    &&_tkpOutcomeLearningSignatureCache.value)return _tkpOutcomeLearningSignatureCache.value;
  let hash=2166136261;
  const mix=value=>{const s=String(value??'');for(let i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619);}};
  // saveDB sınırında revizyon henüz artmamıştır; yerinde işlenen yeni sonuç eski
  // learningEligibleRaces cache'inden okunmamalı. force yolu ham yarışlardan
  // yalnız resmî sonucu doğrulanmış olanları doğrudan seçer.
  const rows=force
    ?(Array.isArray(sourceDb?.races)?sourceDb.races.filter(r=>typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(r?.horses||[])):[])
    :(typeof learningEligibleRaces==='function'?learningEligibleRaces(sourceDb):[]);
  mix('TKP_OUTCOME_LEARNING_1');mix(rows.length);
  for(const r of rows){
    yield;
    mix(r?.id);mix(r?.file_id);mix(r?.race_date||r?.date);mix(r?.hippodrome);mix(r?.leg);
    mix(r?.distance);mix(r?.surface);mix(r?.breed);mix(r?.condition_family||r?.condition_text);
    const horses=Array.isArray(r?.horses)?r.horses:[];mix(horses.length);
    for(const h of horses){
      mix(h?.horse_no);mix(h?.horse_name);mix(h?.winner);mix(h?.finish_position);
      mix(h?.prediction_score_snapshot??h?.score);mix(h?.agf_rank);mix(h?.tr_rank);mix(h?.sp_rank);
      mix(h?.result_rank);mix(h?.hndkp_rank);mix(h?.value_rank);mix(h?.ypuan);
      mix(h?.g800);mix(h?.jbyg);mix(h?.team_strength_rank);mix(h?.s_value);
      mix(h?.accurate_avg_speed_mps);mix(h?.accurate_finish_signal);mix(h?.bmb);
    }
  }
  const value=`OUTCOME:${rows.length}:${(hash>>>0).toString(36)}`;
  if(sourceDb===db)_tkpOutcomeLearningSignatureCache={revision:_tkpDbRevision,source:sourceDb,value};
  return value;
}
if(typeof globalThis!=='undefined')globalThis.tkpOutcomeLearningSignature=tkpOutcomeLearningSignature;

// UI önbellek anahtarları için tüm atları yeniden taramak gereksizdir. Veri
// değişiklikleri saveDB/setDb üzerinden geçtiğinde revizyon artar ve ilgili
// önbellekler zaten tkp:db-changed olayıyla temizlenir. Kalıcı öğrenme imzası,
// sayımlar ve revizyon birlikte oturum içi güvenli, O(1) bir anahtar verir.
function tkpFastDbSignature(sourceDb=db){
  const d=sourceDb||{};
  const persisted=d?.learning_state?.dataset_signature||_lastLearningDatasetSignature||'';
  return [
    // Revizyon burada bilerek yoktur. Bahis/ayar/diagnostic gibi küçük bir kayıt
    // arşiv verisini değiştirmediğinde bütün ağır pane cache'lerini geçersiz
    // kılmamalıdır. tkp:db-changed olayı yalnız ilgili ucuz panelleri temizler;
    // gerçek yarış/veri değişikliği persisted imzayı zaten değiştirir.
    'TKP_FAST_DB_2',
    persisted,
    Array.isArray(d.files)?d.files.length:0,
    Array.isArray(d.races)?d.races.length:0,
    Array.isArray(d.bets)?d.bets.length:0,
    Array.isArray(d.prediction_log)?d.prediction_log.length:0,
    Array.isArray(d.auto_coupon_log)?d.auto_coupon_log.length:0,
    Array.isArray(d.forward_tracking_log)?d.forward_tracking_log.length:0,
    Array.isArray(d.weekly_model_log)?d.weekly_model_log.length:0,
    Array.isArray(d.v55_diagnostic_log)?d.v55_diagnostic_log.length:0,
    Array.isArray(d.sidebet_ticket_log)?d.sidebet_ticket_log.length:0,
    Array.isArray(d.commentator_evidence_log)?d.commentator_evidence_log.length:0,
    Array.isArray(d.surprise_cohort_tracking_log)?d.surprise_cohort_tracking_log.length:0,
    Array.isArray(d.bomb_hunter_shadow_log)?d.bomb_hunter_shadow_log.length:0,
    Array.isArray(d.changelog)?d.changelog.length:0
  ].join('|');
}

// Üç merkezin HTML'i yalnız yarış dizisine değil, sonuç/yan bahis/yorumcu/Bomba
// Avcısı ve takip kayıtlarına da dayanır. Bu yardımcı imza bu koleksiyonlarda
// yerinde güncellenen bir satırı da yakalar; aynı imzada tekrar hesap yoktur.
let _tkpAuxiliaryAnalysisSignatureCache={revision:-1,source:null,refs:null,value:''};
function tkpAuxiliaryAnalysisSignature(sourceDb=db){
  const keys=['bets','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log',
    'sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log',
    'bomb_hunter_shadow_log','changelog'];
  const refs=keys.map(key=>sourceDb?.[key]);
  if(sourceDb===db&&_tkpAuxiliaryAnalysisSignatureCache.source===sourceDb
    &&_tkpAuxiliaryAnalysisSignatureCache.revision===_tkpDbRevision
    &&_tkpAuxiliaryAnalysisSignatureCache.refs?.every((rows,index)=>rows===refs[index])
    &&_tkpAuxiliaryAnalysisSignatureCache.value)return _tkpAuxiliaryAnalysisSignatureCache.value;
  let hash=2166136261>>>0;
  const mix=value=>{const s=String(value??'');for(let i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}};
  for(const [index,key] of keys.entries()){
    const rows=Array.isArray(refs[index])?refs[index]:[];mix(key);mix(rows.length);
    for(const row of rows){try{mix(JSON.stringify(row));}catch(_e){mix(row?.id||row?.ts||'ROW');}}
  }
  const value=`AUX_ANALYSIS_V2:${(hash>>>0).toString(36)}`;
  if(sourceDb===db)_tkpAuxiliaryAnalysisSignatureCache={revision:_tkpDbRevision,source:sourceDb,refs,value};
  return value;
}
if(typeof globalThis!=='undefined')globalThis.tkpAuxiliaryAnalysisSignature=tkpAuxiliaryAnalysisSignature;

// Yan bahis öğrenmesi mevcut prediction_log satırlarının yalnız SAYISINA bakamaz.
// Sonuç işlendiğinde aynı satır resolved/finish_position alanlarıyla yerinde güncellenir;
// uzunluk değişmez. Küçük FNV imzası bu içerik değişimini yakalar ve eski panel/cache'i
// kesin olarak geçersiz kılar.
let _sideBetSignatureEpoch=0;
let _sideBetSignatureCache={revision:-1,epoch:-1,rows:null,length:-1,value:''};
let _tkpDerivedSignatureMetaPatch={};
let _tkpDerivedSignatureMetaPersistQueued=false;
function tkpPersistDerivedSignatureMetaSoon(patch){
  if(!patch||typeof patch!=='object')return false;
  _tkpDerivedSignatureMetaPatch={..._tkpDerivedSignatureMetaPatch,...patch};
  if(_tkpDerivedSignatureMetaPersistQueued)return true;
  const api=_segmentedStorageApi();
  if(!api||typeof api.updateMetaPatch!=='function')return false;
  _tkpDerivedSignatureMetaPersistQueued=true;
  const run=async()=>{
    const payload={..._tkpDerivedSignatureMetaPatch};
    _tkpDerivedSignatureMetaPatch={};
    try{
      const generation=String(db?.__segmented_storage?.baseGeneration||persistenceStatus().generation||'');
      await api.updateMetaPatch({learning_state:payload},{expectedGeneration:generation,timeoutMs:30000});
      return true;
    }catch(_e){
      _tkpDerivedSignatureMetaPatch={...payload,..._tkpDerivedSignatureMetaPatch};
      return false;
    }finally{_tkpDerivedSignatureMetaPersistQueued=false;}
  };
  // Yalnız birkaç yüz baytlık manifest metadata yazımıdır; yarış koleksiyonları
  // serialize edilmez. İlk boya ve kullanıcı tıklamasıyla yarışmaması için arka
  // plan kuyruğunda tek anahtarla çalışır.
  if(typeof tkpQueueTask==='function')tkpQueueTask('derived-signature-meta-persist',run,{priority:'background',replace:true,minIdleMs:900});
  else if(typeof tkpRunWhenUserIdle==='function')tkpRunWhenUserIdle(run,{minIdleMs:1200,retryMs:180,maxWaitMs:6000});
  else setTimeout(run,250);
  return true;
}
if(typeof globalThis!=='undefined')globalThis.tkpPersistDerivedSignatureMetaSoon=tkpPersistDerivedSignatureMetaSoon;
let _tkpTopLevelMetaPatch={};
let _tkpTopLevelMetaPersistQueued=false;
function tkpPersistTopLevelMetaSoon(patch,taskKey='top-level-meta-persist'){
  if(!patch||typeof patch!=='object')return false;
  _tkpTopLevelMetaPatch={..._tkpTopLevelMetaPatch,...patch};
  if(_tkpTopLevelMetaPersistQueued)return true;
  const api=_segmentedStorageApi();if(!api||typeof api.updateMetaPatch!=='function')return false;
  _tkpTopLevelMetaPersistQueued=true;
  const run=async()=>{
    const payload={..._tkpTopLevelMetaPatch};_tkpTopLevelMetaPatch={};
    try{
      const generation=String(db?.__segmented_storage?.baseGeneration||persistenceStatus().generation||'');
      await api.updateMetaPatch(payload,{expectedGeneration:generation,timeoutMs:30000});return true;
    }catch(_e){_tkpTopLevelMetaPatch={...payload,..._tkpTopLevelMetaPatch};return false;}
    finally{_tkpTopLevelMetaPersistQueued=false;}
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask(String(taskKey||'top-level-meta-persist'),run,{priority:'background',replace:true,minIdleMs:900});
  else setTimeout(run,250);
  return true;
}
if(typeof globalThis!=='undefined')globalThis.tkpPersistTopLevelMetaSoon=tkpPersistTopLevelMetaSoon;
function tkpPersistCollectionsFallback(){
  const promise=saveDB(false,false);
  // A partial-write caller may itself own the serial task queue. In cold-archive
  // mode its full-save fallback must not await a db-persist job behind itself.
  const owner=typeof tkpQueueInfo==='function'?tkpQueueInfo()?.current?.key:null;
  if(owner&&owner!=='db-persist'&&_saveScheduled&&!_saveRunning&&_dbBatchDepth===0
    &&typeof tkpCancelQueuedTask==='function'){
    tkpCancelQueuedTask('db-persist');
    _flushSaveQueue().catch(error=>console.error('Koleksiyon kayıt yedeği başarısız:',error));
  }
  return promise;
}
async function tkpPersistCollections(names,{metaPatch=null,label='collection-patch'}={}){
  const api=_segmentedStorageApi();
  if(!api||typeof api.updateCollections!=='function')return tkpPersistCollectionsFallback();
  const selected=[...new Set((Array.isArray(names)?names:[]).map(String).filter(name=>Array.isArray(db?.[name])))];
  if(!selected.length)return true;
  // Safe-mode'da bir koleksiyonun soğuk prefix'i RAM'de değildir. updateCollections
  // bu durumda haklı olarak reddeder; eski davranış seçili ayak güncellendikten
  // sonra "kaydedilemedi" hatası veriyordu. saveDB hot-tail'i yazıp doğrulanmış
  // soğuk prefix'i aynen yeniden kullanır, bu yüzden hem kayıp hem tam arşiv taraması
  // olmadan güvenli yoldur.
  const hasColdSelected=selected.some(name=>Number(db?.__segmented_storage?.collections?.[name]?.coldCount)>0);
  if(hasColdSelected)return tkpPersistCollectionsFallback();
  const generation=String(db?.__segmented_storage?.baseGeneration||persistenceStatus().generation||'');
  try{
    const result=await api.updateCollections(db,selected,{expectedGeneration:generation,metaPatch,targetBytes:512*1024,writeBatch:8,timeoutMs:300000});
    if(!result?.ok)throw new Error('Kısmi IndexedDB yazımı doğrulanamadı.');
    persistMode='indexeddb-segmented-patch';_persistVerified=true;_persistLastError='';
    _tkpSerializedBytes=Number(result?.stats?.bytes)||_tkpSerializedBytes;
    if(db?.__segmented_storage)db.__segmented_storage.baseGeneration=String(result?.stats?.generation||db.__segmented_storage.baseGeneration||'');
    try{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('tkp:db-changed',{detail:{domain:'state',partial:true,collections:selected,label}}));}catch(_e){}
    return true;
  }catch(error){
    _persistLastError='Kısmi IndexedDB yazımı başarısız: '+String(error?.message||error);
    console.error(_persistLastError,error);return false;
  }
}
if(typeof globalThis!=='undefined')globalThis.tkpPersistCollections=tkpPersistCollections;
// Genel UI/performance cache anahtarı tam prediction_log hash'ini zorla istememeli.
// Tam içerik imzası yan-bahis motorunun kendi doğruluk kapısıdır; kupon/tahmin gibi
// alakasız kritik yollarda son doğrulanmış imza veya O(1) geçici revizyon kullanılır.
function sideBetPredictionLogFastRevisionSignature(sourceDb=db){
  const rows=Array.isArray(sourceDb?.prediction_log)?sourceDb.prediction_log:[];
  if(sourceDb===db && _sideBetSignatureCache.revision===_tkpDbRevision
    && _sideBetSignatureCache.epoch===_sideBetSignatureEpoch
    && _sideBetSignatureCache.rows===rows && _sideBetSignatureCache.length===rows.length
    && _sideBetSignatureCache.value){
    return _sideBetSignatureCache.value;
  }
  const persisted=String(sourceDb?.learning_state?.sidebet_prediction_signature||'');
  const persistedCount=Number(sourceDb?.learning_state?.sidebet_prediction_signature_count);
  if(persisted&&persistedCount===rows.length)return persisted;
  return `SIDE_FAST:${rows.length}:${sourceDb===db?Number(_tkpDbRevision)||0:0}:${sourceDb===db?Number(_sideBetSignatureEpoch)||0:0}`;
}
if(typeof globalThis!=='undefined')globalThis.sideBetPredictionLogFastRevisionSignature=sideBetPredictionLogFastRevisionSignature;

function sideBetPredictionLogRevisionSignature(sourceDb=db){
  const steps=sideBetPredictionLogRevisionSignatureSteps(sourceDb);let step;
  do{step=steps.next();}while(!step.done);
  return step.value;
}
async function sideBetPredictionLogRevisionSignatureAsync(sourceDb=db){
  return tkpDrainSignatureSteps(sideBetPredictionLogRevisionSignatureSteps(sourceDb));
}
function* sideBetPredictionLogRevisionSignatureSteps(sourceDb=db){
  const rows=Array.isArray(sourceDb?.prediction_log)?sourceDb.prediction_log:[];
  if(sourceDb===db && _sideBetSignatureCache.revision===_tkpDbRevision
    && _sideBetSignatureCache.epoch===_sideBetSignatureEpoch
    && _sideBetSignatureCache.rows===rows && _sideBetSignatureCache.length===rows.length){
    return _sideBetSignatureCache.value;
  }
  // Doğrulanmış R15.4 arşiv yedeği tam prediction_log hash'ini metadata içinde
  // taşır. İlk yan-bahis panelinde 33.805 satırı tekrar senkron hashlemek gereksizdir.
  // Yalnız hiç invalidasyon olmamış ilk yüklemede ve V2 integrity marker'ı varken
  // güvenilir; herhangi bir canlı değişiklik epoch'u artırınca normal tam hash yolu çalışır.
  const persisted=String(sourceDb?.learning_state?.sidebet_prediction_signature||'');
  const persistedCount=Number(sourceDb?.learning_state?.sidebet_prediction_signature_count);
  if(sourceDb===db && _sideBetSignatureEpoch===0 && !_sideBetSignatureCache.value
    && Number(sourceDb?._tkp_result_integrity_repair_v2)===1
    && persisted && persistedCount===rows.length){
    _sideBetSignatureCache={revision:_tkpDbRevision,epoch:_sideBetSignatureEpoch,rows,length:rows.length,value:persisted};
    return persisted;
  }
  let hash=2166136261>>>0, resolved=0;
  const mix=value=>{
    const s=String(value??'');
    for(let i=0;i<s.length;i++){ hash^=s.charCodeAt(i); hash=Math.imul(hash,16777619)>>>0; }
    hash^=124; hash=Math.imul(hash,16777619)>>>0;
  };
  for(const row of rows){
    yield;
    if(Number(row?.resolved)!==1 && !(Number(row?.finish_position)>=1)) continue;
    resolved++;
    mix(row.prediction_fp); mix(row.race_date); mix(row.hippodrome); mix(row.leg);
    mix(row.horse_no); mix(row.finish_position); mix(row.winner); mix(row.strategy_version);
    for(let p=1;p<=5;p++) mix(row['sidebet_rank_p'+p]);
    mix(row.resolved_at);
  }
  const value=`${rows.length}:${resolved}:${(hash>>>0).toString(36)}`;
  if(sourceDb===db){
    _sideBetSignatureCache={revision:_tkpDbRevision,epoch:_sideBetSignatureEpoch,rows,length:rows.length,value};
    if(db){
      db.learning_state=db.learning_state&&typeof db.learning_state==='object'?db.learning_state:{};
      const changed=String(db.learning_state.sidebet_prediction_signature||'')!==value
        ||Number(db.learning_state.sidebet_prediction_signature_count)!==rows.length;
      db.learning_state.sidebet_prediction_signature=value;
      db.learning_state.sidebet_prediction_signature_count=rows.length;
      if(changed&&((db?.files||[]).length||(db?.races||[]).length)){
        tkpPersistDerivedSignatureMetaSoon({sidebet_prediction_signature:value,sidebet_prediction_signature_count:rows.length});
      }
    }
  }
  return value;
}

function tkpStoredDbBytes(){ return Number(_tkpSerializedBytes)||0; }

function persistenceStatus(){
  const segmented=(typeof globalThis!=='undefined'&&globalThis.TKPSegmentedIDB&&typeof globalThis.TKPSegmentedIDB.status==='function')
    ?globalThis.TKPSegmentedIDB.status():null;
  return {
    mode:segmented?.verified?segmented.mode:persistMode,
    verified:Boolean(segmented?.verified||_persistVerified),
    error:_persistLastError||segmented?.error||'',
    readOnly:_persistReadOnly,
    engine:segmented?.verified?'segmented-idb-v2':'legacy',
    generation:segmented?.generation||'',
    bytes:Number(segmented?.bytes)||Number(_tkpSerializedBytes)||0,
    records:Number(segmented?.records)||0,
    chunks:Number(segmented?.chunks)||0,
    safeMode:Boolean(segmented?.safeMode||db?.__segmented_storage?.safeMode),
    loadedRecords:Number(db?.__segmented_storage?.loadedRecords)||Number(segmented?.records)||0,
    coldRecords:Number(db?.__segmented_storage?.coldRecords)||0,
    maxMaterializedRecords:Number(db?.__segmented_storage?.maxMaterializedRecords)||0
  };
}

function _segmentedStorageApi(){
  return (typeof globalThis!=='undefined'&&globalThis.TKPSegmentedIDB)?globalThis.TKPSegmentedIDB:null;
}
async function _saveSegmentedSnapshot(sourceDb,label='normal'){
  const api=_segmentedStorageApi();
  if(!api||typeof api.saveDb!=='function') return null;
  const result=await api.saveDb(sourceDb,{
    maxRecords:50000,
    // 300+ MB gerçek yedekte 2 MB'lık tek parça structured-clone işlemi bile
    // görünür UI duraklaması oluşturabiliyor. 512 KB parçalar worker yazımını
    // hızlı tutarken açılış/geri çağırma sırasında kısa olay-kuyruğu dilimleri verir.
    targetBytes:512*1024,
    writeBatch:8,
    timeoutMs:300000
  });
  if(!result?.ok) throw new Error('Parçalı IndexedDB yazımı doğrulanamadı.');
  persistMode='indexeddb-segmented';
  _persistVerified=true;
  _persistLastError='';
  _tkpSerializedBytes=Number(result?.stats?.bytes)||0;
  return result;
}
async function tkpCreateStorageCheckpoint(label='manual'){
  const api=_segmentedStorageApi();
  if(api&&typeof api.createCheckpoint==='function') return api.createCheckpoint(label);
  return false;
}
async function tkpRestoreStorageCheckpoint(key,{render=true}={}){
  const api=_segmentedStorageApi();
  if(!api||typeof api.restoreCheckpoint!=='function') throw new Error('Checkpoint geri alma motoru hazır değil.');
  const restored=await api.restoreCheckpoint(key,{timeoutMs:300000});
  if(!restored?.ok||!restored.db) throw new Error('Checkpoint geri alınamadı.');
  setDb(restored.db,true);
  invalidateActiveRacesCache();
  invalidateProfileMatchCache();
  invalidateWinnerProfileCache();
  invalidateConditionStatsCache();
  invalidateAdaptiveLearningCache();
  invalidateSideBetCache();
  if(render&&typeof renderAll==='function') renderAll();
  try{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('tkp:db-changed',{detail:{rollback:true,checkpoint:String(key)}}));}catch(_e){}
  return true;
}
async function tkpLoadPersistedCollectionPage(name,options={}){
  const api=_segmentedStorageApi();
  if(!api||typeof api.loadCollectionPage!=='function') return {rows:[],total:0,hasMore:false};
  return api.loadCollectionPage(name,options);
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpCreateStorageCheckpoint=tkpCreateStorageCheckpoint;
  globalThis.tkpRestoreStorageCheckpoint=tkpRestoreStorageCheckpoint;
  globalThis.tkpLoadPersistedCollectionPage=tkpLoadPersistedCollectionPage;
}

function _meetingUid(file){
  const date=String(file?.race_date||'').trim();
  const hip=String(file?.hippodrome||'').trim().toLocaleUpperCase('tr-TR');
  const session=Number(file?.altili_no)||Number(file?.sequence_no)||0;
  const fingerprint=String(file?.fingerprint||file?.source_signature||'').slice(0,16);
  return ['TKP',date,hip,session,fingerprint].join('|');
}

const _LEGACY_SECOND_ALTI_HIPS=new Set(['ADANA','ANKARA','ANTALYA','BURSA','DİYARBAKIR','ELAZIĞ','İSTANBUL','İZMİR','KOCAELİ','ŞANLIURFA']);
function _legacySecondAltiInfo(value){
  const raw=String(value||'').trim().toLocaleUpperCase('tr-TR');
  if(!raw.endsWith('2')) return null;
  const base=raw.slice(0,-1).trim();
  return _LEGACY_SECOND_ALTI_HIPS.has(base)?{base,altiliNo:2}:null;
}
function _normalizeLegacySecondAlti(out,sourceVersion){
  if(sourceVersion>=6) return {files:0,races:0,logs:0};
  const fileMap=new Map(), legacyKeys=new Map();
  let fileCount=0,raceCount=0,logCount=0;
  for(const file of (out.files||[])){
    const info=_legacySecondAltiInfo(file?.hippodrome);
    if(!info) { fileMap.set(String(file?.id),file); continue; }
    const oldHip=String(file.hippodrome||'');
    file.hippodrome=info.base;
    file.altili_no=2;
    file.altili_count=Math.max(2,Number(file.altili_count)||0);
    if(/2\.ods$/i.test(String(file.filename||''))) file.filename=String(file.filename).replace(/2\.ods$/i,'-2ALT.ods');
    file.meeting_uid=_meetingUid(file);
    legacyKeys.set(`${String(file.race_date||'')}|${oldHip}`,{hip:info.base,altiliNo:2,meetingUid:file.meeting_uid,fileId:file.id});
    fileMap.set(String(file?.id),file); fileCount++;
  }
  for(const race of (out.races||[])){
    const linked=fileMap.get(String(race?.file_id));
    const direct=_legacySecondAltiInfo(race?.hippodrome);
    if(linked && Number(linked.altili_no)===2 && _LEGACY_SECOND_ALTI_HIPS.has(String(linked.hippodrome||''))){
      race.hippodrome=linked.hippodrome; race.altili_no=2; race.meeting_uid=linked.meeting_uid;
    }else if(direct){
      race.hippodrome=direct.base; race.altili_no=2; race.meeting_uid=_meetingUid({...race,altili_no:2});
    }else continue;
    const absolute=Number(race._absRaceNo)||Number(race.race_no)||Number(race.leg)||0;
    const horses=(race.horses||[]).map(h=>String(h?.horse_no||'')).filter(Boolean).sort((a,b)=>TKP_TR_COLLATOR_NUM.compare(a,b)).join(',');
    race.race_uid=[race.meeting_uid,absolute,tkpHashString(horses)].join('|'); raceCount++;
  }
  for(const key of ['prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','surprise_cohort_tracking_log','bets']) for(const row of (out[key]||[])){
    const linked=fileMap.get(String(row?.file_id));
    const direct=_legacySecondAltiInfo(row?.hippodrome);
    const legacy=legacyKeys.get(`${String(row?.race_date||'')}|${String(row?.hippodrome||'')}`);
    const target=(linked&&Number(linked.altili_no)===2)?{hip:linked.hippodrome,altiliNo:2,meetingUid:linked.meeting_uid}:legacy||(direct?{hip:direct.base,altiliNo:2,meetingUid:''}:null);
    if(!target) continue;
    row.hippodrome=target.hip; row.altili_no=2;
    if(Object.prototype.hasOwnProperty.call(row,'meeting_uid')||target.meetingUid) row.meeting_uid=target.meetingUid||_meetingUid({...row,altili_no:2});
    logCount++;
  }
  if(fileCount||raceCount||logCount){
    out.changelog.push({ts:new Date().toISOString(),type:'MIGRATION',message:`2. Altılı canonical migration: ${fileCount} toplantı, ${raceCount} koşu ve ${logCount} bağlı kayıt normalize edildi.`});
    _dbMigrationDirty=true;
  }
  return {files:fileCount,races:raceCount,logs:logCount};
}

const _X_OVERLAY_FIELDS=[
  'x_base_ypuan','x_base_score','x_base_rank','x_ypuan_delta','x_tkp_score_delta',
  'x_final_ypuan','x_final_tkp_score','x_final_rank','x_kulis_score',
  'x_kulis_direction','x_kulis_comments','x_kulis_single_candidate','x_kulis_applied','x_force_coupon','x_break_single',
  'x_kulis_schema_version','x_kulis_captured_at','x_kulis_race_start_at','x_kulis_training_eligible','x_kulis_provenance'
];
function _istanbulIsoDate(ms){
  return Number.isFinite(ms)?new Date(ms+3*60*60_000).toISOString().slice(0,10):'';
}
function _xTimeProofIsSafe(schema,capturedAt,raceStartAt,raceDate=''){
  const captured=Date.parse(String(capturedAt||'')),cutoff=Date.parse(String(raceStartAt||''));
  if(Number(schema)<3||!Number.isFinite(captured)||!Number.isFinite(cutoff))return false;
  if(captured>=cutoff||captured<cutoff-36*60*60_000)return false;
  return !raceDate||_istanbulIsoDate(cutoff)===String(raceDate).slice(0,10);
}
function sanitizeLegacyXKulis(out,options={}){
  const settings=out.settings=out.settings||{};
  const force=options.full===true||['restore','legacy-migration','bootstrap'].includes(String(options.mode||''));
  // Temiz yerel açılışta bu işaret sadece marker/files/races uzunluklarını okur.
  // Böylece X alanı hiç bulunmayan milyonlarca atı tek tek dolaşmayız. Dış yedek
  // veya eski şema ise her zaman aşağıdaki tam zaman-kanıtı denetiminden geçer.
  if(!force&&tkpXKulisMigrationIsValid(out)) return {restored:0,cleared:0,mode:'noop'};
  let restored=0,cleared=0;
  for(const race of (out.races||[]))for(const horse of (race?.horses||[])){
    if(!horse||!_X_OVERLAY_FIELDS.some(key=>Object.prototype.hasOwnProperty.call(horse,key)))continue;
    const safe=_xTimeProofIsSafe(horse.x_kulis_schema_version,horse.x_kulis_captured_at,horse.x_kulis_race_start_at,race?.race_date);
    // Shadow X tahmine uygulanmaz; yalnız /+puan olarak görüntülenir. Zaman kanıtı eksik
    // olsa bile açılışta silmek kullanıcıya tarama sonucunu kaybettiriyordu. Shadow alanı
    // korunur, fakat kupona/TEK'e etki edebilecek bayraklar kesin false tutulur.
    if(!safe&&horse.x_kulis_applied===false){
      horse.x_kulis_applied=false;horse.x_force_coupon=false;horse.x_break_single=false;
      continue;
    }
    if(safe)continue;
    if(horse.x_base_ypuan!==null&&horse.x_base_ypuan!==''&&Number.isFinite(Number(horse.x_base_ypuan))){horse.ypuan=Number(horse.x_base_ypuan);restored++;}
    if(horse.x_base_score!==null&&horse.x_base_score!==''&&Number.isFinite(Number(horse.x_base_score)))horse.score=Number(horse.x_base_score);
    for(const key of _X_OVERLAY_FIELDS)delete horse[key];
    delete horse.altili_winner_score;delete horse._altili_winner_model_signature;
    cleared++;
  }
  const last=settings.x_kulis_last;
  if(last&&!_xTimeProofIsSafe(last.schemaVersion,last.capturedAt,last.raceStartAt,last.date)){
    if(String(last.mode||'').toLowerCase()==='shadow'){
      last.mode='shadow';
    }else{
      settings.x_kulis_legacy_quarantine={schemaVersion:Number(last.schemaVersion)||0,capturedAt:String(last.capturedAt||''),date:String(last.date||''),hippodrome:String(last.hippodrome||''),mode:String(last.mode||''),postCount:Array.isArray(last.posts)?last.posts.length:0,resultCount:Array.isArray(last.results)?last.results.length:0,reason:'Yarış başlangıcı öncesi alındığı şema-3 zaman kanıtıyla doğrulanamadı.'};
      delete settings.x_kulis_last;cleared++;
    }
  }
  if((Number(settings.x_kulis_learning_schema)||0)<2){
    const legacy=settings.x_kulis_source_stats&&typeof settings.x_kulis_source_stats==='object'?settings.x_kulis_source_stats:{};
    const summary={};for(const [handle,row] of Object.entries(legacy))summary[handle]={total:Number(row?.total)||0,correct:Number(row?.correct)||0};
    if(Object.keys(summary).length)settings.x_kulis_legacy_source_stats_quarantine=summary;
    settings.x_kulis_source_stats={};settings.x_kulis_learned_keys={};settings.x_kulis_learning_schema=2;cleared++;
  }
  if(cleared||!settings.x_kulis_time_lock_migrated_v1154){
    settings.x_kulis_time_lock_migrated_v1154=settings.x_kulis_time_lock_migrated_v1154||new Date().toISOString();
    out.changelog.push({ts:new Date().toISOString(),type:'MIGRATION',message:`X zaman kilidi: ${cleared} güvensiz eski katman temizlendi, ${restored} Y.PUAN temel değerine döndürüldü.`});
    _dbMigrationDirty=true;
  }
  tkpMarkXKulisMigrationClean(out);
  return {restored,cleared,mode:'full'};
}

// V4 SON AGF / FIX2 — TÜM ESKİ ARŞİV İÇİN GÖRÜNÜR TKP GERİ DÖNÜK ONARIMI.
// Bu migrasyon yalnız ekranı değil kalıcı db.races kayıtlarını normalize eder; dolayısıyla
// eski gün, JSON yedeği ve .tkpbak geri yüklemesi de aynı tek visible/frozen TKP kaynağına gelir.
// Tarihsel görünür TKP kesin olarak yeniden kurulabiliyorsa snapshot'a yazar; kanıt bulunamazsa
// tahmin uydurmaz ve mevcut tarihsel değeri zorla ezmez.
function _migrateAllOldVisibleTkp(out,options={}){
  const settings=out.settings=out.settings||{};
  const MIG='VISIBLE_TKP_ALL_OLD_DATA_V2_2026_08_30';
  const force=options.full===true||['restore','legacy-migration','bootstrap'].includes(String(options.mode||''));
  if(!force&&tkpVisibleTkpMigrationIsValid(out)) return {changed:0,repaired:0,unresolved:0,mode:'noop'};
  let changed=0,repaired=0,unresolved=0,locked=0;
  const round2=v=>Math.round((Number(v)||0)*100)/100;
  const scale=raw=>round2(Math.max(0,Math.min(10,Number(raw)/3)));
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for(const race of (out.races||[])) for(const h of (race?.horses||[])){
    if(!h || Number(h.prediction_score_locked)!==1 || h.prediction_score_snapshot===null||h.prediction_score_snapshot===undefined||h.prediction_score_snapshot===''||!Number.isFinite(Number(h.prediction_score_snapshot))) continue;
    locked++;
    let localChanged=false;
    // Kilitli geçmiş yarışta skor/parts daima PRE-RACE snapshot'tan okunur.
    const snapScore=Number(h.prediction_score_snapshot);
    if(Number(h.score)!==snapScore){h.score=snapScore;localChanged=true;}
    if(h.prediction_score_parts_snapshot && typeof h.prediction_score_parts_snapshot==='object'){
      const parts=JSON.parse(JSON.stringify(h.prediction_score_parts_snapshot));
      if(!same(h.scoreParts,parts)){h.scoreParts=parts;localChanged=true;}
    }
    if(Array.isArray(h.prediction_why_snapshot)){
      const why=h.prediction_why_snapshot.slice();
      if(!same(h.why,why)){h.why=why;localChanged=true;}
    }
    if(h.prediction_best_lb_snapshot!==undefined && h.bestLb!==h.prediction_best_lb_snapshot){h.bestLb=h.prediction_best_lb_snapshot;localChanged=true;}

    const positive=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):NaN;
    let raw=positive(h.prediction_tkp_display_raw_snapshot);
    if(!Number.isFinite(raw))raw=positive(h.prediction_visible_tkp_raw_snapshot);
    // Bazı ara sürümler yalnız gösterilen snapshot'ı sakladı. DIV3 etiketi varsa ham değeri güvenle geri kur.
    let shownSnap=positive(h.prediction_tkp_display_score_snapshot);
    let shownVersion=String(h.prediction_tkp_display_scale_snapshot||'');
    if(!Number.isFinite(shownSnap)){shownSnap=positive(h.prediction_visible_tkp_snapshot);shownVersion=String(h.prediction_visible_tkp_scale_version||'');}
    if(!Number.isFinite(raw) && Number.isFinite(shownSnap) &&
       shownVersion==='DIV3_MAX10_V1'){
      raw=round2(shownSnap*3);
    }
    // V33 frozen snapshot'ta common katkısı varsa tarihsel görünür TKP exact geri kurulur.
    if(!Number.isFinite(raw)){
      try{ if(typeof tkpFrozenVisibleRawFromPredictionSnapshot==='function'){ const rebuilt=tkpFrozenVisibleRawFromPredictionSnapshot(h); raw=(rebuilt===null||rebuilt===undefined)?NaN:Number(rebuilt); } }catch(_e){}
    }
    if(!Number.isFinite(raw)){
      const commonValue=h.prediction_score_parts_snapshot?.common;
      const common=(commonValue===null||commonValue===undefined||commonValue==='')?NaN:Number(commonValue), total=Number(h.prediction_score_snapshot);
      if(Number.isFinite(common)&&common>=0&&Number.isFinite(total)){
        const commonEvidence=common/0.65, legacy=(total-common)/0.35;
        if(Number.isFinite(commonEvidence)&&Number.isFinite(legacy)&&legacy>=0) raw=round2(commonEvidence*10+legacy);
      }
    }
    if(Number.isFinite(raw) && raw>=0){
      raw=round2(raw); const shown=scale(raw);
      const writes={
        prediction_tkp_display_raw_snapshot:raw,
        prediction_tkp_display_score_snapshot:shown,
        prediction_tkp_display_scale_snapshot:'DIV3_MAX10_V1',
        prediction_visible_tkp_raw_snapshot:raw,
        prediction_visible_tkp_snapshot:shown,
        prediction_visible_tkp_scale_version:'DIV3_MAX10_V1',
        tkp_display_raw_score:raw,
        tkp_display_score:shown,
        tkp_display_scale_version:'DIV3_MAX10_V1'
      };
      for(const [k,v] of Object.entries(writes)) if(h[k]!==v){h[k]=v;localChanged=true;}
      repaired++;
    }else{
      // Kanıt yoksa bugünkü veriyle geçmişe yeni TKP üretmek leakage olur. Tek-kaynak render
      // yine tüm ekranları aynı değerde tutar; exact frozen değer ancak mevcut kanıttan kurulabiliyorsa yazılır.
      unresolved++;
    }
    if(localChanged){changed++;}
  }
  settings.visible_tkp_all_old_data_migration=MIG;
  settings.visible_tkp_all_old_data_migration_at=new Date().toISOString();
  settings.visible_tkp_all_old_data_stats={locked,repaired,unresolved,changed};
  if(changed||locked){
    out.changelog=Array.isArray(out.changelog)?out.changelog:[];
    out.changelog.push({ts:new Date().toISOString(),type:'MIGRATION',message:`Eski arşiv visible/frozen TKP onarımı: ${locked} kilitli at kontrol edildi, ${repaired} exact onarıldı, ${unresolved} tarihsel kanıt bulunmayan kayıt korunarak bırakıldı.`});
    _dbMigrationDirty=true;
  }
  tkpMarkVisibleTkpMigrationClean(out);
  return {changed,repaired,unresolved,locked,mode:'full'};
}

// V1.1.237 — KRONOLOJİK DOSYA NO KİLİDİ
// Tek doğruluk kuralı: sequence_no yarış tarihinin kronolojik sırasıdır.
// 1 = en eski toplantı, N = en yeni toplantı. Eski/yükleme sırası raw_sequence_no'da
// korunur; böylece geriye dönük dosya sonradan yüklense bile 503 gibi büyük bir No
// yanlışlıkla eski bir tarihe bağlı kalmaz. Aynı tarihli toplantılarda ham/yükleme
// sırası yalnız tie-break olarak kullanılır.
//
// Önemli performans sınırı: tam yeniden sıralama dosyaları, yarışları VE bağlı
// günlükleri tarar. Bu nedenle yalnız geri tarihli ekleme, tarih düzeltmesi,
// silme, geri yükleme veya eski/bozuk bir kilit için çağrılır. Temiz veritabanına
// en yeni toplantı eklendiğinde yalnız yeni dosya ve ona bağlı yeni yarışlar
// güncellenir; geçmiş loglara kesinlikle dokunulmaz.
function _tkpChronologyIsIso(v){ return /^\d{4}-\d{2}-\d{2}$/.test(String(v||'')); }
function _tkpChronologyRawOrder(f){
  const raw=Number(f?.raw_sequence_no);
  if(Number.isFinite(raw)&&raw>0)return raw;
  const seq=Number(f?.sequence_no);
  return Number.isFinite(seq)&&seq>0?seq:Number.MAX_SAFE_INTEGER;
}
function _tkpCompareChronologyFiles(a,b){
  const da=String(a?.race_date||''), dbv=String(b?.race_date||'');
  const av=_tkpChronologyIsIso(da), bv=_tkpChronologyIsIso(dbv);
  if(av&&bv&&da!==dbv)return da<dbv?-1:1; // en eski -> en yeni
  if(av!==bv)return av?-1:1;              // tarihsiz/bozuk kayıtlar en sona
  return _tkpChronologyRawOrder(a)-_tkpChronologyRawOrder(b)
    || (Number(a?.altili_no)||1)-(Number(b?.altili_no)||1)
    || (Number(a?.id)||0)-(Number(b?.id)||0);
}
function _tkpChronologyEndpoint(f){
  return {
    id:String(f?.id??''),
    race_date:String(f?.race_date||''),
    raw_sequence_no:Number(f?.raw_sequence_no)||0,
    sequence_no:Number(f?.sequence_no)||0,
    altili_no:Number(f?.altili_no)||1
  };
}
function _tkpChronologyEndpointAsFile(v){
  return {id:v?.id,race_date:v?.race_date,raw_sequence_no:v?.raw_sequence_no,sequence_no:v?.sequence_no,altili_no:v?.altili_no};
}
function _tkpChronologyEndpointSignature(v){
  return [String(v?.id||''),String(v?.race_date||''),Number(v?.raw_sequence_no)||0,Number(v?.sequence_no)||0,Number(v?.altili_no)||1].join('~');
}
function _tkpChronologyLockSignature(lock){
  return [
    `v${Number(lock?.version)||0}`,
    `n${Number(lock?.file_count)||0}`,
    `s${Number(lock?.sequence_max)||0}`,
    `i${Number(lock?.max_file_id)||0}`,
    String(lock?.sort_policy||''),
    _tkpChronologyEndpointSignature(lock?.oldest),
    _tkpChronologyEndpointSignature(lock?.newest)
  ].join('|');
}
function _tkpBuildChronologyLock(fileCount,oldest,newest,maxFileId){
  const lock={
    version:TKP_CHRONOLOGY_LOCK_VERSION,
    file_count:Number(fileCount)||0,
    sequence_max:Number(fileCount)||0,
    max_file_id:Number(maxFileId)||0,
    sort_policy:TKP_CHRONOLOGY_SORT_POLICY,
    oldest:_tkpChronologyEndpoint(oldest),
    newest:_tkpChronologyEndpoint(newest)
  };
  lock.order_signature=_tkpChronologyLockSignature(lock);
  return lock;
}
function _tkpChronologyLocksEqual(a,b){
  if(!a||!b)return false;
  return Number(a.version)===Number(b.version)
    && Number(a.file_count)===Number(b.file_count)
    && Number(a.sequence_max)===Number(b.sequence_max)
    && Number(a.max_file_id)===Number(b.max_file_id)
    && String(a.sort_policy||'')===String(b.sort_policy||'')
    && String(a.order_signature||'')===String(b.order_signature||'');
}
function tkpChronologyLockIsValid(target,options={}){
  const out=target&&typeof target==='object'?target:db;
  const files=Array.isArray(out?.files)?out.files:[];
  const expected=Number.isFinite(Number(options.expectedFileCount)) ? Number(options.expectedFileCount) : files.length;
  const lock=out?.chronology_lock;
  if(!lock || Number(lock.version)!==TKP_CHRONOLOGY_LOCK_VERSION) return false;
  if(Number(lock.file_count)!==expected || Number(lock.sequence_max)!==expected) return false;
  if(String(lock.sort_policy||'')!==TKP_CHRONOLOGY_SORT_POLICY) return false;
  if(!lock.oldest || !lock.newest) return expected===0 && String(lock.order_signature||'')===_tkpChronologyLockSignature(lock);
  return String(lock.order_signature||'')===_tkpChronologyLockSignature(lock);
}

// ---- Açılış hijyeni için O(1) kalıcı işaretler ---------------------------------
// Bu imza özellikle içerik hash'i değildir: temiz uygulama verisinde değişmeyen
// koleksiyon sayıları + zaten doğrulanmış kronoloji kilidi yeterli bir sıcak-yol
// sözleşmesidir. Haricî yedek, şema yükseltmesi ve düzeltme yolları `full:true`
// vererek bu işareti bilerek yok sayar.
function _tkpStartupHygieneBaseline(out){
  const files=Array.isArray(out?.files)?out.files:[];
  const races=Array.isArray(out?.races)?out.races:[];
  return {
    file_count:files.length,
    race_count:races.length,
    chronology_signature:String(out?.chronology_lock?.order_signature||''),
    // Dosya/race sayısı değişmeden yapılan tarih-pist düzeltmesi de önceki
    // temizleme sonucunu geçersiz kılar. Epoch yalnız bilinçli tam düzeltme /
    // geri yükleme yolunda artar; sıcak açılışta O(1) okunur.
    hygiene_epoch:Number(out?.migration_state?.hygiene_epoch)||0
  };
}
function _tkpStartupHygieneState(out){
  if(!out || typeof out!=='object') return {};
  if(!out.migration_state || typeof out.migration_state!=='object' || Array.isArray(out.migration_state)) out.migration_state={};
  return out.migration_state;
}
function tkpStartupHygieneMarkerIsValid(target,key,version=TKP_STARTUP_HYGIENE_MARKER_VERSION){
  const out=target&&typeof target==='object'?target:db;
  const marker=out?.migration_state?.[key];
  if(!marker || Number(marker.version)!==Number(version)) return false;
  if(!tkpChronologyLockIsValid(out)) return false;
  const expected=_tkpStartupHygieneBaseline(out);
  return Number(marker.file_count)===expected.file_count
    && Number(marker.race_count)===expected.race_count
    && String(marker.chronology_signature||'')===expected.chronology_signature
    && (Number(marker.hygiene_epoch)||0)===expected.hygiene_epoch;
}
function tkpMarkStartupHygieneClean(target,key,version=TKP_STARTUP_HYGIENE_MARKER_VERSION){
  const out=target&&typeof target==='object'?target:db;
  if(!out || typeof out!=='object') return null;
  const baseline=_tkpStartupHygieneBaseline(out);
  const marker={version:Number(version)||TKP_STARTUP_HYGIENE_MARKER_VERSION,...baseline,marked_at:new Date().toISOString()};
  const state=_tkpStartupHygieneState(out), previous=state[key];
  state[key]=marker;
  // Yeni bir hijyen mühürü kalıcılaştırılmazsa sonraki açılış yine tüm arşivi
  // tarar. Zaman damgasını karşılaştırma dışı bırakıyoruz; aynı marker'a tekrar
  // yazmak gereksiz büyük snapshot kaydı başlatmasın.
  if(!previous
    ||Number(previous.version)!==Number(marker.version)
    ||Number(previous.file_count)!==Number(marker.file_count)
    ||Number(previous.race_count)!==Number(marker.race_count)
    ||String(previous.chronology_signature||'')!==String(marker.chronology_signature||'')
    ||Number(previous.hygiene_epoch)!==Number(marker.hygiene_epoch)) _dbMigrationDirty=true;
  return marker;
}
function tkpBumpStartupHygieneEpoch(target){
  const out=target&&typeof target==='object'?target:db;
  if(!out || typeof out!=='object') return 0;
  const state=_tkpStartupHygieneState(out);
  state.hygiene_epoch=(Number(state.hygiene_epoch)||0)+1;
  _dbMigrationDirty=true;
  return state.hygiene_epoch;
}
function tkpRestoreRequiresFullHygiene(target){
  const flag=target?.migration_state?.restore_requires_full_hygiene_v2;
  return !!flag && Number(flag.version)>=2;
}
function tkpCanDeferLargeWorkerRestoreHygiene(target,sourceVersion=Number(target?.schema_version)||0){
  const flag=target?.migration_state?.restore_requires_full_hygiene_v2;
  const files=Array.isArray(target?.files)?target.files.length:0;
  const races=Array.isArray(target?.races)?target.races.length:0;
  // Yalnız kendi arka-plan aktarım worker'ımızın, güncel şemalı ve gerçekten büyük
  // arşivleri için geçerlidir. Küçük/eski/haricî veri fail-closed tam restore yolunda
  // kalır. 503 dosya / 3.018 koşu bu korumanın doğrudan hedefidir.
  return Boolean(flag)
    && Number(flag.version)>=2
    && String(flag.source||'')==='backup-import-worker'
    && Number(sourceVersion)>=DB_SCHEMA_VERSION
    && (files>=100 || races>=600);
}
function tkpMarkRestoreHygieneDeferred(target){
  const files=Array.isArray(target?.files)?target.files.length:0;
  const races=Array.isArray(target?.races)?target.races.length:0;
  const info={
    state:'DEFERRED_UNTIL_EXPLICIT_SAVE',
    files,races,
    reason:'Büyük worker geri yüklemesinde açılış sonrası ikinci tam arşiv yazımı kapalı.',
    at:new Date().toISOString()
  };
  try{ if(typeof globalThis!=='undefined') globalThis.__tkpRestoreHygieneDeferred=info; }catch(_e){}
  return info;
}
function tkpCompleteRestoreHygiene(target){
  const out=target&&typeof target==='object'?target:db;
  if(!tkpRestoreRequiresFullHygiene(out)) return false;
  delete out.migration_state.restore_requires_full_hygiene_v2;
  _dbMigrationDirty=true;
  return true;
}
function tkpIdentityMigrationIsValid(target){ return tkpStartupHygieneMarkerIsValid(target,'identity_v1'); }
function tkpXKulisMigrationIsValid(target){ return tkpStartupHygieneMarkerIsValid(target,'x_kulis_time_lock_v3'); }
function tkpVisibleTkpMigrationIsValid(target){ return tkpStartupHygieneMarkerIsValid(target,'visible_tkp_frozen_v2'); }
function tkpMarkIdentityMigrationClean(target){ return tkpMarkStartupHygieneClean(target,'identity_v1'); }
function tkpMarkXKulisMigrationClean(target){ return tkpMarkStartupHygieneClean(target,'x_kulis_time_lock_v3'); }
function tkpMarkVisibleTkpMigrationClean(target){ return tkpMarkStartupHygieneClean(target,'visible_tkp_frozen_v2'); }

function _tkpRaceIdentityFor(row,meetingUid){
  const absolute=Number(row?._absRaceNo)||Number(row?.race_no)||Number(row?.leg)||0;
  const horses=(row?.horses||[]).map(h=>String(h?.horse_no||'')).filter(Boolean).sort((a,b)=>TKP_TR_COLLATOR_NUM.compare(a,b)).join(',');
  return [meetingUid,absolute,tkpHashString(horses)].join('|');
}
function _tkpEnsureRaceIdentity(row,file,options={}){
  if(!row || typeof row!=='object') return 0;
  const recompute=options.recompute===true;
  let changed=0;
  const meeting=file?.meeting_uid||row.meeting_uid||_meetingUid(file||row);
  if(recompute ? String(row.meeting_uid||'')!==String(meeting||'') : !row.meeting_uid){ row.meeting_uid=meeting; changed++; }
  const raceUid=_tkpRaceIdentityFor(row,row.meeting_uid||meeting);
  if(recompute ? String(row.race_uid||'')!==raceUid : !row.race_uid){ row.race_uid=raceUid; changed++; }
  return changed;
}
function _tkpRekeyIdentityReferences(out,meetingMap,raceMap){
  if(!meetingMap.size&&!raceMap.size) return 0;
  const seen=new WeakSet();let changed=0;
  const visit=value=>{
    if(!value||typeof value!=='object') return;
    if(seen.has(value)) return;
    seen.add(value);
    if(!Array.isArray(value)){
      const oldMeeting=String(value.meeting_uid||'');
      const oldRace=String(value.race_uid||'');
      if(oldMeeting&&meetingMap.has(oldMeeting)){ value.meeting_uid=meetingMap.get(oldMeeting);changed++; }
      if(oldRace&&raceMap.has(oldRace)){ value.race_uid=raceMap.get(oldRace);changed++; }
    }
    for(const child of Object.values(value)) visit(child);
  };
  for(const key of ['prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','bets','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log']){
    for(const row of (Array.isArray(out?.[key])?out[key]:[])) visit(row);
  }
  return changed;
}
function tkpEnsureRaceIdentityMigration(target,options={}){
  const out=target&&typeof target==='object'?target:db;
  const full=options.full===true;
  if(!full && tkpIdentityMigrationIsValid(out)) return {changed:0,mode:'noop'};
  // Marker yoksa da denetim zaten tam geçiştir: yanlış/eskimiş UID'yi yalnız
  // boş alanı doldurarak bırakmak yerine beklenen kimlikle onarır.
  const recompute=options.recompute===true||full||!tkpIdentityMigrationIsValid(out);
  const filesById=new Map(),meetingMap=new Map(),raceMap=new Map();let changed=0;
  for(const file of (out?.files||[])){
    const oldMeeting=String(file?.meeting_uid||'');
    const expected=_meetingUid(file);
    if(recompute ? oldMeeting!==expected : !oldMeeting){file.meeting_uid=expected;changed++;}
    if(oldMeeting&&oldMeeting!==String(file.meeting_uid||'')) meetingMap.set(oldMeeting,String(file.meeting_uid||''));
    filesById.set(String(file.id),file);
  }
  for(const race of (out?.races||[])){
    const oldRace=String(race?.race_uid||'');
    changed+=_tkpEnsureRaceIdentity(race,filesById.get(String(race?.file_id)),{recompute});
    if(oldRace&&oldRace!==String(race?.race_uid||'')) raceMap.set(oldRace,String(race.race_uid||''));
  }
  changed+=_tkpRekeyIdentityReferences(out,meetingMap,raceMap);
  tkpMarkIdentityMigrationClean(out);
  if(changed)_dbMigrationDirty=true;
  return {changed,mode:'full',recomputed:recompute};
}
function tkpCommitIncomingRaceIdentity(target,file,rows){
  const out=target&&typeof target==='object'?target:db;
  if(!out || !file) return 0;
  let changed=0;
  if(!file.meeting_uid){file.meeting_uid=_meetingUid(file);changed++;}
  for(const row of (Array.isArray(rows)?rows:[])){
    if(String(row?.file_id)!==String(file.id)) continue;
    changed+=_tkpEnsureRaceIdentity(row,file);
  }
  tkpMarkIdentityMigrationClean(out);
  // Yeni yarışlar X ve frozen-TKP katmanı taşımıyorsa, mevcut güvenli eski
  // katmanları tekrar taramaya gerek yoktur. Yeni X/frozen yazan motorlar kendi
  // işleminden sonra aynı marker'ı tekrar mühürler.
  tkpMarkXKulisMigrationClean(out);
  tkpMarkVisibleTkpMigrationClean(out);
  try{ if(typeof globalThis!=='undefined'&&typeof globalThis.tkpMarkBmbHygieneClean==='function')globalThis.tkpMarkBmbHygieneClean(out); }catch(_e){}
  return changed;
}
function _tkpApplyChronologyFileMetadata(file,seq){
  let changed=false,renamed=0,metadataChanged=0;
  const oldSeq=Number(file?.sequence_no)||0;
  if((file.raw_sequence_no===undefined||file.raw_sequence_no===null||file.raw_sequence_no==='')&&oldSeq>0){
    file.raw_sequence_no=oldSeq; changed=true; metadataChanged++;
  }
  if(Number(file.sequence_no)!==seq){ file.sequence_no=seq; changed=true; }
  if(Number(file.archive_date_order)!==seq){ file.archive_date_order=seq; changed=true; metadataChanged++; }
  if(file.sort_policy!==TKP_CHRONOLOGY_SORT_POLICY){ file.sort_policy=TKP_CHRONOLOGY_SORT_POLICY; changed=true; metadataChanged++; }
  let expected='';
  try{
    if(typeof tkpQcOdsFilename==='function') expected=tkpQcOdsFilename(seq,file.hippodrome,file.altili_no,file.altili_count);
  }catch(_e){}
  if(expected&&file.filename!==expected){ file.filename=expected; changed=true; renamed++; }
  return {changed,renamed,metadataChanged,filename:expected||file.filename};
}
function _tkpApplyChronologyLinkedRows(rows,file,seq,filename){
  let linkedRows=0;
  for(const row of (Array.isArray(rows)?rows:[])){
    if(String(row?.file_id)!==String(file?.id)) continue;
    let touched=false;
    if(Number(row.sequence_no)!==seq){ row.sequence_no=seq; touched=true; }
    if(filename&&row.filename!==filename){ row.filename=filename; touched=true; }
    if(touched)linkedRows++;
  }
  return linkedRows;
}
function tkpChronologyNextSequence(target){
  const out=target&&typeof target==='object'?target:db;
  const files=Array.isArray(out?.files)?out.files:[];
  if(tkpChronologyLockIsValid(out)) return files.length+1;
  let max=0;
  for(const f of files) max=Math.max(max,Number(f?.sequence_no)||0);
  return max+1;
}
function tkpChronologyNextFileId(target){
  const out=target&&typeof target==='object'?target:db;
  if(tkpChronologyLockIsValid(out)) return Math.max(0,Number(out?.chronology_lock?.max_file_id)||0)+1;
  let max=0;
  for(const f of (Array.isArray(out?.files)?out.files:[])) max=Math.max(max,Number(f?.id)||0);
  return max+1;
}

// Temiz ve zaten kilitli bir veritabanının açılışında bu kontrol O(1)'dir:
// yalnız kalıcı marker ve files.length okunur; races/log/bets dizilerine girilmez.
function tkpEnsureChronologyLock(target,options={}){
  const out=target&&typeof target==='object'?target:db;
  const reason=String(options.reason||'');
  const full=options.full===true || ['restore','legacy-migration','backward-correction','date-correction','delete'].includes(reason);
  if(!full && tkpChronologyLockIsValid(out)){
    return {changed:false,mode:'noop',resequenced:0,renamed:0,linkedRows:0,total:(out?.files||[]).length,scannedLogCollections:0};
  }
  return tkpResequenceFilesChronologically(out,{...options,full:true,reason:reason||'missing-or-invalid-lock'});
}

// Sadece yeni gelen dosya kronolojik kuyruğun sonundaysa hızlı yol kullanılır.
// Geri tarih/sıra düzeltmesi görüldüğünde güvenli biçimde tam eşlemeye düşer.
function tkpApplyChronologyForIncomingFile(target,file,options={}){
  const out=target&&typeof target==='object'?target:db;
  const files=Array.isArray(out?.files)?out.files:[];
  if(!file || !files.length) return {changed:false,mode:'noop',resequenced:0,renamed:0,linkedRows:0,total:files.length,scannedLogCollections:0};
  const previousFileCount=Number.isFinite(Number(options.previousFileCount))
    ? Number(options.previousFileCount)
    : Math.max(0,files.length-1);
  const reason=String(options.reason||'append');
  if(options.full===true || previousFileCount!==files.length-1){
    return tkpResequenceFilesChronologically(out,{...options,full:true,reason:options.reason||'invalid-append-context'});
  }

  const oldSeq=Number(file.sequence_no)||0;
  if(file.raw_sequence_no===undefined||file.raw_sequence_no===null||file.raw_sequence_no===''){
    file.raw_sequence_no=oldSeq>0?oldSeq:previousFileCount+1;
  }

  if(previousFileCount>0){
    if(!tkpChronologyLockIsValid(out,{expectedFileCount:previousFileCount})
      || _tkpCompareChronologyFiles(file,_tkpChronologyEndpointAsFile(out.chronology_lock.newest))<0){
      return tkpResequenceFilesChronologically(out,{...options,full:true,reason:'backward-correction'});
    }
  }

  const seq=previousFileCount+1;
  const fileUpdate=_tkpApplyChronologyFileMetadata(file,seq);
  const linkedRows=_tkpApplyChronologyLinkedRows(options.linkedRows,file,seq,fileUpdate.filename);
  const oldLock=out.chronology_lock;
  const oldest=previousFileCount>0 ? oldLock.oldest : file;
  const maxFileId=Math.max(previousFileCount>0?(Number(oldLock.max_file_id)||0):0,Number(file.id)||0);
  const nextLock=_tkpBuildChronologyLock(files.length,oldest,file,maxFileId);
  out.chronology_lock=nextLock;
  // Yalnız bu importun altı yarışında UID üret; tüm arşivi açılışta yeniden
  // dolaşmaya gerek kalmasın. Aynı noktada diğer açılış hijyen marker'ları da
  // yeni sayılarına taşınır.
  try{ tkpCommitIncomingRaceIdentity(out,file,options.linkedRows); }catch(_e){}
  const changed=true; // Dosya sayısı/marker her gerçek eklemede değişir.
  if(changed&&options.markDirty!==false) _dbMigrationDirty=true;
  return {changed,mode:'append',resequenced:oldSeq===seq?0:1,renamed:fileUpdate.renamed,linkedRows,total:files.length,oldest:nextLock.oldest.race_date||'',newest:nextLock.newest.race_date||'',scannedLogCollections:0};
}

// Tam yol: yalnız açık nedenlerle çağrılır. Bu fonksiyon bağlı geçmiş/snapshot
// satırlarını da günceller; aksi halde eski sequence_no kopyaları bırakılmaz.
function tkpResequenceFilesChronologically(target, options={}){
  const out=target&&typeof target==='object'?target:db;
  const files=Array.isArray(out?.files)?out.files:[];
  const races=Array.isArray(out?.races)?out.races:[];
  if(!files.length){
    const nextLock=_tkpBuildChronologyLock(0,{}, {},0);
    const markerChanged=!_tkpChronologyLocksEqual(out?.chronology_lock,nextLock);
    if(out) out.chronology_lock=nextLock;
    // Silme/geri yükleme/düzeltme sonrası önceki kapsam mühürleri aynı sayıda
    // kayıt kalsa dahi güvenilir değildir. Bir sonraki normal açılışta yalnız
    // marker farkı tam hijyen yolunu çalıştırır.
    const epoch=tkpBumpStartupHygieneEpoch(out);
    if(markerChanged&&options.markDirty!==false) _dbMigrationDirty=true;
    return {changed:markerChanged||epoch>0,mode:'full',resequenced:0,renamed:0,linkedRows:0,total:0,scannedLogCollections:0};
  }
  const ordered=files.slice().sort(_tkpCompareChronologyFiles);
  let resequenced=0,renamed=0,linkedRows=0,metadataChanged=0,maxFileId=0;
  const byId=new Map();
  for(let i=0;i<ordered.length;i++){
    const f=ordered[i],seq=i+1,oldSeq=Number(f.sequence_no)||0;
    maxFileId=Math.max(maxFileId,Number(f?.id)||0);
    const update=_tkpApplyChronologyFileMetadata(f,seq);
    if(oldSeq!==seq)resequenced++;
    renamed+=update.renamed;
    metadataChanged+=update.metadataChanged;
    byId.set(String(f.id),{seq,filename:update.filename});
  }
  for(const r of races){
    const hit=byId.get(String(r?.file_id));if(!hit)continue;
    let touched=false;
    if(Number(r.sequence_no)!==hit.seq){r.sequence_no=hit.seq;touched=true;}
    if(hit.filename&&r.filename!==hit.filename){r.filename=hit.filename;touched=true;}
    if(touched)linkedRows++;
  }
  // file_id taşıyan geçmiş/snapshot kayıtlarında meeting sıra numarası da aynı
  // kronolojik kimliği izlesin. Sonuç/tahmin içeriğine dokunulmaz.
  const linkedLogKeys=['prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log','bets'];
  for(const key of linkedLogKeys){
    for(const row of (Array.isArray(out?.[key])?out[key]:[])){
      const hit=byId.get(String(row?.file_id));if(!hit)continue;
      if(Object.prototype.hasOwnProperty.call(row,'sequence_no')&&Number(row.sequence_no)!==hit.seq){row.sequence_no=hit.seq;linkedRows++;}
    }
  }
  const nextLock=_tkpBuildChronologyLock(ordered.length,ordered[0],ordered[ordered.length-1],maxFileId);
  const markerChanged=!_tkpChronologyLocksEqual(out.chronology_lock,nextLock);
  out.chronology_lock=nextLock;
  // Tam kronoloji yolu yalnız bilinçli düzeltme/geri yüklemede çağrılır. İç
  // sıralama değişip ilk/son dosya aynı kalsa bile hijyen scope'u geçersiz olur.
  const hygieneEpoch=tkpBumpStartupHygieneEpoch(out);
  const changed=resequenced>0||renamed>0||linkedRows>0||metadataChanged>0||markerChanged||hygieneEpoch>0;
  if(changed&&options.markDirty!==false){
    _dbMigrationDirty=true;
    if(options.logChange!==false&&Array.isArray(out.changelog)){
      out.changelog.push({ts:new Date().toISOString(),type:'MIGRATION',message:`Kronolojik dosya No kilidi uygulandı: 1=en eski, ${ordered.length}=en yeni; ${resequenced} kayıt yeniden numaralandırıldı.`});
    }
  }
  return {changed,mode:'full',resequenced,renamed,linkedRows,total:ordered.length,oldest:ordered[0]?.race_date||'',newest:ordered[ordered.length-1]?.race_date||'',scannedLogCollections:linkedLogKeys.length};
}

async function tkpResequenceFilesChronologicallyAsync(target,options={}){
  const out=target&&typeof target==='object'?target:db;
  const files=Array.isArray(out?.files)?out.files:[],races=Array.isArray(out?.races)?out.races:[];
  if(!files.length)return tkpResequenceFilesChronologically(out,options);
  // Sıralama 509 dosyada küçüktür; ağır olan bağlı koleksiyon güncellemesidir. Haritayı
  // tek kez kurup bütün koleksiyonları chunk/checkpoint ile dolaşırız.
  const ordered=files.slice().sort(_tkpCompareChronologyFiles),byId=new Map();
  let resequenced=0,renamed=0,linkedRows=0,metadataChanged=0,maxFileId=0;
  const job=typeof tkpStartJob==='function'?tkpStartJob('Kronolojik dosya sırası',{budgetMs:6,total:ordered.length+races.length}):null;
  for(let i=0;i<ordered.length;i++){
    const f=ordered[i],seq=i+1,oldSeq=Number(f.sequence_no)||0;maxFileId=Math.max(maxFileId,Number(f?.id)||0);
    const update=_tkpApplyChronologyFileMetadata(f,seq);if(oldSeq!==seq)resequenced++;renamed+=update.renamed;metadataChanged+=update.metadataChanged;byId.set(String(f.id),{seq,filename:update.filename});
    if(job&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(job,i+1,job.total);
  }
  for(let i=0;i<races.length;i++){
    const r=races[i],hit=byId.get(String(r?.file_id));if(hit){let touched=false;if(Number(r.sequence_no)!==hit.seq){r.sequence_no=hit.seq;touched=true;}if(hit.filename&&r.filename!==hit.filename){r.filename=hit.filename;touched=true;}if(touched)linkedRows++;}
    if(job&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(job,ordered.length+i+1,job.total);
  }
  const linkedLogKeys=['prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log','bets'];
  for(const key of linkedLogKeys){
    const rows=Array.isArray(out?.[key])?out[key]:[];
    for(let i=0;i<rows.length;i++){
      const row=rows[i],hit=byId.get(String(row?.file_id));if(hit&&Object.prototype.hasOwnProperty.call(row,'sequence_no')&&Number(row.sequence_no)!==hit.seq){row.sequence_no=hit.seq;linkedRows++;}
      if((i&255)===255){if(typeof tkpYieldToUi==='function')await tkpYieldToUi();else await new Promise(r=>setTimeout(r,0));}
    }
  }
  const nextLock=_tkpBuildChronologyLock(ordered.length,ordered[0],ordered[ordered.length-1],maxFileId);out.chronology_lock=nextLock;tkpBumpStartupHygieneEpoch(out);_dbMigrationDirty=true;
  if(job&&typeof tkpFinishJob==='function')tkpFinishJob(job);
  return {changed:true,mode:'async-full',resequenced,renamed,linkedRows,total:ordered.length,oldest:ordered[0]?.race_date||'',newest:ordered[ordered.length-1]?.race_date||'',scannedLogCollections:linkedLogKeys.length};
}

if(typeof globalThis!=='undefined'){
  globalThis.tkpResequenceFilesChronologically=tkpResequenceFilesChronologically;
  globalThis.tkpResequenceFilesChronologicallyAsync=tkpResequenceFilesChronologicallyAsync;
  globalThis.tkpEnsureChronologyLock=tkpEnsureChronologyLock;
  globalThis.tkpApplyChronologyForIncomingFile=tkpApplyChronologyForIncomingFile;
  globalThis.tkpChronologyLockIsValid=tkpChronologyLockIsValid;
  globalThis.tkpChronologyNextSequence=tkpChronologyNextSequence;
  globalThis.tkpChronologyNextFileId=tkpChronologyNextFileId;
  globalThis.tkpStartupHygieneMarkerIsValid=tkpStartupHygieneMarkerIsValid;
  globalThis.tkpMarkStartupHygieneClean=tkpMarkStartupHygieneClean;
  globalThis.tkpBumpStartupHygieneEpoch=tkpBumpStartupHygieneEpoch;
  globalThis.tkpEnsureRaceIdentityMigration=tkpEnsureRaceIdentityMigration;
  globalThis.tkpCanDeferLargeWorkerRestoreHygiene=tkpCanDeferLargeWorkerRestoreHygiene;
}

function migrateDbPayload(raw,options={}){
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Veritabanı nesnesi geçersiz.');
  const sourceVersion=Math.max(1,Number(raw.schema_version)||1);
  const requestedChronologyMode=String(options?.chronologyMode||'startup');
  const deferredLargeWorkerRestore=requestedChronologyMode==='startup-deferred-restore'
    && tkpCanDeferLargeWorkerRestoreHygiene(raw,sourceVersion);
  // Worker geri yükleme işareti taşıyan bir veri, doğrudan bu yardımcıyı
  // çağıran eski yol tarafından da sıcak-açılış gibi ele alınamaz. Büyük güncel
  // arşivde ise V240'ın gecikmeli-donma kilidi açıkça bu tam işi erteler.
  const chronologyMode=(!deferredLargeWorkerRestore&&requestedChronologyMode!=='startup-candidate'&&tkpRestoreRequiresFullHygiene(raw))
    ?'restore'
    :requestedChronologyMode;
  const out=raw;
  for(const key of ['files','races','bets','changelog','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log','bomb_hunter_shadow_log']) if(!Array.isArray(out[key])) out[key]=[];
  out.settings={...clone(SEED.settings),...(out.settings&&typeof out.settings==='object'?out.settings:{})};
  tkpApplyUserSettingsGuard(out);
  if(!out.learning_state || typeof out.learning_state!=='object') out.learning_state={};
  if(sourceVersion>DB_SCHEMA_VERSION){
    _persistReadOnly=true;
    _persistLastError=`Bu yedek daha yeni bir veri şeması kullanıyor (v${sourceVersion}). Veri koruma amacıyla salt okunur açıldı.`;
    return out;
  }
  // Otomatik yedek adayları yalnız sayım üzerinden karşılaştırılır. Eksik marker
  // varsa bu aşamada ne kronoloji ne UID/X/frozen-BMB taraması yapılır; aday
  // gerçekten seçilirse aşağıdaki restore çağrısı tam ve fail-closed çalışır.
  if(chronologyMode==='startup-candidate'){
    _persistReadOnly=false;
    return out;
  }
  if(deferredLargeWorkerRestore){
    // Worker'ın atomik manifest yazısı zaten tamamlandı. 503 gibi arşivlerde
    // burada UID/X/BMB/visible-TKP'nin tümünü tekrar mutasyona uğratıp ikinci
    // manifest yazısı başlatmak yerine, kullanıcı gerçekten veri değiştirince
    // normal save yolu ile kalıcılaştırılacak güvenli erteleme yapılır.
    out.schema_version=DB_SCHEMA_VERSION;
    _persistReadOnly=false;
    tkpMarkRestoreHygieneDeferred(out);
    return out;
  }
  _normalizeLegacySecondAlti(out,sourceVersion);
  // Temiz, uygulamanın kendi kalıcı veritabanından açılan kilitli veri için bu
  // O(1) no-op'tur: marker + files.length doğrulanır, races/log/bets taranmaz.
  // Geri yükleme, eski şema ve marker'ı eksik/bozuk kayıtlar ise açıkça tam
  // eşlemeye girer; 1=en eski / N=en yeni kuralı hiçbir zaman gevşetilmez.
  const mustFullyResequence=sourceVersion<DB_SCHEMA_VERSION
    || ['restore','legacy-migration','backward-correction','date-correction','delete'].includes(chronologyMode);
  tkpEnsureChronologyLock(out,{
    full:mustFullyResequence,
    reason:mustFullyResequence ? (chronologyMode==='startup'?'legacy-migration':chronologyMode) : chronologyMode,
    markDirty:true,
    logChange:true
  });
  // UID, X zaman kilidi ve frozen görünür TKP onarımları yalnız kendi geçerli
  // marker'ları varsa O(1) atlanabilir. Marker yoksa fail-closed tam denetim
  // zorunludur; eski v6 etiketi veya yalnız chronology_lock güven kanıtı değildir.
  // Seçilmemiş otomatik yedek adayları ise kullanıcı verisini gereksiz taramamak
  // için burada yalnız sayım/şema ile puanlanır; seçildiklerinde restore modunda
  // aşağıdaki denetimler eksiksiz çalışır.
  tkpEnsureRaceIdentityMigration(out,{full:mustFullyResequence});
  sanitizeLegacyXKulis(out,{full:mustFullyResequence,mode:chronologyMode});
  _migrateAllOldVisibleTkp(out,{full:mustFullyResequence,mode:chronologyMode});
  if(sourceVersion<DB_SCHEMA_VERSION){
    out.changelog.push({ts:new Date().toISOString(),type:'MIGRATION',message:`Veri şeması v${sourceVersion} sürümünden v${DB_SCHEMA_VERSION} sürümüne güvenle yükseltildi.`});
    _dbMigrationDirty=true;
  }
  out.schema_version=DB_SCHEMA_VERSION;
  _persistReadOnly=false;
  return out;
}
if(typeof globalThis!=='undefined') globalThis.tkpMigrateDbPayload=migrateDbPayload;
function tkpConsumeDbMigrationDirty(){const dirty=_dbMigrationDirty;_dbMigrationDirty=false;return dirty;}
if(typeof globalThis!=='undefined') globalThis.tkpConsumeDbMigrationDirty=tkpConsumeDbMigrationDirty;

async function storageGet(key){
  _persistLastError='';
  if (window.storage && typeof window.storage.get === 'function'){
    try {
      const r = await window.storage.get(key, false);
      persistMode = 'claude';
      _persistVerified = true;
      return r;
    } catch(e){ _persistLastError=String(e?.message||e||'window.storage okunamadı'); }
  }

  // Ana DB için tek kalıcı kaynak IndexedDB'dir. Eski sürüm localStorage'a veri
  // bırakmışsa yalnız bir defa okunur ve mümkünse otomatik olarak IndexedDB'ye taşınır.
  try {
    const v = await _idbGet(key);
    if (v !== undefined){
      persistMode = 'indexeddb';
      _persistVerified = true;
      if(v != null) return {value:v};
    }
  } catch(e){ _persistLastError=String(e?.message||e||'IndexedDB okunamadı'); }

  try {
    const legacy = localStorage.getItem(key);
    if(legacy){
      if(_CORE_PERSIST_KEYS.has(key)){
        const migrated = await _idbSet(key, legacy);
        if(migrated){
          try{ localStorage.removeItem(key); }catch(_e){}
          persistMode = 'indexeddb';
          _persistVerified = true;
          _persistLastError='';
        }else{
          persistMode = 'legacy-local-read';
          _persistVerified = false;
          _persistLastError='Eski localStorage kaydı okundu; IndexedDB aktarımı henüz doğrulanamadı.';
        }
        return {value:legacy};
      }
      persistMode = 'local';
      _persistVerified = true;
      return {value:legacy};
    }
  } catch(e){ _persistLastError=String(e?.message||e||'localStorage okunamadı'); }

  persistMode = 'none';
  _persistVerified = false;
  return null;
}

async function storageSet(key, value){
  _persistLastError='';
  if (window.storage && typeof window.storage.set === 'function'){
    try {
      await window.storage.set(key, value, false);
      persistMode = 'claude';
      _persistVerified = true;
      return true;
    } catch(e){ _persistLastError=String(e?.message||e||'window.storage yazılamadı'); }
  }

  try {
    const ok = await _idbSet(key, value);
    if (ok){
      persistMode = 'indexeddb';
      _persistVerified = true;
      // Önceki sürümden kalmış dev localStorage kopyasını temizle. Bu yalnız ana
      // veri anahtarlarında yapılır; küçük kullanıcı ayarlarına dokunulmaz.
      if(_CORE_PERSIST_KEYS.has(key)){
        try{ localStorage.removeItem(key); }catch(_e){}
      }
      return true;
    }
  } catch(e){ _persistLastError=String(e?.message||e||'IndexedDB yazılamadı'); }

  // KRİTİK KİLİT: Ana DB / yedek anahtarları IndexedDB başarısız olduğunda
  // localStorage'a düşmez. Aksi halde birkaç MB sonra QuotaExceededError oluşur.
  if(_CORE_PERSIST_KEYS.has(key)){
    persistMode = 'none';
    _persistVerified = false;
    _persistLastError = _persistLastError || 'IndexedDB yazımı doğrulanamadı; ana veri localStorage kotasına zorlanmadı.';
    return false;
  }

  try {
    localStorage.setItem(key, value);
    persistMode = 'local';
    _persistVerified = true;
    return true;
  } catch(e){ _persistLastError=String(e?.message||e||'localStorage yazılamadı'); }

  persistMode = 'none';
  _persistVerified = false;
  return false;
}

function _dbRecordScore(x){
  if(!x || typeof x!=='object') return 0;
  return (Array.isArray(x.files)?x.files.length:0)*10
    + (Array.isArray(x.races)?x.races.length:0)*20
    + (Array.isArray(x.bets)?x.bets.length:0)
    + (Array.isArray(x.prediction_log)?x.prediction_log.length:0)
    + (Array.isArray(x.auto_coupon_log)?x.auto_coupon_log.length:0)
    + (Array.isArray(x.forward_tracking_log)?x.forward_tracking_log.length:0)
    + (Array.isArray(x.weekly_model_log)?x.weekly_model_log.length:0)
    + (Array.isArray(x.v55_diagnostic_log)?x.v55_diagnostic_log.length:0)
    + (Array.isArray(x.sidebet_ticket_log)?x.sidebet_ticket_log.length:0)
    + (Array.isArray(x.commentator_evidence_log)?x.commentator_evidence_log.length:0)
    + (Array.isArray(x.surprise_cohort_tracking_log)?x.surprise_cohort_tracking_log.length:0)
    + (Array.isArray(x.changelog)?Math.min(x.changelog.length,1000)/1000:0);
}

function tkpDeferStartupSnapshotPersistence(snapshot,reason){
  _tkpDeferredStartupPersistence={snapshot,reason:String(reason||'startup'),queuedAt:Date.now()};
  try{
    if(typeof globalThis!=='undefined') globalThis.__tkpStartupPersistenceDeferred={
      reason:String(reason||'startup'),state:'DEFERRED_UNTIL_EXPLICIT_SAVE',queuedAt:_tkpDeferredStartupPersistence.queuedAt
    };
  }catch(_e){}
  return true;
}
function tkpScheduleSnapshotPersistence(snapshot, reason, options={}){
  if(!snapshot) return false;
  const label=String(reason||'normal');
  // Açılış/tam-restore kaynaklı yazım, kullanıcı beklerken arka planda başlatılmaz.
  // `saveDB()` yalnız açık kullanıcı değişiminden sonra mevcut veriyi zaten eksiksiz
  // yazar ve bu bekleyen işareti de temizler. Bu, 503 arşivde 1–2 dk sonra görülen
  // ikinci serialize/write zincirinin tekrarını engeller.
  if(TKP_STARTUP_DEFERRED_PERSIST_REASONS.has(label)&&options.forceStartupWrite!==true){
    return tkpDeferStartupSnapshotPersistence(snapshot,label);
  }
  const run=async()=>{
    const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    try{
      await _saveSegmentedSnapshot(snapshot,label);
      if(typeof tkpRecordPerformance==='function') tkpRecordPerformance(`storage:${label}`,started);
    }catch(error){
      _persistLastError=String(error?.message||error);
      if(typeof tkpRecordPerformance==='function') tkpRecordPerformance(`storage:${label}`,started,error);
    }
  };
  // AÇILIŞ HIZ KİLİDİ: 15+ MB parçalı snapshot yazımı saniyeler sürebilir. Bu işlem
  // loadDB kritik yolunda ASLA await edilmez. Kullanıcı arayüzü hazır olduktan ve
  // kullanıcı kısa süre boş kaldıktan sonra kalıcı yazım yapılır.
  if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(run,{minIdleMs:1800,retryMs:250,maxWaitMs:15000});
  else setTimeout(run,250);
  return true;
}

async function loadDB(){
  // Önce yeni parçalı IndexedDB v2 denenir. Manifest tamamlanmadan aktifleşmediği
  // için elektrik/tarayıcı kapanması yarım DB bırakmaz; aktif parça bozuksa motor
  // otomatik olarak önceki sağlam manifeste döner.
  const segmentedApi=_segmentedStorageApi();
  if(segmentedApi&&typeof segmentedApi.loadDb==='function'){
    try{
      // V1.1.326 TANI: "açılışta 1-2 dk kasıyor" şikayeti loadDB() içinde HANGİ aşamanın
      // yavaş olduğunu ayırt edemiyorduk -- yalnız toplam 'boot:loadDB' ölçülüyordu.
      // Alt aşamalar artık ayrı ayrı Sistem sekmesindeki "Son ağır panel ölçümleri"
      // tablosunda görünür. Veri bütünlüğü kritik kodu (BMB/aktiflik temizliği, restore
      // hijyeni) KANITSIZ değiştirmek yerine önce gerçek darboğazı ölçüp göstermek tercih
      // edildi.
      const segStageStart=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
      const loaded = await segmentedApi.loadDb({
        timeoutMs:300000,
        // KÖK ÇÖZÜM (R16.4): Gerçek 509 dosya/3.054 koşuluk arşiv ~163 MB'a
        // ulaştı (races koleksiyonu tek başına ~119 MB -- her koşuda onlarca
        // at x onlarca alan). Eski 48 MB/120.000 kayıt tavanı bu GERÇEK
        // arşivde her açılışta safe-mode'u (soğuk kayıt kesme) tetikliyordu;
        // safe-mode'un tek-blend-ortalama sezgisi races'in devasa kayıt
        // boyutunu hesaba katmadığı için prediction_log/changelog/
        // bomb_hunter_shadow_log/forward_tracking_log'un büyük kısmı
        // sessizce hiç belleğe girmiyordu -- Ayrıntılı Analiz tabloları ve
        // ROI/ODB/BMB kalibrasyonu eksik veriyle çalışıyordu. Tavan, bugünkü
        // gerçek arşivin ~2 katına (ve kayıt sayısının ~5-6 katına)
        // yükseltildi; böylece gerçek arşiv normal (safe-mode'suz) yoldan
        // TAM yüklenir. 5M-10M kayıt / GB ölçekli gerçek dev arşiv koruması
        // (materializationCaps, bkz. tests/ten-million-safe-mode.test.js)
        // hiç değişmedi -- yalnız tetiklenme eşiği bugünkü veriyi kapsayacak
        // şekilde taşındı.
        maxMaterializedRecords:250000,
        maxMaterializedBytes:320*1024*1024
      });
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB:segmentedRead',segStageStart);
      if(loaded?.ok&&loaded.db){
        // Worker ile geri yüklenen büyük paket zaten atomik/parçalı olarak yazıldı.
        // V238'in yaptığı gibi ilk boya sonrasında ikinci kez tüm 503 arşivi
        // hijyen+saveDB'den geçirmek gecikmeli bellek çökmesine yol açıyordu.
        // Güncel şemalı büyük worker yedeği yalnız açık bir veri kaydında tam
        // hijyene kalıcılaşır; küçük/eski/recovered kayıtlar fail-closed kalır.
        const deferredWorkerRestore=!loaded.recovered&&tkpCanDeferLargeWorkerRestoreHygiene(loaded.db);
        const restoreHygiene=Boolean(loaded.recovered||(tkpRestoreRequiresFullHygiene(loaded.db)&&!deferredWorkerRestore));
        const hygieneMode=deferredWorkerRestore?'startup-deferred-restore':(restoreHygiene?'restore':'startup');
        const migrateStart=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
        let x=migrateDbPayload(loaded.db,{chronologyMode:hygieneMode});
        if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB:migrate ('+hygieneMode+')',migrateStart);
        if(!deferredWorkerRestore){
          const sanitizeStart=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
          x=await sanitizeRealBmbFlags(x,{mode:hygieneMode});
          if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB:sanitizeBmb ('+hygieneMode+(restoreHygiene?'/FULL-SCAN':'/marker-check')+')',sanitizeStart);
        }
        if(restoreHygiene){
          const hygieneStart=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
          tkpCompleteRestoreHygiene(x);
          if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB:restoreHygiene',hygieneStart);
          tkpScheduleSnapshotPersistence(x,'restore-hygiene');
        }else if(deferredWorkerRestore){
          tkpMarkRestoreHygieneDeferred(x);
        }
        persistMode=loaded.recovered?'indexeddb-segmented-recovered':'indexeddb-segmented';
        _persistVerified=true;
        _persistLastError=loaded.recovered?`Aktif kayıt bozuktu; önceki sağlam parçalı manifest kurtarıldı. ${loaded.activeError||''}`:'';
        _tkpSerializedBytes=Number(loaded?.manifest?.totalBytes)||0;
        _lastSerializedSnapshot='';
        _lastLearningDatasetSignature=String(x?.learning_state?.dataset_signature||'')||learningDatasetSignature(x);
        // Açılıştan sonra gizli tam-yazım yoktur. Marker onarımı veya restore
        // hijyeni bekliyorsa ilk açık save/import ile kalıcılaştırılır.
        if(_dbMigrationDirty) tkpScheduleSnapshotPersistence(x,'startup-hygiene');
        return x;
      }
    }catch(error){
      // İlk kurulumda manifest olmaması normaldir; aşağıda eski tek-JSON IndexedDB,
      // eski localStorage veya paket seed'i okunup bir defa v2'ye taşınır.
      const msg=String(error?.message||error||'');
      if(!/Manifest doğrulanamadı|Manifest yapısı doğrulanamadı|geçerli manifest yok|Cannot read/i.test(msg)) _persistLastError=msg;
      else _persistLastError='';
    }
  }
  const tryLoad=async(key,isBackup,label)=>{
    const res=await _withTimeout(storageGet(key),30000);
    if(!res?.value) return null;
    const serialized=String(res.value);
    let raw=JSON.parse(serialized);
    // Bazı eski yedekler {value:"{...}"} veya doğrudan JSON string olarak kalmış olabilir.
    if(typeof raw==='string') raw=JSON.parse(raw);
    if(raw && typeof raw==='object' && typeof raw.value==='string') raw=JSON.parse(raw.value);
    // Başlangıçta yedek adaylarını yalnız okuyup puanlarız. Seçilmeyen adayın
    // milyonlarca bağlı satırını "restore" diye gereksiz yere yeniden sıralamayız.
    let x=migrateDbPayload(raw,{chronologyMode:isBackup?'startup-candidate':'startup'});
    const sanitizeStart=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    x=await sanitizeRealBmbFlags(x,{mode:isBackup?'startup-candidate':'startup'});
    if(!isBackup&&typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB:sanitizeBmb (legacy/'+label+')',sanitizeStart);
    _tkpSerializedBytes=typeof Blob==='function'?new Blob([serialized]).size:serialized.length;
    // Otomatik yedek adayları puanlanırken dataset imzası için milyonlarca
    // yarış/at taranmaz. Aday gerçekten seçilirse restore yolu bunu hesaplar.
    if(!isBackup) _lastLearningDatasetSignature=String(x?.learning_state?.dataset_signature||'')||learningDatasetSignature(x);
    if(isBackup){
      x.changelog.push({ts:new Date().toISOString(),type:'RECOVERY',message:`${label||'Otomatik yedek'} kurtarıldı.`});
      _persistLastError=`Ana kayıt boş/okunamaz göründü; ${label||'otomatik yedek'} kurtarıldı.`;
    }
    return {db:x, serialized, score:_dbRecordScore(x), key, label};
  };

  let primary=null;
  try{ primary=await tryLoad(STORAGE_KEY,false,'ana kayıt'); }
  catch(e){ _persistLastError=String(e?.message||e||'Veritabanı yüklenemedi'); }

  const backups=[];
  for(const [key,label] of [[STORAGE_BACKUP_KEY,'önceki sağlam yedek'],[STORAGE_COLLECTOR_IMPORT_BACKUP_KEY,'aktarım öncesi yedek']]){
    try{ const b=await tryLoad(key,true,label); if(b) backups.push(b); }
    catch(e){ _persistLastError+=`; ${label} okunamadı: `+String(e?.message||e); }
  }

  if(primary){
    // KÖK ÇÖZÜM: Bir hata ana kaydı boş DB ile ezdiyse, daha dolu otomatik yedeği
    // sessizce kullan. Kullanıcının bütün sonuç havuzu böylece kaybolmuş görünmez.
    const bestBackup=backups.sort((a,b)=>b.score-a.score)[0];
    if(bestBackup && primary.score<=1 && bestBackup.score>primary.score+5){
      bestBackup.db=migrateDbPayload(bestBackup.db,{chronologyMode:'restore'});
      bestBackup.db=await sanitizeRealBmbFlags(bestBackup.db,{mode:'restore'});
      _lastSerializedSnapshot=bestBackup.serialized;
      tkpScheduleSnapshotPersistence(bestBackup.db,'recovery');
      return bestBackup.db;
    }
    _lastSerializedSnapshot=primary.serialized;
    tkpScheduleSnapshotPersistence(primary.db,'legacy-migration');
    return primary.db;
  }

  if(backups.length){
    const bestBackup=backups.sort((a,b)=>b.score-a.score)[0];
    bestBackup.db=migrateDbPayload(bestBackup.db,{chronologyMode:'restore'});
    bestBackup.db=await sanitizeRealBmbFlags(bestBackup.db,{mode:'restore'});
    _lastSerializedSnapshot=bestBackup.serialized;
    tkpScheduleSnapshotPersistence(bestBackup.db,'backup-migration');
    return bestBackup.db;
  }
  // V1.1.303: Temiz kurulumda paket içindeki eski 72 toplantılık seed OTOMATİK
  // yüklenmez. Kullanıcı sıfırladığında gerçekten boş DB ile başlar; gerçek arşiv
  // yalnız yedek/collector üzerinden açık kullanıcı işlemiyle gelir.
  const empty=clone(SEED);
  empty.learning_state={};
  _lastLearningDatasetSignature=String(empty?.learning_state?.dataset_signature||'')||learningDatasetSignature(empty);
  return empty;
}

function beginDbBatch(){
  _dbBatchDepth++;
}

// V1.1.282 — atomic import hata yolunda bekleyen persist/render isteklerini
// tamamen iptal eder. Aksi halde rollback'ten sonra endDbBatch yarım state'i
// yeniden diske yazabilirdi.
function cancelDbBatch(){
  _dbBatchDepth=0;
  _dbBatchPersistRequested=false;
  _dbBatchRenderRequested=false;
  _dbBatchImmediatePersistRequested=false;
  return true;
}

async function endDbBatch(render=true){
  if(_dbBatchDepth>0) _dbBatchDepth--;
  _dbBatchRenderRequested ||= Boolean(render);
  if(_dbBatchDepth>0) return true;
  if(!_dbBatchPersistRequested){
    if(_dbBatchRenderRequested && typeof renderAll==='function') renderAll();
    _dbBatchRenderRequested=false;
    _dbBatchImmediatePersistRequested=false;
    return true;
  }
  const shouldRender=_dbBatchRenderRequested;
  const shouldPersistImmediately=_dbBatchImmediatePersistRequested;
  _dbBatchPersistRequested=false;
  _dbBatchRenderRequested=false;
  _dbBatchImmediatePersistRequested=false;
  // Bir batch içinde `saveDB(..., true)` istenmişse bu bilgi kapanışta
  // kaybolmamalı. Özellikle kupon snapshotı reload öncesi kayda girmeli;
  // eski yol bunu sessizce 700 ms idle yazısına dönüştürüyordu.
  return saveDB(shouldRender,shouldPersistImmediately);
}

async function withDbBatch(task, render=true){
  beginDbBatch();
  try { return await task(); }
  finally { await endDbBatch(render); }
}

// Yeni resmî sonuç geldikten sonra ağır öğrenme işleri saveDB'nin ve kullanıcının
// tıklamasının içinde çalışmaz. Tek anahtarlı arka plan görevi yalnız outcome
// imzası değiştiğinde çalışır; aynı veri, Ctrl+F5 veya programı yeniden açma bu
// işi tekrar başlatmaz. Kural motoru incremental cache'i uzatır, adaptif ve
// İleri Takip görünümleri de yeni imza için cooperative olarak hazırlanır.
function tkpScheduleIncrementalOutcomeLearning(previousSignature,nextSignature){
  if(!previousSignature||!nextSignature||previousSignature===nextSignature)return false;
  const run=async()=>{
    const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    try{
      if(typeof tkpWaitForBackgroundSafeWindow==='function')await tkpWaitForBackgroundSafeWindow({minIdleMs:1600,retryMs:150});
      if(typeof setRulesDirty==='function')setRulesDirty(true);
      if(typeof getCurrentRulesAsync==='function')await getCurrentRulesAsync();
      if(typeof tkpYieldToUi==='function')await tkpYieldToUi();
      if(typeof tkpRefreshLearningCache==='function')await tkpRefreshLearningCache(true);
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('learning:incremental-outcome',started);
      return true;
    }catch(error){
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('learning:incremental-outcome',started,error);
      console.warn('Artımlı sonuç öğrenmesi tamamlanamadı:',error);
      return false;
    }
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask('incremental-outcome-learning',run,{priority:'background',replace:true,minIdleMs:1800});
  else if(typeof tkpRunWhenUserIdle==='function')tkpRunWhenUserIdle(run,{minIdleMs:2000,retryMs:250,maxWaitMs:0});
  else setTimeout(run,1000);
  return true;
}
if(typeof globalThis!=='undefined')globalThis.tkpScheduleIncrementalOutcomeLearning=tkpScheduleIncrementalOutcomeLearning;

function _resolveSaveWaiters(result){
  const waiters=_saveResolvers.splice(0);
  for(const resolve of waiters) resolve(result);
}

async function _flushSaveQueue(){
  if(_saveRunning){ _saveNeedsAnotherPass=true; return; }
  _saveScheduled=false;
  _saveScheduledImmediate=false;
  _saveRunning=true;globalThis.__tkpTrace?.('save','start');
  let finalOk=true;
  // KÖK FIX (V1.0.75) -- YENİDEN GİRİŞ (RE-ENTRANCY) KİLİTLENMESİ:
  // renderAll() eskiden bu do...while döngüsünün İÇİNDE çağrılıyordu. Ancak bazı pane
  // render fonksiyonları veri düzeltip saveDB() çağırıyor (ör. renderFiles ODS ad
  // normalizasyonu, renderSavedPredictionByFileId snapshot geri yazımı). _saveRunning
  // true olduğu için bu çağrılar _saveNeedsAnotherPass/_saveRenderRequested bayrağını
  // set ediyor ve döngü BİR TUR DAHA dönüyor -- yani tüm veritabanı bir kez daha
  // JSON.stringify ediliyor ve bir kez daha diske yazılıyor. Her kayıt en az iki katına
  // çıkıyordu; render yolundaki bir saveDB() (varsayılan render=true) ise döngüyü
  // SONSUZA kadar döndürüp sekmeyi tamamen kilitliyordu.
  // Artık render, kayıt döngüsü TAMAMEN bittikten sonra bir kez yapılır.
  let _renderAfterSave=false;
  try{
    do{
      _saveNeedsAnotherPass=false;globalThis.__tkpTrace?.('save','pass');
      if(_saveRenderRequested){ _renderAfterSave=true; }
      _saveRenderRequested=false;

      tkpEnforceUserSettingsGuard(db);

      globalThis.__tkpTrace?.('save','signatures');const nextLearningSignature=await learningDatasetSignatureAsync(db);
      const learningChanged=nextLearningSignature!==_lastLearningDatasetSignature;
      const previousOutcomeSignature=_lastOutcomeLearningSignature;
      const nextOutcomeSignature=await tkpOutcomeLearningSignatureAsync(db,true);
      const outcomeChanged=Boolean(previousOutcomeSignature&&nextOutcomeSignature!==previousOutcomeSignature);
      _lastOutcomeLearningSignature=nextOutcomeSignature;
      if(learningChanged){
        _lastLearningDatasetSignature=nextLearningSignature;
        // Yalnız yarış/at/sonuç girdisi gerçekten değiştiğinde tarihsel motorları
        // geçersiz kıl. Eski davranış her bahis, ayar veya log kaydında 509
        // toplantılık bütün indeksleri ve analiz cache'lerini siliyordu.
        invalidateActiveRacesCache();
        invalidateProfileMatchCache();
        invalidateWinnerProfileCache();
        invalidateConditionStatsCache();
        invalidateAdaptiveLearningCache();
        invalidateSideBetCache();
        if(db){
          db.learning_state=db.learning_state||{};
          db.learning_state.dataset_signature=nextLearningSignature;
          db.learning_state.updated_at=new Date().toISOString();
          db.learning_state.status='GÜNCELLENDİ';
        }
      }
      if(db){
        db.learning_state=db.learning_state||{};
        db.learning_state.outcome_signature=nextOutcomeSignature;
        if(outcomeChanged){
          db.learning_state.result_count=Number(String(nextOutcomeSignature).split(':')[1])||0;
          db.learning_state.outcome_updated_at=new Date().toISOString();
          db.learning_state.status='GÜNCELLENDİ';
        }
        // Yerinde çözülen prediction_log satırı uzunluk değiştirmese de içerik
        // imzası değişir. İmzayı ana snapshot'la birlikte sakla; sonraki açılışta
        // aynı günlük tekrar taranmasın.
        db.learning_state.sidebet_prediction_signature=await sideBetPredictionLogRevisionSignatureAsync(db);
        db.learning_state.sidebet_prediction_signature_count=Array.isArray(db.prediction_log)?db.prediction_log.length:0;
      }

      // 5M ÖLÇEKLENEBİLİR KAYIT: bütün db için JSON.stringify YOKTUR. Her koleksiyon
      // 512 KB hedefli parçalara ayrılır, değişmeyen içerik-adresli chunk'lar yeniden
      // kullanılabilir ve aktif manifest yalnız bütün parçalar yazıldıktan sonra atomik
      // olarak değiştirilir. Önceki sağlam manifest otomatik yedektir.
      try{
        const segmentedResult=await _saveSegmentedSnapshot(db,'save');
        if(!segmentedResult) throw new Error('Parçalı IndexedDB motoru yüklenmedi.');
        finalOk=finalOk&&true;
        _lastSerializedSnapshot='';
        // Kullanıcının açık save/import işlemi mevcut DB'yi eksiksiz yazdıysa,
        // açılışta ertelenen hijyen yazımı ayrıca kuyruğa alınmaz.
        if(_tkpDeferredStartupPersistence){
          _tkpDeferredStartupPersistence=null;
          try{if(typeof globalThis!=='undefined')globalThis.__tkpStartupPersistenceDeferred=null;}catch(_e){}
        }
      }catch(error){
        finalOk=false;
        persistMode='none';
        _persistVerified=false;
        _persistLastError='Parçalı IndexedDB yazımı başarısız: '+String(error?.message||error);
        console.error(_persistLastError,error);
        // A failed durable write must end this flush. Listeners and another
        // queued pass cannot turn a lock failure into an endless save cycle.
        _saveNeedsAnotherPass=false;
        break;
      }
      if(typeof window!=='undefined'){
        globalThis.__tkpTrace?.('save','dispatch');_tkpDbRevision++;
        _tkpOutcomeLearningSignatureCache={revision:_tkpDbRevision,source:db,value:nextOutcomeSignature};
        const sideRows=Array.isArray(db?.prediction_log)?db.prediction_log:[];
        _sideBetSignatureCache={revision:_tkpDbRevision,epoch:_sideBetSignatureEpoch,rows:sideRows,length:sideRows.length,value:String(db?.learning_state?.sidebet_prediction_signature||'')};
        window.dispatchEvent(new CustomEvent('tkp:db-changed',{detail:{
          learningChanged,
          outcomeChanged,
          domain:learningChanged?'learning':'state',
          revision:_tkpDbRevision,
          datasetSignature:nextLearningSignature
        }}));
      }
      globalThis.__tkpTrace?.('save','after-dispatch');if(outcomeChanged)tkpScheduleIncrementalOutcomeLearning(previousOutcomeSignature,nextOutcomeSignature);
    }while(_saveNeedsAnotherPass);
  }finally{
    _saveRunning=false;globalThis.__tkpTrace?.('save','finally');
    // Render sırasında tetiklenen saveDB() çağrıları YENİ BİR RENDER İSTEYEMEZ.
    // Bu olmadan döngü yalnızca yer değiştirirdi: render -> saveDB(true) -> kayıt ->
    // render -> ... (mikrogörev kuyruğunda sonsuz). Veri yine kaydedilir; sadece
    // gereksiz ikinci çizim engellenir.
    try{
      if(finalOk && _renderAfterSave && typeof renderAll==='function'){
        _renderInProgress=true;
        try{globalThis.__tkpTrace?.('save','render-all'); renderAll();globalThis.__tkpTrace?.('save','render-done'); } finally { _renderInProgress=false; }
      }
    }catch(e){ _renderInProgress=false; console.error('renderAll hatası:',e); }
    globalThis.__tkpTrace?.('save','resolve-waiters');_resolveSaveWaiters(finalOk);globalThis.__tkpTrace?.('save','resolved');
  }
}

async function saveDB(render=true, immediate=false){
  // Backup JSON cache canlı DB mutasyonundan sonra, parçalı IndexedDB yazımı henüz
  // tamamlanmadan bile eski snapshot döndürmemeli. Save çağrısı veri değişiminin
  // kesin sınırıdır; cache burada anında geçersizlenir.
  try{ if(typeof globalThis.tkpInvalidateBackupCache==='function') globalThis.tkpInvalidateBackupCache(); }catch(_){ }
  // Yedek için arka planda JSON prewarm YOKTUR. Ana .tkbz yolu aktif IndexedDB
  // manifestini worker içinde parça parça stream eder. Böylece her save sonrasında
  // 100+ MB JSON.stringify üretip ana thread'i sessizce kilitleyen eski tasarım
  // geri gelemez; Worker olmayan fallback ancak kullanıcı açıkça Yedek Al dediğinde
  // serileştirme yapar.
  if(_persistReadOnly){
    _persistLastError='Daha yeni şemalı veri salt okunur açık; mevcut dosyanın üzerine yazılmadı.';
    return false;
  }
  if(_dbBatchDepth>0){
    _dbBatchPersistRequested=true;
    _dbBatchRenderRequested ||= Boolean(render);
    _dbBatchImmediatePersistRequested ||= Boolean(immediate);
    return true;
  }
  // V1.0.75: render sırasında gelen kayıt isteği yeni bir render ZİNCİRLEYEMEZ.
  _saveRenderRequested ||= (Boolean(render) && !_renderInProgress);
  const promise=new Promise(resolve=>_saveResolvers.push(resolve));
  if(_saveRunning){
    _saveNeedsAnotherPass=true;
    return promise;
  }
  // Zaten 700 ms idle bekleyen bir kayıt varken kritik kupon snapshotı gelirse
  // eski arka plan satırını NORMAL öncelikte yeniden kur. Aksi halde kupon
  // kartı görünse bile Ctrl+F5 öncesi kalıcı yazı başlamayabiliyordu.
  const promoteScheduledSave=Boolean(immediate&&_saveScheduled&&!_saveScheduledImmediate);
  if(!_saveScheduled||promoteScheduledSave){
    if(promoteScheduledSave){
      try{if(typeof tkpCancelQueuedTask==='function')tkpCancelQueuedTask('db-persist');}catch(_e){}
    }
    _saveScheduled=true;
    _saveScheduledImmediate=Boolean(_saveScheduledImmediate||immediate);
    // Büyük DB JSON serileştirmesi kullanıcı tıklamasının aynı mikro-görevinde
    // başlamaz. Önce ekran çizilir; kayıt tarayıcı boşluğunda veya kısa timeout'ta
    // çalışır. Eski kupon çağırma / veri yükleme sırasında hissedilen donmayı azaltır.
    if(typeof tkpQueueTask==='function'){
      // V1.1.259: kayıt da merkezi orkestratörden geçer; bağımsız timeout zinciri yok.
      // Açık kullanıcı kaydı NORMAL, otomatik kayıt BACKGROUND önceliğinde çalışır.
      tkpQueueTask('db-persist',()=>_flushSaveQueue(),{
        priority: immediate ? 'normal' : 'background',
        // Promosyonda eski idle satırı iptal edilir; tek yeni flush bütün mevcut
        // waiter'ları çözer. Normal arka plan çağrısında da aynı anahtar tek
        // aşırı yazımı birleştirir.
        replace:true,
        minIdleMs: immediate ? 0 : 700
      });
    }else if(immediate) setTimeout(()=>_flushSaveQueue(),0);
    else if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(()=>_flushSaveQueue(),{minIdleMs:900,retryMs:150,maxWaitMs:8000});
    else setTimeout(()=>_flushSaveQueue(),0);
  }
  return promise;
}

let _activeRacesCache = null;
// Backtest modunda activeRaces() her çağrıda (45+ çağrı noktası, bir kısmı at
// başına) tüm db.races'i baştan filtreliyordu -- 100 toplantılık Back Test'te
// bu, veritabanını yüzlerce/binlerce kez baştan taramak anlamına geliyor ve
// "Back Test çok geç çalışıyor" şikayetinin ana kaynağıydı. Backtest bağlamı
// (excludeFileId+cutoffSeq+cutoffDate) TEK bir toplantı işlenirken sabit
// kaldığından, sonuç o imza altında güvenle önbelleklenebilir; imza değiştiği an
// (bir sonraki toplantıya geçildiğinde) otomatik olarak yeniden hesaplanır.
let _activeRacesBacktestCache = new Map();

function invalidateActiveRacesCache(){ _activeRacesCache = null; _activeRacesBacktestCache.clear(); invalidateLearningEligibleRacesCache(); }

const ADAPTIVE_MIN_RACES = 1;
const ADAPTIVE_PROFILE_MIN_RACES = 5;
const ADAPTIVE_FULL_TRUST_RACES = 25;
// Model ailesi ağırlıkları artık yalnız zayıf bir rötuş değildir. Yeni bir
// doğrulanmış sinyalin şans eseri şişmesini önlemek için tam güven daha yavaş
// oluşur; yeterli örnekte ise kanıtlanan fark önceki ±%35 yerine daha belirgin
// uygulanır. Otomatik bulunan ham tablo alanları toplam model payını kaplayamaz.
const ADAPTIVE_WEIGHT_FULL_TRUST_RACES = 60;
const ADAPTIVE_LEARNED_WEIGHT_FLOOR = 0.55;
const ADAPTIVE_LEARNED_WEIGHT_CEILING = 1.75;
const ADAPTIVE_AUTO_TABLE_MAX_SHARE = 0.12;

const ADAPTIVE_BASE_WEIGHTS = {
  // Eski ZIP'in çoklu-sinyal omurgası korunur. Y.PUAN yorumcu konsensüsü
  // ek destek olarak kullanılır; tek başına sıralamayı ele geçirmez.
  tkp:36,
  agf:30,
  condition:27,
  history:25,
  last6:20,
  profile:25,
  extra:12,
  bmb:12,
  rules:18,
  ypuan:24,
  // KG (ağırlık) tabanı 8 -> 4: gerçek 509 toplantılık arşivde 1.İsabet
  // 112/1585 (%7,1) -- rastgele seçim düzeyinin (ortalama alan büyüklüğüne
  // göre ~%7-8) altında; en zayıf gerçek kanıtlı sinyal. Öğrenme motoru
  // ağırlığı zaten en fazla %55'e (ADAPTIVE_LEARNED_WEIGHT_FLOOR) kadar
  // düşürebiliyordu, taban böylece kanıta biraz daha yaklaştırıldı. Diğer
  // sinyallere dokunulmadı; regresyon paketiyle doğrulandı.
  kg:4,
  degree:22,
  ganyan_tr:16,
  accurate:18,
  st:8
};

const ADAPTIVE_LABELS = {
  tkp:'TKP',
  agf:'AGF',
  condition:'Koşu Uyumu',
  history:'Geçmiş Gücü',
  last6:'Son 6 Yarış Formu',
  profile:'Profil Gücü',
  extra:'ODB',
  bmb:'Gerçek BMB',
  rules:'Kural Motoru',
  ypuan:'Y.PUAN',
  kg:'KG',
  degree:'DRC',
  ganyan_tr:'Ganyan Canavarı TR',
  accurate:'ACCURATE',
  st:'ST / Kulvar'
};

let _adaptiveStatsCache = new Map();

let _adaptiveWeightsCache = new Map();

// KÖK ÇÖZÜM ("Yan Bahisler 5 dakika açılmadı"): historicalOrder(r) -- geçmiş bir
// yarışın o anki adaptif modelle nasıl sıralanacağını hesaplayan fonksiyon -- hiç
// önbelleklenmiyordu. sideBetDoubleBacktest, sideBetBacktest ve learnedSideBetWidth
// her biri (6 ayaklı bir toplantıda 5 kez, ayrı ayrı) aynı yüzlerce geçmiş yarışı
// TAM skor motoruyla (strategicOrderForRace -> adaptiveCompositeScore, at başına)
// baştan hesaplıyordu. Gerçek 288 yarışlık veriyle ölçüldü: 2518 tekrar hesaplama,
// tek panelde 31+ saniye. Bir geçmiş yarışın skoru, aynı adaptif model altında HER
// ZAMAN aynıdır; bu yüzden yarış nesnesine göre güvenle önbelleklenebilir. Model
// değiştiğinde (yeni veri, yeni sonuç) invalidateAdaptiveLearningCache zaten
// çağrıldığından bu önbellek de onunla birlikte temizlenir.
let _historicalOrderCache = new WeakMap();

// KÖK ÇÖZÜM (mimari hız taraması): profileStrengthPct(r,h) her tek çağrıda YARIŞTAKİ
// TÜM atları tarayıp maxValue/maxSp'yi baştan hesaplıyordu. Bu fonksiyon at sıralaması
// (dynamicCoverageCount, v25LiveConsensusInfo vb.) içinde binlerce kez çağrıldığından
// -- tek bir Yan Bahis render'ında 41.556 çağrı ölçüldü -- bu O(at) taraması O(at²)'ye
// katlanıyordu. Şimdi yarış başına maxValue/maxSp bir kez hesaplanıp önbelleğe alınır.
let _profileRaceMaxCache = new WeakMap();
let _kgSignalRaceCache = new WeakMap();
let _degreeSignalRaceCache = new WeakMap();

function invalidateAdaptiveLearningCache(){ if(typeof globalThis.tkpInvalidateAdaptiveStatsAsync==='function')globalThis.tkpInvalidateAdaptiveStatsAsync(); _adaptiveStatsCache.clear(); _adaptiveWeightsCache.clear(); if(typeof _adaptiveComboCache!=='undefined') _adaptiveComboCache.clear(); _historicalOrderCache = new WeakMap(); _profileRaceMaxCache = new WeakMap(); _kgSignalRaceCache = new WeakMap(); _degreeSignalRaceCache = new WeakMap(); if(typeof tkpInvalidateLearningModelCaches==='function') tkpInvalidateLearningModelCaches(); }

const SIDE_BET_MIN_RACES = 1;
const SIDE_BET_FULL_TRUST_RACES = 20;

const SIDE_BET_UNITS = {ikili:1.00, sirali:1.00, uclu:2.00, dortlu:1.50, cifte:1.00, sirali5li:1.25};

const SIDE_BET_WIDTH_CANDIDATES=[3,4,5,6,7,8];

const SIDE_BET_WIDTH_TARGET_RECALL=0.85;

const _sideBetBacktestCache = new Map();
const _sideBetDoubleGlobalCache = new Map();

const _sideBetWidthCache = new Map();
// İSTATİSTİK paneli aynı ayak için panel özeti + üç ayrı genişlik hesabı sırasında
// aynı prediction_log filtresini tekrar çağırıyordu. Sonuç, veri büyüdükçe tek bir
// panel açılışında aynı geçmişin dört kez taranmasıydı. Profil özeti veri revizyonu
// boyunca değişmez; ayak/profil anahtarıyla bir kez hesaplanıp yeniden kullanılır.
const _sideBetPanelStatsCache = new Map();

// SÜPER HIZLI YAN BAHİS: prediction_log tüm kayıtlarının fingerprint bazlı
// gruplaması artık hedef ayaktan (leg) bağımsız olarak TEK SEFER hesaplanır ve
// önbelleğe alınır. Eskiden panel her açıldığında (Altılı'nın 6 ayağının her
// biri için) prediction_log'un tamamı baştan taranıp yeniden gruplanıyordu;
// kayıt sayısı arttıkça panel açılışı gitgide yavaşlıyordu. Artık yalnızca
// prediction_log değiştiğinde (uzunluk/versiyon farklıysa) yeniden hesaplanır.
const _predictionLogGroupsCache = {key:null, currentStrategy:null, races:null};

function invalidateSideBetCache(){
  _sideBetSignatureEpoch++;
  _sideBetBacktestCache.clear();
  _sideBetWidthCache.clear();
  _sideBetPanelStatsCache.clear();
  _sideBetDoubleGlobalCache.clear();
  _predictionLogGroupsCache.key=null;
  _predictionLogGroupsCache.currentStrategy=null;
  _predictionLogGroupsCache.races=null;
  try{if(typeof tkpInvalidateSideBetPlanCache==='function')tkpInvalidateSideBetPlanCache();}catch(_e){}
  try{if(typeof tkpInvalidateSideBetTicketHtmlCache==='function')tkpInvalidateSideBetTicketHtmlCache();}catch(_e){}
  // Sonuç/ikramiye klasörden işlendiği anda Back Test yeniden çizilebiliyor;
  // saveDB'nin asenkron tkp:db-changed olayını beklemeden eski finans/yan bahis
  // sonucunu kesin olarak temizle.
  try{ if(typeof window!=='undefined' && typeof window.tkpInvalidateFastBacktestCache==='function') window.tkpInvalidateFastBacktestCache(); }catch(_e){}
}

const SONUC_THRESHOLD_MIN_SAMPLE = 15;

const SONUC_THRESHOLD_TARGET_RECALL = 0.90;

const DOUBLE_COST_LIMIT = 120;

const DOUBLE_MIN_COST = 15; // V44 walk-forward: COMMON 3x5 Çifte, minimum 15 TL

const COUPON_TYPE_LABELS = {main:'💪 Normal', main2:'Kaldırıldı', alt:'💣 Sürpriz', surprise:'🧠 Uzman + Kulis', other:'Diğer'};

const BET_GAME_TYPE_LABELS = {altili:'Altılı Ganyan', besli:'Beşli Ganyan', dortlu:'Dörtlü Ganyan', uclu:'Üçlü Ganyan', cifte:'Çifte', sirali_ikili:'Sıralı İkili', sirali_uclu:'Sıralı Üçlü', sirali_5li:'Sıralı 5\'li', tabela:'Tabela Bahis'};

const DEFAULT_RACE_CITIES = ['Adana','Ankara','Antalya','Bursa','Diyarbakır','Elazığ','İstanbul','İzmir','Kocaeli','Şanlıurfa'];

// --- Cross-module mutasyon için setter'lar ---
// (ES module import binding'leri salt-okunurdur; başka modüllerin bu state'i
// güncelleyebilmesi için doğrudan atama yerine bu fonksiyonlar kullanılır.)
function setDb(x,trustedLoadedSignature=false){
  const oldSignature=_lastLearningDatasetSignature || (db ? learningDatasetSignature(db) : '');
  db=x;
  // loadDB migration + sanitize sonrasında imzayı zaten doğrulayıp
  // _lastLearningDatasetSignature'a koyar. init'in aynı 3.018 koşuyu setDb içinde
  // ikinci kez taramasına gerek yok; diğer tüm setDb çağrıları tam hesabı korur.
  const newSignature=trustedLoadedSignature&&_lastLearningDatasetSignature
    ?_lastLearningDatasetSignature
    :learningDatasetSignature(db);
  if(oldSignature && oldSignature!==newSignature){
    invalidateActiveRacesCache();
    invalidateProfileMatchCache();
    invalidateWinnerProfileCache();
    invalidateConditionStatsCache();
    invalidateAdaptiveLearningCache();
    invalidateSideBetCache();
  }
  _lastLearningDatasetSignature=newSignature;
  _tkpDbRevision++;
  if(db){
    db.learning_state=db.learning_state&&typeof db.learning_state==='object'?db.learning_state:{};
    // Parçalı IndexedDB snapshot'ıyla atomik gelen imzaları açılışta doğrudan
    // kullan. Değişmemiş programı her açışta sonuçlu yarışları ve prediction_log'u
    // yeniden hashlemek yalnız gecikme üretir.
    const persistedOutcome=trustedLoadedSignature?String(db.learning_state.outcome_signature||''):'';
    _lastOutcomeLearningSignature=persistedOutcome||tkpOutcomeLearningSignature(db,true);
    db.learning_state.outcome_signature=_lastOutcomeLearningSignature;
    _tkpOutcomeLearningSignatureCache={revision:_tkpDbRevision,source:db,value:_lastOutcomeLearningSignature};
    if(trustedLoadedSignature&&!persistedOutcome&&_lastOutcomeLearningSignature){
      tkpPersistDerivedSignatureMetaSoon({outcome_signature:_lastOutcomeLearningSignature});
    }
    const persistedSide=trustedLoadedSignature?String(db.learning_state.sidebet_prediction_signature||''):'';
    const persistedSideCount=Number(db.learning_state.sidebet_prediction_signature_count);
    const sideRows=Array.isArray(db.prediction_log)?db.prediction_log:[];
    if(persistedSide&&persistedSideCount===sideRows.length){
      _sideBetSignatureCache={revision:_tkpDbRevision,epoch:_sideBetSignatureEpoch,rows:sideRows,length:sideRows.length,value:persistedSide};
    }
  }
  // Tek seferlik tarihsel snapshot backfill kullanıcı tarafından açıkça
  // başlatılır. Açılışta otomatik başlatmak 503/5M arşivde hemen arkasından
  // büyük saveDB yazımı çalıştırıp "veri yükleniyor" ekranını kilitliyordu.
  // API kapsamı çağrı anında dondurur; sonradan eklenen yarışlar hiçbir zaman
  // tarihsel backfill'e alınmaz ve normal yarış-öncesi kilit yolunda kalır.
}
function setCurrentRules(x){ currentRules = x; if(Array.isArray(x)&&x.length){tkpStoreRuleCache(x);tkpPersistFinalRuleCacheSoon();} }
// V1.1.225 HIZ MİMARİSİ KÖK FIX: eskiden dirty=true her çağrıldığında persisted
// rule_cache KOŞULSUZ siliniyordu — imza (tkpRuleCacheSignature) hâlâ eşleşse bile.
// tkpHydrateRuleCache() zaten imzayı kontrol ediyor; imza değişmediyse önbellek hâlâ
// GEÇERLİ demektir ve silmek yalnız bir sonraki getCurrentRules() çağrısını gereksiz
// yere ~29 sn'lik tam buildRules() yeniden hesaplamasına zorlar. Artık silme işlemi
// yalnız imza GERÇEKTEN değiştiğinde yapılır; davranış aynıdır, sadece gereksiz iş yok.
function setRulesDirty(x){
  rulesDirty = x;
  if(x && db?.learning_state?.rule_cache && db.learning_state.rule_cache.dataset_signature!==tkpRuleCacheSignature()){
    delete db.learning_state.rule_cache;
  }
}
function setPreviewPayload(x){ previewPayload = x; }
function setLastRaceResults(x){ lastRaceResults = x; }
