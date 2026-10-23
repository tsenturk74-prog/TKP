'use strict';
/* Budget-matched forward experiment only. Never changes a live coupon. */
(function(global){
 const VERSION='R19.47.31-AUDIT1-DS-SHADOW';
 const no=h=>String(h?.horse_no??h??'');
 const key=h=>no(h).match(/-(E\d+)$/i)?.[1]?.toUpperCase()||'N:'+no(h);
 const withdrawn=h=>typeof global.isNonRunner==='function'?global.isNonRunner(h):!!(h?.scratched||h?.non_runner||h?.is_non_runner);
 function build(coupon,options={}){
  const capturedAt=options.capturedAt||new Date().toISOString(),at=Date.parse(capturedAt);
  const result={version:VERSION,mode:'SHADOW_ONLY',captured_at:capturedAt,eligible:false,reason:'INVALID_COUPON',unit:Number(coupon?.unit),cost:0,baseline_cost:0,legs:[]};
  if(!coupon||coupon.error||coupon.disabled||coupon.readOnlySnapshot||!coupon.legs?.length||!(result.unit>0))return result;
  let scoredLegs=0;
  for(const leg of coupon.legs){
   const race=leg.r||leg.x?.r||{},order=(leg.displayOrder?.length?leg.displayOrder:leg.ordered||leg.allHorses||[]).filter(h=>h&&!withdrawn(h));
   const original=(leg.picks||[]).slice(),picks=original.slice(),width=picks.length;
   const row={leg:Number(race.leg)||0,baseline_picks:original.map(no),picks:[],eligible:true,candidates:[],actions:[]};
   const time=String(race.tjk_race_time||race.race_time||'').match(/(\d{1,2})[:.](\d{2})/);
   const start=time?Date.parse(String(race.race_date||'').slice(0,10)+'T'+time[1].padStart(2,'0')+':'+time[2]+':00+03:00'):NaN;
   const known=(race.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1);
   if(!width||!Number.isFinite(at)||!Number.isFinite(start)||at>=start||known){row.eligible=false;row.reason='NOT_VERIFIED_PRE_RACE';}
   if(new Set(picks.map(key)).size!==width){row.eligible=false;row.reason='DUPLICATE_BASELINE_GROUP';}
   if(row.eligible&&width>=4&&!leg.protectedFlag){
    // Existing production ordering supplies P1–P5; the fixed experiment uses
    // DS1 for width 4–5, DS1+DS2 for width >=6, never increasing a width.
    const seen=new Set(order.slice(0,5).map(key)),tail=[];
    for(const h of order.slice(5)){
     const p=global.tkpDeepSurprisePForHorse?.(race,h);
     if(p==null||!Number.isFinite(p)||p<=0||p>1||seen.has(key(h)))continue;
     seen.add(key(h));tail.push({h,p});
    }
    tail.sort((a,b)=>b.p-a.p||order.indexOf(a.h)-order.indexOf(b.h));
    const candidates=tail.slice(0,width>=6?2:1);row.candidates=candidates.map((x,i)=>({horse_no:no(x.h),p:x.p,rank:i+1}));
    if(!candidates.length){row.eligible=false;row.reason='NO_FROZEN_DS_SCORES';}
    else{
     scoredLegs++;
     // A fixed top-three floor also avoids recalculating support from mutable
     // historical state when an asynchronous DS response arrives later.
     const protect=new Set(order.slice(0,3).map(key));
     for(const field of ['protectedValueNos','protectedSignalNos','protectedBombNos','kulisPriorityNos'])for(const n of leg[field]||[])protect.add(key(n));
     for(const item of candidates){
      const candidate=item.h,k=key(candidate);
      if(picks.some(h=>key(h)===k)){protect.add(k);row.actions.push({in:no(candidate),reason:'ALREADY_SELECTED_GROUP'});continue;}
      let remove=-1,worst=-1;
      for(let i=0;i<picks.length;i++){
       if(protect.has(key(picks[i]))||global.tkpLegacyXKulisForce?.(picks[i]))continue;
       const rank=order.findIndex(h=>key(h)===key(picks[i]));
       if(rank>worst){worst=rank;remove=i;}
      }
      if(remove<0){row.actions.push({in:no(candidate),reason:'NO_UNPROTECTED_SLOT'});continue;}
      const out=no(picks[remove]);picks[remove]=candidate;protect.add(k);row.actions.push({in:no(candidate),out,reason:'BUDGET_NEUTRAL_DS_SWAP'});
     }
    }
   }
   row.picks=picks.map(no);result.legs.push(row);
  }
  result.baseline_cost=result.legs.reduce((n,l)=>n*l.baseline_picks.length,result.unit);
  result.cost=result.legs.reduce((n,l)=>n*l.picks.length,result.unit);
  const loadedAt=Date.parse(global.tkpR17Status?.()?.loadedAt||'');
  result.eligible=result.legs.every(l=>l.eligible)&&scoredLegs>0&&result.cost===result.baseline_cost&&result.cost<=2000&&Number.isFinite(loadedAt)&&loadedAt<=at;
  result.reason=result.eligible?'FROZEN_BUDGET_MATCHED_SHADOW':result.cost>2000?'OVER_2000_TL':'INCOMPLETE_PRE_RACE_DS_EVIDENCE';
  return result;
 }
 global.tkpBuildDeepSurpriseShadowCoupon=build;
})(globalThis);
