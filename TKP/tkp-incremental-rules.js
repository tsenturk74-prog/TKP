'use strict';

// =====================================================================================
// V1.1.285 İNKREMENTAL KURAL MADENCİLİĞİ MOTORU
// =====================================================================================
// KÖK MİMARİ FIX: buildRules()/buildRulesAsync() her cache-miss'te (yeni bir yarışın
// sonucu geldiğinde) ÖĞRENMEYE UYGUN TÜM arşivi (learningEligibleRaces()) baştan
// tarayıp F² / F³ (özellik sayısının karesi/küpü) kombinasyonunu yeniden hesaplıyordu.
// Gerçek arşivde (509 toplantı / 3054 yarış) bu tek çağrı ~1.2-1.4 sn sürüyor (bkz.
// tests/research-analytics-performance.test.js) ve arşiv büyüdükçe O(n) ölçekleniyor.
//
// Bu dosya, AYNI matematiği (aynı sıralama, aynı Wilson alt sınırı, aynı eşitlik
// kuralları) üreten ama SADECE yeni eklenen yarış dilimini tarayan bir "uzatılabilir"
// (extendable) muhasebe katmanı ekler. buildRules()/buildRulesAsync() TEK BİR SATIR
// DEĞİŞTİRİLMEDEN, olduğu gibi bırakıldı -- bu motor onları HİÇ ÇAĞIRMAZ, kendi
// başına eşdeğer (ve her adımda kendi kendini doğrulayan) bir hesap yolu izler.
// Güvenlik ağı: incremental uzatmanın GEÇERLİ olabilmesi için üç koşul birden
// sağlanmalı -- özellik kümesi (atomicFeatures) değişmemiş, max_rule_size aynı, ve
// önbelleğin daha önce saydığı yarışların TAMAMI (kimlik + sonuç içeriği) hâlâ
// birebir aynı. Bunlardan biri bile tutmazsa, motor sessizce TAM yeniden hesaba
// döner (startN=0) -- yanlış/eksik bir "hızlı ama yanlış" sonuç asla üretilmez.
//
// V1.1.329: recentRate artık ağırlıklı sonsuz geçmiş değil, ekranda yazdığı gibi
// gerçekten son 20 tek-aday sonucunun düz isabetidir. Incremental cache her kural
// için yalnız son 20 sonucu taşır; yeni dilim eklendiğinde eski kuyruğa ekleyip yine
// son 20'yi tutar. Bu nedenle tam buildRules()/buildRulesAsync() ile bit-bit aynı
// sonuç üretilir. Doğrulama: tests/incremental-rules-parity.test.js.
// =====================================================================================

const TKP_INCR_RULES_CACHE_KEY = 'rule_cache_v2';
const TKP_INCR_YIELD_EVERY = 40;
let _tkpIncrInFlight = null;

function _tkpIncrRaceContentFingerprint(r,feats){
  // Kalıcı P1-P5 önbelleği bu ortak yardımcıyı özellik listesi olmadan çağırır.
  // Onun mevcut sonuç parmak izi sözleşmesini koru.
  if(!Array.isArray(feats))return String(r.id??'')+'#'+(r.horses||[]).map(h=>(h.horse_no??'')+':'+(h.finish_position??'')+':'+(Number(h.winner)===1?1:0)).join(',');
  // Sonuç kadar özellik eşleşmeleri de sayımı değiştirir. Geç gelen kaynak veya
  // düzeltilen kilo/sıralama, sonuç aynı kalsa bile eski sayımı geçersiz kılar.
  const hs = r.horses || [];
  const parts = new Array(hs.length);
  for (let i=0;i<hs.length;i++){
    const h = hs[i];
    parts[i] = [h.horse_no??'',h.finish_position??'',Number(h.winner)===1?1:0,feats.map(f=>f.test(h,r)?'1':'0').join('')];
  }
  return JSON.stringify([r.id,r.file_id,r.hippodrome,parts]);
}

async function _tkpIncrFingerprints(races,feats){
  const out=[];let clock=performance.now();
  for(let i=0;i<races.length;i++){
    out.push(_tkpIncrRaceContentFingerprint(races[i],feats));
    if((i+1)%16===0&&performance.now()-clock>=12){await new Promise(resolve=>setTimeout(resolve,0));clock=performance.now();}
  }
  return out;
}

function _tkpIncrFeatureSetKey(feats){
  // Sıra ÖNEMLİ: önbellekteki accum dizisinin indeksleri, feats dizisinin O ANKİ
  // sırasına göre üretilen combos ile birebir hizalanmak zorunda. atomicFeatures()
  // deterministik (uniq().sort() + sabit sırayla add()) üretildiği için aynı veri
  // kümesinden hep aynı sırayı verir; herhangi bir isim/sıra farkı burada yakalanır.
  return feats.map(f => f.name).join('|');
}

