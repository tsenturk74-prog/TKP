/**
 * performance-runtime.js
 *
 * Ağır yan bahis ve back test çıktılarını veri imzasına göre önbellekler.
 * Hesaplamayı tarayıcı boşta olduğunda önceden hazırlar.
 */

const TKP_PERFORMANCE_VERSION = 'R16_92_PIPELINE_RESPONSIVE';
const TKP_PANEL_HTML_CACHE_LIMIT = 36;
// Kullanıcı görünümünde kabul edilebilir en uzun tek-parça çalışma süresi.
// 20 sn tanı eşiğidir; 25 sn SLA ihlalidir; 30 sn kritik ihlaldir. Ağdaki
// çok kaynaklı toplam iş arka planda devam edebilir, ancak her alt iş burada
// ayrı ölçülür; "toplam uzun sürdü" gerekçesiyle görünmez bırakılmaz.
const TKP_LATENCY_WATCH_MS = 20_000;
const TKP_LATENCY_LIMIT_MS = 25_000;
const TKP_LATENCY_CRITICAL_MS = 30_000;
const _tkpPanelHtmlCache = new Map();
const _tkpPanelPromiseCache = new Map();
const _tkpPerformanceMetrics = [];
let _tkpPrewarmGeneration = 0;
let _tkpPerformanceSignatureCache={fast:'',side:'',value:''};
let _tkpRaceResultsSignatureCache=new WeakMap();
const _tkpActiveJobs=new Map();
let _tkpJobSequence=0;

