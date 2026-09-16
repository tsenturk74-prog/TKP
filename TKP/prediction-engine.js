// Tekli bahis (single) aday seçimi ve karar mantığı.

function tkpPredictionGcTrValue(horse){
  const sources=[horse?.tr_ganyan_source,horse?.tr_source].map(v=>String(v??'').trim().toUpperCase());
  if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
  for(const raw of [horse?.tr_ganyan,horse?.tr_puan]){
    if(raw==null||String(raw).trim()==='')continue;
    const value=Number(String(raw).replace(',','.'));if(Number.isFinite(value))return value;
  }
  return NaN;
}

function pickLegsByScoreDesc(raceResults){
  return (raceResults || []).filter(x => x.top).slice().sort((a,b) => b.top.score - a.top.score);
}

function pickByRankStats(x, condStatsSonuc, condStatsAgf){
  let cond = broadConditionKey(x.r.condition_family);
  let sonucStats = condStatsSonuc[cond];
  let agfStats = condStatsAgf[cond];
  let candidates = x.scored.filter(h =>
    (h.result_rank!=null && h.result_rank>=2 && h.result_rank<=4) ||
    (h.agf_rank!=null && h.agf_rank>=2 && h.agf_rank<=5)
  );
  if (!candidates.length) return null;
  function pctFor(h){
    let pSonuc = (h.result_rank!=null && sonucStats && sonucStats.total) ? (sonucStats[String(h.result_rank)]||0)/sonucStats.total : 0;
    let pAgf = (h.agf_rank!=null && agfStats && agfStats.total) ? (agfStats[String(h.agf_rank)]||0)/agfStats.total : 0;
    return Math.max(pSonuc, pAgf);
  }
  candidates = candidates.slice().sort((a,b) => pctFor(b)-pctFor(a) || (b.score||0)-(a.score||0));
  return candidates[0];
}

function conditionSingleStrength(r, h){
  const rankRate = conditionRankWinRate(r, h);
  const bmbRate = conditionBmbWinRate(r, h);
  const hist = historyStrengthForCandidate(h);
  return Math.max(rankRate, bmbRate, hist) * 0.70 + (h.score || 0) * 0.30;
}

function chooseConditionSingle(x, mode='main'){
  const pool = strictCandidatePool(x);
  if (!pool.length) return null;
  const ranked = pool.slice().sort((a,b) => conditionSingleStrength(x.r,b)-conditionSingleStrength(x.r,a) || (b.score||0)-(a.score||0));
  if (mode === 'main') return ranked[0];
  if (mode === 'alt') return ranked[1] || ranked[0];
  const surprise = ranked.filter(h => h.bmb===1 || (h.result_rank!=null && h.result_rank>=3 && h.result_rank<=6) || historyStrengthForCandidate(h)>=0.30);
  return surprise[0] || ranked[Math.min(2, ranked.length-1)] || ranked[0];
}

function allHistoricalSurpriseCandidates(x){
  return (x.scored||[]).filter(h=>historicalSurpriseProfileMatch(x.r,h).matched && !isNonRunner(h));
}

function strictCandidatePool(x){
  const all = (x.scored || []).filter(h => !isNonRunner(h)).slice();
  const first6 = all.filter(h => h.result_rank != null && h.result_rank <= 6)
    .sort((a,b) => (b.score||0)-(a.score||0));
  const used = new Set(first6.map(h => String(h.horse_no)));

  const realBmb = all.filter(h => h.bmb === 1 && !used.has(String(h.horse_no)))
    .sort((a,b) => (b.score||0)-(a.score||0));
  realBmb.forEach(h => used.add(String(h.horse_no)));

  const history = all.filter(h => !used.has(String(h.horse_no)) && historyStrengthForCandidate(h) > 0 && (h.score||0) >= 0.30)
    .sort((a,b) => historyStrengthForCandidate(b)-historyStrengthForCandidate(a)
      || (b.priorWins||0)-(a.priorWins||0)
      || (b.score||0)-(a.score||0));
  history.forEach(h=>used.add(String(h.horse_no)));

  // Geçmişte bu ayrıntılı koşu profilinde kazanan hangi sürpriz sıralardan geldiyse,
  // güncel yarışta aynı profillere uyan bütün atları ekle. Skor eşiği uygulanmaz.
  const surpriseProfiles = all.filter(h => !used.has(String(h.horse_no)) && historicalSurpriseProfileMatch(x.r,h).matched)
    .sort((a,b)=>{
      const ma=historicalSurpriseProfileMatch(x.r,a).labels.length;
      const mb=historicalSurpriseProfileMatch(x.r,b).labels.length;
      return mb-ma || (b.score||0)-(a.score||0);
    });
  surpriseProfiles.forEach(h=>used.add(String(h.horse_no)));

  // AGF 1 (favori) atın gerçek AGF yüzdesi %18 veya üzerindeyse, SONUÇ/BMB/geçmiş
  // sinyallerinin hiçbiri tutmasa bile bu at havuza dahil edilir — kamu desteği tek
  // başına güçlü bir sinyaldir ve göz ardı edilmemelidir.
  const strongAgfPool = all.filter(h => !used.has(String(h.horse_no)) && h.agf_rank===1 && Number(h.agf)>=18)
    .sort((a,b)=>(b.score||0)-(a.score||0));
  strongAgfPool.forEach(h=>used.add(String(h.horse_no)));

  // HNDKP sırası 1 veya 2 olan at, hiçbir başka sinyali tutmasa bile havuza dahil edilir.
  const strongHndkpPool = all.filter(h => !used.has(String(h.horse_no)) && h.hndkp_rank!=null && h.hndkp_rank<=2)
    .sort((a,b)=>(a.hndkp_rank-b.hndkp_rank) || (b.score||0)-(a.score||0));
  strongHndkpPool.forEach(h=>used.add(String(h.horse_no)));

  // HNDKP'si düşük olsa da AGF'si alandaki en yakın rakibinden en az 15 puan yüksek olan
  // net favori de havuza dahil edilir.
  const withAgf = all.filter(h=>Number(h.agf)>0).sort((a,b)=>Number(b.agf)-Number(a.agf));
  const agfGapPool = [];
  if (withAgf.length>=2){
    const gap = Number(withAgf[0].agf) - Number(withAgf[1].agf);
    if (gap>=15 && !used.has(String(withAgf[0].horse_no))){
      agfGapPool.push(withAgf[0]);
      used.add(String(withAgf[0].horse_no));
    }
  }

  // YPUAN (yorumcu konsensüs puanı) ≥14 olan at -- yani en az bir yorumcu bu atı TEK
  // (banko) olarak göstermiş -- başka sinyal olmasa bile havuza dahil edilir.
  const strongYpuanPool = all.filter(h => !used.has(String(h.horse_no)) && Number(h.ypuan)>=14)
    .sort((a,b)=>(Number(b.ypuan)||0)-(Number(a.ypuan)||0));
  strongYpuanPool.forEach(h=>used.add(String(h.horse_no)));

  // TR profil motoru: TR1+AGF4-6 gizli favori ve ana sıralamanın altındaki güçlü
  // TR ayrışmaları havuz dışında bırakılamaz. Orijinal BMB alanı değiştirilmez.
  const trProfilePool = all.filter(h => !used.has(String(h.horse_no)) && (()=>{
    const p=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(x.r,h,all):null;
    return !!(p?.hardCoupon||p?.isBmb);
  })()).sort((a,b)=>{
    const pa=trGanyanProfileForHorse(x.r,a,all), pb=trGanyanProfileForHorse(x.r,b,all);
    return (Number(pb?.score)||0)-(Number(pa?.score)||0)||(tkpPredictionGcTrValue(b)||0)-(tkpPredictionGcTrValue(a)||0);
  });
  trProfilePool.forEach(h=>used.add(String(h.horse_no)));

  // Hiçbir özel sinyali (SONUÇ ilk 6 / BMB / geçmiş / AGF / HNDKP) olmasa bile, sadece TKP
  // skoruna göre en güçlü 2 at havuza eklenir. Böylece Tahmin ekranındaki "ilk 5" ile Kupon
  // havuzu arasında, salt yüksek skorlu bir at yüzünden fark oluşmaz.
  const topByScorePool = all.filter(h => !used.has(String(h.horse_no)))
    .sort((a,b)=>(b.score||0)-(a.score||0))
    .slice(0,2);
  topByScorePool.forEach(h=>used.add(String(h.horse_no)));

  return first6.concat(realBmb, history, surpriseProfiles, strongAgfPool, strongHndkpPool, agfGapPool, strongYpuanPool, trProfilePool, topByScorePool);
}

function raceSingleBaseThreshold(r){
  // Kullanıcı kuralı (V55.1): Ayak TEK eşiği sabit %68.
  // Koşu ailesi metni açıklamada kalır; gerçek TEK kararı %68 eşiğini kullanır.
  return 68;
}

function tkpAgfPct(h){const n=Number(h?.agf_pct??h?.agf??h?.agf_percent??h?.agf_rate);return Number.isFinite(n)?n:0;}
function tkpAgfTrapRaceSimilarity(current,historical){
  if(!current||!historical)return 0;
  let score=0,total=0;
  const eq=(a,b)=>String(a||'').trim().toLocaleUpperCase('tr-TR')===String(b||'').trim().toLocaleUpperCase('tr-TR');
  total+=3;if(eq(current.condition_family,historical.condition_family))score+=3;
  total+=2;if(eq(current.surface,historical.surface))score+=2;
  total+=2;const d1=Number(current.distance)||0,d2=Number(historical.distance)||0;if(d1&&d2&&Math.abs(d1-d2)<=200)score+=2;else if(eq(current.distance_group,historical.distance_group))score+=1;
  total+=1;if(eq(current.breed,historical.breed))score+=1;
  const cN=(current.horses||[]).filter(h=>!isNonRunner(h)).length,hN=(historical.horses||[]).filter(h=>!isNonRunner(h)).length;
  total+=1;if(cN&&hN&&Math.abs(cN-hN)<=2)score+=1;
  return total?Math.round(100*score/total):0;
}
function tkpAgfTrapAssessment(r,first){
  const currentAgf=tkpAgfPct(first);if(currentAgf<50)return {active:false,tier:0,penalty:0,block:false,hardBlock:false,sample:0,maxSimilarity:0,matches:[]};
  const all=(typeof db!=='undefined'&&Array.isArray(db?.races))?db.races:[];const currentDate=String(r?.race_date||'').slice(0,10);const matches=[];
  for(const old of all){
    if(!old||old===r||String(old?.id)===String(r?.id))continue;
    const oldDate=String(old?.race_date||'').slice(0,10);if(currentDate&&oldDate&&oldDate>=currentDate)continue;
    const horses=(old.horses||[]).filter(h=>!isNonRunner(h));if(!horses.length)continue;
    const fav=horses.slice().sort((a,b)=>tkpAgfPct(b)-tkpAgfPct(a))[0];const favAgf=tkpAgfPct(fav);if(favAgf<50)continue;
    const place=Number(fav?.finish_position)||(Number(fav?.winner)===1?1:0);if(place===1)continue;
    // Sonucu hiç doğrulanmamış kayıt öğrenme verisi değildir.
    if(!horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1))continue;
    const similarity=tkpAgfTrapRaceSimilarity(r,old);if(similarity<70)continue;
    matches.push({race:old,favorite:fav,agf:favAgf,place,similarity});
  }
  matches.sort((a,b)=>b.similarity-a.similarity||b.agf-a.agf||String(b.race?.race_date||'').localeCompare(String(a.race?.race_date||'')));
  const best=matches[0]||null;if(!best)return {active:false,tier:0,penalty:0,block:false,hardBlock:false,sample:0,maxSimilarity:0,matches:[]};
  const maxLostAgf=Math.max(...matches.map(x=>x.agf));const tier=maxLostAgf>=70?70:maxLostAgf>=60?60:50;
  return {active:true,tier,penalty:tier===50?8:0,block:tier>=60,hardBlock:tier>=70,sample:matches.length,maxSimilarity:best.similarity,maxLostAgf,best,matches:matches.slice(0,12)};
}
if(typeof window!=='undefined')window.tkpAgfTrapAssessment=tkpAgfTrapAssessment;

