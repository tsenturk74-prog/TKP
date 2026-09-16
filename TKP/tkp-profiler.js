/**
 * tkp-profiler.js — Sistem Sağlığı paneli
 *
 * Sadece okur/raporlar. Tahmin, kupon, ODS veya kayıt mantığına müdahale etmez.
 */
(function(global){
  'use strict';
  const profiler = { renders:[], startedAt:new Date().toISOString() };
  function currentDb(){ try { return (typeof db !== 'undefined' && db) ? db : global.db; } catch(_){ return global.db; } }
  function e(v){ try { return typeof esc==='function' ? esc(v) : String(v??''); } catch(_){ return String(v??''); } }
  function fmt(v){ return Number.isFinite(Number(v)) ? Math.round(Number(v)*10)/10 : 0; }
  function shortTime(value){
    const raw=String(value||'');
    const date=new Date(raw);
    if(!raw||Number.isNaN(date.getTime()))return raw||'-';
    return date.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function bytesText(n){
    n=Number(n)||0;
    if(n<=0) return 'henüz ölçülmedi';
    if(n>1024*1024) return fmt(n/1024/1024)+' MB';
    if(n>1024) return fmt(n/1024)+' KB';
    return n+' B';
  }
  function tkpMeasureRender(name, fn){
    const start=(global.performance&&performance.now)?performance.now():Date.now();
    let finished=false;
    const finish=()=>{
      if(finished)return;finished=true;
      const ms=((global.performance&&performance.now)?performance.now():Date.now())-start;
      profiler.renders.push({name, ms:fmt(ms), at:new Date().toISOString()});
      if(profiler.renders.length>60) profiler.renders.splice(0,profiler.renders.length-60);
      try{ global.tkpRefreshPerformancePanel?.(); }catch(_){ }
    };
    try {
      const result=fn();
      if(result&&typeof result.then==='function')return Promise.resolve(result).finally(finish);
      finish();return result;
    } catch(error){finish();throw error;}
  }
  function dbBytes(){
    try{
      if(typeof global.tkpStoredDbBytes==='function'){
        const cached=Number(global.tkpStoredDbBytes());
        if(cached>0) return cached;
      }
    }catch(_){ }
    // HIZ: Sistem sekmesine tıklamak 15+ MB DB'yi JSON.stringify ederek ana thread'i
    // yüzlerce ms/saniyeler boyunca kilitlememeli. Kalıcı motor henüz boyut vermediyse
    // kesin olmayan pahalı ölçüm yerine 0 döndür; sonraki kayıt sonrası gerçek değer gelir.
    return 0;
  }
  function storageMode(){
    try { return typeof persistenceStatus==='function' ? persistenceStatus().mode : '-'; }
    catch(_){ return '-'; }
  }
  function storageModeShort(raw){
    const value=String(raw||'-').toLocaleLowerCase('tr-TR');
    if(value.includes('segment'))return 'IndexedDB V2';
    if(value.includes('indexed'))return 'IndexedDB';
    if(value.includes('local'))return 'Yerel kayıt';
    return raw||'-';
  }
  function row(label,value,detail){ return `<tr><td><b>${e(label)}</b></td><td>${e(value)}</td><td class="muted">${e(detail||'')}</td></tr>`; }
  function fold(title,badge,body){
    return `<details class="card tkpSystemFold" open><summary><span>${e(title)}</span><b>${e(badge||'Ayrıntı')}</b></summary><div class="tkpSystemFoldBody">${body}</div></details>`;
  }
  function tkpPerformancePanelHTML(){
    const ix=typeof global.tkpGetIndexes==='function' ? global.tkpGetIndexes() : null;
    const summary=ix?.summary || {files:(currentDb()?.files||[]).length,races:(currentDb()?.races||[]).length,horses:0,winners:0,resultRaces:0,bets:(currentDb()?.bets||[]).length};
    const metrics=typeof global.tkpGetPerformanceMetrics==='function' ? global.tkpGetPerformanceMetrics().slice(-12).reverse() : [];
    const renders=profiler.renders.slice(-12).reverse();
    const metricRows=metrics.map(m=>`<tr><td>${e(m.name)}</td><td class="num">${e(m.durationMs)} ms</td><td>${e(m.error||'OK')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Henüz ölçüm yok.</td></tr>';
    const renderRows=renders.map(m=>`<tr><td>${e(m.name)}</td><td class="num">${e(m.ms)} ms</td><td title="${e(m.at)}">${e(shortTime(m.at))}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Henüz render ölçümü yok.</td></tr>';
    const cacheMetrics = typeof global.tkpGetPerformanceCacheInfo==='function' ? global.tkpGetPerformanceCacheInfo() : null;
    const speed=typeof global.tkpGetSpeedRuntime==='function'?global.tkpGetSpeedRuntime():null;
    const recentClicks=(speed?.clicks||[]).slice(-6).reverse();
    const recentLong=(speed?.longTasks||[]).slice(-6).reverse();
    const recentStalls=(speed?.eventLoopStalls||[]).slice(-6).reverse();
    const recentActions=(speed?.actions||[]).slice(-6).reverse();
    const recentTasks=(speed?.tasks||[]).slice(-6).reverse();
    const recentSla=(speed?.slowOperations||[]).slice(-8).reverse();
    const speedSummary=speed?.summary||{};
    const queue=typeof global.tkpQueueInfo==='function'?global.tkpQueueInfo():null;
    const jobs=typeof global.tkpActiveJobs==='function'?global.tkpActiveJobs():[];
    const clickRows=recentClicks.map(m=>`<tr><td>${e(m.label)}</td><td class="num">${e(m.clickToPaintMs)} ms</td><td title="${e(m.at)}">${e(shortTime(m.at))}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Henüz tıklama ölçümü yok.</td></tr>';
    const longRows=recentLong.map(m=>`<tr><td title="${e(m.startMs)} ms"><b>${e(m.source||'Etiketlenemeyen tarayıcı işi')}</b></td><td class="num">${e(m.durationMs)} ms</td><td>${m.durationMs>=200?'🔴 Uzun blok':'🟠 İzle'}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">50 ms üzeri uzun görev yakalanmadı.</td></tr>';
    const stallRows=recentStalls.map(m=>`<tr><td title="${e(m.at)}">${e(shortTime(m.at))}</td><td class="num">${e(m.delayMs)} ms</td><td>${m.delayMs>=500?'🔴 Kritik':(m.delayMs>=150?'🟠 Yüksek':'🟡')}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">50 ms üzeri event-loop gecikmesi yakalanmadı.</td></tr>';
    const actionRows=recentActions.map(m=>`<tr><td>${e(m.name)}</td><td class="num">${e(m.durationMs)} ms</td><td>${m.timedOut?'🔴 Süre aşıldı':(m.error?'❌ '+e(m.error):(m.budgetExceeded?'🟠 Bütçe aşıldı':'✅'))}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Henüz ölçülen düğme işi yok.</td></tr>';
    const taskRows=recentTasks.map(m=>`<tr><td><b>${e(m.key)}</b></td><td class="num">${e(m.queueWaitMs)} / ${e(m.durationMs)} ms</td><td>${m.error?'❌ '+e(m.error):(m.durationMs>=1200?'🟠 Uzun':'✅')}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">Henüz kuyruk görevi tamamlanmadı.</td></tr>';
    const slaRows=recentSla.map(m=>`<tr><td><b>${e(m.name)}</b><br><span class="muted">${e(m.probableCause||'-')}</span></td><td class="num">${e(m.durationMs)} ms</td><td>${m.severity==='critical'?'🔴 30 sn kritik':m.severity==='breach'?'🟠 25 sn ihlal':'🟡 20 sn izle'}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">20 saniyeyi aşan işlem yok.</td></tr>';
    const rawStorageMode=storageMode();
    return `<div class="tkpSystemHealthCompact"><div class="hero"><h2>🩺 Sistem Sağlığı ve Performans</h2><p>Bu panel sadece ölçer; çalışan ayar, ODS, kupon ve sonuç mantığına dokunmaz.</p></div>
    <div class="grid tkpSystemKpiGrid">
      ${typeof kpiCard==='function' ? kpiCard('Dosya', summary.files) : ''}
      ${typeof kpiCard==='function' ? kpiCard('Koşu', summary.races) : ''}
      ${typeof kpiCard==='function' ? kpiCard('At', summary.horses) : ''}
      ${typeof kpiCard==='function' ? kpiCard('DB boyutu', bytesText(dbBytes())) : ''}
      ${typeof kpiCard==='function' ? kpiCard('Kayıt modu', storageModeShort(rawStorageMode)) : ''}
      ${typeof kpiCard==='function' ? kpiCard('İndeks', ix ? (ix.buildMs+' ms') : '-') : ''}
      ${typeof kpiCard==='function' ? kpiCard('Tıklama p95', fmt(speedSummary.clickP95Ms)+' ms') : ''}
      ${typeof kpiCard==='function' ? kpiCard('En yüksek tıklama', fmt(speedSummary.clickMaxMs)+' ms') : ''}
      ${typeof kpiCard==='function' ? kpiCard('Event-loop tepe', fmt(speedSummary.eventLoopMaxDelayMs)+' ms') : ''}
      ${typeof kpiCard==='function' ? kpiCard('Bütçe aşımı', Number(speedSummary.budgetViolations)||0) : ''}
      ${typeof kpiCard==='function' ? kpiCard('25 sn SLA ihlali', Number(speedSummary.slaBreaches)||0) : ''}
      ${typeof kpiCard==='function' ? kpiCard('30 sn kritik', Number(speedSummary.criticalLatencyBreaches)||0) : ''}
    </div>
    <div class="card tkpSystemProtection"><h2>Koruma katmanları</h2><div class="tableWrap"><table><tbody>
      ${row('İndeks sistemi', ix ? 'AKTİF' : 'PASİF', 'db.files/db.races tekrar taramalarını azaltır')}
      ${row('Panel cache', cacheMetrics ? `${cacheMetrics.htmlCache} HTML / ${cacheMetrics.promiseCache} iş` : 'AKTİF', 'Back Test ve yan bahis HTML tekrarlarını azaltır')}
      ${row('Büyük tablo koruması', typeof global.tkpDataTableHTML==='function' ? 'AKTİF' : 'PASİF', 'Veri denetimi ve dosya tablolarında DOM şişmesini azaltır')}
      ${row('Worker uygunluğu', global.Worker ? 'Tarayıcı destekliyor' : 'Destek yok', 'Ağır işleri ileride tamamen arka iş parçacığına taşımaya hazır')}
      ${row('Görev kuyruğu', queue ? `${queue.queued} bekliyor / ${queue.current?.key||'boş'}` : '-', 'USER işleri arka plan işlerinden önce yürür')}
      ${row('Cooperative işler', `${jobs.length} etkin`, jobs.map(j=>`${j.name} ${j.processed}/${j.total||'?'}`).join(' · ')||'Etkin ağır iş yok')}
    </tbody></table></div></div>
    <div class="tkpSystemDiagGrid">
      <div class="tkpSystemDiagTriplet">
        ${fold('Gerçek tıklama → boya gecikmesi',`${recentClicks.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>Tuş / menü</th><th class="num">Gecikme</th><th>Zaman</th></tr></thead><tbody>${clickRows}</tbody></table></div>`)}
        ${fold('Ana thread uzun görevleri',`${recentLong.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>İş / kaynak</th><th class="num">Blok süresi</th><th>Durum</th></tr></thead><tbody>${longRows}</tbody></table></div>`)}
        ${fold('Event-loop gecikmeleri',`${recentStalls.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>Zaman</th><th class="num">Gecikme</th><th>Durum</th></tr></thead><tbody>${stallRows}</tbody></table></div>`)}
      </div>
      <div class="tkpSystemDiagPair tkpSystemDiagPairTasks">
        ${fold('20 / 25 / 30 sn gecikme ihlalleri',`${recentSla.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>İş / olası neden</th><th class="num">Süre</th><th>Durum</th></tr></thead><tbody>${slaRows}</tbody></table></div>`)}
        ${fold('Kuyruk görev süreleri',`${recentTasks.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>Görev</th><th class="num">Bekleme / çalışma</th><th>Durum</th></tr></thead><tbody>${taskRows}</tbody></table></div>`)}
        ${fold('Düğme işlem süreleri',`${recentActions.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>İşlem</th><th class="num">Toplam süre</th><th>Durum</th></tr></thead><tbody>${actionRows}</tbody></table></div>`)}
      </div>
      <div class="tkpSystemDiagPair tkpSystemDiagPairMetrics">
        ${fold('Son ağır panel ölçümleri',`${metrics.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>İş</th><th class="num">Süre</th><th>Durum</th></tr></thead><tbody>${metricRows}</tbody></table></div>`)}
        ${fold('Son ekran render ölçümleri',`${renders.length} kayıt`,`<div class="tableWrap"><table class="tkpSystemDiagTable"><thead><tr><th>Menü</th><th class="num">Süre</th><th>Zaman</th></tr></thead><tbody>${renderRows}</tbody></table></div>`)}
      </div>
    </div></div>`;
  }
  global.tkpMeasureRender = tkpMeasureRender;
  global.tkpPerformancePanelHTML = tkpPerformancePanelHTML;
})(window);