function tkpNow(){return (typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();}
let _tkpYieldChannel=null,_tkpYieldQueue=[];
let _tkpSchedulerYieldDisabled=false,_tkpYieldMessageSequence=0;
function tkpMessageChannelYield(){
  if(typeof MessageChannel!=='function')return null;
  if(!_tkpYieldChannel){
    _tkpYieldChannel=new MessageChannel();
    _tkpYieldChannel.port1.onmessage=event=>{
      const index=_tkpYieldQueue.findIndex(item=>item.id===event.data);
      if(index>=0)_tkpYieldQueue[index].finish();
    };
  }
  return new Promise(resolve=>{
    const item={id:++_tkpYieldMessageSequence};
    let done=false,timer;
    item.finish=()=>{
      if(done)return;done=true;clearTimeout(timer);
      const index=_tkpYieldQueue.indexOf(item);if(index>=0)_tkpYieldQueue.splice(index,1);
      resolve();
    };
    _tkpYieldQueue.push(item);
    timer=setTimeout(item.finish,48);
    try{_tkpYieldChannel.port2.postMessage(item.id);}catch(_e){item.finish();}
  });
}
let _tkpLastTimerYield=0;
async function tkpYieldToUi(){
  if(tkpNow()-_tkpLastTimerYield>=8){
    await new Promise(resolve=>setTimeout(resolve,0));
    _tkpLastTimerYield=tkpNow();return;
  }
  if(!_tkpSchedulerYieldDisabled&&globalThis.scheduler&&typeof globalThis.scheduler.yield==='function'){
    // R16.26 KÖK FIX: bazı eski/deneysel Chromium sürümlerinde scheduler.yield()
    // var gibi algılanıyor (typeof==='function') ama Promise'i HİÇ çözmüyor. Ana
    // thread bloklu olmadığı (bu bir await, senkron döngü değil) için Windows
    // "Yanıt Vermiyor" göstermiyor -- sekme "canlı" görünüyor ama await burada
    // sonsuza kadar asılı kalıyor. tkpYield() kod tabanının her yerinde
    // kullanıldığından bu tek nokta kupon üretimini, Sürpriz'i, İstatistik'i vb.
    // her async akışı aynı anda ve her seferinde (deterministik, taze sayfada
    // bile) kilitleyebiliyordu. Kısa bir güvenlik yarışı, çözülmeyen
    // scheduler.yield()'i atlayıp kanıtlı MessageChannel/setTimeout yoluna düşer.
    let settled=false;
    let timer;
    const schedulerYield=Promise.resolve().then(()=>globalThis.scheduler.yield()).then(()=>{settled=true;},()=>{});
    const safetyRace=new Promise(resolve=>{timer=setTimeout(resolve,48);});
    try{await Promise.race([schedulerYield,safetyRace]);}finally{clearTimeout(timer);}
    if(settled)return;
    _tkpSchedulerYieldDisabled=true;
    // scheduler.yield() zamanında çözülmedi; kanıtlı yola düş (aşağıdaki kod).
    // Geç çözülürse sonucu sessizce yut -- ikinci bir yield borcu biriktirmesin.
    schedulerYield.catch(()=>{});
  }
  // V1.1.330 LIVE-509 HIZ FIX: eski Opera/Chromium'da ardışık setTimeout(0)
  // çağrıları ~4 ms clamp'e uğrayabilir. Adaptif analiz yüzlerce cooperative yield
  // yaptığında bu yalnız scheduler beklemesi olarak saniyeler ekliyordu. Win8.1'de
  // desteklenen MessageChannel event-loop'a nefes verir fakat timer clamp ödemez.
  const channelPause=tkpMessageChannelYield();
  if(channelPause){await channelPause;return;}
  await new Promise(resolve=>setTimeout(resolve,0));
}

// V1.1.258 — Tek merkezli hız orkestratörü. Farklı modüllerin bağımsız timeout/idle
// zincirlerinin aynı anda ana thread'e binmesini engeller.
const _tkpTaskQueue=[];
const _tkpTaskKeys=new Map();
let _tkpTaskPumpRunning=false;
let _tkpCurrentTask=null;
let _tkpTaskSeq=0;
const TKP_TASK_PRIORITY={user:0,normal:1,background:2};
// Bir kolektör çalıştırması İlk Bakış'ı çizdikten sonra kuponu bekletmemelidir.
// Kuyruk önceliği sadece henüz başlamamış işler için geçerlidir; uzun bir arka
// plan işi başladıysa onu güvenle ortadan bölmek mümkün değildir. Bu nedenle
// kritik akış başında bir bariyer açılır: yeni BACKGROUND işleri kupon kartları
// ve snapshot yazısı tamamlanıncaya kadar başlatılmaz. USER/NORMAL işler (özellikle
// kalıcı snapshot yazısı) serbest kalır. Bu generic "iptal" değildir; çalışan
// işin sonucunu bozmaz, yalnız yeni işin başlangıcını geciktirir.
let _tkpTaskBarrier=null;
function tkpBeginTaskBarrier(key){
  const safe=String(key||'foreground');
  _tkpTaskBarrier={key:safe,startedAt:tkpNow()};
  return safe;
}
function tkpEndTaskBarrier(key){
  const safe=String(key||'');
  if(!_tkpTaskBarrier)return false;
  if(safe&&safe!==_tkpTaskBarrier.key)return false;
  _tkpTaskBarrier=null;
  // Sırada bekleyen düşük öncelikli işler kullanıcı döngüsüne yeni bir tıklama
  // beklemeden devam edebilsin.
  try{setTimeout(tkpPumpTaskQueue,0);}catch(_e){}
  return true;
}
function tkpTaskBarrierInfo(){return _tkpTaskBarrier?{..._tkpTaskBarrier}:null;}
function tkpBackgroundTaskBlockedByBarrier(row){
  return Boolean(_tkpTaskBarrier&&Number(row?.priority)>=TKP_TASK_PRIORITY.background);
}
function tkpQueueTask(key,task,{priority='normal',replace=true,minIdleMs=0}={}){
  key=String(key||`task-${++_tkpTaskSeq}`);
  if(replace&&_tkpTaskKeys.has(key)){const prev=_tkpTaskKeys.get(key);prev.cancelled=true;}
  const row={id:++_tkpTaskSeq,key,task,priority:TKP_TASK_PRIORITY[priority]??1,minIdleMs:Number(minIdleMs)||0,cancelled:false,queuedAt:tkpNow()};
  _tkpTaskKeys.set(key,row);_tkpTaskQueue.push(row);tkpPumpTaskQueue();return row.id;
}
function tkpCancelQueuedTask(key){const row=_tkpTaskKeys.get(String(key));if(!row)return false;row.cancelled=true;_tkpTaskKeys.delete(String(key));return true;}
async function tkpPumpTaskQueue(){
  if(_tkpTaskPumpRunning)return;_tkpTaskPumpRunning=true;
  try{
    while(_tkpTaskQueue.length){
      _tkpTaskQueue.sort((a,b)=>a.priority-b.priority||a.id-b.id);
      const row=_tkpTaskQueue.shift();
      if(!row||row.cancelled||_tkpTaskKeys.get(row.key)!==row)continue;
      if(tkpBackgroundTaskBlockedByBarrier(row)){
        // Bariyer sürerken sadece bu arka plan işini kısa süre sonra yeniden
        // dene; kuyruktaki USER/NORMAL işler (kupon + snapshot) aynı turda akar.
        setTimeout(()=>{if(!row.cancelled&&_tkpTaskKeys.get(row.key)===row){_tkpTaskQueue.push(row);tkpPumpTaskQueue();}},60);
        continue;
      }
      if(row.minIdleMs>0){
        const now=tkpNow(),last=Number(_tkpSpeedRuntime?.lastInteractionAt)||0;
        if(now-last<row.minIdleMs){
          // V1.1.259: Bir background görevinin idle beklemesi tüm kuyruğu bloke etmesin.
          // Görevi gecikmeli yeniden sırala ve USER/NORMAL işleri hemen ilerlesin.
          const delay=Math.max(25,Math.min(150,row.minIdleMs-(now-last)));
          setTimeout(()=>{if(!row.cancelled&&_tkpTaskKeys.get(row.key)===row){_tkpTaskQueue.push(row);tkpPumpTaskQueue();}},delay);
          continue;
        }
      }
      _tkpTaskKeys.delete(row.key);
      _tkpCurrentTask=row;
      const taskStartedAt=tkpNow();let taskError=null;
      try{globalThis.__tkpTrace?.('task-start',row.key);await row.task();globalThis.__tkpTrace?.('task-end',row.key);}catch(e){taskError=e;console.warn('TKP görev kuyruğu:',row.key,e);}
      finally{
        globalThis.__tkpTrace?.('task-record',row.key);tkpRecordQueuedTask(row,taskStartedAt,taskError);globalThis.__tkpTrace?.('task-recorded',row.key);
        if(_tkpCurrentTask===row)_tkpCurrentTask=null;
      }
      // Uzun kuyruklarda her görev sonrası input'a şans ver. Kullanıcı girdisi varsa
      // scheduler.yield / timeout ile öncelik anında UI'ye geçer.
      await tkpYieldToUi();
    }
  }finally{_tkpTaskPumpRunning=false;if(_tkpTaskQueue.length)setTimeout(tkpPumpTaskQueue,0);}
}
function tkpQueueInfo(){const live=_tkpTaskQueue.filter(x=>!x.cancelled);return {queued:live.length,keys:[..._tkpTaskKeys.keys()],user:live.filter(x=>x.priority===0).length,normal:live.filter(x=>x.priority===1).length,background:live.filter(x=>x.priority===2).length,running:_tkpTaskPumpRunning,current:_tkpCurrentTask?{key:_tkpCurrentTask.key,priority:_tkpCurrentTask.priority}:null,barrier:tkpTaskBarrierInfo()};}
function tkpForegroundPressureActive(minQuietMs=1200){
  try{if(typeof globalThis.tkpCollectorIsBusy==='function'&&globalThis.tkpCollectorIsBusy())return true;}catch(_e){}
  if(globalThis.__tkpCollectorImportActive===true||globalThis.__tkpTjkFinalRunning===true||globalThis.__tkpTipsterFinalRunning===true)return true;
  // R16.50: üç kupon ve tahmin renderı genel görev kuyruğu dışında da çalışabilir.
  // Background 509 snapshot/cache işi bunları artık foreground olarak görür ve durur.
  if(Number(globalThis.__tkpSideBetBuildDepth)>0||globalThis.__tkpCouponCriticalPath===true)return true;
  if(globalThis.__tkpCouponBuildInProgress===true||globalThis.__tkpCouponAdaptiveRefineInProgress===true)return true;
  if(Date.now()<Number(globalThis.__tkpPredictionRenderPressureUntil||0))return true;
  try{if(globalThis.navigator?.scheduling?.isInputPending?.())return true;}catch(_e){}
  const now=tkpNow(),last=Number(_tkpSpeedRuntime?.lastInteractionAt)||0;
  if(last>0&&now-last<Math.max(0,Number(minQuietMs)||0))return true;
  const live=_tkpTaskQueue.filter(x=>!x.cancelled);
  if(live.some(x=>x.priority<TKP_TASK_PRIORITY.background))return true;
  if(_tkpCurrentTask&&_tkpCurrentTask.priority<TKP_TASK_PRIORITY.background)return true;
  return false;
}
async function tkpWaitForBackgroundSafeWindow({minIdleMs=1200,retryMs=120,maxWaitMs=2000}={}){
  // R16.53 KÖK FIX: foreground pressure (özellikle takılı kalan kupon/yenileme
  // bayrağı) arka plan görevini sonsuza kadar bekletmemeli. Eski while döngüsü,
  // prediction-pane-auto görevini başlatıp hiç bitirmiyor ve tanıda 40–80 sn
  // boşluk oluşturuyordu. Süre dolarsa yalnız bu düşük öncelikli görev bırakılır;
  // ana tahmin/kupon akışı serbest kalır ve sonraki açılışta yeniden denenebilir.
  const started=tkpNow(),limit=Math.max(0,Number(maxWaitMs)||0);
  while(tkpForegroundPressureActive(minIdleMs)){
    if(limit>0&&tkpNow()-started>=limit)return false;
    await tkpYieldToUi();
    await new Promise(r=>setTimeout(r,Math.max(40,Number(retryMs)||120)));
  }
  return true;
}
function tkpRuntimePressureLevel(){
  let level=0;
  try{
    const mem=performance?.memory;
    if(mem&&Number(mem.jsHeapSizeLimit)>0){const ratio=Number(mem.usedJSHeapSize)/Number(mem.jsHeapSizeLimit);if(ratio>=0.82)level=2;else if(ratio>=0.68)level=Math.max(level,1);}
    const recent=(_tkpSpeedRuntime?.longTasks||[]).slice(-8);
    if(recent.some(x=>Number(x.durationMs)>=180))level=Math.max(level,2);else if(recent.some(x=>Number(x.durationMs)>=90))level=Math.max(level,1);
  }catch(_e){}
  return level;
}
// V1.1.307 — Ortak 4/8/16 adaptif ağır-iş scheduler kilidi.
// Her cooperative job 4 birimle başlar; ana thread rahatsa 8→16'ya çıkar,
// kullanıcı girdisi/uzun slice görülürse anında 4'e döner. Böylece eski çalışan
// iş akışları korunur; yalnız yield sıklığı merkezî ve ölçülebilir hale gelir.
function tkpAdaptiveChunkClamp(value){
  const n=Number(value)||4;
  return n>=16?16:n>=8?8:4;
}
function tkpAdaptiveChunkStepDown(value){
  const current=tkpAdaptiveChunkClamp(value);
  return current>=16?8:4;
}
function tkpStartJob(name,{budgetMs=12,total=0,chunkSize=4}={}){
  const controller=typeof AbortController!=='undefined'?new AbortController():{signal:{aborted:false},abort(){this.signal.aborted=true;}};
  const pressure=tkpRuntimePressureLevel();
  const adaptiveBudget=pressure>=2?4:pressure===1?7:Math.max(4,Number(budgetMs)||12);
  const initialChunk=pressure>=1?4:tkpAdaptiveChunkClamp(chunkSize);
  const now=tkpNow();
  const job={id:`tkp-job-${++_tkpJobSequence}`,name:String(name||'job'),budgetMs:adaptiveBudget,total:Number(total)||0,processed:0,startedAt:now,lastYieldAt:now,lastCheckpointAt:now,lastCheckpointProcessed:0,nextCheckpoint:initialChunk,chunkSize:initialChunk,controller,status:'running'};
  _tkpActiveJobs.set(job.id,job);return job;
}
async function tkpJobCheckpoint(job,processed=job?.processed||0,total=job?.total||0,{force=false}={}){
  if(!job)return;
  if(job.controller?.signal?.aborted)throw new DOMException('Görev iptal edildi','AbortError');
  job.processed=Number(processed)||0;job.total=Number(total)||0;
  const finalPoint=job.total>0&&job.processed>=job.total;
  if(!force&&!finalPoint&&job.processed<(Number(job.nextCheckpoint)||4))return;
  const now=tkpNow();
  const elapsed=Math.max(0,now-(Number(job.lastCheckpointAt)||now));
  const inputPending=Boolean(globalThis.navigator?.scheduling?.isInputPending?.());
  const pressure=tkpRuntimePressureLevel();
  const mustYield=inputPending||pressure>=2||now-job.lastYieldAt>=job.budgetMs||elapsed>=job.budgetMs;
  if(mustYield){
    job.chunkSize=tkpAdaptiveChunkStepDown(job.chunkSize);
    await tkpYieldToUi();
    job.lastYieldAt=tkpNow();
  }else if(pressure===0&&elapsed<=Math.max(1,job.budgetMs*.35)){
    job.chunkSize=tkpAdaptiveChunkClamp((Number(job.chunkSize)||4)*2);
  }else if(elapsed>=job.budgetMs*.70){
    job.chunkSize=tkpAdaptiveChunkStepDown(job.chunkSize);
  }else{
    job.chunkSize=tkpAdaptiveChunkClamp(job.chunkSize);
  }
  job.lastCheckpointAt=tkpNow();
  job.lastCheckpointProcessed=job.processed;
  job.nextCheckpoint=job.processed+job.chunkSize;
}
async function tkpRunAdaptiveRange(name,total,worker,{stride=1,budgetMs=12,onProgress=null,signal=null}={}){
  const count=Math.max(0,Number(total)||0),unit=Math.max(1,Number(stride)||1);
  return tkpRunCooperativeJob(name,async(job)=>{
    let index=0;
    while(index<count){
      if(signal?.aborted||job.controller?.signal?.aborted)throw new DOMException('Görev iptal edildi','AbortError');
      const units=tkpAdaptiveChunkClamp(job.chunkSize);
      const end=Math.min(count,index+units*unit);
      await worker(index,end,job);
      index=end;
      if(typeof onProgress==='function'){try{onProgress(index,count,job);}catch(_e){}}
      await tkpJobCheckpoint(job,index,count,{force:true});
    }
    return true;
  },{budgetMs,total:count,chunkSize:4});
}
function tkpFinishJob(job,error=null){if(!job)return;job.status=error?'error':'complete';job.finishedAt=tkpNow();job.durationMs=Math.round((job.finishedAt-job.startedAt)*10)/10;job.error=error?String(error?.message||error):'';_tkpActiveJobs.delete(job.id);return job;}
function tkpCancelJob(id){const job=_tkpActiveJobs.get(String(id));if(!job)return false;job.controller.abort();return true;}
function tkpCancelAllJobs(reason='runtime-hardening'){let count=0;for(const job of _tkpActiveJobs.values()){try{job.cancelReason=String(reason);job.controller.abort();count++;}catch(_e){}}for(const row of _tkpTaskQueue){row.cancelled=true;} _tkpTaskKeys.clear(); return count;}
function tkpActiveJobs(){return [..._tkpActiveJobs.values()].map(job=>({id:job.id,name:job.name,status:job.status,processed:job.processed,total:job.total,startedAt:job.startedAt}));}
async function tkpRunCooperativeJob(name,task,options={}){
  const job=tkpStartJob(name,options);
  try{const value=await task(job);tkpFinishJob(job);return value;}catch(error){tkpFinishJob(job,error);throw error;}
}


// HIZ KÖK FIX: Kullanıcının gerçek cihazında "tuşa bastım, cevap vermedi" sorununu
// sayı ile yakalamak için event-loop / click-to-paint / long-task ölçümü.
const _tkpSpeedRuntime={startedAt:(typeof performance!=='undefined'?performance.now():0),lastInteractionAt:(typeof performance!=='undefined'?performance.now():0),clicks:[],longTasks:[],eventLoopStalls:[],actions:[],tasks:[],slowOperations:[],boot:[]};
function tkpSpeedPush(list,row,limit=80){list.push(row);if(list.length>limit)list.splice(0,list.length-limit);}
function tkpLatencySeverity(durationMs){
  const ms=Math.max(0,Number(durationMs)||0);
  return ms>=TKP_LATENCY_CRITICAL_MS?'critical':ms>=TKP_LATENCY_LIMIT_MS?'breach':ms>=TKP_LATENCY_WATCH_MS?'watch':'ok';
}
function tkpLatencyProbableCause(name=''){
  const recent=(_tkpSpeedRuntime.eventLoopStalls||[]).slice(-1)[0];
  if(Number(recent?.delayMs)>=1000)return `Ana iş parçacığı ${Math.round(Number(recent.delayMs))} ms bloklandı`;
  if(_tkpCurrentTask?.key)return `Kuyruk görevi çalışıyordu: ${String(_tkpCurrentTask.key)}`;
  const label=String(name||'').toLocaleLowerCase('tr-TR');
  if(/collector|veri|sonuç|import|aktar/.test(label))return 'Ağ/toplayıcı veya veri içe aktarma alt aşaması';
  if(/coupon|kupon|prediction|tahmin|ayak/.test(label))return 'Tahmin/kupon hesaplama veya ayak tablosu üretimi';
  if(/side|yan bahis|istatistik|analytics|backtest/.test(label))return 'Tarihsel analiz veya yan bahis hesaplaması';
  if(/pdf|a4|föy|report|csv|zip/.test(label))return 'Rapor/dosya üretimi veya tarayıcı indirme hattı';
  return 'Alt aşama işaretlenmemiş; tanı raporundaki son checkpoint ve kuyruk kaydı incelenmeli';
}
function tkpRecordSlowOperation(scope,row){
  const durationMs=Math.max(0,Number(row?.durationMs)||0),severity=tkpLatencySeverity(durationMs);
  if(severity==='ok')return null;
  const entry={scope:String(scope||'operation'),name:String(row?.name||row?.key||'işlem').slice(0,120),durationMs:Math.round(durationMs*10)/10,severity,probableCause:tkpLatencyProbableCause(row?.name||row?.key||''),queueWaitMs:Math.max(0,Number(row?.queueWaitMs)||0),error:String(row?.error||''),at:new Date().toISOString()};
  tkpSpeedPush(_tkpSpeedRuntime.slowOperations,entry,120);
  try{globalThis.tkpFreezeDiagnosticLatency?.(entry);}catch(_e){}
  try{globalThis.tkpRefreshPerformancePanel?.();}catch(_e){}
  return entry;
}
function tkpRecordQueuedTask(row,startedAt,error=null){
  const endedAt=tkpNow(),queuedAt=Number(row?.queuedAt)||startedAt;
  const entry={key:String(row?.key||'görev').slice(0,100),priority:Number(row?.priority),queuedAtMs:Math.round(queuedAt*10)/10,startedAtMs:Math.round(Number(startedAt||endedAt)*10)/10,endedAtMs:Math.round(endedAt*10)/10,queueWaitMs:Math.round(Math.max(0,Number(startedAt||endedAt)-queuedAt)*10)/10,durationMs:Math.round(Math.max(0,endedAt-Number(startedAt||endedAt))*10)/10,error:error?String(error?.message||error):'',at:new Date().toISOString()};
  tkpSpeedPush(_tkpSpeedRuntime.tasks,entry,120);
  tkpRecordSlowOperation('queue',entry);
  try{globalThis.tkpRefreshPerformancePanel?.();}catch(_e){}
  return entry;
}
function tkpSpeedMark(name,detail=''){
  const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  tkpSpeedPush(_tkpSpeedRuntime.boot,{name,atMs:Math.round(now*10)/10,detail:String(detail||'')},80);
  return now;
}
function tkpPercentile(values,pct){
  const rows=(values||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!rows.length)return 0;
  const index=Math.max(0,Math.min(rows.length-1,Math.ceil((Number(pct)||0)*rows.length)-1));
  return Math.round(rows[index]*10)/10;
}
function tkpGetSpeedRuntime(){
  const clicks=_tkpSpeedRuntime.clicks.slice(),stalls=_tkpSpeedRuntime.eventLoopStalls.slice(),actions=_tkpSpeedRuntime.actions.slice(),tasks=_tkpSpeedRuntime.tasks.slice(),slowOperations=_tkpSpeedRuntime.slowOperations.slice();
  return {
    startedAt:_tkpSpeedRuntime.startedAt,lastInteractionAt:_tkpSpeedRuntime.lastInteractionAt,
    clicks,longTasks:_tkpSpeedRuntime.longTasks.slice(),eventLoopStalls:stalls,actions,tasks,slowOperations,boot:_tkpSpeedRuntime.boot.slice(),
    summary:{
      clickP95Ms:tkpPercentile(clicks.map(x=>x.clickToPaintMs),.95),
      clickMaxMs:tkpPercentile(clicks.map(x=>x.clickToPaintMs),1),
      actionP95Ms:tkpPercentile(actions.map(x=>x.durationMs),.95),
      actionMaxMs:tkpPercentile(actions.map(x=>x.durationMs),1),
      taskP95Ms:tkpPercentile(tasks.map(x=>x.durationMs),.95),
      taskMaxMs:tkpPercentile(tasks.map(x=>x.durationMs),1),
      taskMaxWaitMs:tkpPercentile(tasks.map(x=>x.queueWaitMs),1),
      eventLoopMaxDelayMs:tkpPercentile(stalls.map(x=>x.delayMs),1),
      budgetViolations:actions.filter(x=>x.budgetExceeded).length,
      slowOperationCount:slowOperations.length,
      slaBreaches:slowOperations.filter(x=>x.severity==='breach'||x.severity==='critical').length,
      criticalLatencyBreaches:slowOperations.filter(x=>x.severity==='critical').length
    }
  };
}
function tkpLatencyWatchdogInfo(label=''){
  return {watchMs:TKP_LATENCY_WATCH_MS,limitMs:TKP_LATENCY_LIMIT_MS,criticalMs:TKP_LATENCY_CRITICAL_MS,probableCause:tkpLatencyProbableCause(label),queue:tkpQueueInfo(),activeJobs:tkpActiveJobs(),recent:(_tkpSpeedRuntime.slowOperations||[]).slice(-8)};
}
function tkpRecordAction(name,start,error=null,{budgetMs=1200,timedOut=false}={}){
  const end=tkpNow(),startedAtMs=Number(start||end),durationMs=Math.round(Math.max(0,end-startedAtMs)*10)/10;
  // Uzun görev gözlemcisi callback'i işlem bittiğinde çalışabilir. Başlangıç/bitiş
  // damgaları burada saklanırsa o blok doğru düğme işiyle sonradan eşleştirilebilir.
  const row={name:String(name||'işlem').slice(0,100),startedAtMs:Math.round(startedAtMs*10)/10,endedAtMs:Math.round(end*10)/10,durationMs,budgetMs:Math.max(0,Number(budgetMs)||0),budgetExceeded:durationMs>Math.max(0,Number(budgetMs)||0),timedOut:Boolean(timedOut),error:error?String(error?.message||error):'',at:new Date().toISOString()};
  tkpSpeedPush(_tkpSpeedRuntime.actions,row,120);
  tkpRecordSlowOperation('action',row);
  try{globalThis.tkpRefreshPerformancePanel?.();}catch(_e){}
  return row;
}
function tkpSpeedLongTaskSource(startMs,durationMs){
  const start=Number(startMs)||0,end=start+Math.max(0,Number(durationMs)||0);
  const overlap=(a,b)=>Number(a)<=end&&Number(b)>=start;
  // Önce gerçekten süren kullanıcı işi, sonra kuyruk görevi, en son açılış işareti.
  const actions=_tkpSpeedRuntime.actions||[];
  for(let i=actions.length-1;i>=0;i--){
    const action=actions[i];
    if(overlap(action?.startedAtMs,action?.endedAtMs))return `Düğme: ${String(action.name||'işlem')}`;
  }
  if(_tkpCurrentTask?.key)return `Kuyruk: ${String(_tkpCurrentTask.key)}`;
  const click=_tkpSpeedRuntime.activeClick;
  if(click&&Number(click.startedAtMs)<=end&&Number(click.startedAtMs)+1800>=start)return `Tıklama: ${String(click.label||'işlem')}`;
  const marks=_tkpSpeedRuntime.boot||[];
  for(let i=marks.length-1;i>=0;i--){
    const mark=marks[i];
    if(Number(mark?.atMs)<=end&&Number(mark?.atMs)+1200>=start)return `Açılış: ${String(mark.name||'işlem')}`;
  }
  return 'Etiketlenemeyen tarayıcı işi';
}
function tkpRunWhenUserIdle(task,{minIdleMs=1200,retryMs=200,maxWaitMs=0}={}){
  const queuedAt=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const check=()=>{
    const now=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    // Gerçek boşta-zaman: görev kuyruğa girdiği andan önceki 0 değeri "kullanıcı boş" sayılmaz.
    // maxWait dolsa bile aktif tıklamanın ortasına ağır iş bindirilmez; en az 500 ms sessizlik aranır.
    const last=Math.max(Number(_tkpSpeedRuntime.lastInteractionAt)||queuedAt,queuedAt);
    const waited=now-queuedAt;
    const forced=Number(maxWaitMs)>0&&waited>=Number(maxWaitMs);
    const requiredIdle=forced?Math.min(Number(minIdleMs)||0,500):Math.max(0,Number(minIdleMs)||0);
    if(now-last<requiredIdle){setTimeout(check,Math.max(50,retryMs));return;}
    try{const out=task();if(out&&typeof out.catch==='function')out.catch(()=>{});}catch(_e){}
  };
  setTimeout(check,Math.min(250,Math.max(0,retryMs)));
  return queuedAt;
}
if(typeof document!=='undefined'){
  const noteInteraction=()=>{_tkpSpeedRuntime.lastInteractionAt=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();};
  document.addEventListener('pointerdown',noteInteraction,{capture:true,passive:true});
  document.addEventListener('touchstart',noteInteraction,{capture:true,passive:true});
  document.addEventListener('keydown',noteInteraction,true);
  document.addEventListener('click',event=>{
    const target=event.target?.closest?.('button,[role="button"],.tab');
    if(!target)return;
    const started=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
    const label=String(target.id||target.dataset?.pane||target.textContent||'button').replace(/\s+/g,' ').trim().slice(0,80);
    _tkpSpeedRuntime.activeClick={label,startedAtMs:started};
    const finish=()=>{
      const ended=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
      tkpSpeedPush(_tkpSpeedRuntime.clicks,{label,clickToPaintMs:Math.round((ended-started)*10)/10,at:new Date().toISOString()},120);
      // Sistem paneli açıksa yeni tıklama ölçümünü aynı oturumda görünür yap.
      // Yenileme uygulama katmanında frame başına bir kez sınırlandırılır.
      try{ globalThis.tkpRefreshPerformancePanel?.(); }catch(_e){}
      if(_tkpSpeedRuntime.activeClick?.startedAtMs===started)_tkpSpeedRuntime.activeClick=null;
    };
    if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(finish));else setTimeout(finish,0);
  },true);
}
if(typeof PerformanceObserver!=='undefined'){
  try{
    new PerformanceObserver(list=>{
      for(const entry of list.getEntries()){
        const startMs=Math.round(entry.startTime*10)/10,durationMs=Math.round(entry.duration*10)/10;
        tkpSpeedPush(_tkpSpeedRuntime.longTasks,{startMs,durationMs,source:tkpSpeedLongTaskSource(startMs,durationMs),at:new Date().toISOString()},120);
      }
    }).observe({type:'longtask',buffered:true});
  }catch(_e){}
}
// PerformanceObserver eski Opera/Chromium sürümlerinde longtask vermeyebilir.
// 250 ms'lik hafif heartbeat gerçek event-loop gecikmesini ayrıca ölçer; yalnız
// 50 ms üstü sapmaları tutar, hesaplama veya render başlatmaz.
if(typeof setInterval==='function'){
  let expected=tkpNow()+250;
  setInterval(()=>{
    const now=tkpNow(),delay=Math.max(0,now-expected);expected=now+250;
    if(delay>=50)tkpSpeedPush(_tkpSpeedRuntime.eventLoopStalls,{delayMs:Math.round(delay*10)/10,at:new Date().toISOString()},120);
  },250);
}
function tkpTrimMap(map,limit){
  if(!(map instanceof Map)||map.size<=limit)return 0;
  let remove=map.size-limit;for(const key of map.keys()){if(remove--<=0)break;map.delete(key);}return Math.max(0,remove);
}
function tkpTrimRuntimeCaches({aggressive=false}={}){
  const limit=aggressive?48:256;let trimmed=0;
  const names=['_profileMatchCache','_statsByConditionCache','_winnerProfileCache','_adaptiveStatsCache','_adaptiveWeightsCache','_sideBetBacktestCache','_sideBetDoubleGlobalCache','_sideBetWidthCache','_sideBetPanelStatsCache','_detailedRankStatsCache','_detailedBmbStatsCache','_targetConditionStatsCache','_targetBmbConditionStatsCache','_categoryAnalysisCache','_winnerRankDistributionCache','_trGanyanBehaviorCache','_tkpWinnerComboCache','_adaptiveComboCache','_paceAdjCache'];
  for(const name of names){try{const map=eval(name);if(map instanceof Map&&map.size>limit){const before=map.size;tkpTrimMap(map,limit);trimmed+=before-map.size;}}catch(_e){}}
  if(aggressive){try{_tkpPanelHtmlCache.clear();}catch(_e){} try{_tkpPanelPromiseCache.clear();}catch(_e){}}
  return trimmed;
}
function tkpMemoryPressureSweep(){const level=tkpRuntimePressureLevel();if(level>0)tkpTrimRuntimeCaches({aggressive:level>=2});return level;}
if(typeof window!=='undefined'){
  window.tkpSpeedMark=tkpSpeedMark;
  window.tkpGetSpeedRuntime=tkpGetSpeedRuntime;
  window.tkpLatencyWatchdogInfo=tkpLatencyWatchdogInfo;
  window.tkpRecordAction=tkpRecordAction;
  window.tkpPercentile=tkpPercentile;
  window.tkpRunWhenUserIdle=tkpRunWhenUserIdle;
  window.tkpForegroundPressureActive=tkpForegroundPressureActive;
  window.tkpWaitForBackgroundSafeWindow=tkpWaitForBackgroundSafeWindow;
  window.tkpYieldToUi=tkpYieldToUi;
  window.tkpStartJob=tkpStartJob;
  window.tkpJobCheckpoint=tkpJobCheckpoint;
  window.tkpRunAdaptiveRange=tkpRunAdaptiveRange;
  window.tkpAdaptiveChunkClamp=tkpAdaptiveChunkClamp;
  window.tkpFinishJob=tkpFinishJob;
  window.tkpCancelJob=tkpCancelJob;
  window.tkpCancelAllJobs=tkpCancelAllJobs;
  window.tkpRuntimePressureLevel=tkpRuntimePressureLevel;
  window.tkpTrimRuntimeCaches=tkpTrimRuntimeCaches;
  window.tkpMemoryPressureSweep=tkpMemoryPressureSweep;
  window.tkpActiveJobs=tkpActiveJobs;
  window.tkpRunCooperativeJob=tkpRunCooperativeJob;
  window.tkpQueueTask=tkpQueueTask;
  window.tkpCancelQueuedTask=tkpCancelQueuedTask;
  window.tkpQueueInfo=tkpQueueInfo;
  window.tkpBeginTaskBarrier=tkpBeginTaskBarrier;
  window.tkpEndTaskBarrier=tkpEndTaskBarrier;
  window.tkpTaskBarrierInfo=tkpTaskBarrierInfo;
  window.tkpFrameCheckpoint=tkpFrameCheckpoint;
}
tkpSpeedMark('runtime-ready');

