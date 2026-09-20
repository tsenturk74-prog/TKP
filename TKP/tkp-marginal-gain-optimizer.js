// TKP marjinal-kazanç genişlik optimizörü + olasılık kalibrasyon katmanı.
//
// Amaç: kupon maliyetini (kolon çarpımı bütçesi) artırmadan 6/6 oranını yükseltmek.
// 2026-09-17 arşiv analizi (480 toplantı / 1440 kupon) genişlik 8+ ayaklardaki son
// atların neredeyse değersiz (%1,9) olduğunu, 5/6 kaçışlarının ise model sırası
// 4-10 arasındaki gerçek sürprizlerden kaynaklandığını gösterdi. Sorun kupon
// geometrisi değil olasılık kalibrasyonu: ham skor kuyruğu gerçek kazanma
// oranlarını yansıtmıyor. Bu modül:
//
//   1) ISOTONİK (PAVA) KALİBRASYON: prediction_score_snapshot / pre_result_score
//      ve AGF yüzdesini, yalnızca hedef yarıştan ÖNCE sonuçlanmış yarışların
//      ampirik kazanma oranlarına eşler (walk-forward; sonuç sızıntısı yok —
//      strict_no_result_leakage_from kuralına uygun olarak kalibrasyon fitinde
//      yalnız geçmiş tarihli, sonucu çözülmüş yarışlar kullanılır).
//      tkp-score-calibration.js'deki kronoloji kapısı (tkpRowIsBeforeTarget /
//      tarih-fail-closed) ile aynı güvence burada da uygulanır.
//   2) MARJİNAL-KAZANÇ GENİŞLİK DAĞITIMI: ayak başına kapsama olasılığı
//      P_i(w) = ilk w atın kalibre olasılık toplamı (yarış içi normalize).
//      Amaç max Π P_i(w_i), kısıt Π w_i ≤ bütçe kolonu. Greedy fractional
//      knapsack: her adımda Δlog P / Δlog maliyet oranı en yüksek '+1 at' eklenir.
//      coupon-builder-r1681-baseline-v2.js içindeki JOINT_LOG_COVERAGE_DP'nin
//      utility girdisi olarak da kullanılabilir (bkz. utilityCoverage).
//
// Doğrulama (tools/tkp_marginal_gain_backtest.py, zaman-sıralı walk-forward,
// 1440 kupon): 6/6 %8,6 -> %10,1-11,0 (Wilson alt sınır %7,3 -> %8,0-9,5),
// ortalama maliyet sabitin altında. KÖTÜLEŞME görülmediği için kullanıcı kararıyla
// VARSAYILAN davranış olarak etkindir (2026-09-20). Geriye dönük uyumluluk:
//
//   globalThis.__tkpUseMarginalGainOptimizer === false  -> opt-out; DP eski ham
//     skor-kütlesi utility'sine döner (eski davranış birebir korunur)
//   globalThis.__tkpMarginalGainShadow   === true       -> karar değişmez, gölge log
//     (globalThis.__tkpMarginalGainShadowLog içine {kind:'leg-coverage', ...})
// Kalibrasyon verisi yetersizse (ör. <200 geçmiş gözlem) ya da yarış tarihi
// okunamazsa fail-closed: kalibre olasılık üretilmez ve DP otomatik olarak
// eski utility ile devam eder. Maliyet tavanı (kolon çarpımı cap) aynen korunur.
//
(function(global){
  'use strict';

  const VERSION='V1.0-MARGINAL-GAIN-20260920';
  const MAX_WIDTH=10;
  const EPS=1e-6;

  function num(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
  function text(v){ return String(v??'').trim(); }

  // ---------- isotonic kalibrasyon (PAVA) ----------

  // pairs: [[x, y], ...] -> blok listesi [{x0,x1,v}] monoton non-decreasing.
  function fitIsotonic(pairs){
    const pts=(pairs||[]).filter(p=>p&&Number.isFinite(p[0])&&Number.isFinite(p[1]))
      .sort((a,b)=>a[0]-b[0]);
    if(!pts.length) return [];
    const agg=new Map();
    for(const [x,y] of pts){
      const e=agg.get(x)||{s:0,c:0};
      e.s+=y; e.c++; agg.set(x,e);
    }
    const xs=[...agg.keys()].sort((a,b)=>a-b);
    const sv=[],sw=[],sc=[];
    for(const x of xs){
      const e=agg.get(x);
      sv.push(e.s/e.c); sw.push(e.c); sc.push(1);
      while(sv.length>=2&&sv[sv.length-2]>sv[sv.length-1]){
        const wLast=sw.pop(),wPrev=sw[sw.length-1],w2=wLast+wPrev;
        const vLast=sv.pop(),vPrev=sv[sv.length-1];
        sv[sv.length-1]=(vLast*wLast+vPrev*wPrev)/w2;
        sw[sw.length-1]=w2;
        const cLast=sc.pop(); sc[sc.length-1]+=cLast;
      }
    }
    const blocks=[];let xi=0;
    for(let i=0;i<sv.length;i++){
      const seg=xs.slice(xi,xi+sc[i]);
      blocks.push({x0:seg[0],x1:seg[seg.length-1],v:sv[i]});
      xi+=sc[i];
    }
    return blocks;
  }

  function isotonicPredict(blocks,x){
    if(!blocks||!blocks.length||!Number.isFinite(x)) return null;
    if(x<=blocks[0].x0) return blocks[0].v;
    if(x>=blocks[blocks.length-1].x1) return blocks[blocks.length-1].v;
    for(const b of blocks){ if(x>=b.x0&&x<=b.x1) return b.v; }
    for(let i=0;i<blocks.length-1;i++){
      const a=blocks[i],b=blocks[i+1];
      if(x>a.x1&&x<b.x0){ const t=(x-a.x1)/(b.x0-a.x1); return a.v+t*(b.v-a.v); }
    }
    return blocks[blocks.length-1].v;
  }

  // ---------- walk-forward kalibrasyon durumu ----------

  let calibCache={signature:'',cutoff:'',scoreBlocks:null,agfBlocks:null,sample:0};

  function rawScoreOf(h){
    const snap=num(h?.prediction_score_snapshot,NaN);
    if(Number.isFinite(snap)) return snap;
    const pre=num(h?.pre_result_score,NaN);
    return Number.isFinite(pre)?pre:NaN;
  }

  function raceDateOf(r){ return text(r?.race_date||r?.date).slice(0,10); }

  // Yalnız cutoff öncesi (kesin küçük tarih) sonuçlanmış yarışlar fit edilir.
  // cutoff boş/okunamazsa fail-closed: kalibrasyon yok sayılır (null döner).
  function buildCalibrators(cutoffDate,opts={}){
    const cutoff=text(cutoffDate).slice(0,10);
    if(!cutoff) return null;
    const races=Array.isArray(global.db?.races)?global.db.races:[];
    const maxSample=Math.max(1000,num(opts.maxSample,40000));
    const signature=`${races.length}|${cutoff}`;
    if(calibCache.signature===signature&&calibCache.scoreBlocks) return calibCache;
    const rows=[];
    for(const r of races){
      const d=raceDateOf(r);
      if(!d||d>=cutoff) continue; // aynı gün ve gelecek fail-closed dışarıda
      for(const h of (r?.horses||[])){
        const win=(Number(h?.winner)===1||num(h?.finish_position)===1)?1:0;
        rows.push([d,rawScoreOf(h),num(h?.agf,NaN),win]);
      }
    }
    // En güncel gözlemler öncelikli: üst sınır aşılırsa en eskiler atılır.
    rows.sort((a,b)=>b[0].localeCompare(a[0]));
    if(rows.length>maxSample) rows.length=maxSample;
    const scorePairs=[],agfPairs=[];
    for(const [,s,a,w] of rows){
      if(Number.isFinite(s)) scorePairs.push([s,w]);
      if(Number.isFinite(a)) agfPairs.push([a,w]);
    }
    if(scorePairs.length<200) return null;
    calibCache={signature,cutoff,
      scoreBlocks:fitIsotonic(scorePairs),
      agfBlocks:fitIsotonic(agfPairs),
      sample:scorePairs.length};
    return calibCache;
  }

  // At başına kazanma olasılığı: R18 win_probability varsa 0.6 ağırlıkla,
  // yoksa yalnız isotonic harman (0.5 skor + 0.5 AGF). Yarış içi normalize.
  function horseWinProbabilities(race,horses,opts={}){
    const list=(horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
    if(!list.length) return new Map();
    const calib=opts.calibrators||buildCalibrators(raceDateOf(race),opts);
    const raw=list.map(h=>{
      const r18=num(h?.r18_win_probability,NaN);
      let pIso=null;
      if(calib&&calib.scoreBlocks){
        const ps=isotonicPredict(calib.scoreBlocks,rawScoreOf(h));
        const pa=isotonicPredict(calib.agfBlocks,num(h?.agf,NaN));
        pIso=(ps!=null&&pa!=null)?0.5*ps+0.5*pa:(ps!=null?ps:pa);
      }
      let p;
      if(Number.isFinite(r18)&&r18>0&&pIso!=null) p=0.6*r18+0.4*pIso;
      else if(Number.isFinite(r18)&&r18>0) p=r18;
      else if(pIso!=null) p=pIso;
      else p=1/list.length;
      return [h,Math.max(EPS,p)];
    });
    const total=raw.reduce((s,[,p])=>s+p,0)||1;
    return new Map(raw.map(([h,p])=>[h,p/total]));
  }

  // ---------- marjinal-kazanç genişlik dağıtımı ----------

  // legSpecs: [{ranked:[at...], min, max, keepOrder}] — ranked: ayak aday sırası.
  // budgetCombos: Π w_i üst sınırı. probs: Map(at->p) veya null.
  // Döner: {widths:[...], logProb, applied}
  function optimizeWidths(legSpecs,budgetCombos,probs,opts={}){
    const n=legSpecs.length;
    if(!n) return {widths:[],logProb:0,applied:false};
    const budget=Math.max(1,Math.floor(num(budgetCombos,1)));
    const floors=legSpecs.map(s=>Math.max(1,Math.min(num(s.min,1),(s.ranked||[]).length||1)));
    const caps=legSpecs.map((s,i)=>Math.max(floors[i],Math.min(num(s.max,MAX_WIDTH),MAX_WIDTH,(s.ranked||[]).length||1)));
    if(floors.reduce((a,b)=>a*b,1)>budget) return {widths:floors,logProb:NaN,applied:false};

    // ayak içi kapsama prefix toplamları (kalibre olasılık varsa ona göre yeniden sırala;
    // keepOrder=true ise uygulamanın sırası korunur, yalnız genişlik optimize edilir)
    const orders=legSpecs.map((s,i)=>{
      const ranked=(s.ranked||[]).slice(0,caps[i]);
      if(!probs||s.keepOrder===true) return ranked;
      return ranked.slice().sort((a,b)=>num(probs.get(b))-num(probs.get(a)));
    });
    const prefix=orders.map(list=>{
      const acc=[0];
      for(const h of list){ acc.push(acc[acc.length-1]+(probs?num(probs.get(h),EPS):EPS)); }
      return acc;
    });
    const cov=(i,w)=>Math.max(EPS,prefix[i][Math.min(w,prefix[i].length-1)]);

    const widths=floors.slice();
    let applied=false;
    for(;;){
      const cur=widths.reduce((a,b)=>a*b,1);
      let bestI=-1,bestRatio=-Infinity;
      for(let i=0;i<n;i++){
        const w=widths[i];
        if(w>=caps[i]||w>=orders[i].length) continue;
        if((cur/w)*(w+1)>budget+1e-9) continue;
        const gain=Math.log(cov(i,w+1))-Math.log(cov(i,w));
        const cost=Math.log((w+1)/w);
        const ratio=gain/cost;
        if(ratio>bestRatio+1e-12){ bestRatio=ratio; bestI=i; }
      }
      if(bestI<0) break;
      widths[bestI]++; applied=true;
    }
    const logProb=widths.reduce((s,w,i)=>s+Math.log(cov(i,w)),0);
    return {widths,logProb,applied};
  }

  // ---------- JOINT_LOG_COVERAGE_DP utility köprüsü ----------

  // coupon-builder-r1681-baseline-v2.js enforceCouponCostCap içindeki options
  // üretimine giren kalibre olasılık kapsama serisi. ranked (uygulama sırası)
  // korunur; döndürülen dizinin k-1. elemanı ilk k atın kalibre kapsama
  // olasılığıdır. riskWeight/floorPenalty çağıran tarafta aynen uygulanır.
  function utilityCoverage(race,ranked,maxCount,probs){
    const list=(ranked||[]).slice(0,maxCount);
    const out=[];let covered=0;
    for(let i=0;i<list.length;i++){
      covered+=Math.max(EPS,num(probs?.get(list[i]),EPS));
      out.push(Math.max(EPS,Math.min(1-EPS,covered)));
    }
    return out;
  }

  function legProbabilitiesForDp(leg,opts={}){
    const race=leg?.r||leg;
    const horses=leg?.ranked||leg?.ordered||leg?.displayOrder||race?.horses||[];
    return horseWinProbabilities(race,horses,opts);
  }

  // ---------- gölge tanı ----------

  function shadowLog(entry){
    try{
      const log=global.__tkpMarginalGainShadowLog||(global.__tkpMarginalGainShadowLog=[]);
      log.push({ts:new Date().toISOString(),version:VERSION,...entry});
      if(log.length>500) log.splice(0,log.length-500);
    }catch(_){ }
  }

  function wilsonLower(hits,total,z=1.96){
    const n=num(total);if(n<=0)return 0;
    const p=Math.max(0,Math.min(1,num(hits)/n)),z2=z*z;
    return Math.max(0,(p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/(1+z2/n));
  }

  global.TKP_MARGINAL_GAIN_OPTIMIZER={
    version:VERSION,fitIsotonic,isotonicPredict,buildCalibrators,
    horseWinProbabilities,optimizeWidths,utilityCoverage,legProbabilitiesForDp,
    wilsonLower,shadowLog,
    // Varsayılan AÇIK (2026-09-20 kullanıcı kararı): yalnız açık false opt-out ile kapanır.
    isEnabled(){ return global.__tkpUseMarginalGainOptimizer!==false; },
    isShadow(){ return global.__tkpMarginalGainShadow===true; }
  };
  global.TKP_MARGINAL_GAIN_OPTIMIZER_VERSION=VERSION;
})(typeof globalThis!=='undefined'?globalThis:window);
