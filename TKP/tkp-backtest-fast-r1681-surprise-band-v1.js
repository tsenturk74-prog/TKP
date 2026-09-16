/**
 * tkp-backtest-fast.js — V27 korumalı Back Test motoru
 *
 * Amaç: Back Test'in veri büyüyünce saatlerce dönmesini engellemek.
 * Bu dosya canlı tahmin, ODS paneli, klasör yükleme, sonuç güncelleme ve kupon
 * üretim ekranını değiştirmez. Sadece Back Test HTML üreticisini tek geçişli,
 * cache'li ve sonuç-korumalı hızlı motorla değiştirir. Eski motor yedekte saklanır.
 */
(function(global){
  'use strict';

  const VERSION = 'V55_3_THREE_COUPON_FAST_BACKTEST';
  const BACKTEST_COUPON_NAMES={main:'Normal',alt:'Sürpriz',surprise:'Uzman + Kulis'};
  const fastCache = new Map();
  const fastHtmlCache = new Map();
  const MIN_PERCENT_SAMPLE = 1; // V1.1.305: 20 yarış zorunluluğu kaldırıldı

  // Toplu Back Test varsayılanı: doğrulanmış PRE-RACE kilitli snapshot üzerinden
  // hızlı replay. Canlı canonical kupon motorunu her tarihsel toplantıda tekrar
  // çalıştırmak büyük arşivde onlarca saniye ana thread'i kilitliyordu. İstenirse
  // geliştirici oturumunda bu bayrak true verilerek ağır canonical replay açılabilir.
  global.TKP_BACKTEST_USE_LIVE_ENGINE=false;

  function arr(v){ return Array.isArray(v) ? v : []; }
  function num(v,d=0){ const n=Number(v); return Number.isFinite(n) ? n : d; }
  function str(v){ return String(v ?? '').trim(); }
  function escLocal(v){
    if(typeof global.esc === 'function') return global.esc(v);
    return String(v ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  }
  function fmt2Local(v){ return typeof global.fmt2 === 'function' ? global.fmt2(v) : (num(v)).toFixed(2).replace('.',','); }
  function fmtTLLocal(v){
    const x=num(v);
    return `${x.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:true})} TL`;
  }
  function nonRunner(h){ try { return typeof global.isNonRunner === 'function' && global.isNonRunner(h); } catch(_){ return false; } }
  function sameHorse(a,b){
    const aa=str(a), bb=str(b);
    if(!aa || !bb) return false;
    if(aa===bb) return true;
    try{
      if(typeof global.ekuriBase === 'function' && str(global.ekuriBase(aa))===str(global.ekuriBase(bb))) return true;
      if(typeof global.sameEkuri === 'function' && global.sameEkuri(aa,bb)) return true;
    }catch(_){ }
    return false;
  }
  function poolHas(pool,no){ return arr(pool).some(x=>sameHorse(x,no)); }
  function uniqueNos(values){ return [...new Set(arr(values).map(str).filter(Boolean))]; }
  function uniqueBetNos(values){
    const out=[], seenExact=new Set(), seenGroups=new Set();
    for(const raw of arr(values)){
      const no=str(raw); if(!no) continue;
      const exact=no.toUpperCase(); if(seenExact.has(exact)) continue;
      let group='';
      try{ if(typeof global.ekuriGroup==='function') group=str(global.ekuriGroup(no)).toUpperCase(); }catch(_){ }
      if(!group){ const m=no.match(/-(E\d+)$/i); group=m?m[1].toUpperCase():''; }
      if(group && seenGroups.has(group)) continue;
      seenExact.add(exact); if(group) seenGroups.add(group); out.push(no);
    }
    return out;
  }
  function rankScore(v, fieldSize, maxRank=null){
    const n=num(v,0);
    const size=Math.max(6, num(fieldSize,10));
    const cap=maxRank || Math.max(8,size);
    if(!n || n<1 || n>cap) return 0;
    return Math.max(0, 1 - ((n-1) / Math.max(1, cap-1)));
  }
  function highScore(v, scale){
    const n=num(v,0), s=Math.max(1,num(scale,100));
    return Math.max(0,Math.min(1,n/s));
  }
  function weightPenalty(h){
    const kg=num(h?.weight_kg ?? h?.kg,0);
    if(!kg) return 0;
    if(kg>62) return -5;
    if(kg>60) return -3;
    if(kg>=58) return -1;
    return 0;
  }
  function odbLike(h){
    try{ if(typeof global.isOdbCandidate === 'function' && global.isOdbCandidate(h)) return true; }catch(_){ }
    return Number(h?.odb)===1 || /ODB/i.test(str(h?.labels||h?.tag||''));
  }

  // V1.1.213 HIZ MİMARİSİ: aynı yarışın live/maxTkp/maxVal değerleri her
  // sort karşılaştırmasında tekrar hesaplanmamalı. Önceki yapı, her at çifti için
  // yeniden filter/map/Math.max yaparak büyük arşivlerde gereksiz CPU ve GC yükü
  // oluşturuyordu. Context yarış başına bir kez hazırlanır; skorun kendisi değişmez.
  function fastRaceScoreContext(r){
    const live=arr(r?.horses).filter(x=>!nonRunner(x));
    return {
      live,
      maxTkp:Math.max(1,...live.map(x=>num(x?.score,0))),
      maxVal:Math.max(1,...live.map(x=>num(x?.value_score ?? x?.value ?? x?.s_value,0))),
      field:live.length||10
    };
  }

  // Sonuç alanlarını kullanmadan hızlı sıralama. Canlı algoritmayı değiştirmez;
  // sadece Back Test'in saatlerce kilitlenmesini önler.
  function fastBacktestScore(r,h,context=null){
    const ctx=context||fastRaceScoreContext(r);
    const maxTkp=ctx.maxTkp, maxVal=ctx.maxVal, field=ctx.field;
    let score=0;
    score += highScore(h?.score,maxTkp) * 32;
    score += rankScore(h?.agf_rank,field) * 17;
    score += highScore(h?.ypuan,70) * 11;
    score += highScore(h?.value_score ?? h?.value ?? h?.s_value,maxVal) * 8;
    score += rankScore(h?.hndkp_rank,field) * 5;
    score += rankScore(h?.tr_rank,field) * 4;
    score += rankScore(h?.jbyg,field,7) * 4;
    score += rankScore(h?.g800,field,8) * 3;
    score += Number(h?.bmb)===1 ? 3 : 0;
    score += odbLike(h) ? 2 : 0;
    score += weightPenalty(h);
    const no=str(h?.horse_no);
    // Stabil bağlayıcı: aynı skor durumunda at no küçük olan önce gelsin.
    return {score, no};
  }
  function loggedOrderForRace(r,loggedRows,rankField){
    const rankMap=new Map(arr(loggedRows).map(row=>[str(row?.horse_no),num(row?.[rankField],0)]).filter(([,rank])=>rank>0));
    const rows=arr(r?.horses).filter(h=>!nonRunner(h)).slice();
    if(rows.filter(h=>rankMap.has(str(h?.horse_no))).length<Math.min(2,rows.length)) return null;
    rows.sort((a,b)=>(rankMap.get(str(a?.horse_no))||999)-(rankMap.get(str(b?.horse_no))||999)
      || TKP_TR_COLLATOR_NUM.compare(str(a?.horse_no),str(b?.horse_no)));
    return rows;
  }
  function fastOrderForRace(r,loggedRows){
    const archived=loggedOrderForRace(r,loggedRows,'predicted_rank');
    if(archived){
      archived.forEach((horse,index)=>{
        horse.v27_backtest_rank=index+1;
        horse.v27_backtest_score=100-index;
        horse.v37_backtest_source='ARCHIVED_LIVE_PREDICTION';
      });
      return archived;
    }
    const context=fastRaceScoreContext(r);
    const rows=context.live.slice();
    const scoreCache=new Map(rows.map(h=>[h,fastBacktestScore(r,h,context)]));
    rows.sort((a,b)=>{
      const sa=scoreCache.get(a), sb=scoreCache.get(b);
      return sb.score-sa.score
        || num(b?.score,0)-num(a?.score,0)
        || num(a?.agf_rank,999)-num(b?.agf_rank,999)
        || TKP_TR_COLLATOR_NUM.compare(str(a?.horse_no),str(b?.horse_no));
    });
    for(let i=0;i<rows.length;i++){
      rows[i].v27_backtest_rank=i+1;
      rows[i].v27_backtest_score=Math.round(scoreCache.get(rows[i]).score*100)/100;
      rows[i].v37_backtest_source='FAST_SCENARIO_FALLBACK';
    }
    return rows;
  }
  function targetRankScore(v,target,fieldSize,maxRank=null){
    const n=num(v,0);
    const size=Math.max(6,num(fieldSize,10));
    const cap=maxRank || Math.max(8,size);
    if(!n || n<1 || n>cap) return 0;
    return Math.max(0,1-(Math.abs(n-target)/Math.max(1,cap-1)));
  }
  function fastPositionScore(r,h,position,context=null){
    const ctx=context||fastRaceScoreContext(r);
    const field=ctx.field;
    const maxTkp=ctx.maxTkp;
    const maxVal=ctx.maxVal;
    const target=Math.max(1,Math.min(5,num(position,1)));
    let score=0;
    score+=highScore(h?.score,maxTkp)*24;
    score+=targetRankScore(h?.agf_rank,target,field)*14;
    score+=targetRankScore(h?.tr_rank,target,field)*9;
    score+=targetRankScore(h?.hndkp_rank,target,field)*8;
    score+=targetRankScore(h?.sp_rank,target,field)*7;
    score+=targetRankScore(h?.jbyg,target,field,7)*6;
    score+=targetRankScore(h?.g800,target,field,8)*5;
    score+=highScore(h?.ypuan,70)*4;
    score+=highScore(h?.value_score ?? h?.value ?? h?.s_value,maxVal)*4;
    score+=highScore(h?.priorAccurateAvgSpeed??h?.prior_accurate_avg_speed,20)*3;
    score+=Number(h?.bmb)===1?1.5:0;
    score+=odbLike(h)?1:0;
    score+=weightPenalty(h);
    return {score,no:str(h?.horse_no)};
  }
  function fastPositionRankingsForRace(r,loggedRows){
    const rankings={};
    const context=fastRaceScoreContext(r);
    const live=context.live;
    for(let position=1;position<=5;position++){
      const archived=loggedOrderForRace(r,loggedRows,'sidebet_rank_p'+position);
      if(archived){ rankings['p'+position]=archived; continue; }
      const scoreCache=new Map(live.map(h=>[h,fastPositionScore(r,h,position,context)]));
      rankings['p'+position]=live.slice().sort((a,b)=>{
        const sa=scoreCache.get(a), sb=scoreCache.get(b);
        return sb.score-sa.score
          || num(b?.score,0)-num(a?.score,0)
          || TKP_TR_COLLATOR_NUM.compare(str(a?.horse_no),str(b?.horse_no));
      });
    }
    return rankings;
  }
  function currentLockedOrderForRace(r){
    const rows=arr(r?.horses).filter(h=>!nonRunner(h)).slice();
    const ranked=rows.filter(h=>isGenuinelyLocked(h,r)&&num(h?.prediction_order_snapshot,0)>0);
    if(ranked.length<Math.max(2,Math.ceil(rows.length*.80))) return null;
    rows.sort((a,b)=>{
      const ar=isGenuinelyLocked(a,r)?num(a?.prediction_order_snapshot,999):999;
      const br=isGenuinelyLocked(b,r)?num(b?.prediction_order_snapshot,999):999;
      return ar-br || TKP_TR_COLLATOR_NUM.compare(str(a?.horse_no),str(b?.horse_no));
    });
    const classes=ranked.map(h=>lockClass(h,r));
    const source=classes.some(value=>value==='ARCHIVE_CHRONO')?'ARCHIVE_CHRONO_SNAPSHOT':'CURRENT_LOCKED_SNAPSHOT';
    rows.forEach((horse,index)=>{
      horse.v27_backtest_rank=index+1;
      horse.v27_backtest_score=100-index;
      horse.v37_backtest_source=source;
    });
    rows.v37_backtest_source=source;
    return rows;
  }
  function raceResultsFromRowsFast(rows,predictionIndex){
    // Doğrulanmış toplantıda yalnız yarış-öncesi frozen sıra kullanılır. Açık kilitli
    // yeni kayıt ve sonucu yazılmadan önce zaman damgalanmış eski arşiv snapshot'ı
    // ayrı kaynak olarak görünür; sonuç sonrası serbest skor fallback'i doğrulanmış
    // replay havuzuna hiç girmez.
    return arr(rows).slice().sort((a,b)=>num(a?.leg)-num(b?.leg)).map(r=>{
      const locked=currentLockedOrderForRace(r);
      const scored=locked||fastOrderForRace(r,[]);
      const source=locked?(locked.v37_backtest_source||'CURRENT_LOCKED_SNAPSHOT'):'UNVERIFIED_FALLBACK';
      return {r,scored,source,top:scored[0]||null,second:scored[1]||null,third:scored[2]||null,margin:num(scored[0]?.v27_backtest_score)-num(scored[1]?.v27_backtest_score)};
    }).filter(x=>x.top);
  }
  function raceHasWinner(r){
    return arr(r?.horses).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  }
  // KÖK FIX (2026-08-12): 6/6 tuttu oranı ve ROI, arka planda gerçekten yarış
  // öncesi kilitlenmiş (prediction_score_locked=1 + güncel model versiyonu) mi,
  // yoksa geriye dönük senaryo/tahminle mi üretildiğine bakmaksızın tek havuzda
  // toplanıyordu. 2 whale toplantı incelemesinde bunun gerçek dışı ROI şişmesine
  // (%1277 -> whale'ler çıkarılınca %53) yol açtığı görüldü. Bu fonksiyon her
  // 6 ayaklık toplantı için "gerçekten doğrulanmış" oranını hesaplar.
  function currentModelVersion(){
    try{ if(typeof global.TKP_SCORE_MODEL_VERSION==='string') return global.TKP_SCORE_MODEL_VERSION; }catch(_){ }
    try{ if(typeof TKP_SCORE_MODEL_VERSION==='string') return TKP_SCORE_MODEL_VERSION; }catch(_){ }
    return null;
  }
  function validTime(value){
    const ms=Date.parse(str(value));return Number.isFinite(ms)?ms:null;
  }
  let _backtestFileIndexDb=null,_backtestFileIndexFiles=null,_backtestFileIndex=new Map();
  function fileForRace(r){
    const d=global.db||{},files=arr(d.files);
    if(_backtestFileIndexDb!==d||_backtestFileIndexFiles!==files){
      _backtestFileIndexDb=d;_backtestFileIndexFiles=files;
      _backtestFileIndex=new Map(files.map(item=>[String(item?.id),item]));
    }
    return _backtestFileIndex.get(String(r?.file_id))||{};
  }
  function lockClass(h,r){
    if(!h)return 'NONE';
    const order=Number(h?.prediction_order_snapshot),score=Number(h?.prediction_score_snapshot);
    if(!Number.isFinite(order)||order<=0||!Number.isFinite(score))return 'NONE';
    if(Number(h?.prediction_score_locked)===1){
      const ver=currentModelVersion();
      return !ver||h?.prediction_score_model_version===ver?'CURRENT_LOCKED':'ARCHIVE_LOCKED';
    }
    // Eski 508/509 arşivde explicit lock bayrağı bulunmayan fakat gerçek frozen
    // sıra/skor ve snapshot zamanı bulunan kayıtlar vardı. Snapshot zamanı resmî
    // sonucun DB'ye yazıldığı zamandan önceyse kronoloji sonucu sızıntısız kanıtlar.
    const file=fileForRace(r);
    const snapshotAt=validTime(h?.prediction_score_snapshot_at||h?.prediction_snapshot_at||h?.prediction_locked_at);
    const resultAt=validTime(file?.result_updated_at||r?.result_updated_at);
    const fileCreatedAt=validTime(file?.created_at||file?.imported_at||file?.historical_imported_at);
    if(snapshotAt!==null&&resultAt!==null&&snapshotAt<=resultAt+1000){
      if(fileCreatedAt===null||fileCreatedAt<=resultAt+1000)return 'ARCHIVE_CHRONO';
    }
    return 'NONE';
  }
  function isGenuinelyLocked(h,r){return lockClass(h,r)!=='NONE';}
  function meetingLockIntegrity(rows){
    let total=0,current=0,archiveLocked=0,archiveChrono=0;
    const raceCoverage=[];
    for(const race of arr(rows)){
      let raceTotal=0,raceLocked=0;
      for(const horse of arr(race?.horses)){
        if(nonRunner(horse))continue;total++;raceTotal++;
        const cls=lockClass(horse,race);
        if(cls==='CURRENT_LOCKED'){current++;raceLocked++;}
        else if(cls==='ARCHIVE_LOCKED'){archiveLocked++;raceLocked++;}
        else if(cls==='ARCHIVE_CHRONO'){archiveChrono++;raceLocked++;}
      }
      const raceRatio=raceTotal?raceLocked/raceTotal:0;
      raceCoverage.push({leg:num(race?.leg,0),locked:raceLocked,total:raceTotal,ratio:raceRatio,verified:raceTotal>0&&raceLocked>=Math.max(2,Math.ceil(raceTotal*.80))});
    }
    const locked=current+archiveLocked+archiveChrono,ratio=total?locked/total:0;
    // Toplantı toplamında %80 yeterli değildir: tek bir ayak frozen kapsamdan
    // düşerse o ayakta canlı/sonuç-sonrası skor fallback'i devreye girebilir.
    // Replay havuzu ancak altı ayağın HER BİRİ en az %80 frozen olduğunda güvenlidir.
    const verified=raceCoverage.length===6&&raceCoverage.every(item=>item.verified);
    return {ratio,locked,current,archive:archiveLocked+archiveChrono,archiveLocked,archiveChrono,total,raceCoverage,verified};
  }
  function meetingGroups(){
    try{
      if(typeof global.tkpMeetingGroups === 'function'){
        const indexed=global.tkpMeetingGroups(true).filter(rows=>arr(rows).some(raceHasWinner));
        if(indexed.length) return indexed;
      }
    }catch(_){ }
    try{
      if(typeof global._v24MeetingGroups === 'function'){
        const legacy=arr(global._v24MeetingGroups()).filter(rows=>arr(rows).some(raceHasWinner));
        if(legacy.length) return legacy;
      }
    }catch(_){ }
    const d=global.db || {};
    const map=new Map();
    for(const r of arr(d.races)){
      if(!r || !arr(r.horses).length) continue;
      const key=str(r.file_id || r.meeting_id || `${r.race_date||r.date||''}|${r.hippodrome||''}|${r.sequence_no||''}`);
      if(!map.has(key)) map.set(key,[]);
      map.get(key).push(r);
    }
    return [...map.values()].filter(rows=>arr(rows).some(raceHasWinner));
  }
  function fileForRows(rows){
    // V1.1.330 LIVE-509 HIZ FIX: meetingInfo()/sortMeetingGroups() her comparator
    // çağrısında 509 dosyanın tamamını Array.find ile tarıyordu. Gerçek 509 yedekte
    // yalnız ilk 8 eligibility kaydı ~1,8 sn ana-thread dilimi oluşturuyordu.
    // fileForRace() zaten DB/files referansına bağlı O(1) Map indeksi tutuyor; aynı
    // kaynağı burada da kullanarak dosya aramasını sabit zamana indir.
    const first=arr(rows)[0]||{};
    return fileForRace(first)||{};
  }
  function canonicalTrack(v){
    try{ if(typeof global.couponCanonicalTrackName==='function') return str(global.couponCanonicalTrackName(v)); }catch(_){ }
    return str(v).toLocaleUpperCase('tr-TR').replace(/\s+/g,' ');
  }
  function meetingInfo(rows){
    const first=arr(rows)[0]||{};
    const stored=fileForRows(rows);
    const date=str(first.race_date||first.date||stored.race_date||stored.date)||'Tarihsiz';
    const hipRaw=str(first.hippodrome||first.hipodrom||stored.hippodrome||stored.hipodrom)||'—';
    const hip=(typeof global.displayHippodromeShort==='function'?str(global.displayHippodromeShort(hipRaw)):hipRaw);
    const file=str(first.filename||first.file_name||stored.filename||stored.file_name)||'';
    const altili=num(first.altili_no||stored.altili_no,0);
    const sequence=num(first.sequence_no||stored.sequence_no,0);
    const meetingUid=str(first.meeting_uid||stored.meeting_uid);
    return {date,hip,file,altili,sequence,meetingUid,label:`${date} · ${hip}${altili?' · '+altili+'. Altılı':''}`};
  }
  function dateSortValue(value){
    const s=str(value);
    let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if(m) return Number(m[1])*10000+Number(m[2])*100+Number(m[3]);
    m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if(m) return Number(m[3])*10000+Number(m[2])*100+Number(m[1]);
    const parsed=Date.parse(s);
    return Number.isFinite(parsed)?Math.floor(parsed/86400000):0;
  }
  function sortMeetingGroups(groups){
    // V1.1.330 LIVE-509 HIZ FIX: Array.sort comparator'ı aynı toplantı için
    // meetingInfo/date/canonicalTrack hesaplarını onlarca kez tekrarlamasın.
    // Sıralama anahtarını toplantı başına bir kez hazırla, sonra yalnız sayıları/
    // kısa stringleri karşılaştır. Davranış aynıdır; yalnız CPU/GC yükü düşer.
    return arr(groups).map((rows,index)=>{
      const info=meetingInfo(rows);
      return {rows,index,info,dateValue:dateSortValue(info.date),track:canonicalTrack(info.hip)};
    }).sort((a,b)=>a.dateValue-b.dateValue
      || TKP_TR_COLLATOR.compare(a.track,b.track)
      || num(a.info.altili)-num(b.info.altili)
      || num(a.info.sequence)-num(b.info.sequence)
      || TKP_TR_COLLATOR.compare(str(a.info.meetingUid),str(b.info.meetingUid))
      || a.index-b.index).map(item=>item.rows);
  }
  function completeSixLegRows(rows){
    const byLeg=new Map();
    for(const race of arr(rows).slice().sort((a,b)=>num(a?.leg)-num(b?.leg))){
      const leg=num(race?.leg,0);
      if(leg>=1&&leg<=6&&!byLeg.has(leg)) byLeg.set(leg,race);
    }
    return [1,2,3,4,5,6].every(leg=>byLeg.has(leg)) ? [1,2,3,4,5,6].map(leg=>byLeg.get(leg)) : [];
  }
  function snapshotParts(snapshot){
    const raw=str(snapshot?.key).split('|');
    const third=num(raw[2],0);
    return {
      date:str(snapshot?.race_date||raw[0]),
      hip:canonicalTrack(snapshot?.hippodrome||raw[1]),
      altili:num(snapshot?.altili_no||third,0),
      createdAt:str(snapshot?.created_at),
      id:str(snapshot?.id)
    };
  }
  function buildCouponSnapshotIndex(groups){
    const exact=new Map(),legacy=new Map(),sessionCounts=new Map();
    for(const rows of arr(groups)){
      const info=meetingInfo(rows),base=[info.date,canonicalTrack(info.hip)].join('|');
      if(!sessionCounts.has(base)) sessionCounts.set(base,new Set());
      sessionCounts.get(base).add(num(info.altili,1)||1);
    }
    const snapshots=arr(global.db?.auto_coupon_log).slice().sort((a,b)=>str(a?.created_at).localeCompare(str(b?.created_at)));
    // HISTORICAL_CALIBRATION_FULL, tam arşivdeki yarış-öncesi yeniden-kurulmuş
    // snapshot zinciridir. Önceki kod bunu kaynak listesi dışında bıraktığı için
    // doğrulanmış 503/509 arşivinde kuponlar görünmesine rağmen Back Test'e hiç
    // giremiyordu.
    const eligibleSources=new Set(['SON_AGF_OTOMATIK','YARISTAN_40_DK_ONCE','SISTEM_GUNCEL_VERI','X_GUNCEL_OTOMATIK','HISTORICAL_CALIBRATION_FULL']);
    for(const snapshot of snapshots){
      if(!snapshot?.coupons) continue;
      if(snapshot?.backtest_eligible===0||!eligibleSources.has(str(snapshot?.source))) continue;
      const p=snapshotParts(snapshot),base=[p.date,p.hip].join('|');
      if(!p.date||!p.hip) continue;
      if(p.altili>0) exact.set([base,p.altili].join('|'),snapshot);
      else legacy.set(base,snapshot);
    }
    return {exact,legacy,sessionCounts};
  }
  function couponSnapshotForRows(rows,index){
    if(!index) return null;
    const info=meetingInfo(rows),base=[info.date,canonicalTrack(info.hip)].join('|');
    const exact=index.exact.get([base,num(info.altili,1)||1].join('|'));
    if(exact) return exact;
    // Eski snapshot Altılı numarası taşımıyorsa yalnız tarih/hipodromda tek oturum
    // bulunduğunda kullan. İki Altılı varsa yanlış kuponu eşleştirmektense senaryo kalır.
    if((index.sessionCounts.get(base)?.size||0)===1) return index.legacy.get(base)||null;
    return null;
  }
  function couponSnapshotIsVerified(snapshot){
    if(!snapshot?.coupons||snapshot?.backtest_eligible===0||Number(snapshot?.manual_adjustment)===1)return false;
    const source=str(snapshot?.source);
    if(source==='HISTORICAL_CALIBRATION_FULL')return Number(snapshot?.historical_calibration)===1;
    if(!new Set(['SON_AGF_OTOMATIK','YARISTAN_40_DK_ONCE','SISTEM_GUNCEL_VERI','X_GUNCEL_OTOMATIK']).has(source))return false;
    // Yeni snapshot şemasında kanıt açık olarak tutulur. Eski otomatik snapshotlar
    // saveAutomaticCouponSnapshot'ın yarış-saati kilidinden geçmiş kayıtlar olduğu
    // için geriye uyumlu kabul edilir; manuel/SON_KUPON kayıtları hiçbir zaman girmez.
    if(Number(snapshot?.schema_version)>=5)return Number(snapshot?.pre_race_only)===1&&Number(snapshot?.snapshot_time_verified)===1;
    return true;
  }
  function couponFromSnapshot(snapshot,typeKey,rows){
    const data=snapshot?.coupons?.[typeKey];
    if(!data||data.error) return null;
    const byLeg=new Map(arr(rows).map(r=>[num(r?.leg),r]));
    const legs=[];
    for(const savedLeg of arr(data.legs).slice().sort((a,b)=>num(a?.leg)-num(b?.leg))){
      const legNo=num(savedLeg?.leg),race=byLeg.get(legNo);
      if(!race||!arr(savedLeg?.picks).length) return null;
      const picks=arr(savedLeg.picks).map(no=>arr(race.horses).find(h=>sameHorse(h?.horse_no,no))||{horse_no:str(no)});
      legs.push({x:{r:race},r:race,picks});
    }
    if(legs.length!==6||![1,2,3,4,5,6].every((leg,i)=>num(legs[i]?.r?.leg)===leg)) return null;
    const unit=num(data.unit,unitPrice(rows,6));
    const calculated=legs.reduce((total,leg)=>total*Math.max(1,arr(leg.picks).length),1)*unit;
    return {typeKey,legs,unit,cost:num(data.cost,calculated)||calculated,engine:'ARCHIVED_COUPON_SNAPSHOT',snapshotId:snapshot.id,snapshotSource:snapshot.source};
  }
  function predictionLogRaceKey(date,hip,altili,leg){
    return [str(date),str(hip).toLocaleUpperCase('tr-TR').replace(/\s+/g,' '),num(altili,1)||1,num(leg)].join('|');
  }
  function buildPredictionLogIndex(){
    const groups=new Map();
    for(const row of arr(global.db?.prediction_log).filter(item=>{
      if(item?.resolved!==1) return false;
      const predictedAt=Date.parse(str(item?.ts)),resolvedAt=Date.parse(str(item?.resolved_at));
      return !(Number.isFinite(predictedAt)&&Number.isFinite(resolvedAt)&&predictedAt>resolvedAt);
    })){
      const key=predictionLogRaceKey(row.race_date,row.hippodrome,row.altili_no,row.leg);
      if(!groups.has(key)) groups.set(key,new Map());
      const snapshots=groups.get(key);
      const fp=str(row.prediction_fp)||`${row.strategy_version||''}|${row.ts||''}`;
      if(!snapshots.has(fp)) snapshots.set(fp,[]);
      snapshots.get(fp).push(row);
    }
    const out=new Map();
    for(const [key,snapshots] of groups){
      const candidates=[...snapshots.values()].sort((a,b)=>String(b[0]?.ts||'').localeCompare(String(a[0]?.ts||'')));
      if(candidates[0]?.length) out.set(key,candidates[0]);
    }
    return out;
  }
  function predictionRowsForRace(race,index){
    if(!index) return [];
    let altili=num(race?.altili_no,0);
    if(!altili){
      const file=arr(global.db?.files).find(item=>String(item?.id)===String(race?.file_id));
      altili=num(file?.altili_no,1)||1;
    }
    return index.get(predictionLogRaceKey(race?.race_date,race?.hippodrome,altili,race?.leg))||[];
  }
  function datasetKey(limit,budgets){
    try{
      // Back Test cache'i tkp:db-changed olayında zaten temizlenir. Yan bahis
      // performance imzası prediction_log'un 33K+ satırını ilk tıklamada taradığı
      // için burada yalnız O(1) DB revizyon imzası gerekir.
      if(typeof global.tkpFastDbSignature==='function'){
        const runtimeSignature=global.tkpFastDbSignature(global.db);
        if(runtimeSignature){
          const b=budgets||{};
          const resetStart=String(global.db?.settings?.live_final_backtest?.startsAt||'2026-08-23').slice(0,10);
          return ['FASTREV',resetStart,runtimeSignature,num(limit,50),num(b.main),num(b.alt),num(b.surprise)].join('|');
        }
      }
    }catch(_){ }
    const d=global.db||{};
    const files=arr(d.files), races=arr(d.races), bets=arr(d.bets);
    let resultRaces=0, horseCount=0, placedCount=0, payoutCount=0, offeredCount=0;
    // KÖK SONUÇ/İKRAMİYE CACHE FIX: Önceki anahtar yalnız kazanan bulunan yarış
    // sayısını içeriyordu. Eski kayıtta kazanan zaten varken sonradan TJK ikramiyesi
    // ve available_bets eklenirse anahtar değişmiyor, Back Test eski "0 resmî / yan
    // bahis yok" sonucunu göstermeye devam edebiliyordu. Artık derece, ikramiye,
    // kombinasyon, tutar ve resmi bahis listesi hafif bir FNV imzasına katılır.
    let resultSignature=2166136261>>>0;
    const mix=value=>{
      const text=str(value);
      for(let i=0;i<text.length;i++){
        resultSignature^=text.charCodeAt(i);
        resultSignature=Math.imul(resultSignature,16777619)>>>0;
      }
    };
    for(const r of races){
      const horses=arr(r?.horses);
      horseCount+=horses.length;
      let hasWinner=false;
      for(const h of horses){
        const pos=num(h?.finish_position,0),win=Number(h?.winner)===1;
        if(win||pos===1) hasWinner=true;
        if(win||pos>0){ placedCount++; mix(`${r?.file_id}|${r?.leg}|${h?.horse_no}|${pos}|${win?1:0}`); }
      }
      if(hasWinner) resultRaces++;
      const payouts=arr(r?.payouts);
      payoutCount+=payouts.length;
      for(const entry of payouts) mix(`${r?.file_id}|${r?.leg}|${entry?.key}|${entry?.combo}|${entry?.amount}|${entry?.rollover?1:0}`);
      const offered=arr(r?.available_bets);
      offeredCount+=offered.length;
      for(const key of offered) mix(`${r?.file_id}|${r?.leg}|${key}`);
    }
    return [VERSION,String(d?.settings?.live_final_backtest?.startsAt||'2026-08-23').slice(0,10),files.length,races.length,horseCount,bets.length,arr(d.prediction_log).length,arr(d.auto_coupon_log).length,resultRaces,placedCount,payoutCount,offeredCount,resultSignature,limit,num(budgets?.main),num(budgets?.alt),num(budgets?.surprise)].join('|');
  }
  function unitPrice(rows,legCount){
    try{
      if(typeof global.ganyanUnitPrice === 'function') return num(global.ganyanUnitPrice(rows?.[0]?.hippodrome,legCount),2) || 2;
    }catch(_){ }
    return 2;
  }
  function frozenVisibleTkp(h){
    for(const key of ['pre_race_tkp_score','prediction_score_snapshot','tkp_display_score_snapshot','score']){
      const v=Number(h?.[key]);if(Number.isFinite(v)&&v>=0)return v;
    }
    return -1;
  }
  function applyBmbRescueSwapFast(legs){
    // Canlı BMB rescue ile aynı politika: 12+ at, frozen TKP 5-6 BMB, 1:1 swap.
    // TEK/pick count/bütçe/TKP alanları değişmez.
    for(const leg of arr(legs)){
      const picks=arr(leg?.picks);if(picks.length<=1)continue;
      const race=leg?.r||leg?.x?.r||{};
      const live=arr(race?.horses).filter(h=>!nonRunner(h));if(live.length<12)continue;
      const visible=live.slice().sort((a,b)=>frozenVisibleTkp(b)-frozenVisibleTkp(a)||num(b?.altili_winner_score)-num(a?.altili_winner_score));
      const rank=new Map(visible.map((h,i)=>[str(h?.horse_no),i+1])), selected=new Set(picks.map(h=>str(h?.horse_no??h)));
      const rescue=visible.find(h=>{const rnk=rank.get(str(h?.horse_no))||999;return rnk>=5&&rnk<=6&&Number(h?.bmb)===1&&!selected.has(str(h?.horse_no));});
      if(!rescue)continue;
      const removable=picks.map((h,i)=>({h,i,rank:rank.get(str(h?.horse_no??h))||999})).filter(z=>Number(z.h?.bmb)!==1&&!odbLike(z.h)).sort((a,b)=>b.rank-a.rank||frozenVisibleTkp(a.h)-frozenVisibleTkp(b.h))[0];
      if(!removable)continue;
      const next=picks.slice();next[removable.i]=rescue;leg.picks=next;leg.bmbRescueSwap={out:str(removable.h?.horse_no),in:str(rescue?.horse_no),rank:rank.get(str(rescue?.horse_no))||0};
    }
    return legs;
  }
  function fallbackSingleDifficulty(x){
    const live=arr(x?.scored).filter(h=>!nonRunner(h));
    if(!live.length) return 100;
    const agf=live.slice().sort((a,b)=>num(b?.agf)-num(a?.agf));
    const a1=num(agf[0]?.agf),a2=num(agf[1]?.agf),top3=agf.slice(0,3).reduce((n,h)=>n+num(h?.agf),0);
    const visible=live.slice().sort((a,b)=>frozenVisibleTkp(b)-frozenVisibleTkp(a));
    const v1=frozenVisibleTkp(visible[0]),v2=frozenVisibleTkp(visible[1]);
    const condition=str(x?.r?.condition_family||x?.r?.condition_text).toLocaleUpperCase('tr-TR');
    let risk=0;
    risk+=a1>0?(a1<12?28:a1<18?21:a1<25?12:3):15;
    risk+=(a1>0&&a2>0)?((a1-a2)<3?18:(a1-a2)<7?10:2):8;
    risk+=top3>0?(top3<38?18:top3<50?10:3):8;
    risk+=(v1>=0&&v2>=0)?((v1-v2)<.08?12:(v1-v2)<.20?7:2):5;
    risk+=live.length>=14?10:live.length>=10?6:2;
    if(/HAND[İI]KAP|MA[İI]DEN|ŞARTLI/.test(condition)) risk+=7;
    return Math.max(0,Math.min(100,risk));
  }
  function fallbackCanonicalSingleMap(rr,typeKey){
    const rows=arr(rr).map((x,legIndex)=>{
      const live=arr(x?.scored).filter(h=>!nonRunner(h)).slice();
      if(!live.length) return null;
      const explicitVisible=h=>{
        for(const key of ['pre_race_tkp_score','prediction_score_snapshot','tkp_display_score_snapshot']){
          const v=Number(h?.[key]);if(Number.isFinite(v)&&v>=0)return v;
        }
        return null;
      };
      const hasExplicit=live.some(h=>explicitVisible(h)!=null);
      if(hasExplicit){
        live.sort((a,b)=>num(explicitVisible(b),-1)-num(explicitVisible(a),-1)
          ||num(b?.altili_winner_score)-num(a?.altili_winner_score)
          ||num(b?.v27_backtest_score)-num(a?.v27_backtest_score)
          ||TKP_TR_COLLATOR_NUM.compare(str(a?.horse_no),str(b?.horse_no)));
      }
      // Açık frozen görünür TKP alanı yoksa x.scored zaten CURRENT_LOCKED_SNAPSHOT
      // sırasıdır. Ham score ile yeniden sıralamak kilitli yarış-öncesi sırayı bozardı.
      const h=live[0],second=live[1]||null;
      // Back Test'in toplu replay yolu canlı dynamicSingleDecision çağrısını her
      // tarihsel ayakta yeniden çalıştırmaz. Kilitli yarış-öncesi güven/skor zaten
      // snapshotta vardır; onu okumak aynı geçmişi onlarca kez tarayan zinciri keser.
      const confidence=num(h?.altili_winner_score,num(h?.v27_backtest_score,num(h?.score,0)));
      return {x,legIndex,h,visibleTkp:explicitVisible(h)!=null?explicitVisible(h):num(h?.v27_backtest_score,confidence),confidence,risk:fallbackSingleDifficulty(x)};
    }).filter(Boolean).sort((a,b)=>num(b?.visibleTkp)-num(a?.visibleTkp)
      ||num(b?.confidence)-num(a?.confidence)||a.legIndex-b.legIndex);
    if(!rows.length) return new Map();
    if(typeKey==='surprise'){
      // Uzman/Kulis motoru yüklenmemiş bağımsız Back Test ortamında güvenli tek aday.
      // Yalnız yarış-öncesi sıralama ve güven kullanılır; sonuç/ikramiye okunmaz.
      const best=rows.slice(0,5).sort((a,b)=>(num(b?.confidence)-.20*num(b?.risk))-(num(a?.confidence)-.20*num(a?.risk))
        ||num(b?.visibleTkp)-num(a?.visibleTkp)||a.legIndex-b.legIndex)[0];
      return best?new Map([[best.legIndex,best.h]]):new Map();
    }
    const count=typeKey==='main2'?2:1;
    const band=rows.slice(0,typeKey==='main2'?4:3).sort((a,b)=>(num(b?.confidence)-.25*num(b?.risk))-(num(a?.confidence)-.25*num(a?.risk))
      ||num(b?.visibleTkp)-num(a?.visibleTkp)||a.legIndex-b.legIndex);
    const map=new Map();
    for(const z of band.slice(0,count)) map.set(z.legIndex,z.h);
    if(map.size<count){ for(const z of rows){if(map.size>=count)break;if(!map.has(z.legIndex))map.set(z.legIndex,z.h);} }
    return map;
  }

  function makeCoupon(rr,typeKey,budgetTL,singleOverview=null){
    const legCount=Math.min(6,arr(rr).length);
    const unit=unitPrice(arr(rr).map(x=>x.r),legCount);
    const defaultBudget=typeof global.tkpCouponBudgetFor==='function'?global.tkpCouponBudgetFor(undefined,typeKey==='surprise'?'expert':'main'):1200;
    const effectiveBudget=typeKey==='alt'&&num(budgetTL)<=0?num(global.db?.settings?.last_coupon_budgets?.alt,defaultBudget):num(budgetTL,defaultBudget);
    const inputCap=typeof global.tkpCouponBudgetFor==='function'
      ?global.tkpCouponBudgetFor(effectiveBudget,typeKey==='surprise'?'expert':'main')
      :Math.min(1400,Math.max(700,effectiveBudget));
    let budget=inputCap;
    // Canlı bütçe hedefi bütün sıralama/öğrenme zincirini yeniden çağırır. Replay
    // ekranı kullanıcının girdiği sabit tavanı değerlendirir; canlı kupon üretimi
    // kendi adaptif bütçe motorunu kullanmaya devam eder.
    budget=Math.max(unit,budget);
    const maxCombos=Math.max(1,Math.floor((budget+1e-9)/Math.max(.0001,unit)));
    // KÖK FIX (Back Test "Tek yok" her yarışta): Canlı kuponda TEK, YALNIZCA
    // dynamicSingleDecision() %70 eşiğinden gelmiyor. Asıl TEK kararını veren
    // forcedSinglePickMap() -- toplantıdaki 6 ayağı birlikte değerlendirip "İlk
    // Bakış" değer puanına göre EN GÜÇLÜ ayağı seçiyor; o ayak %70'i geçmese
    // bile (ör. %60 güven) eşiğe en yakın/en güçlü aday olarak yine TEK olabiliyor.
    // Eski Back Test motoru bu fonksiyonu hiç çağırmıyordu (yalnız katı %70 kuralına
    // bakıyordu), bu yüzden gerçek ekranda TEK çıkan ayaklar (ör. İzmir son ayak
    // %60) Back Test'te hiç görünmüyordu. Artık canlı motordaki AYNI fonksiyon
    // AYNI 6 ayak kümesiyle çağrılıyor; forced ayak, kapsama optimizasyonuna
    // sokulmadan doğrudan tek ata sabitleniyor (minimumCostCoverage'daki
    // 'forced' dalıyla birebir aynı davranış).
    const strategyName=typeKey==='main'?'normal':(typeKey==='main2'?'normal2':(typeKey==='alt'?'wide':'surprise'));
    // Toplu Back Test için tek kararını frozen sıra/güvenden O(6 ayak) kur. Canlı
    // forcedSinglePickMap/overview zinciri 503 arşivde aynı öğrenme tablolarını
    // yeniden tarayıp tek bir toplantıda dahi saniyelerce UI blokluyordu.
    let forcedSingleMap=fallbackCanonicalSingleMap(arr(rr).slice(0,legCount),typeKey);
    const requiredSingles=typeKey==='main2'?2:((typeKey==='main'||typeKey==='surprise')?1:0);
    if(requiredSingles && forcedSingleMap.size<requiredSingles){
      const fallback=fallbackCanonicalSingleMap(arr(rr).slice(0,legCount),typeKey);
      for(const [i,h] of fallback){if(forcedSingleMap.size>=requiredSingles)break;if(!forcedSingleMap.has(i)&&h)forcedSingleMap.set(i,h);}
    }
    const prepared=arr(rr).slice(0,legCount).map((x,legIndex)=>{
      // raceResultsFromRowsFast zaten kilitli yarış-öncesi sıra üretir. Toplu
      // replay içinde canlı Uzman/Portföy sıralamasını yeniden çağırmak, model
      // eğitimini 6 ayak x toplantı kadar tekrarlayıp ana thread'i kilitliyordu.
      // Üç kuponun ayrımı aşağıdaki kapsama/decay/BMB-ODB politikalarında kalır.
      let ordered=arr(x.scored);
      ordered=arr(ordered).filter(h=>!nonRunner(h)).slice(0,10);
      const field=Math.max(2,ordered.length);
      const top=ordered[0]||{},second=ordered[1]||{};
      const forcedHorse=forcedSingleMap.get(legIndex)||null;
      if(forcedHorse){
        // Canlı motordaki 'forced' dalı: kapsama optimizasyonuna hiç girmeden
        // bu ayak doğrudan tek ata sabitlenir.
        const forcedIdx=ordered.findIndex(h=>sameHorse(h?.horse_no,forcedHorse?.horse_no));
        if(forcedIdx>0){ ordered=[ordered[forcedIdx],...ordered.filter((_,i)=>i!==forcedIdx)]; }
        else if(forcedIdx<0){ ordered=[forcedHorse,...ordered]; }
        return {x,ordered,options:[{count:1,utility:0}]};
      }
      // TOMMY exact-2 kilidi: portföy forcedSinglePickMap mevcutken yerel
      // dynamicSingleDecision ekstra 3. TEK üretemez. Back Test canlı kuponla aynıdır.
      let reliable=false;
      if((typeKey==='main'||typeKey==='main2') && typeof global.forcedSinglePickMap!=='function' && typeof global.dynamicSingleDecision==='function'){
        try{
          const decision=global.dynamicSingleDecision({r:x.r,scored:x.scored,strictPool:ordered},top,second);
          reliable=!!decision?.isSingle;
        }catch(_){ reliable=false; }
      }
      const condition=str(x?.r?.condition_family||x?.r?.condition_text).toLocaleUpperCase('tr-TR');
      const agfTop=num(arr(x?.r?.horses).filter(h=>!nonRunner(h)).sort((a,b)=>num(b?.agf)-num(a?.agf))[0]?.agf,0);
      let decay=(typeKey==='main'||typeKey==='main2') ? .34 : (typeKey==='alt' ? .26 : .22);
      if(/HANDİKAP|MAIDEN|ŞARTLI/.test(condition)||agfTop<18||field>=12) decay-=.05;
      const masses=ordered.map((horse,index)=>{
        let mass=Math.exp(-Math.max(.10,decay)*index);
        if(typeKey==='surprise'){
          // Uzman + Kulis replay'i yalnız snapshotta taşınan yarış-öncesi kanıtı
          // okur; canlı evidence motorunu çağırıp bütün geçmişi yeniden taramaz.
          const kulis=Math.max(0,num(horse?.x_kulis_score,num(horse?.x_ypuan_delta,0)));
          const support=Math.max(0,num(horse?.support_count,num(horse?.expert_support_count,0)));
          mass*=1+Math.min(.35,kulis/300+support*.025);
        }
        // V1.1.323 DÜZELTME (kullanıcı kanıtı): V1.1.323'te BMB=1 atların kazanma
        // OLASILIĞINI artırmadığı (bazı AGF diliminde azalttığı bile) gösterilerek boost
        // kaldırılmıştı -- ama bu yalnız "hangi at kazanır" sorusunu ölçtü, Altılı'nın asıl
        // ekonomisini (olasılık × ikramiye) değil. Gerçek arşivde (470 tam sonuçlanmış
        // toplantı, rollover hariç) kazanan 6 attan biri BMB/ODB'liyse ortalama ikramiye
        // 330.984 TL, değilse 50.985 TL -- 6.5x fark, medyanda 4.2x (37.776 TL vs 8.925 TL).
        // BMB/ODB nadiren kazanıyor ama kazandığında getiriyi katlıyor; kapsamdan
        // düşürülmemesi (boost'un kupon genişliğinde onu tutması) ekonomik olarak doğru.
        // BMB tekrar dahil edildi.
        if((typeKey==='surprise'||typeKey==='alt')&&(Number(horse?.bmb)===1||odbLike(horse))) mass*=1.12;
        return mass;
      });
      const total=Math.max(.000001,masses.reduce((sum,value)=>sum+value,0));
      const options=[];
      let covered=0;
      const minCount=reliable?1:Math.min(2,field);
      for(let count=1;count<=field;count++){
        covered+=masses[count-1]||0;
        if(count<minCount) continue;
        const probability=Math.max(.000001,Math.min(.999999,covered/total));
        options.push({count,utility:Math.log(probability)});
      }
      return {x,ordered,options};
    });
    let states=new Map([[1,{utility:0,counts:[]}]]);
    for(const item of prepared){
      const next=new Map();
      for(const [product,state] of states) for(const option of item.options){
        const newProduct=product*option.count;
        if(newProduct>maxCombos) continue;
        const utility=state.utility+option.utility;
        const old=next.get(newProduct);
        if(!old||utility>old.utility+1e-12) next.set(newProduct,{utility,counts:state.counts.concat(option.count)});
      }
      states=next;
    }
    let best=null;
    for(const [product,state] of states){
      if(!best||state.utility>best.utility+1e-12||(Math.abs(state.utility-best.utility)<=1e-12&&product<best.product)) best={...state,product};
    }
    const counts=best?.counts||prepared.map(item=>item.options[0]?.count||1);
    const legs=prepared.map((item,index)=>({x:item.x,r:item.x.r,picks:item.ordered.slice(0,counts[index])}));
    if(typeKey==='main'||typeKey==='main2'||typeKey==='surprise') applyBmbRescueSwapFast(legs);
    const comboCount=counts.reduce((total,count)=>total*Math.max(1,count),1);
    return {typeKey,legs,unit,cost:comboCount*unit,budgetTL:budget,maxBudgetTL:inputCap,engine:VERSION,columnOptimization:'FAST_JOINT_LOG_COVERAGE_DP'};
  }
  function evaluateCoupon(coupon,sourceRows){
    // Altılı başarı yalnız tam 6 ayakla ölçülür. Eski motor 3-5 ayaklık eksik
    // toplantıyı da "full" sayabildiği için önce burada kesin sınır konur.
    if(!coupon || arr(coupon.legs).length!==6) return null;
    if(typeof global._v24EvaluateCoupon === 'function'){
      try{
        const legacy=global._v24EvaluateCoupon(coupon,sourceRows);
        if(legacy && Number(legacy.known)===6) return {...legacy,full:Number(legacy.hit)===6};
      }catch(_){ }
    }
    let hit=0,known=0,singles=0,singleHit=0,lastLegHit=false;
    const legHits=[];
    const sourceByLeg=new Map(arr(sourceRows).map(r=>[str(num(r?.leg)),r]));
    for(const leg of arr(coupon.legs)){
      const legNo=leg?.x?.r?.leg ?? leg?.r?.leg ?? leg?.race?.leg;
      const race=sourceByLeg.get(str(num(legNo))) || leg?.r || leg?.x?.r || null;
      const winners=arr(race?.horses).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
      if(!winners.length){ legHits.push(null); continue; }
      known++;
      const picks=arr(leg.picks);
      // Atbaşı/çoklu kazanan varsa kupondaki herhangi bir resmi kazanan kabul edilir.
      const ok=picks.some(h=>winners.some(winner=>sameHorse(h?.horse_no ?? h,winner.horse_no)));
      legHits.push(ok);
      if(ok) hit++;
      if(leg===coupon.legs[coupon.legs.length-1]) lastLegHit=ok;
      if(picks.length===1){ singles++; if(ok) singleHit++; }
    }
    let trailingHit=0;
    for(let i=legHits.length-1;i>=0;i--){ if(legHits[i]===true) trailingHit++; else break; }
    return {hit,known,trailingHit,full:known===6&&hit===6,lastLegHit,singles,singleHit,cost:num(coupon.cost)};
  }
  function couponLegDetail(coupon,sourceRows){
    const sourceByLeg=new Map(arr(sourceRows).map(r=>[str(num(r?.leg)),r]));
    return arr(coupon?.legs).map(leg=>{
      const legNo=leg?.x?.r?.leg ?? leg?.r?.leg ?? leg?.race?.leg;
      const race=sourceByLeg.get(str(num(legNo))) || leg?.r || leg?.x?.r || null;
      const winners=arr(race?.horses).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
      const picks=arr(leg?.picks).map(h=>str(h?.horse_no??h)).filter(Boolean);
      const hit=winners.length ? picks.some(no=>winners.some(winner=>sameHorse(no,winner.horse_no))) : null;
      return {leg:num(legNo),picks,winner:winners.map(winner=>str(winner.horse_no)).join(','),hit};
    });
  }
  function comboLegOptions(entry){
    return str(entry?.combo).split('/').map(segment=>segment.split(',').map(s=>s.trim()).filter(Boolean)).filter(options=>options.length);
  }
  function selectionPayoutWinningLineCount(selection,entry){
    const legs=comboLegOptions(entry);
    const pools=arr(selection);
    if(!legs.length||legs.length!==pools.length)return 0;
    let lines=1;
    for(let i=0;i<legs.length;i++){
      const matched=[];
      for(const no of legs[i]){
        if(arr(pools[i]).some(p=>sameHorse(p,no))&&!matched.some(x=>sameHorse(x,no)))matched.push(no);
      }
      if(!matched.length)return 0;
      lines*=matched.length;
    }
    return lines;
  }
  function orderedCouponLegs(coupon){
    return arr(coupon?.legs).slice().sort((a,b)=>{
      const al=num(a?.x?.r?.leg ?? a?.r?.leg ?? a?.race?.leg);
      const bl=num(b?.x?.r?.leg ?? b?.r?.leg ?? b?.race?.leg);
      return al-bl;
    });
  }
  function comboHit(coupon,entry){
    const winLegs=comboLegOptions(entry);
    const legs=orderedCouponLegs(coupon);
    if(!winLegs.length || winLegs.length!==legs.length) return false;
    return legs.every((leg,i)=>arr(leg.picks).some(h=>winLegs[i].some(no=>sameHorse(h?.horse_no ?? h,no))));
  }
  function realReturn(coupon,race,betKey){
    try{
      if(typeof global.realReturnForCoupon === 'function') return global.realReturnForCoupon(coupon,race,betKey);
    }catch(_){ }
    const entry=arr(race?.payouts).find(p=>p?.key===betKey);
    if(!entry) return {cost:num(coupon?.cost),ret:0,known:false};
    if(entry.rollover) return {cost:num(coupon?.cost),ret:0,known:true,rollover:true,payoutAmount:null,payoutCombo:entry.combo};
    const selection=orderedCouponLegs(coupon).map(leg=>arr(leg.picks).map(h=>h?.horse_no??h));
    const winningLines=selectionPayoutWinningLineCount(selection,entry);
    const hit=winningLines>0;
    return {cost:num(coupon?.cost),ret:hit?num(entry.amount)*winningLines:0,known:true,hit,payoutAmount:num(entry.amount),payoutCombo:entry.combo,matchedPayouts:winningLines};
  }
  function winNo(race,position){
    const h=arr(race?.horses).find(item=>Number(item?.finish_position)===position || (position===1 && Number(item?.winner)===1));
    return h ? str(h.horse_no) : '';
  }
  function payoutEntry(race,keys){ return arr(race?.payouts).find(entry=>arr(keys).includes(entry?.key)) || null; }
  function raceOffers(race,keys){
    const offered=arr(race?.available_bets).map(value=>{
      if(typeof global.tkpCanonicalBetKey==='function') return global.tkpCanonicalBetKey(value);
      const key=str(value).toLocaleLowerCase('tr-TR')
        .replace(/[ç]/g,'c').replace(/[ğ]/g,'g').replace(/[ı]/g,'i')
        .replace(/[ö]/g,'o').replace(/[ş]/g,'s').replace(/[ü]/g,'u')
        .replace(/['’`´]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
      if(key.includes('sirali_ikili')) return 'sirali_ikili';
      if(/^(?:\d+_)?cifte(?:_\d+)?$/.test(key)||key.includes('_cifte')) return 'cifte';
      if(key.includes('sirali_5li')||key.includes('sirali_5_li')) return 'sirali_5li';
      if(key.includes('sirali_uclu')) return 'sirali_uclu';
      if(key.includes('uclu_bahis')) return 'uclu_bahis';
      if(key.includes('tabela')) return key.includes('sirasiz')?'tabela_sirasiz':'tabela';
      return key;
    });
    return arr(keys).some(key=>offered.includes(key));
  }
  function permCountLocal(pools){
    if(typeof global.permCount === 'function'){
      try{ return num(global.permCount(pools),0); }catch(_){ }
    }
    return arr(pools).reduce((n,pool)=>n*Math.max(1,arr(pool).length),1);
  }
  function sideBetUnits(){
    return global.SIDE_BET_UNITS || {ikili:1, sirali:1, uclu:2, dortlu:1.5, cifte:1, sirali5li:1.25};
  }
  function combCountLocal(n,k){
    n=Math.floor(num(n,0)); k=Math.floor(num(k,0));
    if(k<0||n<k) return 0;
    if(k===0||n===k) return 1;
    k=Math.min(k,n-k);
    let out=1;
    for(let i=1;i<=k;i++) out=out*(n-k+i)/i;
    return Math.round(out);
  }
  function monthIndexFromDate(value){
    const s=str(value);
    const m=s.match(/^(\d{4})-(\d{2})/);
    if(!m) return null;
    const y=Number(m[1]), mo=Number(m[2]);
    if(!Number.isFinite(y)||!Number.isFinite(mo)||mo<1||mo>12) return null;
    return y*12 + (mo-1);
  }
  function monthLabelFromIndex(idx){
    if(!Number.isFinite(idx)) return 'Tarihsiz';
    const y=Math.floor(idx/12), m=(idx%12)+1;
    return `${y}-${String(m).padStart(2,'0')}`;
  }
  function emptyInvestAgg(){ return {meetings:0,hits:0,cost:0,ret:0,net:0,roi:0}; }
  function addInvestAgg(target,rec){
    target.meetings++;
    target.hits+=rec.hit?1:0;
    target.cost+=num(rec.cost);
    target.ret+=num(rec.ret);
  }
  function finalizeInvestAgg(target){
    target.net=num(target.ret)-num(target.cost);
    target.roi=target.cost ? target.net/target.cost*100 : 0;
    return target;
  }
  function buildRollingInvestment(records){
    const names=BACKTEST_COUPON_NAMES;
    const valid=arr(records).filter(r=>Number.isFinite(r.monthIndex));
    const maxIdx=valid.length ? Math.max(...valid.map(r=>r.monthIndex)) : null;
    const out={};
    for(const keyName of Object.keys(names)){
      out[keyName]={
        total:emptyInvestAgg(),
        last3:emptyInvestAgg(),
        last6:emptyInvestAgg(),
        ytd:emptyInvestAgg()
      };
    }
    for(const rec of arr(records)){
      const bucket=out[rec.couponKey];
      if(!bucket) continue;
      addInvestAgg(bucket.total,rec);
      if(maxIdx!=null && Number.isFinite(rec.monthIndex)){
        if(rec.monthIndex>=maxIdx-2) addInvestAgg(bucket.last3,rec);
        if(rec.monthIndex>=maxIdx-5) addInvestAgg(bucket.last6,rec);
        if(Math.floor(rec.monthIndex/12)===Math.floor(maxIdx/12)) addInvestAgg(bucket.ytd,rec);
      }
    }
    for(const couponKey of Object.keys(out)) for(const periodKey of Object.keys(out[couponKey])) finalizeInvestAgg(out[couponKey][periodKey]);
    out._maxMonth=maxIdx==null?'':monthLabelFromIndex(maxIdx);
    return out;
  }
  function poolsForRace(race,predictionIndex){
    // V54: canlı yan bahis router'ı ile Back Test aynı C/S pozisyon mimarisini kullanır.
    // C = yarış-öncesi kilitli COMMON/Champion sıra; S = ilgili pozisyon için kaydedilmiş SIDE sıra.
    const logged=predictionRowsForRace(race,predictionIndex);
    const rankings=fastPositionRankingsForRace(race,logged);
    const common=(currentLockedOrderForRace(race)||fastOrderForRace(race,logged)||[]).map(h=>str(h?.horse_no)).filter(Boolean);
    const side=position=>arr(rankings['p'+position]).map(h=>str(h?.horse_no)).filter(Boolean);
    return {common,side1:side(1),side2:side(2),side3:side(3),side4:side(4),side5:side(5)};
  }
  function betPoolsForRace(race,predictionIndex,betKey){
    const p=poolsForRace(race,predictionIndex),u=(v,n)=>uniqueBetNos(arr(v).slice(0,n));
    if(betKey==='cifte') return {p1:u(p.common,5)}; // COMMON 5
    if(betKey==='sirali_ikili') return {p1:u(p.common,5),p2:u(p.side2,5)}; // C-S 5x5
    if(betKey==='sirali_uclu') return {p1:u(p.common,5),p2:u(p.side2,6),p3:u(p.side3,7)}; // C-S-S 5x6x7
    if(betKey==='tabela') return {p1:u(p.common,3),p2:u(p.side2,5),p3:u(p.side3,6),p4:u(p.common,9)}; // C-S-S-C 3x5x6x9
    if(betKey==='sirali5li') return {p1:u(p.common,2),p2:u(p.side2,5),p3:u(p.side3,5),p4:u(p.common,6),p5:u(p.side5,8)}; // C-S-S-C-S 2x5x5x6x8
    return {p1:u(p.common,5),p2:u(p.side2,5),p3:u(p.side3,5),p4:u(p.common,7),p5:u(p.side5,9)};
  }
  function newMetric(){ return {ok:0,total:0,cost:0,financeCost:0,ret:0,payoutKnown:0,winningTickets:0,singles:0,singleHit:0,net:0,roi:0,records:[],
    // KÖK FIX (2026-08-12): Beşli/Dörtlü/Üçlü Ganyan, Altılı ile aynı 6 ayaklık skor
    // hesaplamasının alt kümesi olduğu için aynı leak/whale yoğunlaşma riskini taşıyor
    // (gerçek arşivde doğrulandı: Sürpriz Beşli'de tek 2 toplantı kazancın %98,7'sini
    // oluşturuyordu). Ana Altılı tablosundaki 'verified' alt-toplamla aynı mantık.
    verified:{ok:0,total:0,financeCost:0,ret:0,payoutKnown:0,winningTickets:0}}; }
  function recordSide(target,cost,hit,race,payoutKeys,meta={}){
    const actualCost=num(cost);
    target.total++;
    target.cost+=actualCost;
    if(hit) target.ok++;
    target.singles+=num(meta.singles);
    target.singleHit+=num(meta.singleHit);
    const entry=payoutEntry(race,payoutKeys);
    const payoutKnown=!!entry;
    const verifiedRecord=meta.scoreIntegrity==='LOCKED_VERIFIED';
    let ret=0;
    if(payoutKnown){
      target.payoutKnown++;
      target.financeCost+=actualCost;
      if(hit && !entry.rollover){
        const winningLines=Array.isArray(meta.selection)&&['besli','dortlu_ganyan','uclu_ganyan'].some(k=>arr(payoutKeys).includes(k))
          ? Math.max(1,selectionPayoutWinningLineCount(meta.selection,entry)) : 1;
        ret=num(entry.amount)*winningLines; target.ret+=ret; target.winningTickets+=winningLines;
      }
    }
    if(verifiedRecord){
      target.verified.total++;
      if(hit) target.verified.ok++;
      if(payoutKnown){
        target.verified.payoutKnown++; target.verified.financeCost+=actualCost;
        if(hit && !entry.rollover) { target.verified.ret+=ret; target.verified.winningTickets+=Math.max(1,Math.round(ret/Math.max(num(entry.amount),1e-9))); }
      }
    }
    const info=meetingInfo([race]);
    target.records.push({
      ...info,...meta,hit:!!hit,cost:actualCost,payoutKnown,rollover:!!entry?.rollover,
      payoutAmount:payoutKnown&&!entry?.rollover?num(entry?.amount):null,ret:payoutKnown?ret:null,
      net:payoutKnown?ret-actualCost:null,roi:payoutKnown&&actualCost?((ret-actualCost)/actualCost*100):null
    });
  }
  function addInvestment(data,names,couponKey,coupon,lastRace){
    const payout=realReturn(coupon,lastRace,'altili');
    if(!payout.known) return;
    const raceDate=str(lastRace?.race_date || lastRace?.date);
    const monthKey=/^\d{4}-\d{2}/.test(raceDate) ? raceDate.slice(0,7) : 'Tarihsiz';
    const yearKey=/^\d{4}/.test(raceDate) ? raceDate.slice(0,4) : 'Tarihsiz';
    const cost=num(payout.cost)||num(coupon.cost);
    const ret=num(payout.ret);
    const hit=!!payout.hit;
    for(const [granularity,periodKey] of [['month',monthKey],['year',yearKey]]){
      const store=data[granularity][couponKey];
      const row=store[periodKey] || (store[periodKey]={meetings:0,hits:0,cost:0,ret:0});
      row.meetings++; row.hits+=hit?1:0; row.cost+=cost; row.ret+=ret;
    }
    data.records.push({couponKey,date:raceDate,monthKey,yearKey,monthIndex:monthIndexFromDate(raceDate),hit,cost,ret});
  }
  function multiGanyanUnit(rows,legCount){
    try{
      if(typeof global.ganyanUnitPrice==='function') return num(global.ganyanUnitPrice(rows?.[0]?.hippodrome,legCount),2)||2;
    }catch(_){ }
    return legCount===5?1.5:(legCount===4?1.75:2);
  }
  function v54RankedOrderForShortGanyan(race,rankMode){
    const live=arr(race?.horses).filter(h=>!nonRunner(h)).slice();
    const field=rankMode==='strategy'?'_strategy_rank':'altili_winner_rank';
    const valid=live.filter(h=>num(h?.[field],0)>0);
    if(valid.length>=Math.min(2,live.length)){
      return live.sort((a,b)=>(num(a?.[field],999)-num(b?.[field],999))||TKP_TR_COLLATOR_NUM.compare(str(a?.horse_no),str(b?.horse_no)));
    }
    return currentLockedOrderForRace(race)||fastOrderForRace(race,[]);
  }
  function v54ShortGanyanTicket(rows,def){
    const target=arr(rows).slice(-def.legs); // KİLİT: 5'li son5, 4'lü son4, 3'lü son3
    if(target.length!==def.legs)return null;
    const legs=[];
    for(let i=0;i<target.length;i++){
      const race=target[i],order=v54RankedOrderForShortGanyan(race,def.rank);
      const nos=uniqueBetNos(arr(order).map(h=>str(h?.horse_no)).slice(0,def.widths[i]||1));
      if(!nos.length)return null;
      legs.push({r:race,picks:nos});
    }
    const unit=multiGanyanUnit(target,def.legs);
    const combinations=legs.reduce((n,l)=>n*Math.max(1,l.picks.length),1);
    return {legs,unit,combinations,cost:combinations*unit};
  }
  function couponSliceEndingAt(coupon,rows,endIndex,legCount){
    const target=arr(rows).slice(endIndex-legCount+1,endIndex+1);
    if(target.length!==legCount) return null;
    const byLeg=new Map(orderedCouponLegs(coupon).map(leg=>[str(num(leg?.x?.r?.leg??leg?.r?.leg??leg?.race?.leg)),leg]));
    const legs=[];
    for(const race of target){
      const source=byLeg.get(str(num(race?.leg)));
      if(!source || !arr(source.picks).length) return null;
      legs.push({r:race,picks:arr(source.picks)});
    }
    const unit=multiGanyanUnit(target,legCount);
    const combinations=legs.reduce((total,leg)=>total*Math.max(1,arr(leg.picks).length),1);
    return {legs,unit,cost:combinations*unit,combinations};
  }
  function* fastCoreGenerator(budgets,limit,precomputedKey=''){
    // REAL509 arşivinin son altı kaydını sessizce dışarıda bırakma. Görünüm/cache
    // anahtarları aynı veri imzasıyla çalışır; limit artışı yalnız eksik kapsamı açar.
    limit=Math.max(1,Math.min(509,num(limit,509)));
    const key=precomputedKey||datasetKey(limit,budgets);
    if(fastCache.has(key)){ const cached=fastCache.get(key); global.__tkpLastFastBacktestResult=cached; return cached; }

    const names=BACKTEST_COUPON_NAMES;
    function newAltMetric(){
      return {meetings:0,full:0,five:0,four:0,three:0,exact:[0,0,0,0,0,0,0],last:0,cost:0,financeCost:0,ret:0,payoutKnown:0,winningTickets:0,singles:0,singleHit:0,records:[],
        // Doğrulanmış (leak-free): prediction_score_locked=1 + yarış-öncesi frozen
        // snapshot taşıyan güncel veya tarihsel model kayıtlarından hesaplanan alt-toplam. ROI burada
        // gerçek dünyada tekrarlanabilir; ana alanlar (yukarıdaki) tüm test seti
        // içindir ve senaryo/tahmini toplantıları da içerir, tek başına ROI kaynağı
        // olarak kullanılmamalıdır.
        verified:{meetings:0,full:0,financeCost:0,ret:0,payoutKnown:0,winningTickets:0}};
    }
    const out={
      main:newAltMetric(),
      main2:newAltMetric(),
      alt:newAltMetric(),
      surprise:newAltMetric()
    };
    const side={
      cifte:newMetric(),
      sirali_ikili:newMetric(),
      sirali_uclu:newMetric(),
      tabela:newMetric(),
      sirali5li:newMetric(),
      uclu_ganyan_main:newMetric(), uclu_ganyan_alt:newMetric(), uclu_ganyan_surprise:newMetric(),
      dortlu_ganyan_main:newMetric(), dortlu_ganyan_alt:newMetric(), dortlu_ganyan_surprise:newMetric(),
      besli_main:newMetric(), besli_alt:newMetric(), besli_surprise:newMetric()
    };
    const investment={month:{main:{},alt:{},surprise:{}},year:{main:{},alt:{},surprise:{}},records:[],rolling:{}};
    // V54 (2026-08-12): Back Test havuzu artık YALNIZCA doğrulanmış toplantılardan
    // oluşur. Sonuç gelmiş olsa bile yarış öncesi skorlarının >=%80'i
    // prediction_score_locked=1 + gerçek frozen snapshot ile kilitlenmemiş toplantı,
    // senaryo/geriye dönük tahmin riski taşıdığı için Altılı, yan bahis, aylık özet,
    // maliyet, net ve ROI hesaplarının hiçbirine alınmaz. Limit de doğrulanmış havuz
    // oluşturulduktan sonra uygulanır; böylece doğrulanmamış kayıtlar son N kotasını
    // tüketemez.
    const allGroups=sortMeetingGroups(meetingGroups());
    // Snapshot indeksi filtrelemeden ÖNCE hazırlanır. Böylece gerçek sonuç +
    // immutable kupon kaydı olan bütün doğrulanmış toplantılar, eski skor kilidi
    // eksik olsa bile gerçek kupon Back Test'ine dahil edilir.
    const allSnapshotIndex=buildCouponSnapshotIndex(allGroups);
    const eligibility={total:allGroups.length,replayEligible:0,snapshotVerified:0,frozenScoreVerified:0,missingSnapshot:0,missingResult:0,heavyMissing:0,outsideReset:0};
    const verifiedGroups=[];
    let eligibilityScanned=0;
    for(const rows of allGroups){
      const six=completeSixLegRows(rows);
      const snapshot=six.length===6?couponSnapshotForRows(six,allSnapshotIndex):null;
      const snapshotVerified=couponSnapshotIsVerified(snapshot);
      const withinCurrentPeriod=typeof global.tkpBacktestWithinResetPeriod!=='function'||global.tkpBacktestWithinResetPeriod(rows);
      // Tarihsel kalibrasyon/otomatik snapshot kanıtı varsa toplantı doğrulanmıştır.
      // Eski reset sınırı bu satırları ana havuzdan tümüyle siliyor, dolayısıyla
      // "Tüm Zamanlar" sekmesi bile 0 gösteriyordu. Kanıtlı arşiv kaynakları
      // artık bu havuza girer; canlı terfi kapıları ayrı kalmaya devam eder.
      if(!withinCurrentPeriod&&!snapshotVerified)eligibility.outsideReset++;
      else if(six.length!==6||!six.every(raceHasWinner))eligibility.missingResult++;
      else if(six.some(race=>Number(race?.historical_training_excluded)===1))eligibility.heavyMissing++;
      else{
        const integrity=meetingLockIntegrity(six);
        if(snapshotVerified){
          eligibility.replayEligible++;eligibility.snapshotVerified++;verifiedGroups.push(rows);
        }else if(integrity.verified){
          // Eski arşivde kupon snapshotı yoksa yalnız gerçek frozen skorlar ile
          // senaryo replay'i sürer. Bu kayıt 'gerçek kupon' diye etiketlenmez.
          eligibility.replayEligible++;eligibility.frozenScoreVerified++;verifiedGroups.push(rows);
        }else eligibility.missingSnapshot++;
      }
      eligibilityScanned++;
      if((eligibilityScanned&7)===0)yield {phase:'eligibility',processed:eligibilityScanned,total:allGroups.length};
    }
    const groups=verifiedGroups.slice(-limit);
    const units=sideBetUnits();
    const predictionIndex=buildPredictionLogIndex();
    const snapshotIndex=buildCouponSnapshotIndex(groups);
    const predictionUsage={current:0,archive:0,fallback:0};
    const couponUsage={archived:0,scenario:0,meetingsWithSnapshot:0};
    let incompleteAltiliSkipped=0;

    let replayProcessed=0;
    for(const rows0 of groups){
      const rows=arr(rows0).slice().sort((a,b)=>num(a?.leg)-num(b?.leg));
      const rrAll=raceResultsFromRowsFast(rows,predictionIndex);
      for(const item of rrAll){if(item.source==='CURRENT_LOCKED_SNAPSHOT')predictionUsage.current++;else if(item.source==='ARCHIVE_CHRONO_SNAPSHOT')predictionUsage.archive++;else predictionUsage.fallback++;}

      // Altılı finans/başarı hesabı için 1-6 ayakların tamamı ve her ayakta resmi
      // kazanan zorunludur. Eksik toplantı yan bahislerde kullanılabilir ama Altılı
      // TUTTU/TUTMADI ve ROI sayacına hiçbir şekilde giremez.
      const altiliRows=completeSixLegRows(rows);
      const altiliReady=altiliRows.length===6 && altiliRows.every(raceHasWinner);
      const lockIntegrity=altiliReady?meetingLockIntegrity(altiliRows):null;
      let coupons=null;
      if(altiliReady){
        const rr=raceResultsFromRowsFast(altiliRows,predictionIndex);
        let liveBuilt=null;
        // Back Test ile canlı ekran aynı canonical kupon motorunu kullanır.
        // Gizli bir geliştirici bayrağına bağlı fallback performansı üretilmez.
        if(typeof global._v25BuildBacktestCoupons==='function'){
          try{
            if(global.TKP_BACKTEST_USE_LIVE_ENGINE!==false) liveBuilt=global._v25BuildBacktestCoupons(altiliRows,budgets);
          }catch(_){ liveBuilt=null; }
        }
        // Gerçek yarış-öncesi kupon varsa Back Test yalnız onu çözer. Böylece
        // algoritma bugün değişse bile geçmiş kuponun seçimleri/maliyeti değişmez.
        const snapshot=couponSnapshotForRows(altiliRows,snapshotIndex);
        const archivedSnapshot=couponSnapshotIsVerified(snapshot)?snapshot:null;
        const archivedCoupons=archivedSnapshot?{
          main:couponFromSnapshot(archivedSnapshot,'main',altiliRows),
          alt:couponFromSnapshot(archivedSnapshot,'alt',altiliRows),
          surprise:couponFromSnapshot(archivedSnapshot,'surprise',altiliRows)
        }:{};
        const singleOverview=null;
        if(archivedSnapshot){
          coupons=archivedCoupons;
          couponUsage.meetingsWithSnapshot++;
        }else coupons=liveBuilt?.coupons||{
          main:makeCoupon(rr,'main',budgets?.main,singleOverview),
          alt:makeCoupon(rr,'alt',budgets?.alt,singleOverview),
          surprise:makeCoupon(rr,'surprise',budgets?.surprise,singleOverview)
        };
        const lastRace=altiliRows[5];
        for(const keyName of Object.keys(names)){
          const coupon=coupons[keyName];
          if(!coupon) continue;
          if(coupon?.engine==='ARCHIVED_COUPON_SNAPSHOT') couponUsage.archived++; else couponUsage.scenario++;
          const e=evaluateCoupon(coupon,altiliRows);
          if(!e || e.known!==6) continue;
          const row=out[keyName];
          row.meetings++;
          row.full+=e.full?1:0;
          row.exact[Math.max(0,Math.min(6,Number(e.hit)||0))]++;
          row.five+=e.trailingHit>=5?1:0;
          row.four+=e.trailingHit>=4?1:0;
          row.three+=e.trailingHit>=3?1:0;
          row.last+=e.lastLegHit?1:0;
          row.cost+=num(e.cost);
          row.singles+=e.singles;
          row.singleHit+=e.singleHit;
          const payout=realReturn(coupon,lastRace,'altili');
          if(payout.known){ row.payoutKnown++; row.financeCost+=num(payout.cost)||num(coupon.cost); row.ret+=num(payout.ret); if(payout.hit) row.winningTickets++; }
          const info=meetingInfo(altiliRows);
          const legDetail=couponLegDetail(coupon,altiliRows);
          const financialCost=payout.known?(num(payout.cost)||num(coupon.cost)):null;
          const ret=payout.known?num(payout.ret):null;
          row.records.push({
            ...info,couponKey:keyName,status:e.full?'TUTTU':'TUTMADI',hit:!!e.full,hits:e.hit,known:e.known,
            couponEngine:coupon?.engine||VERSION,couponSnapshotId:coupon?.snapshotId||null,couponSnapshotSource:coupon?.snapshotSource||null,
            legDetail,singles:e.singles,singleHit:e.singleHit,cost:num(coupon.cost),payoutKnown:!!payout.known,payoutHit:payout.known?!!payout.hit:null,
            payoutAmount:payout.known&&!payout.rollover?num(payout.payoutAmount):null,payoutCombo:str(payout.payoutCombo),
            rollover:!!payout.rollover,financeCost:financialCost,ret,
            net:payout.known?ret-financialCost:null,roi:payout.known&&financialCost?((ret-financialCost)/financialCost*100):null,
            scoreIntegrity:lockIntegrity?.verified?'LOCKED_VERIFIED':'UNVERIFIED_ESTIMATE',
            lockRatio:lockIntegrity?Math.round(lockIntegrity.ratio*1000)/1000:0
          });
          if(lockIntegrity?.verified){
            row.verified.meetings++;
            row.verified.full+=e.full?1:0;
            if(payout.known){ row.verified.payoutKnown++; row.verified.financeCost+=financialCost||0; row.verified.ret+=ret||0; if(payout.hit) row.verified.winningTickets++; }
          }
          addInvestment(investment,names,keyName,coupon,lastRace);
        }

        // V54: kısa Ganyanlar Altılı kuponundan kesilmez; her ürün bağımsız HIT-FIRST motorudur.
        // KİLİT: Beşli = SON 5, Dörtlü = SON 4, Üçlü = SON 3 koşu.
        const multiDefs=[
          {key:'besli',legs:5,prefix:'besli',widths:[5,3,3,3,3],rank:'strategy'},
          {key:'dortlu_ganyan',legs:4,prefix:'dortlu_ganyan',widths:[3,3,4,2],rank:'strategy'},
          {key:'uclu_ganyan',legs:3,prefix:'uclu_ganyan',widths:[5,4,1],rank:'altili'}
        ];
        for(const def of multiDefs){
          const sub=v54ShortGanyanTicket(altiliRows,def); if(!sub)continue;
          const endRace=altiliRows[altiliRows.length-1];
          const hit=sub.legs.every(leg=>{
            const winners=arr(leg.r?.horses).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
            return winners.length&&arr(leg.picks).some(no=>winners.some(w=>sameHorse(no,w.horse_no)));
          });
          const singleLegs=sub.legs.filter(leg=>arr(leg.picks).length===1);
          const singleHit=singleLegs.filter(leg=>{
            const winners=arr(leg.r?.horses).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
            return winners.some(w=>sameHorse(leg.picks[0],w.horse_no));
          }).length;
          recordSide(side[`${def.prefix}_main`],sub.cost,hit,endRace,[def.key],{
            leg:`${num(sub.legs[0]?.r?.leg)}-${num(sub.legs[sub.legs.length-1]?.r?.leg)}`,
            couponKey:'hitfirst',selection:sub.legs.map(leg=>arr(leg.picks)),actual:sub.legs.map(leg=>winNo(leg.r,1)),
            singles:singleLegs.length,singleHit,algorithm:`V54 HIT-FIRST ${def.widths.join('x')}`,
            scoreIntegrity:lockIntegrity?.verified?'LOCKED_VERIFIED':'UNVERIFIED_ESTIMATE'
          });
        }
      }else{
        incompleteAltiliSkipped++;
      }

      const prepared=rows.map(r=>({r,w1:winNo(r,1),w2:winNo(r,2),w3:winNo(r,3),w4:winNo(r,4),w5:winNo(r,5)}));
      for(const item of prepared){
        const {r,w1,w2,w3,w4,w5}=item;
        if(w1&&w2&&raceOffers(r,['sirali_ikili'])){
          const p=betPoolsForRace(r,predictionIndex,'sirali_ikili');
          recordSide(side.sirali_ikili,permCountLocal([p.p1,p.p2])*(units.sirali||1),poolHas(p.p1,w1)&&poolHas(p.p2,w2),r,['sirali_ikili'],{leg:num(r.leg),selection:[p.p1,p.p2],actual:[w1,w2],algorithm:'C-S 5x5'});
        }
        if(w1&&w2&&w3&&raceOffers(r,['sirali_uclu','uclu_bahis'])){
          const p=betPoolsForRace(r,predictionIndex,'sirali_uclu');
          recordSide(side.sirali_uclu,permCountLocal([p.p1,p.p2,p.p3])*(units.uclu||2),poolHas(p.p1,w1)&&poolHas(p.p2,w2)&&poolHas(p.p3,w3),r,['sirali_uclu','uclu_bahis'],{leg:num(r.leg),selection:[p.p1,p.p2,p.p3],actual:[w1,w2,w3],algorithm:'C-S-S 5x6x7'});
        }
        if(w1&&w2&&w3&&w4&&raceOffers(r,['tabela'])){
          const p=betPoolsForRace(r,predictionIndex,'tabela');
          const orderedHit=poolHas(p.p1,w1)&&poolHas(p.p2,w2)&&poolHas(p.p3,w3)&&poolHas(p.p4,w4);
          recordSide(side.tabela,permCountLocal([p.p1,p.p2,p.p3,p.p4])*(units.dortlu||1.5),orderedHit,r,['tabela'],{leg:num(r.leg),selection:[p.p1,p.p2,p.p3,p.p4],actual:[w1,w2,w3,w4],algorithm:'C-S-S-C 3x5x6x9'});
        }
        if(w1&&w2&&w3&&w4&&w5&&raceOffers(r,['sirali_5li'])){
          const p=betPoolsForRace(r,predictionIndex,'sirali5li');
          recordSide(side.sirali5li,permCountLocal([p.p1,p.p2,p.p3,p.p4,p.p5])*(units.sirali5li||2),poolHas(p.p1,w1)&&poolHas(p.p2,w2)&&poolHas(p.p3,w3)&&poolHas(p.p4,w4)&&poolHas(p.p5,w5),r,['sirali_5li'],{leg:num(r.leg),selection:[p.p1,p.p2,p.p3,p.p4,p.p5],actual:[w1,w2,w3,w4,w5],algorithm:'C-S-S-C-S 2x5x5x6x8'});
        }
      }
      for(let i=0;i<prepared.length-1;i++){
        const first=prepared[i], second=prepared[i+1];
        if(!first.w1 || !second.w1) continue;
        // Programda Çifte başlangıç koşusunda, resmi sonuç/ikramiye ise ikinci
        // koşuda işaretlenir. Sonraki koşunun yalnız program listesini kullanmak
        // yanlışlıkla bir sonraki çifti mevcut çifte bağlayabileceğinden kabul edilmez.
        if(!raceOffers(first.r,['cifte']) && !payoutEntry(second.r,['cifte'])) continue;
        const firstDoublePool=betPoolsForRace(first.r,predictionIndex,'cifte').p1, secondDoublePool=betPoolsForRace(second.r,predictionIndex,'cifte').p1;
        const hit=poolHas(firstDoublePool,first.w1)&&poolHas(secondDoublePool,second.w1);
        // TJK Çifte ikramiyesi çiftin ikinci koşu satırında yer alır. Aynı eküri
        // grubunun iki ortağı tek bahis seçimi sayılır; maliyet bu benzersiz havuzdan çıkar.
        recordSide(side.cifte, (firstDoublePool.length*secondDoublePool.length)*(units.cifte||1), hit, second.r, ['cifte'],{leg:`${num(first.r.leg)}-${num(second.r.leg)}`,selection:[firstDoublePool,secondDoublePool],actual:[first.w1,second.w1]});
      }
      replayProcessed++;
      yield {phase:'replay',processed:replayProcessed,total:groups.length};
    }
    for(const item of Object.values(side)){ item.net=item.ret-item.financeCost; item.roi=item.financeCost ? item.net/item.financeCost*100 : null; }
    for(const item of Object.values(out)){ item.net=item.ret-item.financeCost; item.roi=item.financeCost ? item.net/item.financeCost*100 : null; }
    investment.rolling=buildRollingInvestment(investment.records);
    const result={version:VERSION,limit,groupsTested:groups.length,verifiedOnly:true,excludedUnverified:Math.max(0,allGroups.length-verifiedGroups.length),eligibility,names,out,side,investment,predictionUsage,couponUsage,incompleteAltiliSkipped};
    fastCache.set(key,result);
    global.__tkpLastFastBacktestResult=result;
    if(fastCache.size>12){ const first=fastCache.keys().next().value; fastCache.delete(first); }
    return result;
  }
  function fastCore(budgets,limit,precomputedKey=''){
    const iterator=fastCoreGenerator(budgets,limit,precomputedKey);
    let step=iterator.next();
    while(!step.done)step=iterator.next();
    return step.value;
  }
  async function fastCoreAsync(budgets,limit,precomputedKey='',onProgress=null){
    const iterator=fastCoreGenerator(budgets,limit,precomputedKey);
    let step=iterator.next();
    while(!step.done){
      if(typeof onProgress==='function'){try{onProgress(step.value||{});}catch(_e){}}
      if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
      else if(typeof global.tkpYield==='function')await global.tkpYield();
      else await new Promise(resolve=>setTimeout(resolve,0));
      step=iterator.next();
    }
    return step.value;
  }
  function pctSpan(ok,total){
    const n=Math.max(0,num(total)),k=Math.max(0,num(ok));
    if(n<1) return `—`;
    const pct=Math.round(k/n*100);
    const color=k>0?'#16a34a':'#dc2626';
    return `<span style="color:${color} !important;font-weight:800;">%${pct}</span>`;
  }
  function singleSuccessHTML(item){
    const singles=num(item?.singles);
    const hits=num(item?.singleHit);
    if(!singles) return '<span class="tkpSingleSuccess emptySingle">Tek yok</span>';
    if(singles<1) return `<span class="tkpSingleSuccess"><b>—</b></span>`;
    const pct=Math.round(hits/singles*100);
    return `<span class="tkpSingleSuccess"><b>${hits}/${singles}</b> <small>(%${pct})</small></span>`;
  }
  function investmentHTML(data){
    const names=BACKTEST_COUPON_NAMES;
    const periodLabels={total:'Toplam',last3:'Son 3 ay',last6:'Son 6 ay',ytd:'Yıllık / Bu yıl'};
    const rolling=data?.rolling || {};
    const periodOrder=['total','last3','last6','ytd'];
    const summaryRows=[];
    for(const couponKey of Object.keys(names)){
      const bucket=rolling[couponKey] || {};
      for(const periodKey of periodOrder){
        const value=bucket[periodKey] || emptyInvestAgg();
        if(!value.meetings && periodKey!=='total') continue;
        const net=num(value.ret)-num(value.cost);
        const roi=value.cost ? 100*net/value.cost : 0;
        summaryRows.push(`<tr><td><b>${names[couponKey]}</b></td><td>${periodLabels[periodKey]}</td><td class="num">${value.meetings||0}</td><td class="num">${value.hits||0}</td><td class="num">${fmtTLLocal(value.cost)}</td><td class="num">${fmtTLLocal(value.ret)}</td><td class="num tkpMoney ${net>=0?'pos':'neg'}">${fmt2Local(net)} TL</td><td class="num tkpMoney ${roi>=0?'pos':'neg'}">%${fmt2Local(roi)}</td></tr>`);
      }
    }
    function periodDetail(couponKey,granularity,label,limitRows){
      const buckets=data?.[granularity]?.[couponKey] || {};
      const keys=Object.keys(buckets).sort().reverse().slice(0,limitRows);
      if(!keys.length) return '';
      const rows=keys.map(periodKey=>{
        const value=buckets[periodKey];
        const net=num(value.ret)-num(value.cost);
        const roi=value.cost ? 100*net/value.cost : 0;
        const avg=value.meetings ? value.cost/value.meetings : 0;
        return `<tr><td>${escLocal(periodKey)}</td><td class="num">${value.meetings}</td><td class="num">${value.hits}</td><td class="num">${fmtTLLocal(value.cost)}</td><td class="num">${fmtTLLocal(value.ret)}</td><td class="num">${fmtTLLocal(avg)}</td><td class="num tkpMoney ${net>=0?'pos':'neg'}">${fmt2Local(net)} TL</td><td class="num tkpMoney ${roi>=0?'pos':'neg'}">%${fmt2Local(roi)}</td></tr>`;
      }).join('');
      return `<details class="tkpInvestDetails"><summary>${names[couponKey]} ${label}</summary><div class="tableWrap compactBacktest tkpFitTable"><table><thead><tr><th>Dönem</th><th class="num">Toplantı</th><th class="num">Tuttu</th><th class="num">Yatırım</th><th class="num">Getiri</th><th class="num">Ort. Yatırım</th><th class="num">Net</th><th class="num">ROI</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    }
    function monthDetail(couponKey){ return periodDetail(couponKey,'month','aylık detay',18); }
    function yearDetail(couponKey){ return periodDetail(couponKey,'year','yıllık detay',8); }
    if(!summaryRows.length || !arr(data?.records).length){
      return `<div class="card tkpInvestCard"><h2 style="margin:0 0 5px;">💰 Gerçek Yatırım/Getiri Özeti</h2><p class="muted" style="margin:0;">Henüz gerçek ikramiye verisi yüklenmiş bir toplantı yok. Sonuç HTML'i yükledikçe bu panel otomatik dolacak.</p></div>`;
    }
    return `<div class="card tkpInvestCard"><h2 style="margin:0 0 5px;">💰 Gerçek Yatırım/Getiri Özeti</h2><p class="muted" style="margin:0 0 8px;">Gerçek yatırım gibi hesap: maliyet, resmi ikramiye, net ve ROI; toplam, son 3 ay, son 6 ay ve bu yıl ayrı gösterilir. Referans ay: <b>${escLocal(rolling._maxMonth||'—')}</b>.</p><div class="tableWrap compactBacktest tkpFitTable"><table><thead><tr><th>Kupon</th><th>Dönem</th><th class="num">Toplantı</th><th class="num">Tuttu</th><th class="num">Yatırım</th><th class="num">Getiri</th><th class="num">Net</th><th class="num">ROI</th><th class="num">Karar</th></tr></thead><tbody>${summaryRows.join('')}</tbody></table></div>${Object.keys(names).map(k=>monthDetail(k)+yearDetail(k)).join('')}</div>`;
  }
  function monthlyOverallHTML(result){
    // Tek bir aylık görünümde Back Test'in ürettiği bütün oyunlar toplanır:
    // 3 kupon tipi Altılı + 3/4/5'li Ganyanlar + bütün yan bahisler.
    // Aynı kaydı ikinci kez saymamak için eski investment.records havuzu değil,
    // doğrudan her özet metriğinin kendi kayıtları kullanılır.
    const sourceDefs=[
      {label:'Normal · Altılı',records:arr(result?.out?.main?.records)},
      {label:'Sürpriz · Altılı',records:arr(result?.out?.alt?.records)},
      {label:'Uzman + Kulis · Altılı',records:arr(result?.out?.surprise?.records)},
      {label:'Beşli Ganyan · HIT-FIRST',records:arr(result?.side?.besli_main?.records)},
      {label:'Dörtlü Ganyan · HIT-FIRST',records:arr(result?.side?.dortlu_ganyan_main?.records)},
      {label:'Üçlü Ganyan · HIT-FIRST',records:arr(result?.side?.uclu_ganyan_main?.records)},
      {label:'Çifte',records:arr(result?.side?.cifte?.records)},
      {label:'Sıralı İkili',records:arr(result?.side?.sirali_ikili?.records)},
      {label:'Üçlü Bahis',records:arr(result?.side?.sirali_uclu?.records)},
      {label:'Tabela / Dörtlü Bahis',records:arr(result?.side?.tabela?.records)},
      {label:'Sıralı 5’li',records:arr(result?.side?.sirali5li?.records)}
    ];
    const byMonth=new Map();
    const byMonthAndBet=new Map();
    const overall={tests:0,hits:0,official:0,cost:0,ret:0,singles:0,singleHit:0};
    const empty=()=>({tests:0,hits:0,official:0,cost:0,ret:0,singles:0,singleHit:0});
    const add=(target,record)=>{
      target.tests++;
      if(record?.hit) target.hits++;
      target.singles+=num(record?.singles);
      target.singleHit+=num(record?.singleHit);
      if(!record?.payoutKnown) return;
      target.official++;
      target.cost+=num(record?.financeCost ?? record?.cost);
      target.ret+=num(record?.ret);
    };
    for(const source of sourceDefs) for(const record of source.records){
        const rawDate=str(record?.date);
        const month=/^\d{4}-\d{2}/.test(rawDate) ? rawDate.slice(0,7) : 'Tarihsiz';
        if(!byMonth.has(month)) byMonth.set(month,empty());
        if(!byMonthAndBet.has(month)) byMonthAndBet.set(month,new Map());
        const detailMap=byMonthAndBet.get(month);
        if(!detailMap.has(source.label)) detailMap.set(source.label,empty());
        add(byMonth.get(month),record);
        add(detailMap.get(source.label),record);
        add(overall,record);
      }
    if(!overall.tests){
      return `<div class="card tkpMonthlyOverallCard"><h2 style="margin:0 0 5px;">📅 Back Test — Aylık Genel Özet</h2><p class="muted" style="margin:0;">Aylık özet oluşturmak için sonuçlu yarış verisi bulunamadı.</p></div>`;
    }
    const rowHTML=(label,value,isOverall=false)=>{
      const hasMoney=value.official>0;
      const net=num(value.ret)-num(value.cost);
      const roi=value.cost ? net/value.cost*100 : 0;
      const money=amount=>hasMoney?fmtTLLocal(amount):unknownMoney();
      return `<tr class="${isOverall?'tkpMonthlyOverallTotal':''}"><td>${isOverall?'<b>GENEL TOPLAM</b>':escLocal(label)}</td><td class="num">${value.tests}</td><td class="num">${value.official}</td><td class="num">${value.hits}</td><td class="num">${money(value.cost)}</td><td class="num">${money(value.ret)}</td><td class="num tkpMoney ${hasMoney?(net>=0?'pos':'neg'):''}"><b>${money(net)}</b></td><td class="num tkpMoney ${hasMoney?(roi>=0?'pos':'neg'):''}">${hasMoney?'%'+fmt2Local(roi):unknownMoney()}</td></tr>`;
    };
    const monthKeys=[...byMonth.keys()].sort().reverse();
    const monthRows=monthKeys.map(key=>rowHTML(key,byMonth.get(key))).join('');
    const latestKey=monthKeys.find(key=>key!=='Tarihsiz') || monthKeys[0];
    const latest=byMonth.get(latestKey)||empty();
    const latestNet=latest.ret-latest.cost;
    const latestRoi=latest.cost?latestNet/latest.cost*100:0;
    const latestSentence=latest.official
      ? `<b>${escLocal(latestKey)}</b> ayında resmi ikramiyesi bulunan <b>${latest.official}</b> oyunu sistem tahminiyle oynasaydın; toplam maliyet <b>${fmtTLLocal(latest.cost)}</b>, ikramiye <b>${fmtTLLocal(latest.ret)}</b>, net <b>${fmtTLLocal(latestNet)}</b> ve ROI <b>%${fmt2Local(latestRoi)}</b> olacaktı.`
      : `<b>${escLocal(latestKey)}</b> ayında ${latest.tests} oyun test edildi; ancak maliyet, ikramiye, net ve ROI hesaplamak için resmi ikramiye verisi bulunmuyor.`;
    const detailRowHTML=(label,value)=>{
      const hasMoney=value.official>0;
      const net=value.ret-value.cost;
      const roi=value.cost?net/value.cost*100:0;
      const money=amount=>hasMoney?fmtTLLocal(amount):unknownMoney();
      return `<tr><td><b>${escLocal(label)}</b></td><td class="num">${value.tests}</td><td class="num">${value.hits}</td><td class="num">${pctSpan(value.hits,value.tests)}</td><td class="num">${singleSuccessHTML(value)}</td><td class="num">${value.official}</td><td class="num">${money(value.cost)}</td><td class="num">${money(value.ret)}</td><td class="num tkpMoney ${hasMoney?(net>=0?'pos':'neg'):''}">${money(net)}</td><td class="num tkpMoney ${hasMoney?(roi>=0?'pos':'neg'):''}">${hasMoney?'%'+fmt2Local(roi):unknownMoney()}</td></tr>`;
    };
    const monthDetails=monthKeys.map((month,index)=>{
      const detailMap=byMonthAndBet.get(month)||new Map();
      const rows=sourceDefs.filter(source=>detailMap.has(source.label)).map(source=>detailRowHTML(source.label,detailMap.get(source.label))).join('');
      const monthTotal=byMonth.get(month)||empty();
      const monthNet=monthTotal.ret-monthTotal.cost;
      return `<details class="tkpMonthlyBetDetails" ${index===0?'open':''}><summary><b>${escLocal(month)}</b> — bahis ve kupon türü ayrıntısı <span>${monthTotal.tests} test · ${monthTotal.official} resmi oyun · net ${monthTotal.official?fmtTLLocal(monthNet):'hesaplanamadı'}</span></summary><div class="tableWrap compactBacktest tkpFitTable"><table><thead><tr><th>Bahis</th><th class="num">Test</th><th class="num">Tuttu</th><th class="num">%</th><th class="num" title="Tek başarısı">Tek</th><th class="num">Resmî</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th><th class="num">Karar</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    }).join('');
    return `<div class="card tkpMonthlyOverallCard" style="border-left:5px solid #315b7d;"><h2 style="margin:0 0 5px;">📅 Back Test — Aylık Genel Özet</h2><p class="muted tkpMonthlyNarrative" style="margin:0 0 8px;">${latestSentence}</p><div class="tableWrap compactBacktest tkpFitTable"><table><thead><tr><th>Ay</th><th class="num">Oyun/Test</th><th class="num">Resmi oyun</th><th class="num">Tuttu</th><th class="num">Maliyet</th><th class="num">İkramiye</th><th class="num">Net</th><th class="num">ROI</th><th class="num">Karar</th></tr></thead><tbody>${rowHTML('GENEL TOPLAM',overall,true)}${monthRows}</tbody></table></div><p class="muted" style="margin:7px 0;font-size:10.5px;">Her ay Altılı, Beşli, Dörtlü ve Üçlü Ganyan kuponlarıyla programda bulunan bütün yan bahisler birlikte toplanır. Parasal sonuçlar yalnız resmi TJK ikramiyesi bulunan oyunlardan hesaplanır.</p><div class="tkpMonthlyBetDetailList">${monthDetails}</div></div>`;
  }
  function unknownMoney(){ return '<span class="tkpBtUnknown" title="Resmî ikramiye verisi yok" aria-label="Resmî ikramiye verisi yok">—</span>'; }
  function periodMetricFromRecords(records,period,maxMonthIndex){
    const out={total:0,ok:0,near5:0,cost:0,payoutKnown:0,financeCost:0,ret:0,singles:0,singleHit:0,net:0,roi:null};
    for(const record of arr(records)){
      const date=str(record?.date||record?.race_date);
      const mi=monthIndexFromDate(date);
      let keep=true;
      if(period==='month') keep=Number.isFinite(mi)&&Number.isFinite(maxMonthIndex)&&mi===maxMonthIndex;
      else if(period==='last3') keep=Number.isFinite(mi)&&Number.isFinite(maxMonthIndex)&&mi>=maxMonthIndex-2&&mi<=maxMonthIndex;
      if(!keep) continue;
      out.total++; if(record?.hit)out.ok++; if(num(record?.hits)>=5)out.near5++; out.cost+=num(record?.cost);out.singles+=num(record?.singles);out.singleHit+=num(record?.singleHit);
      if(record?.payoutKnown){out.payoutKnown++;out.financeCost+=num(record?.financeCost??record?.cost);out.ret+=num(record?.ret);}
    }
    out.net=out.ret-out.financeCost;out.roi=out.financeCost?out.net/out.financeCost*100:null;return out;
  }
  function backtestMaxMonthIndex(result){
    let max=-Infinity;
    const lists=[result?.out?.main?.records,result?.out?.alt?.records,result?.out?.surprise?.records];
    for(const item of Object.values(result?.side||{}))lists.push(item?.records);
    for(const list of lists)for(const record of arr(list)){const mi=monthIndexFromDate(str(record?.date||record?.race_date));if(Number.isFinite(mi))max=Math.max(max,mi);}
    return Number.isFinite(max)?max:null;
  }
  function backtestPeriodSwitch(period){
    try{
      document.querySelectorAll('.tkpBacktestPeriodBody').forEach(el=>{el.style.display=el.dataset.period===period?'table-row-group':'none';});
      document.querySelectorAll('.tkpBacktestPeriodBtn').forEach(el=>{const active=el.dataset.period===period;el.classList.toggle('active',active);el.setAttribute('aria-pressed',active?'true':'false');});
    }catch(_){ }
  }
  global.tkpBacktestPeriodSwitch=backtestPeriodSwitch;
  function backtestWilsonLower(ok,total,z=1.96){
    const n=Math.max(0,num(total)),k=Math.max(0,Math.min(n,num(ok)));
    if(!n)return 0;
    const p=k/n,zz=z*z,den=1+zz/n;
    return Math.max(0,(p+zz/(2*n)-z*Math.sqrt((p*(1-p)+zz/(4*n))/n))/den);
  }
  function backtestDecision(item,kind='side'){
    const total=num(item?.total??item?.meetings),ok=num(item?.ok??item?.full);
    const rate=total?ok/total:0,lower=backtestWilsonLower(ok,total);
    const roi=Number.isFinite(Number(item?.roi))?Number(item.roi):null,pk=num(item?.payoutKnown);
    let label='TEMKİNLİ';
    if(total<MIN_PERCENT_SAMPLE) label='TEMKİNLİ';
    else if(kind==='altili'){
      if(roi!=null&&roi<0&&rate<0.10) label='PAS';
      else if(roi!=null&&roi>0&&rate>=0.10&&lower>=0.04) label='OYNA';
      else if(rate>=0.10&&lower>=0.03) label='TEMKİNLİ';
      else if(lower<0.03) label='PAS';
    }else{
      // V1.1.318 ROI+isabet kapısı: negatif ROI ürünleri yüksek hit-rate yüzünden
      // ana öneriye çıkamaz. Pozitif ROI için de en az 20 resmi örnek + %20 hit-rate
      // + Wilson alt sınırı %10 gerekir. Bu, 509 arşivde Üçlü Ganyan gibi hem
      // isabet hem getiri üreten ürünü öne çıkarırken pahalı/negatif ürünleri eler.
      if(pk>=5&&roi!=null&&roi<=-25) label='PAS';
      else if(pk>=20&&roi!=null&&roi>=20&&rate>=0.20&&lower>=0.10) label='OYNA';
      else if(lower>=0.25&&roi!=null&&roi>=0) label='OYNA';
      else if(pk>=10&&roi!=null&&roi>=0&&rate>=0.15&&lower>=0.08) label='TEMKİNLİ';
      else if(lower>=0.45&&(roi==null||roi>-25)) label='TEMKİNLİ';
      else if(lower>=0.15&&(roi==null||roi>-15)) label='TEMKİNLİ';
      else label='PAS';
    }
    return {label,lower};
  }

  function recordedCouponHistoryHTML(){
    const db=global.db||{};
    const logs=arr(db.auto_coupon_log);
    if(!logs.length) return `<div class="card tkpRecordedCouponHistory" style="border-left:5px solid #0f766e;"><h2 style="margin:0 0 5px;">🧾 Gerçek Kayıtlı Kupon Sonuçları</h2><p class="muted">Henüz yarış öncesi kayıtlı kupon snapshotı yok.</p></div>`;
    const hipKey=v=>{try{return typeof global.canonicalHippodrome==='function'?global.canonicalHippodrome(v):str(v).toLocaleUpperCase('tr-TR');}catch(_){return str(v).toLocaleUpperCase('tr-TR');}};
    const latest=new Map();
    for(const log of logs){
      const key=`${str(log?.race_date)}|${hipKey(log?.hippodrome)}|${num(log?.altili_no,1)}`;
      const prev=latest.get(key);
      if(!prev || str(log?.created_at)>str(prev?.created_at)) latest.set(key,log);
    }
    const productDefs=[['main','Normal'],['alt','Sürpriz'],['surprise','Uzman + Kulis']];
    const rows=[];
    const totals=Object.fromEntries(productDefs.map(([k])=>[k,{n:0,h:0}]));
    for(const [meetingKey,log] of [...latest.entries()].sort((a,b)=>str(b[1]?.race_date).localeCompare(str(a[1]?.race_date)))){
      const races=arr(db.races).filter(r=>str(r?.race_date)===str(log?.race_date)&&hipKey(r?.hippodrome)===hipKey(log?.hippodrome)&&num(r?.altili_no,1)===num(log?.altili_no,1));
      const byLeg=new Map();
      for(const r of races){
        const leg=num(r?.leg); if(!leg) continue;
        const winners=arr(r?.horses).filter(h=>num(h?.winner)===1||num(h?.finish_position)===1);
        if(winners.length) byLeg.set(leg,{race:r,winners});
      }
      if(byLeg.size<6) continue;
      for(const [product,label] of productDefs){
        const c=log?.coupons?.[product];
        const legs=arr(c?.legs); if(legs.length!==6) continue;
        let hitLegs=0,known=0;
        for(const leg of legs){
          const rw=byLeg.get(num(leg?.leg)); if(!rw) continue; known++;
          if(arr(leg?.picks).some(no=>rw.winners.some(winner=>sameHorse(no,winner?.horse_no)))) hitLegs++;
        }
        if(known!==6) continue;
        const hit=hitLegs===6;
        totals[product].n++; if(hit) totals[product].h++;
        rows.push({date:str(log?.race_date),hip:str(log?.hippodrome),alt:num(log?.altili_no,1),product,label,hitLegs,hit,version:str(log?.algorithm_version||'KAYITLI')});
      }
    }
    const summary=productDefs.map(([k,label])=>{
      const x=totals[k],pct=x.n>=MIN_PERCENT_SAMPLE?`%${Math.round(x.h/x.n*100)}`:`—`;
      return `<tr><td><b>${escLocal(label)}</b></td><td class="num">${x.n}</td><td class="num">${x.h}</td><td class="num">${pct}</td></tr>`;
    }).join('');
    const recent=rows.slice().sort((a,b)=>b.date.localeCompare(a.date)||TKP_TR_COLLATOR.compare(a.label,b.label)).slice(0,24).map(x=>`<tr><td>${escLocal(x.date)}</td><td>${escLocal(x.hip)}</td><td class="num">${x.alt}</td><td>${escLocal(x.label)}</td><td class="num"><b style="color:${x.hit?'#15803d':'#b91c1c'}">${x.hit?'TUTTU':'TUTMADI'} · ${x.hitLegs}/6</b></td><td>${escLocal(x.version)}</td></tr>`).join('');
    return `<div class="card tkpRecordedCouponHistory" style="border-left:5px solid #0f766e;"><h2 style="margin:0 0 5px;">🧾 Gerçek Kayıtlı Kupon Sonuçları · Snapshot</h2><p class="muted" style="margin:0 0 7px;">Bu bölüm, yarıştan önce gerçekten kaydedilmiş kuponu sonuçla karşılaştırır. <b>Güncel algoritma replay değildir.</b> Kayıtlı TUTTU/6/6 sonuçları yeniden üretim yüzünden kaybolmaz.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Kupon</th><th class="num">Sonuçlu kayıt</th><th class="num">6/6</th><th class="num">%</th></tr></thead><tbody>${summary}</tbody></table></div><details style="margin-top:6px;"><summary>Son kayıtlı kupon sonuçları</summary><div class="tableWrap compactBacktest"><table><thead><tr><th>Tarih</th><th>Pist</th><th class="num">Altılı</th><th>Kupon</th><th class="num">Sonuç</th><th>Sürüm</th></tr></thead><tbody>${recent||'<tr><td colspan="6" class="empty">Sonuçla eşleşen kayıtlı kupon yok.</td></tr>'}</tbody></table></div></details></div>`;
  }

  function real509ArchiveReferenceHTML(){
    const archive=global.TKP_REAL509_ARCHIVE;
    const all=archive?.portfolioSummary?.all,holdout=archive?.portfolioSummary?.holdout,dataset=archive?.dataset;
    if(!all||!holdout||!dataset)return '';
    const defs=[['Normal','Normal'],['Sürpriz','Sürpriz'],['Uzman + Kulis','Uzman + Kulis'],['PORTFÖY','Üç kupondan en az biri']];
    const row=(key,label)=>{
      const a=all[key]||{},h=holdout[key]||{};
      const avg=Number.isFinite(Number(a.avg_cost))?fmtTLLocal(a.avg_cost):'—';
      return `<tr><td><b>${escLocal(label)}</b></td><td class="num">${num(a.hits)}/${num(a.meetings)}</td><td class="num">%${fmt2Local(num(a.rate)*100)}</td><td class="num">${num(h.hits)}/${num(h.meetings)}</td><td class="num">%${fmt2Local(num(h.rate)*100)}</td><td class="num">${avg}</td></tr>`;
    };
    const side=archive.sidebetSummary||{};
    const sideRows=Object.entries(side).map(([name,item])=>{
      const a=item?.finalAll||{},h=item?.finalHoldout||{};
      const decision=name==="Sıralı 5'li"?'SHADOW ADAY':'PAS';
      return `<tr><td><b>${escLocal(name)}</b></td><td class="num">${num(a.hits)}/${num(a.total)}</td><td class="num">%${fmt2Local(num(a.rate)*100)}</td><td class="num">${Number.isFinite(Number(a.roi))?'%'+fmt2Local(num(a.roi)*100):'—'}</td><td class="num">${num(h.hits)}/${num(h.total)}</td><td class="num">${Number.isFinite(Number(h.roi))?'%'+fmt2Local(num(h.roi)*100):'—'}</td><td><span class="tkpBtDecisionBadge ${decision==='PAS'?'pass':'caution'}">${decision}</span></td></tr>`;
    }).join('');
    return `<div class="card tkpReal509PersistentReference" style="border-left:5px solid #0f766e;"><h2 style="margin:0 0 5px;">⚡ Kalıcı REAL509/V46 arşiv referansı</h2><p class="muted" style="margin:0 0 7px;">${num(dataset.archive_meetings)} toplantı / ${num(dataset.archive_races)} koşu denetlendi; yarış-öncesi V46 satırı bulunan eksiksiz <b>${num(dataset.complete_v46_sixleg_meetings)} toplantı</b> kronolojik analizde kullanıldı. Bu hazır çıktı Ctrl+F5 sonrası yeniden hesaplanmaz ve <b>bugünkü algoritmanın canlı replay'i gibi gösterilmez.</b></p><div class="tableWrap compactBacktest"><table><thead><tr><th>Kupon</th><th class="num">Tüm arşiv 6/6</th><th class="num">Tüm %</th><th class="num">Holdout 6/6</th><th class="num">Holdout %</th><th class="num">Ort. maliyet</th></tr></thead><tbody>${defs.map(([key,label])=>row(key,label)).join('')}</tbody></table></div><details style="margin-top:7px;"><summary>Kalıcı yan bahis kalibrasyonu</summary><div class="tableWrap compactBacktest"><table><thead><tr><th>Ürün</th><th class="num">Tüm isabet</th><th class="num">Tüm %</th><th class="num">Tüm ROI</th><th class="num">Holdout</th><th class="num">Holdout ROI</th><th>Karar</th></tr></thead><tbody>${sideRows}</tbody></table></div><p class="muted">Sıralı 5'li pozitif görünse de getiri birkaç büyük ikramiyeye yoğunlaştığı için otomatik OYNA yapılmaz.</p></details></div>`;
  }

  function algorithmDevelopmentComparisonHTML(result){
    const archive=global.TKP_REAL509_ARCHIVE,baseline=archive?.portfolioSummary?.all;
    if(!baseline||!result)return '';
    const currentDefs=[
      ['Normal','Normal',result.out?.main],['Sürpriz','Sürpriz',result.out?.alt],['Uzman + Kulis','Uzman + Kulis',result.out?.surprise]
    ];
    const pp=(v)=>`${v>=0?'+':''}${fmt2Local(v)} puan`,rel=(v)=>Number.isFinite(v)?`${v>=0?'+':''}%${fmt2Local(v)}`:'—';
    const rows=currentDefs.map(([baseKey,label,item])=>{
      const b=baseline?.[baseKey]||{},bn=num(b.meetings),bh=num(b.hits),br=bn?bh/bn:0,cn=num(item?.meetings),ch=num(item?.full),cr=cn?ch/cn:0;
      const delta=(cr-br)*100,relative=br?((cr/br)-1)*100:NaN,same=bn===cn&&bn>0;
      return `<tr><td><b>${escLocal(label)}</b></td><td class="num">${bh}/${bn} · %${fmt2Local(br*100)}</td><td class="num">${ch}/${cn} · %${fmt2Local(cr*100)}</td><td class="num"><b>${pp(delta)}</b><small>${rel(relative)}${same?' · aynı örneklem':' · örneklem farklı'}</small></td></tr>`;
    }).join('');
    const sideMap=[
      ['Çifte','cifte','Çifte'],
      ['Sıralı İkili','sirali_ikili','Sıralı İkili'],
      ['Sıralı Üçlü','sirali_uclu','Sıralı Üçlü'],
      ['Dörtlü Ganyan','dortlu_ganyan_main','Dörtlü Ganyan'],
      ['Beşli Ganyan','besli_main','Beşli Ganyan'],
      ['Tabela','tabela','Tabela'],
      ["Sıralı 5'li",'sirali5li',"Sıralı 5'li"]
    ];
    const sideRows=sideMap.map(([name,key,baselineName])=>{
      const baselineItem=archive?.sidebetSummary?.[baselineName]?.finalAll;
      const baselineAvailable=!!baselineItem&&num(baselineItem.total)>0;
      const b=baselineItem||{},c=result.side?.[key]||{},bn=num(b.total),bh=num(b.hits),br=bn?bh/bn:NaN,cn=num(c.total),ch=num(c.ok),cr=cn?ch/cn:NaN;
      const currentAvailable=cn>0;
      const broi=baselineAvailable&&Number.isFinite(Number(b.roi))?Number(b.roi)*100:null,croi=currentAvailable&&Number.isFinite(Number(c.roi))?Number(c.roi):null;
      const delta=baselineAvailable&&currentAvailable?(cr-br)*100:NaN;
      const baselineHit=baselineAvailable?`${bh}/${bn} · %${fmt2Local(br*100)}`:'—';
      const currentHit=currentAvailable?`${ch}/${cn} · %${fmt2Local(cr*100)}`:'—';
      return `<tr><td><b>${escLocal(name)}</b></td><td class="num">${baselineHit}</td><td class="num">${currentHit}</td><td class="num">${Number.isFinite(delta)?pp(delta):'—'}</td><td class="num">${broi==null?'—':'%'+fmt2Local(broi)}</td><td class="num">${croi==null?'—':'%'+fmt2Local(croi)}</td></tr>`;
    }).join('');
    return `<div class="card tkpAlgorithmDevelopment" style="border-left:5px solid #7c3aed"><h2 style="margin:0 0 5px">📈 Algoritma Gelişimi · Baseline → Yeni algoritma</h2><p class="muted" style="margin:0 0 7px">6/6 gelişim ve yan bahis gelişimi açıkça gösterilir. Baseline kalıcı REAL509/V46 referansıdır; Yeni algoritma seçilen Back Test havuzudur. Örneklem farklıysa bu özellikle yazılır; sonuçlar yapay olarak eşitlenmez.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Altılı</th><th>Baseline</th><th>Yeni algoritma</th><th>6/6 gelişim</th></tr></thead><tbody>${rows}</tbody></table></div><h3 style="margin:8px 0 4px">Yan bahis gelişimi</h3><div class="tableWrap compactBacktest"><table><thead><tr><th>Ürün</th><th>Baseline isabet</th><th>Yeni isabet</th><th>İsabet farkı</th><th>Baseline ROI</th><th>Yeni ROI</th></tr></thead><tbody>${sideRows}</tbody></table></div></div>`;
  }

  function fastHTML(budgets,limit=50,precomputedKey=''){
    const safeLimit=Math.max(1,Math.min(509,num(limit,509)));
    const coreKey=precomputedKey||datasetKey(safeLimit,budgets);
    const htmlKey=coreKey+'|HTML22';
    if(fastHtmlCache.has(htmlKey)) return fastHtmlCache.get(htmlKey);
    const started=(global.performance&&performance.now)?performance.now():Date.now();
    const result=fastCore(budgets,safeLimit,coreKey);
    // 503 geçmişi yalnız araştırma kalibrasyonudur. Bu panel, en düşük maliyet /
    // yüksek ROI adayını gösterir ama geçmiş replay sonucunu canlı politikaya
    // aktaramaz; üretim terfisi ayrı zaman-kilitli canlı örnek kapısından geçer.
    const calibration=typeof global.tkpResearchCalibrationFromFastResult==='function'
      ?global.tkpResearchCalibrationFromFastResult(result,budgets,global.db):null;
    const calibrationHtml=typeof global.tkpCalibrationReportHTML==='function'
      ?global.tkpCalibrationReportHTML(calibration):'';
    const bankrollHtml=typeof global.tkpMonthlyBankrollHTML==='function'
      ?global.tkpMonthlyBankrollHTML('',global.db):'';
    const normalizeCoupon=item=>({
      total:num(item?.meetings),ok:num(item?.full),near5:arr(item?.records).filter(r=>num(r?.hits)>=5).length,cost:num(item?.cost),financeCost:num(item?.financeCost),
      ret:num(item?.ret),payoutKnown:num(item?.payoutKnown),singles:num(item?.singles),singleHit:num(item?.singleHit),
      net:num(item?.net),roi:item?.roi
    });
    const summaryRow=(label,item)=>{
      const financeKnown=num(item.payoutKnown)>0;
      return `<tr><td><b>${escLocal(label)}</b></td><td class="num">${num(item.total)}</td><td class="num">${num(item.ok)}</td><td class="num">${pctSpan(item.ok,item.total)}</td><td class="num">${singleSuccessHTML(item)}</td><td class="num">${fmtTLLocal(item.cost)}</td><td class="num">${num(item.payoutKnown)}</td><td class="num">${financeKnown?fmtTLLocal(item.financeCost):unknownMoney()}</td><td class="num">${financeKnown?fmtTLLocal(item.ret):unknownMoney()}</td><td class="num tkpMoney ${financeKnown&&item.net>=0?'pos':'neg'}"><b>${financeKnown?fmtTLLocal(item.net):unknownMoney()}</b></td><td class="num">${financeKnown?'%'+fmt2Local(item.roi):unknownMoney()}</td></tr>`;
    };
    const targetDefs=[
      {key:'main',label:'Normal',min:140,max:220},
      {key:'alt',label:'Sürpriz',min:90,max:150},
      {key:'surprise',label:'Uzman + Kulis',min:80,max:140}
    ];
    const persistentAll=global.TKP_REAL509_ARCHIVE?.portfolioSummary?.all||{};
    const persistentNames={main:'Normal',alt:'Sürpriz',surprise:'Uzman + Kulis'};
    const targetRows=targetDefs.map(def=>{
      const raw=result.out?.[def.key]||{};
      let total=num(raw.meetings),full=num(raw.full),avg=total?num(raw.cost)/total:0,source='GÜNCEL REPLAY';
      let roi=raw.payoutKnown?num(raw.roi):null;
      if(!total){
        const ref=persistentAll[persistentNames[def.key]]||{};
        total=num(ref.meetings);full=num(ref.hits);avg=num(ref.avg_cost);roi=null;source='KALICI V46';
      }
      const state=full<def.min?'ALTINDA':(full>def.max?'ÜSTÜNDE':'BANTTA');
      const cls=state==='BANTTA'?'play':(state==='ALTINDA'?'caution':'pass');
      return `<tr><td><b>${escLocal(def.label)}</b><small>${source}</small></td><td class="num">${def.min}–${def.max}</td><td class="num">${full}/${total}</td><td class="num">${pctSpan(full,total)}</td><td class="num">${fmtTLLocal(avg)}</td><td class="num">${roi==null?unknownMoney():'%'+fmt2Local(roi)}</td><td><span class="tkpBtDecisionBadge ${cls}">${state}</span></td></tr>`;
    }).join('');
    const targetHtml=`<div class="card tkpBacktestTargetCard" style="border-left:5px solid #7c3aed;"><h2 style="margin:0 0 5px;">🎯 Strateji Hedefi · 6/6 / Bütçe / ROI</h2><p class="muted" style="margin:0 0 7px;">Hedef bantları Normal 140–220, Sürpriz 90–150, Uzman + Kulis 80–140 tam 6/6 içindir. Yeni sonuçla Back Test önbelleği yenilenir; oranlar yalnız sonuçlu toplantılardan hesaplanır.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Strateji</th><th class="num">Hedef</th><th class="num">6/6</th><th class="num">%</th><th class="num">Ort. maliyet</th><th class="num">ROI</th><th>Durum</th></tr></thead><tbody>${targetRows}</tbody></table></div></div>`;
    function altiliUsefulness(label,item){
      const total=Math.max(0,num(item?.total)),full=Math.max(0,num(item?.ok)),near5=Math.max(full,num(item?.near5));
      const fullRate=total?full/total:0,near5Rate=total?near5/total:0;
      const roi=Number.isFinite(Number(item?.roi))?Number(item.roi):-1e9;
      const avgCost=total?num(item?.cost)/total:1e9;
      return {label,item,total,full,near5,fullRate,near5Rate,roi,avgCost};
    }
    function bestAltiliStrategy(period,maxMonthIndex){
      const defs=[
        ['Normal · Altılı',result.out.main],
        ['Sürpriz · Altılı',result.out.alt],
        ['Uzman + Kulis · Altılı',result.out.surprise]
      ].map(([label,raw])=>{
        const metric=period==='all'?normalizeCoupon(raw):periodMetricFromRecords(raw?.records,period,maxMonthIndex);
        return altiliUsefulness(label,metric);
      }).filter(x=>x.total>0);
      defs.sort((a,b)=>
        (b.fullRate-a.fullRate)||
        (b.near5Rate-a.near5Rate)||
        (b.roi-a.roi)||
        (a.avgCost-b.avgCost)||
        TKP_TR_COLLATOR.compare(a.label,b.label)
      );
      return defs[0]||null;
    }
    function bestStrategyBadge(period,maxMonthIndex){
      // Tekrarlanan üç dönem özeti kaldırıldı: aynı metrikler hemen alttaki
      // Bahis tablosunda dönem sekmesine göre zaten görünür.
      return '';
    }

    // V1.1.152: kullanıcıya iki farklı/çelişkili başarı tablosu gösterilmez.
    // fastCore zaten yalnız doğrulanmış toplantıları kabul eder; bu yüzden ek
    // "doğrulanmış" alt satırlar ve aylık ikinci tablo kaldırıldı.
    const ganyanItems=[
      ['Normal · Altılı',normalizeCoupon(result.out.main)],
      ['Sürpriz · Altılı',normalizeCoupon(result.out.alt)],
      ['Uzman + Kulis · Altılı',normalizeCoupon(result.out.surprise)],
      ['Beşli Ganyan · HIT-FIRST',result.side.besli_main],
      ['Dörtlü Ganyan · HIT-FIRST',result.side.dortlu_ganyan_main],
      ['Üçlü Ganyan · HIT-FIRST',result.side.uclu_ganyan_main]
    ];
    const sideNames={cifte:'Çifte',sirali_ikili:'Sıralı İkili',sirali_uclu:'Sıralı Üçlü',tabela:'Tabela / Dörtlü Bahis',sirali5li:'Sıralı 5’li'};
    const unifiedRow=(label,item,showSingle,leaderLabel='')=>{
      const financeKnown=num(item?.payoutKnown)>0;
      const total=num(item?.total??item?.meetings),ok=num(item?.ok??item?.full),cost=num(item?.cost),financeCost=num(item?.financeCost),ret=num(item?.ret);
      const net=financeKnown?(Number.isFinite(Number(item?.net))?num(item.net):ret-financeCost):0;
      const roi=financeKnown?(Number.isFinite(Number(item?.roi))?num(item.roi):(financeCost?net/financeCost*100:0)):0;
      const singleCell=showSingle?singleSuccessHTML(item):'—';
      const kind=label.includes('Altılı')?'altili':'side',decision=backtestDecision({...item,total,ok,roi,payoutKnown:num(item?.payoutKnown)},kind);
      const decisionClass=decision.label==='OYNA'?'play':(decision.label==='PAS'?'pass':'caution');
      const decisionTitle=total>=MIN_PERCENT_SAMPLE?`Wilson alt %${Math.round(decision.lower*100)}`:`Örnek n=${total}`;
      const decisionBadge=`<span class="tkpBtDecisionBadge ${decisionClass}" title="${decisionTitle}">${decision.label}</span>`;
      const leaderBadge=leaderLabel&&label.startsWith(leaderLabel)?'<span class="tkpBtLeaderBadge">🏆 ANA</span>':'';
      return `<tr class="${leaderBadge?'tkpBtLeaderRow':''}"><td><b>${escLocal(label)}</b> ${leaderBadge} ${decisionBadge}</td><td class="num">${total}</td><td class="num">${ok}</td><td class="num">${pctSpan(ok,total)}</td><td class="num">${singleCell}</td><td class="num">${fmtTLLocal(cost)}</td><td class="num">${num(item?.payoutKnown)}</td><td class="num">${financeKnown?fmtTLLocal(financeCost):unknownMoney()}</td><td class="num">${financeKnown?fmtTLLocal(ret):unknownMoney()}</td><td class="num tkpMoney ${financeKnown&&net>=0?'pos':'neg'}"><b>${financeKnown?fmtTLLocal(net):unknownMoney()}</b></td><td class="num">${financeKnown?(total>=MIN_PERCENT_SAMPLE?'%'+fmt2Local(roi):`—`):unknownMoney()}</td></tr>`;
    };
    const maxMonthIndex=backtestMaxMonthIndex(result);
    const periodRows=period=>{
      const leader=bestAltiliStrategy(period,maxMonthIndex);
      const leaderLabel=leader?.label||'';
      const gRows=ganyanItems.map(([label,item])=>{
        const sourceRecords=(label.includes('Altılı'))
          ? (label.startsWith('Normal')?result.out.main.records:label.startsWith('Sürpriz')?result.out.alt.records:result.out.surprise.records)
          : item?.records;
        return unifiedRow(label,period==='all'?item:periodMetricFromRecords(sourceRecords,period,maxMonthIndex),true,leaderLabel);
      }).join('');
      const sRows=Object.keys(sideNames).map(key=>unifiedRow(sideNames[key],period==='all'?result.side[key]:periodMetricFromRecords(result.side[key]?.records,period,maxMonthIndex),false,'')).join('');
      return gRows+sRows;
    };
    const rowsMonth=periodRows('month'),rowsLast3=periodRows('last3'),rowsAll=periodRows('all');
    const took=Math.round((((global.performance&&performance.now)?performance.now():Date.now())-started)*10)/10;
    const usage=result.predictionUsage||{current:0,archive:0,fallback:0};
    const eligibility=result.eligibility||{};
    const excludedNote=result.excludedUnverified?` · Replay dışı toplam: <b>${result.excludedUnverified}</b>.`:'';
    const skippedNote=(result.incompleteAltiliSkipped?` · Eksik 6 ayak/sonuç nedeniyle alınmayan toplantı: <b>${result.incompleteAltiliSkipped}</b>.`:'')+excludedNote;
    const couponUsage=result.couponUsage||{archived:0,scenario:0,meetingsWithSnapshot:0};
    const sourceNote=`Kupon politikası: <b>V55.2 dengeli Normal + bağımsız Sürpriz + Uzman/Kulis</b> · sıralama modeli: <b>${escLocal(currentModelVersion()||'TKP')}</b>. Gerçek yarış-öncesi kupon snapshotı varsa yalnız o kupon çözülür; snapshot yoksa yalnız kilitli skorlarla senaryo replay'i yapılır. Gerçek snapshot kuponu: <b>${couponUsage.archived||0}</b> · snapshotlı toplantı: <b>${couponUsage.meetingsWithSnapshot||0}</b> · Açık kilitli ayak: <b>${usage.current}</b> · kronolojik arşiv ayak: <b>${usage.archive}</b> · doğrulanmamış fallback: <b>${usage.fallback}</b>. <br><b>Replay Uygun ${eligibility.replayEligible||0}</b> · Kupon snapshotıyla doğrulanan ${eligibility.snapshotVerified||0} · frozen skorla doğrulanan ${eligibility.frozenScoreVerified||0} · Eksik snapshot ${eligibility.missingSnapshot||0} · Eksik sonuç/6 ayak ${eligibility.missingResult||0} · Ağır eksik ${eligibility.heavyMissing||0}${eligibility.outsideReset?` · Dönem dışı ${eligibility.outsideReset}`:''}.`;
    const refMonth=Number.isFinite(maxMonthIndex)?`${Math.floor(maxMonthIndex/12)}-${String(maxMonthIndex%12+1).padStart(2,'0')}`:'—';
    const replayHtml=`<div class="card tkpRealBacktestOnly" style="border-left:5px solid #315b7d;"><div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap"><h2 style="margin:0 0 5px;">🧪 Gerçek Back Test — Geçerli Algoritma · Replay</h2><div class="tkpBacktestPeriodSwitch" style="display:flex;gap:4px;flex-wrap:wrap"><button type="button" class="tkpBacktestPeriodBtn active" data-period="month" aria-pressed="true" onclick="tkpBacktestPeriodSwitch('month')">Bu Ay</button><button type="button" class="tkpBacktestPeriodBtn" data-period="last3" aria-pressed="false" onclick="tkpBacktestPeriodSwitch('last3')">Son 3 Ay</button><button type="button" class="tkpBacktestPeriodBtn" data-period="all" aria-pressed="false" onclick="tkpBacktestPeriodSwitch('all')">Tüm Zamanlar</button></div></div><p class="muted" style="margin:0 0 6px;">${result.groupsTested} doğrulanmış toplantı havuzu${skippedNote} · Referans ay: <b>${escLocal(refMonth)}</b>. Dönem değişince hazır replay sonucu gösterilir; veri değişmedikçe yeniden hesaplanmaz.</p><p class="muted" style="margin:0 0 6px;color:#0f766e !important;">${sourceNote}</p><p class="muted" style="margin:0 0 6px;color:#92400e !important;">ROI yalnız resmî ikramiye bulunan testlerden hesaplanır. Sonuç sonrası veri tahmin girdisine katılmaz. Süre: <b>${took} ms</b>.</p><div class="tkpBtLeaderWrap">${bestStrategyBadge('month',maxMonthIndex)}${bestStrategyBadge('last3',maxMonthIndex).replace('class="tkpBtLeaderCard"','class="tkpBtLeaderCard" style="display:none"')}${bestStrategyBadge('all',maxMonthIndex).replace('class="tkpBtLeaderCard"','class="tkpBtLeaderCard" style="display:none"')}</div><div class="tableWrap compactBacktest tkpBacktestSummary tkpBacktestSummaryUnified tkpOneScreenBacktest"><table><thead><tr><th>Bahis</th><th class="num">Test</th><th class="num">Tuttu</th><th class="num">%</th><th class="num" title="Tek başarısı">Tek</th><th class="num">Test maliyeti</th><th class="num">Resmî</th><th class="num">Resmî maliyet</th><th class="num">Kazanç</th><th class="num">Net</th><th class="num">ROI</th></tr></thead><tbody class="tkpBacktestPeriodBody" data-period="month">${rowsMonth}</tbody><tbody class="tkpBacktestPeriodBody" data-period="last3" style="display:none">${rowsLast3}</tbody><tbody class="tkpBacktestPeriodBody" data-period="all" style="display:none">${rowsAll}</tbody></table></div></div>`;
    const finalHtml=bankrollHtml+recordedCouponHistoryHTML()+real509ArchiveReferenceHTML()+algorithmDevelopmentComparisonHTML(result)+targetHtml+calibrationHtml+replayHtml;
    fastHtmlCache.set(htmlKey,finalHtml);
    if(fastHtmlCache.size>12) fastHtmlCache.delete(fastHtmlCache.keys().next().value);
    return finalHtml;
  }

  async function fastHTMLAsync(budgets,limit=50,onProgress=null){
    const safeLimit=Math.max(1,Math.min(509,num(limit,509)));
    const coreKey=datasetKey(safeLimit,budgets);
    const htmlKey=coreKey+'|HTML22';
    if(fastHtmlCache.has(htmlKey))return fastHtmlCache.get(htmlKey);
    await fastCoreAsync(budgets,safeLimit,coreKey,onProgress);
    return fastHTML(budgets,safeLimit,coreKey);
  }

  const legacy = global.couponArchiveBacktestHTML;
  if(typeof legacy === 'function' && !global.__tkpLegacyCouponArchiveBacktestHTML){
    global.__tkpLegacyCouponArchiveBacktestHTML = legacy;
  }
  function invalidateFastBacktestCache(){ fastCache.clear(); fastHtmlCache.clear(); }
  global.tkpInvalidateFastBacktestCache = invalidateFastBacktestCache;
  global.tkpFastBacktestCore = fastCore;
  global.tkpFastBacktestCoreAsync = fastCoreAsync;
  global.tkpFastBacktestHTML = fastHTML;
  global.tkpFastBacktestHTMLAsync = fastHTMLAsync;
  global.couponArchiveBacktestHTMLAsync = fastHTMLAsync;
  global.couponArchiveBacktestHTML = function(budgets,limit){
    try{
      const needHistorical=false; // V1.1.301: otomatik tarihsel rebuild kapısı kaldırıldı
      if(global.__tkpHistoricalCalibrationRunning===true){
        try{ global.tkpAutoPostLoadPipeline?.('backtest-gate').catch(()=>{}); }catch(_e){}
        const cal=global.db?.settings?.historical_calibration||{};
        const done=Math.max(0,num(cal.cursor,0)), total=Math.max(done,num(cal.file_count,0));
        const progress=total?` · ${done}/${total} toplantı`:'';
        return `<div class="card" style="border-left:5px solid #7c3aed;"><b>⏳ Back Test hazırlanıyor.</b><p class="muted" style="margin:6px 0 0;">Tarihsel skorlar güncel ortak motorla otomatik yeniden hesaplanıp gerçek kilit oluşturuluyor${progress}. İşlem bitince Back Test doğrulanmış havuzla otomatik hazır olacak; eksik eski havuza sessizce düşülmeyecek.</p></div>`;
      }
      return fastHTML(budgets,limit);
    }
    catch(error){
      // Eski motor büyük arşivde dakikalarca kilitlenebildiği için hata halinde
      // ona sessizce geri dönme. Hata açıkça gösterilir ve düğme yeniden kullanılabilir.
      console.error('V34 hızlı Back Test hatası:', error);
      return `<div class="card" style="border-left:5px solid #dc2626;"><b>Back Test çalıştırılamadı:</b> ${escLocal(error?.message||error)}</div>`;
    }
  };
  global.addEventListener && global.addEventListener('tkp:db-changed',invalidateFastBacktestCache);
})(window);
