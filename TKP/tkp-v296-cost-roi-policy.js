(function(global){'use strict';
const policy={
  version:'R17.2-ROI-PORTFOLIO-GATE-20260913',
  hardMaxCostMultiplier:1.40,
  preferredBudgets:{main:800,surprise:900,expert:900},economyBudget:700,normalKneeBudget:800,normalHardCap:1400,
  rule:'R17.2: Altılı + yan bahis portföyü gerçek cost/return ROI, MaxDD ve kayıp serisiyle izlenir. Negatif gerçek ROI ürünleri otomatik OYNA olamaz; yalnız yeni saat-kilitli forward kanıt yeniden terfi ettirebilir.',
  coverage:{archiveMeetings:509,safePreRaceMeetings:452,safePreRaceRaces:2712,unsafeOrMissingSnapshotMeetings:57,rankCoveragePct:{p1:31.05,p2:50.00,p3:64.05,p4:73.45,p5:80.01,p6:84.37,p7:88.97,p8:92.40,p9:94.99,p10:96.68}},
  altili:{
    budget700:{hits:27,meetings:452,hitPct:5.97,roiPct:-51.05,payoutKnown:341},
    budget1100:{hits:33,meetings:452,hitPct:7.30,roiPct:-56.29,payoutKnown:341},
    budget1400:{hits:35,meetings:452,hitPct:7.74,roiPct:-66.04,payoutKnown:341},
    decision:'LOWER_COST_SELECTIVE_PORTFOLIO'
  },
  sideBets:{
    uclu_bahis:{pool:3,roi:-20.47,hitPct:10.85,action:'SELECTIVE_ONLY'},
    sirali_ikili:{pool:4,roi:-24.39,hitPct:47.43,action:'SELECTIVE_ONLY'},
    sirali5li:{pool:5,roi:-22.28,hitPct:11.81,action:'SELECTIVE_ONLY'},
    uclu_ganyan:{pool:3,roi:-45.31,hitPct:25.75,action:'SELECTIVE_ONLY'},
    dortlu:{pool:3,roi:-38.03,hitPct:20.28,action:'SELECTIVE_ONLY'},
    besli:{pool:3,roi:-57.59,hitPct:10.57,action:'SELECTIVE_ONLY'},
    tabela:{pool:4,roi:-53.07,hitPct:9.31,action:'SELECTIVE_ONLY'}
  },
  actualEvidence:{
    source:'R17_BACKFILLED.tkbz real recorded bets + evaluated primary sidebet tickets',
    altili:{tickets:13,cost:25079.25,return:16580.75,net:-8498.50,roiPct:-33.88658,maxDrawdown:10265.50,longestLosingStreak:4,action:'SELECTIVE_ONLY'},
    sideBets:{
      cifte:{tickets:2513,cost:22777.00,return:22308.40,roiPct:-2.057339,maxDrawdown:3902.40,longestLosingStreak:17,action:'SHADOW_REVIEW'},
      sirali:{tickets:3078,cost:28270.00,return:16202.05,roiPct:-42.688185,maxDrawdown:12800.90,longestLosingStreak:17,action:'PAS'},
      triple:{tickets:1779,cost:114364.00,return:47827.35,roiPct:-58.179716,maxDrawdown:68400.65,longestLosingStreak:19,action:'PAS'},
      quartet:{tickets:535,cost:335037.00,return:1473.57,roiPct:-99.560177,maxDrawdown:333563.43,longestLosingStreak:34,action:'PAS'},
      quintet:{tickets:750,cost:2326680.00,return:72859.88,roiPct:-96.868504,maxDrawdown:2253820.12,longestLosingStreak:217,action:'PAS'}
    }
  },
  source:'509 archive calibration + R17.2 actual ticket audit. No outcome field enters live ranking.'
};
policy.recommendation=function(product){
  const key=String(product||'').toLowerCase();
  const row=policy.actualEvidence.sideBets[key];
  if(!row)return null;
  const action=String(row.action||'PAS').toUpperCase();
  const review=action==='SHADOW_REVIEW'||action==='SELECTIVE_ONLY';
  return {
    product:key,play:false,block:true,strong:false,verified:true,
    mode:review?'SHADOW_REVIEW':'PAS',label:review?'İNCELEME':'PAS',
    roiPct:Number(row.roiPct)||0,sample:Number(row.tickets)||0,
    maxDrawdown:Number(row.maxDrawdown)||0,longestLosingStreak:Number(row.longestLosingStreak)||0,
    reason:`R17.2 gerçek ticket ROI %${Number(row.roiPct||0).toFixed(1)} · n=${Number(row.tickets)||0} · MaxDD ${Number(row.maxDrawdown||0).toFixed(0)} · kayıp seri ${Number(row.longestLosingStreak)||0}`
  };
};
global.TKP_V296_COST_ROI_POLICY=policy;
})(window);
