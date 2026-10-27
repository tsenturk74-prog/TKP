(function(global){'use strict';
/**
 * TKP R15.6 — REAL509 joint calibration evidence.
 *
 * Two evidence lanes are deliberately kept separate:
 *  1) V46 product-specific side-bet formulas/widths. These remain production
 *     authority because their chronological holdout is stronger than a generic
 *     refit on the repaired archive.
 *  2) CLEAN509 result calibration. 2,886 officially verified races are split
 *     chronologically into 2,287 fit + 599 untouched holdout races. This lane
 *     is used only as a conservative rank regularizer/fallback; it never
 *     overrides Champion P1 and never auto-enables a side bet.
 *
 * This prevents two common forms of leakage/overfit: fitting a race with its
 * own result and promoting a historically profitable ticket without live,
 * pre-race exact-ticket evidence.
 */
const VERSION='R15.6-REAL509-JOINT-SIDEBET-CALIBRATION-20260901';
const DATASET=Object.freeze({archiveMeetings:509,archiveRaces:3054,v46PredictionRows:25319,usableV46Races:2555,completeSixLegMeetings:387});
const PRODUCTS=Object.freeze({
  sirali:Object.freeze({label:'Sıralı İkili',widths:[5,5],mode:'PAS',holdout:{tests:503,hits:314,hitPct:62.43,roiPct:-24.31},all:{tests:2512,hits:1565,hitPct:62.30,roiPct:-19.36},returnConcentrationTop1Pct:1.2}),
  triple:Object.freeze({label:'Üçlü Bahis',widths:[5,6,7],mode:'PAS',holdout:{tests:282,hits:176,hitPct:62.41,roiPct:-45.52},all:{tests:1406,hits:895,hitPct:63.66,roiPct:-46.94},returnConcentrationTop1Pct:6.4}),
  quartet:Object.freeze({label:'Tabela / Dörtlü',widths:[3,5,6,9],mode:'PAS',holdout:{tests:81,hits:16,hitPct:19.75,roiPct:-30.18},all:{tests:401,hits:67,hitPct:16.71,roiPct:-63.95},returnConcentrationTop1Pct:13.5}),
  quintet:Object.freeze({label:"Sıralı 5'li",widths:[2,5,5,6,8],mode:'SHADOW_CANDIDATE',holdout:{tests:110,hits:9,hitPct:8.18,roiPct:271.63},all:{tests:550,hits:35,hitPct:6.36,roiPct:17.90},returnConcentrationTop1Pct:46.0,holdoutReturnConcentrationTop1Pct:73.0}),
  cifte:Object.freeze({label:'Çifte',widths:[5,5],mode:'PAS',holdout:{tests:417,hits:278,hitPct:66.67,roiPct:-29.97},all:{tests:2081,hits:1346,hitPct:64.68,roiPct:-18.71},returnConcentrationTop1Pct:1.7})
});
function get(product){return PRODUCTS[String(product||'')]||null;}
function widths(product){const row=get(product);return row?row.widths.slice():null;}
function recommendation(product){
  const row=get(product);if(!row)return null;
  const shadow=row.mode==='SHADOW_CANDIDATE';
  const reason=shadow
    ? `REAL509/V46 holdout ${row.holdout.hits}/${row.holdout.tests} · ROI %${row.holdout.roiPct.toFixed(2)}; tek büyük payout holdout getirinin %${Number(row.holdoutReturnConcentrationTop1Pct||0).toFixed(1)}'ini taşıdığı için otomatik OYNA yok.`
    : `REAL509/V46 holdout ${row.holdout.hits}/${row.holdout.tests} · ROI %${row.holdout.roiPct.toFixed(2)}; negatif ROI nedeniyle PAS.`;
  return {version:VERSION,product,label:shadow?'SHADOW ADAY':'PAS',mode:row.mode,play:false,strong:false,verified:true,preRaceOnly:true,widths:row.widths.slice(),reason,evidence:row};
}
global.TKP_V321_SIDEBET_CALIBRATION=Object.freeze({VERSION,DATASET,PRODUCTS,get,widths,recommendation});

const CLEAN509_DATASET=Object.freeze({
  archiveMeetings:509,archiveRaces:3054,verifiedRaces:2886,quarantinedRaces:168,
  fitRaces:2287,holdoutRaces:599,splitRule:'sequence_no <= 407 fit; > 407 untouched holdout',
  resultPolicy:'Only archive-integrity VERIFIED official-result races; same/future race result excluded from fit.'
});
const CLEAN509_FEATURES=Object.freeze(['prediction','agf','hndkp','result','tr','jbyg','accurateFinish','ypuan','value']);
const freezeWeights=row=>Object.freeze({...row});
const POSITION_PRIORS=Object.freeze({
  1:freezeWeights({prediction:.2439,agf:.3588,hndkp:.0373,result:.1199,tr:.0659,jbyg:.0627,accurateFinish:.0752,ypuan:.0257,value:.0105}),
  2:freezeWeights({prediction:.1301,agf:.3739,hndkp:.0453,result:.2864,tr:.1129,jbyg:.0132,accurateFinish:.0017,ypuan:.0107,value:.0259}),
  3:freezeWeights({prediction:.1745,agf:.3157,hndkp:.0826,result:.2776,tr:.1039,jbyg:.0057,accurateFinish:0,ypuan:.0219,value:.0181}),
  4:freezeWeights({prediction:.0905,agf:.3829,hndkp:.0454,result:.2775,tr:.0484,jbyg:.0288,accurateFinish:.0205,ypuan:.0422,value:.0637}),
  5:freezeWeights({prediction:.0636,agf:.2618,hndkp:.0364,result:.2637,tr:.1802,jbyg:.0690,accurateFinish:.0312,ypuan:.0825,value:.0117})
});
const MAIN_HOLDOUT=Object.freeze({
  learned:Object.freeze({p1Pct:32.72,top3Pct:63.94,top5Pct:80.63,mrr:.5270}),
  agf:Object.freeze({p1Pct:33.06}),
  frozenPrediction:Object.freeze({p1Pct:32.89,top3Pct:63.61,top5Pct:79.63}),
  decision:'KEEP_CHAMPION_P1',
  reason:'CLEAN509 linear P1 challenger did not beat current/AGF P1 robustly; use only as tail/coverage prior.'
});
const POSITION_HOLDOUT=Object.freeze({
  p1:Object.freeze({exactPct:32.72,top3Pct:63.94,top5Pct:80.63}),
  p2:Object.freeze({exactPct:28.38,top3Pct:64.44,top5Pct:83.81}),
  p3:Object.freeze({exactPct:28.28,top3Pct:61.09,top5Pct:86.20}),
  p4:Object.freeze({exactPct:19.87,top3Pct:50.33,top5Pct:72.85}),
  p5:Object.freeze({exactPct:24.50,top3Pct:52.32,top5Pct:72.85})
});
// Generic CLEAN509 cross-check using current production widths. These are NOT
// production formulas; they are recorded to prove why product-specific V46 is retained.
const GENERIC_SIDEBET_CROSSCHECK=Object.freeze({
  sirali:Object.freeze({widths:[5,5],all:{tests:2886,hits:1835,hitPct:63.58,roiPct:-25.22},holdout:{tests:599,hits:379,hitPct:63.27,roiPct:-28.30}}),
  triple:Object.freeze({widths:[5,6,7],all:{tests:1665,hits:1096,hitPct:65.83,roiPct:-48.31},holdout:{tests:328,hits:220,hitPct:67.07,roiPct:-57.22}}),
  quartet:Object.freeze({widths:[3,5,6,9],all:{tests:498,hits:97,hitPct:19.48,roiPct:-62.00},holdout:{tests:113,hits:20,hitPct:17.70,roiPct:-63.45}}),
  quintet:Object.freeze({widths:[2,5,5,6,8],all:{tests:630,hits:50,hitPct:7.94,roiPct:-39.34},holdout:{tests:134,hits:9,hitPct:6.72,roiPct:-73.00}})
});
const POLICY=Object.freeze({
  p1Authority:'CHAMPION_LOCKED',
  finalTailBlend:.10,
  sidebetLowSampleBlend:.12,
  sidebetMidSampleBlend:.08,
  sidebetHighSampleBlend:.03,
  sidebetP1MaxBlend:.04,
  midSampleAt:20,
  highSampleAt:60,
  autoActivateSidebets:false,
  productFormulaDecision:'RETAIN_V46_PRODUCT_SPECIFIC',
  rationale:'CLEAN509 is a conservative regularizer. Product-specific V46 holdout/ROI is stronger than generic CLEAN509 side-bet refit.'
});
function positionPrior(position){
  const p=Math.max(1,Math.min(5,Number(position)||1));
  return {...POSITION_PRIORS[p]};
}
function sidebetPriorBlend(position,sample){
  const p=Math.max(1,Math.min(5,Number(position)||1)),n=Math.max(0,Number(sample)||0);
  let blend=n>=POLICY.highSampleAt?POLICY.sidebetHighSampleBlend:n>=POLICY.midSampleAt?POLICY.sidebetMidSampleBlend:POLICY.sidebetLowSampleBlend;
  if(p===1)blend=Math.min(blend,POLICY.sidebetP1MaxBlend);
  return blend;
}
function sidebetEvidence(product){
  const key=String(product||'');
  return {production:PRODUCTS[key]||null,genericClean509:GENERIC_SIDEBET_CROSSCHECK[key]||null,decision:POLICY.productFormulaDecision};
}
global.TKP_R156_CLEAN509_CALIBRATION=Object.freeze({
  VERSION:'R15.6-CLEAN509-WALKFORWARD-JOINT-20260901',DATASET:CLEAN509_DATASET,FEATURES:CLEAN509_FEATURES,
  POSITION_PRIORS,MAIN_HOLDOUT,POSITION_HOLDOUT,GENERIC_SIDEBET_CROSSCHECK,POLICY,
  positionPrior,sidebetPriorBlend,sidebetEvidence
});
})(window);