function _tkpIncrReadCache(){
  const c = db && db.learning_state ? db.learning_state[TKP_INCR_RULES_CACHE_KEY] : null;
  if (!c || c.version !== 4 || !Array.isArray(c.accum) || !Array.isArray(c.raceFingerprints)) return null;
  return c;
}

function _tkpIncrPrefixMatches(fingerprints, cache){
  const n = cache.raceCount;
  if (n > fingerprints.length) return false;
  const fp = cache.raceFingerprints;
  if (fp.length !== n) return false;
  for (let i=0;i<n;i++){
    if (fingerprints[i] !== fp[i]) return false;
  }
  return true;
}

function _tkpIncrCombos(feats, max){
  // buildRules()/buildRulesAsync() ile BİREBİR AYNI enumerasyon sırası ve grup
  // dışlama kuralı. Sıra değişirse önbellek indeksleri kayar -- bu yüzden burada
  // da aynen kopyalanmalı, yeniden düzenlenmemeli.
  const combos = [];
  for (let i=0;i<feats.length;i++) combos.push([i]);
  if (max >= 2){
    for (let i=0;i<feats.length;i++) for (let j=i+1;j<feats.length;j++){
      if (feats[i].group === feats[j].group) continue;
      combos.push([i,j]);
    }
  }
  if (max >= 3){
    for (let i=0;i<feats.length;i++) for (let j=i+1;j<feats.length;j++) for (let k=j+1;k<feats.length;k++){
      const gs = new Set([feats[i].group,feats[j].group,feats[k].group]);
      if (gs.size < 3) continue;
      combos.push([i,j,k]);
    }
  }
  return combos;
}

function _tkpIncrEmptyAccum(){
  return {single:0,singleWins:0,selectedHorses:0,selectedWins:0,eligible:0,files:new Set(),hippos:new Set(),signatureParts:[],recentOutcomes:[]};
}