// V4.2 TEK KALİBRASYONU: TEK kararında yalnız lider güveni değil,
// lider-rakip ayrışması + yarış riski + bağımsız kanıt blokları birlikte kullanılır.
// Bu yardımcılar yalnız yarış-öncesi alanları okur; sonuç/winner/finish kullanmaz.
function tkpSingleRiskAssessment(r, first, second, poolArg=null){
  const pool=(Array.isArray(poolArg)?poolArg:(r?.horses||[])).filter(h=>h&&!isNonRunner(h));
  if(!first) return {score:100,band:'VERİ YOK',gap:0,agreement:0,strongRivals:0};
  const s1=typeof altiliWinnerScoreForHorse==='function'?Number(altiliWinnerScoreForHorse(r,first))||0:Number(first?.altili_winner_score)||0;
  const s2=second?(typeof altiliWinnerScoreForHorse==='function'?Number(altiliWinnerScoreForHorse(r,second))||0:Number(second?.altili_winner_score)||0):0;
  const gap=Math.max(0,s1-s2);
  const byAgf=pool.filter(h=>tkpAgfPct(h)>0).slice().sort((a,b)=>tkpAgfPct(b)-tkpAgfPct(a));
  const a1=tkpAgfPct(byAgf[0]),a2=tkpAgfPct(byAgf[1]),a3=tkpAgfPct(byAgf[2]);
  const agfGap=Math.max(0,a1-a2),top3Agf=a1+a2+a3;
  let strongRivals=0;
  for(const h of pool){
    if(String(h?.horse_no)===String(first?.horse_no)) continue;
    if((Number(profileStrengthPct(r,h))||0)>=50) strongRivals++;
  }
  const trRows=pool.filter(h=>Number.isFinite(tkpPredictionGcTrValue(h)));
  const trLeader=trRows.slice().sort((a,b)=>tkpPredictionGcTrValue(b)-tkpPredictionGcTrValue(a))[0]||null;
  const leaders=[String(first?.horse_no||''),String(byAgf[0]?.horse_no||''),String(trLeader?.horse_no||'')].filter(Boolean);
  const counts={};leaders.forEach(no=>counts[no]=(counts[no]||0)+1);
  const maxAgree=Math.max(0,...Object.values(counts));
  const agreement=leaders.length?maxAgree/leaders.length:0;
  let score=pool.length>=14?18:pool.length>=10?10:3;
  if(gap<5) score+=24; else if(gap<10) score+=15; else if(gap>=20) score-=6;
  if(a1>0&&a1<12) score+=15; else if(a1>0&&a1<18) score+=9;
  if(agfGap>0&&agfGap<3) score+=12;
  if(top3Agf>0&&top3Agf<40) score+=10;
  score+=Math.min(20,strongRivals*7);
  if(agreement<0.40&&leaders.length>=3) score+=15; else if(agreement>=0.60) score-=8;
  const cond=String(r?.condition_family||r?.condition_text||'').toLocaleUpperCase('tr-TR');
  if(/MAIDEN|HAND[İI]KAP/.test(cond)) score+=7;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const band=score<=20?'DÜŞÜK':score<=40?'ORTA-DÜŞÜK':score<=60?'ORTA':score<=80?'YÜKSEK':'ÇOK YÜKSEK';
  return {score,band,gap,agreement:Math.round(agreement*100),strongRivals};
}
function tkpSingleEvidenceAssessment(r, first, second, poolArg=null){
  const pool=(Array.isArray(poolArg)?poolArg:(r?.horses||[])).filter(h=>h&&!isNonRunner(h));
  const firstProfile=Number(profileStrengthPct(r,first))||0;
  const secondProfile=second?(Number(profileStrengthPct(r,second))||0):0;
  const market=Number(first?.agf_rank||99)<=2;
  const profile=firstProfile>=50&&(firstProfile-secondProfile)>=8;
  const trRows=pool.filter(h=>Number.isFinite(tkpPredictionGcTrValue(h)));
  const maxTr=trRows.length?Math.max(...trRows.map(tkpPredictionGcTrValue)):NaN;
  const tr=Number.isFinite(maxTr)&&tkpPredictionGcTrValue(first)===maxTr;
  const count=[market,profile,tr].filter(Boolean).length;
  return {market,profile,tr,count,firstProfile,secondProfile};
}
if(typeof window!=='undefined'){
  window.tkpSingleRiskAssessment=tkpSingleRiskAssessment;
  window.tkpSingleEvidenceAssessment=tkpSingleEvidenceAssessment;
}

let _tkpDynamicSingleDecisionCache=new WeakMap();

// Kayıtlı/eski yarış ekranı için ortak salt-okunur bağlamı. Arşiv açılışında
// yarış öncesi snapshot zaten kanıtın kendisidir; güncel öğrenme havuzunu tekrar
// taramak hem sonucu değiştirebilir hem de 3.000+ yarışlık depoda sekme tıklamasını
// dakikalarca bloke edebilir. Bu küçük yardımcılar yalnız arşiv UI yolunda
// kullanılır; canlı tahmin/kupon motorunun hesap yolu değişmez.
function tkpIsArchivedReadOnly(value){
  return !!(value && (value.__tkpArchivedReadOnly===true ||
    value.__tkpArchiveFast===true || value.r?.__tkpArchivedReadOnly===true));
}

function tkpArchivedOrderedRows(x){
  const source=Array.isArray(x?.scored)&&x.scored.length
    ? x.scored : (x?.r?.horses||[]);
  const rows=source.filter(h=>h&&!isNonRunner(h)).slice();
  const finite=v=>Number.isFinite(Number(v))&&Number(v)>0;
  return rows.sort((a,b)=>{
    const ar=finite(a?.prediction_order_snapshot)?Number(a.prediction_order_snapshot):
      (finite(a?._strategy_rank)?Number(a._strategy_rank):null);
    const br=finite(b?.prediction_order_snapshot)?Number(b.prediction_order_snapshot):
      (finite(b?._strategy_rank)?Number(b._strategy_rank):null);
    if(ar!==null||br!==null) return (ar??9999)-(br??9999) ||
      TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||''));
    const as=Number(a?.prediction_score_snapshot??a?.score)||0;
    const bs=Number(b?.prediction_score_snapshot??b?.score)||0;
    return bs-as || TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||''));
  });
}

function tkpArchivedEvidenceScore(r,h){
  if(!h) return 0;
  const parts=h.prediction_score_parts_snapshot||h.scoreParts||{};
  const commonValue=parts?.common;
  const commonPart=(commonValue===null||commonValue===undefined||commonValue==='')?NaN:Number(commonValue);
  if(Number.isFinite(commonPart)&&commonPart>=0){
    return Math.max(0,Math.min(100,(commonPart/0.65)*100));
  }
  const raw=Number(h.prediction_score_snapshot??h.score);
  if(!Number.isFinite(raw)||raw<=0) return 0;
  // Snapshotta ortak bileşen yoksa yalnız aynı ayaktaki frozen skor dağılımı
  // kullanılır. Bu, güncel model/sonuç taraması değildir.
  const rows=(r?.horses||[]).filter(x=>x&&!isNonRunner(x));
  const max=Math.max(0,...rows.map(x=>Number(x?.prediction_score_snapshot??x?.score)||0));
  return max>0?Math.max(0,Math.min(100,raw/max*100)):0;
}

function tkpArchivedDisplayDecision(x,firstArg=null,secondArg=null){
  const rows=tkpArchivedOrderedRows(x);
  const first=firstArg||rows[0]||null;
  const second=secondArg||rows.find(h=>String(h?.horse_no)!==String(first?.horse_no))||null;
  if(!first){
    return {isSingle:false,threshold:68,confidence:0,rawConfidence:0,margin:0,sample:0,
      firstRate:0,level:'Kayıtlı ODS',first:null,second:null,reason:'Kayıtlı aday yok',
      risk:{score:100,band:'VERİ YOK',gap:0,agreement:0,strongRivals:0},
      evidence:{count:0,market:false,profile:false,tr:false},evidenceOk:false,
      scoreOk:false,profileOk:false,profileGapOk:false,marginOk:false,sampleOk:false,
      weightOk:true,weightKg:null};
  }
  const scoreOf=h=>Number(h?.altili_winner_score??h?.sidebet_p1_score??h?.prediction_score_snapshot??h?.score)||0;
  const firstScore=scoreOf(first),secondScore=second?scoreOf(second):0;
  const explicitConfidenceValue=first?.archived_confidence_snapshot??first?.prediction_confidence_snapshot;
  const explicitConfidence=(explicitConfidenceValue===null||explicitConfidenceValue===undefined||explicitConfidenceValue==='')?NaN:Number(explicitConfidenceValue);
  const maxScore=Math.max(0,...rows.map(scoreOf));
  const confidence=Number.isFinite(explicitConfidence)
    ? Math.max(0,Math.min(100,Math.round(explicitConfidence)))
    : (maxScore>0?Math.max(0,Math.min(100,Math.round(firstScore/maxScore*100))):0);
  const margin=Math.max(0,firstScore-secondScore);
  let couponSingle=false;
  try{
    const coupons=typeof activeCoupons!=='undefined'?activeCoupons:null;
    const leg=coupons?.main?.legs?.find(z=>z?.r&&Number(z.r.leg)===Number(x?.r?.leg));
    couponSingle=Array.isArray(leg?.picks)&&leg.picks.length===1;
  }catch(_){ }
  return {
    isSingle:couponSingle,threshold:68,confidence,rawConfidence:confidence,margin,
    sample:0,firstRate:0,level:'Kayıtlı yarış-öncesi snapshot',first,second,
    firstProfile:Number(first?.prediction_profile_strength_snapshot??first?.profile_strength_snapshot??first?.profile_strength_pct)||0,
    secondProfile:Number(second?.prediction_profile_strength_snapshot??second?.profile_strength_snapshot??second?.profile_strength_pct)||0,
    profileGap:0,strongestRival:null,strongestRivalProfile:0,rivalProfileBlocked:false,
    xBreakSingle:false,agfTrap:{active:false,penalty:0,block:false,hardBlock:false},
    failureRisk:{active:false,penalty:0,reasons:[],sample:0},failureBlocked:false,
    risk:{score:0,band:'Kayıtlı snapshot',gap:margin,agreement:0,strongRivals:0},
    evidence:{count:0,market:false,profile:false,tr:false},evidenceOk:false,
    minWinnerGap:0,winnerGap:margin,scoreOk:firstScore>0,profileOk:true,profileGapOk:true,
    marginOk:true,sampleOk:true,weightOk:true,weightKg:null,
    reason:couponSingle?'Kayıtlı kupon TEK snapshotı · güncel model taranmadı':'Kayıtlı yarış öncesi snapshotı · güncel model taranmadı'
  };
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpIsArchivedReadOnly=tkpIsArchivedReadOnly;
  globalThis.tkpArchivedOrderedRows=tkpArchivedOrderedRows;
  globalThis.tkpArchivedEvidenceScore=tkpArchivedEvidenceScore;
  globalThis.tkpArchivedDisplayDecision=tkpArchivedDisplayDecision;
}