function tkpScheduleIdle(task, timeout=250){
  return new Promise((resolve,reject)=>{
    const run=()=>{
      try{ resolve(task()); }
      catch(error){ reject(error); }
    };
    // Prewarm işi kullanıcı etkileşimiyle yarışmasın. requestIdleCallback timeout'u
    // yoğun cihazlarda tam tıklama anında görevi zorla çalıştırıp mikro-donma üretebilir.
    if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(run,{minIdleMs:1000,retryMs:150,maxWaitMs:Math.max(4000,Number(timeout||0)*12)});
    else setTimeout(run,Math.max(0,Math.min(250,Number(timeout)||0)));
  });
}

function tkpPerformanceSignature(){
  // Genel performans imzası kupon/tahmin tıklamasında 30K+ prediction_log
  // satırını hashlememeli. Tam hash yalnız yan-bahis motorunun kendi cache kapısında
  // hesaplanır; burada O(1) son-doğrulanmış/geçici revizyon yeterlidir.
  const sideRevision=typeof sideBetPredictionLogFastRevisionSignature==='function'
    ? sideBetPredictionLogFastRevisionSignature(db)
    : (typeof sideBetPredictionLogRevisionSignature==='function'?sideBetPredictionLogRevisionSignature(db):'');
  if(typeof tkpFastDbSignature==='function'&&typeof db!=='undefined'&&db){
    const fast=tkpFastDbSignature(db);
    if(_tkpPerformanceSignatureCache.fast===fast&&_tkpPerformanceSignatureCache.side===sideRevision)
      return _tkpPerformanceSignatureCache.value;
    const value=`${fast}|SIDE:${sideRevision}`;
    _tkpPerformanceSignatureCache={fast,side:sideRevision,value};
    return value;
  }
  if(typeof learningDatasetSignature==='function'&&typeof db!=='undefined'&&db){
    return learningDatasetSignature(db);
  }
  return `${(db?.files||[]).length}|${(db?.races||[]).length}`;
}