// Yalnız YENİ yarış dilimini (startGlobalIdx .. currentN-1) tarayan, buildRules()
// içindeki evaluateFeatureIndices ile BİREBİR AYNI at/maske mantığını kullanan
// (yalnız girdi kümesi kısıtlı) hesap çekirdeği. currentN, ağırlık formülünün
// PAYDA'sı olan GÜNCEL toplam yarış sayısıdır (eski dilimin ölçeklenmesi ayrı
// yapılır, bkz. çağıran fonksiyon).
async function _tkpIncrEvaluateNewSlice(feats, newRaces, currentN, startGlobalIdx){
  const raceHorses = newRaces.map(r => r.horses || []);
  const raceStartOffset = [];
  { let off = 0; for (const hs of raceHorses){ raceStartOffset.push(off); off += hs.length; } }
  const totalHorses = raceStartOffset.length ? raceStartOffset[raceStartOffset.length-1] + raceHorses[raceHorses.length-1].length : 0;

  // R16.59 HIZ FIX: evalCombo() aynı atın kazanan bayrağını ve horse_no'sunu HER
  // kombinasyon × her eşleşen yarış için, farklı şekilli (megamorphic) at
  // nesnelerinden tekrar tekrar okuyordu -- CPU profilinde en sıcak nokta
  // (LoadIC_Megamorphic) buradan geliyordu. Bu iki değer kombinasyondan
  // bağımsızdır; tek geçişte düz tipli dizilere çıkarılır, evalCombo artık at
  // nesnesine hiç dokunmadan yalnız bu dizileri okur. Çıktı (rate/lb/signature/
  // recentOutcomes/vs.) birebir aynıdır -- yalnız değerin okunduğu yer değişir.
  const winnerMask = new Uint8Array(totalHorses);
  const horseNoArr = new Array(totalHorses);
  {
    let gi=0;
    for (let ri=0; ri<newRaces.length; ri++){
      for (const h of raceHorses[ri]){
        winnerMask[gi] = (Number(h?.winner)===1||Number(h?.finish_position)===1) ? 1 : 0;
        horseNoArr[gi] = h.horse_no;
        gi++;
      }
    }
  }

  const featureRaceIndices = [];
  const masks = [];
  let sliceClock=performance.now();
  for(let fi=0;fi<feats.length;fi++){
    const f=feats[fi];
    const m = new Uint8Array(totalHorses);
    let gi = 0;
    const matchingRaces = [];
    for (let ri=0; ri<newRaces.length; ri++){
      const r = newRaces[ri];
      let raceMatched = false;
      for (const h of raceHorses[ri]){ const pass=f.test(h,r); m[gi]=pass?1:0; if(pass)raceMatched=true; gi++; }
      if (raceMatched) matchingRaces.push(ri);
      if((ri+1)%32===0&&performance.now()-sliceClock>=12){
        await new Promise(resolve=>setTimeout(resolve,0));
        sliceClock=performance.now();
      }
    }
    featureRaceIndices[fi] = matchingRaces;
    masks.push(m);
  }

  function evalCombo(idxArr){
    let single=0, singleWins=0, selectedHorses=0, selectedWins=0, eligible=0;
    const filesSet=new Set(), hipposSet=new Set(), signatureParts=[];
    const recentOutcomes=[];
    const raceIdx = idxArr.reduce((best,fi) => {
      const rows = featureRaceIndices[fi] || [];
      return best===null || rows.length<best.length ? rows : best;
    }, null) || [];
    const nIdx = idxArr.length;
    for (const li of raceIdx){
      const r = newRaces[li];
      const horses = raceHorses[li];
      const base = raceStartOffset[li];
      let hlen=0, winCount=0, firstHorseNo='', horseNos=null;
      if (nIdx === 1){
        const m0 = masks[idxArr[0]];
        for (let hi=0; hi<horses.length; hi++){
          if (!m0[base+hi]) continue;
          const idx=base+hi, horseNo=horseNoArr[idx];
          if(hlen===0) firstHorseNo=horseNo; else if(hlen===1) horseNos=[firstHorseNo,horseNo]; else horseNos.push(horseNo);
          hlen++; if(winnerMask[idx]) winCount++;
        }
      } else if (nIdx === 2){
        const m0 = masks[idxArr[0]], m1 = masks[idxArr[1]];
        for (let hi=0; hi<horses.length; hi++){
          if (!m0[base+hi] || !m1[base+hi]) continue;
          const idx=base+hi, horseNo=horseNoArr[idx];
          if(hlen===0) firstHorseNo=horseNo; else if(hlen===1) horseNos=[firstHorseNo,horseNo]; else horseNos.push(horseNo);
          hlen++; if(winnerMask[idx]) winCount++;
        }
      } else {
        for (let hi=0; hi<horses.length; hi++){
          let pass = true;
          for (let k=0; k<nIdx; k++){ if (!masks[idxArr[k]][base+hi]){ pass=false; break; } }
          if (pass){
            const idx=base+hi, horseNo=horseNoArr[idx];
            if(hlen===0) firstHorseNo=horseNo; else if(hlen===1) horseNos=[firstHorseNo,horseNo]; else horseNos.push(horseNo);
            hlen++; if(winnerMask[idx]) winCount++;
          }
        }
      }
      if (!hlen) continue;
      eligible++; selectedHorses += hlen; selectedWins += winCount;
      signatureParts.push(hlen===1 ? (r.id+':'+firstHorseNo) : (r.id+':'+horseNos.sort().join(',')));
      if (hlen === 1){
        single++; singleWins += winCount;
        filesSet.add(r.file_id); hipposSet.add(r.hippodrome);
        recentOutcomes.push(winCount?1:0);
      }
    }
    return {single,singleWins,selectedHorses,selectedWins,eligible,filesSet,hipposSet,signatureParts,recentOutcomes};
  }

  return evalCombo;
}

function _tkpIncrMaterializeRows(feats, combos, accum){
  // buildRules()'un son adımıyla (filtrele -> imzaya göre dedupe -> sırala)
  // BİREBİR AYNI post-processing.
  let raw = [];
  for (let ci=0; ci<combos.length; ci++){
    const a = accum[ci];
    if (!a.single) continue;
    const idxArr = combos[ci];
    const features = idxArr.map(i => feats[i]);
    const rate = a.single ? a.singleWins/a.single : 0;
    const recent=a.recentOutcomes||[];
    const recentRate = recent.length ? recent.reduce((sum,value)=>sum+value,0)/recent.length : rate;
    raw.push({
      features, name: features.map(f=>f.name).join(' + '),
      single:a.single, singleWins:a.singleWins, rate, recentRate, recentN:recent.length,
      lb: wilson(a.singleWins, a.single),
      selectedHorses:a.selectedHorses, selectedWins:a.selectedWins, eligible:a.eligible,
      files:a.files.size, hippos:a.hippos.size,
      signature:a.signatureParts.join(';')
    });
  }
  const sig = new Map();
  for (const x of raw){
    const old = sig.get(x.signature);
    if (!old || x.features.length<old.features.length || (x.features.length===old.features.length && x.name.length<old.name.length)) sig.set(x.signature, x);
  }
  const arr = [...sig.values()];
  arr.sort((a,b) => b.lb-a.lb || b.rate-a.rate || b.single-a.single || a.features.length-b.features.length || TKP_TR_COLLATOR.compare(a.name,b.name));
  return arr;
}

function _tkpIncrSerializeAccum(accum){
  return accum.map(a => ({
    single:a.single, singleWins:a.singleWins, selectedHorses:a.selectedHorses, selectedWins:a.selectedWins,
    eligible:a.eligible, files:[...a.files], hippos:[...a.hippos], signature:(a.signatureParts||[]).join(';'),
    recentOutcomes:(a.recentOutcomes||[]).slice(-20)
  }));
}

