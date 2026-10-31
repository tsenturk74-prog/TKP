/*
 * TKP — Commentator / Kulis evidence governance
 *
 * A commentator signal is not a score source by itself.  This module keeps the
 * immutable pre-race evidence separately from the prediction score, evaluates
 * it only after the official result is known, and deliberately requires a
 * human approval after a sufficiently large live sample.  Historical records
 * remain useful research, but can never promote a source to live use.
 */
(function(global){
  'use strict';

  const VERSION='V1-COMMENTATOR-LIVE-LOCK-GOVERNANCE';
  const SCHEMA_VERSION=1;
  const MIN_LIVE_AUTHOR_RACE_EVENTS=100;
  const AUTO_PROMOTE_MIN_EDGE_LOWER=.02;
  // Y.PUAN içindeki küçük, otomatik yazar kalibrasyonu için daha erken fakat
  // güvenli eşik. Bu katman kuponu/TEK'i zorlayamaz; yalnız eşit yazar oyunu
  // geçmişteki doğrulanmış canlı başarıya göre %85-%125 aralığında düzeltir.
  const MIN_CALIBRATION_EVENTS=20;
  const MAX_EXPERT_WEIGHT=.18;
  const MAX_EXPERT_RANK_BOOST=8;
  const isLiveEvidenceClass=value=>value==='LIVE_PRE_RACE_LOCKED'||value==='LIVE_LATE_CAPTURE_ACCEPTED';
  let indexedLog=null;
  let indexedLength=-1;
  let raceIndex=new Map();
  let governanceRevision=0;
  // A coupon run prepares the verified index cooperatively. Keep it for later
  // side-bet/weekly reads; revision, row identity and settings guard staleness.
  let couponReadCache=null;
  function couponCacheCurrent(cache=couponReadCache){
    return !!cache && cache.rows===log() && cache.length===cache.rows.length
      && cache.revision===governanceRevision && cache.settings===settings();
  }
  async function prepareCouponReadCache(options={}){
    const rows=log(),cache={rows,length:rows.length,revision:governanceRevision,
      settings:settings(),valid:[],byAuthor:new Map(),byRace:new Map(),reports:new Map(),groups:new Map()};
    const pause=options.pause||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    couponReadCache=null;
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      if(isLiveEvidenceClass(row?.evidence_class)){
        if(isIntegrityValid(row)){
          cache.valid.push(row);
          const authorKey=JSON.stringify([row.source_type,row.author_id]);
          if(!cache.byAuthor.has(authorKey))cache.byAuthor.set(authorKey,[]);
          cache.byAuthor.get(authorKey).push(row);
          const race=text(row.race_key);
          if(!cache.byRace.has(race))cache.byRace.set(race,[]);
          cache.byRace.get(race).push(row);
        }else{try{row.integrity='HASH_MISMATCH';}catch(_){}}
      }
      if((i&31)===31){await pause();if(!couponCacheCurrent(cache))return null;}
    }
    if(!couponCacheCurrent(cache))return null;
    couponReadCache=cache;
    return cache;
  }
  // Okuma önbelleği yalnız kupon koşusunda değil, her okumada kullanılır: doğrulanmış satır dizini ve
  // yazar raporları revizyon/uzunluk/ayar değişmedikçe yeniden hesaplanmaz (tahmin başına tam tarama yok).
  function ensureReadCache(){
    if(couponCacheCurrent())return couponReadCache;
    const rows=log(),cache={rows,length:rows.length,revision:governanceRevision,
      settings:settings(),valid:[],byAuthor:new Map(),byRace:new Map(),reports:new Map(),groups:new Map()};
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      if(!isLiveEvidenceClass(row?.evidence_class))continue;
      if(isIntegrityValid(row)){
        cache.valid.push(row);
        const authorKey=JSON.stringify([row.source_type,row.author_id]);
        if(!cache.byAuthor.has(authorKey))cache.byAuthor.set(authorKey,[]);
        cache.byAuthor.get(authorKey).push(row);
        const race=text(row.race_key);
        if(!cache.byRace.has(race))cache.byRace.set(race,[]);
        cache.byRace.get(race).push(row);
      }else{try{row.integrity='HASH_MISMATCH';}catch(_){}}
    }
    couponReadCache=cache;
    return cache;
  }
  function releaseCouponReadCache(cache){if(couponReadCache===cache&&!couponCacheCurrent(cache))couponReadCache=null;}

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,number(value,min)));
  const fold=value=>text(value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9@:_./-]+/g,' ').trim();
  const horseNo=horse=>text(horse?.horse_no??horse?.no??horse?.at_no).match(/^\d+/)?.[0]||text(horse?.horse_no??horse?.no??horse?.at_no);

  function currentDb(){
    try{return typeof db!=='undefined'&&db&&typeof db==='object'?db:(global.db&&typeof global.db==='object'?global.db:null);}catch(_){return null;}
  }
  function log(){
    const target=currentDb();
    if(!target)return [];
    if(!Array.isArray(target.commentator_evidence_log))target.commentator_evidence_log=[];
    return target.commentator_evidence_log;
  }
  function settings(){
    const target=currentDb();
    if(!target)return {};
    if(!target.settings||typeof target.settings!=='object')target.settings={};
    return target.settings;
  }
  function safeDate(value){
    const ms=Date.parse(text(value));
    return Number.isFinite(ms)?new Date(ms).toISOString():'';
  }
  function eventHash(value){
    let hash=2166136261>>>0;
    const raw=String(value??'');
    for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}
    return `fnv1a32:${(hash>>>0).toString(16).padStart(8,'0')}`;
  }
  function stable(value){
    if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value??null);
  }
  function sourceId(value){return text(value).slice(0,2048);}
  function canonicalSource(value){
    const out=fold(value).replace(/\s+/g,'_').slice(0,96);
    return out||'unknown';
  }
  function canonicalAuthor(value,source){
    const raw=text(value);
    const normalized=fold(raw).replace(/\s+/g,'_').slice(0,160);
    if(!normalized)return '';
    if(canonicalSource(source)==='tkp_baseline'&&normalized==='tkp:baseline')return normalized;
    if(/^(?:(?:liderform\s*)?(?:uzman[ıi]?|yorumcu|editor|author|yazar|tahminci)|anon(?:ymous)?|unknown|bilinmiyor|undefined|null|none|source|hesap|account|x|twitter)$/i.test(normalized))return '';
    // Parser-generated "kind-1" / "source-2" labels are not an author identity.
    if(/^(?:[a-z]+[_:-]?)?\d+$/.test(normalized)||/^(?:kind|source|card|yorumcu|uzman|editor|author)[_:-]?\d+$/i.test(normalized))return '';
    // A ready-coupon feed, site editor label or unverified X card is a source,
    // not an identifiable commentator.  It can remain a normal YPUAN input, but
    // may never earn Kulis evidence, review status or a Kulis single.
    if(/(?:^|[:_-])(?:ready_?coupon|editor_?ready_?coupon|unverified_?card|site_?feed|official_?feed)(?:$|[:_-])/i.test(normalized))return '';
    return normalized;
  }
  function raceStartAt(race,context={}){
    const direct=context.race_start_at??context.raceStartAt??race?.race_start_at??race?.start_at??race?.race_start??race?.start_time_iso;
    const parsed=safeDate(direct);if(parsed)return parsed;
    try{
      if(typeof global.tkpPredictionSnapshotRaceStartAt==='function'){
        const value=global.tkpPredictionSnapshotRaceStartAt(race||{},context?.parsed||{},false);
        const normalized=safeDate(value);if(normalized)return normalized;
      }
    }catch(_){ }
    return '';
  }
  function raceKey(race,index=0){
    const exact=text(race?.race_uid||race?.id);
    if(exact)return exact;
    return [text(race?.meeting_uid||race?.file_id),text(race?.race_date||race?.date),fold(race?.hippodrome),number(race?._absRaceNo??race?.race_no??race?.leg,index+1),number(race?.leg,index+1)].join('|');
  }
  function raceRef(race,index=0){
    return {
      race_key:raceKey(race,index),race_uid:text(race?.race_uid||race?.id),meeting_uid:text(race?.meeting_uid||race?.file_id),
      race_date:text(race?.race_date||race?.date),hippodrome:fold(race?.hippodrome),altili_no:Math.max(1,number(race?.altili_no,1)),
      leg:Math.max(1,number(race?.leg??race?.race_no,index+1))
    };
  }
  function historicalRace(race,context={}){
    return context?.mode==='historical'||context?.historical===true||context?.historicalMode===true
      ||number(race?.historical_backfill)===1||/HISTORICAL|ARCHIVE|RECONSTRUCTED/i.test(text(race?.historical_provenance));
  }
  function resultKnown(race){
    return (race?.horses||[]).some(h=>number(h?.winner)===1||number(h?.finish_position)>0);
  }
  function immutablePayload(record){
    const payload={
      schema_version:SCHEMA_VERSION,source_type:record.source_type,source_id:record.source_id,author_id:record.author_id,
      author_race_key:record.author_race_key,race_key:record.race_key,race_uid:record.race_uid,meeting_uid:record.meeting_uid,
      race_date:record.race_date,hippodrome:record.hippodrome,altili_no:record.altili_no,leg:record.leg,
      evidence_class:record.evidence_class,captured_at:record.captured_at,published_at:record.published_at,race_start_at:record.race_start_at,
      direction:record.direction,selections:(record.selections||[]).map(String).sort(),selection_refs:(record.selection_refs||[]).map(String).sort(),
      runner_count:record.runner_count
    };
    // Keep old immutable hashes readable; new collector-bound events include the
    // SHA explicitly, while a pre-schema row has no synthetic null field added.
    if(text(record?.source_sha256))payload.source_sha256=text(record.source_sha256).toLowerCase();
    return payload;
  }
  // HIZ KÖK FIX: her kontrol stable()+FNV hash'i ile satırı baştan serileştiriyordu ve tek bir tahmin
  // hesabında (at × yazar × tüm kayıt) yüz binlerce kez çağrılıyordu (12 bin satırlık gerçek yedekte
  // ilk tahmin ~150 sn ana thread'i kilitledi). Sonuç satır başına, hash'e giren TÜM alanların ucuz
  // parmak izine bağlı olarak saklanır: bir alan değişirse parmak izi değişir ve hash yeniden doğrulanır
  // (kurcalama tespiti korunur); değişmeyen satır tekrar hash'lenmez.
  const integrityMemo=new WeakMap();
  function integrityFingerprint(r){
    return [r.immutable_snapshot_hash,r.source_type,r.source_id,r.author_id,r.author_race_key,r.race_key,r.race_uid,r.meeting_uid,
      r.race_date,r.hippodrome,r.altili_no,r.leg,r.evidence_class,r.captured_at,r.published_at,r.race_start_at,r.direction,
      Array.isArray(r.selections)?r.selections.join(','):'',Array.isArray(r.selection_refs)?r.selection_refs.join(','):'',r.runner_count,r.source_sha256,r.schema_version].join('\u0001');
  }
  function isIntegrityValid(record){
    if(!record||typeof record!=='object')return false;
    if(text(record.immutable_snapshot_hash)==='')return false;
    const fp=integrityFingerprint(record),memo=integrityMemo.get(record);
    if(memo&&memo.fp===fp)return memo.ok;
    const ok=record.immutable_snapshot_hash===eventHash(stable(immutablePayload(record)));
    integrityMemo.set(record,{fp,ok});
    return ok;
  }
  function collectorSourceFor(source){return canonicalSource(source)==='atyarisi'?'editor':canonicalSource(source);}
  function collectorProofValid(context,source,sourceRef,sourceSha,capturedAt){
    if(context?.require_collector_provenance!==true)return true;
    const proof=context?.collector_provenance;
    const expectedSource=collectorSourceFor(source),hash=text(sourceSha).toLowerCase();
    const capturedMs=Date.parse(String(capturedAt||'')),proofCaptured=Date.parse(String(proof?.captured_at||''));
    return !!proof&&proof.immutable_snapshot===true&&String(proof?.phase||'').toLowerCase()==='pre_race'
      &&canonicalSource(proof?.source)===expectedSource&&/^[a-f0-9]{64}$/.test(hash)
      &&sourceRef===`collector:${expectedSource}:${hash}`&&String(proof?.source_id||'')===sourceRef
      &&String(proof?.sha256||'').toLowerCase()===hash&&Number.isFinite(capturedMs)&&capturedMs===proofCaptured;
  }
  function timingClass({race,context,author,source,sourceRef,sourceSha,publishedAt,capturedAt}){
    const lateCollectionAccepted=context?.normal_time_collection===true||context?.late_collection_accepted===true;
    if(historicalRace(race,context)||resultKnown(race)&&!lateCollectionAccepted)return 'HISTORICAL_RESEARCH';
    const start=safeDate(raceStartAt(race,context));
    const captured=safeDate(capturedAt);
    const published=safeDate(publishedAt);
    const startMs=Date.parse(start),capturedMs=Date.parse(captured),publishedMs=Date.parse(published);
    if(!canonicalAuthor(author,source)||!sourceId(sourceRef)||!collectorProofValid(context,source,sourceRef,sourceSha,capturedAt)||!Number.isFinite(startMs)||!Number.isFinite(capturedMs)||!Number.isFinite(publishedMs))return 'UNVERIFIED_SHADOW';
    // A source captured after the start, or a post published after the start, has no
    // predictive standing.  Very old payloads are also rejected as stale evidence.
    if(capturedMs>=startMs&&!lateCollectionAccepted||publishedMs>=startMs&&!lateCollectionAccepted||capturedMs<startMs-48*60*60*1000||publishedMs<startMs-72*60*60*1000)return 'UNVERIFIED_SHADOW';
    return 'LIVE_PRE_RACE_LOCKED';
  }
  function appendEvidence(input={}){
    const race=input.race||{};
    const ref=raceRef(race,input.index||0);
    const source=canonicalSource(input.source_type||input.source||'unknown');
    const author=canonicalAuthor(input.author_id??input.author,source);
    const selections=[...new Set((input.selections||[]).map(value=>text(value).match(/^\d+/)?.[0]||text(value)).filter(Boolean))].sort((a,b)=>TKP_TR_COLLATOR_NUM.compare(a,b));
    const runners=Math.max(selections.length,number(input.runner_count,(race?.horses||[]).filter(h=>!/(?:KOŞMAZ|KOSMAZ|NON.?RUNNER|SCRATCH)/i.test(text(h?.horse_name||h?.status))).length));
    const captured=safeDate(input.captured_at??input.capturedAt);
    const published=safeDate(input.published_at??input.publishedAt??input.captured_at??input.capturedAt);
    const start=safeDate(raceStartAt(race,{...input,raceStartAt:input.race_start_at??input.raceStartAt}));
    const sourceRef=sourceId(input.source_id??input.sourceId);
    const sourceSha=text(input.source_sha256??input.sourceSha256).toLowerCase();
    const evidenceClass=timingClass({race,context:input,author,source,sourceRef,sourceSha,publishedAt:published,capturedAt:captured});
    const record={
      schema_version:SCHEMA_VERSION,id:`CE-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
      source_type:source,source_id:sourceRef,source_sha256:sourceSha,author_id:author||'UNVERIFIED',
      ...ref,author_race_key:[source,author||'UNVERIFIED',ref.race_key].join('|'),
      evidence_class:evidenceClass,captured_at:captured,published_at:published,race_start_at:start,
      direction:number(input.direction,1)>=0?1:-1,selections,selection_refs:[...new Set((input.selection_refs||input.selectionRefs||[]).map(sourceId).filter(Boolean))].sort(),
      runner_count:runners,created_at:new Date().toISOString(),integrity:'OK'
    };
    record.immutable_snapshot_hash=eventHash(stable(immutablePayload(record)));
    const rows=log();
    const duplicate=rows.some(item=>item?.immutable_snapshot_hash===record.immutable_snapshot_hash);
    if(duplicate)return {appended:0,record:null,duplicate:true};
    rows.push(record);indexedLength=-1;governanceRevision++;
    return {appended:1,record,duplicate:false};
  }
  function eventRaceIndex(){
    const rows=log();
    if(indexedLog===rows&&indexedLength===rows.length)return raceIndex;
    const next=new Map();
    rows.forEach((row,index)=>{
      const key=text(row?.race_key);if(!key)return;
      const bucket=next.get(key)||[];bucket.push(index);next.set(key,bucket);
    });
    indexedLog=rows;indexedLength=rows.length;raceIndex=next;
    return raceIndex;
  }
  function validLiveRows(source=null,author=null){
    const src=source==null?null:canonicalSource(source),who=author==null?null:canonicalAuthor(author,src||'');
    const cached=ensureReadCache();
    if(cached){
      if(src!==null&&who!==null)return cached.byAuthor.get(JSON.stringify([src,who]))||[];
      return cached.valid.filter(row=>(src===null||row.source_type===src)&&(who===null||row.author_id===who));
    }
    return log().filter(row=>{
      if(!isLiveEvidenceClass(row?.evidence_class))return false;
      if(!isIntegrityValid(row)){try{row.integrity='HASH_MISMATCH';}catch(_){ }return false;}
      if(src&&row.source_type!==src)return false;
      if(who&&row.author_id!==who)return false;
      return true;
    });
  }
  function groupedLiveRows(source=null,author=null){
    const groups=new Map();
    for(const row of validLiveRows(source,author)){
      const key=text(row.author_race_key);if(!key)continue;
      const group=groups.get(key)||{rows:[],key};group.rows.push(row);groups.set(key,group);
    }
    return [...groups.values()];
  }
  function groupEvaluation(group){
    const rows=group?.rows||[];
    const resolved=rows.filter(row=>row?.resolution&&text(row.resolution.winner_no));
    if(!resolved.length)return null;
    const winner=text(resolved[0].resolution.winner_no);
    const direction=number(rows[0]?.direction,1)>=0?1:-1;
    const selections=[...new Set(rows.flatMap(row=>row.selections||[]).map(String))];
    const runners=Math.max(1,...rows.map(row=>number(row.runner_count,0)));
    const selected=selections.includes(winner);
    const observed=direction>0?(selected?1:0):(selected?0:1);
    const expectedRaw=Math.min(1,selections.length/Math.max(1,runners));
    const expected=direction>0?expectedRaw:1-expectedRaw;
    return {observed,expected,winner,selections,runners,direction};
  }
  function wilsonLower(wins,total,z=1.96){
    const n=Math.max(0,number(total));if(!n)return 0;
    const p=clamp(number(wins)/n,0,1),z2=z*z,den=1+z2/n;
    return clamp((p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/den,0,1);
  }
  function approvalMap(){
    const s=settings();
    if(!s.commentator_manual_approvals||typeof s.commentator_manual_approvals!=='object')s.commentator_manual_approvals={};
    return s.commentator_manual_approvals;
  }
  function approvalKey(source,author){return `${canonicalSource(source)}|${canonicalAuthor(author,source)}`;}
  function isApproved(source,author){return approvalMap()[approvalKey(source,author)]===true;}
  function performance(source,author){
    const src=canonicalSource(source),who=canonicalAuthor(author,src);
    const cached=ensureReadCache(),key=JSON.stringify([src,who]);
    if(cached?.reports.has(key))return {...cached.reports.get(key)};
    const groups=groupedLiveRows(src,who);
    const evaluated=groups.map(groupEvaluation).filter(Boolean);
    const events=evaluated.length,wins=evaluated.reduce((sum,item)=>sum+item.observed,0),expected=events?evaluated.reduce((sum,item)=>sum+item.expected,0)/events:0;
    const singleEvaluated=evaluated.filter(item=>item.direction>0&&item.selections.length===1),singleEvents=singleEvaluated.length,singleWins=singleEvaluated.reduce((sum,item)=>sum+item.observed,0),singleExpected=singleEvents?singleEvaluated.reduce((sum,item)=>sum+item.expected,0)/singleEvents:0,singleAccuracy=singleEvents?singleWins/singleEvents:0;
    const accuracy=events?wins/events:0,lower=wilsonLower(wins,events),edge=accuracy-expected,edgeLower=lower-expected;
    const reviewed=events>=MIN_LIVE_AUTHOR_RACE_EVENTS;
    // V1.1.337 (kullanıcı talebi): elle onay yerine kanıta bağlı OTOMATİK terfi. Yazar >=100 doğrulanmış
    // canlı olay VE rastgele beklentinin (genişlik/saha büyüklüğüne göre) Wilson alt sınırı en az %2 üstünde
    // ise ACTIVE olur; kanıt bozulup alt sınır eşiğin altına inerse kendiliğinden REVIEW'a döner (otomatik
    // geri çekilme). approvalMap()[key]===false elle dışlamadır ve her zaman kazanır.
    const manualDeny=approvalMap()[approvalKey(src,who)]===false;
    const autoQualified=reviewed&&!manualDeny&&edgeLower>=AUTO_PROMOTE_MIN_EDGE_LOWER;
    const approved=!manualDeny&&(isApproved(src,who)||autoQualified);
    const state=!reviewed?'SHADOW':approved?'ACTIVE':'REVIEW';
    const report={version:VERSION,source_type:src,author_id:who,events,wins,accuracy,expected_accuracy:expected,edge,lower_bound:lower,edge_lower_bound:edgeLower,single_events:singleEvents,single_wins:singleWins,single_accuracy:singleAccuracy,single_expected_accuracy:singleExpected,single_edge:singleAccuracy-singleExpected,
      single_lower_bound:wilsonLower(singleWins,singleEvents),single_skill:singleEvents?Math.max(0,wilsonLower(singleWins,singleEvents)-singleExpected):0,
      avg_width:evaluated.filter(item=>item.direction>0).length?evaluated.filter(item=>item.direction>0).reduce((sum,item)=>sum+item.selections.length,0)/evaluated.filter(item=>item.direction>0).length:0,
      state,reviewed,manual_approved:approved,minimum_events:MIN_LIVE_AUTHOR_RACE_EVENTS,automatic_promotion:autoQualified,auto_min_edge_lower:AUTO_PROMOTE_MIN_EDGE_LOWER};
    if(cached)cached.reports.set(key,report);
    return {...report};
  }
  function calibrationWeight(source,author,{single=false}={}){
    const report=performance(source,author);
    // R16.2: tek bir sonuçlanmış olay bile değerlendirmeye girer. Küçük örneklem
    // dışlanmaz; Bayesian-benzeri güven küçültmesiyle etkisi doğal olarak küçük kalır.
    if(report.events<=0)return 1;
    let edge=report.edge,reliability=report.events/(report.events+40);
    if(single&&report.single_events>=10){
      const singleReliability=report.single_events/(report.single_events+25);
      edge=.65*report.single_edge+.35*report.edge;
      reliability=Math.max(reliability*.6,singleReliability);
    }
    return Math.round(clamp(1+edge*reliability*1.5,.85,1.25)*1000)/1000;
  }
  function weight(source,author){
    const report=performance(source,author);
    if(report.state==='ACTIVE'&&report.events>=MIN_LIVE_AUTHOR_RACE_EVENTS&&report.edge_lower_bound>0){
      // Elle onaylanmış, büyük örnekli yazar için eski üst güvenlik kapısı korunur.
      return Math.round(Math.min(MAX_EXPERT_WEIGHT,.04+report.edge_lower_bound*.8+Math.min(.05,(report.events-MIN_LIVE_AUTHOR_RACE_EVENTS)/5000))*1000)/1000;
    }
    // Kullanıcı kararı: bütün hazır-kupon sitelerindeki başarılı yazarlar Uzman +
    // Kulis'te otomatik öne alınır. 20 canlı/sonuçlanmış olaydan önce sıfırdır;
    // sonrasında yalnız şanstan beklenen isabetin üstündeki performans ve örnek
    // güvenilirliği kullanılır. Otomatik katkı %10 ile sınırlıdır ve Champion'ı,
    // program verisini veya ham puanı tek başına değiştiremez.
    if(report.events<=0)return 0;
    const reliability=report.events/(report.events+40),skill=Math.max(0,report.edge*reliability);
    // Az örneklemde katkı sıfırlanmaz; güven küçültmesi ile milimetrik kalır.
    if(skill<=0)return 0;
    return Math.round(Math.min(.10,.002+skill*.6)*1000)/1000;
  }
  function activeGroupForRace(race){
    const key=raceKey(race);
    const cached=ensureReadCache();
    if(cached?.groups.has(key))return cached.groups.get(key);
    const rows=log(),groups=new Map();
    const candidates=cached?(cached.byRace.get(key)||[]):(eventRaceIndex().get(key)||[]).map(index=>rows[index]);
    for(const row of candidates){
      if(!cached&&(!isLiveEvidenceClass(row?.evidence_class)||!isIntegrityValid(row)))continue;
      const w=weight(row.source_type,row.author_id);if(w<=0)continue;
      const groupKey=`${row.source_type}|${row.author_id}`;
      const group=groups.get(groupKey)||{source_type:row.source_type,author_id:row.author_id,weight:w,performance:performance(row.source_type,row.author_id),rows:[]};group.rows.push(row);groups.set(groupKey,group);
    }
    const result=[...groups.values()];
    if(cached)cached.groups.set(key,result);
    return result;
  }
  function consensus(race,horse){
    const target=horseNo(horse);if(!target)return {available:false,score:null,authors:0,total:0,positive:0,top2:0,single:0,omissions:0,limited_boost:0,single_eligible:false,comments:[]};
    const groups=activeGroupForRace(race);let totalWeight=0,supportWeight=0,singleWeight=0,positive=0,top2=0,single=0;
    // Tek isabet ve at kapsama (ortalama seçim genişliği) kullanımı: yalnız yarış-öncesi kilitli kanıttan
    // gelen performance() değerleri kullanılır; yarış sonrası/zamansız kayıtlar bu hesaba girmez.
    let skilledSingle=false,singleSampled=false,narrowBonus=0,omitWeight=0;
    const comments=[];
    for(const group of groups){
      const selections=[...new Set(group.rows.flatMap(row=>row.selections||[]).map(String))];
      if(!selections.length)continue;
      totalWeight+=group.weight;
      const selected=selections.includes(target);
      if(selected){
        supportWeight+=group.weight;positive++;
        const minWidth=Math.min(...group.rows.map(row=>(row.selections||[]).length));
        if(minWidth<=2)top2++;
        const perf=group.performance||{};
        // Dar seçim, yazarın alışkın olduğu kapsamdan ne kadar darsa o kadar güçlü sinyaldir (sınırlı).
        if(perf.events>=MIN_CALIBRATION_EVENTS&&perf.avg_width>0&&minWidth<perf.avg_width&&perf.edge>0)
          narrowBonus+=group.weight*(clamp(Math.sqrt(perf.avg_width/minWidth),1,1.5)-1);
        if(minWidth===1){
          single++;
          const sampled=perf.single_events>=8;
          if(sampled)singleSampled=true;
          // Tek oynadığında şansı yenen yazarın ağırlığı büyür; yenemeyenin küçülür.
          const factor=sampled?clamp(perf.single_skill>0?1+perf.single_skill*10:.6,.6,2):1;
          if(sampled&&perf.single_skill>0)skilledSingle=true;
          singleWeight+=group.weight*factor;
        }
        comments.push({source:group.source_type,author:group.author_id,score:Math.round((50+group.weight*100)*10)/10,value:Math.round(group.weight*1000)/10,direction:1,selection_count:minWidth,approved:group.performance?.manual_approved===true,automatic_calibration:group.performance?.manual_approved!==true,events:group.performance?.events||0,accuracy:group.performance?.accuracy||0,edge:group.performance?.edge||0});
      }
    }
    if(!totalWeight)return {available:false,score:null,authors:0,total:0,positive:0,top2:0,single:0,omissions:0,limited_boost:0,single_eligible:false,comments:[]};
    const ratio=supportWeight/totalWeight;
    // Geniş kapsamlı ve güvenilir (şansın üstünde) yazarın bu atı dışarıda bırakması hafif olumsuz kanıttır.
    for(const group of groups){
      const selections=[...new Set(group.rows.flatMap(row=>row.selections||[]).map(String))];
      if(!selections.length||selections.includes(target))continue;
      const perf=group.performance||{};
      if(perf.events>=30&&perf.avg_width>=4&&perf.edge_lower_bound>0)omitWeight+=group.weight*Math.min(1,perf.edge_lower_bound*3);
    }
    const rawBoost=MAX_EXPERT_RANK_BOOST*ratio+Math.min(2,singleWeight*8)+Math.min(1.5,narrowBonus*6)-Math.min(2,omitWeight*6);
    const boost=Math.round(clamp(rawBoost,0,MAX_EXPERT_RANK_BOOST)*10)/10;
    return {available:supportWeight>0,score:Math.round((50+boost)*10)/10,authors:groups.length,total:groups.length,positive,top2,single,omissions:Math.max(0,groups.length-positive),ratio,
      limited_boost:boost,single_eligible:singleWeight>0&&ratio>=.5&&(!singleSampled||skilledSingle),narrow_bonus:Math.round(narrowBonus*1000)/1000,omission_weight:Math.round(omitWeight*1000)/1000,comments};
  }
  function resolveResults(races){
    const rows=log();let changed=0;
    for(const item of races||[]){
      const race=item?.r||item;if(!race)continue;
      const winner=(race.horses||[]).find(h=>number(h?.winner)===1||number(h?.finish_position)===1);if(!winner)continue;
      const winnerNo=horseNo(winner);if(!winnerNo)continue;
      const indexes=eventRaceIndex().get(raceKey(race))||[];
      for(const index of indexes){
        const row=rows[index];if(!row||row.resolution)continue;
        if(!isIntegrityValid(row)){row.integrity='HASH_MISMATCH';continue;}
        const selections=(row.selections||[]).map(String),selected=selections.includes(winnerNo),direction=number(row.direction,1)>=0?1:-1;
        const expectedRaw=Math.min(1,selections.length/Math.max(1,number(row.runner_count,(race.horses||[]).length)));
        row.resolution={resolved_at:new Date().toISOString(),winner_no:winnerNo,selected_winner:selected?1:0,observed:direction>0?(selected?1:0):(selected?0:1),expected_probability:direction>0?expectedRaw:1-expectedRaw};
        changed++;
      }
    }
    if(changed)governanceRevision++;
    return changed;
  }
  function captureX(payload,races,context={}){
    const resultRows=Array.isArray(context?.results)?context.results:[];
    const byAuthorRace=new Map();
    for(const item of resultRows){
      const race=(races||[])[number(item?.raceIndex,-1)]||item?.race;if(!race)continue;
      for(const comment of item?.comments||[]){
        const author=canonicalAuthor(comment?.author,'x');
        const direction=number(comment?.direction,1)>=0?1:-1;
        const key=[raceKey(race),author||'UNVERIFIED',direction].join('|');
        const group=byAuthorRace.get(key)||{race,author,direction,selections:new Set(),refs:new Set(),published:[],runner_count:(race.horses||[]).length};
        group.selections.add(horseNo(item?.horse||item));
        const ref=sourceId(comment?.url||comment?.post_id);if(ref)group.refs.add(ref);
        group.published.push(comment?.datetime);
        byAuthorRace.set(key,group);
      }
    }
    let appended=0;
    for(const group of byAuthorRace.values()){
      const refs=[...group.refs];
      const out=appendEvidence({race:group.race,source_type:'x',source_id:refs.join('|'),author_id:group.author,captured_at:payload?.capturedAt,published_at:group.published.filter(Boolean).sort()[0]||'',race_start_at:(payload?.raceStartMap||{})[String(group.race?.leg)]||payload?.raceStartAt,
        selections:[...group.selections],selection_refs:refs,runner_count:group.runner_count,direction:group.direction,mode:context?.mode,historicalMode:payload?.historicalMode===true,normal_time_collection:true});
      appended+=out.appended;
    }
    return {appended,groups:byAuthorRace.size};
  }
  function captureCards(cards,context={}){
    const races=Array.isArray(context?.races)?context.races:[];let appended=0;
    for(const card of cards||[]){
      const source=canonicalSource(card?.source||card?.kind||context?.source_type||'commentator');
      const author=canonicalAuthor(card?.author,source);
      for(const leg of card?.legs||[]){
        const no=number(leg?.raceNo??leg?.relativeLeg,0);
        const race=races.find((row,index)=>number(row?._absRaceNo??row?.race_no??row?.leg,index+1)===no)||races.find(row=>number(row?.leg)===no);
        if(!race)continue;
        // A collector context carries the canonical content-SHA source id.  It
        // deliberately wins over an HTML link embedded in the card, which is
        // mutable and cannot prove the exact pre-race payload that was seen.
        const refs=[sourceId(context?.source_id||card?.source_id||card?.url||context?.fileName)].filter(Boolean);
        const out=appendEvidence({race,source_type:source,source_id:refs.join('|'),source_sha256:card?.source_sha256??context?.source_sha256,author_id:author,captured_at:card?.captured_at??context?.captured_at??context?.capturedAt,published_at:card?.published_at??card?.captured_at??context?.published_at??context?.captured_at??context?.capturedAt,
          race_start_at:raceStartAt(race,context),selections:leg?.picks||[],selection_refs:refs,runner_count:(race.horses||[]).length,direction:1,mode:context?.mode,historical:context?.historical===true||historicalRace(race,context),collector_provenance:context?.collector_provenance,require_collector_provenance:true});
        appended+=out.appended;
      }
    }
    return {appended};
  }
  function captureTkpBaseline(raceResults,context={}){
    let appended=0;
    for(const [index,item] of (raceResults||[]).entries()){
      const race=item?.r||item;if(!race)continue;
      const pool=(item?.scored&&item.scored.length?item.scored:race.horses||[]).filter(Boolean);
      let ordered=[];
      try{if(typeof global.altiliWinnerOrderForRace==='function')ordered=global.altiliWinnerOrderForRace(race,pool)||[];}catch(_){ }
      if(!ordered.length)ordered=pool.slice().sort((a,b)=>{
        let av=number(a?.score),bv=number(b?.score);
        try{if(typeof global.altiliWinnerScoreForHorse==='function'){av=number(global.altiliWinnerScoreForHorse(race,a));bv=number(global.altiliWinnerScoreForHorse(race,b));}}catch(_){ }
        return bv-av;
      });
      const leader=ordered[0];if(!leader)continue;
      // The same system snapshot may be rendered repeatedly before a race; own
      // baseline is one immutable author-race observation, not a counter that can
      // be inflated by refreshes.
      const baselineKey=`tkp_baseline|tkp:baseline|${raceKey(race,index)}`;
      if(log().some(row=>row?.author_race_key===baselineKey))continue;
      const start=raceStartAt(race,{...context,index});
      const captured=safeDate(context?.captured_at??context?.capturedAt??new Date().toISOString());
      const out=appendEvidence({race,source_type:'tkp_baseline',source_id:`baseline:${raceKey(race,index)}`,author_id:'tkp:baseline',captured_at:captured,published_at:captured,race_start_at:start,selections:[horseNo(leader)],runner_count:pool.length,direction:1,mode:context?.mode,historical:historicalRace(race,context)||resultKnown(race)});
      appended+=out.appended;
    }
    return {appended};
  }
  function setApproval(source,author,approved){
    const src=canonicalSource(source),who=canonicalAuthor(author,src);if(!who)return false;
    approvalMap()[approvalKey(src,who)]=approved===true;governanceRevision++;
    return true;
  }
  function report(source=null,author=null){
    if(source!=null&&author!=null)return performance(source,author);
    // A report contains many authors. Without a read snapshot, each author
    // re-verifies the immutable hash of every event (authors × events) while
    // the Analytics tab is opening. Verify once, index by author, then reuse
    // the existing performance calculation without relaxing integrity checks.
    const previous=couponReadCache,hadCurrent=couponCacheCurrent();
    if(!hadCurrent){
      const rows=log(),valid=validLiveRows(),byAuthor=new Map();
      for(const row of valid){
        const key=JSON.stringify([row.source_type,row.author_id]);
        if(!byAuthor.has(key))byAuthor.set(key,[]);
        byAuthor.get(key).push(row);
      }
      couponReadCache={rows,length:rows.length,revision:governanceRevision,
        settings:settings(),valid,byAuthor,byRace:new Map(),reports:new Map(),groups:new Map()};
    }
    try{
      const seen=new Set(),out=[];
      for(const row of couponReadCache.valid){
        const key=`${row.source_type}|${row.author_id}`;if(seen.has(key))continue;seen.add(key);out.push(performance(row.source_type,row.author_id));
      }
      return out.sort((a,b)=>b.edge_lower_bound-a.edge_lower_bound||b.events-a.events);
    }finally{if(!hadCurrent)couponReadCache=previous;}
  }

  // Read-only observation lane. Never feeds weight(), consensus() or approvals.
  function* shadowReportSteps(){
    const target=currentDb(),rows=target?.commentator_evidence_log||[],races=target?.races||[];
    const byId=new Map(),byContext=new Map(),authors=new Map(),groups=new Map();
    const normalized=new Map(),identities=new Map(),raceContexts=new WeakMap();
    const folded=value=>{const raw=text(value);if(!normalized.has(raw))normalized.set(raw,fold(raw));return normalized.get(raw);};
    const contextKey=row=>{
      const date=text(row?.race_date||row?.date),city=folded(row?.hippodrome);
      const six=number(row?.altili_no),leg=number(row?.leg);
      return date&&city&&six>0&&leg>0?JSON.stringify([date,city,six,leg]):'';
    };
    const add=(map,key,race)=>{if(!key)return;const bucket=map.get(key)||new Set();bucket.add(race);map.set(key,bucket);};
    let processed=0;
    for(const race of races){
      if((++processed&15)===0)yield;
      for(const key of [race?.race_uid,race?.id])add(byId,text(key),race);
      const context=contextKey(race);raceContexts.set(race,context);add(byContext,context,race);
    }
    for(const row of rows){
      if((++processed&15)===0)yield;
      const rawIdentity=JSON.stringify([row?.source_type,row?.author_id]);
      let identityInfo=identities.get(rawIdentity);
      if(!identityInfo){const source=canonicalSource(row?.source_type);identityInfo={source,author:canonicalAuthor(row?.author_id,source)};identities.set(rawIdentity,identityInfo);}
      const {source,author}=identityInfo;
      if(!author||author==='unverified'||source==='tkp_baseline')continue;
      const key=JSON.stringify([source,author]);
      if(!authors.has(key))authors.set(key,{source_type:source,author_id:author,events:0,wins:0,
        single_events:0,single_wins:0,pending_events:0,unmatched_events:0,excluded_records:0,late_records:0,
        stored_events:0,selection_total:0,state:'OBSERVATION',new_bonus:0});
      const stats=authors.get(key);
      const start=Date.parse(row.race_start_at),captured=Date.parse(row.captured_at),published=Date.parse(row.published_at);
      // Bu rapor yalnız izleme amaçlıdır (weight()/consensus()/onay hattına girmez). Kullanıcı kararıyla
      // yarış öncesi/sonrası ve zaman damgasız tüm kayıtlar sayılır; yalnız bütünlük hash'i bozuk, yönü ≠ 1
      // veya seçimi boş kayıtlar dışlanır. Sıkı "yarış öncesi kilitli" kuralı kupon kararlarında aynen geçerlidir;
      // burada yarış öncesi kanıtı olmayanlar ayrıca late_records olarak sayılır.
      if(!isIntegrityValid(row)||number(row.direction)!==1||!(row.selections||[]).length){stats.excluded_records++;continue;}
      if(!isLiveEvidenceClass(row.evidence_class)||!Number.isFinite(start)||!Number.isFinite(captured)||!Number.isFinite(published))stats.late_records++;
      const identity=text(row.race_key),context=contextKey(row);
      const candidates=byId.get(identity)||byContext.get(context);
      const race=candidates?.size===1?[...candidates][0]:null;
      // Reject a recycled ID whose date/city/six/leg no longer agrees.
      const matched=race&&context&&raceContexts.get(race)===context?race:null;
      const actualNo=number(matched?._absRaceNo??matched?.race_no);
      const eventKey=matched&&actualNo>0?JSON.stringify([text(matched.race_date||matched.date),folded(matched.hippodrome),actualNo]):context||identity;
      const groupKey=JSON.stringify([key,eventKey]);
      const group=groups.get(groupKey)||{stats,race:matched,selections:new Set()};
      for(const pick of row.selections)group.selections.add(String(pick));
      groups.set(groupKey,group);
    }
    for(const {stats,race,selections} of groups.values()){
      if((++processed&15)===0)yield;
      stats.stored_events++;
      if(!race){stats.unmatched_events++;continue;}
      const roster=new Set((race.horses||[]).map(horseNo));
      if([...selections].some(pick=>!roster.has(pick))){stats.unmatched_events++;continue;}
      const official=race.result_integrity_status==='VERIFIED'&&number(race.result_verified_depth)>0
        &&/^TJK_OFFICIAL_(?:ORDERED_PAYOUT|RESULT_ROWS)$/.test(text(race.result_integrity_source));
      const winners=official?(race.horses||[]).filter(h=>number(h.winner)===1||number(h.finish_position)===1).map(horseNo):[];
      if(!winners.length){stats.pending_events++;continue;}
      const hit=winners.some(no=>selections.has(no))?1:0;
      stats.events++;stats.wins+=hit;stats.selection_total+=selections.size;
      if(selections.size===1){stats.single_events++;stats.single_wins+=hit;}
    }
    return [...authors.values()].map(stats=>{
      const {selection_total,...out}=stats;
      return {...out,accuracy:stats.events?stats.wins/stats.events:null,
        single_accuracy:stats.single_events?stats.single_wins/stats.single_events:null,
        avg_selections:stats.events?selection_total/stats.events:null,
        lower_bound:stats.events?wilsonLower(stats.wins,stats.events):null};
    }).sort((a,b)=>(b.lower_bound??-1)-(a.lower_bound??-1)||b.events-a.events
      ||a.source_type.localeCompare(b.source_type)||a.author_id.localeCompare(b.author_id));
  }

  function shadowReport(){
    const steps=shadowReportSteps();let step;
    do{step=steps.next();}while(!step.done);
    return step.value;
  }
  async function shadowReportAsync(options={}){
    const target=currentDb(),rows=target?.commentator_evidence_log,races=target?.races;
    const length=rows?.length,raceCount=races?.length,revision=governanceRevision;
    const pause=options.pause||global.tkpYieldToUi||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    for(const steps=shadowReportSteps();;){
      if(options.signal?.aborted)throw new Error('Yorumcu takip taramasi iptal edildi.');
      if(currentDb()!==target||target?.commentator_evidence_log!==rows||target?.races!==races
        ||rows?.length!==length||races?.length!==raceCount||governanceRevision!==revision)
        throw new Error('Takip verisi degisti; raporu yeniden acin.');
      const step=steps.next();if(step.done)return step.value;
      await pause();
    }
  }
  global.tkpCommentatorShadowReportAsync=shadowReportAsync;
  global.tkpCommentatorShadowReport=shadowReport;
  global.TKP_COMMENTATOR_GOVERNANCE_VERSION=VERSION;
  global.tkpCommentatorAppendEvidence=appendEvidence;
  global.tkpCommentatorCaptureX=captureX;
  global.tkpCommentatorCaptureCards=captureCards;
  global.tkpCommentatorCaptureTkpBaseline=captureTkpBaseline;
  global.tkpCommentatorResolveResults=resolveResults;
  global.tkpCommentatorPerformance=performance;
  global.tkpCommentatorPerformanceReport=report;
  global.tkpCommentatorWeight=weight;
  global.tkpCommentatorCalibrationWeight=calibrationWeight;
  global.tkpCommentatorConsensus=consensus;
  global.tkpPrepareCouponCommentatorCache=prepareCouponReadCache;
  global.tkpReleaseCouponCommentatorCache=releaseCouponReadCache;
  global.tkpCommentatorKulisSingleEligibility=(race,horse)=>consensus(race,horse).single_eligible===true;
  global.tkpSetCommentatorApproval=setApproval;
  global.tkpCommentatorEvidenceIntegrityValid=isIntegrityValid;
  global.tkpCommentatorGovernanceRevision=()=>governanceRevision;
})(globalThis);
