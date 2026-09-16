'use strict';
/* TKP R17.9 — Monte Carlo kart simülasyon motoru.
 *
 * Amaç: r17-ev-roi-portfolio-engine.js zaten TEK bir sabit havuz kombinasyonu
 * için TAM (analitik, Plackett-Luce tabanlı) isabet olasılığını hesaplıyor.
 * Bu dosya farklı bir soruya cevap verir: "Aday onlarca farklı havuz
 * varyasyonu arasında hangisi en İSTİKRARLI (simülasyon tekrarları arasında
 * en az dalgalanan) isabet oranına sahip?" — yani havuz ARAMA/robustluk
 * karşılaştırması. Aynı olasılık kaynağını (TKP_R17_EV_ROI_PORTFOLIO.modelWeights)
 * kullanır; skor/ağırlık hesaplama mantığını asla tekrar yazmaz veya değiştirmez.
 *
 * Bu dosya salt hesaplama katmanıdır: hiçbir global kupon/skor durumuna
 * otomatik yazmaz, hiçbir mevcut algoritmayı çağırmaz veya değiştirmez.
 * Yalnız açıkça çağrıldığında (tkp-smart-coupon-filter.js veya UI) çalışır.
 */
(function(global){
  const VERSION='R17.9-MONTECARLO-ALTILI-20260914';

  function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function horseNo(h){return String(h?.horse_no??h?.horseNo??'').trim();}
  function pickKey(x){return typeof x==='object'&&x!==null?horseNo(x):String(x).trim();}
  function activeHorses(race){return (race?.horses||[]).filter(h=>h&&horseNo(h)&&!h.non_runner);}

  // Deterministik PRNG (mulberry32). Aynı seed => aynı simülasyon sonucu;
  // TKP'nin geri kalanındaki "resetSeed" / tekrarlanabilir backtest
  // sözleşmesiyle tutarlı (bkz. app-controller resetSeed).
  function mulberry32(seed){
    let t=seed>>>0;
    return function(){
      t=(t+0x6D2B79F5)|0;
      let r=Math.imul(t^(t>>>15),1|t);
      r=(r+Math.imul(r^(r>>>7),61|r))^r;
      return ((r^(r>>>14))>>>0)/4294967296;
    };
  }

  function legWeights(race){
    const bundle=global.TKP_R17_EV_ROI_PORTFOLIO?.modelWeights?.(race);
    if(bundle&&Array.isArray(bundle.rows)&&bundle.rows.length){
      return {rows:bundle.rows,weights:bundle.weights,source:bundle.source};
    }
    // EV/ROI motoru yüklenmemişse (örn. izole test ortamı) AGF oranlı düşer;
    // canlı uygulamada script yükleme sırası bunu garanti eder, asla atmaz.
    const rows=activeHorses(race);
    const raw=rows.map(h=>Math.max(0,num(h?.agf)||0));
    const s=raw.reduce((a,b)=>a+b,0);
    const weights=s>0?raw.map(v=>v/s):rows.map(()=>rows.length?1/rows.length:0);
    return {rows,weights,source:'AGF_FALLBACK'};
  }

  function drawWinner(rows,weights,rnd){
    if(!rows.length) return null;
    const r=rnd();
    let acc=0;
    for(let i=0;i<rows.length;i++){
      acc+=weights[i]||0;
      if(r<=acc) return horseNo(rows[i]);
    }
    return horseNo(rows[rows.length-1]);
  }

  /* races: sıralı ayak listesi (leg 1..6). options.iterations varsayılan
   * 10.000 (talep edilen ayakta belirtilen sayı); options.seed reproducibility
   * için. Bağımsızlık varsayımı: ayaklar arasında korelasyon modellenmez —
   * TJK altılısında ayaklar farklı koşulardır, bu standart ve dokümante bir
   * basitleştirmedir. */
  function simulateCard(races,options={}){
    const iterations=Math.round(clamp(Number(options.iterations)||10000,100,200000));
    const seed=Number.isFinite(options.seed)?(options.seed>>>0):0xC0FFEE;
    const rnd=mulberry32(seed);
    const legs=(Array.isArray(races)?races:[]).map(r=>legWeights(r));
    const perLegWinCount=legs.map(()=>new Map());
    const draws=new Array(iterations);
    for(let it=0;it<iterations;it++){
      const draw=new Array(legs.length);
      for(let li=0;li<legs.length;li++){
        const no=drawWinner(legs[li].rows,legs[li].weights,rnd);
        draw[li]=no;
        if(no){const m=perLegWinCount[li];m.set(no,(m.get(no)||0)+1);}
      }
      draws[it]=draw;
    }
    const perLegWinFrequency=perLegWinCount.map(m=>{
      const out={};
      for(const [no,count] of m) out[no]=count/iterations;
      return out;
    });
    return {version:VERSION,iterations,seed,legCount:legs.length,perLegWinFrequency,legSources:legs.map(l=>l.source),_draws:draws};
  }

  function normalizePools(pools){
    return (pools||[]).map(p=>new Set((Array.isArray(p)?p:[p]).map(pickKey).filter(Boolean)));
  }

  /* Bir simülasyon çıktısını yeniden kullanarak (tekrar simüle etmeden) sabit
   * bir havuz setinin (pools: her ayak için izinli at listesi) ampirik ortak
   * isabet oranını verir. r17-ev-roi-portfolio-engine.js'deki analitik
   * orderedProbability ile karşılaştırılabilir (bkz. testler) — bu ampirik
   * sayı, analitik sayının sağlaması olarak da kullanılabilir. */
  function jointHitRate(simulation,pools){
    const draws=simulation?._draws||[];
    if(!draws.length) return {hitRate:0,ci95:0,hits:0,iterations:0};
    const sets=normalizePools(pools);
    let hits=0;
    for(const draw of draws){
      let ok=true;
      for(let i=0;i<sets.length;i++){
        const no=draw[i];
        if(!no||!sets[i].has(no)){ok=false;break;}
      }
      if(ok) hits++;
    }
    const n=draws.length;
    const p=hits/n;
    const se=Math.sqrt(Math.max(0,p*(1-p))/n);
    return {hitRate:p,ci95:1.96*se,hits,iterations:n};
  }

  /* İstikrar ölçümü: simülasyonu ardışık "batches" parçaya bölüp her
   * parçada ayrı isabet oranı hesaplar. Düşük std = kombinasyonun
   * simülasyon gürültüsüne karşı istikrarlı olduğu anlamına gelir — "en
   * istikrarlı altılı kombinasyonu" talebinin doğrudan karşılığı budur. */
  function stabilityScore(simulation,pools,batches=10){
    const draws=simulation?._draws||[];
    const nBatches=Math.max(1,Math.round(batches)||10);
    if(!draws.length) return {mean:0,std:0,batches:0};
    const sets=normalizePools(pools);
    const batchSize=Math.max(1,Math.floor(draws.length/nBatches));
    const rates=[];
    for(let b=0;b<nBatches;b++){
      const slice=draws.slice(b*batchSize,b===nBatches-1?draws.length:(b+1)*batchSize);
      if(!slice.length) continue;
      let hits=0;
      for(const draw of slice){
        let ok=true;
        for(let i=0;i<sets.length;i++){ if(!draw[i]||!sets[i].has(draw[i])){ok=false;break;} }
        if(ok) hits++;
      }
      rates.push(hits/slice.length);
    }
    const mean=rates.reduce((a,b)=>a+b,0)/(rates.length||1);
    const variance=rates.reduce((a,b)=>a+(b-mean)*(b-mean),0)/(rates.length||1);
    return {mean,std:Math.sqrt(variance),batches:rates.length};
  }

  /* Aday havuz listesini TEK simülasyon geçişiyle (resimüle etmeden) sıralar.
   * candidates: [[pool_leg1,pool_leg2,...], ...] dizisi.
   * minProbability altındaki adaylar "ELENDİ" etiketiyle işaretlenir (kupon
   * daraltma talebinin Monte Carlo tarafındaki karşılığı); asıl eleme kararı
   * tkp-smart-coupon-filter.js'de bütçe/minimum-at-sayısı kurallarıyla
   * birlikte nihai olarak verilir. */
  function rankCandidates(races,candidates,options={}){
    const simulation=simulateCard(races,options);
    const minProbability=Number.isFinite(options.minProbability)?options.minProbability:0.01;
    const rows=(candidates||[]).map((pools,index)=>{
      const jh=jointHitRate(simulation,pools);
      const st=stabilityScore(simulation,pools,options.stabilityBatches);
      const eliminated=jh.hitRate<minProbability;
      return {
        index,pools,hitRate:jh.hitRate,ci95:jh.ci95,hits:jh.hits,
        stabilityMean:st.mean,stabilityStd:st.std,eliminated,
        label:eliminated?`ELENDİ (< %${(minProbability*100).toFixed(1)})`:'AKTİF'
      };
    });
    const ranked=rows.filter(r=>!r.eliminated)
      .sort((a,b)=>(b.hitRate-a.hitRate)||(a.stabilityStd-b.stabilityStd));
    return {
      version:VERSION,iterations:simulation.iterations,seed:simulation.seed,minProbability,
      candidates:rows,ranked,eliminatedCount:rows.length-ranked.length,
      mostStable:ranked[0]||null
    };
  }

  // r17_p_win/tkp attach deseniyle tutarlı: her atın simüle edilmiş kazanma
  // sıklığını h.mc_win_freq olarak iliştirir (shadow-only, skor/sıralamayı
  // değiştirmez — Dashboard okuması içindir).
  function attachToCard(races,simulation){
    (Array.isArray(races)?races:[]).forEach((race,i)=>{
      const freq=simulation?.perLegWinFrequency?.[i]||{};
      for(const h of activeHorses(race)){
        const p=freq[horseNo(h)];
        if(Number.isFinite(p)) h.mc_win_freq=p;
      }
    });
    return races;
  }

  global.TKP_MONTE_CARLO=Object.freeze({
    VERSION,simulateCard,jointHitRate,stabilityScore,rankCandidates,attachToCard,mulberry32
  });
})(globalThis);