function tkpRaceResultsSignature(raceResults){
  const rows=Array.isArray(raceResults)?raceResults:[];
  const perf=tkpPerformanceSignature();
  const cached=_tkpRaceResultsSignatureCache.get(rows);
  if(cached&&cached.perf===perf) return cached.value;
  const value=rows.map(item=>{
    const race=item?.r||{};
    const available=(race.available_bets||[]).map(value=>
      typeof tkpCanonicalBetKey==='function' ? tkpCanonicalBetKey(value) : String(value)
    ).sort().join(',');
    const payouts=(race.payouts||[]).map(entry=>{
      const key=typeof tkpCanonicalBetKey==='function'
        ? tkpCanonicalBetKey(entry?.key||entry?.label)
        : String(entry?.key||entry?.label||'');
      return `${key}:${entry?.combo||''}:${entry?.amount??''}:${entry?.rollover?1:0}`;
    }).sort().join(',');
    return [
      race.id,
      race.file_id,
      race.leg,
      available,
      payouts,
      (item?.scored||[]).map(horse=>`${horse.horse_no}:${Number(horse.score)||0}`).join(',')
    ].join(':');
  }).join('|');
  _tkpRaceResultsSignatureCache.set(rows,{perf,value});
  return value;
}

function tkpCouponStateSignature(){
  if(typeof activeCoupons==='undefined'||!activeCoupons) return '';
  return ['main','main2','alt','surprise'].map(key=>{
    const coupon=activeCoupons[key];
    if(!coupon||coupon.error) return `${key}:none`;
    return `${key}:${Number(coupon.cost)||0}:`+(coupon.legs||[]).map(leg=>
      `${leg.x?.r?.leg||leg.leg}:${(leg.picks||[]).map(horse=>String(horse.horse_no)).join(',')}`
    ).join(';');
  }).join('|');
}

