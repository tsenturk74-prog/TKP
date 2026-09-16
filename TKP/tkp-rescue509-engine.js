/**
 * TKP V1.1.296 — REAL509 ROI-Gated Live Rescue
 * Trained chronologically on first 400 complete meetings; tested on the remaining 90.
 * Candidate features are pre-race only. winner/finish/result/payout are NEVER inputs.
 */
(function(global){
'use strict';
const VERSION='V1.1.298-REAL509-ALL-LIVE-RESCUE-V1';
const POLICY={
  hardMaxCostMultiplier:1.40,
  main:{enabled:true,threshold:.50,maxCostMultiplier:1.20,evidence:'224 official-payout meetings: ROI -18.31% -> -16.69%; full 40 -> 43 in fixed-pattern audit'},
  alt:{enabled:true,threshold:.50,maxCostMultiplier:1.20,evidence:'224 official-payout meetings: ROI +7.84% -> +68.90%; full 32 -> 35 in fixed-pattern audit; jackpot-sensitive, therefore cap kept at 1.20'},
  expert:{enabled:true,threshold:.65,maxCostMultiplier:1.20,evidence:'Kullanıcı kararıyla canlı öğrenme için açıldı; başlangıçta +%20 ile sınırlı, forward ROI/6-6/5-6 takibiyle adaptif daralacak.'}
};
const HISTORICAL_REFERENCE={
  dataset:{files:509,races:3054,completeMeetings:490,officialPayoutMeetings:224,trainMeetings:400,holdoutMeetings:90},
  main:{meetings:224,baseRoiPct:-18.31,rescuedRoiPct:-16.69,baseFull:40,rescuedFull:43},
  alt:{meetings:224,baseRoiPct:7.84,rescuedRoiPct:68.90,baseFull:32,rescuedFull:35},
  expert:{meetings:null,baseRoiPct:null,rescuedRoiPct:null,baseFull:null,rescuedFull:null,reason:'Eski arşivde Uzman+Kulis rescue için aynı kalite/provenance ile sabit tarihsel karar snapshotı yok; forward-only.'}
};
const n=(v,d=null)=>{if(v==null||v==='')return d;const x=Number(String(v).replace(',','.'));return Number.isFinite(x)?x:d;};
const s=v=>String(v??'').trim(); const arr=v=>Array.isArray(v)?v:[];
function nonRunner(h){try{return typeof global.isNonRunner==='function'&&global.isNonRunner(h);}catch(_){return false;}}
function horseNo(h){return s(h?.horse_no);}
function treeProb(tree,x){let node=0;while(tree.left[node]!==-1){const f=tree.feature[node],v=x[f],th=tree.threshold[node];node=(Number.isFinite(v)?v<th:true)?tree.left[node]:tree.right[node];}return Number(tree.value[node])||0;}
function forestProb(model,x){const ts=arr(model?.trees);if(!ts.length)return 0;let sum=0;for(const t of ts)sum+=treeProb(t,x);return sum/ts.length;}
function baseMode(mode){return mode==='main'?'main':mode==='alt'?'alt':'expert';}
function orderedFor(r,mode){const rows=arr(r?.horses).filter(h=>h&&!nonRunner(h));try{if(global.TKP_REAL509_PORTFOLIO?.rerank)return global.TKP_REAL509_PORTFOLIO.rerank(r,rows,mode==='alt'?'alt':mode==='main'?'main':'surprise');}catch(_){}return rows;}
function scoreFor(r,h,mode,ordered){try{return n(global.TKP_REAL509_PORTFOLIO?.score?.(r,h,mode,ordered,ordered),.5);}catch(_){return .5;}}
function rawFeature(r,ordered,c,off,mode){
 const idx=c+off-1,cand=ordered[idx]||null,nn=ordered.length,scores=ordered.map(h=>scoreFor(r,h,mode,ordered)),total=scores.reduce((a,b)=>a+Math.max(b,1e-6),0)||1;
 const coverage=scores.slice(0,Math.min(c,nn)).reduce((a,b)=>a+Math.max(b,1e-6),0)/total,sc=idx<nn?scores[idx]:0,margin=(idx<nn&&c>0)?scores[c-1]-sc:1;
 const nv=k=>n(cand?.[k],0),ar=nv('agf_rank'),hr=nv('hndkp_rank'),jr=nv('jbyg')||nv('jbyg_rank');
 const bmb=cand&&(nv('bmb')===1||nv('tr_bmb_candidate')===1||nv('tr_hidden_fav')===1)?1:0,odb=cand&&/ODB/i.test(s(cand?.labels||cand?.tag))?1:0;
 return [c,nn,c/Math.max(1,nn),coverage,margin,sc,off,c===1?1:0,bmb,odb,(ar>=6&&ar<=9)?1:0,(hr>0&&hr<=3)?1:0,(jr>0&&jr<=3)?1:0,nv('ypuan'),nv('value_score'),nv('pre_race_tkp_score'),nv('priorWins'),nv('condWinPct'),nv('priorAccurateAvgSpeed')];
}
function currentProduct(coupon){return arr(coupon?.legs).reduce((p,l)=>p*Math.max(1,arr(l?.picks).length),1);}
function applyCoupon(coupon,mode){
 const p=POLICY[mode]; if(!coupon||coupon.disabled||!p?.enabled||arr(coupon.legs).length!==6)return coupon;
 const model=global.TKP_REAL509_RESCUE_RF_MODEL?.models?.[mode]; if(!model)return coupon;
 const oldProd=currentProduct(coupon),candidates=[];
 arr(coupon.legs).forEach((leg,li)=>{if(leg?.sharedGoldTek===true||leg?.sharedTek===true||leg?.confidencePlan?.sharedPortfolioSingle===true)return;const r=leg?.r||leg?.x?.r;if(!r)return;const ordered=orderedFor(r,mode),selected=new Set(arr(leg.picks).map(horseNo)),remaining=ordered.filter(h=>!selected.has(horseNo(h))),c=Math.max(1,arr(leg.picks).length);if(!remaining.length)return;
   for(const off of [1,2]){if(off>remaining.length)continue;const newCount=c+off,fac=newCount/c;if(fac>p.maxCostMultiplier+1e-9||fac>POLICY.hardMaxCostMultiplier+1e-9)continue;const x=rawFeature(r,ordered,c,off,mode),prob=forestProb(model,x);if(prob<p.threshold)continue;candidates.push({prob,li,off,ordered,c,newCount,fac});}
 });
 if(!candidates.length)return coupon;candidates.sort((a,b)=>b.prob-a.prob||a.fac-b.fac);const best=candidates[0],leg=coupon.legs[best.li],selected=new Set(arr(leg.picks).map(horseNo)),toAdd=best.ordered.filter(h=>!selected.has(horseNo(h))).slice(0,best.off);if(!toAdd.length)return coupon;
 const newProd=oldProd*best.fac;if(newProd/oldProd>p.maxCostMultiplier+1e-9||newProd/oldProd>POLICY.hardMaxCostMultiplier+1e-9)return coupon;
 leg.picks=arr(leg.picks).concat(toAdd); if(Array.isArray(leg.ordered))leg.ordered=best.ordered.slice(); if(Array.isArray(leg.displayOrder))leg.displayOrder=best.ordered.slice();
 const oldCost=n(coupon.cost,0),newCost=oldCost*best.fac;coupon.cost=Math.round(newCost*100)/100;coupon.combos=Math.round(newProd);coupon.rescue509={active:true,mode,leg:best.li+1,added:toAdd.map(horseNo),risk:Math.round(best.prob*1000)/1000,costMultiplier:Math.round(best.fac*1000)/1000,roiGate:true,policyVersion:VERSION};coupon.note=(coupon.note?coupon.note+' · ':'')+`REAL509 ROI Rescue: ${best.li+1}. ayak +${best.off}, risk %${Math.round(best.prob*100)}, maliyet x${best.fac.toFixed(2)}.`;return coupon;
}
function applySet(set){if(!set)return set;applyCoupon(set.main,'main');applyCoupon(set.alt,'alt');applyCoupon(set.surprise,'expert');return set;}
const oldAdaptive=global.tkpBuildCouponSetAdaptive,oldAdaptiveAsync=global.tkpBuildCouponSetAdaptiveAsync,oldFast=global.buildCouponSetFast,oldFastAsync=global.buildCouponSetFastAsync;
if(typeof oldAdaptive==='function')global.tkpBuildCouponSetAdaptive=function(){return applySet(oldAdaptive.apply(this,arguments));};
if(typeof oldAdaptiveAsync==='function')global.tkpBuildCouponSetAdaptiveAsync=async function(){return applySet(await oldAdaptiveAsync.apply(this,arguments));};
if(typeof oldFast==='function')global.buildCouponSetFast=function(){return applySet(oldFast.apply(this,arguments));};
if(typeof oldFastAsync==='function')global.buildCouponSetFastAsync=async function(){return applySet(await oldFastAsync.apply(this,arguments));};
function policyHTML(){
 const dash=v=>Number.isFinite(Number(v))?String(v).replace('.',','):'—';
 const refs={main:HISTORICAL_REFERENCE.main,alt:HISTORICAL_REFERENCE.alt,expert:HISTORICAL_REFERENCE.expert};
 const rows=[['Normal','main',POLICY.main],['Sürpriz','alt',POLICY.alt],['Uzman + Kulis','expert',POLICY.expert]].map(([name,key,p])=>{const h=refs[key]||{};const hist=Number.isFinite(Number(h.meetings))?`${h.meetings} toplantı · ROI %${dash(h.baseRoiPct)} → %${dash(h.rescuedRoiPct)} · 6/6 ${dash(h.baseFull)} → ${dash(h.rescuedFull)}`:`— · ${h.reason||'tarihsel eşdeğer snapshot yok'}`;return `<tr><td><b>${name}</b></td><td>${p.enabled?'✅ CANLI':'⏸ KAPALI'}</td><td class="num">${p.enabled?'%'+Math.round((p.maxCostMultiplier-1)*100):'—'}</td><td>${hist}</td></tr>`;}).join('');
 return `<div class="card" style="border-left:5px solid #7c3aed"><h2 style="margin:0 0 5px">🛟 REAL509 Live Rescue · V1.1.298</h2><p class="muted" style="margin:0 0 7px">Rescue eğitim/veri katmanı ${HISTORICAL_REFERENCE.dataset.files} toplantı / ${HISTORICAL_REFERENCE.dataset.races} koşuyu kullanır. ROI karşılaştırması yalnız resmî payout kanıtı bulunan ${HISTORICAL_REFERENCE.dataset.officialPayoutMeetings} toplantıda yapılır. Bilinmeyen eski Uzman+Kulis alanı 0 yazılmaz.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Kupon</th><th>Canlı</th><th class="num">Maliyet açma</th><th>Eski arşiv değerlendirmesi</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
const oldArchive=global.couponArchiveBacktestHTML;if(typeof oldArchive==='function')global.couponArchiveBacktestHTML=function(){return oldArchive.apply(this,arguments)+policyHTML();};
global.TKP_RESCUE509={version:VERSION,policy:POLICY,applyCoupon,applySet,forestProb,policyHTML,training:HISTORICAL_REFERENCE.dataset,historicalReference:HISTORICAL_REFERENCE,leakageGuard:'winner/finish/result/payout excluded from candidate features'};
})(window);
