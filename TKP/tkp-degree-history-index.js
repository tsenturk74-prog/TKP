/* Exact nearest-distance samples, without retaining a complete history copy per date. */
(function(root){
 'use strict';
 const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x);
 function emptyIndex(options){
  const groups=new Map(),samples=new Map();let order=0,records=0;
  function add(r){
   const date=String(r?.race_date||r?.date||''),distance=Number(r?.distance)||0;if(!validDate(date)||!distance)return;
   const surface=options.fold(r?.surface||''),breed=options.fold(r?.breed||''),keys=new Set([surface+'|'+breed,surface+'|','|'+breed,'|']);
   for(const h of r.horses||[]){
    if(options.isNonRunner(h))continue;
    const direct=Number(h.accurate_avg_speed_mps)>0?Number(h.accurate_avg_speed_mps):null;
    const time=options.bestTime(h)||Number(h.accurate_finish_time_sec||0),speed=direct||(Number.isFinite(time)&&time>20?distance/time:null);
    if(!Number.isFinite(speed)||speed<=0)continue;
    const row={date,speed,order:order++};records++;
    for(const key of keys){let group=groups.get(key);if(!group){group=new Map();groups.set(key,group);}let bucket=group.get(distance);if(!bucket){bucket={rows:[],minDate:date};group.set(distance,bucket);}bucket.rows.push(row);if(date<bucket.minDate)bucket.minDate=date;}
   }
  }
  function priorRows(bucket,date,limit){
   // Skip whole ranges containing only newer records; preserve source order.
   // A late chronological training query must not scan thousands of newer rows.
   if(!bucket.tree){
    let size=1;while(size<bucket.rows.length)size*=2;
    const tree=new Array(size*2).fill('9999-99-99');
    for(let i=0;i<bucket.rows.length;i++)tree[size+i]=bucket.rows[i].date;
    for(let i=size-1;i>0;i--)tree[i]=tree[i*2]<tree[i*2+1]?tree[i*2]:tree[i*2+1];
    bucket.tree=tree;bucket.treeSize=size;
   }
   const out=[],stack=[1],size=bucket.treeSize,tree=bucket.tree;
   while(stack.length&&out.length<limit){const node=stack.pop();if(tree[node]>=date)continue;if(node>=size){out.push(bucket.rows[node-size]);}else{stack.push(node*2+1,node*2);}}
   return out;
  }
  function speeds({surface='',breed='',date='',distance}){
   if(!validDate(date))return [];
   const key=[surface,breed,date,distance].join('|');if(samples.has(key)){const value=samples.get(key);samples.delete(key);samples.set(key,value);return value;}
   const group=groups.get(surface+'|'+breed),picked=[];
   if(group){
    const buckets=Array.from(group,([d,bucket])=>({delta:Math.abs(d-distance),bucket})).filter(x=>x.bucket.minDate<date).sort((a,b)=>a.delta-b.delta);
    for(let i=0;i<buckets.length&&picked.length<80;){
     const delta=buckets[i].delta,peers=[];
     do{peers.push(...priorRows(buckets[i].bucket,date,80));i++;}while(i<buckets.length&&buckets[i].delta===delta);
     peers.sort((a,b)=>a.order-b.order);picked.push(...peers.slice(0,80-picked.length));
    }
   }
   const value=picked.map(x=>x.speed).sort((a,b)=>a-b);samples.set(key,value);while(samples.size>512)samples.delete(samples.keys().next().value);return value;
  }
  return {add,speeds,stats:()=>({records,groups:groups.size,cachedSamples:samples.size,retainedSamples:Array.from(samples.values()).reduce((n,v)=>n+v.length,0)})};
 }
 function create(rows,options){const index=emptyIndex(options);for(const row of rows)index.add(row);return index;}
 async function createAsync(rows,options,pause=()=>new Promise(r=>setTimeout(r,0)),budget=8){const index=emptyIndex(options);let start=performance.now();for(const row of rows){index.add(row);if(performance.now()-start>=budget){await pause();start=performance.now();}}return index;}
 let current=null,pending=null,generation=0;
 function context(){
  const database=typeof db!=='undefined'?db:root.db,revision=typeof _tkpDbRevision==='number'?_tkpDbRevision:0;
  if(!root.__tkpSimilarFieldPoolCache)root.__tkpSimilarFieldPoolCache=new Map();
  return {database,revision,generation,owner:root.__tkpSimilarFieldPoolCache};
 }
 const same=(a,b)=>a&&a.database===b.database&&a.revision===b.revision&&a.generation===b.generation&&a.owner===b.owner;
 const options=()=>({fold:root.fold,isNonRunner:root.isNonRunner,bestTime:root.tkpHorseBestTimeSeconds});
 const rows=()=>typeof root.learningEligibleRaces==='function'?root.learningEligibleRaces():[];
 async function prepare({pause}={}){
  const ctx=context();if(same(current,ctx))return current.index;if(pending&&same(pending,ctx))return pending.promise;
  const request={...ctx};request.promise=createAsync(rows(),options(),pause).then(index=>{if(same(ctx,context()))current={...ctx,index};return index;}).finally(()=>{if(pending===request)pending=null;});pending=request;return request.promise;
 }
 function getSpeeds(query){const ctx=context();if(!same(current,ctx))current={...ctx,index:create(rows(),options())};return current.index.speeds(query);}
 root.TKPDegreeHistory={invalidate:()=>{generation++;current=null;pending=null;},create,createAsync,prepare,getSpeeds,stats:()=>current?.index.stats()||null};
})(globalThis);
