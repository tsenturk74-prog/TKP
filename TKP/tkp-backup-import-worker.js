'use strict';

// KÖK ÇÖZÜM (R16.4): Bu worker kendi dosyası her seferinde güncel
// TKP_RUNTIME_VERSION ile açılır (app-controller.js), ama daha önce burada
// tkp-segmented-idb.js SABİT bir eski sürüme (?v=1.1.317) bağlıydı. Tarayıcı
// o URL'yi eski bir kurulumdan önbelleğe aldıysa, worker güncel segmented
// IDB şemasını değil eski/uyumsuz kodu okur ve gerçek kayıtları 0 olarak
// görür -> ".tkbz yedek sayısı 0'a düşüyor" hatasının kök nedeni budur.
// Artık sürüm, bu worker'ın kendi URL'sindeki ?v= parametresinden dinamik
// okunur; iki script sürümü artık asla birbirinden sapamaz.
const __TKP_WORKER_VERSION=(function(){
  try{
    const params=new URLSearchParams(self.location.search);
    const v=params.get('v');
    return v?String(v):'1.1.333';
  }catch(_e){ return '1.1.333'; }
})();
importScripts('tkp-segmented-idb.js?v='+encodeURIComponent(__TKP_WORKER_VERSION));
try{importScripts('vendor/pako.min.js?v='+encodeURIComponent(__TKP_WORKER_VERSION));}catch(_){ }

let preparedDb=null;
let preparedMetrics=null;
let preparedPortable=null;
let preparedManifest=null;
let preparedFile=null;
let preparedSegmentedEnvelope=null;
let preparedInputFormat='gzip';
const MAX_SUPPORTED_SCHEMA_VERSION=6;
// V1.1.277: backupCounts()'un sabit listesiyle AYNI -- segmentli export/import'un
// hangi büyük koleksiyonları ayrı ayrı çerçeveleyeceğini belirler. Tek kaynaktan
// türetilir ki iki liste asla birbirinden sapmasın.
const TKP_SEGMENTED_BACKUP_COLLECTIONS=['files','races','bets','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log','bomb_hunter_shadow_log','changelog'];
const TKP_BACKUP_MAGIC='TKPB';
const TKP_SEGMENTED_FORMAT_VERSION=5;

function backupCounts(value){
  const keys=TKP_SEGMENTED_BACKUP_COLLECTIONS;
  const out={};
  // Sabit liste yalnız UI'da her zaman gösterilen alanları garanti eder; gelecekte
  // eklenen herhangi bir üst-seviye log dizisi de bütünlük kontrolüne otomatik girer.
  for(const [key,rows] of Object.entries(value||{}))if(Array.isArray(rows))out[key]=rows.length;
  for(const key of keys) if(!Object.prototype.hasOwnProperty.call(out,key))out[key]=0;
  return out;
}

// V1.1.225 HIZ MİMARİSİ SONRASI ÖĞRENME BOŞLUĞU FIX: Worker'a taşınan .tkpbak
// geri yükleme yolu, ana thread'deki resolvePredictionLogWithRaces() (stats-engine.js)
// bağlantısını hiç görmüyordu — worker'ın kendi izole scope'unda db/log/cache-invalidation
// gibi ana uygulama global'leri yok. Bu, restore edilen yedeklerde sonucu gerçekte mevcut
// ama prediction_log'da resolved=0 kalmış eski kayıtların P1-P5/Strateji Lab/haftalık model
// öğrenmesine hiç girmemesine yol açıyordu (gerçek yedekte doğrulandı: binlerce kayıt).
// Bu fonksiyon resolvePredictionLogWithRaces() ile AYNI eşleşme kuralını (leg + hipodrom +
// (tarih boşsa pas geç) + altılı no + at adı/no) kullanır, sadece tek-koşu değil TÜM
// restore edilen veri seti için toplu ve O(races+log) hızında çalışacak şekilde
// index'lenmiştir (worker'da tek seferlik çalıştığı için performans kritik).
function tkpFoldTr(s){
  return String(s??'').toLocaleUpperCase('tr-TR').trim();
}

