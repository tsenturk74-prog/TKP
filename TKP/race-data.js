// Yarış/at veri modeli: normalizasyon, ODS içe aktarma, profil/koşul anahtarları.

// Dosya nesnesi aynı klasör akışında 1. ve 2. Altılı için yeniden kullanılır.
const _tkpFileTextCache = new WeakMap();
const _tkpFileBufferCache = new WeakMap();

function tkpReadFileText(file){
  if(!file || typeof file.text!=='function') return Promise.reject(new Error('Dosya metni okunamıyor.'));
  let pending=_tkpFileTextCache.get(file);
  if(!pending){
    pending=Promise.resolve().then(()=>file.text());
    _tkpFileTextCache.set(file,pending);
  }
  return pending;
}

function tkpReadFileArrayBuffer(file){
  if(!file || typeof file.arrayBuffer!=='function') return Promise.reject(new Error('Dosya içeriği okunamıyor.'));
  let pending=_tkpFileBufferCache.get(file);
  if(!pending){
    pending=Promise.resolve().then(()=>file.arrayBuffer());
    _tkpFileBufferCache.set(file,pending);
  }
  return pending;
}

async function tkpPrefetchFiles(files, concurrency=8){
  const queue=(files||[]).filter(f=>f && !_v25IsFolderAssetFile(f)).slice();
  let next=0;
  const workers=Array.from({length:Math.max(1,Math.min(concurrency,queue.length||1))},async()=>{
    while(next<queue.length){
      const index=next++;
      const file=queue[index];
      try{
        if(/\.ods$/i.test(String(file.name||''))) await tkpReadFileArrayBuffer(file);
        else await tkpReadFileText(file);
      }catch(_){}
      if(index>0 && index%20===0) await tkpYieldToBrowser();
    }
  });
  await Promise.all(workers);
}

function tkpYieldToBrowser(){
  return new Promise(resolve=>{
    if(typeof requestIdleCallback==='function') requestIdleCallback(()=>resolve(),{timeout:40});
    else setTimeout(resolve,0);
  });
}


const _tkpBroadConditionKeyCache=new Map();
const _tkpExactConditionKeyCache=new WeakMap();
function broadConditionKey(text){
  const raw=String(text||'');
  if(_tkpBroadConditionKeyCache.has(raw))return _tkpBroadConditionKeyCache.get(raw);
  let x = fold(raw);
  if (!x) return 'BİLİNMİYOR';
  const out=/HAND[İI]KAP/.test(x)?'HANDİKAP'
    :/MAIDEN/.test(x)?'MAIDEN'
    :/ŞARTLI|SARTLI/.test(x)?'ŞARTLI'
    :/SAT[İI]Ş|SATIS/.test(x)?'SATIŞ'
    :/\bKV[- ]?\d/.test(x)?'KV'
    :/\bG\s*\d\b|AÇIK|ACIK/.test(x)?'GRUP/AÇIK':x;
  _tkpBroadConditionKeyCache.set(raw,out);
  return out;
}

function exactConditionKey(r){
  if(!r||typeof r!=='object')return fold('');
  const raw=String(r?.condition_text||r?.condition_family||'');
  const cached=_tkpExactConditionKeyCache.get(r);
  if(cached&&cached.raw===raw)return cached.value;
  const value=fold(raw);_tkpExactConditionKeyCache.set(r,{raw,value});return value;
}

function raceProfileLabel(r){
  return [exactConditionKey(r), r?.distance ? String(r.distance)+' m' : '', normalizeSurface(r?.surface), displayHippodromeShort(r?.hippodrome), normalizeBreed(r?.breed)].filter(Boolean).join(' · ');
}

function similarReferenceSignature(r){
  const cond=fold(r?.condition_text || r?.condition_family || '');
  return [cond,Number(r?.distance)||0,normalizeSurface(r?.surface),normalizeBreed(r?.breed),fold(r?.hippodrome)].join('|');
}

function configuredSimilarReferenceRows(target, all){
  try{
    const pools=db?.settings?.similar_reference_pools;
    if(!pools || typeof pools!=='object') return [];
    const pool=pools[similarReferenceSignature(target)];
    if(!pool || !Array.isArray(pool.raceIds) || pool.raceIds.length<10) return [];
    const wanted=new Set(pool.raceIds.map(String));
    return all.filter(r=>wanted.has(String(r.id)));
  }catch(_){ return []; }
}

let _tkpProfileCandidatesIndexBuildPromise=null;
async function tkpEnsureProfileCandidatesIndexAsync(options={}){
  const all=learningEligibleRaces();
  if(_profileCandidatesIndexCache.revision===_tkpDbRevision&&_profileCandidatesIndexCache.rows===all&&_profileCandidatesIndexCache.index)return true;
  if(_tkpProfileCandidatesIndexBuildPromise)return _tkpProfileCandidatesIndexBuildPromise;
  const pause=typeof options.pause==='function'?options.pause:()=>new Promise(resolve=>setTimeout(resolve,0));
  _tkpProfileCandidatesIndexBuildPromise=(async()=>{
    const index={full:new Map(),condDistSurfBreed:new Map(),condDistSurf:new Map(),condDgSurf:new Map(),cond:new Map(),near:new Map()};
    const add=(map,key,row)=>{let rows=map.get(key);if(!rows){rows=[];map.set(key,rows);}rows.push(row);};
    const keyOf=(...parts)=>parts.join('\u001f');
    for(let i=0;i<all.length;i++){
      const row=all[i];
      const rowCond=exactConditionKey(row),rowDist=Number(row?.distance||0),rowSurf=normalizeSurface(row?.surface),rowHip=fold(row?.hippodrome),rowBreed=normalizeBreed(row?.breed),rowDg=distanceGroup(rowDist);
      add(index.full,keyOf(rowCond,rowDist,rowSurf,rowHip,rowBreed),row);
      add(index.condDistSurfBreed,keyOf(rowCond,rowDist,rowSurf,rowBreed),row);
      add(index.condDistSurf,keyOf(rowCond,rowDist,rowSurf),row);
      add(index.condDgSurf,keyOf(rowCond,rowDg,rowSurf),row);
      add(index.cond,rowCond,row);
      add(index.near,keyOf(broadConditionKey(row?.condition_family),rowDg,rowSurf,rowBreed),row);
      if((i&31)===31)await pause();
    }
    // DB değiştiyse eski indeks yeni revizyona yazılmasın.
    if(all===learningEligibleRaces())_profileCandidatesIndexCache={revision:_tkpDbRevision,rows:all,index};
    return true;
  })();
  try{return await _tkpProfileCandidatesIndexBuildPromise;}
  finally{_tkpProfileCandidatesIndexBuildPromise=null;}
}
if(typeof globalThis!=='undefined')globalThis.tkpEnsureProfileCandidatesIndexAsync=tkpEnsureProfileCandidatesIndexAsync;

function profileCandidates(target){
  // Kesim anahtarı yalnız cache doğruluğu içindir; aday indeksini tekrar inşa
  // etmeyiz. Her indexten çıkan dizi aşağıda merkezî zaman kapısından geçirilir.
  const cutoff=typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(target,db):'';
  const profileSignature=[_tkpDbRevision,cutoff,exactConditionKey(target),Number(target?.distance||0),normalizeSurface(target?.surface),fold(target?.hippodrome),normalizeBreed(target?.breed)].join('|');
  const cached=target&&typeof target==='object'?_profileCandidatesCache.get(target):null;
  if(cached?.signature===profileSignature)return cached.value;
  const all=learningEligibleRaces();
  const cond=exactConditionKey(target), dist=Number(target?.distance||0), surf=normalizeSurface(target?.surface), hip=fold(target?.hippodrome), breed=normalizeBreed(target?.breed);
  const dg=distanceGroup(dist);
  const configured=configuredSimilarReferenceRows(target,all);
  // Her hedef profil için arşivi altı kez filter etmek, BH/ODB taramasında
  // 503 toplantı x binlerce profil seviyesinde katlanıyordu. Aynı eşitlik
  // anahtarları DB revizyonu başına tek geçişte indekslenir; dizi sırası eski
  // filter sırasıyla aynıdır.
  if(_profileCandidatesIndexCache.revision!==_tkpDbRevision||_profileCandidatesIndexCache.rows!==all||!_profileCandidatesIndexCache.index){
    // R17.1: Kupon düğmesinin kritik yolunda 3.000+ yarışlık profil indeksini
    // senkron kurma. Ağır indeks arka planda kooperatif olarak hazırlanır; bu
    // ilk soğuk tıklamada profil kanıtı yerine mevcut puan/kanonik sıralama
    // kullanılır. Cache hazır olduğunda sonraki hesaplar tam geçmişi kullanır.
    if(typeof globalThis!=='undefined'&&globalThis.__tkpCouponCriticalPath===true){
      Promise.resolve(tkpEnsureProfileCandidatesIndexAsync({pause:tkpYieldToBrowser})).catch(()=>{});
      const value=[];
      if(target&&typeof target==='object')_profileCandidatesCache.set(target,{signature:profileSignature,value});
      return value;
    }
    const index={full:new Map(),condDistSurfBreed:new Map(),condDistSurf:new Map(),condDgSurf:new Map(),cond:new Map(),near:new Map()};
    const add=(map,key,row)=>{let rows=map.get(key);if(!rows){rows=[];map.set(key,rows);}rows.push(row);};
    const keyOf=(...parts)=>parts.join('\u001f');
    for(const row of all){
      const rowCond=exactConditionKey(row),rowDist=Number(row?.distance||0),rowSurf=normalizeSurface(row?.surface),rowHip=fold(row?.hippodrome),rowBreed=normalizeBreed(row?.breed),rowDg=distanceGroup(rowDist);
      add(index.full,keyOf(rowCond,rowDist,rowSurf,rowHip,rowBreed),row);
      add(index.condDistSurfBreed,keyOf(rowCond,rowDist,rowSurf,rowBreed),row);
      add(index.condDistSurf,keyOf(rowCond,rowDist,rowSurf),row);
      add(index.condDgSurf,keyOf(rowCond,rowDg,rowSurf),row);
      add(index.cond,rowCond,row);
      add(index.near,keyOf(broadConditionKey(row?.condition_family),rowDg,rowSurf,rowBreed),row);
    }
    _profileCandidatesIndexCache={revision:_tkpDbRevision,rows:all,index};
  }
  const index=_profileCandidatesIndexCache.index,keyOf=(...parts)=>parts.join('\u001f');
  // İndeks yapısı sadece hız içindir; hedefin geleceğinden gelen satırlar indeks
  // içinde bulunabilir ama ASLA çağırana geçmez. Böylece 503 kartlık walk-forward
  // testte hem O(1) profil erişimi hem de fail-closed zaman kesimi korunur.
  const train=rows=>target&&typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget(rows||[],target,db)
    :(rows||[]);
  const value=[
    ...(configured.length>=10 ? [{level:'🧠 Seçili benzer yarış havuzu', label:`${configured.length} doğrulanmış benzer yarış`, rows:train(configured)}] : []),
    {level:'Tam profil', label:raceProfileLabel(target), rows:train(index.full.get(keyOf(cond,dist,surf,hip,breed))||[])},
    {level:'Şart + mesafe + pist + tür', label:[cond,dist?dist+' m':'',surf,breed].filter(Boolean).join(' · '), rows:train(index.condDistSurfBreed.get(keyOf(cond,dist,surf,breed))||[])},
    {level:'Şart + mesafe + pist', label:[cond,dist?dist+' m':'',surf].filter(Boolean).join(' · '), rows:train(index.condDistSurf.get(keyOf(cond,dist,surf))||[])},
    {level:'Şart + mesafe grubu + pist', label:[cond,dg,surf].filter(Boolean).join(' · '), rows:train(index.condDgSurf.get(keyOf(cond,dg,surf))||[])},
    {level:'Tam koşu şartı', label:cond, rows:train(index.cond.get(cond)||[])},
    {level:'Yakın profil', label:[broadConditionKey(cond),dg,surf,breed].join(' · '), rows:train(index.near.get(keyOf(broadConditionKey(cond),dg,surf,breed))||[])}
  ];
  if(target&&typeof target==='object')_profileCandidatesCache.set(target,{signature:profileSignature,value});
  return value;
}

function finishMarkInfo(h){
  if (!h) return null;
  const fp = Number(h.finish_position);
  // KÖK FIX: Eskiden yalnız `h.winner===1` (katı tip, Number() çevrimi yok) 1. sırayı
  // tanıyordu; finish_position 1 için hiç kontrol edilmiyordu ([2,3,4,5] listesi 1'i
  // içermiyordu). Sonuç olarak winner alanı 1 numaralı sayı olarak senkron değilse
  // (örn. string "1" ya da eksik) gerçekten kazanan at satırı yeşil vurgulanmıyordu.
  // Artık kod tabanındaki diğer tüm kazanan kontrolleriyle (raceHasConfirmedResult,
  // isWinner vb.) aynı standart: Number(winner)===1 || finish_position===1.
  if (Number(h.winner) === 1 || fp === 1) return {pos:1, label:'1.', title:'Gerçek sonuç: Birinci geldi', cls:'p1'};
  if ([2,3,4,5].includes(fp)) return {pos:fp, label:fp+'.', title:'Gerçek sonuç: '+fp+'. geldi', cls:'p'+fp};
  return null;
}

function finishMarkClass(h){
  const info = finishMarkInfo(h);
  return info ? ' finishChip finishNo-'+info.cls : '';
}

function finishMarkTitle(h){
  const info = finishMarkInfo(h);
  return info ? info.title : '';
}

function raceHasConfirmedResult(raceHorses){
  if (!Array.isArray(raceHorses) || !raceHorses.length) return false;
  // Sonuç girilmemiş koşularda eski/boş derece alanları yanlışlıkla sonuç gibi görünmesin.
  // Gerçek sonuç görünümü ancak koşuda açıkça bir 1. mevcutsa açılır.
  return raceHorses.some(h => Number(h.winner) === 1 || Number(h.finish_position) === 1);
}

function finishMarkClassByHorseNo(no, raceHorses){
  if (!raceHasConfirmedResult(raceHorses)) return '';
  const key = String(no ?? '').trim();
  const h = raceHorses.find(x => String(x.horse_no ?? '').trim() === key);
  return h ? finishMarkClass(h) : '';
}

function finishMarkPlainClassByHorseNo(no, raceHorses){
  if (!raceHasConfirmedResult(raceHorses)) return '';
  const key = String(no ?? '').trim();
  const h = raceHorses.find(x => String(x.horse_no ?? '').trim() === key);
  const info = h ? finishMarkInfo(h) : null;
  return info ? ' finishNo-'+info.cls : '';
}

function finishMarkTitleByHorseNo(no, raceHorses){
  if (!raceHasConfirmedResult(raceHorses)) return '';
  const key = String(no ?? '').trim();
  const h = raceHorses.find(x => String(x.horse_no ?? '').trim() === key);
  return h ? finishMarkTitle(h) : '';
}

function tkpExplicitNonRunnerText(value){
  const text=fold(value||'').replace(/\s+/g,' ').trim();
  if(!text) return false;
  // KÖK KURAL: At adının içinde geçen kelime parçaları koşmama sinyali değildir.
  // Örn. gerçek at adı "TÜMÇIKMAZ" normal koşucudur; yalnız açık durum etiketi kabul edilir.
  return /(?:^|[\s(])(?:KOŞMAZ|KOSMAZ|ÇEKİLDİ|CEKILDI|KOŞMUYOR|KOSMUYOR|KOŞMAYACAK|KOSMAYACAK|START ALMADI|START ALMAZ|DEKLARE DIŞI|DEKLARE DISI|SCRATCHED|WITHDRAWN)(?:$|[\s)])/u.test(text);
}

function tkpTjkRowIsExplicitNonRunner(tr,nameCell,nameLink){
  if(!tr||!nameCell) return false;
  const linkKClass=!!(nameLink && /(^|\s)k(\s|$)/.test(nameLink.getAttribute('class')||''));
  const struck=!!(nameCell.querySelector('s,strike,del')
    || /line-through/i.test(nameCell.getAttribute('style')||'')
    || /line-through/i.test(tr.getAttribute('style')||''));
  if(linkKClass||struck) return true;
  // TJK'de açık "(Koşmaz)" etiketi isim hücresinde/ayrı bir durum elemanında gelir.
  // Tüm satır metninde genel kelime aramak yasak: at adları yanlış pozitif üretebilir.
  if(tkpExplicitNonRunnerText(nameCell.textContent||'')) return true;
  const statusNodes=[...tr.querySelectorAll('font,span,em,strong,small')];
  return statusNodes.some(el=>{
    if(nameLink && (el===nameLink || nameLink.contains(el))) return false;
    const t=fold(el.textContent||'').replace(/\s+/g,' ').trim();
    return /^(?:\(?\s*)?(?:KOŞMAZ|KOSMAZ|ÇEKİLDİ|CEKILDI|KOŞMUYOR|KOSMUYOR|KOŞMAYACAK|KOSMAYACAK|START ALMADI|START ALMAZ|DEKLARE DIŞI|DEKLARE DISI|SCRATCHED|WITHDRAWN)(?:\s*\)?)$/u.test(t);
  });
}

const _tkpNonRunnerCache=new WeakMap();
function isNonRunner(h){
  if(!h||typeof h!=='object')return false;
  const signature=[h.non_runner,h.is_non_runner,h.scratched,h.usa_scratched,h.atr_non_runner,h.horse_name].join('|');
  const cached=_tkpNonRunnerCache.get(h);if(cached?.signature===signature)return cached.value;
  // E1/E2/E3 eküri bilgisidir; koşmama işareti değildir ve tahminde kalır.
  if(Number(h?.non_runner)===1 || Number(h?.is_non_runner)===1 || Number(h?.scratched)===1 || Number(h?.usa_scratched)===1 || Number(h?.atr_non_runner)===1){_tkpNonRunnerCache.set(h,{signature,value:true});return true;}
  // Yalnız açık durum etiketi. "TÜMÇIKMAZ" gibi gerçek at adları ASLA koşmaz sayılmaz.
  const name=fold(h?.horse_name||'').replace(/\s+/g,' ').trim();
  const value=/(?:^|[\s(])(?:KOŞMAZ|KOSMAZ|START ALMADI|START ALMAZ|SCRATCHED|WITHDRAWN|DEKLARE DIŞI|DEKLARE DISI)(?:$|[\s)])/u.test(name);
  _tkpNonRunnerCache.set(h,{signature,value});return value;
}

function isPastWinningBmb(h){
  // Güncel sıralamada geriye düşse bile daha önce kazandırmış BMB adayını koru.
  // Koşu şartı geçmişi veya genel geçmişte en az bir galibiyet yeterlidir.
  return h && h.bmb===1 && ((h.condWinWins||0)>0 || (h.priorWins||0)>0 || historyStrengthForCandidate(h)>0);
}

function isPastWinningExtra(r, h){
  if(!h) return false;
  const isExtraSignal=(h.result_rank!=null && h.result_rank<=6) || h.bmb===1 ||
    (historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30) ||
    historicalSurpriseProfileMatch(r,h).matched;
  const wonBefore=(h.condWinWins||0)>0 || (h.priorWins||0)>0;
  return isExtraSignal && wonBefore;
}

function isOdbCandidate(h, r){
  if(!h) return false;

  // V1.1.91 — ODB = 2. sürpriz sinyali / ODS DIŞI BOMBA.
  // KESİN DIŞLAMA ŞARTLARI (kullanıcı tanımı):
  //   1) BMB olmayacak,
  //   2) SONUÇ sırası ilk 6'da olmayacak,
  //   3) AGF sırası ilk 6'da olmayacak.
  // Y.PUAN ODB'yi ne kurar ne de engeller. ODB ayrıca geçmiş veride kazanabilir
  // olduğuna dair pozitif kanıt ister; salt "ilk 6 dışında" olmak yeterli değildir.
  if (Number(h.bmb)===1) return false;

  const resultRank=Number(h.result_rank);
  if (Number.isFinite(resultRank) && resultRank<=6) return false;

  const agfRank=Number(h.agf_rank);
  if (Number.isFinite(agfRank) && agfRank<=6) return false;

  const wonBefore = (Number(h.priorWins)||0)>0 || (Number(h.condWinWins)||0)>0;
  const surpriseEvidence = (Number(h.priorSurpriseHits)||0)>0 || (Number(h.condSurpriseHits)||0)>0;
  // Eski yarış tablosu yalnız kayıtlı snapshot alanlarını okur. Bu satırda
  // historicalSurpriseProfileMatch() çağrısı yapılırsa soğuk açılışta bütün
  // geçmiş profil havuzu yeniden taranır; arşivde mevcut pozitif kanıt alanları
  // ODB kararı için yeterlidir. Canlı yol aşağıdaki tam profile eşleşmesini korur.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r)){
    // R18.6.1: Arşivde salt historyStrength>0 artık ODB üretmez. Bu değer tek bir
    // zayıf geçmiş işaretten pozitif olabildiği için kalabalık ayaklarda 4-5 ODB
    // çıkarabiliyordu. ODB için kayıtlı ODB etiketi, gerçek geçmiş galibiyet veya
    // doğrulanmış sürpriz isabet kanıtı gerekir.
    return !!(wonBefore||surpriseEvidence||Number(h?.odb)===1);
  }
  const profileMatch = r && typeof historicalSurpriseProfileMatch==='function'
    ? !!historicalSurpriseProfileMatch(r,h)?.matched
    : false;
  // Canlıda da historyStrength tek başına yeterli değildir; gerçek galibiyet,
  // sürpriz isabet veya doğrulanmış benzer-profil eşleşmesi gerekir.
  if (!wonBefore && !surpriseEvidence && !profileMatch) return false;

  return true;
}

function isExtraBadgeSignal(r, h){
  if(!h) return false;
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r)){
    return (h.result_rank!=null && h.result_rank<=6) || h.bmb===1 || Number(h.odb)===1 ||
      (historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30) ||
      (h.agf_rank===1 && Number(h.agf)>=18) || (h.hndkp_rank!=null && h.hndkp_rank<=2) ||
      (Number(h.tr_bmb_candidate)===1 || Number(h.tr_hidden_fav)===1);
  }
  return isOdbCandidate(h,r) || (h.result_rank!=null && h.result_rank<=6) || h.bmb===1 ||
    (historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30) ||
    historicalSurpriseProfileMatch(r,h).matched ||
    (h.agf_rank===1 && Number(h.agf)>=18) ||
    (h.hndkp_rank!=null && h.hndkp_rank<=2) ||
    profileStrengthPct(r,h)>=35;
}

function normalizeSurface(s){ let x=fold(s); if (x.startsWith('SENT')) return 'SENTETİK'; if (x.includes('KUM')) return 'KUM'; if (x.includes('ÇİM')||x.includes('CIM')) return 'ÇİM'; return x || 'BİLİNMİYOR'; }

function normalizeBreed(s){ let x=fold(s); if (x.includes('ARP')||x.includes('ARAP')) return 'ARAP'; if (x.includes('İNG')||x.includes('ING')) return 'İNGİLİZ'; return x || 'BİLİNMİYOR'; }

function canonicalHippodrome(s){
  let x=fold(s).replace(/[()\[\],]/g,' ').replace(/\s+/g,' ').trim();
  x=x.replace(/\b(ABD|USA|AMERİKA|AMERIKA|KANADA|FRANSA|İNGİLTERE|INGILTERE|İRLANDA|IRLANDA|ALMANYA|İTALYA|ITALYA|AVUSTRALYA|JAPONYA|HONG KONG)\b/g,' ').replace(/\s+/g,' ').trim();
  const aliases={
    'DELMAR':'DEL MAR','DEL-MAR':'DEL MAR','SANTAANITA':'SANTA ANITA','SANTA ANITA PARK':'SANTA ANITA','GULFSTREAM':'GULFSTREAM PARK','GULFSTREAM PARK':'GULFSTREAM PARK','KEENELAND':'KEENELAND','PARX':'PARX RACING','PARX RACING':'PARX RACING','DELAWARE':'DELAWARE PARK','DELAWARE PARK':'DELAWARE PARK','HORSESHOE INDIANAPOLIS':'HORSESHOE INDIANAPOLIS','FINGER LAKES':'FINGER LAKES','MONT DE MARSAN':'MONT-DE-MARSAN',
    'SANLIURFA':'ŞANLIURFA','DIYARBAKIR':'DİYARBAKIR','ELAZIG':'ELAZIĞ',
    'ISTANBUL':'İSTANBUL','IZMIR':'İZMİR','KOCAELI':'KOCAELİ'
  };
  return aliases[x] || x || 'BİLİNMİYOR';
}

// Yalnız EKRAN için kısa pist/hipodrom adı. Veri bankasındaki canonicalHippodrome()
// kimliğine dokunmaz; böylece geçmiş eşleşme/backtest anahtarları değişmez.
function displayHippodromeShort(s){
  const raw=String(s??'').trim();
  if(!raw) return '';
  let key=fold(raw);
  try{ key=key.normalize('NFD').replace(/[\u0300-\u036f]/g,''); }catch(_e){}
  key=key.replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C')
    .replace(/\b(SILI|CHILE|ABD|USA|KANADA|FRANSA|INGILTERE|IRLANDA|ALMANYA|ITALYA|AVUSTRALYA|JAPONYA|HONG KONG)\b/g,' ')
    .replace(/[()\[\],]/g,' ').replace(/\s+/g,' ').trim();
  const contains=(token)=>key.includes(token);
  const domesticDisplay={
    'DIYARBAKIR':'DİYARBAKIR','ELAZIG':'ELAZIĞ','ISTANBUL':'İSTANBUL',
    'IZMIR':'İZMİR','KOCAELI':'KOCAELİ','SANLIURFA':'ŞANLIURFA'
  };
  if(domesticDisplay[key]) return domesticDisplay[key];
  if(contains('CONCEPCION')) return 'CONCEPCION';
  if(contains('SANTIAGO') && (contains('HIPICO')||contains('HÍPICO'))) return 'SANTIAGO';
  if(contains('HORSESHOE INDIANAPOLIS')||key==='INDIANAPOLIS') return 'INDIANAPOLIS';
  if(contains('GULFSTREAM')) return 'GULFSTREAM';
  if(contains('SANTA ANITA')) return 'SANTA ANITA';
  if(/^PARX(?: |$)/.test(key)||contains('PARX RACING')) return 'PARX';
  if(contains('DELAWARE')) return 'DELAWARE';
  if(contains('SARATOGA')) return 'SARATOGA';
  if(contains('DEL MAR')||contains('DELMAR')) return 'DEL MAR';
  if(contains('KEENELAND')) return 'KEENELAND';
  if(contains('FINGER LAKES')) return 'FINGER LAKES';
  if(contains('VALPARAISO')) return 'VALPARAISO';
  if(contains('SAN ISIDRO')) return 'SAN ISIDRO';
  if(contains('PALERMO')) return 'PALERMO';
  if(contains('MARONAS')) return 'MARONAS';
  if(contains('WOODBINE')) return 'WOODBINE';
  if(contains('LAUREL')) return 'LAUREL';
  if(contains('CHURCHILL DOWNS')) return 'CHURCHILL DOWNS';
  if(contains('KENTUCKY DOWNS')) return 'KENTUCKY DOWNS';
  if(contains('HIPODROMO CHILE')) return 'HIPODROMO CHILE';

  let out=raw.replace(/\b(?:ŞİLİ|SILI|CHILE|ABD|USA)\b/gi,' ').replace(/\s+/g,' ').trim();
  out=out.replace(/^(?:CLUB\s+H[IÍ]PICO(?:\s+DE)?|HIPODROMO(?:\s+DE)?|HIPPODROME(?:\s+DE)?)\s+/i,'').trim();
  out=out.replace(/\s+(?:RACE\s*COURSE|RACECOURSE|RACETRACK|RACING|PARK)$/i,'').trim();
  return out || raw;
}

function officialFinishPosition(v){
  const raw=String(v??'').replace(/ /g,' ').trim();
  // Sonuç hücresinin tamamı sıralama numarasıysa kabul et. Eski gevşek regex,
  // `data-order` bulunamadığında hücredeki tarih/saat/başka sayılardan ilk 1–6'yı
  // seçebiliyordu; bu da gerçek bitiriş sırasını başka bir sütundan okuyabiliyordu.
  const exact=raw.match(/^([1-6])(?:\s*\.)?$/);
  if(exact) return Number(exact[1]);
  // Yalnızca açık sonuç metinlerinde baştaki sıra numarasını kabul et.
  const labelled=raw.match(/^(?:SONUÇ|SONUC|SIRA|DERECE)\s*[:#-]?\s*([1-6])(?:\s*\.)?(?:\s|$)/i);
  return labelled ? Number(labelled[1]) : null;
}

function finishPositionFromResultCell(cell){
  if(!cell) return null;
  const attrs=[cell.getAttribute('data-order'),cell.getAttribute('data-result'),cell.getAttribute('data-position')]
    .map(v=>String(v??'').trim()).filter(Boolean);
  for(const value of attrs){
    const pos=officialFinishPosition(value);
    if(pos!=null) return pos;
  }
  const cls=String(cell.className||'');
  const title=String(cell.getAttribute('title')||'');
  if(/SONUCNO|SONUÇNO|RESULT|POSITION|SIRA|DERECE/i.test(cls+' '+title)){
    return officialFinishPosition(String(cell.textContent||''));
  }
  return null;
}

function resultRaceQuality(r){
  const horses=(r?.horses||[]);
  const runners=horses.filter(h=>!isNonRunner(h));
  const placed=horses.filter(h=>[1,2,3,4,5,6].includes(Number(h.finish_position)));
  const winners=placed.filter(h=>Number(h.finish_position)===1);
  const required=Math.min(5,runners.length);
  const positions=new Set(placed.map(h=>Number(h.finish_position)));
  return {winnerCount:winners.length,placedCount:placed.length,required,
    complete:required>0 && winners.length>=1 && Array.from({length:required},(_,i)=>i+1).every(pos=>positions.has(pos))};
}

function resultPayloadQuality(p){
  const races=(p?.races||[]);
  const details=races.map(resultRaceQuality);
  const withWinner=details.filter(x=>x.winnerCount>0).length;
  const complete=details.filter(x=>x.complete).length;
  return {raceCount:races.length,withWinner,complete,details,full:races.length===6 && complete===6};
}

function resultRaceHasSupplementalData(r){
  return !!((Array.isArray(r?.payouts) && r.payouts.length) || (Array.isArray(r?.available_bets) && r.available_bets.length));
}

function resultPayloadUpdateability(p){
  const quality=resultPayloadQuality(p);
  const payoutRaces=(p?.races||[]).filter(resultRaceHasSupplementalData).length;
  return {...quality,payoutRaces,hasAnything:quality.withWinner>0 || payoutRaces>0};
}


// R15.3 sonuç bütünlüğü: eski TJK sonuç DOM'undaki gevşek sıra/StartId alanları
// yanlış ata taşınabildi. Kazanan/derece artık yalnız birbiriyle tutarlı resmî
// Sıralı İkili / Üçlü / Tabela / Sıralı 5'li kombinasyonlarından doğrulanır.
const TKP_ORDERED_PAYOUT_DEPTH={sirali_ikili:2,uclu_bahis:3,tabela:4,sirali_5li:5};
function tkpStrictOrderedPayoutCombo(text,depth){
  const raw=String(text||'').trim();
  if(!new RegExp(`^\\d+(?:/\\d+){${Math.max(0,depth-1)}}$`).test(raw))return null;
  const seq=raw.split('/').map(x=>String(Number(x)));
  return seq.length===depth&&new Set(seq).size===seq.length?seq:null;
}
function tkpOfficialOrderedPayoutEvidence(race){
  const evidence=[];
  for(const [key,depth] of Object.entries(TKP_ORDERED_PAYOUT_DEPTH)){
    for(const payout of (race?.payouts||[])){
      if(String(payout?.key||'')!==key)continue;
      const seq=tkpStrictOrderedPayoutCombo(payout?.combo,depth);
      if(seq)evidence.push({key,seq});
    }
  }
  if(!evidence.length)return {status:'NO_ORDERED_PAYOUT',depth:0,seq:null,evidence:[]};
  const unique=[];const seen=new Set();
  for(const item of evidence){const sig=item.key+'|'+item.seq.join('/');if(seen.has(sig))continue;seen.add(sig);unique.push(item);}
  for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){
    const n=Math.min(unique[i].seq.length,unique[j].seq.length);
    if(unique[i].seq.slice(0,n).join('/')!==unique[j].seq.slice(0,n).join('/'))return {status:'AMBIGUOUS_PAYOUT_OR_TIE',depth:0,seq:null,evidence:unique};
  }
  const best=unique.slice().sort((a,b)=>b.seq.length-a.seq.length)[0];
  const byNo=new Map();
  for(const h of (race?.horses||[])){
    const no=String(ekuriBase(h?.horse_no||''));if(!no)continue;
    if(!byNo.has(no))byNo.set(no,[]);byNo.get(no).push(h);
  }
  if(best.seq.some(no=>(byNo.get(String(no))||[]).length!==1))return {status:'PAYOUT_HORSE_MATCH_FAILED',depth:0,seq:null,evidence:unique};
  return {status:'VERIFIED_TJK_PAYOUT',depth:best.seq.length,seq:best.seq,evidence:unique};
}

// TJK sonuç sayfası, ikramiye kartı yüklenmemiş olsa bile her atın resmî
// SONUCNO hücresini taşır. Eski akış bu bilgiyi aşağıdaki güvenlik temizliğinde
// siliyor ve yalnız sıralı ikramiye kartı bulunursa geri yazıyordu; kartın DOM'u
// değiştiğinde bu yüzden bütün koşular sonuçsuz görünüyordu. Satır sonucu ancak
// 1'den başlayan kesintisiz, tekrarsız ve at numarası bulunan bir sıra olarak
// doğrulanır; rastgele tablo/kolon sayıları sonuç kabul edilmez.
function tkpOfficialResultRowEvidence(race){
  const byPosition=new Map(),usedHorseNos=new Set();
  for(const h of (race?.horses||[])){
    const pos=Number(h?.finish_position),no=String(ekuriBase(h?.horse_no||'')).trim();
    if(!no||!Number.isInteger(pos)||pos<1||pos>6)continue;
    if(byPosition.has(pos)||usedHorseNos.has(no))return {status:'AMBIGUOUS_RESULT_ROWS',depth:0,seq:null};
    byPosition.set(pos,no);usedHorseNos.add(no);
  }
  if(!byPosition.has(1))return {status:'NO_RESULT_ROWS',depth:0,seq:null};
  let depth=0;
  for(let pos=1;pos<=6;pos++){
    if(!byPosition.has(pos))break;
    depth=pos;
  }
  // Tek başına bir 1, yanlış sütun yakalama riskini yeterince azaltmaz.
  if(depth<2)return {status:'INSUFFICIENT_RESULT_ROWS',depth:0,seq:null};
  return {status:'VERIFIED_TJK_RESULT_ROWS',depth,seq:Array.from({length:depth},(_,i)=>byPosition.get(i+1))};
}
function tkpApplyVerifiedOfficialResultOrder(race){
  if(!race)return {status:'NO_RACE',depth:0,seq:null,evidence:[]};
  const ev=tkpOfficialOrderedPayoutEvidence(race);
  const rowEvidence=tkpOfficialResultRowEvidence(race);
  // A short ordered bet corroborates its prefix; it must not erase the remaining
  // explicit official result rows. Conflicting rows cannot extend payout evidence.
  const matchingPrefix=ev.depth>0&&rowEvidence.depth>ev.depth
    &&ev.seq.every((no,index)=>String(no)===String(rowEvidence.seq[index]));
  const verified=matchingPrefix?{...rowEvidence,evidence:ev.evidence,corroboratedDepth:ev.depth}
    :ev.depth>0?ev:rowEvidence;
  for(const h of (race.horses||[])){h.finish_position=null;h.winner=0;h.result_time='';h.official_time='';}
  race.result_verified_depth=0;race.result_integrity_source='';race.result_integrity_status=verified?.status||ev.status;
  if(!verified||verified.depth<1)return verified||ev;
  const posByNo=new Map(verified.seq.map((no,index)=>[String(no),index+1]));
  for(const h of (race.horses||[])){
    const pos=posByNo.get(String(ekuriBase(h?.horse_no||'')));
    if(pos){h.finish_position=pos;h.winner=pos===1?1:0;}
  }
  race.result_verified_depth=verified.depth;
  race.result_integrity_source=verified.status==='VERIFIED_TJK_PAYOUT'?'TJK_OFFICIAL_ORDERED_PAYOUT':'TJK_OFFICIAL_RESULT_ROWS';
  race.result_integrity_status='VERIFIED';
  return verified;
}
function tkpLegacyStartNoLooksSafe(race){
  const rows=(race?.horses||[]).filter(h=>!isNonRunner(h));
  const vals=rows.map(h=>Number(h?.start_no)).filter(n=>Number.isInteger(n)&&n>0);
  if(!vals.length)return true;
  if(new Set(vals).size!==vals.length)return false;
  const cap=Math.max(2,rows.length+2);
  return vals.every(n=>n<=cap);
}

async function tkpRepairDerivedOutcomeLayersAfterIntegrity(sourceDb,fileById){
  const verifiedByKey=new Map();
  const baseNo=value=>String(ekuriBase(value??'')||'').trim();
  const keyForRace=r=>`${String(r?.race_date||'')}|${fold(r?.hippodrome||'')}|${Number(r?.leg)||0}`;
  for(const r of (sourceDb?.races||[])){
    const key=keyForRace(r);if(!verifiedByKey.has(key))verifiedByKey.set(key,[]);verifiedByKey.get(key).push(r);
  }
  const findRaceForLog=row=>{
    const candidates=verifiedByKey.get(`${String(row?.race_date||'')}|${fold(row?.hippodrome||'')}|${Number(row?.leg)||0}`)||[];
    if(candidates.length===1)return candidates[0];
    const no=baseNo(row?.horse_no),name=fold(row?.horse_name||'');
    const hits=candidates.filter(r=>(r?.horses||[]).some(h=>baseNo(h?.horse_no)===no&&(!name||fold(h?.horse_name||'')===name)));
    return hits.length===1?hits[0]:null;
  };
  let predResolved=0,predQuarantined=0,forwardVerified=0,forwardQuarantined=0,processed=0;
  for(const row of (Array.isArray(sourceDb?.prediction_log)?sourceDb.prediction_log:[])){
    const r=findRaceForLog(row);
    if(!r||Number(r?.result_verified_depth)<1){row.resolved=0;row.winner=0;delete row.finish_position;row.result_integrity_status='UNVERIFIED';predQuarantined++;}
    else{
      const no=baseNo(row?.horse_no),name=fold(row?.horse_name||'');
      const matches=(r.horses||[]).filter(h=>baseNo(h?.horse_no)===no&&(!name||fold(h?.horse_name||'')===name));
      const h=matches.length===1?matches[0]:(r.horses||[]).find(h=>baseNo(h?.horse_no)===no);
      if(!h){row.resolved=0;row.winner=0;delete row.finish_position;row.result_integrity_status='HORSE_MATCH_FAILED';predQuarantined++;}
      else{row.resolved=1;row.winner=Number(h.winner)===1?1:0;if(Number(h.finish_position)>0)row.finish_position=Number(h.finish_position);else delete row.finish_position;row.result_integrity_status='VERIFIED_TJK_PAYOUT';predResolved++;}
    }
    if(++processed%512===0){if(typeof tkpYield==='function')await tkpYield();else if(typeof tkpYieldToBrowser==='function')await tkpYieldToBrowser();}
  }
  for(const row of (Array.isArray(sourceDb?.forward_tracking_log)?sourceDb.forward_tracking_log:[])){
    const key=`${String(row?.race_date||'')}|${fold(row?.hippodrome||'')}|${Number(row?.leg)||0}`;let candidates=verifiedByKey.get(key)||[];
    if(candidates.length>1&&row?.altili_no!=null){const want=Number(row.altili_no)||1;candidates=candidates.filter(r=>(Number(fileById.get(String(r.file_id))?.altili_no)||1)===want);}
    const r=candidates.length===1?candidates[0]:null,depth=Number(r?.result_verified_depth)||0;
    if(!r||depth<1){for(const k of ['winner_no','winner_name','leader_finish','leader_win','leader_top3','leader_top5','single_hit','bomb_any_win','bomb_any_top3','bomb_any_top5','single_finish','narrow_bmb_finish','narrow_bmb_win','odb_finish','odb_win','odb_top5','prof_finish','prof_win','prof_top5'])row[k]=null;row.result_integrity_status='UNVERIFIED';forwardQuarantined++;}
    else{
      const hs=r.horses||[],winner=hs.find(h=>Number(h.winner)===1),byNo=n=>hs.find(h=>baseNo(h.horse_no)===baseNo(n));
      row.winner_no=winner?baseNo(winner.horse_no):'';row.winner_name=winner?.horse_name||'';
      const leader=byNo(row.leader_no),lf=Number(leader?.finish_position)||0;row.leader_finish=lf||null;row.leader_win=winner&&baseNo(row.leader_no)===baseNo(winner.horse_no)?1:0;row.leader_top3=depth>=3?(lf>0&&lf<=3?1:0):null;row.leader_top5=depth>=5?(lf>0&&lf<=5?1:0):null;
      if(Number(row.single_candidate)===1){row.single_finish=row.leader_finish;row.single_hit=row.leader_win;}else{row.single_finish=null;row.single_hit=null;}
      const bombs=Array.isArray(row.bomb_candidates)?row.bomb_candidates:[],bps=bombs.map(b=>Number(byNo(b.horse_no)?.finish_position)||0);row.bomb_any_win=bps.includes(1)?1:0;row.bomb_any_top3=depth>=3?(bps.some(p=>p>0&&p<=3)?1:0):null;row.bomb_any_top5=depth>=5?(bps.some(p=>p>0&&p<=5)?1:0):null;
      const nb=byNo(row.narrow_bmb_no),np=Number(nb?.finish_position)||0;row.narrow_bmb_finish=np||null;row.narrow_bmb_win=np===1?1:0;for(const k of ['odb_finish','odb_win','odb_top5','prof_finish','prof_win','prof_top5'])row[k]=null;row.result_integrity_status='VERIFIED_TJK_PAYOUT';forwardVerified++;
    }
    if(++processed%256===0){if(typeof tkpYield==='function')await tkpYield();else if(typeof tkpYieldToBrowser==='function')await tkpYieldToBrowser();}
  }
  const purged={rule_cache_rules:Array.isArray(sourceDb?.learning_state?.rule_cache?.rules)?sourceDb.learning_state.rule_cache.rules.length:0,strategy_records:Array.isArray(sourceDb?.strategy_lab_historical?.records)?sourceDb.strategy_lab_historical.records.length:0,v55_diagnostic_rows:Array.isArray(sourceDb?.v55_diagnostic_log)?sourceDb.v55_diagnostic_log.length:0};
  if(sourceDb.learning_state&&typeof sourceDb.learning_state==='object'){
    delete sourceDb.learning_state.rule_cache;
    sourceDb.learning_state.dataset_signature='';sourceDb.learning_state.outcome_signature='';sourceDb.learning_state.sidebet_prediction_signature='';sourceDb.learning_state.sidebet_prediction_signature_count=0;
    sourceDb.learning_state.rules_rebuild_required=true;sourceDb.learning_state.integrity_version='R15.4_TJK_PAYOUT_AND_DERIVED_FAIL_CLOSED';sourceDb.learning_state.status='ARŞİV DOĞRULANDI · TÜRETİLMİŞ CACHE YENİLENECEK';sourceDb.learning_state.updated_at=new Date().toISOString();
  }
  delete sourceDb.strategy_lab_historical;
  if(Array.isArray(sourceDb.v55_diagnostic_log))sourceDb.v55_diagnostic_log=[];
  return {predResolved,predQuarantined,forwardVerified,forwardQuarantined,purged};
}
async function tkpRepairArchiveResultIntegrityOnce(sourceDb){
  if(!sourceDb||!Array.isArray(sourceDb.races)||Number(sourceDb._tkp_result_integrity_repair_v2)===1||String(sourceDb?.archive_integrity_repair?.version||'')==='R15.4_TJK_PAYOUT_AND_DERIVED_FAIL_CLOSED')return {changed:0,verified:0,quarantined:0,stCleared:0,derivedSkipped:true};
  let changed=0,verified=0,quarantined=0,stCleared=0,processed=0;
  const byFile=new Map();
  for(const race of sourceDb.races){
    const oldSig=(race.horses||[]).map(h=>`${h.finish_position??''}:${Number(h.winner)||0}:${h.start_no??''}:${h.result_time||''}:${h.official_time||''}`).join('|');
    const stSafe=tkpLegacyStartNoLooksSafe(race);
    if(!stSafe){for(const h of (race.horses||[])){if(h.start_no!=null&&String(h.start_no).trim()!==''){h.start_no=null;stCleared++;}}}
    else for(const h of (race.horses||[])){if(h.start_no!=null&&String(h.start_no).trim()!=='')h.start_no_source=h.start_no_source||'TJK_PROGRAM_LEGACY_VALIDATED';}
    const ev=tkpApplyVerifiedOfficialResultOrder(race);
    if(ev.status==='VERIFIED_TJK_PAYOUT')verified++;else quarantined++;
    const newSig=(race.horses||[]).map(h=>`${h.finish_position??''}:${Number(h.winner)||0}:${h.start_no??''}:${h.result_time||''}:${h.official_time||''}`).join('|');
    if(oldSig!==newSig)changed++;
    delete race.__tkpLiveHorsesCache;delete race.__tkpLiveHorsesSrc;delete race._accurateFieldAvgCache;
    const key=String(race.file_id);if(!byFile.has(key))byFile.set(key,[]);byFile.get(key).push(race);
    if(++processed%96===0){if(typeof tkpYield==='function')await tkpYield();else if(typeof tkpYieldToBrowser==='function')await tkpYieldToBrowser();}
  }
  for(const f of (sourceDb.files||[])){
    const rows=byFile.get(String(f.id))||[];
    const ok=rows.filter(r=>Number(r.result_verified_depth)>0).length;
    const bad=rows.length-ok;
    f.result_quality={...(f.result_quality||{}),verified_races:ok,quarantined_races:bad,race_count:rows.length,integrity_version:'R15.3_TJK_PAYOUT_FAIL_CLOSED'};
    if(rows.length)f.qc_status=bad===0&&rows.length===6?'SONUÇ DOĞRULANDI':ok>0?'SONUÇ KISMİ DOĞRULANDI':'SONUÇ KARANTİNA';
  }
  const fileById=new Map((sourceDb.files||[]).map(f=>[String(f.id),f]));
  const derived=await tkpRepairDerivedOutcomeLayersAfterIntegrity(sourceDb,fileById);
  sourceDb._tkp_result_integrity_repair_v1=1;
  sourceDb._tkp_result_integrity_repair_v2=1;
  sourceDb.archive_integrity_repair={version:'R15.4_TJK_PAYOUT_AND_DERIVED_FAIL_CLOSED',result_policy:'R15.3_TJK_PAYOUT_FAIL_CLOSED',verified_races:verified,quarantined_races:quarantined,changed_races:changed,st_cleared:stCleared,derived,at:new Date().toISOString()};
  if(sourceDb.settings&&typeof sourceDb.settings==='object')sourceDb.settings.archive_integrity_repair={...sourceDb.archive_integrity_repair};
  return {changed,verified,quarantined,stCleared,derived};
}

function conditionFamily(s){
  let x = fold(s);
  return x || 'BİLİNMİYOR';
}

function distanceGroup(d){ d = +d; if (!d) return 'BİLİNMİYOR'; if (d<=1300) return 'KISA (≤1300)'; if (d<=1800) return 'ORTA (1400-1800)'; return 'UZUN (≥1900)'; }

function applyTemplateBmbRuleToRace(r){
  // ODS'deki VALUE/BMB v2.2 formülünün tarayıcı karşılığı.
  // ODS hücrelerinde formül bulunmasına rağmen önbelleğe alınmış sonuç bulunmayabilir.
  // Bu nedenle ODS'nin kendi J-BYG, AGF, 800G, HNDKP ve Y.PUAN verilerinden
  // aynı ara değerler ve aynı BMB seçim kuralları hesaplanır.
  const horses = Array.isArray(r?.horses) ? r.horses : [];
  const finite = v => v != null && Number.isFinite(Number(v));
  const inBand = (v,a,b) => finite(v) && Number(v)>=a && Number(v)<=b;
  const keyOf = h => String(h.horse_no)+'|'+fold(h.horse_name);
  const selected = new Set();
  const mark = h => { if(h) selected.add(keyOf(h)); };

  // ODS'nin görünen ve gizli formül zinciri: H/J/K/L (sağ blokta U/W/X/Y).
  for(const h of horses){
    const agf = finite(h.agf) ? Number(h.agf) : null;
    const jbyg = finite(h.jbyg) ? Number(h.jbyg) : 0;
    const g800 = finite(h.g800) ? Number(h.g800) : 0;
    if(agf!=null && agf!==0){
      const sp = agf * 5;
      const star = (100 / agf) - 1.15;
      const pre = (jbyg + g800 + agf) / 5 + star;
      const result = (pre + agf*2)
        - (agf>30 ? agf*1.9 : 0)
        - (agf<30 ? agf*1.5 : 0)
        - (pre<10.12 ? pre : 0)
        - (agf>65 ? agf*0.23 : 0);
      if(!finite(h.sp)) h.sp = sp;
      if(!finite(h.star_value)) h.star_value = star;
      h.pre_result_score = pre;
      if(!finite(h.result_score)) h.result_score = result;
    }
  }

  // COUNTIFS(...;">"&SONUÇ)<=3: büyük SONUÇ değerlerine göre ilk 4.
  const resultDesc = horses.filter(h=>finite(h.result_score))
    .slice().sort((a,b)=>Number(b.result_score)-Number(a.result_score));
  resultDesc.forEach((h,i)=>h._bmbResultDescRank=i+1);

  // CJ/CK grup kodları: 21,49 K/X ara puanından; diğerleri SONUÇ'tan gelir.
  for(const h of horses){
    const pre=h.pre_result_score, result=h.result_score;
    h._bmbGroup = inBand(pre,21,21.99) ? 21
      : inBand(pre,49,49.99) ? 49
      : inBand(result,28,28.99) ? 28
      : inBand(result,34,35.10) ? 34
      : inBand(result,51,51.99) ? 51
      : (horses.length>10 && inBand(result,100.50,100.75) && h._bmbResultDescRank<=4) ? 100
      : 0;
  }

  // AD/AI grup seçimi: en yüksek HNDKP ana aday; HNDKP farkı en fazla 7 ise
  // hedef banda en yakın ikinci aday da BMB olarak korunur.
  for(const group of [21,49,28,34,51,100]){
    const groupRows=horses.filter(h=>h._bmbGroup===group && finite(h.hndkp));
    if(!groupRows.length) continue;
    groupRows.sort((a,b)=>Number(b.hndkp)-Number(a.hndkp) || horses.indexOf(a)-horses.indexOf(b));
    const primary=groupRows[0];
    mark(primary);
    const maxH=Number(primary.hndkp);
    const target=group===100 ? 100.50 : group;
    const secondPool=groupRows.slice(1).filter(h=>maxH-Number(h.hndkp)<=7);
    if(secondPool.length){
      const measure=h=>Math.abs(Number(group===21||group===49 ? h.pre_result_score : h.result_score)-target);
      secondPool.sort((a,b)=>measure(a)-measure(b) || horses.indexOf(a)-horses.indexOf(b));
      mark(secondPool[0]);
    }
  }

  // VALUE formülündeki doğrudan OR koşulları.
  // 99,55-99,99 kuyruğu: SONUÇ ilk 4 içinde, HNDKP >=30 ve banttaki en yüksek iki HNDKP.
  horses.filter(h=>inBand(h.result_score,99.55,99.99) && finite(h.hndkp) && Number(h.hndkp)>=30 && h._bmbResultDescRank<=4)
    .sort((a,b)=>Number(b.hndkp)-Number(a.hndkp) || horses.indexOf(a)-horses.indexOf(b))
    .slice(0,2).forEach(mark);

  // HNDKP 38-41: SONUÇ <100 ve SONUÇ büyükten ilk 4.
  horses.filter(h=>[38,39,40,41].includes(Number(h.hndkp)) && finite(h.result_score) && Number(h.result_score)<100 && h._bmbResultDescRank<=4)
    .forEach(mark);

  // 28 ana grubu hiç yoksa 26,50-28,00 bandındaki en yüksek HNDKP.
  if(!horses.some(h=>h._bmbGroup===28)){
    const c=horses.filter(h=>inBand(h.result_score,26.50,28.00) && finite(h.hndkp))
      .sort((a,b)=>Number(b.hndkp)-Number(a.hndkp) || horses.indexOf(a)-horses.indexOf(b))[0];
    mark(c);
  }

  // 34-36,50 SONUÇ ve K/X ara puanı >33,95: en yüksek iki HNDKP.
  horses.filter(h=>inBand(h.result_score,34.00,36.50) && finite(h.pre_result_score) && Number(h.pre_result_score)>33.95 && finite(h.hndkp))
    .sort((a,b)=>Number(b.hndkp)-Number(a.hndkp) || horses.indexOf(a)-horses.indexOf(b))
    .slice(0,2).forEach(mark);

  for(const h of horses){
    const explicitBmb = fold(h.value_raw) === 'BMB';
    const calculatedBmb = selected.has(keyOf(h));
    h.bmb = (explicitBmb || calculatedBmb) ? 1 : 0;
    h.bmb_source = explicitBmb ? 'ODS' : (calculatedBmb ? 'ODS FORMÜLÜ' : '');
    // VALUE, BMB değilse ODS'deki Y.PUAN toplamını gösterir.
    if(h.bmb!==1 && h.ypuan!=null) h.value_score=Number(h.ypuan);
    delete h._bmbResultDescRank;
    delete h._bmbGroup;
  }
  return r;
}

const TKP_BMB_HYGIENE_MARKER='bmb_hygiene_v1';
function tkpBmbHygieneMarkerIsValid(x){
  try{return typeof globalThis.tkpStartupHygieneMarkerIsValid==='function'&&globalThis.tkpStartupHygieneMarkerIsValid(x,TKP_BMB_HYGIENE_MARKER);}catch(_e){return false;}
}
function tkpMarkBmbHygieneClean(x){
  try{return typeof globalThis.tkpMarkStartupHygieneClean==='function'&&globalThis.tkpMarkStartupHygieneClean(x,TKP_BMB_HYGIENE_MARKER);}catch(_e){return null;}
}
async function sanitizeRealBmbFlags(x,options={}){
  // Eski kayıtları yeni pist standardına taşır. Sonucu bulunan koşular active=1
  // kalır; aksi halde DEL MAR gibi pistler Ayrıntılı Analiz'den kaybolabiliyordu.
  // KÖK ÇÖZÜM: Bu fonksiyon her açılışta (loadDB -> init) çalışıyor ve HER dosya
  // için `x.races.filter(r=>r.file_id===f.id)` ile TÜM yarış geçmişini baştan
  // tarıyordu -- yüzlerce dosya × binlerce yarışla bu O(dosya×yarış) tarama
  // uygulamanın açılışını dakikalarca yavaşlatabiliyordu ("sistem çok geç
  // açılıyor"). Artık yarışlar file_id'ye göre TEK GEÇİŞTE bir Map'e gruplanıp
  // sonra her dosya o Map'ten O(1) okunuyor; sonuç eski koddan bire bir aynı.
  if (!x || !Array.isArray(x.races)) return x;
  // Eski IndexedDB açık kalsa bile yanlış sonuç/ST katmanı yeni paketle birlikte
  // bir kez fail-closed biçimde onarılır; yalnız bundled yedeğe güvenilmez.
  const integrityMarkerOk=Number(x._tkp_result_integrity_repair_v2)===1
    ||String(x?.archive_integrity_repair?.version||'')==='R15.4_TJK_PAYOUT_AND_DERIVED_FAIL_CLOSED';
  if(!integrityMarkerOk){
    // V2 yalnız dereceyi değil, o eski dereceden türemiş prediction/forward sonuç
    // etiketlerini ve cache'leri de düzeltir. İş küçük dilimlerde yield eder.
    const integrity=await tkpRepairArchiveResultIntegrityOnce(x);
    try{globalThis.__tkpLastArchiveIntegrityRepair=integrity;}catch(_e){}
  }
  const mode=String(options.mode||'startup');
  const force=options.full===true||['restore','legacy-migration','bootstrap'].includes(mode);
  // Geçerli marker normal temiz açılışta yalnız metadata okur. BMB/aktiflik
  // temizliğinin önceki sürümde her açılışta 5M yarış üzerinde tekrar çalışması,
  // veri yüklenmiş görünürken arayüzün dakikalarca donmasının ana nedenlerinden
  // biriydi. Yedek seçilmemiş adaylar da burada kasıtlı olarak taranmaz; gerçekten
  // seçilirlerse state.js restore yolunda full denetim yapılır.
  if(!force&&tkpBmbHygieneMarkerIsValid(x)) return x;
  if(!force&&mode==='startup-candidate') return x;
  if(!Array.isArray(x.files)) x.files=[];
  const yieldToUi=async()=>{
    if(typeof tkpYield==='function')await tkpYield();
    else await tkpYieldToBrowser();
  };
  let processed=0;
  for(const f of x.files){
    f.hippodrome=canonicalHippodrome(f.hippodrome);
    if(++processed%64===0)await yieldToUi();
  }
  const racesByFileId=new Map();
  for (const r of x.races){
    // Bunlar veri değil, horses dizisinin çalışma-anı kopya/cache referanslarıdır.
    // Eski yedekte iki alan 165 MB tekrar oluşturuyordu. Algoritma alanlarına
    // dokunmadan atılır; ihtiyaç olduğunda core-utils aynı cache'i yeniden kurar.
    delete r.__tkpLiveHorsesSrc;
    delete r.__tkpLiveHorsesCache;
    delete r._accurateFieldAvgCache;
    normalizeRaceObj(r);
    if(resultRaceQuality(r).winnerCount>0) r.active=1;
    const fid=r.file_id;
    let bucket=racesByFileId.get(fid);
    if(!bucket){ bucket=[]; racesByFileId.set(fid,bucket); }
    bucket.push(r);
    // 3.018 gerçek koşudaki normalize/BMB temizliği tek kesintisiz uzun görev
    // olmasın. Veri ve sıra değişmez; yalnız her 24 koşuda olay kuyruğuna dönülür.
    if(++processed%24===0)await yieldToUi();
  }
  for(const f of x.files){
    const rows=racesByFileId.get(f.id)||[];
    const hasIntegrityEvidence=rows.some(r=>r?.result_integrity_status!=null||Number(r?.result_verified_depth)>0);
    if(hasIntegrityEvidence){
      const verified=rows.filter(r=>String(r?.result_integrity_status||'')==='VERIFIED'&&Number(r?.result_verified_depth)>0).length;
      const quarantined=Math.max(0,rows.length-verified);
      f.result_quality={...(f.result_quality||{}),verified_races:verified,quarantined_races:quarantined,race_count:rows.length,integrity_version:'R15.3_TJK_PAYOUT_FAIL_CLOSED'};
      f.has_confirmed_results=verified>0?1:0;
      f.qc_status=rows.length===6&&quarantined===0?'SONUÇ DOĞRULANDI':verified>0?'SONUÇ KISMİ DOĞRULANDI':'SONUÇ KARANTİNA';
    }else{
      const q={full:rows.length===6 && rows.every(r=>resultRaceQuality(r).complete), any:rows.some(r=>resultRaceQuality(r).winnerCount>0)};
      if(q.any){
        f.has_confirmed_results=1;
        f.qc_status=q.full?'SONUÇLAR GÜNCELLENDİ':'SONUÇ KISMİ GÜNCELLENDİ';
      }
    }
    if(++processed%64===0)await yieldToUi();
  }
  tkpMarkBmbHygieneClean(x);
  return x;
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpBmbHygieneMarkerIsValid=tkpBmbHygieneMarkerIsValid;
  globalThis.tkpMarkBmbHygieneClean=tkpMarkBmbHygieneClean;
}

function activeRaces(){
  const bt = (typeof globalThis!=='undefined') ? globalThis.__tkpBacktestContext : null;
  if(bt && bt.enabled){
    const btKey=`${bt.excludeFileId}|${bt.cutoffSeq}|${bt.cutoffDate}`;
    if(typeof _activeRacesBacktestCache!=='undefined'){
      const cached=_activeRacesBacktestCache.get(btKey);
      if(cached) return cached;
    }
    const activeFileIds = new Set(db.files.filter(f => f.status === 'ACTIVE').map(f => f.id));
    const fileById = new Map((db.files||[]).map(f=>[f.id,f]));
    const filtered = db.races.filter(r => {
      if(r.active === 0 || !activeFileIds.has(r.file_id)) return false;
      if(bt.excludeFileId!=null && String(r.file_id)===String(bt.excludeFileId)) return false;
      const f=fileById.get(r.file_id)||{};
      const rd=String(r.race_date||f.race_date||'');
      const cd=String(bt.cutoffDate||'');
      // Tarih varsa her zaman asıl kesimdir. sequence_no yalnız tarih eksik/bozuk
      // eski kayıtlar için emniyetli fallback'tir; aksi halde aynı günün sonucu
      // target toplantının eğitimine yanlışlıkla girebiliyordu.
      if(cd && rd) return rd < cd;
      const seq=Number(f.sequence_no)||Number(r.sequence_no)||0;
      const cutoffSeq=Number(bt.cutoffSeq)||0;
      if(cutoffSeq && seq) return seq < cutoffSeq;
      return false;
    });
    if(typeof _activeRacesBacktestCache!=='undefined'){
      _activeRacesBacktestCache.set(btKey, filtered);
      if(_activeRacesBacktestCache.size>32){ const first=_activeRacesBacktestCache.keys().next().value; _activeRacesBacktestCache.delete(first); }
    }
    return filtered;
  }
  if (_activeRacesCache) return _activeRacesCache;
  // V1.1.259: aynı tarama tkp-indexes tarafından zaten yapılmışsa ikinci kez db.files
  // + db.races süzme. İndeks yoksa eski güvenli yol aynen korunur.
  try{
    if(typeof tkpGetIndexes==='function'){
      const indexed=tkpGetIndexes(db)?.activeRaces;
      if(Array.isArray(indexed)){_activeRacesCache=indexed;return _activeRacesCache;}
    }
  }catch(_e){}
  const activeFileIds = new Set(db.files.filter(f => f.status === 'ACTIVE').map(f => f.id));
  _activeRacesCache = db.races.filter(r => r.active !== 0 && activeFileIds.has(r.file_id));
  return _activeRacesCache;
}

// Learning/statistics pool is intentionally independent from the live coupon pool.
// Every result-confirmed historical race is eligible regardless of file/race ACTIVE
// flags. During backtests the temporal cutoff is still enforced to prevent leakage.
const TKP_STRICT_NO_RESULT_LEAKAGE_FROM='2026-08-23';
function tkpStrictNoLeakageFrom(sourceDb=db){
  const configured=String(sourceDb?.settings?.strict_no_result_leakage_from||'').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(configured)?configured:TKP_STRICT_NO_RESULT_LEAKAGE_FROM;
}

// Tek zaman kesim kapısı. Dosya sırası state.js tarafından 1=en eski, N=en yeni
// olacak şekilde sabitlenir; fakat yarış-öncesi bir Altılı kartı için aynı günün
// hiçbir sonucu eğitim örneği olamaz. Bu nedenle geçerli ISO tarih varsa tarih
// önceliklidir, sequence_no yalnız eski/tarihsiz kayıtlar için fallback'tir.
// Kayıtların hiçbir sırası çıkarıma açılamıyorsa fail-closed davranır ve satırı
// eğitimden dışarıda bırakır.
let _tkpChronologyFileMapCache=new WeakMap();
function tkpChronologyFileMap(sourceDb=db){
  if(!sourceDb||typeof sourceDb!=='object')return new Map();
  const files=Array.isArray(sourceDb?.files)?sourceDb.files:[];
  const revision=sourceDb===db?Number(_tkpDbRevision)||0:0;
  const cached=_tkpChronologyFileMapCache.get(sourceDb);
  if(cached&&cached.files===files&&cached.count===files.length&&cached.revision===revision)return cached.map;
  const map=new Map(files.map(file=>[String(file?.id??''),file]));
  _tkpChronologyFileMapCache.set(sourceDb,{files,count:files.length,revision,map});
  return map;
}
function tkpChronologyInfo(row,sourceDb=db){
  const fileId=String(row?.file_id??'');
  // Chronology only needs a file lookup. The general index checks the complete
  // DB signature on every access, repeated millions of times in coupon learning.
  const file=fileId?tkpChronologyFileMap(sourceDb).get(fileId)||null:null;
  const date=String(row?.race_date||row?.date||file?.race_date||'').slice(0,10);
  const seq=Number(row?.sequence_no)||Number(file?.sequence_no)||0;
  const meetingUid=String(row?.meeting_uid||file?.meeting_uid||row?.file_id||'');
  const raceUid=String(row?.race_uid||row?.id||'');
  return {date,seq:seq>0?seq:0,meetingUid,raceUid};
}
function tkpChronologyCutoffKey(targetRace,sourceDb=db){
  const z=tkpChronologyInfo(targetRace,sourceDb);
  return [z.date||'NO_DATE',z.seq||'NO_SEQ',z.meetingUid||'NO_MEETING',z.raceUid||'NO_RACE'].join('|');
}
function tkpRowIsBeforeTarget(row,targetRace,sourceDb=db){
  if(!row||!targetRace)return false;
  // V1.1.265: yalnız işaretli 503 historical calibration setinde tüm sonuç/veri serbesttir.
  // 26.08.2026 15:00 sonrası canlı yarışlarda normal kronolojik sızıntı koruması aynen sürer.
  try{if(typeof tkpHistoricalCalibrationPairAllowed==='function'&&tkpHistoricalCalibrationPairAllowed(row,targetRace,sourceDb))return true;}catch(_e){}
  const source=tkpChronologyInfo(row,sourceDb);
  const target=tkpChronologyInfo(targetRace,sourceDb);
  if(target.raceUid&&source.raceUid&&target.raceUid===source.raceUid)return false;
  if(target.meetingUid&&source.meetingUid&&target.meetingUid===source.meetingUid)return false;
  if(target.date&&source.date){
    if(source.date!==target.date)return source.date<target.date;
    // Bir toplantının Altılı kuponu yarış günü başlamadan dondurulur. Aynı gün
    // farklı dosya/ayak olsa dahi sonuçları açmamak, tarihsel replay ve canlı
    // davranışı aynı ve sızıntısız tutar.
    return false;
  }
  if(target.seq&&source.seq)return source.seq<target.seq;
  return false;
}
function tkpTrainingRowsBeforeTarget(rows,targetRace,sourceDb=db){
  const source=Array.isArray(rows)?rows:[];
  if(!targetRace)return source.slice();
  return source.filter((race,index)=>{
    if((index&31)===0&&typeof tkpCouponCheck==='function')tkpCouponCheck();
    return tkpRowIsBeforeTarget(race,targetRace,sourceDb);
  });
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpChronologyInfo=tkpChronologyInfo;
  globalThis.tkpChronologyCutoffKey=tkpChronologyCutoffKey;
  globalThis.tkpRowIsBeforeTarget=tkpRowIsBeforeTarget;
}
function learningEligibleRaces(sourceDb=db){
  const races=Array.isArray(sourceDb?.races)?sourceDb.races:[];
  const files=Array.isArray(sourceDb?.files)?sourceDb.files:[];
  const bt=(typeof globalThis!=='undefined')?globalThis.__tkpBacktestContext:null;
  if(sourceDb===db&&bt?.enabled){
    const key=[String(bt.excludeFileId??''),String(bt.cutoffSeq??''),String(bt.cutoffDate??''),
      races.length,files.length,Number(_tkpDbRevision)||0,
      String(sourceDb?.learning_state?.dataset_signature||'')].join('|');
    const cached=_learningEligibleRacesBacktestCache.get(key);
    if(Array.isArray(cached))return cached;
    const fileById=new Map(files.map(f=>[String(f.id),f]));
    const value=races.filter(r=>{
      if(!raceHasConfirmedResult(r?.horses)) return false;
      if(bt.excludeFileId!=null&&String(r.file_id)===String(bt.excludeFileId)) return false;
      const f=fileById.get(String(r.file_id))||{};
      const rd=String(r.race_date||f.race_date||'');
      const cd=String(bt.cutoffDate||'');
      if(cd&&rd) return rd<cd;
      const seq=Number(f.sequence_no)||Number(r.sequence_no)||0;
      const cutoffSeq=Number(bt.cutoffSeq)||0;
      if(cutoffSeq&&seq) return seq<cutoffSeq;
      return !!(cd&&rd&&rd<cd);
    });
    _learningEligibleRacesBacktestCache.set(key,value);
    while(_learningEligibleRacesBacktestCache.size>32){
      const firstKey=_learningEligibleRacesBacktestCache.keys().next().value;
      _learningEligibleRacesBacktestCache.delete(firstKey);
    }
    return value;
  }
  if(sourceDb===db&&!bt?.enabled&&_learningEligibleRacesCache.db===sourceDb
    &&_learningEligibleRacesCache.races===races&&_learningEligibleRacesCache.files===files
    &&_learningEligibleRacesCache.raceCount===races.length&&_learningEligibleRacesCache.fileCount===files.length
    &&_learningEligibleRacesCache.revision===_tkpDbRevision&&Array.isArray(_learningEligibleRacesCache.value))return _learningEligibleRacesCache.value;
  const fileById=new Map(files.map(f=>[String(f.id),f]));
  const value=races.filter(r=>{
    if(!raceHasConfirmedResult(r?.horses)) return false;
    if(!bt?.enabled) return true;
    if(bt.excludeFileId!=null&&String(r.file_id)===String(bt.excludeFileId)) return false;
    const f=fileById.get(String(r.file_id))||{};
    const rd=String(r.race_date||f.race_date||'');
    const cd=String(bt.cutoffDate||'');
    // Her tarihli kart yarıştan önce bütün toplantı olarak kilitlenir. Sürüm ya
    // da tarih eşiğine bağlı ayrı bir istisna bırakmak eski 503 arşivinde ileri
    // sonucu eğitimde görünür hâle getiriyordu.
    if(cd&&rd) return rd<cd;
    const seq=Number(f.sequence_no)||Number(r.sequence_no)||0;
    const cutoffSeq=Number(bt.cutoffSeq)||0;
    if(cutoffSeq&&seq) return seq<cutoffSeq;
    return !!(cd&&rd&&rd<cd);
  });
  if(sourceDb===db&&!bt?.enabled)_learningEligibleRacesCache={db:sourceDb,races,files,raceCount:races.length,fileCount:files.length,revision:_tkpDbRevision,value};
  return value;
}

function learningFieldCoverage(sourceDb=db){
  const races=learningEligibleRaces(sourceDb);
  const rows=races.flatMap(r=>typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>h&&!isNonRunner(h)));
  const present=(h,names)=>names.some(k=>h[k]!=null&&h[k]!==''&&Number.isFinite(Number(h[k])));
  const fields={
    agf:['agf','agf_rank'],ypuan:['ypuan'],bmb:['bmb'],odb:['odb','_ypuanOdbTail'],
    prof:['prof','leader_prof','profile_strength_pct','team_strength_pct'],edge:['edge','model_prob_proxy'],
    score:['score'],finish:['finish_position','winner'],tr:['tr_ganyan','tr_puan','tr_ganyan_rank'],
    pace:['accurate_avg_speed_mps','accurate_finish_time_sec','best_time'],g800:['g800'],hndkp:['hndkp','hndkp_rank']
  };
  const coverage={};
  for(const [name,aliases] of Object.entries(fields)){
    const available=name==='odb'
      ? races.reduce((n,r)=>n+(typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>h&&!isNonRunner(h))).reduce((m,h)=>m+(present(h,aliases)||isOdbCandidate(h,r)?1:0),0),0)
      : rows.reduce((n,h)=>n+(present(h,aliases)?1:0),0);
    coverage[name]={available,missing:rows.length-available,total:rows.length};
  }
  return {meetings:new Set(races.map(r=>[r.race_date||'',r.hippodrome||'',r.altili_no||1].join('|'))).size,races:races.length,horse_rows:rows.length,fields:coverage};
}

function orderedActiveRaces(){
  if(typeof tkpGetIndexes === 'function'){
    try { return tkpGetIndexes().activeRaces.slice(); } catch(_){}
  }
  const fileSeq = new Map((db.files||[]).map(f=>[String(f.id), Number(f.sequence_no)||0]));
  return activeRaces().slice().sort((a,b) => {
    let fa = fileSeq.get(String(a.file_id)) ?? 0;
    let fb = fileSeq.get(String(b.file_id)) ?? 0;
    return fa - fb || a.leg - b.leg || a.id - b.id;
  });
}

function allHorses(){ return activeRaces().flatMap(r => r.horses.map(h => ({r,h}))); }

function addRanks(hs){
  const defs = [
    ['agf','agf_rank','desc'],
    ['result_score','result_rank','asc'],
    ['tr','tr_rank','desc'],
    ['hndkp','hndkp_rank','desc'],
    ['sp','sp_rank','desc'],
    ['value_score','value_rank','desc']
  ];
  for (const [key,out,dir] of defs){
    // Aynı kayıt yeniden yüklendiğinde eski sıra bilgisi kalmasın.
    hs.forEach(h => { h[out] = null; });
    let arr = hs.map((h,i) => ({i, v:n(h[key])})).filter(x => x.v !== null).sort((a,b) => dir==='asc' ? a.v-b.v : b.v-a.v);
    let last=null, rank=0, pos=0;
    for (const x of arr){ pos++; if (last===null || x.v !== last) rank = pos; hs[x.i][out] = rank; last = x.v; }
  }
  // Gerçek TR PUAN sırası legacy h.tr/tr_rank'ten ayrı tutulur. h.tr ODS/AGF
  // uyumluluk aliasıdır; kullanıcı ekranı/öğrenme bunu TR diye kullanamaz.
  hs.forEach(h=>{h.tr_ganyan_rank=null;});
  const gcRows=hs.map((h,i)=>{
    const sources=[h?.tr_ganyan_source,h?.tr_source].map(v=>String(v??'').trim().toUpperCase());
    if(!sources.includes('GANYAN_CANAVARI_TR'))return null;
    const value=n(h?.tr_ganyan??h?.tr_puan);return value===null?null:{i,v:value};
  }).filter(Boolean).sort((a,b)=>b.v-a.v);
  let gcLast=null,gcRank=0,gcPos=0;
  for(const row of gcRows){gcPos++;if(gcLast===null||row.v!==gcLast)gcRank=gcPos;hs[row.i].tr_ganyan_rank=gcRank;gcLast=row.v;}
}

function standardAgfValue(value){
  const v = n(value);
  if (v === null) return null;
  // Kaynakta gerçek AGF 0 ise ODS/formül standardı için 0,1 kullanılır.
  return v === 0 ? 0.1 : v;
}

function historicalJBygTeamRates(r, sourceDb){
  const result={jockey:new Map(),trainer:new Map()};
  const personKey=value=>String(value||'').toLocaleUpperCase('tr-TR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G')
    .replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C').replace(/[^A-Z0-9]+/g,' ').trim();
  const targetDate=String(r?.race_date||'');
  const all=[];
  if(Array.isArray(sourceDb?.races)) all.push(...sourceDb.races);
  for(const file of (sourceDb?.files||[])) if(Array.isArray(file?.races)) all.push(...file.races);
  const seen=new Set();
  for(const race of all){
    const raceDate=String(race?.race_date||race?.date||'');
    // Gelecek bilgi sızıntısı yok: yalnız hedef koşudan önceki sonuçlar kullanılır.
    if(!raceDate || (targetDate && raceDate>=targetDate)) continue;
    for(const h of (race?.horses||[])){
      const finish=Number(h?.finish_position??h?.finish??h?.result_order??0);
      const won=Number(h?.winner)===1||finish===1;
      if(!(finish>=1)||finish>30) continue;
      const fp=[raceDate,race?.hippodrome,race?.leg,race?.race_no,h?.horse_no,h?.horse_name].map(String).join('|');
      if(seen.has(fp)) continue;
      seen.add(fp);
      for(const [kind,raw] of [['jockey',h?.jockey_name??h?.jokey_name??h?.jockey],['trainer',h?.trainer_name??h?.antrenor_name??h?.trainer]]){
        const key=personKey(raw); if(!key) continue;
        const stat=result[kind].get(key)||{starts:0,wins:0};
        stat.starts++; if(won) stat.wins++;
        result[kind].set(key,stat);
      }
    }
  }
  result.personKey=personKey;
  return result;
}

function tkpNullOutSuspiciousZeroJBygRates(horses){
  // KÖK FIX: TJK koşu-içi Jokey/Antrenör karşılaştırma tablosu ayrıştırılamadığında
  // (sütun kayması, şablon değişikliği vb.) firstWinPctFromRows() gerçek yüzde yerine
  // yanlışlıkla literal 0 üretebiliyor. Bir yarışta koşan TÜM atların hem jokeyinin
  // HEM antrenörünün AYNI ANDA %0 kazanma oranına sahip olması istatistiksel olarak
  // imkansıza yakındır -- bu güvenilir bir "gerçek veri değil, ayrıştırma hatası"
  // işaretidir. Bu 0'lar aşağıdaki mantıkta "dolu" sayılırsa (?? operatörü 0'ı
  // eksik saymaz) hem %8,50 eşiği herkesi eler hem de geçmiş-ortalama yedeği hiç
  // devreye girmez -- J-BYG kalıcı olarak boş kalır. Böyle bir örüntü tespit
  // edilirse 0'lar "eksik veri" (null) sayılır ki geçmiş yedek devreye girebilsin.
  // isNonRunner() bazı dar test/derleme bağlamlarında (fold() vb. yardımcılar
  // yüklenmeden) tanımsız kalabiliyor; burada bağımsız kalmak için doğrudan
  // "(KOŞMAZ)" işaretine bakılır -- aynı desen dosyanın başka yerlerinde de kullanılır.
  const live=(horses||[]).filter(h=>!/\(KOŞMAZ\)/i.test(String(h?.horse_name||'')));
  if(live.length<3) return;
  const allSuspiciousZero=live.every(h=>Number(h?.jockey_win_pct)===0 && Number(h?.trainer_win_pct)===0);
  if(!allSuspiciousZero) return;
  for(const h of live){ h.jockey_win_pct=null; h.trainer_win_pct=null; }
}
function ensureRaceJBygFromTeamRates(r){
  const horses=Array.isArray(r?.horses)?r.horses:[];
  // Kaynak sözleşmesi: J-BYG bir başarı oranı tahmini değildir. Ganyan
  // Canavarı birincildir; yalnız o katman boş kaldığında Yeni Beygir'in
  // doğrudan Jky.+Ant. tablosu yedek olabilir. TJK, Atlagel veya geçmiş
  // sonuçlardan sentetik J-BYG üretimi kesin olarak kapalıdır. Bu yardımcı
  // yalnız zaten gelmiş güvenilir aliasları eşitler; yeni değer hesaplamaz.
  for(const h of horses){
    const aliases=['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank','team_rank','jockey_trainer_rank','jokey_antrenor_rank'];
    const existing=aliases.map(key=>Number(h?.[key])).find(value=>Number.isFinite(value)&&value>=1&&value<=7);
    const trusted=/^(?:GANYAN_CANAVARI_JBYG|YENIBEYGIR_JBYG_FALLBACK)$/i.test(String(h?.jbyg_source||''));
    if(existing!=null&&trusted){h.jbyg=Math.round(existing);h.jbyg_rank=Math.round(existing);h.team_strength_rank=Math.round(existing);}
  }
  return false;
}

function tkpTrustedJBygRank(h){
  if(!/^(?:GANYAN_CANAVARI_JBYG|YENIBEYGIR_JBYG_FALLBACK)$/i.test(String(h?.jbyg_source||'')))return null;
  return ['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank'].map(k=>Number(h?.[k])).find(v=>Number.isFinite(v)&&v>=1&&v<=7)??null;
}
function tkpTrustedGlpRank(h){
  if(!/^(?:GANYAN_CANAVARI_GALOPLAR_OZET|YENIBEYGIR_GLP_FALLBACK)$/i.test(String(h?.glp_source||'')))return null;
  return ['g800','g800_rank','galop_rank','glp_rank'].map(k=>Number(h?.[k])).find(v=>Number.isFinite(v)&&v>=1&&v<=6)??null;
}
function tkpTrustedTrValue(h){
  // Stale birincil alan doğru GC kanıtını gölgeleyemez.
  const sources=[h?.tr_ganyan_source,h?.tr_source].map(v=>String(v??'').trim().toUpperCase());
  if(!sources.includes('GANYAN_CANAVARI_TR'))return null;
  for(const raw of [h?.tr_ganyan,h?.tr_puan]){
    if(raw==null||String(raw).trim()==='')continue;
    const value=Number(String(raw).trim().replace(',','.'));
    // GC'nin boş/okunamayan P hücresi bazı günler 0 olarak gelir. 0 burada
    // gerçek bir puan değil, eksik veri işaretidir; puan katmanını tamamlamaz.
    if(Number.isFinite(value)&&value>0)return value;
  }
  return null;
}
function tkpSanitizeHistoricalSupportProvenance(r){
  const liveToday=tkpIsCurrentLocalRaceDate(r?.race_date);
  // R16.46 KÖK TR RESTORE: Eski, gerçekten Ganyan Canavarı'ndan içe aktarılmış
  // toplantılarda at üzerindeki tr_ganyan değeri saklanmış, fakat sonraki sürümlerde
  // eklenen per-horse tr_ganyan_source alanı henüz yoktu. Buna rağmen yarış düzeyinde
  // tr_puan_sources / support_layers.tr açıkça GC dosyasını kanıtlıyor. R16.45'in
  // katı sanitizer'ı bu gerçek değerleri (ör. DEMON HUNTER 151) kaynak etiketi yok
  // diye null'a çeviriyordu. Yarış düzeyi kanıt varsa yalnız pozitif mevcut değere
  // provenance geri yaz; hiçbir sayı uydurma ve h.tr (AGF aliası) asla TR kabul edilmez.
  const legacyGcTrProof=Boolean(
    (Array.isArray(r?.tr_puan_sources)&&r.tr_puan_sources.some(x=>/GANYAN_CANAVARI_TR_PUAN/i.test(String(x||''))))
    || /^GANYAN_CANAVARI_TR$/i.test(String(r?.support_layers?.tr?.source||''))
  );
  for(const h of (r?.horses||[])){
    const sources=[h?.tr_ganyan_source,h?.tr_source].map(v=>String(v??'').trim().toUpperCase());
    if(legacyGcTrProof&&!sources.includes('GANYAN_CANAVARI_TR')){
      const legacy=[h?.tr_ganyan,h?.tr_puan].map(v=>Number(String(v??'').trim().replace(',','.'))).find(v=>Number.isFinite(v)&&v>0);
      if(Number.isFinite(legacy)){
        h.tr_ganyan=legacy;h.tr_puan=legacy;h.tr_ganyan_source='GANYAN_CANAVARI_TR';
        h.tr_ganyan_metric='GANYAN_CANAVARI_PROGRAM_P_COLUMN';
        if(!h.tr_ganyan_asof_date)h.tr_ganyan_asof_date=String(r?.support_layers?.tr?.asof||r?.race_date||'');
      }
    }
    const gcJbyg=/^GANYAN_CANAVARI_JBYG$/i.test(String(h?.jbyg_source||''));
    const liveTjkJbyg=liveToday&&/^TJK_PROGRAM_JBYG$/i.test(String(h?.jbyg_source||''));
    const realGcZero=gcJbyg&&Number(h?.jbyg)===0;
    const j=tkpTrustedJBygRank(h);if(j==null&&!realGcZero&&!liveTjkJbyg){
      for(const k of ['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank','team_rank','jockey_trainer_rank','jokey_antrenor_rank','jbyg_rate','team_strength_pct'])if(h?.[k]!=null)h[k]=null;
      if(/^TJK_PROGRAM_JBYG$/i.test(String(h?.jbyg_source||''))){h.jbyg_source=null;h.jbyg_asof_date=null;}
    }
    const liveTjkGlp=liveToday&&/^TJK_PROGRAM_GALOP$/i.test(String(h?.glp_source||''));
    const g=tkpTrustedGlpRank(h);if(g==null&&!liveTjkGlp){
      for(const k of ['g800','g800_rank','galop_rank','glp_rank'])if(h?.[k]!=null)h[k]=null;
      if(/^TJK_PROGRAM_GALOP$/i.test(String(h?.glp_source||''))){h.workout_800='';h.workout_600='';h.workout_400='';h.glp_source=null;h.glp_asof_date=null;}
    }
    if(tkpTrustedTrValue(h)==null){if(h?.tr_ganyan!=null)h.tr_ganyan=null;if(h?.tr_puan!=null)h.tr_puan=null;}
  }
}

function normalizeRaceObj(r){
  r.surface = normalizeSurface(r.surface);
  r.breed = normalizeBreed(r.breed);
  r.condition_family = conditionFamily(r.condition_text);
  r.distance_group = distanceGroup(r.distance);
  r.hippodrome = canonicalHippodrome(r.hippodrome);
  r.horses = r.horses || [];
  // Eski ODS arşivlerinde fiziksel satır sırası ayrı alana yazılmamıştı; ancak
  // horses dizisi ODS satır düzenini koruyordu. Yalnız ODS kökeni açıkça görülen
  // kayıtlarda eksik alanı geri doldur. TR/AGF/VALUE dahil hiçbir mevcut sinyal
  // değiştirilmez; ods_row_order yalnız düşük ağırlıklı ek özelliktir.
  const sourceName=String(r.filename||r.source_filename||r.ods_filename||'').toLocaleUpperCase('tr-TR');
  const odsBackfill=/\.ODS(?:$|[?#])/i.test(sourceName)||/TKP[_ -]?AI/i.test(sourceName)||Number(r.ods_source)===1;
  // Tek standart: AGF ve TR daima aynı sayıdır. Eski kayıtlar normalize edildiğinde de
  // bu kural uygulanır; YPUAN ve diğer zenginleştirme alanlarına dokunulmaz.
  for (let horseIndex=0;horseIndex<r.horses.length;horseIndex++){
    const h=r.horses[horseIndex];
    const agf = standardAgfValue(h.agf);
    h.agf = agf;
    h.tr = agf;
    if(odsBackfill&&!(Number(h.ods_row_order)>0))h.ods_row_order=horseIndex+1;
  }
  tkpSanitizeHistoricalSupportProvenance(r);
  ensureRaceJBygFromTeamRates(r);
  addRanks(r.horses);
  applyTemplateBmbRuleToRace(r);
  return r;
}

async function unzipEntry(buf, name){
  let dv = new DataView(buf), u8 = new Uint8Array(buf), eocd = -1;
  for (let i = u8.length-22; i>=0 && i>u8.length-70000; i--){ if (dv.getUint32(i,true) === 0x06054b50){ eocd = i; break; } }
  if (eocd < 0) throw new Error('Geçerli bir ODS/ZIP dosyası değil.');
  let cd = dv.getUint32(eocd+16,true), count = dv.getUint16(eocd+10,true), p = cd;
  for (let k=0;k<count;k++){
    if (dv.getUint32(p,true) !== 0x02014b50) break;
    let method = dv.getUint16(p+10,true), cs = dv.getUint32(p+20,true), nl = dv.getUint16(p+28,true), el = dv.getUint16(p+30,true), cl = dv.getUint16(p+32,true), off = dv.getUint32(p+42,true);
    let nm = new TextDecoder().decode(u8.slice(p+46, p+46+nl));
    if (nm === name){
      let lnl = dv.getUint16(off+26,true), lel = dv.getUint16(off+28,true), start = off+30+lnl+lel, data = u8.slice(start, start+cs);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8){
        let ds = new DecompressionStream('deflate-raw');
        return new TextDecoder().decode(await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer());
      }
      throw new Error('Desteklenmeyen sıkıştırma yöntemi.');
    }
    p += 46 + nl + el + cl;
  }
  throw new Error(name + ' bulunamadı.');
}

// --- yenibeygir.com bülten HTML ayrıştırıcısı ---
// Kaydedilmiş bülten sayfasından "N. Altılı Ganyan Bu koşudan başlar" işaretini bularak
// oradan 6 ardışık koşuyu okur ve parseODSxml ile AYNI {file, races} şeklini üretir.
// Bu şekilde mevcut tahmin/önizleme akışı hiç değişmeden yeniden kullanılabilir.
// NOT: Bu ayrıştırıcı sadece ham veriyi (isim, AGF, HNDKP, TR, mesafe/pist/cins/şart, eküri,
// varsa bitiş derecesi) okur; BMB/VALUE hesaplaması burada YAPILMAZ (bu hâlâ yalnızca ODS
// formüllerinde var) — bu yüzden h.bmb=0 ve h.value_score=null olarak bırakılır.
function parseBulletinHTML(htmlText, filename, altiliNo){
  altiliNo = Math.max(1, Number(altiliNo) || 1);
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');
  let yarisRows = [...doc.querySelectorAll('div.yarisRow')];
  if (!yarisRows.length) throw new Error('Bültende koşu satırı (yarisRow) bulunamadı. Doğru sayfa mı kaydedildi?');

  // "N. Altılı Ganyan Bu koşudan başlar" (çift altılı günler) ya da sade "6'lı Ganyan Bu
  // koşudan başlar" (TEK altılı günler — ordinal numara YOK) — her ikisi de "6'lı Ganyan"
  // ifadesiyle yakalanır, işaretler bulunma sırasına göre indekslenir.
  // ÖNEMLİ: Yalnızca "GANYAN"+"BAŞLAR" aranırsa "7'Lİ GANYAN Bu koşudan başlar" veya
  // "5'Lİ GANYAN Bu koşudan başlar" gibi BAŞKA bahis türlerinin başlangıç ifadeleri de
  // yanlışlıkla işaret sayılır (yanlış-pozitif). Bu yüzden özellikle "6'LI GANYAN" ya da
  // (çift altılı günlerde kullanılan uzun yazım) "ALTILI GANYAN" ifadesi aranır; başka
  // sayı ile başlayan "N'Lİ/LÜ GANYAN" (3'lü, 4'lü, 5'li, 7'li) hariç tutulur.
  let markers = [];
  for (let i=0;i<yarisRows.length;i++){
    let spans = [...yarisRows[i].querySelectorAll('span')];
    if (spans.some(s => {
      let t = fold(s.textContent);
      let isAltiliGanyan = /ALTILI\s*GANYAN/.test(t) || /6\s*'?\s*L[İIÜU]\s*GANYAN/.test(t);
      return isAltiliGanyan && t.includes('BAŞLAR');
    })) markers.push(i);
  }
  if (!markers.length){
    // YeniBeygir kaydedilmiş HTML'de bazen "Altılı Ganyan bu koşudan başlar" etiketi
    // script/style temizliği nedeniyle kayboluyor. Kök At Yarışı Bülteni dosyasıysa
    // tamamen durmak yerine ilk 6 koşu yedek olarak alınır.
    const nameProbe = fold(String(filename || ''));
    if(/AT\s*YARI[ŞS]I\s*B[ÜU]LTEN[İI]|YEN[İI]BEYG[İI]R/.test(nameProbe) && yarisRows.length>=6){
      markers=[0];
    } else {
      throw new Error('Altılı Ganyan başlangıç işareti bültende bulunamadı.');
    }
  }
  // Tek altılı olan programlarda tek işaret bulunur; istenen altiliNo ne olursa olsun bu tek
  // işaret kullanılır ve "2. Altılı" ibaresi aranmaz. Çift altılı günlerde işaretler bulunma
  // sırasına göre 1. ve 2. Altılı'ya karşılık gelir.
  let startIdx = markers.length === 1 ? markers[0] : markers[Math.min(altiliNo, markers.length) - 1];
  let raceRows = yarisRows.slice(startIdx, startIdx+6);
  if (raceRows.length < 6) throw new Error(`Altılı Ganyan başlangıcından itibaren 6 koşu yok (sadece ${raceRows.length} koşu bulundu).`);

  let ayMap = {Ocak:'01',Şubat:'02',Mart:'03',Nisan:'04',Mayıs:'05',Haziran:'06',Temmuz:'07',Ağustos:'08',Eylül:'09',Ekim:'10',Kasım:'11',Aralık:'12'};
  // Tarih ve şehir en güvenilir şekilde sayfa başlığından ("24 Temmuz 2026, Cuma - İstanbul At
  // Yarışı Bülteni" gibi) okunur; body genelinde arama şehir seçici menüdeki diğer şehirlerle
  // (ör. "Bursa") yanlış eşleşebiliyor.
  // YeniBeygir'de sonuç sayfası çoğu zaman bültenle aynı DOM'u kullanır;
  // başlık yalnız "At Yarışı Sonuçları" olabilir. Bu yüzden hem Bülteni hem Sonuçları kabul edilir.
  let headingEl = [...doc.querySelectorAll('h1,h2,h3')].find(el => /At Yarışı (Bülteni|Sonuçları)/i.test(el.textContent));
  let headingText = headingEl ? headingEl.textContent : doc.body.textContent;
  let dm = headingText.match(/(\d{1,2})\s+(Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+(\d{4})/);
  let date = dm ? `${dm[3]}-${ayMap[dm[2]]}-${dm[1].padStart(2,'0')}` : null;

  let hip = '';
  const hipMatch=headingText.match(/[-–—]\s*([^\n\r]+?)\s+At\s+Yarışı\s+(?:Bülteni|Sonuçları)/i)
    || headingText.match(/^\s*([^\n\r]+?)\s+At\s+Yarışı\s+(?:Bülteni|Sonuçları)/im);
  if(hipMatch) hip=canonicalHippodrome(hipMatch[1]);
  if(!hip){
    const cityMatch=headingText.match(/(Ankara|İstanbul|İzmir|Bursa|Adana|Kocaeli|Elazığ|Diyarbakır|Şanlıurfa)/);
    if(cityMatch) hip=canonicalHippodrome(cityMatch[1]);
  }

  // Dosya adı olarak tarayıcının kaydettiği ham dosya adı (ör. "At Yarışı Bülteni _
  // yenibeygir.com.html") kullanılmaz -- bu ad kaydetme yöntemine göre tutarsız çıkıyordu.
  // Bunun yerine, sayfanın kendi başlığından ("26 Temmuz 2026, Pazar (Bugün) - İstanbul At
  // Yarışı Bülteni" gibi) okunan GÜN ADI + ŞEHİR ile her zaman aynı biçimde bir görünen ad
  // üretilir: "Pazar İstanbul At Yarışı Bülteni.html" -- Dosyalar tablosundaki Kaynak
  // sütununda ODS içe aktarımlarıyla aynı, tutarlı görünüm sağlanır.
  let dayMatch = headingText.match(/\b(Pazartesi|Sal[ıi]|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar)\b/i);
  let dayName = dayMatch ? dayMatch[1].charAt(0).toLocaleUpperCase('tr-TR') + dayMatch[1].slice(1).toLocaleLowerCase('tr-TR') : tkpDayNameFromISO(date);
  const isResultPage = /At Yarışı Sonuçları/i.test(headingText) || /(SONUÇ|SONUC|DERECE|BİTİRİŞ|BITIRIS)/i.test(headingText.slice(0,1200));
  let displayFilename = hip ? `${hip==='DEL MAR'?'DELMAR':hip} HTML` : (filename || 'HTML');

  function parseHeader(text){
    // NOT: "." normal olarak satır sonu (\n) karakterini eşleştirmez. Kaynak HTML'de koşu
    // adı parantezi ayrı bir satırda geldiğinde (ör. "KV Handikap 24/Dişi/H1\n(MUZAFFER BOZOK
    // KOŞUSU)\n₺..."), eski regex ₺ işaretine satır sonu engelinden dolayı hiç ulaşamıyor ve
    // TÜM koşu şartı (condition_text) boş dönüyordu -- bu da ODS'ye yanlış/eksik koşu bilgisi
    // yazılmasına yol açıyordu. [\s\S] kullanılarak satır sonları da capture'a dahil edilir.
    let m = text.match(/^\s*\d+\s*\.\s*\d{1,2}:\d{2}\s+([\s\S]*?)\s*₺/);
    let condition = m ? m[1].replace(/\s+/g,' ').trim() : '';
    condition = condition.replace(/\s*\([^)]*\)\s*$/, '').trim();
    let m2 = text.match(/(\d{3,4})\s*(Çim|Kum)/);
    let distance = m2 ? +m2[1] : null;
    let surfaceRaw = m2 ? m2[2] : '';
    let surface = surfaceRaw === 'Çim' ? 'ÇİM' : (surfaceRaw === 'Kum' ? (/Sentetik/i.test(text) ? 'SENT.' : 'KUM') : '');
    let breed = text.includes('İngiliz') ? 'İNG' : (text.includes('Arap') ? 'ARP' : '');
    return {condition, distance, surface, breed};
  }

  let races = [];
  for (let li=0; li<raceRows.length; li++){
    let row = raceRows[li];
    let table = row.querySelector('table.kosanAtlar');
    if (!table) continue;
    let tableText = table.textContent;
    let headerText = row.textContent.replace(tableText, '').trim();
    let {condition, distance, surface, breed} = parseHeader(headerText);

    const tableRows=[...table.querySelectorAll('tr')];
    const headerCells=[...(tableRows.find(r=>r.querySelector('th')) || tableRows[0] || document.createElement('tr')).querySelectorAll('th,td')];
    const heads=headerCells.map(c=>fold(c.textContent));
    const findCol=(patterns, fallback)=>{ const i=heads.findIndex(x=>patterns.some(re=>re.test(x))); return i>=0?i:fallback; };
    // YeniBeygir bülteninde AGF başlığı görünmez; değer her at satırının İLK hücresindedir.
    // Başlık metninden sütun tahmini yapmak bazı kayıtları HNDKP/sıra değeriyle karıştırıyordu.
    const agfIdx=0;
    const noIdx=findCol([/^(NO|AT NO|ATNO|NUMARA)$/],1);
    const nameIdx=findCol([/^(AT|AT ADI|AT İSMİ|AT ISMI|İSİM|ISIM)$/],2);
    const hndIdx=findCol([/^(HNDKP|HANDİKAP|HANDIKAP|HP)$/],10);
    const resultIdx=findCol([/^(S|SONUÇ|SONUC|DERECE|BİTİRİŞ|BITIRIS|SIRA)$/],null);
    const parseAgf=(cell)=>{
      if(!cell) return null;
      // YeniBeygir'de resmi AGF, ilk hücredeki span'ın title özelliğindeki İLK yüzdedir.
      // ÖNEMLİ DÜZELTME: site YALNIZCA o anki piyasa favorisinin span'ına
      // class="agf" ekliyor -- diğer bütün atların span'ı class'sız, ama title formatı
      // birebir aynı. Bu yüzden class="agf" şartı arandığında sadece 1 at (favori)
      // bulunuyor, geri kalan atların hepsi AGF'siz kalıyordu. Artık class aranmıyor,
      // hücredeki HERHANGİ bir title'lı span kabul ediliyor.
      // title alanında ayrıca 'Blt. Ort: 25%' bulunduğu için title'ın TAMAMI değil,
      // sadece BAŞINDAKİ ilk oran okunur (parantez içi bülten ortalamasıdır, ata ait değil).
      // Örnek: title='35,66% (Blt. Ort: 25%)' => AGF 36 (35,66 yuvarlanmış), 25 DEĞİL.
      const agfSpan=cell.querySelector('span[title]') || cell.querySelector('span');
      if(agfSpan){
        // Kaynakta title iki oran içeriyor: gerçek AGF ve parantez içinde Blt. Ort.
        // Örn: 23,34% (Blt. Ort: 18%). Yalnız parantezden ÖNCEKİ ilk oran alınır.
        const title=String(agfSpan.getAttribute('title')||'').trim();
        const tm=title.match(/^\s*(\d{1,3}(?:[.,]\d+)?)\s*%/);
        if(tm){
          const exact=Number(tm[1].replace(',','.'));
          if(Number.isFinite(exact) && exact>=0 && exact<=100) return Math.round(exact);
        }
        // title yoksa yalnız ekranda görünen span metnine dön.
        const visible=String(agfSpan.textContent||'').replace(/\s+/g,' ').trim();
        const m=visible.match(/^%?\s*(\d{1,3}(?:[.,]\d+)?)\s*%?$/);
        if(!m) return null;
        const v=Number(m[1].replace(',','.'));
        return Number.isFinite(v) && v>=0 && v<=100 ? Math.round(v) : null;
      }
      // Hücrede hiç span yoksa AGF kabul edilmez; başka sayı sütunlarına kayma önlenir.
      return null;
    };
    let trs = tableRows.filter(r=>r!==tableRows[0] && r.querySelectorAll('td').length>=3);
    let horses = [];
    for (const tr of trs){
      let tds = [...tr.querySelectorAll('td')];
      if (tds.length < 3) continue;
      let no = (tds[noIdx]?.textContent||'').trim();
      let nameCell = tds[nameIdx] || tds[2];
      let nameLink = nameCell.querySelector('a.atisimlink');
      let name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();
      let sups = [...nameCell.querySelectorAll('sup')].map(s=>s.textContent.trim()).join(' ');
      let fullName = (name + ' ' + sups).trim();
      let hnd = n(tds[hndIdx] ? tds[hndIdx].textContent.trim() : '');
      const resultCell=(resultIdx!=null ? tds[resultIdx] : null) || tds[tds.length-1] || null;
      let finishPos=finishPositionFromResultCell(resultCell);
      let agf = agfIdx === null ? null : parseAgf(tds[agfIdx]);
      // Yalnız kaynakta açıkça 0 varsa 0,1'e çevrilir; sütun bulunamazsa boş kalır.
      agf = standardAgfValue(agf);
      if (hnd === null) hnd = 30;
      // Kaynak sitede koşmayan (çekilen/deklare dışı) at satırı şu şekillerde
      // işaretlenir (gerçek bültenle doğrulandı): isim linkine "atisimlink"in
      // yanına ayrı bir "k" class'ı eklenir (üstü çizili görünümü bu sağlar,
      // ör. class="atisimlink k") VE isim hücresinde <font color="red">(Koşmaz)</font>
      // metni bulunur. Bazı satırlarda üstü çizili yazı yerine yalnız metin de
      // olabilir; bu yüzden hem class hem metin hem de olası s/strike/del ya
      // da line-through stili ayrı ayrı kontrol edilir. Herhangi biri bulunursa
      // at ismine " (KOŞMAZ)" eklenir -- bu sayede isNonRunner() bu atı otomatik
      // yakalar: tahmin/kupon sıralamalarından çıkarılır, ham liste görünümlerinde
      // ise isim yanında KOŞMAZ olarak görünmeye devam eder.
      const explicitNonRunner = tkpTjkRowIsExplicitNonRunner(tr,nameCell,nameLink);
      if (explicitNonRunner && !tkpExplicitNonRunnerText(fullName)){
        fullName = (fullName + ' (KOŞMAZ)').trim();
      }
      horses.push({no, name: fullName, agf, hnd, finishPos});
    }

    // Eküri (ortak koşum) bilgisi kaynakta at satırında DEĞİL, koşunun alt
    // bilgi (yarisFooter) bölümünde ayrı bir metin olarak verilir:
    // <span class="ekuri e1">1-4</span> Eküridir. -- yani "1" ve "4" numaralı
    // atlar eküridir. Önceki sürüm bunu at satırındaki bir "nal" ikonundan
    // okumaya çalışıyordu; gerçek bültende böyle bir ikon hiç yok, bu yüzden
    // eküri hiçbir zaman tespit edilemiyordu. Artık doğrudan bu footer
    // metninden okunuyor; birden fazla eküri grubu olabileceği için
    // sayfadaki tüm "ekuri" class'lı span'lar taranır.
    const ekuriGroups = [...row.querySelectorAll('[class*="ekuri"]')]
      .map(el => (el.textContent||'').match(/\d+/g) || [])
      .filter(nums => nums.length>=2);
    let ekIdx=1;
    for (const nums of ekuriGroups){
      const tag='E'+ekIdx; ekIdx++;
      const members=[];
      for (const num of nums){
        const h = horses.find(x => String(x.no).trim() === String(num).trim());
        // Eküri işareti yalnız at numarasına eklenir; kaynaktaki gerçek AGF yüzdesi
        // burada değiştirilmez -- toplam ataması aşağıda AYRI bir adımda yapılır.
        if (h && !/-E\d+$/.test(h.no)) h.no = h.no + '-' + tag;
        if (h) members.push(h);
      }
      // KULLANICI KURALI: eküri ortaklarının AGF toplamı (havuzdaki gerçek birleşik
      // para akışı), bireysel AGF'si daha yüksek olan ortağa yazılır -- o at ekürünün
      // "temsilcisi" sayılır. Diğer ortağın AGF'si KENDİ bireysel değerinde kalır,
      // değiştirilmez. Bu, yalnızca 2+ ortağı bulunan (gerçek eküri) gruplarda uygulanır.
      if (members.length>=2){
        const vals=members.map(h=>Number(h.agf)||0);
        const total=vals.reduce((a,b)=>a+b,0);
        let strongestIdx=0;
        for(let i=1;i<members.length;i++) if(vals[i]>vals[strongestIdx]) strongestIdx=i;
        members[strongestIdx].agf=total;
      }
    }

    let horseObjs = horses.map(h => ({
      horse_no: h.no, horse_name: h.name,
      agf: h.agf, g800: null, hndkp: h.hnd, s_value: null, jbyg: null,
      tr: h.agf, value_score: null, value_raw: '',
      sp: null, result_score: null, star_value: null,
      bmb: 0, ypuan: null,
      finish_position: h.finishPos,
      winner: h.finishPos === 1 ? 1 : 0,
      result_time: h.resultTime || '',
      official_time: h.resultTime || ''
    }));

    races.push(normalizeRaceObj({
      id: Date.now()+li, file_id:null, sequence_no:null, filename, race_date:date, hippodrome:hip,
      leg: li+1, distance, surface, breed, condition_text: condition, horses: horseObjs, active:1,
      _absRaceNo: startIdx + li + 1
    }));
  }
  return { file:{sequence_no:null, filename:displayFilename, race_date:date, hippodrome:canonicalHippodrome(hip), altili_no:Math.min(altiliNo,markers.length), altili_count:markers.length}, races };
}

function tkpDayNameFromISO(date){
  const m=String(date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return '';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  if(!Number.isFinite(d.getTime())) return '';
  return ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'][d.getUTCDay()] || '';
}



function _v25IsFolderAssetFile(f){
  const path=String(f?.webkitRelativePath||f?.name||'').replace(/\\/g,'/');
  const name=String(f?.name||'');
  // Web sayfası "Complete" kaydındaki yardımcı klasörler: "Yarış Programı_files/..." gibi.
  // Kök HTML dosyası (Yarış Programı.html / Yarış Sonuçları.html) ASLA burada elenmez.
  if(/(^|\/)[^\/]*(?:_|-)files\//i.test(path) || /(^|\/)[^\/]*(?:_)(files|dosyalar)\//i.test(path)) return true;
  if(/^(ads?|aframe|ssp|sync|isyn|bus|activityi|cookie_push_onload|zrt_lookup[\w-]*(?:\(\d+\))?|generateWidget(?:\(\d+\))?)\.html?$/i.test(name)) return true;
  return false;
}
function _v25LooksLikeTjkPage(text,title=''){
  const head=String(title||'')+' '+String(text||'').slice(0,6000);
  return (/tjk\.org|Türkiye Jokey|Turkiye Jokey|GunlukYaris|Yar[ıi]ş\s+(Program[ıi]|Sonuçlar[ıi])/i.test(head) && (/kosubilgisi-/i.test(text) || /gunluk-GunlukYaris(?:Programi|Sonuclari)-AtAdi/i.test(text)));
}
function _v25GuessTjkKind(text,title=''){
  if(/gunluk-GunlukYarisProgrami-AtAdi/i.test(text)) return 'program';
  if(/gunluk-GunlukYarisSonuclari/i.test(text)) return 'results';
  if(/Yar[ıi]ş\s+Program[ıi]/i.test(title+' '+String(text).slice(0,6000))) return 'program';
  if(/Yar[ıi]ş\s+Sonuçlar[ıi]/i.test(title+' '+String(text).slice(0,6000))) return 'results';
  return 'program';
}

function _v25TjkFileScore(f, text, kind){
  const path=String(f?.webkitRelativePath||f?.name||'');
  const name=String(f?.name||'');
  let score=0;
  if(/Yar[ıi]ş\s+(Program[ıi]|Sonuçlar[ıi])/i.test(name)) score+=40;
  if(/GunlukYaris(Programi|Sonuclari)/i.test(text)) score+=30;
  if(/<h2[^>]*[^<]*(Yar[ıi]ş\s+(Program[ıi]|Sonuçlar[ıi]))/i.test(text)) score+=30;
  if(/<div[^>]+class=["'][^"']*program/i.test(text)) score+=15;
  if(/kosubilgisi-/.test(text)) score+=15;
  if(/_files[\\/]/i.test(path)) score-=60;
  if(/^ads?|^aframe|^ssp|^sync/i.test(name)) score-=80;
  if(kind==='program' && /GunlukYarisProgrami-AtAdi/i.test(text)) score+=20;
  if(kind==='results' && /GunlukYarisSonuclari/i.test(text)) score+=20;
  return score;
}
function _v25TjkCurrentProgramRoot(doc, preferredHip=''){
  const currentCityEl = doc.querySelector('ul.gunluk-tabs a.current[id]');
  const programs=[...doc.querySelectorAll('div.program[id]')];
  const pref=canonicalHippodrome(String(preferredHip||''));
  if(pref){
    const preferred=programs.find(el=>canonicalHippodrome(String(el.getAttribute('id')||''))===pref);
    if(preferred) return preferred;
  }
  if(currentCityEl){
    const cur=canonicalHippodrome(String(currentCityEl.getAttribute('id')||''));
    const exact=programs.find(el=>canonicalHippodrome(String(el.getAttribute('id')||''))===cur);
    if(exact) return exact;
  }
  return programs.find(el=>el.querySelector('div[id^="kosubilgisi-"]')) || programs[0] || doc;
}

function tkpBetKeyFromLabel(label){
  const t=fold(label||'')
    .replace(/['’`´]/g,'')
    .replace(/\s+/g,' ')
    .trim();
  if(!t) return '';
  if(/SIRALI\s*5\s*L[İI]\s*BAH[İI]S|5\s*L[İI]\s*SIRALI/.test(t)) return 'sirali_5li';
  if(/TABELA/.test(t)) return /SIRASIZ/.test(t) ? 'tabela_sirasiz' : 'tabela';
  if(/SIRALI\s*[ÜU]ÇL[ÜU]|SIRALI\s*UCLU/.test(t)) return 'sirali_uclu';
  if(/[ÜU]ÇL[ÜU]\s*BAH[İI]S|UCLU\s*BAHIS/.test(t)) return 'uclu_bahis';
  if(/SIRALI\s*[İI]K[İI]L[İI]/.test(t)) return 'sirali_ikili';
  if(/PLASE\s*[İI]K[İI]L[İI]/.test(t)) return 'plase_ikili';
  // NOT: Düz "İKİLİ" (SIRALI/PLASE önekli olmayan) bilinçli olarak eşlenmiyor.
  // Kupon motoru (coupon-builder.js/tkp-backtest-fast.js) sadece sirali_ikili,
  // sirali_uclu/uclu_bahis, tabela, sirali_5li ve cifte anahtarlarını kontrol
  // ediyor; kullanıcı düz İkili bahsini hiç kullanmıyor.
  if(/Ç[İI]FTE|CIFTE/.test(t)) return 'cifte';
  if(/PLASE/.test(t)) return 'plase';
  if(/6\s*L[İI]\s*GANYAN|ALTILI\s*GANYAN/.test(t)) return 'altili';
  if(/5\s*L[İI]\s*GANYAN|BE[ŞS]L[İI]\s*GANYAN/.test(t)) return 'besli';
  if(/4\s*L[ÜU]\s*GANYAN|D[ÖO]RTL[ÜU]\s*GANYAN/.test(t)) return 'dortlu_ganyan';
  if(/3\s*L[ÜU]\s*GANYAN|[ÜU]ÇL[ÜU]\s*GANYAN/.test(t)) return 'uclu_ganyan';
  if(/\bGANYAN\b/.test(t)) return 'ganyan';
  return '';
}

function parseTjkAvailableBetsForRace(raceDiv){
  const parts=[];
  let cur=raceDiv.previousElementSibling, guard=0;
  while(cur && guard++<18){
    if(cur.matches && cur.matches('div[id^="kosubilgisi-"]')) break;
    const tx=norm(cur.textContent||'');
    if(tx && /GANYAN|BAH[İI]S|BAHIS|[İI]K[İI]L[İI]|PLASE|TABELA|Ç[İI]FTE|CIFTE/i.test(tx)) parts.push(tx);
    cur=cur.previousElementSibling;
  }
  if(!parts.length){
    // KÖK FIX: Eskiden burada .bahisTipiGridContainer (koşunun TÜM bahis türü
    // kartlarını saran DIŞ kutu) tek bir textContent bloğu olarak okunuyordu.
    // TJK sayfasında ayrı kartlar arasında satır sonu/virgül gibi bir ayraç
    // YOK -- yalnız boşluk var. Bu yüzden aşağıdaki bölme adımı (split) hiçbir
    // şeyi ayıramıyor, tüm kartların metni TEK bir dev satır halinde
    // tkpBetKeyFromLabel'e gidiyor ve öncelik listesindeki İLK eşleşen kural
    // (ör. "SIRALI İKİLİ") kazanıp geri kalan 8-10 bahis türünü (İKİLİ, ÇİFTE,
    // PLASE, ÜÇLÜ BAHİS, TABELA, SIRALI 5Lİ vb.) sessizce eziyordu -- her koşuya
    // sadece TEK bir yan bahis türü yazılıyordu. Artık kartlar .bahisTipiCard
    // sınıfıyla TEK TEK okunuyor; her kart kendi ayrı 'part'ı olarak eşleniyor.
    const ownScope = raceDiv.parentElement || raceDiv;
    let cards=[...ownScope.querySelectorAll('.bahisTipiCard')];
    if(!cards.length){
      const scope=(raceDiv.closest && raceDiv.closest('[sehir]')) || raceDiv.parentElement || raceDiv;
      cards=[...scope.querySelectorAll('.bahisTipiCard')];
    }
    if(!cards.length){
      // Geriye dönük uyumluluk: kart sınıfı hiç bulunamazsa eski geniş konteyner seçicilerine düş.
      const scope=(raceDiv.closest && raceDiv.closest('[sehir]')) || raceDiv.parentElement || raceDiv;
      cards=[...scope.querySelectorAll('.bahisTipiGridContainer,.bahisTipiGrid,.bahisler,.race-bets,.bahisSonucCard')];
    }
    cards.slice(0,24).forEach(el=>parts.push(norm(el.textContent||'')));
  }
  const out=new Set();
  for(const part of parts){
    const chunks=String(part||'').split(/(?:\n|·|\||,|;|\t)+/).map(norm).filter(Boolean);
    for(const chunk of (chunks.length?chunks:[part])){
      const key=tkpBetKeyFromLabel(chunk);
      if(key) out.add(key);
    }
  }
  return [...out];
}


// TJK eküri bilgisi at satırında değil, koşu tablosunun hemen altındaki
// `.tablo-ekuri` alanında verilir. Örnek:
//   [(3)SİNDİRELLA,(1)AFAMIA], [(2)EL NACHO,(5)BANDIDITA] eküridir.
// Bu yardımcı her iç span'ı ayrı grup kabul eder, program numaralarını çıkarır
// ve sistemin kullandığı `-E1`, `-E2` etiketlerini at numarasına ekler.
function tkpTjkEkuriFootersForRace(raceDiv){
  const out=[];
  const seen=new Set();
  const push=el=>{ if(el && !seen.has(el)){ seen.add(el); out.push(el); } };

  // GERÇEK TJK ŞEMASI (04.08.2026 Kocaeli HTML ile doğrulandı):
  // div#kosubilgisi-XXXX ile span.tablo-ekuri aynı yarış kapsayıcısının
  // doğrudan çocuklarıdır; footer kosubilgisi divinden SONRA gelir.
  const raceId=String(raceDiv?.id||'').replace(/^kosubilgisi-/i,'');
  const parent=raceDiv?.parentElement || null;
  if(parent){
    const direct=[...parent.children];
    const idx=direct.indexOf(raceDiv);
    for(let i=idx+1;i<direct.length;i++){
      const el=direct[i];
      if(el?.matches?.('div[id^="kosubilgisi-"]')) break;
      if(el?.matches?.('.tablo-ekuri')) push(el);
      el?.querySelectorAll?.('.tablo-ekuri').forEach(push);
      // Aynı yarışın bahis kartlarına gelince aramayı bitir; sonraki yarışa sarkma.
      if(el?.matches?.('.bahisTipiGridContainer')) break;
    }
  }

  // Şablon varyasyonları için kontrollü kardeş yedeği.
  if(!out.length){
    let cur=raceDiv?.nextElementSibling || null, guard=0;
    while(cur && guard++<40){
      if(cur.matches?.('div[id^="kosubilgisi-"]')) break;
      if(cur.matches?.('.tablo-ekuri')) push(cur);
      cur.querySelectorAll?.('.tablo-ekuri').forEach(push);
      if(cur.matches?.('.bahisTipiGridContainer')) break;
      cur=cur.nextElementSibling;
    }
  }

  // Son güvenli yedek: yarış kimliği olan kapsayıcı içindeki ilk footer.
  if(!out.length && parent){
    parent.querySelectorAll?.('.tablo-ekuri').forEach(el=>{
      const previousRace=el.previousElementSibling?.matches?.('div[id^="kosubilgisi-"]')
        ? el.previousElementSibling
        : el.parentElement?.querySelector?.(`#kosubilgisi-${raceId}`);
      if(!raceId || previousRace===raceDiv) push(el);
    });
  }
  return out;
}
function tkpTjkEkuriGroupsForRace(raceDiv, horses){
  const validNos=new Set((horses||[]).map(h=>String(h?.no??h?.horse_no??'').trim()).filter(Boolean));
  const groups=[];
  const signatures=new Set();
  for(const footer of tkpTjkEkuriFootersForRace(raceDiv)){
    let pieces=[...footer.querySelectorAll(':scope > span')];
    if(!pieces.length) pieces=[...footer.querySelectorAll('span')];
    if(!pieces.length) pieces=[footer];
    for(const piece of pieces){
      const text=String(piece.textContent||'');
      let nums=[...text.matchAll(/\((\d{1,2})\)/g)].map(m=>m[1]);
      if(nums.length<2) nums=(text.match(/\d{1,2}/g)||[]);
      nums=[...new Set(nums.map(x=>String(Number(x))).filter(x=>x!=='NaN'&&validNos.has(x)))];
      if(nums.length<2) continue;
      const sig=nums.slice().sort((a,b)=>Number(a)-Number(b)).join('-');
      if(signatures.has(sig)) continue;
      signatures.add(sig); groups.push(nums);
    }
  }
  return groups;
}
function tkpApplyTjkEkuriGroups(raceDiv, horses, combineAgf=false){
  const groups=tkpTjkEkuriGroupsForRace(raceDiv,horses);
  groups.forEach((nums,index)=>{
    const tag='E'+(index+1);
    const members=[];
    nums.forEach(num=>{
      const h=(horses||[]).find(x=>String(x?.no??x?.horse_no??'').replace(/-E\d+$/i,'').trim()===String(num));
      if(!h) return;
      const raw=String(h.no??h.horse_no??'').replace(/-E\d+$/i,'').trim();
      if('no' in h) h.no=raw+'-'+tag;
      if('horse_no' in h) h.horse_no=raw+'-'+tag;
      h.ekuri_group=tag;
      members.push(h);
    });
    if(combineAgf && members.length>=2){
      const vals=members.map(h=>Number(h.agf)||0);
      const total=vals.reduce((a,b)=>a+b,0);
      let strongest=0;
      for(let i=1;i<members.length;i++) if(vals[i]>vals[strongest]) strongest=i;
      members[strongest].agf=total;
    }
  });
  return groups;
}


// R16.45 — GÜNLÜK KAYNAK SAHİPLİĞİ GERİ YÜKLEME
// Güncel yarışta GLP ve J-BYG, Veri Toplayıcı'nın TJK Program HTML'ine gömdüğü
// `tkp-tjk-enrichment` kanıtından gelir. Eski/tarihsel yarışlarda bu TJK canlı
// zenginleştirmesi kullanılmaz; tarihsel köprü GC -> YeniBeygir fallback zincirini
// ayrı tutar. Böylece günlük ve arşiv kaynakları birbirine karışmaz.
function tkpLocalTodayIso(){
  const d=new Date(),pad=v=>String(v).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function tkpIsCurrentLocalRaceDate(value){
  const m=String(value||'').match(/(\d{4})[-/.](\d{2})[-/.](\d{2})/);
  return !!m && `${m[1]}-${m[2]}-${m[3]}`===tkpLocalTodayIso();
}
function tkpTjkProgramEnrichmentFromDoc(doc){
  try{
    const el=doc?.getElementById?.('tkp-tjk-enrichment');
    if(!el)return null;
    const data=JSON.parse(el.textContent||'{}');
    if(Number(data?.schema)<9||!Array.isArray(data?.entities))return null;
    return data;
  }catch(_e){return null;}
}
function tkpTjkLiveHorseNo(value){return String(value??'').trim().replace(/-E\d+$/i,'').match(/^\d+/)?.[0]||'';}
function tkpTjkLiveNameKey(value){
  return fold(String(value??'').replace(/\(KOŞMAZ\)/ig,' ').replace(/\([^)]*\)/g,' ').replace(/\bKG\b|\bDB\b|\bSK\b|\bGKR\b|\bKUL\b/ig,' ')).replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function tkpTjkLiveEntity(data,type,raceCode,horse){
  const entities=Array.isArray(data?.entities)?data.entities:[];
  const no=tkpTjkLiveHorseNo(horse?.horse_no),name=tkpTjkLiveNameKey(horse?.horse_name),code=String(raceCode||'');
  const scoped=entities.filter(e=>String(e?.type||'')===type&&(!code||!String(e?.raceCode||'')||String(e.raceCode)===code));
  let hit=no?scoped.find(e=>tkpTjkLiveHorseNo(e?.horseNo)===no&&(!code||!e?.raceCode||String(e.raceCode)===code)):null;
  if(!hit&&name)hit=scoped.find(e=>tkpTjkLiveNameKey(e?.horseName||e?.name)===name);
  if(!hit&&type==='horse'&&name)hit=scoped.find(e=>tkpTjkLiveNameKey(e?.name)===name);
  return hit||null;
}
function tkpTjkLivePct(value){const n=Number(value);return Number.isFinite(n)&&n>=0&&n<=100?n:null;}
function tkpTjkWorkoutSeconds(value){
  const raw=String(value??'').trim().replace(',','.');if(!raw)return null;
  const nums=raw.match(/\d+(?:\.\d+)?/g);if(!nums?.length)return null;
  const parts=raw.split(/[:.]/).map(x=>Number(x)).filter(Number.isFinite);
  if(parts.length>=3)return parts[0]*60+parts[1]+parts[2]/100;
  if(parts.length===2&&parts[0]<=2)return parts[0]*60+parts[1];
  const n=Number(nums[0]);return Number.isFinite(n)&&n>0?n:null;
}
function tkpApplyLiveTjkProgramEnrichment(race,raceCode,data,date){
  if(!race||!Array.isArray(race.horses)||!data)return race;
  let pctCount=0,workoutCount=0;
  for(const h of race.horses){
    const horse=tkpTjkLiveEntity(data,'horse',raceCode,h);
    const jockey=tkpTjkLiveEntity(data,'jockey',raceCode,h);
    const trainer=tkpTjkLiveEntity(data,'trainer',raceCode,h);
    const jp=tkpTjkLivePct(jockey?.winPct),tp=tkpTjkLivePct(trainer?.winPct);
    if(jp!=null){h.jockey_win_pct=Math.round(jp*100)/100;pctCount++;}
    if(tp!=null){h.trainer_win_pct=Math.round(tp*100)/100;pctCount++;}
    const w=horse?.workout||null;
    if(w){
      h.workout_800=String(w.t800||'');h.workout_600=String(w.t600||'');h.workout_400=String(w.t400||'');
      h.workout_date=String(w.date||'');h.workout_jockey=String(w.jockey||'');
      const sec=tkpTjkWorkoutSeconds(w.t800||w.t400||'');
      if(Number.isFinite(sec)&&sec>0){h.__tkp_live_glp_sec=sec;workoutCount++;}
    }
  }
  // Eski çalışan J-BYG kuralı: Jokey + Antrenör resmi TJK başarı yüzdelerinin
  // ortalaması; %8,50 üstü adaylar azalan sırada, en fazla ilk 7.
  tkpNullOutSuspiciousZeroJBygRates(race.horses);
  const jCandidates=[];
  for(const h of race.horses){
    const jp=tkpTjkLivePct(h?.jockey_win_pct),tp=tkpTjkLivePct(h?.trainer_win_pct);
    if(jp==null||tp==null)continue;
    const avg=Math.round(((jp+tp)/2)*100)/100;h.team_strength_pct=avg;h.jbyg_rate=avg;
    if(avg>8.5&&!/\(KOŞMAZ\)/i.test(String(h?.horse_name||'')))jCandidates.push(h);
  }
  jCandidates.sort((a,b)=>Number(b.team_strength_pct)-Number(a.team_strength_pct)||Number(tkpTjkLiveHorseNo(a.horse_no)||999)-Number(tkpTjkLiveHorseNo(b.horse_no)||999));
  jCandidates.slice(0,7).forEach((h,index)=>{const rank=index+1;h.jbyg=rank;h.jbyg_rank=rank;h.team_strength_rank=rank;h.jbyg_source='TJK_PROGRAM_JBYG';h.jbyg_asof_date=date||race.race_date||'';});

  // GLP: TJK resmi koşu-içi İdman Bilgileri. Kolektör kullanıcı kilidine göre
  // `t800` alanına 400 m derecesini yansıtır; en hızlı ilk 6 sıralanır.
  const gCandidates=race.horses.filter(h=>Number.isFinite(h?.__tkp_live_glp_sec)&&h.__tkp_live_glp_sec>0&&!/\(KOŞMAZ\)/i.test(String(h?.horse_name||'')));
  gCandidates.sort((a,b)=>a.__tkp_live_glp_sec-b.__tkp_live_glp_sec||Number(tkpTjkLiveHorseNo(a.horse_no)||999)-Number(tkpTjkLiveHorseNo(b.horse_no)||999));
  gCandidates.slice(0,6).forEach((h,index)=>{const rank=index+1;h.g800=rank;h.g800_rank=rank;h.galop_rank=rank;h.glp_rank=rank;h.glp_source='TJK_PROGRAM_GALOP';h.glp_asof_date=date||race.race_date||'';});
  for(const h of race.horses)delete h.__tkp_live_glp_sec;
  const jApplied=jCandidates.slice(0,7).length,gApplied=gCandidates.slice(0,6).length;
  race.support_layers={...(race.support_layers||{}),
    glp:{complete:gApplied>0,source:'TJK_PROGRAM_GALOP',asof:date||race.race_date||'',eligible:workoutCount,applied:gApplied,mode:'DAILY_TJK'},
    jbyg:{complete:jApplied>0,source:'TJK_PROGRAM_JBYG',asof:date||race.race_date||'',eligible:jCandidates.length,applied:jApplied,threshold:'>8.50',limit:7,personPctCount:pctCount,mode:'DAILY_TJK'}
  };
  return race;
}

// --- TJK (tjk.org) "Yarış Programı" sayfası ayrıştırıcısı ---
// Bu tek sayfa hem YERLİ (İstanbul/İzmir) hem YURT DIŞI (ör. Del Mar ABD, Saratoga ABD,
// Woodbine Kanada, Mont De Marsan Fransa) koşuları için AYNI formatta at listesi + AGF
// verir -- ayrı bir "İngilizce site" gerekmez, TJK'nın kendi programı yeterlidir.
// İLK SÜRÜM: Tek bir örnek dosyayla test edildi (Del Mar ABD, 26.07.2026). Kaynak
// sitenin başka bir güne/şehre/koşu tipine (ör. çekilen at gösterimi) farklı bir HTML
// varyantı çıkarması hâlinde ince ayar gerekebilir.
function parseTjkProgramHTML(htmlText, filename, altiliNo=1, preferredHip=''){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');
  // Günlük kullanımda kolektörün TJK koşu-içi İdman/Jokey/Antrenör kanıtını oku.
  // Tarihsel GLP/J-BYG bununla doldurulmaz; arşiv zinciri GC -> YeniBeygir'dir.
  const tjkProgramEnrichment=tkpTjkProgramEnrichmentFromDoc(doc);
  const queryId=(href,key)=>{try{const u=new URL(href,location.href);return u.searchParams.get('QueryParameter_'+key)||u.searchParams.get(key)||'';}catch(_e){return '';}};

  // Tarih: "26/07/2026 Pazar - Yarış Programı" başlığından (gg/aa/yyyy formatında).
  const titleEl = [...doc.querySelectorAll('h2')].find(el => /Yarış Programı/i.test(el.textContent));
  const titleText = titleEl ? titleEl.textContent : doc.body.textContent;
  const dm = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
  if (!date) throw new Error('TJK Yarış Programı sayfasında tarih bulunamadı.');

  // Şehir/hipodrom: önce aktif program div'i veya aktif şehir sekmesi okunur;
  // bunlar yoksa koşu başlığındaki sehir özniteliğine düşülür. Bu düzeltme özellikle
  // TJK klasör yüklemede yerli/yurt dışı çok sekmeli HTML'lerde yanlış ilk sekmenin
  // alınmasını engeller.
  const programEl = _v25TjkCurrentProgramRoot(doc, preferredHip);
  const currentCityEl = doc.querySelector('ul.gunluk-tabs a.current[id]');
  const sehirEl = programEl?.querySelector ? programEl.querySelector('[sehir]') : null;
  // V1.1.155: çok sekmeli TJK HTML'lerinde global .current sekme başka pistte kalabiliyor.
  // Pist kimliği önce seçilmiş program kökünden/koşu bloğundan alınır; global sekme yalnız son fallback'tir.
  const programHip = programEl?.getAttribute?.('sehir') || programEl?.getAttribute?.('data-sehir') || programEl?.getAttribute?.('id') || '';
  const preferredCanonical = canonicalHippodrome(String(preferredHip||'').trim());
  const hipRaw = sehirEl?.getAttribute('sehir') || programHip || currentCityEl?.getAttribute('id') || preferredCanonical || '';
  const hip = canonicalHippodrome(String(hipRaw || '').trim());
  if (!hip) throw new Error('TJK Yarış Programı sayfasında hipodrom/şehir bulunamadı.');

  const raceRoot = (programEl && programEl.querySelector) ? programEl : doc;
  const raceDivs = [...raceRoot.querySelectorAll('div[id^="kosubilgisi-"]')];
  if (!raceDivs.length) throw new Error('TJK sayfasında koşu tablosu (kosubilgisi) bulunamadı.');

  // "6'LI GANYAN Bu koşudan başlar" işareti, koşunun at tablosu ("kosubilgisi- / kosubilgisi--")
  // İÇİNDE değil, onunla KARDEŞ olan "bahisTipiGridContainer" bölümünde yer alır --
  // ikisi de aynı üst (şehir/koşu) sarmalayıcı div'in çocuğudur. Bu yüzden işaret
  // üst konteynerin (parentElement) metninde aranır. Sayfada zaten TAM 6 koşu
  // varsa (tek Altılı bloğu, belirsizlik yok) işaret aramaya HİÇ gerek yoktur --
  // bazı sayfa türlerinde (ör. Yarış Sonuçları) işaretin DOM konumu farklı
  // olabildiği için yalnızca 6'dan FAZLA koşu varken (çoklu Altılı belirsizliği)
  // işarete güvenilir.
  const markerStarts=[];
  if (raceDivs.length > 6){
    for(let i=0;i<raceDivs.length;i++){
      let cur=raceDivs[i].previousElementSibling, guard=0, found=false;
      while(cur && guard++<12){
        if(cur.matches && cur.matches('div[id^="kosubilgisi-"]')) break;
        const txt=fold(cur.textContent||'');
        if((/ALTILI\s*GANYAN/.test(txt)||/6\s*'?\s*L[İIÜU]\s*GANYAN/.test(txt)) && txt.includes('BAŞLAR')){found=true;break;}
        cur=cur.previousElementSibling;
      }
      if(found) markerStarts.push(i);
    }
  }
  const fallbackStarts = raceDivs.length>6 ? [0,Math.max(0,raceDivs.length-6)] : [0];
  const starts=[...new Set((markerStarts.length?markerStarts:fallbackStarts))].sort((a,b)=>a-b);
  const selectedIndex=Math.min(Math.max(1,Number(altiliNo)||1),starts.length)-1;
  const startIdx=starts[selectedIndex] ?? 0;
  const raceSlice = raceDivs.slice(startIdx, startIdx + 6);
  if (raceSlice.length < 6) throw new Error(`Altılı Ganyan başlangıcından itibaren 6 koşu yok (sadece ${raceSlice.length} koşu bulundu).`);

  function parseConfig(h3El){
    if (!h3El) return {condition:'', distance:null, surface:'', breed:''};
    const text = h3El.textContent.replace(/\s+/g,' ').trim();
    // Örnek: "Şartlı/Dişi , 3 ve Yukarı İngilizler, kg, 1600 Çim"
    const condition = (text.split(',')[0] || '').trim();
    const m = text.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/i);
    const distance = m ? +m[1] : null;
    const surfaceRaw = m ? m[2] : '';
    const surface = /çim/i.test(surfaceRaw) ? 'ÇİM' : (/sentetik/i.test(text) ? 'SENT.' : (/kum/i.test(surfaceRaw) ? 'KUM' : ''));
    const breed = /İngiliz/i.test(text) ? 'İNG' : (/Arap/i.test(text) ? 'ARP' : '');
    return {condition, distance, surface, breed};
  }

  function parseAgfCell(cell){
    if (!cell) return null;
    const wantedAlt = Math.max(1, Number(altiliNo) || 1);
    const anchors = [...cell.querySelectorAll('a[title]')];
    let raw = '';
    if (anchors.length){
      // TJK bazı koşularda aynı hücreye hem 1. hem 2. Altılı AGF'sini yazar:
      // title="1. 6'LI GANYAN : %9,93(5)" / title="2. 6'LI GANYAN : %9,13(5)".
      // Eski regex ilk "1" sayısını AGF sanıyordu; ilk 2-3 koşuda AGF'nin 1 görünme sebebi buydu.
      const altRe = new RegExp('(^|\\D)' + wantedAlt + '\\s*\\.\\s*(?:6|ALTILI)', 'i');
      const picked = anchors.find(a => altRe.test(String(a.getAttribute('title')||'')))
        || anchors[Math.min(anchors.length-1, wantedAlt-1)]
        || anchors[0];
      raw = String((picked.getAttribute('title')||'') + ' ' + (picked.textContent||''));
    } else {
      raw = String(cell.textContent || '');
    }
    let m = raw.match(/%\s*(\d{1,3}(?:[.,]\d+)?)/);
    if(!m){
      // Son çare: hücre metnindeki yüzdeyi ara; yine de "1. 6'LI" gibi sıra numaralarına düşme.
      const txt=String(cell.textContent||'');
      m = txt.match(/%\s*(\d{1,3}(?:[.,]\d+)?)/);
    }
    if (!m) return null;
    const v = Number(m[1].replace(',','.'));
    return Number.isFinite(v) && v>=0 && v<=100 ? Math.round(v) : null;
  }

  function tjkProgramRaceTime(absRaceNo,raceDiv=null){
    const wanted=Number(absRaceNo); if(!Number.isFinite(wanted)||wanted<1)return '';
    const rx=new RegExp('(?:^|\\s)'+wanted+'\\.?(?:\\s*)Koşu\\s+(\\d{1,2})[.:](\\d{2})(?:\\s|$)','i');
    const candidates=[];
    // Önce ilgili koşunun yakın üst/kardeş bloklarını tara. TJK saat başlığı h2/h3/div/span olabilir.
    if(raceDiv){
      let cur=raceDiv.previousElementSibling,guard=0;
      while(cur&&guard++<18){candidates.push(cur);if(cur.matches?.('div[id^="kosubilgisi-"]'))break;cur=cur.previousElementSibling;}
      let parent=raceDiv.parentElement,depth=0;while(parent&&depth++<3){candidates.push(parent);parent=parent.parentElement;}
    }
    // Sonra seçili program kökündeki olası başlıkları tara; body/global tarama yalnız en son.
    candidates.push(...raceRoot.querySelectorAll('h1,h2,h3,h4,h5,.race-title,.race-time,[class*="kosu"],[class*="race"]'));
    const seen=new Set();
    for(const el of candidates){
      if(!el||seen.has(el))continue;seen.add(el);
      const text=norm(el.textContent||''); const m=text.match(rx); if(!m)continue;
      const hh=Number(m[1]),mm=Number(m[2]); if(hh>=0&&hh<24&&mm>=0&&mm<60)return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    }
    return '';
  }

  let races = [];
  raceSlice.forEach((raceDiv, idx) => {
    const leg = idx + 1;
    const absRaceNo=startIdx+idx+1;
    const raceCode=String(raceDiv?.id||'').replace(/^kosubilgisi-+/i,'').trim();
    const tjkRaceTime=tjkProgramRaceTime(absRaceNo,raceDiv);
    // Bu koşuya ait üst bilgi (race-config: şart/mesafe/pist) bu div'den ÖNCEKİ
    // kardeş elemanların İÇİNDE (ör. div.race-details > h3.race-config) yer alır --
    // doğrudan kardeş değil, torun elemandır; bu yüzden her kardeşin kendisi VE
    // içindeki alt elemanlar aranır.
    let cursor = raceDiv.previousElementSibling, configEl = null, guard = 0;
    while (cursor && guard < 35){
      if (cursor.classList && cursor.classList.contains('race-config')) configEl = cursor;
      else if (cursor.querySelector) configEl = cursor.querySelector('.race-config');
      if (configEl) break;
      cursor = cursor.previousElementSibling; guard++;
    }
    const {condition, distance, surface, breed} = parseConfig(configEl);

    const trs = [...raceDiv.querySelectorAll('table.tablesorter tbody tr')];
    const horses = [];
    for (const tr of trs){
      const noCell = tr.querySelector('.gunluk-GunlukYarisProgrami-SiraId');
      const nameCell = tr.querySelector('.gunluk-GunlukYarisProgrami-AtAdi');
      const hcCell = tr.querySelector('.gunluk-GunlukYarisProgrami-Hc');
      const startCell = tr.querySelector('.gunluk-GunlukYarisProgrami-StartId');
      const agfCell = tr.querySelector('.gunluk-GunlukYarisProgrami-AGFORAN');
      const kiloCell = tr.querySelector('.gunluk-GunlukYarisProgrami-Kilo');
      const derceCell = tr.querySelector('.gunluk-GunlukYarisProgrami-DERECE');
      const son6Cell = tr.querySelector('.gunluk-GunlukYarisProgrami-Son6Yaris');
      const jockeyCell = tr.querySelector('.gunluk-GunlukYarisProgrami-JokeAdi,.gunluk-GunlukYarisProgrami-JokeyAdi,[class*="YarisProgrami-Joke"],[class*="YarisProgrami-Jokey"]');
      const trainerCell = tr.querySelector('.gunluk-GunlukYarisProgrami-AntronorAdi,.gunluk-GunlukYarisProgrami-AntrenorAdi,[class*="YarisProgrami-Antronor"],[class*="YarisProgrami-Antrenor"]');
      const ownerCell = tr.querySelector('.gunluk-GunlukYarisProgrami-SahipAdi,[class*="YarisProgrami-Sahip"]');
      // TJK'nin bir HTML varyantında sıra/ST hücresi boş gelebilir. At adı
      // mevcutsa satırı koru; numara boş kalabilir ve sonraki katman isimle
      // eşleştirir. Eksik tek alan yüzünden at satırı düşürülmez.
      if (!nameCell) continue;
      const no = norm(noCell?.textContent || tr.getAttribute('data-start-no') || tr.getAttribute('data-sira') || '');
      const nameLink = nameCell.querySelector('a');
      // Koşu SONUÇLANMIŞSA, TJK at isminin hemen yanına gerçek dereceyi ekler:
      // <a>AT ADI<span title="AT ADI bu koşuyu 4. olarak bitirmiştir.">(4)</span></a>
      // Bu span isme dahil edilmeden ÖNCE ayrıca okunup finish_position/winner
      // olarak saklanır; aksi halde at ismine "(4)" gibi bir ek karışırdı (bu da
      // isim bazlı geçmiş istatistik eşleşmelerini bozardı).
      let finishPos = null;
      let name = '';
      if (nameLink){
        const clone = nameLink.cloneNode(true);
        const resultSpan = clone.querySelector('span[title*="bitirmiştir"]');
        if (resultSpan){
          const fp = parseInt(norm(resultSpan.textContent).replace(/[()]/g,''), 10);
          if (Number.isFinite(fp) && fp>=1 && fp<=20) finishPos = fp;
          resultSpan.remove();
        }
        name = norm(clone.textContent);
      } else {
        name = norm(nameCell.textContent);
      }
      if (!name) continue;
      // Koşmayan/çekilen at tespiti: TJK'de bu genelde üstü çizili satır ya da
      // "ÇEKİLDİ" notuyla işaretlenir. Bulunursa isme " (KOŞMAZ)" eklenir --
      // isNonRunner() bunu otomatik yakalar (bkz. parseBulletinHTML'deki aynı mantık).
      const explicitNonRunner = tkpTjkRowIsExplicitNonRunner(tr,nameCell,nameLink);
      if (explicitNonRunner && !tkpExplicitNonRunnerText(name)) name = (name + ' (KOŞMAZ)').trim();
      const hnd = n(hcCell ? hcCell.textContent : '');
      const startNoRaw = startCell ? String(startCell.textContent||'').match(/\d+/)?.[0] : '';
      const startNo = startNoRaw ? Number(startNoRaw) : null;
      const agf = standardAgfValue(parseAgfCell(agfCell));
      // KİLO: hücre "60" gibi düz sayı veya "53<sup>...+1.70...Fazla Kilo</sup>" gibi
      // fazla kilo notu ekli olabilir (virgüllü ondalık: "51,5"). Taban kiloyu almak
      // için önce <sup> notu (varsa) klonlanan düğümden çıkarılır, sonra kalan metin
      // sayıya çevrilir. horseWeightKg() (coupon-builder.js) zaten 'weight_kg' alanını
      // arıyordu ama hiçbir parser bunu doldurmuyordu -- >60kg TEK yasağı kuralı bu
      // yüzden hep atıl kalıyordu. Artık gerçek kiloyla besleniyor.
      let weightKg = null;
      if (kiloCell){
        const kClone = kiloCell.cloneNode(true);
        const supEl = kClone.querySelector('sup');
        if (supEl) supEl.remove();
        const wRaw = norm(kClone.textContent).replace(',', '.');
        const wv = Number(wRaw);
        if (Number.isFinite(wv) && wv > 30 && wv < 100) weightKg = wv;
      }
      // DERECE: atın kişisel en iyi zamanı (ör. "1.20.83"); kırmızı font pist/yaş
      // rekoru anlamına gelir ama burada yalnız ham metin saklanır, yorumlama
      // yapılmaz. İlk çıkış yapan atlarda hücre boş olabilir (normal).
      let bestTime = '';
      if (derceCell){
        const drcSpan = derceCell.querySelector('#aciklamaFancyDrc') || derceCell;
        bestTime = norm(drcSpan.textContent);
      }
      // SON 6 YARIŞ: her hane bir geçmiş yarıştaki bitiriş sırasını temsil eder
      // (TJK kısaltması, "0" onun üstü/DNF gibi özel bir kodu belirtebilir); "-"
      // farklı yarış grupları arasına konur. Anlamı/renk kodlaması netleşene kadar
      // yalnız ham dizi olarak saklanır, puanlamaya karıştırılmaz -- yanlış
      // yorumlanan bir sinyal, hiç sinyal olmamasından daha kötü sonuç verir.
      let son6Raw = '';
      if (son6Cell) son6Raw = norm(son6Cell.textContent);
      // NOT: finishPos (Program sayfasında koşu bittiyse ada yapışık gelen "(N)
      // bitirmiştir" derecesi) BİLEREK horses.push'a taşınmıyor. Kullanıcı geri
      // bildirimi: bu, "Sonuç HTML Güncelle" adımı hiç çalıştırılmadan bir ayağın
      // sonuçlanmış gibi görünmesine yol açıp kafa karıştırıyordu. Artık Program
      // içe aktarımı HER ZAMAN saf tahmin (finish_position=null) olarak kalır;
      // gerçek sonuç yalnızca kullanıcının açıkça çalıştırdığı "Sonuç HTML
      // Güncelle" (parseTjkResultsHTML) adımından gelir. İsim yine de span'dan
      // temizlenir (yukarıda), sadece derece değeri yok sayılır.
      const horseId=queryId(nameLink?.getAttribute('href')||'','AtId');
      // Kaynak kilidi: TJK Program yalnız temel yarış/bülten verisidir. Jokey ve
      // antrenör ADLARI program satırından korunur; performans oranı ile galop/idman
      // zenginleştirmesi TJK'den üretilmez. Eksik JKY/GLP yalnız Ganyan Canavarı
      // katmanından doldurulur.
      const parsePerson=(cell,key)=>{const a=cell?.querySelector('a');const nm=norm(a?.textContent||cell?.textContent||'');const id=queryId(a?.getAttribute('href')||'',key);return {name:nm,id,pct:null};};
      const jockey=parsePerson(jockeyCell,'JokeyId');
      const trainer=parsePerson(trainerCell,'AntrenorId');
      const owner=parsePerson(ownerCell,'SahipId');
      const workout=null;
      // HNDKP yoksa 30 varsayımı yapma: null tutulur, puan motoru bu sinyali
      // yalnız ilgili at için paydadan çıkarır.
      horses.push({no, name, horseId, agf, hnd, startNo:Number.isFinite(startNo)?startNo:null, weightKg, bestTime, son6Raw, jockey, trainer, owner, workout});
    }

    // TJK eküri footer'ını oku; aynı eküri ortakları kupon/backtestte tek bahis
    // seçimi sayılır ve ortaklardan biri kazanırsa diğer ortak da tuttu kabul edilir.
    tkpApplyTjkEkuriGroups(raceDiv, horses, true);
    const ekuriGroupsForRace = [...new Set(horses.map(h=>h.ekuri_group).filter(Boolean))].map(tag=>({
      tag, members: horses.filter(h=>h.ekuri_group===tag).map(h=>String(h.no||'').replace(/-E\d+$/i,''))
    }));

    const horseObjs = horses.map(h => ({
      horse_no: h.no, horse_name: h.name, ekuri_group: h.ekuri_group||null,
      agf: h.agf, g800: null, hndkp: h.hnd, s_value: null, jbyg: null,
      tr: h.agf, value_score: null, value_raw: '',
      sp: null, result_score: null, star_value: null,
      bmb: 0, ypuan: null,
      finish_position: null,
      winner: 0,
      start_no: h.startNo, start_no_source: Number.isFinite(h.startNo)?'TJK_PROGRAM':'', weight_kg: h.weightKg, best_time: h.bestTime, son6_raw: h.son6Raw,
      tjk_at_id:h.horseId||null,
      jockey_name:h.jockey?.name||'', jockey_id:h.jockey?.id||null, jockey_win_pct:h.jockey?.pct,
      trainer_name:h.trainer?.name||'', trainer_id:h.trainer?.id||null, trainer_win_pct:h.trainer?.pct,
      owner_name:h.owner?.name||'', owner_id:h.owner?.id||null, owner_win_pct:h.owner?.pct,
      workout_800:h.workout?.t800||'', workout_600:h.workout?.t600||'', workout_400:h.workout?.t400||'', workout_date:h.workout?.date||'', workout_jockey:h.workout?.jockey||''
    }));
    // Günlük kaynak kilidi: normal TJK Program satırı burada yalnız temel alanları kurar.
    // Aşağıdaki tkp-tjk-enrichment kanıtı BUGÜN için resmi TJK koşu-içi
    // Jokey/Antrenör + İdman verisini GLP/J-BYG'ye bağlar. Eski tarihlerde ise
    // bu canlı TJK katmanı kullanılmaz; GC -> YeniBeygir tarihsel zinciri geçerlidir.
    tkpNullOutSuspiciousZeroJBygRates(horseObjs);
    const availableBets=parseTjkAvailableBetsForRace(raceDiv);

    const normalizedRace=normalizeRaceObj({
      id: Date.now()+leg, file_id:null, sequence_no:null, filename, race_date:date, hippodrome:hip,
      leg, distance, surface, breed, condition_text: condition, horses: horseObjs, active:1,
      // Yorumcu/Twitter kaynaklarının YPUAN eşleştirmesi _absRaceNo üzerinden yapılır
      // (bkz. classifyAndMergeFiles). Bu olmadan yorumcu dosyaları sessizce hiç
      // uygulanmıyordu -- aynı mutlak koşu numarası mantığı burada da kullanılır.
      _absRaceNo: absRaceNo,
      tjk_race_time: tjkRaceTime || null,
      program_source: 'TJK_PROGRAM',
      available_bets: availableBets,
      ekuri_groups: ekuriGroupsForRace
    });
    // Yalnız BUGÜNÜN TJK Programı için resmi koşu-içi GLP/J-BYG kanıtını uygula.
    // Eski tarihte açılan TJK dosyası bu canlı katmanı sahiplenemez.
    if(tkpIsCurrentLocalRaceDate(date))tkpApplyLiveTjkProgramEnrichment(normalizedRace,raceCode,tjkProgramEnrichment,date);
    races.push(normalizedRace);
  });

  const dayName=tkpDayNameFromISO(date);
  const displayFilename=hip ? `${hip==='DEL MAR'?'DELMAR':hip} HTML` : 'HTML';
  return { file:{sequence_no:null, filename: displayFilename, race_date:date, hippodrome:canonicalHippodrome(hip), altili_no:selectedIndex+1, altili_count:starts.length}, races };
}

// --- TJK (tjk.org) "Yarış Sonuçları" sayfası ayrıştırıcısı ---
// "Yarış Programı" ile AYNI sayfa iskeletini kullanır (aynı "kosubilgisi- / kosubilgisi--" koşu
// konteynerleri, aynı "sehir" özniteliği, aynı "6'LI GANYAN" işareti, aynı
// table.tablesorter), ama sütun class önekleri "gunluk-GunlukYarisProgrami-*"
// yerine "gunluk-GunlukYarisSonuclari-*" ve şu farklarla:
//  - At numarası "SiraId" değil "StartId" sütunundadır.
//  - Gerçek derece (finish_position) "SONUCNO" ("S" başlıklı) sütunundadır.
//  - At ismi hücresinde isimden hemen sonra kendi program numarası "(N)" olarak
//    tekrar yazılır (boş bir <span title=""></span> ile birlikte) -- bu, isme
//    karışmaması için ayrıca temizlenir (Program sayfasındaki "bitirmiştir" span'ı
//    ile KARIŞTIRILMAMALI; orada derece, burada sadece program no tekrarıdır).
// Bu fonksiyon #resultBulletinFile ("Sonuç HTML Güncelle") akışında kullanılır;
// import_kind='RESULT_HTML' işaretini app-controller.js koyar, mevcut TJK
// programı kaydına tarih+hipodrom+ayak+at no eşleşmesiyle sonuç işlenir.
function tkpOfficialResultHorseIdentity(rawName,fallbackNo=''){
  const text=String(rawName||'').replace(/\s+/g,' ').trim();
  // TJK may append a country after the program number: LOCO SUGAR(8) (IRE).
  // StartId is not the program number; do not fall back merely because of that suffix.
  const match=text.match(/\((\d{1,2})\)(?=\s*(?:\([A-Za-z]{2,4}\)\s*)*$)/);
  return {no:match?match[1]:String(fallbackNo||'').trim(),
    name:match?(text.slice(0,match.index)+text.slice(match.index+match[0].length)).replace(/\s+/g,' ').trim():text};
}
function parseTjkResultsHTML(htmlText, filename, altiliNo=1){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');

  const titleEl = [...doc.querySelectorAll('h2')].find(el => /Yarış Sonuçları/i.test(el.textContent));
  const titleText = titleEl ? titleEl.textContent : doc.body.textContent;
  const dm = titleText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  // AJAX result fragments omit the title but retain dated official result links.
  const resultLinkDates=new Set();
  if(!dm)for(const link of doc.querySelectorAll('a[href]')){
    try{
      const url=new URL(link.getAttribute('href'),'https://www.tjk.org');
      if(!/(^|\.)tjk\.org$/i.test(url.hostname)||!/GunlukYarisSonuclari/i.test(url.pathname))continue;
      const match=url.pathname.match(/\/TJKPDF\/\d{4}\/(\d{4}-\d{2}-\d{2})\//i);
      if(match)resultLinkDates.add(match[1]);
    }catch(_e){}
  }
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : resultLinkDates.size===1?[...resultLinkDates][0]:null;
  if (!date) throw new Error('TJK Yarış Sonuçları sayfasında tarih bulunamadı.');

  const programEl = _v25TjkCurrentProgramRoot(doc);
  const currentCityEl = doc.querySelector('ul.gunluk-tabs a.current[id]');
  const sehirEl = programEl.querySelector ? programEl.querySelector('[sehir]') : doc.querySelector('[sehir]');
  const hipRaw = currentCityEl?.getAttribute('id') || programEl?.getAttribute?.('id') || sehirEl?.getAttribute('sehir') || '';
  const hip = canonicalHippodrome(String(hipRaw || '').trim());
  if (!hip) throw new Error('TJK Yarış Sonuçları sayfasında hipodrom/şehir bulunamadı.');

  const raceRoot = (programEl && programEl.querySelector) ? programEl : doc;
  const raceDivs = [...raceRoot.querySelectorAll('div[id^="kosubilgisi-"]')];
  if (!raceDivs.length) throw new Error('TJK sayfasında koşu tablosu (kosubilgisi) bulunamadı.');

  // Sonuç sayfasında işaret DOM'u günlere göre değişebiliyor. Birden fazla
  // Altılı varsa hem işaret başlangıçları hem ilk/son altılı adayları üretilir.
  const markerStarts=[];
  for(let i=0;i<raceDivs.length;i++){
    let cur=raceDivs[i].previousElementSibling, guard=0, found=false;
    while(cur && guard++<12){
      if(cur.matches && cur.matches('div[id^="kosubilgisi-"]')) break;
      const txt=fold(cur.textContent||'');
      if((/ALTILI\s*GANYAN/.test(txt)||/6\s*'?\s*L[İIÜU]\s*GANYAN/.test(txt)) && txt.includes('BAŞLAR')){found=true;break;}
      cur=cur.previousElementSibling;
    }
    if(found) markerStarts.push(i);
  }
  const fallbackStarts=raceDivs.length>6 ? [0,Math.max(0,raceDivs.length-6)] : [0];
  const starts=[...new Set(markerStarts.length ? markerStarts : fallbackStarts)].sort((a,b)=>a-b);
  const selectedStart=starts[Math.min(Math.max(1,Number(altiliNo)||1),starts.length)-1] ?? starts[0] ?? 0;
  const startIdx=selectedStart;
  const raceSlice=raceDivs.slice(startIdx,startIdx+6);
  if(raceSlice.length<6) throw new Error(`Altılı Ganyan başlangıcından itibaren 6 koşu yok (sadece ${raceSlice.length} koşu bulundu).`);

  function parseAgfCell(cell){
    if (!cell) return null;
    const wantedAlt = Math.max(1, Number(altiliNo) || 1);
    const anchors = [...cell.querySelectorAll('a[title]')];
    let raw = '';
    if (anchors.length){
      // TJK bazı koşularda aynı hücreye hem 1. hem 2. Altılı AGF'sini yazar:
      // title="1. 6'LI GANYAN : %9,93(5)" / title="2. 6'LI GANYAN : %9,13(5)".
      // Eski regex ilk "1" sayısını AGF sanıyordu; ilk 2-3 koşuda AGF'nin 1 görünme sebebi buydu.
      const altRe = new RegExp('(^|\\D)' + wantedAlt + '\\s*\\.\\s*(?:6|ALTILI)', 'i');
      const picked = anchors.find(a => altRe.test(String(a.getAttribute('title')||'')))
        || anchors[Math.min(anchors.length-1, wantedAlt-1)]
        || anchors[0];
      raw = String((picked.getAttribute('title')||'') + ' ' + (picked.textContent||''));
    } else {
      raw = String(cell.textContent || '');
    }
    let m = raw.match(/%\s*(\d{1,3}(?:[.,]\d+)?)/);
    if(!m){
      // Son çare: hücre metnindeki yüzdeyi ara; yine de "1. 6'LI" gibi sıra numaralarına düşme.
      const txt=String(cell.textContent||'');
      m = txt.match(/%\s*(\d{1,3}(?:[.,]\d+)?)/);
    }
    if (!m) return null;
    const v = Number(m[1].replace(',','.'));
    return Number.isFinite(v) && v>=0 && v<=100 ? Math.round(v) : null;
  }

  // Programı sayfasındaki AYNI "race-config" başlığı (şart/mesafe/pist) burada da var --
  // önceki sürüm bunu hiç okumuyordu, Pist/Tür/Mesafe hep "BİLİNMİYOR" görünüyordu.
  function parseConfig(raceDiv){
    let cursor = raceDiv.previousElementSibling, configEl = null, guard = 0;
    while (cursor && guard < 35){
      if (cursor.classList && cursor.classList.contains('race-config')) configEl = cursor;
      else if (cursor.querySelector) configEl = cursor.querySelector('.race-config');
      if (configEl) break;
      cursor = cursor.previousElementSibling; guard++;
    }
    if (!configEl) return {condition:'', distance:null, surface:'', breed:''};
    const text = configEl.textContent.replace(/\s+/g,' ').trim();
    const condition = (text.split(',')[0] || '').trim();
    const m = text.match(/(\d{3,4})\s*(Çim|Kum|Sentetik)/i);
    const distance = m ? +m[1] : null;
    const surfaceRaw = m ? m[2] : '';
    const surface = /çim/i.test(surfaceRaw) ? 'ÇİM' : (/sentetik/i.test(text) ? 'SENT.' : (/kum/i.test(surfaceRaw) ? 'KUM' : ''));
    const breed = /İngiliz/i.test(text) ? 'İNG' : (/Arap/i.test(text) ? 'ARP' : '');
    return {condition, distance, surface, breed};
  }

  const BAHIS_LABEL_MAP = {
    "GANYAN":"ganyan", "1. 6'LI GANYAN":"altili", "1. 5'Lİ GANYAN":"besli",
    "1. 4'LÜ GANYAN":"dortlu_ganyan", "1. 3'LÜ GANYAN":"uclu_ganyan",
    "İKİLİ":"ikili", "SIRALI İKİLİ":"sirali_ikili", "PLASE":"plase",
    "PLASE İKİLİ":"plase_ikili", "TABELA BAHİS":"tabela", "TABELA BAHİS SIRASIZ":"tabela_sirasiz",
    "SIRALI 5 Lİ BAHİS":"sirali_5li", "ÜÇLÜ BAHİS":"uclu_bahis"
  };
  function parsePayoutCardsFromDiv(raceDiv){
    // GERÇEK YAPIYA GÖRE DÜZELTME: .bahisSonucCard, kosubilgisi-N div'inin İÇİNDE değil,
    // onunla KARDEŞ (aynı [sehir] üst konteynerinin çocuğu) olarak yer alır. Bu yüzden
    // raceDiv yerine en yakın [sehir] atasından arama yapılır.
    const scope = (raceDiv.closest && raceDiv.closest('[sehir]')) || raceDiv;
    const cards=[...scope.querySelectorAll('.bahisSonucCard h4')];
    const entries=[];
    for(const h4 of cards){
      const spans=[...h4.querySelectorAll('span')];
      if(spans.length<3) continue;
      const label=norm(spans[0].textContent).toLocaleUpperCase('tr-TR');
      const combo=norm(spans[1].textContent);
      const amountText=norm(spans[2].textContent);
      const rollover=/devretmiştir/i.test(amountText);
      const amount=rollover ? null : n(amountText.replace(/[₺\s]/g,'').replace(/\./g,'').replace(',','.'));
      let key=BAHIS_LABEL_MAP[label] || tkpBetKeyFromLabel(label);
      if(!key){ const m=label.match(/^(\d+)\.\s*ÇİFTE$/); if(m) key='cifte_'+m[1]; }
      entries.push({key:key||label, label, combo, amount, rollover});
    }
    return entries;
  }

  let races = [];
  raceSlice.forEach((raceDiv, idx) => {
    const leg = idx + 1;
    const {condition, distance, surface, breed} = parseConfig(raceDiv);
    const payouts = parsePayoutCardsFromDiv(raceDiv);
    const availableBets=[...new Set(parseTjkAvailableBetsForRace(raceDiv).concat((payouts||[]).map(p=>p.key).filter(Boolean)))];
    const trs = [...raceDiv.querySelectorAll('table.tablesorter tbody tr')];
    const horses = [];
    for (const tr of trs){
      const noCell = tr.querySelector('[class*="GunlukYarisSonuclari-StartId"]');
      const nameCell = tr.querySelector('[class*="GunlukYarisSonuclari-AtAdi"]');
      const hcCell = tr.querySelector('[class*="GunlukYarisSonuclari-Hc"]');
      const agfCell = tr.querySelector('[class*="GunlukYarisSonuclari-AGFORAN"]');
      const cells=[...tr.querySelectorAll('td')];
      const sonucCell = tr.querySelector('[class*="GunlukYarisSonuclari-SONUCNO"]')
        || cells.find(c=>/SONUCNO|SONUÇNO|DERECE/i.test(String(c.className||'')))
        || cells.find(c=>finishPositionFromResultCell(c)!=null);
      if (!noCell || !nameCell) continue;
      const nameLink = nameCell.querySelector('a');
      // KÖK FIX: "StartId" hücresi TJK Sonuç sayfasında GERÇEK at/program numarası
      // DEĞİLDİR (sonuç sırasına yakın ama güvenilmez bir iç sıra numarası) -- gerçek
      // program numarası, at isminin hemen yanında "(N)" olarak tekrar yazılır ve bu,
      // Program/Jokey Performans sayfalarındaki numarayla BİREBİR eşleşir. Eskiden bu
      // "(N)" gürültü sanılıp silinir, StartId kullanılırdı; bu da sonuç birleşiminde
      // atların yanlış numarayla (dolayısıyla yanlış atla) eşleşmesine yol açıyordu.
      const rawNameFull = norm((nameLink ? nameLink.textContent : nameCell.textContent) || '');
      const resultIdentity=tkpOfficialResultHorseIdentity(rawNameFull,norm(noCell.textContent));
      const no = resultIdentity.no;
      // KULVAR/START NO: "St" sütununun (title="Start No") başlığı bunu doğruluyor --
      // at/program numarasından bağımsız, gerçek kulvar bilgisi. Sadece bilgi amaçlı
      // ayrı bir alanda saklanır; yukarıdaki "no" (at numarası) tespitini etkilemez.
      // Sonuç sayfasındaki StartId geçmişte ST diye yanlış kullanıldı. ST yalnız TJK Program
      // title="Start No" sütununun sahibidir; sonuç parserı bu alanı taşımaz.
      const kulvar = null;
      // At ismi hücresinde isimden hemen sonra kendi program no'su "(N)" olarak
      // tekrar yazılır -- bu Program sayfasındaki finish-position span'ından farklı;
      // burada sadece düz metin olarak isme yapışık gelir, bu yüzden regex ile
      // sondan temizlenir.
      let name = resultIdentity.name;
      if (!name) continue;
      const explicitNonRunner = tkpTjkRowIsExplicitNonRunner(tr,nameCell,nameLink);
      if (explicitNonRunner && !tkpExplicitNonRunnerText(name)) name = (name + ' (KOŞMAZ)').trim();
      const hnd = n(hcCell ? hcCell.textContent : '');
      // TJK Sonuç sayfasında kulvar/start bilgisi doğrudan StartId hücresindedir.
      // Eski kod burada tanımsız `startCell` değişkenine eriştiği için parser
      // ReferenceError ile duruyor, sonuç önizlemesi oluşmuyor ve kayıt BEKLİYOR kalıyordu.
      const agf = standardAgfValue(parseAgfCell(agfCell));
      const finishPos = finishPositionFromResultCell(sonucCell);
      // TJK sonuç sayfasında bazı şablonlarda at/koşu derecesi ayrı bir hücrede gelir.
      // Bu bilgi sonraki yarış için DRC / T.DRC öğrenmesinde kullanılır; bulunamazsa boş kalır.
      const timeCell = tr.querySelector('[class*="GunlukYarisSonuclari-DERECE"],[class*="GunlukYarisSonuclari-Derece"],[class*="BITIRIS"],[class*="BİTİRİŞ"]')
        || cells.find(c => /DERECE|BITIRIS|BİTİRİŞ/i.test(String(c.className||'')) && tkpParseRaceTimeSeconds(c.textContent)!=null)
        || cells.find(c => tkpParseRaceTimeSeconds(c.textContent)!=null && /\d+[.:]\d{2}(?:[.:]\d{2})?/.test(String(c.textContent||'')));
      // Legacy sonuç zamanı sütun eşleşmesi güvenilir değildi. Doğrulanmış ayrı bir
      // şema gelene kadar geçmiş/gelecek sonuçtan zaman taşınmaz; best_time korunur.
      const resultTime = '';
      horses.push({no, name, agf, hnd: hnd==null?30:hnd, finishPos, resultTime, kulvar});
    }

    // Sonuç sayfasındaki aynı footer bilgisi de etiketlenir. Böylece kazanan
    // eküri ortağı, program kaydındaki diğer ortakla doğru eşleşir.
    tkpApplyTjkEkuriGroups(raceDiv, horses, false);
    const ekuriGroupsForRace = [...new Set(horses.map(h=>h.ekuri_group).filter(Boolean))].map(tag=>({
      tag, members: horses.filter(h=>h.ekuri_group===tag).map(h=>String(h.no||'').replace(/-E\d+$/i,''))
    }));

    const horseObjs = horses.map(h => ({
      horse_no: h.no, horse_name: h.name, ekuri_group: h.ekuri_group||null,
      agf: h.agf, g800: null, hndkp: h.hnd, s_value: null, jbyg: null,
      tr: h.agf, value_score: null, value_raw: '',
      sp: null, result_score: null, star_value: null,
      bmb: 0, ypuan: null,
      finish_position: h.finishPos,
      winner: h.finishPos === 1 ? 1 : 0,
      result_time: '',
      official_time: '',
      start_no: null
    }));

    const parsedRace=normalizeRaceObj({
      id: Date.now()+leg, file_id:null, sequence_no:null, filename, race_date:date, hippodrome:hip,
      leg, distance, surface, breed, condition_text: condition, horses: horseObjs, active:1,
      _absRaceNo: startIdx + idx + 1, payouts, available_bets: availableBets, ekuri_groups: ekuriGroupsForRace
    });
    tkpApplyVerifiedOfficialResultOrder(parsedRace);
    races.push(parsedRace);
  });

  const dayName=tkpDayNameFromISO(date);
  const displayFilename=hip ? `${hip==='DEL MAR'?'DELMAR':hip} HTML` : 'HTML';
  return { file:{sequence_no:null, filename: displayFilename, race_date:date, hippodrome:canonicalHippodrome(hip), altili_no:Math.min(Math.max(1,Number(altiliNo)||1),starts.length), altili_count:starts.length}, races };
}

// Bir at isminin başındaki temiz ismi döndürür (ekipman kodlarını -KG,K,DB,SK,SKG,BB,GKR,*- atar).
// yenibeygir bülteninde "TORUN YUSUF DB SKG SK" gibi, galop/jokey sayfalarında ise sade
// "TORUN YUSUF" olarak geçer — dosyalar arası eşleştirme bu temiz isim üzerinden yapılır.
function baseHorseName(full){
  // Kaynaklar aynı atı farklı ekipman/işaret ekleriyle yazabiliyor. J-BYG'nin özellikle
  // 7. sıradaki atında tek bir ek yüzünden eşleşme kopmasın diye son ekipman kodlarını,
  // para/özel işaretlerini ve parantez içi koşmama notunu temizleyip tek standart üret.
  let raw=String(full||'')
    .replace(/\((?:KOŞMAZ|KOSMAZ|ÇEKİLDİ|CEKILDI)\)/ig,' ')
    .replace(/[₺€£$]/g,' ')
    .replace(/[★☆•·]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  let tokens = raw.split(/\s+/);
  let codes = new Set(['KG','K','DB','SK','SKG','BB','GKR','SGKR','ÖG','OG','YP','AP','TGK','M','*']);
  while (tokens.length && codes.has(fold(tokens[tokens.length-1]))) tokens.pop();
  return fold(tokens.join(' ').replace(/[^0-9A-ZÇĞİÖŞÜ ]/g,' ').replace(/\s+/g,' ').trim());
}

// --- Jokey / Antrenör Başarı Oranı sayfası
// J-BYG, klasördeki Jokey-Antrenör başarı oranı tablosundan hesaplanır:
// JKY+ANTR başarı oranı %8,50 ÜSTÜ olan atlar alınır.
// oranı en yüksek at 1, sonra 2, 3... diye sıralanır; son değer 7'dir.
function parseJockeyRateNumber(raw){
  let s = String(raw ?? '').replace(/ /g,' ').trim();
  if (!s || /^[-–—]$/.test(s)) return null;
  s = s.replace(/%/g,'').replace(',', '.').replace(/[^0-9.\-]/g,'');
  if (!s || s === '-' || s === '.') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

function raceNoFromLooseText(txt){
  const s = String(txt || '').replace(/\u00a0/g,' ');
  let m = s.match(/(\d{1,2})\s*[.\-]?\s*Koşu/iu)
       || s.match(/Koşu\s*(?:No|Numarası|#)?\s*[:：\-]?\s*(\d{1,2})/iu)
       || s.match(/(?:^|[_\-])R(\d{1,2})(?:[_\-.]|$)/iu)
       || s.match(/(\d{1,2})\s*[.\-]?\s*Yarış/iu);
  return m ? Number(m[1]) : null;
}
function nearestRaceNoForTable(table, doc){
  const bits = [];
  const cap = table.querySelector('caption');
  if (cap) bits.push(cap.textContent || '');
  let cur = table.previousElementSibling, guard = 0;
  while (cur && guard++ < 8){
    bits.push(cur.textContent || '');
    const rn = raceNoFromLooseText(bits.join(' '));
    if (rn) return rn;
    cur = cur.previousElementSibling;
  }
  let parent = table.parentElement, pguard = 0;
  while (parent && pguard++ < 4){
    const own = [];
    for (const node of parent.childNodes){
      if (node === table) break;
      if (node.nodeType === 3) own.push(node.textContent || '');
      if (node.nodeType === 1 && node.textContent) own.push(node.textContent.slice(0,500));
    }
    const rn = raceNoFromLooseText(own.join(' '));
    if (rn) return rn;
    parent = parent.parentElement;
  }
  const titleText = (doc.querySelector('title')?.textContent || '').trim();
  return raceNoFromLooseText(titleText);
}
function parseJockeyTableRecord(table, fallbackRaceNo){
  const trs = [...table.querySelectorAll('tr')].filter(tr => [...tr.querySelectorAll('th,td')].length);
  if (!trs.length) return null;

  let headerIndex = trs.findIndex(tr => {
    const tx = fold([...tr.querySelectorAll('th,td')].map(c => c.textContent || '').join(' '));
    return /(AT\s*NO|ATNO|FORMA|PROGRAM\s*NO|\bNO\b|AT\s*ADI|AT\s*İSMİ|AT\s*ISMI|JOKEY|JKY|ANTREN|BAŞARI|BASARI|ORAN|%)/.test(tx);
  });
  if (headerIndex < 0) headerIndex = 0;

  const headers = [...trs[headerIndex].querySelectorAll('th,td')].map(c => fold(c.textContent || '').replace(/\s+/g,' ').trim());
  const colCount = Math.max(...trs.map(tr => tr.querySelectorAll('th,td').length), headers.length, 0);
  const isHeaderMeaningful = headers.some(h => /(NO|AT|JOKEY|JKY|ANTREN|BAŞARI|BASARI|ORAN|%)/.test(h));

  let noIdx = headers.findIndex(h =>
    /(^|[^A-ZÇĞİÖŞÜ])(?:AT\s*NO|ATNO|FORMA\s*NO|PROGRAM\s*NO|NO)([^A-ZÇĞİÖŞÜ]|$)/.test(h)
    && !/(ORAN|PUAN|YÜZDE|YUZDE|%|AGF|GANYAN)/.test(h)
  );
  if (noIdx < 0) noIdx = headers.findIndex(h => /^NO$/.test(h));
  if (noIdx < 0) noIdx = 0;

  let nameIdx = headers.findIndex(h =>
    /(AT\s*ADI|AT\s*İSMİ|AT\s*ISMI|AT\s*İSİM|AT\s*ISIM|HORSE|İSİM|ISIM|ADI)/.test(h)
    && !/(JOKEY|ANTREN|SAHİP|SAHIP|ORAN|BAŞARI|BASARI|PUAN|AGF)/.test(h)
  );
  if (nameIdx < 0 && colCount > 1) nameIdx = 1;

  // KURAL: J-BYG, Jokey+Antrenör BİRLİKTE başarı oranıdır -- tek başına Jokey veya Antrenör
  // oranı DEĞİL. Gerçek YeniBeygir "Jokey Performans" tablosunda bu birleşik oran, başlığında
  // "oran/%/başarı" kelimesi GEÇMEYEN bir "Jky.+Ant." (sayı) sütunundan hemen SONRAKİ "%"
  // sütunudur. Önce bu ikiliyi ara; bulursan diğer (tek jokey / tek antrenör / at sahibi)
  // yüzde sütunlarıyla asla karıştırma.
  let pctIdx = -1;
  const combinedCountIdx = headers.findIndex(h =>
    (/(JKY|JOKEY)/.test(h) && /(ANT|ANTREN)/.test(h)) || /JKY\s*[+\/-]\s*ANT/.test(h)
  );
  if (combinedCountIdx >= 0 && combinedCountIdx + 1 < colCount) {
    pctIdx = combinedCountIdx + 1;
  }
  if (pctIdx < 0){
    pctIdx = headers.findIndex(h =>
      ((/(JKY|JOKEY)/.test(h) && /(ANT|ANTREN)/.test(h)) || /JKY\s*[+\/-]\s*ANT/.test(h))
      && /(BAŞARI|BASARI|ORAN|YÜZDE|YUZDE|%|PUAN)/.test(h)
    );
  }
  if (pctIdx < 0){
    // Birden fazla "%" sütunu olabilir (jokey/antrenör/sahip ayrı ayrı); açık bir Jky+Ant
    // eşleşmesi yoksa İLK yerine SON % sütunu tercih edilir -- gerçek şablonlarda birleşik/
    // en kapsamlı oran genelde en sonda yer alıyor, tek başına jokey oranı en başta.
    let lastPct = -1;
    headers.forEach((h,i) => { if (/(?:BAŞARI|BASARI)\s*(?:ORANI|ORAN)|(?:ORAN|YÜZDE|YUZDE|%)|JKY\s*[+\/-]\s*ANT|JOKEY\s*[+\/-]\s*ANT/.test(h)) lastPct = i; });
    pctIdx = lastPct;
  }

  const dataRows = trs.slice(isHeaderMeaningful ? headerIndex + 1 : 0);
  if (pctIdx < 0){
    let best = -1, bestScore = -1;
    for (let c=0; c<colCount; c++){
      if (c === noIdx || c === nameIdx) continue;
      let cnt = 0, pctMarks = 0, plausible = 0;
      for (const tr of dataRows){
        const cells = [...tr.querySelectorAll('th,td')];
        const raw = cells[c]?.textContent || '';
        const v = parseJockeyRateNumber(raw);
        if (v !== null){
          cnt++;
          if (v >= 0 && v <= 100) plausible++;
        }
        if (/%/.test(raw)) pctMarks++;
      }
      const score = pctMarks*3 + plausible*2 + cnt;
      if (score > bestScore){ bestScore = score; best = c; }
    }
    pctIdx = best >= 0 ? best : Math.max(0, colCount-1);
  }

  let entries = [];
  for (const tr of dataRows){
    const cells = [...tr.querySelectorAll('th,td')];
    if (!cells.length || cells.length < 2) continue;

    let noText = (cells[noIdx]?.textContent || '').replace(/\u00a0/g,' ').trim();
    let noM = noText.match(/^\s*(\d{1,2})(?:\D|$)/);
    if (!noM){
      for (let i=0; i<Math.min(cells.length,5); i++){
        if (i === pctIdx || i === nameIdx) continue;
        const tx = (cells[i]?.textContent || '').trim();
        const m = tx.match(/^\s*(\d{1,2})\s*$/);
        if (m){ noM = m; break; }
      }
    }
    const no = noM ? noM[1] : '';

    let rawName = (cells[noIdx]?.getAttribute && cells[noIdx].getAttribute('title')) || '';
    if (!rawName) rawName = (cells[nameIdx]?.textContent || '').trim();
    if (!rawName || /^\d{1,2}$/.test(rawName)){
      for (let i=0; i<Math.min(cells.length,6); i++){
        if (i === pctIdx || i === noIdx) continue;
        const tx = (cells[i]?.textContent || '').trim();
        if (/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(tx) && !/(JOKEY|ANTREN|ORAN|BAŞARI|BASARI|%)/i.test(tx)){
          rawName = tx; break;
        }
      }
    }
    const name = baseHorseName(rawName);
    const pct = parseJockeyRateNumber(cells[pctIdx]?.textContent || '');
    if ((!no && !name) || pct === null) continue;
    entries.push({no, name, pct});
  }

  // KURAL KİLİDİ:
  // J-BYG yalnız JKY+ANTR başarı oranı %8,50 ÜSTÜ olan atlardan oluşur.
  // Yüzde büyükten küçüğe sıralanır; yazılacak değer en fazla 7'dir.
  // Yani 1,2,3,4,5,6,7; 8 ve sonrası yazılmaz.
  entries = entries.filter(e => Number(e.pct) > 8.50);
  if (!entries.length) return null;
  entries.sort((a,b) => (b.pct - a.pct) || (Number(a.no || 999) - Number(b.no || 999)) || TKP_TR_COLLATOR.compare(String(a.name||''),String(b.name||'')));
  const ranks = {}, ranksByName = {};
  entries.slice(0,7).forEach((e,i) => {
    const rank = i + 1;
    if (e.no && ranks[e.no] == null) ranks[e.no] = rank;
    if (e.name && ranksByName[e.name] == null) ranksByName[e.name] = rank;
  });
  return {raceNo:fallbackRaceNo || null, ranks, ranksByName, entries: entries.slice(0,7)};
}
function parseJockeyPerformanceRecords(htmlText){
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const titleText = (doc.querySelector('title')?.textContent) || doc.body.textContent || '';
  const titleRaceNo = raceNoFromLooseText(titleText);
  const tables = [...doc.querySelectorAll('table')];
  const candidates = tables.filter(t => {
    const tx = fold(t.textContent || '');
    const cls = String(t.className || '');
    return /JPerfTable/i.test(cls)
      || ((/JOKEY|JKY/.test(tx) && /ANT|ANTREN/.test(tx)) || /JOKEY\s*PERFORMANS/.test(tx))
      || (/BAŞARI|BASARI|ORAN|%/.test(tx) && /(AT\s*NO|ATNO|\bNO\b|AT\s*ADI|AT\s*İSMİ|AT\s*ISMI)/.test(tx));
  });
  const tryTables = candidates.length ? candidates : tables;

  const records = [];
  const seen = new Set();
  for (const table of tryTables){
    const rn = nearestRaceNoForTable(table, doc) || titleRaceNo;
    const rec = parseJockeyTableRecord(table, rn);
    if (!rec) continue;
    const sig = `${rec.raceNo || ''}|${rec.entries.map(e=>`${e.no}:${e.name}:${e.pct}`).join(';')}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    records.push(rec);
  }
  if (!records.length){
    // Çok gevşek ama güvenli yedek: bazı kaydedilmiş Jokey Performans sayfalarında
    // tablo DOM'u bozulup metin satırları kalabiliyor. Dosya adı/başlık zaten JOKEY
    // PERFORMANS olarak sınıflandıysa, her satırda at no + at adı + % oranı yakalayıp
    // yine aynı %8,50 üstü / ilk 7 kuralıyla J-BYG üret. Bu yedek sadece hiç tablo
    // okunamadığında çalışır; eski doğru tablo parser'ını ezmez.
    const bodyText = (doc.body?.textContent || htmlText || '').replace(/\u00a0/g,' ');
    const lines = bodyText.split(/\r?\n|(?=\b\d{1,2}\s+[A-ZÇĞİÖŞÜ])/u).map(x=>norm(x)).filter(Boolean);
    const entries=[];
    for (const ln of lines){
      const pctMatches=[...ln.matchAll(/%\s*(\d{1,3}(?:[.,]\d+)?)/g)];
      if(!pctMatches.length) continue;
      const pct=Number(pctMatches[pctMatches.length-1][1].replace(',','.'));
      if(!Number.isFinite(pct)) continue;
      const noM=ln.match(/^\s*(\d{1,2})(?:\s+|[-.])/);
      const no=noM?noM[1]:'';
      let name='';
      if(noM){
        name=ln.slice(noM[0].length).replace(/%\s*\d{1,3}(?:[.,]\d+)?[\s\S]*$/,'');
        name=name.replace(/\b(?:JOKEY|JKY|ANTREN[ÖO]R|ANT|BA[ŞS]ARI|ORAN|YÜZDE|YUZDE)\b[\s\S]*$/iu,'');
        name=baseHorseName(name);
      }
      if((no||name) && pct!==null) entries.push({no,name,pct});
    }
    const filtered=entries.filter(e=>Number(e.pct)>8.50)
      .sort((a,b)=>(b.pct-a.pct)||(Number(a.no||999)-Number(b.no||999))||TKP_TR_COLLATOR.compare(String(a.name||''),String(b.name||'')))
      .slice(0,7);
    if(filtered.length){
      const ranks={}, ranksByName={};
      filtered.forEach((e,i)=>{ const rank=i+1; if(e.no&&ranks[e.no]==null) ranks[e.no]=rank; if(e.name&&ranksByName[e.name]==null) ranksByName[e.name]=rank; });
      records.push({raceNo:titleRaceNo||null, ranks, ranksByName, entries:filtered});
    }
  }
  if (!records.length) throw new Error('Jokey/Antrenör başarı oranı tablosu okunamadı.');
  return records;
}
function parseJockeyPerformanceHTML(htmlText){
  const records = parseJockeyPerformanceRecords(htmlText);
  return records[0];
}


// --- Galop sayfaları: 800m derecesine göre en hızlı ilk 6 ata
// sıra (1..6) verir. 800m yoksa eski veriyle uyum için 400m yedeği kullanılır. Bu sayfada koşu numarası güvenilir değil (kendi iç numaralandırması
// farklı) — bu yüzden atlar İSİMLERİNE göre (baseHorseName) eşleştirilir.
function parseGalopTimeValue(raw){
  let x=String(raw||'').trim().replace(/\s+/g,'');
  if(!x || x==='-' || x==='—') return null;
  // 0.24.8 / 0:24.8 / 24,8 / 24.8 biçimlerini saniyeye çevir.
  x=x.replace(',', '.');
  let m=x.match(/^(?:(\d+)[:.])?(\d{1,2})[.:](\d{1,2})$/);
  if(m){
    const min=Number(m[1]||0), sec=Number(m[2]), tenth=Number('0.'+m[3]);
    const v=min*60+sec+tenth;
    return Number.isFinite(v)?v:null;
  }
  let v=Number(x.replace(/[^0-9.]/g,''));
  return Number.isFinite(v) && v>0 ? v : null;
}

function parseGalopHTML(htmlText){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');

  // Atlagel tarihsel galop sayfası: her atın adı tablonun hemen üstündeki başlıkta,
  // dereceler ayrı tabloda bulunur. Sayfa bugün açıldığında yarıştan SONRA yapılmış
  // idmanları da gösterebildiği için URL'deki yarış tarihi kesin kesim tarihidir;
  // yalnız yarış günü veya öncesindeki en yeni ilk 3 geçerli 800 m (yoksa 400 m)
  // kullanılır. Böylece tarihsel GLP'ye gelecek bilgi sızıntısı girmez.
  if (/atlagel|galoplar_popup/i.test(String(htmlText||''))){
    const entries=[];
    const tables=[...doc.querySelectorAll('table')];
    const raw=String(htmlText||'');
    const sourceDate=(raw.match(/galoplar_popup\/goster\/(\d{4}-\d{2}-\d{2})/i)||[])[1]||'';
    const isoFromCell=value=>{
      const s=String(value||'').trim();
      let m=s.match(/^(\d{2})[.\/-](\d{2})[.\/-](\d{4})$/);
      if(m)return `${m[3]}-${m[2]}-${m[1]}`;
      m=s.match(/^(\d{4})[.\/-](\d{2})[.\/-](\d{2})$/);
      return m?`${m[1]}-${m[2]}-${m[3]}`:'';
    };
    const nearestHorse=(table)=>{
      const probes=[];
      let cur=table.previousElementSibling,guard=0;
      while(cur&&guard++<6){probes.push(cur.textContent||'');cur=cur.previousElementSibling;}
      let par=table.parentElement,pguard=0;
      while(par&&pguard++<3){
        let sib=par.previousElementSibling,sg=0;
        while(sib&&sg++<4){probes.push(sib.textContent||'');sib=sib.previousElementSibling;}
        probes.push((par.textContent||'').slice(0,500));par=par.parentElement;
      }
      for(const raw of probes){
        const tx=norm(raw).replace(/ /g,' ');
        let m=tx.match(/(?:^|\s)(\d{1,2})\s+(.+?)\s+(?:Ant\s*[:：]|Antren[öo]r\s*[:：]|Jokey\s*[:：])/iu);
        if(m){const name=baseHorseName(m[2]);if(name)return {no:m[1],name};}
      }
      return {no:'',name:''};
    };
    for(const table of tables){
      const rows=[...table.querySelectorAll('tr')];if(!rows.length)continue;
      const headers=[...rows[0].querySelectorAll('th,td')].map(c=>fold(c.textContent||''));
      const iDate=headers.findIndex(x=>/(^|\s)(TARİH|TARIH|DATE)(\s|$)/.test(x));
      const i800=headers.findIndex(x=>/(^|\D)800(\D|$)/.test(x));
      const i400=headers.findIndex(x=>/(^|\D)400(\D|$)/.test(x));
      if(i800<0&&i400<0)continue;
      const horse=nearestHorse(table);if(!horse.name&&!horse.no)continue;
      const vals=[];
      for(const row of rows.slice(1)){
        const cells=[...row.querySelectorAll('td,th')];if(!cells.length)continue;
        const workoutDate=iDate>=0?isoFromCell(cells[iDate]?.textContent):'';
        if(sourceDate&&workoutDate&&workoutDate>sourceDate)continue;
        const v800=i800>=0?parseGalopTimeValue(cells[i800]?.textContent):null;
        const v400=i400>=0?parseGalopTimeValue(cells[i400]?.textContent):null;
        const v=v800!=null?v800:v400;if(v!=null)vals.push(v);
        if(vals.length>=3)break;
      }
      if(vals.length)entries.push({name:horse.name,no:horse.no,best400:Math.min(...vals),samples:vals.length,last3:vals});
    }
    entries.sort((a,b)=>a.best400-b.best400||Number(a.no||999)-Number(b.no||999)||TKP_TR_COLLATOR.compare(a.name,b.name));
    if(entries.length){
      const ranks={},ranksByNo={};entries.slice(0,6).forEach((e,i)=>{if(e.name)ranks[e.name]=i+1;if(e.no)ranksByNo[e.no]=i+1;});
      const raceNo=nearestRaceNoForTable(tables.find(t=>/(^|\D)(800|400)(\D|$)/.test(fold(t.textContent||'')))||tables[0],doc)||null;
      return {raceNo,ranks,ranksByNo,entries,sourceDate};
    }
  }

  // YeniBeygir koşu galop sayfası: at adı ayrı bir başlık satırında
  // (td.g / .atisimlink), o ata ait dereceler ise hemen sonraki satırlarda yer alır.
  // Tablo en yeni galoptan eskiye doğru sıralıdır; bu nedenle ilk 3 geçerli 800 m
  // derecesi alınır ve bunların en hızlısı kullanılır. 800 m hücresi boşsa 400 m yedeği kullanılır.
  const ybTable = doc.querySelector('table.at_Galoplar');
  if (ybTable){
    const byHorse = {}, byNo = {};
    let currentHorse = '', currentNo = '';
    for (const row of [...ybTable.querySelectorAll('tbody tr')]){
      const horseLink = row.querySelector('td.g .atisimlink, td[colspan] .atisimlink, .atisimlink');
      if (horseLink){
        const rawName = (horseLink.getAttribute('title') || horseLink.textContent || '').trim();
        currentHorse = /\b(KOŞMAZ|KOSMAZ|SCRATCHED|WITHDRAWN)\b/i.test(rawName) ? '' : baseHorseName(rawName);
        currentNo = (row.querySelector('.atno')?.textContent || '').trim().match(/\d+/)?.[0] || '';
        if (currentHorse && !byHorse[currentHorse]) byHorse[currentHorse] = [];
        if (currentNo && !byNo[currentNo]) byNo[currentNo] = [];
        continue;
      }
      if (!currentHorse) continue;
      const vals = byHorse[currentHorse];
      if (vals.length >= 3) continue;
      const cells = [...row.children].filter(c => c.tagName === 'TD');
      // Tarih, Şehir, Kg, Galop Jokey, 400, 600, 800, ...
      if (cells.length < 5 || cells[0].hasAttribute('colspan')) continue;
      const v800 = parseGalopTimeValue(cells[6]?.textContent);
      const v400 = parseGalopTimeValue(cells[4]?.textContent);
      const v = v800 != null ? v800 : v400;
      if (v != null){
        vals.push(v);
        if (currentNo) byNo[currentNo].push(v);
      }
    }

    const entries = Object.entries(byHorse)
      .filter(([,vals]) => vals.length)
      .map(([name,vals]) => {
        const no = Object.keys(byNo).find(k => byNo[k] === vals) || '';
        return {name, no, best400:Math.min(...vals), samples:vals.length, last3:vals.slice(0,3)};
      })
      .sort((a,b)=>a.best400-b.best400 || TKP_TR_COLLATOR.compare(a.name,b.name));
    // İsim dizileri ile numara dizileri ayrı tutulduğu için numarayı başlık sırasından eşleştir.
    const horseHeaders=[...ybTable.querySelectorAll('tbody tr')].map(r=>({
      name:baseHorseName(r.querySelector('.atisimlink')?.getAttribute('title') || r.querySelector('.atisimlink')?.textContent || ''),
      no:(r.querySelector('.atno')?.textContent||'').trim().match(/\d+/)?.[0]||''
    })).filter(x=>x.name);
    entries.forEach(e=>{ e.no=horseHeaders.find(x=>x.name===e.name)?.no||''; });
    if (!entries.length) throw new Error('YeniBeygir galop tablosunda geçerli 800/400 m derecesi bulunamadı.');
    const ranks = {}, ranksByNo = {};
    entries.slice(0,6).forEach((e,i)=>{ ranks[e.name]=i+1; if(e.no) ranksByNo[e.no]=i+1; });
    const titleText=(doc.querySelector('title')?.textContent||doc.querySelector('h2')?.textContent||'');
    const raceNo=Number(titleText.match(/(\d+)\s*\.\s*Koşu/i)?.[1])||null;
    return {raceNo, ranks, ranksByNo, entries};
  }

  // Diğer/eskiden kullanılan galop tabloları için genel okuyucu.
  const tables=[...doc.querySelectorAll('table')];
  let table = doc.querySelector('table.table_main') || tables.find(t=>/(\b800\b|\b400\b)/.test(fold(t.textContent)) && /(AT|İSİM|ADI|GALOP|DERECE)/.test(fold(t.textContent)));
  if (!table) throw new Error('400 metre galop tablosu bulunamadı.');

  const allRows=[...table.querySelectorAll('tr')];
  if(!allRows.length) throw new Error('Galop tablosu boş.');
  let headerRow=allRows.find(r=>/\b800\b/.test(fold(r.textContent))) || allRows.find(r=>/\b400\b/.test(fold(r.textContent))) || allRows[0];
  let headers=[...headerRow.querySelectorAll('th,td')].map(c=>fold(c.textContent));
  let nameIdx=headers.findIndex(x=>/(^|\s)(AT|AT ADI|AT İSMİ|AT ISMI|İSİM|ISIM)(\s|$)/.test(x));
  if(nameIdx<0) nameIdx=1;
  let col800=[], col400=[];
  headers.forEach((x,i)=>{ if(/(^|\D)800(\D|$)/.test(x)) col800.push(i); if(/(^|\D)400(\D|$)/.test(x)) col400.push(i); });
  const galopCols = col800.length ? col800 : col400;

  let byHorse={};
  for(const r of allRows.slice(allRows.indexOf(headerRow)+1)){
    let cells=[...r.querySelectorAll('th,td')];
    if(cells.length<2) continue;
    let rawName=(cells[nameIdx]?.textContent||'').trim();
    if(!rawName || /\b(KOŞMAZ|KOSMAZ|SCRATCHED|WITHDRAWN)\b/i.test(rawName)) continue;
    let name=baseHorseName(rawName);
    if(!name) continue;

    let vals=[];
    if(galopCols.length){
      for(const i of galopCols){ const v=parseGalopTimeValue(cells[i]?.textContent); if(v!=null) vals.push(v); }
    } else {
      for(let i=0;i<cells.length;i++){
        const tx=fold(cells[i].textContent);
        if(/(^|\D)(800|400)(\D|$)/.test(tx)){
          const same=parseGalopTimeValue(cells[i].textContent.replace(/.*?(800|400)\s*/i,''));
          const next=parseGalopTimeValue(cells[i+1]?.textContent);
          if(same!=null) vals.push(same); else if(next!=null) vals.push(next);
        }
      }
    }
    if(!vals.length) continue;
    (byHorse[name]=byHorse[name]||[]).push(...vals);
  }

  let entries=[];
  for(const [name,vals0] of Object.entries(byHorse)){
    const vals=vals0.filter(Number.isFinite).slice(0,3);
    if(!vals.length) continue;
    entries.push({name, best400:Math.min(...vals), samples:vals.length, last3:vals});
  }
  entries.sort((a,b)=>a.best400-b.best400 || TKP_TR_COLLATOR.compare(a.name,b.name));
  let ranks={};
  entries.slice(0,6).forEach((e,i)=>{ ranks[e.name]=i+1; });
  return {ranks, entries};
}

// --- YPUAN sayfası (YORUMCU_VERI pipeline'ından dışa aktarılan): her ayak (leg)
// ve at numarası (ATNO) için 8 yorumcunun konsensüs puanını (TEK=14, 1.=10, 2.=8,
// 3.=6, 4.=4, 5.=2, 6.veya sonrası=1 — Y.PUAN ODS formülüyle birebir aynı) taşır.
// Galop'un aksine at İSMİYLE değil doğrudan koşudaki AT NUMARASIYLA eşleştirilir,
// çünkü kaynak veride isim yok, sadece ATNO var.
function parseYpuanHTML(htmlText){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');
  let table = doc.querySelector('table.table_main') || [...doc.querySelectorAll('table')].find(t=>/YPUAN/i.test(t.textContent));
  if (!table) throw new Error('YPUAN tablosu bulunamadı.');
  let rows = [...table.querySelectorAll('tr')].slice(1);
  let byLeg = {}; // leg -> { atno(string) -> puan }
  rows.forEach(r => {
    let cells = [...r.querySelectorAll('th,td')];
    if (cells.length < 3) return;
    let leg = parseInt((cells[0]?.textContent||'').trim());
    let atno = (cells[1]?.textContent||'').trim();
    let score = parseFloat((cells[2]?.textContent||'').trim());
    if (!leg || !atno || !Number.isFinite(score)) return;
    (byLeg[leg] = byLeg[leg] || {})[atno] = score;
  });
  return { byLeg };
}

// --- YORUMCU KUPONLARI (Bi'Talih / atyarışı.com "Editör Kuponları"): YPUAN'ı elle
// hazırlamak yerine, sitelerin kendi hazır kupon sayfalarından OTOMATİK üretir.
// ÖNEMLİ TASARIM KARARI: her iki kaynak da koşuyu MUTLAK numarayla (ör. "5.Koşu",
// "6'lı Ganyan - 5.Koşu") etiketliyor -- bu yüzden burada HİÇBİR yerde "1..6 arası
// göreli ayak" varsayımı yapılmıyor, doğrudan _absRaceNo ile eşleşiyor. Böylece
// 1. Altılı / 2. Altılı karışması (CANEYMEN vakası) yapısal olarak imkansız hale gelir:
// bir kuponun hangi altılıya ait olduğu önemsiz -- o kuponun içindeki HER ayak zaten
// kendi gerçek koşu numarasını taşıyor ve sadece p.races içinde karşılığı olan
// (_absRaceNo eşleşen) koşulara uygulanıyor, diğerleri otomatik göz ardı ediliyor.

// Bir kupondaki sıralı at listesini YPUAN puanına çevirir (TEK=14, 1.=10, 2.=8,
// 3.=6, 4.=4, 5.=2, 6. veya sonrası=1) -- ana ODS'deki Y.PUAN formülüyle birebir aynı.
function pointsForPick(rank, total){
  if (total === 1) return 14; // tek at yazılmışsa TEK kabul edilir
  const table = [10,8,6,4,2];
  return rank <= 5 ? table[rank-1] : 1;
}

function readyCouponAuthor(card){
  // AtYarisi CardEditor ve Bi'Talih uzman kartları isimleri kararlı img alt
  // alanında taşır. Hash'li CSS sınıflarına bağlanmadan önce bu iki açık kimliği
  // kullan; "Gökhan Şeker Editör Günün Bahisi" gibi birleşik metin üretme.
  const imageSelectors=['[data-test-id="CardEditor"] img[alt]','a[href*="/uzman-yorumcular/"] img[alt]','img[alt*="profil resmi" i]'];
  for(const selector of imageSelectors){
    const raw=String(card?.querySelector?.(selector)?.getAttribute?.('alt')||'').replace(/\s+/g,' ').trim();
    const value=raw.replace(/\s+profil\s+resmi\s*$/i,'').trim();
    if(value&&value.length<=90)return value;
  }
  const selectors=['[data-test-id*="Author" i]','[data-test-id*="Editor" i]','.author','.coupon-author','[class*="author" i]','[class*="editor-name" i]','[class*="expert-name" i]','[class*="tipster" i]'];
  for(const selector of selectors){const raw=String(card?.querySelector?.(selector)?.textContent||'').replace(/\s+/g,' ').trim(),value=raw.replace(/^(?:Yazar|Edit[öo]r|Uzman|Tahminci)\s*[:\-]\s*/i,'').trim();if(value&&value.length<=90&&!/6'l[ıi]\s*Ganyan|\d+\s*\.\s*(?:Ayak|Ko[şs]u)/i.test(value))return value;}return '';
}

// atyarışı.com "Editör Kuponları / Hazır Kuponlar" sayfası. Her kupon kartı
// [data-test-id="PlayBetCouponCard"], içinde tek koşuluk "İkili Bahis" kartları da
// var -- yalnızca "6'lı Ganyan" (altılı) kartları YPUAN için kullanılır, tek koşu
// bahisleri (İkili/Plase vb.) bu istatistiğe karıştırılmaz.
function parseEditorKuponHTML(htmlText){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');
  let cards = [...doc.querySelectorAll('[data-test-id="PlayBetCouponCard"]')];
  let out = [];
  for (const card of cards){
    const infoEl = card.querySelector('[data-test-id="CardRaceInfo"]');
    const infoText = infoEl ? infoEl.textContent.trim() : '';
    if (!/6'l[ıi]\s*Ganyan/i.test(infoText)) continue; // İkili Bahis vb. tek koşu kartlarını atla

    const headerGrid = card.querySelector('[data-test-id="CardRaceGrid"]');
    if (!headerGrid || headerGrid.children.length < 2) continue;
    const headerRow = headerGrid.children[0];
    const picksContainer = headerGrid.children[1];

    const headerCols = [...headerRow.querySelectorAll('[data-test-id="renderHeader"]')];
    const raceNos = headerCols.map(h => {
      const m = h.textContent.replace(/\s+/g,' ').trim().match(/^(\d+)\./);
      return m ? +m[1] : null;
    });

    const picksCols = [...picksContainer.children].filter(c => c.getAttribute('data-test-id') === 'CardRaceGrid');
    const legs = raceNos.map((raceNo, i) => {
      const col = picksCols[i];
      const picks = col ? [...col.querySelectorAll('[data-test-id="renderSelection"]')].map(s => s.textContent.trim()).filter(Boolean) : [];
      return { raceNo, picks };
    });
    const meeting=infoText.split(/\d+\s*\.\s*Ko[şs]u/i)[0].trim();
    out.push({legs,author:readyCouponAuthor(card),meeting,hippodrome:meeting,raceStart:raceNos.find(Number.isFinite)||null,readyCoupon:true});
  }
  return out;
}

// Bi'Talih.com "hazır kupon" sayfası. Her kart, üstünde "6'lı Ganyan - N.Koşu"
// etiketiyle altılının HANGİ koşudan başladığını açıkça belirtir; ayak numarası
// (1.Ayak, 2.Ayak...) bu başlangıç numarasına eklenerek gerçek koşu numarasına çevrilir.
function parseBiTalihKuponHTML(htmlText){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');
  let markers = [...doc.querySelectorAll('p')].filter(p => /6'l[ıi]\s*Ganyan\s*-\s*\d+\s*\.\s*Ko[şs]u/i.test(p.textContent));
  let out = [];
  for (const marker of markers){
    const sm = marker.textContent.match(/(\d+)\s*\.\s*Ko[şs]u/i);
    const startRace = sm ? +sm[1] : null;
    if (startRace == null) continue;

    // Kart kökünü, tek kupon başlığı + uzman bağlantısını taşıyan en yakın atadan
    // bul. Bi'Talih'in yeni sayfasında dış liste de "grid" sınıfı taşıdığı için
    // yalnız grid-cols-6 aramak birden çok yazarı tek dev kartta birleştirebiliyordu.
    let card = null, authorCard = null, cursor = marker;
    for (let i=0; i<8 && cursor; i++){
      cursor = cursor.parentElement;
      if(!cursor)break;
      const markerCount=[...cursor.querySelectorAll('p')].filter(p=>/6'l[ıi]\s*Ganyan\s*-\s*\d+\s*\.\s*Ko[şs]u/i.test(p.textContent)).length;
      if(markerCount===1&&cursor.querySelector('a[href*="/uzman-yorumcular/"]'))authorCard=cursor;
      if(cursor.querySelector('[class*="grid-cols-6"]')){card=authorCard||cursor;break;}
    }
    if (!card) continue;
    const grid = card.querySelector('[class*="grid-cols-6"]');
    if (!grid) continue;

    const legs = [...grid.children].map(col => {
      const header = col.children[0], picksDiv = col.children[1];
      const hm = header ? header.textContent.replace(/\s+/g,' ').trim().match(/^(\d+)\s*\.\s*Ayak/i) : null;
      const ayak = hm ? +hm[1] : null;
      const picks = picksDiv ? [...picksDiv.querySelectorAll('span')].map(s => s.textContent.trim()).filter(Boolean) : [];
      const raceNo = ayak != null ? startRace + ayak - 1 : null;
      return { raceNo, picks };
    });
    const meeting=String([...card.querySelectorAll('h6')].find(el=>!el.closest('a[href*="/uzman-yorumcular/"]'))?.textContent||'').trim();
    const variant=[...card.querySelectorAll('p,span,div')].map(el=>el.textContent.trim()).find(t=>/^(Normal|Ekonomik|Geniş)$/i.test(t))||'';
    out.push({legs,author:readyCouponAuthor(card),meeting,hippodrome:meeting,variant,raceStart:startRace,readyCoupon:true});
  }
  return out;
}

// Hipodrom.com "At Yarışı Hazır Kupon & Ganyan" sayfası. Yapı Vue tabanlı (data-v-*),
// kart ".ready-coupon-card", altılı kartları ".bet-type-info" alanında "6'lı Ganyan -
// N.Koşu" yazar (Bi'Talih ile aynı mantık: başlangıç koşusu + göreli ayak). Bazı
// atlar "txt-green" sınıfıyla favori/tek olarak işaretlenir -- bu her zaman 1. sıraya
// alınır, diğerleri DOM sırasıyla devam eder (site sıralamayı garanti etmiyor,
// yalnızca favoriyi renkle belirtiyor).
function parseHipodromKuponHTML(htmlText){
  let doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const meeting=String(doc.querySelector('.tab-custom-btn.active')?.textContent||'').trim();
  let cards = [...doc.querySelectorAll('.ready-coupon-card')];
  let out = [];
  for (const card of cards){
    const betInfoText = card.querySelector('.bet-type-info')?.textContent?.trim() || '';
    const sm = betInfoText.match(/6'l[ıi]\s*Ganyan\s*-\s*(\d+)\s*\.\s*Ko[şs]u/i);
    if (!sm) continue; // Sıralı İkili/İkili vb. tek koşu kartlarını atla
    const startRace = +sm[1];

    const items = [...card.querySelectorAll('.run-content > .run-list-item')];
    const legs = items.map((item, idx) => {
      const withClass = [...item.querySelectorAll('.run-number')].map(n => ({
        val: n.textContent.trim(), green: n.classList.contains('txt-green')
      }));
      withClass.sort((a,b) => (b.green - a.green));
      return { raceNo: startRace + idx, picks: withClass.map(x => x.val) };
    });
    out.push({legs,author:readyCouponAuthor(card),meeting,hippodrome:meeting,variant:card.querySelector('.info-text')?.textContent?.trim()||'',raceStart:startRace,readyCoupon:true});
  }
  return out;
}

// Misli Hazır Kuponlar sayfası Hipodrom ile aynı Vue kart sözleşmesini kullanır
// (.ready-coupon-card / .bet-type-info / .run-number). Doğrudan JSON uç noktası
// geçici olarak cevap vermezse Collector MISLI_KUPON.html kaydeder. Önceden bu
// dosya JSON parser'ına verilerek bütün Misli yazarları sessizce kayboluyordu.
function parseMisliKuponHTML(htmlText){
  return parseHipodromKuponHTML(htmlText);
}

function readyCouponScalar(value,preferred=[]){if(value==null)return '';if(['string','number','boolean'].includes(typeof value))return String(value).trim();if(Array.isArray(value))return value.map(x=>readyCouponScalar(x,preferred)).filter(Boolean).join(' ').trim();if(typeof value==='object')for(const key of [...preferred,'displayName','fullName','name','title','label','nm','fn','un','n','v','code','id']){if(value[key]!=null){const out=readyCouponScalar(value[key],[]);if(out)return out;}}return '';}
function readyCouponSelections(value){const values=Array.isArray(value)?value:(value==null?[]:String(value).split(/[,;|\s]+/)),out=[];for(const item of values){const raw=item&&typeof item==='object'?readyCouponScalar(item,['runnerNo','horseNo','raceNo','rn','rno','no','n']):String(item??'').trim(),no=raw.match(/^\s*0*(\d{1,3})(?:\D|$)/)?.[1];if(no&&!out.includes(no))out.push(no);}return out;}
function readyCouponJson(text){const raw=String(text||'').replace(/^\uFEFF/,'').trim();try{return JSON.parse(raw);}catch(_){const script=raw.match(/<script[^>]*(?:application\/json|__NEXT_DATA__)[^>]*>([\s\S]*?)<\/script>/i)?.[1];if(script){try{return JSON.parse(script);}catch(__){}}}throw new Error('Hazır kupon JSON verisi okunamadı.');}
function readyCouponRawNodes(root){const out=[],seen=new Set(),walk=(value,depth=0)=>{if(value==null||depth>10)return;if(typeof value==='string'&&depth<3&&/^[\[{]/.test(value.trim())){try{walk(JSON.parse(value),depth+1);}catch(_){}return;}if(typeof value!=='object'||seen.has(value))return;seen.add(value);if(Array.isArray(value)){value.forEach(x=>walk(x,depth+1));return;}if(Array.isArray(value.lgr))out.push(value);else Object.values(value).forEach(x=>walk(x,depth+1));};walk(root);return out;}
function readyCouponVariantRank(value){const variant=String(value||'').trim().toUpperCase();if(/(?:^|[_\s-])NORMAL(?:$|[_\s-])/.test(variant))return 3;if(!variant)return 2;if(/WIDER|GEN[İI][ŞS]|WIDE/.test(variant))return 1;return 2;}
function readyCouponFold(value){return String(value||'').trim().toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();}
function readyCouponScope(card){
  const nums=[...new Set((card?.legs||[]).map(x=>Number(x?.raceNo)).filter(Number.isFinite))].sort((a,b)=>a-b);
  const base=String(card?.raceId||card?.altiliKey||card?.raceStart||nums.join('-')||'unknown');
  // Bazı canlı uçlar aynı ri/raceId değerini 1. ve 2. altılı kartlarında
  // tekrar kullanıyor. Scope'u anahtara katmazsak aynı yazarın iki kartından
  // ikincisi dedupe sırasında kayboluyor ve seçili altılının Y.PUAN'ı eksik
  // görünüyor. Scope yoksa eski HTML kart davranışı aynen korunur.
  const scope=readyCouponFold(card?.readyScope||card?.scope||card?.ppsct||'');
  return scope?`${base}|${scope}`:base;
}
function dedupeReadyCouponCards(cards){const chosen=new Map();for(const [index,card] of (cards||[]).entries()){if(!card||!Array.isArray(card.legs)||!card.legs.length)continue;const source=readyCouponFold(card.source||card.kind||'ready'),author=readyCouponFold(card.author||`${source}:site_feed`),meeting=readyCouponFold(card.meeting||card.hippodrome||'meeting'),key=[source,author,meeting,readyCouponScope(card)].join('|'),candidate={card,index,variantRank:readyCouponVariantRank(card.variant)},previous=chosen.get(key);if(!previous||candidate.variantRank>previous.variantRank)chosen.set(key,candidate);}return [...chosen.values()].sort((a,b)=>a.index-b.index).map(x=>x.card);}
function parseReadyCouponSnapshot(jsonText,expectedSource='misli'){
  const root=readyCouponJson(jsonText),declaredSource=root?.source||root?._tkp?.source||'',source=String(declaredSource||expectedSource||'ready_coupon').trim().toLowerCase();if(expectedSource&&declaredSource&&source!==String(expectedSource).trim().toLowerCase())throw new Error(`Hazır kupon kaynağı uyuşmuyor: ${source}`);
  const canonical=Array.isArray(root?.coupons),rows=canonical?root.coupons:readyCouponRawNodes(root?.raw?.data??root?.data??root),fallbackMeeting=readyCouponScalar(root?.meeting??root?._tkp?.meeting,['hippodrome','hpd']),cards=[];
  for(const row of rows){
    const rawAuthor=canonical?row?.author:row?.au,author=(!canonical&&rawAuthor&&typeof rawAuthor==='object'?`${readyCouponScalar(rawAuthor?.fi)} ${readyCouponScalar(rawAuthor?.la)}`.trim():'')||readyCouponScalar(rawAuthor,['author','displayName','fullName','name','nm','fn','un']),meeting=readyCouponScalar(canonical?(row?.hippodrome??row?.meeting):row?.hpd,['hippodrome','meeting','name','ky','c','nm','n'])||fallbackMeeting,raceId=readyCouponScalar(canonical?row?.raceId:row?.ri,['raceId','id']),startRace=Number(canonical?(row?.raceStart??row?.rn):row?.rn),variant=readyCouponScalar(canonical?row?.variant:row?.ppst,['name','code','n']),readyScope=readyCouponScalar(canonical?row?.scope:row?.ppsct,['name','code','n']),legRows=canonical?(row?.legs||[]):(row?.lgr||[]),legs=[];
    // Misli/Hipodrom canlı JSON'unda lgr[].no göreli ayak değil, mutlak koşu
    // numarasıdır (rn=4 için 4,5,6,7,8,9). Eski yerel snapshotlarda görülen
    // 1..6 biçimini de güvenli biçimde destekle; iki biçimi birbirine ekleme.
    const rawNos=legRows.map(leg=>Number(leg?.no)),absoluteRaw=!canonical&&Number.isFinite(startRace)&&rawNos.length===6&&rawNos.every((no,index)=>no===startRace+index);
    for(const [index,leg] of legRows.entries()){
      const rawNo=Number(leg?.no??leg?.legNo),relativeLeg=absoluteRaw?index+1:Math.max(1,rawNo||index+1),raceNo=Number(leg?.raceNo??(canonical?leg?.rn:undefined)??(absoluteRaw?rawNo:(Number.isFinite(startRace)?startRace+relativeLeg-1:NaN))),picks=readyCouponSelections(canonical?(leg?.selections??leg?.picks):leg?.rns);
      if(Number.isFinite(raceNo)&&picks.length)legs.push({raceNo,relativeLeg,picks});
    }
    if(legs.length===6)cards.push({source,kind:source,author,meeting,hippodrome:meeting,raceId,raceStart:Number.isFinite(startRace)?startRace:legs[0].raceNo,altiliKey:raceId||`${meeting}:${Number.isFinite(startRace)?startRace:legs[0].raceNo}`,variant,readyScope,legs,readyCoupon:true});
  }
  if(!cards.length)throw new Error(`${source} hazır kupon JSON'unda altı ayaklı geçerli kart bulunamadı.`);return dedupeReadyCouponCards(cards);
}

// Başlangıçta bütün site/yazarlar eşittir. Kaynak adına sabit ayrıcalık verilmez;
// yalnız aynı yazarın yarış öncesi kilitli ve resmî sonuçla çözülmüş geçmişi,
// commentatorHistoryWeight() üzerinden sınırlı (%85-%125) kalibrasyon yapabilir.
const YORUMCU_SOURCE_WEIGHTS = {bitalih:1,hipodrom:1,atyarisi:1,misli:1,liderform:1,twitter:1,banko:1};
const READY_COUPON_SOURCES = new Set(['bitalih','hipodrom','atyarisi','misli','liderform']);

// bankotahminler.com "Banko Tahminler" sayfası -- yapay zekâ tahmin sitesi (kendi
// açıklamasında "beta sürümündeyim, sonuçlarım güvenilir olmayabilir" diyor). Her
// ayağı düz cümleyle anlatır: "<strong>N.KOŞU:</strong> A-İSİM ... metin. B-İsim2
// ..." At numarası-isim eşleşmeleri (BÜYÜK HARF at ismiyle ayırt edilir) cümle
// içindeki geçiş sırasına göre ranked pick listesi olarak okunur -- ilk geçen isim
// en güçlü aday kabul edilir.
function parseBankoTahminlerHTML(htmlText){
  const legs = [];
  const paraRe = /<strong>\s*(\d+)\s*\.\s*KO[ŞS]U\s*:?\s*<\/strong>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = paraRe.exec(htmlText))){
    const raceNo = +pm[1];
    let text = pm[2].replace(/<[^>]+>/g,' ')
      .replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const picks = [];
    const pickRe = /(\d{1,3})-([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ0-9'.\s]*?)(?=\s+[a-zçğıöşü]|[.,]|$)/g;
    let m;
    while ((m = pickRe.exec(text))){
      if (!picks.includes(m[1])) picks.push(m[1]);
    }
    if (picks.length) legs.push({raceNo, picks});
  }
  if (!legs.length) throw new Error('Banko Tahminler sayfasında "N.KOŞU: ..." biçiminde bir tahmin bulunamadı.');
  return [{legs}];
}

// X (Twitter) sayfası -- bir yorumcunun ayak bazlı tahmin paylaşımı. Tweet metninin
// TAMAMI, sayfa JS ile render edildiği için normal DOM'da erişilemez olsa da, X'in
// kendi <title> etiketinde saklanır: "X'te [Yazar]: "[tweet metni]" / X". Bu yüzden
// ayrıştırma DOM'dan değil, doğrudan bu başlıktan yapılır.
// ÖNEMLİ VARSAYIM: Buradaki "N. AYAK" ifadesi, günün MUTLAK koşu numarası değil,
// altılı bloğunun İÇİNDEKİ göreli ayak (1-6) kabul edilir -- yenibeygir/TJK'daki
// "N. AYAK" ile aynı anlamda. Bu, yalnızca altılı TAM OLARAK 1. koşudan başlıyorsa
// (_absRaceNo = ayak no) doğru eşleşir; başka bir koşudan başlıyorsa yanlış
// eşleşebilir -- bu durumda kart elle düzeltilmeli.
function parseTwitterPickHTML(htmlText){
  const m = htmlText.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) throw new Error('X (Twitter) sayfasında başlık (tweet metni) bulunamadı.');
  const title = m[1]
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  const bodyM = title.match(/^X'te\s+[^:]+:\s*"([\s\S]*)"\s*\/\s*X\s*$/i);
  const body = bodyM ? bodyM[1] : title;

  const legs = [];
  const re = /(\d+)\s*\.\s*AYAK\s+[^\d(]*?\(\s*(\d+)\s*#?\s*\)/gi;
  let mm;
  while ((mm = re.exec(body))){
    const raceNo = +mm[1];
    const horseNo = mm[2];
    const existing = legs.find(l => l.raceNo === raceNo);
    if (existing) existing.picks.push(horseNo);
    else legs.push({raceNo, picks:[horseNo]});
  }
  if (!legs.length) throw new Error('Tweet metninde "N. AYAK ... (M#)" biçiminde bir tahmin bulunamadı.');
  return [{legs}];
}

// Liderform uzman sayfaları: her uzman bağımsız bir oy taşır. /kupon/{id}
// bağlantısındaki altı kolon göreli ayaklardır; 1./2. altılı etiketi korunur.
function parseLiderformExpertHTML(htmlText){
  const doc=new DOMParser().parseFromString(String(htmlText||''),'text/html');
  const title=String(doc.querySelector('h1,h2,[class*="profile" i] h3')?.textContent||doc.title||'Liderform Uzmanı').replace(/\s+/g,' ').trim();
  const author=(title.match(/(?:Uzman|Yazar)\s*[:\-]?\s*([^|\-]+)/i)?.[1]||title.replace(/\s*[-|].*$/,'')).trim()||'Liderform Uzmanı';
  const out=[];
  for(const anchor of doc.querySelectorAll('a[href*="/kupon/"]')){
    let scope=anchor,scopeText='';
    for(let i=0;i<7&&scope;i++,scope=scope.parentElement){const tx=String(scope.textContent||'').replace(/\s+/g,' ').trim();if(/(?:[12]\s*\.\s*)?6['’]?\s*L[Iİıi]/i.test(tx)){scopeText=tx;break;}}
    const altM=scopeText.match(/\b([12])\s*\.\s*6['’]?\s*L[Iİıi]/i),altiliNo=altM?Number(altM[1]):null;
    let cols=[...anchor.children];
    if(cols.length!==6){const grid=[...anchor.querySelectorAll('[class*="grid-cols-6"]')].find(x=>x.children.length===6);if(grid)cols=[...grid.children];}
    if(cols.length!==6)continue;
    const legs=cols.map((col,index)=>{
      const preferred=[...col.querySelectorAll('span[class*="OSSemiBold"],span[class*="semibold" i],button span')];
      let picks=preferred.map(x=>String(x.textContent||'').trim().match(/^\d{1,3}$/)?.[0]).filter(Boolean);
      if(!picks.length){const nums=[...col.querySelectorAll('span')].map(x=>String(x.textContent||'').trim().match(/^\d{1,3}$/)?.[0]).filter(Boolean);picks=nums[0]===String(index+1)?nums.slice(1):nums;}
      return {raceNo:index+1,relativeLeg:index+1,picks:[...new Set(picks)]};
    });
    if(legs.every(x=>x.picks.length))out.push({legs,relativeLegs:true,altiliNo,author,source:'liderform'});
  }
  if(!out.length)throw new Error('Liderform uzman sayfasında altı ayaklı okunabilir kupon bulunamadı.');
  return out;
}

// Kullanıcı tercihi: eski ODS/VALUE kurallarıyla aynı toplam puan ölçeği.
// Yorumcu tercih puanları toplanır; kaynak sayısına bölünmez. Aynı kartın
// kopyaları ve aynı yazarın geniş kuponu önceden tekilleştirilir.
const TKP_YPUAN_POLICY='R16.83_INDEPENDENT_TOTAL';

function readyCouponAuthorRaceRows(cardsList,{liveOnly=false}={}){
  const rows=new Map(),ready=(cardsList||[]).filter(c=>(c?.readyCoupon===true||READY_COUPON_SOURCES.has(String(c?.source||c?.kind||'').toLowerCase()))&&(!liveOnly||c?._tkp_live_pre_race===true));
  for(const card of dedupeReadyCouponCards(ready)){const source=String(card.source||card.kind||'ready').trim().toLowerCase(),author=String(card.author||`${source}:site_feed`).replace(/\s+/g,' ').trim(),meeting=readyCouponFold(card.meeting||card.hippodrome||'meeting'),scope=readyCouponScope(card);for(const leg of card.legs||[]){const raceNo=Number(leg?.raceNo);if(!Number.isFinite(raceNo))continue;const picks=[...new Set((leg?.picks||[]).map(x=>String(x).match(/^\s*0*(\d{1,3})(?:\D|$)/)?.[1]).filter(Boolean))];if(!picks.length)continue;const key=[source,readyCouponFold(author),meeting,raceNo].join('|');if(!rows.has(key)||(card._tkp_selected_scope===true&&rows.get(key).card._tkp_selected_scope!==true))rows.set(key,{source,author,meeting,scope,raceNo,picks,card});}}return [...rows.values()];
}
function commentatorHistoryWeight(source,author,picks=[]){
  try{
    if(typeof globalThis.tkpCommentatorCalibrationWeight==='function'){
      const value=Number(globalThis.tkpCommentatorCalibrationWeight(source,author,{single:(picks||[]).length===1}));
      if(Number.isFinite(value))return Math.max(.85,Math.min(1.25,value));
    }
  }catch(_){ }
  return 1;
}
// Tüm kaynaklar ve gerçek yazarlar dahil; kaynak sırası toplam puanı değiştirmez.
function ypuanScoredRowsByRace(cardsList){
  const grouped={};
  for(const row of readyCouponAuthorRaceRows(cardsList)){
    (grouped[row.raceNo]=grouped[row.raceNo]||[]).push(row);
  }
  const out={};
  for(const [raceNo,rows] of Object.entries(grouped)){
    const buckets=new Map();
    for(const row of rows){
      const source=String(row.source||'ready').trim().toLowerCase();
      if(!buckets.has(source))buckets.set(source,[]);
      buckets.get(source).push(row);
    }
    const preferred=['bitalih','atyarisi','hipodrom','misli'];
    const order=[...preferred.filter(x=>buckets.has(x)),...([...buckets.keys()].filter(x=>!preferred.includes(x)))];
    const selected=[];
    while(true){
      let moved=false;
      for(const source of order){
        const q=buckets.get(source)||[];
        if(q.length){selected.push(q.shift());moved=true;}
      }
      if(!moved)break;
    }
    out[raceNo]=selected;
  }
  return out;
}
function ypuanBreakdownByRace(cardsList){
  const out={},rowsByRace=ypuanScoredRowsByRace(cardsList);
  for(const [raceNo,rows] of Object.entries(rowsByRace)){
    const byHorse={};
    rows.forEach(row=>{
      (row.picks||[]).forEach((raw,idx)=>{
        const atno=String(raw).match(/^\d+/)?.[0];if(!atno)return;
        (byHorse[atno]=byHorse[atno]||[]).push({source:row.source,author:row.author,rank:idx+1,points:pointsForPick(idx+1,row.picks.length)});
      });
    });
    out[raceNo]={rows,byHorse};
  }
  return out;
}
function aggregateYorumcuCards(cardsList){
  const byRace={},rowsByRace=ypuanScoredRowsByRace(cardsList);
  for(const [raceNo,rows] of Object.entries(rowsByRace)){
    const bucket=byRace[raceNo]={};
    rows.forEach(({picks})=>{
      (picks||[]).forEach((raw,idx)=>{
        const atno=String(raw).match(/^\d+/)?.[0];if(!atno)return;
        bucket[atno]=(bucket[atno]||0)+pointsForPick(idx+1,picks.length);
      });
    });
  }
  return byRace;
}

function aggregateIndependentExpertVotes(cardsList){
  const races={};
  readyCouponAuthorRaceRows(cardsList).forEach(row=>{const race=races[row.raceNo]||(races[row.raceNo]={authors:new Map()}),authorKey=`${row.source}:${row.author}:${row.meeting}:${row.scope}`.toLocaleLowerCase('tr-TR');race.authors.set(authorKey,{author:row.author,source:row.source,picks:row.picks,historyWeight:commentatorHistoryWeight(row.source,row.author,row.picks)});
  });
  const out={};
  for(const [raceNo,race] of Object.entries(races)){
    const rows=[...race.authors.values()],total=rows.length,byHorse={};
    for(const row of rows)row.picks.forEach((no,idx)=>{
      const h=byHorse[no]||(byHorse[no]={positive:0,top2:0,single:0,comments:[]});
      h.positive++;if(idx<2)h.top2++;if(row.picks.length===1)h.single++;
      h.comments.push({author:row.author,source:row.source,score:Math.round(Math.max(40,100-idx*12)*row.historyWeight*10)/10,value:Math.round(row.historyWeight*100),historyWeight:row.historyWeight,direction:1,rank:idx+1,totalPicks:row.picks.length,single:row.picks.length===1});
    });
    Object.values(byHorse).forEach(h=>{h.total=total;h.omitted=Math.max(0,total-h.positive);h.ratio=total?h.positive/total:0;});
    out[raceNo]={total,byHorse};
  }
  return out;
}

function aggregateReadyCouponSingleConsensus(cardsList){const races={};for(const row of readyCouponAuthorRaceRows(cardsList,{liveOnly:true})){if(row.picks.length!==1)continue;const race=races[row.raceNo]||(races[row.raceNo]={sites:new Set(),byHorse:{}});race.sites.add(row.source);const no=row.picks[0],horse=race.byHorse[no]||(race.byHorse[no]={sources:new Set(),authors:new Set()});horse.sources.add(row.source);horse.authors.add(`${row.source}:${row.author}`);}const out={};for(const [raceNo,race] of Object.entries(races)){const byHorse={};for(const [no,horse] of Object.entries(race.byHorse)){const sources=[...horse.sources].sort(),authors=[...horse.authors].sort();byHorse[no]={siteCount:sources.length,sources,authorCount:authors.length,authors,actionable:sources.length>=2};}out[raceNo]={liveSingleSites:[...race.sites].sort(),byHorse};}return out;}
function readyCouponMeetingMatches(card,targetMeeting){const a=readyCouponFold(card?.meeting||card?.hippodrome).replace(/\bhipodromu?\b/g,'').trim(),b=readyCouponFold(targetMeeting).replace(/\bhipodromu?\b/g,'').trim();return !a||!b||a===b||a.includes(b)||b.includes(a);}
function readyCouponMatchesAltili(card,selectedAbs){const wanted=[...selectedAbs].filter(Number.isFinite).sort((a,b)=>a-b),seen=[...new Set((card?.legs||[]).map(x=>Number(x?.raceNo)).filter(Number.isFinite))].sort((a,b)=>a-b);return wanted.length>0&&seen.length===wanted.length&&seen.every((no,index)=>no===wanted[index]);}
// R16.23 / 213 davranışı: yorumcu kartları altılı ürün adına göre değil MUTLAK koşu
// numarasına göre bağlanır. 1. Altılı 1-6 ve 2. Altılı 4-9 ise 4-5-6 aynı gerçek
// koşulardır; bu üç ayağın geçerli yorumcu seçimini sırf kartın diğer üç ayağı farklı
// diye silmek veri kaybıdır. Hipodrom/tarih doğrulaması ayrıca yapılmaya devam eder.
function readyCouponOverlapsSelectedRaces(card,selectedAbs){return (card?.legs||[]).some(leg=>selectedAbs.has(Number(leg?.raceNo)));}
function readyCouponSelectedCoverage(card,selectedAbs){const seen=new Set((card?.legs||[]).map(x=>Number(x?.raceNo)).filter(Number.isFinite));return [...selectedAbs].filter(no=>seen.has(Number(no))).length;}


function _v25LooseHtmlProbe(text, title, file){
  const name = String(file?.name || '');
  const rel = String(file?.webkitRelativePath || '');
  const head = String(title || '') + ' ' + name + ' ' + rel + ' ' + String(text || '').slice(0,120000);
  const plain = head.replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ');
  return {name, rel, head, plain, foldPlain:fold(plain), foldName:fold(name + ' ' + rel)};
}

function _v25ReadyCouponSnapshotSource(file,text){const name=String(file?.webkitRelativePath||file?.name||'').replace(/\\/g,'/'),raw=String(text||'').replace(/^\uFEFF/,'').trim(),jsonish=/\.json$/i.test(name)||/^(?:\{|\[)/.test(raw);if(!jsonish)return '';if(/MISLI(?:_KUPON|_HAZIR_KUPON)?\.json$/i.test(name)||/"source"\s*:\s*"misli"/i.test(raw))return 'misli';if(/HIPODROM(?:_KUPON|_HAZIR_KUPON)?\.json$/i.test(name)||/"source"\s*:\s*"hipodrom"/i.test(raw))return 'hipodrom';if(/"(?:au|ri|hpd|rn|ppsct|ppst|lgr)"\s*:/i.test(raw)&&/"lgr"\s*:\s*\[/i.test(raw))return 'misli';return '';}

// KÖK FIX (V1.0.74) -- ATYARIŞI.COM HİÇ TANINMIYORDU:
// Eski kural `/EDİTÖR KUPON|EDITOR KUPON/.test(probe) && /ATYARIŞI|ATYARISI/.test(probe)`
// idi. probe = <title> + metnin ilk 25.000 karakteri, fold() ile normalize edilmiş hali;
// DOSYA ADI probe'a HİÇ girmiyor. Sayfanın gerçek başlığı "TJK At Yarışı Editör Hazır
// Kuponlar" -> fold sonrası "AT YARIŞI EDİTÖR HAZIR KUPONLAR". Yani:
//   - "EDİTÖR KUPON" bitişik geçmiyor ("EDİTÖR HAZIR KUPONLAR"),
//   - "ATYARIŞI" bitişik geçmiyor ("AT YARIŞI", arada boşluk var).
// İki koşul da başarısız oluyor, dosya hiçbir dala girmiyor ve sessizce "tanınmayan"
// olarak düşüyordu -> Y.PUAN'a atyarışı katkısı (ağırlık 2) hiç eklenmiyordu.
// Artık: dosya adı + alan adı + gevşek metin imzası birlikte sınanır; Bi'Talih ve
// Hipodrom imzaları taşıyan dosyalar açıkça dışlanır (dal sırası korunur).
function _v25LooksLikeAtYarisiEditor(file, probe, text){
  const path = fold(String(file?.webkitRelativePath || file?.name || '').replace(/\\/g,'/'));
  const raw  = String(text || '');
  // Başka bir hazır kupon sitesine ait olduğu kesinse burada tutma.
  if(/B[İI].?TAL[İI]H|BITALIH/.test(path) || /H[İI]PODROM\.COM|HIPODROM\.COM/.test(raw.slice(0,60000).toUpperCase())) return false;
  // 1) Dosya adı imzası -- toplayıcı bu dosyayı ATYARISI_EDITOR.html olarak kaydediyor.
  if(/ATYARISI[_\s-]*ED[İI]T[ÖO]R|AT\s*YARI[ŞS]I[_\s-]*ED[İI]T[ÖO]R/.test(path)) return true;
  // 2) Alan adı imzası -- ham metinde her hâlükârda geçer (canonical/og:url/link).
  if(/atyarisi\.com/i.test(raw.slice(0,60000))) return true;
  // 3) Gevşek metin imzası: "EDİTÖR" ve "KUPON" aynı probe içinde (bitişik olma şartı yok)
  //    + sayfanın gerçekten hazır kupon sayfası olduğunu doğrulayan ayak/ganyan izi.
  const editorish = /ED[İI]T[ÖO]R/.test(probe) && /KUPON/.test(probe);
  const couponish = /6\s*['’]?\s*LI\s*GANYAN|ALTILI|\d+\s*\.\s*AYAK/.test(probe);
  return editorish && couponish;
}
function _v25LooksLikeYeniBeygirRootFileByName(file){
  const path = fold(String(file?.webkitRelativePath || file?.name || '').replace(/\\/g,'/'));
  const name = fold(String(file?.name || ''));
  // Kök HTML dosyası: "ELAZIĞ 2907/At Yarışı Bülteni _ yenibeygir.com.html"
  // Yardımcı Galop/Jokey/Kupon dosyaları ana bülten sayılmaz.
  if(/GALOP|JOKEY|PERFORMANS|KUPON|BITALIH|B[İI]'?TAL[İI]H|HIPODROM|YPUAN|AGF/.test(path)) return false;
  if(/AT\s*YARI[ŞS]I\s*B[ÜU]LTEN[İI]/.test(path) || /AT\s*YARI[ŞS]I\s*B[ÜU]LTEN[İI]/.test(name)) return true;
  if(/YEN[İI]BEYG[İI]R/.test(path) && /B[ÜU]LTEN/.test(path)) return true;
  return false;
}
function _v25YeniBeygirBulletinScore(file, text, title){
  const path = fold(String(file?.webkitRelativePath || file?.name || '').replace(/\\/g,'/'));
  const raw = String(text || '');
  let score = 0;
  if(_v25LooksLikeYeniBeygirRootFileByName(file)) score += 150;
  if(/yarisRow|kosanAtlar|at_Galoplar|Altılı Ganyan/i.test(raw)) score += 80;
  if(/AT\s*YARI[ŞS]I\s*B[ÜU]LTEN[İI]/.test(path + ' ' + fold(title || ''))) score += 60;
  if(/GALOP|JOKEY|PERFORMANS|KUPON|BITALIH|B[İI]'?TAL[İI]H|HIPODROM|YPUAN|AGF/.test(path)) score -= 250;
  if(/(^|\/)[^\/]*(?:_|-)FILES\//.test(path) || /(^|\/)[^\/]*(?:_)(FILES|DOSYALAR)\//.test(path)) score -= 300;
  return score;
}


function _v25LooksLikeYeniBeygirBulletinLoose(text, title, file){
  const p = _v25LooseHtmlProbe(text,title,file);
  const fp = p.foldPlain, fn = p.foldName;
  const hasYbRaceDom = /yarisRow|kosanAtlar|yarisProgrami|atYarisi|bulten/i.test(String(text||''));
  const hasBulletinWords = /AT\s*YARI[ŞS]I\s*(B[ÜU]LTEN[İI]|PROGRAM[İI])|YARI[ŞS]\s*PROGRAM[İI]|YARI[ŞS]\s*B[ÜU]LTEN[İI]/.test(fp)
    || /AT\s*YARI[ŞS]I\s*(B[ÜU]LTEN[İI]|PROGRAM[İI])|YARI[ŞS]\s*PROGRAM[İI]|YARI[ŞS]\s*B[ÜU]LTEN[İI]/.test(fn);
  const hasRaceRowsByText = /(\d+)\s*\.\s*KO[ŞS]U/.test(fp) && /(ALTILI\s*GANYAN|6\s*'?\s*L[İIÜU]\s*GANYAN|AGF|JOKEY|ANTREN[ÖO]R|KİLO|KILO)/.test(fp);
  return !!(_v25LooksLikeYeniBeygirRootFileByName(file) || (hasYbRaceDom && hasBulletinWords) || (hasBulletinWords && hasRaceRowsByText));
}
function _v25LooksLikeTjkProgramLoose(text, title, file){
  const p = _v25LooseHtmlProbe(text,title,file);
  const raw = String(text || '');
  const fp = p.foldPlain, fn = p.foldName;
  return /gunluk-GunlukYarisProgrami-AtAdi|GunlukYarisProgrami|kosubilgisi-/i.test(raw)
    || (/YARI[ŞS]\s*PROGRAM[İI]/.test(fp + ' ' + fn) && /(KO[ŞS]UB[İI]LG[İI]S[İI]|KO[ŞS]U|AGF|START|AT\s*ADI)/.test(fp));
}
function _v25LooksLikeTjkResultsLoose(text, title, file){
  const p = _v25LooseHtmlProbe(text,title,file);
  const raw = String(text || '');
  const fp = p.foldPlain, fn = p.foldName;
  return /gunluk-GunlukYarisSonuclari|GunlukYarisSonuclari/i.test(raw)
    || (/YARI[ŞS]\s*SONU[ÇC]LAR[İI]/.test(fp + ' ' + fn) && /(KO[ŞS]UB[İI]LG[İI]S[İI]|KO[ŞS]U|SONU[ÇC]|DERECE|AGF)/.test(fp));
}
function _v25LooksLikeJockeyPerformanceLoose(text, title, file){
  // J-BYG kaynağı TJK/YeniBeygir sayfası gibi kaydedilebildiği için önce ayrı yakalanmalı.
  // Aksi halde klasör yüklemede bu dosya ana bülten/sonuç sanılıp J-BYG kolonları boş kalır.
  const p = _v25LooseHtmlProbe(text,title,file);
  const raw = String(text || '');
  const fp = p.foldPlain, fn = p.foldName;
  const hay = fp + ' ' + fn;
  const pathHit = /JOKEY|JKY|ANTREN|ANTREN[ÖO]R|PERFORMANS|BASARI|BAŞARI|J-BYG|JBYG|J\s*BEYG/.test(fn);
  const titleHit = /JOKEY\s*PERFORMANS|JOKEY.*ANTREN[ÖO]R|ANTREN[ÖO]R.*JOKEY|JKY\s*[+\/-]\s*ANT|JOK.*ANT|J-BYG|JBYG|J\s*BEYG/.test(hay);
  const rateHit = /(BAŞARI|BASARI)\s*(ORANI|ORAN)|JOKEY\s*(?:[+\/-]|VE)\s*ANTREN[ÖO]R|JKY\s*[+\/-]\s*ANT|%\s*(?:BAŞARI|BASARI)/.test(hay);
  const tableHit = /<table[\s\S]*?(?:JOKEY|JKY)[\s\S]*?(?:ANTREN|ANT)[\s\S]*?(?:BA[ŞS]ARI|BASARI|ORAN|%)/i.test(raw);
  // Program/sonuç sayfalarında da Jokey ve Antrenör kelimeleri geçebilir; yalnız bu kelimeler yetmez.
  // Mutlaka başarı/oran/% sinyali veya dosya yolunda performans/J-BYG izi aranır.
  return !!((pathHit && (rateHit || tableHit || titleHit)) || (titleHit && (rateHit || tableHit)));
}
function _v25FileScoreByName(file){
  const s = fold(String(file?.name || '') + ' ' + String(file?.webkitRelativePath || ''));
  let score = 0;
  if (/YARI[ŞS]\s*PROGRAM[İI]|AT\s*YARI[ŞS]I\s*B[ÜU]LTEN[İI]|B[ÜU]LTEN/.test(s)) score += 80;
  if (/YARI[ŞS]\s*SONU[ÇC]LAR[İI]|SONU[ÇC]/.test(s)) score += 40;
  if (/JOKEY|ANTREN|GALOP|KUPON|YPUAN|AGF/.test(s)) score -= 30;
  return score;
}


// At The Races (İngilizce yarış kartı) dış veri katmanı.
// Ana TJK/ODS bültenini değiştirmez; yalnız tarih/hipodrom/koşu ve at adı doğrulanınca
// OR + son form + ATR uzman yorumu alanlarını mevcut ata ekler.
function tkpAtrText(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
function tkpAtrNormName(v){ return baseHorseName(String(v||'').replace(/\s*\([A-Z]{2,3}\)\s*$/i,'').toUpperCase()); }
function tkpParseAtrDate(text, filename){
  const raw=String(text||'')+' '+String(filename||'');
  const m=raw.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if(!m) return '';
  const mons={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
  return `${m[3]}-${String(mons[m[2].toLowerCase()]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
}
function tkpParseAtTheRacesSingleHTML(text, filename, forcedUrl=''){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html');
  const title=tkpAtrText(doc.title||'');
  const desc=tkpAtrText(doc.querySelector('meta[name="description"]')?.getAttribute('content')||'');
  const urlHint=String(forcedUrl||'');
  const raceNo=Number((desc+' '+title).match(/Race\s+(\d+)/i)?.[1])||null;
  const hip=(title.match(/(?:^|\|)\s*([^|]+?)(?:\s*\(USA\))?\s*\|?\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)?.[1]||
    (title.match(/(?:^|\s)([A-Za-z][A-Za-z .'-]+?)\s*\(USA\)\s+\d{1,2}\s+[A-Z][a-z]+\s+20\d{2}/)?.[1]||'')).trim();
  const date=tkpParseAtrDate(title+' '+desc+' '+urlHint,filename);
  const rows=[]; const seen=new Set();
  const anchors=[...doc.querySelectorAll('a.horse__link, a[href*="horse-form" i], a[href*="/horse/" i], a[href*="historical-data" i]')];
  const addRow=(entry,a)=>{
    const name=tkpAtrText(a?.textContent||'').replace(/\s*historical\s+data\/form\s*$/i,'').replace(/\s*\([A-Z]{2,3}\)\s*$/i,'');
    if(!name||name.length<2||name.length>80)return;
    const key=tkpAtrNormName(name); if(!key||seen.has(key))return;
    const block=entry||a.closest('.card-entry,[data-number],article,li,tr,section,div');
    const blockText=tkpAtrText(block?.textContent||'');
    const no=String(block?.getAttribute?.('data-number')||blockText.match(/^\s*(\d{1,2})(?:\s|\(|$)/)?.[1]||'').trim();
    const form=tkpAtrText(block?.querySelector?.('.card-form__stats,[class*="form" i]')?.textContent||'') || (blockText.match(/\b([0-9\/-]{2,12})\b/)?.[1]||'');
    const orText=tkpAtrText(block?.querySelector?.('.card-stats__or,[class*="rating" i],[class*="official" i]')?.textContent||'');
    let officialRating=Number(orText.match(/\b\d{1,3}\b/)?.[0]);
    if(!Number.isFinite(officialRating)){
      const nums=[...blockText.matchAll(/\b(\d{2,3})\b/g)].map(m=>Number(m[1])).filter(n=>n>=20&&n<=140);
      officialRating=nums.length?nums[nums.length-1]:NaN;
    }
    let comment=tkpAtrText(block?.querySelector?.('[data-id="card-core"] .card-cell-pinsticker p,.card-cell-pinsticker p,[class*="comment" i] p')?.textContent||'');
    if(!comment){
      const cm=blockText.match(/(?:Strong contender|Leading contender|Major player|Big player|Should go well|Could go well|Capable of better|Likely to be competitive|Difficult to assess|May benefit|Best to avoid|Stands chance)[^.]*\.?/i);
      comment=cm?tkpAtrText(cm[0]):'';
    }
    const nonRunner=/non.?runner|withdrawn|scratched/i.test(blockText);
    rows.push({no,name,nameKey:key,form,officialRating:Number.isFinite(officialRating)?officialRating:null,comment,nonRunner}); seen.add(key);
  };
  doc.querySelectorAll('.card-entry[data-number]').forEach(entry=>addRow(entry,entry.querySelector('a.horse__link, a[href*="horse-form" i], a[href*="/horse/" i]')));
  if(!rows.length) anchors.forEach(a=>addRow(a.closest('.card-entry,[data-number],article,li,tr,section,div'),a));
  return {source:'AT_THE_RACES',filename,title,date,hippodrome:hip,raceNo,rows,url:urlHint};
}
function tkpAtrRowFromStructured(raw){
  const name=tkpAtrText(raw?.name||'').replace(/\s*historical\s+data\/form\s*$/i,'').replace(/\s*\([A-Z]{2,3}\)\s*$/i,'');
  const key=tkpAtrNormName(name); if(!key)return null;
  const blockText=tkpAtrText(raw?.blockText||'');
  const no=String(raw?.no||blockText.match(/^\s*(\d{1,2})(?:\s|\(|$)/)?.[1]||'').trim();
  const form=(blockText.match(/\b([0-9DPUF\/-]{1,14})\b/i)?.[1]||'').trim();
  const orLabel=blockText.match(/(?:\bOR\b|Official Rating)\s*[:\-]?\s*(\d{1,3})/i);
  let officialRating=orLabel?Number(orLabel[1]):NaN;
  if(!Number.isFinite(officialRating)){
    const nums=[...blockText.matchAll(/\b(\d{2,3})\b/g)].map(m=>Number(m[1])).filter(n=>n>=20&&n<=140);
    officialRating=nums.length?nums[nums.length-1]:NaN;
  }
  let comment='';
  const cm=blockText.match(/(?:Strong contender|Strong claims|Leading contender|Major player|Big player|Should go well|Could go well|Capable of better|Likely to be competitive|Worthy of consideration|Recent winner worth consideration|Stands chance|Has shown ability|Has potential|Likely to appreciate|Best to avoid|Difficult to fancy|Difficult to recommend|Unlikely to trouble|Needs improvement|Disappointing recent efforts|Hard to assess)[^.]*\.?/i);
  if(cm)comment=tkpAtrText(cm[0]);
  const nonRunner=/non.?runner|withdrawn|scratched/i.test(blockText);
  return {no,name,nameKey:key,form,officialRating:Number.isFinite(officialRating)?officialRating:null,comment,nonRunner};
}
function tkpAtrRaceMetaFromBundlePage(p,filename){
  const title=tkpAtrText(p?.title||''); const txt=tkpAtrText(p?.text||''); const url=String(p?.url||'');
  const raceNo=Number((title+' '+txt.slice(0,1000)).match(/(?:^|\s)(\d{1,2})\s+\d{1,2}:\d{2}\s+[A-Za-z]/)?.[1] || (title+' '+txt.slice(0,1000)).match(/Race\s+(\d+)/i)?.[1])||null;
  const hip=(url.match(/\/racecard\/([^/]+)/i)?.[1]||'').replace(/-/g,' ');
  const date=tkpParseAtrDate(title+' '+txt.slice(0,1200)+' '+url,filename);
  return {title,raceNo,hippodrome:hip,date,url};
}
function tkpParseAtTheRacesRecords(text, filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html');
  const bundle=doc.querySelector('#tkp-atr-bundle')?.textContent||'';
  if(bundle){
    try{
      const pages=JSON.parse(bundle); const out=[];
      for(const p of Array.isArray(pages)?pages:[]){
        let rec=tkpParseAtTheRacesSingleHTML(p?.html||'',filename,p?.url||'');
        if(!(rec.rows||[]).length && Array.isArray(p?.structuredRows)){
          const rows=[]; const seen=new Set();
          for(const raw of p.structuredRows){ const row=tkpAtrRowFromStructured(raw); if(row&&!seen.has(row.nameKey)){seen.add(row.nameKey);rows.push(row);} }
          const meta=tkpAtrRaceMetaFromBundlePage(p,filename);
          rec={source:'AT_THE_RACES',filename,...meta,rows};
        }
        if((rec.rows||[]).length)out.push(rec);
      }
      return out;
    }catch(_e){}
  }
  const one=tkpParseAtTheRacesSingleHTML(text,filename,'');
  return (one.rows||[]).length?[one]:[];
}
function tkpParseAtTheRacesHTML(text, filename){ return tkpParseAtTheRacesRecords(text,filename)[0]||{source:'AT_THE_RACES',filename,title:'',date:'',hippodrome:'',raceNo:null,rows:[]}; }
function tkpAtrFormScore(form){
  const chars=String(form||'').replace(/[^0-9-]/g,'').split('').filter(x=>/\d/.test(x)).slice(-5);
  if(!chars.length) return 0;
  const pts={1:1,2:.78,3:.58,4:.38,5:.22,6:.12,7:.05,8:0,9:0,0:0};
  let w=1,total=0,den=0;
  for(let i=chars.length-1;i>=0;i--){ const n=Number(chars[i]); total+=(pts[n]||0)*w; den+=w; w*=.78; }
  return den?total/den:0;
}
function tkpAtrCommentScore(comment){
  const s=String(comment||'').toLowerCase();
  let v=0;
  const pos=[['strong contender',1],['leading contender',1],['major player',.9],['big player',.9],['leading claims',.85],['should go well',.75],['one to consider',.55],['not ruled out',.4],['could go well',.45],['respected',.45],['interesting',.35],['winner',.15]];
  const neg=[['hard to recommend',-.9],['others preferred',-.7],['more needed',-.55],['needs to improve',-.55],['struggling',-.6],['poor form',-.65],['difficult to fancy',-.8],['up against it',-.65]];
  pos.forEach(([k,x])=>{if(s.includes(k))v+=x;}); neg.forEach(([k,x])=>{if(s.includes(k))v+=x;});
  return Math.max(-1,Math.min(1,v));
}


// Club Hipico Santiago resmi Şili veri katmanı.
// Sayfanın tablo düzeni değişse bile mevcut TJK at isimleriyle güvenli isim eşleşmesi
// yaparak resmi program doğrulamasını taşır. Bu katman tek başına puan eklemez; yanlış
// eşleşme riskini azaltmak için yalnız en az iki at aynı koşu/program içinde doğrulanınca
// işaretlenir.

// V1.1.138 genel yabancı resmi/üst-düzey kaynak katmanı.
// Kaynak HTML'sini ana TJK kartındaki at isimleriyle birebir normalize ederek eşleştirir;
// en az iki at eşleşmeden hiçbir veri uygulanmaz. Böylece yeni ülke kaynakları mevcut
// yerli/kupon ayarlarını bozmadan destek sinyali taşır.
function tkpParseForeignSupportHTML(text,filename,source){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html');
  const plain=tkpAtrText(doc.body?.innerText||doc.body?.textContent||'');
  return {source:String(source||'FOREIGN').toUpperCase(),filename,plain};
}
function tkpApplyForeignSupportData(p,records){
  const logs=[];
  const all=(p.races||[]).flatMap(r=>(r.horses||[]).map(h=>({r,h,key:tkpAtrNormName(h.horse_name),name:String(h.horse_name||'')})));
  for(const rec of records||[]){
    const plain=String(rec.plain||''); if(!plain)continue;
    const folded=tkpAtrNormName(plain); const matches=[];
    for(const x of all){ if(x.key&&folded.includes(x.key)) matches.push(x); }
    if(matches.length<2){logs.push(`⚠️ ${rec.source}: güvenli at eşleşmesi yok; uygulanmadı.`);continue;}
    let applied=0;
    for(const x of matches){
      const h=x.h; const src=String(rec.source||'FOREIGN').toLowerCase();
      const arr=Array.isArray(h.foreign_sources)?h.foreign_sources:[];
      if(!arr.includes(src))arr.push(src); h.foreign_sources=arr;
      h.foreign_official_confirmed=1; h.foreign_source_count=arr.length;
      // At adının çevresindeki dar bağlamdan yalnız açık uzman/tip kelimelerini al.
      const raw=plain.toLowerCase(); const nm=String(x.name||'').toLowerCase(); const pos=raw.indexOf(nm);
      if(pos>=0){
        const ctx=raw.slice(Math.max(0,pos-140),Math.min(raw.length,pos+nm.length+180));
        let cs=0;
        if(/best bet|top pick|selection|selections|favourite|favorite|strong chance|leading chance|value bet|pron[oó]stico|favorito|selecci[oó]n/.test(ctx))cs=.55;
        if(/best bet|top pick|fija|imperdible/.test(ctx))cs=.9;
        h.foreign_context_score=Math.max(Number(h.foreign_context_score)||0,cs);
        const rm=ctx.match(/(?:rating|handicap|indice|índice)\s*[:#-]?\s*(\d{1,3})/i);
        if(rm){const v=Number(rm[1]);if(v>0&&v<200)h.foreign_rating=v;}
      }
      applied++;
    }
    logs.push(`✅ ${rec.source}: ${applied} at dış kaynakta doğrulandı.`);
  }
  return logs;
}

function tkpParseClubHipicoHTML(text,filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html');
  const names=[];
  const seen=new Set();
  const add=(v)=>{
    const raw=tkpAtrText(v).replace(/^\d{1,2}\s*[-.)]?\s*/, '').replace(/\s*\([^)]*\)\s*$/,'').trim();
    if(!raw||raw.length<2||raw.length>70||/^(CABALLO|EJEMPLAR|JINETE|PREPARADOR|PESO|MANDIL|NUMERO|NÚMERO|CARRERA|HORA|DISTANCIA|PISTA|PROGRAMA)$/i.test(raw))return;
    const key=tkpAtrNormName(raw); if(!key||key.length<2||seen.has(key))return;
    seen.add(key);names.push({name:raw,nameKey:key});
  };
  doc.querySelectorAll('tr').forEach(tr=>{
    const cells=[...tr.querySelectorAll('th,td')].map(x=>tkpAtrText(x.textContent)).filter(Boolean);
    // Her hücreyi aday etmek güvenlidir: uygulama aşamasında TJK at isimleriyle birebir
    // normalize eşleşmesi aranır; jokey/antrenör adları bu nedenle ata yazılmaz.
    cells.forEach(add);
  });
  // Bazı Club Hipico sayfalarında yarış kartı div/list yapısında render edilir.
  if(!names.length) doc.querySelectorAll('a,span,strong,b').forEach(el=>add(el.textContent));
  return {source:'CLUB_HIPICO',filename,names};
}
function tkpApplyClubHipicoData(p,records){
  const keys=new Set((records||[]).flatMap(r=>(r.names||[]).map(x=>x.nameKey)));
  if(!keys.size)return [];
  const matched=[];
  for(const r of (p.races||[]))for(const h of (r.horses||[])){
    const key=tkpAtrNormName(h.horse_name); if(keys.has(key))matched.push(h);
  }
  if(matched.length<2)return ['⚠️ Club Hípico: resmi program güvenli eşleşmedi; veri uygulanmadı.'];
  matched.forEach(h=>{h.chi_source_clubhipico=1;h.chi_official_confirmed=1;});
  return [`✅ Club Hípico Santiago: ${matched.length} at resmi Şili programında doğrulandı.`];
}

// Saratoga resmi ABD veri katmanı (NYRA + Equibase).
// Bu katman TJK/ATR alanlarını EZMEZ. Yalnız aynı koşu + aynı at adı güvenli eşleşirse
// ayrı usa_* alanlarına yazar. Aynı bilginin iki kaynaktan gelmesi iki kez puanlanmaz.
function tkpUsaNormName(v){ return tkpAtrNormName(String(v||'').replace(/\s*\([A-Z]{2,3}\)\s*$/i,'')); }
function tkpFractionToProb(v){
  const m=String(v||'').trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/); if(!m)return null;
  const a=Number(m[1]),b=Number(m[2]); return a>=0&&b>0?b/(a+b):null;
}
function tkpParseNyraEntriesHTML(text,filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html');
  const raw=tkpAtrText((doc.body?.innerText||doc.body?.textContent||'').replace(/\r/g,''));
  const plain=(doc.body?.innerText||doc.body?.textContent||'').replace(/\r/g,'');
  const date=(String(text||'')+' '+String(filename||'')).match(/day=(20\d{2}-\d{2}-\d{2})/i)?.[1]||'';
  const starts=[...plain.matchAll(/(?:^|\n)Race\s+(\d{1,2})(?:\s|\n)/gi)]; const records=[];
  for(let i=0;i<starts.length;i++){
    const raceNo=Number(starts[i][1]); if(!raceNo)continue;
    const block=plain.slice(starts[i].index, i+1<starts.length?starts[i+1].index:plain.length);
    const rows=[];
    const re=/(?:^|\n)\s*([^\n]{2,70}?)\s*\n\s*([^\n•]{2,70}?)\s*•\s*([^\n]{2,70}?)\s*\n\s*(\d{2,3})\s*lbs[^\n]*\n\s*(\d{1,2})\s*\n\s*([^\n]{1,15})\s*\n\s*ML\s+([^\n]{1,15})/g;
    let m; while((m=re.exec(block))){
      const name=tkpAtrText(m[1]); if(/^(Exacta|Trifecta|Super|Double|Pick|Race|FOR |INNER |MAIN )/i.test(name))continue;
      const live=tkpAtrText(m[6]), ml=tkpAtrText(m[7]);
      rows.push({name,nameKey:tkpUsaNormName(name),jockey:tkpAtrText(m[2]),trainer:tkpAtrText(m[3]),weightLb:Number(m[4])||null,no:String(m[5]),liveOdds:live,morningLine:ml,liveProb:tkpFractionToProb(live),mlProb:tkpFractionToProb(ml),scratched:/\bSCR\b/i.test(live)});
    }
    const picks=[];
    const pr=/Talking Horses\s*\n\s*([^\n|]+?)(?:\s*\|[^\n]*)?\s*\n\s*((?:\d{1,2}\s*-\s*){1,5}\d{1,2})/g; let pm;
    while((pm=pr.exec(block))){picks.push({expert:tkpAtrText(pm[1]),nos:pm[2].split('-').map(x=>Number(x.trim())).filter(Boolean)});}
    if(rows.length)records.push({source:'NYRA',filename,date,hippodrome:'SARATOGA',raceNo,rows,picks,rawLength:raw.length});
  }
  return records;
}
function tkpParseNyraWorkoutsHTML(text,filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html'); const rows=[];
  doc.querySelectorAll('tr').forEach(tr=>{
    const c=[...tr.querySelectorAll('th,td')].map(x=>tkpAtrText(x.textContent)); if(c.length<3)return;
    const rankCell=c.find(x=>/^\d+\s*\/\s*\d+$/.test(x)); if(!rankCell)return;
    const rm=rankCell.match(/^(\d+)\s*\/\s*(\d+)$/); const name=tkpAtrText(c[0]).replace(/\s*\([A-Z]{2,3}\).*$/i,'');
    if(!name||!rm)return; const rank=Number(rm[1]),total=Number(rm[2]);
    rows.push({name,nameKey:tkpUsaNormName(name),rank,total,score:total>1?Math.max(0,Math.min(1,1-(rank-1)/(total-1))):1});
  });
  return {source:'NYRA_WORKOUTS',filename,rows};
}

function tkpParseDmtcEntriesHTML(text,filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html');
  const plain=(doc.body?.innerText||doc.body?.textContent||'').replace(/\r/g,'');
  const starts=[...plain.matchAll(/(?:^|\n)\s*Race\s+(\d{1,2})(?:\s|\n)/gi)]; const records=[];
  for(let i=0;i<starts.length;i++){
    const raceNo=Number(starts[i][1]); const block=plain.slice(starts[i].index,i+1<starts.length?starts[i+1].index:plain.length); const rows=[];
    const lines=block.split('\n').map(t=>tkpAtrText(t)).filter(Boolean);
    for(let j=0;j<lines.length;j++){
      const no=lines[j].match(/^(\d{1,2})$/)?.[1]; if(!no)continue;
      const name=lines[j+1]||''; if(!name||/^(Race|Post|Program|Morning|Scratches|Changes)$/i.test(name))continue;
      const window=lines.slice(j+2,j+10);
      const ml=window.find(x=>/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(x))||null;
      rows.push({no:String(no),name,nameKey:tkpUsaNormName(name),morningLine:ml,mlProb:tkpFractionToProb(ml),scratched:window.some(x=>/^SCR(?:ATCHED)?$/i.test(x))});
    }
    if(rows.length)records.push({source:'DMTC',filename,hippodrome:'DEL MAR',raceNo,rows});
  }
  return records;
}
function tkpParseDmtcWorkoutsHTML(text,filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html'); const rows=[];
  doc.querySelectorAll('tr').forEach(tr=>{
    const c=[...tr.querySelectorAll('th,td')].map(x=>tkpAtrText(x.textContent)).filter(Boolean); if(c.length<2)return;
    const name=(c[0]||'').replace(/\s*\([A-Z]{2,3}\)\s*$/i,''); const tm=Number(String(c[1]||'').replace(/[^0-9.]/g,''));
    if(!name||!Number.isFinite(tm)||tm<=0)return; rows.push({name,nameKey:tkpUsaNormName(name),time:tm});
  });
  return {source:'DMTC_WORKOUTS',filename,rows};
}
function tkpApplyDmtcData(p,entryRecords,workoutRecords){
  const logs=[];
  for(const rec of entryRecords||[]){
    let candidates=(p.races||[]).filter(r=>Number(r._absRaceNo)===Number(rec.raceNo)); if(!candidates.length)candidates=(p.races||[]).filter(r=>Number(r.leg)===Number(rec.raceNo));
    let best=null,bestHits=0; for(const r of candidates){const keys=new Set((r.horses||[]).map(h=>tkpUsaNormName(h.horse_name)));const hits=(rec.rows||[]).filter(x=>keys.has(x.nameKey)).length;if(hits>bestHits){bestHits=hits;best=r;}}
    if(!best||bestHits<2){logs.push(`⚠️ ${rec.filename}: DMTC koşusu güvenli eşleşmedi.`);continue;}
    const byName=new Map((best.horses||[]).map(h=>[tkpUsaNormName(h.horse_name),h])); let n=0;
    for(const x of rec.rows||[]){const h=byName.get(x.nameKey);if(!h)continue;h.usa_source_dmtc=1;if(x.morningLine){h.usa_morning_line=x.morningLine;h.usa_ml_prob=x.mlProb;}h.usa_scratched=x.scratched?1:(h.usa_scratched||0);if(x.scratched)h.non_runner=1;n++;}
    logs.push(`✅ ${rec.filename}: ${best.leg}. ayağa ${n} at için DMTC resmi veri işlendi.`);
  }
  const all=(p.races||[]).flatMap(r=>(r.horses||[]).map(h=>({h,key:tkpUsaNormName(h.horse_name)}))); const wm=new Map();
  for(const wr of workoutRecords||[])for(const x of wr.rows||[]){const prev=wm.get(x.nameKey);if(!prev||x.time<prev.time)wm.set(x.nameKey,x);}
  let n=0; for(const {h,key} of all){const w=wm.get(key);if(!w)continue;h.usa_dmtc_work_time=w.time;h.usa_source_dmtc=1;n++;} if(n)logs.push(`✅ DMTC workout: ${n} at eşleşti.`);
  return logs;
}
function tkpParseEquibaseHTML(text,filename){
  const doc=new DOMParser().parseFromString(String(text||''),'text/html'); const names=[];
  const add=(v)=>{const name=tkpAtrText(v).replace(/\s*\([A-Z]{2,3}\)\s*$/i,'');const key=tkpUsaNormName(name);if(name&&name.length>1&&key)names.push({name,nameKey:key});};
  doc.querySelectorAll('a[href*="profiles/Results.cfm" i],a[href*="type=Horse" i],a[href*="horse" i][href*="profile" i]').forEach(a=>add(a.textContent));
  const plain=tkpAtrText(doc.body?.innerText||doc.body?.textContent||'');
  const plainNorm=(' '+String(plain||'').normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim()+' ');
  return {source:'EQUIBASE',filename,names:[...new Map(names.map(x=>[x.nameKey,x])).values()],plainNorm};
}
function tkpApplyUsaData(p,nyraRecords,workoutRecords,equibaseRecords){
  const logs=[]; const allHorses=(p.races||[]).flatMap(r=>(r.horses||[]).map(h=>({r,h,key:tkpUsaNormName(h.horse_name)})));
  for(const rec of nyraRecords||[]){
    let candidates=(p.races||[]).filter(r=>Number(r._absRaceNo)===Number(rec.raceNo)); if(!candidates.length)candidates=(p.races||[]).filter(r=>Number(r.leg)===Number(rec.raceNo));
    let best=null,bestHits=0; for(const r of candidates){const keys=new Set((r.horses||[]).map(h=>tkpUsaNormName(h.horse_name)));const hits=(rec.rows||[]).filter(x=>keys.has(x.nameKey)).length;if(hits>bestHits){bestHits=hits;best=r;}}
    if(!best||bestHits<2){logs.push(`⚠️ ${rec.filename}: NYRA koşusu güvenli eşleşmedi.`);continue;}
    const byName=new Map((best.horses||[]).map(h=>[tkpUsaNormName(h.horse_name),h])); let n=0;
    const expertScoreByNo=new Map(); (rec.picks||[]).forEach(pk=>pk.nos.forEach((no,i)=>expertScoreByNo.set(String(no),(expertScoreByNo.get(String(no))||0)+(4-i)/4)));
    const expertCount=Math.max(1,(rec.picks||[]).length);
    for(const x of rec.rows||[]){const h=byName.get(x.nameKey);if(!h)continue;h.usa_source_nyra=1;h.usa_live_odds=x.liveOdds;h.usa_morning_line=x.morningLine;h.usa_live_prob=x.liveProb;h.usa_ml_prob=x.mlProb;h.usa_jockey=x.jockey;h.usa_trainer=x.trainer;h.usa_weight_lb=x.weightLb;h.usa_expert_score=Math.min(1,(expertScoreByNo.get(String(x.no))||0)/expertCount);h.usa_scratched=x.scratched?1:0;if(x.scratched)h.non_runner=1;n++;}
    logs.push(`✅ ${rec.filename}: ${best.leg}. ayağa ${n} at için NYRA resmi veri işlendi.`);
  }
  const workBest=new Map(); for(const wr of workoutRecords||[])for(const x of wr.rows||[]){const prev=workBest.get(x.nameKey);if(!prev||x.score>prev.score)workBest.set(x.nameKey,x);}
  let wn=0; for(const {h,key} of allHorses){const w=workBest.get(key);if(!w)continue;h.usa_work_rank=w.rank;h.usa_work_total=w.total;h.usa_work_score=w.score;wn++;} if(wn)logs.push(`✅ NYRA workout: ${wn} at eşleşti.`);
  const eqKeys=new Set((equibaseRecords||[]).flatMap(r=>(r.names||[]).map(x=>x.nameKey))); const eqPlain=(equibaseRecords||[]).map(r=>r.plainNorm||'').join(' '); let en=0; for(const {h,key} of allHorses){const rawName=String(h.horse_name||'').normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\s+/g,' ').trim(); const plainHit=rawName.length>=4&&eqPlain.includes(' '+rawName+' '); if(eqKeys.has(key)||plainHit){h.usa_equibase_confirmed=1;en++;}} if(en)logs.push(`✅ Equibase: ${en} at resmi kartta doğrulandı.`);
  return logs;
}
function tkpBuildFromAtrRecords(atrRecords){
  const records=(atrRecords||[]).filter(r=>Number(r.raceNo)>0 && (r.rows||[]).length).sort((a,b)=>Number(a.raceNo)-Number(b.raceNo));
  if(records.length<6) return null;
  const picked=records.slice(0,6);
  const meetingDate=picked.map(r=>r.date).filter(Boolean).sort()[0]||'';
  const hip=canonicalHippodrome(picked[0]?.hippodrome||'DEL MAR')||'DEL MAR';
  const races=picked.map((rec,idx)=>normalizeRaceObj({
    id:Date.now()+idx+1,file_id:null,sequence_no:null,filename:'ATR DELMAR HTML',race_date:meetingDate,hippodrome:hip,
    leg:idx+1,_absRaceNo:Number(rec.raceNo)||idx+1,distance:null,surface:'',breed:'İNG',condition_text:'ATR İNGİLİZCE YARIŞ KARTI',active:1,
    horses:(rec.rows||[]).map(x=>({
      horse_no:String(x.no),horse_name:String(x.name||'').toUpperCase(),agf:null,g800:null,hndkp:Number.isFinite(Number(x.officialRating))?Number(x.officialRating):30,
      s_value:null,jbyg:null,tr:null,value_score:null,value_raw:'',sp:null,result_score:null,star_value:null,bmb:0,ypuan:null,finish_position:null,winner:0,
      weight_kg:null,best_time:null,son6_raw:x.form||'',atr_source:'At The Races',atr_or:x.officialRating,atr_form:x.form||'',atr_form_score:tkpAtrFormScore(x.form),
      atr_comment:x.comment||'',atr_comment_score:tkpAtrCommentScore(x.comment),atr_non_runner:x.nonRunner?1:0,atr_race_no:Number(rec.raceNo)||idx+1,atr_date:rec.date||meetingDate,non_runner:x.nonRunner?1:0
    }))
  }));
  return {file:{sequence_no:null,filename:'ATR DELMAR HTML',race_date:meetingDate,hippodrome:hip,altili_no:1,altili_count:1},races};
}

function tkpApplyAtrRecords(p, atrRecords){
  const logs=[];
  for(const rec of atrRecords||[]){
    let candidates=(p.races||[]).filter(r=>!rec.raceNo || Number(r._absRaceNo)===Number(rec.raceNo));
    if(!candidates.length) candidates=(p.races||[]).filter(r=>Number(r.leg)===Number(rec.raceNo));
    // ATR raceNo ile TJK'nin mutlak koşu no'su bazı simulcast/2. Altılı kartlarında
    // farklı numaralanabiliyor. Önce numarayı deneriz; isim/no eşleşmesi zayıfsa tüm
    // altı ayakta en güçlü gerçek at örtüşmesini ararız.
    const scoreRace=(r)=>{
      const names=new Set((r.horses||[]).map(h=>tkpAtrNormName(h.horse_name)));
      const nos=new Set((r.horses||[]).map(h=>String(h.horse_no||'').match(/^\d+/)?.[0]).filter(Boolean));
      let nameHits=0,noHits=0;
      for(const x of (rec.rows||[])){
        if(names.has(x.nameKey)) nameHits++;
        else if(x.no && nos.has(String(x.no))) noHits++;
      }
      return {hits:nameHits+Math.min(noHits,2)*0.35,nameHits,noHits};
    };
    let best=null,bestHits=0,bestDetail=null;
    for(const r of candidates){ const d=scoreRace(r); if(d.hits>bestHits){bestHits=d.hits;best=r;bestDetail=d;} }
    if(!best || (bestDetail?.nameHits||0)<2){
      for(const r of (p.races||[])){ const d=scoreRace(r); if(d.hits>bestHits){bestHits=d.hits;best=r;bestDetail=d;} }
    }
    if(!best || bestHits<Math.min(2,Math.max(1,Math.ceil((rec.rows||[]).length*.25)))){ logs.push(`⚠️ ${rec.filename}: ATR koşusu güvenli eşleşmedi.`); continue; }
    const byName=new Map((best.horses||[]).map(h=>[tkpAtrNormName(h.horse_name),h]));
    const byNo=new Map(); for(const h of (best.horses||[])){const no=String(h.horse_no||'').match(/^\d+/)?.[0];if(no&&!byNo.has(no))byNo.set(no,h);else if(no)byNo.set(no,null);}
    let applied=0;
    for(const x of rec.rows||[]){
      const h=byName.get(x.nameKey) || (x.no?byNo.get(String(x.no)):null); if(!h) continue;
      h.atr_source='At The Races'; h.atr_or=x.officialRating; h.atr_form=x.form; h.atr_form_score=tkpAtrFormScore(x.form); h.atr_comment=x.comment; h.atr_comment_score=tkpAtrCommentScore(x.comment); h.atr_non_runner=x.nonRunner?1:0; h.atr_race_no=rec.raceNo; h.atr_date=rec.date; applied++;
      if(x.nonRunner) h.non_runner=1;
    }
    logs.push(`✅ ${rec.filename}: ${best.leg}. ayağa ${applied} at için yüksek ağırlıklı ATR verisi işlendi.`);
  }
  return logs;
}

// birlikte seçilir. Her dosya kendi <title> içeriğine bakılarak otomatik sınıflandırılır,
// sonra bülten üstüne birleştirilir (J-BYG ve 800G alanları doldurulur).

function tkpParseGanyanCanavariTR(htmlText, fallbackMeta={}){
  const raw=String(htmlText||'').replace(/^\uFEFF/,'');
  if(/^\s*\{/.test(raw)){
    let json;try{json=JSON.parse(raw);}catch{throw new Error('Ganyan Canavarı TR JSON çözümlenemedi.');}
    if(json?._tkp?.kind!=='ganyan_canavari_tr'||!Array.isArray(json?.Kosular))throw new Error('Ganyan Canavarı TR JSON şeması doğrulanamadı.');
    const date=String(json?._tkp?.meeting?.date||fallbackMeta.date||''),hip=String(json?._tkp?.meeting?.hippodrome||fallbackMeta.hip||'');
    const localeNumber=value=>{if(value===null||value===undefined||String(value).trim()==='')return null;const parsed=Number(String(value).trim().replace(',','.'));return Number.isFinite(parsed)?parsed:null;};
    return json.Kosular.map(kosu=>({raceNo:Number(kosu?.Kosu_No)||null,date,hip,metric:'GANYAN_CANAVARI_PROGRAM_P_COLUMN',rows:(kosu?.Atlar||[]).map(at=>({
      no:String(at?.At_No??'').match(/\d+/)?.[0]||'',name:String(at?.At_Unvan_Orjinsiz||at?.At_Unvan||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),
      // show_bulten.php içindeki At_Puan, yarış programında jokey formasının
      // hemen sağındaki "p" sütununun API alanıdır. Başka puan/AGF okunmaz.
      tr:localeNumber(at?.At_Puan),start_no:null,jockey_name:String(at?.Jokey_Unvan||'').trim(),trainer_name:String(at?.At_Antrenor||'').trim()
    })).filter(x=>(x.no||x.name)&&Number.isFinite(x.tr))})).filter(x=>x.rows.length);
  }
  const doc=new DOMParser().parseFromString(raw,'text/html');
  const out=[];
  const savedUrl=raw.match(/saved from url=\([^)]*\)([^\s<]+)/i)?.[1]||'';
  const metaText=[
    doc.querySelector('meta[name=description]')?.getAttribute('content')||'',
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')||'',
    doc.querySelector('title')?.textContent||'',
    savedUrl,
    raw.match(/\bvar\s+tarih\s*=\s*['"]([^'"]+)['"]/i)?.[1]||'',
    raw.match(/"Sehir_Unvan"\s*:\s*"([^"]+)"/i)?.[1]||''
  ].join(' ');
  const date=(typeof tkpIsoDateFromLooseText==='function' ? tkpIsoDateFromLooseText(metaText) : null) || fallbackMeta.date || null;
  const hip=(typeof tkpHipFromLooseText==='function' ? tkpHipFromLooseText(metaText) : null) || fallbackMeta.hip || null;
  const clean=v=>String(v||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  const normHead=v=>clean(v).toLocaleUpperCase('tr-TR');
  const numberFrom=v=>{
    const m=clean(v).replace(',','.').match(/-?\d+(?:\.\d+)?/);
    const n=m?Number(m[0]):NaN;
    return Number.isFinite(n)?n:null;
  };
  // Bu eski HTML uyumluluk yolu da yalnız TR/At_Puan okur. Program tablosunda
  // görünen herhangi bir idman/galop hücresi bilinçli olarak yok sayılır; GLP'nin
  // tek yazma yetkisi ayrı Galoplar Özet kaynağındadır.
  doc.querySelectorAll('table#table-yaris-programi, table[id*="table-yaris-programi"]').forEach(table=>{
    const dataRows=[...table.querySelectorAll('tr[p_kosuno][p_atno], tr[p_kosuno]')].filter(tr=>tr.getAttribute('p_atno') || tr.querySelectorAll(':scope > td').length>=3);
    const raceNo=Number(dataRows[0]?.getAttribute('p_kosuno'))||null;
    if(!raceNo)return;
    // Ganyan Canavarı'nın güncel sayfası bazı günler başlığı <th>, bazı günler
    // de tamamen <td> ile gönderiyor. Eski yalnız-TH seçicisi bu ikinci biçimde
    // P sütununu bulamayınca varsayılan hücre numarasına düşüyor ve puanlar
    // sessizce boş kalıyordu. Burada sadece P + No + At imzası olan gerçek başlığı
    // kabul ederiz; başka bir tablo/sütun "puan" diye yorumlanmaz.
    const headerRow=[...table.querySelectorAll('tr')].find(tr=>{
      const cells=[...tr.querySelectorAll(':scope > th, :scope > td')].map(x=>normHead(x.textContent));
      return cells.some(x=>x==='P') && cells.some(x=>/^(?:NO|AT\s*NO)$/.test(x)) && cells.some(x=>/^AT(?:\s*(?:İSMİ|ISMI|ADI|UNVANI))?$/.test(x));
    });
    const headers=headerRow?[...headerRow.querySelectorAll(':scope > th, :scope > td')].map(x=>normHead(x.textContent)):[];
    const firstCellCount=dataRows[0]?.querySelectorAll(':scope > td').length||0;
    const cellOffset=Math.max(0,firstCellCount-headers.length);
    const findCol=(tests,fallback)=>{const idx=headers.findIndex(h=>tests.some(rx=>rx.test(h)));return idx>=0?idx+cellOffset:fallback;};
    const pIdx=findCol([/^P$/],1);
    const noIdx=findCol([/^NO$/,/^AT\s*NO$/,/^AT\s*NUMARASI$/],2);
    const nameIdx=findCol([/^AT\s*(?:İSMİ|ISMI|ADI|UNVANI)$/,/^AT$/],3);
    const jockeyIdx=findCol([/^JOKEY(?:\s*(?:İSMİ|ISMI|ADI))?$/,/^JKY$/],-1);
    const trainerIdx=findCol([/^ANTREN[ÖO]R$/,/^ANT$/,/^SAHİP\s*\/\s*ANTREN[ÖO]R$/,/^SAHIP\s*\/\s*ANTREN[ÖO]R$/],-1);
    const rows=[];
    dataRows.forEach(tr=>{
      const tds=[...tr.querySelectorAll(':scope > td')];
      if(tds.length<3)return;
      const visibleNo=clean(tds[noIdx]?.textContent).match(/\d+/)?.[0]||'';
      const attrNo=clean(tr.getAttribute('p_atno')).match(/\d+/)?.[0]||'';
      const no=visibleNo||attrNo;
      const attrP=tr.getAttribute('p_puan')||'';
      const attrPoint=numberFrom(attrP),cellPoint=numberFrom(tds[pIdx]?.textContent);
      const trPoint=attrPoint!=null?attrPoint:cellPoint;
      const name=clean(tr.getAttribute('unvan')||tds[nameIdx]?.textContent||'');
      const jockey=jockeyIdx>=0?clean(tds[jockeyIdx]?.textContent):'';
      const trainerCell=trainerIdx>=0?tds[trainerIdx]:null;
      const trainerRaw=clean(trainerCell?.textContent||'');
      const trainer=trainerRaw.includes(')')?trainerRaw.replace(/^.*?\)\s*/,'').trim():clean(trainerCell?.querySelector('br')?.nextSibling?.textContent||'');
      if(no&&(Number.isFinite(trPoint)||name||jockey||trainer))rows.push({
        no,name,tr:Number.isFinite(trPoint)?trPoint:null,start_no:null,
        jockey_name:jockey,trainer_name:trainer
      });
    });
    if(rows.length)out.push({raceNo,rows,date,hip,metric:'GANYAN_CANAVARI_PROGRAM_P_COLUMN'});
  });
  return out;
}
function tkpApplyGanyanCanavariTR(payload, records){
  const log=[];
  for(const rec of records||[]){
    const targetDate=String(payload?.file?.race_date||payload?.races?.[0]?.race_date||''),targetHip=canonicalHippodrome(payload?.file?.hippodrome||payload?.races?.[0]?.hippodrome||'');
    const iso=value=>{try{return typeof tkpIsoDateFromLooseText==='function'?(tkpIsoDateFromLooseText(value)||String(value||'')):String(value||'');}catch{return String(value||'');}};
    const race=tkpSupportRace(payload,rec.raceNo,rec.rows);
    // GC JSON aynı collector isteğinin içinden gelir; yine de yanlış toplantının
    // puanını yazmamak için at kimliğiyle ikinci bir kanıt isteriz. Bu önemlidir:
    // bazı GC yanıtlarında tarih/şehir biçimi farklı yazılıyor (30.08.2026 / ISO,
    // İSTANBUL / ISTANBUL) ve eski katı meta kapısı, ekrandaki gerçek P değerini
    // 0/6 diye tamamen reddediyordu.
    const evidence=tkpGcTrRaceEvidence(race,rec.rows);
    const metaMismatch=!tkpSupportMetaMatches(payload,rec);
    if(metaMismatch){log.push(`⚠️ Ganyan Canavarı ${rec.raceNo||'?'}: tarih/hipodrom farklı; uygulanmadı.`);continue;}
    if(!race)continue;
    let matched=0,trApplied=0,jockeyApplied=0,trainerApplied=0;
    const trAsof=iso(rec.date||payload?.file?.race_date||targetDate||'');
    for(const x of rec.rows||[]){
      const xName=baseHorseName(x.name||'');
      const h=tkpSupportHorse(race,x);
      if(!h)continue;
      matched++;
      // Ana TR=AGF standardına dokunma; Ganyan Canavarı puanı ayrı alanda tutulur.
      if(Number.isFinite(Number(x.tr))&&Number(x.tr)>0){h.tr_ganyan=Number(x.tr);h.tr_puan=Number(x.tr);h.tr_ganyan_source='GANYAN_CANAVARI_TR';h.tr_ganyan_metric='GANYAN_CANAVARI_PROGRAM_P_COLUMN';h.tr_ganyan_asof_date=trAsof;trApplied++;}
      else if(h.tr_ganyan_source==='GANYAN_CANAVARI_TR'&&(!Number.isFinite(Number(h.tr_ganyan))||Number(h.tr_ganyan)<=0)){h.tr_ganyan=null;h.tr_puan=null;h.tr_ganyan_source=null;h.tr_ganyan_metric=null;h.tr_ganyan_asof_date=null;}
      const jockeyCurrent=h.jockey_name??h.jokey_name;
      if((jockeyCurrent==null||String(jockeyCurrent).trim()===''||String(jockeyCurrent).trim()==='-')&&String(x.jockey_name||'').trim()){
        h.jockey_name=String(x.jockey_name).trim();h.jockey_source='GANYAN_CANAVARI';jockeyApplied++;
      }
      const trainerCurrent=h.trainer_name??h.antrenor_name;
      if((trainerCurrent==null||String(trainerCurrent).trim()===''||String(trainerCurrent).trim()==='-')&&String(x.trainer_name||'').trim()){
        h.trainer_name=String(x.trainer_name).trim();h.trainer_source='GANYAN_CANAVARI';trainerApplied++;
      }
    }
    if(matched&&trApplied){race.support_layers={...(race.support_layers||{}),tr:{complete:true,source:'GANYAN_CANAVARI_TR',metric:'GANYAN_CANAVARI_PROGRAM_P_COLUMN',asof:trAsof}};log.push(`✅ Ganyan Canavarı ${rec.raceNo}. koşu: ${matched} at eşleşti · program p/TR ${trApplied}${jockeyApplied?` · JKY adı ${jockeyApplied}`:''}${trainerApplied?` · ANT adı ${trainerApplied}`:''}${metaMismatch?' · kaynak meta farkı at kimliğiyle doğrulandı':''}. ST/Kulvar ve GLP değiştirilmedi.`);}
    else if(matched)log.push(`⚠️ Ganyan Canavarı ${rec.raceNo}. koşu: atlar eşleşti fakat program p sütununda sayısal değer yok; TR katmanı tamam sayılmadı.`);
  }
  return log;
}

function tkpParseGanyanCanavariGlpOzet(jsonText, fallbackMeta={}){
  const raw=String(jsonText||'');
  if(!/^\s*\{/.test(raw)){
    const parsed=parseGalopHTML(raw),raceNo=Number(parsed?.raceNo)||raceNoFromLooseText(fallbackMeta?.name||'');
    return raceNo?[{raceNo,date:fallbackMeta.date||'',hip:fallbackMeta.hip||'',entries:Object.entries(parsed?.ranksByNo||{}).map(([no,rank])=>({no,name:'',rank,time800:null,raw:''}))}]:[];
  }
  let json;try{json=JSON.parse(raw);}catch{throw new Error('Ganyan Canavarı Galoplar Özet JSON çözümlenemedi.');}
  if(json?._tkp?.kind!=='ganyan_canavari_glp'||!Array.isArray(json?.Kosular))throw new Error('Ganyan Canavarı Galoplar Özet JSON şeması doğrulanamadı.');
  const date=String(json?._tkp?.meeting?.date||fallbackMeta.date||''),hip=String(json?._tkp?.meeting?.hippodrome||fallbackMeta.hip||'');
  return json.Kosular.map((kosu,index)=>{
    const raceNo=Number(kosu?.Kosu_No)||Number(json?._tkp?.raceFrom)+index||null;
    const rows=(kosu?.Galoplar||[]).map(g=>({
      no:String(g?.Sk_At_No??'').match(/\d+/)?.[0]||'',name:String(g?.Sk_AtUnvan||'').trim(),
      time800:parseGalopTimeValue(g?.Sk_Derece_800),raw:String(g?.Sk_Derece_800||'').trim()
    })).filter(x=>x.no&&Number.isFinite(x.time800)).sort((a,b)=>a.time800-b.time800||Number(a.no)-Number(b.no));
    return {raceNo,date,hip,entries:rows.slice(0,6).map((x,i)=>({...x,rank:i+1}))};
  }).filter(x=>x.raceNo);
}
function tkpParseGanyanCanavariJByg(jsonText, fallbackMeta={}){
  let json;try{json=JSON.parse(String(jsonText||''));}catch{throw new Error('Ganyan Canavarı J-BYG JSON çözümlenemedi.');}
  if(json?._tkp?.kind!=='ganyan_canavari_jbyg'||!Array.isArray(json?.Kosular))throw new Error('Ganyan Canavarı J-BYG JSON şeması doğrulanamadı.');
  const date=String(json?._tkp?.meeting?.date||fallbackMeta.date||''),hip=String(json?._tkp?.meeting?.hippodrome||fallbackMeta.hip||'');
  const num=v=>{const n=Number(String(v??'').trim().replace(',','.'));return Number.isFinite(n)?n:null;};
  // Bazı canlı/eski J-BYG cevaplarında sayısal alanlar 0/0 olarak gelirken
  // Jokey_Detay içinde aynı koşu için gerçek derece sayıları bulunuyor. Bu
  // durumda satırı sessizce atmak yerine yalnız açıkça görülen 1.-4. derece
  // adetlerinden gözlenen oran üret; "Bugün Sadece Bu Ata Binecektir" gibi
  // istatistik içermeyen metinler asla sayısal kabul edilmez.
  const detailCounts=value=>{
    const text=String(value||'').replace(/<[^>]*>/g,' ');
    const match=text.match(/\((\d+)\)\s*1\s*\.?\s*lik[\s\S]*?\((\d+)\)\s*2\s*\.?\s*lik[\s\S]*?\((\d+)\)\s*3\s*\.?\s*lük[\s\S]*?\((\d+)\)\s*4\s*\.?\s*lük/i);
    if(!match)return null;
    const counts=match.slice(1).map(Number),observed=counts.reduce((sum,n)=>sum+n,0);
    return counts.every(Number.isFinite)&&observed>0?{first:counts[0],second:counts[1],third:counts[2],fourth:counts[3],observed}:null;
  };
  return json.Kosular.map((kosu,index)=>{
    const raceNo=Number(kosu?.Kosu_No)||Number(json?._tkp?.raceFrom)+index||null;
    const rawRows=(kosu?.Jokeyler||[]).map(j=>{
      let wins=num(j?.birinci),starts=num(j?.toplam),detailParsed=false,detail=null;
      if(!(Number.isFinite(starts)&&starts>0)){
        detail=detailCounts(j?.Jokey_Detay);
        if(detail){wins=detail.first;starts=detail.observed;detailParsed=true;}
      }
      const pct=Number.isFinite(wins)&&Number.isFinite(starts)&&starts>0?wins*100/starts:null;
      return {
        no:String(j?.At_No??'').match(/\d+/)?.[0]||'',name:String(j?.At_Unvan||'').trim(),jockey_name:String(j?.Jokey_Unvan||'').trim(),wins,starts,pct,
        second:detail?.second??num(j?.ikinci),third:detail?.third??num(j?.ucuncu),fourth:detail?.fourth??num(j?.dorduncu),detailParsed
      };
    }).filter(x=>x.no&&Number.isFinite(x.pct));
    const ranked=rawRows.filter(x=>x.pct>8.50).sort((a,b)=>b.pct-a.pct||Number(a.no)-Number(b.no)).slice(0,7).map((x,i)=>({...x,rank:i+1}));
    // GC satırında gerçek 0 oranı varsa bu bir "eksik" ya da yedek çağrısı
    // değildir. Sıra üretmez, fakat kaynak kanıtıyla birlikte 0 olarak saklanır.
    const zeroes=rawRows.filter(x=>x.pct===0).sort((a,b)=>Number(a.no)-Number(b.no)).map(x=>({...x,rank:0,zero:true}));
    return {raceNo,date,hip,entries:ranked.concat(zeroes),observations:rawRows};
  }).filter(x=>x.raceNo);
}
function tkpSupportRace(payload,raceNo,rows=[]){
  const races=payload?.races||[],number=Number(raceNo);
  const hasAbsolute=races.some(r=>Number(r?._absRaceNo)>0);
  const exact=Number.isFinite(number)?races.find(r=>Number(hasAbsolute?r?._absRaceNo:r?.leg)===number):null;
  if(!Array.isArray(rows)||!rows.length)return exact||null;
  let best=null,bestScore=0,tied=false;
  for(const race of races){
    const byName=new Set((race?.horses||[]).map(h=>baseHorseName(h?.horse_name||'')).filter(Boolean));
    const score=rows.filter(row=>{const name=baseHorseName(row?.name||'');return name&&byName.has(name);}).length;
    if(score>bestScore){best=race;bestScore=score;tied=false;}else if(score>0&&score===bestScore)tied=true;
  }
  const named=rows.filter(row=>baseHorseName(row?.name||'')).length;
  const needed=Math.max(1,Math.ceil(named*.35));
  // Horse numbers repeat in every race. They cannot choose a different race.
  return best&&!tied&&bestScore>=needed?best:(exact||null);
}
// GC P sütunu için tarih/hipodrom metası ile at kimliği ayrıdır. Meta biçimi
// değişse bile yalnız gerçek satır örtüşmesi olan kayıt uygulanabilir; yalnız at
// numarası ise yarış numarası da birebir eşleşiyorsa yeterli sayılır.
function tkpGcTrRaceEvidence(race,rows=[]){
  if(!race||!Array.isArray(rows)||!rows.length)return {nameHits:0,noHits:0,strong:false};
  const byName=new Set((race.horses||[]).map(h=>baseHorseName(h?.horse_name||'')).filter(Boolean));
  const byNo=new Set((race.horses||[]).map(h=>String(h?.horse_no||'').match(/^\d+/)?.[0]).filter(Boolean));
  let nameHits=0,noHits=0;
  for(const row of rows){
    const name=baseHorseName(row?.name||''),no=String(row?.no??'').match(/^\d+/)?.[0]||'';
    if(name&&byName.has(name))nameHits++;
    if(no&&byNo.has(no))noHits++;
  }
  const nameNeeded=Math.max(2,Math.ceil(rows.length*.25));
  return {nameHits,noHits,strong:nameHits>=nameNeeded,numberStrong:noHits>=nameNeeded};
}
function tkpSupportHorse(race,row){
  const no=String(row?.no??'').match(/\d+/)?.[0]||'',name=baseHorseName(row?.name||''),horses=race?.horses||[];
  const named=name?horses.filter(h=>baseHorseName(h?.horse_name||'')===name):[];
  if(named.length===1)return named[0];if(named.length>1)return null;
  const numbered=no?horses.filter(h=>String(h?.horse_no||'').match(/^\d+/)?.[0]===no):[];
  if(numbered.length!==1)return null;
  return name&&baseHorseName(numbered[0].horse_name||'')?null:numbered[0];
}
function tkpSupportMetaMatches(payload,rec){
  const targetDate=String(payload?.file?.race_date||payload?.races?.[0]?.race_date||'');
  const hip=v=>canonicalHippodrome(String(v||'').replace(/\s+(?:HİPODROMU|HIPODROMU|HIPPODROME)\s*$/i,''));
  const targetHip=hip(payload?.file?.hippodrome||payload?.races?.[0]?.hippodrome||'');
  const iso=v=>{const raw=String(v||'').trim(),ymd=raw.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/),dmy=raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);return ymd?`${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`:dmy?`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`:raw;};
  return !((rec?.date&&targetDate&&iso(rec.date)!==iso(targetDate))||(rec?.hip&&targetHip&&hip(rec.hip)!==targetHip));
}
function tkpApplyGanyanCanavariGlpOzet(payload,records){
  const log=[];let appliedTotal=0;
  for(const rec of records||[]){if(!tkpSupportMetaMatches(payload,rec)){log.push(`⚠️ Galoplar Özet ${rec.raceNo||'?'}: tarih/hipodrom uyuşmadı.`);continue;}const race=tkpSupportRace(payload,rec.raceNo);if(!race)continue;let applied=0;
    const matching=(rec.entries||[]).filter(row=>tkpSupportHorse(race,row));
    const hasVerified=(race.horses||[]).some(h=>/^(GANYAN_CANAVARI_GALOPLAR_OZET|YENIBEYGIR_GLP_FALLBACK)$/.test(String(h.glp_source||'')));
    if(!matching.length&&((rec.entries||[]).length||hasVerified)){log.push(`⚠️ Galoplar Özet ${rec.raceNo}: yeni doğrulanmış eşleşme yok; önceki veriler korundu.`);continue;}
    // Aynı toplantı yeniden alınırsa önceki ilk-6 sırası kalıntı bırakmasın. Bu
    // temizleme yalnız doğrulanmış GC Galoplar Özet kaydı bulunduğunda yapılır.
    for(const h of (race.horses||[])){for(const key of ['g800','g800_rank','galop_rank','glp_rank','workout_800','glp_raw'])h[key]=null;h.glp_source=null;h.glp_asof_date=null;delete h.glp_proxy;delete h.glp_proxy_inputs;}
    for(const row of rec.entries||[]){const h=tkpSupportHorse(race,row);if(!h)continue;h.g800=row.rank;h.g800_rank=row.rank;h.galop_rank=row.rank;h.workout_800=row.time800;if(row.raw)h.glp_raw=row.raw;h.glp_source='GANYAN_CANAVARI_GALOPLAR_OZET';h.glp_asof_date=rec.date||payload?.file?.race_date||'';delete h.glp_proxy;delete h.glp_proxy_inputs;applied++;}
    race.support_layers={...(race.support_layers||{}),glp:{complete:applied>0,source:'GANYAN_CANAVARI_GALOPLAR_OZET',asof:rec.date||payload?.file?.race_date||'',eligible:(rec.entries||[]).length,applied}};appliedTotal+=applied;log.push(applied?`✅ Ganyan Canavarı Galoplar Özet ${rec.raceNo}. koşu: ${applied} at için GLP işlendi.`:`ℹ️ Ganyan Canavarı Galoplar Özet ${rec.raceNo}. koşu: doğrulanmış eşleşme yok; GLP nötr bırakıldı ve yeniden toplanacak.`);
  }
  return {log,applied:appliedTotal};
}
function tkpApplyGanyanCanavariJByg(payload,records){
  const log=[];let appliedTotal=0;
  for(const rec of records||[]){if(!tkpSupportMetaMatches(payload,rec)){log.push(`⚠️ GC J-BYG ${rec.raceNo||'?'}: tarih/hipodrom uyuşmadı.`);continue;}const race=tkpSupportRace(payload,rec.raceNo);if(!race)continue;let applied=0,zeroAccepted=0;
    const matching=(rec.entries||[]).filter(row=>tkpSupportHorse(race,row));
    const hasVerified=(race.horses||[]).some(h=>/^(GANYAN_CANAVARI_JBYG|YENIBEYGIR_JBYG_FALLBACK)$/.test(String(h.jbyg_source||'')));
    if(!matching.length&&((rec.entries||[]).length||hasVerified)){log.push(`⚠️ GC J-BYG ${rec.raceNo}: yeni doğrulanmış eşleşme yok; önceki veriler korundu.`);continue;}
    // GC birincil veri geldiğinde önceki yedek/sentetik sıraların tamamı silinir;
    // eşik altında kalan atlarda eski bir J-BYG değeri yaşamaya devam edemez.
    for(const h of (race.horses||[])){for(const k of ['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank','team_rank','jockey_trainer_rank','jokey_antrenor_rank','jbyg_rate','team_strength_pct'])h[k]=null;h.jbyg_source=null;h.jbyg_asof_date=null;}
    for(const row of rec.entries||[]){const h=tkpSupportHorse(race,row);if(!h)continue;const rank=Number(row?.rank);const isRealZero=row?.zero===true&&Number(row?.pct)===0;if(Number.isFinite(rank)&&rank>=1&&rank<=7){h.jbyg=Math.round(rank);h.jbyg_rank=Math.round(rank);h.team_strength_rank=Math.round(rank);applied++;}else if(isRealZero){h.jbyg=0;h.jbyg_rank=null;h.team_strength_rank=null;zeroAccepted++;}else continue;h.jbyg_rate=Math.round(Number(row.pct)*100)/100;h.team_strength_pct=h.jbyg_rate;h.jbyg_source='GANYAN_CANAVARI_JBYG';h.jbyg_asof_date=rec.date||payload?.file?.race_date||'';if(row.jockey_name&&!h.jockey_name)h.jockey_name=row.jockey_name;}
    // Boş/eşleşmeyen kaynak "tamam" sayılırsa eksik ayak bir daha toplanmaz.
    // Yalnız gerçek bir at eşleşmesi katmanı tamamlar; kaynakta eşik üstü aday
    // yoksa bu bilgi açıkça kayda geçer ve sonraki veri toplamada tekrar denenir.
    const verified=applied+zeroAccepted;
    const observed=Array.isArray(rec.observations)?rec.observations.length:(rec.entries||[]).length;
    const detailParsed=Array.isArray(rec.observations)?rec.observations.filter(row=>row?.detailParsed===true).length:0;
    race.support_layers={...(race.support_layers||{}),jbyg:{complete:verified>0,source:'GANYAN_CANAVARI_JBYG',asof:rec.date||payload?.file?.race_date||'',eligible:(rec.entries||[]).length,observed,detailParsed,applied,zeroAccepted,threshold:'>8.50',limit:7}};appliedTotal+=verified;log.push(verified?`✅ Ganyan Canavarı J-BYG ${rec.raceNo}. koşu: ${applied} sıralı${zeroAccepted?` · ${zeroAccepted} gerçek 0`:''}${detailParsed?` · ${detailParsed} detaydan kurtarıldı`:''} kayıt işlendi.`:`ℹ️ Ganyan Canavarı J-BYG ${rec.raceNo}. koşu: eşik üstü/eşleşen aday yok; katman eksik bırakıldı ve yeniden toplanacak.`);
  }
  return {log,applied:appliedTotal};
}
function tkpYeniBeygirFallbackRaceNo(meta={}){
  const direct=Number(meta?.raceNo);
  if(Number.isInteger(direct)&&direct>0)return direct;
  const named=String(meta?.name||meta?.filename||'').match(/(?:^|[_-])R0*(\d{1,2})(?:\D|$)/i);
  if(named)return Number(named[1]);
  return raceNoFromLooseText(String(meta?.name||meta?.filename||''))||null;
}
function tkpParseYeniBeygirJByg(htmlText,fallbackMeta={}){
  const fallbackRaceNo=tkpYeniBeygirFallbackRaceNo(fallbackMeta);
  return parseJockeyPerformanceRecords(htmlText).map(rec=>({
    ...rec,
    raceNo:Number(rec?.raceNo)||fallbackRaceNo||null,
    date:fallbackMeta?.date||'',
    hip:fallbackMeta?.hip||''
  })).filter(rec=>Number(rec.raceNo)>0);
}
function tkpParseYeniBeygirGlp(htmlText,fallbackMeta={}){
  const parsed=parseGalopHTML(htmlText)||{};
  const raceNo=Number(parsed?.raceNo)||tkpYeniBeygirFallbackRaceNo(fallbackMeta);
  if(!Number.isInteger(raceNo)||raceNo<=0)return [];
  const ranks=parsed?.ranks||{},ranksByNo=parsed?.ranksByNo||{};
  const rows=[];
  const seen=new Set();
  for(const raw of parsed?.entries||[]){
    const no=String(raw?.no||'').match(/\d+/)?.[0]||'';
    const name=baseHorseName(raw?.name||'');
    const rank=Number((no&&ranksByNo[no]!=null?ranksByNo[no]:null)??(name&&ranks[name]!=null?ranks[name]:null));
    if(!Number.isFinite(rank)||rank<1||rank>6)continue;
    const key=no?'N:'+no:'H:'+name;
    if(!name&&!no||seen.has(key))continue;
    seen.add(key);rows.push({no,name,rank});
  }
  if(!rows.length){
    for(const [no,rawRank] of Object.entries(ranksByNo)){
      const rank=Number(rawRank);if(!Number.isFinite(rank)||rank<1||rank>6)continue;
      const key='N:'+no;if(seen.has(key))continue;
      seen.add(key);rows.push({no:String(no),name:'',rank});
    }
    for(const [rawName,rawRank] of Object.entries(ranks)){
      const name=baseHorseName(rawName),rank=Number(rawRank);if(!name||!Number.isFinite(rank)||rank<1||rank>6)continue;
      const key='H:'+name;if(seen.has(key))continue;
      seen.add(key);rows.push({no:'',name,rank});
    }
  }
  return [{raceNo,date:fallbackMeta?.date||'',hip:fallbackMeta?.hip||'',entries:rows}];
}
function tkpIsGcJbygSource(value){return /^GANYAN_CANAVARI_JBYG$/i.test(String(value||''));}
function tkpIsGcGlpSource(value){return /^GANYAN_CANAVARI_GALOPLAR_OZET$/i.test(String(value||''));}
function tkpApplyYeniBeygirJByg(payload,records,meta={}){
  const log=[];let appliedTotal=0;
  for(const rec of records||[]){
    if(!tkpSupportMetaMatches(payload,rec)){log.push('⚠️ Yeni Beygir J-BYG '+(rec?.raceNo||'?')+'. koşu: tarih/hipodrom uyuşmadı.');continue;}
    const race=tkpSupportRace(payload,rec?.raceNo,rec?.entries);
    if(!race)continue;
    const entries=(rec?.entries||[]).map(raw=>{
      const no=String(raw?.no||'').match(/\d+/)?.[0]||'',name=baseHorseName(raw?.name||'');
      const rank=Number(raw?.rank??(no&&rec?.ranks?.[no])??(name&&rec?.ranksByName?.[name]));
      return {...raw,no,name,rank};
    }).filter(row=>Number.isFinite(row.rank)&&row.rank>=1&&row.rank<=7);
    const byNo=new Map(entries.filter(row=>row.no).map(row=>[row.no,row]));
    const byName=new Map(entries.filter(row=>row.name).map(row=>[row.name,row]));
    let applied=0,primaryRetained=0;
    for(const h of race.horses||[]){
      if(tkpIsGcJbygSource(h?.jbyg_source)){primaryRetained++;continue;}
      const no=String(h?.horse_no||'').match(/^\d+/)?.[0]||'',name=baseHorseName(h?.horse_name||'');
      const row=(name&&byName.get(name))||(no&&byNo.get(no))||null;
      if(!row)continue;
      const rank=Math.round(Number(row.rank));
      if(rank<1||rank>7)continue;
      h.jbyg=rank;h.jbyg_rank=rank;h.team_strength_rank=rank;
      if(Number.isFinite(Number(row?.pct))){h.jbyg_rate=Number(row.pct);h.team_strength_pct=Number(row.pct);}
      h.jbyg_source='YENIBEYGIR_JBYG_FALLBACK';h.jbyg_asof_date=rec?.date||meta?.date||payload?.file?.race_date||'';
      applied++;
    }
    if(applied){
      const oldLayer=race.support_layers?.jbyg||{};
      const gcPrimary=primaryRetained>0||tkpIsGcJbygSource(oldLayer?.source);
      race.support_layers={...(race.support_layers||{}),jbyg:gcPrimary
        ?{...oldLayer,complete:true,source:'GANYAN_CANAVARI_JBYG',fallback_source:'YENIBEYGIR_JBYG_FALLBACK',fallback_applied:Number(oldLayer?.fallback_applied||0)+applied}
        :{complete:true,source:'YENIBEYGIR_JBYG_FALLBACK',fallback_for:'GANYAN_CANAVARI_JBYG',asof:rec?.date||meta?.date||payload?.file?.race_date||'',eligible:entries.length,applied,threshold:'>8.50',limit:7}};
      appliedTotal+=applied;
      log.push('✅ Yeni Beygir J-BYG '+(rec?.raceNo||'?')+'. koşu: GC boş kalan '+applied+' at için yedek işlendi'+(primaryRetained?' · '+primaryRetained+' GC kaydı korundu.':'.'));
    }else{
      log.push('ℹ️ Yeni Beygir J-BYG '+(rec?.raceNo||'?')+'. koşu: GC dışındaki doğrulanmış boş atla eşleşen yedek kayıt yok.');
    }
  }
  return {log,applied:appliedTotal};
}
function tkpApplyYeniBeygirGlp(payload,records,meta={}){
  const log=[];let appliedTotal=0;
  for(const rec of records||[]){
    if(!tkpSupportMetaMatches(payload,rec)){log.push('⚠️ Yeni Beygir GLP '+(rec?.raceNo||'?')+'. koşu: tarih/hipodrom uyuşmadı.');continue;}
    const race=tkpSupportRace(payload,rec?.raceNo,rec?.entries);
    if(!race)continue;
    const byNo=new Map(),byName=new Map();
    for(const raw of rec?.entries||[]){
      const no=String(raw?.no||'').match(/\d+/)?.[0]||'',name=baseHorseName(raw?.name||''),rank=Math.round(Number(raw?.rank));
      if(!Number.isFinite(rank)||rank<1||rank>6)continue;
      const row={...raw,no,name,rank};if(no)byNo.set(no,row);if(name)byName.set(name,row);
    }
    let applied=0,primaryRetained=0;
    for(const h of race.horses||[]){
      if(tkpIsGcGlpSource(h?.glp_source)){primaryRetained++;continue;}
      const no=String(h?.horse_no||'').match(/^\d+/)?.[0]||'',name=baseHorseName(h?.horse_name||'');
      const row=(name&&byName.get(name))||(no&&byNo.get(no))||null;
      if(!row)continue;
      h.g800=row.rank;h.g800_rank=row.rank;h.galop_rank=row.rank;h.glp_rank=row.rank;
      h.glp_source='YENIBEYGIR_GLP_FALLBACK';h.glp_asof_date=rec?.date||meta?.date||payload?.file?.race_date||'';
      delete h.glp_proxy;delete h.glp_proxy_inputs;applied++;
    }
    if(applied){
      const oldLayer=race.support_layers?.glp||{};
      const gcPrimary=primaryRetained>0||tkpIsGcGlpSource(oldLayer?.source);
      race.support_layers={...(race.support_layers||{}),glp:gcPrimary
        ?{...oldLayer,complete:true,source:'GANYAN_CANAVARI_GALOPLAR_OZET',fallback_source:'YENIBEYGIR_GLP_FALLBACK',fallback_applied:Number(oldLayer?.fallback_applied||0)+applied}
        :{complete:true,source:'YENIBEYGIR_GLP_FALLBACK',fallback_for:'GANYAN_CANAVARI_GALOPLAR_OZET',asof:rec?.date||meta?.date||payload?.file?.race_date||'',eligible:byNo.size+byName.size,applied}};
      appliedTotal+=applied;
      log.push('✅ Yeni Beygir GLP '+(rec?.raceNo||'?')+'. koşu: GC boş kalan '+applied+' at için yedek işlendi'+(primaryRetained?' · '+primaryRetained+' GC kaydı korundu.':'.'));
    }else{
      log.push('ℹ️ Yeni Beygir GLP '+(rec?.raceNo||'?')+'. koşu: GC dışındaki doğrulanmış boş atla eşleşen yedek kayıt yok.');
    }
  }
  return {log,applied:appliedTotal};
}

async function classifyAndMergeFiles(fileList, altiliNo=1){
  altiliNo=Math.max(1,Number(altiliNo)||1);
  const normalizedFiles=Array.from(fileList||[]);
  await tkpPrefetchFiles(normalizedFiles,8);
  fileList=normalizedFiles;
  const architectureJob=typeof tkpStartJob==='function'?tkpStartJob('folder-import',{budgetMs:12,total:fileList.length}):null;
  let architectureProcessed=0;
  let bulletinFile = null, bulletinKind = null, resultsFallback = null, odsPayloads = [], jockeyFiles = [], galopFiles = [], gcGlpFiles = [], gcJbygFiles = [], ybGlpFiles = [], ybJbygFiles = [], ypuanFiles = [], yorumcuFiles = [], atrFiles = [], nyraFiles = [], nyraWorkoutFiles = [], dmtcFiles = [], dmtcWorkoutFiles = [], equibaseFiles = [], clubHipicoFiles = [], foreignSupportFiles = [], trFiles = [], unknown = [];
  for (const f of fileList){
    if(architectureJob&&typeof tkpJobCheckpoint==='function')await tkpJobCheckpoint(architectureJob,architectureProcessed++,fileList.length);
    if (_v25IsFolderAssetFile(f)) { unknown.push(`${f.name} (yardımcı klasör dosyası atlandı)`); continue; }
    if (/\.ods$/i.test(f.name)){
      try{
        const xml=await unzipEntry(await tkpReadFileArrayBuffer(f),'content.xml');
        const payload=parseODSxml(xml,f.name);
        odsPayloads.push({file:f,payload});
      }catch(e){
        unknown.push(`${f.name} (${e.message})`);
      }
      continue;
    }
    let text;
    try {
      text = await tkpReadFileText(f);
    } catch (e) {
      unknown.push(`${f.name} (erişilemedi, atlandı: ${e?.message || e})`);
      continue;
    }
    let titleM = text.match(/<title[^>]*>([^<]*)<\/title>/i);
    let title = titleM ? titleM[1] : '';
    const probe=fold((title+' '+text.slice(0,25000)).replace(/<[^>]+>/g,' '));
    const legacySupportDisabled=/atlagel/i.test(String(f?.name||'')+' '+title+' '+text.slice(0,12000));
    if(legacySupportDisabled){unknown.push(`${f.name} (kaynak kaldırıldı; JKY/GLP yalnız Ganyan Canavarı)`);continue;}
    const looseJockeyPerformance = _v25LooksLikeJockeyPerformanceLoose(text,title,f);
    const looseTjkProgram = _v25LooksLikeTjkProgramLoose(text,title,f);
    const looseTjkResults = _v25LooksLikeTjkResultsLoose(text,title,f);
    // KÖK FIX: Gerçek TJK Program/Sonuç sayfaları da tablo içinde Jokey/Antrenörü/oran-yüzde
    // sütunları taşıdığı için looseJockeyPerformance bunlarda da true dönebiliyordu. Bu yüzden
    // önce güçlü TJK Program/Sonuç imzası (gunluk-GunlukYarisProgrami/Sonuclari, kosubilgisi-)
    // kontrol edilir; sadece TJK sayfası DEĞİLSE jokey-performans yedeği devreye girer. Aksi
    // halde ana bülten/sonuç dosyası yanlışlıkla J-BYG kaynağı sanılıp bülten hiç bulunamıyordu.
    const looksAtr=/ATTHERACES_/i.test(String(f?.name||'')) || /id=["']tkp-atr-bundle["']/i.test(text) || /attheraces\.com\/racecards?\//i.test(text) || (/At The Races/i.test(title+' '+text.slice(0,80000)) && (/Race\s+\d+/i.test(text)||/card-entry|horse__link|card-cell-pinsticker/i.test(text)));
    const looksNyraWorkout=/NYRA_WORKOUTS_/i.test(String(f?.name||'')) || /nyra\.com\/saratoga\/racing\/workouts/i.test(text);
    const looksNyra=/NYRA_ENTRIES_/i.test(String(f?.name||'')) || /nyra\.com\/saratoga\/racing\/entries/i.test(text) || (/New York Racing Association/i.test(text)&&/Saratoga/i.test(text)&&/Entries/i.test(title+' '+text.slice(0,12000)));
    const looksDmtcWorkout=/DMTC_WORKOUTS_/i.test(String(f?.name||'')) || /dmtc\.com\/racing\/workouts/i.test(text);
    const looksDmtc=/DMTC_ENTRIES_/i.test(String(f?.name||'')) || /dmtc\.com\/racing\/(?:entries|raceday-entries)/i.test(text) || (/Del Mar Daily Entries/i.test(title+' '+text.slice(0,12000)));
    const looksEquibase=/EQUIBASE_/i.test(String(f?.name||'')) || /equibase\.com\/static\/entry\//i.test(text) || (/Equibase/i.test(title)&&/Saratoga Entries/i.test(title+' '+text.slice(0,5000)));
    const looksClubHipico=/CLUBHIPICO_/i.test(String(f?.name||'')) || /clubhipico\.cl/i.test(text);
    const foreignSupportSource=(/CLUBCONCEPCION_/i.test(String(f?.name||''))||/clubhipicoconcepcion\.cl/i.test(text))?'CLUB_CONCEPCION':(/HKJC_/i.test(String(f?.name||''))||/racing\.hkjc\.com/i.test(text))?'HKJC':(/FRANCEGALOP_/i.test(String(f?.name||''))||/france-galop\.com/i.test(text))?'FRANCE_GALOP':(/GOLDCIRCLE_/i.test(String(f?.name||''))||/goldcircle\.co\.za/i.test(text))?'GOLD_CIRCLE':(/RACINGPOST_/i.test(String(f?.name||''))||/racingpost\.com/i.test(text))?'RACING_POST':(/RACENET_/i.test(String(f?.name||''))||/racenet\.com\.au/i.test(text))?'RACENET':(/RACINGANDSPORTS_/i.test(String(f?.name||''))||/racingandsports\.com\.au/i.test(text))?'RACING_AND_SPORTS':null;
    // Collector dosyaları isim/HTML sezgisine mahkum değildir. Bridge, her File
    // nesnesine sunucudan gelen doğrulanmış source sidecar'ını bağlar. Özellikle
    // generic adla (html-1.html / snapshot.json) kaydedilen TR PUAN ve hazır
    // kupon dosyaları eski sınıflandırıcıda sessizce unknown kalabiliyordu.
    // Kaynak sidecar'ı varsa onu birincil sınıflandırma kanıtı olarak kullan;
    // içerik imzası yalnız manuel dosyalar için yedektir.
    let collectorDeclaredSource='';
    try{collectorDeclaredSource=String(globalThis.tkpCollectorFileProvenance?.(f)?.source||'').trim().toLowerCase();}catch(_e){collectorDeclaredSource='';}
    const collectorReadyKind=({misli:'misli',bitalih:'bitalih',hipodrom:'hipodrom',editor:'atyarisi',liderform:'liderform'})[collectorDeclaredSource]||'';
    const readyCouponSnapshotSource=collectorReadyKind||_v25ReadyCouponSnapshotSource(f,text);
    // Misli HTML yedeği, sayfanın içinde TJK programına ait genel sınıf/ad
    // izleri taşıyabilir. Kaynak sidecar'ı veya alan adı/dosya adı Misli'yi
    // doğruluyorsa önce yorumcu hattına bağla; hiçbir durumda GC TR PUAN
    // parser'ına düşürme. Aksi halde aynı dosya bir katmanı gölgede bırakıp
    // hem Y.PUAN hem TR PUAN kapsamını yanlış gösterebiliyordu.
    const looksMisliReadyCoupon=collectorDeclaredSource==='misli'
      ||/MISLI[_\s-]*KUPON/i.test(String(f?.name||f?.webkitRelativePath||''))
      ||/misli\.com/i.test(String(text||'').slice(0,120000));
    const looksGcGlp=collectorDeclaredSource==='ganyan_canavari_glp'||/GANYAN_CANAVARI_GLP_OZET/i.test(String(f?.name||''))||/"kind"\s*:\s*"ganyan_canavari_glp"/i.test(text)||(/galoplar-ozet/i.test(text)&&/Ortalama\s+Galoplar/i.test(text));
    const looksGcJbyg=collectorDeclaredSource==='ganyan_canavari_jbyg'||/GANYAN_CANAVARI_JBYG/i.test(String(f?.name||''))||/"kind"\s*:\s*"ganyan_canavari_jbyg"/i.test(text);
    const ybProvenance=/^yenibeygir_(?:jbyg|glp)$/.test(collectorDeclaredSource)||/YENIBEYGIR/i.test(String(f?.name||''))||/yenibeygir\.com/i.test(text);
    const looksYbJbyg=ybProvenance&&(/YENIBEYGIR_JBYG_FALLBACK/i.test(String(f?.name||''))||/JPerfTable/i.test(text));
    const looksYbGlp=ybProvenance&&(/YENIBEYGIR_GLP_FALLBACK/i.test(String(f?.name||''))||/at_Galoplar/i.test(text));
    const looksGanyanCanavari=!looksMisliReadyCoupon&&(collectorDeclaredSource==='ganyan_canavari'||/GANYAN_CANAVARI_TR_PUAN/i.test(String(f?.name||'')) || /"kind"\s*:\s*"ganyan_canavari_tr"/i.test(text) || (/table-yaris-programi/i.test(text) && /<tr\b(?=[^>]*\bp_kosuno=["'][^"']+["'])(?=[^>]*\bp_atno=["'][^"']+["'])[^>]*>/i.test(text)));
    const looksLiderform=/^LIDERFORM_/i.test(String(f?.name||''))||/liderform\.com\.tr\/uzman-listesi\/\d+/i.test(text)||/href=["'][^"']*\/kupon\/\d+/i.test(text);
    if(readyCouponSnapshotSource){ yorumcuFiles.push({file:f,text,kind:readyCouponSnapshotSource}); }
    else if(looksMisliReadyCoupon){ yorumcuFiles.push({file:f,text,kind:'misli'}); }
    else if(looksGcGlp){ gcGlpFiles.push({file:f,text}); }
    else if(looksGcJbyg){ gcJbygFiles.push({file:f,text}); }
    else if(looksYbJbyg){ ybJbygFiles.push({file:f,text}); }
    else if(looksYbGlp){ ybGlpFiles.push({file:f,text}); }
    else if(looksGanyanCanavari){ trFiles.push({file:f,text}); }
    else if(looksLiderform){ yorumcuFiles.push({file:f,text,kind:'liderform'}); }
    else if(looksNyraWorkout){ nyraWorkoutFiles.push({file:f,text}); }
    else if(looksNyra){ nyraFiles.push({file:f,text}); }
    else if(looksDmtcWorkout){ dmtcWorkoutFiles.push({file:f,text}); }
    else if(looksDmtc){ dmtcFiles.push({file:f,text}); }
    else if(looksClubHipico){ clubHipicoFiles.push({file:f,text}); }
    else if(foreignSupportSource){ foreignSupportFiles.push({file:f,text,source:foreignSupportSource}); }
    else if(looksEquibase){ equibaseFiles.push({file:f,text}); }
    else if(looksAtr){ atrFiles.push({file:f,text}); }
    else if (_v25LooksLikeTjkPage(text,title) || looseTjkProgram || looseTjkResults) {
      const kind=looseTjkProgram ? 'program' : (looseTjkResults ? 'results' : _v25GuessTjkKind(text,title));
      if(kind==='program' && bulletinKind!=='ods'){
        const candScore=_v25TjkFileScore(f,text,'program');
        const curScore=bulletinFile&&bulletinKind==='tjk'?_v25TjkFileScore(bulletinFile.file,bulletinFile.text||'','program'):-9999;
        if(!bulletinFile || bulletinKind!=='tjk' || candScore>=curScore){ bulletinFile={file:f,text}; bulletinKind='tjk'; }
      }else{
        const candScore=_v25TjkFileScore(f,text,'results');
        const curScore=resultsFallback?_v25TjkFileScore(resultsFallback.file,resultsFallback.text||'','results'):-9999;
        if(!resultsFallback || candScore>=curScore) resultsFallback={file:f,text};
      }
    }
    else if (looseJockeyPerformance || /JOKEY\s*PERFORMANS|JOKEY.*ANTREN[ÖO]R.*(BA[ŞS]ARI|BASARI|ORAN|%)|ANTREN[ÖO]R.*JOKEY.*BA[ŞS]ARI.*ORAN|JOKEY.*BASARI.*ORAN|JKY.*ANT|JOK.*ANT|J-BYG|JBYG|J\s*BEYG/.test(probe)) unknown.push(`${f.name} (manuel JKY kaynağı kapalı; yalnız Ganyan Canavarı doğrudan çift oranı kullanılabilir)`);
    else if (/YPUAN/.test(probe)) ypuanFiles.push({file:f, text});
    // TJK "Yarış Programı" sayfası -- yerli veya yurt dışı (Del Mar/Saratoga/Woodbine vb.)
    // koşuları da içerebilir; ana bülten olarak kabul edilir, bu
    // sayede aynı klasörde Bi'Talih/Editör Kuponları/Hipodrom (yorumcu/YPUAN) dosyaları da
    // birlikte alınıp bu koşularla otomatik birleştirilebilir.
    // ÖNEMLİ: fold() Türkçe locale ile büyütür (tr-TR'de küçük "i" -> noktalı "İ" olur,
    // ASCII "I" DEĞİL) -- "gunluk-GunlukYarisProgrami" imzasında "i" harfleri olduğu için
    // fold() üzerinden ASCII "I" aranırsa hiçbir zaman eşleşmez. Bu yüzden burada fold()
    // KULLANILMAZ, ham metin üzerinde locale'den bağımsız /i bayrağıyla aranır.
    // NOT: "gunluk-GunlukYarisProgrami-AtAdi" (sütun class'ı) aranır, sade
    // "gunluk-GunlukYarisProgrami" değil -- TJK'nın "Yarış Sonuçları" sayfası da
    // menü/breadcrumb linklerinde bu kelimeyi geçirebiliyor, bu yüzden sade metin
    // araması yanlışlıkla Sonuçları sayfasını Program sanabilirdi.
    else if ((looseTjkProgram || /gunluk-GunlukYarisProgrami-AtAdi/i.test(text) || (/Yar[ıi]ş\s+Program[ıi]/i.test(title+' '+text.slice(0,5000)) && /kosubilgisi-/i.test(text))) && bulletinKind!=='ods') {
      const candScore=_v25TjkFileScore(f,text,'program');
      const curScore=bulletinFile&&bulletinKind==='tjk'?_v25TjkFileScore(bulletinFile.file,bulletinFile.text||'','program'):-9999;
      if(!bulletinFile || bulletinKind!=='tjk' || candScore>=curScore){ bulletinFile = {file:f, text}; bulletinKind='tjk'; }
    }
    // TJK "Yarış Sonuçları" sayfası -- gün ilerledikçe (yarışlar başlayıp bitince) aynı
    // toplantının sayfası Programı'ndan Sonuçları'na dönüşebilir. Klasördeki dosyalar
    // arasında GERÇEK bir Program bulunamazsa, Sonuçlar da ana kaynak olarak (yedek)
    // kabul edilir -- aksi halde "ana bülten bulunamadı" hatası verip kullanıcıyı
    // elindeki tek geçerli veriyi kullanmaktan alıkoyardı.
    else if (looseTjkResults || /gunluk-GunlukYarisSonuclari/i.test(text) || (/Yar[ıi]ş\s+Sonuçlar[ıi]/i.test(title+' '+text.slice(0,5000)) && /kosubilgisi-/i.test(text))) {
      const candScore=_v25TjkFileScore(f,text,'results');
      const curScore=resultsFallback?_v25TjkFileScore(resultsFallback.file,resultsFallback.text||'','results'):-9999;
      if(!resultsFallback || candScore>=curScore) resultsFallback = {file:f, text};
    }
    else if ((/GALOP|İDMAN|IDMAN|ÇALIŞMA|CALISMA/.test(probe) && /(^|\D)400(\D|$)/.test(probe)) || /ORTALAMA GALOPLAR/.test(probe) || /AT_GALOPLAR/.test(fold(text))) unknown.push(`${f.name} (manuel GLP kaynağı kapalı; yalnız Ganyan Canavarı)`);
    // NOT: "EDİTÖR KUPON/HAZIR KUPON" ve "Bİ TALİH" artık sessizce ATLANMIYOR --
    // bunlar YPUAN'ın otomatik kaynağı. Her ikisi de koşuyu mutlak numarayla
    // etiketlediği için (parseEditorKuponHTML/parseBiTalihKuponHTML) 1./2. Altılı
    // karışma riski yoktur, dosyalar aşağıda _absRaceNo ile eşleştirilir.
    else if (_v25LooksLikeAtYarisiEditor(f, probe, text)) yorumcuFiles.push({file:f, text, kind:'atyarisi'});
    else if (/Bİ.?TALİH|BI.?TALIH/.test(probe)) yorumcuFiles.push({file:f, text, kind:'bitalih'});
    else if (/HAZIR KUPON/.test(probe) && /GANYAN/.test(probe) && /HİPODROM|HIPODROM/.test(probe)) yorumcuFiles.push({file:f, text, kind:'hipodrom'});
    else if (/HAZIR KUPON|GANYAN.*HİPODROM|GANYAN.*HIPODROM/.test(probe)) { /* tanınmayan başka bir hazır kupon sitesi: sessizce atla */ }
    // X (Twitter) sayfası: <title> "X'te [Yazar]: "..." / X" kalıbıyla tanınır --
    // fold() yerine ham metin üzerinde /i aranır (bkz. TJK tespitindeki "Türkçe I"
    // notu; burada da aynı tuzağa düşmemek için).
    else if (/<title>\s*X'te\s+[^<]*:\s*"/i.test(text)) yorumcuFiles.push({file:f, text, kind:'twitter'});
    // bankotahminler.com "Banko Tahminler" sayfası -- yapay zekâ tahmin sitesi.
    else if (/Banko\s*Tahminler/i.test(text) && /KO[ŞS]U\s*:/i.test(text)) yorumcuFiles.push({file:f, text, kind:'banko'});
    else unknown.push(f.name);
  }
  // Aynı klasörde 1. ve 2. Altılıya ait iki ODS varsa ikisi ayrı payload olarak
  // tutulur. Dosya adındaki 1/2 etiketi önceliklidir; etiketsiz dosyalarda doğal dosya
  // adı sırası kullanılır. Böylece ikinci ODS birincinin üzerine yazmaz ve ayaklar karışmaz.
  if(odsPayloads.length && !bulletinFile){
    // ODS yalnız başına yüklenirse ana kaynak olur. Klasörde TJK Program HTML de varsa
    // TJK ana veri olarak kalır; ODS eski/boş J-BYG/AGF ile TJK verisini ezmez.
    odsPayloads.sort((a,b)=>{
      const aa=Number(a.payload?.file?.altili_no)||99, bb=Number(b.payload?.file?.altili_no)||99;
      if(aa!==bb) return aa-bb;
      return TKP_TR_COLLATOR_NUM.compare(String(a.file?.name||''),String(b.file?.name||''));
    });
    const total=Math.min(2,odsPayloads.length);
    odsPayloads.forEach((item,i)=>{
      if(!Number(item.payload?.file?.altili_no)) item.payload.file.altili_no=i+1;
      item.payload.file.altili_count=total;
      (item.payload.races||[]).forEach(r=>{r.altili_no=item.payload.file.altili_no;});
    });
    const chosen=odsPayloads[Math.min(altiliNo,total)-1] || odsPayloads[0];
    bulletinFile=chosen;
    bulletinKind='ods';
  }
  if (!bulletinFile && resultsFallback) { bulletinFile = resultsFallback; bulletinKind = 'tjk-results'; }

  // TOMMY klasör yükleme yedeği:
  // Bazı tarayıcılar TJK ana Program/Sonuç HTML'ini farklı isimle veya kaydedilmiş kaynak
  // dosyası gibi döndürebiliyor. İlk geçişte elenmiş/puanı düşük kalmış olsa bile, klasörde
  // gerçekten TJK Program/Sonuç gövdesi varsa burada son kez İÇERİĞE bakarak ana dosya seç.
  // Dosya adına güvenmeyiz; gunluk-GunlukYarisProgrami-AtAdi / kosubilgisi / GunlukYaris
  // imzası zorunludur. Bu yedek yardımcı Galop/Jokey/Kupon sayfalarını ana bülten yapmaz.
  if (!bulletinFile){
    let fallbackMain=null, fallbackKind=null, fallbackScore=-999999;
    for (const f of (fileList||[])){
      if(!f || !/\.html?$/i.test(String(f.name||''))) continue;
      let text='';
      try{ text=await tkpReadFileText(f); }catch(_e){ continue; }
      const titleM=text.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title=titleM?titleM[1]:'';
      const path=String(f?.webkitRelativePath||f?.name||'').replace(/\\/g,'/');
      const rawHead=String(text||'').slice(0,140000);
      const isHelperByName=/GALOP|JOKEY\s*PERFORMANS|KUPON|Bİ.?TALİH|BI.?TALIH|HIPODROM|YPUAN|AGF|EDİTÖR|EDITOR/i.test(path);
      const strongProgram=/gunluk-GunlukYarisProgrami-AtAdi/i.test(text) || (/GunlukYarisProgrami/i.test(rawHead) && /kosubilgisi-/i.test(text));
      const strongResults=/gunluk-GunlukYarisSonuclari/i.test(text) || (/GunlukYarisSonuclari/i.test(rawHead) && /kosubilgisi-/i.test(text));
      if(isHelperByName && !strongProgram && !strongResults) continue;
      if(!strongProgram && !strongResults) continue;
      const kind=strongProgram?'tjk':'tjk-results';
      let score=_v25TjkFileScore(f,text,strongProgram?'program':'results') + (strongProgram?500:300);
      if(isHelperByName) score-=200;
      if(score>fallbackScore){
        fallbackScore=score;
        fallbackMain={file:f,text};
        fallbackKind=kind;
      }
    }
    if(fallbackMain){
      bulletinFile=fallbackMain;
      bulletinKind=fallbackKind;
      unknown.push(`ℹ️ ${fallbackMain.file.name}: TJK ana HTML içerikten yedek olarak tanındı.`);
    }
  }

  if (!bulletinFile){
    const helperCount = jockeyFiles.length + galopFiles.length + gcGlpFiles.length + gcJbygFiles.length + ypuanFiles.length + yorumcuFiles.length + trFiles.length + atrFiles.length + nyraFiles.length + nyraWorkoutFiles.length + dmtcFiles.length + dmtcWorkoutFiles.length + equibaseFiles.length + clubHipicoFiles.length + foreignSupportFiles.length;
    if(helperCount){
      const names=(fileList||[]).map(f=>String(f?.webkitRelativePath||f?.name||'')).filter(Boolean);
      // Eksik katmanlar bazen tarayıcı tarafından generic adlarla kaydedilir
      // (örn. html-1.html). Yalnız dosya adına bakmak mevcut ana kaydı kaçırıp
      // "ana bülten bulunamadı" hatasına yol açıyordu. Bu nedenle yardımcı
      // dosyaların okunmuş içeriği de toplantı meta verisi için kullanılır.
      const helperMetaTexts=[...jockeyFiles,...galopFiles,...gcGlpFiles,...gcJbygFiles,...ypuanFiles,...yorumcuFiles,...trFiles,...atrFiles,...nyraFiles,...nyraWorkoutFiles,...dmtcFiles,...dmtcWorkoutFiles,...equibaseFiles,...clubHipicoFiles,...foreignSupportFiles]
        .map(x=>String(x?.text||'').slice(0,180000)).filter(Boolean);
      function metaDateFromName(raw){
        raw=String(raw||'');
        let m=raw.match(/(20\d{2})[-_. ]?(0?[1-9]|1[0-2])[-_. ]?(0?[1-9]|[12]\d|3[01])/);
        if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
        m=raw.match(/(0?[1-9]|[12]\d|3[01])[-_. ](0?[1-9]|1[0-2])[-_. ](20\d{2})/);
        if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
        // 0408 / 04-08 gibi Yeni Beygir klasör kısaltmaları: aktif kayıtla yıl tamamlanır.
        m=raw.match(/(?:^|[^0-9])([0-3]?\d)[-_. ]?([01]?\d)(?:[^0-9]|$)/);
        if(m){
          const dd=Number(m[1]), mm=Number(m[2]);
          if(dd>=1&&dd<=31&&mm>=1&&mm<=12){
            const activeYears=[...(db?.files||[]).map(f=>String(f.race_date||'').slice(0,4)).filter(y=>/^20\d{2}$/.test(y))];
            const yy=activeYears[activeYears.length-1] || String(new Date().getFullYear());
            return `${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
          }
        }
        return '';
      }
      function metaHipFromName(raw){
        const f=fold(raw||'');
        const aliases=[
          ['KCL','KOCAELI'],['KOC','KOCAELI'],['KOCAELI','KOCAELI'],['İZMİT','KOCAELI'],['IZMIT','KOCAELI'],
          ['ANK','ANKARA'],['ANKARA','ANKARA'],['IST','ISTANBUL'],['İST','ISTANBUL'],['ISTANBUL','ISTANBUL'],
          ['IZM','IZMIR'],['İZM','IZMIR'],['IZMIR','IZMIR'],['BUR','BURSA'],['BURSA','BURSA'],
          ['ADA','ADANA'],['ADANA','ADANA'],['ANT','ANTALYA'],['ANTALYA','ANTALYA'],
          ['DIY','DIYARBAKIR'],['DIYARBAKIR','DIYARBAKIR'],['ELZ','ELAZIG'],['ELAZIG','ELAZIG'],
          ['URF','SANLIURFA'],['SANLIURFA','SANLIURFA'],['DEL MAR','DEL MAR'],['DELMAR','DEL MAR'],['SARATOGA','SARATOGA'],['WOODBINE','WOODBINE']
        ];
        const hit=aliases.find(([a])=>f.includes(fold(a)));
        return hit ? canonicalHippodrome(hit[1]) : '';
      }
      const inferredDates=names.map(metaDateFromName).filter(Boolean);
      const inferredHips=names.map(metaHipFromName).filter(Boolean);
      if(!inferredDates.length){
        for(const txt of helperMetaTexts){ const d=metaDateFromName(txt); if(d){inferredDates.push(d);break;} }
      }
      if(!inferredHips.length){
        for(const txt of helperMetaTexts){ const h=metaHipFromName(txt); if(h){inferredHips.push(h);break;} }
      }
      const wantedDate=inferredDates[0]||'';
      const wantedHip=inferredHips[0]||'';
      const desiredAltNo=Math.max(1,Number(altiliNo)||2);
      const candidates=(db?.files||[]).filter(f=>{
          if(!f) return false;
          // Manuel Yeni Beygir/yardımcı dosya ekleme, eski kayıt hangi QC durumunda olursa
          // olsun aynı tarih/hipodromdaki gerçek yarış kaydını bulabilmeli. Önceki sürüm
          // sadece record_type=PREDICTION_QC veya status=ACTIVE kayıtlarına bakıyordu;
          // sonuç güncellenmiş / QC etiketi değişmiş / dosya listesi farklı durumdaki
          // eski kayıtları görmeyip açılışta "ana bülten bulunamadı" hatası basıyordu.
          return (db?.races||[]).some(r=>String(r.file_id)===String(f.id));
        })
        .map(f=>{
          const sameDate=wantedDate && String(f.race_date||'')===wantedDate;
          const sameHip=wantedHip && canonicalHippodrome(f.hippodrome||'')===wantedHip;
          const sameAlt=(Number(f.altili_no)||1)===desiredAltNo;
          let score=0;
          if(sameDate) score+=1000;
          if(sameHip) score+=800;
          if(sameAlt) score+=300;
          if(f.record_type==='PREDICTION_QC') score+=150;
          if(f.status==='ACTIVE') score+=100;
          if(String(f.qc_status||'').includes('SONUÇ')) score+=80;
          score+=Number(f.sequence_no)||0;
          return {f,score,sameDate,sameHip,sameAlt};
        })
        .filter(x=>x.score>0)
        .sort((a,b)=>b.score-a.score);
      // Meta veri hiç bulunamadığında eski kod rastgele/yanlış davranabiliyordu.
      // Önce aktif + aynı Altılı kaydı, sonra en yeni gerçek yarış kaydı seçilir.
      // Tarih veya hipodrom bulunduysa ise bunlarla uyuşmayan kayıt asla seçilmez.
      let safeCandidates=candidates;
      if(wantedDate) safeCandidates=safeCandidates.filter(x=>x.sameDate);
      if(wantedHip) safeCandidates=safeCandidates.filter(x=>x.sameHip);
      if(!wantedDate && !wantedHip){
        const activeSameAlt=safeCandidates.filter(x=>x.sameAlt && (x.f.status==='ACTIVE' || x.f.record_type==='PREDICTION_QC'));
        if(activeSameAlt.length) safeCandidates=activeSameAlt;
        else {
          const sameAlt=safeCandidates.filter(x=>x.sameAlt);
          if(sameAlt.length) safeCandidates=sameAlt;
        }
      }
      safeCandidates.sort((a,b)=>b.score-a.score || (Number(b.f.sequence_no)||0)-(Number(a.f.sequence_no)||0));
      const picked=safeCandidates[0]?.f || null;
      if(picked){
        const races=(db.races||[]).filter(r=>String(r.file_id)===String(picked.id))
          .sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0)||(Number(a.id)||0)-(Number(b.id)||0));
        if(races.length){
          bulletinFile={
            file:{name:picked.original_filename||picked.filename||'MANUEL_DESTEK_KAYDI.ods'},
            payload:{
              file:JSON.parse(JSON.stringify(picked)),
              races:JSON.parse(JSON.stringify(races))
            }
          };
          bulletinKind='manual-layer';
          unknown.push(`ℹ️ Ana bülten yok; ${jockeyFiles.length} Jokey Performans, ${galopFiles.length} Galop dosyası mevcut ${picked.race_date} ${picked.hippodrome} kaydına eklendi.`);
        }
      }
    }
    // FINAL FIX5: Kullanıcı eski kayıt ekranda açıkken yalnız eksik katmanı tekrar
    // yükleyebilir. Böyle bir durumda klasörde ana TJK bülteninin yeniden bulunması
    // zorunlu değildir. Son ekranda açık/kayıtlı tahmin payload'ı güvenli yedektir;
    // yalnız gerçek yarış dizisi varsa ve istenen Altılı numarasıyla uyumluysa kullanılır.
    if(!bulletinFile){
      try{
        const live=window.__lastPredictionPayload;
        const liveRaces=Array.isArray(live?.races)?live.races:[];
        const liveAlt=Number(live?.file?.altili_no)||Number(liveRaces[0]?.altili_no)||1;
        if(liveRaces.length && liveAlt===Math.max(1,Number(altiliNo)||2)){
          bulletinFile={
            file:{name:live?.file?.original_filename||live?.file?.filename||'AÇIK_KAYIT.ods'},
            payload:JSON.parse(JSON.stringify(live))
          };
          bulletinKind='manual-layer';
          unknown.push('ℹ️ Ana bülten klasörde yok; eksik veri ekranda açık olan mevcut yarış kaydının üzerine işlendi.');
        }
      }catch(_e){}
    }
    // Açık payload yoksa Gün/Bülten Seç alanında seçili kayıt da aynı amaçla kullanılabilir.
    if(!bulletinFile){
      try{
        const selectedId=(typeof document!=='undefined'&&document.getElementById('tkpRecalcFileSelect'))
          ? String(document.getElementById('tkpRecalcFileSelect').value||'') : '';
        const selectedFile=selectedId?(db?.files||[]).find(f=>String(f.id)===selectedId):null;
        const selectedRaces=selectedFile?(db?.races||[]).filter(r=>String(r.file_id)===String(selectedFile.id)):[];
        const selectedAlt=Number(selectedFile?.altili_no)||Number(selectedRaces[0]?.altili_no)||1;
        if(selectedFile&&selectedRaces.length&&selectedAlt===Math.max(1,Number(altiliNo)||2)){
          bulletinFile={file:{name:selectedFile.original_filename||selectedFile.filename||'SEÇİLİ_KAYIT.ods'},payload:{file:JSON.parse(JSON.stringify(selectedFile)),races:JSON.parse(JSON.stringify(selectedRaces))}};
          bulletinKind='manual-layer';
          unknown.push('ℹ️ Ana bülten klasörde yok; eksik veri seçili kayıtlı yarışın üzerine işlendi.');
        }
      }catch(_e){}
    }
    if(!bulletinFile){
      const usableNames = (fileList||[]).map(f => f?.webkitRelativePath || f?.name || '').filter(Boolean).slice(0,12);
      throw new Error('Seçilen dosyalar arasında ana bülten bulunamadı. Aynı yarış daha önce kayıtlıysa Gün / Bülten Seç alanından o kaydı açıp eksik dosyaları tekrar yükle. Klasörde TJK Yarış Programı HTML / TJK Sonuç HTML / ODS ana dosyası yok veya yardımcı dosyalardan toplantı eşleştirmesi yapılamadı. Okunan örnek dosyalar: ' + usableNames.join(', '));
    }
  }

  const atrPreferredHip = atrFiles.some(x=>/del[\s_-]*mar/i.test(x.file?.name||'') || /\/Del-Mar\//i.test(x.text||'')) ? 'DEL MAR' : '';
  const atrRecordsPre=[];
  for(const x of atrFiles){ try{ atrRecordsPre.push(...tkpParseAtTheRacesRecords(x.text,x.file.name)); }catch(_e){} }

  let p = bulletinKind==='ods' || bulletinKind==='manual-layer' ? bulletinFile.payload
    : bulletinKind==='tjk' ? parseTjkProgramHTML(bulletinFile.text, bulletinFile.file.name, altiliNo, atrPreferredHip)
    : bulletinKind==='tjk-results' ? parseTjkResultsHTML(bulletinFile.text, bulletinFile.file.name, altiliNo)
    : parseBulletinHTML(bulletinFile.text, bulletinFile.file.name, altiliNo);
  if(atrRecordsPre.length>=6){
    const baseNames=new Set((p.races||[]).flatMap(r=>(r.horses||[]).map(h=>tkpAtrNormName(h.horse_name))));
    const atrHits=atrRecordsPre.reduce((n,r)=>n+(r.rows||[]).filter(x=>baseNames.has(x.nameKey)).length,0);
    // TJK Programı her zaman ana satır listesidir. ATR/yabancı destek yalnız TJK
    // tabanı hiç oluşmadıysa yedek ana kaynak olabilir; TJK satırlarını boş bir
    // zenginleştirme eşleşmesi yüzünden değiştirme.
    if(atrHits===0 && !(p?.races||[]).length){ const atrBuilt=tkpBuildFromAtrRecords(atrRecordsPre); if(atrBuilt) p=atrBuilt; }
  }
  p.file=p.file||{};
  p.file.altili_no=Number(p.file.altili_no)||altiliNo;
  p.file.altili_count=Math.max(1,Number(p.file.altili_count)||1);
  (p.races||[]).forEach(r=>{r.altili_no=p.file.altili_no;});
  _v25ClampJbyg850Top7Payload(p);

  let trLog=[];
  for(const x of trFiles){
    try{
      const fm={date:typeof tkpIsoDateFromLooseText==='function'?tkpIsoDateFromLooseText(x.file?.name||''):null,hip:typeof tkpHipFromLooseText==='function'?tkpHipFromLooseText(x.file?.name||''):null};
      const parsed=tkpParseGanyanCanavariTR(x.text,fm);
      // TANI: ayrıştırma sıfır kayıt üretirse (dosya boş değil ama hiç Kosu/At satırı
      // çözülemedi) bu durum eskiden sessizce "0 uygulama" olarak geçip giderdi ve
      // hiçbir yerde görünmezdi. Artık açıkça loglanıyor.
      if(!Array.isArray(parsed)||!parsed.length){
        const msg=`⚠️ ${x.file.name}: GC TR JSON/HTML ayrıştırıldı fakat 0 koşu/at satırı üretti (dosya biçimi beklenenden farklı olabilir).`;
        console.warn('[TKP] TR PUAN ayrıştırma boş sonuç',x.file?.name,{textPreview:String(x.text||'').slice(0,300)});
        trLog.push(msg);
      } else {
        trLog.push(...tkpApplyGanyanCanavariTR(p,parsed));
      }
    }
    catch(e){
      // KÖK FIX: önceki kod gerçek hatayı (e.message/stack) tamamen atıyordu; TR PUAN
      // canlı içe aktarmada boş kaldığında kullanıcı/geliştirici hiçbir yerde neden
      // olduğunu göremiyordu ("log yok" şikayetinin teknik karşılığı buydu). Artık
      // gerçek hata hem konsola (stack ile) hem trLog'a (kısa mesajla) yazılıyor.
      console.error('[TKP] TR PUAN uygulama hatası',x.file?.name,e);
      trLog.push(`⚠️ ${x.file.name}: TR puanı okunamadı — ${e?.message||e}; ana yükleme devam etti.`);
    }
  }
  let gcSupportLog=[];
  for(const x of gcGlpFiles){try{const fm={date:(typeof tkpIsoDateFromLooseText==='function'?tkpIsoDateFromLooseText(x.file?.name||''):null)||p?.file?.race_date||'',hip:(typeof tkpHipFromLooseText==='function'?tkpHipFromLooseText(x.file?.name||''):null)||p?.file?.hippodrome||'',name:x.file?.name||''};gcSupportLog.push(...tkpApplyGanyanCanavariGlpOzet(p,tkpParseGanyanCanavariGlpOzet(x.text,fm)).log);}catch(e){gcSupportLog.push(`⚠️ ${x.file.name}: Galoplar Özet okunamadı: ${e.message}`);}}
  for(const x of gcJbygFiles){try{const fm={date:(typeof tkpIsoDateFromLooseText==='function'?tkpIsoDateFromLooseText(x.file?.name||''):null)||p?.file?.race_date||'',hip:(typeof tkpHipFromLooseText==='function'?tkpHipFromLooseText(x.file?.name||''):null)||p?.file?.hippodrome||''};gcSupportLog.push(...tkpApplyGanyanCanavariJByg(p,tkpParseGanyanCanavariJByg(x.text,fm)).log);}catch(e){gcSupportLog.push(`⚠️ ${x.file.name}: GC J-BYG okunamadı: ${e.message}`);}}
  // Yeni Beygir yalnız GC birincil katmanından sonra çalışır. Uygulayıcılar GC
  // kaynaklı gerçek değerleri (özellikle gerçek J-BYG 0) korur ve başka alan
  // yazmaz; bu nedenle elle klasör yüklemede dahi kaynak önceliği değişmez.
  for(const x of ybGlpFiles){try{const fm={date:(typeof tkpIsoDateFromLooseText==='function'?tkpIsoDateFromLooseText(x.file?.name||''):null)||p?.file?.race_date||'',hip:(typeof tkpHipFromLooseText==='function'?tkpHipFromLooseText(x.file?.name||''):null)||p?.file?.hippodrome||'',name:x.file?.name||''};gcSupportLog.push(...tkpApplyYeniBeygirGlp(p,tkpParseYeniBeygirGlp(x.text,fm),fm).log);}catch(e){gcSupportLog.push(`⚠️ ${x.file.name}: Yeni Beygir GLP yedeği okunamadı: ${e.message}`);}}
  for(const x of ybJbygFiles){try{const fm={date:(typeof tkpIsoDateFromLooseText==='function'?tkpIsoDateFromLooseText(x.file?.name||''):null)||p?.file?.race_date||'',hip:(typeof tkpHipFromLooseText==='function'?tkpHipFromLooseText(x.file?.name||''):null)||p?.file?.hippodrome||'',name:x.file?.name||''};gcSupportLog.push(...tkpApplyYeniBeygirJByg(p,tkpParseYeniBeygirJByg(x.text,fm),fm).log);}catch(e){gcSupportLog.push(`⚠️ ${x.file.name}: Yeni Beygir J-BYG yedeği okunamadı: ${e.message}`);}}

  let atrLog=[];
  if(atrFiles.length){
    const records=atrRecordsPre.slice();
    for(const x of atrFiles){
      if(records.some(r=>r.filename===x.file.name)) continue;
      try{ const parsed=tkpParseAtTheRacesRecords(x.text,x.file.name); if(parsed.length) records.push(...parsed); else unknown.push(`${x.file.name} (ATR at satırı bulunamadı)`); }catch(e){ unknown.push(`${x.file.name} (ATR okunamadı: ${e.message})`); }
    }
    atrLog=tkpApplyAtrRecords(p,records);
  }

  let usaLog=[];
  if(nyraFiles.length||nyraWorkoutFiles.length||dmtcFiles.length||dmtcWorkoutFiles.length||equibaseFiles.length||clubHipicoFiles.length||foreignSupportFiles.length){
    const nyraRecords=[]; for(const x of nyraFiles){try{nyraRecords.push(...tkpParseNyraEntriesHTML(x.text,x.file.name));}catch(e){unknown.push(`${x.file.name} (NYRA okunamadı: ${e.message})`);}}
    const workoutRecords=[]; for(const x of nyraWorkoutFiles){try{workoutRecords.push(tkpParseNyraWorkoutsHTML(x.text,x.file.name));}catch(e){unknown.push(`${x.file.name} (NYRA workout okunamadı: ${e.message})`);}}
    const dmtcRecords=[]; for(const x of dmtcFiles){try{dmtcRecords.push(...tkpParseDmtcEntriesHTML(x.text,x.file.name));}catch(e){unknown.push(`${x.file.name} (DMTC okunamadı: ${e.message})`);}}
    const dmtcWorkouts=[]; for(const x of dmtcWorkoutFiles){try{dmtcWorkouts.push(tkpParseDmtcWorkoutsHTML(x.text,x.file.name));}catch(e){unknown.push(`${x.file.name} (DMTC workout okunamadı: ${e.message})`);}}
    const equibaseRecords=[]; for(const x of equibaseFiles){try{equibaseRecords.push(tkpParseEquibaseHTML(x.text,x.file.name));}catch(e){unknown.push(`${x.file.name} (Equibase okunamadı: ${e.message})`);}}
    const clubHipicoRecords=[]; for(const x of clubHipicoFiles){try{clubHipicoRecords.push(tkpParseClubHipicoHTML(x.text,x.file.name));}catch(e){unknown.push(`${x.file.name} (Club Hipico okunamadı: ${e.message})`);}}
    const foreignSupportRecords=[]; for(const x of foreignSupportFiles){try{foreignSupportRecords.push(tkpParseForeignSupportHTML(x.text,x.file.name,x.source));}catch(e){unknown.push(`${x.file.name} (yabancı destek okunamadı: ${e.message})`);}}
    usaLog=[...tkpApplyUsaData(p,nyraRecords,workoutRecords,equibaseRecords),...tkpApplyDmtcData(p,dmtcRecords,dmtcWorkouts),...tkpApplyClubHipicoData(p,clubHipicoRecords),...tkpApplyForeignSupportData(p,foreignSupportRecords)];
  }

  let jbygLog = [], galopLog = [], ypuanLog = [];
  function metricMatchScore(race, rec){
    let score = 0, nameHits = 0, noHits = 0;
    for (const h of (race.horses || [])){
      const base = String(h.horse_no || '').match(/^\d+/)?.[0] || '';
      const nm = baseHorseName(h.horse_name);
      if (nm && rec.ranksByName && rec.ranksByName[nm] != null){ score += 8; nameHits++; }
      else if (base && rec.ranks && rec.ranks[base] != null){ score += 1; noHits++; }
    }
    return {score, nameHits, noHits};
  }
  function hasJbygData(race){
    // 0/boş değer destek katmanı değildir. Aksi halde ayakta yedek eşleşme
    // “dolu” sanılıp hiç denenmiyordu.
    return (race?.horses || []).some(h => {
      const value=Number(h?.jbyg);
      return Number.isFinite(value)&&value>=1&&value<=7;
    });
  }
  function applyJbygRecordToRace(rec, race){
    const incomingSource=String(rec?._source||'');
    if(incomingSource!=='GANYAN_CANAVARI_JBYG')return 0;
    let applied = 0;
    const entries=(rec.entries||[]).map((e,i)=>({...e,rank:i+1}));
    const byNo=new Map(entries.filter(e=>e.no).map(e=>[String(e.no),e]));
    const byName=new Map(entries.filter(e=>e.name).map(e=>[baseHorseName(e.name),e]));
    const usedRanks=new Set();
    race.horses.forEach(h => {
      const base = String(h.horse_no).match(/^\d+/)?.[0] || '';
      const nm = baseHorseName(h.horse_name);
      // KÖK FIX: Jokey Performans sayfasının "No" sütunu, Program/Sonuç sayfasındaki
      // gerçek koşu numarasıyla HER ZAMAN örtüşmüyor (aynı at farklı kaynaklarda farklı
      // numarayla görünebiliyor). İSİM eşleşmesi daha güvenilir olduğu için önce o
      // denenir; numara yalnızca isim hiç bulunamazsa yedek olarak kullanılır. Aksi
      // halde numara tesadüfen BAŞKA bir atla çakışıp J-BYG'i yanlış ata yazabiliyordu.
      const entry=(nm&&byName.get(nm)) || (base&&byNo.get(base)) || null;
      const rank = entry ? entry.rank : ((nm && rec.ranksByName?.[nm] != null) ? rec.ranksByName[nm] : (base && rec.ranks?.[base] != null ? rec.ranks[base] : null));
      if (rank != null){
        const rv = Number(rank);
        if (Number.isFinite(rv) && rv >= 1 && rv <= 7){
          h.jbyg = Math.round(rv);
          h.jbyg_rank=Math.round(rv);h.team_strength_rank=Math.round(rv);
          if(entry && Number.isFinite(Number(entry.pct))){h.jbyg_rate=Number(entry.pct);h.team_strength_pct=Number(entry.pct);}
          if(incomingSource){h.jbyg_source=incomingSource;h.jbyg_asof_date=rec?._asofDate||p?.file?.race_date||'';}
          usedRanks.add(Math.round(rv));
          applied++;
        }
      }
    });
    // Bazı kaynaklarda 7. atın numarası eküri/işaret yüzünden değişebiliyor. İlk eşleşmede
    // 1-6 dolup 7 boş kaldıysa, kaynakta kalan tek kayıt ile yarışta henüz J-BYG almamış
    // tek aynı isim/numara adayı güvenli biçimde tamamlanır; başka ayağa taşınmaz.
    const missingEntries=entries.filter(e=>!usedRanks.has(e.rank));
    for(const e of missingEntries){
      const candidates=(race.horses||[]).filter(h=>h.jbyg==null && (
        (e.no && String(h.horse_no).match(/^\d+/)?.[0]===String(e.no)) ||
        (e.name && baseHorseName(h.horse_name)===baseHorseName(e.name))
      ));
      if(candidates.length===1){
        candidates[0].jbyg=e.rank;
        candidates[0].jbyg_rank=e.rank;candidates[0].team_strength_rank=e.rank;
        if(Number.isFinite(Number(e.pct))){candidates[0].jbyg_rate=Number(e.pct);candidates[0].team_strength_pct=Number(e.pct);}
        if(incomingSource){candidates[0].jbyg_source=incomingSource;candidates[0].jbyg_asof_date=rec?._asofDate||p?.file?.race_date||'';}
        usedRanks.add(e.rank); applied++;
      }
    }
    if(incomingSource&&race){race.support_layers={...(race.support_layers||{}),jbyg:{complete:applied>0,source:incomingSource,asof:rec?._asofDate||p?.file?.race_date||'',eligible:(rec?.entries||[]).length,applied,threshold:'>8.50',limit:7}};}
    return applied;
  }
  function chooseRaceForMetric(recordsRaceNo, rec){
    let best = null, bestScore = -999999, bestDetail = null;
    const hasAbsMatch = recordsRaceNo && p.races.some(r => Number(r._absRaceNo) === Number(recordsRaceNo));
    for (const race of p.races){
      const d = metricMatchScore(race, rec);
      let score = d.score;
      if (hasAbsMatch && Number(race._absRaceNo) === Number(recordsRaceNo)) score += 10000;
      // Bazı yardımcı dosyalarda "1. Koşu" göreli ayak gibi yazılabiliyor.
      // Mutlak koşu eşleşmesi yoksa ve isim/numara örtüşmesi de varsa leg yedeği kullanılır.
      if (recordsRaceNo && !hasAbsMatch && Number(race.leg) === Number(recordsRaceNo)) score += 250;
      // Yalnız at numarası varsa her yarışta 1-2-3 olabileceği için kör uygulama yapma:
      // en az 2 numara veya 1 isim eşleşmesi olsun.
      if (d.nameHits === 0 && d.noHits < 2 && !(hasAbsMatch && Number(race._absRaceNo) === Number(recordsRaceNo))) score -= 500;
      if (score > bestScore){ bestScore = score; best = race; bestDetail = d; }
    }
    return best ? {race:best, detail:bestDetail, score:bestScore} : null;
  }

  // J-BYG kayıtlarını önce eski/ana yöntemle uygula. Uygulanamayanları aşağıda güvenli
  // yedek yöntemle deneriz. Böylece eski doğru çalışan 3-4-5-6. ayaklar bozulmaz.
  const pendingJbygRecords = [];
  const allJbygRecords = [];
  for (const {file, text, source} of jockeyFiles){
    try {
      const records = parseJockeyPerformanceRecords(text);
      records.forEach(rec=>{rec._source=source==='GANYAN_CANAVARI_JBYG'?source:'DISABLED_JBYG_ARCHIVE';rec._asofDate=(typeof tkpIsoDateFromLooseText==='function'?tkpIsoDateFromLooseText(file?.name||''):null)||p?.file?.race_date||'';});
      records.forEach((rec,idx)=>allJbygRecords.push({file,rec,idx}));
      let fileApplied = 0;
      records.forEach((rec, recIdx) => {
        const picked = chooseRaceForMetric(rec.raceNo, rec);
        if (!picked || !picked.race || picked.score < 0){
          pendingJbygRecords.push({file, rec, recIdx});
          jbygLog.push(`⚠️ ${file.name}: ${rec.raceNo ? rec.raceNo + '. koşu için ' : ''}ana eşleşme zayıf; yedek eşleşmeye bırakıldı.`);
          return;
        }
        const race = picked.race;
        const applied = applyJbygRecordToRace(rec, race);
        fileApplied += applied;
        if (applied){
          rec._applied = true;
          rec._appliedLeg = race.leg;
        } else {
          pendingJbygRecords.push({file, rec, recIdx});
        }
        jbygLog.push(applied
          ? `✅ ${file.name}: ${race.leg}. ayağa${rec.raceNo ? ` (${rec.raceNo}. koşu)` : ''} ${applied} at için J-BYG işlendi.`
          : `⚠️ ${file.name}: ${race.leg}. ayak bulundu ama at eşleşmedi; yedek eşleşmeye bırakıldı.`);
      });
      if (!fileApplied && !records.length) jbygLog.push(`⚠️ ${file.name}: J-BYG dosyası okundu ama kayıt bulunamadı.`);
    } catch(e){ jbygLog.push(`❌ ${file.name}: ${e.message}`); }
  }

  // Güvenli yedek:
  // 1) Eğer J-BYG kaydı 1..6 gibi göreli ayak numarası taşıyorsa ve o ayak boşsa doğrudan o ayağa uygula.
  // 2) Hâlâ boş kalan ayaklar varsa, kaynak kayıt sırası ile boş ayak sırası birebir denenir.
  // Bu sadece BOŞ J-BYG ayaklara çalışır; dolu ayakların eski doğru değerlerini ezmez.
  if (pendingJbygRecords.length){
    const emptyLegs = () => p.races.filter(r => !hasJbygData(r));
    let backupApplied = 0;

    for (const item of pendingJbygRecords){
      if (item.rec._applied) continue;
      const rn = Number(item.rec.raceNo);
      const byLeg = Number.isFinite(rn) ? p.races.find(r => Number(r.leg) === rn && !hasJbygData(r)) : null;
      if (byLeg){
        const applied = applyJbygRecordToRace(item.rec, byLeg);
        if (applied){
          item.rec._applied = true;
          item.rec._appliedLeg = byLeg.leg;
          backupApplied += applied;
          jbygLog.push(`✅ ${item.file.name}: yedek göreli eşleşme ile ${byLeg.leg}. ayağa ${applied} J-BYG yazıldı.`);
        }
      }
    }

    const stillPending = pendingJbygRecords.filter(x => !x.rec._applied);
    const blanks = emptyLegs();
    stillPending.forEach((item, i) => {
      const race = blanks[i];
      if (!race || hasJbygData(race)) return;
      const d = metricMatchScore(race, item.rec);
      // İsim yoksa bile tablo sırası yedeği sadece ayak boşsa ve en az 2 at no eşleşiyorsa uygulanır.
      // Çok zayıfsa yine dokunma; yanlış ayakta J-BYG üretmek daha kötü.
      if (d.nameHits === 0 && d.noHits < 2) return;
      const applied = applyJbygRecordToRace(item.rec, race);
      if (applied){
        item.rec._applied = true;
        item.rec._appliedLeg = race.leg;
        backupApplied += applied;
        jbygLog.push(`✅ ${item.file.name}: yedek sıra/isim eşleşmesi ile ${race.leg}. ayağa ${applied} J-BYG yazıldı.`);
      }
    });

    const missing = p.races.filter(r => !hasJbygData(r)).map(r => r.leg);
    if (missing.length){
      jbygLog.push(`⚠️ J-BYG hâlâ boş ayaklar: ${missing.join(', ')}. Bu ayaklar için klasörde eşleşebilir Jokey/Antrenör başarı oranı tablosu bulunamadı veya tablo atlarla örtüşmedi.`);
    } else if (backupApplied){
      jbygLog.push(`✅ J-BYG yedek eşleşme tamam: boş ayak kalmadı.`);
    }
  }


  // KÖK J-BYG FIX: 2. Altılıda ayak no (1-6) ile TJK gerçek koşu no (örn. 4-9) karışırsa
  // J-BYG boş kalıyordu. Exportu değil, veri bağlama anahtarını düzelt: önce _absRaceNo,
  // sonra kayıt sırası, en sonda güvenli isim/numara skoru. Dolu ayaklara dokunma.
  (function finalJbygAbsRaceGuard(){
    const blanks=()=>p.races.filter(r=>!hasJbygData(r));
    if(!allJbygRecords.length || !blanks().length) return;
    let appliedTotal=0;
    function safeApply(item,race,label){
      if(!item || !race || hasJbygData(race) || item.rec._finalApplied) return 0;
      const d=metricMatchScore(race,item.rec);
      const absOk=item.rec.raceNo && Number(race._absRaceNo)===Number(item.rec.raceNo);
      const legOk=item.rec.raceNo && Number(race.leg)===Number(item.rec.raceNo);
      // Abs/leg eşleşmesi varsa isim skoru arama; yoksa en az 1 isim veya 2 numara örtüşmesi şart.
      if(!absOk && !legOk && d.nameHits===0 && d.noHits<2) return 0;
      const n=applyJbygRecordToRace(item.rec,race);
      if(n){
        item.rec._finalApplied=true; appliedTotal+=n;
        jbygLog.push(`✅ ${item.file.name}: ${label} ile ${race.leg}. ayağa${race._absRaceNo?` (TJK ${race._absRaceNo}. koşu)`:''} ${n} J-BYG yazıldı.`);
      }
      return n;
    }
    // 1) Mutlak koşu no doğrudan eşleşsin.
    for(const race of blanks()){
      const item=allJbygRecords.find(x=>!x.rec._finalApplied && x.rec.raceNo && Number(x.rec.raceNo)===Number(race._absRaceNo));
      safeApply(item,race,'mutlak koşu no eşleşmesi');
    }
    // 2) Kayıt listesi bütün günün koşu sırasıysa; _absRaceNo-1 indeksi kullan.
    for(const race of blanks()){
      const idx=Number(race._absRaceNo)-1;
      if(Number.isInteger(idx) && idx>=0 && idx<allJbygRecords.length) safeApply(allJbygRecords[idx],race,'TJK koşu sıra yedeği');
    }
    // 3) Sadece aktif altılı kayıtları geldiyse, boş ayak sırasına göre uygula.
    const remaining=allJbygRecords.filter(x=>!x.rec._finalApplied);
    const blankNow=blanks();
    if(remaining.length===blankNow.length){
      blankNow.forEach((race,i)=>safeApply(remaining[i],race,'aktif altılı sıra yedeği'));
    }
    if(appliedTotal){
      _v25ClampJbyg850Top7Payload(p);
    }
  })();

  for (const {file, text} of galopFiles){
    try {
      // Atlagel hiçbir koşulda GLP yazma kaynağı değildir. Sınıflandırma
      // kaçırsa bile son güvenlik kapısı veriyi uygulamadan önce durdurur.
      if(/atlagel/i.test(String(file?.name||'')+' '+String(text||''))){
        galopLog.push(`ℹ️ ${file.name}: Atlagel kaynağı kapalı; GLP yalnız Ganyan Canavarı Galoplar Özet'ten alınır.`);
        continue;
      }
      let {raceNo, ranks, ranksByNo, sourceDate} = parseGalopHTML(text);
      const fileRaceNo = raceNoFromLooseText(file?.name || '');
      // Eski yerel galop dosyaları yalnız arşiv uyumluluğu için okunabilir.
      if(!raceNo && fileRaceNo) raceNo = fileRaceNo;
      let applied = 0, matchedLeg = null;
      const targetRaces = raceNo ? p.races.filter(r => Number(r._absRaceNo) === Number(raceNo)) : p.races;
      for (const race of targetRaces){
        for (const h of race.horses){
          const baseNo = String(h.horse_no).match(/^\d+/)?.[0] || '';
          const bn = baseHorseName(h.horse_name);
          const rank = (baseNo && ranksByNo?.[baseNo] != null) ? ranksByNo[baseNo] : ranks[bn];
          if (rank != null){
            h.g800 = rank;
            h.g800_rank = rank;
            h.galop_rank = rank;
            if(sourceDate&&/GANYAN_CANAVARI/i.test(String(file?.name||'')+' '+String(text||''))){h.glp_source='GANYAN_CANAVARI_GALOPLAR_OZET';h.glp_asof_date=sourceDate;}
            applied++; matchedLeg = race.leg;
          }
        }
      }
      galopLog.push(applied ? `✅ ${file.name}: ${matchedLeg}. ayağa${raceNo ? ` (${raceNo}. koşu)` : ''} ${applied} at için 800 G/GLP işlendi.` : `⚠️ ${file.name}: eşleşen at bulunamadı${raceNo ? ` (${raceNo}. koşu hedeflendi)` : ''}. Dosya adı/at numarası kontrol edilmeli.`);
    } catch(e){ galopLog.push(`❌ ${file.name}: ${e.message}`); }
  }

  // YPUAN eşleştirmesi galop/J-BYG'den farklı: isim yerine doğrudan AYAK + AT NUMARASI
  // ile eşleşir, çünkü kaynak veri (YORUMCU_VERI pipeline) at ismini bilmiyor, sadece
  // ATNO'yu biliyor.
  // V1.1.139 SAFE MERGE (korunan kilit, V1.1.141): Elle/kayıtlı YPUAN önce uygulanır. Otomatik yorumcu
  // kaynakları yalnız seçili 2. Altılı ile GERÇEKTEN eşleşen koşularda üzerine yazar.
  // Önceki davranışta tek bir otomatik HTML dosyasının klasörde bulunması bile eski
  // YPUAN'ın tamamını siliyordu; yabancı sayfada kupon eşleşmezse değerler boş kalıyordu.
  for (const {file, text} of ypuanFiles){
    try {
      let {byLeg} = parseYpuanHTML(text);
      let applied = 0;
      for (const race of p.races){
        let legScores = byLeg[race.leg];
        if (!legScores) continue;
        race.horses.forEach(h => {
          let base = String(h.horse_no).match(/^\d+/)?.[0];
          if (base && legScores[base] != null){
            h.ypuan = legScores[base];
            h.ypuan_source = 'YPUAN_EXPORT';
            h.ypuan_sources = ['YPUAN_EXPORT'];
            applied++;
          }
        });
      }
      ypuanLog.push(applied ? `✅ ${file.name}: ${applied} at için YPUAN işlendi.` : `⚠️ ${file.name}: eşleşen at bulunamadı.`);
    } catch(e){ ypuanLog.push(`❌ ${file.name}: ${e.message}`); }
  }

  // Bi'Talih / atyarışı.com Editör Kuponları -- OTOMATİK YPUAN. Galop/J-BYG gibi
  // isimle değil, doğrudan MUTLAK koşu numarasıyla (_absRaceNo) eşleşir; bu yüzden
  // dosyada 1. Altılı'nın da 2. Altılı'nın da kuponları bulunsa fark etmez, sadece
  // p.races içindeki gerçek koşularla örtüşen ayaklar kullanılır, gerisi otomatik
  // göz ardı edilir. Elle YPUAN_export.html yüklenmişse (ypuanFiles) ve bu kaynaklar
  // da varsa, daha güvenilir olan bu otomatik kaynak ONA ÜSTÜN gelir (üzerine yazar).
  // A local File name, browser lastModified value or hand-uploaded HTML says
  // nothing about when a commentator card was seen.  The collector bridge keeps
  // its server-returned capture metadata in a WeakMap on the exact File object;
  // only that narrow sidecar can make a card eligible for a live evidence lock.
  // All other cards stay research/shadow-only while retaining the pre-existing
  // YPUAN behaviour below.
  const tkpCollectorCommentatorSource={atyarisi:'editor',bitalih:'bitalih',hipodrom:'hipodrom',misli:'misli',liderform:'liderform'};
  const tkpCollectorCommentatorHost={editor:'atyarisi.com',bitalih:'bitalih.com',hipodrom:'hipodrom.com',misli:'misli.com',liderform:'liderform.com.tr'};
  function tkpCollectorCommentatorProvenance(file,kind){
    const expectedSource=tkpCollectorCommentatorSource[kind];
    if(!expectedSource)return null;
    let raw=null;
    try{raw=typeof globalThis.tkpCollectorFileProvenance==='function'?globalThis.tkpCollectorFileProvenance(file):null;}catch(_){raw=null;}
    if(!raw||String(raw.source||'').trim().toLowerCase()!==expectedSource||raw.immutable_snapshot!==true)return null;
    if(String(raw.phase||'').trim().toLowerCase()!=='pre_race')return null;
    const sha=String(raw.sha256||'').trim().toLowerCase();
    const capturedAt=String(raw.captured_at||'').trim();
    const capturedMs=Date.parse(capturedAt);
    const canonicalSourceId=`collector:${expectedSource}:${sha}`;
    if(!/^[a-f0-9]{64}$/.test(sha)||!Number.isFinite(capturedMs)||String(raw.source_id||'')!==canonicalSourceId)return null;
    let parsedUrl=null;
    try{parsedUrl=new URL(String(raw.source_url||''));}catch(_){return null;}
    const host=String(parsedUrl.hostname||'').toLowerCase(),expectedHost=tkpCollectorCommentatorHost[expectedSource];
    if(parsedUrl.protocol!=='https:'||!expectedHost||(host!==expectedHost&&!host.endsWith(`.${expectedHost}`)))return null;
    return Object.freeze({source:expectedSource,source_id:canonicalSourceId,sha256:sha,captured_at:new Date(capturedMs).toISOString(),source_url:parsedUrl.href,phase:'pre_race',immutable_snapshot:true});
  }
  function tkpCollectorCardLivePreRace(card,provenance){
    if(!provenance)return false;
    const capturedMs=Date.parse(provenance.captured_at);
    const legs=Array.isArray(card?.legs)?card.legs:[];
    if(!Number.isFinite(capturedMs)||!legs.length)return false;
    for(const leg of legs){
      const no=Number(leg?.raceNo??leg?.relativeLeg);
      const race=(p.races||[]).find((row,index)=>Number(row?._absRaceNo??row?.race_no??row?.leg??index+1)===no)||(p.races||[]).find(row=>Number(row?.leg)===no);
      if(!race||(race.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0))return false;
      let start='';
      try{start=typeof globalThis.tkpPredictionSnapshotRaceStartAt==='function'?globalThis.tkpPredictionSnapshotRaceStartAt(race,{},false):'';}catch(_){start='';}
      const startMs=Date.parse(String(start||''));
      if(!Number.isFinite(startMs)||capturedMs>=startMs)return false;
    }
    return true;
  }
  let yorumcuLog = [];
  if (yorumcuFiles.length){
    let allCards = [];
    const importReport={policy:TKP_YPUAN_POLICY,date:p.file?.race_date||'',hippodrome:p.file?.hippodrome||'',files:[],races:[],at:new Date().toISOString()};
    for (const {file, text, kind} of yorumcuFiles){
      const fileReport={source:kind,name:file.name,parsed:0,matched:0,error:''};importReport.files.push(fileReport);
      try {
        const snapshotSource=_v25ReadyCouponSnapshotSource(file,text);
        const parser = kind === 'atyarisi' ? parseEditorKuponHTML
          : kind === 'misli' ? (snapshotSource==='misli'?(value=>parseReadyCouponSnapshot(value,'misli')):parseMisliKuponHTML)
          : kind === 'hipodrom' ? (snapshotSource==='hipodrom'?(value=>parseReadyCouponSnapshot(value,'hipodrom')):parseHipodromKuponHTML)
          : kind === 'liderform' ? parseLiderformExpertHTML
          : kind === 'twitter' ? parseTwitterPickHTML
          : kind === 'banko' ? parseBankoTahminlerHTML
          : parseBiTalihKuponHTML;
        const cards = parser(text);fileReport.parsed=cards.length;
        // A parser index ("bitalih-1") is not a human commentator identity.
        // Known anonymous ready-coupon feeds keep an explicit site-level identity
        // instead; the governance ledger still treats local HTML as historical /
        // unverified unless a collector supplied pre-race provenance separately.
        // 213'teki çalışan davranışı koru: gerçek yazar adı varsa onu kullan; yoksa
        // her kartı ayrı kimlikte tut. Site düzeyinde tek kimlik vermek aynı pist/başlangıçtaki
        // farklı yorumcu kartlarını dedupe sırasında tek karta düşürüyordu.
        const siteIdentity={banko:'banko:ready_coupon',twitter:'x:unverified_card'}[kind]||'';
        cards.forEach((c,index)=>{c.kind=kind;c.source=kind;c.author=c.author||siteIdentity||`${kind}-${index+1}`;c.readyCoupon=c.readyCoupon===true||READY_COUPON_SOURCES.has(kind);});
        if(kind==='liderform'){
          const selectedAlt=Math.max(1,Number(p?.file?.altili_no)||Number(altiliNo)||1);
          const byLeg=new Map((p.races||[]).map(r=>[Number(r.leg),Number(r._absRaceNo)]));
          cards.forEach(c=>{if(c.altiliNo&&Number(c.altiliNo)!==selectedAlt){c.legs=[];return;}c.legs=(c.legs||[]).map(l=>({...l,raceNo:byLeg.get(Number(l.relativeLeg||l.raceNo))||null})).filter(l=>l.raceNo!=null);});
        }
        if (!cards.length){ yorumcuLog.push(`⚠️ ${file.name}: altılı kupon kartı bulunamadı.`); continue; }
        const selectedAbs = new Set((p.races||[]).map(r=>Number(r._absRaceNo)).filter(Number.isFinite)),targetMeeting=p?.file?.hippodrome||p?.races?.[0]?.hippodrome||'';
        // Bi'Talih / Hipodrom / AtYarisi / Misli için V1.1.213'ün sağlam kuralına dön:
        // doğru toplantıda MUTLAK koşu numarası çakışan kart kullanılır. Tam 6/6 eşleşme
        // yalnız kartın tamamını seçili altılı ilan etmek için anlamlıdır; Y.PUAN'a geçerli
        // ortak ayakların girmesini engellemez. Liderform kendi altılı eşlemesini yukarıda yapar.
        const overlapSources=new Set(['bitalih','hipodrom','atyarisi','misli']);
        const matchedCards=dedupeReadyCouponCards(cards.filter(c=>readyCouponMeetingMatches(c,targetMeeting)&&(overlapSources.has(kind)?readyCouponOverlapsSelectedRaces(c,selectedAbs):(c.readyCoupon===true?readyCouponMatchesAltili(c,selectedAbs):(c.legs||[]).some(l=>selectedAbs.has(Number(l.raceNo)))))));
        fileReport.matched=matchedCards.length;
        matchedCards.forEach(c=>{c._tkp_selected_scope=readyCouponMatchesAltili(c,selectedAbs);});
        if (!matchedCards.length){
          const seenScopes = [...new Set(cards.map(c => (c.legs||[]).map(l=>l.raceNo).filter(x=>x!=null).join('-')).filter(Boolean))].slice(0,4).join(', ');
          const wantScope = [...selectedAbs].sort((a,b)=>a-b).join('-');
          yorumcuLog.push(`⚠️ ${file.name}: ${cards.length} kupon okundu ama seçili 2. Altılı (${wantScope}) ile eşleşmedi. Sayfadaki kupon kapsamı: ${seenScopes||'belirsiz'}.`);
          continue;
        }
        const weight = 1;
        const collectorProvenance=tkpCollectorCommentatorProvenance(file,kind);
        matchedCards.forEach(c => {c.weight=weight;c._tkp_collector_provenance=collectorProvenance;});
        allCards.push(...matchedCards);
        const maxCoverage=matchedCards.reduce((m,c)=>Math.max(m,readyCouponSelectedCoverage(c,selectedAbs)),0);
        yorumcuLog.push(`✅ ${file.name}: ${matchedCards.length}/${cards.length} yorumcu kartı bağlandı · seçili altılı kapsaması en çok ${maxCoverage}/6 ayak (mutlak koşu no; her yazar ayrı).`);
      } catch(e){ fileReport.error=String(e?.message||e);yorumcuLog.push(`❌ ${file.name}: ${e.message}`); }
    }
    if (allCards.length){
      // Each card is assessed independently.  A valid collector sidecar requires
      // a canonical source+SHA id, collector capture time and every selected leg's
      // explicit program start time.  We never use File mtime, card HTML timestamps
      // or a hand-uploaded file as a substitute.  Non-provenance cards are retained
      // as historical research only and cannot promote a commentator.
      try{
        for(const card of allCards){
            const provenance=card?._tkp_collector_provenance||null,live=tkpCollectorCardLivePreRace(card,provenance);card._tkp_live_pre_race=live;
            if(typeof globalThis.tkpCommentatorCaptureCards==='function'){
            const context=live
              ? {races:p.races,source_id:provenance.source_id,source_sha256:provenance.sha256,captured_at:provenance.captured_at,published_at:provenance.captured_at,mode:'live',collector_provenance:provenance,require_collector_provenance:true}
              : {races:p.races,historical:true,mode:'historical'};
            globalThis.tkpCommentatorCaptureCards([card],context);
            }
        }
      }catch(_){ }
      const byRace = aggregateYorumcuCards(allCards);
      const ypuanBreakdown=ypuanBreakdownByRace(allCards);
      const expertVotes=aggregateIndependentExpertVotes(allCards);
      const singleConsensus=aggregateReadyCouponSingleConsensus(allCards);
      let totalApplied = 0;
      for (const race of p.races){
        const scores = byRace[race._absRaceNo];
        if (!scores) continue;
        const selectedContributorRows=ypuanBreakdown[String(race._absRaceNo)]?.rows||ypuanBreakdown[race._absRaceNo]?.rows||[];
        // Y.PUAN ile GC TR PUAN aynı ata ait olsa bile iki bağımsız kanıttır.
        // Kaynak etiketi tutulmazsa tarihsel köprü h.ypuan'ı güvenilir saymıyor
        // ve ekranda gerçek Misli verisi varken 0/boş gösteriyordu.
        const ypuanSources=[...new Set(selectedContributorRows
          .map(row=>String(row?.source||'yorumcu').trim().toUpperCase())
          .filter(Boolean))];
        const sourceCounts={};selectedContributorRows.forEach(row=>{const src=String(row?.source||'yorumcu').trim().toUpperCase();sourceCounts[src]=(sourceCounts[src]||0)+1;});
        const ypuanSourceDivisor=1;
        race.ypuan_source_counts=sourceCounts;
        race.ypuan_contributor_count=selectedContributorRows.length;
        race.ypuan_policy=TKP_YPUAN_POLICY;
        importReport.races.push({leg:race.leg,raceNo:race._absRaceNo,contributors:selectedContributorRows.length,sourceCounts});
        const ypuanSource=ypuanSources.length?`COMMENTATOR:${ypuanSources.join('+')}`:'COMMENTATOR';
        let applied = 0;
        // Bu koşu için kupon verisi VARSA, o koşudaki TÜM atların YPUAN'ı burada
        // yeniden belirlenir -- hiçbir kaynakta seçilmeyen bir at (ör. CANEYMEN
        // vakası) açıkça null'a çekilir. Böylece galop/jokey/eski YPUAN gibi başka
        // bir adımdan kalma bayat bir değer sessizce ayakta kalamaz.
        race.horses.forEach(h => {
          const base = String(h.horse_no).match(/^\d+/)?.[0];
          const rawVal = base ? (scores[base] ?? null) : null;
          // Farklı yorumcu kaynaklarının ham puan toplamı sınırsız büyüyebilir
          // (çok sayıda TEK oyu üst üste birikince); bu, tek bir yorumcunun
          // aşırı yüksek ham toplamının ekranda diğer tüm sinyalleri ezmesini
          // engelleyen monoton kademeli bir ölçektir. Ham değer h.ypuan_raw'da
          // kaybolmadan saklanır.
          const val = rawVal==null ? null : (x=>x<=100 ? x/2 : (x<=200 ? 50+(x-100)/2.5 : 90+(x-200)/3))(rawVal);
          h.ypuan = val;
          h.ypuan_raw = rawVal;
          h.ypuan_source_divisor = val != null ? ypuanSourceDivisor : 0;
          h.ypuan_source = val != null ? ypuanSource : '';
          h.ypuan_sources = val != null ? ypuanSources.slice() : [];
          h.ypuan_contributor_count = val != null ? selectedContributorRows.length : 0;
          h.ypuan_breakdown = val != null ? ((ypuanBreakdown[String(race._absRaceNo)]?.byHorse||ypuanBreakdown[race._absRaceNo]?.byHorse||{})[base]||[]).map(x=>({...x})) : [];
          const vote=expertVotes[race._absRaceNo]?.byHorse?.[base]||null,totalExperts=expertVotes[race._absRaceNo]?.total||0;
          h.expert_consensus_total=totalExperts;
          h.expert_positive_votes=vote?.positive||0;
          h.expert_top2_votes=vote?.top2||0;
          h.expert_single_votes=vote?.single||0;
          h.expert_omission_votes=Math.max(0,totalExperts-(vote?.positive||0));
          h.expert_consensus_ratio=totalExperts?(vote?.positive||0)/totalExperts:0;
          h.expert_comments=vote?.comments||[];
          const readyTek=singleConsensus[race._absRaceNo]?.byHorse?.[base]||null;
          h.ready_coupon_single_site_count=readyTek?.siteCount||0;h.ready_coupon_single_sources=readyTek?.sources||[];h.ready_coupon_single_author_count=readyTek?.authorCount||0;h.ready_coupon_single_authors=readyTek?.authors||[];h.ready_coupon_single_consensus=readyTek?.actionable===true;h.ready_coupon_live_single_sites=singleConsensus[race._absRaceNo]?.liveSingleSites||[];
          if (val != null) applied++;
        });
        totalApplied += applied;
        yorumcuLog.push(`✅ ${race.leg}. ayağa (${race._absRaceNo}. koşu) ${applied} at için YPUAN işlendi · ${selectedContributorRows.length} bağımsız yorumcu · ${Object.entries(sourceCounts).map(([src,n])=>src+': '+n).join(', ')}.`);
      }
      if (!totalApplied) yorumcuLog.push('⚠️ Kuponlar okundu ama seçili 6 koşuyla eşleşen ayak bulunamadı.');
    }
    p.ypuan_import_report=importReport;
  }

  // Kaynağın tamamı gelmese de TJK ana at listesi korunur. Eksik alanları açıkça
  // işaretle; bu bilgi hem UI/diagnostic hem de algoritmanın nötr eksik-sinyal
  // davranışı için kullanılır. Burada hiçbir değer üretilmez ve hiçbir satır
  // filtrelenmez.
  const coverageFields=[
    ['ST/Kulvar',['start_no','st','start','kulvar','start_box']],
    ['KG',['weight_kg','kg','weight']],
    ['HNDKP',['hndkp','handicap','hp','hndkp_rank']],
    ['DERECE',['best_time']],
    ['GALOP',['g800','g800_rank','galop_rank','workout_800','workout_400','workout_600']],
    ['TR PUAN',['tr_ganyan','tr_puan']],
    ['Y.PUAN',['ypuan']],
    ['J-BYG',['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank']]
  ];
  const present=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&String(value).trim()!=='-';
  const baseSource=bulletinKind==='tjk'||bulletinKind==='tjk-results'?'TJK_PROGRAM':(bulletinKind==='ods'?'ODS':'MANUEL');
  (p.races||[]).forEach(r=>{
    const horses=Array.isArray(r.horses)?r.horses:[];
    const fields={};
    for(const [label,keys] of coverageFields){
      const filled=horses.filter(h=>keys.some(k=>present(h?.[k]))).length;
      fields[label]={filled,total:horses.length,status:filled===horses.length?'complete':(filled?'partial':'missing')};
    }
    r.data_quality={...(r.data_quality||{}),base_source:baseSource,total_horses:horses.length,fields,missing_policy:'KEEP_TJK_ROW_NEUTRAL_MISSING_FIELD_V1'};
    for(const h of horses){
      const missing=coverageFields.filter(([,keys])=>!keys.some(k=>present(h?.[k]))).map(([label])=>label);
      if(missing.length)h.data_missing_fields=missing;else delete h.data_missing_fields;
      h.data_base_source=baseSource;
    }
  });
  p.data_quality={...(p.data_quality||{}),base_source:baseSource,races:(p.races||[]).length,horses:(p.races||[]).reduce((n,r)=>n+(r.horses||[]).length,0),missing_policy:'KEEP_TJK_ROW_NEUTRAL_MISSING_FIELD_V1'};

  if(architectureJob&&typeof tkpFinishJob==='function')tkpFinishJob(architectureJob);
  return {p, log: [...trLog,...gcSupportLog, ...atrLog,...usaLog, ...jbygLog, ...galopLog, ...ypuanLog, ...yorumcuLog], unknown};
}

async function classifyAndMergeAllFiles(fileList){
  const first=await classifyAndMergeFiles(fileList,1);
  const count=Math.min(2,Math.max(1,Number(first?.p?.file?.altili_count)||1));
  const out=[first];
  for(let no=2;no<=count;no++){
    const next=await classifyAndMergeFiles(fileList,no);
    const sig=(x)=>JSON.stringify((x?.p?.races||[]).map(r=>[r._absRaceNo||r.leg,(r.horses||[]).map(h=>[String(h.horse_no),baseHorseName(h.horse_name)])]));
    if(!out.some(x=>sig(x)===sig(next))) out.push(next);
  }
  out.forEach((x,i)=>{
    x.p.file.altili_no=i+1;
    x.p.file.altili_count=out.length;
    (x.p.races||[]).forEach(r=>{r.altili_no=i+1;});
  });
  return out;
}

function inferAltiliNoFromFilename(filename){
  const raw=fold(String(filename||'')).replace(/[_.-]+/g,' ').replace(/\s+/g,' ').trim();
  let m=raw.match(/(?:^|\s)([12])\s*(?:ALTILI|6 LI|6LI)(?:\s|$)/)
    || raw.match(/(?:ALTILI|6 LI|6LI)\s*([12])(?:\s|$)/)
    || raw.match(/(?:^|\s)([12])\s*ALT(?:\s|$)/);
  return m ? Number(m[1]) : null;
}

function parseODSxml(xml, filename){
  let doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('ODS içeriği okunamadı.');
  let tables = [...doc.getElementsByTagNameNS('*','table')];
  let t = tables.find(x => fold(x.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0','name')) === 'RACE');
  if (!t) throw new Error('RACE sayfası bulunamadı.');
  let grid = [];
  for (const row of [...t.children].filter(x=>x.localName==='table-row')){
    let rr = [];
    for (const c of [...row.children].filter(x=>x.localName==='table-cell' || x.localName==='covered-table-cell')){
      let rep = +(c.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0','number-columns-repeated') || 1);
      let v = cellText(c);
      for (let i=0;i<Math.min(rep, 260-rr.length);i++) rr.push(v);
    }
    let rrep = +(row.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0','number-rows-repeated') || 1);
    for (let i=0;i<Math.min(rrep,20);i++) grid.push([...rr]);
  }
  let max = Math.max(...grid.map(r=>r.length));
  grid.forEach(r => { while (r.length<max) r.push(''); });

  let m = filename.match(/TKP[_ -]*(?:AI|AL)[_ -]*(\d{1,4})/i), seq = m ? +m[1] : null;
  let hip = (filename.split('-',2)[1] || '').replace(/\(\d+\).*$/,'').replace(/\.ods$/i,'');
  // Bülten tarihi yalnız başlık/etiket alanlarından okunur. Atların geçmiş yarış
  // tarihlerine bakılmaz; aksi halde 01.07, 02.07, 03.07 gibi yanlış tarihler oluşur.
  function odsDateValue(value){
    const s = String(value || '').trim();
    let d = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})(?:T[^\s]+)?\b/);
    if (d){
      const year=+d[1], month=+d[2], day=+d[3];
      if(year>=2020 && year<=2100 && month>=1 && month<=12 && day>=1 && day<=31)
        return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    d = s.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/);
    if (d){
      const day=+d[1], month=+d[2], year=+d[3];
      if(year>=2020 && year<=2100 && month>=1 && month<=12 && day>=1 && day<=31)
        return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }
    return null;
  }

  function tableGrid(table, maxRows=80, maxCols=100){
    const out=[];
    for (const row of [...table.children].filter(x=>x.localName==='table-row')){
      const rr=[];
      for (const c of [...row.children].filter(x=>x.localName==='table-cell'||x.localName==='covered-table-cell')){
        const rep=+(c.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0','number-columns-repeated')||1);
        const v=cellText(c);
        for(let i=0;i<Math.min(rep,maxCols-rr.length);i++) rr.push(v);
      }
      const rrep=+(row.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0','number-rows-repeated')||1);
      for(let i=0;i<Math.min(rrep,Math.max(0,maxRows-out.length));i++) out.push([...rr]);
      if(out.length>=maxRows) break;
    }
    return out;
  }

  // Y.PUAN sayfasındaki düz yazılmış toplam puanları doğrudan oku.
  // 1/3/5. ayaklar A-J, 2/4/6. ayaklar L-U bloklarındadır.
  const ypuanByLeg = {};
  const ypuanTable = tables.find(x => fold(x.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:table:1.0','name')) === 'Y.PUAN');
  if (ypuanTable){
    const yg = tableGrid(ypuanTable, 140, 24);
    // Sabit satır numarasına güvenme: her bloktaki ATNO/YPUAN başlığını bularak oku.
    const headerRows=[];
    yg.forEach((row,ri)=>{
      if(fold(row?.[0])==='ATNO' && fold(row?.[9])==='YPUAN') headerRows.push(ri);
    });
    headerRows.slice(0,3).forEach((headerRi,bi)=>{
      [[bi*2+1,0,9],[bi*2+2,11,20]].forEach(([leg,noCol,scoreCol])=>{
        const map=ypuanByLeg[leg]=ypuanByLeg[leg]||{};
        for(let ri=headerRi+1;ri<Math.min(headerRi+24,yg.length);ri++){
          const row=yg[ri]||[];
          if(ri>headerRi+1 && fold(row?.[noCol])==='ATNO') break;
          const no=String(row[noCol]||'').match(/^\d+/)?.[0];
          const score=n(row[scoreCol]);
          if(no && score!=null && Number.isFinite(Number(score))) map[no]=Number(score);
        }
      });
    });
  }

  let date = null;
  // RACE dahil bütün sayfalarda TARİH / YARIŞ TARİHİ etiketini ara.
  outerDateLabel:
  for (const table of tables){
    const tg=tableGrid(table);
    for (let ri=0;ri<tg.length;ri++) for(let ci=0;ci<(tg[ri]||[]).length;ci++){
      const rawCell=String(tg[ri][ci]||'').trim();
      const foldedCell=fold(rawCell);
      const label=foldedCell.replace(/[^A-Z0-9]/g,'');
      const isDateLabel=['TARIH','YARISTARIHI','BULTENTARIHI','PROGRAMTARIHI'].includes(label)
        || /(?:^|\s)(?:YARIS\s*TARIHI|BULTEN\s*TARIHI|PROGRAM\s*TARIHI|TARIH)\s*[:：-]/i.test(foldedCell);
      if(!isDateLabel) continue;
      // Bazı ODS'lerde etiket ve tarih aynı hücrededir: "TARİH: 01.07.2026".
      const sameCellDate=odsDateValue(rawCell);
      if(sameCellDate){ date=sameCellDate; break outerDateLabel; }
      const nearby=[tg[ri][ci+1],tg[ri][ci+2],tg[ri+1]?.[ci],tg[ri+1]?.[ci+1],tg[ri-1]?.[ci+1]];
      for(const v of nearby){ const found=odsDateValue(v); if(found){ date=found; break outerDateLabel; } }
    }
  }
  // Etiket hücre tablosuna düşmemiş olabilir. LibreOffice bazı birleşik/metin kutulu
  // başlıkları farklı XML düğümlerine yazar. Bu nedenle content.xml'in tüm görünen
  // metninde doğrudan "TARİH: gg.aa.yyyy" kalıbını da ara.
  if(!date){
    const allText=String(doc?.documentElement?.textContent || '').replace(/\u00a0/g,' ');
    const tagged=allText.match(/(?:YARIŞ\s*TARİHİ|YARIS\s*TARIHI|BÜLTEN\s*TARİHİ|BULTEN\s*TARIHI|PROGRAM\s*TARİHİ|PROGRAM\s*TARIHI|TARİH|TARIH)\s*[:：-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})/iu);
    if(tagged) date=odsDateValue(tagged[1]);
  }
  // Etiket yoksa yalnız ilk AYAK başlığından önceki üst bölümdeki tarihi kullan.
  if(!date){
    const firstHead=grid.findIndex(row=>row.some(v=>/^\d+\s*AYAK$/i.test(String(v).trim())));
    const headerRows=grid.slice(0, firstHead>=0 ? firstHead : Math.min(30,grid.length));
    const candidates=[];
    for(const row of headerRows) for(const v of row){ const found=odsDateValue(v); if(found) candidates.push(found); }
    if(candidates.length) date=candidates[0];
  }
  if(!date) throw new Error('ODS içinde bülten tarihi bulunamadı. Dosyada TARİH: gg.aa.yyyy alanı olmalıdır.');

  let heads = [];
  grid.forEach((row,ri) => row.forEach((v,ci) => {
    let a = String(v).trim().match(/^(\d+)\s*AYAK$/i);
    if (a) heads.push([+a[1], ri, ci]);
  }));

  let races = [], seen = new Set();
  for (const [leg,hr,hc] of heads.sort((a,b)=>a[0]-b[0])){
    if (seen.has(leg) || !grid[hr+1]) continue;
    seen.add(leg);
    let meta = grid[hr], hdr = grid[hr+1], mp = {};
    for (let c = Math.max(0,hc-1); c < Math.min(hdr.length, hc+35); c++){
      let h = fold(hdr[c]);
      if (h && !mp[h]) mp[h] = c;
    }
    let no = (leg%2===1 ? 0 : 13), name = (leg%2===1 ? 1 : 14), winnerCol = (leg%2===1 ? 12 : 25);
    let res = mp['SONUÇ'] ?? mp['SONUC'];
    if (res == null) continue;
    // HNDKP ve "S" sütunları dosyadan dosyaya farklı başlık metni taşıyabiliyor (bazen "HNDKP",
    // bazen "38-39-40-41", bazen "15,5" gibi at kategorisine özgü bir not yazılmış olabiliyor).
    // Bu yüzden başlık metnine değil, şablondaki SABİT sütun sırasına göre buluyoruz:
    // NO, isim, J-BYG, AGF, 800G, HNDKP(+4), TR, VALUE, SP, S(+8), *, SONUÇ(+10)
    let hndkpPos = name + 4, sPos = name + 8;
    let agf = mp['AGF'],
        g800 = mp['400 G'] ?? mp['400G'] ?? mp['800 G'] ?? mp['800G'] ?? mp['800'],
        sv = sPos, tr = mp['TR'], val = mp['VALUE'] ?? mp['VAKUE'], sp = mp['SP'], hnd = mp['HNDKP'] ?? mp['TRACE'] ?? hndkpPos;
    let starCol = mp['*'] ?? (res - 1);
    let horses = [], blank = 0;
    for (let r=hr+2; r<grid.length; r++){
      let row = grid[r];
      if (row.some(x => /^\d+\s*AYAK$/i.test(String(x).trim()))) break;
      let hn = norm(row[no] ?? ''), nm = norm(row[name] ?? '');
      if (!hn && !nm){ if (++blank>=2) break; continue; }
      blank = 0;
      if (!nm || !/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(nm)) continue;
      const agfValue = standardAgfValue(n(row[agf]));
      const trValue = n(row[tr]);
      const baseNo=String(hn).match(/^\d+/)?.[0]||'';
      const ypuanValue=ypuanByLeg[leg]?.[baseNo] ?? null;
      const jbygCol = mp['J-BYG'] ?? mp['J BYG'] ?? mp['J.BYG'] ?? mp['JBYG'] ?? mp['J-BEYGİR'] ?? mp['J BEYGİR'] ?? mp['J-BEYGIR'] ?? mp['J BEYGIR'] ?? mp['JOKEY-BEYGİR'] ?? mp['JOKEY BEYGİR'] ?? (name+1);
      const finishCandidates=[winnerCol,res+1].filter((v,i,a)=>Number.isInteger(v)&&a.indexOf(v)===i);
      const finishPos=finishCandidates.map(c=>officialFinishPosition(row[c])).find(v=>v!=null) ?? null;
      horses.push({
        horse_no: hn, horse_name: nm,
        // V1.1.329: ODS'deki fiziksel satır sırası ayrı bir sinyaldir. Mevcut
        // TR/AGF/VALUE vb. alanların yerine geçmez ve eski kayıtlarda null kalabilir.
        ods_row_order: horses.length + 1,
        agf: agfValue, jbyg:(()=>{ const _j=n(row[jbygCol]); return Number.isFinite(Number(_j)) && Number(_j)>=1 && Number(_j)<=7 ? Math.round(Number(_j)) : null; })(), g800: n(row[g800]), hndkp: n(row[hnd]), s_value: n(row[sv]),
        // ODS düzeni değişmez. Bu sütun yalnız ODS'nin kendi `tr` alanıdır;
        // Ganyan Canavarı program-p katmanı ayrı dosyadan birleştirilir.
        tr: trValue,
        value_score: n(row[val]) ?? ypuanValue, value_raw: norm(row[val] ?? ''),
        sp: n(row[sp]), result_score: n(row[res]), star_value: null,
        bmb: fold(row[val] ?? '') === 'BMB' ? 1 : 0,
        ypuan: ypuanValue,
        finish_position: finishPos,
        winner: finishPos === 1 ? 1 : 0
      });
    }
    let condition = norm(hdr[name] ?? '');
    races.push(normalizeRaceObj({
      id: Date.now()+leg, file_id:null, sequence_no:seq, filename, race_date:date, hippodrome:hip,
      leg, distance:n(meta[hc+2]), surface:meta[hc+3], breed:meta[hc+4], condition_text:condition, horses, active:1
    }));
  }
  const inferredAltiliNo=inferAltiliNoFromFilename(filename);
  return _v25ClampJbyg850Top7Payload({ file:{sequence_no:seq, filename, race_date:date, hippodrome:canonicalHippodrome(hip), altili_no:inferredAltiliNo, altili_count:inferredAltiliNo?2:1}, races });
}


function _v25ClampJbyg850Top7ForRace(r){
  if(!r || !Array.isArray(r.horses)) return r;
  for(const h of r.horses){
    const j = Number(h && h.jbyg);
    if(!Number.isFinite(j) || j < 1 || j > 7) h.jbyg = null;
    const g = Number(h && h.g800);
    if(!Number.isFinite(g) || g < 1 || g > 6) h.g800 = null;
  }
  return r;
}
function _v25ClampJbyg850Top7Payload(p){
  if(p && Array.isArray(p.races)) p.races.forEach(_v25ClampJbyg850Top7ForRace);
  return p;
}


function tkpResultRaceAlignmentEvidence(incoming,target){
  if(!incoming||!target)return {score:-1e9,nameHits:0,exactHits:0,ratio:0,absMatch:false,legMatch:false,trustworthy:false};
  const incomingHorses=(incoming.horses||[]).filter(Boolean);
  const targetHorses=(target.horses||[]).filter(Boolean);
  const byName=new Map();
  for(const horse of targetHorses){
    const name=baseHorseName(horse?.horse_name||'');
    if(!name)continue;
    if(!byName.has(name))byName.set(name,[]);
    byName.get(name).push(horse);
  }
  let nameHits=0,exactHits=0;
  for(const horse of incomingHorses){
    const name=baseHorseName(horse?.horse_name||'');
    const matches=name?(byName.get(name)||[]):[];
    if(!matches.length)continue;
    nameHits++;
    if(matches.some(row=>String(row?.horse_no||'')===String(horse?.horse_no||'')))exactHits++;
  }
  const denom=Math.max(1,Math.min(incomingHorses.length||1,targetHorses.length||1));
  const ratio=nameHits/denom;
  const absMatch=incoming?._absRaceNo!=null&&target?._absRaceNo!=null&&Number(incoming._absRaceNo)===Number(target._absRaceNo);
  const legMatch=Number(incoming?.leg)>0&&Number(incoming.leg)===Number(target?.leg);
  let score=nameHits*24+exactHits*10+Math.round(ratio*80)+(absMatch?45:0)+(legMatch?22:0);
  if(!incomingHorses.length&&(absMatch||legMatch))score+=30;
  if(nameHits===0&&incomingHorses.length&&targetHorses.length)score-=80;
  const trustworthy=incomingHorses.length===0
    ? Boolean(absMatch||legMatch)
    : Boolean(nameHits>=2||ratio>=0.30||(nameHits>=1&&absMatch&&legMatch));
  return {score,nameHits,exactHits,ratio,absMatch,legMatch,trustworthy};
}

function tkpResultRaceSortValue(race,index){
  const abs=Number(race?._absRaceNo),leg=Number(race?.leg);
  if(Number.isFinite(abs)&&abs>0)return abs*1000+index;
  if(Number.isFinite(leg)&&leg>0)return leg*1000+index;
  return 900000+index;
}

function tkpAlignIncomingResultRaces(incomingRaces,targetRaces,options={}){
  const incomingList=Array.isArray(incomingRaces)?incomingRaces:[];
  const targetList=Array.isArray(targetRaces)?targetRaces:[];
  const out=new Map(),evidenceByIncoming=new Map(),ordinalFallback=new Set();
  const unusedTargets=new Set(targetList.map((_,index)=>index));
  const unmatchedIncoming=[];
  for(const incoming of incomingList){
    let bestIndex=-1,best=null;
    for(const index of unusedTargets){
      const evidence=tkpResultRaceAlignmentEvidence(incoming,targetList[index]);
      if(!best||evidence.score>best.score){best=evidence;bestIndex=index;}
    }
    if(bestIndex>=0&&best?.trustworthy){
      out.set(incoming,targetList[bestIndex]);
      evidenceByIncoming.set(incoming,best);
      unusedTargets.delete(bestIndex);
    }else unmatchedIncoming.push(incoming);
  }
  // Collector hedef file_id'yi açıkça verdiğinde toplantı kimliği zaten kanıtlanmıştır.
  // Eski arşivlerde leg/_absRaceNo kaymış, at adları ise kaynak karakter farklarıyla
  // örtüşmemiş olabilir. İki tarafta kalan yarış sayısı eşitse resmi sonuç sırasını
  // göreli sırayla bağla. Bu fallback sadece zorlanmış hedefte açılır; normal manuel
  // importta yanlış 1./2. Altılıya sonuç taşıyamaz.
  if(options.allowOrdinalFallback&&unmatchedIncoming.length&&unmatchedIncoming.length===unusedTargets.size){
    const orderedIncoming=unmatchedIncoming.map((race,index)=>({race,index})).sort((a,b)=>tkpResultRaceSortValue(a.race,a.index)-tkpResultRaceSortValue(b.race,b.index));
    const orderedTargets=[...unusedTargets].map((index,order)=>({index,race:targetList[index],order})).sort((a,b)=>tkpResultRaceSortValue(a.race,a.order)-tkpResultRaceSortValue(b.race,b.order));
    for(let i=0;i<orderedIncoming.length;i++){
      const incoming=orderedIncoming[i].race,target=orderedTargets[i]?.race;
      if(!target)continue;
      out.set(incoming,target);
      evidenceByIncoming.set(incoming,{...tkpResultRaceAlignmentEvidence(incoming,target),ordinalFallback:true,trustworthy:true});
      ordinalFallback.add(incoming);
      unusedTargets.delete(orderedTargets[i].index);
    }
  }
  out.evidenceByIncoming=evidenceByIncoming;
  out.ordinalFallback=ordinalFallback;
  return out;
}

function resultMeetingRecordStatus(p){
  const date=String(p?.file?.race_date || p?.races?.[0]?.race_date || '').trim();
  const hip=canonicalHippodrome(p?.file?.hippodrome || p?.races?.[0]?.hippodrome || '');
  const alt=Number(p?.file?.altili_no)||0;
  if(!date || !hip) return {date,hip,targetFile:null,targetRaces:[],alreadyRecorded:false};
  const forcedTargetId=String(p?.file?._target_file_id || (typeof window!=='undefined'?window.__tkpForceResultTargetFileId:'') || '').trim();
  if(forcedTargetId){
    const forcedFile=db.files.find(f=>String(f.id)===forcedTargetId);
    if(forcedFile){
      const targetRaces=db.races.filter(r=>String(r.file_id)===forcedTargetId);
      return {date,hip,targetFile:forcedFile,targetRaces,alreadyRecorded:false,fullResults:false,matchReason:'FORCED_FILE'};
    }
  }
  let meetingFiles=db.files.filter(f =>
    String(f.race_date||'')===date && canonicalHippodrome(f.hippodrome||'')===hip
  );
  if(alt){
    const exactAlt=meetingFiles.filter(f=>(Number(f.altili_no)||1)===alt);
    if(exactAlt.length) meetingFiles=exactAlt;
  }
  // R16.81 izolasyonu: sonuç akışı 2. Altılı hedefler. Aynı tarih+hipodromda
  // yalnız 1. Altılı kaydı varsa hedefe YAZILMAZ; sessizce yanlış kayda düşmek
  // yerine açık WRONG_ALTILI durumu döner.
  if(alt===2){
    const altTwoFiles=meetingFiles.filter(f=>Number(f?.altili_no||0)===2);
    if(!altTwoFiles.length) return {date,hip,targetFile:null,targetRaces:[],alreadyRecorded:false,matchReason:'WRONG_ALTILI'};
    meetingFiles=altTwoFiles;
  }
  const overlapScore=(f)=>{
    const races=db.races.filter(r=>r.file_id===f.id);
    const targetAlt=(f.altili_no==null || f.altili_no==='') ? null : Number(f.altili_no);
    let score=(f.record_type==='PREDICTION_QC'?100:0)+((alt && targetAlt!=null && targetAlt===alt)?100:0);
    const aligned=tkpAlignIncomingResultRaces(p?.races||[],races);
    for(const [incoming,target] of aligned){
      const evidence=tkpResultRaceAlignmentEvidence(incoming,target);
      score+=Math.max(0,evidence.score);
    }
    return score;
  };
  const ranked=meetingFiles.map(file=>({file,score:overlapScore(file)})).sort((a,b)=>b.score-a.score);
  const ambiguous=ranked.length>1 && (ranked[0].score<6 || ranked[0].score===ranked[1].score);
  const targetFile=ambiguous ? null : (ranked[0]?.file||null);
  if(!targetFile) return {date,hip,targetFile:null,targetRaces:[],alreadyRecorded:false,matchReason:ambiguous?'AMBIGUOUS':'NOT_FOUND'};
  const targetRaces=db.races.filter(r=>r.file_id===targetFile.id);
  const fullResults=targetRaces.length===6 && targetRaces.every(r=>resultRaceQuality(r).complete);
  // Sonuç tekrar yüklenirse güvenli biçimde yeniden yazılabilsin. Önceki sürüm "OK"
  // gördüğünde komple atlıyordu; yanlış işlenmiş sonuç/Accurate sonrası kullanıcı
  // doğru TJK HTML/ODS yüklese bile düzeltilemiyordu. Güncelleme idempotenttir.
  const alreadyRecorded=false;
  return {date,hip,targetFile,targetRaces,alreadyRecorded,fullResults,matchReason:'EXACT_OR_UNIQUE'};
}

async function confirmImport(){
  if (!previewPayload) return;
  let {p, fp} = previewPayload;
  // V1.1.225 HIZ MİMARİSİ KÖK FIX: snapshotTop() burada tam kural madenciliğini
  // (buildRules(), gerçek arşivde ~29 sn) her onayda ZORUNLU kılıyordu. snapshotTopPeek()
  // yalnız hazır önbellek varsa ucuz karşılaştırır; yoksa aşağıdaki log satırı sessizce atlanır.
  let before = snapshotTopPeek();
  const incomingQuality=resultPayloadQuality(p);
  // Güncelleme katmanlıdır: dosya yalnız resmi ikramiye/bahis verisi taşıyorsa da
  // mevcut kazananları silmeden kabul edilir. Aynı kayıt daha sonra tekrar yüklenebilir.
  let validRaces = p.races.filter(r => resultRaceQuality(r).winnerCount>0 || resultRaceHasSupplementalData(r));
  let skipped = p.races.length - validRaces.length;
  const resultPartial=!incomingQuality.full;

  // SONUÇ HTML ÖZEL AKIŞI
  // Sonuç bülteni daha önce kaydedilmiş aynı tarih + hipodrom tahminini bulur ve
  // YENİ kayıt açmadan onun üzerine yalnızca sonuç/bülten alanlarını işler.
  // Böylece Y.PUAN, 800G, J-BYG, BMB/ODB, VALUE, SP ve kullanıcı düzeltmeleri
  // boş/null sonuç verisiyle asla ezilmez.
  if (String(p.file?.import_kind||'').startsWith('RESULT_')){
    const resultState=resultMeetingRecordStatus(p);
    const {date,hip,targetFile,targetRaces,matchReason}=resultState;

    const incomingUpdateability=resultPayloadUpdateability(p);
    if(!incomingUpdateability.hasAnything){
      const msg='Dosyada kazanan/sıralama veya resmi ikramiye verisi bulunamadı. Yeni kayıt oluşturulmadı, mevcut kayıt da değiştirilmedi.';
      setPreviewPayload(null);
      $('#historyPreview').innerHTML = `<div class="card" style="border-left:5px solid #dc2626;"><b>Sonuç kaydedilmedi.</b><br>${esc(msg)}</div>`;
      if ($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent = msg;
      if ($('#resultBulletinFile')) $('#resultBulletinFile').value='';
      log('RESULT', msg);
      return;
    }

    if (targetFile){
      const historicalTop5Only=Boolean(typeof window!=='undefined'&&window.__tkpHistoricalTop5Only);
      const raceByLeg=new Map(targetRaces.map(r=>[Number(r.leg),r]));
      const raceByAbs=new Map(targetRaces.filter(r=>r._absRaceNo!=null).map(r=>[Number(r._absRaceNo),r]));
      // TJK'nin 1./2. Altılı koşu numarası veya eski arşivin leg/_absRaceNo alanı
      // kaymış olabilir. Önce bütün altı ayağı at isimlerinin örtüşmesiyle bire bir
      // hizala; sonra sonuçları yalnız bu doğrulanmış hedef yarışlara yaz.
      const forcedResultTarget=Boolean(String(p?.file?._target_file_id||'').trim()||matchReason==='FORCED_FILE');
      const alignedResultRaces=tkpAlignIncomingResultRaces(validRaces,targetRaces,{allowOrdinalFallback:forcedResultTarget});
      const updated=[];
      let matchedHorses=0, appendedHorses=0, changedFields=0;
      const isMissingResultValue=(value)=>value===null||value===undefined||String(value).trim()===''||String(value).trim()==='-';
      const setIfMissing=(obj,key,value)=>{
        if(!obj||isMissingResultValue(value)||!isMissingResultValue(obj[key])) return false;
        obj[key]=value; changedFields++; return true;
      };

      for (const incomingRace of validRaces){
        const raceChangedBefore=changedFields;
        const alignedTarget=alignedResultRaces.get(incomingRace)||null;
        let targetRace=alignedTarget
          || (incomingRace._absRaceNo!=null ? raceByAbs.get(Number(incomingRace._absRaceNo)) : null)
          || raceByLeg.get(Number(incomingRace.leg));
        const alignedEvidence=alignedResultRaces.evidenceByIncoming?.get(incomingRace)||null;
        const raceAlignmentTrusted=Boolean(alignedTarget&&(alignedEvidence?.trustworthy||alignedResultRaces.ordinalFallback?.has(incomingRace)));
        // abs/leg fallback yalnız at isimleri de makul biçimde örtüşüyorsa kabul
        // edilir. Zorlanmış file_id için göreli-sıra fallback'i zaten toplantı kimliğiyle
        // doğrulanmıştır ve burada tekrar reddedilmez.
        if(targetRace&&!raceAlignmentTrusted&&!tkpResultRaceAlignmentEvidence(incomingRace,targetRace).trustworthy){
          targetRace=null;
        }
        if (!targetRace){
          if(historicalTop5Only) continue; // Eski arşivde yeni ayak/at yaratma; manuel kayıt yapısını koru.
          // Kayıtta eksik ayak varsa sonuç HTML'den eklenir; bu yeni bir DOSYA değil,
          // aynı toplantının eksik ayağıdır.
          targetRace=JSON.parse(JSON.stringify(incomingRace));
          targetRace.id=Math.max(0,...db.races.map(r=>Number(r.id)||0))+1;
          targetRace.file_id=targetFile.id;
          targetRace.filename=targetFile.filename;
          targetRace.active=1;
          normalizeRaceObj(targetRace);
          db.races.push(targetRace);
          raceByLeg.set(Number(targetRace.leg),targetRace);
          if(targetRace._absRaceNo!=null) raceByAbs.set(Number(targetRace._absRaceNo),targetRace);
          updated.push(targetRace);
          appendedHorses+=(targetRace.horses||[]).length;
          continue;
        }

        if(!historicalTop5Only){
          // Normal sonuç akışında yarış üst bilgileri güncellenebilir.
          for (const key of ['distance','surface','breed','condition_text']) setIfMissing(targetRace,key,incomingRace[key]);
          setIfMissing(targetRace,'race_date',date);
          setIfMissing(targetRace,'hippodrome',p.file.hippodrome);
        }
        // Resmî ikramiye ve oynanabilir bahis katmanı sonuç bakımında da yazılır.
        // historicalTop5Only yalnız yeni at/ayak yaratmayı ve yarış öncesi zenginleştirmeyi
        // engeller; TJK Sonuç HTML'indeki parasal sonuçlar eski kayıtta eksik kalmamalı.
        if (Array.isArray(incomingRace.payouts) && incomingRace.payouts.length && (!Array.isArray(targetRace.payouts)||!targetRace.payouts.length)){ targetRace.payouts = incomingRace.payouts; changedFields++; }
        if (Array.isArray(incomingRace.available_bets) && incomingRace.available_bets.length && (!Array.isArray(targetRace.available_bets)||!targetRace.available_bets.length)){ targetRace.available_bets = incomingRace.available_bets.slice(); changedFields++; }
        targetRace.active=resultRaceQuality(targetRace).winnerCount>0 ? 1 : (targetRace.active||0);

        // V1.1.292: otomatik/arka plan sonuç bakımı tamamen incremental'dır.
        // Mevcut dolu resmi derece/kazanan alanları silinmez veya yeniden yazılmaz;
        // yalnız gerçekten eksik İlk-5/sonuç alanları tamamlanır.
        const incomingRaceQuality=resultRaceQuality(incomingRace);
        const incomingDepth=Number(incomingRace?.result_verified_depth)||0;
        const targetDepth=Number(targetRace?.result_verified_depth)||0;
        const incomingVerified=String(incomingRace?.result_integrity_status||'')==='VERIFIED'&&incomingDepth>0;
        const targetVerified=String(targetRace?.result_integrity_status||'')==='VERIFIED'&&targetDepth>0;
        // Yeni doğrulanmış resmî sıra, eski doğrulanmamış sonucu düzeltmeye yetkilidir.
        // Daha sığ (ör. yalnız ilk 2) yeni kanıt, mevcut ilk 5 doğrulamasını geriye götürmez.
        const authoritativeOrder=incomingVerified&&(!targetVerified||incomingDepth>=targetDepth);
        if(authoritativeOrder){
          for(const oldHorse of (targetRace.horses||[])){oldHorse.finish_position=null;oldHorse.winner=0;oldHorse.result_time='';oldHorse.official_time='';}
          targetRace.result_verified_depth=incomingDepth;
          targetRace.result_integrity_source=incomingRace.result_integrity_source||'TJK_OFFICIAL_RESULT_ROWS';
          targetRace.result_integrity_status='VERIFIED';
          changedFields++;
        }else if(!targetVerified&&!incomingVerified){
          targetRace.result_verified_depth=0;
          targetRace.result_integrity_source='';
          targetRace.result_integrity_status=incomingRace?.result_integrity_status||'UNVERIFIED';
        }
        const exactMap=new Map((targetRace.horses||[]).map(h=>[String(h.horse_no),h]));
        const nameMap=new Map();
        for(const h of (targetRace.horses||[])){
          const key=baseHorseName(h.horse_name);
          if(!nameMap.has(key)) nameMap.set(key,[]);
          nameMap.get(key).push(h);
        }
        const baseGroups=new Map();
        for (const h of (targetRace.horses||[])){
          const key=String(ekuriBase(h.horse_no));
          if(!baseGroups.has(key)) baseGroups.set(key,[]);
          baseGroups.get(key).push(h);
        }
        const usedTargets=new Set();

        for (const incomingHorse of (incomingRace.horses||[])){
          const exactCandidate=exactMap.get(String(incomingHorse.horse_no));
          const incomingName=baseHorseName(incomingHorse.horse_name);
          const exactName=baseHorseName(exactCandidate?.horse_name||'');
          // Yarışın kendisi isim örtüşmesiyle veya zorlanmış file_id + göreli sıra ile
          // doğrulandıktan sonra at numarası o yarış içinde güvenilir anahtardır.
          // Yalnız doğrulanmamış abs/leg fallback'inde açık isim çelişkisini reddet.
          const exact=exactCandidate&&(raceAlignmentTrusted||!incomingName||!exactName||incomingName===exactName)?exactCandidate:null;
          let targetHorse=exact;
          if (!targetHorse){
            const byBase=(baseGroups.get(String(ekuriBase(incomingHorse.horse_no)))||[]).filter(h=>!usedTargets.has(h));
            const sameNameInBase=byBase.filter(h=>baseHorseName(h.horse_name)===incomingName);
            if(sameNameInBase.length===1) targetHorse=sameNameInBase[0];
            else {
              const byName=(nameMap.get(incomingName)||[]).filter(h=>!usedTargets.has(h));
              if(byName.length===1) targetHorse=byName[0];
              else if(byBase.length===1&&(!incomingName||!baseHorseName(byBase[0]?.horse_name||'')||raceAlignmentTrusted)) targetHorse=byBase[0];
            }
          }
          if (!targetHorse){
            if(historicalTop5Only) continue;
            // Sonuçta olup eski tahminde bulunmayan atı aynı ayağa ekle.
            if(incomingRaceQuality.winnerCount>0){
              targetRace.horses.push(JSON.parse(JSON.stringify(incomingHorse)));
              appendedHorses++;
            }
            continue;
          }
          usedTargets.add(targetHorse);
          matchedHorses++;

          // Eski program kaydı eküri etiketinden yoksunsa, resmi TJK sonuç footer'ından
          // gelen grup etiketini mevcut ata taşı. Böylece daha önce kaydedilmiş bir
          // toplantıda sonuç güncellemesi sonrası eküri bağı korunur; resmi kazanan bayrağı yalnız gerçek 1. ata aittir.
          const incomingEkuri=typeof ekuriGroup==='function' ? ekuriGroup(incomingHorse.horse_no) : null;
          if(incomingEkuri&&!historicalTop5Only){
            if(isMissingResultValue(targetHorse.ekuri_group)){ targetHorse.horse_no=String(ekuriBase(targetHorse.horse_no))+'-'+incomingEkuri; targetHorse.ekuri_group=incomingEkuri; changedFields++; }
          }

          if(historicalTop5Only){
            const fp=Number(incomingHorse.finish_position);
            if(incomingVerified&&Number.isInteger(fp)&&fp>=1&&fp<=5 && isMissingResultValue(targetHorse.finish_position)){ targetHorse.finish_position=fp; targetHorse.winner=fp===1?1:0; changedFields+=2; }
            continue;
          }

          // Sonuç HTML yalnız kimlik ve doğrulanmış resmî derece katmanının sahibidir.
          // ST/Kulvar TJK Program'a, best_time/DERECE de program katmanına aittir.
          // Eski result_time/official_time parserı sütun kaydırdığı için fail-closed kapalıdır.
          const safeBulletinFields=['horse_name'];
          for (const key of safeBulletinFields) setIfMissing(targetHorse,key,incomingHorse[key]);
          // Derece/kazanan yalnız hedefte derece gerçekten eksikse yazılır. Mevcut
          // dolu sonuç otomatik bakım tarafından sessizce değiştirilmez.
          const incomingFp=Number(incomingHorse.finish_position);
          if(incomingVerified && incomingRaceQuality.winnerCount>0 && Number.isInteger(incomingFp) && incomingFp>0 && isMissingResultValue(targetHorse.finish_position)){
            targetHorse.finish_position=incomingFp; targetHorse.winner=incomingFp===1?1:0; changedFields+=2;
          }
        }
        normalizeRaceObj(targetRace);
        targetRace.active=resultRaceQuality(targetRace).winnerCount>0 ? 1 : (targetRace.active||0);
        if(changedFields>raceChangedBefore && !updated.includes(targetRace)) updated.push(targetRace);
      }

      targetFile.status='ACTIVE';
      const finalTargetRaces=db.races.filter(r=>r.file_id===targetFile.id);
      const finalWithWinner=finalTargetRaces.filter(r=>resultRaceQuality(r).winnerCount>0).length;
      const finalComplete=finalTargetRaces.filter(r=>resultRaceQuality(r).complete).length;
      const finalPayoutRaces=finalTargetRaces.filter(resultRaceHasSupplementalData).length;
      targetFile.qc_status=finalComplete>=6
        ? 'SONUÇLAR GÜNCELLENDİ'
        : finalWithWinner>0
          ? 'SONUÇ KISMİ GÜNCELLENDİ'
          : finalPayoutRaces>0
            ? 'İKRAMİYE GÜNCELLENDİ'
            : (targetFile.qc_status||'BEKLİYOR');
      if(changedFields>0 || appendedHorses>0 || updated.length>0) targetFile.result_updated_at=new Date().toISOString();
      targetFile.has_confirmed_results=finalWithWinner>0?1:(targetFile.has_confirmed_results||0);
      targetFile.result_quality={complete:finalComplete,withWinner:finalWithWinner,raceCount:finalTargetRaces.length,payoutRaces:finalPayoutRaces};
      targetFile.result_source=(typeof tkpPublicSourceName==='function') ? tkpPublicSourceName(p.file.filename, p.file.hippodrome || targetFile.hippodrome) : 'Sonuç HTML';

      const resultDataChanged=changedFields>0 || appendedHorses>0 || updated.length>0;
      if(resultDataChanged){
        invalidateActiveRacesCache();
        invalidateProfileMatchCache();
        invalidateWinnerProfileCache();
        invalidateConditionStatsCache();
        invalidateAdaptiveLearningCache();
        invalidateSideBetCache();
        try{if(typeof tkpClearPerformanceCaches==='function')tkpClearPerformanceCaches();}catch(_e){}
        try{if(typeof tkpInvalidateFastBacktestCache==='function')tkpInvalidateFastBacktestCache();}catch(_e){}
        try{if(typeof tkpInvalidateIndexes==='function')tkpInvalidateIndexes();}catch(_e){}
        resolvePredictionLogWithRaces(updated);
        setCurrentRules([]);
        setRulesDirty(true);
        // Sonuç geldiğinde yarış-öncesi kupon snapshotları artık çözülebilir.
        // Back Test'in kalıcı HTML önbelleği yalnız bu gerçek sonuç güncellemesinde
        // geçersiz kılınır; sıradan kayıtlarda ağır panel yeniden hesaplanmaz.
        try{if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('tkp:db-changed',{detail:{resultsChanged:true,learningChanged:true}}));}catch(_e){}
      }
      let after=snapshotTopPeek();
      log('RESULT', resultDataChanged
        ? `${targetFile.filename} incremental sonuç güncellemesi: ${updated.length} ayak, ${changedFields} eksik alan tamamlandı, ${matchedHorses} eşleşen at${appendedHorses?`, ${appendedHorses} yeni at`:''}. Dolu alanlar korunarak yalnız eksikler işlendi.`
        : `${targetFile.filename} sonuç kontrolü: yeni eksik alan yok; mevcut veri değiştirilmedi.`);
      if (before!==null && after!==null && before !== after) log('LEARNING', 'En İyi 10 sıralaması yeni sonuçlarla değişti.');
      setPreviewPayload(null);
      $('#historyPreview').innerHTML = `<div class="card" style="border-left:5px solid ${resultPartial ? '#d97706' : '#16a34a'};"><b>Eksik veriler mevcut kayda işlendi.</b><br>${updated.length} ayak güncellendi; kazanan/sıralama ve varsa resmi ikramiyeler birleştirildi. Y.PUAN, 800G, J-BYG, TR PUAN, Accurate, BMB/ODB, VALUE ve SP korundu.${resultPartial?` Mevcut toplam: ${finalComplete}/6 ayak tam sonuç, ${finalPayoutRaces} ayakta ikramiye/bahis verisi. Eksikler daha sonra yeniden yüklenebilir.`:''}</div>`;
      if ($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent = `Güncellendi: ${targetFile.filename} · ${updated.length} ayak · ${finalWithWinner} sonuçlu · ${finalPayoutRaces} ikramiyeli.`;
      const persisted=await saveDB();
      if(persisted===false) throw new Error('Sonuç bellekte işlendi ancak kalıcı veritabanına yazılamadı.');
      try{ if(typeof tkpRefreshLoadedMeetingAfterResult==='function') tkpRefreshLoadedMeetingAfterResult(targetFile); }catch(_e){}
      // Tahmin ekranı sonuç eklenmeden önceki haliyle KİLİTLİ kalır. Sonuç dosyası
      // yalnız finish_position/winner alanlarını işler; AGF, TKP, Profil Gücü, J-BYG,
      // Y.PUAN, kupon sırası ve TEK kararı yeniden hesaplanmaz. Kullanıcı yeni bir
      // bülten/ODS yüklemedikçe ekrandaki tahmin kendiliğinden değişmez.
      // "Ayrıntılı Analiz" gibi diğer sekmeler de activeRaces()'e (bu sonuçla artık
      // active=1 olan koşulara) bağlıdır ama YALNIZCA sekmeye tıklanınca yeniden
      // çizilir (lazy render). Kullanıcı o sekmede kalmaya devam ediyorsa, sonuç
      // kaydedilir kaydedilmez orası da otomatik güncellensin diye şu anki aktif
      // sekme yeniden çizdirilir.
      try { if (!(typeof window!=='undefined' && window.__tkpCollectorLayerBatchActive) && typeof renderActivePane === 'function') renderActivePane(); } catch(e){ /* sessizce geç */ }
      return;
    }
    // Sonuç yükleme yeni dosya açmaz. Eşleşme yoksa kullanıcı önce ana yarış
    // kaydını (ODS/TJK/YeniBeygir) yüklemelidir; aksi halde sonuç ayrı kayıt gibi
    // davranır ve QC düzeni bozulur.
    const msg=matchReason==='AMBIGUOUS'
      ? `Aynı tarih ve hipodrom için birden fazla toplantı bulundu; at/koşu örtüşmesi kesin olmadığı için sonuç hiçbir kayda yazılmadı. Doğru Altılı/koşu numarasını taşıyan sonuç dosyasını seç.`
      : `Sonuç dosyası mevcut tahmin kaydıyla eşleşmedi: ${displayDateTR(date||'')} ${hip||''}. Yeni kayıt oluşturulmadı. Önce aynı tarih + hipodrom yarışını ODS veya TJK olarak yükle, sonra sonucu tekrar işle.`;
    setPreviewPayload(null);
    $('#historyPreview').innerHTML = `<div class="card" style="border-left:5px solid #dc2626;"><b>Sonuç kaydedilmedi.</b><br>${esc(msg)}</div>`;
    if ($('#resultBulletinFileName')) $('#resultBulletinFileName').textContent = msg;
    if ($('#resultBulletinFile')) $('#resultBulletinFile').value='';
    log('RESULT', msg);
    return;
  }

  const previousFileCount=(db.files||[]).length;
  let newId = typeof tkpChronologyNextFileId==='function'
    ? tkpChronologyNextFileId(db)
    : (db.files||[]).reduce((max,f)=>Math.max(max,Number(f?.id)||0),0)+1;
  let canonical = (typeof tkpQcOdsFilename==='function') ? tkpQcOdsFilename(p.file.sequence_no, p.file.hippodrome) : `TKP_AI_${String(p.file.sequence_no).padStart(3,'0')}.ods`;
  const cleanFile={...p.file};
  delete cleanFile.import_kind;
  let file = {id:newId, ...cleanFile, filename:canonical, original_filename:(typeof tkpPublicSourceName==='function'?tkpPublicSourceName(p.file.filename,p.file.hippodrome):p.file.filename), fingerprint:fp, status:'ACTIVE', qc_status: skipped ? 'PARTIAL' : 'OK'};
  db.files.push(file);
  let maxRid = 0; for(const existingRace of (db.races||[])){ const rid=Number(existingRace?.id)||0; if(rid>maxRid)maxRid=rid; }
  for (const r of validRaces){
    r.id = ++maxRid; r.file_id = newId; r.filename = canonical; r.active = 1;
    normalizeRaceObj(r);
    db.races.push(r);
  }
  // En yeni güncel toplantı eklemesi hızlı yoldur: yalnız bu dosya + validRaces
  // güncellenir, tüm arşiv yarışları ve snapshot günlükleri taranmaz. Tarih geriye
  // düşerse helper atomik tam eşlemeye geçer ve 1=en eski kuralını korur.
  if(typeof tkpApplyChronologyForIncomingFile==='function'){
    tkpApplyChronologyForIncomingFile(db,file,{previousFileCount,linkedRows:validRaces,reason:'history-import',markDirty:false,logChange:false});
  }else if(typeof tkpResequenceFilesChronologically==='function'){
    tkpResequenceFilesChronologically(db,{full:true,reason:'missing-chronology-api',markDirty:false,logChange:false});
  }
  canonical=file.filename;
  invalidateActiveRacesCache();
  invalidateProfileMatchCache();
  invalidateWinnerProfileCache();
  invalidateConditionStatsCache();
  invalidateAdaptiveLearningCache();
  invalidateSideBetCache();
  resolvePredictionLogWithRaces(validRaces);
  setCurrentRules([]);
  setRulesDirty(true);
  let after = snapshotTopPeek();
  log('IMPORT', skipped ? `${canonical} eklendi: ${validRaces.length} koşu kaydedildi, ${skipped} ayak eksik veri nedeniyle atlandı.` : `${canonical} eklendi: 6 koşu, 6 kazanan.`);
  if (before!==null && after!==null && before !== after) log('LEARNING', 'En İyi 10 sıralaması yeni veriyle değişti.');
  if (activeRaces().length % 30 === 0) log('CHECKPOINT', `${activeRaces().length} koşu checkpointine ulaşıldı; yedek alınmalı.`);
  setPreviewPayload(null);
  $('#historyPreview').innerHTML = `<div class="card" style="border-left:5px solid ${skipped ? '#d97706' : '#16a34a'};">Dosya kaydedildi${skipped ? ` — ${validRaces.length} ayak eklendi, ${skipped} ayak eksik veri nedeniyle atlandı. Eksik ayakları elle düzeltip dosyayı tekrar yüklersen, o ayaklar bu sefer eklenir (dosya numarası aynı kaldığı için üstüne yazılmaz; önce Dosyalar/QC'den bu kaydı silip yeniden yüklemen gerekir).` : '.'}</div>`;
  if ($('#historyFileName')) $('#historyFileName').textContent = `Kaydedildi: ${p.file.filename} · ${validRaces.length} ayak eklendi.`;
  await saveDB();
}

function raceFinishGroups(r){
  const groups={1:[],2:[],3:[],4:[],5:[]};
  for(const h of (r.horses||[])){
    const pos=Number(h.finish_position);
    if([1,2,3,4,5].includes(pos)) groups[pos].push(h);
  }
  return groups;
}

function validFinishSequences(r, n){
  const groups=raceFinishGroups(r);
  if(!groups[1].length) return [];
  const positions=n>=5?[1,2,3,4,5]:[1,2,3,4];
  const ordered=positions.flatMap(pos => groups[pos].length ? [{pos,horses:groups[pos]}] : []);
  // GÜVENLİK SINIRI: Gerçek atbaşı (dead-heat) neredeyse hiç 2-3 atı geçmez. Bozuk/eksik
  // veri yüzünden birçok ata yanlışlıkla aynı derece atanırsa, aşağıdaki kod TÜM
  // permütasyonları üretmeye çalışır (n! ile patlar) ve tarayıcıyı dakikalarca hatta
  // süresiz kilitleyebilir -- "yan bahisler açılmıyor" şikayetinin sebebi budur. İki
  // katmanlı koruma eklendi: (1) tek bir "aynı sırada" grup MAX_TIE_GROUP'u aşarsa
  // permütasyon üretilmez, grup olduğu sırayla TEK bir dizi olarak alınır; (2) birden
  // fazla pozisyonun küçük gruplarının çarpımı yine de büyürse toplam durum sayısı
  // MAX_STATES'te kesilir. Gerçek (küçük) atbaşı davranışı hiç etkilenmez.
  const MAX_TIE_GROUP=4;
  const MAX_STATES=4000;
  let states=[[]];
  for(const g of ordered){
    const remaining=n-(states[0]?.length||0);
    if(remaining<=0) break;
    const next=[];
    for(const seq of states){
      const need=n-seq.length;
      if(need<=0){next.push(seq);continue;}
      const arr=g.horses;
      const choose=Math.min(need,arr.length);
      if(arr.length>MAX_TIE_GROUP){
        next.push(seq.concat(arr.slice(0,choose)));
        if(next.length>=MAX_STATES) break;
        continue;
      }
      // combinations of horses when a tied group crosses the cutoff
      const combs=[];
      function comb(i,k,cur){
        if(k===0){combs.push(cur.slice());return;}
        for(let j=i;j<=arr.length-k;j++){cur.push(arr[j]);comb(j+1,k-1,cur);cur.pop();}
      }
      comb(0,choose,[]);
      // all permutations inside a tied group are valid ordered outcomes
      function perms(a){
        if(a.length<=1) return [a.slice()];
        const out=[];
        a.forEach((x,i)=>perms(a.slice(0,i).concat(a.slice(i+1))).forEach(p=>out.push([x].concat(p))));
        return out;
      }
      outer: for(const c of combs){
        for(const p of perms(c)){
          next.push(seq.concat(p));
          if(next.length>=MAX_STATES) break outer;
        }
      }
      if(next.length>=MAX_STATES) break;
    }
    states=next.length>MAX_STATES ? next.slice(0,MAX_STATES) : next;
    if(states.length && states[0].length>=n) break;
  }
  return states.filter(x=>x.length===n);
}

function historicalOrder(r){
  // V22.8: Geçmiş yan bahis geri testleri de canlı Tahmin/Kupon ile aynı ortak
  // strategicOrderForRace sırasını kullanır. Böylece Y.PUAN geri dönüşü, TKP omurgası
  // ve 6-7-8 BMB/ODB bandı geçmiş sonuçlarla aynı formülle sınanır.
  // PERFORMANS: Aynı geçmiş yarış (r), tek bir panel render'ında (Yan Bahisler'in 5
  // ayrı backtest çağrısı gibi) defalarca sorulabiliyordu; her seferinde TAM skor
  // motorunu (atlar başına adaptiveCompositeScore dahil) baştan çalıştırmak yerine
  // artık yarış nesnesine göre önbelleğe alınır -- bkz. state.js _historicalOrderCache.
  if(!r) return strategicOrderForRace(r, []);
  if(typeof _historicalOrderCache!=='undefined'){
    const cached=_historicalOrderCache.get(r);
    if(cached) return cached;
  }
  const result=strategicOrderForRace(r, (r&&r.horses)||[]);
  if(typeof _historicalOrderCache!=='undefined') _historicalOrderCache.set(r, result);
  return result;
}

function isHandikapRace(r){
  return broadConditionKey(r && r.condition_family) === 'HANDİKAP';
}

// V25_JBYG_TOP7_RUNTIME_GUARD:
// Eski kayıt, geri çağırma veya ara merge sonrası J-BYG 8+ kalırsa anında temizle.
try{
  if(typeof normalizeRaceObj === 'function' && !normalizeRaceObj.__v25JbygTop7Guard){
    const __v25OrigNormalizeRaceObj = normalizeRaceObj;
    normalizeRaceObj = function(r){
      const out = __v25OrigNormalizeRaceObj.apply(this, arguments);
      try{ _v25ClampJbyg850Top7ForRace(out || r); }catch(_){}
      return out;
    };
    normalizeRaceObj.__v25JbygTop7Guard = true;
  }
}catch(_){}
