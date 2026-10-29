// İstatistik ve önbellekli analiz katmanı (kazanma oranları, profil eşleşme, adaptif öğrenme).


function detailedProfileMatch(target, minSample=5){
  const cutoff=target&&typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(target,db):'';
  const cacheKey = target && target.id != null ? [tkpStatsCacheSignature(),target.id,cutoff,minSample].join('|') : null;
  if (cacheKey && _profileMatchCache.has(cacheKey)) return _profileMatchCache.get(cacheKey);
  const levels=profileCandidates(target);
  const enough=levels.find(x=>x.rows.length>=minSample);
  const any=levels.find(x=>x.rows.length>0);
  const result = enough || any || {level:'Veri yok',label:raceProfileLabel(target),rows:[]};
  if (cacheKey) _profileMatchCache.set(cacheKey, result);
  return result;
}

let _similarConditionProfileStatsCache=new WeakMap();

// G.PR yalnız aynı/benzer koşu şartı havuzundan hesaplanır. Önce aynı atın bu
// havuzdaki eski koşuları aranır; yoksa hedef atın ODS sinyal profiline en yakın
// tek at, her geçmiş koşudan bir örnek olarak alınır. Böylece genel Son 6 formu
// yanlışlıkla "benzer koşu" diye gösterilmez ve bir geçmiş yarış çok sayıda
// eşleşmeyle paydayı şişiremez.
function tkpGprNonWinnerCondition(r){
  const label=[r?.condition_family,r?.condition_text].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').toUpperCase();
  if(/MAIDEN/.test(label))return 'MAIDEN';
  const match=label.match(/SARTLI\s*(19|1)(?=\D|$)/);return match?'SARTLI '+match[1]:'';
}
function similarConditionProfileStats(targetRace,targetHorse){
  if(!targetRace||!targetHorse) return {starts:0,wins:0,top3:0,strength:0,level:'Veri yok',direct:false};
  const signature=db?.learning_state?.dataset_signature
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):String((db?.races||[]).length));
  const cacheKey=['GPR_NONWINNER_V2',signature,String(targetHorse.horse_no||''),fold(targetHorse.horse_name||'')].join('|');
  let raceCache=_similarConditionProfileStatsCache.get(targetRace);
  if(!raceCache){ raceCache=new Map(); _similarConditionProfileStatsCache.set(targetRace,raceCache); }
  if(raceCache.has(cacheKey)) return raceCache.get(cacheKey);

  const profile=detailedProfileMatch(targetRace,5);
  // Benzer profil indeksi yarış-öncesi kesimi uygulasa da bu ikinci kapı kasıtlı
  // olarak burada durur: stats modülü başka bir sağlayıcıdan satır aldığında da
  // hedef tarih/no sonrasını asla kullanamaz. Eski "yalnız 23.08 sonrası" istisnası
  // kaldırıldı; 503 geçmiş kartı da aynı kurala uyar.
  const eligibleRows=typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget(profile.rows||[],targetRace,db)
    :(profile.rows||[]);
  const nonWinnerKind=tkpGprNonWinnerCondition(targetRace);
  const rows=nonWinnerKind?eligibleRows.filter(past=>tkpGprNonWinnerCondition(past)===nonWinnerKind):eligibleRows;
  const targetName=fold(targetHorse.horse_name||'');
  const directRows=[];
  for(const race of rows){
    const hit=(race.horses||[]).find(h=>!isNonRunner(h)&&fold(h.horse_name||'')===targetName);
    if(hit) directRows.push(hit);
  }

  const features=[
    ['result_rank',1.4],['agf_rank',1.2],['tr_rank',1],['hndkp_rank',0.8],
    ['sp_rank',0.8],['value_rank',0.8],['g800',0.7],['jbyg',0.6],['start_no',0.4]
  ];
  const nearest=[];
  const directWins=directRows.filter(h=>Number(h.winner)===1||Number(h.finish_position)===1).length;
  const useNearest=!directRows.length||(nonWinnerKind&&!directWins);
  if(useNearest){
    for(const race of rows){
      let best=null;
      for(const horse of (race.horses||[])){
        if(isNonRunner(horse)) continue;
        let score=0,total=0,compared=0;
        for(const [field,weight] of features){
          const a=Number(targetHorse?.[field]),b=Number(horse?.[field]);
          if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0) continue;
          score+=Math.max(0,1-Math.min(6,Math.abs(a-b))/6)*weight;
          total+=weight; compared++;
        }
        if(targetHorse.bmb!=null&&horse.bmb!=null){
          score+=(Number(targetHorse.bmb)===Number(horse.bmb)?1:0)*0.5; total+=0.5; compared++;
        }
        const similarity=total?score/total:0;
        if(compared>=3&&similarity>=0.45&&(!best||similarity>best.similarity)) best={horse,similarity};
      }
      if(best) nearest.push(best.horse);
    }
  }
  const usedNearest=useNearest&&nearest.length>0;
  const samples=usedNearest?nearest:directRows;
  const wins=samples.filter(h=>Number(h.winner)===1||Number(h.finish_position)===1).length;
  const top3=samples.filter(h=>{const p=Number(h.finish_position ?? (Number(h.winner)===1?1:NaN));return p>=1&&p<=3;}).length;
  const result={
    starts:samples.length,wins,top3,
    strength:samples.length&&wins>0?wilson(wins,samples.length):0,
    level:profile.level||'Benzer profil',label:profile.label||'',direct:!usedNearest&&directRows.length>0
  };
  raceCache.set(cacheKey,result);
  return result;
}