function tkpWorkerChronology(dbObj){
  const files=Array.isArray(dbObj?.files)?dbObj.files:[],races=Array.isArray(dbObj?.races)?dbObj.races:[];
  const iso=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
  const raw=f=>{const a=Number(f?.raw_sequence_no),b=Number(f?.sequence_no);return Number.isFinite(a)&&a>0?a:(Number.isFinite(b)&&b>0?b:Number.MAX_SAFE_INTEGER);};
  files.sort((a,b)=>{const da=String(a?.race_date||''),db=String(b?.race_date||''),av=iso(da),bv=iso(db);if(av&&bv&&da!==db)return da<db?-1:1;if(av!==bv)return av?-1:1;return raw(a)-raw(b)||(Number(a?.altili_no)||1)-(Number(b?.altili_no)||1)||(Number(a?.id)||0)-(Number(b?.id)||0);});
  const byId=new Map();let maxId=0;
  for(let i=0;i<files.length;i++){const f=files[i],seq=i+1;if(!(Number(f.raw_sequence_no)>0))f.raw_sequence_no=Number(f.sequence_no)||seq;f.sequence_no=seq;f.archive_date_order=seq;f.sort_policy='DATE_ASC_SEQUENCE_RENUMBERED_RAW_RACE_NO_ASC_V1';byId.set(String(f.id),seq);maxId=Math.max(maxId,Number(f.id)||0);}
  for(const r of races){const seq=byId.get(String(r?.file_id));if(seq)r.sequence_no=seq;}
  for(const key of ['prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log','bets'])for(const row of (Array.isArray(dbObj?.[key])?dbObj[key]:[])){const seq=byId.get(String(row?.file_id));if(seq&&Object.prototype.hasOwnProperty.call(row,'sequence_no'))row.sequence_no=seq;}
  const endpoint=f=>({id:String(f?.id??''),race_date:String(f?.race_date||''),raw_sequence_no:Number(f?.raw_sequence_no)||0,sequence_no:Number(f?.sequence_no)||0,altili_no:Number(f?.altili_no)||1});
  const es=v=>[String(v?.id||''),String(v?.race_date||''),Number(v?.raw_sequence_no)||0,Number(v?.sequence_no)||0,Number(v?.altili_no)||1].join('~');
  const lock={version:2,file_count:files.length,sequence_max:files.length,max_file_id:maxId,sort_policy:'DATE_ASC_SEQUENCE_RENUMBERED_RAW_RACE_NO_ASC_V1',oldest:endpoint(files[0]),newest:endpoint(files[files.length-1])};
  lock.order_signature=[`v${lock.version}`,`n${lock.file_count}`,`s${lock.sequence_max}`,`i${lock.max_file_id}`,lock.sort_policy,es(lock.oldest),es(lock.newest)].join('|');dbObj.chronology_lock=lock;
  return {files:files.length,oldest:files[0]?.race_date||'',newest:files[files.length-1]?.race_date||''};
}

function resolvePredictionLogBacklog(dbObj){
  const races=Array.isArray(dbObj?.races)?dbObj.races:[];
  const log=Array.isArray(dbObj?.prediction_log)?dbObj.prediction_log:[];
  if(!races.length||!log.length) return 0;
  // V1.1.281: ana stats-engine ile aynı meeting_uid + tarih + altılı + ayak
  // semantiğini kullan. Eski worker meeting_uid'yi yok saydığı için restore'da aynı
  // tarih/pist/altılıya ait yinelenmiş toplantı kayıtlarını yanlış çözebilirdi.
  const filesById=new Map((dbObj.files||[]).map(f=>[String(f?.id),f]));
  const buckets=new Map();
  const keyOf=(leg,hip,date,alt,meeting)=>[
    Number(leg)||0,
    tkpFoldTr(hip||''),
    String(date||''),
    Number(alt)||1,
    String(meeting||'')
  ].join('|');
  for(const rec of log){
    if(rec?.resolved===1)continue;
    const k=keyOf(rec?.leg,rec?.hippodrome,rec?.race_date,rec?.altili_no,rec?.meeting_uid);
    if(!buckets.has(k))buckets.set(k,[]);
    buckets.get(k).push(rec);
  }
  let changed=0;
  for(const r of races){
    if(!Array.isArray(r?.horses)||!r.horses.length)continue;
    const raceAlt=Number(r?.altili_no)||Number(filesById.get(String(r?.file_id))?.altili_no)||1;
    const date=String(r?.race_date||'');
    const meetingUid=String(r?.meeting_uid||r?.file_id||'');
    const keys=[
      keyOf(r?.leg,r?.hippodrome,date,raceAlt,meetingUid),
      keyOf(r?.leg,r?.hippodrome,'',raceAlt,meetingUid),
      keyOf(r?.leg,r?.hippodrome,date,raceAlt,''),
      keyOf(r?.leg,r?.hippodrome,'',raceAlt,'')
    ];
    const seen=new Set(),list=[];
    for(const k of keys)for(const rec of (buckets.get(k)||[])){if(!seen.has(rec)){seen.add(rec);list.push(rec);}}
    if(!list.length)continue;
    const horsesByName=new Map(r.horses.map(h=>[tkpFoldTr(h?.horse_name),h]));
    for(const rec of list){
      if(rec?.resolved===1)continue;
      if(rec?.race_date&&r?.race_date&&rec.race_date!==r.race_date)continue;
      if(rec?.meeting_uid&&meetingUid&&String(rec.meeting_uid)!==meetingUid)continue;
      const h=horsesByName.get(tkpFoldTr(rec?.horse_name));
      if(h){rec.resolved=1;rec.winner=h.winner===1?1:0;rec.finish_position=h.finish_position||null;rec.resolved_at=new Date().toISOString();changed++;}
    }
  }
  return changed;
}