function tkpPanelCacheKey(kind,extra=''){
  return [TKP_PERFORMANCE_VERSION,kind,tkpPerformanceSignature(),extra].join('|');
}

function tkpRecordPerformance(name,start,error=null){
  const row={
    name,
    durationMs:Math.round((performance.now()-start)*10)/10,
    error:error?String(error?.message||error):'',
    at:new Date().toISOString()
  };
  _tkpPerformanceMetrics.push(row);
  tkpRecordSlowOperation('metric',row);
  if(_tkpPerformanceMetrics.length>100) _tkpPerformanceMetrics.splice(0,_tkpPerformanceMetrics.length-100);
  try{ globalThis.tkpRefreshPerformancePanel?.(); }catch(_e){}
}

function tkpGetPerformanceMetrics(){
  return _tkpPerformanceMetrics.slice();
}


function tkpGetPerformanceCacheInfo(){
  return {
    htmlCache:_tkpPanelHtmlCache.size,
    promiseCache:_tkpPanelPromiseCache.size,
    metrics:_tkpPerformanceMetrics.length,
    prewarmGeneration:_tkpPrewarmGeneration
  };
}

function tkpClearPerformanceCaches(){
  _tkpPrewarmGeneration++;
  _tkpPanelHtmlCache.clear();
  _tkpPanelPromiseCache.clear();
  _tkpPerformanceSignatureCache={fast:'',side:'',value:''};
  _tkpRaceResultsSignatureCache=new WeakMap();
}

