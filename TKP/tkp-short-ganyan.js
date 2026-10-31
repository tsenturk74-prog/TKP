(function(root){'use strict';
const VERSION='COVERAGE-RETENTION-V3',COLUMN_LIMIT=30000;
const group=no=>String(no).match(/-E\d+$/i)?.[0].toUpperCase()||String(no);
const columns=pools=>pools.reduce((n,p)=>n*p.length,1);
const copy=t=>({...t,pools:t.pools.map(p=>p.slice())});
function visit(pools,callback,index=0,parts=[]){if(index===pools.length)return callback(parts.join('|'),parts);for(const no of pools[index]){parts.push(group(no));if(visit(pools,callback,index+1,parts)===false){parts.pop();return false;}parts.pop();}return true;}
function count(tickets){const map=new Map();for(const t of tickets)visit(t.pools,key=>{map.set(key,(map.get(key)||0)+1);});return map;}
function information(fields,beta){return fields.map(f=>{const sum=f.horses.reduce((n,h)=>n+Math.max(0,Number(h.agf)||0),0),size=f.horses.length;return new Map(f.horses.map(h=>{const g=String(h.g??group(h.no)),q=sum?Math.max(0,Number(h.agf)||0)/sum:1/size,support=Math.max(Number(h.bh)>0?1:0,h.bmb?.8:0,h.odb?.8:0,h.tr?.6:0,h.core?.3:0);return [g,{no:String(h.no??g),p:Math.max(1e-9,Number(h.p)||0),q:Math.max(.001,.95*q+.05/size),support,beta}];}));});}
function metadata(maps,key){const parts=key.split('|');let p=1,q=1,support=0;for(let i=0;i<parts.length;i++){const h=maps[i]?.get(parts[i]);if(!h)return null;p*=h.p;q*=h.q;support+=h.support;}return {q,value:p/Math.pow(q,maps[0].values().next().value?.beta||0)*(1+.4*support/parts.length)};}
function protectedCounts(counts,maps,fraction){if(!(fraction>0))return new Map();const rows=[...counts.keys()].map(key=>({key,q:metadata(maps,key)?.q??Infinity})).sort((a,b)=>a.q-b.q||a.key.localeCompare(b.key));const threshold=rows[Math.max(0,Math.ceil(rows.length*Math.min(1,fraction))-1)]?.q??0;return new Map(rows.filter(r=>r.q<=threshold).map(r=>[r.key,counts.get(r.key)]));}
function retentionCheck(fields,baseline,candidate,options={}){
 if(baseline.concat(candidate).some(t=>!Number.isFinite(Number(t.cost)))||baseline.concat(candidate).reduce((s,t)=>s+columns(t.pools),0)>2*COLUMN_LIMIT)return {valid:false,skipped:'column-limit-or-cost',missing:0,multiplicityLost:0};
 const unit=Number(options.unit)||1,baseCost=baseline.reduce((s,t)=>s+Number(t.cost),0),cost=candidate.reduce((s,t)=>s+Number(t.cost),0),maps=information(fields,options.beta??1),base=count(baseline),next=count(candidate),protectedRows=protectedCounts(base,maps,options.rareFraction??.25);
 let missing=0,multiplicityLost=0,protectedHorseLost=0,shapeChanged=candidate.length!==baseline.length,unknown=0;
 for(const key of base.keys())if(!(next.get(key)>0))missing++;
 for(const [key,n] of protectedRows)if((next.get(key)||0)<n)multiplicityLost++;
 for(let s=0;s<candidate.length;s++){const a=baseline[s],b=candidate[s];if(!a||a.pools.length!==b.pools.length){shapeChanged=true;continue;}for(let j=0;j<b.pools.length;j++){const gs=b.pools[j].map(group);if(new Set(gs).size!==gs.length||gs.some(g=>!maps[j]?.has(g)))unknown++;protectedHorseLost+=a.pools[j].filter(no=>(maps[j]?.get(group(no))?.support||0)>0&&!gs.includes(group(no))).length;if((a.pools[j].length===1)!==(b.pools[j].length===1)||a.pools[j].length===1&&group(a.pools[j][0])!==group(b.pools[j][0]))shapeChanged=true;}if(Math.abs(columns(b.pools)*unit-b.cost)>.001)shapeChanged=true;}
 const costLimit=options.allowUnusedBudget===true?(Number(options.cap)||baseCost):Math.min(baseCost,Number(options.cap)||baseCost),costIncreased=cost>costLimit+.001,belowFloor=cost+1e-3<Math.min(baseCost,Number(options.floor)||0);
 return {valid:!missing&&!multiplicityLost&&!protectedHorseLost&&!shapeChanged&&!unknown&&!costIncreased&&!belowFloor,missing,multiplicityLost,protectedHorseLost,shapeChanged,unknown,costIncreased,belowFloor,baseColumns:base.size,columns:next.size,cost,baseCost};
}
function acceptCandidate(fields,baseline,candidate,options={}){const audit=retentionCheck(fields,baseline,candidate,options);return {accepted:audit.valid,tickets:(audit.valid?candidate:baseline).map(copy),audit:{version:VERSION,...audit}};}
function improve(fields,baseline,options={}){
 const rawColumns=baseline.reduce((s,t)=>s+columns(t.pools),0),unchanged=why=>({tickets:baseline.map(copy),audit:{version:VERSION,skipped:why,moves:[]}});
 if(!Number.isFinite(rawColumns)||rawColumns>COLUMN_LIMIT)return unchanged('column-limit');
 const unit=Number(options.unit)||1,beta=options.beta??1,maxMoves=Math.min(2,Math.max(0,options.maxMoves==null?2:Number(options.maxMoves)||0)),maps=information(fields,beta),tickets=baseline.map(copy),counts=count(tickets),protectedRows=protectedCounts(counts,maps,options.rareFraction??.25),cache=new Map(),moves=[];
 const initial=retentionCheck(fields,baseline,tickets,options);if(!initial.valid)return unchanged('invalid-baseline');
 const meta=key=>{if(!cache.has(key))cache.set(key,metadata(maps,key));return cache.get(key);};
 for(let round=0;round<maxMoves;round++){
  let best=null;
  for(let slot=0;slot<tickets.length;slot++){
   const ticket=tickets[slot],oldColumns=columns(ticket.pools),minTicket=Math.min(Number(ticket.cost),Number(ticket.minBudget)||0);
   for(let from=0;from<fields.length;from++){
    if(ticket.pools[from].length<2)continue;
    for(const removed of ticket.pools[from]){
     if((maps[from].get(group(removed))?.support||0)>0)continue;
     const removedPools=ticket.pools.map((p,j)=>j===from?[removed]:p),removedKeys=[];let removedValue=0,safe=true;
     visit(removedPools,key=>{if((counts.get(key)||0)-1<Math.max(1,protectedRows.get(key)||0)){safe=false;return false;}removedKeys.push(key);removedValue+=meta(key)?.value||0;});if(!safe)continue;
     for(let to=0;to<fields.length;to++){
      if(ticket.pools[to].length<2||to!==from&&ticket.pools[from].length<3)continue;
      const present=new Set(ticket.pools[to].map(group)),additions=[...maps[to]].filter(([g,h])=>!present.has(g)&&h.support>0&&h.p>=.005).sort((a,b)=>(b[1].p/Math.pow(b[1].q,beta))*(1+.4*b[1].support)-(a[1].p/Math.pow(a[1].q,beta))*(1+.4*a[1].support)||a[0].localeCompare(b[0])).slice(0,2);
      for(const [added,h] of additions){
       const pools=ticket.pools.map(p=>p.slice());pools[from]=pools[from].filter(no=>group(no)!==group(removed));pools[to].push(h.no);const cols=columns(pools),cost=Math.round(cols*unit*100)/100;if(cols>oldColumns||cost+1e-3<minTicket)continue;
       const total=tickets.reduce((s,t)=>s+t.cost,0)-ticket.cost+cost;if(total+1e-3<Math.min(initial.baseCost,Number(options.floor)||0))continue;
       const addedPools=pools.map((p,j)=>j===to?[h.no]:p),addedKeys=[];let value=0,newColumns=0;visit(addedPools,key=>{const novel=!counts.has(key);addedKeys.push(key);newColumns+=Number(novel);value+=(meta(key)?.value||0)*(novel?1.25:1);});const gain=value-removedValue;
       if(newColumns>0&&gain>1e-12&&(!best||gain>best.gain+1e-12||Math.abs(gain-best.gain)<1e-12&&cost<best.cost))best={slot,from,to,removed:String(removed),added:h.no,pools,cost,cols,gain,removedKeys,addedKeys,newColumns};
      }
     }
    }
   }
  }
  if(!best)break;
  const before=tickets[best.slot];for(const key of best.removedKeys){const n=counts.get(key)-1;if(n)counts.set(key,n);else counts.delete(key);}for(const key of best.addedKeys)counts.set(key,(counts.get(key)||0)+1);
  tickets[best.slot]={...before,pools:best.pools,cost:best.cost,columns:best.cols};moves.push({variant:before.variant,removedLeg:fields[best.from].leg,removed:best.removed,addedLeg:fields[best.to].leg,added:best.added,costBefore:before.cost,costAfter:best.cost,newColumns:best.newColumns,reason:'Örtüşen kapsam korundu; destekli alternatif eklendi'});
 }
 const result=acceptCandidate(fields,baseline,tickets,options);return {tickets:result.tickets,audit:{...result.audit,moves:result.accepted?moves:[],beta,rareFraction:options.rareFraction??.25}};
}
function augment(fields,baseline,options={}){
 const rawColumns=baseline.reduce((s,t)=>s+columns(t.pools),0);if(!Number.isFinite(rawColumns)||rawColumns>COLUMN_LIMIT)return {tickets:baseline.map(copy),audit:{version:VERSION,skipped:'column-limit',moves:[]}};
 const unit=Number(options.unit)||1,beta=options.beta??1,cap=Number(options.cap)||baseline.reduce((s,t)=>s+t.cost,0),maps=information(fields,beta),tickets=baseline.map(copy),counts=count(tickets),cache=new Map(),moves=[],maxMoves=Math.min(2,Math.max(0,options.maxMoves==null?2:Number(options.maxMoves)||0));
 const checkOptions={...options,allowUnusedBudget:true,rareFraction:1},initial=retentionCheck(fields,baseline,tickets,checkOptions);if(!initial.valid)return {tickets,audit:{version:VERSION,skipped:'invalid-baseline',moves:[]}};
 const meta=key=>{if(!cache.has(key))cache.set(key,metadata(maps,key));return cache.get(key);};
 for(let round=0;round<maxMoves;round++){
  const cost=tickets.reduce((s,t)=>s+t.cost,0),currentValue=[...counts].reduce((s,[key,n])=>s+n*(meta(key)?.value||0),0),average=currentValue/cost;let best=null;
  for(let slot=0;slot<tickets.length;slot++)for(let leg=0;leg<fields.length;leg++){
   const ticket=tickets[slot];if(ticket.pools[leg].length<2)continue;const extra=columns(ticket.pools)/ticket.pools[leg].length*unit;if(cost+extra>cap+.001)continue;const present=new Set(ticket.pools[leg].map(group));
   for(const [g,h] of maps[leg]){if(present.has(g)||h.support<=0||h.p<.005)continue;const pools=ticket.pools.map((p,j)=>j===leg?p.concat([h.no]):p.slice()),addedPools=pools.map((p,j)=>j===leg?[h.no]:p),keys=[];let value=0,newColumns=0;visit(addedPools,key=>{keys.push(key);newColumns+=Number(!counts.has(key));value+=meta(key)?.value||0;});const relative=(value/extra)/Math.max(1e-12,average);if(newColumns===0||relative<(options.minRelativeValue??1.25))continue;const score=(value/extra)*(.75+.25*newColumns/keys.length);if(!best||score>best.score+1e-12||Math.abs(score-best.score)<1e-12&&extra<best.extra)best={slot,leg,added:h.no,pools,keys,newColumns,extra,score,relative};}
  }
  if(!best)break;const before=tickets[best.slot],newCost=Math.round((before.cost+best.extra)*100)/100;tickets[best.slot]={...before,pools:best.pools,columns:columns(best.pools),cost:newCost};for(const key of best.keys)counts.set(key,(counts.get(key)||0)+1);moves.push({variant:before.variant,addedLeg:fields[best.leg].leg,added:best.added,costBefore:before.cost,costAfter:newCost,newColumns:best.newColumns,relativeValue:best.relative,reason:'Mevcut atlar çıkarılmadan, ürün tavanındaki boş bütçeyle destekli aday eklendi'});
 }
 const accepted=acceptCandidate(fields,baseline,tickets,checkOptions);return {tickets:accepted.tickets,audit:{...accepted.audit,mode:'UNUSED_BUDGET',moves:accepted.accepted?moves:[],paidMultiplicityPreserved:accepted.accepted,remainingBudget:cap-accepted.tickets.reduce((s,t)=>s+t.cost,0)}};
}
const api={VERSION,COLUMN_LIMIT,group,retentionCheck,acceptCandidate,improve,augment};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TKP_COVERAGE_RETENTION=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this);

(function(g){'use strict';
const VERSION='SHORT-GANYAN-V15',VERSIONS=['SHORT-GANYAN-V2','SHORT-GANYAN-V3','SHORT-GANYAN-V4','SHORT-GANYAN-V5','SHORT-GANYAN-V6','SHORT-GANYAN-V7','SHORT-GANYAN-V8','SHORT-GANYAN-V9','SHORT-GANYAN-V10','SHORT-GANYAN-V11','SHORT-GANYAN-V12','SHORT-GANYAN-V13','SHORT-GANYAN-V14',VERSION],VARIANTS=['teksiz','tek','tek2'],MIN_TL={5:1000,4:500,3:250},LIMIT_TL={5:2000,4:1000,3:500},PRODUCT={5:'besli',4:'dortlu_ganyan',3:'uclu_ganyan'};
const title=n=>n===5?'5’li':n===4?'4’lü':'3’lü';
const variantLabel=v=>v==='tek'?'TEK 1':v==='tek2'?'TEK 2':'Teksiz';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n||0).toLocaleString('tr-TR',{maximumFractionDigits:2});
const group=n=>String(n).match(/-E\d+$/i)?.[0].toUpperCase()||String(n);
const running=h=>h&&!(typeof g.isNonRunner==='function'&&g.isNonRunner(h));
const key=r=>[r.race_date,String(r.hippodrome).toLocaleUpperCase('tr-TR'),Number(r.altili_no)||1].join('|');
function database(){try{return typeof db!=='undefined'?db:g.db;}catch(_){return g.db;}}
function store(d){return d?.settings?.short_ganyan?.records||[];}
function history(){const h=g.TKP_SHORT_GANYAN_HISTORY;return VERSIONS.includes(h?.engineVersion)&&h.status==='complete'&&Array.isArray(h.records)?h:null;}
function omissionBucket(rank){return Number(rank)<=3?'1-3':Number(rank)<=6?'4-6':'7+';}
function budgetOmissionLearning(d=database(),beforeDate=''){
 const byId=new Map((d?.races||[]).map(r=>[String(r?.id||''),r])),tickets=store(d).filter(t=>t?.version===VERSION&&t.evidence_class==='LIVE_PRE_RACE_LOCKED'&&(!beforeDate||String(t.date||'')<String(beforeDate))&&valid(t)).slice().sort((a,b)=>(Number(b.n)||0)-(Number(a.n)||0)||Number(a.variant!=='teksiz')-Number(b.variant!=='teksiz'));
 const observations=new Map();
 for(const t of tickets)for(let i=0;i<(t.coverageAudit||[]).length;i++){
  const audit=t.coverageAudit[i],ref=t.refs?.[i],race=ref&&byId.get(String(ref.id));
  if(!race||key(race)!==t.meeting||Number(race.leg)!==Number(ref.leg)||!['VERIFIED','VERIFIED_TJK_PAYOUT'].includes(String(race.result_integrity_status||'')))continue;
  const winners=(race.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);if(winners.length!==1)continue;
  for(const c of audit.budgetOmittedCandidates||[]){const no=String(c.horseNo||'');if(!no)continue;const identity=[t.meeting,audit.leg,group(no)].join('|'),finish=(race.horses||[]).filter(h=>group(h.horse_no)===group(no)).map(h=>Number(h.finish_position)||0).filter(n=>n>0).sort((a,b)=>a-b)[0]||0,old=observations.get(identity);
   if(!old)observations.set(identity,{meeting:t.meeting,leg:Number(audit.leg),horseNo:no,mainRank:Number(c.mainRank)||99,finish,top3:finish>0&&finish<=3?1:0,win:finish===1?1:0,included:false});
   const row=observations.get(identity);if((t.pools?.[i]||[]).some(p=>group(p)===group(no)))row.included=true;
  }
 }
 const rows=[...observations.values()],top3=rows.reduce((n,r)=>n+r.top3,0),baseline=rows.length?top3/rows.length:0,buckets={};
 for(const name of ['1-3','4-6','7+']){const subset=rows.filter(r=>omissionBucket(r.mainRank)===name),n=subset.length,hits=subset.reduce((s,r)=>s+r.top3,0),rate=n?(hits+20*baseline)/(n+20):baseline;buckets[name]={sample:n,top3:hits,rate,lift:n>=30?Math.max(-.15,Math.min(.15,rate-baseline)):0,active:n>=30};}
 return {sample:rows.length,wins:rows.reduce((n,r)=>n+r.win,0),top3,included:rows.filter(r=>r.included).length,rescuedWins:rows.filter(r=>r.win&&r.included).length,baseline,buckets};
}
function budgetFor(n,options={}){const raw=options.budgets?.[n]??history()?.selectedBudgets?.[n]??LIMIT_TL[n];if(options.research===true)return Number(raw)>0?Number(raw):LIMIT_TL[n];return Math.max(MIN_TL[n],Math.min(LIMIT_TL[n],Number(raw)||LIMIT_TL[n]));}
function hashString(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
function mainSignature(c){return JSON.stringify((c?.legs||[]).map(l=>[Number(l.r?.leg??l.leg),(l.picks||[]).map(h=>group(h.horse_no??h)).sort()]).sort((a,b)=>a[0]-b[0]));}
function sourceSignature(coupons,main){return JSON.stringify({main:mainSignature(main),singles:['main','alt','surprise'].map(role=>[role,(coupons?.[role]?.legs||[]).map(l=>[Number(l.r?.leg??l.leg),(l.picks||[]).map(h=>group(h.horse_no??h)).sort()]).filter(x=>x[1].length===1).sort((a,b)=>a[0]-b[0])])});}
function sourceMainCoupon(source,fallback){
 const active=fallback?.main||fallback;
 if(Array.isArray(active?.legs)&&active.legs.length===6&&!active.error)return active;
 const main=source?.coupons?.main;
 // Aktarılan/gecikmeli kabul edilmiş toplantıda kısa ganyan yeni bir Altılı
 // TEK'i icat etmez: kaynak snapshotın Normal Altılı seçimleri kullanılır.
 if(Array.isArray(main?.legs)&&main.legs.length===6)return {...main,legs:main.legs.map(l=>({...l,picks:Array.isArray(l.picks)?l.picks.slice():[]})),readOnlySnapshot:false,sourceSnapshotId:String(source?.id||'')};
 return active;
}
function start(r){try{return String(g.tkpPredictionSnapshotRaceStartAt?.(r,{},false)||r.race_start_at||'');}catch(_){return '';}}
function field(x,parentLeg=null,learning=null){
 let display=x.scored?.length?x.scored:x.r.horses||[];
 if(typeof g.predictionDisplayRows==='function')display=g.predictionDisplayRows(x,Infinity,'score-desc').rows||display;
 const order=display.filter(running),seen=new Set();
 const hs=order.filter(h=>{const k=group(h.horse_no);if(seen.has(k))return false;seen.add(k);return true;});
 let raw=[];try{raw=typeof tkpPrLegProbs==='function'?tkpPrLegProbs({r:x.r,displayOrder:order}):[];}catch(_){}
 let units=hs.map((h,i)=>({h,p:Number(raw.find(o=>group(o.h.horse_no)===group(h.horse_no))?.p)||Math.max(.001,Number(h.score)||1/(i+1))}));
 const sum=units.reduce((n,o)=>n+o.p,0)||1;units.forEach(o=>o.p/=sum);
 const eligible=hs.filter(h=>(typeof g.canBeCouponSingle!=='function'||g.canBeCouponSingle(h))&&(typeof g.tkpLegacyXKulisBreaksSingle!=='function'||!g.tkpLegacyXKulisBreaksSingle(h)));
 const single=g.TKP_TOP3_SINGLE?.select(x.r,hs,{probabilities:units,eligibleNos:eligible.map(h=>String(h.horse_no))});
 let bh=[];try{const read=()=>g.tkpBhCommonRows?.(x.r,hs)||[];bh=(typeof g.tkpWithSideBetPanelNoScan==='function'?g.tkpWithSideBetPanelNoScan(read):read()).slice(0,6).map(z=>z.horse).filter(Boolean);}catch(_){}
 const parentPicks=parentLeg?.picks||[],parentUnits=parentPicks.map(h=>units.find(u=>group(u.h.horse_no)===group(h.horse_no??h))).filter(Boolean),parentMissing=parentPicks.filter(h=>!units.some(u=>group(u.h.horse_no)===group(h.horse_no??h))).map(h=>String(h.horse_no??h));
 const parentCore=parentUnits.slice(0,Math.ceil(parentUnits.length/2)).map(u=>u.h);
 const budgetAudit=parentLeg?.tkpBudgetOmissionAudit,omittedRows=budgetAudit?.version==='ALTILI_BUDGET_OMISSION_V1'&&budgetAudit.status==='BUDGET_LIMITED'&&Array.isArray(budgetAudit.horses)?budgetAudit.horses:[];
 const budgetOmittedUnits=omittedRows.map(row=>{const u=units.find(x=>group(x.h.horse_no)===group(row.horse_no));if(!u)return null;const bucket=learning?.buckets?.[omissionBucket(row.mainRank)],lift=bucket?.active?Number(bucket.lift)||0:0,weight=Math.max(.9,Math.min(1.1,1+lift*.35));return {...u,mainRank:Number(row.mainRank)||99,horseName:String(row.horse_name||u.h.horse_name||''),learning:{sample:Number(bucket?.sample)||0,top3Rate:bucket?.active?Number(bucket.rate):null,weight}};}).filter(Boolean);
 for(const u of budgetOmittedUnits)u.p*=u.learning.weight;
 if(budgetOmittedUnits.length){const adjusted=units.reduce((n,u)=>n+u.p,0)||1;units.forEach(u=>u.p/=adjusted);budgetOmittedUnits.sort((a,b)=>b.p-a.p||a.mainRank-b.mainRank||String(a.h.horse_no).localeCompare(String(b.h.horse_no)));}
  const agfCount=parentUnits.length>=4?6:5,agfCandidates=hs.filter(h=>Number(h.agf)>0).slice().sort((a,b)=>agfRank({hs},a)-agfRank({hs},b)).slice(0,agfCount),agfUnits=agfCandidates.map(h=>units.find(u=>group(u.h.horse_no)===group(h.horse_no))).filter(Boolean);
 const tr=hs.filter(h=>Number(h.tr_bmb_candidate)===1),market=hs.filter(h=>Number(h.agf_rank)>=1&&Number(h.agf_rank)<=3&&Number(h.agf)>=8).sort((a,b)=>Number(a.agf_rank)-Number(b.agf_rank)),required=[],requiredGroups=new Set();
 // Kısa oyun çekirdeği Altılı'nın ilk sırasını korur, fakat yalnız ilk ata
 // daraltılmaz: görünür ilk dört aday (TR/BMB, AGF ve Altılı çekirdeğiyle
 // birleşerek) uygun maliyette tam kapsama önceliği alır.
  for(const h of market.concat(tr,hs.slice(0,4),parentCore)){const k=group(h.horse_no);if(requiredGroups.has(k))continue;const found=units.find(u=>group(u.h.horse_no)===k);if(found){required.push(found);requiredGroups.add(k);}}
 const bhUnits=bh.map(h=>units.find(u=>group(u.h.horse_no)===group(h.horse_no))).filter(Boolean),trValue=h=>{try{const v=typeof g.tkpTrustedGcTrValue==='function'?g.tkpTrustedGcTrValue(h):null;return Number(v??h.tr_puan??h.tr_ganyan)||0;}catch(_){return 0;}},trUnits=hs.map(h=>({h,p:units.find(u=>group(u.h.horse_no)===group(h.horse_no))?.p||0,value:trValue(h)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value).slice(0,4).map(x=>units.find(u=>group(u.h.horse_no)===group(x.h.horse_no))).filter(Boolean);
 const specialUnits=hs.filter(h=>Number(h.bmb)===1||Number(h.odb)===1||h.bmb_source==='ŞABLON KURALI'||Number(h.tr_bmb_candidate)===1||[h.tkp_signal,h.tkp_badge,h.signal_badge,h.special_badge].some(v=>v!=null&&String(v).trim()&&!/^(0|false|no|none)$/i.test(String(v).trim()))||(()=>{try{return typeof g.isOdbCandidate==='function'&&g.isOdbCandidate(h,x.r);}catch(_){return false;}})()).map(h=>units.find(u=>group(u.h.horse_no)===group(h.horse_no))).filter(Boolean);
  return {r:x.r,hs,units,single,eligibleNos:new Set(eligible.map(h=>group(h.horse_no))),bh:bh.map(h=>String(h.horse_no)),tr:tr.map(h=>String(h.horse_no)),market:market.map(h=>String(h.horse_no)),agfCandidates:agfCandidates.map(h=>String(h.horse_no)),agfCount,agfUnits,trUnits,specialUnits,required,bhUnits,parentUnits,parentMissing,budgetOmittedUnits,budgetOmissionLearning:learning||null};
}
function agfRank(f,horse){
 const explicit=Number(horse?.agf_rank);if(Number.isFinite(explicit)&&explicit>0)return explicit;
 const ordered=(f.hs||[]).filter(h=>Number.isFinite(Number(h?.agf))&&Number(h.agf)>0).slice().sort((a,b)=>Number(b.agf)-Number(a.agf));
 const i=ordered.findIndex(h=>group(h.horse_no)===group(horse?.horse_no));return i>=0?i+1:0;
}
function singleAnchors(fields,coupons){
 const anchorsByLeg=new Map(),sources=['main','alt','surprise'].map(role=>({role,coupon:coupons?.[role]})).filter(x=>Array.isArray(x.coupon?.legs));
 fields.forEach((f,index)=>{
  const candidates=[];
  for(const {role,coupon} of sources){
   const leg=(coupon.legs||[]).find(l=>Number(l.r?.leg??l.leg)===Number(f.r.leg));
   if(leg?.picks?.length!==1)continue;
   const horse=f.hs.find(h=>group(h.horse_no)===group(leg.picks[0]?.horse_no??leg.picks[0]));
   if(!horse)continue;
   const rank=agfRank(f,horse);if(rank<1||rank>3)continue;
   const c=(f.single?.audit?.candidates||[]).find(c=>group(c.horseNo)===group(horse.horse_no))||{};
   const probability=f.units.find(u=>group(u.h.horse_no)===group(horse.horse_no))?.p||0;
   const historical=Number(c.sample)>=(g.TKP_TOP3_SINGLE?.MIN_SAMPLE||30)&&Number(c.rate)>0;
   const reliability=historical?Number(c.rate):probability;if(!(reliability>0))continue;
   candidates.push({index,horse,probability,reliability,sample:Number(c.sample)||0,rank,sharedWithAltili:true,role,
    audit:{...f.single?.audit,leg:Number(f.r.leg),horseNo:String(horse.horse_no),agfRank:rank,selectedRank:rank,selectedRate:historical?Number(c.rate):null,estimatedRate:reliability,reliabilitySource:historical?'HISTORICAL_TOP3_COMPARISON':'MODEL_PROBABILITY',sample:Number(c.sample)||0,sourceRole:role,sharedWithAltili:true}});
  }
  candidates.sort((a,b)=>b.reliability-a.reliability||b.sample-a.sample||b.probability-a.probability||a.rank-b.rank);
  if(candidates.length)anchorsByLeg.set(index,candidates[0]);
 });
 return [...anchorsByLeg.values()].sort((a,b)=>b.reliability-a.reliability||b.sample-a.sample||b.probability-a.probability||a.index-b.index||a.rank-b.rank);
}
function selectedPoolAnchors(fields,coupons,existing=[]){
 const sources=['main','alt','surprise'].map(role=>({role,coupon:coupons?.[role]})).filter(x=>Array.isArray(x.coupon?.legs)),used=new Set(existing.map(a=>a.index)),out=[];
 fields.forEach((f,index)=>{if(used.has(index))return;const options=[];
  for(const {role,coupon} of sources){const leg=(coupon.legs||[]).find(l=>Number(l.r?.leg??l.leg)===Number(f.r.leg));for(const raw of leg?.picks||[]){const horse=f.hs.find(h=>group(h.horse_no)===group(raw?.horse_no??raw));if(!horse||!f.eligibleNos.has(group(horse.horse_no)))continue;const rank=agfRank(f,horse);if(rank<1||rank>3)continue;const probability=f.units.find(u=>group(u.h.horse_no)===group(horse.horse_no))?.p||0;if(!(probability>0))continue;const audit={...f.single?.audit,leg:Number(f.r.leg),horseNo:String(horse.horse_no),agfRank:rank,selectedRank:rank,selectedRate:null,estimatedRate:probability,reliabilitySource:'MODEL_PROBABILITY',sample:0,sourceRole:role,sharedWithAltili:true,sourceWasSingle:false};options.push({index,horse,probability,reliability:probability,sample:0,rank,sharedWithAltili:true,role,audit});}}
  options.sort((a,b)=>b.reliability-a.reliability||b.probability-a.probability||a.rank-b.rank||String(a.horse.horse_no).localeCompare(String(b.horse.horse_no)));if(options.length)out.push(options[0]);
 });
 return out.sort((a,b)=>b.reliability-a.reliability||b.probability-a.probability||a.index-b.index||a.rank-b.rank);
}
function allocate(fields,anchor,cap,minColumns=0,mode='full'){
 let states=new Map([[1,{columns:1,lp:0,pools:[]}]]);
 for(let i=0;i<fields.length;i++){
  const f=fields[i],next=new Map(),ranked=f.units.slice().sort((a,b)=>b.p-a.p||String(a.h.horse_no).localeCompare(String(b.h.horse_no)));
   const required=mode==='full'?f.required.concat(f.bhUnits):f.required,omitted=(f.budgetOmittedUnits||[]).map(u=>group(u.h.horse_no)),wanted=omitted.concat(mode==='market'?f.market.concat(f.tr).map(group):required.map(u=>group(u.h.horse_no)));
   const minWidth=mode==='fit'?2:Math.max(2,new Set(f.parentUnits.map(u=>group(u.h.horse_no)).concat(wanted)).size);
    const reqGroups=new Set(),coverageOrder=[];// Kısa ganyan Altılı'nın üstüne ektir: önce Altılı atları, sonra Altılı'ya
    // sığmayan/elenen adaylar, ardından diğer sinyaller.
    for(const u of f.parentUnits.concat(f.budgetOmittedUnits||[],required,f.agfUnits||[],f.bhUnits||[],f.specialUnits||[],f.trUnits||[],ranked)){const k=group(u.h.horse_no);if(!reqGroups.has(k)){reqGroups.add(k);coverageOrder.push(u);}}
  const cum=[0];coverageOrder.forEach(u=>cum.push(cum[cum.length-1]+u.p));
  const isSingle=anchor?.index===i;
  for(const st of states.values())for(let w=isSingle?1:2;w<=(isSingle?1:ranked.length);w++){
   if(w>1&&w<minWidth)continue;
   const columns=st.columns*w;if(columns>cap)break;
   const hit=isSingle?anchor.probability:cum[w];if(!(hit>0))continue;
   const lp=st.lp+Math.log(hit),old=next.get(columns);
   if(!old||lp>old.lp)next.set(columns,{columns,lp,pools:st.pools.concat([isSingle?[String(anchor.horse.horse_no)]:coverageOrder.slice(0,w).map(u=>String(u.h.horse_no))])});
  }
  states=next;
 }
  const valid=[...states.values()],funded=valid.filter(s=>s.columns>=minColumns),eligible=funded.length?funded:valid;
  return eligible.sort((a,b)=>b.lp-a.lp||a.columns-b.columns)[0]||null;
}
function plan(fields,anchor,cap,floor){
 if(fields.some(f=>f.parentMissing?.length))return null;
 if(cap===Infinity){
  if(fields.some((f,i)=>i!==anchor?.index&&f.units.length<2))return null;
  const pools=fields.map((f,i)=>i===anchor?.index?[String(anchor.horse.horse_no)]:f.units.map(u=>String(u.h.horse_no)));
   return {pools,columns:pools.reduce((n,p)=>n*p.length,1),lp:anchor?Math.log(anchor.probability):0,coverageRelaxed:false,audit:anchor?.audit||null};
 }
 // Kupon tavanı kesindir: Altılı atlarının tamamı sığmazsa 'fit' en yüksek
 // tutma ihtimalli havuzu tavan içinde kurar; tavan aşan kupon üretilmez.
 for(const mode of ['full','core','market','fit']){
   const best=allocate(fields,anchor,cap,floor,mode);
  if(best)return {...best,coverageRelaxed:mode!=='full',audit:anchor?.audit||null};
 }
 return null;
}
function guardFields(fields){
 return fields.map(f=>{const parent=new Set(f.parentUnits.map(u=>group(u.h.horse_no))),bh=new Map(f.bh.map((no,i)=>[group(no),i+1]));return {leg:Number(f.r.leg),horses:f.units.map((u,i)=>{const h=u.h,g=group(h.horse_no);let odb=Number(h.odb)===1;try{if(typeof globalThis.isOdbCandidate==='function')odb=!!globalThis.isOdbCandidate(h,f.r);}catch(_){}return {no:String(h.horse_no),g,p:u.p,agf:(f.r.horses||[]).filter(x=>running(x)&&group(x.horse_no)===g).reduce((s,x)=>s+Math.max(0,Number(x.agf)||0),0),rank:i+1,eligible:f.eligibleNos.has(g),bh:bh.get(g)||0,bmb:Number(h.bmb)===1,odb,tr:Number(h.tr_bmb_candidate)===1,core:parent.has(g)};})};});
}
function protectPortfolio(fields,tickets,ceiling){
 const guard=g.TKP_COVERAGE_RETENTION;if(!guard)return tickets;
 const fs=guardFields(fields),unit=tickets[0].unit,baseCost=tickets.reduce((s,t)=>s+t.cost,0);
 // A bounded coverage addition, not promotion of a newly fitted probability model.
 // Only three-leg additions passed the archive mean-ROI/paid-coverage checks.
 const candidate=tickets[0].n===3&&Number.isFinite(ceiling)?guard.augment(fs,tickets,{unit,cap:ceiling,floor:Math.min(MIN_TL[3],baseCost),beta:1,minRelativeValue:1.5,maxMoves:2}):{tickets,audit:{moves:[]}};
 const withinTicketBudgets=candidate.tickets.every(t=>Number(t.cost)<=Number(t.maxBudget)+.001&&Number(t.cost)+.001>=Number(t.minBudget));
 const checked=guard.acceptCandidate(fs,tickets,withinTicketBudgets?candidate.tickets:tickets,{unit,cap:ceiling,allowUnusedBudget:true,rareFraction:1});
 const accepted=withinTicketBudgets&&checked.accepted,finalTickets=accepted?checked.tickets:tickets;
 const audit={...checked.audit,mode:'PAID_COVERAGE_RETAINED',moves:accepted?(candidate.audit.moves||[]):[],paidMultiplicityPreserved:accepted,remainingBudget:Number.isFinite(ceiling)?ceiling-finalTickets.reduce((s,t)=>s+t.cost,0):null};
 return finalTickets.map(t=>({...t,belowMinimum:t.cost<t.minBudget,coverageGuardAudit:audit,coverageAudit:fields.map((f,i)=>coverageEvidence(f,t.pools[i],null))}));
}
function coverageEvidence(f,picks,main){
 const picked=new Set(picks.map(group)),parent=(main?.legs||[]).find(l=>Number(l.r?.leg??l.leg)===Number(f.r.leg)),base=(parent?.picks||[]).map(h=>String(h.horse_no??h)),parentNos=new Set(base.map(group)),signals=[...new Set(f.tr.concat(f.market,f.bh))],budget=f.budgetOmittedUnits||[],budgetOmittedCandidates=budget.map(u=>({horseNo:String(u.h.horse_no),horseName:u.horseName,mainRank:u.mainRank,learningSample:u.learning.sample,learningTop3Rate:u.learning.top3Rate,learningWeight:u.learning.weight}));
 const budgetOmittedIncluded=budgetOmittedCandidates.filter(c=>picked.has(group(c.horseNo))).map(c=>c.horseNo),budgetOmittedNotIncluded=budgetOmittedCandidates.filter(c=>!picked.has(group(c.horseNo))).map(c=>c.horseNo);
  return {leg:Number(f.r.leg),bh:f.bh,tr:f.tr,market:f.market,agfCandidates:f.agfCandidates||[],agfCount:f.agfCount||5,special:(f.specialUnits||[]).map(u=>String(u.h.horse_no)),trCandidates:(f.trUnits||[]).map(u=>String(u.h.horse_no)),sixfoldPicks:base,addedOutsideSixfold:picks.filter(no=>!parentNos.has(group(no))),omittedFromSixfold:base.filter(no=>!picked.has(group(no))),budgetOmittedCandidates,budgetOmittedIncluded,budgetOmittedNotIncluded,omittedSignals:signals.filter(no=>!picked.has(group(no))),reason:picks.length===1?'İlk üç adaydan TEK seçimi':budgetOmittedIncluded.length?'Altılı bütçesinde tavan nedeniyle dışarıda kalan aday kısa ganyana taşındı':'Altılı seçimi korundu + genişletilmiş aday havuzu'};
}
function build(rows,main=null,options={}){
 const coupons=main?.coupons||(main?.main||main?.alt||main?.surprise?main:{main});
 const mainCoupon=sourceMainCoupon(main,main);
 const ordered=(rows||[]).filter(x=>x?.r).slice().sort((a,b)=>Number(a.r.leg)-Number(b.r.leg));
 if(!ordered.length||new Set(ordered.map(x=>key(x.r))).size!==1)return [];
 const learning=budgetOmissionLearning(database(),ordered[0]?.r?.race_date),fields=ordered.map(x=>field(x,(mainCoupon?.legs||[]).find(l=>Number(l.r?.leg??l.leg)===Number(x.r.leg)),learning)),out=[];
 for(const n of [5,4,3]){
  if(fields.length<n)continue;const fs=fields.slice(-n);
  const unit=Number(g.ganyanUnitPrice?.(fs[0].r.hippodrome,n));if(!(unit>0))continue;
  const ticketBudgetTL=budgetFor(n,options),maxBudget=ticketBudgetTL,minBudget=MIN_TL[n],cap=Math.floor((maxBudget+1e-8)/unit),floor=Math.ceil((minBudget-1e-8)/unit);
  const buildPlan=(anchor)=>plan(fs,anchor,cap,floor);
  const noSingle=buildPlan(null);if(!noSingle)continue;
  const singles=[],sourceAnchors=singleAnchors(fs,coupons),rankedAnchors=sourceAnchors.concat(selectedPoolAnchors(fs,coupons,sourceAnchors));
  let firstAnchor=null;
  for(const anchor of rankedAnchors){
   const best=buildPlan(anchor);if(best)singles.push(best);
   if(best){firstAnchor=anchor;break;}
  }
  for(const anchor of rankedAnchors){
   if(anchor===firstAnchor)continue;
   const best=buildPlan(anchor);if(best){singles.push(best);break;}
  }
  if(singles.length>2)singles.length=2;
  const productStart=out.length;
  [noSingle,...singles].forEach((best,i)=>{
   const cost=Math.round(best.columns*unit*100)/100,variant=VARIANTS[i];
   out.push({version:VERSION,mainDecisionKey:hashString(sourceSignature(coupons,mainCoupon)),meeting:key(fs[0].r),date:fs[0].r.race_date,hippodrome:fs[0].r.hippodrome,altili_no:Number(fs[0].r.altili_no)||1,n,variant,product:PRODUCT[n],pools:best.pools,columns:best.columns,unit,cost,minBudget,maxBudget,ticketBudgetTL,budgetScope:'PER_TICKET',portfolioMinBudget:MIN_TL[n],portfolioMaxBudget:LIMIT_TL[n],belowMinimum:cost<minBudget,overBudget:cost>maxBudget+.001,coverageRelaxed:best.coverageRelaxed,singleAudit:best.audit,coverageAudit:fs.map((f,j)=>coverageEvidence(f,best.pools[j],mainCoupon)),refs:fs.map(f=>({id:f.r.id,file_id:f.r.file_id,leg:Number(f.r.leg),race_start_at:start(f.r)}))});
  });
  const productTickets=out.slice(productStart),portfolioBudgetTL=ticketBudgetTL*productTickets.length;
  if(Number.isFinite(portfolioBudgetTL)){const protectedTickets=protectPortfolio(fs,productTickets,portfolioBudgetTL);protectedTickets.forEach((t,i)=>{t.portfolioBudgetTL=portfolioBudgetTL;t.portfolioMinBudget=MIN_TL[n]*productTickets.length;t.portfolioMaxBudget=LIMIT_TL[n]*productTickets.length;t.coverageAudit=fs.map((f,j)=>coverageEvidence(f,t.pools[j],mainCoupon));out[productStart+i]=t;});}
 }
 return out;
}
function fingerprint(t){const fields=[t.version,t.meeting,t.n,t.variant,t.pools,t.refs,t.unit,t.columns,t.cost,t.captured_at,t.sourceSnapshot,t.singleAudit,t.evidence_class,t.acceptance_policy,t.source_created_at,t.record_origin,t.coverageAudit,t.minBudget,t.maxBudget];if(Number(t.normal_time_collection)===1)fields.push('NORMAL_TIME_COLLECTION');else if(Number(t.late_collection_accepted)===1)fields.push('LATE_RESULT_FREE_ACCEPTED');if(t.mainDecisionKey!=null)fields.push(t.mainDecisionKey);if(t.portfolioBudgetTL!=null)fields.push(t.portfolioBudgetTL);if(t.ticketBudgetTL!=null)fields.push('PER_TICKET_BUDGET',t.ticketBudgetTL);if(t.coverageGuardAudit)fields.push(t.coverageGuardAudit);return hashString(JSON.stringify(fields));}
function valid(t){return VERSIONS.includes(t?.version)&&t.hash===fingerprint(t)&&t.refs?.length===t.n&&t.pools?.length===t.n&&(t.evidence_class==='USER_ACCEPTED'&&t.acceptance_policy===g.TKP_RECORD_ACCEPTANCE?.VERSION||t.normal_time_collection===1||t.late_collection_accepted===1||t.refs.every(r=>Date.parse(t.captured_at)<Date.parse(r.race_start_at)))&&t.cost>0;}
function capture(rows,main,snapshot,options={}){
 const d=database(),accepted=g.TKP_RECORD_ACCEPTANCE?.snapshot(snapshot),lateAccepted=g.tkpLateResultFreeSnapshot?.(snapshot)===true;if(!d||!accepted&&!lateAccepted&&(Number(snapshot?.pre_race_only)!==1||Number(snapshot?.snapshot_time_verified)!==1||Number(snapshot?.backtest_eligible)!==1||snapshot.manual_adjustment||snapshot.post_collection_reconstruction))return 0;
 const now=options.now||new Date().toISOString();
 if(!accepted&&!lateAccepted&&(rows||[]).some(x=>(x.r?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0)))return 0;
 const tickets=build(rows,main);let added=0;
 d.settings=d.settings||{};d.settings.short_ganyan=d.settings.short_ganyan||{version:VERSION,records:[]};d.settings.short_ganyan.version=VERSION;d.settings.short_ganyan.records=d.settings.short_ganyan.records||[];const records=d.settings.short_ganyan.records;
 for(const t of tickets){if(t.overBudget)continue;const id=[VERSION,t.meeting,t.n,t.variant,t.mainDecisionKey,t.ticketBudgetTL].join('|');if(records.some(r=>r.id===id)||!accepted&&!lateAccepted&&t.refs.some(r=>!(Date.parse(now)<Date.parse(r.race_start_at))))continue;
  const early=t.refs.every(r=>Date.parse(now)<Date.parse(r.race_start_at));
  const row={...t,id,captured_at:now,sourceSnapshot:String(snapshot.id||''),source_created_at:String(snapshot.created_at||''),record_origin:'CALCULATED_ON_CAPTURE',evidence_class:early||lateAccepted?'LIVE_PRE_RACE_LOCKED':'USER_ACCEPTED',normal_time_collection:lateAccepted?1:0,acceptance_policy:accepted?g.TKP_RECORD_ACCEPTANCE.VERSION:null};row.hash=fingerprint(row);records.push(row);added++;
 }
 if(added){g.tkpPersistTopLevelMetaSoon?.({settings:d.settings},'short-ganyan-capture');g.tkpInvalidateFastBacktestCache?.();g.tkpScheduleCurrentBacktestRefresh?.();}return added;
}
function outcome(t,races){
 if(!valid(t))return {known:false,invalid:true};
 const rr=t.refs.map(ref=>races.find(r=>String(r.id)===String(ref.id)&&key(r)===t.meeting&&Number(r.leg)===ref.leg));
 if(rr.some(r=>!r||r.result_integrity_status!=='VERIFIED'))return {known:false};
 const winners=rr.map(r=>(r.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1));if(winners.some(w=>w.length!==1))return {known:false};
 const hit=winners.every((w,i)=>t.pools[i].some(no=>group(no)===group(w[0].horse_no)));
 const entries=(rr[rr.length-1].payouts||[]).filter(e=>e.key===t.product&&!e.rollover&&Number.isFinite(Number(e.amount))&&Number(e.amount)>0).filter(e=>{
  const combos=String(e.combo||'').split('/');return combos.length===t.n&&combos.every((part,i)=>part.split(',').some(no=>String(no).trim()===String(winners[i][0].horse_no).replace(/-E\d+$/i,'')));
 });
 return {known:true,hit,payoutKnown:entries.length>0,return:hit?entries.reduce((n,e)=>n+Number(e.amount),0):0};
}
function singleOutcome(t,races){
 const audit=t?.singleAudit,horseNo=String(audit?.horseNo||''),leg=Number(audit?.leg);
 if(!horseNo||!Number.isInteger(leg)||leg<1||!Array.isArray(t?.refs))return null;
 const ref=t.refs.find(x=>Number(x.leg)===leg),race=ref&&races.find(r=>String(r.id)===String(ref.id)&&key(r)===t.meeting&&Number(r.leg)===leg);
 if(!race||race.result_integrity_status!=='VERIFIED')return null;
 const winners=(race.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);
 if(winners.length!==1)return null;
 return group(horseNo)===group(winners[0].horse_no);
}
function metrics(d=database(),options={}){
 const stats=[];for(const n of [5,4,3])for(const variant of VARIANTS){
  const m={n,variant,tested:0,hits:0,pending:0,invalid:0,financial:0,testedCost:0,cost:0,return:0,historyTested:0,historyHits:0,historyFinancial:0,historyCost:0,historyReturn:0,liveTested:0,liveHits:0,liveFinancial:0,liveCost:0,liveReturn:0,singles:0,singleHit:0},seen=new Set(),meetings=new Set();
  const records=store(d).filter(t=>VERSIONS.includes(t.version)).slice().sort((a,b)=>String(b?.captured_at||'').localeCompare(String(a?.captured_at||'')));
  const outside=t=>options.from&&t.date<options.from||options.to&&t.date>options.to||options.before&&t.date>=options.before;
  for(const t of records){const identity=[t.meeting,t.n,t.variant].join('|');if(t.n!==n||t.variant!==variant||seen.has(identity)||outside(t))continue;seen.add(identity);
   const e=outcome(t,d.races||[]);if(e.invalid){m.invalid++;continue;}if(!e.known){m.pending++;continue;}m.tested++;m.testedCost+=Number(t.cost)||0;meetings.add(t.meeting);m.hits+=Number(e.hit);const matchedLive=t.evidence_class==='LIVE_PRE_RACE_LOCKED'&&t.budgetScope==='PER_TICKET'&&Math.abs(Number(t.ticketBudgetTL)-budgetFor(n))<.001&&Number(t.cost)>=Number(t.minBudget)-.001&&Number(t.cost)<=Number(t.maxBudget)+.001;if(matchedLive){m.liveTested++;m.liveHits+=Number(e.hit);}if(variant!=='teksiz'){const singleHit=singleOutcome(t,d.races||[]);if(singleHit!==null){m.singles++;m.singleHit+=Number(singleHit);}}if(e.payoutKnown){m.financial++;m.cost+=t.cost;m.return+=e.return;if(matchedLive){m.liveFinancial++;m.liveCost+=Number(t.cost)||0;m.liveReturn+=Number(e.return)||0;}}
  }
  for(const t of history()?.records||[]){const identity=[t.meeting,t.n,t.variant].join('|');if(t.n!==n||t.variant!==variant||seen.has(identity)||outside(t)||typeof t.hit!=='boolean'||!(Number(t.cost)>0))continue;seen.add(identity);meetings.add(t.meeting);m.tested++;m.historyTested++;m.hits+=Number(t.hit);m.historyHits+=Number(t.hit);m.testedCost+=Number(t.cost);if(t.payoutKnown===true&&Number.isFinite(Number(t.return))&&Number(t.return)>=0){m.financial++;m.cost+=Number(t.cost);m.return+=Number(t.return);m.historyFinancial++;m.historyCost+=Number(t.cost);m.historyReturn+=Number(t.return);}}
  m.meetings=meetings.size;m.roi=m.cost?(m.return-m.cost)/m.cost*100:null;stats.push(m);
 }return stats;
}
function wilsonLower(hits,total){const n=Number(total)||0;if(!n)return 0;const p=(Number(hits)||0)/n,z=1.96,z2=z*z;return (p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/(1+z2/n);}
function provenForPlay(m){return Number(m?.liveTested)>=150&&Number(m?.liveFinancial)>=150&&Number(m?.liveCost)>0&&((Number(m.liveReturn)-Number(m.liveCost))/Number(m.liveCost))*100>=0&&wilsonLower(m.liveHits,m.liveTested)>=.25;}
function singleTicketRecommendation(stats=[]){
 const proven=(stats||[]).filter(provenForPlay).sort((a,b)=>((Number(b.liveReturn)-Number(b.liveCost))/Number(b.liveCost))-((Number(a.liveReturn)-Number(a.liveCost))/Number(a.liveCost))||wilsonLower(b.liveHits,b.liveTested)-wilsonLower(a.liveHits,a.liveTested));
 if(proven.length){const m=proven[0],roi=(m.liveReturn-m.liveCost)/m.liveCost*100;return {label:'OYNA',n:m.n,variant:m.variant,roi,sample:m.liveTested,rate:m.liveHits/m.liveTested,reason:'En az 150 kilitli, güncel kupon bütçeli ve resmî sonuçlu örnekte ROI pozitif; Wilson alt sınırı %25 üzerinde.'};}
 const archived=(stats||[]).filter(m=>Number(m.historyTested)>0).sort((a,b)=>wilsonLower(b.historyHits,b.historyTested)-wilsonLower(a.historyHits,a.historyTested)||(b.historyHits/b.historyTested)-(a.historyHits/a.historyTested)||((b.historyReturn-b.historyCost)-(a.historyReturn-a.historyCost))),live=(stats||[]).filter(m=>Number(m.liveTested)>0).sort((a,b)=>wilsonLower(b.liveHits,b.liveTested)-wilsonLower(a.liveHits,a.liveTested)||(b.liveHits/b.liveTested)-(a.liveHits/a.liveTested)),best=archived[0]||null,preferred=live[0]||best;
 if(preferred)return {label:'TERCİH',n:preferred.n,variant:preferred.variant,preferredRate:live[0]?preferred.liveHits/preferred.liveTested:preferred.historyHits/preferred.historyTested,preferredSample:live[0]?preferred.liveTested:preferred.historyTested,preferenceSource:live[0]?'güncel bütçeli kilitli kayıt':'arşiv isabet karşılaştırması',bestArchive:best?{n:best.n,variant:best.variant,hits:best.historyHits,tested:best.historyTested,rate:best.historyHits/best.historyTested,roi:best.historyCost?(best.historyReturn-best.historyCost)/best.historyCost*100:null}:null,reason:'En güçlü isabet alternatifi tek tercih olarak gösterilir; yeterli pozitif ROI kanıtı yoksa OYNA anlamına gelmez.'};
 return {label:'PAS',bestArchive:null,reason:'Karşılaştırılabilir sonuç örneği yok; tercih üretmek için veri yetersiz.'};
}
function decision(m,recommendation=null){
 const n=Number(m?.tested)||0,hits=Number(m?.hits)||0,rate=n?hits/n:0,z=1.96,zz=z*z;
 const lower=n?(rate+zz/(2*n)-z*Math.sqrt(rate*(1-rate)/n+zz/(4*n*n)))/(1+zz/n):0;
 // Her kupon OYNA veya PAS taşır; hiçbiri OYNA değilse en güçlü kupon TERCİH
 // yazısı alır. Rozet çizici OYNA dışını PAS gösterdiğinden rozet PAS kalır.
 const same=recommendation&&Number(recommendation.n)===Number(m?.n)&&String(recommendation.variant)===String(m?.variant),label=same?recommendation.label:provenForPlay(m)?'OYNA':'PAS';
 const stat=n?`İsabet %${Math.round(rate*100)} · Wilson %${Math.round(lower*100)} · n=${n}`:'İstatistik bekleniyor · n=0',source=m?.roi!=null?' · ROI %'+money(m.roi):' · Resmî ikramiye örneği bekleniyor';
 return {label,summary:(label==='TERCİH'?'TERCİH · En güçlü kupon · ':'')+stat,reason:(label==='OYNA'?'Kilitli sonuçlarda OYNA eşiğini geçti':label==='TERCİH'?'Hepsi PAS; bugünün en güçlü seçeneği, kârlı OYNA eşiğini geçmedi':'Kârlı OYNA eşiğini geçmedi')+source};
}
function backtestHTML(d=database()){
 const rows=metrics(d).map(m=>`<tr><td>${title(m.n)} · ${variantLabel(m.variant)}</td><td>${m.tested}</td><td>${m.hits}</td><td>${m.tested?'%'+Math.round(100*m.hits/m.tested):'Veri yok'}</td><td>${m.pending}</td><td>${m.financial}</td><td>${money(m.cost)} TL</td><td>${money(m.return)} TL</td><td>${m.roi==null?'—':'%'+money(m.roi)}</td><td>${m.invalid}</td></tr>`).join('');
 const decision=singleTicketRecommendation(metrics(d)),omission=budgetOmissionLearning(d),best=decision.bestArchive;
 const oneBet=decision.label==='OYNA'?`OYNA · ${title(decision.n)} ${variantLabel(decision.variant)} · ROI %${money(decision.roi)} · n=${decision.sample} güncel bütçe ile kilitli sonuç`:decision.label==='TERCİH'?`TERCİH · ${title(decision.n)} ${variantLabel(decision.variant)} · isabet %${money(decision.preferredRate*100)}, n=${decision.preferredSample} (${decision.preferenceSource}); pozitif ROI kanıtı yok, PAS da seçilebilir.${best?` Arşiv ROI %${money(best.roi)}.`:''}`:'PAS · Sonuç örneği olmadığı için tercih üretilemedi.';
 const omissionText=omission.sample?`Altılı bütçesi nedeniyle dışarıda kalan kısa ganyan adayları: ${omission.sample} at/ayak · ${omission.wins} kazanan · ${omission.top3} ilk üç · kısa ganyana taşınıp kazananı kurtaran ${omission.rescuedWins}. Bu ölçüm yalnız güncel sürümün kilitli kayıtları ve doğrulanmış resmî sonuçlardır.`:'Altılı bütçesi nedeniyle dışarıda kalan atların at/ayak bazlı sonuç takibi yeni kilitli kuponlarla başlayacak. Eski arşiv özeti at listelerini saklamadığı için eski kuponlara sonuçtan bakarak aday eklenmedi.';
 return '<div class="card" data-short-ganyan-backtest><h2>5-4-3’LÜ GANYAN · Kupon Back Test</h2><p class="muted">Her bülten için tek kısa ganyan önerisi değerlendirilir; kârlı ve yeterli yarış-öncesi örnek yoksa PAS verilir. ROI yalnız resmî ikramiye eşleştiğinde hesaplanır.</p><p><strong>Günün tek kupon kararı:</strong> '+oneBet+'</p><div class="tableWrap compactBacktest"><table data-tkp-sort="preserve"><thead><tr><th>Kupon</th><th>Test</th><th>Tuttu</th><th>İsabet</th><th>Bekleyen</th><th>Resmî</th><th>Maliyet</th><th>İkramiye</th><th>ROI</th><th>Geçersiz</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="muted">'+omissionText+'</p></div>';
}
function comparisonHTML(n){
 const comparisons=(history()?.comparisons||[]).filter(s=>s.n===n);if(!comparisons.length)return '';
 const rows=comparisons.map(s=>`<tr><td>${s.cap==='infinite'?'∞':money(s.cap)+' TL'}</td><td>${s.all.hits}/${s.all.tested} · %${money(s.all.rate*100)}</td><td>${s.all.roi==null?'—':'%'+money(s.all.roi)}</td><td>${money(s.all.testedCost)} TL</td></tr>`).join('');
 return `<details class="shortGanyanAudit"><summary>Bütçe / ROI karşılaştırması</summary><p>Arşiv tekrarı · Güncel motorla her satırda aynı ${comparisons[0].all.tested} toplantı kupon başı tavanla ölçülmüştür. Portföy isabeti: kuponlardan en az biri ${n}/${n}. ROI, resmî ikramiyeli ${comparisons[0].all.financial} toplantıda; maliyet tüm test kuponları için hesaplanır.</p><div class="tableWrap"><table><thead><tr><th>Kupon başı tavan</th><th>Portföy ${n}/${n}</th><th>ROI</th><th>Maliyet</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function panel(rows,main=null){
 const d=database(),meeting=rows?.[0]?.r?key(rows[0].r):'';
 const supplied=main?.coupons||(main?.main||main?.alt||main?.surprise?main:{main}),current=supplied?.main||supplied;
 const sources=(d?.auto_coupon_log||[]).filter(s=>[s.race_date,String(s.hippodrome).toLocaleUpperCase('tr-TR'),Number(s.altili_no)||1].join('|')===meeting&&g.TKP_RECORD_ACCEPTANCE?.snapshot(s)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
 const source=Array.isArray(current?.legs)&&current.legs.length===6&&!current.error?sources.find(s=>mainSignature(s.coupons?.main)===mainSignature(current)):sources[0];
 const canonicalMain=sourceMainCoupon(source,main);
 const couponSet={main:canonicalMain,alt:supplied?.alt||source?.coupons?.alt,surprise:supplied?.surprise||source?.coupons?.surprise};
 if(source)capture(rows,couponSet,source);
 const decisionKey=hashString(sourceSignature(couponSet,canonicalMain)),seenTickets=new Set(),saved=store(d).filter(t=>t.meeting===meeting&&t.version===VERSION&&t.mainDecisionKey===decisionKey&&t.ticketBudgetTL===budgetFor(t.n)&&valid(t)).sort((a,b)=>String(b.captured_at).localeCompare(String(a.captured_at))).filter(t=>{const k=t.n+'|'+t.variant;if(seenTickets.has(k))return false;seenTickets.add(k);return true;}),generated=build(rows,couponSet);
 const tickets=[5,4,3].flatMap(n=>{const recorded=VARIANTS.map(v=>saved.find(t=>t.n===n&&t.variant===v));return recorded.every(Boolean)?recorded:generated.filter(t=>t.n===n);});
 const stats=metrics(d,{before:rows?.[0]?.r?.race_date}),recommendation=singleTicketRecommendation(stats),omission=budgetOmissionLearning(d,rows?.[0]?.r?.race_date);
  const archivedBest=recommendation.bestArchive,decisionText=recommendation.label==='OYNA'?`OYNA · ${title(recommendation.n)} ${variantLabel(recommendation.variant)} · ROI %${money(recommendation.roi)} · n=${recommendation.sample} kilitli güncel bütçe sonucu · Kupon tavanı ${money(LIMIT_TL[recommendation.n])} TL`:recommendation.label==='TERCİH'?`TERCİH · ${title(recommendation.n)} ${variantLabel(recommendation.variant)} · isabet %${money(recommendation.preferredRate*100)}, n=${recommendation.preferredSample} (${recommendation.preferenceSource}). ROI kanıtı OYNA eşiğinde değil; istersen PAS seç.`:`PAS · Sonuç örneği yok; tercih üretilemedi.`;
 const omissionText=omission.sample?`Önceki günlerden öğrenme: Altılı bütçe dışı ${omission.sample} aday · ${omission.wins} kazanan · ${omission.top3} ilk üç · kısa ganyanla kurtarılan ${omission.rescuedWins} kazanan.`:'Altılı bütçe dışı atların at/ayak sonuç takibi yeni kilitli yarış öncesi kuponlardan başlayacak.';
  const recommendationCard=`<div class="card shortGanyanDailyDecision" style="border-left:5px solid ${recommendation.label==='OYNA'?'#16a34a':recommendation.label==='TERCİH'?'#d97706':'#dc2626'};margin:8px 0"><h3 style="margin:0 0 5px">Günün tek kısa ganyan önerisi: ${recommendation.label}</h3><p style="margin:0">${decisionText}</p><p class="muted" style="margin:5px 0 0">${omissionText} Altılıda bütçe nedeniyle dışarıda kalan adaylar kısa havuzda öncelik alır; 5’li, 4’lü ve 3’lü kuponların kendi tavanları aşılmaz.</p></div>`;
 const card=t=>{const e=t.hash?outcome(t,d.races||[]):null,label=t.hash?'Geçerli kupon kaydı':'Önizleme · Altılı kuponu kaydedilince kilitlenir',metric=stats.find(m=>m.n===t.n&&m.variant===t.variant),budgetNote=t.belowMinimum?'ALT BÜTÇE · kupon yine görünür':'';
  if(typeof g.couponVariantCompactHTML==='function'){
   const legs=t.pools.map((p,i)=>{const x=(rows||[]).find(x=>Number(x.r.leg)===t.refs[i].leg),r=x?.r||{};
    return {r,x,allHorses:r.horses||[],selectionOrderNos:p,picks:p.map(no=>(r.horses||[]).find(h=>String(h.horse_no)===no)).filter(Boolean),singleSelectionAudit:p.length===1?{top3Policy:t.singleAudit}:null};
   });
    const quote={typeKey:'short_'+t.n+'_'+t.variant,shortGanyan:true,readOnlySnapshot:true,legs,legCount:t.n,unit:t.unit,cost:t.cost,combos:t.columns,budgetTL:t.maxBudget,algorithmVersion:t.version,decisionSnapshot:t.overBudget?null:decision(metric,recommendation)};
   return '<div class="shortGanyanCouponItem">'+g.couponVariantCompactHTML(quote,title(t.n)+' Ganyan · '+variantLabel(t.variant))+'</div>';
  }
  const pools=t.pools.map((p,i)=>{const race=(rows||[]).find(x=>Number(x.r.leg)===t.refs[i].leg)?.r;
   return typeof g.sideBetPoolHTML==='function'?g.sideBetPoolHTML(t.refs[i].leg+'. AYAK',p,race?.horses,null,true):`<div class="sideBetPool"><b>${t.refs[i].leg}. AYAK</b> ${esc(p.join(', '))}</div>`;
  }).join('');
  const status=e?.known?`<span class="sideBetResult ${e.hit?'hit':'miss'}">${e.hit?'TUTTU':'TUTMADI'}</span>`:'<span class="sideBetReady">BEKLİYOR</span>';
  const additions=(t.coverageAudit||[]).filter(a=>a.addedOutsideSixfold.length).map(a=>`${a.leg}. ayak: ${a.addedOutsideSixfold.join(', ')}`).join(' / ');
  return `<div class="shortGanyanCouponItem"><div class="sideBetTicketCard"><div class="sideBetTicketHead"><h4>${title(t.n)} Ganyan · ${variantLabel(t.variant)}</h4><span class="sideBetMiniStat">${metric.hits}/${metric.tested}</span></div><p class="muted">${label}</p>${budgetNote?`<p class="muted">${budgetNote}</p>`:''}<div class="sideBetPools">${pools}</div><div class="sideBetTicketMeta"><span class="sideBetCost">${t.columns} kolon · ${money(t.cost)} TL</span>${status}</div>${e?.known&&e.payoutKnown?`<div class="sideBetFinance ${e.hit?'hit':'miss'}">İkramiye: ${money(e.return)} TL · Net: ${money(e.return-t.cost)} TL</div>`:''}</div></div>`;
 };
 const groups=[5,4,3].map(n=>{
  const ts=tickets.filter(t=>t.n===n);
  const cards=VARIANTS.map(v=>{const t=ts.find(x=>x.variant===v);if(t)return card(t);const reason=v==='teksiz'?'Altılı seçimleri aktif koşu atlarıyla eşleşmedi; veri eksiği nedeniyle kupon kurulamadı.':'Bu varyant için Altılı ana kuponunda AGF ilk üç koşulunu sağlayan ayrı tek ayağı yok; yeni tek uydurulmadı.';return `<div class="shortGanyanCouponItem"><div class="sideBetTicketCard"><div class="sideBetTicketHead"><h4>${title(n)} Ganyan · ${variantLabel(v)}</h4><span class="sideBetReady">ÜRETİLMEDİ</span></div><p class="muted">${reason}</p></div></div>`;}).join('');
 const audit=ts.map(t=>`<h4>${variantLabel(t.variant)}</h4>${t.coverageGuardAudit?`<p>Korunan kapsam: ${Number(t.coverageGuardAudit.baseColumns)||0} kombinasyon · Mevcut at çıkarılmadı · ${(t.coverageGuardAudit.moves||[]).length} destekli ekleme.</p>`:''}${t.singleAudit?`<p>${t.singleAudit.leg}. ayak · ${esc(t.singleAudit.horseNo)} no · ${t.singleAudit.reliabilitySource==='HISTORICAL_TOP3_COMPARISON'?'Geçmiş karşılaştırma, n='+t.singleAudit.sample:'Model olasılığı; yeterli geçmiş örneği yok'}</p>`:''}<ul>${(t.coverageAudit||[]).map(a=>`<li>${a.leg}. AYAK · Altılı: ${esc((a.sixfoldPicks||[]).join(', '))} · AGF ilk ${a.agfCount||5}: ${esc((a.agfCandidates||[]).join(', ')||'—')} · BH: ${esc((a.bh||[]).join(', ')||'—')} · Özel/ODB/BMB: ${esc((a.special||[]).join(', ')||'—')} · TR/ganyan: ${esc((a.trCandidates||[]).join(', ')||'—')} · Kupona eklenen: ${esc((a.addedOutsideSixfold||[]).join(', ')||'—')}${a.omittedFromSixfold?.length?' · Altılı kuponundan kısa oyunda dışarıda: '+esc(a.omittedFromSixfold.join(', ')):''}${a.budgetOmittedCandidates?.length?' · Altılı bütçe dışı: '+esc(a.budgetOmittedCandidates.map(c=>`${c.horseNo} (#${c.mainRank})`).join(', '))+' · Taşınan: '+esc(a.budgetOmittedIncluded?.join(', ')||'—')+(a.budgetOmittedNotIncluded?.length?' · Bu kısa kupon tavanında sığmadı: '+esc(a.budgetOmittedNotIncluded.join(', ')):''):''}</li>`).join('')}</ul>`).join('');
  const cost=ts.reduce((sum,t)=>sum+t.cost,0);
  return `<div class="card" data-short-product="${n}"><h3>${title(n)} Ganyan · ${ts.length} kupon</h3><p class="muted">Toplam (${ts.length} kupon): ${money(cost)} TL · Kupon başı bütçe aralığı: ${money(MIN_TL[n])}–${money(LIMIT_TL[n])} TL · Kupon başı tavan: ${money(budgetFor(n))} TL${ts.some(t=>t.belowMinimum)?' · Alt bütçenin altında: '+ts.filter(t=>t.belowMinimum).map(t=>variantLabel(t.variant)).join(', '):''}</p><div class="budgetCouponTriple">${cards}</div>${audit?'<details class="shortGanyanAudit"><summary>Seçim ayrıntıları</summary>'+audit+'</details>':''}${comparisonHTML(n)}</div>`;
 }).join('');
 return '<div data-short-ganyan-panel><div class="card"><h2>5-4-3’LÜ GANYAN</h2><p>Kısa ganyan, Altılı ana kuponundaki atları kupon tavanı içinde korur; bütçe nedeniyle dışarıda kalanları ve AGF ilk 5’i (Altılı ayağında 4+ at varsa ilk 6), BH, ODB/BMB/özel işaret ve güvenilir TR ganyan adaylarını havuzda önceliklendirir. Havuz genişliği, bu aday sırası ve kupon bütçesiyle belirlenir. Bütçe aralıkları kupon başınadır: 5’li 1.000–2.000 TL, 4’lü 500–1.000 TL, 3’lü 250–500 TL. Tavan kesindir, aşan kupon üretilmez; tavana sığmayan Altılı atları seçim ayrıntılarında yazılır. Bütçe altındaki geçerli kuponlar da görünür. Üretilen tüm kuponlar ve üretilemeyen TEK varyantlarının nedeni ayrı kartlarda görünür; her kupon OYNA veya PAS gösterir, hiçbiri OYNA değilse en güçlü kupona PAS · TERCİH yazılır.</p></div>'+recommendationCard+groups+'</div>';
}
g.TKP_SHORT_GANYAN=Object.freeze({VERSION,MIN_TL,LIMIT_TL,VARIANTS,variantLabel,budgetFor,decision,build,capture,metrics,outcome,budgetOmissionLearning,singleTicketRecommendation,panel,backtestHTML});
})(globalThis);
