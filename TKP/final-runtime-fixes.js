/**
 * final-runtime-fixes.js
 *
 * UI çalışma durumu ve İlk 4 kartları için geriye dönük uyumluluk katmanı.
 * Mevcut işlevlerin parametrelerini değiştirmez.
 */
(() => {
  'use strict';

  const STATUS_TEXT = Object.freeze({
    loading: 'YÜKLENİYOR…',
    calculating: 'HESAPLANIYOR…',
    testing: 'TEST EDİLİYOR…',
    saving: 'KAYDEDİLİYOR…',
    working: 'ÇALIŞIYOR…',
    background: 'ARKA PLANDA…',
    done: 'TAMAMLANDI ✓',
    error: 'HATA ✕'
  });
  const BUSY_STATES = new Set(['loading', 'calculating', 'testing', 'saving', 'working']);
  const TKP_UI_DEADLINE_MS = 15000;
  const resetTimers = new WeakMap();

  // Menü metinleri eski kompakt düzenle korunur. Simgeler ayrı çip olarak
  // eklenmez; dar ekranlarda etiketlerin kutu dışına taşması önlenir.
  const TKP_NAV_TAB_LABELS = Object.freeze({
    dashboard:'🏠 Ana panel',
    import:'🗂️ Operasyon Merkezi',
    prediction:'🔮 Tahmin',
    advice:'💡 Öneriler',
    rules:'🏆 En iyi 10 + Mükemmel 5',
    analytics:'📊 Ayrıntılı analiz',
    data:'🧾 Veri denetimi',
    files:'🗃️ Dosyalar / QC',
    profit:'💰 Kâr / zarar',
    backtest:'🔬 Back Test',
    system:'⚙️ Sistem',
    learning:'📌 İzleme Merkezi',
    backup:'💾 Yedek / ayarlar'
  });

  function isMainNavTab(button) {
    return button instanceof HTMLButtonElement
      && button.classList.contains('tab')
      && button.closest('#tkpTabs');
  }

  function restoreTopTabs() {
    document.querySelectorAll('#tkpTabs .tab[data-pane]').forEach(button => {
      const item = TKP_NAV_TAB_LABELS[button.dataset.pane];
      const label = item || '';
      if (label && button.innerHTML !== label) button.innerHTML = label;
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
      button.removeAttribute('data-operation-state');
      button.removeAttribute('data-operation-busy');
      button.removeAttribute('data-operation-detail');
      button.removeAttribute('data-operation-token');
    });
  }

  function clearResetTimer(button) {
    const timer = resetTimers.get(button);
    if (timer) {
      window.clearTimeout(timer);
      resetTimers.delete(button);
    }
  }

  function rememberButton(button) {
    if (!button.dataset.tkpOriginalHtml) {
      button.dataset.tkpOriginalHtml = button.innerHTML;
    }
    if (!button.dataset.tkpOriginalDisabled) {
      button.dataset.tkpOriginalDisabled = button.disabled ? '1' : '0';
    }
  }

  function resetButtonState(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (isMainNavTab(button)) { restoreTopTabs(); return; }
    clearResetTimer(button);
    rememberButton(button);
    button.innerHTML = button.dataset.tkpOriginalHtml;
    button.disabled = button.dataset.tkpOriginalDisabled === '1';
    button.setAttribute('aria-busy', 'false');
    button.removeAttribute('data-operation-state');
    button.removeAttribute('data-operation-busy');
    button.removeAttribute('data-operation-detail');
    button.removeAttribute('data-operation-token');
  }

  function setButtonState(button, state, detail = '', options = {}) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (isMainNavTab(button)) { restoreTopTabs(); return; }
    rememberButton(button);
    clearResetTimer(button);

    const normalizedState = String(state || 'ready');
    if (normalizedState === 'ready') {
      resetButtonState(button);
      return;
    }

    const busy = BUSY_STATES.has(normalizedState);
    const label = STATUS_TEXT[normalizedState] || button.textContent.trim() || 'ÇALIŞIYOR…';
    button.dataset.operationState = normalizedState;
    button.dataset.operationBusy = busy ? 'true' : 'false';
    button.dataset.operationDetail = String(detail || '');
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    button.disabled = busy;
    button.textContent = detail ? `${label} ${detail}` : label;

    if (!busy) {
      const delay = Number(options.resetDelayMs)
        || (normalizedState === 'done' ? 1200 : 2600);
      const timer = window.setTimeout(() => resetButtonState(button), delay);
      resetTimers.set(button, timer);
    }
  }

  async function runButtonTask(button, state, task, options = {}) {
    if (!(button instanceof HTMLButtonElement)) {
      return typeof task === 'function' ? task() : undefined;
    }
    if (button.dataset.operationBusy === 'true') return undefined;

    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const actionStarted=(window.performance&&performance.now)?performance.now():Date.now();
    const actionName=String(options.actionName||button.id||button.textContent||state||'button').replace(/\s+/g,' ').trim().slice(0,100);
    const buttonDeadlineMs=button.id==='buildBudgetCoupon'?40000:TKP_UI_DEADLINE_MS;
    const actionBudgetMs=Math.min(buttonDeadlineMs,Math.max(50,Number(options.actionBudgetMs)||1200));
    let actionError=null,timedOut=false;
    // Evrensel kullanıcı-etkileşimi sözleşmesi: hiçbir düğme ana arayüzü 15 saniyeden
    // uzun süre meşgul tutamaz. Uzun ağ/IndexedDB/hesap işi güvenli biçimde çalışmaya
    // devam eder; yalnız düğme ve menüler serbest bırakılır. Veri işi zorla kesilmez.
    const safetyTimeoutMs = Math.min(buttonDeadlineMs,Math.max(1000,Number(options.safetyTimeoutMs)||buttonDeadlineMs));
    button.dataset.operationToken = token;
    setButtonState(button, state || 'working', options.detail || '');

    const backgroundMarker={background:true};
    let safetyTimer=0;
    const taskPromise=Promise.resolve().then(task);
    const deadlinePromise=new Promise(resolve=>{
      safetyTimer=window.setTimeout(()=>resolve(backgroundMarker),safetyTimeoutMs);
    });

    try {
      const result = await Promise.race([taskPromise,deadlinePromise]);
      if(result===backgroundMarker){
        timedOut=true;
        if(button.dataset.operationToken===token && button.dataset.operationBusy==='true'){
          setButtonState(button,'background',options.timeoutDetail||'İşlem sürüyor; menüler serbest',options);
        }
        // Promise'i sahipsiz bırakma: tamamlanma/hata telemetrisi ayrı tutulur ve
        // aynı düğmeyle başlatılan yeni işlemin durumuna dokunulmaz.
        taskPromise.then(()=>{
          try{window.tkpRecordPerformance?.(`background:${actionName}`,actionStarted);}catch(_){ }
        }).catch(error=>{
          if(!options.silent)console.error('Arka plan işlemi hatası:',error);
          try{window.tkpRecordPerformance?.(`background:${actionName}`,actionStarted,error);}catch(_){ }
        });
        return {background:true,promise:taskPromise};
      }
      if (button.dataset.operationToken === token
        && button.dataset.operationBusy === 'true') {
        setButtonState(button, 'done', options.doneDetail || '', options);
      }
      return result;
    } catch (error) {
      actionError=error;
      if (button.dataset.operationToken === token
        && button.dataset.operationBusy === 'true') {
        setButtonState(button, 'error', options.errorDetail || '', options);
      }
      if (!options.silent) console.error('İşlem hatası:', error);
      if (options.rethrow) throw error;
      return undefined;
    } finally {
      window.clearTimeout(safetyTimer);
      try{window.tkpRecordAction?.(actionName,actionStarted,actionError,{budgetMs:actionBudgetMs,timedOut});}catch(_){ }
    }
  }

  function resetAllBusyButtons() {
    restoreTopTabs();
    document.querySelectorAll('button[data-operation-state]').forEach(resetButtonState);
  }

  window.tkpSetButtonState = setButtonState;
  window.tkpResetButtonState = resetButtonState;
  window.tkpRunButtonTask = runButtonTask;
  window.TKP_UI_DEADLINE_MS = TKP_UI_DEADLINE_MS;
  window.tkpResetAllBusyButtons = resetAllBusyButtons;
  window.tkpRestoreTopTabs = restoreTopTabs;

  // V1.1.280 HATA SONRASI KENDİNİ TOPARLAMA: Beklenmeyen bir Promise/JS hatası
  // butonları sonsuza kadar disabled/busy bırakmasın. Hata gizlenmez; console'a
  // aynen düşer, yalnız UI kilidi çözülür ve son hata küçük bir oturum kaydına yazılır.
  let runtimeRecoveryTimer=0;
  function recoverUiAfterRuntimeError(kind,error){
    clearTimeout(runtimeRecoveryTimer);
    runtimeRecoveryTimer=window.setTimeout(()=>{
      try{resetAllBusyButtons();}catch(_){}
      try{
        const row={at:new Date().toISOString(),kind:String(kind||'error'),message:String(error?.message||error||'Bilinmeyen hata').slice(0,800)};
        sessionStorage.setItem('TKP_LAST_RUNTIME_ERROR',JSON.stringify(row));
      }catch(_){}
    },0);
  }
  window.addEventListener('unhandledrejection',event=>recoverUiAfterRuntimeError('unhandledrejection',event?.reason));
  window.addEventListener('error',event=>{
    // Script runtime hatalarında toparla; img/font gibi kaynak yükleme hataları için
    // gereksiz buton resetleme yapma.
    if(event?.error)recoverUiAfterRuntimeError('error',event.error);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-tkp-operation]');
    if (!button || button.disabled || button.dataset.operationBusy === 'true') return;
    const state = button.dataset.tkpOperation || 'working';
    const safetyMs = Math.min(TKP_UI_DEADLINE_MS,Math.max(1000,Number(button.dataset.tkpSafetyTimeout)||TKP_UI_DEADLINE_MS));
    setButtonState(button, state);
    window.setTimeout(() => {
      if (button.dataset.operationBusy === 'true') resetButtonState(button);
    }, safetyMs);
  }, true);

  restoreTopTabs();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      restoreTopTabs();
      document.querySelectorAll('button[data-operation-busy="true"]').forEach(button => {
        if (!button.isConnected) return;
        const state = button.dataset.operationState;
        if (!BUSY_STATES.has(state)) resetButtonState(button);
      });
    }
  });

  function refreshLearningBadges() {
    let status = {status: 'GÜNCEL', resultCount: 0};
    try { if (typeof tkpLearningStatus === 'function') status = tkpLearningStatus(); }
    catch (e) { try{console.error('[TKP] tkpLearningStatus hata:',e);}catch(_){} }
    let coverage=null, coverageThrew=false;
    try { if(typeof tkpHistoricalAllDataCoverage==='function') coverage=tkpHistoricalAllDataCoverage(typeof db!=='undefined'?db:null); }
    catch (e) { coverageThrew=true; try{console.error('[TKP] tkpHistoricalAllDataCoverage hata:',e);}catch(_){} }
    const fmt=n=>Number(n||0).toLocaleString('tr-TR');
    // R16.24: sampleFor artık üç durumu ayırır:
    //   - kart bir kapsam (coverage) kartı değil          -> null  (genel öğrenme etiketine düş)
    //   - kart bir kapsam kartı ama db/coverage hiç yok    -> 'NOT_LOADED' (arşiv henüz yüklenmedi)
    //   - kart bir kapsam kartı ve coverage hesaplanabildi -> sayısal örnek (0 dahil, gerçek "veri yok")
    // Önceden coverage===null durumunda TÜM kartlar aynı genel resultCount'a düşüyor ve
    // farklı kategoriler (pist/safkan/hipodrom/koşu ailesi/mesafe) birbirinden ayırt
    // edilemeyen, yanıltıcı, birebir aynı "0 sonuç" etiketi gösteriyordu.
    const sampleFor=badge=>{
      const card=badge.closest('.card');
      if(!card)return null;
      const has=id=>Boolean(card.querySelector('#'+id));
      const isCoverageCard = has('surfaceTable')||has('breedTable')||has('hippoTable')||has('conditionTable')||has('distanceTable')
        ||has('agfRankTableEl')||has('conditionRankTable')||has('kulvarTable')||has('valueTable')
        ||has('accurateSpeedTable')||has('xKulisAnalysisTable')||has('signalPerfTable')||has('hippoSignalTable');
      if(!isCoverageCard)return null;
      if(!coverage)return 'NOT_LOADED';
      if(has('surfaceTable')||has('breedTable')||has('hippoTable')||has('conditionTable')||has('distanceTable'))return Number(coverage.races)||0;
      if(has('agfRankTableEl')||has('conditionRankTable')||has('kulvarTable'))return Number(coverage.verifiedRaces)||0;
      if(has('valueTable'))return Math.max(Number(coverage.value)||0,Number(coverage.ypuan)||0,Number(coverage.expertCommentRows)||0);
      if(has('accurateSpeedTable'))return Math.max(Number(coverage.accurate)||0,Number(coverage.priorAccurate)||0);
      if(has('xKulisAnalysisTable'))return Number(coverage.xKulis)||0;
      if(has('signalPerfTable')||has('hippoSignalTable'))return Math.max(Number(coverage.predictionSnapshot)||0,Number(coverage.verifiedRaces)||0);
      return null;
    };
    const code = String(status.status || 'GÜNCEL').toLocaleUpperCase('tr-TR');
    document.querySelectorAll('.learningBadge').forEach(badge => {
      const sample=sampleFor(badge);
      const notLoaded = sample==='NOT_LOADED';
      // R16.2: global "Veri az" etiketi bütün tablolara kopyalanmaz. Tablonun
      // elindeki tarihsel örnek sayısı varsa doğrudan gösterilir; tek kayıt bile dışlanmaz.
      const label = notLoaded
        ? (coverageThrew?'⚠️ Kapsam hatası':'— Arşiv yüklenmedi')
        : sample!==null
          ? (sample>0?`📚 ${fmt(sample)} kayıt`:'— Veri yok')
          : (code==='ÖĞRENİYOR'?'🟠 Öğreniyor':code==='GÜNCELLENDİ'?'🟢 Güncellendi':`📚 ${fmt(Number(status.resultCount)||0)} sonuç`);
      const state = notLoaded
        ? (coverageThrew?'COVERAGE_ERROR':'NOT_LOADED')
        : sample!==null?(sample>0?'HISTORICAL_AVAILABLE':'NO_DATA'):code;
      if (badge.textContent !== label) badge.textContent = label;
      if (badge.dataset.learningState !== state) badge.dataset.learningState = state;
      const title = notLoaded
        ? (coverageThrew?'Kapsam hesaplanırken hata oluştu; ayrıntı için konsola bakın.':'Arşiv verisi bu oturumda henüz belleğe yüklenmedi (db boş).')
        : sample!==null?`${fmt(sample)} mevcut tarihsel kayıt değerlendirmeye dahil`:`${fmt(Number(status.resultCount)||0)} sonuçlu yarış`;
      if (badge.title !== title) badge.title = title;
    });
  }

  window.tkpRefreshLearningBadges = refreshLearningBadges;

  /*
   * Tahmin / Back Test ekran kalıcılığı
   * ----------------------------------
   * Kullanıcı başka panele geçtiğinde zaten DOM korunuyordu; fakat sayfa
   * yenilenince tamamlanmış çıktı kayboluyordu. Yalnız tamamlanmış, anlamlı
   * HTML'i saklarız. "Okunuyor" ve "test ediliyor" gibi geçici ekranlar asla
   * önceki sağlam sonucu ezmez. Açık temizleme düğmesi bu kaydı da siler.
   */
  const SCREEN_SNAPSHOT_KEY = 'TKP_SCREEN_SNAPSHOTS_V35_1';
  let screenSnapshotState = null;
  let screenSnapshotTimer = 0;

  function tkpIsReloadNavigation() {
    try {
      const nav = window.performance?.getEntriesByType?.('navigation')?.[0];
      if (nav && nav.type === 'reload') return true;
    } catch (_) {}
    try {
      return Number(window.performance?.navigation?.type) === 1;
    } catch (_) {}
    return false;
  }
  window.tkpIsReloadNavigation = tkpIsReloadNavigation;

  function screenStorageCandidates() {
    const stores = [];
    try { if (window.localStorage) stores.push(window.localStorage); } catch (_) {}
    try { if (window.sessionStorage) stores.push(window.sessionStorage); } catch (_) {}
    return stores;
  }

  function readScreenSnapshots() {
    if (screenSnapshotState) return screenSnapshotState;
    for (const store of screenStorageCandidates()) {
      try {
        const parsed = JSON.parse(store.getItem(SCREEN_SNAPSHOT_KEY) || 'null');
        if (parsed && parsed.version === 1) {
          screenSnapshotState = parsed;
          return parsed;
        }
      } catch (_) {}
    }
    screenSnapshotState = {version: 1};
    return screenSnapshotState;
  }

  function writeScreenSnapshots() {
    const json = JSON.stringify(readScreenSnapshots());
    // Yerel dosya modunda bazı tarayıcılar localStorage'a izin vermeyebilir.
    // Uygun olan ilk depoya yazmak yerine ikisine de yazmayı deneriz.
    for (const store of screenStorageCandidates()) {
      try { store.setItem(SCREEN_SNAPSHOT_KEY, json); } catch (_) {}
    }
  }

  function stableScreenHtml(element, kind) {
    if (!element) return '';
    // Canlı tahmin ekranı parçalı DOM kullanır. innerHTML almak yalnız açık alt
    // paneli içerir; bunu kalıcı snapshot diye yazmak diğer ayakları boş olarak
    // geri yükler ve büyük HTML serileştirmesi ana thread'i kilitler.
    if (kind === 'prediction' && element.dataset.tkpSegmentedDom === '1') return '';
    const html = String(element.innerHTML || '').trim();
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
    if (!html || text.length < 12) return '';
    if (/okunuyor|hazırlanıyor|test ediliyor/i.test(text)) return '';
    if (/yüklenemedi|çalıştırılamadı|başarısız/i.test(text)) return '';
    if (kind === 'backtest' && element.dataset.ready !== '1') return '';
    return html;
  }

  function captureScreenSnapshots() {
    const state = readScreenSnapshots();
    const prediction = document.getElementById('predictionResult');
    const budget = document.getElementById('budgetCouponResult');
    const backtest = document.getElementById('couponBacktestResult');
    const predictionHtml = stableScreenHtml(prediction, 'prediction');
    const budgetHtml = stableScreenHtml(budget, 'prediction');
    const backtestHtml = stableScreenHtml(backtest, 'backtest');
    let changed = false;

    // Eski sürümden kalan parçalı/eksik ekran HTML'ini bir daha geri yükleme.
    // Frozen tahmin ve algoritma snapshotları DB'de ayrı alanlarda korunur; bu yalnız
    // kullanıcı arayüzünün pahalı innerHTML kopyasıdır.
    if (prediction?.dataset.tkpSegmentedDom === '1' && state.prediction?.html) {
      delete state.prediction.html;
      changed = true;
    }

    if (predictionHtml) {
      state.prediction = state.prediction || {};
      if (state.prediction.html !== predictionHtml) {
        state.prediction.html = predictionHtml;
        changed = true;
      }
      const selected = document.getElementById('tkpRecalcFileSelect');
      const selectedValue = selected ? String(selected.value || '') : '';
      if (selectedValue && state.prediction.selectedValue !== selectedValue) {
        state.prediction.selectedValue = selectedValue;
        changed = true;
      }
      state.prediction.savedAt = Date.now();
    }
    if (budgetHtml) {
      state.prediction = state.prediction || {};
      if (state.prediction.budgetHtml !== budgetHtml) {
        state.prediction.budgetHtml = budgetHtml;
        changed = true;
      }
      state.prediction.savedAt = Date.now();
    }
    if (backtestHtml && (!state.backtest || state.backtest.html !== backtestHtml)) {
      state.backtest = {html: backtestHtml, savedAt: Date.now()};
      changed = true;
    }
    if (changed) writeScreenSnapshots();
  }

  function queueScreenSnapshotCapture() {
    window.clearTimeout(screenSnapshotTimer);
    screenSnapshotTimer = window.setTimeout(captureScreenSnapshots, 250);
  }

  function bindRestoredPredictionTabs(root) {
    if (!root) return;
    // Canlı tahmin ekranı kendi parçalı-DOM sekme yöneticisine sahiptir. Buradaki
    // yedek/restored bağlayıcı canlı ekrana da eklenirse her ayak tıklamasından sonra
    // bütün HTML'i localStorage snapshotına çevirir; Win8.1'de 2-3 saniyelik takılmanın
    // ana nedenlerinden biri buydu. Bu bağlayıcı yalnız gerçekten restore edilen HTML'e aittir.
    if (root.dataset.tkpSegmentedDom === '1') return;
    root.querySelectorAll('.predLegTab').forEach(button => {
      if (button.dataset.snapshotBound === '1') return;
      button.dataset.snapshotBound = '1';
      button.addEventListener('click', () => {
        root.querySelectorAll('.predLegTab').forEach(item => item.classList.remove('active'));
        root.querySelectorAll('.predLegPane').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        const pane = root.querySelector(`.predLegPane[data-predpane="${button.dataset.predleg}"]`);
        if (pane) pane.classList.add('active');
        queueScreenSnapshotCapture();
      });
    });
  }

  function clearPredictionSnapshotOnReload() {
    const state = readScreenSnapshots();
    if (state.prediction) {
      delete state.prediction;
      writeScreenSnapshots();
    }

    const clearRestoredSelection = () => {
      const select = document.getElementById('tkpRecalcFileSelect');
      if (select) {
        select.value = '';
        try { delete select.dataset.selectionState; } catch (_) {}
      }
      const bulletin = document.getElementById('bulletinFileName');
      if (bulletin) bulletin.textContent = '';
    };

    const clearDomOnce = () => {
      clearRestoredSelection();
      const prediction = document.getElementById('predictionResult');
      const budget = document.getElementById('budgetCouponResult');
      const hint = document.getElementById('suggestedBudgetHint');
      if (prediction) prediction.innerHTML = '';
      if (budget) budget.innerHTML = '';
      if (hint) hint.innerHTML = '';
    };

    // Yalnız DOMContentLoaded anında eski ekranı temizle. Windows 8.1'de DB daha
    // geç açılabildiği için 120/350/800 ms gecikmeli DOM temizliği yeni çizilen
    // tahmini de siliyor ve boş kartlar bırakıyordu. Gecikmeli tekrarlar yalnız
    // tarayıcının restore edebildiği form seçimini nötrler; yeni sonucu silmez.
    clearDomOnce();
    // Tarayıcının form-value restoration'ı veya geç dolan dosya seçicisi eski
    // seçimi tekrar yazmasın diye yalnız seçim alanını birkaç kez nötrle.
    [0, 120, 350, 800].forEach(ms => window.setTimeout(clearRestoredSelection, ms));
  }

  function restoreScreenSnapshots() {
    const state = readScreenSnapshots();
    const prediction = document.getElementById('predictionResult');
    const budget = document.getElementById('budgetCouponResult');
    const backtest = document.getElementById('couponBacktestResult');
    // Tahmin ekranı HTML olarak restore edilmez. Parçalı DOM'un eksik alt panellerini
    // saklamak tablo kaybına yol açar; kayıtlı yarış kendi frozen/model verisinden
    // normal render yoluyla açılır.
    // Eski oturum ekranı, kritik yolda oluşmuş hata metnini de saklayabiliyor.
    // Bu metin yeni hesaplama başlamadan önce geri basılırsa kullanıcı güncel
    // plan yerine eski "stageStarted"/timeout hatasını görür. Geçerli kart
    // işaretleri dışındaki snapshot'ları geri yükleme; güncel render tek kaynaktır.
    const budgetSnapshot = String(state.prediction?.budgetHtml || '');
    const staleBudgetSnapshot = /Kupon oluşturulamadı:|Süre sınırında durduruldu|stageStarted is not defined/i.test(budgetSnapshot);
    const usableBudgetSnapshot = budgetSnapshot && !staleBudgetSnapshot &&
      /budgetCouponTriple|budgetCouponCompact|couponCard-|KAYITLI\s+3\s+KUPON/i.test(budgetSnapshot);
    if (budget && usableBudgetSnapshot && !stableScreenHtml(budget, 'prediction')) {
      budget.innerHTML = budgetSnapshot;
    }
    if (backtest && state.backtest?.html && !stableScreenHtml(backtest, 'backtest')) {
      backtest.innerHTML = state.backtest.html;
      backtest.dataset.ready = '1';
    }

    // Dosya listesi veritabanı açıldıktan sonra dolduğu için seçimi kısa süre
    // tekrar deneriz; çıktı bunun başarısına bağlı değildir.
    const selectedValue = state.prediction?.selectedValue;
    if (selectedValue) {
      let attempts = 0;
      const restoreSelection = () => {
        const select = document.getElementById('tkpRecalcFileSelect');
        if (select && Array.from(select.options || []).some(option => option.value === selectedValue)) {
          select.value = selectedValue;
          return;
        }
        if (++attempts < 8) window.setTimeout(restoreSelection, 250);
      };
      restoreSelection();
    }
  }

  function observePersistentScreens() {
    // predictionResult bilinçli olarak izlenmez: her tablo mutasyonunda yüzlerce KB
    // innerHTML + JSON + localStorage kopyalamak "Sayfa Yanıt Vermiyor" kaynağıydı.
    ['budgetCouponResult', 'couponBacktestResult'].forEach(id => {
      const element = document.getElementById(id);
      if (!element) return;
      new MutationObserver(queueScreenSnapshotCapture).observe(element, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    });
    const select = document.getElementById('tkpRecalcFileSelect');
    if (select) select.addEventListener('change', queueScreenSnapshotCapture);
  }

  window.tkpClearScreenSnapshots = function clearScreenSnapshots() {
    window.clearTimeout(screenSnapshotTimer);
    screenSnapshotState = {version: 1};
    for (const store of screenStorageCandidates()) {
      try { store.removeItem(SCREEN_SNAPSHOT_KEY); } catch (_) {}
    }
  };

  // Ctrl+F5'te de snapshotı yenilemeden hemen önce temizle. Normal F5/araç
  // çubuğu yenilemesi ise navigation.type=reload ile açılışta temizlenir.
  window.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key === 'F5') window.tkpClearScreenSnapshots();
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    if (tkpIsReloadNavigation()) clearPredictionSnapshotOnReload();
    else restoreScreenSnapshots();
    observePersistentScreens();
    refreshLearningBadges();
    let badgeRefreshQueued = false;
    const badgeObserver = new MutationObserver(records => {
      const badgeAdded = records.some(record => Array.from(record.addedNodes || []).some(node => {
        if (!(node instanceof Element)) return false;
        return node.matches('.learningBadge') || Boolean(node.querySelector('.learningBadge'));
      }));
      if (!badgeAdded || badgeRefreshQueued) return;
      badgeRefreshQueued = true;
      window.requestAnimationFrame(() => {
        badgeRefreshQueued = false;
        refreshLearningBadges();
      });
    });
    // V1.1.308-MEM-FIX: eskiden document.body tüm belge ağacını izliyordu; bu
    // yüzden uygulamadaki HER tablo/panel yeniden çizimi (analiz sekmesiyle
    // ilgisiz olanlar dahil) bu observer'ı tetikleyip her defasında yeni eklenen
    // alt ağacı .learningBadge için tarıyordu. .learningBadge rozetleri yalnız
    // #pane-analytics içinde statik olarak var; izleme kökü oraya daraltıldı.
    const badgeObserveRoot = document.getElementById('pane-analytics') || document.body;
    badgeObserver.observe(badgeObserveRoot, {childList: true, subtree: true});
    window.addEventListener('tkp:db-changed', refreshLearningBadges);
  });
})();
