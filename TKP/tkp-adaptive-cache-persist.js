'use strict';

// =====================================================================================
// V1.1.286 ADAPTIVE SİNYAL İSTATİSTİĞİ (P1-P5) KALICI ÖNBELLEK KATMANI
// =====================================================================================
// KÖK MİMARİ FIX: adaptiveSignalStats() -- prediction-engine.js'in HER yarış
// puanlamasında çağırdığı, P1-P5 isabet oranlarını hesaplayan fonksiyon -- sonucu
// yalnız runtime Map'te (_adaptiveStatsCache) tutuyordu. Sayfa yenilenince bu Map
// sıfırlanıyor ve arşivdeki HER (şart×pist×tür×mesafe×hipodrom×tarih-kesme)
// kombinasyonu için 5 seviyeli düşen filtre + tüm sinyal taraması BAŞTAN
// çalışıyordu. Gerçek ölçekte ölçüldü: bir toplantının 6 ayağı soğuk önbellekle
// ~90 saniyeye kadar çıkabiliyor (bkz. SURUM_NOTLARI_V1.1.286.md).
//
// Bu dosya adaptiveSignalStats()'un HESAPLAMA MANTIĞINA (stats-engine.js) TEK
// SATIR DOKUNMADAN, yalnız sonucu db.learning_state'e KALICI hale getiren ince bir
// katman ekler. buildRules ile ayrım önemli: burada TAM matematiksel incremental
// birleştirme (F²/F³ tarzı) YAPILMIYOR -- her (şart-grubu × tarih-kesme) anahtarı
// kendi başına bağımsız bir sonuç olduğu için, incremental "eskiye ekle" yerine
// "bir kez hesapla, güvenle sakla, arşiv değişene kadar yeniden kullan" stratejisi
// izleniyor. Bu, buildRules kadar radikal bir hızlanma vermez ama gerçek acıyı
// (her oturumda sıfırdan tekrar) doğrudan çözer.
//
// GÜVENLİK: arşivin TAMAMI üzerinde, sıralı (zincirleme/rolling) bir parmak izi
// dizisi tutulur -- her yarışın parmak izi bir öncekiyle karıştırılarak birikir.
// Bu dizi O(arşiv) ama DOĞRUSAL (buildRules'taki F² kombinatoryal maliyetle
// KARIŞTIRILMAMALI -- burada birkaç milisaniye). Bir önbellek girdisi, oluşturulduğu
// andaki arşiv uzunluğunun O(1) bir dizi-indeksi karşılaştırmasıyla doğrulanır;
// aradaki HERHANGİ bir yarışın (yalnız en sonuncusunun değil) sonradan düzeltilmesi
// bu zincirleme yapı sayesinde yakalanır. Doğrulama: tests/adaptive-cache-persist.test.js.
// =====================================================================================

const TKP_ADAPTIVE_PERSIST_KEY = 'adaptive_stats_cache_v1';
const TKP_ADAPTIVE_PERSIST_MAX_ENTRIES = 6000; // sınırsız büyümeyi önleyen LRU tavanı

let _tkpAdaptivePersistRollingCache = {revision:-1, count:-1, rolling:null};

function _tkpAdaptivePersistRollingHashes(){
  const races = learningEligibleRaces();
  const rev = (typeof _tkpDbRevision === 'number') ? _tkpDbRevision : -1;
  const c = _tkpAdaptivePersistRollingCache;
  if (c.revision===rev && c.count===races.length && c.rolling) return c.rolling;
  const rolling = new Array(races.length);
  let acc = 0;
  for (let i=0;i<races.length;i++){
    const fp = _tkpIncrRaceContentFingerprint(races[i]);
    let h = acc;
    for (let k=0;k<fp.length;k++) h = (h*31 + fp.charCodeAt(k)) | 0;
    acc = h;
    rolling[i] = String(acc);
  }
  _tkpAdaptivePersistRollingCache = {revision:rev, count:races.length, rolling};
  return rolling;
}

function _tkpAdaptivePersistEntryValid(entry){
  if (!entry || typeof entry.raceCountAtCreation !== 'number') return false;
  if (entry.raceCountAtCreation === 0) return true; // boş önek her zaman geçerli
  const rolling = _tkpAdaptivePersistRollingHashes();
  if (entry.raceCountAtCreation > rolling.length) return false;
  return rolling[entry.raceCountAtCreation-1] === entry.rollingHashAtCreation;
}

