/* R19.44: shared full-archive sufficient statistics. No race array is retained.
 * Only completed, generation-consistent results may reach a report. */
(function(root,factory){const api=factory(root);root.TKPArchiveAnalytics=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(root){
 'use strict';
 const VERSION='R19.44_FULL_ARCHIVE_ANALYTICS_V2_BMB_DENOMINATOR';
 const dimensions=['surface','breed','hippodrome','condition_family','distance_group'];
 const numeric=v=>(typeof v!=='number'&&typeof v!=='string')||String(v).trim()===''?null:(Number.isFinite(Number(String(v).replace(',','.')))?Number(String(v).replace(',','.')):null);
 const rank=v=>{const n=numeric(v);return Number.isInteger(n)&&n>0?n:null;};
 const present=v=>v!=null&&String(v).trim()!=='';
 const finish=h=>{for(const v of [h?.finish_position,h?.result_position,h?.official_position,h?.place])if(rank(v)!==null)return rank(v);return Number(h?.winner)===1?1:0;};
 const winner=h=>finish(h)===1;
 const signal=()=>({total:0,p1:0,p2:0,p3:0,p4:0,p5:0});
 const rankGroup=()=>({'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,alt1:0,alt2:0,alt3:0,alt4:0,yok:0,total:0,races:0,ties:0});
 const category=()=>({races:0,resultRaces:0,agfRaces:0,resultRankRaces:0,horses:0,valueRaces:0,agf1:0,result1:0,bmbWin:0,bmbRaces:0});
 const bucket=(map,key,make)=>{if(!map.has(key))map.set(key,make());return map.get(key);};
 const names=['VALUE yok','<60','60-69','70-79','80-89','90-99','≥100'];
 const lanes=['1-3 (iç)','4-6','7-9','10-12','13+ (dış)','Kulvar yok'];
 const accurateFields=['accurate_avg_speed_mps','accurate_max_speed_mps','accurate_closing_speed_mps','accurate_tempo_signal','accurate_finish_signal'];
 const mark=(s,h)=>{s.total++;const p=finish(h);if(p>=1&&p<=5)s['p'+p]++;};
 function markRank(g,winners,field){g.races++;if(winners.length>1)g.ties++;for(const h of winners){g.total++;const k=rank(h[field]);g[k===null?'yok':k<=7?String(k):k===8?'alt1':k===9?'alt2':k===10?'alt3':'alt4']++;}}
 function wilson(ok,total){if(!total)return 0;const z=1.96,p=ok/total;return (p+z*z/(2*total)-z*Math.sqrt((p*(1-p)+z*z/(4*total))/total))/(1+z*z/total);}
 function finishSignals(s){s.rate=s.total?s.p1/s.total:0;s.top4Rate=s.total?(s.p1+s.p2+s.p3+s.p4)/s.total:0;s.top5Rate=s.total?(s.p1+s.p2+s.p3+s.p4+s.p5)/s.total:0;s.lb=wilson(s.p1,s.total);}
 function createAccumulator(deps={}){
  const cats=new Map(dimensions.map(k=>[k,new Map()])),ranks={agf_rank:new Map(),result_rank:new Map()},hippos=new Map(),conditionDays=new Map(),authors=new Map();
  const totals={files:0,quarantine:0,races:0,totalRaces:0,horses:0,winners:0,valueRaces:0,coverage:{race:{surface:0,breed:0,condition:0,date:0},horse:{total:0,value:0,hndkp:0,tr:0,sp:0,result:0}}};
  const sig={bmb:{...signal(),label:'Gerçek BMB (VALUE=BMB)'},r1:{...signal(),label:'SONUÇ 1. sıra'},r26:{...signal(),label:'SONUÇ 2–6. sıra'},agf1:{...signal(),label:'AGF 1. sıra (favori)'},agf26:{...signal(),label:'AGF 2–6. sıra'},extra:{...signal(),label:'ODB (ODS dışı bomba)'},g8001:{...signal(),label:'800G 1. sıra'}};
  const valueBands=names.map(name=>({name,cand:0,win:0,single:0,sw:0})),laneBands=lanes.map(name=>({name,cand:0,win:0}));
  const accurate={withData:0,known:0,fields:Object.fromEntries(accurateFields.map(f=>[f,{above:0,aboveWin:0,below:0,belowWin:0}]))};
  const xGroups=[-1,0,1].map(direction=>({direction,count:0,known:0,wins:0,scoreSum:0,scoreCount:0,deltaSum:0,deltaCount:0}));
  const coverage={files:0,races:0,horses:0,verifiedRaces:0,quarantinedRaces:0,raceSurface:0,raceBreed:0,raceCondition:0,raceDistance:0,raceDate:0,incompleteRaces:0,missingByField:Object.create(null),incompleteRaceSamples:[],frozenSnapshotRaces:0,forwardTrackingRows:0};
  for(const k of ['agf','hndkp','kg','bestTime','tr','glp','jbyg','ypuan','accurate','priorAccurate','predictionSnapshot','bmb','odb','xKulis','expertCommentRows','gpr','sp','value','sValue','startNo','resultHorseRows'])coverage[k]=0;
  const observed=Object.create(null);let archivedComments=0,archivedVerified=0,groupCount=0,conditionDayCount=0,observedCount=0;
  function addFile(file){coverage.files++;if(file?.status==='ACTIVE')totals.files++;else totals.quarantine++;}
  function addRace(r){
   totals.totalRaces++;coverage.races++;
   const all=(r.horses||[]).filter(Boolean),live=all.filter(h=>!(deps.isNonRunner?.(h))),wins=live.filter(winner),eligible=wins.length>0;
   const verified=deps.verified?deps.verified(r):String(r.result_integrity_status)==='VERIFIED';
   const missing=new Set();const flag=k=>{missing.add(k);coverage.missingByField[k]=(coverage.missingByField[k]||0)+1;};
   if(verified)coverage.verifiedRaces++;else if(present(r.result_integrity_status))coverage.quarantinedRaces++;
   for(const [field,key,label] of [['surface','raceSurface','surface'],['breed','raceBreed','breed'],['condition_text','raceCondition','condition'],['distance','raceDistance','distance']]){if(present(r[field]))coverage[key]++;else flag(label);}
   if(present(r.race_date))coverage.raceDate++;
   const hasValue=live.some(h=>numeric(h.value_score)>0),bs=live.filter(h=>Number(h.bmb)===1);
   for(const dim of dimensions){const key=String(r[dim]||'BİLİNMİYOR'),map=cats.get(dim);if(!map.has(key))groupCount++;const g=bucket(map,key,category);g.races++;g.horses+=live.length;if(hasValue)g.valueRaces++;
    if(eligible){g.resultRaces++;if(live.some(h=>rank(h.agf_rank)===1))g.agfRaces++;if(live.some(h=>rank(h.result_rank)===1))g.resultRankRaces++;if(wins.some(h=>rank(h.agf_rank)===1))g.agf1++;if(wins.some(h=>rank(h.result_rank)===1))g.result1++;if(bs.length){g.bmbRaces++;if(bs.some(winner))g.bmbWin++;}}
   }
   if(groupCount>100000)throw new Error('Analiz boyutlarında 100.000 farklı grup var; bozuk kategori değerlerini kontrol edin. Eksik toplam yayımlanmadı.');
   const bandCounts=names.map(()=>({n:0,w:0}));
   for(const h of all){
    totals.horses++;coverage.horses++;
    const v=deps.vector?deps.vector(r,h,r.__tkpFile):{agf:numeric(h.agf),hndkp:numeric(h.hndkp),kg:numeric(h.weight_kg),best_time:h.best_time,tr:numeric(h.tr_ganyan),glp:numeric(h.g800),jbyg:numeric(h.jbyg),ypuan:numeric(h.ypuan),start_no:numeric(h.start_no),sp:numeric(h.sp),value:numeric(h.value_score),s_value:numeric(h.s_value)};
    for(const [k,f] of [['agf','agf'],['hndkp','hndkp'],['kg','kg'],['bestTime','best_time'],['tr','tr'],['glp','glp'],['jbyg','jbyg'],['ypuan','ypuan'],['sp','sp'],['value','value'],['sValue','s_value'],['startNo','start_no']])if(present(v[f]))coverage[k]++;
    if(!present(v.kg))flag('kg');if(!present(v.tr))flag('tr');if(!present(v.start_no))flag('startNo');
    if(accurateFields.some(k=>numeric(h[k])!==null))coverage.accurate++;
    if(numeric(h.priorAccurateAvgSpeed)>0||numeric(h.priorAccurateStarts)>0||Math.abs(numeric(h.priorAccurateFinishSignal)||0)>0)coverage.priorAccurate++;
    if(numeric(h.prediction_order_snapshot)!==null||numeric(h.prediction_score_snapshot)!==null)coverage.predictionSnapshot++;
    if(Number(h.bmb)===1||Number(h.tr_bmb_candidate)===1||Number(h.tr_hidden_fav)===1)coverage.bmb++;
    if(Number(h.odb)===1||Number(h._ypuanOdbTail)===1||/\bODB\b/i.test(String(h.labels||h.tag||'')))coverage.odb++;
    if(h.x_kulis_comments?.length)coverage.xKulis++;if(h.expert_comments?.length)coverage.expertCommentRows++;
    if(numeric(h.gpr_starts)>0||numeric(h.gpr_wins)>0||Math.abs(numeric(h.gpr_strength)||0)>0)coverage.gpr++;
    if(verified&&finish(h)>0)coverage.resultHorseRows++;
   }
   if(missing.size){coverage.incompleteRaces++;if(coverage.incompleteRaceSamples.length<30)coverage.incompleteRaceSamples.push({file:r.__tkpFile?.filename||r.filename||'',hippodrome:r.hippodrome||'',date:r.race_date||'',leg:r.leg||0,missing:[...missing].join(', ')});}
   if(verified&&wins.length&&deps.frozenOrder?.(r)?.length)coverage.frozenSnapshotRaces++;
   // Commentator selection events are deduplicated within a race before totals
   // are aggregated by source/author. No archive-sized event map is retained.
   const events=new Map();
   for(const h of live){
    archivedComments+=(h.x_kulis_comments||[]).length;
    for(const c of [...(h.ypuan_breakdown||[]),...(h.expert_comments||[]).filter(c=>Number(c.direction)!==0)]){
     const source=String(c.source||c.site||'').trim().toLowerCase(),author=String(c.author||c.author_id||c.name||'site_yorumcusu').trim().toLowerCase();if(!source||!author)continue;
     const event=bucket(events,source+'|'+author,()=>({source,author,selections:new Set(),single:false}));event.selections.add(String(h.horse_no));if(Number(c.points)>=14||c.single===true||Number(c.single)===1)event.single=true;
    }
   }
   for(const event of events.values()){
    if(authors.size>=10000&&!authors.has(event.source+'|'+event.author))throw new Error('10.000 yorumcu sınırı aşıldı; bozuk kaynak kimliklerini kontrol edin. Kısmi analiz yayımlanmadı.');
    const a=bucket(authors,event.source+'|'+event.author,()=>({source_type:event.source,author_id:event.author,stored_events:0,events:0,unresolved_events:0,hits:0,selected_horses:0,expected_sum:0,single_events:0,single_hits:0}));
    a.stored_events++;a.selected_horses+=event.selections.size;const w=verified?wins[0]:null;if(!w){a.unresolved_events++;continue;}const hit=event.selections.has(String(w.horse_no))?1:0;a.events++;a.hits+=hit;a.expected_sum+=Math.min(1,event.selections.size/Math.max(1,live.length));if(event.single||event.selections.size===1){a.single_events++;a.single_hits+=hit;}
   }
   if(!eligible)return;
   totals.races++;totals.winners+=wins.length;if(hasValue)totals.valueRaces++;
   for(const [f,k] of [['surface','surface'],['breed','breed'],['condition_text','condition'],['race_date','date']])if(present(r[f])&&r[f]!=='BİLİNMİYOR')totals.coverage.race[k]++;
   const hip=deps.hipKey?deps.hipKey(r.hippodrome):r.hippodrome||'BİLİNMİYOR',hg=bucket(hippos,String(hip),()=>({races:0,bmb:signal(),r6:signal(),agf1:signal(),extra:signal()}));hg.races++;
   for(const field of Object.keys(ranks))markRank(bucket(ranks[field],String(r.condition_family||'BİLİNMİYOR'),rankGroup),wins,field);
   const cond=deps.broadCondition?deps.broadCondition(r.condition_family):r.condition_family||'BİLİNMİYOR',date=String(r.race_date||'').slice(0,10);
   if(/^\d{4}-\d{2}-\d{2}$/.test(date)){const byDate=bucket(conditionDays,String(cond),()=>new Map());if(!byDate.has(date)&&++conditionDayCount>100000)throw new Error('100.000 koşul/gün grubu sınırı aşıldı. Kısmi analiz yayımlanmadı.');const day=bucket(byDate,date,()=>({rank:rankGroup(),bmbRaces:0,bmbWin:0}));markRank(day.rank,wins,'result_rank');if(bs.length){day.bmbRaces++;if(bs.some(winner))day.bmbWin++;}}
   for(const h of live){
    totals.coverage.horse.total++;for(const [f,k] of [['hndkp','hndkp'],['sp','sp'],['result_score','result']])if(numeric(h[f])!==null)totals.coverage.horse[k]++;
    if(numeric(h.value_score)>0)totals.coverage.horse.value++;if(deps.trValue?.(h)!=null)totals.coverage.horse.tr++;
    if(Number(h.bmb)===1){mark(sig.bmb,h);mark(hg.bmb,h);}const rr=rank(h.result_rank),ag=rank(h.agf_rank);
    if(rr===1)mark(sig.r1,h);else if(rr>=2&&rr<=6)mark(sig.r26,h);if(rr>=1&&rr<=6)mark(hg.r6,h);
    if(ag===1){mark(sig.agf1,h);mark(hg.agf1,h);}else if(ag>=2&&ag<=6)mark(sig.agf26,h);
    if(deps.odb?.(h,r)){mark(sig.extra,h);mark(hg.extra,h);}if(Number(h.g800)===1)mark(sig.g8001,h);
    const val=numeric(h.value_score),bi=val===null?0:val<60?1:val<70?2:val<80?3:val<90?4:val<100?5:6;bandCounts[bi].n++;if(winner(h))bandCounts[bi].w++;
    const st=numeric(h.start_no??h.st??h.start??h.kulvar),li=st===null?5:st>=1&&st<=3?0:st>=4&&st<=6?1:st>=7&&st<=9?2:st>=10&&st<=12?3:st>=13?4:-1;
    if(li>=0){laneBands[li].cand++;if(winner(h))laneBands[li].win++;}
    for(const [k,v] of Object.entries(h))if(numeric(v)!==null&&(!deps.fieldExclusion||!deps.fieldExclusion(k))){if(!Object.prototype.hasOwnProperty.call(observed,k)&&++observedCount>2000)throw new Error('2.000 sayısal alan sınırı aşıldı. Kısmi analiz yayımlanmadı.');observed[k]=(observed[k]||0)+1;}
    const comments=h.x_kulis_comments||[],scores=comments.map(c=>numeric(c.score)).filter(v=>v!==null),raw=numeric(h.x_kulis_score),score=raw!==null?raw:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
    if(score!==null||comments.length){const delta=numeric(h.x_ypuan_delta),dir=Math.sign(delta||comments.reduce((n,c)=>n+(Number(c.direction)||0),0)),g=xGroups[dir+1];g.count++;if(score!==null){g.scoreSum+=score;g.scoreCount++;}if(delta!==null&&delta!==0){g.deltaSum+=delta;g.deltaCount++;}if(finish(h)>0){g.known++;archivedVerified++;if(winner(h))g.wins++;}}
   }
   bandCounts.forEach((x,i)=>{valueBands[i].cand+=x.n;valueBands[i].win+=x.w;if(x.n===1){valueBands[i].single++;valueBands[i].sw+=x.w;}});
   let any=false;for(let i=0;i<accurateFields.length;i++){const field=accurateFields[i],valid=v=>v!==null&&(i>=3||v>0),values=live.map(h=>numeric(h[field])).filter(valid);if(!values.length)continue;any=true;const avg=values.reduce((a,b)=>a+b,0)/values.length,g=accurate.fields[field];for(const h of live){const v=numeric(h[field]);if(!valid(v))continue;const key=v>avg?'above':'below';g[key]++;if(winner(h))g[key+'Win']++;}}if(any){accurate.withData++;accurate.known++;}
  }
  function finalize(){
   Object.values(sig).forEach(finishSignals);for(const h of hippos.values())for(const k of ['bmb','r6','agf1','extra'])finishSignals(h[k]);
   const categories=Object.fromEntries([...cats].map(([key,map])=>[key,[...map].sort((a,b)=>b[1].races-a[1].races)]));
   const conditionPrefixes=Object.create(null);
   for(const [cond,map] of conditionDays){const accum={rank:rankGroup(),bmbRaces:0,bmbWin:0};conditionPrefixes[cond]=[...map].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,day])=>{const row={date,rank:{...accum.rank},bmbRaces:accum.bmbRaces,bmbWin:accum.bmbWin};for(const k of Object.keys(accum.rank))accum.rank[k]+=day.rank[k];accum.bmbRaces+=day.bmbRaces;accum.bmbWin+=day.bmbWin;return row;});}
   const commentators=[...authors.values()].map(a=>({...a,accuracy:a.events?a.hits/a.events:null,expected:a.events?a.expected_sum/a.events:null,edge:a.events?(a.hits-a.expected_sum)/a.events:null,avg_selections:a.stored_events?a.selected_horses/a.stored_events:null,descriptive_events:a.stored_events,descriptive_coverage:a.stored_events?1:0,lane:'HISTORICAL_EMBEDDED_RESEARCH'}));
   coverage.commentatorHistoricalSelections=commentators.reduce((n,a)=>n+a.stored_events,0);coverage.commentatorHistoricalEvents=commentators.reduce((n,a)=>n+a.events,0);coverage.commentatorHistoricalUnresolved=commentators.reduce((n,a)=>n+a.unresolved_events,0);
   coverage.missingFieldLabels={surface:'Pist',breed:'Safkan türü',condition:'Koşu şartı',distance:'Mesafe',startNo:'Start No',kg:'Kilo (KG)',tr:'TR PUAN'};
   totals.inactiveRaces=totals.totalRaces-totals.races;
   return {version:VERSION,stats:totals,categories,ranks:Object.fromEntries(Object.entries(ranks).map(([k,v])=>[k,Object.fromEntries(v)])),signals:sig,hippos:[...hippos].sort((a,b)=>b[1].races-a[1].races),valueBands,laneBands,accurate,x:{groups:xGroups,archivedComments,archivedVerified},coverage,observed,conditionPrefixes,commentators};
  }
  return {addFile,addRace,finalize};
 }
 let completed=null,inFlight=null;
 function dbNow(){try{return typeof db!=='undefined'?db:root.db;}catch(_){return root.db;}}
 function required(database=dbNow()){return !root.__tkpBacktestContext?.enabled&&!!database?.__segmented_storage?.safeMode;}
 function signature(database=dbNow()){
  const d=database||{},s=d.__segmented_storage||{};
  return JSON.stringify([VERSION,s.analyticsContentSignature||s.baseGeneration||'',d.files?.length||0,d.races?.length||0,d.learning_state?.dataset_signature||'',d.learning_state?.outcome_signature||'',d.settings?.algorithm_features||[],d.__archiveDataRevision||0]);
 }
 function peek(database=dbNow()){return !root.__tkpBacktestContext?.enabled&&completed?.database===database&&completed.signature===signature(database)?completed.value:null;}
 function deps(){return {isNonRunner:root.isNonRunner,verified:root.tkpHistoricalVerifiedRace,vector:root.tkpHistoricalHorseFeatureVector,frozenOrder:root.tkpHistoricalFrozenOrderForRace,hipKey:root.tkpHippodromeSignalGroupKey,broadCondition:root.broadConditionKey,trValue:root.tkpTrustedGcTrValue,odb:root.isOdbCandidate,fieldExclusion:root.tkpTableFieldNameExclusionReason};}
 async function* collection(database,name,storage,manifest,signal){
  const offset=Number(database.__segmented_storage?.collections?.[name]?.loadedOffset)||0;
  if(manifest&&offset)for await(const p of storage.iterateCollectionPages(name,{manifest,endOffset:offset,limit:500,signal,verifyHashes:true}))yield p.rows;
  const hot=database[name]||[];for(let i=0;i<hot.length;i+=500)yield hot.slice(i,i+500);
 }
 async function ensure(database=dbNow(),options={}){
  const wanted=signature(database);if(peek(database))return peek(database);if(inFlight?.database===database&&inFlight.signature===wanted)return inFlight.promise;
  const run=(async()=>{
   const check=()=>{if(options.signal?.aborted)throw new Error('Tam arşiv analizi iptal edildi.');if(signature(database)!==wanted)throw new Error('Analiz sırasında veri değişti. Yeni arşivle tekrar hesaplayın.');};check();
   const storage=options.storage||root.TKPSegmentedIDB,manifest=required(database)?await storage.getActiveManifest():null;
   if(manifest&&manifest.generation!==database.__segmented_storage.baseGeneration)throw new Error('Arşiv nesli değişti. Görünümü yeniden yükleyin.');
   const cached=!options.noCache&&root.tkpUiCacheGet?await root.tkpUiCacheGet('tkp_full_archive_analytics_v1'):null;
   if(cached?.signature===wanted&&cached.value?.version===VERSION){check();completed={database,signature:wanted,value:cached.value};return cached.value;}
   const acc=createAccumulator(options.deps||deps());let files=0,processed=0,last=performance.now();
   const pause=async()=>{check();if(performance.now()-last>=8){await new Promise(r=>setTimeout(r,0));last=performance.now();}};
   for await(const page of collection(database,'files',storage,manifest,options.signal))for(const f of page){acc.addFile(f);files++;await pause();}
   await (options.history||root.TKPHistoryQuery).withHistory(database,async pages=>{for await(const page of pages){for(const race of page){acc.addRace(race);processed++;await pause();}options.onProgress?.({phase:'summary',processed,total:manifest?.collections?.races?.count||database.races?.length||0});}},{...options,storage,activeOnly:false,includeFile:true});
   const value=acc.finalize();value.coverage.forwardTrackingRows=(Number(database.__segmented_storage?.collections?.forward_tracking_log?.loadedOffset)||0)+(database.forward_tracking_log?.length||0);
   const rescue=root.TKP_RESCUE509?.training||{};value.coverage.rescueFiles=Number(rescue.files)||0;value.coverage.rescueRaces=Number(rescue.races)||0;value.coverage.rescueOfficialPayoutMeetings=Number(rescue.officialPayoutMeetings)||0;
   check();value.source={scope:'FULL_ARCHIVE',races:processed,files,at:new Date().toISOString(),generation:manifest?.generation||null};
   completed={database,signature:wanted,value};
   if(!options.noCache&&root.tkpUiCacheSet)await Promise.resolve(root.tkpUiCacheSet('tkp_full_archive_analytics_v1',{signature:wanted,value})).catch(()=>{});
   return value;
  })();
  inFlight={database,signature:wanted,promise:run};try{return await run;}finally{if(inFlight?.promise===run)inFlight=null;}
 }
 function conditionBefore(value,race){
  const cond=root.broadConditionKey?root.broadConditionKey(race.condition_family):race.condition_family||'BİLİNMİYOR',rows=value.conditionPrefixes[cond]||[],date=String(race.race_date||'').slice(0,10);
  let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>>1;if(rows[m].date<date)lo=m+1;else hi=m;}
  // A target date occurring in this archive has an exact pre-day prefix.
  return rows[lo]?.date===date?rows[lo]:null;
 }
 let adaptiveFlight=null;
 async function ensureAdaptive(database=dbNow(),options={}){
  const value=await ensure(database,options),wanted=signature(database);if(value.adaptive)return value;
  if(adaptiveFlight?.signature===wanted&&adaptiveFlight.database===database)return adaptiveFlight.promise;
  const promise=(async()=>{const check=()=>{if(options.signal?.aborted||signature(database)!==wanted)throw new Error('Adaptif analiz iptal edildi veya arşiv değişti.');};
   await root.tkpBuildFullArchiveAdaptive(database,value,{...options,check});check();
   if(!options.noCache&&root.tkpUiCacheSet)await Promise.resolve(root.tkpUiCacheSet('tkp_full_archive_analytics_v1',{signature:wanted,value})).catch(()=>{});return value;
  })();adaptiveFlight={database,signature:wanted,promise};try{return await promise;}finally{if(adaptiveFlight?.promise===promise)adaptiveFlight=null;}
 }
 return {VERSION,dimensions,createAccumulator,ensure,ensureAdaptive,peek,required,signature,conditionBefore,numeric,rank,finish};
});
