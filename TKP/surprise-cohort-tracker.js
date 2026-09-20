/*
 * surprise-cohort-tracker.js
 *
 * BH / BMB / ODB / AGF 6–8 için ayrı, sonucu görmeden dondurulmuş takip
 * günlüğü. Bu dosya bilerek kupon, ana skor ve sıralama motorlarını çağırıp
 * değiştirmez. Canlı kayıtlar yalnız yarış başlangıcından ÖNCE oluşur;
 * geçmiş arşivden üretilen kayıtlar ise açıkça HISTORICAL_RESEARCH'tür.
 */
(function(global){
  'use strict';

  const VERSION='V1.1.240-SURPRISE-COHORT-SHADOW-1';
  const LOG_KEY='surprise_cohort_tracking_log';
  const LIVE_CLASS='LIVE_PRE_RACE_LOCKED';
  const RESEARCH_CLASS='HISTORICAL_RESEARCH';
  const MAX_LOOKBACK=8192;
  const MAX_BH=2;
  const MAX_BMB=6;
  const MAX_ODB=6;
  const MAX_AGF_6_8=6;
  const MAX_AGF_SAMPLES=6;
  const MIN_AGF_SAMPLE_GAP_MS=45*1000;
  let persistQueued=false;

  function currentDb(){
    try{return db&&typeof db==='object'?db:null;}catch(_e){return global.db&&typeof global.db==='object'?global.db:null;}
  }
  function nowIso(now){
    const d=now instanceof Date?now:new Date(now||Date.now());
    return Number.isNaN(d.getTime())?'':d.toISOString();
  }
  function finiteNumber(value){const n=Number(value);return Number.isFinite(n)?n:null;}
  function cleanText(value){return String(value??'').trim();}
  function normalizeHorseNo(value){return cleanText(value).toLocaleUpperCase('tr-TR');}
  function sameHorse(left,right){
    const a=normalizeHorseNo(left),b=normalizeHorseNo(right);
    if(!a||!b)return false;
    if(a===b)return true;
    try{return typeof global.sameEkuri==='function'&&global.sameEkuri(a,b);}catch(_e){return false;}
  }
  function nonRunner(horse){
    try{return typeof global.isNonRunner==='function'&&global.isNonRunner(horse);}catch(_e){return /\(KOŞMAZ\)/i.test(String(horse?.horse_name||''));}
  }
  function hasResult(race){
    try{return typeof global.raceHasConfirmedResult==='function'&&global.raceHasConfirmedResult(race?.horses||[]);}catch(_e){
      return (race?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
    }
  }
  function canonicalTrack(value){
    try{return typeof global.canonicalHippodrome==='function'?global.canonicalHippodrome(value||''):cleanText(value).toLocaleUpperCase('tr-TR');}catch(_e){return cleanText(value).toLocaleUpperCase('tr-TR');}
  }
  function raceKey(race){
    const explicit=cleanText(race?.race_uid);
    if(explicit)return `UID:${explicit}`;
    return [cleanText(race?.race_date||race?.date),canonicalTrack(race?.hippodrome),Number(race?.altili_no)||1,Number(race?.leg)||Number(race?.sequence_no)||Number(race?.race_no)||0].join('|');
  }
  function parseRaceDateAndTime(dateValue,timeValue){
    const date=cleanText(dateValue),time=cleanText(timeValue);
    const tm=time.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);
    if(!tm)return null;
    let y,m,d;
    const iso=date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const tr=date.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    if(iso){y=Number(iso[1]);m=Number(iso[2]);d=Number(iso[3]);}
    else if(tr){y=Number(tr[3]);m=Number(tr[2]);d=Number(tr[1]);}
    else return null;
    const out=new Date(y,m-1,d,Number(tm[1]),Number(tm[2]),0,0);
    return Number.isNaN(out.getTime())?null:out;
  }
  // Tek başına tarih veya sonradan yazılmış bir sonuç alanı yarış-öncesi kanıt
  // değildir. Bu yüzden canlı günlüğe yalnız gerçek başlangıç zamanı varsa girilir.
  function raceStartAt(race){
    const explicit=cleanText(race?.race_start_at||race?.start_at||race?.startAt);
    if(explicit){
      const parsed=new Date(explicit);
      if(!Number.isNaN(parsed.getTime()))return parsed;
    }
    return parseRaceDateAndTime(race?.race_date||race?.date,race?.tjk_race_time||race?.race_time||race?.start_time||race?.time);
  }
  function isBeforeStart(race,now){
    const start=raceStartAt(race);
    const at=now instanceof Date?now:new Date(now||Date.now());
    return !!start&&!Number.isNaN(at.getTime())&&at.getTime()<start.getTime();
  }
  function isLiveFinalRace(race){
    try{return typeof global.tkpForwardTrackingWithinLiveFinal==='function'?global.tkpForwardTrackingWithinLiveFinal(race):true;}catch(_e){return true;}
  }
  function logFor(target){
    const out=target||currentDb();
    if(!out)return [];
    if(!Array.isArray(out[LOG_KEY]))out[LOG_KEY]=[];
    return out[LOG_KEY];
  }
  function lookup(log,key){
    for(let i=log.length-1,seen=0;i>=0&&seen<MAX_LOOKBACK;i--,seen++){
      const row=log[i];if(row?.race_key===key)return row;
    }
    return null;
  }
  function stableHash(value){
    const text=String(value??'');let h=2166136261>>>0;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
    return `fnv1a32:${h.toString(16).padStart(8,'0')}`;
  }
  function snapshotPrimary(rec){
    return {
      version:rec?.version,race_key:rec?.race_key,event_class:rec?.event_class,
      race_date:rec?.race_date,hippodrome:rec?.hippodrome,altili_no:rec?.altili_no,
      leg:rec?.leg,race_no:rec?.race_no,meeting_uid:rec?.meeting_uid,race_uid:rec?.race_uid,
      captured_at:rec?.captured_at,race_start_at:rec?.race_start_at,candidates:rec?.candidates
    };
  }
  function validSnapshot(rec){
    return !!rec&&rec.immutable_snapshot_hash===stableHash(JSON.stringify(snapshotPrimary(rec)));
  }
  function compactCandidate(horse,extra={}){
    return {
      horse_no:cleanText(horse?.horse_no),horse_name:cleanText(horse?.horse_name),
      agf:finiteNumber(horse?.agf),agf_rank:finiteNumber(horse?.agf_rank),
      score:finiteNumber(horse?.score),bmb:Number(horse?.bmb)===1?1:0,
      bmb_source:cleanText(horse?.bmb_source),
      ...extra
    };
  }
  function sortByScoreThenNo(rows){
    return rows.slice().sort((a,b)=>(Number(b?.score)||0)-(Number(a?.score)||0)
      ||(Number(a?.agf_rank)||999)-(Number(b?.agf_rank)||999)
      ||TKP_TR_COLLATOR_NUM.compare(cleanText(a?.horse_no),cleanText(b?.horse_no)));
  }
  function candidateSets(race){
    const horses=(race?.horses||[]).filter(h=>h&&!nonRunner(h));
    let bh=[];
    try{
      const sourceDb=currentDb();
      const bhKey=typeof global.tkpBombHunterRaceKey==='function'?global.tkpBombHunterRaceKey(race):raceKey(race);
      const frozen=(sourceDb?.bomb_hunter_shadow_log||[]).slice().reverse().find(row=>row?.race_key===bhKey&&Array.isArray(row?.candidates)&&row.candidates.length);
      if(frozen){
        bh=frozen.candidates.slice(0,MAX_BH).map((row,index)=>{
          const horse=horses.find(h=>sameHorse(h?.horse_no,row?.horse_no))||row;
          return compactCandidate(horse,{rank:Number(row?.rank)||index+1,bh_score:finiteNumber(row?.score),reasons:Array.isArray(row?.reasons)?row.reasons.slice(0,4):[]});
        });
      }else if(typeof global.tkpBombHunterCandidates==='function'){
        bh=global.tkpBombHunterCandidates(race).slice(0,MAX_BH).map((row,index)=>compactCandidate(row?.h,{rank:index+1,bh_score:finiteNumber(row?.score),reasons:Array.isArray(row?.reasons)?row.reasons.slice(0,4):[]}));
      }
    }catch(_e){bh=[];}
    const bmb=sortByScoreThenNo(horses.filter(h=>Number(h?.bmb)===1)).slice(0,MAX_BMB).map((h,index)=>compactCandidate(h,{rank:index+1}));
    let odb=[];
    try{
      odb=sortByScoreThenNo(horses.filter(h=>typeof global.isOdbCandidate==='function'&&global.isOdbCandidate(h,race))).slice(0,MAX_ODB).map((h,index)=>compactCandidate(h,{rank:index+1}));
    }catch(_e){odb=[];}
    // Kullanıcının kesin bandı: yalnız 6, 7, 8. 9–10 burada veya istatistikte
    // hiçbir şekilde yer almaz.
    const agf68=horses.filter(h=>{
      const rank=finiteNumber(h?.agf_rank);return rank!==null&&rank>=6&&rank<=8;
    }).slice().sort((a,b)=>(Number(a?.agf_rank)||999)-(Number(b?.agf_rank)||999)
      ||TKP_TR_COLLATOR_NUM.compare(cleanText(a?.horse_no),cleanText(b?.horse_no)))
      .slice(0,MAX_AGF_6_8).map((h,index)=>compactCandidate(h,{rank:index+1}));
    return {BH:bh,BMB:bmb,ODB:odb,AGF_6_8:agf68};
  }
  function createRecord(race,eventClass,now){
    const start=raceStartAt(race);
    const rec={
      version:VERSION,race_key:raceKey(race),event_class:eventClass,promotion_status:'SHADOW',automatic_promotion:false,
      race_date:cleanText(race?.race_date||race?.date),hippodrome:cleanText(race?.hippodrome),altili_no:Number(race?.altili_no)||1,
      leg:Number(race?.leg)||Number(race?.sequence_no)||0,race_no:Number(race?.race_no)||0,
      file_id:race?.file_id??null,meeting_uid:cleanText(race?.meeting_uid),race_uid:cleanText(race?.race_uid),
      captured_at:nowIso(now),race_start_at:start?start.toISOString():'',
      pre_race_provenance:eventClass===LIVE_CLASS?'TIMESTAMPED_BEFORE_RACE':'RECONSTRUCTED_STORED_FIELDS_RESEARCH_ONLY',
      candidates:candidateSets(race),agf_movement:{samples:[],sharp_candidates:[],status:'PRE_RACE_SAMPLE_PENDING'},
      outcome:null,resolved_at:'',integrity:'OK'
    };
    rec.immutable_snapshot_hash=stableHash(JSON.stringify(snapshotPrimary(rec)));
    return rec;
  }
  function agfValuesForLockedCandidates(rec,race){
    const wanted=new Set((rec?.candidates?.AGF_6_8||[]).map(c=>normalizeHorseNo(c?.horse_no)).filter(Boolean));
    if(!wanted.size)return [];
    return (race?.horses||[]).filter(h=>wanted.has(normalizeHorseNo(h?.horse_no))).map(h=>({
      horse_no:cleanText(h?.horse_no),agf:finiteNumber(h?.agf),agf_rank:finiteNumber(h?.agf_rank)
    })).sort((a,b)=>TKP_TR_COLLATOR_NUM.compare(cleanText(a.horse_no),cleanText(b.horse_no)));
  }
  function updateAgfMovement(rec,race,now){
    if(!rec||rec.event_class!==LIVE_CLASS||rec.outcome||!isBeforeStart(race,now))return false;
    const start=Date.parse(rec.race_start_at||'');const at=new Date(now||Date.now());
    if(!Number.isFinite(start)||Number.isNaN(at.getTime())||at.getTime()>=start)return false;
    const values=agfValuesForLockedCandidates(rec,race);if(!values.length)return false;
    const samples=Array.isArray(rec?.agf_movement?.samples)?rec.agf_movement.samples:[];
    const last=samples[samples.length-1];
    if(last&&Math.abs(at.getTime()-Date.parse(last.captured_at||''))<MIN_AGF_SAMPLE_GAP_MS)return false;
    const next={captured_at:at.toISOString(),values};
    if(last&&JSON.stringify(last.values)===JSON.stringify(values))return false;
    samples.push(next);
    // Saklama sınırlı: ilk örnek karşılaştırma tabanı olarak korunur, son beş
    // örnek yeterlidir. Her örnek yalnız başlangıçta AGF 6–8 olan atları taşır.
    if(samples.length>MAX_AGF_SAMPLES)samples.splice(1,samples.length-MAX_AGF_SAMPLES);
    rec.agf_movement={...rec.agf_movement,samples};
    rec.agf_movement.sharp_candidates=agfSharpCandidates(rec);
    rec.agf_movement.status=samples.length>=2?'PRE_RACE_ONLY':'PRE_RACE_SAMPLE_PENDING';
    return true;
  }
  function agfSharpCandidates(rec){
    const samples=Array.isArray(rec?.agf_movement?.samples)?rec.agf_movement.samples:[];
    if(samples.length<2)return [];
    const first=samples[0],last=samples[samples.length-1];
    const byNo=new Map((first?.values||[]).map(row=>[normalizeHorseNo(row?.horse_no),row]));
    const out=[];
    for(const current of (last?.values||[])){
      const previous=byNo.get(normalizeHorseNo(current?.horse_no));if(!previous)continue;
      const before=finiteNumber(previous?.agf),after=finiteNumber(current?.agf);
      const beforeRank=finiteNumber(previous?.agf_rank),afterRank=finiteNumber(current?.agf_rank);
      const delta=before!==null&&after!==null?Math.round((after-before)*100)/100:null;
      const rankDelta=beforeRank!==null&&afterRank!==null?afterRank-beforeRank:null;
      // "Keskin" yalnız raporlama etiketidir: en az 3 AGF puanı veya iki sıra
      // farkı. Kupon/skor kararlarına hiçbir etkisi yoktur.
      if((delta!==null&&Math.abs(delta)>=3)||(rankDelta!==null&&Math.abs(rankDelta)>=2)){
        out.push({horse_no:cleanText(current?.horse_no),agf_before:before,agf_after:after,agf_delta:delta,rank_before:beforeRank,rank_after:afterRank,rank_delta:rankDelta});
      }
    }
    return out;
  }
  function queuePersistence(){
    if(persistQueued)return;
    persistQueued=true;
    const save=()=>{
      persistQueued=false;
      // During a central multi-leg pipeline the caller owns one coalesced persist.
      if(global.__tkpBulkPipelineActive===true)return;
      try{
        if(typeof global.tkpPersistCollections==='function')global.tkpPersistCollections(['surprise_cohort_tracking_log'],{label:'surprise-cohort'});
        else if(typeof global.saveDB==='function')global.saveDB(false);
      }catch(_e){}
    };
    try{
      if(typeof global.tkpRunWhenUserIdle==='function'){global.tkpRunWhenUserIdle(save,{minIdleMs:700,retryMs:100,maxWaitMs:3000});return;}
    }catch(_e){}
    try{global.setTimeout(save,80);}catch(_e){persistQueued=false;}
  }
  function liveCapture(race,options={}){
    const target=options.db||currentDb();if(!target||!race)return {created:false,reason:'NO_DB_OR_RACE'};
    const now=options.now instanceof Date?options.now:new Date(options.now||Date.now());
    if(hasResult(race))return {created:false,reason:'RESULT_KNOWN_REFUSED'};
    if(!isLiveFinalRace(race))return {created:false,reason:'HISTORICAL_REQUIRES_EXPLICIT_RESEARCH_BACKFILL'};
    if(!isBeforeStart(race,now))return {created:false,reason:'NO_VERIFIABLE_PRE_RACE_TIME'};
    const log=logFor(target),key=raceKey(race);let rec=lookup(log,key);
    if(rec){
      const changed=updateAgfMovement(rec,race,now);if(changed)queuePersistence();
      return {created:false,changed,record:rec,reason:'ALREADY_LOCKED'};
    }
    rec=createRecord(race,LIVE_CLASS,now);
    updateAgfMovement(rec,race,now);
    log.push(rec);queuePersistence();
    return {created:true,changed:true,record:rec};
  }
  function resolveRecord(rec,race,now){
    if(!rec||!race||!hasResult(race)||rec.outcome)return false;
    if(!validSnapshot(rec)){rec.integrity='HASH_MISMATCH';return true;}
    const winner=(race?.horses||[]).find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1)||null;
    if(!winner)return false;
    const sets={};
    for(const [kind,candidates] of Object.entries(rec.candidates||{})){
      sets[kind]=(candidates||[]).map(candidate=>{
        const horse=(race?.horses||[]).find(h=>sameHorse(h?.horse_no,candidate?.horse_no))||null;
        const finish=finiteNumber(horse?.finish_position)??(Number(horse?.winner)===1?1:null);
        return {horse_no:cleanText(candidate?.horse_no),finish_position:finish,win:finish===1?1:0,top3:finish!==null&&finish<=3?1:0,top5:finish!==null&&finish<=5?1:0};
      });
    }
    rec.outcome={winner_no:cleanText(winner?.horse_no),winner_name:cleanText(winner?.horse_name),candidate_sets:sets};
    rec.resolved_at=nowIso(now);rec.integrity='OK';
    return true;
  }
  function resolveBatch(races,options={}){
    const target=options.db||currentDb();if(!target)return false;
    const log=logFor(target);let changed=false;
    for(const item of (races||[])){
      const race=item?.r||item;if(!race||!hasResult(race))continue;
      const rec=lookup(log,raceKey(race));
      if(rec&&resolveRecord(rec,race,options.now))changed=true;
    }
    if(changed)queuePersistence();
    return changed;
  }
  function sync(races,options={}){
    let changed=false;
    for(const item of (races||[])){
      const race=item?.r||item;if(!race)continue;
      if(hasResult(race)){if(resolveBatch([race],options))changed=true;continue;}
      const outcome=liveCapture(race,options);if(outcome.created||outcome.changed)changed=true;
    }
    return changed;
  }
  function appendHistoricalRace(log,race,options={}){
    if(!race||!hasResult(race))return {created:false,reason:'RESULT_REQUIRED_FOR_RESEARCH'};
    const key=raceKey(race);if(lookup(log,key))return {created:false,reason:'ALREADY_LOGGED'};
    const rec=createRecord(race,RESEARCH_CLASS,options.now||new Date());
    rec.research_note='Geçmiş kayıttaki mevcut yarış-öncesi alanlardan yeniden kuruldu; canlı kanıt veya otomatik model terfisi değildir.';
    rec.immutable_snapshot_hash=stableHash(JSON.stringify(snapshotPrimary(rec)));
    log.push(rec);resolveRecord(rec,race,options.now);
    return {created:true,record:rec};
  }
  function historicalBackfill(races,options={}){
    const target=options.db||currentDb();if(!target)return {created:0,skipped:0,reason:'NO_DB'};
    const log=logFor(target),limit=Math.max(1,Math.min(10000,Number(options.limit)||1000));
    let created=0,skipped=0,changed=false;
    // Açık çağrı olmadan, sonuçlu bir yarış için snapshot asla oluşturulmaz.
    for(const item of (races||[])){
      if(created>=limit)break;
      const race=item?.r||item;
      const outcome=appendHistoricalRace(log,race,options);
      if(outcome.created){created++;changed=true;}else skipped++;
    }
    if(changed)queuePersistence();
    return {created,skipped,event_class:RESEARCH_CLASS,automatic_promotion:false};
  }
  async function yieldHistoricalBackfill(){
    try{if(typeof global.tkpYield==='function'){await global.tkpYield();return;}}catch(_e){}
    await new Promise(resolve=>{
      try{global.setTimeout(resolve,0);}catch(_e){resolve();}
    });
  }
  // Kullanıcının açıkça başlattığı 503-geçmiş işi bile tarayıcıyı uzun süre
  // meşgul etmesin. Her 24 yarışta olay kuyruğuna dönülür; canlı kayıt yoktur.
  async function historicalBackfillAsync(races,options={}){
    const target=options.db||currentDb();if(!target)return {created:0,skipped:0,reason:'NO_DB'};
    const log=logFor(target),items=Array.isArray(races)?races:[];
    const limit=Math.max(1,Math.min(10000,Number(options.limit)||1000));
    let created=0,skipped=0,changed=false;
    for(let index=0;index<items.length&&created<limit;index++){
      const outcome=appendHistoricalRace(log,items[index]?.r||items[index],options);
      if(outcome.created){created++;changed=true;}else skipped++;
      if(index>0&&index%24===0)await yieldHistoricalBackfill();
    }
    if(changed)queuePersistence();
    return {created,skipped,event_class:RESEARCH_CLASS,automatic_promotion:false,cooperative:true};
  }
  function scheduleHistoricalBackfill(options={}){
    if(options?.explicit!==true)return {scheduled:false,reason:'EXPLICIT_CONFIRMATION_REQUIRED'};
    const target=options.db||currentDb();
    const races=Array.isArray(options.races)?options.races:(target?.races||[]);
    return historicalBackfillAsync(races,{...options,db:target});
  }

  let _autoHistoricalDb=null,_autoHistoricalPending=false;
  function archiveMeetingCount(target){
    const files=Array.isArray(target?.files)?target.files:[];if(files.length)return files.length;
    return new Set((target?.races||[]).map(r=>String(r?.file_id||'')).filter(Boolean)).size;
  }
  function ensureAutomaticHistoricalResearch(target){
    if(!target||_autoHistoricalPending||_autoHistoricalDb===target)return;
    const rows=logFor(target),hasResearch=rows.some(row=>row?.event_class===RESEARCH_CLASS),races=Array.isArray(target?.races)?target.races:[];
    if(hasResearch||!races.length){_autoHistoricalDb=target;return;}
    _autoHistoricalPending=true;
    const run=async()=>{try{
      await historicalBackfillAsync(races,{db:target,limit:10000,automaticResearch:true});_autoHistoricalDb=target;
      try{if(typeof global.tkpRefreshLearningCache==='function')global.tkpRefreshLearningCache(true);}catch(_e){}
      try{if(typeof global.renderActivePane==='function')global.renderActivePane();}catch(_e){}
    }finally{_autoHistoricalPending=false;}};
    try{global.setTimeout(run,0);}catch(_e){run();}
  }

  function aggregate(rows,kind,eventClass){
    const relevant=rows.filter(row=>row?.event_class===eventClass&&row?.integrity==='OK'&&Array.isArray(row?.candidates?.[kind])&&row.candidates[kind].length);
    const done=relevant.filter(row=>row?.outcome);
    let candidates=0,wins=0,top3=0,top5=0,sharp=0;
    for(const row of done){
      const values=row?.outcome?.candidate_sets?.[kind]||[];candidates+=values.length;
      wins+=values.reduce((sum,value)=>sum+(Number(value?.win)||0),0);
      top3+=values.reduce((sum,value)=>sum+(Number(value?.top3)||0),0);
      top5+=values.reduce((sum,value)=>sum+(Number(value?.top5)||0),0);
      if(kind==='AGF_6_8'&&(row?.agf_movement?.sharp_candidates||[]).length)sharp++;
    }
    return {events:relevant.length,resolved_events:done.length,candidates,wins,top3,top5,sharp_movement_events:sharp};
  }
  function stats(target){
    const rows=logFor(target),kinds=['BH','BMB','ODB','AGF_6_8'];
    const live={},research={};
    for(const kind of kinds){live[kind]=aggregate(rows,kind,LIVE_CLASS);research[kind]=aggregate(rows,kind,RESEARCH_CLASS);}
    // Eşik yalnız manuel inceleme hakkı verir; bu modül hiçbir koşulda kupon veya
    // puan motoruna sinyal aktarmadığı için ACTIVE durumu üretmez.
    const gates=Object.fromEntries(kinds.map(kind=>{
      const events=live[kind].resolved_events;
      return [kind,{events,state:events>=150?'REVIEW':'SHADOW',canActivate:false,automaticPromotion:false}];
    }));
    return {version:VERSION,rows:rows.length,live,research,gates};
  }
  function pct(n,d){return d?`%${Math.round(100*n/d)}`:'-';}
  function esc(value){
    try{return typeof global.esc==='function'?global.esc(value):String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(_e){return String(value??'');}
  }
  function trackingHtml(target){
    ensureAutomaticHistoricalResearch(target);
    const archiveCount=archiveMeetingCount(target);
    const data=stats(target);const labels={BH:'BH1–BH2',BMB:'BMB',ODB:'ODB',AGF_6_8:'AGF sıra 6–8'};
    const row=(kind)=>{
      const live=data.live[kind],research=data.research[kind],gate=data.gates[kind];
      const liveRate=live.candidates?pct(live.wins,live.candidates):'-';
      const researchRate=research.candidates?pct(research.wins,research.candidates):'-';
      return `<tr><td><b>${esc(labels[kind])}</b></td><td class="num">${live.events}</td><td class="num">${live.resolved_events}</td><td class="num">${live.candidates}</td><td class="num">${liveRate}</td><td class="num">${live.sharp_movement_events||'-'}</td><td class="num">${research.resolved_events} / ${researchRate}</td><td><span class="badge">${gate.state}</span></td></tr>`;
    };
    const recent=logFor(target).slice().reverse().slice(0,18).map(rec=>{
      const fmt=kind=>(rec?.candidates?.[kind]||[]).map(x=>esc(x.horse_no)).join('/')||'-';
      const winner=rec?.outcome?.winner_no?`<span class="horseNoBadge">${esc(rec.outcome.winner_no)}</span> ${esc(rec.outcome.winner_name||'')}`:'Bekliyor';
      const sharp=(rec?.agf_movement?.sharp_candidates||[]).map(x=>`${esc(x.horse_no)} ${x.agf_delta==null?'':'%'+x.agf_delta}`).join(' · ')||'-';
      return `<tr><td>${rec.event_class===LIVE_CLASS?'CANLI':'ARAŞTIRMA'}</td><td>${esc(rec.race_date||'-')}</td><td>${esc(rec.hippodrome||'-')}</td><td class="num">${Number(rec.leg)||'-'}</td><td>${fmt('BH')}</td><td>${fmt('BMB')}</td><td>${fmt('ODB')}</td><td>${fmt('AGF_6_8')}</td><td>${sharp}</td><td>${winner}</td></tr>`;
    }).join('');
    return `<div class="card tkpSurpriseCohortTracker" style="border-left:5px solid #7c3aed;margin:10px 0;"><h2 style="margin:0 0 5px;">🧪 Sürpriz Sinyal Takibi · BH / BMB / ODB / AGF 6–8</h2><p class="muted" style="margin:0 0 8px;">Adaylar yalnız yarış sonucu yokken ve doğrulanabilir başlangıç saatinden önce kilitlenir. AGF hareketi için en az iki zaman damgalı yarış-öncesi örnek gerekir. Bu kart <b>SHADOW / REVIEW</b> izleme aracıdır; kuponu veya puanı otomatik değiştirmez. AGF 9–10 kesinlikle bu kümeye dahil değildir.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Küme</th><th class="num">Canlı kilit</th><th class="num">Çözülen</th><th class="num">Aday</th><th class="num">Kazanma</th><th class="num">Keskin AGF</th><th class="num">${archiveCount} arşiv araştırma</th><th>Durum</th></tr></thead><tbody>${['BH','BMB','ODB','AGF_6_8'].map(row).join('')}</tbody></table></div><p class="muted" style="margin:8px 0 6px;font-size:11px;">Canlıda her kümede 150 benzersiz çözülen olay olsa bile yalnız <b>REVIEW</b> olur; otomatik terfi yoktur. Araştırma satırları geçmişte sonuç bilindiği için canlı başarı kanıtı sayılmaz.</p><span class="badge">Geçmiş araştırma otomatik bağlanır · ${archiveCount} toplantı</span><div class="tableWrap compactBacktest" style="margin-top:8px;"><table><thead><tr><th>Sınıf</th><th>Tarih</th><th>Pist</th><th class="num">Ayak</th><th>BH</th><th>BMB</th><th>ODB</th><th>AGF 6–8</th><th>Keskin AGF hareketi</th><th>Kazanan</th></tr></thead><tbody>${recent||'<tr><td colspan="10" class="empty">Henüz doğrulanabilir yarış-öncesi cohort snapshotı yok.</td></tr>'}</tbody></table></div></div>`;
  }
  async function backfillUi(){
    const target=currentDb();const races=Array.isArray(target?.races)?target.races:[];
    const result=await historicalBackfillAsync(races,{db:target,limit:10000});
    try{if(typeof global.tkpRefreshLearningCache==='function')global.tkpRefreshLearningCache(true);else if(typeof global.tkpPrepareLearningTables==='function')global.tkpPrepareLearningTables();}catch(_e){}
    try{global.alert?.(`Sürpriz cohort araştırma snapshotı: ${result.created||0} koşu eklendi. Canlı terfi kapalıdır.`);}catch(_e){}
    return result;
  }

  global.TKP_SURPRISE_COHORT_TRACKER_VERSION=VERSION;
  global.tkpSurpriseCohortLog=logFor;
  global.tkpSurpriseCohortRaceKey=raceKey;
  global.tkpSurpriseCohortCaptureLive=liveCapture;
  global.tkpSurpriseCohortResolve=resolveBatch;
  global.tkpSurpriseCohortSync=sync;
  global.tkpSurpriseCohortBackfillHistorical=historicalBackfill;
  global.tkpSurpriseCohortBackfillHistoricalAsync=historicalBackfillAsync;
  // Genel tarihsel snapshot API'si uygulamanın kendi at/puan backfill'i için
  // ayrıdır. Bu ad, cohort araştırmasını yalnız açık çağrıyla başlatır ve onu
  // yanlışlıkla açılış migrasyonuna bağlamaz.
  global.tkpScheduleSurpriseCohortHistoricalBackfill=scheduleHistoricalBackfill;
  global.tkpSurpriseCohortStats=stats;
  global.tkpSurpriseCohortTrackingHTML=trackingHtml;
  global.tkpSurpriseCohortBackfillHistoricalUI=backfillUi;
})(typeof window!=='undefined'?window:globalThis);
