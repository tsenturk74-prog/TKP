/**
 * TKP Strategy Lab V1.1.162
 *
 * Shadow-only araştırma katmanı. CANLI Champion sırasını/kuponu değiştirmez.
 * Amaç: ileriye dönük (pre-race snapshot -> resmi sonuç) veri biriktirmek.
 *
 * Literatürden uygulanan güvenlik ilkeleri:
 * - pre-race-only özellikler; winner/finish/payout kesinlikle feature değildir.
 * - temporal/forward değerlendirme; sonuçtan sonra model seçimi için geriye yazma yok.
 * - race-level upset risk, horse-level winner score'dan ayrı tutulur.
 * - ranking P1-P5 ayrı izlenir (Top1/3/5 ve sıralı bahis altyapısı).
 * - olasılık kalibrasyonu accuracy'den ayrı izlenir.
 * - belirsizlik yüksekse NO-BET/TEK-YOK seçeneği korunur.
 * - Champion/Challenger ayrımı: bu katman yalnız shadow'dur.
 */
(function(global){
  'use strict';

  const VERSION='V1.1.162-STRATEGY-LAB-SHADOW';
  const RULES=Object.freeze({
    preRaceOnly:true,
    temporalForwardOnly:true,
    raceRiskSeparate:true,
    calibrationRequired:true,
    rankingMetrics:['Top1','Top3','Top5','MRR'],
    uncertaintyAware:true,
    noBetAllowed:true,
    championShadowOnly:true
  });

  function num(v, fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
  function strategyGcTrValue(horse){
    const sources=[horse?.tr_ganyan_source,horse?.tr_source].map(v=>String(v??'').trim().toUpperCase());
    if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
    for(const raw of [horse?.tr_ganyan,horse?.tr_puan]){
      if(raw==null||String(raw).trim()==='')continue;
      const value=Number(String(raw).replace(',','.'));if(Number.isFinite(value))return value;
    }
    return NaN;
  }
  function clamp(v,lo=0,hi=100){ return Math.max(lo,Math.min(hi,num(v))); }
  function horseNo(h){ return String(h?.horse_no??'').trim(); }
  function live(r,h){
    if(!h) return false;
    try{ if(typeof global.isNonRunner==='function'&&global.isNonRunner(h)) return false; }catch(_){ }
    return !/\(KOŞMAZ\)/i.test(String(h.horse_name||''));
  }
  function poolFor(x){ return (x?.scored||x?.r?.horses||[]).filter(h=>live(x?.r,h)); }
  function prof(r,h){ try{return clamp(global.profileStrengthPct(r,h));}catch(_){return 0;} }
  function odb(r,h){ try{return typeof global.isOdbCandidate==='function'&&global.isOdbCandidate(h,r);}catch(_){return false;} }
  function trProfile(r,h,pool){ try{return typeof global.trGanyanProfileForHorse==='function'?global.trGanyanProfileForHorse(r,h,pool):null;}catch(_){return null;} }
  function winnerScore(r,h){
    try{ if(typeof global.altiliWinnerScoreForHorse==='function') return clamp(global.altiliWinnerScoreForHorse(r,h)); }catch(_){ }
    return clamp(num(h?.score)*25);
  }
  function rankOrder(x){
    const p=poolFor(x);
    try{
      if(typeof global.altiliWinnerOrderForRace==='function'){
        const rows=global.altiliWinnerOrderForRace(x?.r,p);
        if(Array.isArray(rows)&&rows.length) return rows.filter(h=>live(x?.r,h));
      }
    }catch(_){ }
    return p.slice().sort((a,b)=>winnerScore(x?.r,b)-winnerScore(x?.r,a)||num(b.score)-num(a.score));
  }
  function agfRank(h){ return num(h?.agf_rank,99); }
  function trValue(h){ return strategyGcTrValue(h); }
  function jbygRank(h){ return num(h?.jbyg_rank??h?.j_beygir_rank??h?.jbyg,99); }
  function workoutRank(h){ return num(h?.rank_400g??h?.rank_800g??h?.workout_rank??h?.galop_rank,99); }

  function raceRisk(x){
    const r=x?.r||{}, pool=poolFor(x), order=rankOrder(x);
    const first=order[0]||null, second=order[1]||null;
    if(!first) return {score:100,band:'VERİ YOK',reasons:['Aday yok'],agreement:0};
    const s1=winnerScore(r,first),s2=winnerScore(r,second),gap=Math.max(0,s1-s2);
    const byAgf=pool.filter(h=>num(h.agf)>0).slice().sort((a,b)=>num(b.agf)-num(a.agf));
    const a1=num(byAgf[0]?.agf),a2=num(byAgf[1]?.agf),a3=num(byAgf[2]?.agf);
    const top3Agf=a1+a2+a3, agfGap=Math.max(0,a1-a2);
    const strongRivals=pool.filter(h=>horseNo(h)!==horseNo(first)&&prof(r,h)>=50).length;
    const trLeader=pool.filter(h=>Number.isFinite(trValue(h))).slice().sort((a,b)=>trValue(b)-trValue(a))[0]||null;
    const leaders=[
      horseNo(first),
      horseNo(byAgf[0]),
      horseNo(trLeader),
      horseNo(pool.find(h=>num(h.bmb)===1)||null),
      horseNo(pool.find(h=>odb(r,h))||null)
    ].filter(Boolean);
    const counts={}; leaders.forEach(n=>counts[n]=(counts[n]||0)+1);
    const maxAgree=Math.max(0,...Object.values(counts));
    const agreement=leaders.length?maxAgree/leaders.length:0;

    let score=0; const reasons=[];
    score += pool.length>=14?18:pool.length>=10?10:3;
    if(gap<5){score+=24;reasons.push('P1/P2 çok yakın');}
    else if(gap<10){score+=15;reasons.push('P1/P2 yakın');}
    else if(gap>=20) score-=6;
    if(a1>0&&a1<12){score+=15;reasons.push('AGF lideri zayıf');}
    else if(a1>0&&a1<18) score+=9;
    if(agfGap>0&&agfGap<3){score+=12;reasons.push('AGF dağılımı sıkışık');}
    if(top3Agf>0&&top3Agf<40){score+=10;reasons.push('AGF ilk3 dağınık');}
    score+=Math.min(20,strongRivals*7);
    if(strongRivals) reasons.push(`${strongRivals} güçlü PROF rakibi`);
    if(agreement<0.40&&leaders.length>=3){score+=15;reasons.push('modeller/sinyaller ayrışıyor');}
    else if(agreement>=0.60){score-=8;reasons.push('çekirdek sinyaller aynı liderde');}
    const cond=String(r.condition_family||r.condition_text||'').toLocaleUpperCase('tr-TR');
    if(/MAIDEN|HAND[İI]KAP/.test(cond)){score+=7;reasons.push('değişken koşu ailesi');}
    score=clamp(score);
    const band=score<=20?'DÜŞÜK':score<=40?'ORTA-DÜŞÜK':score<=60?'ORTA':score<=80?'YÜKSEK':'ÇOK YÜKSEK';
    return {score:Math.round(score),band,reasons,gap:Math.round(gap*10)/10,agreement:Math.round(agreement*100),strongRivals};
  }

  function singleShadow(x){
    const order=rankOrder(x), first=order[0]||null, second=order[1]||null;
    let canonical=null;
    try{ canonical=typeof global.dynamicSingleDecision==='function'?global.dynamicSingleDecision(x,first,second):null; }catch(_){ }
    const risk=raceRisk(x), confidence=clamp(canonical?.confidence??winnerScore(x?.r,first));
    const gap=num(risk.gap), alt=second?horseNo(second):'';
    let grade='TEK YOK';
    if(first && confidence>=78 && gap>=10 && risk.score<=30 && canonical?.weightOk!==false && canonical?.xBreakSingle!==true) grade='SAĞLAM TEK';
    else if(first && confidence>=68 && gap>=5 && risk.score<=50) grade='SINIRDA TEK';
    const veto=[];
    if(risk.score>50) veto.push('yarış riski yüksek');
    if(gap<5) veto.push('P1/P2 farkı küçük');
    if(canonical?.rivalProfileBlocked) veto.push('güçlü PROF rakibi');
    if(canonical?.xBreakSingle) veto.push('X/hibrit rakip sinyali');
    if(canonical?.weightOk===false) veto.push('60 kg üstü');
    return {grade,horse_no:horseNo(first),horse_name:first?.horse_name||'',confidence:Math.round(confidence),alt_no:alt,alt_name:second?.horse_name||'',gap,race_risk:risk.score,race_risk_band:risk.band,veto,canonical_is_single:canonical?.isSingle===true};
  }

  function signalRow(r,h,pool,baseRank){
    const trp=trProfile(r,h,pool);
    const tr=trValue(h), agf=agfRank(h), p=prof(r,h);
    const tags=[];
    if(num(h?.bmb)===1) tags.push('BMB');
    if(odb(r,h)) tags.push('ODB');
    if(trp?.isBmb) tags.push('TR-BMB');
    if(trp?.hardCoupon) tags.push('TR-GÜÇLÜ');
    if(tr>=30&&tr<=60) tags.push('TR30-60');
    if(agf>=6&&agf<=11) tags.push('AGF-SÜRPRİZ');
    if(num(h?.x_force_coupon)===1||h?.x_force_coupon===true) tags.push('X');
    if(num(h?.priorWins??h?.gpr)>0) tags.push('G.PR');
    if(jbygRank(h)<=3) tags.push('J-BYG');
    if(workoutRank(h)<=6) tags.push('GALOP');
    let evidence=0;
    evidence += tags.includes('BMB')?28:0;
    evidence += tags.includes('ODB')?22:0;
    evidence += tags.includes('TR-GÜÇLÜ')?24:0;
    evidence += tags.includes('TR-BMB')?22:0;
    evidence += tags.includes('TR30-60')?12:0;
    evidence += tags.includes('X')?12:0;
    evidence += tags.includes('G.PR')?8:0;
    evidence += tags.includes('J-BYG')?6:0;
    evidence += tags.includes('GALOP')?5:0;
    evidence += p>=50?8:0;
    const surprise=agf>=4 || baseRank>4;
    return {horse_no:horseNo(h),horse_name:h?.horse_name||'',base_rank:baseRank,agf_rank:agf>=99?null:agf,tr:tr||null,prof:Math.round(p),tags,evidence:clamp(evidence),surprise};
  }

  function snapshot(x){
    const r=x?.r||{}, order=rankOrder(x), pool=poolFor(x);
    const p1p5=order.slice(0,5).map((h,i)=>({rank:i+1,horse_no:horseNo(h),horse_name:h?.horse_name||'',score:Math.round(winnerScore(r,h)*10)/10}));
    const signals=pool.map(h=>signalRow(r,h,pool,(order.findIndex(z=>horseNo(z)===horseNo(h))+1)||999))
      .filter(row=>row.tags.length)
      .sort((a,b)=>b.evidence-a.evidence||a.base_rank-b.base_rank)
      .slice(0,8);
    return {version:VERSION,created_at:new Date().toISOString(),rules_version:1,race_risk:raceRisk(x),single:singleShadow(x),p1p5,signals};
  }

  function evaluate(snap,r){
    if(!snap||!r) return null;
    const horses=r.horses||[];
    const winner=horses.find(h=>num(h.winner)===1||num(h.finish_position)===1)||null;
    if(!winner) return null;
    const finishOf=no=>{ const h=horses.find(z=>horseNo(z)===String(no)); const fp=num(h?.finish_position); return fp>0?fp:null; };
    const p1p5=(snap.p1p5||[]).map(row=>({...row,finish:finishOf(row.horse_no)}));
    const sig=(snap.signals||[]).map(row=>{const fp=finishOf(row.horse_no);return {...row,finish:fp,win:fp===1?1:0,top3:fp&&fp<=3?1:0,top5:fp&&fp<=5?1:0};});
    const sf=finishOf(snap.single?.horse_no);
    const altf=finishOf(snap.single?.alt_no);
    return {
      evaluated_at:new Date().toISOString(),winner_no:horseNo(winner),winner_name:winner.horse_name||'',
      p1_hit:p1p5[0]?.finish===1?1:0,
      top3_coverage:p1p5.slice(0,3).some(z=>z.finish===1)?1:0,
      top5_coverage:p1p5.some(z=>z.finish===1)?1:0,
      p1p5,
      single_finish:sf,
      single_hit:sf===1?1:0,
      alt_finish:altf,
      alt_would_save:sf!==1&&altf===1?1:0,
      signals:sig
    };
  }

  // Genel kupon optimizasyon çekirdeği: her ayak için artan kapsama seçeneklerini
  // (count, coverage) alır; aynı bütçede en yüksek yaklaşık birleşik kapsama yolunu seçer.
  // Champion kupon bunu henüz kullanmaz; 10 günlük forward veride challenger olarak test edilir.
  function optimizeCoverage(legs,unit,budget){
    unit=Math.max(0.01,num(unit,1)); budget=Math.max(unit,num(budget,unit));
    const safe=(legs||[]).map(opts=>(opts||[]).map(o=>({count:Math.max(1,Math.round(num(o.count,1))),coverage:Math.max(.001,Math.min(.999,num(o.coverage,.001)))})).sort((a,b)=>a.count-b.count));
    if(!safe.length||safe.some(x=>!x.length)) return {cost:0,coverage:0,counts:[],blocked:true};
    let states=[{combos:1,coverage:1,counts:[]}];
    for(const opts of safe){
      const next=[];
      for(const st of states) for(const o of opts){
        const combos=st.combos*o.count, cost=combos*unit;
        if(cost<=budget+1e-9) next.push({combos,coverage:st.coverage*o.coverage,counts:st.counts.concat(o.count)});
      }
      if(!next.length) return {cost:0,coverage:0,counts:[],blocked:true};
      // Aynı/üst maliyette daha düşük kapsama veren durumları buda.
      next.sort((a,b)=>a.combos-b.combos||b.coverage-a.coverage);
      const pruned=[]; let best=-1;
      for(const st of next){ if(st.coverage>best+1e-12){pruned.push(st);best=st.coverage;} }
      states=pruned.slice(-300);
    }
    states.sort((a,b)=>b.coverage-a.coverage||a.combos-b.combos);
    const best=states[0];
    return {cost:Math.round(best.combos*unit*100)/100,coverage:best.coverage,counts:best.counts,combos:best.combos,blocked:false};
  }


  // V1.1.160 Historical Lab
  // Eski arşivden yalnız açıkça yarış-öncesi dondurulmuş prediction_log kayıtlarını
  // araştırma verisi olarak kullanır. Güncel race.horses skorlarından geçmiş tahmin
  // yeniden üretilmez; bu, sonuç bilgisiyle geriye dönük model kurma sızıntısını önler.
  // Historical sonuçlar yalnız geliştirme/eşik keşfi içindir; forward doğrulamanın yerine geçmez.
  function histTrack(v){
    return String(v||'').trim().toLocaleUpperCase('tr-TR')
      .replace(/İ/g,'I').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ş/g,'S').replace(/Ö/g,'O').replace(/Ç/g,'C')
      .replace(/[^A-Z0-9]+/g,'');
  }
  function histKey(date,track,leg){ return [String(date||''),histTrack(track),Number(leg)||0].join('|'); }
  function historicalBuild(db){
    db=db||{};
    const preds=Array.isArray(db.prediction_log)?db.prediction_log:[];
    const races=Array.isArray(db.races)?db.races:[];
    const files=Array.isArray(db.files)?db.files:[];
    const coupons=Array.isArray(db.auto_coupon_log)?db.auto_coupon_log:[];

    // 1) En erken PRE-RACE-FROZEN batch: bir yarış için sonuca bakarak daha iyi bir
    // sonraki snapshot seçilmez. Aynı timestamp'teki tüm atlar tek batch kabul edilir.
    const batches=new Map();
    for(const row of preds){
      if(!row || !/PRE-RACE-FROZEN/i.test(String(row.strategy_version||''))) continue;
      if(!row.race_date || !row.hippodrome || !Number(row.leg) || !row.ts) continue;
      const key=histKey(row.race_date,row.hippodrome,row.leg);
      const old=batches.get(key);
      if(!old || String(row.ts)<old.ts) batches.set(key,{ts:String(row.ts),rows:[row]});
      else if(String(row.ts)===old.ts) old.rows.push(row);
    }
    const raceMap=new Map();
    for(const r of races){
      if(!r) continue;
      raceMap.set(histKey(r.race_date,r.hippodrome,r.leg),r);
    }
    const records=[]; const meetingSet=new Set();
    let skippedNoResult=0, skippedWeakBatch=0;
    for(const [key,b] of batches){
      const r=raceMap.get(key);
      const winner=(r?.horses||[]).find(h=>num(h?.winner)===1||num(h?.finish_position)===1)||null;
      if(!r||!winner){ skippedNoResult++; continue; }
      const uniq=new Map();
      for(const row of b.rows){
        const no=String(row.horse_no||'').trim(); if(!no) continue;
        const prev=uniq.get(no);
        if(!prev || num(row.predicted_rank,999)<num(prev.predicted_rank,999)) uniq.set(no,row);
      }
      const ranked=[...uniq.values()].sort((a,z)=>num(a.predicted_rank,999)-num(z.predicted_rank,999)||num(z.score)-num(a.score));
      if(ranked.length<2){ skippedWeakBatch++; continue; }
      const winnerNo=horseNo(winner);
      const winnerRank=ranked.findIndex(z=>String(z.horse_no||'').trim()===winnerNo)+1;
      const p1=ranked[0]||null, p2=ranked[1]||null;
      const scoreGap=Math.max(0,num(p1?.score)-num(p2?.score));
      records.push({
        source:'HISTORICAL_PRE_RACE_FROZEN', integrity:'LOCKED_PRE_RACE_LOG',
        race_key:key,race_date:r.race_date||'',hippodrome:r.hippodrome||'',leg:Number(r.leg)||0,
        batch_ts:b.ts,strategy_version:String(p1?.strategy_version||''),field_size:ranked.length,
        p1_no:String(p1?.horse_no||''),p1_name:p1?.horse_name||'',p1_score:num(p1?.score),p2_no:String(p2?.horse_no||''),score_gap:scoreGap,
        p1p5:ranked.slice(0,5).map(z=>({rank:num(z.predicted_rank),horse_no:String(z.horse_no||''),horse_name:z.horse_name||'',score:num(z.score)})),
        winner_no:winnerNo,winner_name:winner?.horse_name||'',winner_rank:winnerRank||null,
        p1_hit:winnerRank===1?1:0,top3_coverage:winnerRank>0&&winnerRank<=3?1:0,top5_coverage:winnerRank>0&&winnerRank<=5?1:0
      });
      meetingSet.add([r.race_date||'',histTrack(r.hippodrome||'')].join('|'));
    }

    // 2) Eski gerçek kupon snapshotları: yalnız kaydedilmiş kuponu değerlendirir;
    // bugünkü algoritmayla geçmişe yeni kupon üretmez.
    const latestCoupon=new Map();
    for(const c of coupons){
      if(!c?.race_date||!c?.hippodrome||!c?.coupons) continue;
      const k=[c.race_date,histTrack(c.hippodrome),Number(c.altili_no)||1,c.source||''].join('|');
      const old=latestCoupon.get(k);
      if(!old || String(c.created_at||'')>String(old.created_at||'')) latestCoupon.set(k,c);
    }
    const couponRows=[];
    for(const c of latestCoupon.values()){
      const rr=races.filter(r=>String(r.race_date||'')===String(c.race_date||'')&&histTrack(r.hippodrome)===histTrack(c.hippodrome));
      const winners=new Map();
      for(const r of rr){ const w=(r.horses||[]).find(h=>num(h?.winner)===1||num(h?.finish_position)===1); if(w) winners.set(Number(r.leg)||0,horseNo(w)); }
      for(const [type,cp] of Object.entries(c.coupons||{})){
        const legs=Array.isArray(cp?.legs)?cp.legs:[];
        if(!legs.length) continue;
        let resolved=true, hit=true;
        for(const leg of legs){
          const wn=winners.get(Number(leg.leg)||0); if(!wn){resolved=false;hit=false;break;}
          if(!(leg.picks||[]).map(String).includes(String(wn))) hit=false;
        }
        couponRows.push({race_date:c.race_date,hippodrome:c.hippodrome,altili_no:Number(c.altili_no)||1,type,cost:num(cp.cost),unit:num(cp.unit),resolved,hit:resolved&&hit?1:0,source:c.source||''});
      }
    }
    const couponSummary={};
    for(const row of couponRows){
      const z=couponSummary[row.type]||(couponSummary[row.type]={entries:0,resolved:0,hits:0,cost:0});
      z.entries++; if(row.resolved){z.resolved++;z.hits+=row.hit;z.cost+=row.cost;}
    }
    const sum=k=>records.reduce((a,r)=>a+num(r[k]),0);
    return {
      version:VERSION, mode:'HISTORICAL_DEVELOPMENT_ONLY', forward_validation_required:true,
      archive_files:files.length, archive_meetings:new Set(files.map(f=>[f.race_date||'',histTrack(f.hippodrome||'')].join('|'))).size,
      eligible_meetings:meetingSet.size, races:records.length,p1:sum('p1_hit'),top3:sum('top3_coverage'),top5:sum('top5_coverage'),
      skipped_no_result:skippedNoResult,skipped_weak_batch:skippedWeakBatch,records,coupon_rows:couponRows,coupons:couponSummary
    };
  }

  // KULLANICI TALEBİ (V1.1.169): "Hunter sinyal ileri sonuçları" tablosu forward_tracking_log
  // içindeki DONDURULMUŞ (geçmiş) kayıtların signals[].tags alanını doğrudan sayıyordu. Bu
  // alan koddan değil, o an kaydedildiği andaki eski snapshot()'tan geliyor -- tag kümesi
  // zamanla değişmiş (örn. "İÇERDE" artık üretilmiyor) olsa bile eski kayıtlarda kalıyor ve
  // tabloda "hayalet" bir satır olarak görünmeye devam ediyordu. Kayıtların kendisine (leakage
  // guard/tarihsel bütünlük için) dokunulmaz; yalnız bu ÖZET tablo artık geçerli/güncel etiket
  // kümesiyle (signalRow() içinde push edilenlerle birebir aynı) sınırlanır.
  const TKP_VALID_STRATEGY_LAB_TAGS=new Set(['BMB','ODB','TR-BMB','TR-GÜÇLÜ','TR30-60','AGF-SÜRPRİZ','X','G.PR','J-BYG','GALOP']);

  function stats(records){
    const rows=(records||[]).filter(r=>r?.strategy_lab?.evaluation);
    const sum=k=>rows.reduce((a,r)=>a+num(r.strategy_lab.evaluation?.[k]),0);
    const singleRows=rows.filter(r=>r.strategy_lab?.snapshot?.single?.grade==='SAĞLAM TEK');
    const singleHit=singleRows.reduce((a,r)=>a+num(r.strategy_lab.evaluation?.single_hit),0);
    const altSave=singleRows.reduce((a,r)=>a+num(r.strategy_lab.evaluation?.alt_would_save),0);
    const signalRows=[];
    rows.forEach(r=>(r.strategy_lab.evaluation?.signals||[]).forEach(s=>signalRows.push(s)));
    const tagMap={};
    signalRows.forEach(s=>(s.tags||[]).forEach(tag=>{
      if(!TKP_VALID_STRATEGY_LAB_TAGS.has(tag)) return;
      const z=tagMap[tag]||(tagMap[tag]={starts:0,wins:0,top3:0,top5:0});z.starts++;z.wins+=num(s.win);z.top3+=num(s.top3);z.top5+=num(s.top5);
    }));
    return {done:rows.length,p1:sum('p1_hit'),top3:sum('top3_coverage'),top5:sum('top5_coverage'),solidSingles:singleRows.length,solidSingleHits:singleHit,solidSingleAltSaves:altSave,tags:tagMap};
  }

  global.TKP_STRATEGY_LAB_VERSION=VERSION;
  global.TKP_STRATEGY_LAB_RULES=RULES;
  global.tkpStrategyLabRaceRisk=raceRisk;
  global.tkpStrategyLabSingleShadow=singleShadow;
  global.tkpStrategyLabSnapshot=snapshot;
  global.tkpStrategyLabEvaluate=evaluate;
  global.tkpStrategyLabOptimizeCoverage=optimizeCoverage;
  global.tkpStrategyLabHistoricalBuild=historicalBuild;
  global.tkpStrategyLabStats=stats;
})(window);