function unwrapBackup(value){
  let out=value;
  for(let i=0;i<4;i++){
    if(out&&typeof out==='object'&&!Array.isArray(out)&&out.db&&typeof out.db==='object'){out=out.db;continue;}
    if(out&&typeof out==='object'&&!Array.isArray(out)&&typeof out.value==='string'){out=JSON.parse(out.value);continue;}
    if(typeof out==='string'){out=JSON.parse(out);continue;}
    break;
  }
  if(!out||typeof out!=='object'||Array.isArray(out))throw new Error('TKP veritabanı nesnesi bulunamadı.');
  if(!Array.isArray(out.files)&&!Array.isArray(out.races)&&!Array.isArray(out.bets))throw new Error('files/races/bets alanları bulunamadı.');
  return out;
}

function backupEnvelopeMeta(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {portable:null,manifest:null};
  return {
    portable:value.portable||value._tkp_portable||null,
    manifest:value.manifest||null
  };
}

async function readBackupText(file,inputFormat){
  if(inputFormat==='json') return new Response(file.stream()).text();
  const bytes=new Uint8Array(await file.arrayBuffer());
  // Eski bazı .tkpbak dosyaları yalnız uzantı olarak .tkpbak olup düz JSON olabilir.
  const isGzip=bytes.length>=2&&bytes[0]===0x1f&&bytes[1]===0x8b;
  if(!isGzip){
    try{return new TextDecoder('utf-8').decode(bytes);}catch(_){return await new Response(bytes).text();}
  }
  if(typeof DecompressionStream!=='undefined'){
    try{return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();}catch(_){ }
  }
  if(self.pako&&typeof self.pako.ungzip==='function'){
    try{return self.pako.ungzip(bytes,{to:'string'});}catch(error){throw new Error('Gzip yedek açılamadı: '+(error?.message||error));}
  }
  throw new Error('Bu tarayıcı gzip geri yüklemeyi desteklemiyor ve yerel gzip fallback yüklenemedi.');
}

// V1.1.277 KÖK FIX: büyük yedeklerde (500+ dosya) restore, TÜM dosyayı önce tek bir
// dev metne (readBackupText) sonra TEK bir dev JSON.parse çağrısına çeviriyordu.
// O anda hem ham metin hem ayrıştırılmış nesne ağacı AYNI ANDA bellekte oluyor --
// bu, eski/düşük RAM'li makinelerde (Windows 8.1 gibi) gerçek bir OOM çökmesi
// riski taşıyordu. Aşağıdaki akış tabanlı okuyucu, gzip çıkışını (veya ham JSON
// modunu) küçük parçalar halinde okuyup uzunluk-önekli SEGMENTLERİ (bkz.
// exportBackup) teker teker ayrıştırmayı mümkün kılar; hiçbir zaman TÜM ham metin
// bellekte tutulmaz. Eski (segmentsiz, tek-blok) yedekler için bu sınıf yalnızca
// bir geçiş katmanı olarak kullanılır (readAllRemaining), davranış değişmez.
function tkpU32(n){ const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,false); return b; }
function tkpReadU32(bytes){ return new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0,false); }

