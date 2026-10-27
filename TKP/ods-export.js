// ODS dışa aktarma: mevcut ana şablonu (ods-template.js) temel alıp seçilen koşuların
// verilerini doğru hücrelere yazar, geçerli bir ZIP (ODS) dosyası oluşturur ve indirir.
// Sadece STORE (sıkıştırmasız) yöntem kullanılır — ODF/ZIP standardına tamamen uygun,
// tarayıcıda ek bir sıkıştırma kütüphanesi gerektirmez.

// 1,7 MB'lık ODS şablonu uygulama açılışında kullanılmaz. Yalnız kullanıcı ODS
// indirdiğinde yüklenerek başlangıçtaki dosya okuma ve JavaScript ayrıştırma
// maliyeti tamamen kaldırılır. Aynı Promise eşzamanlı tıklamaları da birleştirir.
let _tkpOdsTemplatePromise=null;
const TKP_ODS_TEMPLATE_VERSION='1.1.275';
function tkpEnsureOdsTemplate(){
  if(typeof ODS_TPL_CONTENT!=='undefined') return Promise.resolve(true);
  if(_tkpOdsTemplatePromise) return _tkpOdsTemplatePromise;
  _tkpOdsTemplatePromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const timer=setTimeout(()=>reject(new Error('ODS şablonu 12 saniyede yüklenemedi.')),12000);
    script.src='ods-template.js?v='+encodeURIComponent(TKP_ODS_TEMPLATE_VERSION);
    script.async=true;
    script.onload=()=>{clearTimeout(timer);typeof ODS_TPL_CONTENT!=='undefined'?resolve(true):reject(new Error('ODS şablonu başlatılamadı.'));};
    script.onerror=()=>{clearTimeout(timer);reject(new Error('ODS şablonu dosyası yüklenemedi.'));};
    document.head.appendChild(script);
  }).catch(error=>{_tkpOdsTemplatePromise=null;throw error;});
  return _tkpOdsTemplatePromise;
}
function tkpPrewarmOdsTemplate(){
  const run=()=>tkpEnsureOdsTemplate().catch(()=>false);
  if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:4000});
  else setTimeout(run,1200);
}
if(typeof window!=='undefined')window.addEventListener('load',tkpPrewarmOdsTemplate,{once:true});

// ---- CRC32 (ZIP başlıkları için gerekli) ----
const _CRC_TABLE = (() => {
  let table = new Uint32Array(256);
  for (let n = 0; n < 256; n++){
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes){
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = _CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---- Basit STORE-yöntemli ZIP yazıcı ----
function buildZipStore(files){
  // files: [{name, data: Uint8Array}]
  let localParts = [], centralParts = [], offset = 0;
  const enc = new TextEncoder();
  for (const {name, data} of files){
    let nameBytes = enc.encode(name);
    let crc = crc32(data);
    let size = data.length;

    let local = new Uint8Array(30 + nameBytes.length);
    let dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);       // version needed
    dv.setUint16(6, 0x0800, true);   // UTF-8 names
    dv.setUint16(8, 0, true);        // method: 0 = store
    dv.setUint16(10, 0, true);       // mod time
    dv.setUint16(12, 0, true);       // mod date
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);    // compressed size
    dv.setUint32(22, size, true);    // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);       // extra length
    local.set(nameBytes, 30);
    localParts.push(local, data);

    let central = new Uint8Array(46 + nameBytes.length);
    let cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }
  let centralStart = offset;
  let centralSize = centralParts.reduce((s,p)=>s+p.length, 0);

  let eocd = new Uint8Array(22);
  let edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, centralStart, true);
  edv.setUint16(20, 0, true);

  let allParts = [...localParts, ...centralParts, eocd];
  let totalLen = allParts.reduce((s,p)=>s+p.length, 0);
  let out = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of allParts){ out.set(part, pos); pos += part.length; }
  return out;
}

// ---- ODF hücre yardımcıları (Python migrate.py ile aynı mantık) ----
const ODF_NS = {
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
};
function odfColIndex(letter){
  let idx = 0;
  for (const ch of letter) idx = idx*26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}
function odfGetCells(rowEl){
  return [...rowEl.children].filter(c => c.localName === 'table-cell' || c.localName === 'covered-table-cell');
}
function odfUnrollRow(doc, rowEl){
  for (const c of odfGetCells(rowEl)){
    let rep = +(c.getAttributeNS(ODF_NS.table,'number-columns-repeated') || 1);
    if (rep > 1){
      let style = c.getAttributeNS(ODF_NS.table,'style-name');
      c.removeAttributeNS(ODF_NS.table,'number-columns-repeated');
      let ref = c;
      for (let i=0;i<rep-1;i++){
        let clone = doc.createElementNS(ODF_NS.table, 'table:table-cell');
        if (style) clone.setAttributeNS(ODF_NS.table,'table:style-name', style);
        ref.parentNode.insertBefore(clone, ref.nextSibling);
        ref = clone;
      }
    }
  }
}
function odfGetCell(rowEl, colIdx){
  let ci = 0;
  for (const c of odfGetCells(rowEl)){
    let rep = +(c.getAttributeNS(ODF_NS.table,'number-columns-repeated') || 1);
    if (ci <= colIdx && colIdx < ci+rep) return c;
    ci += rep;
  }
  return null;
}
function odfSetCell(doc, rows, rowIdx, colIdx, value){
  if (value === null || value === undefined || value === '') return;
  odfUnrollRow(doc, rows[rowIdx]);
  let target = odfGetCell(rows[rowIdx], colIdx);
  if (!target) return;
  if (target.getAttributeNS(ODF_NS.table,'formula')) target.removeAttributeNS(ODF_NS.table,'formula');
  if (target.getAttributeNS(ODF_NS.office,'value')) target.removeAttributeNS(ODF_NS.office,'value');
  if (target.getAttributeNS(ODF_NS.office,'value-type')) target.removeAttributeNS(ODF_NS.office,'value-type');
  if (typeof value === 'number'){
    target.setAttributeNS(ODF_NS.office,'office:value-type','float');
    target.setAttributeNS(ODF_NS.office,'office:value', String(value));
  } else {
    target.setAttributeNS(ODF_NS.office,'office:value-type','string');
  }
  while (target.firstChild) target.removeChild(target.firstChild);
  let p = doc.createElementNS(ODF_NS.text, 'text:p');
  p.textContent = String(value);
  target.appendChild(p);
}

