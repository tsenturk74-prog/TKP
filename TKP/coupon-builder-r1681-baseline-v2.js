// Kupon/bütçe/yan bahis (side bet) oluşturma mantığı.



// Kupon kayıt anahtarlarında hipodrom adını güvenli biçimde standartlaştırır.
// race-data.js yüklenmişse ortak canonicalHippodrome() kullanılır;
// aksi durumda bu yerel dönüşüm kupon motorunun tek başına da çalışmasını sağlar.
// KULLANICI TALİMATI: "Sistem bu backtestleri yaparak kendini geliştirebilir mi?"
// sorusuna cevap -- TKP fark eşiği (TEK zorlanmasın kuralı) artık sabit 0,30 değil.
// eksiksiz sonuçlanmış geçmişteki gerçek 6 ayaklı yarış kartları kronolojik
// %60 train / %20 validation / %20 holdout olarak ayrılır. Aday eşik validation'da
// seçilir; son %20 holdout yalnız kabul kapısıdır. Holdout'ta güvenli 0,30 eşiğinden
// kötüleşen aday canlıya geçmez. Simülasyon sabit 700 TL yerine kullanıcının Normal
// bütçesini (700–1.400 TL güvenli bandında) kullanır. Veri değiştikçe cache anahtarı
// yenilenir ve arama otomatik tekrarlanır.
let _tkpGapThreshold = 0.30;
let _tkpGapThresholdCacheKey = null;
let _tuningTkpGapInProgress = false;
const TKP_GAP_MIN_CARDS = 10;
const TKP_GAP_CANDIDATES = [0.20, 0.30, 0.40];

let _tkpGapTuningScheduled = false;
// KRİTİK: requestIdleCallback varsa (gerçek tarayıcı) onu kullan -- tarayıcı GERÇEKTEN
// boştayken (kullanıcı bir şeye tıklamamışken) çalışır, ana iş parçacığını asla
// kullanıcı etkileşimiyle yarıştırmaz. Yoksa (Node/test ortamı) setTimeout'a düşülür.
function _scheduleIdle(fn){
  if(typeof tkpRunWhenUserIdle==='function') tkpRunWhenUserIdle(fn,{minIdleMs:1800,retryMs:200,maxWaitMs:10000});
  else if(typeof setTimeout==='function') setTimeout(fn,250);
  else fn();
}

// Pre-governance X fields can exist in old saved races.  They are presentation
// remnants only: neither a persisted raw force nor a raw veto may influence any
// Normal/Sürpriz path, ranking, coverage or TEK.  Approved commentator evidence
// enters only through the dedicated Expert/Kulis governance functions.
function tkpLegacyXKulisForce(_horse){return false;}
function tkpLegacyXKulisBreaksSingle(_horse){return false;}

function tkpCouponGcTrValue(horse){
  const sources=[horse?.tr_ganyan_source,horse?.tr_source].map(v=>String(v??'').trim().toUpperCase());
  if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
  for(const raw of [horse?.tr_ganyan,horse?.tr_puan]){
    if(raw==null||String(raw).trim()==='')continue;
    const value=Number(String(raw).replace(',','.'));if(Number.isFinite(value))return value;
  }
  return NaN;
}

function getTkpGapThreshold(){
  const bt = (typeof globalThis!=='undefined') ? globalThis.__tkpBacktestContext : null;
  if(bt && bt.enabled) return 0.30;
  // KRİTİK: bu fonksiyon HİÇBİR ZAMAN bloklamaz -- arama (kart × aday tam kupon
  // simülasyonu) saniyeler sürebilir; "Kupon Oluştur" butonuna tıklayan kullanıcı
  // bunu asla beklememeli. Mevcut (önceki turdan öğrenilmiş ya da varsayılan) değer
  // anında döndürülür; veri değiştiyse yeniden ayarlama arka planda tetiklenir ve bir
  // sonraki kupon oluşturmada hazır olur.
  // _tkpGapTuningScheduled bayrağı, tek bir kupon oluşturma çağrısı içinde
  // getTkpGapThreshold() onlarca kez (her ayak/her mod için) tekrar tekrar
  // çağrıldığında aynı aramanın onlarca kez kuyruğa girmesini engeller -- önceden bu
  // bayrak yoktu ve arka plan öğrenme süresi bu yüzden dakikalarca sürebiliyordu.
  // Yalnız yarış SAYISINI anahtar yapmak güvenli değildir: aynı 509 yarışın sonucu
  // veya pre-race alanı yerinde düzeltilirse uzunluk değişmez ve eski eşik sessizce
  // kullanılmaya devam eder. Kalıcı learning_state.dataset_signature veri içeriği
  // değiştiğinde yenilenir; yoksa sayı tabanlı güvenli fallback korunur.
  let key='';
  try {
    const eligibleCount=learningEligibleRaces().length;
    const datasetSignature=String(db?.learning_state?.dataset_signature||'');
    key=datasetSignature ? `${eligibleCount}|${datasetSignature}` : String(eligibleCount);
  } catch(_) { key='0'; }
  if(_tkpGapThresholdCacheKey!==key && !_tuningTkpGapInProgress && !_tkpGapTuningScheduled){
    _tkpGapTuningScheduled=true;
    _scheduleIdle(()=>{ try { tuneTkpGapThreshold(key); } finally { _tkpGapTuningScheduled=false; } });
  }
  return _tkpGapThreshold;
}

function tuneTkpGapThreshold(key){
  _tuningTkpGapInProgress=true;
  let races=[]; try { races=learningEligibleRaces(); } catch(_) { races=[]; }
  const byFile={};
  for(const r of races){ (byFile[r.file_id]=byFile[r.file_id]||[]).push(r); }
  const fileSeq=new Map((db?.files||[]).map((f,i)=>[String(f?.id),Number(f?.sequence_no)||Number(f?.file_no)||i+1]));
  const cards=Object.values(byFile)
    .map(rs=>rs.slice().sort((a,b)=>a.leg-b.leg))
    .filter(rs=>rs.length===6 && rs.every(r=>(r.horses||[]).some(h=>h.winner===1||h.finish_position===1)))
    .sort((a,b)=>(fileSeq.get(String(a?.[0]?.file_id))||0)-(fileSeq.get(String(b?.[0]?.file_id))||0));

  if(cards.length<TKP_GAP_MIN_CARDS){
    _tkpGapThreshold=0.30; _tkpGapThresholdCacheKey=key; _tuningTkpGapInProgress=false; return;
  }

  const preparedCards=cards.map(card=>card.map(r=>{
    const horses=r.horses.map(h=>({...h}));
    const scored=typeof altiliWinnerOrderForRace==='function'
      ? altiliWinnerOrderForRace(r,horses)
      : strategicOrderForRace(r,horses);
    return {r,scored,top:scored[0],second:scored[1],third:scored[2],margin:0};
  }));

  // LEAKAGE-SAFE TEK EŞİĞİ: kronolojik %60 train / %20 validation / %20 holdout.
  // Aday eşik validation'da seçilir; holdout yalnız bir kez kabul kapısı olarak okunur.
  // Holdout'ta mevcut güvenli 0,30 eşiğinden kötüleşen aday canlıya ASLA geçmez.
  const n=preparedCards.length;
  const trainEnd=Math.max(1,Math.floor(n*.60));
  const validationEnd=Math.max(trainEnd+1,Math.floor(n*.80));
  const splitForIndex=i=>i<trainEnd?'train':(i<validationEnd?'validation':'holdout');
  let tuningBudget=1200;
  try{
    const saved=Number(db?.settings?.last_coupon_budgets?.main);
    const configured=typeof tkpCouponBudgetFor==='function'?Number(tkpCouponBudgetFor(saved||undefined,'main')):saved;
    if(Number.isFinite(configured)&&configured>0)tuningBudget=Math.max(1000,Math.min(1400,configured));
  }catch(_){ }

  // Tarayıcı tek iş parçacıklıdır; her simülasyondan sonra idle kuyruğuna geri dön.
  const jobs=[];
  for(const cand of TKP_GAP_CANDIDATES) preparedCards.forEach((rr,index)=>jobs.push({cand,rr,split:splitForIndex(index)}));
  const scoreByCand={}; TKP_GAP_CANDIDATES.forEach(c=>{ scoreByCand[c]={train:{hits:0,total:0},validation:{hits:0,total:0},holdout:{hits:0,total:0}}; });
  const CHUNK=1;
  let idx=0;

  function step(){
    let processed=0;
    while(idx<jobs.length && processed<CHUNK){
      const job=jobs[idx];
      _tkpGapThreshold=job.cand;
      let solid=null; try { solid=buildSolidCoupon(job.rr,tuningBudget); } catch(_) { solid=null; }
      if(solid && !solid.error){
        let allHit=true;
        for(const l of solid.legs){
          const w=(l.r.horses||[]).find(h=>h.winner===1||h.finish_position===1);
          if(w && !l.picks.some(h=>String(h.horse_no)===String(w.horse_no))) allHit=false;
        }
        const s=scoreByCand[job.cand][job.split]; s.total++; if(allHit) s.hits++;
      }
      idx++; processed++;
    }
    if(idx<jobs.length){ _scheduleIdle(step); return; }

    const rate=(s)=>s?.total?s.hits/s.total:0;
    const baseline=0.30;
    // Train yalnız örnek yeterliliğini sağlar; seçim validation'da yapılır.
    const viable=TKP_GAP_CANDIDATES.filter(c=>scoreByCand[c].train.total>0&&scoreByCand[c].validation.total>0);
    const selected=(viable.length?viable:TKP_GAP_CANDIDATES).slice().sort((a,b)=>
      rate(scoreByCand[b].validation)-rate(scoreByCand[a].validation) ||
      rate(scoreByCand[b].train)-rate(scoreByCand[a].train) ||
      Math.abs(a-baseline)-Math.abs(b-baseline)
    )[0]??baseline;
    const selectedHoldout=scoreByCand[selected]?.holdout||{hits:0,total:0};
    const baselineHoldout=scoreByCand[baseline]?.holdout||{hits:0,total:0};
    const holdoutComparable=selectedHoldout.total>0&&baselineHoldout.total>0;
    const accepted=selected===baseline || (holdoutComparable && rate(selectedHoldout)+1e-12>=rate(baselineHoldout));
    const best=accepted?selected:baseline;

    _tkpGapThreshold=best;
    _tkpGapThresholdCacheKey=key;
    _tuningTkpGapInProgress=false;
    try{
      globalThis.__tkpGapTuningDiagnostics={version:'V1.1.318-CHRONO-HOLDOUT',cards:n,budget:tuningBudget,trainEnd,validationEnd,
        selectedCandidate:selected,accepted,activeThreshold:best,scoreByCand};
    }catch(_){ }
  }
  step();
}

function couponCanonicalTrackName(value){
  try {
  } catch (_) {}
  return String(value || '')
    .trim()
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chooseLegCountAndUnit(ranked, budgetTL){
  for (const L of [6,5,4,3].filter(L => L <= ranked.length)){
    let unit = ganyanUnitPrice(ranked[0].r.hippodrome, L);
    if (unit && unit <= budgetTL) return {L, unit};
  }
  return null;
}

function fillCoverage(legs, budgetTL, unit, candidateFn){
  let combos = 1;
  for (const l of legs) combos *= l.picks.length;
  let addable = legs.filter(l => !l.protectedFlag).sort((a,b) => a.baseScore - b.baseScore);
  let changed = true;
  while (changed){
    if(typeof tkpCouponCheck==='function')tkpCouponCheck();
    changed = false;
    for (const l of addable){
      let cands = candidateFn(l).filter(c => c && !l.picks.some(p => p.horse_no === c.horse_no));
      if (!cands.length) continue;
      let next = cands[0];
      let newCombos = combos / l.picks.length * (l.picks.length + 1);
      let newCost = unit * newCombos;
      if (newCost <= budgetTL){
        l.picks.push(next);
        combos = newCombos;
        changed = true;
      }
    }
  }
  return {cost: unit * combos, combos};
}

function tkpLegDistributionProfile(x,ordered){
  const live=(x?.scored||ordered||[]).filter(h=>h&&!isNonRunner(h));
  const n=live.length;
  const tkpOrder=live.slice().sort((a,b)=>tkpCouponVisibleScore(b)-tkpCouponVisibleScore(a));
  const agfOrder=live.slice().sort((a,b)=>(Number(b.agf)||0)-(Number(a.agf)||0));
  const profOrder=live.slice().sort((a,b)=>profileStrengthPct(x?.r,b)-profileStrengthPct(x?.r,a));
  const t1=Math.max(0,Number(tkpCouponVisibleScore(tkpOrder[0]))||0),t2=Math.max(0,Number(tkpCouponVisibleScore(tkpOrder[1]))||0);
  const p1=profileStrengthPct(x?.r,profOrder[0]||{}),p2=profileStrengthPct(x?.r,profOrder[1]||{});
  const a1=Number(agfOrder[0]?.agf)||0,a2=Number(agfOrder[1]?.agf)||0,a3=Number(agfOrder[2]?.agf)||0;
  const tkpGap=Math.max(0,t1-t2),tkpGapRatio=t1>0?tkpGap/t1:0;
  const profileGap=Math.max(0,p1-p2),agfGap=Math.max(0,a1-a2),top3Agf=a1+a2+a3;
  // Mutlak ham skor ölçeği zamanla değişebilir. Bu nedenle lider farkı, liderin
  // kendi puanına göre normalize edilir; aynı zamanda profil yüzdesi farkı ayrı okunur.
  const tkpNearCount=t1>0?tkpOrder.filter(h=>(Number(tkpCouponVisibleScore(h))||0)>=t1*.80).length:0;
  const profileNearCount=p1>0?profOrder.filter(h=>profileStrengthPct(x?.r,h)>=p1-8).length:0;
  const sameLeader=!!(agfOrder[0]&&profOrder[0]&&String(agfOrder[0].horse_no)===String(profOrder[0].horse_no));
  const coreAgreement=sameLeader&&!!(tkpOrder[0]&&String(tkpOrder[0].horse_no)===String(agfOrder[0].horse_no));
  let uncertainty=0;
  uncertainty+=t1<0.80?20:t1<1.20?10:2;
  uncertainty+=tkpGapRatio<.08?22:tkpGapRatio<.16?12:3;
  uncertainty+=tkpNearCount>=6?18:tkpNearCount>=4?12:tkpNearCount>=3?6:0;
  uncertainty+=p1<40?18:p1<60?10:2;
  uncertainty+=profileGap<7?16:profileGap<15?8:1;
  uncertainty+=profileNearCount>=6?14:profileNearCount>=4?9:profileNearCount>=3?4:0;
  uncertainty+=a1<12?18:a1<18?12:a1<28?6:1;
  uncertainty+=agfGap<3?14:agfGap<7?8:2;
  uncertainty+=top3Agf<38?14:top3Agf<52?7:1;
  uncertainty+=n>=14?10:n>=10?6:2;
  const cond=broadConditionKey(x?.r?.condition_family||x?.r?.condition_text||'');
  if(cond==='MAIDEN'||cond==='HANDİKAP')uncertainty+=8;
  if(coreAgreement)uncertainty-=15;else if(sameLeader)uncertainty-=7;
  return {n,tkpOrder,agfOrder,profOrder,t1,t2,tkpGap,tkpGapRatio,tkpNearCount,p1,p2,profileGap,profileNearCount,a1,a2,a3,agfGap,top3Agf,sameLeader,coreAgreement,uncertainty:Math.max(0,Math.min(100,uncertainty))};
}

function dynamicCoverageCount(x, ordered, singleDecision, mode='main'){
  const n=Math.max(1,(ordered||[]).length);
  if(singleDecision && singleDecision.isSingle) return 1;
  if(n<=2) return n;
  const distribution=tkpLegDistributionProfile(x,ordered);
  const {a1,top3Agf,tkpNearCount,profileNearCount}=distribution;
  const tkp80Count=(ordered||[]).filter(tkpScoreAtLeast80).length;
  const difficulty=distribution.uncertainty;

  // TEK olmayan ayakta kaç at yazılacağı Ayak Güveni + AGF dağılımıyla belirlenir.
  // Çok karışık ayakta 10 ata kadar çıkılabilir; bu yalnız kaotik dağılımda çalışır.
  let count=difficulty<18?2:difficulty<32?3:difficulty<46?4:difficulty<60?5:difficulty<74?6:difficulty<87?8:10;
  // Aynı puan bandında sıkışan atlar gerçek kapsam ihtiyacını gösterir: örneğin
  // 2-5-8-1-3-2 gibi farklı ayak kombinasyonları bu yakın aday sayılarından doğar.
  if(tkpNearCount>=5||profileNearCount>=5)count=Math.max(count,6);
  if(tkpNearCount>=7&&profileNearCount>=5)count=Math.max(count,8);
  const conf=Number(singleDecision?.confidence)||0;
  const confidenceCount=conf>=80?2:conf>=70?3:conf>=60?4:conf>=50?5:conf>=40?7:10;
  count=Math.max(count,confidenceCount);
  // AGF lideri düşükse veya ilk üç AGF toplamı zayıfsa ayağı daraltma.
  if(a1<18 || top3Agf<50) count=Math.max(count,6);
  if(a1<12 || top3Agf<38) count=Math.max(count,8);
  if(a1<10 && top3Agf<34 && n>=10) count=Math.max(count,10);
  if(mode==='surprise'||mode==='alt') count=Math.min(10,count+1);
  // TKP 0,80+ adayları yalnız birbirine yakınsa ayağı genişletir. Eski kural
  // salt aday sayısına bakıp belirgin liderli ayakta bile 3-4 at açıyordu.
  // Lider farkı varsa 2 atlı varyasyon korunur; sıkışık TKP bandında 3-4 at açılır.
  if(tkp80Count>=3&&distribution.tkpGapRatio<.16){
    count=Math.max(count,Math.min(n,2+Math.min(2,tkp80Count)));
  }
  if(typeof tkpLearnedCoverageCount==='function'){
    count=tkpLearnedCoverageCount(x?.r,mode,count);
  }
  // Aynı risk tabanı Ayak Önerisi, canlı kupon, A4 ve backtest yolunda TEK kaynaktan
  // uygulanır. Böylece ekranda 6/8/10 at önerilip final bütçe DP'sinde 4'e düşme olmaz.
  const riskTarget=typeof difficultRaceTargetCount==='function'?difficultRaceTargetCount(x):(typeof difficultRaceMinimumCount==='function'?difficultRaceMinimumCount(x):0);
  if(riskTarget) count=Math.max(count,riskTarget);
  return Math.max(2,Math.min(10,n,count));
}

// BMB / ODB / TKP ortak para-sinyali tanımı. Tahmin, üç kupon bandı ve yan bahis
// aynı atı farklı adlarla değerlendirip kapsam dışına atmasın diye tek kaynaktan okunur.
function hasCouponTkpSignal(h){
  if(!h) return false;
  // NOT (2026-08-12 leak/kalite denetimi): pre_race_tkp_score alanı artık hiçbir
  // yerde üretilmiyor; mevcut JSON'lardaki değerler kullanımdan kaldırılmış eski
  // V25.15 modelinin donmuş çıktısı (bkz. pre_race_tkp_version: 'V25.15-PRE-RACE-FROZEN').
  // Gerçek arşiv üzerinde ölçüldüğünde bu alanın >=0.30 eşiğini geçen atların gerçek
  // kazanma oranı %8,3 (rastgele/taban seviyesi) çıktı — yani sinyal değil gürültü.
  // Güncel modelin (TKP_SCORE_MODEL_VERSION) gerçek gücünü yansıtan tek güvenilir
  // dondurulmuş alan prediction_score_snapshot; o yoksa canlı score kullanılır.
  return Number(h.tkp_signal)===1 ||
    (historyStrengthForCandidate(h)>0 && Number(h.score||0)>=0.30);
}
function tkpCouponVisibleScore(h){
  if(!h)return NaN;
  // TEK ve kupon eşikleri yalnız kullanıcının ekranda gördüğü TKP ölçeğinde
  // değerlendirilir. Ham `score` ile görünür `tkp_display_score` farklı ölçek;
  // bunları aynı eşikte karıştırmak 1,20 kuralını yanlış biçimde genişletiyordu.
  try{
    if(typeof tkpVisibleDisplayScore==='function'){
      const visible=Number(tkpVisibleDisplayScore(h));
      if(Number.isFinite(visible))return visible;
    }
  }catch(_){ }
  for(const key of ['tkp_display_score','prediction_tkp_display_score_snapshot','prediction_visible_tkp_snapshot','score']){
    const value=Number(h[key]);
    if(Number.isFinite(value))return value;
  }
  return NaN;
}
function tkpScoreAtLeast80(h){return Number(tkpCouponVisibleScore(h))>=0.80;}
function tkpScoreAtLeast90(h){return Number(tkpCouponVisibleScore(h))>=0.90;}
function tkpScoreAtLeast120(h){return Number(tkpCouponVisibleScore(h))>=1.20;}
function tkpScoreAtLeast240(h){return Number(tkpCouponVisibleScore(h))>=2.40;}
function tkp80AndMoneyCandidates(r,ordered,mode='main'){
  const pool=(ordered||[]).filter(h=>h&&!isNonRunner(h));
  let learned=null;
  try{
    if(typeof tkpR156Clean509PriorScoreMap==='function') learned=tkpR156Clean509PriorScoreMap(r,pool,1);
  }catch(_){ }
  const learnedScore=h=>Number(learned?.get(h));
  const tkp=pool.filter(tkpScoreAtLeast80).sort((a,b)=>{
    const lp=learnedScore(b),la=learnedScore(a);
    return (Number.isFinite(lp)&&Number.isFinite(la)?lp-la:0)||(Number(b.score)||0)-(Number(a.score)||0);
  });
  const money=pool.filter(h=>Number(h.bmb)===1||(()=>{try{return typeof isOdbCandidate==='function'&&isOdbCandidate(h,r);}catch(_){return false;}})())
    .sort((a,b)=>tkpCouponStrengthCached(r,b,mode)-tkpCouponStrengthCached(r,a,mode));
  return {tkp:tkp.slice(0,mode==='main'?1:2),money:money.slice(0,2),learned509:!!learned};
}
function tkpHardLegBhOdbCandidates(x,ordered){
  // BH/ODB normal sıralamayı bozacak lider/TEK değildir. Yalnız dağılımı gerçekten
  // zor olan ayakta, BH'nin kendi "yakın kazanma" sıralamasından gelen aday korunur.
  const difficulty=raceDifficultyIndex(x);
  if(difficulty<62||typeof tkpBombHunterCandidates!=='function')return [];
  let rows=[];
  try{rows=tkpBombHunterCandidates(x?.r||{});}catch(_){rows=[];}
  const byNo=new Map((ordered||[]).map(h=>[String(h?.horse_no),h]));
  const normalized=(rows||[]).map(row=>{
    const h=byNo.get(String(row?.h?.horse_no??row?.horse_no??''))||row?.h||null;
    return {h,kind:String(row?.kind||'BOMBA').toUpperCase(),near:Number(row?.near_win_score),score:Number(row?.score)||0};
  }).filter(row=>row.h&&!isNonRunner(row.h));
  const byNear=(a,b)=>(Number(b.near)||0)-(Number(a.near)||0)||(Number(b.score)||0)-(Number(a.score)||0);
  // Bir BH: zor ayakta, piyasa dışı adaylar arasından en yüksek yakın-kazanma skoru.
  const bh=normalized.filter(row=>row.kind!=='ODB'&&Number.isFinite(row.near)&&row.near>=.36).sort(byNear)[0]||null;
  // ODB daha seçici: sadece çok zor ayakta ve BH modelinde göreli yakınlık eşiğini de geçerse.
  const odb=difficulty>=70?normalized.filter(row=>row.kind==='ODB'&&Number.isFinite(row.near)&&row.near>=.45).sort(byNear)[0]||null:null;
  return [bh,odb].filter(Boolean);
}
function hasCouponMoneySignal(r,h){
  if(!h || isNonRunner(h)) return false;
  const bmb=Number(h.bmb)===1;
  const odb=typeof isOdbCandidate==='function' && isOdbCandidate(h,r);
  const trProfile=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(r,h):null;
  let learnedProfile=false;
  // Bu özet 3.000+ geçmiş koşuyu tarayabilir. Kritik kupon yolunda cache yoksa
  // bekletmez; boşta çalışan rafinasyon tamamlandığında aynı sinyal yeniden okunur.
  // BMB/ODB/TR ve mevcut TKP kanıtları bu kapıdan bağımsız korunur.
  try{
    const ready=globalThis.__tkpAllowCouponHistoricalEvidence===true
      &&typeof tkpWinnerComboSummaryReady==='function'&&tkpWinnerComboSummaryReady(r);
    const hist=ready&&typeof tkpWinnerComboStatsForHorse==='function'?tkpWinnerComboStatsForHorse(r,h):null;
    learnedProfile=!!(hist?.best&&hist.best.starts>=8&&hist.best.winRate>=0.18);
  }catch(_){}
  return bmb || odb || !!trProfile?.hardCoupon || !!trProfile?.isBmb || learnedProfile || hasCouponTkpSignal(h);
}
function couponMoneySignalCandidates(x,pool){
  return dedupeEkuri((pool||[]).filter(h=>hasCouponMoneySignal(x?.r,h)),x?.r,'surprise',true);
}

// V1.1.135 HİBRİT KUPON DENETÇİSİ:
// Ana model sıralamayı üretir; bu ikinci katman ise kupon oluşmadan önce "güçlü sinyal
// taşıyan at tamamen dışarıda mı?" sorusunu kontrol eder. Sonuç/winner alanı KULLANILMAZ.
function hybridCoverageSafetyAudit(x,picks,orderedPool,targetCount,mode='main',reliable=false){
  const original=(picks||[]).slice();
  if(reliable) return {picks:original,added:[],replaced:[]};
  const ordered=(orderedPool||[]).filter(h=>h&&!isNonRunner(h));
  if(!ordered.length) return {picks:original,added:[],replaced:[]};
  const top5Nos=new Set(ordered.slice(0,5).map(h=>String(h.horse_no)));
  const signalReason=h=>{
    const reasons=[];
    if(Number(h?.bmb)===1) reasons.push('BMB');
    if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,x?.r)) reasons.push('ODB');
    const prof=Number(typeof profileStrengthPct==='function'?profileStrengthPct(x?.r,h):0)||0;
    if(prof>=50) reasons.push(`PROF %${Math.round(prof)}`);
    // İlk-5 çekirdeğinde güçlü ek destek varsa hibrit bunu da kayıp adayı olarak görür.
    if(top5Nos.has(String(h?.horse_no))){
      if(Number(h?.tr_ganyan_rank)>0&&Number(h.tr_ganyan_rank)<=3) reasons.push('TR');
      if(Number(h?.galop_rank)>0&&Number(h.galop_rank)<=3) reasons.push('DRC/GALOP');
    }
    return reasons;
  };
  const candidates=ordered.filter(h=>signalReason(h).length>0);
  let out=dedupeEkuri(original,x?.r,mode,true);
  const added=[],replaced=[];
  const selected=()=>new Set(out.map(h=>String(h.horse_no)));
  const protectedNow=h=>signalReason(h).length>0 || ordered.slice(0,2).some(z=>String(z.horse_no)===String(h.horse_no));
  for(const cand of candidates){
    if(selected().has(String(cand.horse_no))) continue;
    if(out.length<Math.max(1,Number(targetCount)||out.length+1)){
      out.push(cand); added.push({horse:cand,reasons:signalReason(cand)}); continue;
    }
    // Kontenjan doluysa kuyruktaki korumasız en zayıf adayı takas et. İlk iki çekirdek ve
    // diğer BMB/ODB/X adayları birbirini feda edemez.
    let idx=-1;
    for(let i=out.length-1;i>=0;i--){ if(!protectedNow(out[i])){ idx=i; break; } }
    if(idx>=0){
      const removed=out[idx]; out[idx]=cand; replaced.push({in:cand,out:removed,reasons:signalReason(cand)});
    }
  }
  out=dedupeEkuri(out,x?.r,mode,true);
  const rank=new Map(ordered.map((h,i)=>[String(h.horse_no),i]));
  out.sort((a,b)=>(rank.get(String(a.horse_no))??999)-(rank.get(String(b.horse_no))??999));
  const signals=[...new Set([...added.flatMap(z=>z.reasons||[]),...replaced.flatMap(z=>z.reasons||[])])];
  return {picks:out,added,replaced,signals};
}


// TEK OLMAYAN AYAKTA PROFİL KAPSAM TABANI:
// İlk iki aday her zaman korunur. İlk dört tahmin içinde 3. veya 4. adayın Profil
// Gücü %69 ve üzerindeyse lider gruba çok yakındır ve kapsam sırasıyla 3/4 ata çıkar.
// Örnek: %70, %70, %50 => 2 at; %70, %70, %69 => 3 at.
function profileCoverageFloorForLeg(r,ordered){
  const rows=(ordered||[]).filter(h=>h&&!isNonRunner(h)).slice(0,4);
  if(!rows.length) return 0;
  let floor=Math.min(2,rows.length);
  for(let i=2;i<rows.length;i++){
    if(profileStrengthPct(r,rows[i])>=69) floor=i+1;
  }
  return floor;
}

let _tkpCouponStrengthBuildCache=new WeakMap();
function tkpBeginCouponStrengthBuild(){
  _tkpCouponStrengthBuildCache=new WeakMap();
  try{if(typeof tkpResetAdaptiveCompositeCriticalCache==='function')tkpResetAdaptiveCompositeCriticalCache();}catch(_e){}
}
function tkpCouponStrengthCached(r,h,mode='main'){
  if(typeof tkpCouponCheck==='function')tkpCouponCheck();
  if(!r||!h||typeof couponCandidateStrength!=='function')return 0;
  let raceCache=_tkpCouponStrengthBuildCache.get(r);
  if(!raceCache){raceCache=new WeakMap();_tkpCouponStrengthBuildCache.set(r,raceCache);}
  let horseCache=raceCache.get(h);
  if(!horseCache){horseCache=new Map();raceCache.set(h,horseCache);}
  const key=String(mode||'main');
  if(horseCache.has(key))return horseCache.get(key);
  const value=couponCandidateStrength(r,h,mode);
  horseCache.set(key,value);
  return value;
}
let _tkpLegCoveragePlanCache=new WeakMap();
function legCoveragePlanFingerprint(x,mode){
  const r=x?.r||{};
  const rows=(x?.scored&&x.scored.length?x.scored:(r.horses||[]));
  const dataRevision=typeof db==='object'&&db
    ? `${db.files?.length||0}:${db.races?.length||0}:${db.learning_state?.dataset_signature||''}` : '';
  return [mode,dataRevision,r.id||'',r.file_id||'',r.leg||'',r.condition_family||'',r.surface||'',r.distance||'',
    ...rows.map(h=>[
      h?.horse_no,h?.score,h?.prediction_score_snapshot,h?.altili_winner_score,h?.agf,h?.agf_rank,h?.result_rank,
      h?.result_score,h?.sonuc_puani,h?.sonuc_sirasi,h?.ods_result_score,h?.ods_result_rank,h?.ods_sonuc_puani,h?.ods_sonuc_sirasi,
      h?.tr_ganyan,h?.tr_puan,h?.tr_ganyan_source,h?.tr_source,h?.tr_rank,h?.team_strength_pct,h?.prof,
      h?.ypuan,h?.value_score,h?.value_rank,h?.hndkp,h?.hndkp_rank,h?.jbyg,h?.team_strength_pct,h?.bmb,h?.odb,
      h?.son6_raw,h?.priorStarts,h?.priorWins,h?.priorAccurateAvgSpeed,h?.priorAccurateFinishSignal,
      'X_SHADOW_ONLY','X_SHADOW_ONLY',false,false
    ].join(','))
  ].join('|');
}
function cloneLegCoveragePlan(plan){
  return {...plan,
    picks:(plan?.picks||[]).slice(),
    orderedPool:(plan?.orderedPool||[]).slice(),
    moneySignalPicks:(plan?.moneySignalPicks||[]).slice(),
    singleDecision:plan?.singleDecision?{...plan.singleDecision}:plan?.singleDecision,
    decisionPolicy:plan?.decisionPolicy?{...plan.decisionPolicy}:plan?.decisionPolicy
  };
}

function legCoveragePlan(x, mode='main'){
  if(typeof tkpCouponCheck==='function')tkpCouponCheck();
  const cacheable=x&&typeof x==='object';
  const fingerprint=cacheable?legCoveragePlanFingerprint(x,mode):'';
  const cachedByMode=cacheable?_tkpLegCoveragePlanCache.get(x):null;
  const cached=cachedByMode?.get(fingerprint);
  const planMetrics=globalThis.__tkpCoveragePlanMetrics||(globalThis.__tkpCoveragePlanMetrics={hit:0,miss:0});
  if(cached){ planMetrics.hit++; return cloneLegCoveragePlan(cached); }
  planMetrics.miss++;
  const finishPlan=plan=>{
    if(cacheable){
      const bucket=cachedByMode||new Map();
      bucket.set(fingerprint,cloneLegCoveragePlan(plan));
      if(bucket.size>6) bucket.delete(bucket.keys().next().value);
      _tkpLegCoveragePlanCache.set(x,bucket);
    }
    return cloneLegCoveragePlan(plan);
  };
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x?.r||x)){
    const frozen=typeof tkpArchivedOrderedRows==='function'
      ?tkpArchivedOrderedRows({r:x?.r||x,scored:x?.scored||x?.r?.horses||[]})
      :(x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h)).slice();
    if(!frozen.length)return finishPlan({picks:[],reliable:false,strength:0,margin:0,orderedPool:[],leaderFloorCount:0,moneySignalPicks:[],reason:'Aday yok'});
    // Salt-okunur arşivde kayıtlı sıra değişmez; yeniden profil/öğrenme taraması
    // kupon görünümüne bilgi eklemez. Alan büyüklüğüne göre güvenli, sınırlı bir
    // kapsama tabanı kurulur ve bütçe DP'si son maliyeti yine doğrular.
    const count=Math.min(frozen.length,frozen.length>=14?5:frozen.length>=10?4:3);
    const picks=frozen.slice(0,count);
    return finishPlan({picks,reliable:false,strength:Number(frozen[0]?.altili_winner_score)||0,margin:0,
      singleDecision:{isSingle:false,confidence:0,threshold:68,reason:'Arşiv frozen sıra'},
      orderedPool:frozen,leaderFloorCount:Math.min(count,4),moneySignalPicks:[],protectMoneySignals:false,
      reason:'Arşiv frozen sıra · yeniden öğrenme taraması yok'});
  }
  // Normal/Geniş/Sürpriz Altılıların üçü de aynı Tahmin 1 (gerçek birinci) sırasından
  // başlar. Kupon türü yalnız kapsam ve senaryo dağılımını değiştirir; p2-p5 modeli
  // Altılı aday sırasına hiçbir noktadan sızamaz.
  let pool=typeof altiliWinnerOrderForRace==='function'
    ? altiliWinnerOrderForRace(x.r,(x?.scored&&x.scored.length)?x.scored:(x.r?.horses||[]))
    : (Array.isArray(x?.scored)&&x.scored.length?x.scored.slice():strategicOrderForRace(x.r,x.r?.horses||[]));

  if (!pool.length) return finishPlan({picks:[], reliable:false, strength:0, margin:0, reason:'Aday yok'});
  // V1.1.334: Üç kupon türü de aynı yarış-öncesi olasılık omurgasını kullanır.
  // Bu katman yalnız izinli kaynaklardan gelen J-BYG/GLP/TR ile gerçek BMB/ODB
  // sinyallerini değerlendirir; sonuç/ikramiye alanlarını okumaz. Eski motor
  // yalnız yeni katman yüklenemezse güvenli geri dönüş olarak kalır.
  let ordered = typeof tkpProbabilityPortfolioOrderForRace==='function'
    ? tkpProbabilityPortfolioOrderForRace(x.r,pool,mode)
    : pool;
  if (typeof tkpProbabilityPortfolioOrderForRace!=='function' && mode === 'alt' && pool.length > 1){
    // Geniş kuponun TEK kararı forcedSinglePickMap tarafından ayrıca verilir.
    // Kapsama sırasını burada 2. adayı yapay biçimde lider yaparak bozmak yerine,
    // ilk beş çekirdeği koruyan dengeli portföy kuyruğu kullanılır.
    ordered=typeof tkpPortfolioOrderForRace==='function'
      ? tkpPortfolioOrderForRace(x.r,pool,'alt')
      : pool.slice();
  }
  if (typeof tkpProbabilityPortfolioOrderForRace!=='function' && mode === 'surprise'){
    // V55 UZMAN + KULİS: Champion omurgası; yüklenen yorumcular/Y.PUAN,
    // X-Twitter kulis, AGF, profil ve BMB/ODB/TR kanıtıyla yarış öncesinde harmanlanır.
    // winner/finish/payout alanları bu sıraya hiçbir şekilde giremez.
    ordered=typeof tkpV55ExpertOrderForRace==='function'
      ? tkpV55ExpertOrderForRace(x.r,pool)
      : (typeof tkpPortfolioOrderForRace==='function'?tkpPortfolioOrderForRace(x.r,pool,'surprise'):pool.slice());
  }
  const first=ordered[0], second=ordered[1];
  const strength=typeof altiliWinnerScoreForHorse==='function'
    ? altiliWinnerScoreForHorse(x.r,first)/100
    : conditionSingleStrength(x.r, first);
  const secondStrength=second
    ? (typeof altiliWinnerScoreForHorse==='function'?altiliWinnerScoreForHorse(x.r,second)/100:conditionSingleStrength(x.r,second))
    : 0;
  const margin=strength-secondStrength;
  // Tek için hem mutlak güç hem rakibe fark gerekir. Zayıf veride zorla tek üretilmez.
  const singleDecision=dynamicSingleDecision(x,first,second,strength,margin);
  // Benter kuralı: piyasa verisi varken "iyi at" ile "iyi fiyat" ayrıdır.
  // Değeri negatif lider Altılıda kapsamda kalabilir, fakat tek diye pazarlanmaz.
  // Piyasa yoksa fail-closed olarak mevcut TEK mantığı korunur; veri yok diye
  // sahte bir negatif değer cezası üretmeyiz.
  const benter=first&&typeof first==='object'?{
    status:String(first.tkp_benter_status||''),label:String(first.tkp_benter_label||''),
    marketSource:String(first.tkp_benter_market_source||''),edge:Number(first.tkp_benter_edge)
  }:null;
  if(singleDecision.isSingle&&benter&&benter.marketSource&&benter.marketSource!=='YOK'&&benter.status==='DEGER_YOK'){
    singleDecision.isSingle=false;
    singleDecision.benterVeto=true;
    singleDecision.reason='Benter değer yok · TEK genişletildi';
  }
  const hiddenFavs=ordered.filter(h=>{
    const p=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(x.r,h,ordered):null;
    return !!p?.hardCoupon;
  });
  const hiddenFavConflict=singleDecision.isSingle && hiddenFavs.some(h=>String(h.horse_no)!==String(first?.horse_no));
  let reliable=singleDecision.isSingle && !hiddenFavConflict;
  if(hiddenFavConflict){
    singleDecision.isSingle=false;
    singleDecision.reason='TR Gizli Favori koruması · TEK genişletildi';
  }
  // At sayısı sabit 4 değildir. Koşu tipi, alan büyüklüğü, TKP liderinin gücü/farkı,
  // AGF yoğunluğu ve BMB/ODB sinyal derinliğine göre 2-8 arasında dinamik belirlenir.
  let count = dynamicCoverageCount(x, ordered, singleDecision, mode);
  // R16.57: Altılıdaki TEK/DAR/GENİŞ kararı artık tek bir ortak öğrenme
  // katmanından gelir. Katman, 17 yarış-öncesi parametrenin güncel uzlaşmasını
  // ve sadece geçmiş resmî sonuç + dondurulmuş tahmin sırasını kullanır.
  // Puan sırasını değiştirmez; yalnız aynı sıralamanın kaç ata kadar taşınacağını
  // ve istatistiksel olarak zayıf liderin TEK olup olamayacağını belirler.
  let decisionPolicy=null;
  try{
    decisionPolicy=typeof tkpAdaptiveDecisionPolicy==='function'
      ?tkpAdaptiveDecisionPolicy(x.r,ordered,{mode,product:'altili',position:1,fallback:count})
      :null;
  }catch(_){decisionPolicy=null;}
  if(decisionPolicy?.status==='ÖĞRENİLDİ'){
    count=Math.max(1,Number(decisionPolicy.coverage)||count);
    singleDecision.decisionPolicy={
      version:decisionPolicy.version,sample:decisionPolicy.sample,profileSample:decisionPolicy.profileSample,
      tier:decisionPolicy.tier,leaderRate:decisionPolicy.leaderRate,confidence:decisionPolicy.confidence,
      featureCount:decisionPolicy.consensus?.featureCount||0,preRaceOnly:true
    };
    if(singleDecision.isSingle&&decisionPolicy.singleBlocked===true){
      singleDecision.isSingle=false;
      reliable=false;
      singleDecision.reason=`${singleDecision.reason} · 17-parametre geçmiş P1 veto · kapsam genişletildi`;
    }
  }
  let allResultPolicy=null;
  try{allResultPolicy=typeof tkpAllResultCouponPolicy==='function'
    ?tkpAllResultCouponPolicy(x.r,mode,count,ordered):null;}catch(_){allResultPolicy=null;}
  if(allResultPolicy?.status==='ÖĞRENİLDİ'){
    // Geçmişte bu profil hangi sıraya kadar kazanan veriyorsa, kapsama o noktada
    // başlar. Canlı zor-ayak tabanı alttan korur; sonuç verisi canlı sıralamaya girmez.
    const hardFloor=Math.max(2,Number(difficultRaceMinimumCount(x))||0);
    count=Math.max(hardFloor,Number(allResultPolicy.coverage)||count);
    singleDecision.allResultPolicy={sample:allResultPolicy.sample,profileSample:allResultPolicy.profileSample,leaderRate:allResultPolicy.leaderRate,confidence:allResultPolicy.confidence,singleEligible:allResultPolicy.singleEligible};
  }
  // Zor/karışık ayakta Ayak Önerisi dört atla erken kesilmemeli. Tek kararı
  // oluşmadıysa görünür TKP'si 0,85 ve üzerindeki adayların tamamı kapsama
  // alınır; bütçe daraltması daha sonra yalnız kupon kopyasında yapılır.
  if(!singleDecision.isSingle){
    const strongFloorCount=ordered.filter(h=>Number(h?.score)>=0.85).length;
    if(strongFloorCount>count)count=strongFloorCount;
    if((Number(singleDecision.sample)||0)<10)count=Math.max(count,Math.min(6,ordered.length));
  }
  count=Math.min(count, ordered.length);
  // Normal kupon gösterilen Tahmin ön ekini aynen korur. Geniş ve özellikle
  // Sürpriz kupon, aynı ön eki kopyalayan üçüncü bilet olmamalıdır: ilk dört
  // çekirdekten sonrası kendi senaryo sırasından gelir.
  const leaderFloorCount=mode==='main'?count:Math.min(count,4);
  // KRİTİK (V25.7 düzeltmesi): tam sıralı havuz da (dedupeEkuri uygulanmış) döndürülüyor.
  // orderedCandidatesForBudget() artık kendi bağımsız strategicOrderForRace/sıralama
  // hesabını yapmıyor; gerçek kuponu üreten minimumCostCoverage() da BU havuzdan besleniyor.
  // Böylece "Ayak Önerisi" (Genel Bakış), Normal/Geniş/Sürpriz Kupon ve manuel "at ekle"
  // listesi ARTIK TEK BİR sıralamayı paylaşıyor; üç ayrı hesap birbirinden bağımsız
  // sürüklenip farklı at listeleri üretemiyor.
  const orderedPool=dedupeEkuri(ordered.slice(), x.r, mode, true);
  // KÖK FIX (V1.1.106): `picks` (asıl "X AT YAZILMALI" listesi + kuponun kendisi)
  // ham `ordered`'dan dilimleniyordu -- hemen üstteki `orderedPool` ise AYNI
  // kaynaktan dedupeEkuri() ile arındırılmıştı ama yalnız "at ekle"/bütçe akışında
  // kullanılıyordu. Sonuç: aynı eküri grubunun İKİ ortağı (ör. "3-E1" ve "9-E1",
  // ekuriGroup() bunları aynı "E1" grubuna sokar) ikisi de üst sıralarda ise HER
  // İKİSİ de picks'e giriyor, oysa "eküri ortakları bahis hesabında tek seçimdir"
  // (bkz. core-utils.js ekuriDisplayHorses yorumu) -- ikinci ortak kuponda gereksiz
  // bir yuva işgal ediyor ve o yuva bağımsız (farklı gruptan) bir adaya gidemiyordu.
  // Artık picks de aynı zaten-hesaplanmış deduped orderedPool'dan dilimleniyor;
  // "Ayak Önerisi", Kupon ve manuel liste üçü de artık AYNI arındırılmış sıradan besleniyor.
  let picks=orderedPool.slice(0,count);
  // TR1 + AGF4-6 = GİZLİ FVR: final kupon budaması öncesinde kesin kapsama alınır.
  // Bu, kaynak BMB alanını değiştirmez; ayrı TR davranış profilidir.
  if(hiddenFavs.length){
    const selectedNos=new Set(picks.map(h=>String(h.horse_no)));
    for(const h of hiddenFavs){
      if(!selectedNos.has(String(h.horse_no))){ picks.push(h); selectedNos.add(String(h.horse_no)); }
    }
    picks=dedupeEkuri(picks,x.r,mode,true);
    tkpStableOrderSort(picks, ordered);
  }
  // KULLANICI TALİMATI (kesin bulgu): Kupon (minimumCostCoverage) artık gerçek geçmiş
  // kazananları (isPastWinningExtra) ve değer bandı adaylarını (valueBandMatch) zorunlu
  // ekliyor -- ama Ayak Önerisi'nin kaynağı olan BU fonksiyon bunları hiç bilmiyordu.
  // Sonuç: Kupon "3/5/7/10" yazarken Ayak Önerisi hâlâ "3/5/7" diyordu (at 10 -- gerçek
  // geçmiş kazanan, Profil Gücü %21 -- sessizce eksik kalıyordu). Artık Ayak Önerisi de
  // AYNI iki kuralı uyguluyor; Kupon ile Ayak Önerisi bir daha bu yönde de ayrışmaz.
  if(!reliable){
    const selected=new Set(picks.map(h=>String(h.horse_no)));
    const pastWinnerExtra=ordered.filter(h=>!selected.has(String(h.horse_no)) && isPastWinningExtra(x.r,h))
      .sort((a,b)=>tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode))[0];
    if(pastWinnerExtra){ picks=picks.concat([pastWinnerExtra]); selected.add(String(pastWinnerExtra.horse_no)); }
    const valueCands=ordered.filter(h=>valueBandMatch(h,x.r) && !selected.has(String(h.horse_no)))
      .sort((a,b)=>(valueBandScore(b,x.r)-valueBandScore(a,x.r))||(tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode)));
    if(valueCands.length){ picks=picks.concat([valueCands[0]]); selected.add(String(valueCands[0].horse_no)); }
    // Sabit "VALUE" etiketi eski bir yardımcı sinyaldir. Benter güçlü değeri ise
    // model + canlı piyasa karşılaştırmasının sonucudur; zor ayakta kapsama
    // dışına düşmesine izin vermeyiz, fakat at sayısını yalnız bir aday büyütür.
    const benterValue=ordered.filter(h=>!selected.has(String(h.horse_no))&&String(h?.tkp_benter_status||'')==='GUCLU_DEGER')
      .sort((a,b)=>Number(b?.tkp_benter_edge||-99)-Number(a?.tkp_benter_edge||-99))[0];
    if(benterValue){picks=picks.concat([benterValue]);selected.add(String(benterValue.horse_no));}
    tkpStableOrderSort(picks, ordered);
  }
  // V1.1.83 DAR AYAK + BMB KORUMASI: Kupon planı tam iki ata düştüyse ve bu iki atın
  // dışında gerçek bir BMB adayı varsa, yalnız en güçlü BMB üçüncü at olarak eklenir.
  // Amaç 2-atlık dar ayakta kanıtlı bomba sinyalini tamamen dışarıda bırakmamaktır.
  // BMB zaten seçiliyse veya ayak TEK ise ekleme yapılmaz; 3+ atlı ayaklar şişirilmez.
  let narrowBmbExtra=null;
  if(!reliable && picks.length===2){
    const selectedNos=new Set(picks.map(h=>String(h.horse_no)));
    narrowBmbExtra=ordered.filter(h=>{
      if(selectedNos.has(String(h.horse_no))||isNonRunner(h)) return false;
      if(Number(h?.bmb)===1) return true;
      const p=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(x.r,h,ordered):null;
      return !!p?.isBmb;
    }).sort((a,b)=>tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode))[0]||null;
    if(narrowBmbExtra){
      picks=dedupeEkuri(picks.concat([narrowBmbExtra]),x.r,mode,true);
      tkpStableOrderSort(picks, ordered);
    }
  }
  // Çoklu/zor ayaklarda ve Sürpriz bandında BMB, ODB veya TKP sinyalli adaylar
  // kupon üreticisine öncelikli aday olarak aktarılır. Burada at sayısı büyütülmez:
  // aksi hâlde 750–800 / 1200–1600 / 750–800 TL kupon iskeleti daha kupon kurulmadan bozuluyordu.
  const hybridAudit=hybridCoverageSafetyAudit(x,picks,orderedPool,count,mode,reliable);
  picks=hybridAudit.picks;
  const hardBhOdbPicks=!reliable?tkpHardLegBhOdbCandidates(x,orderedPool):[];
  if(hardBhOdbPicks.length){
    const selected=new Set(picks.map(h=>String(h?.horse_no)));
    for(const row of hardBhOdbPicks){
      if(!selected.has(String(row.h.horse_no))){picks.push(row.h);selected.add(String(row.h.horse_no));}
    }
    picks=dedupeEkuri(picks,x.r,mode,true);
    tkpStableOrderSort(picks,ordered);
  }
  const protectMoneySignals=!reliable && (leaderFloorCount>=5 || raceDifficultyIndex(x)>=62 || mode==='surprise');
  const moneySignalPicks=protectMoneySignals?couponMoneySignalCandidates(x,ordered):[];
  return finishPlan({picks, reliable, strength, margin, singleDecision, decisionPolicy, allResultPolicy, orderedPool,leaderFloorCount,moneySignalPicks,protectMoneySignals,narrowBmbExtra,hybridAudit,hardBhOdbPicks,
    reason: reliable ? `Güvenilir tek · güven %${singleDecision.confidence} / eşik %${singleDecision.threshold}` : `${singleDecision.reason} · ${count>=4?'En geniş kapsama':'Geniş kapsama'}${hardBhOdbPicks.length?` · zor ayak ${hardBhOdbPicks.map(row=>row.kind).join('+')} koruması`:''}${(hybridAudit.added.length||hybridAudit.replaced.length)?` · Hibrit kapsam: ${(hybridAudit.signals||[]).join(' / ')||'güçlü sinyal'}`:''}${benter?.status==='GUCLU_DEGER'?' · Benter güçlü değer adayını koru':''}`,benter});
}

function dedupeEkuri(pool, r=null, mode='main', useInputOrder=false){
  const out=[];
  const groupIndex=new Map();
  const exactIndex=new Map();
  for(const h of (pool||[])){
    if(!h) continue;
    const exactKey=String(h.horse_no||'').trim().toUpperCase();
    if(!exactKey) continue;

    // KRİTİK: Aynı at numarası farklı kurallardan tekrar eklenmiş olsa bile tek kez tutulur.
    if(exactIndex.has(exactKey)){
      // useInputOrder=true: pool zaten Ayak Önerisi'nin kullandığı sırada (strategicOrderForRace
      // kaynaklı); ilk karşılaşılan (yani o sırada daha önde olan) korunur, ayrı bir güç
      // hesabıyla değiştirilmez. Böylece Kupon, Ayak Önerisi'nin "hangi eküri atı daha güçlü"
      // kararıyla asla çelişmez.
      if(useInputOrder) continue;
      if(r){
        const idx=exactIndex.get(exactKey);
        const prev=out[idx];
        if(tkpCouponStrengthCached(r,h,mode) > tkpCouponStrengthCached(r,prev,mode)) out[idx]=h;
      }
      continue;
    }

    const group=ekuriGroup(h.horse_no);
    if(!group){
      exactIndex.set(exactKey,out.length);
      out.push(h);
      continue;
    }
    if(!groupIndex.has(group)){
      groupIndex.set(group,out.length);
      exactIndex.set(exactKey,out.length);
      out.push(h);
      continue;
    }
    // Aynı eküri grubundan yalnızca en güçlü temsilci kalır.
    if(useInputOrder) continue;
    if(r){
      const idx=groupIndex.get(group);
      const prev=out[idx];
      if(tkpCouponStrengthCached(r,h,mode) > tkpCouponStrengthCached(r,prev,mode)){
        exactIndex.delete(String(prev.horse_no||'').trim().toUpperCase());
        out[idx]=h;
        exactIndex.set(exactKey,idx);
      }
    }
  }
  return out;
}

function orderedCandidatesForBudget(x, mode='main'){
  // KRİTİK (V25.7 düzeltmesi): Önceden burada strategicOrderForRace'ten başlayan,
  // legCoveragePlan'dakinden TAMAMEN BAĞIMSIZ bir sıralama yeniden hesaplanıyordu
  // (x.top öne alma kuralı burada yoktu, alt/surprise sıralamaları da ayrı formüllerle
  // tekrar üretiliyordu). Bu, Normal Kupon'un asıl at listesinin (bu fonksiyondan gelir)
  // Ayak Önerisi/Genel Bakış'ın gösterdiği listeden (legCoveragePlan) sessizce
  // sapmasına yol açıyordu. Artık tek kaynak legCoveragePlan(x,mode).orderedPool.
  return legCoveragePlan(x,mode).orderedPool || [];
}

function nextBudgetCandidate(leg, mode){
  if(leg.maxCoverage&&leg.picks.length>=leg.maxCoverage) return null;
  const selected=new Set(leg.picks.map(h=>String(h.horse_no)));
  const remaining=leg.ordered.filter(h=>!selected.has(String(h.horse_no)));
  if(!remaining.length) return null;
  // Ana iskelet: AGF/TKP/Y.PUAN ilk 1-4 ve Y.PUAN >8 adayları bütçe elverdiği sürece
  // önce kapsanır. Böylece kupon ile ayak küçük tablosu aynı aday havuzundan beslenir.
  const coreRemaining=coreProtectionCandidates({r:leg.r,scored:leg.ordered||[]},leg.ordered||[]).filter(h=>!selected.has(String(h.horse_no)));
  if(coreRemaining.length) return coreRemaining[0];

  // KULLANICI TALİMATI: "Altılıya para verdiren" değer bandı (SONUÇ 6-8, AGF 6-11,
  // gerçek BMB/ODB ve ilk 8 dışı Y.PUAN 8-20 ODB adaylarından kapsam dışında kalanların TAMAMI, bütçe
  // elverdiği sürece sıradan Genel Bakış sırasının önüne geçirilir -- artık sadece
  // en güçlüsü değil, bütçe büyüdükçe hepsi kapsama girer. valueBandMatch artık
  // prediction-engine.js'teki ortak, canlı öğrenen (valueBandSignalWeights) sürüm.
  const valueRemaining=remaining.filter(valueBandMatch);
  if(valueRemaining.length){
    const v=valueRemaining.slice().sort((a,b)=>(valueBandScore(b,leg.r)-valueBandScore(a,leg.r))||(tkpCouponStrengthCached(leg.r,b,mode)-tkpCouponStrengthCached(leg.r,a,mode)))[0];
    if(v) return v;
  }
  // Ayak 5 veya daha fazla ata çıkıyorsa, varsa gerçek BMB'lerden 1-2 tanesi mutlaka kapsanır.
  const bmbAvailable=leg.ordered.filter(h=>h.bmb===1);
  const bmbSelected=leg.picks.filter(h=>h.bmb===1).length;
  const nextCount=leg.picks.length+1;
  const requiredBmb = nextCount>=5 ? Math.min(2,bmbAvailable.length) : 0;
  if(requiredBmb>bmbSelected){
    const b=remaining.filter(h=>h.bmb===1).sort((a,b)=>tkpCouponStrengthCached(leg.r,b,mode)-tkpCouponStrengthCached(leg.r,a,mode))[0];
    if(b) return b;
  }
  return remaining[0];
}


function couponAgfSupported(h){
  if(!h) return false;
  const rank=Number(h.agf_rank);
  const pct=Number(h.agf)||0;
  return (Number.isFinite(rank) && rank>=1 && rank<=3) || pct>=12;
}

function tkpHybridBombScore(r,h,ordered=[]){
  if(!h||isNonRunner(h))return 0;
  const agfRank=Number(h.agf_rank)||0;
  const bmbOdb=(Number(h.bmb)===1||isOdbCandidate(h))?100:0;
  const agfBand=agfRank>=6&&agfRank<=11?100:(agfRank>=4&&agfRank<=5?65:0);
  const surpriseHits=Math.max(0,Number(h.priorSurpriseHits)||0)+Math.max(0,Number(h.condSurpriseHits)||0);
  const histStrength=Math.max(0,Math.min(1,Number(historyStrengthForCandidate(h))||0));
  const profileMatch=historicalSurpriseProfileMatch(r,h)?.matched===true;
  const history=Math.max(0,Math.min(100,histStrength*70+surpriseHits*18+(profileMatch?25:0)));
  const yp=Number(h.ypuan)||0;
  const ypuan=yp>=8&&yp<=20?Math.max(45,100-Math.abs(14-yp)*8):Math.max(0,Math.min(40,yp*2));
  let value=0;
  if(valueBandMatch(h,r))value=Math.max(value,75);
  if(Number(h.gpr)>0)value=Math.max(value,Math.min(100,Number(h.gpr)*18));
  if(typeof tkpSurpriseEvidenceForHorse==='function'){
    try{value=Math.max(value,Math.min(100,Math.max(0,Number(tkpSurpriseEvidenceForHorse(r,h,ordered).score)||0)*45));}catch(_){ }
  }
  return Math.max(0,Math.min(100,0.30*bmbOdb+0.25*agfBand+0.20*history+0.15*ypuan+0.10*value));
}
function tkpHybridBombCandidates(x,ordered=[]){
  const pool=(ordered||[]).filter(h=>h&&!isNonRunner(h));
  const ranked=pool.map(h=>({h,score:tkpHybridBombScore(x?.r,h,pool)})).filter(row=>{
    const h=row.h,agf=Number(h.agf_rank)||0;
    const authentic=Number(h.bmb)===1||isOdbCandidate(h)||agf>=4||Number(h.priorSurpriseHits)>0||Number(h.condSurpriseHits)>0;
    return authentic&&row.score>=35;
  }).sort((a,b)=>b.score-a.score||tkpCouponStrengthCached(x.r,b.h,'surprise')-tkpCouponStrengthCached(x.r,a.h,'surprise'));
  if(!ranked.length)return [];
  const out=[ranked[0]];
  if(ranked[1]?.score>=60)out.push(ranked[1]);
  return out;
}

// Sürpriz senaryosu Normal'in ilk sırasını makyajlamaz; yarış öncesi değer ve
// tarihsel sürpriz profiliyle ayrı bir kuyruk kurar. `tkpHybridBombScore`
// içindeki geçmiş yarışlardan öğrenilmiş priorSurprise/condition profili bu
// puanın tarihsel kısmıdır. Sonuç, bitiriş ve ikramiye alanları bu yola girmez.
function tkpSurpriseContrarianScore(r,h,pool=[]){
  if(!h||isNonRunner(h))return -Infinity;
  let hybrid=0;try{hybrid=tkpHybridBombScore(r,h,pool)||0;}catch(_){ }
  const agfRank=Number(h.agf_rank)||99;
  const agfOut=agfRank>=4&&agfRank<=12?Math.max(0,100-Math.abs(8-agfRank)*8):0;
  const sp=Number(h.sp),oddsOut=Number.isFinite(sp)?Math.max(0,Math.min(100,(sp-3)*7)):0;
  const value=Number(h.value_score??h.value)>0?75:0;
  const bmb=Number(h.bmb)===1?100:0,odb=Number(h.odb)===1?100:0;
  const yp=Number(h.ypuan??h.y_puan)||0,ypuan=yp>=8&&yp<=20?Math.max(35,100-Math.abs(14-yp)*9):0;
  const history=Math.min(100,Math.max(0,(Number(h.priorSurpriseHits)||0)*18+(Number(h.condSurpriseHits)||0)*22+(Number(historyStrengthForCandidate(h))||0)*55));
  return hybrid*.52+agfOut*.12+oddsOut*.08+value*.08+bmb*.06+odb*.05+ypuan*.05+history*.04;
}
function tkpSurpriseContrarianOrder(r,pool=[]){
  const active=(pool||[]).filter(h=>h&&!isNonRunner(h));
  if(active.length<2)return active.slice();
  const scored=active.map((h,index)=>({h,index,score:tkpSurpriseContrarianScore(r,h,active)}));
  // Veri yoksa klasik sırayı yapay biçimde bozma; gerçek sinyal varsa kuyruk
  // mutlaka bu ayrı senaryonun sırasından yürür.
  if(!scored.some(x=>Number.isFinite(x.score)&&x.score>0))return active.slice();
  scored.sort((a,b)=>b.score-a.score||a.index-b.index);
  return scored.map(x=>x.h);
}

// "Sonuç Puanı" ODS'nin program açılırken dondurulan yarış-öncesi puan/sırasıdır.
// Yarış sonrası kesinleşen alanlar burada bilinçli olarak okunmaz. Böylece
// geçmiş backtest bilgisi bugünkü kupon sırasına sızamaz.
function tkpFrozenOdsResultRank(h){
  // Only explicitly captured pre-race ODS ranks are eligible. `result_rank` and
  // similarly named post-race fields must never influence a live coupon.
  for(const key of ['pre_race_ods_rank','ods_rank_snapshot','ods_pre_race_rank']){
    const value=Number(h?.[key]);if(Number.isFinite(value)&&value>0)return value;
  }
  return 99;
}
function tkpFrozenOdsResultScore(h){
  for(const key of ['ods_result_score','ods_sonuc_puani','sonuc_puani','result_score','pre_race_result_score']){
    const raw=h?.[key];if(raw==null||String(raw).trim()==='')continue;
    const value=Number(raw);if(Number.isFinite(value))return value;
  }
  return null;
}
function tkpCouponCorePriorityScore(r,h,pool){
  const live=(pool||r?.horses||[]).filter(x=>x&&!isNonRunner(x));
  const relative=(value,read)=>{
    if(!Number.isFinite(value))return 0;
    const values=live.map(read).filter(Number.isFinite);if(!values.length)return 0;
    const lo=Math.min(...values),hi=Math.max(...values);return hi>lo?(value-lo)/(hi-lo):.5;
  };
  const agfPct=Number(h?.agf),agfRank=Number(h?.agf_rank)||99;
  const agf=Number.isFinite(agfPct)&&agfPct>0?Math.min(1,agfPct/100):(agfRank<99?Math.max(0,1-(agfRank-1)/Math.max(1,live.length-1)):0);
  const odsScore=tkpFrozenOdsResultScore(h),odsRank=tkpFrozenOdsResultRank(h);
  // ODS Sonuç Puanı bir ceza/mesafe puanıdır: düşük ham puan ve küçük sıra daha
  // iyidir. Önce kanonik sıra kullanılır; sıra yoksa ham puan ters normalize edilir.
  const ods=odsRank<99
    ? Math.max(0,1-(odsRank-1)/Math.max(1,live.length-1))
    : (Number.isFinite(odsScore)?1-relative(odsScore,x=>tkpFrozenOdsResultScore(x)):0);
  const trValue=tkpCouponGcTrValue(h),tr=relative(trValue,tkpCouponGcTrValue);
  const profile=typeof profileStrengthPct==='function'?Math.max(0,Math.min(1,(Number(profileStrengthPct(r,h))||0)/100)):Math.max(0,Math.min(1,(Number(h?.team_strength_pct??h?.prof)||0)/100));
  const base=relative(Number(h?.score),x=>Number(x?.score));
  const rankSignal=value=>{const rank=Number(value);return Number.isFinite(rank)&&rank>0?Math.max(0,1-(rank-1)/Math.max(1,live.length-1)):0;};
  // glp_proxy/jbyg_proxy yalnız veri-var bayrağıdır; sıra diye okunursa bütün
  // bayraklı atlar yanlışlıkla 1. sıraya çıkar. Gerçek top-list sıraları kullanılır.
  // Ham 800m derecesi de sıra değildir; yalnız collector'ın ürettiği g800_rank
  // canlı kupon desteğine girebilir. Eksik değer, listedeki atların altında kalır.
  const glp=rankSignal(h?.galop_rank??h?.glp_rank);
  const jbyg=rankSignal(h?.jbyg_rank??h?.jbyg);
  const g800=rankSignal(h?.g800_rank);
  // 500 toplantı / 490 tam Altılı kronolojik 60/20/20 testinde doğrulanan canlı omurga:
  // AGF ana sıra; bugünden sonraki canlı ODS snapshot ikinci sıra; diğer veriler
  // ana favori sırasını ezmeden yalnız destek ve yakın-aday ayrımı yapar.
  return agf*60+ods*15+(Number(h?.bmb)===1?4:0)+(isOdbCandidate(h,r)?4:0)+tr*7+profile*2+glp*4+jbyg*2+g800+base;
}
function tkpOrderedForLeg(x){
  const pool=(x?.scored||[]).filter(h=>h && !isNonRunner(h));
  // Ayak tablosu, Ayak Onerisi ve uc kupon ayni ana sirayi kullanir. Onceki
  // surum burada AGF/ODS agirlikli ayri bir sira kurdugu icin tabloda ikinci
  // gorunen at kuponda lider veya TEK olabiliyordu. Gorunen TKP; AGF, PROF,
  // Y.PUAN, G.PR, DRC ve TR PUAN'i zaten birlestirir. Bu sirayi ikinci kez
  // baska agirliklarla bozmayiz.
  const visible=typeof v25SortGeneralOverviewRows==='function'
    ?v25SortGeneralOverviewRows(x?.r,pool)
    :pool.slice().sort((a,b)=>
      Number(tkpCouponVisibleScore(b))-Number(tkpCouponVisibleScore(a)) ||
      (Number(b.agf)||0)-(Number(a.agf)||0) ||
      (Number(b.ypuan)||0)-(Number(a.ypuan)||0) ||
      (Number(b.profile_strength_pct??b.prof)||0)-(Number(a.profile_strength_pct??a.prof)||0) ||
      (Number(b.tr_puan??b.tr_ganyan)||0)-(Number(a.tr_puan??a.tr_ganyan)||0)
    );
  return dedupeEkuri(visible,x?.r,'main');
}

function tkpFirstLookLeaderForLeg(x, snapshot=false){
  const rows=(x?.scored||x?.allHorses||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h));
  if(snapshot)return x?.top||rows[0]||null;
  return tkpOrderedForLeg({...x,scored:rows})[0]||x?.top||rows[0]||null;
}

function horseWeightKg(h){
  const raw=h?.weight_kg??h?.weightKg??h?.weight??h?.kilo??h?.kg??h?.siklet??h?.siklet_kg??'';
  const m=String(raw).replace(',','.').match(/\d+(?:\.\d+)?/);
  return m?Number(m[0]):null;
}
function canBeCouponSingle(h){
  // KG bir risk/feature girdisidir; hard veto değildir.
  return !!h;
}
function preferEnglishTie(r,a,b){
  const breed=fold(r?.breed||r?.breed_group||'');
  // TKP farkı çok küçükse ve adaylardan biri İngiliz, diğeri Arap ise İngiliz tercih edilir.
  const aBreed=fold(a?.breed||r?.breed||'');
  const bBreed=fold(b?.breed||r?.breed||'');
  const aEng=/İNG|ING|İNGİLİZ|INGILIZ/.test(aBreed||breed);
  const bEng=/İNG|ING|İNGİLİZ|INGILIZ/.test(bBreed||breed);
  if(aEng!==bEng) return aEng?-1:1;
  return 0;
}
function ypuanTopForLeg(pool, limit=4){
  return (pool||[]).filter(h=>(Number(h.ypuan)||0)>0).slice().sort((a,b)=>(Number(b.ypuan)||0)-(Number(a.ypuan)||0)||(Number(b.score)||0)-(Number(a.score)||0)).slice(0,limit);
}
function coreProtectionCandidates(x, ordered){
  const pool=(ordered||[]).filter(h=>h&&!isNonRunner(h));
  const xKulis=[];
  const agfTop=pool.filter(h=>Number(h.agf_rank)>=1 && Number(h.agf_rank)<=4).sort((a,b)=>Number(a.agf_rank)-Number(b.agf_rank));
  const odsTop=pool.filter(h=>tkpFrozenOdsResultRank(h)<99||Number.isFinite(tkpFrozenOdsResultScore(h))).sort((a,b)=>tkpFrozenOdsResultRank(a)-tkpFrozenOdsResultRank(b)||(tkpFrozenOdsResultScore(a)??Infinity)-(tkpFrozenOdsResultScore(b)??Infinity)).slice(0,4);
  const tkpTop=tkpOrderedForLeg(x).slice(0,4);
  const ypTop=ypuanTopForLeg(pool,4);
  const ypStrong=pool.filter(h=>(Number(h.ypuan)||0)>8).sort((a,b)=>(Number(b.ypuan)||0)-(Number(a.ypuan)||0));
  const bmbOdb=pool.filter(h=>h.bmb===1||isOdbCandidate(h)).sort((a,b)=>bmbOdbWinLikelihood(x.r,b)-bmbOdbWinLikelihood(x.r,a)||tkpCouponStrengthCached(x.r,b,'main')-tkpCouponStrengthCached(x.r,a,'main')).slice(0,3);
  return dedupeEkuri(xKulis.concat(agfTop,odsTop,bmbOdb,tkpTop,ypTop,ypStrong,pool),x.r,'main',true);
}

function bestPredictionRowsForLeg(x){
  const live=(x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h));
  // R16 Challenger: Champion/market anchor korunur; Market Residual + Pairwise +
  // race-type expert + position model meta sırası P2-P5 kapsamasını yeniden düzenler.
  // P1 yalnız R16 seçici TEK kapısı yeterli ayrışma bulursa değişebilir; aksi halde
  // mevcut Champion lideri aynen kalır. Sonuç/winner alanı canlı yolda okunmaz.
  if(typeof tkpR16MetaOrderForRace==='function'){
    const r16=tkpR16MetaOrderForRace(x?.r,live);
    if(Array.isArray(r16)&&r16.length) return r16.filter(h=>h&&!isNonRunner(h));
  }
  if(typeof altiliWinnerOrderForRace==='function'){
    const ordered=altiliWinnerOrderForRace(x?.r,live);
    if(Array.isArray(ordered)&&ordered.length) return ordered.filter(h=>h&&!isNonRunner(h));
  }
  return predictionDisplayRows({r:x?.r,scored:live},Infinity,'strategy').rows.filter(h=>!isNonRunner(h));
}

const _tkpOverviewStrongLegCache=new Map();
const _tkpFirstLookSingleCache=new Map();
const TKP_OVERVIEW_STRONG_CACHE_LIMIT=36;
function tkpOverviewStrongCacheKey(chosen){
  const dbSig=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${db?.files?.length||0}|${db?.races?.length||0}`;
  const rows=(chosen||[]).map(x=>{
    const r=x?.r||{};const scored=x?.scored||[];
    return [r.id||r.file_id||'',r.leg||'',...scored.map(h=>[h?.horse_no,h?.score,h?.prediction_score_snapshot,h?.agf,h?.agf_rank,h?.ypuan,h?.value_score,h?.hndkp_rank,h?.jbyg,h?.g800,h?.bmb,h?.odb,false,0].join(','))].join(':');
  }).join(';');
  return dbSig+'|'+rows;
}
function overviewStrongLegCandidates(chosen){
  // 15/16 HIZ: forcedSinglePickMap Normal/Geniş/Sürpriz için aynı 6 ayağın aynı
  // pahalı profil kararını tekrar hesaplamaz. Anahtar canlı skor/AGF/X + DB revizyonunu
  // içerir; çıktı değişmeden yalnız tekrar hesap kaldırılır.
  const cacheKey=tkpOverviewStrongCacheKey(chosen);
  const cached=_tkpOverviewStrongLegCache.get(cacheKey);
  if(cached){_tkpOverviewStrongLegCache.delete(cacheKey);_tkpOverviewStrongLegCache.set(cacheKey,cached);return cached.slice();}
  // ESKİ İLK BAKIŞ TEK HAVUZU: Her ayağın en iyi Tahmin-1/Şampiyon adayı
  // değerlendirilir. Bu liderin dışındaki hiçbir at TEK olamaz. Dinamik karar
  // puanı sıralamayı ve “çok sağlam” ayrımını verir; eski portföy kuralı gereken
  // TEK adetlerini kendi İlk Bakış bantlarından seçer.
  const ranked=(chosen||[]).map((x,i)=>{
    // Kayıtlı bir toplantının Genel Bakış TEK özeti, canlı kupon motorunu bir
    // kez daha çalıştırmamalı. O motor; şart/öğrenme havuzunu yeniden tarayarak
    // aynı altı ayak için 30+ saniyelik blok üretebiliyordu. Arşiv yolu yalnız
    // kilitli yarış-öncesi sıra ve (varsa) dondurulmuş kupon seçimini kullanır.
    // Canlı tahmin yolu aynı `legCoveragePlan` hesabını korur.
    const archived=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x);
    const plan=archived&&typeof historicalCoveragePlan==='function'
      ?historicalCoveragePlan(x)
      :legCoveragePlan(x,'main');
    const rows=archived&&Array.isArray(plan?.orderedPool)&&plan.orderedPool.length
      ?plan.orderedPool.slice()
      :bestPredictionRowsForLeg(x);
    const h=rows[0]||null;
    if(!h) return null;
    const second=rows[1]||null;
    const strength=typeof altiliWinnerScoreForHorse==='function'
      ? altiliWinnerScoreForHorse(x.r,h)/100
      : conditionSingleStrength(x.r,h);
    const secondStrength=second?(typeof altiliWinnerScoreForHorse==='function'?altiliWinnerScoreForHorse(x.r,second)/100:conditionSingleStrength(x.r,second)):0;
    const margin=Math.max(0,strength-secondStrength);
    const decision=archived&&plan?.singleDecision
      ?plan.singleDecision
      :dynamicSingleDecision(x,h,second,strength,margin);
    const profile=Math.max(0,Math.min(100,profileStrengthPct(x.r,h)));
    const champion=Math.max(0,Math.min(100,Number(decision.confidence)||0));
    const gap=Math.max(0,Math.min(100,(margin/0.25)*100));
    const agfSupport=couponAgfSupported(h)?100:0;
    const history=Math.max(0,Math.min(100,(Number(decision.firstRate)||0)*100));
    const ypuan=Math.max(0,Math.min(100,(Number(h.ypuan)||0)*5));
    // 56 dosyalık regresyon sonrası TEK öncelik formülü. Hedef yalnız birinciliktir:
    // P1 Şampiyon %40 + lider farkı %20 + profil %15 + AGF desteği %10 +
    // geçmiş aynı-profil P1 başarısı %10 + Y.PUAN %5.
    const value=0.40*champion+0.20*gap+0.15*profile+0.10*agfSupport+0.10*history+0.05*ypuan;
    return {x,i,h,second,rows,decision,scoreGap:margin,value,plan,firstLookRank:0,
      formula:{champion,gap,profile,agfSupport,history,ypuan}};
  }).filter(Boolean).sort((a,b)=>b.value-a.value);
  ranked.forEach((candidate,index)=>{ candidate.firstLookRank=index+1; });
  _tkpOverviewStrongLegCache.set(cacheKey,ranked.slice());
  while(_tkpOverviewStrongLegCache.size>TKP_OVERVIEW_STRONG_CACHE_LIMIT)_tkpOverviewStrongLegCache.delete(_tkpOverviewStrongLegCache.keys().next().value);
  return ranked;
}

function topTwoConfidenceSingleCandidates(chosen,overviewArg=null){
  // V1.1.89 — En Güçlü 2 TEK ile Normal Kupon TEK kaynağı artık TEK.
  // Aday havuzu: P1 lideri, TKP > 1,40 ve kuponda TEK olmasına temel engel yok.
  // Öncelik: dinamik güven eşiğine en yakın olan; eşitlikte yüksek TKP skoru.
  return (overviewArg||overviewStrongLegCandidates(chosen))
    .filter(z=>z?.h && (Number(z.h.score)||0)>1.40 && canBeCouponSingle(z.h) && !tkpLegacyXKulisBreaksSingle(z.h))
    .slice()
    .sort((a,b)=>{
      const ad=a?.decision||{}, bd=b?.decision||{};
      const aDeficit=Math.max(0,(Number(ad.threshold)||70)-(Number(ad.confidence)||0));
      const bDeficit=Math.max(0,(Number(bd.threshold)||70)-(Number(bd.confidence)||0));
      if(aDeficit!==bDeficit) return aDeficit-bDeficit;
      return (Number(b.h?.score)||0)-(Number(a.h?.score)||0);
    });
}

function firstLookPortfolioSingleCandidates(chosen){
  // PORTFÖY TEK KAYNAĞI: Kullanıcının gördüğü "İlk Bakış · Her Ayak Lideri"
  // sırası ile kupon TEK bantları bire bir aynı olsun. Her ayakta yalnız mevcut TKP
  // lideri değerlendirilir; ayaklar görünür/frozen TKP yüksekten düşüğe sıralanır.
  // "Gelme ihtimali" ayrı Altılı 1.lik güvenidir; TKP yalnız İlk Bakış bandını kurar.
  const cacheKey=tkpOverviewStrongCacheKey(chosen);
  const cached=_tkpFirstLookSingleCache.get(cacheKey);
  if(cached){
    _tkpFirstLookSingleCache.delete(cacheKey);_tkpFirstLookSingleCache.set(cacheKey,cached);
    return cached.slice();
  }
  const rows=(chosen||[]).map((x,i)=>{
    const h=tkpFirstLookLeaderForLeg(x);
    if(!h) return null;
    const race=x?.r||{};
    const second=(x?.scored||[]).filter(z=>z&&!isNonRunner(z)&&String(z.horse_no)!==String(h.horse_no))
      .slice().sort((a,b)=>(Number(b.altili_winner_score)||0)-(Number(a.altili_winner_score)||0)||(Number(b.score)||0)-(Number(a.score)||0))[0]||null;
    let decision=null;try{decision=dynamicSingleDecision(x,h,second);}catch(_){decision=null;}
    let visibleTkp=Number(h?.score)||0;
    try{if(typeof tkpRaceVisibleDisplayScore==='function')visibleTkp=Number(tkpRaceVisibleDisplayScore(race,h))||visibleTkp;}catch(_){ }
    const confidence=Math.max(0,Math.min(100,Number(decision?.confidence ?? h?.altili_winner_score)||0));
    const kg=horseWeightKg(h);
    const safeWeight=!(kg!=null&&kg>60);
    return {x,i,h,second,decision,visibleTkp,confidence,kg,safeWeight,firstLookRank:0};
  }).filter(Boolean).sort((a,b)=>b.visibleTkp-a.visibleTkp||b.confidence-a.confidence||Number(a.x?.r?.leg||0)-Number(b.x?.r?.leg||0));
  rows.forEach((z,idx)=>z.firstLookRank=idx+1);
  _tkpFirstLookSingleCache.set(cacheKey,rows.slice());
  while(_tkpFirstLookSingleCache.size>TKP_OVERVIEW_STRONG_CACHE_LIMIT)_tkpFirstLookSingleCache.delete(_tkpFirstLookSingleCache.keys().next().value);
  return rows;
}

function portfolioSingleLikelihoodSort(a,b){
  // V47 TOMMY TEK — SONUÇ-SIZ RİSK KALİBRASYONU:
  // Salt güven yüzdesi, son gerçek 29 toplantıda Normal TEK liderini 11/29 buldu.
  // Aynı pre-race güvene yarış zorluğunun %25'i kadar ceza uygulamak 14/29'a,
  // kronolojik son 10 toplantıda 3/10'dan 5/10'a çıktı. Sonuç/ikramiye alanı kullanılmaz.
  // 60 kg üstü hard veto değildir; KG/HNDKP etkisi zaten profil/risk katmanlarındadır.
  const adjusted=z=>{
    let risk=0;try{risk=typeof raceDifficultyIndex==='function'?raceDifficultyIndex(z?.x):0;}catch(_e){}
    return (Number(z?.confidence)||0)-0.25*(Number(risk)||0);
  };
  const ad=adjusted(a),bd=adjusted(b);
  if(Math.abs(bd-ad)>0.000001) return bd-ad;
  if(Math.abs((Number(b.visibleTkp)||0)-(Number(a.visibleTkp)||0))>0.000001) return (Number(b.visibleTkp)||0)-(Number(a.visibleTkp)||0);
  return Number(a.x?.r?.leg||0)-Number(b.x?.r?.leg||0);
}

function portfolioTakeSingles(candidates,count){
  // V55.1: Ekrandaki İlk Bakış lideri ancak gerçek TEK kararı da uygunsa TEK olabilir.
  // Böylece STAR OF HANDEL gibi güven/eşik filtresini geçmeyen lider zorla TEK seçilemez.
  return (candidates||[]).filter(z=>z?.h && z?.decision?.isSingle===true).slice().sort(portfolioSingleLikelihoodSort).slice(0,Math.max(0,count));
}

// V1.1.240 — AGF BANTLI TEK PORTFÖYÜ
//
// Bu sözleşme canlı kupon için sabittir: geçmiş 503 yarış yalnız araştırma / geriye
// dönük kalibrasyon kaynağıdır. Geçmişte iyi görünen bir rank bandı, canlıda otomatik
// olarak başka bir banda veya daha gevşek tek eşiğine terfi edemez. Canlı seçim, yalnız
// mevcut yarışın yarış-öncesi AGF snapshot'ı ve dynamicSingleDecision'ın mevcut
// koşul/puan/risk kanıtı ile yapılır. Sonuç, ikramiye ya da bitiriş alanı bu katmanda
// okunmaz.
const TKP_AGF_SINGLE_PORTFOLIO_POLICY=Object.freeze({
  version:'V1.1.240-AGF-BANDED-SINGLES-RESEARCH-GATED',
  normal:Object.freeze({agfRanks:Object.freeze([1,2,3]),minSingles:1,maxSingles:2}),
  surprise:Object.freeze({agfRanks:Object.freeze([3,4,5]),minSingles:1,maxSingles:2}),
  evidence:Object.freeze({requireDynamicSingle:true,requireScore:true,requireConditionEvidence:true,preRaceOnly:true}),
  research:Object.freeze({historical503:'RESEARCH_CALIBRATION_ONLY',strictTrainingGate:'tkpTrainingRowsBeforeTarget',autoLivePromotion:false})
});

function tkpAgfSinglePolicyForMode(mode){
  return mode==='surprise'?TKP_AGF_SINGLE_PORTFOLIO_POLICY.surprise:TKP_AGF_SINGLE_PORTFOLIO_POLICY.normal;
}
function tkpAgfRankForSinglePolicy(h,pool=[]){
  const explicit=Number(h?.agf_rank);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const ordered=(pool||[]).filter(x=>x&&!isNonRunner(x)).slice()
    .sort((a,b)=>(Number(b?.agf)||0)-(Number(a?.agf)||0));
  const index=ordered.findIndex(x=>String(x?.horse_no)===String(h?.horse_no));
  return index>=0?index+1:0;
}
function tkpAgfSinglePolicyAllowsRank(mode,rank){
  const value=Number(rank);
  return Number.isFinite(value)&&tkpAgfSinglePolicyForMode(mode).agfRanks.includes(value);
}
// Saf seçim çekirdeği: test/backtest ve canlı yol aynı 1–2 sınırını kullanır.
// `viable` üretimi ayrı tutulur ki AGF sırası tek başına hiçbir zaman yeterli olmasın.
function tkpAgfSinglePolicySelect(candidates,mode,maxSingles=null){
  const policy=tkpAgfSinglePolicyForMode(mode);
  const limit=Math.min(policy.maxSingles,Math.max(0,Number(maxSingles??policy.maxSingles)||0));
  const ordered=(candidates||[]).filter(row=>row?.h&&row?.viable===true&&tkpAgfSinglePolicyAllowsRank(mode,row.agfRank))
    .slice().sort((a,b)=>portfolioSingleLikelihoodSort(a,b)||Number(a.agfRank)-Number(b.agfRank)||Number(a.i)-Number(b.i));
  // Bir ayakta iki at "iki TEK" değildir; ikinci slot her zaman başka ayağa gider.
  const usedLegs=new Set(),out=[];
  for(const row of ordered){
    if(usedLegs.has(row.i))continue;
    usedLegs.add(row.i);out.push(row);
    if(out.length>=limit)break;
  }
  return out;
}
function tkpAgfBandSingleCandidates(chosen,mode){
  const rows=[];
  for(let i=0;i<(chosen||[]).length;i++){
    const x=chosen[i];
    const pool=(x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h));
    for(const h of pool){
      const agfRank=tkpAgfRankForSinglePolicy(h,pool);
      if(!tkpAgfSinglePolicyAllowsRank(mode,agfRank)||!canBeCouponSingle(h)||tkpLegacyXKulisBreaksSingle(h))continue;
      // Adayın kendi P1 gücünü, en güçlü diğer adaya karşı ölç. Böylece AGF 1–3
      // ya da 3–5 içinde olmak tek başına bir TEK hakkı vermez.
      const other=pool.filter(z=>String(z?.horse_no)!==String(h?.horse_no)).slice().sort((a,b)=>{
        const as=typeof altiliWinnerScoreForHorse==='function'?Number(altiliWinnerScoreForHorse(x?.r,a))||0:Number(a?.score)||0;
        const bs=typeof altiliWinnerScoreForHorse==='function'?Number(altiliWinnerScoreForHorse(x?.r,b))||0:Number(b?.score)||0;
        return bs-as;
      })[0]||null;
      let decision=null;try{decision=dynamicSingleDecision(x,h,other);}catch(_){decision=null;}
      const conditionEvidence=Boolean(decision?.evidenceOk)&&Number(decision?.evidence?.count||0)>=2;
      const viable=decision?.isSingle===true&&decision?.scoreOk===true&&conditionEvidence&&decision?.weightOk!==false&&decision?.xBreakSingle!==true;
      let visibleTkp=Number(h?.score)||0;
      try{if(typeof tkpRaceVisibleDisplayScore==='function')visibleTkp=Number(tkpRaceVisibleDisplayScore(x?.r,h))||visibleTkp;}catch(_){ }
      rows.push({x,i,h,second:other,decision,agfRank,viable,visibleTkp,confidence:Number(decision?.confidence)||0,
        policyEvidence:{score:Boolean(decision?.scoreOk),condition:conditionEvidence,dynamic:Boolean(decision?.isSingle),preRaceOnly:true}});
    }
  }
  return tkpAgfSinglePolicySelect(rows,mode);
}
function tkpAttachAgfSinglePolicyMeta(coupon,mode){
  if(!coupon||coupon.error)return coupon;
  const policy=tkpAgfSinglePolicyForMode(mode);
  const selected=(coupon.legs||[]).filter(leg=>(leg?.picks||[]).length===1).map((leg,index)=>{
    const h=leg.picks[0],pool=leg?.allHorses||leg?.displayOrder||leg?.ordered||[];
    return {leg:Number(leg?.r?.leg)||index+1,horse_no:String(h?.horse_no||''),agf_rank:tkpAgfRankForSinglePolicy(h,pool)};
  });
  coupon.agfSinglePolicy={
    version:TKP_AGF_SINGLE_PORTFOLIO_POLICY.version,mode,agfRanks:policy.agfRanks.slice(),minSingles:policy.minSingles,maxSingles:policy.maxSingles,
    selected,selectedCount:selected.length,preRaceOnly:true,historical503:'RESEARCH_CALIBRATION_ONLY',
    strictTrainingGate:'tkpTrainingRowsBeforeTarget',autoLivePromotion:false
  };
  return coupon;
}
if(typeof globalThis!=='undefined'){
  globalThis.TKP_AGF_SINGLE_PORTFOLIO_POLICY=TKP_AGF_SINGLE_PORTFOLIO_POLICY;
  globalThis.tkpAgfSinglePolicyAllowsRank=tkpAgfSinglePolicyAllowsRank;
  globalThis.tkpAgfSinglePolicySelect=tkpAgfSinglePolicySelect;
  globalThis.tkpAgfBandSingleCandidates=tkpAgfBandSingleCandidates;
}

function tkpV52LegacyNormalSingleMap(chosen){
  const map=new Map(),firstLook=tkpAgfBandSingleCandidates(chosen,'normal');
  const setPick=z=>{if(z&&!map.has(z.i))map.set(z.i,z.h);};
  firstLook.slice(0,1).forEach(setPick);
  return map;
}

// Normal kupon boş bir "kapsama" bileti olamaz. R16 kanıt kapısı TEK'i
// doğrulayamasa bile, kuponun omurgasındaki en güçlü yarış-öncesi lider bir
// adet TEK olarak tutulur. Bu bir güven garantisi değildir; meta alanında açıkça
// fallback olarak işaretlenir ve sonuç/ikramiye verisi bu seçime girmez.
function tkpNormalFallbackSingleCandidate(chosen,firstLook=null){
  const candidates=(firstLook||firstLookPortfolioSingleCandidates(chosen)||[])
    .filter(z=>z?.h&&!isNonRunner(z.h)&&canBeCouponSingle(z.h));
  if(candidates.length)return candidates[0];
  for(let i=0;i<(chosen||[]).length;i++){
    const x=chosen[i],pool=(x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h)&&canBeCouponSingle(h));
    if(!pool.length)continue;
    const h=typeof tkpR16MetaOrderForRace==='function'
      ?(tkpR16MetaOrderForRace(x.r,pool)[0]||pool[0])
      :pool.slice().sort((a,b)=>(Number(b?.score)||0)-(Number(a?.score)||0))[0];
    if(h)return {i,x,h,decision:{isSingle:false,confidence:0,threshold:60,reason:'Yarış-öncesi lider TEK fallback'}};
  }
  return null;
}

function tkpAllResultPolicySingleCandidates(chosen,mode,limit=1){
  const rows=[];
  for(let i=0;i<(chosen||[]).length;i++){
    const x=chosen[i]; let plan=null;
    try{plan=legCoveragePlan(x,mode);}catch(_){plan=null;}
    const p=plan?.allResultPolicy;
    const h=plan?.orderedPool?.[0]||plan?.picks?.[0]||x?.top||null;
    if(h&&p?.singleEligible===true)rows.push({i,h,confidence:Number(p.confidence)||0,leaderRate:Number(p.leaderRate)||0});
  }
  return rows.sort((a,b)=>b.confidence-a.confidence||b.leaderRate-a.leaderRate||a.i-b.i).slice(0,Math.max(0,limit));
}

function tkpStrategyFallbackSingleCandidates(chosen,strategy,limit=1){
  // Kullanıcının portföy sözleşmesi: her kupon 1–2 TEK taşır. Kanıtlı TEK
  // yoksa boş TEK/maliyet TEK'i yerine o kuponun kendi görünür çekirdeğinden
  // strateji TEK'i seçilir. Normal 1. sırayı, Sürpriz 3–5 bandını, Uzman ise
  // kendi kulis/uzman sırasının liderini kullanır.
  const rows=[];
  for(let i=0;i<(chosen||[]).length;i++){
    const x=chosen[i];
    const general=(typeof predictionDisplayRows==='function'
      ?predictionDisplayRows({r:x?.r,scored:x?.scored||[]},Infinity,'score-desc').rows
      :(x?.scored||x?.r?.horses||[])).filter(h=>h&&!isNonRunner(h));
    let pool=general;
    if(strategy==='alt')pool=general.slice(2,5);
    if(strategy==='expert'){
      try{if(typeof tkpV55ExpertOrderForRace==='function')pool=tkpV55ExpertOrderForRace(x?.r,general)||general;}catch(_){pool=general;}
    }
    // Sert uygunluk kapısı fallback tarafından da aşılamaz (ör. >60 kg).
    const h=pool.find(row=>canBeCouponSingle(row)&&!tkpLegacyXKulisBreaksSingle(row))
      ||null;
    if(!h)continue;
    let visible=Number(h?.score)||0;
    try{if(typeof tkpRaceVisibleDisplayScore==='function')visible=Number(tkpRaceVisibleDisplayScore(x?.r,h))||visible;}catch(_){ }
    rows.push({i,h:{...h,__tkpStrategyFallbackSingle:true,__tkpStrategyFallbackKind:strategy},visible});
  }
  return rows.sort((a,b)=>b.visible-a.visible||a.i-b.i).slice(0,Math.max(0,Math.min(2,limit)));
}

function forcedSinglePickMap(chosen,strategy,overviewArg=null){
  const map=new Map();
  const firstLook=firstLookPortfolioSingleCandidates(chosen);
  if(!firstLook.length && strategy!=='normal' && strategy!=='normal2' && strategy!=='alt' && strategy!=='expert') return map;
  const setPick=z=>{if(z&&!map.has(z.i))map.set(z.i,z.h);};

  if(strategy==='normal'){
    // Normal kuponda en az bir TEK zorunludur. Önce bağımsız R16 kanıtı,
    // bulunamazsa ortak yarış-öncesi lider kullanılır; fallback güvenli/kanıtlı
    // TEK gibi sunulmaz, yalnız kuponun TEK'siz kalmasını engeller.
    if(typeof tkpR16MeetingSingleCandidates==='function') tkpR16MeetingSingleCandidates(chosen,1).forEach(setPick);
    else tkpAgfBandSingleCandidates(chosen,'normal').slice(0,1).forEach(setPick);
    if(!map.size){
      const fallback=tkpNormalFallbackSingleCandidate(chosen,firstLook);
      if(fallback?.h)map.set(fallback.i,{...fallback.h,__tkpNormalFallbackSingle:true});
    }
    if(!map.size)tkpStrategyFallbackSingleCandidates(chosen,'normal',1).forEach(setPick);
  }else if(strategy==='normal2'){
    // En fazla iki TEK; ikinci TEK de aynı R16 kanıt kapısından bağımsız geçmek zorunda.
    // Bir tane güçlü banko varsa yalnız bir tane kullanılır.
    if(typeof tkpR16MeetingSingleCandidates==='function') tkpR16MeetingSingleCandidates(chosen,2).forEach(setPick);
    else tkpAgfBandSingleCandidates(chosen,'normal').slice(0,2).forEach(setPick);
    // Sözleşme "tam iki" değil, her kuponda en az bir ve en fazla iki TEK'tir.
    if(!map.size)tkpStrategyFallbackSingleCandidates(chosen,'normal',1).forEach(setPick);
  }else if(strategy==='wide'){
    portfolioTakeSingles(firstLook,1).forEach(setPick);
  }else if(strategy==='alt'){
    // Sürpriz Altılı: 1–2 TEK yalnız AGF 3–5 bandından gelir. Bu, Uzman/Kulis
    // ('expert') yolundan tamamen ayrıdır; Kulis seçimlerine dokunmaz.
    tkpAgfBandSingleCandidates(chosen,'surprise').slice(0,2).forEach(setPick);
    if(!map.size)tkpStrategyFallbackSingleCandidates(chosen,'alt',1).forEach(setPick);
  }else if(strategy==='surprise'){
    // V55.2 GERÇEK SÜRPRİZ: Normal/Uzman'dan bağımsız İlk Bakış 3–5 bandı.
    // Yalnız canonical isSingle=true adaylar TEK olabilir; sonuç alanı kullanılmaz.
    const normalLegs=new Set(tkpV52LegacyNormalSingleMap(chosen).keys());
    let band=firstLook.slice(2,5).filter(z=>!normalLegs.has(z.i));
    if(!band.length) band=firstLook.slice(2,5);
    portfolioTakeSingles(band,2).forEach(setPick);
    if(!map.size) portfolioTakeSingles(firstLook.filter(z=>!normalLegs.has(z.i)),1).forEach(setPick);
  }else if(strategy==='expert'){
    // Uzman/Kulis TEK'i yalnız yönetişim motorunun kimlikli, yarış-öncesi
    // kilitli ve elle onaylanmış yorumcu kanıtından gelebilir.  Kanıt yoksa
    // kupon kapsama olarak kalır; İlk Bakış lideri maliyet için Kulis TEK'i
    // diye sessizce zorlanmaz.
    if(typeof tkpV55ExpertSingleMap==='function'){
      const chosenMap=tkpV55ExpertSingleMap(chosen);
      for(const [i,h] of chosenMap.entries()){
        if(map.size>=2)break;
        if(h&&!map.has(i)) map.set(i,h);
      }
    }
    if(!map.size)tkpStrategyFallbackSingleCandidates(chosen,'expert',1).forEach(setPick);
  }
  const mode=strategy==='alt'?'alt':(strategy==='expert'?'surprise':'main');
  const eligible=[...map.entries()].filter(([,h])=>h&&canBeCouponSingle(h));
  const reviewed=eligible.map(([i,h])=>({i,h,evidence:tkpBenterSingleEvidence(chosen[i],h,mode)}));
  const qualified=reviewed.filter(row=>!row.evidence.blocked);
  if(qualified.length)return new Map(qualified.slice(0,2).map(row=>[row.i,row.h]));
  // Kullanıcının en az bir TEK şekli korunur; değer vetosunu geçen kanıtlı
  // TEK diye sunulmaz ve ikinci bir zorunlu TEK eklenmez.
  return new Map(reviewed.slice(0,1).map(row=>[row.i,{...row.h,__tkpStrategyFallbackSingle:true,__tkpBenterSingleVeto:true}]));
}

function tkpBenterSingleEvidence(x,horse,mode){
  if(!horse||typeof tkpProbabilityPortfolioOrderForRace!=='function')return {blocked:false,status:'PIYASA_YOK'};
  const r=x?.r||{},pool=x?.scored?.length?x.scored:(x?.allHorses?.length?x.allHorses:r.horses||[]);
  const rows=tkpProbabilityPortfolioOrderForRace(r,pool,mode);
  const h=rows.find(row=>String(row.horse_no)===String(horse.horse_no));
  return {blocked:h?.tkp_benter_status==='DEGER_YOK',status:h?.tkp_benter_status||'PIYASA_YOK',edge:h?.tkp_benter_edge??null,probability:h?.tkp_probability??null};
}

function tkpAuditFinalSingles(coupon,mode){
  if(!coupon||coupon.error||coupon.disabled)return coupon;
  const audits=[];
  for(const leg of coupon.legs||[]){
    if((leg.picks||[]).length!==1)continue;
    const h=leg.picks[0],evidence=tkpBenterSingleEvidence({r:leg.r,scored:leg.allHorses||leg.r?.horses||[]},h,mode);
    const plan=leg.confidencePlan||{},fallback=plan.strategySingleFallback===true||h.__tkpStrategyFallbackSingle===true||h.__tkpNormalFallbackSingle===true;
    const eligible=canBeCouponSingle(h);
    const reliable=eligible&&!fallback&&!evidence.blocked&&plan.reliable===true;
    leg.confidencePlan={...plan,reliable,strategySingle:true,strategySingleFallback:!reliable,benterVeto:evidence.blocked,benter:evidence,
      reason:!eligible?'TEK sert uygunluk kuralını geçemedi':evidence.blocked?'Benter değer vetosu · zorunlu şekil TEK, güvenilir değil':(!reliable?'Zorunlu şekil TEK · güvenilirliği doğrulanmadı':plan.reason)};
    if(!eligible){coupon.error='TEK seçimi kilo/uygunluk kuralını geçemedi; kupon geçersiz.';coupon.singlePolicyConflict=true;}
    audits.push({leg:leg.r?.leg,horseNo:String(h.horse_no),reliable,...evidence});
  }
  coupon.actualSingles=audits.length;
  coupon.reliableSingles=audits.filter(row=>row.reliable).length;
  const validShape=audits.length>=1&&audits.length<=2;
  if(!validShape){
    coupon.error=audits.length<1?'Uygun TEK bulunamadı; 1–2 TEK şartıyla geçerli kupon oluşturulamadı.':'Kupon ikiden fazla TEK içeriyor; son yapı kontrolü başarısız.';
    coupon.singlePolicyConflict=true;
  }
  coupon.benterSingleAudit={version:'R16.63',singles:audits,validShape,forcedRisk:!validShape||audits.some(row=>!row.reliable),calibrationValidated:false};
  return coupon;
}

function forcedCoveragePickMap(chosen,strategy,overviewArg=null,singlesArg=null){
  const map=new Map(); if(strategy!=='normal') return map;
  const overview=overviewArg||overviewStrongLegCandidates(chosen), singles=singlesArg||forcedSinglePickMap(chosen,'normal',overview);
  const next=overview.find(z=>!singles.has(z.i)); if(!next) return map;
  const hard=difficultRaceMinimumCount(next.x);
  const count=hard>=6?hard:((next.decision.isSingle||next.scoreGap>=0.14)?2:3);
  map.set(next.i,{count,rows:next.rows.slice(0,count)}); return map;
}

function raceDifficultyIndex(x){
  const distribution=tkpLegDistributionProfile(x,x?.scored||[]);
  if(!distribution.n)return 0;
  let d=distribution.uncertainty;
  if(/ŞARTLI 3|SARTLI 3/.test(fold(x?.r?.condition_text||'')))d+=7;
  return Math.max(0,Math.min(100,d));
}

function difficultRaceMinimumCount(x){
  const pool=(x?.scored||[]).filter(h=>h&&!isNonRunner(h));
  const n=pool.length, d=raceDifficultyIndex(x);
  if(!n||d<62) return 0;
  // RISK-FIRST HARD FLOOR: zor ayak 6'nın, çok/aşırı zor ayak 8'in altına inmez.
  // 90+ yarışlarda 10 at HEDEFTİR; 750-800 TL bütçeye sığmıyorsa 8'e kadar
  // kontrollü iner. Böylece "çok yüksekse 8-10" kuralı bütçe kilidiyle çelişmez.
  if(d>=82) return Math.min(8,n);
  return Math.min(6,n);
}
function difficultRaceTargetCount(x){
  const pool=(x?.scored||[]).filter(h=>h&&!isNonRunner(h));
  const n=pool.length, d=raceDifficultyIndex(x);
  if(!n||d<62) return 0;
  if(d>=90) return Math.min(10,n);
  if(d>=82) return Math.min(8,n);
  return Math.min(6,n);
}

function displayLeaderHasXBreak(x){
  return false;
}

function minimumCostCoverage(chosen, unit, mode, budgetTL, forcedSingleIdx, forcedCoverageMap=null){
  if(typeof tkpCouponCheck==='function')tkpCouponCheck();
  const legs=chosen.map((x,i)=>{
    const forcedHorse = forcedSingleIdx instanceof Map ? forcedSingleIdx.get(i) :
      (forcedSingleIdx && forcedSingleIdx.has && forcedSingleIdx.has(i) ? x.top : null);
    const forced = !!forcedHorse;
    const forcedCoverage=forcedCoverageMap instanceof Map ? forcedCoverageMap.get(i) : null;
    const plan=legCoveragePlan(x,mode);
    if(tkpLegacyXKulisBreaksSingle(plan?.picks?.[0]) || displayLeaderHasXBreak(x)) plan.reliable=false;
    const locallyReliable=plan.reliable===true;
    // TOMMY PORTFÖY KİLİDİ: Normal ve Sürpriz kuponlarda TEK kararı YALNIZ
    // forcedSinglePickMap'ten gelir. Yerel legCoveragePlan reliable=true sonucu ekstra
    // ekstra TEK üretemez. Her kuponun TEK sayısı portföy katmanında 1–2 ile sınırlıdır.
    // Geniş geriye uyumluluk için de portföy TEK kaynağını kullanır ancak canlıda kapalıdır.
    if(mode==='main'||mode==='alt'||mode==='surprise') plan.reliable=false;
    const ordered=orderedCandidatesForBudget(x,mode);
    // Kupon-Tahmin sıra kilidi: bütçe kuponunda 3 at kalıyorsa Tahmin'in ilk 3'ü,
    // 4 veya daha fazla at kalıyorsa Tahmin'in ilk 4'ü mutlaka bulunur.
    const displayOrder=predictionDisplayRows({r:x.r, scored:x.scored||[]},Infinity,'score-desc').rows.filter(h=>!isNonRunner(h));
    // Kupon çekirdeği Genel Bakış sırasından gelir. Normal'de tarihsel olarak en
    // yüksek kapsama TKP 1–3'te; Sürpriz'de ise Normal'den farklı senaryo için
    // 3–5 bandındadır. Bu çekirdek sonradan bütçe/portföy sıralamasıyla sessizce
    // değiştirilemez.
    const strategyCore=mode==='main'
      ?displayOrder.slice(0,3)
      :(mode==='alt'?displayOrder.slice(2,5):[]);

    // Genel Bakış sıralamasında bu ayak, kupon tipi için istenen konumda ise (Sağlam Kupon
    // için 1. ve 2. sıra, Sürpriz Kupon için 3. ve 4. sıra) o ayağın gösterilen atı doğrudan
    // TEK olarak sabitlenir; aşağıdaki ek kapsama kuralları bu ayak için uygulanmaz.
    if (forced){
      const forcedPicks=[forcedHorse];
      const tkpRank=Math.max(1,tkpOrderedForLeg(x).findIndex(h=>String(h.horse_no)===String(forcedHorse.horse_no))+1);
      const fallbackSingle=forcedHorse.__tkpNormalFallbackSingle===true;
      const strategyFallback=forcedHorse.__tkpStrategyFallbackSingle===true;
      return {r:x.r, baseScore:conditionSingleStrength(x.r,forcedHorse)||1, protectedFlag:true, picks:forcedPicks,
        allHorses:x.scored, strictPool:x.strictPool, ordered, displayOrder,coverageMode:mode,
          confidencePlan:{...plan, reliable:!(fallbackSingle||strategyFallback), strategySingle:true, strategySingleFallback:fallbackSingle||strategyFallback, strength:conditionSingleStrength(x.r,forcedHorse)||1,
          reason:fallbackSingle?`Zorunlu yarış-öncesi lider TEK · TKP ${tkpRank} · R16 kanıt kapısı geçmedi`:strategyFallback?`${forcedHorse.__tkpStrategyFallbackKind==='alt'?'Sürpriz TKP 3–5':forcedHorse.__tkpStrategyFallbackKind==='normal'?'Normal TKP lider':'Uzman/Kulis'} strateji TEK'i · TKP sıra ${tkpRank}`:`Kupon stratejisi TEK · TKP ${tkpRank}${couponAgfSupported(forcedHorse)?' + AGF destekli':''}`}};
    }

    const difficultMin=difficultRaceMinimumCount(x);
    const difficultTarget=typeof difficultRaceTargetCount==='function'?difficultRaceTargetCount(x):difficultMin;
    const forcedCoverageCount=Math.min(ordered.length,Math.max(0,Number(forcedCoverage?.count)||0));
    const hardSpecialHorses=(plan.hardBhOdbPicks||[]).map(row=>row?.h).filter(Boolean);
    let baseCount=plan.reliable?1:Math.min(Math.max(2,Number(plan.picks?.length)||4),ordered.length);
    if(!plan.reliable&&strategyCore.length)baseCount=Math.max(baseCount,Math.min(strategyCore.length,ordered.length));
    if(forcedCoverageCount) baseCount=Math.max(baseCount,forcedCoverageCount);
    baseCount=Math.max(baseCount,Math.min(difficultTarget,ordered.length));
    if(!plan.reliable&&hardSpecialHorses.length){
      const mandatory=dedupeEkuri(strategyCore.concat(hardSpecialHorses),x.r,mode,true).length;
      baseCount=Math.min(ordered.length,Math.max(baseCount,mandatory));
    }
    const xForced=ordered.filter(tkpLegacyXKulisForce);
    let picks=dedupeEkuri(xForced.concat(ordered),x.r,mode,true).slice(0,baseCount);
    if(forcedCoverage?.rows?.length) picks=dedupeEkuri(forcedCoverage.rows.concat(picks),x.r,mode,true).slice(0,baseCount);
    const leaderFloorCount=Math.min(displayOrder.length,Math.max(1,Number(plan.leaderFloorCount)||baseCount));
    // Ana biletin yerel modeli bu ayağı TEK görüyorsa ama portföy stratejisi aynı
    // TEK'i özellikle kullanmıyorsa, alternatif bilet gerçek bir karşı senaryo
    // olmalıdır. İlk 6'yı yumuşak DP tabanı yapmak, aynı yanlış TEK'in üç kuponu da
    // devirmesini önler; gerçek eşiği geçmeyen ayaklara uygulanmaz.
    const counterSingleFloor=(mode!=='main'&&locallyReliable)?Math.min(6,displayOrder.length):0;
    let profileFloorCount=plan.reliable?1:Math.max(profileCoverageFloorForLeg(x.r,displayOrder),counterSingleFloor);
    // V1.1.86: legCoveragePlan() tam 2 at + dışarıdaki gerçek BMB kuralıyla üçüncü
    // adayı eklediyse, final ortak bütçe DP'si bu adayı tekrar silemez. Bu koruma
    // yalnız planın gerçekten 2->3 BMB genişlettiği ayakta çalışır; normal 3+ ayakları
    // veya TEK ayakları şişirmez.
    const narrowBmbProtectedNo=!plan.reliable&&plan?.narrowBmbExtra?String(plan.narrowBmbExtra.horse_no||''):'';
    if(narrowBmbProtectedNo) profileFloorCount=Math.max(profileFloorCount,3);
    baseCount=Math.max(baseCount,profileFloorCount);
    // TKP >= 0,80 ve BMB/ODB birlikte değerlendirilir. Sinyal kuyruğu en fazla
    // iki TKP adayı + bir para adayıyla sınırlıdır; eksikse yalnız bir ek yuva
    // açılır. Böylece değerli atlar hesaba girer, fakat her ayak otomatik olarak
    // çok atlıya dönmez. Canlıda varsa öncelik 509 CLEAN509 walk-forward prior'ıyla
    // aynı yarış içindeki güvenli alanlar üzerinden sıralanır.
    const learnedSignal=tkp80AndMoneyCandidates(x.r,ordered,mode);
    // Görünür TKP >= 2,40 ham arşivde anlamlı güçlü aday bandıdır. 1,20
    // görünür TKP yaygındır (%34 civarı) ve tek/özel öncelik olamaz. 2,40 da
    // otomatik banko değildir; yalnız kapsama sırasına önce girer ve seçildiyse
    // bütçe budamasından korunur.
    const tkpStrongPriority=ordered.filter(tkpScoreAtLeast240);
    const signalPriority=dedupeEkuri(tkpStrongPriority.concat(learnedSignal.tkp||[],(learnedSignal.money||[]).slice(0,1)),x.r,mode,true);
    const signalTarget=mode==='main'?Math.min(2,signalPriority.length):Math.min(3,signalPriority.length);
    const signalMissing=signalPriority.slice(0,signalTarget).filter(h=>!ordered.slice(0,baseCount).some(p=>String(p?.horse_no)===String(h?.horse_no))).length;
    if(!plan.reliable&&signalMissing)baseCount=Math.min(ordered.length,baseCount+1);
    const narrowBmbHorse=narrowBmbProtectedNo?ordered.find(h=>String(h.horse_no)===narrowBmbProtectedNo):null;
    const initialCoverage=narrowBmbHorse
      ? strategyCore.concat(hardSpecialHorses,signalPriority,displayOrder.slice(0,2),[narrowBmbHorse],displayOrder.slice(2,profileFloorCount))
      : strategyCore.concat(hardSpecialHorses,signalPriority,displayOrder.slice(0,profileFloorCount));
    picks=dedupeEkuri(initialCoverage.concat(picks,ordered),x.r,mode,true).slice(0,baseCount);
    const protectedSignalNos=new Set();
    if(narrowBmbProtectedNo) protectedSignalNos.add(narrowBmbProtectedNo);
    for(const h of strategyCore||[]){
      if(picks.some(p=>String(p?.horse_no)===String(h?.horse_no)))protectedSignalNos.add(String(h.horse_no));
    }
    for(const h of tkpStrongPriority||[]){
      if(picks.some(p=>String(p?.horse_no)===String(h?.horse_no)))protectedSignalNos.add(String(h.horse_no));
    }
    for(const h of learnedSignal.money||[]){
      if(picks.some(p=>String(p?.horse_no)===String(h?.horse_no)))protectedSignalNos.add(String(h.horse_no));
    }
    for(const h of hardSpecialHorses){
      if(picks.some(p=>String(p?.horse_no)===String(h?.horse_no)))protectedSignalNos.add(String(h.horse_no));
    }
    // Kesin kullanıcı kuralı: ayak zaten geniş yazılıyorsa (4+) TKP ≥0,90
    // her aday kuponda kalır. Bütçe optimizasyonu onu sessizce silemez; maliyet
    // yetmezse başka, korumasız adaylar azalır veya kupon açıkça tavanı aşar.
    if(!plan.reliable&&baseCount>=4){
      const highTkp=ordered.filter(tkpScoreAtLeast90);
      const selected=new Set(picks.map(h=>String(h?.horse_no)));
      for(const h of highTkp){
        protectedSignalNos.add(String(h.horse_no));
        if(!selected.has(String(h.horse_no))){picks.push(h);selected.add(String(h.horse_no));}
      }
      if(highTkp.length)tkpStableOrderSort(picks,ordered);
    }
    // V1.1.135: 6/7 gibi geniş çoklu güvenlikte BMB/ODB/X adayı final DP budamasında
    // tek dışarıda kalan at olamaz. Hibrit denetçinin koruması kuponun son aşamasına taşınır.
    const activeCount=ordered.filter(h=>!isNonRunner(h)).length;
    const wideCoverageSafety=!plan.reliable && (baseCount>=Math.max(5,activeCount-1) || difficultMin>=6);
    if(wideCoverageSafety){
      for(const h of ordered){
        if(Number(h?.bmb)===1 || (typeof isOdbCandidate==='function'&&isOdbCandidate(h,x.r)) || tkpLegacyXKulisForce(h)){
          protectedSignalNos.add(String(h.horse_no));
        }
      }
    }

    // Karşıt senaryo adayları Geniş/Sürpriz kuponun kuyruk kısmında korunur.
    // İlk beş Tahmin çekirdeği aynen kalır; bu adaylar altıncı ve sonraki
    // kolonlarda prefix-favori kopyası yerine gerçek çeşitlilik sağlar.
    if(mode!=='main' && typeof tkpPortfolioHedgesForRace==='function'){
      const hedges=tkpPortfolioHedgesForRace(x.r,displayOrder,2);
      for(const row of hedges||[]) protectedSignalNos.add(String(row?.horse?.horse_no||''));
    }


    // ZOR AYAK + Y.PUAN KURALI: Yorumcu toplam puanı 8'in üzerinde olan atlar yalnız
    // ekranda gösterilen bir veri değildir; 6-8 atlık zor ayak kapsamının gerçek adaylarıdır.
    // Önce yüksek Y.PUAN'lı adaylar alınır, kalan yerler ortak tahmin sırasından tamamlanır.
    // Böylece Y.PUAN 20 veya 13 gibi güçlü yorumcu desteği olan atlar kontenjan dolduğu için
    // sessizce dışarıda kalmaz. TEK ayaklara bu kural uygulanmaz.
    if(!plan.reliable && difficultMin>=6){
      const ypuanSupported=ordered.filter(h=>(Number(h.ypuan)||0)>8)
        .sort((a,b)=>(Number(b.ypuan)||0)-(Number(a.ypuan)||0) || tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode));
      const targetCount=Math.min(10,ordered.length,Math.max(baseCount,difficultTarget,Math.min(8,ypuanSupported.length)));
      picks=dedupeEkuri(ypuanSupported.concat(picks,ordered),x.r,mode,true).slice(0,targetCount);
      tkpStableOrderSort(picks, ordered);
      baseCount=targetCount;
    }

    // TKP ana omurgadır: TEK olmayan her ayakta TKP 1 adayı mutlaka kuponda kalır.
    if(!plan.reliable && picks.length){
      const tkpLeader=tkpOrderedForLeg(x)[0];
      if(tkpLeader && !picks.some(h=>String(h.horse_no)===String(tkpLeader.horse_no))){
        let replaceAt=picks.length-1;
        for(let i=picks.length-1;i>=0;i--){
          const h=picks[i];
          if(h.bmb!==1 && !isOdbCandidate(h)){ replaceAt=i; break; }
        }
        picks[replaceAt]=tkpLeader;
        picks=dedupeEkuri(picks,x.r,mode,true);
      }
    }

    // Gerçek güvenilir tek bozulmaz. Tek olmayan ayakta geçmişte kazanmış bir BMB dışarıda
    // kaldıysa, at sayısını büyütmeden seçili grubun en zayıf sıradan adayının yerine alınır.
    if(!plan.reliable && baseCount>0){
      const pastBmb=ordered.filter(isPastWinningBmb)
        .sort((a,b)=>tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode));
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const missing=pastBmb.find(h=>!selected.has(String(h.horse_no)));
      if(missing){
        let replaceAt=-1;
        for(let i=picks.length-1;i>=0;i--){
          if(!isPastWinningBmb(picks[i])){ replaceAt=i; break; }
        }
        if(replaceAt>=0) picks[replaceAt]=missing;
      }
      tkpStableOrderSort(picks, ordered);
    }

    // TEK hariç: ekranda "EKSTRA" rozetiyle gösterilen (SONUÇ ilk 6 / gerçek BMB / geçmiş
    // güç ≥0,30 TKP / sürpriz profili nedeniyle öne çıkan) VE daha önce en az bir kez
    // kazanmış olan adaylardan en güçlüsü, kapsam dışında kalmışsa mutlaka eklenir. Bu kural
    // Ana, Alternatif ve Sürpriz kuponların tamamında aynı şekilde uygulanır — sadece TEK
    // olarak sabitlenmiş (protectedFlag) ayaklara dokunulmaz.
    if(!plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const pastWinnerExtras=ordered.filter(h=>{
        if(selected.has(String(h.horse_no))) return false;
        const isExtraSignal=(tkpFrozenOdsResultRank(h)<=6) || h.bmb===1 ||
          (historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30) ||
          historicalSurpriseProfileMatch(x.r,h).matched;
        const wonBefore=(h.condWinWins||0)>0 || (h.priorWins||0)>0;
        return isExtraSignal && wonBefore;
      }).sort((a,b)=>tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode));
      if(pastWinnerExtras.length){
        picks.push(pastWinnerExtras[0]);
        selected.add(String(pastWinnerExtras[0].horse_no));
      }
      tkpStableOrderSort(picks, ordered);
    }

    // SONUÇ ilk 3 + veri gücü yeterli: kapsam dışında kalmış olsa bile eklenir (at sayısı
    // burada büyür, çünkü bu güçlü bir sinyal — sadece uyarı olarak gösterilip atlanmaz).
    // "Veri güçlü" ölçütü, uygulamanın geri kalanındaki "TKP ≥0,30" eşiğiyle aynıdır.
    if(!plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const strongTop3=ordered.filter(h =>
        tkpFrozenOdsResultRank(h)<=3 &&
        historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30 &&
        !selected.has(String(h.horse_no))
      );
      for(const h of strongTop3){ picks.push(h); selected.add(String(h.horse_no)); }
      tkpStableOrderSort(picks, ordered);
    }

    // AGF 1 (favori) atın YÜKLENEN DOSYADAKİ gerçek AGF yüzdesi %18 veya üzerindeyse, güçlü
    // kamu/veri desteği sayılır ve kapsam dışında bırakılmaz — BMB/SONUÇ ilk 3 gibi korunur.
    // Not: bu, ham AGF sırasından değil dosyadaki gerçek AGF yüzde değerinden okunur.
    if(!plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const strongAgf1=ordered.find(h => h.agf_rank===1 && Number(h.agf)>=18 && !selected.has(String(h.horse_no)));
      if(strongAgf1){ picks.push(strongAgf1); selected.add(String(strongAgf1.horse_no)); }
      tkpStableOrderSort(picks, ordered);
    }

    // HNDKP (handikap puanı) sırası 1 veya 2 olan at, kapsam dışında kalmışsa mutlaka eklenir.
    // Yüksek HNDKP, o ayaktaki en güçlü derece/kilo puanına sahip at anlamına gelir ve AGF/SONUÇ
    // ilk 3 gibi güçlü, dosyadan gelen bir sinyal sayılır.
    if(!plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const strongHndkp=ordered.filter(h => h.hndkp_rank!=null && h.hndkp_rank<=2 && !selected.has(String(h.horse_no)))
        .sort((a,b)=>(a.hndkp_rank-b.hndkp_rank) || (tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode)));
      if(strongHndkp.length){ picks.push(strongHndkp[0]); selected.add(String(strongHndkp[0].horse_no)); }
      tkpStableOrderSort(picks, ordered);
    }

    // HNDKP'si düşük (ilk 2'de değil) olsa bile, AGF puanı alandaki en yakın rakibinden en az
    // 15 puan daha yüksekse (net kamu favorisi ayrışması), bu at kapsam dışında bırakılmaz.
    // Bu durumda HNDKP kuralı devreye girmemiş olur ama AGF farkı tek başına güçlü bir sinyaldir.
    if(!plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const selectedBase=new Set(picks.map(h=>ekuriBase(h.horse_no)));
      const withAgf=(x.scored||[]).filter(h=>Number(h.agf)>0).sort((a,b)=>Number(b.agf)-Number(a.agf));
      if(withAgf.length>=2){
        const topAgf=withAgf[0], secondAgf=withAgf[1];
        const gap=Number(topAgf.agf)-Number(secondAgf.agf);
        const hndkpLow=topAgf.hndkp_rank==null || topAgf.hndkp_rank>2;
        if(gap>=15 && hndkpLow && !selected.has(String(topAgf.horse_no)) && !selectedBase.has(ekuriBase(topAgf.horse_no))){
          picks.push(topAgf); selected.add(String(topAgf.horse_no));
        }
      }
      tkpStableOrderSort(picks, ordered);
    }

    // Sürpriz kuponunda geçmiş kazanan profiline uyan adayların tamamı zorunlu korunur.
    // Böylece aynı koşu tipinde geçmişte 7., 8., 9., 10. vb. sıradan kazanan profil varsa
    // güncel yarıştaki karşılığı bütçe daraltmasıyla dışarı atılmaz.
    if(mode==='surprise' && !plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      for(const h of ordered){
        if(historicalSurpriseProfileMatch(x.r,h).matched && !selected.has(String(h.horse_no))){
          picks.push(h); selected.add(String(h.horse_no));
        }
      }
      tkpStableOrderSort(picks, ordered);
    }

    // KULLANICI TALİMATI (gerçek veriyle doğrulandı — 234 yarışta kazananların %26,9'u
    // bu banda uyuyor): SONUÇ 6/7/8, AGF sırası 6-11, gerçek BMB/ODB veya ilk 8 dışı Y.PUAN 8-20 ODB
    // "Altılıya para verdiren" atlardır — favori değiller ama gerçek kazanan bu profilden
    // sıkça çıkıyor. Bu banda uyan ve kapsam dışında kalmış en güçlü aday, TEK olmayan
    // her ayakta (Normal/Geniş/Sürpriz fark etmez) zorunlu eklenir. valueBandMatch artık
    // sabit değil, valueBandSignalWeights() ile activeRaces() üzerinden canlı öğreniyor.
    let protectedValueNos=new Set();
    if(!plan.reliable){
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      // KULLANICI TALİMATI: bu bandın içinde de kazanma ihtimali en yüksek olanlar
      // -- gerçek geçmiş kazanan profil gücü olanlar veya ilk 8 dışı Y.PUAN 8-20 ODB desteği olanlar --
      // bütçe daraltmasında bile ÇIKARILMAZ. Salt BMB/ODB/AGF/SONUÇ'a uyan ama geçmiş
      // güç ya da Y.PUAN desteği olmayan aday yine eklenir ama korumasızdır (diğer
      // zorunlu ekleme kuralları gibi bütçe sıkışırsa geri çıkabilir).
      const strongValueMatch=h=>valueBandMatch(h,x.r) && (historyStrengthForCandidate(h)>0 || isOdbCandidate(h) || accurateFieldTopCandidate(h,x.r));
      const valueCands=ordered.filter(h=>valueBandMatch(h,x.r) && !selected.has(String(h.horse_no)))
        .sort((a,b)=>(valueBandScore(b,x.r)-valueBandScore(a,x.r))||(tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode)));
      if(valueCands.length){
        picks.push(valueCands[0]); selected.add(String(valueCands[0].horse_no));
        if(strongValueMatch(valueCands[0])) protectedValueNos.add(String(valueCands[0].horse_no));
      }
      // KULLANICI TALİMATI (kesin bulgu): isPastWinningExtra -- bu koşu şartında veya
      // genel geçmişte GERÇEKTEN kazanmış (condWinWins/priorWins>0) ve buna ek bir destek
      // sinyali (SONUÇ ilk-6, BMB, güçlü profil skoru veya sürpriz profil eşleşmesi) olan
      // atlar -- tanımlıydı ama HİÇBİR YERDEN ÇAĞRILMIYORDU (bu oturumdan önce de böyleydi,
      // orijinal dosyada da aynı). Artık gerçekten çalışıyor ve bütçe kırpmasına karşı
      // korumalı: "Profil Gücü %21, GEÇMİŞ 1/1" gibi gerçek geçmiş kazananlar artık
      // Sürpriz/Normal/Geniş Kupon'dan sessizce düşürülmüyor.
      const pastWinnerExtra=ordered.filter(h=>!selected.has(String(h.horse_no)) && isPastWinningExtra(x.r,h))
        .sort((a,b)=>tkpCouponStrengthCached(x.r,b,mode)-tkpCouponStrengthCached(x.r,a,mode))[0];
      if(pastWinnerExtra){
        picks.push(pastWinnerExtra); selected.add(String(pastWinnerExtra.horse_no));
        protectedValueNos.add(String(pastWinnerExtra.horse_no));
      }
      // Zaten pool'da (önceki kurallardan) bulunan ama henüz korunmayan güçlü değer
      // bandı adayları da korumaya alınır -- sadece şimdi eklenen değil.
      for(const h of picks){ if(strongValueMatch(h) || isPastWinningExtra(x.r,h)) protectedValueNos.add(String(h.horse_no)); }
      tkpStableOrderSort(picks, ordered);
    }
    // Ortak para-sinyali önceliği: BMB/ODB/TKP adayları değerlendirmeye alınır ancak
    // bütçe üst sınırını delecek biçimde "dokunulmaz" yapılmaz. Sinyallerin tamamını
    // zorunlu korumak ile 750–800 / 1200–1600 / 750–800 TL iskeletini korumak aynı anda her yarışta
    // mümkün değildir; kesin kural bütçe ve kupon yapısıdır.
    const protectMoneySignals=!plan.reliable && (leaderFloorCount>=5 || difficultMin>=6 || mode==='surprise');
    if(protectMoneySignals){
      const signalPicks=couponMoneySignalCandidates(x,ordered);
      picks=dedupeEkuri(picks.concat(signalPicks),x.r,mode,true);
      tkpStableOrderSort(picks, ordered);
    }
    // V1.1.57 PARA VEREN ALTILI HİBRİDİ: Sürpriz kuponda en güçlü gerçek bomba
    // adayı korunur; ikinci bomba ancak puanı 60+ ise alınır. Bunlar ayrıştırma
    // takasında silinmez. Sonuç/ikramiye alanları puana kesinlikle girmez.
    const protectedBombNos=new Set();
    const hybridBombScores=new Map();
    if(mode==='surprise'&&!plan.reliable){
      const bombs=tkpHybridBombCandidates(x,ordered);
      for(const row of bombs){
        protectedBombNos.add(String(row.h.horse_no));
        hybridBombScores.set(String(row.h.horse_no),row.score);
      }
    }
    if(!plan.reliable){
      const targetMax=Math.min(10,ordered.length,Math.max(picks.length,difficultMin||0,forcedCoverageCount||0));
      if(targetMax>picks.length){
        const selected=new Set(picks.map(h=>String(h.horse_no)));
        for(const h of coreProtectionCandidates(x,ordered)){
          if(picks.length>=targetMax) break;
          if(selected.has(String(h.horse_no))) continue;
          picks.push(h); selected.add(String(h.horse_no));
        }
        picks=dedupeEkuri(picks,x.r,mode,true);
        tkpStableOrderSort(picks, ordered);
      }
    }
    const requiredLeaders=dedupeEkuri(displayOrder.slice(0,leaderFloorCount),x.r,mode,true);
    const guardedWithoutBomb=picks.filter(h=>protectedValueNos.has(String(h.horse_no))||protectedSignalNos.has(String(h.horse_no)));
    const baseRequiredCoverageCount=dedupeEkuri(requiredLeaders.concat(guardedWithoutBomb),x.r,mode,true).length;
    const guardedNow=picks.filter(h=>protectedValueNos.has(String(h.horse_no))||protectedSignalNos.has(String(h.horse_no))||protectedBombNos.has(String(h.horse_no)));
    const requiredCoverageCount=dedupeEkuri(requiredLeaders.concat(guardedNow),x.r,mode,true).length;
    const minCoverage=plan.reliable?1:Math.max(2,difficultMin,forcedCoverageCount,requiredCoverageCount);
    return {r:x.r,baseScore:plan.strength,protectedFlag:plan.reliable,picks,allHorses:x.scored,strictPool:x.strictPool,ordered,displayOrder,coverageMode:mode,
      minCoverage,hybridBaseMinCoverage:plan.reliable?1:Math.max(2,difficultMin,forcedCoverageCount,baseRequiredCoverageCount),maxCoverage:difficultMin?Math.min(10,ordered.length):null,strategyCoverage:!!forcedCoverageCount,protectedValueNos,protectedSignalNos,protectedBombNos,hybridBombScores,leaderFloorCount,profileFloorCount,
      riskMinCoverage:plan.reliable?1:difficultMin,
      confidencePlan:{...plan,difficulty:raceDifficultyIndex(x),riskMinCoverage:plan.reliable?1:difficultMin}};
  });
  // Bomba sinyalini altı ayağa birden yaymak, aynı bütçe içinde güvenli adayları
  // gereksiz yere sıkıştırır. Toplantı başına yalnız en yüksek puanlı TEK bomba
  // ayağı aktif kalır; diğer ayaklar V1.1.56 P1 omurgasını aynen kullanır.
  if(mode==='surprise'){
    const meetingBombs=[];
    for(let i=0;i<legs.length;i++){
      for(const [no,score] of legs[i].hybridBombScores||[])meetingBombs.push({i,no,score:Number(score)||0});
    }
    meetingBombs.sort((a,b)=>b.score-a.score);
    const chosenBomb=(meetingBombs[0]?.score||0)>=78?meetingBombs[0]:null;
    for(let i=0;i<legs.length;i++){
      const leg=legs[i];
      if(!chosenBomb||chosenBomb.i!==i){leg.protectedBombNos=new Set();leg.hybridBombScores=new Map();leg.minCoverage=leg.hybridBaseMinCoverage;continue;}
      leg.protectedBombNos=new Set([chosenBomb.no]);
      leg.hybridBombScores=new Map([[chosenBomb.no,chosenBomb.score]]);
    }
  }
  // Güvenilir tek yalnız dinamik eşikleri gerçekten sağlayınca üretilir; zorla tek yok.
  // Sadece 2 at yazılan (küçük kadrolu / eşleşme) koşularda, TEK yanlış seçilirse kupon
  // boşuna yatmasın diye alandaki iki at da BİRLİKTE kapsanır — TEK olarak sabitlenmiş
  // ayaklar dahil. Sadece 2 aday olduğu için ek maliyet her zaman 1 kolon kadardır.
  // İSTİSNA: bu 2 at aynı eküri numarasının iki girişiyse (örn. 10-E1 ve 10-E2), bahis
  // açısından tek numarayı temsil ederler — ikisini birlikte kapsamak anlamsızdır, tek biri
  // (daha güçlü olan) yeterlidir.
  for (const l of legs){
    if (l.allHorses && l.allHorses.length === 2 && l.picks.length < 2){
      const g0=ekuriGroup(l.allHorses[0].horse_no), g1=ekuriGroup(l.allHorses[1].horse_no);
      const sameEkuri = !!g0 && g0===g1;
      if (sameEkuri) continue;
      const missing = l.allHorses.find(h => !l.picks.some(p => String(p.horse_no) === String(h.horse_no)));
      if (missing){
        l.picks = l.allHorses.slice();
        l.protectedFlag = true;
        l.confidencePlan = {...l.confidencePlan, reliable:true, reason:(l.confidencePlan.reason?l.confidencePlan.reason+' + ':'')+'2 atlı koşu güvencesi (her iki at da kapsandı)'};
      }
    }
  }

  // Kuponun bir ayakta dar kapsama (2 veya 3 at) yazdığı, ama alanda daha fazla at olduğu
  // durumlarda, ayağı doğrudan 4 ata çıkarmak için SONUÇ 1-2. veya AGF 1-2. sıradan, seçili
  // olmayanlar arasında şartı en güçlü olan adaylar bulunup eklenir. Böylece gerçekten kazanma
  // ihtimali yüksek sayılan favoriler, sırf dar kapsama yüzünden kupon dışında kalmaz. TEK
  // (protectedFlag) ayaklara dokunulmaz.
  for (const l of legs){
    if (l.protectedFlag || l.strategyCoverage) continue;
    while (l.allHorses && l.allHorses.length > l.picks.length && l.picks.length < 4){
      const selected = new Set(l.picks.map(h => String(h.horse_no)));
      const selectedBase = new Set(l.picks.map(h => ekuriBase(h.horse_no)));
      const cand = dedupeEkuri(l.ordered && l.ordered.length ? l.ordered : l.allHorses,l.r,mode,true)
        .filter(h => !selected.has(String(h.horse_no)) && !selectedBase.has(ekuriBase(h.horse_no)) && (tkpFrozenOdsResultRank(h)<=2 || h.agf_rank<=2))
        .sort((a,b) => tkpCouponStrengthCached(l.r,b,mode) - tkpCouponStrengthCached(l.r,a,mode))[0];
      if (!cand) break;
      l.picks = l.picks.concat([cand]);
      if (l.ordered && l.ordered.length) tkpStableOrderSort(l.picks, l.ordered);
    }
  }
  // SON GÜVENCE: Kupon kuralları sonradan aday eklese bile aynı ayakta aynı eküri
  // etiketi (E1, E2 vb.) iki kez kalamaz. Her eküri grubundan yalnız en güçlü at tutulur.
  for(const l of legs){
    l.picks = dedupeEkuri(l.picks,l.r,mode,true);
    if(l.ordered && l.ordered.length) tkpStableOrderSort(l.picks, l.ordered);
  }

  // Tahmin ekranının ilk sıralarını kuponda zorunlu tutar. At sayısı 3 ise ilk 3,
  // 4 ve üzeriyse ilk 4; 2'ye düşerse ilk 2 korunur. Eküriler tek bahis numarası sayılır.
  function enforcePredictionLeaders(leg, targetCount){
    if(!leg || leg.protectedFlag || targetCount<=0) return;
    // KESİN SIRA KİLİDİ (V1.1.17): Kupon 8 at yazıyorsa Ayak ekranının ilk 8'i
    // zorunludur. Önceki kod guarded adayları liderlerden önce ekleyip slice yaptığı
    // için ekran 4.'sü bile kupondan düşebiliyordu (İstanbul 1. ayak, 15 İLKUTHAN).
    // İlk planın lider tabanı korunur; bunun dışındaki BMB/ODB/TKP para sinyalleri
    // ekstra güvenlik olarak eklenir. Böylece 8 atlık ana listede ilk 8 korunurken,
    // daha aşağıdaki kanıtlı sinyal de sessizce kesilmez.
    const isGuarded=h=>(leg.protectedValueNos&&leg.protectedValueNos.has(String(h.horse_no)))||
      (leg.protectedSignalNos&&leg.protectedSignalNos.has(String(h.horse_no)));
    // Korunan aday daha önceki bir daraltma adımında geçici olarak picks dışına
    // çıkmış olsa bile asıl sıralama havuzundan yeniden bulunur. Yalnız mevcut
    // picks'i taramak, koruma bayrağı dururken atın kupondan kaybolmasına yol açıyordu.
    const guarded=(leg.ordered||leg.picks||[]).filter(isGuarded);
    const leaderCount=Math.min(targetCount,Math.max(1,Number(leg.leaderFloorCount)||targetCount));
    const leaders=dedupeEkuri((leg.displayOrder||[]).slice(0,leaderCount),leg.r,mode,true);
    const required=dedupeEkuri(leaders.concat(guarded),leg.r,mode,true);
    const desiredCount=Math.max(targetCount,required.length);
    const combined=dedupeEkuri(required.concat(leg.picks||[]),leg.r,mode,true);
    leg.picks=combined.slice(0,desiredCount);
    if(leg.ordered && leg.ordered.length){
      const rank=new Map((leg.displayOrder||[]).map((h,i)=>[String(h.horse_no),i]));
      leg.picks.sort((a,b)=>(rank.get(String(a.horse_no))??999)-(rank.get(String(b.horse_no))??999));
    }
  }
  for(const l of legs) enforcePredictionLeaders(l,l.picks.length);

  // V1.1.53 HIZ MİMARİSİ: Eski akış burada önce bacak bacak açgözlü kırpma/
  // genişletme yapıyor, hemen ardından enforceCouponCostCap aynı işi ortak DP ile
  // baştan yapıyordu. Korumalı aday hedef sayıyı aştığında eski döngü ilerleme
  // kaydedemeyip özellikle Geniş kuponda onlarca saniye takılabiliyordu. Bu fonksiyon
  // artık yalnız adayları ve koruma metadatasını hazırlar; tek maliyet/kolon kararı
  // çağıran üç builder'daki JOINT_LOG_COVERAGE_DP katmanına bırakılır.
  const preparedCombos=legs.reduce((product,leg)=>product*Math.max(1,(leg.picks||[]).length),1);
  const preparedCost=unit*preparedCombos;
  return {legs,combos:preparedCombos,cost:preparedCost,
    reliableSingles:legs.filter(leg=>leg.confidencePlan?.reliable).length,
    minimumRequired:preparedCost,budgetLimited:preparedCost>Math.max(0,Number(budgetTL)||0),
    allocationStage:'CANDIDATES_PREPARED_FOR_JOINT_DP'};
}

function strictRankedRaceResults(raceResults){
  return (raceResults || []).map(x => {
    // Arşiv/frozen kartta yarış-öncesi sıra zaten snapshot olarak kilitlidir.
    // Bu yolda güncel geçmiş profil indeksini yeniden kurmak yalnızca görüntüleme
    // maliyetidir (509 yedekte onlarca saniye); aynı frozen sıra güvenli biçimde
    // katı kupon havuzu olarak kullanılır. Canlı/sonuçsuz kartlar aşağıdaki normal
    // strictCandidatePool yolundan geçmeye devam eder.
    if(typeof tkpIsArchivedReadOnly==='function' && tkpIsArchivedReadOnly(x?.r||x)){
      const frozen=typeof tkpArchivedOrderedRows==='function'
        ?tkpArchivedOrderedRows({r:x?.r||x,scored:x?.scored||x?.r?.horses||[]})
        :(x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h)).slice();
      if(!frozen.length)return null;
      frozen.forEach((h,index)=>{h.altili_winner_rank=index+1;if(!Number.isFinite(Number(h.altili_winner_score)))h.altili_winner_score=0;});
      return Object.assign({},x,{strictPool:frozen,top:frozen[0],second:frozen[1]||null,third:frozen[2]||null});
    }
    const strictPool=strictCandidatePool(x);
    const winnerOrder=typeof altiliWinnerOrderForRace==='function'
      ? altiliWinnerOrderForRace(x.r,(x.scored||x.r?.horses||[]))
      : (x.scored||[]).slice();
    if(!winnerOrder.length) return null;
    const allowed=new Set(strictPool.map(h=>String(h.horse_no)));
    // Ana sıralamaya dokunmadan, kanıtlı kuyruk adaylarının Sürpriz portföyüne
    // ulaşabilmesi için katı aday kapısında en fazla üç ek aday açılır.
    if(typeof tkpPortfolioHedgesForRace==='function'){
      for(const row of tkpPortfolioHedgesForRace(x.r,winnerOrder,3)||[]){
        if(row?.horse) allowed.add(String(row.horse.horse_no));
      }
    }
    // Tahmin 1 lideri katı havuz kurallarına takılsa bile Altılı değerlendirmesinden
    // silinmez; kalan adaylar da yalnız aynı p1 sırasına göre dizilir.
    allowed.add(String(winnerOrder[0].horse_no));
    const effPool=winnerOrder.filter(h=>allowed.has(String(h.horse_no)));
    return Object.assign({}, x, {
      strictPool: effPool,
      top: effPool[0],
      second: effPool[1] || null,
      third: effPool[2] || null
    });
  }).filter(Boolean).sort((a,b) =>
    (Number(b.top.altili_winner_score)||0)-(Number(a.top.altili_winner_score)||0)
    || (b.top.score||0)-(a.top.score||0)
    || conditionSingleStrength(b.r,b.top)-conditionSingleStrength(a.r,a.top)
  );
}
async function strictRankedRaceResultsAsync(raceResults){
  const rows=[];
  for(const item of (raceResults||[])){
    await tkpCouponPause(`Ayak ${item?.r?.leg||''}: sıralama`);
    const one=strictRankedRaceResults([item]);if(one[0])rows.push(one[0]);
  }
  return rows.sort((a,b)=>(Number(b.top.altili_winner_score)||0)-(Number(a.top.altili_winner_score)||0)||(b.top.score||0)-(a.top.score||0)||conditionSingleStrength(b.r,b.top)-conditionSingleStrength(a.r,a.top));
}


// Kupon türüne göre kesin maliyet tavanı uygular.
// Seçimler güçlüden zayıfa sıralı olduğu için, tavan aşılırsa her ayakta
// en sondaki (en düşük öncelikli) adaylar kontrollü biçimde çıkarılır.
// SON BÜTÇE KİLİDİ (2026-08-16) — V55: üst sınır korunur; 700–1.400 bantları tavana zorla doldurmaz.
function enforceCouponCostCap(legs, unit, capTL){
  const cap=Math.max(0,Number(capTL)||0);
  const comboCount=()=>legs.reduce((n,l)=>n*Math.max(1,(l.picks||[]).length),1);
  const maxCombos=Math.max(0,Math.floor((cap+1e-9)/Math.max(.0001,Number(unit)||1)));

  function rankedForLeg(leg){
    const mode=leg?.coverageMode||'main';
    const display=(leg?.displayOrder||[]).filter(h=>h&&!isNonRunner(h));
    const scenario=(mode==='main'||!(leg?.ordered||[]).length)?display:(leg.ordered||[]);
    const xForced=[...(leg?.picks||[]),...(leg?.ordered||[])].filter(tkpLegacyXKulisForce);
    const narrowNo=String(leg?.confidencePlan?.narrowBmbExtra?.horse_no||'');
    const narrowHorse=narrowNo?(scenario||display).find(h=>String(h.horse_no)===narrowNo):null;
    // 2-at+BMB koruması final DP sıralamasında da ilk iki liderin hemen ardından gelir.
    // Böylece count=3 seçildiğinde üçüncü kolon sıradan 3. favori değil, planın seçtiği BMB olur.
    if(narrowHorse && (mode==='main'||mode==='alt')){
      return dedupeEkuri(xForced.concat(display.slice(0,2),[narrowHorse],display.slice(2),scenario,leg?.picks||[]),leg?.r,mode,true);
    }
    if(mode==='main') return dedupeEkuri(xForced.concat(display,scenario,leg?.picks||[]),leg?.r,mode,true);
    const guarded=(scenario||[]).filter(h=>(leg?.protectedSignalNos&&leg.protectedSignalNos.has(String(h.horse_no)))||
      (leg?.protectedValueNos&&leg.protectedValueNos.has(String(h.horse_no))));
    const core=display.slice(0,Math.min(5,display.length));
    if(mode==='surprise'){
      const bombs=(scenario||[]).filter(h=>leg?.protectedBombNos?.has(String(h.horse_no)))
        .sort((a,b)=>(Number(leg?.hybridBombScores?.get(String(b.horse_no)))||0)-(Number(leg?.hybridBombScores?.get(String(a.horse_no)))||0));
      // Yalnız toplantının en güçlü bomba ayağında ilk iki P1'in ardından gelir.
      // Diğer beş ayakta bombs boş olduğundan V1.1.56 sırası değişmez.
      return dedupeEkuri(xForced.concat(core.slice(0,2),bombs,core.slice(2),guarded,scenario,display,leg?.picks||[]),leg?.r,mode,true);
    }
    return dedupeEkuri(xForced.concat(core,guarded,scenario,display,leg?.picks||[]),leg?.r,mode,true);
  }

  // BÜTÇE TAVANI KESİNDİR; ancak risk-first hard floor sessizce budanmaz. Zor ayak tabanı tavana sığmıyorsa açık riskFloorConflict üretilir.
  function hardFloor(leg,ranked){
    if(leg?.protectedFlag) return 1;
    const field=Math.max(1,(ranked||[]).length);
    const riskFloor=Math.max(0,Number(leg?.riskMinCoverage)||Number(leg?.confidencePlan?.riskMinCoverage)||0);
    // RISK-FIRST: zor/çok zor ayakların 6 / 8 / 10 tabanı bütçe optimizasyonu
    // tarafından ASLA aşağı çekilmez. Bütçe gerekiyorsa önce düşük riskli ayaklar
    // 2-3 attan 1'e kadar daraltılır. Bu, kullanıcının yıllardır gözlediği
    // zor ayağı kesip kolay ayağa kolon harcama başarısızlığını kökten tersine çevirir.
    if(riskFloor>0) return Math.min(field,riskFloor);
    // Bütçe riskli ayaktan DEĞİL düşük riskli ayaktan kısılır. Çok düşük riskli
    // ve TEK olmayan ayak final bütçe optimizasyonunda 1 ata kadar daralabilir;
    // orta riskli ayak en az 2 kalır. 2-at+BMB özel koruması varsa 3 korunur.
    const rawDifficulty=Number(leg?.confidencePlan?.difficulty);
    const lowRisk=Number.isFinite(rawDifficulty)&&rawDifficulty<45;
    const mode=leg?.coverageMode||'main';
    // TOMMY EXACT-TEK INVARIANT: Portföy TEK'i olmayan Normal/Sürpriz ayaklar
    // bütçe DP'si tarafından ikinci/üçüncü gizli TEK'e daraltılamaz. Böylece canlı
    // kupon, A4 ve Back Test gerçekten Normal=1 / Sürpriz=2 TEK üretir.
    const exactPortfolioFloor=(mode==='main'||mode==='surprise')?2:(lowRisk?1:2);
    const structural=leg?.confidencePlan?.narrowBmbExtra&& (ranked||[]).length>=3?3:exactPortfolioFloor;
    return Math.min(structural,field);
  }
  function candidateMass(leg,horse){
    const mode=leg?.coverageMode||'main';
    const baseStrength=typeof couponCandidateStrength==='function'
      ? tkpCouponStrengthCached(leg.r,horse,mode)
      : (Number(horse?.score)||0)+(Number(horse?.ypuan)||0)/100;
    let value=Math.max(.001,baseStrength);
    if(mode!=='main'&&leg?.protectedSignalNos?.has(String(horse?.horse_no))) value+=.65;
    // Bomba puanı aday SIRASINI etkiler; ayaklar arası bütçe/kapsam dağılımını
    // değiştirmez. Aksi halde bir bombanın kütlesi başka bir ayağı 6 attan 3 ata
    // indirerek güvenli omurgayı bozar.
    if(mode!=='main'&&typeof tkpSurpriseEvidenceForHorse==='function'){
      try{ value+=Math.max(0,Number(tkpSurpriseEvidenceForHorse(leg.r,horse,leg.displayOrder||[]).score)||0)*.55; }catch(_){ }
    }
    // Aşırı sivri ham skorların tek bir ayağı bütün bütçeyi yutmasını engelleyen
    // yumuşak üs; sıralama korunur, kütleler kalibre edilebilir aralıkta kalır.
    return Math.exp(Math.max(-4,Math.min(4,value*.85)));
  }

  const prepared=legs.map(leg=>{
    const ranked=rankedForLeg(leg);
    const maxCount=Math.max(1,Math.min(ranked.length,Number(leg?.maxCoverage)||10));
    let minCount=hardFloor(leg,ranked);
    const mode=leg?.coverageMode||'main';
    // Ayak Önerisi / profil tabanı önce tam olarak denenir. Ancak bu genişlik bütçeye
    // sığmıyorsa ikinci DP turu minCount'a kadar iner; tavanı aşan kupon bırakılmaz.
    const preferred=Math.min(maxCount,Math.max(
      minCount,
      Number(leg?.minCoverage)||0,
      Number(leg?.hybridBaseMinCoverage)||0,
      Number(leg?.profileFloorCount)||0
    ));
    const masses=ranked.slice(0,maxCount).map(h=>candidateMass(leg,h));
    const total=Math.max(.000001,masses.reduce((sum,value)=>sum+value,0));
    const options=[];
    let covered=0;
    for(let count=1;count<=maxCount;count++){
      covered+=masses[count-1]||0;
      if(count<minCount) continue;
      const probability=Math.max(.000001,Math.min(.999999,covered/total));
      // Risk-first bütçe dağıtımı: aynı ilave kolon zor ayakta daha değerlidir.
      // Böylece zor ayağın hard flooru korunduktan sonra kalan bütçe de önce riskli
      // ayaklara gider; düşük riskli ayaklar gerektiğinde daha erken daralır.
      const difficulty=Math.max(0,Math.min(100,Number(leg?.confidencePlan?.difficulty)||0));
      const riskWeight=0.85+(difficulty/100)*1.65;
      const floorPenalty=count<preferred?(preferred-count)*.20:0;
      options.push({count,utility:riskWeight*Math.log(probability)-floorPenalty});
    }
    if(leg?.protectedFlag){
      const count=Math.max(1,(leg.picks||[]).length);
      return {leg,ranked,options:[{count,utility:0}],preferred:count,minCount:count};
    }
    return {leg,ranked,options,preferred,minCount};
  });

  function runDp(usePreferredFloor){
    let states=new Map([[1,{utility:0,counts:[]}]]);
    for(const item of prepared){
      const next=new Map();
      const options=usePreferredFloor
        ? item.options.filter(option=>option.count>=item.preferred)
        : item.options;
      const usable=options.length?options:item.options;
      for(const [product,state] of states) for(const option of usable){
        if(typeof tkpCouponCheck==='function')tkpCouponCheck();
        const newProduct=product*option.count;
        if(newProduct>maxCombos) continue;
        const utility=state.utility+option.utility;
        const old=next.get(newProduct);
        if(!old||utility>old.utility+1e-12) next.set(newProduct,{utility,counts:state.counts.concat(option.count)});
      }
      states=next;
      if(!states.size) return null;
    }
    let best=null;
    for(const [product,state] of states){
      if(!best||state.utility>best.utility+1e-12||(Math.abs(state.utility-best.utility)<=1e-12&&product<best.product)){
        best={...state,product};
      }
    }
    return best;
  }

  const selected=runDp(true)||runDp(false);
  if(!selected){
    // Risk tabanlarının çarpımı bütçeden büyükse zor ayağı sessizce 6->4 / 8->2
    // kırpmak YASAK. Önce her ayak gerçek hard flooruna çekilir. Bu minimum hâlâ
    // tavana sığmıyorsa kupon açıkça RISK_FLOOR_BUDGET_CONFLICT olarak işaretlenir;
    // başarıyı koruyan kapsam saklanır ve kullanıcıya gizli daraltma yapılmaz.
    for(const item of prepared){
      const leg=item.leg, ranked=item.ranked||[];
      const count=Math.max(1,item.minCount||1);
      leg.picks=ranked.slice(0,count);
      leg.optimizedCoverageCount=leg.picks.length;
    }
    const combos=comboCount(),cost=unit*combos;
    return {legs,combos,cost,capTL:cap,capLimited:cost>cap+1e-9,riskFloorConflict:cost>cap+1e-9,columnOptimization:'RISK_FLOOR_BUDGET_CONFLICT'};
  }
  selected.counts.forEach((count,index)=>{
    const item=prepared[index],leg=item.leg;
    leg.picks=item.ranked.slice(0,count);
    // Kartta atlar yine ana Tahmin sırasındaki numaralarıyla okunur; yalnız dahil
    // edilme kararı portföy optimizasyonundan gelir.
    const displayRank=new Map((leg.displayOrder||[]).map((h,i)=>[String(h.horse_no),i]));
    leg.picks.sort((a,b)=>(displayRank.get(String(a.horse_no))??999)-(displayRank.get(String(b.horse_no))??999));
    leg.optimizedCoverageCount=count;
  });
  let combos=comboCount(),cost=unit*combos;
  const capLimited=cost>cap+1e-9;
  // R16.60 TABAN GARANTİSİ (kullanıcı isteği: "kupon tutarları 1000-1400 arası
  // olsun, her kupon kendi mantığına göre ayarlasın"). DP yalnız verilen tavana
  // (cap) göre en iyi kombinasyonu seçtiği için "disiplinli" toplantılarda (tek
  // güçlü favori -> hedef sabit 1.000 TL, bkz. tkpV55BudgetTarget) gerçek maliyet,
  // ayak genişliklerinin ayrık çarpımı yüzünden tavanın biraz altına (örn. 960 TL)
  // düşebiliyor ve politika tabanının (1.000 TL) altında kalıyordu. Aşağıdaki adım
  // DP'nin ayak seçim/sıralama mantığına dokunmaz; yalnız gerçekleşen maliyet taban
  // altındaysa ve politika tavanına (1.400 TL) sığan en ucuz tek-ayak genişletmesi
  // varsa uygulanır. Böylece Normal/Sürpriz/Uzman kuponların her biri kendi ayak
  // sırasına göre en az maliyetle tabanı geçer; rastgele ya da aşırı büyümez.
  const feePolicy=(typeof TKP_COUPON_FEE_POLICY==='object'&&TKP_COUPON_FEE_POLICY)?TKP_COUPON_FEE_POLICY:null;
  const floorTL=Number(feePolicy?.minBudgetTL)||0;
  const ceilTL=Math.max(cap,Number(feePolicy?.maxBudgetTL)||cap);
  let floorAdjusted=false;
  if(floorTL>0&&cost>0&&cost<floorTL-1e-9){
    let bestIndex=-1,bestCost=Infinity;
    for(let i=0;i<prepared.length;i++){
      const item=prepared[i],leg=item.leg;
      if(leg?.protectedFlag)continue;
      const curCount=Number(leg?.optimizedCoverageCount)||(leg?.picks||[]).length;
      if(curCount<=0)continue;
      const maxAllowed=item.options&&item.options.length?Math.max(...item.options.map(o=>o.count)):curCount;
      const nextCount=curCount+1;
      if(nextCount>maxAllowed)continue;
      const nextCost=cost*(nextCount/curCount);
      if(nextCost>=floorTL-1e-9&&nextCost<=ceilTL+1e-9&&nextCost<bestCost){bestCost=nextCost;bestIndex=i;}
    }
    if(bestIndex>=0){
      const item=prepared[bestIndex],leg=item.leg;
      const curCount=Number(leg?.optimizedCoverageCount)||(leg?.picks||[]).length;
      leg.picks=item.ranked.slice(0,curCount+1);
      const displayRank=new Map((leg.displayOrder||[]).map((h,i)=>[String(h.horse_no),i]));
      leg.picks.sort((a,b)=>(displayRank.get(String(a.horse_no))??999)-(displayRank.get(String(b.horse_no))??999));
      leg.optimizedCoverageCount=leg.picks.length;
      combos=comboCount();cost=unit*combos;
      floorAdjusted=true;
    }
  }
  return {legs,combos,cost,capTL:cap,capLimited,floorAdjusted,columnOptimization:'JOINT_LOG_COVERAGE_DP'};
}


function tkpBhOdbRescueRowsForLeg(leg){
  const race=leg?.r||{};
  const source=(leg?.displayOrder?.length?leg.displayOrder:(leg?.ordered?.length?leg.ordered:(leg?.allHorses||race?.horses||[])))
    .filter(h=>h&&!isNonRunner(h));
  const byNo=new Map(source.map(h=>[String(h?.horse_no||''),h]));
  let raw=[];
  try{
    const archived=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race);
    const resultKnown=typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(race?.horses||[]);
    // Eski/sonuçlu yarışta yalnız yarış öncesinde dondurulmuş BH snapshotı kullanılır.
    // Böylece bu düzeltme eski kuponlara da uygulanır ama sonuçtan geriye aday üretmez.
    const key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(race):'';
    const log=typeof db!=='undefined'&&Array.isArray(db?.bomb_hunter_shadow_log)?db.bomb_hunter_shadow_log:[];
    const frozen=key?log.find(row=>row?.race_key===key):null;
    if(Array.isArray(frozen?.candidates)&&frozen.candidates.length) raw=frozen.candidates.slice();
    else if(!archived&&!resultKnown&&typeof tkpBombHunterCandidates==='function') raw=tkpBombHunterCandidates(race)||[];
  }catch(_){ raw=[]; }
  if(!raw.length)return [];
  let selected=raw;
  try{if(typeof tkpBombHunterThreeFromRows==='function')selected=tkpBombHunterThreeFromRows(race,raw)||raw;}catch(_){ }
  return (selected||[]).map((row,index)=>{
    const no=String(row?.horse_no??row?.h?.horse_no??'').trim();
    const h=byNo.get(no)||row?.h||null;
    const kind=String(row?.kind||'BOMBA').toUpperCase()==='ODB'?'ODB':'BOMBA';
    const categoryRank=Number(row?.category_rank)||((kind==='ODB')?1:index+1);
    return {h,kind,categoryRank,rank:Number(row?.rank)||index+1,near:Number(row?.near_win_score),score:Number(row?.score)||0};
  }).filter(row=>row.h&&!isNonRunner(row.h));
}

function tkpApplyBmbRescueSwap(coupon){
  // R18.9 BH/ODB KAPSAMA KİLİDİ:
  // 6/7/8+ atlı çoklu ayaklarda Bomba Avcısı doğru adayı üretmişse, kontenjan dolu
  // diye sessizce dışarı atılmaz. At sayısı, kolon ve bütçe değişmeden 1:1 takas yapılır.
  // 6 at: BH1; 7 at: BH1+BH2; 8+ at: BH1+BH2 + (BH3/ODB1 içinden en güçlü).
  // TEK ayaklara dokunulmaz. Sonuçlu/eski yarışlarda yalnız frozen BH snapshotı okunur.
  if(!coupon||coupon.error||!Array.isArray(coupon.legs)) return coupon;
  let swaps=0;
  for(const leg of coupon.legs){
    const picks=Array.isArray(leg?.picks)?leg.picks:[];
    if(picks.length<6 || leg?.protectedFlag || picks.length<=1) continue;
    const race=leg?.r||{};
    const rows=tkpBhOdbRescueRowsForLeg(leg);
    if(!rows.length)continue;
    const bombs=rows.filter(z=>z.kind!=='ODB').sort((a,b)=>a.categoryRank-b.categoryRank||a.rank-b.rank||(Number(b.near)||0)-(Number(a.near)||0)||(b.score-a.score));
    const odbs=rows.filter(z=>z.kind==='ODB').sort((a,b)=>a.rank-b.rank||(Number(b.near)||0)-(Number(a.near)||0)||(b.score-a.score));
    const required=[];
    if(bombs[0])required.push(bombs[0]);
    if(picks.length>=7&&bombs[1])required.push(bombs[1]);
    if(picks.length>=8){
      const extras=[bombs[2],odbs[0]].filter(Boolean).sort((a,b)=>{
        const an=Number.isFinite(a.near)?a.near:-1,bn=Number.isFinite(b.near)?b.near:-1;
        return bn-an || b.score-a.score || a.rank-b.rank;
      });
      if(extras[0])required.push(extras[0]);
    }
    if(!required.length)continue;

    const source=(leg?.displayOrder?.length?leg.displayOrder:(leg?.ordered?.length?leg.ordered:(leg?.allHorses||race?.horses||[])))
      .filter(h=>h&&!isNonRunner(h));
    const displayRank=new Map(source.map((h,i)=>[String(h?.horse_no||''),i]));
    const same=(a,b)=>{try{return typeof sameEkuri==='function'?sameEkuri(a?.horse_no,b?.horse_no):String(a?.horse_no)===String(b?.horse_no);}catch(_){return String(a?.horse_no)===String(b?.horse_no);}};
    const isProtectedPick=h=>{
      if(!h)return true;
      if(Number(h?.bmb)===1)return true;
      try{if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,race))return true;}catch(_){ }
      if(required.some(z=>same(z.h,h)))return true;
      if(source.slice(0,2).some(z=>same(z,h)))return true;
      const no=String(h?.horse_no||'');
      for(const setName of ['protectedValueNos','protectedSignalNos','protectedBombNos']){
        const s=leg?.[setName];if(s&&typeof s.has==='function'&&s.has(no))return true;
      }
      return false;
    };
    const rescueLog=[];
    for(const need of required){
      if(!need?.h||picks.some(p=>same(p,need.h)))continue;
      const candidates=picks.map((h,i)=>({h,i,rank:displayRank.get(String(h?.horse_no||''))??999,score:Number(h?.score)||0}))
        .filter(z=>!isProtectedPick(z.h))
        .sort((a,b)=>b.rank-a.rank || a.score-b.score);
      const removable=candidates[0];
      if(!removable)continue;
      picks[removable.i]=need.h;
      rescueLog.push({out:String(removable.h?.horse_no||''),in:String(need.h?.horse_no||''),kind:need.kind==='ODB'?'ODB1':`BH${need.categoryRank}`});
      swaps++;
    }
    picks.sort((a,b)=>(displayRank.get(String(a?.horse_no||''))??999)-(displayRank.get(String(b?.horse_no||''))??999));
    leg.picks=picks;
    if(rescueLog.length)leg.bhOdbRescueSwaps=rescueLog;
  }
  coupon.bmbRescueSwaps=swaps;
  coupon.bhOdbCoverageLock='R18.9-6-7-8';
  return coupon;
}

function tkpAgf69RescueScore(race,h,visibleRank){
  let s=0;
  const ar=Number(h?.agf_rank)||99, hr=Number(h?.hndkp_rank)||99, yp=Number(h?.ypuan)||0;
  if(ar>=6&&ar<=9) s+=18-(ar-6)*2;
  if(Number(h?.bmb)===1) s+=10;
  try{if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,race))s+=8;}catch(_){ }
  if(hr<=3)s+=6; else if(hr<=5)s+=3;
  if(yp>=35)s+=4; else if(yp>=20)s+=2;
  if(Number(h?.value_score)>=70)s+=5; else if(Number(h?.value_score)>=40)s+=2;
  if(Number(h?.jbyg_rank)>0&&Number(h?.jbyg_rank)<=3)s+=4;
  if(Number(h?.g800_rank??h?.g800)>0&&Number(h?.g800_rank??h?.g800)<=3)s+=3;
  s+=Math.max(0,7-(Number(visibleRank)||99));
  return s;
}
function tkpApplyAgf69AdditiveRescue(coupon,budgetTL,maxRescues=2){
  if(!coupon||coupon.error||!Array.isArray(coupon.legs)||!coupon.unit)return coupon;
  const cap=Math.max(Number(budgetTL)||0,Number(coupon.cost)||0);
  const legCandidates=[];
  for(let i=0;i<coupon.legs.length;i++){
    const leg=coupon.legs[i],picks=Array.isArray(leg?.picks)?leg.picks:[];
    if(picks.length<=1||leg?.protectedFlag)continue;
    const race=leg?.r||{};
    const source=(leg?.displayOrder?.length?leg.displayOrder:(leg?.ordered?.length?leg.ordered:(leg?.allHorses||[]))).filter(h=>h&&!isNonRunner(h));
    const selected=new Set(picks.map(h=>String(h?.horse_no)));
    const visible=source.slice().sort((a,b)=>{
      let av=Number(a?.score)||0,bv=Number(b?.score)||0;
      try{if(typeof tkpRaceVisibleDisplayScore==='function'){av=Number(tkpRaceVisibleDisplayScore(race,a))||av;bv=Number(tkpRaceVisibleDisplayScore(race,b))||bv;}}catch(_){ }
      return bv-av;
    });
    const rank=new Map(visible.map((h,j)=>[String(h?.horse_no),j+1]));
    const rescue=source.filter(h=>{const ar=Number(h?.agf_rank)||99;return ar>=6&&ar<=9&&!selected.has(String(h?.horse_no));})
      .map(h=>({h,score:tkpAgf69RescueScore(race,h,rank.get(String(h?.horse_no)))}))
      .sort((a,b)=>b.score-a.score)[0];
    if(!rescue||rescue.score<14)continue;
    let difficulty=0;try{difficulty=typeof raceDifficultyIndex==='function'?raceDifficultyIndex({r:race,scored:source}):0;}catch(_){ }
    legCandidates.push({i,leg,rescue:rescue.h,score:rescue.score+difficulty*.12,difficulty});
  }
  legCandidates.sort((a,b)=>b.score-a.score);
  let added=0;
  for(const z of legCandidates){
    if(added>=maxRescues)break;
    const before=z.leg.picks.slice();z.leg.picks=before.concat([z.rescue]);
    recalcCouponCost(coupon);
    if(coupon.cost>cap+1e-9){z.leg.picks=before;recalcCouponCost(coupon);continue;}
    z.leg.agf69Rescue={horse_no:String(z.rescue?.horse_no||''),horse_name:String(z.rescue?.horse_name||''),score:Math.round(z.score*10)/10};
    added++;
  }
  coupon.agf69Rescues=added;
  return coupon;
}


// V55.2 — TARGET15 KAPSAMA OMURGASI + CANONICAL TEK
// V53'teki 15/47 geliştirme sonucunun asıl kapsama gücü, her ayağı aynı genişlikte
// kesmek yerine birleşik pre-race sıralama olasılıklarını bütçe altında dengeleyen DP idi.
// Eski V53 TEK modeli geri getirilmez: TEK otoritesi V55.1'in isSingle=true 65/68
// canonical kararıdır. Böylece STAR OF HANDEL tipi zorla TEK geri dönmez.
function tkpClosestCostSingle(chosen,excludeLegs=new Set()){
  const candidates=(overviewStrongLegCandidates(chosen)||[]).filter(z=>{
    if(!z?.h||excludeLegs.has(z.i))return false;
    if(typeof canBeCouponSingle==='function'&&!canBeCouponSingle(z.h))return false;
    if(tkpLegacyXKulisBreaksSingle(z.h))return false;
    return true;
  }).sort((a,b)=>{
    const ad=a?.decision||{},bd=b?.decision||{};
    const aGap=Math.max(0,(Number(ad.threshold)||68)-(Number(ad.confidence)||0));
    const bGap=Math.max(0,(Number(bd.threshold)||68)-(Number(bd.confidence)||0));
    if(aGap!==bGap)return aGap-bGap;
    const ac=Number(ad.confidence)||0,bc=Number(bd.confidence)||0;
    if(ac!==bc)return bc-ac;
    return (Number(b.h?.score)||0)-(Number(a.h?.score)||0);
  });
  const z=candidates[0]||null;
  if(z&&z.decision){z.decision={...z.decision,isSingle:true,costSingle:true,reason:`Maliyet TEK'i · güven %${Math.round(Number(z.decision.confidence)||0)} / eşik %${Math.round(Number(z.decision.threshold)||68)}`};}
  return z;
}

function tkpV552BalancedNormalCoupon(raceResults,userCapTL,singleCount=1,preparedRanked=null,options={}){
  const ranked=preparedRanked||strictRankedRaceResults(raceResults);
  if(ranked.length<6) return {error:'Dengeli Normal için tam 6 ayak gerekli.'};
  const targetCoverage=singleCount===0||options?.normalMode==='coverage';
  // Normal için kullanıcıya gösterilen ve motorun kullandığı tek üst sınır budur.
  // Eski 5.000 TL anahtarı 31.250 TL'lik gizli bir profile sıçrıyordu; aylık kasa
  // korumasını deldiği için kaldırıldı.
  const userCap=tkpCouponBudgetFor(userCapTL,'main');
  const typeKey=singleCount>=2?'main2':'main';
  let target=targetCoverage?userCap:(typeof tkpV55BudgetTarget==='function'
    ? tkpV55BudgetTarget(raceResults,userCap,typeKey,singleCount)
    : Math.min(userCap,singleCount>=2?800:900));
  const chosen=ranked.slice(0,6);
  const strategy=singleCount>=2?'normal2':'normal';
  const forced=singleCount>0?forcedSinglePickMap(chosen,strategy,overviewStrongLegCandidates(chosen)):new Map();
  // AGF-bant TEK politikası altında maliyet uğruna band-dışı "Maliyet TEK'i"
  // üretilmez. Yeterli aday yoksa çağıran katman güvenli kapsama moduna iner.
  if(forced.size<singleCount) return {error:`Bu toplantıda ${singleCount} TEK için yeterli ayak/aday yok (bulunan: ${forced.size}).`};
  const singleByLeg=new Map();
  for(const [i,h] of forced.entries()){
    const legNo=Number(chosen[i]?.r?.leg)||0;
    if(legNo&&h) singleByLeg.set(legNo,h);
  }
  const ordered=(raceResults||[]).slice().sort((a,b)=>(Number(a?.r?.leg)||0)-(Number(b?.r?.leg)||0));
  if(ordered.length!==6) return {error:'Dengeli Normal 6 ayak sırası kurulamadı.'};
  const unit=ganyanUnitPrice(ordered[0]?.r?.hippodrome,6)||2;
  const specs=[];
  for(const x of ordered){
    const legNo=Number(x?.r?.leg)||0;
    if(singleByLeg.has(legNo)) continue;
    let fused=[];
    try{
      if(globalThis.TkpV53Target15?.fusionOrder) fused=globalThis.TkpV53Target15.fusionOrder(x.r,(x?.r?.horses||x?.scored||[]));
    }catch(_){ fused=[]; }
    if(!fused.length){
      const src=(tkpOrderedForLeg?.(x)||x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h));
      fused=src.map((horse,i)=>({horse,p:1/Math.max(1,i+1)}));
    }
    const groups=[],pos=new Map();
    for(const z of fused){
      const h=z?.horse||z;if(!h||isNonRunner(h))continue;
      let key='';
      try{key=globalThis.TkpV53Target15?.ekuriKey?globalThis.TkpV53Target15.ekuriKey(h.horse_no):'';}catch(_){ }
      if(!key){const g=ekuriGroup(h.horse_no);key=g?'E:'+g:'N:'+String(h.horse_no);}
      const prob=Math.max(1e-9,Number(z?.p)||0);
      if(!pos.has(key)){pos.set(key,groups.length);groups.push({key,horse:h,p:prob});}
      else groups[pos.get(key)].p+=prob;
    }
    if(groups.length<2) return {error:`${legNo}. ayakta bağımsız kapsama adayı bulunamadı.`};
    const total=groups.reduce((a,g)=>a+g.p,0)||1;groups.forEach(g=>g.p/=total);
    const alpha=1.6,weights=groups.map(g=>Math.pow(Math.max(g.p,1e-12),alpha));
    const sw=weights.reduce((a,b)=>a+b,0)||1;let c=0;const cum=weights.map(v=>(c+=v/sw));
    let minCount=2;
    try{minCount=Math.max(2,Number(difficultRaceMinimumCount(x))||0);}catch(_){ }
    // Normal kupon da geçmişteki tüm resmî sonuçlardan öğrenir. Öğrenilen genişlik
    // zor ayak tabanını aşağı çekmez; yalnız gerekli olduğunda genişletir.
    try{
      const policy=typeof tkpAllResultCouponPolicy==='function'
        ?tkpAllResultCouponPolicy(x.r,'main',minCount,groups.map(g=>g.horse)):null;
      if(policy?.status==='ÖĞRENİLDİ')minCount=Math.max(minCount,Number(policy.coverage)||0);
    }catch(_){ }
    minCount=Math.min(Math.min(8,groups.length),minCount);
    const maxCount=Math.min(8,groups.length);
    let difficulty=0;try{difficulty=Number(raceDifficultyIndex(x))||0;}catch(_){ }
    specs.push({x,legNo,groups,cum,minCount,maxCount,difficulty});
  }
  function solve(cap){
    const maxComb=Math.floor((cap+1e-9)/Math.max(.0001,unit));let best=null;
    // R16.27 KÖK FIX: bu arama tamamen senkron, tek bir yield noktası olmayan,
    // sınırsız özyinelemeli bir tam kombinasyon taramasıydı (6 ayak × ayak
    // başına en fazla 8 seçenek). enforceCouponCostCap'teki durum-sınırlı DP'nin
    // aksine burada gerçek üst sınır yoktu; belirli bütçe/aday dağılımlarında
    // yüz binlerce düğüm gezilip Chrome'un "Sayfa Yanıt Vermiyor" uyarısı
    // verdiği kadar uzun ana thread bloğu üretebiliyordu. Sabit bir düğüm
    // ziyaret tavanı arama kalitesini pratikte değiştirmez (en iyi sonuçlar
    // erken dallarda bulunur) ama sonlanmayı garanti eder.
    const NODE_VISIT_CAP=40000;
    let visited=0,capped=false;
    function walk(k,prod,counts,masses){
      if(capped)return;
      if(++visited>NODE_VISIT_CAP){capped=true;return;}
      if((visited&127)===0&&typeof tkpCouponCheck==='function')tkpCouponCheck();
      if(k===specs.length){
        const logs=masses.map(v=>Math.log(Math.max(v,1e-12)));
        const score=logs.reduce((a,b)=>a+b,0)+3*Math.min(...logs);
        if(!best||score>best.score+1e-12||(Math.abs(score-best.score)<=1e-12&&prod<best.prod)) best={score,prod,counts:counts.slice(),masses:masses.slice()};
        return;
      }
      const z=specs[k];
      for(let count=z.minCount;count<=z.maxCount;count++){
        if(capped)return;
        const np=prod*count;if(np>maxComb)continue;
        walk(k+1,np,counts.concat(count),masses.concat(z.cum[count-1]));
      }
    }
    walk(0,1,[],[]);return best;
  }
  // KÖK FIX (donma: "kupon hazırlanırken kilitledi"): solve() kendi içinde
  // NODE_VISIT_CAP ile sınırlı olsa da, bu tırmanma döngüsü target'ı userCap'e
  // ulaşana kadar +25 TL adımlarla onlarca kez yeniden çağırabiliyordu -- her
  // deneme tamamen senkron olduğundan (yield yok), toplamda 1M+ düğüm gezilip
  // ana thread saniyelerce (donma tanısında görülen tek çağrıda ~25 sn) kilitli
  // kalabiliyordu. Arama algoritması/sıralaması aynen korunur; yalnız toplam
  // deneme sayısı ve gerçek geçen süre için ek bir güvenlik tavanı eklendi.
  // Sınıra ulaşılması olağan durumda gerçekleşmez (tipik bütçe aralıklarında
  // birkaç denemede sonuç bulunur); yalnız aşırı geniş/zayıf budanan uç
  // senaryolarda devreye girer.
  const escalationStarted=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
  const ESCALATION_WALL_CLOCK_BUDGET_MS=4000;
  const ESCALATION_MAX_ATTEMPTS=60;
  let escalationAttempts=1,escalationTimedOut=false;
  let best=solve(target);
  while(!best && target<userCap){
    const elapsed=((typeof performance!=='undefined'&&performance.now)?performance.now():Date.now())-escalationStarted;
    if(elapsed>=ESCALATION_WALL_CLOCK_BUDGET_MS||escalationAttempts>=ESCALATION_MAX_ATTEMPTS){escalationTimedOut=true;break;}
    target=Math.min(userCap,target+25);best=solve(target);escalationAttempts++;
  }
  if(!best) return {error:escalationTimedOut?`Risk tabanı araması zaman bütçesini aştı (${userCap} TL tavanına ulaşılamadan durduruldu); tekrar dene.`:`Risk tabanları ${userCap} TL kullanıcı tavanına sığmıyor.`};
  // R16.60 TABAN GARANTİSİ (kullanıcı isteği: "kupon tutarları 1000-1400 arası
  // olsun, her kupon kendi mantığına göre ayarlasın"). "Disiplinli" toplantılarda
  // (tek güçlü favori -> tkpV55BudgetTarget hedefi sabit 1.000 TL) ayak
  // genişliklerinin ayrık çarpımı yüzünden gerçek maliyet tavanın biraz altına
  // (örn. 960 TL) düşüp politika tabanının (1.000 TL) altında kalabiliyordu. Bu
  // adım arama/sıralama mantığına dokunmaz; yalnız gerçekleşen maliyet taban
  // altındaysa ve politika tavanına (1.400 TL) sığan en ucuz tek-ayak
  // genişletmesi varsa uygulanır.
  {
    const feePolicy=(typeof TKP_COUPON_FEE_POLICY==='object'&&TKP_COUPON_FEE_POLICY)?TKP_COUPON_FEE_POLICY:null;
    const floorTL=Number(feePolicy?.minBudgetTL)||0;
    const ceilTL=Math.max(userCap,Number(feePolicy?.maxBudgetTL)||userCap);
    const curCost=best.prod*unit;
    if(floorTL>0&&curCost>0&&curCost<floorTL-1e-9){
      let bestIdx=-1,bestNextCost=Infinity;
      for(let i=0;i<specs.length;i++){
        const z=specs[i],count=best.counts[i];
        if(count>=z.maxCount)continue;
        const nextProd=best.prod/count*(count+1);
        const nextCost=nextProd*unit;
        if(nextCost>=floorTL-1e-9&&nextCost<=ceilTL+1e-9&&nextCost<bestNextCost){bestNextCost=nextCost;bestIdx=i;}
      }
      if(bestIdx>=0){
        const z=specs[bestIdx];
        const newCounts=best.counts.slice();newCounts[bestIdx]+=1;
        const newProd=newCounts.reduce((p,c)=>p*c,1);
        const newMasses=best.masses.slice();newMasses[bestIdx]=z.cum[newCounts[bestIdx]-1];
        best={...best,counts:newCounts,prod:newProd,masses:newMasses};
      }
    }
  }
  const countByLeg=new Map(specs.map((z,i)=>[z.legNo,best.counts[i]]));
  const specByLeg=new Map(specs.map(z=>[z.legNo,z]));
  const legs=ordered.map(x=>{
    const legNo=Number(x?.r?.leg)||0;
    if(singleByLeg.has(legNo)){
      const h=singleByLeg.get(legNo);
      return {x,r:x.r,picks:[h],displayOrder:(x?.scored||x?.r?.horses||[]),ordered:(x?.scored||[]),allHorses:(x?.r?.horses||[]),coverageMode:'main',protectedFlag:true,minCoverage:1,maxCoverage:1,confidencePlan:{reliable:true,reason:'V55 canonical %65/%68 TEK'}};
    }
    const z=specByLeg.get(legNo),count=countByLeg.get(legNo),display=z.groups.map(g=>g.horse);
    return {x,r:x.r,picks:display.slice(0,count),displayOrder:display,ordered:display,allHorses:(x?.r?.horses||[]),coverageMode:'main',protectedFlag:false,minCoverage:z.minCount,maxCoverage:z.maxCount,v552CoverageMass:z.cum[count-1],confidencePlan:{reliable:false,reason:'V53 dengeli kapsama + V55 risk tabanı'}};
  });
  const cost=best.prod*unit;
  return {typeKey,label:targetCoverage?'🎯 Normal · Kapsama':(singleCount>=2?'🛡️ Normal · 2 TEK':'💪 Normal · 1 TEK'),legs,unit,cost,combos:best.prod,legCount:6,budgetTL:target,maxBudgetTL:userCap,userCapTL:userCap,inputCapTL:userCap,leftover:round2ish(target-cost),reliableSingles:singleByLeg.size,dynamicBudget:true,algorithmVersion:globalThis.TKP_V55_ALGORITHM_VERSION||'V55.2',v552BalancedCoverage:true,targetCoverage,note:targetCoverage?'Normal kapsama profili: TEK zorlaması yok; ayak belirsizliğine göre genişlik dağıtılır. 700–1.400 TL tavanı aylık kasa politikasına bağlıdır.':'Toplantıya özel olasılık kütlesi + ortak bütçe DP; sabit geçmiş şablonu kullanılmaz.'};
}

function buildNormalCouponVariant(raceResults,userCapTL,singleCount=1,preparedRanked=null,options={}){
  const balanced=tkpV552BalancedNormalCoupon(raceResults,userCapTL,singleCount,preparedRanked,options);
  if(!balanced?.error) return balanced;
  // V53 fusion verisi eksik eski kartlarda yalnız güvenli geriye uyumluluk yolu.
  let ranked=preparedRanked||strictRankedRaceResults(raceResults);
  if(ranked.length<3)return balanced||{error:'Kesin aday şartlarını karşılayan en az 3 ayak bulunamadı.'};
  const userCap=tkpCouponBudgetFor(userCapTL,'main');
  const typeKey=singleCount>=2?'main2':'main';
  const dynamicTarget=typeof tkpV55BudgetTarget==='function'?tkpV55BudgetTarget(raceResults,userCap,typeKey,singleCount):Math.min(userCap,singleCount>=2?850:1000);
  let pick=chooseLegCountAndUnit(ranked,Math.max(dynamicTarget,2));
  if(!pick)pick={L:Math.min(6,ranked.length),unit:ganyanUnitPrice(ranked[0].r.hippodrome,Math.min(6,ranked.length))||2};
  const chosen=ranked.slice(0,pick.L),strategy=singleCount>=2?'normal2':'normal';
  const forced=forcedSinglePickMap(chosen,strategy,overviewStrongLegCandidates(chosen));
  // Fallback yolu da canlı Normal ile aynı AGF-bant sözleşmesine uyar; önceki
  // Maliyet TEK'i geri dönüp AGF filtresini bypass edemez.
  if(forced.size<singleCount)return balanced;
  let built=minimumCostCoverage(chosen,pick.unit,'main',dynamicTarget,forced,singleCount===1?forcedCoveragePickMap(chosen,'normal',null,forced):null);
  const capped=enforceCouponCostCap(built.legs,pick.unit,dynamicTarget);built={...built,...capped,cost:capped.cost,combos:capped.combos};
  return {typeKey,label:singleCount>=2?'🛡️ Normal · 2 TEK':'💪 Normal · 1 TEK',legs:built.legs,unit:pick.unit,cost:built.cost,legCount:pick.L,budgetTL:dynamicTarget,maxBudgetTL:userCap,userCapTL:userCap,inputCapTL:userCap,leftover:round2ish(dynamicTarget-built.cost),reliableSingles:(built.legs||[]).filter(l=>(l.picks||[]).length===1).length,dynamicBudget:true,algorithmVersion:globalThis.TKP_V55_ALGORITHM_VERSION||'V55.2',fallbackCoverage:true,note:'Dengeli kapsama verisi eksik kart için güvenli fallback.'};
}

function buildSolidCoupon(raceResults,budgetTL,preparedRanked=null){
  return buildNormalCouponVariant(raceResults,budgetTL,1,preparedRanked);
}
function buildNormalTwoSingleCoupon(raceResults,budgetTL,preparedRanked=null){
  return buildNormalCouponVariant(raceResults,budgetTL,2,preparedRanked);
}
function buildDynamicNormalCoupon(raceResults,budgetTL,preparedRanked=null,options={}){
  if(options?.normalMode==='coverage'){
    const wide=tkpV552BalancedNormalCoupon(raceResults,budgetTL,0,preparedRanked,options);
    if(wide&&!wide.error){wide.typeKey='main';wide.dynamicSingleCount=false;wide.singleDecisionReason='Kapsama profili · TEK zorlaması kapalı';}
    return wide;
  }
  const one=buildNormalCouponVariant(raceResults,budgetTL,1,preparedRanked,options);
  // İkinci kart kaldırılmış olsa da iki TEK seçeneği Normal'in bir adayıdır.
  // Kritik yol da aynı seçimi yapar; mevcut süre kontrolü aramayı sınırlar.
  if(typeof tkpCouponCheck==='function')tkpCouponCheck('İkinci TEK seçeneği');
  const two=buildNormalCouponVariant(raceResults,budgetTL,2,preparedRanked,options);
  // İkinci TEK yalnız iki canonical isSingle kararı gerçekten varsa ve maliyeti
  // anlamlı biçimde azaltıyorsa kullanılır. "Maliyet TEK'i" ikinci TEK olamaz.
  const trueSingles=(two?.legs||[]).filter(l=>(l?.picks||[]).length===1&&l?.confidencePlan?.reliable===true&&!l.picks[0].__tkpNormalFallbackSingle&&!l.picks[0].__tkpStrategyFallbackSingle&&!l?.confidencePlan?.strategySingleFallback&&!/Maliyet TEK/i.test(String(l?.confidencePlan?.reason||''))).length;
  const savesEnough=!two?.error&&!one?.error&&Number(one.cost)>0&&Number(two.cost)<=Number(one.cost)*.82;
  const minimumWidth=c=>Math.min(...(c?.legs||[]).filter(l=>(l.picks||[]).length>1).map(l=>l.picks.length));
  const widensCoverage=!two?.error&&!one?.error&&minimumWidth(two)>minimumWidth(one);
  let chosen=trueSingles>=2&&(one?.error||savesEnough||widensCoverage)?two:one;
  if(chosen?.error){
    // İlk aday kanıt kapısından geçemezse önce güvenli fallback TEK'i dene.
    // Önceki akış doğrudan 0-TEK kapsama biletine düşüyor ve kullanıcıya
    // "Normal Kupon · 0 TEK" gösteriyordu. forcedSinglePickMap zaten kilo,
    // koşmayan at ve Benter veto durumunu işaretlediği için bu tekrar çağrı
    // yeni bir at uydurmaz; mevcut sıralı adaylardan birini açıkça fallback
    // etiketiyle korur. Ancak hiç geçerli aday yoksa kapsama son çaredir.
    const oneFallback=tkpV552BalancedNormalCoupon(raceResults,budgetTL,1,preparedRanked,{...options,normalMode:'standard'});
    chosen=oneFallback&&!oneFallback.error?oneFallback:tkpV552BalancedNormalCoupon(raceResults,budgetTL,0,preparedRanked,{...options,normalMode:'coverage'});
    if(chosen&&!chosen.error){
      chosen.typeKey='main';chosen.label='💪 Normal Kupon';
      chosen.dynamicSingleCount=chosen===oneFallback;
      chosen.singleDecisionReason=chosen===oneFallback
        ? 'Kanıt eşiği altında güvenli aday TEK · düşük güven etiketiyle korundu'
        : 'Geçerli TEK adayı yok · güvenli kapsama';
    }
  }
  if(chosen&&!chosen.error){
    chosen.typeKey='main';chosen.label='💪 Normal Kupon';
    if(chosen.dynamicSingleCount!==false)chosen.dynamicSingleCount=true;
    if(!chosen.singleDecisionReason)chosen.singleDecisionReason=chosen===two?'2 kanıtlı TEK · çoklu ayak kapsamı veya maliyet avantajı':'1 TEK · diğer ayaklarda kapsama';
    tkpAttachAgfSinglePolicyMeta(chosen,'normal');
  }
  return chosen;
}

function buildAltCoupon(raceResults,budgetTL,preparedRanked=null){
  return {typeKey:'alt',label:'Geniş Kupon kaldırıldı',disabled:true,legs:[],unit:0,cost:0,legCount:0,budgetTL:0,leftover:0,reliableSingles:0};
}


function buildSurpriseCoupon(raceResults,budgetTL,preparedRanked=null){
  let ranked=preparedRanked||strictRankedRaceResults(raceResults);
  if(ranked.length<3)return {error:'Sürpriz Altılı için yeterli ayak bulunamadı.'};
  const userCap=tkpCouponBudgetFor(budgetTL,'surprise');
  const dynamicTarget=typeof tkpV55BudgetTarget==='function'?tkpV55BudgetTarget(raceResults,userCap,'alt',1):Math.min(userCap,1000);
  let pick=chooseLegCountAndUnit(ranked,Math.max(dynamicTarget,2));
  if(!pick)pick={L:Math.min(6,ranked.length),unit:ganyanUnitPrice(ranked[0].r.hippodrome,Math.min(6,ranked.length))||2};
  const chosen=ranked.slice(0,pick.L);
  const forced=forcedSinglePickMap(chosen,'alt',null);
  // TEK sayısı zorlanmaz. Yalnız gerçek yarış-öncesi karar 1 veya 2 TEK
  // üretirse kullanılır; salt maliyet düşürmek için sahte TEK eklenmez.
  let built=minimumCostCoverage(chosen,pick.unit,'alt',dynamicTarget,forced,null);
  // Gerçek Sürpriz sırası: ilk çekirdeği korur, kuyrukta BMB/ODB/Y.PUAN/AGF ayrışmasını öne alır.
  for(const leg of built.legs||[]){
    if((leg.picks||[]).length<=1)continue;
    try{
      const base=(leg.displayOrder?.length?leg.displayOrder:(leg.ordered||leg.allHorses||[]));
      const probabilityOrder=typeof tkpProbabilityPortfolioOrderForRace==='function'
        ? tkpProbabilityPortfolioOrderForRace(leg.r,base,'alt')
        : (typeof tkpPortfolioOrderForRace==='function'?tkpPortfolioOrderForRace(leg.r,base,'alt'):base);
      const ordered=typeof tkpSurpriseContrarianOrder==='function'
        ?tkpSurpriseContrarianOrder(leg.r,probabilityOrder)
        :probabilityOrder;
      const desired=leg.picks.length;
      // Sürpriz kuponun tanımlı omurgası Genel Bakış TKP 3–5'tir. Kontraryen
      // sıralama yalnız kalan yerleri doldurur; bu üç atı geri çıkaramaz.
      const surpriseCore=(leg.displayOrder||base).slice(2,5).filter(h=>h&&!isNonRunner(h));
      const next=[]; const used=new Set();
      for(const h of surpriseCore){const no=String(h?.horse_no);if(!no||used.has(no)||next.length>=desired)continue;next.push(h);used.add(no);}
      for(const h of ordered){
        if(!h||isNonRunner(h)||next.length>=desired)continue;
        const no=String(h?.horse_no);if(!no||used.has(no))continue;
        next.push(h);used.add(no);
      }
      // Aynı atı tekrar ekleme; kontraryen sıra çekirdekle kesişebilir.
      const deduped=[];const seen=new Set();for(const h of next){const no=String(h?.horse_no);if(!no||seen.has(no))continue;deduped.push(h);seen.add(no);if(deduped.length>=desired)break;}
      if(deduped.length===desired)leg.picks=deduped;
    }catch(_){ }
  }
  const capped=enforceCouponCostCap(built.legs,pick.unit,dynamicTarget);built={...built,...capped,cost:capped.cost,combos:capped.combos};
  const coupon={typeKey:'alt',label:'💣 Sürpriz Altılı',legs:built.legs,unit:pick.unit,cost:built.cost,legCount:pick.L,budgetTL:dynamicTarget,maxBudgetTL:userCap,userCapTL:userCap,inputCapTL:userCap,leftover:round2ish(dynamicTarget-built.cost),reliableSingles:(built.legs||[]).filter(l=>(l.picks||[]).length===1).length,dynamicBudget:true,algorithmVersion:globalThis.TKP_V55_ALGORITHM_VERSION||'V55.2',trueSurprise:true,note:'Normal ve Uzman/Kulis motorundan bağımsız sürpriz portföyü: BMB/ODB, AGF kuyruk, Y.PUAN/VALUE ayrışması; TEK varsa yalnız AGF 3–5 + koşul/puan kanıtı ile.'};
  return tkpAttachAgfSinglePolicyMeta(coupon,'surprise');
}

function buildBombaCoupon(raceResults,budgetTL,preparedRanked=null){
  let ranked=preparedRanked||strictRankedRaceResults(raceResults);
  if(ranked.length<3)return {error:'Kesin aday şartlarını karşılayan en az 3 ayak bulunamadı.'};
  const userCap=tkpCouponBudgetFor(budgetTL,'expert');
  const dynamicTarget=typeof tkpV55BudgetTarget==='function'
    ? tkpV55BudgetTarget(raceResults,userCap,'surprise',1)
    : Math.min(userCap,1100);
  let pick=chooseLegCountAndUnit(ranked,Math.max(dynamicTarget,2));
  if(!pick)pick={L:Math.min(6,ranked.length),unit:ganyanUnitPrice(ranked[0].r.hippodrome,Math.min(6,ranked.length))||2};
  const chosen=ranked.slice(0,pick.L);
  const forcedExpert=forcedSinglePickMap(chosen,'expert',null);
  let built=minimumCostCoverage(chosen,pick.unit,'surprise',dynamicTarget,forcedExpert,null);
  // V55.3: Uzman/Kulis yalnız TEK seçimini değil, TEK olmayan ayakların gerçek
  // seçim sırasını da değiştirir. Sonuç alanları bu sıraya girmez. Champion çekirdeği
  // tkpV55ExpertOrderForRace içinde korunur; yorumcu/Y.PUAN ve X/Kulis kanıtı varsa
  // kalan adayların önceliği hibrit puanla yeniden sıralanır. Böylece Uzman kuponu
  // Normal/Sürpriz'in kozmetik kopyası olmaz.
  for(const leg of built.legs||[]){
    if((leg.picks||[]).length<=1)continue;
    try{
      const base=(leg.displayOrder?.length?leg.displayOrder:(leg.ordered||leg.allHorses||[]));
      const ordered=typeof tkpV55ExpertOrderForRace==='function'
        ?tkpV55ExpertOrderForRace(leg.r,base)
        :(typeof tkpProbabilityPortfolioOrderForRace==='function'
          ?tkpProbabilityPortfolioOrderForRace(leg.r,base,'surprise')
          :base);
      const desired=leg.picks.length;
      const next=[];
      for(const h of ordered){if(!h||isNonRunner(h))continue;if(next.length>=desired)break;next.push(h);}
      if(next.length===desired){leg.picks=next;leg.displayOrder=ordered;leg.ordered=ordered;leg.v55ExpertOrdered=true;}
    }catch(_){ }
  }
  const capped=enforceCouponCostCap(built.legs,pick.unit,dynamicTarget);
  built={...built,...capped,cost:capped.cost,combos:capped.combos,budgetLimited:capped.capLimited};
  tkpApplyBmbRescueSwap(built);
  const actualSingles=(built.legs||[]).filter(l=>(l.picks||[]).length===1).length;
  return {
    typeKey:'surprise',label:'🧠 Uzman + Kulis — Hibrit Altılı',scenarioRole:'expert-consensus',legs:built.legs,unit:pick.unit,cost:built.cost,legCount:pick.L,
    budgetTL:dynamicTarget,maxBudgetTL:userCap,userCapTL:userCap,inputCapTL:userCap,
    leftover:round2ish(dynamicTarget-built.cost),reliableSingles:actualSingles,
    dynamicBudget:true,algorithmVersion:globalThis.TKP_V55_ALGORITHM_VERSION||'V55',
    note:'Champion + yüklenen yorumcular/Y.PUAN + X/Twitter kulis + profil + BMB/ODB/TR birleşimidir. TEK sayısı kanıt gücüne göre 1 veya 2; bütçe tavana zorla doldurulmaz.'
  };
}

// BACK TEST BENZERİ CANLI KUPON HIZ YOLU
// Üç kupon aynı toplantının aynı Tahmin-1 sırasını kullanır. Önceden bu ortak sıra
// Normal/Geniş/Sürpriz için üç kez kuruluyor, aynı geçmiş/at sinyalleri üç kez
// taranıyordu. Artık veri parmak izi bir kez çıkarılır, ortak sıralama bir kez hazırlanır
// ve tamamlanmış kupon seti bütçelerle birlikte küçük bir LRU önbellekte tutulur.
const _tkpLiveCouponSetCache=new Map();
const TKP_LIVE_COUPON_CACHE_LIMIT=4; // V49: büyük toplantı kuponları bellekte şişmesin; canlı tekrarlar için 4 LRU yeterli

// Kupon karar imzası yalnız gerçekten seçimi değiştiren ayarlara dayanır. Snapshot
// kaydı sonrası güncellenen backtest/haftalık izleme metadata'sını imzaya katmak,
// kaydın kendi parmak izini anında bayatlatıp Ctrl+F5 sonrası geri yüklemeyi
// reddediyordu.
function tkpCouponDecisionSettingsFingerprint(){
  const settings=db?.settings&&typeof db.settings==='object'?db.settings:{};
  let decisionSettings=settings;
  try{if(typeof tkpProtectedUserSettings==='function')decisionSettings=tkpProtectedUserSettings(settings);}catch(_e){}
  const clean={...(decisionSettings||{})};
  delete clean.backtest_snapshot_revision;
  delete clean.backtest_snapshot_updated_at;
  delete clean.coupon_policy_learning;
  try{return typeof tkpStableSettingsString==='function'?tkpStableSettingsString(clean):JSON.stringify(clean);}catch(_e){return JSON.stringify(clean);}
}

function tkpLiveCouponFingerprint(raceResults){
  const rows=Array.isArray(raceResults)?raceResults:[];
  let hash=2166136261>>>0;
  const mix=value=>{
    const s=String(value??'');
    for(let i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619)>>>0;}
    hash^=124;hash=Math.imul(hash,16777619)>>>0;
  };
  mix('LIVE_COUPON_V55_CANONICAL_EXPERT_DYNAMIC_BUDGET');
  mix('R16.74_CANONICAL_DIFFICULTY_PLAN');
  mix(globalThis.TKP_COUPON_POLICY?.version||'');
  mix(globalThis.TKP_LEARNED_MODEL?.modelSignature||'');
  mix(typeof globalThis.tkpCommentatorGovernanceRevision==='function'?globalThis.tkpCommentatorGovernanceRevision():0);
  mix(TKP_AGF_SINGLE_PORTFOLIO_POLICY.version);
  mix(globalThis.TKP_V320_PORTFOLIO?.SHARED_GOLD_TEK_POLICY?.version||'NO_SHARED_GOLD_TEK_POLICY');
  mix(db?.learning_state?.dataset_signature||'');
  mix((db?.files||[]).length);mix((db?.races||[]).length);mix((db?.prediction_log||[]).length);mix((db?.changelog||[]).length);
  mix(tkpCouponDecisionSettingsFingerprint());
  mix(_tkpGapThreshold);
  for(const item of rows){
    const r=item?.r||{};
    mix(r.id);mix(r.file_id);mix(r.race_date);mix(r.hippodrome);mix(r.altili_no);mix(r.leg);
    mix(r.distance);mix(r.surface);mix(r.breed);mix(r.condition_family||r.condition_text);
    const horses=(item?.scored&&item.scored.length)?item.scored:(r.horses||[]);
    for(const h of horses){
      mix(h.horse_no);mix(h.horse_name);mix(h.non_runner||h.is_non_runner||h.scratched);
      // finish_position/winner ve mevcut yarış Accurate alanları sonuç katmanıdır;
      // yarış öncesi kupon parmak izini ve seçimlerini değiştiremez.
      mix(h.status);mix(h.running_status);
      // altili_winner_score bu fonksiyonun aşağıdaki hesaplama zincirinin ÇIKTISIDIR.
      // Cache anahtarına katılırsa ilk kupon kendi anahtarını değiştirir ve ikinci
      // tıklama gerçek cache-hit olamaz. Girdi alanları ile model/dataset imzası
      // zaten anahtardadır; üretilmiş P1 puanı bilinçli olarak dışarıda bırakılır.
      mix(h.score);mix(h.prediction_order_snapshot);mix(h.predicted_rank);
      mix(h.agf);mix(h.agf_rank);mix(h.ypuan);mix(h.bmb);mix(h.odb);mix(h.result_rank);mix(h.result_score);mix(h.sonuc_puani);mix(h.sonuc_sirasi);mix(h.ods_result_score);mix(h.ods_result_rank);mix(h.ods_sonuc_puani);mix(h.ods_sonuc_sirasi);mix(h.tr_ganyan);mix(h.tr_puan);mix(h.tr_ganyan_source);mix(h.tr_source);mix(h.tr_rank);mix(h.team_strength_pct);mix(h.prof);
      mix(h.priorAccurateAvgSpeed);mix(h.priorAccurateFinishSignal);mix(h.priorAccurateStarts);mix(h.jbyg);mix(h.jbyg_rate);
      mix(h.g800);mix(h.hndkp);mix(h.hndkp_rank);mix(h.weight_kg);mix(h.best_time);mix(h.start_no);
      mix(h.priorWins);mix(h.priorStarts);mix(h.condWinWins);mix(h.condWinStarts);
      mix('X_SHADOW_ONLY');
    }
  }
  return `${rows.length}:${(hash>>>0).toString(36)}`;
}
function tkpLiveCouponCacheKey(raceResults,budgets={}){
  const main=tkpCouponBudgetFor(budgets.main,'main');
  const surprise=tkpCouponBudgetFor(budgets.surprise,'surprise');
  return [tkpLiveCouponFingerprint(raceResults),main,surprise,TKP_AGF_SINGLE_PORTFOLIO_POLICY.version,globalThis.TKP_V320_PORTFOLIO?.SHARED_GOLD_TEK_POLICY?.version||'NO_SHARED_GOLD_TEK_POLICY','THREE_COUPONS'].join('|');
}

function tkpCloneCouponResult(result){
  if(!result||result.error)return result?{...result}:result;
  return {...result,sharedGoldTek:Array.isArray(result.sharedGoldTek)?result.sharedGoldTek.map(x=>x&&typeof x==='object'?{...x}:x):result.sharedGoldTek,legs:(result.legs||[]).map(leg=>({
    ...leg,
    picks:[...(leg.picks||[])],
    ordered:[...(leg.ordered||[])],
    displayOrder:[...(leg.displayOrder||[])],
    allHorses:[...(leg.allHorses||[])],
    strictPool:[...(leg.strictPool||[])],
    protectedValueNos:leg.protectedValueNos instanceof Set?new Set(leg.protectedValueNos):leg.protectedValueNos,
    protectedBombNos:leg.protectedBombNos instanceof Set?new Set(leg.protectedBombNos):leg.protectedBombNos,
    hybridBombScores:leg.hybridBombScores instanceof Map?new Map(leg.hybridBombScores):leg.hybridBombScores,
    confidencePlan:leg.confidencePlan?{...leg.confidencePlan,picks:[...(leg.confidencePlan.picks||[])],orderedPool:[...(leg.confidencePlan.orderedPool||[])]}:leg.confidencePlan,
    sharedGoldTekPlan:leg.sharedGoldTekPlan?{...leg.sharedGoldTekPlan}:leg.sharedGoldTekPlan,
    portfolioProbability:leg.portfolioProbability?{...leg.portfolioProbability}:leg.portfolioProbability
  }))};
}

function tkpCloneCouponSet(set){
  const cloneGold=value=>{
    if(!value)return value;
    if(Array.isArray(value))return value.map(x=>x&&typeof x==='object'?{...x}:x);
    return {...value,sharedCouponKeys:[...(value.sharedCouponKeys||[])],plan:(value.plan||[]).map(x=>x&&typeof x==='object'?{...x}:x)};
  };
  const sharedGoldTek=cloneGold(set?.sharedGoldTek);
  return {
    main:tkpCloneCouponResult(set?.main),main2:tkpCloneCouponResult(set?.main2),alt:tkpCloneCouponResult(set?.alt),surprise:tkpCloneCouponResult(set?.surprise),
    sharedGoldTek,
    portfolio320:set?.portfolio320?{...set.portfolio320,sharedGoldTek:cloneGold(set.portfolio320.sharedGoldTek)}:set?.portfolio320
  };
}

function tkpCouponLegKey(leg,index=0){
  const r=leg?.r||leg?.x?.r||{};
  return String(r.id||r.race_uid||`${r.file_id||''}|${r.leg||index+1}`);
}
function tkpCouponPickSet(leg){
  return new Set((leg?.picks||[]).map(h=>String(h?.horse_no??h)).filter(Boolean));
}
function tkpSamePickSet(a,b){
  const aa=tkpCouponPickSet(a),bb=tkpCouponPickSet(b);
  return aa.size===bb.size&&[...aa].every(no=>bb.has(no));
}
function tkpCouponDifferentLegCount(a,b){
  if(!a||!b||a.error||b.error)return 0;
  const ref=new Map((b.legs||[]).map((leg,i)=>[tkpCouponLegKey(leg,i),leg]));
  return (a.legs||[]).reduce((n,leg,i)=>n+(ref.has(tkpCouponLegKey(leg,i))&&!tkpSamePickSet(leg,ref.get(tkpCouponLegKey(leg,i)))?1:0),0);
}
function tkpRoleSingleOrder(leg,role){
  const r=leg?.r||leg?.x?.r||{};
  const base=(leg?.displayOrder?.length?leg.displayOrder:(leg?.ordered?.length?leg.ordered:leg?.allHorses||r.horses||[])).filter(h=>h&&!isNonRunner(h));
  if(role==='alt'){
    const probability=typeof tkpProbabilityPortfolioOrderForRace==='function'
      ?tkpProbabilityPortfolioOrderForRace(r,base,'alt'):base;
    return typeof tkpSurpriseContrarianOrder==='function'?tkpSurpriseContrarianOrder(r,probability):probability;
  }
  if(role==='expert'&&typeof tkpV55ExpertOrderForRace==='function')return tkpV55ExpertOrderForRace(r,base);
  return base;
}
function tkpRoleSingleCandidate(leg,role,excluded=new Set()){
  const r=leg?.r||leg?.x?.r||{},pool=(leg?.allHorses?.length?leg.allHorses:(r.horses||[])).filter(h=>h&&!isNonRunner(h));
  const order=tkpRoleSingleOrder({...leg,allHorses:pool},role),x=leg?.x||{r,scored:pool};
  for(const h of order){
    const no=String(h?.horse_no??'');if(!no||excluded.has(no)||!canBeCouponSingle(h))continue;
    if(tkpBenterSingleEvidence(x,h,role==='alt'?'alt':(role==='expert'?'surprise':'main')).blocked)continue;
    const second=pool.filter(z=>String(z?.horse_no)!==no).sort((a,b)=>(Number(b?.altili_winner_score)||0)-(Number(a?.altili_winner_score)||0)||(Number(b?.score)||0)-(Number(a?.score)||0))[0]||null;
    let decision=null;try{decision=dynamicSingleDecision(x,h,second);}catch(_){ }
    if(role==='expert'){
      let ev=null;try{ev=typeof tkpV55ExpertEvidence==='function'?tkpV55ExpertEvidence(r,h,order):null;}catch(_){ }
      const governed=!!(ev&&(ev.readyCouponSingleEligible===true||(ev.commentatorSingleEligible===true&&ev.expertPower>=50)));
      if(ev&&ev.score>=54&&governed)return {h,governed:true,score:ev.score};
      continue;
    }
    const rank=tkpAgfRankForSinglePolicy(h,pool);
    const rankOk=role==='alt'?tkpAgfSinglePolicyAllowsRank('surprise',rank):true;
    if(rankOk&&decision?.isSingle===true&&decision?.scoreOk!==false&&decision?.weightOk!==false)return {h,governed:false,score:Number(decision.confidence)||0};
  }
  return null;
}
function tkpEnsureCouponShape(coupon,role){
  if(!coupon||coupon.error||coupon.disabled||!Array.isArray(coupon.legs))return coupon;
  const singles=()=>coupon.legs.filter(l=>(l?.picks||[]).length===1);
  // Şekil düzeltmesi en geniş (çoğunlukla en zor) ayağı körlemesine daraltmaz.
  // Aynı çağrı boyunca zorluk bir kez hesaplanır; sıralama karşılaştırıcısı tekrar taramaz.
  const difficulty=new Map();
  const difficultyOf=leg=>{
    if(!difficulty.has(leg)){
      let value=50;try{value=raceDifficultyIndex(leg.x||{r:leg.r,scored:leg.allHorses||leg.r?.horses||[]});}catch(_){ }
      difficulty.set(leg,Number.isFinite(value)?value:50);
    }
    return difficulty.get(leg);
  };
  let current=singles();
  // Son bütçe/portföy adımları üçüncü bir TEK üretirse onu aynı ayağın rol
  // sırasındaki ikinci atıyla genişlet. İlk iki stratejik TEK olduğu gibi kalır.
  if(current.length>2){
    for(const leg of current.slice(2)){
      const first=leg?.picks?.[0];
      const used=new Set([String(first?.horse_no??'')]);
      const pool=tkpRoleSingleOrder(leg,role);
      const second=pool.find(h=>h&&!isNonRunner(h)&&!used.has(String(h?.horse_no??'')))||null;
      if(!second)continue;
      leg.picks=dedupeEkuri([first,second],leg.r,role==='normal'?'main':'surprise');
      leg.protectedFlag=false;leg.minCoverage=2;leg.maxCoverage=Math.max(2,Number(leg.maxCoverage)||2);
      leg.confidencePlan={...(leg.confidencePlan||{}),strategySingle:false,reason:'TEK üst sınırı · ayak 2 atlı genişletildi'};
    }
    current=singles();
  }
  if(!current.length){
    const ranked=coupon.legs.map((leg,index)=>({leg,index,count:(leg?.picks||[]).length,difficulty:difficultyOf(leg)})).filter(z=>z.count>1).sort((a,b)=>a.difficulty-b.difficulty||a.index-b.index);
    for(const row of ranked){
      const candidate=tkpRoleSingleCandidate(row.leg,role,new Set());
      const fallback=!candidate?(row.leg.picks||[]).find(h=>canBeCouponSingle(h)&&!tkpLegacyXKulisBreaksSingle(h)):null;
      const chosen=candidate?.h||fallback;if(!chosen)continue;
      row.leg.picks=[chosen];row.leg.protectedFlag=true;row.leg.minCoverage=1;row.leg.maxCoverage=1;
      row.leg.confidencePlan={...(row.leg.confidencePlan||{}),strategySingle:true,strategySingleFallback:!candidate,reason:candidate?.governed?'Onaylı Uzman/Kulis TEK':(candidate?'Rol bazlı TEK':'Güvenli TEK fallback')};
      break;
    }
    current=singles();
  }
  // Kolon sayısını sığdırmak için tercih edilen şekil: en az bir TEK ve bir
  // 2–3 atlı ayak; bu yoksa ikinci güvenilir TEK aranır.
  let narrow=coupon.legs.find(l=>(l?.picks||[]).length>=2&&(l.picks||[]).length<=3);
  if(!narrow&&current.length===1){
    const excluded=new Set(current.map(l=>String(l.picks?.[0]?.horse_no??'')));
    const ranked=coupon.legs.map((leg,index)=>({leg,index,count:(leg?.picks||[]).length,difficulty:difficultyOf(leg)})).filter(z=>z.count>1).sort((a,b)=>a.difficulty-b.difficulty||a.index-b.index);
    for(const row of ranked){
      const candidate=tkpRoleSingleCandidate(row.leg,role,excluded);if(!candidate)continue;
      row.leg.picks=[candidate.h];row.leg.protectedFlag=true;row.leg.minCoverage=1;row.leg.maxCoverage=1;
      row.leg.confidencePlan={...(row.leg.confidencePlan||{}),strategySingle:true,strategySingleFallback:false,reason:candidate.governed?'İkinci onaylı Uzman/Kulis TEK':'İkinci rol bazlı TEK'};
      break;
    }
    current=singles();narrow=coupon.legs.find(l=>(l?.picks||[]).length>=2&&(l.picks||[]).length<=3);
  }
  if(!narrow){
    const wide=coupon.legs.filter(l=>(l?.picks||[]).length>3).sort((a,b)=>difficultyOf(a)-difficultyOf(b)||a.picks.length-b.picks.length)[0];
    if(wide){
      const orderedWide=(wide.ordered&&wide.ordered.length?wide.ordered:wide.picks).slice();
      const core=orderedWide.filter(h=>(wide.picks||[]).some(p=>String(p?.horse_no)===String(h?.horse_no))).slice(0,3);
      const highYpuan=(wide.picks||[]).filter(h=>Number(h?.ypuan||0)>8).sort((a,b)=>(Number(b?.ypuan)||0)-(Number(a?.ypuan)||0));
      for(const h of highYpuan){
        if(core.some(x=>String(x?.horse_no)===String(h?.horse_no)))continue;
        const replace=core.slice().reverse().find(x=>Number(x?.ypuan||0)<=8);
        if(replace){core[core.indexOf(replace)]=h;}
      }
      wide.picks=core.slice(0,3);wide.shapeTrimmedTo3=true;
    }
  }
  if(typeof recalcCouponCost==='function')recalcCouponCost(coupon);
  coupon.structurePolicy={minSingles:1,maxSingles:2,preferredNarrowLeg:'2-3',fallback:'2 singles',role,actualSingles:singles().length,actualNarrowLegs:coupon.legs.filter(l=>(l?.picks||[]).length>=2&&(l.picks||[]).length<=3).length,preRaceOnly:true};
  coupon.reliableSingles=singles().length;
  return coupon;
}
function tkpDiversifyCoupon(target,references,mode,minDifferentLegs){
  if(!target||target.error)return target;
  const refs=(references||[]).filter(x=>x&&!x.error);
  if(!refs.length)return target;
  const changes=[];
  const refMaps=refs.map(ref=>new Map((ref.legs||[]).map((leg,i)=>[tkpCouponLegKey(leg,i),leg])));
  const differsEnough=()=>refs.every(ref=>tkpCouponDifferentLegCount(target,ref)>=minDifferentLegs);

  // Önce güvenli kuyruktan değiştir: TEK'e, ilk iki P1 çekirdeğine, X zorunlusuna ve
  // korunan para/değer sinyaline dokunma. At sayısı aynı kaldığı için kolon ve maliyet
  // kesinlikle değişmez.
  for(const coreFloor of (mode==='surprise'?[2,1]:[3,2,1])){
    if(differsEnough())break;
    for(let i=0;i<(target.legs||[]).length;i++){
      if(differsEnough())break;
      const leg=target.legs[i],picks=leg?.picks||[];
      if(picks.length<=1||leg?.protectedFlag)continue;
      const key=tkpCouponLegKey(leg,i);
      const sameRefs=refMaps.map(m=>m.get(key)).filter(Boolean).filter(refLeg=>tkpSamePickSet(leg,refLeg));
      if(!sameRefs.length)continue;
      const selected=new Set(picks.map(h=>String(h.horse_no)));
      const selectedBase=new Set(picks.map(h=>typeof ekuriBase==='function'?ekuriBase(h.horse_no):String(h.horse_no)));
      const refNos=new Set(sameRefs.flatMap(refLeg=>(refLeg.picks||[]).map(h=>String(h?.horse_no??h))));
      const displayRank=new Map((leg.displayOrder||[]).map((h,j)=>[String(h.horse_no),j]));
      const removable=picks.slice().reverse().find(h=>{
        const no=String(h.horse_no),rank=displayRank.get(no)??999;
        return rank>=coreFloor&&!tkpLegacyXKulisForce(h)&&!(leg.protectedValueNos instanceof Set&&leg.protectedValueNos.has(no))&&
          !(leg.protectedSignalNos instanceof Set&&leg.protectedSignalNos.has(no))&&
          !(leg.protectedBombNos instanceof Set&&leg.protectedBombNos.has(no))&&
          // Y.PUAN'ı diğerlerinden belirgin yüksek olan at bütçe/çeşitlilik
          // daraltmasında otomatik çıkarılmayacak.
          Number(h?.ypuan||0)<=8;
      });
      if(!removable)continue;
      const pool=(leg.ordered&&leg.ordered.length?leg.ordered:leg.allHorses||[]).filter(h=>h&&!isNonRunner(h));
      const available=pool.filter(h=>{
        const no=String(h.horse_no),base=typeof ekuriBase==='function'?ekuriBase(h.horse_no):no;
        return !selected.has(no)&&!selectedBase.has(base);
      });
      const replacement=available.find(h=>!refNos.has(String(h.horse_no)))||available[0];
      if(!replacement)continue;
      leg.picks=picks.map(h=>h===removable?replacement:h);
      const orderRank=new Map(pool.map((h,j)=>[String(h.horse_no),j]));
      leg.picks.sort((a,b)=>(orderRank.get(String(a.horse_no))??999)-(orderRank.get(String(b.horse_no))??999));
      changes.push({leg:Number(leg.r?.leg)||i+1,out:String(removable.horse_no),in:String(replacement.horse_no)});
    }
  }
  const actual=refs.map(ref=>tkpCouponDifferentLegCount(target,ref));
  target.diversity={mode,requiredDifferentLegs:minDifferentLegs,actualDifferentLegs:actual,changes,
    guaranteed:actual.every(n=>n>=minDifferentLegs),costPreserved:true};
  return target;
}
function tkpDiversifyCouponSet(built){
  if(!built)return built;
  built.alt=tkpDiversifyCoupon(built.alt,[built.main],'alt',1);
  built.surprise=tkpDiversifyCoupon(built.surprise,[built.main,built.alt],'surprise',2);
  return built;
}

function tkpPreserveMainSubsetWhenLarger(main,target){
  if(!main?.legs||!target?.legs)return target;
  const mainByLeg=new Map(main.legs.map((l,i)=>[tkpLegNoFromCouponLeg(l,i),l]));
  for(let i=0;i<target.legs.length;i++){
    const t=target.legs[i],m=mainByLeg.get(tkpLegNoFromCouponLeg(t,i));
    if(!m)continue;
    const mPicks=(m.picks||[]).filter(Boolean), tPicks=(t.picks||[]).filter(Boolean);
    // Kupon gerçekten daha geniş/eşitse Normal kuponun bütün atları alt küme olarak korunur.
    // Daha dar alternatif senaryoya zorla at eklenmez.
    if(!mPicks.length || tPicks.length<mPicks.length)continue;
    const targetCount=tPicks.length;
    const merged=[]; const seen=new Set();
    const push=h=>{const no=String(h?.horse_no??'');if(!no||seen.has(no))return;seen.add(no);merged.push(h);};
    mPicks.forEach(push); tPicks.forEach(push);
    const order=(t.ordered&&t.ordered.length?t.ordered:t.allHorses||[]);
    const rank=new Map(order.map((h,j)=>[String(h?.horse_no??''),j]));
    const coreNos=new Set(mPicks.map(h=>String(h?.horse_no??'')));
    const core=merged.filter(h=>coreNos.has(String(h?.horse_no??'')));
    const extras=merged.filter(h=>!coreNos.has(String(h?.horse_no??''))).sort((a,b)=>(rank.get(String(a?.horse_no))??999)-(rank.get(String(b?.horse_no))??999));
    t.picks=[...core,...extras].slice(0,targetCount);
    t.picks.sort((a,b)=>(rank.get(String(a?.horse_no))??999)-(rank.get(String(b?.horse_no))??999));
  }
  return target;
}


function tkpLegNoFromCouponLeg(leg,index){return Number(leg?.x?.r?.leg??leg?.r?.leg??leg?.race?.leg)||index+1;}
function tkpReconcileWideProtected(main,alt){
  if(!main?.legs||!alt?.legs)return alt;
  const mainByLeg=new Map(main.legs.map((l,i)=>[tkpLegNoFromCouponLeg(l,i),l]));
  for(let i=0;i<alt.legs.length;i++){
    const a=alt.legs[i],m=mainByLeg.get(tkpLegNoFromCouponLeg(a,i));if(!m)continue;
    const protectedNos=new Set([...(m.protectedSignalNos||[]),...(m.protectedValueNos||[]),...(m.protectedBombNos||[])] .map(String));
    const required=(m.picks||[]).filter(h=>protectedNos.has(String(h?.horse_no)));
    if(!required.length)continue;
    const have=new Set((a.picks||[]).map(h=>String(h?.horse_no)));
    for(const h of required){
      const no=String(h?.horse_no);if(have.has(no))continue;
      const picks=[...(a.picks||[])];
      const idx=[...picks].map((x,j)=>({x,j})).reverse().find(z=>{
        const n=String(z.x?.horse_no);return !protectedNos.has(n)&&!(a.protectedSignalNos instanceof Set&&a.protectedSignalNos.has(n))&&!(a.protectedValueNos instanceof Set&&a.protectedValueNos.has(n));
      })?.j;
      if(Number.isInteger(idx)){have.delete(String(picks[idx]?.horse_no));picks[idx]=h;have.add(no);a.picks=picks;}
      else if(!picks.length){a.picks=[h];have.add(no);}
    }
  }
  return alt;
}
function tkpSurpriseRivalScore(r,h){
  let s=0,agf=Number(h?.agf_rank)||99,tr=tkpCouponGcTrValue(h);if(agf===6)s+=4;
  if(Number(h?.bmb)===1)s+=4;try{if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,r))s+=3;}catch(_){ }
  try{const p=typeof trGanyanProfileForHorse==='function'?trGanyanProfileForHorse(r,h):null;if(p?.isBmb)s+=3;if(p?.hardCoupon)s+=4;}catch(_){ }
  if(Number.isFinite(tr)){if(tr>=60&&tr<=70)s+=3;else if(tr>=30&&tr<60)s+=2;else if(tr>=20&&tr<30)s+=1;}
  s+=(Number(h?.score)||0)*.35;return s;
}

function tkpEnsureStrongPortfolioCoverage(built){
  if(!built?.main?.legs)return built;
  const sets=[built.main,built.alt,built.surprise].filter(x=>x&&!x.error&&Array.isArray(x.legs));
  const maps=sets.map(set=>new Map(set.legs.map((leg,i)=>[tkpLegNoFromCouponLeg(leg,i),leg])));
  for(let i=0;i<built.main.legs.length;i++){
    const mainLeg=built.main.legs[i],legNo=tkpLegNoFromCouponLeg(mainLeg,i);
    const order=(mainLeg.displayOrder?.length?mainLeg.displayOrder:(mainLeg.ordered?.length?mainLeg.ordered:mainLeg.allHorses||[])).filter(Boolean);
    if(!order.length)continue;
    const top5=order.slice(0,5);
    const strong=top5.filter(h=>{
      const no=String(h?.horse_no??'');
      const agf=Number(h?.agf_rank)||99;
      const signalled=Number(h?.bmb)===1||tkpLegacyXKulisForce(h)||
        (mainLeg.protectedSignalNos instanceof Set&&mainLeg.protectedSignalNos.has(no))||
        (mainLeg.protectedValueNos instanceof Set&&mainLeg.protectedValueNos.has(no))||
        (mainLeg.protectedBombNos instanceof Set&&mainLeg.protectedBombNos.has(no));
      return agf<=5||signalled;
    });
    // V1.1.318 P6 RESCUE: 509 frozen snapshot denetiminde Normal dışında kalan
    // P6 kazananların piyasa sırası 5-7 bandında kümelendi. P6'yı kör biçimde
    // genişletmek yerine yalnız AGF ilk-7 veya doğrulanmış BMB/ODB sinyali taşıyan
    // TEK bir P6 adayı alternatif portföy kolunda takasla korunur. At sayısı ve
    // kombinasyon maliyeti değişmez; Normal kupon sırası ve TEK'ler dokunulmaz.
    const p6=order[5]||null;
    const p6No=String(p6?.horse_no??'');
    const p6Agf=Number(p6?.agf_rank)||99;
    const p6Signalled=!!(p6&&(p6Agf<=7||Number(p6?.bmb)===1||Number(p6?.odb)===1||
      (mainLeg.protectedSignalNos instanceof Set&&mainLeg.protectedSignalNos.has(p6No))||
      (mainLeg.protectedValueNos instanceof Set&&mainLeg.protectedValueNos.has(p6No))));
    if(p6Signalled&&!strong.some(h=>String(h?.horse_no??'')===p6No)) strong.push(p6);
    if(!strong.length)continue;
    const strongNos=new Set(strong.map(h=>String(h?.horse_no??'')).filter(Boolean));
    const legs=maps.map(m=>m.get(legNo)).filter(Boolean);
    const union=new Set(legs.flatMap(l=>(l.picks||[]).map(h=>String(h?.horse_no??h))));
    for(const horse of strong){
      const no=String(horse?.horse_no??'');
      if(!no||union.has(no))continue;
      // TEK'i ASLA bozma. En geniş çoklu kupon ayağında yalnız bir zayıf/kuyruk adayla takas yap.
      // Normal kupon kendi tahmin/olasılık sırasının çıktısıdır. Portföy kapsaması
      // eksik bir adayı yalnız alternatif kollara yerleştirebilir; Normal'in seçimini
      // Sürpriz veya Uzman/Kulis kuyruğuyla değiştiremez.
      const candidates=legs.filter(l=>l!==mainLeg&&(l.picks||[]).length>1&&!l.protectedFlag).sort((a,b)=>(b.picks||[]).length-(a.picks||[]).length);
      let placed=false;
      for(const leg of candidates){
        const picks=[...(leg.picks||[])];
        const rank=new Map((leg.displayOrder||leg.ordered||leg.allHorses||[]).map((h,j)=>[String(h?.horse_no??''),j]));
        const protectedNos=new Set([
          ...(leg.protectedSignalNos instanceof Set?[...leg.protectedSignalNos]:[]),
          ...(leg.protectedValueNos instanceof Set?[...leg.protectedValueNos]:[]),
          ...(leg.protectedBombNos instanceof Set?[...leg.protectedBombNos]:[])
        ].map(String));
        let replace=-1;
        for(let j=picks.length-1;j>=0;j--){
          const pn=String(picks[j]?.horse_no??'');
          if(protectedNos.has(pn)||strongNos.has(pn)||tkpLegacyXKulisForce(picks[j]))continue;
          if((rank.get(pn)??999)<=1)continue;
          replace=j;break;
        }
        if(replace<0)continue;
        union.delete(String(picks[replace]?.horse_no??''));
        picks[replace]=horse;
        union.add(no);
        picks.sort((a,b)=>(rank.get(String(a?.horse_no))??999)-(rank.get(String(b?.horse_no))??999));
        leg.picks=picks; placed=true; break;
      }
      // Bütün kuponlar TEK ise veya güvenli takas yoksa bilinçli olarak dokunma.
      if(!placed)continue;
    }
  }
  return built;
}


// V55.6 FINAL — KUPONLAR ARASI KONSENSÜS SENKRONİZASYONU
// Zor/çok atlı ayaklarda üç karar kolu birbirinden tamamen kopuk kalmamalı.
// Aynı at aynı ayakta en az iki bağımsız kupon kolunda seçildiyse "konsensüs çekirdeği"
// sayılır. Geniş (>=3 at) üçüncü kupon bu adayı sessizce kaybetmez; yalnız aynı kolon
// sayısını koruyan güvenli bir kuyruk takası yapılır. TEK'lere dokunulmaz ve bütün kuponlar
// birebir kopyalanmaz: ayak başına en fazla 1 konsensüs takası yapılır.
function tkpSynchronizeWideCouponConsensus(built){
  if(!built)return built;
  const entries=['main','alt','surprise']
    .map(key=>({key,coupon:built[key]}))
    .filter(z=>z.coupon&&!z.coupon.error&&!z.coupon.disabled&&Array.isArray(z.coupon.legs));
  if(entries.length<3)return built;
  const legMaps=new Map(entries.map(z=>[z.key,new Map(z.coupon.legs.map((leg,i)=>[tkpLegNoFromCouponLeg(leg,i),leg]))]));
  const allLegNos=[...new Set(entries.flatMap(z=>z.coupon.legs.map((leg,i)=>tkpLegNoFromCouponLeg(leg,i))))];
  for(const legNo of allLegNos){
    const legs=entries.map(z=>({key:z.key,leg:legMaps.get(z.key).get(legNo)})).filter(z=>z.leg);
    if(legs.length<3)continue;
    const counts=new Map();
    for(const z of legs){
      const seen=new Set();
      const sourceOrder=(z.leg.displayOrder?.length?z.leg.displayOrder:(z.leg.ordered?.length?z.leg.ordered:z.leg.allHorses||[])).filter(Boolean);
      const sourceRank=new Map(sourceOrder.map((h,i)=>[String(h?.horse_no??h),i+1]));
      for(const h of (z.leg.picks||[])){
        const no=String(h?.horse_no??h);if(!no||seen.has(no))continue;seen.add(no);
        const row=counts.get(no)||{n:0,bestRank:999};row.n++;row.bestRank=Math.min(row.bestRank,sourceRank.get(no)||999);counts.set(no,row);
      }
    }
    const consensus=[...counts.entries()].filter(([,row])=>row.n>=2).map(([no,row])=>({no,n:row.n,bestRank:row.bestRank}));
    if(!consensus.length)continue;
    for(const z of legs){
      const leg=z.leg,picks=[...(leg.picks||[])];
      // Konsensüs yalnız alternatif kuponları uzlaştırır. Normal kupon başka iki
      // stratejinin ortak adayından etkilenmez ve kendi motor çıktısını korur.
      if(z.key==='main')continue;
      // TEK ve dar 2-at alternatifleri stratejik fark olarak korunur. Senkronizasyon yalnız
      // gerçekten çok at yazılmış ayakta devreye girer.
      if(picks.length<3||leg.protectedFlag)continue;
      const selected=new Set(picks.map(h=>String(h?.horse_no??h)));
      const order=(leg.displayOrder?.length?leg.displayOrder:(leg.ordered?.length?leg.ordered:leg.allHorses||[])).filter(Boolean);
      const rank=new Map(order.map((h,i)=>[String(h?.horse_no??''),i]));
      const byNo=new Map(order.map(h=>[String(h?.horse_no??''),h]));
      // Konsensüs adayın kendi kupon sıralamasında ilk 5 içinde olması veya güçlü bir
      // yarış-öncesi sinyal taşıması gerekir. Böylece sırf iki alternatif kuponun kuyruk
      // tercihi Normal'i körlemesine değiştirmez.
      const missing=consensus.filter(c=>!selected.has(c.no)).map(c=>{
        const h=byNo.get(c.no);if(!h)return null;
        const idx=rank.get(c.no)??999;
        // Kullanıcı kilidi: iki kuponun ortak 1-4 adayı, üçüncü kupon zaten
        // 5-6 at yazıyorsa sırf strateji farkı nedeniyle kaybolamaz.
        let strong=idx<5||c.bestRank<=4||(c.n>=2&&picks.length>=5)||Number(h?.bmb)===1||tkpLegacyXKulisForce(h);
        try{if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,leg.r))strong=true;}catch(_){ }
        return strong?{...c,h,idx}:null;
      }).filter(Boolean).sort((a,b)=>(a.idx-b.idx)||(b.n-a.n));
      if(!missing.length)continue;
      const cand=missing[0];
      const consensusNos=new Set(consensus.map(c=>c.no));
      const protectedNos=new Set([
        ...(leg.protectedSignalNos instanceof Set?[...leg.protectedSignalNos]:[]),
        ...(leg.protectedValueNos instanceof Set?[...leg.protectedValueNos]:[]),
        ...(leg.protectedBombNos instanceof Set?[...leg.protectedBombNos]:[])
      ].map(String));
      let replace=-1;
      for(let j=picks.length-1;j>=0;j--){
        const no=String(picks[j]?.horse_no??'');
        if(!no||protectedNos.has(no)||consensusNos.has(no)||tkpLegacyXKulisForce(picks[j]))continue;
        const ri=rank.get(no)??999;
        // Normalde daha güçlü/eşit ana aday yerine zayıf konsensüs sokulmaz.
        // Ancak aday iki kuponun 1-4 çekirdeğindeyse ve hedef kupon zaten 5+ atlıysa,
        // kullanıcının ortak-kapsam kilidi önceliklidir; son korumasız kuyrukla takas edilir.
        if(ri<=cand.idx&&!(cand.bestRank<=4&&picks.length>=5))continue;
        replace=j;break;
      }
      if(replace<0)continue;
      const outNo=String(picks[replace]?.horse_no??'');
      picks[replace]=cand.h;
      picks.sort((a,b)=>(rank.get(String(a?.horse_no??''))??999)-(rank.get(String(b?.horse_no??''))??999));
      leg.picks=picks;
      leg.couponConsensusSync={in:cand.no,out:outNo,sources:cand.n,reason:'2+ kupon ortak güçlü aday'};
      // Ayak başına / kupon başına tek takas yeterli; stratejik farkı koru.
    }
  }
  return built;
}

function tkpDisciplineSurpriseSingles(main,surprise){
  if(!main?.legs||!surprise?.legs)return surprise;
  const mainByLeg=new Map(main.legs.map((l,i)=>[tkpLegNoFromCouponLeg(l,i),l]));
  for(let i=0;i<surprise.legs.length;i++){
    const sl=surprise.legs[i],ml=mainByLeg.get(tkpLegNoFromCouponLeg(sl,i));if(!ml||(ml.picks||[]).length!==1)continue;
    // Sürpriz motor zaten farklı bir TEK bulmuşsa ona karışma; bu bilinçli alternatif senaryodur.
    if((sl.picks||[]).length===1&&String(sl.picks[0]?.horse_no)!==String(ml.picks[0]?.horse_no))continue;
    const single=ml.picks[0],r=sl.r||sl.x?.r||ml.r||ml.x?.r;
    const pool=(sl.ordered||sl.allHorses||r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h))&&String(h.horse_no)!==String(single.horse_no));
    const rivals=pool.map(h=>({h,s:tkpSurpriseRivalScore(r,h)})).filter(z=>z.s>=3).sort((a,b)=>b.s-a.s).slice(0,3).map(z=>z.h);
    // Sağlam TEK'in yanına onlarca at yazılmaz: 0-3 gerçek karşı aday.
    const raw=[single,...rivals];
    sl.picks=(typeof dedupeEkuri==='function'?dedupeEkuri(raw,r,'surprise',true):raw.filter((h,i,a)=>a.findIndex(x=>String(x?.horse_no)===String(h?.horse_no))===i)).slice(0,4);
  }
  return surprise;
}

function tkpFinalEkuriInvariant(coupon, mode='main'){
  if(!coupon || coupon.error || !Array.isArray(coupon.legs)) return coupon;
  for(const leg of coupon.legs){
    if(!leg || !Array.isArray(leg.picks)) continue;
    const targetCount=leg.picks.length;
    // Son portföy/çeşitlendirme adımlarından sonra dahi aynı E1/E2/... grubundan
    // iki at kalamaz. İlk görülen (ekran sırasındaki güçlü temsilci) korunur.
    let picks=dedupeEkuri(leg.picks,leg.r,mode,true);
    // Mükerrer eküri silinince boşalan yuvayı mümkünse başka bir bağımsız eküri/atla
    // doldur. Böylece kapsam daralmaz; aynı bahis hakkına iki kez kolon harcanmaz.
    if(picks.length<targetCount){
      const source=dedupeEkuri((leg.displayOrder&&leg.displayOrder.length?leg.displayOrder:(leg.ordered&&leg.ordered.length?leg.ordered:leg.allHorses||[])),leg.r,mode,true);
      const exact=new Set(picks.map(h=>String(h?.horse_no||'').trim().toUpperCase()));
      const groups=new Set(picks.map(h=>ekuriGroup(h?.horse_no)).filter(Boolean));
      for(const h of source){
        if(picks.length>=targetCount) break;
        if(!h || isNonRunner(h)) continue;
        const no=String(h.horse_no||'').trim().toUpperCase();
        const group=ekuriGroup(h.horse_no);
        if(exact.has(no) || (group&&groups.has(group))) continue;
        picks.push(h); exact.add(no); if(group) groups.add(group);
      }
    }
    leg.picks=dedupeEkuri(picks,leg.r,mode,true);
    if(leg.displayOrder&&leg.displayOrder.length){
      const rank=new Map(leg.displayOrder.map((h,i)=>[String(h?.horse_no||''),i]));
      leg.picks.sort((a,b)=>(rank.get(String(a?.horse_no||''))??999)-(rank.get(String(b?.horse_no||''))??999));
    }
  }
  return coupon;
}

function tkpAttachPayoutTargetProfile(coupon,key){
  if(!coupon||coupon.error)return coupon;
  // Bu bir ikramiye garantisi/tahmini değildir. Hedef segment yalnız yarış-öncesi
  // kupon yapısını tarif eder; geçmiş/gerçek payout alanı seçime kesinlikle girmez.
  const profiles={
    main:{label:'Normal · dengeli hedef profili',minTL:0,maxTL:100000,risk:'DENGELI_NORMAL'},
    alt:{label:'Sürpriz · yüksek ikramiye hedef profili',minTL:100000,maxTL:null,risk:'YUKSEK_IKRAMIYE_SURPRIZ'},
    surprise:{label:'Uzman/Kulis · konsensüs hedef profili',minTL:0,maxTL:null,risk:'UZMAN_KONSENSUS'}
  };
  const profile=profiles[key];if(!profile)return coupon;
  coupon.payoutTarget={...profile,preRaceOnly:true,guaranteed:false,validation:'KRONOLOJIK_HOLDOUT'};
  coupon.note=`${coupon.note||''} Hedef: ${profile.label}; gerçek ikramiye yalnız sonuç sonrası doğrulama etiketidir.`.trim();
  return coupon;
}

function tkpCouponLegConditionEstimate(leg){
  const target=leg?.r||leg?.x?.r;if(!target)return {sample:0,rate:0};
  const live=(typeof tkpLiveHorses==='function'?tkpLiveHorses(target):(target?.horses||[]).filter(h=>h&&!isNonRunner(h))).slice().sort((a,b)=>(Number(b?.agf)||0)-(Number(a?.agf)||0));
  const rankByNo=new Map(live.map((h,i)=>[String(h?.horse_no),Number(h?.agf_rank)||i+1]));
  const selectedRanks=new Set((leg?.picks||[]).map(h=>rankByNo.get(String(h?.horse_no))).filter(Number.isFinite));
  const date=String(target?.race_date||'').slice(0,10),surface=fold(target?.surface||target?.track_type||target?.pist||''),condition=fold(target?.condition_family||target?.condition_text||target?.condition||''),distance=Number(target?.distance)||0;
  const rows=learningEligibleRaces().filter(r=>String(r?.race_date||'').slice(0,10)<date&&(!surface||fold(r?.surface||r?.track_type||r?.pist||'')===surface)&&(!distance||Math.abs((Number(r?.distance)||0)-distance)<=200)&&(!condition||!r?.condition_family||fold(r?.condition_family||r?.condition_text||r?.condition||'')===condition));
  let sample=0,hit=0;
  for(const race of rows){const horses=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race?.horses||[]).filter(h=>h&&!isNonRunner(h)),winner=horses.find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);if(!winner)continue;const ordered=horses.slice().sort((a,b)=>(Number(b?.agf)||0)-(Number(a?.agf)||0)),rank=Number(winner?.agf_rank)||ordered.findIndex(h=>String(h?.horse_no)===String(winner?.horse_no))+1;if(rank<1)continue;sample++;if(selectedRanks.has(rank))hit++;}
  // Beta(1,1) yumuşatma: küçük örnekle %0/%100 kesinliği üretme.
  return {sample,hit,rate:(hit+1)/(sample+2),surface,distance,condition};
}

function tkpMarkConditionRecommendedCoupon(built){
  // Bu katman seçim yapmaz; yalnız kuponlara geçmiş pist/mesafe/koşu şartı etiketi
  // ekler. İlk kart boyasında 18 kez geçmiş havuzu süzmek gereksiz UI kilidiydi.
  // Kritik hızlı yol etiketi erteler; async rafinasyon aynı fonksiyonu kritik bayrak
  // kapalıyken çalıştırıp gerçek conditionFit/recommendedToday alanlarını tamamlar.
  if(globalThis.__tkpCouponCriticalPath===true){
    for(const coupon of [built?.main,built?.alt,built?.surprise]){
      if(coupon&&!coupon.error){coupon.conditionFitPending=true;coupon.recommendedToday=false;coupon.recommendationReason='Koşu şartı uyumu arka planda hesaplanıyor.';}
    }
    return built;
  }
  const entries=[['main',built?.main],['alt',built?.alt],['surprise',built?.surprise]].filter(([,c])=>c&&!c.error&&Array.isArray(c.legs)&&c.legs.length===6);
  const scored=entries.map(([key,coupon])=>{const legs=coupon.legs.map(tkpCouponLegConditionEstimate),sample=Math.min(...legs.map(x=>x.sample)),probability=legs.reduce((p,x)=>p*Math.max(1e-6,x.rate),1);coupon.conditionFit={sample,probability,percent:probability*100,eligible:sample>0,preRaceOnly:true,dimensions:['pist','mesafe','kosu_sarti','AGF_sira_kapsam']};coupon.recommendedToday=false;return {key,coupon,sample,probability};});
  const eligible=scored.filter(x=>x.sample>0).sort((a,b)=>b.probability-a.probability);
  if(eligible.length){eligible[0].coupon.recommendedToday=true;eligible[0].coupon.recommendationReason=`Pist/mesafe/koşu şartı geçmişinde en yüksek doğrulanmış kapsama · en az ${eligible[0].sample} benzer koşu`;}
  else for(const row of scored)row.coupon.recommendationReason='Kupon önerisi mevcut benzer koşular üzerinden hesaplanır.';
  return built;
}

function tkpRaiseCouponCostToMinimum(coupon,minCost=700,maxCost=1400){
  if(!coupon||coupon.error||!Array.isArray(coupon.legs)||!(Number(coupon.unit)>0))return coupon;
  const unit=Number(coupon.unit);
  const difficulties=new Map(coupon.legs.map(leg=>{
    let value=0;try{if(typeof raceDifficultyIndex==='function')value=Number(raceDifficultyIndex(leg.x||{r:leg.r,scored:leg.allHorses||leg.r?.horses||[]}))||0;}catch(_){ }
    return [leg,value];
  }));
  recalcCouponCost(coupon);
  let guard=0;
  while(Number(coupon.cost)<minCost-1e-9 && guard++<80){
    let best=null;
    const singleCount=(coupon.legs||[]).filter(l=>(l?.picks||[]).length===1).length;
    const narrowCount=(coupon.legs||[]).filter(l=>(l?.picks||[]).length>=2&&(l?.picks||[]).length<=3).length;
    for(const leg of coupon.legs){
      const current=Array.isArray(leg.picks)?leg.picks:[];
      // Son bütçe yükseltmesi zorunlu TEK'i ve tek 2–3 atlı sıkıştırma ayağını
      // bozmasın; maliyet için başka çoklu ayakta aday eklenir.
      if(singleCount<=2&&current.length===1)continue;
      if(singleCount===1&&narrowCount===1&&current.length>=2&&current.length<=3)continue;
      const pool=(leg.ordered||leg.displayOrder||leg.allHorses||leg.x?.scored||leg.r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
      const used=new Set(current.map(h=>String(ekuriBase(h?.horse_no)||h?.horse_no)));
      for(const cand of pool){
        const base=String(ekuriBase(cand?.horse_no)||cand?.horse_no);if(!base||used.has(base))continue;
        const counts=coupon.legs.map(l=>Math.max(1,(l.picks||[]).length));
        const idx=coupon.legs.indexOf(leg);counts[idx]+=1;
        const newCost=unit*counts.reduce((a,b)=>a*b,1);if(newCost>maxCost+1e-9)continue;
        const reaches=newCost>=minCost;const dist=reaches?newCost-minCost:minCost-newCost;
        const rank=pool.indexOf(cand);
        const difficulty=difficulties.get(leg)||0;
        const score=(reaches?0:100000)-difficulty*1000+dist+rank;
        if(!best||score<best.score)best={leg,cand,newCost,score};
      }
    }
    if(!best)break;
    best.leg.picks=dedupeEkuri((best.leg.picks||[]).concat([best.cand]),best.leg.r,coupon.typeKey==='main'?'main':'surprise');
    recalcCouponCost(coupon);
  }
  coupon.minimumBudgetTargetTL=minCost;
  coupon.minimumBudgetReached=Number(coupon.cost)>=minCost-1e-9;
  return coupon;
}

function tkpApplyKulisPriorityToCoupon(coupon,role){
  if(!coupon||coupon.error||coupon.readOnlySnapshot||!Array.isArray(coupon.legs)||typeof globalThis.tkpCommentatorConsensus!=='function')return coupon;
  const changes=[];
  const authorPart=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
  const historicalAuthorWeight=new Map();
  if(role==='expert'&&typeof globalThis.tkpHistoricalCommentatorPerformanceReport==='function'){
    let rows=[];try{rows=globalThis.tkpHistoricalCommentatorPerformanceReport(typeof db!=='undefined'?db:null)||[];}catch(_){rows=[];}
    for(const row of rows){
      const events=Number(row?.events)||0,accuracy=Number(row?.accuracy),edge=Number(row?.edge);
      if(events<=0||!Number.isFinite(accuracy))continue;
      const reliability=events/(events+6);
      const weight=reliability*(accuracy+Math.max(-.25,Math.min(.75,Number.isFinite(edge)?edge:0))*.5);
      historicalAuthorWeight.set(authorPart(row?.source_type)+'|'+authorPart(row?.author_id),weight);
    }
  }
  for(const leg of coupon.legs){
    // TEK'in bağımsız uygunluk denetimi korunur. Çoklu ayaklarda doğrulanmış
    // Kulis desteği önce, eşit destekte rolün mevcut veri sırası kullanılır.
    if((leg.picks||[]).length<2)continue;
    const order=tkpRoleSingleOrder(leg,role);
    const pool=dedupeEkuri(order,leg.r,role==='normal'?'main':'surprise');
    const ranked=pool.map((h,index)=>{
      let ev=null;try{ev=globalThis.tkpCommentatorConsensus(leg.r,h);}catch(_){ }
      const priority=globalThis.TKP_COUPON_POLICY?.commentPriority(leg.r,h)?.score||0;
      const governed=ev?.available===true?Math.max(0,Math.min(1,Number(ev.ratio)||0))*(1+priority):0;
      // Uzman + Kulis kuponunda yarış-öncesi ODS içinde saklanan gerçek yorumcu
      // satırları kaybolmasın. Yazarların tarihsel ağırlığı henüz oluşmadığında
      // consensus() 'available:false' dönebilir; fakat aynı atı 3+ ayrı yazar,
      // özellikle ilk 4 tercihinde yazmışsa bu güçlü kapsama kanıtıdır. Bu yol
      // yalnız çoklu ayakta 1:1 takas yapar; TEK'i ve bütçeyi değiştirmez.
      const embedded=Array.isArray(h?.ypuan_breakdown)?h.ypuan_breakdown:[];
      const authors=new Set(),rank2to5Authors=new Set();let embeddedPoints=0,historicalSupport=0;
      for(const row of embedded){
        const author=String(row?.source||row?.site||'')+'|'+String(row?.author||row?.author_id||row?.name||'');
        if(author==='|')continue;authors.add(author);
        if(Number(row?.rank)>=2&&Number(row?.rank)<=5){
          rank2to5Authors.add(author);
          historicalSupport+=Math.max(0,historicalAuthorWeight.get(authorPart(row?.source||row?.site)+'|'+authorPart(row?.author||row?.author_id||row?.name))||0);
        }
        embeddedPoints+=Math.max(0,Number(row?.points)||0);
      }
      let surpriseCandidate=Number(h?.bmb)===1||Number(h?.agf_rank)>=5||(Number(h?.agf)>0&&Number(h.agf)<=10);
      try{if(typeof isOdbCandidate==='function'&&isOdbCandidate(h,leg.r))surpriseCandidate=true;}catch(_){ }
      const embeddedSupport=role==='expert'&&surpriseCandidate&&rank2to5Authors.size>=3
        ?1+Math.min(1,rank2to5Authors.size/6)+Math.min(.5,embeddedPoints/100)+Math.min(.75,historicalSupport/Math.max(1,rank2to5Authors.size))
        :0;
      const support=Math.max(governed,embeddedSupport);
      return {h,index,support,embeddedAuthors:authors.size,embeddedRank2to5:rank2to5Authors.size,surpriseCandidate};
    }).sort((a,b)=>b.support-a.support||a.index-b.index);
    if(!ranked.some(row=>row.support>0))continue;
    leg.ordered=ranked.map(row=>row.h);
    leg.selectionOrderNos=leg.ordered.map(h=>String(h.horse_no));
    const selected=leg.picks.slice();
    const group=h=>String(ekuriBase(h?.horse_no)||h?.horse_no);
    const support=new Map(ranked.map(row=>[group(row.h),row.support]));
    for(const row of ranked){
      if(row.support<=0||selected.some(h=>group(h)===group(row.h)))continue;
      let at=-1;
      for(let i=0;i<selected.length;i++)if((support.get(group(selected[i]))||0)<row.support&&(at<0||(support.get(group(selected[i]))||0)<=(support.get(group(selected[at]))||0)))at=i;
      if(at<0)continue;
      changes.push({leg:leg.r?.leg,added:String(row.h.horse_no),removed:String(selected[at].horse_no),support:row.support});
      selected[at]=row.h;
    }
    leg.picks=selected;
    leg.kulisPriorityNos=selected.filter(h=>(support.get(group(h))||0)>0).map(h=>String(h.horse_no));
  }
  coupon.kulisPriority={version:'R16.70',role,changes,preRaceOnly:true,probabilitiesUnchanged:true};
  return coupon;
}
function tkpProtectVisibleLegLeaders(coupon,role){
  if(!coupon||coupon.error||coupon.readOnlySnapshot||!Array.isArray(coupon.legs))return coupon;
  const changes=[];
  for(const leg of coupon.legs){
    const picks=Array.isArray(leg?.picks)?leg.picks:[];
    // Rol bazlı TEK kararı korunur: ikinci sıradaki güçlü aday da TEK olabilir.
    // Yalnız çoklu ayakta İlk Bakış/ayak tablosu liderinin kupondan düşmesi engellenir.
    if(picks.length<2)continue;
    const visible=dedupeEkuri((leg.displayOrder?.length?leg.displayOrder:(leg.x?.scored||leg.allHorses||[])).filter(h=>h&&!isNonRunner(h)),leg.r,role==='normal'?'main':'surprise');
    const leader=visible[0];if(!leader)continue;
    const group=h=>String(ekuriBase(h?.horse_no)||h?.horse_no||'');
    const leaderGroup=group(leader);
    if(picks.some(h=>group(h)===leaderGroup))continue;
    const protectedGroups=new Set((leg.kulisPriorityNos||[]).map(no=>String(ekuriBase(no)||no)));
    const rank=new Map(visible.map((h,index)=>[group(h),index]));
    let replaceAt=-1,replaceRank=-1;
    for(let i=0;i<picks.length;i++){
      const g=group(picks[i]);if(protectedGroups.has(g))continue;
      const r=rank.has(g)?rank.get(g):Number.MAX_SAFE_INTEGER;
      if(r>=replaceRank){replaceRank=r;replaceAt=i;}
    }
    if(replaceAt<0){
      for(let i=0;i<picks.length;i++){
        const r=rank.has(group(picks[i]))?rank.get(group(picks[i])):Number.MAX_SAFE_INTEGER;
        if(r>=replaceRank){replaceRank=r;replaceAt=i;}
      }
    }
    if(replaceAt<0)continue;
    const removed=picks[replaceAt];picks[replaceAt]=leader;leg.picks=picks;
    changes.push({leg:Number(leg?.r?.leg)||0,added:String(leader.horse_no),removed:String(removed?.horse_no||'')});
  }
  recalcCouponCost(coupon);
  coupon.visibleLeaderProtection={version:'R16.82',role,changes,multiLegOnly:true,singlesUnchanged:true};
  return coupon;
}
function tkpFinalizeCouponSetFast(built,key,safeBudgets,started){
  // Her aktif kupon en az bir TEK taşır. Bütçe şekli de önce 2–3 atlı bir
  // ayakla, bu mümkün değilse ikinci rol-bazlı TEK ile sıkıştırılır. Çok güçlü
  // ortak veri varsa mevcut aynı TEK korunur; ayrışma zorla üretilmez.
  tkpEnsureCouponShape(built.main,'normal');
  tkpEnsureCouponShape(built.alt,'alt');
  tkpEnsureCouponShape(built.surprise,'expert');
  // Uzman/Kulis zaten kendi kanıt sırasını kullanır; yalnız tamamen aynı kopya olmasını
  // engellemek için bir ayakta maliyetsiz takasla asgari çeşitlilik aranır.
  tkpDiversifyCoupon(built.alt,[built.main],'alt',1);
  tkpDiversifyCoupon(built.surprise,[built.main,built.alt],'surprise',2);
  // Çeşitlilikten sonra ortak güçlü adayları çok-atlı ayaklarda yeniden uzlaştır.
  // Bu adım kolon sayısını değiştirmez; yalnız güvenli 1:1 kuyruk takası yapar.
  tkpSynchronizeWideCouponConsensus(built);
  // Uzlaştırma ortak güçlü adayları geri ekleyebilir. Son bir rol bazlı takas,
  // senaryo farkını korur; kolon sayısı ve maliyet değişmez.
  tkpDiversifyCoupon(built.alt,[built.main],'alt',1);
  tkpDiversifyCoupon(built.surprise,[built.main,built.alt],'surprise',2);
  tkpEnsureStrongPortfolioCoverage({main:built.main,main2:null,alt:built.alt,surprise:built.surprise});

  const caps={
    main:Number(built.main?.budgetTL)||safeBudgets.main,
    main2:0,
    alt:Number(built.alt?.budgetTL)||safeBudgets.surprise,
    surprise:Number(built.surprise?.budgetTL)||safeBudgets.surprise
  };
  for(const couponKey of ['main','alt','surprise']){
    const coupon=built[couponKey],cap=caps[couponKey];
    if(!coupon||coupon.disabled||coupon.error||!Array.isArray(coupon.legs))continue;
    tkpFinalEkuriInvariant(coupon,(couponKey==='surprise'||couponKey==='alt')?'surprise':'main');
    tkpApplyUnifiedCouponFeePolicy(coupon,couponKey==='surprise'?'expert':(couponKey==='alt'?'surprise':'main'),caps[couponKey]);
    const fit=enforceCouponCostCap(coupon.legs,coupon.unit,cap);
    coupon.legs=fit.legs;coupon.combos=fit.combos;coupon.cost=fit.cost;
    coupon.budgetLimited=fit.capLimited;coupon.riskFloorConflict=!!fit.riskFloorConflict;
    recalcCouponCost(coupon);
    // Kullanıcının seçtiği değer hedef bütçedir; 1.000–1.400 TL sözleşmesinde
    // kombinasyon sıçraması nedeniyle bir sonraki geçerli yapı hedefi aşabilir.
    // Bu durumda sessiz hata yerine aynı tanımlı bandın içinde kalınır.
    const userMax=TKP_COUPON_FEE_POLICY.maxBudgetTL;
    let effectiveCap=cap;
    if(coupon.cost>effectiveCap+1e-9 && coupon.cost<=userMax+1e-9){
      effectiveCap=Math.min(userMax,Math.ceil(Number(coupon.cost)/10)*10);
      caps[couponKey]=effectiveCap;
    }
    coupon.budgetTL=effectiveCap;
    coupon.maxBudgetTL=userMax;
    coupon.userCapTL=userMax;coupon.inputCapTL=userMax;
    coupon.leftover=round2ish(effectiveCap-coupon.cost);coupon.finalBudgetLock=true;
    if(coupon.cost>userMax+1e-9){
      coupon.error=`Bu koşullarda ${userMax} TL üst sınırıyla kupon oluşturulamıyor.`;
      coupon.budgetConflict=true;
    }
    for(const leg of coupon.legs||[]){
      const groups=(leg.picks||[]).map(h=>ekuriGroup(h?.horse_no)).filter(Boolean);
      if(new Set(groups).size!==groups.length)throw new Error(`Kupon eküri kilidi ihlali: ${couponKey} ${leg?.r?.leg||'?'} . ayak`);
    }
  }
  if(typeof tkpApplyBmbRescueSwap==='function'){
    tkpApplyBmbRescueSwap(built.main);tkpApplyBmbRescueSwap(built.alt);tkpApplyBmbRescueSwap(built.surprise);
  }
  if(typeof tkpApplyAgf69AdditiveRescue==='function'){
    // 100K+ hedefli gerçek Sürpriz kuponunda iki ayrı ayakta AGF 6–9/BMB
    // kuyruğu korunabilir; son bütçe kilidi maliyeti yine kullanıcı tavanında tutar.
    tkpApplyAgf69AdditiveRescue(built.alt,caps.alt,2);
    tkpApplyAgf69AdditiveRescue(built.surprise,caps.surprise,2);
  }
  // Rescue sonrası da hedef ve kullanıcı üst sınırı aşılmaz.
  for(const couponKey of ['main','alt','surprise']){
    const coupon=built[couponKey],cap=caps[couponKey];if(!coupon||coupon.error)continue;
    const finalFit=enforceCouponCostCap(coupon.legs,coupon.unit,cap);
    coupon.legs=finalFit.legs;coupon.combos=finalFit.combos;coupon.cost=finalFit.cost;coupon.leftover=round2ish(cap-finalFit.cost);
    tkpRaiseCouponCostToMinimum(coupon,TKP_COUPON_FEE_POLICY.minBudgetTL,Math.min(TKP_COUPON_FEE_POLICY.maxBudgetTL,Number(cap)||TKP_COUPON_FEE_POLICY.maxBudgetTL));
    coupon.leftover=round2ish((Number(cap)||1400)-Number(coupon.cost||0));
  }
  // Bütçe/rescue sonrası son ortak-kapsam kontrolü. Yalnız 1:1 takas yaptığı
  // için kombinasyon ve maliyet değişmez; iki kupondaki 1-4 çekirdek aday geniş
  // üçüncü kupondan sessizce düşmez.
  tkpSynchronizeWideCouponConsensus(built);
  // V1.1.320: final seçim otoritesi kronolojik holdout ile seçilmiş üç-kupon portföy DP'dir.
  // Eski rescue/konsensüs katmanları aday kanıtı üretir; son at sayısı, TEK ve sıra bu
  // leakage-free olasılık motorundan gelir. Sonuç alanları portföy motorunda okunmaz.
  if(typeof globalThis!=='undefined'&&globalThis.TKP_V320_PORTFOLIO?.applySet){
    globalThis.TKP_V320_PORTFOLIO.applySet(built);
  }
  for(const keyName of ['main','alt','surprise']){
    const c=built[keyName];if(!c||c.error)continue;
    // V320 son portföy DP'si kolonları değiştirebilir. Bu nedenle 700 TL tabanı
    // ve 1.400 TL tavanı DP'den ÖNCE değil, kesin son seçimden SONRA da uygulanır.
    // Ekrandaki sabit 700–1.400 sözleşmesi ile gerçek kupon maliyeti böyle eşleşir.
    const finalCap=tkpCouponBudgetFor(c.userCapTL||TKP_COUPON_FEE_POLICY.maxBudgetTL,keyName==='surprise'?'expert':(keyName==='alt'?'surprise':'main'));
    const finalBandFit=enforceCouponCostCap(c.legs,c.unit,finalCap);
    c.legs=finalBandFit.legs;c.combos=finalBandFit.combos;c.cost=finalBandFit.cost;
    tkpRaiseCouponCostToMinimum(c,TKP_COUPON_FEE_POLICY.minBudgetTL,TKP_COUPON_FEE_POLICY.maxBudgetTL);
    recalcCouponCost(c);
    c.minimumBudgetTargetTL=TKP_COUPON_FEE_POLICY.minBudgetTL;
    c.minimumBudgetReached=Number(c.cost)>=TKP_COUPON_FEE_POLICY.minBudgetTL-1e-9;
    const effectiveCap=Math.max(finalCap,Math.ceil(Number(c.cost||0)/10)*10);
    c.maxBudgetTL=TKP_COUPON_FEE_POLICY.maxBudgetTL;c.userCapTL=effectiveCap;c.inputCapTL=finalCap;
    c.leftover=round2ish(effectiveCap-Number(c.cost||0));c.finalBudgetLock=true;
    if(Number(c.cost)>TKP_COUPON_FEE_POLICY.maxBudgetTL+1e-9){c.error='Kupon 1.400 TL üst sınırını aşıyor.';c.budgetConflict=true;continue;}
    if(Number(c.cost)<TKP_COUPON_FEE_POLICY.minBudgetTL-1e-9){c.error='Mevcut ayak/at sayılarıyla 1.000–1.400 TL aralığında geçerli kupon oluşturulamadı.';c.budgetConflict=true;continue;}
    tkpFinalEkuriInvariant(c,keyName==='main'?'main':'surprise');
  }
  // V320/rescue sonradan bir TEK'i çokluya çevirmiş olabilir. Nihai görünür
  // kuponu tekrar şekillendir; aynı TEK güçlü veriyse olduğu gibi bırak.
  tkpEnsureCouponShape(built.main,'normal');
  tkpEnsureCouponShape(built.alt,'alt');
  tkpEnsureCouponShape(built.surprise,'expert');
  // V320 son seçimde üç bilet aynı ilk sıraya geri toplanabiliyor. Bütçe ve at
  // sayısını değiştirmeyen son 1:1 rol takasıyla Sürpriz/Uzman senaryosu korunur.
  tkpDiversifyCoupon(built.alt,[built.main],'alt',1);
  tkpDiversifyCoupon(built.surprise,[built.main,built.alt],'surprise',1);
  // R18.9 son BH/ODB kapsama kilidi: V320/shape/diversify sonrasında da 6/7/8+ ayaklarda korunur.
  tkpApplyBmbRescueSwap(built.main);tkpApplyBmbRescueSwap(built.alt);tkpApplyBmbRescueSwap(built.surprise);
  for(const [key,c] of [['main',built.main],['alt',built.alt],['surprise',built.surprise]]){
    if(!c||c.error)continue;
    recalcCouponCost(c);
    const cap=tkpCouponBudgetFor(c.userCapTL||TKP_COUPON_FEE_POLICY.maxBudgetTL,key==='surprise'?'expert':(key==='alt'?'surprise':'main'));
    if(Number(c.cost)<TKP_COUPON_FEE_POLICY.minBudgetTL-1e-9)tkpRaiseCouponCostToMinimum(c,TKP_COUPON_FEE_POLICY.minBudgetTL,TKP_COUPON_FEE_POLICY.maxBudgetTL);
    recalcCouponCost(c);const effectiveCap=Math.max(cap,Math.ceil(Number(c.cost||0)/10)*10);c.minimumBudgetTargetTL=TKP_COUPON_FEE_POLICY.minBudgetTL;c.minimumBudgetReached=Number(c.cost)>=TKP_COUPON_FEE_POLICY.minBudgetTL-1e-9;c.userCapTL=effectiveCap;c.leftover=round2ish(effectiveCap-Number(c.cost||0));c.finalBudgetLock=true;
    if(Number(c.cost)<TKP_COUPON_FEE_POLICY.minBudgetTL-1e-9){c.error='TEK/2–3 ayak yapısı korunarak 1.000 TL alt sınırına ulaşılamadı.';c.budgetConflict=true;}
  }
  // Taban bütçeyi dolduran son genişletme ortak liderleri yeniden ekleyebilir.
  // Bu en son aşamadır: yalnız aynı ayaktaki eşit sayıda aday takas edilir.
  tkpDiversifyCoupon(built.alt,[built.main],'alt',1);
  tkpDiversifyCoupon(built.surprise,[built.main,built.alt],'surprise',1);
  // R18.9 son BH/ODB kapsama kilidi: V320/shape/diversify sonrasında da 6/7/8+ ayaklarda korunur.
  tkpApplyBmbRescueSwap(built.main);tkpApplyBmbRescueSwap(built.alt);tkpApplyBmbRescueSwap(built.surprise);
  if(globalThis.TKP_V320_PORTFOLIO?.rebalanceThirdHorse){
    for(const key of ['main','alt','surprise'])globalThis.TKP_V320_PORTFOLIO.rebalanceThirdHorse(built[key],key);
  }
  tkpAttachPayoutTargetProfile(built.main,'main');
  tkpAttachPayoutTargetProfile(built.alt,'alt');
  tkpAttachPayoutTargetProfile(built.surprise,'surprise');
  tkpMarkConditionRecommendedCoupon(built);
  if(typeof tkpChampionCouponSetAudit==='function') tkpChampionCouponSetAudit(built);
  tkpApplyKulisPriorityToCoupon(built.main,'normal');
  tkpApplyKulisPriorityToCoupon(built.alt,'alt');
  tkpApplyKulisPriorityToCoupon(built.surprise,'expert');
  tkpAuditFinalSingles(built.main,'main');
  tkpAuditFinalSingles(built.alt,'alt');
  tkpAuditFinalSingles(built.surprise,'surprise');
  if(globalThis.TKP_COUPON_COVERAGE?.planWidths){
    globalThis.TKP_COUPON_COVERAGE.planSet(built);
    for(const name of ['main','alt','surprise']){
      if(built[name]&&!built[name].error){recalcCouponCost(built[name]);delete built[name].coverageOptimization;delete built[name].diversity;}
    }
    delete built.coverageOptimization;
  }
  if(globalThis.TKP_COUPON_COVERAGE?.optimize)globalThis.TKP_COUPON_COVERAGE.optimize(built);
  if(globalThis.TKP_COUPON_POLICY)globalThis.TKP_COUPON_POLICY.enforce(built);
  // Son optimizer/politika katmanı görünür TKP liderini tekrar çıkaramasın.
  // Genişlik ve maliyet aynı kalır; salt-okunur eski snapshotlara dokunulmaz.
  tkpProtectVisibleLegLeaders(built.main,'normal');
  tkpProtectVisibleLegLeaders(built.alt,'alt');
  tkpProtectVisibleLegLeaders(built.surprise,'expert');
  globalThis.TKP_COUPON_COVERAGE?.enforceSet?.(built);
  if(typeof tkpCouponCheck==='function')tkpCouponCheck();
  // R17.4: final kuponlar aynı P_WIN + EV + ROI + risk motorunda sıralanır.
  // Bu katman at listesini sessizce değiştirmez; hangi kuponun sermaye önceliği
  // taşıdığını ve beklenen değer/risk profilini final seçim üstüne yazar.
  try{globalThis.TKP_R17_EV_ROI_PORTFOLIO?.rankAltiliCoupons?.(built);}catch(_e){}
  // R17.9: Monte Carlo istikrar metadata'sı — SHADOW-ONLY. Varsayılan kapalı;
  // yalnız globalThis.TKP_SMART_FILTER_SETTINGS.monteCarloShadow===true iken
  // çalışır, hiçbir kuponun at listesini/sırasını/maliyetini değiştirmez,
  // yalnız built[name].monteCarlo bilgi alanı ekler (Dashboard okuması için).
  try{
    if(globalThis.TKP_MONTE_CARLO&&globalThis.TKP_SMART_FILTER_SETTINGS?.monteCarloShadow===true){
      for(const name of ['main','alt','surprise']){
        const c=built[name];
        if(!c||c.disabled||c.error||!Array.isArray(c.legs)||!c.legs.length)continue;
        const races=c.legs.map(l=>l.r||l.race||l.x?.r).filter(Boolean);
        if(races.length!==c.legs.length)continue;
        const pools=c.legs.map(l=>l.picks||[]);
        const sim=globalThis.TKP_MONTE_CARLO.simulateCard(races,{iterations:globalThis.TKP_SMART_FILTER_SETTINGS?.iterations||10000});
        const jh=globalThis.TKP_MONTE_CARLO.jointHitRate(sim,pools);
        c.monteCarlo={hitRate:jh.hitRate,ci95:jh.ci95,iterations:jh.iterations};
      }
    }
  }catch(_e){}
  _tkpLiveCouponSetCache.set(key,tkpCloneCouponSet(built));
  while(_tkpLiveCouponSetCache.size>TKP_LIVE_COUPON_CACHE_LIMIT)_tkpLiveCouponSetCache.delete(_tkpLiveCouponSetCache.keys().next().value);
  const ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  globalThis.__tkpLastCouponBuildMetrics={cacheHit:false,durationMs:Math.round((ended-started)*10)/10};
  return built;
}

// Bütün canlı/async/backtest yolları aynı bütçe sözleşmesini kullanır. "Aylık
// 90.000 TL" burada kişi bazlı sert limit olarak tanımlıdır; 50.000 TL ise
// görünür hedef/uyarı eşiğidir. Gerçek harcama
// kalibrasyon katmanının izin verdiği toplantı sayısı ve ürün paylarıyla ayrıca
// izlenir. Kupon üreticisi tek toplantıda bu aralığın dışına çıkamaz.
// Tek ücret politikası: bütün kupon üreticileri (Normal, Sürpriz, Uzman,
// canlı, Back Test ve tarihsel kalibrasyon) aynı bütçe bandını kullanır.
// Algoritmanın aday sırası değişebilir; bir kuponun ücret kuralı değişemez.
const TKP_COUPON_FEE_POLICY=Object.freeze({
  version:'R16.82-ADAPTIVE-COUPON-FEE-1000-1400-HARD-90000',
  monthlyTargetTL:50000,
  monthlyHardLimitTL:90000,
  minBudgetTL:1000,
  maxBudgetTL:1400,
  defaultBudgetTL:1400
});
const TKP_COUPON_BUDGET_POLICY=Object.freeze({
  version:TKP_COUPON_FEE_POLICY.version,
  monthlyTargetTL:TKP_COUPON_FEE_POLICY.monthlyTargetTL,
  monthlyHardLimitTL:TKP_COUPON_FEE_POLICY.monthlyHardLimitTL,
  normal:TKP_COUPON_FEE_POLICY,
  surprise:TKP_COUPON_FEE_POLICY,
  expert:TKP_COUPON_FEE_POLICY
});
function tkpClampCouponBudget(value,policy){
  const raw=Number(value);
  const preferred=Number.isFinite(raw)&&raw>0?raw:policy.default;
  return Math.min(policy.max,Math.max(policy.min,preferred));
}
function tkpCouponBudgetFor(value,type='main'){
  const p=type==='expert'||type==='surprise'||type==='alt'?TKP_COUPON_FEE_POLICY:TKP_COUPON_FEE_POLICY;
  return tkpClampCouponBudget(value,{min:p.minBudgetTL,max:p.maxBudgetTL,default:p.defaultBudgetTL});
}
function tkpCouponUnitFor(hippodrome,legCount=6){
  const value=typeof ganyanUnitPrice==='function'?ganyanUnitPrice(hippodrome,legCount):null;
  return Number.isFinite(Number(value))&&Number(value)>0?Number(value):1;
}
function tkpApplyUnifiedCouponFeePolicy(coupon,type='main',requestedBudget=null){
  if(!coupon||coupon.error)return coupon;
  const cap=tkpCouponBudgetFor(requestedBudget??coupon.userCapTL??coupon.budgetTL,type);
  coupon.feePolicyVersion=TKP_COUPON_FEE_POLICY.version;
  coupon.feePolicy={minBudgetTL:TKP_COUPON_FEE_POLICY.minBudgetTL,maxBudgetTL:TKP_COUPON_FEE_POLICY.maxBudgetTL,defaultBudgetTL:TKP_COUPON_FEE_POLICY.defaultBudgetTL};
  coupon.minBudgetTL=TKP_COUPON_FEE_POLICY.minBudgetTL;
  coupon.maxBudgetTL=TKP_COUPON_FEE_POLICY.maxBudgetTL;
  coupon.userCapTL=cap;
  return coupon;
}
function tkpCouponBudgetPolicy(budgets={}){
  const normalMode=budgets?.normalMode==='coverage'?'coverage':'standard';
  return {
    ...TKP_COUPON_BUDGET_POLICY,
    main:tkpCouponBudgetFor(budgets?.main,'main'),
    alt:0,
    surprise:tkpCouponBudgetFor(budgets?.surprise,'surprise'),
    normalMode
  };
}
function tkpSafeCouponBudgets(budgets={}){
  const policy=tkpCouponBudgetPolicy(budgets);
  return {main:policy.main,alt:0,surprise:policy.surprise,normalMode:policy.normalMode,monthlyTargetTL:policy.monthlyTargetTL,monthlyHardLimitTL:policy.monthlyHardLimitTL};
}
if(typeof globalThis!=='undefined'){
globalThis.TKP_COUPON_BUDGET_POLICY=TKP_COUPON_BUDGET_POLICY;
  globalThis.TKP_COUPON_FEE_POLICY=TKP_COUPON_FEE_POLICY;
  globalThis.tkpCouponBudgetPolicy=tkpCouponBudgetPolicy;
  globalThis.tkpCouponBudgetFor=tkpCouponBudgetFor;
  globalThis.tkpCouponUnitFor=tkpCouponUnitFor;
  globalThis.tkpApplyUnifiedCouponFeePolicy=tkpApplyUnifiedCouponFeePolicy;
}

function tkpReadLiveCouponCache(key,started){
  if(!_tkpLiveCouponSetCache.has(key))return null;
  const cached=_tkpLiveCouponSetCache.get(key);
  _tkpLiveCouponSetCache.delete(key);_tkpLiveCouponSetCache.set(key,cached);
  const ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  globalThis.__tkpLastCouponBuildMetrics={cacheHit:true,durationMs:Math.round((ended-started)*10)/10};
  return tkpCloneCouponSet(cached);
}

function buildCouponSetFast(raceResults,budgets={}){
  const safeBudgets=tkpSafeCouponBudgets(budgets);
  const key=tkpLiveCouponCacheKey(raceResults,safeBudgets);
  const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const cached=tkpReadLiveCouponCache(key,started);if(cached)return cached;
  tkpBeginCouponStrengthBuild();
  const ranked=strictRankedRaceResults(raceResults);
  const built={
    main:buildDynamicNormalCoupon(raceResults,safeBudgets.main,ranked,safeBudgets),
    main2:{disabled:true,removed:true,label:'Normal 2 kaldırıldı',legs:[],cost:0},
    alt:buildSurpriseCoupon(raceResults,safeBudgets.surprise,ranked),
    surprise:buildBombaCoupon(raceResults,safeBudgets.surprise,ranked)
  };
  return tkpFinalizeCouponSetFast(built,key,safeBudgets,started);
}

async function buildCouponSetFastAsync(raceResults,budgets={},preparedRanked=null){
  const safeBudgets=tkpSafeCouponBudgets(budgets);
  const key=tkpLiveCouponCacheKey(raceResults,safeBudgets);
  const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const cached=tkpReadLiveCouponCache(key,started);if(cached)return cached;
  tkpBeginCouponStrengthBuild();
  const stages=[];
  let stageStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const ranked=Array.isArray(preparedRanked)?preparedRanked:await strictRankedRaceResultsAsync(raceResults);
  stages.push({stage:'ranking',ms:Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-stageStarted)*10)/10});
  // Kritik kullanıcı yolunda en pahalı minimumCostCoverage çağrısı 6 ayağın planını
  // tek blokta soğuk hesaplıyordu. Aynı WeakMap planlarını ayak/mod bazında önceden
  // doldurup HER küçük parça arasında yield ediyoruz. Final builder aynı cache'i
  // okuduğu için seçim matematiği değişmez; uzun tek-parça UI kilidi parçalanır.
  if(globalThis.__tkpCouponCriticalPath===true&&typeof legCoveragePlan==='function'){
    for(const item of ranked){
      tkpCouponCheck(`Ayak ${item?.r?.leg||''}: adaylar`);
      for(const mode of ['main','alt','surprise']){
        await tkpCouponPause();
        const plan=legCoveragePlan(item,mode);
        const strengthRows=(plan?.orderedPool||item?.scored||[]).filter(h=>h&&!isNonRunner(h));
        // minimumCostCoverage içinde aynı at gücü onlarca kez sıralama karşılaştırmasında
        // hesaplanıyordu. Ayak/mod başına bir kez hesapla; her 3 atta UI'ye geri dön.
        for(let si=0;si<strengthRows.length;si++){
          tkpCouponStrengthCached(item.r,strengthRows[si],mode);
          if(si%3===2)await tkpCouponPause();
        }
      }
    }
  }
  await tkpCouponPause();
  stageStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  tkpCouponCheck('Normal kupon');
  const main=buildDynamicNormalCoupon(raceResults,safeBudgets.main,ranked,safeBudgets);
  stages.push({stage:'normal',ms:Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-stageStarted)*10)/10});
  await tkpCouponPause();
  stageStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  tkpCouponCheck('Sürpriz kupon');
  const alt=buildSurpriseCoupon(raceResults,safeBudgets.surprise,ranked);
  stages.push({stage:'surprise',ms:Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-stageStarted)*10)/10});
  await tkpCouponPause();
  stageStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  tkpCouponCheck('Uzman kupon');
  const surprise=buildBombaCoupon(raceResults,safeBudgets.surprise,ranked);
  stages.push({stage:'expert',ms:Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-stageStarted)*10)/10});
  await tkpCouponPause();
  stageStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  tkpCouponCheck('Son kontroller');
  const built=tkpFinalizeCouponSetFast({main,main2:{disabled:true,removed:true,label:'Normal 2 kaldırıldı',legs:[],cost:0},alt,surprise},key,safeBudgets,started);
  stages.push({stage:'finalize',ms:Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-stageStarted)*10)/10});
  tkpCouponCheck();
  globalThis.__tkpLastCouponBuildStages=stages;
  return built;
}

function tkpRequiredBudgetFromCouponError(coupon){
  const text=String(coupon?.error||'');
  const m=text.match(/\((\d+(?:[.,]\d+)?)\s*TL\)/i);
  if(!m)return null;
  const value=Number(String(m[1]).replace(',','.'));
  return Number.isFinite(value)&&value>0?Math.ceil(value/10)*10:null;
}
function tkpAttachAdaptiveBudgetMeta(built,maxMain,maxSurprise,policy=null){
  globalThis.TKP_COUPON_COVERAGE?.enforceSet?.(built);
  const meta={
    baseMain:1000,baseSurprise:1000,maxMain,maxSurprise,
    mainBudget:Number(built.main?.budgetTL)||1000,
    main2Budget:Number(built.main2?.budgetTL)||1000,
    surpriseBudget:Number(built.alt?.budgetTL)||1000,expertBudget:Number(built.surprise?.budgetTL)||1000,
    changes:[],escalated:false,dynamic:true
  };
  built.adaptiveBudget=meta;
  for(const key of ['main','main2','alt','surprise']){
    const coupon=built?.[key];if(!coupon)continue;
    const max=(key==='surprise'||key==='alt')?maxSurprise:maxMain;
    coupon.adaptiveBudget=meta;coupon.baseBudgetTL=1000;coupon.maxBudgetTL=max;coupon.userCapTL=max;
    coupon.dynamicBudgetTargetTL=Number(coupon.budgetTL)||1000;
    coupon.adaptiveBudgetRaised=Number(coupon.budgetTL)>1000;
    coupon.adaptiveBudgetNote=`Zorluk hedefi: ${round2ish(coupon.dynamicBudgetTargetTL)} TL · Aralık: 1.000–1.400 TL · Maliyet: ${round2ish(Number(coupon.cost)||0)} TL`;
    coupon.monthlyBankrollLimitTL=Number(policy?.monthlyHardLimitTL)||TKP_COUPON_BUDGET_POLICY.monthlyHardLimitTL;
  }
  return built;
}

function tkpBuildCouponSetAdaptive(raceResults,budgets={}){
  const policy=tkpCouponBudgetPolicy(budgets);
  const previousCriticalFlag=globalThis.__tkpCouponCriticalPath===true;
  globalThis.__tkpCouponCriticalPath=true;
  let builtRaw;
  try{
    builtRaw=buildCouponSetFast(raceResults,{main:policy.main,main2:policy.main,alt:0,surprise:policy.surprise,normalMode:policy.normalMode})||{};
  }finally{

    globalThis.__tkpCouponCriticalPath=previousCriticalFlag;
  }
  const built=builtRaw;
  return tkpAttachAdaptiveBudgetMeta(built,policy.main,policy.surprise,policy);
}

// İlk kullanıcı tıklaması için gerçek kooperatif hızlı yol. Matematik senkron
// tkpBuildCouponSetAdaptive ile aynıdır; fark yalnız Normal/Sürpriz/Uzman/finalize
// blokları arasında event-loop'a geri dönmesidir. Ağır tarihsel rafinasyon burada
// başlatılmaz; aşağıdaki tkpBuildCouponSetAdaptiveAsync arka plan işi olarak kalır.
// A deadline must be checked by the computation itself: a button's timer cannot
// interrupt JavaScript that is still running on the UI thread.
let _tkpCouponRun=null;
function tkpCouponClock(){return typeof performance!=='undefined'&&performance.now?performance.now():Date.now();}
function tkpCouponCheck(stage){
  const run=_tkpCouponRun;if(!run)return;
  if(stage&&stage!==run.stage){
    const now=tkpCouponClock();run.phases=run.phases||[];
    run.phases.push({stage:run.stage,ms:Math.round(now-(run.phaseStarted??run.started))});
    run.phaseStarted=now;
  }
  if(stage)run.stage=stage;
  run.elapsedMs=Math.max(0,tkpCouponClock()-run.started);
  if(run.cancelled||run.elapsedMs>=run.budgetMs){
    const error=new Error(run.cancelled?'Kupon oluşturma iptal edildi.':`Kupon oluşturma ${run.budgetMs/1000} saniye sınırında durduruldu. Aşama: ${run.stage}.`);
    error.code=run.cancelled?'TKP_COUPON_CANCELLED':'TKP_COUPON_TIMEOUT';
    throw error;
  }
  if(run.refinementBudgetMs&&run.elapsedMs>=run.refinementBudgetMs){
    const error=new Error('Ayrıntılı aramanın süre payı doldu; tamamlanmış kapsama planı kullanılıyor.');
    error.code='TKP_COUPON_REFINEMENT_LIMIT';throw error;
  }
  if(stage||run.elapsedMs-run.lastProgress>=100){
    run.lastProgress=run.elapsedMs;
    if(typeof run.onProgress==='function')run.onProgress({...run,onProgress:undefined});
  }
}
async function tkpCouponPause(stage){
  tkpCouponCheck(stage);
  const run=_tkpCouponRun;
  // Cached horse scores can take microseconds. Avoid paying the Windows timer
  // interval for every three cache hits; yield once the work slice reaches 12 ms.
  if(run&&!stage&&tkpCouponClock()-(run.lastYieldAt??run.started)<12)return;
  // Use a timer task explicitly. Chained MessageChannel resolutions can starve
  // timer/input work even though each step technically returns a Promise.
  await new Promise(resolve=>setTimeout(resolve,0));
  tkpCouponCheck();
  if(run)run.lastYieldAt=tkpCouponClock();
}
function tkpCancelCouponBuild(){if(_tkpCouponRun)_tkpCouponRun.cancelled=true;}
function tkpScheduleCouponLearningPrewarm(raceResults){
  const rows=Array.isArray(raceResults)?raceResults.slice():[];
  const work=async()=>{
    if(typeof globalThis.tkpEnsureProfileCandidatesIndexAsync==='function'){
      await globalThis.tkpEnsureProfileCandidatesIndexAsync({pause:()=>new Promise(resolve=>setTimeout(resolve,0))});
    }
    if(typeof globalThis.tkpPrewarmAltiliWinnerOrderAsync==='function'){
      for(const item of rows){
        const race=item?.r||item;if(!race)continue;
        const horses=(item?.scored&&item.scored.length)?item.scored:(race.horses||[]);
        await globalThis.tkpPrewarmAltiliWinnerOrderAsync(race,horses,{pause:()=>new Promise(resolve=>setTimeout(resolve,0))});
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    return true;
  };
  if(typeof globalThis.tkpQueueTask==='function'){
    globalThis.tkpQueueTask('coupon-learning-prewarm',work,{priority:'background',replace:true,minIdleMs:700});
  }else setTimeout(()=>{Promise.resolve(work()).catch(()=>{});},700);
  return true;
}
if(typeof globalThis!=='undefined')globalThis.tkpScheduleCouponLearningPrewarm=tkpScheduleCouponLearningPrewarm;
async function tkpBuildCouponSetAdaptiveCriticalAsync(raceResults,budgets={},options={}){
  if(_tkpCouponRun)throw new Error('Bir kupon hesabı zaten çalışıyor.');
  const run={started:Number.isFinite(options.startedAt)?options.startedAt:tkpCouponClock(),budgetMs:40000,stage:'Hazırlık',elapsedMs:0,lastProgress:-100,cancelled:false,onProgress:options.onProgress};
  // Keep a phase-local clock for the canonical planner path.  This must be
  // initialized before either the fast return or the adaptive fallback so a
  // successful planner result cannot fail during its final telemetry write.
  const stageStarted=run.started;
  const policy=tkpCouponBudgetPolicy(budgets);
  _tkpCouponRun=run;
  const previousCriticalFlag=globalThis.__tkpCouponCriticalPath===true;
  globalThis.__tkpCouponCriticalPath=true;
  // The live page exposes a cheap immediate-render priming hook from
  // online-ranking-engine.js.  Node/diagnostic harnesses may load only the
  // builder, so retain their cooperative pretraining path for coverage tests
  // and for environments where the priming module is unavailable.
  const hasImmediatePrime=typeof globalThis.tkpPrimeOnlinePositionsForImmediateRender==='function';
  let builtRaw;
  let boundedPlan=null;
  let commentatorCache=null;
  try{
    if(typeof globalThis.tkpPrepareCouponCommentatorCache==='function'){
      await tkpCouponPause('Yorumcu geçmişi');
      commentatorCache=await globalThis.tkpPrepareCouponCommentatorCache({pause:()=>tkpCouponPause()});
      tkpCouponCheck();
    }
    // R17.1: Profil ve Altılı P1 tarihsel öğrenmesi artık kupon tıklamasını
    // bekletmez. Soğuk cache için hafif fallback kullanılır; tam öğrenme kupon
    // sonucu boyandıktan sonra arka planda kooperatif olarak hazırlanır.
    // Önce altı ayağı, gerçek bütçesi ve 1–2 TEK'i tamamlanmış bir aday üret.
    // Ağır arama biterse onun sonucu seçilir; süre dolması tüm kartları yok etmez.
    if(globalThis.TKP_ARCHIVE_COUPON_PLANNER){
      await tkpCouponPause('İlk kapsama planı');
      const planner=globalThis.TKP_ARCHIVE_COUPON_PLANNER;
      const candidate=typeof planner.buildAsync==='function'
        ?await planner.buildAsync(raceResults,Math.min(policy.main,policy.surprise),{current:true,pause:()=>tkpCouponPause()})
        :planner.build(raceResults,Math.min(policy.main,policy.surprise),{current:true});
      tkpCouponCheck();
      if(globalThis.TKP_COUPON_COVERAGE){
        const coverage=globalThis.TKP_COUPON_COVERAGE;
        await tkpCouponPause('TEK ve ayak dağılımı');
        if(typeof coverage.planSetAsync==='function')await coverage.planSetAsync(candidate,{pause:()=>tkpCouponPause()});
        else coverage.planSet(candidate);
        await tkpCouponPause('Üç kuponun ortak kapsamı');
        if(typeof coverage.optimizeAsync==='function')await coverage.optimizeAsync(candidate,{pause:()=>tkpCouponPause()});
        else coverage.optimize(candidate);
        tkpCouponCheck();
      }
      if(globalThis.TKP_COUPON_POLICY){
        for(const role of ['main','alt','surprise']){
          await tkpCouponPause('Kupon kuralları');
          globalThis.TKP_COUPON_POLICY.enforce({[role]:candidate[role]});
        }
      }
      tkpCouponCheck();
      const completeCandidate=['main','alt','surprise'].every(k=>candidate[k]&&!candidate[k].error&&candidate[k].legs?.length===6);
      const budgetCandidate=['main','alt','surprise'].every(k=>candidate[k]&&!candidate[k].error&&candidate[k].cost>=1000&&candidate[k].cost<=1400);
      if((options.currentReplayFast===true&&completeCandidate)||budgetCandidate){
        boundedPlan=candidate;run.refinementBudgetMs=25000;
      }
    }
    // Arşiv planlayıcısı altı ayağı, tek adaylarını ve bütçe dağılımını zaten
    // doğrulayan kanonik bir sonuç üretiyor. Bu sonuç hazırsa kullanıcı yolunda
    // ikinci kez tam adaptif arama yapma; soğuk 3.000+ yarışlık eğitim burada
    // çalıştığında ekran birkaç saniye içinde tekrar kilitlenebiliyordu. Tam
    // online eğitim aşağıdaki post-kupon kuyruğunda bütün geçmişi kullanmaya
    // devam eder. `fastReturn:false` yalnız tanı/karşılaştırma testleri içindir.
    if(boundedPlan&&options.fastReturn!==false&&hasImmediatePrime&&!run.cancelled){
      builtRaw=tkpAttachAdaptiveBudgetMeta(boundedPlan,policy.main,policy.surprise,policy);
      tkpCouponCheck('Tamamlandı');
      run.status='completed';run.stage='Hızlı kanonik kapsama planı';
      globalThis.__tkpLastCouponBuildStages=[{stage:'canonical-plan',ms:Math.round(tkpCouponClock()-stageStarted)}];
      if(typeof run.onProgress==='function')run.onProgress({...run,onProgress:undefined});
      return builtRaw;
    }
    // İlk kupon yolu geçmişteki tüm yarışları eğitmeye çalışmamalı. Bu işlem
    // parçalara ayrılsa bile 3.000+ yarışlık arşivde kullanıcı yolunu onlarca
    // saniye meşgul ediyor ve düşük bellekli tarayıcıda sayfayı düşürebiliyordu.
    // Kanonik puan sırası aynı kalır; online P1/P2/P3/P5 modelleri her ayak için
    // geçici öncül ağırlıklarla hemen hazırlanır. Tam eğitim kupon kartları
    // göründükten sonra `tkpScheduleOnlinePositionsTraining` tarafından arka
    // planda, bütün geçmiş veri kullanılarak yapılır.
    if(!hasImmediatePrime&&typeof globalThis.tkpPretrainOnlinePositionsAsync==='function'){
      for(const row of raceResults||[]){
        const race=row?.r||row;
        await globalThis.tkpPretrainOnlinePositionsAsync(race,[1,2,3,5],{yieldToUi:()=>tkpCouponPause(),checkpoint:()=>tkpCouponCheck('Geçmiş model')});
      }
    }else if(hasImmediatePrime){
      for(const row of raceResults||[]){
        const race=row?.r||row;
        globalThis.tkpPrimeOnlinePositionsForImmediateRender(race,[1,2,3,5]);
        await tkpCouponPause();
      }
    }
    await tkpCouponPause('Sıralama');
    builtRaw=await buildCouponSetFastAsync(raceResults,{main:policy.main,main2:policy.main,alt:0,surprise:policy.surprise,normalMode:policy.normalMode});
    await tkpCouponPause('Son bütçe ve dağılım kontrolü');
    builtRaw=tkpAttachAdaptiveBudgetMeta(builtRaw||{},policy.main,policy.surprise,policy);
    tkpCouponCheck('Tamamlandı');
    run.status='completed';
  }catch(error){
    if(boundedPlan&&!run.cancelled&&['TKP_COUPON_TIMEOUT','TKP_COUPON_REFINEMENT_LIMIT'].includes(error.code)){
      builtRaw=boundedPlan;
      for(const k of ['main','alt','surprise']){
        builtRaw[k].calculationLimited=true;
        builtRaw[k].adaptiveBudgetNote='Süre korumalı plan · ayrıntılı arama tamamlanamadı; mevcut puanlarla bütçe ve ayak kapsamı hesaplandı.';
      }
      run.status='bounded_plan';run.stage='Süre korumalı üç kupon hazır';
      if(typeof run.onProgress==='function')run.onProgress({...run,onProgress:undefined});
    }else{
      run.status=error.code==='TKP_COUPON_TIMEOUT'?'timed_out':error.code==='TKP_COUPON_CANCELLED'?'cancelled':'failed';
      throw error;
    }
  }finally{
    if(typeof globalThis.tkpReleaseCouponCommentatorCache==='function')globalThis.tkpReleaseCouponCommentatorCache(commentatorCache);
    globalThis.__tkpCouponCriticalPath=previousCriticalFlag;
    if(!run.cancelled)tkpScheduleCouponLearningPrewarm(raceResults);
    run.elapsedMs=Math.max(0,tkpCouponClock()-run.started);
    globalThis.__tkpLastCouponRun={stage:run.stage,status:run.status,elapsedMs:run.elapsedMs,budgetMs:run.budgetMs,phases:run.phases||[]};
    console.info('TKP kupon süre ölçümü',JSON.stringify(globalThis.__tkpLastCouponRun));
    _tkpCouponRun=null;
  }
  return builtRaw;
}

async function tkpBuildCouponSetAdaptiveAsync(raceResults,budgets={}){
  const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const rows=Array.isArray(raceResults)?raceResults:[];
  const blocks=[];
  const policy=tkpCouponBudgetPolicy(budgets);
  const quickMain=policy.main;
  const quickKey=tkpLiveCouponCacheKey(raceResults,{main:quickMain,surprise:policy.surprise,normalMode:policy.normalMode});
  if(_tkpLiveCouponSetCache.has(quickKey)){
    const built=tkpBuildCouponSetAdaptive(raceResults,budgets),ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    globalThis.__tkpLastCouponAsyncTiming={totalMs:Math.round((ended-started)*10)/10,prepareBlocksMs:[],maxPrepareBlockMs:0,finalBuildMs:Math.round((ended-started)*10)/10,cacheHit:true};
    try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('coupon:three-coupon-build',started);}catch(_e){}
    return built;
  }
  // Sürpriz/Uzman katmanlarının kullandığı 503-dosyalık tarihsel özetleri tek
  // senkron blokta ilk kupon aşamasına bırakma. Aynı matematik küçük dilimler
  // halinde hazırlanır; sonraki sıralama çağrıları hazır önbelleği okur.
  const targetRace=rows[0]?.r||rows[0]||null;
  // Soğuk cache'de TR davranış ve BH/kazanan kombinasyonları aynı 509 yarışlık
  // eğitim penceresini iki defa seri taramasın. Ortak indeks iki cache'i tek
  // geçişte doldurur; eski fonksiyonlar geriye dönük güvenli yedektir.
  if(targetRace&&typeof tkpCouponHistoricalEvidenceSummaryAsync==='function'){
    await tkpCouponHistoricalEvidenceSummaryAsync(targetRace);
  }else{
    if(targetRace&&typeof trGanyanBehaviorSummaryAsync==='function')await trGanyanBehaviorSummaryAsync(targetRace);
    if(targetRace&&typeof tkpWinnerComboSummaryAsync==='function')await tkpWinnerComboSummaryAsync(targetRace);
  }
  // Kupon eşdeğerlik kilidi: sıralama canlı/senkron 237 motorunun çağrı sırasıyla
  // oluşturulur. P1'i burada önceden eğitmek aynı matematiğe rağmen model cache'inin
  // oluşma sırasını değiştirip Normal kuponda iki ayağın kolon dağılımını kaydırıyordu.
  // strictRankedRaceResultsAsync her ayaktan önce yield ederek aynı kanonik yolu böler.
  const preparedRanked=typeof strictRankedRaceResultsAsync==='function'?await strictRankedRaceResultsAsync(rows):strictRankedRaceResults(rows);
  // P1 modelini ayak ayak hazırla ve her ayak arasında olay kuyruğuna dön. Son
  // senkron builder aynı WeakMap/model cache'lerini okuyacağı için sonuç değişmez.
  for(let index=0;index<preparedRanked.length;index++){
    if(typeof tkpYield==='function')await tkpYield();
    const blockStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const item=preparedRanked[index],race=item?.r||item;
    if(race&&typeof altiliWinnerOrderForRace==='function')altiliWinnerOrderForRace(race,(item?.scored&&item.scored.length)?item.scored:(race.horses||[]));
    const blockEnded=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    blocks.push(Math.round((blockEnded-blockStarted)*10)/10);
    // Normal, Sürpriz ve Uzman hesaplarının ayak bazlı planlarını ayrı görevler
    // olarak hazırla. Final kupon kurucuları aynı WeakMap girdilerini okuyacağından
    // seçimler değişmez; 6 ayağın işi tek 3-4 saniyelik göreve yığılmaz.
    for(const mode of ['main','alt','surprise']){
      if(typeof tkpYield==='function')await tkpYield();
      const planStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
      if(typeof legCoveragePlan==='function')legCoveragePlan(item,mode);
      const planEnded=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
      blocks.push(Math.round((planEnded-planStarted)*10)/10);
    }
    if(typeof tkpYield==='function')await tkpYield();
    const expertStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    if(typeof tkpV55ExpertOrderForRace==='function'&&typeof dynamicSingleDecision==='function'){
      const expertOrder=tkpV55ExpertOrderForRace(race,(item?.scored&&item.scored.length)?item.scored:(race.horses||[]));
      if(expertOrder[0])dynamicSingleDecision(item,expertOrder[0],expertOrder[1]||null);
    }
    blocks.push(Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-expertStarted)*10)/10);
  }
  if(typeof tkpYield==='function')await tkpYield();
  const overviewStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  if(typeof overviewStrongLegCandidates==='function')overviewStrongLegCandidates(preparedRanked);
  blocks.push(Math.round(((typeof performance!=='undefined'&&performance.now?performance.now():Date.now())-overviewStarted)*10)/10);
  if(typeof tkpYield==='function')await tkpYield();
  const buildStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const maxMain=policy.main;
  const maxSurprise=policy.surprise;
  // Ağır winner-combo kanıtı bu noktaya gelene kadar async prewarm ile hazırdır.
  // Yalnız rafine arka plan kurulumunda bu ek kanıtın kupon koruma katmanına
  // girmesine izin ver; kritik senkron düğme yolu bu bayrağı hiç açmaz.
  const previousHistoricalEvidenceFlag=globalThis.__tkpAllowCouponHistoricalEvidence===true;
  globalThis.__tkpAllowCouponHistoricalEvidence=true;
  let builtRaw;
  try{
    builtRaw=await buildCouponSetFastAsync(raceResults,{main:maxMain,main2:maxMain,alt:0,surprise:maxSurprise,normalMode:policy.normalMode},preparedRanked);
  }finally{
    globalThis.__tkpAllowCouponHistoricalEvidence=previousHistoricalEvidenceFlag;
  }
  const built=tkpAttachAdaptiveBudgetMeta(builtRaw,maxMain,maxSurprise,policy);
  const ended=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
  const buildStages=Array.isArray(globalThis.__tkpLastCouponBuildStages)?globalThis.__tkpLastCouponBuildStages.slice():[];
  const maxBuildBlockMs=buildStages.length?Math.max(...buildStages.map(row=>Number(row?.ms)||0)):0;
  globalThis.__tkpLastCouponAsyncTiming={totalMs:Math.round((ended-started)*10)/10,prepareBlocksMs:blocks,maxPrepareBlockMs:blocks.length?Math.max(...blocks):0,buildStages,maxBuildBlockMs,finalBuildMs:Math.round((ended-buildStarted)*10)/10,cacheHit:Boolean(globalThis.__tkpLastCouponBuildMetrics?.cacheHit)};
  try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('coupon:three-coupon-build',started);}catch(_e){}
  return built;
}

function historicalCouponTypePerformance(todayRaceResults){
  const out={main:{hit:0,total:0},main2:{hit:0,total:0},alt:{hit:0,total:0},surprise:{hit:0,total:0},profiles:[]};
  const used=new Set();
  for(const x of (todayRaceResults||[])){
    const m=detailedProfileMatch(x.r,5);
    out.profiles.push({leg:x.r.leg,level:m.level,label:m.label,count:m.rows.length});
    for(const r of m.rows){
      const uid=String(r.id||r.file_id+'-'+r.leg); if(used.has(uid)) continue; used.add(uid);
      const hs=r.horses.filter(h=>!isNonRunner(h)); if(!hs.length)continue;
      const first6=hs.filter(h=>h.result_rank!=null&&h.result_rank<=6).sort((a,b)=>(a.result_rank??99)-(b.result_rank??99));
      const bmb=hs.filter(h=>h.bmb===1);
      const main=first6[0]||bmb[0]||null;
      const alt=first6[1]||bmb.find(h=>!main||h.horse_no!==main.horse_no)||main;
      const surprise=bmb[0]||first6.find(h=>h.result_rank>=3)||first6[2]||alt||main;
      for(const [k,p] of Object.entries({main,main2:main,alt,surprise})){ if(!p)continue; out[k].total++; if(p.winner)out[k].hit++; }
    }
  }
  for(const k of ['main','main2','alt','surprise']){const g=out[k];g.rate=g.total?g.hit/g.total:0;g.lb=wilson(g.hit,g.total);}
  return out;
}

function cappedCoveragePicks(r, pool, desiredCount){
  const totalCap=Math.min(9,pool.length);
  const {forced}=forceFlaggedIntoPicks(r,[],pool);
  // Sıralamadaki EN GÜÇLÜ İLK 3 ADAY (sadece 1 değil) VE bu şartlarda en güçlü geçmiş kazanan
  // (BMB/ODB) her zaman kapsamda kalması garanti edilir — zorunlu BMB/ODB eklemesinin normal
  // 4'lük kotası bunların yerini ASLA alamaz. Önceden sadece pool[0] (tek favori) garantiydi;
  // bu yüzden gerçekten güçlü AGF/TKP'li 2. ve 3. sıradaki adaylar bile zorunlu BMB eklemeleri
  // yüzünden listeden düşebiliyordu — artık düşmüyor.
  const top=pool.slice(0,3);
  const topNos=new Set(top.map(h=>String(h.horse_no)));
  const bestWinner=bestPastWinnerCandidate(r,pool);
  const guaranteed=top.slice();
  if(bestWinner && !topNos.has(String(bestWinner.horse_no))) guaranteed.push(bestWinner);
  const guaranteedNos=new Set(guaranteed.map(h=>String(h.horse_no)));
  const forcedExtra=forced.filter(h=>!guaranteedNos.has(String(h.horse_no)));
  // Hedef, garanti + zorunlu eklemelerin tamamı yer kapladığında bile en az 1 organik
  // (sıralamadaki bir sonraki en güçlü, BMB/ODB taşımayan) adaya yer bırakacak şekilde
  // genişler — aksi halde yüksek TKP skorlu ama BMB/ODB'siz güçlü bir at sessizce listeden
  // düşebiliyordu. Yine de genel tavan (9 / havuz boyutu) aşılmaz.
  const minWithBase=guaranteed.length+forcedExtra.length+1;
  const target=Math.min(Math.max(desiredCount,4,minWithBase),totalCap);
  const remainingAfterGuaranteed=Math.max(0,target-guaranteed.length);
  const forcedTake=forcedExtra.slice(0,remainingAfterGuaranteed);
  const usedNos=new Set([...guaranteedNos,...forcedTake.map(h=>String(h.horse_no))]);
  const slotsForBase=Math.max(0,target-guaranteed.length-forcedTake.length);
  const basePicks=pool.filter(h=>!usedNos.has(String(h.horse_no))).slice(0,slotsForBase);
  return {picks:guaranteed.concat(forcedTake,basePicks), forced:forcedTake};
}

function historicalCoveragePlan(x){
  // Kayıtlı yarışta Ayak Önerisi canlı kupon motorunu yeniden çalıştırmaz. Arşiv
  // skor/sıra snapshot'ı zaten dondurulmuş kanıttır; legCoveragePlan() burada
  // adaptif ağırlıkları ve tüm tarihsel havuzu tekrar tararsa sekme tıklaması
  // dakikalarca kilitlenir. Aynı görünür planı frozen sıra + (varsa) kayıtlı
  // kupon seçiminden kur, canlı yolun aşağıdaki hesabına hiç dokunma.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x)){
    const ordered=typeof tkpArchivedOrderedRows==='function'
      ?tkpArchivedOrderedRows(x)
      :(x?.scored||x?.r?.horses||[]).filter(h=>h&&!isNonRunner(h)).slice();
    if(!ordered.length) return {picks:[],count:0,coverage:0,sample:0,level:'Kayıtlı ODS',reason:'Kayıtlı aday yok',singleDecision:null,orderedPool:[]};
    let savedPicks=[];
    try{
      const coupons=typeof activeCoupons!=='undefined'?activeCoupons:null;
      const leg=coupons?.main?.legs?.find(z=>z?.r&&Number(z.r.leg)===Number(x?.r?.leg));
      const nos=new Set((leg?.picks||[]).map(h=>String(h?.horse_no||'')));
      if(nos.size) savedPicks=ordered.filter(h=>nos.has(String(h?.horse_no||'')));
    }catch(_){ }
    const first=savedPicks[0]||ordered[0],second=savedPicks[1]||ordered.find(h=>String(h?.horse_no)!==String(first?.horse_no))||null;
    let singleDecision=typeof dynamicSingleDecision==='function'
      ?dynamicSingleDecision({...x,scored:ordered},first,second)
      :{isSingle:savedPicks.length===1,confidence:0,threshold:68,reason:'Kayıtlı snapshot'};
    if(savedPicks.length===1) singleDecision={...singleDecision,isSingle:true,reason:'Kayıtlı kupon TEK snapshotı · güncel model taranmadı'};
    // Arşivde Ayak Önerisi kayıtlı kuponun bütçe genişliğine kilitlenmez.
    // Karışık/zor ayakta TKP'si 0,85 ve üzeri olan tüm adaylar görünür kalır;
    // kayıtlı kupon seçimleri de korunur ve sonuç sonrası öneri daralmaz.
    const strongFloor=ordered.filter(h=>Number(h?.score)>=0.85);
    const pickNos=new Set([...savedPicks,...strongFloor].map(h=>String(h?.horse_no||'')));
    const picks=ordered.filter(h=>pickNos.has(String(h?.horse_no||'')));
    return {
      picks,count:picks.length,coverage:Number(singleDecision?.confidence)||0,
      sample:0,level:'Kayıtlı yarış-öncesi snapshot',singleDecision,
      orderedPool:ordered,leaderFloorCount:picks.length,moneySignalPicks:[],
      protectMoneySignals:false,reliable:!!singleDecision?.isSingle,
      reason:singleDecision?.reason||'Kayıtlı yarış öncesi snapshotı · güncel model taranmadı'
    };
  }
  // KRİTİK (V25.6 düzeltmesi): Ayak Önerisi paneli artık kendi pool/count/TEK
  // mantığını YENİDEN HESAPLAMAZ. Önceki sürümde bu fonksiyon strictCandidatePool +
  // predictionDisplayRows'tan kendi havuzunu, geçmiş kazanma dağılımından kendi
  // kapsama sayısını (min 4/max 7) ve argümansız dynamicSingleDecision(x)'ten kendi
  // TEK kararını üretiyordu -- Normal Kupon'un (legCoveragePlan mode='main')
  // kullandığı strategicOrderForRace havuzu, dynamicCoverageCount (min 2/max 8) ve
  // argümanlı dynamicSingleDecision'dan TAMAMEN BAĞIMSIZDI. Sonuç: Genel Bakış'ta
  // "6 AT YAZILMALI: 6/3/1/8/9/12" gösterilirken Normal Kupon "8/9/1/12" yazabiliyordu.
  // Artık tek gerçek kaynak legCoveragePlan(x,'main'); bu fonksiyon sadece onun
  // çıktısını görüntüleme biçimine çeviriyor.
  const built=legCoveragePlan(x,'main');
  if(!built.picks.length) return {picks:[],count:0,coverage:0,sample:0,level:'Veri yok',reason:'Uygun aday yok',singleDecision:null};

  const singleDecision=built.singleDecision||dynamicSingleDecision(x,built.picks[0],built.picks[1]||null,built.strength,built.margin);
  const picks=built.picks;

  if(singleDecision.isSingle){
    return {
      picks:picks.slice(0,1),
      count:1,
      coverage:singleDecision.confidence,
      sample:singleDecision.sample,
      level:singleDecision.level,
      reason:`Güven %${singleDecision.confidence} · dinamik tek eşiği %${singleDecision.threshold} · ${singleDecision.reason}`,
      singleDecision
    };
  }

  return {
    picks,
    count:picks.length,
    coverage:singleDecision.confidence,
    sample:singleDecision.sample,
    level:singleDecision.level,
    reason:built.reason,
    singleDecision
  };
}

function recalcCouponCost(res){
  // An empty leg has no payable combinations; the empty product is not a ticket.
  res.combos = res.legs.length ? res.legs.reduce((m,l)=>m*l.picks.length,1) : 0;
  res.cost = res.unit>0 ? res.unit*res.combos : 0;
  res.leftover = round2ish((res.budgetTL||0)-res.cost);
  // FIX (V1.1.212): adaptiveBudgetNote ("Zorluk hedefi: X TL · Maliyet: X TL") kupon
  // ilk üretildiğinde tkpBuildCouponSetAdaptive() içinde bir kez donduruluyordu.
  // Manuel at ekle/çıkar sonrası res.cost değişse de bu not eskisini gösteriyordu
  // (kart üstü ile compactFoot arasında maliyet uyuşmazlığı). Not artık her
  // maliyet yeniden hesaplandığında aynı formatla tazeleniyor.
  if(res.adaptiveBudgetNote!=null&&!res.readOnlySnapshot){
    const target=Number(res.dynamicBudgetTargetTL||res.budgetTL)||1000;
    res.adaptiveBudgetNote=`Zorluk hedefi: ${round2ish(target)} TL · Aralık: 1.000–1.400 TL · Maliyet: ${round2ish(Number(res.cost)||0)} TL`;
  }
}

let _tkpManualCouponSideBetRefreshTimer=0;
let _tkpManualCouponSideBetIdleHandle=0;
function scheduleManualCouponSideBetRefresh(){
  // Manuel kupon tıklamasının kritik yolunda ağır yan-bahis hesabı çalıştırma.
  // Hızlı ardışık ekle/çıkar işlemlerini tek yenilemede birleştir; görünür yan bahis
  // paneli daha sonra boş zamanda güncellenir. Kupon kartı ve maliyet ise anında günceldir.
  if(_tkpManualCouponSideBetRefreshTimer) clearTimeout(_tkpManualCouponSideBetRefreshTimer);
  if(_tkpManualCouponSideBetIdleHandle && typeof cancelIdleCallback==='function'){
    try{ cancelIdleCallback(_tkpManualCouponSideBetIdleHandle); }catch(_){ }
    _tkpManualCouponSideBetIdleHandle=0;
  }
  _tkpManualCouponSideBetRefreshTimer=setTimeout(()=>{
    _tkpManualCouponSideBetRefreshTimer=0;
    const run=()=>{
      _tkpManualCouponSideBetIdleHandle=0;
      if(typeof refreshRenderedSideBetPanel==='function') refreshRenderedSideBetPanel();
      if(typeof tkpRefreshOpportunityPanels==='function') tkpRefreshOpportunityPanels();
    };
    if(typeof tkpRunWhenUserIdle==='function'){
      _tkpManualCouponSideBetIdleHandle=0;
      tkpRunWhenUserIdle(run,{minIdleMs:650,retryMs:100,maxWaitMs:3000});
    }else{
      setTimeout(run,100);
    }
  },45);
}

function tkpCouponLeg(typeKey,legNo){
  const res=activeCoupons&&activeCoupons[typeKey];
  return res?.legs?.find(l=>Number(l?.r?.leg)===Number(legNo))||null;
}
function tkpCouponLegIsSingle(typeKey,legNo){
  const leg=tkpCouponLeg(typeKey,legNo);
  return !!leg && Array.isArray(leg.picks) && leg.picks.length===1;
}
function tkpCouponMeetingLocked(raceResults,now=new Date()){
  const races=(raceResults||[]).map(x=>x?.r||x).filter(Boolean);
  if(!races.length)return false;
  if(races.some(r=>typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(r?.horses||[])))return true;
  const starts=[];
  for(const r of races){
    const date=String(r?.race_date||r?.date||'').trim();
    const time=String(r?.tjk_race_time||r?.race_time||r?.start_time||r?.time||'').trim();
    const tm=time.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);if(!tm)continue;
    let y,m,d;const iso=date.match(/^(\d{4})-(\d{2})-(\d{2})/),tr=date.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    if(iso){y=+iso[1];m=+iso[2];d=+iso[3];}else if(tr){y=+tr[3];m=+tr[2];d=+tr[1];}else continue;
    const start=new Date(y,m-1,d,+tm[1],+tm[2],0,0);if(!Number.isNaN(start.getTime()))starts.push(start.getTime());
  }
  return starts.length?now.getTime()>=Math.min(...starts):false;
}
// R16.46: Toplantının ilk ayağı başladı diye kullanıcıyı geçmiş/replay kuponuna
// zorlamıyoruz. "Kupon Oluştur" mevcut yarış-öncesi snapshotın yalnız henüz
// başlamamış ayaklarını göstermeli. Başlangıç saati bilinmeyen ve sonucu olmayan
// ayak fail-open kalır; kanıt olmadan "bitti" diye gizlenmez.
function tkpCouponRaceStartMs(r){
  r=r?.r||r||{};
  const date=String(r?.race_date||r?.date||'').trim();
  const time=String(r?.tjk_race_time||r?.race_time||r?.start_time||r?.time||'').trim();
  const tm=time.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/);if(!tm)return null;
  let y,m,d;const iso=date.match(/^(\d{4})-(\d{2})-(\d{2})/),tr=date.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if(iso){y=+iso[1];m=+iso[2];d=+iso[3];}else if(tr){y=+tr[3];m=+tr[2];d=+tr[1];}else return null;
  const ms=new Date(y,m-1,d,+tm[1],+tm[2],0,0).getTime();
  return Number.isFinite(ms)?ms:null;
}
function tkpCouponRaceIsUpcoming(r,now=new Date()){
  r=r?.r||r||{};
  if(typeof raceHasConfirmedResult==='function'&&raceHasConfirmedResult(r?.horses||[]))return false;
  const start=tkpCouponRaceStartMs(r);return start==null?true:start>now.getTime();
}
function tkpCouponUpcomingRaceResults(raceResults,now=new Date()){
  return (raceResults||[]).filter(x=>tkpCouponRaceIsUpcoming(x,now));
}
function tkpTrimActiveCouponsToUpcoming(raceResults,now=new Date()){
  const upcoming=tkpCouponUpcomingRaceResults(raceResults,now);
  const upcomingLegs=new Set(upcoming.map(x=>Number((x?.r||x)?.leg)).filter(Number.isFinite));
  const allLegs=(raceResults||[]).map(x=>Number((x?.r||x)?.leg)).filter(Number.isFinite);
  const hidden=allLegs.filter(leg=>!upcomingLegs.has(leg));
  for(const key of ['main','alt','surprise']){
    const res=activeCoupons?.[key];if(!res||res.error||!Array.isArray(res.legs))continue;
    res.legs=res.legs.filter(leg=>upcomingLegs.has(Number(leg?.r?.leg)));
    res.readOnlySnapshot=true;res.remainingRaceView=true;res.hiddenStartedLegs=hidden.slice();
    const prefix=hidden.length?`⏱️ Kalan yarışlar · başlayan/biten ${hidden.length} ayak gizlendi`:'⏱️ Henüz başlamamış yarışlar';
    const original=String(res.adaptiveBudgetNote||'').trim();
    res.adaptiveBudgetNote=original?`${prefix} · ${original}`:prefix;
  }
  return {count:upcoming.length,upcomingLegs:[...upcomingLegs],hiddenLegs:hidden,results:upcoming};
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpCouponRaceStartMs=tkpCouponRaceStartMs;
  globalThis.tkpCouponRaceIsUpcoming=tkpCouponRaceIsUpcoming;
  globalThis.tkpCouponUpcomingRaceResults=tkpCouponUpcomingRaceResults;
  globalThis.tkpTrimActiveCouponsToUpcoming=tkpTrimActiveCouponsToUpcoming;
}
function tkpPersistFinalCouponSnapshot(){
  try{
    if(!lastRaceResults?.length || tkpCouponMeetingLocked(lastRaceResults) || typeof saveAutomaticCouponSnapshot!=='function')return false;
    const budgets=typeof _v24ReadBudgets==='function'?_v24ReadBudgets():{};
    return saveAutomaticCouponSnapshot(lastRaceResults,activeCoupons,budgets,'SON_KUPON');
  }catch(_e){return false;}
}
function addHorseToCouponLeg(typeKey, legNo, horseNo){
  if(tkpCouponMeetingLocked(lastRaceResults))return false;
  const res=activeCoupons[typeKey];
  if(!res || !res.legs) return false;
  const leg=res.legs.find(l=>Number(l.r.leg)===Number(legNo));
  if(!leg) return false;
  if(leg.picks.some(p=>String(p.horse_no)===String(horseNo))) return false;
  const horse=(leg.allHorses||[]).find(h=>String(h.horse_no)===String(horseNo) && !isNonRunner(h));
  if(!horse) return false;
  leg.picks=dedupeEkuri(leg.picks.concat([horse]), leg.r, typeKey);
  recalcCouponCost(res);
  renderCouponCard(typeKey);
  if(typeof refreshRecommendedHorsePanelsFromCoupon==='function') refreshRecommendedHorsePanelsFromCoupon();
  scheduleManualCouponSideBetRefresh();
  tkpPersistFinalCouponSnapshot();
  return true;
}
function addHorseToCouponLegFromBH(typeKey,legNo,horseNo){
  if(tkpCouponLegIsSingle(typeKey,legNo))return false;
  return addHorseToCouponLeg(typeKey,legNo,horseNo);
}
function addHorseToAllCoupons(legNo,horseNo){
  let added=0;
  for(const typeKey of ['main','main2','surprise']){
    // V55: Geniş kupon kaldırıldı. Manuel BH override üç canlı kupona uygulanır;
    // otomatik TEK motorunun yarış-öncesi kuralı değişmez.
    if(addHorseToCouponLeg(typeKey,legNo,horseNo))added++;
  }
  if(added)tkpPersistFinalCouponSnapshot();
  return added;
}
function tkpHorseInAnyActiveCouponLeg(legNo,horseNo){
  return ['main','main2','surprise'].some(typeKey=>{
    const leg=tkpCouponLeg(typeKey,legNo);
    return !!leg?.picks?.some(h=>String(h?.horse_no)===String(horseNo));
  });
}

function removeHorseFromCouponLeg(typeKey, legNo, horseNo){
  if(tkpCouponMeetingLocked(lastRaceResults))return false;
  const res=activeCoupons[typeKey];
  if(!res || !res.legs) return false;
  const leg=res.legs.find(l=>Number(l.r.leg)===Number(legNo));
  if(!leg || leg.picks.length<=1) return false; // en az 1 at kalmalı
  leg.picks=leg.picks.filter(p=>String(p.horse_no)!==String(horseNo));
  recalcCouponCost(res);
  renderCouponCard(typeKey);
  if(typeof refreshRecommendedHorsePanelsFromCoupon==='function') refreshRecommendedHorsePanelsFromCoupon();
  scheduleManualCouponSideBetRefresh();
  tkpPersistFinalCouponSnapshot();
  return true;
}

function syncCouponRowHeights(){
  const containers=Array.from(document.querySelectorAll('#budgetCouponResult [id^="couponCard-"]'))
    .filter(c=>c&&c.querySelector&&c.querySelector('tr[data-leg]'));
  if(containers.length<2) return;
  const syncGroup=(selector)=>{
    const nodes=containers.map(c=>c.querySelector(selector)).filter(Boolean);
    if(nodes.length<2) return;
    nodes.forEach(el=>{ el.style.height=''; el.style.minHeight=''; });
    let max=0;
    nodes.forEach(el=>{ max=Math.max(max, el.offsetHeight||0); });
    if(max>0) nodes.forEach(el=>{ el.style.height=max+'px'; el.style.minHeight=max+'px'; });
  };
  syncGroup('.couponTopBlock');
  const rowsByLeg=new Map();
  containers.forEach(c=>{
    c.querySelectorAll('tr[data-leg]').forEach(tr=>{
      tr.style.height=''; tr.style.minHeight='';
      const leg=tr.dataset.leg;
      if(!rowsByLeg.has(leg)) rowsByLeg.set(leg,[]);
      rowsByLeg.get(leg).push(tr);
    });
  });
  rowsByLeg.forEach(rows=>{
    let max=0;
    rows.forEach(tr=>{ max=Math.max(max, tr.offsetHeight||0); });
    if(max>0) rows.forEach(tr=>{ tr.style.height=max+'px'; tr.style.minHeight=max+'px'; });
  });
  syncGroup('.compactFoot');
  syncGroup('.couponFinanceBox');
  syncGroup('.v55ExpertEvidence');
}

function sideBetPoolAt(nos, posIndex, width){ return nos.slice(0, width); }

// Yan bahis geçmişi iki ayrı kanıttır: yarış öncesi saat-kilitli canlı kayıtlar
// üretim terfisine girebilir; sonradan arşivden yeniden kurulmuş kayıtlar yalnız
// araştırma/karşılaştırma içindir. Aynı gün ve hipodromda birden çok Altılı varsa
// yalnız tarih+hipodrom+ayak ile eşleştirmek de sessiz çapraz toplantı karışımına
// yol açar; bu nedenle kalıcı toplantı kimliği zorunlu olarak anahtara katılır.
function sideBetLogMeetingKey(rec={}){
  return String(rec.meeting_uid||rec.file_id||rec.race_uid||[
    rec.race_date||rec.meeting_date||'',fold(rec.hippodrome||''),Number(rec.altili_no)||1
  ].join('|'));
}
function sideBetLogEvidenceClass(rec={}){
  return String(rec.evidence_class||rec.prediction_snapshot_provenance||'HISTORICAL_RECONSTRUCTED').toLocaleUpperCase('tr-TR');
}
function sideBetLivePreRaceLocked(rec={}){
  const evidence=sideBetLogEvidenceClass(rec);
  const captured=Date.parse(String(rec.captured_at||'')),start=Date.parse(String(rec.race_start_at||''));
  return evidence==='LIVE_PRE_RACE_LOCKED' && rec.immutable_snapshot_hash && Number.isFinite(captured) && Number.isFinite(start) && captured<start;
}

function _sideBetPredictionLogBaseGroups(){
  // Hedef ayaktan (leg) bağımsız kısım: tüm prediction_log'u tara, fingerprint
  // bazlı grupla. Bu adım pahalıdır (tüm kayıtlar üzerinde tarama+gruplama);
  // artık yalnızca prediction_log değiştiğinde yeniden hesaplanır, her ayak
  // için tekrar tekrar çalışmaz.
  ensurePredictionLog();
  const log=db.prediction_log||[];
  const currentStrategy=typeof TKP_SIDE_BET_STRATEGY_VERSION==='string'
    ? TKP_SIDE_BET_STRATEGY_VERSION
    : 'V33-SIDE-BET-EXACT-P1-P5';
  const revision=typeof sideBetPredictionLogRevisionSignature==='function'
    ? sideBetPredictionLogRevisionSignature(db) : String(log.length);
  const cacheKey=revision+'|'+currentStrategy;
  if(_predictionLogGroupsCache.key===cacheKey && _predictionLogGroupsCache.races){
    return {currentStrategy,races:_predictionLogGroupsCache.races};
  }
  const allRows=log.filter(x=>x.resolved===1 && Number(x.finish_position)>=1 && Number(x.finish_position)<=5);
  // İstatistik ve karşılaştırma tabloları yüklenen TÜM doğrulanmış tahmin
  // kayıtlarından güncellenir. Canlı terfi kapısı yine ayrı tutulur; tarihsel
  // olarak sonradan kurulmuş kayıtlar gerçek-para canlı kanıtı gibi sayılmaz.
  // Eski sürüm kayıtlarını yalnız yeni strategy_version bulunduğunda dışlamak,
  // 298/509 arşivinin büyük bölümünü sessizce yok sayıyordu.
  const candidateRows=allRows;
  const liveRows=candidateRows.filter(sideBetLivePreRaceLocked);
  const rows=candidateRows;
  const researchOnly=rows.some(row=>!sideBetLivePreRaceLocked(row));
  const groups=new Map();
  for(const rec of rows){
    const key=[sideBetLogMeetingKey(rec),rec.prediction_fp||'',rec.race_date||'',fold(rec.hippodrome||''),rec.leg].join('|');
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(rec);
  }
  const races=[...groups.values()].filter(g=>g.some(x=>Number(x.finish_position)===1));
  _predictionLogGroupsCache.key=cacheKey;
  _predictionLogGroupsCache.currentStrategy=currentStrategy;
  _predictionLogGroupsCache.races=races;
  return {currentStrategy,races,researchOnly,liveEligible:liveRows.length>0&&liveRows.length===rows.length,liveRows:liveRows.length,allRows:rows.length};
}

function sideBetPredictionLogBacktest(targetRace){
  const base=_sideBetPredictionLogBaseGroups();
  let races=base.races;
  if(targetRace){
    const hip=fold(targetRace.hippodrome||''), cond=fold(targetRace.condition_family||''), surf=fold(targetRace.surface||''), breed=fold(targetRace.breed||''), dist=Number(targetRace.distance)||0;
    const exact=races.filter(g=>{
      const a=g[0]||{};
      return (!hip||fold(a.hippodrome||'')===hip) && (!cond||!a.condition_family||fold(a.condition_family)===cond) && (!surf||!a.surface||fold(a.surface)===surf) && (!breed||!a.breed||fold(a.breed)===breed) && (!dist||!a.distance||Math.abs(Number(a.distance)-dist)<=200);
    });
    const hipOnly=races.filter(g=>!hip||fold((g[0]||{}).hippodrome||'')===hip);
    races=exact.length?exact:hipOnly;
  }
  const out={ikili:{ok:0,total:0},sirali:{ok:0,total:0},uclu:{ok:0,total:0},dortlu:{ok:0,total:0},sirali5li:{ok:0,total:0}};
  for(const g of races){
    const ord=g.slice().sort((a,b)=>{
      const ra=Number(a.predicted_rank)||999, rb=Number(b.predicted_rank)||999;
      if(ra!==rb) return ra-rb;
      if(Number(b.score)!==Number(a.score)) return Number(b.score)-Number(a.score);
      return TKP_TR_COLLATOR_NUM.compare(String(a.horse_no),String(b.horse_no));
    });
    const nos=ord.map(x=>String(x.horse_no));
    const positionNos=position=>{
      const field='sidebet_rank_p'+position;
      const hasExact=g.some(row=>Number(row?.[field])>0);
      if(!hasExact) return nos;
      return g.slice().sort((a,b)=>
        (Number(a?.[field])||999)-(Number(b?.[field])||999)
        || (Number(a.predicted_rank)||999)-(Number(b.predicted_rank)||999)
      ).map(row=>String(row.horse_no));
    };
    const pNos={p1:positionNos(1),p2:positionNos(2),p3:positionNos(3),p4:positionNos(4),p5:positionNos(5)};
    const fin=g.slice().sort((a,b)=>Number(a.finish_position)-Number(b.finish_position));
    const f1=fin.find(x=>Number(x.finish_position)===1), f2=fin.find(x=>Number(x.finish_position)===2), f3=fin.find(x=>Number(x.finish_position)===3), f4=fin.find(x=>Number(x.finish_position)===4), f5=fin.find(x=>Number(x.finish_position)===5);
    if(f1&&f2){
      const p1=pNos.p1.slice(0,5), p2=pNos.p2.slice(0,5);
      out.ikili.total++; if((p1.includes(String(f1.horse_no))&&p2.includes(String(f2.horse_no)))||(p1.includes(String(f2.horse_no))&&p2.includes(String(f1.horse_no)))) out.ikili.ok++;
      out.sirali.total++; if(p1.includes(String(f1.horse_no))&&p2.includes(String(f2.horse_no))) out.sirali.ok++;
    }
    if(f1&&f2&&f3){
      const p1=pNos.p1.slice(0,5), p2=pNos.p2.slice(0,5), p3=pNos.p3.slice(0,5);
      out.uclu.total++;if(p1.includes(String(f1.horse_no))&&p2.includes(String(f2.horse_no))&&p3.includes(String(f3.horse_no)))out.uclu.ok++;
    }
    if(f1&&f2&&f3&&f4){
      const p1=pNos.p1.slice(0,5), p2=pNos.p2.slice(0,5), p3=pNos.p3.slice(0,5), p4=pNos.p4.slice(0,7);
      out.dortlu.total++;if(p1.includes(String(f1.horse_no))&&p2.includes(String(f2.horse_no))&&p3.includes(String(f3.horse_no))&&p4.includes(String(f4.horse_no)))out.dortlu.ok++;
    }
    if(f1&&f2&&f3&&f4&&f5){
      const p1=pNos.p1.slice(0,5), p2=pNos.p2.slice(0,5), p3=pNos.p3.slice(0,5), p4=pNos.p4.slice(0,7), p5=pNos.p5.slice(0,9);
      out.sirali5li.total++;if(p1.includes(String(f1.horse_no))&&p2.includes(String(f2.horse_no))&&p3.includes(String(f3.horse_no))&&p4.includes(String(f4.horse_no))&&p5.includes(String(f5.horse_no)))out.sirali5li.ok++;
    }
  }
  for(const g of Object.values(out)){g.rate=g.total?g.ok/g.total:0;g.ready=g.total>=SIDE_BET_MIN_RACES;}
  const researchOnly=base.researchOnly===true;
  out._profile={level:researchOnly?'Tarihsel araştırma':'Saat-kilitli canlı tahmin',label:researchOnly?'Arşivden yeniden kurulmuş sonuçlar':'Yarış öncesi kilitli tahmin sonuçları',rows:races,source:researchOnly?'historical_research':'live_pre_race_locked',researchOnly,liveEligible:!researchOnly};
  return out;
}

// Canlı Yan Bahis paneli yalnız yarıştan önce kaydedilip daha sonra gerçek sonuçla
// çözülen tahminleri kullanır. Ağır tarihsel yeniden-puanlama Back Test'te kalır.
function sideBetPanelStatsFast(targetRace){
  const revision=typeof sideBetPredictionLogRevisionSignature==='function'
    ? sideBetPredictionLogRevisionSignature(db) : String((db?.prediction_log||[]).length);
  const cacheKey=`PANEL_STATS|${revision}|${sideBetCacheKey(targetRace)}`;
  if(_sideBetPanelStatsCache.has(cacheKey)) return _sideBetPanelStatsCache.get(cacheKey);
  const logged=sideBetPredictionLogBacktest(targetRace);
  const out={};
  for(const key of ['ikili','sirali','uclu','dortlu','sirali5li']){
    const g=logged?.[key]||{};
    out[key]={ok:Number(g.ok)||0,total:Number(g.total)||0,rate:Number(g.rate)||0,ready:!!g.ready&&!(logged?._profile?.researchOnly)};
  }
  out._profile=logged?._profile||{level:'Kayıtlı tahmin bekleniyor',label:'Gerçek tahmin sonucu yok',rows:[],source:'prediction_log'};
  _sideBetPanelStatsCache.set(cacheKey,out);
  return out;
}

function tkpOptimizeVerifiedBetCombinations(){
  // Yalnız yarıştan önce kaydedilip sonuçla çözülmüş prediction_log kullanılır.
  // Aday seçimi kronolojik train/validation'da yapılır; son %20 holdout'a bir kez
  // bakılır. Holdout kanıtı mevcut ayardan iyi değilse üretim ayarı değişmez.
  const groups=(_sideBetPredictionLogBaseGroups().races||[]).slice().sort((a,b)=>{
    const aa=a?.[0]||{},bb=b?.[0]||{};return String(aa.race_date||'').localeCompare(String(bb.race_date||''))||TKP_TR_COLLATOR.compare(fold(aa.hippodrome||''),fold(bb.hippodrome||''))||(Number(aa.leg)||0)-(Number(bb.leg)||0);
  });
  const wilson=(ok,total,z=1.96)=>{if(!total)return 0;const p=ok/total,zz=z*z,den=1+zz/total;return (p+zz/(2*total)-z*Math.sqrt((p*(1-p)+zz/(4*total))/total))/den;};
  const rankNos=(group,pos)=>{
    const field='sidebet_rank_p'+pos,has=(group||[]).some(row=>Number(row?.[field])>0);
    return (group||[]).slice().sort((a,b)=>(has?((Number(a?.[field])||999)-(Number(b?.[field])||999)):((Number(a?.predicted_rank)||999)-(Number(b?.predicted_rank)||999)))||Number(b?.score||0)-Number(a?.score||0)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no),String(b?.horse_no))).map(row=>String(row.horse_no));
  };
  const actualSequences=(group,n)=>{
    const byPos={};for(const row of (group||[])){const p=Number(row?.finish_position);if(p>=1&&p<=n)(byPos[p]||(byPos[p]=[])).push(String(row.horse_no));}
    if(Array.from({length:n},(_,i)=>byPos[i+1]?.length).some(v=>!v))return [];
    let out=[[]];for(let p=1;p<=n;p++){const next=[];for(const cur of out)for(const no of byPos[p])next.push(cur.concat(no));out=next;}return out;
  };
  const combinationCount=pools=>{let count=0;const walk=(i,used)=>{if(i>=pools.length){count++;return;}for(const no of pools[i])if(!used.has(no)){const next=new Set(used);next.add(no);walk(i+1,next);}};walk(0,new Set());return count;};
  const candidateSets={
    sirali:[[3,4],[4,5],[5,5],[5,6],[6,7]],
    triple:[[3,4,5],[4,5,6],[5,6,7],[5,7,8],[6,7,9]],
    quartet:[[2,4,5,7],[3,5,6,9],[4,6,7,10],[5,7,8,10]],
    quintet:[[1,4,4,5,7],[2,5,5,6,8],[3,5,6,7,9],[3,6,7,8,10]]
  };
  const splitRows=rows=>{const a=Math.floor(rows.length*.60),b=Math.floor(rows.length*.80);return {train:rows.slice(0,a),validation:rows.slice(a,b),holdout:rows.slice(b)};};
  const evaluate=(rows,widths)=>{let total=0,hit=0,combos=0;for(const group of rows){const seqs=actualSequences(group,widths.length);if(!seqs.length)continue;const pools=widths.map((w,i)=>rankNos(group,i+1).slice(0,w));if(pools.some(p=>!p.length))continue;total++;combos+=combinationCount(pools);if(seqs.some(seq=>seq.every((no,i)=>pools[i].includes(no))))hit++;}return {total,hit,rate:total?hit/total:0,wilsonLower:wilson(hit,total),avgCombinations:total?combos/total:0};};
  const recommendations={};
  for(const product of ['sirali','triple','quartet','quintet']){
    const fallback=tkpEffectiveSideBetWidths(product),candidates=candidateSets[product];
    if(!candidates.some(w=>w.join(',')===fallback.join(',')))candidates.push(fallback);
    const split=splitRows(groups),tested=candidates.map(widths=>({widths:[...widths],train:evaluate(split.train,widths),validation:evaluate(split.validation,widths),holdout:evaluate(split.holdout,widths)}));
    const viable=tested.filter(x=>x.train.total>0&&x.validation.total>0).sort((a,b)=>(b.validation.wilsonLower-Math.log1p(b.validation.avgCombinations)*.012)-(a.validation.wilsonLower-Math.log1p(a.validation.avgCombinations)*.012));
    const selected=viable[0]||tested.find(x=>x.widths.join(',')===fallback.join(','))||tested[0],baseline=tested.find(x=>x.widths.join(',')===fallback.join(','))||selected;
    const h=selected.holdout,base=baseline.holdout,changed=selected.widths.join(',')!==fallback.join(',');
    const accepted=Boolean(changed&&h.total>0&&((h.wilsonLower>=base.wilsonLower&&h.rate>=base.rate&&h.avgCombinations<=base.avgCombinations*1.25)||(h.wilsonLower>=base.wilsonLower+.03&&h.avgCombinations<=base.avgCombinations*1.10)));
    recommendations[product]={accepted,leakageSafe:true,widths:accepted?selected.widths:fallback,candidateWidths:selected.widths,baselineWidths:fallback,holdoutSample:h.total,holdout:h,baselineHoldout:base,reason:accepted?'Kronolojik holdout iyileşmesi doğrulandı':'Holdout üstünlüğü kanıtlanmadı; mevcut ayar korundu',tested};
  }
  // Çifte iki ardışık koşudur; aynı sıralama kanıtıyla ayrı değerlendirilir.
  const byMeeting=new Map();for(const group of groups){const a=group?.[0]||{},key=`${a.race_date||''}|${fold(a.hippodrome||'')}`;if(!byMeeting.has(key))byMeeting.set(key,new Map());byMeeting.get(key).set(Number(a.leg)||0,group);}
  const pairs=[];for(const legs of byMeeting.values())for(const [leg,a] of legs){const b=legs.get(Number(leg)+1);if(b)pairs.push([a,b]);}
  const evalDouble=(rows,widths)=>{let total=0,hit=0,combos=0;for(const [a,b] of rows){const sa=actualSequences(a,1),sb=actualSequences(b,1);if(!sa.length||!sb.length)continue;const p1=rankNos(a,1).slice(0,widths[0]),p2=rankNos(b,1).slice(0,widths[1]);total++;combos+=p1.length*p2.length;if(sa.some(x=>p1.includes(x[0]))&&sb.some(x=>p2.includes(x[0])))hit++;}return {total,hit,rate:total?hit/total:0,wilsonLower:wilson(hit,total),avgCombinations:total?combos/total:0};};
  {const fallback=tkpEffectiveSideBetWidths('cifte'),candidates=[[3,3],[4,4],[4,5],[5,5],[5,6],[6,6]],split=splitRows(pairs),tested=candidates.map(widths=>({widths,train:evalDouble(split.train,widths),validation:evalDouble(split.validation,widths),holdout:evalDouble(split.holdout,widths)})),selected=tested.filter(x=>x.train.total>0&&x.validation.total>0).sort((a,b)=>(b.validation.wilsonLower-Math.log1p(b.validation.avgCombinations)*.012)-(a.validation.wilsonLower-Math.log1p(a.validation.avgCombinations)*.012))[0]||tested.find(x=>x.widths.join(',')===fallback.join(',')),baseline=tested.find(x=>x.widths.join(',')===fallback.join(','))||selected,h=selected?.holdout||{},base=baseline?.holdout||{},changed=selected&&selected.widths.join(',')!==fallback.join(','),accepted=Boolean(changed&&h.total>0&&h.wilsonLower>=base.wilsonLower&&h.rate>=base.rate&&h.avgCombinations<=base.avgCombinations*1.25);recommendations.cifte={accepted,leakageSafe:true,widths:accepted?selected.widths:fallback,candidateWidths:selected?.widths||fallback,baselineWidths:fallback,holdoutSample:h.total||0,holdout:h,baselineHoldout:base,reason:accepted?'Kronolojik holdout iyileşmesi doğrulandı':'Holdout üstünlüğü kanıtlanmadı; mevcut ayar korundu',tested};}
  return {version:'V1-CHRONO-HOLDOUT',createdAt:new Date().toISOString(),predictionGroups:groups.length,method:{train:.60,validation:.20,holdout:.20,minimumHoldout:1,leakageRule:'Yalnız sonuçtan önce kaydedilmiş prediction_log sıraları'},recommendations};
}
if(typeof globalThis!=='undefined')globalThis.tkpOptimizeVerifiedBetCombinations=tkpOptimizeVerifiedBetCombinations;

function learnedSideBetWidthFast(n,targetRace){
  const revision=typeof sideBetPredictionLogRevisionSignature==='function'
    ? sideBetPredictionLogRevisionSignature(db) : String((db?.prediction_log||[]).length);
  const cacheKey=`FASTW${n}|${sideBetCacheKey(targetRace)}|${revision}`;
  if(_sideBetWidthCache.has(cacheKey)) return _sideBetWidthCache.get(cacheKey);
  const stats=sideBetPanelStatsFast(targetRace);
  const metric=n===3?stats.uclu:(n===4?stats.dortlu:stats.sirali5li);
  const sample=Number(metric?.total)||0, rate=Number(metric?.rate)||0;
  let base=5;
  if(sample>=SIDE_BET_MIN_RACES){
    if(rate<0.55) base=7;
    else if(rate<0.72) base=6;
    else if(rate>0.88) base=4;
  }
  const widths=Array.from({length:n},(_,i)=>base+i);
  if(n===3){ widths[0]=Math.max(widths[0],5); widths[1]=Math.max(widths[1],6); widths[2]=Math.max(widths[2],8); }
  if(n===4){ widths[0]=Math.max(widths[0],5); widths[1]=Math.max(widths[1],7); widths[2]=Math.max(widths[2],8); widths[3]=Math.max(widths[3],10); }
  const out={widths,rate:sample?rate:null,sample,w:base,learned:sample>=SIDE_BET_MIN_RACES,level:stats._profile?.level||'Kayıtlı tahmin'};
  _sideBetWidthCache.set(cacheKey,out);
  return out;
}

function sideBetDoubleBacktestFast(targetRace,targetNextRace=null){
  const revision=typeof sideBetPredictionLogRevisionSignature==='function'
    ? sideBetPredictionLogRevisionSignature(db) : String((db?.prediction_log||[]).length);
  const cacheKey=`FAST_DOUBLE|${revision}|${sideBetCacheKey(targetRace)}|${sideBetCacheKey(targetNextRace)}`;
  if(_sideBetBacktestCache.has(cacheKey)) return _sideBetBacktestCache.get(cacheKey);
  let groups=_sideBetPredictionLogBaseGroups().races||[];
  const targetHip=fold(targetRace?.hippodrome||'');
  if(targetHip){
    const sameHip=groups.filter(g=>fold((g[0]||{}).hippodrome||'')===targetHip);
    if(sameHip.length) groups=sameHip;
  }
  const byMeeting=new Map();
  for(const group of groups){
    const first=group[0]||{};
    const key=sideBetLogMeetingKey(first);
    if(!byMeeting.has(key)) byMeeting.set(key,new Map());
    byMeeting.get(key).set(Number(first.leg)||0,group);
  }
  const groupHit=group=>{
    const ranked=group.slice().sort((a,b)=>{
      const ar=Number(a.sidebet_rank_p1)||Number(a.predicted_rank)||999;
      const br=Number(b.sidebet_rank_p1)||Number(b.predicted_rank)||999;
      return ar-br || Number(b.score||0)-Number(a.score||0);
    }).slice(0,5).map(row=>String(row.horse_no));
    const winner=group.find(row=>Number(row.finish_position)===1);
    return !!winner && ranked.includes(String(winner.horse_no));
  };
  let ok=0,total=0;
  for(const legs of byMeeting.values()){
    for(const [leg,group] of legs){
      const next=legs.get(Number(leg)+1);
      if(!next) continue;
      total++; if(groupHit(group)&&groupHit(next)) ok++;
    }
  }
  const rate=total?ok/total:0;
  const out={ok,total,rate,ready:total>=SIDE_BET_MIN_RACES,_profile:{level:'Kayıtlı gerçek Çifte tahmini',label:'Geçmiş tahmin sonuçları',rows:Array(total),source:'prediction_log'}};
  _sideBetBacktestCache.set(cacheKey,out);
  return out;
}

function sideBetBacktest(targetRace){
  const cacheKey=sideBetCacheKey(targetRace);
  if(_sideBetBacktestCache.has(cacheKey)) return _sideBetBacktestCache.get(cacheKey);
  const logged=sideBetPredictionLogBacktest(targetRace);
  const out={ikili:{ok:0,total:0},sirali:{ok:0,total:0},uclu:{ok:0,total:0},dortlu:{ok:0,total:0},sirali5li:{ok:0,total:0}};
  const match=targetRace?detailedProfileMatch(targetRace,5):{level:'Tüm veri',label:'Tüm veri',rows:learningEligibleRaces()};
  const backtestRows = match.rows;
  for(const r of backtestRows){
    const ord=(typeof historicalSideBetOrder==='function'?historicalSideBetOrder(r):historicalOrder(r));
    const horses=(r.horses||[]).slice();
    const generic=typeof sideBetPositionRankingsForRace==='function'?sideBetPositionRankingsForRace(r,horses):null;
    const products={
      triple:tkpSideBetProductRankings(r,horses,'triple'),
      quartet:tkpSideBetProductRankings(r,horses,'quartet'),
      quintet:tkpSideBetProductRankings(r,horses,'quintet')
    };
    const positionNos=(rankings,position)=>(rankings?.['p'+position]||ord).map(h=>String(h.horse_no));
    const seq2=validFinishSequences(r,2),seq3=validFinishSequences(r,3),seq4=validFinishSequences(r,4),seq5=validFinishSequences(r,5);
    if(seq2.length){
      const p1=positionNos(generic,1).slice(0,5), p2=positionNos(generic,2).slice(0,5);
      out.ikili.total++;if(seq2.some(seq=>(p1.includes(String(seq[0].horse_no))&&p2.includes(String(seq[1].horse_no)))||(p1.includes(String(seq[1].horse_no))&&p2.includes(String(seq[0].horse_no)))))out.ikili.ok++;
      out.sirali.total++;if(seq2.some(seq=>p1.includes(String(seq[0].horse_no))&&p2.includes(String(seq[1].horse_no))))out.sirali.ok++;
    }
    if(seq3.length){
      const widths=tkpEffectiveSideBetWidths('triple'),rankings=products.triple;
      const p1=positionNos(rankings,1).slice(0,widths[0]),p2=positionNos(rankings,2).slice(0,widths[1]),p3=positionNos(rankings,3).slice(0,widths[2]);
      out.uclu.total++;if(seq3.some(seq=>p1.includes(String(seq[0].horse_no))&&p2.includes(String(seq[1].horse_no))&&p3.includes(String(seq[2].horse_no))))out.uclu.ok++;
    }
    if(seq4.length){
      const widths=tkpEffectiveSideBetWidths('quartet'),rankings=products.quartet;
      const pools=widths.map((w,i)=>positionNos(rankings,i+1).slice(0,w));
      const decision=tkpSideBetProductPlayDecision('quartet',r,rankings,pools);
      if(decision.play){out.dortlu.total++;if(seq4.some(seq=>pools[0].includes(String(seq[0].horse_no))&&pools[1].includes(String(seq[1].horse_no))&&pools[2].includes(String(seq[2].horse_no))&&pools[3].includes(String(seq[3].horse_no))))out.dortlu.ok++;}
    }
    if(seq5.length){
      const widths=tkpEffectiveSideBetWidths('quintet'),rankings=products.quintet;
      const pools=widths.map((w,i)=>positionNos(rankings,i+1).slice(0,w));
      const decision=tkpSideBetProductPlayDecision('quintet',r,rankings,pools);
      if(decision.play){out.sirali5li.total++;if(seq5.some(seq=>pools[0].includes(String(seq[0].horse_no))&&pools[1].includes(String(seq[1].horse_no))&&pools[2].includes(String(seq[2].horse_no))&&pools[3].includes(String(seq[3].horse_no))&&pools[4].includes(String(seq[4].horse_no))))out.sirali5li.ok++;}
    }
  }
  // Gerçek kaydedilmiş tahmin sonuçları en güncel ve en değerli veridir; iki kat
  // ağırlıkla geçmiş ODS/HTML geri testine eklenir. Tek bir yeni sonuç bütün modeli
  // devirmesin, fakat her sonuç yan bahis oranlarını ve pencere genişliğini güncellesin.
  const loggedRows=logged&&logged._profile?logged._profile.rows.length:0;
  if(loggedRows){
    for(const k of ['ikili','sirali','uclu','dortlu','sirali5li']){
      out[k].ok += (Number(logged[k]?.ok)||0)*2;
      out[k].total += (Number(logged[k]?.total)||0)*2;
    }
  }
  for(const g of Object.values(out)){g.rate=g.total?g.ok/g.total:0;g.ready=g.total>=SIDE_BET_MIN_RACES;}
  out._profile={...match,rows:backtestRows,sampleLimited:match.rows.length>backtestRows.length,recentPredictionRaces:loggedRows};
  _sideBetBacktestCache.set(cacheKey,out);
  return out;
}

function _sideBetDoubleGlobalPass(){
  // PERFORMANS KÖK ÇÖZÜM: Bu tarama tüm aktif koşu setinde her koşu çifti için
  // sideBetPositionRankingsForRace (pahalı puanlama) çalıştırır. Eskiden bu tarama
  // hedef koşuya bağlı cache anahtarı yüzünden KULLANICI FARKLI BİR KOŞUYA HER
  // BAKTIĞINDA baştan tekrarlanıyordu (klasör büyüdükçe her yan bahis/çifte analizi
  // gitgide yavaşlıyordu). Artık veri setinden bağımsız TEK bir anahtarla önbelleğe
  // alınır; yalnızca içe aktarma/güncelleme sonrası invalidateSideBetCache() ile
  // temizlenir. Hedef koşuya özgü benzerlik filtresi bu sonucun üzerinde çalışır.
  const eligible=learningEligibleRaces();
  const cacheKey='DOUBLE_GLOBAL|'+eligible.length+'|'+db.files.length;
  const cached=_sideBetDoubleGlobalCache.get(cacheKey);
  if(cached) return cached;
  const byFile=new Map();
  for(const r of eligible){
    if(!byFile.has(r.file_id)) byFile.set(r.file_id,new Map());
    byFile.get(r.file_id).set(Number(r.leg),r);
  }
  function pairFor(a){ const legs=byFile.get(a.file_id); return legs ? (legs.get(Number(a.leg)+1)||null) : null; }
  const pairRows=[];
  const seen=new Set();
  for(const a of eligible){
    const key=a.file_id+'|'+a.leg;
    if(seen.has(key)) continue;
    seen.add(key);
    const b=pairFor(a);
    if(!b) continue;
    const winA=(a.horses||[]).find(h=>Number(h.winner)===1 || Number(h.finish_position)===1);
    const winB=(b.horses||[]).find(h=>Number(h.winner)===1 || Number(h.finish_position)===1);
    if(!winA||!winB) continue;
    const rankA=typeof sideBetPositionRankingsForRace==='function'?sideBetPositionRankingsForRace(a,(a.horses||[]).slice()).p1:(typeof historicalSideBetOrder==='function'?historicalSideBetOrder(a):historicalOrder(a));
    const rankB=typeof sideBetPositionRankingsForRace==='function'?sideBetPositionRankingsForRace(b,(b.horses||[]).slice()).p1:(typeof historicalSideBetOrder==='function'?historicalSideBetOrder(b):historicalOrder(b));
    const poolA=rankA.slice(0,5).map(h=>String(h.horse_no));
    const poolB=rankB.slice(0,5).map(h=>String(h.horse_no));
    pairRows.push({a,b,hit:_v25PoolHasHorse(poolA,winA.horse_no) && _v25PoolHasHorse(poolB,winB.horse_no)});
  }
  const globalOk=pairRows.filter(x=>x.hit).length;
  const globalTotal=pairRows.length;
  const globalRate=globalTotal?globalOk/globalTotal:0;
  const out={pairRows,pairFor,globalOk,globalTotal,globalRate};
  _sideBetDoubleGlobalCache.clear();
  _sideBetDoubleGlobalCache.set(cacheKey,out);
  return out;
}

function sideBetDoubleBacktest(targetRace, targetNextRace=null){
  const cacheKey='DOUBLE|'+sideBetCacheKey(targetRace)+'|'+sideBetCacheKey(targetNextRace);
  if(_sideBetBacktestCache.has(cacheKey)) return _sideBetBacktestCache.get(cacheKey);
  const {pairRows,pairFor,globalOk,globalTotal,globalRate}=_sideBetDoubleGlobalPass();
  const tb=targetNextRace || (targetRace?pairFor(targetRace):null);
  if(!targetRace || !tb || !pairRows.length){
    const out={ok:globalOk,total:globalTotal,rate:globalRate,ready:globalTotal>=SIDE_BET_MIN_RACES,_profile:{level:'Tüm veri',label:'Tüm veri',rows:pairRows,sampleLimited:false}};
    _sideBetBacktestCache.set(cacheKey,out); return out;
  }
  function similarity(hist,targ){
    let s=0;
    if(fold(hist.condition_family)===fold(targ.condition_family)) s+=4;
    if(fold(hist.surface)===fold(targ.surface)) s+=2;
    if(fold(hist.breed)===fold(targ.breed)) s+=1;
    const d=Math.abs((Number(hist.distance)||0)-(Number(targ.distance)||0));
    if(d<=200) s+=2; else if(d<=400) s+=1;
    if(fold(hist.hippodrome)===fold(targ.hippodrome)) s+=1;
    return s;
  }
  const ranked=pairRows.map(row=>({row,score:similarity(row.a,targetRace)+similarity(row.b,tb)}))
    .filter(x=>x.score>=6)
    .sort((x,y)=>y.score-x.score)
    .slice(0,40);
  const selected=ranked.length?ranked:pairRows.map(row=>({row,score:1})).slice(-40);
  const ok=selected.filter(x=>x.row.hit).length;
  const total=selected.length;
  const weightTotal=selected.reduce((a,x)=>a+x.score*x.score,0);
  const weightOk=selected.reduce((a,x)=>a+(x.row.hit?x.score*x.score:0),0);
  // Küçük profillerde tek yarış oranı zıplatmasın: genel başarı yalnızca zayıf bir öncül olarak kullanılır.
  const priorWeight=120;
  const rate=weightTotal?(weightOk+globalRate*priorWeight)/(weightTotal+priorWeight):globalRate;
  const avgSimilarity=total?selected.reduce((a,x)=>a+x.score,0)/total:0;
  const level=avgSimilarity>=15?'İki koşu çok yakın profil':avgSimilarity>=11?'İki koşu benzer profil':'Koşu şartı ağırlıklı yakın profil';
  const out={ok,total,rate,ready:total>=SIDE_BET_MIN_RACES,_profile:{level,label:level,rows:selected.map(x=>x.row),sampleLimited:pairRows.length>selected.length,globalRate}};
  _sideBetBacktestCache.set(cacheKey,out);
  return out;
}

function sideBetHorseToken(no, raceHorses, rankNo){
  const raw=String(no??'').trim();
  const coupled=/-E\d+$/i.test(raw);
  const rank=Number(rankNo);
  const rankCls=(rank>=1 && rank<=4)?` rankPick-p${rank}`:'';
  // Sonuç geldiyse yan bahislerdeki at numarası da ana derece paletini taşır.
  // Bu yalnız görsel bir sınıftır; yan bahis hesabını/aday sırasını değiştirmez.
  const actual=(raceHorses||[]).find(h=>{
    const pos=Number(h?.finish_position)||((Number(h?.winner)===1)?1:0);
    return pos>=1&&pos<=5&&_v25SameHorseForResultMark(h?.horse_no,raw);
  });
  const finish=actual?(Number(actual.finish_position)||((Number(actual.winner)===1)?1:0)):0;
  const resultCls=(finish>=1&&finish<=5)?` resultPlaced finishNo-p${finish}`:'';
  const titleText=resultCls?`Gerçek ${finish}. derece${coupled?' · Eküri':''}`:(coupled?'Eküri numarası — tek at':(rankCls?`${rank}. tahmin sırası`:'At numarası'));
  return `<span class="sideBetHorseNo${coupled?' coupled':''}${rankCls}${resultCls}" title="${esc(titleText)}">${esc(raw)}</span>`;
}

function sideBetOutcomeStatus(pools, raceHorses){
  const horses=Array.isArray(raceHorses)?raceHorses:[];
  const needed=(pools||[]).length;
  if(!needed) return '<span class="sideBetWait">BEKLENİYOR</span>';
  const actual=[];
  const missing=[];
  for(let pos=1;pos<=needed;pos++){
    const h=horses.find(x=>Number(x.finish_position)===pos || (pos===1 && Number(x.winner)===1));
    if(!h) missing.push(pos+'.');
    else actual.push(String(h.horse_no));
  }
  if(missing.length) return '<span class="sideBetWait">BEKLENİYOR</span>';
  // Tek koşulu sıralı ürünlerde eküri ortaklığı eşdeğer sonuç değildir; yalnız
  // Ganyan/Çifte çoklu koşu ürünlerinde aynı eküri tek seçim sayılır.
  const hit=actual.every((no,i)=>(pools[i]||[]).some(p=>_v25SameHorseExact(p,no)));
  if(hit) return `<span class="sideBetResult hit">TUTTU · Kazanan: ${actual.map(esc).join(' / ')}</span>`;
  // Dörtlü/Tabela'da "sırasız tuttu" sayılması için yalnızca dört atın birleşik havuzda
  // bulunması yetmez. Her gerçek derece atı, birbirinden farklı bir tahmin satırına
  // yerleştirilebilmelidir. Böylece örn. 1. satırda yalnız 5 varken 7/8/9/11 sonucu
  // yanlışlıkla "sırasız tuttu" sayılmaz.
  if(needed===4){
    const normalizedPools=pools.map(p=>(p||[]).map(String));
    const used=new Array(needed).fill(false);
    function canAssignActual(actualIndex){
      if(actualIndex>=actual.length) return true;
      const no=actual[actualIndex];
      for(let poolIndex=0;poolIndex<needed;poolIndex++){
        if(used[poolIndex] || !normalizedPools[poolIndex].some(p=>_v25SameHorseExact(p,no))) continue;
        used[poolIndex]=true;
        if(canAssignActual(actualIndex+1)) return true;
        used[poolIndex]=false;
      }
      return false;
    }
    if(canAssignActual(0)){
      return `<div class="sideBetResult partial" style="display:block"><div><b>SIRASIZ İSABET · SIRALI TUTMADI</b></div><div>Kazanan: ${actual.map(esc).join(' / ')}</div><div class="sideBetPartialNote">(4 at havuzda var ama sıra tutmadı; tabela sıralı TUTTU sayılmaz)</div></div>`;
    }
  }
  return `<span class="sideBetResult miss">TUTMADI · Kazanan: ${actual.map(esc).join(' / ')}</span>`;
}

function ensureMinDoubleCost(poolA, poolB, unit, minCost, seqA, seqB, maxWidth){
  let a=(poolA||[]).slice(), b=(poolB||[]).slice();
  const grow=(pool,seq)=>{
    const out=pool.slice(), seen=new Set(out.map(String));
    for(const no of (seq||[])){
      if(seen.has(String(no))) continue;
      out.push(no); break;
    }
    return out;
  };
  let guard=0;
  while(a.length*b.length*unit<minCost && guard<200){
    guard++;
    const canGrowA=a.length<seqA.length && a.length<maxWidth;
    const canGrowB=b.length<seqB.length && b.length<maxWidth;
    if(!canGrowA && !canGrowB) break;
    // Daha dar olan havuzu büyüt; eşitse A'yı büyüt.
    if(canGrowA && (!canGrowB || a.length<=b.length)) a=grow(a,seqA);
    else b=grow(b,seqB);
  }
  return {a,b};
}

function trimDoublePools(poolA, poolB, unit, limit, protectedA=[], protectedB=[], minPoolLen=1){
  let a=(poolA||[]).slice(), b=(poolB||[]).slice();
  const pa=new Set((protectedA||[]).map(String)), pb=new Set((protectedB||[]).map(String));
  const shrink=(pool,guarded)=>{
    if(pool.length<=2) return null;
    for(let i=pool.length-1;i>=1;i--){
      if(guarded.has(String(pool[i]))) continue;
      return pool.slice(0,i).concat(pool.slice(i+1));
    }
    return null;
  };
  while(a.length*b.length*unit > limit && (a.length>2 || b.length>2)){
    const sa=shrink(a,pa), sb=shrink(b,pb);
    if(sa && (!sb || a.length>=b.length)) a=sa;
    else if(sb) b=sb;
    else break;
  }
  // KESİN BÜTÇE KİLİDİ: korumalı para sinyalleri tavandan daha önemli değildir.
  // İlk aşama yetmezse liderler korunarak kuyruklar sert biçimde daraltılır.
  while(a.length*b.length*unit > limit && (a.length>minPoolLen || b.length>minPoolLen)){
    if(a.length>=b.length && a.length>minPoolLen) a=a.slice(0,-1);
    else if(b.length>minPoolLen) b=b.slice(0,-1);
    else break;
  }
  return {a,b};
}

function doublePoolWithRelaxedSingle(raceX){
  const base=doublePoolForRace(raceX);
  const relaxed=relaxedSingleForRace(raceX);
  let locked=base.pool;
  if(relaxed && base.pool.length>1 && base.pool.includes(String(relaxed.horse_no))){
    locked=[String(relaxed.horse_no)];
  }
  return {raw:base.pool, locked, coverage:base.coverage, reason:base.reason,protectedNos:base.protectedNos||[]};
}


let _tkpSideBetStrategyPlanCache=new WeakMap();
function tkpSideBetStrategyPlanSignature(x){
  const r=x?.r||{},pool=x?.scored||r?.horses||[];
  const dbSig=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${db?.files?.length||0}:${db?.races?.length||0}`;
  return dbSig+'|'+[r.id||r.file_id||'',r.leg||'',...pool.map(h=>[h?.horse_no,Number(isNonRunner(h)),h?.score,h?.prediction_score_snapshot,h?.altili_winner_score,h?.agf,h?.agf_rank,h?.ypuan,h?.value_score,h?.hndkp_rank,h?.jbyg,h?.bmb,h?.odb,h?.tr_ganyan,h?.tr_puan,h?.tr_ganyan_source,h?.tr_source,0,h?.expert_consensus_total,h?.expert_positive_votes].join(':'))].join('|');
}
function sideBetStrategyPlan(x){
  const cacheTarget=x&&typeof x==='object'?x:null,signature=tkpSideBetStrategyPlanSignature(x),cached=cacheTarget?_tkpSideBetStrategyPlanCache.get(cacheTarget):null;
  if(cached?.signature===signature)return cached.value;
  const archived=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x);
  const panelNoScan=globalThis.__tkpSideBetPanelNoScan===true;
  // R16.44 SPEED: otomatik İSTATİSTİK hazırlığı model/kupon hesabı değildir. Hazır
  // scored/frozen sırayı kullanır ve condition/profile/history taramalarını tetiklemez.
  // Gerçek kupon/yan-bahis üretim yolu bu bayrak olmadan eski tam motoru kullanır.
  if(panelNoScan&&!archived){
    const rows=(x?.scored||x?.r?.horses||[]).filter(h=>!isNonRunner(h)).slice().sort((a,b)=>(Number(a?.predicted_rank)||999)-(Number(b?.predicted_rank)||999)||Number(b?.score||0)-Number(a?.score||0)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||'')));
    const common=dedupeEkuri(rows,x.r,'main',true);
    const picksFor=typeKey=>{try{const leg=activeCoupons?.[typeKey]?.legs?.find(row=>Number(row?.r?.leg??row?.leg)===Number(x?.r?.leg));const wanted=new Set((leg?.picks||[]).map(h=>String(h?.horse_no??h)));return common.filter(h=>wanted.has(String(h?.horse_no)));}catch(_e){return [];}};
    const normalPicks=picksFor('main'),surprisePicks=dedupeEkuri(picksFor('surprise').concat(picksFor('alt')),x.r,'surprise',true);
    const signalPicks=common.filter(h=>Number(h?.bmb)===1||Number(h?.tr_ganyan_rank)>0&&Number(h?.tr_ganyan_rank)<=3);
    const picks=dedupeEkuri((normalPicks.length?normalPicks:common.slice(0,Math.min(5,common.length))).concat(surprisePicks,signalPicks),x.r,'main',true);
    const quick={sequence:common,picks,normalPicks:normalPicks.length?normalPicks:picks,surprisePicks,moneySignalPicks:signalPicks,portfolioPicks:[],single:normalPicks.length===1?normalPicks[0]:null,decision:{isSingle:normalPicks.length===1,confidence:0,reason:'Hazır kupon/scored sıra · no-scan panel'},hardMin:0,panelNoScan:true};
    return quick;
  }
  // Arşivde final-rank/adaptif sıra motoru çağrılmaz. Ayrı bir frozen sıra
  // yardımcı yolu vardır; snapshot yoksa yalnız kayıtlı TKP sırası kullanılır.
  const visualRows = archived
    ? (typeof tkpArchivedOrderedRows==='function'
      ? tkpArchivedOrderedRows(x)
      : (x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h)).slice())
    : ((typeof tkpFinalRankOrderForRace==='function')
      ? tkpFinalRankOrderForRace(x.r,(x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h)))
      : ((typeof sideBetAdaptiveOrderForRace==='function')
        ? sideBetAdaptiveOrderForRace(x.r,(x.scored||x.r?.horses||[]))
        : ((typeof predictionDisplayRows==='function')
          ? predictionDisplayRows({r:x.r,scored:(x.scored||x.r?.horses||[])}, Infinity, 'score-desc').rows
          : strategicOrderForRace(x.r,(x.scored||x.r?.horses||[])))));
  const common=dedupeEkuri(visualRows,x.r,'main',true);
  if(!common.length) return {sequence:[],picks:[],normalPicks:[],surprisePicks:[],moneySignalPicks:[],single:null,decision:null,hardMin:0};

  // KÖK DARBOĞAZ FIX: kayıtlı toplantının İSTATİSTİK sekmesi yalnız frozen
  // yarış-öncesi sıra ve kayıtlı kuponu göstermelidir. Aşağıdaki canlı yol;
  // conditionSingleStrength/profileStrength/couponMoneySignalCandidates üzerinden
  // bütün geçmişi yeniden tarayabiliyor ve Win8.1 Opera'da tek ayakta ana thread'i
  // onlarca saniye tutuyordu. Arşivde aynı kararı yeniden üretmek hem yavaş hem de
  // tarihsel sonucu bugünkü modelle değiştireceği için yanlıştır.
  if(archived){
    const picksFor=typeKey=>{
      try{
        const leg=activeCoupons?.[typeKey]?.legs?.find(row=>Number(row?.r?.leg??row?.leg)===Number(x?.r?.leg));
        const wanted=new Set((leg?.picks||[]).map(h=>String(h?.horse_no??h)));
        return common.filter(h=>wanted.has(String(h?.horse_no)));
      }catch(_e){return [];}
    };
    const normalPicks=picksFor('main');
    const surprisePicks=dedupeEkuri(picksFor('surprise').concat(picksFor('alt')),x.r,'surprise',true);
    const decision=typeof tkpArchivedDisplayDecision==='function'
      ?tkpArchivedDisplayDecision(x,common[0]||null,common[1]||null)
      :{isSingle:normalPicks.length===1,confidence:0,reason:'Kayıtlı snapshot'};
    const single=normalPicks.length===1?normalPicks[0]:null;
    const cheapMoneySignals=common.filter(h=>Number(h?.bmb)===1
      ||(typeof isOdbCandidate==='function'&&isOdbCandidate(h,x.r))
      ||Number(h?.tr_ganyan_rank)>0&&Number(h.tr_ganyan_rank)<=3);
    const picks=dedupeEkuri((normalPicks.length?normalPicks:common.slice(0,Math.min(5,common.length)))
      .concat(surprisePicks,cheapMoneySignals),x.r,'main',true);
    const archived={sequence:common,picks,normalPicks:normalPicks.length?normalPicks:picks,
      surprisePicks,moneySignalPicks:cheapMoneySignals,portfolioPicks:[],single,decision,
      hardMin:0,archivedFrozen:true};
    if(cacheTarget)_tkpSideBetStrategyPlanCache.set(cacheTarget,{signature,value:archived});
    return archived;
  }

  const first=common[0], second=common[1]||null;
  const strength=conditionSingleStrength(x.r,first);
  const secondStrength=second?conditionSingleStrength(x.r,second):0;
  const decision=dynamicSingleDecision(x,first,second,strength,strength-secondStrength);
  // KULLANICI TALİMATI (kesin kural, Altılı Kupon'la tutarlı): bu ayakta TKP skoru 1'in
  // üzerinde 2 veya daha fazla at varsa, yan bahiste de TEK verilmez -- bu atlar TEK
  // yerine birlikte (pozisyon havuzunda) yazılmalı.
  const multipleStrongTkp=common.filter(h=>(Number(h.score)||0)>1).length>=2;
  // KULLANICI TALİMATI (2. tur, test ediliyor): en yüksek iki TKP skoru arasındaki fark
  // 0,30 veya daha azsa yan bahiste de TEK verilmez.
  const scoreSorted=common.slice().sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0));
  const smallTkpGap=scoreSorted.length>=2 && ((Number(scoreSorted[0].score)||0)-(Number(scoreSorted[1].score)||0))<=getTkpGapThreshold();
  const single=(decision.isSingle && !multipleStrongTkp && !smallTkpGap)?first:null;
  const hardMin=difficultRaceMinimumCount(x);
  const moneySignalPicks=couponMoneySignalCandidates(x,common);

  // NORMAL mantığı: en sağlam Genel Bakış lideri; TEK değilse sıradaki 2-3 at.
  let normalCount=single?1:((decision.confidence||0)>=55?2:3);
  if(hardMin) normalCount=Math.max(normalCount,hardMin);
  const normalPicks=common.slice(0,Math.min(common.length,normalCount));

  // SÜRPRİZ mantığı: TKP sırasındaki 3-4-5 adaylarından en sağlam iki farklı at.
  // Yetersizse diğer kuponların ilk omurgasında bulunmayan kanıtlı güçlü adayla tamamlanır.
  // KULLANICI TALİMATI (onaylandı): sideBetStrategyPlan'ın "sürpriz" mantığı artık
  // Kupon'da (forcedSinglePickMap) haftalar önce düzelttiğimiz aynı iki hatayı taşıyordu:
  // (1) ham TKP skoru sırası (tkpOrderedForLeg) kullanıyordu, Genel Bakış'ın gerçek
  // sırası (predictionDisplayRows) değil; (2) BMB/ODB'yi ×2,2 ile birincil itici güç
  // yapıyordu. Artık ikisi de Kupon'la aynı: Genel Bakış'ın 3./4./5. sırası, BMB/ODB
  // sadece küçük ikincil ayraç (bmbOdbTieBreakWeight).
  const genelBakisSirasi=(typeof tkpFinalRankOrderForRace==='function'
    ? tkpFinalRankOrderForRace(x.r,(x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h)))
    : (typeof sideBetAdaptiveOrderForRace==='function'
      ? sideBetAdaptiveOrderForRace(x.r,x.scored||[])
      : predictionDisplayRows({r:x.r,scored:x.scored||[]}).rows)).filter(h=>!isNonRunner(h));
  const tkpBand=[3,4,5].map(rank=>({h:genelBakisSirasi[rank-1],rank})).filter(z=>z.h).map(z=>({
    h:z.h, rank:z.rank,
    value:tkpCouponStrengthCached(x.r,z.h,'surprise')+(Number(z.h.ypuan)||0)/100+(z.h.bmb===1||isOdbCandidate(z.h)?bmbOdbTieBreakWeight():0)
  })).sort((a,b)=>b.value-a.value||a.rank-b.rank);
  const surprise=[];
  const used=new Set();
  for(const z of tkpBand){
    const no=String(z.h.horse_no); if(used.has(no)) continue;
    surprise.push(z.h); used.add(no); if(surprise.length>=2) break;
  }
  if(surprise.length<2){
    const fallback=common.filter(h=>!used.has(String(h.horse_no)) && String(h.horse_no)!==String(first.horse_no))
      .filter(h=>(Number(h.score)||0)>=0.80 || historyStrengthForCandidate(h)>=0.25 || h.bmb===1 || isOdbCandidate(h) || (Number(h.ypuan)||0)>=35)
      .sort((a,b)=>
        (tkpCouponStrengthCached(x.r,b,'surprise')+(b.bmb===1||isOdbCandidate(b)?bmbOdbTieBreakWeight():0))-
        (tkpCouponStrengthCached(x.r,a,'surprise')+(a.bmb===1||isOdbCandidate(a)?bmbOdbTieBreakWeight():0))
      );
    for(const h of fallback){
      const no=String(h.horse_no); if(used.has(no)) continue;
      surprise.push(h); used.add(no); if(surprise.length>=2) break;
    }
  }

  // Ortak sıra bozulmaz: konuma özel modellerin ürettiği ilk beş ana omurga korunur;
  // sürpriz/değer adayları ancak bunların arkasına eklenir. Böylece 4. ve 5. hedef
  // modeli, sürpriz önceliklendirmesi sırasında görünmez biçimde yerinden edilmez.
  const core=common.slice(0,Math.min(5,common.length));
  const coreNos=new Set(core.map(h=>String(h.horse_no)));
  const surpriseExtra=surprise.filter(h=>!coreNos.has(String(h.horse_no)));
  const portfolioPicks=typeof tkpPortfolioHedgesForRace==='function'
    ? (tkpPortfolioHedgesForRace(x.r,common,2)||[]).map(row=>row.horse).filter(Boolean)
    : [];
  // KULLANICI TALİMATI: Ana kupondaki (Normal/Geniş/Sürpriz) değer bandı önceliklendirmesi
  // yan bahislere de uygulanır. SONUÇ 6-8, AGF 6-11, gerçek BMB/ODB veya ilk 8 dışı Y.PUAN 8-20 ODB atları
  // -- "Altılıya para verdiren" profil -- yan bahis penceresi genişledikçe sıradan Genel
  // Bakış sırasının önüne geçirilir; sadece en güçlüsü değil, hepsi.
  const soFarNos=new Set(core.concat(moneySignalPicks,surpriseExtra,portfolioPicks).map(h=>String(h.horse_no)));
  const valueExtra=common.filter(h=>valueBandMatch(h,x.r) && !soFarNos.has(String(h.horse_no)))
    .sort((a,b)=>(valueBandScore(b,x.r)-valueBandScore(a,x.r))||(tkpCouponStrengthCached(x.r,b,'surprise')-tkpCouponStrengthCached(x.r,a,'surprise')));
  const priorityNos=new Set(core.concat(moneySignalPicks,surpriseExtra,portfolioPicks,valueExtra).map(h=>String(h.horse_no)));
  const sequence=dedupeEkuri(core.concat(moneySignalPicks,surpriseExtra,portfolioPicks,valueExtra,common.filter(h=>!priorityNos.has(String(h.horse_no)))),x.r,'surprise',true);
  const requiredSideCount=dedupeEkuri(core.concat(moneySignalPicks,portfolioPicks),x.r,'surprise',true).length;
  const desired=Math.min(sequence.length,Math.max(single?1:3,hardMin||0,normalPicks.length,requiredSideCount));
  const value={sequence,picks:sequence.slice(0,desired),normalPicks,surprisePicks:surprise,portfolioPicks,moneySignalPicks,single,decision,hardMin};
  if(cacheTarget)_tkpSideBetStrategyPlanCache.set(cacheTarget,{signature,value});
  return value;
}
function tkpInvalidateSideBetPlanCache(){_tkpSideBetStrategyPlanCache=new WeakMap();}


const V25_COUPON_SINGLE_LABELS={main:'Normal 1',main2:'Normal 2',alt:'Geniş',surprise:'Uzman+Kulis'};

function v25SameRaceForCouponSingle(a,b){
  if(!a||!b) return false;
  if(a===b) return true;
  const aid=Number(a.id)||0, bid=Number(b.id)||0;
  const afid=Number(a.file_id)||0, bfid=Number(b.file_id)||0;
  if(aid>0 && bid>0 && aid===bid && (!afid||!bfid||afid===bfid)) return true;
  if(Number(a.leg)!==Number(b.leg)) return false;
  const ad=String(a.race_date||''), bd=String(b.race_date||'');
  const ah=fold(a.hippodrome||''), bh=fold(b.hippodrome||'');
  if(ad && bd && ad!==bd) return false;
  if(ah && bh && ah!==bh) return false;
  // Aktif kuponlar aynı yarış nesnelerinden üretildiği için tarih/hipodromdan biri
  // eşleşiyorsa bu ayak güvenle aynı yarış kabul edilir. İkisi de boşsa koşu şartı +
  // mesafe de eşleşmeden yalnız ayak numarasına bakılarak eski kupon kullanılmaz.
  if((ad&&bd)||(ah&&bh)) return true;
  return Number(a.distance||0)===Number(b.distance||0) &&
    fold(a.condition_family||a.condition_text||'')===fold(b.condition_family||b.condition_text||'');
}

function v25CouponGeneratedSingle(coupon,x){
  if(!coupon || coupon.error || !Array.isArray(coupon.legs) || !x?.r) return null;
  const leg=coupon.legs.find(l=>l&&v25SameRaceForCouponSingle(l.r,x.r));
  if(!leg || !Array.isArray(leg.picks) || leg.picks.length!==1) return null;
  // Kupon kartında TEK görünen her ayak yan bahis TEKLİ OYUN kaynağıdır. Böylece
  // Normal/Geniş/Sürpriz kuponların ürettiği veya kupon üzerinde güncel kalan TEK,
  // yan bahis panelinde eksiksiz karşılık bulur; Genel Bakış liderinden yedek TEK üretilmez.
  const horse=leg.picks[0];
  if(!horse || isNonRunner(horse)) return null;
  return {no:String(horse.horse_no),horse,leg};
}

function v25CouponSinglesForRace(x){
  const byNo=new Map();
  for(const typeKey of ['main','main2','surprise']){
    const found=v25CouponGeneratedSingle(activeCoupons&&activeCoupons[typeKey],x);
    if(!found) continue;
    const label=V25_COUPON_SINGLE_LABELS[typeKey]||typeKey;
    if(!byNo.has(found.no)) byNo.set(found.no,{...found,labels:[],typeKeys:[]});
    const item=byNo.get(found.no);
    item.labels.push(label); item.typeKeys.push(typeKey);
  }
  return [...byNo.values()];
}

function v25CouponDoubleSinglePlans(x,nextRace){
  const byPools=new Map();
  for(const typeKey of ['main','main2','surprise']){
    const coupon=activeCoupons&&activeCoupons[typeKey];
    const a=v25CouponGeneratedSingle(coupon,x);
    const b=v25CouponGeneratedSingle(coupon,nextRace);
    if(!a&&!b) continue;
    const key=(a?a.no:'*')+'|'+(b?b.no:'*');
    if(!byPools.has(key)) byPools.set(key,{aNo:a?.no||null,bNo:b?.no||null,labels:[],typeKeys:[]});
    const item=byPools.get(key);
    item.labels.push(V25_COUPON_SINGLE_LABELS[typeKey]||typeKey);
    item.typeKeys.push(typeKey);
  }
  return [...byPools.values()];
}

function v25CouponSingleTitle(labels){
  const src=(labels||[]).join(' + ');
  return src ? `TEKLİ OYUN · ${src} Kupon TEKİ` : 'TEKLİ OYUN · Kupon TEKİ';
}

// Bir alternatif kartta herhangi bir sıralı pozisyon tek ata düştüyse bu kart
// artık "Teksiz Alternatif" değildir. Özellikle maliyet kontrolü Sıralı 5'li,
// Dörtlü veya Üçlü havuzlardan birini 1 ata indirebilir. Başlık doğrudan ekranda
// oynanan gerçek havuzlardan türetilir; kupon TEK kaynağına bakılarak tahmin edilmez.
function v25AlternativeLabel(pools){
  const hasSingle=(pools||[]).some(pool=>Array.isArray(pool) && pool.length===1);
  return hasSingle ? 'Tek İçeren Alternatif' : 'Teksiz Alternatif';
}
function v25AlternativeTitle(base,pools){
  return `${base} · ${v25AlternativeLabel(pools)}`;
}

// TEKLİ OYUN kartları birden fazlaysa bile Teksiz Alternatif kartı sağ sütunda
// sabit kalır. Eski düz join düzeninde 2 sütunlu grid TEKLİ kartları birbirleriyle
// eşliyor ve alternatif kartı aşağı itiyordu; kullanıcı karşılaştırmayı yan yana göremiyordu.
function v25SingleAlternativePair(singleCards, altCard){
  const singles=(singleCards||[]).filter(Boolean);
  if(!singles.length) return altCard||'';
  return `<div class="sideBetPairWrap sideBetCouponMulti"><div class="sideBetSinglesColumn">${singles.join('')}</div><div class="sideBetAlternativeColumn">${altCard||''}</div></div>`;
}


function v25AltiliSingleNoForSideBet(x, predictionPlan=null){
  try{ if(predictionPlan && predictionPlan.single) return String(predictionPlan.single.horse_no); }catch(_){}
  try{
    const lp = typeof legCoveragePlan==='function' ? legCoveragePlan(x,'main') : null;
    if(lp && lp.reliable && lp.picks && lp.picks.length>=1) return String(lp.picks[0].horse_no);
  }catch(_){}
  try{
    const hp = typeof historicalCoveragePlan==='function' ? historicalCoveragePlan(x) : null;
    if(hp && hp.singleDecision && hp.singleDecision.isSingle && hp.picks && hp.picks.length>=1) return String(hp.picks[0].horse_no);
  }catch(_){}
  return null;
}


function tkpSideBetOccurrenceCount(no,pools){
  return (pools||[]).reduce((n,p)=>n+(p||[]).filter(x=>{
    try{return typeof _v25SameHorseOrEkuri==='function'?_v25SameHorseOrEkuri(x,no):String(x)===String(no);}catch(_){return String(x)===String(no);}
  }).length,0);
}
function tkpSideBetCanRemoveCandidate(pools,poolIndex,itemIndex,protectedNos=new Set(),criticalNos=new Set(),minPoolLen=1){
  const pool=(pools||[])[poolIndex]||[];
  if(!Array.isArray(pool)||itemIndex<0||itemIndex>=pool.length||pool.length<=minPoolLen)return false;
  const no=String(pool[itemIndex]);
  if((protectedNos.has(no)||criticalNos.has(no)) && tkpSideBetOccurrenceCount(no,pools)<=1)return false;
  return true;
}



const TKP_SIDE_BET_TESTED_WIDTHS={cifte:[5,5],sirali:[5,5],triple:[5,6,7],quartet:[3,5,6,9],quintet:[2,5,5,6,8]};
function tkpVerifiedSideBetRecommendation(product){
  try{
    const row=db?.settings?.verified_bet_optimizer?.recommendations?.[product];
    if(!row||row.preRaceOnly!==true||row.officialCombinationEvaluation!==true||row.evidenceClass!=='LIVE_PRE_RACE_LOCKED')return null;
    const sample=Number(row.sample??row.holdoutSample)||0;
    if(sample<1)return null; // V1.1.305: 20 yarış zorunluluğu kaldırıldı
    return row;
  }catch(_){return null;}
}
function tkpEffectiveSideBetWidths(product){
  const fallback=(TKP_SIDE_BET_TESTED_WIDTHS[product]||[]).slice();
  try{
    const verified=tkpVerifiedSideBetRecommendation(product);
    const diagnostic=db?.settings?.verified_bet_optimizer?.recommendations?.[product];
    // Zaman damgası kanıtı bulunmayan geçmiş çalışma ana algoritmayı/oyna kararını
    // seçemez; fakat resmî kombinasyonla doğrulanmış düşük-maliyetli havuz genişliği
    // haftalık canlı shadow takipte kullanılabilir.
    const row=verified||(diagnostic?.diagnosticWidthsOnly===true&&diagnostic?.officialCombinationEvaluation===true?diagnostic:null);
    const widths=Array.isArray(row?.widths)?row.widths.map(Number):[];
    // PAS/SHADOW da testte doğrulanan havuzu göstermelidir; "accepted" yalnız
    // gerçek-para aktivasyonudur, sıra/araştırma kartını eski genişliğe döndürmez.
    if(widths.length===fallback.length && widths.every(n=>Number.isInteger(n)&&n>=1&&n<=12))return widths;
  }catch(_){ }
  try{
    const staticWidths=globalThis.TKP_V321_SIDEBET_CALIBRATION?.widths?.(product);
    if(Array.isArray(staticWidths)&&staticWidths.length===fallback.length&&staticWidths.every(n=>Number.isInteger(Number(n))&&Number(n)>=1&&Number(n)<=12))return staticWidths.map(Number);
  }catch(_){ }
  return fallback;
}
const TKP_SIDE_BET_TESTED_LIMITS={triple:450,quartet:750,quintet:750};
// V1.1.322 HIZ/TEMİZLİK: tkpSideBetRaceDayNumber/tkpSideBetAgfRank/
// tkpSideBetHistoricalTrackSurpriseRate ölü kod olarak kaldırıldı. Üçü de
// yalnız birbirini besliyordu ve hiçbir çağrı noktası yoktu (grep ile
// doğrulandı). tkpSideBetHistoricalTrackSurpriseRate her track için db.races
// üzerinde tam arşiv taraması yapıyordu; dbSig her yeni yarışta değiştiği
// için cache sık invalide olup O(n) yeniden hesaba düşüyordu. İleride bu
// "pist bazlı tarihsel sürpriz oranı" fikri gerçek bir karar zincirine
// (ör. tkpSideBetProductPlayDecision) bağlanacaksa, ayak başına değil
// yalnız DB değiştiğinde/idle'da tek seferlik ön-ısıtma ile eklenmeli.
function tkpSideBetProductRankings(race,horses,product){
  if(typeof tkpSideBetProductPositionRankingsForRace==='function')return tkpSideBetProductPositionRankingsForRace(race,horses,product);
  if(typeof sideBetPositionRankingsForRace==='function')return sideBetPositionRankingsForRace(race,horses);
  const rows=(horses||[]).filter(h=>h&&!isNonRunner(h));const out={};for(let i=1;i<=5;i++)out['p'+i]=rows.slice();return out;
}
function tkpSideBetScoreGap(rankings,product,pos,cutoff=1){
  const rows=rankings?.['p'+pos]||[];if(rows.length<=cutoff)return 0;
  const field=`sidebet_${product}_p${pos}_score`;
  return Math.max(0,(Number(rows[cutoff-1]?.[field])||0)-(Number(rows[cutoff]?.[field])||0))/100;
}
function tkpSideBetMean(values){const nums=(values||[]).filter(Number.isFinite);return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:0;}
function tkpSideBetProductPlayDecision(product,race,rankings,pools){
  // R17.4 ortak karar motoru: R17 P_WIN ile model olay olasılığı, AGF/SP ile
  // piyasa olay olasılığı ve gerçek ticket ROI/MaxDD/kayıp-serisi aynı kapıda.
  // Sonuç/ikramiye canlı feature değildir; tarihsel ROI yalnız risk prior/gate'tir.
  let r174=null;
  try{
    const races=Array.isArray(race)?race:[race];
    r174=globalThis.TKP_R17_EV_ROI_PORTFOLIO?.evaluateOrderedSideBet?.(product,races,pools,{cost:0})||null;
    if(r174?.hardBlock===true||r174?.catastrophic===true){
      return {play:false,strong:false,label:'PAS',mode:'PAS',verified:true,r174:true,evDecision:r174,
        reason:String(r174.reason||'R17.4 negatif EV/ROI risk kapısı')};
    }
  }catch(_e){}
  // Bir ürünün tarihsel proxy oranı yüksek olsa bile gerçek para durumu ancak
  // bizzat üretilmiş, saat-kilitli biletler 150 özgün olaya ulaşınca İNCELEME
  // olur. Kapı özellikle AKTİF döndürmez: üretime geçiş ayrı bir insan onayıdır.
  try{
    const exactGate=typeof globalThis.tkpWeeklyModelTrackerSideBetGate==='function'
      ? globalThis.tkpWeeklyModelTrackerSideBetGate(product) : null;
    if(exactGate?.exact===true){
      const evCandidate=r174?.play===true;
      const evReview=r174?.review===true;
      const reviewed=String(exactGate.mode||'').toUpperCase()==='REVIEW';
      const label=evCandidate?(reviewed?'İNCELEME':'EV ADAY'):(evReview?'İNCELEME':String(exactGate.label||'SHADOW'));
      const mode=evCandidate?'SHADOW_EV':String(exactGate.mode||'SHADOW');
      return {play:false,strong:false,label,mode,verified:false,r174:!!r174,evDecision:r174,
        reason:`${r174?.reason?String(r174.reason)+' · ':''}Tam bilet canlı kilidi ${Number(exactGate.events)||0}/${Number(exactGate.minimum)||150} · ${String(exactGate.reason||'Otomatik aktivasyon kapalı.')}`};
    }
  }catch(_){ }
  const verified=tkpVerifiedSideBetRecommendation(product);
  if(verified){
    const rawMode=String(verified.mode||'PAS').toLocaleUpperCase('tr-TR');
    const roi=Number(verified.roi??verified.allHistorical?.roi);
    const roiText=Number.isFinite(roi)?` · net ROI %${(roi*100).toFixed(1)}`:'';
    if(verified.accepted!==true||rawMode!=='AKTİF'){
      const label=rawMode==='SHADOW_CANDIDATE'?'SHADOW ADAY':(rawMode==='SHADOW'?'SHADOW':'PAS');
      return {play:false,strong:false,label,mode:rawMode,verified:true,reason:`Resmî kombinasyon + gerçek birim maliyeti · n=${Number(verified.sample??verified.holdoutSample)||0}${roiText}; canlı eşik bekleniyor`};
    }
    return {play:true,strong:true,label:'AKTİF',mode:'AKTİF',verified:true,reason:`Saat kilitli ileri test · resmî kombinasyon · n=${Number(verified.sample??verified.holdoutSample)||0}`};
  }
  // V1.1.321: 509 arşiv / V46 yarış-öncesi kalibrasyon sonucu ürün bazlı
  // kanıt kapısı. Canlı exact-ticket kanıtı varsa yukarıdaki katman her zaman önceliklidir.
  // Tarihsel pozitif ROI tek başına AKTİF yapmaz; özellikle Sıralı 5'li büyük ikramiye
  // yoğunlaşması nedeniyle yalnız SHADOW ADAY olarak izlenir.
  try{
    const v321=globalThis.TKP_V321_SIDEBET_CALIBRATION?.recommendation?.(product);
    if(v321)return {play:false,strong:false,label:v321.label,mode:v321.mode,verified:true,reason:v321.reason,v321:true};
  }catch(_){ }
  // Geçmiş AGF/ODS sırasının yarıştan önce alındığını kanıtlayan zaman damgası yoksa
  // hit/ROI yüksek görünse bile gerçek para OYNA kararı üretme. Kart shadow olarak
  // görünür; haftalık saat-kilitli örneklem terfi kapısını geçerse ayrıca onaylanır.
  const diagnostic=db?.settings?.verified_bet_optimizer?.recommendations?.[product];
  const mode=String(diagnostic?.mode||'SHADOW').toLocaleUpperCase('tr-TR');
  return {play:false,strong:false,label:mode==='PAS'?'PAS':(mode==='SHADOW_CANDIDATE'?'SHADOW ADAY':'SHADOW'),mode,verified:false,reason:'Yarış-öncesi zaman damgası kanıtlı haftalık canlı örneklem bekleniyor'};
}

let _tkpSideBetTicketHtmlCache=new WeakMap();
function tkpInvalidateSideBetTicketHtmlCache(){ _tkpSideBetTicketHtmlCache=new WeakMap(); }
function tkpCloneSideBetExactSpecs(rows){
  try{return JSON.parse(JSON.stringify(rows||[]));}catch(_){return [];}
}
function tkpSideBetTicketRaceReference(race={}){
  const hasResult=(race?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0);
  return {meeting_uid:String(race?.meeting_uid||race?.file_id||''),race_uid:String(race?.race_uid||race?.id||''),file_id:String(race?.file_id||''),
    race_date:String(race?.race_date||race?.date||''),hippodrome:String(race?.hippodrome||''),altili_no:Number(race?.altili_no)||1,leg:Number(race?.leg)||0,
    race_start_at:String(race?.race_start_at||race?.start_at||race?.race_start||race?.start_time_iso||''),tjk_race_time:String(race?.tjk_race_time||race?.race_time||race?.start_time||race?.time||''),result_known:hasResult};
}
function tkpSideBetDeliverExactSpecs(options,rows){
  if(Array.isArray(options?.exactSpecs))options.exactSpecs.push(...tkpCloneSideBetExactSpecs(rows));
}
function tkpSideBetExactGateTag(product){
  try{
    const gate=typeof globalThis.tkpWeeklyModelTrackerSideBetGate==='function'?globalThis.tkpWeeklyModelTrackerSideBetGate(product):null;
    return gate?.exact===true?` · ${String(gate.label||'SHADOW')} ${Number(gate.events)||0}/${Number(gate.minimum)||150}`:'';
  }catch(_){return '';}
}
function tkpSideBetTicketHtmlSignature(x,nextRace){
  const leg=Number(x?.r?.leg)||0;
  const couponPart=['main','alt','surprise'].map(key=>{
    const coupon=activeCoupons?.[key];
    const row=(coupon?.legs||[]).find(item=>Number(item?.r?.leg??item?.leg)===leg);
    return `${key}:${(row?.picks||[]).map(h=>String(h?.horse_no??h)).join(',')}`;
  }).join('|');
  // Inspect only these two races, never scan historical logs on a ticket cache hit.
  const racePart=rx=>{
    const r=rx?.r||{},rows=rx?.scored||r.horses||[];
    return JSON.stringify([r.id??'',r.file_id??'',r.leg??'',rows.map(h=>[
      h?.horse_no,Number(isNonRunner(h)),h?.score,h?.predicted_rank,h?.tkp_probability,
      h?.finish_position,h?.winner
    ])]);
  };
  return `${Number(_sideBetSignatureEpoch)||0}|${leg}|${racePart(x)}|${racePart(nextRace)}|${couponPart}`;
}

function sideBetTicketForRace(x, stats, nextRace=null, options={}){
  // Bir ayak ilk kez üretildikten sonra sekme değiştirip geri dönmek aynı 25 kartı
  // ve maliyet kombinasyonlarını tekrar kurmamalı. Veri/sonuç/kupon değişiklikleri
  // invalidateSideBetCache() üzerinden epoch'u artırır; WeakMap eski yarışları
  // bellekte tutmaz.
  const ticketCacheKey=x?.r&&typeof x.r==='object'?x.r:null;
  const ticketCacheSignature=tkpSideBetTicketHtmlSignature(x,nextRace);
  const ticketCached=ticketCacheKey?_tkpSideBetTicketHtmlCache.get(ticketCacheKey):null;
  if(ticketCached?.signature===ticketCacheSignature){tkpSideBetDeliverExactSpecs(options,ticketCached.exactSpecs||[]);return ticketCached.html;}
  const exactSpecs=[];
  const captureExact=(product,pools,combinations,cost,meta={})=>{
    if(meta.primary!==true||!(pools||[]).length)return;
    exactSpecs.push({product,primary:true,variant:'primary',title:String(meta.title||''),pools:(pools||[]).map(pool=>(pool||[]).map(no=>String(no))),
      combinations:Number(combinations)||0,cost:Number(cost)||0,unit:Number(meta.unit)||0,payout_keys:(meta.payout_keys||[]).map(String),unordered:meta.unordered===true,use_ekuri:meta.use_ekuri===true,
      races:(meta.races||[x?.r]).map(tkpSideBetTicketRaceReference)});
  };
  // Yan bahis aday havuzları mevcut sıralama/kapsama motorunu korur. TEKLİ OYUN ise
  // ayrı bir TEK üretmez: yalnız aktif Normal/Geniş/Sürpriz kupon kartlarında TEK görünen
  // ayakları kullanır. Genel Bakış liderinden otomatik veya yedek TEK oluşturulmaz.
  const predictionPlan=sideBetStrategyPlan(x);
  const archived=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x);
  const displayRows=typeof tkpFinalRankOrderForRace==='function'
    ? tkpFinalRankOrderForRace(x.r,(x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h)))
    : ((typeof predictionDisplayRows==='function')?predictionDisplayRows(x,Infinity,'score-desc').rows:strategicOrderForRace(x.r,(x.scored||[])));
  // TABELA / DÖRTLÜ DÜZELTMESİ:
  // Görünür Tahmin tablosu bazı koşularda ilk 10 satırla sınırlı olabilir. Yan bahis motoru
  // gerçek koşan at sayısını ve hesaplanan tam sıralamayı kullanır; görünür Tahmin sırası
  // önce korunur, kalan koşan atlar skor sırasıyla arkaya eklenir.
  const visibleOrder=displayRows.filter(h=>!isNonRunner(h));
  const fullOrder=(predictionPlan.sequence||visibleOrder).filter(h=>!isNonRunner(h));
  const ord=visibleOrder.map(h=>String(h.horse_no));
  if(!ord.length){
    if(ticketCacheKey)_tkpSideBetTicketHtmlCache.set(ticketCacheKey,{signature:ticketCacheSignature,html:'',exactSpecs:[]});
    return '';
  }
  // YAN BAHİS TEKLİ OYUN KAYNAĞI: Genel Bakış lideri veya yan bahis motorunun
  // kendi TEK kararı kullanılmaz. Yalnız aktif Normal/Geniş/Sürpriz kuponların
  // gerçekten ürettiği TEK ayaklar alınır. Aynı at birden fazla kuponda TEK ise tek
  // kartta kaynakları birlikte yazılır; farklı atlar TEK ise ayrı kartlar üretilir.
  const couponSingles=v25CouponSinglesForRace(x).filter(s=>(x.r.horses||[]).some(h=>
    String(h.horse_no)===String(s.no) || sameEkuri(h.horse_no,s.no)
  ));
  // Koşu uygunluğu görünür satır sayısından değil, gerçek koşan at sayısından belirlenir.
  const starterCount=(x.r && Array.isArray(x.r.horses))
    ? x.r.horses.filter(h=>!isNonRunner(h)).length
    : ord.length;
  const officialBetList=typeof tkpCanonicalBetList==='function'
    ? tkpCanonicalBetList(x.r?.available_bets)
    : (Array.isArray(x.r?.available_bets) ? x.r.available_bets.map(String) : []);
  const hasOfficialBetInfo=officialBetList.length>0;
  const officialHas=(...keys)=>keys.some(k=>officialBetList.includes(k));
  // KESİN KURAL: Yarış programında bulunmayan bahis için tahmin/kupon üretilmez.
  // Liste boş veya eksikse sistem bahis varmış gibi varsayım yapmaz.
  const betAvailable=(keys)=>officialHas(...keys);

  function uniq(arr){ return [...new Set((arr||[]).filter(no=>no!=null && String(no).trim()!==''))]; }
  // Tek varsa her zaman 1. sırada; ardından Sağlam Tek Kupon'un garanti ettiği atlar (en güçlü
  // favori + zorunlu BMB/ODB + en güçlü geçmiş kazanan — Çifte'nin doublePoolForRace ile zaten
  // okuduğu aynı liste), en son Genel Bakış sıralamasının kalanı eklenir. ÖNCEDEN bu liste
  // (predictionPlan.picks) sadece Çifte'de kullanılıyordu; İkili/Sıralı İkili/Üçlü/Dörtlü kendi
  // dar eşiğini kullandığı için Çifte tutarken Sıralı İkili tutmayabiliyordu — artık hepsi aynı
  // garanti listesinden besleniyor. Aynı at farklı sıra havuzlarında tekrar edebilir; tek
  // kombinasyon içindeki tekrar permCount() içindeki !c.includes(x) kontrolüyle engellenir.
  const guaranteedNos=(predictionPlan.picks||[]).map(h=>String(h.horse_no));
  const strategyNos=(predictionPlan.sequence||[]).map(h=>String(h.horse_no));
  const seq=uniq([...strategyNos, ...ord, ...guaranteedNos]);
  const sideBetHorseSource=(x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h));
  const baseGenericPositionRankings=archived
    ? (()=>{
        const out={};
        for(let position=1;position<=5;position++){
          out['p'+position]=typeof tkpArchivedSideBetFrozenOrder==='function'
            ?tkpArchivedSideBetFrozenOrder(x.r,sideBetHorseSource,`sidebet_p${position}_rank`)
            :sideBetHorseSource.slice();
        }
        return out;
      })()
    : (typeof sideBetPositionRankingsForRace==='function'?sideBetPositionRankingsForRace(x.r,sideBetHorseSource):null);
  const genericPositionRankings=!archived&&globalThis.TKP_POSITION_RUNTIME?.orderedPairRankings
    ?globalThis.TKP_POSITION_RUNTIME.orderedPairRankings(x.r,sideBetHorseSource,baseGenericPositionRankings):baseGenericPositionRankings;
  const productRankings={
    triple:tkpSideBetProductRankings(x.r,sideBetHorseSource,'triple'),
    quartet:tkpSideBetProductRankings(x.r,sideBetHorseSource,'quartet'),
    quintet:tkpSideBetProductRankings(x.r,sideBetHorseSource,'quintet')
  };
  const productPositionNos=product=>Array.from({length:5},(_,index)=>
    ((product==='generic'?genericPositionRankings:productRankings[product])?.['p'+(index+1)]||[]).map(h=>String(h.horse_no))
  );
  const exactPositionNos=productPositionNos('generic');
  const moneySignalNos=uniq((predictionPlan.moneySignalPicks||[]).map(h=>String(h.horse_no)));
  const protectedMoneySignalNos=new Set(moneySignalNos);
  const portfolioSignalNos=uniq((predictionPlan.portfolioPicks||[]).map(h=>String(h.horse_no)));
  const protectedCoverageNos=new Set(moneySignalNos.concat(portfolioSignalNos));
  // V1.1.135 YAN BAHİS ÇEKİRDEK KORUMASI:
  // Ana sıralamada ilk 5'te olup P1-P5 modellerinden en az birinde de ilk 5'e giren at,
  // bütçe daraltması sırasında bütün pozisyon havuzlarından birden yok edilemez.
  // Bu koruma atı her pozisyona zorlamaz; yalnız bilette en az bir gerçek pozisyon şansı bırakır.
  const exactTop5Nos=new Set(Array.from({length:5},(_,i)=>(baseGenericPositionRankings?.['p'+(i+1)]||[]).slice(0,5).map(h=>String(h.horse_no))).flat());
  const criticalCoverageNos=new Set(ord.slice(0,5).map(String).filter(no=>exactTop5Nos.has(no)));
  const canSiraliIkili=betAvailable(['sirali_ikili']) && seq.length>=2;
  const canTriple=betAvailable(['sirali_uclu','uclu_bahis']) && seq.length>=3;
  const canQuartet=betAvailable(['tabela']) && seq.length>=4;
  const canQuintet=betAvailable(['sirali_5li']) && seq.length>=5;
  // Her sıra (pozisyon) için birden fazla at içeren, KÜMÜLATİF (biriken) havuz: pozisyon k'nın
  // havuzu HER ZAMAN en tepeden (1. sıradan) başlar; pozisyon ilerledikçe havuz sadece
  // GENİŞLER (daha zayıf sıralı atlar eklenir), önceki güçlü adaylar asla dışarıda kalmaz.
  // Önceki "kaydırmalı pencere" (seq[k..k+width)) tasarımı, en güçlü atı (seq[0]) 1. sıra
  // dışındaki her pozisyondan tamamen dışlıyordu — oysa güçlü bir favori 2./3./4. de gelebilir.
  // Aynı at farklı sıra havuzlarında zaten tekrar edebilir; tek kombinasyon içindeki tekrar
  // permCount() içindeki !c.includes(x) kontrolüyle engellenir.
  const sideBetDecisionPolicies=new Map();
  function learnedSideBetWidth(product,posIndex,fallbackWidth,exact){
    if(product==='generic')return fallbackWidth;
    const key=[product,posIndex,fallbackWidth].join('|');
    if(sideBetDecisionPolicies.has(key))return sideBetDecisionPolicies.get(key).coverage;
    let policy=null;
    try{
      policy=typeof tkpAdaptiveDecisionPolicy==='function'
        ?tkpAdaptiveDecisionPolicy(x.r,exact,{mode:'sidebet',product,position:posIndex+1,fallback:fallbackWidth})
        :null;
    }catch(_){policy=null;}
    const coverage=Math.max(1,Math.min(12,Number(policy?.coverage)||fallbackWidth));
    sideBetDecisionPolicies.set(key,{coverage,policy});
    return coverage;
  }
  function positionPool(posIndex,width,product='generic'){
    const sourceNos=productPositionNos(product);
    const exact=sourceNos[posIndex]&&sourceNos[posIndex].length?sourceNos[posIndex]:seq;
    if(product!=='generic'){
      // Üçlü / Dörtlü / Beşli her bitiriş pozisyonunu ayrı öğrenir. Böylece
      // 1. sıra dar iken 3.-5. sıra otomatik genişleyebilir; sabit 5×6×7 vb.
      // yalnız güvenli başlangıç genişliğidir.
      const ranked=(productRankings?.[product]?.['p'+(posIndex+1)]||[]);
      return uniq(exact.slice(0,learnedSideBetWidth(product,posIndex,width,ranked)));
    }
    // Pozisyona özel öğrenilmiş sıra ana omurgadır. BMB/ODB/TKP para sinyalleri
    // bunun sonuna eklenir; sıralı bahislerin hiçbir pozisyon havuzundan sessizce düşmez.
    const signalOrder=exact.filter(no=>protectedMoneySignalNos.has(String(no)));
    // P1 saf birincilik modelidir. Karşıt portföy adayları yalnız P2-P5
    // havuzlarına girer; böylece yan bahis kuyruk kapsaması artarken banko/lider
    // kararı yapay biçimde bozulmaz.
    const portfolioOrder=posIndex===0?[]:portfolioSignalNos;
    return uniq(exact.slice(0,width).concat(signalOrder,moneySignalNos,portfolioOrder));
  }
  // KALİBRASYON: pencere genişliği artık sabit 5/7 değil, Tahmin/Kupon'da kullanılan aynı
  // self-adjusting SONUÇ eşiğinden (adaptiveSonucThreshold) türetiliyor. Böylece dar alanlarda
  // (th=6) pencere küçük, Handikap gibi daha rastgele ailelerde (th=7-10) otomatik geniş.
  function sideBetWindowWidth(posIndex){
    // Arşiv ekranında matchedResultRankStats() ile bütün toplantıları yeniden tarama.
    // Frozen sıra değişmez; yalnız alan/koşu türüne göre güvenli taban kullanılır.
    const archiveFast=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x);
    const th = archiveFast
      ? ((typeof isHandikapRace==='function'&&isHandikapRace(x.r))?8:6)
      : adaptiveSonucThreshold(x.r);
    const base = Math.max(2, Math.round(th/2));
    const metric=posIndex===0?(stats?.sirali||stats?.ikili):(stats?.ikili||stats?.sirali);
    let learnedAdjust=0;
    if(metric && Number(metric.total)>=SIDE_BET_MIN_RACES){
      const rate=Number(metric.rate)||0;
      learnedAdjust=rate<0.55?2:(rate<0.72?1:(rate>0.88?-1:0));
    }
    let width=base+Math.min(posIndex,2)+learnedAdjust;
    // Zor yarışta ortak 6-8 at omurgası yan bahiste de kademeli olarak açılır;
    // ilk pozisyon gereksiz şişmez, sonraki pozisyonlar zor yarış tabanına yaklaşır.
    if(predictionPlan.hardMin){
      const floors=[Math.max(4,predictionPlan.hardMin-3),Math.max(5,predictionPlan.hardMin-2),Math.max(6,predictionPlan.hardMin-1),predictionPlan.hardMin];
      width=Math.max(width,floors[posIndex]||predictionPlan.hardMin);
    }
    return Math.min(seq.length,Math.max(2,width));
  }
  // Her atın kendi asıl Tahmin sırasını (1-5) taşıyan harita — sıra önemli bahislerde
  // (Sıralı İkili/Üçlü/Dörtlü) renkli rozetle işaretlemek için kullanılır.
  // Renkli rozet, HER ZAMAN Tahmin/Genel Bakış'ta gösterilen gerçek 1./2./3./4./5. sırayı (ord)
  // yansıtır — tek (singleNo) havuz kurulumunda öne alınsa bile rozet rengi karışmaz.
  const rankMap=new Map(ord.map((no,i)=>[no,i+1]));
  function mode(g){ return g.ready ? '<span class="sideBetReady">Aktif öneri</span>' : '<span class="sideBetWait">Ön izleme</span>'; }
  function unavailableCard(title,min){
    return `<div class="sideBetTicketCard disabledBet"><div class="sideBetTicketHead"><h4>${esc(title)}</h4></div><div class="sideBetUnavailable">Bu bahis için en az <b>${min} at</b> gerekir.<br>Bu koşuda ${starterCount} at var; kupon üretilmedi.</div></div>`;
  }
  // KRAL KURALI: TJK Altılı Ganyan'ın 1. ayağında Sıralı Üçlü ve Dörtlü/Tabela bahisleri oynanmaz.
  // At sayısı yeterli olsa bile bu ayakta bu bahis türleri hiç sunulmaz.
  // V29: Resmi bahis listesi eksikse 1. ayak sanılıp tüm yan bahisleri kapatma. Tahmin her koşuda üretilir; oynanabilirlik terminal/TJK bilgisidir.
  const isFirstAltiliLeg = Number(x.r?.leg)===1;
  function ruleUnavailableCard(title){
    return `<div class="sideBetTicketCard disabledBet"><div class="sideBetTicketHead"><h4>${esc(title)}</h4></div><div class="sideBetUnavailable">TJK kuralı gereği Altılı Ganyan'ın <b>1. ayağında</b> bu bahis oynanamaz.</div></div>`;
  }
  function officialUnavailableCard(title){
    return `<div class="sideBetTicketCard disabledBet"><div class="sideBetTicketHead"><h4>${esc(title)}</h4></div><div class="sideBetUnavailable">TJK HTML'de bu koşu için <b>${esc(title)}</b> görünmüyor; kupon üretilmedi.</div></div>`;
  }
  // Her bahis türü için ayrı maliyet tavanı. Tavan aşılırsa korumasız kuyruklar kademeli
  // daraltılır. BMB/ODB/TKP sinyali maliyet uğruna atılmaz ve kupon TEK'i dışında yeni,
  // gizli bir yan-bahis TEK'i oluşturulmaz.
  const sideLimits=(typeof _v25ReadSideBetLimits==='function')?_v25ReadSideBetLimits():{uclu:450,dortlu:750,sirali5li:750};
  const COST_LIMIT={ikili:120, sirali:120, uclu:sideLimits.uclu, dortlu:sideLimits.dortlu, sirali5li:sideLimits.sirali5li};
  function candidateStrength(no){
    const h=(x.scored||[]).find(hh=>String(hh.horse_no)===String(no));
    return h ? (conditionSingleStrength(x.r,h)||0) : 0;
  }
  function uniqueUnorderedCount(pools){
    const seenPair=new Set();
    let c=0;
    for(const combo of combosFromPools(pools)){
      const key=combo.slice().sort().join('-');
      if(seenPair.has(key)) continue;
      seenPair.add(key);
      c++;
    }
    return c;
  }
  // BMB/ODB'li güçlü sürpriz adayları sadece geniş havuzlara güvenip "belki girer" değil,
  // doğrudan 1. VE 2. sıraya da eklenir — asıl para bu atlar erken sırada (1. veya 2.) çıkınca
  // veriyor; 3./4. sıra zaten geniş olduğu için onları otomatik kapsıyor.
  function injectSurpriseIntoEarlyPositions(r, pos1, pos2, pool, maxInject){
    // Normal/Geniş omurgası korunur; Sürpriz kuponun TKP 3-4-5 bandından seçtiği
    // en sağlam iki aday erken sıra havuzlarının SONUNA eklenir. Maliyet kontrolü
    // gerekirse zayıf kuyruktan daraltır, Genel Bakış liderini çıkarmaz.
    const extras=uniq((predictionPlan.surprisePicks||[]).slice(0,Math.max(0,maxInject||0)).map(h=>String(h.horse_no)).concat(moneySignalNos));
    return {pos1:uniq(pos1.concat(extras)),pos2:uniq(pos2.concat(extras))};
  }

  function ensureMinPoolCost(pools, unit, minCost, seqSource, maxWidth, counter){
    const count=counter||permCount;
    let current=pools.map(p=>p.slice());
    let c=count(current);
    let guard=0;
    while(c*unit<minCost && guard<200){
      guard++;
      let idx=-1, minLen=Infinity;
      current.forEach((p,i)=>{ if(p.length<seqSource.length && p.length<maxWidth && p.length<minLen){ minLen=p.length; idx=i; } });
      if(idx===-1) break;
      current[idx]=seqSource.slice(0,current[idx].length+1);
      c=count(current);
    }
    return {pools:current,c};
  }
  function applyCostControl(pools, unit, limit, counter, minPoolLen=1){
    const count=counter||permCount;
    let current=pools.map(p=>p.slice());
    let c=count(current);
    const maxCombos=Math.floor(limit/unit);
    const removableAt=(allPools,poolIndex,itemIndex)=>{
      const pool=allPools[poolIndex]||[];
      if(itemIndex<0||itemIndex>=pool.length) return false;
      // Lider mümkün olduğunca korunur; minPoolLen zaten matematiksel tabanı korur.
      if(itemIndex===0 && pool.length>Math.max(2,minPoolLen)) return false;
      return tkpSideBetCanRemoveCandidate(allPools,poolIndex,itemIndex,protectedCoverageNos,criticalCoverageNos,minPoolLen);
    };
    const shrinkOne=(pool,poolIndex,allPools=current)=>{
      if(!Array.isArray(pool)||pool.length<=Math.max(2,minPoolLen)) return null;
      for(let i=pool.length-1;i>=1;i--){
        if(!removableAt(allPools,poolIndex,i)) continue;
        return pool.slice(0,i).concat(pool.slice(i+1));
      }
      return null;
    };
    // Aşama 1: limit aşılıyorsa, ÖNCE EN SONDAKİ pozisyondan başlanarak (en az kritik —
    // Üçlü'nün 3. sırası, Dörtlü'nün 4. sırası gibi) o pozisyonu tek başına 1 azaltmanın
    // limitin altına indirip indirmediğine bakılır; indiriyorsa hemen uygulanır. Böylece 1.
    // ve 2. sıra (İkili/Sıralı İkili/Üçlü/Dörtlü arasında PAYLAŞILAN pozisyonlar) olabildiğince
    // korunur — aksi halde Üçlü kendi ekstra pozisyonunu feda ederken, sadece 2 pozisyonu olan
    // Sıralı İkili'nin feda edecek yeri kalmayıp doğrudan 1./2. sıradan kısılması, aynı yarışta
    // Üçlü tutarken Sıralı İkili'nin tutmamasına yol açabiliyordu. Hiçbir tek pozisyon tek
    // başına yetmiyorsa, tüm havuzlar denenip tavana en yakın sonucu veren seçilir.
    let guard=0;
    while(c>maxCombos && guard<200){
      guard++;
      let appliedIdx=-1;
      for(let i=current.length-1;i>=0;i--){
        const smaller=shrinkOne(current[i],i,current);
        if(!smaller) continue;
        const trial=current.map((pp,j)=>j===i?smaller:pp);
        if(count(trial)<=maxCombos){ appliedIdx=i; break; }
      }
      if(appliedIdx!==-1){
        current[appliedIdx]=shrinkOne(current[appliedIdx],appliedIdx,current);
        c=count(current);
        continue;
      }
      let bestIdx=-1, bestCount=-1;
      current.forEach((p,i)=>{
        const smaller=shrinkOne(p,i,current); if(!smaller) return;
        const trial=current.map((pp,j)=>j===i?smaller:pp);
        const tc=count(trial);
        if(tc<=maxCombos && tc>bestCount){ bestCount=tc; bestIdx=i; }
      });
      if(bestIdx===-1){
        // Tek adımlık hiçbir daraltma limitin altına inmiyorsa, korumasız kuyruğu
        // olan en büyük havuz küçültülür. Para sinyalleri maliyet uğruna atılmaz.
        let idx=-1, maxLen=-1;
        current.forEach((p,i)=>{ if(shrinkOne(p,i,current) && p.length>maxLen){ maxLen=p.length; idx=i; } });
        if(idx===-1) break;
        current[idx]=shrinkOne(current[idx],idx,current);
        c=count(current);
        continue;
      }
      current[bestIdx]=shrinkOne(current[bestIdx]);
      c=count(current);
    }
    // KESİN BÜTÇE KİLİDİ: Korumalı BMB/ODB/TKP adayları yüzünden tavan hâlâ
    // aşılıyorsa kuyrukları (lideri en son koruyarak) sert biçimde daralt. Hiçbir
    // yan bahis kartı ayarlı bütçenin üzerinde maliyet gösteremez.
    let hardGuard=0;
    while(c>maxCombos && hardGuard++<500){
      let bestIdx=-1, bestItem=-1, bestCount=c;
      current.forEach((pool,i)=>{
        if(!Array.isArray(pool)||pool.length<=minPoolLen) return;
        // Kör `slice(0,-1)` YASAK: kuyruktaki CEVATHAN benzeri güçlü aday biletin
        // tamamından silinebiliyordu. Sondan başlayıp güvenli çıkarılabilir adayı ara.
        for(let item=pool.length-1;item>=0;item--){
          if(!removableAt(current,i,item)) continue;
          const smaller=pool.slice(0,item).concat(pool.slice(item+1));
          if(smaller.length<minPoolLen) continue;
          const trial=current.map((p,j)=>j===i?smaller:p);
          const tc=count(trial);
          if(tc<bestCount){ bestCount=tc; bestIdx=i; bestItem=item; }
          break;
        }
      });
      if(bestIdx===-1) break;
      const bp=current[bestIdx];
      current[bestIdx]=bp.slice(0,bestItem).concat(bp.slice(bestItem+1));
      c=bestCount;
    }
    // Matematiksel olarak uygun bir kombinasyon kalmadan tavan sağlanamıyorsa
    // pahalı kupon üretmek yerine kuponu güvenli biçimde boşalt.
    if(c>maxCombos) return {pools:current.map(()=>[]),c:0,budgetBlocked:true};
    return {pools:current,c,budgetBlocked:false};
  }
  // Kart üzerinde gösterilen geçmiş oran, artık yalnız bahis türünün geniş/genel havuzunu değil,
  // ekranda gerçekten oynatılan (maliyet kontrolüyle daraltılmış veya teksiz alternatif) havuzu ölçer.
  function ticketSpecificMetric(baseMetric, betKey, pools){
    const fallback={...(baseMetric||{})};
    fallback.ok=Number(fallback.ok)||0;
    fallback.total=Number(fallback.total)||0;
    fallback.rate=fallback.total?fallback.ok/fallback.total:0;
    // Canlı yan-bahis kartı açılırken her farklı havuz için 503 dosyayı yeniden
    // oynatmak seçimleri hiç değiştirmiyor, yalnız karttaki küçük geçmiş yüzdeyi
    // değiştiriyordu. Bir ayakta 8 kart x 6 ayak bu yüzden saniyelerce ana-thread
    // kilidi yaratıyordu. Canlı UI hazır profil özetini gösterir; exact havuz
    // denetimi yalnız açık backtest/audit çağrısı bu bayrağı açtığında çalışır.
    if(globalThis.__tkpExplicitSideBetMetricAudit!==true)return fallback;
    const rows=(stats&&stats._profile&&Array.isArray(stats._profile.rows))?stats._profile.rows:[];
    if(!rows.length || !Array.isArray(pools) || !pools.length) return fallback;
    function rowIdentity(row){
      const a=Array.isArray(row)?(row[0]||{}):(row&&row.row?row.row:row||{});
      return [String(a.race_date||''),fold(a.hippodrome||''),Number(a.leg)||0];
    }
    function isCurrentRow(row){
      const a=Array.isArray(row)?(row[0]||{}):(row&&row.row?row.row:row||{});
      if(!a||!x.r) return false;
      if(a===x.r) return true;
      if(Number(a.id)===Number(x.r.id) && Number(a.file_id)===Number(x.r.file_id) && Number(a.id)>0) return true;
      const [d,h,l]=rowIdentity(row);
      return d===String(x.r.race_date||'') && h===fold(x.r.hippodrome||'') && l===Number(x.r.leg);
    }
    function orderedNosForRow(row){
      if(Array.isArray(row)){
        return row.slice().sort((a,b)=>{
          const ra=Number(a.predicted_rank)||999, rb=Number(b.predicted_rank)||999;
          if(ra!==rb) return ra-rb;
          if(Number(b.score)!==Number(a.score)) return Number(b.score)-Number(a.score);
          return TKP_TR_COLLATOR_NUM.compare(String(a.horse_no),String(b.horse_no));
        }).map(a=>String(a.horse_no));
      }
      const r=row&&row.row?row.row:row;
      return r?(typeof historicalSideBetOrder==='function'?historicalSideBetOrder(r):historicalOrder(r)).map(h=>String(h.horse_no)):[];
    }
    function actualSequencesForRow(row,n){
      if(Array.isArray(row)){
        const byPos={};
        for(const a of row){
          const p=Number(a.finish_position);
          if(p>=1&&p<=n){ if(!byPos[p]) byPos[p]=[]; byPos[p].push(String(a.horse_no)); }
        }
        if(Array.from({length:n},(_,i)=>byPos[i+1]&&byPos[i+1].length).some(v=>!v)) return [];
        let seq=[[]];
        for(let p=1;p<=n;p++){
          const next=[];
          for(const cur of seq) for(const no of byPos[p]) next.push(cur.concat(no));
          seq=next;
        }
        return seq;
      }
      const r=row&&row.row?row.row:row;
      return r?validFinishSequences(r,n).map(seq=>seq.map(h=>String(h.horse_no))):[];
    }
    function historicalPools(nos){
      return pools.map((p,i)=>nos.slice(i,i+Math.max(1,(p||[]).length)));
    }
    function currentTicketOutcome(){
      const n=pools.length, actual=[];
      for(let pos=1;pos<=n;pos++){
        const hs=(x.r.horses||[]).filter(z=>Number(z.finish_position)===pos || (pos===1&&Number(z.winner)===1));
        if(!hs.length) return null;
        actual.push(String(hs[0].horse_no));
      }
        return actual.every((no,i)=>(pools[i]||[]).some(p=>_v25SameHorseExact(p,no)));
    }
    let ok=0,total=0,currentSeen=false;
    const n=pools.length;
    for(const row of rows){
      const nos=orderedNosForRow(row);
      const seqs=actualSequencesForRow(row,n);
      if(!nos.length||!seqs.length) continue;
      const hp=historicalPools(nos);
      let hit=seqs.some(seq=>seq.every((no,i)=>(hp[i]||[]).some(p=>_v25SameHorseExact(p,no))));
      if(isCurrentRow(row)){
        const live=currentTicketOutcome();
        if(live!==null){ hit=live; currentSeen=true; }
      }
      total++; if(hit) ok++;
    }
    if(!total) return fallback;
    // Profil kaydı mevcut yarışı kimlik farkı nedeniyle tanıyamasa bile ekrandaki sonuçla
    // yüzde birbirini inkâr edemez. TUTMADI kartı asla %100; TUTTU kartı asla %0 göstermez.
    const live=currentTicketOutcome();
    if(live!==null && !currentSeen){
      if(live && ok===0) ok=1;
      if(!live && ok===total) ok=Math.max(0,total-1);
    }
    return {ok,total,rate:total?ok/total:0,ready:total>=SIDE_BET_MIN_RACES,ticketSpecific:true};
  }

  const cards=[];

  // ---- Çifte: mevcut koşu + sıradaki ardışık koşu. Havuzlar Tahmin/Altılı ile aynı kapsama planından gelir.
  const nextHasOfficialDoubleResult=(nextRace?.r?.payouts||[]).some(entry=>{
    const key=typeof tkpCanonicalBetKey==='function' ? tkpCanonicalBetKey(entry?.key||entry?.label) : String(entry?.key||'');
    return key==='cifte';
  });
  // Sonuç yüklenmemişken yalnız MEVCUT koşunun TJK programındaki Çifte başlangıcı
  // geçerlidir. Sonraki koşunun program listesi başka bir çifti (2-3 gibi) ifade
  // edebilir ve mevcut çifte taşınamaz. Yalnız resmi sonuç yüklendiyse ikinci
  // koşudaki Çifte ikramiyesi bu çifti doğrular.
  const doubleIsOffered=officialHas('cifte') || nextHasOfficialDoubleResult;
  if(nextRace && Number(nextRace.r.leg)===Number(x.r.leg)+1 && doubleIsOffered){
    const infoA=doublePoolWithRelaxedSingle(x), infoB=doublePoolWithRelaxedSingle(nextRace);
    // V54 HIT-FIRST seçimi: Çifte COMMON 5x5. Ortak/Champion sırası kullanılır;
    // yan-bahis P1 modeli Çifte'yi değiştirmez. Küçük alanlarda mevcut at sayısı kadar alınır.
    const doubleCommonOrder=(raceX)=>{
      let rows=[];
      try{
        if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(raceX)){
          rows=typeof tkpArchivedOrderedRows==='function'
            ?tkpArchivedOrderedRows(raceX)
            :(raceX.scored||raceX.r?.horses||[]);
        }else rows=typeof strategicOrderForRace==='function'
          ?strategicOrderForRace(raceX.r,(raceX.scored||raceX.r?.horses||[])):[];
      }catch(_){ rows=[]; }
      if(!rows.length) rows=(raceX.scored||raceX.r?.horses||[]).filter(h=>h&&!isNonRunner(h));
      return uniq(rows.filter(h=>!isNonRunner(h)).map(h=>String(h.horse_no)));
    };
    const doubleOrderA=doubleCommonOrder(x),doubleOrderB=doubleCommonOrder(nextRace),doubleWidths=tkpEffectiveSideBetWidths('cifte');
    const championDoubleA=doubleOrderA.slice(0,doubleWidths[0]||5);
    const championDoubleB=doubleOrderB.slice(0,doubleWidths[1]||5);
    const doubleDecision=tkpSideBetProductPlayDecision('cifte',[x.r,nextRace.r],null,[championDoubleA,championDoubleB]);
    const doubleRankMaps=[new Map(doubleOrderA.map((no,i)=>[no,i+1])),new Map(doubleOrderB.map((no,i)=>[no,i+1]))];
    if((championDoubleA.length||infoA.raw.length) && (championDoubleB.length||infoB.raw.length)){
      infoA.raw=championDoubleA.length?championDoubleA:infoA.raw;
      infoB.raw=championDoubleB.length?championDoubleB:infoB.raw;
      const winA=(x.r.horses||[]).find(h=>Number(h.winner)===1 || Number(h.finish_position)===1);
      const winB=(nextRace.r.horses||[]).find(h=>Number(h.winner)===1 || Number(h.finish_position)===1);
      function buildDoubleCard(poolA,poolB,titleSuffix,extraCls,widenAlternative=false,primary=false){
        let workA=poolA, workB=poolB;
        if(widenAlternative){
          // Teksiz Alternatif: bilet 40 TL altına düşmesin diye, her iki yarışın
          // kendi tam sıralı listesinden ek at çekilerek havuzlar önce genişletilir.
          const seqAFull=tkpOrderedForLeg(x).filter(h=>!isNonRunner(h)).map(h=>String(h.horse_no));
          const seqBFull=tkpOrderedForLeg(nextRace).filter(h=>!isNonRunner(h)).map(h=>String(h.horse_no));
          const widened=ensureMinDoubleCost(poolA,poolB,SIDE_BET_UNITS.cifte,DOUBLE_MIN_COST,seqAFull,seqBFull,10);
          workA=widened.a; workB=widened.b;
        }
        const {a:pA,b:pB}=trimDoublePools(workA,workB,SIDE_BET_UNITS.cifte,DOUBLE_COST_LIMIT,infoA.protectedNos,infoB.protectedNos,widenAlternative?2:1);
        const combos=pA.length*pB.length;
        const cost=combos*SIDE_BET_UNITS.cifte;
        let resultStatus='<span class="sideBetWait">BEKLENİYOR</span>';
        let resultClass='';
        let realPayoutHTML='';
        if(winA && winB){
          const hit=_v25PoolHasHorse(pA,winA.horse_no) && _v25PoolHasHorse(pB,winB.horse_no);
          resultStatus=hit
            ? `<span class="sideBetResult hit">TUTTU · Kazanan: ${esc(winA.horse_no)} / ${esc(winB.horse_no)}</span>`
            : `<span class="sideBetResult miss">TUTMADI · Kazanan: ${esc(winA.horse_no)} / ${esc(winB.horse_no)}</span>`;
          resultClass=hit?' resultHit':' resultMiss';
          realPayoutHTML=sideBetRealPayoutHTML(nextRace.r,['cifte'],hit,[pA,pB],{useEkuri:true});
        }
        const dstat=sideBetDoubleBacktestFast(x.r,nextRace.r);
        const metric={rate:dstat.rate,total:dstat.total,ok:dstat.ok};
        if(winA && winB && metric.total){
          const liveHit=_v25PoolHasHorse(pA,winA.horse_no) && _v25PoolHasHorse(pB,winB.horse_no);
          if(!liveHit && metric.ok===metric.total) metric.ok=Math.max(0,metric.total-1);
          if(liveHit && metric.ok===0) metric.ok=1;
          metric.rate=metric.ok/metric.total;
        }
        const title=`Çifte ${x.r.leg}-${nextRace.r.leg}. Koşu · ${doubleDecision.label}${titleSuffix}${tkpSideBetExactGateTag('cifte')}`;
        const dprofileNote=`${dstat.total?`Profil: ${dstat._profile.level} · `:''}${doubleDecision.reason}`;
        captureExact('cifte',[pA,pB],combos,cost,{primary,title,unit:SIDE_BET_UNITS.cifte,payout_keys:['cifte'],use_ekuri:true,races:[x.r,nextRace.r]});
        const rescueHTML=typeof tkpV55SideBetRescueHTML==='function'
          ? tkpV55SideBetRescueHTML(title,[pA,pB],combos,cost,resultStatus,[x.r.horses,nextRace.r.horses],doubleRankMaps)
          : '';
        return (sideBetTicketCard(title,[pA,pB],combos,cost,resultStatus,metric,extraCls+resultClass,[x.r.horses,nextRace.r.horses],doubleRankMaps,'çift',dprofileNote,realPayoutHTML)+rescueHTML)
          .replace('1.</span>',x.r.leg+'. Koşu</span>')
          .replace('2.</span>',nextRace.r.leg+'. Koşu</span>');
      }

      // Çifte TEKLİ OYUN da yalnız kuponların ürettiği TEK ayaklardan kurulur.
      // Her kupon tipi kendi iki ayak yapısıyla değerlendirilir: kupon bu iki koşudan
      // birinde veya ikisinde TEK üretmişse aynı TEK(ler) Çifte kartına sabitlenir.
      // Genel Bakış liderinden otomatik/fallback TEK üretilmez.
      const doublePlans=v25CouponDoubleSinglePlans(x,nextRace);
      const singleCards=[];
      for(const plan of doublePlans){
        const pA=plan.aNo&&infoA.raw.includes(String(plan.aNo))?[String(plan.aNo)]:infoA.raw.slice();
        const pB=plan.bNo&&infoB.raw.includes(String(plan.bNo))?[String(plan.bNo)]:infoB.raw.slice();
        if(pA.length===infoA.raw.length && pB.length===infoB.raw.length) continue;
        singleCards.push(buildDoubleCard(pA,pB,' · '+v25CouponSingleTitle(plan.labels),'doubleTicket featuredBet',false,false));
      }
      const doubleAltPoolsPreview=[infoA.raw,infoB.raw];
      const altCard=buildDoubleCard(infoA.raw,infoB.raw,' · '+v25AlternativeLabel(doubleAltPoolsPreview),'doubleTicket',true,true);
      if(singleCards.length){
        cards.push(v25SingleAlternativePair(singleCards,altCard));
      } else {
        cards.push(altCard);
      }
    }
  }

  // Düz İkili ve düz Üçlü yok; yalnız Çifte, Sıralı İkili, Sıralı Üçlü ve Dörtlü/Tabela gösterilir.

  // ---- Sıralı İkili: iki ayrı kart üretilir.
  // 1) TEKLİ OYUN: Bu ayakta Normal/Geniş/Sürpriz kuponun ürettiği TEK(ler) 1. pozisyona sabitlenir.
  // 2) Teksiz Alternatif: mevcut çoklu güvenlik havuzu korunur.
  // Resmî maliyet denetiminde 1×5 şema 4 gerçek kombinasyon/4 TL'dir. Eski 20 TL
  // yapay tabanı doğrulanmış düşük-maliyetli havuzu yeniden 5×5'e şişiriyordu.
  const SIRALI_MIN_COST=4;
  if(canSiraliIkili){
    // V44 walk-forward seçimi: Sıralı İkili C-S 5x5. Pozisyon kaynağı
    // online-ranking-engine'deki C-S-S-C-S yönlendirmesidir; burada yalnız testte
    // en dengeli çıkan minimum havuz genişliği kilitlenir. Bütçe kontrolü gerekirse daraltabilir.
    const siraliWidths=tkpEffectiveSideBetWidths('sirali');
    let altPos1=positionPool(0,Math.max(siraliWidths[0]||5,sideBetWindowWidth(0)));
    let altPos2=positionPool(1,Math.max(siraliWidths[1]||5,sideBetWindowWidth(1)));
    const widened=ensureMinPoolCost([altPos1,altPos2],SIDE_BET_UNITS.sirali,SIRALI_MIN_COST,seq,10,permCount);
    altPos1=widened.pools[0]; altPos2=widened.pools[1];
    if(altPos2.length<altPos1.length) altPos2=seq.slice(0,altPos1.length);

    const {pools:altPools,c:altC}=applyCostControl([altPos1,altPos2],SIDE_BET_UNITS.sirali,COST_LIMIT.sirali,permCount,2);
    const altStatus=sideBetOutcomeStatus(altPools,x.r.horses);
    const siraliDecision=tkpSideBetProductPlayDecision('sirali',x.r,null,altPools);
    const siraliTitle=v25AlternativeTitle(`Sıralı İkili · ${siraliDecision.label}`,altPools)+tkpSideBetExactGateTag('sirali_ikili');
    captureExact('sirali_ikili',altPools,altC,altC*SIDE_BET_UNITS.sirali,{primary:true,title:siraliTitle,unit:SIDE_BET_UNITS.sirali,payout_keys:['sirali_ikili'],races:[x.r]});
    const altCard=sideBetTicketCard(siraliTitle,altPools,altC,altC*SIDE_BET_UNITS.sirali,altStatus,ticketSpecificMetric(stats.sirali,'sirali',altPools),siraliDecision.mode==='PAS'?'sideBetPass':'sideBetCaution',x.r.horses,rankMap,'yarış',siraliDecision.reason,sideBetRealPayoutHTML(x.r,['sirali_ikili'],altStatus.includes('TUTTU'),altPools))
      +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(siraliTitle,altPools,altC,altC*SIDE_BET_UNITS.sirali,altStatus,x.r.horses,rankMap):'');

    const singleCards=couponSingles.map(single=>{
      const {pools:singlePools,c:singleC}=applyCostControl([[single.no],altPos2],SIDE_BET_UNITS.sirali,COST_LIMIT.sirali,permCount);
      const singleTitle=`Sıralı İkili · ${v25CouponSingleTitle(single.labels)}`;
      const singleStatus=sideBetOutcomeStatus(singlePools,x.r.horses);
      return sideBetTicketCard(singleTitle,singlePools,singleC,singleC*SIDE_BET_UNITS.sirali,singleStatus,ticketSpecificMetric(stats.sirali,'sirali',singlePools),'featuredBet',x.r.horses,rankMap,'yarış',null,sideBetRealPayoutHTML(x.r,['sirali_ikili'],singleStatus.includes('TUTTU'),singlePools))
        +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(singleTitle,singlePools,singleC,singleC*SIDE_BET_UNITS.sirali,singleStatus,x.r.horses,rankMap):'');
    });
    if(singleCards.length) cards.push(v25SingleAlternativePair(singleCards,altCard));
    else cards.push(altCard);
  }else if(!officialHas('sirali_ikili')) cards.push(officialUnavailableCard('Sıralı İkili'));
  else cards.push(unavailableCard('Sıralı İkili',2));

  // ---- Sıralı Üçlü: gerçek veri taramasında seçilen pozisyon modelleri + 5x6x7.
  if(canTriple && !isFirstAltiliLeg){
    const rankings=productRankings.triple,widths=tkpEffectiveSideBetWidths('triple');
    const pools0=widths.map((w,i)=>positionPool(i,w,'triple'));
    const decision=tkpSideBetProductPlayDecision('triple',x.r,rankings,pools0);
    const profileNote=`Doğrulanmış pozisyon havuzu · ${decision.label} · ${decision.reason}. Gelecek sonuç garantisi değildir.`;
    const {pools:altPools,c:altC}=applyCostControl(pools0,SIDE_BET_UNITS.uclu,COST_LIMIT.uclu,permCount,2);
    const altStatus=sideBetOutcomeStatus(altPools,x.r.horses);
    const title=`Sıralı Üçlü · ${decision.label} · ${v25AlternativeLabel(altPools)}`;
    captureExact('sirali_uclu',altPools,altC,altC*SIDE_BET_UNITS.uclu,{primary:true,title,unit:SIDE_BET_UNITS.uclu,payout_keys:['sirali_uclu','uclu_bahis'],races:[x.r]});
    const cls=decision.play?'sideBetPlay':(decision.mode==='PAS'?'sideBetPass':'sideBetCaution');
    const altCard=sideBetTicketCard(title,altPools,altC,altC*SIDE_BET_UNITS.uclu,altStatus,ticketSpecificMetric(stats.uclu,'uclu',altPools),cls,x.r.horses,rankMap,'yarış',profileNote,sideBetRealPayoutHTML(x.r,['sirali_uclu','uclu_bahis'],altStatus.includes('TUTTU'),altPools))
      +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(title,altPools,altC,altC*SIDE_BET_UNITS.uclu,altStatus,x.r.horses,rankMap):'');
    const singleCards=couponSingles.map(single=>{
      const {pools,c}=applyCostControl([[single.no],altPools[1],altPools[2]],SIDE_BET_UNITS.uclu,COST_LIMIT.uclu,permCount);
      const status=sideBetOutcomeStatus(pools,x.r.horses);
      const singleTitle=`Sıralı Üçlü · Kupon TEK varyantı · ${v25CouponSingleTitle(single.labels)}`;
      return sideBetTicketCard(singleTitle,pools,c,c*SIDE_BET_UNITS.uclu,status,ticketSpecificMetric(stats.uclu,'uclu',pools),'featuredBet',x.r.horses,rankMap,'yarış',profileNote,sideBetRealPayoutHTML(x.r,['sirali_uclu','uclu_bahis'],status.includes('TUTTU'),pools))
        +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(singleTitle,pools,c,c*SIDE_BET_UNITS.uclu,status,x.r.horses,rankMap):'');
    });
    cards.push(singleCards.length?v25SingleAlternativePair(singleCards,altCard):altCard);
  }else if(isFirstAltiliLeg){ cards.push(ruleUnavailableCard('Sıralı Üçlü')); }
  else if(!officialHas('sirali_uclu','uclu_bahis')){ cards.push(officialUnavailableCard('Sıralı Üçlü')); }
  else cards.push(unavailableCard('Sıralı Üçlü',hasOfficialBetInfo?3:7));

  // ---- Dörtlü / Tabela: 3x5x6x9 ve veriyle seçilen OYNA/PAS kapısı.
  if(canQuartet && !isFirstAltiliLeg){
    const rankings=productRankings.quartet,widths=tkpEffectiveSideBetWidths('quartet');
    const pools0=widths.map((w,i)=>positionPool(i,w,'quartet'));
    const decision=tkpSideBetProductPlayDecision('quartet',x.r,rankings,pools0);
    const profileNote=`Doğrulanmış pozisyon havuzu · ${decision.label} · ${decision.reason}. Az örnekli ve ikramiyeye duyarlı ürünler yalnız shadow izlenir.`;
    const {pools:altPools,c:altC}=applyCostControl(pools0,SIDE_BET_UNITS.dortlu,COST_LIMIT.dortlu,permCount,2);
    const altStatus=sideBetOutcomeStatus(altPools,x.r.horses);
    const quartetTitle=`Dörtlü / Tabela · ${decision.label} · ${v25AlternativeLabel(altPools)}`;
    captureExact('tabela',altPools,altC,altC*SIDE_BET_UNITS.dortlu,{primary:true,title:quartetTitle,unit:SIDE_BET_UNITS.dortlu,payout_keys:['tabela','tabela_sirasiz'],races:[x.r]});
    const altCard=sideBetTicketCard(quartetTitle,altPools,altC,altC*SIDE_BET_UNITS.dortlu,altStatus,ticketSpecificMetric(stats.dortlu,'dortlu',altPools),decision.play?'sideBetPlay':'sideBetPass',x.r.horses,rankMap,'yarış',profileNote,dortluRealPayoutHTML(x.r,altStatus,altPools))
      +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(quartetTitle,altPools,altC,altC*SIDE_BET_UNITS.dortlu,altStatus,x.r.horses,rankMap):'');
    const singleCards=couponSingles.map(single=>{
      const {pools,c}=applyCostControl([[single.no],altPools[1],altPools[2],altPools[3]],SIDE_BET_UNITS.dortlu,COST_LIMIT.dortlu,permCount);
      const status=sideBetOutcomeStatus(pools,x.r.horses);
      const singleTitle=`Dörtlü / Tabela · Kupon TEK varyantı · ${v25CouponSingleTitle(single.labels)}`;
      return sideBetTicketCard(singleTitle,pools,c,c*SIDE_BET_UNITS.dortlu,status,ticketSpecificMetric(stats.dortlu,'dortlu',pools),'featuredBet',x.r.horses,rankMap,'yarış',profileNote,dortluRealPayoutHTML(x.r,status,pools))
        +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(singleTitle,pools,c,c*SIDE_BET_UNITS.dortlu,status,x.r.horses,rankMap):'');
    });
    cards.push(singleCards.length?v25SingleAlternativePair(singleCards,altCard):altCard);
  }else if(isFirstAltiliLeg){ cards.push(ruleUnavailableCard('Dörtlü / Tabela')); }
  else if(!officialHas('tabela')){ cards.push(officialUnavailableCard('Dörtlü / Tabela')); }
  else cards.push(unavailableCard('Dörtlü / Tabela',hasOfficialBetInfo?4:13));

  // ---- Sıralı 5'li: 2x5x5x6x8 ve pist/zorluk OYNA/PAS kapısı.
  if(canQuintet && !isFirstAltiliLeg){
    const rankings=productRankings.quintet,widths=tkpEffectiveSideBetWidths('quintet');
    const pools0=widths.map((w,i)=>positionPool(i,w,'quintet'));
    const decision=tkpSideBetProductPlayDecision('quintet',x.r,rankings,pools0);
    const profileNote=`Doğrulanmış pozisyon havuzu · ${decision.label} · ${decision.reason}. Büyük ikramiye yoğunlaşması nedeniyle canlı eşik geçmeden otomatik oynanmaz.`;
    const {pools:altPools,c:altC}=applyCostControl(pools0,SIDE_BET_UNITS.sirali5li,COST_LIMIT.sirali5li,permCount,2);
    const altStatus=sideBetOutcomeStatus(altPools,x.r.horses);
    const quintetTitle=`Sıralı 5'li · ${decision.label} · ${v25AlternativeLabel(altPools)}`;
    captureExact('sirali_5li',altPools,altC,altC*SIDE_BET_UNITS.sirali5li,{primary:true,title:quintetTitle,unit:SIDE_BET_UNITS.sirali5li,payout_keys:['sirali_5li'],races:[x.r]});
    const altCard=sideBetTicketCard(quintetTitle,altPools,altC,altC*SIDE_BET_UNITS.sirali5li,altStatus,ticketSpecificMetric(stats.sirali5li,'sirali5li',altPools),decision.play?'sideBetPlay':'sideBetPass',x.r.horses,rankMap,'yarış',profileNote,sideBetRealPayoutHTML(x.r,['sirali_5li'],altStatus.includes('TUTTU'),altPools))
      +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(quintetTitle,altPools,altC,altC*SIDE_BET_UNITS.sirali5li,altStatus,x.r.horses,rankMap):'');
    const singleCards=couponSingles.map(single=>{
      const {pools,c}=applyCostControl([[single.no],altPools[1],altPools[2],altPools[3],altPools[4]],SIDE_BET_UNITS.sirali5li,COST_LIMIT.sirali5li,permCount);
      const status=sideBetOutcomeStatus(pools,x.r.horses);
      const singleTitle=`Sıralı 5'li · Kupon TEK varyantı · ${v25CouponSingleTitle(single.labels)}`;
      return sideBetTicketCard(singleTitle,pools,c,c*SIDE_BET_UNITS.sirali5li,status,ticketSpecificMetric(stats.sirali5li,'sirali5li',pools),'featuredBet',x.r.horses,rankMap,'yarış',profileNote,sideBetRealPayoutHTML(x.r,['sirali_5li'],status.includes('TUTTU'),pools))
        +(typeof tkpV55SideBetRescueHTML==='function'?tkpV55SideBetRescueHTML(singleTitle,pools,c,c*SIDE_BET_UNITS.sirali5li,status,x.r.horses,rankMap):'');
    });
    cards.push(singleCards.length?v25SingleAlternativePair(singleCards,altCard):altCard);
  }else if(isFirstAltiliLeg){ cards.push(ruleUnavailableCard('Sıralı 5\'li Bahis')); }
  else if(!officialHas('sirali_5li')){ cards.push(officialUnavailableCard('Sıralı 5\'li Bahis')); }
  else cards.push(unavailableCard('Sıralı 5\'li Bahis',hasOfficialBetInfo?5:16));

  const learnedNote=!archived&&genericPositionRankings?.p2?.some(h=>h.r1671_model)
    ?'<p class="muted">2. ve 3. sıra: geçmiş sonuçlardan öğrenilen model · deneysel</p>':'';
  const ticketHtml=`<div><h4 style="margin:12px 0 6px;color:#0f2442;">${x.r.leg}. Ayak yan bahis tahminleri</h4>${learnedNote}<div class="sideBetTicketGrid">${cards.join('')}</div></div>`;
  if(ticketCacheKey)_tkpSideBetTicketHtmlCache.set(ticketCacheKey,{signature:ticketCacheSignature,html:ticketHtml,exactSpecs:tkpCloneSideBetExactSpecs(exactSpecs)});
  tkpSideBetDeliverExactSpecs(options,exactSpecs);
  return ticketHtml;
}

function doublePoolForRace(x){
  const plan=sideBetStrategyPlan(x);
  // MADDE 6 — Çifte resmi eküri mantığı: aynı E1/E2/... grubundaki iki ortak
  // iki ayrı kolon değildir. Adaptif sıra korunur; ilk (en güçlü) temsilci tutulur.
  const rawPicks=(plan.picks||[]).filter(h=>!isNonRunner(h));
  const picks=typeof dedupeEkuri==='function' ? dedupeEkuri(rawPicks,x?.r,'main',true) : rawPicks;
  const rawProtected=(plan.moneySignalPicks||[]).filter(h=>h && !isNonRunner(h));
  const protectedPicks=typeof dedupeEkuri==='function' ? dedupeEkuri(rawProtected,x?.r,'main',true) : rawProtected;
  return {
    pool:[...new Set(picks.map(h=>String(h.horse_no)))],
    protectedNos:[...new Set(protectedPicks.map(h=>String(h.horse_no)))],
    reason:plan.reason||'',
    coverage:Number(plan.coverage)||0,
    count:picks.length
  };
}


// V24 — Arşiv geri testi ve Son AGF sonrası otomatik kupon üretimi.
function _v24MeetingGroups(){
  const raceCount=(db?.races||[]).length;
  const resultCount=(db?.races||[]).reduce((n,r)=>n+((r?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1)?1:0),0);
  const cacheKey=[raceCount,resultCount,(db?.files||[]).length,(db?.changelog||[]).length].join('|');
  if(_v24MeetingGroupsCacheKey===cacheKey && _v24MeetingGroupsCache) return _v24MeetingGroupsCache;
  if(typeof tkpMeetingGroups === 'function'){
    try {
      const indexed = tkpMeetingGroups(true).filter(rows=>rows.length>=3 && rows.some(r=>raceHasConfirmedResult(r.horses)));
      _v24MeetingGroupsCache=indexed;
      _v24MeetingGroupsCacheKey=cacheKey;
      return _v24MeetingGroupsCache;
    } catch(_){}
  }
  const map=new Map();
  for(const r of (db?.races||[])){
    if(!r || !Array.isArray(r.horses) || !r.horses.length) continue;
    const key=String(r.file_id||r.meeting_id||`${r.date||''}|${couponCanonicalTrackName(r.hippodrome||'')}|${r.sequence_no||''}`);
    if(!map.has(key)) map.set(key,[]);
    map.get(key).push(r);
  }
  _v24MeetingGroupsCache=[...map.values()].filter(rows=>rows.length>=3 && rows.some(r=>raceHasConfirmedResult(r.horses)));
  _v24MeetingGroupsCacheKey=cacheKey;
  return _v24MeetingGroupsCache;
}
function _v24RaceResultsFromRows(rows){
  if(rows && _v24RaceResultsCache.has(rows)) return _v24RaceResultsCache.get(rows);
  const out=rows.slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0)).map(r=>{
    const horses=(r.horses||[]).filter(h=>!isNonRunner(h));
    const scored=typeof altiliWinnerOrderForRace==='function'
      ? altiliWinnerOrderForRace(r,horses.slice())
      : strategicOrderForRace(r,horses.slice());
    return {r,scored,top:scored[0]||null,second:scored[1]||null,third:scored[2]||null,margin:(scored[0]?.score||0)-(scored[1]?.score||0)};
  }).filter(x=>x.top);
  if(rows) _v24RaceResultsCache.set(rows,out);
  return out;
}
function _v25BacktestContextForRows(rows){
  const first=(rows||[]).find(Boolean)||null;
  const fileId=first?.file_id;
  const f=(db?.files||[]).find(x=>String(x.id)===String(fileId))||{};
  return {
    enabled:true,
    excludeFileId:fileId,
    cutoffSeq:Number(f.sequence_no)||Number(first?.sequence_no)||0,
    cutoffDate:String(f.race_date||first?.race_date||'')
  };
}
function _v25InvalidateLearningCachesForBacktest(){
  const fns=[
    'invalidateProfileMatchCache',
    'invalidateWinnerProfileCache',
    'invalidateConditionStatsCache',
    'invalidateAdaptiveLearningCache',
    'invalidateSideBetCache'
  ];
  for(const name of fns){
    try{ if(typeof globalThis[name]==='function') globalThis[name](); }
    catch(_){}
  }
}
function _v25WithBacktestContext(rows, fn){
  if(typeof globalThis==='undefined') return fn();
  const prev=globalThis.__tkpBacktestContext;
  globalThis.__tkpBacktestContext=_v25BacktestContextForRows(rows);
  _v25InvalidateLearningCachesForBacktest();
  try{ return fn(); }
  finally{
    globalThis.__tkpBacktestContext=prev;
    _v25InvalidateLearningCachesForBacktest();
  }
}
function _v25MaskRaceForPrediction(r){
  if(!r) return r;
  const clone={...r};
  delete clone.payouts;
  delete clone.result_source;
  clone.horses=(r.horses||[]).map(h=>{
    const x={...h};
    // Resmî sonuçtan türeyen her alan replay tahmininden çıkarılır. Yalnız winner
    // alanını silmek yetmez; result_rank/score gibi eski arşiv yardımcı alanları
    // kalırsa geçmişe bakıp kupon yapmış oluruz.
    for(const key of ['winner','finish_position','official_time','result_time','finish_time','result_margin',
      'result_rank','result_score','sonuc_puani','sonuc_sirasi','ods_result_score','ods_result_rank',
      'ods_sonuc_puani','ods_sonuc_sirasi','payout','payout_amount','prize','ikramiye']) delete x[key];
    return x;
  });
  return clone;
}
function _v25MaskRowsForPrediction(rows){
  return (rows||[]).slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0)).map(_v25MaskRaceForPrediction);
}
// V49 — BACK TEST BELLEK KİLİDİ
// Canlı kupon nesnesi; tam yarış, sıralama, açıklama ve istatistik ağaçlarını taşır.
// 20–30 toplantıyı bu haliyle önbelleğe almak yüzlerce MB bellek tüketip replay'i
// kilitleyebiliyordu. Back Test'in ihtiyacı yalnız ayak no, at no ve maliyet alanlarıdır.
// Bu kompakt kopya seçimleri değiştirmez; yalnız gereksiz referansları bırakır.
function tkpCompactBacktestPick(h){
  if(h==null)return h;
  if(typeof h!=='object')return {horse_no:String(h)};
  return {
    horse_no:String(h.horse_no??''),
    horse_name:String(h.horse_name??''),
    bmb:Number(h.bmb)||0,
    odb:Number(h.odb)||0,
    agf_rank:Number(h.agf_rank)||null
  };
}
function tkpCompactBacktestCoupon(coupon){
  if(!coupon)return coupon;
  const out={
    typeKey:coupon.typeKey,label:coupon.label,error:coupon.error,disabled:!!coupon.disabled,
    unit:Number(coupon.unit)||0,cost:Number(coupon.cost)||0,combos:Number(coupon.combos)||0,
    legCount:Number(coupon.legCount)||0,budgetTL:Number(coupon.budgetTL)||0,
    leftover:Number(coupon.leftover)||0,reliableSingles:Number(coupon.reliableSingles)||0,
    engine:coupon.engine,snapshotId:coupon.snapshotId,snapshotSource:coupon.snapshotSource,
    thirdHorseDecision:coupon.thirdHorseDecision?{...coupon.thirdHorseDecision}:undefined,
    adaptiveBudget:coupon.adaptiveBudget?{...coupon.adaptiveBudget}:coupon.adaptiveBudget,
    baseBudgetTL:Number(coupon.baseBudgetTL)||0,adaptiveBudgetRaised:!!coupon.adaptiveBudgetRaised,
    adaptiveBudgetNote:coupon.adaptiveBudgetNote,
    bmbRescueSwaps:Array.isArray(coupon.bmbRescueSwaps)?coupon.bmbRescueSwaps.map(x=>({...x})):coupon.bmbRescueSwaps,
    agf69Rescues:Array.isArray(coupon.agf69Rescues)?coupon.agf69Rescues.map(x=>({...x})):coupon.agf69Rescues
  };
  out.legs=(coupon.legs||[]).map((leg,index)=>{
    const race=leg?.r||leg?.x?.r||leg?.race||{};
    return {
      r:{leg:Number(race.leg)||index+1,file_id:race.file_id,race_uid:race.race_uid},
      picks:(leg?.picks||leg?.horses||[]).map(tkpCompactBacktestPick)
    };
  });
  return out;
}
function tkpCompactBacktestBuild(result){
  if(!result)return result;
  return {
    rr:(result.rr||[]).map((x,index)=>({r:{leg:Number(x?.r?.leg)||index+1}})),
    coupons:{
      main:tkpCompactBacktestCoupon(result?.coupons?.main),
      main2:tkpCompactBacktestCoupon(result?.coupons?.main2),
      alt:tkpCompactBacktestCoupon(result?.coupons?.alt),
      surprise:tkpCompactBacktestCoupon(result?.coupons?.surprise)
    }
  };
}
const TKP_PREPARED_BACKTEST_CACHE_LIMIT=64;

function _v25BuildBacktestCoupons(rows,budgets){
  const first=(rows||[]).find(Boolean)||{};
  const signature=(db?.learning_state?.dataset_signature)
    || (typeof tkpFastDbSignature==='function' ? tkpFastDbSignature(db) : `${(db?.files||[]).length}|${(db?.races||[]).length}|${(db?.prediction_log||[]).length}|${(db?.auto_coupon_log||[]).length}`);
  const cacheKey=[
    signature,
    first.file_id??first.meeting_id??`${first.race_date||first.date||''}|${first.hippodrome||''}`,
    Number(budgets?.main)||0,
    Number(budgets?.main2??budgets?.main)||0,
    Number(budgets?.alt)||0,
    Number(budgets?.surprise)||0,
    String(budgets?.normalMode||'standard')
  ].join('|');
  if(_v26PreparedBacktestCouponCache.has(cacheKey)){
    return _v26PreparedBacktestCouponCache.get(cacheKey);
  }

  const result=_v25WithBacktestContext(rows,()=>{
    const rr=_v24RaceResultsFromRows(_v25MaskRowsForPrediction(rows));
    if(rr.length<3) return null;

    // V47 CANONICAL BACK TEST: Geçmiş replay, ekranda/A4/takipte kullanılan canlı
    // buildCouponSetFast motorunun AYNISINI kullanır. Eski yol buildSolid/buildAlt/
    // buildBomba'yı ayrı ayrı çağırıp sonradan çeşitlendirdiği için 1-TEK/2-TEK
    // sözleşmesini ve bazı kapsam takaslarını canlı kupondan farklı üretebiliyordu.
    // Böyle bir ayrım 6/6 ve ROI'yi olduğundan farklı gösterebilir; artık yasak.
    let live=null;
    try{
      live=tkpBuildCouponSetAdaptive(rr,{
        main:Number(budgets?.main)||1000,
        main2:Number(budgets?.main2??budgets?.main)||1000,
        mainMax:1400,
        alt:0,
        surprise:Number(budgets?.surprise)||1000,
        surpriseMax:1400,
        normalMode:budgets?.normalMode==='coverage'?'coverage':'standard'
      });
    }catch(e){
      live={main:{error:e?.message||String(e)},main2:{error:e?.message||String(e)},surprise:{error:e?.message||String(e)}};
    }
    // V49: Back Test artık hata halinde sessiz fallback kupon üretmez. Fallback,
    // canlıda oynanmayacak bir kuponu geçmişte oynanmış gibi gösterip 5'li/3'lü ROI'yi
    // tek büyük ikramiyeyle sahte biçimde şişirebiliyordu. Adaptif bütçe gerçek risk
    // tabanına kadar yükselir; yine sığmıyorsa kayıt açıkça hata olarak kalır.
    const coupons={
      main:live?.main||{error:'Normal 1 kupon üretilemedi'},
      main2:live?.main2||{error:'Normal 2 kupon üretilemedi'},
      // V55.2: gerçek Sürpriz Altılı canlı motorun `alt` anahtarındadır.
      // Back Test köprüsü bunu eski Geniş placeholder'ı ile ezemez; aksi halde
      // Sürpriz satırı kaybolur ve portföy karşılaştırması yanlış olur.
      alt:live?.alt||{error:'Sürpriz Altılı kupon üretilemedi'},
      surprise:live?.surprise||{error:'Uzman + Kulis kupon üretilemedi'}
    };
    return {rr,coupons};
  });

  const compact=tkpCompactBacktestBuild(result);
  _v26PreparedBacktestCouponCache.set(cacheKey,compact);
  while(_v26PreparedBacktestCouponCache.size>TKP_PREPARED_BACKTEST_CACHE_LIMIT){
    const firstKey=_v26PreparedBacktestCouponCache.keys().next().value;
    _v26PreparedBacktestCouponCache.delete(firstKey);
  }
  return compact;
}
function _v24EvaluateCoupon(coupon, sourceRows=null){
  if(!coupon || coupon.error || !Array.isArray(coupon.legs)) return null;
  let hit=0,known=0,lastLegHit=false,singles=0,singleHit=0;
  // Portfolio arrays may be in confidence order. Consecutive/final-leg hits
  // must follow the actual race leg, without mutating the visible coupon.
  const actualLeg=l=>Number(l?.x?.r?.leg??l?.r?.leg??l?.race?.leg)||0;
  const legs=(coupon.legs||[]).slice().sort((a,b)=>actualLeg(a)-actualLeg(b));
  const legHits=[];
  const sourceByLeg=sourceRows ? new Map((sourceRows||[]).map(r=>[String(Number(r.leg)||''),r])) : null;
  for(const leg of legs){
    const legNo=leg?.x?.r?.leg ?? leg?.r?.leg ?? leg?.race?.leg;
    const race = (sourceByLeg && sourceByLeg.get(String(Number(legNo)||''))) || leg?.x?.r || leg?.r || leg?.race || null;
    const horses = race?.horses || leg?.x?.r?.horses || [];
    const winners=horses.filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);
    if(!winners.length){ legHits.push(null); continue; }
    known++;
    const picks=(leg.picks||leg.horses||[]).filter(Boolean);
    const ok=picks.some(h=>winners.some(winner=>_v25SameHorseOrEkuri(h.horse_no??h,winner.horse_no)));
    legHits.push(ok);
    if(ok) hit++;
    if(leg===legs[legs.length-1]) lastLegHit=ok;
    if(picks.length===1){ singles++; if(ok) singleHit++; }
  }
  let trailingHit=0;
  for(let i=legHits.length-1;i>=0;i--){
    if(legHits[i]===true) trailingHit++;
    else break;
  }
  return {hit,known,trailingHit,full:known===legs.length&&known>0&&hit===known,lastLegHit,singles,singleHit,cost:Number(coupon.cost)||0};
}
function _v25BacktestFallbackCoupon(rr,typeKey,budgetTL){
  // Back Test sıfır dönmesin: arşivde bazı eski toplantılarda buildSolidCoupon/buildAltCoupon
  // katı aday şartından hata verebilir. Bu durumda aynı güncel sıralama motorundan hafif bir
  // ölçüm kuponu kurulur; yalnız Back Test içindir, gerçek kupon ekranını değiştirmez.
  const legCount=Math.min(6,(rr||[]).length);
  const unit=ganyanUnitPrice(rr?.[0]?.r?.hippodrome,legCount)||2;
  const legs=(rr||[]).slice(0,legCount).map((x,i)=>{
    const rows=(predictionDisplayRows(x).rows||x.scored||[]).filter(h=>h&&!isNonRunner(h));
    let count=4;
    if(typeKey==='alt') count=(i===0?1:Math.min(rows.length,Math.max(2,Math.min(8,dynamicCoverageCount(x,rows,{isSingle:false,confidence:60},'alt')))));
    else if(typeKey==='main') count=(i<2?1:Math.min(rows.length,Math.max(2,Math.min(8,dynamicCoverageCount(x,rows,{isSingle:false,confidence:60},'main')))));
    else if(typeKey==='surprise') count=((i===0||i===2)?1:Math.min(rows.length,Math.max(2,Math.min(10,dynamicCoverageCount(x,rows,{isSingle:false,confidence:55},'surprise')))));
    const picks=rows.slice(0,Math.max(1,Math.min(count,rows.length)));
    return {x,r:x.r,picks};
  }).filter(l=>l.picks&&l.picks.length);
  const combos=legs.reduce((n,l)=>n*Math.max(1,l.picks.length),1);
  return {typeKey,legs,unit,cost:combos*unit,budgetTL:Number(budgetTL)||0};
}
const _v24CouponBacktestCache = new Map();
const _v26PreparedBacktestCouponCache = new Map();
let _v24MeetingGroupsCacheKey = null;
let _v24MeetingGroupsCache = null;
const _v24RaceResultsCache = new WeakMap();
// Kuponun tuttuğu ayak sırasını, TJK sonuç HTML'inden parse edilen ikramiye kombinasyonuyla
// (örn. "5/5/5/2/15/14") karşılaştırır. Eküri ortakları da (aynı at kabul edilir) sayılır.
function couponWinningPayoutLineCount(coupon, payoutEntry){
  const winLegs = String(payoutEntry?.combo||'').split('/').map(segment=>
    segment.split(',').map(s=>s.trim()).filter(Boolean)
  ).filter(options=>options.length);
  const orderedLegs=(coupon?.legs||[]).slice().sort((a,b)=>{
    const aLeg=Number(a?.x?.r?.leg??a?.r?.leg??a?.race?.leg)||0;
    const bLeg=Number(b?.x?.r?.leg??b?.r?.leg??b?.race?.leg)||0;
    return aLeg-bLeg;
  });
  if (!winLegs.length || !orderedLegs.length || winLegs.length !== orderedLegs.length) return 0;
  let lines=1;
  for(let i=0;i<orderedLegs.length;i++){
    const matched=[];
    for(const no of winLegs[i]){
      if((orderedLegs[i].picks||[]).some(h=>_v25SameHorseOrEkuri(h?.horse_no??h,no)) && !matched.some(x=>_v25SameHorseOrEkuri(x,no))) matched.push(no);
    }
    if(!matched.length)return 0;
    lines*=matched.length;
  }
  return lines;
}
function couponHitsPayoutCombo(coupon, payoutEntry){
  return couponWinningPayoutLineCount(coupon,payoutEntry)>0;
}

// PARİMÜTÜEL KURAL: tutan TEK kombinasyon sabit birim ikramiyesini alır; ne kadar
// yatırırsan yatır bu ödeme BÜYÜMEZ (10 TL'lik dar kuponla da 10.000 TL'lik geniş
// kuponla da aynı kombinasyon tutarsa aynı ikramiyeyi alırsın). Yatırım miktarının
// etkilediği şey ödeme değil, kaç farklı kombinasyonu kapsadığın (isabet olasılığı).
function realReturnForCoupon(coupon, race, betKey){
  const entries=(race?.payouts||[]).filter(p=>p.key===betKey);
  if(!entries.length) return {cost:coupon?.cost||0,ret:0,known:false};
  const matched=entries.map(entry=>({entry,lines:entry.rollover?0:couponWinningPayoutLineCount(coupon,entry)})).filter(x=>x.lines>0);
  const ret=matched.reduce((sum,x)=>sum+(Number(x.entry.amount)||0)*x.lines,0);
  const matchedLines=matched.reduce((sum,x)=>sum+x.lines,0);
  return {cost:coupon?.cost||0,ret,known:true,hit:matchedLines>0,rollover:entries.some(entry=>entry.rollover),payoutAmount:ret,payoutCombo:matched.map(x=>x.entry.combo).join(' · '),matchedPayouts:matchedLines};
}

// Yan bahis kartlarında (Çifte/Sıralı İkili/Sıralı Üçlü/Dörtlü-Tabela/Sıralı 5'li) gerçek
// TJK ikramiyesini gösterir: tuttuysa YEŞİL + gerçek TL tutarı, tutmadıysa KIRMIZI, havuz
// devrettiyse MOR. TJK sonuç HTML'inde bu bahis için ikramiye kartı henüz yoksa (Sonuç HTML
// yüklenmemiş veya bu bahis o toplantıda sunulmamış) hiçbir şey basılmaz -- uydurma rakam
// gösterilmez. `won` parametresi, kartın kendi TUTTU/TUTMADI tahmin sonucudur (finish_position
// üzerinden zaten hesaplanıyor); ikramiye tutarı yalnız görüntü rengini/miktarını belirler.
function sideBetPayoutEntryMatchesPools(entry,pools,{unordered=false,useEkuri=false}={}){
  const same=useEkuri?_v25SameHorseOrEkuri:_v25SameHorseExact;
  const segments=String(entry?.combo||'').split('/').map(part=>part.split(',').map(x=>x.trim()).filter(Boolean)).filter(x=>x.length);
  if(!segments.length||segments.length!==(pools||[]).length)return false;
  if(!unordered)return segments.every((options,index)=>options.some(no=>(pools[index]||[]).some(p=>same(p,no))));
  const sequences=[];
  (function expand(index,current){
    if(index===segments.length){sequences.push(current.slice());return;}
    for(const no of segments[index]){if(current.some(x=>same(x,no)))continue;current.push(no);expand(index+1,current);current.pop();}
  })(0,[]);
  return sequences.some(sequence=>{
    const used=new Array(pools.length).fill(false);
    function assign(at){
      if(at===sequence.length)return true;
      for(let i=0;i<pools.length;i++){
        if(used[i]||!(pools[i]||[]).some(p=>same(p,sequence[at])))continue;
        used[i]=true;if(assign(at+1))return true;used[i]=false;
      }
      return false;
    }
    return assign(0);
  });
}
function sideBetRealPayoutHTML(race, betKeys, won, pools=null, options={}){
  const keys=(Array.isArray(betKeys)?betKeys:[betKeys]).filter(Boolean);
  const entries=(race?.payouts||[]).filter(p=>keys.includes(p.key));
  if(!entries.length) return '';
  const matched=Array.isArray(pools)&&pools.length
    ? entries.filter(entry=>!entry.rollover&&sideBetPayoutEntryMatchesPools(entry,pools,{...options,unordered:options.unordered===true||entry.key==='tabela_sirasiz'}))
    : (won?entries.filter(entry=>!entry.rollover).slice(0,1):[]);
  const amount=matched.reduce((sum,entry)=>sum+(Number(entry.amount)||0),0);
  if(matched.length) return `<div class="sideBetRealPayout hit">✅ Gerçek ikramiye: <b>${fmt2(amount)} TL</b>${matched.length>1?` · ${matched.length} resmî ödeme`:''}</div>`;
  if(entries.some(entry=>entry.rollover)) return `<div class="sideBetRealPayout rollover">🔁 Bu bahiste havuz bilen çıkmadı, devretti.</div>`;
  const ref=entries.slice(0,3).map(entry=>entry.combo).filter(Boolean).join(' · '),maxAmount=Math.max(0,...entries.map(entry=>Number(entry.amount)||0));
  return `<div class="sideBetRealPayout miss">❌ Tutmadı — kazanan kombinasyon (${esc(ref||'-')})${maxAmount?` ${fmt2(maxAmount)} TL ödedi`:''}.</div>`;
}

// TJK Dörtlü/Tabela'yı SIRALI (tabela) ve SIRASIZ (tabela_sirasiz) diye iki AYRI ürün olarak
// yayınlar; ikisinin ikramiyesi de farklıdır. Kart SIRASIZ TUTTU gösteriyorsa gerçek ikramiye
// mutlaka tabela_sirasiz kaydından okunmalı -- aksi halde (iki anahtardan ilkini seçen genel
// yardımcı) sıralı tutmayan bir bahiste yanlışlıkla sıralı tutarını gösterebilir ya da hiç
// göstermeyebilirdi. TUTMADI durumunda referans olarak sıralı tutar gösterilir (varsa).
function dortluRealPayoutHTML(race, status, pools=null){
  const s=String(status||'');
  if(Array.isArray(pools)&&pools.length)return sideBetRealPayoutHTML(race,['tabela','tabela_sirasiz'],s.includes('TUTTU')||s.includes('SIRASIZ İSABET'),pools);
  if(s.includes('SIRASIZ İSABET')||s.includes('SIRASIZ TUTTU')) return sideBetRealPayoutHTML(race,['tabela_sirasiz'],true);
  if(s.includes('TUTTU')) return sideBetRealPayoutHTML(race,['tabela'],true);
  return sideBetRealPayoutHTML(race,['tabela','tabela_sirasiz'],false);
}

// Backtest dönemi 2026-08-23'te sıfırlandı. Bu sınır yalnız performans/backtest
// ölçümünü etkiler; tarihsel yarışlar öğrenme havuzunda kalmaya devam eder.
function tkpBacktestStartDate(){
  return String(db?.settings?.live_final_backtest?.startsAt||'2026-08-23').slice(0,10);
}
function tkpBacktestWithinResetPeriod(rowsOrRace){
  const race=Array.isArray(rowsOrRace)?rowsOrRace.find(r=>String(r?.race_date||'').slice(0,10)):rowsOrRace;
  const date=String(race?.race_date||'').slice(0,10),start=tkpBacktestStartDate();
  return !start||!date||date>=start;
}

// Belirli bir bahis türü + kupon motoru için, gerçek ikramiye verisi olan toplantılarda
// aylık/yıllık gerçek yatırım/getiri özetini çıkarır. İkramiye verisi olmayan (henüz sonuç
// HTML'i yüklenmemiş) toplantılar istatistiğe hiç katılmaz -- tahmini/uydurma rakam üretilmez.
function investmentBacktestByPeriod(betKey, couponBuilderFn, budgetTL, granularity, limit=25){
  const groups=_v24MeetingGroups().filter(tkpBacktestWithinResetPeriod).slice(-Math.max(1,Math.min(100,Number(limit)||25)));
  const buckets={};
  for(const rows of groups){
    const sortedRows=rows.slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0));
    const lastRace=sortedRows[sortedRows.length-1];
    let coupon=null;
    try{
      coupon=_v25WithBacktestContext(rows,()=>{
        const rr=_v24RaceResultsFromRows(_v25MaskRowsForPrediction(rows));
        if(rr.length<3) return null;
        return couponBuilderFn(rr,budgetTL);
      });
    }catch(_){ coupon=null; }
    if(!coupon||coupon.error) continue;
    const {cost,ret,known,hit}=realReturnForCoupon(coupon,lastRace,betKey);
    if(!known) continue;
    const dateKey=String(lastRace?.race_date||'').slice(0, granularity==='year'?4:7)||'TARİHSİZ';
    const b=buckets[dateKey]||(buckets[dateKey]={cost:0,ret:0,meetings:0,hits:0});
    b.cost+=cost; b.ret+=ret; b.meetings++; if(hit) b.hits++;
  }
  return buckets;
}

function couponArchiveBacktest(budgets, limit=100){
  const out={main:{meetings:0,full:0,five:0,four:0,three:0,last:0,cost:0,ret:0,payoutKnown:0,winningTickets:0,singles:0,singleHit:0},main2:{meetings:0,full:0,five:0,four:0,three:0,last:0,cost:0,ret:0,payoutKnown:0,winningTickets:0,singles:0,singleHit:0},surprise:{meetings:0,full:0,five:0,four:0,three:0,last:0,cost:0,ret:0,payoutKnown:0,winningTickets:0,singles:0,singleHit:0}};
  limit=Math.max(1,Math.min(100,Number(limit)||100));
  const raceCount=(db?.races||[]).length;
  const resultCount=(db?.races||[]).reduce((n,r)=>n+((r?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1)?1:0),0);
  const cacheKey=['ALTILI_LEAKFREE3_ADAPTIVE',TKP_AGF_SINGLE_PORTFOLIO_POLICY.version,tkpBacktestStartDate(),raceCount,resultCount,limit,Number(budgets.main)||0,Number(budgets.main2??budgets.main)||0,Number(budgets.surprise)||0].join('|');
  if(_v24CouponBacktestCache.has(cacheKey)) return _v24CouponBacktestCache.get(cacheKey);
  const groups=_v24MeetingGroups().filter(tkpBacktestWithinResetPeriod).slice(-limit);
  for(const rows of groups){
    const built=_v25BuildBacktestCoupons(rows,budgets);
    if(!built || !built.rr || built.rr.length<3) continue;
    for(const k of Object.keys(out)){
      const coupon=built.coupons[k];
      const e=_v24EvaluateCoupon(coupon,rows); if(!e||e.known<3) continue;
      const o=out[k];
      o.meetings++;
      o.full+=e.full?1:0;
      o.five+=e.trailingHit>=5?1:0;
      o.four+=e.trailingHit>=4?1:0;
      o.three+=e.trailingHit>=3?1:0;
      o.last+=e.lastLegHit?1:0;
      o.cost+=e.cost;
      const lastRace=rows.slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0)).at(-1);
      const payout=typeof realReturnForCoupon==='function' ? realReturnForCoupon(coupon,lastRace,'altili') : {known:false,ret:0};
      if(payout.known){
        o.payoutKnown++;
        o.ret+=Number(payout.ret)||0;
        if(payout.hit) o.winningTickets++;
      }
      o.singles+=e.singles;
      o.singleHit+=e.singleHit;
    }
  }
  _v24CouponBacktestCache.set(cacheKey,out);
  if(_v24CouponBacktestCache.size>16){ const first=_v24CouponBacktestCache.keys().next().value; _v24CouponBacktestCache.delete(first); }
  return out;
}
function tkpCachedCouponArchiveStats(budgets, limit=100){
  // Kupon kartı render edilirken ağır replay başlatma. Kullanıcı Back Test'i çalıştırdıysa
  // aynı canonical live-engine sonucunu önbellekten oku; aksi halde null dön.
  limit=Math.max(1,Math.min(100,Number(limit)||100));
  const raceCount=(db?.races||[]).length;
  const resultCount=(db?.races||[]).reduce((n,r)=>n+((r?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1)?1:0),0);
  const cacheKey=['ALTILI_LEAKFREE3_ADAPTIVE',TKP_AGF_SINGLE_PORTFOLIO_POLICY.version,raceCount,resultCount,limit,Number(budgets?.main)||0,Number(budgets?.alt)||0,Number(budgets?.surprise)||0].join('|');
  return _v24CouponBacktestCache.get(cacheKey)||null;
}

function _v25HitRateCell(ok,total){ total=Number(total)||0; return total>0?`${ok}/${total} <b>%${Math.round((Number(ok)||0)/total*100)}</b>`:`—`; }
// Back Test tablolarındaki oran hücreleri: hiç örnek yoksa nötr, en az bir isabet
// varsa YEŞİL, örnek olduğu halde hiç isabet yoksa KIRMIZI. Kullanıcı isteği:
// Altılı Tahmin/Yan Bahisler gibi Back Test'te de tutan/tutmayan renkle ayırt edilsin.
function _v25BacktestPctSpan(ok, total){
  total=Number(total)||0; ok=Number(ok)||0;
  if(total<1) return `<span style="color:#64748b !important;font-weight:700;">—</span>`;
  const pct=Math.round(ok/total*100);
  const color=ok>0?'#16a34a':'#dc2626';
  return `<span style="color:${color} !important;font-weight:800;">%${pct}</span>`;
}

function _v25SameHorseOrEkuri(a,b){
  const aa=String(a??'').trim(), bb=String(b??'').trim();
  if(!aa || !bb) return false;
  if(aa===bb) return true;
  if(ekuriBase(aa)===ekuriBase(bb)) return true;
  return sameEkuri(aa,bb);
}
function _v25SameHorseExact(a,b){
  const norm=no=>{
    const raw=String(no??'').trim();if(!raw)return '';
    const base=String(ekuriBase(raw)||raw).trim();
    return base.replace(/^0+(?=\d)/,'');
  };
  const aa=norm(a),bb=norm(b);return !!aa&&aa===bb;
}
// Görsel derece işaretleme için eküri eşdeğerliği KULLANILMAZ.
// Bahis hesabında 5-E1 ile 6-E1 aynı eküri kabul edilebilir; fakat ekranda yeşil/mavi/sarı
// sonuç rengi yalnız gerçekten o dereceye giren atın kendi numarasına basılır.
function _v25SameHorseForResultMark(actualNo, shownNo){
  const norm=no=>{
    const raw=String(no??'').trim();
    if(!raw) return '';
    const base=String(ekuriBase(raw)||raw).trim();
    return base.replace(/^0+(?=\d)/,'');
  };
  const a=norm(actualNo), b=norm(shownNo);
  return !!a && !!b && a===b;
}
function _v25PoolHasHorse(pool,no){ return (pool||[]).some(x=>_v25SameHorseOrEkuri(x,no)); }
function _v25Unique(arr){ return [...new Set((arr||[]).map(x=>String(x)))]; }
function _v25ArchiveSideBetBacktest(limit=100){
  limit=Math.max(1,Math.min(100,Number(limit)||100));
  const signature=typeof learningDatasetSignature==='function'
    ? learningDatasetSignature(db)
    : `${(db?.races||[]).length}|${(db?.files||[]).length}`;
  const cacheKey=['YAN_LEAKFREE3',tkpBacktestStartDate(),signature,limit].join('|');
  if(_v24CouponBacktestCache.has(cacheKey)) return _v24CouponBacktestCache.get(cacheKey);

  const metric=()=>({ok:0,total:0,cost:0,ret:0,payoutKnown:0,winningTickets:0,passed:0,strongOk:0,strongTotal:0});
  const out={
    cifte:metric(),
    sirali_ikili:metric(),
    sirali_uclu:metric(),
    tabela:metric(),
    sirali5li:metric()
  };
  const groups=_v24MeetingGroups().filter(tkpBacktestWithinResetPeriod).slice(-limit);

  function poolsFor(race){
    const horses=(race.horses||[]).slice();
    const ordered=(typeof historicalSideBetOrder==='function'?historicalSideBetOrder(race):historicalOrder(race)).filter(horse=>!isNonRunner(horse));
    const generic=typeof sideBetPositionRankingsForRace==='function'?sideBetPositionRankingsForRace(race,horses):null;
    const product={triple:tkpSideBetProductRankings(race,horses,'triple'),quartet:tkpSideBetProductRankings(race,horses,'quartet'),quintet:tkpSideBetProductRankings(race,horses,'quintet')};
    const nos=(rankings,position)=>(rankings?.['p'+position]||ordered).map(horse=>String(horse.horse_no));
    const learnedWidth=(name,w,i)=>{
      try{
        const policy=typeof tkpAdaptiveDecisionPolicy==='function'
          ?tkpAdaptiveDecisionPolicy(race,product[name]?.['p'+(i+1)]||[],{mode:'sidebet',product:name,position:i+1,fallback:w})
          :null;
        return Math.max(1,Math.min(12,Number(policy?.coverage)||w));
      }catch(_){return w;}
    };
    const triple=tkpEffectiveSideBetWidths('triple').map((w,i)=>nos(product.triple,i+1).slice(0,learnedWidth('triple',w,i)));
    const quartet=tkpEffectiveSideBetWidths('quartet').map((w,i)=>nos(product.quartet,i+1).slice(0,learnedWidth('quartet',w,i)));
    const quintet=tkpEffectiveSideBetWidths('quintet').map((w,i)=>nos(product.quintet,i+1).slice(0,learnedWidth('quintet',w,i)));
    return {
      p1:nos(generic,1).slice(0,5),p2:nos(generic,2).slice(0,5),
      triple,quartet,quintet,product,
      tripleDecision:tkpSideBetProductPlayDecision('triple',race,product.triple,triple),
      quartetDecision:tkpSideBetProductPlayDecision('quartet',race,product.quartet,quartet),
      quintetDecision:tkpSideBetProductPlayDecision('quintet',race,product.quintet,quintet)
    };
  }

  function winNo(race,position){
    const horse=(race.horses||[]).find(item=>
      Number(item.finish_position)===position
      || (position===1&&Number(item.winner)===1)
    );
    return horse?String(horse.horse_no):'';
  }

  function payoutEntry(race,keys){
    return (race?.payouts||[]).find(entry=>keys.includes(entry.key))||null;
  }
  function offered(race,keys){
    const list=Array.isArray(race?.available_bets)?race.available_bets.map(String):[];
    return keys.some(key=>list.includes(key));
  }

  function record(target,cost,hit,race,payoutKeys){
    target.total++;
    target.cost+=Number(cost)||0;
    if(hit) target.ok++;
    const entry=payoutEntry(race,payoutKeys);
    if(!entry) return;
    target.payoutKnown++;
    if(hit&&!entry.rollover){
      target.ret+=Number(entry.amount)||0;
      target.winningTickets++;
    }
  }

  for(const rows0 of groups){
    const rows=rows0.slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0));
    const origByLeg=new Map(rows.map(race=>[String(Number(race.leg)||''),race]));
    const prepared=_v25WithBacktestContext(rows0,()=>{
      return _v25MaskRowsForPrediction(rows0).map(masked=>{
        const original=origByLeg.get(String(Number(masked.leg)||''))||masked;
        return {
          r:original,
          p:poolsFor(masked),
          w1:winNo(original,1),
          w2:winNo(original,2),
          w3:winNo(original,3),
          w4:winNo(original,4),
          w5:winNo(original,5)
        };
      });
    });

    for(const item of prepared){
      const {r,p,w1,w2,w3,w4,w5}=item;
      if(w1&&w2&&offered(r,['sirali_ikili'])){
        const pools=[p.p1,p.p2];
        const hit=p.p1.some(no=>_v25SameHorseExact(no,w1))&&p.p2.some(no=>_v25SameHorseExact(no,w2));
        record(out.sirali_ikili,permCount(pools)*SIDE_BET_UNITS.sirali,hit,r,['sirali_ikili']);
      }
      if(w1&&w2&&w3&&offered(r,['sirali_uclu','uclu_bahis'])){
        const pools=p.triple;
        const hit=pools[0].some(no=>_v25SameHorseExact(no,w1))&&pools[1].some(no=>_v25SameHorseExact(no,w2))&&pools[2].some(no=>_v25SameHorseExact(no,w3));
        record(out.sirali_uclu,permCount(pools)*SIDE_BET_UNITS.uclu,hit,r,['sirali_uclu','uclu_bahis']);
        if(p.tripleDecision?.strong){out.sirali_uclu.strongTotal++;if(hit)out.sirali_uclu.strongOk++;}
      }
      if(w1&&w2&&w3&&w4&&offered(r,['tabela'])){
        const pools=p.quartet;
        const hit=pools[0].some(no=>_v25SameHorseExact(no,w1))&&pools[1].some(no=>_v25SameHorseExact(no,w2))&&pools[2].some(no=>_v25SameHorseExact(no,w3))&&pools[3].some(no=>_v25SameHorseExact(no,w4));
        if(p.quartetDecision?.play)record(out.tabela,permCount(pools)*SIDE_BET_UNITS.dortlu,hit,r,['tabela']);
        else out.tabela.passed++;
      }
      if(w1&&w2&&w3&&w4&&w5&&offered(r,['sirali_5li'])){
        const pools=p.quintet;
        const hit=pools[0].some(no=>_v25SameHorseExact(no,w1))&&pools[1].some(no=>_v25SameHorseExact(no,w2))&&pools[2].some(no=>_v25SameHorseExact(no,w3))&&pools[3].some(no=>_v25SameHorseExact(no,w4))&&pools[4].some(no=>_v25SameHorseExact(no,w5));
        if(p.quintetDecision?.play)record(out.sirali5li,permCount(pools)*SIDE_BET_UNITS.sirali5li,hit,r,['sirali_5li']);
        else out.sirali5li.passed++;
      }
    }

    for(let index=0;index<prepared.length-1;index++){
      const first=prepared[index];
      const second=prepared[index+1];
      if(!first.w1||!second.w1) continue;
      if(!offered(second.r,['cifte'])) continue;
      const hit=_v25PoolHasHorse(first.p.p1,first.w1)
        &&_v25PoolHasHorse(second.p.p1,second.w1);
      const cost=(first.p.p1.length*second.p.p1.length)*SIDE_BET_UNITS.cifte;
      // TJK Çifte ikramiyesini ikilinin ikinci koşu satırında yayınlar.
      record(out.cifte,cost,hit,second.r,['cifte']);
    }
  }

  for(const value of Object.values(out)){
    value.net=value.ret-value.cost;
    value.roi=value.cost?value.net/value.cost*100:0;
  }

  _v24CouponBacktestCache.set(cacheKey,out);
  if(_v24CouponBacktestCache.size>16){
    const firstKey=_v24CouponBacktestCache.keys().next().value;
    _v24CouponBacktestCache.delete(firstKey);
  }
  return out;
}

function couponArchiveBacktestHTML(budgets,limit=100){
  limit=Math.max(1,Math.min(100,Number(limit)||100));
  const result=couponArchiveBacktest(budgets,limit);
  const names={main:'Normal · 1 TEK',main2:'Normal · 2 TEK',surprise:'Uzman + Kulis'};

  const rows=Object.keys(names).map(key=>{
    const item=result[key];
    const meetings=item.meetings||0;
    const net=(Number(item.ret)||0)-(Number(item.cost)||0);
    const roi=item.cost?net/item.cost*100:0;
    const returnText=item.payoutKnown
      ? fmtTL(item.ret)
      : '<span class="muted">İkramiye verisi yok</span>';
    return `<tr>
      <td><b>${names[key]}</b></td>
      <td class="num">${meetings}</td>
      <td class="num">${item.full}</td>
      <td class="num">${_v25BacktestPctSpan(item.full,meetings)}</td>
      <td class="num">${_v25BacktestPctSpan(item.five,meetings)}</td>
      <td class="num">${_v25BacktestPctSpan(item.four,meetings)}</td>
      <td class="num">${_v25BacktestPctSpan(item.three,meetings)}</td>
      <td class="num">${_v25BacktestPctSpan(item.singleHit,item.singles)}</td>
      <td class="num">${fmtTL(item.cost)}</td>
      <td class="num">${returnText}</td>
      <td class="num" style="color:${net>=0?'#15803d':'#b91c1c'} !important;font-weight:800;">${fmt2(net)} TL</td>
      <td class="num">%${fmt2(roi)}</td>
      <td class="num">${item.payoutKnown||0}</td>
    </tr>`;
  }).join('');

  const best=Object.keys(names).sort((left,right)=>{
    const a=result[left],b=result[right];
    const aScore=(a.full/(a.meetings||1))*1000+(a.five/(a.meetings||1))*120-(a.cost/(a.meetings||1))/100;
    const bScore=(b.full/(b.meetings||1))*1000+(b.five/(b.meetings||1))*120-(b.cost/(b.meetings||1))/100;
    return bScore-aScore;
  })[0];

  const side=_v25ArchiveSideBetBacktest(limit);
  const sideNames={
    cifte:'Çifte',
    sirali_ikili:'Sıralı İkili',
    sirali_uclu:'Sıralı Üçlü',
    tabela:'Tabela / Dörtlü',
    sirali5li:'Sıralı 5’li'
  };
  const sideRows=Object.keys(sideNames).map(key=>{
    const item=side[key];
    const returnText=item.payoutKnown
      ? fmtTL(item.ret)
      : '<span class="muted">İkramiye verisi yok</span>';
    return `<tr>
      <td><b>${sideNames[key]}</b></td>
      <td class="num">${item.total}</td>
      <td class="num">${item.ok}</td>
      <td class="num">${_v25BacktestPctSpan(item.ok,item.total)}</td>
      <td class="num">${fmtTL(item.cost)}</td>
      <td class="num">${returnText}</td>
      <td class="num" style="color:${item.net>=0?'#15803d':'#b91c1c'} !important;font-weight:800;">${fmt2(item.net)} TL</td>
      <td class="num">%${fmt2(item.roi)}</td>
      <td class="num">${item.payoutKnown||0}</td>
    </tr>`;
  }).join('');

  const investmentHTML=typeof buildInvestmentBacktestHTML==='function'
    ? buildInvestmentBacktestHTML(budgets,limit)
    : '';

  return `<div class="card" style="border-left:5px solid #7c3aed;">
    <h2 style="margin:0 0 5px;">🧪 Back Test — Altılı Başarı ve Getiri</h2>
    <p class="muted" style="margin:0 0 8px;">Sonucu kayıtlı son ${limit} yarış toplantısı aynı kupon motorundan geçirildi. En iyi maliyet/6’lı dengesi: <b>${names[best]}</b>.</p>
    <p class="muted" style="margin:0 0 8px;color:#92400e !important;">Dürüst modda her toplantı yalnız kendisinden önceki veriyle tahmin edilir. Kazanılan miktar yalnız gerçek TJK ikramiyesi bulunan toplantılardan alınır; uydurma getiri yazılmaz.</p>
    <div class="tableWrap compactBacktest"><table>
      <thead><tr>
        <th>Kupon</th>
        <th class="num">Test</th>
        <th class="num">6/6</th>
        <th class="num">6/6 oran</th>
        <th class="num">Son 5/6</th>
        <th class="num">Son 4/6</th>
        <th class="num">Son 3/6</th>
        <th class="num">Tek tutma</th>
        <th class="num">Maliyet</th>
        <th class="num">Kazanılan</th>
        <th class="num">Net</th>
        <th class="num">ROI</th>
        <th class="num">İkramiye verisi</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>
  <div class="card" style="border-left:5px solid #0891b2;">
    <h2 style="margin:0 0 5px;">🎯 Back Test — Yan Bahis Başarı ve Getiri</h2>
    <p class="muted" style="margin:0 0 8px;">Çifte, Sıralı İkili, Sıralı Üçlü, Tabela/Dörtlü ve Sıralı 5’li aynı dürüst geçmiş modu ile test edilir. Plase ve Sırasız İkili tahmini üretilmez.</p>
    <div class="tableWrap compactBacktest"><table>
      <thead><tr>
        <th>Bahis</th>
        <th class="num">Test</th>
        <th class="num">Tuttu</th>
        <th class="num">Oran</th>
        <th class="num">Maliyet</th>
        <th class="num">Kazanılan</th>
        <th class="num">Net</th>
        <th class="num">ROI</th>
        <th class="num">İkramiye verisi</th>
      </tr></thead>
      <tbody>${sideRows}</tbody>
    </table></div>
  </div>${investmentHTML}`;
}

// Gerçek TJK ikramiyesine dayanan aylık/yıllık yatırım-getiri özeti. Yalnızca ikramiye
// verisi bilinen (sonuç HTML'i yüklenmiş) toplantılar sayılır -- tahmini rakam üretilmez.
function buildInvestmentBacktestHTML(budgets, limit=25){
  limit=Math.max(1,Math.min(100,Number(limit)||25));
  const names={main:'Normal · 1 TEK',main2:'Normal · 2 TEK',surprise:'Uzman + Kulis'};
  const groups=_v24MeetingGroups().filter(tkpBacktestWithinResetPeriod).slice(-limit);
  const data={
    month:{main:{},main2:{},surprise:{}},
    year:{main:{},main2:{},surprise:{}}
  };

  function bucket(container,key){
    return container[key]||(container[key]={meetings:0,hits:0,cost:0,ret:0});
  }

  for(const rows of groups){
    const sorted=rows.slice().sort((a,b)=>(Number(a.leg)||0)-(Number(b.leg)||0));
    const lastRace=sorted[sorted.length-1];
    if(!lastRace) continue;
    const built=_v25BuildBacktestCoupons(rows,budgets);
    if(!built?.coupons) continue;

    const raceDate=String(
      lastRace.race_date
      || lastRace.date
      || (db?.files||[]).find(file=>String(file.id)===String(lastRace.file_id))?.race_date
      || ''
    );
    const monthKey=/^\d{4}-\d{2}/.test(raceDate)?raceDate.slice(0,7):'Tarihsiz';
    const yearKey=/^\d{4}/.test(raceDate)?raceDate.slice(0,4):'Tarihsiz';

    for(const couponKey of Object.keys(names)){
      const coupon=built.coupons[couponKey];
      if(!coupon||coupon.error) continue;
      const payout=realReturnForCoupon(coupon,lastRace,'altili');
      if(!payout.known) continue;
      const cost=Number(payout.cost)||Number(coupon.cost)||0;
      const ret=Number(payout.ret)||0;
      const hit=Boolean(payout.hit);

      for(const [granularity,periodKey] of [['month',monthKey],['year',yearKey]]){
        const row=bucket(data[granularity][couponKey],periodKey);
        row.meetings++;
        row.hits+=hit?1:0;
        row.cost+=cost;
        row.ret+=ret;
      }
    }
  }

  function table(granularity){
    let anyData=false;
    const blocks=Object.keys(names).map(couponKey=>{
      const buckets=data[granularity][couponKey];
      const keys=Object.keys(buckets).sort().reverse();
      if(!keys.length) return '';
      anyData=true;
      const rows=keys.map(periodKey=>{
        const value=buckets[periodKey];
        const net=value.ret-value.cost;
        const roi=value.cost?100*net/value.cost:0;
        return `<tr>
          <td>${esc(periodKey)}</td>
          <td class="num">${value.meetings}</td>
          <td class="num">${value.hits}</td>
          <td class="num">${fmtTL(value.cost)}</td>
          <td class="num">${fmtTL(value.ret)}</td>
          <td class="num" style="color:${net>=0?'#16a34a':'#dc2626'} !important;font-weight:800;">${fmt2(net)} TL</td>
          <td class="num">%${fmt2(roi)}</td>
        </tr>`;
      }).join('');
      return `<h4 style="margin:10px 0 4px;font-size:12px;">${names[couponKey]}</h4>
        <div class="tableWrap compactBacktest"><table>
          <thead><tr>
            <th>${granularity==='year'?'Yıl':'Ay'}</th>
            <th class="num">Toplantı</th>
            <th class="num">Tuttu</th>
            <th class="num">Yatırım</th>
            <th class="num">Getiri</th>
            <th class="num">Net</th>
            <th class="num">ROI</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
    }).join('');
    return {html:blocks,anyData};
  }

  const monthly=table('month');
  const yearly=table('year');
  if(!monthly.anyData&&!yearly.anyData){
    return `<div class="card" style="border-left:5px solid #16a34a;">
      <h2 style="margin:0 0 5px;">💰 Gerçek Yatırım/Getiri Özeti</h2>
      <p class="muted" style="margin:0;">Henüz gerçek ikramiye verisi yüklenmiş bir toplantı yok. Sonuç HTML'i yükledikçe bu panel otomatik dolacak.</p>
    </div>`;
  }

  return `<div class="card" style="border-left:5px solid #16a34a;">
    <h2 style="margin:0 0 5px;">💰 Gerçek Yatırım/Getiri Özeti</h2>
    <p class="muted" style="margin:0 0 8px;">Yalnızca gerçek TJK ikramiyesi bilinen toplantılardan hesaplanır; eksik günler dışlanır ve tahmini rakam üretilmez.</p>
    ${monthly.html}${yearly.html}
  </div>`;
}

function couponSnapshotContext(raceResults,source=''){
  const p=window.__lastPredictionPayload||{};
  const first=raceResults?.[0]?.r||{};
  const file=p.file || db?.files?.find?.(f=>String(f.id)===String(first.file_id)) || {};
  const date=String(file.race_date||file.date||first.race_date||first.date||'').trim();
  const hippodrome=couponCanonicalTrackName(file.hippodrome||first.hippodrome||'');
  const altiliNo=Math.max(1,Number(file.altili_no)||Number(first.altili_no)||1);
  const meetingUid=String(file.meeting_uid||first.meeting_uid||'').trim();
  return {
    date,hippodrome,altiliNo,meetingUid,source:String(source||''),
    key:[date,hippodrome,altiliNo,String(source||'')].join('|')
  };
}
function couponSnapshotMatchesContext(snapshot,ctx,source=null){
  if(!snapshot||!ctx) return false;
  if(source!=null && String(snapshot.source||'')!==String(source)) return false;
  const sDate=String(snapshot.race_date||String(snapshot.key||'').split('|')[0]||'').trim();
  const sHip=couponCanonicalTrackName(snapshot.hippodrome||String(snapshot.key||'').split('|')[1]||'');
  const sAlt=Number(snapshot.altili_no)||0;
  if(sDate!==ctx.date || sHip!==ctx.hippodrome) return false;
  // Eski snapshotlarda Altılı numarası yoktur. Aynı tarih/hipodrom için yalnız tek
  // oturum varsa geriye dönük kullanılabilir; yeni kayıtlarda her zaman kesin eşleşir.
  return !sAlt || sAlt===ctx.altiliNo;
}
const TKP_BACKTEST_SNAPSHOT_SOURCES=new Set(['SON_AGF_OTOMATIK','YARISTAN_40_DK_ONCE','SISTEM_GUNCEL_VERI','X_GUNCEL_OTOMATIK','HISTORICAL_CALIBRATION_FULL']);
function tkpBacktestEligibleSnapshotSource(source){return TKP_BACKTEST_SNAPSHOT_SOURCES.has(String(source||''));}
function tkpCouponSnapshotSourceMetadata(source){
  const payload=window.__lastPredictionPayload||{},meta=(payload?.source_metadata&&typeof payload.source_metadata==='object'?payload.source_metadata:(payload?.provenance&&typeof payload.provenance==='object'?payload.provenance:{}));
  const text=value=>typeof value==='string'||typeof value==='number'?String(value):'';
  const isX=String(source)==='X_GUNCEL_OTOMATIK';
  // X/Kulis yükleyicisi tek yazar yerine aynı koşu için birden fazla paylaşımı
  // birleştirebilir. Uygulama katmanı kaynak alanlarını verirse onları aynen
  // koru; vermezse kalıcı x_kulis_last özetinden tekrar üretilebilen kimlikleri
  // doldur. Böylece kaynak tipi yalnız "X" etiketi değil, ölçülebilir post/yazar
  // kanıtıdır ve sonuç sonrasında oluşmuş bir yorum canlı sayılmaz.
  const xLast=isX&&db?.settings?.x_kulis_last&&typeof db.settings.x_kulis_last==='object'?db.settings.x_kulis_last:{};
  const posts=Array.isArray(xLast?.posts)?xLast.posts:[];
  const authors=[...new Set(posts.map(post=>text(post?.author).trim()).filter(Boolean))];
  const postIds=[...new Set(posts.map(post=>text(post?.url)||`${text(post?.datetime)}|${text(post?.author)}`).filter(Boolean))];
  const bounded=values=>values.join(' | ').slice(0,2048);
  return {source_type:text(meta.source_type||payload.source_type)||(isX?'x':'system'),
    source_id:text(meta.source_id||payload.source_id||payload.x_source_id)||(isX?bounded(postIds):''),
    author_id:text(meta.author_id||payload.author_id||payload.x_author_id)||(isX?bounded(authors):'')};
}
function tkpSideBetExactRaceStartAt(race={}){
  try{const value=typeof tkpPredictionSnapshotRaceStartAt==='function'?tkpPredictionSnapshotRaceStartAt(race,{},false):'';if(value&&Number.isFinite(Date.parse(value)))return value;}catch(_){ }
  const direct=String(race?.race_start_at||race?.start_at||race?.race_start||race?.start_time_iso||'').trim();return Number.isFinite(Date.parse(direct))?new Date(Date.parse(direct)).toISOString():'';
}
// Altılı kuponu, ilk ayağın startından ÖNCE dondurulmuş olmalıdır. Tek tek
// ayak saatleri değişse bile en erken start güvenli kronoloji sınırıdır.
function tkpCouponSnapshotMeetingStartAt(raceResults){
  const starts=(raceResults||[]).map(item=>tkpSideBetExactRaceStartAt(item?.r||item)).filter(value=>Number.isFinite(Date.parse(value)));
  if(!starts.length)return '';
  return new Date(Math.min(...starts.map(value=>Date.parse(value)))).toISOString();
}
function tkpSideBetExactResultKnown(race={}){
  try{if(typeof raceHasConfirmedResult==='function')return !!raceHasConfirmedResult(race?.horses||[]);}catch(_){ }
  return (race?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>0);
}
const _tkpSideBetExactCapturePending=new Set();
async function tkpCaptureExactSideBetTickets(snapshot,raceResults){
  if(!snapshot||!tkpBacktestEligibleSnapshotSource(snapshot.source)||typeof globalThis.tkpWeeklyModelTrackerAppendExactSideBetTickets!=='function')return 0;
  const rows=(raceResults||[]).map(item=>item?.r?item:{r:item,scored:item?.horses||[]}).filter(item=>item?.r).slice().sort((a,b)=>(Number(a.r?.leg)||0)-(Number(b.r?.leg)||0));
  const specs=[];
  for(let index=0;index<rows.length;index++){
    const x=rows[index],startAt=tkpSideBetExactRaceStartAt(x.r);
    // Kilit işi asla sonucu görünen veya saati geçmiş bir ayağı yeniden üretmez.
    if(tkpSideBetExactResultKnown(x.r)||!Number.isFinite(Date.parse(startAt))||Date.now()>=Date.parse(startAt))continue;
    const next=rows[index+1]&&Number(rows[index+1]?.r?.leg)===Number(x.r?.leg)+1?rows[index+1]:null;
    const stats=typeof sideBetPanelStatsFast==='function'?sideBetPanelStatsFast(x.r):{};
    if(typeof tkpPrepareSideBetRaceAsync==='function')await tkpPrepareSideBetRaceAsync(x);
    const capture=()=>sideBetTicketForRace(x,stats,next,{exactSpecs:specs});
    if(typeof tkpWithSideBetPanelNoScan==='function')tkpWithSideBetPanelNoScan(capture);else capture();
    // Aynı toplantıdaki bilet üretimi, özellikle büyük arşiv açıkken ana UI akışını
    // tutmamalıdır. Her ayaktan sonra tarayıcıya kısa bir fırsat verilir.
    if(typeof tkpYield==='function')await tkpYield();
  }
  if(!specs.length)return 0;
  return globalThis.tkpWeeklyModelTrackerAppendExactSideBetTickets(snapshot,specs);
}
function tkpScheduleExactSideBetTickets(snapshot,raceResults){
  if(!snapshot||!tkpBacktestEligibleSnapshotSource(snapshot.source))return false;
  const key=String(snapshot.id||snapshot.key||'');if(!key||_tkpSideBetExactCapturePending.has(key))return false;
  _tkpSideBetExactCapturePending.add(key);
  setTimeout(()=>{Promise.resolve(tkpCaptureExactSideBetTickets(snapshot,raceResults)).catch(()=>0).finally(()=>_tkpSideBetExactCapturePending.delete(key));},0);
  return true;
}
// Eski veri paketlerinde yarış öncesi kuponlar bu kaynak adlarıyla kaydedildi.
// Backtest kanıtı sayılmazlar; ancak aynı toplantı kesin eşleşiyorsa kullanıcının
// kayıtlı kuponunu yarış sonrasında salt okunur göstermek için geçerlidirler.
const TKP_LOCKED_COUPON_DISPLAY_SOURCE_PRIORITY=[
  'SON_AGF_OTOMATIK','YARISTAN_40_DK_ONCE','SISTEM_GUNCEL_VERI','X_GUNCEL_OTOMATIK',
  'HISTORICAL_CALIBRATION_FULL','ORIGINAL_TAHMIN','GUNCEL_KURAL_ONIZLEME','SON_KUPON','MANUEL'
];
// Kupon kartı oluştuğu anda küçük bir write-ahead kopya da saklanır. Büyük
// parçalı DB manifest yazımı tarayıcı/sekme kapanışına yetişmese bile Ctrl+F5
// sonrasında kupon görünür kalır. Bu küçük kayıt ana IndexedDB'nin yerine
// geçmez; ama kupon kartının ilk boyasını tam veritabanı yazısı uğruna bekletmez.
const TKP_CURRENT_COUPON_WAL_KEY='tkp_current_coupon_snapshot_wal_v1';
const TKP_CURRENT_COUPON_WAL_MAX_ENTRIES=4;
const TKP_CURRENT_COUPON_WAL_TTL_MS=7*24*60*60*1000;
let _tkpLastCouponSnapshotPersistence=Promise.resolve(true);
function tkpCouponWalStorageList(){
  const stores=[];
  try{if(typeof sessionStorage!=='undefined')stores.push(sessionStorage);}catch(_e){}
  try{if(typeof localStorage!=='undefined')stores.push(localStorage);}catch(_e){}
  return stores;
}
function tkpCouponWalEntries(row){
  const list=Array.isArray(row?.entries)?row.entries:(row?.snapshot?[row.snapshot]:[]);
  const now=Date.now();
  return list.filter(snapshot=>{
    if(!snapshot||typeof snapshot!=='object')return false;
    const at=Date.parse(String(snapshot.created_at||row?.saved_at||''));
    return !Number.isFinite(at)||now-at<=TKP_CURRENT_COUPON_WAL_TTL_MS;
  });
}
function tkpCouponWalDeduped(entries){
  const seen=new Set(),out=[];
  for(const snapshot of (entries||[]).slice().sort((a,b)=>String(b?.created_at||'').localeCompare(String(a?.created_at||'')))){
    const key=String(snapshot?.id||snapshot?.key||'');
    if(!key||seen.has(key))continue;
    seen.add(key);out.push(snapshot);
    if(out.length>=TKP_CURRENT_COUPON_WAL_MAX_ENTRIES)break;
  }
  return out;
}
function tkpReadCurrentCouponSnapshotWals(){
  const entries=[];
  for(const store of tkpCouponWalStorageList()){
    try{entries.push(...tkpCouponWalEntries(JSON.parse(store.getItem(TKP_CURRENT_COUPON_WAL_KEY)||'null')));}catch(_e){}
  }
  return tkpCouponWalDeduped(entries);
}
function tkpReadCurrentCouponSnapshotWal(){return tkpReadCurrentCouponSnapshotWals()[0]||null;}
function tkpWriteCurrentCouponSnapshotWal(snapshot){
  if(!snapshot||typeof snapshot!=='object')return false;
  const entries=tkpCouponWalDeduped([snapshot,...tkpReadCurrentCouponSnapshotWals()]);
  const payload={version:2,saved_at:new Date().toISOString(),entries};
  let written=false;
  for(const store of tkpCouponWalStorageList()){
    try{store.setItem(TKP_CURRENT_COUPON_WAL_KEY,JSON.stringify(payload));written=true;}catch(_e){}
  }
  // Aynı küçük satırı ayrı IndexedDB UI store'a da bırak. Bu yol asenkron olduğu
  // için kupon boyasını bekletmez; ana DB yazımı başarısızsa teşhis/kurtarma için
  // ek kanıt sağlar.
  try{if(typeof tkpUiCacheSet==='function')Promise.resolve(tkpUiCacheSet(TKP_CURRENT_COUPON_WAL_KEY,payload)).catch(()=>{});}catch(_e){}
  return written;
}
function tkpClearCurrentCouponSnapshotWal(snapshotId){
  let changed=false;
  for(const store of tkpCouponWalStorageList()){
    try{
      const row=JSON.parse(store.getItem(TKP_CURRENT_COUPON_WAL_KEY)||'null');
      const before=tkpCouponWalEntries(row);
      const entries=snapshotId?before.filter(snapshot=>String(snapshot?.id||'')!==String(snapshotId)):[];
      if(entries.length===before.length)continue;
      if(entries.length)store.setItem(TKP_CURRENT_COUPON_WAL_KEY,JSON.stringify({version:2,saved_at:new Date().toISOString(),entries}));
      else store.removeItem(TKP_CURRENT_COUPON_WAL_KEY);
      changed=true;
    }catch(_e){}
  }
  return changed;
}
function tkpCouponSnapshotPersistencePromise(){return _tkpLastCouponSnapshotPersistence;}
if(typeof globalThis!=='undefined'){
  globalThis.tkpCouponSnapshotPersistencePromise=tkpCouponSnapshotPersistencePromise;
  globalThis.tkpReadCurrentCouponSnapshotWal=tkpReadCurrentCouponSnapshotWal;
  globalThis.tkpReadCurrentCouponSnapshotWals=tkpReadCurrentCouponSnapshotWals;
}
function tkpLockedCouponDisplaySourcePriority(source){
  const i=TKP_LOCKED_COUPON_DISPLAY_SOURCE_PRIORITY.indexOf(String(source||''));
  return i<0?Number.MAX_SAFE_INTEGER:i;
}

// Yarış saati geçtikten sonra yeni kupon üretmek yasaktır; fakat kullanıcı daha
// önce sistemin gerçekten kaydettiği yarış-öncesi kuponu görebilmelidir. Yalnız
// Önce backtest için kabul edilen otomatik kaynak okunur. Yeni otomatik snapshot
// yoksa aynı toplantının eski ORIGINAL_TAHMIN/GUNCEL_KURAL_ONIZLEME/SON_KUPON/
// MANUEL kaydı yalnız ekranda salt okunur gösterilir; backtest'e dahil edilmez.
function tkpRestoreForwardTrackedCoupons(raceResults){
  if(!db||!Array.isArray(db.forward_tracking_log)||!Array.isArray(raceResults)||!raceResults.length)return null;
  const ctx=couponSnapshotContext(raceResults,'');
  const rows=db.forward_tracking_log.filter(row=>String(row?.race_date||'').trim()===ctx.date&&couponCanonicalTrackName(row?.hippodrome||'')===ctx.hippodrome&&(Number(row?.altili_no)||1)===ctx.altiliNo&&row?.coupons&&typeof row.coupons==='object');
  if(!rows.length)return null;
  const raceByLeg=new Map(raceResults.map(x=>[Number(x?.r?.leg)||0,x]));
  const labels={main:'💪 Normal Kupon',alt:'💣 Sürpriz Altılı',surprise:'🧠 Uzman + Kulis — Hibrit Altılı'};
  const restored={};
  for(const typeKey of ['main','alt','surprise']){
    const legs=[];
    for(const row of rows.slice().sort((a,b)=>(Number(a?.leg)||0)-(Number(b?.leg)||0))){
      const x=raceByLeg.get(Number(row?.leg)||0),nos=Array.isArray(row?.coupons?.[typeKey])?row.coupons[typeKey]:[];
      if(!x||!nos.length)continue;
      const horses=x?.r?.horses||x?.scored||[],byNo=new Map(horses.map(h=>[String(h?.horse_no),h]));
      const picks=nos.map(no=>byNo.get(String(no))).filter(Boolean);if(!picks.length)continue;
      legs.push({x,r:x.r,picks,displayOrder:x.scored||horses,ordered:x.scored||horses,allHorses:horses,restoredPreRaceSnapshot:true});
    }
    restored[typeKey]=legs.length?{typeKey,label:labels[typeKey],legs,unit:0,cost:0,combos:0,legCount:legs.length,budgetTL:0,leftover:0,readOnlySnapshot:true,snapshotSource:'ILERI_TAKIP',verifiedAutomaticSnapshot:true,adaptiveBudgetNote:'🔒 İleri Takip yarış-öncesi kupon kaydı'}:{typeKey,error:'Bu strateji için kayıtlı kupon bulunamadı.'};
  }
  if(!['main','alt','surprise'].some(k=>restored[k]&&!restored[k].error))return null;
  activeCoupons.main=restored.main;activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};activeCoupons.alt=restored.alt;activeCoupons.surprise=restored.surprise;
  return {id:'FORWARD-'+ctx.key,source:'ILERI_TAKIP',created_at:'',coupons:restored,forwardTrackingFallback:true};
}
function tkpRestoreLatestPreRaceCouponSnapshot(raceResults){
  if(!db||!Array.isArray(raceResults)||!raceResults.length)return null;
  if(!Array.isArray(db.auto_coupon_log))db.auto_coupon_log=[];
  const ctx=couponSnapshotContext(raceResults,'');
  const snapshotUsable=s=>['main','alt','surprise'].some(k=>{const c=s?.coupons?.[k];return c&&!c.error&&Array.isArray(c.legs)&&c.legs.some(l=>Array.isArray(l?.picks)&&l.picks.length);});
  const matching=db.auto_coupon_log.filter(s=>
    couponSnapshotMatchesContext(s,ctx)
    && tkpLockedCouponDisplaySourcePriority(s?.source)<Number.MAX_SAFE_INTEGER
    && s?.coupons&&typeof s.coupons==='object'
    && snapshotUsable(s)
  );
  const verified=matching
    .filter(s=>tkpBacktestEligibleSnapshotSource(s?.source)&&Number(s?.manual_adjustment)!==1)
    .sort((a,b)=>String(b?.created_at||'').localeCompare(String(a?.created_at||'')))[0]||null;
  const snapshot=verified||matching.slice().sort((a,b)=>
    tkpLockedCouponDisplaySourcePriority(a?.source)-tkpLockedCouponDisplaySourcePriority(b?.source)
    || String(b?.created_at||'').localeCompare(String(a?.created_at||''))
  )[0]||null;
  if(!snapshot)return tkpRestoreForwardTrackedCoupons(raceResults);
  const distinctSingles=globalThis.TKP_COUPON_COVERAGE?.auditSet?.(snapshot.coupons)?.valid===true;
  const verifiedAutomatic=!!verified;
  const raceByLeg=new Map(raceResults.map(x=>[Number(x?.r?.leg)||0,x]));
  const labels={main:'💪 Normal Kupon',alt:'💣 Sürpriz Altılı',surprise:'🧠 Uzman + Kulis — Hibrit Altılı'};
  const restored={};
  for(const typeKey of ['main','alt','surprise']){
    const saved=snapshot.coupons?.[typeKey];
    if(!saved||saved.error){restored[typeKey]={typeKey,error:saved?.error||'Bu strateji için yarış öncesi snapshot bulunamadı.'};continue;}
    const legs=(saved.legs||[]).map(row=>{
      const x=raceByLeg.get(Number(row?.leg)||0);if(!x)return null;
      const horses=x?.r?.horses||x?.scored||[];
      const byNo=new Map(horses.map(h=>[String(h?.horse_no),h]));
      const picks=(row?.picks||[]).map(no=>byNo.get(String(no))).filter(Boolean);
      return {x,r:x.r,picks,displayOrder:x.scored||horses,ordered:x.scored||horses,allHorses:horses,restoredPreRaceSnapshot:true,selectionOrderNos:row.selectionOrderNos||saved.policyAudit?.legs?.find(l=>Number(l.leg)===Number(row.leg))?.input?.map(h=>h.no)||row.picks,policyAudit:saved.policyAudit?.legs?.find(l=>Number(l.leg)===Number(row.leg))||null};
    }).filter(Boolean);
    const unit=Number(saved.unit)||0,cost=Number(saved.cost)||0;
    restored[typeKey]={typeKey,label:labels[typeKey],legs,unit,cost,combos:unit?cost/unit:0,legCount:legs.length,
      budgetTL:Number(snapshot.effective_budgets?.[typeKey]??snapshot.budgets?.[typeKey]??snapshot.effective_budgets?.surprise??snapshot.budgets?.surprise??snapshot.effective_budgets?.main??snapshot.budgets?.main)||cost,
      leftover:0,readOnlySnapshot:true,snapshotId:snapshot.id,snapshotSource:snapshot.source,
      calculationLimited:saved.calculationLimited===true,algorithmVersion:saved.algorithmVersion||snapshot.algorithm_version,policyAudit:saved.policyAudit||null,
      singlePolicyWarning:distinctSingles?'':'Eski kayıt: üç kupon için farklı TEK şartı sağlanmıyor. Bu kayıt güncel öneri değildir.',
      verifiedAutomaticSnapshot:verifiedAutomatic,decisionSnapshot:saved.decision||null,
      adaptiveBudgetNote:Number(snapshot?.archive_snapshot)===1
        ?`📚 Eski kayıt · ${String(snapshot.created_at||'').replace('T',' ').slice(0,10)} · güncel algoritma yeniden çalıştırılmadı`
        :`🔒 ${verifiedAutomatic?'Doğrulanmış otomatik':'Kayıtlı eski'} yarış öncesi kupon · ${String(snapshot.source||'KAYIT')} · ${String(snapshot.created_at||'').replace('T',' ').slice(0,16)}`};
  }
  activeCoupons.main=restored.main;activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};
  activeCoupons.alt=restored.alt;activeCoupons.surprise=restored.surprise;
  return snapshot;
}
// Ctrl+F5 yalnız RAM'i temizler. Aynı veri parmak iziyle daha önce üretilmiş
// canlı kupon yeniden hesaplanmaz; eski/başka veriyle üretilmiş snapshot geri
// bağlanamaz.
function tkpCouponSnapshotMatchesRequestedBudgets(snapshot,requested){
  if(!requested||typeof requested!=='object')return true;
  const targetMain=Number(requested.main),targetSurprise=Number(requested.surprise);
  const declared=snapshot?.requested_budgets&&typeof snapshot.requested_budgets==='object'
    ?snapshot.requested_budgets
    :snapshot?.budgets;
  const exact=(value,target)=>Number.isFinite(Number(value))&&Number(value)>0&&Math.abs(Number(value)-Number(target))<0.0001;
  if(declared&&typeof declared==='object'&&Number(declared.main)>0&&Number(declared.surprise)>0){
    return exact(declared.main,targetMain)&&exact(declared.surprise,targetSurprise);
  }
  // Eski sürümlerde yalnız dinamik/efektif hedef kaydedilmişti. Bu kayıtlar
  // kullanıcının tavanını aşmıyorsa güvenli biçimde geri açılır; yeni snapshotlar
  // yukarıdaki kesin kullanıcı talebiyle eşleşir.
  const legacy=snapshot?.effective_budgets&&typeof snapshot.effective_budgets==='object'
    ?snapshot.effective_budgets
    :snapshot?.budgets;
  const within=(value,target)=>Number(value)>0&&Number.isFinite(Number(target))&&Number(value)<=Number(target)+0.0001;
  return Boolean(legacy&&within(legacy.main,targetMain)&&within(legacy.surprise,targetSurprise));
}
function tkpRestoreCurrentCouponSnapshotIfFresh(raceResults,budgets=null){
  if(!db||!Array.isArray(raceResults)||!raceResults.length||typeof tkpLiveCouponFingerprint!=='function')return null;
  const fingerprint=tkpLiveCouponFingerprint(raceResults);
  const ctx=couponSnapshotContext(raceResults,'');
  const requested=budgets&&typeof budgets==='object'&&typeof tkpCouponBudgetPolicy==='function'
    ?tkpCouponBudgetPolicy(budgets)
    :null;
  const rows=(db.auto_coupon_log||[]).filter(snapshot=>
    couponSnapshotMatchesContext(snapshot,ctx)
    && globalThis.TKP_COUPON_COVERAGE?.auditSet?.(snapshot.coupons)?.valid===true
    && snapshot.single_policy_version===globalThis.TKP_COUPON_COVERAGE?.singlePolicyVersion
    && String(snapshot?.data_signature||'')===fingerprint
    && tkpCouponSnapshotMatchesRequestedBudgets(snapshot,requested)
    && snapshot?.coupons&&typeof snapshot.coupons==='object'
  ).sort((a,b)=>String(b?.created_at||'').localeCompare(String(a?.created_at||'')));
  // Büyük manifest yazısı henüz tamamlanmadan Ctrl+F5 gelirse küçük WAL aynı
  // canlı veri imzasıyla eşleştiğinde güvenli şekilde devreye girer. Otomatik
  // ve SON_KUPON kaynakları ayrı tutulur; geri açılışta kaynak önceliği yine
  // normal snapshot seçicisi tarafından uygulanır.
  for(const wal of (typeof tkpReadCurrentCouponSnapshotWals==='function'?tkpReadCurrentCouponSnapshotWals():[tkpReadCurrentCouponSnapshotWal()]).filter(Boolean)){
    if(couponSnapshotMatchesContext(wal,ctx)
      && globalThis.TKP_COUPON_COVERAGE?.auditSet?.(wal.coupons)?.valid===true
      && wal.single_policy_version===globalThis.TKP_COUPON_COVERAGE?.singlePolicyVersion
      && String(wal?.data_signature||'')===fingerprint
      && tkpCouponSnapshotMatchesRequestedBudgets(wal,requested)
      && wal?.coupons&&typeof wal.coupons==='object'
      && !rows.some(snapshot=>String(snapshot?.id||'')===String(wal?.id||''))) rows.push(wal);
  }
  if(!rows.length)return null;
  const original=db.auto_coupon_log;
  try{db.auto_coupon_log=rows;return tkpRestoreLatestPreRaceCouponSnapshot(raceResults);}
  finally{db.auto_coupon_log=original;}
}
if(typeof globalThis!=='undefined')globalThis.tkpRestoreCurrentCouponSnapshotIfFresh=tkpRestoreCurrentCouponSnapshotIfFresh;
function saveAutomaticCouponSnapshot(raceResults,coupons,budgets,source){
  if(!db || tkpCouponMeetingLocked(raceResults)) return false;
  if(!Array.isArray(db.auto_coupon_log)) db.auto_coupon_log=[];
  const ctx=couponSnapshotContext(raceResults,source);
  const backtestEligible=tkpBacktestEligibleSnapshotSource(source);
  const singleSetAudit=globalThis.TKP_COUPON_COVERAGE?.auditSet?.(coupons);
  if(backtestEligible&&singleSetAudit?.valid!==true)return false;
  const sourceMetadata=tkpCouponSnapshotSourceMetadata(source);
  const createdAt=new Date().toISOString();
  const meetingStartAt=tkpCouponSnapshotMeetingStartAt(raceResults);
  const timeVerified=Number.isFinite(Date.parse(meetingStartAt))&&Date.parse(createdAt)<=Date.parse(meetingStartAt);
  // Kullanıcının girdiği tavan ile motorun maliyete göre seçtiği efektif hedef
  // aynı şey değildir. İlki restore sözleşmesidir; ikincisi yalnız bilgi/maliyet
  // içindir. Eski kod efektif hedefi `budgets` diye yazıp yeniden açılışta kullanıcı
  // tavanıyla birebir karşılaştırdığı için doğru kuponu reddediyordu.
  const requestedBudgets={...(budgets||{})};
  const effectiveBudgets={
    main:Number(coupons?.main?.budgetTL)||Number(requestedBudgets.main)||0,
    main2:Number(coupons?.main2?.budgetTL)||Number(requestedBudgets.main2)||0,
    alt:Number(coupons?.alt?.budgetTL)||Number(requestedBudgets.alt)||0,
    surprise:Number(coupons?.surprise?.budgetTL)||Number(requestedBudgets.surprise)||0,
    normalMode:requestedBudgets.normalMode||''
  };
  const snapshot={
    single_policy_version:singleSetAudit?.valid?singleSetAudit.version:null,
    schema_version:5,algorithm_version:Object.values(coupons||{}).some(c=>c?.calculationLimited)?'R16.80-BOUNDED-COVERAGE':globalThis.TKP_V55_ALGORITHM_VERSION||'V55',id:`AC-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,key:ctx.key,created_at:createdAt,source,
    backtest_eligible:backtestEligible?1:0,manual_adjustment:backtestEligible?0:1,
    // Bu alanlar Back Test'in sadece gerçek yarış-öncesi kuponu almasını sağlar.
    // Saat kanıtı yoksa kupon ekranda saklanır, ancak yeni kayıtta doğrulanmış
    // performans sayacına katılmaz; sonradan varsayım üretilmez.
    pre_race_only:backtestEligible&&timeVerified?1:0,
    snapshot_time_verified:timeVerified?1:0,
    meeting_start_at:meetingStartAt,
    snapshot_locked_at:createdAt,
    resolution_state:'PENDING',
    race_date:ctx.date,hippodrome:ctx.hippodrome,altili_no:ctx.altiliNo,meeting_uid:ctx.meetingUid,
    data_signature:typeof tkpLiveCouponFingerprint==='function'?tkpLiveCouponFingerprint(raceResults):'',
    source_type:sourceMetadata.source_type,source_id:sourceMetadata.source_id,author_id:sourceMetadata.author_id,
    // `budgets` geriye dönük sözleşmede kullanıcı tavanıdır. Yeni alanlar açık
    // isimli tutulur ki eski backup/diagnostics satırları da okunabilsin.
    budgets:requestedBudgets,
    requested_budgets:requestedBudgets,
    effective_budgets:effectiveBudgets,
    coupons:Object.fromEntries(Object.entries(coupons||{}).map(([k,c])=>[k,c?.error
      ? {error:c.error}
      : {cost:Number(c?.cost)||0,unit:Number(c?.unit)||0,
        calculationLimited:c?.calculationLimited===true,algorithmVersion:c?.calculationLimited?'R16.80-BOUNDED-COVERAGE':c?.algorithmVersion||globalThis.TKP_V55_ALGORITHM_VERSION||'V55',
        policyAudit:c?.policyAudit?JSON.parse(JSON.stringify(c.policyAudit)):null,
        decision:(()=>{try{const d=typeof tkpCouponDecisionData==='function'?tkpCouponDecisionData(c):null;return d?{label:d.label,summary:d.summary,reason:d.reason}:null;}catch(_e){return null;}})(),
        legs:(c?.legs||[]).map(l=>({
          leg:Number(l?.x?.r?.leg??l?.r?.leg??l?.race?.leg)||0,
          picks:(l?.picks||[]).map(h=>String(h?.horse_no??h)).filter(Boolean),
          selectionOrderNos:l.selectionOrderNos||(l.ordered||l.allHorses||l.picks||[]).map(h=>String(h?.horse_no??h)).filter(Boolean)
        }))}
    ]))
  };
  db.auto_coupon_log=db.auto_coupon_log.filter(x=>x.key!==ctx.key);
  db.auto_coupon_log.push(snapshot);
  tkpWriteCurrentCouponSnapshotWal(snapshot);
  // Yarış öncesi gerçek snapshotlar öğrenme/backtest kanıtıdır; son-N diye silinmez.
  if(backtestEligible){
    try{ if(typeof tkpForwardTrackingAttachCouponSnapshot==='function') tkpForwardTrackingAttachCouponSnapshot(snapshot,{persist:false}); }catch(_e){}
    try{ if(typeof tkpWeeklyModelTrackerAttachCouponSnapshot==='function') tkpWeeklyModelTrackerAttachCouponSnapshot(snapshot,{persist:false}); }catch(_e){}
    try{ tkpScheduleExactSideBetTickets(snapshot,raceResults); }catch(_e){}
  }
  // Aynı toplantı yeniden alınırsa dizi uzunluğu değişmeyebilir. Back Test ve
  // kalıcı HTML önbelleğinin eski kuponu göstermemesi için O(1) revizyon tutulur.
  db.settings=db.settings&&typeof db.settings==='object'?db.settings:{};
  db.settings.backtest_snapshot_revision=Math.max(0,Number(db.settings.backtest_snapshot_revision)||0)+1;
  db.settings.backtest_snapshot_updated_at=createdAt;
  try{if(typeof globalThis.tkpInvalidateFastBacktestCache==='function')globalThis.tkpInvalidateFastBacktestCache();}catch(_e){}
  try{
    if(typeof window!=='undefined'&&typeof window.dispatchEvent==='function'){
      // Back Test kendi O(1) revizyonuyla geçersizleşir. Bütün yan-bahis/panel
      // Promise'lerini silmek ise tam post-kupon ısıtma başlarken çift hesap
      // açabiliyordu; bu nedenle couponSnapshotChanged ayrı, dar kapsamlı sinyaldir.
      window.dispatchEvent(new CustomEvent('tkp:db-changed',{detail:{backtestChanged:true,couponSnapshotChanged:true,snapshotId:snapshot.id}}));
    }
  }catch(_e){}
  try{if(typeof globalThis.tkpScheduleCurrentBacktestRefresh==='function')globalThis.tkpScheduleCurrentBacktestRefresh({reason:'coupon-snapshot'});}catch(_e){}
  // WAL yazısı yukarıda senkron tamamlandı. 509 toplantının tamamını yeniden
  // taramak yerine yalnız kuponun gerçekten değiştirebildiği günlük koleksiyonlar
  // atomik manifeste yazılır. Böylece Ctrl+F5 kalıcılığı korunurken tahmin ekranı
  // arka plandaki 6-7 saniyelik tam-arşiv yazımıyla kilitlenmez.
  try{
    const changedCollections=['auto_coupon_log'];
    if(backtestEligible)changedCollections.push('forward_tracking_log','weekly_model_log','sidebet_ticket_log');
    const persist=typeof globalThis.tkpPersistCollections==='function'
      ?globalThis.tkpPersistCollections(changedCollections,{metaPatch:{settings:db.settings},label:'coupon-snapshot'})
      :saveDB(false,false);
    _tkpLastCouponSnapshotPersistence=Promise.resolve(persist).then(ok=>{
      if(ok===false)throw new Error('IndexedDB kupon snapshot yazısını onaylamadı.');
      tkpClearCurrentCouponSnapshotWal(snapshot.id);
      return true;
    }).catch(error=>{
      console.error('Kupon snapshot kalıcı yazılamadı',error);
      return false;
    });
    if(typeof globalThis!=='undefined')globalThis.__tkpLastCouponSnapshotPersistence=_tkpLastCouponSnapshotPersistence;
  }catch(e){
    console.error('Kupon snapshot yazımı başlatılamadı',e);
    _tkpLastCouponSnapshotPersistence=Promise.resolve(false);
  }
  return snapshot;
}
function _v24ReadBudgets(){
  const policy=typeof tkpCouponBudgetPolicy==='function'
    ?tkpCouponBudgetPolicy({main:Number(document.getElementById('normalCouponBudget')?.value)||800,surprise:Number(document.getElementById('surpriseCouponBudget')?.value)||900})
    :{main:1200,surprise:1200,normalMode:'standard'};
  return {main:policy.main,main2:policy.main,alt:0,surprise:policy.surprise,normalMode:policy.normalMode};
}
function _v25ReadSideBetLimits(){
  // V46 gerçek veriyle seçilen sabit pozisyon havuzlarının kesin tavanları.
  const uclu=Math.min(450,Math.max(250,Number(document.getElementById('ucluBetLimit')?.value)||450));
  const dortlu=Math.min(750,Math.max(400,Number(document.getElementById('dortluBetLimit')?.value)||750));
  const sirali5li=Math.min(750,Math.max(400,Number(document.getElementById('sirali5liBetLimit')?.value)||750));
  return {uclu,dortlu,sirali5li};
}
async function autoBuildCouponsAfterFinalAgf(){
  if(!lastRaceResults?.length) return false;
  const budgets=_v24ReadBudgets();
  const restored=tkpRestoreCurrentCouponSnapshotIfFresh(lastRaceResults,budgets);
  if(restored){
    if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
    if(typeof refreshRenderedSideBetPanel==='function')refreshRenderedSideBetPanel();
    const status=document.getElementById('finalAgfFileName');
    if(status)status.textContent+=' · Veri ve bütçe değişmedi; kayıtlı üç kupon/portföy açıldı, yeniden hesaplanmadı.';
    return {restored:true,snapshot:restored};
  }
  const fastSet=typeof tkpBuildCouponSetAdaptiveAsync==='function'?await tkpBuildCouponSetAdaptiveAsync(lastRaceResults,budgets):buildCouponSetFast(lastRaceResults,budgets);
  activeCoupons.main=fastSet.main;activeCoupons.main2=fastSet.main2;activeCoupons.alt=fastSet.alt;activeCoupons.surprise=fastSet.surprise;
  if(typeof refreshRecommendedHorsePanelsFromCoupon==='function') refreshRecommendedHorsePanelsFromCoupon();
  saveAutomaticCouponSnapshot(lastRaceResults,activeCoupons,budgets,'SON_AGF_OTOMATIK');
  if(typeof refreshRenderedSideBetPanel==='function') refreshRenderedSideBetPanel();
  const status=document.getElementById('finalAgfFileName'); if(status) status.textContent+=' · Normal / Sürpriz / Uzman + Kulis otomatik oluşturuldu. Back Test isteğe bağlıdır.';
  return true;
}
async function tkpBuildCouponsAfterDataCollection(raceResults=null){
  const rows=Array.isArray(raceResults)&&raceResults.length?raceResults:lastRaceResults;
  if(!Array.isArray(rows)||!rows.length||tkpCouponMeetingLocked(rows))return {ok:false,reason:'locked_or_empty'};
  const budgets=_v24ReadBudgets();
  const restored=tkpRestoreCurrentCouponSnapshotIfFresh(rows,budgets);
  if(restored)return {ok:true,restored:true,snapshot:restored};
  const fastSet=typeof tkpBuildCouponSetAdaptiveAsync==='function'
    ?await tkpBuildCouponSetAdaptiveAsync(rows,budgets)
    :tkpBuildCouponSetAdaptive(rows,budgets);
  activeCoupons.main=fastSet.main;
  activeCoupons.main2={disabled:true,removed:true,legs:[],cost:0};
  activeCoupons.alt=fastSet.alt;
  activeCoupons.surprise=fastSet.surprise;
  if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
  // Snapshot restore anahtarı kullanıcının istek tavanıdır; efektif motor hedefi
  // saveAutomaticCouponSnapshot içinde ayrı alan olarak üretilir.
  saveAutomaticCouponSnapshot(rows,activeCoupons,budgets,'SISTEM_GUNCEL_VERI');
  // İlk otomatik üretimde ikinci SON_KUPON kaydını yazmak yalnızca DB/WAL işini
  // ikiye katlıyordu. SON_KUPON, kullanıcı manuel değişiklik yaptığında veya A4
  // paylaşımı istediğinde zaten tkpPersistFinalCouponSnapshot ile kaydedilir.
  if(typeof refreshRenderedSideBetPanel==='function')refreshRenderedSideBetPanel();
  return {ok:true,restored:false,fastSet};
}
if(typeof globalThis!=='undefined')globalThis.tkpBuildCouponsAfterDataCollection=tkpBuildCouponsAfterDataCollection;
async function autoBuildCouponsAfterLiveXUpdate(){
  if(!lastRaceResults?.length||tkpCouponMeetingLocked(lastRaceResults))return false;
  const budgets=_v24ReadBudgets();
  const restored=tkpRestoreCurrentCouponSnapshotIfFresh(lastRaceResults,budgets);
  if(restored){
    if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
    if(typeof refreshRenderedSideBetPanel==='function')refreshRenderedSideBetPanel();
    return {restored:true,snapshot:restored};
  }
  const fastSet=typeof tkpBuildCouponSetAdaptiveAsync==='function'?await tkpBuildCouponSetAdaptiveAsync(lastRaceResults,budgets):buildCouponSetFast(lastRaceResults,budgets);
  activeCoupons.main=fastSet.main;activeCoupons.main2=fastSet.main2;activeCoupons.alt=fastSet.alt;activeCoupons.surprise=fastSet.surprise;
  if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
  saveAutomaticCouponSnapshot(lastRaceResults,activeCoupons,budgets,'X_GUNCEL_OTOMATIK');
  if(typeof refreshRenderedSideBetPanel==='function')refreshRenderedSideBetPanel();
  return true;
}
async function autoBuildCouponsFortyMinutesBefore(){
  if(!lastRaceResults?.length) return false;
  const p=window.__lastPredictionPayload||{}; const races=p.races||lastRaceResults.map(x=>x.r);
  // V332 T-40 kök hatası: TJK parser'ının gerçek alanı `tjk_race_time` ve tarih
  // ISO `yyyy-mm-dd` iken eski kod yalnız race_time + dd.mm.yyyy okuyordu. Bu
  // yüzden özellikle 20:00 toplantısında timer çalışıyor görünse de kupon üretmiyordu.
  const parsed=races.map(r=>{
    const direct=String(r?.race_start_at||r?.start_at||r?.start_time_iso||'').trim();
    if(direct&&Number.isFinite(Date.parse(direct)))return Date.parse(direct);
    const time=String(r?.tjk_race_time||r?.race_time||r?.start_time||r?.time||'').trim();
    const tm=time.match(/(\d{1,2}):(\d{2})/);if(!tm)return null;
    let date=String(r?.race_date||r?.date||p.file?.race_date||p.file?.date||'').trim();
    const tr=date.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);if(tr)date=`${tr[3]}-${String(tr[2]).padStart(2,'0')}-${String(tr[1]).padStart(2,'0')}`;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
    const value=Date.parse(`${date}T${String(tm[1]).padStart(2,'0')}:${tm[2]}:00+03:00`);
    return Number.isFinite(value)?value:null;
  }).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!parsed.length) return false; const diff=parsed[0]-Date.now(); if(diff>40*60000||diff<0) return false;
  const budgets=_v24ReadBudgets();
  const restored=tkpRestoreCurrentCouponSnapshotIfFresh(lastRaceResults,budgets);
  if(restored){
    if(typeof refreshRecommendedHorsePanelsFromCoupon==='function')refreshRecommendedHorsePanelsFromCoupon();
    if(typeof refreshRenderedSideBetPanel==='function')refreshRenderedSideBetPanel();
    return {restored:true,snapshot:restored};
  }
  const fastSet=typeof tkpBuildCouponSetAdaptiveAsync==='function'?await tkpBuildCouponSetAdaptiveAsync(lastRaceResults,budgets):buildCouponSetFast(lastRaceResults,budgets);activeCoupons.main=fastSet.main;activeCoupons.main2=fastSet.main2;activeCoupons.alt=fastSet.alt;activeCoupons.surprise=fastSet.surprise;if(typeof refreshRecommendedHorsePanelsFromCoupon==='function') refreshRecommendedHorsePanelsFromCoupon();saveAutomaticCouponSnapshot(lastRaceResults,activeCoupons,budgets,'YARISTAN_40_DK_ONCE'); if(typeof refreshRenderedSideBetPanel==='function') refreshRenderedSideBetPanel(); return true;
}
