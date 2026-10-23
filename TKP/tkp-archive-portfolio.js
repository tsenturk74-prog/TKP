/* Portfolio statistics are independently cached so coupon writes do not rescan races. */
(function(root){
 'use strict';const n=x=>Number.isFinite(Number(x))?Number(x):0,SOURCE='HISTORICAL_CALIBRATION_FULL';let complete=null,flight=null;
 function accumulator(){
  const coupons=Object.fromEntries([['main','Normal'],['alt','Sürpriz'],['surprise','Uzman + Kulis']].map(([k,label])=>[k,{label,events:0,full:0,legHits:0,knownLegs:0,cost:0,financialCost:0,financialEvents:0,ret:0,singles:0,singleHit:0}])),sidebets={};let snapshotMeetings=0,sidebetTickets=0;
  function add(name,row){if(row?.source!==SOURCE)return;
   if(name==='auto_coupon_log'){
    if(Number(row.historical_calibration)!==1||!row.coupons)return;snapshotMeetings++;
    for(const [key,g] of Object.entries(coupons)){const c=row.coupons[key],e=row.evaluations?.[key];if(!c||c.error||c.legs?.length!==6)continue;g.events++;
     if(e){g.full+=n(e.full);g.legHits+=n(e.hit_legs);g.knownLegs+=n(e.known_legs);g.cost+=n(e.cost);g.singles+=n(e.singles);g.singleHit+=n(e.single_hit);if(Number(e.payout_known)===1&&e.return!=null){g.financialEvents++;g.financialCost+=n(e.cost);g.ret+=n(e.return);}}
    }
   }else if(name==='sidebet_ticket_log'&&Number(row.primary)===1){sidebetTickets++;const key=String(row.product||'').replace('sirali5li','sirali_5li');if(!key)return;if(Object.keys(sidebets).length>=100&&!sidebets[key])throw new Error('Geçersiz yan bahis ürün sayısı');const g=sidebets[key]||(sidebets[key]={events:0,resolved:0,hits:0,cost:0,financialEvents:0,ret:0});g.events++;const e=row.evaluation;if(Number(e?.known)===1){g.resolved++;g.hits+=n(e.hit);if(Number(e.payout_known)===1&&e.return!=null){g.financialEvents++;g.cost+=n(e.cost??row.cost);g.ret+=n(e.return);}}}
  }
  function finalize(){for(const g of Object.values(coupons)){g.fullRate=g.events?g.full/g.events:0;g.legRate=g.knownLegs?g.legHits/g.knownLegs:0;g.singleRate=g.singles?g.singleHit/g.singles:0;g.roi=g.financialEvents&&g.financialCost?(g.ret-g.financialCost)/g.financialCost:null;}for(const g of Object.values(sidebets)){g.hitRate=g.resolved?g.hits/g.resolved:0;g.roi=g.financialEvents&&g.cost?(g.ret-g.cost)/g.cost:null;}return {version:'R19.44_FULL_PORTFOLIO',scope:'FULL_ARCHIVE',snapshotMeetings,sidebetTickets,coupons,sidebets};}
  return {add,finalize};
 }
 function signature(d){return JSON.stringify(['R19.44_PORTFOLIO',d.__segmented_storage?.analyticsLogSignature||d.__segmented_storage?.baseGeneration||'',d.auto_coupon_log?.length||0,d.sidebet_ticket_log?.length||0]);}
 function peek(d){return complete?.db===d&&complete.signature===signature(d)?complete.value:null;}
 async function ensure(d,options={}){const sig=signature(d);if(peek(d))return peek(d);if(flight?.db===d&&flight.sig===sig)return flight.promise;
  const promise=(async()=>{const check=()=>{if(options.signal?.aborted||signature(d)!==sig)throw new Error('Kupon geçmişi değişti; analizi yenileyin.');};const cached=!options.noCache&&root.tkpUiCacheGet?await root.tkpUiCacheGet('tkp_full_portfolio'):null;if(cached?.signature===sig){complete={db:d,signature:sig,value:cached.value};return cached.value;}
   const a=accumulator(),storage=options.storage||root.TKPSegmentedIDB,manifest=d.__segmented_storage?.safeMode?await storage.getActiveManifest():null;let last=performance.now();
   async function add(name,rows){for(const row of rows){a.add(name,row);if(performance.now()-last>=8){await new Promise(r=>setTimeout(r,0));last=performance.now();check();}}}
   for(const name of ['auto_coupon_log','sidebet_ticket_log']){const offset=Number(d.__segmented_storage?.collections?.[name]?.loadedOffset)||0;if(manifest&&offset)for await(const page of storage.iterateCollectionPages(name,{manifest,endOffset:offset,limit:500,verifyHashes:true,signal:options.signal}))await add(name,page.rows);await add(name,d[name]||[]);}check();const value=a.finalize();complete={db:d,signature:sig,value};if(!options.noCache&&root.tkpUiCacheSet)await Promise.resolve(root.tkpUiCacheSet('tkp_full_portfolio',{signature:sig,value})).catch(()=>{});return value;
  })();flight={db:d,sig,promise};try{return await promise;}finally{if(flight?.promise===promise)flight=null;}}
 root.TKPArchivePortfolio={accumulator,signature,peek,ensure};if(typeof module==='object'&&module.exports)module.exports=root.TKPArchivePortfolio;
})(globalThis);
