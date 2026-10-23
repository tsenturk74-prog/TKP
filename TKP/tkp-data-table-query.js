/* Bounded full-archive horse table. Each page uses a fresh snapshot; no lock is
 * held while the user reads a page. Raw scores, never rounded labels, sort it. */
(function(root){
 'use strict';
 const num=v=>v==null||String(v).trim()===''?null:(Number.isFinite(Number(String(v).replace(',','.')))?Number(String(v).replace(',','.')):null);
 const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').toLowerCase();
 function compare(a,b){if(a.value===null&&b.value!==null)return 1;if(b.value===null&&a.value!==null)return -1;return (b.value??0)-(a.value??0)||a.serial-b.serial;}
 async function query(db,options={}){
  const limit=Math.min(500,Math.max(1,Number(options.limit)||150)),q=fold(options.query),kept=[];
  let serial=0,totalMatched=0,maxRetained=0,lastYield=performance.now();
  const check=()=>{if(options.signal?.aborted)throw new Error('Tablo sorgusu iptal edildi.');};
  check();
  await root.TKPHistoryQuery.withHistory(db,async pages=>{
   for await(const races of pages){
    for(const race of races)for(const horse of (race.horses||[])){
     check();
     const row=root.tkpHistoricalHorseFeatureVector(race,horse,race.__tkpFile);
     // Orphan file links remain visible for inspection instead of dropping data.
     if(!race.__tkpFile)row.status=row.status||'DOSYA BAĞI EKSİK';
     const key={value:num(row.ypuan),serial:serial++};
     if(!q||fold(Object.values(row).filter(v=>v==null||typeof v!=='object').join(' ')).includes(q)){
      totalMatched++;
      if(!options.after||compare(key,options.after)>0){
       let lo=0,hi=kept.length;while(lo<hi){const mid=(lo+hi)>>>1;if(compare(kept[mid],key)<=0)lo=mid+1;else hi=mid;}
       if(lo<=limit){kept.splice(lo,0,{...key,row});if(kept.length>limit+1)kept.pop();maxRetained=Math.max(maxRetained,kept.length);}
      }
     }
     if(performance.now()-lastYield>=8){options.onProgress?.({phase:'rows',processed:serial,totalMatched});await new Promise(r=>setTimeout(r,0));lastYield=performance.now();}
    }
   }
  },{...options,activeOnly:false,includeFile:true});
  check();const page=kept.slice(0,limit),last=page.at(-1);
  return {rows:page.map(x=>x.row),totalMatched,scanned:serial,hasMore:kept.length>limit,nextCursor:last?{value:last.value,serial:last.serial}:null,maxRetained};
 }
 root.TKPDataTableQuery={query};
})(globalThis);