const _detailedRankStatsCache=new Map();
const _detailedBmbStatsCache=new Map();
const _targetConditionStatsCache=new Map();
const _targetBmbConditionStatsCache=new Map();
function tkpStatsCacheSignature(){
  // R16.36: Dashboard/istatistik özeti prediction_log, kupon, tanı veya diğer
  // yardımcı loglardan etkilenmez. Geniş tkpFastDbSignature() bunlardan biri
  // değiştiğinde aynı 3.054 koşuyu yeniden taratıyordu.
  return ['STATS_CORE_V6_INTEGER_RESULT_FIELDS',String(db?.learning_state?.dataset_signature||''),String(db?.learning_state?.outcome_signature||''),(db?.files||[]).length,(db?.races||[]).length,typeof _tkpDbRevision==='number'?_tkpDbRevision:0].join('|');
}
// Eski/aktarılmış sonuçlarda winner bayrağı her zaman doldurulmaz. Tabloların
// tamamı aynı doğrulanmış bitiriş yorumunu kullanmalı; aksi halde aynı kayıt bir
// yerde kazanmış, başka yerde sonuçsuz görünüyordu.
function tkpAnalysisFinishPosition(horse){
  for(const value of [horse?.finish_position,horse?.result_position,horse?.official_position,horse?.place]){
    if(value==null||typeof value==='boolean'||String(value).trim()==='')continue;
    const n=Number(value);if(Number.isSafeInteger(n)&&n>0)return n;
  }
  return Number(horse?.winner)===1?1:0;
}
function tkpAnalysisRank(value){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function tkpAnalysisIsWinner(horse){return tkpAnalysisFinishPosition(horse)===1;}
function tkpAnalysisRaces(){return tkpBoundedRacesForReport(learningEligibleRaces());}
if(typeof globalThis!=='undefined'){
  globalThis.tkpAnalysisFinishPosition=tkpAnalysisFinishPosition;
  globalThis.tkpAnalysisIsWinner=tkpAnalysisIsWinner;
}
function detailedRankStats(target, rankField){
  const cacheKey=`${tkpStatsCacheSignature()}|${target?.id??target?.leg??''}|${rankField}`;
  if(_detailedRankStatsCache.has(cacheKey)) return _detailedRankStatsCache.get(cacheKey);
  const m=detailedProfileMatch(target,5);
  const g={'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0,total:0};
  for(const r of m.rows){
    for(const w of r.horses.filter(tkpAnalysisIsWinner)){
      g.total++; const rk=w[rankField];
      if(rk==null) g.yok++; else if(rk<=7) g[String(rk)]++; else if(rk===8) g.alt1++; else if(rk===9) g.alt2++; else if(rk===10) g.alt3++; else g.alt4++;
    }
  }
  const result={match:m,stats:g};
  _detailedRankStatsCache.set(cacheKey,result);
  if(_detailedRankStatsCache.size>80) _detailedRankStatsCache.delete(_detailedRankStatsCache.keys().next().value);
  return result;
}

function detailedBmbStats(target){
  const cacheKey=`${tkpStatsCacheSignature()}|${target?.id??target?.leg??''}|BMB`;
  if(_detailedBmbStatsCache.has(cacheKey)) return _detailedBmbStatsCache.get(cacheKey);
  const m=detailedProfileMatch(target,5);
  let bmbRaces=0,bmbWin=0;
  for(const r of m.rows){ const bs=r.horses.filter(h=>Number(h.bmb)===1); if(bs.length){bmbRaces++; if(bs.some(tkpAnalysisIsWinner)) bmbWin++;} }
  const result={match:m,bmbRaces,bmbWin};
  _detailedBmbStatsCache.set(cacheKey,result);
  if(_detailedBmbStatsCache.size>40) _detailedBmbStatsCache.delete(_detailedBmbStatsCache.keys().next().value);
  return result;
}

function winnerRankDistributionBroad(rankField){
  let groups = {};
  for (const r of learningEligibleRaces()){
    let key = broadConditionKey(r.condition_family);
    let winners = r.horses.filter(tkpAnalysisIsWinner);
    if (!winners.length) continue;
    let g = groups[key] || (groups[key] = {'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0, total:0});
    for (const w of winners){
      g.total++;
      const rk = Number(w[rankField]);
      if (!Number.isInteger(rk) || rk < 1) g.yok++;
      else if (rk <= 7) g[String(rk)]++;
      else if (rk === 8) g.alt1++;
      else if (rk === 9) g.alt2++;
      else if (rk === 10) g.alt3++;
      else g.alt4++;
    }
  }
  return groups;
}

function statsByCondition(rankField){
  if (_statsByConditionCache.has(rankField)) return _statsByConditionCache.get(rankField);
  const result = winnerRankDistributionBroad(rankField);
  _statsByConditionCache.set(rankField, result);
  return result;
}

function tkpTrainingRowsForStats(targetRace){
  const rows=learningEligibleRaces();
  if(!targetRace)return rows;
  return typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget(rows,targetRace,db)
    :[];
}
function tkpTargetStatsKey(targetRace,kind){
  const cutoff=typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'';
  return [tkpStatsCacheSignature(),cutoff,kind].join('|');
}
// V1.1.330 LIVE-509 HIZ FIX: conditionSingleStrength() geçmişte her hedef
// koşu için tkpTrainingRowsBeforeTarget() ile 3.000 koşunun tamamını tekrar
// filtreliyordu. 509 gerçek yedekte yalnız son 120 koşunun `condition` sinyali
// ~6,1 saniye sürdü; tüm arşiv dakikalara çıkıyordu. Tüm yarışlarda ISO tarih
// mevcutsa aynı-gün sonuçları zaten eğitim dışı olduğundan, koşul istatistikleri
// tarihe göre tek kronolojik geçişte ön-hesaplanabilir. Sonuç semantiği aynıdır:
// her tarih yalnız kendisinden ÖNCEKİ günleri görür.
let _tkpConditionPrefixCache={signature:'',byDate:new Map()};
function tkpConditionPrefixIndex(){
  const signature=typeof tkpStatsCacheSignature==='function'?String(tkpStatsCacheSignature()):String(_tkpDbRevision||0);
  if(_tkpConditionPrefixCache.signature===signature&&_tkpConditionPrefixCache.byDate.size)return _tkpConditionPrefixCache.byDate;
  const rows=learningEligibleRaces();
  const byDate=new Map();
  for(const r of rows){
    const date=String(r?.race_date||r?.date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
      _tkpConditionPrefixCache={signature:'',byDate:new Map()};
      return null;
    }
    if(!byDate.has(date))byDate.set(date,[]);
    byDate.get(date).push(r);
  }
  const dates=[...byDate.keys()].sort();
  const rankAccum={},bmbAccum={},prefix=new Map();
  const cloneRank=()=>{
    const out={};
    for(const [k,g] of Object.entries(rankAccum))out[k]={...g};
    return out;
  };
  const cloneBmb=()=>{
    const out={};
    for(const [k,g] of Object.entries(bmbAccum))out[k]={...g};
    return out;
  };
  for(const date of dates){
    // Snapshot ÖNCE alınır: aynı günün sonuçları o günkü hedef yarışlarda eğitim
    // verisi değildir (tkpRowIsBeforeTarget ile birebir aynı kural).
    prefix.set(date,{rank:cloneRank(),bmb:cloneBmb()});
    for(const r of byDate.get(date)){
      const condition=broadConditionKey(r.condition_family);
      const winners=(r.horses||[]).filter(tkpAnalysisIsWinner);
      if(winners.length){
        const g=rankAccum[condition]||(rankAccum[condition]={'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0,total:0});
        for(const w of winners){
          g.total++;const rk=w.result_rank;
          if(rk==null)g.yok++;else if(rk<=7)g[String(rk)]++;else if(rk===8)g.alt1++;else if(rk===9)g.alt2++;else if(rk===10)g.alt3++;else g.alt4++;
        }
      }
      const bmb=(r.horses||[]).filter(h=>Number(h.bmb)===1);
      if(bmb.length){
        const g=bmbAccum[condition]||(bmbAccum[condition]={bmbRaces:0,bmbWin:0});
        g.bmbRaces++;if(bmb.some(tkpAnalysisIsWinner))g.bmbWin++;
      }
    }
  }
  _tkpConditionPrefixCache={signature,byDate:prefix};
  return prefix;
}
function tkpConditionPrefixForTarget(targetRace){
  if(!targetRace)return null;
  // Tarihsel kalibrasyon özel olarak tüm historical-set çiftlerini serbest
  // bırakıyorsa eski semantik korunur ve hızlı prefix kullanılmaz.
  try{if(typeof tkpHistoricalCalibrationRace==='function'&&tkpHistoricalCalibrationRace(targetRace,db))return null;}catch(_e){}
  const date=String(targetRace?.race_date||targetRace?.date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  const index=tkpConditionPrefixIndex();
  return index?.get(date)||null;
}

const _tkpTargetConditionBundleCache=new Map();
function tkpTargetConditionBundle(targetRace){
  if(!targetRace)return null;
  const key=tkpTargetStatsKey(targetRace,'RANK_BMB_BUNDLE');
  if(_tkpTargetConditionBundleCache.has(key))return _tkpTargetConditionBundleCache.get(key);
  const rank={},bmb={};
  const rows=learningEligibleRaces();
  // Tek hedef için rank ve BMB istatistiğini aynı kronolojik geçişte üret. Eski
  // uygulama iki ayrı filtered-array yaratarak aynı 3.000+ koşuyu iki kez tarıyor,
  // kupon sırasında bellek/GC sıçraması yaratıyordu.
  for(const r of rows){
    if(typeof tkpRowIsBeforeTarget==='function'&&!tkpRowIsBeforeTarget(r,targetRace,db))continue;
    const condition=broadConditionKey(r.condition_family);
    const winners=(r.horses||[]).filter(tkpAnalysisIsWinner);
    if(winners.length){
      const g=rank[condition]||(rank[condition]={'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0,total:0});
      for(const w of winners){
        g.total++;const rk=w.result_rank;
        if(rk==null)g.yok++;else if(rk<=7)g[String(rk)]++;else if(rk===8)g.alt1++;else if(rk===9)g.alt2++;else if(rk===10)g.alt3++;else g.alt4++;
      }
    }
    const bs=(r.horses||[]).filter(h=>Number(h.bmb)===1);
    if(bs.length){
      const g=bmb[condition]||(bmb[condition]={bmbRaces:0,bmbWin:0});
      g.bmbRaces++;if(bs.some(tkpAnalysisIsWinner))g.bmbWin++;
    }
  }
  const bundle={rank,bmb};
  _tkpTargetConditionBundleCache.set(key,bundle);
  if(_tkpTargetConditionBundleCache.size>48)_tkpTargetConditionBundleCache.delete(_tkpTargetConditionBundleCache.keys().next().value);
  return bundle;
}

function statsByConditionForTarget(rankField,targetRace){
  if(!targetRace)return statsByCondition(rankField);
  // Tarihsel kalibrasyon setinde tkpHistoricalCalibrationPairAllowed() bütün
  // tarihsel satırları hedefe serbest bırakır. Eski kod buna rağmen aynı tam
  // 3.000+ koşuluk dağılımı her hedef ayak için yeniden kuruyordu. Sonuç
  // semantiği birebir statsByCondition() ile aynıdır; global cache'i kullanmak
  // kupon tıklamasındaki gereksiz O(ayak × arşiv) taramasını kaldırır.
  try{
    if(typeof tkpHistoricalCalibrationRace==='function'&&tkpHistoricalCalibrationRace(targetRace,db)){
      return statsByCondition(rankField);
    }
  }catch(_e){}
  if(rankField==='result_rank'){
    const prefix=tkpConditionPrefixForTarget(targetRace);
    if(prefix)return prefix.rank;
    const bundle=tkpTargetConditionBundle(targetRace);
    if(bundle)return bundle.rank;
  }
  const key=tkpTargetStatsKey(targetRace,'RANK:'+rankField);
  if(_targetConditionStatsCache.has(key))return _targetConditionStatsCache.get(key);
  const result={};
  for(const r of tkpTrainingRowsForStats(targetRace)){
    const condition=broadConditionKey(r.condition_family);
    const winners=(r.horses||[]).filter(tkpAnalysisIsWinner);
    if(!winners.length)continue;
    const g=result[condition]||(result[condition]={'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0,total:0});
    for(const w of winners){
      g.total++;const rk=w[rankField];
      if(rk==null)g.yok++;else if(rk<=7)g[String(rk)]++;else if(rk===8)g.alt1++;else if(rk===9)g.alt2++;else if(rk===10)g.alt3++;else g.alt4++;
    }
  }
  _targetConditionStatsCache.set(key,result);
  if(_targetConditionStatsCache.size>96)_targetConditionStatsCache.delete(_targetConditionStatsCache.keys().next().value);
  return result;
}

function bmbWinRateByCondition(){
  if (_bmbWinRateByConditionCache) return _bmbWinRateByConditionCache;
  let groups = {};
  for (const r of learningEligibleRaces()){
    let key = broadConditionKey(r.condition_family);
    let g = groups[key] || (groups[key] = {bmbRaces:0, bmbWin:0});
    let bs = r.horses.filter(h=>Number(h.bmb)===1);
    if (bs.length){
      g.bmbRaces++;
      if (bs.some(tkpAnalysisIsWinner)) g.bmbWin++;
    }
  }
  _bmbWinRateByConditionCache = groups;
  return groups;
}

function bmbWinRateByConditionForTarget(targetRace){
  if(!targetRace)return bmbWinRateByCondition();
  // Aynı tarihsel-kalibrasyon kuralı BMB istatistiğinde de geçerlidir. Tam
  // arşiv oranını hedef ayak başına yeniden filtrelemek yerine tek cache okunur.
  try{
    if(typeof tkpHistoricalCalibrationRace==='function'&&tkpHistoricalCalibrationRace(targetRace,db)){
      return bmbWinRateByCondition();
    }
  }catch(_e){}
  const prefix=tkpConditionPrefixForTarget(targetRace);
  if(prefix)return prefix.bmb;
  const bundle=tkpTargetConditionBundle(targetRace);
  if(bundle)return bundle.bmb;
  const key=tkpTargetStatsKey(targetRace,'BMB');
  if(_targetBmbConditionStatsCache.has(key))return _targetBmbConditionStatsCache.get(key);
  const groups={};
  for(const r of tkpTrainingRowsForStats(targetRace)){
    const condition=broadConditionKey(r.condition_family);
    const group=groups[condition]||(groups[condition]={bmbRaces:0,bmbWin:0});
    const bmb=(r.horses||[]).filter(h=>Number(h.bmb)===1);
    if(!bmb.length)continue;
    group.bmbRaces++;if(bmb.some(tkpAnalysisIsWinner))group.bmbWin++;
  }
  _targetBmbConditionStatsCache.set(key,groups);
  if(_targetBmbConditionStatsCache.size>96)_targetBmbConditionStatsCache.delete(_targetBmbConditionStatsCache.keys().next().value);
  return groups;
}

function conditionRankWinRate(r, h){
  const cond = broadConditionKey(r.condition_family);
  const st = statsByConditionForTarget('result_rank',r)[cond];
  if (!st || !st.total || h.result_rank == null) return 0;
  return (st[String(h.result_rank)] || 0) / st.total;
}

function conditionBmbWinRate(r, h){
  if (Number(h.bmb) !== 1) return 0;
  const cond = broadConditionKey(r.condition_family);
  const st = bmbWinRateByConditionForTarget(r)[cond];
  return st && st.bmbRaces ? st.bmbWin / st.bmbRaces : 0;
}

function historyStrengthForCandidate(h){
  const general = (h.priorWins>0 && h.priorStarts>0) ? wilson(h.priorWins, h.priorStarts) : 0;
  const condition = h.condWinPct || 0;
  return Math.max(condition, general);
}

function historicalWinnerProfilesForRace(r){
  const cutoff=r&&typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(r,db):'';
  const cacheKey = r && r.id != null ? [tkpStatsCacheSignature(),r.id,cutoff].join('|') : null;
  if (cacheKey != null && _winnerProfileCache.has(cacheKey)) return _winnerProfileCache.get(cacheKey);
  const m=detailedProfileMatch(r,5);
  const fields=['result_rank','agf_rank','sp_rank','g800'];
  const sets={}; fields.forEach(f=>sets[f]=new Set());
  let bmbWon=false;
  for(const pr of (m.rows||[])){
    for(const w of (pr.horses||[]).filter(tkpAnalysisIsWinner)){
      for(const f of fields){
        const v=w[f];
        if(v!=null && Number.isFinite(Number(v))) sets[f].add(Number(v));
      }
      if(Number(w.bmb)===1) bmbWon=true;
    }
  }
  const result = {match:m,sets,bmbWon};
  if (cacheKey != null) _winnerProfileCache.set(cacheKey, result);
  return result;
}

function historicalSurpriseProfileMatch(r,h){
  if(!h || isNonRunner(h)) return {matched:false,labels:[]};
  const p=historicalWinnerProfilesForRace(r);
  const labels=[];
  // SONUÇ ilk 6 zaten ana havuzdadır; sürpriz koruması özellikle 7 ve sonrası içindir.
  if(h.result_rank!=null && h.result_rank>=7 && p.sets.result_rank.has(Number(h.result_rank))) labels.push('SONUÇ '+h.result_rank);
  // AGF/800G/SP tarafında favori dışı veya uç sıralardan daha önce kazanan profil varsa koru.
  if(h.agf_rank!=null && h.agf_rank>=4 && p.sets.agf_rank.has(Number(h.agf_rank))) labels.push('AGF '+h.agf_rank);
  if(h.g800!=null && h.g800>=3 && p.sets.g800.has(Number(h.g800))) labels.push('800G '+h.g800);
  if(h.sp_rank!=null && p.sets.sp_rank.has(Number(h.sp_rank))) labels.push('SP '+h.sp_rank);
  if(Number(h.bmb)===1 && p.bmbWon) labels.push('BMB');
  return {matched:labels.length>0,labels,level:p.match?.level||'Veri yok'};
}

function horseWinStats(){
  let map = {};
  for (const r of learningEligibleRaces()){
    for (const h of r.horses){
      let key = fold(h.horse_name);
      if (!key) continue;
      let g = map[key] || (map[key] = {starts:0, wins:0});
      g.starts++;
      if (tkpAnalysisIsWinner(h)) g.wins++;
    }
  }
  return map;
}

function horseConditionWinStats(){
  let map = {};
  for (const r of learningEligibleRaces()){
    let cond = broadConditionKey(r.condition_family);
    for (const h of r.horses){
      let name = fold(h.horse_name);
      if (!name) continue;
      let key = name + '|' + cond;
      let g = map[key] || (map[key] = {starts:0, wins:0});
      g.starts++;
      if (tkpAnalysisIsWinner(h)) g.wins++;
    }
  }
  return map;
}

// Tahmini Derece'de doğrudan derece/Accurate yoksa kullanılacak geçmiş indeksi:
// her at için (isim eşleşmesiyle) geçmişte koştuğu mesafe/pist + varsa Accurate hızı
// veya derecesi + o günkü kilosu kaydedilir. En yakın mesafe/pist seçilerek tahmini
// derece üretilir (bkz. tahminiDereceSeconds() fallback dalı).
function computeHorseRaceHistoryIndex(racesOverride){
  const ordered=tkpChronologicalHistory(racesOverride||learningEligibleRaces());
  const idx={};
  for(const r of ordered) for(const h of r.horses){
    const key=fold(h.horse_name); if(!key) continue;
    const speed=Number(h.accurate_avg_speed_mps)>0?Number(h.accurate_avg_speed_mps):null;
    const time=typeof tkpHorseBestTimeSeconds==='function'?tkpHorseBestTimeSeconds(h):null;
    if(!speed && !time) continue;
    (idx[key]=idx[key]||[]).push({distance:Number(r.distance)||null, surface:r.surface, breed:r.breed, kg:typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(h):null, speed, time});
  }
  return idx;
}

// Sabit bir katsayı yazmak yerine, aynı atın farklı mesafelerdeki gerçek derece
// farkından (sn/metre) pist+tür bazında öğrenilir. Kayıt yoksa TJK'nin bilinen
// genel ortalamasına (~0,06 sn/m) düşülür.
const _paceAdjCache=new Map();
function learnedPaceSecPerMeter(surface,breed){
  const bt=(typeof globalThis!=='undefined') ? globalThis.__tkpBacktestContext : null;
  const btKey=bt&&bt.enabled ? `BT:${bt.excludeFileId||''}:${bt.cutoffSeq||''}:${bt.cutoffDate||''}` : 'LIVE';
  const key=String(surface)+'|'+String(breed)+'|'+btKey;
  if(_paceAdjCache.has(key)) return _paceAdjCache.get(key);
  const perHorse={};
  for(const r of learningEligibleRaces()){
    if(r.surface!==surface||r.breed!==breed) continue;
    for(const h of r.horses){
      const t=typeof tkpHorseBestTimeSeconds==='function'?tkpHorseBestTimeSeconds(h):null;
      const d=Number(r.distance)||0;
      if(!Number.isFinite(t)||!d) continue;
      const hk=fold(h.horse_name);
      (perHorse[hk]=perHorse[hk]||[]).push({d,t});
    }
  }
  let dSec=0,dDist=0;
  for(const runs of Object.values(perHorse)){
    if(runs.length<2) continue;
    runs.sort((a,b)=>a.d-b.d);
    for(let i=1;i<runs.length;i++){ dSec+=runs[i].t-runs[0].t; dDist+=runs[i].d-runs[0].d; }
  }
  const coef=dDist?dSec/dDist:0.06;
  _paceAdjCache.set(key,coef);
  if(_paceAdjCache.size>200){ const first=_paceAdjCache.keys().next().value; _paceAdjCache.delete(first); }
  return coef;
}


function tkpChronologicalHistory(races){
  const arr=Array.isArray(races)?races.slice():[];
  return arr.sort((a,b)=>{
    const ad=String(a?.race_date||a?.date||'');
    const bd=String(b?.race_date||b?.date||'');
    if(ad!==bd) return ad.localeCompare(bd);
    const al=Number(a?.leg)||0, bl=Number(b?.leg)||0;
    if(al!==bl) return al-bl;
    return (Number(a?.id)||0)-(Number(b?.id)||0);
  });
}

// Tüm rapor ve öğrenme yolları aynı, eksiksiz sonuçlanmış geçmişi kullanır.
// Eski ayarlarda pozitif bir sınır bulunsa bile veri kesilmez.
const TKP_DEFAULT_HISTORY_ANALYSIS_CAP = 0;
function tkpHistoryAnalysisCap(){
  return 0;
}
function tkpBoundedRacesForReport(races){
  const cap = tkpHistoryAnalysisCap();
  if (!cap || !Array.isArray(races) || races.length <= cap) return races;
  // En güncel `cap` koşu tutulur; tarih/ayak/id sırasına göre kronolojik kesilir.
  return tkpChronologicalHistory(races).slice(-cap);
}

function computeHorsePriorStats(racesOverride){
  let ordered = tkpChronologicalHistory(racesOverride || learningEligibleRaces());
  let counts = {};
  for (const r of ordered){
    for (const h of r.horses){
      let key = fold(h.horse_name);
      if (!key){ h.priorStarts = 0; h.priorWins = 0; continue; }
      let c = counts[key] || (counts[key] = {starts:0, wins:0, surpriseHits:0});
      h.priorStarts = c.starts;
      h.priorWins = c.wins;
      h.priorSurpriseHits = c.surpriseHits;
      c.starts++;
      // KÖK FIX (V1.1.03): G.PR (ve altındaki priorWins/condWinWins), kazanmayı yalnız
      // `h.winner` bayrağına bakarak sayıyordu. Ama kodun geri kalanı (predictionHorseNo,
      // raceHasConfirmedResult, couponVariantCompactHTML vb. onlarca yer) kazananı hep
      // `Number(h.winner)===1 || Number(h.finish_position)===1` ile tespit ediyor -- çünkü
      // bazı kayıtlarda (özellikle eski/aktarılmış sonuçlarda) yalnız finish_position
      // dolduruluyor, winner bayrağı hiç set edilmiyor. Sonuç: gerçekten kazanmış bir at,
      // sadece winner boş kaldığı için G.PR'de "hiç kazanmamış" gibi görünüyordu -- ekranın
      // geri kalanında aynı at "1." rozetiyle gösterilse bile. `finish` burada zaten
      // hesaplanıyordu (sürpriz kanıtı için); artık kazanma sayımı da onu kullanıyor.
      const finish=Number(h.finish_position ?? h.official_position ?? h.place ?? (Number(h.winner)===1?1:NaN));
      if (Number(h.winner)===1 || finish===1) c.wins++;
      // G.PR sürpriz kanıtı: favori dışı bir atın ilk 3'e girmesi.
      // AGF/SP sırası 4+ ise ve gerçek bitiriş ilk 3 ise, galibiyet olmasa da
      // benzer profilde kanıtlanmış sürpriz başarı olarak saklanır.
      const outsiderRank=Math.max(Number(h.agf_rank)||0,Number(h.sp_rank)||0);
      if(Number.isFinite(finish) && finish>=1 && finish<=3 && outsiderRank>=4) c.surpriseHits++;
    }
  }
}

// KÖK DÜZELTME (2026-08-09, kullanıcı uyarısı): "Accurate" (GPS hız/bitiriş) verisi
// yalnızca SONUÇ ile birlikte, yarış BİTTİKTEN SONRA toplanır (bkz. tkp-collector-bridge.js
// -- accurace her zaman tjk_result ile birlikte istenir, asla tjk_program ile değil).
// Yani bir yarışın KENDİ accurate_avg_speed_mps/accurate_finish_signal değeri, o yarışın
// kuponu kurulurken (henüz koşulmamışken) HİÇBİR ZAMAN mevcut değildir. Önceki sürüm
// (accSig bonusu + accurateFieldTopCandidate) yanlışlıkla yarışın KENDİ verisini
// kullanıyordu -- gerçek kullanımda hep boş kaldığı için etkisizdi, geriye dönük testte
// ise (o veri zaten toplanmış tamamlanmış yarışlarla test edildiği için) yanıltıcı
// biçimde iyi görünüyordu. Doğru ve kullanılabilir sinyal, atın DAHA ÖNCEKİ yarışlarındaki
// ortalama Accurate performansıdır -- computeHorsePriorStats ile AYNI "önce ata, sonra
// say" (assign-then-increment) sırasıyla, sızıntısız hesaplanır.
function computeHorsePriorAccurateStats(racesOverride){
  let ordered = tkpChronologicalHistory(racesOverride || learningEligibleRaces());
  let sums = {};
  for (const r of ordered){
    for (const h of r.horses){
      let key = fold(h.horse_name);
      if (!key){ h.priorAccurateAvgSpeed=null; h.priorAccurateFinishSignal=null; h.priorAccurateStarts=0; continue; }
      let s = sums[key] || (sums[key] = {speedSum:0, speedN:0, finishSum:0, finishN:0});
      h.priorAccurateAvgSpeed = s.speedN>0 ? s.speedSum/s.speedN : null;
      h.priorAccurateFinishSignal = s.finishN>0 ? s.finishSum/s.finishN : null;
      h.priorAccurateStarts = Math.max(s.speedN, s.finishN);
      const speed=Number(h.accurate_avg_speed_mps), finish=Number(h.accurate_finish_signal);
      if(Number.isFinite(speed) && speed>0){ s.speedSum+=speed; s.speedN++; }
      if(Number.isFinite(finish)){ s.finishSum+=finish; s.finishN++; }
    }
  }
}

// KÖK FIX: horseConditionWinStats() tüm koşuları tarih sırası gözetmeden tek seferde
// toplayıp bitirdiği için, bir atın DAHA SONRA (gelecekte) kazandığı bir yarış, GEÇMİŞTEKİ
// bir yarışın "koşu şartı geçmişi" istatistiğine sızabiliyordu -- gerçek hayatta o anda
// bilinmesi imkansız bir bilgi. computeHorsePriorStats ile AYNI "önce ata, sonra say"
// (assign-then-increment) sırasını condition bazında da uygular; artık her at için
// condWinStarts/condWinWins yalnızca O YARIŞTAN ÖNCEKİ gerçek geçmişi yansıtır.
function computeHorseConditionPriorStats(racesOverride){
  let ordered = tkpChronologicalHistory(racesOverride || learningEligibleRaces());
  let counts = {};
  for (const r of ordered){
    let cond = broadConditionKey(r.condition_family);
    for (const h of r.horses){
      let name = fold(h.horse_name);
      if (!name){ h.condWinStarts = 0; h.condWinWins = 0; h.condWinPct = 0; continue; }
      let key = name + '|' + cond;
      let c = counts[key] || (counts[key] = {starts:0, wins:0, surpriseHits:0});
      h.condWinStarts = c.starts;
      h.condWinWins = c.wins;
      h.condSurpriseHits = c.surpriseHits;
      h.condWinPct = c.wins > 0 ? wilson(c.wins, c.starts) : 0;
      c.starts++;
      // KÖK FIX (V1.1.03): bkz. computeHorsePriorStats yukarıdaki aynı düzeltme -- kazanma
      // artık yalnız winner bayrağına değil, finish_position===1 düşmesine de bakıyor.
      const finish=Number(h.finish_position ?? h.official_position ?? h.place ?? (Number(h.winner)===1?1:NaN));
      if (Number(h.winner)===1 || finish===1) c.wins++;
      const outsiderRank=Math.max(Number(h.agf_rank)||0,Number(h.sp_rank)||0);
      if(Number.isFinite(finish) && finish>=1 && finish<=3 && outsiderRank>=4) c.surpriseHits++;
    }
  }
}

function atomicFeatures(racesOverride){
  let ar = racesOverride || learningEligibleRaces();
  const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
  let feats = [];
  const add = (group,name,test,requires=[]) => feats.push({group,name,test,requires});
  for (const x of uniq(ar.map(r=>r.surface))) add('surface','Pist='+x,(h,r)=>r.surface===x);
  for (const x of uniq(ar.map(r=>r.breed))) add('breed','Tür='+x,(h,r)=>r.breed===x);
  for (const x of uniq(ar.map(r=>r.hippodrome))) add('hippo','Hipodrom='+x,(h,r)=>r.hippodrome===x);
  for (const x of uniq(ar.map(r=>r.condition_family))) add('condition','Koşu='+x,(h,r)=>r.condition_family===x);
  for (const x of uniq(ar.map(r=>r.distance_group))) add('distance','Mesafe='+x,(h,r)=>r.distance_group===x);
  [60,70,80,90,100].forEach(x => add('value','VALUE≥'+x,(h)=>h.value_score!==null && h.value_score>=x, ['value_score']));
  [1,2,3].forEach(x => add('agf_rank','AGF sıra≤'+x,(h)=>h.agf_rank!=null && h.agf_rank<=x, ['agf']));
  [1,2,3].forEach(x => add('result_rank','SONUÇ sıra≤'+x,(h)=>h.result_rank!=null && h.result_rank<=x, ['result_score']));
  add('result_abs','SONUÇ≥100',(h)=>h.result_score!==null && h.result_score>=100, ['result_score']);
  [1,2,3].forEach(x => add('hndkp_rank','HNDKP sıra≤'+x,(h)=>h.hndkp_rank!=null && h.hndkp_rank<=x, ['hndkp']));
  [55,57.5,60].forEach(x => add('kg','KG≤'+String(x).replace('.',','),(h)=>{ const kg=tkpHorseWeightKg(h); return kg!=null && kg<=x; }, ['weight_kg']));
  add('degree','DERECE hızlı üst grup',(h,r)=>tkpDegreeSignalValue(r,h)>=0.67, ['best_time']);
  add('degree','DERECE var',(h)=>tkpHorseBestTimeSeconds(h)!=null, ['best_time']);
  add('sband','S 38-41',(h)=>h.s_value!==null && h.s_value>=38 && h.s_value<=41, ['s_value']);
  add('bmb','BMB',(h)=>Number(h.bmb)===1);
  add('accurate_speed','Geçmiş Accurate hız > alan ortalaması',(h,r)=>{
    const acc=Number(h?.priorAccurateAvgSpeed);
    if(!Number.isFinite(acc)||acc<=0) return false;
    const vals=(r?.horses||[]).map(x=>Number(x?.priorAccurateAvgSpeed)).filter(v=>Number.isFinite(v)&&v>0);
    const avg=vals.length?vals.reduce((sum,value)=>sum+value,0)/vals.length:null;
    return Number.isFinite(avg) && acc>avg;
  }, ['priorAccurateAvgSpeed']);
  [3,6,9,12].forEach(x => add('kulvar','Kulvar≤'+x,(h)=>{const n=adaptiveStartValue(h);return n!==null&&n<=x;}, ['start_no']));
  add('g800','800G var',(h)=>{const v=adaptiveNumericOrNull(h?.g800);return v!==null&&v>0;}, ['g800']);
  add('sp_low','SP≤10',(h)=>h.sp!==null && h.sp<=10, ['sp']);
  add('sp_mid','SP 10-30',(h)=>h.sp!==null && h.sp>10 && h.sp<=30, ['sp']);
  [1,2,3].forEach(x => add('horse_hist','At bazlı geçmiş≥'+x+' galibiyet',(h)=>h.priorWins!=null && h.priorWins>=x, ['priorWins']));
  // V1.1.242 YENİ SİNYAL (gerçek 2.990 yarışlık arşivde backtest edildi, bkz.
  // SURUM_NOTLARI_V1.1.242.md): tr_ganyan_rank (Ganyan Canavarı kaynaklı, ırk
  // öncesi bilinen, sızıntısız) ve jbyg (jokey/antrenör takım gücü sırası, ırk
  // öncesi bilinen) alanları koddaki başka yerlerde (prediction-engine.js,
  // coupon-builder.js) zaten kullanılıyordu ama kural madenciliğine hiç
  // sokulmamıştı. Gerçek arşivde "TR sıra≤1 + TR-Ganyan sıra≤1" kombinasyonu
  // 1.649 örneklemde (439 toplantı) %34,4 isabet / Wilson alt sınırı 0,322
  // verdi -- mevcut en iyi kuralların çoğundan (n=5-17) çok daha geniş ve
  // güvenilir bir örneklem. Denenip lift ÜRETMEYEN adaylar (condWinPct,
  // priorSurpriseHits, condSurpriseHits, tr_hidden_fav, tr_bmb_candidate,
  // star_value) BİLEREK eklenmedi -- gerçek veride istatistiksel olarak null
  // çıktılar (bkz. sürüm notu).
  [1,2,3].forEach(x => add('tr_ganyan_rank','TR-Ganyan sıra≤'+x,(h)=>Number.isFinite(adaptiveGcTrValue(h)) && adaptiveNumericOrNull(h?.tr_ganyan_rank)!==null && Number(h.tr_ganyan_rank)<=x, ['tr_ganyan_rank']));
  [1,2,3].forEach(x => add('jbyg','J-BYG sıra≤'+x,(h)=>{const rank=typeof tkpTrustedJBygRank==='function'?tkpTrustedJBygRank(h):adaptiveNumericOrNull(h?.jbyg);return rank!==null&&Number.isFinite(Number(rank))&&Number(rank)>=1&&Number(rank)<=x;}, ['jbyg']));
  return feats;
}

function evaluateFeatures(features, racesOverride){
  let ar = racesOverride || learningEligibleRaces();
  let single=0, singleWins=0, selectedHorses=0, selectedWins=0, eligible=0, files=new Set(), hippos=new Set(), signature=[], weighted=0, weightedWin=0, recentOutcomes=[];
  let n2 = ar.length;
  for (let idx=0; idx<n2; idx++){
    const r = ar[idx];
    let hs = r.horses.filter(h => features.every(f => f.test(h,r)));
    if (!hs.length) continue;
    eligible++;
    selectedHorses += hs.length;
    selectedWins += hs.filter(tkpAnalysisIsWinner).length;
    signature.push(r.id + ':' + hs.map(h=>h.horse_no).sort().join(','));
    if (hs.length === 1){
      single++;
      let w = tkpAnalysisIsWinner(hs[0]) ? 1 : 0;
      singleWins += w;
      files.add(r.file_id);
      hippos.add(r.hippodrome);
      let recW = Math.pow(0.985, n2 - 1 - idx);
      weighted += recW;
      weightedWin += recW * w;
      recentOutcomes.push(w);
    }
  }
  let rate = single ? singleWins/single : 0;
  const recentSlice=recentOutcomes.slice(-20);
  let recentRate = recentSlice.length ? recentSlice.reduce((a,b)=>a+b,0)/recentSlice.length : rate;
  return { features, name: features.map(f=>f.name).join(' + '), single, singleWins, rate, recentRate, recentN:recentSlice.length, lb: wilson(singleWins, single), selectedHorses, selectedWins, eligible, files: files.size, hippos: hippos.size, signature: signature.join(';') };
}

function buildRules(racesOverride){
  // Bütün sonucu kesinleşmiş geçmiş kullanılır; örneklem sayısı asla 1000/500 vb.
  // sabit bir son-N kesmesine uğramaz. Büyük havuzda yalnız kombinasyon derecesi
  // ikiyle sınırlanır; her kuralın paydası yine tam uygun veri kümesidir.
  const sourceRaces = racesOverride || learningEligibleRaces();
  const analysisRaces = sourceRaces;
  computeHorsePriorStats(analysisRaces);
  let feats = atomicFeatures(analysisRaces);
  let max = Math.max(1, Math.min(3, db.settings.max_rule_size || 2));
  if (analysisRaces.length > 250 && max > 2) max = 2;

  // PERFORMANS KÖK ÇÖZÜM: Özellik sayısı F oldukça (hipodrom/koşu şartı çeşitliliği arttıkça)
  // 2'li/3'lü kombinasyon sayısı F² / F³ ile patlıyor; eskiden HER kombinasyon için
  // evaluateFeatures() baştan tüm yarış/at listesini tarayıp her at için 2-3 f.test(h,r)
  // KAPANIŞINI (closure) yeniden çağırıyordu. Bu, Ana Panel her açıldığında (renderDashboard
  // -> buildAdvice/bestRules/perfectRules -> getCurrentRules -> buildRules) çalıştığı için
  // "sistem geç açılıyor" şikayetinin gerçek kaynağıydı. Şimdi her ATOMİK özellik için
  // (yarış,at) bazında geçti/geçmedi maskesi TEK SEFER çıkarılır (Uint8Array); 2'li/3'lü
  // kombinasyonlar bu maskeleri ucuz bir AND ile birleştirir. Üretilen sonuç (single,
  // singleWins, rate, lb, signature, sıralama vb.) eski algoritmayla birebir aynıdır --
  // yalnız at başına tekrar tekrar closure çağırmak yerine dizi indeksi okunur.
  const raceHorses = analysisRaces.map(r => r.horses || []);
  const raceStartOffset = [];
  { let off = 0; for (const hs of raceHorses){ raceStartOffset.push(off); off += hs.length; } }
  const totalHorses = raceStartOffset.length ? raceStartOffset[raceStartOffset.length-1] + raceHorses[raceHorses.length-1].length : 0;
  const featureRaceIndices=[];
  const masks = feats.map((f,featureIndex) => {
    const m = new Uint8Array(totalHorses);
    let gi = 0;
    const matchingRaces=[];
    for (let ri=0; ri<analysisRaces.length; ri++){
      const r = analysisRaces[ri];
      let raceMatched=false;
      for (const h of raceHorses[ri]){ const pass=f.test(h,r);m[gi]=pass?1:0;if(pass)raceMatched=true;gi++; }
      if(raceMatched)matchingRaces.push(ri);
    }
    featureRaceIndices[featureIndex]=matchingRaces;
    return m;
  });
  // Aynı yarışın yakın-tarih ağırlığı her özellik birleşiminde değişmez.
  // Math.pow'u binlerce kombinasyon x yüzlerce yarış için yeniden çalıştırmak
  // yerine bir kez hesapla. Kural matematiği ve kayan nokta sonucu aynıdır.
  const recencyWeights = new Float64Array(analysisRaces.length);
  for(let idx=0; idx<analysisRaces.length; idx++){
    recencyWeights[idx] = Math.pow(0.985, analysisRaces.length - 1 - idx);
  }

  function evaluateFeatureIndices(idxArr){
    const features = idxArr.map(i => feats[i]);
    let single=0, singleWins=0, selectedHorses=0, selectedWins=0, eligible=0, files=new Set(), hippos=new Set(), signature=[], weighted=0, weightedWin=0, recentOutcomes=[];
    // Birleşim ancak en dar atomik özelliğin aday gösterdiği yarışlarda
    // sonuç verebilir. Özellikle 252 ayrı koşu-şartı kuralını 2.940 yarışın
    // tamamında tekrar taramak yerine bu kesin alt kümeyi kullanır; tek bir uygun
    // yarış veya at atlanmaz.
    const raceIndices=idxArr.reduce((best,featureIndex)=>{
      const rows=featureRaceIndices[featureIndex]||[];
      return best===null||rows.length<best.length?rows:best;
    },null)||[];
    const nIdx = idxArr.length;
    for (const idx of raceIndices){
      const r = analysisRaces[idx];
      const horses = raceHorses[idx];
      const base = raceStartOffset[idx];
      let hlen=0, winCount=0, firstHorseNo='', horseNos=null;
      // PERFORMANS KÖK ÇÖZÜM: buildRules() 250'den fazla yarışta max=2 (ikili
      // kombinasyon) ile sınırlandığı için bu fonksiyonun ezici çoğunluğu nIdx===2
      // ile çağrılır. Genel k-döngüsü yerine iki maskeyi doğrudan AND'lemek JIT
      // için çok daha ucuzdur; sonuç (hangi atların seçildiği) birebir aynıdır.
      if (nIdx === 1){
        const m0 = masks[idxArr[0]];
        for (let hi=0; hi<horses.length; hi++){
          if (!m0[base+hi]) continue;
          const h=horses[hi], horseNo=h.horse_no;
          if(hlen===0) firstHorseNo=horseNo;
          else if(hlen===1) horseNos=[firstHorseNo,horseNo];
          else horseNos.push(horseNo);
          hlen++; if(tkpAnalysisIsWinner(h)) winCount++;
        }
      } else if (nIdx === 2){
        const m0 = masks[idxArr[0]], m1 = masks[idxArr[1]];
        for (let hi=0; hi<horses.length; hi++){
          if (!m0[base+hi] || !m1[base+hi]) continue;
          const h=horses[hi], horseNo=h.horse_no;
          if(hlen===0) firstHorseNo=horseNo;
          else if(hlen===1) horseNos=[firstHorseNo,horseNo];
          else horseNos.push(horseNo);
          hlen++; if(tkpAnalysisIsWinner(h)) winCount++;
        }
      } else {
        for (let hi=0; hi<horses.length; hi++){
          let pass = true;
          for (let k=0; k<nIdx; k++){ if (!masks[idxArr[k]][base+hi]){ pass=false; break; } }
          if(pass){
            const h=horses[hi], horseNo=h.horse_no;
            if(hlen===0) firstHorseNo=horseNo;
            else if(hlen===1) horseNos=[firstHorseNo,horseNo];
            else horseNos.push(horseNo);
            hlen++; if(tkpAnalysisIsWinner(h)) winCount++;
          }
        }
      }
      if (!hlen) continue;
      eligible++;
      selectedHorses += hlen;
      // PERFORMANS KÖK ÇÖZÜM: bu fonksiyon buildRules() içinde F²/F³ kombinasyon
      // sayısı kadar (binlerce kez) her yarış için çağrılıyor. hs.filter(...).length
      // her seferinde gereksiz bir dizi tahsis edip çöp toplayıcıyı zorluyordu;
      // aynı sonucu üreten tahsissiz sayaca çevrildi (çıktı birebir aynıdır).
      selectedWins += winCount;
      // PERFORMANS KÖK ÇÖZÜM: en sık görülen durum (TEK at seçimi, hlen===1) için
      // map+sort+join hiç gerekmiyordu -- tek elemanlı bir dizinin sıralanmış hâli
      // zaten o elemandır. Sonuç dizgesi (signature) birebir aynı üretilir.
      signature.push(hlen===1 ? (r.id + ':' + firstHorseNo) : (r.id + ':' + horseNos.sort().join(',')));
      if (hlen === 1){
        single++;
        let w = winCount;
        singleWins += w;
        files.add(r.file_id);
        hippos.add(r.hippodrome);
        let recW = recencyWeights[idx];
        weighted += recW;
        weightedWin += recW * w;
        recentOutcomes.push(w);
      }
    }
    let rate = single ? singleWins/single : 0;
    const recentSlice=recentOutcomes.slice(-20);
    let recentRate = recentSlice.length ? recentSlice.reduce((a,b)=>a+b,0)/recentSlice.length : rate;
    return { features, name: features.map(f=>f.name).join(' + '), single, singleWins, rate, recentRate, recentN:recentSlice.length, lb: wilson(singleWins, single), selectedHorses, selectedWins, eligible, files: files.size, hippos: hippos.size, signature: signature.join(';') };
  }

  let raw = [];
  for (let i=0;i<feats.length;i++) raw.push(evaluateFeatureIndices([i]));
  if (max >= 2){
    for (let i=0;i<feats.length;i++) for (let j=i+1;j<feats.length;j++){
      if (feats[i].group === feats[j].group) continue;
      raw.push(evaluateFeatureIndices([i,j]));
    }
  }
  if (max >= 3){
    for (let i=0;i<feats.length;i++) for (let j=i+1;j<feats.length;j++) for (let k=j+1;k<feats.length;k++){
      let gs = new Set([feats[i].group,feats[j].group,feats[k].group]);
      if (gs.size < 3) continue;
      raw.push(evaluateFeatureIndices([i,j,k]));
    }
  }
  raw = raw.filter(x => x.single > 0);
  let sig = new Map();
  for (const x of raw){
    let old = sig.get(x.signature);
    if (!old || x.features.length < old.features.length || (x.features.length===old.features.length && x.name.length < old.name.length)) sig.set(x.signature, x);
  }
  let arr = [...sig.values()];
  arr.sort((a,b) => b.lb-a.lb || b.rate-a.rate || b.single-a.single || a.features.length-b.features.length || TKP_TR_COLLATOR.compare(a.name,b.name));
  return arr;
}

// V1.1.241 HIZ KÖK FIX: buildRules() cache-miss anında (ilk açılış, kural boyutu
// değişimi, veri seti imzası değişimi) F² kombinasyon taramasını TEK senkron
// çağrıda bitiriyor; büyük arşivde (503 dosya / ~2.940 yarış ölçeğinde ölçüldü:
// ~12-29 sn) bu süre boyunca ana iş parçacığı tamamen kilitleniyor, tarayıcı
// "sayfa yanıt vermiyor" uyarısı verebiliyor. buildRules() BİLEREK değiştirilmedi
// -- onlarca senkron çağıran (tests/full-learning-coverage-regression.test.js,
// tests/degree-signal-speed-regression.test.js dahil) hâlâ garantili senkron, tam
// ve eksiksiz bir sonuç bekliyor. Bunun yerine dosyadaki mevcut *Async ikiz
// deseniyle (bkz. trGanyanBehaviorSummaryAsync, tkpWinnerComboSummaryAsync) birebir
// aynı yaklaşımı izleyen, BİREBİR AYNI algoritma + AYNI çıktıyı üreten asenkron bir
// ikiz eklendi: buildRulesAsync(). Ağır F²/F³ döngüsü sabit bir kombinasyon
// sayısında bir tkpYield() (yoksa setTimeout(0)) çağrısına uğrar, böylece tarayıcı
// arada girdi/çizim işleyebilir. Sonuç (kurallar, sıralama, imza, oran/lb
// değerleri) buildRules() ile bit-bit aynıdır -- bkz.
// tests/buildrules-async-nonblocking-regression.test.js.
// HIZ KÖK ÇÖZÜM (2026-09, kullanıcının canlı profiler kanıtı): 400 kombinasyonda
// bir yield etmek, geniş bir özelliğin (çoğu yarışı eşleştiren) art arda 400
// kez evaluateFeatureIndices() ile taranmasına denk gelebiliyordu; bu da
// gerçek cihazda ölçülen ~750ms'lik ardışık "Kritik" (>=500ms) event-loop
// gecikmelerinin doğrudan kaynağıydı (bkz. tkp-profiler.js Event-loop
// gecikmeleri paneli, rules-auto-build kuyruk görevi ~17.9 sn sürerken).
// Sonuç/sıralama/eşik DEĞİŞMEDİ -- yalnız aynı iş artık 10 kat daha sık
// (400 -> 40 kombinasyonda bir) tkpYield()'e uğruyor, böylece tek bir
// senkron blok tarayıcıyı yarım saniyeden fazla kilitlemiyor.
const TKP_BUILD_RULES_ASYNC_YIELD_EVERY = 40;
let _tkpBuildRulesAsyncInFlight = null;
function _tkpBuildRulesSignature(racesOverride){
  const races = racesOverride || learningEligibleRaces();
  const last = races.length ? races[races.length-1] : null;
  const lastKey = last ? `${last.id??''}` : '';
  return `${races.length}|${lastKey}|${db?.settings?.max_rule_size??''}`;
}
async function buildRulesAsync(racesOverride){
  const signature = _tkpBuildRulesSignature(racesOverride);
  if (_tkpBuildRulesAsyncInFlight && _tkpBuildRulesAsyncInFlight.signature === signature) return _tkpBuildRulesAsyncInFlight.promise;
  const promise = (async () => {
    // Aşağıdaki kod bloğu buildRules() ile BİREBİR AYNIDIR (bkz. yukarı); tek fark
    // ağır maske çıkarımından önce ve F²/F³ döngüsü içinde periyodik olarak
    // tkpYield() çağrısına uğramasıdır. Herhangi bir hesap adımı, sıralama veya
    // eşik değeri değiştirilmedi.
    const sourceRaces = racesOverride || learningEligibleRaces();
    const analysisRaces = sourceRaces;
    computeHorsePriorStats(analysisRaces);
    let feats = atomicFeatures(analysisRaces);
    let max = Math.max(1, Math.min(3, db.settings.max_rule_size || 2));
    if (analysisRaces.length > 250 && max > 2) max = 2;

    if (typeof tkpYield === 'function') await tkpYield(); else await new Promise(resolve=>setTimeout(resolve,0));

    const raceHorses = analysisRaces.map(r => r.horses || []);
    const raceStartOffset = [];
    { let off = 0; for (const hs of raceHorses){ raceStartOffset.push(off); off += hs.length; } }
    const totalHorses = raceStartOffset.length ? raceStartOffset[raceStartOffset.length-1] + raceHorses[raceHorses.length-1].length : 0;
    const featureRaceIndices=[];
    // HIZ KÖK ÇÖZÜM (2026-09, kullanıcının canlı profiler kanıtı — tarayıcıda
    // "Sayfa yanıt vermiyor" diyaloğu çıktı): bu maske çıkarımı önceden .map()
    // ile TEK senkron blok halinde çalışıyordu -- büyük arşivde bu tek blok
    // ~950ms sürüyor ve F² döngüsündeki yield'lerden HİÇ pay almıyordu; canlı
    // profilerdeki ardışık "Kritik" (>=500ms) event-loop gecikmelerinin gerçek
    // kaynağı buydu. Özellik sayısına göre (her 24 özellikte bir) yield etmek
    // de yetmedi: TEK bir atomik özellik ("DERECE hızlı üst grup" -- derece/hız
    // string'lerini ayrıştırıp normalize eden f.test()) diğerlerinden onlarca
    // kat pahalı ve TEK BAŞINA ~700-750ms sürebiliyor (gerçek arşivde ölçüldü);
    // özellik sınırında yield etmek bu TEK özelliğin kendi iç döngüsünü
    // bölemiyordu. Şimdi yield kontrolü özellik sınırında DEĞİL, her özelliğin
    // KENDİ yarış döngüsü içinde de (300 yarışta bir + geçen süre bütçesi)
    // yapılıyor -- pahalı tek bir özellik bile artık tek seferde 40ms'den
    // fazla tarayıcıyı kilitleyemez. Maske değerleri ve featureRaceIndices
    // sırası birebir aynı üretilir; yalnız yield sıklığı garanti altına alındı.
    const masks = new Array(feats.length);
    const MASK_YIELD_BUDGET_MS = 40;
    const MASK_YIELD_RACE_CHECK_EVERY = 60;
    let maskYieldClock = (typeof performance!=='undefined'&&performance.now) ? performance.now() : Date.now();
    const maskMaybeYield = async () => {
      const nowMs = (typeof performance!=='undefined'&&performance.now) ? performance.now() : Date.now();
      if (nowMs-maskYieldClock < MASK_YIELD_BUDGET_MS) return;
      if (typeof tkpYield === 'function') await tkpYield(); else await new Promise(resolve=>setTimeout(resolve,0));
      maskYieldClock = (typeof performance!=='undefined'&&performance.now) ? performance.now() : Date.now();
    };
    for (let featureIndex=0; featureIndex<feats.length; featureIndex++){
      const f = feats[featureIndex];
      const m = new Uint8Array(totalHorses);
      let gi = 0;
      const matchingRaces=[];
      for (let ri=0; ri<analysisRaces.length; ri++){
        const r = analysisRaces[ri];
        let raceMatched=false;
        for (const h of raceHorses[ri]){ const pass=f.test(h,r);m[gi]=pass?1:0;if(pass)raceMatched=true;gi++; }
        if(raceMatched)matchingRaces.push(ri);
        if ((ri+1)%MASK_YIELD_RACE_CHECK_EVERY===0) await maskMaybeYield();
      }
      featureRaceIndices[featureIndex]=matchingRaces;
      masks[featureIndex]=m;
      await maskMaybeYield();
    }
    const recencyWeights = new Float64Array(analysisRaces.length);
    for(let idx=0; idx<analysisRaces.length; idx++){
      recencyWeights[idx] = Math.pow(0.985, analysisRaces.length - 1 - idx);
    }

    // Ağır maske çıkarımı da büyük arşivde milisaniyeler alabilir; F² döngüsüne
    // girmeden önce bir kez daha yield ederek geç gelen bir tıklamanın/render'ın
    // hemen ardından işlenmesini sağlar.
    if (typeof tkpYield === 'function') await tkpYield(); else await new Promise(resolve=>setTimeout(resolve,0));

    function evaluateFeatureIndices(idxArr){
      const features = idxArr.map(i => feats[i]);
      let single=0, singleWins=0, selectedHorses=0, selectedWins=0, eligible=0, files=new Set(), hippos=new Set(), signature=[], weighted=0, weightedWin=0, recentOutcomes=[];
      const raceIndices=idxArr.reduce((best,featureIndex)=>{
        const rows=featureRaceIndices[featureIndex]||[];
        return best===null||rows.length<best.length?rows:best;
      },null)||[];
      const nIdx = idxArr.length;
      for (const idx of raceIndices){
        const r = analysisRaces[idx];
        const horses = raceHorses[idx];
        const base = raceStartOffset[idx];
        let hlen=0, winCount=0, firstHorseNo='', horseNos=null;
        if (nIdx === 1){
          const m0 = masks[idxArr[0]];
          for (let hi=0; hi<horses.length; hi++){
            if (!m0[base+hi]) continue;
            const h=horses[hi], horseNo=h.horse_no;
            if(hlen===0) firstHorseNo=horseNo;
            else if(hlen===1) horseNos=[firstHorseNo,horseNo];
            else horseNos.push(horseNo);
            hlen++; if(tkpAnalysisIsWinner(h)) winCount++;
          }
        } else if (nIdx === 2){
          const m0 = masks[idxArr[0]], m1 = masks[idxArr[1]];
          for (let hi=0; hi<horses.length; hi++){
            if (!m0[base+hi] || !m1[base+hi]) continue;
            const h=horses[hi], horseNo=h.horse_no;
            if(hlen===0) firstHorseNo=horseNo;
            else if(hlen===1) horseNos=[firstHorseNo,horseNo];
            else horseNos.push(horseNo);
            hlen++; if(tkpAnalysisIsWinner(h)) winCount++;
          }
        } else {
          for (let hi=0; hi<horses.length; hi++){
            let pass = true;
            for (let k=0; k<nIdx; k++){ if (!masks[idxArr[k]][base+hi]){ pass=false; break; } }
            if(pass){
              const h=horses[hi], horseNo=h.horse_no;
              if(hlen===0) firstHorseNo=horseNo;
              else if(hlen===1) horseNos=[firstHorseNo,horseNo];
              else horseNos.push(horseNo);
              hlen++; if(tkpAnalysisIsWinner(h)) winCount++;
            }
          }
        }
        if (!hlen) continue;
        eligible++;
        selectedHorses += hlen;
        selectedWins += winCount;
        signature.push(hlen===1 ? (r.id + ':' + firstHorseNo) : (r.id + ':' + horseNos.sort().join(',')));
        if (hlen === 1){
          single++;
          let w = winCount;
          singleWins += w;
          files.add(r.file_id);
          hippos.add(r.hippodrome);
          let recW = recencyWeights[idx];
          weighted += recW;
          weightedWin += recW * w;
          recentOutcomes.push(w);
        }
      }
      let rate = single ? singleWins/single : 0;
      const recentSlice=recentOutcomes.slice(-20);
      let recentRate = recentSlice.length ? recentSlice.reduce((a,b)=>a+b,0)/recentSlice.length : rate;
      return { features, name: features.map(f=>f.name).join(' + '), single, singleWins, rate, recentRate, recentN:recentSlice.length, lb: wilson(singleWins, single), selectedHorses, selectedWins, eligible, files: files.size, hippos: hippos.size, signature: signature.join(';') };
    }

    let raw = [];
    let sinceYield = 0;
    const maybeYield = async () => {
      sinceYield++;
      if (sinceYield < TKP_BUILD_RULES_ASYNC_YIELD_EVERY) return;
      sinceYield = 0;
      if (typeof tkpYield === 'function') await tkpYield(); else await new Promise(resolve=>setTimeout(resolve,0));
    };
    for (let i=0;i<feats.length;i++){ raw.push(evaluateFeatureIndices([i])); await maybeYield(); }
    if (max >= 2){
      for (let i=0;i<feats.length;i++) for (let j=i+1;j<feats.length;j++){
        if (feats[i].group === feats[j].group) continue;
        raw.push(evaluateFeatureIndices([i,j]));
        await maybeYield();
      }
    }
    if (max >= 3){
      for (let i=0;i<feats.length;i++) for (let j=i+1;j<feats.length;j++) for (let k=j+1;k<feats.length;k++){
        let gs = new Set([feats[i].group,feats[j].group,feats[k].group]);
        if (gs.size < 3) continue;
        raw.push(evaluateFeatureIndices([i,j,k]));
        await maybeYield();
      }
    }
    raw = raw.filter(x => x.single > 0);
    let sig = new Map();
    for (const x of raw){
      let old = sig.get(x.signature);
      if (!old || x.features.length < old.features.length || (x.features.length===old.features.length && x.name.length < old.name.length)) sig.set(x.signature, x);
    }
    let arr = [...sig.values()];
    arr.sort((a,b) => b.lb-a.lb || b.rate-a.rate || b.single-a.single || a.features.length-b.features.length || TKP_TR_COLLATOR.compare(a.name,b.name));
    return arr;
  })();
  _tkpBuildRulesAsyncInFlight = { signature, promise };
  try {
    return await promise;
  } finally {
    if (_tkpBuildRulesAsyncInFlight && _tkpBuildRulesAsyncInFlight.promise === promise) _tkpBuildRulesAsyncInFlight = null;
  }
}

// V1.1.252 KÖK TEMİZLİK: bestRules()/perfectRules() artık hiçbir üretim kod
// yolundan çağrılmıyor (tek çağıran zinciri snapshotTop() idi; o da V1.1.225'te
// confirmImport()'tan çıkarılıp yerine ucuz snapshotTopPeek() konmuştu — bkz.
// confirm-import-speed-regression.test.js). Yani getCurrentRules()->buildRules()
// senkron zinciri buradan artık asla tetiklenemez; kullanılmayan iki fonksiyon
// yanlışlıkla yeniden bağlanıp eski "Sayfa Yanıt Vermiyor" yolunu geri
// getirmesin diye kaldırıldı (bkz. buildrules-sync-path-unreachable-regression.test.js).

let _tkpStatsSummaryCache={signature:'',value:null};
function tkpTableHasNumber(v){return (typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(String(v).replace(',','.')));}
function stats(){
  const archive=globalThis.TKPArchiveAnalytics?.peek();if(archive)return archive.stats;
  const signature=tkpStatsCacheSignature();
  if(_tkpStatsSummaryCache.signature===signature&&_tkpStatsSummaryCache.value) return _tkpStatsSummaryCache.value;
  const persisted=db?.learning_state?.stats_summary_v2;
  if(persisted&&String(persisted.signature||'')===signature&&persisted.value){
    _tkpStatsSummaryCache={signature,value:persisted.value};
    return persisted.value;
  }
  const ar=learningEligibleRaces();
  let horses=0,winners=0,valueRaces=0;
  const raceCoverage={surface:0,breed:0,condition:0,date:0};
  const horseCoverage={total:0,value:0,hndkp:0,tr:0,sp:0,result:0};
  // Dashboard KPI + kapsam tablosu TEK geçişte hazırlanır. Eski sürüm stats()
  // bittikten hemen sonra coverageHTML() ile aynı 3.054 koşu/30.915 atı ikinci
  // kez tarıyordu.
  for(const race of ar){
    if(race?.surface&&race.surface!=='BİLİNMİYOR')raceCoverage.surface++;
    if(race?.breed&&race.breed!=='BİLİNMİYOR')raceCoverage.breed++;
    if(race?.condition_text)raceCoverage.condition++;
    if(race?.race_date)raceCoverage.date++;
    const rows=Array.isArray(race?.horses)?race.horses:[];
    horses+=rows.length;horseCoverage.total+=rows.length;
    let hasValue=false;
    for(const h of rows){
      if(tkpAnalysisIsWinner(h))winners++;
      if(h?.value_score!==null&&Number(h?.value_score)>0){hasValue=true;horseCoverage.value++;}
      if(tkpTableHasNumber(h?.hndkp))horseCoverage.hndkp++;
      if(typeof tkpTrustedGcTrValue==='function'&&tkpTrustedGcTrValue(h)!==null)horseCoverage.tr++;
      if(tkpTableHasNumber(h?.sp))horseCoverage.sp++;
      if(tkpTableHasNumber(h?.result_score))horseCoverage.result++;
    }
    if(hasValue)valueRaces++;
  }
  let files=0,quarantine=0;
  for(const file of (Array.isArray(db?.files)?db.files:[])){
    if(file?.status==='ACTIVE')files++;else quarantine++;
  }
  const value={
    files,
    quarantine,
    races: ar.length,
    totalRaces: Array.isArray(db.races)?db.races.length:ar.length,
    inactiveRaces: Math.max(0,(Array.isArray(db.races)?db.races.length:ar.length)-ar.length),
    horses,
    winners,
    valueRaces,
    coverage:{race:raceCoverage,horse:horseCoverage}
  };
  _tkpStatsSummaryCache={signature,value};
  if(!db.learning_state||typeof db.learning_state!=='object')db.learning_state={};
  db.learning_state.stats_summary_v2={signature,value,savedAt:Date.now()};
  if(typeof tkpPersistDerivedSignatureMetaSoon==='function')tkpPersistDerivedSignatureMetaSoon({stats_summary_v2:db.learning_state.stats_summary_v2});
  return value;
}
const _categoryAnalysisCache=new Map();
function categoryAnalysis(key){
  const archive=globalThis.TKPArchiveAnalytics?.peek();if(archive?.categories[key])return archive.categories[key];
  // R16.14: kategori kapsamı sonuç varlığına bağlı değildir. Pist/safkan/hipodrom/
  // koşu ailesi/mesafe gibi boyutlar mevcut bütün arşivden sayılır; yalnız başarı
  // metrikleri doğrulanmış sonuçlu yarışlarda hesaplanır. Böylece 3.000+ koşu
  // bellekteyken kartların 0 görünmesi engellenir, fakat sonuçsuz kayıt kazanmış
  // gibi sayılmaz.
  const allRows=Array.isArray(db?.races)?db.races:[];
  const cacheKey=`${tkpStatsCacheSignature()}|all:${allRows.length}|${key}`;
  if(_categoryAnalysisCache.has(cacheKey)) return _categoryAnalysisCache.get(cacheKey);
  let groups = {};
  for (const r of tkpBoundedRacesForReport(allRows)){
    let k = r[key] || 'BİLİNMİYOR';
    let g = groups[k] || (groups[k] = {races:0,resultRaces:0,agfRaces:0,resultRankRaces:0,horses:0,valueRaces:0,agf1:0,result1:0,bmbWin:0,bmbRaces:0});
    const allHorses=Array.isArray(r?.horses)?r.horses:[];
    const horses=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):allHorses.filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
    g.races++;
    g.horses += horses.length;
    if (horses.some(h=>h.value_score!==null && h.value_score>0)) g.valueRaces++;
    const hasResult=typeof raceHasConfirmedResult==='function'?raceHasConfirmedResult(horses):horses.some(tkpAnalysisIsWinner);
    if(!hasResult) continue;
    g.resultRaces++;
    if (horses.some(h=>Number(h.agf_rank)===1)) g.agfRaces++;
    if (horses.some(h=>Number(h.agf_rank)===1 && tkpAnalysisIsWinner(h))) g.agf1++;
    if (horses.some(h=>Number(h.result_rank)===1)) g.resultRankRaces++;
    if (horses.some(h=>Number(h.result_rank)===1 && tkpAnalysisIsWinner(h))) g.result1++;
    let bs = horses.filter(h=>Number(h?.bmb)===1);
    if (bs.length){ g.bmbRaces++; if (bs.some(tkpAnalysisIsWinner)) g.bmbWin++; }
  }
  const value=Object.entries(groups).sort((a,b) => b[1].races - a[1].races);
  _categoryAnalysisCache.set(cacheKey,value);
  if(_categoryAnalysisCache.size>24) _categoryAnalysisCache.delete(_categoryAnalysisCache.keys().next().value);
  return value;
}

let _globalSignalStatsCache={signature:'',value:null};
function globalSignalStats(){
  const archive=globalThis.TKPArchiveAnalytics?.peek();if(archive)return archive.signals;
  const signature=tkpStatsCacheSignature();
  if(_globalSignalStatsCache.signature===signature&&_globalSignalStatsCache.value) return _globalSignalStatsCache.value;
  const sig = {
    bmb:   {label:'Gerçek BMB (VALUE=BMB)', total:0, p1:0, p2:0, p3:0, p4:0, p5:0},
    r1:    {label:'SONUÇ 1. sıra', total:0, p1:0, p2:0, p3:0, p4:0, p5:0},
    r26:   {label:'SONUÇ 2–6. sıra', total:0, p1:0, p2:0, p3:0, p4:0, p5:0},
    agf1:  {label:'AGF 1. sıra (favori)', total:0, p1:0, p2:0, p3:0, p4:0, p5:0},
    agf26: {label:'AGF 2–6. sıra', total:0, p1:0, p2:0, p3:0, p4:0, p5:0},
    extra: {label:'ODB (ODS dışı bomba)', total:0, p1:0, p2:0, p3:0, p4:0, p5:0},
    g8001: {label:'800G 1. sıra', total:0, p1:0, p2:0, p3:0, p4:0, p5:0}
  };
  const mark = (g,h) => {
    g.total++;
    const fp = tkpAnalysisFinishPosition(h);
    if (fp===1) g.p1++; else if (fp===2) g.p2++; else if (fp===3) g.p3++; else if (fp===4) g.p4++; else if (fp===5) g.p5++;
  };
  for (const r of tkpBoundedRacesForReport(learningEligibleRaces())){
    for (const h of r.horses){
      if (isNonRunner(h)) continue;
      if (Number(h.bmb) === 1) mark(sig.bmb, h);
      if (tkpAnalysisRank(h.result_rank) === 1) mark(sig.r1, h);
      else if (tkpAnalysisRank(h.result_rank)>=2 && tkpAnalysisRank(h.result_rank)<=6) mark(sig.r26, h);
      if (tkpAnalysisRank(h.agf_rank) === 1) mark(sig.agf1, h);
      else if (tkpAnalysisRank(h.agf_rank)>=2 && tkpAnalysisRank(h.agf_rank)<=6) mark(sig.agf26, h);
      if (isOdbCandidate(h)) mark(sig.extra, h);
      if (h.g800 === 1) mark(sig.g8001, h);
    }
  }
  for (const k of Object.keys(sig)){ const g=sig[k]; g.rate = g.total ? g.p1/g.total : 0; g.top4Rate = g.total ? (g.p1+g.p2+g.p3+g.p4)/g.total : 0; g.top5Rate = g.total ? (g.p1+g.p2+g.p3+g.p4+g.p5)/g.total : 0; g.lb = wilson(g.p1,g.total); }
  _globalSignalStatsCache={signature,value:sig};
  return sig;
}

// Kademeli güven zinciri: örneklem yeterliyse hipodrom bazlı oran kullanılır; o da
// yetersizse koşu şartına özel oran; o da yetersizse genel (global) Wilson alt sınırına
// düşülür. Böylece "Hipodrom bazlı sinyal performansı" ve "Sinyal bazlı isabet raporu"
// tabloları artık salt bilgilendirme değil, örneklem yeterli olduğunda skorlamaya otomatik
// yansıyor -- ama yetersiz örneklemde bugünkü (koşu şartı/genel) davranış aynen korunuyor.
function contextualSignalPct(hippoTotal, hippoP1, conditionTotal, conditionP1, globalLb){
  const MIN_HIPPO_SAMPLE=20, MIN_CONDITION_SAMPLE=8;
  if (Number(hippoTotal)>=MIN_HIPPO_SAMPLE) return Number(hippoP1)/Number(hippoTotal);
  if (Number(conditionTotal)>=MIN_CONDITION_SAMPLE) return Number(conditionP1)/Number(conditionTotal);
  return Number(globalLb)||0;
}

// KULLANICI TALEBİ: "Ayrıntılı Analiz" > hipodrom sinyal tablosunda Şili'nin iki ayrı
// kulübü (Club Hípico Santiago, Club Hípico de Concepción) iki ayrı satır olarak
// listeleniyordu. Yalnız BU görüntüleme tablosunda tek satırda birleştirilir (istatistik
// örneklemi toplanır); r.hippodrome alanı, backtest/leakage-guard eşleştirme anahtarları
// ve diğer tüm tablolar birebir aynı kalır -- yalnız bu fonksiyonun grup anahtarı etkilenir.
function tkpHippodromeSignalGroupKey(hip){
  const raw=String(hip||'').trim();
  if(!raw) return 'BİLİNMİYOR';
  const key=raw.toLocaleUpperCase('tr-TR');
  const isSantiagoChile = key.includes('SANTIAGO') && (key.includes('HIPICO')||key.includes('HÍPICO'));
  const isConcepcionChile = key.includes('CONCEPCION') || key.includes('CONCEPCİON');
  if(isSantiagoChile || isConcepcionChile) return 'SANTIAGO + CONCEPCIÓN ŞİLİ';
  return raw;
}

let _hippodromeSignalStatsCache={signature:'',value:null};
function hippodromeSignalStats(){
  const archive=globalThis.TKPArchiveAnalytics?.peek();if(archive)return archive.hippos;
  const signature=tkpStatsCacheSignature();
  if(_hippodromeSignalStatsCache.signature===signature&&_hippodromeSignalStatsCache.value) return _hippodromeSignalStatsCache.value;
  const groups = {};
  for (const r of tkpBoundedRacesForReport(learningEligibleRaces())){
    const k = tkpHippodromeSignalGroupKey(r.hippodrome);
    const g = groups[k] || (groups[k] = {races:0, bmb:{total:0,p1:0,p2:0,p3:0,p4:0,p5:0}, r6:{total:0,p1:0,p2:0,p3:0,p4:0,p5:0}, agf1:{total:0,p1:0,p2:0,p3:0,p4:0,p5:0}, extra:{total:0,p1:0,p2:0,p3:0,p4:0,p5:0}});
    g.races++;
    const mark = (s,h) => {
      s.total++;
      const fp = tkpAnalysisFinishPosition(h);
      if (fp===1) s.p1++; else if (fp===2) s.p2++; else if (fp===3) s.p3++; else if (fp===4) s.p4++; else if (fp===5) s.p5++;
    };
    for (const h of r.horses){
      if (isNonRunner(h)) continue;
      if (Number(h.bmb)===1) mark(g.bmb,h);
      if (tkpAnalysisRank(h.result_rank)>=1 && tkpAnalysisRank(h.result_rank)<=6) mark(g.r6,h);
      if (tkpAnalysisRank(h.agf_rank)===1) mark(g.agf1,h);
      if (isOdbCandidate(h)) mark(g.extra,h);
    }
  }
  const value=Object.entries(groups).sort((a,b)=>b[1].races-a[1].races);
  _hippodromeSignalStatsCache={signature,value};
  return value;
}

const _winnerRankDistributionCache=new Map();
function winnerRankDistribution(rankField){
  const archive=globalThis.TKPArchiveAnalytics?.peek();if(archive?.ranks[rankField])return archive.ranks[rankField];
  const cacheKey=`${tkpStatsCacheSignature()}|${rankField}`;
  if(_winnerRankDistributionCache.has(cacheKey)) return _winnerRankDistributionCache.get(cacheKey);
  let groups = {};
  for (const r of tkpBoundedRacesForReport(learningEligibleRaces())){
    let key = r.condition_family || 'BİLİNMİYOR';
    let winners = r.horses.filter(tkpAnalysisIsWinner);
    if (!winners.length) continue;
    let g = groups[key] || (groups[key] = {'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0, total:0, races:0, ties:0});
    g.races++;
    if (winners.length > 1) g.ties++;
    for (const w of winners){
      g.total++;
      const rk = Number(w[rankField]);
      if (!Number.isInteger(rk) || rk < 1) g.yok++;
      else if (rk <= 7) g[String(rk)]++;
      else if (rk === 8) g.alt1++;
      else if (rk === 9) g.alt2++;
      else if (rk === 10) g.alt3++;
      else g.alt4++;
    }
  }
  _winnerRankDistributionCache.set(cacheKey,groups);
  if(_winnerRankDistributionCache.size>16) _winnerRankDistributionCache.delete(_winnerRankDistributionCache.keys().next().value);
  return groups;
}

// V1.1.252: snapshotTop() (-> bestRules() -> getCurrentRules() -> gerekirse tam
// buildRules()) artık hiçbir yerden çağrılmıyor; confirmImport() V1.1.225'te
// ucuz snapshotTopPeek()'e geçmişti. Fonksiyon kasıtlı olarak kaldırıldı (bkz.
// buildrules-sync-path-unreachable-regression.test.js).

// V1.1.225 HIZ MİMARİSİ KÖK FIX: snapshotTop() -> bestRules() -> getCurrentRules() zinciri,
// önbellek geçersizse (rulesDirty || imza uyuşmuyor) TAM kural madenciliğini (buildRules())
// senkron çalıştırıyordu. Gerçek arşivde (2990 koşu, 312 atomik özellik) bu TEK çağrı
// ~29 saniye sürüyor — ve confirmImport() her sonuç/dosya onayında bunu "önce" VE "sonra"
// olmak üzere İKİ KEZ çağırıyordu (~58 sn tarayıcı donması, HER onayda). Bu fonksiyon
// yalnız zaten hazır (hydrate edilebilir) bir kural önbelleği varsa ucuza karşılaştırma
// yapar; yoksa null döner ve ÇAĞIRAN taraf pahalı yeniden hesaplamayı TETİKLEMEZ — tıpkı
// tkpPeekCurrentRules()'un "read-only render asla tam kural madenciliğini başlatmaz"
// ilkesiyle aynı mantık, sadece önce/sonra bilgi logu için.
function snapshotTopPeek(){
  const rows=typeof tkpPeekCurrentRules==='function'?tkpPeekCurrentRules():null;
  if(!rows) return null;
  return rows.filter(x=>x.single>=Math.max(TKP_LEARNED_RULE_MIN_RACES,db.settings.best_min_single)).slice(0,5).map(x=>x.name+'|'+x.single+'|'+x.singleWins).join(';;');
}

// KÖK FIX (V1.1.11 — aşırı veride kasma): changelog da sınırsız büyüyordu (her işlemde
// bir satır, hiç budanmıyordu). İnsan tarafından okunan bir aktivite kaydı olduğu için
// bilgi kaybı önemsiz -- en eski 3000'i aşan kayıtlar sessizce atılır, en yeni 3000 kalır.
const CHANGELOG_MAX_ENTRIES = 3000;
function log(type, message){
  db.changelog = db.changelog || [];
  db.changelog.push({ts:new Date().toISOString(), type, message});
  if(db.changelog.length>CHANGELOG_MAX_ENTRIES) db.changelog.splice(0, db.changelog.length-CHANGELOG_MAX_ENTRIES);
}

function ensurePredictionLog(){ if (!Array.isArray(db.prediction_log)) db.prediction_log = []; }

// Yarış-öncesi kilit, bültenin genel/ilk yarış saatiyle değil her ayağın kendi
// TJK program saatiyle kanıtlanır. Bir toplantının ilk ayağı sonuçlandıktan sonra
// daha sonraki ayaklar hâlâ güvenle snapshotlanabilir; tersine tek bir dosya saati
// bütün ayaklara uygulanırsa geç başlayan ayak için yanlış canlı kanıt üretilebilir.
function tkpPredictionSnapshotRaceStartAt(race={}, parsed={}, allowFileStart=false){
  const direct=[race?.race_start_at,race?.start_at,race?.race_start,race?.start_time_iso]
    .map(v=>String(v||'').trim()).find(Boolean)||
    (allowFileStart?[parsed?.file?.race_start_at,parsed?.file?.start_at,parsed?.file?.race_start]
      .map(v=>String(v||'').trim()).find(Boolean):'');
  const directMs=Date.parse(direct);
  if(Number.isFinite(directMs)) return new Date(directMs).toISOString();
  const rawDate=String(race?.race_date||race?.date||parsed?.file?.race_date||parsed?.file?.date||'').trim();
  const rawTime=String(race?.tjk_race_time||race?.race_time||race?.start_time||race?.time||'').trim();
  const tm=rawTime.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s|$)/);
  let year=0,month=0,day=0;
  const iso=rawDate.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const tr=rawDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if(iso){year=Number(iso[1]);month=Number(iso[2]);day=Number(iso[3]);}
  else if(tr){year=Number(tr[3]);month=Number(tr[2]);day=Number(tr[1]);}
  if(!tm||!year||!month||!day) return '';
  const hh=String(Math.max(0,Math.min(23,Number(tm[1])||0))).padStart(2,'0');
  const mm=String(Math.max(0,Math.min(59,Number(tm[2])||0))).padStart(2,'0');
  const value=Date.parse(`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${hh}:${mm}:00+03:00`);
  return Number.isFinite(value)?new Date(value).toISOString():'';
}

function tkpPredictionSnapshotIsLivePreRace(capturedAt,race,raceStartAt){
  const captured=Date.parse(String(capturedAt||'')),start=Date.parse(String(raceStartAt||''));
  const hasResult=(race?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0);
  return !hasResult&&Number.isFinite(captured)&&Number.isFinite(start)&&captured<start;
}

function scoreBand(score){
  const x=Number(score||0);
  if(x<0.30)return {key:'0.00-0.29',label:'0,00–0,29'};
  if(x<0.60)return {key:'0.30-0.59',label:'0,30–0,59'};
  if(x<0.90)return {key:'0.60-0.89',label:'0,60–0,89'};
  if(x<1.20)return {key:'0.90-1.19',label:'0,90–1,19'};
  if(x<1.40)return {key:'1.20-1.39',label:'1,20–1,39'};
  if(x<1.70)return {key:'1.40-1.69',label:'1,40–1,69'};
  if(x<2.00)return {key:'1.70-1.99',label:'1,70–1,99'};
  return {key:'2.00+',label:'2,00+'};
}

let _predictionLogBandStatsCache={revision:'',bands:null};
function predictionLogStats(score){
  ensurePredictionLog();
  const b=scoreBand(score);
  const revision=typeof sideBetPredictionLogRevisionSignature==='function'
    ? sideBetPredictionLogRevisionSignature(db) : String(db.prediction_log.length);
  if(_predictionLogBandStatsCache.revision!==revision||!_predictionLogBandStatsCache.bands){
    const bands=new Map();
    for(const row of db.prediction_log){
      if(Number(row?.resolved)!==1) continue;
      const key=String(row?.score_band||scoreBand(row?.score).key);
      const item=bands.get(key)||{total:0,wins:0};
      item.total++; if(Number(row?.winner)===1||Number(row?.finish_position)===1) item.wins++;
      bands.set(key,item);
    }
    _predictionLogBandStatsCache={revision,bands};
  }
  const item=_predictionLogBandStatsCache.bands.get(b.key)||{total:0,wins:0};
  return {band:b,total:item.total,wins:item.wins,rate:item.total?item.wins/item.total:0};
}

function savePredictionSnapshot(parsed, raceResults, options={}){
  ensurePredictionLog();
  const fp=fingerprint(parsed);
  const strategyVersion=typeof TKP_SIDE_BET_STRATEGY_VERSION==='string'
    ? TKP_SIDE_BET_STRATEGY_VERSION
    : 'V33-SIDE-BET-EXACT-P1-P5';
  const versionedFp=fp+'|'+strategyVersion;
  const deferSideBetRankings=options?.deferSideBetRankings===true;
  const refreshDeferredSideBetRankings=options?.refreshDeferredSideBetRankings===true;
  const compatiblePredictionFps=new Set([versionedFp]);
  // Eski kullanıcı verisini silmeden V37.3 öncesi fingerprint kayıtlarını tanı.
  // Biri sonuçsuz ilk kayıt, diğeri sonuçla ilk kez açılmış eski dosya içindir.
  if(typeof legacyFingerprint==='function'){
    compatiblePredictionFps.add(legacyFingerprint(parsed,false)+'|'+strategyVersion);
    compatiblePredictionFps.add(legacyFingerprint(parsed,true)+'|'+strategyVersion);
  }
  const ts=new Date().toISOString();
  // Capture TKP's own P1 baseline before any external Expert/Kulis blending.  It
  // is an audit/control record only (never a commentator contributor) and uses
  // the same timestamp lock as the prediction snapshot.
  try{
    if(!refreshDeferredSideBetRankings&&typeof globalThis.tkpCommentatorCaptureTkpBaseline==='function'){
      globalThis.tkpCommentatorCaptureTkpBaseline(raceResults,{parsed,captured_at:ts});
    }
  }catch(_){ }
  const existingPredictionRows=db.prediction_log.filter(x=>compatiblePredictionFps.has(x.prediction_fp));
  if(existingPredictionRows.length){
    // R16.35: kritik ilk boyada yan bahis P1-P5 sıralamaları ertelenmiş olabilir.
    // Arka plan cache'leri hazır olduğunda aynı immutable tahmin satırlarını YALNIZ
    // eksik yan-bahis sıralamalarıyla zenginleştir; yeni tahmin kaydı üretme.
    if(refreshDeferredSideBetRankings&&existingPredictionRows.some(row=>Number(row?.sidebet_rank_deferred)===1)){
      for(const x of (raceResults||[])){
        const legRows=existingPredictionRows.filter(row=>Number(row?.leg)===Number(x?.r?.leg)&&Number(row.sidebet_rank_deferred)===1);
        if(!legRows.length)continue;
        const source=(x?.scored||x?.r?.horses||[]).filter(Boolean);
        const sideRankings=options.preparedSideBetRankings?.get(x.r)
          ||(typeof sideBetPositionRankingsForRace==='function'?sideBetPositionRankingsForRace(x.r,source):null);
        const maps={};
        for(let position=1;position<=5;position++)maps[position]=new Map((sideRankings?.['p'+position]||[]).map((horse,index)=>[String(horse.horse_no),index+1]));
        for(const row of legRows){
          const no=String(row?.horse_no||'');
          for(let position=1;position<=5;position++)row['sidebet_rank_p'+position]=maps[position].get(no)||row['sidebet_rank_p'+position]||null;
          row.sidebet_rank_deferred=0;
        }
      }
    }
    // Tahmin logu zaten varsa tekrar log açma; ama ekrandaki güncel TKP skorları
    // db.races içine yazıldıysa kalıcı depoya işle.
    if(options.persist!==false&&globalThis.__tkpBulkPipelineActive!==true)saveDB(false);
    return;
  }
  const singleRacePayload=(raceResults||[]).length===1;
  for(const x of raceResults){
    const raceStartAt=tkpPredictionSnapshotRaceStartAt(x?.r||{},parsed,singleRacePayload);
    const livePreRace=tkpPredictionSnapshotIsLivePreRace(ts,x?.r||{},raceStartAt);
    // Tarihsel importlar ya da yarış saati kanıtı olmayan kartlar öğrenme araştırmasına
    // faydalıdır ama "canlı ileri-test" sayılmaz. Bu ayrım, sonradan sonuç eklenmiş
    // kartın yanlışlıkla aktif yan-bahis politikasını terfi ettirmesini engeller.
    const evidenceClass=livePreRace?'LIVE_PRE_RACE_LOCKED':'HISTORICAL_RECONSTRUCTED';
    const immutableHash=livePreRace?versionedFp:'';
    // tkpScoreAndSealRace() zaten x.scored'u stratejik sırada teslim eder. Kritik
    // ilk boyada aynı yarışı ikinci kez adaptive/ODB geçmiş taramasından geçirme.
    const commonOrder=deferSideBetRankings
      ? (x.scored||[]).slice()
      : ((typeof strategicOrderForRace==='function')
        ? strategicOrderForRace(x.r,(x.scored||[]))
        : (x.scored||[]).slice().sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)));
    // Yan bahis sırası Normal/Geniş/Sürpriz ortak planıyla zenginleştiriliyorsa gerçek
    // üretilen sıra kayda alınır. Böylece sonraki sonuçlar yan bahis motorunu gerçekten
    // kullandığı aday sırasına göre günceller; ham TKP sırasına göre değil.
    const ordered=deferSideBetRankings
      ? commonOrder
      : ((typeof sideBetStrategyPlan==='function') ? sideBetStrategyPlan(x).sequence : commonOrder);
    const sideRankings=deferSideBetRankings
      ? null
      : (typeof sideBetPositionRankingsForRace==='function' ? sideBetPositionRankingsForRace(x.r,(x.scored||[])) : null);
    const sideRankMaps={};
    for(let position=1;position<=5;position++){
      sideRankMaps[position]=new Map((sideRankings?.['p'+position]||ordered).map((horse,index)=>[String(horse.horse_no),index+1]));
    }
    const commonRank=new Map(commonOrder.map((h,i)=>[String(h.horse_no),i+1]));
    for(const [rankIndex,h] of ordered.entries()){
      const b=scoreBand(h.score);
      db.prediction_log.push({
        prediction_fp:versionedFp,ts,file_name:parsed.file.filename,race_date:parsed.file.race_date||'',
        hippodrome:fold(parsed.file.hippodrome||x.r.hippodrome),altili_no:Number(parsed.file.altili_no)||Number(x.r.altili_no)||1,leg:x.r.leg,
        file_id:x.r.file_id||parsed.file.id||'',meeting_uid:x.r.meeting_uid||x.r.file_id||parsed.file.id||'',race_uid:x.r.race_uid||x.r.id||'',
        evidence_class:evidenceClass,captured_at:livePreRace?ts:'',race_start_at:livePreRace?raceStartAt:'',immutable_snapshot_hash:immutableHash,
        condition_family:fold(x.r.condition_family||''),surface:fold(x.r.surface||''),
        distance:Number(x.r.distance)||0,breed:fold(x.r.breed||''),
        horse_no:String(h.horse_no||''),horse_name:fold(h.horse_name),score:Number(h.score||0),
        predicted_rank:rankIndex+1,common_rank:commonRank.get(String(h.horse_no))||null,
        sidebet_rank_p1:sideRankMaps[1].get(String(h.horse_no))||null,
        sidebet_rank_p2:sideRankMaps[2].get(String(h.horse_no))||null,
        sidebet_rank_p3:sideRankMaps[3].get(String(h.horse_no))||null,
        sidebet_rank_p4:sideRankMaps[4].get(String(h.horse_no))||null,
        sidebet_rank_p5:sideRankMaps[5].get(String(h.horse_no))||null,
        sidebet_rank_deferred:deferSideBetRankings?1:0,
        ypuan:Number(h.ypuan)||0,agf:Number(h.agf)||0,agf_rank:Number(h.agf_rank)||null,
        bmb:Number(h.bmb)===1?1:0,odb:(typeof isOdbCandidate==='function'&&isOdbCandidate(h))?1:0,
        strategy_version:strategyVersion,score_band:b.key,resolved:0,winner:0
      });
    }
  }
  if(options.persist!==false&&globalThis.__tkpBulkPipelineActive!==true)saveDB(false);
}

// Enrich the same frozen rows using the same ready-model mode as the visible
// side-bet panel. Each leg yields; never train five historical models inline.
async function tkpEnrichPredictionSnapshotAsync(parsed,raceResults,options={}){
  const sourceDb=db;
  const isCurrent=()=>sourceDb===db&&(typeof options.isCurrent!=='function'||options.isCurrent());
  if(!isCurrent())return false;
  const version=typeof TKP_SIDE_BET_STRATEGY_VERSION==='string'?TKP_SIDE_BET_STRATEGY_VERSION:'V33-SIDE-BET-EXACT-P1-P5';
  const fps=new Set([fingerprint(parsed)+'|'+version]);
  if(typeof legacyFingerprint==='function'){
    fps.add(legacyFingerprint(parsed,false)+'|'+version);fps.add(legacyFingerprint(parsed,true)+'|'+version);
  }
  const pending=(db.prediction_log||[]).filter(row=>fps.has(row.prediction_fp)&&Number(row.sidebet_rank_deferred)===1);
  if(!pending.length)return true;
  const preparedSideBetRankings=new Map();
  for(const x of raceResults||[]){
    if(!pending.some(row=>Number(row.leg)===Number(x?.r?.leg)))continue;
    await new Promise(resolve=>setTimeout(resolve,0));
    if(!isCurrent())return false;
    if(typeof adaptiveSignalStatsAsync==='function')await adaptiveSignalStatsAsync(x?.r||null);
    if(!isCurrent())return false;
    if(typeof sideBetPositionRankingsForRace!=='function')return false;
    const previous=globalThis.__tkpSideBetPanelNoScan;
    try{
      globalThis.__tkpSideBetPanelNoScan=true;
      preparedSideBetRankings.set(x.r,sideBetPositionRankingsForRace(x.r,x.scored||x.r.horses||[]));
    }finally{globalThis.__tkpSideBetPanelNoScan=previous;}
  }
  if(!isCurrent())return false;
  savePredictionSnapshot(parsed,raceResults,{refreshDeferredSideBetRankings:true,preparedSideBetRankings,persist:false});
  if(typeof invalidateSideBetCache==='function')invalidateSideBetCache();
  // No whole-archive save for five rank fields on the current meeting's log.
  try{
    const saved=typeof tkpPersistCollections==='function'
      ?await tkpPersistCollections(['prediction_log'],{label:'final-agf-sidebet-ranks'})
      :await saveDB(false);
    if(saved===false)throw new Error('Yan bahis tahmin kaydı kalıcı depoya yazılamadı.');
  }catch(error){
    // Keep failed writes retryable instead of treating RAM-only ranks as durable.
    if(sourceDb===db)for(const row of pending)row.sidebet_rank_deferred=1;
    throw error;
  }
  return true;
}

function resolvePredictionLogWithRaces(races){
  ensurePredictionLog();
  let changed=0;
  // V1.1.279 HIZ KÖK FIX: eski yol HER sonuçlanan yarış için prediction_log'un
  // tamamını filter() ile tarıyordu. 3.000+ yarış / on binlerce log satırında bu
  // O(race × log) davranışa dönüşüyordu. Çözülmemiş satırlar tek geçişte dar bir
  // anahtara indekslenir; her yarış yalnız kendi aday kovasını okur.
  const fileAltById=new Map((db.files||[]).map(f=>[String(f?.id),Number(f?.altili_no)||1]));
  const byKey=new Map();
  const keyOf=(leg,hip,date,alt,meeting)=>[
    Number(leg)||0,
    fold(hip||''),
    String(date||''),
    Number(alt)||1,
    String(meeting||'')
  ].join('|');
  for(const rec of (db.prediction_log||[])){
    if(rec?.resolved===1)continue;
    const k=keyOf(rec?.leg,rec?.hippodrome,rec?.race_date,rec?.altili_no,rec?.meeting_uid);
    if(!byKey.has(k))byKey.set(k,[]);
    byKey.get(k).push(rec);
  }
  for(const r of (races||[])){
    const raceAlt=Number(r?.altili_no)||fileAltById.get(String(r?.file_id))||1;
    const meetingUid=String(r?.meeting_uid||r?.file_id||'');
    const hip=fold(r?.hippodrome||'');
    const date=String(r?.race_date||'');
    // Eski eşleşme semantiği tarih/meeting_uid boş satırlara izin veriyordu.
    // Bu yüzden kesin anahtarın yanında yalnız iki kontrollü fallback kovası okunur.
    const keys=[
      keyOf(r?.leg,hip,date,raceAlt,meetingUid),
      keyOf(r?.leg,hip,'',raceAlt,meetingUid),
      keyOf(r?.leg,hip,date,raceAlt,''),
      keyOf(r?.leg,hip,'',raceAlt,'')
    ];
    const seen=new Set();
    const candidates=[];
    for(const k of keys)for(const rec of (byKey.get(k)||[])){if(!seen.has(rec)){seen.add(rec);candidates.push(rec);}}
    const horseByName=new Map();
    const horseByNoName=new Map();
    for(const h of (r?.horses||[])){
      const name=fold(h?.horse_name||'');
      if(name&&!horseByName.has(name))horseByName.set(name,h);
      horseByNoName.set(`${String(h?.horse_no||'')}|${name}`,h);
    }
    for(const rec of candidates){
      const name=String(rec?.horse_name||'');
      const h=horseByNoName.get(`${String(rec?.horse_no||'')}|${name}`)||horseByName.get(name);
      if(h){ rec.resolved=1; rec.winner=(h.winner===1||h.finish_position===1)?1:0; rec.finish_position=h.finish_position||null; rec.resolved_at=new Date().toISOString(); changed++; }
    }
  }
  if(changed){
    // Sonuç prediction_log satırlarını yerinde günceller; satır sayısı değişmediği
    // için yalnız uzunluğa bakan eski önbellekler bunu kaçırabiliyordu. Sonuç
    // eşleştiği anda konuma özel P1-P5 öğrenmesini ve bütün yan bahis/backtest
    // önbelleklerini senkron geçersiz kıl.
    if(typeof invalidateAdaptiveLearningCache==='function') invalidateAdaptiveLearningCache();
    if(typeof invalidateSideBetCache==='function') invalidateSideBetCache();
    if(typeof tkpClearPerformanceCaches==='function') tkpClearPerformanceCaches();
    log('LEARNING', `${changed} tahmin kaydı gerçek sonuçlarla eşleştirildi; P1-P5 yan bahis öğrenmesi, skor bantları ve önbellekler güncellendi.`);
  }
  // Result resolution updates only the outcome side of immutable commentator
  // evidence.  Historical/reconstructed rows may be analysed, but their class
  // remains non-live and they cannot increase a live commentator's gate count.
  try{if(typeof globalThis.tkpCommentatorResolveResults==='function')globalThis.tkpCommentatorResolveResults(races);}catch(_){ }
  return changed;
}

let _matchedRulesMemo={ready:null,key:'',rules:null};
function matchedRuleStrength(r,h){
  // Canlı tahmin/kupon çizimi salt-okuma yoludur. Geçerli önbellek yoksa burada
  // getCurrentRules()->buildRules() zincirini başlatmak 503 dosyada ana thread'i
  // saniyelerce kilitliyordu. Kural madenciliği yalnız açık kullanıcı eyleminde
  // yapılır; hazır/hydrate edilmiş kurallar varsa aynı sonuç aynen kullanılır.
  const ready=typeof tkpPeekCurrentRules==='function'?tkpPeekCurrentRules():null;
  if(!Array.isArray(ready))return 0;
  // Hazır kural tablosundaki her yeterli örneklemli kural öğrenmeye adaydır.
  // Önceki top-3 Mükemmel + top-5 En İyi kesmesi, tablonun kalan doğrulanmış
  // kurallarını canlı sinyalden koparıyordu. Aynı hazır dizi için liste bir kez
  // hazırlanır; eşleşen kuralların en güçlü Wilson alt sınırı kullanılır ki benzer
  // kuralların kanıtı üst üste eklenip sinyal yapay biçimde şişmesin.
  const st=db.settings,ruleKey=[TKP_LEARNED_RULE_MIN_RACES,st.perfect_min_single,st.perfect_min_rate,st.perfect_min_lb,st.best_min_single,ready.length].join('|');
  let rules;
  if(_matchedRulesMemo.ready===ready&&_matchedRulesMemo.key===ruleKey)rules=_matchedRulesMemo.rules;
  else{
    const minSingles=Math.max(TKP_LEARNED_RULE_MIN_RACES,Number(st.best_min_single)||1);
    rules=ready.filter(x=>Number(x?.single)>=minSingles&&Number(x?.files)>=2&&Number.isFinite(Number(x?.lb))&&Array.isArray(x?.features)&&x.features.length>0);
    _matchedRulesMemo={ready,key:ruleKey,rules};
  }
  let strongest=0;
  for(const rule of rules){
    if(rule.features && rule.features.every(f=>f.test(h,r)) && rule.lb>strongest) strongest=rule.lb;
  }
  return Math.max(0,Math.min(1,strongest));
}

function adaptiveRaceRows(targetRace){
  const allRaw=learningEligibleRaces();
  if(!targetRace) return {rows:allRaw,level:'Tüm geçmiş'};
  // Aynı merkezî kesim hem canlı çağrıda hem backtest context kurulmadan yapılan
  // çağrıda zorunludur. Tarih/no belirsizse fail-closed kalır; güncel sonucu
  // "eğitim verisi" diye açmaz.
  const all=typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget(allRaw,targetRace,db)
    :[];
  const cond=broadConditionKey(targetRace.condition_family);
  const surface=normalizeSurface(targetRace.surface);
  const breed=normalizeBreed(targetRace.breed);
  const distance=distanceGroup(targetRace.distance);
  const hippo=targetRace.hippodrome;
  // Ayrıntılı Analiz'deki tüm boyutlar (koşu ailesi, pist, tür, mesafe, hipodrom) sırasıyla
  // en spesifikten en genele daraltılır; her seviye ADAPTIVE_MIN_RACES eşiğini geçmezse
  // bir üstteki daha geniş seviyeye düşülür. Böylece öğrenme sadece koşu ailesinden değil,
  // Ayrıntılı Analiz'in bütün verisinden beslenir.
  const levels=[
    {rows:all.filter(r=>broadConditionKey(r.condition_family)===cond && normalizeSurface(r.surface)===surface && normalizeBreed(r.breed)===breed && distanceGroup(r.distance)===distance && r.hippodrome===hippo), label:`${cond} · ${surface} · ${breed} · ${distance} · ${hippo}`},
    {rows:all.filter(r=>broadConditionKey(r.condition_family)===cond && normalizeSurface(r.surface)===surface && normalizeBreed(r.breed)===breed && distanceGroup(r.distance)===distance), label:`${cond} · ${surface} · ${breed} · ${distance}`},
    {rows:all.filter(r=>broadConditionKey(r.condition_family)===cond && normalizeSurface(r.surface)===surface && normalizeBreed(r.breed)===breed), label:`${cond} · ${surface} · ${breed}`},
    {rows:all.filter(r=>broadConditionKey(r.condition_family)===cond && normalizeSurface(r.surface)===surface), label:`${cond} · ${surface}`},
    {rows:all.filter(r=>broadConditionKey(r.condition_family)===cond), label:cond}
  ];
  for(const lvl of levels){
    if(lvl.rows.length>=ADAPTIVE_PROFILE_MIN_RACES) return {rows:lvl.rows,level:lvl.label};
  }
  return {rows:all,level:'Tüm geçmiş (koşu ailesinde veri az)'};
}

function adaptiveNumericOrNull(value){
  if(value===null||value===undefined||String(value).trim()===''||String(value).trim()==='-')return null;
  const n=Number(value);return Number.isFinite(n)?n:null;
}
function adaptiveGcTrValue(h){
  if(typeof tkpLearningGcTrValue==='function')return tkpLearningGcTrValue(h);
  const sources=[h?.tr_ganyan_source,h?.tr_source].map(v=>String(v??'').trim().toUpperCase());
  if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
  for(const raw of [h?.tr_ganyan,h?.tr_puan]){
    if(raw===null||raw===undefined||String(raw).trim()==='')continue;
    const n=Number(String(raw).replace(',','.'));if(Number.isFinite(n)&&n>0)return n;
  }
  return NaN;
}
function adaptiveHasDegreeInput(h){
  const prior=adaptiveNumericOrNull(h?.priorAccurateAvgSpeed);
  if(prior!==null&&prior>0)return true;
  const sec=typeof tkpHorseBestTimeSeconds==='function'?tkpHorseBestTimeSeconds(h):null;
  return Number.isFinite(sec)&&sec>0;
}
function adaptiveStartValue(h){
  for(const raw of [h?.start_no,h?.st,h?.start,h?.kulvar]){
    const n=adaptiveNumericOrNull(raw);if(n!==null&&n>0)return n;
  }
  return null;
}

function adaptiveSignalValue(r,h,key){
  const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(x=>!isNonRunner(x));
  if(key==='tkp'){
    const max=Math.max(0,...live.map(x=>Number(x.score)||0));
    return max>0 ? Math.max(0,Number(h.score)||0)/max : 0;
  }
  if(key==='agf'){
    const rank=Number(h.agf_rank||99), n=Math.max(6,live.length);
    return rank<=n ? Math.max(0,1-(rank-1)/n) : 0;
  }
  if(key==='ypuan'){
    // 0-112 teorik ölçekte 70 ve üzeri güçlü yorumcu konsensüsüdür.
    return Math.max(0,Math.min(1,(Number(h.ypuan)||0)/70));
  }
  if(key==='kg') return typeof tkpKgSignalValue==='function' ? tkpKgSignalValue(r,h) : 0;
  if(key==='degree') return typeof tkpDegreeSignalValue==='function' ? tkpDegreeSignalValue(r,h) : 0;
  if(key==='ganyan_tr'){
    // Yalnız Ganyan Canavarı TR kaynak damgası olan veri bu modele girebilir.
    // Legacy tr / AGF aliası veya kaynağı belirsiz tr_puan burada kullanılamaz.
    const values=live.map(adaptiveGcTrValue).filter(Number.isFinite);
    const value=adaptiveGcTrValue(h);
    if(!Number.isFinite(value) || !values.length) return 0;
    const min=Math.min(...values), max=Math.max(...values);
    return max>min ? Math.max(0,Math.min(1,(value-min)/(max-min))) : 0.5;
  }
  if(key==='accurate'){
    // Çekirdek Accurate sinyali yalnız yarıştan ÖNCE mevcut, pozitif geçmiş hız
    // ortalamasını kullanır. priorAccurateFinishSignal ayrı enrichment satırıdır;
    // burada tekrar sayılmaz.
    const liveValues=live.map(x=>adaptiveNumericOrNull(x?.priorAccurateAvgSpeed)).filter(v=>v!==null&&v>0);
    const value=adaptiveNumericOrNull(h?.priorAccurateAvgSpeed);
    if(value===null||value<=0 || !liveValues.length) return 0;
    const min=Math.min(...liveValues), max=Math.max(...liveValues);
    return max>min ? Math.max(0,Math.min(1,(value-min)/(max-min))) : 0.5;
  }
  if(key==='st'){
    const start=adaptiveStartValue(h);
    if(start===null) return 0;
    const field=Math.max(1,live.length);
    return Math.max(0,Math.min(1,1-(start-1)/field));
  }
  if(key==='condition'){
    if(Object.prototype.hasOwnProperty.call(r,'__tkpArchiveCondition')){
      const prefix=r.__tkpArchiveCondition,rk=tkpAnalysisRank(h.result_rank);
      const key=rk===null?'yok':rk<=7?String(rk):rk===8?'alt1':rk===9?'alt2':rk===10?'alt3':'alt4';
      const rankRate=rk!==null&&prefix?.rank?.total?(prefix.rank[key]||0)/prefix.rank.total:0;
      const bmbRate=Number(h.bmb)===1&&prefix?.bmbRaces?prefix.bmbWin/prefix.bmbRaces:0;
      return Math.max(0,Math.min(1,Math.max(rankRate,bmbRate,historyStrengthForCandidate(h))*.70+(Number(h.score)||0)*.30));
    }
    return Math.max(0,Math.min(1,conditionSingleStrength(r,h)));
  }
  if(key==='history') return Math.max(0,Math.min(1,historyStrengthForCandidate(h)));
  if(key==='last6') return typeof tkpLastSixFormValue==='function' ? tkpLastSixFormValue(h) : 0;
  if(key==='profile') return profileStrengthPct(r,h)/100;
  if(key==='extra'){
    // KÖK FIX (2026-08-23, kullanıcı tanımı): 'extra' anahtarı ADAPTIVE_LABELS'te
    // 'ODB' olarak etiketli ama tarihsel olarak historicalSurpriseProfileMatch()
    // kullanıyordu -- bu, kullanıcının ODB tanımıyla (AGF ilk 6 DEĞİL + SONUÇ ilk 6
    // DEĞİL + BMB sinyali ALMAMIŞ + geçmişte kazanmış olma kanıtı) örtüşmüyordu.
    // Artık tek, doğru ODB tanımı olan isOdbCandidate() (race-data.js) kullanılıyor.
    //
    // KURAL İSTİSNASI (2026-08-23, KULLANICI ONAYLI, BİLEREK): Önceki firma kural
    // "X/discovery verisi yalnız Uzman+Kulis'i etkiler, genel TKP/kupon skorunu
    // ASLA etkilemez" idi (X-Kulis izolasyon fix'i, bkz. x-kulis-engine.js /
    // tkpV55ExpertEvidence). Kullanıcıya bu 'extra' anahtarının GENEL skora
    // girdiği (adaptiveCompositeScore %60 + tkpPurposeCompositeScore %40, yani
    // Normal/Geniş/Sürpriz kuponun TAMAMI) ve X-tag/Y.PUAN-tail eklenirse bu
    // kuralın ihlal edileceği AÇIKÇA söylendi; kullanıcı "B) kuralı bu özel durum
    // için değiştir, X+Y.PUAN genel skora da girsin (bilerek kural ihlali)" seçti.
    // Bu, ARTIK SADECE ODB SİNYALİ İÇİN geçerli bilinçli bir istisnadır -- diğer
    // tüm sinyaller (ypuan, x_kulis anahtarı vb.) için eski izolasyon kuralı
    // AYNEN GEÇERLİDİR, DEĞİŞMEDİ.
    if(typeof isOdbCandidate==='function' && isOdbCandidate(h,r)) return 1;
    if(Number(h?.odb)===1) return 1;
    if(h?._ypuanOdbTail===true) return 1;
    if(typeof isOdbCandidate!=='function') return historicalSurpriseProfileMatch(r,h).matched ? 1 : 0;
    return 0;
  }
  if(key==='bmb') return Number(h.bmb)===1 && h.bmb_source!=='ŞABLON KURALI' ? 1 : 0;
  if(key==='rules') return matchedRuleStrength(r,h);
  return 0;
}

// Bir kaynak/alan eksik olduğunda atın diğer gerçek sinyalleri cezalandırılmaz.
// Bu yardımcı yalnız puanlama paydasını belirler; eksik değer hiçbir zaman yapay
// bir değerle doldurulmaz.
function adaptiveSignalPresentForHorse(r,h,key,available=false){
  const present=value=>adaptiveNumericOrNull(value)!==null;
  if(!available&&!adaptiveSignalAvailable(r,typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r?.horses||[]),key))return false;
  if(key==='tkp')return present(h?.score);
  if(key==='agf')return present(h?.agf)||present(h?.agf_rank);
  if(key==='ypuan')return present(h?.ypuan);
  if(key==='kg')return present(h?.weight_kg)||present(h?.kg);
  if(key==='degree')return adaptiveHasDegreeInput(h);
  if(key==='ganyan_tr')return Number.isFinite(adaptiveGcTrValue(h));
  if(key==='accurate'){const v=adaptiveNumericOrNull(h?.priorAccurateAvgSpeed);return v!==null&&v>0;}
  if(key==='st')return adaptiveStartValue(h)!==null;
  if(key==='history')return present(h?.priorStarts)||present(h?.priorWins);
  if(key==='last6')return Boolean(String(h?.son6_raw||'').trim()) || (typeof tkpLastSixStats==='function'&&tkpLastSixStats(h).starts>0);
  if(key==='profile')return Boolean(String(h?.horse_name||'').trim());
  if(key==='bmb')return Number(h?.bmb)===1&&h?.bmb_source!=='ŞABLON KURALI';
  if(key==='extra')return present(h?.result_rank)||present(h?.agf_rank)||Number(h?.bmb)===1;
  if(key==='rules')return ['value_score','result_score','hndkp','s_value','g800'].some(field=>present(h?.[field]));
  return true;
}

// Bir gösterge yalnız gerçekten bulunduğu KOŞULARDA test edilir. Önceki mantıkta
// TR PUAN olmayan koşularda bütün atlara 0 yazılıyor, sonra TKP eşitlik bozucu ile
// bir sıralama üretilip payda artırılıyordu. Bu nedenle 3 TR koşusu 276 koşu gibi
// görünüyordu. Eksik veri artık ne başarı ne başarısızlık olarak sayılır.
function adaptiveSignalAvailable(r,live,key){
  const rows=(live||[]).filter(h=>!isNonRunner(h));
  const countPresent=(...fields)=>rows.filter(h=>fields.some(f=>adaptiveNumericOrNull(h?.[f])!==null)).length;
  const countPositive=(...fields)=>rows.filter(h=>fields.some(f=>{const v=adaptiveNumericOrNull(h?.[f]);return v!==null&&v>0;})).length;
  if(key==='tkp') return countPresent('score')>=2;
  if(key==='agf') return countPositive('agf','agf_rank')>=2;
  if(key==='ypuan') return countPositive('ypuan')>=2;
  if(key==='kg') return countPositive('weight_kg','kg')>=2;
  if(key==='degree') return rows.filter(adaptiveHasDegreeInput).length>=2;
  if(key==='ganyan_tr') return rows.filter(h=>Number.isFinite(adaptiveGcTrValue(h))).length>=2;
  if(key==='accurate') return rows.filter(h=>{const v=adaptiveNumericOrNull(h?.priorAccurateAvgSpeed);return v!==null&&v>0;}).length>=2;
  if(key==='st') return rows.filter(h=>adaptiveStartValue(h)!==null).length>=2;
  if(key==='bmb') return rows.some(h=>Number(h?.bmb)===1&&h?.bmb_source!=='ŞABLON KURALI');
  if(key==='rules') return rows.some(h=>adaptiveSignalValue(r,h,'rules')>0);
  if(key==='history') return rows.some(h=>(Number(h?.priorStarts)||0)>0 || (Number(h?.priorWins)||0)>0);
  if(key==='last6') return rows.some(h=>typeof tkpLastSixStats==='function'&&tkpLastSixStats(h).starts>0);
  if(key==='extra') return rows.some(h=>adaptiveNumericOrNull(h?.result_rank)!==null||adaptiveNumericOrNull(h?.agf_rank)!==null||Number(h?.bmb)===1);
  return rows.length>0;
}

// Ölçümde açık BMB=0 bir kayıptır; puanlama için sinyal varlığı değişmez.
// Alanı eksik atlar ve şablon işaretleri gerçek BMB kanıtı sayılmaz.
function adaptiveSignalEvaluationHorses(r,live,key){
  if(key==='bmb')return live.filter(h=>{
    const value=adaptiveNumericOrNull(h?.bmb);
    return (value===0||value===1)&&h?.bmb_source!=='ŞABLON KURALI';
  });
  return live.filter(h=>adaptiveSignalPresentForHorse(r,h,key,true));
}

function adaptiveCacheKey(targetRace){
  if(!targetRace) return '__ALL_BMB_DENOMINATOR_V2__';
  // V1.1.198 KÖK FIX: anahtar yalnız şart/pist/mesafe/tür kombinasyonundan oluşuyordu,
  // tarih/ayak bilgisi yoktu. adaptiveRaceRows() içindeki sızıntı koruması (isPast)
  // hedef koşunun TARİHİNE göre geçmişi filtreliyor; ama bu cache tarihsiz anahtarla
  // çalıştığı için aynı şart grubundaki farklı tarihli koşular backtest sırasında
  // birbirinin önbelleğe alınmış "geçmiş" istatistiğini paylaşıyordu. Sıralı bir
  // backtest'te bu, sonraki koşunun aradaki koşuları öğrenmeye dahil etmemesine
  // (eksik training seti) yol açabiliyordu. Tarih + ayak eklenerek her koşunun kendi
  // doğru geçmiş penceresiyle önbelleğe alınması garanti edilir. Merkezi kesim
  // anahtarı tarih bozuk/eski kayıtta sequence_no fallback'ini de kapsar.
  const cutoff=typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'';
  return ['BMB_DENOMINATOR_V2',`C${cutoff}`,broadConditionKey(targetRace.condition_family), normalizeSurface(targetRace.surface), distanceGroup(targetRace.distance), normalizeBreed(targetRace.breed)].join('|');
}

// V1.1.308-MEM-FIX: tek bir yarışı out biriktiricisine işleyen paylaşılan yardımcı.
// Hem senkron adaptiveSignalStats hem de asenkron/bölünmüş adaptiveSignalStatsAsync
// TAM OLARAK bu fonksiyonu çağırır; algoritma tek yerde yaşar, iki kopya birbirinden
// sapamaz.
function _adaptiveAccumulateRace(r, keys, out){
  const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>!isNonRunner(h));
  const actualByPos={};
  for(let pos=1;pos<=5;pos++){
    actualByPos[pos]=live.filter(h=>tkpAnalysisFinishPosition(h)===pos);
  }
  if(!actualByPos[1].length) return;
  const sameActual=(horse,targets)=>targets.some(target=>
    String(horse?.horse_no)===String(target?.horse_no) ||
    (typeof sameEkuri==='function'&&sameEkuri(horse?.horse_no,target?.horse_no))
  );
  for(const key of keys){
    if(!adaptiveSignalAvailable(r,live,key)) continue;
    // R16.37 doğruluk: eksik alan 0 puan değildir. Yalnız bu sinyalin gerçekten
    // bulunduğu atlar kendi aralarında ölçülür; gerçek hedefte sinyal yoksa o
    // pozisyonun paydası artırılmaz. Ayrıca eşitliği TKP skoru ile çözmek sinyalin
    // isabetini başka modelden ödünç alıyordu; tie-break yalnız at numarasıdır.
    const eligible=adaptiveSignalEvaluationHorses(r,live,key);
    if(!eligible.length)continue;
    const eligibleSet=new Set(eligible);
    const signalValues=new Map();
    for(const h of eligible){
      const v = key==='extra'
        ? ((Number(h.result_rank)>=7 || Number(h.agf_rank)>=4 || Number(h.bmb)===1) ? 1 : 0)
        : adaptiveSignalValue(r,h,key);
      signalValues.set(h,v);
    }
    const ordered=eligible.slice().sort((a,b)=>
      (signalValues.get(b)||0)-(signalValues.get(a)||0) ||
      (typeof TKP_TR_COLLATOR_NUM!=='undefined'?TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||'')):String(a?.horse_no||'').localeCompare(String(b?.horse_no||'')))
    );
    for(let pos=1;pos<=5;pos++){
      const targets=actualByPos[pos].filter(h=>eligibleSet.has(h));
      if(!targets.length||ordered.length<pos) continue;
      const predicted=ordered[pos-1], predictedValue=signalValues.get(predicted);
      // Aynı sinyal değeri birden fazla atta varsa bu gösterge o exact pozisyonu
      // ayırt etmiş değildir. At numarasıyla keyfi sıra verip 'isabet' üretme.
      let tieCount=0;for(const candidate of eligible){if(signalValues.get(candidate)===predictedValue)tieCount++;}
      if(tieCount!==1)continue;
      const bucket=out[key]['p'+pos];
      bucket.total++;
      if(predicted&&sameActual(predicted,targets)) bucket.ok++;
    }
  }
}

function _adaptiveStatsInit(keys){
  const out={};
  // Exact derece öğrenmesi: p1-p5 yalnız kendi gerçek bitiriş konumunu ölçer.
  // Kümülatif "ilk N içinde" hesabı burada kullanılmaz.
  keys.forEach(k=>out[k]={p1:{ok:0,total:0},p2:{ok:0,total:0},p3:{ok:0,total:0},p4:{ok:0,total:0},p5:{ok:0,total:0}});
  return out;
}

function _adaptiveStatsFinalize(out, keys, source){
  for(const key of keys){
    for(const bucketKey of ['p1','p2','p3','p4','p5']){
      const g=out[key][bucketKey];
      // Beta(2,2) yumuşatma: 10 yarışta tek tesadüf ağırlığı aşırı oynatmasın.
      g.rate=(g.ok+2)/(g.total+4);
      g.rawRate=g.total?g.ok/g.total:0;
    }
  }
  out._source=source;
  return out;
}

function adaptiveSignalStats(targetRace){
  const archive=!targetRace&&globalThis.TKPArchiveAnalytics?.peek();if(archive?.adaptive)return archive.adaptive;
  const cacheKey=adaptiveCacheKey(targetRace);
  if(_adaptiveStatsCache.has(cacheKey)) return _adaptiveStatsCache.get(cacheKey);
  // V1.1.286 HIZ KÖK FIX: runtime Map boşsa (yeni oturum/sayfa yenileme), atlamadan
  // önce kalıcı depoyu dener. tkp-adaptive-cache-persist.js yüklenmemişse veya
  // arşiv o anahtarı kapsayan önek değiştiyse (bkz. o dosyadaki zincirleme parmak
  // izi doğrulaması) sessizce null döner ve aşağıdaki ORİJİNAL hesap AYNEN çalışır.
  if(typeof tkpAdaptiveStatsPersistRead==='function'){
    const persisted=tkpAdaptiveStatsPersistRead(cacheKey);
    if(persisted){ _adaptiveStatsCache.set(cacheKey,persisted); return persisted; }
  }
  const source=adaptiveRaceRows(targetRace);
  const keys=Object.keys(ADAPTIVE_BASE_WEIGHTS);
  const out=_adaptiveStatsInit(keys);
  for(const r of source.rows){
    _adaptiveAccumulateRace(r, keys, out);
  }
  _adaptiveStatsFinalize(out, keys, source);
  _adaptiveStatsCache.set(cacheKey,out);
  if(typeof tkpAdaptiveStatsPersistWrite==='function') tkpAdaptiveStatsPersistWrite(cacheKey,out);
  return out;
}

// V1.1.308-MEM-FIX: adaptiveSignalStats'ın asenkron, bölünmüş (chunked) ikizi.
// Gerçek veri ile ölçüldüğünde adaptiveSignalStats(null) 3018 yarışlık arşivde
// TEK SEFERDE ~187 saniye ana iş parçacığını kilitliyordu (Ayrıntılı Analiz sekmesi
// donması). Bu fonksiyon AYNI algoritmayı (_adaptiveAccumulateRace üzerinden, kod
// tekrarı ve davranış sapması riski olmadan) kullanır, ancak yarış döngüsü içinde
// ZAMANA DAYALI olarak tarayıcıya nefes aldırır.
// V1.1.308 İLK SÜRÜMDE sabit "her 120 yarışta bir" sayaç kullanılmıştı; gerçek
// veriyle ölçüldüğünde 120 yarışlık TEK bir dilim bile ~7 saniye sürüyordu --
// yani "donma" hâlâ (daha kısa aralıklarla da olsa) oluyordu. Kök neden: sabit
// yarış SAYISI, sabit SÜRE anlamına gelmiyor. Bunun yerine her yarıştan sonra
// geçen gerçek süre ölçülür; ADAPTIVE_ASYNC_CHUNK_MS aşılınca (donanım hızından
// bağımsız, her zaman kısa) hemen nefes verilir.
// Sonuç, senkron sürümle TAM OLARAK AYNI önbellek/kalıcı depo yoluna yazılır
// (_adaptiveStatsCache + tkpAdaptiveStatsPersistWrite), böylece kod tabanındaki
// ~15+ mevcut senkron çağıran (learning-engine-v2.js, prediction-engine.js,
// stats-engine.js, online-ranking-engine.js, ui-components.js,
// tkp-adaptive-cache-persist.js) HİÇBİR değişiklik gerektirmeden bu ön-ısıtmanın
// doldurduğu önbellekten anında (senkron) sonuç alır.
const ADAPTIVE_ASYNC_CHUNK_MS = 30;
const ADAPTIVE_ASYNC_SLICE_MS = 8;
const _adaptiveStatsInFlight = new Map();
let _adaptiveStatsGeneration = 0;
async function _adaptiveAccumulateRaceAsync(r, keys, out, state){
  const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>!isNonRunner(h));
  const actualByPos={};
  for(let pos=1;pos<=5;pos++){
    actualByPos[pos]=live.filter(h=>tkpAnalysisFinishPosition(h)===pos);
  }
  if(!actualByPos[1].length)return;
  const now=()=>(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const yieldIfNeeded=()=>{
    // V1.1.330 LIVE-509 HIZ FIX: eşik aşılmamışsa Promise bile üretme. Önceki
    // async helper + `await yieldIfNeeded()` kombinasyonu yüz binlerce gereksiz
    // microtask oluşturuyordu. Yalnız 8 ms gerçek CPU dilimi dolduğunda Promise
    // döndürülür ve UI'ye nefes verilir.
    if(now()-state.sliceStart<ADAPTIVE_ASYNC_SLICE_MS)return null;
    const pause=typeof tkpYieldToUi==='function'
      ? Promise.resolve(tkpYieldToUi())
      : new Promise(resolve=>setTimeout(resolve,0));
    return pause.then(()=>{state.sliceStart=now();});
  };
  const sameActual=(horse,targets)=>targets.some(target=>
    String(horse?.horse_no)===String(target?.horse_no) ||
    (typeof sameEkuri==='function'&&sameEkuri(horse?.horse_no,target?.horse_no))
  );
  for(const key of keys){
    if(!adaptiveSignalAvailable(r,live,key))continue;
    const eligible=adaptiveSignalEvaluationHorses(r,live,key);
    if(!eligible.length)continue;
    const eligibleSet=new Set(eligible);
    const signalValues=new Map();
    for(const h of eligible){
      const v=key==='extra'
        ? ((Number(h.result_rank)>=7||Number(h.agf_rank)>=4||Number(h.bmb)===1)?1:0)
        : adaptiveSignalValue(r,h,key);
      signalValues.set(h,v);
      const pause=yieldIfNeeded(); if(pause)await pause;
    }
    const ordered=eligible.slice().sort((a,b)=>
      (signalValues.get(b)||0)-(signalValues.get(a)||0) ||
      (typeof TKP_TR_COLLATOR_NUM!=='undefined'?TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||'')):String(a?.horse_no||'').localeCompare(String(b?.horse_no||'')))
    );
    for(let pos=1;pos<=5;pos++){
      const targets=actualByPos[pos].filter(h=>eligibleSet.has(h));
      if(!targets.length||ordered.length<pos)continue;
      const predicted=ordered[pos-1],predictedValue=signalValues.get(predicted);
      let tieCount=0;for(const candidate of eligible){if(signalValues.get(candidate)===predictedValue)tieCount++;}
      if(tieCount!==1)continue;
      const bucket=out[key]['p'+pos];
      bucket.total++;
      if(predicted&&sameActual(predicted,targets))bucket.ok++;
    }
    // V1.1.330 LIVE-509 HIZ FIX: her sinyal anahtarından sonra zorunlu yield
    // yapmak 15 anahtar × 3.000+ koşuda on binlerce setTimeout(0) üretiyordu.
    // Eski Chromium/Win8.1 timer clamp'i bunu dakikalara uzatıyordu. Zaman dilimi
    // zaten her at sırasında 8 ms eşiğiyle kontrol ediliyor; anahtar sonunda yalnız
    // gerçekten eşik aşıldıysa yield et. Hesap/sonuç değişmez, sadece scheduler
    // overhead'i kalkar.
    const pause=yieldIfNeeded(); if(pause)await pause;
  }
}
async function adaptiveSignalStatsAsync(targetRace,retryCount=0){
  if(!targetRace&&globalThis.TKPArchiveAnalytics?.required()){const full=await globalThis.TKPArchiveAnalytics.ensureAdaptive();return full.adaptive;}
  const cacheKey=adaptiveCacheKey(targetRace);
  if(_adaptiveStatsCache.has(cacheKey)) return _adaptiveStatsCache.get(cacheKey);
  const inFlight=_adaptiveStatsInFlight.get(cacheKey);
  if(inFlight)return inFlight;
  if(typeof tkpAdaptiveStatsPersistRead==='function'){
    const persisted=tkpAdaptiveStatsPersistRead(cacheKey);
    if(persisted){ _adaptiveStatsCache.set(cacheKey,persisted); return persisted; }
  }
  const generation=_adaptiveStatsGeneration;
  const promise=(async()=>{
    const source=adaptiveRaceRows(targetRace);
    const keys=Object.keys(ADAPTIVE_BASE_WEIGHTS);
    const out=_adaptiveStatsInit(keys);
    const state={sliceStart:(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now()};
    for(const r of source.rows){
      if(generation!==_adaptiveStatsGeneration)throw new DOMException('Adaptif hesap geçersiz kılındı','AbortError');
      await _adaptiveAccumulateRaceAsync(r,keys,out,state);
      if(generation!==_adaptiveStatsGeneration)throw new DOMException('Adaptif hesap geçersiz kılındı','AbortError');
      // Hesap devam ederken önbellek yarım durumda okunmasın; yalnız UI'ye nefes aldır.
      if(_adaptiveStatsCache.has(cacheKey))return _adaptiveStatsCache.get(cacheKey);
    }
    _adaptiveStatsFinalize(out,keys,source);
    _adaptiveStatsCache.set(cacheKey,out);
    if(typeof tkpAdaptiveStatsPersistWrite==='function')tkpAdaptiveStatsPersistWrite(cacheKey,out);
    return out;
  })();
  _adaptiveStatsInFlight.set(cacheKey,promise);
  try{return await promise;}
  catch(error){
    // A concurrent save can invalidate the generation while this calculation yields.
    if(error?.name==='AbortError'&&generation!==_adaptiveStatsGeneration&&retryCount<2){
      if(_adaptiveStatsInFlight.get(cacheKey)===promise)_adaptiveStatsInFlight.delete(cacheKey);
      return await adaptiveSignalStatsAsync(targetRace,retryCount+1);
    }
    throw error;
  }
  finally{if(_adaptiveStatsInFlight.get(cacheKey)===promise)_adaptiveStatsInFlight.delete(cacheKey);}
}
if(typeof globalThis!=='undefined'){
  globalThis.adaptiveSignalStatsAsync=adaptiveSignalStatsAsync;
  globalThis.tkpInvalidateAdaptiveStatsAsync=function(){_adaptiveStatsGeneration++;_adaptiveStatsInFlight.clear();};
}

const ADAPTIVE_COMBOS = [
  {key:'tkp_agf', label:'TKP + AGF', parts:['tkp','agf']},
  {key:'tkp_profile', label:'TKP + Profil Gücü', parts:['tkp','profile']},
  {key:'agf_profile', label:'AGF + Profil Gücü', parts:['agf','profile']},
  {key:'tkp_agf_profile', label:'TKP + AGF + Profil Gücü', parts:['tkp','agf','profile']},
  {key:'tkp_agf_profile_ypuan', label:'TKP + AGF + Profil + Y.PUAN', parts:['tkp','agf','profile','ypuan']},
  {key:'tkp_agf_profile_ypuan_kg_degree', label:'TKP + AGF + Profil + Son 6 + Y.PUAN + KG + DRC + Ganyan TR', parts:['tkp','agf','profile','last6','ypuan','kg','degree','ganyan_tr','accurate','st']}
];

let _adaptiveComboCache=new Map();
function adaptiveComboStats(targetRace){
  const cacheKey=adaptiveCacheKey(targetRace);
  if(_adaptiveComboCache.has(cacheKey)) return _adaptiveComboCache.get(cacheKey);
  const source=adaptiveRaceRows(targetRace);
  const prepared=[];
  for(const r of source.rows){
    const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>!isNonRunner(h));
    const winners=new Set(live.filter(tkpAnalysisIsWinner).map(h=>String(h.horse_no)));
    if(!winners.size) continue;
    const values=new Map();
    for(const h of live){
      values.set(h,{
        tkp:adaptiveSignalValue(r,h,'tkp'),
        agf:adaptiveSignalValue(r,h,'agf'),
        profile:adaptiveSignalValue(r,h,'profile'),
        last6:adaptiveSignalValue(r,h,'last6'),
        ypuan:Math.max(0,Math.min(1,(Number(h.ypuan)||0)/70)),
        kg:adaptiveSignalValue(r,h,'kg'),
        degree:adaptiveSignalValue(r,h,'degree'),
        ganyan_tr:adaptiveSignalValue(r,h,'ganyan_tr'),
        accurate:adaptiveSignalValue(r,h,'accurate'),
        st:adaptiveSignalValue(r,h,'st')
      });
    }
    const hits={};
    for(const combo of ADAPTIVE_COMBOS){
      // Kombinasyon etikette hangi parçaları söylüyorsa o parçaların tamamı bu
      // koşuda mevcut olmalı. Örn. Ganyan TR içeren kombinasyon TR'siz koşuda
      // sahte bir tahmin üretip örnek sayısını büyütemez.
      if(!combo.parts.every(key=>adaptiveSignalAvailable(r,live,key))){
        hits[combo.key]=null;
        continue;
      }
      const ordered=live.slice().sort((a,b)=>{
        const va=values.get(a), vb=values.get(b);
        const sa=combo.parts.reduce((t,k)=>t+(va[k]||0),0)/combo.parts.length;
        const sb=combo.parts.reduce((t,k)=>t+(vb[k]||0),0)/combo.parts.length;
        return sb-sa || (Number(b.score)||0)-(Number(a.score)||0);
      });
      hits[combo.key]=[];
      let found=false;
      for(let pos=1;pos<=5;pos++){
        const h=ordered[pos-1];
        if(h && winners.has(String(h.horse_no))) found=true;
        hits[combo.key][pos]=found;
      }
    }
    prepared.push({hits});
  }
  const windows=[50,100,200,300];
  const out={sample:prepared.length,level:source.level,rows:{}};
  for(const combo of ADAPTIVE_COMBOS){
    out.rows[combo.key]={label:combo.label,windows:{}};
    for(const n of windows){
      const rows=prepared.filter(row=>Array.isArray(row.hits[combo.key])).slice(-n);
      const g={sample:rows.length};
      for(let pos=1;pos<=5;pos++){
        let ok=0;
        for(const row of rows) if(row.hits[combo.key][pos]) ok++;
        g['k'+pos]={ok,total:rows.length,rawRate:rows.length?ok/rows.length:0};
      }
      out.rows[combo.key].windows[n]=g;
    }
  }
  _adaptiveComboCache.set(cacheKey,out);
  return out;
}

let _valueBandWeightsCache = {key:null, value:null};
// KULLANICI TALİMATI: "Altılıya para verdiren" değer bandı (SONUÇ 6-8, AGF 6-11,
// gerçek BMB/ODB ve ilk 8 dışı Y.PUAN 8-20 ODB) ve BMB/ODB'nin göreli ağırlığı artık sabit/donuk
// sayılar değil -- adaptiveWeightsForRace'in kullandığı aynı desenle (activeRaces()
// üzerinden her seferinde taze hesaplanan, örneklem büyüdükçe güveni artan) canlı
// öğreniyor. Yeni bir yarış sonucu girildiğinde bir sonraki çağrıda otomatik yansır;
// elle "tekrar analiz et" demeye gerek yok.
function valueBandSignalWeights(){
  const races = learningEligibleRaces();
  const lastId = races.length ? races[races.length-1].id : 0;
  const cacheKey = races.length+'|'+lastId;
  if (_valueBandWeightsCache.key === cacheKey) return _valueBandWeightsCache.value;

  const criteria = {
    sonuc678: h => h.result_rank!=null && h.result_rank>=6 && h.result_rank<=8,
    agf6_11: h => h.agf_rank!=null && h.agf_rank>=6 && h.agf_rank<=11,
    bmbOdb: h => Number(h.bmb)===1 || isOdbCandidate(h),
    ypuan8_20: h => (typeof isOdbCandidate==='function' && isOdbCandidate(h) && Number(h.ypuan)>=8 && Number(h.ypuan)<=20)
  };

  let totalHorses=0, totalWinners=0;
  const acc={}; for(const key in criteria) acc[key]={match:0,win:0};

  for(const r of races){
    const winner=(r.horses||[]).find(h=>h.winner===1 || h.finish_position===1);
    for(const h of (r.horses||[])){
      totalHorses++;
      const isWinner = winner && String(h.horse_no)===String(winner.horse_no);
      if(isWinner) totalWinners++;
      for(const key in criteria){
        if(!criteria[key](h)) continue;
        acc[key].match++;
        if(isWinner) acc[key].win++;
      }
    }
  }

  const baseline = totalHorses ? totalWinners/totalHorses : 0.10;
  const out={baseline,sample:races.length};
  for(const key in acc){
    const {match,win}=acc[key];
    const rawRate = match ? win/match : 0;
    // Örneklem küçükken (az sayıda BMB/ODB/AGF-band ata rastlanmışsa) ham orana
    // tam güvenilmez; adaptiveWeightsForRace'teki gibi ADAPTIVE_FULL_TRUST_RACES'e
    // göre güven kademeli artar. Az örneklemde rawRate yerine baseline'a yakın kalınır.
    const trust = Math.max(0,Math.min(1, match/ADAPTIVE_FULL_TRUST_RACES));
    const shrunk = baseline + (rawRate-baseline)*trust;
    // lift: bu sinyalin baseline'a göre gerçek katkısı. Negatifse (BMB gibi ortalamanın
    // altına düşen bir sinyalse) kural kendi kendine devre dışı kalır (weight=0).
    const lift = Math.max(0, shrunk-baseline);
    out[key] = {match, win, rawRate, trust, shrunk, weight: lift};
  }
  _valueBandWeightsCache = {key:cacheKey, value:out};
  return out;
}


function adaptiveWeightsForRace(targetRace, k=4){
  const safeK=Math.max(1,Math.min(5,k));
  const cacheKey=adaptiveCacheKey(targetRace)+'|k'+safeK;
  if(_adaptiveWeightsCache.has(cacheKey)) return _adaptiveWeightsCache.get(cacheKey);
  const stats=adaptiveSignalStats(targetRace);
  const keys=Object.keys(ADAPTIVE_BASE_WEIGHTS);
  const sample=stats._source.count??stats._source.rows.length;
  const ready=sample>=ADAPTIVE_MIN_RACES;
  const kk='p'+safeK;
  const availableKeys=keys.filter(key=>(Number(stats[key]?.[kk]?.total)||0)>0);
  const mean=availableKeys.length
    ? availableKeys.reduce((s,key)=>s+stats[key][kk].rate,0)/availableKeys.length
    : 1;
  const trust=Math.max(0,Math.min(1,sample/ADAPTIVE_FULL_TRUST_RACES));
  const raw={};
  for(const key of keys){
    const learned=Math.max(
      typeof ADAPTIVE_LEARNED_WEIGHT_FLOOR==='number'?ADAPTIVE_LEARNED_WEIGHT_FLOOR:.55,
      Math.min(typeof ADAPTIVE_LEARNED_WEIGHT_CEILING==='number'?ADAPTIVE_LEARNED_WEIGHT_CEILING:1.75,stats[key][kk].rate/mean)
    );
    const keySample=Number(stats[key]?.[kk]?.total)||0;
    const keyTrust=Math.max(0,Math.min(1,keySample/(typeof ADAPTIVE_WEIGHT_FULL_TRUST_RACES==='number'?ADAPTIVE_WEIGHT_FULL_TRUST_RACES:60)));
    // Veri yoksa veya çok azsa gösterge başarı ispatlamış sayılmaz; taban ağırlığı
    // korunur. 3 TR koşusu bütün veri setinin güvenini miras alamaz.
    let factor=1+(learned-1)*keyTrust;
    // KÖK FIX (2026-08-12): degree (DRC) sinyaline diğer TÜM sinyallerden 3 kat
    // güçlü bir adaptif öğrenme çarpanı uygulanıyordu (aşağıdaki yorum: "DRC ...
    // adaptif ağırlık %30'a kadar yaklaşabilir"). Gerçek prediction_log verisinde
    // bu değişiklikten (V37 -> V40/V41 "ALL-DETAIL-SIGNALS" dönemi) sonra top-1
    // isabeti %34,3'ten %22,2'ye, top-3 %79,4'ten %55,6'ya, top-5 %92,2'den
    // %74,1'e düştüğü doğrulandı. 3x çarpan, küçük örneklemde şans eseri yakalanan
    // bir korelasyonu agresifçe şişirip ağırlığı hızla %30 tavanına taşıyabiliyordu.
    // Artık degree, diğer tüm sinyallerle aynı standart (1x) adaptif muameleyi
    // görüyor; %30 tavanı güvenlik payı olarak korunuyor ama artık ona 3 kat hızlı
    // ulaşılamıyor.
    raw[key]=ADAPTIVE_BASE_WEIGHTS[key]*factor;
  }
  let sum=Object.values(raw).reduce((a,b)=>a+b,0)||1;
  let weights={};
  keys.forEach(key=>weights[key]=raw[key]*100/sum);
  // Derece etkisi tavanı: maksimum %30. Fazla çıkarsa fazlalık diğer sinyallere oransal dağıtılır.
  if(weights.degree>30){
    const excess=weights.degree-30;
    weights.degree=30;
    const otherKeys=keys.filter(k=>k!=='degree');
    const otherSum=otherKeys.reduce((a,k)=>a+weights[k],0)||1;
    otherKeys.forEach(k=>{ weights[k]+=excess*(weights[k]/otherSum); });
  }
  const result={weights,stats,ready,sample,trust,level:stats._source.level,k:safeK};
  _adaptiveWeightsCache.set(cacheKey,result);
  return result;
}

// Kritik kupon yolunda aynı yarış/at/model üç farklı kupon katmanında tekrar
// tekrar puanlanıyordu. Bu puan saf bir fonksiyondur; tek kupon üretimi boyunca
// güvenli biçimde önbelleklenebilir. Cache yalnız kritik akışta tutulur; canlı
// veri mutasyonu ve normal/backtest davranışı etkilenmez.
let _adaptiveCompositeCriticalCache=new WeakMap();
function tkpResetAdaptiveCompositeCriticalCache(){_adaptiveCompositeCriticalCache=new WeakMap();}
if(typeof globalThis!=='undefined')globalThis.tkpResetAdaptiveCompositeCriticalCache=tkpResetAdaptiveCompositeCriticalCache;
// KÖK FIX (Tommy talebi): "0 geçmiş koşu" olan şartlarda (bu at için history
// sinyali yok) TKP'nin kendi geçmiş verisine dayanan condition/history
// sinyalleri zayıflar/düşer, ama Ganyan Canavarı TR PUAN (ganyan_tr) TKP'nin
// kendi arşivinden BAĞIMSIZ dış bir kaynak olduğundan bu boşluktan etkilenmez.
// Normalde ganyan_tr payı ~%5.4 (16/297) gibi çok düşük kalıyor; at için
// history sinyali yoksa bu bağımsız sinyale ekstra güven verilir (payı ~%10'a,
// yaklaşık 1.8x'e çıkarılır) ki modelin "kör" şartlarda tek gerçek dış referansı
// olan TR PUAN'ı göz ardı etmesin. Yalnız ganyan_tr'nin kendi ağırlığını etkiler,
// diğer sinyallerin göreli oranı korunur.
const ADAPTIVE_GANYAN_TR_NO_HISTORY_BOOST = 1.8;
function adaptiveEffectiveWeight(r,h,key,baseWeight){
  if(key!=='ganyan_tr') return baseWeight;
  if(adaptiveSignalPresentForHorse(r,h,'history')) return baseWeight;
  return baseWeight*ADAPTIVE_GANYAN_TR_NO_HISTORY_BOOST;
}
function adaptiveCompositeScore(r,h,learned=null){
  const model=learned||adaptiveWeightsForRace(r);
  const critical=globalThis.__tkpCouponCriticalPath===true;
  if(critical&&r&&typeof r==='object'&&h&&typeof h==='object'&&model&&typeof model==='object'){
    let byHorse=_adaptiveCompositeCriticalCache.get(r);
    if(!byHorse){byHorse=new WeakMap();_adaptiveCompositeCriticalCache.set(r,byHorse);}
    let byModel=byHorse.get(h);
    if(!byModel){byModel=new WeakMap();byHorse.set(h,byModel);}
    if(byModel.has(model))return byModel.get(model);
    let total=0,weight=0;
    for(const key of Object.keys(ADAPTIVE_BASE_WEIGHTS)){
      const w=adaptiveEffectiveWeight(r,h,key,Number(model.weights[key])||0);
      if(w<=0||!adaptiveSignalPresentForHorse(r,h,key))continue;
      total += w*adaptiveSignalValue(r,h,key);weight+=w;
    }
    const value=weight>0?Math.max(0,Math.min(100,total*100/weight)):0;
    byModel.set(model,value);
    return value;
  }
  let total=0,weight=0;
  for(const key of Object.keys(ADAPTIVE_BASE_WEIGHTS)){
    const w=adaptiveEffectiveWeight(r,h,key,Number(model.weights[key])||0);
    if(w<=0||!adaptiveSignalPresentForHorse(r,h,key))continue;
    total += w*adaptiveSignalValue(r,h,key);weight+=w;
  }
  return weight>0?Math.max(0,Math.min(100,total*100/weight)):0;
}

let _adaptiveOrderResultCache=new WeakMap();
// strategicOrderForRace/hit-first çağrıları her seferinde taze `.slice()` dizisi verdiği için
// dizi-kimliğine bağlı önbellek hiç isabet almıyordu. İkinci katman yarış nesnesi + içerik
// imzasına bağlıdır; yalnız sonuçtaki her at mevcut kaynakta aynı nesne olarak varsa kullanılır.
let _adaptiveOrderByRace=new WeakMap();

function adaptiveOrderSignature(r,source){
  const racePart=[
    adaptiveCacheKey(r),
    r&&r.hippodrome,
    r&&r.distance,
    r&&r.race_no,
    typeof db!=='undefined'&&db&&db.learning_state&&db.learning_state.dataset_signature,
    typeof db!=='undefined'&&db&&db.files&&db.files.length,
    typeof db!=='undefined'&&db&&db.races&&db.races.length
  ].join('|');
  const horsePart=source.map(h=>[
    h.horse_no,h.non_runner,h.score,h.tkp_common_evidence,h.agf,h.agf_rank,h.ypuan,h.tr_ganyan,
    h.weight_kg,h.best_time,h.last_result_time,h.start_no,h.bmb,
    h.result_score,h.result_rank,h.priorAccurateAvgSpeed,h.priorAccurateFinishSignal,h.priorAccurateStarts,h.prof,h.condition,
    h.jbyg,h.jbyg_rate,h.g800,h.hndkp,h.hndkp_rank,h.s_value,h.tr,h.tr_rank,
    h.value_score,h.value_rank,h.sp,h.sp_rank
    ,h.son6_raw,typeof tkpTableFeatureSignatureForHorse==='function'?tkpTableFeatureSignatureForHorse(h):''
  ].join(':')).join(';');
  return racePart+'||'+horsePart;
}

function adaptiveOrderForRace(r, horses=null){
  const source=horses||(r&&r.horses)||[];
  const canCache=Array.isArray(source);
  const signature=canCache?adaptiveOrderSignature(r,source):'';
  const cached=canCache?_adaptiveOrderResultCache.get(source):null;
  if(cached&&cached.signature===signature) return cached.ordered.slice();
  const raceKeyObj=canCache&&r&&typeof r==='object'?r:null;
  if(raceKeyObj){
    const perRace=_adaptiveOrderByRace.get(raceKeyObj),hit=perRace&&perRace.get(signature);
    if(hit){
      const present=new Set(source);let liveCount=0;
      for(const h of source)if(!isNonRunner(h))liveCount++;
      if(hit.length===liveCount&&hit.every(h=>present.has(h))){
        _adaptiveOrderResultCache.set(source,{signature,ordered:hit.slice()});
        return hit.slice();
      }
    }
  }

  const remaining=Array.from(source).filter(h=>!isNonRunner(h)).slice();
  const ordered=[];

  function scoreCandidates(rows,position){
    const legacyModel=adaptiveWeightsForRace(r,position);
    const registryModel=typeof tkpPurposeWeightsForRace==='function'
      ? tkpPurposeWeightsForRace(r,'prediction',position)
      : null;
    const composite=new Map();
    for(const horse of rows){
      const legacyScore=adaptiveCompositeScore(r,horse,legacyModel);
      const registryScore=registryModel&&typeof tkpPurposeCompositeScore==='function'
        ? tkpPurposeCompositeScore(r,horse,'prediction',position,registryModel)
        : legacyScore;
      // Ortak veri puanı ana sıralamanın doğrudan parçasıdır: AGF, PROF,
      // Y.PUAN(+yalnız canlı doğrulanmış X), G.PR, DRC ve TR PUAN aynı ayak
      // içinde karşılaştırılır. Eski/registry katmanları korunur fakat tek başına
      // öncelik dayatamaz; ortak veri payı %65'tir.
      const base=legacyScore*0.60+registryScore*0.40;
      const common=Number(horse?.tkp_common_evidence);
      composite.set(horse,Number.isFinite(common) ? base*0.35+(Math.max(0,Math.min(1,common))*100)*0.65 : base);
    }
    return composite;
  }

  for(let position=1; position<=5 && remaining.length; position++){
    const composite=scoreCandidates(remaining,position);
    remaining.sort((a,b)=>
      (composite.get(b)||0)-(composite.get(a)||0) ||
      (Number(b.score)||0)-(Number(a.score)||0) ||
      String(a.horse_no??'').localeCompare(String(b.horse_no??''),'tr',{numeric:true})
    );
    const pick=remaining.shift();
    pick.adaptive_position=position;
    pick.adaptive_position_score=composite.get(pick)||0;
    ordered.push(pick);
  }
  if(remaining.length){
    const composite5=scoreCandidates(remaining,5);
    remaining.sort((a,b)=>
      (composite5.get(b)||0)-(composite5.get(a)||0) ||
      (Number(b.score)||0)-(Number(a.score)||0) ||
      String(a.horse_no??'').localeCompare(String(b.horse_no??''),'tr',{numeric:true})
    );
    ordered.push(...remaining);
  }
  if(canCache) _adaptiveOrderResultCache.set(source,{signature,ordered:ordered.slice()});
  if(raceKeyObj){
    let perRace=_adaptiveOrderByRace.get(raceKeyObj);
    if(!perRace||perRace.size>=4){perRace=new Map();_adaptiveOrderByRace.set(raceKeyObj,perRace);}
    perRace.set(signature,ordered.slice());
  }
  return ordered;
}

if(typeof window!=='undefined'&&window.addEventListener){
  window.addEventListener('tkp:db-changed',()=>{ _adaptiveOrderResultCache=new WeakMap(); _adaptiveOrderByRace=new WeakMap(); });
}

function learnedSideBetWidth(n, targetRace){
  const cacheKey='W'+n+'|'+sideBetCacheKey(targetRace);
  if(_sideBetWidthCache.has(cacheKey)) return _sideBetWidthCache.get(cacheKey);
  const match=targetRace?detailedProfileMatch(targetRace,5):{level:'Tüm veri',label:'Tüm veri',rows:learningEligibleRaces()};
  const rows=match.rows;
  const prepared=[];
  for(const r of rows){
    const seq=validFinishSequences(r,n);
    if(!seq.length) continue;
    const fallback=(typeof historicalSideBetOrder==='function'?historicalSideBetOrder(r):historicalOrder(r));
    const rankings=typeof sideBetPositionRankingsForRace==='function'
      ? sideBetPositionRankingsForRace(r,(r.horses||[]).slice())
      : null;
    const positionNos=Array.from({length:n},(_,index)=>
      (rankings?.['p'+(index+1)]||fallback).map(h=>String(h.horse_no))
    );
    prepared.push({positionNos,seq});
  }
  const sampleTotal=prepared.length;
  // Pozisyonlar ilerledikçe genişlik KÜMÜLATİF olarak büyür (base, base+1, base+2...) —
  // aynı Genel Bakış sıralamasındaki "havuz asla daralmaz, sadece genişler" mantığıyla
  // tutarlı. Önceden tüm pozisyonlara AYNI genişlik veriliyordu; bu da Üçlü'de 1./2./3.
  // sıranın birebir aynı at listesine sahip olmasına, dolayısıyla düşük sıralı/BMB'li
  // atların hiçbir pozisyonda hiç yakalanamamasına yol açıyordu.
  function growWidths(base){
    const widths=Array.from({length:n},(_,i)=>base+i);
    // BMB/ODB'li atlar seq'in başında zaten öncelikli — ama havuz dar kalırsa sadece son
    // sırada yakalanabiliyorlardı. Erken pozisyonları da genişleterek bu atların 1./2. sırada
    // (kazanç payı daha yüksek olan yerlerde) da yakalanma şansını artırıyoruz.
    if(n===3){
      widths[0]=Math.max(widths[0],5);
      widths[1]=Math.max(widths[1],6);
      widths[2]=Math.max(widths[2],8);
    }
    if(n===4){
      widths[0]=Math.max(widths[0],5);
      widths[1]=Math.max(widths[1],7);
      widths[2]=Math.max(widths[2],8);
      widths[3]=Math.max(widths[3],10);
    }
    return widths;
  }
  const defaultWidths=growWidths(5);
  let out;
  if(sampleTotal<SIDE_BET_MIN_RACES){
    out={widths:defaultWidths,rate:null,sample:sampleTotal,w:null,learned:false,level:match.level};
  } else {
    const prior=SIDE_BET_FULL_TRUST_RACES;
    const results=SIDE_BET_WIDTH_CANDIDATES.map(w=>{
      let ok=0;
      for(const {positionNos,seq} of prepared){
        const pools=Array.from({length:n},(_,i)=>(positionNos[i]||[]).slice(0,w+i));
        if(seq.some(s=>s.every((h,i)=>pools[i].includes(String(h.horse_no))))) ok++;
      }
      const rate=sampleTotal?ok/sampleTotal:0;
      const smoothedRate=(ok+SIDE_BET_WIDTH_TARGET_RECALL*prior)/(sampleTotal+prior);
      return {w,ok,total:sampleTotal,rate,smoothedRate};
    });
    const hit=results.find(x=>x.smoothedRate>=SIDE_BET_WIDTH_TARGET_RECALL)||results[results.length-1];
    const widths=growWidths(hit.w);
    out={widths,rate:hit.rate,smoothedRate:hit.smoothedRate,sample:sampleTotal,w:hit.w,learned:true,level:match.level,results};
  }
  _sideBetWidthCache.set(cacheKey,out);
  return out;
}

function sideBetCacheKey(targetRace){
  // Cache anahtarı üretmek için learningEligibleRaces() ile bütün yarış arşivini
  // taramak gereksizdi. Veri veya sonuç değiştiğinde invalidateSideBetCache()
  // epoch'u artırır; koleksiyon uzunlukları da ekleme/silmeyi yakalar.
  const dataKey=`${_sideBetSignatureEpoch}|${(db.races||[]).length}|${(db.files||[]).length}`;
  if(!targetRace) return `ALL|${dataKey}`;
  const logRevision=typeof sideBetPredictionLogRevisionSignature==='function'
    ? sideBetPredictionLogRevisionSignature(db)
    : `${(db.prediction_log||[]).length}|${(db.prediction_log||[]).filter(x=>x.resolved===1).length}`;
  const cutoff=typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'';
  return [cutoff,fold(targetRace.hippodrome),fold(targetRace.condition_family),fold(targetRace.surface),Number(targetRace.distance)||0,fold(targetRace.breed),dataKey,logRevision].join('|');
}

function rankDistributionForRaces(races, rankField){
  const g={'1':0,'2':0,'3':0,'4':0,'5':0,'6':0,'7':0,'alt1':0,'alt2':0,'alt3':0,'alt4':0,'yok':0, total:0};
  for(const r of races){
    const winners=r.horses.filter(tkpAnalysisIsWinner);
    for(const w of winners){
      g.total++;
      const rk=w[rankField];
      if(rk==null) g.yok++;
      else if(rk<=7) g[String(rk)]++;
      else if(rk===8) g.alt1++;
      else if(rk===9) g.alt2++;
      else if(rk===10) g.alt3++;
      else g.alt4++;
    }
  }
  return g;
}

function matchedResultRankStats(r){
  if(!r) return statsByCondition('result_rank')['BİLİNMİYOR'] || {total:0};
  const cond=broadConditionKey(r.condition_family);
  const surface=normalizeSurface(r.surface);
  const breed=normalizeBreed(r.breed);
  const distance=distanceGroup(r.distance);
  const hippo=r.hippodrome;
  const cutoff=typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(r,db):'';
  const cacheKey=[tkpStatsCacheSignature(),cutoff,cond,surface,breed,distance,fold(hippo||'')].join('|');
  if(_matchedResultRankStatsCache.has(cacheKey)) return _matchedResultRankStatsCache.get(cacheKey);
  const eligible=tkpTrainingRowsForStats(r);
  const tests=[
    x=>broadConditionKey(x.condition_family)===cond && normalizeSurface(x.surface)===surface && normalizeBreed(x.breed)===breed && distanceGroup(x.distance)===distance && x.hippodrome===hippo,
    x=>broadConditionKey(x.condition_family)===cond && normalizeSurface(x.surface)===surface && normalizeBreed(x.breed)===breed && distanceGroup(x.distance)===distance,
    x=>broadConditionKey(x.condition_family)===cond && normalizeSurface(x.surface)===surface && normalizeBreed(x.breed)===breed,
    x=>broadConditionKey(x.condition_family)===cond && normalizeSurface(x.surface)===surface,
    x=>broadConditionKey(x.condition_family)===cond
  ];
  for(const test of tests){
    const st=rankDistributionForRaces(eligible.filter(test),'result_rank');
    if(st.total>=SONUC_THRESHOLD_MIN_SAMPLE){ _matchedResultRankStatsCache.set(cacheKey,st); return st; }
  }
  const fallback=statsByConditionForTarget('result_rank',r)[cond] || {total:0};
  _matchedResultRankStatsCache.set(cacheKey,fallback);
  return fallback;
}

function adaptiveSonucThreshold(r){
  const st = matchedResultRankStats(r);
  if (!st || st.total < SONUC_THRESHOLD_MIN_SAMPLE){
    return isHandikapRace(r) ? 8 : 6;
  }
  let cum = 0;
  for (let k=1; k<=10; k++){
    const key = k<=7 ? String(k) : (k===8?'alt1':k===9?'alt2':'alt3');
    cum += (st[key]||0);
    if (cum/st.total >= SONUC_THRESHOLD_TARGET_RECALL) return Math.max(6,k);
  }
  return 10;
}

// V1.1.94 — TR PROFİL TAKİBİ
// Yalnız yarış öncesi alanlar (tr_ganyan, agf_rank, prediction_order_snapshot) ile
// profil oluşturur; winner/finish_position sadece SONUÇ etiketi olarak kullanılır.
let _trGanyanBehaviorCache=new Map();
let _trGanyanBehaviorSummaryCache={signature:'',values:null};
// TR/BH tarihsel kanıt cache'i prediction_log/yan-bahis içeriğine bağlı değildir.
// Genel tkpPerformanceSignature() yan-bahis revizyonu taşıdığı için bu sıcak yolda
// gereksiz invalidasyon/ilk-hash maliyeti doğuruyordu. Arşiv veri imzasını O(1) kullan.
function tkpHistoricalEvidenceBaseSignature(){
  if(typeof tkpFastDbSignature==='function')return tkpFastDbSignature(db);
  return `${db?.learning_state?.dataset_signature||''}:${db?.races?.length||0}:${db?.files?.length||0}`;
}
function _trBehaviorRaceKey(r){
  return [r?.race_date||'',r?.hippodrome||'',r?.file_id||'',r?.leg||''].join('|');
}
// Aynı canlı Altılı/toplantıdaki ayaklar için tkpRowIsBeforeTarget() eğitim
// penceresi aynıdır: aynı meeting_uid'li hiçbir satır geçmişe girmez. Eski
// kesim anahtarı race_uid de taşıdığı için altı ayak TR/BH özetini ayrı ayrı
// baştan tarayabiliyordu. Bu yardımcı yalnız o güvenli canlı durumda ortak
// anahtar üretir. Tarihsel kalibrasyonda aynı toplantının diğer ayakları
// özellikle serbest olduğundan ve backtest her hedefin kendi bağlamını
// kullandığından fail-closed biçimde tam kesim anahtarına geri döner.
function tkpSummaryTrainingWindowKey(targetRace){
  const full=targetRace&&typeof tkpChronologyCutoffKey==='function'
    ?tkpChronologyCutoffKey(targetRace,db)
    :'ALL';
  if(!targetRace||full==='ALL')return full;
  const backtest=(typeof globalThis!=='undefined')?globalThis.__tkpBacktestContext:null;
  if(backtest?.enabled)return full;
  try{
    if(typeof tkpHistoricalCalibrationRace==='function'&&tkpHistoricalCalibrationRace(targetRace,db))return full;
  }catch(_e){return full;}
  if(typeof tkpChronologyInfo!=='function')return full;
  try{
    const info=tkpChronologyInfo(targetRace,db);
    const date=String(info?.date||'').slice(0,10);
    const meetingUid=String(info?.meetingUid||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!meetingUid)return full;
    return [date,Number(info?.seq)||'NO_SEQ',meetingUid,'MEETING_TRAINING'].join('|');
  }catch(_e){return full;}
}
function _trFrozenMainRank(h){
  const rank=Number(h?.prediction_order_snapshot??h?.predicted_rank_snapshot??h?.pre_race_rank);
  return Number.isFinite(rank)&&rank>0?rank:0;
}
function _trBehaviorKeysForHorse(r,h){
  const live=(r?.horses||[]).filter(x=>x&&!isNonRunner(x));
  const trRows=live.filter(x=>Number.isFinite(Number(x?.tr_ganyan))).slice()
    .sort((a,b)=>Number(b.tr_ganyan)-Number(a.tr_ganyan)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
  const trRankByNo=new Map(trRows.map((x,index)=>[String(x.horse_no),index+1]));
  const tailMax=Math.max(-Infinity,...live.filter(x=>_trFrozenMainRank(x)>=Math.max(1,live.length-2)).map(x=>Number(x?.tr_ganyan)).filter(Number.isFinite));
  return _trBehaviorKeysForHorsePrepared(live,h,trRankByNo,tailMax);
}
function _trBehaviorKeysForHorsePrepared(live,h,trRankByNo,tailMax){
  const trRank=trRankByNo.get(String(h?.horse_no))||0;
  if(trRank<=0) return [];
  const trScore=Number(h?.tr_ganyan), agfRank=Number(h?.agf_rank)||0, mainRank=_trFrozenMainRank(h), n=Math.max(1,live.length);
  const keys=[];
  if(trRank===1&&agfRank>=4&&agfRank<=6) keys.push('TR1_AGF4_6');
  if(trRank===1&&agfRank>=7) keys.push('TR1_AGF7P');
  if(mainRank>0&&mainRank>=Math.max(1,n-2)&&trScore>=67) keys.push('TAIL3_TR67P');
  if(mainRank>Math.ceil(n*2/3)&&trRank<=Math.min(3,n)) keys.push('TAIL_TR_TOP3');
  if(mainRank>0&&mainRank>=Math.max(1,n-2)&&trScore>=50){
    if(Number.isFinite(tailMax)&&trScore===tailMax) keys.push('TAIL3_TR_LOCAL_TOP');
  }
  return Array.from(new Set(keys));
}
function trGanyanBehaviorSummaryReady(targetRace){
  const baseSignature=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const signature=[baseSignature,cutoff].join('|');
  return _trGanyanBehaviorSummaryCache.signature===signature&&Array.isArray(_trGanyanBehaviorSummaryCache.values);
}
function trGanyanBehaviorSummary(targetRace){
  const baseSignature=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const signature=[baseSignature,cutoff].join('|');
  if(_trGanyanBehaviorSummaryCache.signature===signature&&_trGanyanBehaviorSummaryCache.values)return _trGanyanBehaviorSummaryCache.values;
  const keys=['TR1_AGF4_6','TR1_AGF7P','TAIL3_TR67P','TAIL_TR_TOP3','TAIL3_TR_LOCAL_TOP'];
  const totals=new Map(keys.map(key=>[key,{key,starts:0,wins:0,top3:0,top5:0}]));
  const currentKey=_trBehaviorRaceKey(targetRace);
  const training=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget((typeof learningEligibleRaces==='function'?learningEligibleRaces():[]),targetRace,db)
    :(typeof learningEligibleRaces==='function'?learningEligibleRaces():[]);
  for(const r of training){
    if(!r||_trBehaviorRaceKey(r)===currentKey) continue;
    const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>h&&!isNonRunner(h));
    const trRows=live.filter(h=>Number.isFinite(Number(h?.tr_ganyan))).slice().sort((a,b)=>Number(b.tr_ganyan)-Number(a.tr_ganyan)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
    const trRankByNo=new Map(trRows.map((h,index)=>[String(h.horse_no),index+1]));
    const tailMax=Math.max(-Infinity,...live.filter(h=>_trFrozenMainRank(h)>=Math.max(1,live.length-2)).map(h=>Number(h?.tr_ganyan)).filter(Number.isFinite));
    for(const h of live){
      // Sonucu olmayan yarış paydaya girmez.
      const pos=Number(h.finish_position||h.result_position||(Number(h.winner)===1?1:0));
      if(!(Number.isFinite(pos)&&pos>0)) continue;
      for(const key of _trBehaviorKeysForHorsePrepared(live,h,trRankByNo,tailMax)){
        const row=totals.get(key);if(!row)continue;
        row.starts++;if(pos===1||Number(h.winner)===1)row.wins++;if(pos<=3)row.top3++;if(pos<=5)row.top5++;
      }
    }
  }
  const values=keys.map(key=>{const row=totals.get(key);return {...row,winRate:row.starts?row.wins/row.starts:0,top3Rate:row.starts?row.top3/row.starts:0,top5Rate:row.starts?row.top5/row.starts:0};});
  _trGanyanBehaviorSummaryCache={signature,values};
  for(const row of values)_trGanyanBehaviorCache.set(signature+'|'+row.key,row);
  return values;
}
let _trGanyanBehaviorAsyncInFlight=null;
async function trGanyanBehaviorSummaryAsync(targetRace){
  const baseSignature=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const signature=[baseSignature,cutoff].join('|');
  if(_trGanyanBehaviorSummaryCache.signature===signature&&_trGanyanBehaviorSummaryCache.values)return _trGanyanBehaviorSummaryCache.values;
  if(_trGanyanBehaviorAsyncInFlight?.signature===signature)return _trGanyanBehaviorAsyncInFlight.promise;
  const promise=(async()=>{
    const keys=['TR1_AGF4_6','TR1_AGF7P','TAIL3_TR67P','TAIL_TR_TOP3','TAIL3_TR_LOCAL_TOP'];
    const totals=new Map(keys.map(key=>[key,{key,starts:0,wins:0,top3:0,top5:0}]));
    const currentKey=_trBehaviorRaceKey(targetRace),all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
    const races=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
      ?tkpTrainingRowsBeforeTarget(all,targetRace,db)
      :all;
    for(let index=0;index<races.length;index++){
      if(index>0&&index%12===0){if(typeof tkpYield==='function')await tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));}
      const r=races[index];if(!r||_trBehaviorRaceKey(r)===currentKey)continue;
      const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>h&&!isNonRunner(h));
      const trRows=live.filter(h=>Number.isFinite(Number(h?.tr_ganyan))).slice().sort((a,b)=>Number(b.tr_ganyan)-Number(a.tr_ganyan)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
      const trRankByNo=new Map(trRows.map((h,rowIndex)=>[String(h.horse_no),rowIndex+1]));
      const tailMax=Math.max(-Infinity,...live.filter(h=>_trFrozenMainRank(h)>=Math.max(1,live.length-2)).map(h=>Number(h?.tr_ganyan)).filter(Number.isFinite));
      for(const h of live){
        const pos=Number(h.finish_position||h.result_position||(Number(h.winner)===1?1:0));if(!(Number.isFinite(pos)&&pos>0))continue;
        for(const key of _trBehaviorKeysForHorsePrepared(live,h,trRankByNo,tailMax)){const row=totals.get(key);if(!row)continue;row.starts++;if(pos===1||Number(h.winner)===1)row.wins++;if(pos<=3)row.top3++;if(pos<=5)row.top5++;}
      }
    }
    const values=keys.map(key=>{const row=totals.get(key);return {...row,winRate:row.starts?row.wins/row.starts:0,top3Rate:row.starts?row.top3/row.starts:0,top5Rate:row.starts?row.top5/row.starts:0};});
    _trGanyanBehaviorSummaryCache={signature,values};for(const row of values)_trGanyanBehaviorCache.set(signature+'|'+row.key,row);return values;
  })().finally(()=>{if(_trGanyanBehaviorAsyncInFlight?.signature===signature)_trGanyanBehaviorAsyncInFlight=null;});
  _trGanyanBehaviorAsyncInFlight={signature,promise};return promise;
}
function trGanyanBehaviorStatsForKey(targetRace,key){
  const baseSignature=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const signature=[baseSignature,cutoff].join('|');
  const cacheKey=signature+'|'+key;if(_trGanyanBehaviorCache.has(cacheKey))return _trGanyanBehaviorCache.get(cacheKey);
  return trGanyanBehaviorSummary(targetRace).find(row=>row.key===key)||{key,starts:0,wins:0,top3:0,top5:0,winRate:0,top3Rate:0,top5Rate:0};
}

// V1.1.97 — KAZANAN PROFİL ANALİZİ · AGF/BMB/ODB/TR
// Yalnız yarış öncesi sinyallerle profil üretir; sonuç sadece başarı etiketi/payda için kullanılır.
let _tkpWinnerComboCache=new Map();
function tkpWinnerComboKeysForHorse(r,h){
  if(!r||!h||isNonRunner(h)) return [];
  const agf=Number(h.agf_rank)||0, tr=Number(h.tr_ganyan);
  const bmb=Number(h.bmb)===1;
  let odb=false; try{ odb=typeof isOdbCandidate==='function'&&isOdbCandidate(h,r); }catch(_){}
  const main=Number(h.prediction_order_snapshot||h._strategy_rank||0);
  const n=(r.horses||[]).filter(x=>x&&!isNonRunner(x)).length;
  const keys=[];
  if(Number.isFinite(tr)&&tr>=60&&tr<=70) keys.push('TR60_70');
  if(Number.isFinite(tr)&&tr>=30&&tr<60) keys.push('TR30_60');
  if(Number.isFinite(tr)&&tr>=20&&tr<30) keys.push('TR20_30');
  if(bmb) keys.push('BMB');
  if(odb) keys.push('ODB');
  if(bmb&&agf>=8&&Number.isFinite(tr)&&tr>=30&&tr<60) keys.push('BMB_AGF8P_TR30_60');
  if(bmb&&Number.isFinite(tr)&&tr>=30&&tr<60) keys.push('BMB_TR30_60');
  if(odb&&agf>=7&&Number.isFinite(tr)&&tr>=20) keys.push('ODB_AGF7P_TR20P');
  if(Number.isFinite(tr)&&tr>=60&&tr<=70&&agf>=4) keys.push('TR60_70_AGF4P');
  if(Number.isFinite(tr)&&tr>=30&&tr<60&&agf>=6) keys.push('TR30_60_AGF6P');
  if(main>0&&n>=4&&main>=n-3&&Number.isFinite(tr)&&tr>=20&&tr<30){
    const bottom=(r.horses||[]).filter(x=>x&&!isNonRunner(x)&&Number(x.prediction_order_snapshot||x._strategy_rank||0)>=n-3);
    const maxTr=Math.max(-Infinity,...bottom.map(x=>Number(x.tr_ganyan)).filter(Number.isFinite));
    if(tr===maxTr) keys.push('BOTTOM4_TR20_30_LOCALHIGH');
  }
  if(main>0&&n>=4&&main>=n-3&&bmb&&Number.isFinite(tr)&&tr>=20&&tr<60) keys.push('BMB_BOTTOM4_TR20_60');
  return Array.from(new Set(keys));
}
function tkpWinnerComboStats(targetRace,key){
  const baseSig=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const sig=[baseSig,cutoff].join('|');
  const ck=`${key}|${sig}`; if(_tkpWinnerComboCache.has(ck)) return _tkpWinnerComboCache.get(ck);
  let starts=0,wins=0,top3=0,top5=0;
  const target=_trBehaviorRaceKey(targetRace);
  const all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
  const training=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget(all,targetRace,db)
    :all;
  for(const r of training){
    if(!r||_trBehaviorRaceKey(r)===target) continue;
    const resultKnown=(r.horses||[]).some(h=>Number(h.finish_position)>0||Number(h.result_position)>0||Number(h.winner)===1);
    if(!resultKnown) continue;
    for(const h of (r.horses||[])){
      if(!h||isNonRunner(h)||!tkpWinnerComboKeysForHorse(r,h).includes(key)) continue;
      const pos=Number(h.finish_position||h.result_position||(Number(h.winner)===1?1:0));
      if(!(pos>0)) continue;
      starts++; if(pos===1||Number(h.winner)===1)wins++; if(pos<=3)top3++; if(pos<=5)top5++;
    }
  }
  const out={key,starts,wins,top3,top5,winRate:starts?wins/starts:0,top3Rate:starts?top3/starts:0,top5Rate:starts?top5/starts:0};
  _tkpWinnerComboCache.set(ck,out); return out;
}
function tkpWinnerComboStatsForHorse(r,h){
  if(globalThis.__tkpCouponCriticalPath===true)return {keys:[],rows:[],best:null};
  // İlk BH adayı birden çok anahtara uyabilir. Anahtarları tek tek çağırmak ilk
  // adayda arşivi 4-8 kez tarıyordu; toplu özet aynı sayaçları tek geçişte mevcut
  // cache biçimine yazar. Sonraki map yalnız O(1) cache okur.
  tkpWinnerComboSummary(r);
  const rows=tkpWinnerComboKeysForHorse(r,h).map(k=>tkpWinnerComboStats(r,k)).filter(x=>x.starts>0)
    .sort((a,b)=>(b.starts>=5?b.winRate:-1)-(a.starts>=5?a.winRate:-1)||b.starts-a.starts);
  return {keys:rows.map(x=>x.key),rows,best:rows[0]||null};
}
const TKP_WINNER_COMBO_KEYS=['TR60_70','TR30_60','TR20_30','BMB','ODB','BMB_TR30_60','BMB_AGF8P_TR30_60','ODB_AGF7P_TR20P','TR60_70_AGF4P','TR30_60_AGF6P','BOTTOM4_TR20_30_LOCALHIGH','BMB_BOTTOM4_TR20_60'];
function tkpWinnerComboSummaryReady(targetRace){
  const baseSig=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const sig=[baseSig,cutoff].join('|');
  return TKP_WINNER_COMBO_KEYS.every(key=>_tkpWinnerComboCache.has(`${key}|${sig}`));
}
function tkpWinnerComboSummary(targetRace){
  // V1.1.225 HIZ MİMARİSİ KÖK FIX: eskiden bu fonksiyon 12 anahtarın HER BİRİ için
  // ayrı ayrı tkpWinnerComboStats() çağırıyordu; her biri önbellek ISKALARSA
  // tüm learningEligibleRaces() (2990 koşu) + her atı tkpWinnerComboKeysForHorse()
  // ile TEKRAR tarıyordu -- yani aynı arşiv 12 KEZ baştan taranıyordu (gerçek
  // arşivde ölçüldü: ~34,8 sn). tkpWinnerComboKeysForHorse(r,h) zaten bir atın
  // uyduğu TÜM anahtarları TEK ÇAĞRIDA döndürüyor; bu yüzden artık arşiv TEK
  // GEÇİŞTE taranıp 12 anahtarın sayaçları birlikte biriktiriliyor, sonra
  // MEVCUT tekil-anahtar önbelleğine (_tkpWinnerComboCache) aynı formatla
  // yazılıyor -- tkpWinnerComboStatsForHorse() gibi tek-anahtar çağıran diğer
  // kod yolları hâlâ aynı önbellekten (artık ucuza) yararlanır. Sonuç (starts/
  // wins/top3/top5/oranlar) eski koddan birebir aynıdır.
  const baseSig=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const sig=[baseSig,cutoff].join('|');
  const allCached=TKP_WINNER_COMBO_KEYS.every(k=>_tkpWinnerComboCache.has(`${k}|${sig}`));
  if(!allCached){
    const target=_trBehaviorRaceKey(targetRace);
    const acc={}; for(const k of TKP_WINNER_COMBO_KEYS) acc[k]={starts:0,wins:0,top3:0,top5:0};
    const all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
    const training=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
      ?tkpTrainingRowsBeforeTarget(all,targetRace,db)
      :all;
    for(const r of training){
      if(!r||_trBehaviorRaceKey(r)===target) continue;
      const resultKnown=(r.horses||[]).some(h=>Number(h.finish_position)>0||Number(h.result_position)>0||Number(h.winner)===1);
      if(!resultKnown) continue;
      for(const h of (r.horses||[])){
        if(!h||isNonRunner(h)) continue;
        const pos=Number(h.finish_position||h.result_position||(Number(h.winner)===1?1:0));
        if(!(pos>0)) continue;
        const keys=tkpWinnerComboKeysForHorse(r,h);
        for(const key of keys){
          const a=acc[key]; if(!a) continue;
          a.starts++; if(pos===1||Number(h.winner)===1)a.wins++; if(pos<=3)a.top3++; if(pos<=5)a.top5++;
        }
      }
    }
    for(const key of TKP_WINNER_COMBO_KEYS){
      const a=acc[key];
      const out={key,starts:a.starts,wins:a.wins,top3:a.top3,top5:a.top5,winRate:a.starts?a.wins/a.starts:0,top3Rate:a.starts?a.top3/a.starts:0,top5Rate:a.starts?a.top5/a.starts:0};
      _tkpWinnerComboCache.set(`${key}|${sig}`,out);
    }
  }
  return TKP_WINNER_COMBO_KEYS.map(k=>_tkpWinnerComboCache.get(`${k}|${sig}`));
}
let _tkpWinnerComboAsyncInFlight=null;
async function tkpWinnerComboSummaryAsync(targetRace){
  const baseSig=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const sig=[baseSig,cutoff].join('|');
  if(TKP_WINNER_COMBO_KEYS.every(k=>_tkpWinnerComboCache.has(`${k}|${sig}`)))return TKP_WINNER_COMBO_KEYS.map(k=>_tkpWinnerComboCache.get(`${k}|${sig}`));
  if(_tkpWinnerComboAsyncInFlight?.signature===sig)return _tkpWinnerComboAsyncInFlight.promise;
  const promise=(async()=>{
    const target=_trBehaviorRaceKey(targetRace),acc={};for(const k of TKP_WINNER_COMBO_KEYS)acc[k]={starts:0,wins:0,top3:0,top5:0};
    const all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
    const races=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
      ?tkpTrainingRowsBeforeTarget(all,targetRace,db)
      :all;
    for(let index=0;index<races.length;index++){
      if(index>0&&index%8===0){if(typeof tkpYield==='function')await tkpYield();else await new Promise(resolve=>setTimeout(resolve,0));}
      const r=races[index];if(!r||_trBehaviorRaceKey(r)===target)continue;
      const resultKnown=(r.horses||[]).some(h=>Number(h.finish_position)>0||Number(h.result_position)>0||Number(h.winner)===1);if(!resultKnown)continue;
      for(const h of (r.horses||[])){if(!h||isNonRunner(h))continue;const pos=Number(h.finish_position||h.result_position||(Number(h.winner)===1?1:0));if(!(pos>0))continue;for(const key of tkpWinnerComboKeysForHorse(r,h)){const a=acc[key];if(!a)continue;a.starts++;if(pos===1||Number(h.winner)===1)a.wins++;if(pos<=3)a.top3++;if(pos<=5)a.top5++;}}
    }
    for(const key of TKP_WINNER_COMBO_KEYS){const a=acc[key];_tkpWinnerComboCache.set(`${key}|${sig}`,{key,starts:a.starts,wins:a.wins,top3:a.top3,top5:a.top5,winRate:a.starts?a.wins/a.starts:0,top3Rate:a.starts?a.top3/a.starts:0,top5Rate:a.starts?a.top5/a.starts:0});}
    return TKP_WINNER_COMBO_KEYS.map(k=>_tkpWinnerComboCache.get(`${k}|${sig}`));
  })().finally(()=>{if(_tkpWinnerComboAsyncInFlight?.signature===sig)_tkpWinnerComboAsyncInFlight=null;});
  _tkpWinnerComboAsyncInFlight={signature:sig,promise};return promise;
}

// Kuponun ilk üretiminde TR davranış özeti ile BH/kazanan kombinasyon özeti
// aynı eğitim penceresini iki kez, hem de seri biçimde dolaşıyordu. 509 yarışlık
// soğuk açılışta bu iki bağımsız geçiş kuponun görünmesini gereksiz geciktirir.
// Aşağıdaki ortak geçiş, iki mevcut önbelleği BİREBİR aynı sayaç biçiminde
// doldurur; tüketiciler ve puan matematiği değişmez. Tarihsel/backtest kesimi
// tkpSummaryTrainingWindowKey üzerinden mevcut fail-closed davranışını korur.
let _tkpCouponHistoricalEvidenceAsyncInFlight=null;
async function tkpCouponHistoricalEvidenceSummaryAsync(targetRace){
  const baseSignature=tkpHistoricalEvidenceBaseSignature();
  const cutoff=tkpSummaryTrainingWindowKey(targetRace);
  const signature=[baseSignature,cutoff].join('|');
  const trReady=_trGanyanBehaviorSummaryCache.signature===signature
    &&Array.isArray(_trGanyanBehaviorSummaryCache.values);
  const winnerReady=TKP_WINNER_COMBO_KEYS.every(key=>_tkpWinnerComboCache.has(`${key}|${signature}`));
  if(trReady&&winnerReady){
    return {
      tr:_trGanyanBehaviorSummaryCache.values,
      winner:TKP_WINNER_COMBO_KEYS.map(key=>_tkpWinnerComboCache.get(`${key}|${signature}`))
    };
  }
  if(_tkpCouponHistoricalEvidenceAsyncInFlight?.signature===signature){
    return _tkpCouponHistoricalEvidenceAsyncInFlight.promise;
  }
  const promise=(async()=>{
    // Başka bir yoldan aynı özet zaten çalışıyorsa ikinci CPU taraması açma.
    if(_trGanyanBehaviorAsyncInFlight?.signature===signature||_tkpWinnerComboAsyncInFlight?.signature===signature){
      await Promise.all([
        _trGanyanBehaviorAsyncInFlight?.signature===signature
          ?_trGanyanBehaviorAsyncInFlight.promise:trGanyanBehaviorSummaryAsync(targetRace),
        _tkpWinnerComboAsyncInFlight?.signature===signature
          ?_tkpWinnerComboAsyncInFlight.promise:tkpWinnerComboSummaryAsync(targetRace)
      ]);
      return {
        tr:_trGanyanBehaviorSummaryCache.values||[],
        winner:TKP_WINNER_COMBO_KEYS.map(key=>_tkpWinnerComboCache.get(`${key}|${signature}`))
      };
    }
    const trKeys=['TR1_AGF4_6','TR1_AGF7P','TAIL3_TR67P','TAIL_TR_TOP3','TAIL3_TR_LOCAL_TOP'];
    const trTotals=new Map(trKeys.map(key=>[key,{key,starts:0,wins:0,top3:0,top5:0}]));
    const winnerTotals={};
    for(const key of TKP_WINNER_COMBO_KEYS)winnerTotals[key]={starts:0,wins:0,top3:0,top5:0};
    const target=_trBehaviorRaceKey(targetRace);
    const all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
    const races=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
      ?tkpTrainingRowsBeforeTarget(all,targetRace,db):all;
    for(let index=0;index<races.length;index++){
      // Her küçük bloktan sonra tarayıcıya dön: kupon kartı/tuşu canlı kalır.
      if(index>0&&index%4===0){
        if(typeof tkpYield==='function')await tkpYield();
        else await new Promise(resolve=>setTimeout(resolve,0));
      }
      const race=races[index];
      if(!race||_trBehaviorRaceKey(race)===target)continue;
      const allHorses=Array.isArray(race.horses)?race.horses:[];
      const live=allHorses.filter(h=>h&&!isNonRunner(h));
      const trRows=live.filter(h=>Number.isFinite(Number(h?.tr_ganyan))).slice()
        .sort((a,b)=>Number(b.tr_ganyan)-Number(a.tr_ganyan)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
      const trRankByNo=new Map(trRows.map((horse,rowIndex)=>[String(horse.horse_no),rowIndex+1]));
      const tailMax=Math.max(-Infinity,...live
        .filter(h=>_trFrozenMainRank(h)>=Math.max(1,live.length-2))
        .map(h=>Number(h?.tr_ganyan)).filter(Number.isFinite));
      const resultKnown=allHorses.some(h=>Number(h?.finish_position)>0||Number(h?.result_position)>0||Number(h?.winner)===1);
      for(const horse of live){
        const pos=Number(horse.finish_position||horse.result_position||(Number(horse.winner)===1?1:0));
        if(!(Number.isFinite(pos)&&pos>0))continue;
        for(const key of _trBehaviorKeysForHorsePrepared(live,horse,trRankByNo,tailMax)){
          const row=trTotals.get(key);if(!row)continue;
          row.starts++;
          if(pos===1||Number(horse.winner)===1)row.wins++;
          if(pos<=3)row.top3++;
          if(pos<=5)row.top5++;
        }
        if(!resultKnown)continue;
        for(const key of tkpWinnerComboKeysForHorse(race,horse)){
          const row=winnerTotals[key];if(!row)continue;
          row.starts++;
          if(pos===1||Number(horse.winner)===1)row.wins++;
          if(pos<=3)row.top3++;
          if(pos<=5)row.top5++;
        }
      }
    }
    const trValues=trKeys.map(key=>{
      const row=trTotals.get(key);
      return {...row,winRate:row.starts?row.wins/row.starts:0,top3Rate:row.starts?row.top3/row.starts:0,top5Rate:row.starts?row.top5/row.starts:0};
    });
    _trGanyanBehaviorSummaryCache={signature,values:trValues};
    for(const row of trValues)_trGanyanBehaviorCache.set(`${signature}|${row.key}`,row);
    for(const key of TKP_WINNER_COMBO_KEYS){
      const row=winnerTotals[key];
      _tkpWinnerComboCache.set(`${key}|${signature}`,{
        key,starts:row.starts,wins:row.wins,top3:row.top3,top5:row.top5,
        winRate:row.starts?row.wins/row.starts:0,
        top3Rate:row.starts?row.top3/row.starts:0,
        top5Rate:row.starts?row.top5/row.starts:0
      });
    }
    return {tr:trValues,winner:TKP_WINNER_COMBO_KEYS.map(key=>_tkpWinnerComboCache.get(`${key}|${signature}`))};
  })().finally(()=>{
    if(_tkpCouponHistoricalEvidenceAsyncInFlight?.signature===signature){
      _tkpCouponHistoricalEvidenceAsyncInFlight=null;
    }
  });
  _tkpCouponHistoricalEvidenceAsyncInFlight={signature,promise};
  return promise;
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpCouponHistoricalEvidenceSummaryAsync=tkpCouponHistoricalEvidenceSummaryAsync;
  globalThis.tkpWinnerComboSummaryReady=tkpWinnerComboSummaryReady;
}

// Shared read-only PROF order for archive tracking and horse-name labels.
function tkpProfBottomPositions(r){
  const rows=(r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
  const values=[];
  for(const h of rows){
    let raw;try{raw=profileStrengthPct(r,h);}catch(_){return new Map();}
    if(raw==null||raw===''||!Number.isFinite(Number(raw)))return new Map();
    values.push({h,prof:Number(raw)});
  }
  const out=new Map();
  for(const v of values)out.set(String(v.h.horse_no),{prof:v.prof,rank:1+values.filter(x=>x.prof<v.prof).length,total:values.length});
  return out;
}
// END PROF BOTTOM POSITIONS

const _tkpTableBottomPastWinnerCache=new Map();
// ALT tracks positions in similar historical races, never this horse's own wins.
function tkpTableBottomConditionStats(r){
  const day=String(r?.race_date||'').slice(0,10);
  const sig=typeof tkpStatsCacheSignature==='function'?tkpStatsCacheSignature():'';
  const key=['SURPRISE_RATE_V8_LEG',typeof db!=='undefined'?(db.bomb_hunter_shadow_log||[]).length:0,r?.id,day,r?.hippodrome,r?.condition_family,r?.breed,r?.surface,r?.distance_m,sig].join('|');
  if(_tkpTableBottomPastWinnerCache.has(key))return _tkpTableBottomPastWinnerCache.get(key);
  const out={signals:{BMB:{starts:0,wins:0,seconds:0,top5:0},ODB:{starts:0,wins:0,seconds:0,top5:0},BH1:{starts:0,wins:0,seconds:0,top5:0},BH2:{starts:0,wins:0,seconds:0,top5:0},BH3:{starts:0,wins:0,seconds:0,top5:0},BH4:{starts:0,wins:0,seconds:0,top5:0}},ranks:[1,2,3,4].map(rank=>({rank,starts:0,wins:0,seconds:0,top5:0,bmbStarts:0,bmbWins:0})),level:'Veri yok',label:'',excluded:0,winners:[]};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||typeof detailedProfileMatch!=='function'||typeof tkpHistoricalFrozenOrderForRace!=='function')return out;
  const profile=detailedProfileMatch(r,5);out.level=profile.level||'Benzer koşullar';out.label=profile.label||'';
  out.surpriseRaces={starts:0,wins:0,excluded:0};
  const seen=new Set();
  const bhLogs=typeof db!=='undefined'?(db.bomb_hunter_shadow_log||[]):[];
  const bhByRace=new Map(bhLogs.map(rec=>[rec.race_key,rec]));
  for(const past of profile.rows||[]){
    const pastDay=String(past?.race_date||'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(pastDay)||pastDay>=day)continue;
    const status=String(past?.result_integrity_status||'').toUpperCase(),source=String(past?.result_integrity_source||'').toUpperCase();
    const verified=(status==='VERIFIED'&&source==='TJK_OFFICIAL_ORDERED_PAYOUT')||(Number(past?.result_verified_depth)>=1&&(status==='VERIFIED'||status==='VERIFIED_TJK_PAYOUT'||source==='TJK_OFFICIAL_ORDERED_PAYOUT'));
    const live=(past.horses||[]).filter(h=>h&&!isNonRunner(h));
    const order=tkpHistoricalFrozenOrderForRace(past);
    const nums=new Set(order.map(h=>String(h.horse_no)));
    const finish=h=>typeof tkpAnalysisFinishPosition==='function'?tkpAnalysisFinishPosition(h):(Number(h?.winner)===1?1:Number(h?.finish_position)||null);
    if(!verified||!live.some(h=>finish(h)===1)){out.excluded++;continue;}
    const identity=String(past.id??[pastDay,past.hippodrome,past.race_no,past.altili_no,past.file_id].join('|'));
    const dedupe=past.id!=null||past.race_no!=null?identity:past;
    if(seen.has(dedupe))continue;seen.add(dedupe);
    const winners=live.filter(h=>finish(h)===1);
    if(winners.every(h=>Number(h.agf_rank)>=1)){
      out.surpriseRaces.starts++;
      if(winners.some(h=>Number(h.agf_rank)>=6))out.surpriseRaces.wins++;
    }else out.surpriseRaces.excluded++;
    const recordWinner=(h,tag)=>{
      let row=out.winners.find(row=>row.raceIdentity===identity&&row.horse_no===String(h.horse_no));
      if(!row){row={raceIdentity:identity,date:pastDay,hippodrome:past.hippodrome||'',condition:past.condition_family||'',horse_no:String(h.horse_no),horse_name:h.horse_name||'',signals:[]};out.winners.push(row);}
      if(!row.signals.includes(tag))row.signals.push(tag);
    };
    for(const h of live){
      const tags=[];if(Number(h.bmb)===1&&h.bmb_source!=='ŞABLON KURALI')tags.push('BMB');
      if(Number(h.odb)===1||h.bmb_source==='ŞABLON KURALI')tags.push('ODB');
      for(const tag of tags){out.signals[tag].starts++;if(finish(h)===1){out.signals[tag].wins++;recordWinner(h,tag);}else if(finish(h)===2)out.signals[tag].seconds++;if(finish(h)>=1&&finish(h)<=5)out.signals[tag].top5++;}
    }
    // Category evidence comes from the original pre-race BH snapshot only.
    const raceKey=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(past):'';
    const original=raceKey?bhByRace.get(raceKey):null;
    const frozen=original&&String(original.created_at||'').slice(0,10).length===10&&String(original.created_at).slice(0,10)<=pastDay?original:null;
    const counted=new Set();
    for(const c of frozen?.candidates||[]){
      if(typeof tkpBombHunterWasPortfolioBackfill==='function'&&tkpBombHunterWasPortfolioBackfill(c))continue;
      if(String(c.kind||'').toUpperCase()==='ODB')continue;
      const tag='BH'+Number(c.category_rank||c.rank);
      const h=live.find(h=>String(h.horse_no)===String(c.horse_no));
      if(!out.signals[tag]||!h||counted.has(tag))continue;
      counted.add(tag);out.signals[tag].starts++;if(finish(h)===1)out.signals[tag].wins++;else if(finish(h)===2)out.signals[tag].seconds++;
      if(finish(h)>=1&&finish(h)<=5)out.signals[tag].top5++;
    }
    if(order.length!==live.length||nums.size!==live.length||!live.every(h=>nums.has(String(h.horse_no)))){out.excluded++;continue;}
    for(const row of out.ranks){
      const h=order[order.length-row.rank];if(!h)continue;
      row.starts++;const won=finish(h)===1;if(won){row.wins++;recordWinner(h,'ALT '+row.rank);}else if(finish(h)===2)row.seconds++;
      if(finish(h)>=1&&finish(h)<=5)row.top5++;
      if(Number(h.bmb)===1&&h.bmb_source!=='ŞABLON KURALI'){row.bmbStarts++;if(won)row.bmbWins++;}
    }
  }
  if(_tkpTableBottomPastWinnerCache.size>=32)_tkpTableBottomPastWinnerCache.clear();
  _tkpTableBottomPastWinnerCache.set(key,out);return out;
}
function tkpLegSurpriseEvidence(r){
  const proof=tkpTableBottomConditionStats(r).surpriseRaces||{starts:0,wins:0,excluded:0};
  const n=proof.starts,w=proof.wins,rate=n?w/n:null,z=1.96;
  const lower=n?(rate+z*z/(2*n)-z*Math.sqrt(rate*(1-rate)/n+z*z/(4*n*n)))/(1+z*z/n):0;
  return {...proof,rate,lower,high:n>=20&&rate>=.30&&lower>=.15};
}
function tkpLegSurpriseBadgeHTML(r){
  const p=tkpLegSurpriseEvidence(r),escape=value=>typeof esc==='function'?esc(String(value)):String(value);
  const label=p.rate==null?'<span class="tkpSurpriseNoData">Sürpriz · veri yok</span>':
    '<span class="tkpSurpriseRate">Geçmiş sürpriz %'+escape((100*p.rate).toFixed(1).replace('.',','))+'</span> · '+
    '<span class="tkpSurpriseSample">'+escape(p.wins)+'/'+escape(p.starts)+'</span>'+
    (p.starts<20?' · <span class="tkpSurpriseLowSample">az örnek</span>':p.high?' · <span class="tkpSurprisePriority">ÖNCELİKLİ</span>':'');
  return '<span class="tkpLegSurpriseBadge'+(p.high?' tkpLegSurpriseHigh':'')+'" title="Benzer koşullarda AGF 6 ve sonrası kazanan yarışların oranı; bugünkü kesin olasılık değildir.">'+label+'</span>';
}
function tkpTableBottomFourPositions(r,ordered){
  const live=(ordered||[]).filter(h=>h&&!isNonRunner(h)),history=tkpTableBottomConditionStats(r),out=new Map();
  for(let i=Math.max(0,live.length-4);i<live.length;i++){
    const rank=live.length-i,proof=history.ranks.find(x=>x.rank===rank);
    if(proof?.wins>0)out.set(String(live[i].horse_no),{...proof,total:live.length,level:history.level,label:history.label});
  }
  return out;
}
function tkpTableBottomWinnerCandidates(r,ordered){
  if((r?.horses||[]).some(h=>Number(h?.finish_position)>0||Number(h?.winner)===1))return [];
  const positions=tkpTableBottomFourPositions(r,ordered);
  return (ordered||[]).filter(h=>positions.has(String(h.horse_no)));
}
function tkpConditionRescueRows(r,ordered){
  const history=tkpTableBottomConditionStats(r),bottom=tkpTableBottomFourPositions(r,ordered),out=[];
  const bh=typeof tkpBombHunterSupportContext==='function'?tkpBombHunterSupportContext(r):null;
  for(const horse of (ordered||[]).filter(h=>h&&!isNonRunner(h))){
    const signals=[],position=bottom.get(String(horse.horse_no));
    if(position)signals.push({...position,label:'ALT '+position.rank});
    if(Number(horse.bmb)===1&&horse.bmb_source!=='ŞABLON KURALI'&&history.signals.BMB.wins>0)signals.push({label:'BMB',...history.signals.BMB});
    const odb=Number(horse.odb)===1||horse.bmb_source==='ŞABLON KURALI'||(typeof isOdbCandidate==='function'&&isOdbCandidate(horse,r));
    if(odb&&history.signals.ODB.wins>0)signals.push({label:'ODB',...history.signals.ODB});
    const bhTags=(bh?.byHorse?.get(String(horse.horse_no))||[]).map(b=>String(b.text||'')).filter(t=>/^BH[1-4]$/.test(t));
    const warnings=[...new Set([...bhTags,...signals.map(s=>s.label),...(Number(horse.bmb)===1&&horse.bmb_source!=='ŞABLON KURALI'?['BMB']:[]),...(odb?['ODB']:[])])];
    if(signals.length)out.push({horse,signals,warnings});
  }
  return out.map((row,index)=>({...row,index})).sort((a,b)=>b.warnings.length-a.warnings.length||Math.max(...b.signals.map(s=>s.wins/(s.starts+6)))-Math.max(...a.signals.map(s=>s.wins/(s.starts+6)))||a.index-b.index);
}
function tkpRankedSurpriseRows(r,ordered){
  const history=tkpTableBottomConditionStats(r),support=typeof tkpBombHunterSupportContext==='function'?tkpBombHunterSupportContext(r):null;
  const byNo=new Map();
  for(const row of tkpConditionRescueRows(r,ordered)){
    if(!row.warnings.some(tag=>/^BH[1-4]$/.test(tag)||/^ALT [1-4]$/.test(tag)||tag==='ODB'||tag==='BMB'))continue;
    byNo.set(String(row.horse.horse_no),{...row,signals:row.signals.slice(),warnings:row.warnings.slice()});
  }
  for(const horse of (ordered||[]).filter(h=>h&&!isNonRunner(h))){
    const tags=(support?.byHorse?.get(String(horse.horse_no))||[]).map(b=>String(b.text||'')).filter(t=>/^BH[1-4]$/.test(t));
    if(!tags.length)continue;
    let row=byNo.get(String(horse.horse_no));
    if(!row){row={horse,signals:[],warnings:[]};byNo.set(String(horse.horse_no),row);}
    for(const tag of tags){if(!row.warnings.includes(tag))row.warnings.unshift(tag);const proof=history.signals[tag];if(proof?.starts>0&&!row.signals.some(s=>s.label===tag))row.signals.push({label:tag,...proof});}
  }
  const primaryRanks=new Map((ordered||[]).filter(h=>h&&!isNonRunner(h)).map((h,i)=>[String(h.horse_no),i+1]));
  for(const [no,row] of byNo){
    const bhTags=(row.warnings||[]).filter(tag=>/^BH[1-4]$/.test(tag));
    if(bhTags.length&&!(Number(row?.horse?.agf_rank)>=6)){
      row.warnings=row.warnings.filter(tag=>!/^BH[1-4]$/.test(tag));
      row.signals=row.signals.filter(signal=>!/^BH[1-4]$/.test(String(signal?.label||'')));
      if(!row.warnings.length&&!row.signals.length)byNo.delete(no);
    }
  }
  const ranked=[...byNo.values()].filter(row=>{const rank=Number(row.horse.agf_rank);
    // AGF first five does not erase a proven tail signal outside TKP top five.
    // This exception uses only earlier condition evidence, never today's finish.
    const provenTail=primaryRanks.get(String(row.horse.horse_no))>5&&row.signals.some(s=>s.wins>0&&s.starts>0&&(/^(ALT [1-4]|BMB|ODB)$/.test(s.label)));
    // A small field / tied AGF share can place a genuine low-share BMB at AGF 4–5.
    // Match the existing <=10% surprise band, requiring earlier BMB/ODB wins.
    const share=Number(row.horse.agf);
    const provenLowShare=rank>=4&&rank<=5&&share>0&&share<=10&&row.signals.some(s=>s.wins>0&&s.starts>0&&/^(BMB|ODB)$/.test(s.label));
    return rank>=7||provenTail||provenLowShare||row.warnings.some(tag=>/^BH[1-4]$/.test(tag));}).map((row,index)=>{
    const evidence=row.signals.filter(s=>s.starts>0&&s.wins>=0&&s.wins<=s.starts).sort((a,b)=>b.wins/b.starts-a.wins/a.starts||b.starts-a.starts);
    const best=evidence[0];return {...row,index,winRate:best?best.wins/best.starts:null,winRateProof:best||null};
  }).sort((a,b)=>(b.winRate??-1)-(a.winRate??-1)||(b.winRateProof?.starts||0)-(a.winRateProof?.starts||0)||a.index-b.index);
  const selected=new Set(ranked.filter(row=>row.warnings.includes('ALT 1')||row.warnings.includes('ODB')).slice(0,5));
  for(const row of ranked){if(selected.size>=5)break;selected.add(row);}
  const result=ranked.filter(row=>selected.has(row));
  const isBhRow0=row=>(row.warnings||[]).some(t=>/^BH[1-4]$/.test(t));
  const numbers=new Set(result.map(row=>String(row.horse.horse_no)));
  for(const horse of ordered||[]){
    if(result.length>=6)break;
    if(!horse||isNonRunner(horse)||!(Number(horse.agf_rank)>=6)||numbers.has(String(horse.horse_no)))continue;
    if(ranked.some(row=>String(row.horse.horse_no)===String(horse.horse_no)&&isBhRow0(row)))continue;
    result.push({horse,signals:[],warnings:['ADAY'],winRate:null,winRateProof:null,index:result.length});
    numbers.add(String(horse.horse_no));
  }
  // BH/sürpriz tablosu üst sınırı: zorunlu sinyaller dahil toplam en fazla 6 farklı at.
  // Önceki adayların sırası korunur, kupon seçimleri veya geçmiş kayıtlar değiştirilmez.
  // ORTAK BH: tablodaki BH1/BH2/BH3 atlari 6'lik siniri yuzunden asla dusmez.
  const isBhRow=row=>row.warnings.some(t=>/^BH[1-4]$/.test(t));
  let out=result.slice(0,6);
  for(const row of result.slice(6)){
    if(!isBhRow(row))continue;
    let at=-1;
    for(let i=out.length-1;i>=0;i--){if(!isBhRow(out[i])){at=i;break;}}
    if(at>=0)out[at]=row;
  }
  for(const row of ranked){
    if(!isBhRow(row))continue;
    const same=out.findIndex(o=>String(o.horse.horse_no)===String(row.horse.horse_no));
    if(same>=0){if(!isBhRow(out[same]))out[same]=row;continue;}
    let at=-1;
    for(let i=out.length-1;i>=0;i--){if(!isBhRow(out[i])){at=i;break;}}
    if(at>=0)out[at]=row;else if(out.length<6)out.push(row);
  }
  // BH adayları AGF 6+ arasından gelir; ilk üç BH, ölçülen en iyi sıra olan AGF sırasıyla öne çıkar.
  // Geçmiş sinyal oranı yalnız eşit AGF sırasında ikincil ölçüttür; atın kişisel kazanma olasılığı değildir.
  out=tkpBhFrontOrder(out);
  return out;
}
function tkpBhRowNum(row){const t=(row.warnings||[]).map(w=>String(w).match(/^BH([1-4])$/)).filter(Boolean).map(m=>Number(m[1]));return t.length?Math.min(...t):99;}
function tkpBhRowRate(row){
  // Sira, tabloda GORUNEN "Kazanma %" sutunuyla ayni degerden gelir (row.winRate / winRateProof).
  if(row&&row.winRate!=null&&row.winRateProof&&row.winRateProof.starts>0)return {rate:row.winRate,starts:row.winRateProof.starts,wins:Number(row.winRateProof.wins)||0};
  const proofs=(row.signals||[]).filter(sg=>/^BH[1-4]$/.test(String(sg.label))&&sg.starts>0);
  if(!proofs.length)return {rate:-1,starts:0};
  const best=proofs.sort((a,b)=>b.wins/b.starts-a.wins/a.starts||b.starts-a.starts)[0];
  return {rate:best.wins/best.starts,starts:best.starts,wins:best.wins};
}
function tkpBhFrontOrder(rows){
  const isBh=row=>tkpBhRowNum(row)<99;
  const agfRank=row=>Number(row?.horse?.agf_rank??row?.agf_rank)||99;
  const evidence=row=>{
    const proof=row?.winRateProof;
    if(proof&&Number(proof.starts)>=5&&Number(proof.wins)>0&&Number.isFinite(Number(row?.winRate)))
      return {rate:Number(row.winRate),wins:Number(proof.wins)||0,starts:Number(proof.starts)||0};
    const signals=(row?.signals||[]).filter(s=>Number(s?.starts)>=5&&Number(s?.wins)>0)
      .sort((a,b)=>(Number(b.wins)/Number(b.starts))-(Number(a.wins)/Number(a.starts))||Number(b.starts)-Number(a.starts));
    const best=signals[0];
    return best?{rate:Number(best.wins)/Number(best.starts),wins:Number(best.wins)||0,starts:Number(best.starts)||0}:{rate:-1,wins:0,starts:0};
  };
  // The 612-meeting audit found AGF order best among tested pre-race BH ranks.
  // Keep eligible BH rows together; historical rate breaks AGF ties.
  return rows.slice().sort((a,b)=>{
    const x=evidence(a),y=evidence(b);
    if(isBh(a)!==isBh(b))return isBh(a)?-1:1;
    if(isBh(a)&&isBh(b))return agfRank(a)-agfRank(b)||(y.rate-x.rate)||(y.wins-x.wins)||(y.starts-x.starts)||tkpBhRowNum(a)-tkpBhRowNum(b);
    return (y.rate-x.rate)||(y.wins-x.wins)||(y.starts-x.starts)||agfRank(a)-agfRank(b);
  });
}
if(typeof globalThis!=='undefined')globalThis.tkpBhFrontOrder=tkpBhFrontOrder;
// BH siralama/garanti kurallarinin surumu: degisirse gecmis kuponlar ve BH istatistigi yeniden kurulur.
// BH kupon garantisi hangi ayakta? 2026-10-25 testi (1901 ayak, 607 kayit x 3 kupon):
// favorinin AGF payi %30 alti VE 8-13 at kosan ayakta BH1-3 %15 kazaniyor (digerlerinde %7-9).
// BH zorlamanin en az zarar verdigi kural: bu ayaklarda BH1-3, diger ayaklarda zorlama yok.
function tkpBhLegWantsBh(r){
  try{
    const run=(r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
    const fav=Math.max(0,...run.map(h=>Number(h.agf)||0));
    return fav>0&&fav<30&&run.length>=8&&run.length<=13;
  }catch(_e){return false;}
}
// 2026-10-25 ROI testi (600 toplanti, ikramiye dahil): en iyi kural = her 3+ atli ayakta BH1 zorunlu
// (AGF ilk 3 korunur) + BH olasilik tabani x1.5. ROI %-64.8 -> %-53.5; iki zaman yarisinda da daha iyi.
function tkpBhGuaranteeCount(r){return 1;}
// Arsivden otomatik ogrenilen BH kazanma orani: ayak tipi (uygun/diger) x BH sirasi (AGF siraya gore 1..3).
const TKP_BH_RATE_DEFAULTS={S:[[45,662],[37,659],[19,620]],D:[[53,1231],[30,1074],[17,873]]};
function tkpBhPositionRate(r,i){
  try{
    const seg=tkpBhLegWantsBh(r)?'S':'D';
    const live=(typeof db!=='undefined'&&db?.settings?.bh_condition_stats?.bhSeg)||null;
    const cell=(live&&live[seg]&&live[seg][i])||TKP_BH_RATE_DEFAULTS[seg][i];
    if(!cell)return 0;
    return (Number(cell[0])+1)/(Number(cell[1])+20);
  }catch(_e){return 0;}
}
// TABLO SIRASI KURALI (2026-10-25, kullanici): BH Oneri tablosunda ust siradaki BH1-3 kuponda yokken,
// tablonun alt siralarindaki (ALT/BMB/ODB/ADAY) bir at kuponda olamaz. Ayni sayida takas; maliyet sabit.
// AGF ilk 3 (pay >=%8) korunur. Donus: [[cikan_no, giren_horse], ...]
function tkpBhTableOrderSwaps(r,ordered,pickNos,isProtected){
  try{
    // Tablo ekrandaki sirayla ayni olmali: ekran 'score-desc' sirasini kullanir.
    const ord=(r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h))).slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
    const rows=(typeof tkpRankedSurpriseRows==='function'?tkpRankedSurpriseRows(r,ord.length?ord:ordered):[])||[];
    if(!rows.length)return [];
    const g=n=>{const m=String(n).match(/-E(\d+)$/i);return m?'E'+m[1]:'N'+String(n);};
    // Ekuri: BH ati, ayni ekurinin baska ati kupondaysa zaten kapsanmis sayilir. Alt sira ati ise yalniz
    // KENDISI kuponda secili ise cikarilir (ekuri ortagi uzerinden kapsanan favori asla cikarilmaz).
    const groups=new Set((pickNos||[]).map(g));
    const exact=new Set((pickNos||[]).map(n=>String(n)));
    const isBh=row=>(row.warnings||[]).some(t=>/^BH[1-4]$/.test(t));
    const swaps=[];
    const agfRank=row=>Number(row?.horse?.agf_rank??row?.agf_rank)||99;
    const firstThreeBh=rows.filter(row=>isBh(row)&&agfRank(row)>=6).slice().sort((a,b)=>{
      const x=tkpBhRowRate(a),y=tkpBhRowRate(b);
      return agfRank(a)-agfRank(b)||y.rate-x.rate||(y.wins-x.wins)||(y.starts-x.starts)||tkpBhRowNum(a)-tkpBhRowNum(b);
    }).slice(0,4);
    for(const row of firstThreeBh){
      const k=g(row.horse.horse_no);if(groups.has(k))continue;
      for(let j=rows.length-1;j>=0;j--){
        const low=rows[j];if(isBh(low))continue;
        const ln=String(low.horse.horse_no);if(!exact.has(ln))continue;
        if(typeof isProtected==='function'&&isProtected(low.horse))continue;
        exact.delete(ln);groups.delete(g(ln));groups.add(k);exact.add(String(row.horse.horse_no));swaps.push([ln,row.horse]);break;
      }
    }
    return swaps;
  }catch(_e){return [];}
}
if(typeof globalThis!=='undefined'){globalThis.tkpBhPositionRate=tkpBhPositionRate;globalThis.tkpBhTableOrderSwaps=tkpBhTableOrderSwaps;globalThis.TKP_BH_RATE_DEFAULTS=TKP_BH_RATE_DEFAULTS;if(!globalThis.TKP_BH_BOOST_K)globalThis.TKP_BH_BOOST_K=1.5;}
if(typeof globalThis!=='undefined'){globalThis.tkpBhLegWantsBh=tkpBhLegWantsBh;globalThis.tkpBhGuaranteeCount=tkpBhGuaranteeCount;}
if(typeof globalThis!=='undefined')globalThis.TKP_BH_RULES_VERSION='BH-BENTER-V14-AGF6-PRIMARY-3BH';
// Tek ortak BH listesi: tablo, Surpriz onerisi ve kupon kurallari AYNI satirlari kullanir.
// Sira: BH1, BH2, BH3 (etiket numarasina gore), yalniz kosan atlar.
function tkpBhCommonRows(r,ordered){
  const rows=(typeof tkpRankedSurpriseRows==='function'?tkpRankedSurpriseRows(r,ordered):[])||[];
  return tkpBhFrontOrder(rows.filter(row=>row&&row.horse&&tkpBhRowNum(row)<99));
}
if(typeof globalThis!=='undefined')globalThis.tkpBhCommonRows=tkpBhCommonRows;
function tkpSurpriseCouponRule(r,row){
  if((r?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0))return {eligible:false,reason:'Arşiv · kayıtlı kupon korunur'};
  const proof=row?.winRateProof;
  if(!proof||proof.starts<5)return {eligible:false,reason:'İzle · en az 5 örnek gerekli'};
  if(!(proof.wins>0))return {eligible:false,reason:'İzle · geçmiş galibiyet yok'};
  return {eligible:true,reason:'5+ atlı ayakta · yüzde sırası · bütçe korunur'};
}
// END TABLE BOTTOM FOUR