function odfGetColumns(tableEl){
  return [...tableEl.children].filter(c => c.localName === 'table-column');
}
function odfSetTableColumnStyle(tableEl, colIdx, styleName){
  // Sadece hedef kolonun görünür genişliğini değiştirir; veri/formül/klasör akışına dokunmaz.
  let ci = 0;
  for (const c of odfGetColumns(tableEl)){
    let rep = +(c.getAttributeNS(ODF_NS.table,'number-columns-repeated') || 1);
    if (ci <= colIdx && colIdx < ci + rep){
      // RACE sayfasında C/E/P/R tekil kolonlar; tekrarlı kolona denk gelirse güvenli biçimde atla.
      if (rep === 1) c.setAttributeNS(ODF_NS.table,'table:style-name', styleName);
      return;
    }
    ci += rep;
  }
}
function odfEnsureRaceExportHeaders(doc, rows, headerI){
  // Orijinal ODS şablon başlıkları aynen korunur: J-BYG ve 800 G.
  // Görünürlük için her blokta başlıklar tekrar yazılır; genişlik/stil değiştirilmez.
  odfSetCell(doc, rows, headerI, odfColIndex('C'), 'J-BYG');
  odfSetCell(doc, rows, headerI, odfColIndex('E'), '800 G');
  odfSetCell(doc, rows, headerI, odfColIndex('P'), 'J-BYG');
  odfSetCell(doc, rows, headerI, odfColIndex('R'), '800 G');
}
function odfEnsureRaceExportColumnVisibility(raceSheet){
  // Kullanıcı isteği: J-BYG ve 800 G kolonları şablondaki ORİJİNAL genişlikte kalsın.
  // RACE şablonunun gerçek kolon stilleri: C/P = co3, E/R = co5.
  // Sadece genişlik stili eski haline alınır; başlık/veri yazma ve sıralama mantığına dokunulmaz.
  odfSetTableColumnStyle(raceSheet, odfColIndex('C'), 'co3');
  odfSetTableColumnStyle(raceSheet, odfColIndex('P'), 'co3');
  odfSetTableColumnStyle(raceSheet, odfColIndex('E'), 'co5');
  odfSetTableColumnStyle(raceSheet, odfColIndex('R'), 'co5');
}
function tkpExportFirstFilled(h, keys){
  for (const k of keys){
    const v = h && h[k];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return '';
}
const TKP_JBYG_EXPORT_KEYS = [
  'jbyg','j_byg','jbyg_rank','j_byg_rank',
  'team_strength_rank','team_rank','jockey_trainer_rank','jokey_antrenor_rank',
  'j_beyg','j_beygir','j_beygir_rank',
  'jokey_beygir','jokey_beygir_rank',
  'jockey_beygir','jockey_beygir_rank'
];
const TKP_TRUSTED_JBYG_EXPORT_SOURCES = new Set([
  'GANYAN_CANAVARI_JBYG',
  'YENIBEYGIR_JBYG_FALLBACK',
  'TJK_PROGRAM_JBYG'
]);
const TKP_TRUSTED_GLP_EXPORT_SOURCE = 'GANYAN_CANAVARI_GALOPLAR_OZET';
const TKP_TRUSTED_GLP_EXPORT_SOURCES = new Set([
  TKP_TRUSTED_GLP_EXPORT_SOURCE,
  'YENIBEYGIR_GLP_FALLBACK',
  'TJK_PROGRAM_GALOP'
]);
function tkpOdsSourceName(value){
  return String(value ?? '').trim().toUpperCase();
}
function tkpHasTrustedJBygProvenance(h){
  return TKP_TRUSTED_JBYG_EXPORT_SOURCES.has(tkpOdsSourceName(h?.jbyg_source));
}
function tkpHasTrustedGlpProvenance(h){
  return TKP_TRUSTED_GLP_EXPORT_SOURCES.has(tkpOdsSourceName(h?.glp_source));
}
function tkpValidJBygRank(value){
  const n=Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 7 ? Math.round(n) : null;
}
function tkpExportJByg(h){
  // KİLİT KURAL: J-BYG ODS'ye yalnız doğrulanmış GC veya GC-sonrası Yeni Beygir
  // yedeğinden gelen 1-7 sırası yazılır. TJK/Atlagel veya geçmiş sonuçlardan
  // türetilmiş eski alanlar, kaynak kanıtı yoksa boş kalır.
  if(!tkpHasTrustedJBygProvenance(h)) return '';
  // J-BYG ODS'ye yalnız 1-7 yazılır.
  // Eski kayıt/veritabanı içinde 8, 9, 10... kalmış olsa bile exportta boş bırakılır.
  // İlk DOLU alanı değil ilk GEÇERLİ alanı seç. Eski kayıtlarda `jbyg:0`
  // bulunurken `jbyg_rank:3` veya `team_strength_rank:3` geçerli olabiliyor;
  // önceki akış 0'da durduğu için ODS hücresini yanlışlıkla boş bırakıyordu.
  const keys = [
    'jbyg','j_byg','jbyg_rank','j_byg_rank',
    'team_strength_rank','team_rank','jockey_trainer_rank','jokey_antrenor_rank',
    'j_beyg','j_beygir','j_beygir_rank','jokey_beygir','jokey_beygir_rank','jockey_beygir','jockey_beygir_rank'
  ];
  for(const key of keys){
    const n=Number(h?.[key]);
    if(Number.isFinite(n) && n >= 1 && n <= 7) return String(Math.round(n));
  }
  // GC'den gelen gerçek 0, "eksik" veya yedek çağrısı değildir. Sıra değildir,
  // fakat ODS/ekran doğrulamasında kaynak değeri olarak aynen görünmelidir.
  if(Number(h?.jbyg)===0) return '0';
  return '';
}

function tkpOdsFold(value){
  try{ return typeof fold==='function' ? fold(value||'') : String(value||'').toLocaleUpperCase('tr-TR').trim(); }
  catch(_e){ return String(value||'').toUpperCase().trim(); }
}
function tkpOdsHorseName(value){
  try{ return typeof baseHorseName==='function' ? baseHorseName(value||'') : tkpOdsFold(value); }
  catch(_e){ return tkpOdsFold(value); }
}
function tkpOdsHip(value){
  try{ return typeof canonicalHippodrome==='function' ? canonicalHippodrome(value||'') : tkpOdsFold(value); }
  catch(_e){ return tkpOdsFold(value); }
}
function tkpFindStoredRaceForOds(race){
  const stored=(typeof db!=='undefined' && Array.isArray(db?.races)) ? db.races : [];
  if(!race || stored.includes(race)) return race;
  const fileId=String(race.file_id??'');
  const abs=Number(race._absRaceNo);
  const leg=Number(race.leg);
  const date=String(race.race_date||race.date||'');
  const hip=tkpOdsHip(race.hippodrome||'');
  let hit=null;
  if(fileId) hit=stored.find(r=>String(r?.file_id??'')===fileId &&
    (Number.isFinite(abs) ? Number(r?._absRaceNo)===abs : Number(r?.leg)===leg));
  if(!hit && date && hip && Number.isFinite(abs)) hit=stored.find(r=>
    String(r?.race_date||r?.date||'')===date && tkpOdsHip(r?.hippodrome||'')===hip && Number(r?._absRaceNo)===abs);
  if(!hit && date && hip && Number.isFinite(leg)) hit=stored.find(r=>
    String(r?.race_date||r?.date||'')===date && tkpOdsHip(r?.hippodrome||'')===hip && Number(r?.leg)===leg);
  return hit;
}
function tkpFindStoredHorseForOds(horse, storedRace){
  const horses=Array.isArray(storedRace?.horses)?storedRace.horses:[];
  const name=tkpOdsHorseName(horse?.horse_name);
  const no=String(horse?.horse_no??'').trim();
  return (name ? horses.find(h=>tkpOdsHorseName(h?.horse_name)===name) : null)
    || (no ? horses.find(h=>String(h?.horse_no??'').trim()===no) : null)
    || null;
}
function tkpPromoteValidJByg(horse){
  const rank=tkpValidJBygRank(tkpExportJByg(horse));
  if(rank==null) return false;
  if(tkpValidJBygRank(horse?.jbyg)==null) horse.jbyg=rank;
  if(tkpValidJBygRank(horse?.jbyg_rank)==null) horse.jbyg_rank=rank;
  if(tkpValidJBygRank(horse?.team_strength_rank)==null) horse.team_strength_rank=rank;
  return true;
}
function tkpHydrateTrustedJByg(horse, source){
  // Eksik ekran payload'ı yalnız doğrulanmış, aynı attaki kayıtlı J-BYG katmanından
  // tamamlanabilir. Bireysel jokey/antrenör yüzdeleri burada çift sıraya çevrilmez.
  if(!horse || !tkpHasTrustedJBygProvenance(source)) return false;
  const rank=tkpValidJBygRank(tkpExportJByg(source));
  if(rank==null) return false;
  horse.jbyg=rank;
  horse.jbyg_rank=rank;
  horse.team_strength_rank=rank;
  horse.jbyg_source=tkpOdsSourceName(source.jbyg_source);
  if(source.jbyg_asof_date!==null&&source.jbyg_asof_date!==undefined&&source.jbyg_asof_date!=='') horse.jbyg_asof_date=source.jbyg_asof_date;
  for(const field of ['jbyg_rate','team_strength_pct']){
    const value=source[field];
    if(value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))) horse[field]=Number(value);
  }
  return true;
}
function tkpHydrateTrustedGlp(horse, source){
  // Ekran kopyasında GLP eksikse yalnız aynı attaki doğrulanmış GC veya GC-sonrası
  // Yeni Beygir fallback sırası tamamlanır; ham TJK/idman değeri alınmaz.
  if(!horse || !tkpHasTrustedGlpProvenance(source)) return false;
  const rank=Number(tkpExport800G(source));
  if(!Number.isFinite(rank)||rank<1||rank>6) return false;
  horse.g800=Math.round(rank);
  horse.g800_rank=Math.round(rank);
  horse.galop_rank=Math.round(rank);
  horse.glp_source=tkpOdsSourceName(source.glp_source);
  if(source.glp_asof_date!==null&&source.glp_asof_date!==undefined&&source.glp_asof_date!=='') horse.glp_asof_date=source.glp_asof_date;
  for(const field of ['workout_800','glp_raw'])if(source[field]!==null&&source[field]!==undefined&&source[field]!=='')horse[field]=source[field];
  return true;
}
function tkpHydrateStoredYpuan(horse, source){
  // R16.81: ekran payload'ı db.races'in eksik bir kopyasıysa, sonuç yükleme
  // sırasında Y.PUAN alanı boşalabiliyordu. J-BYG/GLP ile aynı kurala göre yalnız
  // aynı attaki KAYITLI Y.PUAN katmanı geri alınır; yeni değer türetilmez.
  if(!horse || !source) return false;
  const val=Number(source.ypuan);
  if(source.ypuan===null||source.ypuan===undefined||source.ypuan===''||!Number.isFinite(val)) return false;
  horse.ypuan=val;
  for(const field of ['ypuan_raw','ypuan_source','ypuan_sources','ypuan_contributor_count','ypuan_source_divisor','ypuan_breakdown']){
    const value=source[field];
    if(value!==null&&value!==undefined&&value!=='') horse[field]=Array.isArray(value)?value.slice():value;
  }
  return true;
}
function tkpPrepareRacesForOdsExport(races){
  // Her ODS üretim yolu bu tek kapıdan geçer. Ekran payload'ı db.races'in eksik
  // bir kopyasıysa, aynı yarıştaki asıl atın yalnız doğrulanmış J-BYG alanı alınır.
  for(const race of (races||[])){
    const storedRace=tkpFindStoredRaceForOds(race);
    if(storedRace && storedRace!==race){
      for(const horse of (race.horses||[])){
        const source=tkpFindStoredHorseForOds(horse,storedRace);
        if(!source) continue;
        if(tkpValidJBygRank(tkpExportJByg(horse))==null) tkpHydrateTrustedJByg(horse,source);
        if(!tkpExport800G(horse)) tkpHydrateTrustedGlp(horse,source);
        if(horse.ypuan===null||horse.ypuan===undefined||horse.ypuan==='') tkpHydrateStoredYpuan(horse,source);
      }
    }
    for(const horse of (race.horses||[])) tkpPromoteValidJByg(horse);
  }
  return races;
}
function tkpExport800G(h){
  // KİLİT KURAL: ODS 800 G/GLP alanına ham galop derecesi/süresi DEĞİL,
  // yalnız koşu-içi galop sırası 1-6 yazılır. Eski kayıtta workout_800 gibi
  // 0.49.80 / 24.50 süreleri bulunsa bile bu kolona kaçamaz.
  // Kaynak Ganyan Canavarı Galoplar Özet veya GC boş kaldıktan sonra alınan gerçek
  // Yeni Beygir fallback tablosu olmalıdır; TJK/Atlagel alanları taşınmaz.
  if(!tkpHasTrustedGlpProvenance(h)) return '';
  for(const key of ['g800','g800_rank','galop_rank','glp_rank','galop800_rank','galop_800_rank','g_800_rank','g400_rank']){
    const n=Number(h?.[key]);
    if(Number.isFinite(n)&&n>=1&&n<=6)return String(Math.round(n));
  }
  return '';
}

