/**
 * tkp-menu-fast.js — V28 genel menü hız koruması
 *
 * Amaç: Back Test'teki tek-geçiş/caching mantığını diğer ağır menülere de yaymak.
 * Çalışan ODS, klasör, sonuç güncelleme ve kupon fonksiyonlarına dokunmaz.
 */
(function(global){
  'use strict';

  const VERSION='V1.1.333_SHARED_GOLD_TEK';
  const UI_DEADLINE_MS=15000;
  const renderCache=new Map();
  const renderInFlight=new Map();
  // Sistem paneli canlı ölçüm gösterir; HTML önbelleğine alınırsa tıklama/render
  // kayıtları değişse bile eski tablo ekranda kalır. Bu nedenle ucuz olan Sistem
  // renderer'ı her açılışta yeniden çalışır.
  const HEAVY_PANES=new Set(['advice','rules','analytics','data','files','profit','backtest','learning']);
  const _paneRenderGeneration=new Map();

  function arr(v){ return Array.isArray(v) ? v : []; }
  function currentDb(){ try { return (typeof db!=='undefined' && db) ? db : global.db; } catch(_){ return global.db; } }
  function coreDataSignature(){
    const d=currentDb() || {};
    const persisted=String(d?.learning_state?.dataset_signature||'');
    const outcome=String(d?.learning_state?.outcome_signature||'');
    return ['CORE3',persisted,outcome,arr(d.files).length,arr(d.races).length].join('|');
  }
  function tailStamp(rows, fields=[]){
    const list=arr(rows), last=list.length?list[list.length-1]:null;
    return [list.length,...fields.map(key=>String(last?.[key]??''))].join(':');
  }
  function paneSignature(name){
    const d=currentDb() || {};
    const core=coreDataSignature();
    try{
      if(name==='analytics'&&typeof global.tkpAnalyticsCacheSignature==='function')return VERSION+'|analytics|'+global.tkpAnalyticsCacheSignature();
      if(name==='learning'&&typeof global.tkpLearningCacheSignature==='function')return VERSION+'|learning|'+global.tkpLearningCacheSignature();
      if(name==='profit'&&typeof global.tkpProfitSignature==='function')return VERSION+'|profit|'+global.tkpProfitSignature();
    }catch(_){ }
    if(name==='advice'||name==='rules'){
      const settings=d?.settings||{},rule=d?.learning_state?.rule_cache||{};
      return [VERSION,name,core,String(rule?.dataset_signature||''),settings.best_min_single,settings.perfect_min_single,settings.perfect_min_rate,settings.perfect_min_lb,settings.max_rule_size].join('|');
    }
    if(name==='backtest'){
      return [VERSION,name,core,Number(d?.settings?.backtest_snapshot_revision)||0,tailStamp(d?.auto_coupon_log,['created_at','id']),tailStamp(d?.prediction_log,['ts','resolved'])].join('|');
    }
    if(name==='data'||name==='files')return [VERSION,name,core].join('|');
    return [VERSION,name,core].join('|');
  }
  function paneControlSignature(name){
    const pane=document.getElementById('pane-'+name);
    if(!pane) return '';
    const controls=[...pane.querySelectorAll('input,select,textarea')].slice(0,40).map(el=>{
      const id=el.id||el.name||el.type||'';
      const value=el.type==='checkbox' ? (el.checked?'1':'0') : String(el.value||'');
      return id+'='+value;
    }).join('&');
    return controls;
  }
  function paneHasContent(name){
    const pane=document.getElementById('pane-'+name);
    if(!pane) return false;
    if(pane.dataset.tkpDomEvicted==='1') return false;
    if(name==='data') return !!document.querySelector('#dataTable table');
    if(name==='files') return !!document.querySelector('#filesTable table');
    if(name==='analytics'){
      // Özet kartı hemen çizilir, alt tablolar boş zamanda tamamlanır. Yarım kalmış
      // bir ekranı cache isabeti sayarsak sekmeye dönüldüğünde "Hesaplanıyor…"
      // kutuları sonsuza kadar kalır. Tüm bekleme işaretleri bitmeden cache kullanma.
      const pane=document.getElementById('pane-analytics');
      const required=['surfaceTable','breedTable','hippoTable','conditionTable','conditionRankTable','agfRankTableEl','distanceTable','valueTable','signalPerfTable','hippoSignalTable','accurateSpeedTable','xKulisAnalysisTable','kulvarTable','adaptiveLearningTable'];
      return !!pane && !pane.querySelector('[data-analytics-pending="1"],.tkpAnalyticsPending')
        && required.every(id=>{
          const el=document.getElementById(id);
          return !el || !!el.querySelector('tbody tr, .empty:not([data-analytics-pending="1"]):not(.tkpAnalyticsPending), .card:not(.tkpAnalyticsPending)');
        });
    }
    if(name==='rules') return !!document.querySelector('#bestTable table, #perfectTable table, #allRulesTable table');
    if(name==='profit') return !!document.querySelector('#profitSummary .card, #betsTable table');
    // FIX (V1.1.212 — "sistem beklemede kalıyor"): showInstantShell() eklediği
    // "Yükleniyor…" göstergesi de class="card" taşıyor. Kullanıcı sekme
    // değiştirirken run() erken çıkarsa (aşağıya bkz.) bu kart DOM'da kalabiliyordu
    // ve bu genel kontrol onu GERÇEK içerik sanıp cache'i "dolu" işaretliyordu --
    // sekmeye dönüldüğünde donuk "Yükleniyor…" sonsuza kadar görünüyordu. Bekleme
    // kartı artık "gerçek içerik" sayılmaz.
    return !!pane.querySelector('.tableWrap, .card:not(.tkpRocketPending), .grid, table');
  }
  function runMeasured(name,fn){
    const start=(global.performance&&performance.now)?performance.now():Date.now();
    let error=null,result;
    const record=()=>{
      if(typeof global.tkpRecordPerformance==='function'){
        try{ global.tkpRecordPerformance('pane:'+name,start,error); }catch(_){ }
      }
    };
    try{
      // Hızlı menü katmanı aktifken app-controller'ın fallback ölçeri çalışmaz.
      // Gerçek renderer'ı burada ölçerek iki yolun da aynı profiler'a yazmasını sağla.
      result=typeof global.tkpMeasureRender==='function'
        ? global.tkpMeasureRender(name,fn)
        : fn();
    }
    catch(e){ error=e; record(); throw e; }
    // Asenkron paneli Promise oluşturulduğu anda değil, gerçek içerik tamamlandığı
    // anda ölç. Böylece Sistem ekranındaki darboğaz süresi yanıltıcı 0-1 ms olmaz.
    if(result&&typeof result.then==='function')return Promise.resolve(result).catch(e=>{error=e;throw e;}).finally(record);
    record();return result;
  }

  function paneIsActive(name){
    const pane=document.getElementById('pane-'+name);
    return !!pane && pane.classList.contains('active');
  }
  function showInstantShell(name){
    const pane=document.getElementById('pane-'+name);
    if(!pane || paneHasContent(name) || pane.querySelector('.tkpRocketPending')) return;
    const shell=document.createElement('div');
    shell.className='card tkpRocketPending';
    shell.setAttribute('data-rocket-pending','1');
    shell.style.cssText='padding:7px 10px;margin:6px 0;border-left:3px solid #64748b;font-size:11px;';
    shell.textContent='Yükleniyor…';
    pane.insertBefore(shell,pane.firstChild);
  }
  function clearInstantShell(name){
    const pane=document.getElementById('pane-'+name);
    if(pane) pane.querySelectorAll('.tkpRocketPending').forEach(node=>node.remove());
  }
  function clearDeadlineNotice(name){
    const pane=document.getElementById('pane-'+name);
    if(pane)pane.querySelectorAll('.tkpPaneDeadlineNotice').forEach(node=>node.remove());
  }
  function showDeadlineNotice(name){
    const pane=document.getElementById('pane-'+name);
    if(!pane||!paneIsActive(name))return;
    clearInstantShell(name);clearDeadlineNotice(name);
    const note=document.createElement('div');
    note.className='card tkpPaneDeadlineNotice';
    note.style.cssText='padding:7px 10px;margin:6px 0;border-left:3px solid #2563eb;font-size:11px;';
    note.textContent='Bu ekranın ağır hesabı arka planda tamamlanıyor; diğer menüler kullanılabilir.';
    pane.insertBefore(note,pane.firstChild);
  }
  function scheduleHeavyRender(name,fn,baseSig){
    const requestedSig=baseSig+'|'+paneControlSignature(name);
    const existing=renderInFlight.get(name);
    if(existing && existing.sig===requestedSig){
      showInstantShell(name);
      return {deferred:true,inFlight:true,name,promise:existing.promise};
    }
    const generation=(_paneRenderGeneration.get(name)||0)+1;
    _paneRenderGeneration.set(name,generation);
    showInstantShell(name);
    const run=async()=>{
      // FIX (V1.1.212): Eskiden bu erken çıkış clearInstantShell()'i HİÇ çağırmıyordu --
      // kullanıcı sekmeyi hızlı değiştirince (çok yaygın kullanım deseni) "Yükleniyor…"
      // kartı DOM'da öksüz kalıp donuk görünüyordu ("sistem beklemede kalıyor"). Artık
      // her erken çıkışta da kart temizlenir; yalnız üretilmiş sonuç/cache kaydı atlanır.
      if(_paneRenderGeneration.get(name)!==generation || !paneIsActive(name)){ clearInstantShell(name); return; }
      const pane=document.getElementById('pane-'+name);
      if(pane)delete pane.dataset.tkpDomEvicted;
      const start=(global.performance&&performance.now)?performance.now():Date.now();
      let result,error=null;
      let deadlineTimer=0;
      try{
        deadlineTimer=setTimeout(()=>showDeadlineNotice(name),UI_DEADLINE_MS);
        result=runMeasured(name,fn);
        if(result&&typeof result.then==='function') result=await result;
        return result;
      }
      catch(e){error=e;throw e;}
      finally{
        if(deadlineTimer)clearTimeout(deadlineTimer);
        const end=(global.performance&&performance.now)?performance.now():Date.now();
        clearInstantShell(name);clearDeadlineNotice(name);
        if(!error&&_paneRenderGeneration.get(name)===generation&&paneIsActive(name)){
          const storedSig=baseSig+'|'+paneControlSignature(name);
          renderCache.set(name,{sig:storedSig,at:Date.now(),durationMs:Math.round((end-start)*10)/10});
          while(renderCache.size>24) renderCache.delete(renderCache.keys().next().value);
        }
      }
    };
    // Önce tarayıcı aktif sekmeyi boyasın. Ağır renderer ancak sonraki frame'de başlar.
    let startRun;
    const started=new Promise(resolve=>{startRun=resolve;});
    const launch=()=>startRun(run());
    if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=>setTimeout(launch,0));
    else setTimeout(launch,0);
    let promise;
    promise=started.finally(()=>{if(renderInFlight.get(name)?.promise===promise)renderInFlight.delete(name);});
    renderInFlight.set(name,{sig:requestedSig,promise,generation});
    return {deferred:true,name,promise};
  }

  global.tkpFastPaneRender=function(name,fn){
    if(typeof fn!=='function') return undefined;
    if(typeof global.tkpRestoreTopTabs==='function') global.tkpRestoreTopTabs();
    const baseSig=paneSignature(name);
    const sig=baseSig+'|'+paneControlSignature(name);
    const cached=renderCache.get(name);
    if(HEAVY_PANES.has(name) && cached && cached.sig===sig && paneHasContent(name)){
      return {cached:true,name,durationMs:cached.durationMs};
    }
    if(HEAVY_PANES.has(name)) return scheduleHeavyRender(name,fn,baseSig);
    const start=(global.performance&&performance.now)?performance.now():Date.now();
    const result=runMeasured(name,fn);
    const end=(global.performance&&performance.now)?performance.now():Date.now();
    const storedSig=baseSig+'|'+paneControlSignature(name);
    renderCache.set(name,{sig:storedSig,at:Date.now(),durationMs:Math.round((end-start)*10)/10});
    while(renderCache.size>24) renderCache.delete(renderCache.keys().next().value);
    return result;
  };

  global.tkpClearPaneRenderCache=function(){ renderCache.clear(); _paneRenderGeneration.clear(); renderInFlight.clear(); };
  global.TKP_MENU_UI_DEADLINE_MS=UI_DEADLINE_MS;
  global.tkpPaneRenderCacheInfo=function(){ return {version:VERSION,size:renderCache.size,keys:[...renderCache.keys()]}; };
  global.addEventListener && global.addEventListener('tkp:db-changed',event=>{
    const detail=event?.detail||{};
    // R16.36: Her saveDB() artık bütün ağır menüleri körlemesine geçersiz kılmaz.
    // Pane anahtarları kendi veri alanlarına bağlıdır; prediction/kupon/tanı gibi
    // küçük arka plan kayıtları Analiz ve İleri Takip'i yeniden taratamaz.
    if(detail.rollback||detail.learningChanged||detail.resultsChanged||detail.outcomeChanged){
      renderCache.clear();
      return;
    }
    if(detail.backtestChanged||detail.couponSnapshotChanged)renderCache.delete('backtest');
    const cols=Array.isArray(detail.collections)?detail.collections:[];
    if(cols.includes('bets'))renderCache.delete('profit');
    if(cols.some(x=>['files','races'].includes(x))){for(const name of ['data','files','analytics','advice','rules','learning'])renderCache.delete(name);}
    if(cols.some(x=>['forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','surprise_cohort_tracking_log','bomb_hunter_shadow_log'].includes(x)))renderCache.delete('learning');
  });
})(window);