class TkpByteStreamReader{
  // V1.1.281: low-copy chunk queue. Eski sürüm her yeni network/gzip chunk'ında
  // mevcut buffer'ın tamamını yeni Uint8Array'e kopyalıyor ve büyük segmentlerde
  // O(n²) byte taşımasına yol açabiliyordu. Bu okuyucu gelen parçaları olduğu gibi
  // kuyrukta tutar; yalnız readExact() çağrısında istenen byte sayısını BİR KEZ
  // hedef diziye kopyalar.
  constructor(stream){
    this.reader=stream.getReader();
    this.chunks=[];
    this.headOffset=0;
    this.bufferedBytes=0;
    this.done=false;
  }
  async _fill(minBytes){
    while(this.bufferedBytes<minBytes && !this.done){
      const {value,done}=await this.reader.read();
      if(done){this.done=true;break;}
      const chunk=value instanceof Uint8Array?value:new Uint8Array(value);
      if(chunk.length){this.chunks.push(chunk);this.bufferedBytes+=chunk.length;}
    }
  }
  _consume(n){
    const out=new Uint8Array(n);
    let written=0;
    while(written<n){
      const head=this.chunks[0];
      if(!head)throw new Error('Beklenenden kısa veri akışı (yedek dosyası bozuk olabilir).');
      const available=head.length-this.headOffset;
      const take=Math.min(available,n-written);
      out.set(head.subarray(this.headOffset,this.headOffset+take),written);
      written+=take;
      this.headOffset+=take;
      this.bufferedBytes-=take;
      if(this.headOffset>=head.length){this.chunks.shift();this.headOffset=0;}
    }
    return out;
  }
  async readExact(n){
    if(!Number.isSafeInteger(n)||n<0)throw new Error('Geçersiz yedek byte uzunluğu.');
    await this._fill(n);
    if(this.bufferedBytes<n)throw new Error('Beklenenden kısa veri akışı (yedek dosyası bozuk olabilir).');
    return this._consume(n);
  }
  async peek(n){
    await this._fill(n);
    const take=Math.min(n,this.bufferedBytes);
    const out=new Uint8Array(take);
    let written=0,offset=this.headOffset;
    for(const chunk of this.chunks){
      const available=chunk.length-offset;
      const part=Math.min(available,take-written);
      if(part>0){out.set(chunk.subarray(offset,offset+part),written);written+=part;}
      if(written>=take)break;
      offset=0;
    }
    return out;
  }
  async readAllRemaining(){
    while(!this.done){
      const {value,done}=await this.reader.read();
      if(done){this.done=true;break;}
      const chunk=value instanceof Uint8Array?value:new Uint8Array(value);
      if(chunk.length){this.chunks.push(chunk);this.bufferedBytes+=chunk.length;}
    }
    return this._consume(this.bufferedBytes);
  }
}

async function readBackupByteStream(file,inputFormat){
  if(inputFormat==='json') return file.stream();
  const head=new Uint8Array(await file.slice(0,2).arrayBuffer());
  const isGzip=head.length>=2&&head[0]===0x1f&&head[1]===0x8b;
  if(!isGzip) return file.stream();
  if(typeof DecompressionStream!=='undefined'){
    try{ return file.stream().pipeThrough(new DecompressionStream('gzip')); }catch(_){ }
  }
  // pako'nun akış API'si yok; eski senkron yola düş (yalnız bu nadir tarayıcı
  // fallback'inde tüm dosya belleğe alınır -- DecompressionStream'in olduğu her
  // modern tarayıcıda bu yola hiç girilmez).
  if(self.pako&&typeof self.pako.ungzip==='function'){
    const bytes=new Uint8Array(await file.arrayBuffer());
    let text;
    try{ text=self.pako.ungzip(bytes,{to:'string'}); }catch(error){ throw new Error('Gzip yedek açılamadı: '+(error?.message||error)); }
    const encoded=new TextEncoder().encode(text);
    return new Blob([encoded]).stream();
  }
  throw new Error('Bu tarayıcı gzip geri yüklemeyi desteklemiyor ve yerel gzip fallback yüklenemedi.');
}