// normalizeRaceObj() (race-data.js) uygulama içi kullanım için cins/pisti tam kelimeye
// çevirir (İNG->İNGİLİZ, SENT.->SENTETİK). ODS'ye yazarken bunları şablonun kendi kısa
// gösterimine geri çeviriyoruz.
function abbrevBreed(b){
  let x = fold(b);
  if (x.includes('ARAP')) return 'ARP';
  if (x.includes('İNGİLİZ') || x.includes('INGILIZ')) return 'İNG';
  return b;
}
function abbrevSurface(s){
  let x = fold(s);
  if (x.startsWith('SENT')) return 'SENT.';
  if (x.includes('KUM')) return 'KUM';
  if (x.includes('ÇİM')) return 'ÇİM';
  return s;
}

const ODS_BLOCK_STARTS = [2, 28, 54]; // 0-indexli, veri başlangıç satırları (satır3/29/55)

// Ana şablondaki gerçek SONUÇ (L/Y) formülünün JS karşılığı — sadece ODS'ye YAZARKEN
// atları doğru sırada (küçükten büyüğe) dizmek için kullanılır; BMB/VALUE hesaplaması
// bu değere dayanmaz, o hâlâ yalnızca gerçek ODS formüllerinde hesaplanır.
function approxSonuc(h){
  // `tr`, bu eski ODS şablonunda AGF'nin uyumluluk kopyasıdır (normalizeRaceObj da
  // h.tr=h.agf yazar). Tarihsel GC TR alanı değildir; formülü/kolonları değiştirme.
  const C = Number(tkpExportJByg(h)) || 0, D = Number(h.agf) || 0, E = Number(tkpExport800G(h)) || 0, G = Number(h.tr) || 0;
  const J = (!G || !Number.isFinite(100/G)) ? 0 : (100/G - 1.15);
  const K = (C + E + G) / 5 + J;
  let L = (K + D*2)
    - (G > 30 ? G*1.9 : 0)
    - (G < 30 ? G*1.5 : 0)
    - (K < 10.12 ? K : 0)
    - (G > 65 ? G*0.23 : 0);
  return Number.isFinite(L) ? L : 999999;
}
function sortHorsesBySonuc(horses){
  const arr = (horses||[]).slice();
  const sonucKey = (h) => {
    // Sıralama, görünen ODS SONUÇ hücresinin formülüyle aynı değere göre yapılmalı.
    // h.result_score eski/önbellek değer taşıyabildiği için önce onu kullanmak,
    // dışa aktarılan tabloda ZEMBEREK örneğindeki gibi yanlış sıra üretir.
    const calc = approxSonuc(h);
    if (Number.isFinite(calc) && calc < 999999) return calc;
    const v = h?.result_score;
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v);
    return 999999;
  };
  return arr.sort((a,b) =>
    sonucKey(a) - sonucKey(b) ||
    TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||''))
  );
}

