/*
 * TKP V1.1.333 - görünür donma tanısı
 *
 * Konsol açılamayan eski Windows/Opera oturumları için küçük ve senkron bir
 * breadcrumb günlüğü tutar. Kritik iş başlamadan önce localStorage'a yazılır;
 * tarayıcı cevap vermeden kapanırsa sonraki açılışta son aktif aşama korunur.
 */
(function(){
  'use strict';
  const KEY='tkp_freeze_diagnostics_v1';
  const VERSION='R16.56-LATENCY-SLA-WATCHDOG';
  const BUILD='R19.2-INTEGRITY-FINAL';
  const recentPhases=[];
  const previousTrace=globalThis.__tkpTrace;
  globalThis.__tkpTrace=(domain,detail)=>{
    try{if(typeof previousTrace==='function')previousTrace(domain,detail);}catch(_){}
    const item={domain:String(domain).slice(0,30),phase:String(typeof detail==='string'?detail:detail?.phase||detail?.mode||'').slice(0,60),
      collection:String(detail?.collection||'').slice(0,60),start:Number(detail?.start)||0,at:Date.now()};
    recentPhases.push(item);if(recentPhases.length>64)recentPhases.shift();
  };
  const MAX_EVENTS=180;
  const MAX_TEXT=260;
  const LATENCY_WATCH_MS=20_000;
  const LATENCY_LIMIT_MS=25_000;
  const LATENCY_CRITICAL_MS=30_000;
  let heartbeatTimer=0;
  let lastLoopTick=Date.now();
  let wrapped=false;

  const nowMs=()=>Date.now();
  const perfNow=()=>{
    try{return typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():0;}catch(_e){return 0;}
  };
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim().slice(0,MAX_TEXT);
  const stageFor=value=>{
    const s=String(value||'').toLocaleLowerCase('tr-TR');
    if(/veri\s*topla|collector|import/.test(s))return 'VERİ TOPLAMA / İÇE AKTARMA';
    if(/üç kupon|three.?coupon|kupon|coupon/.test(s))return 'ÜÇ KUPON OLUŞTURMA';
    if(/ayak|prediction.*paint|ilk bakış|tahmin/.test(s))return 'AYAK TABLOLARI / İLK BAKIŞ';
    if(/yan bahis|side.?bet|istatistik/.test(s))return 'YAN BAHİS / İSTATİSTİK';
    if(/snapshot|kalıcı|durable|wal/.test(s))return 'SNAPSHOT / KALICI KAYIT';
    if(/a4|pdf|föy|report/.test(s))return 'A4 / PDF';
    return clean(value)||'GENEL TKP İŞLEMİ';
  };
  const safeRead=()=>{
    try{
      const raw=globalThis.localStorage?.getItem(KEY);
      const data=raw?JSON.parse(raw):{};
      return data&&typeof data==='object'?data:{};
    }catch(_e){return {};}
  };
  const safeWrite=data=>{
    try{globalThis.localStorage?.setItem(KEY,JSON.stringify(data));return true;}catch(_e){return false;}
  };
  const trimData=data=>{
    const out={version:VERSION,createdAt:data.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),active:data.active||null,stack:Array.isArray(data.stack)?data.stack.slice(-12):[],recovered:Array.isArray(data.recovered)?data.recovered.slice(-8):[],events:Array.isArray(data.events)?data.events.slice(-MAX_EVENTS):[]};
    return out;
  };
  const addEvent=(type,stage,detail='',extra={})=>{
    const data=safeRead();
    const event={type,stage,detail:clean(detail),at:new Date().toISOString(),epochMs:nowMs(),perfMs:Math.round(perfNow()*10)/10,...extra};
    data.version=VERSION;data.updatedAt=new Date().toISOString();data.events=Array.isArray(data.events)?data.events:[];data.events.push(event);data.events=data.events.slice(-MAX_EVENTS);
    safeWrite(trimData(data));
    try{globalThis.tkpFreezeDiagnosticRefresh?.();}catch(_e){}
    return event;
  };
  const latencySeverity=durationMs=>{
    const ms=Math.max(0,Number(durationMs)||0);
    return ms>=LATENCY_CRITICAL_MS?'critical':ms>=LATENCY_LIMIT_MS?'breach':ms>=LATENCY_WATCH_MS?'watch':'ok';
  };
  const activeLatencyEvents=active=>{
    if(!active)return [];
    const elapsed=Math.max(0,nowMs()-(Number(active.startedEpochMs)||nowMs()));
    const crossed=active.latencyCrossed&&typeof active.latencyCrossed==='object'?active.latencyCrossed:{};
    const info=(()=>{try{return globalThis.tkpLatencyWatchdogInfo?.(active.label)||{};}catch(_e){return {};}})();
    const probableCause=clean(info?.probableCause||'Alt aşama işaretlenmemiş');
    const out=[];
    for(const [key,threshold,type,label] of [
      ['watch',LATENCY_WATCH_MS,'slow-operation','20 sn izleme eşiği aşıldı'],
      ['limit',LATENCY_LIMIT_MS,'sla-breach','25 sn SLA ihlali'],
      ['critical',LATENCY_CRITICAL_MS,'critical-sla-breach','30 sn kritik gecikme']
    ]){
      if(elapsed>=threshold&&!crossed[key]){
        crossed[key]=true;
        out.push({type,stage:active.stage,detail:`${label}: ${Math.round(elapsed/100)/10} sn · olası neden: ${probableCause}`,durationMs:Math.round(elapsed),thresholdMs:threshold,severity:key,probableCause,queue:info?.queue||null,activeJobs:info?.activeJobs||[]});
      }
    }
    active.latencyCrossed=crossed;active.lastLatencyMs=Math.round(elapsed);
    return out;
  };
  const stopHeartbeat=()=>{if(heartbeatTimer){try{clearInterval(heartbeatTimer);}catch(_e){}heartbeatTimer=0;}};
  // R16.51 KÖK FIX (yanlış "donma" alarmı): sekme arka plana alınınca/simge
  // durumuna küçültülünce Chrome/Firefox JS zamanlayıcılarını (setInterval dahil)
  // pil tasarrufu için kasıtlı olarak yavaşlatır -- birkaç dakika arka planda
  // kalan bir sekmede "Intensive Timer Throttling" tam olarak dakikada BİR çalışır.
  // Bu tanı aracının kendi 900 ms kalp atışı da bundan muaf değildi: sekme arka
  // planda kaldığı sürece her atım gerçekte ~59-60 sn gecikmeyle geliyordu ve
  // araç bunu "ana iş parçacığı yanıt vermiyor" (event-loop-stall) olarak
  // KAYDEDİYORDU -- oysa TKP'nin kendisi hiçbir şeyi kilitlemiyordu, tarayıcı
  // sekmeyi kasıtlı olarak uyutuyordu. Artık sekme gizliyken (document.hidden)
  // ölçülen gecikme gerçek donma sayılmaz; yalnız kalp atışı sessizce
  // yeniden senkronlanır, "event-loop-stall" olayı YAZILMAZ.
  let hiddenSinceLastTick=false;
  if(typeof document!=='undefined'&&typeof document.addEventListener==='function'){
    try{
      document.addEventListener('visibilitychange',()=>{ if(document.hidden)hiddenSinceLastTick=true; },{passive:true});
    }catch(_e){}
  }
  const startHeartbeat=()=>{
    stopHeartbeat();
    lastLoopTick=nowMs();
    hiddenSinceLastTick=Boolean(typeof document!=='undefined'&&document.hidden);
    heartbeatTimer=setInterval(()=>{
      const data=safeRead(),active=data.active;
      const tick=nowMs(),delay=Math.max(0,tick-lastLoopTick-900);lastLoopTick=tick;
      const wasHidden=hiddenSinceLastTick||Boolean(typeof document!=='undefined'&&document.hidden);
      hiddenSinceLastTick=Boolean(typeof document!=='undefined'&&document.hidden);
      const latencyEvents=active&&!wasHidden?activeLatencyEvents(active):[];
      if(delay>=1800&&active&&!wasHidden){
        active.lastHeartbeatAt=new Date(tick).toISOString();active.lastHeartbeatEpochMs=tick;
        active.loopStallCount=(Number(active.loopStallCount)||0)+1;active.lastLoopDelayMs=Math.round(delay);
        data.active=active;data.updatedAt=new Date().toISOString();safeWrite(trimData(data));
        addEvent('event-loop-stall',active.stage,`Ana iş parçacığı yaklaşık ${Math.round(delay)} ms cevap vermedi.`,{delayMs:Math.round(delay),build:BUILD,recentPhases:recentPhases.slice(-12)});
      }else if(active){
        // Gecikme sekme arka plandayken oluştuysa (ya da hâlâ arka plandaysa)
        // bu tarayıcının kasıtlı zamanlayıcı kısıtlamasıdır -- olay yazılmaz,
        // yalnız kalp atışı sessizce ilerletilir.
        active.lastHeartbeatAt=new Date(tick).toISOString();active.lastHeartbeatEpochMs=tick;active.heartbeatCount=(Number(active.heartbeatCount)||0)+1;
        data.active=active;data.updatedAt=new Date().toISOString();safeWrite(trimData(data));
      }
      for(const event of latencyEvents)addEvent(event.type,event.stage,event.detail,{durationMs:event.durationMs,thresholdMs:event.thresholdMs,severity:event.severity,probableCause:event.probableCause,queue:event.queue,activeJobs:event.activeJobs});
      try{globalThis.tkpFreezeDiagnosticRefresh?.();}catch(_e){}
    },900);
  };
  const recoverPrevious=()=>{
    const data=safeRead(),active=data.active;
    if(!active||!active.stage)return data;
    const stale=Math.max(0,nowMs()-(Number(active.lastHeartbeatEpochMs)||Number(active.startedEpochMs)||nowMs()));
    const recovery={type:'suspected-freeze-after-reload',stage:active.stage,detail:`Sayfa yeniden açıldı; son aktif aşama: ${active.stage}. Son kalp atışı ${Math.round(stale/100)/10} sn önceydi.`,at:new Date().toISOString(),epochMs:nowMs(),staleMs:Math.round(stale),runId:active.runId||''};
    const parents=Array.isArray(data.stack)?data.stack.map(x=>x?.stage).filter(Boolean).slice(-4):[];
    if(parents.length)recovery.parentStages=parents;
    data.recovered=Array.isArray(data.recovered)?data.recovered:[];data.recovered.push(recovery);data.recovered=data.recovered.slice(-8);data.events=Array.isArray(data.events)?data.events:[];data.events.push(recovery);data.events=data.events.slice(-MAX_EVENTS);data.active=null;data.stack=[];data.updatedAt=new Date().toISOString();safeWrite(trimData(data));
    return data;
  };
  recoverPrevious();

  function begin(name,detail='',meta={}){
    const stage=stageFor(name),data=safeRead(),previous=data.active;
    if(previous&&previous.stage===stage){previous.depth=(Number(previous.depth)||1)+1;previous.lastHeartbeatAt=new Date().toISOString();previous.lastHeartbeatEpochMs=nowMs();data.active=previous;safeWrite(trimData(data));return {stage,token:previous.token,depth:previous.depth};}
    if(previous){data.stack=Array.isArray(data.stack)?data.stack:[];data.stack.push(previous);data.stack=data.stack.slice(-12);}
    const token=`diag-${nowMs()}-${Math.random().toString(36).slice(2,7)}`;
    const active={token,runId:String(meta.runId||''),stage,label:clean(name),detail:clean(detail),startedAt:new Date().toISOString(),startedEpochMs:nowMs(),lastHeartbeatAt:new Date().toISOString(),lastHeartbeatEpochMs:nowMs(),depth:1,heartbeatCount:0,meta:{...meta}};
    data.active=active;data.updatedAt=new Date().toISOString();safeWrite(trimData(data));
    addEvent('start',stage,detail,{token,runId:active.runId});startHeartbeat();
    return {stage,token,depth:1};
  }
  function beat(token,detail='',progress=null){
    const data=safeRead(),active=data.active;if(!active||token&&active.token!==token)return false;
    active.lastHeartbeatAt=new Date().toISOString();active.lastHeartbeatEpochMs=nowMs();if(progress!==null)active.progress=clean(progress);if(detail)active.detail=clean(detail);data.active=active;data.updatedAt=new Date().toISOString();safeWrite(trimData(data));
    return true;
  }
  function end(token,detail='',error=null){
    const data=safeRead(),active=data.active;
    if(!active)return false;
    if(token&&active.token!==token){
      const stack=Array.isArray(data.stack)?data.stack:[],index=stack.findIndex(item=>item.token===token);
      if(index<0)return false;
      const completed=stack[index];completed.depth=Math.max(0,(Number(completed.depth)||1)-1);
      if(completed.depth>0){data.stack=stack;safeWrite(trimData(data));return true;}
      stack.splice(index,1);data.stack=stack;
      data.events=Array.isArray(data.events)?data.events:[];
      data.events.push({type:error?'error':'end',stage:completed.stage,detail:clean(detail||completed.detail),token,
        at:new Date().toISOString(),epochMs:nowMs(),durationMs:Math.max(0,nowMs()-completed.startedEpochMs),error:error?clean(error?.message||error):''});
      safeWrite(trimData(data));return true;
    }
    active.depth=Math.max(0,(Number(active.depth)||1)-1);if(active.depth>0){beat(token,detail);return true;}
    const duration=Math.max(0,nowMs()-(Number(active.startedEpochMs)||nowMs()));
    const event={type:error?'error':'end',stage:active.stage,detail:clean(detail||active.detail),at:new Date().toISOString(),epochMs:nowMs(),perfMs:Math.round(perfNow()*10)/10,token,durationMs:duration,error:error?clean(error?.message||error):''};
    data.events=Array.isArray(data.events)?data.events:[];data.events.push(event);data.events=data.events.slice(-MAX_EVENTS);
    const severity=latencySeverity(duration);
    if(severity!=='ok'){
      const info=(()=>{try{return globalThis.tkpLatencyWatchdogInfo?.(active.label)||{};}catch(_e){return {};}})();
      data.events.push({type:'slow-operation-complete',stage:active.stage,detail:`${severity==='critical'?'30 sn kritik':severity==='breach'?'25 sn SLA ihlali':'20 sn izleme'} · ${Math.round(duration/100)/10} sn · olası neden: ${clean(info?.probableCause||'alt aşama işaretlenmemiş')}`,at:new Date().toISOString(),epochMs:nowMs(),durationMs:duration,severity,probableCause:clean(info?.probableCause||''),queue:info?.queue||null});
      data.events=data.events.slice(-MAX_EVENTS);
    }
    const stack=Array.isArray(data.stack)?data.stack:[];
    const parent=stack.pop()||null;
    data.stack=stack;
    data.active=parent;
    data.updatedAt=new Date().toISOString();safeWrite(trimData(data));
    if(parent)startHeartbeat();else stopHeartbeat();
    try{globalThis.tkpFreezeDiagnosticRefresh?.();}catch(_e){}return true;
  }
  function fail(token,error,detail=''){return end(token,detail||'İşlem hata ile sonlandı',error||new Error('Bilinmeyen hata'));}

  function withStage(name,run,args,meta={}){
    const handle=begin(name,meta.detail||'',meta),token=handle?.token||handle;
    let result;
    try{result=run.apply(this,args||[]);}catch(error){fail(token,error);throw error;}
    if(result&&typeof result.then==='function')return Promise.resolve(result).then(value=>{
      // tkpRunButtonTask 15 sn sonra UI'yi serbest bırakıp asıl Promise'i
      // `background.promise` içinde çalıştırmaya devam eder. Eski tanı kodu bu
      // noktada kaydı kapattığı için sonraki gerçek donmayı göremiyordu.
      const background=value&&value.background===true&&value.promise&&typeof value.promise.then==='function';
      if(background){
        beat(token,'İşlem arka planda sürüyor; donma kaydı açık tutuluyor.','arka plan');
        Promise.resolve(value.promise).then(()=>end(token,'Arka plan işlemi tamamlandı'),error=>fail(token,error,'Arka plan işlemi hata ile sonlandı'));
        return value;
      }
      end(token,'Tamamlandı');return value;
    },error=>{fail(token,error);throw error;});
    end(token,'Tamamlandı');return result;
  }
  function wrap(name,stageName){
    const original=globalThis[name];if(typeof original!=='function'||original.__tkpFreezeWrapped)return false;
    const wrappedFn=function(...args){
      let meta={};
      if(name==='tkpRunButtonTask')meta={detail:String(args[3]?.actionName||''),runId:''};
      return withStage(name==='tkpRunButtonTask'?(args[3]?.actionName||name):(stageName||name),original,args,meta);
    };
    wrappedFn.__tkpFreezeWrapped=true;wrappedFn.__tkpFreezeOriginal=original;globalThis[name]=wrappedFn;return true;
  }
  function wrapActionFunctions(){
    wrap('tkpRunButtonTask');
    wrap('renderPredictionScreen','AYAK TABLOLARI / İLK BAKIŞ');
    wrap('tkpRunBudgetCouponBuild','ÜÇ KUPON OLUŞTURMA');
    if(typeof globalThis.tkpGetSideBetPanelHTMLAsync==='function')wrap('tkpGetSideBetPanelHTMLAsync','YAN BAHİS / İSTATİSTİK');
    else wrap('sideBetPanelHTMLAsync','YAN BAHİS / İSTATİSTİK');
    wrap('buildReportAsync','A4 / PDF');
    if(typeof globalThis.tkpRecordAction==='function'&&!globalThis.tkpRecordAction.__tkpFreezeWrapped){
      const original=globalThis.tkpRecordAction;
      const wrappedFn=function(name,start,error,options){
        const stage=stageFor(name),isTracked=/veri|kupon|ayak|tahmin|yan bahis|istatistik|snapshot|pdf|a4|föy|collector/i.test(String(name||''));
        const data=safeRead(),active=data.active;
        if(isTracked&&active&&active.stage===stage)beat(active.token,String(name||''));
        const result=original.apply(this,arguments);
        if(isTracked&&!error)addEvent('checkpoint',stage,String(name||''),{durationMs:Number(result?.durationMs)||0,budgetExceeded:Boolean(result?.budgetExceeded)});
        if(isTracked&&error)addEvent('reported-error',stage,String(error?.message||error),{error:clean(error?.message||error)});
        return result;
      };
      wrappedFn.__tkpFreezeWrapped=true;wrappedFn.__tkpFreezeOriginal=original;globalThis.tkpRecordAction=wrappedFn;
    }
    if(typeof globalThis.tkpRecordPerformance==='function'&&!globalThis.tkpRecordPerformance.__tkpFreezeWrapped){
      const original=globalThis.tkpRecordPerformance;
      const wrappedFn=function(name,start,error){const stage=stageFor(name),result=original.apply(this,arguments);if(/collector|coupon|prediction|side|pdf|a4|snapshot|stat/i.test(String(name||'')))addEvent(error?'reported-error':'checkpoint',stage,String(name||''),{durationMs:Number(result?.durationMs)||0,error:error?clean(error?.message||error):''});return result;};
      wrappedFn.__tkpFreezeWrapped=true;wrappedFn.__tkpFreezeOriginal=original;globalThis.tkpRecordPerformance=wrappedFn;
    }
    if(typeof globalThis.tkpQueueTask==='function'&&!globalThis.tkpQueueTask.__tkpFreezeWrapped){
      const original=globalThis.tkpQueueTask;
      const wrappedFn=function(key,task,options){const k=String(key||''),tracked=/collector|coupon|prediction-pane|sidebet|pdf|report|snapshot|stat/i.test(k);if(!tracked)return original.apply(this,arguments);const stage=stageFor(k),wrappedTask=()=>withStage(stage,task,[],{detail:`Kuyruk görevi: ${k}`});return original.call(this,key,wrappedTask,options);};
      wrappedFn.__tkpFreezeWrapped=true;wrappedFn.__tkpFreezeOriginal=original;globalThis.tkpQueueTask=wrappedFn;
    }
  }
  function report(){
    const data=safeRead();
    let runtime=null,queue=null;
    try{runtime=globalThis.tkpGetSpeedRuntime?.()||null;}catch(_e){}
    try{queue=globalThis.tkpQueueInfo?.()||null;}catch(_e){}
    const breaches=(data.events||[]).filter(event=>/slow-operation|sla-breach/i.test(String(event?.type||''))).slice(-24);
    return {version:VERSION,build:BUILD,storage:(()=>{try{return globalThis.TKPSegmentedIDB?.status?.()||null;}catch(_){return null;}})(),recentPhases:recentPhases.slice(),latencyPolicy:{watchMs:LATENCY_WATCH_MS,limitMs:LATENCY_LIMIT_MS,criticalMs:LATENCY_CRITICAL_MS},createdAt:data.createdAt||'',updatedAt:data.updatedAt||'',active:data.active||null,stack:data.stack||[],recovered:data.recovered||[],events:data.events||[],latencyBreaches:breaches,runtimeSummary:runtime?.summary||null,queue};
  }
  function reportText(){
    const r=report(),last=(r.recovered||[]).slice(-1)[0],active=r.active;
    const lines=[`TKP DONMA TANI RAPORU ${VERSION}`,`Oluşturulma: ${new Date().toLocaleString('tr-TR')}`];
    if(last)lines.push(`ŞÜPHELİ DONMA: ${last.stage} · ${last.detail}`);else if(active)lines.push(`AKTİF İŞ: ${active.stage} · ${active.detail||active.label||''}`);else lines.push('Aktif donma kaydı yok.');
    if((r.stack||[]).length)lines.push(`Üst aşamalar: ${(r.stack||[]).map(x=>x.stage).filter(Boolean).join(' → ')}`);
    lines.push(`Gecikme politikası: ${LATENCY_WATCH_MS/1000} sn izle · ${LATENCY_LIMIT_MS/1000} sn ihlal · ${LATENCY_CRITICAL_MS/1000} sn kritik.`);
    const events=(r.events||[]).slice(-25);if(events.length){lines.push('Son olaylar:');for(const e of events)lines.push(`${e.at||''} | ${e.type||''} | ${e.stage||''} | ${e.detail||''}${e.error?' | HATA: '+e.error:''}`);}
    if(r.runtimeSummary)lines.push(`Performans: tıklama P95 ${r.runtimeSummary.clickP95Ms||0} ms · işlem maksimum ${r.runtimeSummary.actionMaxMs||0} ms · event-loop maksimum ${r.runtimeSummary.eventLoopMaxDelayMs||0} ms`);
    if(r.queue)lines.push(`Kuyruk: ${r.queue.current?.key||'boş'} · bekleyen ${r.queue.queued||0}`);
    return lines.join('\n');
  }
  function download(){
    try{const blob=new Blob([JSON.stringify(report(),null,2)],{type:'application/json;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`TKP_donma_tani_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(_e){alert(reportText());}
  }
  function clear(){const data=safeRead();data.active=null;data.stack=[];data.recovered=[];data.events=[];data.updatedAt=new Date().toISOString();safeWrite(trimData(data));try{globalThis.tkpFreezeDiagnosticRefresh?.();}catch(_e){}}
  function noteLatency(entry={}){
    const severity=String(entry?.severity||latencySeverity(entry?.durationMs));
    if(severity==='ok')return false;
    const stage=stageFor(entry?.name||entry?.scope||'işlem');
    addEvent(severity==='critical'?'critical-sla-breach':severity==='breach'?'sla-breach':'slow-operation',stage,`${Math.round(Number(entry?.durationMs)||0)/1000}s · ${clean(entry?.probableCause||'olası neden yok')}`,{durationMs:Number(entry?.durationMs)||0,severity,scope:clean(entry?.scope||''),probableCause:clean(entry?.probableCause||''),queueWaitMs:Number(entry?.queueWaitMs)||0,error:clean(entry?.error||'')});
    return true;
  }
  function renderRecoveryBanner(last){
    if(typeof document==='undefined')return;
    let banner=document.getElementById('tkpFreezeDiagnosticRecoveryBanner');
    if(!last){banner?.remove();return;}
    if(!banner){banner=document.createElement('div');banner.id='tkpFreezeDiagnosticRecoveryBanner';document.body?.prepend(banner);}
    if(!banner)return;
    banner.style.cssText='position:relative;margin-bottom:10px;padding:10px 12px;background:#991b1b;color:#fff;border-bottom:3px solid #fecaca;font:700 14px/1.35 Arial,sans-serif;box-shadow:0 2px 12px #0008';
    banner.innerHTML=`<span>⚠ TKP şüpheli durma kaydı: ${clean(last.stage)}. En son aktif işlem yeniden açılışta yakalandı.</span> <button type="button" id="tkpFreezeDiagnosticRecoveryDownload" style="margin-left:10px;padding:4px 8px;font-weight:700">Tanı raporu indir</button>`;
    banner.querySelector('#tkpFreezeDiagnosticRecoveryDownload')?.addEventListener('click',download);
  }
  function render(){
    const host=document.getElementById('tkpFreezeDiagnosticDock');if(!host)return;
    const r=report(),last=(r.recovered||[]).slice(-1)[0],active=r.active,latestLatency=(r.latencyBreaches||[]).slice(-1)[0];
    const danger=Boolean(last),working=Boolean(active),color=danger?'#991b1b':working?'#92400e':'#166534',bg=danger?'#fef2f2':working?'#fffbeb':'#f0fdf4';
    host.innerHTML=`<div style="display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:6px 8px;border:1px solid ${danger?'#fecaca':working?'#fde68a':'#bbf7d0'};border-radius:7px;background:${bg};color:${color};font-size:11px"><b>🧭 Gecikme tanısı:</b><span>${danger?`Şüpheli durma · <b>${clean(last.stage)}</b>`:working?`Çalışıyor · <b>${clean(active.stage)}</b>`:'Hazır · kritik işlemler izleniyor'}</span>${active?`<span>· ${Math.max(0,Math.round((nowMs()-(Number(active.startedEpochMs)||nowMs()))/100)/10)} sn</span>`:''}<span title="20 sn izle · 25 sn ihlal · 30 sn kritik">SLA 20/25/30 sn</span><button type="button" id="tkpFreezeDiagnosticDownload" style="margin-left:auto;padding:3px 7px;font-size:11px">Tanı raporu indir</button><button type="button" id="tkpFreezeDiagnosticClear" style="padding:3px 7px;font-size:11px">Temizle</button></div>${latestLatency?`<div style="margin-top:4px;font-size:10.5px;color:${latestLatency.type==='critical-sla-breach'?'#991b1b':'#9a3412'}">Son gecikme: ${clean(latestLatency.stage)} · ${Math.round(Number(latestLatency.durationMs)||0)/1000} sn · ${clean(latestLatency.probableCause||latestLatency.detail||'')}</div>`:''}${danger?'<div style="margin-top:4px;font-size:10.5px;color:#991b1b">Sayfa yeniden açıldığında en son hangi aşamada kalındı. Raporu indirip gönderin; konsol gerekmez.</div>':''}`;
    host.querySelector('#tkpFreezeDiagnosticDownload')?.addEventListener('click',download);host.querySelector('#tkpFreezeDiagnosticClear')?.addEventListener('click',clear);
    renderRecoveryBanner(last);
  }
  globalThis.tkpFreezeDiagnosticBegin=begin;globalThis.tkpFreezeDiagnosticBeat=beat;globalThis.tkpFreezeDiagnosticEnd=end;globalThis.tkpFreezeDiagnosticFail=fail;globalThis.tkpFreezeDiagnosticLatency=noteLatency;globalThis.tkpFreezeDiagnosticReport=report;globalThis.tkpFreezeDiagnosticReportText=reportText;globalThis.tkpFreezeDiagnosticRefresh=render;globalThis.tkpFreezeDiagnosticsReady=true;
  wrapActionFunctions();
  if(typeof globalThis.addEventListener==='function'){
    globalThis.addEventListener('error',event=>{const active=safeRead().active;if(active)addEvent('window-error',active.stage,String(event?.message||'Beklenmeyen tarayıcı hatası'));});
    globalThis.addEventListener('unhandledrejection',event=>{const active=safeRead().active;if(active)addEvent('unhandled-rejection',active.stage,String(event?.reason?.message||event?.reason||'Yakalanmayan Promise hatası'));});
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{wrapActionFunctions();render();});
    else{wrapActionFunctions();render();}
  }
  try{setTimeout(()=>{wrapActionFunctions();render();},0);}catch(_e){}
})();