function tkpCachedImmediateHtml(key,builder){
  if(_tkpPanelHtmlCache.has(key)) return Promise.resolve(_tkpPanelHtmlCache.get(key));
  if(_tkpPanelPromiseCache.has(key)) return _tkpPanelPromiseCache.get(key);

  // Kullanıcı tıklaması requestIdleCallback kuyruğunda beklememeli. Çağıran taraf
  // önce bir tkpYield() ile loading durumunu ekrana bastıktan sonra bu yol hesaplamayı
  // hemen başlatır. Prewarm işleri tkpCachedAsyncHtml ile boş zamanda kalmaya devam eder.
  const start=performance.now();
  const promise=Promise.resolve().then(builder).then(html=>{
    if(_tkpPanelHtmlCache.has(key)) _tkpPanelHtmlCache.delete(key);
    if(!/data-truncated="1"/.test(html))_tkpPanelHtmlCache.set(key,html);
    while(_tkpPanelHtmlCache.size>TKP_PANEL_HTML_CACHE_LIMIT){
      _tkpPanelHtmlCache.delete(_tkpPanelHtmlCache.keys().next().value);
    }
    tkpRecordPerformance(key,start);
    return html;
  }).catch(error=>{
    tkpRecordPerformance(key,start,error);
    throw error;
  }).finally(()=>{
    _tkpPanelPromiseCache.delete(key);
  });
  _tkpPanelPromiseCache.set(key,promise);
  return promise;
}

function tkpCachedAsyncHtml(key,builder){
  if(_tkpPanelHtmlCache.has(key)) return Promise.resolve(_tkpPanelHtmlCache.get(key));
  if(_tkpPanelPromiseCache.has(key)) return _tkpPanelPromiseCache.get(key);

  const promise=tkpScheduleIdle(async()=>{
    const start=performance.now();
    try{
      const html=await builder();
      // Uzun oturumlarda her veri imzasının HTML'ini sonsuza kadar tutmak bellek/GC
      // baskısı yaratıyordu. Son kullanılan 36 panel yeterlidir; eski girdiler LRU
      // mantığıyla atılır. Hesap sonucu değişmez, yalnız bellek kullanımı sabitlenir.
      if(_tkpPanelHtmlCache.has(key)) _tkpPanelHtmlCache.delete(key);
      _tkpPanelHtmlCache.set(key,html);
      while(_tkpPanelHtmlCache.size>TKP_PANEL_HTML_CACHE_LIMIT){
        _tkpPanelHtmlCache.delete(_tkpPanelHtmlCache.keys().next().value);
      }
      tkpRecordPerformance(key,start);
      return html;
    }catch(error){
      tkpRecordPerformance(key,start,error);
      throw error;
    }finally{
      _tkpPanelPromiseCache.delete(key);
    }
  });
  _tkpPanelPromiseCache.set(key,promise);
  return promise;
}

const TKP_SIDEBET_DURABLE_CACHE_KEY='tkp_sidebet_panel_persist_v2';
let _tkpSideBetDurableWritePromise=Promise.resolve();

function tkpSideBetPanelLocked(raceResults){
  const rows=(Array.isArray(raceResults)?raceResults:[]).filter(item=>item?.r);
  if(!rows.length)return false;
  try{
    if(typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked(rows))return true;
  }catch(_e){}
  try{
    return rows.every(item=>typeof raceHasConfirmedResult==='function'
      ? raceHasConfirmedResult(item.r?.horses||[])
      : (item.r?.horses||[]).some(horse=>Number(horse?.winner)===1||Number(horse?.finish_position)===1));
  }catch(_e){return false;}
}

function tkpPrimeSideBetCouponState(raceResults){
  // Ctrl+F5 sonrasında activeCoupons RAM'i boştur. Arşiv cache anahtarını kupon
  // restore edilmeden üretirsek ilk tıklama kalıcı cache'i kaçırır ve bütün paneli
  // yeniden hesaplar. Kilitli toplantıda bu çağrı yalnız frozen snapshot'ı geri
  // bağlar; canlı kupon motorunu çalıştırmaz.
  if(!tkpSideBetPanelLocked(raceResults))return false;
  try{
    if(typeof ensureSideBetCouponSources==='function')return Boolean(ensureSideBetCouponSources(raceResults));
  }catch(_e){}
  return false;
}

function tkpSideBetPanelCacheKey(raceResults){
  if(tkpSideBetPanelLocked(raceResults)){
    // Arşiv anahtarı activeCoupons RAM durumuna bağlı olamaz. Ctrl+F5 sonrasında
    // RAM boşalınca eski kod cache'i kaçırıyor, ardından 509 toplantılık kupon
    // günlüğünü daha ilk boya öncesinde senkron tarıyordu.
    const dataset=String(db?.learning_state?.dataset_signature||`${(db?.files||[]).length}|${(db?.races||[]).length}`);
    const logRevision=typeof sideBetPredictionLogRevisionSignature==='function'?sideBetPredictionLogRevisionSignature(db):String((db?.prediction_log||[]).length);
    // Aynı toplantıdaki eski snapshot yerine yenisi gelirse dizi uzunluğu aynı
    // kalabilir. O(1) revizyon bu durumda arşiv yan-bahis cache'inin doğru satırı
    // yeniden okumasını sağlar; bütün performans cache'ini boşaltmaya gerek yoktur.
    const couponRevision=`${(db?.auto_coupon_log||[]).length}|${(db?.forward_tracking_log||[]).length}|${Number(db?.settings?.backtest_snapshot_revision)||0}`;
    return tkpPanelCacheKey('sidebet-archive',`${tkpRaceResultsSignature(raceResults)}|${dataset}|${logRevision}|${couponRevision}`);
  }
  return tkpPanelCacheKey(
    'sidebet',
    `${tkpRaceResultsSignature(raceResults)}|${tkpCouponStateSignature()}`
  );
}

async function tkpReadPersistentSideBet(key){
  if(typeof tkpUiCacheGet!=='function'||!key)return '';
  try{
    const cacheId=`${TKP_SIDEBET_DURABLE_CACHE_KEY}:${typeof tkpHashString==='function'?tkpHashString(key):key.length}`;
    const hit=await tkpUiCacheGet(cacheId);
    if(hit?.key===key&&typeof hit?.html==='string'&&hit.html.length>30)return hit.html;
    // Önceki sekiz-kayıtlık biçim bir kez daha okunabilir; yeni yazımlar toplantı
    // başına ayrı kayda gider ve başka bir arşiv açılınca silinmez.
    const legacy=await tkpUiCacheGet('tkp_sidebet_panel_persist_v1');
    const old=(Array.isArray(legacy?.entries)?legacy.entries:[]).find(entry=>entry?.key===key);
    return typeof old?.html==='string'&&old.html.length>30?old.html:'';
  }catch(_e){return '';}
}

function tkpWritePersistentSideBet(key,html){
  if(!key||typeof html!=='string'||html.length<=30||typeof tkpUiCacheSet!=='function')return;
  // Yalnız sonuçlanmış/frozen toplantı panelleri kalıcılaştırılır. Canlı panel
  // kupon değiştikçe doğal olarak RAM cache'iyle çalışır; IndexedDB gereksiz büyümez.
  _tkpSideBetDurableWritePromise=_tkpSideBetDurableWritePromise.catch(()=>{}).then(async()=>{
    const cacheId=`${TKP_SIDEBET_DURABLE_CACHE_KEY}:${typeof tkpHashString==='function'?tkpHashString(key):key.length}`;
    await tkpUiCacheSet(cacheId,{version:2,key,html,savedAt:Date.now()});
  }).catch(()=>{});
}

