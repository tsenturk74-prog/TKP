/**
 * TKP V1.1.333 — Haftalık çoklu algoritma ve eşlenik portföy takipçisi.
 *
 * Temel güvenlik kuralları:
 * - Tahmin yalnız yarış sonucu bilinmiyorken bir kez dondurulur.
 * - Sonuçlandıktan sonra geçmişe yeni tahmin üretilmez.
 * - Ham denetim kayıtları yarış/model anahtarıyla tekildir; kullanıcı ekranı yalnız
 *   Pazartesi–Pazar haftalık toplamları gösterir.
 * - Aday algoritma kendiliğinden Champion olmaz. Terfi yalnız yeterli TAM hafta,
 *   eş örneklem ve maliyet sınırı sağlanırsa “inceleme adayı” olarak işaretlenir.
 */
(function(global){
  'use strict';

  const VERSION='V1.1.333-WEEKLY-PAIRED-PORTFOLIO-GATE';
  const TIME_ZONE='Europe/Istanbul';
  const DEFAULT_START='2026-08-23';
  const ACTIVE_MODEL='PRODUCTION_CHAMPION_W1';
  const PROMOTION_POLICY=Object.freeze({
    minCompletedWeeks:8,
    minResolvedRaces:300,
    minCompleteMeetings:60,
    minSixfoldHits:10,
    minPairedPortfolioMeetings:80,
    minPortfolioHits:12,
    minSideBetEvents:150,
    consecutiveFourWeekWins:2,
    minSixfoldGain:0.03,
    minPortfolioGain:0.03,
    maxPairedSignP:0.05,
    maxP1Loss:0.02,
    maxAverageCostRatio:1.15,
    maxPortfolioCostRatio:1.05,
    minSideBetRoi:0,
    maxSinglePayoutShare:0.50,
    maxTop3PayoutShare:0.75,
    automaticPromotion:false
  });
  const RETROSPECTIVE_CHALLENGER_AUDIT=Object.freeze({
    version:'V1.1.333-RANK-CDF-SHADOW-AUDIT',runtimeResultFields:false,
    chronology:Object.freeze({train:232,validation:77,holdout:78}),
    baseline:Object.freeze({validationPortfolioHits:15,validationPortfolioPct:19.48,holdoutPortfolioHits:15,holdoutPortfolioPct:19.23}),
    candidate:Object.freeze({validationPortfolioHits:18,validationPortfolioPct:23.38,holdoutPortfolioHits:13,holdoutPortfolioPct:16.67}),
    decision:'REJECT_KEEP_CHAMPION',productionChanged:false,
    warning:'HISTORICAL_ARCHIVE_RECONSTRUCTED; yalnız araştırma, ileri kanıt değildir.'
  });
  const FIVE_MILLION_PORTFOLIO_AUDIT=Object.freeze({
    version:'V1.1.333-5M-PORTFOLIO-AUDIT',trials:5000000,candidateCoupons:4522,
    chronology:Object.freeze({all:499,train:349,validation:75,holdout:75}),
    champion:Object.freeze({all:Object.freeze({normal:55,surprise:46,expertKulis:55,portfolio:84}),holdout:Object.freeze({normal:13,surprise:12,expertKulis:13,portfolio:18})}),
    challenger:Object.freeze({validationPortfolioHits:13,holdoutPortfolioHits:5}),
    targetsMet:false,decision:'REJECT_KEEP_PRODUCTION_CHAMPION_W1',productionChanged:false,
    runtimeResultFields:false,warning:'499 resmî sonucu tam toplantı kullanıldı; sonuç alanları sıralama girdisi değildir. Eksik sonuçlu 10 arşiv kaydı değerlendirme dışında tutuldu.'
  });
  // Yan bahis için model sırası tek başına bilet kanıtı değildir. Her ürünün
  // gerçekten üretilen birincil havuzu ayrı, append-only bir kayıtta tutulur.
  // Bu eşik yalnız gölge/inceleme durumunu belirler; otomatik oynama veya terfi
  // için hiçbir zaman "AKTİF" sonucu üretmez.
  const EXACT_SIDE_BET_SCHEMA_VERSION=1;
  const EXACT_SIDE_BET_LIVE_SOURCES=new Set(['SON_AGF_OTOMATIK','YARISTAN_40_DK_ONCE','SISTEM_GUNCEL_VERI','X_GUNCEL_OTOMATIK']);
  const EXACT_SIDE_BET_MIN_EVENTS=PROMOTION_POLICY.minSideBetEvents;
  let _exactSideBetCache={rows:null,length:-1,locks:null,metrics:null,dirty:true};
  const MODEL_CATALOG=Object.freeze([
    {id:ACTIVE_MODEL,label:'Champion · Canlı Üretim',kind:'production',active:true},
    {id:'AGF_MARKET_W1',label:'AGF · Temiz Piyasa Referansı',kind:'agf'},
    {id:'TOMMY_VISIBLE_W1',label:'Tommy · İlk Bakış',kind:'tommy'},
    {id:'VALIDATED30_W1',label:'Challenger · Validated %30',kind:'validated30'},
    {id:'TOMMY_CHALLENGER_W1',label:'Tommy + Challenger',kind:'tommy_challenger'},
    {id:'CHAMPION_AGF69_BH_W1',label:'Champion + AGF 6–9/BH',kind:'agf69'},
    {id:'V53_FUSION_W1',label:'V53 · Çoklu Model Füzyonu',kind:'v53'},
    {id:'SURPRISE_CORE_ONLINE_V53_ODS_W1',label:'Sürpriz · Core+Online+V53+ODS',kind:'surprise'},
    {id:'EXPERT_CONSENSUS_W1',label:'Uzman/Kulis Konsensüsü',kind:'expert'},
    {id:'TABLE_LEARNED_ENSEMBLE_W1',label:'Tablo Öğrenimli Ensemble',kind:'table'}
  ]);
  // V55'in ilk ve karşılaştırılabilir dört çekirdek sırası. Bu liste yeni bir
  // tahmin üretmez, sıralama ağırlıklarını değiştirmez ve Champion terfisi için
  // kısayol değildir; haftalık canlı denetimde sabit bir karşılaştırma tabanı
  // olarak tutulur. Ek challenger'lar katalogda kalabilir, fakat bu çekirdek
  // kimlikler paket sürümleri arasında sessizce değiştirilemez.
  const LEGACY_CORE_COMPARISON_GROUP=Object.freeze({
    id:'V55_LEGACY_CORE_COMPARISON_V1',
    label:'V55 eski çekirdek karşılaştırma',
    modelIds:Object.freeze([ACTIVE_MODEL,'AGF_MARKET_W1','TOMMY_VISIBLE_W1','VALIDATED30_W1']),
    capturePolicy:Object.freeze({preResultOnly:true,timeLockRequired:true}),
    automaticPromotion:false
  });

  function database(){ try{return typeof db!=='undefined'?db:null;}catch(_){return null;} }
  function num(v,fallback=null){ if(v===null||v===undefined||v==='')return fallback;const n=Number(v);return Number.isFinite(n)?n:fallback; }
  function clamp(v,lo=0,hi=1){ return Math.max(lo,Math.min(hi,Number(v)||0)); }
  function horseNo(h){ return String(h?.horse_no??'').trim(); }
  function upperTr(v){ return String(v??'').trim().toLocaleUpperCase('tr-TR'); }
  function trackKey(v){
    let s=upperTr(v);
    try{if(typeof global.canonicalHippodrome==='function')s=upperTr(global.canonicalHippodrome(s));}catch(_){ }
    return s.replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C').replace(/[^A-Z0-9]+/g,'');
  }
  function live(r,h){
    if(!h)return false;
    try{if(typeof global.isNonRunner==='function'&&global.isNonRunner(h))return false;}catch(_){ }
    return !/\(KOŞMAZ\)/i.test(String(h?.horse_name||''));
  }
  function sameExact(a,b){ return upperTr(a)===upperTr(b)&&upperTr(a)!==''; }
  function sameBetInterest(a,b){
    if(sameExact(a,b))return true;
    try{return typeof global.sameEkuri==='function'&&global.sameEkuri(String(a),String(b));}catch(_){return false;}
  }
  function bettingInterestKey(no){
    const raw=upperTr(no);if(!raw)return '';
    try{if(typeof global.ekuriGroup==='function'){const g=global.ekuriGroup(raw);if(g)return 'E:'+upperTr(g);}}catch(_){ }
    const m=raw.match(/-(E\d+)$/i);return m?'E:'+m[1].toUpperCase():'N:'+raw;
  }
  function uniqueOrder(rows,r){
    const out=[],seen=new Set();
    for(const h of rows||[]){
      if(!live(r,h))continue;
      const key=bettingInterestKey(horseNo(h));if(!key||seen.has(key))continue;
      seen.add(key);out.push(h);
    }
    return out;
  }
  function hasResult(r){
    try{if(typeof global.raceHasConfirmedResult==='function')return !!global.raceHasConfirmedResult(r?.horses||[]);}catch(_){ }
    return (r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  }
  function raceKey(r){
    return [String(r?.race_date||'').slice(0,10),trackKey(r?.hippodrome),Number(r?.altili_no)||1,Number(r?.leg)||Number(r?.sequence_no)||0].join('|');
  }
  function meetingKey(r){ return [String(r?.race_date||'').slice(0,10),trackKey(r?.hippodrome),Number(r?.altili_no)||1].join('|'); }
  function isoDate(date){return date.toISOString().slice(0,10);}
  function addDays(yyyyMmDd,days){const d=new Date(String(yyyyMmDd).slice(0,10)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return isoDate(d);}
  function weekInfo(value){
    const date=String(value||'').slice(0,10),d=new Date(date+'T12:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(d.getTime()))return {start:'',end:'',key:''};
    const day=d.getUTCDay(),back=day===0?6:day-1;d.setUTCDate(d.getUTCDate()-back);
    const start=isoDate(d),end=addDays(start,6);return {start,end,key:start+'|'+end};
  }
  function todayIstanbul(){
    try{
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;
    }catch(_){return new Date().toISOString().slice(0,10);}
  }
  function trackerStart(){const d=database();return String(d?.settings?.weekly_model_tracker?.startsAt||d?.settings?.live_final_backtest?.startsAt||DEFAULT_START).slice(0,10);}
  function withinTracking(r){const date=String(r?.race_date||'').slice(0,10),start=trackerStart();return !date||!start||date>=start;}
  function ensure(){
    const d=database();if(!d)return null;
    if(!Array.isArray(d.weekly_model_log))d.weekly_model_log=[];
    if(!Array.isArray(d.sidebet_ticket_log))d.sidebet_ticket_log=[];
    d.settings=d.settings&&typeof d.settings==='object'?d.settings:{};
    const old=d.settings.weekly_model_tracker&&typeof d.settings.weekly_model_tracker==='object'?d.settings.weekly_model_tracker:{};
    d.settings.weekly_model_tracker={
      version:VERSION,startsAt:String(old.startsAt||d.settings?.live_final_backtest?.startsAt||DEFAULT_START).slice(0,10),
      cadence:'WEEKLY_MON_SUN',timeZone:TIME_ZONE,activeModelId:String(old.activeModelId||ACTIVE_MODEL),
      automaticPromotion:false,promotionPolicy:{...PROMOTION_POLICY,...(old.promotionPolicy||{}),automaticPromotion:false},
      historicalReference:{...(old.historicalReference||{}),meetings:509,completeMeetings:499,strictOfficialMeetings:499,excludedMissingOfficialResult:10,mode:'DIAGNOSTIC_DEVELOPMENT_REFERENCE_ONLY',agfTimestampProvenanceRequired:true,championEligible:false,source:'TKP_CORE_YEDEK_2026-08-23_509_R14_REAL509_SNAPSHOTS.tkbz'}
    };
    return d.weekly_model_log;
  }

  function rankMap(rows){const m=new Map();(rows||[]).forEach((h,i)=>m.set(bettingInterestKey(horseNo(h)),i));return m;}
  function rankBlend(pool,components){
    const maps=components.map(c=>({weight:c.weight,map:rankMap(c.rows),n:Math.max(1,(c.rows||[]).length)}));
    return pool.slice().sort((a,b)=>{
      const score=h=>maps.reduce((sum,z)=>{const rank=z.map.get(bettingInterestKey(horseNo(h)));return sum+z.weight*(rank==null?0:1-rank/Math.max(1,z.n-1));},0);
      return score(b)-score(a)||TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b));
    });
  }
  function productionOrder(x,pool){
    try{if(typeof global.tkpOrderedForLeg==='function'){const z=global.tkpOrderedForLeg(x);if(z?.length)return uniqueOrder(z,x.r);}}catch(_){ }
    try{if(typeof global.altiliWinnerOrderForRace==='function'){const z=global.altiliWinnerOrderForRace(x.r,pool);if(z?.length)return uniqueOrder(z,x.r);}}catch(_){ }
    return uniqueOrder(pool.slice().sort((a,b)=>(num(b?.score,0)-num(a?.score,0))||TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b))),x.r);
  }
  function visibleOrder(x,pool){
    const score=h=>{
      try{if(typeof global.tkpRaceVisibleDisplayScore==='function')return num(global.tkpRaceVisibleDisplayScore(x.r,h),0);}catch(_){ }
      return num(h?.pre_race_tkp_score,num(h?.prediction_score_snapshot,num(h?.score,0)));
    };
    return uniqueOrder(pool.slice().sort((a,b)=>score(b)-score(a)||num(b?.altili_winner_score,0)-num(a?.altili_winner_score,0)||TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b))),x.r);
  }
  function agfOrder(x,pool){
    const value=h=>{const rank=num(h?.agf_rank,null);if(rank!=null&&rank>0)return 1000-rank;return num(h?.agf,0);};
    return uniqueOrder(pool.slice().sort((a,b)=>value(b)-value(a)||TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b))),x.r);
  }
  function v53Order(x,pool){
    try{const z=global.TkpV53Target15?.fusionOrder?.(x.r,pool);if(Array.isArray(z)&&z.length)return uniqueOrder(z.map(q=>q?.horse).filter(Boolean),x.r);}catch(_){ }
    return productionOrder(x,pool);
  }
  function validatedOrder(x,pool){
    const base=visibleOrder(x,pool);
    try{if(typeof global.tkpValidatedCoverageOrder==='function')return uniqueOrder(global.tkpValidatedCoverageOrder(x.r,base),x.r);}catch(_){ }
    return productionOrder(x,pool);
  }
  function odsOrder(x,pool){
    const value=h=>{
      try{if(typeof global.tkpFrozenOdsResultScore==='function'){const v=global.tkpFrozenOdsResultScore(h);if(v!=null&&Number.isFinite(Number(v)))return Number(v);}}catch(_){ }
      for(const k of ['ods_result_score','ods_sonuc_puani','sonuc_puani','result_score','pre_race_result_score']){const v=num(h?.[k],null);if(v!=null)return v;}
      return null;
    };
    const known=pool.filter(h=>value(h)!=null).sort((a,b)=>value(a)-value(b)||TKP_TR_COLLATOR_NUM.compare(horseNo(a),horseNo(b)));
    const missing=pool.filter(h=>value(h)==null);return uniqueOrder(known.concat(missing),x.r);
  }
  function expertOrder(x,pool){
    const base=productionOrder(x,pool);
    try{if(typeof global.tkpV55ExpertOrderForRace==='function')return uniqueOrder(global.tkpV55ExpertOrderForRace(x.r,base),x.r);}catch(_){ }
    return base;
  }
  function tableOrder(x,pool){
    try{if(typeof global.tkpFinalRankOrderForRace==='function'){const z=global.tkpFinalRankOrderForRace(x.r,pool);if(z?.length)return uniqueOrder(z,x.r);}}catch(_){ }
    try{const snap=global.tkpStrategyLabSnapshot?.(x);if(snap?.p1p5?.length){const byNo=new Map(pool.map(h=>[horseNo(h),h])),head=snap.p1p5.map(z=>byNo.get(String(z.horse_no))).filter(Boolean),used=new Set(head.map(h=>bettingInterestKey(horseNo(h))));return uniqueOrder(head.concat(pool.filter(h=>!used.has(bettingInterestKey(horseNo(h))))),x.r);}}catch(_){ }
    return productionOrder(x,pool);
  }
  function agf69Order(x,pool){
    const base=productionOrder(x,pool),outside=base.slice(5);if(!outside.length)return base;
    let ranked=[];
    try{ranked=outside.map(h=>({h,s:Number(global.tkpAgf69RescueScore?.(x.r,h,base.indexOf(h)+1))||0})).filter(z=>z.s>0).sort((a,b)=>b.s-a.s);}catch(_){ranked=[];}
    if(!ranked.length)return base;
    const out=base.slice(),idx=out.indexOf(ranked[0].h);if(idx<=4)return out;const rescue=out.splice(idx,1)[0];out.splice(4,0,rescue);return out;
  }
  function orderForModel(model,x){
    const pool=uniqueOrder((x?.scored?.length?x.scored:(x?.r?.horses||[])).filter(h=>live(x.r,h)),x.r);
    const prod=productionOrder(x,pool),tommy=visibleOrder(x,pool),v53=v53Order(x,pool);
    if(model.kind==='production')return prod;
    if(model.kind==='agf')return agfOrder(x,pool);
    if(model.kind==='tommy')return tommy;
    if(model.kind==='validated30')return validatedOrder(x,pool);
    if(model.kind==='tommy_challenger')return rankBlend(pool,[{rows:tommy,weight:.50},{rows:validatedOrder(x,pool),weight:.50}]);
    if(model.kind==='agf69')return agf69Order(x,pool);
    if(model.kind==='v53')return v53;
    if(model.kind==='surprise'){
      let online=prod;try{if(typeof global.strategicOrderForRace==='function')online=uniqueOrder(global.strategicOrderForRace(x.r,pool),x.r);}catch(_){ }
      return rankBlend(pool,[{rows:prod,weight:.45},{rows:online,weight:.20},{rows:v53,weight:.20},{rows:odsOrder(x,pool),weight:.15}]);
    }
    if(model.kind==='expert')return expertOrder(x,pool);
    if(model.kind==='table')return tableOrder(x,pool);
    return prod;
  }
  function coverageCounts(x){
    const out={normal:4,surprise:5,expert:5};
    for(const [key,mode] of [['normal','main'],['surprise','alt'],['expert','surprise']]){
      try{const p=typeof global.legCoveragePlan==='function'?global.legCoveragePlan(x,mode):null;if(p?.picks?.length)out[key]=Math.max(1,p.picks.length);}catch(_){ }
    }
    return out;
  }
  function modelSnapshot(model,x){
    const order=orderForModel(model,x),counts=coverageCounts(x),top=order.slice(0,12).map(h=>horseNo(h)).filter(Boolean);
    if(!top.length)return null;
    const names={};order.slice(0,12).forEach(h=>names[horseNo(h)]=String(h?.horse_name||''));
    return {
      ranked_nos:top,ranked_names:names,
      coupon_picks:{normal:top.slice(0,counts.normal),surprise:top.slice(0,counts.surprise),expert:top.slice(0,counts.expert)},
      fair_width_counts:counts,ranking_source:model.kind,pre_race_only:true
    };
  }

  // AGF resmî olarak Altılı başladıktan sonra kesinleşebildiğinden, yalnız
  // "sonuç henüz yok" demek terfi ölçümü için yeterli değildir. TJK program
  // saati varsa snapshotın kesinlikle yarıştan önce alındığını ayrıca kanıtlarız.
  function preStartProof(r){
    const date=String(r?.race_date||'').slice(0,10),raw=String(r?.tjk_race_time||'').trim();
    const m=raw.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s|$)/);
    if(!date||!m)return {eligible:0,source:'RESULT_NOT_KNOWN_ONLY',raceStartAt:''};
    const hh=String(Math.max(0,Math.min(23,Number(m[1])||0))).padStart(2,'0');
    const mm=String(Math.max(0,Math.min(59,Number(m[2])||0))).padStart(2,'0');
    const raceStartAt=`${date}T${hh}:${mm}:00+03:00`,cutoff=Date.parse(raceStartAt);
    return {eligible:Number.isFinite(cutoff)&&Date.now()<cutoff?1:0,source:'TJK_PROGRAM_TIME',raceStartAt};
  }

  function officialAltiliInfo(r){
    const d=database();if(!d)return null;
    const date=String(r?.race_date||'').slice(0,10),track=trackKey(r?.hippodrome),session=Number(r?.altili_no)||1;
    let races=(d.races||[]).filter(z=>String(z?.race_date||'').slice(0,10)===date&&trackKey(z?.hippodrome)===track&&Number(z?.altili_no||1)===session);
    const sameFile=r?.file_id==null?[]:races.filter(z=>String(z?.file_id)===String(r.file_id));if(sameFile.length)races=sameFile;
    const entries=[];for(const z of races)for(const p of z?.payouts||[])if(String(p?.key||'').toLowerCase()==='altili')entries.push(p);
    if(!entries.length)return null;
    let entry=entries.find(p=>new RegExp('^\\s*'+session+'\\.').test(String(p?.label||'')));
    if(!entry&&entries.length===1)entry=entries[0];
    if(!entry)return null;
    const segments=String(entry?.combo||'').split('/').map(s=>s.split(',').map(x=>x.trim()).filter(Boolean));
    if(segments.length!==6)return null;
    return {options:segments,payout:num(entry?.amount,0)||0,rollover:entry?.rollover===true,label:String(entry?.label||''),combo:String(entry?.combo||'')};
  }
  function resultOptions(r){
    const info=officialAltiliInfo(r),leg=Math.max(1,Number(r?.leg)||1);
    if(info?.options?.[leg-1]?.length)return {options:info.options[leg-1],official:true,altili:info};
    const winners=(r?.horses||[]).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1).map(h=>horseNo(h)).filter(Boolean);
    return {options:winners,official:false,altili:null};
  }
  function matchesAny(picks,options,useEkuri=true){const same=useEkuri?sameBetInterest:sameExact;return (picks||[]).some(p=>(options||[]).some(o=>same(p,o)));}
  function poolAssignmentCount(pools){
    let count=0;const used=[];
    (function walk(i){if(i===pools.length){count++;return;}for(const no of pools[i]||[]){if(used.some(x=>sameExact(x,no)))continue;used.push(no);walk(i+1);used.pop();}})(0);
    return count;
  }
  function sideUnit(product){
    try{
      if(typeof SIDE_BET_UNITS!=='undefined'){
        const key={sirali_ikili:'sirali',sirali_uclu:'uclu',tabela:'dortlu',sirali_5li:'sirali5li'}[product];
        const v=num(SIDE_BET_UNITS?.[key],null);if(v!=null)return v;
      }
    }catch(_){ }
    return product==='sirali_5li'?0.50:1;
  }
  function sideBetEvaluation(rec,r){
    const ranked=rec?.ranked_nos||[],defs={
      sirali_ikili:{keys:['sirali_ikili'],widths:[1,5]},
      sirali_uclu:{keys:['sirali_uclu','uclu_bahis'],widths:[1,2,7]},
      tabela:{keys:['tabela','tabela_sirasiz'],widths:[1,3,4,6]},
      sirali_5li:{keys:['sirali_5li'],widths:[1,4,4,6,7]}
    },out={};
    for(const [product,def] of Object.entries(defs)){
      const entries=(r?.payouts||[]).filter(p=>def.keys.includes(String(p?.key||'')));if(!entries.length)continue;
      const pools=def.widths.map(w=>ranked.slice(0,w));if(pools.some(p=>!p.length))continue;
      const matched=entries.filter(entry=>{
        if(entry?.rollover)return false;
        try{if(typeof global.sideBetPayoutEntryMatchesPools==='function')return !!global.sideBetPayoutEntryMatchesPools(entry,pools,{unordered:entry.key==='tabela_sirasiz',useEkuri:false});}catch(_){ }
        return false;
      });
      out[product]={known:1,hit:matched.length?1:0,cost:Math.round(poolAssignmentCount(pools)*sideUnit(product)*100)/100,return:matched.reduce((s,p)=>s+(num(p?.amount,0)||0),0),matchedPayouts:matched.length};
    }
    return out;
  }

  // ---- Exact side-bet ticket evidence ------------------------------------
  // `weekly_model_log` model sırasını saklamaya devam eder; aşağıdaki kayıt ise
  // ekranda gerçekten üretilen birincil biletin havuzlarını, maliyetini ve yarış
  // kimliğini saklar. Böylece sabit genişlikli bir proxy ile geriye dönük isabet
  // hesaplanmaz ve ilk yarış-öncesi kilit sonradan değiştirilemez.
  function exactSideBetProduct(value){
    const key=String(value||'').toLocaleLowerCase('tr-TR')
      .replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c')
      .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    return ({cifte:'cifte',double:'cifte',sirali:'sirali_ikili',sirali_ikili:'sirali_ikili',
      ikili_sirali:'sirali_ikili',triple:'sirali_uclu',uclu:'sirali_uclu',sirali_uclu:'sirali_uclu',
      uclu_bahis:'sirali_uclu',quartet:'tabela',dortlu:'tabela',tabela:'tabela',
      quintet:'sirali_5li',sirali5li:'sirali_5li',sirali_5li:'sirali_5li'})[key]||key;
  }
  function exactRaceDate(value){
    const raw=String(value||'').trim(),iso=raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/),tr=raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if(iso)return `${iso[1]}-${String(iso[2]).padStart(2,'0')}-${String(iso[3]).padStart(2,'0')}`;
    if(tr)return `${tr[3]}-${String(tr[2]).padStart(2,'0')}-${String(tr[1]).padStart(2,'0')}`;
    return raw.slice(0,10);
  }
  function exactRaceStartAt(r={}){
    try{const via=typeof global.tkpPredictionSnapshotRaceStartAt==='function'?global.tkpPredictionSnapshotRaceStartAt(r,{},false):'';if(via&&Number.isFinite(Date.parse(via)))return new Date(Date.parse(via)).toISOString();}catch(_){ }
    const direct=[r?.race_start_at,r?.start_at,r?.race_start,r?.start_time_iso].map(v=>String(v||'').trim()).find(Boolean)||'';
    const directMs=Date.parse(direct);if(Number.isFinite(directMs))return new Date(directMs).toISOString();
    const date=exactRaceDate(r?.race_date||r?.date||r?.meeting_date||''),time=String(r?.tjk_race_time||r?.race_time||r?.start_time||r?.time||'').trim();
    const m=time.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s|$)/);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!m)return '';
    const value=`${date}T${String(Math.max(0,Math.min(23,Number(m[1])||0))).padStart(2,'0')}:${String(Math.max(0,Math.min(59,Number(m[2])||0))).padStart(2,'0')}:00+03:00`;
    return Number.isFinite(Date.parse(value))?new Date(Date.parse(value)).toISOString():'';
  }
  function exactMeetingUid(r={},snapshot={}){
    const direct=String(r?.meeting_uid||snapshot?.meeting_uid||r?.file_id||snapshot?.file_id||'').trim();
    return direct||[exactRaceDate(r?.race_date||r?.date||snapshot?.race_date||''),trackKey(r?.hippodrome||snapshot?.hippodrome||''),Number(r?.altili_no||snapshot?.altili_no)||1].join('|');
  }
  function exactRaceReference(r={},snapshot={}){
    const date=exactRaceDate(r?.race_date||r?.date||snapshot?.race_date||''),meeting_uid=exactMeetingUid(r,snapshot),hippodrome=String(r?.hippodrome||snapshot?.hippodrome||''),altili_no=Number(r?.altili_no||snapshot?.altili_no)||1,leg=Number(r?.leg||r?.sequence_no)||0;
    const race_uid=String(r?.race_uid||r?.id||'').trim(),race_key=String(r?.race_key||[date,trackKey(hippodrome),altili_no,leg].join('|'));
    const race_start_at=exactRaceStartAt(r);
    return {meeting_uid,race_uid,race_key,race_ref_key:String(r?.race_ref_key||((race_uid?`uid:${race_uid}`:`key:${meeting_uid}|${race_key}`))),
      race_date:date,hippodrome,altili_no,leg,race_start_at};
  }
  function exactReferenceKeys(ref={}){
    // race_uid varsa tarih/pist/ayak fallback'ine asla düşme: aynı toplantıda
    // aynı ayak için sonradan düzeltilmiş iki kaydın birbirine bağlanması veri
    // sızıntısı ve yanlış sonuç eşleştirmesi üretir.
    if(ref?.race_uid)return [`uid:${String(ref.race_uid)}`];
    const keys=[];if(ref?.race_ref_key)keys.push(String(ref.race_ref_key));
    if(ref?.meeting_uid&&ref?.race_key)keys.push(`key:${String(ref.meeting_uid)}|${String(ref.race_key)}`);
    return [...new Set(keys)];
  }
  function exactReferenceLookupKeys(ref={}){
    const keys=exactReferenceKeys(ref);
    // Eski kayıtta race_uid yoksa, güncel yarış UID taşısa bile güvenli
    // meeting+racing-key eşleşmesiyle çözülebilsin. UID taşıyan *kayıt* ise
    // exactReferenceKeys sayesinde bu gevşek yola hiç girmez.
    if(ref?.meeting_uid&&ref?.race_key)keys.push(`key:${String(ref.meeting_uid)}|${String(ref.race_key)}`);
    return [...new Set(keys)];
  }
  function exactTicketStable(value){
    if(Array.isArray(value))return '['+value.map(exactTicketStable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+exactTicketStable(value[key])).join(',')+'}';
    return JSON.stringify(value??null);
  }
  function exactTicketHashText(text){
    let hash=2166136261>>>0;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}return `fnv1a32:${(hash>>>0).toString(16).padStart(8,'0')}`;
  }
  function exactTicketImmutablePayload(row={}){
    return {schema_version:Number(row?.schema_version)||EXACT_SIDE_BET_SCHEMA_VERSION,lock_key:String(row?.lock_key||''),meeting_uid:String(row?.meeting_uid||''),
      product:exactSideBetProduct(row?.product),primary:Number(row?.primary)===1?1:0,variant:String(row?.variant||'primary'),source:String(row?.source||''),
      captured_at:String(row?.captured_at||''),race_start_at:String(row?.race_start_at||''),race_start_ats:(row?.race_start_ats||[]).map(String),
      race_refs:(row?.race_refs||[]).map(ref=>({meeting_uid:String(ref?.meeting_uid||''),race_uid:String(ref?.race_uid||''),race_key:String(ref?.race_key||''),race_ref_key:String(ref?.race_ref_key||''),race_start_at:String(ref?.race_start_at||''),captured_at:String(ref?.captured_at||'')})),
      pools:(row?.pools||[]).map(pool=>(pool||[]).map(no=>String(no))),combinations:Number(row?.combinations)||0,unit:Number(row?.unit)||0,cost:Number(row?.cost)||0,
      payout_keys:(row?.payout_keys||[]).map(String),unordered:row?.unordered===true?1:0,use_ekuri:row?.use_ekuri===true?1:0,
      source_type:String(row?.source_type||''),source_id:String(row?.source_id||''),author_id:String(row?.author_id||''),evidence_class:String(row?.evidence_class||'')};
  }
  function exactTicketHash(row={}){return exactTicketHashText(exactTicketStable(exactTicketImmutablePayload(row)));}
  function exactTicketLog(d=database()){
    if(!d)return [];if(!Array.isArray(d.sidebet_ticket_log))d.sidebet_ticket_log=[];return d.sidebet_ticket_log;
  }
  function exactCacheAddPending(cache,row){
    if(!row||row?.evaluation?.known===1||row?.integrity==='HASH_MISMATCH')return;
    for(const ref of row?.race_refs||[])for(const key of exactReferenceKeys(ref)){const rows=cache.pending.get(key)||new Set();rows.add(row);cache.pending.set(key,rows);}
  }
  function exactCacheRemovePending(cache,row){
    for(const ref of row?.race_refs||[])for(const key of exactReferenceKeys(ref)){const rows=cache.pending.get(key);if(!rows)continue;rows.delete(row);if(!rows.size)cache.pending.delete(key);}
  }
  function exactSideBetCache(log){
    if(_exactSideBetCache.rows===log&&_exactSideBetCache.length===log.length&&_exactSideBetCache.locks)return _exactSideBetCache;
    const cache={rows:log,length:log.length,locks:new Set(),pending:new Map(),metrics:null,dirty:true};
    for(const row of log){if(row?.lock_key)cache.locks.add(String(row.lock_key));exactCacheAddPending(cache,row);}
    _exactSideBetCache=cache;return cache;
  }
  function exactSideBetCacheAppend(log,rows){
    const cache=_exactSideBetCache;
    if(cache.rows===log&&cache.length===log.length-(rows||[]).length&&cache.locks){
      for(const row of rows||[]){if(row?.lock_key)cache.locks.add(String(row.lock_key));exactCacheAddPending(cache,row);}cache.length=log.length;cache.metrics=null;cache.dirty=true;return cache;
    }
    return exactSideBetCache(log);
  }
  function exactPoolCount(pools){
    let count=0,used=[];(function walk(i){if(i===(pools||[]).length){count++;return;}for(const no of pools[i]||[]){if(used.some(old=>sameExact(old,no)))continue;used.push(no);walk(i+1);used.pop();}})(0);return count;
  }
  function appendExactSideBetTickets(snapshot,specs){
    const d=database(),log=exactTicketLog(d);if(!d||!Array.isArray(specs)||!specs.length)return 0;
    const cache=exactSideBetCache(log),capturedAt=new Date().toISOString(),source=String(snapshot?.source||''),sourceIsLive=EXACT_SIDE_BET_LIVE_SOURCES.has(source)&&Number(snapshot?.backtest_eligible)===1&&Number(snapshot?.manual_adjustment)!==1,added=[];
    for(const spec of specs){
      if(!spec||spec.primary!==true)continue;
      const product=exactSideBetProduct(spec.product);if(!['cifte','sirali_ikili','sirali_uclu','tabela','sirali_5li'].includes(product))continue;
      const refs=(Array.isArray(spec.races)?spec.races:(Array.isArray(spec.race_refs)?spec.race_refs:[])).map(r=>({...exactRaceReference(r,snapshot),captured_at:capturedAt}));if(!refs.length)continue;
      const starts=refs.map(ref=>String(ref.race_start_at||'')),resultKnown=(Array.isArray(spec.races)?spec.races:[]).some(r=>r?.result_known===true||hasResult(r));
      const liveLocked=sourceIsLive&&!resultKnown&&starts.length===refs.length&&starts.every(value=>Number.isFinite(Date.parse(value))&&Date.parse(capturedAt)<Date.parse(value));
      const evidence_class=liveLocked?'LIVE_PRE_RACE_LOCKED':(resultKnown||!sourceIsLive?'HISTORICAL_RECONSTRUCTED':'UNVERIFIED_SHADOW');
      const lock_key=[String(snapshot?.meeting_uid||refs[0]?.meeting_uid||''),product,'primary',...refs.map(ref=>ref.race_ref_key)].join('|');
      if(cache.locks.has(lock_key))continue; // İlk zaman-kilitli üretim kazanır; güncelleme yok.
      const pools=(spec.pools||[]).map(pool=>(pool||[]).map(no=>String(no)).filter(Boolean)).filter(pool=>pool.length);
      if(!pools.length)continue;
      const row={schema_version:EXACT_SIDE_BET_SCHEMA_VERSION,lock_key,meeting_uid:String(snapshot?.meeting_uid||refs[0]?.meeting_uid||''),product,primary:1,variant:'primary',
        source,captured_at:capturedAt,race_start_at:starts.slice().sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||'',race_start_ats:starts,race_refs:refs,
        pools,combinations:Number(spec.combinations)||exactPoolCount(pools),unit:Number(spec.unit)||sideUnit(product),cost:Number(spec.cost)||Math.round(exactPoolCount(pools)*sideUnit(product)*100)/100,
        payout_keys:(spec.payout_keys||[]).map(String),unordered:spec.unordered===true,use_ekuri:spec.use_ekuri===true,
        source_type:String(spec.source_type||snapshot?.source_type||(source==='X_GUNCEL_OTOMATIK'?'x':'system')),source_id:String(spec.source_id||snapshot?.source_id||''),author_id:String(spec.author_id||snapshot?.author_id||''),
        evidence_class,pre_race_only:liveLocked?1:0,
        integrity:'LOCKED',evaluation:null,evaluated_at:null};
      row.immutable_snapshot_hash=exactTicketHash(row);row.hash_algorithm='FNV-1A-32';row.ticket_id=`SBT-${row.immutable_snapshot_hash.slice(-8)}-${log.length+added.length+1}`;
      log.push(row);added.push(row);cache.locks.add(lock_key);
    }
    if(!added.length)return 0;
    exactSideBetCacheAppend(log,added);
    try{if(typeof global.tkpInvalidateSideBetTicketHtmlCache==='function')global.tkpInvalidateSideBetTicketHtmlCache();}catch(_){ }
    try{if(typeof global.tkpInvalidateBackupCache==='function')global.tkpInvalidateBackupCache();}catch(_){ }
    // 509 toplantılık arşiv snapshot işi her toplantıda tam DB yazmamalı; toplu
    // işlem sonunda ilgili koleksiyonlar tek atomik kısmi manifestle yazılır.
    if(global.__tkpBulkPipelineActive!==true){
      // The coupon owns its atomic write. Append the small exact-ticket log after
      // that commit, without serializing the whole archive a second time.
      global.__tkpLastExactSideBetPersistence=Promise.resolve(global.__tkpLastCouponSnapshotPersistence).then(async()=>{
        if(typeof global.tkpPersistCollections==='function')return global.tkpPersistCollections(['sidebet_ticket_log'],{label:'exact-sidebet-tickets'});
        return typeof saveDB==='function'?saveDB(false):false;
      }).catch(error=>{console.error('Yan bahis bileti kaydedilemedi',error);return false;});
    }
    return added.length;
  }
  function exactRaceRows(raceResults){
    const d=database(),map=new Map(),rows=[];
    for(const item of (d?.races||[]))rows.push(item?.r||item);
    for(const item of (raceResults||[]))rows.push(item?.r||item);
    for(const r of rows){if(!r||typeof r!=='object')continue;const ref=exactRaceReference(r,{});for(const key of exactReferenceLookupKeys(ref))map.set(key,r);}
    return map;
  }
  function exactFindRace(ref,map){for(const key of exactReferenceKeys(ref))if(map.has(key))return map.get(key);return null;}
  function exactPoolHas(pool,no,useEkuri=false){return (pool||[]).some(value=>useEkuri?sameBetInterest(value,no):sameExact(value,no));}
  function exactFinishOptions(r,count){
    const out=[];for(let position=1;position<=count;position++){const nos=(r?.horses||[]).filter(h=>Number(h?.finish_position)===position||(position===1&&Number(h?.winner)===1)).map(h=>horseNo(h)).filter(Boolean);if(!nos.length)return null;out.push([...new Set(nos)]);}return out;
  }
  function exactSequenceHit(pools,r,{unordered=false,useEkuri=false}={}){
    const options=exactFinishOptions(r,(pools||[]).length);if(!options)return {known:false,hit:false};
    if(!unordered)return {known:true,hit:options.every((nos,index)=>nos.some(no=>exactPoolHas(pools[index],no,useEkuri)))};
    const walk=(position,usedPools)=>{if(position>=options.length)return true;for(const no of options[position])for(let pool=0;pool<pools.length;pool++){if(usedPools.has(pool)||!exactPoolHas(pools[pool],no,useEkuri))continue;const next=new Set(usedPools);next.add(pool);if(walk(position+1,next))return true;}return false;};
    return {known:true,hit:walk(0,new Set())};
  }
  function exactTicketOutcome(row,races){
    const product=exactSideBetProduct(row?.product),pools=row?.pools||[];
    if(product==='cifte'){
      if(races.length<2||pools.length<2)return {known:false,hit:false};
      const a=exactFinishOptions(races[0],1),b=exactFinishOptions(races[1],1);if(!a||!b)return {known:false,hit:false};
      return {known:true,hit:a[0].some(no=>exactPoolHas(pools[0],no,true))&&b[0].some(no=>exactPoolHas(pools[1],no,true))};
    }
    const ordered=exactSequenceHit(pools,races[0],{useEkuri:row?.use_ekuri===true});
    if(!ordered.known)return ordered;
    if(product!=='tabela')return ordered;
    const unordered=exactSequenceHit(pools,races[0],{unordered:true,useEkuri:row?.use_ekuri===true});return {known:unordered.known,hit:ordered.hit||unordered.hit,unorderedHit:unordered.hit?1:0};
  }
  function exactTicketPayout(row,races){
    const product=exactSideBetProduct(row?.product),target=product==='cifte'?races[races.length-1]:races[0],keys=(row?.payout_keys||[]).map(String),entries=(target?.payouts||[]).filter(entry=>keys.includes(String(entry?.key||'')));
    const matched=entries.filter(entry=>{if(entry?.rollover)return false;try{return typeof global.sideBetPayoutEntryMatchesPools==='function'&&global.sideBetPayoutEntryMatchesPools(entry,row?.pools||[],{unordered:row?.unordered===true||entry?.key==='tabela_sirasiz',useEkuri:row?.use_ekuri===true});}catch(_){return false;}});
    return {known:entries.length?1:0,entries,matched,return:matched.reduce((sum,entry)=>sum+(num(entry?.amount,0)||0),0)};
  }
  function resolveExactSideBetTickets(raceResults){
    const d=database(),log=exactTicketLog(d);if(!d||!log.length)return false;
    const cache=exactSideBetCache(log),lookup=exactRaceRows(raceResults),candidates=new Set();
    for(const item of (raceResults||[])){const r=item?.r||item;if(!r)continue;for(const key of exactReferenceLookupKeys(exactRaceReference(r,{})))for(const row of cache.pending.get(key)||[])candidates.add(row);}
    let changed=false;
    for(const row of candidates){
      if(row?.evaluation?.known===1||row?.integrity==='HASH_MISMATCH')continue;
      if(String(row?.immutable_snapshot_hash||'')!==exactTicketHash(row)){row.integrity='HASH_MISMATCH';row.integrity_checked_at=new Date().toISOString();exactCacheRemovePending(cache,row);changed=true;continue;}
      const races=(row?.race_refs||[]).map(ref=>exactFindRace(ref,lookup));if(!races.length||races.some(r=>!r||!hasResult(r)))continue;
      const outcome=exactTicketOutcome(row,races),payout=exactTicketPayout(row,races);if(!outcome.known&&!payout.known)continue;
      row.evaluation={known:1,hit:payout.matched.length?1:(outcome.hit?1:0),cost:Number(row?.cost)||0,return:payout.return,payout_known:payout.known,matchedPayouts:payout.matched.length,rollover:payout.entries.some(entry=>entry?.rollover)?1:0,unordered_hit:outcome.unorderedHit||0};
      row.evaluated_at=new Date().toISOString();row.integrity='RESOLVED';exactCacheRemovePending(cache,row);changed=true;
    }
    if(changed){cache.metrics=null;cache.dirty=true;try{if(typeof global.tkpInvalidateSideBetTicketHtmlCache==='function')global.tkpInvalidateSideBetTicketHtmlCache();}catch(_){ }try{if(typeof global.tkpInvalidateBackupCache==='function')global.tkpInvalidateBackupCache();}catch(_){ }try{if(global.__tkpBulkPipelineActive!==true){if(typeof global.tkpPersistCollections==='function')global.tkpPersistCollections(['weekly_model_log','sidebet_ticket_log'],{label:'exact-sidebet-resolve'});else if(typeof saveDB==='function')saveDB(false);}}catch(_){ }}
    return changed;
  }
  function exactSideBetMetrics(log){
    const cache=exactSideBetCache(log);if(cache.metrics&&!cache.dirty)return cache.metrics;
    const stats=new Map();for(const row of log){
      if(Number(row?.primary)!==1||String(row?.evidence_class||'')!=='LIVE_PRE_RACE_LOCKED'||row?.integrity!=='RESOLVED'||Number(row?.evaluation?.known)!==1||String(row?.immutable_snapshot_hash||'')!==exactTicketHash(row))continue;
      const product=exactSideBetProduct(row?.product),item=stats.get(product)||{events:0,financialEvents:0,hits:0,cost:0,return:0,returns:[],keys:new Set()};if(!row?.lock_key||item.keys.has(row.lock_key))continue;
      item.keys.add(row.lock_key);item.events++;item.hits+=Number(row?.evaluation?.hit)||0;
      // Finansal ROI yalnız sonuç biletle eşlenmiş ve ilgili ödeme kaydı gerçekten
      // bulunmuşsa hesaplanır. Ödemesi bilinmeyen olaya sessizce 0 dönüş yazılmaz.
      if(Number(row?.evaluation?.payout_known)===1){const cost=Math.max(0,Number(row?.evaluation?.cost)||0),ret=Math.max(0,Number(row?.evaluation?.return)||0);item.financialEvents++;item.cost+=cost;item.return+=ret;item.returns.push(ret);}
      stats.set(product,item);
    }
    cache.metrics=stats;cache.dirty=false;return stats;
  }
  function sideBetEvidenceDecision(raw={}){
    const events=Math.max(0,Number(raw?.events)||0),financialEvents=Math.max(0,Number(raw?.financialEvents)||0),hits=Math.max(0,Number(raw?.hits)||0),cost=Math.max(0,Number(raw?.cost)||0),ret=Math.max(0,Number(raw?.return)||0);
    const payouts=(raw?.returns||[]).map(v=>Math.max(0,Number(v)||0)).sort((a,b)=>b-a),roi=cost?(ret-cost)/cost:null;
    const largestShare=ret>0?(payouts[0]||0)/ret:null,top3Share=ret>0?payouts.slice(0,3).reduce((sum,v)=>sum+v,0)/ret:null;
    const enough=events>=EXACT_SIDE_BET_MIN_EVENTS&&financialEvents>=EXACT_SIDE_BET_MIN_EVENTS;
    const profitable=roi!==null&&roi>PROMOTION_POLICY.minSideBetRoi;
    const diversified=largestShare!==null&&largestShare<=PROMOTION_POLICY.maxSinglePayoutShare&&top3Share!==null&&top3Share<=PROMOTION_POLICY.maxTop3PayoutShare;
    const review=enough&&profitable&&diversified;
    const reasons=[];
    if(events<EXACT_SIDE_BET_MIN_EVENTS)reasons.push(`${events}/${EXACT_SIDE_BET_MIN_EVENTS} özgün canlı bilet`);
    if(financialEvents<EXACT_SIDE_BET_MIN_EVENTS)reasons.push(`${financialEvents}/${EXACT_SIDE_BET_MIN_EVENTS} ödeme eşleşmiş olay`);
    if(!profitable)reasons.push('canlı ROI pozitif değil');
    if(!diversified)reasons.push('ödeme yoğunlaşması güvenli sınırı geçiyor');
    return {events,financialEvents,hits,hitRate:events?hits/events:0,cost,return:ret,roi,largestPayoutShare:largestShare,top3PayoutShare:top3Share,
      enough,profitable,diversified,state:review?'REVIEW':'SHADOW',canActivate:false,automaticPromotion:false,
      reason:review?'Canlı örnek, pozitif ROI ve ödeme yoğunlaşması kapıları geçti; yalnız elle inceleme yapılabilir.':reasons.join(' · ')};
  }
  function exactSideBetGate(product){
    const key=exactSideBetProduct(product),item=exactSideBetMetrics(exactTicketLog(database())).get(key)||{events:0,financialEvents:0,hits:0,cost:0,return:0,returns:[]},decision=sideBetEvidenceDecision(item);
    return {product:key,...decision,mode:decision.state,label:decision.state==='REVIEW'?'İNCELEME':'SHADOW',minimum:EXACT_SIDE_BET_MIN_EVENTS,remaining:Math.max(0,EXACT_SIDE_BET_MIN_EVENTS-decision.events),
      exact:true,livePreRaceOnly:true,automaticPromotion:false,canActivate:false};
  }
  function evaluateRecord(rec,r){
    if(!rec||!r||!hasResult(r))return false;
    const result=resultOptions(r);if(!result.options.length)return false;
    const old=JSON.stringify(rec.evaluation||null),rank=(rec.ranked_nos||[]).findIndex(no=>matchesAny([no],result.options,true))+1;
    rec.evaluation={
      evaluated_at:rec?.evaluation?.evaluated_at||new Date().toISOString(),winner_options:result.options.slice(),official_altili_combo:result.official?1:0,
      winner_rank:rank||null,p1:rank===1?1:0,top3:rank>0&&rank<=3?1:0,top5:rank>0&&rank<=5?1:0,
      coupon_hits:Object.fromEntries(Object.entries(rec.coupon_picks||{}).map(([k,p])=>[k,matchesAny(p,result.options,true)?1:0])),
      altili_payout:result.altili?.payout||0,altili_rollover:result.altili?.rollover===true,altili_combo:result.altili?.combo||'',
      sidebets:sideBetEvaluation(rec,r)
    };
    return old!==JSON.stringify(rec.evaluation);
  }
  function sync(raceResults){
    const log=ensure();if(!log||!Array.isArray(raceResults))return false;
    const index=new Map(log.map(rec=>[String(rec?.event_model_key||''),rec])),start=trackerStart();let changed=false;
    // Exact yan bahis biletleri model-sırası proxy'sinden bağımsız çözülür. Bu çağrı
    // yalnız daha önce kilitlenmiş kayıtları günceller; sonuçtan sonra yeni bilet yazmaz.
    if(resolveExactSideBetTickets(raceResults))changed=true;
    for(const item of raceResults){
      const x=item?.r?item:{r:item,scored:item?.horses||[]},r=x?.r;if(!r||!withinTracking(r))continue;
      const resultKnown=hasResult(r),wk=weekInfo(r.race_date),timeProof=preStartProof(r);
      for(const model of MODEL_CATALOG){
        const key=raceKey(r)+'|'+model.id;let rec=index.get(key);
        // Sonuçsuz olmak tek başına yeterli değildir: program saati doğrulanmış
        // ve şu anın o saatten önce olduğu yarışlar dışında hiçbir model için
        // snapshot yazma. Böylece V55 çekirdek karşılaştırması ve challenger
        // kayıtları aynı yarış-öncesi zaman kilidine uyar; sonuçtan sonra geriye
        // dönük deneme kaydı oluşturulamaz.
        if(!rec&&!resultKnown&&Number(timeProof?.eligible)===1){
          const snap=modelSnapshot(model,x);if(!snap)continue;
          rec={event_model_key:key,race_key:raceKey(r),meeting_key:meetingKey(r),model_id:model.id,model_label:model.label,model_version:VERSION,
            race_date:String(r.race_date||'').slice(0,10),hippodrome:String(r.hippodrome||''),altili_no:Number(r.altili_no)||1,leg:Number(r.leg)||0,
            week_key:wk.key,week_start:wk.start,week_end:wk.end,tracking_start:start,created_at:new Date().toISOString(),
            time_lock_eligible:timeProof.eligible,time_proof:timeProof.source,race_start_at:timeProof.raceStartAt,...snap,evaluation:null};
          log.push(rec);index.set(key,rec);changed=true;
        }
        // Sonuçlanmış yarış için snapshot yoksa kesinlikle geriye dönük kayıt üretme.
        if(rec&&resultKnown&&evaluateRecord(rec,r))changed=true;
      }
    }
    // Haftalık model istatistikleri bütün yarış-öncesi kilitleri kullanır. Görsel tablo
    // yalnız son haftaları gösterebilir; kaynak kayıtlar sessizce son-N diye silinmez.
    if(changed){
      try{if(typeof global.tkpInvalidateBackupCache==='function')global.tkpInvalidateBackupCache();}catch(_){ }
      // A central pre-race/result pipeline may synchronize many legs at once. In
      // that mode the caller owns one targeted persist; do not start a whole-DB
      // save for every leg/model update.
      if(global.__tkpBulkPipelineActive!==true)try{
        if(typeof global.tkpPersistCollections==='function')global.tkpPersistCollections(['weekly_model_log','sidebet_ticket_log'],{label:'weekly-model-tracker'});
        else if(typeof saveDB==='function')saveDB(false);
      }catch(_){ }
    }
    return changed;
  }

  function attachCouponSnapshot(snapshot,options={}){
    const log=ensure();if(!log||!snapshot)return false;let changed=false;
    const mapping={main:'normal',alt:'surprise',surprise:'expert'};
    for(const [type,coupon] of Object.entries(snapshot?.coupons||{})){
      const format=mapping[type];if(!format)continue;
      for(const leg of coupon?.legs||[]){
        const key=[String(snapshot.race_date||'').slice(0,10),trackKey(snapshot.hippodrome),Number(snapshot.altili_no)||1,Number(leg?.leg)||0].join('|')+'|'+ACTIVE_MODEL;
        const rec=log.find(z=>z?.event_model_key===key);if(!rec||rec.evaluation||rec.production_coupon_exact?.[format]===1)continue;
        const next=(leg?.picks||[]).map(String).filter(Boolean),prev=rec.coupon_picks?.[format]||[];
        if(next.length){
          rec.coupon_picks=rec.coupon_picks||{};if(JSON.stringify(prev)!==JSON.stringify(next))rec.coupon_picks[format]=next;
          rec.production_coupon_exact=rec.production_coupon_exact||{};rec.production_coupon_exact[format]=1;
          rec.coupon_locked_at=rec.coupon_locked_at||new Date().toISOString();changed=true;
        }
      }
    }
    if(changed){try{if(typeof global.tkpInvalidateBackupCache==='function')global.tkpInvalidateBackupCache();}catch(_){ }try{if(options.persist!==false&&typeof saveDB==='function')saveDB(false);}catch(_){ }}
    return changed;
  }

  function meetingSummaries(records){
    const groups=new Map();for(const rec of records){const key=rec.model_id+'|'+rec.meeting_key;const z=groups.get(key)||[];z.push(rec);groups.set(key,z);}
    const out=[];
    for(const rows of groups.values()){
      const byLeg=new Map(rows.map(r=>[Number(r.leg),r]));if(![1,2,3,4,5,6].every(n=>byLeg.has(n)&&byLeg.get(n)?.evaluation))continue;
      const six=[1,2,3,4,5,6].map(n=>byLeg.get(n)),unit=(()=>{try{return typeof global.ganyanUnitPrice==='function'?num(global.ganyanUnitPrice(six[0].hippodrome,6),1):1;}catch(_){return 1;}})();
      const formats={};for(const format of ['normal','surprise','expert']){
        const picks=six.map(r=>r?.coupon_picks?.[format]||[]);if(picks.some(p=>!p.length))continue;
        const hit=six.every((r,i)=>Number(r?.evaluation?.coupon_hits?.[format])===1),combos=picks.reduce((p,z)=>p*Math.max(1,z.length),1),cost=Math.round(combos*unit*100)/100;
        const official=six.every(r=>Number(r?.evaluation?.official_altili_combo)===1),payout=hit?Math.max(0,...six.map(r=>num(r?.evaluation?.altili_payout,0)||0)):0;
        formats[format]={hit:hit?1:0,cost,return:payout,official:official?1:0};
      }
      const formatRows=Object.values(formats),portfolio=formatRows.length===3?{complete:1,hit:formatRows.some(row=>row.hit===1)?1:0,cost:formatRows.reduce((sum,row)=>sum+row.cost,0),return:formatRows.reduce((sum,row)=>sum+row.return,0),official:formatRows.every(row=>row.official===1)?1:0}:{complete:0,hit:0,cost:0,return:0,official:0};
      out.push({model_id:six[0].model_id,model_label:six[0].model_label,meeting_key:six[0].meeting_key,race_date:six[0].race_date,week_key:six[0].week_key,week_start:six[0].week_start,week_end:six[0].week_end,formats,portfolio});
    }
    return out;
  }
  function emptyMetric(model,wk){return {model_id:model.id,model_label:model.label,active:!!model.active,week_key:wk?.key||'',week_start:wk?.start||'',week_end:wk?.end||'',races:0,p1:0,top3:0,top5:0,formats:{normal:{meetings:0,hits:0,cost:0,return:0,official:0},surprise:{meetings:0,hits:0,cost:0,return:0,official:0},expert:{meetings:0,hits:0,cost:0,return:0,official:0}},portfolio:{meetings:0,hits:0,cost:0,return:0,official:0},sidebets:{}};}
  function aggregate(){
    const log=ensure()||[],done=log.filter(r=>r?.evaluation),eligibleDone=done.filter(r=>Number(r?.time_lock_eligible)===1),meetings=meetingSummaries(eligibleDone),map=new Map();
    for(const rec of eligibleDone){const cat=MODEL_CATALOG.find(x=>x.id===rec.model_id)||{id:rec.model_id,label:rec.model_label},wk={key:rec.week_key,start:rec.week_start,end:rec.week_end},key=rec.week_key+'|'+rec.model_id,z=map.get(key)||emptyMetric(cat,wk);z.races++;z.p1+=Number(rec.evaluation.p1)||0;z.top3+=Number(rec.evaluation.top3)||0;z.top5+=Number(rec.evaluation.top5)||0;
      for(const [product,s] of Object.entries(rec.evaluation?.sidebets||{})){const q=z.sidebets[product]||(z.sidebets[product]={starts:0,hits:0,cost:0,return:0});q.starts+=Number(s.known)||0;q.hits+=Number(s.hit)||0;q.cost+=num(s.cost,0)||0;q.return+=num(s.return,0)||0;}
      map.set(key,z);
    }
    for(const meeting of meetings){const key=meeting.week_key+'|'+meeting.model_id,z=map.get(key);if(!z)continue;for(const [format,s] of Object.entries(meeting.formats||{})){const q=z.formats[format];q.meetings++;q.hits+=s.hit;q.cost+=s.cost;q.return+=s.return;q.official+=s.official;}if(meeting?.portfolio?.complete===1){z.portfolio.meetings++;z.portfolio.hits+=meeting.portfolio.hit;z.portfolio.cost+=meeting.portfolio.cost;z.portfolio.return+=meeting.portfolio.return;z.portfolio.official+=meeting.portfolio.official;}}
    const today=todayIstanbul(),weeks=[...map.values()].sort((a,b)=>String(b.week_start).localeCompare(String(a.week_start))||TKP_TR_COLLATOR.compare(String(a.model_label),String(b.model_label)));
    // KÖK FIX (v1.1.230): `!z.week_start?.startsWith('')` HER ZAMAN false döner --
    // '' de dahil her string kendi başına ''.startsWith('') ile başlar, yani bu koşul
    // geçerli/geçersiz week_start'ı hiç ayırt etmiyordu ve z.completed asla true
    // olamıyordu. Sonuç: hiçbir hafta "TAMAMLANDI" işaretlenemiyor, Champion terfi
    // kapısındaki `complete` filtresi (agg.weeks.filter(w=>w.completed&&!w.partial))
    // her zaman boş kalıyor, promotionRows() hiçbir modeli asla "TERFİ İNCELEMESİ"ne
    // ya da doğru "Tam hafta" sayacına ulaştıramıyordu. Doğru kontrol basit truthy
    // kontrolüdür: weekInfo() geçersiz tarihte week_start='' döner, o durumu dışla.
    weeks.forEach(z=>{z.completed=!!z.week_end&&z.week_end<today&&!!z.week_start;z.partial=String(z.week_start)<String(trackerStart());});
    return {weeks,meetings,raw:log.length,resolved:done.length,eligibleResolved:eligibleDone.length,today};
  }
  function combineMetrics(rows,model){
    const out=emptyMetric(model,null);out.completedWeeks=new Set();out.positiveWeeks=0;
    for(const z of rows){out.races+=z.races;out.p1+=z.p1;out.top3+=z.top3;out.top5+=z.top5;if(z.completed&&!z.partial)out.completedWeeks.add(z.week_key);for(const format of Object.keys(out.formats)){const a=out.formats[format],b=z.formats[format];for(const k of ['meetings','hits','cost','return','official'])a[k]+=Number(b?.[k])||0;}for(const k of ['meetings','hits','cost','return','official'])out.portfolio[k]+=Number(z?.portfolio?.[k])||0;for(const [p,b] of Object.entries(z.sidebets||{})){const a=out.sidebets[p]||(out.sidebets[p]={starts:0,hits:0,cost:0,return:0});for(const k of ['starts','hits','cost','return'])a[k]+=Number(b?.[k])||0;}}
    out.completedWeekCount=out.completedWeeks.size;return out;
  }
  function binomialTailHalf(wins,losses){
    const w=Math.max(0,Math.floor(Number(wins)||0)),l=Math.max(0,Math.floor(Number(losses)||0)),n=w+l;if(!n)return 1;
    let pmf=Math.pow(.5,n),tail=0;for(let i=0;i<=n;i++){if(i>=w)tail+=pmf;if(i<n)pmf*=((n-i)/(i+1));}
    return Math.max(0,Math.min(1,tail));
  }
  function pairedPortfolioEvidence(meetings,candidateId,championId=ACTIVE_MODEL){
    const eligible=(meetings||[]).filter(row=>row?.portfolio?.complete===1&&row?.week_end&&String(row.week_end)<todayIstanbul()&&String(row.week_start)>=String(trackerStart()));
    const base=new Map(eligible.filter(row=>row.model_id===championId).map(row=>[row.meeting_key,row])),candidate=new Map(eligible.filter(row=>row.model_id===candidateId).map(row=>[row.meeting_key,row]));
    let both=0,challengerOnly=0,championOnly=0,neither=0,challengerHits=0,championHits=0,challengerCost=0,championCost=0;
    for(const [key,b] of base){const c=candidate.get(key);if(!c)continue;const bh=Number(b?.portfolio?.hit)===1,ch=Number(c?.portfolio?.hit)===1;championHits+=bh?1:0;challengerHits+=ch?1:0;championCost+=Math.max(0,Number(b?.portfolio?.cost)||0);challengerCost+=Math.max(0,Number(c?.portfolio?.cost)||0);if(bh&&ch)both++;else if(ch)challengerOnly++;else if(bh)championOnly++;else neither++;}
    const paired=both+challengerOnly+championOnly+neither,baseAvg=paired?championCost/paired:null,candidateAvg=paired?challengerCost/paired:null;
    return {meetings:paired,both,challengerOnly,championOnly,neither,challengerHits,championHits,gain:paired?(challengerHits-championHits)/paired:0,signP:binomialTailHalf(challengerOnly,championOnly),
      championAvgCost:baseAvg,challengerAvgCost:candidateAvg,costRatio:baseAvg>0?candidateAvg/baseAvg:null,exactPaired:true};
  }
  function promotionRows(agg){
    const complete=agg.weeks.filter(w=>w.completed&&!w.partial),byModel=new Map();for(const model of MODEL_CATALOG)byModel.set(model.id,combineMetrics(complete.filter(w=>w.model_id===model.id),model));
    const base=byModel.get(ACTIVE_MODEL)||combineMetrics([],MODEL_CATALOG[0]);
    for(const model of MODEL_CATALOG){const z=byModel.get(model.id),weekly=complete.filter(w=>w.model_id===model.id),baseWeeks=new Map(complete.filter(w=>w.model_id===ACTIVE_MODEL).map(w=>[w.week_key,w]));z.positiveWeeks=weekly.reduce((n,w)=>{const b=baseWeeks.get(w.week_key);if(!b)return n;const wa=w.portfolio.meetings?w.portfolio.hits/w.portfolio.meetings:0,ba=b.portfolio.meetings?b.portfolio.hits/b.portfolio.meetings:0;return n+(wa>ba?1:0);},0);
      const c6=z.formats.normal.meetings?z.formats.normal.hits/z.formats.normal.meetings:0,bp1=base.races?base.p1/base.races:0,cp1=z.races?z.p1/z.races:0,cCost=z.formats.normal.meetings?z.formats.normal.cost/z.formats.normal.meetings:Infinity,paired=pairedPortfolioEvidence(agg.meetings,model.id);
      const common=weekly.filter(w=>baseWeeks.has(w.week_key)).sort((a,b)=>String(a.week_start).localeCompare(String(b.week_start))).slice(-8);
      const blockWins=common.length===8?[common.slice(0,4),common.slice(4,8)].filter(block=>{let ch=0,cm=0,bh=0,bm=0;for(const w of block){const b=baseWeeks.get(w.week_key);ch+=w.portfolio.hits;cm+=w.portfolio.meetings;bh+=b.portfolio.hits;bm+=b.portfolio.meetings;}return cm>0&&bm>0&&ch/cm>bh/bm;}).length:0;
      const enough=z.completedWeekCount>=PROMOTION_POLICY.minCompletedWeeks&&z.races>=PROMOTION_POLICY.minResolvedRaces&&z.formats.normal.meetings>=PROMOTION_POLICY.minCompleteMeetings&&z.formats.normal.hits>=PROMOTION_POLICY.minSixfoldHits&&paired.meetings>=PROMOTION_POLICY.minPairedPortfolioMeetings&&paired.challengerHits>=PROMOTION_POLICY.minPortfolioHits;
      const superior=enough&&model.id!==ACTIVE_MODEL&&paired.gain>=PROMOTION_POLICY.minPortfolioGain&&paired.challengerOnly>paired.championOnly&&paired.signP<=PROMOTION_POLICY.maxPairedSignP&&cp1>=bp1-PROMOTION_POLICY.maxP1Loss&&(paired.costRatio==null||paired.costRatio<=PROMOTION_POLICY.maxPortfolioCostRatio)&&blockWins>=PROMOTION_POLICY.consecutiveFourWeekWins;
      z.status=model.id===ACTIVE_MODEL?'AKTİF CHAMPION':superior?'TERFİ İNCELEMESİ':enough?'İZLE':'İZLE';z.sixfoldRate=c6;z.portfolioRate=z.portfolio.meetings?z.portfolio.hits/z.portfolio.meetings:0;z.p1Rate=cp1;z.avgCost=Number.isFinite(cCost)?cCost:null;z.pairedPortfolio=paired;z.autoPromoted=false;
      z.consecutiveBlockWins=blockWins;
    }
    return [...byModel.values()];
  }
  function pct(n,d){return d?('%'+(100*n/d).toFixed(2).replace('.',',')):'-';}
  function analysisDashIfNoSample(value,sample){return Number(sample)>0?String(Number(value)||0):'—';}
  function formatHitIfSample(hits,meetings){return Number(meetings)>0?`${Number(hits)||0}/${Number(meetings)||0}`:'—';}
  function money(v){return (Number(v)||0).toFixed(2).replace('.',',')+' TL';}
  function escHtml(v){try{return typeof global.esc==='function'?global.esc(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(_){return String(v??'');}}
  function historicalReference(){
    const archive=global.TKP_REAL509_ARCHIVE,dataset=archive?.dataset||{},summary=archive?.portfolioSummary||{};
    if(!Array.isArray(archive?.meetings)||!archive.meetings.length)return null;
    return {dataset,summary,meetings:archive.meetings.length};
  }
  function historicalReferenceHTML(reference){
    if(!reference)return '<div class="empty">Paketlenmiş doğrulanmış tarihsel referans bulunamadı.</div>';
    const labels={train:'Eğitim',validation:'Doğrulama',holdout:'Holdout',all:'Tüm doğrulanmış'};
    const rows=['train','validation','holdout','all'].map(key=>{
      const z=reference.summary?.[key]||{},normal=z.Normal||{},surprise=z['Sürpriz']||{},expert=z['Uzman + Kulis']||{},portfolio=z['PORTFÖY']||{};
      return `<tr><td><b>${labels[key]}</b></td><td class="num">${normal.meetings||'—'}</td><td class="num">${normal.meetings?`${formatHitIfSample(normal.hits,normal.meetings)} · ${pct(normal.hits,normal.meetings)}`:'—'}</td><td class="num">${surprise.meetings?`${formatHitIfSample(surprise.hits,surprise.meetings)} · ${pct(surprise.hits,surprise.meetings)}`:'—'}</td><td class="num">${expert.meetings?`${formatHitIfSample(expert.hits,expert.meetings)} · ${pct(expert.hits,expert.meetings)}`:'—'}</td><td class="num">${portfolio.meetings?`${formatHitIfSample(portfolio.hits,portfolio.meetings)} · ${pct(portfolio.hits,portfolio.meetings)}`:'—'}</td><td class="num">${normal.meetings?money(normal.avg_cost):'—'}</td></tr>`;
    }).join('');
    return `<div class="tableWrap compactBacktest"><table style="min-width:800px"><thead><tr><th>Dönem</th><th>Tam Altılı</th><th>Normal 6/6</th><th>Sürpriz 6/6</th><th>Uzman 6/6</th><th>3 kupon portföyü</th><th>Ort. Normal maliyet</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function challengerAuditHTML(){const a=RETROSPECTIVE_CHALLENGER_AUDIT,m=FIVE_MILLION_PORTFOLIO_AUDIT;return `<div class="tableWrap compactBacktest" style="margin-top:7px"><table><thead><tr><th>Deney</th><th>Doğrulama</th><th>Kör holdout</th><th>Üretim kararı</th></tr></thead><tbody><tr><td>Rank-CDF genişlik challenger</td><td class="num">${a.candidate.validationPortfolioHits}/77 · %${String(a.candidate.validationPortfolioPct).replace('.',',')} <small>(Champion ${a.baseline.validationPortfolioHits}/77)</small></td><td class="num">${a.candidate.holdoutPortfolioHits}/78 · %${String(a.candidate.holdoutPortfolioPct).replace('.',',')} <small>(Champion ${a.baseline.holdoutPortfolioHits}/78)</small></td><td><b>RED · CHAMPION KORUNDU</b><small>${escHtml(a.warning)}</small></td></tr><tr><td>5.000.000 portföy kombinasyonu</td><td class="num">${m.challenger.validationPortfolioHits}/75</td><td class="num">${m.challenger.holdoutPortfolioHits}/75 <small>(Champion ${m.champion.holdout.portfolio}/75)</small></td><td><b>RED · EN İYİ MODEL KORUNDU</b><small>${escHtml(m.warning)}</small></td></tr></tbody></table></div>`;}
  function postRaceLearningTrend(){
    const d=database(),start=trackerStart(),byDate=new Map();if(!d)return [];
    const rows=Array.isArray(d.races)?d.races:[];
    for(const r of rows){
      const date=String(r?.race_date||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<start||!hasResult(r))continue;
      const horses=Array.isArray(r?.horses)?r.horses:[],winner=horses.find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
      const key=date,z=byDate.get(key)||{date,races:0,meetings:new Set(),bmb:0,bmbWin:0,odb:0,odbWin:0};
      z.races++;z.meetings.add(meetingKey(r));
      const bmb=horses.filter(h=>Number(h?.bmb)===1);z.bmb+=bmb.length;if(winner&&Number(winner?.bmb)===1)z.bmbWin++;
      const odb=horses.filter(h=>Number(h?.odb)===1);z.odb+=odb.length;if(winner&&Number(winner?.odb)===1)z.odbWin++;
      byDate.set(key,z);
    }
    return [...byDate.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,21).map(z=>({...z,meetings:z.meetings.size}));
  }
  function postRaceLearningTrendHTML(){
    const rows=postRaceLearningTrend();
    if(!rows.length)return '<div class="empty">Sonuç sonrası öğrenme kaydı henüz yok.</div>';
    const body=rows.map(z=>`<tr><td><b>${escHtml(z.date)}</b></td><td class="num">${z.meetings}</td><td class="num">${z.races}</td><td class="num">${formatHitIfSample(z.bmbWin,z.bmb)}</td><td class="num">${formatHitIfSample(z.odbWin,z.odb)}</td><td>POST-RACE · öğrenme</td></tr>`).join('');
    return `<div class="tableWrap compactBacktest"><table style="min-width:700px"><thead><tr><th>Tarih</th><th>Toplantı</th><th>Koşu</th><th>BMB kazanma</th><th>ODB kazanma</th><th>Şerit</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function tableHTML(){
    const agg=aggregate(),promo=promotionRows(agg),reference=historicalReference(),weekRows=agg.weeks.slice(0,120).map(z=>{
      const f=z.formats.normal,s=z.formats.surprise,e=z.formats.expert,status=z.partial?'KISMİ İLK HAFTA':z.completed?'TAMAMLANDI':'DEVAM EDİYOR';
      return `<tr><td>${escHtml(z.week_start)}–${escHtml(z.week_end)}</td><td style="text-align:left!important"><b>${escHtml(z.model_label)}</b></td><td>${status}</td><td class="num">${z.races}</td><td class="num">${pct(z.p1,z.races)}</td><td class="num">${pct(z.top3,z.races)}</td><td class="num">${pct(z.top5,z.races)}</td><td class="num">${formatHitIfSample(f.hits,f.meetings)}</td><td class="num">${formatHitIfSample(s.hits,s.meetings)}</td><td class="num">${formatHitIfSample(e.hits,e.meetings)}</td><td class="num"><b>${formatHitIfSample(z.portfolio.hits,z.portfolio.meetings)}</b></td><td class="num">${f.meetings?money(f.cost/f.meetings):'—'}</td></tr>`;
    }).join('');
    const freshness=database()?.settings?.r19_2_integrity||{};
    const latestResult=String(freshness?.latest_result_date||'').slice(0,10);
    const latestWeekly=String(freshness?.latest_weekly_date||agg?.weeks?.[0]?.week_end||'').slice(0,10);
    const freshnessLine=`<p class="muted tkpFreshnessEvidence" style="margin:0 0 7px;font-size:10.5px;"><b>Son resmî sonuç:</b> ${escHtml(latestResult||'—')} · <b>Son haftalık kanıt:</b> ${escHtml(latestWeekly||'—')}. Haftalık başarı yalnız yarış öncesi kilitli kanıttan hesaplanır; sonuç sonrası satırlar ayrı öğrenme trendinde tutulur.</p>`;
    const historicalRaces=Number(reference?.dataset?.usable_v46_races)||0,historicalMeetings=Number(reference?.dataset?.complete_v46_sixleg_meetings)||0,historicalNormal=reference?.summary?.all?.Normal||{};
    const promoRows=promo.map(z=>{const ref=z.active&&reference?`<small>V46 arşiv: ${historicalRaces}/${PROMOTION_POLICY.minResolvedRaces} koşu · ${historicalMeetings}/${PROMOTION_POLICY.minCompleteMeetings} Altılı · Normal ${historicalNormal.hits||0}/${historicalNormal.meetings||0}</small>`:'',paired=z.pairedPortfolio||{};const histHit=z.active?(historicalNormal.hits||0):null,histMeet=z.active?(historicalNormal.meetings||0):null;const archRace=z.active?historicalRaces:'—',archMeet=z.active?historicalMeetings:'—',archNormal=z.active?`${histHit}/${histMeet}`:'—';return `<tr><td style="text-align:left!important"><b>${escHtml(z.model_label)}</b>${ref}</td><td>${escHtml(z.status)}</td><td class="num">${z.completedWeekCount||0}/${PROMOTION_POLICY.minCompletedWeeks}</td><td class="num">${z.races} canlı / ${archRace} arşiv</td><td class="num">${paired.meetings?paired.meetings:'—'} canlı / ${archMeet} arşiv</td><td class="num">${analysisDashIfNoSample(paired.challengerHits,paired.meetings)}/${paired.meetings||'—'}<small>arşiv Normal ${archNormal}</small></td><td class="num">${paired.meetings?`+${paired.challengerOnly||0} / −${paired.championOnly||0}`:'—'}<small>${paired.meetings?'p='+Number(paired.signP??1).toFixed(3):'eş örnek yok'}</small></td><td class="num">${pct(z.p1,z.races)}</td><td>Elle onay${z.autoPromoted?' · HATA':''}</td></tr>`;}).join('');
    return `<div class="card tkpWeeklyModelTracker" style="border-left:5px solid #7c3aed;margin:10px 0;"><h2 style="margin:0 0 5px;">🗓️ Haftalık Algoritma Takibi</h2>${freshnessLine}<p class="muted" style="margin:0 0 8px;">Eski arşiv yalnız araştırma referansıdır. Canlı Champion/challenger karşılaştırması aynı yarışlarda, TJK program saatinden önce kilitlenen değişmez snapshotlarla yapılır; otomatik terfi yoktur.</p><div class="row" style="gap:8px;margin-bottom:8px;"><span class="badge">Arşiv ${Number(reference?.dataset?.archive_meetings)||0} dosya/toplantı</span><span class="badge">Arşiv koşu ${Number(reference?.dataset?.archive_races)||0}</span><span class="badge">Güvenli tam Altılı ${historicalMeetings}</span><span class="badge">Canlı sonuçlanan ${agg.resolved}</span><span class="badge">Saat kilitli ${agg.eligibleResolved}</span><span class="badge">Otomatik terfi KAPALI</span></div><h3 style="margin:8px 0 5px;">Doğrulanmış tarihsel arşiv · V46 gölge referansı</h3>${historicalReferenceHTML(reference)}${challengerAuditHTML()}<h3 style="margin:10px 0 5px;">Canlı haftalık karşılaştırma</h3><div class="tableWrap compactBacktest"><table style="min-width:1180px"><thead><tr><th>Hafta</th><th>Algoritma</th><th>Durum</th><th>Koşu</th><th>P1</th><th>İlk3</th><th>İlk5</th><th>Normal 6/6</th><th>Sürpriz 6/6</th><th>Uzman 6/6</th><th>3 kupon 6/6</th><th>Ort. Normal maliyet</th></tr></thead><tbody>${weekRows||'<tr><td colspan="12" class="empty">Canlı saat kilitli örnek henüz yok; yukarıdaki tarihsel arşiv hazırdır.</td></tr>'}</tbody></table></div><h3 style="margin:10px 0 5px;">Sonuç sonrası öğrenme trendi</h3><p class="muted" style="margin:0 0 6px;">Yarış bittikten sonra yüklenen doğrulanmış sonuçlar burada tarih sırasıyla görünür. Bu satırlar algoritmanın yeni veriyi öğrenme kapsamını gösterir; canlı/saat-kilitli başarı oranına karıştırılmaz.</p>${postRaceLearningTrendHTML()}<h3 style="margin:10px 0 5px;">Champion terfi kapısı · canlı kanıt · eş yarış</h3><div class="tableWrap compactBacktest"><table style="min-width:1040px"><thead><tr><th>Algoritma</th><th>Karar</th><th>Tam hafta</th><th>Koşu (canlı / arşiv)</th><th>Eş Altılı (canlı / arşiv)</th><th>3 kupon 6/6 / arşiv ref.</th><th>Aday+/Champion−</th><th>P1</th><th>Uygulama</th></tr></thead><tbody>${promoRows}</tbody></table></div><p class="muted" style="margin:7px 0 0;font-size:10.5px;">Terfi incelemesi için en az ${PROMOTION_POLICY.minCompletedWeeks} tam hafta, ${PROMOTION_POLICY.minResolvedRaces} koşu, aynı ${PROMOTION_POLICY.minPairedPortfolioMeetings} Altılı üzerinde ≥%${Math.round(PROMOTION_POLICY.minPortfolioGain*100)} net portföy farkı, eşlenik p≤${PROMOTION_POLICY.maxPairedSignP} ve maliyet/P1 koruması birlikte gerekir. Terfi kararı canlı kanıtla verilir; kullanılabilir geçmiş snapshot/arşiv kanıtı aynı tabloda ayrıca referans olarak gösterilir ve sıfır veri gibi saklanmaz.</p></div>`;
  }

  global.TKP_WEEKLY_MODEL_TRACKER_VERSION=VERSION;
  global.TKP_WEEKLY_MODEL_CATALOG=MODEL_CATALOG;
  global.TKP_V55_LEGACY_CORE_COMPARISON_GROUP=LEGACY_CORE_COMPARISON_GROUP;
  global.TKP_WEEKLY_PROMOTION_POLICY=PROMOTION_POLICY;
  global.TKP_V333_RETROSPECTIVE_CHALLENGER_AUDIT=RETROSPECTIVE_CHALLENGER_AUDIT;
  global.TKP_V333_FIVE_MILLION_PORTFOLIO_AUDIT=FIVE_MILLION_PORTFOLIO_AUDIT;
  global.tkpWeeklyModelWeekInfo=weekInfo;
  global.tkpWeeklyModelTrackerEnsure=ensure;
  global.tkpWeeklyModelTrackerSync=sync;
  global.tkpWeeklyModelTrackerAttachCouponSnapshot=attachCouponSnapshot;
  global.tkpWeeklyModelTrackerAppendExactSideBetTickets=appendExactSideBetTickets;
  global.tkpWeeklyModelTrackerResolveExactSideBetTickets=resolveExactSideBetTickets;
  global.tkpWeeklyModelTrackerSideBetGate=exactSideBetGate;
  global.tkpWeeklyModelTrackerSideBetEvidenceDecision=sideBetEvidenceDecision;
  global.tkpWeeklyModelTrackerPairedPortfolioEvidence=pairedPortfolioEvidence;
  global.tkpWeeklyModelTrackerBinomialTailHalf=binomialTailHalf;
  global.tkpWeeklyModelTrackerExactSideBetLog=()=>exactTicketLog(database());
  global.tkpWeeklyModelPostRaceLearningTrend=postRaceLearningTrend;
  global.tkpWeeklyModelTrackerAggregate=aggregate;
  global.tkpWeeklyModelTrackerPromotionRows=promotionRows;
  global.tkpWeeklyModelTrackerHTML=tableHTML;
})(typeof globalThis!=='undefined'?globalThis:window);
