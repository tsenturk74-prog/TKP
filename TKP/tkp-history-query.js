/* Full-archive history queries with a bounded, persistent file metadata join. */
(function(root,factory){
  const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;
  root.TKPHistoryQuery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  let indexPromise=null,queue=Promise.resolve();
  const dbName='tkp_history_file_index_v1'+(root.navigator?.locks?'':'_'+Math.random().toString(36).slice(2));
  const check=signal=>{if(signal?.aborted)throw new Error('Arşiv sorgusu iptal edildi.');};
  async function browserIndex(){
    if(!indexPromise)indexPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(dbName,1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('files',{keyPath:'id'});request.result.createObjectStore('meta');};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Arşiv indeksi başka sekmede kilitli.'));
    }).catch(error=>{indexPromise=null;throw error;});
    const database=await indexPromise;
    function tx(names,mode,enqueue){
      return new Promise((resolve,reject)=>{
        const transaction=database.transaction(names,mode),out=[];
        transaction.oncomplete=()=>resolve(out);transaction.onabort=()=>reject(transaction.error||new Error('Arşiv indeks işlemi iptal edildi.'));
        transaction.onerror=()=>{};
        try{enqueue(transaction,out);}catch(error){transaction.abort();reject(error);}
      });
    }
    return {
      async signature(){return (await tx(['meta'],'readonly',(t,out)=>{t.objectStore('meta').get('signature').onsuccess=e=>out.push(e.target.result);}))[0];},
      async reset(){await tx(['files','meta'],'readwrite',t=>{t.objectStore('files').clear();t.objectStore('meta').clear();});},
      async put(files){await tx(['files'],'readwrite',t=>{const store=t.objectStore('files');for(const f of files)if(f?.id!=null)store.put({id:String(f.id),status:f.status,race_date:f.race_date,hippodrome:f.hippodrome,filename:f.filename,original_filename:f.original_filename});});},
      async finish(signature){await tx(['meta'],'readwrite',t=>t.objectStore('meta').put(signature,'signature'));},
      async getMany(ids){return tx(['files'],'readonly',(t,out)=>{const store=t.objectStore('files');ids.forEach((id,i)=>{store.get(String(id)).onsuccess=e=>{out[i]=e.target.result;};});});}
    };
  }
  async function run(db,consume,options){
    const storage=options.storage||root.TKPSegmentedIDB,signal=options.signal;
    check(signal);
    const hotFiles=new Map((db.files||[]).map(f=>[String(f.id),f]));
    const safe=db.__segmented_storage;
    let manifest,index;
    if(safe?.safeMode){
      manifest=await storage.getActiveManifest();
      if(manifest.generation!==safe.baseGeneration)throw new Error('Arşiv nesli değişti; görünümü yenileyin.');
      index=options.indexStore||await browserIndex();
      const signature=JSON.stringify({v:2,refs:manifest.collections?.files?.refs||[]});
      if(await index.signature()!==signature){
        await index.reset();let processed=0;
        for await(const page of storage.iterateCollectionPages('files',{manifest,limit:1000,signal,verifyHashes:true})){
          check(signal);await index.put(page.rows);processed+=page.rows.length;
          options.onProgress?.({phase:'file-index',processed,total:manifest.collections?.files?.count||0});
        }
        check(signal);await index.finish(signature);
      }
    }
    async function join(rows){
      check(signal);
      const ids=[...new Set(rows.map(r=>String(r?.file_id)).filter(id=>!hotFiles.has(id)))];
      const stored=index?await index.getMany(ids):[];
      const files=new Map(ids.map((id,i)=>[id,stored[i]])),out=[];
      for(const race of rows){
        if(!race)continue;
        const id=String(race.file_id),file=hotFiles.get(id)||files.get(id);
        // Same ACTIVE-file contract as the original in-memory search.
        if(options.activeOnly!==false&&(!file||file.status!=='ACTIVE'))continue;
        out.push({...race,race_date:race.race_date||file?.race_date||'',hippodrome:race.hippodrome||file?.hippodrome||'',...(options.includeFile?{__tkpFile:file||null}:{})});
      }
      return out;
    }
    async function* pages(){
      const cold=Number(safe?.collections?.races?.loadedOffset)||0;
      if(manifest&&cold>0){
        for await(const page of storage.iterateCollectionPages('races',{manifest,endOffset:cold,limit:1000,signal,verifyHashes:true}))yield await join(page.rows);
      }
      const hot=db.races||[];
      for(let i=0;i<hot.length;i+=1000)yield await join(hot.slice(i,i+1000));
    }
    return consume(pages());
  }
  function withHistory(db,consume,options={}){
    const task=async()=>{
      if(root.navigator?.locks)return root.navigator.locks.request('tkp-history-file-index',{mode:'exclusive',...(options.signal?{signal:options.signal}:{})},()=>run(db,consume,options));
      try{return await run(db,consume,options);}
      finally{
        // Without cross-tab locks the isolated index is query-scoped, including
        // failed builds and early iterator returns; never accumulate one per reload.
        if(!options.indexStore&&indexPromise){
          const pending=indexPromise;indexPromise=null;
          const database=await pending.catch(()=>null);
          if(database){database.close();await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(dbName);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Geçici arşiv indeksi temizlenemedi.'));});}
        }
      }
    };
    const result=queue.then(task,task);queue=result.catch(()=>{});return result;
  }
  return {withHistory};
});
