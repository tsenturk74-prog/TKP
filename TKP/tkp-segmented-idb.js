/*
 * TKP Segmented IndexedDB Engine v2
 *
 * Amaç:
 * - Ana veritabanını tek dev JSON/string olarak yazmamak.
 * - Her üst-seviye diziyi içerik-adresli, küçük ve doğrulanabilir parçalara ayırmak.
 * - Yazım tamamlanmadan aktif manifesti değiştirmemek (atomik manifest geçişi).
 * - Önceki sağlam manifesti otomatik korumak ve kesilen yazımdan geri dönebilmek.
 * - Büyük veri işlerken ana ekranı düzenli olarak serbest bırakmak.
 *
 * Bu katman mevcut db nesnesiyle geriye uyumludur. Yeni kod, büyük arşivlerde
 * doğrudan loadCollectionPage() API'sini kullanarak bütün koleksiyonu RAM'e almadan
 * sayfalı okuyabilir.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.TKPSegmentedIDB=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ENGINE_VERSION='2.0.0';
  const DB_NAME='tkp_core_idb_segmented_v2';
  const DB_VERSION=1;
  const STORE_MANIFESTS='manifests';
  const STORE_CHUNKS='chunks';
  const ACTIVE_MANIFEST='active';
  const PREVIOUS_MANIFEST='previous';
  const DEFAULT_MAX_RECORDS=50000;
  const DEFAULT_TARGET_BYTES=512*1024;
  // 24 x 512 KB (~12 MB) tek transaction, gerçek Chromium/IndexedDB 10M
  // koşusunda 82 uzun görev üretti. 8 parçalık uç değer uzun görevleri azalttı
  // fakat toplam yazmayı 2,8 kat yavaşlattı. 16 parça (~8 MB), transaction
  // maliyeti ile ana olay kuyruğuna dönüş sıklığı arasındaki dengeli değerdir.
  const DEFAULT_WRITE_BATCH=16;
  // Büyük restore'larda parçalar 2 MB olabilir. 256 parçayı tek transaction ve
  // tek structured-clone dalgasında okumak 300+ MB veriyi ana iş parçacığına
  // bir anda taşıyıp ekranı kilitliyordu. Okuma artık hem parça sayısı hem de
  // manifest byte toplamıyla sınırlandırılır; her grup arasında olay kuyruğuna
  // dönülür. Bütün kayıtlar yine eksiksiz materyalize edilir.
  const DEFAULT_READ_BATCH=16;
  // Okuma tarafında 1 MB sınırı 135 MB arşiv için 130'dan fazla ayrı IndexedDB
  // transaction/yield turu oluşturuyordu. Özellikle Win8.1 Chromium/Opera'da bu
  // tur başına maliyet, gerçek structured-clone süresinden daha pahalıydı.
  // 4 MB; 512 KB'lık güncel parçalarda sekiz istek demektir: tek uzun 128 MB
  // dalgası yaratmadan transaction sayısını yaklaşık dörtte bire indirir.
  const DEFAULT_READ_BATCH_BYTES=4*1024*1024;
  const DEFAULT_YIELD_MS=14;
  const DEFAULT_TIMEOUT_MS=180000;
  // 10M arşivde yalnız tarayıcıya sığan sıcak pencere tutulur. Bu sayı "tüm
  // arşivi RAM'e al" hedefi değildir; her zaman byte sınırıyla birlikte uygulanır.
  // 120 bin kayıt, Win8.1/Opera'da indeksleme ve ilk boyama için güvenli üst
  // sınırdır; eski 509 toplantılık paket bu eşiğin altında olduğundan eksiksiz
  // sıcak kalmaya devam eder.
  const DEFAULT_MAX_MATERIALIZED_RECORDS=120000;
  const GC_MIN_AGE_MS=24*60*60*1000;
  const textEncoder=typeof TextEncoder!=='undefined'?new TextEncoder():null;

  let _browserDbPromise=null;
  let _browserAdapter=null;
  const VERIFIED_GENERATION=typeof Symbol==='function'?Symbol('tkpVerifiedGeneration'):'__tkpVerifiedGeneration';
  let _lastStatus={mode:'idle',verified:false,error:'',generation:'',bytes:0,records:0,chunks:0,updatedAt:''};
  let _operationChain=Promise.resolve();

  function nowIso(){ return new Date().toISOString(); }
  function utf8Bytes(value){
    const s=String(value??'');
    return textEncoder?textEncoder.encode(s).byteLength:s.length;
  }
  function dualHash(input){
    const s=String(input??'');
    let a=2166136261>>>0;
    let b=0x9e3779b9>>>0;
    for(let i=0;i<s.length;i++){
      const c=s.charCodeAt(i);
      a^=c; a=Math.imul(a,16777619)>>>0;
      b^=(c+i)&0xffff; b=Math.imul(b,2246822519)>>>0; b=(b^(b>>>13))>>>0;
    }
    return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
  }
  function stableManifestHash(manifest){
    const compact={
      engine:manifest.engine,
      schemaVersion:manifest.schemaVersion,
      generation:manifest.generation,
      createdAt:manifest.createdAt,
      totalRecords:Number(manifest.totalRecords)||0,
      totalBytes:Number(manifest.totalBytes)||0,
      totalChunks:Number(manifest.totalChunks)||0,
      metaHash:dualHash(JSON.stringify(manifest.meta||{})),
      collections:Object.fromEntries(Object.entries(manifest.collections||{}).map(([name,info])=>[
        name,
        {
          count:Number(info.count)||0,
          bytes:Number(info.bytes)||0,
          refs:(info.refs||[]).map(r=>[r.key,r.start,r.count,r.bytes,r.hash])
        }
      ]))
    };
    return dualHash(JSON.stringify(compact));
  }

  // R16.94: metadata grows as learned caches are populated. Its clone, JSON
  // encoding and integrity hash must be cooperative too, not just row chunks.
  async function drainStorageSteps(steps){
    let tick=monotonicNow(),step;
    do{step=steps.next();if(!step.done&&monotonicNow()-tick>=8){await yieldToUi(true);tick=monotonicNow();}}while(!step.done);
    return step.value;
  }
  // Native JSON encoding is much faster for bounded plain subtrees. Probe data
  // descriptors only, so getters/toJSON are still evaluated exactly once below.
  function smallJsonTree(value,budget={slots:384,chars:32768},depth=0){
    if(value===null)return true;
    const type=typeof value;
    if(type==='string'){budget.chars-=value.length;return budget.chars>=0;}
    if(type!=='object')return type!=='bigint';
    if(depth>24||('toJSON' in value))return false;
    const proto=Object.getPrototypeOf(value);
    if(proto!==Object.prototype&&proto!==Array.prototype&&proto!==null)return false;
    const keys=Object.keys(value);budget.slots-=keys.length;
    if(budget.slots<0||(Array.isArray(value)&&value.length>384))return false;
    for(const key of keys){
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))return false;
      budget.chars-=key.length;
      if(budget.chars<0||!smallJsonTree(descriptor.value,budget,depth+1))return false;
    }
    return true;
  }
  function* jsonParts(value,key='',ancestors=new Set(),normalized=false){
    if(!normalized&&value&&typeof value==='object'&&typeof value.toJSON==='function')value=value.toJSON(key);
    if(value instanceof Number||value instanceof String||value instanceof Boolean)value=value.valueOf();
    if(value===null||typeof value!=='object'){yield JSON.stringify(value);return;}
    if(Object.prototype.toString.call(value)==='[object BigInt]'){yield JSON.stringify(value);return;}
    if(smallJsonTree(value)){yield JSON.stringify(value);return;}
    if(ancestors.has(value))throw new TypeError('Converting circular structure to JSON');
    ancestors.add(value);
    if(Array.isArray(value)){
      yield '[';
      for(let i=0;i<value.length;i++){
        if(i)yield ',';
        let child=value[i];if(child&&typeof child.toJSON==='function')child=child.toJSON(String(i));
        if(child===undefined||typeof child==='function'||typeof child==='symbol')yield 'null';
        else yield* jsonParts(child,String(i),ancestors,true);
      }
      yield ']';
    }else{
      yield '{';let comma=false;
      for(const name of Object.keys(value)){
        let child=value[name];if(child&&typeof child.toJSON==='function')child=child.toJSON(name);
        if(child===undefined||typeof child==='function'||typeof child==='symbol')continue;
        if(comma)yield ',';comma=true;yield JSON.stringify(name);yield ':';yield* jsonParts(child,name,ancestors,true);
      }
      yield '}';
    }
    ancestors.delete(value);
  }
  async function stringifyAsync(value){
    const parts=[],steps=jsonParts(value);let tick=monotonicNow();
    for(const part of steps){parts.push(part);if(monotonicNow()-tick>=8){await yieldToUi(true);tick=monotonicNow();}}
    return parts.length===1&&parts[0]===undefined?undefined:parts.join('');
  }
  async function dualHashAsync(input){
    const s=String(input??'');let a=2166136261>>>0,b=0x9e3779b9>>>0,tick=monotonicNow();
    for(let start=0;start<s.length;start+=32768){
      const end=Math.min(s.length,start+32768);
      for(let i=start;i<end;i++){const c=s.charCodeAt(i);a^=c;a=Math.imul(a,16777619)>>>0;b^=(c+i)&0xffff;b=Math.imul(b,2246822519)>>>0;b=(b^(b>>>13))>>>0;}
      if(monotonicNow()-tick>=8){await yieldToUi(true);tick=monotonicNow();}
    }
    return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
  }
  async function stableManifestHashAsync(manifest){
    const metaHash=await dualHashAsync(await stringifyAsync(manifest.meta||{}));
    const compact={engine:manifest.engine,schemaVersion:manifest.schemaVersion,generation:manifest.generation,createdAt:manifest.createdAt,
      totalRecords:Number(manifest.totalRecords)||0,totalBytes:Number(manifest.totalBytes)||0,totalChunks:Number(manifest.totalChunks)||0,metaHash,
      collections:Object.fromEntries(Object.entries(manifest.collections||{}).map(([name,info])=>[name,{count:Number(info.count)||0,bytes:Number(info.bytes)||0,refs:(info.refs||[]).map(r=>[r.key,r.start,r.count,r.bytes,r.hash])}]))};
    return dualHashAsync(await stringifyAsync(compact));
  }
  async function validManifestAsync(manifest){return structurallyValidManifest(manifest)&&(!manifest.manifestHash||manifest.manifestHash===await stableManifestHashAsync(manifest));}
  function* cloneSteps(value,seen=new Map()){
    if(value===null||typeof value!=='object'){
      if(typeof value==='function'||typeof value==='symbol')throw new TypeError('Not structured-cloneable');
      return value;
    }
    if(seen.has(value))return seen.get(value);
    if(Object.getPrototypeOf(value)!==Object.prototype&&!Array.isArray(value)&&Object.getPrototypeOf(value)!==null)return clonePlain(value);
    const out=Array.isArray(value)?new Array(value.length):{};seen.set(value,out);
    for(const key of Object.keys(value)){yield;Object.defineProperty(out,key,{value:yield* cloneSteps(value[key],seen),writable:true,enumerable:true,configurable:true});}
    return out;
  }
  async function clonePlainAsync(value){
    try{return await drainStorageSteps(cloneSteps(value));}
    catch(error){return JSON.parse(await stringifyAsync(value));}
  }
  async function splitDbAsync(source){
    const meta={},collections={};
    for(const [key,value] of Object.entries(source||{})){
      if(String(key).startsWith('__segmented_'))continue;
      if(Array.isArray(value))collections[key]=compactCollectionForPersistence(key,value);
      else{setStatus({phase:'meta-copy',collection:key});meta[key]=await clonePlainAsync(value);}
      await yieldToUi(true);
    }
    return {meta,collections};
  }

  function randomGeneration(){
    const rand=(typeof crypto!=='undefined'&&typeof crypto.getRandomValues==='function')
      ?Array.from(crypto.getRandomValues(new Uint32Array(2))).map(x=>x.toString(36)).join('')
      :Math.random().toString(36).slice(2);
    return `${Date.now().toString(36)}-${rand}`;
  }
  function timeout(promise,ms=DEFAULT_TIMEOUT_MS,label='işlem',onTimeout){
    return new Promise((resolve,reject)=>{
      let done=false;
      const timer=setTimeout(()=>{if(done)return;done=true;if(onTimeout)onTimeout();reject(new Error(`${label} zaman aşımına uğradı (${ms} ms).`));},ms);
      Promise.resolve(promise).then(v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);},e=>{if(done)return;done=true;clearTimeout(timer);reject(e);});
    });
  }
  function monotonicNow(){
    return typeof performance!=='undefined'&&typeof performance.now==='function'?performance.now():Date.now();
  }
  function yieldToUi(force=false){
    if(!force) return Promise.resolve();
    if(typeof MessageChannel==='function')return new Promise(resolve=>{
      let channel,timer,finished=false;
      const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);try{channel?.port1.close();channel?.port2.close();}catch(_){}resolve();};
      try{channel=new MessageChannel();channel.port1.onmessage=finish;timer=setTimeout(finish,48);channel.port2.postMessage(0);}catch(_){finish();}
    });
    // requestIdleCallback eski Chromium'da yoğun açılış sırasında her 1 MB grubu
    // timeout'a (25 ms) kadar bekletiyordu. Burada amaç boş zamanı beklemek değil,
    // yalnız boya/girdi task'ına sıra vermektir; sıfır gecikmeli task bunun doğru
    // ve öngörülebilir karşılığıdır.
    return new Promise(resolve=>setTimeout(resolve,0));
  }
  async function yieldReadIfDue(lastYield,options={}){
    const interval=Math.max(8,Number(options.readYieldMs)||DEFAULT_YIELD_MS);
    const now=monotonicNow();
    if(now-lastYield<interval) return lastYield;
    await yieldToUi(true);
    return monotonicNow();
  }
  function clonePlain(value){
    if(value==null || typeof value!=='object') return value;
    if(typeof structuredClone==='function'){
      try{return structuredClone(value);}catch(_e){}
    }
    return JSON.parse(JSON.stringify(value));
  }
  const TRANSIENT_RACE_CACHE_KEYS=new Set(['__tkpLiveHorsesSrc','__tkpLiveHorsesCache','_accurateFieldAvgCache']);
  function compactCollectionForPersistence(name,value){
    if(name!=='races'||!Array.isArray(value))return value;
    return value.map(race=>{
      if(!race||typeof race!=='object')return race;
      if(![...TRANSIENT_RACE_CACHE_KEYS].some(key=>Object.prototype.hasOwnProperty.call(race,key)))return race;
      const clean={...race};
      for(const key of TRANSIENT_RACE_CACHE_KEYS)delete clean[key];
      return clean;
    });
  }
  function splitDb(source){
    const meta={};
    const collections={};
    for(const [key,value] of Object.entries(source||{})){
      if(String(key).startsWith('__segmented_')) continue;
      if(Array.isArray(value)) collections[key]=compactCollectionForPersistence(key,value);
      else {setStatus({phase:"meta",collection:key});meta[key]=clonePlain(value);}
    }
    return {meta,collections};
  }
  function structurallyValidManifest(manifest){
    return !!(manifest && typeof manifest==='object' && manifest.complete===true
      && manifest.generation && manifest.collections && typeof manifest.collections==='object');
  }
  function manifestHashValid(manifest){
    return structurallyValidManifest(manifest) && (!manifest.manifestHash || manifest.manifestHash===stableManifestHash(manifest));
  }
  function validManifest(manifest){ return manifestHashValid(manifest); }
  function status(){ return {..._lastStatus}; }
  function setStatus(patch){ try{globalThis.__tkpTrace?.("storage",patch);}catch(_){} _lastStatus={..._lastStatus,...patch,updatedAt:nowIso()}; return status(); }
  function adapterVerifiedGeneration(adapter){return String(adapter?.[VERIFIED_GENERATION]||'');}
  function markAdapterVerified(adapter,generation){
    if(!adapter)return;
    try{adapter[VERIFIED_GENERATION]=String(generation||'');}catch(_e){}
  }

  function openBrowserDb(){
    if(_browserDbPromise) return _browserDbPromise;
    _browserDbPromise=timeout(new Promise((resolve,reject)=>{
      try{
        if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB kullanılamıyor.'));return;}
        const req=indexedDB.open(DB_NAME,DB_VERSION);
        req.onupgradeneeded=()=>{
          const db=req.result;
          if(!db.objectStoreNames.contains(STORE_MANIFESTS)) db.createObjectStore(STORE_MANIFESTS);
          if(!db.objectStoreNames.contains(STORE_CHUNKS)) db.createObjectStore(STORE_CHUNKS);
        };
        req.onsuccess=()=>{
          const db=req.result;
          db.onversionchange=()=>{try{db.close();}catch(_e){} _browserDbPromise=null;};
          resolve(db);
        };
        req.onerror=()=>reject(req.error||new Error('IndexedDB açılamadı.'));
        req.onblocked=()=>reject(new Error('IndexedDB başka sekme tarafından engellendi. Diğer TKP pencerelerini kapat.'));
      }catch(error){reject(error);}
    }),30000,'IndexedDB açılışı').catch(error=>{_browserDbPromise=null;throw error;});
    return _browserDbPromise;
  }

  function browserRequest(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('IndexedDB isteği başarısız.'));
    });
  }
  function browserTxDone(tx){
    return new Promise((resolve,reject)=>{
      const finish=(error)=>{clearTimeout(timer);error?reject(error):resolve(true);};
      const timer=setTimeout(()=>{try{tx.abort();}catch(_){}finish(new Error('IndexedDB disk işlemi 30 saniyede tamamlanmadı; işlem iptal edildi.'));},30000);
      tx.oncomplete=()=>finish();
      tx.onerror=()=>finish(tx.error||new Error('IndexedDB işlemi başarısız.'));
      tx.onabort=()=>finish(tx.error||new Error('IndexedDB işlemi iptal edildi.'));
    });
  }

  function createBrowserAdapter(){
    const transactions=new Set();let cancelled=false;
    function transaction(db,store,mode){
      if(cancelled)throw new Error('Süresi dolmuş kayıt işlemi durduruldu.');
      const tx=db.transaction(store,mode);transactions.add(tx);
      if(typeof tx.addEventListener==='function')for(const event of ['complete','abort','error'])tx.addEventListener(event,()=>transactions.delete(tx),{once:true});
      return tx;
    }
    return {
      cancelPending(){cancelled=true;for(const tx of transactions)try{tx.abort();}catch(_){}transactions.clear();},
      async getManifest(key){
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_MANIFESTS,'readonly');
        return browserRequest(tx.objectStore(STORE_MANIFESTS).get(key));
      },
      async putChunks(entries){
        if(!entries.length) return true;
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_CHUNKS,'readwrite');
        const store=tx.objectStore(STORE_CHUNKS);
        for(const [key,value] of entries) store.put(value,key);
        await browserTxDone(tx);
        return true;
      },
      async getChunks(keys){
        if(!keys.length) return [];
        const db=await openBrowserDb();
        const out=new Array(keys.length);
        // Çağıran katman hem parça sayısını hem byte toplamını zaten sınırlar.
        // Burada yeniden 16'şarlı transaction açmak aynı bounded batch'i ikinci kez
        // parçalayarak büyük arşiv açılışını uzatıyordu. Bir bounded batch = bir
        // readonly transaction; bütün get istekleri aynı transaction'da paraleldir.
        const tx=transaction(db,STORE_CHUNKS,'readonly');
        const store=tx.objectStore(STORE_CHUNKS);
        const done=browserTxDone(tx);
        await Promise.all(keys.map((key,i)=>browserRequest(store.get(key)).then(v=>{out[i]=v;})));
        await done;
        return out;
      },
      async commitManifest(next,current){
        const previousValid=current&&await validManifestAsync(current);
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_MANIFESTS,'readwrite');
        const store=tx.objectStore(STORE_MANIFESTS);
        if(previousValid) store.put(current,PREVIOUS_MANIFEST);
        store.put(next,ACTIVE_MANIFEST);
        await browserTxDone(tx);
        return true;
      },
      async putManifest(key,value){
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_MANIFESTS,'readwrite');
        tx.objectStore(STORE_MANIFESTS).put(value,key);
        await browserTxDone(tx);
        return true;
      },
      async listManifests(){
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_MANIFESTS,'readonly');
        const store=tx.objectStore(STORE_MANIFESTS);
        if(typeof store.getAll==='function' && typeof store.getAllKeys==='function'){
          const [keys,values]=await Promise.all([browserRequest(store.getAllKeys()),browserRequest(store.getAll())]);
          return keys.map((key,i)=>[key,values[i]]);
        }
        const rows=[];
        await new Promise((resolve,reject)=>{
          const req=store.openCursor();
          req.onsuccess=()=>{const cur=req.result;if(!cur){resolve();return;}rows.push([cur.key,cur.value]);cur.continue();};
          req.onerror=()=>reject(req.error);
        });
        return rows;
      },
      async deleteManifestsExcept(keepKeys){
        const keep=new Set([...keepKeys].map(String));
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_MANIFESTS,'readwrite');
        const store=tx.objectStore(STORE_MANIFESTS);
        await new Promise((resolve,reject)=>{
          const req=store.openCursor();
          req.onsuccess=()=>{const cur=req.result;if(!cur){resolve();return;}if(!keep.has(String(cur.key)))cur.delete();cur.continue();};
          req.onerror=()=>reject(req.error||new Error('Manifest temizliği başarısız.'));
        });
        await browserTxDone(tx);
        return true;
      },
      async deleteOldChunks(keepKeys,minCreatedAt){
        const db=await openBrowserDb();
        const tx=transaction(db,STORE_CHUNKS,'readwrite');
        const store=tx.objectStore(STORE_CHUNKS);
        await new Promise((resolve,reject)=>{
          const req=store.openCursor();
          req.onsuccess=()=>{
            const cur=req.result;
            if(!cur){resolve();return;}
            const created=Number(cur.value?.createdAtMs)||0;
            if(!keepKeys.has(String(cur.key)) && created<minCreatedAt) cur.delete();
            cur.continue();
          };
          req.onerror=()=>reject(req.error||new Error('Chunk temizliği başarısız.'));
        });
        await browserTxDone(tx);
        return true;
      }
    };
  }

  function browserAdapter(){
    if(!_browserAdapter) _browserAdapter=createBrowserAdapter();
    return _browserAdapter;
  }

  function createMemoryAdapter(){
    const manifests=new Map();
    const chunks=new Map();
    return {
      manifests,chunks,
      async getManifest(key){return manifests.get(key);},
      async putChunks(entries){for(const [k,v] of entries)chunks.set(k,clonePlain(v));return true;},
      async getChunks(keys){return keys.map(k=>clonePlain(chunks.get(k)));},
      async commitManifest(next,current){if(current&&validManifest(current))manifests.set(PREVIOUS_MANIFEST,clonePlain(current));manifests.set(ACTIVE_MANIFEST,clonePlain(next));return true;},
      async putManifest(key,value){manifests.set(key,clonePlain(value));return true;},
      async listManifests(){return [...manifests.entries()].map(([k,v])=>[k,clonePlain(v)]);},
      async deleteManifestsExcept(keepKeys){const keep=new Set([...keepKeys].map(String));for(const key of [...manifests.keys()])if(!keep.has(String(key)))manifests.delete(key);return true;},
      async deleteOldChunks(keepKeys,minCreatedAt){for(const [k,v] of chunks){if(!keepKeys.has(k)&&Number(v?.createdAtMs||0)<minCreatedAt)chunks.delete(k);}return true;}
    };
  }

  async function makeChunk(collectionName,source,start,options,countHint=0){
    const maxRecords=Math.max(1,Number(options.maxRecords)||DEFAULT_MAX_RECORDS);
    const targetBytes=Math.max(16*1024,Number(options.targetBytes)||DEFAULT_TARGET_BYTES);
    const remaining=Math.max(0,Number(source.length)||0)-start;
    if(remaining<=0) return null;

    // HIZ KÖK FIX: Eski kod HER yeni parçada yeniden bütün kalan koleksiyonu
    // JSON.stringify edip sonra 512 KB'a doğru küçültüyordu. 432 büyük race kaydında
    // bu O(n²) davranış 10 MB -> 9.5 MB -> 9 MB ... şeklinde aynı veriyi onlarca kez
    // serileştiriyor ve gerçek 17 MB DB kaydını ~5 sn ana-thread CPU işine çeviriyordu.
    // İlk parçada küçük bir örnekle makul kayıt sayısını tahmin et; sonraki parçalarda
    // bir önceki gerçek chunk boyutunu başlangıç ipucu olarak kullan. Nihai payload yine
    // aşağıdaki tam JSON.stringify + byte sınırı + hash ile doğrulanır; veri/format değişmez.
    let count=0;
    const hinted=Math.max(0,Math.floor(Number(countHint)||0));
    if(hinted>0){
      count=Math.min(maxRecords,remaining,hinted);
    }else{
      const sampleCount=Math.min(1,remaining,maxRecords);
      let estimatedCount=sampleCount;
      if(sampleCount>0 && remaining>sampleCount){
        try{
          const sampleSerialized=await stringifyAsync(source.slice(start,start+sampleCount));
          const sampleBytes=Math.max(1,utf8Bytes(sampleSerialized)-2);
          const avgBytes=Math.max(1,sampleBytes/sampleCount);
          estimatedCount=Math.max(1,Math.floor((targetBytes*0.88)/avgBytes));
        }catch(_e){ estimatedCount=sampleCount; }
      }
      count=Math.min(maxRecords,remaining,Math.max(1,estimatedCount));
    }

    let payload,serialized,bytes;
    while(true){
      payload=source.slice(start,start+count);
      serialized=await stringifyAsync(payload);
      bytes=utf8Bytes(serialized);
      if(bytes<=targetBytes || count<=1) break;
      const ratio=Math.max(0.1,Math.min(0.9,targetBytes/Math.max(1,bytes)));
      count=Math.max(1,Math.floor(count*ratio));
    }
    const hash=await dualHashAsync(serialized);
    const key=`${collectionName}|${hash}|${count}|${bytes}`;
    return {key,payload,count,bytes,hash,start};
  }

  async function saveSnapshotWithAdapter(adapter,source,options={}){
    const check=()=>{if(typeof options.assertActive==='function')options.assertActive();};
    check();
    if(!adapter) throw new Error('Depolama adaptörü yok.');
    const started=Date.now();
    setStatus({phase:"manifest-read"});const currentRaw=await adapter.getManifest(ACTIVE_MANIFEST);setStatus({phase:"manifest-validate"});
    const safeInfo=source?.__segmented_storage?.safeMode===true?source.__segmented_storage:null;
    if(safeInfo){
      if(!validManifest(currentRaw)) throw new Error('Güvenli büyük-veri kaydı için aktif temel manifest bulunamadı.');
      if(String(safeInfo.baseGeneration||'')!==String(currentRaw.generation||'')){
        throw new Error('Büyük-veri temel nesli başka sekmede değişti; veri kaybını önlemek için kayıt durduruldu. Sayfayı yenile.');
      }
    }
    // Chunk yeniden kullanımına yalnız bu oturumda doğrulanmış/başarıyla yazılmış
    // aktif nesilde izin verilir. Başka sekmenin yeni nesli veya doğrulanmamış bir
    // manifest varsa bütün parçalar güvenle yeniden yazılır.
    const currentIsValid=await validManifestAsync(currentRaw);
    const verifiedGeneration=adapterVerifiedGeneration(adapter);
    if(currentIsValid && verifiedGeneration && verifiedGeneration!==String(currentRaw.generation||'')){
      throw new Error('Aktif veri nesli başka sekmede değişti; eski görünümün yeni veriyi ezmesi engellendi. Sayfayı yenile.');
    }
    const current=(currentIsValid && verifiedGeneration===String(currentRaw.generation||''))
      ?currentRaw:null;
    if(safeInfo&&!current) throw new Error('Büyük-veri aktif nesli bu oturumda doğrulanmadı; güvenli kayıt yapılamadı.');
    const generation=randomGeneration();
    setStatus({phase:"split"});const {meta,collections}=await splitDbAsync(source);setStatus({phase:"split-done"});
    const manifest={
      engine:ENGINE_VERSION,
      schemaVersion:Number(source?.schema_version)||0,
      generation,
      createdAt:nowIso(),
      createdAtMs:Date.now(),
      complete:false,
      meta,
      collections:{},
      totalRecords:0,
      totalBytes:0,
      totalChunks:0
    };
    const pending=[];
    let reusedChunks=0;
    const writeBatch=Math.max(1,Number(options.writeBatch)||DEFAULT_WRITE_BATCH);
    let lastYield=Date.now();
    const flush=async()=>{
      check();
      if(!pending.length)return;
      const batch=pending.splice(0,pending.length);
      await adapter.putChunks(batch);
      if(Date.now()-lastYield>=DEFAULT_YIELD_MS){lastYield=Date.now();await yieldToUi(true);}
    };

    for(const [name,collection] of Object.entries(collections)){
      const currentInfo=current?.collections?.[name];
      const currentRefs=Array.isArray(currentInfo?.refs)?currentInfo.refs:[];
      const safeCollection=safeInfo?.collections?.[name];
      let baseOffset=0;
      const refs=[];
      let collectionBytes=0;
      if(safeCollection){
        baseOffset=Math.max(0,Number(safeCollection.loadedOffset)||0);
        const prefix=currentRefs.filter(ref=>Number(ref.start)+Number(ref.count)<=baseOffset);
        const prefixCount=prefix.reduce((sum,ref)=>sum+Number(ref.count||0),0);
        if(prefixCount!==baseOffset) throw new Error(`${name} soğuk arşiv sınırı manifest parçalarıyla uyuşmuyor.`);
        for(const ref of prefix) refs.push({...ref});
        collectionBytes=prefix.reduce((sum,ref)=>sum+Number(ref.bytes||0),0);
        manifest.totalRecords+=prefixCount;
        manifest.totalBytes+=collectionBytes;
        manifest.totalChunks+=prefix.length;
        reusedChunks+=prefix.length;
      }
      let start=0;
      let chunkCountHint=0;
      while(start<collection.length){
        check();
        setStatus({phase:"chunk",collection:name,start});const chunk=await makeChunk(name,collection,start,options,chunkCountHint);
        if(!chunk)break;
        chunkCountHint=chunk.count;
        const globalStart=baseOffset+chunk.start;
        const refIndex=refs.length;
        if(currentRefs[refIndex]?.key===chunk.key) reusedChunks++;
        else pending.push([chunk.key,{payload:chunk.payload,count:chunk.count,bytes:chunk.bytes,hash:chunk.hash,createdAtMs:Date.now(),engine:ENGINE_VERSION}]);
        refs.push({key:chunk.key,start:globalStart,count:chunk.count,bytes:chunk.bytes,hash:chunk.hash});
        start+=chunk.count;
        collectionBytes+=chunk.bytes;
        manifest.totalRecords+=chunk.count;
        manifest.totalBytes+=chunk.bytes;
        manifest.totalChunks++;
        if(pending.length>=writeBatch) await flush();
        if(typeof options.onProgress==='function') options.onProgress({phase:'write',collection:name,processed:start,total:collection.length,totalRecords:manifest.totalRecords,totalBytes:manifest.totalBytes,safeMode:Boolean(safeInfo)});
        // Büyük (.tkpbak) geri yüklemelerinde 2 MB'lık parçalar sekizli yazma
        // grubu dolana kadar arka arkaya hazırlanıyordu. IndexedDB toplu yazımı
        // hızlı kalsa da bu aralık sekme/buton olaylarını uzun süre bekletebiliyordu.
        // Her parça sonrasında yalnız zaman bütçesi aşıldıysa tarayıcıya bir tur ver;
        // parça boyutu, atomik manifest ve yazma grubu aynen korunur.
        if(Date.now()-lastYield>=DEFAULT_YIELD_MS){lastYield=Date.now();await yieldToUi(true);}
      }
      manifest.collections[name]={count:baseOffset+collection.length,bytes:collectionBytes,refs};
    }
    await flush();
    manifest.complete=true;
    manifest.manifestHash=await stableManifestHashAsync(manifest);
    check();
    await adapter.commitManifest(manifest,current);
    check();
    markAdapterVerified(adapter,generation);
    // Güvenli/hot-window nesnesi aynı oturumda tekrar kaydedilebilsin. Manifest
    // nesli atomik geçişten sonra değiştiği için RAM'deki taban nesli de güncellenmezse
    // ikinci saveDB çağrısı yanlış biçimde çapraz-sekme çakışması sanılır. Soğuk
    // prefix sınırları korunur; yeni koleksiyonlar sıfır soğuk kayıtla eklenir.
    if(safeInfo){
      const nextCollections={};
      let loadedRecords=0;
      for(const [name,info] of Object.entries(manifest.collections||{})){
        const rows=Array.isArray(collections[name])?collections[name]:[];
        const previousState=safeInfo.collections?.[name];
        const loadedOffset=previousState?Math.max(0,Number(previousState.loadedOffset)||0):0;
        loadedRecords+=rows.length;
        nextCollections[name]={
          total:Number(info.count)||0,
          loadedOffset,
          loadedCount:rows.length,
          coldCount:loadedOffset
        };
      }
      safeInfo.engine=ENGINE_VERSION;
      safeInfo.baseGeneration=generation;
      safeInfo.totalRecords=Number(manifest.totalRecords)||0;
      safeInfo.loadedRecords=loadedRecords;
      safeInfo.coldRecords=Math.max(0,safeInfo.totalRecords-loadedRecords);
      safeInfo.collections=nextCollections;
    }
    setStatus({mode:safeInfo?'indexeddb-segmented-safe':'indexeddb-segmented',verified:true,error:'',generation,bytes:manifest.totalBytes,records:manifest.totalRecords,chunks:manifest.totalChunks,durationMs:Date.now()-started,safeMode:Boolean(safeInfo)});
    return {ok:true,manifest,stats:{generation,records:manifest.totalRecords,bytes:manifest.totalBytes,chunks:manifest.totalChunks,reusedChunks,writtenChunks:manifest.totalChunks-reusedChunks,durationMs:Date.now()-started,safeMode:Boolean(safeInfo)}};
  }

  // V5 büyük-yedek akışlı içe aktarma. `readChunk` her çağrıda yalnız tek kaynak
  // parçasını verir; bütün files/races/log dizileri hiçbir zaman aynı anda RAM'e
  // alınmaz. Manifest ancak tüm parçalar, sayımlar ve hashler doğrulandıktan sonra
  // atomik olarak aktif edilir.
  async function importFramedCollectionsWithAdapter(adapter,descriptor,readChunk,options={}){
    if(!adapter||typeof readChunk!=='function')throw new Error('Akışlı içe aktarma adaptörü/okuyucusu eksik.');
    const started=Date.now();
    const currentRaw=await adapter.getManifest(ACTIVE_MANIFEST);
    const current=validManifest(currentRaw)?currentRaw:null;
    const generation=randomGeneration();
    const collections=Array.isArray(descriptor?.collections)?descriptor.collections:[];
    const manifest={
      engine:ENGINE_VERSION,
      schemaVersion:Number(descriptor?.schemaVersion)||0,
      generation,
      createdAt:nowIso(),
      createdAtMs:Date.now(),
      complete:false,
      meta:clonePlain(descriptor?.meta||{}),
      collections:{},
      totalRecords:0,
      totalBytes:0,
      totalChunks:0
    };
    const pending=[];
    const writeBatch=Math.max(1,Number(options.writeBatch)||16);
    let lastYield=Date.now();
    const flush=async()=>{
      if(!pending.length)return;
      const batch=pending.splice(0,pending.length);
      await adapter.putChunks(batch);
      if(Date.now()-lastYield>=DEFAULT_YIELD_MS){lastYield=Date.now();await yieldToUi(true);}
    };
    for(const raw of collections){
      const name=String(raw?.name||'').trim();
      const chunkCount=Math.max(0,Number(raw?.chunks)||0);
      const expectedCount=Math.max(0,Number(raw?.count)||0);
      if(!name)throw new Error('Akışlı yedekte koleksiyon adı eksik.');
      if(chunkCount>10000000)throw new Error(`${name} olağandışı parça sayısı içeriyor.`);
      const refs=[];let offset=0,collectionBytes=0;
      for(let index=0;index<chunkCount;index++){
        const rows=await readChunk(raw,index);
        if(!Array.isArray(rows))throw new Error(`${name} #${index+1} parçası dizi değil.`);
        const serialized=JSON.stringify(rows);
        const bytes=utf8Bytes(serialized),count=rows.length,hash=dualHash(serialized);
        const key=`${name}|${hash}|${count}|${bytes}`;
        pending.push([key,{payload:rows,count,bytes,hash,createdAtMs:Date.now(),engine:ENGINE_VERSION}]);
        refs.push({key,start:offset,count,bytes,hash});
        offset+=count;collectionBytes+=bytes;
        manifest.totalRecords+=count;manifest.totalBytes+=bytes;manifest.totalChunks++;
        if(pending.length>=writeBatch)await flush();
        if(typeof options.onProgress==='function')options.onProgress({phase:'stream-write',collection:name,chunk:index+1,chunks:chunkCount,processed:offset,total:expectedCount,totalRecords:manifest.totalRecords,totalBytes:manifest.totalBytes});
        if(Date.now()-lastYield>=DEFAULT_YIELD_MS){lastYield=Date.now();await yieldToUi(true);}
      }
      if(offset!==expectedCount)throw new Error(`${name} akışlı yedek sayımı uyuşmuyor (${offset}/${expectedCount}).`);
      manifest.collections[name]={count:offset,bytes:collectionBytes,refs};
    }
    await flush();
    manifest.complete=true;
    manifest.manifestHash=await stableManifestHashAsync(manifest);
    await adapter.commitManifest(manifest,current);
    markAdapterVerified(adapter,generation);
    setStatus({mode:'indexeddb-segmented-stream-import',verified:true,error:'',generation,bytes:manifest.totalBytes,records:manifest.totalRecords,chunks:manifest.totalChunks,durationMs:Date.now()-started,safeMode:false});
    return {ok:true,manifest,stats:{generation,records:manifest.totalRecords,bytes:manifest.totalBytes,chunks:manifest.totalChunks,durationMs:Date.now()-started,streamed:true}};
  }

  async function loadManifestWithAdapter(adapter,manifest,options={}){
    if(!structurallyValidManifest(manifest)) throw new Error('Manifest yapısı doğrulanamadı.');
    // V1.1.300: Eski sağlam manifest farklı sürümün manifest-hash algoritmasıyla
    // yazılmış olabilir. Hash uyuşmazlığında reddetmek yerine TÜM chunk hashlerini
    // zorunlu doğrula; tek parça bile bozuksa yine fail-closed kalır.
    if(!manifestHashValid(manifest)) options={...options,verifyHashes:true};
    const out=clonePlain(manifest.meta||{});
    let loadedRecords=0;
    let lastYield=monotonicNow();
    for(const [name,info] of Object.entries(manifest.collections||{})){
      const refs=Array.isArray(info.refs)?info.refs:[];
      const values=[];
      let processedRefs=0;
      for(const batch of boundedRefBatches(refs,options)){
        const rows=await adapter.getChunks(batch.map(r=>r.key));
        for(let i=0;i<rows.length;i++){
          const row=rows[i];
          const ref=batch[i];
          if(!row || !Array.isArray(row.payload)) throw new Error(`${name} koleksiyonunda eksik parça: ${ref.key}`);
          if(Number(row.count)!==Number(ref.count) || row.payload.length!==Number(ref.count)) throw new Error(`${name} parça sayımı bozuk: ${ref.key}`);
          if(options.verifyHashes===true){
            const serialized=JSON.stringify(row.payload);
            if(dualHash(serialized)!==ref.hash) throw new Error(`${name} parça hash doğrulaması başarısız: ${ref.key}`);
          }
          values.push(...row.payload);
          loadedRecords+=row.payload.length;
        }
        processedRefs+=batch.length;
        if(typeof options.onProgress==='function') options.onProgress({phase:'read',collection:name,processed:processedRefs,total:refs.length,loadedRecords});
        lastYield=await yieldReadIfDue(lastYield,options);
      }
      if(values.length!==Number(info.count)) throw new Error(`${name} koleksiyon sayımı uyuşmuyor (${values.length}/${info.count}).`);
      out[name]=values;
    }
    return out;
  }

  function boundedRefBatches(refs,options={}){
    const source=Array.isArray(refs)?refs:[];
    const maxRefs=Math.max(1,Number(options.readBatchMaxRefs)||DEFAULT_READ_BATCH);
    const maxBytes=Math.max(256*1024,Number(options.readBatchMaxBytes)||DEFAULT_READ_BATCH_BYTES);
    const batches=[];
    let batch=[],bytes=0;
    for(const ref of source){
      const refBytes=Math.max(1,Number(ref?.bytes)||DEFAULT_TARGET_BYTES);
      if(batch.length&&(batch.length>=maxRefs||bytes+refBytes>maxBytes)){
        batches.push(batch);batch=[];bytes=0;
      }
      batch.push(ref);bytes+=refBytes;
    }
    if(batch.length)batches.push(batch);
    return batches;
  }


  function alignedTailOffset(info,desiredOffset){
    const total=Math.max(0,Number(info?.count)||0);
    const desired=Math.max(0,Math.min(total,Number(desiredOffset)||0));
    if(desired<=0||desired>=total)return desired;
    const ref=(info.refs||[]).find(row=>Number(row.start)+Number(row.count)>desired);
    return ref?Math.max(0,Number(ref.start)||0):desired;
  }

  function materializationCaps(manifest,maxRecords,customCaps={}){
    const infos=manifest.collections||{};
    const names=Object.keys(infos);
    const priority=['files','races','auto_coupon_log','bets','prediction_log','forward_tracking_log','weekly_model_log','changelog',...names.filter(n=>!['races','files','prediction_log','forward_tracking_log','weekly_model_log','auto_coupon_log','bets','changelog'].includes(n))];
    const unique=[...new Set(priority)].filter(n=>infos[n]);
    const weights={prediction_log:.36,forward_tracking_log:.20,weekly_model_log:.16,changelog:.04};
    const caps={};
    const budget=Math.max(1,Number(maxRecords)||DEFAULT_MAX_MATERIALIZED_RECORDS);

    // Eski kural files+races koleksiyonlarını "her zaman tamamı sıcak" tutuyordu.
    // 10 milyonluk arşivde bu, safe-mode'a rağmen bütün belleği/indekslemeyi geri
    // çağırdığı için donmaya yol açıyordu. Yeni kural her koleksiyonu aynı kesin
    // kayıt bütçesi içinde tutar; soğuk kısım manifestte korunur ve sayfalı API ile
    // okunur. Küçük arşiv safe-mode'a hiç girmediğinden 509 toplantılık paket tamdır.
    const core={
      files:{share:.075,min:80},
      races:{share:.56,min:600},
      auto_coupon_log:{share:.08,min:40},
      bets:{share:.04,min:20}
    };
    let mandatory=0;
    const explicitNames=new Set();
    for(const name of unique){
      const total=Math.max(0,Number(infos[name]?.count)||0);
      const explicit=Number(customCaps?.[name]);
      if(Number.isFinite(explicit)&&explicit>=0){
        caps[name]=Math.min(total,Math.floor(explicit));
        explicitNames.add(name);
      }else if(core[name]){
        const target=Math.max(core[name].min,Math.floor(budget*core[name].share));
        caps[name]=Math.min(total,target);
      }else caps[name]=0;
      mandatory+=caps[name];
    }
    // Özel bir çağrı bütçeden büyük istese bile safe-mode sınırı delinmez.
    if(mandatory>budget){
      const scale=budget/mandatory;
      mandatory=0;
      for(const name of unique){
        const current=Math.max(0,Number(caps[name])||0);
        caps[name]=Math.min(Math.max(0,Number(infos[name]?.count)||0),Math.floor(current*scale));
        mandatory+=caps[name];
      }
      // Yuvarlama ile boşa çıkan küçük alanı, önce koşu sonra dosya çekirdeğine ver.
      let spare=Math.max(0,budget-mandatory);
      for(const name of ['races','files','auto_coupon_log','bets']){
        if(!spare||!infos[name])continue;
        const total=Math.max(0,Number(infos[name]?.count)||0);
        const add=Math.min(spare,Math.max(0,total-(caps[name]||0)));
        caps[name]=(caps[name]||0)+add;mandatory+=add;spare-=add;
      }
    }
    const remaining=Math.max(0,budget-mandatory);
    const weighted=unique.filter(name=>!core[name]&&!explicitNames.has(name));
    const weightTotal=weighted.reduce((sum,name)=>sum+(weights[name]??.06),0)||1;
    for(const name of weighted){
      const total=Math.max(0,Number(infos[name]?.count)||0);
      const desired=Math.floor(remaining*((weights[name]??.06)/weightTotal));
      caps[name]=Math.min(total,desired);
    }
    let used=weighted.reduce((sum,name)=>sum+(caps[name]||0),0);
    let spare=Math.max(0,remaining-used);
    for(const name of weighted){
      if(spare<=0)break;
      const total=Math.max(0,Number(infos[name]?.count)||0);
      const add=Math.min(spare,Math.max(0,total-(caps[name]||0)));
      caps[name]=(caps[name]||0)+add;spare-=add;
    }
    return caps;
  }

  async function loadRangeFromManifest(adapter,manifest,name,offset,limit,options={}){
    const info=manifest.collections?.[name];
    if(!info) return {rows:[],offset:0,limit,total:0,hasMore:false,manifest};
    const from=Math.max(0,Number(offset)||0);
    const size=Math.max(0,Number(limit)||0);
    const to=Math.min(Number(info.count)||0,from+size);
    if(to<=from) return {rows:[],offset:from,limit:size,total:Number(info.count)||0,hasMore:false,manifest};
    const refs=(info.refs||[]).filter(ref=>Number(ref.start)+Number(ref.count)>from && Number(ref.start)<to);
    const rows=[];
    let lastYield=monotonicNow();
    for(const batch of boundedRefBatches(refs,options)){
      const chunks=await adapter.getChunks(batch.map(r=>r.key));
      for(let i=0;i<batch.length;i++){
        const ref=batch[i];
        const row=chunks[i];
        const payload=row?.payload;
        if(!Array.isArray(payload)) throw new Error(`${name} koleksiyonunda eksik parça: ${ref.key}`);
        if(Number(row.count)!==Number(ref.count) || payload.length!==Number(ref.count) || String(row.hash||'')!==String(ref.hash||'')){
          throw new Error(`${name} koleksiyonunda parça bütünlüğü bozuk: ${ref.key}`);
        }
        const localFrom=Math.max(0,from-Number(ref.start));
        const localTo=Math.min(payload.length,to-Number(ref.start));
        rows.push(...payload.slice(localFrom,localTo));
      }
      lastYield=await yieldReadIfDue(lastYield,options);
    }
    return {rows,offset:from,limit:size,total:Number(info.count)||0,hasMore:to<(Number(info.count)||0),manifest};
  }

  async function loadManifestHotWindowWithAdapter(adapter,manifest,options={}){
    if(!structurallyValidManifest(manifest)) throw new Error('Manifest yapısı doğrulanamadı.');
    const configuredMaxRecords=Math.max(1000,Number(options.maxMaterializedRecords)||DEFAULT_MAX_MATERIALIZED_RECORDS);
    // Kayıt sayısı tek başına RAM güvenliği değildir: bir milyon küçük sayaç ile
    // bir milyon tam at/yarış nesnesinin boyutu aynı olmaz. Manifest zaten gerçek
    // serileştirilmiş byte toplamını taşıyor; büyük arşivlerde sıcak pencere hem
    // kayıt hem byte tavanının küçük olanına göre seçilir.
    const maxMaterializedBytes=Math.max(8*1024*1024,Number(options.maxMaterializedBytes)||128*1024*1024);
    const totalRecords=Math.max(1,Number(manifest.totalRecords)||1);
    const averageBytes=Math.max(1,(Number(manifest.totalBytes)||totalRecords)/totalRecords);
    // Byte limiti kayıt sayısı tabanından önceliklidir: çok büyük nesnelerde
    // "en az 1000" demek 64 MB tavanını sessizce aşabilirdi.
    const byteBoundRecords=Math.max(1,Math.floor(maxMaterializedBytes/averageBytes));
    const maxRecords=Math.max(1,Math.min(configuredMaxRecords,byteBoundRecords));
    const caps=materializationCaps(manifest,maxRecords,options.collectionCaps||{});
    const out=clonePlain(manifest.meta||{});
    const storageCollections={};
    let loadedRecords=0;
    let lastYield=monotonicNow();
    for(const [name,info] of Object.entries(manifest.collections||{})){
      const total=Math.max(0,Number(info.count)||0);
      const desiredCount=Math.max(0,Math.min(total,Number(caps[name])||0));
      const desiredOffset=total-desiredCount;
      const loadedOffset=alignedTailOffset(info,desiredOffset);
      const actualCount=total-loadedOffset;
      const page=await loadRangeFromManifest(adapter,manifest,name,loadedOffset,actualCount,options);
      out[name]=page.rows;
      loadedRecords+=page.rows.length;
      storageCollections[name]={total,loadedOffset,loadedCount:page.rows.length,coldCount:loadedOffset};
      if(typeof options.onProgress==='function') options.onProgress({phase:'safe-read',collection:name,loaded:page.rows.length,total,loadedRecords,maxRecords});
      lastYield=await yieldReadIfDue(lastYield,options);
    }
    out.__segmented_storage={
      safeMode:true,
      engine:ENGINE_VERSION,
      baseGeneration:manifest.generation,
      totalRecords:Number(manifest.totalRecords)||0,
      loadedRecords,
      coldRecords:Math.max(0,(Number(manifest.totalRecords)||0)-loadedRecords),
      maxMaterializedRecords:maxRecords,
      configuredMaxMaterializedRecords:configuredMaxRecords,
      maxMaterializedBytes,
      estimatedAverageRecordBytes:Math.round(averageBytes),
      collections:storageCollections,
      pagedApi:'tkpLoadPersistedCollectionPage'
    };
    return out;
  }

  async function loadSnapshotWithAdapter(adapter,options={}){
    const started=Date.now();
    let manifest=await adapter.getManifest(ACTIVE_MANIFEST);
    let recovered=false;
    // KÖK FIX (donma tanısından bağımsız UI hatası): Aktif VE önceki manifest hiç
    // yoksa bu ilk kurulum/boş IndexedDB demektir -- bozuk kayıt değildir. Eskiden
    // bu durum doğrudan structurallyValidManifest hatasına düşüyordu; state.js
    // katmanı bu mesajı _persistLastError için bastırsa da, TKPSegmentedIDB'nin
    // KENDİ status()'u (setStatus ile) ham hatayı taşımaya devam ediyordu ve
    // persistenceStatus() buna geri düşüyordu (_persistLastError||segmented?.error).
    // Sonuç: HER ilk kurulumda "Kalıcı kayıt doğrulanamadı / Manifest yapısı
    // doğrulanamadı" kırmızı uyarısı, hiçbir gerçek hata yokken gösteriliyordu.
    // Artık gerçekten boş depo ayrı, tanınabilir bir durumla işaretlenir.
    if(!manifest){
      const previousCheck=await adapter.getManifest(PREVIOUS_MANIFEST);
      if(!previousCheck){
        setStatus({mode:'indexeddb-segmented-empty',verified:false,error:'',generation:'',bytes:0,records:0,chunks:0,durationMs:Date.now()-started,safeMode:false});
        const emptyError=new Error('Henüz kayıtlı manifest yok (ilk kurulum).');
        emptyError.tkpEmptyStore=true;
        throw emptyError;
      }
    }
    try{
      const safeLimit=Math.max(0,Number(options.maxMaterializedRecords)||0);
      const safeByteLimit=Math.max(0,Number(options.maxMaterializedBytes)||0);
      const safeMode=(safeLimit>0 && Number(manifest?.totalRecords||0)>safeLimit)||(safeByteLimit>0&&Number(manifest?.totalBytes||0)>safeByteLimit);
      const db=safeMode?await loadManifestHotWindowWithAdapter(adapter,manifest,options):await loadManifestWithAdapter(adapter,manifest,options);
      markAdapterVerified(adapter,manifest.generation);
      setStatus({mode:safeMode?'indexeddb-segmented-safe':'indexeddb-segmented',verified:true,error:'',generation:manifest.generation,bytes:manifest.totalBytes,records:manifest.totalRecords,chunks:manifest.totalChunks,durationMs:Date.now()-started,safeMode});
      return {ok:true,db,manifest,recovered};
    }catch(activeError){
      const previous=await adapter.getManifest(PREVIOUS_MANIFEST);
      if(!previous) throw activeError;
      const safeLimit=Math.max(0,Number(options.maxMaterializedRecords)||0);
      const safeByteLimit=Math.max(0,Number(options.maxMaterializedBytes)||0);
      const safeMode=(safeLimit>0 && Number(previous?.totalRecords||0)>safeLimit)||(safeByteLimit>0&&Number(previous?.totalBytes||0)>safeByteLimit);
      const db=safeMode?await loadManifestHotWindowWithAdapter(adapter,previous,options):await loadManifestWithAdapter(adapter,previous,options);
      recovered=true;
      // Bozuk aktif manifesti yerinde bırakmak bir sonraki kayıtta eksik chunk'ın
      // yanlışlıkla yeniden kullanılmasına yol açabilir. Doğrulanmış previous nesil
      // hemen yeniden active yapılır; böylece sonraki yazım temiz tabandan başlar.
      await adapter.commitManifest(previous,null);
      markAdapterVerified(adapter,previous.generation);
      setStatus({mode:safeMode?'indexeddb-segmented-safe-recovered':'indexeddb-segmented-recovered',verified:true,error:String(activeError?.message||activeError),generation:previous.generation,bytes:previous.totalBytes,records:previous.totalRecords,chunks:previous.totalChunks,durationMs:Date.now()-started,safeMode});
      return {ok:true,db,manifest:previous,recovered,activeError:String(activeError?.message||activeError)};
    }
  }

  async function loadCollectionPageWithAdapter(adapter,name,{offset=0,limit=1000,manifestKey=ACTIVE_MANIFEST}={}){
    const manifest=await adapter.getManifest(manifestKey);
    if(!validManifest(manifest)) throw new Error('Sayfalı okuma için geçerli manifest yok.');
    return loadRangeFromManifest(adapter,manifest,name,offset,limit);
  }

  async function checkpointWithAdapter(adapter,label='manual'){
    const active=await adapter.getManifest(ACTIVE_MANIFEST);
    if(!await validManifestAsync(active)) return false;
    const key=`checkpoint:${String(label).replace(/[^a-z0-9_-]+/gi,'_').slice(0,64)}:${Date.now()}`;
    await adapter.putManifest(key,{...active,checkpointLabel:String(label),checkpointAt:nowIso()});
    return key;
  }

  // V1.1.282 FINAL HARDENING — gerçek checkpoint rollback.
  // Checkpoint yalnız bir etiket değil: manifest doğrulanır, tüm referans chunk'lar
  // okunarak bütünlük testinden geçer ve ancak ondan sonra active manifest atomik
  // olarak geri çevrilir. Böylece yarım collector/import işlemi kalıcı state'i
  // kirletemez.
  async function restoreCheckpointWithAdapter(adapter,key,options={}){
    key=String(key||'');
    if(!key.startsWith('checkpoint:')) throw new Error('Geçersiz checkpoint anahtarı.');
    const manifest=await adapter.getManifest(key);
    if(!validManifest(manifest)) throw new Error('Checkpoint manifesti geçersiz veya bulunamadı.');
    const db=await loadManifestWithAdapter(adapter,manifest,options);
    const current=await adapter.getManifest(ACTIVE_MANIFEST);
    await adapter.commitManifest(manifest,validManifest(current)?current:null);
    markAdapterVerified(adapter,manifest.generation);
    setStatus({mode:'indexeddb-segmented-rollback',verified:true,error:'',generation:manifest.generation,bytes:manifest.totalBytes,records:manifest.totalRecords,chunks:manifest.totalChunks,durationMs:0,safeMode:false});
    return {ok:true,db,manifest,key};
  }

  async function gcWithAdapter(adapter,options={}){
    let manifests=await adapter.listManifests();
    // Yalnız kota kurtarmada aktif ve doğrulanmış manifest tutulur. Önceki
    // manifest/checkpoint'ler ile yarım kalmış yazımların yetim parçaları hemen
    // temizlenir; normal GC 24 saatlik geri alma güvencesini aynen korur.
    if(options.dropPrevious===true&&typeof adapter.deleteManifestsExcept==='function'){
      const active=manifests.find(([key,manifest])=>String(key)===ACTIVE_MANIFEST&&validManifest(manifest));
      if(active){await adapter.deleteManifestsExcept(new Set([ACTIVE_MANIFEST]));manifests=[active];}
    }
    const keep=new Set();
    for(const [,manifest] of manifests){
      if(!validManifest(manifest))continue;
      for(const info of Object.values(manifest.collections||{})) for(const ref of info.refs||[]) keep.add(String(ref.key));
    }
    const minCreatedAt=options.force===true?Number.POSITIVE_INFINITY:Date.now()-Math.max(GC_MIN_AGE_MS,Number(options.minAgeMs)||0);
    await adapter.deleteOldChunks(keep,minCreatedAt);
    return {ok:true,kept:keep.size,emergency:Boolean(options.force||options.dropPrevious)};
  }

  function serializeOperation(task){
    const run=_operationChain.then(task,task);
    _operationChain=run.catch(()=>{});
    return run;
  }
  function withBrowserLock(name,task,{lockTimeoutMs=15000}={}){
    if(typeof navigator!=='undefined' && navigator.locks?.request){setStatus({phase:'lock-request',lock:name});
      // The write deadline starts only AFTER acquiring the Web Lock. Bound the
      // separate wait too, and cancel it so it cannot write after reporting failure.
      const controller=typeof AbortController==='function'?new AbortController():null;
      let expired=false,acquired=false,timer;
      return new Promise((resolve,reject)=>{
        timer=setTimeout(()=>{
          if(acquired)return;
          expired=true;
          reject(new Error('Kayıt kilidi başka bir TKP sekmesinde kaldı; bekleme süre sınırında durduruldu. Veriler kaydedilmedi.'));
          controller?.abort();
        },Math.max(1,Number(lockTimeoutMs)||15000));
        Promise.resolve().then(()=>navigator.locks.request(`tkp:${name}`,{
          mode:'exclusive',...(controller?{signal:controller.signal}:{})
        },()=>{
          if(expired)throw new Error('Süresi dolmuş kayıt kilidi işlemi iptal edildi.');
          acquired=true;clearTimeout(timer);setStatus({phase:"lock-acquired",lock:name});
          return task();
        })).then(resolve,reject).finally(()=>clearTimeout(timer));
      });
    }
    return serializeOperation(task);
  }

  async function saveWithDeadline(adapter,source,options={}){
    let cancelled=false,stage='manifest okuma';
    const ms=Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,deadline=monotonicNow()+ms;
    const assertActive=()=>{if(cancelled||monotonicNow()>=deadline){cancelled=true;adapter.cancelPending?.();throw new Error('Kayıt süre sınırında durduruldu. Aşama: '+stage);}};
    try{return await timeout(saveSnapshotWithAdapter(adapter,source,{...options,assertActive,onProgress(info){
      stage=info.collection+' '+info.processed+'/'+info.total;
      setStatus({mode:'saving',verified:false,progress:{...info}});
      if(typeof options.onProgress==='function')options.onProgress(info);
    }}),ms,'Parçalı IndexedDB yazımı',()=>{cancelled=true;adapter.cancelPending?.();});}
    catch(error){const detailed=new Error(String(error?.message||error)+' Aşama: '+stage);detailed.name=error?.name||'Error';throw detailed;}
  }
  async function saveDb(source,options={}){
    setStatus({mode:'saving',verified:false,error:''});
    const adapter=browserAdapter();
    const run=()=>withBrowserLock('segmented-save',async()=>{
      const scoped=createBrowserAdapter();markAdapterVerified(scoped,adapterVerifiedGeneration(adapter));
      const result=await saveWithDeadline(scoped,source,options);
      markAdapterVerified(adapter,result.manifest.generation);return result;
    },options);
    try{
      return await run();
    }catch(error){
      const quota=/QuotaExceededError|quota/i.test(String(error?.name||'')+' '+String(error?.message||error||''));
      if(quota&&options.quotaRecovery!==false){
        setStatus({mode:'quota-recovery',verified:false,error:String(error?.message||error)});
        await withBrowserLock('segmented-gc',()=>gcWithAdapter(adapter,{dropPrevious:true,force:true}));
        try{return await run();}catch(retryError){error=retryError;}
      }
      setStatus({mode:'error',verified:false,error:String(error?.message||error)});
      throw error;
    }
  }
  async function importFramedCollections(descriptor,readChunk,options={}){
    setStatus({mode:'stream-import',verified:false,error:''});
    const adapter=browserAdapter();
    try{
      return await withBrowserLock('segmented-save',()=>timeout(importFramedCollectionsWithAdapter(adapter,descriptor,readChunk,options),Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,'Akışlı IndexedDB içe aktarma'));
    }catch(error){
      setStatus({mode:'error',verified:false,error:String(error?.message||error)});
      throw error;
    }
  }
  async function loadDb(options={}){
    setStatus({mode:'loading',verified:false,error:''});
    try{
      return await withBrowserLock('segmented-load',()=>timeout(loadSnapshotWithAdapter(browserAdapter(),options),Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,'Parçalı IndexedDB okuması'));
    }catch(error){
      // KÖK FIX: gerçekten boş depo (ilk kurulum) 'error' değil 'empty' olarak
      // işaretlenir -- bkz. loadSnapshotWithAdapter üzerindeki not. Gerçek bozulma
      // durumlarında (manifest var ama geçersiz/hash uyuşmuyor/parça eksik) davranış
      // değişmedi: error metni aynen taşınır.
      if(error&&error.tkpEmptyStore===true){
        setStatus({mode:'indexeddb-segmented-empty',verified:false,error:''});
      }else{
        setStatus({mode:'error',verified:false,error:String(error?.message||error)});
      }
      throw error;
    }
  }

  function mergeMetaPatch(base,patch){
    const out=(base&&typeof base==='object'&&!Array.isArray(base))?clonePlain(base):{};
    for(const [key,value] of Object.entries(patch||{})){
      if(value&&typeof value==='object'&&!Array.isArray(value)) out[key]=mergeMetaPatch(out[key],value);
      else out[key]=clonePlain(value);
    }
    return out;
  }
  async function mergeMetaPatchAsync(base,patch){
    const out=base&&typeof base==='object'&&!Array.isArray(base)?base:{};
    for(const [key,value] of Object.entries(patch||{})){
      if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.prototype.hasOwnProperty.call(out,key)&&out[key]&&typeof out[key]==='object'&&!Array.isArray(out[key]))out[key]=await mergeMetaPatchAsync(out[key],value);
      else Object.defineProperty(out,key,{value:await clonePlainAsync(value),writable:true,enumerable:true,configurable:true});
    }
    return out;
  }

  async function updateMetaPatchWithAdapter(adapter,patch,options={}){
    if(!adapter)throw new Error('Depolama adaptörü yok.');
    const active=await adapter.getManifest(ACTIVE_MANIFEST);
    if(!await validManifestAsync(active))throw new Error('Metadata güncellemesi için geçerli aktif manifest yok.');
    const expected=String(options.expectedGeneration||'');
    if(expected&&expected!==String(active.generation||''))throw new Error('Aktif veri nesli değişti; eski oturum metadata cache yazımı iptal edildi.');
    const next=await clonePlainAsync(active);
    next.meta=await mergeMetaPatchAsync(next.meta||{},patch||{});
    next.manifestHash=await stableManifestHashAsync(next);
    await adapter.putManifest(ACTIVE_MANIFEST,next);
    markAdapterVerified(adapter,next.generation);
    setStatus({mode:'indexeddb-segmented-meta',verified:true,error:'',generation:next.generation,bytes:next.totalBytes,records:next.totalRecords,chunks:next.totalChunks,safeMode:false});
    return {ok:true,manifest:await clonePlainAsync(next),stats:{generation:next.generation,metaBytes:utf8Bytes(await stringifyAsync(patch||{}))}};
  }
  async function updateMetaPatch(patch,options={}){
    return withBrowserLock('segmented-save',()=>timeout(updateMetaPatchWithAdapter(browserAdapter(),patch,options),Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,'Parçalı IndexedDB metadata yazımı'));
  }

  // Büyük arşivde bir kupon veya tek toplantının tahmin kilitleri değiştiğinde bütün
  // koleksiyonları yeniden JSON'a çevirmek ana ekranı saniyelerce durduruyordu. Bu yol
  // yalnız adı açıkça verilen koleksiyonları yeniden parçalar; diğer koleksiyonların
  // doğrulanmış chunk referanslarını atomik yeni manifeste aynen taşır.
  async function updateCollectionsWithAdapter(adapter,source,names,options={}){
    if(!adapter)throw new Error('Depolama adaptörü yok.');
    const started=Date.now();
    const active=await adapter.getManifest(ACTIVE_MANIFEST);
    if(!await validManifestAsync(active))throw new Error('Kısmi koleksiyon yazımı için geçerli aktif manifest yok.');
    const expected=String(options.expectedGeneration||'');
    if(expected&&expected!==String(active.generation||''))throw new Error('Aktif veri nesli değişti; eski oturumun kısmi yazımı iptal edildi.');
    const verified=adapterVerifiedGeneration(adapter);
    if(verified&&verified!==String(active.generation||''))throw new Error('Aktif veri nesli başka sekmede değişti; sayfayı yenile.');
    const requested=[...new Set((Array.isArray(names)?names:[]).map(String).filter(Boolean))];
    if(!requested.length)throw new Error('Kısmi yazım için koleksiyon seçilmedi.');
    const safeInfo=source?.__segmented_storage?.safeMode===true?source.__segmented_storage:null;
    for(const name of requested){
      if(!Array.isArray(source?.[name]))throw new Error(`${name} koleksiyonu RAM'de hazır değil.`);
      if(Number(safeInfo?.collections?.[name]?.coldCount)>0)throw new Error(`${name} koleksiyonunun soğuk kısmı yüklü değil; kısmi yazım güvenli değil.`);
    }
    const next=await clonePlainAsync(active);
    next.engine=ENGINE_VERSION;
    next.schemaVersion=Number(source?.schema_version)||Number(active.schemaVersion)||0;
    next.generation=randomGeneration();
    next.createdAt=nowIso();next.createdAtMs=Date.now();next.complete=false;
    if(options.metaPatch)next.meta=await mergeMetaPatchAsync(next.meta||{},options.metaPatch);
    const pending=[];
    const writeBatch=Math.max(1,Number(options.writeBatch)||DEFAULT_WRITE_BATCH);
    let writtenChunks=0,reusedChunks=0,lastYield=Date.now();
    const flush=async()=>{
      if(!pending.length)return;
      const batch=pending.splice(0,pending.length);
      await adapter.putChunks(batch);
      if(Date.now()-lastYield>=DEFAULT_YIELD_MS){lastYield=Date.now();await yieldToUi(true);}
    };
    for(const name of requested){
      const rows=source[name],oldRefs=Array.isArray(active.collections?.[name]?.refs)?active.collections[name].refs:[];
      const refs=[];let bytes=0,start=0,chunkCountHint=0;
      while(start<rows.length){
        const chunk=await makeChunk(name,rows,start,options,chunkCountHint);if(!chunk)break;
        chunkCountHint=chunk.count;
        const index=refs.length;
        if(oldRefs[index]?.key===chunk.key)reusedChunks++;
        else{pending.push([chunk.key,{payload:chunk.payload,count:chunk.count,bytes:chunk.bytes,hash:chunk.hash,createdAtMs:Date.now(),engine:ENGINE_VERSION}]);writtenChunks++;}
        refs.push({key:chunk.key,start:chunk.start,count:chunk.count,bytes:chunk.bytes,hash:chunk.hash});
        start+=chunk.count;bytes+=chunk.bytes;
        if(pending.length>=writeBatch)await flush();
        if(typeof options.onProgress==='function')options.onProgress({phase:'patch-write',collection:name,processed:start,total:rows.length});
        if(Date.now()-lastYield>=DEFAULT_YIELD_MS){lastYield=Date.now();await yieldToUi(true);}
      }
      next.collections[name]={count:rows.length,bytes,refs};
    }
    await flush();
    const infos=Object.values(next.collections||{});
    next.totalRecords=infos.reduce((sum,info)=>sum+(Number(info?.count)||0),0);
    next.totalBytes=infos.reduce((sum,info)=>sum+(Number(info?.bytes)||0),0);
    next.totalChunks=infos.reduce((sum,info)=>sum+(Array.isArray(info?.refs)?info.refs.length:0),0);
    next.complete=true;next.manifestHash=await stableManifestHashAsync(next);
    await adapter.commitManifest(next,active);
    markAdapterVerified(adapter,next.generation);
    if(source?.__segmented_storage)source.__segmented_storage.baseGeneration=next.generation;
    setStatus({mode:'indexeddb-segmented-patch',verified:true,error:'',generation:next.generation,bytes:next.totalBytes,records:next.totalRecords,chunks:next.totalChunks,durationMs:Date.now()-started,safeMode:Boolean(safeInfo)});
    return {ok:true,manifest:await clonePlainAsync(next),stats:{generation:next.generation,records:next.totalRecords,bytes:next.totalBytes,chunks:next.totalChunks,writtenChunks,reusedChunks,durationMs:Date.now()-started,collections:requested}};
  }
  async function updateCollections(source,names,options={}){
    return withBrowserLock('segmented-save',()=>timeout(updateCollectionsWithAdapter(browserAdapter(),source,names,options),Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,'Parçalı IndexedDB kısmi koleksiyon yazımı'));
  }

  async function getActiveManifest(){
    const manifest=await browserAdapter().getManifest(ACTIVE_MANIFEST);
    if(!validManifest(manifest)) throw new Error('Geçerli aktif parçalı IndexedDB manifesti yok.');
    return clonePlain(manifest);
  }
  async function loadCollectionPageFromManifest(manifest,name,options={}){
    if(!validManifest(manifest)) throw new Error('Sayfalı okuma için geçerli manifest yok.');
    const offset=Math.max(0,Number(options.offset)||0);
    const limit=Math.max(0,Number(options.limit)||0);
    return loadRangeFromManifest(browserAdapter(),manifest,name,offset,limit,options);
  }
  async function hasSnapshot(){
    try{return validManifest(await browserAdapter().getManifest(ACTIVE_MANIFEST));}catch(_e){return false;}
  }
  async function createCheckpoint(label){return withBrowserLock('segmented-checkpoint',()=>checkpointWithAdapter(browserAdapter(),label));}
  async function restoreCheckpoint(key,options={}){return withBrowserLock('segmented-rollback',()=>timeout(restoreCheckpointWithAdapter(browserAdapter(),key,options),Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,'Checkpoint geri alma'));}
  async function loadCollectionPage(name,options){return loadCollectionPageWithAdapter(browserAdapter(),name,options);}
  async function gc(options){return withBrowserLock('segmented-gc',()=>gcWithAdapter(browserAdapter(),options));}

  return {
    ENGINE_VERSION,DB_NAME,DB_VERSION,ACTIVE_MANIFEST,PREVIOUS_MANIFEST,
    DEFAULT_MAX_RECORDS,DEFAULT_TARGET_BYTES,DEFAULT_MAX_MATERIALIZED_RECORDS,materializationCaps,
    dualHash,stableManifestHash,validManifest,status,stringifyAsync,dualHashAsync,clonePlainAsync,stableManifestHashAsync,validManifestAsync,
    createBrowserAdapter,createMemoryAdapter,
    saveSnapshotWithAdapter,importFramedCollectionsWithAdapter,loadSnapshotWithAdapter,loadManifestHotWindowWithAdapter,loadCollectionPageWithAdapter,checkpointWithAdapter,restoreCheckpointWithAdapter,gcWithAdapter,updateMetaPatchWithAdapter,updateCollectionsWithAdapter,
    saveDb,saveWithDeadline,importFramedCollections,loadDb,updateMetaPatch,updateCollections,getActiveManifest,loadCollectionPageFromManifest,hasSnapshot,createCheckpoint,restoreCheckpoint,loadCollectionPage,gc
  };
});