async function prepare(file,inputFormat='gzip'){
  const started=performance.now();
  preparedDb=null;preparedFile=file;preparedSegmentedEnvelope=null;
  preparedInputFormat=inputFormat==='json'?'json':'gzip';
  // V1.1.276: her aşama öncesi/sonrası postMessage ile ilerleme bildirilir --
  // büyük yedeklerde bu adımlar onlarca saniye sürebilir, kullanıcı donmuş
  // sanmasın diye.
  postMessage({type:'phase',phase:'decompress',bytes:file.size});
  const byteStream=await readBackupByteStream(file,preparedInputFormat);
  const reader=new TkpByteStreamReader(byteStream);
  const decoder=new TextDecoder('utf-8');
  const magicPeek=preparedInputFormat==='gzip'?await reader.peek(4):new Uint8Array(0);
  const isSegmented=magicPeek.length===4 && decoder.decode(magicPeek)===TKP_BACKUP_MAGIC;
  const readMs=performance.now()-started;
  let jsonParseMs;

  if(isSegmented){
    // V1.1.277: segmentli format -- her koleksiyon ayrı ayrı, küçük parçalar
    // halinde okunup ayrıştırılır. Hiçbir zaman TÜM ham metin tek seferde
    // bellekte olmaz (bkz. dosya başı KÖK FIX notu).
    postMessage({type:'phase',phase:'parse',segmented:true});
    const parseStarted=performance.now();
    await reader.readExact(4); // magic (peek'te tüketilmemişti)
    const formatVersion=tkpReadU32(await reader.readExact(4));
    if(formatVersion>TKP_SEGMENTED_FORMAT_VERSION)throw new Error(`Desteklenmeyen segmentli yedek format sürümü: ${formatVersion}. Önce uygulamayı güncelleyin.`);
    const envLen=tkpReadU32(await reader.readExact(4));
    if(envLen>50*1024*1024)throw new Error('Yedek zarfı beklenenden çok büyük; dosya bozuk olabilir.');
    const envelope=JSON.parse(decoder.decode(await reader.readExact(envLen)));
    preparedPortable=envelope.portable||null;
    preparedManifest=envelope.manifest||null;
    jsonParseMs=performance.now()-parseStarted;
    const scalarFields=envelope.scalarFields||{};
    const sourceSchema=Number(scalarFields?.schema_version)||0;
    if(sourceSchema>MAX_SUPPORTED_SCHEMA_VERSION)throw new Error(`Bu yedek daha yeni bir veri şeması kullanıyor (v${sourceSchema}); önce uygulamayı güncelle.`);
    preparedSegmentedEnvelope={formatVersion,envelope};
    preparedMetrics={inputFormat:preparedInputFormat,fileReadMs:0,gunzipMs:Math.round(readMs),jsonParseMs:Math.round(jsonParseMs),bytes:file.size,segmented:true,streamed:true};
    postMessage({type:'ready',counts:{...(preparedManifest||{})},hasPortable:Boolean(preparedPortable),metrics:preparedMetrics});
    return;
  } else {
    // ESKİ FORMAT (geri uyumluluk): V1.1.276 ve öncesi yedekler tek blok JSON'dur.
    // Aynı davranış korunur (tek seferlik JSON.parse), yalnız kaynak artık bir
    // stream'den (readAllRemaining) geliyor.
    postMessage({type:'phase',phase:'parse',segmented:false});
    const parseStarted=performance.now();
    const text=decoder.decode(await reader.readAllRemaining());
    const parsed=JSON.parse(text);
    const envelope=backupEnvelopeMeta(parsed);
    preparedPortable=envelope.portable;
    preparedManifest=envelope.manifest;
    preparedDb=unwrapBackup(parsed);
    jsonParseMs=performance.now()-parseStarted;
  }

  const sourceSchema=Number(preparedDb?.schema_version)||0;
  if(sourceSchema>MAX_SUPPORTED_SCHEMA_VERSION)throw new Error(`Bu yedek daha yeni bir veri şeması kullanıyor (v${sourceSchema}); önce uygulamayı güncelle.`);
  preparedMetrics={inputFormat:preparedInputFormat,fileReadMs:preparedInputFormat==='json'?Math.round(readMs):0,gunzipMs:preparedInputFormat==='gzip'?Math.round(readMs):0,jsonParseMs:Math.round(jsonParseMs),bytes:file.size,segmented:isSegmented};
  postMessage({type:'ready',counts:backupCounts(preparedDb),hasPortable:Boolean(preparedPortable),metrics:preparedMetrics});
}

