(function(g){
'use strict';
const VERSION='R16.80-POLICY-OVERVIEW-SINGLES-2';
const roles=['main','alt','surprise'];
const names={main:'Normal · ortak kazanma kapsamı',alt:'Sürpriz · destekli alternatif senaryo',surprise:'Uzman + Kulis · doğrulanmış yorumcu desteği'};
const no=h=>String(h?.horse_no??h??'');
const key=h=>{const n=no(h),tag=h?.ekuri_group||(typeof g.ekuriGroup==='function'?g.ekuriGroup(n):n.match(/-(E\d+)$/i)?.[1]);return tag?'E:'+tag:'N:'+n;};
const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const clone=x=>JSON.parse(JSON.stringify(x));
function poolFor(leg){
 const source=leg.ordered?.length?leg.ordered:leg.allHorses?.length?leg.allHorses:leg.r?.horses||[];
 const merged=new Map();for(const h of [...source,...(leg.r?.horses||[])])if(h&&!merged.has(no(h)))merged.set(no(h),h);
 const grouped=new Map();let index=0;
 for(const h of merged.values()){
  if(typeof g.isNonRunner==='function'&&g.isNonRunner(h))continue;
  const k=key(h),p=known(h.tkp_probability)?Math.max(0,Number(h.tkp_probability)):known(h.score)?Math.max(0,Number(h.score)):0;
  const market=known(h.agf)?Math.max(0,Number(h.agf)):null;
  if(grouped.has(k)){const row=grouped.get(k);row.marketKnown&&=market!==null;row.market+=(market||0);row.mass+=p;row.members.push(no(h));if(p>row.best){row.h=h;row.best=p;}}
  else grouped.set(k,{key:k,h,market:market||0,marketKnown:market!==null,mass:p,best:p,rank:++index,members:[no(h)]});
 }
 const rows=[...grouped.values()],sum=rows.reduce((s,r)=>s+r.market,0);
 rows.forEach(r=>r.marketShare=sum?r.market/sum:0);
 const market=rows.slice().sort((a,b)=>b.market-a.market||a.rank-b.rank);
 market.forEach((r,i)=>r.marketRank=i+1);
 return {rows,market,completeMarket:rows.length>0&&rows.every(r=>r.marketKnown)&&sum>0};
}
function commentPriority(r,h){
 try{
  const c=g.tkpCommentatorConsensus?.(r,h),authors=new Map();
  for(const row of c?.comments||[]){
   if(!(Number(row.events)>0&&Number(row.edge)>0&&Number(row.direction)>0))continue;
   const author=String(row.author||'').trim().toLocaleLowerCase('tr-TR');if(!author)continue;
   const bitalih=/bitalih/i.test(String(row.source||'').replace(/[^a-z]/gi,''));
   const reliability=Number(row.events)/(Number(row.events)+40);
   const value=Math.max(0,Number(row.edge))*reliability*(bitalih?1.25:1);
   const item={author,source:row.source,events:Number(row.events),edge:Number(row.edge),bitalih,value};
   if(!authors.has(author)||authors.get(author).value<value)authors.set(author,item);
  }
  const details=[...authors.values()];return {score:Math.min(1,details.reduce((s,x)=>s+x.value,0)),authors:details};
 }catch(_){return {score:0,authors:[]};}
}
function kulisEvidence(r,h){
 try{const c=g.tkpCommentatorConsensus?.(r,h);return c?.available?{ratio:Number(c.ratio)||0,authors:Number(c.positive)||0,
  supported:(c.comments||[]).some(x=>Number(x.events)>=20&&Number(x.edge)>0),single:c.single_eligible===true}:null;}catch(_){return null;}
}
function exception(r,h){
 const c=kulisEvidence(r,h);
 // The consensus API only exposes integrity-checked LIVE_PRE_RACE_LOCKED events.
 return c&&c.authors>=2&&c.ratio>=.6&&c.supported?{code:'VERIFIED_KULIS',authors:c.authors,ratio:c.ratio}:null;
}
function distinct(picks){const seen=new Set();return (picks||[]).filter(h=>{const k=key(h);if(seen.has(k))return false;seen.add(k);return true;});}
function enforce(built){
 for(const role of roles){
  const c=built?.[role];if(!c||c.error||c.readOnlySnapshot||c.policyAudit?.version===VERSION)continue;
  const audits=[];
  for(const leg of c.legs||[]){
   const p=poolFor(leg),original=leg.picks||[],target=original.length,changes=[];
   let picks=distinct(original);
   for(const row of p.rows){if(picks.length>=target)break;if(!picks.some(h=>key(h)===row.key))picks.push(row.h);}
   if(picks.length!==original.length||new Set(original.map(key)).size!==original.length)changes.push({code:'EKURI_SINGLE_BET',before:original.map(no),after:picks.map(no)});
   const anchors=p.completeMarket&&picks.length>1?p.market.slice(0,2).filter(r=>r.marketShare>=.10):[];
   for(const anchor of anchors){
    if(picks.some(h=>key(h)===anchor.key))continue;
    const replaceable=picks.map((h,i)=>({h,i,row:p.rows.find(z=>z.key===key(h)),exception:exception(leg.r,h)}))
      .filter(z=>!anchors.some(a=>a.key===key(z.h))&&!z.exception)
      .sort((a,b)=>(a.row?.market||0)-(b.row?.market||0)||(b.row?.rank||0)-(a.row?.rank||0));
    if(replaceable.length){const slot=replaceable[0];changes.push({code:'MARKET_ANCHOR_RESTORED',added:no(anchor.h),removed:no(slot.h),marketRank:anchor.marketRank});picks[slot.i]=anchor.h;}
   }
   leg.picks=picks;
   const selected=new Set(picks.map(key));
   const excluded=p.rows.filter(r=>!selected.has(r.key)).map(r=>({no:no(r.h),key:r.key,modelRank:r.rank,marketRank:r.marketRank,
    marketPct:r.marketKnown?r.market:null,reason:picks.length===1?'TEK_BUDGET':anchors.some(a=>a.key===r.key)?'VERIFIED_KULIS_OVERRIDE':'COVERAGE_BUDGET'}));
   const selectedKulis=picks.map(h=>({no:no(h),evidence:kulisEvidence(leg.r,h),priority:commentPriority(leg.r,h)})).filter(x=>x.evidence);
   const eligibility=picks.length===1&&g.TKP_COUPON_COVERAGE?.singleEligibility
    ?g.TKP_COUPON_COVERAGE.singleEligibility(leg,picks[0],role):null;
   const single=picks.length===1?{no:no(picks[0]),label:eligibility?.strong?'Genel Bakış tek adayı':'Göreli tek adayı',calibrated:false,eligibility,
    reason:eligibility?.strong?'Genel Bakış lideri; olasılık, rakip farkı ve TEK güven kontrolünü geçti.':'1–2 tek şartı için Genel Bakış liderleri arasından olasılık, rakip farkı ve riskle seçildi; güçlü tek eşiği aşılmadı.'}:null;
   const audit={leg:Number(leg.r?.leg||leg.x?.r?.leg),width:picks.length,changes,excluded,
    input:p.rows.map(r=>({key:r.key,no:no(r.h),members:r.members,modelRank:r.rank,marketRank:r.marketRank,marketPct:r.marketKnown?r.market:null})),
    baseline:p.completeMarket?p.market.slice(0,picks.length).map(r=>r.key):null,single,kulis:selectedKulis};
   leg.policyAudit=audit;leg.selectionOrderNos=audit.input.map(h=>h.no);audits.push(audit);
  }
  c.combos=(c.legs||[]).reduce((n,l)=>n*l.picks.length,1);c.cost=Math.round(c.combos*Number(c.unit||1)*100)/100;
  c.leftover=Number(c.budgetTL||1400)-c.cost;
   const singles=(c.legs||[]).filter(l=>l.picks.length===1).length;
  const widths=(c.legs||[]).map(l=>l.picks.length);
  const twoHorseLegs=widths.filter(n=>n===2).length;
  const undersizedMultiLegs=widths.filter(n=>n>1&&n<3).length;
  const distributionValid=widths.length===6&&widths.every(n=>n>0)&&twoHorseLegs<=1&&undersizedMultiLegs<=twoHorseLegs;
  c.policyAudit={version:VERSION,role,objective:names[role],status:'MARKET_GUARDED',modelPromoted:false,
   singleCount:singles,cost:c.cost,legs:audits,
   distribution:{valid:distributionValid,widths,twoHorseLegs,maxTwoHorseLegs:1,minimumMultiWidth:3,undersizedMultiLegs}};
  const unsafeSingle=audits.some(a=>a.single?.eligibility?.ok===false);
  if(c.legs?.length===6&&(unsafeSingle||singles<1||singles>2||c.cost<1000||c.cost>1400||!distributionValid)){
   if(unsafeSingle){
    c.error='Genel Bakış lideri ve TEK güven kontrolü uyuşmadı; kupon yayımlanmadı.';
    c.policyAudit.status='UNSAFE_SINGLE';
    continue;
   }
   c.error=!distributionValid
    ?'2 atlı ayak en fazla bir tane, diğer çoklu ayaklar en az 3 at olmalı; kupon yayımlanmadı.'
    :'1–2 tek ve 1.000–1.400 TL denetimi geçilemedi; kupon yayımlanmadı.';
   c.policyAudit.status='CONTRACT_FAILED';
  }
 }
 return built;
}
function html(c){
 const a=c?.policyAudit;if(!a)return '';
 const esc=g.esc||((x)=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
 const rows=(a.legs||[]).map(l=>{
  const changes=l.changes.map(z=>z.code==='MARKET_ANCHOR_RESTORED'?`${z.added} eklendi, ${z.removed} çıkarıldı: güçlü piyasa adayı`:'Eküri tek bahis seçimi olarak düzeltildi');
  const omitted=l.excluded.filter(z=>z.marketRank<=3).map(z=>`${z.no}: ${z.reason==='TEK_BUDGET'?'bu ayak tek bırakıldı':z.reason==='VERIFIED_KULIS_OVERRIDE'?'doğrulanmış Kulis desteğiyle başka aday seçildi':'ayak kapsamı dışında'}`);
  const support=(l.kulis||[]).filter(k=>k.priority?.authors?.length).map(k=>`${k.no}: `+k.priority.authors.map(x=>`${x.source} / ${x.author} (${x.events} sonuçlu olay${x.bitalih?', Bi’Talih önceliği':''})`).join(', '));
  return `<li><b>${l.leg}. ayak · ${l.width===1?'Göreli tek':l.width+' seçim'}</b>${changes.length?' · '+esc(changes.join('; ')):''}${omitted.length?'<br>'+esc(omitted.join('; ')):''}${support.length?'<br>'+esc(support.join('; ')):''}</li>`;
 }).join('');
 return `<details class="couponPolicyAudit"><summary>Neden bu kupon? · seçim denetimi</summary><p>${esc(a.objective)}</p><p>Modelin AGF yöntemine üstünlüğü henüz doğrulanmadı. Tekler göreli adaydır.</p><ul>${rows}</ul></details>`;
}
function evaluateSnapshot(snapshot,races){
 if(!snapshot?.coupons)return null;
 const byLeg=new Map((races||[]).map(r=>[Number(r.leg),r]));const out={version:VERSION,roles:{}};
 for(const role of roles){
  const c=snapshot.coupons[role],a=c?.policyAudit;if(!a)continue;
  const results=[];
  for(const leg of c.legs||[]){
   const race=byLeg.get(Number(leg.leg)),audit=a.legs.find(x=>x.leg===Number(leg.leg));if(!audit)continue;
   const winners=(race?.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1).map(key);
   if(!winners.length){results.push({leg:leg.leg,known:false});continue;}
   const picks=(leg.picks||[]).map(n=>audit.input.find(h=>h.no===no(n))?.key||key(n));
   const hit=picks.some(k=>winners.includes(k)),baselineHit=audit.baseline?audit.baseline.some(k=>winners.includes(k)):null;
   const winner=audit.input.find(h=>winners.includes(h.key));
   const omitted=audit.excluded.find(h=>winners.includes(h.key));
   const cause=hit?'HIT':picks.length===1?'WRONG_SINGLE':!winner?'MISSING_INPUT':omitted?.reason==='VERIFIED_KULIS_OVERRIDE'?'KULIS_OVERRIDE_MISS':winner.marketRank<=2?'MARKET_LEADER_MISSED':winner.modelRank<=picks.length+1?'BUDGET_CUT':'MODEL_RANK';
   results.push({leg:leg.leg,known:true,hit,baselineHit,cause,winnerRank:winner?.modelRank||null,winnerMarketRank:winner?.marketRank||null});
  }
  const known=results.filter(r=>r.known),complete=known.length===6;
  out.roles[role]={complete,known:known.length,hits:known.filter(r=>r.hit).length,baselineHits:known.every(r=>r.baselineHit!==null)?known.filter(r=>r.baselineHit).length:null,legs:results};
 }
 return Object.keys(out.roles).length?out:null;
}
async function resolve(source){
 if(!source?.auto_coupon_log?.length)return {changed:0};
 const index=new Map();for(const r of source.races||[]){const k=[r.race_date||r.date,r.file_id].join('|');if(!index.has(k))index.set(k,[]);index.get(k).push(r);}
 const files=new Map((source.files||[]).map(f=>[String(f.id),f]));let changed=0;
 const totals={version:VERSION,live:{},historical:{},causes:{}};
 for(const snapshot of source.auto_coupon_log){
  if(!Object.values(snapshot.coupons||{}).some(c=>c?.policyAudit))continue;
  const groups=[...index.values()].filter(rows=>{
   const f=files.get(String(rows[0].file_id)),date=String(f?.race_date||rows[0].race_date||''),hip=String(f?.hippodrome||rows[0].hippodrome||'');
   return date===String(snapshot.race_date)&&hip===String(snapshot.hippodrome)&&Number(f?.altili_no||1)===Number(snapshot.altili_no||1);
  });
  if(groups.length!==1)continue;const evaluated=evaluateSnapshot(snapshot,groups[0]);if(!evaluated)continue;
  if(JSON.stringify(snapshot.policy_result)!==JSON.stringify(evaluated)){snapshot.policy_result=evaluated;changed++;}
  const target=Number(snapshot.snapshot_time_verified)===1&&Number(snapshot.pre_race_only)===1&&Number(snapshot.manual_adjustment)!==1?totals.live:totals.historical;
  for(const [role,r] of Object.entries(evaluated.roles)){
   for(const leg of r.legs)if(leg.known&&!leg.hit)totals.causes[leg.cause]=(totals.causes[leg.cause]||0)+1;
   if(!r.complete||r.baselineHits===null)continue;
   const t=target[role]||(target[role]={meetings:0,full:0,exactFive:0,baselineFull:0,modelOnly:0,baselineOnly:0});
   t.meetings++;t.full+=r.hits===6?1:0;t.exactFive+=r.hits===5?1:0;t.baselineFull+=r.baselineHits===6?1:0;
   t.modelOnly+=r.hits===6&&r.baselineHits!==6?1:0;t.baselineOnly+=r.hits!==6&&r.baselineHits===6?1:0;
  }
 }
 source.settings=source.settings||{};
 if(JSON.stringify(source.settings.coupon_policy_learning)!==JSON.stringify(totals)){source.settings.coupon_policy_learning=totals;changed++;}
 if(changed&&typeof g.tkpPersistCollections==='function')await g.tkpPersistCollections(['auto_coupon_log'],{metaPatch:{settings:source.settings},label:'coupon-policy-results'});
 return {changed,totals};
}
let timer=0;
if(typeof g.addEventListener==='function')g.addEventListener('tkp:db-changed',e=>{
 if(!e?.detail?.resultsChanged)return;
 clearTimeout(timer);timer=setTimeout(()=>resolve(g.db).catch(error=>console.warn('Kupon sonuç denetimi kaydedilemedi',error)),500);
});
g.TKP_COUPON_POLICY={version:VERSION,enforce,poolFor,html,evaluateSnapshot,resolve,key,commentPriority};
})(globalThis);
