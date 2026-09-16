const TKP_RUNTIME_VERSION='1.1.333';
// Sayfa render orkestrasyonu, event wiring ve uygulama girişi (init).

// Dağıtım yedeği ilk açılışta otomatik tohum olarak kullanılır. Meta endpoint'i
// önce yalnız birkaç byte'lık JSON döndürür; 27 MB'lık arşiv ancak gerçekten
// eksik/eski yerel kayıt varsa indirilir. Daha yeni yerel veri hiçbir zaman
// paket yedeğiyle ezilmez.
const TKP_BUNDLED_BACKUP_META_URL='/api/v1/tkp/bundled-backup/meta';
const TKP_BUNDLED_BACKUP_URL='/api/v1/tkp/bundled-backup';
const TKP_BUNDLED_BACKUP_MARKER='tkp_bundled_seed_v2';
let _tkpBundledSeedPromise=null;

function tkpBundledSeedMarker(meta){
  return [String(meta?.name||''),String(meta?.sha256||''),Number(meta?.size||0),String(meta?.maxDate||'')].join('|');
}
function tkpDbLatestDate(sourceDb){
  let latest='';
  for(const row of (sourceDb?.files||[])){
    const date=String(row?.race_date||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>latest)latest=date;
  }
  for(const row of (sourceDb?.races||[])){
    const date=String(row?.race_date||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>latest)latest=date;
  }
  return latest;
}
function tkpBundledSeedNeeded(sourceDb,meta){
  const marker=tkpBundledSeedMarker(meta);
  try{if(String(localStorage.getItem(TKP_BUNDLED_BACKUP_MARKER)||'')===marker)return false;}catch(_e){}
  const expectedFiles=Number(meta?.counts?.files||0),expectedRaces=Number(meta?.counts?.races||0);
  const currentFiles=Number(sourceDb?.files?.length||0),currentRaces=Number(sourceDb?.races?.length||0);
  // Eşit/büyük kapsam ve aynı veya daha yeni tarih, kullanıcının yerel verisidir.
  if(expectedFiles>0&&expectedRaces>0&&currentFiles>=expectedFiles&&currentRaces>=expectedRaces&&tkpDbLatestDate(sourceDb)>=String(meta?.maxDate||'')){
    try{localStorage.setItem(TKP_BUNDLED_BACKUP_MARKER,marker);}catch(_e){}
    return false;
  }
  return true;
}
function tkpBundledSeedStatus(text,error=false){
  const el=document.getElementById('persistWarning');
  if(!el)return;
  el.innerHTML=`<div class="${error?'warn':'info'}" style="margin:6px 0;padding:8px 10px;">${error?'⚠️':'⏳'} ${text}</div>`;
}
async function tkpAutoRestoreBundledBackup(sourceDb){
  if(_tkpBundledSeedPromise)return _tkpBundledSeedPromise;
  _tkpBundledSeedPromise=(async()=>{
    if(typeof Worker==='undefined')return {skipped:true,reason:'worker_unavailable'};
    try{
      const metaResponse=await fetch(TKP_BUNDLED_BACKUP_META_URL,{cache:'no-store'});
      if(!metaResponse.ok)return {skipped:true,reason:'meta_unavailable'};
      const meta=await metaResponse.json();
      if(meta?.ok!==true||!meta?.name||!Number(meta?.size))return {skipped:true,reason:'meta_invalid'};
      if(!tkpBundledSeedNeeded(sourceDb,meta))return {skipped:true,reason:'local_data_current',meta};
      tkpBundledSeedStatus(`Güncel paket kayıtları hazırlanıyor · ${meta.counts?.files||0} dosya / ${meta.counts?.races||0} koşu`);
      const response=await fetch(TKP_BUNDLED_BACKUP_URL,{cache:'no-store'});
      if(!response.ok)throw new Error('Paket yedeği sunucudan alınamadı.');
      const blob=await response.blob();
      if(Number(meta.size)>0&&Number(blob.size)!==Number(meta.size))throw new Error('Paket yedeği boyut doğrulamasını geçemedi.');
      const file=new File([blob],String(meta.name),{type:'application/gzip',lastModified:Date.now()});
      const restore=globalThis.__tkpRestoreBackupInWorker;
      if(typeof restore!=='function')throw new Error('Yedek içe aktarma motoru hazır değil.');
      const result=await restore(file,document.getElementById('persistWarning'),{auto:true,promptTitle:'Güncel paket yedeği'});
      if(result?.cancelled)return {skipped:true,reason:'cancelled',meta};
      if(result?.verified===false)throw new Error('Paket yedeğinde eksik koleksiyon algılandı: '+(result.missing||[]).join(', '));
      try{localStorage.setItem(TKP_BUNDLED_BACKUP_MARKER,tkpBundledSeedMarker(meta));}catch(_e){}
      return {restored:true,meta,result};
    }catch(error){
      console.warn('Paket yedeği otomatik açılamadı:',error);
      tkpBundledSeedStatus('Paket kayıtları otomatik alınamadı; uygulama mevcut yerel kayıtlarla açıldı. Yedekleme ekranından tekrar deneyebilirsin.',true);
      return {skipped:true,reason:'error',error};
    }
  })();
  return _tkpBundledSeedPromise;
}


let _tkpHtml2CanvasLoadPromise=null;
let _tkpCouponExtrasGeneration=0;

function tkpScheduleCouponExtras(target,raceResults){
  const generation=++_tkpCouponExtrasGeneration;
  const run=()=>{
    if(generation!==_tkpCouponExtrasGeneration || !target?.isConnected) return;
    const perf=target.querySelector('[data-coupon-performance]');
    if(perf) perf.innerHTML=couponPerformanceHTML(raceResults);
    if(typeof refreshRenderedSideBetPanel==='function') refreshRenderedSideBetPanel();
  };
  // Kupon kartlarını önce ekrana çiz. Arşiv profil geri testi ve yan bahis yenilemesi
  // aynı senkron görevde çalışırsa kupon hazır olsa bile kullanıcı uzun süre göremez.
  if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(run,{minIdleMs:900,retryMs:120,maxWaitMs:4500});
  else if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=>setTimeout(run,0));
  else setTimeout(run,0);
}
function tkpEnsureHtml2Canvas(){
  if(typeof window.html2canvas==='function') return Promise.resolve(window.html2canvas);
  if(_tkpHtml2CanvasLoadPromise) return _tkpHtml2CanvasLoadPromise;
  _tkpHtml2CanvasLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    script.async=true;
    script.onload=()=>typeof window.html2canvas==='function'
      ? resolve(window.html2canvas)
      : reject(new Error('Görüntü aracı başlatılamadı.'));
    script.onerror=()=>reject(new Error('Görüntü aracı indirilemedi.'));
    document.head.appendChild(script);
  }).catch(error=>{
    _tkpHtml2CanvasLoadPromise=null;
    throw error;
  });
  return _tkpHtml2CanvasLoadPromise;
}

function renderDashboard(){
  const finalDbCount=document.getElementById('finalDbCount');
  if(finalDbCount)finalDbCount.textContent=`Arşiv ${(db?.files||[]).length} toplantı · ${(db?.races||[]).length} koşu`;
  let s = stats();
  $('#kpis').innerHTML = [
    kpiCard('Aktif dosya', s.files),
    kpiCard('Kayıtlı koşu', s.totalRaces),
    kpiCard('Aktif analiz', s.races),
    kpiCard('At', s.horses),
    kpiCard('Kazanan', s.winners),
    kpiCard('VALUE kapsamı', s.races ? '%'+fmtPct(100*s.valueRaces/s.races) : '-'),
    kpiCard('Karantinada dosya', s.quarantine, s.quarantine>0 ? 'bad' : 'ok')
  ].join('');
  $('#coverage').innerHTML = coverageHTML();
  const rawDashLogs=db.changelog||[],logs=[];
  // V1.1.307: Ana panel 8 kayıt göstermek için 10M changelog'u kopyalayıp sort etmez.
  for(let i=rawDashLogs.length-1;i>=0&&logs.length<8;i--)logs.push(rawDashLogs[i]);
  const logTime=ts=>{const d=new Date(ts);return Number.isNaN(d.getTime())?'-':d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});};
  $('#recentLog').innerHTML = logs.length ? `<div class="tkpDashboardLogList">${logs.map(x => `<div class="tkpDashboardLogEntry"><div class="tkpDashboardLogMeta"><span class="badge">${esc(x.type)}</span><time class="muted" title="${esc(String(x.ts||''))}">${esc(logTime(x.ts))}</time></div><div class="tkpDashboardLogMessage">${esc(x.message)}</div></div>`).join('')}</div>` : '<div class="empty">Henüz kayıt yok.</div>';
  // KÖK ÇÖZÜM ("sistem geç açılıyor"): Öneriler + En iyi 5 + Mükemmel 3, hepsi
  // buildRules() kural madenciliğine bağımlı ve bu, özellik sayısı arttıkça
  // (çok hipodrom/koşu şartı) ağırlaşabiliyor. Eskiden bu üçü de Ana Panel'in
  // İLK render'ında senkron çalışıp ekran hiçbir şey göstermeden donuyordu.
  // Artık KPI/kapak/son kayıt HEMEN çizilir; ağır kural hesaplaması bir sonraki
  // tick'e ertelenir -- toplam hesap süresi aynı kalır ama kullanıcı uygulamanın
  // anında açıldığını görür, donmuş ekranla karşılaşmaz.
  const dashAdvice=$('#dashAdvice'), dashBest=$('#dashBest'), dashPerfect=$('#dashPerfect');
  const cachedRules=tkpPeekCurrentRules();
  const noRules='<div class="empty">En İyiler arka planda otomatik hazırlanıyor…</div>';
  if(dashAdvice) dashAdvice.innerHTML=adviceHTML(buildAdvice(cachedRules).slice(0,4));
  if(dashBest) dashBest.innerHTML=cachedRules?ruleTable(cachedRules.filter(x=>x.single>=db.settings.best_min_single).slice(0,TKP_BEST_RULES_SHOWN)):noRules;
  if(dashPerfect) dashPerfect.innerHTML=cachedRules?ruleTable(cachedRules.filter(x=>x.single>=db.settings.perfect_min_single&&x.rate>=db.settings.perfect_min_rate&&x.lb>=db.settings.perfect_min_lb&&x.files>=2).slice(0,TKP_PERFECT_RULES_SHOWN)):noRules;
  // Ana panel/Öneriler salt-okunur görünüm olsa da geçerli cache yoksa hesap
  // kendiliğinden başlamalıdır. Önceki sürüm yalnız Kurallar sekmesinde başlattığı
  // için kullanıcı bu ekranda dakikalarca "hazırlanıyor" yazısında kalabiliyordu.
  if(!cachedRules)tkpEnsureRulesAutoBuild({dashboard:true});
}

let _tkpAdviceRenderGeneration=0;
let _tkpRulesRenderGeneration=0;
function tkpRunAfterVisiblePaint(fn){
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(fn));
  else setTimeout(fn,16);
}
function renderAdvice(){
  const generation=++_tkpAdviceRenderGeneration;
  const list=$('#adviceList'),rules=$('#allRulesTable');
  // Öneriler salt-okunur bir görünümüdür. Geçerli kural cache'i varsa doğrudan
  // kullanılır; sekmeye her dönüşte "hazırlanıyor" kabuğu gösterip yeniden hesap
  // izlenimi ve gereksiz iki-frame DOM değişimi oluşturulmaz.
  const cachedRules=tkpPeekCurrentRules();
  if(generation!==_tkpAdviceRenderGeneration)return;
  const items=buildAdvice(cachedRules);
  if(list)list.innerHTML=adviceHTML(items);
  if(rules)rules.innerHTML=cachedRules?ruleTable(cachedRules):'<div class="empty">En İyiler arka planda otomatik hazırlanıyor…</div>';
  if(!cachedRules)tkpEnsureRulesAutoBuild();
}

let _tkpRulesBuildInFlight=null;
let _tkpRulesAutoBuildScheduled=false;
function tkpEnsureRulesAutoBuild(options={}){
  if(_tkpRulesBuildInFlight||_tkpRulesAutoBuildScheduled||typeof getCurrentRulesAsync!=='function')return _tkpRulesBuildInFlight||false;
  _tkpRulesAutoBuildScheduled=true;
  const run=async()=>{
    _tkpRulesAutoBuildScheduled=false;
    const beforePane=document.querySelector('.tab.active')?.dataset?.pane;
    // Tahmin/kupon kritik yolu mutlak önceliklidir. Kullanıcı ağır otomatik iş
    // başlamadan Tahmin'e geçtiyse kural madenciliği hiç başlatılmaz; Öneriler
    // veya Kurallar yeniden görünür olduğunda kendiliğinden tekrar kuyruğa girer.
    if(!['advice','rules'].includes(beforePane)&&!(options.dashboard===true&&beforePane==='dashboard'))return false;
    // Let a freshly clicked tab paint before a background rules job starts. If
    // a foreground operation is active, reschedule after a quiet window instead
    // of competing with Tahmin/collector work. This uses only setTimeout and
    // the idle signal, both available on Win8.1-era Chromium.
    if(typeof tkpForegroundPressureActive==='function'&&tkpForegroundPressureActive(900)){
      setTimeout(()=>{try{tkpEnsureRulesAutoBuild(options);}catch(_e){}},5000);
      return false;
    }
    _tkpRulesBuildInFlight=Promise.resolve().then(()=>getCurrentRulesAsync()).then(()=>{
      const pane=document.querySelector('.tab.active')?.dataset?.pane;
      if(pane==='dashboard')renderDashboard();
      else if(pane==='advice')renderAdvice();
      else if(pane==='rules')renderRules();
      return true;
    }).catch(error=>{
      console.error('En İyiler hazırlanamadı:',error);
      const message=`<div class="card" style="border-left:5px solid #dc2626;">En İyiler hesaplanamadı: ${esc(error?.message||String(error))}. Otomatik yeniden denenecek.</div>`;
      const pane=document.querySelector('.tab.active')?.dataset?.pane;
      if(pane==='advice'&&$('#allRulesTable'))$('#allRulesTable').innerHTML=message;
      if(pane==='rules'){
        if($('#bestTable'))$('#bestTable').innerHTML=message;
        if($('#perfectTable'))$('#perfectTable').innerHTML=message;
      }
      setTimeout(()=>{try{tkpEnsureRulesAutoBuild(options);}catch(_e){}},1200);
      return false;
    }).finally(()=>{_tkpRulesBuildInFlight=null;});
    return _tkpRulesBuildInFlight;
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask('rules-auto-build',run,{priority:'background',replace:false,minIdleMs:options.dashboard===true?5000:150});
  else setTimeout(run,options.dashboard===true?5000:0);
  return true;
}
function renderRules(){
  $('#perfMinSingleTxt').textContent = db.settings.perfect_min_single;
  $('#perfMinRateTxt').textContent = fmtPct(db.settings.perfect_min_rate*100);
  $('#perfMinLbTxt').textContent = fmtPct(db.settings.perfect_min_lb*100);
  const generation=++_tkpRulesRenderGeneration;
  if($('#bestTable'))$('#bestTable').innerHTML='<div class="empty">En iyi kurallar hazırlanıyor…</div>';
  if($('#perfectTable'))$('#perfectTable').innerHTML='<div class="empty">Mükemmel kurallar hazırlanıyor…</div>';
  tkpRunAfterVisiblePaint(()=>{
    if(generation!==_tkpRulesRenderGeneration)return;
    const active=document.querySelector('.tab.active');if(active&&active.dataset.pane!=='rules')return;
    const cachedRules=tkpPeekCurrentRules();
    const noRules='<div class="empty">En İyiler arka planda otomatik hazırlanıyor…</div>';
    if($('#bestTable'))$('#bestTable').innerHTML=cachedRules?ruleTable(cachedRules.filter(x=>x.single>=db.settings.best_min_single).slice(0,TKP_BEST_RULES_SHOWN)):noRules;
    if($('#perfectTable'))$('#perfectTable').innerHTML=cachedRules?ruleTable(cachedRules.filter(x=>x.single>=db.settings.perfect_min_single&&x.rate>=db.settings.perfect_min_rate&&x.lb>=db.settings.perfect_min_lb&&x.files>=2).slice(0,TKP_PERFECT_RULES_SHOWN)):noRules;
    if(!cachedRules)tkpEnsureRulesAutoBuild();
  });
}

function analyticsSummaryHTML(){
  let s = stats();
  const outcome=String(db?.learning_state?.outcome_signature||'');
  const calibrated=Number(outcome.split(':')[1])||s.races||0;
  return [
    kpiCard('Kayıtlı koşu', s.totalRaces),
    kpiCard('Tarihsel kalibrasyon', `${calibrated} koşu`),
    kpiCard('VALUE kapsamı', s.races ? '%'+fmtPct(100*s.valueRaces/s.races) : '-'),
    kpiCard('Toplam at', s.horses),
    kpiCard('Geçmiş kapsamı', 'TÜMÜ')
  ].join('');
}

const _tkpAnalyticsHtmlCache=new Map();
let _tkpAnalyticsRenderGeneration=0;
let _tkpAnalyticsActiveSignature='';
let _tkpAnalyticsRenderInFlight=false;
let _tkpAnalyticsRenderedOnce=false;
let _tkpAnalyticsRenderPromise=null;
// V1.1.251 KÖK FIX: eski anahtar artık yalnız temizlik için tutulur (JSON.parse
// EDİLMEZ). Ayrıntılı Analiz'in bütün ağır tabloları (kategori + adaptif öğrenme)
// burada senkron JSON.stringify + localStorage.setItem ile yazılıyordu; sekme her
// açıldığında/kapandığında ana thread'i tutup "Sayfa Yanıt Vermiyor" üretebiliyordu.
// Kalıcı anlık görüntü artık core-utils.js'teki paylaşılan IndexedDB store'unda
// asenkron tutulur.
const TKP_ANALYTICS_PERSIST_KEY='tkp_analytics_cache_v1166_perf';
const TKP_ANALYTICS_DURABLE_CACHE_KEY='tkp_analytics_cache_v2';
let _tkpAnalyticsPersistTimer=0;
// Aynı HTML açılışında birden fazla render çağrısı aynı IndexedDB okumasını
// paylaşır. Önceki tek boolean kilidi, ikinci çağrının cache hazır değilmiş gibi
// davranmasına ve kalıcı sonuç gelmeden ağır analiz başlatmasına yol açıyordu.
const _tkpAnalyticsHydrationPromises=new Map();
function tkpLoadPersistentAnalytics(signature){
  if(typeof tkpUiCacheGet!=='function')return Promise.resolve(false);
  const key=String(signature||'');
  const existing=_tkpAnalyticsHydrationPromises.get(key);
  if(existing)return existing;
  const pending=Promise.resolve().then(()=>tkpUiCacheGet(TKP_ANALYTICS_DURABLE_CACHE_KEY)).then(row=>{
    // V1.1.330: veri imzası bir toplantı silme/eklemeyle değişmiş olsa bile önceki
    // ağır tablo HTML'i geçici olarak gösterilebilir; yeni hesap arka planda tamamlanır.
    // Eski değer hiçbir zaman yeni cache diye kaydedilmez, yalnız kullanıcıyı boş
    // "Hesaplanıyor" ekranında bırakmayan görsel fallback'tir.
    if(row&&row.items&&typeof row.items==='object') window.__tkpStaleAnalyticsItems=row.items;
    if(!row||String(row.signature||'')!==key||!row.items||typeof row.items!=='object') return false;
    let added=false;
    for(const [id,html] of Object.entries(row.items)){
      // Bu tablolar kendi surumlu IndexedDB anahtariyla yasiyor. Eski toplu
      // cache'in bunlari sonradan ezmesi, duzeltilen yorumcu satirlarini geri
      // donduruyordu.
      if(['analyticsCommentatorPerformance','operationsCommentatorPerformance'].includes(id))continue;
      if(typeof html==='string'&&html.length){ _tkpAnalyticsHtmlCache.set(`${key}|${id}`,html); added=true; }
    }
    return added;
  }).catch(()=>false);
  const shared=pending.then(result=>{
    if(_tkpAnalyticsHydrationPromises.get(key)===shared)_tkpAnalyticsHydrationPromises.delete(key);
    return result;
  },error=>{
    if(_tkpAnalyticsHydrationPromises.get(key)===shared)_tkpAnalyticsHydrationPromises.delete(key);
    throw error;
  });
  _tkpAnalyticsHydrationPromises.set(key,shared);
  return shared;
}
function tkpPersistAnalyticsSoon(signature){
  clearTimeout(_tkpAnalyticsPersistTimer);
  _tkpAnalyticsPersistTimer=setTimeout(()=>{
    if(typeof tkpUiCacheSet!=='function')return;
    const items={};
    for(const [key,html] of _tkpAnalyticsHtmlCache){
      const prefix=signature+'|';
      if(!key.startsWith(prefix))continue;
      const id=key.slice(prefix.length);
      if(['analyticsCommentatorPerformance','operationsCommentatorPerformance'].includes(id))continue;
      items[id]=html;
    }
    // Fire-and-forget: IndexedDB structured clone ana thread'i senkron
    // JSON.stringify + localStorage.setItem kadar bloklamaz.
    Promise.resolve().then(()=>tkpUiCacheSet(TKP_ANALYTICS_DURABLE_CACHE_KEY,{signature,items,savedAt:Date.now()})).catch(()=>{});
  },180);
}
if(typeof tkpDropLegacyLocalStorageKeySoon==='function') tkpDropLegacyLocalStorageKeySoon(TKP_ANALYTICS_PERSIST_KEY);
if(typeof window!=='undefined') window.tkpStoreAnalyticsPanelNow=function(id,html){
  try{
    const signature=tkpAnalyticsCacheSignature();
    if(typeof html!=='string'||!html.length)return false;
    _tkpAnalyticsHtmlCache.set(`${signature}|${id}`,html);
    tkpPersistAnalyticsSoon(signature);
    const el=document.getElementById(id);if(el)el.innerHTML=html;
    return true;
  }catch(_e){return false;}
};

function tkpAnalyticsCacheSignature(){
  // R16.36: Ayrıntılı Analiz ana ekranındaki 5 temel tablo yalnız yarış/veri ve
  // sonuç durumuna bağlıdır. prediction_log / kupon / takip / changelog gibi
  // yardımcı kayıtların değişmesi bu 5 tabloyu tekrar taratamaz.
  const persisted=String(db?.learning_state?.dataset_signature||'');
  const data=persisted||(typeof learningDatasetSignature==='function'
    ? learningDatasetSignature(db)
    : `${(db?.files||[]).length}|${(db?.races||[]).length}`);
  const outcome=String(db?.learning_state?.outcome_signature||'');
  let features='';
  try{features=JSON.stringify(db?.settings?.algorithm_features||[]);}catch(_e){}
  return `ANALYTICS_CORE_V5|${data}|OUTCOME:${outcome}|FEATURES:${features}`;
}
if(typeof window!=='undefined')window.tkpAnalyticsCacheSignature=tkpAnalyticsCacheSignature;

function tkpAnalyticsTailStamp(rows,fields=[]){
  const list=Array.isArray(rows)?rows:[],last=list.length?list[list.length-1]:null;
  return [list.length,...fields.map(key=>String(last?.[key]??''))].join(':');
}
function tkpAnalyticsTableSignature(id){
  const core=tkpAnalyticsCacheSignature();
  if(['surfaceTable','breedTable','hippoTable','conditionTable','distanceTable','agfRankTableEl','conditionRankTable','valueTable','kulvarTable','accurateSpeedTable','adaptiveLearningTable'].includes(id))return `${core}|TABLE:${id}`;
  if(['analyticsCommentatorPerformance','operationsCommentatorPerformance'].includes(id)){
    return `${core}|TABLE:${id}|COMM:${tkpAnalyticsTailStamp(db?.commentator_evidence_log,['captured_at','resolved_at','source_type','author_id'])}`;
  }
  if(['signalPerfTable','hippoSignalTable','xKulisAnalysisTable'].includes(id)){
    const side=typeof sideBetPredictionLogFastRevisionSignature==='function'?sideBetPredictionLogFastRevisionSignature(db):String((db?.prediction_log||[]).length);
    return `${core}|TABLE:${id}|SIDE:${side}|FWD:${tkpAnalyticsTailStamp(db?.forward_tracking_log,['evaluated_at','created_at'])}|X:${String(db?.settings?.x_kulis_last||'')}`;
  }
  return `${core}|TABLE:${id}`;
}

function tkpAnalyticsTablesComplete(){
  const pane=document.getElementById('pane-analytics');
  const ids=['surfaceTable','breedTable','hippoTable','conditionTable','conditionRankTable','agfRankTableEl','distanceTable','valueTable','signalPerfTable','hippoSignalTable','accurateSpeedTable','xKulisAnalysisTable','kulvarTable','adaptiveLearningTable'];
  return ids.every(id=>{
    const el=document.getElementById(id);
    if(!el||(pane&&!pane.contains(el)))return true;
    return !!el.querySelector('tbody tr, .empty:not([data-analytics-pending="1"]):not(.tkpAnalyticsPending), .card:not(.tkpAnalyticsPending)');
  });
}

function tkpScheduleAnalyticsWork(fn,urgent=false){
  // Bazı Chrome/Edge sürümlerinde yoğun ana iş parçacığında requestIdleCallback
  // timeout verilse bile çok geç çalışabiliyor. Her işi tek-seferlik bir koruyucu
  // setTimeout ile de tetikle; ilk çalışan diğerini etkisiz bırakır.
  let done=false;
  const run=()=>{ if(done) return; done=true; fn(); };
  if(urgent){
    const fallback=setTimeout(run,80);
    if(typeof requestAnimationFrame==='function') return requestAnimationFrame(()=>{clearTimeout(fallback);run();});
    return fallback;
  }
  if(typeof tkpRunWhenUserIdle==='function') return tkpRunWhenUserIdle(run,{minIdleMs:700,retryMs:100,maxWaitMs:5000});
  return setTimeout(run,250);
}

function renderAnalytics(){
  const signature=tkpAnalyticsCacheSignature();
  const analyticsPane=document.getElementById('pane-analytics');
  const sameStableView=_tkpAnalyticsActiveSignature===signature
    &&(_tkpAnalyticsRenderInFlight||(_tkpAnalyticsRenderedOnce&&analyticsPane
      &&!analyticsPane.querySelector('[data-analytics-pending="1"],.tkpAnalyticsPending')
      &&tkpAnalyticsTablesComplete()));
  if(sameStableView)return _tkpAnalyticsRenderPromise||Promise.resolve(true);
  if(_tkpAnalyticsRenderInFlight&&_tkpAnalyticsActiveSignature===signature&&_tkpAnalyticsRenderPromise){
    return _tkpAnalyticsRenderPromise;
  }
  _tkpAnalyticsActiveSignature=signature;
  _tkpAnalyticsRenderInFlight=true;
  _tkpAnalyticsRenderedOnce=false;
  $('#analyticsSummary').innerHTML = analyticsSummaryHTML();
  const portfolioTarget=document.getElementById('historicalPortfolioAnalysis');
  if(portfolioTarget)portfolioTarget.innerHTML=typeof historicalPortfolioAnalysisHTML==='function'?historicalPortfolioAnalysisHTML():'';
  const commentatorTarget=document.getElementById('analyticsCommentatorPerformance');
  if(commentatorTarget)tkpRenderTransferredAnalyticsTable('analyticsCommentatorPerformance',()=>tkpCommentatorPerformanceHTML());
  // Adaptif tablo aynı veri imzasıyla zaten ekrandaysa DOM'u koru. Böylece sekme
  // açılışında ne "Hesaplanıyor" yanıp söner ne de model yeniden çalışır.
  const keepAdaptiveTable=typeof adaptiveLearningCacheIsCurrent==='function'
    && adaptiveLearningCacheIsCurrent()
    && !!document.querySelector('#adaptiveLearningTable tbody tr');
  const tasks=[
    ['surfaceTable',()=>categoryTable('surface')],
    ['breedTable',()=>categoryTable('breed')],
    ['hippoTable',()=>categoryTable('hippodrome')],
    ['conditionTable',()=>categoryTable('condition_family')],
    ['conditionRankTable',()=>conditionRankTable()],
    ['agfRankTableEl',()=>agfRankTable()],
    ['distanceTable',()=>categoryTable('distance_group')],
    ['valueTable',()=>valueSpecificTable()],
    ['signalPerfTable',()=>signalPerformanceHTML()],
    ['hippoSignalTable',()=>hippodromeSignalHTML()],
    ['accurateSpeedTable',()=>accurateSpeedSignalHTML()],
    ['xKulisAnalysisTable',()=>xKulisAnalysisHTML()],
    ['kulvarTable',()=>kulvarBandHTML()],
    // V1.1.308-MEM-FIX: bu görev artık asenkron/bölünmüş sürümü çağırır (bkz.
    // ui-components.js adaptiveLearningHTMLAsync) -- aşağıdaki step() bunun
    // döndürdüğü Promise'i UI'yi kilitlemeden bekler.
    ['adaptiveLearningTable',()=>(typeof adaptiveLearningHTMLAsync==='function'?adaptiveLearningHTMLAsync():adaptiveLearningHTML())]
  ].filter(([id])=>{
    const el=document.getElementById(id);
    return !!el && (!analyticsPane||analyticsPane.contains(el)) && !(id==='adaptiveLearningTable' && keepAdaptiveTable);
  });
  const generation=++_tkpAnalyticsRenderGeneration;
  tasks.forEach(([id])=>{
    const el=document.getElementById(id), cached=_tkpAnalyticsHtmlCache.get(`${signature}|${id}`);
    if(el) el.innerHTML=cached===undefined?'<div class="empty tkpAnalyticsPending" data-analytics-pending="1">Hesaplanıyor…</div>':cached;
  });
  // Kalıcı cache hydrate tamamlanmadan pending listesi oluşturulmaz. Böylece
  // HTML yeniden açıldığında IndexedDB'deki sonuçlar önce RAM'e alınır; hazır
  // analizler için hesap fonksiyonları hiç çağrılmaz.
  let pendingToRun=[];
  window.__tkpAnalyticsForceBuild=false;
  let i=0;
  let resolveRender,renderPromise;
  renderPromise=new Promise(resolve=>{resolveRender=resolve;});
  _tkpAnalyticsRenderPromise=renderPromise;
  const finishRender=(ok)=>{
    if(_tkpAnalyticsRenderPromise===renderPromise)_tkpAnalyticsRenderPromise=null;
    resolveRender(ok!==false);
  };
  function step(){
    if(generation!==_tkpAnalyticsRenderGeneration){
      if(_tkpAnalyticsRenderPromise===renderPromise)_tkpAnalyticsRenderInFlight=false;
      finishRender(false);
      return;
    }
    const active=document.querySelector('.tab.active');
    if(active&&active.dataset.pane!=='analytics'&&window.__tkpAnalyticsForceBuild!==true){
      _tkpAnalyticsRenderInFlight=false;
      finishRender(false);
      return;
    }
    const job=pendingToRun[i++];
    if(!job){_tkpAnalyticsRenderInFlight=false;_tkpAnalyticsRenderedOnce=true;finishRender(true);return;}
    const [id,fn]=job, el=document.getElementById(id);
    const advance=()=>{
      if(i<pendingToRun.length)tkpScheduleAnalyticsWork(step,i<3);
      else{_tkpAnalyticsRenderInFlight=false;_tkpAnalyticsRenderedOnce=true;finishRender(true);}
    };
    if(!el || generation!==_tkpAnalyticsRenderGeneration){ advance(); return; }
    // V1.1.251: asenkron IndexedDB hydrate bu adımdan önce yetişmiş olabilir;
    // öyleyse gereksiz yeniden hesaplama yapılmaz, hazır sonuç kullanılır.
    const already=_tkpAnalyticsHtmlCache.get(`${signature}|${id}`);
    if(already!==undefined){
      el.innerHTML=already;
      advance();
      return;
    }
    const store=(html)=>{
      _tkpAnalyticsHtmlCache.set(`${signature}|${id}`,html);
      tkpPersistAnalyticsSoon(signature);
      // Birden fazla veri kümesi arasında geçişte belleğin sınırsız büyümesini engelle.
      if(_tkpAnalyticsHtmlCache.size>56){
        const oldest=_tkpAnalyticsHtmlCache.keys().next().value;
        _tkpAnalyticsHtmlCache.delete(oldest);
      }
      if(generation===_tkpAnalyticsRenderGeneration) el.innerHTML=html;
    };
    let result;
    try{ result=fn(); }
    catch(e){
      store(`<div class="card" style="border-left:5px solid #dc2626;">Tablo hesaplanamadı: ${esc(e?.message||String(e))}</div>`);
      advance();
      return;
    }
    if(result && typeof result.then==='function'){
      // V1.1.308-MEM-FIX: bazı görevler (ör. Kendini Güncelleyen Model Ailesi
      // Analizi) artık asenkron/bölünmüş -- sonucu beklerken bu adım UI'yi
      // kilitlemez; sonuç gelince normal sırayla devam eder.
      result.then(html=>{ store(html); advance(); })
        .catch(e=>{
          store(`<div class="card" style="border-left:5px solid #dc2626;">Tablo hesaplanamadı: ${esc(e?.message||String(e))}</div>`);
          advance();
        });
      return;
    }
    store(result);
    advance();
  }
  const beginAfterHydration=()=>{
    if(generation!==_tkpAnalyticsRenderGeneration || _tkpAnalyticsActiveSignature!==signature){
      _tkpAnalyticsRenderInFlight=false;
      finishRender(false);
      return;
    }
    pendingToRun=tasks.filter(([id])=>!_tkpAnalyticsHtmlCache.has(`${signature}|${id}`));
    // Kullanıcı kuralı: bütün Ayrıntılı Analiz tabloları cache yoksa bir kez
    // cooperative kuyruğa girer; kalıcı cache güncelse pending listesi boştur.
    tasks.forEach(([id])=>{
      const el=document.getElementById(id);
      if(!el||!el.querySelector('[data-analytics-pending="1"],.tkpAnalyticsPending'))return;
      const cached=_tkpAnalyticsHtmlCache.get(`${signature}|${id}`);
      if(cached!==undefined)el.innerHTML=cached;
    });
    tkpScheduleAnalyticsWork(step,true);
  };
  // IndexedDB okuması hata verse bile hesaplama bir kez devam eder; hata
  // durumunda kullanıcı sonsuz "Hesaplanıyor" ekranında bırakılmaz.
  tkpLoadPersistentAnalytics(signature).then(beginAfterHydration,beginAfterHydration);
  return renderPromise;
}

// Analitik tablolar üç merkeze dağıtılmıştır. R16.36'da her taşınmış tablo
// kendi imzası + kendi IndexedDB kaydıyla yaşar. Tek bir yorumcu/kupon değişikliği
// artık Pist/Tür/Hipodrom gibi ilgisiz tabloların kalıcı cache'ini bozmaz.
const _tkpTransferredAnalyticsInFlight=new Map();
// Tablo sıralama/işleme mantığı değiştiğinde eski HTML cache'i boş satırları
// geri getirmesin; yeni sürüm anahtarıyla tablo bir kez yeniden hesaplanır.
const TKP_TRANSFERRED_ANALYTICS_DURABLE_PREFIX='tkp_transferred_analytics_v7:';
async function tkpReadTransferredAnalytics(id,signature){
  if(typeof tkpUiCacheGet!=='function')return '';
  try{
    const row=await tkpUiCacheGet(TKP_TRANSFERRED_ANALYTICS_DURABLE_PREFIX+id);
    return row&&String(row.signature||'')===String(signature||'')&&typeof row.html==='string'&&row.html.length?row.html:'';
  }catch(_e){return '';}
}
function tkpWriteTransferredAnalytics(id,signature,html){
  if(typeof tkpUiCacheSet!=='function'||typeof html!=='string'||!html.length)return false;
  Promise.resolve().then(()=>tkpUiCacheSet(TKP_TRANSFERRED_ANALYTICS_DURABLE_PREFIX+id,{version:2,signature,html,savedAt:Date.now()})).catch(()=>{});
  return true;
}
function tkpRenderTransferredAnalyticsTable(id,builder){
  const el=document.getElementById(id);if(!el||typeof builder!=='function')return Promise.resolve(false);
  const signature=tkpAnalyticsTableSignature(id),cacheKey=`${signature}|${id}`;
  // Yorumcu tablosu da veri/sonuç imzasına bağlı kalıcı cache kullanır. Menü
  // değişiminde veya yeniden açılışta aynı arşiv tekrar hesaplanmaz.
  const forceFresh=false;
  if(forceFresh)_tkpAnalyticsHtmlCache.delete(cacheKey);
  const cached=forceFresh?undefined:_tkpAnalyticsHtmlCache.get(cacheKey);
  if(cached!==undefined){if(el.innerHTML!==cached)el.innerHTML=cached;return Promise.resolve(true);}
  const existing=_tkpTransferredAnalyticsInFlight.get(cacheKey);if(existing)return existing;
  el.innerHTML='<div class="empty tkpAnalyticsPending" data-analytics-pending="1">Hazır tablo yükleniyor…</div>';
  const run=Promise.resolve(forceFresh?'':tkpReadTransferredAnalytics(id,signature)).then(hydrated=>{
    if(hydrated){_tkpAnalyticsHtmlCache.set(cacheKey,hydrated);el.innerHTML=hydrated;return true;}
    return new Promise(resolve=>{
      const calculate=()=>{
        const store=(html)=>{html=String(html||'');_tkpAnalyticsHtmlCache.set(cacheKey,html);if(!forceFresh)tkpWriteTransferredAnalytics(id,signature,html);el.innerHTML=html;resolve(true);};
        try{
          const result=builder();
          if(result&&typeof result.then==='function')result.then(store).catch(error=>{el.innerHTML=`<div class="card" style="border-left:5px solid #dc2626;">Tablo hesaplanamadı: ${esc(error?.message||String(error))}</div>`;resolve(false);});
          else store(result);
        }catch(error){el.innerHTML=`<div class="card" style="border-left:5px solid #dc2626;">Tablo hesaplanamadı: ${esc(error?.message||String(error))}</div>`;resolve(false);}
      };
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(calculate));else setTimeout(calculate,0);
    });
  }).finally(()=>_tkpTransferredAnalyticsInFlight.delete(cacheKey));
  _tkpTransferredAnalyticsInFlight.set(cacheKey,run);return run;
}

// Veri/sonuç imzası gerçekten değiştiğinde mevcut analiz görünümünü iptal et.
// Sıradan saveDB() çağrıları yalnız _tkpDbRevision'i artırıyorsa stable imza aynı
// kalır ve HTML yeniden açılışında hiçbir tablo tekrar hesaplanmaz.
if(typeof window!=='undefined') window.addEventListener('tkp:db-changed',()=>{
  let next='';
  try{next=tkpAnalyticsCacheSignature();}catch(_e){return;}
  if(_tkpAnalyticsActiveSignature && next!==_tkpAnalyticsActiveSignature){
    _tkpAnalyticsRenderGeneration++;
    _tkpAnalyticsActiveSignature='';
    _tkpAnalyticsRenderedOnce=false;
  }
});

if(typeof window!=='undefined'){
  window.tkpPrepareAnalyticsNow=function(){
    window.__tkpAnalyticsForceBuild=true;
    _tkpAnalyticsActiveSignature='';
    try{renderAnalytics();}catch(e){console.error('Ayrıntılı analiz hazırlama hatası:',e);}
  };
}

function tkpScheduleAnalyticsIdlePrewarm(){
  if(window.__tkpAnalyticsIdlePrewarmTimer)return false;
  window.__tkpAnalyticsIdlePrewarmTimer=setTimeout(()=>{
    window.__tkpAnalyticsIdlePrewarmTimer=0;
    // Gizli tabloları hesaplama: YOK. Yalnız küçük IndexedDB cache kaydı okunur.
    // Bunu başka bir readiness/idle kapısına bağlamak Win8.1/Opera'da tam 60 sn
    // bekleme zincirini yeniden oluşturuyordu; 150 ms timer sonrası doğrudan başlat.
    const signature=tkpAnalyticsCacheSignature();
    Promise.resolve(tkpLoadPersistentAnalytics(signature)).then(hit=>{
      window.__tkpAnalyticsIdleHydrated={signature,hit:!!hit,at:Date.now()};
    }).catch(error=>console.error('Ayrıntılı analiz cache hazırlama hatası:',error));
  },150);
  return true;
}

// Büyük arşivde CSV için bütün soğuk geçmişi RAM'e çağırmak 10M güvenlik
// mimarisini tek düğmeyle bozar. Tam ham arşiv .tkbz yedeğinde korunur; CSV
// yalnız açık/sıcak pencereyi taşır ve dosya adı ile kullanıcı mesajı bunu açıkça belirtir.
const TKP_CSV_SAFE_EXPORT_MAX_ROWS=25000;
function tkpCsvExportScope(){
  let safe=false;
  try{safe=Boolean(db?.__segmented_storage?.safeMode);}catch(_e){}
  if(!safe)try{safe=Boolean(typeof persistenceStatus==='function'&&persistenceStatus()?.safeMode);}catch(_e){}
  return {safe,limit:safe?TKP_CSV_SAFE_EXPORT_MAX_ROWS:0};
}
function tkpCsvRowsForExport(){
  const scope=tkpCsvExportScope(),rows=masterRows(scope.limit);
  const info={limited:scope.safe,limit:scope.limit,rows:rows.length,kind:scope.safe?'hot_window':'full_materialized'};
  try{globalThis.__tkpLastCsvExportInfo=info;}catch(_e){}
  return {rows,info};
}
function tkpCsvExportFilename(){
  const info=globalThis.__tkpLastCsvExportInfo||{};
  return 'TKP_CORE_MASTER_'+new Date().toISOString().slice(0,10)+(info.limited?'_SICAK_PENCERE':'')+'.csv';
}
function tkpCsvExportNotice(){
  const info=globalThis.__tkpLastCsvExportInfo||{};
  if(!info.limited)return;
  const message=`Büyük arşiv koruması: CSV yalnız sıcak penceredeki ilk ${info.rows}/${info.limit} satırı içerir. Tam ham arşiv .tkbz yedeğinde korunur.`;
  try{if(typeof alert==='function')alert(message);}catch(_e){}
}
function csvText(){
  const {rows}=tkpCsvRowsForExport(),cols=Object.keys(rows[0]||{});
  let q = v => '"' + String(v??'').replace(/"/g,'""') + '"';
  return '\ufeff' + [cols.join(';'), ...rows.map(r => cols.map(c=>q(r[c])).join(';'))].join('\r\n');
}

async function csvTextAsync(){
  const {rows}=tkpCsvRowsForExport(),cols=Object.keys(rows[0]||{}),q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const chunks=['\ufeff'+cols.join(';')];
  const batch=400;
  for(let start=0;start<rows.length;start+=batch){
    const end=Math.min(rows.length,start+batch),lines=[];
    for(let i=start;i<end;i++)lines.push(cols.map(c=>q(rows[i][c])).join(';'));
    chunks.push(lines.join('\r\n'));
    if(typeof tkpFrameCheckpoint==='function')await tkpFrameCheckpoint(true);
    else if(typeof tkpYieldToUi==='function')await tkpYieldToUi();
  }
  return chunks.join('\r\n');
}

async function downloadMasterCsv(){
  const text=await csvTextAsync();
  download(tkpCsvExportFilename(),text,'text/csv;charset=utf-8');
  tkpCsvExportNotice();
}

function csvFromRows(rows, columns){
  const q = v => '"' + String(v??'').replace(/"/g,'""') + '"';
  return '\ufeff' + [
    columns.map(c=>c.label).join(';'),
    ...rows.map(r => columns.map(c=>q(r[c.key])).join(';'))
  ].join('\r\n');
}

function download(name, text, type){
  let a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text],{type}));
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function tkpPredictionLogScoreValue(rec){
  if(!rec)return null;
  for(const key of ['score','prediction_score_snapshot','predicted_score','tkp_score','pre_race_tkp_score']){
    const value=rec[key];
    if(value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value)))return Number(value);
  }
  return null;
}
function tkpPredictionLogPreferred(previous,candidate){
  if(!previous)return candidate;
  const trusted=rec=>/PRE[-_ ]?RACE|FROZEN|LOCKED/i.test(String(rec?.strategy_version||rec?.source||rec?.integrity||''));
  const a=trusted(previous),b=trusted(candidate);
  if(a!==b)return b?candidate:previous;
  // Aynı yarış için ilk yarış-öncesi kayıt otoritedir; sonuçtan sonra oluşmuş daha
  // yeni bir satır eski tahmini değiştiremez.
  const at=String(previous?.ts||previous?.batch_ts||previous?.created_at||'9999');
  const bt=String(candidate?.ts||candidate?.batch_ts||candidate?.created_at||'9999');
  return bt<at?candidate:previous;
}
let _predictionLogLookupCache={signature:'',exact:new Map(),base:new Map(),name:new Map(),exactAnyAlt:new Map(),baseAnyAlt:new Map(),nameAnyAlt:new Map(),fileAlt:new Map()};
function predictionLogScoreRecord(r,h){
  const rows=Array.isArray(db?.prediction_log) ? db.prediction_log : [];
  if(!rows.length) return null;
  const signature=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${rows.length}|${(db?.files||[]).length}`;
  if(_predictionLogLookupCache.signature!==signature){
    const exact=new Map(),baseMap=new Map(),nameMap=new Map(),exactAnyAlt=new Map(),baseAnyAlt=new Map(),nameAnyAlt=new Map(),fileAlt=new Map();
    for(const f of (db?.files||[]))fileAlt.set(String(f.id),Number(f.altili_no)||1);
    const keep=(map,key,rec)=>map.set(key,tkpPredictionLogPreferred(map.get(key),rec));
    for(const rec of rows){
      if(tkpPredictionLogScoreValue(rec)===null)continue;
      const date=String(rec?.race_date||''), hip=fold(rec?.hippodrome||''), leg=String(rec?.leg||''), alt=Number(rec?.altili_no)||1;
      const prefix=`${date}|${hip}|${leg}|${alt}|`;
      const anyPrefix=`${date}|${hip}|${leg}|`;
      const recNo=String(rec?.horse_no||''), recBase=String(ekuriBase(recNo)||recNo), recName=fold(rec?.horse_name||'');
      if(recNo){keep(exact,prefix+recNo,rec);keep(exactAnyAlt,anyPrefix+recNo,rec);}
      if(recBase){keep(baseMap,prefix+recBase,rec);keep(baseAnyAlt,anyPrefix+recBase,rec);}
      if(recName){keep(nameMap,prefix+recName,rec);keep(nameAnyAlt,anyPrefix+recName,rec);}
    }
    _predictionLogLookupCache={signature,exact,base:baseMap,name:nameMap,exactAnyAlt,baseAnyAlt,nameAnyAlt,fileAlt};
  }
  const date=String(r?.race_date||''), hip=fold(r?.hippodrome||''), leg=String(r?.leg||'');
  const raceAlt=Number(r?.altili_no)||_predictionLogLookupCache.fileAlt.get(String(r?.file_id))||1;
  const prefix=`${date}|${hip}|${leg}|${raceAlt}|`;
  const no=String(h?.horse_no||''), base=String(ekuriBase(no)||no), name=fold(h?.horse_name||'');
  const anyPrefix=`${date}|${hip}|${leg}|`;
  const candidates=[_predictionLogLookupCache.exact.get(prefix+no),_predictionLogLookupCache.base.get(prefix+base),_predictionLogLookupCache.name.get(prefix+name),
    _predictionLogLookupCache.exactAnyAlt.get(anyPrefix+no),_predictionLogLookupCache.baseAnyAlt.get(anyPrefix+base),_predictionLogLookupCache.nameAnyAlt.get(anyPrefix+name)].filter(Boolean);
  if(!candidates.length)return null;
  return candidates.reduce((best,rec)=>tkpPredictionLogPreferred(best,rec),null);
}

function sealDisplayedPredictionScore(r,h,scoredHorse,hasConfirmedResult){
  // SONUÇ KİLİDİ: Sonuç eklendikten sonra tahmin yeniden hesaplanmaz. Yarış öncesinde
  // ekranda görünen TKP/why/tek kararının snapshot'ı geri yüklenir; sonuç yalnızca
  // TUTTU/TUTMADI ve derece alanlarını günceller.
  const postTime=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked([r]);
  const historicalCalibration=Number(r?.historical_calibration_set)===1 || (typeof globalThis.tkpHistoricalCalibrationRace==='function'&&globalThis.tkpHistoricalCalibrationRace(r));
  if(h.profile_strength_pct===null||h.profile_strength_pct===undefined||h.profile_strength_pct===''){
    try{if(typeof profileStrengthPct==='function')h.profile_strength_pct=profileStrengthPct(r,scoredHorse||h);}catch(_e){}
  }
  if(historicalCalibration){
    Object.assign(h,{score:scoredHorse.score,why:Array.isArray(scoredHorse.why)?scoredHorse.why.slice():[],bestLb:scoredHorse.bestLb,scoreParts:scoredHorse.scoreParts?JSON.parse(JSON.stringify(scoredHorse.scoreParts)): {}});
    if(typeof capturePredictionScoreSnapshot==='function') capturePredictionScoreSnapshot(h,true,true);
  }else if((hasConfirmedResult||postTime) && hasPredictionScoreSnapshot(h)){
    applyPredictionScoreSnapshot(h);
  }else{
    Object.assign(h,{
      score:scoredHorse.score,
      why:Array.isArray(scoredHorse.why)?scoredHorse.why.slice():[],
      bestLb:scoredHorse.bestLb,
      scoreParts:scoredHorse.scoreParts ? JSON.parse(JSON.stringify(scoredHorse.scoreParts)) : {}
    });
    // Snapshot yalnız yarış saatinden önce alınır. Yarış/sonuç sonrası eski bir
    // dosyada snapshot yoksa güncel skor gösterilebilir ama öğrenme/backtest kanıtı
    // olarak asla kilitlenmez.
    if(!hasConfirmedResult&&!postTime)capturePredictionScoreSnapshot(h,false,true);
  }
  Object.assign(scoredHorse,{
    score:h.score,
    why:Array.isArray(h.why)?h.why.slice():[],
    bestLb:h.bestLb ?? 0,
    scoreParts:h.scoreParts ? JSON.parse(JSON.stringify(h.scoreParts)) : {},
    prediction_score_snapshot:h.prediction_score_snapshot,
    prediction_score_parts_snapshot:h.prediction_score_parts_snapshot,
    prediction_why_snapshot:h.prediction_why_snapshot,
    prediction_best_lb_snapshot:h.prediction_best_lb_snapshot,
    prediction_score_snapshot_at:h.prediction_score_snapshot_at,
    prediction_score_model_version:h.prediction_score_model_version,
    prediction_score_locked:h.prediction_score_locked,
    prediction_tkp_display_raw_snapshot:h.prediction_tkp_display_raw_snapshot,
    prediction_tkp_display_score_snapshot:h.prediction_tkp_display_score_snapshot,
    prediction_tkp_display_scale_snapshot:h.prediction_tkp_display_scale_snapshot,
    prediction_visible_tkp_raw_snapshot:h.prediction_visible_tkp_raw_snapshot,
    prediction_visible_tkp_snapshot:h.prediction_visible_tkp_snapshot,
    prediction_visible_tkp_scale_version:h.prediction_visible_tkp_scale_version,
    prediction_common_evidence_snapshot:h.prediction_common_evidence_snapshot,
    prediction_legacy_score_snapshot:h.prediction_legacy_score_snapshot,
    prediction_prior_starts_snapshot:h.prediction_prior_starts_snapshot,
    prediction_prior_wins_snapshot:h.prediction_prior_wins_snapshot,
    prediction_cond_starts_snapshot:h.prediction_cond_starts_snapshot,
    prediction_cond_wins_snapshot:h.prediction_cond_wins_snapshot,
    prediction_profile_strength_snapshot:h.prediction_profile_strength_snapshot,
    priorStarts:h.priorStarts,priorWins:h.priorWins,condWinStarts:h.condWinStarts,condWinWins:h.condWinWins,
    profile_strength_snapshot:h.profile_strength_snapshot
  });
  return scoredHorse;
}

function sealStrategicPredictionOrder(r, scoredRows, hasConfirmedResult){
  const rows=(scoredRows||[]).slice();
  const forceCurrentOrder=(typeof globalThis!=='undefined' && String(globalThis.__tkpForceCurrentOrderFileId??'')===String(r?.file_id??'')) || Number(r?.historical_calibration_set)===1 || (typeof globalThis.tkpHistoricalCalibrationRace==='function'&&globalThis.tkpHistoricalCalibrationRace(r));
  if(hasConfirmedResult && !forceCurrentOrder){
    const rankOf=(h)=>{
      const saved=Number(h?.prediction_order_snapshot);
      if(Number.isFinite(saved) && saved>0) return saved;
      const rec=predictionLogScoreRecord(r,h);
      const logged=Number(rec?.common_rank || rec?.predicted_rank);
      return Number.isFinite(logged) && logged>0 ? logged : 9999;
    };
    const known=rows.filter(h=>rankOf(h)<9999).length;
    if(known){
      rows.sort((a,b)=>rankOf(a)-rankOf(b) || (Number(b.score)||0)-(Number(a.score)||0) || TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
      rows.forEach((h,i)=>{h._strategy_rank=i+1; if(!Number.isFinite(Number(h.prediction_order_snapshot))) h.prediction_order_snapshot=i+1;});
      return rows;
    }
  }
  const ordered=strategicOrderForRace(r,rows);
  const postTime=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked([r]);
  ordered.forEach((h,i)=>{if(!hasConfirmedResult&&!postTime)h.prediction_order_snapshot=i+1; h._strategy_rank=i+1;});
  return ordered;
}

// Tek seferlik tarihsel snapshot köprüsü. Migrasyon başladığı anda RAM'de bulunan
// sonuçlu arşiv kapsamı dondurulur; daha sonra eklenen yarışlar bu listeye giremez.
// Böylece mevcut 503 toplantı değerlendirme için doldurulabilirken yeni yarışlarda
// yalnız gerçek yarış-öncesi capture yolu geçerlidir.
const TKP_HISTORICAL_SNAPSHOT_BACKFILL_VERSION='HISTORICAL_ARCHIVE_SNAPSHOT_R16_63';
const _tkpHistoricalSnapshotScheduled=new WeakSet();
function tkpHistoricalSnapshotBackfillScope(sourceDb=db){
  if(!sourceDb||typeof sourceDb!=='object')return [];
  sourceDb.settings=sourceDb.settings||{};
  if(sourceDb.settings.historical_snapshot_backfill_version===TKP_HISTORICAL_SNAPSHOT_BACKFILL_VERSION)return [];
  return (sourceDb.races||[]).filter(race=>(race?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0));
}
function tkpHistoricalSnapshotRankValue(horse){
  for(const key of ['prediction_order_snapshot','_strategy_rank','altili_winner_rank','online_hybrid_rank','sidebet_p1_rank','v27_backtest_rank','agf_rank']){
    const value=Number(horse?.[key]);if(Number.isFinite(value)&&value>0)return value;
  }
  return 9999;
}
function tkpHistoricalSnapshotScoreValue(horse,rank){
  for(const key of ['prediction_score_snapshot','pre_race_tkp_score','score','altili_winner_score','sidebet_p1_score','v27_backtest_score']){
    const raw=horse?.[key];
    if(raw==null||String(raw).trim()==='')continue;
    const value=Number(raw);if(Number.isFinite(value)&&value>0)return value;
  }
  // Sonuçtan/ranktan TKP üretmek yarış sonrası bilgi sızıntısıdır. Doğrulanmış bir
  // yarış-öncesi skor yoksa arşiv satırı kilitlenmez ve ekranda "-" gösterilir.
  return null;
}
async function tkpBackfillHistoricalSnapshotsOnce(sourceDb=db,scope=null){
  if(!sourceDb||typeof sourceDb!=='object')return {meetings:0,races:0,horses:0,skipped:true};
  sourceDb.settings=sourceDb.settings||{};
  if(sourceDb.settings.historical_snapshot_backfill_version===TKP_HISTORICAL_SNAPSHOT_BACKFILL_VERSION)return sourceDb.settings.historical_snapshot_backfill_stats||{meetings:0,races:0,horses:0,skipped:true};
  const targets=Array.isArray(scope)?scope.slice():tkpHistoricalSnapshotBackfillScope(sourceDb);
  const filesById=new Map((sourceDb.files||[]).map(file=>[String(file?.id),file]));
  const touchedFiles=new Set();let races=0,horses=0,preserved=0,missingScore=0,missingRank=0;
  const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  for(let raceIndex=0;raceIndex<targets.length;raceIndex++){
    if(sourceDb!==db)return {meetings:touchedFiles.size,races,horses,aborted:true};
    const race=targets[raceIndex],rows=(race?.horses||[]).filter(Boolean);
    if(typeof tkpRepairArchivedRaceSnapshot==='function'){
      const repaired=tkpRepairArchivedRaceSnapshot(sourceDb,race);
      horses+=repaired.changed;preserved+=repaired.preserved;missingScore+=repaired.missingScore;missingRank+=repaired.missingRank;
      if(repaired.changed){race.historical_snapshot_backfill=1;touchedFiles.add(String(race.file_id));}
      races++;
      if((raceIndex+1)%12===0){if(typeof tkpYield==='function')await tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));}
      continue;
    }
    const ordered=rows.slice().sort((left,right)=>tkpHistoricalSnapshotRankValue(left)-tkpHistoricalSnapshotRankValue(right)||tkpHistoricalSnapshotScoreValue(right,9999)-tkpHistoricalSnapshotScoreValue(left,9999)||TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no||''),String(right?.horse_no||'')));
    const rankByHorse=new Map(ordered.map((horse,index)=>[horse,index+1]));
    for(const horse of rows){
      const rank=rankByHorse.get(horse)||9999;
      const existingRaw=horse?.prediction_score_snapshot;
      const existing=existingRaw!=null&&String(existingRaw).trim()!==''&&Number.isFinite(Number(existingRaw))&&Number(existingRaw)>0;
      const recovered=existing?Number(existingRaw):tkpHistoricalSnapshotScoreValue(horse,rank);
      if(existing)preserved++;
      if(!Number.isFinite(Number(horse.prediction_order_snapshot))||Number(horse.prediction_order_snapshot)<1)horse.prediction_order_snapshot=rank;
      if(recovered==null){
        horse.prediction_score_locked=0;
        horse.prediction_snapshot_provenance='HISTORICAL_ARCHIVE_UNVERIFIED_NO_PRE_RACE_SCORE';
        horse.prediction_snapshot_verified_pre_race=0;
        horse.historical_snapshot_backfill_version=TKP_HISTORICAL_SNAPSHOT_BACKFILL_VERSION;
        horses++;
        continue;
      }
      horse.prediction_score_snapshot=recovered;
      if(!horse.prediction_score_parts_snapshot||typeof horse.prediction_score_parts_snapshot!=='object')horse.prediction_score_parts_snapshot={historical_archive_existing_score:1};
      if(!Array.isArray(horse.prediction_why_snapshot))horse.prediction_why_snapshot=['Arşivde mevcut yarış-öncesi TKP'];
      if(horse.prediction_best_lb_snapshot===undefined)horse.prediction_best_lb_snapshot=horse.bestLb??null;
      horse.prediction_score_locked=1;
      horse.prediction_snapshot_provenance=horse.prediction_snapshot_provenance||'HISTORICAL_ARCHIVE_EXISTING_SCORE';
      horse.prediction_snapshot_verified_pre_race=0;
      horse.historical_snapshot_backfill_version=TKP_HISTORICAL_SNAPSHOT_BACKFILL_VERSION;
      horses++;
    }
    race.historical_snapshot_backfill=1;race.historical_snapshot_verified=0;race.historical_snapshot_mode='RECONSTRUCTED_FROM_EXISTING_ARCHIVE';
    touchedFiles.add(String(race.file_id));races++;
    if((raceIndex+1)%12===0){if(typeof tkpYield==='function')await tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));}
  }
  const completedAt=new Date().toISOString();
  for(const fileId of touchedFiles){const file=filesById.get(fileId);if(file){file.historical_snapshot_backfill=1;file.historical_snapshot_verified=0;file.historical_snapshot_mode='RECONSTRUCTED_FROM_EXISTING_ARCHIVE';file.historical_snapshot_backfilled_at=completedAt;}}
  const ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const stats={meetings:touchedFiles.size,races,horses,preserved,missingScore,missingRank,durationMs:Math.round((ended-started)*10)/10,completedAt,scopeLockedBeforeRun:true,newRacesExcluded:true};
  sourceDb.settings.historical_snapshot_backfill_version=TKP_HISTORICAL_SNAPSHOT_BACKFILL_VERSION;
  sourceDb.settings.historical_snapshot_backfill_stats=stats;
  sourceDb.changelog=Array.isArray(sourceDb.changelog)?sourceDb.changelog:[];
  sourceDb.changelog.push({ts:completedAt,type:'MIGRATION',message:`Tek seferlik tarihsel snapshot backfill: ${stats.meetings} toplantı, ${stats.races} koşu, ${stats.horses} at. Yeni yarışlar kapsam dışı ve yarış-öncesi kilide tabidir.`});
  globalThis.__tkpLastHistoricalSnapshotBackfill=stats;
  try{if(typeof window!=='undefined')window.__tkpMaintenanceDirty=true;}catch(_e){}
  try{if(sourceDb===db&&typeof saveDB==='function')await saveDB(false);}catch(error){console.warn('Tarihsel snapshot backfill kayıt uyarısı',error);}
  return stats;
}
function tkpScheduleHistoricalSnapshotBackfill(sourceDb=db){
  if(!sourceDb||typeof sourceDb!=='object'||_tkpHistoricalSnapshotScheduled.has(sourceDb))return false;
  const scope=tkpHistoricalSnapshotBackfillScope(sourceDb);if(!scope.length)return false;
  _tkpHistoricalSnapshotScheduled.add(sourceDb);
  const run=()=>tkpBackfillHistoricalSnapshotsOnce(sourceDb,scope).catch(error=>console.warn('Tarihsel snapshot backfill uyarısı',error));
  if(typeof setTimeout==='function')setTimeout(run,0);else Promise.resolve().then(run);
  return true;
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpBackfillHistoricalSnapshotsOnce=tkpBackfillHistoricalSnapshotsOnce;
  globalThis.tkpScheduleHistoricalSnapshotBackfill=tkpScheduleHistoricalSnapshotBackfill;
}

function learningMatrixColumns(){
  return [
    ['data_role','Veri Rolü'],['file','Dosya'],['source','Kaynak'],['record_type','Kayıt Tipi'],['qc_status','QC'],['result_source','Sonuç Kaynağı'],
    ['date','Tarih'],['hippodrome','Hipodrom'],['leg','Ayak'],['surface','Pist'],['breed','Tür'],['distance','Mesafe'],['distance_group','Mesafe Grubu'],['condition_family','Koşu Ailesi'],['condition','Koşu Şartı'],
    ['horse_no','At No'],['horse_name','At Adı'],['non_runner','Koşmaz'],
    ['agf','AGF'],['agf_rank','AGF Sıra'],['sonuc_puani','SONUÇ Puanı'],['sonuc_sirasi','SONUÇ Sıra'],['ypuan','Y.PUAN'],['kg','KG'],['derece','DERECE'],['kg_signal','KG Sinyal'],['derece_signal','DERECE Sinyal'],['jbyg','J-BYG'],['g800','400G/800G'],['hndkp','HNDKP'],['s_value','S'],['tr_puan','TR PUAN'],['value_score','VALUE'],['sp','SP'],
    ['bmb','BMB'],['bmb_source','BMB Kaynağı'],['odb','ODB'],
    ['x_kulis_guven','X Kulis Güven %'],['x_kulis_yon','X Kulis Yön'],['x_kulis_ypuan_farki','X Kulis Y.PUAN Farkı'],['x_kulis_yorum_sayisi','X Kulis Yorum Sayısı'],['x_kulis_kupona_al','X Kulis Kupona Al'],['x_kulis_tek_boz','X Kulis TEK Boz'],
    ['tkp_score','TKP'],['predicted_rank','Tahmin Sırası'],['common_rank','Ortak Sıra'],['screen_score_rank','Genel Bakış Skor Sırası'],['score_band','Skor Bandı'],['why_count','Destek Sayısı'],
    ['score_rules','Puan Kural'],['score_bmb','Puan BMB'],['score_result6','Puan SONUÇ6'],['score_horse_hist','Puan At Geçmişi'],['score_condition_hist','Puan Şart Geçmişi'],['score_rank','Puan Sıra'],['score_kg','Puan KG'],['score_derece','Puan DERECE'],
    ['profile_strength_pct','Profil Gücü %'],['condition_single_strength','Koşu Uyumu'],['history_strength','Geçmiş Gücü'],['matched_rule_strength','Kural Gücü'],['profile_match_level','Profil Düzeyi'],['profile_match_sample','Profil Örnek'],
    ['ayak_guveni_yuzde','Ayak Güveni %'],['tek_esigi_yuzde','TEK Eşiği %'],['tek_adayi','TEK Adayı'],['tek_karari','TEK Kararı'],['kupon_core_flag','Kupon Çekirdek'],['yan_bahis_sira_1','Yan Bahis Tahmin 1'],['yan_bahis_sira_2','Yan Bahis Tahmin 2'],['yan_bahis_sira_3','Yan Bahis Tahmin 3'],['yan_bahis_sira_4','Yan Bahis Tahmin 4'],['yan_bahis_sira_5','Yan Bahis Tahmin 5'],['yan_bahis_ikili','Yan Bahis İlk2'],['yan_bahis_uclu','Yan Bahis İlk3'],['yan_bahis_tabela','Yan Bahis İlk4/Tabela'],
    ['finish_position','Gerçek Derece'],['winner','Kazandı mı'],['label_known','Etiket Var'],['label_top2','İlk 2'],['label_top3','İlk 3'],['label_top4','İlk 4'],['label_top5','İlk 5'],
    ['notes','Destek Notları']
  ].map(([key,label])=>({key,label}));
}

function matrixRaceIdentity(r){
  if(r && r.id!=null) return 'id:'+String(r.id);
  return ['race',String(r?.race_date||''),fold(r?.hippodrome||''),String(r?.leg||''),fold(r?.condition_family||r?.condition_text||''),String(r?.distance||'')].join('|');
}

function matrixHorseKeys(r,h){
  const date=String(r?.race_date||'');
  const hip=fold(r?.hippodrome||'');
  const leg=String(r?.leg||'');
  const no=String(h?.horse_no||'');
  const base=String(ekuriBase(no)||no);
  const name=(typeof baseHorseName==='function') ? baseHorseName(h?.horse_name) : fold(h?.horse_name||'');
  return [
    `id:${r?.id}|no:${no}`,
    `id:${r?.id}|base:${base}`,
    `m:${date}|${hip}|${leg}|no:${no}`,
    `m:${date}|${hip}|${leg}|base:${base}`,
    `m:${date}|${hip}|${leg}|name:${name}`
  ];
}

function buildCurrentScoreIndex(){
  const out=new Map();
  if(!Array.isArray(lastRaceResults)) return out;
  for(const x of lastRaceResults){
    const scored=(x.scored||[]).filter(h=>!isNonRunner(h));
    const scoreDesc=(typeof predictionDisplayRows==='function')
      ? predictionDisplayRows({r:x.r,scored},Infinity,'score-desc').rows
      : scored.slice().sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
    const scoreRank=new Map(scoreDesc.map((h,i)=>[String(h.horse_no),i+1]));
    scored.forEach((h,i)=>{
      const rec={horse:h,predicted_rank:i+1,common_rank:i+1,screen_score_rank:scoreRank.get(String(h.horse_no))||''};
      matrixHorseKeys(x.r,h).forEach(k=>{ if(!out.has(k)) out.set(k,rec); });
    });
  }
  return out;
}

function buildPredictionLogIndex(){
  const out=new Map();
  const rows=(db.prediction_log||[]).slice().sort((a,b)=>String(a.ts||'').localeCompare(String(b.ts||'')));
  for(const rec of rows){
    const date=String(rec.race_date||'');
    const hip=fold(rec.hippodrome||'');
    const leg=String(rec.leg||'');
    const no=String(rec.horse_no||'');
    const name=fold(rec.horse_name||'');
    [`m:${date}|${hip}|${leg}|no:${no}`,`m:${date}|${hip}|${leg}|name:${name}`].forEach(k=>out.set(k,rec));
  }
  return out;
}

function learningMatrixRaceEntries(){
  const entries=[], byId=new Map();
  const add=(r,current=null)=>{
    if(!r) return;
    const key=matrixRaceIdentity(r);
    const existing=byId.get(key);
    if(existing){ if(current) existing.current=current; return; }
    const item={r,current};
    byId.set(key,item);
    entries.push(item);
  };
  try { learningEligibleRaces().slice().sort((a,b)=>(a.race_date||'').localeCompare(b.race_date||'') || TKP_TR_COLLATOR.compare((a.hippodrome||''),b.hippodrome||'') || (Number(a.leg)||0)-(Number(b.leg)||0)).forEach(r=>add(r)); } catch(_){}
  if(Array.isArray(lastRaceResults)) lastRaceResults.forEach(x=>add(x.r,x));
  return entries;
}


function v25SortRowsByHighPercentThenScore(rows){
  return (rows||[]).slice().sort((a,b)=>{
    const pct = r => Math.max(
      Number(r?.ayak_guveni_yuzde)||0,
      Number(r?.profile_strength_pct)||0,
      Number(r?.condition_single_strength)||0,
      Number(r?.history_strength)||0,
      Number(r?.matched_rule_strength)||0,
      Number(r?.tkp_score)||0
    );
    const pa=pct(a), pb=pct(b);
    if(pb!==pa) return pb-pa;
    return (Number(b?.tkp_score)||0)-(Number(a?.tkp_score)||0) ||
      (Number(a?.predicted_rank)||999)-(Number(b?.predicted_rank)||999);
  });
}


async function learningMatrixRows(onProgress){
  const fileById=new Map((db.files||[]).map(f=>[f.id,f]));
  const currentIndex=buildCurrentScoreIndex();
  const logIndex=buildPredictionLogIndex();
  const rows=[];
  const raceEntries=learningMatrixRaceEntries();
  // V1.1.323 HIZ/KASMA DÜZELTMESİ: bu döngü arşivdeki HER yarış için
  // strategicOrderForRace/detailedProfileMatch/dynamicSingleDecision gibi ağır tahmin
  // fonksiyonlarını çağırıyordu. Buton hiç yokken (V1.1.322'ye kadar) bu kod hiç
  // tetiklenmiyordu; buton eklenince 3000+ yarışlık arşivde tek senkron çağrı ana
  // thread'i saniyelerce kilitleyip düşük donanımda (Win 8.1) kasmaya yol açardı.
  // tkpStartJob/tkpJobCheckpoint ile kooperatif hale getirildi: her yarıştan sonra
  // checkpoint kontrolü yapılır, bütçe aşılırsa tarayıcıya devredilir (tkpYieldToUi).
  const job=typeof tkpStartJob==='function'?tkpStartJob('learning-matrix-export',{budgetMs:12,total:raceEntries.length,chunkSize:6}):null;
  let processed=0;
  for(const entry of raceEntries){
    if(job&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(job,processed++,raceEntries.length);
    else processed++;
    if(typeof onProgress==='function'&&(processed%50===0||processed===raceEntries.length)){try{onProgress(processed,raceEntries.length);}catch(_){}}
    const r=entry.r;
    const f=fileById.get(r.file_id)||{};
    const resultKnown=(typeof raceHasConfirmedResult==='function') ? raceHasConfirmedResult(r.horses||[]) : (r.horses||[]).some(h=>Number(h.winner)===1 || Number(h.finish_position)>0);
    const profileMatch=(typeof detailedProfileMatch==='function') ? detailedProfileMatch(r,5) : {level:'',rows:[]};
    let legDecision=null, legOrder=[];
    try {
      legOrder=(typeof strategicOrderForRace==='function') ? strategicOrderForRace(r, (entry.current?.scored||r.horses||[])) : [];
      const first=legOrder[0]||null, second=legOrder[1]||null;
      if(first && typeof dynamicSingleDecision==='function'){
        const s1=typeof conditionSingleStrength==='function'?conditionSingleStrength(r,first):0;
        const s2=second&&typeof conditionSingleStrength==='function'?conditionSingleStrength(r,second):0;
        legDecision=dynamicSingleDecision({r,scored:legOrder,strictPool:legOrder},first,second,s1,s1-s2);
      }
    } catch(_) { legDecision=null; legOrder=[]; }
    const legTkpTop4=new Set((typeof tkpOrderedForLeg==='function'?tkpOrderedForLeg({r,scored:legOrder}):legOrder).slice(0,4).map(h=>String(h.horse_no)));
    const legAgfTop4=new Set((legOrder||[]).filter(h=>Number(h.agf_rank)>=1&&Number(h.agf_rank)<=4).map(h=>String(h.horse_no)));
    const legYpuanTop4=new Set((legOrder||[]).filter(h=>(Number(h.ypuan)||0)>0).sort((a,b)=>(Number(b.ypuan)||0)-(Number(a.ypuan)||0)).slice(0,4).map(h=>String(h.horse_no)));
    for(const h0 of (r.horses||[])){
      const keys=matrixHorseKeys(r,h0);
      const cur=keys.map(k=>currentIndex.get(k)).find(Boolean)||null;
      const logRec=keys.map(k=>logIndex.get(k)).find(Boolean)||null;
      const h=cur?.horse || h0;
      const scoreParts=h.scoreParts||{};
      const tkp=Number.isFinite(Number(h.score)) ? Number(h.score) : (Number.isFinite(Number(h0.score)) ? Number(h0.score) : '');
      const fp=Number(h0.finish_position||h.finish_position||0);
      const isWinner=Number(h0.winner)===1 || Number(h.winner)===1 || fp===1;
      const labelKnown=resultKnown?1:0;
      const nonRunner=isNonRunner(h0)?1:0;
      const role=nonRunner?'exclude_non_runner':(resultKnown?'train':'predict_pending');
      rows.push({
        data_role:role,
        file:f.filename||r.filename||'',
        source:f.original_filename||'',
        record_type:f.record_type||'',
        qc_status:f.qc_status||'',
        result_source:f.result_source||'',
        date:r.race_date||'',
        hippodrome:r.hippodrome||'',
        leg:r.leg||'',
        surface:r.surface||'',
        breed:r.breed||'',
        distance:r.distance??'',
        distance_group:r.distance_group || (typeof distanceGroup==='function'?distanceGroup(r.distance):''),
        condition_family:r.condition_family||'',
        condition:r.condition_text||'',
        horse_no:h0.horse_no||'',
        horse_name:h0.horse_name||'',
        non_runner:nonRunner,
        agf:h.agf??h0.agf??'',
        agf_rank:h.agf_rank??h0.agf_rank??'',
        sonuc_puani:h.result_score??h0.result_score??'',
        sonuc_sirasi:h.result_rank??h0.result_rank??'',
        ypuan:h.ypuan??h0.ypuan??'',
        kg:h.weight_kg??h0.weight_kg??'',
        derece:h.best_time??h0.best_time??'',
        kg_signal:typeof tkpKgSignalValue==='function'?tkpKgSignalValue(r,h):'',
        derece_signal:typeof tkpDegreeSignalValue==='function'?tkpDegreeSignalValue(r,h):'',
        jbyg:h.jbyg??h0.jbyg??'',
        g800:h.g800??h0.g800??'',
        hndkp:h.hndkp??h0.hndkp??'',
        s_value:h.s_value??h0.s_value??'',
        tr_puan:(()=>{const a=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;const b=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h0):null;return a!==null?a:(b!==null?b:'');})(),
        value_score:h.value_score??h0.value_score??'',
        sp:h.sp??h0.sp??'',
        bmb:Number(h.bmb??h0.bmb)===1?1:0,
        bmb_source:h.bmb_source??h0.bmb_source??'',
        odb:(typeof isOdbCandidate==='function' && isOdbCandidate(h))?1:0,
        x_kulis_guven:Number.isFinite(Number(h.x_kulis_score))?Number(h.x_kulis_score):'',
        x_kulis_yon:h.x_kulis_direction||'',
        x_kulis_ypuan_farki:Number.isFinite(Number(h.x_ypuan_delta))?Number(h.x_ypuan_delta):'',
        x_kulis_yorum_sayisi:Array.isArray(h.x_kulis_comments)?h.x_kulis_comments.length:0,
        x_kulis_kupona_al:h.x_force_coupon===true?1:0,
        x_kulis_tek_boz:h.x_break_single===true?1:0,
        tkp_score:tkp,
        predicted_rank:cur?.predicted_rank || logRec?.predicted_rank || '',
        common_rank:cur?.common_rank || logRec?.common_rank || '',
        screen_score_rank:cur?.screen_score_rank || '',
        score_band:tkp!=='' && typeof scoreBand==='function' ? scoreBand(tkp).key : (logRec?.score_band||''),
        why_count:Array.isArray(h.why)?h.why.length:'',
        score_rules:scoreParts.rules??'',
        score_bmb:scoreParts.bmb??'',
        score_result6:scoreParts.result6??'',
        score_horse_hist:scoreParts.horseHist??'',
        score_condition_hist:scoreParts.condHist??'',
        score_rank:scoreParts.rank??'',
        score_kg:scoreParts.kg??'',
        score_derece:scoreParts.degree??'',
        profile_strength_pct:typeof profileStrengthPct==='function'?profileStrengthPct(r,h):'',
        condition_single_strength:typeof conditionSingleStrength==='function'?conditionSingleStrength(r,h):'',
        history_strength:typeof historyStrengthForCandidate==='function'?historyStrengthForCandidate(h):'',
        matched_rule_strength:typeof matchedRuleStrength==='function'?matchedRuleStrength(r,h):'',
        profile_match_level:profileMatch.level||'',
        profile_match_sample:Array.isArray(profileMatch.rows)?profileMatch.rows.length:'',
        ayak_guveni_yuzde:legDecision?.confidence??'',
        tek_esigi_yuzde:legDecision?.threshold??70,
        tek_adayi:legDecision?.first && String(legDecision.first.horse_no)===String(h.horse_no)?1:0,
        tek_karari:legDecision?.isSingle?1:0,
        kupon_core_flag:(legTkpTop4.has(String(h.horse_no))||legAgfTop4.has(String(h.horse_no))||legYpuanTop4.has(String(h.horse_no))||(Number(h.ypuan)||0)>8||Number(h.bmb)===1||(typeof isOdbCandidate==='function'&&isOdbCandidate(h)))?1:0,
        yan_bahis_sira_1:logRec?.sidebet_rank_p1??h.sidebet_p1_rank??'',
        yan_bahis_sira_2:logRec?.sidebet_rank_p2??h.sidebet_p2_rank??'',
        yan_bahis_sira_3:logRec?.sidebet_rank_p3??h.sidebet_p3_rank??'',
        yan_bahis_sira_4:logRec?.sidebet_rank_p4??h.sidebet_p4_rank??'',
        yan_bahis_sira_5:logRec?.sidebet_rank_p5??h.sidebet_p5_rank??'',
        yan_bahis_ikili:labelKnown?(fp>=1&&fp<=2?1:0):'',
        yan_bahis_uclu:labelKnown?(fp>=1&&fp<=3?1:0):'',
        yan_bahis_tabela:labelKnown?(fp>=1&&fp<=4?1:0):'',
        finish_position:fp||'',
        winner:labelKnown?(isWinner?1:0):'',
        label_known:labelKnown,
        label_top2:labelKnown?(fp>=1&&fp<=2?1:0):'',
        label_top3:labelKnown?(fp>=1&&fp<=3?1:0):'',
        label_top4:labelKnown?(fp>=1&&fp<=4?1:0):'',
        label_top5:labelKnown?(fp>=1&&fp<=5?1:0):'',
        notes:Array.isArray(h.why)?h.why.join(' | '):''
      });
    }
  }
  return rows;
}

async function learningMatrixCsvText(){
  return csvFromRows(await learningMatrixRows(), learningMatrixColumns());
}

async function downloadLearningMatrixCsv(){
  const btn=$('#downloadLearningMatrix'), statusEl=$('#learningMatrixStatus');
  if(btn){ if(btn.disabled) return; btn.disabled=true; } // çift tıklamayla iki paralel ağır tarama başlatılmasın
  if(statusEl) statusEl.textContent='⏳ Öğrenme matrisi hazırlanıyor…';
  try{
    const rows=await learningMatrixRows((done,total)=>{
      if(statusEl) statusEl.textContent=`⏳ Öğrenme matrisi hazırlanıyor… ${done}/${total}`;
    });
    if(!rows.length){
      if(statusEl) statusEl.textContent='İndirilecek öğrenme satırı yok. Önce yarış/sonuç verisi yükle.';
      return;
    }
    download('TKP_ÖĞRENME_MATRİSİ_' + new Date().toISOString().slice(0,10) + '.csv', csvFromRows(rows, learningMatrixColumns()), 'text/csv;charset=utf-8');
    if(statusEl) statusEl.textContent=`${rows.length} at satırı öğrenme matrisi olarak indirildi.`;
  }catch(e){
    if(statusEl) statusEl.textContent='❌ Öğrenme matrisi oluşturulamadı: '+String(e?.message||e);
  }finally{
    if(btn) btn.disabled=false;
  }
}

// --- Hatırlanan klasöre otomatik .tkbz yedeği kaydetme ---
// Ana yedek formatı .tkbz'dir. İlk seferde kullanıcı bir klasör seçebilir; seçilen
// klasör IndexedDB'de hatırlanır. File System Access API yoksa veya izin verilmezse
// güvenli biçimde normal tarayıcı indirmesine düşer.
function openHandleDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tkp_fs_handles', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getSavedDirHandle(){
  try {
    const db2 = await openHandleDB();
    return await new Promise((resolve) => {
      const tx = db2.transaction('handles','readonly').objectStore('handles').get('backupDir');
      tx.onsuccess = () => {const value=tx.result||null;db2.close();resolve(value);};
      tx.onerror = () => resolve(null);
    });
  } catch(e){ return null; }
}
async function setSavedDirHandle(handle){
  try {
    const db2 = await openHandleDB();
    await new Promise((resolve, reject) => {
      const tx = db2.transaction('handles','readwrite');
      const store=tx.objectStore('handles');
      if(handle)store.put(handle,'backupDir');else store.delete('backupDir');
      tx.oncomplete = () => {db2.close();resolve();};
      tx.onerror = () => {db2.close();reject(tx.error);};
    });
  } catch(e){}
}
function tkpDownloadBlob(name, blob){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function prepareRememberedBackupDir(){
  if(!window.showDirectoryPicker)return null;
  try{
    let handle=await getSavedDirHandle();
    if(handle){
      let perm=await handle.queryPermission({mode:'readwrite'});
      if(perm!=='granted')perm=await handle.requestPermission({mode:'readwrite'});
      if(perm==='granted')return handle;
    }
    handle=await window.showDirectoryPicker({mode:'readwrite'});
    await setSavedDirHandle(handle);
    return handle;
  }catch(e){
    if(e?.name==='NotFoundError')await setSavedDirHandle(null);
    if(e?.name!=='AbortError')console.warn('Yedek klasörü seçilemedi; normal indirme kullanılacak:',e);
    return null;
  }
}
async function saveBlobToRememberedFolder(name,blob,preparedHandle=undefined){
  try{
    // Explicit null means the user chose download, or folder preparation failed.
    // Do not retry the same stale directory after a long export.
    const handle=preparedHandle===undefined?await getSavedDirHandle():preparedHandle;
    if(handle){
      let perm=await handle.queryPermission({mode:'readwrite'});
      if(perm!=='granted')perm=await handle.requestPermission({mode:'readwrite'});
      if(perm==='granted'){
        const fileHandle=await handle.getFileHandle(name,{create:true});
        const writable=await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      }
    }
  }catch(e){
    if(e?.name==='NotFoundError')await setSavedDirHandle(null);
    console.warn('Yedek klasörüne yazılamadı; normal indirme kullanılacak:',e);
  }
  tkpDownloadBlob(name,blob);
  return false;
}

function masterRows(maxRows=0){
  if (typeof tkpMasterRowsFast === 'function') return tkpMasterRowsFast(maxRows);
  let out = [];
  let fileById = new Map(db.files.map(f => [f.id, f]));
  for (const r of db.races){
    let f = fileById.get(r.file_id);
    for (const h of r.horses){ out.push(typeof globalThis.tkpHistoricalHorseFeatureVector==='function'
      ? globalThis.tkpHistoricalHorseFeatureVector(r,h,f)
      : {file:f?.filename||r.filename,status:f?.status||'',date:r.race_date,hippodrome:r.hippodrome,leg:r.leg,surface:r.surface,breed:r.breed,condition:r.condition_text,distance:r.distance,horse_no:h.horse_no,horse:h.horse_name,agf:h.agf,kg:h.weight_kg,best_time:h.best_time,g800:h.g800,hndkp:h.hndkp,s_value:h.s_value,tr:(typeof tkpTrustedGcTrValue==='function'?(tkpTrustedGcTrValue(h)??''):''),value:h.value_score,sp:h.sp,result:h.result_score,bmb:h.bmb,finish_position:h.finish_position,winner:h.winner}); if(Number(maxRows)>0&&out.length>=Number(maxRows))return out; }
  }
  return out;
}

function renderData(){
  const q = $('#searchData')?.value || '';
  if (typeof tkpDataTableHTML === 'function') {
    // 23 sütunlu tabloda 150 satır bile 3.450 hücredir. Büyük arşivde arama da
    // sınırlı sıcak pencerede yapılır; tek tuşla milyonlarca at satırı üretilmez.
    $('#dataTable').innerHTML = tkpDataTableHTML(q, 150);
    return;
  }
  let rows = masterRows(3000).filter(x => !q || fold(Object.values(x).join(' ')).includes(fold(q))).slice(0,150);
  $('#dataTable').innerHTML = `<div class="tableWrap"><table><thead><tr><th>Dosya</th><th>Durum</th><th>Tarih</th><th>Hipodrom</th><th>Ayak</th><th>Pist</th><th>Tür</th><th>Koşu</th><th>Mesafe</th><th>No</th><th>At</th><th>AGF</th><th>KG</th><th>DERECE</th><th>800G</th><th>HNDKP</th><th>S</th><th>TR PUAN</th><th>VALUE</th><th>SP</th><th>SONUÇ</th><th>BMB</th><th>Derece</th></tr></thead><tbody>${
    rows.map(x => `<tr class="${x.winner ? 'actualWinnerRow' : ''}"><td>${esc(x.file)}</td><td>${esc(x.status)}</td><td>${esc(displayDateTR(x.date||''))}</td><td>${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(x.hippodrome):x.hippodrome)}</td><td>${x.leg}</td><td>${esc(x.surface)}</td><td>${esc(x.breed)}</td><td>${esc(x.condition)}</td><td>${x.distance??''}</td><td>${esc(x.horse_no)}</td><td>${esc(x.horse)}</td><td>${x.agf??''}</td><td>${x.kg??''}</td><td>${esc(x.best_time??'')}</td><td>${x.g800??''}</td><td>${x.hndkp??''}</td><td>${x.s_value??''}</td><td>${x.tr??''}</td><td>${x.value??''}</td><td>${x.sp??''}</td><td>${x.result??''}</td><td>${x.bmb?'BMB':''}</td><td>${x.finish_position??''}</td></tr>`).join('') || '<tr><td colspan="23" class="empty">Veri yok.</td></tr>'
  }</tbody></table></div><p class="muted" style="margin-top:8px;">Hız için ilk 400 kayıt gösterilir; arama tüm veride çalışır.</p>`;
}

function tkpQcOdsFilename(sequenceNo, hippodrome, altiliNo=1, altiliCount=1){
  const seq=String(Number(sequenceNo)||0).padStart(3,'0');
  let hip = '';
  try { hip = canonicalHippodrome(hippodrome || ''); } catch(_e){ hip = hippodrome || ''; }
  const altNo=Math.max(1,Number(altiliNo)||1);
  const altSuffix=(Number(altiliCount)>1 || altNo>1) ? `-${altNo}ALT` : '';
  if(!hip || hip==='BİLİNMİYOR') return `TKP_AI_${seq}${altSuffix}.ods`;
  hip = String(hip).toLocaleUpperCase('tr-TR').replace(/\s+/g,'');
  return `TKP_AI_${seq}-${hip}${altSuffix}.ods`;
}

function tkpOdsDownloadFilename(fileLike){
  const f=fileLike||{};
  let seq=f.sequence_no;
  const rawName=String(f.filename||f.original_filename||'');
  const seqMatch=rawName.match(/TKP[_ -]*(?:AI|AL)[_ -]*(\d{1,4})/i);
  if((seq==null || seq==='') && seqMatch) seq=Number(seqMatch[1]);
  const seqText=String(Number(seq)||0).padStart(3,'0');
  let hip = canonicalHippodrome(f.hippodrome || tkpExtractHipFromSourceName(rawName) || '');
  const altNo=Math.max(1,Number(f.altili_no)||1);
  const altSuffix=(Number(f.altili_count)>1 || altNo>1) ? `-${altNo}ALT` : '';
  if(!hip || hip==='BİLİNMİYOR') return `TKP_AI_${seqText}${altSuffix}.ods`;
  hip = String(hip).toLocaleUpperCase('tr-TR').replace(/\s+/g,'');
  return `TKP_AI_${seqText}-${hip}${altSuffix}.ods`;
}

function tkpOdsDownloadBase(fileLike){
  return tkpOdsDownloadFilename(fileLike).replace(/\.ods$/i,'');
}

function tkpSourceHipDisplay(hip){
  const h=canonicalHippodrome(hip||'');
  if(!h || h==='BİLİNMİYOR') return '';
  // Kullanıcı kaynak adlarında kısa görünüm istedi: DEL MAR -> DELMAR HTML.
  if(h==='DEL MAR') return 'DELMAR';
  return h;
}

function tkpExtractHipFromSourceName(name){
  const raw=String(name||'');
  const folded=fold(raw).replace(/[_.]+/g,' ').replace(/[-–—]+/g,' ').replace(/\s+/g,' ').trim();
  const known=[
    'İSTANBUL','ISTANBUL','İZMİR','IZMIR','ANKARA','BURSA','ADANA','KOCAELİ','KOCAELI',
    'ELAZIĞ','ELAZIG','DİYARBAKIR','DIYARBAKIR','ŞANLIURFA','SANLIURFA',
    'DEL MAR','DELMAR','SARATOGA','SANTA ANITA','SANTA ANITA PARK','GULFSTREAM','GULFSTREAM PARK','KEENELAND','PARX','PARX RACING','DELAWARE','DELAWARE PARK','HORSESHOE INDIANAPOLIS','FINGER LAKES','WOODBINE','CLUB HIPICO SANTIAGO','CLUB HIPICO DE SANTIAGO','CLUB HÍPICO SANTIAGO','CLUB HÍPICO DE SANTIAGO','MONT DE MARSAN','MONT-DE-MARSAN'
  ];
  for(const k of known){
    const kk=fold(k).replace(/[-–—]+/g,' ');
    if(folded.includes(kk)) return canonicalHippodrome(k);
  }
  const rawNoExt=raw.replace(/\.(ods|html?)$/i,'');
  const m=rawNoExt.match(/[-–—]\s*([^\n\r]+?)\s+(?:TJK\s+)?Yar[ıi]ş/i)
    || rawNoExt.match(/(^|\s)([A-Za-zÇĞİÖŞÜçğıöşü\- ]{3,}?)\s+(?:TJK\s+)?Yar[ıi]ş/i);
  const candidate=m ? (m[2] || m[1] || '').trim() : '';
  return candidate ? canonicalHippodrome(candidate) : '';
}

function tkpPublicSourceName(name, fallbackHip=''){
  const raw=String(name||'').trim();
  const hip=tkpSourceHipDisplay(tkpExtractHipFromSourceName(raw) || fallbackHip);
  const seqMatch=raw.match(/TKP[_ -]*(?:AI|AL)[_ -]*(\d{1,4})/i);
  if(seqMatch) return `TKP_AI_${String(Number(seqMatch[1])||0).padStart(3,'0')}`;

  if(/\.html?$/i.test(raw) || /\bHTML\b/i.test(raw) || /Yar[ıi]ş\s+(Program[ıi]|Sonuçlar[ıi]|B[üu]lteni)/i.test(raw)){
    return hip ? `${hip} HTML` : 'HTML';
  }
  if(/\.ods$/i.test(raw) || /\bODS\b/i.test(raw)){
    return hip ? `${hip} ODS` : 'ODS';
  }
  if(!raw) return 'Kaynak dosya';
  return raw
    .replace(/Kaynak\s*HTML/gi,'')
    .replace(/At\s+Yar[ıi]ş[ıi]\s+(?:B[üu]lteni|Sonuçlar[ıi])/gi,'')
    .replace(/TJK\s+Yar[ıi]ş\s+(?:Program[ıi]|Sonuçlar[ıi])/gi,'')
    .replace(/[_\-–—]+/g,' ')
    .replace(/\s+/g,' ')
    .trim() || 'Kaynak dosya';
}

const TKP_RECALC_FILE_SELECT_MAX_OPTIONS=600;
const TKP_RECALC_FILE_SELECT_SCAN_LIMIT=2400;
let _tkpRecalcFileSelectCache={signature:'',html:'',rows:[],visibleById:new Map(),meta:''};

// Native <select> içine bütün arşivi basmak Win8.1/Opera'da hem reflow hem GC
// kilidi oluşturur. Bu yardımcı sıralamadan ÖNCE son, sınırlı pencereyi alır.
// 509 kayıtlı mevcut arşiv tamamen bu pencereye sığar; 10M modunda yalnız sınırlı
// sıcak/son pencere işlenir ve kullanıcı etkileşimi kesintisiz kalır.
function tkpRecalcFileSelectRows(source,query='',options={}){
  const allFiles=Array.isArray(source)?source:[];
  const limit=Math.max(1,Math.min(TKP_RECALC_FILE_SELECT_MAX_OPTIONS,Number(options.limit)||TKP_RECALC_FILE_SELECT_MAX_OPTIONS));
  const scanLimit=Math.max(limit,Math.min(TKP_RECALC_FILE_SELECT_SCAN_LIMIT,Number(options.scanLimit)||TKP_RECALC_FILE_SELECT_SCAN_LIMIT));
  const scanned=Math.min(allFiles.length,scanLimit);
  const sourceWindow=allFiles.slice(Math.max(0,allFiles.length-scanned));
  let needle='';
  try{needle=typeof fold==='function'?fold(String(query||'').trim()):String(query||'').trim().toLocaleLowerCase('tr-TR');}catch(_e){needle=String(query||'').trim().toLowerCase();}
  const rows=[];
  for(const file of sourceWindow){
    if(!file)continue;
    if(needle){
      const hay=[file.race_date,file.filename,file.original_filename,file.source_name,file.hippodrome,file.id].join(' ');
      let folded='';try{folded=typeof fold==='function'?fold(hay):hay.toLocaleLowerCase('tr-TR');}catch(_e){folded=hay.toLowerCase();}
      if(!folded.includes(needle))continue;
    }
    rows.push(file);
  }
  rows.sort((a,b)=>String(b?.race_date||'').localeCompare(String(a?.race_date||''))||Number(b?.sequence_no||0)-Number(a?.sequence_no||0));
  if(rows.length>limit)rows.length=limit;
  return {rows,total:allFiles.length,scanned,truncated:allFiles.length>scanned||rows.length>=limit};
}

function tkpVisibleRecalcFileById(fileId){
  const id=String(fileId??'');
  const visible=_tkpRecalcFileSelectCache.visibleById?.get(id);
  if(visible)return visible;
  const files=Array.isArray(db?.files)?db.files:[];
  // Küçük arşivde legacy/manuel seçimler için tam uyumluluk; büyük arşivde seçici
  // yalnız görünür pencereden kimlik verir, burada ikinci bir tam tarama yapılmaz.
  return files.length<=TKP_RECALC_FILE_SELECT_SCAN_LIMIT ? (files.find(f=>String(f?.id)===id)||null) : null;
}

function tkpRefreshRecalcFileSelect(){
  const sel = $('#tkpRecalcFileSelect');
  if(!sel || !db) return;
  const prev = sel.value;
  const search=String($('#tkpRecalcFileSearch')?.value||'').trim();
  const allFiles=Array.isArray(db.files)?db.files:[];
  // Tahmin sekmesine her dönüşte 500+ option'u tekrar sıralayıp DOM'a basmak,
  // veri değişmemişken yalnız gereksiz reflow/GC üretir. Dosya/veri imzası O(1)
  // olduğundan aynı liste yeniden kurulmaz; yeni import veya tarihsel dosya
  // değiştiğinde imza değişir ve seçenekler eksiksiz yeniden çizilir.
  const signature=typeof tkpFastDbSignature==='function'
    ? `recalc:${tkpFastDbSignature(db)}`
    : `recalc:${allFiles.length}:${String(allFiles[0]?.id||'')}:${String(allFiles[allFiles.length-1]?.id||'')}`;
  const cacheSignature=`${signature}|q:${search}`;
  if(_tkpRecalcFileSelectCache.signature===cacheSignature&&_tkpRecalcFileSelectCache.html){
    if(_tkpRecalcFileSelectCache.visibleById?.has(String(prev))) sel.value=prev;
    return false;
  }
  const page=tkpRecalcFileSelectRows(allFiles,search);
  const files=page.rows;
  // KULLANICI TALEBİ: Eski koşu çağır açılır listesi 3 kolonluydu (tarih | hipodrom |
  // dosya adı); ortadaki hipodrom kolonu arşivdeki en uzun yabancı pist adına göre
  // büyüyüp seçiciyi gereksiz genişletiyordu. Hipodrom kolonu tamamen kaldırıldı;
  // tam hipodrom bilgisi kayıtta (f.hippodrome) aynen korunur, yalnız görünür etiket
  // artık tarih | dosya adı olarak iki kolon.
  const optionLabel=f=>{
    const date=String(f.race_date||'?').trim().padEnd(10,'\u00a0');
    const filename=String(f.filename||'').trim();
    return `${date} | ${filename}`;
  };
  const html = `<option value="">▣ Gün / Bülten Seç</option>` + files.map(f =>
    `<option value="${esc(f.id)}">${esc(optionLabel(f))}</option>`
  ).join('');
  const visibleById=new Map(files.map(file=>[String(file?.id),file]));
  const meta=page.total>page.scanned
    ? `⚡ Büyük arşiv koruması: son ${page.scanned.toLocaleString('tr-TR')} / ${page.total.toLocaleString('tr-TR')} kayıt taranıyor; açılır listede en çok ${files.length} kayıt gösterilir.`
    : `${files.length} / ${page.total} kayıt listelendi.`;
  _tkpRecalcFileSelectCache={signature:cacheSignature,html,rows:files,visibleById,meta};
  sel.innerHTML = html;
  const metaEl=$('#tkpRecalcFileSelectMeta');if(metaEl)metaEl.textContent=meta;
  if (visibleById.has(String(prev))) sel.value = prev;
  return true;
}

function renderFiles(){
  if(typeof tkpRefreshRecalcFileSelect==='function') tkpRefreshRecalcFileSelect();
  // PURE RENDER CONTRACT: Bu ekran yalnız okur. Eski sürüm burada dosya/koşu
  // alanlarını yerinde değiştirip saveDB(false) çağırıyordu. Yalnız Dosyalar/QC
  // sekmesini açmak bile bütün 17+ MB arşivi yeniden parçalayıp IndexedDB'ye
  // yazdığı için Win8.1'de birkaç saniyelik donma ve render->save zinciri
  // oluşabiliyordu. Eski kayıtların standart görünen adları artık yalnız bu
  // görünüm için türetilir; kalıcı normalizasyon import/migration sınırındadır.
  const indexedRows=typeof tkpGetIndexes==='function' ? tkpGetIndexes().racesByFileId : null;
  const displayFiles=(db.files||[]).map(sourceFile=>{
    const f={...sourceFile};
    // Legacy kayıtta altili_no boşsa -2ALT/-1ALT kanıtını filename/source_signature'dan
    // görünüm kopyasında geri kazan; kaynak DB ve bağlı yarışlar değiştirilmez.
    if(!Number(f.altili_no) && typeof tkpInferAltiliNo==='function'){
      const related=indexedRows ? (indexedRows.get(String(f.id))||indexedRows.get(f.id)||[]) : (db.races||[]).filter(r=>String(r.file_id)===String(f.id));
      const inferred=tkpInferAltiliNo(f,related);
      if(inferred) f.altili_no=inferred;
    }
    if(f.sequence_no){
      const expected=tkpQcOdsFilename(f.sequence_no,f.hippodrome,f.altili_no,f.altili_count);
      if(f.filename!==expected) f.filename=expected;
    }
    const sourceRaw=f.original_filename || f.source_name || f.filename || '';
    if(!f.source_signature && sourceRaw) f.source_signature=fold(sourceRaw);
    const publicName=tkpPublicSourceName(sourceRaw, f.hippodrome);
    if(publicName) f.original_filename=publicName;
    return f;
  });
  let s = stats();
  $('#fileQcSummary').innerHTML = [
    kpiCard('Aktif dosya', s.files, 'ok'),
    kpiCard('Karantinada', s.quarantine, s.quarantine>0?'bad':'ok'),
    kpiCard('Kayıtlı koşu', s.totalRaces),
    kpiCard('Aktif analiz', s.races, s.inactiveRaces>0?'warn':'ok')
  ].join('');
  // KÖK FIX (2026-08-23, kullanıcı bildirimi): Liste SADECE sequence_no'ya (yükleme
  // sırasına) göre sıralanıyordu; race_date hiç dikkate alınmıyordu. Sonuç: 508, 507,
  // 506... sırası korunurken tarihler (23.08.2026, 16.08.2026, 31.08.2024, 09.01.2025...)
  // karışık görünüyordu -- geçmiş tarihli dosyalar sonradan yüklenince bu doğaldı ama
  // "tarihe göre" beklenen bir listede kafa karıştırıyordu. race_date 'YYYY-MM-DD'
  // formatında saklandığından string karşılaştırması bile kronolojik olarak doğrudur.
  // Tarihsiz/bozuk race_date'li dosyalar listenin SONUNA düşer (yanlışlıkla en üste
  // atlamasınlar diye), aynı tarihli dosyalar arasında sequence_no (yükleme sırası)
  // ile eski davranış korunur.
  const sortedFiles = displayFiles.sort((a,b)=>{
    const da=String(a.race_date||''), dbv=String(b.race_date||'');
    const aValid=/^\d{4}-\d{2}-\d{2}$/.test(da), bValid=/^\d{4}-\d{2}-\d{2}$/.test(dbv);
    if(aValid && bValid && da!==dbv) return dbv<da?-1:1; // en yeni tarih en üstte
    if(aValid!==bValid) return aValid?-1:1; // geçerli tarihli dosyalar önce
    return (b.sequence_no||0)-(a.sequence_no||0); // eşit tarih / tarihsiz -> eski davranış
  });
  if (typeof tkpRenderFilesTableProgressive === 'function') {
    // V1.1.308-MEM-FIX: 250 satırlık tabloyu tek seferde innerHTML ile basmak yerine
    // kademeli (chunked) ekler -- görünüm/sıralama/içerik birebir aynı kalır, yalnız
    // DOM'a yazılma şekli tarayıcıya nefes verecek şekilde bölünür (bkz.
    // tkp-virtual-table.js).
    tkpRenderFilesTableProgressive($('#filesTable'), sortedFiles, {limit:250});
  } else if (typeof tkpFilesTableHTML === 'function') {
    $('#filesTable').innerHTML = tkpFilesTableHTML(sortedFiles, {limit:250});
  } else {
    $('#filesTable').innerHTML = `<div class="tableWrap"><table><thead><tr><th>No</th><th>Dosya</th><th>Kaynak</th><th>Tarih</th><th>Hipodrom</th><th>Kayıt</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${
      sortedFiles.map(f => `<tr><td style="white-space:nowrap;">${String(f.sequence_no).padStart(3,'0')}</td><td class="fileName">${esc(f.filename)}</td><td class="fileName">${esc(f.original_filename||'')}</td><td style="white-space:nowrap;">${esc(f.race_date ? displayDateTR(f.race_date) : '-')}</td><td>${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(f.hippodrome):f.hippodrome)}</td><td>${esc(f.status)}</td><td>${tkpDurumBadge(f)}</td><td><div class="tkpFileActions">${((indexedRows ? (indexedRows.get(String(f.id))||indexedRows.get(f.id)||[]) : db.races.filter(r=>r.file_id===f.id)).length) ? `<button class="fileActBtn" onclick="window.__tkp_downloadFileOds(${f.id})">📥 ODS indir</button>` : ''}${f.status==='REVIEW_NEAR_DUPLICATE' ? `<button class="fileActBtn" onclick="window.__tkp_toggleFileStatus(${f.id},true)">Analize dahil et</button>` : (f.duplicate_of ? `<button class="fileActBtn" onclick="window.__tkp_toggleFileStatus(${f.id},false)">İncelemeye al</button>` : '')}<button class="fileActBtn" onclick="window.__tkp_editFile(${f.id})">✏️ Düzelt</button><button class="fileActBtn danger" onclick="window.__tkp_deleteFile(${f.id})">Dosyayı sil</button></div></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Henüz dosya yok.</td></tr>'
    }</tbody></table></div><p class="muted" style="margin-top:8px;">Dosya silme işleminden önce .tkbz yedeği alınması önerilir.</p>`;
  }
}

function populateBetCitySelect(){
  const sel = $('#betCity');
  if (!sel) return;
  const current = sel.value;
  const groups = raceCityGroups();
  const opts = [...groups.domestic,...groups.foreign];
  const trOptions = groups.domestic.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const foreignOptions = groups.foreign.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.innerHTML = '<option value="">Pist seç</option>' +
    `<optgroup label="🇹🇷 Türkiye">${trOptions}</optgroup>` +
    (foreignOptions ? `<optgroup label="🌍 Yurtdışı">${foreignOptions}</optgroup>` : '') +
    '<option value="__OTHER__">➕ Yeni / diğer pist ekle…</option>';
  if (current && (opts.includes(current) || current==='__OTHER__')) sel.value = current;
  const wrap = $('#betTrackOtherWrap');
  if (wrap) wrap.style.display = sel.value==='__OTHER__' ? '' : 'none';
}

function profitOutcomeClass(value){ return Number(value)>0?'profitWin':Number(value)<0?'profitLoss':'profitNeutral'; }
const TKP_GLOBAL_MIN_PERCENT_SAMPLE=1; // V1.1.305: minimum yarış eşiği kaldırıldı; mevcut her örnekle hesapla
function tkpOutcomePctText(numerator,denominator,digits=true){
  const n=Math.max(0,Number(denominator)||0),k=Number(numerator)||0;
  if(n<1)return `—`;
  return '%'+(digits?fmt2(100*k/n):fmtPct(100*k/n));
}
function tkpOutcomeRoiText(net,cost,sample){
  const n=Math.max(0,Number(sample)||0);
  if(n<1)return `—`;
  return Number(cost)?'%'+fmt2(100*Number(net)/Number(cost)):'-';
}

let _tkpProfitAggCache={signature:'',value:null,promise:null};
function tkpProfitSignature(){
  const rows=Array.isArray(db?.bets)?db.bets:[],last=rows.length?rows[rows.length-1]:null;
  return [typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):'',rows.length,String(last?.date||''),String(last?.cost||''),String(last?.payout||'')].join('|');
}
function tkpProfitBucketAdd(map,key,seed,cost,pay,win){
  const g=map[key]||(map[key]={...seed,cost:0,pay:0,count:0,wins:0});g.cost+=cost;g.pay+=pay;g.count++;if(win)g.wins++;return g;
}
async function tkpProfitAggregateAsync(){
  const sig=tkpProfitSignature(),rows=Array.isArray(db?.bets)?db.bets:[];
  if(_tkpProfitAggCache.signature===sig&&_tkpProfitAggCache.value)return _tkpProfitAggCache.value;
  if(_tkpProfitAggCache.signature===sig&&_tkpProfitAggCache.promise)return _tkpProfitAggCache.promise;
  const agg={cost:0,pay:0,monthly:{},byType:{},byGameType:{},byCityType:{},byTrack:{},count:rows.length,recent:[]};
  const build=async()=>{
    const consume=(x)=>{
      const cost=+x?.cost||0,pay=+x?.payout||0,win=pay>0;agg.cost+=cost;agg.pay+=pay;
      const m=(x?.date||'').slice(0,7)||'TARİHSİZ';const mg=agg.monthly[m]||(agg.monthly[m]={cost:0,pay:0,count:0});mg.cost+=cost;mg.pay+=pay;mg.count++;
      const t=x?.couponType||'other';tkpProfitBucketAdd(agg.byType,t,{},cost,pay,win);
      const gt=x?.betGameType||'—';tkpProfitBucketAdd(agg.byGameType,gt,{gt},cost,pay,win);
      const city=x?.betCity||'—';tkpProfitBucketAdd(agg.byTrack,city,{track:city},cost,pay,win);
      const ck=city+'||'+gt;tkpProfitBucketAdd(agg.byCityType,ck,{city,gt},cost,pay,win);
    };
    if(typeof tkpRunAdaptiveRange==='function'){
      await tkpRunAdaptiveRange('profit-aggregate',rows.length,async(a,b)=>{for(let i=a;i<b;i++)consume(rows[i]);},{stride:256,budgetMs:10});
    }else{
      for(let i=0;i<rows.length;i++){consume(rows[i]);if(i&&i%1024===0)await new Promise(r=>setTimeout(r,0));}
    }
    for(let i=Math.max(0,rows.length-500);i<rows.length;i++)agg.recent.push({x:rows[i],i});
    _tkpProfitAggCache={signature:sig,value:agg,promise:null};return agg;
  };
  const promise=build().catch(e=>{_tkpProfitAggCache.promise=null;throw e;});
  _tkpProfitAggCache={signature:sig,value:null,promise};return promise;
}
function tkpRenderProfitFromAggregate(a){
  const cost=a.cost,pay=a.pay,monthly=a.monthly,byType=a.byType,byGameType=a.byGameType,byCityType=a.byCityType,byTrack=a.byTrack;
  const monthRows=Object.entries(monthly).sort().map(([m,x])=>{const net=x.pay-x.cost;return `<tr class="${profitOutcomeClass(net)}"><td>${m}</td><td class="num">${fmt2(x.cost)} TL</td><td class="num">${fmt2(x.pay)} TL</td><td class="num profitResult"><b>${fmt2(net)} TL</b></td><td class="num profitResult">${tkpOutcomeRoiText(net,x.cost,x.count)}</td></tr>`;}).join('');
  const typeOrder=['main','alt','surprise','other'].filter(t=>byType[t]);
  const typeRows=typeOrder.map(t=>{const g=byType[t],net=g.pay-g.cost;return `<tr class="${profitOutcomeClass(net)}"><td>${couponTypeLabel(t)}</td><td class="num">${g.count}</td><td class="num">${fmt2(g.cost)} TL</td><td class="num">${fmt2(g.pay)} TL</td><td class="num profitResult"><b>${fmt2(net)} TL</b></td><td class="num profitResult">${tkpOutcomeRoiText(net,g.cost,g.count)}</td><td class="num">${tkpOutcomePctText(g.wins,g.count)}</td></tr>`;}).join('');
  const bestType=typeOrder.length?typeOrder.slice().sort((x,y)=>{const a=byType[x],b=byType[y],ra=a.cost?(a.pay-a.cost)/a.cost:-1,rb=b.cost?(b.pay-b.cost)/b.cost:-1;return rb-ra;})[0]:null;
  const typeSummaryCard=`<div class="card" style="margin-top:12px;border-left:5px solid #d97706;"><h2 style="margin:0 0 4px;">🏷️ Kupon tipine göre gerçek kâr/zarar</h2>${typeRows?`<div class="tableWrap"><table><thead><tr><th>Kupon tipi</th><th class="num">Adet</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th><th class="num">İsabet</th></tr></thead><tbody>${typeRows}</tbody></table></div>${bestType?`<p class="muted">En yüksek kayıtlı ROI: <b>${couponTypeLabel(bestType)}</b>.</p>`:''}`:'<p class="muted">Henüz kayıt yok.</p>'}</div>`;
  const gameTypeRowsArr=Object.values(byGameType).map(g=>({...g,net:g.pay-g.cost,roi:g.cost?(g.pay-g.cost)/g.cost*100:0})).sort((x,y)=>y.net-x.net);
  const gameTypeRows=gameTypeRowsArr.map((g,i)=>`<tr class="${profitOutcomeClass(g.net)} ${i===0&&g.net>0?'profitBest':''}"><td>${g.gt==='—'?'Belirtilmemiş':betGameTypeLabel(g.gt)}</td><td class="num">${g.count}</td><td class="num">${fmt2(g.cost)} TL</td><td class="num">${fmt2(g.pay)} TL</td><td class="num profitResult"><b>${fmt2(g.net)} TL</b></td><td class="num profitResult">${tkpOutcomeRoiText(g.net,g.cost,g.count)}</td><td class="num">${tkpOutcomePctText(g.wins,g.count)}</td></tr>`).join('');
  const gameTypeCard=`<div class="card" style="margin-top:12px;border-left:5px solid #7c3aed;"><h2 style="margin:0 0 4px;">🎯 Bahis türüne göre gerçek kâr/zarar</h2>${gameTypeRows?`<div class="tableWrap"><table><thead><tr><th>Bahis türü</th><th class="num">Adet</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th><th class="num">İsabet</th></tr></thead><tbody>${gameTypeRows}</tbody></table></div>`:'<p class="muted">Henüz kayıt yok.</p>'}</div>`;
  const trackArr=Object.values(byTrack).map(g=>({...g,net:g.pay-g.cost,roi:g.cost?(g.pay-g.cost)/g.cost*100:0})).sort((x,y)=>y.roi-x.roi||y.net-x.net);
  const trackRows=trackArr.map(g=>`<tr class="${profitOutcomeClass(g.net)}"><td>${esc(g.track)}</td><td class="num">${g.count}</td><td class="num">${fmt2(g.cost)} TL</td><td class="num">${fmt2(g.pay)} TL</td><td class="num profitResult"><b>${fmt2(g.net)} TL</b></td><td class="num profitResult">${tkpOutcomeRoiText(g.net,g.cost,g.count)}</td><td class="num">${tkpOutcomePctText(g.wins,g.count)}</td></tr>`).join('');
  const trackCard=`<div class="card" style="margin-top:12px;border-left:5px solid #0f766e;"><h2 style="margin:0 0 4px;">🌍 Pist / hipodrom bazlı gerçek performans</h2>${trackRows?`<div class="tableWrap"><table><thead><tr><th>Pist / Hipodrom</th><th class="num">Adet</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th><th class="num">İsabet</th></tr></thead><tbody>${trackRows}</tbody></table></div>`:'<p class="muted">Henüz kayıt yok.</p>'}</div>`;
  const cityTypeArr=Object.values(byCityType).map(g=>({...g,net:g.pay-g.cost,roi:g.cost?(g.pay-g.cost)/g.cost*100:0})).sort((x,y)=>y.net-x.net);
  const cityTypeRows=cityTypeArr.map(g=>`<tr class="${profitOutcomeClass(g.net)}"><td>${esc(g.city)}</td><td>${betGameTypeLabel(g.gt)}</td><td class="num">${g.count}</td><td class="num">${fmt2(g.cost)} TL</td><td class="num">${fmt2(g.pay)} TL</td><td class="num profitResult"><b>${fmt2(g.net)} TL</b></td><td class="num profitResult">${tkpOutcomeRoiText(g.net,g.cost,g.count)}</td><td class="num">${tkpOutcomePctText(g.wins,g.count)}</td></tr>`).join('');
  const cityTypeCard=`<div class="card" style="margin-top:12px;border-left:5px solid #2563eb;"><h2 style="margin:0 0 4px;">📍 Pist ve bahis türüne göre gerçek kâr/zarar</h2>${cityTypeRows?`<div class="tableWrap"><table><thead><tr><th>Pist</th><th>Bahis türü</th><th class="num">Adet</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th><th class="num">İsabet</th></tr></thead><tbody>${cityTypeRows}</tbody></table></div>`:'<p class="muted">Henüz kayıt yok.</p>'}</div>`;
  const monthlyBankrollHtml=typeof tkpMonthlyBankrollHTML==='function'?tkpMonthlyBankrollHTML('',db):'';
  $('#profitSummary').innerHTML=`${monthlyBankrollHtml}<div class="grid">${kpiCard('Toplam maliyet',fmt2(cost)+' TL','profitNeutral')}${kpiCard('Toplam ikramiye',fmt2(pay)+' TL','profitPayout')}${kpiCard('Net kâr / zarar',fmt2(pay-cost)+' TL',profitOutcomeClass(pay-cost))}${kpiCard('ROI',tkpOutcomeRoiText(pay-cost,cost,a.count),profitOutcomeClass(pay-cost))}</div><div class="card" style="margin-top:12px;"><h2>📅 Aylık özet</h2><div class="tableWrap"><table><thead><tr><th>Ay</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th></tr></thead><tbody>${monthRows||'<tr><td colspan="5" class="empty">Henüz kupon kaydı yok.</td></tr>'}</tbody></table></div></div>${typeSummaryCard}${gameTypeCard}${trackCard}${cityTypeCard}`;
  const recent=a.recent.slice().reverse();
  $('#betsTable').innerHTML=`<div class="tableWrap"><table><thead><tr><th>Tarih</th><th>Pist / Hipodrom</th><th>Oyun</th><th>Bahis türü</th><th>Kupon tipi</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th>Not</th><th>İşlem</th></tr></thead><tbody>${recent.map(({x,i})=>{const net=(+x.payout||0)-(+x.cost||0),outcome=profitOutcomeClass(net),icon=net>0?'✅ ':net<0?'❌ ':'';return `<tr class="${outcome}"><td>${esc(x.date)}</td><td>${esc(x.betCity||'-')}</td><td>${esc(betSessionLabel(x.betSession)||'-')}</td><td>${betGameTypeLabel(x.betGameType)}</td><td>${couponTypeLabel(x.couponType)}</td><td class="num">${fmt2(+x.cost)} TL</td><td class="num profitResult">${icon}${fmt2(+x.payout)} TL</td><td>${esc(x.note||'')}</td><td><button class="recordDeleteBtn" onclick="window.__tkp_deleteBet(${i})">Sil</button></td></tr>`;}).join('')||'<tr><td colspan="9" class="empty">Henüz kupon kaydı yok.</td></tr>'}</tbody></table></div>${a.count>recent.length?`<p class="muted">Hız için son ${recent.length} / ${a.count} kupon DOM'a çizildi; KPI ve ROI tüm kayıtlardan hesaplandı.</p>`:''}`;
}
function renderProfit(){
  populateBetCitySelect();
  const sig=tkpProfitSignature();
  if(_tkpProfitAggCache.signature===sig&&_tkpProfitAggCache.value){tkpRenderProfitFromAggregate(_tkpProfitAggCache.value);return;}
  if($('#profitSummary'))$('#profitSummary').innerHTML='<div class="card tkpRocketPending">Kâr/zarar özeti hazırlanıyor…</div>';
  if($('#betsTable'))$('#betsTable').innerHTML='<div class="empty">Son kuponlar hazırlanıyor…</div>';
  const generation=sig;
  tkpRunAfterVisiblePaint(async()=>{
    try{const agg=await tkpProfitAggregateAsync();if(tkpProfitSignature()!==generation)return;const active=document.querySelector('.tab.active');if(active&&active.dataset.pane!=='profit')return;tkpRenderProfitFromAggregate(agg);}catch(e){console.warn('Kâr/zarar aggregate:',e);}
  });
}



// V1.1.84 — İLERİYE DÖNÜK TAKİP VERİ TABLOSU
// Ana algoritmaya/kupona müdahale etmez. Yalnız sonuç gelmeden önce snapshot alır,
// sonuç geldikten sonra aynı kaydı değerlendirir. Böylece sonradan geriye dönük başarı üretilemez.
function tkpForwardTrackingEnsureLog(){
  if(!Array.isArray(db?.forward_tracking_log)) db.forward_tracking_log=[];
  return db.forward_tracking_log;
}
// İleri Takip ekranı "bugün" kavramını bilgisayar takviminden değil seçili
// bültenin yarış gününden alır. Böylece eski bir günü açınca o günün altılıları
// görünür; bütün geçmiş yine kalıcı kayıtta ve öğrenme havuzunda kalır.
function tkpSelectedTrackingDate(src=null){
  // R18.8: İzleme Merkezi tarihi eski yarış çağırma seçicisinden TAMAMEN bağımsızdır.
  // Varsayılan görünüm, gerçekten takip kaydı bulunan en yeni yarış günüdür.
  const rows=Array.isArray(src)?src:tkpForwardTrackingEnsureLog();
  let latest='';
  for(const row of rows){
    const date=String(row?.race_date||'').slice(0,10);
    if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>latest)latest=date;
  }
  return latest;
}
if(typeof window!=='undefined')window.tkpSelectedTrackingDate=tkpSelectedTrackingDate;
function tkpForwardTrackingTrackKey(v){ return fold(canonicalHippodrome(v||'')).replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C'); }
function tkpForwardTrackingKey(r){
  return [String(r?.race_date||''),tkpForwardTrackingTrackKey(r?.hippodrome||''),Number(r?.altili_no)||1,Number(r?.leg)||Number(r?.sequence_no)||0].join('|');
}
function tkpForwardTrackingWithinLiveFinal(r){
  // V1.1.265: işaretli 503 calibration seti İleri Takip/öğrenme katmanlarında tam veri olarak kullanılır.
  try{if(typeof tkpHistoricalCalibrationRace==='function'&&tkpHistoricalCalibrationRace(r,db))return true;}catch(_e){}
  const start=String(db?.settings?.live_final_backtest?.startsAt||'').slice(0,10);
  const date=String(r?.race_date||'').slice(0,10);
  return !start||!date||date>=start;
}
function tkpForwardTrackingNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
// V1.1.135: İleri Takip eşleşmesinde normal at numarası eşitliği önceliklidir.
// sameEkuri() yalnız -E1/-E2 eküri etiketlerini karşılaştırır; "9" ile "9" için false döner.
// Bu yüzden onu doğrudan kullanmak tüm Top-1/3/5, TEK ve BMB sonuçlarını sıfırlıyordu.
function tkpForwardTrackingSameHorse(noA,noB){
  const a=String(noA??'').trim().toLocaleUpperCase('tr-TR');
  const b=String(noB??'').trim().toLocaleUpperCase('tr-TR');
  if(!a||!b) return false;
  if(a===b) return true;
  try{ return typeof sameEkuri==='function' && sameEkuri(a,b); }catch(_e){ return false; }
}
function tkpForwardTrackingCanonicalSingle(x){
  // R16: İleri Takip gerçek kuponla aynı seçici TEK kararını yarıştan ÖNCE
  // snapshotlar. Güçlü ayrışma yoksa sistem çekimser kalır; sonradan sonuç görüp
  // "TEK üretmek" yasaktır. Böylece R16'nın %55-60+ hedefi gerçek ileri testte
  // ölçülebilir ve arşiv başarısıyla karıştırılmaz.
  let plan=null;
  try{
    plan=typeof canonicalSinglePlan==='function'?canonicalSinglePlan(x):legCoveragePlan(x,'main');
  }catch(_e){
    try{ plan=legCoveragePlan(x,'main'); }catch(_e2){}
  }
  if(typeof tkpR16SelectiveSingleForLeg==='function'){
    try{
      const r16=tkpR16SelectiveSingleForLeg(x);
      const h=r16?.candidate||r16?.first||null;
      return {plan,decision:r16,horse:h,reliable:!!(r16?.isSingle&&h)};
    }catch(_e){}
  }
  const d=plan?.singleDecision||null;
  const h=d?.first||plan?.picks?.[0]||x?.top||x?.scored?.[0]||null;
  const reliable=!!(d?.isSingle && h && plan?.reliable!==false);
  return {plan,decision:d,horse:h,reliable};
}
function tkpForwardTrackingEvaluateRecord(rec,r){
  if(!rec||!r||!raceHasConfirmedResult(r?.horses||[])) return false;
  const horses=r.horses||[];
  const winner=horses.find(h=>Number(h.winner)===1||Number(h.finish_position)===1)||null;
  const leader=horses.find(h=>tkpForwardTrackingSameHorse(h.horse_no,rec.leader_no))||null;
  const finish=Number(leader?.finish_position)||0;
  const singleHorse=rec.single_reliable&&rec.single_no?horses.find(h=>tkpForwardTrackingSameHorse(h.horse_no,rec.single_no)):null;
  const singleFinish=Number(singleHorse?.finish_position)||0;
  const prev=JSON.stringify([
    rec.winner_no,rec.winner_name,rec.leader_finish,rec.leader_win,rec.leader_top3,rec.leader_top5,
    rec.single_finish,rec.single_hit,rec.narrow_bmb_finish,rec.narrow_bmb_win,
    rec.odb_finish,rec.odb_win,rec.odb_top5,rec.prof_finish,rec.prof_win,rec.prof_top5,
    rec.bomb_any_win,rec.bomb_any_top3,rec.bomb_any_top5,rec.main_hit,rec.surprise_hit,
    rec.main_miss_reason,rec.surprise_miss_reason,rec.single_miss_reason,rec.winner_pre_rank,rec.evaluated_at
  ]);
  rec.winner_no=String(winner?.horse_no||''); rec.winner_name=winner?.horse_name||'';
  rec.leader_finish=finish||null;
  rec.leader_win=finish===1?1:0;
  rec.leader_top3=finish>0&&finish<=3?1:0;
  rec.leader_top5=finish>0&&finish<=5?1:0;
  // TEK başarısı hibrit liderden değil, snapshotlanan gerçek TEK atından ölçülür.
  rec.single_finish=rec.single_reliable?(singleFinish||null):null;
  rec.single_hit=rec.single_reliable?(singleFinish===1?1:0):null;
  if(rec.narrow_bmb_no){
    const bh=horses.find(h=>tkpForwardTrackingSameHorse(h.horse_no,rec.narrow_bmb_no));
    const fp=Number(bh?.finish_position)||0;
    rec.narrow_bmb_finish=fp||null; rec.narrow_bmb_win=fp===1?1:0;
  }else{
    rec.narrow_bmb_finish=null; rec.narrow_bmb_win=null;
  }
  if(rec.odb_no){
    const oh=horses.find(h=>tkpForwardTrackingSameHorse(h.horse_no,rec.odb_no));
    const fp=Number(oh?.finish_position)||0;
    rec.odb_finish=fp||null; rec.odb_win=fp===1?1:0; rec.odb_top5=fp>0&&fp<=5?1:0;
  }else{ rec.odb_finish=null; rec.odb_win=null; rec.odb_top5=null; }
  if(rec.prof_no){
    const ph=horses.find(h=>tkpForwardTrackingSameHorse(h.horse_no,rec.prof_no));
    const fp=Number(ph?.finish_position)||0;
    rec.prof_finish=fp||null; rec.prof_win=fp===1?1:0; rec.prof_top5=fp>0&&fp<=5?1:0;
  }else{ rec.prof_finish=null; rec.prof_win=null; rec.prof_top5=null; }
  const bhNos=(rec.bomb_candidates||[]).map(c=>c.horse_no);
  const bhFinishes=bhNos.map(no=>{const h=horses.find(z=>tkpForwardTrackingSameHorse(z.horse_no,no));return Number(h?.finish_position)||0;}).filter(Boolean);
  rec.bomb_any_win=bhFinishes.some(n=>n===1)?1:0;
  rec.bomb_any_top3=bhFinishes.some(n=>n<=3)?1:0;
  rec.bomb_any_top5=bhFinishes.some(n=>n<=5)?1:0;
  // V51 KIDLIN/WILSON TAKİP: Sonuç geldikten sonra tanı üretir; yalnız GELECEK yarışlarda
  // bounded/minimum örnekli failure-learning katmanına veri sağlar. Aynı yarışın sonucunu geriye beslemez.
  const preRows=Array.isArray(rec.pre_race_candidates)?rec.pre_race_candidates:[];
  const winnerSnap=winner?preRows.find(z=>tkpForwardTrackingSameHorse(z?.horse_no,winner.horse_no)):null;
  rec.winner_pre_rank=winnerSnap?Number(winnerSnap.rank)||null:null;
  const winnerSignals=[];
  if(winnerSnap){
    if(winnerSnap.rank)winnerSignals.push(`TKP sıra ${winnerSnap.rank}`);
    if(winnerSnap.agf_rank)winnerSignals.push(`AGF sıra ${winnerSnap.agf_rank}`);
    if(winnerSnap.hndkp!=null)winnerSignals.push(`HNDKP ${winnerSnap.hndkp}`);
    if(winnerSnap.hndkp_rank)winnerSignals.push(`HNDKP sıra ${winnerSnap.hndkp_rank}`);
    if(winnerSnap.jbyg_rank)winnerSignals.push(`J-BYG ${winnerSnap.jbyg_rank}`);
    if(winnerSnap.g800)winnerSignals.push(`800G ${winnerSnap.g800}`);
    if(winnerSnap.value!=null&&Number(winnerSnap.value)>0)winnerSignals.push(`VALUE ${winnerSnap.value}`);
    if(winnerSnap.bmb)winnerSignals.push('BMB');
    if(winnerSnap.odb)winnerSignals.push('ODB');
    if(Number(winnerSnap.agf_rank)>=6&&Number(winnerSnap.agf_rank)<=9)winnerSignals.push('AGF 6–9 rescue');
  }else if(winner){ winnerSignals.push('yarış-öncesi aday snapshotında yok'); }
  const diagnoseCoupon=(typeKey)=>{
    const picks=Array.isArray(rec.coupons?.[typeKey])?rec.coupons[typeKey]:[];
    if(!winner||!picks.length)return {hit:null,reason:picks.length?'Kazanan sonucu yok':'Kupon snapshotı yok'};
    const hit=picks.some(no=>tkpForwardTrackingSameHorse(no,winner.horse_no));
    if(hit)return {hit:1,reason:`Kazanan ${winner.horse_no} kapsamdaydı`};
    const rank=Number(winnerSnap?.rank)||0;
    const structural=rank&&rank<=6?'Kazanan ilk 6 TKP bandındaydı; kapsam/bütçe daraltmasında dışarıda kaldı':(rank?'Kazanan ana kapsam bandının gerisindeydi':'Kazananın güvenli pre-race sırası yok');
    return {hit:0,reason:`${structural}${winnerSignals.length?' · '+winnerSignals.join(' · '):''}`};
  };
  const mainDiag=diagnoseCoupon('main'),surpriseDiag=diagnoseCoupon('surprise');
  rec.main_hit=mainDiag.hit;rec.main_miss_reason=mainDiag.reason;
  rec.surprise_hit=surpriseDiag.hit;rec.surprise_miss_reason=surpriseDiag.reason;
  if(rec.single_reliable){
    rec.single_miss_reason=rec.single_hit
      ? `TEK ${rec.single_no} kazandı`
      : `TEK ${rec.single_no} ${singleFinish||'?'} oldu; kazanan ${winner?.horse_no||'-'}${winnerSignals.length?' · '+winnerSignals.join(' · '):''}`;
  }else rec.single_miss_reason='Bu ayakta güvenilir TEK yoktu';
  // Eski snapshot erken değerlendirilmiş olsa bile güncel resmi sonuçtan türetilen alanlar onarılır.
  rec.evaluated_at=rec.evaluated_at||new Date().toISOString();
  return prev!==JSON.stringify([
    rec.winner_no,rec.winner_name,rec.leader_finish,rec.leader_win,rec.leader_top3,rec.leader_top5,
    rec.single_finish,rec.single_hit,rec.narrow_bmb_finish,rec.narrow_bmb_win,
    rec.odb_finish,rec.odb_win,rec.odb_top5,rec.prof_finish,rec.prof_win,rec.prof_top5,
    rec.bomb_any_win,rec.bomb_any_top3,rec.bomb_any_top5,rec.main_hit,rec.surprise_hit,
    rec.main_miss_reason,rec.surprise_miss_reason,rec.single_miss_reason,rec.winner_pre_rank,rec.evaluated_at
  ]);
}
function tkpForwardTrackingSync(raceResults,options={}){
  if(!db||!Array.isArray(raceResults)) return false;
  const log=tkpForwardTrackingEnsureLog(); let changed=false;
  // V1.1.282: yarış başına log.find() O(races×log) yerine tek race_key indeksi.
  // 3K+ yarış/ileri-takip kaydında backfill senkronunu lineer tutar.
  const logByRaceKey=new Map();
  for(const row of log){ if(row?.race_key!=null&&!logByRaceKey.has(String(row.race_key))) logByRaceKey.set(String(row.race_key),row); }
  for(const x of raceResults){
    const r=x?.r||x; if(!r) continue;
    // Eski bağımsız test/entegrasyon parçaları bu yardımcıyı kesit dışında bırakabilir;
    // tam uygulamada canlı-final tarih kilidi çalışır, eski bağlamda davranış korunur.
    const historicalCalibration=(()=>{try{return typeof tkpHistoricalCalibrationRace==='function'&&tkpHistoricalCalibrationRace(r,db);}catch(_e){return false;}})();
    if(typeof tkpForwardTrackingWithinLiveFinal==='function'&&!tkpForwardTrackingWithinLiveFinal(r)&&!historicalCalibration) continue;
    const key=tkpForwardTrackingKey(r);
    let rec=logByRaceKey.get(String(key))||null;
    const resultKnown=raceHasConfirmedResult(r?.horses||[]);
    const postTime=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked([r]);
    if(!rec && ((!resultKnown && !postTime) || historicalCalibration)){
      const top=x?.top||x?.scored?.[0]||null; if(!top) continue;
      const single=tkpForwardTrackingCanonicalSingle(x);
      const plan=single.plan;
      const reliable=single.reliable;
      const singleCandidate=!!single.decision?.isSingle;
      let bh=[]; try{ bh=tkpBombHunterCandidates(r).slice(0,4); }catch(_e){}
      const followPool=(x?.scored?.length?x.scored:(r.horses||[])).filter(h=>h&&!isNonRunner(h));
      const odbFollow=followPool.find(h=>typeof isOdbCandidate==='function'&&isOdbCandidate(h,r))||null;
      const profFollow=followPool.slice().sort((a,b)=>(Number(profileStrengthPct(r,b))||0)-(Number(profileStrengthPct(r,a))||0))[0]||null;
      // V1.1.335: Walk-forward tanısı için alanın gerçekten yarıştan ÖNCE
      // mevcut olduğunu ayrıca dondur. Değer 0 olabilir; "alan yok" ile
      // karıştırılmaz. Eski kayıtlar bu işareti taşımadığından geriye dönük
      // uydurma yapılmaz ve onların eksik alanı analizde kapsam dışı kalır.
      const hasTop=(name)=>Object.prototype.hasOwnProperty.call(top||{},name);
      const xRaw=top?.x_ypuan_delta??top?.x_tkp_score_delta;
      const valueRaw=top?.value_score??top?.value??top?.VALUE;
      const paceRaw=top?.prior_accurate_starts??top?.accurate_prior_starts??top?.accurate_starts;
      const xPresent=hasTop('x_ypuan_delta')||hasTop('x_tkp_score_delta');
      const valuePresent=hasTop('value_score')||hasTop('value')||hasTop('VALUE');
      const pacePresent=hasTop('prior_accurate_starts')||hasTop('accurate_prior_starts')||hasTop('accurate_starts');
      rec={
        race_key:key,race_date:r.race_date||'',hippodrome:r.hippodrome||'',altili_no:Number(r.altili_no)||1,
        leg:Number(r.leg)||0,race_no:Number(r.race_no)||0,created_at:new Date().toISOString(),model_version:'V1.1.83',
        historical_calibration:historicalCalibration?1:0,evidence_lane:historicalCalibration?'HISTORICAL_CALIBRATION':'LIVE_FORWARD',
        leader_no:String(top.horse_no||''),leader_name:top.horse_name||'',leader_score:tkpForwardTrackingNum(top.score),
        leader_prof:profileStrengthPct(r,top),agf_rank:tkpForwardTrackingNum(top.agf_rank),tr_rank:tkpForwardTrackingNum(top.tr_rank??top.tr_sira),
        jbyg_rank:tkpForwardTrackingNum(top.jbyg_rank??top.j_beygir_rank??top.jbyg),
        bmb:Number(top.bmb)===1?1:0,odb:(typeof isOdbCandidate==='function'&&isOdbCandidate(top,r))?1:0,tkp_signal:Number(top.tkp_signal??top.tkp_badge??0)?1:0,
        gpr:tkpForwardTrackingNum(top.priorWins??top.gpr??top.gpr_wins),hndkp:tkpForwardTrackingNum(top.hndkp_rank??top.hndkp),
        value:tkpForwardTrackingNum(valueRaw),sp:tkpForwardTrackingNum(top.sp),s_value:tkpForwardTrackingNum(top.s_value),
        x_points:tkpForwardTrackingNum(xRaw),prior_accurate_starts:tkpForwardTrackingNum(paceRaw),
        feature_presence:{schema:'FORWARD_SIGNAL_V2',agf:hasTop('agf_rank'),tr:hasTop('tr_rank')||hasTop('tr_sira'),jbyg:hasTop('jbyg_rank')||hasTop('j_beygir_rank')||hasTop('jbyg'),bmb:hasTop('bmb'),odb:true,prof:Number.isFinite(Number(profileStrengthPct(r,top))),value:valuePresent,x:xPresent,single:true,pace:pacePresent},
        odb_no:odbFollow?String(odbFollow.horse_no||''):'',odb_name:odbFollow?.horse_name||'',odb_prof:odbFollow?profileStrengthPct(r,odbFollow):null,
        prof_no:profFollow?String(profFollow.horse_no||''):'',prof_name:profFollow?.horse_name||'',prof_value:profFollow?profileStrengthPct(r,profFollow):null,
        single_candidate:singleCandidate?1:0,single_reliable:reliable?1:0,
        single_no:reliable?String(single.horse?.horse_no||''):'',single_name:reliable?(single.horse?.horse_name||''):'',
        single_reason:single.decision?.reason||'',single_confidence:tkpForwardTrackingNum(single.decision?.confidence),
        narrow_bmb_no:plan?.narrowBmbExtra?String(plan.narrowBmbExtra.horse_no||''):'',
        bomb_candidates:bh.map((z,i)=>({rank:i+1,kind:z.kind||'BOMBA',category_rank:z.category_rank||i+1,horse_no:String(z.h?.horse_no||''),horse_name:z.h?.horse_name||'',score:Number(z.score||0),near_win_score:Number(z.near_win_score)||0})),
        // V47: Kaçırma nedeni sonuçtan sonra yeniden tahmin edilmesin diye yarış-öncesi aday sırası/sinyali dondurulur.
        pre_race_candidates:(()=>{
          let ordered=[];
          try{ ordered=typeof tkpOrderedForLeg==='function'?tkpOrderedForLeg(x):predictionDisplayRows({r,scored:x?.scored||[]}).rows; }catch(_e){ ordered=x?.scored||r?.horses||[]; }
          return (ordered||[]).filter(h=>h&&!isNonRunner(h)).slice(0,12).map((h,i)=>({
            rank:i+1,horse_no:String(h.horse_no||''),horse_name:h.horse_name||'',agf_rank:tkpForwardTrackingNum(h.agf_rank),
            tr_rank:tkpForwardTrackingNum(h.tr_rank??h.tr_sira),ypuan:tkpForwardTrackingNum(h.ypuan),
            hndkp:tkpForwardTrackingNum(h.hndkp),hndkp_rank:tkpForwardTrackingNum(h.hndkp_rank),jbyg_rank:tkpForwardTrackingNum(h.jbyg_rank??h.j_beygir_rank??h.jbyg),
            g800:tkpForwardTrackingNum(h.g800),value:tkpForwardTrackingNum(h.value_score??h.value??h.VALUE),bmb:Number(h.bmb)===1?1:0,
            odb:(typeof isOdbCandidate==='function'&&isOdbCandidate(h,r))?1:0,prof:typeof profileStrengthPct==='function'?profileStrengthPct(r,h):null
          }));
        })(),
        // V1.1.159 Strateji Laboratuvarı: sonuçtan ÖNCE tek sefer snapshot alınır.
        // Champion/kupon sırasına müdahale etmez; yalnız 10 günlük forward test verisi toplar.
        strategy_lab:(typeof tkpStrategyLabSnapshot==='function'?{snapshot:tkpStrategyLabSnapshot(x),evaluation:null}:null),
        coupons:{},evaluated_at:null
      };
      log.push(rec); logByRaceKey.set(String(key),rec); changed=true;
    }
    // Sonuçlanmamış eski snapshotlar ayrı eski TEK formülünden kalmış olabilir.
    // Sonuç gelmeden önce canonical kararla güvenle senkronlanır; değerlendirilmiş geçmişe dokunulmaz.
    if(rec && ((!resultKnown && !postTime) || historicalCalibration) && !rec.evaluated_at){
      // Eski/pending kayıt Strateji Laboratuvarı öncesinden kaldıysa yalnız sonuç gelmeden
      // snapshot eklenebilir. Sonuç belli olduktan sonra asla geriye dönük snapshot üretilmez.
      if(!rec.strategy_lab && typeof tkpStrategyLabSnapshot==='function'){
        rec.strategy_lab={snapshot:tkpStrategyLabSnapshot(x),evaluation:null}; changed=true;
      }
      const single=tkpForwardTrackingCanonicalSingle(x);
      const nextReliable=single.reliable?1:0;
      const nextNo=nextReliable?String(single.horse?.horse_no||''):'';
      const nextCandidate=single.decision?.isSingle?1:0;
      if(rec.single_reliable!==nextReliable || String(rec.single_no||'')!==nextNo || rec.single_candidate!==nextCandidate){
        rec.single_candidate=nextCandidate; rec.single_reliable=nextReliable; rec.single_no=nextNo;
        rec.single_name=nextReliable?(single.horse?.horse_name||''):'';
        rec.single_reason=single.decision?.reason||''; rec.single_confidence=tkpForwardTrackingNum(single.decision?.confidence);
        changed=true;
      }
      // V1.1.135: Sonucu henüz gelmemiş snapshotlarda ODB/PROF takip adayı da
      // mevcut yarış-öncesi veriden güvenle tazelenir. Sonuçlandıktan sonra bu alanlara
      // dokunulmaz; böylece geriye dönük veri sızıntısı oluşmaz.
      const followPool=(x?.scored?.length?x.scored:(r.horses||[])).filter(h=>h&&!isNonRunner(h));
      const odbFollow=followPool.find(h=>typeof isOdbCandidate==='function'&&isOdbCandidate(h,r))||null;
      const profFollow=followPool.slice().sort((a,b)=>(Number(profileStrengthPct(r,b))||0)-(Number(profileStrengthPct(r,a))||0))[0]||null;
      const nextOdbNo=odbFollow?String(odbFollow.horse_no||''):'';
      const nextProfNo=profFollow?String(profFollow.horse_no||''):'';
      const nextOdbProf=odbFollow?profileStrengthPct(r,odbFollow):null;
      const nextProfValue=profFollow?profileStrengthPct(r,profFollow):null;
      if(String(rec.odb_no||'')!==nextOdbNo || String(rec.odb_name||'')!==(odbFollow?.horse_name||'') || rec.odb_prof!==nextOdbProf){
        rec.odb_no=nextOdbNo; rec.odb_name=odbFollow?.horse_name||''; rec.odb_prof=nextOdbProf; changed=true;
      }
      if(String(rec.prof_no||'')!==nextProfNo || String(rec.prof_name||'')!==(profFollow?.horse_name||'') || rec.prof_value!==nextProfValue){
        rec.prof_no=nextProfNo; rec.prof_name=profFollow?.horse_name||''; rec.prof_value=nextProfValue; changed=true;
      }
    }
    if(rec && resultKnown){
      // Sonuç alanlarını her senkronizasyonda resmi mevcut sonuçtan doğrula.
      // Böylece erken/eksik değerlendirilmiş eski snapshotlar da kendini onarır.
      if(tkpForwardTrackingEvaluateRecord(rec,r)) changed=true;
      // V1.1.159: yalnız daha önce PRE-RACE snapshot varsa resmi sonuçla değerlendir.
      // Sonuçlanmış eski yarış için snapshot yaratmak yasaktır (leakage guard).
      if(rec.strategy_lab?.snapshot && typeof tkpStrategyLabEvaluate==='function'){
        const ev=tkpStrategyLabEvaluate(rec.strategy_lab.snapshot,r);
        if(ev){
          const prevLab=JSON.stringify(rec.strategy_lab.evaluation||null);
          rec.strategy_lab.evaluation=ev;
          if(prevLab!==JSON.stringify(ev)) changed=true;
        }
      }
    }
  }
  // Gerçek ileri takip örnekleri tam tarihçedir; veri arttıkça eski kayıt silinmez.
  if(changed){
    try{if(typeof tkpInvalidateFailureLearning==='function')tkpInvalidateFailureLearning();}catch(_e){}
    if(options.persist!==false&&globalThis.__tkpBulkPipelineActive!==true)try{
      if(typeof tkpPersistCollections==='function')tkpPersistCollections(['forward_tracking_log'],{label:'forward-tracking'});
      else saveDB(false);
    }catch(_e){}
  }
  return changed;
}
// KÖK FIX (2026-08-12): tkpForwardTrackingSync() yalnız activeRaces() ile, yani
// yalnız o an "status=ACTIVE" dosyalara ait toplantılarla senkronize oluyordu.
// Eski/arşive düşmüş (status artık ACTIVE olmayan) dosyalara ait İleri Takip
// kayıtları bu yüzden hiçbir zaman yeniden değerlendirilmiyordu -- yanlış eşleşme
// veya eski buggy sürümle hesaplanmış (ör. leader_win=0 iken gerçekte finish=1
// olan) değerler sonsuza kadar donuk kalabiliyordu. Gerçek arşiv üzerinde
// doğrulandı: 18 kayıttan 6'sı bu şekilde donmuştu (gerçek lider isabeti %0 değil
// %33,3 çıktı). Bu fonksiyon db.races'in TAMAMINI (aktif/pasif fark etmeksizin)
// tarayarak aynı öz-onarma mantığını (tkpForwardTrackingSync) bir kez çalıştırır.
async function tkpForwardTrackingBackfillAll(){
  if(!db || !Array.isArray(db.races)) return false;
  // Tarihsel kalibrasyon daha önce puan/sıra snapshotlarını atlara kilitledi.
  // Backfill bu donmuş sırayı kullanır; sonuçtan sonra güncel model çalıştırmaz.
  // R16.51 KÖK FIX (donma): tkpForwardTrackingSync, db.races'in TAMAMINI (REAL509
  // arşivinde 3000+ yarış) TEK senkron çağrıda işliyordu. historical-calibration.js
  // "forward_tracking" öğrenme adımı bunu doğrudan çağırdığından ilk kurulumda bu
  // TEK adım ana iş parçacığını dakikalarca kilitleyebiliyordu (persistHistoricalCoupon
  // içindeki AYNI kök nedenin -- bkz. o dosyadaki "KÖK FIX (donma)" yorumu --
  // daha büyük ölçekli hali). Aynı fonksiyon, aynı veri, aynı sıra -- yalnız artık
  // yarış başına çağrılıp aralarda UI'ye nefes alma payı bırakılıyor.
  let changed=false;
  for(const r of db.races){
    const scored=(r?.horses||[]).filter(Boolean).slice().sort((a,b)=>{
      const ar=Number(a?.prediction_order_snapshot)||Number(a?._strategy_rank)||9999;
      const br=Number(b?.prediction_order_snapshot)||Number(b?._strategy_rank)||9999;
      return ar-br||(Number(b?.prediction_score_snapshot)||0)-(Number(a?.prediction_score_snapshot)||0)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||''));
    });
    const one={r,scored,top:scored[0]||null,second:scored[1]||null,third:scored[2]||null};
    try{ if(tkpForwardTrackingSync([one],{persist:false})) changed=true; }catch(_e){}
    if(typeof tkpWaitForBackgroundSafeWindow==='function') await tkpWaitForBackgroundSafeWindow({minIdleMs:0,retryMs:60});
    if(typeof tkpYieldToUi==='function') await tkpYieldToUi();
    else await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(changed)try{
    if(typeof tkpPersistCollections==='function')tkpPersistCollections(['forward_tracking_log'],{label:'forward-tracking-backfill'});
    else saveDB(false);
  }catch(_e){}
  return changed;
}
if(typeof window!=='undefined') window.tkpForwardTrackingBackfillAll=tkpForwardTrackingBackfillAll;

function tkpForwardTrackingAttachCouponSnapshot(snapshot,options={}){
  if(!snapshot||!db) return false; const log=tkpForwardTrackingEnsureLog(); let changed=false;
  const byKey=new Map(); for(const row of log){if(row?.race_key!=null&&!byKey.has(String(row.race_key)))byKey.set(String(row.race_key),row);}
  for(const [type,c] of Object.entries(snapshot.coupons||{})){
    for(const leg of (c?.legs||[])){
      const key=[String(snapshot.race_date||''),tkpForwardTrackingTrackKey(snapshot.hippodrome||''),Number(snapshot.altili_no)||1,Number(leg.leg)||0].join('|');
      const rec=byKey.get(String(key))||null; if(!rec) continue;
      rec.coupons=rec.coupons||{}; rec.coupons[type]=(leg.picks||[]).map(String); changed=true;
      if(rec.narrow_bmb_no && rec.coupons[type].some(no=>sameEkuri(no,rec.narrow_bmb_no))) rec.narrow_bmb_coupon=1;
    }
  }
  if(changed&&options.persist!==false&&globalThis.__tkpBulkPipelineActive!==true) try{
    if(typeof tkpPersistCollections==='function')tkpPersistCollections(['forward_tracking_log'],{label:'forward-coupon-snapshot'});
    else saveDB(false);
  }catch(_e){} return changed;
}

// R19.2 — Forward/weekly evidence must be frozen while the race is still pre-race.
// Earlier builds only synchronized these ledgers after a result import; by then the
// leakage guards correctly refused to create a missing snapshot, so the UI looked
// permanently stuck on the last day that happened to have evidence. Capture is
// background-only, cooperative and idempotent; first paint/coupon creation never waits.
let _tkpPreRaceEvidenceDoneSignature='';
let _tkpPreRaceEvidencePendingSignature='';
function tkpPreRaceEvidenceSignature(raceResults){
  const rows=[];
  for(const x of (Array.isArray(raceResults)?raceResults:[])){
    const r=x?.r||x;if(!r)continue;
    let hasResult=false;try{hasResult=raceHasConfirmedResult(r?.horses||[]);}catch(_e){}
    if(hasResult)continue;
    const order=(x?.scored||r?.horses||[]).filter(Boolean);
    rows.push(tkpForwardTrackingKey(r)+'#'+order.map(h=>[String(h?.horse_no||''),Number(h?.score??h?.prediction_score_snapshot??0).toFixed(4),Number(h?.bmb)||0,Number(h?.ypuan)||0].join(':')).join(','));
  }
  return rows.join('|');
}
function tkpSchedulePreRaceEvidenceCapture(raceResults){
  if(!db||!Array.isArray(raceResults)||!raceResults.length)return false;
  const eligible=raceResults.filter(x=>{try{return !raceHasConfirmedResult((x?.r||x)?.horses||[]);}catch(_e){return true;}});
  if(!eligible.length)return false;
  const signature=tkpPreRaceEvidenceSignature(eligible);
  if(!signature||signature===_tkpPreRaceEvidenceDoneSignature||signature===_tkpPreRaceEvidencePendingSignature)return false;
  _tkpPreRaceEvidencePendingSignature=signature;
  const frozen=eligible.slice();
  const run=async()=>{
    if(_tkpPreRaceEvidencePendingSignature!==signature)return false;
    let forwardChanged=false,weeklyChanged=false;
    const previousBulk=globalThis.__tkpBulkPipelineActive===true;
    globalThis.__tkpBulkPipelineActive=true;
    try{
      for(let i=0;i<frozen.length;i++){
        const one=frozen[i],r=one?.r||one;
        let resultKnown=false;try{resultKnown=raceHasConfirmedResult(r?.horses||[]);}catch(_e){}
        if(!resultKnown){
          try{if(tkpForwardTrackingSync([one]))forwardChanged=true;}catch(_e){}
          try{if(typeof tkpWeeklyModelTrackerSync==='function'&&tkpWeeklyModelTrackerSync([one]))weeklyChanged=true;}catch(_e){}
        }
        if(typeof tkpYieldToUi==='function')await tkpYieldToUi();
        else await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{globalThis.__tkpBulkPipelineActive=previousBulk;}
    _tkpPreRaceEvidencePendingSignature='';
    _tkpPreRaceEvidenceDoneSignature=signature;
    if(forwardChanged||weeklyChanged){
      try{
        if(typeof tkpPersistCollections==='function')await tkpPersistCollections(['forward_tracking_log','weekly_model_log'],{metaPatch:{settings:db.settings,learning_state:db.learning_state},label:'pre-race-evidence'});
        else if(typeof saveDB==='function')await saveDB(false);
      }catch(_e){}
      try{if(typeof tkpRefreshLearningDailyPanels==='function')tkpRefreshLearningDailyPanels();}catch(_e){}
    }
    return forwardChanged||weeklyChanged;
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask('pre-race-evidence-capture',run,{priority:'background',replace:true,minIdleMs:1200});
  else if(typeof requestIdleCallback==='function')requestIdleCallback(()=>run(),{timeout:2500});
  else setTimeout(()=>run(),900);
  return true;
}
if(typeof window!=='undefined')window.tkpSchedulePreRaceEvidenceCapture=tkpSchedulePreRaceEvidenceCapture;
// V1.1.307 — 10M-safe + 4/8/16 cooperative İleri Takip görünüm modeli.
// İlk panel açılışında 10M satırı SENKRON taramak yasak: UI önce boyanır, tarama
// 4→8→16 adaptif work-unit ile ilerler. Work-unit burada 256 log satırıdır;
// yani bir slice 1024/2048/4096 satır işler ve her slice sonunda input'a yol verir.
let _tkpForwardViewCache={signature:'',value:null};
let _tkpForwardViewBuildPromise=null;
const TKP_FORWARD_VIEW_DURABLE_CACHE_KEY='tkp_forward_tracking_view_v3_coupon_singles';
let _tkpForwardViewDurableReadPromise=null;
async function tkpReadDurableForwardView(signature){
  if(typeof tkpUiCacheGet!=='function')return null;
  if(_tkpForwardViewDurableReadPromise)return _tkpForwardViewDurableReadPromise;
  _tkpForwardViewDurableReadPromise=Promise.resolve(tkpUiCacheGet(TKP_FORWARD_VIEW_DURABLE_CACHE_KEY)).then(row=>{
    if(row&&row.version===2&&String(row.signature||'')===String(signature||'')&&row.value&&typeof row.value==='object')return row.value;
    return null;
  }).catch(()=>null).finally(()=>{_tkpForwardViewDurableReadPromise=null;});
  return _tkpForwardViewDurableReadPromise;
}
function tkpWriteDurableForwardView(signature,value){
  if(typeof tkpUiCacheSet!=='function'||!signature||!value)return false;
  Promise.resolve().then(()=>tkpUiCacheSet(TKP_FORWARD_VIEW_DURABLE_CACHE_KEY,{version:2,signature,value,savedAt:Date.now()})).catch(()=>{});
  return true;
}
function tkpForwardTrackingRecencyCmp(a,b){
  const da=String(a?.race_date||''),dbb=String(b?.race_date||'');
  if(da!==dbb)return da<dbb?-1:1; // eski < yeni
  const la=Number(a?.leg)||0,lb=Number(b?.leg)||0;
  if(la!==lb)return la>lb?-1:1; // aynı gün küçük ayak daha önce gösterilsin
  const ta=String(a?.evaluated_at||a?.created_at||''),tb=String(b?.evaluated_at||b?.created_at||'');
  return ta===tb?0:(ta<tb?-1:1);
}
function tkpBoundedRecentPush(heap,row,limit){
  if(limit<=0)return;
  const cmp=tkpForwardTrackingRecencyCmp;
  const up=(i)=>{while(i>0){const p=(i-1)>>1;if(cmp(heap[p],heap[i])<=0)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
  const down=(i)=>{for(;;){let l=i*2+1,r=l+1,m=i;if(l<heap.length&&cmp(heap[l],heap[m])<0)m=l;if(r<heap.length&&cmp(heap[r],heap[m])<0)m=r;if(m===i)break;[heap[i],heap[m]]=[heap[m],heap[i]];i=m;}};
  if(heap.length<limit){heap.push(row);up(heap.length-1);return;}
  if(cmp(row,heap[0])<=0)return;
  heap[0]=row;down(0);
}
function tkpForwardTrackingViewSignature(src){
  const last=src.length?src[src.length-1]:null;
  // R16.36: _tkpDbRevision her saveDB()'de artıyordu; bahis/tanı/kupon kaydı bile
  // İleri Takip'in tüm logunu yeniden taratıyordu. Görünüm yalnız forward kayıtları,
  // sonuç revizyonu, seçili gün ve kupon snapshot revizyonuna bağlıdır.
  return [
    'FORWARD_VIEW_V3_COUPON_SINGLES',String(db?.learning_state?.dataset_signature||''),String(db?.learning_state?.outcome_signature||''),
    src.length,String(last?.evaluated_at||last?.created_at||''),String(last?.race_date||''),String(last?.leg||''),
    Number(db?.settings?.backtest_snapshot_revision)||0,tkpSelectedTrackingDate(src)
  ].join('|');
}
function tkpForwardTrackingEvidenceReady(r){
  // Snapshotı olmayan eski satır, gerçek "kaçış" değildir: sonucu görüp neden
  // uydurmak algoritmayı bozar. Bu satırlar kayıtlı kalır ama öğrenme/kaçış
  // sayacına ve günlük listeye giremez.
  const candidates=Array.isArray(r?.pre_race_candidates)&&r.pre_race_candidates.length>0;
  const coupons=r?.coupons||{};
  const hasCoupon=['main','surprise','alt'].some(key=>Array.isArray(coupons[key])&&coupons[key].length>0);
  return candidates&&hasCoupon;
}
function tkpForwardViewAccumulator(displayDate=''){
  return {
    st:{rows:0,liveRows:0,historicalRows:0,done:0,leaderWin:0,leaderTop3:0,leaderTop5:0,singles:0,singleHit:0,bmb:0,bmbWin:0,odb:0,odbWin:0,odbTop5:0,prof:0,profWin:0,profTop5:0,bomb:0,bombWin:0,bombTop5:0,mainMiss:0,singleLoss:0,evidenceExcluded:0},
    latest:[],misses:[],missCount:0,displayDate,dailyRows:[],dailyMisses:[],dailyTotal:0,dailyEvidenceExcluded:0
  };
}
function tkpForwardViewConsume(acc,r){
  // Görüntüleme canlı capture tarihiyle filtrelenmez. Bu kayıt zaten daha önce
  // dondurulmuş bir snapshot'tır; tarihsel olanlar ayrı sayaç/etiketle gösterilir.
  const st=acc.st,historical=Number(r?.historical_calibration)===1||String(r?.evidence_lane||'').startsWith('HISTORICAL')||!tkpForwardTrackingWithinLiveFinal(r);
  st.rows++;if(historical)st.historicalRows++;else st.liveRows++;tkpBoundedRecentPush(acc.latest,r,250);
  const inDisplayDate=!!acc.displayDate&&String(r?.race_date||'').slice(0,10)===acc.displayDate;
  if(inDisplayDate){acc.dailyTotal++;tkpBoundedRecentPush(acc.dailyRows,r,18);}
  const done=!!(r?.evaluated_at&&String(r?.winner_no||'').trim());
  if(!done)return;
  st.done++;st.leaderWin+=Number(r.leader_win)||0;st.leaderTop3+=Number(r.leader_top3)||0;st.leaderTop5+=Number(r.leader_top5)||0;
  const evidenceReady=tkpForwardTrackingEvidenceReady(r);
  if(!evidenceReady){st.evidenceExcluded++;if(inDisplayDate)acc.dailyEvidenceExcluded++;return;}
  // TEK KPI yalnız eski selective-single bayrağını değil, yarıştan önce dondurulmuş
  // gerçek Normal/Sürpriz/Uzman kuponlarındaki tek ayakları sayar. Üç rol aynı atı
  // TEK yazdıysa bir örnek, farklı at yazdıysa ayrı adaylar olarak değerlendirilir.
  const couponSingles=[...new Set(['main','alt','surprise'].map(key=>Array.isArray(r?.coupons?.[key])&&r.coupons[key].length===1?String(r.coupons[key][0]||'').trim():'').filter(Boolean))];
  if(couponSingles.length){
    st.singles+=couponSingles.length;
    for(const no of couponSingles){const hit=tkpForwardTrackingSameHorse(no,r.winner_no);if(hit)st.singleHit++;else st.singleLoss++;}
  }else if(r.single_reliable===1){st.singles++;st.singleHit+=Number(r.single_hit)||0;if(Number(r.single_hit)===0)st.singleLoss++;}
  if(Number(r.main_hit)===0)st.mainMiss++;
  if(r.narrow_bmb_no){st.bmb++;st.bmbWin+=Number(r.narrow_bmb_win)||0;}
  if(String(r.odb_no||'').trim()){st.odb++;st.odbWin+=Number(r.odb_win)||0;st.odbTop5+=Number(r.odb_top5)||0;}
  if(String(r.prof_no||'').trim()){st.prof++;st.profWin+=Number(r.prof_win)||0;st.profTop5+=Number(r.prof_top5)||0;}
  if((r.bomb_candidates||[]).length){st.bomb++;st.bombWin+=Number(r.bomb_any_win)||0;st.bombTop5+=Number(r.bomb_any_top5)||0;}
  if(r.main_hit===0||r.surprise_hit===0||(r.single_reliable===1&&r.single_hit===0)){
    acc.missCount++;tkpBoundedRecentPush(acc.misses,r,18);if(inDisplayDate)tkpBoundedRecentPush(acc.dailyMisses,r,8);
  }
}
function tkpForwardViewFinalize(acc,signature){
  const newest=(a,b)=>-tkpForwardTrackingRecencyCmp(a,b);
  acc.latest.sort(newest);acc.misses.sort(newest);acc.dailyRows.sort(newest);acc.dailyMisses.sort(newest);
  const value={stats:acc.st,rows:acc.latest,misses:acc.misses,missCount:acc.missCount,displayDate:acc.displayDate,dailyRows:acc.dailyRows,dailyMisses:acc.dailyMisses,dailyTotal:acc.dailyTotal,dailyEvidenceExcluded:acc.dailyEvidenceExcluded};
  _tkpForwardViewCache={signature,value};tkpWriteDurableForwardView(signature,value);return value;
}
function tkpForwardTrackingViewModel(){
  const src=tkpForwardTrackingEnsureLog(),signature=tkpForwardTrackingViewSignature(src);
  if(_tkpForwardViewCache.signature===signature&&_tkpForwardViewCache.value)return _tkpForwardViewCache.value;
  // Geriye uyum için senkron API korunur; fakat UI yolu bunu cache hazırlanMADAN çağırmaz.
  const acc=tkpForwardViewAccumulator(tkpSelectedTrackingDate(src));
  for(let i=0;i<src.length;i++)tkpForwardViewConsume(acc,typeof src.__tkpAt==='function'?src.__tkpAt(i):src[i]);
  return tkpForwardViewFinalize(acc,signature);
}
async function tkpPrepareForwardTrackingViewAsync(onProgress=null){
  const src=tkpForwardTrackingEnsureLog(),signature=tkpForwardTrackingViewSignature(src);
  if(_tkpForwardViewCache.signature===signature&&_tkpForwardViewCache.value)return _tkpForwardViewCache.value;
  if(_tkpForwardViewBuildPromise)return _tkpForwardViewBuildPromise;
  const build=async()=>{
    // Ctrl+F5 yalnız RAM'i temizler. Önce küçük kalıcı görünüm snapshotını oku;
    // imza eşleşiyorsa forward_tracking_log baştan taranmaz.
    const persisted=await tkpReadDurableForwardView(signature);
    if(persisted){_tkpForwardViewCache={signature,value:persisted};return persisted;}
    const acc=tkpForwardViewAccumulator(tkpSelectedTrackingDate(src));
    if(typeof tkpRunAdaptiveRange==='function'){
      await tkpRunAdaptiveRange('forward-tracking-view',src.length,async(start,end)=>{
        for(let i=start;i<end;i++)tkpForwardViewConsume(acc,typeof src.__tkpAt==='function'?src.__tkpAt(i):src[i]);
      },{stride:256,budgetMs:10,onProgress:(done,total,job)=>{if(typeof onProgress==='function')onProgress(done,total,job);}});
    }else{
      let i=0,chunk=4;
      while(i<src.length){const end=Math.min(src.length,i+chunk);for(;i<end;i++)tkpForwardViewConsume(acc,typeof src.__tkpAt==='function'?src.__tkpAt(i):src[i]);await new Promise(r=>setTimeout(r,0));chunk=Math.min(16,chunk*2);}
    }
    return tkpForwardViewFinalize(acc,signature);
  };
  _tkpForwardViewBuildPromise=build().finally(()=>{_tkpForwardViewBuildPromise=null;});
  return _tkpForwardViewBuildPromise;
}
if(typeof window!=='undefined')window.tkpPrepareForwardTrackingViewAsync=tkpPrepareForwardTrackingViewAsync;
function tkpForwardTrackingStats(){return tkpForwardTrackingViewModel().stats;}
function tkpForwardTrackingFreshnessHTML(view){
  const state=db?.settings?.r19_2_integrity||{};
  const latestResult=String(state?.latest_result_date||'').slice(0,10);
  const latestEvidence=String(state?.latest_forward_date||view?.displayDate||'').slice(0,10);
  const fmtDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?displayDateTR(d):'—';
  const lag=latestResult&&latestEvidence&&latestResult>latestEvidence;
  return `<p class="muted tkpFreshnessEvidence" style="margin:4px 0 7px;font-size:10.5px;"><b>Son resmî sonuç:</b> ${esc(fmtDate(latestResult))} · <b>Son kanıtlı yarış-öncesi takip:</b> ${esc(fmtDate(latestEvidence))}${lag?' · <b>Yeni sonuç var, yeni kanıtlı pre-race snapshot yok.</b>':''}. Veri sızıntısını önlemek için eksik yarış-öncesi snapshot sonradan üretilmez.</p>`;
}
function tkpForwardTrackingTableHTML(){
  const view=tkpForwardTrackingViewModel(),rows=view.dailyRows||[];
  const st=view.stats; const pct=(a,b)=>Number(b)>0?('%'+fmt2(100*a/b)):'—';
  // Panel açılışında tkpFailureLearningModel() bütün forward logu ikinci kez
  // taramıyordu; 10M'de bu çift tarama dakikalarca bloklayabiliyordu. İhtiyaç duyulan
  // iki KPI aynı cooperative tek geçişte zaten toplanıyor.
  const fl={rows:st.done,mainMiss:st.mainMiss||0,singleLoss:st.singleLoss||0,ready:st.done>0,singleReady:st.singles>0};
  // Yalnız yüzde göstermek örneklemi gizliyordu: %0,00 hem 0/1 hem 0/300 gibi
  // tamamen farklı anlamlara gelebilir. TEK yalnız kanıtlı, güvenilir snapshotlar
  // içinden ölçülür; bu yüzden pay/payda görünür kalmalıdır.
  const singleKpi=st.singles>0?`${st.singleHit}/${st.singles} · ${pct(st.singleHit,st.singles)}`:'—';
  const kpis=[
    ['Kayıt',st.rows,'data'],['Sonuçlanan',st.done,'done'],['Top-1',pct(st.leaderWin,st.done),'top1'],['İlk 3',pct(st.leaderTop3,st.done),'top3'],
    ['İlk 5',pct(st.leaderTop5,st.done),'top5'],['TEK',singleKpi,'single'],['ODB kazanma',pct(st.odbWin,st.odb),'odb'],['BMB kazanma',pct(st.bmbWin,st.bmb),'bmb']
  ];
  const body=rows.map(r=>{
    const historical=Number(r?.historical_calibration)===1||String(r?.evidence_lane||'').startsWith('HISTORICAL')||!tkpForwardTrackingWithinLiveFinal(r);
    const status=(historical?'ARŞİV ':'')+(r.evaluated_at?(r.leader_win?'✅':'●'):'⏳');
    const c=r.coupons||{}; const fmtP=k=>(c[k]||[]).join('-')||'-';
    const bh=(r.bomb_candidates||[]).map(x=>x.horse_no).join('/')||'-';
    const support=[r.odb_no?`ODB ${r.odb_no}`:'',r.narrow_bmb_no?`BMB ${r.narrow_bmb_no}`:'',bh!=='-'?`BH ${bh}`:''].filter(Boolean).join(' · ')||'-';
    const couponResult=r.evaluated_at?`N ${fmtP('main')} · S ${fmtP('surprise')}`:'BEKLİYOR';
    return `<tr><td>${status}</td><td>${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(r.hippodrome):r.hippodrome||'')} · ${r.altili_no||1}/${r.leg||''}</td><td><span class="horseNoBadge">${esc(r.leader_no)}</span> ${esc(r.leader_name||'')}</td><td class="num">${r.leader_score==null?'-':fmt2(r.leader_score)}<small>PROF %${r.leader_prof??0}</small></td><td>${esc(support)}</td><td>${r.single_reliable?(r.single_no?'<b>TEK '+esc(r.single_no)+'</b>':'<b>TEK</b>'):(r.single_candidate?'ADAY':'-')}<small>${esc(couponResult)}</small></td><td>${r.evaluated_at?(r.winner_no?'<span class="horseNoBadge">'+esc(r.winner_no)+'</span> '+esc(r.winner_name||''):'-'):'BEKLİYOR'}</td></tr>`;
  }).join('');
  const kpiHtml=kpis.map(([label,value,tone])=>`<span class="badge forwardKpi forwardKpi-${tone}"><b>${esc(label)}</b> ${esc(String(value))}</span>`).join('');
  const dayLabel=view.displayDate?displayDateTR(view.displayDate):'Seçili gün';
  return `<div id="tkpForwardTrackingDailyPanel" class="card tkpForwardTracker" style="border-left:5px solid #0284c7;margin-bottom:10px;"><h2 style="margin:0 0 5px;">📈 İleri Takip · ${esc(dayLabel)}</h2>${tkpForwardTrackingFreshnessHTML(view)}<p class="muted" style="margin:0 0 8px;">Ekranda yalnız seçili yarış gününün ${view.dailyTotal} kaydı var. Tüm geçmiş kalıcı tutulur; aşağıdaki KPI'lar tüm doğrulanmış kayıttandır.</p><div class="row forwardKpiRow" style="gap:6px;margin-bottom:8px;">${kpiHtml}</div><div class="tableWrap compactBacktest tkpForwardDailyCompact"><table><thead><tr><th>Durum</th><th>Koşu</th><th>Lider</th><th>TKP</th><th>Destek</th><th>Kupon</th><th>Kazanan</th></tr></thead><tbody>${body||'<tr><td colspan="7" class="empty">Bu gün için yarış-öncesi takip kaydı yok.</td></tr>'}</tbody></table></div><p class="muted" style="margin:7px 0 0;font-size:10.5px;">Kanıt dışı ${view.dailyEvidenceExcluded||0} satır ekran/öğrenme kaçışına katılmadı. Tam geçmiş .tkbz yedeğinde korunur.</p></div>`;
}
function tkpForwardTrackingReasonsHTML(){
  const view=tkpForwardTrackingViewModel(),rows=view.dailyMisses||[];
  if(!rows.length)return `<div id="tkpForwardReasonsDailyPanel" class="card tkpForwardReasonTrackingText"><h2>📝 İleri Takip · Neden Kaçtı</h2>${tkpForwardTrackingFreshnessHTML(view)}<p class="muted">Seçili gün için kanıtlı kaçış kaydı yok. Kanıtsız eski satırlar öğrenmeye katılmaz.</p></div>`;
  const notes=rows.map(r=>{
    const meeting=`${esc(displayDateTR(r.race_date||''))} · ${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(r.hippodrome):r.hippodrome||'')} · ${Number(r.altili_no)||1}. Altılı · ${Number(r.leg)||'-'}. Ayak`;
    const winner=r.winner_no?`Kazanan <b>${esc(r.winner_no)}</b> ${esc(r.winner_name||'')}`:'Kazanan -';
    const parts=[];
    if(r.main_hit===0)parts.push(`<b>Normal:</b> ${esc(r.main_miss_reason||'-')}`);
    if(r.surprise_hit===0)parts.push(`<b>Sürpriz:</b> ${esc(r.surprise_miss_reason||'-')}`);
    if(r.single_reliable===1&&r.single_hit===0)parts.push(`<b>TEK:</b> ${esc(r.single_miss_reason||'-')}`);
    return `<p class="tkpForwardReasonTrackingLine"><b>${meeting}</b> · ${winner}<br>${parts.join(' · ')}</p>`;
  }).join('');
  return `<div id="tkpForwardReasonsDailyPanel" class="card tkpForwardReasonTrackingText"><h2>📝 İleri Takip · Neden Kaçtı</h2>${tkpForwardTrackingFreshnessHTML(view)}<p class="muted">Seçili günün ${rows.length} kanıtlı kaçışı gösterilir. Tüm arşivde öğrenmeye alınan kaçış: ${view.missCount}.</p><div class="tkpForwardReasonTrackingNotes">${notes}</div></div>`;
}

let _tkpForwardDailyRefreshQueued=false;
function tkpRefreshLearningDailyPanels(){
  const root=$('#learningTable');
  if(!root)return false;
  const source=tkpForwardTrackingEnsureLog(),wanted=tkpForwardTrackingViewSignature(source);
  if(_tkpForwardViewCache.signature!==wanted||!_tkpForwardViewCache.value){
    if(_tkpForwardDailyRefreshQueued)return false;
    _tkpForwardDailyRefreshQueued=true;
    Promise.resolve(tkpPrepareForwardTrackingViewAsync()).then(()=>{
      _tkpForwardDailyRefreshQueued=false;tkpRefreshLearningDailyPanels();
    }).catch(()=>{_tkpForwardDailyRefreshQueued=false;});
    return false;
  }
  const replace=(id,html)=>{const old=root.querySelector('#'+id);if(old)old.outerHTML=html;};
  replace('tkpForwardTrackingDailyPanel',tkpForwardTrackingTableHTML());
  replace('tkpForwardReasonsDailyPanel',tkpForwardTrackingReasonsHTML());
  if(typeof tkpV55SideBetTrackingTextHTML==='function')replace('tkpSideBetRescueDailyPanel',tkpV55SideBetTrackingTextHTML());
  return true;
}
if(typeof window!=='undefined')window.tkpRefreshLearningDailyPanels=tkpRefreshLearningDailyPanels;

let _tkpForwardResizeCleanup=null;
function tkpForwardTrackingInitScrollers(){
  // Renderer tekrar açıldığında eski global resize/observer bağlantısını kesin temizle.
  // Önceki sürüm her açılışta yeni window.resize listener bırakıyordu; uzun oturumda
  // aynı hesap onlarca kez tetiklenip arayüzü giderek ağırlaştırabiliyordu.
  if(typeof _tkpForwardResizeCleanup==='function'){
    try{ _tkpForwardResizeCleanup(); }catch(_e){}
    _tkpForwardResizeCleanup=null;
  }
  const card=document.querySelector('#tkpRoot .tkpForwardTracker');
  if(!card) return;
  const main=card.querySelector('.forwardMainScroll');
  const top=card.querySelector('.forwardTopScroll');
  const inner=card.querySelector('.forwardTopScrollInner');
  const table=main?.querySelector('table');
  if(!main||!top||!inner||!table) return;
  let widthFrame=0;
  const syncWidthNow=()=>{ widthFrame=0; inner.style.width=Math.max(table.scrollWidth, main.clientWidth)+'px'; };
  const syncWidth=()=>{
    if(widthFrame) return;
    widthFrame=requestAnimationFrame(syncWidthNow);
  };
  syncWidthNow();
  let lock=false;
  top.addEventListener('scroll',()=>{ if(lock)return; lock=true; main.scrollLeft=top.scrollLeft; lock=false; },{passive:true});
  main.addEventListener('scroll',()=>{ if(lock)return; lock=true; top.scrollLeft=main.scrollLeft; lock=false; },{passive:true});
  let ro=null;
  if(typeof ResizeObserver!=='undefined'){ ro=new ResizeObserver(syncWidth); ro.observe(table); ro.observe(main); }
  window.addEventListener('resize',syncWidth,{passive:true});
  _tkpForwardResizeCleanup=()=>{
    try{ if(widthFrame) cancelAnimationFrame(widthFrame); }catch(_e){}
    try{ ro?.disconnect(); }catch(_e){}
    try{ window.removeEventListener('resize',syncWidth); }catch(_e){}
  };
}

function tkpKulvarKomsuBombaStats(){
  // SHADOW / DENEYSEL İZLEME (2026-08-23, kullanıcı isteği): "Favori kaybettiğinde
  // kazanan sık sık favorinin bir alt/üst kulvarında çıkıyor" gözlemi test edildi.
  // Gerçek arşivde (2.888 koşu) ölçüldü: favori kaybettiğinde kazananın favorinin
  // ±1 kulvarında çıkma oranı %21,6 — SAF RASTGELE BEKLENTİYLE (alan büyüklüğüne
  // göre ~%22,1) İSTATİSTİKSEL OLARAK AYNI. Yani ölçülebilir bir sinyal YOK.
  // KULLANICI KARARI: yine de deneysel/shadow olarak izlensin — kupon/skor/tahmine
  // KESİNLİKLE karışmaz, yalnız Deneysel Takip Merkezi panelinde bilgi amaçlı
  // gösterilir. Gelecekte örneklem büyüdükçe veya farklı bir kırılımda (yalnız
  // Altılı, belirli hipodrom vb.) gerçek bir sinyal ortaya çıkarsa değerlendirilir.
  const races=(typeof learningEligibleRaces==='function'?learningEligibleRaces():[]).filter(r=>raceHasConfirmedResult(r?.horses||[]));
  let favoriteLost=0, winnerIsNeighbor=0, fieldSizeSum=0;
  for(const r of races){
    const horses=(r.horses||[]).filter(h=>!isNonRunner(h));
    const favorite=horses.find(h=>Number(h.agf_rank)===1);
    const winner=horses.find(h=>Number(h.winner)===1||Number(h.finish_position)===1);
    if(!favorite||!winner||favorite===winner) continue;
    const favNo=Number(favorite.start_no), winNo=Number(winner.start_no);
    if(!Number.isFinite(favNo)||!Number.isFinite(winNo)) continue;
    favoriteLost++;
    fieldSizeSum+=horses.length;
    if(Math.abs(winNo-favNo)===1) winnerIsNeighbor++;
  }
  const avgField=favoriteLost?fieldSizeSum/favoriteLost:0;
  const randomExpectedRate=avgField>1?2/(avgField-1):0;
  return {favoriteLost, winnerIsNeighbor, actualRate:favoriteLost?winnerIsNeighbor/favoriteLost:0, randomExpectedRate};
}
function tkpHistoricalSurpriseProfileHTML(){
  const races=(typeof learningEligibleRaces==='function'?learningEligibleRaces():[]).filter(r=>raceHasConfirmedResult(r?.horses||[]));
  let total=0, agf4=0, agf6=0, agf8=0, bmb=0, odb=0, gpr=0, jbyg3=0, work6=0, value70=0;
  for(const r of races){
    const w=(r.horses||[]).find(h=>Number(h.winner)===1||Number(h.finish_position)===1); if(!w) continue;
    total++;
    const a=Number(w.agf_rank||0); if(a>=4) agf4++; if(a>=6) agf6++; if(a>=8) agf8++;
    if(Number(w.bmb)===1) bmb++; if(Number(w.odb)===1) odb++;
    if(Number(w.priorWins||w.gpr||w.gpr_wins||0)>0) gpr++;
    if(Number(w.jbyg_rank||w.j_beygir_rank||w.jbyg||99)<=3) jbyg3++;
    if(Number(w.workout_rank||w.galop_rank||w.rank_400g||w.rank_800g||99)<=6) work6++;
    if(Number(w.value_score??w.value??w.VALUE??0)>=70) value70++;

  }
  const kulvar=tkpKulvarKomsuBombaStats();
  const pct=n=>total>=TKP_GLOBAL_MIN_PERCENT_SAMPLE?('%'+fmtPct(100*n/total)):`n=${total}/${TKP_GLOBAL_MIN_PERCENT_SAMPLE}`;
  let comboHtml='';
  try{
    const labels={TR60_70:'TR 60–70',TR30_60:'TR 30–60',TR20_30:'TR 20–30',BMB:'BMB',ODB:'ODB',BMB_TR30_60:'BMB + TR30–60',BMB_AGF8P_TR30_60:'BMB + AGF8+ + TR30–60',ODB_AGF7P_TR20P:'ODB + AGF7+ + TR20+',TR60_70_AGF4P:'TR60–70 + AGF4+',TR30_60_AGF6P:'TR30–60 + AGF6+',BOTTOM4_TR20_30_LOCALHIGH:'Son4 · TR20–30 grup lideri',BMB_BOTTOM4_TR20_60:'Son4 + BMB + TR20–60'};
    const rows=typeof tkpWinnerComboSummary==='function'?tkpWinnerComboSummary(null):[];
    comboHtml=`<h3 style="margin:10px 0 5px;">🔎 Kazanan Profil Analizi · AGF/BMB/ODB/TR</h3><div class="tableWrap compactBacktest tkpCenteredStats tkpWinnerProfileStats"><table style="width:100%!important;table-layout:fixed!important"><colgroup><col style="width:44%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup><thead><tr><th style="text-align:left!important">Ortak profil</th><th class="num" style="text-align:center!important;vertical-align:middle!important">Örnek</th><th class="num" style="text-align:center!important;vertical-align:middle!important">Kazandı</th><th class="num" style="text-align:center!important;vertical-align:middle!important">İlk 3</th><th class="num" style="text-align:center!important;vertical-align:middle!important">İlk 5</th></tr></thead><tbody>${rows.map(x=>`<tr><td style="text-align:left!important">${esc(labels[x.key]||x.key)}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${x.starts}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${x.starts>=TKP_GLOBAL_MIN_PERCENT_SAMPLE?'%'+fmtPct(100*x.winRate):`n=${x.starts}/${TKP_GLOBAL_MIN_PERCENT_SAMPLE}`}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${x.starts>=TKP_GLOBAL_MIN_PERCENT_SAMPLE?'%'+fmtPct(100*x.top3Rate):`n=${x.starts}/${TKP_GLOBAL_MIN_PERCENT_SAMPLE}`}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${x.starts>=TKP_GLOBAL_MIN_PERCENT_SAMPLE?'%'+fmtPct(100*x.top5Rate):`n=${x.starts}/${TKP_GLOBAL_MIN_PERCENT_SAMPLE}`}</td></tr>`).join('')}</tbody></table></div>`;
  }catch(_){}
  return `<div class="card tkpSurpriseHistoryCard" style="border-left:5px solid #7c3aed;margin-bottom:10px;"><h2 style="margin:0 0 5px;">📚 Geçmiş Sürpriz Profili</h2><p class="muted" style="margin:0 0 8px;">Yalnız sonuçlanmış geçmiş koşulardan fikir verir; canlı tahmin veya kuponu otomatik değiştirmez.</p><div class="tableWrap compactBacktest tkpCenteredStats tkpSurpriseProfileStats"><table style="width:100%!important;table-layout:fixed!important"><colgroup><col style="width:55%"><col style="width:22.5%"><col style="width:22.5%"></colgroup><thead><tr><th style="text-align:left!important">Profil</th><th class="num" style="text-align:center!important;vertical-align:middle!important">Kazanan</th><th class="num" style="text-align:center!important;vertical-align:middle!important">Tüm kazananlara oran</th></tr></thead><tbody><tr><td>AGF sıra ≥4</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${agf4}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(agf4)}</td></tr><tr><td>AGF sıra ≥6 · gerçek sürpriz</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${agf6}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(agf6)}</td></tr><tr><td>AGF sıra ≥8 · bomba</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${agf8}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(agf8)}</td></tr><tr><td>BMB sinyalli kazanan</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${bmb}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(bmb)}</td></tr><tr><td>ODB sinyalli kazanan</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${odb}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(odb)}</td></tr><tr><td>G.PR geçmiş kazanma profili</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${gpr}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(gpr)}</td></tr><tr><td>J-BYG ilk 3</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${jbyg3}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(jbyg3)}</td></tr><tr><td>400/800G üst 6</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${work6}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(work6)}</td></tr><tr><td>VALUE ≥70</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${value70}/${total}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(value70)}</td></tr><tr><td>🧪 Favori kaybederse kazanan komşu kulvarda (SHADOW)</td><td class=\"num\" style=\"text-align:center!important;vertical-align:middle!important\">${kulvar.winnerIsNeighbor}/${kulvar.favoriteLost}</td><td class=\"num\" style=\"text-align:center!important;vertical-align:middle!important\">${kulvar.favoriteLost>=TKP_GLOBAL_MIN_PERCENT_SAMPLE?`%${fmtPct(100*kulvar.actualRate)} (rastgele: %${fmtPct(100*kulvar.randomExpectedRate)})`:`n=${kulvar.favoriteLost}/${TKP_GLOBAL_MIN_PERCENT_SAMPLE}`}</td></tr></tbody></table></div>${comboHtml}</div>`;
}
async function tkpHistoricalSurpriseProfileHTMLAsync(){
  // Kazanan kombinasyon özeti cold-cache durumunda en pahalı parçadır. Var olan
  // cooperative asenkron motorla önce cache'e alınır; tablo biçimi eski renderer'dan gelir.
  if(typeof tkpWinnerComboSummaryAsync==='function')await tkpWinnerComboSummaryAsync(null);
  return tkpHistoricalSurpriseProfileHTML();
}
const TKP_STRATEGY_HISTORICAL_CACHE_KEY='tkp_strategy_historical_v2_integrity';
function tkpStrategyHistoricalSourceSignature(){
  const persisted=String(db?.learning_state?.outcome_signature||'');
  const outcome=persisted||(typeof tkpOutcomeLearningSignature==='function'?tkpOutcomeLearningSignature(db):'');
  return [outcome,(db?.files||[]).length,(db?.races||[]).length,(db?.prediction_log||[]).length,(db?.auto_coupon_log||[]).length,'R15.4'].join('|');
}
let _tkpStrategyHistoricalHydratePromise=null;
async function tkpHydrateStrategyHistoricalCache(){
  if(!db||typeof tkpUiCacheGet!=='function')return false;
  const signature=tkpStrategyHistoricalSourceSignature();
  if(db.strategy_lab_historical?.source_signature===signature)return true;
  if(_tkpStrategyHistoricalHydratePromise)return _tkpStrategyHistoricalHydratePromise;
  _tkpStrategyHistoricalHydratePromise=Promise.resolve(tkpUiCacheGet(TKP_STRATEGY_HISTORICAL_CACHE_KEY)).then(row=>{
    if(row&&row.source_signature===signature&&row.value&&typeof row.value==='object'){
      db.strategy_lab_historical=row.value;return true;
    }
    return false;
  }).catch(()=>false).finally(()=>{_tkpStrategyHistoricalHydratePromise=null;});
  return _tkpStrategyHistoricalHydratePromise;
}
function tkpStrategyHistoricalEnsure(){
  if(!db || typeof tkpStrategyLabHistoricalBuild!=='function') return null;
  const sig=tkpStrategyHistoricalSourceSignature();
  if(db.strategy_lab_historical?.source_signature===sig) return db.strategy_lab_historical;
  try{
    const built=tkpStrategyLabHistoricalBuild(db);
    if(!built) return null;
    built.source_signature=sig;
    built.built_at=new Date().toISOString();
    db.strategy_lab_historical=built;
    // Türetilmiş Strategy Lab önbelleği ana 509 arşiv manifestini büyütmez. Ayrı
    // UI-cache store'una asenkron yazılır; veri imzası değişmedikçe tekrar hesaplanmaz.
    try{if(typeof tkpUiCacheSet==='function')Promise.resolve(tkpUiCacheSet(TKP_STRATEGY_HISTORICAL_CACHE_KEY,{source_signature:sig,value:built,savedAt:Date.now()})).catch(()=>{});}catch(_e){}
    return built;
  }catch(_e){ return db.strategy_lab_historical||null; }
}

function tkpResearchLabHTML(){
  if(typeof tkpResearchAnalytics!=='function') return '';
  let a=null; try{a=tkpResearchAnalytics(db);}catch(_e){return '';}
  if(!a) return '';
  const f=v=>Number.isFinite(Number(v))?fmt2(Number(v)):'-';
  const pp=v=>Number.isFinite(Number(v))?('%'+fmtPct(Number(v)*100)):'-';
  const cal=a.calibration||{}, risk=a.risk||{}, cov=a.coverage||{}, reuse=a.safe_reuse||{}, hre=a.historical_reuse||{}, integ=a.integrity||{};
  const longRows=(a.longshot||[]).map(x=>`<tr><td>${esc(x.label)}</td><td class="num">${x.n}</td><td class="num">${pp(x.market)}</td><td class="num">${pp(x.actual)}</td><td class="num">${x.bias>=0?'+':''}${pp(x.bias)}</td></tr>`).join('');
  // "Kapsam yok" %0 değildir: eski snapshotın o sinyal alanını taşımadığı
  // anlamına gelir. Bu satırlar Champion/öğrenme hesabına katılmaz.
  const featCell=(z,kind)=>{
    const covered=Number(z?.available)||0,matched=Number(z?.n)||0;
    if(!covered) return '<span class="muted" title="Yarış-öncesi snapshot alanı yok; bu dönem sinyal hesabına katılmadı">Kapsam yok</span>';
    if(kind==='n') return `${matched}<small title="Kapsam: ${covered} güvenli snapshot">/${covered}</small>`;
    if(!matched) return '<span class="muted" title="Kapsam var, ancak bu dilimde sinyal adayı oluşmadı">—</span>';
    const v=Number(z?.[kind]);
    return Number.isFinite(v)?`${kind==='lift'&&v>=0?'+':''}${pp(v)}`:'—';
  };
  const featRows=(a.features||[]).slice().sort((x,y)=>{
    const yc=Number(y.test?.available||0)+Number(y.train?.available||0),xc=Number(x.test?.available||0)+Number(x.train?.available||0);
    return yc-xc||Math.abs(Number(y.test?.lift)||0)-Math.abs(Number(x.test?.lift)||0);
  }).map(x=>`<tr><td>${esc(x.label)}</td><td class="num">${featCell(x.train,'n')}</td><td class="num">${featCell(x.train,'win')}</td><td class="num">${featCell(x.train,'lift')}</td><td class="num">${featCell(x.test,'n')}</td><td class="num">${featCell(x.test,'win')}</td><td class="num">${featCell(x.test,'lift')}</td></tr>`).join('');
  const bins=(cal.bins||[]).map(x=>`<tr><td class="num">%${f(x.lo)}–%${f(x.hi)}</td><td class="num">${x.n}</td><td class="num">%${f(x.pred)}</td><td class="num">%${f(x.actual)}</td><td class="num">${x.gap>=0?'+':''}%${f(x.gap)}</td></tr>`).join('');
  const pacePct=cov.rows?cov.pace/cov.rows:0, mpPct=cov.rows?cov.model_prob/cov.rows:0, mkPct=cov.rows?cov.market_prob/cov.rows:0;
  const wf=db?.settings?.walkforward_500||null;
  const wfHtml=wf?`<h3 style="margin:10px 0 5px;">🏇 ${(db?.files||[]).length} kaynak dosya · ${wf.coverage?.retainedCompleteMeetings??0} tam Altılı referansı</h3><p class="muted" style="margin:0 0 6px;">Bu geçmiş havuz <b>tanısal geliştirme referansıdır</b>. Kayıtlı nihai AGF'nin yarıştan önce alındığını kanıtlayan ayrı zaman damgası ve bütün dönemler için kesin birim tarife geçişi bulunmadığından geçmiş hit/ROI ana algoritmayı seçmez. Gerçek model karşılaştırması Haftalık Algoritma Takibi'nde TJK program saati öncesi snapshotlarla sıfırdan ilerler.</p><div class="tableWrap compactBacktest tkpResearchTable tkpResearchAllCenter"><table><thead><tr><th>Denetim</th><th>Durum</th><th>Kapsam</th><th>Üretim kararı</th></tr></thead><tbody><tr><td>Resmî Altılı kombinasyonu</td><td>${wf.integrity?.officialCombinationEvaluation?'✅':'⚠️'}</td><td>${wf.coverage?.strictOfficialMeetings??'-'} toplantı</td><td>Etiket doğrulama</td></tr><tr><td>Yarış-öncesi AGF zaman kanıtı</td><td>${wf.integrity?.agfTimestampProvenance?'✅ VAR':'❌ YOK'}</td><td>Geçmiş toplu veri</td><td>Champion terfisine kapalı</td></tr><tr><td>Tarihsel birim tarifesi</td><td>${wf.integrity?.historicalUnitTransitionResolved?'✅ TAM':'⚠️ EKSİK GEÇİŞ'}</td><td>Maliyet / ROI</td><td>Karar ölçütü değil</td></tr><tr><td>Canlı haftalık takip</td><td>✅ SAAT KİLİTLİ</td><td>Pazartesi–Pazar</td><td>Yeterli örnekten sonra elle inceleme</td></tr></tbody></table></div>`:'';
  return `<div class="card tkpResearchLab" style="border-left:5px solid #0f766e;margin-top:10px;">
    <h2 style="margin:0 0 5px;">🔬 Araştırma Ölçüm Laboratuvarı · V1.1.229</h2>
    <p class="muted" style="margin:0 0 8px;">Champion ve canlı kupon değişmez. Bu katman yalnız PRE-RACE-FROZEN kayıtlarla kalibrasyon, piyasa edge, longshot bias, zaman sıralı 70/30 holdout ve risk ölçer. Research mevcut yarış-öncesi donmuş kayıtları salt-okunur analiz eder; kullanıcı DB’sine türetilmiş olasılık/pace alanı geri yazmaz. Eski arşivde güvenli geri kazanılabilen veriler ayrı temporal-reconstructed hatta değerlendirilir.</p>
    ${wfHtml}<div class="grid">
      ${kpiCard('Brier · TKP proxy',cal.brier==null?'-':f(cal.brier),'profitNeutral')}
      ${kpiCard('Log Loss · TKP proxy',cal.logloss==null?'-':f(cal.logloss),'profitNeutral')}
      ${kpiCard('Kalibrasyon ECE',cal.ece==null?'-':pp(cal.ece),'profitNeutral')}
      ${kpiCard('Edge adayı kazanma',cal.top_edge?.starts?`${pp(cal.top_edge.rate)} · ${cal.top_edge.wins}/${cal.top_edge.starts}`:'Veri bekleniyor','profitNeutral')}
      ${kpiCard('Gerçek ROI',risk.bets?pp(risk.roi):'-',profitOutcomeClass(Number(risk.net)||0))}
      ${kpiCard('Maks. drawdown',risk.bets?`${f(risk.max_drawdown)} TL`:'-',profitOutcomeClass(-(Number(risk.max_drawdown)||0)))}
      ${kpiCard('Maks. kayıp serisi',risk.bets?String(risk.max_losing_streak):'-','profitNeutral')}
      ${kpiCard('¼ Kelly · teorik',risk.theoretical_kelly?.samples?`${pp(risk.theoretical_kelly.avg_fraction)} ort.`:'Veri bekleniyor','profitNeutral')}
    </div>
    <p class="muted" style="margin:7px 0 8px;font-size:10.5px;">${esc(cal.proxy_note||'')} Kelly yalnız AGF-implied teorik oranla shadow simülasyondur; gerçek bahis tutarı önermez.</p>
    <div class="tableWrap compactBacktest tkpResearchTable tkpResearchTextFirst"><table><thead><tr><th>Veri hazırlığı</th><th class="num">PRE-RACE satır</th><th class="num">Model olasılık</th><th class="num">Piyasa olasılık</th><th class="num">Pace geçmişi</th></tr></thead><tbody><tr><td>Snapshot kapsaması</td><td class="num">${cov.rows||0}</td><td class="num">${pp(mpPct)}</td><td class="num">${pp(mkPct)}</td><td class="num">${pp(pacePct)}</td></tr></tbody></table></div>
    <h3 style="margin:10px 0 5px;">Eski veri güvenli geri kazanım</h3><div class="tableWrap compactBacktest tkpResearchTable tkpResearchTextFirstLast"><table><thead><tr><th>Katman</th><th class="num">Koşu</th><th class="num">At satırı</th><th>Statü</th></tr></thead><tbody><tr><td>Donmuş skor → model olasılık proxy</td><td class="num">${reuse.resolved_races||0}</td><td class="num">${reuse.model_proxy_safe_rows||0}</td><td>✅ PRE-RACE güvenli</td></tr><tr><td>Donmuş AGF → piyasa olasılığı</td><td class="num">${reuse.resolved_races||0}</td><td class="num">${reuse.market_safe_rows||0}</td><td>✅ Yalnız snapshot AGF</td></tr><tr><td>Geçmiş Accurate pace rekonstrüksiyonu</td><td class="num">${hre.pace_races||0}</td><td class="num">${hre.reconstructed_pace_rows||0}</td><td>🧪 Eski tarihlerden; Champion için değil</td></tr><tr><td>Geçmiş form rekonstrüksiyonu</td><td class="num">-</td><td class="num">${hre.reconstructed_form_rows||0}</td><td>🧪 Strict prior-date</td></tr></tbody></table></div><p class="muted" style="margin:5px 0 8px;font-size:10.5px;">${esc(reuse.note||'')} ${esc(hre.note||'')}</p>
    <h3 style="margin:10px 0 5px;">Arşiv bütünlük kontrolü</h3><div class="tableWrap compactBacktest tkpResearchTable tkpResearchAllCenter"><table><thead><tr><th class="num">Dosya</th><th class="num">Koşu</th><th class="num">Prediction</th><th class="num">Frozen</th><th class="num">Tek kazanan</th><th class="num">Kazanan eksik</th><th class="num">Atbaşı</th><th class="num">Açıklanamayan</th><th class="num">Yetim koşu</th></tr></thead><tbody><tr><td class="num">${integ.files||0}</td><td class="num">${integ.races||0}</td><td class="num">${integ.prediction_rows||0}</td><td class="num">${integ.frozen_rows||0}</td><td class="num">${integ.winner_ok||0}</td><td class="num">${integ.winner_missing||0}</td><td class="num">${integ.dead_heat||0}</td><td class="num">${integ.winner_multi_unexplained||0}</td><td class="num">${integ.orphan_races||0}</td></tr></tbody></table></div>
    ${bins?`<h3 style="margin:10px 0 5px;">Kalibrasyon kovaları</h3><div class="tableWrap compactBacktest tkpResearchTable tkpResearchAllCenter"><table><thead><tr><th class="num">Tahmin bandı</th><th class="num">At</th><th class="num">Ort. tahmin</th><th class="num">Gerçek kazanma</th><th class="num">Fark</th></tr></thead><tbody>${bins}</tbody></table></div>`:''}
    ${longRows?`<h3 style="margin:10px 0 5px;">Favorite / Longshot Bias</h3><div class="tableWrap compactBacktest tkpResearchTable tkpResearchTextFirst"><table><thead><tr><th>AGF grubu</th><th class="num">At</th><th class="num">Piyasa payı</th><th class="num">Gerçek kazanma</th><th class="num">Bias</th></tr></thead><tbody>${longRows}</tbody></table></div>`:''}
    ${featRows?`<h3 style="margin:10px 0 5px;">Walk-forward sinyal tanısı · ilk %70 / son %30</h3><p class="muted" style="margin:0 0 5px;font-size:10.5px;">n hücresindeki ikinci sayı güvenli snapshot kapsamıdır. “Kapsam yok” geçmişte o alanın kayıtlı olmadığını belirtir; %0 ya da eksi performans değildir ve öğrenmeye dahil edilmez.</p><div class="tableWrap compactBacktest tkpResearchTable tkpResearchTextFirst"><table><thead><tr><th>Sinyal</th><th class="num">Train n</th><th class="num">Train kazanma</th><th class="num">Train lift</th><th class="num">Test n</th><th class="num">Test kazanma</th><th class="num">Test lift</th></tr></thead><tbody>${featRows}</tbody></table></div>`:''}
  </div>`;
}


function tkpCalibratedSingleHistoricalAnalysis(dbArg=null){
  const src=dbArg||db||{};
  const races=Array.isArray(src?.races)?src.races:[];
  const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
  const kgVal=h=>{try{if(typeof tkpHorseWeightKg==='function'){const v=tkpHorseWeightKg(h);if(v!=null&&Number.isFinite(Number(v)))return Number(v);}}catch(_e){} const v=Number(h?.kg??h?.weight_kg??h?.weight);return Number.isFinite(v)?v:null;};
  const trVal=h=>{const value=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;return value===null?0:num(value,0);};
  const agfPct=h=>num(h?.agf_pct??h?.agf??h?.agf_percent??h?.agf_rate,0);
  const prof=(r,h)=>{try{return Math.max(0,Math.min(100,num(profileStrengthPct(r,h),0)));}catch(_e){return num(h?.profile_strength_pct??h?.prof_pct??h?.prof,0);}};
  const rows=[],coreRows=[],legacyRows=[];
  const veto={weight:{count:0,wouldHit:0},rival:{count:0,wouldHit:0},evidence:{count:0,wouldHit:0},margin:{count:0,wouldHit:0}};
  let resolved=0;
  for(const r of races){
    const pool=(r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h))&&!/\(KOŞMAZ\)/i.test(String(h?.horse_name||'')));
    if(pool.length<2||!pool.some(h=>h?.altili_winner_score!=null)) continue;
    const winner=pool.find(h=>num(h?.winner)===1||num(h?.finish_position)===1);if(!winner)continue;
    resolved++;
    const order=pool.slice().sort((a,b)=>num(b?.altili_winner_score)-num(a?.altili_winner_score)||num(b?.prediction_score_snapshot??b?.score)-num(a?.prediction_score_snapshot??a?.score));
    const first=order[0],second=order[1];
    const confidence=num(first?.altili_winner_score,0),secondConfidence=num(second?.altili_winner_score,0),gap=Math.max(0,confidence-secondConfidence);
    const byAgf=pool.filter(h=>agfPct(h)>0).slice().sort((a,b)=>agfPct(b)-agfPct(a));
    const a1=agfPct(byAgf[0]),a2=agfPct(byAgf[1]),a3=agfPct(byAgf[2]),agfGap=Math.max(0,a1-a2),top3Agf=a1+a2+a3;
    let strongRivals=0;for(const h of pool){if(String(h?.horse_no)!==String(first?.horse_no)&&prof(r,h)>=50)strongRivals++;}
    const trLeader=pool.slice().sort((a,b)=>trVal(b)-trVal(a))[0]||null;
    const leaders=[String(first?.horse_no||''),String(byAgf[0]?.horse_no||''),String(trLeader?.horse_no||'')].filter(Boolean),counts={};leaders.forEach(no=>counts[no]=(counts[no]||0)+1);const agreement=leaders.length?Math.max(0,...Object.values(counts))/leaders.length:0;
    let risk=pool.length>=14?18:pool.length>=10?10:3;
    if(gap<5)risk+=24;else if(gap<10)risk+=15;else if(gap>=20)risk-=6;
    if(a1>0&&a1<12)risk+=15;else if(a1>0&&a1<18)risk+=9;
    if(agfGap>0&&agfGap<3)risk+=12;if(top3Agf>0&&top3Agf<40)risk+=10;
    risk+=Math.min(20,strongRivals*7);if(agreement<.40&&leaders.length>=3)risk+=15;else if(agreement>=.60)risk-=8;
    const cond=String(r?.condition_family||r?.condition_text||'').toLocaleUpperCase('tr-TR');if(/MAIDEN|HAND[İI]KAP/.test(cond))risk+=7;
    risk=Math.max(0,Math.min(100,Math.round(risk)));
    const threshold=risk<70?65:(risk<80?70:76),minGap=risk<70?12:(risk<80?15:18);
    const fp=prof(r,first),sp=prof(r,second),market=num(first?.agf_rank,99)<=2,profile=fp>=50&&(fp-sp)>=8,maxTr=Math.max(0,...pool.map(trVal)),tr=maxTr>0&&trVal(first)===maxTr,evidence=[market,profile,tr].filter(Boolean).length;
    const strongestRivalProfile=Math.max(0,...pool.filter(h=>String(h?.horse_no)!==String(first?.horse_no)).map(h=>prof(r,h))),rivalBlocked=strongestRivalProfile>=60&&(fp-sp)<10;
    const weight=kgVal(first),heavyWeight=(weight!=null&&weight>60),marginOk=gap>=minGap,evidenceOk=evidence>=2;
    const preVeto=confidence>=threshold&&marginOk&&evidenceOk,selected=preVeto&&!rivalBlocked,hit=String(first?.horse_no)===String(winner?.horse_no);
    const legacyLike=confidence>=70&&pool.filter(h=>String(h?.horse_no)!==String(first?.horse_no)).every(h=>prof(r,h)<50);
    const rec={hit,risk,market,profile,tr,evidence,confidence,gap,weight,heavyWeight,horse_no:first?.horse_no,horse_name:first?.horse_name||''};
    if(preVeto)coreRows.push(rec);if(legacyLike)legacyRows.push(rec);
    if(confidence>=threshold&&evidenceOk&&!marginOk){veto.margin.count++;if(hit)veto.margin.wouldHit++;}
    if(confidence>=threshold&&marginOk&&!evidenceOk){veto.evidence.count++;if(hit)veto.evidence.wouldHit++;}
    if(preVeto&&heavyWeight){veto.weight.count++;if(hit)veto.weight.wouldHit++;}
    if(preVeto&&rivalBlocked){veto.rival.count++;if(hit)veto.rival.wouldHit++;}
    if(selected)rows.push(rec);
  }
  const stat=(label,arr,note)=>{const hits=arr.reduce((n,x)=>n+(x.hit?1:0),0);return {label,candidates:arr.length,hits,rate:arr.length?hits/arr.length:null,note};};
  const subset=(label,filter,note)=>stat(label,rows.filter(filter),note);
  const table=[stat('Veto öncesi çekirdek',coreRows,'Güven + risk + P1/P2 fark + 2/3 kanıt'),stat('Final Kalibre TEK',rows,'60 kg hard veto YOK · yalnız rakip PROF/risk vetosu'),stat('Eski-benzeri sert kural',legacyRows,'Güven ≥70 · tüm rakip PROF <50'),subset('Güven 50–59',x=>x.confidence>=50&&x.confidence<60,'TEK verimliliği shadow takip'),subset('Güven 60–69',x=>x.confidence>=60&&x.confidence<70,'TEK verimliliği shadow takip'),subset('Güven ≥70',x=>x.confidence>=70,'TEK verimliliği shadow takip'),subset('Risk <70',x=>x.risk<70,'Güven ≥68 · fark ≥12'),subset('Risk 70–79',x=>x.risk>=70&&x.risk<80,'Güven ≥68 · fark ≥15'),subset('Risk ≥80',x=>x.risk>=80,'Güven ≥68 · fark ≥18'),subset('60 kg üstü',x=>x.heavyWeight,'Hard veto değil; sadece başarı karşılaştırması'),subset('AGF onaylı',x=>x.market,'Lider AGF ilk 2'),subset('PROF onaylı',x=>x.profile,'PROF ≥50 · P2 fark ≥8'),subset('TR onaylı',x=>x.tr,'Gerçek TR lideri')];
  return {resolved,selected:rows.length,hits:rows.reduce((n,x)=>n+(x.hit?1:0),0),table,veto};
}

function tkpTommyPortfolioHistoricalAnalysis(dbArg=null){
  // HIZ + DOĞRULUK KÖK FIX: Shadow geçmiş raporu güncel tahmin motorunu her eski
  // toplantı için yeniden çalıştırmaz. Yalnız kayda alınmış yarış-öncesi sıra/skor,
  // güven ve İleri Takip snapshot'larını okur; sonuç sadece sonradan isabet ölçümüdür.
  const src=dbArg||db||{},races=Array.isArray(src?.races)?src.races:[];
  const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
  const finite=(v)=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const live=r=>(r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
  const winner=r=>live(r).find(h=>num(h?.winner)===1||num(h?.finish_position)===1)||null;
  const frozenScore=h=>{
    for(const k of ['pre_race_tkp_score','prediction_score_snapshot','tkp_display_score_snapshot','score']){
      const v=finite(h?.[k]);if(v!=null&&v>=0)return v;
    }
    return -1;
  };
  const frozenRank=h=>{
    for(const k of ['prediction_order_snapshot','pre_race_rank_snapshot','tkp_rank_snapshot']){
      const v=finite(h?.[k]);if(v!=null&&v>0)return v;
    }
    return null;
  };
  const frozenConfidence=h=>{
    for(const k of ['single_confidence_snapshot','altili_winner_score','winner_confidence_snapshot']){
      const v=finite(h?.[k]);if(v!=null)return Math.max(0,Math.min(100,v));
    }
    return 0;
  };
  const raceKey=r=>String(r?.race_key||`${r?.race_date||''}|${r?.hippodrome||''}|${r?.altili_no||2}|${r?.leg||0}`);
  const forwardByKey=new Map((src?.forward_tracking_log||[]).map(row=>[String(row?.race_key||`${row?.race_date||''}|${row?.hippodrome||''}|${row?.altili_no||2}|${row?.leg||0}`),row]));
  const ordered=r=>live(r).slice().sort((a,b)=>{
    const ar=frozenRank(a),br=frozenRank(b);
    if(ar!=null||br!=null){if(ar==null)return 1;if(br==null)return -1;if(ar!==br)return ar-br;}
    return frozenScore(b)-frozenScore(a)||frozenConfidence(b)-frozenConfidence(a)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||''));
  });
  const hit=(r,h)=>String(winner(r)?.horse_no||'')===String(h?.horse_no||'');
  const groups=new Map();
  for(const r of races){
    const leg=num(r?.leg);if(leg<1||leg>6)continue;
    const key=String(r?.file_id||r?.meeting_uid||`${r?.race_date||''}|${r?.hippodrome||''}|${r?.altili_no||0}`);
    if(!groups.has(key))groups.set(key,new Map());groups.get(key).set(leg,r);
  }
  const rankStats=Array.from({length:6},(_,i)=>({rank:i+1,candidates:0,hits:0}));
  let meetings=0,normal1Both=0,normal2Both=0,union=0;
  for(const g of groups.values()){
    if(![1,2,3,4,5,6].every(n=>g.has(n)))continue;
    const six=[1,2,3,4,5,6].map(n=>g.get(n));if(!six.every(r=>winner(r)))continue;
    const rows=six.map(r=>{
      const pool=ordered(r),h=pool[0]||null,second=pool[1]||null;if(!h)return null;
      const forward=forwardByKey.get(raceKey(r))||null;
      const leaderMatches=forward&&String(forward?.leader_no||'')===String(h?.horse_no||'');
      const explicitSingleNo=String(forward?.single_no||'').trim();
      const explicitSingle=explicitSingleNo?String(explicitSingleNo)===String(h?.horse_no||''):(leaderMatches&&Number(forward?.single_candidate)===1);
      const hasExplicit=Boolean(forward&&(explicitSingleNo||forward?.single_candidate===0||forward?.single_candidate===1));
      const confidence=leaderMatches&&finite(forward?.single_confidence)!=null?Math.max(0,Math.min(100,num(forward.single_confidence))):frozenConfidence(h);
      const secondConfidence=second?frozenConfidence(second):0;
      const score=frozenScore(h),secondScore=second?frozenScore(second):-1;
      const fallbackSingle=confidence>=68&&h?.x_break_single!==true&&((confidence-secondConfidence)>=4||(score-secondScore)>=0.12);
      return {r,h,visibleTkp:score,confidence,isSingle:hasExplicit?explicitSingle:fallbackSingle};
    }).filter(Boolean).sort((a,b)=>b.visibleTkp-a.visibleTkp||b.confidence-a.confidence||num(a.r?.leg)-num(b.r?.leg));
    if(rows.length!==6)continue;meetings++;
    rows.forEach((z,i)=>{rankStats[i].candidates++;if(hit(z.r,z.h))rankStats[i].hits++;});
    const take=(band,count)=>band.filter(z=>z?.isSingle).slice().sort((a,b)=>b.confidence-a.confidence||b.visibleTkp-a.visibleTkp).slice(0,count);
    const normal1=take(rows.slice(0,3),1);
    let normal2=take(rows.slice(0,4),2);if(normal2.length<2)normal2=take(rows,2);
    const n1h=normal1.length===1&&normal1.every(z=>hit(z.r,z.h));
    const n2h=normal2.length===2&&normal2.every(z=>hit(z.r,z.h));
    if(n1h)normal1Both++;if(n2h)normal2Both++;if(n1h||n2h)union++;
  }
  // PROF karşılaştırması yalnız İleri Takip'te dondurulmuş aday/değer bulunan koşularla yapılır.
  let prof75Candidates=0,prof75Hits=0,prof80Candidates=0,prof80Hits=0;
  for(const r of races){
    if(!winner(r))continue;
    const row=forwardByKey.get(raceKey(r));if(!row)continue;
    const no=String(row?.prof_no||row?.leader_no||'').trim();
    const p=finite(row?.prof_value??row?.leader_prof);if(!no||p==null)continue;
    const h=live(r).find(x=>String(x?.horse_no||'')===no);if(!h)continue;
    if(p>=75){prof75Candidates++;if(hit(r,h))prof75Hits++;}
    if(p>=80){prof80Candidates++;if(hit(r,h))prof80Hits++;}
  }
  return {meetings,rankStats,normal1Both,normal2Both,union,normalBoth:normal1Both,surpriseBoth:normal2Both,prof75Candidates,prof75Hits,prof80Candidates,prof80Hits};
}

function tkpTommyPortfolioTrackingHTML(){
  let a=null;try{a=tkpTommyPortfolioHistoricalAnalysis(db);}catch(_e){return '';}
  if(!a||!a.meetings)return '';
  const pct=(n,d)=>d?('%'+fmtPct(100*n/d)):'-';
  const rr=(a.rankStats||[]).map(x=>`<tr><td class="num">${x.rank}</td><td class="num">${x.candidates}</td><td class="num">${x.hits}</td><td class="num">${Math.max(0,x.candidates-x.hits)}</td><td class="num">${pct(x.hits,x.candidates)}</td></tr>`).join('');
  return `<h4 style="margin:9px 0 4px;">🧭 TOMMY TEK Verim Takibi · Shadow</h4><p class="muted" style="margin:0 0 6px;">${a.meetings} doğrulanmış 6'lı toplantı. Bu bölüm <b>frozen İlk Bakış TEK shadow takibidir</b>; 6/6 kupon başarısı değildir. V55'in gerçek 6/6 performansı üstteki Son 10 / Son 28 / Bu ay / Tüm V55 pencerelerinde ayrı gösterilir. Seçim yalnız kayıtlı yarış-öncesi TKP sırası/skoru, güven ve İleri Takip snapshot'ından yapılır; güncel tahmin motoru geçmiş toplantılar için yeniden çalıştırılmaz ve sonuç aynı yarışın tahminine geri yazılmaz.</p><div class="tableWrap compactBacktest tkpCenteredStats"><table style="width:100%!important;table-layout:fixed!important;min-width:560px"><thead><tr><th>İlk Bakış sırası</th><th>Toplantı</th><th>Geldi</th><th>Gelmedi</th><th>Tutma %</th></tr></thead><tbody>${rr}</tbody></table></div><div class="tableWrap compactBacktest tkpCenteredStats" style="margin-top:6px"><table style="width:100%!important;table-layout:fixed!important;min-width:620px"><thead><tr><th>V54 miras TEK politikası (shadow)</th><th>Tüm TEK'ler tuttu</th><th>Başarı</th></tr></thead><tbody><tr><td style="text-align:left!important"><b>1 TEK · İlk Bakış 1–3</b></td><td class="num">${a.normal1Both}/${a.meetings}</td><td class="num">${pct(a.normal1Both,a.meetings)}</td></tr><tr><td style="text-align:left!important"><b>2 TEK · İlk Bakış 1–4</b></td><td class="num">${a.normal2Both}/${a.meetings}</td><td class="num">${pct(a.normal2Both,a.meetings)}</td></tr><tr><td style="text-align:left!important"><b>İki politikanın birleşimi</b></td><td class="num">${a.union}/${a.meetings}</td><td class="num">${pct(a.union,a.meetings)}</td></tr></tbody></table></div><div class="tableWrap compactBacktest tkpCenteredStats" style="margin-top:6px"><table style="width:100%!important;table-layout:fixed!important;min-width:620px"><thead><tr><th>PROF snapshot shadow</th><th>Aday</th><th>Kazandı</th><th>Başarı</th></tr></thead><tbody><tr><td style="text-align:left!important"><b>En güçlü PROF ≥75</b></td><td class="num">${a.prof75Candidates||0}</td><td class="num">${a.prof75Hits||0}</td><td class="num">${pct(a.prof75Hits||0,a.prof75Candidates||0)}</td></tr><tr><td style="text-align:left!important"><b>En güçlü PROF ≥80</b></td><td class="num">${a.prof80Candidates||0}</td><td class="num">${a.prof80Hits||0}</td><td class="num">${pct(a.prof80Hits||0,a.prof80Candidates||0)}</td></tr></tbody></table></div><p class="muted" style="margin:5px 0 0;">PROF yalnız shadow/challenger olarak izlenir; Tommy TEK'i otomatik değiştirmez. TEK dışı 5/6 kaçışları Back Test yakın-isabet kayıtlarında ayrıca izlenir.</p>`;
}

function tkpSingleAnalysisTableHTML(){
  if(typeof tkpCalibratedSingleHistoricalAnalysis!=='function') return '';
  let a=null;try{a=tkpCalibratedSingleHistoricalAnalysis(db);}catch(_e){return '';}
  if(!a||!Array.isArray(a.table))return '';
  const rate=x=>x==null?'-':('%'+fmtPct(100*Number(x)));
  const rows=a.table.map(x=>`<tr><td style="text-align:left!important"><b>${esc(x.label)}</b></td><td class="num" style="text-align:center!important">${x.candidates}</td><td class="num" style="text-align:center!important">${x.hits}</td><td class="num" style="text-align:center!important">${rate(x.rate)}</td><td style="text-align:left!important">${esc(x.note||'')}</td></tr>`).join('');
  const v=a.veto||{},vetoRows=[
    ['60 kg üstü shadow',v.weight,'Engellemez; kaç aday ve kaçı kazanmış izlenir'],
    ['Rakip PROF veto',v.rival,'Rakip PROF ≥60 ve profil farkı <10'],
    ['Bağımsız onay veto',v.evidence,'AGF/PROF/TR onayı 2/3 altında'],
    ['P1/P2 fark veto',v.margin,'Risk bandına göre gereken fark sağlanmadı']
  ].map(([label,z,note])=>`<tr><td style="text-align:left!important"><b>${esc(label)}</b></td><td class="num" style="text-align:center!important">${Number(z?.count||0)}</td><td class="num" style="text-align:center!important">${Number(z?.wouldHit||0)}</td><td style="text-align:left!important">${esc(note)}</td></tr>`).join('');
  return `<h3 style="margin:12px 0 5px;">🎯 TEK Analiz Tablosu · Kayıtlı Yarışlar</h3><p class="muted" style="margin:0 0 6px;">${a.resolved} sonuçlu koşu salt-okunur incelendi. Sonuç yalnız isabet ölçümünde kullanılır; geçmiş yarış güncel modelle yeniden puanlanmaz.</p><div class="tableWrap compactBacktest tkpCenteredStats tkpSingleAnalysisStats"><table style="width:100%!important;table-layout:fixed!important;min-width:760px"><colgroup><col style="width:24%"><col style="width:12%"><col style="width:12%"><col style="width:14%"><col style="width:38%"></colgroup><thead><tr><th style="text-align:left!important">TEK grubu</th><th>Aday</th><th>Kazandı</th><th>Başarı</th><th style="text-align:left!important">Kural / Not</th></tr></thead><tbody>${rows}</tbody></table></div><h4 style="margin:9px 0 4px;">Veto / shadow etkisi</h4><div class="tableWrap compactBacktest tkpCenteredStats tkpSingleVetoStats"><table style="width:100%!important;table-layout:fixed!important;min-width:680px"><colgroup><col style="width:28%"><col style="width:16%"><col style="width:18%"><col style="width:38%"></colgroup><thead><tr><th style="text-align:left!important">Veto</th><th>Engelledi</th><th>Engellenen kazanan</th><th style="text-align:left!important">Açıklama</th></tr></thead><tbody>${vetoRows}</tbody></table></div>${typeof tkpTommyPortfolioTrackingHTML==='function'?tkpTommyPortfolioTrackingHTML():''}`;
}

function tkpExperimentalTrackerHTML(){
  const bh=typeof tkpBombHunterStats==='function'?tkpBombHunterStats():{races:0,anyWin:0,anyTop3:0,anyTop5:0,firstWin:0,secondWin:0,odbSample:0,odbWin:0};
  const pct=(n,d)=>d?('%'+fmtPct(100*n/d)):'İleri test bekleniyor';
  const lab=typeof tkpStrategyLabStats==='function'?tkpStrategyLabStats(tkpForwardTrackingEnsureLog()):{done:0,p1:0,top3:0,top5:0,solidSingles:0,solidSingleHits:0,solidSingleAltSaves:0,tags:{}};
  const hist=tkpStrategyHistoricalEnsure()||{archive_files:0,archive_meetings:0,eligible_meetings:0,races:0,p1:0,top3:0,top5:0,coupons:{}};
  const solidSingleTest=Number(lab.solidSingles||0)>0
    ? `${lab.solidSingles} tek · tuttu ${pct(lab.solidSingleHits,lab.solidSingles)} · Alt-1 kurtarırdı ${pct(lab.solidSingleAltSaves,lab.solidSingles)}`
    : '0 tek · İleri test bekleniyor';
  const tagRows=Object.entries(lab.tags||{}).sort((a,b)=>(b[1].starts||0)-(a[1].starts||0)).slice(0,8)
    .map(([tag,z])=>`<tr><td style="text-align:left!important">${esc(tag)}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${z.starts}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(z.wins,z.starts)}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(z.top3,z.starts)}</td><td class="num" style="text-align:center!important;vertical-align:middle!important">${pct(z.top5,z.starts)}</td></tr>`).join('');
  return `<div class="card tkpExperimentTracker" style="border-left:5px solid #475569;margin-bottom:10px;"><h2 style="margin:0 0 5px;">🧪 Deneysel Takip Merkezi · V1.1.229</h2><p class="muted" style="margin:0 0 8px;">Champion: P1 kilitli + Validated %30 kapsam; en güçlü BH yalnız P5 kurtarma, ODB yalnız zor/karışık ayakta P6 kurtarma olarak aktiftir. X/Twitter yalnız puan ve analiz olarak kaydedilir; tahmin/TEK/P1-P5/kupona müdahale etmez. Strateji Laboratuvarı yalnız yarıştan önce snapshot alır; resmi sonuç geldikten sonra değerlendirir. Dünya literatüründeki temporal validation, leakage guard, race-risk ayrımı, kalibrasyon ve ranking ilkeleri shadow testtedir.</p><div class="tableWrap compactBacktest tkpExperimentSummary"><table style="width:100%!important;table-layout:fixed!important;min-width:980px;"><colgroup><col style="width:22%"><col style="width:31%"><col style="width:27%"><col style="width:20%"></colgroup><thead><tr><th>Sistem</th><th>Görev</th><th>İleri test</th><th>Durum</th></tr></thead><tbody><tr><td><b>🧠 Strategy Lab</b></td><td>Race Risk + Sağlam TEK + P1–P5 + Hunter + Coverage optimizer</td><td>İleri ${lab.done} · P1 ${pct(lab.p1,lab.done)} · Top3 ${pct(lab.top3,lab.done)} · Top5 ${pct(lab.top5,lab.done)}<br>Geçmiş kilitli ${hist.races} koşu / ${hist.eligible_meetings} toplantı · P1 ${pct(hist.p1,hist.races)} · Top3 ${pct(hist.top3,hist.races)} · Top5 ${pct(hist.top5,hist.races)}</td><td>Shadow · Champion'a müdahale yok</td></tr><tr><td><b>🎯 Sağlam TEK laboratuvarı</b></td><td>Tek güveni + P1/P2 farkı + yarış riski + rakip çelişkisi</td><td>${solidSingleTest}</td><td>Takip modülü</td></tr><tr><td><b>💣 Bomba Avcısı</b></td><td>2 Bomba + 1 ayrı ODB · kazanmaya yakınlık sırası</td><td>${bh.races} koşu · Bomba 1 ${pct(bh.firstWin,bh.races)} · Bomba 2 ${pct(bh.secondWin,bh.races)} · ODB ${pct(bh.odbWin,bh.odbSample)} · İlk5 ${pct(bh.anyTop5,bh.races)}</td><td>BH1 P5 + ODB P6 kapsam · snapshot ölçüm</td></tr><tr><td>⚠️ Favori Çöküş</td><td>Favori ile form/sinyal ayrışmasını Race Risk içinde izler</td><td>${lab.done} sonuç</td><td>Shadow · kupona müdahale yok</td></tr><tr><td>💎 Value Hunter</td><td>AGF/piyasa ayrışması ve düşük oynanmış güçlü adayları izler</td><td>Hunter tablosuna dahil</td><td>Shadow · kupona müdahale yok</td></tr><tr><td>🧭 Consensus / Ayrışma</td><td>Champion, AGF, TR, BMB/ODB ve desteklerin fikir birliğini Race Risk'e taşır</td><td>${lab.done} sonuç</td><td>Shadow · kupona müdahale yok</td></tr><tr><td>💎 Coverage / Value</td><td>En küçük maliyetle en yüksek birleşik kapsama challenger'ı</td><td>Forward izleme</td><td>Shadow · sabit bütçeyi değiştirmez</td></tr></tbody></table></div>${tkpSingleAnalysisTableHTML()}${tagRows?`<h3 style="margin:10px 0 5px;">Hunter sinyal ileri sonuçları</h3><div class="tableWrap compactBacktest tkpCenteredStats tkpHunterStats"><table style="width:100%!important;table-layout:fixed!important"><colgroup><col style="width:44%"><col style="width:14%"><col style="width:14%"><col style="width:14%"><col style="width:14%"></colgroup><thead><tr><th style="text-align:left!important">Sinyal</th><th class="num" style="text-align:center!important;vertical-align:middle!important">At</th><th class="num" style="text-align:center!important;vertical-align:middle!important">Kazandı</th><th class="num" style="text-align:center!important;vertical-align:middle!important">İlk3</th><th class="num" style="text-align:center!important;vertical-align:middle!important">İlk5</th></tr></thead><tbody>${tagRows}</tbody></table></div>`:''}<p class="muted" style="margin:7px 0 0;font-size:10.5px;">Kural: sonuçlandıktan sonra yeni forward shadow snapshot üretilemez. Geçmiş Laboratuvar yalnız PRE-RACE-FROZEN prediction_log ve kaydedilmiş gerçek kupon snapshotlarını okur; güncel skorla geçmişe tahmin üretmez. Arşivde ${hist.archive_files} dosya (${hist.archive_meetings} toplantı) görüldü; güvenli eski kayıt bulunmayan koşular zorla doldurulmaz. Challenger yalnız ileri testte kalibrasyon + kapsama + ROI/risk açısından üstünse Champion adayı olabilir.</p></div>`;
}

function tkpHighAgfLossRiskSignals(r,fav,winner){
  const out=[];const agf=Number(fav?.agf_pct??fav?.agf)||0;const runners=(r?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h))).sort((a,b)=>(Number(b?.agf)||0)-(Number(a?.agf)||0));
  const second=Number(runners[1]?.agf)||0;if(second>0)out.push(`AGF farkı +${Math.max(0,Math.round(agf-second))}`);
  const kg=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(fav):Number(fav?.kg??fav?.weight);if(Number.isFinite(Number(kg)))out.push(`KG ${String(kg).replace('.',',')}`);
  const st=Number(fav?.start_no??fav?.st??fav?.start);if(Number.isFinite(st)&&st>0)out.push(`ST ${st}`);
  try{if(typeof profileStrengthPct==='function')out.push(`PROF %${Math.round(Number(profileStrengthPct(r,fav))||0)}`);}catch(_e){}
  // Tarihsel takip kartında canlı ortak kanıt motorunu yeniden çalıştırma. Kayıtlı
  // yarış-öncesi/frozen TKP değeri hem doğru kanıtı gösterir hem 509 yarışta aynı
  // puan zincirinin binlerce kez tekrar hesaplanmasını engeller.
  const tkp=[fav?.prediction_score_snapshot,fav?.pre_race_tkp_score,fav?.tkp_display_score,fav?.score].map(Number).find(Number.isFinite);if(Number.isFinite(Number(tkp)))out.push(`TKP ${Number(tkp).toFixed(2).replace('.',',')}`);
  const yp=Number(fav?.ypuan);if(Number.isFinite(yp))out.push(`Y.PUAN ${Math.round(yp)}`);
  if(winner?.bmb===1)out.push('Kazanan BMB');if(winner?.odb===1)out.push('Kazanan ODB');
  const threats=(r?.horses||[]).filter(h=>String(h?.horse_no)!==String(fav?.horse_no)&&(Number(h?.bmb)===1||Number(h?.odb)===1)).length;if(threats)out.push(`${threats} BMB/ODB rakip`);
  return out;
}
function tkpHighAgfLossTrackingHTML(){
  const rows=[];for(const r of (db?.races||[])){
    const horses=(r?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));if(!horses.length||!horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1))continue;
    const fav=horses.slice().sort((a,b)=>(Number(b?.agf_pct??b?.agf)||0)-(Number(a?.agf_pct??a?.agf)||0))[0],agf=Number(fav?.agf_pct??fav?.agf)||0;if(agf<50)continue;
    const place=Number(fav?.finish_position)||(Number(fav?.winner)===1?1:0);if(place===1)continue;
    const winner=horses.find(h=>Number(h?.winner)===1)||horses.find(h=>Number(h?.finish_position)===1)||null;
    const tier=agf>=70?'KIRMIZI':agf>=60?'TURUNCU':'SARI';const action=agf>=70?'Benzer profilde TEK kilidi':agf>=60?'Benzer profilde NET TEK yok':'Benzer profilde TEK güveni düşür';
    rows.push({date:String(r?.race_date||''),hip:r?.hippodrome||'',leg:Number(r?.leg)||0,fav,agf,place,winner,tier,action,signals:tkpHighAgfLossRiskSignals(r,fav,winner),race:r});
  }
  rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||TKP_TR_COLLATOR.compare(String(b.hip),String(a.hip))||a.leg-b.leg);
  const body=rows.slice(0,120).map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.hip)}</td><td class="centerCell">${x.leg}</td><td class="textCol"><b>${esc(x.fav?.horse_no)} ${esc(x.fav?.horse_name)}</b></td><td class="centerCell"><b>%${fmtPct(x.agf)}</b></td><td class="centerCell">${x.place?x.place+'.':'İlk5 dışı'}</td><td class="textCol">${x.winner?esc(x.winner.horse_no)+' '+esc(x.winner.horse_name):'-'}</td><td class="textCol"><span class="badge">${x.tier}</span> ${esc(x.action)}</td><td class="textCol">${esc(x.signals.join(' · ')||'-')}</td></tr>`).join('');
  return `<div class="card tkpHighAgfLossTracker" style="border-left:5px solid #f59e0b;margin:10px 0;"><h2 style="margin:0 0 5px;">⚠️ Yüksek AGF Favori Kaybı Takibi · ≥%50</h2><p class="muted" style="margin:0 0 8px;">%50+ AGF favorinin kazanamadığı geçmiş koşular. Gösterilen maddeler <b>risk/sinyal</b> özetidir; kaybın kesin nedeni olduğu iddia edilmez. Benzer yarışta %50–59 güveni düşürür, %60–69 NET TEK'i engeller, %70+ TEK kilidi uygular; TKP sırası değişmez.</p><div class="tableWrap tkpAgfLossTableWrap"><table class="tkpAgfLossTable"><thead><tr><th>Tarih</th><th>Pist</th><th>Ayak</th><th class="textCol">Favori</th><th>AGF</th><th>Sonuç</th><th class="textCol">Kazanan</th><th class="textCol">Benzer yarış kararı</th><th class="textCol">Risk / sinyaller</th></tr></thead><tbody>${body||'<tr><td colspan="9" class="empty">Kayıtlı sonuçlarda %50+ AGF favori kaybı yok.</td></tr>'}</tbody></table></div></div>`;
}
async function tkpHighAgfLossTrackingHTMLAsync(){
  const rows=[],races=Array.isArray(db?.races)?db.races:[];
  const consume=(start,end)=>{
    for(let index=start;index<end;index++){
      const r=races[index];
      const horses=(r?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));if(!horses.length||!horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1))continue;
      const fav=horses.slice().sort((a,b)=>(Number(b?.agf_pct??b?.agf)||0)-(Number(a?.agf_pct??a?.agf)||0))[0],agf=Number(fav?.agf_pct??fav?.agf)||0;if(agf<50)continue;
      const place=Number(fav?.finish_position)||(Number(fav?.winner)===1?1:0);if(place===1)continue;
      const winner=horses.find(h=>Number(h?.winner)===1)||horses.find(h=>Number(h?.finish_position)===1)||null;
      const tier=agf>=70?'KIRMIZI':agf>=60?'TURUNCU':'SARI',action=agf>=70?'Benzer profilde TEK kilidi':agf>=60?'Benzer profilde NET TEK yok':'Benzer profilde TEK güveni düşür';
      rows.push({date:String(r?.race_date||''),hip:r?.hippodrome||'',leg:Number(r?.leg)||0,fav,agf,place,winner,tier,action,signals:null,race:r});
    }
  };
  if(typeof tkpRunAdaptiveRange==='function')await tkpRunAdaptiveRange('tracking-agf-loss',races.length,consume,{stride:4,budgetMs:10});
  else for(let start=0;start<races.length;start+=4){consume(start,Math.min(races.length,start+4));if(typeof tkpYieldToUi==='function')await tkpYieldToUi();else await new Promise(resolve=>setTimeout(resolve,0));}
  rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||TKP_TR_COLLATOR.compare(String(b.hip),String(a.hip))||a.leg-b.leg);
  const visible=rows.slice(0,120);
  if(typeof tkpRunAdaptiveRange==='function')await tkpRunAdaptiveRange('tracking-agf-loss-signals',visible.length,(start,end)=>{for(let i=start;i<end;i++)visible[i].signals=tkpHighAgfLossRiskSignals(visible[i].race,visible[i].fav,visible[i].winner);},{stride:4,budgetMs:10});
  else for(const x of visible)x.signals=tkpHighAgfLossRiskSignals(x.race,x.fav,x.winner);
  const body=visible.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.hip)}</td><td class="centerCell">${x.leg}</td><td class="textCol"><b>${esc(x.fav?.horse_no)} ${esc(x.fav?.horse_name)}</b></td><td class="centerCell"><b>%${fmtPct(x.agf)}</b></td><td class="centerCell">${x.place?x.place+'.':'İlk5 dışı'}</td><td class="textCol">${x.winner?esc(x.winner.horse_no)+' '+esc(x.winner.horse_name):'-'}</td><td class="textCol"><span class="badge">${x.tier}</span> ${esc(x.action)}</td><td class="textCol">${esc((x.signals||[]).join(' · ')||'-')}</td></tr>`).join('');
  return `<div class="card tkpHighAgfLossTracker" style="border-left:5px solid #f59e0b;margin:10px 0;"><h2 style="margin:0 0 5px;">⚠️ Yüksek AGF Favori Kaybı Takibi · ≥%50</h2><p class="muted" style="margin:0 0 8px;">%50+ AGF favorinin kazanamadığı geçmiş koşular. Gösterilen maddeler <b>risk/sinyal</b> özetidir; kaybın kesin nedeni olduğu iddia edilmez. Benzer yarışta %50–59 güveni düşürür, %60–69 NET TEK'i engeller, %70+ TEK kilidi uygular; TKP sırası değişmez.</p><div class="tableWrap tkpAgfLossTableWrap"><table class="tkpAgfLossTable"><thead><tr><th>Tarih</th><th>Pist</th><th>Ayak</th><th class="textCol">Favori</th><th>AGF</th><th>Sonuç</th><th class="textCol">Kazanan</th><th class="textCol">Benzer yarış kararı</th><th class="textCol">Risk / sinyaller</th></tr></thead><tbody>${body||'<tr><td colspan="9" class="empty">Kayıtlı sonuçlarda %50+ AGF favori kaybı yok.</td></tr>'}</tbody></table></div></div>`;
}

let _tkpLearningHeavyCache={signature:'',html:'',sections:{}};
let _tkpLearningCacheBusy=false;
let _tkpLearningCacheScheduled=false;
let _tkpLearningCacheWaiters=[];
// V1.1.250: Ağır İleri Takip/öğrenme çıktısı aynı tarayıcıda kalıcıdır,
// ancak büyük HTML artık localStorage/sessionStorage üzerinde SENKRON okunup yazılmaz.
// 1.1.250'daki senkron JSON.parse/stringify + setItem ana thread'i saniyelerce
// tutabiliyor ve Chrome/Edge'de "Sayfa Yanıt Vermiyor" penceresine yol açabiliyordu.
// Kalıcı snapshot ayrı IndexedDB store'unda asenkron tutulur; RAM cache her zaman
// ilk tercih olduğu için sekme geçişinde yeniden hesaplama yapılmaz.
// Render sözleşmesi değiştiğinde eski (arşiv kartları boş) HTML snapshotını yeni
// pakette tekrar gösterme. V4, uzun kartları Takip ve Operasyon merkezlerine 5+5
// dağıtır; kartların kendi tablo HTML'ini değiştirmez.
const TKP_LEARNING_RENDER_VERSION='V5_R15_5_ALL_HISTORICAL_TABLES_2026_09_01';
const TKP_LEARNING_DURABLE_CACHE_KEY='tkp_learning_heavy_cache_v4';
const TKP_LEARNING_LEGACY_CACHE_KEY='tkp_learning_heavy_cache_v1';
let _tkpLearningDurableHydrated=false;
let _tkpLearningDurableHydrating=false;
let _tkpLearningHydrateWaiters=[];
let _tkpLearningAutoStartSignature='';
let _tkpLearningAutoStartScheduled=false;
// V1.1.251: tkpOpenUiCacheDb/tkpUiCacheGet/tkpUiCacheSet artık core-utils.js
// içinde tek kopya olarak tanımlıdır (core-utils bütün modüllerden önce yüklenir).
// Burada tekrar tanımlanmaz; Ayrıntılı Analiz ve Back Test cache'leri de aynı
// paylaşılan store'u kullanır (bkz. core-utils.js V1.1.251 notu).
function tkpDropLegacyLearningLocalStorageSoon(){
  // Eski 1.1.250 büyük snapshot artık asla okunmaz. Kullanıcı etkileşiminin
  // dışında yalnız anahtarı sileriz; HTML'yi JSON.parse etmeyiz.
  const run=()=>{try{localStorage.removeItem(TKP_LEARNING_LEGACY_CACHE_KEY);}catch(_e){} try{sessionStorage.removeItem(TKP_LEARNING_LEGACY_CACHE_KEY);}catch(_e){}};
  if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:2500});else setTimeout(run,1200);
}
async function tkpHydrateDurableLearningCache(expectedSignature='',onReady=null){
  const expected=String(expectedSignature||tkpLearningCacheSignature());
  if(_tkpLearningHeavyCache.signature===expected&&_tkpLearningHeavyCache.html){_tkpLearningDurableHydrated=true;if(typeof onReady==='function')onReady(true);return true;}
  if(typeof onReady==='function')_tkpLearningHydrateWaiters.push(onReady);
  if(_tkpLearningDurableHydrating)return false;
  _tkpLearningDurableHydrating=true;
  let ok=false;
  try{
    const parsed=await tkpUiCacheGet(TKP_LEARNING_DURABLE_CACHE_KEY);
    ok=!!(parsed&&parsed.version===4&&String(parsed.signature||'')===expected&&typeof parsed.html==='string'&&parsed.html.length>50&&parsed.sections&&typeof parsed.sections==='object');
    if(ok)_tkpLearningHeavyCache={signature:expected,html:parsed.html,sections:parsed.sections};
    _tkpLearningDurableHydrated=true;
    return ok;
  }catch(_e){ok=false;return false;}
  finally{
    _tkpLearningDurableHydrating=false;
    const waiters=_tkpLearningHydrateWaiters.splice(0);
    for(const cb of waiters){try{cb(ok);}catch(_e){}}
  }
}
function tkpPersistDurableLearningCache(){
  if(!_tkpLearningHeavyCache.html||!_tkpLearningHeavyCache.signature)return false;
  const payload={version:4,signature:_tkpLearningHeavyCache.signature,html:_tkpLearningHeavyCache.html,sections:_tkpLearningHeavyCache.sections||{},savedAt:Date.now()};
  // Fire-and-forget: IndexedDB structured clone ana thread'i localStorage kadar
  // bloklamaz ve yazım sonucu kullanıcı akışını bekletmez.
  Promise.resolve().then(()=>tkpUiCacheSet(TKP_LEARNING_DURABLE_CACHE_KEY,payload)).catch(()=>{});
  return true;
}
function tkpLearningCacheSignature(){
  try{
    const tail=(rows,fields)=>{const list=Array.isArray(rows)?rows:[],last=list.length?list[list.length-1]:null;return [list.length,...fields.map(key=>String(last?.[key]??''))].join(':');};
    const lastRace=(db?.races||[]).length?db.races[db.races.length-1]:null;
    const lastForward=(db?.forward_tracking_log||[]).length?db.forward_tracking_log[db.forward_tracking_log.length-1]:null;
    const lastWeekly=(db?.weekly_model_log||[]).length?db.weekly_model_log[db.weekly_model_log.length-1]:null;
    const lastCohort=(db?.surprise_cohort_tracking_log||[]).length?db.surprise_cohort_tracking_log[db.surprise_cohort_tracking_log.length-1]:null;
    // R16.36: Önceki tkpAuxiliaryAnalysisSignature() her menü açılışında tüm yardımcı
    // log satırlarını JSON.stringify ile tarıyordu. Uzun tablo cache anahtarı artık
    // yalnız bu kartların gerçekten kullandığı koleksiyonların O(1) kuyruk damgaları
    // + kalıcı sonuç/dataset revizyonuna bağlıdır.
    return [
      TKP_LEARNING_RENDER_VERSION,'R16.36',String(db?.learning_state?.dataset_signature||''),String(db?.learning_state?.outcome_signature||''),
      (db?.races||[]).length,
      // Canlı prediction/kupon satırı eklenmesi tarihsel Öğrenme merkezinin 10 ağır
      // kartını geçersiz kılmaz. Sonuç gerçekten işlendiğinde outcome_signature ve
      // ilgili forward/diagnostic log damgaları zaten değişir.
      (db?.forward_tracking_log||[]).length,(db?.weekly_model_log||[]).length,(db?.v55_diagnostic_log||[]).length,(db?.surprise_cohort_tracking_log||[]).length,
      String(lastRace?.updated_at||lastRace?.race_date||''),String(lastForward?.evaluated_at||lastForward?.created_at||''),
      String(lastWeekly?.evaluation?.evaluated_at||lastWeekly?.created_at||''),String(lastCohort?.resolved_at||lastCohort?.captured_at||''),
      tail(db?.sidebet_ticket_log,['resolved_at','created_at']),tail(db?.bomb_hunter_shadow_log,['resolved_at','captured_at']),
      tail(db?.bets,['date','cost','payout']),Number(db?.settings?.backtest_snapshot_revision)||0
    ].join('|');
  }catch(_){return 'LEARNING_SIGNATURE_ERROR';}
}
if(typeof window!=='undefined')window.tkpLearningCacheSignature=tkpLearningCacheSignature;
function tkpLearningHeavyBuilders(asyncMode=false,onProgress=null){
  return [
    ['v55',()=>asyncMode&&typeof tkpV55DiagnosticsCenterHTMLAsync==='function'
      ?tkpV55DiagnosticsCenterHTMLAsync((done,total,job)=>{if(typeof onProgress==='function')try{onProgress(done,total,job);}catch(_e){}})
      :(typeof tkpV55DiagnosticsCenterHTML==='function'?tkpV55DiagnosticsCenterHTML():'')],
    ['forward',()=>asyncMode
      ?Promise.resolve(typeof tkpPrepareForwardTrackingViewAsync==='function'?tkpPrepareForwardTrackingViewAsync():null).then(()=>tkpForwardTrackingTableHTML())
      :tkpForwardTrackingTableHTML()],
    ['weekly',()=>typeof tkpWeeklyModelTrackerHTML==='function'?tkpWeeklyModelTrackerHTML():''],
    ['experimental',()=>tkpExperimentalTrackerHTML()],
    ['surprise',()=>asyncMode?tkpHistoricalSurpriseProfileHTMLAsync():tkpHistoricalSurpriseProfileHTML()],
    ['cohort',()=>{try{return typeof tkpSurpriseCohortTrackingHTML==='function'?tkpSurpriseCohortTrackingHTML():'';}catch(_e){return '';}}],
    ['agf-loss',()=>{try{return asyncMode&&typeof tkpHighAgfLossTrackingHTMLAsync==='function'?tkpHighAgfLossTrackingHTMLAsync():(typeof tkpHighAgfLossTrackingHTML==='function'?tkpHighAgfLossTrackingHTML():'');}catch(_e){return '';}}],
    ['research',()=>{try{return typeof tkpResearchLabHTML==='function'?tkpResearchLabHTML():'';}catch(_e){return '';}}],
    ['reasons',()=>tkpForwardTrackingReasonsHTML()],
    ['sidebet',()=>typeof tkpV55SideBetTrackingTextHTML==='function'?tkpV55SideBetTrackingTextHTML():'']
  ];
}
const TKP_LONG_CENTER_KEYS={
  learning:['forward','weekly','cohort','reasons','sidebet'],
  import:['v55','experimental','surprise','agf-loss','research']
};
function tkpLongCenterKeys(center){return TKP_LONG_CENTER_KEYS[center]||TKP_LONG_CENTER_KEYS.learning;}
function tkpLongCenterCachedHtml(center){
  const sections=_tkpLearningHeavyCache.sections||{};
  return tkpLongCenterKeys(center).map(key=>String(sections[key]||'')).join('');
}
function tkpLongCenterSlots(center){
  return tkpLongCenterKeys(center).map(key=>`<div data-learning-slot="${key}" class="tkpLearningChunkSlot"><div class="empty">Hazırlanıyor…</div></div>`).join('');
}
function tkpBuildLearningHeavyHtml(){
  // Senkron API yalnız regresyon/geriye uyum için korunur. Kullanıcı paneli bu yolu
  // doğrudan çağırmaz; tkpBuildLearningHeavyHtmlAsync() kullanır.
  return tkpLearningHeavyBuilders(false).map(([,fn])=>{try{return fn()||'';}catch(_e){return '';}}).join('');
}
async function tkpBuildLearningHeavyHtmlAsync(onSection=null){
  // En pahalı 10M forward taramasını önce 4/8/16 cooperative cache'e hazırla.
  if(typeof tkpPrepareForwardTrackingViewAsync==='function'){
    await tkpPrepareForwardTrackingViewAsync((done,total,job)=>{
      if(typeof onSection==='function')try{onSection('progress','',done,total,job);}catch(_e){}
    });
  }
  // Strategy Lab'ın ayrı kalıcı cache'i, deneysel kart hesaplanmadan önce okunur.
  // Hit durumunda eski yarışlar bir daha taranmaz; miss ise yalnız bu açık uzun işte kurulur.
  await tkpHydrateStrategyHistoricalCache();
  const builders=tkpLearningHeavyBuilders(true,(done,total,job)=>{
    if(typeof onSection==='function')try{onSection('progress','',done,total,job);}catch(_e){}
  }),parts=[],sections={};
  for(let i=0;i<builders.length;i++){
    const [key,fn]=builders[i];
    // Her ağır kart ayrı DOM/iş dilimi. Bir kart başka kartı aynı long-task'e eklemez.
    await new Promise(resolve=>{
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>setTimeout(resolve,0));
      else setTimeout(resolve,0);
    });
    let html='';try{html=(await Promise.resolve(fn()))||'';}catch(e){console.warn('İleri Takip alt paneli:',key,e);}
    parts.push(html);sections[key]=html;
    if(typeof onSection==='function')try{onSection(key,html,i+1,builders.length,null);}catch(_e){}
  }
  return {html:parts.join(''),sections};
}
async function tkpRefreshLearningCache(force=false,onSection=null){
  if(_tkpLearningCacheBusy)return false;
  const sig=tkpLearningCacheSignature();
  if(!force&&_tkpLearningHeavyCache.signature===sig&&_tkpLearningHeavyCache.html)return true;
  _tkpLearningCacheBusy=true;
  try{
    // V1.1.307: panel açılışında arşivin tamamına senkron backfill YASAK. Backfill
    // veri toplama/bakım hattında yapılır; görüntüleme salt-okunur kalır.
    const built=await tkpBuildLearningHeavyHtmlAsync(onSection);
    const html=typeof built==='string'?built:String(built?.html||'');
    const sections=built&&typeof built==='object'&&built.sections?built.sections:{};
    _tkpLearningHeavyCache={signature:tkpLearningCacheSignature(),html,sections};
    tkpPersistDurableLearningCache();
    return true;
  }finally{_tkpLearningCacheBusy=false;}
}
function tkpScheduleLearningCacheRefresh(onDone=null,{userInitiated=false,force=false}={}){
  if(typeof onDone==='function')_tkpLearningCacheWaiters.push(onDone);
  if(_tkpLearningCacheScheduled||_tkpLearningCacheBusy)return false;
  _tkpLearningCacheScheduled=true;
  const run=async()=>{
    _tkpLearningCacheScheduled=false;
    let succeeded=false;
    try{succeeded=await tkpRefreshLearningCache(force,(key,html,done,total)=>{
      if(!html||key==='progress')return;
      const slot=document.querySelector(`[data-learning-slot=\"${key}\"]`);
      if(slot)slot.innerHTML=html;
    });}catch(error){console.warn('İleri Takip cache hazırlığı:',error);succeeded=false;}
    if(!succeeded){
      _tkpLearningAutoStartSignature='';
      for(const root of document.querySelectorAll('.tkpLearningProgressiveRoot')){
        if(!root.querySelector('.tkpLearningRetry'))root.insertAdjacentHTML('afterbegin','<div class="card tkpLearningRetry" style="padding:8px 10px;margin:7px 0;border-left:5px solid #dc2626"><b>Uzun tablolar tamamlanamadı; otomatik yeniden denenecek.</b></div>');
      }
      setTimeout(()=>{try{tkpAutoStartLearningTables(tkpLearningCacheSignature());}catch(_e){}},1200);
    }
    const waiters=_tkpLearningCacheWaiters.splice(0);
    for(const cb of waiters){try{cb(succeeded);}catch(_e){}}
  };
  if(userInitiated){
    // Butonun "hazırlanıyor" durumu önce boyansın; sonra tek hesap çalışsın.
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(run));
    else setTimeout(run,16);
  }else if(typeof tkpRunWhenUserIdle==='function')tkpRunWhenUserIdle(run,{minIdleMs:2500,retryMs:250,maxWaitMs:0});
  else setTimeout(run,500);
  return true;
}
function tkpPrepareLearningTables(){
  if(_tkpLearningCacheBusy||_tkpLearningCacheScheduled)return false;
  const roots=[['learning',$('#learningTable')],['import',$('#operationsLongTables')]];
  for(const [center,el] of roots){
    const note=el?.querySelector?.('.tkpLearningManualGate');
    if(note){
      note.outerHTML=`<div class="tkpLearningProgressiveRoot"><div class="card" style="padding:8px 10px;margin:7px 0;border-left:5px solid #7c3aed"><b>⏳ ${center==='import'?'Operasyon':'Takip'} tabloları hazırlanıyor</b><div class="muted" style="margin-top:4px">Bu merkezdeki 5 uzun kart ayrı iş dilimlerinde hazırlanır; ekran kilitlenmez.</div></div>${tkpLongCenterSlots(center)}</div>`;
    }
  }
  const sig=tkpLearningCacheSignature();
  // RAM snapshot varsa anında aç. Disk snapshot yalnız ASENKRON okunur; bulunursa
  // ekrana verilir, yoksa ağır hesap bir kez kuyruğa alınır.
  if(_tkpLearningHeavyCache.signature===sig&&_tkpLearningHeavyCache.html){renderLearning();renderOperations();return true;}
  tkpHydrateDurableLearningCache(sig,(hit)=>{
    if(hit){renderLearning();renderOperations();return;}
    tkpScheduleLearningCacheRefresh(()=>{
      const active=document.querySelector('.tab.active');
      if(active&&active.dataset.pane==='learning')renderLearning();
      else if(active&&active.dataset.pane==='import')renderOperations();
    },{userInitiated:true,force:false});
  });
  return true;
}
function tkpLearningProgressiveShellHTML(center='learning'){
  const operation=center==='import';
  return `<div class="card tkpLearningManualGate" style="padding:8px 10px;margin:7px 0;border-left:5px solid #7c3aed"><b>🧰 ${operation?'Operasyon':'Takip'} tabloları ayrı hazırlanıyor</b><div class="muted" style="margin:4px 0 0">Menü ilk görünümü bekletmez. Bu merkezdeki 5 uzun tablo otomatik ve dengeli iş dilimlerinde doldurulur; kullanıcı işlemi gerekmez.</div></div>`;
}
function tkpAutoStartLearningTables(signature){
  const sig=String(signature||tkpLearningCacheSignature());
  if(_tkpLearningHeavyCache.signature===sig&&_tkpLearningHeavyCache.html)return false;
  if(_tkpLearningAutoStartScheduled||_tkpLearningCacheBusy||_tkpLearningCacheScheduled)return false;
  if(_tkpLearningAutoStartSignature===sig&&_tkpLearningDurableHydrated)return false;
  _tkpLearningAutoStartSignature=sig;
  _tkpLearningAutoStartScheduled=true;
  const run=()=>{
    _tkpLearningAutoStartScheduled=false;
    const active=document.querySelector('.tab.active');
    if(!active||!['learning','import'].includes(active.dataset.pane))return;
    tkpPrepareLearningTables();
  };
  // Ayak tablolarıyla aynı ilke: önce hafif ekran iki frame içinde boyanır, sonra
  // kalıcı cache okunur ve yalnız eksik ağır kartlar cooperative kuyruğa alınır.
  if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(run,0)));
  else setTimeout(run,0);
  return true;
}
if(typeof window!=='undefined'){
  window.tkpRefreshLearningCache=tkpRefreshLearningCache;
  window.tkpPrepareLearningTables=tkpPrepareLearningTables;
  // Veri değişince RAM snapshot yalnız imza gerçekten değiştiyse bırakılır. Kalıcı
  // tarayıcı snapshot'ı silinmez; imzası uymuyorsa zaten kullanılmaz ve sonraki
  // gerçek hesapta üzerine yazılır. Böylece sıradan saveDB() çağrıları hesaplanan
  // İleri Takip ekranını gereksiz yere kaybettirmez.
  window.addEventListener('tkp:db-changed',(ev)=>{
    const detail=ev?.detail||{};
    const cols=Array.isArray(detail.collections)?detail.collections:[];
    const forwardChanged=detail.rollback||detail.learningChanged||detail.resultsChanged||detail.outcomeChanged||detail.backtestChanged||detail.couponSnapshotChanged||cols.includes('forward_tracking_log');
    const learningChanged=forwardChanged||cols.some(name=>['weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','surprise_cohort_tracking_log','bomb_hunter_shadow_log','bets','races','files'].includes(name));
    // R16.36: prediction/tanı/ayar gibi sıradan saveDB() çağrıları artık İleri
    // Takip RAM görünümünü veya ağır Öğrenme HTML cache'ini boşaltmaz.
    if(forwardChanged)_tkpForwardViewCache={signature:'',value:null};
    if(!learningChanged)return;
    const current=tkpLearningCacheSignature();
    if(_tkpLearningHeavyCache.signature&&_tkpLearningHeavyCache.signature!==current)_tkpLearningHeavyCache={signature:'',html:'',sections:{}};
    _tkpLearningDurableHydrated=false;
    _tkpLearningAutoStartSignature='';
  });
}

function tkpForwardTrackingCachedView(){
  const source=tkpForwardTrackingEnsureLog(),signature=tkpForwardTrackingViewSignature(source);
  return _tkpForwardViewCache.signature===signature?_tkpForwardViewCache.value:null;
}
function tkpFirstLookTekTrackingHTML(){
  const view=tkpForwardTrackingCachedView();
  if(!view){
    return `<div class="card tkpFirstLookTekCard"><h2 style="margin:0 0 4px">🎯 İlk Bakış ve TEK Takibi</h2><p class="muted" style="margin:0">Yarış-öncesi snapshotlar okunuyor. Bu işlem ayrı küçük dilimlerde hazırlanır; tahmin ve menüler kilitlenmez.</p></div>`;
  }
  const st=view.stats||{},pct=(hit,total)=>Number(total)>0?`%${fmt2(100*Number(hit||0)/Number(total))}`:'—';
  const all=tkpForwardTrackingEnsureLog();
  const bands={score:[[0,.10,'0,00–0,10'],[.10,.25,'0,10–0,25'],[.25,.50,'0,25–0,50'],[.50,Infinity,'0,50+']],prof:[[0,40,'<%40'],[40,55,'%40–54'],[55,70,'%55–69'],[70,Infinity,'%70+']]};
  const summarize=(items,key,defs)=>defs.map(([min,max,label])=>{let n=0,win=0;for(const r of items){if(!r?.evaluated_at||!String(r?.winner_no||'').trim())continue;const v=Number(r[key]);if(!Number.isFinite(v)||v<min||v>=max)continue;n++;if(Number(r.leader_win)===1)win++;}return `<tr><td>${label}</td><td class="num">${n}</td><td class="num">${win}</td><td class="num">${pct(win,n)}</td></tr>`;}).join('');
  const historical=typeof globalThis.tkpHistoricalSnapshotTrackingHTML==='function'?globalThis.tkpHistoricalSnapshotTrackingHTML(db):'';
  return `<div class="card tkpFirstLookTekCard"><h2 style="margin:0 0 4px">🎯 Tek Profili · İlk Bakış Kazananları</h2><p class="muted" style="margin:0 0 7px">Bu kart yalnız İlk Bakış liderinin gerçekten kazandığı doğrulanmış yarışları analiz eder. Kayıp TEK listesi burada yoktur. Hesap, seçili günle sınırlı değildir; kalıcı arşivdeki bütün yarış-öncesi snapshotları tarar.</p><div class="tkpTrackingKpis"><span><b>Doğrulanmış yarış</b> ${Number(st.done||0)} <small>gerçek forward kayıt</small></span><span><b>İlk Bakış kazananı</b> ${pct(st.leaderWin,st.done)} <small>${Number(st.leaderWin||0)}/${Number(st.done||0)}</small></span><span><b>İlk 3 kapsam</b> ${pct(st.leaderTop3,st.done)} <small>forward kayıt</small></span><span><b>İlk 5 kapsam</b> ${pct(st.leaderTop5,st.done)} <small>forward kayıt</small></span></div><div class="tkpTekProfileGrid"><div><h3>TKP puan bandı</h3><table class="tkpFirstLookTekTable"><thead><tr><th>Bant</th><th>Koşu</th><th>Kazanan</th><th>%</th></tr></thead><tbody>${summarize(all,'leader_score',bands.score)}</tbody></table></div><div><h3>PROF / güven bandı</h3><table class="tkpFirstLookTekTable"><thead><tr><th>Bant</th><th>Koşu</th><th>Kazanan</th><th>%</th></tr></thead><tbody>${summarize(all,'leader_prof',bands.prof)}</tbody></table></div></div></div>${historical}`;
}

function tkpTrackingCenterIntroHTML(){
  return `<div class="hero tkpTrackingHero"><h2>📌 İzleme Merkezi</h2><p>İlk Bakış, günlük/haftalık takip, kohort, kaçış nedenleri ve yan bahis izleme burada kalır. Ağır tanı ve arşiv araştırmaları Operasyon Merkezi'ne ayrılmıştır.</p></div>`;
}
function tkpScheduleFirstLookTrackingBuild(){
  const source=tkpForwardTrackingEnsureLog(),wanted=tkpForwardTrackingViewSignature(source);
  if(_tkpForwardViewCache.signature===wanted&&_tkpForwardViewCache.value)return false;
  const run=async()=>{
    try{
      if(typeof tkpWaitForBackgroundSafeWindow==='function')await tkpWaitForBackgroundSafeWindow({minIdleMs:900,retryMs:100});
      await tkpPrepareForwardTrackingViewAsync();
      if(document.querySelector('.tab.active')?.dataset?.pane==='learning')renderLearning();
    }catch(error){console.warn('İlk Bakış TEK takip hazırlığı:',error);}
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask('tracking-first-look',run,{priority:'background',replace:true,minIdleMs:700});
  else setTimeout(run,0);
  return true;
}

// Kayıtlı/eski algoritma başarı karşılaştırması kullanıcıya gösterilmez; kayıtlı kupon gerçek sonucu ayrı snapshot panelinde, güncel motor replay sonucu Back Test panelinde gösterilir.
function renderLearning(){
  const hiddenRoutineLogTypes=new Set(['ACCURATE','RESULT']);
  const rawLogs=db.changelog||[], visibleLogs=[]; let scanIndex=rawLogs.length-1;
  // V1.1.307: yalnız 200 satır gösteren panel toplam sayıyı bulmak için 10M logu
  // sonuna kadar taramaz. 200 görünür kayıt bulununca durur; tam geçmiş DB'de korunur.
  for(;scanIndex>=0&&visibleLogs.length<40;scanIndex--){const x=rawLogs[scanIndex];if(hiddenRoutineLogTypes.has(String(x?.type||'').toUpperCase()))continue;visibleLogs.push(x);}
  visibleLogs.sort((a,b)=>String(b.ts||'').localeCompare(String(a.ts||'')));
  const hasMoreLogs=scanIndex>=0;
  const logHtml=visibleLogs.length?`<details class="card tkpChangeLogTop tkpTrackingChangeLog"><summary>🧾 Değişiklik Kaydı <small>(${visibleLogs.length} son kayıt)</small></summary><div class="tableWrap"><table class="tkpChangeLogTable"><colgroup><col style="width:145px"><col style="width:135px"><col></colgroup><thead><tr><th>Zaman</th><th>Tür</th><th>Mesaj</th></tr></thead><tbody>${visibleLogs.map(x=>`<tr><td>${new Date(x.ts).toLocaleString('tr-TR')}</td><td><span class="badge">${esc(x.type)}</span></td><td>${esc(x.message)}</td></tr>`).join('')}</tbody></table></div>${hasMoreLogs?`<p class="muted">Hız için en yeni ${visibleLogs.length} kayıt gösteriliyor; tam geçmiş yedekte eksiksiz korunur.</p>`:''}</details>`:'<div class="empty">Henüz kayıt yok.</div>';
  const learningEl=$('#learningTable');if(!learningEl)return;
  const sig=tkpLearningCacheSignature();
  const cached=_tkpLearningHeavyCache.signature===sig?tkpLongCenterCachedHtml('learning'):'';
  learningEl.innerHTML=tkpTrackingCenterIntroHTML()+tkpFirstLookTekTrackingHTML()+logHtml+(cached||tkpLearningProgressiveShellHTML('learning'));
  tkpRenderTransferredAnalyticsTable('agfRankTableEl',()=>agfRankTable());
  tkpRenderTransferredAnalyticsTable('conditionRankTable',()=>conditionRankTable());
  tkpRenderTransferredAnalyticsTable('valueTable',()=>valueSpecificTable());
  tkpRenderTransferredAnalyticsTable('kulvarTable',()=>kulvarBandHTML());
  tkpRenderTransferredAnalyticsTable('adaptiveLearningTable',()=>typeof adaptiveLearningHTMLAsync==='function'?adaptiveLearningHTMLAsync():adaptiveLearningHTML());
  try{tkpForwardTrackingInitScrollers();}catch(_e){}
  tkpScheduleFirstLookTrackingBuild();
  // Hızlı kabuk ilk iki frame'de görünür; kalıcı cache yoksa uzun kartlar bundan
  // sonra otomatik hazırlanır. Kullanıcının ayrıca düğmeye basması gerekmez.
  if(!cached)tkpAutoStartLearningTables(sig);
}

function renderOperations(){
  // Sonuç/Accurate yükleme kontrolleri statiktir ve anında açılır. Operasyon
  // merkezindeki analitik tablolar yalnız kendi imzalı cache'i yoksa hazırlanır.
  tkpRenderTransferredAnalyticsTable('signalPerfTable',()=>signalPerformanceHTML());
  tkpRenderTransferredAnalyticsTable('hippoSignalTable',()=>hippodromeSignalHTML());
  tkpRenderTransferredAnalyticsTable('accurateSpeedTable',()=>accurateSpeedSignalHTML());
  tkpRenderTransferredAnalyticsTable('xKulisAnalysisTable',()=>xKulisAnalysisHTML());
  const root=$('#operationsLongTables');
  if(root){
    const sig=tkpLearningCacheSignature();
    const cached=_tkpLearningHeavyCache.signature===sig?tkpLongCenterCachedHtml('import'):'';
    root.innerHTML=cached||tkpLearningProgressiveShellHTML('import');
    if(!cached)tkpAutoStartLearningTables(sig);
  }
  return true;
}

let _tkpHistoricalSnapshotEnsurePromise=null;
let _tkpBacktestManualRunActive=false;
async function tkpEnsureVerifiedCouponSnapshotsForBacktest(){
  const coverage=typeof globalThis.tkpHistoricalCouponSnapshotCoverage==='function'
    ?globalThis.tkpHistoricalCouponSnapshotCoverage(db,db?.files||[])
    :null;
  if(!coverage||!coverage.missing)return coverage||{expected:0,covered:0,missing:0,completed:true};
  if(_tkpHistoricalSnapshotEnsurePromise)return _tkpHistoricalSnapshotEnsurePromise;
  if(typeof globalThis.tkpEnsureHistoricalCouponSnapshots!=='function')throw new Error('Doğrulanmış kupon snapshot tamamlama modülü hazır değil');
  _tkpHistoricalSnapshotEnsurePromise=Promise.resolve(globalThis.tkpEnsureHistoricalCouponSnapshots({foreground:true}))
    .finally(()=>{_tkpHistoricalSnapshotEnsurePromise=null;});
  return _tkpHistoricalSnapshotEnsurePromise;
}
function tkpBacktestSnapshotStatus(){
  const rows=Array.isArray(db?.auto_coupon_log)?db.auto_coupon_log:[];
  const autoSources=new Set(['SON_AGF_OTOMATIK','YARISTAN_40_DK_ONCE','SISTEM_GUNCEL_VERI','X_GUNCEL_OTOMATIK','HISTORICAL_CALIBRATION_FULL']);
  let usable=0,pending=0;
  for(const row of rows){
    if(!row?.coupons||Number(row?.backtest_eligible)===0||Number(row?.manual_adjustment)===1||!autoSources.has(String(row?.source)))continue;
    usable++;
    if(String(row?.resolution_state||'')==='PENDING')pending++;
  }
  const historic=typeof globalThis.tkpHistoricalCouponSnapshotCoverage==='function'
    ?globalThis.tkpHistoricalCouponSnapshotCoverage(db,db?.files||[])
    :{expected:0,covered:0,missing:0};
  return {usable,pending,revision:Number(db?.settings?.backtest_snapshot_revision)||0,historicExpected:Number(historic?.expected)||0,historicCovered:Number(historic?.covered)||0,historicMissing:Number(historic?.missing)||0};
}
let _tkpBacktestSnapshotRefreshTimer=0;
let _tkpBacktestSnapshotRefreshGeneration=0;
function tkpBacktestControlBudgets(){
  const normalRaw=parseFloat(String($('#normalCouponBudget')?.value||700).replace(',','.'));
  const surpriseRaw=parseFloat(String($('#surpriseCouponBudget')?.value||800).replace(',','.'));
  const normal=typeof tkpCouponBudgetFor==='function'?tkpCouponBudgetFor(normalRaw,'main'):Math.min(1400,Math.max(700,normalRaw||1200));
  const surprise=typeof tkpCouponBudgetFor==='function'?tkpCouponBudgetFor(surpriseRaw,'surprise'):Math.min(1400,Math.max(700,surpriseRaw||1200));
  return {main:normal,main2:normal,alt:0,surprise,normalMode:'standard'};
}
// Kupon snapshotı ya da resmî sonuç değiştiğinde yalnız Back Test ekranı açıksa
// arka planda güncelle. Diğer menülerde 503 toplantılık hesap başlatılmaz.
function tkpScheduleCurrentBacktestRefresh(){
  const generation=++_tkpBacktestSnapshotRefreshGeneration;
  clearTimeout(_tkpBacktestSnapshotRefreshTimer);
  _tkpBacktestSnapshotRefreshTimer=setTimeout(async()=>{
    const pane=document.getElementById('pane-backtest'),out=$('#couponBacktestResult');
    if(_tkpBacktestManualRunActive||!pane?.classList.contains('active')||!out||out.dataset.ready!=='1')return;
    try{
      const limit=Math.max(1,Math.min(509,Number($('#couponBacktestLimit')?.value)||509));
      tkpShowPanelPending(out,`Kupon snapshotları ve doğrulanmış sonuçlar güncelleniyor…`, 'backtest');
      if(typeof tkpYield==='function')await tkpYield();
      const budgets=tkpBacktestControlBudgets();
      const html=typeof tkpGetBacktestHTMLAsync==='function'
        ?await tkpGetBacktestHTMLAsync(budgets,limit)
        :couponArchiveBacktestHTML(budgets,limit);
      if(generation!==_tkpBacktestSnapshotRefreshGeneration||!pane.classList.contains('active'))return;
      out.innerHTML=html;out.dataset.ready='1';
    }catch(error){
      // Önceki doğrulanmış tablo silinmez; kullanıcı isterse normal düğmeyle tekrar dener.
      console.warn('Back Test snapshot yenilemesi ertelendi:',error);
    }
  },80);
  return true;
}
if(typeof window!=='undefined'){
  window.tkpScheduleCurrentBacktestRefresh=tkpScheduleCurrentBacktestRefresh;
  window.addEventListener('tkp:db-changed',event=>{
    const detail=event?.detail||{};
    if(detail.backtestChanged||detail.resultsChanged)tkpScheduleCurrentBacktestRefresh();
  });
}
function renderBacktest(){
  const out=$('#couponBacktestResult');
  if(out && !out.dataset.ready){
    const status=tkpBacktestSnapshotStatus();
    const historicalNote=status.historicMissing?` · <b>${status.historicMissing}/${status.historicExpected}</b> eski Altılıda kupon snapshotı yok; Back Test bunları üretmeden mevcut doğrulanmış frozen veriyi kullanır`:'';
    out.innerHTML=`<div class="empty">Back Test hazır bekliyor. <b>${status.usable}</b> yarış-öncesi kupon snapshotı kayıtlı${status.pending?` · ${status.pending} sonuç bekliyor`:''}${historicalNote}. Resmî sonuç gelince aynı snapshot çözümlenir; ekran açık değilken yeniden hesaplama yapılmaz.</div>`;
  }
}

function tkpPanelHasDurableResult(out, kind){
  if(!out) return false;
  const text=String(out.textContent||'').replace(/\s+/g,' ').trim();
  if(!text || /okunuyor|hazırlanıyor|test ediliyor/i.test(text)) return false;
  if(kind==='prediction') return Boolean(out.querySelector('.predLegTabs, .predLegPane'));
  if(kind==='backtest') return out.dataset.ready==='1'
    && !/Back Test için butona bas/i.test(text)
    && text.length>30;
  return false;
}

function tkpShowPanelPending(out, message, kind){
  if(!out) return;
  out.querySelectorAll('.tkpTransientPanelStatus').forEach(node=>node.remove());
  const html=`<div class="card tkpTransientPanelStatus" style="border-left:5px solid #7c3aed;">${esc(message)}</div>`;
  if(tkpPanelHasDurableResult(out, kind)) out.insertAdjacentHTML('afterbegin', html);
  else out.innerHTML=html;
}

function tkpShowPanelError(out, message, kind){
  if(!out) return;
  out.querySelectorAll('.tkpTransientPanelStatus').forEach(node=>node.remove());
  const html=`<div class="card tkpTransientPanelStatus" style="border-left:5px solid #dc2626;"><b>${esc(message)}</b></div>`;
  if(tkpPanelHasDurableResult(out, kind)) out.insertAdjacentHTML('afterbegin', html);
  else out.innerHTML=html;
}

function renderPredictionPane(){
  // Tahmin sekmesi açılınca kayıtlı gün/bülten listesi de güncellensin.
  // Eskiden bu liste yalnız Dosyalar/QC render edilince doluyordu.
  if(typeof tkpRefreshRecalcFileSelect==='function') tkpRefreshRecalcFileSelect();
  const hint=$('#suggestedBudgetHint');
  if(hint) hint.innerHTML = suggestBudgetHTML();
}

function tkpCommentatorPerformanceHTML(){
  let live=[],historical=[];
  try{live=typeof globalThis.tkpCommentatorPerformanceReport==='function'?globalThis.tkpCommentatorPerformanceReport():[];}catch(_){live=[];}
  try{historical=typeof globalThis.tkpHistoricalCommentatorPerformanceReport==='function'?globalThis.tkpHistoricalCommentatorPerformanceReport(db):[];}catch(_){historical=[];}
  const readySources=new Set(['misli','hipodrom','bitalih','editor','atyarisi']);
  live=(live||[]).filter(row=>readySources.has(String(row?.source_type||'').toLowerCase()));
  historical=(historical||[]).filter(row=>readySources.has(String(row?.source_type||'').toLowerCase()));
  // Kaynaklar ayni yazari Turkce karakter, birlesik i noktasi, noktalama veya
  // fazla boslukla farkli yazabiliyor. Gorselde ayni gorunen bu kayitlar ayri
  // anahtara dusunce bir bos canli satir ve bir dolu eski satir olusuyordu.
  const commentatorPart=value=>String(value||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('tr-TR')
    .replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
  const commentatorKey=row=>commentatorPart(row?.source_type)+'|'+commentatorPart(row?.author_id);
  const mergeRows=rows=>{
    const out=new Map();
    for(const row of rows){
      const key=commentatorKey(row);if(!key||key==='|')continue;
      const previous=out.get(key);
      if(!previous){out.set(key,{...row});continue;}
      const previousEvents=Number(previous.events)||0,rowEvents=Number(row.events)||0,totalEvents=previousEvents+rowEvents;
      const previousStored=Number(previous.stored_events)||0,rowStored=Number(row.stored_events)||0,totalStored=previousStored+rowStored;
      const weighted=(field,weightA,weightB)=>{
        const a=Number(previous[field]),b=Number(row[field]),den=weightA+weightB;
        if(!den)return Number.isFinite(a)?a:(Number.isFinite(b)?b:undefined);
        return (((Number.isFinite(a)?a:0)*weightA)+((Number.isFinite(b)?b:0)*weightB))/den;
      };
      previous.accuracy=weighted('accuracy',previousEvents,rowEvents);
      previous.edge=weighted('edge',previousEvents,rowEvents);
      previous.avg_selections=weighted('avg_selections',previousStored||previousEvents,rowStored||rowEvents);
      previous.events=totalEvents;
      if(totalStored)previous.stored_events=totalStored;
      // Aksanli/eski arsivdeki okunabilir yazar adini kaybetme.
      if(String(row.author_id||'').length>String(previous.author_id||'').length)previous.author_id=row.author_id;
    }
    return out;
  };
  const liveBy=mergeRows(live);
  const histBy=mergeRows(historical);
  // Eski arşiv kaydı olan yorumcuları önce göster; canlı kaynakların boş satırları
  // eski seçim verilerini ekranın altına itip tabloyu boşmuş gibi göstermemeli.
  const keys=[...new Set([...histBy.keys(),...liveBy.keys()])]
    .filter(key=>Number(histBy.get(key)?.stored_events||0)>0||Number(liveBy.get(key)?.events||0)>0)
    .sort((a,b)=>{
      const ah=histBy.get(a)||{},bh=histBy.get(b)||{},al=liveBy.get(a)||{},bl=liveBy.get(b)||{};
      const ae=Number(ah.events||al.events||0),be=Number(bh.events||bl.events||0);
      const aa=ae>0?Number((Number(ah.events)>0?ah:al).accuracy):-1;
      const ba=be>0?Number((Number(bh.events)>0?bh:bl).accuracy):-1;
      return ba-aa||be-ae||Number(bh.stored_events||0)-Number(ah.stored_events||0)||a.localeCompare(b,'tr');
    })
    .slice(0,40);
  const body=keys.map(key=>{
    const row=liveBy.get(key)||histBy.get(key)||{},hrow=histBy.get(key)||null,lrow=liveBy.get(key)||null;
    const useHistorical=Number(hrow?.stored_events||0)>0,metric=useHistorical?hrow:(lrow||hrow||{});
    const hSample=useHistorical?Number(hrow?.stored_events||0):Number(lrow?.events||0),hEvaluated=Number(metric?.events)||0;
    const hAccuracy=hEvaluated?Math.round((Number(metric?.accuracy)||0)*1000)/10:null;
    const hEdge=hEvaluated?Math.round((Number(metric?.edge)||0)*1000)/10:null;
    const avgSel=Number(metric?.avg_selections);const histShape=hSample&&Number.isFinite(avgSel)?('Ort. '+avgSel.toFixed(1).replace('.',',')+' at/seçim'):(useHistorical?'—':'Canlı kanıt');
    const impact=hEvaluated<3?'izleniyor':(Number(metric?.edge)>0?'Uzman + Kulis öncelikli':(Number(metric?.edge)<0?'düşük öncelik':'nötr'));
    const fmt=x=>x===null?'—':'%'+String(x).replace('.',',');
    const edgeFmt=x=>x===null?'—':(x>0?'+':'')+'%'+String(x).replace('.',',');
    const sourceLabel=String(row.source_type||'').toLowerCase()==='misli'?'MISLI.COM':String(row.source_type||'').toUpperCase();
    const laneText=useHistorical?' · eski arşiv':' · canlı/pre-race';
    return `<tr><td><b>${esc(sourceLabel)}</b></td><td>${esc(String(row.author_id||'').replace(/_/g,' '))}</td><td class="num">${hSample||'—'}</td><td class="num">${fmt(hAccuracy)}</td><td>${esc(histShape)}</td><td style="color:${hEdge>0?'#15803d':hEdge<0?'#b91c1c':'#64748b'}">${edgeFmt(hEdge)}</td><td>${esc(impact)}${hSample?laneText:''}</td></tr>`;
  }).join('');
  const coverage=typeof globalThis.tkpHistoricalAllDataCoverage==='function'?globalThis.tkpHistoricalAllDataCoverage(db):null;
  const note=coverage?` Eski embedded yorumcu seçim olayı: ${Number(coverage.commentatorHistoricalSelections||0)}; sonuç bütünlüğü doğrulanmış ${Number(coverage.commentatorHistoricalEvents||0)}, karantinada ${Number(coverage.commentatorHistoricalUnresolved||0)}. Karantina kayıtları isabet hesabında 0 sayılmaz.`:'';
  const archiveCoverage=typeof globalThis.tkpHistoricalAllDataCoverageHTML==='function'?globalThis.tkpHistoricalAllDataCoverageHTML(db):'';
  return `<div class="tkpCommentatorArchiveGrid"><div class="card tkpCommentatorPerformanceCard" data-commentator-table-version="10" style="margin-top:10px"><h3 style="margin:0 0 4px">Yorumcu Başarı Takibi · Eski Arşiv</h3><div class="muted tkpCommentatorPerformanceNote">Y.PUAN ham ODS puanıdır ve değiştirilmez. Yorumcular doğrulanmış eski arşiv isabetine göre yüksekten düşüğe sıralanır; eşitlikte daha çok doğrulanmış seçim ve daha yüksek fark öne geçer. Bu sıra Uzman + Kulis değerlendirmesine katkı verir. Sonucu olmayan kayıtlar seçim genişliği ve kaynak aktivitesinde korunur; isabette 0 sayılmaz.${esc(note)}</div>${body?`<div class="tableWrap tkpCommentatorTableWrap"><table class="compact tkpCommentatorTable"><thead><tr><th>Site</th><th>Yazar</th><th>Eski n</th><th>Eski isabet</th><th>Eski seçim yapısı</th><th>Eski fark</th><th>Etki / durum</th></tr></thead><tbody>${body}</tbody></table></div>`:'<div class="empty">Eski arşivde değerlendirilebilir yorumcu kaydı yok.</div>'}</div>${archiveCoverage}</div>`;
}

function renderSystem(){
  const el = $('#systemHealthPanel');
  if(!el) return;
  const evidence=typeof tkpBaselineEvidenceHTML==='function'?tkpBaselineEvidenceHTML():'';
  const deferred=window.__tkpRestoreHygieneDeferred;
  const restoreFence=deferred
    ?'<div class="card" data-post-boot-fence="deferred" style="border-left:5px solid #0f766e;margin-bottom:10px"><b>⚡ Büyük arşiv açılış koruması etkin</b><div class="muted" style="margin-top:4px">'
      +Number(deferred.files||0).toLocaleString('tr-TR')+' dosya / '+Number(deferred.races||0).toLocaleString('tr-TR')
      +' koşu için açılışta gizli backfill ve ikinci tam kayıt çalıştırılmadı. Yeni veri ekleme veya açık bir kayıt işleminde normal kalıcı yol devreye girer.</div></div>'
    :'';
  const performance=typeof tkpPerformancePanelHTML === 'function'
    ? tkpPerformancePanelHTML()
    : '<div class="empty">Performans paneli yüklenemedi.</div>';
  el.innerHTML=evidence+restoreFence+performance;
}

let tkpPerformancePanelRefreshQueued=false;
function tkpRefreshPerformancePanel(){
  const pane=document.getElementById('pane-system');
  if(!pane?.classList.contains('active')) return false;
  if(tkpPerformancePanelRefreshQueued) return true;
  tkpPerformancePanelRefreshQueued=true;
  const refresh=()=>{
    tkpPerformancePanelRefreshQueued=false;
    if(document.getElementById('pane-system')?.classList.contains('active')) renderSystem();
  };
  if(typeof requestAnimationFrame==='function') requestAnimationFrame(refresh);
  else setTimeout(refresh,0);
  return true;
}
window.tkpRefreshPerformancePanel=tkpRefreshPerformancePanel;

function renderBackupSettings(){
  $('#bestMin').value = db.settings.best_min_single;
  $('#perfectMin').value = db.settings.perfect_min_single;
  $('#perfectRate').value = Math.round(db.settings.perfect_min_rate*100);
  $('#maxRuleSize').value = String(db.settings.max_rule_size);
}

const PANE_RENDERERS = {
  dashboard: renderDashboard,
  advice: renderAdvice,
  rules: renderRules,
  analytics: renderAnalytics,
  import: renderOperations,
  data: renderData,
  prediction: renderPredictionPane,
  files: renderFiles,
  profit: renderProfit,
  backtest: renderBacktest,
  system: renderSystem,
  learning: renderLearning,
  backup: renderBackupSettings
};

function runPaneRenderer(name, fn){
  if(typeof window.tkpRestoreTopTabs === 'function') window.tkpRestoreTopTabs();
  if(typeof window.tkpFastPaneRender === 'function') return window.tkpFastPaneRender(name, fn);
  if (typeof tkpMeasureRender === 'function') return tkpMeasureRender(name, fn);
  return fn();
}

function renderActivePane(){
  const activeBtn = document.querySelector('.tab.active');
  const name = activeBtn ? activeBtn.dataset.pane : 'dashboard';
  const fn = PANE_RENDERERS[name];
  if (fn) runPaneRenderer(name, fn);
}

function renderAll(){
  const finalDbCount = document.getElementById('finalDbCount');
  if(finalDbCount) finalDbCount.textContent = `Arşiv ${(db?.files||[]).length} toplantı · ${(db?.races||[]).length} koşu`;
  $('#persistWarning').innerHTML = persistWarningHTML();
  renderActivePane();
  // Ağır İleri Takip/öğrenme analizi açılışta otomatik başlatılmaz.
}

window.__tkp_downloadFileOds = async function(id){
  let f = (typeof tkpFileById === 'function' ? tkpFileById(id) : null) || db.files.find(x=>x.id===id);
  if (!f){ alert('Dosya bulunamadı.'); return false; }
  let races = (typeof tkpRowsByFileId === 'function' ? tkpRowsByFileId(id) : []).filter(Boolean);
  if (!races.length) races = db.races.filter(r => r.file_id === id).sort((a,b)=>a.leg-b.leg);
  if (!races.length){ alert('Bu dosyaya bağlı koşu kaydı yok.'); return false; }
  try{
    let base = tkpOdsDownloadBase(f);
    await downloadOdsFromRaces(races, base);
    return true;
  }catch(error){
    console.error('ODS indirme hatası:',error);
    alert('ODS indirilemedi: '+(error?.message||String(error)));
    return false;
  }
};



function tkpNumOrBlank(v){
  const t=String(v??'').trim().replace(',','.');
  if(t==='') return '';
  const n=Number(t);
  return Number.isFinite(n)?n:'';
}
function tkpEditField(v, key, rid, hi, type='text'){
  const val=(v===undefined||v===null)?'':v;
  return `<input class="tkpEditInput" type="${type}" data-rid="${rid}" data-hi="${hi}" data-key="${key}" value="${esc(val)}">`;
}
function tkpEditModalHtml(f, races){
  return `<div id="tkpEditOverlay" class="tkpEditOverlay" onclick="if(event.target===this)window.__tkp_closeEdit()">
    <div class="tkpEditModal">
      <div class="tkpEditHead"><div><b>✏️ Kayıt Düzelt</b><div class="muted" style="font-size:12px;">Eksik alanları doldur; kayıt silinmeden güncellenir.</div></div><button class="fileActBtn" onclick="window.__tkp_closeEdit()">✕</button></div>
      <div class="tkpEditMeta">
        <label>Tarih<input id="tkpEditDate" class="tkpEditInput" value="${esc(displayDateTR(f.race_date||''))}"></label>
        <label>Hipodrom<input id="tkpEditHip" class="tkpEditInput" value="${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(f.hippodrome):f.hippodrome||'')}"></label>
        <label>QC<input id="tkpEditQc" class="tkpEditInput" value="${esc(f.qc_status||'')}"></label>
      </div>
      <div class="tkpEditBody">${races.map(r=>`<div class="tkpEditRace">
        <div class="tkpEditRaceTitle"><b>${esc(r.leg)}. Koşu</b><span>${esc(r.condition_text||'')} ${r.distance?('· '+esc(r.distance)+' m'):''}</span></div>
        <div class="tableWrap"><table class="tkpEditTable"><thead><tr><th>No</th><th>At</th><th>ST</th><th>AGF</th><th>800 G</th><th>HNDKP</th><th>TR</th><th>VALUE</th><th>SP</th><th>BMB</th><th>Derece</th></tr></thead><tbody>
          ${(r.horses||[]).map((h,i)=>`<tr><td>${tkpEditField(h.horse_no,'horse_no',r.id,i)}</td><td>${tkpEditField(h.horse_name,'horse_name',r.id,i)}</td><td>${tkpEditField(h.start_no,'start_no',r.id,i)}</td><td>${tkpEditField(h.agf,'agf',r.id,i)}</td><td>${tkpEditField(h.g800,'g800',r.id,i)}</td><td>${tkpEditField(h.hndkp,'hndkp',r.id,i)}</td><td>${(()=>{const v=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;return `<span class="tkpReadOnlyValue" title="Ganyan Canavarı kaynak kilitli TR PUAN">${esc(v??'-')}</span>`;})()}</td><td>${tkpEditField(h.value_score,'value_score',r.id,i)}</td><td>${tkpEditField(h.sp,'sp',r.id,i)}</td><td><input type="checkbox" data-rid="${r.id}" data-hi="${i}" data-key="bmb" ${h.bmb?'checked':''}></td><td>${tkpEditField(h.finish_position,'finish_position',r.id,i)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`).join('')}</div>
      <div class="tkpEditFoot"><button class="fileActBtn" onclick="window.__tkp_closeEdit()">Vazgeç</button><button class="fileActBtn primary" onclick="window.__tkp_saveEdit(${f.id})">💾 Kaydet</button></div>
    </div></div>`;
}
window.__tkp_editFile = function(id){
  const f=(typeof tkpFileById==='function'?tkpFileById(id):null)||db.files.find(x=>x.id===id);
  if(!f){ alert('Kayıt bulunamadı.'); return; }
  const races=(typeof tkpRowsByFileId==='function'?tkpRowsByFileId(id):db.races.filter(r=>r.file_id===id)).slice().sort((a,b)=>(a.leg||0)-(b.leg||0));
  if(!races.length){ alert('Bu kayda bağlı koşu verisi yok.'); return; }
  window.__tkp_closeEdit();
  document.body.insertAdjacentHTML('beforeend',tkpEditModalHtml(f,races));
};
window.__tkp_closeEdit = function(){ document.getElementById('tkpEditOverlay')?.remove(); };
window.__tkp_saveEdit = function(id){
  const f=(typeof tkpFileById==='function'?tkpFileById(id):null)||db.files.find(x=>x.id===id);
  if(!f) return;
  const dateText=(document.getElementById('tkpEditDate')?.value||'').trim();
  let iso=dateText;
  const m=dateText.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if(m) iso=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)){ alert('Tarih GG.AA.YYYY biçiminde olmalı.'); return; }
  const hip=(document.getElementById('tkpEditHip')?.value||'').trim().toLocaleUpperCase('tr-TR');
  if(!hip){ alert('Hipodrom boş bırakılamaz.'); return; }
  f.race_date=iso; f.hippodrome=hip; f.qc_status=(document.getElementById('tkpEditQc')?.value||'BEKLİYOR').trim()||'BEKLİYOR'; f.updated_at=new Date().toISOString();
  const raceMap=new Map((typeof tkpRowsByFileId==='function'?tkpRowsByFileId(id):db.races.filter(r=>r.file_id===id)).map(r=>[String(r.id),r]));
  document.querySelectorAll('#tkpEditOverlay [data-rid][data-hi][data-key]').forEach(el=>{
    const r=raceMap.get(String(el.dataset.rid)); if(!r) return;
    const h=r.horses?.[Number(el.dataset.hi)]; if(!h) return;
    const k=el.dataset.key;
    let v=el.type==='checkbox'?el.checked:el.value.trim();
    if(['start_no','agf','g800','hndkp','tr','value_score','sp','finish_position'].includes(k)) v=tkpNumOrBlank(v);
    h[k]=v;
    if(k==='finish_position') h.winner=Number(v)===1?1:0;
    r.race_date=iso; r.hippodrome=hip;
  });
  // Kullanıcının tarih/hipodrom düzeltmesi kronolojik sırayı değiştirebilir:
  // bilinçli olarak tam eşleme yapılır.
  if(typeof tkpResequenceFilesChronologically==='function'){
    tkpResequenceFilesChronologically(db,{full:true,reason:'date-correction',markDirty:false,logChange:false});
    // Tarih/pist düzenlemesi meeting UID'sini de değiştirir. Aynı sayıda kayıt
    // kaldığı için yalnız marker sayımına güvenmeyip bağlı snapshot/log kimliklerini
    // burada, kullanıcının zaten onayladığı tam düzeltme yolunda yeniden eşleriz.
    if(typeof tkpEnsureRaceIdentityMigration==='function') tkpEnsureRaceIdentityMigration(db,{full:true,recompute:true});
  }
  log('QC', `${f.filename} kaydı silinmeden düzeltildi; dosya No tarih sırasına göre yeniden doğrulandı.`);
  window.__tkp_closeEdit();
  saveDB();
  renderFiles();
};

function resequenceFilesAfterDelete(){
  // 1=en eski, N=en yeni. Silme sonrası boşluk kapatılırken yükleme sırası değil
  // yarış tarihi esas alınır.
  if(typeof tkpResequenceFilesChronologically==='function'){
    tkpResequenceFilesChronologically(db,{full:true,reason:'delete',markDirty:false,logChange:false});
    if(typeof tkpEnsureRaceIdentityMigration==='function') tkpEnsureRaceIdentityMigration(db,{full:true,recompute:true});
    return;
  }
  const ordered=db.files.slice().sort((a,b)=>String(a.race_date||'').localeCompare(String(b.race_date||''))||(Number(a.sequence_no)||0)-(Number(b.sequence_no)||0));
  const rowsByFile=new Map();
  for(const r of (db.races||[])){const key=String(r?.file_id);if(!rowsByFile.has(key))rowsByFile.set(key,[]);rowsByFile.get(key).push(r);}
  ordered.forEach((f,index)=>{
    const seq=index+1;f.sequence_no=seq;
    const hip=f.hippodrome||'YARIS';f.filename=tkpQcOdsFilename(seq,hip,f.altili_no,f.altili_count);
    for(const r of (rowsByFile.get(String(f.id))||[])){r.sequence_no=seq;r.filename=f.filename;}
  });
}

window.__tkp_deleteFile = async function(id){
  if (!confirm('Bu dosyayı ve bağlı tüm koşu kayıtlarını silmek istediğine emin misin? Silme öncesi güvenli dahili checkpoint alınacak.')) return;
  try{
    // V1.1.282 BELLEK KÖK FIX: Eski yol silme öncesinde bütün db'yi pretty JSON'a
    // çevirip indiriyordu. Büyük arşivde bu tek tıklama yüzlerce MB geçici bellek
    // üretip sekmeyi çökertiyordu. Önce son state'i parçalı IDB'ye flush et, sonra
    // O(1) manifest checkpoint al. Kullanıcı isterse ayrıca V5 .tkpbak indirebilir.
    if(typeof saveDB==='function')await saveDB(false,true);
    if(typeof globalThis.tkpCreateStorageCheckpoint==='function')await globalThis.tkpCreateStorageCheckpoint('before-delete-file-'+String(id));
  }catch(error){alert('Silme öncesi güvenlik kaydı alınamadı; veri korunması için silme iptal edildi. '+(error?.message||error));return;}
  db.files = db.files.filter(f => f.id !== id);
  db.races = db.races.filter(r => r.file_id !== id);
  resequenceFilesAfterDelete();
  invalidateAdaptiveLearningCache();
  log('QC', `Dosya silindi (id ${id}); kalan dosyalar boşluksuz yeniden numaralandırıldı.`);
  await saveDB();
};

window.__tkp_toggleFileStatus = function(id, makeActive){
  let f = db.files.find(x=>x.id===id);
  if (!f) return;
  f.status = makeActive ? 'ACTIVE' : 'REVIEW_NEAR_DUPLICATE';
  log('QC', `${f.filename} durumu ${f.status} olarak değiştirildi.`);
  saveDB();
};

window.__tkp_deleteBet = function(i){
  db.bets.splice(i,1);
  saveDB();
};

function wireTabs(){
  $$('.tab').forEach(btn => {
    btn.onclick = () => {
      const targetPane = document.getElementById('pane-' + btn.dataset.pane);
      // V1.1.250: aynı aktif sekmeye tekrar basmak ağır renderer'ı yeniden başlatmasın.
      // Özellikle Analiz/İleri Takip/Back Test panellerinde çift tıklama veya gecikmeli
      // ikinci click, gereksiz DOM üretimi ve ana-thread yükü oluşturabiliyordu.
      if(btn.classList.contains('active') && targetPane?.classList.contains('active')) return;
      const prevActivePane = document.querySelector('.pane.active');
      $$('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      $$('.pane').forEach(p=>p.classList.remove('active'));
      document.getElementById('pane-' + btn.dataset.pane).classList.add('active');
      // Veritabanı henüz okunurken sekme görünümü anında değişebilir; ancak veri
      // isteyen renderer çalışamaz. Önceki yol dashboard/files/prediction kodunu
      // null db ile çağırıp "bets/files okunamıyor" hatası üretiyor, aynı renderer
      // boot sonunda bir kez daha çalışıyordu. İstenen sekme aktif bırakılır;
      // renderAll() DB hazır olur olmaz onu yalnız bir kez gerçek veriyle çizer.
      if(typeof window!=='undefined' && window.__tkpBootReady !== true){
        window.__tkpPendingBootPane=btn.dataset.pane;
        const warning=document.getElementById('persistWarning');
        if(warning) warning.innerHTML='<div class="warn" style="margin:6px 0;padding:8px 10px;">⏳ Arşiv güvenli kayıttan açılıyor. Seçtiğin ekran veri hazır olur olmaz gösterilecek.</div>';
        return;
      }
      // Görünmeyen üst panelin tbody'lerini sonradan boşaltmak yasaktır. Bu eski
      // idle temizlik işi sekmeye geri dönüldüğünde V1.1.306 tablolarının boş veya
      // gecikmeli görünmesine yol açıyordu. Tahminin alt sekmeleri kendi parçalı
      // DocumentFragment yöneticisini kullanır; üst görünüm DOM'u aynen korunur.
      // "Geçmiş yarış dosyası ekle" panelindeki (Manuel ODS / Sonuç HTML Güncelle)
      // önizleme ve "Sonuçlar mevcut kayda işlendi" gibi başarı mesajları, işlem
      // tamamlandıktan sonra da ekranda asılı kalıyordu -- kullanıcı başka bir
      // sekmeye geçip geri döndüğünde bile eski mesajı görüyordu. Artık bu
      // panelden BAŞKA bir sekmeye geçildiğinde geçici alanlar temizlenir.
      if (prevActivePane && prevActivePane.id === 'pane-import' && btn.dataset.pane !== 'import'){
        setPreviewPayload(null);
        if ($('#historyPreview')) $('#historyPreview').innerHTML = '';
        if ($('#historyFileName')) $('#historyFileName').textContent = '';
        if ($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent = '';
        if ($('#accurateFolderFileName')) $('#accurateFolderFileName').textContent = '';
        if ($('#historyFile')) $('#historyFile').value = '';
        if ($('#resultBulletinFile')) $('#resultBulletinFile').value = '';
        if ($('#accurateFolderFile')) $('#accurateFolderFile').value = '';
      }
      // Sekme her tıklandığında güncel veriyle render edilir (lazy render) — böylece
      // görünmeyen sekmeler boşuna hesaplanmaz, ama açıldıklarında güncel kalır.
      const fn = PANE_RENDERERS[btn.dataset.pane];
      if (fn) runPaneRenderer(btn.dataset.pane, fn);
    };
  });
}

function confirmedResultRacesForFile(fileId){
  const rows=typeof tkpRowsByFileId==='function'?tkpRowsByFileId(fileId):db.races.filter(r=>r.file_id===fileId);
  return rows.filter(r=>resultRaceQuality(r).winnerCount>0);
}

function tkpResultRaceOverlapScore(incoming,target){
  if(!incoming||!target)return {score:-1e9,nameHits:0,exactHits:0,ratio:0};
  const incomingHorses=(incoming.horses||[]).filter(Boolean);
  const targetHorses=(target.horses||[]).filter(Boolean);
  const targetByName=new Map();
  for(const horse of targetHorses){
    const name=baseHorseName(horse?.horse_name||'');
    if(name&&!targetByName.has(name))targetByName.set(name,[]);
    if(name)targetByName.get(name).push(horse);
  }
  let nameHits=0,exactHits=0;
  for(const horse of incomingHorses){
    const name=baseHorseName(horse?.horse_name||'');
    const matches=name?(targetByName.get(name)||[]):[];
    if(matches.length){
      nameHits++;
      if(matches.some(row=>String(row?.horse_no||'')===String(horse?.horse_no||'')))exactHits++;
    }
  }
  const denom=Math.max(1,Math.min(incomingHorses.length||1,targetHorses.length||1));
  const ratio=nameHits/denom;
  const absMatch=incoming?._absRaceNo!=null&&target?._absRaceNo!=null&&Number(incoming._absRaceNo)===Number(target._absRaceNo);
  const legMatch=Number(incoming?.leg)>0&&Number(incoming.leg)===Number(target?.leg);
  // İsim örtüşmesi ana kanıttır. abs/leg yalnız yönlendirici bonus alır; at numarası
  // farklı koşularda tekrarlandığı için tek başına seçim kanıtı sayılmaz.
  let score=nameHits*24+exactHits*10+Math.round(ratio*80)+(absMatch?45:0)+(legMatch?22:0);
  if(!incomingHorses.length && (absMatch||legMatch))score+=30; // yalnız ikramiye katmanı
  if(nameHits===0&&incomingHorses.length&&targetHorses.length)score-=80;
  return {score,nameHits,exactHits,ratio,absMatch,legMatch};
}

function resultPayloadMatchScore(p,options={}){
  const date=String(p?.file?.race_date||'');
  const hip=canonicalHippodrome(p?.file?.hippodrome||'');
  const alt=Number(p?.file?.altili_no)||0;
  const forcedTargetId=String(options?.targetFileId??p?.file?._target_file_id??'').trim();
  let files=[];
  if(forcedTargetId){
    const forced=(db.files||[]).find(file=>String(file?.id)===forcedTargetId);
    if(forced)files=[forced];
  }
  if(!files.length){
    files=typeof tkpFilesByDateHip==='function'?tkpFilesByDateHip(date,hip):(db.files||[]).filter(f=>String(f.race_date||'')===date && canonicalHippodrome(f.hippodrome||'')===hip);
    if(alt){
      const exact=files.filter(f=>(f.altili_no!=null && f.altili_no!=='' && Number(f.altili_no)===alt));
      if(exact.length) files=exact;
    }
  }
  if(!files.length)return resultPayloadQuality(p).complete;
  const scoreForFile=(target)=>{
    const races=typeof tkpRowsByFileId==='function'?tkpRowsByFileId(target.id):(db.races||[]).filter(r=>String(r?.file_id)===String(target.id));
    const targetAlt=(target.altili_no==null || target.altili_no==='') ? null : Number(target.altili_no);
    let score=(forcedTargetId?10000:100)+((alt&&targetAlt!=null&&targetAlt===alt)?80:0);
    const unused=new Set(races.map((_,index)=>index));
    for(const incoming of (p.races||[])){
      let bestIndex=-1,best=null;
      for(const index of unused){
        const evidence=tkpResultRaceOverlapScore(incoming,races[index]);
        if(!best||evidence.score>best.score){best=evidence;bestIndex=index;}
      }
      if(bestIndex<0||!best)continue;
      // Yanlış 1./2. Altılı adayını seçmemek için en az isim kanıtı; yalnız ikramiye
      // taşıyan yarışlarda abs/leg kanıtı yeterlidir.
      const incomingCount=(incoming?.horses||[]).length;
      const trustworthy=incomingCount===0?(best.absMatch||best.legMatch):(best.nameHits>=2||best.ratio>=0.30||(best.nameHits>=1&&best.absMatch&&best.legMatch));
      if(!trustworthy)continue;
      unused.delete(bestIndex);
      score+=best.score;
      if((incoming.horses||[]).some(h=>Number(h?.finish_position)===1))score+=12;
    }
    return score+resultPayloadQuality(p).complete*5;
  };
  return Math.max(...files.map(scoreForFile));
}

function selectBestResultPayload(candidates,options={}){
  const list=(candidates||[]).filter(Boolean);
  if(!list.length)throw new Error('Sonuç dosyası ayrıştırılamadı.');
  return list.slice().sort((a,b)=>resultPayloadMatchScore(b,options)-resultPayloadMatchScore(a,options))[0];
}



function tkpIsFolderAssetFile(f){
  const path=String(f?.webkitRelativePath||f?.name||'').replace(/\\/g,'/');
  const name=String(f?.name||'');
  // Web sayfası yardımcı klasörü: "..._files/..." içindeki parçalar elenir; kök HTML kalır.
  if(/(^|\/)[^\/]*(?:_|-)files\//i.test(path) || /(^|\/)[^\/]*(?:_)(files|dosyalar)\//i.test(path)) return true;
  if(/^(ads?|aframe|ssp|sync|isyn|bus|activityi|cookie_push_onload|zrt_lookup[\w-]*(?:\(\d+\))?|generateWidget(?:\(\d+\))?)\.html?$/i.test(name)) return true;
  return false;
}
function tkpUsableUploadFile(f){
  if(!f) return false;
  const name=String(f.name||'');
  if(!/\.(ods|html?|htm)$/i.test(name)) return false;
  if(/\.html?$/i.test(name) && tkpIsFolderAssetFile(f)) return false;
  return true;
}
function tkpLooksLikeOfficialTjkResultHtmlText(text, file){
  const raw=String(text||'');
  const title=(raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]||'');
  const hay=fold(title+' '+String(file?.name||'')+' '+String(file?.webkitRelativePath||''));
  return /gunluk-GunlukYarisSonuclari|GunlukYarisSonuclari/i.test(raw)
    || (/YARI[ŞS]\s*SONU[ÇC]LAR[İI]/.test(hay) && /kosubilgisi-/i.test(raw));
}
function tkpLooksLikeAccurateFileName(f){
  return /ACCURATE|SUMMARY|ARA[ _-]*DERECE|ORTALAMA[ _-]*HIZ/i.test(String(f?.name||'')+' '+String(f?.webkitRelativePath||''));
}

function parseResultHtmlPayloadCandidates(text, filename){
  const candidates=[];
  const addCandidate=(payload)=>{ if(payload && Array.isArray(payload.races) && payload.races.length) candidates.push(payload); };

  // 1) TJK Yarış Sonuçları: resmi sonuç HTML. Çift altılı günlerde 1. ve 2. altılı ayrı denenir.
  if(/gunluk-GunlukYarisSonuclari/i.test(text)){
    for(const no of [1,2]){ try{ addCandidate(parseTjkResultsHTML(text,filename,no)); }catch(_e){} }
  }

  // 2) TJK Yarış Programı sayfası sonuçlandıktan sonra da derece bilgisini aynı sayfada
  // taşıyabiliyor. Sonuç yükleme alanına bu sayfa verilirse de mevcut kaydı güncelleyebilsin.
  if(/gunluk-GunlukYarisProgrami-AtAdi/i.test(text)){
    for(const no of [1,2]){ try{ addCandidate(parseTjkProgramHTML(text,filename,no)); }catch(_e){} }
  }

  return candidates;
}


async function tkpReadResultPayloadFromFile(f){
  if(!f) return null;
  const name=String(f.name||'');
  let p=null;
  if(/\.ods$/i.test(name)){
    const xml=await unzipEntry(await tkpReadFileArrayBuffer(f),'content.xml');
    p=parseODSxml(xml,name);
    p.file.import_kind='RESULT_ODS';
  } else if(/\.html?$/i.test(name)){
    const text=await tkpReadFileText(f);
    const candidates=parseResultHtmlPayloadCandidates(text,name);
    if(!candidates.length) return null;
    p=selectBestResultPayload(candidates);
    p.file.import_kind='RESULT_HTML';
  }
  if(!p || !Array.isArray(p.races) || !p.races.length) return null;
  p.file.sequence_no=p.file.sequence_no||((typeof tkpMaxSequenceNo==='function'?tkpMaxSequenceNo():db.files.reduce((m,x)=>Math.max(m,Number(x?.sequence_no)||0),0))+1);
  p.races.forEach(r=>{r.sequence_no=p.file.sequence_no;});
  return p;
}

function tkpIsoDateFromLooseText(txt){
  const raw=String(txt||'');
  let m=raw.match(/(20\d{2})[-_. ]?(0?[1-9]|1[0-2])[-_. ]?(0?[1-9]|[12]\d|3[01])/);
  if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m=raw.match(/(0?[1-9]|[12]\d|3[01])[-_. ](0?[1-9]|1[0-2])[-_. ](20\d{2})/);
  if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  return '';
}
function tkpHipFromLooseText(txt){
  const f=fold(txt||'');
  const hips=['ADANA','ANKARA','ANTALYA','BURSA','DIYARBAKIR','ELAZIG','ISTANBUL','IZMIR','IZMIT','KOCAELI','SANLIURFA','DEL MAR','DELMAR','SARATOGA','SANTA ANITA','GULFSTREAM PARK','KEENELAND','PARX RACING','DELAWARE PARK','HORSESHOE INDIANAPOLIS','FINGER LAKES','WOODBINE','CLUB HIPICO SANTIAGO'];
  const found=hips.find(h=>f.includes(fold(h)));
  if(!found) return '';
  return canonicalHippodrome(found==='DELMAR'?'DEL MAR':found);
}
function tkpRaceNoFromAccurateName(txt){
  const raw=String(txt||'');
  let m=raw.match(/(?:^|[_\- ])R(0?[1-9]|1\d|2\d)(?:[_\-. ]|$)/i)
    || raw.match(/(?:^|[^0-9])([1-9]|1\d|2\d)\s*[-_. ]*summary\b/i)
    || raw.match(/(?:^|[^0-9])([1-9]|1\d|2\d)\s*\.\s*(?:koşu|kosu)\b/i)
    || raw.match(/(?:koşu|kosu|race|run)\s*[-_. ]*([1-9]|1\d|2\d)/i)
    || raw.match(/[-_ ]([1-9]|1\d|2\d)[-_ ]/);
  return m ? Number(m[1]) : null;
}
function tkpAccurateMetaFromFileName(f){
  const path=String(f?.webkitRelativePath||f?.name||'');
  return {date:tkpIsoDateFromLooseText(path), hip:tkpHipFromLooseText(path), raceNo:tkpRaceNoFromAccurateName(path), source:String(f?.name||'')};
}
function tkpFindRaceForAccurateMeta(meta){
  if(!meta || !meta.date || !meta.hip || !meta.raceNo) return null;
  const races=typeof tkpRacesByDateHip==='function'?tkpRacesByDateHip(meta.date,meta.hip):db.races.filter(r => String(r.race_date||'')===meta.date && canonicalHippodrome(r.hippodrome||'')===meta.hip);
  if(!races.length) return null;
  return races.find(r=>Number(r._absRaceNo)===Number(meta.raceNo))
    || races.find(r=>Number(r.leg)===Number(meta.raceNo))
    || null;
}

// KÖK ACCURATE FIX: accurace.net'ten "Kaydet" ile indirilen dosyalar tarayıcı tarafından
// "Network_-_Accurace_net_html-1.html" gibi genel/aynı isimle kaydediliyor -- dosya adında
// ne tarih, ne hipodrom, ne de koşu numarası geçiyor. tkpFindRaceForAccurateMeta bu yüzden
// HER ZAMAN null dönüyor ve tüm dosyalar "atlandı" oluyordu (Accurate eşleşen koşu: 0).
// Çözüm: dosya adı meta'sı bulunamazsa, dosyanın İÇİNDEKİ at isimleri/numaraları ile mevcut
// yarışların atları karşılaştırılıp İÇERİK bazlı eşleştirme yapılır; o da olmazsa (aynı
// klasörde dosya sayısı kadar boş ayak varsa) dosyalar KAYDEDİLDİKLERİ SIRAYLA ayaklara atanır
// -- accurace.net'te aynı toplantının koşuları sırayla kaydedildiğinde bu sıralama zaten
// 1. ayak, 2. ayak... ile birebir örtüşüyor.
function tkpAccurateHorseOverlapScore(entries, race){
  if(!Array.isArray(entries) || !entries.length || !race || !Array.isArray(race.horses)) return 0;
  const nos=new Set((race.horses||[]).map(h=>String(ekuriBase(h.horse_no))));
  const names=new Set((race.horses||[]).map(h=>baseHorseName(h.horse_name)));
  let score=0;
  for(const e of entries){
    if(e.no!=null && nos.has(String(ekuriBase(e.no)))) score+=2;
    else if(e.name && names.has(baseHorseName(e.name))) score+=1;
  }
  return score;
}
function tkpFindRaceForAccurateEntries(entries, excludeIds){
  if(!Array.isArray(entries) || !entries.length) return null;
  const excl=excludeIds||new Set();
  const candidates=orderedActiveRaces().filter(r=>!excl.has(r.id));
  if(!candidates.length) return null;
  let best=null, bestScore=0;
  for(const r of candidates){
    const s=tkpAccurateHorseOverlapScore(entries, r);
    if(s>bestScore){ bestScore=s; best=r; }
  }
  // En az yarısı + en az 3 at eşleşmeli; zayıf/rastgele eşleşme yanlış ayağa veri yazmasın.
  const minNeeded=Math.max(3, Math.ceil(entries.length*0.5));
  return (best && bestScore>=minNeeded) ? best : null;
}

function tkpAccurateIsComplete(race){
  const runners=(race?.horses||[]).filter(h=>!isNonRunner(h));
  if(!runners.length) return false;
  return runners.every(h=>Number(h.accurate_avg_speed_mps)>0 || Number(h.accurate_finish_time_sec)>0);
}

function tkpApplyAccurateFileToRace(f, targetRace, entries){
  if(!targetRace) return {matched:0};
  let matched=0;
  if(Array.isArray(entries) && entries.length){
    const byNo=new Map((targetRace.horses||[]).map(h=>[String(ekuriBase(h.horse_no)),h]));
    const byName=new Map((targetRace.horses||[]).map(h=>[baseHorseName(h.horse_name),h]));
    for(const e of entries){
      const h=(e.no!=null?byNo.get(String(ekuriBase(e.no))):null) || (e.name?byName.get(baseHorseName(e.name)):null);
      if(!h) continue;
      if(e.overallAvgKmh!=null || e.segAvgKmh!=null){
        // accurace.net "network-table" formatı: gerçek GPS/sektör verisi.
        h.accurate_times=e.rawTimes||h.accurate_times||[];
        if(Number.isFinite(e.overallAvgKmh) && e.overallAvgKmh>0) h.accurate_avg_speed_mps=e.overallAvgKmh/3.6;
        if(Number.isFinite(e.overallMaxKmh) && e.overallMaxKmh>0) h.accurate_max_speed_mps=e.overallMaxKmh/3.6;
        if(Number.isFinite(e.segAvgKmh) && e.segAvgKmh>0) h.accurate_closing_speed_mps=e.segAvgKmh/3.6;
        // "Kapanış/bitiriş gücü" sinyali: bu dosyadaki son bölüm (seçili bölüm) hızına göre
        // ATIN KENDİ İÇİNDEKİ sırası (accurace.net satırları zaten bu hıza göre sıralı geliyor).
        // Fark/Delta kolonlarının tam tanımı doğrulanamadığından skora karıştırılmadı; ham
        // değerleri accurate_fark / accurate_delta alanlarında saklanır (ileride kullanılabilir).
        if(Number.isFinite(e.finishSignal)) h.accurate_finish_signal=e.finishSignal;
        if(e.fark!=null) h.accurate_fark=e.fark;
        if(e.delta!=null) h.accurate_delta=e.delta;
      } else {
        // Eski/serbest metin formatı (satır başına at no/adı + zaman damgaları).
        h.accurate_times=e.times||h.accurate_times||[];
        const lastTime=(e.times&&e.times.length)?tkpParseRaceTimeSeconds(e.times[e.times.length-1]):null;
        const raceDist=Number(targetRace.distance)||0;
        if(Number.isFinite(lastTime) && lastTime>0 && raceDist>0){
          h.accurate_finish_time_sec=lastTime;
          h.accurate_avg_speed_mps=raceDist/lastTime;
        }
        if(Number.isFinite(e.finishSignal)) h.accurate_finish_signal=e.finishSignal;
        if(Number.isFinite(e.tempoSignal)) h.accurate_tempo_signal=e.tempoSignal;
      }
      matched++;
    }
  }
  if(matched){
    targetRace.accurate_sources=Array.isArray(targetRace.accurate_sources)?targetRace.accurate_sources:[];
    const src=String(f?.name||'Accurate');
    if(!targetRace.accurate_sources.includes(src)) targetRace.accurate_sources.push(src);
    targetRace.accurate_imported_at=new Date().toISOString();
    normalizeRaceObj(targetRace);
  }
  return {matched};
}

// V1.1.322 HIZ: tkpFindStoredRaceForTrRecord her kayıt (record) için db.races
// üzerinde tam arşiv taraması yapıyordu; aynı TR PUAN dosyasındaki kayıtlar
// (ayak/koşu no dışında) neredeyse hep aynı tarih+hipodroma ait olduğundan bu
// tarama dosya başına ~6 kez birebir tekrarlanıyordu. Aşağıdaki cache, ISO
// tarih + kanonik hipodrom bazında ÖN filtreyi bir kez hesaplayıp saklar --
// eski karışık tarih formatı (30.07.2026 / 30/07/2026 / 2026-07-30) normalize
// edici mantığı AYNEN korunur (hazır tkpRacesByDateHip indeksine bilerek
// geçilmedi; o ham string eşleşmesi yapıyor ve eski format kayıtları kaçırabilir).
// db değiştiğinde (yeni import/silme) imza değişir, cache otomatik sıfırlanır.
let _trRecordDateHipCache={sig:'',map:new Map()};
function tkpTrRecordCandidatesForDateHip(metaIsoDate,metaHip){
  const sig=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${db?.races?.length||0}`;
  if(_trRecordDateHipCache.sig!==sig){_trRecordDateHipCache={sig,map:new Map()};}
  const hipKey=metaHip?canonicalHippodrome(metaHip):'';
  const cacheKey=`${metaIsoDate||''}|${hipKey}`;
  if(_trRecordDateHipCache.map.has(cacheKey))return _trRecordDateHipCache.map.get(cacheKey);
  let candidates=(db.races||[]);
  if(metaIsoDate) candidates=candidates.filter(r=>{
    const raceIsoDate=tkpIsoDateFromLooseText(r.race_date||'')||String(r.race_date||'');
    return raceIsoDate===metaIsoDate;
  });
  if(hipKey) candidates=candidates.filter(r=>canonicalHippodrome(r.hippodrome||'')===hipKey);
  _trRecordDateHipCache.map.set(cacheKey,candidates);
  return candidates;
}
function tkpFindStoredRaceForTrRecord(file,record,excludeIds){
  const excluded=excludeIds||new Set();
  const fileMeta=tkpAccurateMetaFromFileName(file);
  const meta={
    date: record?.date || fileMeta.date || null,
    hip: record?.hip || fileMeta.hip || null,
    raceNo: Number(record?.raceNo)||fileMeta.raceNo||null,
    source:fileMeta.source
  };
  const metaIsoDate=meta.date ? (tkpIsoDateFromLooseText(meta.date)||String(meta.date)) : '';
  let candidates=tkpTrRecordCandidatesForDateHip(metaIsoDate,meta.hip).filter(r=>!excluded.has(r.id));
  // GC'nin kendi JSON metası bazen şehir/tarih biçimini farklı döndürüyor. Bu
  // durumda boş aday havuzu "TR yok" demek değildir; aynı DB içindeki yarışlar
  // at adı + görünür no + mutlak koşu numarasıyla yeniden doğrulanır. Kanıt yoksa
  // yine asla yazılmaz.
  if(!candidates.length)candidates=(db.races||[]).filter(r=>!excluded.has(r.id));
  let best=null,bestScore=-1,bestHits=0,bestNameHits=0,bestNoHits=0,bestExactAbs=false;
  for(const race of candidates){
    const byNo=new Set((race.horses||[]).map(h=>String(ekuriBase(h.horse_no))));
    const byName=new Set((race.horses||[]).map(h=>baseHorseName(h.horse_name)));
    let score=0,hits=0,nameHits=0,noHits=0;
    for(const row of (record?.rows||[])){
      const nameHit=row.name&&byName.has(baseHorseName(row.name));
      const noHit=row.no!=null&&byNo.has(String(ekuriBase(row.no)));
      if(nameHit){score+=20;hits++;nameHits++;}
      else if(noHit){score+=2;hits++;noHits++;}
    }
    const exactAbs=Number(race._absRaceNo||race.leg)===Number(record?.raceNo);
    if(exactAbs)score+=5;
    if(score>bestScore){bestScore=score;bestHits=hits;bestNameHits=nameHits;bestNoHits=noHits;bestExactAbs=exactAbs;best=race;}
  }
  const rowCount=(record?.rows||[]).length;
  const requiredNames=Math.max(2,Math.ceil(rowCount*.25));
  const requiredNos=Math.max(3,Math.ceil(rowCount*.60));
  const identityConfirmed=bestNameHits>=requiredNames || (bestExactAbs&&bestNoHits>=requiredNos);
  // Meta tam eşleşse bile tek adayın körlemesine seçilmesi eski hatanın ikinci
  // yoluydu; P satırları gerçekten o ayakla örtüşmüyorsa katman boş kalmalıdır.
  return best&&identityConfirmed?best:null;
}

function tkpApplyTrPuanRowsToRace(record,targetRace){
  if(!targetRace) return {matched:0,changed:0};
  const byNo=new Map((targetRace.horses||[]).map(h=>[String(ekuriBase(h.horse_no)),h]));
  const byName=new Map((targetRace.horses||[]).map(h=>[baseHorseName(h.horse_name),h]));
  const asof=(typeof tkpIsoDateFromLooseText==='function'?(tkpIsoDateFromLooseText(record?.date||targetRace?.race_date||'')||String(record?.date||targetRace?.race_date||'')):String(record?.date||targetRace?.race_date||''));
  let matched=0,changed=0;
  for(const row of (record?.rows||[])){
    const keyName=row.name?baseHorseName(row.name):'';
    // Ganyan Canavarı p_atno dahili kimlik olabildiğinden isim birinci anahtardır.
    // İsim yoksa/uyuşmazsa görünür at numarası yedeği kullanılır.
    const horse=(keyName?byName.get(keyName):null) || (row.no!=null?byNo.get(String(ekuriBase(row.no))):null);
    if(!horse) continue;
    matched++;
    if(Number.isFinite(Number(row.tr))){
      let horseChanged=false;
      if(Number(horse.tr_ganyan)!==Number(row.tr)){horse.tr_ganyan=Number(row.tr);horseChanged=true;}
      if(Number(horse.tr_puan)!==Number(row.tr)){horse.tr_puan=Number(row.tr);horseChanged=true;}
      if(horse.tr_ganyan_source!=='GANYAN_CANAVARI_TR'){horse.tr_ganyan_source='GANYAN_CANAVARI_TR';horseChanged=true;}
      if(horse.tr_ganyan_metric!=='GANYAN_CANAVARI_PROGRAM_P_COLUMN'){horse.tr_ganyan_metric='GANYAN_CANAVARI_PROGRAM_P_COLUMN';horseChanged=true;}
      if(String(horse.tr_ganyan_asof_date||'')!==asof){horse.tr_ganyan_asof_date=asof;horseChanged=true;}
      if(horseChanged)changed++;
    }
  }
  if(matched){
    targetRace.support_layers={
      ...(targetRace.support_layers||{}),
      tr:{complete:true,source:'GANYAN_CANAVARI_TR',metric:'GANYAN_CANAVARI_PROGRAM_P_COLUMN',asof}
    };
  }
  return {matched,changed};
}
function tkpLiveRaceForTrRecord(record,targetRace,pool){
  const races=Array.isArray(pool)?pool:[];
  if(!races.length)return null;
  const targetAbs=Number(record?.raceNo||targetRace?._absRaceNo||targetRace?.leg);
  const targetDate=tkpIsoDateFromLooseText(record?.date||targetRace?.race_date||'')||'';
  const targetHip=canonicalHippodrome(record?.hip||targetRace?.hippodrome||'');
  return races.find(r=>Number(r._absRaceNo||r.leg)===targetAbs
    && (!targetDate||(tkpIsoDateFromLooseText(r.race_date||'')||'')===targetDate)
    && (!targetHip||canonicalHippodrome(r.hippodrome||'')===targetHip))
    || races.find(r=>Number(r._absRaceNo||r.leg)===targetAbs)
    || null;
}
function tkpSyncTrPuanRecordToLiveState(record,targetRace){
  const pools=[];
  try{if(Array.isArray(window.__lastPredictionPayload?.races))pools.push(window.__lastPredictionPayload.races);}catch(_e){}
  try{if(typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults))pools.push(lastRaceResults);}catch(_e){}
  const seen=new Set();let matched=0,changed=0;
  for(const pool of pools){
    const race=tkpLiveRaceForTrRecord(record,targetRace,pool);
    if(!race||seen.has(race))continue;seen.add(race);
    const res=tkpApplyTrPuanRowsToRace(record,race);matched=Math.max(matched,res.matched);changed+=res.changed;
    normalizeRaceObj(race);
  }
  return {matched,changed};
}
function tkpApplyTrPuanRecordToStoredRace(file,record,targetRace){
  if(!targetRace) return {matched:0,changed:0};
  const res=tkpApplyTrPuanRowsToRace(record,targetRace);
  if(res.matched){
    targetRace.tr_puan_sources=Array.isArray(targetRace.tr_puan_sources)?targetRace.tr_puan_sources:[];
    const source=String(file?.name||'Ganyan Canavarı TR PUAN');
    if(!targetRace.tr_puan_sources.includes(source)) targetRace.tr_puan_sources.push(source);
    targetRace.tr_puan_imported_at=new Date().toISOString();
    normalizeRaceObj(targetRace);
    tkpSyncTrPuanRecordToLiveState(record,targetRace);
  }
  return res;
}

// accurace.net "Network" sayfasının kaydedilmiş HTML'i: veri <table class="network-table__content">
// içinde, her satır bir at. İlk hücre at no+adı (div.horse-btn + div.horse-name), sonraki hücreler
// "Seçili Bölüm" (son analiz edilen bölüm: süre/mesafe/bariyer uzaklığı/ortalama hız) ve "Seçili
// Bölüm Sonu" (bölümden bitişe: süre/maksimum hız/ortalama hız/mesafe/delta/fark) gruplarıdır.
// Satırlar siteden zaten "Seçili Bölüm" ortalama hızına göre (en hızlı kapanış ilk sırada) sıralı
// geliyor; bu doğal sıralama "kapanış gücü" sinyali için kullanılıyor.
function tkpParseAccurateHTMLTable(html){
  const doc=new DOMParser().parseFromString(String(html||''),'text/html');
  const table=doc.querySelector('table.network-table__content') || doc.querySelector('table');
  if(!table) return null;
  const rows=[...table.querySelectorAll('tbody tr')];
  if(!rows.length) return null;
  const toNum=(s)=>{ const v=String(s||'').trim().replace(/\s/g,'').replace(',', '.'); const n=Number(v); return Number.isFinite(n)?n:null; };
  const entries=[];
  rows.forEach((tr,idx)=>{
    const tds=[...tr.querySelectorAll('td')];
    if(tds.length<9) return;
    const noEl=tds[0].querySelector('.horse-btn');
    const nameEl=tds[0].querySelector('.horse-name');
    const no=noEl?norm(noEl.textContent||''):(tds[0].textContent.match(/^\s*(\d{1,2})/)?.[1]||null);
    const name=nameEl?norm(nameEl.textContent||''):norm(tds[0].textContent||'').replace(/^\d+/,'');
    if(!no && !name) return;
    const cellText=(i)=>norm(tds[i]?.textContent||'');
    entries.push({
      no, name,
      segTimeRaw:cellText(1), segDistM:toNum(cellText(2)), segBarrierM:toNum(cellText(3)), segAvgKmh:toNum(cellText(4)),
      overallTimeRaw:cellText(6), overallMaxKmh:toNum(cellText(7)), overallAvgKmh:toNum(cellText(8)),
      overallDistM:toNum(cellText(9)), delta:cellText(10)==='-'?null:toNum(cellText(10)), fark:cellText(11)==='-'?null:toNum(cellText(11)),
      rawTimes:[cellText(1),cellText(6)].filter(Boolean),
      rank: idx
    });
  });
  if(!entries.length) return null;
  // Kapanış gücü sinyali: siteden gelen doğal sırayı (en hızlı seçili bölüm ilk) 1..0 arası
  // normalize eder. Aynı dosyada tek at varsa sinyal üretilmez (kıyas mümkün değil).
  if(entries.length>=2){
    const n=entries.length;
    entries.forEach((e,i)=>{ e.finishSignal = (n>1) ? (n-1-i)/(n-1) : 0; });
  }
  return entries;
}
function tkpParseAccurateEntriesFromText(text){
  const raw=String(text||'');
  if(/<table[\s\S]*?<\/table>/i.test(raw) || /network-table/i.test(raw)){
    const parsed=tkpParseAccurateHTMLTable(raw);
    if(parsed && parsed.length) return parsed;
  }
  // Eski/serbest metin formatı: satır başına at no/adı + birden çok zaman damgası (MM:SS gibi).
  const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const entries=[];
  for(const line of lines){
    const times=[...line.matchAll(/\b\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\b/g)].map(m=>m[0]);
    if(times.length<2) continue;
    const noM=line.match(/^\s*(\d{1,2})(?:\s+|[-.])/);
    const no=noM?noM[1]:null;
    const namePart=line.replace(/^\s*\d{1,2}\s+/, '').split(/\b\d{1,2}[:.]\d{2}/)[0].trim();
    entries.push({no, name:namePart, times});
  }
  if(entries.length>=2){
    const finishSecs=entries.map(e=>tkpParseRaceTimeSeconds(e.times[e.times.length-1])).filter(Number.isFinite);
    const midSecs=entries.map(e=>tkpParseRaceTimeSeconds(e.times[Math.max(0,Math.floor(e.times.length/2)-1)])).filter(Number.isFinite);
    const minF=Math.min(...finishSecs), maxF=Math.max(...finishSecs);
    const minM=Math.min(...midSecs), maxM=Math.max(...midSecs);
    entries.forEach(e=>{
      const f=tkpParseRaceTimeSeconds(e.times[e.times.length-1]);
      const m=tkpParseRaceTimeSeconds(e.times[Math.max(0,Math.floor(e.times.length/2)-1)]);
      e.finishSignal=(Number.isFinite(f)&&maxF>minF)?(maxF-f)/(maxF-minF):0;
      e.tempoSignal=(Number.isFinite(m)&&maxM>minM)?(maxM-m)/(maxM-minM):0;
    });
  }
  return entries;
}

function markPredictionFileResultState(fileRecord, payload){
  if(!fileRecord) return [];
  const rows=confirmedResultRacesForFile(fileRecord.id);
  if(!rows.length) return [];
  const fileRaces=typeof tkpRowsByFileId==='function'?tkpRowsByFileId(fileRecord.id):db.races.filter(r=>r.file_id===fileRecord.id);
  const full=fileRaces.length===6 && fileRaces.every(r=>resultRaceQuality(r).complete);
  fileRecord.has_confirmed_results=1;
  fileRecord.qc_status=full?'SONUÇLAR GÜNCELLENDİ':'SONUÇ KISMİ GÜNCELLENDİ';
  fileRecord.result_updated_at=fileRecord.result_updated_at||new Date().toISOString();
  resolvePredictionLogWithRaces(rows);
  setCurrentRules([]); setRulesDirty(true);
  return rows;
}

// V1.1.158 — PRE-RACE FIELD OWNERSHIP GUARD
// Program / Son AGF / manuel pre-race importlar resmi sonuç alanlarının sahibi DEĞİLDİR.
// Bu guard sayesinde yanlış/sapmış bir HTML parser sonucu winner/finish/payout üretse bile
// mevcut resmi sonuç korunur; resmi sonuç yoksa sahte sonuç aktif kayda giremez.
const TKP_RESULT_OWNED_HORSE_FIELDS = [
  'finish_position','winner','result_time','official_time','official_position',
  'result_position','finishPos','resultTime','last_result_time','tjk_result'
];
const TKP_RESULT_OWNED_RACE_FIELDS = ['payouts'];
function tkpApplyPreRaceHorseOwnership(incoming, oldHorse){
  if(!incoming || typeof incoming!=='object') return incoming;
  for(const field of TKP_RESULT_OWNED_HORSE_FIELDS){
    if(oldHorse && oldHorse[field]!=null){
      incoming[field]=JSON.parse(JSON.stringify(oldHorse[field]));
    }else if(field==='winner'){
      incoming[field]=0;
    }else{
      incoming[field]=null;
    }
  }
  // winner daima korunmuş bitiriş ile tutarlı olsun.
  if(incoming.finish_position!=null) incoming.winner=Number(incoming.finish_position)===1?1:0;
  return incoming;
}
function tkpApplyPreRaceRaceOwnership(incomingRace, oldRace){
  if(!incomingRace || typeof incomingRace!=='object') return incomingRace;
  for(const field of TKP_RESULT_OWNED_RACE_FIELDS){
    if(oldRace && oldRace[field]!=null) incomingRace[field]=JSON.parse(JSON.stringify(oldRace[field]));
    else incomingRace[field]=[];
  }
  return incomingRace;
}

function storePredictionQcRaces(fileRecord, payload, preserveEnrichment=false){
  if(!fileRecord || !payload || !Array.isArray(payload.races)) return [];
  // Tahmin/QC yarışları ODS indirebilmek ve Düzelt ekranında eksik veri tamamlayabilmek
  // için saklanır. active=0 olduğundan geçmiş öğrenme verisine katılmaz.
  //
  // "Son AGF Yükle" (preserveEnrichment=true) SADECE bülteni tek başına yeniden okur --
  // galop/J-BYG/YPUAN dosyaları o yüklemede yoktur. Eskiden bu durumda kayıt tamamen
  // silinip taze (galop/YPUAN'sız) veriyle değiştiriliyordu; bu da daha önce ayrıca
  // yüklenmiş galop/YPUAN verisini sessizce sıfırlıyordu. Şimdi bu durumda, eski
  // kayıttaki her at için g800/jbyg/ypuan/value_score/s_value/sp alanları -- yeni
  // veride bu alanlar zaten boş olduğundan -- at numarasına göre eşleştirilip
  // korunuyor; sadece AGF/TR/HNDKP gibi bültenden gelen alanlar güncelleniyor.
  // ÖNEMLİ DÜZELTME: eşleştirme tam "5-E1" gibi eküri ekli horse_no ile değil, SADECE
  // ana at numarasıyla (ekuriBase) yapılır. Sabah alınan bültenle yarışa yakın alınan
  // "Son AGF" bülteni arasında bir eküri ortağı çekilirse (çok sık olur), aynı atın
  // eküri eki değişebilir (ör. "5-E1" -> "5") -- tam string eşleşmesi bu durumda
  // sessizce kopuyor ve YPUAN/400G/J-BYG gibi zenginleştirme alanları kayboluyordu.
  // ÖNEMLİ DÜZELTME 2: eski veri artık SADECE bu dosya kaydına (file_id) bağlı
  // koşularla sınırlı aranmıyor. "Son AGF" yüklemesi her nasılsa (ör. tarih/hipodrom
  // ayrıştırmasında ufak bir fark, ya da başka bir akış) farklı/yeni bir dosya
  // kaydına düşerse, eski file_id'ye bakan arama HİÇBİR şey bulamıyor ve TÜM
  // atların YPUAN'ı (sadece eküri değişenlerin değil) sessizce siliniyordu. Şimdi
  // aynı YARIŞ TARİHİ + aynı HİPODROM'daki bütün eski koşular taranıyor, hangi
  // dosya kaydına bağlı olursa olsun -- bu çok daha güvenli bir eşleştirme.
  // ÖNEMLİ DÜZELTME 3: finish_position/winner (gerçek yarış sonucu, "🏁 Sonuç HTML
  // Güncelle" ile ayrıca işlenir) de artık korunuyor. Bu olmadan, "Sonuç HTML
  // Güncelle" ile sonuç işlendikten SONRA kullanıcı Program dosyasını tekrar
  // görüntüler/seçerse (Manuel ODS veya Klasör Ekle üzerinden #predictionFile ya
  // da #bulletinFile'ın onchange'i her ikisi de bu fonksiyonu tekrar çağırır),
  // Program içe aktarımı artık (V21.28) HİÇBİR ZAMAN sonuç taşımadığı için
  // az önce kaydedilen gerçek sonuçlar SESSİZCE SİLİNİYORDU.
  const ENRICHMENT_FIELDS = [
    // Yalnız gerçek dosya/zenginleştirme alanları korunur. TKP skor/cache alanları
    // korunmaz; eski yarış çağrıldığında güncel model tarafından yeniden hesaplanır.
    // Tarihsel destek katmanları bir bütün olarak korunur: değer/rank ile kaynak ve
    // as-of alanlarından biri kaybolursa normalizeRaceObj güvenlik gereği sinyali
    // geçersiz sayar. Bu nedenle Son AGF yenilemesinde üçlü birlikte taşınır.
    'tr_ganyan','tr_puan','tr_ganyan_source','tr_source','tr_ganyan_metric','tr_ganyan_asof_date','tr_asof_date',
    'g800','g800_rank','galop_rank','glp_rank','workout_800','glp_raw','glp_source','glp_asof_date',
    'jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank','jbyg_rate','team_strength_pct','jbyg_source','jbyg_asof_date',
    'ypuan','value_score','s_value','sp','finish_position',
    'winner','result_time','official_time','start_no','start_no_source',
    'accurate_times','accurate_avg_speed_mps','accurate_max_speed_mps','accurate_closing_speed_mps',
    'accurate_finish_time_sec','accurate_finish_signal','accurate_tempo_signal','accurate_fark','accurate_delta',
    'atr_source','atr_or','atr_form','atr_form_score','atr_comment','atr_comment_score','atr_non_runner','atr_race_no','atr_date',
    'foreign_sources','foreign_official_confirmed','foreign_source_count','foreign_context_score','foreign_rating','usa_source_nyra','usa_live_odds','usa_morning_line','usa_live_prob','usa_ml_prob','usa_jockey','usa_trainer','usa_weight_lb','usa_expert_score','usa_scratched','usa_work_rank','usa_work_total','usa_work_score','usa_equibase_confirmed','chi_source_clubhipico','chi_official_confirmed',
    'prediction_score_snapshot','prediction_score_parts_snapshot','prediction_why_snapshot',
    'prediction_best_lb_snapshot','prediction_score_snapshot_at','prediction_score_model_version','prediction_score_locked','prediction_order_snapshot',
    // V1.1.180 davranışı: Sonuç/AGF yeniden işleme sonrası yarış öncesi X shadow kanıtı kaybolmamalı.
    // Bu alanlar yalnız arşiv/görüntüleme için korunur; kupon ve TEK bayrakları uygulanmaz.
    'x_base_ypuan','x_base_score','x_base_rank','x_ypuan_delta','x_tkp_score_delta',
    'x_final_ypuan','x_final_tkp_score','x_final_rank','x_kulis_score','x_kulis_direction',
    'x_kulis_comments','x_kulis_applied','x_force_coupon','x_break_single',
    'x_kulis_schema_version','x_kulis_captured_at','x_kulis_race_start_at'
  ];
  const RACE_LAYER_FIELDS=['payouts','available_bets','accurate_sources','accurate_imported_at','tr_puan_sources','tr_puan_imported_at','support_layers'];
  const HISTORICAL_SUPPORT_GROUPS=[
    {source:'tr_ganyan_source',trusted:/^GANYAN_CANAVARI_TR$/i,fields:['tr_ganyan','tr_puan','tr_ganyan_source','tr_source','tr_ganyan_metric','tr_ganyan_asof_date','tr_asof_date']},
    {source:'glp_source',trusted:/^GANYAN_CANAVARI_(?:GALOPLAR_)?OZET$/i,liveTrusted:/^TJK_PROGRAM_GALOP$/i,fields:['g800','g800_rank','galop_rank','glp_rank','workout_800','glp_raw','glp_source','glp_asof_date']},
    {source:'jbyg_source',trusted:/^GANYAN_CANAVARI_JBYG$/i,liveTrusted:/^TJK_PROGRAM_JBYG$/i,fields:['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank','jbyg_rate','team_strength_pct','jbyg_source','jbyg_asof_date']}
  ];
  const HISTORICAL_SUPPORT_FIELDS=new Set(HISTORICAL_SUPPORT_GROUPS.reduce((fields,group)=>fields.concat(group.fields),[]));
  const enrichmentValueFilled = v => Array.isArray(v) ? v.length>0 : (v && typeof v==='object' ? Object.keys(v).length>0 : v!=null);
  const enrichmentScore = h => ENRICHMENT_FIELDS.reduce((s,f)=>s+(enrichmentValueFilled(h?.[f])?1:0),0);
  const raceLayerScore = race => RACE_LAYER_FIELDS.reduce((score,field)=>{
    const value=race?.[field];
    if(field==='support_layers'&&value&&typeof value==='object')return score+Object.keys(value).length;
    return score+(enrichmentValueFilled(value)?1:0);
  },0);
  let oldByLegAndHorse = null;
  let oldByLegAndHorseBase = null;
  let oldRaceByKey = null;
  if (preserveEnrichment){
    // KÖK ÇÖZÜM (eküri veri sızıntısı): Önceden bu harita yalnız ekuriBase(horse_no)
    // (eküri eki "-E1"/"-E2" SİLİNMİŞ) ile kuruluyordu. Aynı eküri grubundaki iki farklı
    // at (ör. "3-E1" ve "3-E2") aynı anahtara düşüyor, hangi ortağın enrichmentScore'u
    // yüksekse o diğerinin de best_time/weight_kg/agf/finish_position değerini
    // "miras" olarak veriyordu -- dereceye hiç girmeyen eküri ortağı, koşan ortağın
    // derecesini/sonucunu üstleniyordu. Artık ÖNCE tam horse_no (eküri eki dahil)
    // ile birebir eşleşme aranır (oldByLegAndHorse). Yalnız gerçek eküri olmayan
    // (o ana numarada tek at bulunan) durumlarda ekuriBase fallback'i (oldByLegAndHorseBase)
    // devreye girer; grup gerçekten belirsizse (2+ farklı at aynı ana numarada) fallback
    // hiç kullanılmaz -- yanlış ortağa kopyalamaktansa alan boş kalması tercih edilir.
    oldByLegAndHorse = new Map(); // "leg|TAM_at_no" ve "ABS:gercek_kosu|TAM_at_no" -> eski at objesi
    oldByLegAndHorseBase = new Map(); // "leg|ana_at_no" -> {horse, ambiguous} (yalnız tekil eşleşmede kullanılır)
    oldRaceByKey = new Map();
    const targetDate = String(fileRecord.race_date||'');
    const targetHip = canonicalHippodrome(fileRecord.hippodrome||'');
    const targetAlt = Number(fileRecord.altili_no)||1;
    // 16. HIZ: eski kod her koşu için db.files.find() yapıyordu. Arşiv büyüdükçe
    // O(races×files) olan aktarım, tek O(files) haritasıyla O(races)'e iner.
    const fileById=new Map((db.files||[]).map(f=>[String(f.id),f]));
    for (const oldRace of db.races){
      if (String(oldRace.race_date||'') !== targetDate) continue;
      if (canonicalHippodrome(oldRace.hippodrome||'') !== targetHip) continue;
      const oldFile=fileById.get(String(oldRace.file_id));
      const oldAlt=Number(oldRace.altili_no)||Number(oldFile?.altili_no)||1;
      if(oldAlt!==targetAlt) continue;
      const raceKeys=[`LEG:${oldRace.leg}`];
      if(oldRace._absRaceNo!=null) raceKeys.unshift(`ABS:${oldRace._absRaceNo}`);
      for(const raceKey of raceKeys){
        const existingRace=oldRaceByKey.get(raceKey);
        const oldLayerScore=raceLayerScore(oldRace);
        const existingLayerScore=raceLayerScore(existingRace);
        if(!existingRace || oldLayerScore>existingLayerScore) oldRaceByKey.set(raceKey,oldRace);
      }
      for (const h of (oldRace.horses||[])){
        const fullNo = String(h.horse_no||'').trim();
        const baseNo = ekuriBase(fullNo);
        const exactKeys = [`${oldRace.leg}|${fullNo}`];
        if(oldRace._absRaceNo!=null) exactKeys.push(`ABS:${oldRace._absRaceNo}|${fullNo}`);
        // Aynı anahtar birden fazla eski koşuda geçebilir (mükerrer/duplicate
        // kayıt); zenginleştirme alanı DOLU olan öncelik kazanır, boş üzerine yazmaz.
        for(const key of exactKeys){
          const existing = oldByLegAndHorse.get(key);
          if (!existing || enrichmentScore(h)>enrichmentScore(existing)){
            oldByLegAndHorse.set(key, h);
          }
        }
        const baseKeys = [`${oldRace.leg}|${baseNo}`];
        if(oldRace._absRaceNo!=null) baseKeys.push(`ABS:${oldRace._absRaceNo}|${baseNo}`);
        for(const key of baseKeys){
          const entry = oldByLegAndHorseBase.get(key);
          if(!entry){
            oldByLegAndHorseBase.set(key, {horse:h, fullNo});
          } else if(entry.fullNo===fullNo){
            // Aynı atın mükerrer kaydı -- gerçek eküri belirsizliği değil, daha dolu olanı tut.
            if(enrichmentScore(h)>enrichmentScore(entry.horse)) entry.horse=h;
          } else {
            // Aynı ana numarada FARKLI bir at daha var -- gerçek eküri grubu, belirsiz.
            entry.ambiguous = true;
          }
        }
      }
    }
  }

  db.races = db.races.filter(r => r.file_id !== fileRecord.id);
  let maxRid=Math.max(0,...db.races.map(r=>Number(r.id)||0));
  const storedRows=[];
  for(const src of payload.races){
    const r=JSON.parse(JSON.stringify(src));
    r.id=++maxRid;
    r.file_id=fileRecord.id;
    r.filename=fileRecord.filename;
    r.altili_no=Number(fileRecord.altili_no)||Number(payload.file?.altili_no)||1;
    r.race_date=fileRecord.race_date || r.race_date;
    r.hippodrome=canonicalHippodrome(fileRecord.hippodrome || r.hippodrome);
    let ownershipOldRace=null;
    if(oldRaceByKey){
      const oldRace=(r._absRaceNo!=null?oldRaceByKey.get(`ABS:${r._absRaceNo}`):null) || oldRaceByKey.get(`LEG:${r.leg}`);
      ownershipOldRace=oldRace||null;
      if(oldRace){
        for(const field of RACE_LAYER_FIELDS){
          if(field==='support_layers'&&enrichmentValueFilled(oldRace[field])){
            // Yeni içe aktarım yalnız bir katman getirmiş olabilir. Eski TR/GLP/J-BYG
            // katmanlarını kaybetmeden, gerçekten yeni gelen katmanın kazanacağı
            // anahtar-bazlı birleşim yapılır.
            r[field]={...JSON.parse(JSON.stringify(oldRace[field])),...(enrichmentValueFilled(r[field])?JSON.parse(JSON.stringify(r[field])):{})};
          }else if(!enrichmentValueFilled(r[field]) && enrichmentValueFilled(oldRace[field])){
            r[field]=JSON.parse(JSON.stringify(oldRace[field]));
          }
        }
      }
      // Pre-race import payout/ikramiye sahibi değildir: eski resmi payoutu koru, yoksa temizle.
      tkpApplyPreRaceRaceOwnership(r, ownershipOldRace);
    }
    if (oldByLegAndHorse){
      for (const h of (r.horses||[])){
        const fullNo = String(h.horse_no||'').trim();
        const baseNo = ekuriBase(fullNo);
        let old = (r._absRaceNo!=null ? oldByLegAndHorse.get(`ABS:${r._absRaceNo}|${fullNo}`) : null)
          || oldByLegAndHorse.get(`${r.leg}|${fullNo}`);
        if (!old){
          // Tam numarayla eşleşme yok -- yalnız o ana numarada gerçekten TEK at varsa
          // (eküri belirsizliği yoksa) ekuriBase fallback'i kullan. Aksi halde eşleşme
          // yapılmaz; yanlış eküri ortağının derece/sonuç verisini kopyalamaktansa boş
          // bırakmak tercih edilir.
          const baseEntry = (r._absRaceNo!=null ? oldByLegAndHorseBase.get(`ABS:${r._absRaceNo}|${baseNo}`) : null)
            || oldByLegAndHorseBase.get(`${r.leg}|${baseNo}`);
          if(baseEntry && !baseEntry.ambiguous) old = baseEntry.horse;
        }
        // Pre-race kaynak sonuç sahibi değildir. Eski resmi sonuç varsa AYNEN koru;
        // yoksa yanlış HTML'den gelen winner/finish/time alanlarını temizle.
        tkpApplyPreRaceHorseOwnership(h, old||null);
        if (!old) continue;
        // TJK Program gibi bir yenileme aynı isimli rank alanını kaynaksız taşısa
        // bile, daha önce doğrulanmış tarihsel destek grubunu parça parça karıştırma.
        // Eski grup güvenilir ve yeni grup güvenilir değilse tüm grup atomik biçimde
        // eski kayıttan geri alınır; böylece kaynak etiketi yanlış değere bağlanmaz.
        for(const group of HISTORICAL_SUPPORT_GROUPS){
          const sameDayTjk=typeof tkpIsCurrentLocalRaceDate==='function'&&tkpIsCurrentLocalRaceDate(r?.race_date)&&String(r?.program_source||'').toUpperCase()==='TJK_PROGRAM';
          // Günlük GLP/J-BYG'nin sahibi TJK'dir. Aynı gün yeni TJK enrichment geldiyse
          // R16.44'ten kalmış GC GLP/J-BYG onu geri ezemez; enrichment gelmediyse de
          // yalnız daha önceki aynı-gün TJK kanıtı korunur. TR PUAN her zaman GC'dir.
          // TR PUAN'ın eski arşivlerinde kaynak bazen tr_source aliasında kaldı.
          // Yalnız tr_ganyan_source'a bakmak, yeni bülten yenilemesinde gerçek TR
          // değerini "kaynaksız" sanıp normalizeRaceObj() tarafından silinmesine
          // neden oluyordu. TR için iki kanonik alan da aynı güven kapısından geçer;
          // diğer destek katmanlarının kaynak sözleşmesi değişmez.
          const trustedSource=horse=>{
            if(group.source==='tr_ganyan_source'){
              return group.trusted.test(String(horse?.tr_ganyan_source||''))
                || group.trusted.test(String(horse?.tr_source||''));
            }
            return group.trusted.test(String(horse?.[group.source]||''));
          };
          const liveTrustedSource=horse=>{
            if(group.source==='tr_ganyan_source') return trustedSource(horse);
            return group.liveTrusted?.test(String(horse?.[group.source]||''))||false;
          };
          const oldTrusted=(sameDayTjk&&group.liveTrusted)?liveTrustedSource(old):trustedSource(old);
          const incomingTrusted=(sameDayTjk&&group.liveTrusted)?liveTrustedSource(h):trustedSource(h);
          if(!oldTrusted||incomingTrusted)continue;
          for(const field of group.fields){
            if(old[field]!=null)h[field]=JSON.parse(JSON.stringify(old[field]));
            else delete h[field];
          }
        }
        for (const field of ENRICHMENT_FIELDS){
          // Tarihsel destek alanları yukarıda kaynak etiketiyle birlikte atomik
          // işlendi; burada tek tek doldurmak farklı tarih/kaynakları karıştırır.
          if(HISTORICAL_SUPPORT_FIELDS.has(field))continue;
          if ((h[field]===null || h[field]===undefined) && old[field]!=null) h[field]=old[field];
        }
        // Son AGF yüklemede bazı TJK HTML'lerinde ilk koşuların AGF bloğu boş/hidden gelebiliyor.
        // Bu durumda yeni değer 0/1 gibi sahteyse, eski gerçek AGF'yi ezme.
        if(preserveEnrichment){
          const newAgf=Number(h.agf);
          const oldAgf=Number(old.agf);
          if((!Number.isFinite(newAgf) || newAgf<=1.01) && Number.isFinite(oldAgf) && oldAgf>1.01){
            h.agf=oldAgf;
          }
          if((h.best_time==null || h.best_time==='') && old.best_time) h.best_time=old.best_time;
          if((h.weight_kg==null || h.weight_kg==='') && old.weight_kg!=null) h.weight_kg=old.weight_kg;
        }
        // finish_position eski kayıttan geri yüklendiyse winner bayrağı da onunla
        // tutarlı olsun (yalnızca 1. sırada bitiren at kazanan sayılır). Program
        // içe aktarımı zaten finish_position=null/winner=0 ile geldiği için bu,
        // yalnızca yukarıda geri yüklenen eski sonucu devreye sokar.
        if (h.finish_position!=null){
          h.winner = Number(h.finish_position)===1 ? 1 : 0;
        }
      }
    }
    r.active=resultRaceQuality(r).winnerCount>0 ? 1 : 0;
    normalizeRaceObj(r);
    db.races.push(r);
    storedRows.push(r);
  }
  invalidateActiveRacesCache();
  return storedRows;
}

function upsertPredictionQc(p, finalAgfLoaded=false){
  if (!p || !p.file) return {record:null, created:false, duplicate:false};
  const date=String(p.file.race_date || p.races?.[0]?.race_date || '').trim();
  const hip=canonicalHippodrome(p.file.hippodrome || p.races?.[0]?.hippodrome || '');
  if (!date || !hip) return {record:null, created:false, duplicate:false};
  let seq=Number(p.file.sequence_no)||0;
  const incomingName=String(p.file.filename || '').trim();
  const incomingAlt=Math.max(1,Number(p.file.altili_no)||1);
  const incomingAltCount=Math.max(1,Number(p.file.altili_count)||1);

  // Yarış kimliği dosya adı veya sıra numarası değildir. Aynı tarih + hipodrom,
  // aynı yarış toplantısıdır. Eski dosya farklı adla yeniden yüklenirse yeni QC açılmaz.
  const samePredictionMeeting=db.files.find(x =>
    x.record_type==='PREDICTION_QC' &&
    String(x.race_date||'')===date && canonicalHippodrome(x.hippodrome||'')===hip &&
    (Number(x.altili_no)||1)===incomingAlt
  );
  const sameAnyMeeting=samePredictionMeeting || db.files.find(x =>
    String(x.race_date||'')===date && canonicalHippodrome(x.hippodrome||'')===hip &&
    (Number(x.altili_no)||1)===incomingAlt
  );

  if(!finalAgfLoaded && sameAnyMeeting){
    // Aynı yarış (tarih+hipodrom) için ikinci bir ODS yüklendiyse -- örneğin önce
    // Klasör Ekle (Otomatik) ile bülten yüklenmiş, sonra Y.PUAN'lı/BMB'li skorlanmış
    // ODS yüklendiyse -- yeni dosyadaki güncel alanlar (özellikle VALUE/BMB) artık
    // sessizce görmezden gelinmiyor, her seferinde yazılıyor. Daha önce ayrıca
    // yüklenmiş g800/jbyg/ypuan/value_score/s_value/sp gibi zenginleştirme alanları,
    // bu yeni veride boşsa (preserveEnrichment=true) korunmaya devam ediyor.
    if(sameAnyMeeting.record_type==='PREDICTION_QC'){
      sameAnyMeeting.altili_no=incomingAlt;
      sameAnyMeeting.altili_count=Math.max(incomingAltCount,Number(sameAnyMeeting.altili_count)||1);
      sameAnyMeeting.filename=tkpQcOdsFilename(sameAnyMeeting.sequence_no || seq, sameAnyMeeting.hippodrome || hip, sameAnyMeeting.altili_no, sameAnyMeeting.altili_count);
      storePredictionQcRaces(sameAnyMeeting, p, true);
      markPredictionFileResultState(sameAnyMeeting,p);
      saveDB(false);
    }
    renderFiles();
    return {record:sameAnyMeeting, created:false, duplicate:true};
  }

  // Son AGF aynı tarih + hipodrom kaydını günceller; sıra numarası eşleşmesi aranmaz.
  let f=samePredictionMeeting;
  let created=false;
  const previousFileCount=(db.files||[]).length;
  if(!f){
    // Temiz kronoloji kilidi varsa O(1) sıra/id al; eski veya işaretsiz yedekte
    // aşağıdaki güvenli fallback çalışır ve yeni kayıt sonra tam doğrulamaya girer.
    if(!seq) seq=typeof tkpChronologyNextSequence==='function'
      ? tkpChronologyNextSequence(db)
      : (db.files||[]).reduce((max,x)=>Math.max(max,Number(x?.sequence_no)||0),0)+1;
    const id=typeof tkpChronologyNextFileId==='function'
      ? tkpChronologyNextFileId(db)
      : (db.files||[]).reduce((max,x)=>Math.max(max,Number(x?.id)||0),0)+1;
    const sourceName=incomingName || `TAHMIN_${date}_${hip}.ods`;
    const filename=tkpQcOdsFilename(seq, hip, incomingAlt, incomingAltCount);
    f={id,sequence_no:seq,filename,original_filename:tkpPublicSourceName(sourceName, hip),source_signature:fold(sourceName),race_date:date,hippodrome:hip,altili_no:incomingAlt,altili_count:incomingAltCount,status:'ACTIVE',qc_status:'BEKLİYOR',record_type:'PREDICTION_QC',created_at:new Date().toISOString()};
    db.files.push(f);
    created=true;
  }
  if(incomingName){ f.source_signature=fold(incomingName); f.original_filename=tkpPublicSourceName(incomingName, hip); }
  f.altili_no=incomingAlt;
  f.altili_count=Math.max(incomingAltCount,Number(f.altili_count)||1);
  f.filename=tkpQcOdsFilename(f.sequence_no || seq, f.hippodrome || hip, f.altili_no, f.altili_count);
  f.status='ACTIVE';
  // Sonuç HTML ile daha önce sonuç işlenmiş (result_updated_at dolu) bir kayıt,
  // Son AGF'nin yeniden yüklenmesi ya da tahmin ekranının yeniden tetiklenmesiyle
  // BEKLİYOR durumuna geri düşmesin -- kullanıcı bildirimi: "OKEY almış sonuç
  // dosyası tahmin için çağrıldığında bekliyora düşmesin."
  if(!f.result_updated_at && !f.has_confirmed_results && !confirmedResultRacesForFile(f.id).length) f.qc_status=finalAgfLoaded ? 'SON AGF YÜKLENDİ · BEKLİYOR' : 'BEKLİYOR';
  f.updated_at=new Date().toISOString();
  if(finalAgfLoaded) f.final_agf_loaded_at=f.updated_at;
  const storedPredictionRaces=storePredictionQcRaces(f, p, finalAgfLoaded);
  markPredictionFileResultState(f,p);
  if(created&&typeof tkpApplyChronologyForIncomingFile==='function'){
    // Normal güncel yarış eklemesi yalnız yeni dosyayı ve bu altı yarışı yazar;
    // geçmiş yarış/snapshot günlüklerine bakmaz. Geri tarihli kayıt otomatik olarak
    // güvenli tam eşlemeye düşer.
    tkpApplyChronologyForIncomingFile(db,f,{previousFileCount,linkedRows:storedPredictionRaces,reason:'prediction-import',markDirty:false,logChange:false});
  }else if(created&&typeof tkpResequenceFilesChronologically==='function'){
    tkpResequenceFilesChronologically(db,{full:true,reason:'missing-chronology-api',markDirty:false,logChange:false});
  }
  saveDB(false);
  renderFiles();
  return {record:f, created, duplicate:false};
}

let _tkpPredictionRenderGeneration=0;
let _tkpPredictionStatsSignature='';
let _tkpPredictionLogFastIndex={signature:'',byNo:new Map(),byName:new Map(),byNoAnyAlt:new Map(),byNameAnyAlt:new Map()};
function tkpPredictionLogFastIndex(){
  const logs=Array.isArray(db?.prediction_log)?db.prediction_log:[];
  const signature=`${logs.length}|${String(logs[logs.length-1]?.ts||'')}`;
  if(_tkpPredictionLogFastIndex.signature===signature) return _tkpPredictionLogFastIndex;
  const byNo=new Map(),byName=new Map(),byNoAnyAlt=new Map(),byNameAnyAlt=new Map();
  const put=(map,key,rec)=>map.set(key,tkpPredictionLogPreferred(map.get(key),rec));
  for(const rec of logs){
    if(tkpPredictionLogScoreValue(rec)===null) continue;
    const date=String(rec.race_date||'');
    const hip=fold(rec.hippodrome||'');
    const alt=Number(rec.altili_no)||1;
    const leg=String(rec.leg||'');
    const prefix=`${date}|${hip}|${alt}|${leg}|`;
    const anyPrefix=`${date}|${hip}|${leg}|`;
    const no=String(rec.horse_no||'');
    const base=String(ekuriBase(no)||no);
    const name=fold(rec.horse_name||'');
    if(no){put(byNo,prefix+no,rec);put(byNoAnyAlt,anyPrefix+no,rec);}
    if(base){put(byNo,prefix+base,rec);put(byNoAnyAlt,anyPrefix+base,rec);}
    if(name){put(byName,prefix+name,rec);put(byNameAnyAlt,anyPrefix+name,rec);}
  }
  _tkpPredictionLogFastIndex={signature,byNo,byName,byNoAnyAlt,byNameAnyAlt};
  return _tkpPredictionLogFastIndex;
}
function tkpArchivedPredictionLogRecord(r,h){
  const date=String(r?.race_date||'');
  const hip=fold(r?.hippodrome||'');
  // R16.59 HIZ FIX: bu fonksiyon arşiv skor geri-yükleme taramasında HER at için
  // çağrılır (tkpArchivedHorseScoreReady/tkpRestoreArchivedHorseScore); eskiden
  // her çağrıda db.files'ı baştan tarıyordu (O(at×dosya)). tkpFileById O(1)
  // indeksi varsa onu kullanır, yoksa güvenli find() yoluna düşer.
  const fileId=String(r?.file_id??'');
  const file=(fileId&&typeof tkpFileById==='function'?tkpFileById(fileId):null)
    ||(db?.files||[]).find(f=>String(f.id)===fileId);
  const alt=Number(r?.altili_no)||Number(file?.altili_no)||1;
  const leg=String(r?.leg||'');
  const prefix=`${date}|${hip}|${alt}|${leg}|`;
  const no=String(h?.horse_no||'');
  const base=String(ekuriBase(no)||no);
  const name=fold(h?.horse_name||'');
  const index=tkpPredictionLogFastIndex();
  const anyPrefix=`${date}|${hip}|${leg}|`;
  return index.byNo.get(prefix+no)||index.byNo.get(prefix+base)||index.byName.get(prefix+name)
    ||index.byNoAnyAlt.get(anyPrefix+no)||index.byNoAnyAlt.get(anyPrefix+base)||index.byNameAnyAlt.get(anyPrefix+name)||null;
}
function tkpArchivedHorseScoreReady(r,h){
  if(!h || isNonRunner(h)) return true;
  if(typeof hasPredictionScoreSnapshot==='function' && hasPredictionScoreSnapshot(h)) return true;
  // V1.1.14 öncesi bazı kayıtlar kilit + score taşıyor, fakat yeni snapshot
  // alanları yok. Bunlar da yarış gününde kaydedilmiş gerçek tahmindir.
  if(!!h.prediction_score_locked && !(typeof tkpIsUnverifiedReconstructedZeroSnapshot==='function'&&tkpIsUnverifiedReconstructedZeroSnapshot(h)) && h.score!==null&&h.score!==undefined&&h.score!==''&&Number.isFinite(Number(h.score))) return true;
  return tkpPredictionLogScoreValue(tkpArchivedPredictionLogRecord(r,h))!==null;
}

function tkpRaceArchivedScoresReadyForDisplay(r){
  const horses=(r?.horses||[]).filter(h=>!isNonRunner(h));
  if(!horses.length || !raceHasConfirmedResult(horses)) return false;
  // Salt-okunur arşiv görüntülemede historical calibration etiketi hızlı açılışı
  // engellemez. Eğitim/backtest fonksiyonlarının davranışı değişmez; yalnız daha önce
  // kilitlenmiş/frozen skorların yeniden hesaplanması önlenir.
  return horses.every(h=>tkpArchivedHorseScoreReady(r,h));
}

function tkpRaceArchivedScoresReady(r){
  if(Number(r?.historical_calibration_set)===1 || (typeof globalThis.tkpHistoricalCalibrationRace==='function'&&globalThis.tkpHistoricalCalibrationRace(r))) return false;
  const horses=(r?.horses||[]).filter(h=>!isNonRunner(h));
  if(!horses.length) return false;
  // FIX (V1.1.212): Bitmemiş (sonuçsuz) yarışlarda "arşivlenmiş/kilitli" hızlı açılış
  // yolu ATLANMALI. Eskiden bir at için ANY eski snapshot/log kaydı varsa (ör. X-Kulis
  // yüklenmeden önceki bir hesaplamadan kalma), sonraki her dosya yüklemesinde bu eski
  // skor -- yeni sinyaller (X-Kulis, Y.PUAN vb.) eklenmiş olsa bile -- sessizce geri
  // yükleniyor ve TEKRAR kilitleniyordu (tkpRestoreArchivedHorseScore, sonuç şartı
  // olmadan kilitliyordu). Kullanıcı talimatı: sonuçlanmamış yarışlarda skor her zaman
  // canlı/taze hesaplanır; kilit yalnız SONUÇ girildikten sonra (bkz. sealDisplayedPrediction
  // Score) anlamlıdır. Bitmiş yarışlarda mevcut hızlı-açılış davranışı DEĞİŞMEDİ.
  if(!raceHasConfirmedResult(horses)) return false;
  return horses.every(h=>tkpArchivedHorseScoreReady(r,h));
}
function tkpRestoreArchivedHorseScore(r,h){
  if(typeof hasPredictionScoreSnapshot==='function' && hasPredictionScoreSnapshot(h)){
    const snap=Number(h.prediction_score_snapshot);
    const rec=tkpArchivedPredictionLogRecord(r,h),loggedScore=tkpPredictionLogScoreValue(rec);
    // Bazı ara yedekler bütün atlara kilitli 0 snapshot yazdı. Aynı at için
    // doğrulanmış PRE-RACE logda pozitif skor varsa bu placeholder gerçek kanıtı
    // örtemez; gerçek sıfır ise pozitif log yokken aynen korunur.
    if(snap===0&&loggedScore!==null&&loggedScore>0){
      h.score=loggedScore;
      h.why=Array.isArray(h.why)&&h.why.length?h.why.slice():['Kayıtlı yarış öncesi tahmin skoru'];
      const loggedRank=Number(rec?.common_rank||rec?.predicted_rank);
      if(Number.isFinite(loggedRank)&&loggedRank>0){h.prediction_order_snapshot=loggedRank;h._strategy_rank=loggedRank;}
      if(typeof capturePredictionScoreSnapshot==='function')capturePredictionScoreSnapshot(h,true,true);
    }else applyPredictionScoreSnapshot(h);
  }else{
    const rec=tkpArchivedPredictionLogRecord(r,h);
    const loggedScore=tkpPredictionLogScoreValue(rec);
    if(rec && loggedScore!==null){
      h.score=loggedScore;
      h.why=Array.isArray(h.why)&&h.why.length?h.why.slice():['Kayıtlı yarış öncesi tahmin skoru'];
      h.scoreParts=h.scoreParts&&typeof h.scoreParts==='object'?JSON.parse(JSON.stringify(h.scoreParts)):{};
      h.bestLb=Number(h.bestLb)||0;
      const loggedRank=Number(rec.common_rank||rec.predicted_rank);
      if(Number.isFinite(loggedRank)&&loggedRank>0){
        h.prediction_order_snapshot=loggedRank;
        h._strategy_rank=loggedRank;
      }
      if(typeof capturePredictionScoreSnapshot==='function') capturePredictionScoreSnapshot(h,true,true);
    }else if(Number(h?.prediction_score_locked)===1&&!(typeof tkpIsUnverifiedReconstructedZeroSnapshot==='function'&&tkpIsUnverifiedReconstructedZeroSnapshot(h))&&h.score!==null&&h.score!==undefined&&h.score!==''&&Number.isFinite(Number(h.score))){
      h.score=Number(h.score);
      h.why=Array.isArray(h.why)?h.why.slice():[];
      h.scoreParts=h.scoreParts&&typeof h.scoreParts==='object'
        ? JSON.parse(JSON.stringify(h.scoreParts)) : {};
      h.bestLb=Number(h.bestLb)||0;
      // V1.1.14 öncesi kilit + score kaydını yeni snapshot biçimine yükselt.
      if(typeof capturePredictionScoreSnapshot==='function') capturePredictionScoreSnapshot(h,true,true);
    }
  }
  return {...h,
    why:Array.isArray(h.why)?h.why.slice():[],
    scoreParts:h.scoreParts&&typeof h.scoreParts==='object'?JSON.parse(JSON.stringify(h.scoreParts)):{},
    bestLb:Number(h.bestLb)||0
  };
}

function tkpNormalizeStoredVisibleTkpScores(){
  if(!db || !Array.isArray(db.races)) return {changed:0,races:0,horses:0};
  let changed=0,races=0,horses=0;
  for(const r of db.races){
    let raceTouched=false;
    for(const h of (r.horses||[])){
      if(!h) continue;
      const scaleOk=String(h.tkp_display_scale_version||'')=== (typeof TKP_VISIBLE_SCORE_SCALE_VERSION!=='undefined'?TKP_VISIBLE_SCORE_SCALE_VERSION:'DIV3_MAX10_V1');
      // Frozen snapshot varsa ölçek etiketi doğru görünse bile bayat canlı/ham değer
      // saklanmış olabilir. Her açılışta frozen görünür TKP'yi yeniden uygula.
      const hasFrozen=Number(h.prediction_score_locked)===1 && Number.isFinite(Number(h.prediction_score_snapshot));
      if(scaleOk && !hasFrozen) continue;
      const raw=typeof tkpRawVisibleScoreFromHorse==='function' ? tkpRawVisibleScoreFromHorse(h) : Number(h.tkp_display_score ?? h.score);
      if(!Number.isFinite(Number(raw))) continue;
      if(typeof tkpWriteVisibleDisplayScore==='function') tkpWriteVisibleDisplayScore(h,raw);
      else h.tkp_display_score=Math.round(Math.max(0,Math.min(10,Number(raw)/3))*100)/100;
      changed++;horses++;raceTouched=true;
    }
    if(raceTouched)races++;
  }
  return {changed,races,horses};
}
try{ if(typeof window!=='undefined') window.tkpNormalizeStoredVisibleTkpScores=tkpNormalizeStoredVisibleTkpScores; }catch(_e){}

function tkpPreparePredictionStats(){
  const signature=(typeof tkpOutcomeLearningSignature==='function'?tkpOutcomeLearningSignature(db):db?.learning_state?.dataset_signature)
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):`${(db?.races||[]).length}|${(db?.files||[]).length}`);
  if(signature===_tkpPredictionStatsSignature && window.__tkpHorseHistoryIndex) return false;
  const ordered=tkpChronologicalHistory(learningEligibleRaces());
  computeHorsePriorStats(ordered);
  computeHorseConditionPriorStats(ordered);
  computeHorsePriorAccurateStats(ordered);
  if(typeof computeHorseRaceHistoryIndex==='function') window.__tkpHorseHistoryIndex=computeHorseRaceHistoryIndex(ordered);
  _tkpPredictionStatsSignature=signature;
  return true;
}
function tkpPredictionStatsReady(){
  const signature=(typeof tkpOutcomeLearningSignature==='function'?tkpOutcomeLearningSignature(db):db?.learning_state?.dataset_signature)
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):`${(db?.races||[]).length}|${(db?.files||[]).length}`);
  return signature===_tkpPredictionStatsSignature && Boolean(window.__tkpHorseHistoryIndex);
}
let _tkpPredictionContextUpgradeSeq=0;
function tkpSchedulePredictionContextUpgrade(displayRaces,logPayload,renderOptions,renderGeneration){
  const token=++_tkpPredictionContextUpgradeSeq;
  const run=async()=>{
    const started=typeof tkpNow==='function'?tkpNow():performance.now();let failure=null;
    try{
      // Bu iş ilk ekranın önünde beklemez. Kural madencisi kendi cooperative
      // dilimlerini kullanır; tamamlanınca aynı toplantı tam model ile bir kez
      // tazelenir. Kullanıcı ilk bakış ve ayak sekmelerini bu sırada kullanabilir.
      await getCurrentRulesAsync();
      if(typeof tkpYield==='function')await tkpYield();
      // R19.2: the old context-upgrade synchronously rebuilt all horse-history,
      // hippodrome and global statistics, then rendered prediction a second time.
      // On the real archive this was the 45–55 s main-thread stall. Those heavy
      // analytics remain available in their own panes/caches; prediction marks the
      // context warm without forcing a second full DOM rebuild.
      if(token!==_tkpPredictionContextUpgradeSeq||renderGeneration!==_tkpPredictionRenderGeneration)return false;
      globalThis.__tkpPredictionContextRulesReady=true;
      try{globalThis.dispatchEvent?.(new CustomEvent('tkp:prediction-context-ready',{detail:{renderGeneration}}));}catch(_e){}
      return true;
    }catch(error){failure=error;console.warn('Tahmin tam bağlam hazırlığı:',error);return false;}
    finally{try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → tam model arka hazırlık',started,failure,{budgetMs:15000});}catch(_e){}}
  };
  // Tam geçmiş/kurallar ikinci aşamadır: ilk görünüm, ayak sekmeleri ve üç kupon
  // tamamlanmadan bu yenilemenin kuyruğu ele geçirmesine izin verme. Eski Chromium'da
  // bu iş ilk boyadan hemen sonra yeniden render tetikleyip kupon DOM'unu silebiliyordu.
  if(typeof tkpQueueTask==='function')tkpQueueTask('prediction-context-upgrade',run,{priority:'background',replace:true,minIdleMs:900});
  else setTimeout(()=>{run();},0);
}

// V1.1.70 — BOMB HUNTER SHADOW MODE
// Ayrı sürpriz öneri motoru. Ana tahmin sırasını/kuponu ASLA değiştirmez.
// Öneriler yalnız yarış sonucu yokken dondurulur; sonuç geldikten sonra aynı kayıt değerlendirilir.
function tkpBombHunterRaceKey(r){
  return [String(r?.race_date||''),canonicalHippodrome(r?.hippodrome||''),Number(r?.altili_no)||1,Number(r?.leg)||Number(r?.sequence_no)||0].join('|');
}
function tkpBombHunterNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function tkpBombHunterRankMap(horses,key,lowerBetter=false){
  const read=typeof key==='function'?key:h=>h?.[key];
  const rows=(horses||[]).map(h=>({h,v:tkpBombHunterNum(read(h))})).filter(x=>x.v!=null);
  rows.sort((a,b)=>lowerBetter?(a.v-b.v):(b.v-a.v));
  const out=new Map(); rows.forEach((x,i)=>out.set(x.h,i+1)); return {rank:out,count:rows.length};
}
function tkpBombHunterRankScore(rank,count){
  if(!rank||!count) return 0;
  if(count<=1) return 1;
  return Math.max(0,Math.min(1,1-(rank-1)/(count-1)));
}

// Ana TKP'nin ortak veri omurgası. Tabloya yazılan AGF / PROF / Y.PUAN /
// G.PR / DRC değerleri burada aynı ayak içinde 0-1 bandına alınır. Ganyan
// Canavarı programındaki forma yanı p değeri ham puan olarak ayrıca eklenmez;
// yalnız ayak içindeki p sırası, AGF sinyaline temkinli katkı verir.
// Eksik bir kaynak sıfır sayılmaz; yalnız mevcut kaynakların ağırlığıyla hesaplanır.
// Dış yorumcu/Kulis kanıtı bu ortak havuza girmez. Yalnız Uzman+Kulis katmanı,
// canlı öncesi kilitli ve yönetişimden geçmiş kanıtı bağımsız değerlendirir.
function tkpCommonEvidenceForHorse(r,h,options={}){
  const live=(r?.horses||[]).filter(x=>x&&!isNonRunner(x));
  const clamp=v=>Math.max(0,Math.min(1,Number(v)||0));
  // Arşiv/frozen görünümde ortak kanıt yarış öncesi snapshot'ın parçasıdır. Bu
  // ekranda tkpAutoTableCompositeScore() çağırmak, sıcak cache yoksa her ayak için
  // adaptiveSignalStats() ile tüm geçmişi yeniden tarar. Snapshot ortak parçası
  // varsa onu aynen göster; eski kayıtta parça yoksa yalnız aynı ayaktaki frozen
  // skor dağılımından nötr bir görünür değer türet. Canlı tahmin yolu değişmez.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r)){
    const snapParts=h?.prediction_score_parts_snapshot||h?.scoreParts||{};
    const storedCommonValue=h?.prediction_common_evidence_snapshot??h?.tkp_common_evidence;
    const storedCommon=(storedCommonValue===null||storedCommonValue===undefined||storedCommonValue==='')?NaN:Number(storedCommonValue);
    if(Number.isFinite(storedCommon)&&storedCommon>=0){
      return {value:clamp(storedCommon),parts:[['KAYITLI TKP',clamp(storedCommon),1]],missing:[]};
    }
    const commonValue=snapParts?.common;
    const commonPart=(commonValue===null||commonValue===undefined||commonValue==='')?NaN:Number(commonValue);
    if(Number.isFinite(commonPart)&&commonPart>=0){
      const value=clamp(commonPart/0.65);
      return {value,parts:[['KAYITLI TKP',value,1]],missing:[]};
    }
    const raw=Number(h?.prediction_score_snapshot??h?.score);
    const max=Math.max(0,...live.map(x=>Number(x?.prediction_score_snapshot??x?.score)||0));
    const value=Number.isFinite(raw)&&raw>0&&max>0?clamp(raw/max):0;
    return {value,parts:[['KAYITLI TKP',value,1]],missing:[]};
  }
  const relative=(value,read)=>{
    const vals=live.map(read).filter(v=>Number.isFinite(v));
    if(!Number.isFinite(value)||!vals.length) return null;
    const lo=Math.min(...vals),hi=Math.max(...vals);
    return hi>lo ? clamp((value-lo)/(hi-lo)) : .5;
  };
  const rankSignal=(rank,count)=>Number.isFinite(rank)&&rank>0&&count>0?(count<=1?.5:clamp(1-(rank-1)/(count-1))):null;
  const agfRaw=Number(h?.agf);
  const agfOnly=Number.isFinite(agfRaw)&&agfRaw>0 ? clamp(agfRaw/100) : rankSignal(Number(h?.agf_rank),live.length);
  const profRaw=typeof profileStrengthPct==='function' ? Number(profileStrengthPct(r,h)) : NaN;
  const prof=Number.isFinite(profRaw) ? clamp(profRaw/100) : null;
  // FIX (V1.1.212 — kullanıcı talimatı): X/Kulis verisi ARTIK yalnız "Uzman + Kulis"
  // kuponunda (tkpV55ExpertEvidence, ağırlık %15, bağımsız yorumcu ortalamasıyla)
  // kullanılır. Bu fonksiyon "Ana TKP'nin ortak veri omurgası"dır -- İlk Bakış, Normal
  // Kupon, Sürpriz Altılı gibi TÜM diğer ekranları besler. X-Kulis eskiden buraya da
  // (Y.PUAN'a delta olarak) sızıyordu; X yorumu yüklenince yalnız Uzman+Kulis değil,
  // İlk Bakış'taki genel TKP de (AL CEMAL örneğinde 4→0,82 gibi) değişiyordu.
  const yRaw=Number(h?.ypuan), ypuan=relative(Number.isFinite(yRaw)&&yRaw>0 ? yRaw : NaN,x=>{
    const y=Number(x?.ypuan);
    return Number.isFinite(y)&&y>0 ? y : NaN;
  });
  const gprRaw=Number(h?.gpr_strength);
  const gpr=Number.isFinite(gprRaw)&&Number(h?.gpr_starts)>0 ? clamp(gprRaw) : null;
  const drcRaw=typeof tkpDegreeSignalValue==='function' ? Number(tkpDegreeSignalValue(r,h)) : NaN;
  const hasDrc=[h?.best_time,h?.last_result_time].some(v=>v!=null&&String(v).trim()&&String(v).trim()!=='-');
  const drc=Number.isFinite(drcRaw)&&hasDrc ? clamp(drcRaw) : null;
  // h.tr eski ODS katmanında çoğu zaman AGF'nin aynısıdır; gerçek TR PUAN
  // yalnız Ganyan Canavarı'ndan gelen tr_ganyan/tr_puan alanıdır. Eski alanı
  // kullanmak AGF'yi ikinci kez saydırır ve sıralamayı yapay biçimde bozar.
  const trOf=x=>{
    const value=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(x):null;
    return value===null?NaN:Number(value);
  };
  const pRows=live.map(x=>({x,value:trOf(x)})).filter(row=>Number.isFinite(row.value)).sort((a,b)=>b.value-a.value||TKP_TR_COLLATOR_NUM.compare(String(a.x?.horse_no||''),String(b.x?.horse_no||'')));
  const pRank=pRows.findIndex(row=>row.x===h)+1;
  const pRankScore=pRank>0?rankSignal(pRank,pRows.length):null;
  // AGF kaynağı ve görünen agf_rank kesinlikle değiştirilmez. P sırası yalnız
  // ortak pazar sinyalinin %25'idir; veri yoksa AGF tek başına aynen kullanılır.
  const agf=agfOnly==null?pRankScore:(pRankScore==null?agfOnly:clamp(agfOnly*.75+pRankScore*.25));
  let tableAll=null;
  try{
    if(typeof tkpAutoTableCompositeScore==='function'){
      // R16.50 KÖK DONMA FIX: İlk boya/collector fastContext sırasında TÜM TABLO
      // katsayısı cache yok diye 3.000+ geçmiş koşuyu tarayamaz. Kalıcı adaptif
      // cache varsa onu, yoksa aynı taban ağırlıkları noScan modunda kullanır.
      // Tam öğrenme post-kupon arka hazırlıkta yine FULL olarak yapılır.
      const noScan=options?.noScan===true;
      const model=noScan&&typeof tkpPurposeWeightsForRace==='function'?tkpPurposeWeightsForRace(r,'prediction',1,{noScan:true}):null;
      tableAll=tkpAutoTableCompositeScore(r,h,'prediction',1,model);
    }
  }catch(_e){ tableAll=null; }
  const parts=[['AGF + P SIRA',agf,.18],['PROF',prof,.16],['Y.PUAN',ypuan,.14],['G.PR',gpr,.12],['DRC',drc,.10],['TÜM TABLO',tableAll,.15]].filter(([,v])=>v!=null);
  const weight=parts.reduce((s,[,,w])=>s+w,0);
  const value=weight ? parts.reduce((s,[,v,w])=>s+v*w,0)/weight : 0;
  return {value,parts,missing:['AGF + P SIRA','PROF','Y.PUAN','G.PR','DRC','TÜM TABLO'].filter(label=>!parts.some(([name])=>name===label)),pRank:pRank||null};
}
function tkpBombHunterFeatureMaps(r){
  const hs=(r?.horses||[]).filter(h=>!isNonRunner(h));
  const trValue=h=>{const value=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;return value===null?NaN:Number(value);};
  return {
    value:tkpBombHunterRankMap(hs,'value_score',false), tr:tkpBombHunterRankMap(hs,trValue,false),
    sp:tkpBombHunterRankMap(hs,'sp',false), s:tkpBombHunterRankMap(hs,'s_value',false),
    hndkp:tkpBombHunterRankMap(hs,'hndkp_rank',true), jbyg:tkpBombHunterRankMap(hs,'jbyg',true),
    g800:tkpBombHunterRankMap(hs,'g800',true), ypuan:tkpBombHunterRankMap(hs,'ypuan',false),
    main:tkpBombHunterRankMap(hs,'score',false)
  };
}
function tkpBombHunterHorseScore(r,h,maps){
  const pts=[]; let score=0;
  const add=(label,w,val)=>{ if(val>0){ score+=w*val; pts.push([label,w*val]); } };
  const rs=(obj)=>tkpBombHunterRankScore(obj.rank.get(h),obj.count);
  add('VALUE',.22,rs(maps.value));
  add('HNDKP',.14,rs(maps.hndkp));
  add('TR',.12,rs(maps.tr));
  add('SP',.09,rs(maps.sp));
  add('S',.07,rs(maps.s));
  add('J-BYG',.10,rs(maps.jbyg));
  add('400G',.08,rs(maps.g800));
  add('Y.PUAN/X',.07,rs(maps.ypuan));
  const gpr=Math.max(0,Math.min(1,Number(h?.gpr_strength)||0)); add('G.PR',.08,gpr);
  const mainRank=maps.main.rank.get(h)||99;
  if(mainRank>=3&&mainRank<=7){score+=.10;pts.push(['Ana sıra 3-7',.10]);}
  else if(mainRank<=2){score-=.08;pts.push(['Favori cezası',-.08]);}
  const agfRank=Number(h?.agf_rank)||99;
  // KÖK FIX (V1.1.108): "Bomba Avcısı", kendi tanımı gereği "AGF DIŞI güçlü sürpriz
  // adayı" arar (bkz. tkpExperimentTracker kartı). Önceden AGF 4-5. sıradaki atlara
  // "AGF 4-5 değer bandı" adıyla AYRICA +0.10 POZİTİF puan veriliyordu -- oysa AGF
  // 4-5. sıra hâlâ favori bandındadır (kullanıcı tanımı: "4-5 FVR atlar"). Bu, gerçek
  // favorilerin BH listesine sızmasına yol açıyordu. Artık AGF 3-5. sıra da (1-2 gibi)
  // "AGF favori cezası" alır; yalnız 6+ sıradaki gerçek sürpriz/uzak atlar ödüllenir.
  if(agfRank>=6&&agfRank<=10){score+=.16;pts.push(['AGF 6-10 sürpriz bandı',.16]);}
  else if(agfRank>10&&agfRank<99){score+=.07;pts.push(['Derin sürpriz bandı',.07]);}
  else if(agfRank<=5){score-=.10;pts.push(['AGF favori cezası',-.10]);}
  if(h?.bmb===1){score+=.18;pts.push(['BMB',.18]);}
  try{ if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,r)){score+=.12;pts.push(['ODB',.12]);} }catch(_){ }
  const trustedTr=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;
  const trRaw=trustedTr===null?NaN:Number(trustedTr);
  const trProfile=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(r,h):null;
  if(Number.isFinite(trRaw)){
    if(trRaw>=60&&trRaw<=70){score+=.12;pts.push(['TR 60-70 plase',.12]);}
    else if(trRaw>=30&&trRaw<60){score+=.15;pts.push(['TR 30-60 sürpriz',.15]);}
    else if(trRaw>=20&&trRaw<30){score+=.06;pts.push(['TR 20-30 izleme',.06]);}
  }
  if(trProfile?.hardCoupon){score+=.16;pts.push(['TR Gizli FVR',.16]);}
  if(trProfile?.isBmb){score+=.14;pts.push(['TR-BMB',.14]);}
  try{
    if(typeof tkpWinnerComboStatsForHorse==='function'
      &&typeof tkpWinnerComboSummaryReady==='function'
      &&tkpWinnerComboSummaryReady(r)){
      const hist=tkpWinnerComboStatsForHorse(r,h);
      if(hist&&hist.best&&hist.best.starts>=5){
        const lift=Math.min(.12,Math.max(0,Number(hist.best.winRate)||0)*.35);
        if(lift>0){score+=lift;pts.push([`Kazanan profil ${hist.best.wins}/${hist.best.starts}`,lift]);}
      }
    }
  }catch(_){}
  if(h?.tkp===1||h?.tkp_signal===1){score+=.08;pts.push(['TKP sinyali',.08]);}
  const xscore=h?.x_kulis_applied===true?Math.max(0,Math.min(1,(Number(h?.x_kulis_score)||0)/100)):0; if(xscore>0)add('X kulis',.06,xscore);
  const priorStarts=Number(h?.priorStarts)||0, priorWins=Number(h?.priorWins)||0;
  if(priorStarts>0&&priorWins>0){ const hist=Math.min(1,priorWins/Math.max(1,priorStarts)*3); add('Geçmiş galibiyet',.06,hist); }
  const bounded=Math.max(0,Math.min(1.35,score));
  pts.sort((a,b)=>b[1]-a[1]);
  return {score:bounded, reasons:pts.filter(x=>x[1]>0.025).slice(0,4).map(x=>x[0])};
}
function tkpBombHunterNearWinScore(r,row){
  const h=row?.h||row;
  const bh=Math.max(0,Math.min(1,Number(row?.score||0)/1.35));
  let winner=0;
  const archived=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r);
  if(archived){
    const own=Number(h?.prediction_score_snapshot??h?.score)||0;
    const max=Math.max(0,...(r?.horses||[]).map(x=>Number(x?.prediction_score_snapshot??x?.score)||0));
    winner=max>0?Math.max(0,Math.min(1,own/max)):0;
  }else try{
    if(typeof altiliWinnerScoreForHorse==='function')winner=Math.max(0,Math.min(1,Number(altiliWinnerScoreForHorse(r,h)||0)/100));
  }catch(_e){}
  // BH sürpriz niteliği ana omurgadır; gerçek birincilik modeli adayların kendi
  // aralarındaki "kazanmaya yakın" sırasını düzeltir, favorileri BH havuzuna sokmaz.
  return Math.round((bh*.62+winner*.38)*10000)/10000;
}
function tkpBombHunterIsOdbRow(r,row){
  if(String(row?.kind||'').toUpperCase()==='ODB')return true;
  if((row?.reasons||[]).some(reason=>/\bODB\b/i.test(String(reason))))return true;
  const h=row?.h||(r?.horses||[]).find(x=>String(x?.horse_no||'')===String(row?.horse_no||''));
  if(!h)return false;
  if(Number(h?.odb)===1||h?.bmb_source==='ŞABLON KURALI')return true;
  try{return typeof isOdbCandidate==='function'&&isOdbCandidate(h,r);}catch(_e){return false;}
}
function tkpBombHunterThreeFromRows(r,rows){
  const normalized=(rows||[]).map((row,index)=>{
    const h=row?.h||(r?.horses||[]).find(x=>String(x?.horse_no||'')===String(row?.horse_no||''))||null;
    const score=Number(row?.score)||0;
    const near=Number(row?.near_win_score);
    return {...row,h,score,horse_no:String(row?.horse_no??h?.horse_no??''),horse_name:row?.horse_name??h?.horse_name??'',
      reasons:Array.isArray(row?.reasons)?row.reasons:[],near_win_score:Number.isFinite(near)?near:tkpBombHunterNearWinScore(r,{...row,h,score}),_source_order:index};
  }).filter(row=>row.horse_no);
  const byNear=(a,b)=>Number(b.near_win_score||0)-Number(a.near_win_score||0)||Number(b.score||0)-Number(a.score||0)||a._source_order-b._source_order;
  const odb=normalized.filter(row=>tkpBombHunterIsOdbRow(r,row)).sort(byNear)[0]||null;
  // Kullanıcı kuralı: BH havuzu üç bağımsız BMB ve bir ayrı ODB taşır.
  const bombs=normalized.filter(row=>row!==odb&&!tkpBombHunterIsOdbRow(r,row)).sort(byNear).slice(0,3);
  const selected=bombs.map((row,index)=>({...row,kind:'BOMBA',category_rank:index+1}));
  if(odb)selected.push({...odb,kind:'ODB',category_rank:1});
  return selected.map((row,index)=>({...row,rank:index+1}));
}
function tkpBombHunterCompleteArchivedPortfolio(r,rows){
  const source=Array.isArray(rows)?rows.slice():[];
  const keyOf=row=>String(row?.horse_no??row?.h?.horse_no??'').trim();
  const used=new Set(source.map(keyOf).filter(Boolean));
  const maps=tkpBombHunterFeatureMaps(r);
  const scored=(r?.horses||[]).filter(h=>!isNonRunner(h)).map((h,index)=>{
    const pack=tkpBombHunterHorseScore(r,h,maps);
    return {h,index,score:Number(pack.score)||0,reasons:pack.reasons||[],horse_no:String(h?.horse_no||''),horse_name:h?.horse_name||''};
  });
  const preRaceOrder=(a,b)=>Number(b?.h?.bmb===1)-Number(a?.h?.bmb===1)
    ||Number(b.score||0)-Number(a.score||0)
    ||Number((b?.h?.prediction_score_snapshot??b?.h?.score) || 0)-Number((a?.h?.prediction_score_snapshot??a?.h?.score) || 0)
    ||Number(b?.h?.ypuan||0)-Number(a?.h?.ypuan||0)
    ||Number(b?.h?.agf||0)-Number(a?.h?.agf||0)
    ||a.index-b.index;
  let selected=tkpBombHunterThreeFromRows(r,source);
  let bombCount=selected.filter(x=>x.kind!=='ODB').length;
  const bombPool=scored.filter(x=>{
    if(used.has(x.horse_no)||Number(x?.h?.agf_rank||99)<=5)return false;
    try{return !(typeof isOdbCandidate==='function'&&isOdbCandidate(x.h,r));}catch(_e){return true;}
  }).sort(preRaceOrder);
  for(const x of bombPool){
    if(bombCount>=3)break;
    source.push({...x,kind:'BOMBA',near_win_score:tkpBombHunterNearWinScore(r,x),reasons:[...x.reasons,'Kayıtlı yarış öncesi BH tamamlaması']});
    used.add(x.horse_no); bombCount++;
  }
  if(!source.some(row=>tkpBombHunterIsOdbRow(r,row))){
    const odbPool=scored.filter(x=>!used.has(x.horse_no)&&Number(x?.h?.bmb)!==1&&Number(x?.h?.agf_rank||99)>6);
    const explicit=odbPool.filter(x=>Number(x?.h?.odb)===1||x?.h?.bmb_source==='ŞABLON KURALI');
    const proven=odbPool.filter(x=>{try{return typeof isOdbCandidate==='function'&&isOdbCandidate(x.h,r);}catch(_e){return false;}});
    // Kullanıcı sözleşmesi 3 BMB + 1 ODB'dir. Eski snapshotta ODB etiketi
    // bulunmasa bile AGF 7+ bandındaki en güçlü, BMB olmayan kalan gerçek atı
    // türetilmiş ODB izleme adayı olarak kullan. At uydurulmaz; yalnız toplantının
    // kendi yarış-öncesi satırlarından seçim yapılır.
    const derived=odbPool.filter(x=>Number(x?.h?.agf_rank||99)>6);
    const odb=(explicit.length?explicit:(proven.length?proven:derived)).sort(preRaceOrder)[0]||null;
    if(odb)source.push({...odb,kind:'ODB',near_win_score:tkpBombHunterNearWinScore(r,odb),reasons:[...odb.reasons,explicit.includes(odb)||proven.includes(odb)?'Kayıtlı yarış öncesi ODB tamamlaması':'AGF 7+ türetilmiş ODB izleme adayı']});
  }
  return tkpBombHunterThreeFromRows(r,source);
}
function tkpBombHunterCandidates(r){
  const hs=(r?.horses||[]).filter(h=>!isNonRunner(h));
  const maps=tkpBombHunterFeatureMaps(r);
  const ranked=hs.map(h=>({h,...tkpBombHunterHorseScore(r,h,maps)}))
    .filter(x=>{
      const h=x.h||{};
      const trustedTr=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;
      const tr=trustedTr===null?NaN:Number(trustedTr);
      const p=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(r,h):null;
      const mandatory=Number(h.bmb)===1 || (typeof isOdbCandidate==='function'&&isOdbCandidate(h,r)) || !!p?.hardCoupon || !!p?.isBmb;
      const trBand=Number.isFinite(tr)&&tr>=30;
      const trTail=Number.isFinite(tr)&&tr>=20&&Number(h._strategy_rank||h.prediction_order_snapshot||0)>Math.max(0,(hs.length||0)-4);
      // KÖK FIX (V1.1.112): `Number(h?.agf||0)<=25` (AGF YÜZDESİ, sıra değil) tüm diğer
      // koşullardan BAĞIMSIZ bir OR dalıydı. Sonuç: AGF SIRALAMASI 1 veya 2 olan GERÇEK
      // favori bir at (dağınık/çok adaylı yarışta payı düşük kalıp ör. %22 gibi <=25
      // olabilir) sırf yüzdesi düşük diye "sürpriz" listesine sızabiliyordu -- kullanıcı
      // ekranda AGF 1-2. sıradaki gerçek favorileri "Sürpriz öneri" olarak görüyordu.
      // Artık AGF 1-2. sıra, bağımsız bir zorunlu sinyal (BMB/ODB/TR-BMB/Gizli FVR)
      // olmadan HİÇBİR yoldan (ne düşük yüzde ne başka bir bant) BH listesine giremez.
      // V1.1.116 KESİN BH KURALI: AGF sırası 1-5 olan at BH'ye ASLA giremez.
      // BMB/ODB/TR-BMB/Gizli FVR/X veya başka hiçbir zorunlu sinyal bu yasağı delemez.
      // BH yalnız AGF 6 ve sonrası gerçek sürpriz/bomba havuzundan seçim yapar.
      const agfRank=Number(h?.agf_rank||99);
      if(agfRank<=5) return false;
      return mandatory || trBand || trTail || agfRank>=6 || Number(h?.agf||0)<=25;
    })
    .sort((a,b)=>b.score-a.score || (Number(a.h?.agf_rank)||99)-(Number(b.h?.agf_rank)||99));
  // Kullanıcı sözleşmesi: iki bağımsız Bomba + ayrı bir ODB. Adaylar BH puanı ile
  // birincilik modelinin ortak "kazanmaya yakın" sırasına göre seçilir. Gerçek ODB
  // yoksa sırf üç satır dolsun diye başka ata ODB etiketi verilmez.
  const eligible=ranked.filter(x=>Number(x.score)>0.18).map(x=>{
    let odb=false;try{odb=typeof isOdbCandidate==='function'&&isOdbCandidate(x.h,r);}catch(_e){}
    return {...x,kind:odb?'ODB':'BOMBA',near_win_score:tkpBombHunterNearWinScore(r,x)};
  });
  // Canlı/güncel replay de arşiv görünümüyle aynı 3 BMB + 1 ODB sözleşmesini
  // kullanır. Böylece iki ekranda kategori sayısı birbirinden kopmaz.
  return tkpBombHunterCompleteArchivedPortfolio(r,eligible);
}
// Champion coverage motoru BH adaylarını aynı canlı/sonuç-sızıntısız hesapla okuyabilsin.
// P1/TEK katmanı bu fonksiyonu kullanmaz; yalnız P5 kurtarma katmanı en güçlü 1 BH'yi alır.
if(typeof window!=='undefined') window.tkpBombHunterCandidates=tkpBombHunterCandidates;
function tkpBombHunterEnsureLog(){ if(!Array.isArray(db.bomb_hunter_shadow_log)) db.bomb_hunter_shadow_log=[]; return db.bomb_hunter_shadow_log; }
// KÖK FIX (V1.1.111): Bomba Avcısı adayları bir kez hesaplanıp `db.bomb_hunter_shadow_log`'a
// dondurulduktan sonra, algoritma (tkpBombHunterHorseScore/tkpBombHunterCandidates)
// SONRADAN değişse bile -- ör. V1.1.108'de kaldırılan "AGF 4-5 değer bandı" pozitif
// bandı -- eski kayıtlardaki `reasons`/`score` HİÇ yenilenmiyordu. Önceki mantık yalnız
// YENİ zorunlu (BMB/ODB/hardCoupon) adayları listeye EKLİYORDU; zaten listede olan
// sıradan adayların metni sonsuza dek donuk kalıyordu. Kullanıcı ekranda hâlâ kaldırılmış
// "AGF 4-5 değer bandı" etiketini görüyordu -- kod düzeltilmiş olsa bile ARAYÜZ eski
// donmuş kaydı gösteriyordu. Artık her algoritma değişikliğinde BH_MODEL_VERSION
// bilinçli olarak artırılır; sürüm uyuşmazlığında (ve yarış henüz sonuçlanmamışken --
// sonuçlanan yarış hâlâ kesin kilitli, geçmiş/backtest sızıntısı olmaz) TÜM aday listesi
// gerçek algoritmayla SIFIRDAN yeniden hesaplanır, yalnız zorunlu sinyaller eklenmez.
const BH_MODEL_VERSION='BH-SHADOW-8-V46-3BOMB-1ODB-NEAR-WIN';
function tkpBombHunterSync(raceResults){
  const log=tkpBombHunterEnsureLog(); let changed=false;
  for(const x of (raceResults||[])){
    const r=x?.r||x; if(!r) continue;
    const key=tkpBombHunterRaceKey(r);
    const hasResult=raceHasConfirmedResult(r.horses||[]);
    let rec=log.find(z=>z&&z.race_key===key);
    if(!rec && !hasResult){
      const c=tkpBombHunterCandidates(r);
      rec={race_key:key,race_date:r.race_date||'',hippodrome:r.hippodrome||'',leg:Number(r.leg)||0,created_at:new Date().toISOString(),model:BH_MODEL_VERSION,candidates:c.map((z,i)=>({rank:i+1,kind:z.kind,category_rank:z.category_rank,horse_no:String(z.h.horse_no),horse_name:z.h.horse_name||'',score:Number(z.score.toFixed(4)),near_win_score:Number(z.near_win_score||0),agf_rank:z.h.agf_rank??null,reasons:z.reasons}))};
      // Bu fonksiyonun kendi günlüğü yerel bir race-key indeksi kullanmaz.
      // logByRaceKey yalnız İleri Takip fonksiyonunun yerel değişkenidir.
      log.push(rec); changed=true;
    }
    if(rec && !hasResult && !rec.evaluated_at && rec.model!==BH_MODEL_VERSION){
      // Algoritma sürümü uyuşmuyor: sonuçlanmamış (dolayısıyla sızıntı riski olmayan)
      // bu yarış için tüm aday listesi gerçek/güncel algoritmayla sıfırdan yeniden
      // kurulur -- eski donuk reasons/score metinleri değil, TAZE hesap gösterilir.
      const fresh=tkpBombHunterCandidates(r);
      const freshCandidates=fresh.map((z,i)=>({rank:i+1,kind:z.kind,category_rank:z.category_rank,horse_no:String(z.h.horse_no),horse_name:z.h.horse_name||'',score:Number(z.score.toFixed(4)),near_win_score:Number(z.near_win_score||0),agf_rank:z.h.agf_rank??null,reasons:z.reasons}));
      if(JSON.stringify(freshCandidates)!==JSON.stringify(rec.candidates||[])){rec.candidates=freshCandidates;changed=true;}
      rec.model=BH_MODEL_VERSION; changed=true;
    }
    // V1.1.336 BH3 SNAPSHOT KİLİDİ: BH listesi ilk hesaplandığı anda 3 Bomba + 1 ODB olarak
    // dondurulur. Sonradan BMB/ODB/TR/hardCoupon gibi başka sinyaller değişse bile
    // BH listesine zorla at eklenmez ve sırası yeniden kurulmaz. BH bağımsız sürpriz
    // motorudur; bu kilit aynı kayıt açılıp kapandığında adayların değişmesini önler.
    if(rec && hasResult && !rec.evaluated_at){
      const winner=(r.horses||[]).find(h=>Number(h.winner)===1||Number(h.finish_position)===1);
      rec.winner_no=winner?String(winner.horse_no):''; rec.winner_name=winner?.horse_name||'';
      for(const c of (rec.candidates||[])){
        const hh=(r.horses||[]).find(h=>String(ekuriBase(h.horse_no))===String(ekuriBase(c.horse_no)) || baseHorseName(h.horse_name)===baseHorseName(c.horse_name));
        c.finish_position=hh?.finish_position!=null?Number(hh.finish_position):null;
        c.win=c.finish_position===1; c.top3=!!(c.finish_position&&c.finish_position<=3); c.top5=!!(c.finish_position&&c.finish_position<=5);
      }
      rec.evaluated_at=new Date().toISOString(); changed=true;
    }
  }
  // Shadow sonuçlarının tamamı istatistik/denetim için korunur; görünüm gerektiğinde
  // kendi satır sınırını uygular, veri kaynağı sessizce kesilmez.
  if(changed) try{ saveDB(false); }catch(_){ }
}

function tkpBombHunterWinningScoreProfile(beforeDate){
  // Yalnız ilgili yarıştan ÖNCE sonuçlanmış BH kayıtlarını kullan. Böylece geçmiş yarış
  // açılışında gelecekteki sonuçlar profile sızmaz. `scores`, daha önce kazanan gerçek BH
  // puanlarını taşır; ekran hem birebir kazanan puanı hem de en yakın güncel adayı işaretler.
  const winnerScores=[];
  const cutoff=String(beforeDate||'').trim();
  for(const rec of tkpBombHunterEnsureLog()){
    if(!rec?.evaluated_at||!Array.isArray(rec.candidates)) continue;
    if(cutoff && String(rec.race_date||'')>=cutoff) continue;
    for(const c of rec.candidates){
      if(c?.win && Number.isFinite(Number(c.score))) winnerScores.push(Number(c.score)*100);
    }
  }
  // FINAL yedeğe gömülü temiz 500-veri BH profili de aynı tarih kilidiyle okunur.
  // Hedef geçmiş bir yarışsa o tarihten sonraki kazanan puanları kesinlikle alınmaz.
  const historical=db?.settings?.bh_historical_500_profile;
  for(const row of (historical?.winner_scores_by_date||[])){
    if(cutoff&&String(row?.race_date||'')>=cutoff)continue;
    const score=Number(row?.score);if(Number.isFinite(score))winnerScores.push(score);
  }
  if(!winnerScores.length) return {count:0,center:null,min:null,max:null,scores:[]};
  winnerScores.sort((a,b)=>a-b);
  const mid=Math.floor(winnerScores.length/2);
  const center=winnerScores.length%2?winnerScores[mid]:(winnerScores[mid-1]+winnerScores[mid])/2;
  return {count:winnerScores.length,center,min:winnerScores[0],max:winnerScores[winnerScores.length-1],scores:winnerScores};
}
function tkpBombHunterWinnerProfileDistance(candidate,profile){
  const score=Number(candidate?.score||0)*100;
  const wins=Array.isArray(profile?.scores)?profile.scores.filter(v=>Number.isFinite(Number(v))).map(Number):[];
  if(wins.length) return Math.min(...wins.map(v=>Math.abs(score-v)));
  if(!profile||!Number.isFinite(Number(profile.center))) return Infinity;
  return Math.abs(score-Number(profile.center));
}
function tkpBombHunterMatchesPastWinningScore(candidate,profile){
  const score=Number(candidate?.score||0)*100;
  if(!Number.isFinite(score)||!Array.isArray(profile?.scores)) return false;
  // Ekrandaki BH puanı iki ondalık gösterildiği için aynı iki ondalık puan geçmişte
  // kazanmışsa "geçmiş kazanan" işareti verilir.
  return profile.scores.some(v=>Math.round(Number(v)*100)===Math.round(score*100));
}
function tkpBombHunterStats(){
  const done=tkpBombHunterEnsureLog().filter(r=>r?.evaluated_at&&Array.isArray(r.candidates)&&r.candidates.length);
  let races=done.length, anyWin=0,anyTop3=0,anyTop5=0,firstWin=0,secondWin=0,odbSample=0,odbWin=0,odbTop3=0,odbTop5=0;
  // KÖK FIX (v1.1.230): firstWin zaten hesaplanıyordu ama hiçbir yerde gösterilmiyordu;
  // 2. aday (secondWin) hiç hesaplanmıyordu. "BH 1./2. öğrenme" kullanıcı gereksinimi bu
  // ikisinin AYRI AYRI görünür olmasını gerektiriyor -- anyWin/anyTop3/anyTop5 gibi
  // "herhangi biri tuttu" toplu ölçülerle karıştırılmamalı.
  for(const r of done){
    const cs=r.candidates||[],bombs=cs.filter(c=>String(c?.kind||'BOMBA').toUpperCase()!=='ODB'),odb=cs.find(c=>String(c?.kind||'').toUpperCase()==='ODB')||null;
    if(cs.some(c=>c.win)) anyWin++; if(cs.some(c=>c.top3)) anyTop3++; if(cs.some(c=>c.top5)) anyTop5++;
    if((bombs[0]||cs[0])?.win) firstWin++; if((bombs[1]||cs[1])?.win) secondWin++;
    if(odb){odbSample++;if(odb.win)odbWin++;if(odb.top3)odbTop3++;if(odb.top5)odbTop5++;}
  }
  const historical=db?.settings?.bh_historical_500_profile;
  // Aynı yarışları iki kez saymamak için, daha geniş temiz tarihsel özet mevcutsa
  // BH tablosunun temelini doğrudan o özet yapar. Canlı ileri kayıtlar ancak daha
  // büyük örnek oluşturduğunda kendi sayılarıyla görünür.
  if(Number(historical?.races)>races){
    races=Number(historical.races)||0;anyWin=Number(historical.any_win)||0;anyTop3=Number(historical.any_top3)||0;anyTop5=Number(historical.any_top5)||0;firstWin=Number(historical.first_win)||0;secondWin=Number(historical.second_win)||0;
  }
  return {races,anyWin,anyTop3,anyTop5,firstWin,secondWin,odbSample,odbWin,odbTop3,odbTop5};
}
function tkpStrongestOdbForSurprise(r){
  const hs=(r?.horses||[]).filter(h=>!isNonRunner(h) && typeof isOdbCandidate==='function' && isOdbCandidate(h,r));
  return hs.sort((a,b)=>{
    const la=typeof bmbOdbWinLikelihood==='function'?Number(bmbOdbWinLikelihood(r,a)||0):0;
    const lb=typeof bmbOdbWinLikelihood==='function'?Number(bmbOdbWinLikelihood(r,b)||0):0;
    if(lb!==la) return lb-la;
    return (Number(b.score)||0)-(Number(a.score)||0);
  })[0]||null;
}
function tkpBombHunterPortfolioLabel(cands){
  const rows=Array.isArray(cands)?cands:[];
  const bombCount=rows.filter(c=>String(c?.kind||'BOMBA').toUpperCase()!=='ODB').length;
  const odbCount=rows.filter(c=>String(c?.kind||'').toUpperCase()==='ODB').length;
  return `${bombCount} Bomba + ${odbCount} ODB`;
}
function tkpBombHunterFinishLabel(r,c){
  const no=String(c?.horse_no??c?.h?.horse_no??'').trim();
  const name=typeof baseHorseName==='function'?baseHorseName(c?.horse_name??c?.h?.horse_name??''):String(c?.horse_name??c?.h?.horse_name??'').trim().toUpperCase();
  const horse=(r?.horses||[]).find(h=>{
    const horseNo=String(h?.horse_no??'').trim();
    const horseName=typeof baseHorseName==='function'?baseHorseName(h?.horse_name??''):String(h?.horse_name??'').trim().toUpperCase();
    return (no&&horseNo===no)||(name&&horseName===name);
  })||null;
  const position=Number(c?.finish_position??horse?.finish_position??0);
  const resultKnown=(r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  if(Number.isFinite(position)&&position>0){
    return `<b>${position}.</b> oldu`;
  }
  return resultKnown?'Sonuç: <b>İlk 5 dışı</b>':'Sonuç bekleniyor';
}
function tkpBombHunterPanelHTML(raceResults){
  // Arşiv sekmesinde Bomba Avcısı yeniden puanlanmaz. Eski kaydın BH
  // snapshotı varsa yalnız onu göster; yoksa kullanıcıya açıkça veri olmadığını
  // bildir. Aksi hâlde eski bir yarışta rec bulunamadığında tkpBombHunterCandidates
  // bütün geçmiş/profil zincirini yeniden çalıştırıp sekme tıklamasını bloke ediyordu.
  const archivedReadOnly=Array.isArray(raceResults)
    && raceResults.some(x=>typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x));
  if(archivedReadOnly){
    // R16.51 KÖK FIX: "veri aynı" hızlı yenilemesi (tkp-collector-bridge.js)
    // henüz hiç koşulmamış (sonuçsuz) bir toplantıyı da salt-okunur arşiv
    // moduyla açabiliyordu. Bu mod BH senkronunu (tkpBombHunterSync) atladığı
    // için, o toplantı için ilk canlı hesaplama henüz hiç yapılmamışsa/kaydı
    // henüz yazılmamışsa ekranda "kayıtlı BH/ODB snapshotı yok" görünüyordu --
    // oysa yarış bitmediği için burada gösterilecek "dondurulmuş" bir sonuç
    // henüz yok, gösterilecek olan zaten SADECE ilk canlı hesaptır. Sonuçlanmış
    // yarışlarda (leakage riski olan durumda) bu yol dokunulmaz kalır --
    // tkpBombHunterSync kendi "!hasResult" kilidiyle zaten korunuyor.
    const initialLog=typeof db!=='undefined'&&Array.isArray(db?.bomb_hunter_shadow_log)
      ? db.bomb_hunter_shadow_log : [];
    for(const x of (raceResults||[])){
      const r=x?.r||x; if(!r) continue;
      const key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(r):'';
      const hasResult=typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(r.horses||[]);
      const existing=key?initialLog.find(z=>z?.race_key===key):null;
      if(!existing && !hasResult){
        // Yarış henüz bitmedi ve hiç snapshot yok: ilk (ve TEK) canlı hesap
        // burada donar. Sonradan sonuç gelse bile bu picks bir daha değişmez.
        try{ tkpBombHunterSync([x]); }catch(_e){}
      }else if(existing && hasResult && !existing.evaluated_at){
        // Picks ZATEN yarıştan önce donmuştu (sonuç bilinmeden). Sonuç şimdi
        // geldi -- burada YENİ aday üretilmez, yalnız donmuş adayların
        // isabet/derece bilgisi güncel sonuçla işaretlenir (aynı tkpBombHunterSync
        // canlı moddaki "hasResult" dalıyla birebir aynı, salt-okunur arşivde de
        // çalışması gerekirdi). Böylece kupon/ayak tabloları gibi BH da yarış
        // saatinden SONRA da görünür kalır, kaybolmaz.
        try{ tkpBombHunterSync([x]); }catch(_e){}
      }
    }
    // tkpBombHunterSync yeni kayıtları db.bomb_hunter_shadow_log'a (kendi
    // tkpBombHunterEnsureLog() üzerinden, gerekirse diziyi ilk kez oluşturarak)
    // yazmış olabilir -- yukarıdaki initialLog o an boş bir yer tutucu olabilirdi,
    // bu yüzden gösterim burada güncel diziyi yeniden okur.
    const log=typeof db!=='undefined'&&Array.isArray(db?.bomb_hunter_shadow_log)
      ? db.bomb_hunter_shadow_log : initialLog;
    const rows=(raceResults||[]).map(x=>{
      const r=x?.r||x, key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(r):'';
      const rec=key?log.find(z=>z?.race_key===key):null;
      const snapshotRows=(Array.isArray(rec?.candidates)?rec.candidates:[]).slice();
      // Eski BH4 kaydında ODB satırı liste dışında kalmış olabilir. Yalnız yarış
      // öncesinde zaten dondurulmuş açık ODB işareti varsa üçüncü kategoriye eklenir;
      // sonuçtan yeni ODB türetilmez.
      if(!snapshotRows.some(row=>tkpBombHunterIsOdbRow(r,row))){
        const storedOdb=(r?.horses||[]).find(h=>Number(h?.odb)===1||h?.bmb_source==='ŞABLON KURALI');
        if(storedOdb)snapshotRows.push({kind:'ODB',horse_no:String(storedOdb.horse_no||''),horse_name:storedOdb.horse_name||'',score:Number(storedOdb.prediction_score_snapshot??storedOdb.score)||0,reasons:['Kayıtlı ODB snapshotı']});
      }
      const cands=tkpBombHunterCompleteArchivedPortfolio(r,snapshotRows);
      const content=cands.map(c=>{
        const no=String(c?.horse_no??c?.h?.horse_no??'').trim();
        if(!no)return '';
        const name=String(c?.horse_name??c?.h?.horse_name??'');
        const score=Number(c?.score);
        const result=` · <span class="bombHunterFinish">${tkpBombHunterFinishLabel(r,c)}</span>`;
        const noEsc=no.replace(/'/g,"\\'");
        const kind=c.kind==='ODB'?'ODB1':`BH${Number(c.category_rank)||1}`;
        return `<div class="bombHunterPick ${c.kind==='ODB'?'bombHunterOdbPick':'bombHunterBombPick'}"><div><span class="bombHunterKind">${kind}</span><span class="bombHunterNo">${esc(no)}</span><b>${esc(name)}</b><span class="bombHunterScore">BH ${fmt2(Number.isFinite(score)?score*100:0)}</span>${result}<div class="muted">${esc((c?.reasons||[]).join(' · ')||'Kayıtlı snapshot sinyali')}</div></div><div class="bombHunterActions"><button type="button" class="bombHunterAdd bombHunterAddAll" title="Bu BH adayını Normal + Sürpriz + Uzman/Kulis kuponlarının üçüne de ekle" onclick="addHorseToAllCoupons(${Number(r?.leg)||0},'${noEsc}')">+ 3 Kupona Ekle</button></div></div>`;
      }).join('');
      const portfolioLabel=tkpBombHunterPortfolioLabel(cands);
      const status=portfolioLabel==='3 Bomba + 1 ODB'?'Tam 3 Bomba + 1 ODB kaydı':'Kayıtlı yarış öncesi veride kategori adayı eksik';
      return `<div class="card bombHunterLeg"><h3 style="margin:0 0 7px;">${esc(r?.leg)}. AYAK · ${portfolioLabel}</h3><div class="muted" style="margin-bottom:7px;font-size:10px;">Kayıtlı BH snapshotı · ${status} · güncel model taranmadı</div>${content||'<div class="empty">Bu ayak için kayıtlı BH/ODB snapshotı yok.</div>'}</div>`;
    }).join('');
    return rows;
  }
  tkpBombHunterSync(raceResults);
  const rows=(raceResults||[]).map(x=>{
    const r=x?.r||x, key=tkpBombHunterRaceKey(r), rec=tkpBombHunterEnsureLog().find(z=>z?.race_key===key);
    const rawCandsAll=rec?.candidates||tkpBombHunterCandidates(r).map((z,i)=>({rank:i+1,kind:z.kind,category_rank:z.category_rank,horse_no:String(z.h.horse_no),horse_name:z.h.horse_name||'',score:z.score,near_win_score:z.near_win_score,reasons:z.reasons}));

    // V1.1.166 BH görünüm kilidi: aday zaten Normal/Geniş/Sürpriz kuponlardan birinde
    // olsa bile BH verisi GİZLENMEZ. Önceki filtre "içeride" adayları panelden siliyor,
    // kullanıcıya BH verisi eksikmiş gibi görünüyordu. BH kendi bağımsız takip listesidir.
    // Eski shadow kaydı 3+0 kalmış olsa da ekrandaki güncel sözleşmeyi uygula.
    // Tamamlama yalnız bu yarışın gerçek AGF 7+ atlarından yapılır.
    const cands=tkpBombHunterCompleteArchivedPortfolio(r,rawCandsAll);
    const winningProfile=tkpBombHunterWinningScoreProfile(r?.race_date||'');
    // Tahmin ilk 5'te olan bir eküri ortağı zaten ana seçim tarafından temsil edilir.
    // Diğer eküri BH kartında kalabilir fakat geçmiş-kazanan / en-yakın özel işareti ALMAZ.
    const topFiveSource=(Array.isArray(x?.scored)&&x.scored.length?x.scored:(r?.horses||[]).filter(h=>!isNonRunner(h)).slice().sort((a,b)=>(Number(b?.score)||0)-(Number(a?.score)||0))).slice(0,5);
    const blockedByTop5Ekuri=c=>topFiveSource.some(h=>String(h?.horse_no||'')!==String(c?.horse_no||'') && typeof sameEkuri==='function' && sameEkuri(h?.horse_no,c?.horse_no));
    const eligibleForHistoryMark=c=>!blockedByTop5Ekuri(c);
    const nonExactEligible=cands.filter(c=>eligibleForHistoryMark(c)&&!tkpBombHunterMatchesPastWinningScore(c,winningProfile));
    // Geçmiş kazanan puanına birebir uyanlar ayrıca işaretlenir. Birebir eşleşme dışındaki
    // adaylardan kazanan BH puanlarına mesafesi en küçük İKİ at işaretlenir.
    const nearestProfileKeys=new Set(
      winningProfile.count
        ? nonExactEligible.slice().sort((a,b)=>tkpBombHunterWinnerProfileDistance(a,winningProfile)-tkpBombHunterWinnerProfileDistance(b,winningProfile)).slice(0,2).map(c=>String(c.horse_no))
        : []
    );

    const content=cands.map(c=>{
      const result=` · <span class="bombHunterFinish">${tkpBombHunterFinishLabel(r,c)}</span>`;
      const canMark=eligibleForHistoryMark(c);
      const pastWinningScore=canMark&&tkpBombHunterMatchesPastWinningScore(c,winningProfile);
      const nearWinnerProfile=canMark&&!pastWinningScore&&nearestProfileKeys.has(String(c.horse_no));
      const noEsc=String(c.horse_no).replace(/'/g,"\\'");
      const kind=c.kind==='ODB'?'ODB1':`BH${Number(c.category_rank)||1}`;
      return `<div class="bombHunterPick ${c.kind==='ODB'?'bombHunterOdbPick':'bombHunterBombPick'}${pastWinningScore?' bhPastWinnerScore':''}${nearWinnerProfile?' bhWinnerProfileNear':''}"><div><span class="bombHunterKind">${kind}</span><span class="bombHunterNo">${esc(c.horse_no)}</span><b>${esc(c.horse_name)}</b><span class="bombHunterScore">BH ${fmt2(Number(c.score)*100)}</span>${pastWinningScore?`<span class="bhPastWinnerBadge">🏆 Geçmiş kazanan</span>`:''}${nearWinnerProfile?`<span class="bhWinnerProfileBadge">◎ En yakın kazanan BH</span>`:''}${result}<div class="muted">${esc((c.reasons||[]).join(' · ')||'Bağımsız sürpriz sinyali')}</div></div><div class="bombHunterActions"><button type="button" class="bombHunterAdd bombHunterAddAll" title="Bu BH adayını Normal + Sürpriz + Uzman/Kulis kuponlarının üçüne de ekle" onclick="addHorseToAllCoupons(${Number(r.leg)||0},'${noEsc}')">+ 3 Kupona Ekle</button></div></div>`;
    }).join('');
    const portfolioLabel=tkpBombHunterPortfolioLabel(cands);
    const status=portfolioLabel==='3 Bomba + 1 ODB'?'Kazanma yakınlığına göre seçildi':'Yarışta dört ayrı uygun sürpriz adayı yok';
    return `<div class="card bombHunterLeg"><h3 style="margin:0 0 7px;">${esc(r.leg)}. AYAK · ${portfolioLabel}</h3><div class="muted" style="margin-bottom:7px;font-size:10px;">${status}</div>${content||'<div class="empty">Uygun gerçek Bomba/ODB adayı yok.</div>'}</div>`;
  }).join('');
  // BH sekmesinin üstünde açıklama/istatistik/uyarı kartı yok. Doğrudan ayak başına
  // tam olarak üç Bomba + bir ODB hedeflenir; dört ayrı gerçek at yoksa eksik gösterilir.
  return rows;
}


async function tkpPrepareSharedScoringContext(options={}){
  const archivedFastOpen=options.archivedFastOpen===true;
  const rules=archivedFastOpen?[]:(await getCurrentRulesAsync()).filter(x=>x.single>=db.settings.best_min_single).slice(0,50);
  if(!archivedFastOpen) tkpPreparePredictionStats();
  if(typeof tkpYield==='function') await tkpYield();
  return {
    rules,
    hippoSigStats:(!archivedFastOpen&&typeof hippodromeSignalStats==='function')?hippodromeSignalStats():[],
    globalSigStats:(!archivedFastOpen&&typeof globalSignalStats==='function')?globalSignalStats():null
  };
}

async function tkpScoreAndSealRace(r,options={}){
  normalizeRaceObj(r);
  const recompute=options.recompute===true;
  const archivedReadOnly=options.archivedReadOnly===true;
  // R16.14: tahmin kritik yolunda tarihsel ağır analizleri çalıştırma.
  // Bu mod yalnız mevcut yarış-öncesi/precomputed alanları kullanır; ağır profil
  // istatistikleri ilgili analiz panelinde/cache ısıtmasında hazırlanır.
  const fastContext=options.fastContext===true;
  const archivedRace=!recompute&&(archivedReadOnly?tkpRaceArchivedScoresReadyForDisplay(r):tkpRaceArchivedScoresReady(r));
  const rules=Array.isArray(options.rules)?options.rules:[];
  const _hippoSigStats2=Array.isArray(options.hippoSigStats)?options.hippoSigStats:(fastContext?[]:((typeof hippodromeSignalStats==='function')?hippodromeSignalStats():[]));
  const _globalSigStats2=options.globalSigStats!==undefined?options.globalSigStats:(fastContext?null:((typeof globalSignalStats==='function')?globalSignalStats():null));
  let cond = broadConditionKey(r.condition_family);
  const _emptyRank={stats:{},match:{label:'Hızlı yol'}};
  const _emptyBmb={bmbRaces:0,bmbWin:0,match:{label:'Hızlı yol'}};
  const detSonuc=archivedRace?{stats:{},match:{label:'Kayıtlı ODS'}}:(fastContext?_emptyRank:detailedRankStats(r,'result_rank'));
  const detAgf=archivedRace?{stats:{},match:{label:'Kayıtlı ODS'}}:(fastContext?_emptyRank:detailedRankStats(r,'agf_rank'));
  const detBmb=archivedRace?{bmbRaces:0,bmbWin:0,match:{label:'Kayıtlı ODS'}}:(fastContext?_emptyBmb:detailedBmbStats(r));
  let csSonuc=detSonuc.stats;
  let csAgf=detAgf.stats;
  let csBmb=detBmb;
  const _hippoEntry2 = _hippoSigStats2.find(([k])=>k===r.hippodrome);
  const _hippoBmb2 = _hippoEntry2 ? _hippoEntry2[1].bmb : null;
  const _hippoR62 = _hippoEntry2 ? _hippoEntry2[1].r6 : null;
  const _globalSonucLb2 = _globalSigStats2 ? ((_globalSigStats2.r1.p1+_globalSigStats2.r26.p1)/Math.max(1,_globalSigStats2.r1.total+_globalSigStats2.r26.total)) : 0;
  // V1.1.116: KOŞMAZ atı yarış kaydından SİLME. Skor/kupon hesabından çıkar,
  // fakat r.horses içinde koru ki ekranda en altta KOŞMAZ olarak gösterilebilsin.
  const scoringHorses = (r.horses||[]).filter(h => !isNonRunner(h));
  // Geçmiş toplantı açılışı yalnız yarış-öncesi kilit/snapshot/log kaydını okur.
  // Eksik snapshot sonuçtan veya güncel modelden yeniden üretilmez; böylece hem
  // ileriye-sızıntı hem de 509 dosyalık depoda ağır kural/istatistik taraması önlenir.
  if(archivedReadOnly){
    const scored=scoringHorses.map((h,index)=>{
      if(tkpArchivedHorseScoreReady(r,h)) return {...tkpRestoreArchivedHorseScore(r,h),_tkpArchiveInputOrder:index};
      return {...h,score:0,bestLb:0,scoreParts:{},why:['Doğrulanmış yarış-öncesi tahmin snapshotı yok'],_tkpSnapshotMissing:true,_tkpArchiveInputOrder:index};
    }).sort((a,b)=>{
      const ar=Number(a.prediction_order_snapshot??a._strategy_rank);
      const br=Number(b.prediction_order_snapshot??b._strategy_rank);
      const av=Number.isFinite(ar)&&ar>0?ar:Number.MAX_SAFE_INTEGER;
      const bv=Number.isFinite(br)&&br>0?br:Number.MAX_SAFE_INTEGER;
      return av-bv || a._tkpArchiveInputOrder-b._tkpArchiveInputOrder;
    });
    return {scored,hasConfirmedResultForScore:raceHasConfirmedResult(scoringHorses)};
  }
  // V1.1.259 HIZ: Accurate normalizasyonu yarış içinde sabittir. Eski kod her at için
  // tüm atları iki kez filter/map ederek O(n²) iş yapıyordu. Aralığı yarış başına bir
  // kez hesapla; at başına yalnız O(1) normalizasyon bırak.
  const _accNumberOrNull=value=>{
    if(value===null||value===undefined||String(value).trim()==='')return null;
    const n=Number(value);return Number.isFinite(n)?n:null;
  };
  const _accSpeedVals=scoringHorses.map(x=>_accNumberOrNull(x.priorAccurateAvgSpeed)).filter(v=>v!==null&&v>0);
  const _accFinishVals=scoringHorses.map(x=>_accNumberOrNull(x.priorAccurateFinishSignal)).filter(v=>v!==null);
  const _accSpeedMin=_accSpeedVals.length?Math.min(..._accSpeedVals):0,_accSpeedMax=_accSpeedVals.length?Math.max(..._accSpeedVals):0;
  const _accFinishMin=_accFinishVals.length?Math.min(..._accFinishVals):0,_accFinishMax=_accFinishVals.length?Math.max(..._accFinishVals):0;
  const _normAcc=(val,vals,min,max)=>{val=_accNumberOrNull(val);if(val===null||vals.length<2)return 0;return max>min?Math.max(0,Math.min(1,(val-min)/(max-min))):0.5;};
  const hasConfirmedResultForScore = raceHasConfirmedResult(scoringHorses);
  // PERF FIX (V1.1.212): `selected` yalnızca rule+r'ye bağlıydı (h'ye değil) ama
  // eskiden HER at için HER eşleşen kuralda scoringHorses baştan taranıyordu
  // (O(at² × kural) / yarış). Artık kural başına TEK SEFER hesaplanıp cache'leniyor;
  // at döngüsü sadece bu haritadan okuyor. Sonuç birebir aynı, sadece tekrar iş yok.
  const _ruleMatchCache = archivedRace ? null : new Map();
  const matchedHorsesForRule = rule => {
    if (_ruleMatchCache.has(rule)) return _ruleMatchCache.get(rule);
    const selected = scoringHorses.filter(x => rule.features.every(ft => ft.test(x,r)));
    _ruleMatchCache.set(rule, selected);
    return selected;
  };
  let scored;
  if(archivedRace){
    scored=scoringHorses.map(h=>tkpRestoreArchivedHorseScore(r,h));
  }else{
    scored=[];
    for(let _scoreIndex=0;_scoreIndex<scoringHorses.length;_scoreIndex++){
    const h=scoringHorses[_scoreIndex];
    let score = 0, why = [], bestLb = 0, scoreParts={rules:0,bmb:0,result6:0,horseHist:0,condHist:0,gpr:0,last6:0,rank:0,kg:0,degree:0,common:0,contra:0,atr:0,usa:0,accurate:0};
    for (const rule of rules){
      if (rule.features.every(ft => ft.test(h,r))){
        let selected = matchedHorsesForRule(rule);
        if (selected.length === 1){
          let w = Math.max(0, rule.lb - 0.20) * (1 + 0.08*(rule.features.length-1));
          score += w; scoreParts.rules += w;
          bestLb = Math.max(bestLb, rule.lb);
          why.push(`${rule.name} | geçmiş ${rule.singleWins}/${rule.single} | alt güven %${fmtPct(rule.lb*100)}`);
        }
      }
    }
    // Dosya sinyali bonusu: yalnızca yüklenen ODS'deki gerçek BMB ve SONUÇ ilk 6.
    // AGF, TRACE veya yapay SP/BMB sinyali üretilmez.
    let rkS = h.result_rank;
    if (h.bmb === 1){
      let pctB = (typeof contextualSignalPct==='function')
        ? contextualSignalPct(_hippoBmb2?.total, _hippoBmb2?.p1, csBmb?.bmbRaces, csBmb?.bmbWin, _globalSigStats2?.bmb?.lb)
        : ((csBmb && csBmb.bmbRaces) ? csBmb.bmbWin/csBmb.bmbRaces : 0);
      if (pctB > 0){
        score += pctB * 0.6; scoreParts.bmb += pctB * 0.6;
        why.push(`Dosya BMB: ${detBmb.match.label} profilinde gerçek BMB işaretli atlar geçmişte %${fmtPct(pctB*100)} kazanmış`);
      } else {
        score += 0.15; scoreParts.bmb += 0.15;
        why.push('Yüklenen dosyada gerçek BMB işareti var');
      }
    }
    if (rkS != null && rkS <= 6){
      let pctS = (typeof contextualSignalPct==='function')
        ? contextualSignalPct(_hippoR62?.total, _hippoR62?.p1, csSonuc?.total, csSonuc?csSonuc[String(rkS)]:0, _globalSonucLb2)
        : ((csSonuc && csSonuc.total) ? (csSonuc[String(rkS)]||0)/csSonuc.total : 0);
      if (pctS > 0){
        score += pctS * 0.6; scoreParts.result6 += pctS * 0.6;
        why.push(`SONUÇ ilk 6: ${detSonuc.match.label} profilinde ${rkS}. sıradaki at geçmişte %${fmtPct(pctS*100)} kazanmış`);
      }
    }
    // At bazlı geçmiş kazanma bonusu: bu at (isim eşleşmesiyle) daha önce kayıtlı dosyalarda
    // koşup kazanmışsa, Wilson alt sınırı üzerinden ek puan alır (az örneklemde abartılı olmaz).
    // KÖK FIX: horseStats haritası kaldırıldı (ileriye-sızıntı içeriyordu); artık
    // computeHorsePriorStats() tarafından zaten doğrudan atanmış olan h.priorWins/
    // h.priorStarts (sızıntısız, zaman-sıralı) kullanılıyor.
    if (h.priorWins > 0){
      let hLb = wilson(h.priorWins, h.priorStarts);
      if (hLb > 0){
        score += hLb * 0.5; scoreParts.horseHist += hLb * 0.5;
        why.push(`At bazlı geçmiş: ${h.horse_name} önceki ${h.priorStarts} koşuda ${h.priorWins} kez kazanmış (alt güven %${fmtPct(hLb*100)})`);
      }
    }
    // Şarta özel at bazlı bonus: bu at AYNI koşu şartında (ör. Maiden, Handikap) daha önce
    // kazanmışsa, genel at-bazlı bonustan daha güçlü ağırlıkla puana yansır — çünkü şart
    // eşleşmesi (aynı tür yarışta kazanma geçmişi) daha spesifik/güvenilir bir sinyaldir.
    if (h.condWinPct > 0){
      score += h.condWinPct * 0.9; scoreParts.condHist += h.condWinPct * 0.9;
      why.push(`Bu şartta (${cond}) geçmiş: ${h.horse_name} önceki ${h.condWinStarts} koşuda ${h.condWinWins} kez kazanmış (alt güven %${fmtPct(h.condWinPct*100)})`);
    }
    const gpr=fastContext
      ? {starts:Number(h.gpr_starts)||0,wins:Number(h.gpr_wins)||0,strength:Math.max(0,Math.min(1,Number(h.gpr_strength)||0)),level:'Önbellek'}
      : (typeof similarConditionProfileStats==='function'?similarConditionProfileStats(r,h):{starts:0,wins:0,strength:0,level:'Veri yok'});
    h.gpr_starts=Number(gpr.starts)||0;
    h.gpr_wins=Number(gpr.wins)||0;
    h.gpr_strength=Math.max(0,Math.min(1,Number(gpr.strength)||0));
    if(gpr.starts>0){
      const gprBonus=gpr.strength*0.18;
      score+=gprBonus; scoreParts.gpr+=gprBonus;
      why.push(`G.PR ${gpr.level}: ${gpr.wins}/${gpr.starts} kazandı`);
    }
    const lastSix=typeof tkpLastSixStats==='function'?tkpLastSixStats(h):{starts:0,wins:0,top3:0,form:0};
    if(lastSix.starts>0){
      const formBonus=lastSix.form*0.12;
      score+=formBonus; scoreParts.last6+=formBonus;
      why.push(`Son 6 yarış: ${lastSix.wins}/${lastSix.starts} galibiyet · ${lastSix.top3} ilk-3`);
    }
    // SONUÇ sırası ve AGF 1-4 sinyalleri, sıralamaya "birlikte" katkı yapsın diye skora
    // küçük (ana sinyalleri ezmeyen) ek puanlar olarak yansır. Böylece nihai sıralama tek
    // başına kural sayısına değil, SONUÇ sırası + kural sayısı + geçmiş kazanma yüzdesi +
    // AGF 1-4 favoriliğinin BİRLİKTE etkisine göre şekillenir.
    if (h.result_rank != null){
      let rr = Number(h.result_rank);
      let rb = rr===1 ? 0.16 :
               rr===2 ? 0.13 :
               rr===3 ? 0.10 :
               rr===4 ? 0.08 :
               rr===5 ? 0.05 :
               rr===6 ? 0.03 : 0;
      score += rb;
      scoreParts.rank += rb;
    }
    // AGF 1-4 favoriliği: yorumda belirtilen "birlikte" etkiye eksik kalan parça —
    // TKP skoruna küçük bir katkı olarak eklenir. TKP skoru zaten kural ve koşu uyumu bileşeninin
    // %30'unu oluşturduğundan, bu katkı otomatik olarak ilgili birleşik değerlendirmeye
    // da yayılır; ayrı ayrı hesaplama yapmaya gerek kalmaz.
    if (h.agf_rank != null && h.agf_rank <= 4){
      let ab=Math.max(0, 5 - h.agf_rank) * 0.015; score += ab; scoreParts.rank += ab;
    }
    // Yeni sinyaller: KG ve DERECE ana modeli ezmez; yalnız aynı ayak içindeki rakiplere göre
    // hafif kilo ve hızlı kişisel dereceyi küçük puanla ödüllendirir.
    // İngilizce At The Races verisi yüksek ağırlıklı dış sinyaldir.
    // OR yarış içindeki göreli sırasına, son form ve uzman yorumuna birlikte bakılır.
    if(h.atr_source==='At The Races'){
      const atrRows=(r.horses||[]).filter(x=>x.atr_source==='At The Races');
      const ors=atrRows.map(x=>Number(x.atr_or)).filter(Number.isFinite).sort((a,b)=>b-a);
      const orRank=Number.isFinite(Number(h.atr_or)) ? (ors.indexOf(Number(h.atr_or))+1) : 0;
      const orBonus=orRank===1?0.72:orRank===2?0.52:orRank===3?0.34:orRank===4?0.18:0.06;
      const formBonus=Math.max(0,Math.min(1,Number(h.atr_form_score)||0))*0.68;
      const commentRaw=Math.max(-1,Math.min(1,Number(h.atr_comment_score)||0));
      const commentBonus=commentRaw>=0 ? commentRaw*0.62 : commentRaw*0.48;
      let atrBonus=orBonus+formBonus+commentBonus;
      if(h.atr_non_runner) atrBonus=-5;
      score+=atrBonus; scoreParts.atr+=atrBonus;
      if(atrBonus>0) why.push(`ATR yüksek ağırlık: OR ${h.atr_or??'-'} (sıra ${orRank||'-'}), form ${h.atr_form||'-'}, uzman yorum desteği ${Math.round(commentRaw*100)}%`);
      else if(atrBonus<0) why.push('ATR olumsuz/koşmaz sinyali');
    }
    // Genel yabancı kaynak desteği: yalnız güvenli eşleşmiş kaynaklar etkiler.
    // Kaynak sayısı küçük doğrulama bonusu; açık uzman/tip bağlamı daha belirgin fakat
    // sınırlı bonus verir. Böylece resmi/ünlü site verisi kupona etki eder ama ana TKP
    // mimarisini domine etmez.
    if(h.foreign_official_confirmed){
      const srcBonus=Math.min(.24,Math.max(0,Number(h.foreign_source_count)||1)*.08);
      const ctxBonus=Math.max(0,Math.min(1,Number(h.foreign_context_score)||0))*.42;
      const foreignBonus=srcBonus+ctxBonus;
      score+=foreignBonus; scoreParts.usa+=foreignBonus;
      if(foreignBonus>0) why.push(`Yabancı kaynak: ${Number(h.foreign_source_count)||1} doğrulama · uzman ${(Number(h.foreign_context_score)||0)>0?Math.round(Number(h.foreign_context_score)*100)+'%':'-'}`);
    }
    if(h.usa_source_nyra){
      // NYRA katmanı yalnız Saratoga'da gelir. ATR ile aynı form/OR bilgisini tekrar
      // puanlamaz; yalnız canlı piyasa, NYRA uzman seçimi ve workout sırasını kullanır.
      const liveRows=(r.horses||[]).filter(x=>x.usa_source_nyra&&Number.isFinite(Number(x.usa_live_prob))&&!x.usa_scratched).sort((a,b)=>Number(b.usa_live_prob)-Number(a.usa_live_prob));
      const marketRank=liveRows.findIndex(x=>x===h)+1;
      const marketBonus=marketRank===1?0.34:marketRank===2?0.24:marketRank===3?0.16:marketRank===4?0.09:0.03;
      const expertBonus=Math.max(0,Math.min(1,Number(h.usa_expert_score)||0))*0.28;
      const workBonus=Math.max(0,Math.min(1,Number(h.usa_work_score)||0))*0.22;
      let usaBonus=Math.min(0.72,marketBonus+expertBonus+workBonus);
      if(h.usa_scratched) usaBonus=-5;
      score+=usaBonus; scoreParts.usa+=usaBonus;
      if(usaBonus>0) why.push(`NYRA: canlı oran sıra ${marketRank||'-'} · uzman ${Math.round((Number(h.usa_expert_score)||0)*100)}% · work ${Math.round((Number(h.usa_work_score)||0)*100)}%${h.usa_equibase_confirmed?' · Equibase doğrulandı':''}`);
      else if(usaBonus<0) why.push('NYRA: koşmaz/scratch');
    }
    const kgSig = typeof tkpKgSignalValue==='function' ? tkpKgSignalValue(r,h) : 0;
    const degSig = typeof tkpDegreeSignalValue==='function' ? tkpDegreeSignalValue(r,h) : 0;
    if (kgSig > 0){ const kb = kgSig * 0.035; score += kb; scoreParts.kg += kb; }
    if (degSig > 0){ const degreeModel = (!fastContext&&typeof adaptiveWeightsForRace==='function'?adaptiveWeightsForRace(r,1):null); const dw = Math.min(30, Number(degreeModel?.weights?.degree)||18)/30; const db = Math.min(0.30, degSig * (0.10 + 0.20*dw)); score += db; scoreParts.degree += db; }
    // Düşük AGF/profil, güçlü galop ve dereceyi otomatik yok saymamalı.
    // Bu nadir kontra kombinasyon BMB üretmez; fakat sürpriz adayın ana
    // sıralamada kaybolmasını engelleyen sınırlı bir çapraz-sinyal bonusudur.
    const galopRank=Number(h.g800??h.g800_rank), resultRank=Number(h.result_rank), agfPct=Number(h.agf), profPct=typeof profileStrengthPct==='function'?Number(profileStrengthPct(r,h)):0;
    const galopDrcContra=galopRank>=1&&galopRank<=2&&degSig>=0.67&&resultRank>=4&&resultRank<=6&&agfPct>0&&agfPct<=12&&profPct>=0&&profPct<=40;
    h.galop_drc_contra=galopDrcContra?1:0;
    if(galopDrcContra){ const contraBonus=.18; score+=contraBonus; scoreParts.contra+=contraBonus; why.push(`Kontra aday: 800G ${galopRank} + güçlü DRC + SONUÇ ${resultRank}; düşük AGF/profil nedeniyle ezilmedi`); }
    // KÖK DÜZELTME (2026-08-09, kullanıcı uyarısı: "yarış öncesi her atta accurate
    // verisi olmayabilir"): Accurate verisi (accurate_avg_speed_mps/accurate_finish_signal)
    // yalnız SONUÇ ile birlikte, yarış BİTTİKTEN SONRA toplanır -- kupon kurulurken
    // (yarış henüz koşulmamışken) o yarışın KENDİ Accurate verisi asla mevcut değildir.
    // Önceki sürüm yanlışlıkla yarışın kendi verisini kullanıyordu (gerçek kullanımda
    // hep boş kalıp hiç etki etmiyordu). Artık atın DAHA ÖNCEKİ yarışlarındaki
    // sızıntısız ortalaması (computeHorsePriorAccurateStats -> priorAccurateAvgSpeed/
    // priorAccurateFinishSignal) kullanılıyor -- bu, kupon kurulurken GERÇEKTEN elde
    // mevcut olan bir bilgidir.
    const accSpeedSig=_normAcc(h.priorAccurateAvgSpeed,_accSpeedVals,_accSpeedMin,_accSpeedMax);
    const accFinishSig=_normAcc(h.priorAccurateFinishSignal,_accFinishVals,_accFinishMin,_accFinishMax);
    const accSig=Math.max(accSpeedSig,accFinishSig);
    if (accSig > 0){ const ab = accSig * 0.28; score += ab; scoreParts.accurate += ab; if(accSig>=0.85) why.push('Accurate: geçmiş yarışlarında ortalama hız/bitiriş sinyalinde en güçlü'); }
    // Ana TKP, ortak veri hesabından türetilir. AGF/PROF/Y.PUAN/G.PR/DRC/TR
    // toplamı %65; önceki kural/öğrenme katmanı %35 yardımcı ağırlıktadır.
    // Böylece eski skor yalnız küçük ek olarak kalır, ortak veriyi ezemez.
    const commonEvidence=tkpCommonEvidenceForHorse(r,h,{noScan:fastContext});
    h.tkp_common_evidence=commonEvidence.value;
    if(commonEvidence.parts.length){
      const legacyScore=score;
      h.tkp_legacy_score=legacyScore;
      // Görünen TKP ham birleşik puanın üçte biridir ve 10,00 üst sınırını
      // aşmaz. Bu yalnız ekran ölçeğidir; sıralama/kupon iç katsayısı ayrı kalır.
      const tkpRawDisplay=Math.round((commonEvidence.value*10+legacyScore)*100)/100;
      if(typeof tkpWriteVisibleDisplayScore==='function') tkpWriteVisibleDisplayScore(h,tkpRawDisplay);
      else h.tkp_display_score=Math.round(Math.max(0,Math.min(10,tkpRawDisplay/3))*100)/100;
      for(const key of Object.keys(scoreParts)) scoreParts[key]=Number(scoreParts[key]||0)*.35;
      const commonPart=commonEvidence.value*.65;
      score=legacyScore*.35+commonPart;
      scoreParts.common=commonPart;
      why.push(`Ortak veri (%65): ${commonEvidence.parts.map(([name,value])=>`${name} %${Math.round(value*100)}`).join(' · ')}`);
    }
    // Y.PUAN'ın eski ana katkısı korunur. Buna ek olarak yalnız doğrulanmış
    // yarış öncesi yorumcu kayıtlarının başarı farkı küçük bir öncelik verir;
    // en başarılı yorumcu destekleri tahmin sırasına yansır, ham/anonim yorum
    // tek başına atı lider yapamaz.
    if(!archivedRace&&!fastContext&&typeof globalThis.tkpCommentatorConsensus==='function'){
      try{
        const consensus=globalThis.tkpCommentatorConsensus(r,h);
        const priority=Number(globalThis.TKP_COUPON_POLICY?.commentPriority?.(r,h)?.score)||0;
        const ratio=Math.max(0,Math.min(1,Number(consensus?.ratio)||0));
        const verified=(consensus?.comments||[]).filter(c=>Number(c?.events)>0&&Number(c?.edge)>0).length;
        const boost=Math.min(.18,priority*.12+Math.min(.06,ratio*.03*(verified?1:0)));
        if(boost>0){score+=boost;scoreParts.commentator=boost;why.push(`Başarılı yorumcu önceliği: ${verified} doğrulanmış destek`);}
      }catch(_){ }
    }
    scored.push(sealDisplayedPredictionScore(r,h,{...h, score, why, bestLb, scoreParts},hasConfirmedResultForScore));
    if(fastContext&&_scoreIndex%2===1&&typeof tkpYield==='function')await tkpYield();
    }
  }
  scored.sort((a,b) => {
    // KESİN ADAY SIRALAMASI — görsel yapıdan bağımsızdır:
    // 1) Yüklenen dosyada SONUÇ sırası ilk 6 olanlar
    // 2) Yüklenen dosyada gerçekten işaretli BMB
    // 3) Bu şartlara uymayanlardan yalnızca depoda geçmiş kazanma istatistiği bulunanlar
    // 4) Diğerleri en sonda; sistem kendiliğinden BMB/TRACE/SP üretmez
    function historyStrength(h){
      const general = (h.priorWins>0 && h.priorStarts>0) ? wilson(h.priorWins, h.priorStarts) : 0;
      const condition = h.condWinPct || 0;
      return Math.max(condition, general);
    }
    function bucket(h){
      if (h.result_rank!=null && h.result_rank<=6) return 0;
      if (h.bmb) return 1;
      return historyStrength(h)>0 ? 2 : 3;
    }
    const ba = bucket(a), bb = bucket(b);
    if (ba !== bb) return ba - bb;
  
    // İlk 6 ve BMB gruplarında kullanıcı isteği gereği önce toplam skor.
    if (ba === 0 || ba === 1){
      if ((a.score||0) !== (b.score||0)) return (b.score||0) - (a.score||0);
    }
  
    // Kalan geçmişli atlarda önce doğrulanmış geçmiş kazanma gücü.
    if (ba === 2){
      const aStat = historyStrength(a), bStat = historyStrength(b);
      if (aStat !== bStat) return bStat - aStat;
      if ((a.condWinWins||0) !== (b.condWinWins||0)) return (b.condWinWins||0) - (a.condWinWins||0);
      if ((a.priorWins||0) !== (b.priorWins||0)) return (b.priorWins||0) - (a.priorWins||0);
    }
  
    // Aynı gruptaki son eşitlik bozucu: nihai skor, ardından SONUÇ sırası ve at numarası.
    if ((a.score||0) !== (b.score||0)) return (b.score||0) - (a.score||0);
    const ar = a.result_rank==null ? 999 : a.result_rank;
    const br = b.result_rank==null ? 999 : b.result_rank;
    if (ar !== br) return ar - br;
    return TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||''));
  });
  // Görünen tahmin, kuponlar ve tek kararı aynı eski-ZIP adaptif sırasını kullanır.
  // Y.PUAN bu sırada kontrollü yorumcu desteğidir; ham Y.PUAN sıralaması yapılmaz.
  // İlk ekran boyası model eğitimini beklemez. Kalıcı eğitim cache'i varsa anında
  // kullanılır; yoksa doğrulanmış mevcut sıra (trust=0 güvenli öncül) ile ekran
  // kurulur ve tam eğitim render bittikten sonra arka planda hazırlanır.
  if(typeof globalThis.tkpPrimeOnlinePositionsForImmediateRender==='function')globalThis.tkpPrimeOnlinePositionsForImmediateRender(r,[1]);
  if(!hasConfirmedResultForScore&&typeof adaptiveSignalStatsAsync==='function')await adaptiveSignalStatsAsync(r);
  scored = sealStrategicPredictionOrder(r, scored, hasConfirmedResultForScore);
  if(options.forceHistoricalLock){
    scored.forEach((h,i)=>{
      h.prediction_order_snapshot=i+1;
      h._strategy_rank=i+1;
      if(typeof capturePredictionScoreSnapshot==='function')capturePredictionScoreSnapshot(h,true,true);
    });
  }
  return {scored,hasConfirmedResultForScore};
}

globalThis.tkpPrepareSharedScoringContext=tkpPrepareSharedScoringContext;
globalThis.tkpScoreAndSealRace=tkpScoreAndSealRace;


function tkpFastFirstLookConfidence(x,h){
  const candidates=[
    h?.single_confidence_snapshot,
    h?.winner_confidence_snapshot,
    h?.archived_confidence_snapshot,
    h?.altili_winner_score,
    h?.sidebet_p1_score
  ];
  for(const raw of candidates){const n=Number(raw);if(Number.isFinite(n)&&n>=0)return Math.max(0,Math.min(100,Math.round(n)));}
  // Existing pre-race forward snapshot is canonical evidence and is cheap to read
  // through a tiny tail scan; never compute heavy historical models on first paint.
  const key=typeof tkpForwardTrackingKey==='function'?tkpForwardTrackingKey(x?.r||{}):'';
  const log=Array.isArray(db?.forward_tracking_log)?db.forward_tracking_log:[];
  for(let i=log.length-1,seen=0;i>=0&&seen<96;i--,seen++){
    const row=log[i];if(key&&String(row?.race_key||'')!==String(key))continue;
    if(String(row?.leader_no||'')!==String(h?.horse_no||''))continue;
    const n=Number(row?.single_confidence);if(Number.isFinite(n)&&n>=0)return Math.max(0,Math.min(100,Math.round(n)));
  }
  return null;
}
if(typeof globalThis!=='undefined')globalThis.tkpFastFirstLookConfidence=tkpFastFirstLookConfidence;

async function renderPredictionScreen(displayRaces2, logPayload, renderOptions={}){
      // R16.52: otomatik tarihsel 509 snapshot işi bu render ile yarışmasın.
      // İlk DOM boyası sonrasında aşağıda 900 ms'e indirilir; render exception
      // olursa da arka plan kuyruğu en fazla 5 sn bekler, 30 sn'lik donma üretmez.
      globalThis.__tkpPredictionRenderPressureUntil=Date.now()+5000;
      const renderGeneration=++_tkpPredictionRenderGeneration;
      const predictionRenderStarted=(typeof tkpNow==='function'?tkpNow():((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now()));
      const predictionTarget=$('#predictionResult');
      if(predictionTarget&&!renderOptions?.preservePredictionDom) predictionTarget.innerHTML='<div class="card" style="border-left:5px solid #2563eb;">Tahmin hazırlanıyor…</div>';
      if(typeof tkpYield==='function') await tkpYield();
      // Sistem panelinde tahminin bekleme/hesap ve görünüm maliyetleri ayrı görülür.
      // Böylece kullanıcı ölçümünde darboğazın kural-skora mı DOM'a mı ait olduğu
      // anlaşılır; bu kayıt hiçbir hesaplamayı başlatmaz veya değiştirmez.
      const predictionScoringStarted=(typeof tkpNow==='function'?tkpNow():((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now()));
      const archivedReadOnly=renderOptions?.archivedReadOnly===true;
      const forceRecompute=renderOptions?.recompute===true;
      // Veri toplayıcı İlk Bakış'ı çizdikten sonra üç kuponu zorunlu olarak önce
      // bitirir. Bu kısa kritik fazda hiçbir ağır panel/bağlam ısıtması kupon
      // görevini sırada bekletemez; collector bu render'a runId ile gelir.
      const collectorCriticalPhase=renderOptions?.criticalPhase===true;
      const collectorRunId=String(renderOptions?.collectorRunId||'');
      const fullRecompute=forceRecompute&&renderOptions?.forceFullContext===true;
      const archivedFastOpen=archivedReadOnly || (!forceRecompute&&(displayRaces2||[]).length>0 && displayRaces2.every(r=>tkpRaceArchivedScoresReady(r)));
      // İLK BOYA SÖZLEŞMESİ: Kural cache'i yokken burada `await getCurrentRulesAsync()`
      // yapmak, İlk Bakış kartını dakika seviyesinde geciktirebiliyordu. Önce geçerli
      // bellek/kalıcı cache kullanılır; cache yoksa ilk görünüm veri sinyalleriyle hemen
      // açılır ve tam model ayrı kuyrukta bitince yalnız aynı toplantı tazelenir.
      // Böylece hiçbir eski/uydurma sonuç kullanılmaz, yalnız ilk ekran rehin alınmaz.
      const cachedRules=archivedFastOpen?[]:(typeof tkpPeekCurrentRules==='function'?tkpPeekCurrentRules():null);
      const boundedReplay=renderOptions?.boundedReplay===true;
      const statsReady=archivedFastOpen||boundedReplay||tkpPredictionStatsReady();
      const deferFullContext=!archivedFastOpen&&renderOptions?.deferredContextRefresh!==true&&(!Array.isArray(cachedRules)||!statsReady);
      // Gerçek Win8.1 donma raporu: collector ilk çiziminde güven/kalibrasyon
      // kartları 56 sn ana iş parçacığını tuttu. Kritik ilk boyada yalnız hazır
      // skor gösterilir; ağır açıklama/kalibrasyon kupon sonrası veya ilgili
      // sekme kullanıcı tarafından açıldığında hesaplanır.
      const fastFirstPaint=collectorCriticalPhase||deferFullContext;
      let rules=archivedFastOpen?[]:(Array.isArray(cachedRules)?cachedRules:[]);
      rules=rules.filter(x => x.single >= db.settings.best_min_single).slice(0,50);
      if(typeof tkpYield==='function') await tkpYield();
      let html = '';
      let raceResults = [];
      const _hippoSigStats2 = (!archivedFastOpen && !fastFirstPaint && typeof hippodromeSignalStats==='function') ? hippodromeSignalStats() : [];
      const _globalSigStats2 = (!archivedFastOpen && !fastFirstPaint && typeof globalSignalStats==='function') ? globalSignalStats() : null;
      for (const r of displayRaces2){
        const _scorePack=await tkpScoreAndSealRace(r,{rules,hippoSigStats:_hippoSigStats2,globalSigStats:_globalSigStats2,archivedReadOnly,recompute:forceRecompute,fastContext:(collectorCriticalPhase||deferFullContext||renderOptions?.deferredContextRefresh===true)});
        let scored=_scorePack.scored;
        const hasConfirmedResultForScore=_scorePack.hasConfirmedResultForScore;
        let top = scored[0], second = scored[1], third = scored[2];
        let margin = (top?.score||0) - (second?.score||0);
        const raceResult={r, scored, top, second, third, margin};
        // Arşiv sekmeleri canlı öğrenme/kupon motorundan ayrılır. Bu işaret yalnız
        // bellekteki kopyadadır; kayıtlı yarışın verisini değiştirmez ve canlı çağrıyı
        // etkilemez. UI bileşenleri bu sayede frozen snapshot yolunu seçebilir.
        if(archivedReadOnly){
          r.__tkpArchivedReadOnly=true;
          raceResult.__tkpArchivedReadOnly=true;
        }
        raceResults.push(raceResult);
        if(typeof tkpYield==='function') await tkpYield();
        if(renderGeneration!==_tkpPredictionRenderGeneration) return false;
      }
      setLastRaceResults(raceResults);
      if(!archivedReadOnly)try{tkpSchedulePreRaceEvidenceCapture(raceResults);}catch(_e){}
      if(forceRecompute&&typeof activeCoupons!=='undefined'){
        for(const key of ['main','alt','surprise'])activeCoupons[key]=null;
      }
      try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → skor ve önbellek',predictionScoringStarted,null,{budgetMs:850});}catch(_e){}
      const predictionViewStarted=(typeof tkpNow==='function'?tkpNow():((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now()));
      // Ctrl+F5 sonrası RAM kuponları boşalır. Veri parmak izi değişmemişse daha
      // önce kalıcı kaydedilen tam kuponu at nesnelerine geri bağla; böylece kupon
      // ve yan bahis anahtarları aynı kalır, ağır geçmiş taraması tekrarlanmaz.
      try{if(!archivedReadOnly&&!forceRecompute&&typeof tkpRestoreCurrentCouponSnapshotIfFresh==='function')tkpRestoreCurrentCouponSnapshotIfFresh(raceResults);}catch(error){console.warn('Taze kupon snapshot geri yükleme uyarısı',error);}
      // V1.1.308-MEM-FIX: tkpPrewarmPredictionPanels() (performance-runtime.js)
      // tam da "Yan Bahis ilk tıklamada donmasın" için yazılmış ama hiçbir yerden
      // çağrılmıyordu -- bu yüzden panelin ağır sinyal/ağırlık hesabı (adaptiveSignalStats
      // + tkpPurposeWeightsForRace) kullanıcı sekmeye TIKLADIĞI anda, tek senkron
      // blokta çalışıp sayfayı "Yanıt vermiyor" durumuna düşürüyordu. Tahmin ekranı
      // kurulur kurulmaz aynı hesabı kullanıcı boştayken arka planda ısıtıp
      // önbelleğe yazıyoruz; görünüşte hiçbir şey değişmez, yalnız tıklama artık
      // zaten hazır önbelleği okur.
      // Eski yarış salt-okunur açılır. Arşiv açılışında yan bahis/adaptif ön-ısıtması
      // başlatmak gereksizdir; 3.000+ yarışlık geçmişi sekme tıklamasıyla yarıştırıp
      // ana iş parçacığını rehin bırakabiliyordu. Canlı tahmin yolu aynen korunur.
      // Yan-bahis/istatistik ön hazırlığı aşağıdaki tek post-kupon sahibinden
      // başlatılır. Render içindeki erken ikinci başlatma, aynı arşiv taramasını
      // kupon göreviyle yarıştırabiliyordu.
      // V1.1.308-MEM-FIX #3: Ayrıntılı Analiz'deki "Kendini Güncelleyen Model
      // Ailesi Analizi" tablosu (adaptiveLearningHTML) tkpPurposeWeightsForRace(null,
      // 'prediction'/'sidebet', 1-5) için AYRI, race-bağımsız ('ALL' profilli) bir
      // önbellek anahtarı kullanıyor -- Yan Bahis ısıtması bunu KAPSAMAZ. Bu tablo
      // sekme kuyruğunda en son çalışacak şekilde tasarlanmış olsa da, kendi
      // hesabı hâlâ tek senkron blok; ilk kez (veya veri değiştikten sonra ilk kez)
      // açılan Ayrıntılı Analiz'de tıpkı Yan Bahis'teki gibi "Yanıt vermiyor"a yol
      // açabiliyordu. Aynı yöntemle: kullanıcı boştayken, her pozisyon arasında
      // tarayıcıya nefes verilerek arka planda ısıtılır; tablo HTML'i veya görünümü
      // hiç değişmez, yalnız kullanıcı sekmeye tıkladığında hesap zaten önbellekte olur.
      // Adaptif ağırlık ısıtması da post-kupon sahibine taşındı.
      // BH/BMB/ODB ve yalnız AGF 6–8 takip kaydı küçük ve yarış-öncesi
      // zaman-kilitli bir işlemdir. Ağır ileri takip/backfill işini render yoluna
      // geri sokmaz; sonuç varsa yalnız var olan immutable kaydı çözer.
      // Surprise cohort sync'i de ilk ekran/kupon sonrası çalışır.
      // R19.2: İleri Takip/haftalık kanıt ilk boyayı bekletmez; yukarıdaki tek
      // background capture yarış sonucu gelmeden immutable kanıtı dondurur. Ağır
      // analiz/backfill yine render kritik yoluna girmez.
      if (logPayload) savePredictionSnapshot(logPayload, raceResults,{deferSideBetRankings:fastFirstPaint});
      // Tam model arka yenilemesi ilk kupon kartlarını silmemeli. Özellikle
      // collector'da kartlar ilk boya sonrası oluşurken eski kod bu alanı tekrar
      // boşaltıp kullanıcıya "kupon kayboldu" görüntüsü veriyordu.
      if ($('#budgetCouponResult')&&!renderOptions?.preserveCouponDom) $('#budgetCouponResult').innerHTML = '';

      function scoreColor(score){ return score >= 0.5 ? '#1e293b' : '#b5544a'; }
      function horseNoBadge(no){
        const n = String(no ?? '').trim();
        return n ? `<span class="horseNoBadge" title="At numarası">${esc(n)}</span>` : '';
      }
      function overviewHorseIdentity(h){
        return `<span class="overviewHorseIdentity">${horseNoBadge(h?.horse_no)}<b class="overviewHorseName">${esc(h?.horse_name||'')}</b></span>`;
      }
      function pickBox(h, tag, tagCls){
        if (!h) return '';
        return `<div class="card" style="flex:1;min-width:200px;border-left:5px solid ${tagCls};margin-bottom:0;">
          <span class="badge" style="background:${tagCls};color:#fff;">${tag}</span>
          <h3 style="margin:8px 0 4px;display:flex;align-items:center;gap:8px;">${horseNoBadge(h.horse_no)}<span>${esc(h.horse_name)}</span></h3>
          <p style="margin:0;"><b style="color:${scoreColor(h.score)};">Skor ${fmt2(h.score)}</b> · <b style="color:${scoreColor(h.score)};">${h.why.length} destek</b></p>${scoreBreakdownHTML(h)}${scoreBandStatHTML(h.score)}
        </div>`;
      }

      // İLK BAKIŞ: her ayakta ham TKP/skor sıralamasının birincisini göster.
      // Bu bölüm kupon/TEK filtresi değildir; kullanıcının ilk bakış referans tablosudur.
      // Her ayak mutlaka bir kez görünür ve aday doğrudan o ayağın skor birincisidir.
      // KULLANICI TALİMATI (V1.1.05): Skor büyükten küçüğe sıralı; at isimleri rozet
      // genişliğinden bağımsız aynı hizada başlar (sabit 44px rozet sütunu); "Alt tablo
      // notu" (BMB/ODB/TKP/GEÇMİŞ rozetleri, çoğu satırda hep aynı "TKP" tekrarıydı,
      // bilgi değeri düşüktü) yerine dinamik TEK güven yüzdesi (%) geldi -- en sağlam
      // ayağı seçmek artık ham skoru bilmek kadar, o skorun ne kadar "güvenilir tek"
      // eşiğine yakın olduğunu da gösteriyor.
      const firstLookDataCoverage=(race,horse)=>{
        if(fastFirstPaint){
          const raw=Math.max(0,Number(horse?.score)||0);
          return {score:Math.round(Math.min(100,raw*10)),parts:[['TKP',Math.round(Math.min(100,raw*10))]],missing:['AGF','PROF','Y.PUAN','G.PR']};
        }
        if(typeof tkpEvidenceSynthesisScore==='function') return tkpEvidenceSynthesisScore(race,horse);
        // İlk Bakış'ta "kaç alan dolu" karar verdirmez. Bu nedenle TKP, AGF,
        // profil, Y.PUAN ve G.PR aynı 0–100 ölçeğine çevrilip tek bir sentez
        // puanında birleşir. Eksik bir kaynak paydaya girmez.
        const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race?.horses||[]).filter(h=>h&&!isNonRunner(h));
        const bounded=v=>Math.max(0,Math.min(100,Number(v)||0));
        const rawScore=Number(horse?.score);
        const tkp=Number.isFinite(rawScore)&&rawScore>0 ? bounded(100*rawScore/(rawScore+0.50)) : null;
        const agf=Number(horse?.agf); const agfPct=Number.isFinite(agf)&&agf>0?bounded(agf):null;
        const profile=typeof profileStrengthPct==='function'?bounded(profileStrengthPct(race,horse)):null;
        // FIX (V1.1.212): X/Kulis artık yalnız Uzman+Kulis'te; bu ortak sentez X-bağımsız.
        const yRaw=Number(horse?.ypuan);
        const yValue=Number.isFinite(yRaw)&&yRaw>0?yRaw:null;
        const yPool=live.map(h=>Number(h?.ypuan)).filter(v=>Number.isFinite(v)&&v>0);
        const ypuan=yValue!=null&&yPool.length?bounded(100*yValue/Math.max(...yPool)):null;
        const starts=Math.max(0,Number(horse?.gpr_starts)||Number(horse?.condWinStarts)||Number(horse?.priorStarts)||0);
        const wins=Math.max(0,Number(horse?.gpr_wins)||Number(horse?.condWinWins)||Number(horse?.priorWins)||0);
        // 5/6 güçlü görünür ama 30/36 kadar güvenilir değildir: G.PR katkısı
        // örnek sayısıyla kademeli büyür, küçük örnek lideri yapay şişirmez.
        const gpr=starts>0?bounded(100*(wins/starts)*Math.min(1,Math.sqrt(starts/12))):null;
        const parts=[['TKP',tkp,24],['AGF',agfPct,20],['PROF',profile,20],['Y.PUAN',ypuan,18],['G.PR',gpr,18]].filter(([,v])=>v!=null);
        const weight=parts.reduce((sum,[,,w])=>sum+w,0);
        const score=weight?Math.round(parts.reduce((sum,[,v,w])=>sum+v*w,0)/weight):0;
        return {score,parts,missing:['TKP','AGF','PROF','Y.PUAN','G.PR'].filter(label=>!parts.some(([name])=>name===label))};
      };
      const firstLookRows = raceResults
        .filter(x => x && x.r)
        // Ilk boyamada da ayak tablosunun ayni TKP liderini kullan. `x.top`
        // stratejik siradan geldigi icin hizli boyamada farkli at/puan gosterebiliyordu.
        .map(x=>Object.assign({},x,{__firstLookLeader:tkpFirstLookLeaderForLeg(x,false)}))
        .filter(x=>x.__firstLookLeader)
        .slice()
        .sort((a,b)=>{
          if(fastFirstPaint)return Number(a.r?.leg||0)-Number(b.r?.leg||0);
          const ah=a.__firstLookLeader,bh=b.__firstLookLeader;
          const av=typeof tkpRaceVisibleDisplayScore==='function'?Number(tkpRaceVisibleDisplayScore(a.r,ah)):Number(ah?.score)||0;
          const bv=typeof tkpRaceVisibleDisplayScore==='function'?Number(tkpRaceVisibleDisplayScore(b.r,bh)):Number(bh?.score)||0;
          if(Math.abs(bv-av)>0.000001) return bv-av;
          let ac=0,bc=0;
          try{ ac=Number(dynamicSingleDecision(a,ah)?.confidence)||0; }catch(_){ }
          try{ bc=Number(dynamicSingleDecision(b,bh)?.confidence)||0; }catch(_){ }
          return bc-ac || Number(a.r?.leg||0)-Number(b.r?.leg||0);
        });
      let firstLookHtml = '';
      if(firstLookRows.length){
        firstLookHtml = `<div class="card firstLookOverviewCard" style="border-left:5px solid #0f4c81;">
          <h2 style="margin:0 0 4px;">👁 İlk Bakış · Her Ayak Lideri</h2>
          <p class="muted" style="margin:0 0 10px;">Her ayağın mevcut TKP liderini gösterir. TKP = ((Ortak Puan × 0,10) + eski TKP) / 3; üst sınır 10,00. Ortak Puan AGF, profil, Y.PUAN, G.PR, DRC ve doğrulanmış tablo sinyallerinin temkinli birleşimidir; Ganyan Canavarı forma yanı p değeri yalnız ayak içi sırasıyla AGF sinyaline katkı verir. Güven ayrı Altılı 1.lik modelidir.</p>
          <div class="tableWrap firstLookOverviewTable"><table>
            <thead><tr><th>Ayak</th><th>At</th><th class="num">TKP</th><th>Güven</th></tr></thead>
            <tbody>${firstLookRows.map(x=>{
              const h=x.__firstLookLeader||x.top;
              const coverage=firstLookDataCoverage(x.r,h);
              const coverageColor=coverage.score>=75?'#166534':(coverage.score>=55?'#a16207':'#9f1239');
              const breakdown=coverage.parts.map(([name,value])=>`${name} ${Math.round(value)}`).join(' · ');
              const displayTkp=typeof tkpRaceVisibleDisplayScore==='function' ? tkpRaceVisibleDisplayScore(x.r,h) : (typeof tkpVisibleDisplayScore==='function' ? tkpVisibleDisplayScore(h,coverage.score) : Math.round(Math.max(0,Math.min(10,(coverage.score/10+Math.max(0,Number(h.score)||0))/3))*100)/100);
              const hasDisplayTkp=displayTkp!==null&&displayTkp!==undefined&&Number.isFinite(Number(displayTkp));
              const coverageHtml=`<b style="color:${coverageColor};" title="${esc('TKP = ((Ortak Puan × 0,10) + eski TKP) / 3 · Üst sınır: 10,00 · Ortak puan kırılımı: '+breakdown+(coverage.missing.length?' · Eksik: '+coverage.missing.join(', '):''))}">${hasDisplayTkp?fmt2(displayTkp):'-'}</b>`;
              let confHtml='<span class="muted" style="font-size:10.5px;">-</span>';
              if(fastFirstPaint){
                const quickPct=tkpFastFirstLookConfidence(x,h);
                confHtml=quickPct==null
                  ? '<span class="muted" style="font-size:10px;">Güven hazırlanıyor…</span>'
                  : `<span class="overviewConfidenceCell"><b>%${quickPct}</b><span class="muted">ön hesap</span></span>`;
              }else try{
                const d=typeof dynamicSingleDecision==='function'?dynamicSingleDecision(x,h):null;
                if(d){
                  const rawPct=Math.max(0,Math.min(100,Math.round(Number(d.confidence)||0)));
                  // Görünen Güven, yalnız geçmişte çözülmüş benzer lider sonuçlarıyla
                  // kalibre edilir. Kuponun mevcut TEK seçimi bu UI katmanında
                  // değişmez; yüksek ham şart puanı tek başına yüksek yüzde göstermez.
                  let calibration=null;
                  try{ calibration=typeof tkpScoreCalibratedConfidence==='function'?tkpScoreCalibratedConfidence(x.r,h,rawPct):null; }catch(_){ }
                  const pct=calibration?Math.max(0,Math.min(100,Math.round(Number(calibration.calibratedConfidence)||0))):rawPct;
                  const meets=d.isSingle===true;
                  const color=(meets&&pct>=Number(d.threshold||68))?'#166534':(pct>=Math.max(0,(Number(d.threshold)||99)-10)?'#a16207':'#9f1239');
                  const label=meets?'TEK adayı (kesin kupon değil)':(typeof singleDecisionStatusLabel==='function'
                    ?singleDecisionStatusLabel(d)
                    :`eşik %${Math.round(Number(d.threshold)||0)}`);
                  let outcome='';
                  try{ outcome=typeof scoreOutcomeCalibrationInlineHTML==='function'?scoreOutcomeCalibrationInlineHTML(x.r,h,rawPct,true):''; }catch(_){ }
                  confHtml=`<span class="overviewConfidenceCell"><b style="color:${color};">%${pct}</b><span class="muted">(${label})</span>${outcome?`<small style="display:block;margin-top:2px;line-height:1.2;">${outcome}</small>`:''}</span>`;
                }
              }catch(_){ }
              const resultInfo=typeof tkpV55LegResultInfo==='function'?tkpV55LegResultInfo(x.r,h):{known:false,cls:'waiting'};
              const resultStatus=typeof tkpV55LegResultBadge==='function'?tkpV55LegResultBadge(x.r,h):'';
              return `<tr>
                <td><b>${esc(x.r.leg)}. AYAK</b></td>
                <td><span class="v55FirstLookHorseWrap ${resultInfo.known?'result-'+resultInfo.cls:''}">${overviewHorseIdentity(h)}${resultStatus}</span></td>
                <td class="num">${coverageHtml}</td>
                <td>${confHtml}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>
        </div>`;
      }

      let ranked = raceResults.filter(x => x.top).slice().sort((a,b) => b.top.score - a.top.score);
      // KRITIK (onaylandi): "guvenilir ayak" karari artik salt ham TKP skoru esigine
      // (>1.40) degil, Ayak Onerisi/Normal Kupon'un da kullandigi GERCEK tek
      // guvenilirligine (legCoveragePlan(x,'main').reliable -- kosu sarti gucu,
      // rakip farki, ornek sayisi hepsi buradan gecer) bakiyor. Boylece bu kart
      // Ayak Onerisi'nin "guvenilmez" dedigi bir ayagi "guvenilir" diye gosteremez.
      // KRAL TALİMATI: Üst ekrandaki "TKP > 1,40" kartı eskiden yalnızca en iyi 2 ayağı
      // gösteriyordu (bestTwoLegs.slice(0,2)) -- oysa kart başlığı ve açıklaması "1,40
      // üzeri güvenilir ayaklar" diyordu, 2 ile sınırlı olduğunu söylemiyordu. Şimdi bu
      // eşiği geçen TÜM ayaklar üst ekranda gösteriliyor. bestTwoLegs/placeCoupon ise
      // "Plase 2 Tek" kupon ürünü ile birebir bağlı olduğundan (tam 2 ayak gerektirir)
      // ayrı ve değişmeden kalıyor -- yalnızca EKRAN kartı ayrıştırıldı.
       const singleCandidateRows = ranked.filter(x => {
         const h=x?.top;
         if(!h || (Number(h.score)||0)<=1.40) return false;
         return canBeCouponSingle(h);
       });
       let strongLegsAbove140 = fastFirstPaint?[]:singleCandidateRows.filter(x => { try { return legCoveragePlan(x,'main').reliable; } catch(_) { return false; } });
       let bestTwoLegs = strongLegsAbove140.slice(0,2);

      // V1.1.89 — TEK KAYNAK: Üstteki iki TEK adayı güven eşiğine yakınlığa göre seçilir.
      // V1.1.83 kupon/TEK motoru değişmez. Önce %70 dinamik güven eşiğine olan eksik
      // puan (threshold-confidence) küçük olan; eşitse ham TKP skoru yüksek olan öne geçer.
      // Böylece Bursa örneğinde BOREAL (%65, -5) ve WARDENCLYFFE (%64, -6),
      // SERHUNEFE'nin (%60, -10) önünde görünür.
      html += tkpNormalCouponDecisionHTML(raceResults);
      // Öncelik: güvenilir TKP > 1,40 özeti ilk bakış tablosundan önce görünür.
      html += firstLookHtml;

      // ---- iki kupon önerisi: sağlam tek (kazanan) + plase 2 tek (yer) ----
      // TEK TUTARLILIK KİLİDİ: Sağlam Tek tablosu ile Normal/Geniş kuponun tek seçimi
      // aynı overviewStrongLegCandidates() kaynağından gelir. Ayrı skor filtresi kullanılıp
      // ekranda başka, kuponda başka at gösterilmez.
       const strongOverview = fastFirstPaint?[]:overviewStrongLegCandidates(raceResults);
      const genuineSingleOverview = strongOverview.filter(z => z.decision?.isSingle === true && canBeCouponSingle(z.h));
      let soloCoupon = genuineSingleOverview.slice(0,6).map(z => Object.assign({}, z.x, {
        top:z.h, second:z.second, margin:Math.max(0,(Number(z.h?.score)||0)-(Number(z.second?.score)||0)),
        singleDecision:z.decision
      }));
      let placeCoupon = bestTwoLegs;

      function couponCard(title, badge, badgeCls, legs, note, betType, costNote){
        if (!legs.length) return `<div class="card overviewCouponCard" style="border-left:5px solid #94a3b8;"><h2 style="margin:0 0 4px;">${title}</h2><p class="muted" style="margin:0;">Bu kart için yeterince güçlü aday bulunamadı.</p></div>`;
        return `<div class="card overviewCouponCard" style="border-left:5px solid ${badgeCls};">
          <h2 style="margin:0 0 4px;">${title}</h2>
          <p class="muted" style="margin:0 0 10px;">${note}</p>
          <div class="tableWrap couponMiniTable"><table><thead><tr><th>Ayak</th><th>At</th><th class="num">Skor</th><th>Sonuç</th></tr></thead><tbody>
          ${legs.slice().sort((a,b)=>(Number(b.top.score)||0)-(Number(a.top.score)||0)).map(x => { const isOdb=isOdbCandidate(x.top); const resultKnown=raceHasConfirmedResult(x.r.horses); const finishPos=Number(x.top.finish_position)||0; const directWinner=Number(x.top.winner)===1||finishPos===1; const winnerHorse=(!directWinner&&resultKnown)?(x.r.horses||[]).find(h=>Number(h.winner)===1||Number(h.finish_position)===1):null; /* Eküri ortağı resmi bahiste eşdeğer olabilir; tahmin sonucu/istatistikte yalnız kendi resmi derecesi TUTTU sayılır. */ const resultText=directWinner?'TUTTU':(resultKnown?(finishPos>=2?`TUTMADI - ${finishPos}. OLDU`:'TUTMADI (ilk 4\'te değil)'):'BEKLİYOR'); const resultCls=directWinner?'hit':(resultKnown?'miss':'waiting'); const winnerBadge=winnerHorse?` <span class="compactWinnerNo" title="Kazanan at">${esc(winnerHorse.horse_no)}</span>`:''; return `<tr><td>${x.r.leg}. AYAK</td><td>${overviewHorseIdentity(x.top)}${isOdb?' <span class="badge odbWarning" title="ODB · 2. sürpriz sinyali: SONUÇ ilk 6 dışında, AGF ilk 6 dışında, BMB yok ve geçmiş kazanabilir kanıtı var">ODB</span>':''}</td><td class="num"><b>${fmt2(x.top.score)}</b></td><td><span class="couponLegStatus ${resultCls}">${resultText}</span>${winnerBadge}</td></tr>`; }).join('')}
          </tbody></table></div>
          ${costNote ? `<p style="margin:10px 0 0;font-size:12.5px;">💵 ${costNote}</p>` : ''}
        </div>`;
      }

      let soloLegCount = soloCoupon.length;
      let soloUnit = ganyanUnitPrice(soloCoupon[0]?.r.hippodrome, soloLegCount);
      let soloCombinedRough = soloCoupon.length ? soloCoupon.reduce((acc,x) => acc * (x.top.bestLb || 0.25), 1) : 0;
      let soloCostNote = soloUnit
        ? `${soloLegCount}'lü Ganyan (${soloLegCount === 6 ? ((isMinorHippodrome(soloCoupon[0].r.hippodrome)||isForeignHippodrome(soloCoupon[0].r.hippodrome)) ? 'Diyarbakır/Elazığ/Şanlıurfa/yurt dışı' : 'diğer TJK yerli hipodromları') : 'standart'} birim fiyatı: ${fmt2(soloUnit)} TL) — ayak başına tek at seçiliyorsa 1 kombinasyon = ${fmt2(soloUnit)} TL. Her ayağa ek at eklersen maliyet kombinasyon sayısıyla çarpılır.<br>📐 Kaba ihtimal göstergesi (gerçek olasılık <b>değildir</b>, yalnızca ayakların geçmiş güven alt sınırlarının çarpımıdır): yaklaşık %${fmtPct(soloCombinedRough*100)}. Ayak sayısı arttıkça bu değer hızla küçülür — bu normaldir, kombine bahsin doğasıdır.`
        : `Bu ayak sayısı (${soloLegCount}) resmi 3'lü/4'lü/5'lü/6'lı Ganyan ürünlerinden birine tam denk gelmiyor; en yakın ürünü terminalde kontrol et.`;

      function safeSection(fn, label){
        try { return fn(); }
        catch(e){ return `<div class="card" style="border-left:5px solid #dc2626;"><b>${esc(label)}</b> yüklenirken hata oluştu: ${esc(e.message)}</div>`; }
      }
      // TKP > 1,40 kartıyla aynı adayları ikinci kez tablo halinde tekrarlama.
      let couponsHtml = '';
      // Eski görünüm: Genel Bakış kartları tam genişlikte ve alt alta akar.
      let overviewHtml = safeSection(() => html + couponsHtml, 'Genel bakış');

      const _conditionSignalSummaryCache=new Map();
      // Her ayak hazırlanırken aynı 509 toplantıyı yeniden süzmek, Win8.1
      // raporundaki 62 sn'lik ikinci bloktu. Koşul özetleri tek geçişte indekslenir;
      // otomatik arka plan ayak yüklemesinde her ayak yalnız O(1) okuma yapar.
      const _conditionSignalExact=new Map(),_conditionSignalBroad=new Map();
      // R16.35 KÖK FIX: R16.34'te bu değişken aşağıdaki for döngüsünden SONRA
      // tanımlanmıştı. `const` temporal-dead-zone nedeniyle canlı tahminde doğrudan
      // "Cannot access '_learningRowsForPrediction' before initialization" hatası
      // oluşuyor, collector AYAK TABLOLARI / İLK BAKIŞ aşamasında yarım kalıyordu.
      // Önce kaynak belirlenir, sonra indeks tek geçişte kurulur.
      const _learningRowsForPrediction=(archivedReadOnly||deferFullContext||renderOptions?.deferredContextRefresh===true)?[]:learningEligibleRaces();
      const _addConditionSignal=(map,key,race)=>{
        const safeKey=String(key||'');if(!safeKey)return;
        let stat=map.get(safeKey);if(!stat){stat={races:0,result1:0,bmbRaces:0,bmbWin:0};map.set(safeKey,stat);}
        const allHorses=Array.isArray(race?.horses)?race.horses:[];
        const horses=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):allHorses.filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
        const isWinner=h=>Number(h?.winner)===1||Number(h?.finish_position)===1;
        const winnerKnown=horses.some(isWinner);
        if(!winnerKnown)return;
        stat.races++;
        if(horses.some(h=>Number(h?.result_rank)===1&&isWinner(h)))stat.result1++;
        const bmb=horses.filter(h=>Number(h?.bmb)===1);
        if(bmb.length){stat.bmbRaces++;if(bmb.some(isWinner))stat.bmbWin++;}
      };
      for(const historicalRace of _learningRowsForPrediction){
        _addConditionSignal(_conditionSignalExact,historicalRace?.condition_family,historicalRace);
        _addConditionSignal(_conditionSignalBroad,broadConditionKey(historicalRace?.condition_family),historicalRace);
      }
      // Kayıtlı/frozen görünümde bütün tarihsel havuzu yeniden tarama. Tablo düzeni
      // V1.1.306 ile aynıdır; yalnız geçmiş özet hücreleri mevcut kilitli veriden
      // çizilir ve arşiv açılışı ana iş parçacığını tutmaz.
      // R16.14/R16.35: hızlı/deferred tahmin renderında bütün arşivi sırf gizli ayak
      // koşul özetleri için tarama. Kaynak yukarıda, döngüden önce belirlenir.
      function conditionSignalSummary(family){
        const cacheKey=String(family||'');
        if(_conditionSignalSummaryCache.has(cacheKey)) return _conditionSignalSummaryCache.get(cacheKey);
        const summarize=stat=>{const s=stat||{races:0,result1:0,bmbRaces:0,bmbWin:0};return {races:s.races,result1Pct:s.races?fmtPct(100*s.result1/s.races):null,bmbRaces:s.bmbRaces,bmbPct:s.bmbRaces?fmtPct(100*s.bmbWin/s.bmbRaces):null};};
        let exact = summarize(_conditionSignalExact.get(cacheKey));
        let out;
        if (exact.races > 0) out={...exact, source: 'exact', label: family};
        else {
          let broad = broadConditionKey(family);
          let similar = summarize(_conditionSignalBroad.get(broad));
          out={...similar, source: 'benzer', label: broad};
        }
        _conditionSignalSummaryCache.set(cacheKey,out);
        return out;
      }
      window.__tkp_conditionSignalSummary = conditionSignalSummary;

      // Ayak bazlı sekmeler V1.1.306 görünümünü bire bir kullanır. Büyük tabloların
      // altısını aynı anda gizli DOM'a basmak Win8.1/düşük bellek makinelerinde ciddi
      // reflow ve "Sayfa yanıt vermiyor" üretiyordu. Her ayak HTML'i artık ilk gerçek
      // açılışında hazırlanır; algoritma/skor kaynağı ve görünen tablo düzeni değişmez.
      const legPaneBuilderByKey = new Map();
      raceResults.forEach(x => {
        legPaneBuilderByKey.set(`leg-${x.r.leg}`, () => safeSection(() => {
          let cs = conditionSignalSummary(x.r.condition_family);
          return buildLegPaneHTML(x, cs, soloCoupon, placeCoupon);
        }, x.r.leg + '. Ayak'));
      });
      if(archivedReadOnly&&typeof tkpYield==='function')await tkpYield();
      let statsHtml = `<div class="card" style="border-left:5px solid #0f4c81;"><h2 style="margin:0 0 5px;">🎯 Yan bahis analizi</h2><p class="muted" style="margin:0;">Yan bahisler otomatik hazırlanıyor. İSTATİSTİK sekmesine geçildiğinde sonuçlar doğrudan gösterilir.</p></div>`;
      let statsBuilt = false;
      let statsBuildPromise = null;

      let tabsBarHtml = `<div class="predLegTabs">
        <button class="predLegTab active" data-predleg="overview">GENEL BAKIŞ</button>
        ${raceResults.map(x => `<button class="predLegTab" data-predleg="leg-${x.r.leg}">${x.r.leg}. AYAK</button>`).join('')}
        <button class="predLegTab" data-predleg="bombhunter">💣 SÜRPRİZ ÖNERİ</button>
        <button class="predLegTab" data-predleg="stats">İSTATİSTİK</button>
      </div>`;
      let panesHtml = `
        <div class="predLegPane active" data-predpane="overview">${overviewHtml || '<div class="empty">Koşu bulunamadı.</div>'}</div>
        ${raceResults.map(x => `<div class="predLegPane" data-predpane="leg-${x.r.leg}"></div>`).join('')}
        <div class="predLegPane" data-predpane="bombhunter"></div>
        <div class="predLegPane" data-predpane="stats"></div>
      `;
      const altSwitchHtml='';
      lastRaceResults = raceResults;
      $('#predictionResult').innerHTML = altSwitchHtml + tabsBarHtml + panesHtml;
      globalThis.TKP_RESULT_VIEW?.refreshOverview?.($('#predictionResult'));
      // İlk ekran artık çizildi; başlangıçta açılan 30 sn'lik render baskısı
      // arka plan ayak ısıtmasını bu noktadan sonra rehin almamalı. Collector
      // kritik fazı varsa ayrıca task bariyeri korur; normal tahmin açılışında
      // yalnız kısa bir 900 ms sakinleşme payı bırakılır.
      globalThis.__tkpPredictionRenderPressureUntil=Date.now()+900;
      try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → ilk görünüm',predictionViewStarted,null,{budgetMs:350});}catch(_e){}
      let predRoot = $('#predictionResult');
      predRoot.dataset.tkpSegmentedDom='1';
      const predictionPaneHtml = new Map([
        ['overview', overviewHtml || '<div class="empty">Koşu bulunamadı.</div>'],
        ['stats', statsHtml]
      ]);
      const predictionPaneFragments = new Map();
      const detachPredictionPane = pane => {
        if(!pane || !pane.firstChild)return;
        const key=String(pane.dataset.predpane||'');
        const fragment=document.createDocumentFragment();
        while(pane.firstChild)fragment.appendChild(pane.firstChild);
        predictionPaneFragments.set(key,fragment);
        pane.dataset.tkpDetached='1';
      };
      const predictionPaneSource = key => {
        if(predictionPaneHtml.has(key))return predictionPaneHtml.get(key);
        if(legPaneBuilderByKey.has(key)){
          const built=legPaneBuilderByKey.get(key)();
          predictionPaneHtml.set(key,built);
          legPaneBuilderByKey.delete(key);
          return built;
        }
        if(key==='bombhunter'){
          const built=safeSection(() => tkpBombHunterPanelHTML(raceResults), 'Bomba Avcısı');
          predictionPaneHtml.set(key,built);
          return built;
        }
        return '';
      };
      const hydratePredictionPane = (key,pane) => {
        if(!pane)return;
        if(pane.firstChild){predictionPaneFragments.delete(key);return;}
        const saved=predictionPaneFragments.get(key);
        if(saved){
          pane.appendChild(saved);
          predictionPaneFragments.delete(key);
        }else if(legPaneBuilderByKey.has(key)){
          // Sekme düğmesine basıldığı anda aktif/pending görünümü boya; tabloyu
          // sonraki event-loop dönüşünde kur. Bu kural artık canlı collector için
          // de geçerli: görünmeyen ayak tablosu hiçbir zaman ilk ekranı kilitlemez.
          const token=`${renderGeneration}:${key}:${Date.now()}`;
          pane.dataset.tkpHydrateToken=token;
          delete pane.dataset.tkpDetached;
          pane.innerHTML='<div class="card" style="border-left:5px solid #2563eb;">Kayıtlı ayak tablosu hazırlanıyor…</div>';
          const build=()=>{
            if(pane.dataset.tkpHydrateToken!==token)return false;
            const built=predictionPaneSource(key);
            predictionPaneFragments.delete(key);
            pane.innerHTML=built;
            delete pane.dataset.tkpHydrateToken;
            return true;
          };
          const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
          return Promise.resolve(typeof tkpYield==='function'?tkpYield():undefined)
            .then(pause).then(build).catch(error=>{
              if(pane.dataset.tkpHydrateToken===token){
                delete pane.dataset.tkpHydrateToken;
                pane.innerHTML=`<div class="card" style="border-left:5px solid #dc2626;"><b>Ayak tablosu hatası:</b> ${esc(error?.message||String(error))}</div>`;
              }
              return false;
            });
        }else pane.innerHTML=predictionPaneSource(key);
        delete pane.dataset.tkpDetached;
      };
      const setPredictionPaneHtml = (key,pane,html) => {
        predictionPaneFragments.delete(key);
        pane.innerHTML=html;
        if(!pane.classList.contains('active'))detachPredictionPane(pane);
      };
      const ensureStatsPanelBuilt = (triggerButton=null) => {
        const pane=predRoot.querySelector('.predLegPane[data-predpane="stats"]');
        if(!pane)return Promise.resolve(false);
        if(statsBuilt&&pane.querySelector('.sideBetPanel'))return Promise.resolve(true);
        if(statsBuildPromise)return statsBuildPromise;
        const cached=typeof tkpGetSideBetPanelHTMLCached==='function'
          ? tkpGetSideBetPanelHTMLCached(raceResults)
          : '';
        if(cached){
          setPredictionPaneHtml('stats',pane,cached);
          statsBuilt=true;
          return Promise.resolve(true);
        }
        // Ayak sekmeleriyle aynı yaşam döngüsü: tıklamayı anında boya, ağır HTML'yi
        // bir sonraki event-loop turunda ve paylaşılan RAM/IndexedDB cache üzerinden
        // üret. Bu iş hiçbir global busy/menü kilidi kullanmaz.
        setPredictionPaneHtml('stats',pane,`<div class="card" style="border-left:5px solid #2563eb;">${archivedReadOnly?'Kayıtlı istatistik':'Yan bahis istatistikleri'} hazırlanıyor…</div>`);
        if(triggerButton){triggerButton.classList.add('calculating');triggerButton.setAttribute('aria-busy','true');}
        const statsStarted=typeof tkpNow==='function'?tkpNow():performance.now();let statsError=null;
        const task=async()=>{
          if(typeof tkpYield==='function')await tkpYield();
          else await new Promise(resolve=>setTimeout(resolve,0));
          const progressOptions={onProgress:(partialHtml,progress)=>{
            // Altı ayağın tamamını bekleyip yalnız spinner göstermek yerine arşiv
            // kartlarını ayak ayak boya. Bayat render yeni toplantıya yazamaz.
            if(renderGeneration!==_tkpPredictionRenderGeneration||!pane.classList.contains('active'))return;
            setPredictionPaneHtml('stats',pane,partialHtml);
            pane.dataset.tkpStatsProgress=`${Number(progress?.done)||0}/${Number(progress?.total)||0}`;
          }};
          const build=typeof tkpGetSideBetPanelHTMLAsync==='function'
            ? tkpGetSideBetPanelHTMLAsync(raceResults,progressOptions)
            : (typeof sideBetPanelHTMLAsync==='function'?sideBetPanelHTMLAsync(raceResults,progressOptions):sideBetPanelHTML(raceResults));
          const panelHtml=await Promise.resolve(build);
          if(renderGeneration!==_tkpPredictionRenderGeneration)return false;
          setPredictionPaneHtml('stats',pane,panelHtml);
          statsBuilt=true;
          return true;
        };
        statsBuildPromise=Promise.resolve(task()).catch(error=>{
          statsError=error;
          if(renderGeneration!==_tkpPredictionRenderGeneration)return false;
          statsBuilt=false;
          setPredictionPaneHtml('stats',pane,`<div class="card" style="border-left:5px solid #dc2626;"><b>İstatistik paneli açılamadı:</b> ${esc(error?.message||String(error))}<br><span class="muted">Diğer menüler kullanılabilir; bu sekmeye tekrar basıldığında hazır cache okunur.</span></div>`);
          return false;
        }).finally(()=>{
          try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → istatistik / yan bahis',statsStarted,statsError,{budgetMs:19000});}catch(_e){}
          if(triggerButton){triggerButton.classList.remove('calculating');triggerButton.removeAttribute('aria-busy');}
          statsBuildPromise=null;
        });
        return statsBuildPromise;
      };
      // Ağır İSTATİSTİK/yan bahis tabloları görünmeden hesaplanmaz. Özellikle arşiv
      // açılışında otomatik prewarm, aynı toplantı her çağrıldığında tüm geçmişi yeniden
      // tarayabiliyordu. Cache varsa tıklamada anında gelir; yoksa yalnız kullanıcı
      // İSTATİSTİK sekmesini açtığında tek kez hesaplanır.
      predRoot.querySelectorAll('.predLegTab').forEach(btn => {
        btn.onclick = () => {
          const previousPane=predRoot.querySelector('.predLegPane.active');
          const key=String(btn.dataset.predleg||'overview');
          const pane=predRoot.querySelector(`.predLegPane[data-predpane="${key}"]`);
          if(previousPane&&previousPane!==pane)detachPredictionPane(previousPane);
          predRoot.querySelectorAll('.predLegTab').forEach(b => b.classList.remove('active'));
          predRoot.querySelectorAll('.predLegPane').forEach(p => p.classList.remove('active'));
          btn.classList.add('active');
          const hydration=hydratePredictionPane(key,pane);
          if (pane) pane.classList.add('active');
          if(key==='overview')globalThis.TKP_RESULT_VIEW?.refreshOverview?.(pane);
          if (key === 'stats') ensureStatsPanelBuilt(btn);
          if(hydration&&typeof hydration.catch==='function') hydration.catch(()=>{});
        };
      });
      // Donma raporu, görünmeyen altı panelin TEK görev içinde hazırlanmasının
      // ilk ekranı ikinci kez 62 sn kilitlediğini gösterdi. Otomatik hazırlık
      // korunur; fakat her panel ayrı düşük öncelikli görevdir. Böylece kullanıcı
      // hiçbir düğmeye basmaz, ancak yeni bir tıklama sırada beklemez.
      const warmPredictionPanes=async()=>{
        if(typeof tkpYield==='function')await tkpYield();
        if(renderGeneration!==_tkpPredictionRenderGeneration)return false;
        const keys=[...raceResults.map(x=>`leg-${x.r.leg}`),'bombhunter','stats'];
        const prepareOne=async key=>{
          if(renderGeneration!==_tkpPredictionRenderGeneration)return false;
           if(typeof tkpWaitForBackgroundSafeWindow==='function'&&!await tkpWaitForBackgroundSafeWindow({minIdleMs:900,retryMs:120}))return false;
          if(typeof tkpYield==='function')await tkpYield();
          if(renderGeneration!==_tkpPredictionRenderGeneration)return false;
          const pane=predRoot.querySelector(`.predLegPane[data-predpane="${key}"]`);
          if(!pane)return false;
          if(key==='stats')return ensureStatsPanelBuilt(null);
          if(!predictionPaneFragments.has(key)&&!predictionPaneHtml.has(key))setPredictionPaneHtml(key,pane,predictionPaneSource(key));
          if(typeof tkpYield==='function')await tkpYield();
          return true;
        };
        for(const key of keys){
          const taskKey=`prediction-pane-auto:${renderGeneration}:${key}`;
          if(typeof tkpQueueTask==='function')tkpQueueTask(taskKey,()=>prepareOne(key),{priority:'background',replace:true,minIdleMs:900});
          else setTimeout(()=>{prepareOne(key).catch(()=>{});},0);
        }
        predRoot.dataset.tkpPredictionReady='auto-queued';
        try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → ayrıntılar otomatik sıraya alındı',predictionRenderStarted,null,{budgetMs:1200});}catch(_e){}
        return true;
      };
      // Kupon üretimi kolektörün hemen sonraki user görevinde başlar. Bu hazırlık
      // küçük bir idle eşiğiyle ertelenir; kupon kaydı hiçbir zaman ayak/BH/istatistik
      // ön hazırlığı tarafından sırada bekletilemez.
      // Bir sonraki event dönüşüne bırakmak kritik: renderPredictionScreen'i çağıran
      // kolektör bu arada user öncelikli "collector-three-coupons" görevini kuyruğa
      // ekler. Böylece idle işi ilk render ile kupon snapshot'ı arasına giremez.
      const schedulePredictionPaneWarmup=()=>{
        if(renderGeneration!==_tkpPredictionRenderGeneration)return;
        if(typeof tkpQueueTask==='function')tkpQueueTask('prediction-pane-warmup',warmPredictionPanes,{priority:'background',replace:true,minIdleMs:450});
        else warmPredictionPanes().catch(()=>{});
      };
      let collectorPostCouponScheduled=false;
      const schedulePostCouponWork=()=>{
        if(collectorPostCouponScheduled||renderGeneration!==_tkpPredictionRenderGeneration)return false;
        collectorPostCouponScheduled=true;
        // Ayak/BH/istatistik ayni shared promise/cache üzerinden tek sahipte
        // hazırlanır. Collector kritik fazında bu satırlar bariyer açıkken
        // kuyruklanır ve kupon kartı boyandıktan sonra çalışmaya başlar.
        // R16.94: importing a live meeting does not require rendering hidden
        // statistics panels or warming ALL historical profiles. Their existing
        // pane-open paths prepare them; durable prediction enrichment stays queued.
        const deferOptionalWarmup=collectorCriticalPhase||renderOptions?.deferPostWork===true;
        if(!deferOptionalWarmup)schedulePredictionPaneWarmup();
        try{ if(!deferOptionalWarmup&&!archivedReadOnly&&typeof tkpPrewarmAdaptiveLearningWeights==='function') tkpPrewarmAdaptiveLearningWeights(); }catch(_e){}
        try{
          if(!deferOptionalWarmup&&!archivedReadOnly&&typeof tkpPrewarmPerformanceCaches==='function'){
            const warmPersistent=()=>tkpPrewarmPerformanceCaches({cooperative:true,races:raceResults.map(x=>x.r)});
            if(typeof tkpQueueTask==='function')tkpQueueTask('post-load-adaptive-persist-prewarm',warmPersistent,{priority:'background',replace:true,minIdleMs:2200});
            else setTimeout(()=>{Promise.resolve(warmPersistent()).catch(()=>{});},2200);
          }
        }catch(_e){}
        // R16.35: İlk boya snapshotı P1-P5 yan bahis sıralamasını bilerek erteler.
        // Kupon kartları çizildikten sonra her yarışın adaptif istatistiği cooperative
        // async cache ile ısıtılır; ardından eksik P1-P5 alanları otomatik tamamlanır.
        // Böylece doğrulama/öğrenme verisi kaybolmaz, fakat 30-40 sn'lik hesap İlk
        // Bakış'ın önünde çalışmaz.
        if(logPayload&&fastFirstPaint&&!archivedReadOnly){
          const enrichSnapshot=async()=>{
             if(typeof tkpWaitForBackgroundSafeWindow==='function'&&!await tkpWaitForBackgroundSafeWindow({minIdleMs:1200,retryMs:140}))return false;
            return tkpEnrichPredictionSnapshotAsync(logPayload,raceResults,{
              isCurrent:()=>renderGeneration===_tkpPredictionRenderGeneration
            });
          };
          if(typeof tkpQueueTask==='function')tkpQueueTask('prediction-snapshot-sidebet-enrich',enrichSnapshot,{priority:'background',replace:true,minIdleMs:1200});
          else setTimeout(()=>{enrichSnapshot().catch(()=>{});},0);
        }
        try{ if(!archivedReadOnly&&typeof tkpSurpriseCohortSync==='function')tkpSurpriseCohortSync(raceResults); }catch(_e){}
        if(deferFullContext&&!deferOptionalWarmup){
          const followupOptions={...renderOptions,criticalPhase:false,collectorRunId:'',preserveCouponDom:true};
          tkpSchedulePredictionContextUpgrade(displayRaces2,logPayload,followupOptions,renderGeneration);
        }
        // Yalnız aktif görünüm canlı DOM'dadır. Diğer görünüm çocukları DocumentFragment
        // içinde ayrık tutulur; sekmeye geri dönüldüğünde aynı düğümler geri takılır.
        try{
          if(!deferOptionalWarmup&&!archivedReadOnly&&typeof globalThis.tkpScheduleOnlinePositionsTraining==='function')
            globalThis.tkpScheduleOnlinePositionsTraining(raceResults.map(x=>x.r),[1,2,3,5]);
        }catch(_e){}
        return true;
      };
      if(collectorCriticalPhase&&collectorRunId){
        globalThis.tkpScheduleCollectorPostCouponWarmup=(payload={})=>{
          if(String(payload?.runId||'')!==collectorRunId)return false;
          const scheduled=schedulePostCouponWork();
          try{if(typeof tkpEndTaskBarrier==='function')tkpEndTaskBarrier(String(payload?.barrierKey||''));}catch(_e){}
          return scheduled;
        };
      }
      if(archivedReadOnly||collectorCriticalPhase||renderOptions?.deferPostWork===true){
        // Collector, arşiv ve manuel yeniden hesaplama akışlarında gizli
        // panel/model taramaları başlatılmaz. Ayak ve istatistik sekmeleri kendi
        // mevcut lazy akışında yalnız kullanıcı açtığında hazırlanır.
      }else if(typeof setTimeout==='function')setTimeout(schedulePostCouponWork,0);
      else schedulePostCouponWork();
      try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → ayak tabloları',predictionRenderStarted,null,{budgetMs:1200});}catch(_e){}
      return true;
}

function v25MergeStoredResultsIntoRaces(races){
  const rows=(races||[]).map(r=>JSON.parse(JSON.stringify(r)));
  if(!db || !rows.length) return rows;
  // KÖK FIX (V1.0.75): Aşağıdaki filter, HER koşu için `db.files.find(...)` çağırıyordu.
  // Bu, kayıtlı bir tahmini ekrana getirirken O(koşu x dosya) tam tarama demekti --
  // "eski veri çağırırken kilitleniyor" belirtisinin ana kaynağı. Dosya araması artık
  // tek seferlik bir Map ile O(1).
  const _filesById=new Map((db.files||[]).map(f=>[String(f.id),f]));
  const first=rows[0]||{};
  const date=String(first.race_date||'');
  const hip=canonicalHippodrome(first.hippodrome||'');
  const alt=Number(first.altili_no)||Number(_filesById.get(String(first.file_id))?.altili_no)||1;
  const sourceRaces=(db.races||[]).filter(r=>{
    if(String(r.race_date||'')!==date) return false;
    if(canonicalHippodrome(r.hippodrome||'')!==hip) return false;
    const f=_filesById.get(String(r.file_id));
    const rAlt=Number(r.altili_no)||Number(f?.altili_no)||1;
    return rAlt===alt && (resultRaceQuality(r).winnerCount>0 || (Array.isArray(r.payouts)&&r.payouts.length) || (Array.isArray(r.available_bets)&&r.available_bets.length));
  });
  if(!sourceRaces.length) return rows;
  const byLeg=new Map();
  for(const r of sourceRaces){
    const q=resultRaceQuality(r);
    const key=String(Number(r.leg)||'');
    const prev=byLeg.get(key);
    const prevQ=prev?resultRaceQuality(prev):{winnerCount:0,complete:false};
    const score=(q.complete?100:0)+q.winnerCount*10+(Array.isArray(r.payouts)?r.payouts.length:0)+(Array.isArray(r.available_bets)?r.available_bets.length:0);
    const prevScore=(prevQ.complete?100:0)+prevQ.winnerCount*10+(Array.isArray(prev?.payouts)?prev.payouts.length:0)+(Array.isArray(prev?.available_bets)?prev.available_bets.length:0);
    if(!prev || score>prevScore) byLeg.set(key,r);
  }
  for(const r of rows){
    const src=byLeg.get(String(Number(r.leg)||''));
    if(!src) continue;
    if(Array.isArray(src.payouts) && src.payouts.length) r.payouts=JSON.parse(JSON.stringify(src.payouts));
    if(Array.isArray(src.available_bets) && src.available_bets.length) r.available_bets=src.available_bets.slice();
    const sourceVerified=String(src?.result_integrity_status||'')==='VERIFIED'&&Number(src?.result_verified_depth)>0;
    if(sourceVerified){r.result_integrity_status='VERIFIED';r.result_integrity_source='TJK_OFFICIAL_ORDERED_PAYOUT';r.result_verified_depth=Number(src.result_verified_depth)||0;}
    const byNo=new Map((src.horses||[]).map(h=>[String(ekuriBase(h.horse_no)),h]));
    const byName=new Map((src.horses||[]).map(h=>[baseHorseName(h.horse_name),h]));
    for(const h of (r.horses||[])){
      const old=byNo.get(String(ekuriBase(h.horse_no))) || byName.get(baseHorseName(h.horse_name));
      if(!old) continue;
      if(sourceVerified&&old.finish_position!=null){
        h.finish_position=Number(old.finish_position);
        h.winner=Number(old.finish_position)===1?1:0;
      }
      if(old.start_no!=null && h.start_no==null && /^TJK_PROGRAM/i.test(String(old.start_no_source||''))){h.start_no=old.start_no;h.start_no_source=old.start_no_source;}
    }
    normalizeRaceObj(r);
  }
  return rows;
}

function tkpRefreshLoadedMeetingAfterResult(targetFile){
  try{
    if(!targetFile || !Array.isArray(lastRaceResults) || !lastRaceResults.length) return false;
    const first=lastRaceResults[0]||{};
    const firstFile=(db?.files||[]).find(f=>String(f.id)===String(first.file_id))||{};
    const sameFile=String(first.file_id||'')===String(targetFile.id||'');
    const sameMeeting=String(first.race_date||firstFile.race_date||'')===String(targetFile.race_date||'')
      && canonicalHippodrome(first.hippodrome||firstFile.hippodrome||'')===canonicalHippodrome(targetFile.hippodrome||'')
      && (Number(first.altili_no||firstFile.altili_no||1)===Number(targetFile.altili_no||1));
    if(!sameFile && !sameMeeting) return false;
    let refreshed=(db.races||[]).filter(r=>String(r.file_id)===String(targetFile.id)).sort((a,b)=>Number(a.leg)-Number(b.leg));
    if(!refreshed.length) return false;
    refreshed=v25MergeStoredResultsIntoRaces(refreshed).sort((a,b)=>Number(a.leg)-Number(b.leg));
    lastRaceResults=refreshed;
    if(typeof activeCoupons!=='undefined'&&activeCoupons){
      const liveByLeg=new Map(refreshed.map(r=>[String(Number(r.leg)||''),r]));
      for(const typeKey of ['main','alt','surprise']){
        const coupon=activeCoupons[typeKey];if(!coupon||coupon.error||!Array.isArray(coupon.legs))continue;
        for(const leg of coupon.legs){
          const live=liveByLeg.get(String(Number(leg?.r?.leg)||''));if(!live)continue;
          const oldPicks=(leg.picks||[]).slice();leg.r=live;if(leg.x&&leg.x.r)leg.x.r=live;
          leg.allHorses=live.horses||leg.allHorses||[];
          leg.picks=oldPicks.map(old=>(live.horses||[]).find(h=>String(h.horse_no)===String(old?.horse_no))
            ||(live.horses||[]).find(h=>typeof sameEkuri==='function'&&sameEkuri(old?.horse_no,h.horse_no))||old);
        }
      }
    }
    // Tahmin sırası/snapshot kilidi korunur; yalnız sonuç, ikramiye ve yan bahis
    // durumu açık ekrana tekrar bağlanır.
    if($('#predictionResult') && $('#predictionResult').innerHTML.trim()) renderPredictionScreen(refreshed);
    return true;
  }catch(error){
    console.warn('Sonuç sonrası açık tahmin ekranı yenilenemedi:',error);
    return false;
  }
}

// KÖK FIX: "Gün/Bülten Seç" listesinden geçmiş bir gün seçmek eskiden HİÇBİR ŞEY
// yapmıyordu -- ekrana gelmesi için orijinal klasörün TARAYICI OTURUMU İÇİNDE tekrar
// seçilmesi gerekiyordu (File nesneleri sayfa yenilenince/oturum değişince kaybolur).
// Bu yüzden "Önce bir tahmin dosyası yükle" hatası, bülten aslında zaten kayıtlıyken
// bile çıkıyordu. Artık seçilen günün ID'sine göre doğrudan db.races'ten (dosyayı
// yeniden okumadan) aynı skorlama/render zincirini çalıştırır.
function tkpInferAltiliNo(record, relatedRaces=[]){
  const direct=Number(record?.altili_no);
  if(Number.isFinite(direct) && direct>=1) return Math.trunc(direct);
  const raceDirect=(relatedRaces||[]).map(r=>Number(r?.altili_no)).find(n=>Number.isFinite(n)&&n>=1);
  if(raceDirect) return Math.trunc(raceDirect);
  const text=[record?.filename,record?.original_filename,record?.source_name,record?.source_signature,record?.meeting_uid,
    ...(relatedRaces||[]).flatMap(r=>[r?.filename,r?.original_filename,r?.source_name,r?.source_signature,r?.meeting_uid])]
    .filter(Boolean).join(' | ').toLocaleUpperCase('tr-TR');
  let m=text.match(/(?:^|[^0-9])([12])\s*[-_ ]*ALT(?:ILI|ILI)?(?:[^A-ZÇĞİÖŞÜ]|$)/i)
    || text.match(/(?:^|[^0-9])([12])\s*[-_ ]*ALT\b/i);
  if(m) return Number(m[1]);
  return 0;
}

function tkpSavedRacesForFile(fileId){
  if(!db || fileId==null || fileId==='') return [];
  const indexed=typeof tkpRowsByFileId==='function'?tkpRowsByFileId(fileId):[];
  const exact=indexed.length?indexed:(db.races||[]).filter(r=>String(r.file_id)===String(fileId));
  if(exact.length) return exact.slice().sort((a,b)=>Number(a.leg)-Number(b.leg));

  // V1.1.93 — GERÇEK ARŞİV KAYIT AÇMA KÖK FIX
  // Dosyalar tablosundaki kayıt id'si ile yarış satırlarının legacy file_id'si ayrışabilir.
  // Ayrıca eski 2. Altılı kayıtlarında altili_no boş kalıp yalnız filename/source_signature
  // içinde “2ALT” bulunabilir. Boş Altılıyı artık 1 saymayız. Önce sequence_no, sonra
  // tarih+hipodrom+dosya/source bilgisi+Altılı kanıtıyla tek bir 6-ayak grubu seçilir.
  const file=(typeof tkpFileById==='function'?tkpFileById(fileId):null)||tkpVisibleRecalcFileById(fileId);
  if(!file) return [];
  const date=String(file.race_date||'').slice(0,10);
  const hip=canonicalHippodrome(file.hippodrome||'');
  const seq=Number(file.sequence_no)||0;
  const alt=tkpInferAltiliNo(file,[]);
  const sourceText=[file.filename,file.original_filename,file.source_name,file.source_signature,file.meeting_uid]
    .filter(Boolean).join('|').toLocaleUpperCase('tr-TR');

  const candidates=(db.races||[]).filter(r=>{
    const rDate=String(r.race_date||'').slice(0,10);
    const rHip=canonicalHippodrome(r.hippodrome||'');
    return !!date && rDate===date && rHip===hip;
  });
  if(!candidates.length) return [];

  const groups=new Map();
  for(const r of candidates){
    const key=String(r.file_id??'');
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(r);
  }
  const ranked=[];
  for(const rows of groups.values()){
    const first=rows[0]||{};
    const linked=(typeof tkpFileById==='function'?tkpFileById(first.file_id):null)||tkpVisibleRecalcFileById(first.file_id)||{};
    const rSeq=Number(first.sequence_no)||Number(linked.sequence_no)||0;
    const rAlt=tkpInferAltiliNo(linked,rows);
    const rText=[linked.filename,linked.original_filename,linked.source_name,linked.source_signature,linked.meeting_uid,
      ...rows.flatMap(r=>[r.filename,r.original_filename,r.source_name,r.source_signature,r.meeting_uid])]
      .filter(Boolean).join('|').toLocaleUpperCase('tr-TR');
    let score=0;
    if(seq && rSeq===seq) score+=1000;
    if(alt && rAlt===alt) score+=700;
    if(alt && rAlt && rAlt!==alt) score-=2000;
    if(sourceText && rText && (rText.includes(sourceText)||sourceText.includes(rText))) score+=300;
    const legCount=new Set(rows.map(r=>Number(r.leg)).filter(n=>n>=1&&n<=6)).size;
    if(legCount===6) score+=120;
    ranked.push({rows,score,rSeq,rAlt,legCount});
  }
  ranked.sort((a,b)=>b.score-a.score || b.legCount-a.legCount);
  const best=ranked[0];
  if(best && best.score>0){
    // 2ALT kanıtı varsa karşıt Altılı grubunu asla sessizce açma.
    if(alt && best.rAlt && best.rAlt!==alt) return [];
    return best.rows.slice().sort((a,b)=>Number(a.leg)-Number(b.leg));
  }
  return [];
}
async function renderSavedPredictionByFileId(fileId){
  const _archivePerfStart=typeof performance!=='undefined'?performance.now():Date.now();
  const _archivePerf={fileId:String(fileId),start:_archivePerfStart};
  if(typeof window!=='undefined')window.__tkpArchivePerf=_archivePerf;
  if(!db || fileId==null || fileId==='') return false;
  let races=tkpSavedRacesForFile(fileId);
  _archivePerf.lookup=(typeof performance!=='undefined'?performance.now():Date.now())-_archivePerfStart;
  if(!races.length){
    if ($('#bulletinFileName')) $('#bulletinFileName').textContent='Bu gün için kayıtlı koşu bulunamadı.';
    return false;
  }
  try{
    races=v25MergeStoredResultsIntoRaces(races).sort((a,b)=>a.leg-b.leg);
    _archivePerf.merge=(typeof performance!=='undefined'?performance.now():Date.now())-_archivePerfStart;
    // Kayıtlı yarış ilk açılışında Son AGF düğmesine ihtiyaç duymadan aynı frozen
    // PRE-RACE skor/görünür TKP kaynağını kullanır. Sonuç/Accurate merge'inden kalan
    // bayat score/tkp_display_raw_score alanları snapshot'ın önüne geçemez.
    for(const race of races){
      for(const horse of (race.horses||[])){
        if(Number(horse?.prediction_score_locked)===1 && Number.isFinite(Number(horse?.prediction_score_snapshot)) && typeof applyPredictionScoreSnapshot==='function'){
          applyPredictionScoreSnapshot(horse);
        }
      }
    }
    // Kayıtlı ODS/tahmin açmak salt-okunur bir işlemdir. Veri değişmediği için
    // öğrenme ve yan bahis önbelleklerini temizleme; aksi halde her açılış
    // gereksiz bir "güncelleme" gibi davranıp ağır hesapları yeniden başlatıyordu.
    const rendered=await renderPredictionScreen(races, null, {archivedReadOnly:true});
    _archivePerf.render=(typeof performance!=='undefined'?performance.now():Date.now())-_archivePerfStart;
    if(!rendered) return false;
    // V1.1.257 ARŞİV KUPON FIX: Geçmiş toplantı açıldığında kullanıcının ayrıca
    // "Kupon Hazırla" düğmesine basmasını bekleme. Yarış saati geçmişse YENİ kupon
    // hesaplanmaz; yalnız aynı toplantıya ait kayıtlı yarış-öncesi snapshot restore edilir
    // ve salt-okunur kartlar anında gösterilir. Böylece arşiv tahmini + arşiv kuponu tek
    // çağrıda beraber gelir.
    try{
      // Arşiv seçimi kupon ekranını da aynı toplantıya bağlar. Yarış başlamışsa
      // salt-okunur yarış öncesi snapshotı; bugünkü açık toplantıysa aynı veri
      // imzasına sahip güncel snapshotı otomatik geri yükle.
      if(typeof tkpRestoreLatestPreRaceCouponSnapshot==='function'){
        const meetingLocked=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked(lastRaceResults);
        const requested={
          main:Number($('#normalCouponBudget')?.value)||1000,
          main2:Number($('#normalCouponBudget')?.value)||1000,
          alt:0,
          surprise:Number($('#surpriseCouponBudget')?.value)||1000,
          normalMode:'standard'
        };
        const archivedCouponSnapshot=meetingLocked
          ?tkpRestoreLatestPreRaceCouponSnapshot(lastRaceResults)
          :(typeof tkpRestoreCurrentCouponSnapshotIfFresh==='function'
            ?tkpRestoreCurrentCouponSnapshotIfFresh(lastRaceResults,requested)
            :null);
        const couponTarget=$('#budgetCouponResult');
        if(archivedCouponSnapshot && couponTarget){
          const verifiedAutomatic=typeof tkpBacktestEligibleSnapshotSource==='function'
            && tkpBacktestEligibleSnapshotSource(archivedCouponSnapshot?.source)
            && Number(archivedCouponSnapshot?.manual_adjustment)!==1;
          const archiveOnly=Number(archivedCouponSnapshot.archive_snapshot)===1;
          couponTarget.innerHTML=`<div class="card" style="border-left:5px solid #2563eb;">${archiveOnly?'📚 Geçmiş arşiv kuponu açıldı; güncel motor sonucu veya doğrulanmış yarış-öncesi tahmin değildir.':meetingLocked?`🔒 ${verifiedAutomatic?'Doğrulanmış otomatik':'Kayıtlı son'} yarış-öncesi kupon otomatik açıldı; yeniden hesaplama yapılmadı.`:'✅ Seçili bugünkü toplantının kayıtlı üç kuponu otomatik açıldı; yeniden hesaplama yapılmadı.'}</div>`
            + '<div class="budgetCouponTriple" id="couponTripleWrap"><div id="couponCard-main"></div><div id="couponCard-surprise"></div><div id="couponCard-alt"></div></div>';
          if(typeof renderCouponCard==='function'){renderCouponCard('main');renderCouponCard('surprise');renderCouponCard('alt');}
          if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
        }else if(couponTarget&&typeof globalThis.tkpRunBudgetCouponBuild==='function'){
          // Kayıtlı snapshot yoksa arşiv verisinden salt okunur üç kupon hazırla.
          await globalThis.tkpRunBudgetCouponBuild({currentReplay:false});
        }
      }
    }catch(error){console.warn('Arşiv kupon snapshotı otomatik açılamadı',error);}
    _archivePerf.coupon=(typeof performance!=='undefined'?performance.now():Date.now())-_archivePerfStart;
    // Arşiv görüntüleme kesinlikle salt-okunurdur. Eksik eski snapshotlar burada
    // güncel modelle doldurulmaz ve db'ye yazılmaz; yeniden hesaplama yalnız açıkça
    // seçilen "Güncel Algoritma ile Hesapla" akışının sorumluluğudur.
    const f=(typeof tkpFileById==='function'?tkpFileById(fileId):null)||tkpVisibleRecalcFileById(fileId);
    // Kayıtlı Gün/Bülten yolunda da ham dosya yükleme yoluyla aynı canlı bağlamı
    // kur. Benzer Yarış, tek-koşu ODS ve X/Kulis yardımcıları bu payload'u okur.
    window.__lastPredictionPayload={file:f||{id:fileId},races,source:'saved_prediction',ypuan_import_report:f?.ypuan_import_report};
    if ($('#bulletinFileName')) {
      $('#bulletinFileName').textContent = f
        ? `✅ ${displayDateTR(f.race_date||'')} · ${typeof displayHippodromeShort==='function'?displayHippodromeShort(f.hippodrome):f.hippodrome||''} kayıtlı tahmin açıldı.`
        : '✅ Kayıtlı tahmin açıldı.';
      $('#bulletinFileName').classList.remove('uploadWarning');
    }
    _archivePerf.done=(typeof performance!=='undefined'?performance.now():Date.now())-_archivePerfStart;
    return true;
  }catch(err){
    tkpShowPanelError($('#predictionResult'), `Tahmin açılamadı: ${err.message}`, 'prediction');
    return false;
  }
}


// R16.12 BOTTLENECK FIX: Eski bir toplantıyı "Güncel Algoritmayla Hesapla"
// dediğimizde 500+ toplantılık db.races koleksiyonunu değiştirme/yazma. Yalnız seçili
// toplantının en fazla 6 yarışını küçük bir çalışma kopyasına alıp güncel modelle hesapla.
// Bu görünüm araştırma/replay amaçlıdır; kayıtlı yarış-öncesi frozen snapshotı bozmaz.
function tkpFastTableNumber(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function tkpFastTableScore(h){
  try{if(typeof tkpCouponVisibleScore==='function'){const n=Number(tkpCouponVisibleScore(h));if(Number.isFinite(n))return n;}}catch(_){ }
  return tkpFastTableNumber(h?.tkp_display_score??h?.score);
}
function tkpFastTableLegProfile(row,index){
  const source=(row?.scored||row?.r?.horses||[]).filter(h=>!isNonRunner(h));
  const ordered=typeof tkpOrderedForLeg==='function'
    ?tkpOrderedForLeg({r:row?.r,scored:source})
    :(typeof v25SortGeneralOverviewRows==='function'?v25SortGeneralOverviewRows(row?.r,source):source.slice().sort((a,b)=>tkpFastTableScore(b)-tkpFastTableScore(a)));
  const top=ordered[0]||{},second=ordered[1]||{},third=ordered[2]||{};
  const score=h=>tkpFastTableScore(h),agf=h=>tkpFastTableNumber(h?.agf),yp=h=>tkpFastTableNumber(h?.ypuan),prof=h=>tkpFastTableNumber(h?.profile_strength_pct??h?.prof),tr=h=>tkpFastTableNumber(h?.tr_puan??h?.tr_ganyan);
  const dominantPair=ordered.length>=2&&yp(top)>=100&&yp(second)>=100&&agf(top)+agf(second)>=45&&
    (ordered.length<3||(score(third)<=score(second)*.86&&agf(third)<=Math.max(12,agf(second)*.5)&&yp(third)<=Math.min(85,yp(second)-25)));
  const gap=Math.max(0,score(top)-score(second)),agfGap=agf(top)-agf(second),ypGap=yp(top)-yp(second),profGap=prof(top)-prof(second),trGap=tr(top)-tr(second);
  const evidence=gap*55+Math.max(-8,Math.min(18,agfGap*.8))+Math.max(-6,Math.min(12,ypGap*.10))+Math.max(-5,Math.min(10,profGap*.16))+Math.max(-4,Math.min(8,trGap*.04));
  const safeSingle=!dominantPair&&score(top)>=1.40&&gap>=.30&&(agf(top)>=25||yp(top)>=100||prof(top)>=55)&&!(typeof canBeCouponSingle==='function'&&!canBeCouponSingle(top));
  const weights=ordered.map(h=>{
    const s=Math.max(.05,score(h));
    return Math.max(.01,s*s*(1+Math.max(0,agf(h))/100*1.4+Math.max(0,yp(h))/200*.35+Math.max(0,prof(h))/100*.25+Math.max(0,tr(h))/200*.15));
  });
  const total=weights.reduce((a,b)=>a+b,0)||1,cum=[];let running=0;
  for(const w of weights){running+=w/total;cum.push(Math.min(1,running));}
  const difficulty=Math.round(Math.max(0,Math.min(100,100-(cum[0]||0)*100-gap*8)));
  return {row,index,ordered,top,dominantPair,safeSingle,singleValue:evidence+(cum[0]||0)*25,difficulty,cum};
}
function tkpFastTableWidths(profiles,singleIndex,unit,role){
  const low=Math.ceil(1000/unit-1e-8),high=Math.floor(1400/unit+1e-8);
  let best=null;
  const walk=(at,counts,product,value)=>{
    if(product>high)return;
    if(at===profiles.length){
      if(product<low)return;
      const target=role==='main'?low:high;
      const final=value-(Math.abs(product-target)/Math.max(1,high-low))*(role==='main'?.035:.015);
      if(!best||final>best.value+1e-12||(Math.abs(final-best.value)<1e-12&&product<best.product))best={counts:counts.slice(),product,value:final};
      return;
    }
    const p=profiles[at];
    if(at===singleIndex){counts[at]=1;walk(at+1,counts,product,value+Math.log(Math.max(.001,p.cum[0]||0)));return;}
    const min=p.dominantPair?2:3,max=Math.max(min,Math.min(p.ordered.length,p.dominantPair?2:8));
    for(let count=min;count<=max;count++){
      counts[at]=count;walk(at+1,counts,product*count,value+Math.log(Math.max(.001,p.cum[count-1]||0)));
    }
  };
  walk(0,[],1,0);return best;
}
function tkpBuildCurrentReplayCouponsFromWidths(previousCoupons,raceResults){
  if(!previousCoupons||!Array.isArray(raceResults)||raceResults.length!==6)return null;
  const profiles=raceResults.slice().sort((a,b)=>Number(a?.r?.leg||0)-Number(b?.r?.leg||0)).map(tkpFastTableLegProfile);
  const safeSingles=profiles.filter(p=>p.safeSingle).sort((a,b)=>b.singleValue-a.singleValue||a.index-b.index);
  const relativeSingles=profiles.filter(p=>!p.dominantPair&&p.ordered.length).sort((a,b)=>b.singleValue-a.singleValue||a.index-b.index);
  const singlePool=safeSingles.concat(relativeSingles.filter(p=>!safeSingles.includes(p)));
  if(!singlePool.length)return null;
  const out={};
  const roles=['main','surprise','alt'];
  const usedSingleLegs=new Set();
  for(const [rolePos,key] of roles.entries()){
    const base=previousCoupons[key];
    if(!base||base.error||!Array.isArray(base.legs)||base.legs.length!==6)return null;
    const unit=Number(base.unit)||1.25;
    // Ilk yarisoncesi rol TEK'i bugun de ayni ayak tablosu lideriyse koru.
    // Lider degismisse veya ayakta iki guclu lider varsa o eski TEK gecersizdir.
    const oldSingleLeg=base.legs.find(l=>Array.isArray(l?.picks)&&l.picks.length===1);
    const preserved=oldSingleLeg&&profiles.find(p=>Number(p?.row?.r?.leg)===Number(oldSingleLeg?.r?.leg)&&!p.dominantPair&&String(p.top?.horse_no||'')===String(oldSingleLeg.picks[0]?.horse_no||''));
    let chosen=preserved&&!usedSingleLegs.has(preserved.index)?preserved:null;
    if(!chosen)chosen=singlePool.find(p=>!usedSingleLegs.has(p.index))||singlePool[rolePos%singlePool.length]||singlePool[0];
    usedSingleLegs.add(chosen.index);
    const widthPlan=tkpFastTableWidths(profiles,chosen.index,unit,key);
    if(!widthPlan)return null;
    const legs=profiles.map((profile,index)=>{
      const oldLeg=base.legs.find(l=>Number(l?.r?.leg)===Number(profile?.row?.r?.leg))||base.legs[index];
      const count=widthPlan.counts[index]||3,picks=profile.ordered.slice(0,count);
      const mass=profile.cum[count-1]||0;
      return {...oldLeg,r:profile.row.r,x:profile.row,ordered:profile.ordered,allHorses:profile.ordered,picks,
        protectedFlag:count===1,singleEligibility:count===1?{ok:true,leaderNo:String(picks[0]?.horse_no||''),relative:!profile.safeSingle}:null,
        minCoverage:count,maxCoverage:profile.dominantPair?2:Math.min(8,profile.ordered.length),
        distributionPlan:{difficulty:profile.difficulty,count,estimatedMass:mass,reason:count===1
          ?(profile.safeSingle?'Ayak tablosu lideri; TKP farkı ve destekleri TEK kontrolünü geçti.':'Ayak tablosundaki en güçlü göreli lider; kuponun zorunlu TEK ayağı.')
          :(profile.dominantPair?'İki güçlü lider kümesi · Y.PUAN 100+ ve AGF toplam desteğiyle 2 at.':`Ayak tablosu dağılımı · zorluk ${profile.difficulty}/100 · ${count} at · tahmini kapsama %${Math.round(mass*100)}`)}};
    });
    const combos=widthPlan.product;
    out[key]={...base,typeKey:key,legs,unit,combos,cost:Math.round(unit*combos*100)/100,error:null,
      readOnlySnapshot:true,snapshotSource:'CURRENT_ALGORITHM_REPLAY',calculationLimited:false,
      adaptiveBudgetNote:'Güncel ayak tabloları · TEK ve genişlikler sabit süreli hesaplandı · arşiv yeniden taranmadı'};
  }
  return out;
}
async function tkpRenderCurrentAlgorithmByFileId(fileId){
  if(!db || fileId==null || fileId==='') return false;
  const source=tkpSavedRacesForFile(fileId);
  if(!source.length) return false;
  if(globalThis.__tkpCurrentReplayInProgress||globalThis.__tkpCouponBuildInProgress) throw new Error('Devam eden hesap tamamlanmadan yeni hesap başlatılamaz.');
  globalThis.__tkpCurrentReplayInProgress=true;
  globalThis.__tkpBoundedCurrentReplay=true;
  const barrierKey='current-replay-'+String(fileId);
  const previousPayload=window.__lastPredictionPayload;
  const previousRows=lastRaceResults;
  const previousCoupons=typeof activeCoupons!=='undefined'?{...activeCoupons}:null;
  const previousPane=$('#predictionResult')?.querySelector('.predLegTab.active')?.dataset?.predleg;
  const selector=$('#tkpRecalcFileSelect');
  const wasDisabled=selector?.disabled;
  if(selector)selector.disabled=true;
  if(typeof tkpBeginTaskBarrier==='function')tkpBeginTaskBarrier(barrierKey);
  let rendered=false;
  try{
  // Tam structuredClone eski kayıtlardaki büyük yorum/kaynak eklerini de çoğaltıp
  // ana iş parçacığını saniyelerce durduruyordu. Replay yalnız yarış ve at üst
  // alanlarını değiştirir; bu yüzden iki seviyeli çalışma kopyası yeterlidir.
  let races=source.map(r=>({...r,horses:(r.horses||[]).map(h=>({...h,
    why:Array.isArray(h?.why)?h.why.slice():[],
    scoreParts:h?.scoreParts&&typeof h.scoreParts==='object'?{...h.scoreParts}:{}
  }))})).sort((a,b)=>Number(a.leg)-Number(b.leg));
  // Eski kilit alanlarını yalnız çalışma kopyasından çıkar. DB'deki frozen kanıt korunur.
  for(const r of races){
    delete r.__tkpArchivedReadOnly;
    for(const h of (r.horses||[])){
      delete h.prediction_score_snapshot;
      delete h.prediction_score_parts_snapshot;
      delete h.prediction_why_snapshot;
      delete h.prediction_best_lb_snapshot;
      delete h.prediction_score_snapshot_at;
      delete h.prediction_score_model_version;
      delete h.prediction_order_snapshot;
      delete h.prediction_tkp_display_raw_snapshot;
      delete h.prediction_tkp_display_score_snapshot;
      delete h.prediction_tkp_display_scale_snapshot;
      h.prediction_score_locked=0;
    }
  }
  if(typeof tkpYield==='function') await tkpYield();
  // Ana panel açılışında hazırlanmış güncel kural önbelleğini kullan. Bu düğmede
  // 29 bin atlık geçmiş indeksini yeniden kurmak tarayıcı sekmesini düşürüyordu.
  // Önbellek henüz hazır değilse ağır tam taramayı kullanıcı tıklamasının içine
  // sokma; mevcut doğrulanmış kural özetiyle hızlı yarış hesabına devam et.
  const replayRules=typeof tkpPeekCurrentRules==='function'?tkpPeekCurrentRules():null;
  globalThis.__tkpCurrentReplayRuleMode=Array.isArray(replayRules)?'memory-cache':'signal-only-fallback';
  if(typeof tkpYield==='function') await tkpYield();
  const f=(typeof tkpFileById==='function'?tkpFileById(fileId):null)||tkpVisibleRecalcFileById(fileId);
  window.__lastPredictionPayload={file:f||{id:fileId},races,source:'current_algorithm_replay',ypuan_import_report:f?.ypuan_import_report};
  // Güncel kural ve at-geçmişi özeti yukarıda bir kez hazırlanır. Altı ayağın her
  // birinde 3.000+ koşuluk ayrıntılı bağlamı tekrar taramak eski Chromium'da sekmeyi
  // düşürüyordu. Hızlı yarış bağlamı aynı güncel kuralları ve hazırlanmış at geçmişini
  // kullanır; yalnız yinelenen koşul/hipodrom tam taramasını atlar.
  rendered=await renderPredictionScreen(races,null,{archivedReadOnly:false,recompute:true,deferredContextRefresh:true,criticalPhase:true,forceFullContext:false,boundedReplay:true,preservePredictionDom:true,deferPostWork:true});
  if(!rendered) return false;
  const renderedRows=lastRaceResults;
  // Tahmin DOM'u kullanıcıya boyansın; kupon planlayıcısı aynı ana iş diliminde
  // hemen başlamasın. Bu gerçek bir event-loop sınırı olduğu için düğme/sekme
  // etkileşimleri kupon hesabı boyunca cevap vermeye devam eder.
  if(typeof setTimeout==='function') await new Promise(resolve=>setTimeout(resolve,0));
  else await Promise.resolve();
  const directCoupons=typeof tkpBuildCurrentReplayCouponsFromWidths==='function'
    ?tkpBuildCurrentReplayCouponsFromWidths(previousCoupons,renderedRows):null;
  if(directCoupons){
    activeCoupons.main=directCoupons.main;
    activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};
    activeCoupons.surprise=directCoupons.surprise;
    activeCoupons.alt=directCoupons.alt;
    const couponTarget=$('#budgetCouponResult');
    if(couponTarget){
      couponTarget.innerHTML='<div class="card" style="border-left:5px solid #2563eb;"><b>⚡ GÜNCEL ALGORİTMA · 3 KUPON</b><br>TKP sırası, TEK ve ayak genişlikleri güncel tablolardan yeniden hesaplandı.</div><div class="budgetCouponTriple" id="couponTripleWrap"><div id="couponCard-main"></div><div id="couponCard-surprise"></div><div id="couponCard-alt"></div></div>';
      if(typeof renderCouponCard==='function'){renderCouponCard('main');renderCouponCard('surprise');renderCouponCard('alt');}
      if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
    }
    if(previousPane&&/^leg-[1-6]$/.test(previousPane))$('#predictionResult')?.querySelector('.predLegTab[data-predleg="'+previousPane+'"]')?.click();
    return true;
  }
  if(typeof globalThis.tkpRunBudgetCouponBuild!=='function')throw new Error('Kupon oluşturucu hazır değil.');
  const coupons=await globalThis.tkpRunBudgetCouponBuild({currentReplay:true});
  if(lastRaceResults!==renderedRows) return false;
  if(!coupons?.ok)throw new Error(coupons?.error||'Üç kupon tamamlanamadı; tahmin tablosu kullanılabilir.');
  if(previousPane&&/^leg-[1-6]$/.test(previousPane))$('#predictionResult')?.querySelector('.predLegTab[data-predleg="'+previousPane+'"]')?.click();
  return true;
  }finally{
    if(!rendered&&window.__lastPredictionPayload?.source==='current_algorithm_replay'&&String(window.__lastPredictionPayload?.file?.id)===String(fileId)){
      window.__lastPredictionPayload=previousPayload;setLastRaceResults(previousRows);
      if(previousCoupons)Object.assign(activeCoupons,previousCoupons);
    }
    if(selector)selector.disabled=wasDisabled;
    globalThis.__tkpCurrentReplayInProgress=false;
    delete globalThis.__tkpBoundedCurrentReplay;
    if(typeof tkpEndTaskBarrier==='function')tkpEndTaskBarrier(barrierKey);
  }
}
if(typeof window!=='undefined')window.tkpRenderCurrentAlgorithmByFileId=tkpRenderCurrentAlgorithmByFileId;


let _tkpAutoCurrentDomesticRaceScheduled=false;
function tkpScheduleAutoOpenCurrentDomesticRace(){
  if(_tkpAutoCurrentDomesticRaceScheduled)return false;
  _tkpAutoCurrentDomesticRaceScheduled=true;
  const run=async()=>{
    try{
      // Boş/geleceksiz günde mevcut ekranı temizleme; yalnız bugün aktif veya
      // yaklaşan, TJK Program kaynaklı yerli koşu gerçekten varsa otomatik aç.
      const hit=tkpFindCurrentTjkRace(new Date());
      if(!hit||typeof tkpOpenCurrentTjkRace!=='function')return false;
      return await tkpOpenCurrentTjkRace({manual:false});
    }catch(error){console.warn('Güncel yerli koşu otomatik açılamadı:',error);return false;}
    finally{_tkpAutoCurrentDomesticRaceScheduled=false;}
  };
  // İlk genel DOM boyasından sonra normal öncelikte tek kez çalışır; tarihsel
  // 509 bakım/istatistik kuyrukları bu açılışı öne geçemez.
  if(typeof tkpQueueTask==='function')tkpQueueTask('auto-open-current-domestic-race',run,{priority:'normal',replace:true,minIdleMs:0});
  else setTimeout(()=>{void run();},0);
  return true;
}
if(typeof window!=='undefined')window.tkpScheduleAutoOpenCurrentDomesticRace=tkpScheduleAutoOpenCurrentDomesticRace;

function tkpParseIsoDateOnly(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[1]}-${m[2]}-${m[3]}`:'';}
function tkpRaceClockMinutes(r){
 // Otomatik saat seçimi yalnız TJK Program parserının ürettiği özel alana bakar.
 const raw=String(r?.tjk_race_time||'').trim();
 const m=raw.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);if(!m)return null;
 const h=Number(m[1]),mi=Number(m[2]);return h>=0&&h<24&&mi>=0&&mi<60?h*60+mi:null;
}
function tkpIsDomesticTjkRace(r,file){
 const domestic=new Set(['ANKARA','BURSA','ISTANBUL','İSTANBUL','IZMIR','İZMİR','ADANA','KOCAELI','KOCAELİ','ELAZIG','ELAZIĞ','SANLIURFA','ŞANLIURFA','DIYARBAKIR','DİYARBAKIR','ANTALYA']);
 const hip=String(r?.hippodrome||file?.hippodrome||'').trim().toLocaleUpperCase('tr-TR').replace(/\d+$/,'').trim();
 return domestic.has(hip);
}
function tkpIsTjkTimedRace(r,file){
 if(!Number.isFinite(tkpRaceClockMinutes(r)))return false;
 // tjk_race_time yalnız parseTjkProgramHTML tarafından yazılır. Genel race_time/start_time
 // veya yabancı/X kaynak saatleri bu özelliğe hiçbir zaman kabul edilmez.
 return String(r?.program_source||'').toLocaleUpperCase('tr-TR')==='TJK_PROGRAM';
}
function tkpFindCurrentTjkRace(now=new Date()){
 if(!db)return null;const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;const cur=now.getHours()*60+now.getMinutes();
 const files=new Map((db.files||[]).map(f=>[String(f.id),f]));const candidates=[];
 for(const r of (db.races||[])){
  const file=files.get(String(r.file_id));const date=tkpParseIsoDateOnly(r.race_date||file?.race_date);if(date!==today)continue;if(!tkpIsDomesticTjkRace(r,file))continue;if(!tkpIsTjkTimedRace(r,file))continue;
  const minute=tkpRaceClockMinutes(r);if(!Number.isFinite(minute))continue;const delta=minute-cur;
  // Koşu saati yeni geçtiyse 10 dakika aynı ayakta kal; daha eskiyse sonraki koşuya geç.
  if(delta>=-10)candidates.push({r,file,minute,delta,abs:Math.abs(delta)});
 }
 if(!candidates.length)return null;
 const future=candidates.filter(x=>x.delta>=0).sort((a,b)=>a.delta-b.delta||a.minute-b.minute)[0];
 return future||candidates.sort((a,b)=>a.abs-b.abs)[0]||null;
}
async function tkpOpenCurrentTjkRace({manual=false}={}){
 const hit=tkpFindCurrentTjkRace(new Date());if(!hit){
  const select=$('#tkpRecalcFileSelect');if(select){select.value='';delete select.dataset.selectionState;}
  if($('#bulletinFileName'))$('#bulletinFileName').textContent='Bugün aktif/yaklaşan TJK yerli koşusu bulunamadı.';
  if($('#predictionResult'))$('#predictionResult').innerHTML='<div class="empty">Bugün aktif/yaklaşan TJK yerli koşusu bulunamadı. Yabancı yarışları manuel seçebilirsin.</div>';
  if(manual)alert('TJK program saatine göre bugün aktif/yaklaşan yerli koşu bulunamadı.');
  return false;
 }
 const select=$('#tkpRecalcFileSelect');if(select){select.value=String(hit.file?.id||hit.r.file_id||'');select.dataset.selectionState='loading';}
  const ok=await renderSavedPredictionByFileId(hit.file?.id||hit.r.file_id);if(!ok)return false;
 const leg=Number(hit.r?.leg)||1;const root=$('#predictionResult');const btn=root?.querySelector(`.predLegTab[data-predleg="leg-${leg}"]`);if(btn)btn.click();
 if($('#bulletinFileName'))$('#bulletinFileName').textContent=`⏱️ TJK saati · ${typeof displayHippodromeShort==='function'?displayHippodromeShort(hit.r.hippodrome||hit.file?.hippodrome):hit.r.hippodrome||hit.file?.hippodrome||''} ${leg}. ayak ${String(hit.r.tjk_race_time||'')}`;
 return true;
}
window.tkpFindCurrentTjkRace=tkpFindCurrentTjkRace;window.tkpOpenCurrentTjkRace=tkpOpenCurrentTjkRace;

function wireEvents(){
  if ($('#tkpNowRaceBtn')) $('#tkpNowRaceBtn').onclick=()=>tkpOpenCurrentTjkRace({manual:true});
  let recalcSearchTimer=0;
  if($('#tkpRecalcFileSearch'))$('#tkpRecalcFileSearch').oninput=()=>{
    clearTimeout(recalcSearchTimer);
    recalcSearchTimer=setTimeout(()=>tkpRefreshRecalcFileSelect(),180);
  };
  // Dosya adı seçimden sonra ekranda kalsın. Aynı dosyanın yeniden seçilebilmesi için
  // değer dosya penceresi açılmadan hemen önce temizlenir; okuma bittikten sonra değil.
  ['historyFile','resultBulletinFile','predictionFile','bulletinFile','finalAgfFile','accurateFolderFile','restoreJSON','restoreTKPBackup'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onclick=function(){ try{ this.value=''; }catch(_){} };
  });

  // Bir gün seçilir seçilmez (butona basmadan) o günün KAYITLI tahmini ekrana gelir --
  // artık orijinal klasörü yeniden seçmek gerekmiyor.
  if ($('#tkpRecalcFileSelect')) $('#tkpRecalcFileSelect').onchange = async () => {
    const select=$('#tkpRecalcFileSelect');
    const selId=select?.value;
    if(!selId){
      if(select) delete select.dataset.selectionState;
      return;
    }
    const selectedFile=tkpVisibleRecalcFileById(selId);
    if(select) select.dataset.selectionState='loading';
    if($('#bulletinFileName')) $('#bulletinFileName').textContent=`⏳ ${displayDateTR(selectedFile?.race_date||'')} · ${typeof displayHippodromeShort==='function'?displayHippodromeShort(selectedFile?.hippodrome):selectedFile?.hippodrome||''} kayıtlı tahmini çağrılıyor...`;
    if(typeof tkpYield==='function') await tkpYield();
    const ok=await renderSavedPredictionByFileId(selId);
    // Kayıt açıldıktan sonra veri toplayıcı hedefini aynı gün/hipodromla
    // eşitle; önceki toplantıdan kalan manuel değer kullanılmasın.
    if(ok&&typeof window.tkpcSyncTodayDomesticMeetings==='function'){
      try{await window.tkpcSyncTodayDomesticMeetings({force:false});}catch(_e){}
    }
    if(select) select.dataset.selectionState=ok?'loaded':'error';
    if(!ok && $('#bulletinFileName')) $('#bulletinFileName').textContent='❌ Seçili yarış çağrılamadı; Dosyalar ekranında kayıt durumu kontrol edilmeli.';
  };

  $('#historyFile').onchange = async (e) => {
    let fName = (e.target.files||[])[0];
    if ($('#historyFileName')) $('#historyFileName').textContent = fName ? ('Seçilen dosya: ' + fName.name + ' · okunuyor...') : '';
    let f = (e.target.files||[])[0];
    if (!f) return;
    $('#historyPreview').innerHTML = '<div class="empty">Okunuyor...</div>';
    try {
      invalidateAdaptiveLearningCache();
      invalidateSideBetCache();
      let p;
      if (/\.html?$/i.test(f.name)){
        // TJK "Yarış Programı" ya da "Yarış Sonuçları" sayfası (yerli veya yurt dışı --
        // Del Mar/Saratoga/Woodbine vb. -- aynı formatta gelir). İçerik imzasıyla
        // doğrulanır ki yanlışlıkla başka bir HTML buraya sürüklenirse anlaşılır bir
        // hata verilsin. NOT: Sonuçları sayfası da "GunlukYarisProgrami" kelimesini
        // (menü/breadcrumb linkinde) geçirebildiği için gevşek bir arama Sonuçları'nı
        // Programı sanabilirdi -- bu yüzden Programı için kesin sütun imzası
        // ("-AtAdi") aranır, Sonuçları önce/ayrıca kontrol edilir.
        let text = await tkpReadFileText(f);
        if (/gunluk-GunlukYarisProgrami-AtAdi/i.test(text)){
          p = parseTjkProgramHTML(text, f.name);
        } else if (/gunluk-GunlukYarisSonuclari/i.test(text)){
          p = parseTjkResultsHTML(text, f.name);
        } else {
          throw new Error('Bu HTML bir TJK Yarış Programı/Sonuçları sayfası gibi görünmüyor (beklenen "GunlukYarisProgrami"/"GunlukYarisSonuclari" içeriği bulunamadı).');
        }
      } else {
        let xml = await unzipEntry(await tkpReadFileArrayBuffer(f), 'content.xml');
        p = parseODSxml(xml, f.name);
      }
      let fp = fingerprint(p);
      setPreviewPayload({p, fp});
      if ($('#historyFileName')) $('#historyFileName').textContent = 'Dosya okundu: ' + f.name + ' · kaydetmek için aşağıdaki onay düğmesine basın.';
      $('#historyPreview').innerHTML = historyPreviewHTML(p, fp);
      let btn = document.getElementById('confirmImportBtn');
      if (btn) btn.onclick = confirmImport;
    } catch(err){
      if ($('#historyFileName')) $('#historyFileName').textContent = 'Dosya okunamadı: ' + f.name;
      $('#historyPreview').innerHTML = `<div class="card" style="border-left:5px solid #dc2626;">${esc(err.message)}</div>`;
    }
  };
async function tkpProcessOfficialResultFile(f, options={}){
    const autoConfirm=Boolean(options.autoConfirm);
    if(!f) throw new Error('TJK sonuç dosyası bulunamadı.');
    // Önceki bir içe aktarımdan kalan payload kesinlikle kullanılmasın.
    setPreviewPayload(null);
    if($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent='Seçilen dosya: '+f.name+' · okunuyor...';
    if($('#historyPreview')) $('#historyPreview').innerHTML='<div class="empty">TJK sonuç dosyası okunuyor...</div>';

    invalidateAdaptiveLearningCache();
    invalidateSideBetCache();

    let p;
    if(/\.ods$/i.test(f.name)){
      const xml=await unzipEntry(await tkpReadFileArrayBuffer(f),'content.xml');
      p=parseODSxml(xml,f.name);
      p.file.import_kind='RESULT_ODS';
    }else{
      const text=await tkpReadFileText(f);
      const candidates=parseResultHtmlPayloadCandidates(text,f.name);
      if(!candidates.length){
        throw new Error('TJK sonuç HTML ayrıştırılamadı. Sonuç tablosu veya koşu dereceleri bulunamadı.');
      }
      p=selectBestResultPayload(candidates,{targetFileId:options.targetFileId});
      p.file.import_kind='RESULT_HTML';
    }

    p.file.sequence_no=p.file.sequence_no||((typeof tkpMaxSequenceNo==='function'?tkpMaxSequenceNo():db.files.reduce((m,x)=>Math.max(m,Number(x?.sequence_no)||0),0))+1);
    if(options.targetFileId!=null) p.file._target_file_id=String(options.targetFileId);
    p.races.forEach(r=>{r.sequence_no=p.file.sequence_no;});
    const state=resultMeetingRecordStatus(p);
    const q=resultPayloadQuality(p);
    const updateability=typeof resultPayloadUpdateability==='function'
      ? resultPayloadUpdateability(p)
      : {...q,hasAnything:q.withWinner>0,payoutRaces:0};

    if(!updateability.hasAnything){
      throw new Error('Dosyada kazanan/sıralama veya resmi ikramiye verisi bulunamadı.');
    }
    if(!state.targetFile){
      const reason=state.matchReason==='AMBIGUOUS'
        ? 'Aynı tarih ve hipodrom için birden fazla kayıt bulundu; doğru 2. Altılı kaydı kesinleştirilemedi.'
        : `Mevcut kayıt bulunamadı: ${displayDateTR(p.file.race_date||'')} ${typeof displayHippodromeShort==='function'?displayHippodromeShort(p.file.hippodrome):p.file.hippodrome||''}.`;
      throw new Error(reason);
    }

    const fp=fingerprint(p);
    setPreviewPayload({p,fp});

    if(!autoConfirm){
      if($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent=`Güncelleme okundu: ${f.name} · ${q.withWinner} sonuçlu ayak · ${updateability.payoutRaces||0} ikramiyeli ayak · birleştirmek için onayla.`;
      if($('#historyPreview')) $('#historyPreview').innerHTML=historyPreviewHTML(p,fp);
      const btn=document.getElementById('confirmImportBtn');
      if(btn) btn.onclick=confirmImport;
      return {prepared:true,targetFile:state.targetFile,quality:q,updateability};
    }

    const targetFile=state.targetFile;
    const resultEvidenceForFile=(fileId)=>{
      const rows=(db.races||[]).filter(r=>String(r.file_id)===String(fileId));
      const withWinner=rows.filter(r=>(r.horses||[]).some(h=>Number(h?.finish_position)===1||Number(h?.winner)===1)).length;
      const withTop5=rows.filter(r=>resultRaceQuality(r).complete).length;
      const payoutRaces=rows.filter(r=>Array.isArray(r.payouts)&&r.payouts.length>0).length;
      return {withWinner,withTop5,raceCount:rows.length,payoutRaces};
    };
    const beforeStamp=String(targetFile.result_updated_at||'');
    const beforeQuality=JSON.stringify(targetFile.result_quality||null);
    const beforeEvidence=resultEvidenceForFile(targetFile.id);
    const previousHistoricalTop5Only=Boolean(window.__tkpHistoricalTop5Only);
    window.__tkpHistoricalTop5Only=Boolean(options.historicalTop5Only);
    try{ await confirmImport(); }finally{ window.__tkpHistoricalTop5Only=previousHistoricalTop5Only; }

    // confirmImport/saveDB bazı akışlarda db.files nesnesini yenileyebilir; eski
    // object referansına bakmak yalancı "yazılamadı" üretiyordu. Kimlikle tekrar bul
    // ve asıl kanıtı yarış/at sonuç alanlarından ölç.
    const refreshedTarget=(db.files||[]).find(row=>String(row?.id)===String(targetFile.id))||targetFile;
    const afterStamp=String(refreshedTarget.result_updated_at||'');
    const afterQuality=JSON.stringify(refreshedTarget.result_quality||null);
    const afterEvidence=resultEvidenceForFile(refreshedTarget.id);
    const expectedWinners=Math.max(0,Number(q?.withWinner)||0);
    const hasRequiredEvidence=afterEvidence.withWinner>0 && (expectedWinners===0 || afterEvidence.withWinner>=Math.min(expectedWinners,afterEvidence.raceCount||expectedWinners));
    const applied=afterStamp!==beforeStamp || afterQuality!==beforeQuality
      || afterEvidence.withWinner>beforeEvidence.withWinner
      || afterEvidence.withTop5>beforeEvidence.withTop5
      || hasRequiredEvidence;
    if(!applied){
      setPreviewPayload(null);
      throw new Error('TJK sonuç dosyası okundu fakat hedef toplantıda doğrulanabilir sonuç kanıtı oluşmadı.');
    }
    // Recompute from stored horses; a legacy winner-only completion flag is stale.
    refreshedTarget.result_quality={complete:afterEvidence.withTop5,withWinner:afterEvidence.withWinner,
      raceCount:afterEvidence.raceCount,payoutRaces:afterEvidence.payoutRaces};
    if(!refreshedTarget.result_quality || (!Number(refreshedTarget.result_quality.withWinner) && !Number(refreshedTarget.result_quality.payoutRaces))){
      throw new Error('TJK sonuç kaydı doğrulanamadı; sonuç alanları boş kaldı.');
    }
    try{
      const updated=(db.races||[]).filter(r=>String(r.file_id)===String(targetFile.id)).map(r=>({r}));
      // R16.51 KÖK FIX (donma): tkpForwardTrackingSync altı ayağı TEK senkron
      // blokta işliyordu. historical-calibration.js'teki "KÖK FIX (donma)" ile
      // AYNI kök nedendir (bkz. o dosyadaki yorum) -- her ayak Strateji Lab/Bomba
      // Avcısı/TR profil hesapları ağır olduğundan (ölçüldü: gerçek 509 arşivde
      // ayak başına 0.5-7.5 sn), TJK sonucu onaylandığında bu adım kullanıcının
      // ekranını tek seferde 8-12+ sn kilitleyebiliyordu (donma tanısında "SONUÇ
      // ONAYI" olarak görülebilir). Aynı fonksiyon, aynı veri, aynı sıra -- yalnız
      // artık ayak başına çağrılıp aralarda UI'ye nefes alma payı bırakılıyor.
      // Sonuç/sıralama değişmez, yalnız UI donmadan tamamlanır.
      for(const one of updated){
        try{ tkpForwardTrackingSync([one]); }catch(_e){}
        if(typeof tkpWaitForBackgroundSafeWindow==='function') await tkpWaitForBackgroundSafeWindow({minIdleMs:0,retryMs:60});
        if(typeof tkpYieldToUi==='function') await tkpYieldToUi();
        else await new Promise(resolve=>setTimeout(resolve,0));
      }
      // V1.1.254 KÖK FIX: sonuç onayında bu iki defter-tutma çağrısı SENKRON ve
      // doğrudan yapılıyordu. surprise-cohort-tracker.js ve weekly-model-tracker.js
      // V1.1.213'ten SONRA eklendi ve V1.1.213'ün kendi "render/yükleme yolunda
      // görünmeden çalıştırılmaz" hız sözleşmesine (bkz. aşağıdaki yorum, tahmin
      // ekranı tarafı) bu onay akışında uyulmuyordu. weekly-model-tracker.js'teki
      // exactSideBetCache() ilk çağrıda TÜM sidebet_ticket_log'u baştan tarar; bu
      // log her gün birikip sınırsız büyüyor. Eski/yavaş donanımda (ör. Windows 8.1)
      // haftalar/aylar süren birikmiş logla bu senkron tarama "Sayfa Yanıt Vermiyor"
      // üretebilir. Kullanıcı sonucu görmeden bu defter tutma işini beklemesin diye
      // idle'a ertelendi -- doğruluk değişmez, yalnız NE ZAMAN çalıştığı değişir.
      const runTrackerSyncsIdle=()=>{
        try{ if(typeof tkpSurpriseCohortSync==='function')tkpSurpriseCohortSync(updated); }catch(_e){}
        try{ if(typeof tkpWeeklyModelTrackerSync==='function')tkpWeeklyModelTrackerSync(updated); }catch(_e){}
      };
      if(typeof requestIdleCallback==='function') requestIdleCallback(runTrackerSyncsIdle,{timeout:2500});
      else setTimeout(runTrackerSyncsIdle,0);
    }catch(_e){}
    return {applied:true,targetFile:refreshedTarget,quality:q,updateability,resultQuality:refreshedTarget.result_quality};
  }
  window.tkpProcessOfficialResultFile=tkpProcessOfficialResultFile;

  $('#resultBulletinFile').onchange = async (e) => {
    const f=(e.target.files||[])[0];
    if(!f) return;
    try{
      await tkpProcessOfficialResultFile(f,{autoConfirm:false});
    }catch(err){
      setPreviewPayload(null);
      if($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent='Sonuç okunamadı: '+f.name;
      if($('#historyPreview')) $('#historyPreview').innerHTML=`<div class="card" style="border-left:5px solid #dc2626;">${esc(err.message)}</div>`;
      e.target.value='';
    }
  };

  const accurateInput = $('#accurateFolderFile');
  if (accurateInput) accurateInput.onchange = async (e) => {
    const allFiles=[...(e.target.files||[])];
    const statusEl=$('#accurateFolderFileName');
    if(statusEl) statusEl.textContent = allFiles.length ? `Accurate klasörü okunuyor… (${allFiles.length} dosya)` : '';
    if(!allFiles.length) return;
    const usable=allFiles.filter(f => !tkpIsFolderAssetFile(f));
    const layerJob=typeof tkpStartJob==='function'?tkpStartJob('layers-import',{budgetMs:12,total:usable.length}):null;
    let layerProcessed=0;
    let resultSeen=0, resultApplied=0, resultSkipped=0, resultErrors=0;
    let accurateApplied=0, accurateSkipped=0, accurateMatchedHorses=0;
    let trPuanApplied=0, trPuanSkipped=0, trPuanMatchedHorses=0;
    const resultFileNames=new Set();
    const trPuanFileNames=new Set();
    $('#historyPreview').innerHTML='<div class="empty">Accurate, TR PUAN ve varsa sonuç/ikramiye dosyaları okunuyor…</div>';
    try{
      invalidateAdaptiveLearningCache(); invalidateSideBetCache();
      // Ganyan Canavarı TR PUAN sayfası ana bülteni yeniden yüklemeden mevcut
      // tarih/hipodrom/koşu kaydına birleştirilir. Dolu olmayan TR PUAN ve ST alanları
      // tamamlanır; aynı dosyanın tekrar yüklenmesi güvenlidir.
      // KÖK FIX: bu filtre yalnız .html/.htm uzantısını kabul ediyordu. Canlı
      // VERI_TOPLAYICI'nin GC TR PUAN için ürettiği asıl format .json
      // (GANYAN_CANAVARI_TR_PUAN_*.json, tkpParseGanyanCanavariTR'nin birincil
      // desteklediği biçim) -- bu yüzden collector'ın kendi ürettiği dosya bu
      // manuel "Accurate/TR PUAN klasörü aktar" yoluna sürüklenince hiçbir hata/log
      // vermeden sessizce filtrelenip atlanıyordu. .json artık kabul ediliyor.
      const usedTrRaceIds=new Set();
      for(const f of usable.filter(x=>/\.(?:html?|json)$/i.test(String(x.name||'')))){
        if(layerJob&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(layerJob,layerProcessed++,usable.length);
        let text='';
        try{text=await tkpReadFileText(f);}catch(_e){continue;}
        const trByName=/GANYAN_CANAVARI_TR_PUAN/i.test(String(f.name||''));
        const trByStructure=/table-yaris-programi/i.test(text) && /p_kosuno=["'][^"']+["'][^>]+p_atno=["'][^"']+/i.test(text);
        if(!trByName&&!trByStructure) continue;
        trPuanFileNames.add(String(f.name||''));
        let records=[];
        try{const fm=tkpAccurateMetaFromFileName(f);records=tkpParseGanyanCanavariTR(text,{date:fm.date,hip:fm.hip});}catch(_e){records=[];}
        for(const record of records){
          const target=tkpFindStoredRaceForTrRecord(f,record,usedTrRaceIds);
          if(!target){trPuanSkipped++;continue;}
          const res=tkpApplyTrPuanRecordToStoredRace(f,record,target);
          if(res.matched){usedTrRaceIds.add(target.id);trPuanApplied++;trPuanMatchedHorses+=Number(res.matched)||0;}
          else trPuanSkipped++;
        }
      }
      // Aynı klasörde TJK Sonuç HTML veya Sonuç ODS varsa kullanıcı ikinci iş yapmasın diye otomatik işlenir.
      // Accurate/summary HTML artık sonuç kaynağı gibi davranmaz; yanlış sonuç yazma riskini kesiyoruz.
      for(const f of usable.filter(x=>/\.(ods|html?|htm)$/i.test(String(x.name||'')) && !trPuanFileNames.has(String(x.name||'')))){
        if(layerJob&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(layerJob,layerProcessed++,usable.length);
        try{
          const name=String(f.name||'');
          let p=null;
          if(/\.ods$/i.test(name)){
            p=await tkpReadResultPayloadFromFile(f);
          }else{
            const text=await tkpReadFileText(f);
            if(!tkpLooksLikeOfficialTjkResultHtmlText(text,f)) continue;
            const candidates=parseResultHtmlPayloadCandidates(text,name);
            if(!candidates.length){ resultSkipped++; continue; }
            p=selectBestResultPayload(candidates);
            p.file.import_kind='RESULT_HTML';
            p.file.sequence_no=p.file.sequence_no||((typeof tkpMaxSequenceNo==='function'?tkpMaxSequenceNo():db.files.reduce((m,x)=>Math.max(m,Number(x?.sequence_no)||0),0))+1);
            p.races.forEach(r=>{r.sequence_no=p.file.sequence_no;});
          }
          if(!p) continue;
          const q=resultPayloadQuality(p);
          const updateability=typeof resultPayloadUpdateability==='function' ? resultPayloadUpdateability(p) : {...q,hasAnything:q.withWinner>0};
          const state=resultMeetingRecordStatus(p);
          if(!updateability.hasAnything){ resultSkipped++; continue; }
          resultSeen++;
          resultFileNames.add(String(f.name||''));
          if(state.targetFile){
            setPreviewPayload({p,fp:fingerprint(p)});
            await confirmImport();
            resultApplied++;
          } else {
            resultSkipped++;
          }
        }catch(err){ console.warn('Klasördeki sonuç dosyası işlenemedi', f.name, err); resultErrors++; }
      }
      // Accurate dosyaları yalnız mevcut yarışla eşleşirse alınır; eşleşmeyen koşu yeni kayıt açmaz.
      // Eşleştirme sırası: 1) dosya adından tarih/hipodrom/koşu no (varsa), 2) dosya içindeki at
      // isim/numaralarının mevcut yarışlarla örtüşmesi, 3) (aynı yüklemede dosya sayısı kalan boş
      // ayak sayısına eşitse) dosyaların seçildiği/kaydedildiği SIRA ile ayak sırası.
      const accurateCandidates=usable.filter(x=>/\.(pdf|html?|htm|txt|csv)$/i.test(String(x.name||'')) && !resultFileNames.has(String(x.name||'')) && !trPuanFileNames.has(String(x.name||'')));
      const usedRaceIds=new Set();
      const unresolved=[];
      for(const f of accurateCandidates){
        if(layerJob&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(layerJob,layerProcessed++,usable.length);
        let entries=[];
        if(!/\.pdf$/i.test(String(f.name||''))){
          try{ entries=tkpParseAccurateEntriesFromText(await tkpReadFileText(f)); }catch(_e){ entries=[]; }
        }
        const meta=tkpAccurateMetaFromFileName(f);
        let target=tkpFindRaceForAccurateMeta(meta);
        if(!target) target=tkpFindRaceForAccurateEntries(entries, usedRaceIds);
        if(!target){ unresolved.push({f,entries}); continue; }
        usedRaceIds.add(target.id);
        // Accurate katmanı tekrar yüklenebilir: eksikleri tamamlar, aynı değerleri
        // idempotent biçimde bırakır ve daha yeni gerçek değerleri güncelleyebilir.
        const res=tkpApplyAccurateFileToRace(f,target,entries);
        if(Number(res.matched)>0){accurateMatchedHorses += Number(res.matched)||0;accurateApplied++;}
        else accurateSkipped++;
      }
      // Sıra bazlı son çare: içerikle eşleşmeyen dosya sayısı, henüz Accurate verisi TAM
      // olmayan (eksik ya da hiç yok) ayak sayısına eşitse, dosyalar seçim sırasıyla
      // ayaklara (leg 1,2,3...) atanır.
      if(unresolved.length){
        const emptyLegRaces=orderedActiveRaces().filter(r=>!usedRaceIds.has(r.id) && !(typeof tkpAccurateIsComplete==='function' && tkpAccurateIsComplete(r)));
        if(unresolved.length===emptyLegRaces.length){
          unresolved.forEach(({f,entries},i)=>{
            const target=emptyLegRaces[i];
            usedRaceIds.add(target.id);
            const res=tkpApplyAccurateFileToRace(f,target,entries);
            accurateMatchedHorses += Number(res.matched)||0;
            accurateApplied++;
          });
        } else {
          accurateSkipped += unresolved.length;
        }
      }
      if(accurateApplied || resultApplied || trPuanApplied){
        invalidateActiveRacesCache(); invalidateProfileMatchCache(); invalidateWinnerProfileCache(); invalidateConditionStatsCache(); invalidateAdaptiveLearningCache(); invalidateSideBetCache();
        await saveDB(false);
      }
      const layerReport={accurateApplied,accurateSkipped,accurateMatchedHorses,trPuanApplied,trPuanSkipped,trPuanMatchedHorses,resultSeen,resultApplied,resultSkipped,resultErrors,persistedAt:new Date().toISOString()};
      window.__tkpLastLayerImportResult=layerReport;
      try{window.dispatchEvent(new CustomEvent('tkp:layers-imported',{detail:layerReport}));}catch(_e){}
      const msgParts=[];
      msgParts.push(`Accurate eşleşen koşu: ${accurateApplied}`);
      msgParts.push(`Accurate atlanan: ${accurateSkipped}`);
      if(accurateMatchedHorses) msgParts.push(`At eşleşmesi: ${accurateMatchedHorses}`);
      if(trPuanApplied || trPuanSkipped || trPuanMatchedHorses){
        msgParts.push(`TR PUAN eşleşen koşu: ${trPuanApplied}`);
        if(trPuanSkipped) msgParts.push(`TR PUAN atlanan: ${trPuanSkipped}`);
        if(trPuanMatchedHorses) msgParts.push(`TR PUAN at eşleşmesi: ${trPuanMatchedHorses}`);
      }
      if(resultSeen) msgParts.push(`Sonuç HTML/ODS bulundu: ${resultSeen}`);
      if(resultApplied) msgParts.push(`Sonuç otomatik işlendi: ${resultApplied}`);
      if(resultSkipped) msgParts.push(`Sonuç atlandı/kayıtlı: ${resultSkipped}`);
      if(resultErrors) msgParts.push(`Sonuç hata: ${resultErrors}`);
      const msg=msgParts.join(' · ');
      const anyApplied=Boolean(accurateApplied || resultApplied || trPuanApplied);
      if(statusEl) statusEl.textContent=(anyApplied?'✅ ':'⚠️ ')+msg;
      const detail=anyApplied
        ? 'Mevcut toplantıya bulunan sonuç ve veri katmanları işlendi. Yeni yarış kaydı oluşturulmadı.'
        : 'Hiçbir veri mevcut toplantıyla eşleşmedi. Tarih, hipodrom ve gerçek koşu numarası kontrol edilmelidir.';
      $('#historyPreview').innerHTML=`<div class="card" style="border-left:5px solid ${anyApplied?'#16a34a':'#dc2626'};"><b>${anyApplied?'Sonuç/Accurate verileri işlendi.':'Veri eşleşmedi.'}</b><br>${esc(msg)}<br><span class="muted">${esc(detail)}</span></div>`;
      log('ACCURATE', msg);
      renderActivePane();
    }catch(err){
      if(statusEl) statusEl.textContent='Accurate klasörü işlenemedi.';
      $('#historyPreview').innerHTML=`<div class="card" style="border-left:5px solid #dc2626;"><b>Accurate klasörü işlenemedi:</b> ${esc(err?.message||String(err))}</div>`;
      console.error('Accurate klasörü hatası:', err);
    }finally{
      if(layerJob&&typeof tkpFinishJob==='function')tkpFinishJob(layerJob);
    }
  };

  $('#clearImportScreen').onclick = () => {
    setPreviewPayload(null);
    if($('#historyFile')) $('#historyFile').value='';
    if($('#resultBulletinFile')) $('#resultBulletinFile').value='';
    if($('#accurateFolderFile')) $('#accurateFolderFile').value='';
    if($('#historyFileName')) $('#historyFileName').textContent='';
    if($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent='';
    if($('#accurateFolderFileName')) $('#accurateFolderFileName').textContent='';
    if($('#historyPreview')) $('#historyPreview').innerHTML='';
    if($('#resultBulletinPreview')) $('#resultBulletinPreview').innerHTML='';
  };

  // Günlük tahmin ekranını sıfırlar: yeni günün verisini yüklemeden önce eski dosya seçimlerini,
  // önizleme/sonuç panellerini ve bellekteki tahmin verisini (window.__lastPredictionPayload) temizler.
  $('#clearPredictionScreen').onclick = () => {
    // Tahmin ve Back Test ekran görüntüleri normal gezinmede korunur. Bunları
    // yalnız kullanıcının açık "Ekranı Temizle" isteği kalıcı olarak siler.
    if (typeof window.tkpClearScreenSnapshots === 'function') window.tkpClearScreenSnapshots();
    invalidateAdaptiveLearningCache();
    invalidateSideBetCache();
    window.__lastPredictionPayload = null;
    window.__tkp_conditionSignalSummary = null;
    try { lastRaceResults = []; } catch(_) {}
    if ($('#predictionFile')) $('#predictionFile').value = '';
    if ($('#bulletinFile')) $('#bulletinFile').value = '';
    if ($('#finalAgfFile')) $('#finalAgfFile').value = '';
    if ($('#tkpRecalcFileSelect')) $('#tkpRecalcFileSelect').value = '';
    if ($('#finalAgfFileName')) $('#finalAgfFileName').textContent = '';
    if ($('#predictionFileName')) $('#predictionFileName').textContent = '';
    if ($('#bulletinFileName')) $('#bulletinFileName').textContent = '';
    if ($('#predictionResult')) $('#predictionResult').innerHTML = '';
    if ($('#budgetCouponResult')) $('#budgetCouponResult').innerHTML = '';
    if ($('#suggestedBudgetHint')) $('#suggestedBudgetHint').innerHTML = '';
    // Bütçe kullanıcı ayarıdır; ekran temizlemek 700–1.400 TL seçimini bozmaz.
    if ($('#couponBacktestResult')){
      $('#couponBacktestResult').innerHTML = '';
      delete $('#couponBacktestResult').dataset.ready;
    }
  };

  $('#predictionFile').onchange = async (e) => {
    invalidateAdaptiveLearningCache();
    invalidateSideBetCache();
    let f = (e.target.files||[])[0];
    if ($('#predictionFileName')) $('#predictionFileName').textContent = f ? ('Seçilen dosya: ' + f.name) : '';
    if (!f) return;
    tkpShowPanelPending($('#predictionResult'), 'Yeni tahmin okunuyor… Önceki tahmin sonuç hazır olana kadar korunuyor.', 'prediction');
    try {
      let xml = await unzipEntry(await tkpReadFileArrayBuffer(f), 'content.xml');
      let p = parseODSxml(xml, f.name);
      window.__lastPredictionPayload = p;
      const qcResult=upsertPredictionQc(p, false);
      if ($('#predictionFileName')){
        $('#predictionFileName').textContent = qcResult.duplicate
          ? `Seçilen dosya: ${f.name} · QC'de zaten mevcut, yeni kayıt açılmadı.`
          : `Seçilen dosya: ${f.name} · QC'ye BEKLİYOR olarak eklendi.`;
      }
      // ÖNEMLİ: p.races bu tek dosyanın HAM/taze okumasıdır -- ayrıca yüklenmiş
      // J-BYG/YPUAN gibi zenginleştirme alanlarını içermez (onlar yalnızca
      // db.races içinde, storePredictionQcRaces sırasında birleştirilir). Hem
      // "ODS indir" butonu hem ekrandaki tahmin tablosu bu YÜZDEN aynı kaynağı
      // (zenginleştirilmiş db.races) kullanır -- closure dışında BİR KEZ hesaplanır.
      const fileId = qcResult && qcResult.record ? qcResult.record.id : null;
      const enrichedRaces = fileId!=null ? (typeof tkpRowsByFileId==='function'?tkpRowsByFileId(fileId):db.races.filter(r => r.file_id===fileId)).slice().sort((a,b)=>a.leg-b.leg) : null;
      const displayRaces1 = (enrichedRaces && enrichedRaces.length) ? enrichedRaces : p.races;
      // Bu ODS akışının altında eski render gövdesinin bir kopyası kalmıştı. Aynı yarış
      // önce burada, sonra ortak renderPredictionScreen içinde ikinci kez hesaplanıyordu.
      // Ortak async render'a geçip handler'ı burada sonlandırmak çift hesaplamayı kaldırır.
      await renderPredictionScreen(displayRaces1,p);
      return;
    } catch(err){
      tkpShowPanelError($('#predictionResult'), `Tahmin açılamadı: ${err.message}`, 'prediction');
    }
  };

// V25_NATIVE_FOLDER_FIX: Klasör seçimi artık gerçek dosya inputunun üstten tıklanmasıyla açılır.
// Parent butona programatik input.click() bağlamıyoruz; bazı tarayıcılarda klasör izni bu yüzden kopuyordu.
if ($('#chooseBulletinFolder')) $('#chooseBulletinFolder').onclick = null;
if ($('#bulletinFile')) $('#bulletinFile').onclick = function(){ window.__v25RequestedAltiliNo=0; window.__v25ActiveAltiliNo=0; try{ this.value=''; }catch(_){} };
if ($('#chooseFinalAgfHtml')) $('#chooseFinalAgfHtml').onclick = async () => {
  const btn=$('#chooseFinalAgfHtml'),input=$('#finalAgfFile');if(btn)btn.disabled=true;if($('#finalAgfFileName'))$('#finalAgfFileName').textContent='TJK Program otomatik yenileniyor…';
  try{if(typeof window.tkpRefreshFinalAgfFromTjk!=='function')throw new Error('Veri Toplayıcı Son AGF köprüsü hazır değil');const ok=await window.tkpRefreshFinalAgfFromTjk();if(!ok)throw new Error('TJK Program otomatik yenilenemedi');if($('#finalAgfFileName'))$('#finalAgfFileName').textContent='✅ Son AGF TJK Programdan güncellendi.';}
  catch(error){console.warn('Son AGF otomatik yenileme uyarısı',error);const reason=String(error?.message||error||'Bilinmeyen hata').replace(/\s+/g,' ').trim();if($('#finalAgfFileName'))$('#finalAgfFileName').textContent=`⚠️ Otomatik TJK alınamadı: ${reason}. Manuel HTML seçebilirsin.`;input?.click();}
  finally{if(btn)btn.disabled=false;}
};
if ($('#finalAgfFile')) $('#finalAgfFile').onclick = function(){ this.value=''; };
if ($('#finalAgfFile')) $('#finalAgfFile').onchange = (e) => {
  const f=e.target.files?.[0];
  if(!f) return;
  if ($('#finalAgfFileName')) $('#finalAgfFileName').textContent='Son AGF okunuyor…';
  window.__finalAgfUploadPending=true;
  const bf=$('#bulletinFile');
  if(bf && typeof bf.onchange==='function') bf.onchange({target:{files:[f]}});
  else {
    window.__finalAgfUploadPending=false;
    if ($('#finalAgfFileName')) $('#finalAgfFileName').textContent='Son AGF yüklenemedi: dosya yükleme modülü hazır değil.';
  }
};

$('#bulletinFile').onchange = async (e) => {
    const isFinalAgf=!!window.__finalAgfUploadPending;
    invalidateAdaptiveLearningCache();
    invalidateSideBetCache();
    // Klasör seçiminde (webkitdirectory) klasördeki TÜM dosyalar gelir; yalnızca .html/.htm
    // olanları alıyoruz, geri kalanı (varsa) sessizce yok sayılır.
    // Tarayıcının "Web Page, Complete" ile kaydettiği reklam/izleme iframe parçaları
    // (ads.html, aframe.html, ssp.html, sync.html, saved_resource(N).html, zrt_lookup...
    // gibi -- özellikle İndirilenler klasörü seçildiğinde onlarca kez tekrar eden dosya
    // adları) bülten/galop/J-BYG/YPUAN sınıflandırmasına asla girmiyor, sadece ekrandaki
    // "Tanınmayan dosya" listesini gereksiz yere şişiriyor. Bunları en baştan eliyoruz.
    let allFiles = [...(e.target.files||[])];
    let files = allFiles.filter(tkpUsableUploadFile);
    window.__tkpLastBulletinFiles = files.length ? files : window.__tkpLastBulletinFiles;
    if ($('#bulletinFileName')) {
      $('#bulletinFileName').textContent = files.length
        ? `Klasör okunuyor… (${files.length} uygun dosya / ${allFiles.length} toplam)`
        : `Uygun HTML/ODS dosyası bulunamadı. (${allFiles.length} dosya seçildi; TJK klasörünün kökünde Yarış Programı.html olmalı)`;
    }
    if (!files.length) return;
    tkpShowPanelPending($('#predictionResult'), 'Yeni tahmin okunuyor… Önceki tahmin sonuç hazır olana kadar korunuyor.', 'prediction');
    try {
      // TOMMY çalışan sürümünden alınan sade klasör akışı:
      // klasörü önce tek ana kaynak gibi oku; çoklu altılı varsa kullanıcı talimatı gereği
      // doğrudan 2. Altılıyı iste. Böylece classifyAndMergeAllFiles'ın klasördeki
      // yardımcı TJK/Jokey/Galop dosyalarını yanlış ana kaynak sanıp karıştırma riski kapanır.
      const requestedAlt=Math.max(0,Number(window.__v25RequestedAltiliNo)||0);
      if(!isFinalAgf) window.__v25LastBulletinFiles=files.slice();
      const activeAltForFinal=Math.max(1,Number(window.__v25ActiveAltiliNo)||requestedAlt||2);
      const desiredAlt=isFinalAgf ? activeAltForFinal : 2;
      let bundle=null, firstErr=null;
      try{
        bundle=await classifyAndMergeFiles(files,desiredAlt);
      }catch(err){
        firstErr=err;
        // Tek altılı günlerde 2 istenince başarısız olursa 1. Altılıya düş.
        if(!isFinalAgf && desiredAlt!==1) bundle=await classifyAndMergeFiles(files,1);
        else throw err;
      }
      if(!bundle || !bundle.p || !Array.isArray(bundle.p.races) || !bundle.p.races.length){
        throw firstErr || new Error('Seçilen dosyalarda işlenebilir Altılı bulunamadı.');
      }
      let {p, log, unknown} = bundle;
      p.file=p.file||{};
      // İki altılı varsa aktif kayıt 2. Altılı olarak işaretlenir; tek altılıda doğal 1 kalır.
      const sourceCount=Math.max(1,Number(p.file.altili_count)||Number(p.file.altili_no)||1);
      if(!isFinalAgf && sourceCount>1){
        p.file.altili_no=2;
        p.file.altili_count=sourceCount;
        (p.races||[]).forEach(r=>{r.altili_no=2;});
      }
      const qcResult2=upsertPredictionQc(p,isFinalAgf);
      window.__v25ActiveAltiliNo=Number(p.file.altili_no)||desiredAlt||1;
      window.__v25RequestedAltiliNo=window.__v25ActiveAltiliNo;
      window.__v25SourceAltiliCount=sourceCount;
      // Ekranda geçiş düğmesi yok: bu build sadece aktif 2. Altılıyı gösterir.
      window.__v25AltiliCount=1;
      if ($('#bulletinFileName')){
        const usefulCount = 1 + log.filter(l => l.startsWith('✅')).length;
        const altPrefix=(window.__v25SourceAltiliCount>1 && Number(window.__v25ActiveAltiliNo)===2)
          ? '✅ Sadece 2. Altılı tahmin alındı. '
          : '';
        const baseMessage = altPrefix + (usefulCount > 1 ? '✅ Bülten ve ek veriler yüklendi.' : '✅ Bülten yüklendi.');
        const DOMESTIC_HIPS_FOR_QC = new Set(['ADANA','ANKARA','ANTALYA','BURSA','DIYARBAKIR','DİYARBAKIR','ELAZIG','ELAZIĞ','ISTANBUL','İSTANBUL','IZMIR','İZMİR','KOCAELI','KOCAELİ','SANLIURFA','ŞANLIURFA']);
        const activeHipForQc = String(p?.file?.hippodrome || (p.races||[])[0]?.hippodrome || '').trim().toLocaleUpperCase('tr-TR');
        const foreignForQc = activeHipForQc && !DOMESTIC_HIPS_FOR_QC.has(activeHipForQc);
        const missingGalop = foreignForQc ? [] : (p.races || []).map(r => {
          const horses = r.horses || [];
          const filled = horses.filter(h => Number(h.g800) > 0).length;
          // 800G/GLP şablon kuralı tüm atlar değil, en hızlı ilk 6'dır. 6/11 veya
          // 6/14 tam kabul edilir; sadece ilk 6 bile tamamlanmadıysa eksik yazılır.
          const expected = Math.min(6, horses.length);
          return {leg:r.leg, filled, total:horses.length, expected};
        }).filter(x => x.expected > 0 && x.filled < x.expected);
        let warning = foreignForQc ? ' ℹ️ Yabancı pist: TJK galop/J-BYG/800G zorunluluğu uygulanmadı.' : '';
        if (missingGalop.length){
          const none = missingGalop.filter(x => x.filled === 0);
          const partial = missingGalop.filter(x => x.filled > 0);
          const parts = [];
          if (none.length) parts.push(`${none.map(x=>x.leg+'. ayak').join(', ')} galop yok`);
          if (partial.length) parts.push(partial.map(x=>`${x.leg}. ayak ${x.filled}/${x.expected} GLP`).join(', ') + ' eksik');
          warning = ' ⚠️ Eksik veri: ' + parts.join('; ') + '.';
        }
        // YPUAN durumu -- galopla aynı mantıkta ama ayrı bir satırda gösterilir; galopun
        // aksine YPUAN opsiyonel bir dosya olduğu için hiç seçilmediyse uyarı VERİLMEZ,
        // yalnızca dosya seçilip de hiçbir at eşleşmediyse veya kısmi eşleştiyse uyarılır.
        const ypuanFileDetected = log.some(l => l.includes('YPUAN'));
        let ypuanNote = '';
        if (ypuanFileDetected){
          const totalHorses = (p.races||[]).reduce((s,r)=>s+(r.horses||[]).length,0);
          const filledYpuan = (p.races||[]).reduce((s,r)=>s+(r.horses||[]).filter(h=>h.ypuan!=null).length,0);
          if (filledYpuan === 0){
            ypuanNote = ' ⚠️ YPUAN dosyası okundu ama HİÇBİR at eşleşmedi (ayak/at numarası uyuşmuyor olabilir).';
          } else if (filledYpuan < totalHorses){
            ypuanNote = ` ℹ️ YPUAN: ${filledYpuan}/${totalHorses} at için puan işlendi.`;
          } else {
            ypuanNote = ` ✅ YPUAN: ${filledYpuan} atın tamamına puan işlendi.`;
          }
        }
        // KÖK FIX: TR PUAN (Ganyan Canavarı) galop/YPUAN gibi ayrı bir durum satırında
        // hiç gösterilmiyordu; trLog içindeki ✅/⚠️ mesajları yalnızca konsol/DB'de
        // kalıp ekrana hiç yansımıyordu. Kullanıcı TR PU. sütununun neden boş
        // kaldığını anlamak için önceden log dosyası aramak zorundaydı. Artık galop/
        // YPUAN ile aynı düzende özet gösteriliyor.
        const trFileDetected = log.some(l => /Ganyan Canavarı \d+\. koşu|GANYAN_CANAVARI_TR_PUAN/i.test(l));
        let trNote = '';
        if (trFileDetected){
          const totalHorsesTr = (p.races||[]).reduce((s,r)=>s+(r.horses||[]).length,0);
          const filledTr = (p.races||[]).reduce((s,r)=>s+(r.horses||[]).filter(h=>Number(h.tr_ganyan)>0 && h.tr_ganyan_source==='GANYAN_CANAVARI_TR').length,0);
          const trWarnLines = log.filter(l => l.startsWith('⚠️') && /Ganyan Canavarı|TR PUAN|TR puanı/i.test(l));
          if (filledTr === 0){
            trNote = ' ⚠️ TR PUAN dosyası okundu ama HİÇBİR at eşleşmedi' + (trWarnLines.length ? ` (${trWarnLines[0]})` : ' (ayak/at eşleşmesi kurulamadı).');
          } else if (filledTr < totalHorsesTr){
            trNote = ` ℹ️ TR PUAN: ${filledTr}/${totalHorsesTr} at için puan işlendi.` + (trWarnLines.length ? ` ⚠️ ${trWarnLines[0]}` : '');
          } else {
            trNote = ` ✅ TR PUAN: ${filledTr} atın tamamına puan işlendi.`;
          }
        }
        // Sınıflandırılamayan (bülten/galop/J-BYG/YPUAN hiçbirine uymayan) dosyalar
        // önceden sessizce yok sayılıyordu; artık isimleri ekranda gösteriliyor ki
        // "dosyam neden işlenmedi" sorusu kolayca cevaplanabilsin. Aynı isim birden
        // fazla alt klasörden gelebildiği için tekrarsızlaştırılır, liste çok uzunsa
        // (ör. temiz olmayan bir klasör seçildiyse) belirli sayıdan sonra kısaltılır.
        let unknownNote = '';
        if (unknown && unknown.length){
          const uniqueUnknown = [...new Set(unknown)];
          const MAX_SHOWN = 6;
          const shown = uniqueUnknown.slice(0, MAX_SHOWN);
          const extra = uniqueUnknown.length - shown.length;
          unknownNote = ' ❓ Tanınmayan dosya(lar): ' + shown.join(', ') + (extra > 0 ? ` (+${extra} tane daha)` : '') + '.';
        }
        $('#bulletinFileName').textContent = baseMessage + warning + ypuanNote + trNote + unknownNote;
        $('#bulletinFileName').classList.toggle('uploadWarning', !!warning || ypuanNote.includes('⚠️') || trNote.includes('⚠️') || !!unknownNote);
      }
      window.__lastPredictionPayload = p;
      if(isFinalAgf && $('#finalAgfFileName')) $('#finalAgfFileName').textContent='✅ Son AGF yüklendi; tahmin güncellendi.';
      window.__finalAgfUploadPending=false;
      // ÖNEMLİ: p.races bu yüklemenin HAM/taze okumasıdır -- "Son AGF" akışında
      // galop/J-BYG/YPUAN dosyaları o an yüklemede yoktur, bu yüzden p.races'te
      // bu alanlar boştur. Zenginleştirilmiş (galop/J-BYG/YPUAN dahil) hâl yalnızca
      // db.races içindedir -- hem "ODS indir" butonu hem ekrandaki tahmin tablosu
      // BU YÜZDEN aynı kaynağı kullanır, "Dosyalar" tablosundaki "📥 ODS indir" ile
      // birebir aynı -- closure dışında BİR KEZ hesaplanır (önceki sürümde closure
      // içinde tanımlandığı için dışarıdan erişilemiyordu, tahmin tablosu yine
      // ham p.races'i kullanmaya devam ediyordu).
      const fileId2 = qcResult2 && qcResult2.record ? qcResult2.record.id : null;
      const enrichedRaces2 = fileId2!=null ? (typeof tkpRowsByFileId==='function'?tkpRowsByFileId(fileId2):db.races.filter(r => r.file_id===fileId2)).slice().sort((a,b)=>a.leg-b.leg) : null;
      const displayRaces2 = (enrichedRaces2 && enrichedRaces2.length) ? enrichedRaces2 : p.races;
      // Veri Toplayıcı aktarımının başarı/kayıt sözleşmesi tahmin hesabına bağlı
      // değildir. Toplayıcı modunda payload + DB kaydı tamamlanır ve ağır ekran
      // hesabı batch kalıcı kaydı kapandıktan sonra ayrı sırada başlatılır.
      if(window.__tkpCollectorFastImport){
        window.__tkpCollectorDeferredPrediction={races:displayRaces2,payload:p,isFinalAgf};
        return true;
      }
      await renderPredictionScreen(displayRaces2, p);
      if(isFinalAgf)setTimeout(()=>{try{Promise.resolve(autoBuildCouponsAfterFinalAgf()).catch(e=>console.warn('Otomatik kupon üretilemedi',e));}catch(e){console.warn('Otomatik kupon üretilemedi',e);}},150);
    } catch(err){
      const errMsg = err?.message || String(err);
      const onlyManualSupport = Array.isArray(files) && files.length && files.every(f=>{
        const nm=fold(String(f?.webkitRelativePath||f?.name||''));
        return /BITALIH|HIPODROM|ATYARISI|AT YARISI|YPUAN|YORUMCU|GANYAN CANAVARI/.test(nm);
      });
      // Yardımcı yorumcu/YPUAN klasörü ana bülten OLMADAN açılışta veya
      // yanlış zamanda tekrar işlenirse tahmin ekranını kırma. Bu dosyalar ana tahmin
      // dosyası değildir; mevcut kayıt varsa classifyAndMergeFiles zaten ekler. Mevcut
      // kayıt yoksa yalnız durum yaz, "Tahmin açılamadı" kırmızı hatası basma.
      if(onlyManualSupport && /ana bülten bulunamadı|ana bulten bulunamadi/i.test(fold(errMsg))){
        if($('#bulletinFileName')){
          $('#bulletinFileName').textContent='ℹ️ Manuel destek dosyaları görüldü; aynı tarih/hipodrom için ana yarış kaydı bulunamadığı için beklemeye alındı. Önce TJK bülteniyle kaydı oluştur, sonra destek klasörünü tekrar seç. JKY/GLP yalnız Ganyan Canavarı tarafından tamamlanır.';
          $('#bulletinFileName').classList.remove('uploadWarning');
        }
        window.__finalAgfUploadPending=false;
        return;
      }
      if(isFinalAgf && $('#finalAgfFileName')) $('#finalAgfFileName').textContent='Son AGF yüklenemedi: '+errMsg;
      window.__finalAgfUploadPending=false;
      tkpShowPanelError($('#predictionResult'), `Tahmin açılamadı: ${errMsg}`, 'prediction');
    }
  };

  const buildBudgetCouponBtn = $('#buildBudgetCoupon');
  const runBudgetCouponBuild = (options={}) => {
    // Veri toplayıcı otomatik başlatırken ve kullanıcı düğmeye yeniden basarken aynı
    // kupon üretimi paralel çalışmasın. Paralel üretim hem ana thread'i iki kez
    // yoruyor hem de geç gelen render/snapshot öncekinin üstüne yazabiliyordu.
    if(globalThis.__tkpCouponBuildInProgress===true){
      return globalThis.__tkpCouponBuildPromise || Promise.resolve({ok:false,rendered:false,reason:'in_progress'});
    }
    const task = async () => {
    globalThis.__tkpCouponBuildInProgress=true;
    const target = $('#budgetCouponResult');
    const sourceRows=lastRaceResults;
    const buildStartedAt=typeof performance!=='undefined'?performance.now():Date.now();
    let progressTimer=null,progressText=null,cancelButton=null,buildPhase='Hazırlık',buildFailed=false,buildCancelled=false;
    const showProgress=()=>{
      if(!progressText)return;
      const now=typeof performance!=='undefined'?performance.now():Date.now();
      progressText.textContent=buildPhase+' · '+((now-buildStartedAt)/1000).toFixed(1)+' sn · Hesaplama sınırı 40 sn';
    };
    const buildOptions={startedAt:buildStartedAt,currentReplayFast:options.currentReplay===true,onProgress:run=>{buildPhase=run.stage;showProgress();}};
    try {
      if(!target)return {ok:false,rendered:false,reason:'target_missing'};
      if (!lastRaceResults || !Array.isArray(lastRaceResults) || !lastRaceResults.length){
        // Ekranda daha önce otomatik açılmış salt-okunur bir yarış-öncesi
        // snapshotı varsa, seçili gün/bülten olmadan bu düğmeye basmak onu
        // silmemeli. Eski davranış kartları "Önce bir tahmin dosyası yükle"
        // metniyle değiştiriyor ve kullanıcıya kupon kaybolmuş/oluşmamış gibi
        // görünüyordu. Yeni üretim yine yapılmaz; sadece güvenli görünüm korunur.
        const preservedCouponHtml=String(target.innerHTML||'');
        const hasRestoredCouponCards=/(?:couponTripleWrap|couponCard-main|couponCard-normal|couponCard-surprise|couponCard-alt)/.test(preservedCouponHtml);
        if(hasRestoredCouponCards){
          target.innerHTML='<div class="card" style="border-left:5px solid #d97706;"><b>ℹ️ Seçili gün/bülten yok.</b> Yeni kupon hesaplanmadı; ekrandaki kayıtlı yarış-öncesi kupon korunuyor. Yeni üretim için önce Gün / Bülten Seç listesinden veya dosya aktarımından geçerli 6 ayak aç.</div>'+preservedCouponHtml;
          return {ok:false,rendered:true,restored:true,reason:'race_data_missing_snapshot_preserved'};
        }
        target.innerHTML = '<div class="card" style="border-left:5px solid #dc2626;">Önce bir tahmin dosyası yükle.</div>';
        return {ok:false,rendered:false,reason:'race_data_missing'};
      }
      const oldProgress=$('#tkpCouponBuildProgress');if(oldProgress)oldProgress.remove();
      const progress=document.createElement('div');progress.id='tkpCouponBuildProgress';progress.className='card';
      progressText=document.createElement('span');progress.appendChild(progressText);
      cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.textContent='İptal';cancelButton.style.marginLeft='12px';
      cancelButton.onclick=()=>{buildCancelled=true;if(typeof tkpCancelCouponBuild==='function')tkpCancelCouponBuild();buildPhase='İptal ediliyor';showProgress();cancelButton.disabled=true;};
      progress.appendChild(cancelButton);target.insertAdjacentElement('beforebegin',progress);showProgress();
      progressTimer=setInterval(showProgress,200);
      // Paint progress before any snapshot lookup or computation.
      await new Promise(resolve=>setTimeout(resolve,0));
      if(buildCancelled){const error=new Error('Kupon oluşturma iptal edildi.');error.code='TKP_COUPON_CANCELLED';throw error;}
      if(lastRaceResults!==sourceRows)throw new Error('Seçili yarış değişti; eski kupon hesabı uygulanmadı.');
      if(typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked(lastRaceResults)){
        const replayPayload=globalThis.__lastPredictionPayload;
        const currentReplay=replayPayload?.source==='current_algorithm_replay'&&sourceRows.every(x=>String(x.r?.file_id)===String(replayPayload.file?.id));
        // R16.48: Kupon bir kez oluşturulduktan sonra kullanıcı istediği zaman ÜÇ
        // kuponun da TAM 6 ayağını görebilir. Yarış başladı/bitti diye kartlar kırpılmaz.
        // Öncelik gerçek yarış-öncesi snapshotındadır; bu kayıt salt-okunur açılır.
        const snapshot=!currentReplay&&typeof tkpRestoreLatestPreRaceCouponSnapshot==='function'?tkpRestoreLatestPreRaceCouponSnapshot(lastRaceResults):null;
        if(snapshot){
          const verifiedAutomatic=typeof tkpBacktestEligibleSnapshotSource==='function'
            && tkpBacktestEligibleSnapshotSource(snapshot?.source)
            && Number(snapshot?.manual_adjustment)!==1;
          target.innerHTML='<div class="budgetCouponTriple" id="couponTripleWrap"><div id="couponCard-main"></div><div id="couponCard-surprise"></div><div id="couponCard-alt"></div></div>';
          renderCouponCard('main');renderCouponCard('surprise');renderCouponCard('alt');
          return {ok:true,rendered:true,restored:true,fullCouponView:true,snapshotQueued:false,snapshotPersistence:Promise.resolve(true)};
        }
        // Eski bir toplantıda snapshot yoksa ekrandaki mevcut üçlü set korunur. O da
        // yoksa yalnız görüntüleme amacıyla tam 6 ayak hesaplanır; sonuç/öğrenme kaydı
        // yazılmaz ve geçmişe yarış-öncesi snapshotmış gibi sokulmaz.
        const hasCurrent=!currentReplay&&['main','alt','surprise'].some(k=>activeCoupons?.[k]&&!activeCoupons[k].error&&Array.isArray(activeCoupons[k].legs)&&activeCoupons[k].legs.length);
        if(!hasCurrent){
          const normalBudget=typeof tkpCouponBudgetFor==='function'?tkpCouponBudgetFor(Number($('#normalCouponBudget')?.value)||1000,'main'):1000;
          const surpriseBudget=typeof tkpCouponBudgetFor==='function'?tkpCouponBudgetFor(Number($('#surpriseCouponBudget')?.value)||1000,'surprise'):1000;
          const viewSet=typeof tkpBuildCouponSetAdaptiveCriticalAsync==='function'
            ?await tkpBuildCouponSetAdaptiveCriticalAsync(sourceRows,{main:normalBudget,main2:normalBudget,alt:0,surprise:surpriseBudget,normalMode:'standard'},buildOptions)
            :(typeof tkpBuildCouponSetAdaptive==='function'?tkpBuildCouponSetAdaptive(lastRaceResults,{main:normalBudget,main2:normalBudget,alt:0,surprise:surpriseBudget,normalMode:'standard'}):null);
          if(!viewSet){target.innerHTML='<div class="card" style="border-left:5px solid #dc2626;">Kayıtlı üç kupon bulunamadı ve görüntüleme seti hazırlanamadı.</div>';return {ok:false,rendered:false,reason:'locked_view_build_failed'};}
          if(lastRaceResults!==sourceRows)throw new Error('Seçili yarış değişti; eski kupon hesabı uygulanmadı.');
          activeCoupons.main=viewSet.main;activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};activeCoupons.alt=viewSet.alt;activeCoupons.surprise=viewSet.surprise;
          for(const key of ['main','alt','surprise']){const c=activeCoupons[key];if(c&&!c.error){c.readOnlySnapshot=true;c.snapshotSource=currentReplay?'CURRENT_ALGORITHM_REPLAY':'POST_START_DISPLAY_ONLY';c.adaptiveBudgetNote=(c.calculationLimited?c.adaptiveBudgetNote+' · ':'')+(currentReplay?'Güncel algoritma · geçmiş veride deneme; yarış öncesi tahmin değildir.':'👁️ Salt-okunur tam kupon görünümü · öğrenmeye/snapshot kaydına yazılmaz');}}
        }
        target.innerHTML='<div class="budgetCouponTriple" id="couponTripleWrap"><div id="couponCard-main"></div><div id="couponCard-surprise"></div><div id="couponCard-alt"></div></div>';
        renderCouponCard('main');renderCouponCard('surprise');renderCouponCard('alt');
        if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
        return {ok:true,rendered:true,fullCouponView:true,snapshotQueued:false,snapshotPersistence:Promise.resolve(true)};
      }
      const normalInput = $('#normalCouponBudget');
      const surpriseInput = $('#surpriseCouponBudget');
      const normalBudget = typeof tkpCouponBudgetFor==='function' ? tkpCouponBudgetFor(parseFloat(String(normalInput?.value||700).replace(',','.')),'main') : Math.min(1400,Math.max(700,parseFloat(String(normalInput?.value||700).replace(',','.'))||1200));
      const surpriseBudget = typeof tkpCouponBudgetFor==='function' ? tkpCouponBudgetFor(parseFloat(String(surpriseInput?.value||800).replace(',','.')),'surprise') : Math.min(1400,Math.max(700,parseFloat(String(surpriseInput?.value||800).replace(',','.'))||1200));
      if(normalInput) normalInput.value=String(normalBudget);
      if(surpriseInput) surpriseInput.value=String(surpriseBudget);
      const requestedBudgets={main:normalBudget,main2:normalBudget,alt:0,surprise:surpriseBudget,normalMode:'standard'};
      const restoredSnapshot=typeof tkpRestoreCurrentCouponSnapshotIfFresh==='function'
        ?tkpRestoreCurrentCouponSnapshotIfFresh(lastRaceResults,requestedBudgets)
        :null;
      let snapshotQueued=false;
      let snapshotPersistence=Promise.resolve(true);
      if(!restoredSnapshot){
        target.innerHTML = '<div class="card" style="border-left:5px solid #2563eb;">Kuponlar hızlı şekilde hazırlanıyor…</div>';
        // Kritik yol yalnız hızlı/senkron kurucuyu kullanır. Soğuk 509 arşiv
        // özetleri Normal/Sürpriz/Uzman ekranını bekletmez; rafine model aşağıda
        // tekil arka plan görevine bırakılır.
        const quickStarted=typeof tkpNow==='function'?tkpNow():(typeof performance!=='undefined'&&performance.now?performance.now():Date.now());
        const fastSet=typeof tkpBuildCouponSetAdaptiveCriticalAsync==='function'
          ? await tkpBuildCouponSetAdaptiveCriticalAsync(sourceRows,requestedBudgets,buildOptions)
          : (typeof tkpBuildCouponSetAdaptive==='function'
            ? tkpBuildCouponSetAdaptive(lastRaceResults,requestedBudgets)
            : (typeof buildCouponSetFast==='function'?buildCouponSetFast(lastRaceResults,requestedBudgets):null));
        const quickEnded=typeof tkpNow==='function'?tkpNow():(typeof performance!=='undefined'&&performance.now?performance.now():Date.now());
        const quickMs=Math.round(Math.max(0,quickEnded-quickStarted)*10)/10;
        globalThis.__tkpLastCouponQuickPath={durationMs:quickMs,under40s:quickMs<=40000,at:new Date().toISOString()};
        try{if(typeof tkpRecordAction==='function')tkpRecordAction('Tahmin → üç kupon hızlı kurulum',quickStarted,quickMs>40000?new Error('Hızlı kupon kurulum bütçesi aşıldı'):null,{budgetMs:40000});}catch(_e){}
        if(!fastSet)throw new Error('Hızlı kupon kurucusu bulunamadı.');
        if(lastRaceResults!==sourceRows)throw new Error('Seçili yarış değişti; eski kupon hesabı uygulanmadı.');
        buildPhase='Kuponlar ekrana yazılıyor';showProgress();
        if(cancelButton)cancelButton.disabled=true;
        if(lastRaceResults!==sourceRows)throw new Error('Seçili yarış değişti; eski kupon hesabı uygulanmadı.');
        activeCoupons.main=fastSet.main;
        activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};
        activeCoupons.alt=fastSet.alt; // V55.2 gerçek Sürpriz Altılı
        activeCoupons.surprise=fastSet.surprise;
        if(typeof refreshRecommendedHorsePanelsFromCoupon==='function') refreshRecommendedHorsePanelsFromCoupon();
        // Snapshot geri yükleme kullanıcının girdiği tavanla eşleşir; motorun
        // efektif hedefi snapshot fonksiyonunda ayrı bilgi alanına yazılır.
        const saved=saveAutomaticCouponSnapshot(lastRaceResults, activeCoupons, requestedBudgets, 'SISTEM_GUNCEL_VERI');
        snapshotQueued=Boolean(saved);
        try{if(typeof tkpCouponSnapshotPersistencePromise==='function')snapshotPersistence=tkpCouponSnapshotPersistencePromise();}catch(_e){}
        // İlk otomatik üretimde ikinci SON_KUPON kaydını yazmak kuyruk ve WAL
        // işini ikiye katlıyordu. Manuel düzenleme/A4 paylaşımı kendi anında son
        // kupon snapshotını zaten alır.
        const refineRows=lastRaceResults;
        const refineKey=typeof tkpLiveCouponCacheKey==='function'
          ?tkpLiveCouponCacheKey(refineRows,{main:normalBudget,surprise:surpriseBudget,normalMode:'standard'})
          :String(refineRows.length)+'|'+normalBudget+'|'+surpriseBudget;
        const refineGeneration=(Number(globalThis.__tkpCouponRefinementGeneration)||0)+1;
        globalThis.__tkpCouponRefinementGeneration=refineGeneration;
        const refine=async()=>{
          if(typeof tkpBuildCouponSetAdaptiveAsync!=='function')return;
          if(Number(globalThis.__tkpCouponRefinementGeneration)!==refineGeneration)return;
          if(globalThis.__tkpCouponAdaptiveRefineInProgress)return;
          globalThis.__tkpCouponAdaptiveRefineInProgress=true;
          try{
            const refined=await tkpBuildCouponSetAdaptiveAsync(refineRows,requestedBudgets);
            const currentKey=typeof tkpLiveCouponCacheKey==='function'
              ?tkpLiveCouponCacheKey(lastRaceResults,{main:normalBudget,surprise:surpriseBudget,normalMode:'standard'})
              :String(lastRaceResults?.length||0)+'|'+normalBudget+'|'+surpriseBudget;
            if(Number(globalThis.__tkpCouponRefinementGeneration)!==refineGeneration||lastRaceResults!==refineRows||currentKey!==refineKey)return;
            activeCoupons.main=refined.main;activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};activeCoupons.alt=refined.alt;activeCoupons.surprise=refined.surprise;
            if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
            saveAutomaticCouponSnapshot(refineRows,activeCoupons,requestedBudgets,'SISTEM_GUNCEL_VERI_RAFINE');
            if($('#couponCard-main')&&$('#couponCard-surprise')&&$('#couponCard-alt')){renderCouponCard('main');renderCouponCard('alt');renderCouponCard('surprise');}
            globalThis.__tkpLastCouponRefine={ok:true,at:new Date().toISOString()};
          }catch(error){globalThis.__tkpLastCouponRefine={ok:false,error:error?.message||String(error),at:new Date().toISOString()};console.warn('Arka plan kupon rafinasyonu:',error);}
          finally{globalThis.__tkpCouponAdaptiveRefineInProgress=false;}
        };
        // R16.3: Kullanıcı kuponu gördükten 450 ms sonra 509 arşivlik rafinasyon
        // başlatmak Win8.1/Opera'da tekrar donma yaratıyordu. R16 hızlı yol zaten
        // canlı meta sıralama + Selective TEK kullanır; otomatik ikinci tam hesap kapalı.
        globalThis.__tkpCouponAdaptiveRefineDeferred={disabled:true,reason:'manual_critical_path_freeze_fix',at:new Date().toISOString()};
      }else if(typeof refreshRecommendedHorsePanelsFromCoupon==='function'){
        refreshRecommendedHorsePanelsFromCoupon();
      }
      target.innerHTML = `${restoredSnapshot?'<div class="card" style="border-left:5px solid #16a34a;"><b>✅ Veri ve bütçe değişmedi.</b> Kayıtlı üç kupon ve çalışma portföyü açıldı; yeniden hesaplama yapılmadı.</div>':''}<div id="tkpOpportunityRouterHost"></div>`
        + `<div style="margin:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center;"><button id="shareCouponShot" class="primary" type="button">3 Kuponu X'te Paylaş</button><span style="font-size:12px;color:#64748b">Normal + Uzman/Kulis + Sürpriz son kupon snapshotı ile paylaşılır. Görsel manuel eklenir.</span></div>`
        + `<div class="budgetCouponTriple" id="couponTripleWrap"><div id="couponCard-normal"></div><div id="couponCard-surprise"></div><div id="couponCard-alt"></div></div>`
        + `<div id="tkpMultiGanyanHost"></div>`;
      const normalKey='main';
      const normalHost=$('#couponCard-normal');
      if(normalHost){normalHost.id='couponCard-'+normalKey;renderCouponCard(normalKey);}
      renderCouponCard('alt');
      renderCouponCard('surprise');
      if(typeof tkpRefreshOpportunityPanels==='function')tkpRefreshOpportunityPanels();
      tkpScheduleCouponExtras(target,lastRaceResults);
      const cardsRendered=Boolean($('#couponCard-main')&&$('#couponCard-surprise')&&$('#couponCard-alt'));
      // V1.1.135: X otomatik/API paylaşımı bilinçli olarak devre dışı.
      // Güvenilir akış: PNG'yi yerel olarak kaydet + X compose ekranını aç.
      const shotBtn = $('#shareCouponShot');
      if (shotBtn){
        shotBtn.onclick = async () => {
          const oldLabel = shotBtn.textContent;
          // V1.1.135: X penceresini kullanıcı tıklamasının SENKRON çağrı zincirinde aç.
          // PNG hazırlama async olduğu için window.open() await sonrasına kalırsa Chrome popup olarak engelleyebilir.
          let xShareWindow=null;
          try {
            xShareWindow=window.open('about:blank','_blank');
            if(xShareWindow){
              try{
                xShareWindow.document.title='TKP · X paylaşımı hazırlanıyor';
                xShareWindow.document.body.innerHTML='<div style=\"font-family:Arial,sans-serif;padding:24px;color:#17365d\"><b>TKP kupon paylaşımı hazırlanıyor…</b><div style=\"margin-top:8px;color:#64748b;font-size:13px\">PNG hazırlanırken X gönderi ekranı açılacak.</div></div>';
              }catch(_e){}
            }
          }catch(_e){}
          shotBtn.textContent = '⏳ 3 kupon X paylaşımı hazırlanıyor…';
          shotBtn.disabled = true;
          let shareRoot=null;
          try {
            // Paylaşım anı = son kupon hali. BH/manuel eklemeler dahil snapshot önce güncellenir.
            if(typeof tkpPersistFinalCouponSnapshot==='function')tkpPersistFinalCouponSnapshot();
            const ctx=typeof couponSnapshotContext==='function'?couponSnapshotContext(lastRaceResults,'SON_KUPON'):{date:'',hippodrome:'',altiliNo:1};
            const date=String(ctx.date||new Date().toISOString().slice(0,10));
            const hip=String(ctx.hippodrome||'YARIŞ').trim();
            const alt=Math.max(1,Number(ctx.altiliNo)||1);
            const displayDate=date.split('-').reverse().join('.');
            const shareTitle=`TKP Altılı Ganyan Tahmini · ${displayDate} ${hip} ${alt}. Altılı`;
            const safeName=`TKP_Altili_Ganyan_Tahmini_${date}_${hip}_${alt}_Altili`.replace(/[^0-9A-Za-zÇĞİÖŞÜçğıöşü_-]+/g,'_');
            const card=(coupon,title)=>{
              if(!coupon||coupon.error)return `<div class="tkpShareCoupon"><h3>${esc(title)}</h3><div>${esc(coupon?.error||'Kupon yok')}</div></div>`;
              const rows=(coupon.legs||[]).slice().sort((a,b)=>Number(a.r?.leg)-Number(b.r?.leg)).map(l=>{
                const picks=(l.picks||[]).map(h=>String(h.horse_no??'').trim()).filter(Boolean);
                const tek=picks.length===1?`<span class="tkpShareTek">TEK ${esc(picks[0])}</span>`:'';
                return `<tr><td>${esc(l.r?.leg)}. AYAK</td><td><b>${picks.map(esc).join(' - ')||'-'}</b>${tek}</td></tr>`;
              }).join('');
              return `<div class="tkpShareCoupon"><h3>${esc(title)}</h3><table><tbody>${rows}</tbody></table><div class="tkpShareCost">Maliyet: ${fmt2(Number(coupon.cost)||0)} TL</div></div>`;
            };
            const shareBhRows=(lastRaceResults||[]).map(x=>{
              const r=x?.r||x; if(!r)return '';
              let candidates=[];
              try{
                const key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(r):'';
                const log=Array.isArray(db?.bomb_hunter_shadow_log)?db.bomb_hunter_shadow_log:[];
                const frozen=key?log.find(z=>z?.race_key===key):null;
                if(frozen?.candidates?.length)candidates=frozen.candidates.slice();
                else if(!(typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(r.horses||[])) && typeof tkpBombHunterCandidates==='function'){
                  candidates=tkpBombHunterCandidates(r).map((z,i)=>({rank:i+1,horse_no:String(z.h?.horse_no||''),horse_name:z.h?.horse_name||'',score:Number(z.score)||0}));
                }
              }catch(_e){}
              if(!candidates.length)return '';
              const rows=candidates.map(c=>`<span class="tkpShareBhChip"><span class="tkpShareBhNo">${esc(c.horse_no)}</span><b class="tkpShareBhName">${esc(c.horse_name||'')}</b><em>BH ${fmt2((Number(c.score)||0)*100)}</em></span>`).join('');
              return `<div class="tkpShareBhLeg"><strong>${esc(r.leg)}. AYAK</strong><div class="tkpShareBhRows">${rows}</div></div>`;
            }).filter(Boolean).join('');
            const shareBh=shareBhRows?`<div class="tkpShareBh"><div class="tkpShareBhTitle">Bomba Avcısı</div><div class="tkpShareBhGrid">${shareBhRows}</div></div>`:'';
            shareRoot=document.createElement('div');
            shareRoot.className='tkpShareA4CouponShot';
            shareRoot.style.cssText='position:fixed;left:-20000px;top:0;width:800px;background:#fff;color:#111827;padding:16px;font-family:Arial,Helvetica,sans-serif;z-index:-1;box-sizing:border-box';
            shareRoot.innerHTML=`<div style="border-bottom:2px solid #17365d;padding-bottom:9px;margin-bottom:11px;display:flex;justify-content:space-between;align-items:end;gap:12px"><div><div style="font-size:21px;font-weight:900;color:#17365d">TKP Altılı Ganyan Tahmini</div><div style="font-size:13px;font-weight:800;margin-top:2px">${esc(displayDate)} · ${esc(hip)} · ${alt}. Altılı</div></div><div style="font-size:9.5px;color:#64748b">Son kupon snapshotı</div></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px">${card(activeCoupons.main,'Normal Kupon')}${card(activeCoupons.surprise,'Uzman + Kulis')}${card(activeCoupons.alt,'Sürpriz Kupon')}</div>${shareBh}<div style="margin-top:6px;font-size:9px;color:#64748b">Bomba Avcısı ve manuel düzenlemeler dahil paylaşım anındaki son kupon halidir.</div>`;
            const style=document.createElement('style');
            style.textContent='.tkpShareA4CouponShot .tkpShareCoupon{border:1.5px solid #b8c5d6;border-left:4px solid #17365d;border-radius:8px;padding:7px;min-width:0}.tkpShareA4CouponShot h3{margin:0 0 6px;color:#17365d;font-size:13.5px}.tkpShareA4CouponShot table{width:100%;border-collapse:collapse;table-layout:fixed}.tkpShareA4CouponShot td{border-top:1px solid #e5e7eb;padding:4px 3px;font-size:10.5px;line-height:1.18;vertical-align:middle}.tkpShareA4CouponShot td:first-child{width:56px;font-weight:800}.tkpShareA4CouponShot .tkpShareCost{margin-top:6px;font-weight:900;font-size:10.5px}.tkpShareA4CouponShot .tkpShareTek{display:inline-block;margin-left:5px;padding:1px 4px;border-radius:999px;background:#dcfce7;border:1px solid #86efac;color:#166534;font-size:8px;font-weight:900;white-space:nowrap;vertical-align:1px}.tkpShareBh{margin-top:5px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px;padding:4px 5px}.tkpShareBhTitle{font-size:8.4px;font-weight:900;color:#92400e;margin-bottom:3px}.tkpShareBhGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px 5px}.tkpShareBhLeg{min-width:0;border:1px solid #f3d58a;background:#fffdf7;border-radius:4px;padding:3px 4px}.tkpShareBhLeg>strong{display:block;font-size:6.8px;color:#475569;white-space:nowrap;margin-bottom:2px}.tkpShareBhRows{display:flex;flex-wrap:wrap;align-items:center;gap:2px 3px}.tkpShareBhChip{display:inline-flex;align-items:center;gap:3px;min-width:0;max-width:100%;padding:1.5px 3px;border:1px solid #f5dfab;background:#fff;border-radius:999px;line-height:1;white-space:nowrap}.tkpShareBhNo{font-size:6.6px;font-weight:900;text-align:center;color:#17365d}.tkpShareBhName{display:inline-block;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:6.5px;text-align:left}.tkpShareBhChip em{font-style:normal;font-size:6.2px;font-weight:900;color:#92400e;text-align:right;white-space:nowrap}';
            shareRoot.appendChild(style);
            document.body.appendChild(shareRoot);
            const capture=await tkpEnsureHtml2Canvas();
            const canvas=await capture(shareRoot,{backgroundColor:'#ffffff',scale:1.35,useCORS:true,logging:false,width:800,windowWidth:840});
            const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            if(!blob)throw new Error('Görüntü oluşturulamadı.');
            const file=new File([blob],safeName+'.png',{type:'image/png'});
            // Kullanıcı kuralı: paylaş düğmesi HER ZAMAN aynı anda PNG'yi bilgisayara kaydeder.
            const downloadUrl=URL.createObjectURL(blob);
            const a=document.createElement('a');a.href=downloadUrl;a.download=file.name;document.body.appendChild(a);a.click();a.remove();
            setTimeout(()=>URL.revokeObjectURL(downloadUrl),5000);
            // V1.1.135: otomatik API / collector medya yükleme yok.
            // Tarayıcı güvenlik modeli yerel dosyayı X'e güvenilir biçimde otomatik ekleyemez.
            // PNG zaten bilgisayara kaydedildi; yalnız X compose metinle açılır.
            const xUrl='https://x.com/intent/post?text='+encodeURIComponent(shareTitle);
            if(xShareWindow && !xShareWindow.closed){
              try{xShareWindow.location.replace(xUrl);}catch(_e){xShareWindow.location.href=xUrl;}
            }else{
              // Popup engellendiyse kullanıcıya sessizce hiçbir şey olmamış gibi davranma.
              // Aynı tıklamada açılamadıysa açık ve görünür geri bildirim ver.
              const retry=window.open(xUrl,'_blank','noopener');
              if(!retry)alert('X penceresi tarayıcı tarafından engellendi. Bu site için açılır pencerelere izin verip tekrar deneyin. PNG bilgisayarınıza kaydedildi.');
            }
          } catch(e){
            try{if(xShareWindow && !xShareWindow.closed)xShareWindow.close();}catch(_e){}
            if(e?.name!=='AbortError'){console.error('Kupon paylaşım görseli hatası:',e);alert('Görüntü oluşturulurken bir hata oluştu: '+(e?.message||e));}
          } finally {
            try{shareRoot?.remove();}catch(_e){}
            shotBtn.textContent = oldLabel;
            shotBtn.disabled = false;
          }
        };
      }
      // Otomatik üretim ekranı kupon alanına kaydırmaz: İlk Bakış ve ayak sekmeleri
      // görünür kalır. Kullanıcı düğmesinde eski, açık davranış korunur.
      if(options?.auto!==true)target.scrollIntoView({behavior:'smooth', block:'start'});
      return {ok:true,rendered:cardsRendered,restored:Boolean(restoredSnapshot),snapshotQueued,snapshotPersistence};
    } catch (err) {
      buildFailed=true;buildPhase=err?.code==='TKP_COUPON_CANCELLED'?'İptal edildi':err?.code==='TKP_COUPON_TIMEOUT'?'Süre aşıldı · '+String(globalThis.__tkpLastCouponRun?.stage||buildPhase):'Tamamlanamadı';
      if(target)target.innerHTML = `<div class="card" style="border-left:5px solid #dc2626;"><b>Kupon oluşturulamadı:</b> ${esc(err?.message || String(err))}</div>`;
      console.error('Kupon oluşturma hatası:', err);
      return {ok:false,rendered:false,error:err?.message||String(err)};
    } finally {
      clearInterval(progressTimer);if(cancelButton)cancelButton.remove();
      if(!buildFailed)buildPhase=globalThis.__tkpLastCouponRun?.status==='bounded_plan'?'Süre korumalı plan hazır':'Tamamlandı';showProgress();
      globalThis.__tkpCouponBuildInProgress=false;
    }
    };
    const promise=task();
    globalThis.__tkpCouponBuildPromise=promise;
    Promise.resolve(promise).finally(()=>{
      if(globalThis.__tkpCouponBuildPromise===promise)globalThis.__tkpCouponBuildPromise=null;
    });
    return promise;
  };
  // Veri toplayıcı ilk tahmin boyamasını tamamladıktan sonra tam üçlü kupon
  // görünümünü aynı renderer ile arka planda açabilsin. Bu global yalnızca
  // mevcut oturumdaki renderer'a ince bir köprü verir; kullanıcı düğmesi de
  // aynı fonksiyonu kullanmaya devam eder.
  if (typeof globalThis !== 'undefined') globalThis.tkpRunBudgetCouponBuild = runBudgetCouponBuild;
  if (buildBudgetCouponBtn) {
    buildBudgetCouponBtn.addEventListener('click', () => {
      const task = async () => {
        if (typeof tkpYield === 'function') await tkpYield();
        await runBudgetCouponBuild();
      };
      if (typeof tkpRunButtonTask === 'function') {
        tkpRunButtonTask(buildBudgetCouponBtn, 'calculating', task, {
          silent: true,
          errorDetail: 'Kupon oluşturulamadı',
          actionName: 'Tahmin → üç kupon oluştur',
          actionBudgetMs: 30000,
          safetyTimeoutMs: 30000
        });
      } else {
        task().catch(error => console.error('Kupon oluşturma hatası:', error));
      }
    });
  }

  const runR16PreviewBtn = $('#runR16Preview');
  if(runR16PreviewBtn){
    runR16PreviewBtn.addEventListener('click',()=>{
      const task=async()=>{
        runR16PreviewBtn.disabled=true;runR16PreviewBtn.textContent='HESAPLANIYOR…';
        try{if(typeof tkpYield==='function')await tkpYield();if(typeof tkpR16RenderPreview==='function')tkpR16RenderPreview();}
        finally{runR16PreviewBtn.disabled=false;runR16PreviewBtn.textContent='🎯 R16 Önizleme Hesapla';}
      };
      if(typeof tkpRunButtonTask==='function')tkpRunButtonTask(runR16PreviewBtn,'testing',task,{silent:true,actionName:'R16 model önizleme',actionBudgetMs:5000,safetyTimeoutMs:5000});
      else task().catch(error=>console.error('R16 önizleme:',error));
    });
  }

  const runCouponBacktestBtn = $('#runCouponBacktest');
  if (runCouponBacktestBtn) {
    runCouponBacktestBtn.addEventListener('click', () => {
      const out = $('#couponBacktestResult');
      const normalBudget = typeof tkpCouponBudgetFor==='function' ? tkpCouponBudgetFor(parseFloat(String($('#normalCouponBudget')?.value||700).replace(',','.')),'main') : Math.min(1400,Math.max(700,parseFloat(String($('#normalCouponBudget')?.value||700).replace(',','.'))||1200));
      const surpriseBudget = typeof tkpCouponBudgetFor==='function' ? tkpCouponBudgetFor(parseFloat(String($('#surpriseCouponBudget')?.value||800).replace(',','.')),'surprise') : Math.min(1400,Math.max(700,parseFloat(String($('#surpriseCouponBudget')?.value||800).replace(',','.'))||1200));
      const limit = Math.max(1, Math.min(509, Number($('#couponBacktestLimit')?.value) || 509));
      const budgets = {main: normalBudget, main2: normalBudget, alt: 0, surprise: surpriseBudget,normalMode:'standard'};

      const task = async () => {
        _tkpBacktestManualRunActive=true;
        try{
          const before=tkpBacktestSnapshotStatus();
          if (out) {
            const coverageNote=before.historicMissing
              ? ` · ${before.historicMissing} eski Altılıda kupon snapshotı yok; mevcut doğrulanmış frozen veri kullanılır.`
              : '';
            tkpShowPanelPending(out, `Son ${limit} yarış toplantısı mevcut doğrulanmış veriden test ediliyor…${coverageNote}`, 'backtest');
            out.dataset.ready = '1';
          }
          // R16.3 FREEZE FIX: Back Test sadece mevcut doğrulanmış veriyi raporlar.
          // Snapshot üretimi Back Test kritik yolunda çalıştırılmaz; tarihsel rebuild burada ASLA başlatılmaz.
          if (typeof tkpYield === 'function') await tkpYield();
          const resultHtml = typeof tkpGetBacktestHTMLAsync === 'function'
            ? await tkpGetBacktestHTMLAsync(budgets, limit)
            : couponArchiveBacktestHTML(budgets, limit);
          if (out) out.innerHTML = resultHtml;
          if(typeof tkpRefreshOpportunityPanels==='function')tkpRefreshOpportunityPanels();
        }finally{_tkpBacktestManualRunActive=false;}
      };

      const onError = error => {
        if (out) {
          tkpShowPanelError(out, `Geri test çalıştırılamadı: ${error?.message || String(error)}`, 'backtest');
        }
        console.error('Kupon geri test hatası:', error);
      };

      if (typeof tkpRunButtonTask === 'function') {
        tkpRunButtonTask(runCouponBacktestBtn, 'testing', async () => {
          try {
            await task();
          } catch (error) {
            onError(error);
            throw error;
          }
        }, {silent: true, errorDetail: 'Test başarısız', timeoutDetail:'Test arka planda sürüyor', actionName:'Back Test → geçerli kuponlar', actionBudgetMs:30000, safetyTimeoutMs:30000});
      } else {
        const originalLabel = runCouponBacktestBtn.textContent;
        runCouponBacktestBtn.disabled = true;
        runCouponBacktestBtn.textContent = 'TEST EDİLİYOR…';
        task().catch(onError).finally(() => {
          runCouponBacktestBtn.disabled = false;
          runCouponBacktestBtn.textContent = originalLabel;
        });
      }
    });
  }

  async function tkpRecalculateBestRulesNow(button, source='manual') {
    const btn = button || document.getElementById('recalcRules') || document.getElementById('recalcRulesBackup');
    const run = async () => {
      if (btn) { btn.dataset.operationState='calculating'; btn.disabled=true; btn.textContent='⏳ En İyiler hesaplanıyor…'; }
      try {
        setCurrentRules(await buildRulesAsync());
        setRulesDirty(false);
        renderRules();
        try { renderAdvice(); } catch(_e){}
        await saveDB(false);
        try { localStorage.removeItem('tkpAutoRecalcRulesAfterRestore'); } catch(_e){}
        if (btn) { btn.dataset.operationState='done'; btn.textContent='✅ En İyiler güncel'; }
        return true;
      } catch (error) {
        if (btn) { btn.dataset.operationState='error'; btn.textContent='❌ Hesaplanamadı'; }
        console.error('En İyiler yeniden hesaplama hatası ('+source+'):', error);
        throw error;
      } finally {
        if (btn) setTimeout(()=>{ btn.disabled=false; btn.dataset.operationState=''; btn.textContent=(btn.id==='recalcRulesBackup'?'🏆 En İyileri Yeniden Hesapla':'Kuralları yeniden hesapla'); },2200);
      }
    };
    return run();
  }
  window.tkpRecalculateBestRulesNow=tkpRecalculateBestRulesNow;

  $('#refreshAdvice').onclick = () => {
    const btn = $('#refreshAdvice');
    const task = async () => {
      if (typeof tkpYield === 'function') await tkpYield();
      renderAdvice();
    };
    if (typeof tkpRunButtonTask === 'function') {
      tkpRunButtonTask(btn, 'working', task, {silent: true});
    } else {
      task().catch(error => console.error('Öneri yenileme hatası:', error));
    }
  };

  $('#recalcRules').onclick = () => {
    tkpRecalculateBestRulesNow($('#recalcRules'),'rules-pane').catch(()=>{});
  };
  if ($('#recalcRulesBackup')) $('#recalcRulesBackup').onclick = () => {
    tkpRecalculateBestRulesNow($('#recalcRulesBackup'),'backup-pane').catch(()=>{});
  };

  // KÖK FIX (hız): Arama kutusu her tuş vuruşunda tam veri taraması yapan
  // renderData()'yı doğrudan tetikliyordu; hızlı yazan kullanıcıda arayüz
  // "geç cevap veriyor" hissi yaratıyordu. Girdi artık kısa bir gecikmeyle
  // (debounce) tetiklenir; yazım biterken tek render çalışır, arama sonucu/
  // davranışı değişmez.
  (function(){
    const input = $('#searchData');
    if(!input) return;
    let debounceHandle=null;
    input.oninput = () => {
      if(debounceHandle) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(renderData, 160);
    };
  })();
  $('#exportCSV').onclick = () => {
    const btn=$('#exportCSV');
    const task=()=>downloadMasterCsv();
    if(typeof tkpRunButtonTask==='function')return tkpRunButtonTask(btn,'working',task,{actionName:'Master CSV dışa aktar',actionBudgetMs:15000,safetyTimeoutMs:15000,timeoutDetail:'CSV arka planda hazırlanıyor',errorDetail:'CSV oluşturulamadı'});
    return task();
  };
  if ($('#downloadLearningMatrix')) $('#downloadLearningMatrix').onclick = downloadLearningMatrixCsv;

  if ($('#betCity')) $('#betCity').onchange = () => {
    const wrap = $('#betTrackOtherWrap');
    if (wrap) wrap.style.display = $('#betCity').value==='__OTHER__' ? '' : 'none';
    if ($('#betCity').value==='__OTHER__' && $('#betTrackOther')) $('#betTrackOther').focus();
  };

  $('#addBet').onclick = () => {
    let date = $('#betDate').value, cost = parseFloat(String($('#betCost').value).replace(',', '.')), payout = parseFloat(String($('#betPayout').value).replace(',', '.'))||0, note = $('#betNote').value;
    let couponType = $('#betType') ? $('#betType').value : 'other';
    let betCity = $('#betCity') ? $('#betCity').value : '';
    if (betCity==='__OTHER__') betCity = canonicalHippodrome($('#betTrackOther') ? $('#betTrackOther').value : '');
    else if (betCity) betCity = canonicalHippodrome(betCity);
    let betGameType = $('#betGameType') ? $('#betGameType').value : '';
    let betSession = $('#betSession') ? $('#betSession').value : '';
    if (!date || !Number.isFinite(cost) || cost<0){ $('#betMessage').textContent = 'Tarih ve sıfırdan küçük olmayan maliyet zorunlu.'; $('#betMessage').style.color = '#b91c1c'; return; }
    // Aylık 90.000 TL sert tavanı yalnız gerçek harcama kaydında uygulanır. Kuponu
    // ekranda üretmek veya geçmiş replay görmek harcama değildir; bu nedenle
    // kullanıcı ancak "Kaydı ekle" dediğinde, ilgili ayın gerçek kayıtlarıyla
    // birlikte atomik olarak kontrol edilir.
    const bankroll=typeof tkpCanRecordBankrollBet==='function'?tkpCanRecordBankrollBet(date,cost,db):null;
    if(bankroll && !bankroll.allowed){
      $('#betMessage').textContent = `Bu kayıtla ${bankroll.month} ayı ${fmt2(bankroll.monthlyHardLimitTL)} TL sert limitini aşar. Kalan: ${fmt2(bankroll.remaining)} TL.`;
      $('#betMessage').style.color = '#b91c1c';
      return;
    }
    db.bets = db.bets || [];
    db.bets.push({date, cost, payout, note, couponType, betCity, betGameType, betSession});
    db.changelog = db.changelog || [];
    db.changelog.push({ts:new Date().toISOString(), type:'PİST PERFORMANSI', message:(betCity||'Belirtilmemiş pist')+' için '+couponTypeLabel(couponType)+' / '+betGameTypeLabel(betGameType)+' gerçek sonucu analiz havuzuna eklendi: maliyet '+fmt2(cost)+' TL, ikramiye '+fmt2(payout)+' TL.'});
    $('#betMessage').textContent = 'Kayıt eklendi.'; $('#betMessage').style.color = '#15803d';
    $('#betDate').value = ''; $('#betCost').value = ''; $('#betPayout').value = ''; $('#betNote').value = ''; $('#betCity').value = ''; if ($('#betTrackOther')) $('#betTrackOther').value=''; if ($('#betTrackOtherWrap')) $('#betTrackOtherWrap').style.display='none'; $('#betGameType').value = ''; $('#betSession').value = '';
    renderProfit();
    saveDB();
  };
  $('#clearBets').onclick = () => { if (confirm('Tüm kupon kayıtlarını silmek istediğine emin misin?')){ db.bets = []; saveDB(); } };

  function tkpBackupCounts(x){
    const out={};
    for(const key of ['files','races','bets','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log']){
      const loaded=Array.isArray(x?.[key])?x[key].length:0;
      const cold=x?.__segmented_storage?.safeMode===true?Math.max(0,Number(x.__segmented_storage.collections?.[key]?.coldCount)||0):0;
      out[key]=loaded+cold;
    }
    return out;
  }
  function tkpPortableXSettings(){
    const read=id=>{try{return localStorage.getItem('tkp_'+id)||'';}catch{return ''}};
    const handles=String(read('tkpcXHandles')||'').split(/[,;\s]+/).map(x=>x.trim()).filter(Boolean);
    return {handles,source:read('tkpcXSource')||'both',mode:'shadow',race_time:read('tkpcXRaceTime')||''};
  }
  function tkpMergePortableXSettings(portable){
    const x=portable?.x||{}; const key='tkp_tkpcXHandles';
    try{
      const existing=String(localStorage.getItem(key)||'').split(/[,;\s]+/).map(z=>z.trim()).filter(Boolean);
      const incoming=Array.isArray(x.handles)?x.handles:[];const seen=new Set(),merged=[];
      for(const h of [...existing,...incoming]){const k=String(h).replace(/^@/,'').toLowerCase();if(!k||seen.has(k))continue;seen.add(k);merged.push(String(h).startsWith('@')?String(h):'@'+String(h));}
      if(merged.length)localStorage.setItem(key,merged.join(', '));
      if(x.source)localStorage.setItem('tkp_tkpcXSource',String(x.source));
      localStorage.setItem('tkp_tkpcXMode','shadow');
      if(x.race_time)localStorage.setItem('tkp_tkpcXRaceTime',String(x.race_time));
      return merged;
    }catch{return []}
  }
  async function tkpRestorePortableCredentials(portable){
    // Eski yedekte site parolası bulunsa bile yeni sürüm bunu içe almaz.
    return portable?.credentials?'\nEski site şifre kaydı güvenlik nedeniyle içe alınmadı; HTML Aç ile tarayıcı oturumu kullanılır.':'';
  }
  // 14. DÜZELTME — .tkbz hızlı hazırlama (eski .tkpbak içe aktarma uyumlu):
  // Büyük db (10-20+ MB) her yedek tıklamasında tekrar JSON.stringify edilmesin.
  // Cache saveDB çağrısının BAŞINDA geçersiz kılınır; dolayısıyla henüz IndexedDB
  // yazımı bitmeden değişmiş canlı verinin eski cache'den alınması mümkün değildir.
  let _tkpBackupDbJsonCache={epoch:0,text:'',signature:''};
  let _tkpBackupEpoch=1;
  const _tkpTransientBackupKeys=new Set(['__tkpLiveHorsesSrc','__tkpLiveHorsesCache','_accurateFieldAvgCache']);
  function tkpBackupJsonReplacer(key,value){return _tkpTransientBackupKeys.has(key)?undefined:value;}
  function tkpInvalidateBackupCache(){
    _tkpBackupEpoch++;_tkpBackupDbJsonCache={epoch:0,text:'',signature:''};
  }
  globalThis.tkpInvalidateBackupCache=tkpInvalidateBackupCache;
  function tkpBackupDbJson(){
    const signature=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${db?.files?.length||0}|${db?.races?.length||0}|${db?.prediction_log?.length||0}`;
    if(_tkpBackupDbJsonCache.epoch===_tkpBackupEpoch&&_tkpBackupDbJsonCache.signature===signature&&_tkpBackupDbJsonCache.text){
      return {text:_tkpBackupDbJsonCache.text,cacheHit:true,signature};
    }
    const epoch=_tkpBackupEpoch,text=JSON.stringify(db,tkpBackupJsonReplacer);
    if(epoch===_tkpBackupEpoch)_tkpBackupDbJsonCache={epoch,signature,text};
    return {text,cacheHit:false,signature};
  }
  // Standart .tkbz yedeği yalnız yarış verisi ve X takip ayarlarını taşır;
  // site kullanıcı adı/parolası hiçbir biçimde yedeğe yazılmaz.
  function tkpAssembleBackupText(meta,dbJson){
    const head=JSON.stringify(meta);return head.slice(0,-1)+',\"db\":'+dbJson+'}';
  }
  async function tkpCreateCompressedBackupText(){
    const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const dbPart=tkpBackupDbJson(); // ağ isteği sürerken CPU serileştirmesi yapılır
    const meta={tkp_backup_version:2,created_at:new Date().toISOString(),manifest:tkpBackupCounts(db),portable:{x:tkpPortableXSettings()}};
    const text=tkpAssembleBackupText(meta,dbPart.text);
    const ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    globalThis.__tkpLastBackupPrepareMetrics={cacheHit:dbPart.cacheHit,durationMs:Math.round((ended-started)*10)/10,jsonBytes:text.length};
    return text;
  }
  // Büyük DB'nin JSON.stringify fallback'i yalnız Worker bulunmayan eski tarayıcıda,
  // kullanıcı açıkça .tkbz yedeği istediğinde çalışır. Normal yol IndexedDB parçalarını
  // worker içinde stream ederek ana thread'i ve RAM'i gereksiz şişirmez.
  async function tkpGzipText(text){
    if(typeof CompressionStream!=='undefined'){
      const stream=new Blob([text],{type:'application/json'}).stream().pipeThrough(new CompressionStream('gzip'));
      return new Blob([await new Response(stream).arrayBuffer()],{type:'application/gzip'});
    }
    if(globalThis.pako&&typeof globalThis.pako.gzip==='function')return new Blob([globalThis.pako.gzip(text)],{type:'application/gzip'});
    throw new Error('Gzip sıkıştırma altyapısı kullanılamıyor');
  }
  async function tkpGunzipFile(file){
    const bytes=new Uint8Array(await file.arrayBuffer());
    const isGzip=bytes.length>=2&&bytes[0]===0x1f&&bytes[1]===0x8b;
    if(!isGzip){
      try{return new TextDecoder('utf-8').decode(bytes);}catch(_){return await new Response(bytes).text();}
    }
    if(typeof DecompressionStream!=='undefined'){
      try{return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}catch(_){ }
    }
    if(globalThis.pako&&typeof globalThis.pako.ungzip==='function')return globalThis.pako.ungzip(bytes,{to:'string'});
    throw new Error('Gzip geri yükleme altyapısı kullanılamıyor');
  }
  function tkpBackupFileStamp(now=new Date()){
    const pad=n=>String(n).padStart(2,'0');
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }
  async function tkpDownloadCompressedBackup(options={}){
    const btn=$('#downloadTKPBackup'),old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='⏳ Yedek hazırlanıyor…';}
    const directBtn=$('#downloadTKPBackupDirect');if(directBtn)directBtn.disabled=true;
    // İlk klasör seçimi kullanıcı tıklaması hâlâ aktifken yapılır. Uzun worker exportu
    // bittikten sonra showDirectoryPicker çağırmak bazı Chromium sürümlerinde user-gesture
    // süresini kaçırabiliyor.
    try{
      const backupDirHandle=options.downloadOnly===true?null:await prepareRememberedBackupDir();
      // V1.1.282: yedek düğmesi, RAM'deki son değişikliklerin de atomik manifestte
      // bulunmasını garanti eder. Worker yalnız doğrulanmış aktif manifestten okur.
      if(typeof saveDB==='function'){if(btn)btn.textContent='⏳ Son değişiklikler kaydediliyor…';await saveDB(false,true);}
      const expectedBackupCounts=tkpBackupCounts(db);
      let blob;
      if(typeof Worker!=='undefined'){
        const result=await new Promise((resolve,reject)=>{
          const worker=new Worker('tkp-backup-import-worker.js?v='+encodeURIComponent(TKP_RUNTIME_VERSION));
          const finish=(error,value)=>{worker.terminate();error?reject(error):resolve(value);};
          worker.onerror=event=>finish(new Error(event?.message||'TKP yedek worker hatası.'));
          worker.onmessage=event=>{
            const message=event.data||{};
            if(message.type==='export-complete')finish(null,message);
            else if(message.type==='error')finish(new Error(message.message||'TKP yedeği oluşturulamadı.'));
            else if(message.type==='phase'&&message.phase==='export-segment'&&btn){
              const total=Math.max(1,Number(message.total)||1),index=Math.max(0,Number(message.index)||0);
              btn.textContent=`⏳ Yedek akıyor: ${message.name||'veri'} ${index}/${total}`;
            }
          };
          worker.postMessage({type:'export',portable:{x:tkpPortableXSettings()}});
        });
        const countMismatches=['files','races','bets','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log']
          .filter(key=>Number(result.counts?.[key]||0)!==Number(expectedBackupCounts[key]||0));
        if(countMismatches.length){
          throw new Error(`Yedek manifesti canlı veriyle eşleşmedi: ${countMismatches.map(key=>`${key} ${expectedBackupCounts[key]||0}→${result.counts?.[key]||0}`).join(' · ')}. Yedek indirilmedi.`);
        }
        blob=result.blob;globalThis.__tkpLastBackupPrepareMetrics={...(result.metrics||{}),verifiedCounts:expectedBackupCounts};
      }else{
        const text=await tkpCreateCompressedBackupText();blob=await tkpGzipText(text);
      }
      const name='TKP_CORE_YEDEK_'+tkpBackupFileStamp()+'.tkbz';
      const usedFolder=await saveBlobToRememberedFolder(name,blob,backupDirHandle);
      if(btn)btn.textContent=`✅ .tkbz ${usedFolder?'klasöre kaydedildi':'indirildi'} · ${expectedBackupCounts.files} dosya / ${expectedBackupCounts.races} koşu`;
    }
    catch(error){console.error('Sıkıştırılmış yedek hatası',error);alert('Sıkıştırılmış yedek oluşturulamadı: '+(error?.message||error));if(btn)btn.textContent='❌ Oluşturulamadı';}
    finally{setTimeout(()=>{if(btn){btn.textContent=old||'📦 Sıkıştırılmış Yedek';btn.disabled=false;}if(directBtn)directBtn.disabled=false;},1800);}
  }
  if($('#downloadTKPBackup'))$('#downloadTKPBackup').onclick=tkpDownloadCompressedBackup;
  if($('#downloadTKPBackupDirect'))$('#downloadTKPBackupDirect').onclick=()=>tkpDownloadCompressedBackup({downloadOnly:true});

  function tkpLocalIsoDate(date=new Date()){
    const pad=n=>String(n).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  }
  function tkpInitSelectiveBackupDates(){
    const start=$('#selectiveBackupStart'),end=$('#selectiveBackupEnd');if(!start||!end)return;
    const today=tkpLocalIsoDate();if(!start.value)start.value=today;if(!end.value)end.value=today;
  }
  function tkpSetSelectiveBackupRange(days){
    const endDate=new Date(),startDate=new Date();startDate.setDate(endDate.getDate()-Math.max(0,Number(days||1)-1));
    const start=$('#selectiveBackupStart'),end=$('#selectiveBackupEnd');if(start)start.value=tkpLocalIsoDate(startDate);if(end)end.value=tkpLocalIsoDate(endDate);
  }
  tkpInitSelectiveBackupDates();
  if($('#selectiveBackupToday'))$('#selectiveBackupToday').onclick=()=>tkpSetSelectiveBackupRange(1);
  if($('#selectiveBackupLast7'))$('#selectiveBackupLast7').onclick=()=>tkpSetSelectiveBackupRange(7);

  async function tkpDownloadSelectiveBackup(){
    const btn=$('#downloadSelectiveTKPBackup'),status=$('#selectiveBackupStatus');
    const start=$('#selectiveBackupStart')?.value||'',end=$('#selectiveBackupEnd')?.value||'';
    const old=btn?.textContent;if(btn){btn.disabled=true;btn.textContent='⏳ Seçmeli kayıt hazırlanıyor…';}
    try{
      if(typeof tkpSelectBackupRange!=='function')throw new Error('Seçmeli kayıt modülü yüklenmedi.');
      if(typeof saveDB==='function')await saveDB(false,true);
      const selected=tkpSelectBackupRange(db,start,end);
      if(!(selected.files||[]).length&&!(selected.races||[]).length)throw new Error('Seçilen tarih aralığında yarış kaydı yok.');
      const manifest=tkpBackupCounts(selected);
      const envelope={tkp_backup_version:3,backup_mode:'selective_range',created_at:new Date().toISOString(),date_range:{start,end},manifest,portable:{x:tkpPortableXSettings()},db:selected};
      const blob=await tkpGzipText(JSON.stringify(envelope));
      const name=`TKP_SECILI_${start}_${end}_${tkpBackupFileStamp().split('_')[1]}.tkbz`;
      const usedFolder=await saveBlobToRememberedFolder(name,blob,null);
      if(status)status.textContent=`✅ ${start} → ${end}: ${manifest.files||0} toplantı / ${manifest.races||0} koşu ${usedFolder?'klasöre kaydedildi':'indirildi'}.`;
    }catch(error){console.error('Seçmeli yedek hatası',error);if(status)status.textContent='❌ '+(error?.message||error);alert('Seçmeli kayıt oluşturulamadı: '+(error?.message||error));}
    finally{if(btn){btn.disabled=false;btn.textContent=old||'📦 Seçmeli Kaydı İndir (.tkbz)';}}
  }
  if($('#downloadSelectiveTKPBackup'))$('#downloadSelectiveTKPBackup').onclick=tkpDownloadSelectiveBackup;

  if($('#restoreSelectiveTKPBackup'))$('#restoreSelectiveTKPBackup').onchange=async e=>{
    const f=(e.target.files||[])[0];if(!f)return;const status=$('#selectiveBackupStatus');
    try{
      if(status)status.textContent='⏳ Seçmeli kayıt açılıyor ve mevcut arşivle karşılaştırılıyor…';
      const parsed=JSON.parse(await tkpGunzipFile(f));
      if(parsed?.backup_mode!=='selective_range'||!parsed?.db)throw new Error('Bu dosya seçmeli tarih aralığı yedeği değil. Tam yedek için üstteki geri yükleme alanını kullan.');
      if(typeof tkpMergeSelectiveBackup!=='function')throw new Error('Seçmeli birleştirme modülü yüklenmedi.');
      let incoming=parsed.db;
      if(typeof globalThis.tkpMigrateDbPayload==='function')incoming=globalThis.tkpMigrateDbPayload(incoming,{chronologyMode:'restore'});
      const range=parsed?.date_range||{};
      const incomingCounts=tkpBackupCounts(incoming);
      if(!confirm(`Seçmeli kayıt mevcut arşive BİRLEŞTİRİLSİN mi?\n\nTarih: ${range.start||'?'} → ${range.end||'?'}\nGelen: ${incomingCounts.files||0} toplantı / ${incomingCounts.races||0} koşu\n\nMevcut arşiv silinmez; aynı yarışlar güncellenir.`))return;
      const merged=tkpMergeSelectiveBackup(db,incoming);
      const stamp=new Date().toISOString();
      merged.db.changelog=Array.isArray(merged.db.changelog)?merged.db.changelog:[];
      merged.db.changelog.push({ts:stamp,type:'SELECTIVE_BACKUP_MERGE',message:`Seçmeli tarih aralığı birleştirildi: ${range.start||'?'} → ${range.end||'?'}.`});
      setDb(merged.db);
      tkpMergePortableXSettings(parsed.portable);
      if(typeof invalidateConditionStatsCache==='function')invalidateConditionStatsCache();
      if(typeof globalThis.tkpInvalidateBackupCache==='function')globalThis.tkpInvalidateBackupCache();
      await saveDB(false,true);renderAll();
      const s=merged.summary||{};
      if(status)status.textContent=`✅ Birleştirildi · yeni ${s.addedFiles||0} toplantı / ${s.addedRaces||0} koşu · güncellenen ${s.updatedFiles||0} toplantı / ${s.updatedRaces||0} koşu.`;
      alert(`Seçmeli kayıt birleştirildi.\nYeni: ${s.addedFiles||0} toplantı / ${s.addedRaces||0} koşu\nGüncellenen: ${s.updatedFiles||0} toplantı / ${s.updatedRaces||0} koşu.`);
    }catch(error){console.error('Seçmeli birleştirme hatası',error);if(status)status.textContent='❌ '+(error?.message||error);alert('Seçmeli kayıt birleştirilemedi: '+(error?.message||error));}
    finally{e.target.value='';}
  };

  const TKP_RESTORE_BREADCRUMB_KEY='tkp_backup_restore_breadcrumb_v1';
  const TKP_RESTORE_PHASE_LABELS={
    decompress:'Yedek dosyası açılıyor (sıkıştırma çözülüyor)…',
    parse:'Yedek verisi ayrıştırılıyor (bu adım büyük yedeklerde uzun sürebilir, lütfen bekleyin)…',
    'parse-segment':'Yedek verisi ayrıştırılıyor',
    chronology:'Dosya kronolojisi kuruluyor…',
    'resolve-backlog':'Eski tahmin kayıtları sonuçlarla eşleştiriliyor…',
    'indexeddb-write':'Veritabanına kaydediliyor…'
  };
  // V1.1.276 KÖK FIX: büyük yedeklerde (yüzlerce dosya/binlerce koşu) sıkıştırma
  // çözme + JSON ayrıştırma adımları onlarca saniye sürebilir ve o süre boyunca
  // hiçbir ilerleme bilgisi yoktu -- kullanıcı donmuş sanıp sekmeyi/tarayıcıyı
  // kendi kapatabiliyordu (gerçek bir çökme olmadan bile "sistem çıktı" izlenimi
  // verir). Ayrıca gerçek bir çökme (OOM vb.) olduğunda hiçbir iz kalmıyordu.
  // Şimdi her aşama hem ekrana hem de (worker/sekme çökse bile hayatta kalan)
  // localStorage'a yazılır; bir sonraki açılışta yarım kalmış bir iz bulunursa
  // kullanıcıya hangi aşamada kaldığı açıkça gösterilir.
  function tkpWriteRestoreBreadcrumb(phase,extra){
    try{
      localStorage.setItem(TKP_RESTORE_BREADCRUMB_KEY,JSON.stringify({phase,extra:extra||null,at:new Date().toISOString()}));
    }catch(_e){}
  }
  function tkpClearRestoreBreadcrumb(){
    try{ localStorage.removeItem(TKP_RESTORE_BREADCRUMB_KEY); }catch(_e){}
  }
  function tkpCheckStaleRestoreBreadcrumbOnBoot(){
    try{
      const raw=localStorage.getItem(TKP_RESTORE_BREADCRUMB_KEY);
      if(!raw)return;
      const info=JSON.parse(raw);
      const label=TKP_RESTORE_PHASE_LABELS[info?.phase]||info?.phase||'bilinmeyen aşama';
      console.warn(`TKP: önceki yedek geri yükleme oturumu tamamlanmadan kapanmış. Son bilinen aşama: "${label}" (${info?.at||'?'}). Muhtemel neden: tarayıcı/sekme bellek baskısı nedeniyle kapandı veya kullanıcı sekmeyi kapattı. Yedek dosyanız değişmedi, tekrar deneyebilirsiniz.`);
    }catch(_e){}
    finally{ tkpClearRestoreBreadcrumb(); }
  }
  tkpCheckStaleRestoreBreadcrumbOnBoot();

  function tkpRestoreBackupInWorker(file,restoreLabel,options={}){
    return new Promise((resolve,reject)=>{
      const worker=new Worker('tkp-backup-import-worker.js?v='+encodeURIComponent(TKP_RUNTIME_VERSION));
      const inputFormat=options.inputFormat==='json'?'json':'gzip';
      const promptTitle=options.promptTitle||(inputFormat==='json'?'JSON yedeği':'Sıkıştırılmış TKP yedeği');
      const finish=(error,value)=>{worker.terminate();tkpClearRestoreBreadcrumb();error?reject(error):resolve(value);};
      worker.onerror=event=>finish(new Error(event?.message||'TKP aktarım worker hatası.'));
      tkpWriteRestoreBreadcrumb('start',{name:file.name,size:file.size});
      worker.onmessage=event=>{
        const message=event.data||{};
        if(message.type==='phase'){
          tkpWriteRestoreBreadcrumb(message.phase,message);
          const segmentNote=message.phase==='parse-segment'?` (${message.index??message.chunk??0}/${message.total??message.chunks??0}: ${message.name||'veri'})`:'';
          if(restoreLabel)restoreLabel.textContent=`⏳ ${TKP_RESTORE_PHASE_LABELS[message.phase]||message.phase}${segmentNote}`;
        }else if(message.type==='ready'){
          const current=`${db?.files?.length||0} dosya / ${db?.races?.length||0} koşu`;
          const next=`${message.counts?.files||0} dosya / ${message.counts?.races||0} koşu`;
          const replacementNote=options.replacementNote?`\n\n${options.replacementNote}`:'';
          if(options.auto!==true&&!confirm(`${promptTitle} geri yüklensin mi?\n\nMevcut: ${current}\nYedek: ${next}${replacementNote}`)){finish(null,{cancelled:true});return;}
          if(restoreLabel)restoreLabel.textContent=`⏳ ${promptTitle} arka planda kaydediliyor…`;
          worker.postMessage({type:'persist'});
        }else if(message.type==='progress'){
          const info=message.info||{};
          tkpWriteRestoreBreadcrumb('indexeddb-write',info);
          if(restoreLabel)restoreLabel.textContent=`⏳ TKP yedeği arka planda kaydediliyor · ${Number(info.totalRecords||0).toLocaleString('tr-TR')} kayıt`;
        }else if(message.type==='complete') finish(null,message);
        else if(message.type==='error') finish(new Error(message.message||'TKP aktarımı başarısız.'));
      };
      worker.postMessage({type:'prepare',file,inputFormat});
    });
  }
  globalThis.__tkpRestoreBackupInWorker=tkpRestoreBackupInWorker;
  if($('#restoreTKPBackup'))$('#restoreTKPBackup').onchange=async(e)=>{
    const f=(e.target.files||[])[0];if(!f)return;
    const restoreLabel=e.target.closest?.('label')||document.querySelector('label[for="restoreTKPBackup"]');
    const restoreOldLabel=restoreLabel?.textContent||'';
    if(typeof Worker!=='undefined'){
      try{
        if(restoreLabel)restoreLabel.textContent='⏳ TKP yedeği arka planda açılıyor…';
        const result=await tkpRestoreBackupInWorker(f,restoreLabel);
        if(result?.cancelled)return;
        if(result?.verified===false)throw new Error('Parçalı kayıtta eksik koleksiyon algılandı: '+(result.missing||[]).join(', '));
        globalThis.__tkpLastBackupRestoreMetrics=result.metrics||{};
        globalThis.__tkpLastBackupRestoreMs=Number(result?.metrics?.totalMs)||0;
        const resolvedMsg=result.counts.resolvedPredictions?` · ${result.counts.resolvedPredictions} eski tahmin sonuçla eşleştirildi`:'';
        tkpMergePortableXSettings(result.portable);
        if(restoreLabel)restoreLabel.textContent=`✅ ${result.counts.files} dosya / ${result.counts.races} koşu aktarıldı${resolvedMsg}`;
        alert(`Sıkıştırılmış yedek başarıyla geri yüklendi · ${result.counts.files} dosya / ${result.counts.races} koşu${resolvedMsg}.`);
        try{ localStorage.removeItem('tkpAutoRecalcRulesAfterRestore'); }catch(_e){}
        location.reload();
      }catch(error){alert('Sıkıştırılmış yedek geri yüklenemedi: '+(error?.message||error));if(restoreLabel)restoreLabel.textContent=restoreOldLabel;}
      finally{e.target.value='';}
      return;
    }
    const restoreStarted=performance.now();
    const restoreMetrics={file:f.name,bytes:f.size,startedAt:new Date().toISOString(),stages:{},longTasks:[],heartbeatDelays:[]};
    let restoreStageStarted=restoreStarted;
    const markRestoreStage=name=>{const now=performance.now();restoreMetrics.stages[name]=Math.round((now-restoreStageStarted)*10)/10;restoreStageStarted=now;};
    let restoreObserver=null;
    try{if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){restoreObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())restoreMetrics.longTasks.push({startTime:Math.round(entry.startTime*10)/10,duration:Math.round(entry.duration*10)/10});});restoreObserver.observe({type:'longtask',buffered:true});}}catch(_){ }
    let heartbeatExpected=performance.now()+50;
    const heartbeat=setInterval(()=>{const now=performance.now(),delay=now-heartbeatExpected;if(delay>20)restoreMetrics.heartbeatDelays.push(Math.round(delay*10)/10);heartbeatExpected=now+50;},50);
    if(restoreLabel)restoreLabel.textContent='⏳ TKP yedeği aktarılıyor…';
    if(typeof tkpYield==='function')await tkpYield();
    try{
      const text=await tkpGunzipFile(f);markRestoreStage('gunzip');
      const parsed=JSON.parse(text);markRestoreStage('jsonParse');
      const raw=normalizeTkpBackupPayload(parsed);
      let x=typeof globalThis.tkpMigrateDbPayload==='function'?globalThis.tkpMigrateDbPayload(raw,{chronologyMode:'restore'}):raw;markRestoreStage('migration');
      if(typeof sanitizeRealBmbFlags==='function')x=await sanitizeRealBmbFlags(x,{mode:'restore'});markRestoreStage('sanitize');
      const current=`${db?.files?.length||0} dosya / ${db?.races?.length||0} koşu`,next=`${x?.files?.length||0} dosya / ${x?.races?.length||0} koşu`;
      if(!confirm(`Sıkıştırılmış TKP yedeği geri yüklensin mi?\\n\\nMevcut: ${current}\\nYedek: ${next}`))return;
      markRestoreStage('confirmation');
      x.changelog=Array.isArray(x.changelog)?x.changelog:[];x.changelog.push({ts:new Date().toISOString(),type:'BACKUP',message:`.tkbz/.tkpbak yedeğinden geri yüklendi: ${next}.`});
      setDb(x);markRestoreStage('setDb');
      // V1.1.229: worker'a taşınan hızlı yol gibi bu (Worker'sız) yedek yolu da eski
      // sonuçlanmış-ama-resolved=0 kalmış tahmin kayıtlarını gerçek sonuçlarla eşleştirir.
      const restoreResolvedCount=typeof resolvePredictionLogWithRaces==='function'?resolvePredictionLogWithRaces(x.races||[]):0;
      markRestoreStage('resolveBacklog');
      await saveDB(false,true);markRestoreStage('indexedDbWrite');
      renderAll();markRestoreStage('render');
      try{ localStorage.removeItem('tkpAutoRecalcRulesAfterRestore'); }catch(_e){}
      alert('Sıkıştırılmış yedek başarıyla geri yüklendi · '+next+(restoreResolvedCount?` · ${restoreResolvedCount} eski tahmin sonuçla eşleştirildi`:'')+'.');
    }
    catch(error){alert('Sıkıştırılmış yedek geri yüklenemedi: '+(error?.message||error));}
    finally{clearInterval(heartbeat);try{restoreObserver?.disconnect();}catch(_){ }e.target.value='';const total=performance.now()-restoreStarted;restoreMetrics.totalMs=Math.round(total*10)/10;restoreMetrics.longestLongTaskMs=Math.max(0,...restoreMetrics.longTasks.map(x=>x.duration));restoreMetrics.longestHeartbeatDelayMs=Math.max(0,...restoreMetrics.heartbeatDelays);globalThis.__tkpLastBackupRestoreMetrics=restoreMetrics;const elapsed=(total/1000).toFixed(1).replace('.',',');if(restoreLabel){restoreLabel.textContent=`✅ Aktarım ${elapsed} sn`;setTimeout(()=>{restoreLabel.textContent=restoreOldLabel;},3500);}globalThis.__tkpLastBackupRestoreMs=Math.round(total);}
  };
  $('#downloadCSV').onclick = () => {
    const btn=$('#downloadCSV');
    const task=()=>downloadMasterCsv();
    if(typeof tkpRunButtonTask==='function')return tkpRunButtonTask(btn,'working',task,{actionName:'CSV dışa aktar',actionBudgetMs:15000,safetyTimeoutMs:15000,timeoutDetail:'CSV arka planda hazırlanıyor',errorDetail:'CSV oluşturulamadı'});
    return task();
  };
  $('#downloadAllOds').onclick = () => {
    const btn = $('#downloadAllOds');
    const task=async()=>{try{await downloadAllFilesAsOdsZip();}catch(e){console.error('Toplu ODS yedek hatası:',e);alert('ODS ZIP oluşturulamadı: '+(e?.message||String(e)));throw e;}};
    if(typeof tkpRunButtonTask==='function')return tkpRunButtonTask(btn,'working',task,{actionName:'Tüm ODS ZIP dışa aktar',actionBudgetMs:15000,safetyTimeoutMs:15000,timeoutDetail:'ODS ZIP arka planda hazırlanıyor',doneDetail:'İndirildi',errorDetail:'ODS ZIP oluşturulamadı',silent:true});
    return task();
  };
  function normalizeTkpBackupPayload(raw){
    let x=raw;
    const seen=new Set();
    for(let i=0;i<8;i++){
      if(typeof x==='string'){
        const trimmed=x.trim();
        if(!trimmed) throw new Error('Yedek dosyası boş.');
        x=JSON.parse(trimmed);
        continue;
      }
      if(!x || typeof x!=='object') break;
      if(seen.has(x)) break;
      seen.add(x);
      if(Array.isArray(x.files) || Array.isArray(x.races) || Array.isArray(x.bets)) break;
      const candidates=['db','database','data','payload','backup','tkp','tkp_core_db_v1','value'];
      let moved=false;
      for(const key of candidates){
        if(x[key]!==undefined){ x=x[key]; moved=true; break; }
      }
      if(!moved) break;
    }
    if(!x || typeof x!=='object' || Array.isArray(x)) throw new Error('Geçersiz yedek dosyası: TKP veritabanı nesnesi bulunamadı.');
    if(!Array.isArray(x.files) && !Array.isArray(x.races) && !Array.isArray(x.bets)) throw new Error('Geçersiz yedek dosyası: files/races/bets alanları bulunamadı.');
    return x;
  }

  $('#restoreJSON').onchange = async (e) => {
    let f = (e.target.files||[])[0];
    if (!f) return;
    const restoreLabel=e.target.closest?.('label');
    const restoreOldLabel=restoreLabel?.textContent||'';
    if(typeof Worker!=='undefined'){
      try{
        if(restoreLabel)restoreLabel.textContent='⏳ JSON yedeği arka planda okunuyor…';
        const result=await tkpRestoreBackupInWorker(f,restoreLabel,{inputFormat:'json',promptTitle:'JSON yedeği',replacementNote:'Bu işlem mevcut hafızayı yedek dosyadaki verilerle değiştirecek.'});
        if(result?.cancelled)return;
        if(result?.verified===false)throw new Error('Parçalı kayıtta eksik koleksiyon algılandı: '+(result.missing||[]).join(', '));
        globalThis.__tkpLastBackupRestoreMetrics=result.metrics||{};
        globalThis.__tkpLastBackupRestoreMs=Number(result?.metrics?.totalMs)||0;
        const counts=result.counts||{};
        const mergedHandles=tkpMergePortableXSettings(result.portable);
        const credMsg=await tkpRestorePortableCredentials(result.portable);
        const resolvedMsg=counts.resolvedPredictions?`\n🔗 ${counts.resolvedPredictions} eski tahmin kaydı sonuçla eşleştirildi (öğrenme boşluğu giderildi).`:'';
        const manifest=result.manifest;
        const manifestMsg=manifest?`\nYedek manifesti: ${manifest.files||0} dosya / ${manifest.races||0} koşu.`:'';
        if(restoreLabel)restoreLabel.textContent=`✅ ${counts.files||0} dosya / ${counts.races||0} koşu eksiksiz aktarıldı`;
        alert(`Geri yükleme tamamlandı: ${counts.files||0} dosya / ${counts.races||0} koşu.\n✅ Bütünlük: worker yazımı ve parçalı manifest doğrulandı.${manifestMsg}${resolvedMsg}\nX takipleri: mevcut + yedek birleştirildi (${mergedHandles.length}).${credMsg}`);
        location.reload();
      }catch(err){alert('Geri yükleme başarısız: '+(err?.message||String(err)));if(restoreLabel)restoreLabel.textContent=restoreOldLabel;}
      finally{e.target.value='';}
      return;
    }
    try {
      let text = await tkpReadFileText(f);
      const parsedBackup=JSON.parse(text);
      const portable=parsedBackup&&typeof parsedBackup==='object'&&!Array.isArray(parsedBackup)?(parsedBackup.portable||parsedBackup._tkp_portable||null):null;
      const manifest=parsedBackup&&typeof parsedBackup==='object'&&!Array.isArray(parsedBackup)?(parsedBackup.manifest||null):null;
      let raw = normalizeTkpBackupPayload(parsedBackup);
      const rawCounts=tkpBackupCounts(raw);
      let x = typeof globalThis.tkpMigrateDbPayload==='function' ? globalThis.tkpMigrateDbPayload(raw,{chronologyMode:'restore'}) : raw;
      if(typeof sanitizeRealBmbFlags==='function') x = await sanitizeRealBmbFlags(x,{mode:'restore'});
      const currentCount = `${Array.isArray(db?.files)?db.files.length:0} dosya / ${Array.isArray(db?.races)?db.races.length:0} koşu`;
      const nextCount = `${Array.isArray(x.files)?x.files.length:0} dosya / ${Array.isArray(x.races)?x.races.length:0} koşu`;
      if(!confirm(`JSON yedeği geri yüklensin mi?

Mevcut: ${currentCount}
Yedek: ${nextCount}

Bu işlem mevcut hafızayı yedek dosyadaki verilerle değiştirecek.`)) return;
      x.changelog = Array.isArray(x.changelog) ? x.changelog : [];
      x.changelog.push({ts:new Date().toISOString(), type:'BACKUP', message:`JSON yedeğinden geri yüklendi: ${nextCount}.`});
      setDb(x);
      // V1.1.229: worker .tkpbak yolundaki öğrenme boşluğu fix'iyle aynı kural — JSON
      // yedeğinde de sonucu gerçekte mevcut ama resolved=0 kalmış eski tahminler eşleştirilir.
      const jsonRestoreResolvedCount=typeof resolvePredictionLogWithRaces==='function'?resolvePredictionLogWithRaces(x.races||[]):0;
      await saveDB(true);
      const after=tkpBackupCounts(db),missing=[];for(const k of Object.keys(rawCounts)){if(after[k]<rawCounts[k])missing.push(`${k}: ${rawCounts[k]}→${after[k]}`);}
      const mergedHandles=tkpMergePortableXSettings(portable);
      const credMsg=await tkpRestorePortableCredentials(portable);
      if(typeof renderAll==='function') renderAll();
      const persist=typeof persistenceStatus==='function'?persistenceStatus():{};
      const verifyMsg=missing.length?`\n⚠️ EKSİK YÜKLEME ALGILANDI: ${missing.join(' · ')}`:`\n✅ Bütünlük: ${after.files} dosya / ${after.races} koşu / ${after.bets} bahis kaydı eksiksiz.`;
      const manifestMsg=manifest?`\nYedek manifesti: ${manifest.files||0} dosya / ${manifest.races||0} koşu.`:'';
      const resolvedMsg=jsonRestoreResolvedCount?`\n🔗 ${jsonRestoreResolvedCount} eski tahmin kaydı sonuçla eşleştirildi (öğrenme boşluğu giderildi).`:'';
      alert(`Geri yükleme tamamlandı: ${nextCount}.${verifyMsg}${manifestMsg}${resolvedMsg}\nX takipleri: mevcut + yedek birleştirildi (${mergedHandles.length}).${credMsg}\nKalıcı kayıt: ${persist.verified===false?'DOĞRULANAMADI':'doğrulandı'}${persist.error?' · '+persist.error:''}`);
      if(missing.length) throw new Error('JSON geri yükleme sonrasında eksik kayıt tespit edildi; yedek korunarak işlem uyarıyla durduruldu.');
    } catch(err){ alert('Geri yükleme başarısız: ' + (err?.message||String(err))); }
    finally { e.target.value=''; }
  };
  if ($('#tkpBackToStartMenu')) $('#tkpBackToStartMenu').onclick = tkpGoToStartMenu;
  $('#resetSeed').onclick = async () => {
    if (!confirm('Tüm veriler silinip başlangıç durumuna dönülecek. Emin misin? İşlem öncesi güvenli dahili checkpoint alınacak.')) return;
    try{
      // Büyük DB'yi reset öncesinde tek dev JSON'a çevirmek yerine mevcut parçalı
      // IndexedDB snapshot'ını kesinleştir ve manifest checkpoint al.
      if(typeof saveDB==='function')await saveDB(false,true);
      if(typeof globalThis.tkpCreateStorageCheckpoint==='function')await globalThis.tkpCreateStorageCheckpoint('before-reset-seed');
    }catch(error){alert('Sıfırlama öncesi güvenlik kaydı alınamadı; veri korunması için işlem iptal edildi. '+(error?.message||error));return;}
    setDb(clone(SEED));
    await saveDB();
    // KÖK FIX (R16.10): setDb()+saveDB() veriyi gerçekten sıfırlıyordu ama ekran
    // hiç yenilenmiyordu -- diğer tüm geri yükleme düğmeleri (restoreTKPBackup,
    // restoreJSON) burada renderAll() çağırıyor, resetSeed çağırmıyordu. Kullanıcı
    // "sıfırlamıyor" diye algılıyordu; veri aslında sıfırlanıyor, yalnız görünmüyordu.
    if(typeof renderAll==='function') renderAll();
    log('SETTINGS','Sistem başlangıç verisine sıfırlandı.');
  };
  $('#saveSettings').onclick = () => {
    db.settings.best_min_single = Math.max(2, +$('#bestMin').value || db.settings.best_min_single);
    db.settings.perfect_min_single = Math.max(3, +$('#perfectMin').value || db.settings.perfect_min_single);
    db.settings.perfect_min_rate = Math.min(1, Math.max(0.01, (+$('#perfectRate').value||75)/100));
    db.settings.max_rule_size = +$('#maxRuleSize').value === 3 ? 3 : 2;
    if(typeof tkpCommitUserSettingsGuard==='function')tkpCommitUserSettingsGuard(db,'user-save');
    log('SETTINGS', 'Kural eşikleri güncellendi ve ayar koruma kilidine alındı.');
    saveDB();
  };
}



function tkpRepairUploadButtons(){
  const folderBtn=document.getElementById('chooseBulletinFolder');
  const folderInput=document.getElementById('bulletinFile');
  // Klasör inputu butonun üzerinde şeffaf duruyor; kullanıcı doğrudan native inputa tıklar.
  // Burada input.click() yapılırsa Opera/Chrome bazı sürümlerde klasör penceresini açmıyor.
  if(folderBtn && folderInput) folderBtn.onclick=null;
  if(folderInput) folderInput.onclick=function(){try{this.value='';}catch(_){}};
  const agfBtn=document.getElementById('chooseFinalAgfHtml');
  const agfInput=document.getElementById('finalAgfFile');
  if(agfBtn && agfInput){
    // Ana bind edilmiş otomatik TJK -> manuel fallback davranışını bozma. Repair yalnız
    // inputun aynı dosyayı yeniden seçebilmesini sağlar.
    agfInput.onclick=function(){try{this.value='';}catch(_){}};
  }
}

function tkpInvalidateLegacyScoreLocks(){
  if(!db) return false;
  db.settings = db.settings || {};
  const ver = (typeof TKP_SCORE_MODEL_VERSION !== 'undefined') ? TKP_SCORE_MODEL_VERSION : 'V25_TKP_2026_08_01_LEAKFREE_TDRC_ACCURATE_REFRESH';
  if(db.settings.tkp_score_model_version === ver) return false;
  let changed=0;
  const fields=[
    'prediction_score_snapshot','prediction_score_parts_snapshot','prediction_why_snapshot',
    'prediction_best_lb_snapshot','prediction_score_snapshot_at','prediction_score_model_version'
  ];
  for(const r of (db.races||[])){
    const finished=typeof raceHasConfirmedResult==='function' ? raceHasConfirmedResult(r.horses||[]) : (r.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
    for(const h of (r.horses||[])){
      if(h.prediction_score_model_version === ver) continue;
      // Tamamlanmış yarışın PRE-RACE kilidi tarihsel kayıttır; sürüm değişimi bunu silemez.
      if(finished && Number(h.prediction_score_locked)===1 && Number.isFinite(Number(h.prediction_score_snapshot))){
        if(typeof applyPredictionScoreSnapshot==='function') applyPredictionScoreSnapshot(h);
        continue;
      }
      let touched=false;
      for(const f of fields){ if(Object.prototype.hasOwnProperty.call(h,f)){ delete h[f]; touched=true; } }
      if(h.prediction_score_locked){ h.prediction_score_locked=0; touched=true; }
      if(touched) changed++;
    }
  }
  db.settings.tkp_score_model_version = ver;
  if(changed && typeof log==='function') log('SYSTEM', `${changed} eski TKP skor kilidi temizlendi; eski yarışlar açıldığında güncel puanla yeniden yazılacak.`);
  // Açılış bakımını yöneten çağıran, diğer migrasyonlarla birlikte TEK saveDB
  // yapar. Buradan ayrıca kayıt başlatmak 290 MB gerçek DB'yi iki kez yazıp
  // arayüzü saniyelerce kilitliyordu.
  return true;
}


// V1.1.301 — otomatik tarihsel yeniden hesaplama kaldırıldı.
// Frozen/eski kayıtlar korunur; açılışta veya db-change olayında ağır yeniden üretim başlatılmaz.
let _tkpAutoPipelinePromise=null;
async function tkpAutoPostLoadPipeline(reason='startup'){
  const result={ok:true,disabled:true,reason,at:new Date().toISOString()};
  window.__tkpAutoPipelineLast=result;
  return result;
}
window.tkpAutoPostLoadPipeline=tkpAutoPostLoadPipeline;
window.__tkpAutomaticHistoricalRebuildDisabled=true;

function tkpGoToStartMenu(){
  try{
    const dashboard=document.querySelector('#tkpTabs .tab[data-pane="dashboard"]');
    if(dashboard){
      dashboard.click();
      if(!dashboard.classList.contains('active')){
        document.querySelectorAll('#tkpTabs .tab').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('#tkpRoot .pane').forEach(p=>p.classList.remove('active'));
        dashboard.classList.add('active');
        document.getElementById('pane-dashboard')?.classList.add('active');
        try{runPaneRenderer('dashboard',PANE_RENDERERS.dashboard);}catch(_e){try{renderDashboard();}catch(__e){}}
      }
    }
    window.scrollTo?.({top:0,left:0,behavior:'auto'});
    return true;
  }catch(error){console.error('Başlangıç menüsüne dönüş hatası',error);return false;}
}
window.tkpGoToStartMenu=tkpGoToStartMenu;

function tkpBootstrapInteractiveShell(){
  // KÖK HIZ/UI FIX: sekmeler veri tabanı yüklenmeden önce bağlanır. IndexedDB yavaşlarsa
  // veya kilit beklerse kullanıcı artık "ölü" bir ekran görmez. Veri gerektiren normal
  // düğmeler boot tamamlanana kadar tıklamayı görünür bir durum mesajıyla karşılar.
  window.__tkpBootReady = false;
  try{ wireTabs(); }catch(error){ console.error('TKP erken sekme bağlama hatası:', error); }
  if(typeof window.tkpRestoreTopTabs === 'function') window.tkpRestoreTopTabs();

  const bootGuard = (event) => {
    if(window.__tkpBootReady === true) return;
    const button = event.target?.closest?.('button');
    if(!button || button.closest('#tkpTabs')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const warning = document.getElementById('persistWarning');
    if(warning){
      warning.innerHTML = '<div class="warn" style="margin:6px 0;padding:8px 10px;">⏳ Veriler hazırlanıyor. Menü kullanıma açık; işlem düğmeleri veri hazır olur olmaz etkinleşecek.</div>';
    }
  };
  document.addEventListener('click', bootGuard, true);
  window.__tkpReleaseBootGuard = () => {
    window.__tkpBootReady = true;
    window.__tkpPendingBootPane='';
    document.removeEventListener('click', bootGuard, true);
  };
}

let _tkpPredictionBacklogAutoRepairScheduled=false;
function tkpSchedulePredictionBacklogAutoRepair(){
  if(_tkpPredictionBacklogAutoRepairScheduled||typeof resolvePredictionLogWithRaces!=='function')return false;
  const rows=Array.isArray(db?.prediction_log)?db.prediction_log:[];
  let unresolved=0;for(const row of rows)if(row?.resolved!==1)unresolved++;
  if(!unresolved)return false;
  if(!db.settings||typeof db.settings!=='object')db.settings={};
  const signature=[(db?.races||[]).length,rows.length,unresolved,String(db?.learning_state?.outcome_signature||'')].join('|');
  if(String(db.settings.prediction_backlog_auto_repair_signature||'')===signature)return false;
  _tkpPredictionBacklogAutoRepairScheduled=true;
  const run=async()=>{
    const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    try{
      const changed=resolvePredictionLogWithRaces(db.races||[]);
      let remaining=0;for(const row of (db.prediction_log||[]))if(row?.resolved!==1)remaining++;
      db.settings.prediction_backlog_auto_repair_signature=[(db?.races||[]).length,(db?.prediction_log||[]).length,remaining,String(db?.learning_state?.outcome_signature||'')].join('|');
      db.settings.prediction_backlog_auto_repair_last={at:new Date().toISOString(),matched:changed,remaining};
      window.__tkpMaintenanceDirty=true;
      if(changed&&typeof setRulesDirty==='function')setRulesDirty(true);
      // R16.36: Büyük koleksiyonları yeniden serialize etmeden yalnız küçük settings
      // metadatasını kalıcılaştır. Böylece Ctrl+F5 aynı onarım imzasını unutmaz ve
      // aynı prediction_log + races taramasını bir daha başlatmaz.
      if(typeof tkpPersistTopLevelMetaSoon==='function')tkpPersistTopLevelMetaSoon({settings:db.settings},'prediction-backlog-repair-meta');
      // Büyük arşiv yedeği bu bakım için yeniden yazılmaz.
      const pane=document.querySelector('.tab.active')?.dataset?.pane;
      if(pane==='dashboard')renderDashboard();
      else if(pane==='advice')renderAdvice();
      else if(pane==='rules')renderRules();
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('learning:prediction-backlog-auto-repair',started,null,{matched:changed,remaining});
    }catch(error){
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('learning:prediction-backlog-auto-repair',started,error);
      console.warn('Tahmin sonuç eşleştirmesi tamamlanamadı:',error);
    }finally{_tkpPredictionBacklogAutoRepairScheduled=false;}
  };
  const guardedRun=()=>{
    if(document.querySelector('.tab.active')?.dataset?.pane==='prediction'){
      _tkpPredictionBacklogAutoRepairScheduled=false;
      setTimeout(()=>{try{tkpSchedulePredictionBacklogAutoRepair();}catch(_e){}},1500);
      return false;
    }
    return run();
  };
  if(typeof tkpQueueTask==='function')tkpQueueTask('prediction-backlog-auto-repair',guardedRun,{priority:'background',replace:true,minIdleMs:2500});
  else setTimeout(guardedRun,2500);
  return true;
}

// R16.36: Tahmin backlog onarımı artık her açılışta/Ctrl+F5'te çalışmaz.
// Yalnız gerçek sonuç revizyonu geldiğinde çözülmemiş prediction satırları için
// arka planda tetiklenir. Bu, refresh sonrası 3.000+ koşu tekrar taramasını keser.
if(typeof window!=='undefined')window.addEventListener('tkp:db-changed',(ev)=>{
  const detail=ev?.detail||{};
  const cols=Array.isArray(detail.collections)?detail.collections:[];
  if(detail.resultsChanged||detail.outcomeChanged||cols.includes('races')){
    try{tkpSchedulePredictionBacklogAutoRepair();}catch(_e){}
  }
});

async function init(){
  const bootStarted=typeof tkpSpeedMark==='function'?tkpSpeedMark('boot:start'):0;
  tkpBootstrapInteractiveShell();
  // İlk boya önce gelir; veri yükleme bir sonraki task'ta başlar.
  if(typeof tkpYield === 'function') await tkpYield();
  let loadedDb;
  const loadStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  try{
    loadedDb = await loadDB();
    if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB',loadStarted);
  }catch(error){
    if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:loadDB',loadStarted,error);
    console.error('TKP veritabanı yüklenemedi:', error);
    const warning=document.getElementById('persistWarning');
    if(warning) warning.innerHTML='<div class="warn" style="margin:6px 0;padding:8px 10px;">❌ Veritabanı açılamadı. Arşiv üzerine yazma yapılmadı; sayfayı yeniden aç veya Sistem ekranındaki depolama durumunu kontrol et.</div>';
    if(typeof window.__tkpReleaseBootGuard === 'function') window.__tkpReleaseBootGuard();
    return;
  }

  // KRİTİK HIZ FIX: DB RAM'e gelir gelmez butonları bağla ve boot guard'ı bırak.
  // TR backfill / öğrenme kontrolü / eski skor kilidi temizliği / kalıcı yazım artık
  // kullanıcı tıklamalarının önünde DEĞİL; kullanıcı boş kaldığında çalışır.
  setDb(loadedDb,true);
  wireEvents();
  // Dağıtım ZIP'i gerçek güncel kayıtlarla gelir. İlk açılışta eksik/eski yerel
  // kayıt varsa worker üzerinden bir defa atomik olarak IndexedDB'ye aktarılır.
  // Aktarım büyük olduğundan bunu ilk boya/etkileşim yolunda bekletme: ekran
  // hemen kullanılabilir, aktarım bitince tek bir kontrollü yenileme yapılır.
  // Önceki `await` burada açılış kilidini yüzlerce saniye tutup yeni tarayıcı
  // bağlamında 0 koşu göstermesine ve "sayfa yanıt vermiyor" sanısına yol açıyordu.
  const bundledSeedPromise=tkpAutoRestoreBundledBackup(loadedDb);
  if(typeof window.__tkpReleaseBootGuard === 'function') window.__tkpReleaseBootGuard();
  if(typeof tkpSpeedMark==='function')tkpSpeedMark('boot:interactive-ready');
  tkpRepairUploadButtons();
  renderAll();
  bundledSeedPromise.then(bundledSeed=>{
    if(!bundledSeed?.restored)return;
    tkpBundledSeedStatus(`✅ Güncel kayıtlar aktarıldı · ${bundledSeed.result?.counts?.files||0} dosya / ${bundledSeed.result?.counts?.races||0} koşu. Yeniden açılıyor…`);
    setTimeout(()=>{try{location.reload();}catch(_e){}},0);
  }).catch(error=>console.warn('Paket yedeği arka plan aktarımı tamamlanamadı:',error));
  // Yenileme/program yeniden açılışında bugünün kayıtlı yerli TJK koşusunu
  // kullanıcı ayrıca "Şimdiki Koşu" düğmesine basmadan ekrana getir.
  // Opening the app must not enter prediction rendering and hidden panel warmup.
  // The saved/current meeting remains available through the existing selector.
  window.__tkpStartupDisplayOnly=true;
  // Bütünlük testi DB yüklenmeden çalıştırılmamalı. Dosyanın sonundaki eski
  // setTimeout(0) çağrısı init() içindeki await loadDB() tamamlanmadan koşuyor,
  // bu yüzden her temiz açılışta storage:false uyarısı üretiyordu.
  try{window.__TKP_INTEGRITY__=tkpIntegrityCheck();}catch(error){console.warn('TKP bütünlük testi çalışmadı',error);}
  // R16.25 KÖK FIX: refreshLearningBadges() eskiden yalnız bootMaintenance()
  // içinden çağrılıyordu; V1.1.330 ise bootMaintenance()'ın açılışta otomatik
  // çalışmasını kasıtlı olarak kapattı (ağır legacy backfill ana thread'i
  // kilitliyordu). Yan etki: ucuz/hızlı rozet metni güncellemesi de hiç
  // çalışmıyordu -- Ayrıntılı Analiz kartları DB tamamen yüklendikten sonra
  // bile açılıştaki ilk (veri henüz gelmeden alınan) "0 sonuç" durumunda
  // donuk kalıyordu. Ağır bakım paketi kasıtlı olarak ertelenmiş halde kalır;
  // yalnız ucuz rozet güncellemesi artık DB hazır olur olmaz ayrıca çalışır.
  if(typeof tkpRefreshLearningBadges==='function'){
    try{tkpRefreshLearningBadges();}catch(error){console.warn('Öğrenme rozeti güncellemesi başarısız',error);}
  }
  // R16.36: Ctrl+F5 açılışında prediction backlog taraması YOK.
  tkpScheduleAnalyticsIdlePrewarm();
  // V1.1.275: Yeniden hesapla düğmesi gerekmez. DB hazır olduktan ve ekran çizildikten
  // sonra tek otomatik pipeline bütün gerekli post-load işlerini sıralı yürütür.
  // V1.1.301: otomatik tarihsel açılış işi yok.
  // V1.1.301: db-change otomatik tarihsel yeniden hesaplama tetiklemez.
  tkpDropLegacyLearningLocalStorageSoon();
  // Kalıcı İleri Takip ve adaptif İlk 5 snapshot'larını ancak DB yüklendikten sonra
  // gerçek veri imzasıyla RAM'e al. Script değerlendirilirken boş/seed DB imzasıyla
  // yapılan erken okuma, geçerli cache'i ıskalayıp aynı 3.000+ koşuyu yeniden
  // hesaplatabiliyordu.
  setTimeout(()=>{
    try{tkpHydrateDurableLearningCache(tkpLearningCacheSignature());}catch(_e){}
    try{if(typeof hydrateAdaptiveLearningDurableCache==='function')hydrateAdaptiveLearningDurableCache(adaptiveLearningRenderSignature());}catch(_e){}
    // R16.49: tüm eski 3 Altılı + yan bahis snapshotlarının düğmesiz, düşük öncelikli
    // tamamlanması. schedule() yalnız eksik kapsam varsa idle kuyruğuna iş ekler.
    // Historical reconstruction is an explicit maintenance/data-update action,
    // never an unconditional startup job. Durable caches above are read-only.
    window.__tkpHistoricalStartupDeferred=true;
  },0);

  // Açılışta otomatik TJK/veri TOPLAMA çağrısı yapılmaz. Ağ/collector başlatılmaz;
  // yalnız RAM/IndexedDB'de zaten kayıtlı olan bugünkü yerli TJK koşusu yukarıdaki
  // hızlı, ağsız açılışla gösterilir. Yabancı yarışlar ve boş günler manuel kalır.
  window.__tkpAutoOpenCurrentRaceDisabled=true;

  const bootMaintenance=async()=>{
    const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    try{
      const trProfileBackfillChanged=typeof tkpBackfillTrProfilesAllFiles==='function' ? tkpBackfillTrProfilesAllFiles(db) : false;
      const storageMigrationChanged=typeof tkpConsumeDbMigrationDirty==='function'?tkpConsumeDbMigrationDirty():false;
      const learningStateChanged=typeof tkpEnsureLearningState==='function' ? tkpEnsureLearningState() : false;
      const legacyScoreChanged=tkpInvalidateLegacyScoreLocks();
      // Açılışta 290 MB DB'yi otomatik yazmak ilk panel tıklamalarını 15-20 sn
      // kilitliyordu. Düzeltmeler RAM'de hemen aktiftir; bir sonraki gerçek veri
      // ekleme/sonuç/ayar/yedek işleminin normal saveDB çağrısıyla birlikte kalıcılaşır.
      // Açılış bakımının kendisi artık disk yazımı başlatmaz.
      window.__tkpMaintenanceDirty=!!(learningStateChanged||storageMigrationChanged||trProfileBackfillChanged||legacyScoreChanged);
      if(typeof tkpRefreshLearningBadges==='function') tkpRefreshLearningBadges();
      // Tarihsel snapshot/puan onarımı yazılmış olsa bile çağrılmazsa eski
      // 0,60/0,90 değerleri ekranda kalır. UI hazır olduktan sonra yalnız idle
      // kuyruğunda başlat; güncel canlı toplantı verisini tarihsel sete katma.
      try{if(typeof tkpScheduleHistoricalCalibration503==='function')tkpScheduleHistoricalCalibration503();}catch(error){console.warn('Tarihsel snapshot onarım kuyruğu başlatılamadı',error);}
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:maintenance',started);
      if(typeof tkpSpeedMark==='function')tkpSpeedMark('boot:maintenance-done');
    }catch(error){
      if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('boot:maintenance',started,error);
      console.error('TKP açılış bakım hatası:',error);
    }
  };
  // 3.054 koşu / 30 bin at üzerinde toplu legacy backfill de tek başına ana
  // thread'i uzun süre tutabiliyor. Açılışta otomatik çalıştırılmaz. Güncel tahmin
  // ilgili altı ayağın profillerini zaten anlık hesaplar; veri imzası/saveDB yolu
  // öğrenme cache'lerini yeni importta otomatik geçersizleştirir. Bakım yalnız
  // tanılama veya kontrollü migrasyon gerektiğinde açıkça çağrılabilir.
  window.tkpRunDeferredMaintenance=bootMaintenance;
  // V1.1.330 ROCKET: 508/3000+ arşivde toplu tarihsel bakım açılışta otomatik
  // ÇALIŞMAZ. Ayak tablolarının hızlı davranışı tüm sisteme uygulanır: kullanıcı
  // ekranı önce anında kullanır; toplu bakım yalnız açıkça tkpRunDeferredMaintenance()
  // çağrıldığında çalışır. Bu, açılıştan 2-3 sn sonra başlayan uzun CPU dalgasını keser.
  window.__tkpBootMaintenanceAutoDisabled=true;
  // Kullanıcı açıkça istediğinde tam tarihsel onarımı kontrollü bakım sekmesinde
  // başlat; normal açılışta bu ağır iş kesinlikle çalışmaz.
  if(/[?&]repair=1(?:&|$)/.test(String(location.search||''))){
    setTimeout(()=>{try{if(typeof window.tkpRunDeferredMaintenance==='function')window.tkpRunDeferredMaintenance();}catch(error){console.warn('Tam arşiv onarımı başlatılamadı',error);}},1200);
  }
  setTimeout(tkpRepairUploadButtons,0);
}

init();

function tkpIntegrityCheck(){
  const requiredIds=['tkpRoot','predictionResult','analyticsSummary','surfaceTable','breedTable','hippoTable','conditionRankTable','agfRankTableEl','buildBudgetCoupon'];
  const missingIds=requiredIds.filter(id=>!document.getElementById(id));
  const requiredFns=['renderAll','renderAnalytics','adaptiveOrderForRace','sideBetBacktest','sideBetPanelHTML','validFinishSequences','permCount'];
  const fnMap={renderAll,renderAnalytics,adaptiveOrderForRace,sideBetBacktest,sideBetPanelHTML,validFinishSequences,permCount};
  const missingFns=requiredFns.filter(n=>typeof fnMap[n]!=='function');
  const checks={missingIds,missingFns,storage:Array.isArray(db?.files)&&Array.isArray(db?.races),version:TKP_RUNTIME_VERSION};
  if(missingIds.length||missingFns.length||!checks.storage) console.warn('TKP bütünlük kontrolü',checks);
  else console.info('TKP bütünlük kontrolü başarılı',checks);
  return checks;
}

// V240 gecikmeli-donma kilidi: 60 saniyelik kupon üretimi açılışta başlamaz.
// Canlı otomasyon ancak aynı oturumda açıkça etkinleştirilirse çalışır; normal
// Veri Topla / Son AGF / Kupon Oluştur düğmeleri her zaman manuel kalır.
function tkpStartLiveCouponAutomation(){
  if(window.__tkpLiveAutomationEnabled!==true) return false;
  if(window.__tkpLiveCouponAutomationTimer) return true;
  window.__tkpLiveCouponAutomationTimer=setInterval(()=>{
    try{Promise.resolve(autoBuildCouponsFortyMinutesBefore()).catch(()=>{});}catch(_e){}
  },60000);
  return true;
}
function tkpEnableLiveAutomationForSession(){
  window.__tkpLiveAutomationEnabled=true;
  const couponTimer=tkpStartLiveCouponAutomation();
  let collectorTimer=false;
  try{if(typeof window.tkpStartNearRaceFinalTimers==='function')collectorTimer=window.tkpStartNearRaceFinalTimers()===true;}catch(_e){}
  return {couponTimer,collectorTimer};
}
window.tkpStartLiveCouponAutomation=tkpStartLiveCouponAutomation;
window.tkpEnableLiveAutomationForSession=tkpEnableLiveAutomationForSession;