function buildOdsFromRaces(races, filenameHint){
  // KÖK FIX (v1.1.230, denetim bulgusu): Bu fonksiyon "1 AYAK"/"2 AYAK"/"3 AYAK"
  // şablon başlıklarını races[] dizisinin GİRİŞ SIRASINA göre dolduruyordu (races[0]
  // her zaman "1 AYAK" bloğuna yazılır), gerçek r.leg alanına göre değil. Bugüne kadar
  // tüm çağıranlar (tkpRowsByFileId, dosya bazlı fallback) zaten leg'e göre sıralı
  // veri veriyordu, bu yüzden aktif bir hata yoktu -- ama garanti çağırana bağlıydı.
  // Savunma katmanı: burada da açıkça sıralayarak, ileride sırasız veri geçen yeni
  // bir çağrı noktası olursa bile AYAK etiketlerinin gerçek veriyle karışması
  // engellenmiş olur.
  races = (races||[]).slice().sort((a,b)=>(Number(a?.leg)||0)-(Number(b?.leg)||0));
  // Eksik ekran kopyası varsa yalnız doğrulanmış GC/Yeni Beygir J-BYG/GLP kaydı
  // tamamlanır. TJK/geçmiş oranlarından ODS uğruna sıra üretilmez.
  tkpPrepareRacesForOdsExport(races);
  let parser = new DOMParser();
  let doc = parser.parseFromString(ODS_TPL_CONTENT, 'text/xml');
  let tables = [...doc.getElementsByTagNameNS('*','table')];
  let raceSheet = tables.find(t => (t.getAttributeNS(ODF_NS.table,'name')||'').toUpperCase() === 'RACE');
  if (!raceSheet) throw new Error('Şablonda RACE sayfası bulunamadı.');
  let rows = [...raceSheet.children].filter(c => c.localName === 'table-row');
  odfEnsureRaceExportColumnVisibility(raceSheet);

  // Y.PUAN sayfası (yorumcu konsensüs puanı) -- şablonda yoksa sessizce atlanır (opsiyonel).
  // NOT: h.ypuan yalnızca TOPLAM puanı taşır; Y-1..Y-8 tekil yorumcu kırılımı uygulama
  // içinde tutulmuyor, o yüzden burada sadece YPUAN sütununa (J/U) toplam puan yazılır,
  // altındaki formül statik değerle değiştirilir. Y-1..Y-8 sütunları bu export akışında
  // boş kalır; isterseniz YORUMCU_VERI pipeline'ıyla ayrıca doldurulabilir.
  //
  // ATNO sütunu (A/L) da normalde formülle (RACE sayfasından COUNTIF ile) geliyordu,
  // ama bazı programlar (özellikle OpenOffice/bazı LibreOffice sürümleri) dosyayı
  // açarken formülleri otomatik yeniden hesaplamıyor -- bu yüzden YPUAN görünse bile
  // (o artık düz sayı) ATNO boş kalabiliyordu. Aynı güvenlik için ATNO'yu da formüle
  // hiç güvenmeden doğrudan düz sayı olarak yazıyoruz.
  let ypuanSheet = tables.find(t => (t.getAttributeNS(ODF_NS.table,'name')||'').toUpperCase() === 'Y.PUAN');
  let ypuanRows = ypuanSheet ? [...ypuanSheet.children].filter(c => c.localName === 'table-row') : null;
  const YPUAN_BLOCK_STARTS = [2, 28, 54]; // Y.PUAN sayfasının RACE ile birebir aynı blok başlangıçları
  const YPUAN_ATNO_COL = {J:'A', U:'L'}; // YPUAN sütunu -> aynı taraftaki ATNO sütunu
  function writeYpuanTotal(blockIdx, atnoRaw, colLetter, ypuanVal){
    if (!ypuanRows) return;
    let atnoNum = parseInt(String(atnoRaw).match(/^\d+/)?.[0] || '', 10);
    if (!Number.isFinite(atnoNum)) return;
    let yRidx = YPUAN_BLOCK_STARTS[blockIdx] + (atnoNum - 1);
    if (yRidx >= ypuanRows.length) return;
    odfSetCell(doc, ypuanRows, yRidx, odfColIndex(YPUAN_ATNO_COL[colLetter]), atnoNum);
    if (ypuanVal != null) odfSetCell(doc, ypuanRows, yRidx, odfColIndex(colLetter), ypuanVal);
  }

  // RACE sayfasının kendi iç YPUAN zinciri (BB->VLOOKUP->BC:BJ->BK, sağ tarafta
  // BM->BN:BU->BV) Y.PUAN sayfasındaki Y-1..Y-8 TEKİL sütunlarını arıyor; biz sadece
  // toplamı (Y.PUAN'ın J/U sütunu) yazdığımız için o VLOOKUP'lar boş kalır ve BK/BV
  // hesaplanamaz -- RACE sayfası Y.PUAN'a "bağlı değilmiş" gibi görünür. Sütun harfini
  // (BK/BV) sabit yazmak yerine, formülünün imzasına (COUNTIF ... "TEK" ... *14+) göre
  // hücreyi ARAYIP buluyoruz -- devasa şablonda yanlış sütun harfi riskini önler.
  function findInnerYpuanCell(rowEl, side){
    // side: 'left' -> BC:BJ aralığını referans alan formül, 'right' -> BN:BU aralığını
    // NOT: şablonda mutlak referanslar "$" ile yazılıyor (ör. [.$BC3:.$BJ3]), bu yüzden
    // arama deseninde de "$" işareti ZORUNLU -- yoksa hiçbir hücre eşleşmez.
    const needle = side === 'left' ? '$BC' : '$BN';
    const cells = odfGetCells(rowEl);
    for (const c of cells){
      const f = c.getAttributeNS(ODF_NS.table,'formula') || '';
      if (f.includes('"TEK"') && f.includes('*14+') && f.includes(needle)) return c;
    }
    return null;
  }
  function writeInnerRaceYpuan(rowEl, side, ypuanVal){
    if (ypuanVal == null) return;
    const target = findInnerYpuanCell(rowEl, side);
    if (!target) return;
    if (target.getAttributeNS(ODF_NS.table,'formula')) target.removeAttributeNS(ODF_NS.table,'formula');
    target.setAttributeNS(ODF_NS.office,'value-type','float');
    target.setAttributeNS(ODF_NS.office,'value', String(ypuanVal));
    while (target.firstChild) target.removeChild(target.firstChild);
    const p = doc.createElementNS(ODF_NS.text, 'text:p');
    p.textContent = String(ypuanVal);
    target.appendChild(p);
  }


  for (let b = 0; b < 3; b++){
    let r1 = races[b*2], r2 = races[b*2+1];
    let dataStart = ODS_BLOCK_STARTS[b];
    let titleI = dataStart - 2, headerI = dataStart - 1;
    odfEnsureRaceExportHeaders(doc, rows, headerI);

    if (r1){
      odfSetCell(doc, rows, titleI, odfColIndex('D'), r1.distance);
      odfSetCell(doc, rows, titleI, odfColIndex('E'), abbrevSurface(r1.surface));
      odfSetCell(doc, rows, titleI, odfColIndex('F'), abbrevBreed(r1.breed));
      odfSetCell(doc, rows, headerI, odfColIndex('B'), r1.condition_text);
      // Kullanıcı isteği: İlk 5 sınırı kaldırıldı, koşudaki TÜM atlar yazılır.
      // Şablonun her blokta ayrılmış güvenli satır kapasitesi ~24'tür (bir sonraki
      // bloğun başlığına taşmamak için); gerçekçi bir yarışta bu sayı hiç aşılmaz,
      // yalnızca aşırı uçtaki bir olasılığa karşı güvenlik payı olarak kalır.
      // ODS satır düzeni tahmin ekranından bağımsızdır: her ayakta SONUÇ puanı
      // küçükten büyüğe yazılır. SONUÇ puanı yoksa şablondaki aynı yaklaşık formülle
      // hesaplanan değer kullanılır.
      let ord1 = sortHorsesBySonuc(r1.horses);
      ord1.slice(0,24).forEach((h, idx) => {
        let ridx = dataStart + idx;
        odfSetCell(doc, rows, ridx, odfColIndex('A'), h.horse_no);
        odfSetCell(doc, rows, ridx, odfColIndex('B'), h.horse_name);
        odfSetCell(doc, rows, ridx, odfColIndex('C'), tkpExportJByg(h));
        odfSetCell(doc, rows, ridx, odfColIndex('D'), h.agf);
        odfSetCell(doc, rows, ridx, odfColIndex('E'), tkpExport800G(h));
        odfSetCell(doc, rows, ridx, odfColIndex('F'), h.hndkp);
        odfSetCell(doc, rows, ridx, odfColIndex('G'), h.tr);
        // Derece atın tahmin sırasına değil resmi sonucuna aittir. Kazanan veya
        // ilk 5'e giren at tabloda kaçıncı satırda olursa olsun ODS'ye yazılır.
        const fpLeft = [1,2,3,4,5].includes(Number(h.finish_position)) ? Number(h.finish_position) : (Number(h.winner)===1 ? 1 : null);
        if (fpLeft != null) odfSetCell(doc, rows, ridx, odfColIndex('M'), fpLeft);
        writeYpuanTotal(b, h.horse_no, 'J', h.ypuan);
        writeInnerRaceYpuan(rows[ridx], 'left', h.ypuan);
      });
    }
    if (r2){
      odfSetCell(doc, rows, titleI, odfColIndex('Q'), r2.distance);
      odfSetCell(doc, rows, titleI, odfColIndex('R'), abbrevSurface(r2.surface));
      odfSetCell(doc, rows, titleI, odfColIndex('S'), abbrevBreed(r2.breed));
      odfSetCell(doc, rows, headerI, odfColIndex('O'), r2.condition_text);
      let ord2 = sortHorsesBySonuc(r2.horses);
      ord2.slice(0,24).forEach((h, idx) => {
        let ridx = dataStart + idx;
        odfSetCell(doc, rows, ridx, odfColIndex('N'), h.horse_no);
        odfSetCell(doc, rows, ridx, odfColIndex('O'), h.horse_name);
        odfSetCell(doc, rows, ridx, odfColIndex('P'), tkpExportJByg(h));
        odfSetCell(doc, rows, ridx, odfColIndex('Q'), h.agf);
        odfSetCell(doc, rows, ridx, odfColIndex('R'), tkpExport800G(h));
        odfSetCell(doc, rows, ridx, odfColIndex('S'), h.hndkp);
        odfSetCell(doc, rows, ridx, odfColIndex('T'), h.tr);
        const fpRight = [1,2,3,4,5].includes(Number(h.finish_position)) ? Number(h.finish_position) : (Number(h.winner)===1 ? 1 : null);
        if (fpRight != null) odfSetCell(doc, rows, ridx, odfColIndex('Z'), fpRight);
        writeYpuanTotal(b, h.horse_no, 'U', h.ypuan);
        writeInnerRaceYpuan(rows[ridx], 'right', h.ypuan);
      });
    }
  }

  // ODS şablonundaki sabit tarihi, klasörden/HTML bülteninden okunan gerçek yarış
  // tarihiyle değiştir. Şablonda kalan 12.07.2026 gibi eski bir tarih asla korunmamalı.
  const sourceRaceDate = (races || []).map(r => r && r.race_date).find(Boolean) || '';
  if (sourceRaceDate){
    const m = String(sourceRaceDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateTR = m ? `${m[3]}.${m[2]}.${m[1]}` : String(sourceRaceDate);
    const allParagraphs = [...doc.getElementsByTagNameNS('*','p')];
    const dateParagraph = allParagraphs.find(el => /(?:TARİH|TARIH)\s*[:：-]?\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/iu.test(el.textContent || ''));
    if (dateParagraph){
      dateParagraph.textContent = `TARİH: ${dateTR}`;
    } else {
      // Şablon değişirse de tarih kaybolmasın: RACE sayfasının ilk hücresine yaz.
      if (rows.length) odfSetCell(doc, rows, 0, 0, `TARİH: ${dateTR}`);
    }
  }

  // Şablondaki formüllü hücrelerin ÇOĞU (biz sadece bir kısmına odfSetCell ile veri
  // yazıyoruz) hâlâ şablonun kendi eski önbellek değerini (office:value / text:p içeriği)
  // taşıyor. Eğer dosyayı açan program (LibreOffice/Excel/mobil görüntüleyici) açılışta
  // tam yeniden hesaplama yapmıyorsa, bu binlerce hücre (ATNO, YPUAN, BMB vb. dahil) YENİ
  // veriyle değil, ŞABLONDAKİ ESKİ değerlerle görünür. ODF standardına göre önbellek
  // değeri yoksa uygulama formülü hesaplamak ZORUNDADIR -- bu yüzden formülü olan TÜM
  // hücrelerin önbelleğini burada siliyoruz, böylece her açılışta gerçek veriyle
  // yeniden hesaplanmaları garanti altına alınıyor.
  const allFormulaCells = [...doc.getElementsByTagNameNS('*','table-cell')]
    .filter(c => c.getAttributeNS(ODF_NS.table,'formula'));
  for (const cell of allFormulaCells){
    if (cell.getAttributeNS(ODF_NS.office,'value')) cell.removeAttributeNS(ODF_NS.office,'value');
    if (cell.getAttributeNS(ODF_NS.office,'value-type')) cell.removeAttributeNS(ODF_NS.office,'value-type');
    if (cell.getAttributeNS(ODF_NS.office,'string-value')) cell.removeAttributeNS(ODF_NS.office,'string-value');
    while (cell.firstChild) cell.removeChild(cell.firstChild);
  }

  let serializer = new XMLSerializer();
  let newContentXml = serializer.serializeToString(doc);

  const enc = new TextEncoder();
  let files = [
    {name:'mimetype', data: enc.encode(ODS_TPL_MIMETYPE)},
    {name:'META-INF/manifest.xml', data: enc.encode(ODS_TPL_MANIFEST)},
    {name:'meta.xml', data: enc.encode(ODS_TPL_META)},
    {name:'settings.xml', data: enc.encode(ODS_TPL_SETTINGS)},
    {name:'styles.xml', data: enc.encode(ODS_TPL_STYLES)},
    {name:'content.xml', data: enc.encode(newContentXml)},
  ];
  let zipBytes = buildZipStore(files);
  return new Blob([zipBytes], {type: 'application/vnd.oasis.opendocument.spreadsheet'});
}

// Kayıtlı tüm dosyaları, her biri kendi ODS'si olarak, tek bir ZIP içinde indirir —
// JSON yedeğinin yanında, gözle görülebilir/LibreOffice'te açılabilir bir yedek daha.

function tkpOdsZipSafeDownloadName(fileLike){
  const f=fileLike||{};
  let seq=f.sequence_no;
  const rawName=String(f.filename||f.original_filename||'');
  const seqMatch=rawName.match(/TKP[_ -]*(?:AI|AL)[_ -]*(\d{1,4})/i);
  if((seq==null || seq==='') && seqMatch) seq=Number(seqMatch[1]);
  const seqText=String(Number(seq)||0).padStart(3,'0');
  let hip = '';
  try {
    hip = typeof canonicalHippodrome==='function' ? canonicalHippodrome(f.hippodrome||'') : (f.hippodrome||'');
  } catch(_e){ hip = f.hippodrome||''; }
  if(!hip || hip==='BİLİNMİYOR') return `TKP_AI_${seqText}.ods`;
  hip = String(hip).toLocaleUpperCase('tr-TR').replace(/\s+/g,'');
  return `TKP_AI_${seqText}-${hip}.ods`;
}

function tkpOdsZipSafeDownloadBase(fileLike){
  return tkpOdsZipSafeDownloadName(fileLike).replace(/\.ods$/i,'');
}

async function downloadAllFilesAsOdsZip(){
  if (!db.files.length){ alert('Kayıtlı dosya yok.'); return; }
  await tkpEnsureOdsTemplate();
  // V1.1.281 BELLEK KÖK FIX: yüzlerce ODS byte dizisini tek entries[] içinde
  // tutup en sonda dev ZIP üretmek peak RAM'i katlıyordu. Arşiv büyüdükçe bu yol
  // tek başına sekmeyi öldürebilirdi. Çıktı artık en fazla 40 dosya / ~48 MB ham
  // veri içeren parçalara bölünür; her parça indirildikten sonra byte referansları
  // bırakılır ve tarayıcıya yield edilir. 1-40 dosyada eski tek-ZIP davranışı korunur.
  const MAX_FILES_PER_ZIP=40, MAX_RAW_BYTES_PER_ZIP=48*1024*1024;
  let entries=[],rawBytes=0,processed=0,part=0,downloaded=0;
  const date=new Date().toISOString().slice(0,10);
  const flush=async(force=false)=>{
    if(!entries.length)return;
    if(!force&&entries.length<MAX_FILES_PER_ZIP&&rawBytes<MAX_RAW_BYTES_PER_ZIP)return;
    part++;
    const zipBytes=buildZipStore(entries);
    const zipBlob=new Blob([zipBytes],{type:'application/zip'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(zipBlob);
    a.download=`TKP_TUM_DOSYALAR_${date}${part>1||processed<db.files.length?`_PARCA_${String(part).padStart(2,'0')}`:''}.zip`;
    document.body.appendChild(a);a.click();a.remove();
    const href=a.href;setTimeout(()=>URL.revokeObjectURL(href),1500);
    downloaded+=entries.length; entries=[]; rawBytes=0;
    if(typeof tkpYield==='function')await tkpYield(); else await new Promise(r=>setTimeout(r,0));
  };
  for (const f of db.files){
    const races=(typeof tkpRowsByFileId==='function'?tkpRowsByFileId(f.id):db.races.filter(r=>r.file_id===f.id)).filter(Boolean).slice().sort((a,b)=>a.leg-b.leg);
    if(!races.length)continue;
    const odsName=(typeof tkpOdsDownloadFilename==='function')?tkpOdsDownloadFilename(f):tkpOdsZipSafeDownloadName(f);
    const blob=buildOdsFromRaces(races,odsName.replace(/\.ods$/i,''));
    const bytes=new Uint8Array(await blob.arrayBuffer());
    // Mevcut parça doluysa yeni büyük girdiyi eklemeden önce boşalt; böylece
    // threshold üzerinde iki büyük kopya aynı anda tutulmaz.
    if(entries.length&&(entries.length>=MAX_FILES_PER_ZIP||rawBytes+bytes.byteLength>MAX_RAW_BYTES_PER_ZIP))await flush(true);
    entries.push({name:odsName,data:bytes});rawBytes+=bytes.byteLength;processed++;
    if(processed%4===0){if(typeof tkpYield==='function')await tkpYield();else await new Promise(r=>setTimeout(r,0));}
  }
  if(!processed){alert('Hiçbir dosyaya bağlı koşu kaydı yok.');return;}
  await flush(true);
  if(part>1&&typeof console!=='undefined')console.info(`[TKP] ${downloaded} ODS, peak belleği sınırlamak için ${part} ZIP parçasına bölündü.`);
}

async function downloadOdsFromRaces(races, filename){
  await tkpEnsureOdsTemplate();
  let blob = buildOdsFromRaces(races, filename);
  let a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.ods') ? filename : (filename + '.ods');
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1500);
}

// Tek bir koşuyu (ayağı) indirmek için: az önce yüklenen bülten/ODS'nin (window.__lastPredictionPayload)
// ilgili ayağını bulup tek başına indirir. legInfoBarHTML() içindeki "Bu koşuyu indir" butonu çağırır.
function downloadSingleRaceOds(leg){
  let p = window.__lastPredictionPayload;
  if (!p){ alert('Önce bir ODS ya da bülten yükle.'); return; }
  let race = p.races.find(r => r.leg === leg);
  if (!race){ alert(leg + '. ayak bulunamadı.'); return; }
  let base = (p.file.filename||'tkp_export').replace(/\.(html?|ods)$/i,'');
  downloadOdsFromRaces([race], `${base}_ayak${leg}`);
}