function _tkpIncrHydrateAccum(serialized){
  return serialized.map(a => ({
    single:a.single, singleWins:a.singleWins, selectedHorses:a.selectedHorses, selectedWins:a.selectedWins,
    eligible:a.eligible, files:new Set(a.files||[]), hippos:new Set(a.hippos||[]),
    signatureParts:typeof a.signature==='string'?(a.signature?[a.signature]:[]):(a.signatureParts||[]).slice(),
    recentOutcomes:(a.recentOutcomes||[]).slice(-20)
  }));
}

async function tkpBuildRulesIncrementalAsync(racesOverride){
  const analysisRaces = racesOverride || learningEligibleRaces();
  const signature = `${analysisRaces.length}|${analysisRaces.length?analysisRaces[analysisRaces.length-1].id:''}|${db?.settings?.max_rule_size??''}`;
  if (_tkpIncrInFlight && _tkpIncrInFlight.signature === signature) return _tkpIncrInFlight.promise;

  const promise = (async () => {
    computeHorsePriorStats(analysisRaces);
    const feats = atomicFeatures(analysisRaces);
    let max = Math.max(1, Math.min(3, db.settings.max_rule_size || 2));
    if (analysisRaces.length > 250 && max > 2) max = 2;
    const featKey = _tkpIncrFeatureSetKey(feats);
    const combos = _tkpIncrCombos(feats, max);
    const fingerprints = await _tkpIncrFingerprints(analysisRaces,feats);

    const cache = _tkpIncrReadCache();
    let startN = 0, accum = combos.map(_tkpIncrEmptyAccum);
    const reusable = !!cache
      && cache.featureKey === featKey
      && cache.maxRuleSize === max
      && cache.raceCount <= analysisRaces.length
      && cache.accum.length === combos.length
      && _tkpIncrPrefixMatches(fingerprints, cache);
    if (reusable){
      startN = cache.raceCount;
      accum = _tkpIncrHydrateAccum(cache.accum);
    }
    try{if(typeof globalThis!=='undefined')globalThis.__tkpIncrementalRuleCacheDiagnostic={cachePresent:!!cache,reusable,startN,raceCount:analysisRaces.length,comboCount:combos.length,featureCount:feats.length,at:new Date().toISOString()};}catch(_e){}

    if (startN < analysisRaces.length){
      const newRaces = analysisRaces.slice(startN);
      const currentN = analysisRaces.length;
      const evalCombo = await _tkpIncrEvaluateNewSlice(feats, newRaces, currentN, startN);
      let sinceYield = 0;
      for (let ci=0; ci<combos.length; ci++){
        const delta = evalCombo(combos[ci]);
        const a = accum[ci];
        a.single += delta.single; a.singleWins += delta.singleWins;
        a.selectedHorses += delta.selectedHorses; a.selectedWins += delta.selectedWins;
        a.eligible += delta.eligible;
        for (const f of delta.filesSet) a.files.add(f);
        for (const h of delta.hipposSet) a.hippos.add(h);
        if (delta.signatureParts.length) a.signatureParts.push(...delta.signatureParts);
        if(delta.recentOutcomes.length)a.recentOutcomes.push(...delta.recentOutcomes);
        if(a.recentOutcomes.length>20)a.recentOutcomes.splice(0,a.recentOutcomes.length-20);
        sinceYield++;
        if (sinceYield >= TKP_INCR_YIELD_EVERY){
          sinceYield = 0;
          if (typeof tkpYield === 'function') await tkpYield(); else await new Promise(r=>setTimeout(r,0));
        }
      }
    }

    const rows = _tkpIncrMaterializeRows(feats, combos, accum);
    if (db){
      db.learning_state = db.learning_state && typeof db.learning_state === 'object' ? db.learning_state : {};
      db.learning_state[TKP_INCR_RULES_CACHE_KEY] = {
        version:4, featureKey:featKey, maxRuleSize:max, raceCount:analysisRaces.length,
        raceFingerprints: fingerprints,
        accum: _tkpIncrSerializeAccum(accum)
      };
    }
    return rows;
  })();

  _tkpIncrInFlight = { signature, promise };
  try {
    return await promise;
  } finally {
    if (_tkpIncrInFlight && _tkpIncrInFlight.promise === promise) _tkpIncrInFlight = null;
  }
}

// db üzerinde eski v1 kural önbelleğiyle (rule_cache) çakışmaz -- ayrı anahtar
// (rule_cache_v2, şema v3) kullanır, geri dönüşte (bu dosya yoksa/devre dışıysa) state.js
// otomatik olarak eski buildRulesAsync() yoluna düşer (bkz. state.js getCurrentRulesAsync).