function tkpGetSideBetPanelHTMLCached(raceResults){
  const key=tkpSideBetPanelCacheKey(raceResults);
  return _tkpPanelHtmlCache.get(key)||'';
}

async function tkpGetSideBetPanelHTMLAsync(raceResults,options={}){
  const key=tkpSideBetPanelCacheKey(raceResults);
  const memory=_tkpPanelHtmlCache.get(key);if(memory)return memory;
  // Anahtar yarış + skor + taze kupon imzasını içerir. Bu nedenle canlı panel de
  // Ctrl+F5 sonrasında güvenle yeniden kullanılabilir; veri değişirse anahtar zaten
  // değişir ve eski HTML okunmaz.
  const persisted=await tkpReadPersistentSideBet(key);
  if(persisted&&!/data-truncated="1"/.test(persisted)){_tkpPanelHtmlCache.set(key,persisted);return persisted;}
  return tkpCachedImmediateHtml(key,async()=>{
    const html=typeof sideBetPanelHTMLAsync==='function'
      ? await sideBetPanelHTMLAsync(raceResults,options)
      : sideBetPanelHTML(raceResults);
    if(!/data-truncated="1"/.test(html))tkpWritePersistentSideBet(key,html);
    return html;
  });
}

// V1.1.251 KÖK FIX: Back Test raporu binlerce koşulu kapsayınca çok büyük bir
// HTML string olabiliyor. Bu iki fonksiyon her okuma/yazmada SENKRON
// JSON.parse/stringify + localStorage çağrısı yapıyordu; büyük veri setlerinde
// ana thread'i tutup "Sayfa Yanıt Vermiyor" üretebiliyordu. Eski anahtar artık
// yalnız temizlik için tutulur; kalıcı anlık görüntü core-utils.js'teki
// paylaşılan IndexedDB store'unda asenkron saklanır.
const TKP_BACKTEST_PERSIST_KEY='tkp_backtest_persist_v56_hard_final_20260820';
const TKP_BACKTEST_DURABLE_CACHE_KEY='tkp_backtest_persist_v2';
if(typeof tkpDropLegacyLocalStorageKeySoon==='function') tkpDropLegacyLocalStorageKeySoon(TKP_BACKTEST_PERSIST_KEY);
function tkpBacktestDataSignature(){
  // saveDB bu imzayı zaten kalıcı olarak güncelliyor. Böylece Back Test sekmesi her
  // açılışta bütün atları tekrar hash'lemez; eski bilgisayarlarda ilk ekran da hızlanır.
  const persisted=String(db?.learning_state?.dataset_signature||'');
  const core=persisted||(typeof learningDatasetSignature==='function'?learningDatasetSignature(db):`${(db?.files||[]).length}|${(db?.races||[]).length}`);
  const side=typeof sideBetPredictionLogRevisionSignature==='function'?sideBetPredictionLogRevisionSignature(db):'';
  // Aynı toplantının kupon snapshotı güncellenince auto_coupon_log uzunluğu
  // değişmeyebilir. Bu sabit revizyon, kalıcı Back Test HTML'inin eski kuponu
  // Ctrl+F5 sonrasında bile geri getirmesini önler.
  const snapshotRevision=String(db?.settings?.backtest_snapshot_revision||'0');
  return `BTDATA3|${core}|${side}|SNAP:${snapshotRevision}`;
}
async function tkpReadPersistentBacktest(key){
  if(typeof tkpUiCacheGet!=='function')return '';
  try{
    const row=await tkpUiCacheGet(TKP_BACKTEST_DURABLE_CACHE_KEY);
    return row?.key===key&&typeof row?.html==='string'&&row.html.length>30?row.html:'';
  }catch{return '';}
}
function tkpWritePersistentBacktest(key,html){
  if(typeof html!=='string'||html.length<=30||typeof tkpUiCacheSet!=='function')return;
  // Fire-and-forget: IndexedDB structured clone ana thread'i senkron
  // JSON.stringify + localStorage.setItem kadar bloklamaz.
  Promise.resolve().then(()=>tkpUiCacheSet(TKP_BACKTEST_DURABLE_CACHE_KEY,{key,html,savedAt:Date.now()})).catch(()=>{});
}

function tkpBacktestCacheKey(budgets,limit){
  const safe={
    main:Number(budgets?.main)||0,
    main2:Number(budgets?.main2??budgets?.main)||0,
    alt:Number(budgets?.alt)||0,
    surprise:Number(budgets?.surprise)||0
  };
  return [TKP_PERFORMANCE_VERSION,'backtest','TARGETS:140-220,90-150,80-140','HARD_LIMIT:90000',tkpBacktestDataSignature(),limit,safe.main,safe.main2,safe.alt,safe.surprise].join('|');
}

function tkpGetBacktestHTMLCached(budgets,limit){
  // V1.1.251: yalnız bellek (RAM) cache'ine bakar — senkron değildir. Kalıcı
  // (IndexedDB) anlık görüntü artık yalnız tkpGetBacktestHTMLAsync üzerinden
  // asenkron olarak kontrol edilir.
  const key=tkpBacktestCacheKey(budgets,limit);
  return _tkpPanelHtmlCache.get(key)||'';
}

async function tkpGetBacktestHTMLAsync(budgets,limit){
  const key=tkpBacktestCacheKey(budgets,limit);
  const memory=tkpGetBacktestHTMLCached(budgets,limit);if(memory)return memory;
  const persisted=await tkpReadPersistentBacktest(key);
  if(persisted){_tkpPanelHtmlCache.set(key,persisted);return persisted;}
  return tkpCachedImmediateHtml(key,async()=>{const html=typeof couponArchiveBacktestHTMLAsync==='function'?await couponArchiveBacktestHTMLAsync(budgets,limit):await couponArchiveBacktestHTML(budgets,limit);tkpWritePersistentBacktest(key,html);return html;});
}

function tkpPrewarmPredictionPanels(raceResults){
  // V37.3: Yan bahis ilk tıklamada yavaş gelmesin diye panel, tahmin ekranı
  // kurulduktan sonra tarayıcı boşta iken hazırlanır. Aynı cache/promise kullanıldığı
  // için kullanıcı erken tıklasa bile ikinci bir ağır hesap başlamaz.
  if(!Array.isArray(raceResults)||!raceResults.length) return false;
  const key=tkpSideBetPanelCacheKey(raceResults);
  if(_tkpPanelHtmlCache.has(key)||_tkpPanelPromiseCache.has(key)) return true;
  const generation=_tkpPrewarmGeneration;
  const start=async()=>{
    if(generation!==_tkpPrewarmGeneration) return;
    // Önce IndexedDB kalıcı cache'i kontrol edilir. Eski yol doğrudan builder'a
    // girip Ctrl+F5'te taze cache varken bile paneli baştan hesaplıyordu.
    await tkpGetSideBetPanelHTMLAsync(raceResults).catch(()=>{});
  };
  // Yan bahis ve adaptif ağırlık ön-ısıtmaları eskiden iki bağımsız idle timer ile
  // aynı anda başlayabiliyordu. Özellikle eski Opera/Win8.1'de iki büyük geçmiş
  // taramasının çakışması event-loop tepesini yükseltip tahmin ekranından sonraki
  // ilk tıklamayı geciktiriyordu. Tek merkezî kuyruk bu işleri seri yürütür; USER
  // işleri önceliklidir ve sonuç/cache içeriği değişmez.
  if(typeof tkpQueueTask==='function') tkpQueueTask('prediction-sidebet-prewarm',start,{priority:'background',replace:true,minIdleMs:1600});
  else if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(start,{minIdleMs:1600,retryMs:250});
  else setTimeout(start,450);
  return true;
}

