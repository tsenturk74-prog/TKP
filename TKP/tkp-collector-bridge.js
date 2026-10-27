function tkpYpuanPolicyRequiresImport(record,files){
 const policy=typeof TKP_YPUAN_POLICY==='string'?TKP_YPUAN_POLICY:'R16.83_INDEPENDENT_TOTAL';
 const hasReady=(files||[]).some(f=>['misli','hipodrom','bitalih','editor','atyarisi','liderform'].includes(String(f?.source||'')));
 return hasReady&&record?.ypuan_policy!==policy;
}
function tkpMisliImportSummary(job,payload){
 const report=payload?.ypuan_import_report;
 const norm=v=>String(v||'').trim().toLocaleUpperCase('tr-TR');
 const same=report&&String(report.date)===String(job?.meeting?.date)&&norm(report.hippodrome)===norm(job?.meeting?.hippodrome);
 if(!same){
  const files=Number(job?.quality?.bySource?.misli)||0;
  return files?'Misli dosyası geldi; Y.PUAN eşleşmesi doğrulanmadı':'Misli verisi alınamadı';
 }
 const files=(report.files||[]).filter(f=>f.source==='misli');
 if(!files.length)return 'Misli: bu aktarımda dosya yok';
 const parsed=files.reduce((n,f)=>n+(Number(f.parsed)||0),0),matched=files.reduce((n,f)=>n+(Number(f.matched)||0),0);
 const legs=(report.races||[]).filter(r=>Number(r.sourceCounts?.MISLI)>0).length;
 return `Misli: ${parsed} kart okundu, ${matched} kart eşleşti · Y.PUAN ${legs}/${payload?.races?.length||6} ayak${files.some(f=>f.error)?' · okuma hatası var':''}`;
}
(function(){
 // Geriye dönük oturum etiketi: Bi'Talih Oturumunu Aç
 // Collector tarafından HTTP(S) üzerinden sunuluyorsak API aynı süreç/origin'dedir.
 // Sabit 3762, alternatif portta açılan UI'yi yanlış/eski bir Collector'a bağlıyordu.
 const API=/^https?:$/i.test(location.protocol)?location.origin:'http://127.0.0.1:3762';
 const $=s=>document.querySelector(s);
 let activeJobId='',activePollTimer=null,stopRequested=false,busy=false;
 // V1.1.317: Tarihsel sonuç/destek taramasında her toplantı sonrası aktif sekmeyi
 // çizmek, 500+ toplantılık arşivde aynı ağır tabloları tekrar tekrar çalıştırıp
 // Chromium'u "Sayfa yanıt vermiyor" durumuna sokuyordu. Mutasyonlar ve checkpoint
 // kayıtları toplantı bazında sürer; yalnız görünüm tek kez, iş bitince çizilir.
 let tkpcHistoricalMaintenanceDepth=0,tkpcHistoricalRenderTimer=0;
 function tkpcBeginHistoricalMaintenance(){
  tkpcHistoricalMaintenanceDepth++;
  window.__tkpHistoricalMaintenanceActive=true;
 }
 function tkpcScheduleHistoricalRender(){
  if(tkpcHistoricalRenderTimer)return;
  const run=()=>{
   tkpcHistoricalRenderTimer=0;
   if(window.__tkpHistoricalMaintenanceActive===true){window.__tkpHistoricalRenderPending=true;return;}
   window.__tkpHistoricalRenderPending=false;
   try{if(typeof renderActivePane==='function')renderActivePane();}catch(error){console.warn('Tarihsel güncelleme sonrası görünüm uyarısı',error);}
  };
  if(typeof tkpRunWhenUserIdle==='function')tkpRunWhenUserIdle(run,{minIdleMs:300,retryMs:120,maxWaitMs:2000});
  else tkpcHistoricalRenderTimer=setTimeout(run,0);
 }
 function tkpcEndHistoricalMaintenance(){
  tkpcHistoricalMaintenanceDepth=Math.max(0,tkpcHistoricalMaintenanceDepth-1);
  if(tkpcHistoricalMaintenanceDepth>0)return;
  window.__tkpHistoricalMaintenanceActive=false;
  tkpcScheduleHistoricalRender();
 }
 window.tkpCollectorIsBusy=()=>Boolean(activeJobId||window.__tkpCollectorImportActive===true||window.__tkpTjkFinalRunning===true||window.__tkpTipsterFinalRunning===true);
 let activeImportJobId='',activeImportPromise=null;
 // File.lastModified is user-controlled and cannot prove a pre-race capture.
 // Keep collector metadata in a WeakMap tied to the exact File object instead.
 const tkpcCollectorFileProvenance=new WeakMap();
 function tkpcIsoTime(value){const ms=Date.parse(String(value||''));return Number.isFinite(ms)?new Date(ms).toISOString():'';}
 function tkpcCollectorProvenance(raw){
  const source=String(raw?.source||'').trim().toLowerCase(),sha=String(raw?.sha256||'').trim().toLowerCase();
  const captured=tkpcIsoTime(raw?.capturedAt||raw?.downloadedAt),raceStart=tkpcIsoTime(raw?.raceStartAt);
  if(!source||!/^([a-f0-9]{64})$/.test(sha)||!captured)return null;
  return Object.freeze({version:1,source,source_id:`collector:${source}:${sha}`,sha256:sha,captured_at:captured,
   race_start_at:raceStart,source_url:String(raw?.url||'').slice(0,2048),phase:String(raw?.phase||'pre_race'),immutable_snapshot:raw?.immutableSnapshot===true});
 }
 function tkpcRememberCollectorProvenance(file,raw){
  const provenance=tkpcCollectorProvenance(raw);if(provenance&&file)tkpcCollectorFileProvenance.set(file,provenance);return file;
 }
 // race-data.js reads this only for File objects created by this bridge.  Manual
 // uploads deliberately have no entry and therefore cannot become live evidence.
 window.tkpCollectorFileProvenance=file=>tkpcCollectorFileProvenance.get(file)||null;
 function tkpcTurkeyToday(now=new Date()){
  try{
   const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
   const get=t=>parts.find(p=>p.type===t)?.value||'';
   const y=get('year'),m=get('month'),d=get('day');
   if(y&&m&&d)return `${y}-${m}-${d}`;
  }catch{}
  const local=new Date(now.getTime()-now.getTimezoneOffset()*60000);return local.toISOString().slice(0,10);
 }
 function credentialRow(site,label){
  const hint='TKP şifre kaydetmez. Görünür tarayıcıda giriş yap; yerel şifrelenmiş oturum korunur.';
  return `<div data-credential-site="${site}" style="display:flex;flex-wrap:wrap;gap:7px;align-items:center;padding:7px;background:#f8fafc;border-radius:7px"><b style="min-width:92px">${label}</b><button type="button" class="tkpcCredOpen" title="${label} HTML oturumunu aç" style="font-weight:800;background:#dcfce7;border-color:#16a34a">HTML Aç</button><span class="tkpcCredState" style="font-size:11px;color:#475569">${hint}</span></div>`;
 }
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function currentDb(){try{return typeof db!=='undefined'&&db?db:(window.db||null);}catch{return window.db||null;}}
 const TKPC_DOMESTIC_ORDER=['ADANA','ANKARA','ANTALYA','BURSA','DIYARBAKIR','ELAZIG','ISTANBUL','IZMIR','KOCAELI','SANLIURFA'];
 // Günlük toplayıcı bu listeyi kullanmaz. Geçmişte TJK programı ve GC birincil
 // katmanları eksikse, ikinci turda yalnız aynı koşunun Yeni Beygir GLP/J-BYG
 // sayfası yedek olarak istenir. Yeni Beygir'den program/TR/sonuç/yorumcu alanı
 // kesinlikle alınmaz.
 const TKPC_HISTORICAL_PRIMARY_SUPPORT_SOURCES=Object.freeze(['tjk_program','ganyan_canavari','ganyan_canavari_glp','ganyan_canavari_jbyg']);
 const TKPC_HISTORICAL_FALLBACK_SUPPORT_SOURCES=Object.freeze(['yenibeygir_glp','yenibeygir_jbyg']);
 const TKPC_HISTORICAL_SUPPORT_SOURCES=Object.freeze([...TKPC_HISTORICAL_PRIMARY_SUPPORT_SOURCES,...TKPC_HISTORICAL_FALLBACK_SUPPORT_SOURCES]);
 function tkpcNormalizeHip(v){return String(v||'').trim().toLocaleUpperCase('tr-TR').replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C');}
 function tkpcDisplayHip(v){const k=tkpcNormalizeHip(v);const m={DIYARBAKIR:'DİYARBAKIR',ELAZIG:'ELAZIĞ',ISTANBUL:'İSTANBUL',IZMIR:'İZMİR',KOCAELI:'KOCAELİ',SANLIURFA:'ŞANLIURFA'};return m[k]||String(v||'').trim();}
 function tkpcChooseTodayHip(current,meetings){
  const list=[...new Set((meetings||[]).map(tkpcNormalizeHip).filter(x=>TKPC_DOMESTIC_ORDER.includes(x)))];
  const cur=tkpcNormalizeHip(current);
  return cur&&list.includes(cur)?cur:(list[0]||'');
 }
 async function tkpcSyncTodayDomesticMeetings({force=false}={}){
  const date=$('#tkpcDate')?.value||'',hipInput=$('#tkpcHip'),listEl=$('#tkpcHipList');
  if(!date||!hipInput)return {ok:false,meetings:[]};
  const previous=String(hipInput.value||'').trim();
  const loadedFallback=(()=>{try{
    const rows=Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races:(typeof activeRaces==='function'?activeRaces():[]);
    const same=(rows||[]).find(r=>String(r?.race_date||'')===date&&r?.hippodrome);
    return same?String(same.hippodrome||''):'';
  }catch{return '';}})();
  // Aktif tahmin kaydı varsa onun hipodromu manuel alandaki eski değerden
  // önceliklidir. Böylece yeni İstanbul kaydı açıldığında önceki ADANA seçimi
  // toplama hedefini yanlış yönlendiremez.
  const fallback=loadedFallback||previous;
  const manualForeign=['SARATOGA','DEL MAR','SANTA ANITA','GULFSTREAM PARK','KEENELAND','PARX RACING','DELAWARE PARK','HORSESHOE INDIANAPOLIS','FINGER LAKES','WOODBINE','CLUB HIPICO SANTIAGO'];
  try{
   const r=await fetch(API+'/api/v1/tjk/domestic-meetings?date='+encodeURIComponent(date),{cache:'no-store'});const j=await r.json();
   if(!r.ok||!j.ok||j.verified===false)throw new Error(j.error||'TJK toplantı listesi doğrulanamadı');
   const meetings=(j.meetings||[]).map(tkpcNormalizeHip).filter(x=>TKPC_DOMESTIC_ORDER.includes(x));
   if(listEl)listEl.innerHTML=[...meetings,...manualForeign].map(x=>`<option value="${esc(tkpcDisplayHip(x))}"></option>`).join('');
   const chosen=meetings.length?tkpcChooseTodayHip(force?'':fallback,meetings):tkpcNormalizeHip(fallback);
   hipInput.value=tkpcDisplayHip(chosen||fallback);
   if(!meetings.length)status('⚠️ TJK yerli toplantı listesi boş geldi; mevcut/manuel hipodrom seçimi korundu.');
   return {ok:true,verified:true,meetings,chosen:hipInput.value};
  }catch(e){
   // Ağ/TJK/parser sorunu, kullanıcının doğru manuel seçimini artık silmez.
   if(listEl)listEl.innerHTML=manualForeign.map(x=>`<option value="${esc(x)}"></option>`).join('');
   hipInput.value=tkpcDisplayHip(fallback);
   status(`⚠️ TJK toplantıları doğrulanamadı; ${fallback?'mevcut hipodrom korundu':'hipodromu elle seçebilirsin'}. Veri toplama düğmeleri kullanılabilir.`);
   return {ok:false,verified:false,meetings:[],chosen:hipInput.value,error:String(e?.message||e)};
  }
 }
 window.__tkpcChooseTodayHip=tkpcChooseTodayHip;
 window.tkpcSyncTodayDomesticMeetings=tkpcSyncTodayDomesticMeetings;
 function addPanel(){
  if($('#tkpCollectorPanel'))return;
  const host=$('#predictionResult')?.parentElement||$('#tkpRoot')||document.body;
  const el=document.createElement('section');el.id='tkpCollectorPanel';el.className='card';el.style.cssText='border-left:4px solid #0f766e;margin:8px 0;padding:10px;background:#f8fffd;color:#102a2a';
  el.innerHTML=`<h3 style="margin:0 0 8px;font-size:15px">🌐 TKP Otomatik Veri Toplayıcı</h3>
  <div style="display:flex;flex-wrap:wrap;gap:7px;align-items:end">
    <label>Tarih<br><input id="tkpcDate" type="date"></label>
    <label>Hipodrom<br><input id="tkpcHip" list="tkpcHipList" type="text" value="" style="width:170px" placeholder="TJK bugünkü pist"><datalist id="tkpcHipList"><option>ANKARA</option><option>BURSA</option><option>İSTANBUL</option><option>İZMİR</option><option>ADANA</option><option>KOCAELİ</option><option>ELAZIĞ</option><option>ŞANLIURFA</option><option>DİYARBAKIR</option><option>ANTALYA</option><option>SARATOGA</option><option>DEL MAR</option><option>SANTA ANITA</option><option>GULFSTREAM PARK</option><option>KEENELAND</option><option>PARX RACING</option><option>DELAWARE PARK</option><option>HORSESHOE INDIANAPOLIS</option><option>FINGER LAKES</option><option>WOODBINE</option><option>CLUB HIPICO SANTIAGO</option></datalist></label>
    <label>Koşular<br><b style="display:inline-block;padding:7px 9px;border:1px solid #99c9bf;border-radius:7px;background:#fff">2. Altılı · gerçek 6 koşu</b></label>
  </div>
  <style id="tkpcCompactActionStyle">
    #tkpCollectorPanel .tkpcActionRow{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;align-items:stretch;overflow:visible;padding-bottom:3px}
    #tkpCollectorPanel .tkpcActionRow button{flex:1 1 128px;min-width:104px;min-height:40px;padding:6px 7px;font-size:11px;line-height:1.18;border-radius:7px;white-space:normal;word-break:break-word}
  </style>
  <div class="tkpcActionRow" id="tkpcActionRow">
    <button id="tkpcCollect" type="button" style="font-weight:700">🌐 Verileri Topla</button>
    <button id="tkpcSimilar" type="button" style="font-weight:700;background:#ede9fe;border-color:#7c3aed;color:#4c1d95">🧠 Benzer Yarış</button>
    <button id="tkpcResult" type="button" style="font-weight:700">🏁 Sonuç Kontrol</button>
    <button id="tkpcHistoricalUpdate" type="button" title="Yalnız eksik resmî sonuç/ikramiye ve Accurate katmanını tamamlar" style="font-weight:800;background:#eef2ff;border-color:#6366f1;color:#312e81">🧩 Eksik Sonuçlar · TJK + Accurate</button>
    <button id="tkpcHistoricalSupportUpdate" type="button" title="Yalnız yardımcı destek katmanları: TR Ganyan Canavarı · GLP Ganyan Canavarı Galoplar Özet · J-BYG Ganyan Canavarı. TJK ve Accurate bu menüde aranmaz." style="font-weight:800;background:#fff7ed;border-color:#f97316;color:#9a3412">🕘 Eksik Veri · Eksik Destek Topla</button>
    <button id="tkpcStop" type="button" disabled style="display:none;font-weight:900;background:#fee2e2;border-color:#dc2626;color:#991b1b">⛔ Durdur</button>
  </div>
  <div style="margin-top:5px;font-size:10.5px;color:#7c2d12"><b>Eski veri politikası:</b> TR Ganyan Canavarı'ndan, GLP yalnız Ganyan Canavarı Galoplar Özet'ten, J-BYG Ganyan Canavarı'ndan alınır. TJK Program yalnız ST/KG/DRC ve program tabanıdır; TJK'den geçmiş GLP/J-BYG alınmaz.</div>
  <details id="tkpcCredentials" style="margin-top:9px;border:1px solid #99c9bf;border-radius:8px;background:#fff;padding:8px">
    <summary style="cursor:pointer;font-weight:800">🔐 Site HTML Oturumları</summary>
    <div style="font-size:11px;margin:6px 0;color:#475569">Bi'Talih, atyarışı.com ve X ayrı kalıcı HTML profili kullanır. TKP kullanıcı adı/şifre almaz; HTML Aç ile giriş yap. Şifre değil, yalnız yerel şifrelenmiş oturum bilgisi sonraki açılışa taşınır.</div>
    <div id="tkpcCredentialRows" style="display:grid;gap:8px">
      ${credentialRow('bitalih',"Bi'Talih")}
      ${credentialRow('editor','atyarışı.com')}
      ${credentialRow('x','X / Twitter')}
    </div>
  </details>
  <details id="tkpcXKulis" style="margin-top:9px;border:1px solid #a5b4fc;border-radius:8px;background:#fff;padding:8px" open>
    <summary style="cursor:pointer;font-weight:800">𝕏 Son Kulis Kontrolü · Manuel</summary>
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-top:8px">
      <label>Güvenilen hesaplar<br><input id="tkpcXHandles" type="text" value="@ingiliz1anahtar" placeholder="@hesap1, @hesap2" style="min-width:260px"></label>
      <label>Kaynak<br><select id="tkpcXSource" disabled><option value="both" selected>Takip Edilenler + Sana Özel + yorumcu sayfaları</option></select></label>
      <label>Uygulama<br><select id="tkpcXMode" disabled><option value="shadow" selected>Yalnız puan / analiz (kilitli)</option></select></label>
      <label>İlk yarış (yedek saat)<br><input id="tkpcXRaceTime" type="time" style="width:105px"></label>
      <button id="tkpcXScan" type="button" style="font-weight:800;background:#111827;color:white">𝕏 Son yorumları tara</button>
      <button id="tkpcXRefresh" type="button" style="font-weight:750;background:#fef3c7;border-color:#d97706;color:#78350f">↻ X'i zorla yenile</button>
    </div>
    <div style="font-size:11px;color:#475569;margin-top:6px">X yalnız bu bölümdeki tarama düğmesine bastığında açılır; otomatik zamanlama kapalıdır. Önce Takip Edilenler, sonra Sana Özel akışı ve güvenilen yorumcu sayfaları taranır. Boşa dönen tek tek at adı X araması kapalıdır; eşleşme toplanan sayfa paylaşımlarında yerel yapılır. Yalnız başlamamış koşular güncellenir; başlamış ayaklara sonradan veri uygulanmaz.</div>
    <div id="tkpcXStatus" style="font-size:12px;margin-top:6px"></div><div id="tkpcXPreview" style="margin-top:8px"></div>
  </details>
  <div id="tkpcSimilarSettings" style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-top:9px;padding:9px;border:1px solid #ddd6fe;border-radius:8px;background:#faf8ff">
    <label>Her ayak için<br><input id="tkpcSimilarCount" type="number" min="10" max="30" value="10" style="width:72px"> yarış</label>
    <label>Minimum benzerlik<br><select id="tkpcSimilarMin"><option value="90">%90</option><option value="80" selected>%80</option><option value="70">%70</option></select></label>
    <span style="font-size:12px;max-width:500px">Yalnız sonuçlanmış ve seçilen tarihten eski yarışlar değerlendirilir. 10 kaliteli yarış bulunmayan ayakta havuz aktive edilmez.</span>
  </div>
  <div id="tkpcStatus" style="margin-top:10px;font-size:13px">Servis kontrol ediliyor…</div>
  <div id="tkpcSimilarPreview" style="display:none;margin-top:10px"></div>`;
  host.insertBefore(el,host.firstChild);installCredentialUi();$('#tkpcDate').value=tkpcTurkeyToday();$('#tkpcDate').addEventListener('change',()=>tkpcSyncTodayDomesticMeetings({force:true}));tkpcSyncTodayDomesticMeetings({force:true});
  const bindMeasuredOperation=(id,name,budgetMs,run)=>{const button=$('#'+id);if(!button)return;button.onclick=()=>{
   const task=async()=>{const started=typeof tkpNow==='function'?tkpNow():performance.now();let failure=null;try{return await run();}catch(error){failure=error;throw error;}finally{try{window.tkpRecordPerformance?.(`collector-total:${name}`,started,failure);}catch(_e){}}};
   // collect() resolves when the job is started; the poller owns completion and
   // setBusy(). A generic promise wrapper would show "done" before files arrive.
   if(!['tkpcCollect','tkpcResult'].includes(id)&&typeof window.tkpRunButtonTask==='function')return window.tkpRunButtonTask(button,'working',task,{silent:true,actionName:name,actionBudgetMs:Math.min(15000,Number(budgetMs)||15000),safetyTimeoutMs:15000,timeoutDetail:'Veri işi arka planda sürüyor',errorDetail:'İşlem tamamlanamadı'});
   const started=typeof tkpNow==='function'?tkpNow():performance.now();let failure=null;return task().catch(error=>{failure=error;throw error;}).finally(()=>{try{window.tkpRecordAction?.(name,started,failure,{budgetMs:Math.min(15000,Number(budgetMs)||15000)});}catch(_e){}});
  };};
  bindMeasuredOperation('tkpcCollect','Tahmin → veri toplama',15000,()=>collect(false));
  bindMeasuredOperation('tkpcResult','Tahmin → sonuç kontrolü',15000,()=>collect(true));
  bindMeasuredOperation('tkpcHistoricalUpdate','Tahmin → eksik sonuç tamamlama',15000,()=>updateAllHistoricalResults());
  bindMeasuredOperation('tkpcHistoricalSupportUpdate','Tahmin → eksik destek toplama',15000,()=>updateAllHistoricalSupportData());
  bindMeasuredOperation('tkpcSimilar','Tahmin → benzer yarış taraması',10000,()=>findSimilarRaces());
  $('#tkpcStop').onclick=stopCollection;
  bindMeasuredOperation('tkpcXScan','Tahmin → kulis taraması',15000,()=>scanXKulis({manual:true}));
  bindMeasuredOperation('tkpcXRefresh','Tahmin → kulis yenileme',15000,()=>scanXKulis({forceRefresh:true,manual:true}));
  // X kulis bölümü kapatıldığında önceki taramanın at listesi yeniden açılışta
  // yanlışlıkla geri gelmemeli. Kapatma, yalnız görünümü değil geçici önizlemeyi
  // de temizler; yeni liste ancak manuel tarama ile oluşur.
  const xKulis=$('#tkpcXKulis');
  if(xKulis)xKulis.addEventListener('toggle',()=>{
   if(xKulis.open)return;
   const preview=$('#tkpcXPreview'),statusEl=$('#tkpcXStatus');
   if(preview)preview.innerHTML='';
   if(statusEl)statusEl.textContent='';
   // Kapatma, yalnız panel görünümünü değil bu taramanın at üzerindeki
   // geçici gölge kayıtlarını da temizlemeli. Aksi halde bölüm yeniden
   // açıldığında eski eşleşmeler tekrar tabloya basılıyordu.
   try{if(typeof window.tkpClearXKulisOverlay==='function')window.tkpClearXKulisOverlay();}catch(_e){}
   try{const settings=typeof getSettings==='function'?getSettings():null;if(settings&&typeof settings==='object')delete settings.x_kulis_last;}catch(_e){}
   try{if(typeof saveDB==='function')saveDB(false,true);}catch(_e){}
  });
  installXKulisSettings();window.__tkpAutoMaintenanceDisabled=true;installIdleMaintenance();health();
 }

 function installCredentialUi(){
  const rows=[...document.querySelectorAll('[data-credential-site]')];
  rows.forEach(row=>{
   const site=row.dataset.credentialSite,openBtn=row.querySelector('.tkpcCredOpen'),state=row.querySelector('.tkpcCredState');
   if(openBtn)openBtn.onclick=async()=>{const siteLabel=site==='bitalih'?"Bi'Talih":site==='x'?'X / Twitter':'atyarışı.com';openBtn.disabled=true;state.textContent=`⏳ ${siteLabel} HTML penceresi açılıyor…`;try{const r=await fetch(API+'/api/v1/credentials/session/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({site})});const j=await r.json();if(!j.ok)throw new Error(j.error||'HTML penceresi açılamadı');if(j.requiresVerification)state.textContent='🔐 Bi\'Talih doğrulama kodu bekliyor. Kodu açık HTML penceresine gir; şifreli oturum kalıcı saklanacak.';else if(j.success)state.textContent='✅ HTML açık; kayıtlı oturum kullanılabilir.';else state.textContent='⚠️ '+(j.reason||'HTML açık. Girişi tamamla; şifreli oturum sonraki açılışa taşınır.');}catch(e){state.textContent='❌ '+e.message;}finally{openBtn.disabled=false;}};
  });
 }

 // Site şifre kasası ve taşınabilir hesap yedeği kaldırıldı. Yalnız tarayıcının
 // kalıcı profil çerezleri ve ayrı X API yayın anahtarı kasası kullanılabilir.

 function installXKulisSettings(){
  for(const id of ['tkpcXHandles','tkpcXSource','tkpcXMode','tkpcXRaceTime']){const e=$('#'+id);if(!e)continue;try{const v=localStorage.getItem('tkp_'+id);if(v)e.value=v;}catch{}e.addEventListener('change',()=>{try{localStorage.setItem('tkp_'+id,e.value);}catch{}});}
  // V1.1.166 HARD MANUAL-X KILIDI:
  // Eski sürümden aynı sekmede kalmış bir X timer kimliği varsa önce kesin olarak durdur.
  // X için hiçbir interval/timeout kurulmaz.
  try{if(window.__tkpXTimer){clearInterval(window.__tkpXTimer);clearTimeout(window.__tkpXTimer);}}catch{}
  window.__tkpXTimer=null;
  try{if(window.__tkpXAutoTimer){clearInterval(window.__tkpXAutoTimer);clearTimeout(window.__tkpXAutoTimer);}}catch{}
  window.__tkpXAutoTimer=null;
  window.__tkpXAutoDisabled=true;
  // Sonuç kontrolü yalnız sonuç katmanıdır. Eski T-40 zamanlayıcısı aynı anda
  // tjk_program açıp J-BYG/antrenör/galop zenginleştirmesine girebiliyordu;
  // kullanıcı "Sonucu Kontrol Et" dediğinde bunun görünmesi yanlıştı.
  // Önceki sekmeden kalmış zamanlayıcıyı da kesin kapat. Program yenileme yalnız
  // açıkça "Verileri Topla" ile yapılır.
  try{if(window.__tkpTjkFinalTimer){clearInterval(window.__tkpTjkFinalTimer);clearTimeout(window.__tkpTjkFinalTimer);}}catch{}
  window.__tkpTjkFinalTimer=null;
  window.__tkpTjkFinalAutoDisabled=true;
 }
 // KULLANICI TALİMATI (2026-08-09): Elle girilen hesap listesi hiç değişmiyordu;
 // öğrenilmiş güven puanı (x_kulis_source_stats) yalnız gelen paylaşımları
 // değerlendirmede kullanılıyor, yeni hesap ÖNERMİYORDU. Artık geçmişte en az
 // 3 paylaşımda doğruluğu ölçülmüş ve güven puanı %55+ olan hesaplar, elle
 // girilenlerin ardına (elle girilenler öncelikli, tekrar etmez) otomatik eklenir.
 // Manuel liste boşsa da toplayıcı tamamen boş hedefle kalmaz.
 function xTrustedHandlesFromHistory(limit=8){
  try{
   const stats=(typeof getSettings==='function'?getSettings():{})?.x_kulis_source_stats||{};
   return Object.keys(stats)
    .map(handle=>({handle,total:Number(stats[handle]?.total)||0,trust:typeof sourceHistory==='function'?sourceHistory(handle):0}))
    .filter(x=>x.handle&&x.total>=3&&x.trust>=55)
    .sort((a,b)=>b.trust-a.trust||b.total-a.total)
    .slice(0,Math.max(0,limit))
    .map(x=>x.handle);
  }catch{return [];}
 }
 function xHandles(){
  const manual=String($('#tkpcXHandles')?.value||'').split(/[,;\s]+/).map(x=>x.replace(/^@/,'').trim()).filter(Boolean);
  const seen=new Set(manual.map(x=>x.toLowerCase()));
  // Kullanıcının yorumcu listesi önceliklidir. Önceki 16 sınırı, 30 civarı
  // yorumcunun son bölümünü daha toplayıcıya gitmeden sessizce atıyordu.
  // Toplayıcı güvenli olarak 32 hesabı işleyebildiğinden aynı üst sınır burada
  // korunur; yalnız eksik kalan yere geçmişte doğrulanmış hesaplar eklenir.
  const auto=xTrustedHandlesFromHistory(Math.max(0,32-manual.length)).filter(h=>!seen.has(String(h).toLowerCase()));
  return manual.concat(auto).slice(0,32);
 }
 function xRaces(){
  const payload=Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races.filter(r=>Array.isArray(r?.horses)&&r.horses.length):[];
  if(payload.length>=1&&payload.length<=20)return payload;
  const rows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];
  return rows.map(x=>x?.r).filter(r=>Array.isArray(r?.horses)&&r.horses.length);
}
 function xRaceDateTime(race,index=0){
  const date=String(race?.race_date||xRaces()?.[0]?.race_date||$('#tkpcDate')?.value||'').slice(0,10);
  const domestic=!isForeignHip(race?.hippodrome||xRaces()?.[0]?.hippodrome||$('#tkpcHip')?.value);
  const raw=String(domestic?(race?.tjk_race_time||''):(race?.race_time||race?.start_time||race?.time||((index===0)?$('#tkpcXRaceTime')?.value:'')||'')).trim();
  const parsed=(raw.match(/(?:^|\s)([0-2]?\d:[0-5]\d)(?:\s|$)/)||[])[1]||raw;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{1,2}:\d{2}$/.test(parsed))return '';
  const time=parsed.padStart(5,'0');
  // TJK yarış saatleri Türkiye yerel saatidir; bilgisayar saat diliminden bağımsız UTC+03.
  const value=new Date(`${date}T${time}:00+03:00`);return Number.isFinite(value.getTime())?value.toISOString():'';
 }
 function xRaceHasResult(race){
  if(!race)return false;
  if(Number(race?.has_confirmed_results)===1||Number(race?.result_confirmed)===1)return true;
  const horses=Array.isArray(race?.horses)?race.horses:[];
  return horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
 }
 function xFutureRaceEntries(){
  const now=Date.now();
  return xRaces().map((race,index)=>({race,index,start:xRaceDateTime(race,index)}))
    // V1.1.101: saat alanı/cache takılı kalsa bile sonuç gelmiş bir ayak ASLA gelecekte
    // sayılmaz. X ve T-40 yalnız gerçekten başlamamış, sonuçsuz koşulara uygulanır.
    .filter(item=>!xRaceHasResult(item.race)&&item.start&&Date.parse(item.start)>now+1000);
 }
 function xRaceStartAt(){
  const future=xFutureRaceEntries();
  if(future.length) return future.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start))[0].start;
  // Yarış saatleri programda yoksa yalnız ilk yarış öncesi yedek manuel saat kullanılabilir.
  const races=xRaces();return races.length?xRaceDateTime(races[0],0):'';
 }
 function xTargetLegs(){
  return xFutureRaceEntries().map(item=>Number(item.race?.leg)||item.index+1).filter(Boolean);
 }
 function xRaceStartMap(){
  const out={};for(const item of xFutureRaceEntries()) out[String(Number(item.race?.leg)||item.index+1)]=item.start;return out;
 }
 // KULLANICI KURALI: "İlk 5 giren işaretlendiyse ve verilerde eksiklik yoksa" sonuç
 // zaten tam sayılır -- TJK Sonuç/Accurate yeniden açılmaz. Eksik/erken bir ayak
 // varsa (gün içi normal durum, henüz koşulmamış/derece girilmemiş) eskisi gibi
 // forceRefresh:true ile yeniden taranır. Bu kontrol TKP'nin kendi yüklü db'sine
 // (xRaces()) bakar; toplayıcıdaki eski/yarım bir dosyayı "tam" sanıp yanlışlıkla
 // atlamaz, çünkü karar TKP'nin zaten içe aktardığı gerçek at/derece verisine dayanır.
 function raceHasTop5Result(r){
  const live=(r?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
  if(!live.length)return false;
  const placed=new Set();
  for(const h of live){
   const fp=Number(h?.finish_position);
   if([1,2,3,4,5].includes(fp)) placed.add(fp);
  }
  const required=Math.min(5,live.length);
  const top5Marked=Array.from({length:required},(_,index)=>index+1).every(p=>placed.has(p));
  const hasPayouts=Array.isArray(r?.payouts)&&r.payouts.length>0;
  return top5Marked&&hasPayouts;
 }
 function raceHasCompleteAccurate(r){
  try{if(typeof tkpAccurateIsComplete==='function')return Boolean(tkpAccurateIsComplete(r));}catch{}
  const live=(r?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
  return live.length>0&&live.every(h=>Number(h?.accurate_avg_speed_mps)>0||Number(h?.accurate_finish_time_sec)>0);
 }
 // TAM OTOMATİK: TJK'nin 10 sabit yurt içi hipodromu dışındaki HER pist adı (Saratoga,
 // Del Mar, Woodbine, San Isidro, ...) otomatik "yurt dışı" sayılır -- sabit bir liste
 // TUTULMAZ. SehirId, VeriToplayici tarafında (jobs.js -> discoverForeignSehirId) TJK'nin
 // o günkü programından canlı bulunur. Burada yalnız Ganyan Canavarı, Bi'Talih,
 // Hipodrom.com, AtYarisi.com editörü ve Accurace gibi tamamen TR pistlerine özel
 // sitelerin yurt dışı toplantıda istenmeyeceği belirlenir -- aksi halde zaten
 // kayıtlı/alakasız sayfalar tekrar açılır (bkz. "Eski Verilerin Hepsini Güncelle" düzeltmesi).
 const DOMESTIC_HIPS=new Set(['ANKARA','BURSA','ISTANBUL','İSTANBUL','IZMIR','İZMİR','ADANA','KOCAELI','KOCAELİ','ELAZIG','ELAZIĞ','SANLIURFA','ŞANLIURFA','DIYARBAKIR','DİYARBAKIR','ANTALYA']);
 function isForeignHip(hip){ const h=String(hip||'').trim().toLocaleUpperCase('tr-TR'); return h!==''&&!DOMESTIC_HIPS.has(h); }
 function resultCollectionNeeds(){
  const races=xRaces();
  const foreign=isForeignHip($('#tkpcHip')?.value);
  if(!races.length)return {races:[],needResult:true,needAccurate:!foreign,sources:foreign?['tjk_result']:['tjk_result','accurace']};
  const needResult=races.some(r=>!raceHasTop5Result(r));
  const needAccurate=!foreign&&races.some(r=>!raceHasCompleteAccurate(r));
  return {races,needResult,needAccurate,sources:[needResult?'tjk_result':'',needAccurate?'accurace':''].filter(Boolean)};
 }
 function sourceRaceScope(races){
  const numbers=(races||[]).map(r=>Number(r?._absRaceNo||r?.race_no)).filter(n=>Number.isInteger(n)&&n>0&&n<=30);
  return numbers.length?{raceFrom:Math.min(...numbers),raceTo:Math.max(...numbers)}:{raceFrom:1,raceTo:9};
 }
 function resultsAlreadyComplete(){
  const needs=resultCollectionNeeds();
  return needs.races.length>0&&!needs.needResult&&!needs.needAccurate;
 }
 // TJK'nın 9 hipodromunun resmi il adından farklı, halkın Twitter'da fiilen
 // kullandığı yerleşim/tesis adı. Kaynak: TJK kurumsal hipodrom sayfası ve
 // TYAYSD şube listesi (2026-08-09 doğrulandı). Diyarbakır/Elazığ/Şanlıurfa'nın
 // ayrı bir halk adı yok -- il adıyla anılıyor, bu yüzden tabloda değiller.
 const X_HIPODROM_TAKMA_AD={
  'ISTANBUL':'Veliefendi','İSTANBUL':'Veliefendi',
  'ANKARA':'75. Yıl',
  'IZMIR':'Şirinyer','İZMİR':'Şirinyer',
  'BURSA':'Osmangazi',
  'ADANA':'Yeşiloba',
  'KOCAELI':'Kartepe','KOCAELİ':'Kartepe'
 };
 function xHipodromVariants(hip){
  const base=String(hip||'').trim();
  const key=base.toLocaleUpperCase('tr-TR').replace(/\d+$/,'').trim(); // "İZMİR2" -> "İZMİR"
  const nick=X_HIPODROM_TAKMA_AD[key];
  return nick && nick.toLocaleUpperCase('tr-TR')!==key ? `("${base}" OR "${nick}")` : `"${base}"`;
 }
 // Eküri ortağı (örn. "13-E2") Twitter'da çoğunlukla YALNIZ baz numarayla
 // ("13") anılır -- tam etiketle arama eküri paylaşımlarını atlıyordu. Bu
 // yardımcı hem tam etiketi hem baz numarayı arama terimine dahil eder.
 function xHorseSearchAtom(no,name){
  const base=String(no||'').replace(/-E\d+$/i,'');
  const nos=base&&base!==no?[no,base]:[no];
  const noPart=nos.map(n=>`"${n}"`).join(' OR ');
  return name?`(${noPart} OR "${base} ${name}")`:`(${noPart})`;
 }
 function xSearchPlan(races){
  const hipRaw=String(races?.[0]?.hippodrome||$('#tkpcHip')?.value||'').trim();
  const hip=xHipodromVariants(hipRaw);
  const foreignX=isForeignHip(hipRaw);
  const chileX=/CLUB\s+HIPICO|SANTIAGO/i.test(hipRaw);
  const xPickWords=chileX?'(pronóstico OR pronostico OR favorito OR fija OR ganador OR sorpresa OR caballo OR imperdible)':(foreignX?'(picks OR "best bet" OR "top pick" OR longshot OR upset OR value OR sleeper OR "live horse" OR handicap OR handicapping)':'(tahmin OR kupon OR banko OR tek OR sağlam OR sürpriz OR favori OR plase OR tüyo)');
  const xBombWords=chileX?'(sorpresa OR tapado OR dividendo OR valor OR caballo OR ganador)':(foreignX?'(longshot OR upset OR value OR sleeper OR "live horse" OR overlay)':'(bomba OR sürpriz OR "kupona al" OR tüyo OR banko)');
  const liveRows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];
  const broad=[],horseSearchTerms=[],roster=[],bombGroups=[];
  (races||[]).forEach((race,index)=>{
   const ranked=liveRows[index]?.scored?.length?liveRows[index].scored:(race.horses||[]);
   const live=ranked.filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
   const seen=new Set(),picks=[];
   for(const h of live){
    const no=String(h?.horse_no||'').match(/^\d+(?:-E\d+)?/)?.[0]||'',name=String(h?.horse_name||'').trim();
    if(!no||seen.has(no))continue;seen.add(no);picks.push({no,name,h});
   }
   const leg=Number(race?.leg)||index+1,abs=Number(race?._absRaceNo||race?.race_no)||0;
   const context=abs&&abs!==leg?`("${leg}. ayak" OR "${abs}. koşu")`:`("${leg}. ayak" OR "${leg}. koşu")`;
   // Tüm aktif atlar kapsanır. OR zincirini kısa tutmak için 4'erli bloklar kullanılır.
   for(let i=0;i<picks.length;i+=4){
    const terms=picks.slice(i,i+4).map(({no,name})=>xHorseSearchAtom(no,name)).join(' OR ');
    if(terms)broad.push(`${hip} ${context} (${terms}) ${xPickWords}`);
   }
   for(const pick of picks){
    const key=`${leg}|${String(pick.no).replace(/-E\d+$/i,'')}|${String(pick.name||'').toLocaleUpperCase('tr-TR')}`;
    const query=`${hip} ${context} ${xHorseSearchAtom(pick.no,pick.name)} ${xPickWords}`;
    // V1.1.155: X'in kelime eşleştirmesi bazen uzun boolean sorguyu fazla daraltıyor.
    // Her at için kısa -> bağlamlı -> bahis kelimeli üç kademeli sorgu hazırla; collector
    // yalnız ilk sonuçsuz atlarda bunları kullanır ve toplam süre 90 saniyeyi geçmez.
    const queryVariants=[
      pick.name?`${hip} "${pick.name}"`:`${hip} "${String(pick.no).replace(/-E\d+$/i,'')}"`,
      `${hip} ${context} ${pick.name?`"${pick.name}"`:xHorseSearchAtom(pick.no,pick.name)}`,
      query
    ].filter((q,i,a)=>q&&a.indexOf(q)===i);
    horseSearchTerms.push({key,leg,raceNo:abs||leg,no:pick.no,name:pick.name,query,queryVariants});
    roster.push({key,leg,raceNo:abs||leg,no:pick.no,name:pick.name,raceDate:String(race?.race_date||''),hippodrome:hipRaw});
   }
   const bombPicks=live.filter(h=>Number(h?.bmb)===1||Number(h?.odb)===1||(typeof isOdbCandidate==='function'&&isOdbCandidate(h))).slice(0,5)
    .map(h=>({no:String(h?.horse_no||'').match(/^\d+(?:-E\d+)?/)?.[0]||'',name:String(h?.horse_name||'').trim()})).filter(x=>x.no);
   if(bombPicks.length){const terms=bombPicks.map(({no,name})=>xHorseSearchAtom(no,name)).join(' OR ');bombGroups.push(`${hip} ${context} (${terms}) ${xBombWords}`);}
  });
  const globals=[
   `${hip} ${foreignX?'("horse racing picks" OR "race picks" OR "best bet" OR longshot OR handicapping)':'("altılı tahmin" OR "beşli tahmin" OR tahmin OR kupon OR banko OR "tek adayı" OR "günün teki")'}`,
   `${hip} ${foreignX?'(longshot OR upset OR value OR sleeper OR overlay)':'(sürpriz OR bomba OR favori OR tüyo OR plase)'}`,
   `${hip} ${foreignX?'(racing OR handicap OR picks)':'(TJK OR ganyan OR "altılı kuponu" OR AGF)'}`
  ];
  const uniq=a=>a.filter(x=>String(x||'').trim().length>=3).filter((x,i,z)=>z.indexOf(x)===i);
  return {searchTerms:uniq([...globals,...broad,...bombGroups]),horseSearchTerms:horseSearchTerms.filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i),roster:roster.filter((x,i,a)=>a.findIndex(y=>y.key===x.key)===i)};
 }
 function xSearchTerms(races){return xSearchPlan(races).searchTerms;}
 function xScanRequestBody({forceRefresh=false,manualRequest=false}={}){
  const all=xRaces(),future=xFutureRaceEntries(),races=future.length?future.map(item=>item.race):all,mode='shadow',plan=xSearchPlan(races);
  // Kullanıcının takip akışı ayrı bir veri katmanıdır. Yerel ayardan kalmış
  // "yalnız hesaplar" seçimi, takip edilen sayfalardaki yarış yorumlarını sessizce
  // atlıyordu; X taraması artık her zaman dört kaynağı birlikte kullanır.
  return {date:all[0]?.race_date||$('#tkpcDate').value,hippodrome:all[0]?.hippodrome||$('#tkpcHip').value,altiliNo:2,handles:xHandles(),searchTerms:plan.searchTerms,horseSearchTerms:plan.horseSearchTerms,raceRoster:plan.roster,sourceMode:'both',maxPosts:500,timeoutMs:300000,raceStartAt:xRaceStartAt(),targetLegs:xTargetLegs(),raceStartMap:xRaceStartMap(),applyMode:mode,cacheMaxAgeMs:15*60*1000,forceRefresh:Boolean(forceRefresh),manualRequest:Boolean(manualRequest),preferFeedPageSearch:true,disableHorseSearchFallback:true};
 }
 async function registerXSchedule(){
  // X otomatik planlama kapalıdır. Manuel X taraması scanXKulis() ile çalışır.
  window.__tkpXAutoDisabled=true;
  return false;
 }
 // KÖK EKLEME (2026-08-21, kullanıcı talebi — bilinçli risk kabulü): scanXKulis()'in
 // "HARD MANUAL GUARD"ı ve imzası (v11166 regresyon kilidi) DEĞİŞTİRİLMEDİ; bunun yerine
 // tarihsel tarama için TAMAMEN AYRI, bağımsız bir yol eklendi. x-kulis-engine.js'te zaten
 // hazır duran window.tkpApplyHistoricalXKulisPayload(payload,races) -- racesOverride ile
 // canlı ekrandan bağımsız çalışıyor -- kullanılıyor. Sunucudaki /api/v1/x/scan endpoint'i
 // yine manualRequest:true şart koşuyor (server kilidi de değişmedi); burada bilinçli ve
 // açıkça manualRequest:true gönderiliyor çünkü kullanıcı bu otomasyonu bu konuşmada açıkça
 // onayladı ve riski (X hesabı/IP kısıtlama ihtimali) kabul etti. applyMode:'historical' +
 // historicalMode:true + gerçek geçmiş yarış başlangıç saati (raceStartAt) zorunlu --
 // sunucu bunlar olmadan 400 döner, böylece yanlışlıkla "canlı" gibi işlenemez.
 async function scanXKulisHistorical(meta,races){
  if(!Array.isArray(races)||!races.length)return {ok:false,reason:'no_races'};
  if(typeof window.tkpApplyHistoricalXKulisPayload!=='function')return {ok:false,reason:'engine_missing'};
  const startAt=xRaceDateTime(races[0],0);
  if(!startAt)return {ok:false,reason:'no_start_time'};
  const plan=xSearchPlan(races);
  const body={date:meta.date,hippodrome:meta.hippodrome,altiliNo:2,handles:xHandles(),searchTerms:plan.searchTerms,horseSearchTerms:plan.horseSearchTerms,raceRoster:plan.roster,sourceMode:'both',maxPosts:400,timeoutMs:240000,raceStartAt:startAt,targetLegs:[],raceStartMap:{},applyMode:'historical',historicalMode:true,historicalWindowHours:36,cacheMaxAgeMs:15*60*1000,forceRefresh:false,manualRequest:true,preferFeedPageSearch:true,disableHorseSearchFallback:true};
  try{
   const j=await tkpcResilientFetchJson(API+'/api/v1/x/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)},{maxAttempts:3,label:`${meta.date} ${tkpcDisplayHip(meta.hippodrome)} X`});
   if(!j?.ok)throw new Error(j?.error||'X taraması başarısız');
   const report=window.tkpApplyHistoricalXKulisPayload(j,races)||{};
   return {ok:true,matched:Number(report?.matched)||0,applied:Number(report?.applied)||0,posts:Number(j?.posts?.length)||0};
  }catch(e){console.warn('[TKP] tarihsel X tarama uyarısı',meta,e);return {ok:false,error:String(e?.message||e)};}
 }
 async function scanXKulis({forceRefresh=false,manual=false}={}){
  const btn=$('#tkpcXScan'),refresh=$('#tkpcXRefresh'),out=$('#tkpcXStatus');
  // HARD MANUAL GUARD: kod içinden/eskiden kalmış timer'dan çağrı X'i açamaz.
  if(manual!==true){if(out)out.textContent='ℹ️ X yalnız X Tara / Yenile düğmesiyle manuel çalışır.';return false;}
  if(window.__tkpXScanRunning)return false;const races=xRaces();if(!races.length){out.textContent='⚠️ Önce tahmini hazırla.';return false;}
  if(typeof window.tkpApplyXKulisPayload!=='function'){out.textContent='❌ X kulis motoru yüklenemedi.';return;}
  const mode='shadow',start=xRaceStartAt(),future=xFutureRaceEntries();
  if(mode==='live'&&!start){out.textContent='⚠️ Canlı X etkisi için henüz başlamamış bir koşunun saati gerekli. TJK saatleri yoksa ilk yarış için yedek saati gir.';return false;}
  if(mode==='live'&&!future.length){out.textContent='⛔ Programdaki tüm saatli koşular başlamış. Sonradan veri uygulanmadı.';return false;}
  window.__tkpXScanRunning=true;if(btn)btn.disabled=true;if(refresh)refresh.disabled=true;out.textContent=`⏳ X ${forceRefresh?'zorla yenileniyor':'açılıyor ve yorumlar taranıyor'}; Takip/Sana Özel/yorumcu sayfaları taranıyor, boşa dönen tek tek at araması kapalı…`;
  try{
   const body=xScanRequestBody({forceRefresh,manualRequest:true});
   const r=await fetch(API+'/api/v1/x/scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!j.ok)throw new Error(j.error||'X taraması başarısız');
   // Sunucu yalnız tarama parametrelerini kullanır; uygulama kapsamı istemci tarafında
   // tekrar eklenir. Başlamış ayaklara aynı payload hiçbir şekilde uygulanmaz.
   j.targetLegs=body.targetLegs;j.raceStartMap=body.raceStartMap;
   const rawRaces=xRaces();const report=window.tkpApplyXKulisPayload(j,{mode});
   // Kapsama kartı "5 hesap" derken yalnız aktif atla eşleşen yazarları sayar.
   // Tarama listesinde kaç hesap vardı ve kaç profil gerçekten açıldı bilgisi de
   // karta taşınır; aksi halde 30 yorumcu ayarı çalıştı mı anlaşılamaz.
   report.scanStats=j.stats||{};
   // X shadow puanı tahmine uygulanmasa da at nesnelerine bu aşamada yazılır.
   // Ayak tablosu tarama öncesi HTML'de kalırsa Y.PU+X hücreleri güncellenmez.
   // Bu yüzden shadow/live ayrımı olmadan tahmin ekranını yeniden çiz; yalnız live
   // modunda kuponları yeniden oluştur. Böylece X +puan görünür ama shadow modunda
   // sıralama/TEK/kupon davranışı değişmez.
   if(typeof renderPredictionScreen==='function'){
    await new Promise(resolve=>setTimeout(resolve,0));await Promise.resolve(renderPredictionScreen(rawRaces));
    if(mode==='live'){
     await new Promise(resolve=>setTimeout(resolve,0));$('#buildBudgetCoupon')?.click();
    }
   }
   $('#tkpcXPreview').innerHTML=window.tkpXKulisTableHTML(report);const st=j.stats||{};out.textContent=`✅ ${j.posts?.length||0} yorum ${j.cached?'kayıtlı veriden kullanıldı; X yeniden açılmadı':'tarandı'} · hesap: ${Number(st.requestedHandles??j.handles?.length)||0} tanımlı / ${Number(st.attemptedHandles)||0} profil açıldı / ${Number(st.matchedAuthors)||0} eşleşen yazar · ${report.matched} at eşleşti · ${Number(report.applied)||0} atta gerçek X etkisi oluştu · ${st.horseSearchSkipped?'tekil at araması atlandı; sayfa/takip akışı kullanıldı · ':''}${mode==='live'?(Number(report.applied)>0?`${body.targetLegs?.length||0} başlamamış ayak için Y.PUAN/kuponlar güncellendi`:'eşleşmeler nötr kaldı; tahmin puanı değiştirilmedi'):'tahmin değiştirilmedi'}.`;
   try{localStorage.setItem('tkp_x_last_auto',`${body.date}|${body.hippodrome}|${new Date().toISOString().slice(0,10)}`);}catch{}
   return true;
  }catch(e){out.textContent='❌ '+e.message;return false;}finally{window.__tkpXScanRunning=false;if(btn)btn.disabled=false;if(refresh)refresh.disabled=false;}
 }
 function autoScanXKulis(){
  // Kullanıcı tercihi: X kendiliğinden taranmaz/açılmaz.
  window.__tkpXAutoDisabled=true;
  return false;
 }

 // FINAL — TJK SON KONTROL (T-30): yalnız tjk_program zorla yenilenir.
 // Son AGF ve koşmayanlar güncellenince normal import yolu ekranı/tahmini yeniden kurar.
 // Yarış başladıktan sonra çalışmaz; her yaklaşan koşu için bir kez tetiklenir.
async function autoTjkFinalCheck(){
  // Otomatik TJK program taraması varsayılan kapalıdır. Yalnız kullanıcı aynı
  // oturum için canlı otomasyonu açıkça etkinleştirirse timer buraya girebilir.
  if(window.__tkpLiveAutomationEnabled!==true||window.__tkpTjkFinalAutoDisabled===true)return false;
  if(window.__tkpTjkFinalRunning||activeJobId)return false;
  const future=xFutureRaceEntries().sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));if(!future.length)return false;
  const mins=(Date.parse(future[0].start)-Date.now())/60000;if(mins<=0||mins>30)return false;
  const races=xRaces(),date=races[0]?.race_date||$('#tkpcDate')?.value,hip=races[0]?.hippodrome||$('#tkpcHip')?.value;if(!date||!hip||isForeignHip(hip)||String(date)!==tkpcTurkeyToday()||!races.some(r=>String(r?.program_source||'').toUpperCase()==='TJK_PROGRAM'&&String(r?.tjk_race_time||'').trim()))return false;
  // Kullanıcı kuralı: Son AGF + KOŞMAZ için yalnız BİR kez, toplantının ilk yaklaşan
  // koşusu son 30 dakikaya girdiğinde kontrol et. Sonrasında tekrar sorgu yok.
  const target=future[0];
  const targetLeg=Number(target?.race?.leg)||Number(target?.index)+1;
  const targetAbs=Number(target?.race?._absRaceNo||target?.race?.race_no)||targetLeg;
  const key=`tkp_tjk_t30|${date}|${hip}|${Number(races[0]?.altili_no)||2}`;try{if(localStorage.getItem(key)==='done')return false;}catch{}
  window.__tkpTjkFinalRunning=true;status(`⏳ TJK Son Kontrol · T-${Math.ceil(mins)} dk · son AGF ve KOŞMAZ bilgisi bir kez yenileniyor…`);
  try{
   const scope=sourceRaceScope(races);const body={date,hippodrome:hip,sources:['tjk_program'],altiliNo:Number(races[0]?.altili_no)||2,dynamicAltili:true,fastMode:true,onlyMissing:false,forceRefresh:true,...scope};
   const rr=await fetch(API+'/api/v1/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),j=await rr.json();if(!j.ok||!j.job?.id)throw new Error(j.error||'TJK son kontrol başlatılamadı');
   activeJobId=j.job.id;const job=await tkpcWaitBackgroundJob(j.job.id);activeJobId='';if(!job||!tkpcJobCompleted(job))throw new Error(job?.errors?.[0]?.error||'TJK son kontrol tamamlanamadı');
   const finalImport=job.files?.length?await previewAndImport(j.job.id,job,{finalAgf:true}):null;if(!finalImport)throw new Error('TJK son program dosyası alınamadı');
   try{localStorage.setItem(key,'done');}catch{}
   // Import sonrası tüm tahmin/kuponlar güncel AGF + koşmayanlara göre tekrar dondurulur.
   try{if(typeof autoBuildCouponsFortyMinutesBefore==='function')Promise.resolve(autoBuildCouponsFortyMinutesBefore()).catch(()=>{});}catch(_){ }
   status(finalImport?.reused
    ?'✅ TJK Son Kontrol tamamlandı · AGF/KOŞMAZ değişmedi; kayıtlı tahmin ve kupon açıldı, yeniden hesaplanmadı.'
    :'✅ TJK Son Kontrol tamamlandı · son AGF/KOŞMAZ değişikliği işlendi · tahmin ve kuponlar yarış öncesi yeniden donduruldu.');return true;
  }catch(e){status('⚠️ TJK Son Kontrol: '+e.message);return false;}finally{activeJobId='';window.__tkpTjkFinalRunning=false;}
 }

 // Güncel hazır kupon/yorumcu desteği ilk Altılı ayağına 30–40 dakika kala bir
 // kez alınır. X burada yoktur (kullanıcı isteğiyle manuel); tarihsel kuyruklara
 // da karışmaz. Kaynak başarısızlığı ana TJK programını veya kupon üretimini durdurmaz.
 async function autoCurrentTipsterFinalCheck(){
  // Kullanıcı kuralı: Misli/Bi'Talih/Hipodrom/AtYarisi verisi ilk doğru toplamada
  // alındıysa yarışa yakın tekrar taranmaz. Dinamik son kontrol yalnız TJK AGF+KOŞMAZ'dır.
  return false;

  if(window.__tkpLiveAutomationEnabled!==true||window.__tkpTipsterFinalRunning||window.__tkpTjkFinalRunning||activeJobId)return false;
  const future=xFutureRaceEntries().sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));if(!future.length)return false;
  const mins=(Date.parse(future[0].start)-Date.now())/60000;if(mins<=25||mins>40)return false;
  const races=xRaces(),date=races[0]?.race_date||$('#tkpcDate')?.value,hip=races[0]?.hippodrome||$('#tkpcHip')?.value;if(!date||!hip||String(date)!==tkpcTurkeyToday())return false;
  const key=`tkp_tipster_t40|${date}|${hip}|${Number(races[0]?.altili_no)||2}`;try{if(localStorage.getItem(key)==='done')return false;}catch{}
  window.__tkpTipsterFinalRunning=true;status(`⏳ Güncel Tahmin Desteği · ilk ayak T-${Math.ceil(mins)} dk · TR PUAN ve hazır kuponlar sessizce yenileniyor…`);
  try{
   // V54 davranışı: Liderform beş tarayıcı sayfası açtığı için otomatik T-40
   // desteğine girmez. Ana kart/TJK ve hafif yorum kaynakları önceliklidir.
   // TR PUAN hazır kuponlardan gelmez; Ganyan Canavarı'nın ayrı P sütunudur.
   // T-40 sessiz yenilemede bu kaynak eksik kalırsa ilk toplamadaki TR boşluğu
   // hiçbir zaman kapanmıyordu.
   const sources=['ganyan_canavari','misli','bitalih','hipodrom','editor'];
   const scope=sourceRaceScope(races),body={date,hippodrome:hip,sources,altiliNo:Number(races[0]?.altili_no)||2,dynamicAltili:true,fastMode:true,onlyMissing:false,forceRefresh:true,skipOptionalRetry:true,...scope};
   const rr=await fetch(API+'/api/v1/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),j=await rr.json();if(!j.ok||!j.job?.id)throw new Error(j.error||'güncel tahmin desteği başlatılamadı');
   activeJobId=j.job.id;const job=await tkpcWaitBackgroundJob(j.job.id);activeJobId='';if(!job||!tkpcJobCompleted(job))throw new Error(job?.errors?.[0]?.error||'güncel tahmin desteği tamamlanamadı');
   if(job.files?.length)await previewAndImport(j.job.id,job);
   const okSources=[...new Set((job.files||[]).map(f=>sourceLabel(f.source)).filter(Boolean))],failed=[...new Set((job.errors||[]).map(e=>sourceLabel(e.source)).filter(Boolean))];
   try{localStorage.setItem(key,'done');}catch{}
   status(`✅ Güncel Tahmin Desteği tamamlandı · alınan: ${okSources.join(', ')||'yok'}${failed.length?` · alınamayan: ${failed.join(', ')}`:''}. Son AGF T-30'da bir kez yenilenecek.`);return true;
  }catch(e){status('⚠️ Güncel Tahmin Desteği alınamadı; mevcut sağlam verilerle devam ediliyor: '+e.message);return false;}finally{activeJobId='';window.__tkpTipsterFinalRunning=false;}
 }

 async function manualTjkFinalAgfRefresh(){
  if(window.__tkpTjkFinalRunning||activeJobId)throw new Error('Veri Toplayıcı başka bir iş yürütüyor');
  const races=xRaces(),date=races[0]?.race_date||$('#tkpcDate')?.value,hip=races[0]?.hippodrome||$('#tkpcHip')?.value;
  if(!races.length||!date||!hip)throw new Error('Önce açık bir yarış programı/tahmin kaydı yükle');
  // TJK collector yabancı simulcast toplantılarını da günlük TJK indeksinden keşfedebiliyor.
  // Bu nedenle Son AGF manuel yenilemesi yerli/yabancı ayrımı yapmadan TJK Programı dener.
  window.__tkpTjkFinalRunning=true;status('⏳ Son AGF · TJK Yarış Programı otomatik açılıyor; değişen AGF ve KOŞMAZ bilgisi alınıyor…');
  try{
   const scope=sourceRaceScope(races);const body={date,hippodrome:hip,sources:['tjk_program'],altiliNo:Number(races[0]?.altili_no)||2,dynamicAltili:true,fastMode:true,onlyMissing:false,forceRefresh:true,...scope};
   const rr=await fetch(API+'/api/v1/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),j=await rr.json();if(!j.ok||!j.job?.id)throw new Error(j.error||'TJK program yenilemesi başlatılamadı');
   activeJobId=j.job.id;const job=await tkpcWaitBackgroundJob(j.job.id);activeJobId='';if(!job||!tkpcJobCompleted(job))throw new Error(job?.errors?.[0]?.error||'TJK program yenilemesi tamamlanamadı');
   if(!job.files?.length)throw new Error(job?.errors?.find(e=>e.source==='tjk_program')?.error||'TJK Yarış Programı alınamadı');
   const finalImport=await previewAndImport(j.job.id,job,{finalAgf:true});
   // previewAndImport normal ana program içe aktarma yolunu kullanır; böylece değişen AGF,
   // koşmayanlar, bütün bağlı tablo/cache/kuponlar tek veri kaynağından yenilenir.
   status(finalImport?.reused
    ?'✅ Son AGF kontrol edildi · AGF/KOŞMAZ değişmedi; kayıtlı tahmin, tablolar ve üç kupon açıldı, yeniden hesaplanmadı.'
    :'✅ Son AGF tamamlandı · değişen AGF/KOŞMAZ işlendi · tahmin, ayak tabloları, üç kupon ve portföy güncellendi.');return true;
  }finally{activeJobId='';window.__tkpTjkFinalRunning=false;}
 }
 window.tkpRefreshFinalAgfFromTjk=manualTjkFinalAgfRefresh;

 // V1.1.297 HIZ: 509+ arşivde geçmiş veri düğmeleri aynı files/races listesini
 // tekrar tekrar gruplayıp Map/Set kurmasın. Gruplama DB revision + dizi kimliğiyle cache'lenir;
 // eksik/tamamlandı kararları aşağıda HER çağrıda canlı hesaplandığı için stale durum oluşmaz.
 let _tkpHistoricalGroupCache={db:null,revision:-1,files:null,races:null,all:null,eligible:null};
 function tkpcDbRevision(){try{return typeof _tkpDbRevision==='number'?_tkpDbRevision:-1;}catch{return -1;}}
 function historicalGroupedMeetings(includeExcluded=true){
  const d=currentDb();if(!d)return {filesById:new Map(),groups:[]};
  const rev=tkpcDbRevision(),files=d.files||[],races=d.races||[],slot=includeExcluded?'all':'eligible';
  const c=_tkpHistoricalGroupCache;
  if(c.db===d&&c.revision===rev&&c.files===files&&c.races===races&&c[slot])return c[slot];
  const filesById=new Map(files.map(f=>[String(f.id),f]));
  const groups=new Map(),today=tkpcTurkeyToday();
  const hipKey=value=>{try{return typeof canonicalHippodrome==='function'?canonicalHippodrome(value):String(value||'').trim().toUpperCase();}catch{return String(value||'').trim().toUpperCase();}};
  for(const race of races){
   if(!includeExcluded&&(Number(race?.historical_training_excluded)===1||race?.active===0))continue;
   const file=filesById.get(String(race?.file_id))||{};
   const date=String(race?.race_date||file?.race_date||'').slice(0,10),hip=hipKey(race?.hippodrome||file?.hippodrome||'');
   if(!date||!hip||date>today)continue;
   const altiliNo=Number(race?.altili_no)||Number(file?.altili_no)||2;
   const targetFileId=String(race?.file_id||file?.id||'').trim();
   const key=`${date}|${hip}|${altiliNo}|F${targetFileId||'NOFILE'}`;
   if(!groups.has(key))groups.set(key,{date,hippodrome:hip,altiliNo,targetFileId,races:[]});
   groups.get(key).races.push(race);
  }
  const value={filesById,groups:[...groups.values()]};
  if(c.db!==d||c.revision!==rev||c.files!==files||c.races!==races)_tkpHistoricalGroupCache={db:d,revision:rev,files,races,all:null,eligible:null};
  _tkpHistoricalGroupCache[slot]=value;
  return value;
 }
 function historicalMeetings(options={}){
  const onlyMissing=options?.onlyMissing!==false;
  const d=currentDb();if(!d)return [];
  const {filesById,groups}=historicalGroupedMeetings(true);
  const queue=[];
  for(const group of groups){
   // Arşiv sonuç bakımında yalnız iki katman yenilenir:
   // 1) TJK resmi İlk-5 + ikramiyeler, 2) Accurate.
   // TR PUAN, J-BYG, galop, antrenör, Y.PUAN, G.PR ve diğer zenginleştirmeler
   // bu işlemin parçası değildir; sonuç eksikmiş gibi davranıp taranamaz.
   const foreign=isForeignHip(group.hippodrome);
   // KÖK FIX (V1.1.171, kullanıcı bulgusu): fonksiyon adı "historicalMissingMeetings"
   // olmasına rağmen HİÇBİR eksik kontrolü yapmadan TÜM geçmiş toplantıları kuyruğa
   // alıyordu -- bitiş mesajı "sonraki basışta yalnız eksikler yeniden denenecek"
   // diyordu ama bu hiçbir zaman doğru olmadı, her basışta 72 toplantının 72'si de
   // yeniden çekiliyordu (66'sı zaten tamamlanmış olsa bile). Artık iki katman da
   // (TJK Sonuç/ikramiye + yerli ise Accurate) zaten mevcutsa toplantı kuyruğa hiç
   // girmiyor -- yalnız gerçekten eksik olan toplantılar için ağ isteği yapılır.
   const relatedFileIds=new Set(group.races.map(r=>String(r?.file_id)));
   // Dosya işaretinin yanı sıra satır bazında İlk-5 + ikramiye bütünlüğünü de ara.
   // Böylece "sonuç var ama parasal ikramiye yok" kaydı tamamlanmış sayılmaz.
   const resultsConfirmed=[...relatedFileIds].every(fid=>Number(filesById.get(fid)?.has_confirmed_results)===1);
   const foreignOfficialUnsupported=foreign&&historicalNoDataKnown(group,'foreign_official_result');
   // Old complete stamps were set after finding any winner. Only the actual
   // imported first-five positions and payouts may satisfy this layer now.
   const hasOfficialResult=foreignOfficialUnsupported||(group.races.length>0&&group.races.every(r=>raceHasTop5Result(r)));
   // Accurate yayınlanmayan toplantılarda resmi TJK sonucu geçerlidir; yalnız yerli
   // toplantıda gerçekten eksikse Accurate ayrı bir istektir.
   // Accurate katmanı toplantı işaretiyle değil, her koşudaki gerçek uygulanmış
   // alanla tamam sayılır. Eski sürümlerde dört sayfa inip dört koşuya işlenince
   // toplantı "tam" damgası alabiliyordu; kalan iki koşu böylece bir daha hiç
   // denenmiyordu. Kısmi veri kalıcı olarak korunur, fakat eksik koşular ayrı
   // bakım adayları olarak kalır.
   const hasAccurate=foreign||(
    group.races.length>0&&group.races.every(r=>raceHasCompleteAccurate(r))
   );
   const alreadyComplete=hasOfficialResult&&hasAccurate;
   if(onlyMissing&&alreadyComplete)continue;
   // Kaynakları topluca değil, sadece eksik katman kadar iste. Bu sonuç bakımında
   // TJK programı, Ganyan Canavarı, J-BYG, galop ve antrenör kesinlikle açılmaz.
   const sources=[];
   if(!hasOfficialResult)sources.push('tjk_result');
   if(!hasAccurate&&!foreign)sources.push('accurace');
   const uniqueSources=[...new Set(sources)];
   if(onlyMissing && !uniqueSources.length) continue;
   // Accurate için "veri yok" kesin sonsuz durum değildir: sağlayıcı geç
   // yayınlayabilir. İlk tur + son turdan sonra yalnız Accurate eksikse 24 saat
   // soğut, sonra tekrar dene. TJK sonucu soğutması kendi kuralında kalır.
   if(onlyMissing&&uniqueSources.length===1&&uniqueSources[0]==='accurace'&&historicalNoDataCooling(group,'accurace'))continue;
   queue.push({...group,sources:uniqueSources,historicalTop5Only:true});
  }
  return queue.sort((a,b)=>String(b.date).localeCompare(String(a.date))||TKP_TR_COLLATOR.compare(String(a.hippodrome),String(b.hippodrome)));
 }
 function historicalMissingMeetings(){return historicalMeetings({onlyMissing:true});}
 function historicalAllMeetings(){return historicalMeetings({onlyMissing:false});}
 const HIST_NO_RESULT_COOLDOWN_MS=24*60*60*1000;
 function historicalNoResultKey(item){return `tkpHistNoResult:${String(item?.date||'').slice(0,10)}|${String(item?.hippodrome||'').trim().toUpperCase()}|${Number(item?.altiliNo)||2}`;}
 function historicalNoDataKey(item,source){return `tkpHistNoData:${String(source||'source')}|${String(item?.date||'').slice(0,10)}|${String(item?.hippodrome||'').trim().toUpperCase()}|${Number(item?.altiliNo)||2}|F${String(item?.targetFileId||'')}`;}
 function historicalNoDataStore(){const d=currentDb();if(!d)return null;d.settings=d.settings||{};d.settings.historical_no_data=d.settings.historical_no_data||{};return d.settings.historical_no_data;}
 function historicalNoDataKnown(item,source){
  const key=historicalNoDataKey(item,source);const store=historicalNoDataStore();const row=store?.[key];if(row?.noData===true)return true;
  // Eski sürüm localStorage kaydını bir kez okuyup ana IndexedDB verisine göç ettir.
  try{const raw=localStorage.getItem(key);if(!raw)return false;const legacy=JSON.parse(raw);if(legacy?.noData===true){if(store)store[key]=legacy;try{localStorage.removeItem(key);}catch{}return true;}}catch{}
  return false;
 }
 function historicalNoDataCooling(item,source,ms=HIST_NO_RESULT_COOLDOWN_MS){
  const key=historicalNoDataKey(item,source),store=historicalNoDataStore();const row=store?.[key];
  if(!row?.noData)return false;
  const ts=Number(row.ts)||0;return ts>0&&Date.now()-ts<Math.max(1000,Number(ms)||HIST_NO_RESULT_COOLDOWN_MS);
 }
 function markHistoricalNoData(item,source,error){const key=historicalNoDataKey(item,source),store=historicalNoDataStore();if(store)store[key]={noData:true,ts:Date.now(),source,error:String(error?.message||error||'veri yok').slice(0,240)};try{localStorage.removeItem(key);}catch{}}
 function clearHistoricalNoData(item,source){const key=historicalNoDataKey(item,source),store=historicalNoDataStore();if(store&&Object.prototype.hasOwnProperty.call(store,key))delete store[key];try{localStorage.removeItem(key);}catch{}}
 function historicalCompleteKey(item,source){return `tkpHistComplete:${String(source||'source')}|${String(item?.date||'').slice(0,10)}|${String(item?.hippodrome||'').trim().toUpperCase()}|${Number(item?.altiliNo)||2}|F${String(item?.targetFileId||'')}`;}
 function historicalCompleteStore(){const d=currentDb();if(!d)return null;d.settings=d.settings||{};d.settings.historical_layer_complete=d.settings.historical_layer_complete||{};return d.settings.historical_layer_complete;}
 function historicalLayerCompleteKnown(item,source){const row=historicalCompleteStore()?.[historicalCompleteKey(item,source)];return row?.complete===true;}
 function markHistoricalLayerComplete(item,source,detail=''){const store=historicalCompleteStore();if(store)store[historicalCompleteKey(item,source)]={complete:true,ts:Date.now(),source,detail:String(detail||'').slice(0,240)};}
 function clearHistoricalLayerComplete(item,source){const store=historicalCompleteStore(),key=historicalCompleteKey(item,source);if(store&&Object.prototype.hasOwnProperty.call(store,key))delete store[key];}
 function historicalNoResultCooling(item){
  // V1.1.245 KÖK FIX (kullanıcı bulgusu, "303 tekrar veri alıyor"): bu kontrol
  // eskiden yalnız YABANCI hipodromları koruyordu (`if(!isForeignHip(...))
  // return false;`). Kalıcı olarak başarısız olan (TJK sonuç dosyası her
  // seferinde çekilip ayrıştırılabiliyor ama resmi kazanan bir türlü kayda
  // yazılamayan) bir YERLİ toplantı, hiçbir bekleme koruması olmadığı için
  // "🏁 TJK Sonuç + Accurate" düğmesine her basışta YENİDEN indiriliyordu --
  // "303 tekrar veri alıyor" şikayetinin kök nedeni buydu. Artık yerli/yabancı
  // ayrımı olmadan aynı 24 saatlik bekleme tüm hipodromlara uygulanır; bu,
  // GERÇEKTEN eksik olan bir sonucu (henüz TJK yayınlamadıysa) yakalamayı
  // engellemez -- yalnız aynı başarısız denemeyi aynı gün içinde tekrar tekrar
  // ağa göndermeyi durdurur.
  try{const raw=localStorage.getItem(historicalNoResultKey(item));if(!raw)return false;const row=JSON.parse(raw);return Date.now()-Number(row?.ts||0)<HIST_NO_RESULT_COOLDOWN_MS;}catch{return false;}
 }
 function markHistoricalNoResult(item,error){try{localStorage.setItem(historicalNoResultKey(item),JSON.stringify({ts:Date.now(),error:String(error?.message||error||'TJK sonucu bulunamadı').slice(0,240)}));}catch{}}
 function clearHistoricalNoResult(item){try{localStorage.removeItem(historicalNoResultKey(item));}catch{}}

 function raceHasAnySupportValue(r,keys){return (r?.horses||[]).some(h=>keys.some(k=>h?.[k]!==null&&h?.[k]!==undefined&&String(h?.[k]).trim()!==''&&String(h?.[k]).trim()!=='-'));}
 function raceMissingAnySupportValue(r,keys){return (r?.horses||[]).some(h=>!keys.some(k=>h?.[k]!==null&&h?.[k]!==undefined&&String(h?.[k]).trim()!==''&&String(h?.[k]).trim()!=='-'));}
 function tkpcSupportIsoDate(value){
  const raw=String(value||'').trim();if(!raw)return '';
  try{if(typeof tkpIsoDateFromLooseText==='function'){const iso=tkpIsoDateFromLooseText(raw);if(iso)return iso;}}catch{}
  const ymd=raw.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);if(ymd)return `${ymd[1]}-${String(ymd[2]).padStart(2,'0')}-${String(ymd[3]).padStart(2,'0')}`;
  const dmy=raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);if(dmy)return `${dmy[3]}-${String(dmy[2]).padStart(2,'0')}-${String(dmy[1]).padStart(2,'0')}`;
  return raw.slice(0,10);
 }
 function historicalSupportLayerComplete(race,layerName,allowedSources){
  const layer=race?.support_layers?.[layerName]||{},source=String(layer?.source||''),raceDate=tkpcSupportIsoDate(race?.race_date||''),asof=tkpcSupportIsoDate(layer?.asof||'');
  if(layerName==='tr'){
   const horses=(race?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
   if(!horses.length||horses.some(h=>!(Number(h.tr_ganyan)>0)||h.tr_ganyan_source!=='GANYAN_CANAVARI_TR'||tkpcSupportIsoDate(h.tr_ganyan_asof_date)!==asof))return false;
  }
  if(/^GANYAN_CANAVARI/.test(source)&&Number(layer.eligible)>0&&Number(layer.applied||0)+Number(layer.zeroAccepted||0)<Number(layer.eligible))return false;
  return layer?.complete===true&&allowedSources.includes(source)&&(!raceDate||asof===raceDate);
 }
function historicalSupportCoverage(races){
  const rows=Array.isArray(races)?races:[];
  const tr=rows.filter(r=>historicalSupportLayerComplete(r,'tr',['GANYAN_CANAVARI_TR'])).length;
  const gcGlp=rows.filter(r=>historicalSupportLayerComplete(r,'glp',['GANYAN_CANAVARI_GALOPLAR_OZET'])).length;
  const ybGlp=rows.filter(r=>historicalSupportLayerComplete(r,'glp',['YENIBEYGIR_GLP_FALLBACK'])).length;
  const glp=gcGlp+ybGlp;
  const gcJbyg=rows.filter(r=>historicalSupportLayerComplete(r,'jbyg',['GANYAN_CANAVARI_JBYG'])).length;
  const ybJbyg=rows.filter(r=>historicalSupportLayerComplete(r,'jbyg',['YENIBEYGIR_JBYG_FALLBACK'])).length;
  const tjkProgram=rows.filter(r=>historicalSupportLayerComplete(r,'tjk_program',['TJK_PROGRAM'])).length;
  const jbyg=gcJbyg+ybJbyg;
  const glpSources=['GANYAN_CANAVARI_GALOPLAR_OZET','YENIBEYGIR_GLP_FALLBACK'];
  const jbygSources=['GANYAN_CANAVARI_JBYG','YENIBEYGIR_JBYG_FALLBACK'];
  return {total:rows.length,tr,glp,gcGlp,ybGlp,gcJbyg,ybJbyg,jbyg,tjkProgram,complete:rows.filter(r=>historicalSupportLayerComplete(r,'tr',['GANYAN_CANAVARI_TR'])&&historicalSupportLayerComplete(r,'glp',glpSources)&&historicalSupportLayerComplete(r,'jbyg',jbygSources)).length};
}
function historicalSupportSourcesForRaces(races){
  const rows=Array.isArray(races)?races:[];
  // Kullanıcı kararı: TJK Program/Sonuç ve Accurate bu menünün kapsamı değildir.
  // Bu ekran yalnız yardımcı TR/GLP/J-BYG katmanlarını tamamlar.
  if(!rows.length)return ['ganyan_canavari','ganyan_canavari_glp','ganyan_canavari_jbyg'];
  const sources=[];
  if(rows.some(r=>!historicalSupportLayerComplete(r,'tr',['GANYAN_CANAVARI_TR'])))sources.push('ganyan_canavari');
  if(rows.some(r=>!historicalSupportLayerComplete(r,'glp',['GANYAN_CANAVARI_GALOPLAR_OZET','YENIBEYGIR_GLP_FALLBACK'])))sources.push('ganyan_canavari_glp');
  if(rows.some(r=>!historicalSupportLayerComplete(r,'jbyg',['GANYAN_CANAVARI_JBYG','YENIBEYGIR_JBYG_FALLBACK'])))sources.push('ganyan_canavari_jbyg');
  return sources;
}
 function historicalSupportLayerCooling(item,source){
  const map={ganyan_canavari:'support_tr',ganyan_canavari_glp:'support_glp',ganyan_canavari_jbyg:'support_jbyg'};
  return historicalNoDataCooling(item,map[source]||('support_'+String(source||'source')));
 }
 function markHistoricalSupportLayerNoData(item,source,error){
  const map={ganyan_canavari:'support_tr',ganyan_canavari_glp:'support_glp',ganyan_canavari_jbyg:'support_jbyg'};
  markHistoricalNoData(item,map[source]||('support_'+String(source||'source')),error);
 }
 function clearHistoricalSupportLayerNoData(item,source){
  const map={ganyan_canavari:'support_tr',ganyan_canavari_glp:'support_glp',ganyan_canavari_jbyg:'support_jbyg'};
  clearHistoricalNoData(item,map[source]||('support_'+String(source||'source')));
 }
 function historicalFallbackSourcesForRaces(races){
  const rows=Array.isArray(races)?races:[];
  const sources=[];
  if(rows.some(r=>!historicalSupportLayerComplete(r,'glp',['GANYAN_CANAVARI_GALOPLAR_OZET','YENIBEYGIR_GLP_FALLBACK'])))sources.push('yenibeygir_glp');
  if(rows.some(r=>!historicalSupportLayerComplete(r,'jbyg',['GANYAN_CANAVARI_JBYG','YENIBEYGIR_JBYG_FALLBACK'])))sources.push('yenibeygir_jbyg');
  return sources;
 }
 function historicalGanyanSupportMissing(races){
  return historicalSupportSourcesForRaces(races).length>0;
 }

 function tkpcUiYield(){
  if(typeof tkpYield==='function')return tkpYield();
  return new Promise(resolve=>setTimeout(resolve,0));
 }
 async function tkpcForEachChunk(rows,worker,chunkSize=12){
  const list=Array.isArray(rows)?rows:[];
  const size=Math.max(1,Number(chunkSize)||12);
  for(let index=0;index<list.length;index++){
   worker(list[index],index);
   if((index+1)%size===0)await tkpcUiYield();
  }
 }
 function applyHistoricalTrainingQualityGate(){
  // Ham kaydı silme: sonradan "Eksik Sonuç Güncelle" ile onarılabilsin. Ancak resmî
  // kazananı veya temel koşu profili bulunmayan ağır eksik geçmiş koşuları öğrenme,
  // benzer yarış ve backtest hafızasından çıkar (active=0). Accurate/J-BYG/GLP doğal
  // olarak her koşuda yayımlanmadığından kalite kapısının zorunlu alanı değildir.
  const d=currentDb();if(!d)return {excluded:0,restored:0,reasons:{}};
  const today=tkpcTurkeyToday(),reasons={},present=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&String(value).trim()!=='-';
  let excluded=0,restored=0;
  for(const race of (d.races||[])){
   const date=String(race?.race_date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=today)continue;
   const horses=(race?.horses||[]).filter(h=>present(h?.horse_no)&&present(h?.horse_name));
   const failures=[];
   if(!raceHasAnySupportValue(race,['winner','finish_position'])||!horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1))failures.push('resmi_sonuc');
   if(horses.length<3)failures.push('at_listesi');
   if(!present(race?.hippodrome))failures.push('hipodrom');
   const distance=Number(race?.distance);if(!Number.isFinite(distance)||distance<600||distance>5000)failures.push('mesafe');
   if(!present(race?.surface)&&!present(race?.track_type)&&!present(race?.pist))failures.push('pist');
   if(!present(race?.condition_text)&&!present(race?.condition)&&!present(race?.race_name)&&!present(race?.race_type))failures.push('kosu_sarti');
   if(failures.length){
    race.historical_training_excluded=1;race.historical_training_exclusion_reasons=failures;race.active=0;excluded++;
    for(const reason of failures)reasons[reason]=(reasons[reason]||0)+1;
   }else if(Number(race?.historical_training_excluded)===1){
    delete race.historical_training_excluded;delete race.historical_training_exclusion_reasons;race.active=1;restored++;
   }
  }
  d.settings=d.settings||{};d.settings.historical_training_quality_gate={version:1,checked_at:new Date().toISOString(),excluded,restored,reasons};
  return {excluded,restored,reasons};
 }
 async function applyHistoricalTrainingQualityGateAsync(){
  const d=currentDb();if(!d)return {excluded:0,restored:0,reasons:{}};
  const today=tkpcTurkeyToday(),reasons={},present=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&String(value).trim()!=='-';
  let excluded=0,restored=0;
  await tkpcForEachChunk(d.races||[],race=>{
   const date=String(race?.race_date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=today)return;
   const horses=(race?.horses||[]).filter(h=>present(h?.horse_no)&&present(h?.horse_name));
   const failures=[];
   if(!raceHasAnySupportValue(race,['winner','finish_position'])||!horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1))failures.push('resmi_sonuc');
   if(horses.length<3)failures.push('at_listesi');
   if(!present(race?.hippodrome))failures.push('hipodrom');
   const distance=Number(race?.distance);if(!Number.isFinite(distance)||distance<600||distance>5000)failures.push('mesafe');
   if(!present(race?.surface)&&!present(race?.track_type)&&!present(race?.pist))failures.push('pist');
   if(!present(race?.condition_text)&&!present(race?.condition)&&!present(race?.race_name)&&!present(race?.race_type))failures.push('kosu_sarti');
   if(failures.length){race.historical_training_excluded=1;race.historical_training_exclusion_reasons=failures;race.active=0;excluded++;for(const reason of failures)reasons[reason]=(reasons[reason]||0)+1;}
   else if(Number(race?.historical_training_excluded)===1){delete race.historical_training_excluded;delete race.historical_training_exclusion_reasons;race.active=1;restored++;}
  },14);
  d.settings=d.settings||{};d.settings.historical_training_quality_gate={version:2,checked_at:new Date().toISOString(),excluded,restored,reasons};
  return {excluded,restored,reasons};
 }
 function refreshHistoricalAnalysisData(){
  // Sonuç/destek onarımı sonrası bütün tüketiciler aynı DB sürümünü görsün: eğitim,
  // benzer yarış, koşu şartı, Altılı, yan bahis, hızlı backtest ve çevrimiçi sıralama.
  try{
   const d=currentDb(),hip=value=>String(value||'').trim().toLocaleUpperCase('tr-TR');
   if(d){
    d.files=(d.files||[]).slice().sort((a,b)=>String(a?.race_date||'').localeCompare(String(b?.race_date||''))||TKP_TR_COLLATOR.compare(hip(a?.hippodrome),hip(b?.hippodrome))||(Number(a?.altili_no)||2)-(Number(b?.altili_no)||2)||(Number(a?.id)||0)-(Number(b?.id)||0));
    const filesById=new Map(d.files.map(f=>[String(f?.id),f]));
    d.races=(d.races||[]).slice().sort((a,b)=>{const af=filesById.get(String(a?.file_id))||{},bf=filesById.get(String(b?.file_id))||{};return String(a?.race_date||af?.race_date||'').localeCompare(String(b?.race_date||bf?.race_date||''))||TKP_TR_COLLATOR.compare(hip(a?.hippodrome||af?.hippodrome),hip(b?.hippodrome||bf?.hippodrome))||(Number(a?.altili_no)||Number(af?.altili_no)||2)-(Number(b?.altili_no)||Number(bf?.altili_no)||2)||(Number(a?.leg)||0)-(Number(b?.leg)||0)||(Number(a?._absRaceNo)||0)-(Number(b?._absRaceNo)||0)||(Number(a?.id)||0)-(Number(b?.id)||0);});
    d.files.forEach((file,index)=>{file.archive_date_order=index+1;});d.races.forEach((race,index)=>{race.archive_date_order=index+1;});
   }
  }catch{}
  try{if(typeof invalidateActiveRacesCache==='function')invalidateActiveRacesCache();}catch{}
  try{if(typeof invalidateProfileMatchCache==='function')invalidateProfileMatchCache();}catch{}
  try{if(typeof invalidateWinnerProfileCache==='function')invalidateWinnerProfileCache();}catch{}
  try{if(typeof invalidateConditionStatsCache==='function')invalidateConditionStatsCache();}catch{}
  try{if(typeof invalidateAdaptiveLearningCache==='function')invalidateAdaptiveLearningCache();}catch{}
  try{if(typeof invalidateSideBetCache==='function')invalidateSideBetCache();}catch{}
  try{if(typeof tkpInvalidateLearningModelCaches==='function')tkpInvalidateLearningModelCaches();}catch{}
  try{if(typeof window!=='undefined'&&typeof window.tkpInvalidateIndexes==='function')window.tkpInvalidateIndexes();}catch{}
  try{if(typeof window!=='undefined'&&typeof window.tkpInvalidateFastBacktestCache==='function')window.tkpInvalidateFastBacktestCache();}catch{}
  try{if(typeof window!=='undefined'&&typeof window.tkpInvalidateOnlineRankingModel==='function')window.tkpInvalidateOnlineRankingModel();}catch{}
  try{if(typeof window!=='undefined'&&typeof window.tkpInvalidateFailureLearning==='function')window.tkpInvalidateFailureLearning();}catch{}
  try{if(typeof rulesDirty!=='undefined')rulesDirty=true;}catch{}
  try{if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('tkp:db-changed'));}catch{}
 }
 function historicalSupportMeetings(){
  const d=currentDb();if(!d)return [];
  const {groups}=historicalGroupedMeetings(false),out=[];
  for(const group of groups){
   if(isForeignHip(group.hippodrome))continue;
   const rawSources=historicalSupportSourcesForRaces(group.races);
   const sources=rawSources.filter(source=>!historicalSupportLayerCooling(group,source));
   if(sources.length)out.push({...group,sources,rawSources,historicalSupportUpdate:true});
  }
  return out.sort((a,b)=>String(b.date).localeCompare(String(a.date))||TKP_TR_COLLATOR.compare(String(a.hippodrome),String(b.hippodrome)));
 }

 async function historicalSupportMeetingsAsync(){
  const d=currentDb();if(!d)return [];
  await tkpcUiYield();
  const {groups}=historicalGroupedMeetings(false),out=[];
  await tkpcForEachChunk(groups,group=>{
   if(isForeignHip(group.hippodrome))return;
   const rawSources=historicalSupportSourcesForRaces(group.races);
   const sources=rawSources.filter(source=>!historicalSupportLayerCooling(group,source));
   if(sources.length)out.push({...group,sources,rawSources,historicalSupportUpdate:true});
  },10);
  return out.sort((a,b)=>String(b.date).localeCompare(String(a.date))||TKP_TR_COLLATOR.compare(String(a.hippodrome),String(b.hippodrome)));
 }

 async function refreshHistoricalAnalysisDataAsync(){
  await tkpcUiYield();
  refreshHistoricalAnalysisData();
  await tkpcUiYield();
 }
 async function updateAllHistoricalSupportData(){
  if(busy||activeJobId||activeImportPromise){status('⏳ Başka bir veri işi sürüyor; ikinci kez başlatılmadı.');return false;}
  stopRequested=false;setBusy(true);tkpcBeginHistoricalMaintenance();
  let meetingsProcessed=0,meetingsUpdated=0,meetingsCompleted=0,meetingsPartial=0,meetingsFailed=0,requestCount=0;
  let trMerged=0,supportMerged=0,changed=false,queueStateChanged=false;
  try{
   status('⏳ Eksik katmanlar yerelde belirleniyor; dolu veriler yeniden taranmayacak…');
   await tkpcUiYield();
   const queue=await historicalSupportMeetingsAsync();
   if(!queue.length){
    status('✅ Eksik destek yok · ağ, kayıt, kalibrasyon ve öğrenme yeniden çalıştırılmadı.');
    return true;
   }
   await backupTkpDb();
   const runOne=async(item,index)=>{
    if(stopRequested)return;
   const requested=(item.sources||[]).filter(source=>TKPC_HISTORICAL_SUPPORT_SOURCES.includes(source));
   if(!requested.length)return;
   requestCount++;
   status(`⏳ Eksik destek ${index+1}/${queue.length} · ${item.date} ${tkpcDisplayHip(item.hippodrome)} · ${requested.map(sourceLabel).join(' + ')}`);
   let meetingChanged=false;
   try{
     const scope=sourceRaceScope(item.races);
     const runSupportJob=async(sources,phase)=>{
      const payload=await tkpcResilientFetchJson(API+'/api/v1/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:item.date,hippodrome:item.hippodrome,altiliNo:item.altiliNo,sources,onlyMissing:true,forceRefresh:false,dynamicAltili:true,fastMode:true,historicalSupportUpdate:true,...scope})},{maxAttempts:2,label:`${item.date} ${item.hippodrome} ${phase}`});
      if(!payload?.ok||!payload?.job?.id)throw new Error(payload?.error||(phase+' işi başlatılamadı'));
      activeJobId=payload.job.id;
      const job=await tkpcWaitBackgroundJob(payload.job.id,90000);
      if(!job){try{await fetch(API+'/api/v1/jobs/'+encodeURIComponent(payload.job.id)+'/cancel',{method:'POST'});}catch{}throw new Error('Kaynak 90 saniyede yanıt vermedi; iş iptal edildi');}
      if(job.status==='running')throw new Error('Kaynak işi zaman aşımında kaldı');
      if(job.status==='cancelled')throw new Error(stopRequested?'Kullanıcı durdurdu':'Kaynak işi iptal edildi');
      return job;
     };
     const accountImported=imported=>{
      const delta=(Number(imported?.horseMerged)||0)+(Number(imported?.programLayersCompleted)||0)+(Number(imported?.trPuanApplied)||0)+(Number(imported?.ganyanSupportMerged)||0)+(Number(imported?.supportLayersCompleted)||0);
      trMerged+=Number(imported?.trPuanApplied)||0;
      supportMerged+=Number(imported?.ganyanSupportMerged)||0;
      if(delta>0){changed=true;meetingChanged=true;}
      return delta;
     };
     let primaryJob=null,primaryError=null,importedAny=false;
     try{primaryJob=await runSupportJob(requested,'birincil eksik destek');}
     catch(error){primaryError=error;console.warn('Birincil GC/TJK destek işi alınamadı; Yeni Beygir yedeği denenecek',item,error);}
     if(primaryJob?.files?.length){
      const imported=await importJob(primaryJob.id,primaryJob,{historicalRaces:item.races,historicalMeeting:item,historicalSupportUpdate:true});
      accountImported(imported);importedAny=true;
     }
     // GC sonucu işlendikten sonra hâlâ boş kalan aynı koşular için yalnız GLP ve
     // J-BYG sayfalarını çağır. Böylece Yeni Beygir normal/günlük akışa veya TR,
     // program, sonuç, yorumcu alanlarına hiç girmez.
     const fallbackRequested=historicalFallbackSourcesForRaces(item.races);
     if(fallbackRequested.length&&!stopRequested){
      requestCount++;
      status(`⏳ Eksik destek ${index+1}/${queue.length} · ${item.date} ${tkpcDisplayHip(item.hippodrome)} · GC sonrası ${fallbackRequested.map(sourceLabel).join(' + ')}`);
      const fallbackJob=await runSupportJob(fallbackRequested,'Yeni Beygir yedek destek');
      if(fallbackJob?.files?.length){
       const imported=await importJob(fallbackJob.id,fallbackJob,{historicalRaces:item.races,historicalMeeting:item,historicalSupportUpdate:true});
       accountImported(imported);importedAny=true;
      }else if(!primaryJob?.files?.length){
       throw new Error(String(fallbackJob?.errors?.[0]?.error||primaryError?.message||'GC ve Yeni Beygir kaynaklarında doğrulanmış GLP/J-BYG verisi bulunamadı'));
      }
     }
     if(!importedAny)throw (primaryError||new Error(String(primaryJob?.errors?.[0]?.error||'İstenen kaynaklarda dosya/veri bulunamadı')));
     const stillMissing=historicalSupportSourcesForRaces(item.races);
     for(const source of requested){
      if(stillMissing.includes(source)){markHistoricalSupportLayerNoData(item,source,`Kaynak kontrol edildi; doğrulanmış katman tamamlanmadı. 24 saat beklemede.`);queueStateChanged=true;}
      else{clearHistoricalSupportLayerNoData(item,source);queueStateChanged=true;}
     }
    }catch(error){
     if(!stopRequested){meetingsFailed++;for(const source of requested){markHistoricalSupportLayerNoData(item,source,error);queueStateChanged=true;}console.warn('Eksik destek toplantısı alınamadı',item,error);}
    }finally{
     if(meetingChanged)meetingsUpdated++;
     const remainingLayers=historicalSupportSourcesForRaces(item.races);
     if(!remainingLayers.length)meetingsCompleted++;else if(meetingChanged)meetingsPartial++;
     activeJobId='';meetingsProcessed++;
    }
   };
   // İki toplantı aynı anda: ağ beklemeleri örtüşür, eski Chromium ana iş parçacığı
   // ise her çift arasında nefes alır. Daha yüksek eşzamanlılık RAM/handle darboğazıdır.
   for(let i=0;i<queue.length&&!stopRequested;i+=2){
    await Promise.all(queue.slice(i,i+2).map((item,offset)=>runOne(item,i+offset)));
    await tkpcUiYield();
   }
   if(changed){
    status('💾 Değişen alanlar kalıcı kayda ve kalibrasyona işleniyor…');
    const quality=await applyHistoricalTrainingQualityGateAsync();
    await refreshHistoricalAnalysisDataAsync();
    if(typeof saveDB==='function')await saveDB(false,true);
    const remaining=(await historicalSupportMeetingsAsync()).length;
    const allGroupsNow=historicalGroupedMeetings(false).groups.filter(group=>!isForeignHip(group.hippodrome));
    const rawRemaining=allGroupsNow.filter(group=>historicalSupportSourcesForRaces(group.races).length>0).length;
    const coolingCount=Math.max(0,rawRemaining-remaining);
    status(stopRequested
     ?`🛑 Eksik destek işi durduruldu · ${meetingsProcessed} toplantı kontrol edildi · değişiklikler kaydedildi.`
     :`✅ Eksik destek tamamlandı · işlendi ${meetingsProcessed} · tamamlandı ${meetingsCompleted} · kısmi ${meetingsPartial} · güncellendi ${meetingsUpdated} · TR ${trMerged} koşu · destek ${supportMerged} alan · gerçek kalan ${remaining} · beklemede ${coolingCount} · kalite dışı ${quality.excluded}${meetingsFailed?` · ⚠️ ${meetingsFailed} toplantı alınamadı`:''}.`);
   }else{
    if(queueStateChanged&&typeof saveDB==='function')await saveDB(false,true);
    const remaining=(await historicalSupportMeetingsAsync()).length;
    const allGroupsNow=historicalGroupedMeetings(false).groups.filter(group=>!isForeignHip(group.hippodrome));
    const rawRemaining=allGroupsNow.filter(group=>historicalSupportSourcesForRaces(group.races).length>0).length;
    const coolingCount=Math.max(0,rawRemaining-remaining);
    status(stopRequested
     ?`🛑 Eksik destek toplama durduruldu · veri değişmedi; kayıt ve kalibrasyon çalıştırılmadı. Bu, TJK Sonuç + Accurate işlemi değildir.`
     :`ℹ️ ${requestCount} kaynak işi kontrol edildi fakat yeni alan gelmedi · gerçek kalan ${remaining} · beklemede ${coolingCount} · aynı eksik toplantılar cooldown süresince yeniden ağa gönderilmeyecek${meetingsFailed?` · ⚠️ ${meetingsFailed} toplantı alınamadı`:''}.`);
   }
   return !stopRequested;
  }catch(error){
   console.error('Eksik veri / destek güncellemesi',error);
   status(`❌ Eksik veri / destek güncellemesi başarısız: ${String(error?.message||error)}`);
   return false;
  }finally{
   activeJobId='';setBusy(false);tkpcEndHistoricalMaintenance();
  }
 }

 function tkpcHistoricalResultProgress(){
  const meetings=new Set();let successfulAttempts=0;
  return {
   record(item){
    meetings.add(JSON.stringify([item.date,item.hippodrome,item.altiliNo??null,item.targetFileId??null]));
    successfulAttempts++;
   },
   get completed(){return meetings.size;},
   get attempts(){return successfulAttempts;}
  };
 }
 async function updateAllHistoricalResults(){
  // Sol bakım düğmesi yalnız TJK resmi İlk-5 + ikramiye ve Accurate katmanını kontrol eder.
  // Accurate bazı toplantılarda hiç yayınlanmayabilir; bu durum "veri yok" olarak kalıcı
  // kayda alınır ve aynı toplantı sonraki taramada tekrar tekrar açılmaz.
  const allMeetings=historicalAllMeetings();
  const missingBeforeCooldown=historicalMissingMeetings();
  const cooling=missingBeforeCooldown.filter(historicalNoResultCooling);
  const queue=missingBeforeCooldown.filter(item=>!historicalNoResultCooling(item));
  if(!queue.length){const quality=await applyHistoricalTrainingQualityGateAsync();await refreshHistoricalAnalysisDataAsync();try{if(typeof saveDB==='function')await saveDB(false,true);}catch{}const unsupported=allMeetings.filter(item=>isForeignHip(item.hippodrome)&&historicalNoDataKnown(item,'foreign_official_result')).length;const accurateCooling=allMeetings.filter(item=>!isForeignHip(item.hippodrome)&&historicalNoDataCooling(item,'accurace')).length;status(`✅ ${allMeetings.length} benzersiz toplantı yerelde kontrol edildi · eksik sonuç/Accurate için ağ isteği yok${unsupported?` · ${unsupported} yabancı toplantı resmi kaynak desteklenmiyor olarak ayrıldı`:''}${cooling.length?` · ${cooling.length} TJK sonucu 24 saat beklemede`:''}${accurateCooling?` · ${accurateCooling} Accurate katmanı 24 saat beklemede`:''} · kalite kapısı ${quality.excluded} ağır eksik koşuyu eğitim dışında tuttu · analizler yenilendi.`);return;}
  stopRequested=false;setBusy(true);tkpcBeginHistoricalMaintenance();let completed=0,failed=0,resultAttempts=0,accurateAttempts=0,accurateNoData=0,foreignUnsupported=0;const failedDetails=[];
  const progress=tkpcHistoricalResultProgress();
  const queuedRaceCount=queue.reduce((n,item)=>n+(Array.isArray(item.races)?item.races.length:0),0);
  const d=currentDb();const today=tkpcTurkeyToday();
  const archiveRecordCount=(d?.files||[]).filter(f=>{const dt=String(f?.race_date||'').slice(0,10);return dt&&dt<=today;}).length;
  const allMeetingCount=allMeetings.length;
  const deferred=[];
  // V1.1.300: Sonuç+Accurate taramasında her toplantı sonrası 300MB+ DB yazma yok.
  // İçteki importJob batch'leri bu dış batch'e katılır; 12 toplantıda veya 90 sn'de
  // güvenli checkpoint, finalde tek kesin persist yapılır.
  const resultBatchSupported=typeof beginDbBatch==='function'&&typeof endDbBatch==='function';
  let resultBatchOpen=false,resultBatchDirty=0,resultBatchAt=Date.now();
  const openResultBatch=()=>{if(resultBatchSupported&&!resultBatchOpen){beginDbBatch();resultBatchOpen=true;}};
  const flushResultBatch=async(force=false)=>{
    if(!resultBatchOpen)return;
    if(!force&&resultBatchDirty<12&&Date.now()-resultBatchAt<90000)return;
    await endDbBatch(false);resultBatchOpen=false;resultBatchDirty=0;resultBatchAt=Date.now();
    if(!force)openResultBatch();
  };
  openResultBatch();
  const runOne=async(item,{finalRetry=false,index=0}={})=>{

   const phase=finalRetry?'🔁 Son kontrol':'⏳ Eksik sonuçlar';
   status(`${phase} ${finalRetry?`${index+1}/${deferred.length}`:`${index+1}/${queue.length}`} · ${archiveRecordCount} arşiv kaydı / ${allMeetingCount} toplantı · ${item.date} ${tkpcDisplayHip(item.hippodrome)} · ${item.sources.map(sourceLabel).join(' + ')}`);
   if(item.sources.includes('tjk_result'))resultAttempts++;if(item.sources.includes('accurace'))accurateAttempts++;
   const scope=sourceRaceScope(item.races);
   const response=await fetch(API+'/api/v1/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:item.date,hippodrome:item.hippodrome,altiliNo:item.altiliNo,sources:item.sources,onlyMissing:false,forceRefresh:true,dynamicAltili:true,fastMode:true,historicalSweep:true,historicalFinalRetry:finalRetry,...scope})});
   const payload=await response.json();if(!payload.ok||!payload.job?.id)throw new Error(payload.error||'Güncelleme işi başlatılamadı');activeJobId=payload.job.id;
   const job=await tkpcWaitBackgroundJob(payload.job.id);activeJobId='';if(!job||job.status==='running')throw new Error('Toplantı güncellemesi 20 dakikada tamamlanmadı');if(job.status==='cancelled'){stopRequested=true;throw new Error('Kullanıcı durdurdu');}
   // Accurate tek başına istenmiş ve dosya bulunmamış olabilir. importJob bunu veri-yok
   // olarak kabul eder. TJK sonucu istenmişse importJob resmi dosya yokluğunu gerçek hata yapar.
   const beforeKnown=historicalNoDataKnown(item,'accurace');
   const imported=await importJob(job.id,job,{historicalRaces:item.races,historicalMeeting:item,historicalTop5Only:true,targetFileId:item.targetFileId});
   const afterKnown=historicalNoDataKnown(item,'accurace');if(!beforeKnown&&afterKnown)accurateNoData++;
   if(imported?.foreignOfficialMissing){
    foreignUnsupported++;clearHistoricalNoResult(item);resultBatchDirty++;await flushResultBatch(false);
    return {unsupportedForeign:true};
   }
   clearHistoricalNoResult(item);progress.record(item);completed=progress.completed;resultBatchDirty++;await flushResultBatch(false);
   return {accuratePartial:Boolean(imported?.accuratePartial),accurateApplied:Number(imported?.accurateApplied)||0,accurateExpected:Number(imported?.accurateExpected)||0};
  };
  try{
   try{if(typeof window.tkpNormalizeStoredVisibleTkpScores==='function')window.tkpNormalizeStoredVisibleTkpScores();}catch(error){console.warn('TKP görünür puan migrasyonu uyarısı',error);}
   await backupTkpDb();
   for(let index=0;index<queue.length;index++){
    if(stopRequested)break;const item=queue[index];
    try{
     const outcome=await runOne(item,{index});
     if(outcome?.accuratePartial){
      // TJK sonucu (varsa) kayda girdi; yalnız eksik Accurate koşuları için
      // bir son, hafif deneme planla. Aynı TJK sonucu yeniden indirilmez.
      deferred.push({...item,sources:['accurace']});
      status(`↪️ ${item.date} ${tkpcDisplayHip(item.hippodrome)} · Accurate ${outcome.accurateApplied}/${outcome.accurateExpected||'?'} işlendi; yalnız eksik Accurate için EN SON bir kez daha bakılacak.`);
     }
    }
    catch(error){
     if(stopRequested)break;
     // TJK sonuç işinin kendi bütçesi zaten normal HTTP + tek HTML fallback'tir.
     // Aynı toplantıyı burada ikinci bir job olarak kuyruğun sonuna taşımak, eski
     // sonuçlarda dört taşıma denemesine ve dakikalarca kilitlenmeye yol açıyordu.
     // TJK sonucu içeren işler bu noktada kesin olarak bırakılır; yalnız Accurate-
     // only işler, yayın gecikmesi için mevcut son tur kuyruğunda tutulur.
     if((item.sources||[]).includes('tjk_result')){
      failed++;
      const errorText=String(error?.message||error||'Bilinmeyen hata');
      failedDetails.push({date:item.date,hippodrome:item.hippodrome,sources:[...(item.sources||[])],error:errorText});
      if(/TJK.*sonuç|resmi sonuç|resmî sonuç/i.test(errorText))markHistoricalNoResult(item,error);
      console.warn('Eksik sonuç iki taşıma denemesinden sonra bırakıldı',item,error);
      status(`⏹️ ${item.date} ${tkpcDisplayHip(item.hippodrome)} · normal HTTP + HTML denemesi tamamlandı; bu sonuç için arama bırakıldı.`);
     }else{
      deferred.push(item);
      console.warn('Eksik Accurate ilk tur ertelendi',item,error);
      status(`↪️ ${item.date} ${tkpcDisplayHip(item.hippodrome)} ilk denemede alınamadı; yalnız Accurate için EN SON bir kez daha bakılacak.`);
     }
    }
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   for(let index=0;index<deferred.length&&!stopRequested;index++){
    const item=deferred[index];
    try{
     const outcome=await runOne(item,{finalRetry:true,index});
     if(outcome?.accuratePartial){
      markHistoricalNoData(item,'accurace',`Accurate kısmi kaldı: ${outcome.accurateApplied}/${outcome.accurateExpected||'?'} koşu eşleşti; 24 saat sonra yeniden denenecek.`);
      accurateNoData++;
      status(`ℹ️ ${item.date} ${tkpcDisplayHip(item.hippodrome)} · Accurate ${outcome.accurateApplied}/${outcome.accurateExpected||'?'} işlendi; kalan koşular 24 saat sonra tekrar kontrol edilecek.`);
     }
    }
    catch(error){if(stopRequested)break;failed++;const errorText=String(error?.message||error||'Bilinmeyen hata');failedDetails.push({date:item.date,hippodrome:item.hippodrome,sources:[...(item.sources||[])],error:errorText});if((item.sources||[]).includes('tjk_result'))markHistoricalNoResult(item,error);else {markHistoricalNoData(item,'accurace',`Accurate son deneme başarısız: ${errorText}`);accurateNoData++;}console.warn('Eksik sonuç son kontrol uyarısı',item,error);}
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   const quality=await applyHistoricalTrainingQualityGateAsync();await refreshHistoricalAnalysisDataAsync();
   await flushResultBatch(true);
   const failureSummary=failedDetails.map((entry)=>`${entry.date} ${tkpcDisplayHip(entry.hippodrome)} [${entry.sources.map(sourceLabel).join(' + ')}] — ${entry.error}`).join(' | ');
   status(stopRequested?`🛑 Eksik sonuç güncellemesi durduruldu · ${completed}/${queue.length} toplantı işlendi · ${progress.attempts} başarılı işlem.`:`✅ Eksik sonuç güncellemesi tamamlandı · ${archiveRecordCount} arşiv kaydı / ${allMeetingCount} benzersiz toplantı yerelde kontrol edildi · ${queue.length} eksik toplantı ağdan tarandı · ${completed} benzersiz toplantı işlendi · tekrarlar dahil ${progress.attempts} başarılı işlem · taranan toplantılarda ${queuedRaceCount} kayıtlı koşu · kalite kapısı ${quality.excluded} ağır eksik koşuyu eğitim dışında tuttu, ${quality.restored} düzeltilen koşuyu bütün analizlere geri aldı · TJK Sonuç denemesi ${resultAttempts} · Accurate denemesi ${accurateAttempts} · Accurate veri yok ${accurateNoData}${foreignUnsupported?` · yabancı resmi kaynak desteklenmiyor ${foreignUnsupported}`:''}${cooling.length?` · ${cooling.length} sonuç cooldown'da (kalıcı başarısız, 24 saat beklemede)`:''}${failed?` · ⚠️ gerçek hata ${failed}: ${failureSummary}`:' · gerçek hata 0'} · Altılı/yan bahis/benzer yarış analizleri yenilendi.`);
  }finally{
   try{if(resultBatchOpen)await flushResultBatch(true);}catch(error){console.warn('Sonuç batch kapanış uyarısı',error);}
   activeJobId='';setBusy(false);tkpcEndHistoricalMaintenance();
  }
 }

 async function markHistoricalBulkProvenance(date,hip){
  const d=currentDb();if(!d)return 0;const H=String(hip||'').trim().toUpperCase();
  const files=(d.files||[]).filter(f=>String(f?.race_date||'').slice(0,10)===date&&String(f?.hippodrome||'').trim().toUpperCase()===H);
  let touched=0;for(const f of files){f.historical_backfill=1;f.historical_provenance='REAL_ARCHIVE';f.historical_imported_at=new Date().toISOString();f.historical_snapshot_verified=0;const fid=String(f.id);
   for(const r of (d.races||[]).filter(x=>String(x?.file_id)===fid)){r.historical_backfill=1;r.historical_provenance='REAL_ARCHIVE';r.historical_snapshot_verified=0;
    // Tek seferlik backfill daha önce tamamlandıysa bundan sonra toplanan yarış
    // yeni yarış sayılır ve snapshot ancak gerçek yarış-öncesi yoldan oluşabilir.
    // Eski arşiv migrasyonu henüz çalışmadıysa mevcut kanıt alanları korunur.
    touched++;
   }
  }return touched;
 }
 // V1.1.322 HIZ/TEMİZLİK: tkpcWaitHistoricalQuiet()/setHistoricalBusy()/collectHistorical400()
 // (eski "400 gün" tek-düğme akışı) tamamen kaldırıldı. Üçü de yalnız birbirini
 // besliyordu; collectHistorical400() hiçbir yerden çağrılmıyordu (grep ile doğrulandı) ve
 // hedeflediği #tkpcHistorical400 butonu addPanel() markup'ında hiç yoktu -- işlev, ayrı
 // #tkpcHistoricalUpdate (updateAllHistoricalResults) ve #tkpcHistoricalSupportUpdate
 // (updateAllHistoricalSupportData) butonlarıyla değiştirilmiş, eski akış temizlenmeden kalmış.
 async function health(){try{const r=await fetch(API+'/health',{cache:'no-store'});const j=await r.json();if(!j.ok){status('⚠️ Servis yanıt vermedi');return;}
  const expected=typeof TKP_RUNTIME_VERSION==='string'?TKP_RUNTIME_VERSION:'1.1.333';
  if(String(j.version)!==expected){status(`⚠️ Veri Toplayıcı eski sürüm · V${j.version||'?'} (beklenen V${expected}). TKP_VERI_TOPLAYICI_BASLAT.bat dosyasını yeniden çalıştır.`);return;}
  if(j?.browserAutomation?.packageReady===false){status(`⚠️ Veri Toplayıcı bağlı · V${j.version} · Playwright eksik. TKP_VERI_TOPLAYICI_KUR.bat dosyasını bir kez çalıştır.`);return;}status(`✅ Veri Toplayıcı bağlı · V${j.version} · tarayıcı otomasyonu hazır`);}catch{status('⚠️ Veri Toplayıcı kapalı. TKP_VERI_TOPLAYICI_BASLAT.bat dosyasını çalıştır.');}}
 function setBusy(on){busy=Boolean(on);['#tkpcCollect','#tkpcResult','#tkpcHistoricalSupportUpdate','#tkpcHistoricalUpdate','#tkpcSimilar','#tkpcXScan','#tkpcXRefresh'].forEach(sel=>{const b=$(sel);if(b)b.disabled=busy;});const stop=$('#tkpcStop');if(stop){stop.disabled=!busy;stop.style.display=busy?'inline-block':'none';}}
 async function stopCollection(){
  stopRequested=true;const id=activeJobId;const btn=$('#tkpcStop');if(btn)btn.disabled=true;status('🛑 Veri toplama durduruluyor…');
  if(activePollTimer){clearTimeout(activePollTimer);clearInterval(activePollTimer);activePollTimer=null;}
  try{if(id){const r=await fetch(API+'/api/v1/jobs/'+encodeURIComponent(id)+'/cancel',{method:'POST'});const j=await r.json();if(!j.ok)throw new Error(j.error||'İş durdurulamadı');}}
  catch(e){status('❌ Durdurma başarısız: '+e.message);return;}
  finally{activeJobId='';setBusy(false);}
  status('🛑 Veri toplama kullanıcı tarafından durduruldu. Yeni sayfa açılmayacak.');
 }
 async function collect(resultOnly){
  // Y.PUAN için hızlı canlı mod: TJK programı yarış kartının temelidir; yorumcu
  // desteği dört sitenin hazır kupon ekranlarından, TR PUAN ise Ganyan Canavarı
  // programının P sütunundan gelir. Harici form/tip siteleri bu düğmenin toplama
  // süresini uzatmaz.
  // Toplama hedefini ekrandaki aktif yarış kaydıyla eşitle. Alan eski bir
  // toplantıdan kalmışsa istek yanlış hipodroma gitmesin.
  const activeRaces=xRaces();
  const activeHip=String(activeRaces?.find(r=>r?.hippodrome)?.hippodrome||'').trim();
  const hipInput=$('#tkpcHip');
  if(activeHip&&hipInput&&tkpcNormalizeHip(hipInput.value)!==tkpcNormalizeHip(activeHip)){
   hipInput.value=tkpcDisplayHip(activeHip);
   status(`ℹ️ Toplama hipodromu aktif kayıtla eşitlendi: ${tkpcDisplayHip(activeHip)}`);
  }
  let sources=['tjk_program','ganyan_canavari','misli','bitalih','hipodrom','editor'];
  if(resultOnly){
   const needs=resultCollectionNeeds();sources=needs.sources;
   if(!sources.length){
    status('✅ Sonuç ve Accurate zaten tam · hiçbir site açılmadı, dosya yeniden yazılmadı.');
    return;
   }
  }
  const resultLabel=sources.length===2?'TJK Sonuç + Accurate':sources[0]==='tjk_result'?'yalnız eksik TJK Sonuç':'yalnız eksik Accurate';
  stopRequested=false;setBusy(true);status(resultOnly?`⏳ ${resultLabel} alınıyor…`:'⏳ 2. Altılı verileri kontrol ediliyor · mevcut kaynaklar yeniden açılmaz…');
  try{const scope=sourceRaceScope(xRaces());const body={date:$('#tkpcDate').value,hippodrome:$('#tkpcHip').value,sources,altiliNo:2,dynamicAltili:true,fastMode:true,onlyMissing:Boolean(resultOnly),resultOnly:Boolean(resultOnly),forceRefresh:Boolean(resultOnly),...scope};let r=await fetch(API+'/api/v1/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});let j=await r.json();if(!j.ok)throw new Error(j.error||'Başlatılamadı');activeJobId=j.job.id;poll(j.job.id);}catch(e){activeJobId='';setBusy(false);status('❌ '+e.message);}
 }
 async function poll(id){
  // V1.1.280 KARARLILIK KÖK FIX: async setInterval ağ gecikmesinde üst üste
  // poll çağrıları başlatabiliyordu. Aynı job için iki fetch aynı anda dönerse
  // preview/import iki kez tetiklenebilir, busy state/cache/persist yarışabilirdi.
  // Artık tek-uçuş recursive timeout kullanılır; bir poll bitmeden yenisi başlamaz.
  const started=Date.now();
  const pollJob=async()=>{
   if(stopRequested||activeJobId!==id){activePollTimer=null;return;}
   let controller=null,abortTimer=null;
   try{
    if(typeof AbortController!=='undefined'){
     controller=new AbortController();abortTimer=setTimeout(()=>controller.abort(),15000);
    }
    const r=await fetch(API+'/api/v1/jobs/'+id,controller?{signal:controller.signal}:undefined);
    if(!r.ok)throw new Error(`Toplayıcı durum HTTP ${r.status}`);
    const j=await r.json();const job=j?.job;if(!job)throw new Error('Toplayıcı job durumu boş döndü');
    if(job.status==='running'){
     const p=job.progress||{};const src=job.currentSource?` · ${sourceLabel(job.currentSource)}`:'';
     status(`⏳ ${p.done||0}/${p.total||'?'} kaynak işlendi · ${(job.files||[]).length} dosya hazır${src}`);
     if(Date.now()-started>1200000){await stopCollection();status('🛑 Veri toplama 20 dakika sınırında durduruldu.');return;}
     activePollTimer=setTimeout(pollJob,350);return;
    }
    activePollTimer=null;activeJobId='';
    if(job.status==='cancelled'){setBusy(false);status('🛑 Veri toplama durduruldu.');return;}
    if((job.files||[]).length)await previewAndImport(id,job);
    else{setBusy(false);status('❌ Hiçbir ana dosya alınamadı: '+((job.errors||[]).find(x=>x.severity==='critical')?.error||(job.errors||[])[0]?.error||'Bilinmeyen hata'));}
   }catch(e){
    activePollTimer=null;
    // Tek bir geçici poll zaman aşımı bütün işi öldürmesin. Job toplam 20 dakika
    // sınırı içindeyse tekrar dene; gerçek servis/parse hatasında kullanıcıya durum ver.
    const transient=e?.name==='AbortError'||/fetch|network|HTTP 5\d\d/i.test(String(e?.message||e));
    if(transient&&activeJobId===id&&!stopRequested&&Date.now()-started<1200000){
     status('⚠️ Toplayıcı durum bağlantısı gecikti; iş korunuyor, yeniden kontrol ediliyor…');
     activePollTimer=setTimeout(pollJob,900);return;
    }
    activeJobId='';setBusy(false);status('❌ '+String(e?.message||e));
   }finally{if(abortTimer)clearTimeout(abortTimer);}
  };
  activePollTimer=setTimeout(pollJob,0);
 }
 function sourceLabel(s){return ({tjk_program:'TJK Program',tjk_result:'TJK Sonuç',ganyan_canavari:'Ganyan Canavarı TR',ganyan_canavari_glp:'Ganyan Canavarı Galoplar Özet',ganyan_canavari_jbyg:'Ganyan Canavarı J-BYG',yenibeygir_jbyg:'Yeni Beygir J-BYG yedeği',yenibeygir_glp:'Yeni Beygir GLP yedeği',misli:'Misli',liderform:'Liderform Uzmanları',accurace:'Accurate',nyra:'NYRA',equibase:'Equibase',attheraces:'At The Races',hipodrom:'Hipodrom.com',bitalih:"Bi'Talih",editor:'AtYarisi.com',clubhipico:'Club Hípico Santiago',clubconcepcion:'Club Hípico Concepción',hkjc:'HKJC',francegalop:'France Galop',goldcircle:'Gold Circle',racingpost:'Racing Post',racenet:'Racenet'})[s]||s;}
 function resultTransportNote(job){
  const t=job?.transportBySource?.tjk_result||job?.resultTransport||{};
  const direct=Number(t.direct_http_json||0)+Number(t.direct_http_html||0);
  const fallback=Number(t.browser_json_fallback||0)+Number(t.browser_html_fallback||0);
  if(direct&&!fallback)return ' · TJK sonuç doğrudan HTTP ile alındı; HTML penceresi açılmadı';
  if(fallback)return ` · TJK HTML yedeği ${fallback} kez gerekti`;
  return '';
 }
 function toFile(f){
  // 16. HIZ: Uint8Array.from(callback) büyük HTML/ODS base64'lerinde gereksiz
  // callback maliyeti yaratıyordu. Düz typed-array döngüsü aynı byte'ı belirgin
  // daha az GC ile üretir; içerik ve SHA değişmez.
  const raw=atob(f.base64||''),bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return tkpcRememberCollectorProvenance(new File([bytes],f.name,{type:f.type||'text/html'}),f);
 }
 async function toFileResponsive(f){
  const encoded=String(f?.base64||'');
  // Büyük collector çıktısını tek atob + tek dev Uint8Array ile çevirmek ana ekranı
  // uzun süre kilitliyordu. Base64 dört karakter sınırında parçalara ayrılır; her
  // parçadan sonra tarayıcı olay kuyruğuna dönülür. Dosya baytları birebir aynıdır.
  if(encoded.length<4*1024*1024)return toFile(f);
  const parts=[],chunkChars=4*1024*1024;
  for(let offset=0;offset<encoded.length;offset+=chunkChars){
   const raw=atob(encoded.slice(offset,Math.min(encoded.length,offset+chunkChars)));
   const bytes=new Uint8Array(raw.length);
   for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
   parts.push(bytes);
   if(typeof tkpYield==='function')await tkpYield();
   else await new Promise(resolve=>setTimeout(resolve,0));
  }
  return tkpcRememberCollectorProvenance(new File(parts,f.name,{type:f.type||'text/html'}),f);
 }
 async function triggerInput(input,files){
  if(!input||typeof input.onchange!=='function')throw new Error('TKP içe aktarma motoru hazır değil');
  const dt=new DataTransfer();
  for(const f of files){dt.items.add(await toFileResponsive(f));}
  await input.onchange({target:{files:dt.files,value:''}});
 }
 async function previewAndImport(id,job,options={}){
  // V1.1.280 RE-ENTRANCY KİLİDİ: aynı collector job'ı poll/manual yolundan iki kez
  // preview/import'a girerse aynı dosyaları iki kez parse/persist etme. Aynı job
  // mevcut Promise'i paylaşır; farklı bir job aktifken ikinci import açık hata verir.
  id=String(id||'');
  if(activeImportPromise){
   if(activeImportJobId===id)return activeImportPromise;
   throw new Error(`Başka bir veri aktarımı halen sürüyor (${activeImportJobId||'bilinmeyen job'}).`);
  }
  activeImportJobId=id;
  activeImportPromise=(async()=>{
   const q=job.quality||{};status(`⏳ Dosyalar doğrulandı · kalite %${q.score??0} · TKP'ye aktarılıyor…`);
   const transferStarted=typeof performance!=='undefined'?performance.now():Date.now();
   // Hash karşılaştırması importJob içinde önce yapılır. Veri zaten aynıysa büyük
   // eski-IDB yedeğini boşuna kopyalama; gerçek değişiklikte yedek yine zorunludur.
   try{return await importJob(id,job,{backupBeforeImport:true,batchPersist:true,...options});}finally{
    const transferMs=Math.round(((typeof performance!=='undefined'?performance.now():Date.now())-transferStarted)*10)/10;
    const statusNode=$('#tkpcStatus');if(statusNode)statusNode.dataset.lastTransferMs=String(transferMs);
    setBusy(false);
   }
  })();
  try{return await activeImportPromise;}
  finally{activeImportPromise=null;activeImportJobId='';}
 }
 async function backupTkpDb(){
  try{
   // Yeni parçalı IndexedDB v2, dev JSON kopyalamak yerine aktif manifesti
   // checkpoint olarak işaretler. İşlem O(1)'dir ve collector aktarımı sırasında
   // ana ekranı kilitlemez. Eski paketle açılırsa legacy yedek yolu korunur.
   if(typeof window.tkpCreateStorageCheckpoint==='function'){
    const key=await window.tkpCreateStorageCheckpoint('collector-before-import');
    if(key)return key;
   }
   const req=indexedDB.open('tkp_core_idb_v1',1);
   await new Promise((resolve,reject)=>{req.onsuccess=resolve;req.onerror=reject;});
   const d=req.result;const tx=d.transaction('kv','readwrite');const st=tx.objectStore('kv');const get=st.get('tkp_core_db_v1');
   await new Promise((resolve,reject)=>{get.onsuccess=()=>{if(get.result)st.put(get.result,'tkp_collector_before_last_import');resolve();};get.onerror=reject;});
   return 'legacy:tkp_collector_before_last_import';
  }catch(e){console.warn('TKP aktarım öncesi yedek alınamadı',e);return null;}
 }
 function collectorFileHashes(files){
  const out={};
  for(const file of (files||[])){
   const sha=String(file?.sha256||'').trim();if(!sha)continue;
   out[`${String(file?.source||'unknown')}::${String(file?.name||'')}`]=sha;
  }
  return out;
 }
 function sameCollectorHashes(left,right){
  const existing=left&&typeof left==='object'?left:{};
  const incoming=Object.entries(right||{});
  // Son AGF yalnız TJK_PROGRAM getirirken ilk toplama TJK + yorumcu + GLP/J-BYG
  // hashlerini içerir. Gelen katmanı alt-küme olarak karşılaştır: bütün gelen SHA'lar
  // aynıysa içerik değişmemiştir; yeni/değişmiş tek bir kaynak varsa aktarım sürer.
  return incoming.length>0&&incoming.every(([key,sha])=>String(existing[key]||'')===String(sha||''));
 }
 function collectorHorseKey(value){
  try{if(typeof baseHorseName==='function')return baseHorseName(value);}
  catch{}
  return String(value||'').trim().toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9ÇĞİÖŞÜ]+/g,' ' ).replace(/\s+/g,' ').trim();
 }
 function collectorHorseNo(value){return String(value||'').match(/^\s*\d+/)?.[0]||'';}
 function collectorHorseMatch(race,incoming){
  const horses=Array.isArray(race?.horses)?race.horses:[];
  const incomingNo=collectorHorseNo(incoming?.horse_no||incoming?.no||incoming?.start_no);
  const incomingName=collectorHorseKey(findHorseName(incoming)||incoming?.horse_name||incoming?.name||'');
  // Kaynaklar arası bağlama sırası kilitlidir: at no > normalize ad.
  // İsim ancak numara yoksa kullanılır; böylece aynı ada sahip/ekürili atlar
  // yanlış satıra yazılmaz. Eşleşmeyen zenginleştirme satırı TJK tabanına yeni
  // at eklemez ve mevcut TJK atını da silmez.
  const byNo=incomingNo?horses.find(h=>collectorHorseNo(h?.horse_no)===incomingNo):null;
  if(byNo)return byNo;
  return incomingName?horses.find(h=>collectorHorseKey(findHorseName(h)||h?.horse_name||'')===incomingName)||null:null;
 }
 function collectorMeetingRecord(meeting){
  const d=currentDb();if(!d)return null;
  const date=String(meeting?.date||'').slice(0,10),alt=Math.max(1,Number(meeting?.altiliNo)||2);
  const hip=value=>{try{return typeof canonicalHippodrome==='function'?canonicalHippodrome(value):String(value||'').trim().toUpperCase();}catch{return String(value||'').trim().toUpperCase();}};
  const candidates=(d.files||[]).filter(file=>String(file?.race_date||'').slice(0,10)===date&&hip(file?.hippodrome)===hip(meeting?.hippodrome)&&(Number(file?.altili_no)||2)===alt);
  return candidates.sort((a,b)=>(b?.record_type==='PREDICTION_QC'?1:0)-(a?.record_type==='PREDICTION_QC'?1:0)||(b?.status==='ACTIVE'?1:0)-(a?.status==='ACTIVE'?1:0)||Number(b?.id||0)-Number(a?.id||0))[0]||null;
 }
 async function mergeHistoricalTjkProgram(mainFile,targetRaces,meeting){
  if(!mainFile||!Array.isArray(targetRaces)||!targetRaces.length)return {horseMerged:0,programLayersCompleted:0};
  if(typeof parseTjkProgramHTML!=='function')throw new Error('TJK program ayrıştırıcısı hazır değil');
  const text=await toFile(mainFile).text();
  const parsed=parseTjkProgramHTML(text,mainFile.name,Number(meeting?.altiliNo)||2,meeting?.hippodrome||'');
  // Tarihsel TJK allowlist: yalnız program tabanı ve programda gerçekten bulunan
  // ST/KG/Kulvar/handikap/derece/son-form/kimlik alanları. J-BYG, çift oranı,
  // galop ve idman alanları TJK'den bu birleştirmeye giremez.
  const fields=['agf','agf_rank','kg','weight','weight_kg','start_no','st','start','kulvar','start_box','hndkp','handicap','hp','best_time','degree','drc','son6_raw','tjk_at_id','jockey_name','jokey_name','jockey_id','trainer_name','antrenor_name','trainer_id'];
  let horseMerged=0,programLayersCompleted=0;
  for(const incomingRace of (parsed?.races||[])){
   const matchingRaces=targetRaces.filter(r=>(incomingRace._absRaceNo!=null&&r?._absRaceNo!=null&&Number(incomingRace._absRaceNo)===Number(r._absRaceNo))||Number(incomingRace.leg)===Number(r?.leg));
   for(const targetRace of matchingRaces){
    const layerWasComplete=historicalSupportLayerComplete(targetRace,'tjk_program',['TJK_PROGRAM']);
    if(incomingRace?.tjk_race_time && (!targetRace.tjk_race_time||String(targetRace.tjk_race_time).trim()==='-')){targetRace.tjk_race_time=incomingRace.tjk_race_time;if(!targetRace.program_source)targetRace.program_source='TJK_PROGRAM';}
    for(const incoming of (incomingRace.horses||[])){
     let target=collectorHorseMatch(targetRace,incoming);
     if(!target){
      // TJK programı ana listedir. Arşivde daha önce eksik kalmış bir TJK atı
      // varsa, zenginleştirme satırını kaybetme; yalnız kimliği bulunan satırı
      // geri ekle. Başka kaynak satırları TJK tabanına yeni at ekleyemez.
      const restoredName=findHorseName(incoming)||incoming?.horse_name||incoming?.name||'';
      const restoredNo=incoming?.horse_no||incoming?.no||'';
      if(!collectorHorseKey(restoredName)&&!collectorHorseNo(restoredNo))continue;
      // `...incoming` kullanma: parser'a ileride yeni bir alan eklense dahi TJK
      // tarihsel yolu GLP/J-BYG/idman alanını dolaylı olarak taşıyamaz.
      target={horse_no:restoredNo,horse_name:restoredName,finish_position:null,winner:0,bmb:0};
      targetRace.horses=Array.isArray(targetRace.horses)?targetRace.horses:[];
      targetRace.horses.push(target);horseMerged++;
     }
     let changed=false;
     for(const field of fields){
      const value=incoming?.[field];if(value===null||value===undefined||value==='')continue;
      const current=target?.[field];const blank=current===null||current===undefined||String(current).trim()===''||String(current).trim()==='-'||(['kg','weight','start_no','st','start','kulvar','start_box'].includes(field)&&Number(current)===0);
      if(blank){target[field]=value;changed=true;}
     }
     if(changed)horseMerged++;
    }
    targetRace.support_layers={...(targetRace.support_layers||{}),tjk_program:{complete:true,source:'TJK_PROGRAM',asof:meeting?.date||targetRace?.race_date||''}};
    if(!layerWasComplete)programLayersCompleted++;
   }
  }
  return {horseMerged,programLayersCompleted};
 }
 async function mergeHistoricalTrPuanFiles(fileRows,targetRaces,meeting){
  if(!Array.isArray(fileRows)||!fileRows.length||!Array.isArray(targetRaces)||!targetRaces.length)return {trPuanApplied:0,trPuanMatchedHorses:0};
  if(typeof tkpParseGanyanCanavariTR!=='function')throw new Error('Ganyan Canavarı TR PUAN ayrıştırıcısı hazır değil');
  let trPuanApplied=0,trPuanMatchedHorses=0,ganyanSupportMerged=0,ganyanJockeyMerged=0;
  const normName=collectorHorseKey;
  for(const fileData of fileRows){
   const text=await toFile(fileData).text();let records=[];
   try{records=tkpParseGanyanCanavariTR(text,{date:meeting?.date||'',hip:meeting?.hippodrome||''})||[];}catch(error){console.warn('TR PUAN ayrıştırma uyarısı',error);continue;}
   for(const rec of records){
    const supportPayload={file:{race_date:meeting?.date||'',hippodrome:meeting?.hippodrome||''},races:targetRaces};
    if(typeof tkpSupportMetaMatches==='function'&&!tkpSupportMetaMatches(supportPayload,rec))continue;
    const targetRace=typeof tkpSupportRace==='function'?tkpSupportRace(supportPayload,rec?.raceNo,rec?.rows||[]):targetRaces.find(r=>Number(r?._absRaceNo||r?.leg)===Number(rec?.raceNo));if(!targetRace)continue;
    const byNo=new Map((targetRace.horses||[]).map(h=>[collectorHorseNo(h?.horse_no),h]).filter(([no])=>no));
    const byName=new Map((targetRace.horses||[]).map(h=>[normName(h?.horse_name||''),h]));
    let raceChanged=0,raceMatched=0;
    for(const row of (rec?.rows||[])){
     // GC p_atno bazı yanıtlarda dahili kimliktir; at adı birincil, numara yedek anahtardır.
     const target=typeof tkpSupportHorse==='function'?tkpSupportHorse(targetRace,row):(row?.name?byName.get(normName(row.name)):byNo.get(collectorHorseNo(row?.no||row?.horse_no)));if(!target)continue;
     trPuanMatchedHorses++;raceMatched++;
     const value=Number(row?.tr),asof=tkpcSupportIsoDate(rec?.date||meeting?.date||targetRace?.race_date||'');
     if(Number.isFinite(value)&&value>0&&(Number(target.tr_ganyan)!==value||Number(target.tr_puan)!==value||target.tr_ganyan_source!=='GANYAN_CANAVARI_TR'||target.tr_ganyan_metric!=='GANYAN_CANAVARI_PROGRAM_P_COLUMN'||String(target.tr_ganyan_asof_date||'')!==String(asof))){target.tr_ganyan=value;target.tr_puan=value;target.tr_ganyan_source='GANYAN_CANAVARI_TR';target.tr_ganyan_metric='GANYAN_CANAVARI_PROGRAM_P_COLUMN';target.tr_ganyan_asof_date=asof;raceChanged++;}
     else if(Number.isFinite(value)&&value<=0){/* GC 0/boş = eksik veri; daha önce doğrulanmış TR PUAN'ı asla silme. */}
     // ST/Kulvar yalnız TJK Program'dan gelir; Ganyan Canavarı TR katmanı bunu
     // yazamaz. Böylece kaynak sahipliği ve eski ST değeri korunur.
      const jockeyCurrent=target.jockey_name??target.jokey_name;
      if((jockeyCurrent==null||String(jockeyCurrent).trim()===''||String(jockeyCurrent).trim()==='-')&&String(row?.jockey_name||'').trim()){target.jockey_name=String(row.jockey_name).trim();target.jockey_source='GANYAN_CANAVARI';raceChanged++;ganyanSupportMerged++;ganyanJockeyMerged++;}
      const trainerCurrent=target.trainer_name??target.antrenor_name;
      if((trainerCurrent==null||String(trainerCurrent).trim()===''||String(trainerCurrent).trim()==='-')&&String(row?.trainer_name||'').trim()){target.trainer_name=String(row.trainer_name).trim();raceChanged++;ganyanSupportMerged++;}
    }
    if(raceChanged)trPuanApplied++;
    if(raceMatched){
     const asof=tkpcSupportIsoDate(rec?.date||meeting?.date||targetRace?.race_date||'');
     const eligible=(targetRace.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
     const applied=eligible.filter(h=>Number(h.tr_ganyan)>0&&h.tr_ganyan_source==='GANYAN_CANAVARI_TR'&&tkpcSupportIsoDate(h.tr_ganyan_asof_date)===asof).length;
     targetRace.support_layers={...(targetRace.support_layers||{}),tr:{complete:eligible.length>0&&applied===eligible.length,source:'GANYAN_CANAVARI_TR',metric:'GANYAN_CANAVARI_PROGRAM_P_COLUMN',asof,eligible:eligible.length,applied}};
    }
   }
  }
  return {trPuanApplied,trPuanMatchedHorses,ganyanSupportMerged,ganyanJockeyMerged,ganyanGlpMerged:0};
 }
 async function mergeHistoricalSupportFiles(fileRows,targetRaces,meeting){
  const rows=Array.isArray(fileRows)?fileRows:[],payload={file:{race_date:meeting?.date||'',hippodrome:meeting?.hippodrome||''},races:targetRaces||[]};
  const before=historicalSupportCoverage(targetRaces);
  const sourceFile=(f,source,pattern)=>String(f?.source||'').trim().toLowerCase()===source||pattern.test(String(f?.name||''));
  const trFiles=rows.filter(f=>sourceFile(f,'ganyan_canavari',/^GANYAN_CANAVARI_TR_PUAN.*\.(?:json|html?)$/i));
  const base=await mergeHistoricalTrPuanFiles(trFiles,targetRaces,meeting);
  let ganyanGlpMerged=0,ganyanJbygMerged=0,yeniBeygirGlpMerged=0,yeniBeygirJbygMerged=0;
  for(const f of rows.filter(x=>sourceFile(x,'ganyan_canavari_glp',/^GANYAN_CANAVARI_GLP_OZET.*\.(?:json|html?)$/i))){try{const text=await toFile(f).text(),parsed=tkpParseGanyanCanavariGlpOzet(text,{date:meeting?.date||'',hip:meeting?.hippodrome||'',name:f.name});ganyanGlpMerged+=Number(tkpApplyGanyanCanavariGlpOzet(payload,parsed)?.applied)||0;}catch(error){console.warn('GC Galoplar Özet tarihsel birleştirme uyarısı',f?.name,error);}}
  for(const f of rows.filter(x=>sourceFile(x,'ganyan_canavari_jbyg',/^GANYAN_CANAVARI_JBYG.*\.json$/i))){try{const text=await toFile(f).text(),parsed=tkpParseGanyanCanavariJByg(text,{date:meeting?.date||'',hip:meeting?.hippodrome||''});ganyanJbygMerged+=Number(tkpApplyGanyanCanavariJByg(payload,parsed)?.applied)||0;}catch(error){console.warn('GC J-BYG tarihsel birleştirme uyarısı',f?.name,error);}}
  // Bu iki dosya yalnız ikinci aşamadaki yedek çalışmadan gelebilir. Ayrıştırıcı
  // sadece GLP/J-BYG alanına yazar; GC kaynaklı değer varsa uygulayıcı onu korur.
  for(const f of rows.filter(x=>sourceFile(x,'yenibeygir_glp',/^YENIBEYGIR_GLP_FALLBACK.*\.html?$/i))){try{const text=await toFile(f).text(),meta={date:meeting?.date||'',hip:meeting?.hippodrome||'',name:f.name},parsed=tkpParseYeniBeygirGlp(text,meta);yeniBeygirGlpMerged+=Number(tkpApplyYeniBeygirGlp(payload,parsed,meta)?.applied)||0;}catch(error){console.warn('Yeni Beygir GLP yedek birleştirme uyarısı',f?.name,error);}}
  for(const f of rows.filter(x=>sourceFile(x,'yenibeygir_jbyg',/^YENIBEYGIR_JBYG_FALLBACK.*\.html?$/i))){try{const text=await toFile(f).text(),meta={date:meeting?.date||'',hip:meeting?.hippodrome||'',name:f.name},parsed=tkpParseYeniBeygirJByg(text,meta);yeniBeygirJbygMerged+=Number(tkpApplyYeniBeygirJByg(payload,parsed,meta)?.applied)||0;}catch(error){console.warn('Yeni Beygir J-BYG yedek birleştirme uyarısı',f?.name,error);}}
  const after=historicalSupportCoverage(targetRaces);
  const supportLayersCompleted=Math.max(0,after.tr-before.tr)+Math.max(0,after.glp-before.glp)+Math.max(0,after.jbyg-before.jbyg);
  return {...base,ganyanGlpMerged,ganyanJbygMerged,yeniBeygirGlpMerged,yeniBeygirJbygMerged,supportLayersCompleted,supportCoverage:after,ganyanSupportMerged:Number(base.ganyanSupportMerged||0)+ganyanGlpMerged+ganyanJbygMerged+yeniBeygirGlpMerged+yeniBeygirJbygMerged};
}
 function tkpcRequestedSupportFiles(files,sources){
  const requested=new Set((sources||[]).map(s=>String(s).toLowerCase()));
  const legacySource=name=>/^GANYAN_CANAVARI_TR_PUAN/i.test(name)?'ganyan_canavari':/^GANYAN_CANAVARI_GLP_OZET/i.test(name)?'ganyan_canavari_glp':/^GANYAN_CANAVARI_JBYG/i.test(name)?'ganyan_canavari_jbyg':/^YENIBEYGIR_GLP_FALLBACK/i.test(name)?'yenibeygir_glp':/^YENIBEYGIR_JBYG_FALLBACK/i.test(name)?'yenibeygir_jbyg':/^TJK_PROGRAM\.html$/i.test(name)?'tjk_program':'';
  return (files||[]).filter(f=>{const source=String(f?.source||'').trim().toLowerCase()||legacySource(String(f?.name||''));return requested.has(source)&&TKPC_HISTORICAL_SUPPORT_SOURCES.includes(source);});
 }
 async function importJob(id,job,options={}){
  window.__tkpCollectorImportDepth=(Number(window.__tkpCollectorImportDepth)||0)+1;window.__tkpCollectorImportActive=true;
  try{
  const foreignMeeting=isForeignHip(job?.meeting?.hippodrome||$('#tkpcHip')?.value);
  const r=await fetch(API+'/api/v1/jobs/'+id+'/files');const j=await r.json();
  if(options.historicalSupportUpdate)j.files=tkpcRequestedSupportFiles(j.files,job.sources);
  // R16.22 KAPSAM KİLİDİ: TJK Sonuç + Accurate bakım işi, collector klasöründe
  // önceki bir tam toplamadan kalmış TJK Program / GC TR / yorumcu dosyaları bulunsa
  // bile yalnız bu job'da AÇIKÇA istenen iki kaynağı okuyabilir. Collector manifesti
  // geçmiş dosyaları birleştirse dahi bakım yolu başka katmana dokunmaz.
  const requestedResultSources=new Set((job.sources||[]).map(x=>String(x||'').trim().toLowerCase()));
  const officialResultRequested=requestedResultSources.has('tjk_result');
  const accurateRequested=requestedResultSources.has('accurace');
  const resultMode=officialResultRequested||accurateRequested;
  const main=resultMode?null:j.files.find(f=>/^TJK_PROGRAM\.html$/i.test(f.name));
  const resultFiles=officialResultRequested
   ?j.files.filter(f=>String(f?.source||'').trim().toLowerCase()==='tjk_result'||/^TJK_SONUC\.html$/i.test(String(f?.name||'')))
   :[];
  const incomingHashes=collectorFileHashes(j.files),existingRecord=!resultMode&&!options.historicalRaces?.length?collectorMeetingRecord(job.meeting):null;
  if(existingRecord&&sameCollectorHashes(existingRecord.collector_source_hashes,incomingHashes)&&!tkpYpuanPolicyRequiresImport(existingRecord,j.files)){
   let opened=false;
   try{if(typeof renderSavedPredictionByFileId==='function')opened=Boolean(await renderSavedPredictionByFileId(existingRecord.id));}catch(error){console.warn('Kayıtlı toplantı açma uyarısı',error);}
   status(`✅ Veri aynı · siteler açılmadı, dosyalar ve yarış kaydı yeniden yazılmadı${opened?' · kayıtlı tahmin açıldı':''}.`);
   return {reused:true,recordId:existingRecord.id};
  }
  const importCheckpoint=options.backupBeforeImport?await backupTkpDb():null;
  let historicalMerge={horseMerged:0};
  if(main&&options.historicalRaces?.length)historicalMerge=await mergeHistoricalTjkProgram(main,options.historicalRaces,options.historicalMeeting||{});
  if(options.historicalSupportUpdate){
   const supportMerge=await mergeHistoricalSupportFiles(j.files,options.historicalRaces||[],options.historicalMeeting||{});
   return {...historicalMerge,...supportMerge};
  }
  if(!main&&!resultMode){
   // KÖK FIX: eski mesaj yalnız hata SAYISINI gösteriyordu ("Kaynak uyarısı: 6"),
   // asıl nedeni (zaman aşımı / sayfa yapısı değişti / ağ hatası) hiç görünmüyordu.
   // Artık tjk_program'a ait gerçek hata metinleri doğrudan mesaja ekleniyor.
   const tjkErrors=(job.errors||[]).filter(x=>x.source==='tjk_program');
   const reason=tjkErrors.length?[...new Set(tjkErrors.map(x=>x.error).filter(Boolean))].slice(0,3).join(' | '):'TJK için hiç deneme kaydı yok (kaynak listede olmayabilir)';
   throw new Error(`TJK Program alınamadı (${tjkErrors.length||0} URL denemesi başarısız): ${reason}. ${job.files.length} yardımcı dosya var, toplam ${job.errors.length} kaynak uyarısı.`);
  }
  if(resultMode){
   const collectorLayerBatchSupported=typeof beginDbBatch==='function'&&typeof endDbBatch==='function';
   if(collectorLayerBatchSupported) beginDbBatch();
   window.__tkpCollectorLayerBatchActive=true;
   try{
   let foreignOfficialMissing=false;
   const accurateFiles=accurateRequested
    ?j.files.filter(f=>String(f?.source||'').trim().toLowerCase()==='accurace'||/^ACCURACE(?:_\d{4}-\d{2}-\d{2}_[A-Z]+)?_R\d+\.html$/i.test(String(f?.name||'')))
    :[];
   const accurateExpectedRaces=new Set((options.historicalMeeting?.races||options.historicalRaces||[]).map(r=>Number(r?._absRaceNo||r?.race_no||r?.raceNo)).filter(n=>Number.isInteger(n)&&n>0)).size;
   const accurateExpected=accurateExpectedRaces||Math.max(1,Math.min(6,Math.max(accurateFiles.length,Number(options?.raceTo||0)-Number(options?.raceFrom||0)+1||0)));
   let accurateApplied=0,accuratePartial=null;
   if(officialResultRequested && !resultFiles.length && !foreignMeeting){
    throw new Error('Resmi sonuç alınamadı: Türkiye toplantılarında TJK Sonuç zorunludur. Accurate sonuç yerine kullanılamaz');
   }
   if(officialResultRequested && !resultFiles.length && foreignMeeting){
    // V1.1.330: yabancı toplantıya Türkiye/TJK zorunluluğu uygulanmaz. Accurate
    // varsa yalnız destek katmanı olarak devam eder; resmi yabancı sonuç yoksa bu
    // durum ayrı sınıflanır ve TJK hatası diye raporlanmaz.
    foreignOfficialMissing=true;
    try{markHistoricalNoData(options.historicalMeeting||{},'foreign_official_result','Yabancı resmi sonuç kaynağı bu çalışmada bulunamadı');}catch(_e){}
    if(!accurateFiles.length){
      status('ℹ️ Yurt dışı toplantı · TJK zorunlu değil; resmi yabancı sonuç kaynağı bulunamadı ve tekrar kuyruğundan çıkarıldı.');
      return {...historicalMerge,foreignOfficialMissing:true};
    }
   }
   if(!resultFiles.length && !accurateFiles.length){
    if(options.historicalTop5Only && accurateRequested && !officialResultRequested){
      // İlk turda kalıcı "veri yok" yazma. Sağlayıcı geç yayımlıyor olabilir;
      // dış akış aynı toplantıyı yalnız Accurate için bir son kez deneyecek.
      return {...historicalMerge,accuratePartial:true,accurateApplied:0,accurateExpected};
    }
    if(historicalMerge.horseMerged>0)return historicalMerge;
    throw new Error('TJK Sonuç ve Accurate dosyaları alınamadı');
   }
   // TJK Sonuç ve Accurate ayrı, doğrulanabilir işlemlerdir. Arayüzdeki gizli
   // onay düğmesini taklit etmek yerine resmi sonuç dosyası doğrudan TKP motoruna verilir.
   let resultApplied=0, resultWithWinner=0, resultComplete=0, resultExpected=0;
   if(resultFiles.length){
    const processor=window.tkpProcessOfficialResultFile;
    if(typeof processor!=='function') throw new Error('TKP resmi sonuç işleme motoru bulunamadı');
    for(const fileData of resultFiles){
      const applied=await processor(toFile(fileData),{autoConfirm:true,historicalTop5Only:Boolean(options.historicalTop5Only),targetFileId:options.targetFileId||options.historicalMeeting?.targetFileId});
      if(!applied?.applied) throw new Error('TJK sonuç dosyası mevcut kayda uygulanamadı');
      resultApplied++;
      resultWithWinner=Math.max(resultWithWinner,Number(applied.resultQuality?.withWinner)||0);
      resultComplete=Math.max(resultComplete,Number(applied.resultQuality?.complete)||0);
      resultExpected=Math.max(resultExpected,Number(applied.resultQuality?.raceCount)||0);
    }
   }
   if(accurateFiles.length){
    const accurateInput=$('#accurateFolderFile');
    if(!accurateInput) throw new Error('TKP Accurate içe aktarma alanı bulunamadı');
    window.__tkpLastLayerImportResult=null;
    await triggerInput(accurateInput,accurateFiles);
    const report=window.__tkpLastLayerImportResult||{};
    accurateApplied=Number(report.accurateApplied)||0;
    if(options.historicalTop5Only&&accurateApplied<accurateExpected){
      // Eşleşen koşular zaten içe aktarıldı; onları geri alma. Yalnız toplantı
      // tam damgasını kaldır ve dış akışa eksik sayıyı bildir.
      accuratePartial={applied:accurateApplied,expected:accurateExpected,downloaded:accurateFiles.length};
      clearHistoricalLayerComplete(options.historicalMeeting||{},'accurace');
    }else if(!options.historicalTop5Only&&accurateApplied<Math.min(6,accurateFiles.length)){
      throw new Error(`Accurate dosyaları alındı fakat ${accurateApplied}/${Math.min(6,accurateFiles.length)} koşu eşleşti`);
    }else if(options.historicalTop5Only){
      clearHistoricalNoData(options.historicalMeeting||{},'accurace');
    }
   }else if(options.historicalTop5Only && accurateRequested){
    accuratePartial={applied:0,expected:accurateExpected,downloaded:0};
   }
   if(resultFiles.length && (!resultApplied || !resultWithWinner)) throw new Error('TJK sonuç dosyası alındı fakat resmi kazananlar kayda yazılmadı');
   const resultPartial=resultFiles.length>0&&(!resultExpected||resultComplete<resultExpected);
   if(options.historicalTop5Only){
    if(resultFiles.length && !resultPartial) markHistoricalLayerComplete(options.historicalMeeting||{},'tjk_result',`TJK İlk-5 ${resultComplete}/${resultExpected} koşu`);
    else if(resultFiles.length) clearHistoricalLayerComplete(options.historicalMeeting||{},'tjk_result');
    if(accurateFiles.length&&!accuratePartial) markHistoricalLayerComplete(options.historicalMeeting||{},'accurace',`Accurate ${accurateApplied}/${accurateExpected} koşu`);
   }
   if(options.historicalTop5Only&&resultPartial) throw new Error(`TJK İlk-5 eksik: ${resultComplete}/${resultExpected} koşu tamam. Alınan sonuçlar korundu; eksik koşular tamamlandı sayılmadı.`);
   // V1.1.211 KÖK FIX: "N kaynak uyarısı" yalnız SAYI gösteriyordu, hangi kaynağın
   // ne dediği hiçbir yerde görünmüyordu (diğer collector akışlarında — ana bülten
   // toplama — her kaynağın hatası ayrı ayrı listeleniyor, ama bu "Resmi sonuç
   // kontrolü" yolunda bu ayrıntı hiç kurulmamıştı). Şimdi varsa uyarı içerikleri
   // konsola tam, durum satırına kısa özet olarak yazılıyor; başarı mesajı kaybolmaz.
   let warnDetail='';
   const scopedResultErrors=(job.errors||[]).filter(e=>requestedResultSources.has(String(e?.source||'').trim().toLowerCase()));
   if(scopedResultErrors.length){
    const detail=scopedResultErrors.slice(0,4).map(e=>`${sourceLabel(e?.source)||e?.source||'?'}: ${String(e?.error||'').slice(0,80)}`).join(' · ');
    console.warn(`[TKP] TJK Sonuç + Accurate kaynak uyarıları (${scopedResultErrors.length}):`,scopedResultErrors);
    warnDetail=` — ⚠️ ${detail}${scopedResultErrors.length>4?` (+${scopedResultErrors.length-4} daha, konsolda tam liste)`:''}`;
   }
   status(`${resultPartial?'⚠️':'✅'} ${options.historicalTop5Only?'Eski veri güncellemesi':'Resmi sonuç kontrolü'} ${resultPartial?'kısmi':'tamamlandı'} · TJK İlk-5 ${resultComplete}/${resultExpected} koşu · ${resultApplied} sonuç dosyası · Accurate ${accurateApplied}/${accurateExpected} ${accuratePartial?'(kısmi, son kontrol planlandı)':''} · kapsam yalnız TJK İlk-5 + Accurate · diğer katmanlar korunuyor · ${scopedResultErrors.length} kaynak uyarısı${resultTransportNote(job)}${warnDetail}`);
   const resultPayload={...historicalMerge,resultPartial,resultComplete,resultExpected,accuratePartial:Boolean(accuratePartial),accurateApplied,accurateExpected};
   return foreignOfficialMissing?{...resultPayload,foreignOfficialMissing:true}:resultPayload;
   } finally {
     window.__tkpCollectorLayerBatchActive=false;
     if(collectorLayerBatchSupported){ try{ await endDbBatch(false); }catch(error){ console.error('[TKP] collector katman batch kayıt hatası',error); throw error; } }
     if(window.__tkpHistoricalMaintenanceActive===true)window.__tkpHistoricalRenderPending=true;
     else{try{ if(typeof renderActivePane==='function') renderActivePane(); }catch(_e){}}
   }
  }
  if(options.historicalRaces?.length)return historicalMerge;
  const trPuan=j.files.filter(f=>String(f?.source||'').trim().toLowerCase()==='ganyan_canavari'||/^GANYAN_CANAVARI_TR_PUAN.*\.(?:json|html?)$/i.test(String(f?.name||'')));
  // TR PUAN dosyası ana klasör yüklemesine DAHİL edilir; race-data motoru TJK koşuları
  // oluştururken aynı anda Ganyan Canavarı katmanını canlı payload'a ve kalıcı kayda yazar.
  // triggerInput, async onchange tamamlanana kadar zaten bekler. Eski sabit 400 ms
  // gecikme her collector aktarımına boşuna ekleniyordu.
  // bulletinFile.onchange içindeki upsert ve aşağıdaki collector hash kaydı eskiden
  // aynı aktarım için iki tam IndexedDB snapshotı başlatabiliyordu. Tek DB batch'i
  // bütün mutasyonları birleştirir ve çıkışta yalnız bir kez kalıcı kayıt yapar.
  const collectorDbBatch=Boolean(options.batchPersist&&typeof beginDbBatch==='function'&&typeof endDbBatch==='function');
  let deferredPrediction=null,importCommitted=false,collectorBatchClosed=false;
  if(collectorDbBatch)beginDbBatch();
  try{
  window.__tkpCollectorDeferredPrediction=null;
  window.__tkpCollectorFastImport=true;
  if(options.finalAgf)window.__finalAgfUploadPending=true;
  try{await triggerInput($('#bulletinFile'),j.files);}
  finally{
   if(options.finalAgf)window.__finalAgfUploadPending=false;
   window.__tkpCollectorFastImport=false;
   deferredPrediction=window.__tkpCollectorDeferredPrediction||null;
   window.__tkpCollectorDeferredPrediction=null;
  }
  const payloadRaces=Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races.length:0;
  const uiText=$('#bulletinFileName')?.textContent||'';
  if(!payloadRaces||/yüklenemedi|bulunamadı|açılamadı|işlenebilir Altılı bulunamadı/i.test(uiText))throw new Error(`Dosyalar indirildi ama TKP koşu oluşturamadı. ${uiText||'Ana bülten parser sonucu boş.'}`);
  const coverageNow=key=>(Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races:[]).filter(r=>(r.horses||[]).some(h=>h?.[key]!==null&&h?.[key]!==undefined&&h?.[key]!=='' )).length;
  // Eski kayıt/özel HTML varyantında ana merge TR'yi yazamazsa ikinci katman güvenli yedektir.
  // Kısmi kapsama da eksik destek demektir; yalnız 0/6 durumunu değil, eksik kalan
  // ayakları da P-kaynağıyla tamamla. Aynı veriyi tekrar yazmak yerine importer
  // kaynak/at kimliği kanıtıyla yalnız eksik eşleşmeleri kabul eder.
  const trHorseMissing=Array.isArray(window.__lastPredictionPayload?.races)&&window.__lastPredictionPayload.races.some(r=>(r.horses||[]).some(h=>{
    const v=h?.tr_ganyan??h?.tr_puan;
    const sources=[h?.tr_ganyan_source,h?.tr_source].map(value=>String(value??'').trim().toUpperCase());
    return !(Number.isFinite(Number(v))&&Number(v)>0&&sources.includes('GANYAN_CANAVARI_TR'));
  }));
  // Ayak bazlı 1 değer var diye katmanı tamam sayma: herhangi bir atın TR PUAN'ı
  // eksikse aynı GC dosyasını ikinci katman eşleştiricisinden geçir. Bu işlem yalnız
  // eksik atları tamamlar ve var olan doğrulanmış TR değerlerini korur.
  if(trPuan.length&&(coverageNow('tr_ganyan')<payloadRaces||trHorseMissing)){window.__tkpLastLayerImportResult=null;await triggerInput($('#accurateFolderFile'),trPuan);}
  const scope=job.scope&&job.scope.raceFrom?`${job.scope.raceFrom}-${job.scope.raceTo}`:'TJK otomatik';
  const races=Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races:[];
  const coverage=key=>races.filter(r=>(r.horses||[]).some(h=>h?.[key]!==null&&h?.[key]!==undefined&&h?.[key]!=='' )).length;
  const jbygLegs=coverage('jbyg'),galopLegs=coverage('g800'),trLegs=coverage('tr_ganyan'),ypuanLegs=coverage('ypuan');
  const support=historicalSupportCoverage(races),by=job.quality?.bySource||{},missing=[],requestedSources=new Set(job.sources||[]);
  for(const cached of (job.files||[]).filter(file=>file.refreshFailed)){
   const captured=cached.downloadedAt||cached.capturedAt;
   const stamp=captured?new Date(captured).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):'';
   missing.push(`${sourceLabel(cached.source)} yenilenemedi; ${stamp?stamp+' saatindeki ':''}son doğrulanmış kayıt kullanılıyor`);
  }
  if(!foreignMeeting&&requestedSources.has('ganyan_canavari')&&support.tr<payloadRaces){
   const e=(job.errors||[]).find(x=>x.source==='ganyan_canavari');
   missing.push(!by.ganyan_canavari?`Ganyan Canavarı TR alınamadı${e?.error?`: ${e.error}`:''}`:`Ganyan Canavarı TR dosyası geldi fakat kaynak/tarih doğrulaması ${support.tr}/${payloadRaces} ayakta tamamlandı`);
  }
  if(!foreignMeeting&&requestedSources.has('ganyan_canavari_glp')&&support.glp<payloadRaces){
   const e=(job.errors||[]).find(x=>x.source==='ganyan_canavari_glp');
   missing.push(!by.ganyan_canavari_glp?`Ganyan Canavarı Galoplar Özet alınamadı${e?.error?`: ${e.error}`:''}`:`Galoplar Özet dosyası geldi fakat kaynak/tarih doğrulaması ${support.glp}/${payloadRaces} ayakta tamamlandı`);
  }
  if(!foreignMeeting&&requestedSources.has('ganyan_canavari_jbyg')&&support.jbyg<payloadRaces){
   const errs=(job.errors||[]).filter(x=>x.source==='ganyan_canavari_jbyg').map(x=>`${sourceLabel(x.source)}: ${x.error||'alınamadı'}`).slice(0,2).join(' · ');
   missing.push(`J-BYG kaynak/tarih doğrulaması ${support.jbyg}/${payloadRaces} ayakta tamamlandı${errs?` (${errs})`:''}`);
  }
  const readySites=['misli','bitalih','hipodrom','editor'].filter(src=>requestedSources.has(src));
  const readyCount=readySites.reduce((n,src)=>n+((by[src]||0)>0?1:0),0);
  const misliSummary=requestedSources.has('misli')?' · '+tkpMisliImportSummary(job,window.__lastPredictionPayload):'';
  for(const src of readySites){
    if(requestedSources.has(src)&&!by[src]){
      const e=(job.errors||[]).find(x=>x.source===src);
      const label=sourceLabel(src);
      missing.push(`${label} alınamadı${e?.error?`: ${e.error}`:''}`);
    }
  }
  const ypuanHorseCount=races.reduce((n,r)=>n+(r.horses||[]).filter(h=>Number.isFinite(Number(h?.ypuan))).length,0);
  const totalHorseCount=races.reduce((n,r)=>n+(r.horses||[]).length,0);
  if(readyCount>0 && ypuanLegs===0){
    missing.push('Hazır kupon/yorumcu dosyası geldi fakat seçili 2. Altılı ile eşleşip Y.PUAN üretmedi; kaynak başka hipodrom/altılı döndürmüş olabilir');
  }else if(readyCount>0&&ypuanHorseCount===0){
    missing.push('Yorumcu kaynakları geldi fakat at bazında Y.PUAN eşleşmesi 0 kaldı');
  }
  if(readyCount===0&&readySites.length){
    missing.push(`Yorumcu/hazır kupon kaynağı doğrulanamadı: ${readySites.map(sourceLabel).join(' + ')}`);
  }
  const liderformRequested=requestedSources.has('liderform');
  const liderformExpected=liderformRequested?5:0;
  const liderformFiles=(j.files||[]).filter(f=>f.source==='liderform'||/^LIDERFORM_UZMAN_/i.test(String(f.name||''))).length;
  if(liderformRequested&&liderformFiles===0){
    const e=(job.errors||[]).find(x=>x.source==='liderform');
    missing.push(`Liderform uzmanları alınamadı${e?.error?`: ${e.error}`:''}`);
  }else if(liderformRequested&&liderformFiles<liderformExpected){
    missing.push(`Liderform uzmanları kısmi: ${liderformFiles}/${liderformExpected}`);
  }
  const optionalNote=missing.length?` · ⚠️ ${missing.join(' · ')}`:'';
  const jbygLabel=foreignMeeting
   ?'TR/GLP/J-BYG: yerli kaynak sözleşmesi yabancı pistte uygulanmaz'
   :`Destek: TR GC ${trLegs}/${payloadRaces} · GLP TJK ${galopLegs}/${payloadRaces} · J-BYG TJK ${jbygLegs}/${payloadRaces}`;
  const eqLegs=coverage('usa_equibase_confirmed'),atrLegs=coverage('atr_source');
  const atrHorseCount=races.reduce((n,r)=>n+(r.horses||[]).filter(h=>h?.atr_source).length,0);
  const atrCommentCount=races.reduce((n,r)=>n+(r.horses||[]).filter(h=>String(h?.atr_comment||'').trim()).length,0);
  const eqFiles=(j.files||[]).filter(f=>f.source==='equibase'||/^EQUIBASE_/i.test(String(f.name||''))).length;
  const atrFiles=(j.files||[]).filter(f=>f.source==='attheraces'||/^ATTHERACES_/i.test(String(f.name||''))).length;
  const eqErr=(job.errors||[]).find(e=>e.source==='equibase');
  const atrErr=(job.errors||[]).find(e=>e.source==='attheraces');
  const eqDiag=eqLegs===0?` (dosya ${eqFiles}${eqErr?.error?`, ${String(eqErr.error).slice(0,90)}`:''})`:'';
  const atrDiag=atrLegs===0?` (dosya ${atrFiles}${atrErr?.error?`, ${String(atrErr.error).slice(0,90)}`:''})`:'';
  const requested=requestedSources;
  const foreignBits=[];
  if(requested.has('equibase')) foreignBits.push(`Equibase ${eqLegs}/${payloadRaces}${eqDiag}`);
  if(requested.has('attheraces')) foreignBits.push(`At The Races ${atrLegs}/${payloadRaces} ayak · ${atrHorseCount} at · ${atrCommentCount} yorum${atrDiag}`);
  if(requested.has('clubconcepcion')) foreignBits.push(`Club Concepción ${coverage('foreign_context_score')}/${payloadRaces}`);
  if(requested.has('clubhipico')) foreignBits.push(`Club Hípico ${coverage('chi_official_confirmed')}/${payloadRaces}`);
  if(requested.has('hkjc')) foreignBits.push(`HKJC ${coverage('foreign_context_score')}/${payloadRaces}`);
  if(requested.has('racenet')) foreignBits.push(`Racenet ${coverage('foreign_context_score')}/${payloadRaces}`);
  const foreignSourceLabel=foreignMeeting&&foreignBits.length?` · dış kaynak ${foreignBits.join(' · ')}`:'';
  const importedRecord=collectorMeetingRecord(job.meeting);
  if(importedRecord&&Object.keys(incomingHashes).length){
   importedRecord.collector_source_hashes={...(importedRecord.collector_source_hashes||{}),...incomingHashes};importedRecord.collector_imported_at=new Date().toISOString();
   const report=window.__lastPredictionPayload?.ypuan_import_report;
   if(report?.policy&&String(report.date)===String(job.meeting?.date)){importedRecord.ypuan_policy=report.policy;importedRecord.ypuan_import_report=report;}
   try{if(typeof saveDB==='function')await saveDB(false);}catch(error){console.warn('Toplayıcı hash kaydı yazılamadı',error);}
  }
  const liderformLabel=liderformRequested?` · Liderform ${liderformFiles}/${liderformExpected} uzman`:'';
  status(`✅ ${payloadRaces} ayak oluşturuldu · 2. Altılı ${scope}${foreignMeeting?` · Y.PUAN ${ypuanLegs}/${payloadRaces}`:` · TR PUAN ${trLegs}/${payloadRaces} · Y.PUAN ${ypuanLegs}/${payloadRaces}`} · hazır kupon sitesi ${readyCount}/${readySites.length}${misliSummary}${liderformLabel}${foreignSourceLabel} · ${jbygLabel}${optionalNote}`);
  // R17 AutoGluon canlı skorlama importu ASLA bekletmez. Sidecar yoksa R16.94
  // kesintisiz devam eder; challenger yalnız promotion gate geçmişse sıralamayı etkiler.
  try{if(typeof window.tkpR17ScheduleLiveScore==='function')window.tkpR17ScheduleLiveScore(races,{delayMs:50});}catch(_e){}
  // R18.2 analytics runs independently; failed/blocked promotion never changes Champion output.
  try{if(typeof window.tkpR18ScheduleLiveScore==='function')window.tkpR18ScheduleLiveScore(races,{delayMs:90,budget:1500});}catch(_e){}
  importCommitted=true;
  return {recordId:importedRecord?.id||null,payloadRaces,jbygLegs,galopLegs,trLegs,ypuanLegs};
  }catch(error){
   // V1.1.282 FINAL HARDENING: önce batch kuyruğunu İPTAL et, sonra checkpoint'e
   // dön. Böylece yarım mutasyon hiçbir koşulda endDbBatch/saveDB ile tekrar yazılmaz.
   if(collectorDbBatch&&typeof cancelDbBatch==='function')cancelDbBatch();
   if(importCheckpoint&&String(importCheckpoint).startsWith('checkpoint:')&&typeof window.tkpRestoreStorageCheckpoint==='function'){
    try{await window.tkpRestoreStorageCheckpoint(importCheckpoint,{render:false});status('⚠️ Aktarım tamamlanamadı · veritabanı otomatik olarak aktarım öncesi checkpoint’e geri alındı.');}
    catch(rollbackError){console.error('TKP collector rollback başarısız',rollbackError);}
   }
   throw error;
  }finally{
   if(deferredPrediction&&Array.isArray(deferredPrediction.races)&&deferredPrediction.races.length){
    const renderLater=async()=>{
     const criticalStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
     const runId=`collector-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
     const barrierKey=`collector-coupon:${runId}`;
     let firstPhaseError=null;
     try{
      // Açık import batch'i kupon snapshotının arkasına saklanmamalı. Batch kapanışı
      // hemen state'i serbest bırakır fakat büyük DB yazısı bariyer sırasında arka
      // planda bekler; İlk Bakış ve üç kart bunun için asla beklemez.
      try{if(typeof tkpBeginTaskBarrier==='function')tkpBeginTaskBarrier(barrierKey);}catch(_e){}
      if(collectorDbBatch&&importCommitted){
       collectorBatchClosed=true;
       try{Promise.resolve(endDbBatch(false)).catch(error=>console.warn('Toplayıcı batch kapanış kaydı ertelendi',error));}catch(error){console.warn('Toplayıcı batch kapanışı başlatılamadı',error);}
      }
      const predictionStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
      await Promise.resolve(renderPredictionScreen(deferredPrediction.races,deferredPrediction.payload,{criticalPhase:true,collectorRunId:runId}));
      try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:prediction-first-paint',predictionStarted);}catch(_e){}
      status('⏳ İlk Bakış ve ayak sekmeleri hazır · üç kupon öncelikli hazırlanıyor…');
      const buildCoupons=async()=>{
       const couponStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
       let couponError=null;
       try{
        if(typeof tkpYield==='function')await tkpYield();
        let couponResult=null;
        if(typeof tkpRunBudgetCouponBuild==='function'){
         // Otomatik üretim İlk Bakış ekranını kupon alanına kaydırmaz; aynı
         // renderer görünür üç kartı ve WAL snapshotını birlikte üretir.
         couponResult=await Promise.resolve(tkpRunBudgetCouponBuild({auto:true}));
        }else if(deferredPrediction.isFinalAgf&&typeof autoBuildCouponsAfterFinalAgf==='function'){
         couponResult=await Promise.resolve(autoBuildCouponsAfterFinalAgf());
        }else if(typeof tkpBuildCouponsAfterDataCollection==='function'){
         couponResult=await Promise.resolve(tkpBuildCouponsAfterDataCollection(lastRaceResults));
        }
        if(couponResult?.reason==='locked_no_frozen_snapshot'){
         const lockedMessage='Altılı/koşu başlamış veya sonuçlanmış; güvenli yarış-öncesi frozen kupon kaydı bulunmadığı için yeni canlı kupon üretilmedi.';
         status('🔒 '+lockedMessage);
         try{if(typeof tkpEndTaskBarrier==='function')tkpEndTaskBarrier(barrierKey);}catch(_e){}
         return {ok:false,rendered:Boolean(couponResult?.rendered),locked:true,reason:'locked_no_frozen_snapshot',error:lockedMessage};
        }
        if(!couponResult||couponResult.ok===false||couponResult.rendered===false)throw new Error(couponResult?.error||couponResult?.reason||'Üç kupon kartı oluşturulamadı.');
        try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:coupon-rendered',couponStarted);}catch(_e){}
        try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:ready-critical-path',criticalStarted);}catch(_e){}
        try{if(typeof tkpRecordAction==='function')tkpRecordAction('Veri → ayak → üç kupon',criticalStarted,null,{budgetMs:15000});}catch(_e){}
        const persistence=couponResult.snapshotPersistence
          || (typeof tkpCouponSnapshotPersistencePromise==='function'?tkpCouponSnapshotPersistencePromise():Promise.resolve(true));
        // Render sahibi post-kupon ısıtmayı tek kez başlatır ve bariyeri hemen
        // kartlardan sonra açar. Tam IndexedDB yazısı bu bariyerin şartı değildir:
        // WAL zaten senkron yazıldı, aksi halde db-persist kendi kendini beklerdi.
        let handedOff=false;
        try{if(typeof globalThis.tkpScheduleCollectorPostCouponWarmup==='function')handedOff=Boolean(globalThis.tkpScheduleCollectorPostCouponWarmup({runId,barrierKey}));}catch(_e){}
        if(!handedOff){try{if(typeof tkpEndTaskBarrier==='function')tkpEndTaskBarrier(barrierKey);}catch(_e){}}
        Promise.resolve(persistence).then(ok=>{
          try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:coupon-snapshot-durable',couponStarted,ok===false?new Error('snapshot persistence false'):null);}catch(_e){}
          if(ok===false)status('❌ Kuponlar ekranda hazır, fakat veri kaydı tamamlanamadı. İşlem başarılı sayılmadı.');
        }).catch(error=>{try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:coupon-snapshot-durable',couponStarted,error);}catch(_e){}});
        status('✅ İlk Bakış ve üç kupon hazır. Ayak ayrıntıları ve istatistikler ilgili sekme açıldığında hazırlanır.');
        return couponResult;
       }catch(error){
        couponError=error;
        try{if(typeof tkpEndTaskBarrier==='function')tkpEndTaskBarrier(barrierKey);}catch(_e){}
        console.warn('Toplayıcı sonrası üçlü kupon hazırlanamadı',error);
        status(`⚠️ İlk Bakış ve ayak tabloları hazır; üç kupon hatası: ${error?.message||String(error)}`);
        return {ok:false,rendered:false,error:error?.message||String(error)};
       }finally{
        try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:three-coupons',couponStarted,couponError);}catch(_e){}
       }
      };
      // Kuponlar veri toplamanın zorunlu çıktısıdır; yan bahis/istatistik işleri
      // artık render sahibi tarafından yalnız kartlar tamamlandıktan sonra açılır.
      // R16.15: Üç kupon veri yüklemenin zorunlu çıktısıdır. Genel görev kuyruğunda
      // daha önce başlamış uzun bir iş USER önceliğini bile bekletebiliyordu; bu durumda
      // İlk Bakış görünürken kuponlar hiç oluşmamış gibi kalıyordu. İlk boya sonrası bir
      // UI yield ver ve hızlı kupon yolunu doğrudan bitir. Arka plan işleri bariyerin
      // arkasında kalmaya devam eder.
      if(typeof tkpYield==='function')await tkpYield();
      await buildCoupons();
      try{if(typeof tkpEnableLiveAutomationForSession==='function')tkpEnableLiveAutomationForSession();}catch(_e){}
      try{if(typeof tkpRecordAction==='function')tkpRecordAction('Veri → İlk Bakış',criticalStarted,null,{budgetMs:1500});}catch(_e){}
     }catch(error){
      firstPhaseError=error;
      try{if(typeof tkpEndTaskBarrier==='function')tkpEndTaskBarrier(barrierKey);}catch(_e){}
      console.warn('Toplayıcı sonrası tahmin ekranı hazırlanamadı',error);
     }finally{
      try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('collector:prediction-critical-entry',criticalStarted,firstPhaseError);}catch(_e){}
     }
    };
    if(typeof tkpYield==='function')await tkpYield();
    else await new Promise(resolve=>setTimeout(resolve,0));
    // Büyük arşivlerde renderPredictionScreen senkron ön-işleme yapabiliyor.
    // Import/collector job'ı bu işi beklerse ana thread uzun süre kilitleniyor
    // (tanı kaydındaki tekrarlayan ~59 sn stall). Bir event-loop turu bırakıp
    // render'ı devam eden arka plan teslimatı olarak başlat; kendi hatası
    // renderLater içinde zaten kayda alınıyor.
    setTimeout(()=>{void renderLater();},0);
   }
   if(collectorDbBatch&&importCommitted&&!collectorBatchClosed){
    const saved=await endDbBatch(false);
    if(saved===false)throw new Error('Veri kaydı tamamlanamadı; aktarım başarılı sayılmadı.');
   }
  }
  }finally{window.__tkpCollectorImportDepth=Math.max(0,(Number(window.__tkpCollectorImportDepth)||1)-1);window.__tkpCollectorImportActive=window.__tkpCollectorImportDepth>0;}
 }
 function activeHistoricalData(){
  const d=currentDb();if(!d)return {races:[],filesById:new Map()};
  const filesById=new Map((d.files||[]).map(f=>[String(f.id),f]));
  const activeIds=new Set((d.files||[]).filter(f=>f.status==='ACTIVE').map(f=>String(f.id)));
  const races=(d.races||[]).filter(r=>activeIds.has(String(r.file_id)));
  return {races,filesById};
 }
 function preparedTargets(){
  const raw=Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races:[];
  const date=$('#tkpcDate').value,hip=$('#tkpcHip').value;
  return raw.map((r,i)=>({...r,race_date:r.race_date||date,hippodrome:r.hippodrome||hip,_absRaceNo:Number(r._absRaceNo||r.race_no||r.leg||i+1)}));
 }
 async function findSimilarRaces(){
  const E=window.TkpSimilarRaceEngine;if(!E){status('❌ Benzer yarış motoru yüklenemedi.');return;}
  const targets=preparedTargets();if(!targets.length){status('⚠️ Önce o günün bültenini yükle veya “Verileri Topla” ile koşuları oluştur.');return;}
  const d=currentDb();if(!d){status('❌ TKP veritabanı hazır değil.');return;}
  const required=Math.max(10,Math.min(30,Number($('#tkpcSimilarCount').value)||10));
  const minScore=Math.max(70,Math.min(90,Number($('#tkpcSimilarMin').value)||80));
  const {races,filesById}=activeHistoricalData();status(`🧠 ${races.length} kayıtlı yarış içinde benzer profiller aranıyor…`);
  const pools=E.findPools(targets,races,{targetDate:$('#tkpcDate').value,hippodrome:$('#tkpcHip').value,filesById,limit:required,required,minScore});
  renderSimilarPreview(pools,required,minScore);
  const ready=pools.filter(p=>p.ready);
  if(!ready.length){status(`⚠️ Hiçbir ayakta ${required} adet %${minScore}+ benzer, sonuçlanmış eski yarış bulunamadı. Düşük kaliteli yarışla sayı tamamlanmadı.`);return;}
  d.settings=d.settings||{};d.settings.similar_reference_pools=d.settings.similar_reference_pools||{};
  for(const p of ready){
    d.settings.similar_reference_pools[p.signature]={
      schemaVersion:1,createdAt:new Date().toISOString(),targetDate:$('#tkpcDate').value,targetHippodrome:$('#tkpcHip').value,
      required,minScore,raceIds:p.matches.map(x=>String(x.race.id)),scores:p.matches.map(x=>x.score),
      target:{condition_text:p.target.condition_text||p.target.condition_family||'',distance:p.target.distance||null,surface:p.target.surface||'',breed:p.target.breed||'',hippodrome:p.target.hippodrome||'',raceNo:p.target._absRaceNo||p.target.leg||p.targetIndex+1}
    };
  }
  try{if(typeof invalidateProfileMatchCache==='function')invalidateProfileMatchCache();if(typeof invalidateConditionStatsCache==='function')invalidateConditionStatsCache();if(typeof rulesDirty!=='undefined')rulesDirty=true;if(typeof saveDB==='function')await saveDB(false);}catch(e){console.warn('Benzer yarış havuzu kaydedilirken uyarı',e);}
  status(`✅ ${ready.length}/${pools.length} ayak için ${required} yarışlık güvenli referans havuzu aktive edildi. Tahmini “Güncel Algoritma ile Hesapla” ile yenile.`);
 }
 function renderSimilarPreview(pools,required,minScore){
  const box=$('#tkpcSimilarPreview');if(!box)return;
  const rows=pools.map(p=>{
    const raceNo=p.target._absRaceNo||p.target.leg||p.targetIndex+1;
    const state=p.ready?'✅ Hazır':'⚠️ Eksik';
    const sample=p.matches.slice(0,3).map(x=>`${esc(x.race.race_date||'?')} ${esc(tkpcDisplayHip(x.race.hippodrome||''))} ${Number(x.race.leg)||'?'}K (%${x.score})`).join('<br>')||'Eşleşme yok';
    return `<tr><td>${raceNo}. Koşu</td><td>${esc(p.target.condition_text||p.target.condition_family||'')}</td><td>${Number(p.target.distance)||'-'} m ${esc(p.target.surface||'')}</td><td><b>${p.matches.length}/${required}</b><br>${state}</td><td>${sample}</td></tr>`;
  }).join('');
  box.style.display='block';box.innerHTML=`<div style="border:1px solid #c4b5fd;border-radius:9px;background:white;padding:10px"><div style="font-weight:800;margin-bottom:7px">🧠 Benzer Yarış Ön İzleme · eşik %${minScore}</div><div style="overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr><th>Ayak</th><th>Koşu şartı</th><th>Pist/Mesafe</th><th>Bulunan</th><th>En yakın örnekler</th></tr></thead><tbody>${rows}</tbody></table></div><div style="font-size:11px;margin-top:7px">Gelecek tarihli, sonuçsuz, farklı pistli veya eşik altı yarışlar kullanılmadı. Havuz yalnız 10 kaliteli kayıt bulunan ayaklarda algoritmaya bağlandı.</div></div>`;
 }

 function tkpcJobCompleted(job){
  // Collector'ın kalıcı durum sözleşmesi `completed`; eski TKP sürümleri `done` kullanıyordu.
  // İki adı da başarı kabul ederek Son AGF/TJK Son Kontrol köprüsünü geriye uyumlu tut.
  const state=String(job?.status||'').toLowerCase();
  return state==='completed'||state==='done';
 }

 async function tkpcWaitBackgroundJob(id,timeoutMs=20*60*1000){
  // Manuel TJK Son Kontrol ve Eski Verileri Güncelle akışlarının ortak job bekleyicisi.
  // Eski yardımcı veri taramasında tek bir sorunlu site bütün kuyruğu saatlerce kilitlemesin.
  // KÖK FIX (2026-08-21, kullanıcı talebi — "internet kesilip gelirse çalışmaya devam etmeli"):
  // Eskiden tek bir başarısız yoklama fetch'i (geçici ağ kopması) doğrudan throw ediyordu ve
  // bu, işi bekleyen HER çağıran akışı (günlük toplama dahil) hemen düşürüyordu -- oysa iş
  // sunucu tarafında (collector) çalışmaya devam ediyor olabilir, sadece istemci o an ona
  // ulaşamıyor. Artık tek bir yoklama hatası sessizce yutulup zaman aşımına kadar tekrar
  // denenir; yalnız TOPLAM süre timeoutMs'i aşarsa pes edilir.
  // KÖK FIX (2026-08-22, "500 veri" turlarının 0 ilerlemeyle bitmesi): eskiden
  // `job.status!=='running'` HER şeyi (örn. sunucunun artık kullanmadığı 'paused' gibi ara
  // durumlar) "bitti" sayıp hemen dönüyordu -- iş sunucuda hâlâ sürüyor olsa bile istemci
  // erken pes edip 'tarihsel program işi tamamlanmadı' hatası fırlatıyordu. Artık yalnız
  // GERÇEKTEN bitmiş (terminal) durumlarda dönülür; tanınmayan/ara bir durumla karşılaşırsa
  // (yeni bir sunucu durumu eklenirse bile) güvenli taraf hataya değil beklemeye düşer.
  const TERMINAL=new Set(['completed','done','failed','cancelled','skipped_no_altili2','error']);
  const started=Date.now();
  while(Date.now()-started<Math.max(15_000,Number(timeoutMs)||20*60*1000)){
   try{
    const r=await fetch(API+'/api/v1/jobs/'+id);
    const j=await r.json();
    const job=j.job;
    if(!job||TERMINAL.has(String(job.status||'').toLowerCase()))return job;
   }catch(_e){/* geçici ağ/collector erişilemezliği -- iş arka planda sürüyor olabilir, tekrar dene */}
   await new Promise(x=>setTimeout(x,1200));
  }
  return null;
 }
 // V1.1.322 HIZ/TEMİZLİK: Screen Wake Lock bloğu (_tkpcWakeLock/tkpcAcquireWakeLock/
 // tkpcReleaseWakeLock/tkpcOnVisibilityForWakeLock) kaldırıldı. Bu dört parça yalnız az önce
 // silinen collectHistorical400() tarafından kuruluyor/temizleniyordu (addEventListener +
 // acquire çağrısı o fonksiyonun içindeydi); o fonksiyon gidince tamamen yetim kaldı.
 // Ekran koruyucu koruması ileride gerekirse: gerçek çalışan tarihsel akışın
 // (updateAllHistoricalResults / updateAllHistoricalSupportData) başlangıç/bitişine bağlanmalı.
 // KÖK FIX (2026-08-21, kullanıcı talebi): tek bir fetch/JSON çağrısını -- geçici ağ kopması,
 // collector'ın kısa süreli meşgul olması veya 5xx -- birkaç kez, artan bekleme ile tekrar
 // dener. Kalıcı 4xx (istek hatası) tekrar denenmez, hemen fırlatılır. stopRequested true
 // olursa beklemede derhal çıkar. Tarihsel toplu arşivin AĞ KOPMASINDA TAMAMEN DURMAMASI
 // için kullanılır; günlük tekli akışlar bu sarmalayıcıyı kullanmaz, davranışları değişmez.
 async function tkpcResilientFetchJson(url,opts,{maxAttempts=6,label=''}={}){
  let attempt=0,delay=2000,lastErr=null;
  while(attempt<maxAttempts){
   attempt++;
   if(stopRequested)throw new Error('Kullanıcı durdurdu');
   try{
    const r=await fetch(url,opts);
    if(r.status>=500){lastErr=new Error(`HTTP ${r.status}`);throw lastErr;}
    return await r.json();
   }catch(e){
    lastErr=e;
    if(attempt>=maxAttempts)throw e;
    status(`🔌 Bağlantı sorunu${label?` (${label})`:''}: ${String(e?.message||e).slice(0,70)} · ${attempt}/${maxAttempts} deneme, ${Math.round(delay/1000)} sn sonra tekrar…`);
    let waited=0;while(waited<delay&&!stopRequested){await new Promise(x=>setTimeout(x,Math.min(1000,delay-waited)));waited+=1000;}
    delay=Math.min(delay*1.8,30000);
   }
  }
  throw lastErr||new Error('Tekrar deneme sınırına ulaşıldı');
 }
 async function tkpcSleepUnlessStopped(ms){let left=Math.max(0,ms);while(left>0&&!stopRequested){await new Promise(x=>setTimeout(x,Math.min(1000,left)));left-=1000;}}

 let lastInteraction=Date.now(),activitySentAt=0;
 // V1.1.166: Eksik veri otomatik bakımı KAPALI.
 // Kullanıcının tercihi: eksik veriler yalnız manuel yüklenecek/güncellenecek.
 // Bu nedenle zamanlayıcı, boşta bakım, günlük bakım ve /maintenance/run çağrısı yoktur.
 // Manuel Verileri Topla / Sonucu Kontrol Et / Eski Verilerin Hepsini Güncelle akışları korunur.
 function markInteraction(){lastInteraction=Date.now();sendActivity(true);}
 async function sendActivity(busy){
  const now=Date.now();if(busy&&now-activitySentAt<4000)return;activitySentAt=now;
  try{await fetch(API+'/api/v1/activity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({busy:Boolean(busy)})});}catch{}
 }
 function installIdleMaintenance(){
  window.__tkpAutoMaintenanceDisabled=true;
  window.__tkpIdleMaintenanceInstalled=false;
  window.__tkpIdleMaintenanceRunning=false;
  if(window.__tkpCollectorActivityGuardInstalled)return;
  window.__tkpCollectorActivityGuardInstalled=true;
  let releaseTimer=null;
  const signal=()=>{markInteraction();clearTimeout(releaseTimer);releaseTimer=setTimeout(()=>sendActivity(false),1800);};
  ['pointerdown','keydown','change'].forEach(ev=>document.addEventListener(ev,signal,{passive:true,capture:true}));
  setTimeout(()=>sendActivity(false),2200);
 }

 function status(t){const e=$('#tkpcStatus');if(e)e.textContent=t;}
 function startNearRaceFinalTimers(){
  if(window.__tkpLiveAutomationEnabled!==true)return false;
  if(window.__tkpNearRaceFinalTimer)return true;
  const tick=()=>{try{autoCurrentTipsterFinalCheck();autoTjkFinalCheck();}catch(_){ }};
  window.__tkpNearRaceFinalTimer=setInterval(tick,60000);setTimeout(tick,5000);
  return true;
 }
 window.tkpStartNearRaceFinalTimers=startNearRaceFinalTimers;
 // Collector uygulama açılışında panel veya TJK isteği başlatmaz. Mevcut Tahmin
 // sekmesine ilk gerçek kullanıcı tıklamasında aynı panel ve bütün düğmeler açılır.
 // Görünüm/yerleşim değişmez; yalnız başlangıçtaki otomatik açılış kaldırılmıştır.
 function tkpcInstallLazyPanelOpen(){
  const predictionTab=document.querySelector('#tkpTabs .tab[data-pane="prediction"]');
  if(!predictionTab||predictionTab.dataset.tkpCollectorLazyBound==='1')return false;
  predictionTab.dataset.tkpCollectorLazyBound='1';
  predictionTab.addEventListener('click',()=>setTimeout(addPanel,0),{once:true});
  return true;
 }
 window.tkpOpenCollectorPanel=addPanel;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',tkpcInstallLazyPanelOpen);
 else tkpcInstallLazyPanelOpen();
})();