async function persistSegmentedBackup(){
  if(!preparedFile||!preparedSegmentedEnvelope)throw new Error('Hazırlanmış akışlı TKP yedeği yok.');
  const started=performance.now();
  postMessage({type:'phase',phase:'indexeddb-write',streamed:true});
  const byteStream=await readBackupByteStream(preparedFile,preparedInputFormat);
  const reader=new TkpByteStreamReader(byteStream);
  const decoder=new TextDecoder('utf-8');
  const magic=decoder.decode(await reader.readExact(4));
  if(magic!==TKP_BACKUP_MAGIC)throw new Error('Akışlı yedek sihirli başlığı geçersiz.');
  const formatVersion=tkpReadU32(await reader.readExact(4));
  const envLen=tkpReadU32(await reader.readExact(4));
  if(envLen>50*1024*1024)throw new Error('Yedek zarfı beklenenden çok büyük.');
  const envelope=JSON.parse(decoder.decode(await reader.readExact(envLen)));
  const rawCollections=Array.isArray(envelope.collections)?envelope.collections:[];
  const descriptors=formatVersion>=5
    ?rawCollections.map(row=>({name:String(row?.name||''),chunks:Number(row?.chunks)||0,count:Number(row?.count)||0}))
    :rawCollections.map(name=>({name:String(name||''),chunks:1,count:Number(envelope.manifest?.[name])||0}));
  let lastProgress=0;
  const result=await TKPSegmentedIDB.importFramedCollections({schemaVersion:Number(envelope.scalarFields?.schema_version)||0,meta:envelope.scalarFields||{},collections:descriptors},async(descriptor,chunkIndex)=>{
    const segLen=tkpReadU32(await reader.readExact(4));
    if(segLen>128*1024*1024)throw new Error(`Yedek parçası ("${descriptor.name}" #${chunkIndex+1}) güvenli sınırı aşıyor.`);
    const parsed=JSON.parse(decoder.decode(await reader.readExact(segLen)));
    if(!Array.isArray(parsed))throw new Error(`Yedek parçası ("${descriptor.name}" #${chunkIndex+1}) dizi değil.`);
    // Canlı at filtre önbellekleri gerçek yarış verisi değildir. Eski yedeklerde
    // her koşunun horses dizisini iki kez daha taşıyıp REAL509 paketini yaklaşık
    // 169 MB şişiriyordu. Asıl `horses` korunur; geçici değer ilk kullanımda
    // core-utils tarafından yeniden üretilir. Akışlı geri yüklemede de kalıcı
    // depoya tekrar girmemeleri için parça yazılmadan önce temizlenir.
    if(descriptor.name==='races')for(const race of parsed){
      if(!race||typeof race!=='object')continue;
      delete race.__tkpLiveHorsesSrc;
      delete race.__tkpLiveHorsesCache;
      delete race._accurateFieldAvgCache;
    }
    postMessage({type:'phase',phase:'parse-segment',name:descriptor.name,chunk:chunkIndex+1,chunks:descriptor.chunks,count:parsed.length,streamed:true});
    return parsed;
  },{writeBatch:16,timeoutMs:300000,onProgress(info){const now=performance.now();if(now-lastProgress>250){lastProgress=now;postMessage({type:'progress',info});}}});
  if(!result?.ok)throw new Error('Akışlı IndexedDB yazımı doğrulanamadı.');
  preparedMetrics.indexedDbWriteMs=Math.round(performance.now()-started);
  preparedMetrics.totalMs=Math.round((preparedMetrics.gunzipMs||0)+(preparedMetrics.jsonParseMs||0)+preparedMetrics.indexedDbWriteMs);
  const counts={...(envelope.manifest||{})};
  const savedCounts={};for(const [name,info] of Object.entries(result.manifest?.collections||{}))savedCounts[name]=Number(info?.count)||0;
  const missing=Object.keys(counts).filter(key=>Number(savedCounts[key]||0)<Number(counts[key]||0));
  postMessage({type:'complete',metrics:preparedMetrics,counts,savedCounts,verified:missing.length===0,missing,portable:preparedPortable,manifest:preparedManifest});
  preparedDb=null;preparedFile=null;preparedSegmentedEnvelope=null;preparedPortable=null;preparedManifest=null;
}