let _tkpAdaptiveWeightsPrewarmGeneration=0;
let _tkpAdaptiveWeightsPrewarmedFor='';
function tkpPrewarmAdaptiveLearningWeights(){
  // V1.1.308-MEM-FIX: Ayrıntılı Analiz'in "Kendini Güncelleyen Model Ailesi
  // Analizi" tablosu tkpPurposeWeightsForRace(null,'prediction'/'sidebet',1-5) kullanır --
  // bunlar race-bağımsız ('ALL' profilli), ayrı bir önbellek anahtarına sahiptir;
  // tkpPrewarmPredictionPanels() (race'e özel) bunu ısıtmaz. Isıtma her pozisyon
  // arasında tarayıcıya nefes verilerek yapılır ki ilk (soğuk) tam tarihsel taramada
  // bile sekme "Yanıt vermiyor" durumuna düşmesin.
  if(typeof db==='undefined'||!db||!Array.isArray(db.races)||!db.races.length) return false;
  const signature=(typeof db.learning_state?.dataset_signature==='string'&&db.learning_state.dataset_signature)
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):String(db.races.length));
  if(_tkpAdaptiveWeightsPrewarmedFor===signature) return true;
  if(typeof adaptiveLearningCacheIsCurrent==='function'&&adaptiveLearningCacheIsCurrent()){
    _tkpAdaptiveWeightsPrewarmedFor=signature;
    return true;
  }
  const generation=++_tkpAdaptiveWeightsPrewarmGeneration;
  const jobs=[
    ()=>{ if(typeof tkpPurposeWeightsForRace==='function') tkpPurposeWeightsForRace(null,'prediction',1); },
    ()=>{ if(typeof tkpPurposeWeightsForRace==='function') tkpPurposeWeightsForRace(null,'prediction',2); },
    ()=>{ if(typeof tkpPurposeWeightsForRace==='function') tkpPurposeWeightsForRace(null,'prediction',3); },
    ()=>{ if(typeof tkpPurposeWeightsForRace==='function') tkpPurposeWeightsForRace(null,'prediction',4); },
    ()=>{ if(typeof tkpPurposeWeightsForRace==='function') tkpPurposeWeightsForRace(null,'prediction',5); },
    ()=>{ if(typeof tkpPurposeWeightsForRace==='function') tkpPurposeWeightsForRace(null,'sidebet',4); }
  ];
  const run=async()=>{
    if(generation!==_tkpAdaptiveWeightsPrewarmGeneration) return;
    // Program yeniden açıldığında önce diskteki aynı-imzalı İlk 5 tablosunu yükle.
    // Cache bulunduysa yalnız görünüm için gerekli olan tarihsel modeli tekrar
    // taramak hiçbir değer üretmez; ağır ön-ısıtma tamamen atlanır.
    if(typeof hydrateAdaptiveLearningDurableCache==='function'){
      try{
        const hit=await hydrateAdaptiveLearningDurableCache(
          typeof adaptiveLearningRenderSignature==='function'?adaptiveLearningRenderSignature():''
        );
        if(hit&&typeof adaptiveLearningCacheIsCurrent==='function'&&adaptiveLearningCacheIsCurrent()){
          _tkpAdaptiveWeightsPrewarmedFor=signature;
          return;
        }
      }catch(_e){}
    }
    // V1.1.308-MEM-FIX (kök neden): tkpPurposeWeightsForRace(null,...) her çağrıda
    // adaptiveSignalStats(null)'a düşer -- 3018 yarışlık gerçek arşivde bu TEK BAŞINA
    // ~187 saniye senkron blok anlamına geliyordu (aşağıdaki jobs döngüsü sadece 6
    // çağrı arasında nefes veriyordu, ama HER çağrının kendisi tek seferde koca bloktu).
    // Bu yüzden önce paylaşılan önbelleği (aynı _adaptiveStatsCache/persist yolu)
    // yarış döngüsü İÇİNDE küçük parçalar halinde, tarayıcıya sürekli nefes vererek
    // dolduruyoruz. Bu tamamlandıktan sonra aşağıdaki 6 iş senkron çağrılsa bile
    // artık sadece sıcak önbellekten okuma yapar (milisaniyeler sürer).
    if(typeof adaptiveSignalStatsAsync==='function'){
      try{ await adaptiveSignalStatsAsync(null); }catch(_e){}
      if(generation!==_tkpAdaptiveWeightsPrewarmGeneration) return;
    }
    for(const job of jobs){
      if(generation!==_tkpAdaptiveWeightsPrewarmGeneration) return;
      try{ job(); }catch(_e){}
      await tkpYieldToUi();
    }
    _tkpAdaptiveWeightsPrewarmedFor=signature;
  };
  const start=async()=>{ if(generation===_tkpAdaptiveWeightsPrewarmGeneration) await run(); };
  // prediction-sidebet-prewarm ile aynı anda iki tam geçmiş hesabı çalıştırma.
  // Sıralama yalnız zamanlamayı düzenler; model ağırlıkları ve kalıcı cache anahtarı
  // aynıdır. Kuyruk yoksa geriye dönük idle yolu korunur.
  if(typeof tkpQueueTask==='function') tkpQueueTask('prediction-adaptive-weights-prewarm',start,{priority:'background',replace:true,minIdleMs:1600});
  else if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(start,{minIdleMs:1600,retryMs:250});
  else setTimeout(start,450);
  return true;
}


let _tkpCouponPrewarmGeneration=0;
function tkpPrewarmCouponSet(raceResults,budgets){
  if(!Array.isArray(raceResults)||!raceResults.length||(typeof tkpBuildCouponSetAdaptive!=='function'&&typeof buildCouponSetFast!=='function')) return false;
  const generation=++_tkpCouponPrewarmGeneration;
  const safe=budgets||((typeof _v24ReadBudgets==='function')?_v24ReadBudgets():{main:1000,main2:1000,alt:0,surprise:1100});
  const run=async()=>{
    if(generation!==_tkpCouponPrewarmGeneration) return;
    try{
      if(typeof tkpBuildCouponSetAdaptiveAsync==='function') await tkpBuildCouponSetAdaptiveAsync(raceResults,{...safe,mainMax:2400,surpriseMax:1200});
      else if(typeof tkpBuildCouponSetAdaptive==='function') tkpBuildCouponSetAdaptive(raceResults,{...safe,mainMax:2400,surpriseMax:1200});
      else buildCouponSetFast(raceResults,safe);
    }catch(_e){}
  };
  if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(run,{minIdleMs:1600,retryMs:250});
  else setTimeout(run,450);
  return true;
}

let _tkpLastFrameCheckpoint=tkpNow();
async function tkpFrameCheckpoint(force=false){
  const now=tkpNow();
  const inputPending=Boolean(globalThis.navigator?.scheduling?.isInputPending?.());
  if(force||inputPending||now-_tkpLastFrameCheckpoint>=8){await tkpYieldToUi();_tkpLastFrameCheckpoint=tkpNow();return true;}
  return false;
}
function tkpYield(){
  // Geriye dönük sözleşme: bu API çağrıldığı her yerde gerçekten event-loop'a yield eder.
  return tkpYieldToUi();
}

window.addEventListener('tkp:db-changed',event=>{
  const detail=event?.detail||{};
  // Side-bet/backtest HTML anahtarları yarış + kupon imzası taşır. Basit bir
  // ayar/bahis/log kaydı yüzünden tüm pahalı panelleri silmek darboğaz üretiyordu.
  // Yeni kupon snapshotı yalnız kendi O(1) revizyonunu değiştirir. Burada bütün
  // panel Promise/cache'lerini silmek post-kupon ısıtmasını iki kez başlatıp İlk
  // Bakış'tan sonraki ekranı kilitliyordu. Sonuç/öğrenme geri dönüşleri ise hâlâ
  // gerçek model girdisini değiştirdiğinden tam temizleme gerektirir.
  if(detail.learningChanged||detail.rollback||detail.resultsChanged)tkpClearPerformanceCaches();
});

// V1.1.282 — cache/RAM guard ve yaşam döngüsü iptali.
if(typeof window!=='undefined'){
  let __tkpHardeningSweepTimer=0;
  const scheduleSweep=()=>{clearTimeout(__tkpHardeningSweepTimer);__tkpHardeningSweepTimer=setTimeout(()=>{try{tkpMemoryPressureSweep();}catch(_e){}},250);};
  window.addEventListener('tkp:db-changed',scheduleSweep);
  window.addEventListener('pagehide',()=>{try{tkpCancelAllJobs('pagehide');}catch(_e){}});
}