function tkpDynamicSingleMemoKey(x,first,second,strengthArg,marginArg){
  const dbSig=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${db?.files?.length||0}|${db?.races?.length||0}|${db?.prediction_log?.length||0}`;
  // Old persisted X fields are shadow-only and must not invalidate/recompute a
  // shared Normal/Sürpriz TEK decision differently from the same race without X.
  const hsig=h=>h?[h.horse_no,h.score,h.prediction_score_snapshot,h.altili_winner_score,h.agf,h.agf_rank,h.ypuan,h.value_score,h.hndkp_rank,h.jbyg,h.g800,h.weight_kg,h.bmb,h.odb,false,0].join(','):'-';
  // Rakiplerden birinin profil/puanı aynı saveDB turu içinde değişirse bile eski TEK
  // kararı cache'den dönmesin. Tüm ayak adaylarının kısa imzasını anahtara kat.
  const rivalSig=(x?.scored||x?.r?.horses||[]).map(h=>hsig(h)).join(';');
  let failureSig='';
  try{if(typeof tkpFailureLearningModel==='function'){const m=tkpFailureLearningModel(x?.r);failureSig=[m?.rows||0,m?.mainMiss||0,m?.singleLoss||0].join(':');}}catch(_){ }
  return [dbSig,failureSig,x?.r?.id||x?.r?.file_id||'',x?.r?.leg||'',hsig(first),hsig(second),rivalSig,strengthArg??'',marginArg??''].join('|');
}
function dynamicSingleDecision(x, firstArg=null, secondArg=null, strengthArg=null, marginArg=null){
  if(tkpIsArchivedReadOnly(x)) return tkpArchivedDisplayDecision(x,firstArg,secondArg);
  // 15/16 HIZ KİLİDİ: Kupon ve Back Test aynı ayak için bu kararı birkaç kez
  // soruyor. first/second açıkça verilmişse sonuç saf ve aynıdır; pahalı geçmiş
  // profil/AGF-tuzak taramasını aynı x üzerinde tekrar çalıştırma. Her dönüşte klon
  // verilir çünkü legCoveragePlan kendi yerel kararını sonradan değiştirebilir.
  let memoBucket=null,memoKey='';
  if(x&&typeof x==='object'&&firstArg){
    memoKey=tkpDynamicSingleMemoKey(x,firstArg,secondArg,strengthArg,marginArg);
    memoBucket=_tkpDynamicSingleDecisionCache.get(x);
    const hit=memoBucket?.get(memoKey);if(hit)return {...hit};
  }
  // TEK kararı tam olarak "kazanan BİRİNCİ tahminim mi" sorusudur; bu yüzden genel/geniş
  // tahminde kullanılan ilk-4 bazlı model yerine, özellikle ilk1 (k=1) isabetine göre
  // öğrenilmiş ağırlıklar kullanılır.
  const learnedModel=adaptiveWeightsForRace(x.r, 1);
  const basePool=(x.strictPool||strictCandidatePool(x)).slice();
  const pool=typeof altiliWinnerOrderForRace==='function'
    ? altiliWinnerOrderForRace(x.r,basePool)
    : basePool.sort((a,b)=>adaptiveCompositeScore(x.r,b,learnedModel)-adaptiveCompositeScore(x.r,a,learnedModel)||(b.score||0)-(a.score||0));
  const first=firstArg||pool[0]||null;
  const second=secondArg||pool[1]||null;
  if(!first) return {isSingle:false,threshold:99,confidence:0,margin:0,sample:0,firstRate:0,level:'Veri yok',reason:'Aday yok'};

  const strength=typeof altiliWinnerScoreForHorse==='function'
    ? altiliWinnerScoreForHorse(x.r,first)/100
    : (strengthArg!=null?strengthArg:adaptiveCompositeScore(x.r,first,learnedModel)/100);
  const secondStrength=second
    ? (typeof altiliWinnerScoreForHorse==='function'?altiliWinnerScoreForHorse(x.r,second)/100:adaptiveCompositeScore(x.r,second,learnedModel)/100)
    : 0;
  const margin=strength-secondStrength;
  const confidence=Math.max(0,Math.min(100,Math.round(strength*100)));

  const d=detailedRankStats(x.r,'result_rank');
  let st=d.stats, sample=st.total||0, level=d.match?.level||'Ayrıntılı profil';
  if(sample<5){
    const broad=statsByCondition('result_rank')[broadConditionKey(x.r.condition_family)];
    if(broad&&broad.total){st=broad;sample=broad.total;level='Koşu ailesi';}
  }
  const firstRate=sample?(st['1']||0)/sample:0;

  let threshold=raceSingleBaseThreshold(x.r);

  // Örnek sayısı güven ayarı
  if(sample===0) threshold+=7;
  else if(sample<5) threshold+=6;
  else if(sample<10) threshold+=4;
  else if(sample>0) threshold+=2/Math.sqrt(sample+1); // sert 20 örnek eşiği yerine sürekli düşük-örnek belirsizliği
  else if(sample>=40) threshold-=2;

  // Geçmişte 1. sıranın kazanma gücü
  if(firstRate>=0.60) threshold-=5;
  else if(firstRate>=0.48) threshold-=3;
  else if(firstRate>=0.38) threshold-=1;
  else if(firstRate>0 && firstRate<0.25) threshold+=5;

  // İlk iki adayın ayrışması
  if(margin>=0.22) threshold-=4;
  else if(margin>=0.14) threshold-=2;
  else if(margin<0.05) threshold+=6;
  else if(margin<0.09) threshold+=3;

  // Gerçek BMB yalnız tarihsel destek varsa eşiği hafif düşürür
  if(first.bmb===1 && first.bmb_source!=='ŞABLON KURALI'){
    const bs=detailedBmbStats(x.r);
    const bRate=bs.bmbRaces?bs.bmbWin/bs.bmbRaces:0;
    if(bs.bmbRaces>=5 && bRate>=0.40) threshold-=2;
  }

  // Kullanıcı kuralı (V55.1): Ayak TEK eşiği %68.
  // Önceki dinamik ayarlar teşhiste kalır; son karar sabit %68 eşiğiyle kilitlenir.
  threshold=68;

  const scoreOk=(first.score||0)>1.20;
  const firstProfile=profileStrengthPct(x.r,first);
  const secondProfile=second?profileStrengthPct(x.r,second):0;
  const profileGap=firstProfile-secondProfile;
  const profileOk=firstProfile>=50;
  const profileGapOk=profileGap>=8;
  const sampleOk=learnedModel.sample>=ADAPTIVE_MIN_RACES;
  const weightKg=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(first):null;
  const weightOk=!(weightKg!=null && weightKg>60);

  const decisionPool=(x?.scored||x?.r?.horses||basePool||[]).filter(h=>h&&!isNonRunner(h));
  const risk=tkpSingleRiskAssessment(x.r,first,second,decisionPool);
  const evidence=tkpSingleEvidenceAssessment(x.r,first,second,decisionPool);
  // V55.1 kullanıcı kilidi: düşük riskte %65 korunur; orta/yüksek riskte TEK üst eşiği %68.
  // Eski %70/%76 sertleşmesi kaldırıldı; risk, P1/P2 farkı ve veto kuralları ayrıca güvenlik filtresi olarak kalır.
  const calibratedThreshold=risk.score<70?65:68;
  const minWinnerGap=risk.score<70?12:(risk.score<80?15:18);
  const winnerGap=Number(risk.gap)||0;
  const marginOk=winnerGap>=minWinnerGap;

  // Eski "herhangi bir PROF>=50 rakip varsa TEK yasak" kuralı fazla sertti.
  // Artık yalnız çok güçlü (%60+) rakip ve profil farkı <10 ise veto edilir.
  const rivalPool=decisionPool.filter(h=>String(h.horse_no)!==String(first?.horse_no));
  let strongestRival=null, strongestRivalProfile=0;
  for(const h of rivalPool){
    const prof=Number(profileStrengthPct(x.r,h))||0;
    if(prof>strongestRivalProfile){ strongestRivalProfile=prof; strongestRival=h; }
  }
  const rivalProfileBlocked=strongestRivalProfile>=60 && profileGap<10;
  const xBreakSingle=false;
  // AGF >=%50 favori kayıpları yalnız TEK katmanında öğrenilir; TKP sırasını değiştirmez.
  const agfTrap=tkpAgfTrapAssessment(x.r,first);
  // V51: geçmişte TEK kaybedilen yarışlarda kazananı işaret eden pre-race sinyaller
  // bugünkü güçlü rakipte tekrar varsa TEK güveninden küçük/bounded ceza düşülür.
  let failureRisk={active:false,penalty:0,horse:null,reasons:[],sample:0};
  try{ if(typeof tkpFailureLearningSingleRisk==='function') failureRisk=tkpFailureLearningSingleRisk(x.r,first,decisionPool)||failureRisk; }catch(_){ }
  // Ortak 17-parametre karar katmanı yalnız yeterli geçmiş kanıt varsa TEK
  // güvenini ayarlar. Böylece TEK seçimi, Altılı/yan-bahis genişlikleriyle aynı
  // resmî-sonuç + yarış-öncesi-snapshot öğrenme sözleşmesini paylaşır.
  let decisionPolicy=null;
  try{
    decisionPolicy=typeof tkpAdaptiveDecisionPolicy==='function'
      ?tkpAdaptiveDecisionPolicy(x.r,pool,{mode:'main',product:'altili',position:1,fallback:2})
      :null;
  }catch(_){decisionPolicy=null;}
  const policyPenalty=decisionPolicy?.singleBlocked===true?5:0;
  let effectiveConfidence=Math.max(0,confidence-Number(agfTrap?.penalty||0)-Number(failureRisk?.penalty||0)-policyPenalty);
  threshold=calibratedThreshold;

  // En az iki bağımsız blok (AGF/piyasa, PROF, gerçek TR) lideri desteklemeli.
  const evidenceOk=evidence.count>=2;
  const failureBlocked=Number(failureRisk?.penalty||0)>=7;
  const isSingle=effectiveConfidence>=calibratedThreshold && marginOk && evidenceOk && weightOk && !rivalProfileBlocked && !xBreakSingle && !agfTrap.block && !failureBlocked && decisionPolicy?.singleBlocked!==true;

  const reasons=[];
  reasons.push(`${broadConditionKey(x.r.condition_family)} tek eşiği %${threshold}`);
  reasons.push(`${level} ${sample} koşu`);
  if(sample) reasons.push(`1. sıra başarı %${Math.round(firstRate*100)}`);
  reasons.push(`P1/P2 farkı ${winnerGap.toFixed(1)} puan (min ${minWinnerGap})`);
  reasons.push(`yarış riski ${risk.score}/100 · ${risk.band}`);
  reasons.push(`bağımsız onay ${evidence.count}/3${evidence.market?' · AGF':''}${evidence.profile?' · PROF':''}${evidence.tr?' · TR':''}`);
  if(!scoreOk) reasons.push('TKP ≤1,20');
  if(!profileOk) reasons.push('Profil Gücü < %70');
  if(!profileGapOk) reasons.push(`profil farkı ${profileGap} puan (<10)`);
  if(!sampleOk) reasons.push(`öğrenme verisi ${learnedModel.sample}/${ADAPTIVE_MIN_RACES}`);
  if(!marginOk) reasons.push(`P1/P2 farkı <${minWinnerGap}`);
  if(!evidenceOk) reasons.push('bağımsız onay <2/3');
  if(!weightOk) reasons.push(`kilo ${String(weightKg).replace('.',',')} kg (>60)`);
  if(rivalProfileBlocked) reasons.push(`rakip PROF %${Math.round(strongestRivalProfile)} (>=50) · TEK yasak`);
  if(xBreakSingle) reasons.push('X/hibrit güçlü rakip sinyali · TEK boz');
  if(agfTrap.active){
    if(agfTrap.tier===50)reasons.push(`AGF %50-59 benzer favori kaybı · güven -${agfTrap.penalty}`);
    else if(agfTrap.tier===60)reasons.push('AGF %60-69 benzer favori kaybı · NET TEK engeli');
    else reasons.push('AGF %70+ benzer favori kaybı · TEK kilidi');
  }
  if(failureRisk?.active){
    const rno=failureRisk?.horse?.horse_no||'-';
    reasons.push(`kaçırma öğrenmesi: rakip ${rno} · güven -${Number(failureRisk.penalty||0).toFixed(1)} · ${failureRisk.reasons.join('/')||'sinyal'}`);
  }
  if(failureBlocked) reasons.push('tekrarlayan TEK-kayıp profili · TEK kilidi');
  if(decisionPolicy?.status==='ÖĞRENİLDİ'){
    reasons.push(`17-parametre karar · n=${decisionPolicy.sample} · P1 %${Math.round((Number(decisionPolicy.leaderRate)||0)*100)} · ${decisionPolicy.tier}`);
  }
  if(decisionPolicy?.singleBlocked===true) reasons.push('17-parametre geçmiş P1 veto · TEK kilidi');

  const result={isSingle,threshold,confidence:effectiveConfidence,rawConfidence:confidence,margin,sample,firstRate,level,first,firstProfile,secondProfile,profileGap,
    strongestRival,strongestRivalProfile,rivalProfileBlocked,xBreakSingle,agfTrap,failureRisk,failureBlocked,risk,evidence,evidenceOk,minWinnerGap,winnerGap,
    scoreOk,profileOk,profileGapOk,marginOk,sampleOk,weightOk,weightKg,decisionPolicy,reason:reasons.join(' · ')};
  if(memoKey){
    const bucket=memoBucket||new Map();bucket.set(memoKey,{...result});
    while(bucket.size>8)bucket.delete(bucket.keys().next().value);
    _tkpDynamicSingleDecisionCache.set(x,bucket);
  }
  return {...result};
}

function singleDecisionStatusLabel(decision){
  if(!decision) return '-';
  // FIX (V1.1.212): "TEK · %68 güven" sabit metindi -- eşik değeri (68) yanlışlıkla
  // gerçek decision.confidence yerine hardcode edilmişti. Ekrandaki kalın yüzde
  // (üstteki %pct, d.confidence'tan geliyor) ile bu parantez içi etiket bu yüzden
  // hiç eşleşmiyordu (ör. üstte %73, burada hep %68). Artık gerçek güven kullanılıyor.
  if(decision.isSingle===true) return `TEK · %${Math.round(Number(decision.confidence)||0)} güven`;
  const confidence=Math.round(Number(decision.confidence)||0);
  const threshold=Math.round(Number(decision.threshold)||70);
  if(decision.agfTrap?.block===true)return decision.agfTrap?.hardBlock?'AGF %70+ geçmiş tuzağı · TEK kilidi':'AGF %60+ geçmiş tuzağı · NET TEK değil';
  if(decision.agfTrap?.tier===50&&Number(decision.rawConfidence)>confidence)return `AGF %50+ tuzak uyarısı · güven %${confidence}`;
  if(confidence<68) return `eşikten ${68-confidence} puan düşük`;
  if(decision.weightOk===false) return '60 kg üstü · TEK değil';
  if(decision.rivalProfileBlocked===true) return `rakip PROF %${Math.round(Number(decision.strongestRivalProfile)||0)} · TEK değil`;
  if(decision.xBreakSingle===true) return 'hibrit rakip sinyali · TEK değil';
  const reason=String(decision.reason||'');
  if(reason.includes('TKP ≤1,20')) return 'TKP puanı eşik altında';
  if(reason.includes('Profil Gücü < %70')) return 'profil gücü eşik altında';
  if(reason.includes('profil farkı')) return 'profil farkı eşik altında';
  if(reason.includes('öğrenme verisi')) return 'öğrenme verisi';
  if(Number(decision.margin)<0.05) return 'aday farkı eşik altında';
  return 'yardımcı TEK koşulu eksik';
}

function enforceBmbExtraInTop4(r, sortedRows){
  const list = (sortedRows||[]).slice();
  if(list.length<=4) return list;
  const top4 = list.slice(0,4);
  const rest = list.slice(4);
  const top4Nos = new Set(top4.map(h=>String(h.horse_no)));
  const isFlagged = h => isPastWinningBmb(h) || isPastWinningExtra(r,h);

  const missingBmb = rest.filter(h=>isPastWinningBmb(h) && !top4Nos.has(String(h.horse_no)));
  const missingExtra = rest.filter(h=>!isPastWinningBmb(h) && isPastWinningExtra(r,h) && !top4Nos.has(String(h.horse_no)));
  const missing = [...missingBmb, ...missingExtra];
  if(!missing.length) return list;

  const missingSet = new Set(missing.map(h=>String(h.horse_no)));
  let newRest = rest.filter(h=>!missingSet.has(String(h.horse_no)));

  const newTop4 = top4.slice();
  for(const h of missing){
    if(newTop4.length<4){ newTop4.push(h); continue; }
    let idx=-1;
    for(let i=newTop4.length-1;i>=0;i--){ if(!isFlagged(newTop4[i])){ idx=i; break; } }
    if(idx===-1) idx=newTop4.length-1; // ilk 4 tamamen işaretliyse en sondaki yine de yer değiştirir
    newRest = [newTop4[idx], ...newRest];
    newTop4[idx]=h;
  }
  // ilk 4 içindeki görüntü sırası, atların genel sıralamadaki güç sırasına göre korunur.
  tkpStableOrderSort(newTop4, list);
  return [...newTop4, ...newRest];
}

// KULLANICI TALİMATI: "Altılıya para verdiren" değer bandı artık sabit dört kriter
// değil -- SONUÇ 6-8, AGF 6-11 ve BMB/ODB sinyallerinin GERÇEK, güncel
// katkısı valueBandSignalWeights() ile activeRaces() üzerinden canlı ölçülüyor. Y.PUAN 8-20
// tek başına değer bandı değildir; yalnız ilk 8 dışı + BMB sinyali yoksa ODB sayılır. Bir
// kriterin katkısı (lift) sıfıra/altına düşerse (ör. BMB gerçekten hiçbir işe
// yaramıyorsa) o kriter otomatik devre dışı kalır -- elle eşik güncellemeye gerek yok.
// KÖK DÜZELTME (2026-08-09, kullanıcı uyarısı): "Accurate" verisi yarış BİTTİKTEN
// SONRA toplanır -- kupon kurulurken o yarışın kendi accurate_avg_speed_mps/
// accurate_finish_signal değeri asla mevcut değildir. İLK sürüm bu ayrımı gözetmeden
// yarışın kendi verisiyle test edilmişti; bu geriye dönük testte iyi görünüyordu ama
// gerçek kullanımda (kupon kurulurken bu veri hiç olmadığı için) tamamen etkisizdi.
// Artık atın DAHA ÖNCEKİ yarışlarındaki sızıntısız ortalaması (priorAccurateAvgSpeed/
// priorAccurateFinishSignal, bkz. stats-engine.js computeHorsePriorAccurateStats)
// kullanılıyor -- kupon kurulurken gerçekten elde mevcut olan bilgi budur.
function accurateFieldTopCandidate(h,r){
  if(!h||!r) return false;
  const live=(r.horses||[]).filter(x=>!isNonRunner(x));
  if(live.length<3) return false;
  // null/boş Accurate alanı JavaScript'te Number(null)===0 olduğu için eskiden
  // 'gerçek 0' sanılıyordu. Bir yarışta hiç geçmiş Accurate yokken bütün atlar
  // 0 ile eşitlenip 'en iyi Accurate' adayı olabiliyordu. Eksik ile gerçek sıfırı
  // ayır: hız yalnız pozitifse, bitiriş sinyali ise yalnız alan gerçekten varsa geçerli.
  const numericOrNull=value=>{
    if(value===null||value===undefined||String(value).trim()==='')return null;
    const n=Number(value);return Number.isFinite(n)?n:null;
  };
  const speedOf=x=>{const n=numericOrNull(x?.priorAccurateAvgSpeed);return n!==null&&n>0?n:null;};
  const finishOf=x=>numericOrNull(x?.priorAccurateFinishSignal);
  const speedVals=live.map(speedOf).filter(v=>v!==null);
  const finishVals=live.map(finishOf).filter(v=>v!==null);
  if(speedVals.length<3 && finishVals.length<3) return false;
  const speed=speedOf(h), finish=finishOf(h);
  const isTopSpeed=speedVals.length>=3 && speed!==null && speed>=Math.max(...speedVals);
  const isTopFinish=finishVals.length>=3 && finish!==null && finish>=Math.max(...finishVals);
  return isTopSpeed||isTopFinish;
}
function valueBandMatch(h,r){
  if(!h) return false;
  if(globalThis.__tkpCouponCriticalPath===true){
    return accurateFieldTopCandidate(h,r) || (h.result_rank!=null&&h.result_rank>=6&&h.result_rank<=8) || (h.agf_rank!=null&&h.agf_rank>=6&&h.agf_rank<=11) || h.bmb===1 || isOdbCandidate(h);
  }
  let w; try { w=valueBandSignalWeights(); } catch(_) { w=null; }
  const sonuc678=h.result_rank!=null && h.result_rank>=6 && h.result_rank<=8;
  const agf6_11=h.agf_rank!=null && h.agf_rank>=6 && h.agf_rank<=11;
  const bmbOdb=h.bmb===1 || isOdbCandidate(h);
  const accurateTop=accurateFieldTopCandidate(h,r);
  if(accurateTop) return true;
  if(!w) return sonuc678||agf6_11||bmbOdb; // veri yoksa (ör. test ortamı) sabit davranışa düş
  if(sonuc678 && w.sonuc678.weight>0) return true;
  if(agf6_11 && w.agf6_11.weight>0) return true;
  if(bmbOdb && w.bmbOdb.weight>0) return true;
  return false;
}
function valueBandScore(h,r){
  if(!h) return 0;
  if(accurateFieldTopCandidate(h,r)) return 1;
  if(globalThis.__tkpCouponCriticalPath===true){
    if(h.bmb===1||isOdbCandidate(h))return .75;
    if(h.result_rank!=null&&h.result_rank>=6&&h.result_rank<=8)return .55;
    if(h.agf_rank!=null&&h.agf_rank>=6&&h.agf_rank<=11)return .45;
    return 0;
  } // en yüksek öncelik -- yalnızca geçmiş yarışlardan ölçülmüş veri
  let w; try { w=valueBandSignalWeights(); } catch(_) { return 0; }
  if(!w) return 0;
  let s=0;
  if(h.result_rank!=null && h.result_rank>=6 && h.result_rank<=8) s=Math.max(s,w.sonuc678.weight);
  if(h.agf_rank!=null && h.agf_rank>=6 && h.agf_rank<=11) s=Math.max(s,w.agf6_11.weight);
  if(h.bmb===1 || isOdbCandidate(h)) s=Math.max(s,w.bmbOdb.weight);
  return s;
}
// BMB/ODB'nin TEK seçimindeki ikincil (eşit adaylar arası ayraç) ağırlığı da artık
// sabit +0,10 değil -- gerçek ölçülen katkısına göre küçülüp büyüyor. Katkı sıfıra
// düşerse (BMB gerçekten işe yaramıyorsa) bu ayraç da otomatik sıfırlanır.
function bmbOdbTieBreakWeight(){
  if(globalThis.__tkpCouponCriticalPath===true)return 0.05;
  try { return Math.min(0.10, valueBandSignalWeights().bmbOdb.weight*2); } catch(_) { return 0.10; }
}

function couponCandidateStrength(r, h, mode='main'){
  // Altılı kuponunda temel hedef yalnız kazananı bulmaktır. Bu puan Tahmin 1'in
  // bütün ayrıntılı analiz göstergelerinden öğrendiği gerçek birincilik gücüdür.
  const winnerStrength=typeof altiliWinnerScoreForHorse==='function'
    ? altiliWinnerScoreForHorse(r,h)/100
    : 0;
  let v = winnerStrength*1.25 + conditionSingleStrength(r,h)*0.45;
  const criticalCoupon=globalThis.__tkpCouponCriticalPath===true;
  const profileMatch=criticalCoupon?{matched:false,labels:[]}:historicalSurpriseProfileMatch(r,h);
  if(profileMatch.matched) v += (mode==='surprise' ? 0.90 : 0.28) + Math.min(0.35,profileMatch.labels.length*0.10);
  if (h.bmb===1){
    // BMB uyarılı atlar, sabit bir bonus yerine bu koşu şartında BMB'li atların gerçek geliş
    // (kazanma) yüzdesine göre ağırlıklandırılır; SONUÇ sırası da ayrıca dikkate alınır.
    const bmbRate = criticalCoupon ? 0 : conditionBmbWinRate(r,h);
    v += (mode==='surprise' ? 0.42 : 0.24) + bmbRate*0.5;
    // Geçmişte gelmiş BMB'ler yüksek ikramiye potansiyeli nedeniyle sıralamada ayrıca korunur.
    if(isPastWinningBmb(h)) v += (mode==='surprise' ? 0.48 : 0.34);
  }
  // ODB geçmiş kazanan demek değildir. Dört dışlama koşulunu sağlayan ODS dışı
  // bomba adayına kontrollü sürpriz desteği verilir; geçmiş/profil kanıtı ayrıca
  // bmbOdbWinLikelihood içinde yalnız sıralama amacıyla değerlendirilir.
  if(isOdbCandidate(h)){
    v += (mode==='surprise' ? 0.34 : 0.16) + Math.min(0.18,bmbOdbWinLikelihood(r,h)*0.18);
  }
  // Güncel koşunun sonuç sırası yarış-öncesi aday gücüne bonus veremez.
  // Tarihsel başarı yalnız cutoff uygulayan geçmiş özelliklerinden gelmelidir.
  v += Math.min(0.25, historyStrengthForCandidate(h)*0.50);
  v += Math.min(0.20, Math.max(0,h.score||0)*0.08);
  // YPUAN (8 yorumcunun konsensüs puanı, 0-112 arası teorik üst sınır) -- BMB'ye benzer
  // ama daha temkinli bir ağırlıkla katkı sağlar; 14 puan (tek bir TEK) ile 0,08,
  // ~50 puan (birkaç yorumcu hemfikir) ile üst sınıra (0,30) yaklaşır.
  v += Math.min(0.30, Math.max(0, Number(h.ypuan)||0) / 50 * 0.30);
  // KG ve DERECE artık kupon adayı sıralamasında küçük ama gerçek bir ayraçtır.
  // DERECE hızlıysa, KG rakiplere göre hafifse aday bir kademe öne çıkar; ana sinyalleri ezmez.
  v += kgDegreeTieBreakScore(r,h) * 0.10;
  const trProfile=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(r,h):null;
  if(trProfile?.hardCoupon) v += 0.34;
  else if(trProfile?.isBmb) v += mode==='surprise'?0.24:0.10;
  return v;
}


// TKP lideri bu değerin altındaysa koşuda belirgin bir TKP omurgası yok kabul edilir.
// Bu eşik, TEK kararındaki güvenli TKP alt sınırıyla aynıdır.
const YPUAN_FALLBACK_TKP_THRESHOLD = 1.20;

function bmbOdbWinLikelihood(r,h){
  if(globalThis.__tkpCouponCriticalPath===true){
    const hist=Math.max(0,Math.min(1,historyStrengthForCandidate(h)||0));
    const tkp=Math.max(0,Math.min(1,(Number(h.score)||0)/YPUAN_FALLBACK_TKP_THRESHOLD));
    const ypuan=Math.max(0,Math.min(1,(Number(h.ypuan)||0)/70));
    return hist*.55+tkp*.25+ypuan*.20;
  }
  // Bu bir yüzde/garanti değildir. BMB ve ODB adaylarını kendi aralarında sıralar.
  // ODB tanımında geçmiş galibiyet şartı yoktur; geçmiş/profil yalnız ek kanıttır.
  const hist=Math.max(0,Math.min(1,historyStrengthForCandidate(h)||0));
  const condSignal=Math.max(0,Math.min(1,Math.max(
    conditionBmbWinRate(r,h)||0,
    conditionRankWinRate(r,h)||0
  )));
  const starts=Math.max(0,Number(h.priorStarts)||0);
  const wins=Math.max(0,Number(h.priorWins)||0);
  const directRate=starts>0?Math.max(0,Math.min(1,wins/starts)):0;
  const surprise=historicalSurpriseProfileMatch(r,h);
  const profileEvidence=Math.max(0,Math.min(1,(surprise?.labels?.length||0)/4));
  const tkp=Math.max(0,Math.min(1,(Number(h.score)||0)/YPUAN_FALLBACK_TKP_THRESHOLD));
  const ypuan=Math.max(0,Math.min(1,(Number(h.ypuan)||0)/70));
  const kgDegree=kgDegreeTieBreakScore(r,h);
  const realBmb=(h.bmb===1 && h.bmb_source!=='ŞABLON KURALI')?0.03:0;
  return hist*0.40 + condSignal*0.21 + directRate*0.11 +
    profileEvidence*0.10 + tkp*0.08 + ypuan*0.06 + kgDegree*0.04 + realBmb;
}



function kgDegreeTieBreakScore(r,h){
  const kg = typeof tkpKgSignalValue==='function' ? tkpKgSignalValue(r,h) : 0;
  const dg = typeof tkpDegreeSignalValue==='function' ? tkpDegreeSignalValue(r,h) : 0;
  // DERECE daha somut performans göstergesi; KG sadece küçük ayraçtır.
  return dg*0.65 + kg*0.35;
}

function ypuanFallbackOrder(r, horses){
  const live=(horses||[]).filter(h=>!isNonRunner(h)).slice();
  if(!live.length) return [];
  const learned=adaptiveWeightsForRace(r,4);
  const adaptive=new Map(live.map(h=>[h,adaptiveCompositeScore(r,h,learned)]));

  // Güvenilir yüksek TKP yoksa ilk beş doğrudan yorumcu konsensüsüne (Y.PUAN) göre kurulur.
  // Eşitliklerde eski adaptif güç, TKP ve AGF sırası kullanılır.
  live.sort((a,b)=>
    (Number(b.ypuan)||0)-(Number(a.ypuan)||0) ||
    (adaptive.get(b)||0)-(adaptive.get(a)||0) ||
    (Number(b.score)||0)-(Number(a.score)||0) ||
    kgDegreeTieBreakScore(r,b)-kgDegreeTieBreakScore(r,a) ||
    (Number(b.agf)||0)-(Number(a.agf)||0)
  );

  const coreCount=Math.min(5,live.length);
  const core=live.slice(0,coreCount);
  const rest=live.slice(coreCount);

  // 6-7-8. sıralar, kalan BMB/ODB adayları içinden karşılaştırmalı güç/olabilirlik
  // skoru en yüksek olanlara ayrılır. ODB için geçmiş galibiyet zorunlu değildir.
  const flagged=rest.filter(h=>h.bmb===1 || isOdbCandidate(h,r)).sort((a,b)=>
    bmbOdbWinLikelihood(r,b)-bmbOdbWinLikelihood(r,a) ||
    (Number(b.ypuan)||0)-(Number(a.ypuan)||0) ||
    (Number(b.score)||0)-(Number(a.score)||0) ||
    kgDegreeTieBreakScore(r,b)-kgDegreeTieBreakScore(r,a)
  );
  const band=flagged.slice(0,Math.min(3,Math.max(0,live.length-coreCount)));
  const bandNos=new Set(band.map(h=>String(h.horse_no)));
  const tail=rest.filter(h=>!bandNos.has(String(h.horse_no)));
  return core.concat(band,tail);
}


function markYpuanTailOdbFlags(r, ordered){
  const list=(ordered||[]).slice();
  for(const h of list){ if(h) h._ypuanOdbTail=false; }
  // Y.PUAN 8-20 sadece ortak sıralamanın ilk 8'i dışında kalmışsa ve BMB sinyali yoksa
  // ODB kapsamına alınır. Bu işaret final bantlamadan önce konur ki geçmişte kazanan
  // ODB/BMB adayları 5-6-7 değer bandında öne taşınabilsin.
  list.forEach((h,i)=>{
    if(!h) return;
    const y=Number(h.ypuan)||0;
    if(i>=8 && y>=8 && y<=20 && typeof isOdbCandidate==='function' && isOdbCandidate(h,r)) h._ypuanOdbTail=true;
  });
  return list;
}

let _tkpTrRankContextCache=new WeakMap();
function trGanyanRankContext(r, ordered=null){
  const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r?.horses||[]).filter(h=>h&&!isNonRunner(h));
  // Kupon oluşturucusu aynı ayaktaki TR profilini yüzlerce kez sorabiliyor.
  // ordered verilmediğinde bağlam yalnız yarışın canlı atları, güvenilir GC-TR ve
  // güncel _strategy_rank ile belirlenir. İmza değişmedikçe sıralama/Map nesnelerini
  // yeniden üretmeyerek GC baskısını ve uzun tek-thread bloklarını kaldırır.
  if(!ordered&&r&&typeof r==='object'){
    const sig=live.map(h=>[
      String(h?.horse_no||''),
      Number.isFinite(tkpPredictionGcTrValue(h))?tkpPredictionGcTrValue(h):'NA',
      Number(h?._strategy_rank)||0,
      Number(h?.scratched||h?.non_runner||0)
    ].join(':')).join('|');
    const cached=_tkpTrRankContextCache.get(r);
    if(cached&&cached.horses===r.horses&&cached.sig===sig)return cached.ctx;
    const trRows=live.filter(h=>Number.isFinite(tkpPredictionGcTrValue(h)))
      .slice().sort((a,b)=>tkpPredictionGcTrValue(b)-tkpPredictionGcTrValue(a)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
    const trRank=new Map(trRows.map((h,i)=>[String(h.horse_no),i+1]));
    const ranked=live.filter(h=>Number(h?._strategy_rank)>0);
    const base=(ranked.length===live.length&&ranked.length)?ranked.slice().sort((a,b)=>Number(a._strategy_rank)-Number(b._strategy_rank)):[];
    const mainRank=new Map(base.map((h,i)=>[String(h.horse_no),i+1]));
    const tailStart=Math.max(1,live.length-2);
    let tailMax=-Infinity;
    for(const x of live){
      const rank=mainRank.get(String(x?.horse_no||''))||Number(x?._strategy_rank)||0;
      const tr=tkpPredictionGcTrValue(x);
      if(rank>=tailStart&&Number.isFinite(tr)&&tr>tailMax)tailMax=tr;
    }
    const ctx={live,trRows,trRank,mainRank,fieldSize:live.length,tailStart,tailMax};
    _tkpTrRankContextCache.set(r,{horses:r.horses,sig,ctx});
    return ctx;
  }
  const trRows=live.filter(h=>Number.isFinite(tkpPredictionGcTrValue(h)))
    .slice().sort((a,b)=>tkpPredictionGcTrValue(b)-tkpPredictionGcTrValue(a)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
  const trRank=new Map(trRows.map((h,i)=>[String(h.horse_no),i+1]));
  // V1.1.96: geçmiş sonucu olan bir yarışta yarış öncesi sıra yoksa atların mevcut
  // dizi sırasını "ana sıra" sanma. Bu, sonuç sonrası yapay TR-BMB üretirdi.
  let base=[];
  if(ordered&&ordered.length) base=ordered;
  else {
    const ranked=live.filter(h=>Number(h?._strategy_rank)>0);
    if(ranked.length===live.length&&ranked.length) base=ranked.slice().sort((a,b)=>Number(a._strategy_rank)-Number(b._strategy_rank));
  }
  const mainRank=new Map(base.map((h,i)=>[String(h.horse_no),i+1]));
  const tailStart=Math.max(1,live.length-2);
  let tailMax=-Infinity;
  for(const x of live){
    const rank=mainRank.get(String(x?.horse_no||''))||Number(x?._strategy_rank)||0;
    const tr=tkpPredictionGcTrValue(x);
    if(rank>=tailStart&&Number.isFinite(tr)&&tr>tailMax)tailMax=tr;
  }
  return {live,trRows,trRank,mainRank,fieldSize:live.length,tailStart,tailMax};
}

// V1.1.94 — TR DAVRANIŞ PROFİLİ
// Ganyan Canavarı TR puanı artık yalnız görüntüleme değildir. Ham puanı doğrudan
// TKP skoruna eklemek yerine yarış içi sıra + AGF + ana sıra ayrışması kullanılır.
// Böylece farklı gün/hipodromlardaki TR ölçekleri birbirine karıştırılmaz.
function trGanyanProfileForHorse(r,h,ordered=null){
  if(!r||!h||isNonRunner(h)) return {key:'',score:0,hardCoupon:false,isBmb:false,labels:[]};
  const ctx=trGanyanRankContext(r,ordered);
  const no=String(h.horse_no||'');
  const trScore=tkpPredictionGcTrValue(h);
  const trRank=ctx.trRank.get(no)||0;
  const mainRank=ctx.mainRank.get(no)||Number(h._strategy_rank)||0;
  const agfRank=Number(h.agf_rank)||0;
  const n=Math.max(1,ctx.fieldSize);
  if(!Number.isFinite(trScore)||!trRank) return {key:'',score:0,hardCoupon:false,isBmb:false,labels:[],trRank,mainRank,agfRank,trScore:null,fieldSize:n};

  let key='', score=0, hardCoupon=false, isBmb=false;
  const labels=[];
  // En güçlü gizli favori: kamu AGF'sinde 4-6 iken gerçek TR lideri.
  if(trRank===1 && agfRank>=4 && agfRank<=6){
    key='TR1_AGF4_6'; score=1; hardCoupon=true;
    labels.push('GİZLİ FVR','TR1',`AGF${agfRank}`);
  }else if(trRank===1 && agfRank>=7){
    key='TR1_AGF7P'; score=.90; isBmb=true;
    labels.push('TR-BMB','TR1',`AGF${agfRank}`);
  }

  const bottom3=mainRank>0 && mainRank>=Math.max(1,n-2);
  const bottomThird=mainRank>0 && mainRank>Math.ceil(n*2/3);
  const trTop3=trRank<=Math.min(3,n);
  if(!hardCoupon && bottom3 && trScore>=67){
    key=key||'TAIL3_TR67P'; score=Math.max(score,.82); isBmb=true;
    labels.splice(0,labels.length,'TR-BMB',`ANA ${mainRank}/${n}`,`TR ${trScore.toFixed(0)}`);
  }else if(!hardCoupon && bottomThird && trTop3){
    key=key||'TAIL_TR_TOP3'; score=Math.max(score,.76); isBmb=true;
    labels.splice(0,labels.length,'TR-BMB',`ANA ${mainRank}/${n}`,`TR sıra ${trRank}`);
  }

  // Son üçlü içinde kendi grubunun en yüksek TR'si de izlenir. 50 altındaki zayıf
  // değerler yalnız istatistiğe girer, kupon sinyali oluşturmaz.
  if(!hardCoupon && !isBmb && bottom3){
    const tailMax=Number(ctx.tailMax);
    if(Number.isFinite(tailMax)&&trScore===tailMax&&trScore>=50){
      key='TAIL3_TR_LOCAL_TOP'; score=.68; isBmb=true;
      labels.push('TR-BMB',`ALT GRUP TR1`,`TR ${trScore.toFixed(0)}`);
    }
  }

  // Donmuş geçmişten aynı profilin gerçek kazanma başarısı varsa küçük bir kalibrasyon
  // desteği verilir; düşük örnekli %100 sonuçlar asla sert kural yapmaz.
  let hist=null;
  // Kupon düğmesinin kritik yolunda soğuk TR geçmiş özeti 3.000+ koşuyu tek
  // senkron blokta tarayıp tarayıcıyı kilitliyordu. Kritik yol yalnız hazır cache'i
  // okuyabilir; cache hazır değilse aynı kanıt arka plan rafinasyonunda hesaplanır.
  // KRİTİK KUPON YOLU: burada cache-hazır mı kontrolü dahi yapılmaz. Eski kontrol
  // genel performans imzası üzerinden 33K+ prediction_log yan-bahis hash'ini ilk kez
  // senkron hesaplatabiliyor ve TR profil çağrısına 0.5-0.8 sn alakasız GC sıçraması
  // bindiriyordu. Tarihsel +0.10 kalibrasyon yalnız kritik yol DIŞINDA/arka planda gelir.
  const allowHistorical=globalThis.__tkpCouponCriticalPath!==true;
  if(key && allowHistorical && typeof trGanyanBehaviorStatsForKey==='function'){
    try{ hist=trGanyanBehaviorStatsForKey(r,key); }catch(_){ hist=null; }
    if(hist&&hist.starts>=5){
      const rate=Math.max(0,Math.min(1,Number(hist.winRate)||0));
      score=Math.min(1,score+Math.min(.10,rate*.10));
      labels.push(`${hist.wins}/${hist.starts}`);
    }
  }
  return {key,score,hardCoupon,isBmb,labels,trRank,mainRank,agfRank,trScore,fieldSize:n,historical:hist};
}

function annotateTrGanyanProfiles(r,ordered){
  const list=ordered||[];
  list.forEach((h,i)=>{ if(h) h._strategy_rank=i+1; });
  for(const h of list){
    const p=trGanyanProfileForHorse(r,h,list);
    h.tr_profile_key=p.key||'';
    h.tr_profile_score=Number(p.score)||0;
    h.tr_hidden_fav=p.hardCoupon?1:0;
    h.tr_bmb_candidate=p.isBmb?1:0;
    h.tr_profile_label=(p.labels||[]).join(' · ');
    h.tr_ganyan_rank=p.trRank||null;
  }
  return list;
}


// V1.1.96 — TÜM DOSYALAR TR PROFİL BACKFILL
// Mevcut arşivdeki her yarışa TR davranış etiketlerini bir kez taşır. Geçmişte
// sonucu bulunan yarışlarda ANA sıra yalnız yarış öncesi dondurulmuş skor/sıra
// mevcutsa kullanılır; finish_position / winner / sonuç sırası ASLA sıralama
// girdisi değildir. Böylece öğrenme sızıntısız kalır.
function tkpBackfillTrProfilesAllFiles(dbLike){
  const x=dbLike||(typeof db!=='undefined'?db:null);
  if(!x||!Array.isArray(x.races)) return false;
  // HIZ KİLİDİ: aynı veri kümesi daha önce bu backfill sürümüyle işlendi ise
  // açılışta yüzlerce/binlerce yarışı tekrar tarama. Yeni yarış eklendiğinde
  // race count değişeceği için backfill güvenle yeniden çalışır.
  const prev=x.settings?.tr_profile_backfill_last;
  if(x.settings?.tr_profile_backfill_version==='V1.1.96' && Number(prev?.races)===x.races.length) return false;
  let changed=false, racesTouched=0, horsesTouched=0;
  const finite=v=>Number.isFinite(Number(v));
  const set=(obj,key,val)=>{ if(obj[key]!==val){ obj[key]=val; changed=true; horsesTouched++; } };
  for(const r of x.races){
    const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r?.horses||[]).filter(h=>h&&!isNonRunner(h));
    if(!live.length) continue;
    const hasResult=live.some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0||Number(h?.result_position)>0);
    let ordered=null, safeFrozen=false;

    // 1) Önceden dondurulmuş sıra varsa en güvenli kaynak odur.
    const withFrozenRank=live.filter(h=>finite(h?.prediction_order_snapshot)&&Number(h.prediction_order_snapshot)>0);
    if(withFrozenRank.length===live.length){
      ordered=live.slice().sort((a,b)=>Number(a.prediction_order_snapshot)-Number(b.prediction_order_snapshot)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
      safeFrozen=true;
    } else {
      // 2) Yarış öncesi score snapshot tüm atlarda varsa buradan sıra dondur.
      const withSnap=live.filter(h=>finite(h?.prediction_score_snapshot));
      if(withSnap.length===live.length){
        ordered=live.slice().sort((a,b)=>Number(b.prediction_score_snapshot)-Number(a.prediction_score_snapshot)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
        safeFrozen=true;
        ordered.forEach((h,i)=>set(h,'prediction_order_snapshot',i+1));
      } else if(!hasResult){
        // 3) Henüz sonuçlanmamış kayıt: mevcut pre-race score güvenle kullanılabilir.
        const scored=live.filter(h=>finite(h?.score));
        if(scored.length===live.length){
          ordered=live.slice().sort((a,b)=>Number(b.score)-Number(a.score)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
        }
      }
    }

    // Ana sıra güvenli değilse yalnız TR+AGF temelli profilleri hesapla; tail/alt sıra
    // profillerine sahte sıra vermemek için ordered göndermiyoruz.
    const ctxOrder=ordered||[];
    if(ctxOrder.length) ctxOrder.forEach((h,i)=>{ if(h) h._strategy_rank=i+1; });
    let any=false;
    for(const h of live){
      const p=trGanyanProfileForHorse(r,h,ctxOrder.length?ctxOrder:null);
      // Güvenli bir ana sıra yoksa main-rank gerektiren TR-BMB profillerini kabul etme.
      const mainDependent=!!(p.key&&['TAIL3_TR67P','TAIL_TR_TOP3','TAIL3_TR_LOCAL_TOP'].includes(p.key));
      const use=(!mainDependent||!!ordered)?p:{...p,key:'',score:0,isBmb:false,labels:[]};
      const before=[h.tr_profile_key,h.tr_profile_score,h.tr_hidden_fav,h.tr_bmb_candidate,h.tr_profile_label,h.tr_ganyan_rank].join('|');
      set(h,'tr_profile_key',use.key||'');
      set(h,'tr_profile_score',Number(use.score)||0);
      set(h,'tr_hidden_fav',use.hardCoupon?1:0);
      set(h,'tr_bmb_candidate',use.isBmb?1:0);
      set(h,'tr_profile_label',(use.labels||[]).join(' · '));
      set(h,'tr_ganyan_rank',use.trRank||null);
      if(safeFrozen&&ordered){
        const mr=ordered.findIndex(z=>String(z.horse_no)===String(h.horse_no))+1;
        if(mr>0) set(h,'tr_main_rank_snapshot',mr);
      }
      const after=[h.tr_profile_key,h.tr_profile_score,h.tr_hidden_fav,h.tr_bmb_candidate,h.tr_profile_label,h.tr_ganyan_rank].join('|');
      if(before!==after) any=true;
    }
    if(any) racesTouched++;
  }
  if(x.settings){
    if(x.settings.tr_profile_backfill_version!=='V1.1.96'){ x.settings.tr_profile_backfill_version='V1.1.96'; changed=true; }
    x.settings.tr_profile_backfill_last={at:new Date().toISOString(),races:Number(x.races.length)||0,racesTouched,horsesTouched};
  }
  try{ if(typeof _trGanyanBehaviorCache!=='undefined'&&_trGanyanBehaviorCache?.clear) _trGanyanBehaviorCache.clear(); }catch(_){ }
  return changed;
}

function markStrategicRanks(ordered){
  (ordered||[]).forEach((h,i)=>{ if(h) h._strategy_rank=i+1; });
  return ordered||[];
}

function enforceYpuanEightIntoTopBand(r, ordered){
  const list=(ordered||[]).slice();
  if(list.length<=6) return list;
  const strong=list.filter(h=>(Number(h.ypuan)||0)>8);
  if(!strong.length) return list;
  const topBandSize=Math.min(8,list.length);
  const topBand=list.slice(0,topBandSize);
  const topNos=new Set(topBand.map(h=>String(h.horse_no)));
  const missing=strong.filter(h=>!topNos.has(String(h.horse_no)))
    .sort((a,b)=>(Number(b.ypuan)||0)-(Number(a.ypuan)||0) || (Number(b.score)||0)-(Number(a.score)||0) || kgDegreeTieBreakScore(r,b)-kgDegreeTieBreakScore(r,a));
  if(!missing.length) return list;
  let newTop=topBand.slice();
  let tail=list.slice(topBandSize);
  for(const h of missing){
    let replaceAt=-1;
    for(let i=newTop.length-1;i>=0;i--){
      const z=newTop[i];
      const protectedTop4=i<4;
      const zY=(Number(z.ypuan)||0)>8;
      const zCore=(Number(z.agf_rank)>=1&&Number(z.agf_rank)<=4)||(Number(z.score)||0)>=1.20||z.bmb===1||isOdbCandidate(z);
      if(!protectedTop4 && !zY && !zCore){ replaceAt=i; break; }
    }
    if(replaceAt<0) continue;
    tail=[newTop[replaceAt], ...tail];
    newTop[replaceAt]=h;
    const removeIdx=tail.findIndex(z=>String(z.horse_no)===String(h.horse_no));
    if(removeIdx>=0) tail.splice(removeIdx,1);
  }
  tkpStableOrderSort(newTop, list);
  return newTop.concat(tail);
}

function enforceBmbOdbFiveSevenBand(r, ordered){
  const list=(ordered||[]).slice();
  if(list.length<=5) return list;
  const top4=list.slice(0,4);
  const rest=list.slice(4);
  const topNos=new Set(top4.map(h=>String(h.horse_no)));
  const band=rest.filter(h=>(h.bmb===1||isOdbCandidate(h)) && !topNos.has(String(h.horse_no)))
    .sort((a,b)=>bmbOdbWinLikelihood(r,b)-bmbOdbWinLikelihood(r,a) || (Number(b.ypuan)||0)-(Number(a.ypuan)||0) || (Number(b.score)||0)-(Number(a.score)||0) || kgDegreeTieBreakScore(r,b)-kgDegreeTieBreakScore(r,a))
    .slice(0,3);
  if(!band.length) return list;
  const bandNos=new Set(band.map(h=>String(h.horse_no)));
  const restNoBand=rest.filter(h=>!bandNos.has(String(h.horse_no)));
  return top4.concat(band,restNoBand);
}

// Ortak sıra: ekran, kuponlar ve yan bahisler aynı sıralamayı kullanır.
function strategicOrderForRace(r, horses=null){
  const live=(horses||r?.horses||[]).filter(h=>!isNonRunner(h)).slice();
  if(!live.length) return [];

  const maxTkp=Math.max(0,...live.map(h=>Number(h.score)||0));
  if(maxTkp<YPUAN_FALLBACK_TKP_THRESHOLD){
    let ordered=ypuanFallbackOrder(r,live);
    if(typeof tkpPurposeWeightsForRace==='function' && typeof tkpPurposeCompositeScore==='function'){
      const model=tkpPurposeWeightsForRace(r,'prediction',4);
      const baseRank=new Map(ordered.map((horse,index)=>[horse,ordered.length-index]));
      const learnedScore=new Map(ordered.map(horse=>[
        horse,
        tkpPurposeCompositeScore(r,horse,'prediction',4,model)
      ]));
      ordered.sort((left,right)=>{
        const baseLeft=(baseRank.get(left)||0)/Math.max(1,ordered.length)*100;
        const baseRight=(baseRank.get(right)||0)/Math.max(1,ordered.length)*100;
        // KULLANICI KARARI (2026-08-09): stats-engine.js'teki ana yol ile aynı oran
        // (%40 registry / %60 eski) -- yedek (Y.PUAN düşük TKP) yolunda da tutarlı olsun.
        const scoreLeft=baseLeft*0.60+(learnedScore.get(left)||0)*0.40;
        const scoreRight=baseRight*0.60+(learnedScore.get(right)||0)*0.40;
        return scoreRight-scoreLeft
          || (Number(right.ypuan)||0)-(Number(left.ypuan)||0)
          || (Number(right.score)||0)-(Number(left.score)||0);
      });
    }
    ordered=enforceYpuanEightIntoTopBand(r,ordered);
    ordered=markYpuanTailOdbFlags(r,ordered);
    ordered=enforceBmbOdbFiveSevenBand(r,ordered);
    return annotateTrGanyanProfiles(r,markStrategicRanks(ordered));
  }

  // Belirgin TKP gücü varsa eski ZIP'in adaptif çoklu-sinyal omurgası korunur.
  let ordered=adaptiveOrderForRace(r,live);
  ordered=enforceBmbExtraInTop4(r,ordered);
  ordered=enforceYpuanEightIntoTopBand(r,ordered);
  ordered=markYpuanTailOdbFlags(r,ordered);
  ordered=enforceBmbOdbFiveSevenBand(r,ordered);
  return annotateTrGanyanProfiles(r,markStrategicRanks(ordered));
}

function g800TierPoints(v){
  if(v===1) return 20;
  if(v===2) return 15;
  if(v===3) return 10;
  if(v===4) return 6;
  return 0; // gerçekten okunmuş ama 5. sıra ve altı -- bilinçli 0, veri eksikliği değil.
}

function hndkpTierPoints(v){
  if(v===1) return 15;
  if(v===2) return 10;
  if(v===3) return 5;
  return 0; // gerçekten okunmuş ama 4. sıra ve altı -- bilinçli 0, veri eksikliği değil.
}

function jbygTierPoints(v){
  if(v===1) return 8;
  if(v===2) return 6;
  if(v===3) return 4;
  if(v===4) return 3;
  if(v===5) return 2;
  if(v===6) return 1;
  if(v===7) return 0.5;
  return 0;
}

function profileJBygRank(h){
  for(const value of [h?.jbyg,h?.jbyg_rank,h?.team_strength_rank]){
    const rank=Number(value);
    if(Number.isFinite(rank)&&rank>=1&&rank<=7) return Math.round(rank);
  }
  return null;
}

// EKSİK GALOP VERİSİ (800G / J-BYG null) için taraflılık düzeltmesi:
// Veri eksik atları otomatik "en kötü sıra" (0 puan) gibi cezalandırmak yanlış --
// bu, o at hakkında hiçbir şey bilmiyoruz demek, kötü performans göstergesi değil.
// Aynı yarışta veri BULUNAN atların ortalama puanı, veri eksik atlara nötr değer olarak uygulanır.
// Ayakta hiç veri yoksa (tüm atlar null) ortalama da 0 olur -- zaten eşit/taraf tutmaz durum.
function profileNeutralAverages(horses){
  if(!horses || !horses.length) return {g800Avg:0, hndkpAvg:0, jbygAvg:0};
  const g800Known = horses.filter(x=>x.g800!=null);
  const hndkpKnown = horses.filter(x=>x.hndkp_rank!=null);
  const jbygKnown = horses.map(x=>profileJBygRank(x)).filter(x=>x!=null);
  const g800Avg = g800Known.length
    ? g800Known.reduce((s,x)=>s+g800TierPoints(x.g800),0)/g800Known.length
    : 0;
  const hndkpAvg = hndkpKnown.length
    ? hndkpKnown.reduce((s,x)=>s+hndkpTierPoints(x.hndkp_rank),0)/hndkpKnown.length
    : 0;
  const jbygAvg = jbygKnown.length
    ? jbygKnown.reduce((sum,rank)=>sum+jbygTierPoints(rank),0)/jbygKnown.length
    : 0;
  return {g800Avg, hndkpAvg, jbygAvg};
}

function profileStrengthPct(r,h){
  const frozen=h?.prediction_profile_strength_snapshot??h?.profile_strength_snapshot;
  if(Number(h?.prediction_score_locked)===1&&frozen!==null&&frozen!==undefined&&frozen!==''&&Number.isFinite(Number(frozen))){
    return Math.max(0,Math.min(100,Math.round(Number(frozen))));
  }
  // Ham ODS profil puanı; ekranda ayrı koşu gücü sütunu gösterilmez.
  // S bandı, 800G, HNDKP/J-BYG, VALUE, SP ve AGF birlikte değerlendirilir.
  let pts = 0;

  // 38-41 bandı geçmiş sistemde güçlü profil işareti olarak kullanılıyor.
  if(h.s_value!=null && h.s_value>=38 && h.s_value<=41) pts += 30;
  else if(h.s_value!=null && h.s_value>=35 && h.s_value<=44) pts += 15;

  // Yarış içindeki VALUE ve SP seviyeleri. maxValue/maxSp yarış başına önbelleklenir --
  // önceden bu at başına yeniden hesaplanıyordu (bkz. state.js _profileRaceMaxCache).
  const horses = (r && r.horses) ? r.horses : null;
  let maxValue=0, maxSp=0, g800Avg=0, hndkpAvg=0, jbygAvg=0;
  if(horses){
    const cacheKey=horses;
    const cached=(typeof _profileRaceMaxCache!=='undefined') ? _profileRaceMaxCache.get(cacheKey) : null;
    if(cached){
      maxValue=cached.maxValue; maxSp=cached.maxSp; g800Avg=cached.g800Avg; hndkpAvg=cached.hndkpAvg; jbygAvg=cached.jbygAvg||0;
    } else {
      maxValue = Math.max(0, ...horses.map(x=>Number(x.value_score)||0));
      maxSp = Math.max(0, ...horses.map(x=>Number(x.sp)||0));
      const neutrals = profileNeutralAverages(horses);
      g800Avg = neutrals.g800Avg; hndkpAvg = neutrals.hndkpAvg; jbygAvg = neutrals.jbygAvg;
      if(typeof _profileRaceMaxCache!=='undefined') _profileRaceMaxCache.set(cacheKey,{maxValue,maxSp,g800Avg,hndkpAvg,jbygAvg});
    }
  }

  // 800G sırası -- veri varsa gerçek kademe puanı, yoksa yarış ortalaması (nötr).
  pts += (h.g800!=null) ? g800TierPoints(h.g800) : g800Avg;

  // HNDKP ve J-BYG iki ayrı sinyaldir. Önceki kod yorumda ikisini söylediği
  // hâlde yalnız HNDKP ekliyordu; J-BYG ODS'de dolsa bile Profil Gücü'ne hiç
  // girmiyordu. Eksik J-BYG yine yarış ortalamasıyla nötr kalır.
  pts += (h.hndkp_rank!=null) ? hndkpTierPoints(h.hndkp_rank) : hndkpAvg;
  const jbygRank=profileJBygRank(h);
  pts += jbygRank!=null ? jbygTierPoints(jbygRank) : jbygAvg;
  if(maxValue>0 && h.value_score!=null) pts += 15 * Math.max(0, Number(h.value_score)||0) / maxValue;
  if(maxSp>0 && h.sp!=null) pts += 10 * Math.max(0, Number(h.sp)||0) / maxSp;

  // AGF ilk 4 desteği
  if(h.agf_rank===1) pts += 14;
  else if(h.agf_rank===2) pts += 11;
  else if(h.agf_rank===3) pts += 8;
  else if(h.agf_rank===4) pts += 5;
  else if(h.agf_rank===5) pts += 3;
  else if(h.agf_rank===6) pts += 2;

  // KG + DERECE profil puanına çok sınırlı girer; profil gücünü şişirmesin diye toplam 8 puanı geçmez.
  pts += (typeof tkpDegreeSignalValue==='function' ? tkpDegreeSignalValue(r,h) : 0) * 5;
  pts += (typeof tkpKgSignalValue==='function' ? tkpKgSignalValue(r,h) : 0) * 3;

  return Math.max(0, Math.min(100, Math.round(pts)));
}

function profileSingleDecision(x){
  if(tkpIsArchivedReadOnly(x)){
    const d=dynamicSingleDecision(x);
    const first=d.first||null,second=d.second||null;
    const profile=first?Number(d.firstProfile)||0:0;
    const secondProfile=second?Number(d.secondProfile)||0:0;
    return {...d,first,second,profile,secondProfile,gap:Math.max(0,profile-secondProfile),
      tkp:first?Number(first.score)||0:0,agf:first&&first.agf!=null?Math.round(Number(first.agf)||0):null,
      total:Math.max(0,Math.min(100,Math.round(Number(d.confidence)||0))),strong:!!d.isSingle&&profile>=80};
  }
  const d=dynamicSingleDecision(x);
  const first=d.first||null;
  const second=first ? ((x?.scored||[]).filter(h=>!isNonRunner(h)&&String(h.horse_no)!==String(first.horse_no))
    .sort((a,b)=>{
      const learned=adaptiveWeightsForRace(x.r,1);
      return adaptiveCompositeScore(x.r,b,learned)-adaptiveCompositeScore(x.r,a,learned)||(b.score||0)-(a.score||0);
    })[0]||null) : null;
  const profile=first?profileStrengthPct(x.r,first):0;
  const secondProfile=d.secondProfile!=null?d.secondProfile:(second?profileStrengthPct(x.r,second):0);
  const gap=d.profileGap!=null?Math.max(0,d.profileGap):Math.max(0,profile-secondProfile);
  const tkp=first?Number(first.score)||0:0;
  const agf=first&&first.agf!=null?Math.round(Number(first.agf)||0):null;
  const total=first?Math.max(0,Math.min(100,Math.round(d.confidence||0))):0;
  const isSingle=!!d.isSingle;
  const strong=isSingle && profile>=80 && gap>=10;
  return {first,second,profile,secondProfile,gap,tkp,agf,total,isSingle,strong,threshold:d.threshold,confidence:d.confidence,reason:d.reason};
}

function forceFlaggedIntoPicks(r, picks, pool){
  const already=new Set((picks||[]).map(h=>String(h.horse_no)));
  const isBmbForced=h=>isPastWinningBmb(h)||h.bmb===1;
  const candidates=(pool||[]).filter(h=>!already.has(String(h.horse_no)) && (isBmbForced(h)||isExtraBadgeSignal(r,h)));
  if(!candidates.length) return {picks, forced:[]};
  const byScore=(a,b)=>(b.score||0)-(a.score||0);
  const isStrong=h=>(historyStrengthForCandidate(h)||0)>0 || (h.score||0)>=0.30;
  const bmbCands=candidates.filter(isBmbForced).sort(byScore);
  const odbCands=candidates.filter(h=>!isBmbForced(h)).sort(byScore);
  // BMB/ODB güçlü (gerçek geçmiş kazanma dayanağı veya belirgin skor) ise normal kombinasyon
  // (en fazla 3 BMB + 1 ODB ya da 2 BMB + 2 ODB) uygulanır. Hiçbiri güçlü değilse (zayıf/marjinal
  // sinyal), listeyi şişirmemek için sadece en güçlü TEK bir aday zorunlu eklenir.
  const anyStrong=bmbCands.some(isStrong)||odbCands.some(isStrong);
  let bmbTake,odbTake;
  if(anyStrong){
    bmbTake=bmbCands.slice(0,3);
    odbTake=odbCands.slice(0,Math.min(2,4-bmbTake.length));
  } else {
    const combined=bmbCands.concat(odbCands).sort(byScore);
    bmbTake=combined.slice(0,1);
    odbTake=[];
  }
  const forced=bmbTake.concat(odbTake);
  if(!forced.length) return {picks, forced:[]};
  return {picks:(picks||[]).concat(forced), forced};
}

function bestPastWinnerCandidate(r, pool){
  let best=null, bestStrength=0;
  for(const h of pool){
    const isBmbOrOdb=(isPastWinningBmb(h)||h.bmb===1||isOdbCandidate(h));
    if(!isBmbOrOdb) continue;
    const s=historyStrengthForCandidate(h)||0;
    if(s>bestStrength){ bestStrength=s; best=h; }
  }
  return best;
}

function relaxedSingleForRace(raceX){
  const plan=historicalCoveragePlan(raceX);
  let single=(plan.singleDecision && plan.singleDecision.isSingle && plan.singleDecision.first) ? plan.singleDecision.first : null;
  if(!single && raceX.top && (raceX.top.score||0) > 1.40){
    single = raceX.top;
  }
  if(!single){
    for(const typeKey of ['main','alt','surprise']){
      const coupon=activeCoupons[typeKey];
      if(!coupon || !Array.isArray(coupon.legs)) continue;
      const leg=coupon.legs.find(l=>Number(l.r.leg)===Number(raceX.r.leg));
      if(leg && leg.protectedFlag && leg.picks && leg.picks.length===1){
        single = leg.picks[0];
        break;
      }
    }
  }
  return single;
}