async function persist(){
  if(preparedSegmentedEnvelope)return persistSegmentedBackup();
  if(!preparedDb)throw new Error('Hazırlanmış TKP yedeği yok.');
  postMessage({type:'phase',phase:'chronology'});
  const resolveStarted=performance.now();
  const chronology=tkpWorkerChronology(preparedDb);
  postMessage({type:'phase',phase:'resolve-backlog',logRows:preparedDb.prediction_log?.length||0,raceRows:preparedDb.races?.length||0});
  const resolvedCount=resolvePredictionLogBacklog(preparedDb);
  if(resolvedCount&&preparedDb.learning_state&&typeof preparedDb.learning_state==='object'){
    delete preparedDb.learning_state.dataset_signature;
    delete preparedDb.learning_state.rule_cache;
  }
  const resolveMs=Math.round(performance.now()-resolveStarted);
  preparedDb.changelog=Array.isArray(preparedDb.changelog)?preparedDb.changelog:[];
  // Worker yalnız hızlı, akışkan yazımı yapar; ana uygulamanın state/race-data
  // migrasyonlarını burada taklit etmeyiz. Bunun yerine bu kalıcı işaret sonraki
  // ana açılışı restore+tam hijyen yoluna zorlar. Böylece büyük yedek aktarımı
  // sırasında UI donmaz, ama eksik UID/X/BMB/visible-TKP denetimi de atlanmaz.
  if(!preparedDb.migration_state||typeof preparedDb.migration_state!=='object'||Array.isArray(preparedDb.migration_state)) preparedDb.migration_state={};
  preparedDb.migration_state.restore_requires_full_hygiene_v2={version:2,marked_at:new Date().toISOString(),source:'backup-import-worker'};
  const sourceLabel=preparedInputFormat==='json'?'JSON':'.tkbz/.tkpbak';
  preparedDb.changelog.push({ts:new Date().toISOString(),type:'BACKUP',message:`${sourceLabel} worker aktarımı: ${preparedDb.files?.length||0} dosya / ${preparedDb.races?.length||0} koşu.${resolvedCount?` ${resolvedCount} eski tahmin kaydı sonuçla eşleştirildi (öğrenme boşluğu giderildi).`:''}`});
  const started=performance.now();
  let lastProgress=0;
  postMessage({type:'phase',phase:'indexeddb-write'});
  // 509 dosyalık V5 yedek yaklaşık 338 MB açılıyor. Worker zaten ana iş parçacığından
  // yalıtılmış olduğundan 512 KB'lık yüzlerce küçük IndexedDB parçası UI'yi daha fazla
  // korumuyor, yalnız transaction/manifest maliyetini büyütüyor. 4 MB + 16'lı toplu
  // yazım parça sayısını yaklaşık sekizde bire indirir; normal ana-thread snapshot yolu
  // state.js içinde güvenli 512 KB olarak kalır.
  const result=await TKPSegmentedIDB.saveDb(preparedDb,{maxRecords:50000,targetBytes:4*1024*1024,writeBatch:16,timeoutMs:300000,onProgress(info){const now=performance.now();if(now-lastProgress>250){lastProgress=now;postMessage({type:'progress',info});}}});
  if(!result?.ok)throw new Error('Parçalı IndexedDB yazımı doğrulanamadı.');
  preparedMetrics.resolveBacklogMs=resolveMs;
  preparedMetrics.resolvedPredictions=resolvedCount;
  preparedMetrics.indexedDbWriteMs=Math.round(performance.now()-started);
  preparedMetrics.totalMs=Math.round(preparedMetrics.fileReadMs+preparedMetrics.gunzipMs+preparedMetrics.jsonParseMs+resolveMs+preparedMetrics.indexedDbWriteMs);
  const counts={...backupCounts(preparedDb),resolvedPredictions:resolvedCount};
  preparedMetrics.chronology=chronology;
  const savedCounts={};for(const [name,info] of Object.entries(result.manifest?.collections||{}))savedCounts[name]=Number(info?.count)||0;
  const missing=Object.keys(counts).filter(key=>key!=='resolvedPredictions'&&Number(savedCounts[key]||0)<Number(counts[key]||0));
  postMessage({type:'complete',metrics:preparedMetrics,counts,savedCounts,verified:missing.length===0,missing,portable:preparedPortable,manifest:preparedManifest});
  preparedDb=null;
  preparedPortable=null;
  preparedManifest=null;
}