// Bu önbellek 15 MB'a çıkabiliyor ve tamamen yeniden üretilebilir. Ana IndexedDB manifest'ine
// (tkp-segmented-idb.js) yazılmaz; ayrı UI-cache deposuna JSON metni olarak, gecikmeli ve
// UI'ya nefes vererek yazılır. Oturum başında yalnız RAM'de olmayan girdiler geri yüklenir.
// Her girdi zaten rolling-hash ile doğrulandığı için eski/eksik yan depo yalnız yavaşlık yaratır.
const TKP_ADAPTIVE_SIDECAR_KEY = 'tkp_adaptive_stats_cache_v1_sidecar';
let _tkpAdaptiveSidecarHydrated = false, _tkpAdaptiveSidecarDirty = false, _tkpAdaptiveSidecarTimer = 0;
function _tkpAdaptiveSidecarHydrate(){
  if (_tkpAdaptiveSidecarHydrated) return;
  if (typeof db === 'undefined' || !db) return; // db henüz yüklenmediyse bayrağı yakma
  _tkpAdaptiveSidecarHydrated = true;
  if (typeof tkpUiCacheGet !== 'function') return;
  Promise.resolve().then(()=>tkpUiCacheGet(TKP_ADAPTIVE_SIDECAR_KEY)).then(text=>{
    const store = db && db.learning_state && db.learning_state[TKP_ADAPTIVE_PERSIST_KEY];
    if (typeof text !== 'string' || !text){
      if (store && store.order && store.order.length) _tkpAdaptiveSidecarMarkDirty(); // eski manifest'ten gelen RAM önbelleğini yan depoya taşı
      return;
    }
    const saved = JSON.parse(text);
    if (!saved || typeof saved.entries !== 'object') return;
    const target = _tkpAdaptivePersistStore();
    for (const key of (Array.isArray(saved.order) ? saved.order : Object.keys(saved.entries))){
      if (!(key in target.entries) && saved.entries[key]){ target.entries[key] = saved.entries[key]; target.order.push(key); }
    }
    while (target.order.length > TKP_ADAPTIVE_PERSIST_MAX_ENTRIES){ const evict = target.order.shift(); delete target.entries[evict]; }
  }).catch(()=>{});
}
async function _tkpAdaptiveSidecarStringify(store){
  const parts = ['{"order":', JSON.stringify(store.order || []), ',"entries":{'];
  let clock = performance.now(), first = true;
  for (const key of Object.keys(store.entries || {})){
    if (!first) parts.push(','); first = false;
    parts.push(JSON.stringify(key), ':', JSON.stringify(store.entries[key]));
    if (performance.now()-clock >= 8){ await new Promise(r=>setTimeout(r,0)); clock = performance.now(); }
  }
  parts.push('}}');
  return parts.join('');
}
function _tkpAdaptiveSidecarMarkDirty(){
  _tkpAdaptiveSidecarDirty = true;
  if (_tkpAdaptiveSidecarTimer || typeof tkpUiCacheSet !== 'function') return;
  _tkpAdaptiveSidecarTimer = setTimeout(()=>{
    const run = async () => {
      _tkpAdaptiveSidecarTimer = 0;
      if (!_tkpAdaptiveSidecarDirty) return;
      _tkpAdaptiveSidecarDirty = false;
      try{
        const store = db && db.learning_state && db.learning_state[TKP_ADAPTIVE_PERSIST_KEY];
        if (store) await tkpUiCacheSet(TKP_ADAPTIVE_SIDECAR_KEY, await _tkpAdaptiveSidecarStringify(store));
      }catch(_e){}
    };
    if (typeof tkpRunWhenUserIdle === 'function') tkpRunWhenUserIdle(run, {minIdleMs:2000, retryMs:500, maxWaitMs:30000});
    else run();
  }, 20000);
}

function _tkpAdaptivePersistStore(){
  if (!db) return null;
  db.learning_state = db.learning_state && typeof db.learning_state==='object' ? db.learning_state : {};
  const s = db.learning_state[TKP_ADAPTIVE_PERSIST_KEY];
  if (!s || typeof s!=='object' || !s.entries) db.learning_state[TKP_ADAPTIVE_PERSIST_KEY] = {entries:{}, order:[]};
  _tkpAdaptiveSidecarHydrate();
  return db.learning_state[TKP_ADAPTIVE_PERSIST_KEY];
}

// stats._source.rows'un TAMAMINI (potansiyel binlerce yarış objesi) her anahtar
// için tekrar tekrar saklamak devasa ve gereksiz yer kaplar -- yalnız uzunluk ve
// seviye etiketi okunuyor (bkz. learning-engine-v2.js:797,850). Sadece bunlar
// serileştirilir; gerçek yarış nesneleri asla önbelleğe kopyalanmaz.
function _tkpAdaptivePersistSerialize(stats){
  const {_source, ...rest} = stats;
  return {out:rest, sample:_source.rows.length, level:_source.level};
}

function _tkpAdaptivePersistHydrate(entry){
  return {...entry.out, _source:{rows:{length:entry.sample}, level:entry.level}};
}

function tkpAdaptiveStatsPersistRead(cacheKey){
  const store = _tkpAdaptivePersistStore();
  if (!store) return null;
  const entry = store.entries[cacheKey];
  if (!entry || !_tkpAdaptivePersistEntryValid(entry)) return null;
  return _tkpAdaptivePersistHydrate(entry);
}

