'use strict';
/* TKP R17.9 — Akıllı kupon filtreleme & bütçe yönetimi.
 *
 * Bu dosya coupon-builder'ın kupon ÜRETİM mantığına dokunmaz: yalnız zaten
 * üretilmiş bir kuponun (built.main/alt/surprise) üstünde, kullanıcının
 * verdiği bütçe (TL) ve favori/sürpriz dengesine göre SALT-OKUNUR bir
 * daraltılmış kopya üretir. Orijinal kupon nesnesi asla mutasyona uğramaz.
 *
 * Maliyet formülü coupon-builder-r1681-baseline-v2.js:recalcCouponCost ile
 * BİREBİR aynıdır (combos = Π leg.picks.length; cost = unit*combos) — kendi
 * fiyatlama mantığını icat etmez, mevcut sözleşmeyi tekrar kullanır.
 */
(function(global){
  const VERSION='R17.9-SMART-COUPON-FILTER-20260914';

  function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function horseNo(h){return String(h?.horse_no??h?.horseNo??'').trim();}
  function legRace(leg){return leg?.r||leg?.race||leg?.x?.r||null;}

  function weightMapFor(race){
    const bundle=global.TKP_R17_EV_ROI_PORTFOLIO?.modelWeights?.(race);
    const map=new Map();
    if(bundle&&Array.isArray(bundle.rows)){
      bundle.rows.forEach((h,i)=>map.set(horseNo(h),Number(bundle.weights[i])||0));
    }
    return map;
  }

  /* balance ∈ [-1,1]. 0 = nötr (saf model olasılığına göre daralt).
   * +1 = "favori" ucu: düşük olasılıklı atlar agresif biçimde önce elenir
   *      (biasedScore = 2p-0.5 → favoriler öne fırlar, sürpriz adaylar dibe çöker).
   * -1 = "sürpriz" ucu: ham olasılık farkı retain-skorunu domine etmez
   *      (biasedScore sabit 0.5 → sürpriz atlar sadece düşük ihtimalli
   *      oldukları için budget daraltmasında haksız yere ilk sırada elenmez;
   *      onun yerine kupon-builder'ın kendi sırası/diğer sinyaller belirler).
   * Ara değerler bu iki uç arasında doğrusal geçiş yapar.
   */
  function biasedRetainScore(p,balance){
    const b=clamp(Number(balance)||0,-1,1);
    return clamp(p+b*(p-0.5),0,1);
  }

  function recomputeCost(legs,unit){
    const combos=legs.length?legs.reduce((m,l)=>m*(l.picks?.length||0),1):0;
    const cost=unit>0?unit*combos:0;
    return {combos,cost};
  }

  /* coupon: {legs:[{r,picks:[...]}], unit, cost, budgetTL, ...}
   * options: {budgetTL, balance=0, minProbability=0.01, minHorsesPerLeg=4} */
  function tkpSmartCouponFilter(coupon,options={}){
    if(!coupon||!Array.isArray(coupon.legs)||!coupon.legs.length||coupon.error){
      return {...coupon,smartFilter:{applied:false,reason:'Geçersiz veya boş kupon'}};
    }
    const autoBalance=(()=>{try{const v=Number(global.localStorage?.getItem?.('tkp_smart_balance_champion'));return Number.isFinite(v)?v:0;}catch(_){return 0;}})();
    const balance=clamp(options.balance==null?autoBalance:Number(options.balance)||0,-1,1);
    const minProbability=Number.isFinite(options.minProbability)?options.minProbability:0.01;
    // Algoritma sözleşmesi: leg başına minimum 4 at (bkz. algorithm-principles —
    // "Minimum coverage is 4 horses per leg"). Bu taban hiçbir koşulda delinmez.
    const minHorsesPerLeg=Math.max(4,Math.round(options.minHorsesPerLeg)||4);
    const budgetTL=Number.isFinite(options.budgetTL)?Number(options.budgetTL):null;
    const unit=Number(coupon.unit)||0;

    const removed=[];
    const legs=coupon.legs.map((leg,legIdx)=>{
      const race=legRace(leg);
      const wmap=weightMapFor(race);
      const scored=(leg.picks||[]).map(pick=>({
        pick,no:horseNo(pick),p:wmap.get(horseNo(pick))??0
      }));
      scored.sort((a,b)=>biasedRetainScore(b.p,balance)-biasedRetainScore(a.p,balance));
      const kept=[];
      scored.forEach((row,rank)=>{
        const mustKeepForFloor=rank<minHorsesPerLeg;
        if(mustKeepForFloor||row.p>=minProbability){
          kept.push(row);
        }else{
          removed.push({leg:legIdx+1,horseNo:row.no,probability:row.p,reason:'below_min_probability'});
        }
      });
      // Sıra korunsun: orijinal picks dizisindeki göreli sırayı koru (skor
      // sırasına göre değil) — kuponun görsel/lider sırasını bozmamak için.
      const keptSet=new Set(kept.map(r=>r.no));
      const finalPicks=(leg.picks||[]).filter(p=>keptSet.has(horseNo(p)));
      return {...leg,picks:finalPicks,_smartScoreByHorse:Object.fromEntries(scored.map(r=>[r.no,r.p]))};
    });

    let {combos,cost}=recomputeCost(legs,unit);
    let budgetSatisfied=true;
    if(budgetTL!=null&&unit>0){
      // Cost control trims from the LAST position first (mevcut
      // enforceCouponCostCap kuralı ile aynı yön) — ortak erken ayaklar korunur.
      let guard=0;
      while(cost>budgetTL&&guard<500){
        guard++;
        let trimmed=false;
        for(let li=legs.length-1;li>=0;li--){
          const leg=legs[li];
          if((leg.picks?.length||0)<=minHorsesPerLeg) continue;
          const scores=leg.picks.map(p=>({pick:p,no:horseNo(p),score:biasedRetainScore(leg._smartScoreByHorse?.[horseNo(p)]??0,balance)}));
          scores.sort((a,b)=>a.score-b.score);
          const drop=scores[0];
          leg.picks=leg.picks.filter(p=>horseNo(p)!==drop.no);
          removed.push({leg:li+1,horseNo:drop.no,probability:leg._smartScoreByHorse?.[drop.no]??0,reason:'budget_trim'});
          trimmed=true;
          break;
        }
        if(!trimmed){budgetSatisfied=false;break;}
        ({combos,cost}=recomputeCost(legs,unit));
      }
      if(cost>budgetTL) budgetSatisfied=false;
    }

    const cleanLegs=legs.map(l=>{const {_smartScoreByHorse,...rest}=l;return rest;});
    return {
      ...coupon,legs:cleanLegs,unit,combos,cost,
      leftover:budgetTL!=null?Math.round((budgetTL-cost)*100)/100:coupon.leftover,
      smartFilter:{
        version:VERSION,applied:true,balance,minProbability,minHorsesPerLeg,
        budgetTL,budgetSatisfied,originalCost:Number(coupon.cost)||0,finalCost:cost,
        removedCount:removed.length,removed
      }
    };
  }

  // ---- Minimal, non-invasive UI paneli (yalnız tarayıcıda; DOM'a hiçbir
  // mevcut TKP bileşenini değiştirmeden ekler; herhangi bir renderAll()
  // tetiklemez — mevcut, ağır test edilmiş render zincirine dokunmaz). ----
  function currentCoupon(){
    try{return global.activeCoupons?.main||null;}catch(_e){return null;}
  }

  function mountPanel(){
    if(typeof document==='undefined') return;
    if(document.getElementById('tkpSmartFilterPanel')) return;
    const root=document.getElementById('tkpRoot')||document.body;
    if(!root) return;
    const panel=document.createElement('div');
    panel.id='tkpSmartFilterPanel';
    panel.style.cssText='margin:10px 0;padding:10px;border:1px solid #444;border-radius:6px;font-size:12.5px;';
    panel.innerHTML=`
      <div style="font-weight:800;margin-bottom:6px;">🎯 Akıllı Kupon Daraltma (R17.9)</div>
      <label>Bütçe (TL): <input id="tkpSmartBudget" type="number" min="0" step="50" value="1350" style="width:90px;"></label>
      &nbsp;<label>Sürpriz ⟷ Favori: <input id="tkpSmartBalance" type="range" min="-1" max="1" step="0.1" value="0"></label>
      &nbsp;<button id="tkpSmartApply" type="button">Uygula</button>
      <div id="tkpSmartResult" style="margin-top:8px;white-space:pre-wrap;"></div>
    `;
    root.insertBefore(panel,root.firstChild?.nextSibling||null);
    panel.querySelector('#tkpSmartApply').addEventListener('click',()=>{
      const coupon=currentCoupon();
      const out=panel.querySelector('#tkpSmartResult');
      if(!coupon){out.textContent='Önce bir kupon üretilmeli (activeCoupons.main boş).';return;}
      const budgetTL=Number(panel.querySelector('#tkpSmartBudget').value)||0;
      const balance=Number(panel.querySelector('#tkpSmartBalance').value)||0;
      const filtered=tkpSmartCouponFilter(coupon,{budgetTL,balance});
      const sf=filtered.smartFilter;
      const lines=[
        `Maliyet: ${sf.originalCost} TL → ${sf.finalCost} TL (bütçe ${sf.budgetSatisfied?'sağlandı':'sağlanamadı, taban 4 at/ayak korunuyor'})`,
        `Elenen at sayısı: ${sf.removedCount}`,
        ...sf.removed.slice(0,20).map(r=>`  Ayak ${r.leg} · At ${r.horseNo} · P=${(r.probability*100).toFixed(2)}% · ${r.reason==='below_min_probability'?'%1 altı':'bütçe daraltma'}`)
      ];
      out.textContent=lines.join('\n');
    });
  }

  // R18.6: Kullanıcı kararı — manuel Akıllı Kupon Daraltma paneli ana ekrandan kaldırıldı.
  // Motor/API korunur; balance ancak doğrulanmış challenger terfi mekanizması champion değerini
  // localStorage'a yazarsa değişir. Kullanıcı sürgüsü artık üretim sonucunu oynatamaz.
  function promoteVerifiedBalance(candidate, evidence={}){
    const c=clamp(Number(candidate)||0,-1,1);
    const sample=Number(evidence.sample)||0, roi=Number(evidence.roi), baseRoi=Number(evidence.baseRoi);
    const hit=Number(evidence.hitRate), baseHit=Number(evidence.baseHitRate);
    if(sample<30 || !Number.isFinite(roi) || !Number.isFinite(baseRoi) || !Number.isFinite(hit) || !Number.isFinite(baseHit)) return false;
    if(roi<=baseRoi || hit<baseHit) return false;
    try{global.localStorage?.setItem?.('tkp_smart_balance_champion',String(c));global.localStorage?.setItem?.('tkp_smart_balance_evidence',JSON.stringify({...evidence,candidate:c,at:new Date().toISOString()}));return true;}catch(_){return false;}
  }

  global.tkpSmartCouponFilter=tkpSmartCouponFilter;
  global.TKP_SMART_COUPON_FILTER=Object.freeze({VERSION,tkpSmartCouponFilter,biasedRetainScore,promoteVerifiedBalance});
})(globalThis);