async function exportBackup(portable={}){
  const started=performance.now();
  // V1.1.281 KÖK FIX: tam DB artık export öncesinde RAM'e materyalize edilmez.
  // Aktif atomik manifest okunur; scalar/meta alanlar doğrudan manifestten,
  // koleksiyonlar ise immutable IndexedDB chunk'larından sırayla alınır.
  const manifest=await TKPSegmentedIDB.getActiveManifest();
  if(!manifest)throw new Error('Kalıcı TKP manifesti okunamadı.');
  const collections=[];
  const counts={};
  for(const [name,info] of Object.entries(manifest.collections||{})){
    const refs=Array.isArray(info?.refs)?info.refs:[];
    collections.push({name,chunks:refs.length,count:Number(info?.count)||0});
    counts[name]=Number(info?.count)||0;
  }
  for(const name of TKP_SEGMENTED_BACKUP_COLLECTIONS)if(!Object.prototype.hasOwnProperty.call(counts,name))counts[name]=0;
  const scalarFields=manifest.meta&&typeof manifest.meta==='object'?manifest.meta:{};
  const envelope={tkp_backup_version:5,created_at:new Date().toISOString(),portable,manifest:counts,collections,scalarFields};
  const encoder=new TextEncoder();
  const envBytes=encoder.encode(JSON.stringify(envelope));
  if(envBytes.length>50*1024*1024)throw new Error('Yedek zarfı güvenli sınırı aşıyor; üst-seviye büyük dizi segmentlenmemiş olabilir.');
  let jsonBytesTotal=envBytes.length+12;

  async function* framedGenerator(){
    yield encoder.encode(TKP_BACKUP_MAGIC);
    yield tkpU32(TKP_SEGMENTED_FORMAT_VERSION);
    yield tkpU32(envBytes.length);
    yield envBytes;
    for(const descriptor of collections){
      const info=manifest.collections?.[descriptor.name]||{};
      const refs=Array.isArray(info.refs)?info.refs:[];
      let exported=0;
      for(let i=0;i<refs.length;i++){
        const ref=refs[i];
        const page=await TKPSegmentedIDB.loadCollectionPageFromManifest(manifest,descriptor.name,{offset:Number(ref.start)||0,limit:Number(ref.count)||0});
        const rows=Array.isArray(page?.rows)?page.rows:[];
        if(rows.length!==Number(ref.count||0))throw new Error(`${descriptor.name} export parçası eksik (${rows.length}/${ref.count}).`);
        const segBytes=encoder.encode(JSON.stringify(rows));
        if(segBytes.length>128*1024*1024)throw new Error(`${descriptor.name} export parçası güvenli sınırı aşıyor.`);
        jsonBytesTotal+=segBytes.length+4;
        yield tkpU32(segBytes.length);
        yield segBytes;
        exported+=rows.length;
        postMessage({type:'phase',phase:'export-segment',name:descriptor.name,index:i+1,total:refs.length,count:exported,collectionTotal:descriptor.count});
      }
      if(exported!==descriptor.count)throw new Error(`${descriptor.name} export sayımı uyuşmuyor (${exported}/${descriptor.count}).`);
    }
  }
  function streamFromAsyncGenerator(gen){
    const iterator=gen[Symbol.asyncIterator]();
    return new ReadableStream({
      async pull(controller){
        try{const {value,done}=await iterator.next();if(done)controller.close();else controller.enqueue(value);}
        catch(error){controller.error(error);try{await iterator.return?.();}catch(_){}}
      },
      async cancel(){try{await iterator.return?.();}catch(_){}}
    });
  }

  let blob;
  if(typeof CompressionStream!=='undefined'){
    // Response.blob() ile sıkıştırılmış çıktı doğrudan Blob'a akar; eski arrayBuffer
    // ara kopyası kaldırılmıştır.
    const compressed=streamFromAsyncGenerator(framedGenerator()).pipeThrough(new CompressionStream('gzip'));
    blob=await new Response(compressed,{headers:{'Content-Type':'application/gzip'}}).blob();
  }else if(self.pako&&typeof self.pako.gzip==='function'){
    // Eski tarayıcı fallback'i streaming değildir; yalnız CompressionStream olmayan
    // ortamlarda kullanılır. Veri bütünlüğü korunur, UI worker içinde kalır.
    const parts=[];for await(const part of framedGenerator())parts.push(part);
    const framed=await new Blob(parts).arrayBuffer();
    blob=new Blob([self.pako.gzip(new Uint8Array(framed))],{type:'application/gzip'});
  }else throw new Error('Gzip sıkıştırma altyapısı kullanılamıyor.');
  postMessage({type:'export-complete',blob,metrics:{totalMs:Math.round(performance.now()-started),jsonBytes:jsonBytesTotal,gzipBytes:blob.size,formatVersion:5,streaming:typeof CompressionStream!=='undefined'},counts});
}

self.onmessage=event=>{
  const data=event.data||{};
  const task=data.type==='prepare'?prepare(data.file,data.inputFormat):data.type==='persist'?persist():data.type==='export'?exportBackup(data.portable||{}):Promise.reject(new Error('Bilinmeyen worker komutu.'));
  task.catch(error=>postMessage({type:'error',message:String(error?.message||error)}));
};
