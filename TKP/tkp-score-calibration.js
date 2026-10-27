// TKP sonuç-kalibre güven katmanı.
//
// Bu katman kupon sırasını veya TEK seçimini değiştirmez. Amacı, salt mevcut
// şart/puan bileşenleri yüksek diye ekranda yapay yüksek "güven" görünmesini
// engellemektir. Her hedef yarış için yalnız daha ESKİ tarihli, sonucu çözülmüş
// lider tahmin snapshotları kullanılır. Aynı gün, hedef yarış ve gelecek tarih
// merkezi tkpRowIsBeforeTarget kapısında fail-closed olarak dışarıda kalır.
(function(global){
  'use strict';

  const VERSION='V1.1.240-SCORE-OUTCOME-CALIBRATION';
  let cache={signature:'',values:new Map()};
  let sourceCache={signature:'',leaders:null};

  function num(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
  function text(v){ return String(v??'').trim(); }
  function folded(v){
    try { return typeof fold==='function'?fold(v):text(v).toLocaleUpperCase('tr-TR'); }
    catch(_){ return text(v).toLocaleUpperCase('tr-TR'); }
  }
  function conditionExact(r){ return folded(r?.condition_family||r?.condition_text||'BİLİNMİYOR')||'BİLİNMİYOR'; }
  function conditionBroad(r){
    try { return typeof broadConditionKey==='function'?String(broadConditionKey(r?.condition_family||r?.condition_text||'BİLİNMİYOR')):'BİLİNMİYOR'; }
    catch(_){ return conditionExact(r); }
  }
  function localScoreBand(score){
    const x=num(score);
    if(x<0.30)return {key:'0.00-0.29',label:'0,00–0,29'};
    if(x<0.60)return {key:'0.30-0.59',label:'0,30–0,59'};
    if(x<0.90)return {key:'0.60-0.89',label:'0,60–0,89'};
    if(x<1.20)return {key:'0.90-1.19',label:'0,90–1,19'};
    if(x<1.40)return {key:'1.20-1.39',label:'1,20–1,39'};
    if(x<1.70)return {key:'1.40-1.69',label:'1,40–1,69'};
    if(x<2.00)return {key:'1.70-1.99',label:'1,70–1,99'};
    return {key:'2.00+',label:'2,00+'};
  }
  function bandFor(score){
    try { return typeof scoreBand==='function'?scoreBand(score):localScoreBand(score); }
    catch(_){ return localScoreBand(score); }
  }
  function lowerBound(wins,total){
    try { return typeof wilson==='function'?Math.max(0,num(wilson(wins,total))):0; }
    catch(_){ return 0; }
  }
  function revision(){
    const rows=Array.isArray(db?.prediction_log)?db.prediction_log:[];
    let r='';
    try { r=typeof sideBetPredictionLogRevisionSignature==='function'?sideBetPredictionLogRevisionSignature(db):''; }catch(_){ }
    return [r||rows.length,db?.files?.length||0,db?.races?.length||0,
      db?.settings?.historical_snapshot_backfill_version||''].join('|');
  }
  function cacheValues(){
    const sig=revision();
    if(cache.signature!==sig){ cache={signature:sig,values:new Map()}; }
    return cache.values;
  }
  function rowRaceKey(row){
    const uid=text(row?.race_uid);
    if(uid)return `R:${uid}`;
    const meeting=text(row?.meeting_uid||row?.file_id);
    return [meeting||text(row?.race_date),folded(row?.hippodrome),num(row?.altili_no,1),num(row?.leg),text(row?.prediction_fp)].join('|');
  }
  function rowTimestamp(row){
    const t=Date.parse(text(row?.captured_at||row?.ts||row?.resolved_at));
    return Number.isFinite(t)?t:Number.MAX_SAFE_INTEGER;
  }
  function isUsableLeaderSnapshot(row){
    if(!row||Number(row?.resolved)!==1) return false;
    if(Number(row?.predicted_rank)!==1) return false;
    if(!Number.isFinite(Number(row?.score))) return false;
    // resolved=1, kaybeden lider için de gerçek sonucun işlendiği anlamına gelir.
    // finish_position bazı eski loglarda boş kalabildiğinden onu zorunlu tutmak
    // yalnız kazananları sayıp başarıyı yapay biçimde %100'e çıkarırdı.
    return true;
  }
  function historicalSnapshotProvenance(race,horse){
    const source=text(horse?.prediction_snapshot_provenance||race?.prediction_snapshot_provenance).toLocaleUpperCase('tr-TR');
    const locked=Number(horse?.prediction_score_locked)===1;
    return locked && (source.includes('HISTORICAL') || source==='LIVE_PRE_RACE_LOCKED');
  }
  function fallbackHistoricalLeaderSnapshots(){
    const sig=revision();
    if(sourceCache.signature===sig&&Array.isArray(sourceCache.leaders))return sourceCache.leaders;
    const races=Array.isArray(db?.races)?db.races:[];
    // 503 koşuluk arşiv için tek seferlik snapshot backfill doğrudan okunabilir.
    // Çok büyük/hot arşivde ilk görünümde yüzbinlerce yarış tarayıp ana thread'i
    // kilitlemek yerine prediction_log ana kaynağına dönülür; kullanıcı ekranı
    // açılır açılmaz senkron bir "5 milyon backfill" başlatılmaz.
    if(races.length>15000){ sourceCache={signature:sig,leaders:[]}; return sourceCache.leaders; }
    const leaders=[];
    for(const race of races){
      const horses=(race?.horses||[]).filter(h=>historicalSnapshotProvenance(race,h)
        &&Number.isFinite(Number(h?.prediction_score_snapshot))
        &&(Number(h?.winner)===1||Number(h?.finish_position)>=1));
      if(!horses.length)continue;
      horses.sort((a,b)=>{
        const ar=num(a?.prediction_order_snapshot,9999),br=num(b?.prediction_order_snapshot,9999);
        return ar-br || num(b?.prediction_score_snapshot)-num(a?.prediction_score_snapshot)
          ||TKP_TR_COLLATOR_NUM.compare(text(a?.horse_no),text(b?.horse_no));
      });
      const leader=horses[0];
      leaders.push({
        prediction_fp:`HISTORICAL_SNAPSHOT:${text(race?.race_uid||race?.id||race?.file_id)}:${num(race?.leg)}`,
        file_id:race?.file_id||'',meeting_uid:race?.meeting_uid||race?.file_id||'',race_uid:race?.race_uid||race?.id||'',
        race_date:race?.race_date||race?.date||'',hippodrome:race?.hippodrome||'',altili_no:num(race?.altili_no,1),leg:num(race?.leg),
        condition_family:race?.condition_family||race?.condition_text||'',score:num(leader?.prediction_score_snapshot),
        score_band:bandFor(leader?.prediction_score_snapshot).key,predicted_rank:1,resolved:1,
        winner:Number(leader?.winner)===1||Number(leader?.finish_position)===1?1:0,
        finish_position:num(leader?.finish_position),evidence_class:leader?.prediction_snapshot_provenance||'HISTORICAL_ARCHIVE_RECONSTRUCTED',
        captured_at:leader?.prediction_score_snapshot_at||''
      });
    }
    sourceCache={signature:sig,leaders};
    return leaders;
  }
  function scoreEvidenceSourceRows(){
    const logs=(Array.isArray(db?.prediction_log)?db.prediction_log:[]).filter(isUsableLeaderSnapshot);
    // Gerçek/kilitli tahmin logu varsa o ana kaynaktır. 503 geçmiş yarış için
    // kullanıcıya açık olan tek seferlik arşiv snapshotları yalnız log henüz
    // oluşmamışsa araştırma tabanı olur; gelecekteki canlı sınıflandırmayı etkilemez.
    return logs.length?logs:fallbackHistoricalLeaderSnapshots();
  }
  function rowBeforeTarget(row,targetRace){
    try {
      if(typeof tkpRowIsBeforeTarget==='function') return tkpRowIsBeforeTarget(row,targetRace,db);
    }catch(_){ }
    // Merkezî kapı yüklenmemişse yalnız tarih kanıtıyla emniyetli fallback.
    const source=text(row?.race_date).slice(0,10),target=text(targetRace?.race_date||targetRace?.date).slice(0,10);
    return !!(source&&target&&source<target);
  }
  function chooseOnePerRace(rows){
    const byRace=new Map();
    for(const row of rows){
      const key=rowRaceKey(row),prev=byRace.get(key);
      if(!prev){ byRace.set(key,row); continue; }
      const a=text(row?.evidence_class).toLocaleUpperCase('tr-TR')==='LIVE_PRE_RACE_LOCKED'?1:0;
      const b=text(prev?.evidence_class).toLocaleUpperCase('tr-TR')==='LIVE_PRE_RACE_LOCKED'?1:0;
      if(a>b || (a===b&&rowTimestamp(row)<rowTimestamp(prev))) byRace.set(key,row);
    }
    return Array.from(byRace.values());
  }
  function summarize(rows,level,band,target){
    const unique=chooseOnePerRace(rows);
    const total=unique.length;
    const wins=unique.reduce((n,row)=>n+(Number(row?.winner)===1||Number(row?.finish_position)===1?1:0),0);
    const rate=total?wins/total:0;
    const lb=total?lowerBound(wins,total):0;
    const live=unique.filter(row=>text(row?.evidence_class).toLocaleUpperCase('tr-TR')==='LIVE_PRE_RACE_LOCKED').length;
    return {
      version:VERSION,total,wins,rate,lowerBound:lb,level,band,
      condition:conditionBroad(target),liveLocked:live,historical:total-live,
      rows:unique
    };
  }

  // Benzerlik sırası bilerek nettir: önce aynı skor bandı + tam şart, sonra aynı
  // skor bandı + koşu ailesi. Daha geniş bir havuz uydurmak yerine n küçükse
  // ekran bunu açıkça gösterir ve güven yüksek görünmez.
  function tkpScoreOutcomeEvidence(targetRace,targetHorse){
    if(!targetRace||!targetHorse) return summarize([], 'Veri yok', bandFor(0), targetRace||{});
    const score=num(targetHorse?.prediction_score_snapshot,NaN);
    const targetScore=Number.isFinite(score)?score:num(targetHorse?.score,0);
    const band=bandFor(targetScore);
    const exact=conditionExact(targetRace),broad=conditionBroad(targetRace);
    let cutoff='';try { cutoff=typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):''; }catch(_){ }
    const key=[cutoff||'NO_CUTOFF',exact,broad,band.key,targetScore.toFixed(3)].join('|');
    const values=cacheValues();
    const hit=values.get(key);if(hit)return hit;

    const all=scoreEvidenceSourceRows().filter(row=>rowBeforeTarget(row,targetRace));
    const inBand=all.filter(row=>String(row?.score_band||bandFor(row?.score).key)===band.key);
    const exactRows=inBand.filter(row=>conditionExact(row)===exact);
    const broadRows=inBand.filter(row=>conditionBroad(row)===broad);
    // Aynı koşu için log yinelenmişse önce dedupe edip n eşiğine bakılır.
    const exactSummary=summarize(exactRows,'Tam şart + aynı skor bandı',band,targetRace);
    const result=exactSummary.total>=5
      ?exactSummary
      :summarize(broadRows,'Benzer şart + aynı skor bandı',band,targetRace);
    values.set(key,result);
    if(values.size>192) values.delete(values.keys().next().value);
    return result;
  }

  // Ekrandaki yüzde "sonuç-kalibre güven"dir. Ham model yüzdesi kupon motorunun
  // mevcut kararını korur; fakat yeterli geçmiş kanıt yokken %70+ gibi yüksek bir
  // güven gösterilmez. Wilson alt sınırı hem küçük örneklem şansını bastırır hem
  // de şart adı tek başına yüksek puan üretse bile görünür güveni sınırlar.
  function tkpScoreCalibratedConfidence(targetRace,targetHorse,rawConfidence){
    const evidence=tkpScoreOutcomeEvidence(targetRace,targetHorse);
    const raw=Math.max(0,Math.min(100,Math.round(num(rawConfidence))));
    const n=evidence.total;
    const safe=Math.round(Math.max(0,Math.min(100,evidence.lowerBound*100)));
    let cap=55;
    if(n>=5)cap=60;
    if(n>=10)cap=68;
    if(n>0)cap=75; // V1.1.305: 20 yarış zorunluluğu kaldırıldı
    if(n>=40)cap=84;
    if(n>=80)cap=92;
    // Kanıt arttıkça ham skor yerine güvenli başarı alt sınırı daha büyük ağırlık
    // alır. Bu bir bahis olasılığı iddiası değil, ekran güveninin şeffaf freni.
    const weight=n?Math.min(0.70,0.18+Math.log2(n+1)*0.10):1;
    const blended=n?Math.round(raw*(1-weight)+safe*weight):0;
    const calibrated=Math.max(0,Math.min(raw,cap,n?blended:cap));
    return {...evidence,rawConfidence:raw,calibratedConfidence:calibrated,displayCap:cap};
  }

  function tkpScoreOutcomeEvidenceLabel(targetRace,targetHorse,rawConfidence,compact=false){
    const d=tkpScoreCalibratedConfidence(targetRace,targetHorse,rawConfidence);
    if(!d.total) return compact
      ? `Sonuç kalibre %${d.calibratedConfidence} · benzer lider kaydı yok`
      : `Sonuç kalibre güven %${d.calibratedConfidence} · benzer skor/şartta sonuçlanmış lider kaydı yok (yüksek güven gösterilmez).`;
    const rate=Math.round(d.rate*100),lb=Math.round(d.lowerBound*100);
    const base=`Sonuç kalibre %${d.calibratedConfidence} · ${d.wins}/${d.total} kazandı · başarı %${rate} · güven altı %${lb}`;
    return compact?base:`${base} · ${d.level} · ${d.band.label} skor bandı`;
  }

  global.tkpScoreOutcomeEvidence=tkpScoreOutcomeEvidence;
  global.tkpScoreCalibratedConfidence=tkpScoreCalibratedConfidence;
  global.tkpScoreOutcomeEvidenceLabel=tkpScoreOutcomeEvidenceLabel;
  global.TKP_SCORE_OUTCOME_CALIBRATION_VERSION=VERSION;
})(typeof globalThis!=='undefined'?globalThis:window);