function tkpAdaptiveStatsPersistWrite(cacheKey, stats){
  const store = _tkpAdaptivePersistStore();
  if (!store) return;
  const races = learningEligibleRaces();
  const rolling = _tkpAdaptivePersistRollingHashes();
  const n = races.length;
  const entry = _tkpAdaptivePersistSerialize(stats);
  entry.raceCountAtCreation = n;
  entry.rollingHashAtCreation = n>0 ? rolling[n-1] : '';
  if (!(cacheKey in store.entries)) store.order.push(cacheKey);
  store.entries[cacheKey] = entry;
  while (store.order.length > TKP_ADAPTIVE_PERSIST_MAX_ENTRIES){
    const evict = store.order.shift();
    delete store.entries[evict];
  }
  _tkpAdaptiveSidecarMarkDirty();
}

// db.learning_state.rule_cache_v2 (tkp-incremental-rules.js) ile aynı ilke: bu
// katman devre dışıysa/yüklenmemişse hiçbir şeyi bozmaz -- adaptiveSignalStats()
// bu fonksiyonları `typeof ... ==='function'` ile KOŞULLU çağırır; dosya yoksa
// sessizce eski (her zaman taze, biraz daha yavaş) davranışa döner.

// V1.1.288 TOPLU ISITMA: app-controller.js'te ("post-load-prewarm" görevi) ÇOKTAN
// bağlı ama şimdiye kadar hiç TANIMLANMAMIŞ olan kancayı dolduruyor -- veri her
// yüklendiğinde (içe aktarma/dosya açma sonrası) boşta (idle, minIdleMs=1800)
// arka planda tetiklenir. Arşivdeki HER benzersiz (şart×pist×tür×mesafe×hipodrom×
// tarih-kesme) anahtarını bir kez ısıtır -- aynı anahtara düşen tekrar taranmaz.
// Sonuç zaten adaptiveSignalStats() içindeki persist katmanına yazılır (bkz.
// yukarı); bu fonksiyon yalnız O YAZMAYI TETİKLEYEN çağrıları sırayla yapar.
// Kullanıcı arayüzle etkileşime geçerse tkpQueueTask'ın minIdleMs mekanizması
// (bkz. performance-runtime.js) otomatik olarak duraklar, girdiyi bloklamaz.
async function tkpPrewarmPerformanceCaches(options={}){
  // Normal açılışta da çalışır; düşük öncelikli kuyruktan çağrıldığı için kullanıcı işini bekletmez.
  // force yalnız manuel kalibrasyonun öncelik sözleşmesini korur.
  const cooperative = options?.cooperative!==false;
  if(!db || !Array.isArray(db.races) || !db.races.length) return {warmed:0,skipped:0};
  const seenKeys=new Set();
  let warmed=0, skipped=0, processed=0;
  // A live meeting refresh needs only its own profiles; explicit full warmup keeps the default.
  const targets=Array.isArray(options.races)?options.races:db.races;
  for(const r of targets){
    if(cooperative&&!options.force&&typeof tkpWaitForBackgroundSafeWindow==='function'&&
      !await tkpWaitForBackgroundSafeWindow({minIdleMs:1200,maxWaitMs:2000}))return {warmed,skipped,paused:true};
    if(!r || !Array.isArray(r.horses) || !r.horses.length) continue;
    let key;
    try{ key=adaptiveCacheKey(r); }catch(_){ continue; }
    if(seenKeys.has(key)){ skipped++; continue; }
    seenKeys.add(key);
    try{
      if(cooperative && typeof adaptiveSignalStatsAsync==='function') await adaptiveSignalStatsAsync(r);
      else adaptiveSignalStats(r);
      if(typeof adaptiveWeightsForRace==='function') adaptiveWeightsForRace(r,1);
      if(typeof tkpPurposeWeightsForRace==='function'){
        // adaptiveSignalStats cache artık sıcak; bu iki çağrı tekrar arşiv taramaz.
        tkpPurposeWeightsForRace(r,'prediction',4);
        tkpPurposeWeightsForRace(r,'altili',1);
      }
      warmed++;
    }catch(_){ }
    processed++;
    // Win8.1/Opera: her benzersiz profil sonrası nefes ver. Tek bir uzun sync dilim kalmasın.
    if(cooperative || processed%8===0){
      if(typeof tkpYieldToUi==='function') await tkpYieldToUi();
      else if(typeof tkpYield==='function') await tkpYield();
      else await new Promise(res=>setTimeout(res,0));
    }
  }
  return {warmed,skipped};
}

// Yan depo yalnızca önbelleğe ilk erişimde yükleniyordu; manifest'ten çıkarılan önbellek bu yüzden
// hiç yazılmadan kaybolabiliyordu. Açılışta db hazır olunca bir kez yüklenir (ve RAM'deki eski
// manifest önbelleği varsa yan depoya taşınır).
if (typeof window !== 'undefined') {
  let _tkpAdaptiveBootTries = 0;
  const _tkpAdaptiveBootTimer = setInterval(() => {
    _tkpAdaptiveBootTries++;
    try { _tkpAdaptiveSidecarHydrate(); } catch (_e) {}
    if (_tkpAdaptiveSidecarHydrated || _tkpAdaptiveBootTries >= 40) clearInterval(_tkpAdaptiveBootTimer);
  }, 3000);
}
