/* Equal-cost, product-specific selection. Results are used only to resolve past tickets. */
(function(g){'use strict';
const VERSION='PRODUCT-HITS-V1',MODELS=['CURRENT','AGF','SCORE_AGF'];
const group=n=>String(n).match(/-E\d+$/i)?.[0].toUpperCase()||String(n);
const running=h=>h&&!['non_runner','is_non_runner','scratched','usa_scratched','atr_non_runner'].some(k=>Number(h[k])===1)&&!/(?:^|[\s(])(?:KOŞMAZ|KOSMAZ|START ALMADI|START ALMAZ|SCRATCHED|WITHDRAWN|DEKLARE DIŞI|DEKLARE DISI)(?:$|[\s)])/u.test(String(h.horse_name||'').toLocaleUpperCase('tr-TR'))&&!(typeof g.isNonRunner==='function'&&g.isNonRunner(h));
const copy=p=>p.map(a=>a.map(String));
function rank(rows,model){
 const hs=rows.filter(running),ag=hs.reduce((s,h)=>s+Math.max(0,Number(h.agf)||0),0),sc=hs.reduce((s,h)=>s+Math.max(0,Number(h.score??h.prediction_score_snapshot)||0),0);
 const value=h=>{const a=ag?Math.max(0,Number(h.agf)||0)/ag:0,s=sc?Math.max(0,Number(h.score??h.prediction_score_snapshot)||0)/sc:0;return model==='AGF'?a:Math.pow(s||1e-9,.65)*Math.pow(a||1e-9,.35);};
 return hs.slice().sort((a,b)=>value(b)-value(a)||String(a.horse_no).localeCompare(String(b.horse_no),undefined,{numeric:true}));
}
function remap(pools,rows,model,protectedNos=[]){
 if(model==='CURRENT')return copy(pools);
 if(!rows.some(h=>Number(h.agf)>0))return copy(pools);
 const protectedSet=new Set(protectedNos.map(String)),source=[...new Set(pools.flat().map(String).concat(rows.filter(running).map(h=>String(h.horse_no))))].filter(n=>!protectedSet.has(n));
 const target=rank(rows,model).map(h=>String(h.horse_no)).filter(n=>!protectedSet.has(n));
 if(source.length!==target.length||new Set(target).size!==target.length||source.some(n=>!target.includes(n)))return copy(pools);
 const map=new Map(source.map((n,i)=>[n,target[i]]));return pools.map(p=>p.map(n=>protectedSet.has(String(n))?String(n):map.get(String(n))));
}
function sixPool(picks,rows,model,protectedNos=[]){
 if(model==='CURRENT')return picks.map(String);
 if(!rows.some(h=>Number(h.agf)>0))return picks.map(String);
 const byGroup=new Map();for(const h of rows.filter(running)){const k=group(h.horse_no),old=byGroup.get(k);if(!old)byGroup.set(k,{...h});else {old.agf=(Number(old.agf)||0)+(Number(h.agf)||0);old.score=Math.max(Number(old.score)||0,Number(h.score)||0);}}
 const representatives=new Map([...byGroup].map(([k,h])=>[k,String(h.horse_no)]));
 const protectedGroups=protectedNos.map(group),source=picks.map(group);
 if(new Set(source).size!==source.length)return picks.map(String);
 const target=rank([...byGroup.values()],model).map(h=>group(h.horse_no)).filter(k=>!protectedGroups.includes(k));
 const original=source.concat([...byGroup.keys()].filter(k=>!source.includes(k))).filter(k=>!protectedGroups.includes(k));
 if(original.length!==target.length)return picks.map(String);
 const map=new Map(original.map((k,i)=>[k,target[i]]));
 return picks.map(n=>protectedGroups.includes(group(n))?String(n):representatives.get(map.get(group(n)))||String(n));
}
function choose(events,product,date,models=MODELS,baseline='CURRENT'){
 const end=new Date(date+'T00:00:00Z');if(!Number.isFinite(+end))return {model:baseline,sample:0,hits:0};
 end.setUTCMonth(end.getUTCMonth()-3);const from=end.toISOString().slice(0,10);
 const rows=[...new Map(events.filter(r=>r.product===product&&r.date>=from&&r.date<date&&Number.isFinite(r.cost)&&r.cost>0).map(r=>[r.date+'|'+r.product+'|'+r.id,r])).values()]
  .filter(r=>models.every(m=>typeof r.hits?.[m]==='boolean'));
 const counts=Object.fromEntries(models.map(m=>[m,rows.filter(r=>r.hits[m]).length]));let model=baseline;
 if(rows.length>=30)for(const m of models)if(counts[m]>counts[model])model=m;
 return {model,sample:rows.length,hits:counts[model]||0,counts,from,to:date,objective:'matched_cost_hits'};
}
function resolve(ticket,races){
 const rr=ticket.refs.map(id=>races instanceof Map?races.get(String(id)):races.find(r=>String(r.id)===String(id)));if(rr.some(r=>!r))return null;
 const multi=ticket.product==='six'||ticket.product==='cifte'||ticket.product==='single';
 const actual=ticket.pools.map((_,i)=>{const r=multi?rr[Math.min(i,rr.length-1)]:rr[0],pos=multi?1:i+1;return (r.horses||[]).filter(h=>Number(h.finish_position)===pos||(pos===1&&Number(h.winner)===1)).map(h=>String(h.horse_no));});
 if(actual.some(a=>!a.length))return null;
 return actual.every((a,i)=>a.some(n=>ticket.pools[i].some(p=>multi?group(p)===group(n):String(p)===n)));
}
function database(){try{return typeof db!=='undefined'?db:g.db;}catch(_){return g.db;}}
let saveTimer=null;
function state(){const d=database();if(!d)return null;d.settings=d.settings||{};return d.settings.product_hit_policy||(d.settings.product_hit_policy={version:VERSION,events:[],pending:[],decisions:{}});}
function persist(){if(saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=null;try{if(!g.tkpPersistTopLevelMetaSoon?.({settings:database()?.settings},'product-hit-policy'))g.saveDB?.(false,false);}catch(_){}},300);}
function settle(){const s=state(),d=database();if(!s)return [];let changed=false;const index=new Map((d.races||[]).map(r=>[String(r.id),r]));
 for(const o of s.pending){if(o.resolved)continue;const hits=Object.fromEntries(Object.entries(o.tickets).map(([m,t])=>[m,resolve(t,index)]));if(Object.values(hits).some(h=>h===null))continue;
  s.events=s.events.filter(e=>e.id!==o.id||e.product!==o.product||e.date!==o.date);s.events.push({id:o.id,date:o.date,product:o.product,cost:o.cost,hits,source:'live_candidates'});o.resolved=true;changed=true;}
 if(changed){s.pending=s.pending.filter(o=>!o.resolved);persist();}return (g.TKP_PRODUCT_HIT_SEED?.events||[]).concat(s.events);
}
function cacheSignature(){
 const d=database(),current=d?.settings?.product_hit_policy;
 if(current)settle();
 const rows=[...(g.TKP_PRODUCT_HIT_SEED?.events||[]),...(current?.events||[])];
 let hash=2166136261;
 for(const row of rows){
  const value=JSON.stringify([row?.id,row?.date,row?.product,Number(row?.cost)||0,...MODELS.map(m=>row?.hits?.[m]===true?1:row?.hits?.[m]===false?0:'?')]);
  for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
 }
 return `${VERSION}:${rows.length}:${(hash>>>0).toString(36)}`;
}
function selection(product,date,models=MODELS,baseline='CURRENT'){const decision=choose(settle(),product,date,models,baseline),s=state();if(s)s.decisions[product]=decision;return decision;}
function observe(o){const s=state();if(!s)return;const old=s.pending.findIndex(x=>x.id===o.id&&x.product===o.product&&x.date===o.date);if(old>=0)s.pending[old]=o;else s.pending.push(o);if(s.pending.length>12000)s.pending.splice(0,s.pending.length-12000);persist();}
function eligible(r){return r&&!(r.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0)&&String(r.race_date||'')>=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});}
function couponCandidates(legs,protectedByLeg=[],allowedByLeg=[]){
 const base=legs.map(l=>(l.picks||[]).map(h=>String(h.horse_no??h))),refs=legs.map(l=>l.r.id),tickets={};
 for(const sm of MODELS)for(const wm of MODELS)tickets[sm+'/'+wm]={refs,product:'six',pools:legs.map((l,i)=>{
   const audit=l.singleSelectionAudit,locked=base[i].length===1&&audit?.top3Policy?.version==='TOP3-SINGLE-HISTORY-V1'&&String(audit.horseNo)===base[i][0];
   return locked?base[i].slice():base[i].length===1?sixPool(base[i],allowedByLeg[i]||l.r.horses||[],sm):sixPool(base[i],l.r.horses||[],wm,protectedByLeg[i]||[]);
 })};
 return tickets;
}
function shadowHash(value){let h=2166136261;for(const ch of JSON.stringify(value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
function shadowPayload(s){return {version:s.version,id:s.id,captured_at:s.captured_at,starts:s.starts,refs:s.refs,cost:s.cost,base:s.base,alternative:s.alternative};}
function validAgfShadow(s){try{return s?.version==='BH-AGF-SHADOW-V1'&&s.hash===shadowHash(shadowPayload(s));}catch(_){return false;}}
function startTime(r){
 if(r.program_source!=='TJK_PROGRAM'||!/^\d{4}-\d{2}-\d{2}$/.test(String(r.race_date||''))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(r.tjk_race_time||'')))return NaN;
 return Date.parse(r.race_date+'T'+r.tjk_race_time+':00+03:00');
}
function makeAgfShadow(legs,base,protectedByLeg,cost,role,now){
 const at=Date.parse(now);if(!Number.isFinite(at)||!Array.isArray(legs)||legs.length!==6||!Array.isArray(base)||base.length!==6||!(cost>=2500&&cost<=3000))return null;
 let starts=[],refs=[],alternative=[];
 for(let i=0;i<6;i++){
  const r=legs[i]?.r,hs=(r?.horses||[]).filter(running),start=startTime(r),p=base[i];
  if(!r||r.id==null||r.file_id==null||!r.hippodrome||!Number.isInteger(Number(r.leg))||Number(r.leg)<1||Number(r.leg)>6||!Number.isFinite(start)||at>=start||!hs.length||hs.some(h=>h.agf==null||String(h.agf).trim()===''||!Number.isFinite(Number(h.agf))||Number(h.agf)<=0)||!Array.isArray(p)||!p.length||new Set(p.map(group)).size!==p.length||!p.every(n=>hs.some(h=>String(h.horse_no)===String(n)))||(r.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0))return null;
  starts.push(new Date(start).toISOString());refs.push({id:String(r.id),file_id:String(r.file_id),race_date:String(r.race_date),hippodrome:String(r.hippodrome),altili_no:Number(r.altili_no)||1,leg:Number(r.leg)});
  const keep=(protectedByLeg?.[i]||[]).filter(n=>p.some(x=>group(x)===group(n)));
  const alt=p.length===1?p.map(String):sixPool(p,hs,'AGF',keep);
  if(alt.length!==p.length||new Set(alt.map(group)).size!==alt.length||!keep.every(n=>alt.some(x=>group(x)===group(n))))return null;
  alternative.push(alt);
 }
 if(new Set(refs.map(x=>x.id)).size!==6||new Set(refs.map(x=>x.leg)).size!==6||refs.some(x=>x.file_id!==refs[0].file_id||x.race_date!==refs[0].race_date||x.hippodrome!==refs[0].hippodrome||x.altili_no!==refs[0].altili_no))return null;
 const s={version:'BH-AGF-SHADOW-V1',id:[refs[0].race_date,refs[0].file_id,refs[0].hippodrome,refs[0].altili_no,role].join('|'),captured_at:new Date(at).toISOString(),starts,refs,cost:Number(cost),base:copy(base),alternative};s.hash=shadowHash(shadowPayload(s));return s;
}
function appendAgfShadow(log,s){if(!Array.isArray(log)||!validAgfShadow(s)||log.some(x=>x.id===s.id))return false;log.push(s);return true;}
function agfShadowReport(log,races){
 const out={locked:0,complete:0,waiting:0,invalid:0,base6:0,alt6:0,baseLegs:0,altLegs:0,singles:0,baseSingles:0,altSingles:0};const byId=new Map();for(const r of races||[]){let a=byId.get(String(r.id))||[];a.push(r);byId.set(String(r.id),a);}const seen=new Set();
 for(const s of log||[]){if(!validAgfShadow(s)||seen.has(s.id)){out.invalid++;continue;}seen.add(s.id);out.locked++;let hits=[];
  for(let i=0;i<6;i++){const ref=s.refs[i],matches=(byId.get(ref.id)||[]).filter(r=>String(r.file_id)===ref.file_id&&String(r.race_date)===ref.race_date&&String(r.hippodrome)===ref.hippodrome&&(Number(r.altili_no)||1)===ref.altili_no&&Number(r.leg)===ref.leg);const r=matches[0];
   if(matches.length!==1||!['VERIFIED','VERIFIED_TJK_PAYOUT'].includes(r.result_integrity_status)){hits=[];break;}const w=(r.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);if(w.length!==1){hits=[];break;}const winning=group(w[0].horse_no);hits.push([s.base[i].some(n=>group(n)===winning),s.alternative[i].some(n=>group(n)===winning)]);
  }
  if(hits.length!==6){out.waiting++;continue;}out.complete++;out.base6+=Number(hits.every(x=>x[0]));out.alt6+=Number(hits.every(x=>x[1]));hits.forEach((h,i)=>{out.baseLegs+=Number(h[0]);out.altLegs+=Number(h[1]);if(s.base[i].length===1){out.singles++;out.baseSingles+=Number(h[0]);out.altSingles+=Number(h[1]);}});
 }
 return out;
}
function side(r,product,pools,cost,options={}){
 if(!eligible(r)||!(cost>0)||options.replay){
  if(r&&cost>0&&!options.replay&&(product!=='cifte'||options.next)){try{const rows=(options.rows||r.horses||[]).filter(running);const alternative=product==='cifte'?pools.map((a,i)=>sixPool(a,(i?options.next:r).horses||[],'AGF')):remap(pools,rows,'AGF',options.protectedNos||[]);g.TKP_CONDITION_SHADOW?.observeSide({race:r,next:options.next,product,pools,alternative,cost,models:{base:'CURRENT',alternative:'AGF'}});}catch(_){}}
  return {pools:copy(pools),model:'CURRENT'};
 }
 const rows=(options.rows||r.horses||[]).filter(running),refs=[r.id],tickets={};
 if(product==='cifte'&&!eligible(options.next)){if(options.next){try{const alternative=pools.map((a,i)=>sixPool(a,(i?options.next:r).horses||[],'AGF'));g.TKP_CONDITION_SHADOW?.observeSide({race:r,next:options.next,product,pools,alternative,cost,models:{base:'CURRENT',alternative:'AGF'}});}catch(_){}}return {pools:copy(pools),model:'CURRENT'};}
 if(options.next)refs.push(options.next.id);
 for(const model of MODELS){const p=product==='cifte'?pools.map((a,i)=>sixPool(a,(i?options.next:r).horses||[],model)):remap(pools,rows,model,options.protectedNos||[]);tickets[model]={refs,pools:p,product};}
 const decision=selection(product,r.race_date),id=[r.race_date,r.hippodrome,r.id,product].join('|');
 observe({id,date:r.race_date,product,cost,tickets});
 try{const selected=tickets[decision.model].pools,alternative=tickets[decision.model==='AGF'?'SCORE_AGF':'AGF'].pools;g.TKP_CONDITION_SHADOW?.observeSide({race:r,next:options.next,product,pools:selected,alternative,cost,models:{base:decision.model,alternative:decision.model==='AGF'?'SCORE_AGF':'AGF'}});}catch(_){}
 return {pools:tickets[decision.model].pools,model:decision.model,decision};
}
function applyCoupons(built){
 for(const role of ['main','alt','surprise']){const c=built?.[role],legs=c?.legs||[],r=legs[0]?.r;
  if(!c||c.disabled||c.error||c.readOnlySnapshot||legs.length!==6||!legs.every(l=>eligible(l.r))||!(c.cost>=2500&&c.cost<=3000))continue;
  const single=selection('single',r.race_date),models=MODELS.flatMap(sm=>MODELS.map(wm=>sm+'/'+wm)),tickets={};
  const base=legs.map(l=>(l.picks||[]).map(h=>String(h.horse_no))),refs=legs.map(l=>l.r.id);
  legs.forEach((l,i)=>{if(base[i].length!==1)return;const allowed=(l.r.horses||[]).filter(h=>running(h)&&(!g.canBeCouponSingle||g.canBeCouponSingle(h))&&(!g.tkpLegacyXKulisBreaksSingle||!g.tkpLegacyXKulisBreaksSingle(h)));const alternatives=Object.fromEntries(MODELS.map(m=>[m,{refs:[l.r.id],pools:[sixPool(base[i],allowed,m)],product:'single'}]));
    observe({id:[r.race_date,r.hippodrome,role,l.r.id].join('|'),date:r.race_date,product:'single',cost:1,tickets:alternatives});return alternatives[single.model].pools[0];});
  // Every candidate retains the selected first-three BH groups and strong AGF core.
  const protectedByLeg=legs.map((l,i)=>{let bh=[];try{bh=(g.tkpBhCommonRows?.(l.r,l.displayOrder||l.r.horses)||[]).slice(0,3).map(x=>String(x.horse.horse_no));}catch(_){}
    return base[i].filter(n=>bh.some(b=>group(b)===group(n))||(l.r.horses||[]).some(h=>group(h.horse_no)===group(n)&&Number(h.agf_rank)>0&&Number(h.agf_rank)<=3&&Number(h.agf)>=8));});
  // Store all single/coverage pairs so later single decisions have matched evidence.
  Object.assign(tickets,couponCandidates(legs,protectedByLeg,legs.map(l=>(l.r.horses||[]).filter(h=>running(h)&&(!g.canBeCouponSingle||g.canBeCouponSingle(h))&&(!g.tkpLegacyXKulisBreaksSingle||!g.tkpLegacyXKulisBreaksSingle(h))))));
  const decision=selection('six',r.race_date,models,'CURRENT/CURRENT'),selected=tickets[decision.model],actualSingleModel=decision.model.split('/')[0];
  const shadow=makeAgfShadow(legs,selected.pools,protectedByLeg,Number(c.cost),role,new Date().toISOString());
  if(shadow){const d=database();d.settings=d.settings||{};const records=d.settings.bh_agf_coupon_shadow||(d.settings.bh_agf_coupon_shadow=[]);if(appendAgfShadow(records,shadow))persist();}
  observe({id:[r.race_date,r.hippodrome,r.altili_no||1,role].join('|'),date:r.race_date,product:'six',cost:Number(c.cost),tickets});
  legs.forEach((l,i)=>{const byNo=new Map((l.r.horses||[]).map(h=>[String(h.horse_no),h]));const picks=selected.pools[i].map(n=>byNo.get(n));if(picks.every(Boolean)&&selected.pools[i].join('|')!==base[i].join('|')){l.picks=picks;l.productHitPolicy={version:VERSION,model:base[i].length===1?actualSingleModel:decision.model};if(picks.length===1)l.singleSelectionAudit={version:VERSION,horseNo:String(picks[0].horse_no),evidence:decision};}});
  c.productHitPolicy={version:VERSION,singleBenchmark:single,singleMethod:actualSingleModel,coverage:decision,costUnchanged:true};
  if(decision.model!=='CURRENT/CURRENT')c.conditionFit={sample:decision.sample,probability:decision.sample?decision.hits/decision.sample:null,source:'matched_cost_historical_hits'};
 }
 return built;
}
const api={VERSION,MODELS,group,rank,remap,sixPool,choose,resolve,couponCandidates,selection,side,applyCoupons,settle,cacheSignature,makeAgfShadow,validAgfShadow,appendAgfShadow,agfShadowReport};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else g.TKP_PRODUCT_HIT_POLICY=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this);

if(typeof window!=="undefined"){
/* Shadow comparison records; never modifies the active coupon or historic evidence. */
(function(g){'use strict';
const VERSION='CONDITION-SHADOW-V1';
const clone=x=>JSON.parse(JSON.stringify(x));
const group=n=>{let s=String(n),m=s.match(/-E\d+$/i);return m?m[0].toUpperCase():s};
const hash=x=>{let h=2166136261;for(const c of JSON.stringify(x)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')};
const payload=s=>({version:s.version,id:s.id,kind:s.kind,role:s.role,evidence:s.evidence,capturedAt:s.capturedAt,cost:s.cost,unit:s.unit,races:s.races,base:s.base,alternative:s.alternative});
const valid=s=>!!s&&s.version===VERSION&&s.hash===hash(payload(s));
function combos(pools,distinct){if(!distinct)return pools.reduce((n,p)=>n*p.length,1);let n=0;function visit(i,used){if(i===pools.length){n++;return}for(const v of pools[i])if(!used.has(v)){used.add(v);visit(i+1,used);used.delete(v)}}visit(0,new Set());return n}
function capture(x){
 try{
  const {id,kind,races,base,alternative,capturedAt}=x||{},unit=Number(x?.unit),cost=Number(x?.cost);
  if(!id||!['six','single','cifte','sirali','triple','quartet','quintet'].includes(kind)||!Array.isArray(races)||!Array.isArray(base)||!Array.isArray(alternative)||!(unit>0&&cost>0)||!Number.isFinite(Date.parse(capturedAt)))return null;
  const expected=kind==='six'?6:kind==='cifte'?2:1,positions=kind==='six'?6:kind==='cifte'||kind==='sirali'?2:kind==='triple'?3:kind==='quartet'?4:kind==='quintet'?5:1;
  if(races.length!==expected||base.length!==positions||alternative.length!==positions||new Set(races.map(r=>String(r.id))).size!==expected||races.some(r=>r?.id==null||r?.file_id==null||!r.race_date||!r.hippodrome))return null;
  if(kind==='six'&&(new Set(races.map(r=>Number(r.leg))).size!==6||races.some(r=>String(r.file_id)!==String(races[0].file_id)||r.race_date!==races[0].race_date||r.hippodrome!==races[0].hippodrome||Number(r.altili_no||1)!==Number(races[0].altili_no||1))))return null;
  const ordered=['sirali','triple','quartet','quintet'].includes(kind);
  for(const [i,p] of base.entries())for(const q of [p,alternative[i]]){const r=races[kind==='six'||kind==='cifte'?i:0],allowed=new Set((r.horses||[]).map(h=>String(h.horse_no)));if(!Array.isArray(q)||!q.length||new Set(q.map(n=>ordered?String(n):group(n))).size!==q.length||q.some(n=>!allowed.has(String(n))))return null}
  const a=combos(base,ordered),b=combos(alternative,ordered);if(!a||a!==b||Math.abs(a*unit-cost)>1e-8)return null;
  const at=Date.parse(capturedAt),pre=races.every(r=>{let t=r.program_source==='TJK_PROGRAM'&&/^\d{2}:\d{2}$/.test(String(r.tjk_race_time||''))?Date.parse(r.race_date+'T'+r.tjk_race_time+':00+03:00'):NaN;return Number.isFinite(t)&&at<t&&!(r.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0)});
  const clean=races.map((r,i)=>({id:String(r.id),file_id:String(r.file_id),race_date:String(r.race_date),hippodrome:String(r.hippodrome),altili_no:Number(r.altili_no)||1,leg:Number(r.leg)||0,condition_text:String(r.condition_text||''),surface:String(r.surface||''),breed:String(r.breed||''),distance:Number(r.distance)||null,bh:Array.isArray(x.bhByLeg?.[i])?x.bhByLeg[i].slice(0,6).map(String):[],bh_limit:Array.isArray(x.bhByLeg?.[i])?6:0,decision:x.legMetadata?.[i]?clone(x.legMetadata[i]):null,models:i===0&&x.models?{base:String(x.models.base||''),alternative:String(x.models.alternative||'')}:null,learning:i===0&&x.learning?clone(x.learning):null,horses:(r.horses||[]).map(h=>({horse_no:String(h.horse_no),agf:h.agf??null,agf_rank:h.agf_rank??null,score:h.prediction_score_snapshot??h.score??null,bmb:Number(h.bmb)===1?1:0,odb:Number(h.odb)===1?1:0,tr_bmb_candidate:Number(h.tr_bmb_candidate)===1?1:0}))}));
  const s={version:VERSION,id:String(id),kind,role:String(x.role||''),evidence:pre?'PRE_RACE':'RESEARCH',capturedAt:new Date(at).toISOString(),cost,unit,races:clean,base:clone(base.map(p=>p.map(String))),alternative:clone(alternative.map(p=>p.map(String)))};s.hash=hash(payload(s));return s;
 }catch(_){return null}
}
function append(log,s){if(!Array.isArray(log)||!valid(s)||log.some(x=>x.id===s.id))return false;log.push(clone(s));return true}
function raceIndex(races){const index=new Map();for(const r of races||[]){const k=[String(r.id),String(r.file_id),String(r.race_date),String(r.hippodrome),Number(r.leg||0)].join('|');const list=index.get(k)||[];list.push(r);index.set(k,list)}return index}
function report(log,races,knownIndex){let out={locked:0,complete:0,waiting:0,invalid:0,current6:0,candidate6:0,currentLegs:0,candidateLegs:0,currentSingles:0,currentSingleHits:0,candidateSingles:0,candidateSingleHits:0,currentHits:0,candidateHits:0,research:0};let seen=new Set(),index=knownIndex||raceIndex(races);for(const s of log||[]){if(!valid(s)||seen.has(s.id)){out.invalid++;continue}seen.add(s.id);out.locked++;if(s.evidence!=='PRE_RACE')out.research++;const matched=s.races.map(ref=>index.get([ref.id,ref.file_id,ref.race_date,ref.hippodrome,ref.leg].join('|'))||[]);if(matched.some(a=>a.length!==1||!['VERIFIED','VERIFIED_TJK_PAYOUT'].includes(a[0].result_integrity_status))){out.waiting++;continue}const results=matched.map(a=>a[0]);let positions=[];if(s.kind==='six'||s.kind==='single'||s.kind==='cifte'){for(const r of results){let winners=(r.horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);if(winners.length!==1){positions=[];break}positions.push(String(winners[0].horse_no))}}else{const r=results[0];for(let i=1;i<=s.base.length;i++){let at=(r.horses||[]).filter(h=>Number(h.finish_position)===i||(i===1&&Number(h.winner)===1));if(at.length!==1){positions=[];break}positions.push(String(at[0].horse_no))}}if(positions.length!==s.base.length){out.waiting++;continue}const eq=s.kind==='six'||s.kind==='single'||s.kind==='cifte'?(a,b)=>group(a)===group(b):(a,b)=>a===b;const bh=s.base.map((p,i)=>p.some(x=>eq(x,positions[i]))),ah=s.alternative.map((p,i)=>p.some(x=>eq(x,positions[i])));out.complete++;out.currentHits+=Number(bh.every(Boolean));out.candidateHits+=Number(ah.every(Boolean));if(s.kind==='six'){out.current6+=Number(bh.every(Boolean));out.candidate6+=Number(ah.every(Boolean));out.currentLegs+=bh.filter(Boolean).length;out.candidateLegs+=ah.filter(Boolean).length;s.base.forEach((p,i)=>{if(p.length===1){out.currentSingles++;out.currentSingleHits+=Number(bh[i])}});s.alternative.forEach((p,i)=>{if(p.length===1){out.candidateSingles++;out.candidateSingleHits+=Number(ah[i])}})}}return out}
function condition(r){const d=Number(r?.distance),band=Number.isFinite(d)&&d>0?(d<=1300?'KISA':d<1900?'ORTA':'UZUN'):'?';return [String(r?.surface||'?').toLocaleUpperCase('tr-TR'),String(r?.breed||'?').toLocaleUpperCase('tr-TR'),band].join('|')}
function portfolioReport(records,races){const index=raceIndex(races),sets=new Map(),seen=new Set(),out={meetings:0,current6:0,candidate6:0,waiting:0};for(const s of records||[]){if(!valid(s)||s.kind!=='six'||s.evidence!=='PRE_RACE'||!['main','alt','surprise'].includes(s.role)||seen.has(s.id))continue;seen.add(s.id);const key=JSON.stringify(s.races.map(r=>[r.id,r.file_id,r.race_date,r.hippodrome,r.altili_no,r.leg]));const set=sets.get(key)||{};if(set[s.role]){set.duplicate=true}else set[s.role]=s;sets.set(key,set)}for(const set of sets.values()){if(set.duplicate||!set.main||!set.alt||!set.surprise)continue;const results=['main','alt','surprise'].map(k=>report([set[k]],races,index));if(results.some(q=>q.complete!==1)){out.waiting++;continue}out.meetings++;out.current6+=Number(results.some(q=>q.current6));out.candidate6+=Number(results.some(q=>q.candidate6))}return out}
function archiveResearch(d){const byMeeting=new Map(),selected=new Map(),conditions=new Map(),out={meetings:0,coupons:0,legs:0,hits:0,six:0,conditions:[],skipped:0};for(const r of d?.races||[]){if(!r.meeting_uid)continue;const list=byMeeting.get(String(r.meeting_uid))||[];list.push(r);byMeeting.set(String(r.meeting_uid),list)}for(const s of d?.auto_coupon_log||[]){if(!s?.meeting_uid||!(s.source==='HISTORICAL_CALIBRATION_FULL'||Number(s.display_snapshot_locked)===1))continue;const key=String(s.meeting_uid),old=selected.get(key),priority=Number(s.display_snapshot_locked)===1?2:1;if(!old||priority>old.priority||(priority===old.priority&&String(s.created_at||'')<String(old.s.created_at||'')))selected.set(key,{s,priority})}for(const [uid,{s}] of selected){const rr=byMeeting.get(uid)||[];let used=false;for(const role of ['main','alt','surprise']){const coupon=s.coupons?.[role],legs=coupon?.legs||[];if(legs.length!==6)continue;const mapped=legs.map(l=>rr.filter(r=>Number(r.leg)===Number(l.leg)&&String(r.race_date)===String(s.race_date)&&String(r.hippodrome)===String(s.hippodrome)&&Number(r.altili_no||1)===Number(s.altili_no||1)));if(mapped.some(a=>a.length!==1||!['VERIFIED','VERIFIED_TJK_PAYOUT'].includes(a[0].result_integrity_status))){out.skipped++;continue}const outcomes=mapped.map(a=>(a[0].horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1));if(outcomes.some(a=>a.length!==1)||new Set(legs.map(l=>Number(l.leg))).size!==6){out.skipped++;continue}const pools=legs.map(l=>Array.isArray(l.picks)?l.picks.map(String):[]);if(!(Number.isFinite(Number(coupon.unit))&&Number(coupon.unit)>0&&Number.isFinite(Number(coupon.cost))&&Number(coupon.cost)>0)||pools.some((p,i)=>!p.length||new Set(p.map(group)).size!==p.length||p.some(n=>!mapped[i][0].horses.some(h=>group(h.horse_no)===group(n))))||Math.abs(combos(pools,false)*Number(coupon.unit)-Number(coupon.cost))>1e-8){out.skipped++;continue}out.coupons++;used=true;let all=true;for(let i=0;i<6;i++){const r=mapped[i][0],win=String(outcomes[i][0].horse_no),hit=pools[i].some(n=>group(n)===group(win)),key=condition(r),a=conditions.get(key)||{condition:key,observations:0,hits:0,singleCount:0,singleHits:0,widths:{},races:[]};const raceKey=[r.file_id,r.id,r.race_date].join("|");if(!a.races.includes(raceKey))a.races.push(raceKey);out.legs++;out.hits+=Number(hit);all=all&&hit;a.observations++;a.hits+=Number(hit);const width=pools[i].length;a.widths[width]=(a.widths[width]||0)+1;if(width===1){a.singleCount++;a.singleHits+=Number(hit)}conditions.set(key,a)}out.six+=Number(all)}if(used)out.meetings++}out.conditions=[...conditions.values()];return out}
function conditionAnalysis(log,races,{before}={}){const index=new Map(),buckets={PRE_RACE:new Map(),RESEARCH:new Map()},seen=new Set();for(const r of races||[]){const k=[r.id,r.file_id,r.race_date,r.hippodrome,Number(r.leg||0)].join('|'),a=index.get(k)||[];a.push(r);index.set(k,a)}for(const s of log||[]){if(!valid(s)||s.kind!=='six'||seen.has(s.id))continue;seen.add(s.id);for(let i=0;i<s.races.length;i++){const ref=s.races[i];if(before&&ref.race_date>=before)continue;const matches=index.get([ref.id,ref.file_id,ref.race_date,ref.hippodrome,ref.leg].join('|'))||[];if(matches.length!==1||!['VERIFIED','VERIFIED_TJK_PAYOUT'].includes(matches[0].result_integrity_status))continue;const winners=(matches[0].horses||[]).filter(h=>Number(h.winner)===1||Number(h.finish_position)===1);if(winners.length!==1)continue;const winner=String(winners[0].horse_no),w=(ref.horses||[]).find(h=>group(h.horse_no)===group(winner)),key=condition(ref),map=buckets[s.evidence],a=map.get(key)||{condition:key,observations:0,races:[],currentHits:0,candidateHits:0,singleCount:0,singleHits:0,bh6Wins:0,bhUnknown:0,agf68Wins:0,bmbOutsideBhWins:0,widths:{}};a.observations++;const raceKey=[ref.file_id,ref.id,ref.race_date].join('|');if(!a.races.includes(raceKey))a.races.push(raceKey);const hit=p=>p.some(n=>group(n)===group(winner));a.currentHits+=Number(hit(s.base[i]));a.candidateHits+=Number(hit(s.alternative[i]));const width=s.base[i].length;a.widths[width]=(a.widths[width]||0)+1;if(width===1){a.singleCount++;a.singleHits+=Number(hit(s.base[i]))}const bhKnown=Number(ref.bh_limit)===6,inBh=bhKnown&&(ref.bh||[]).slice(0,6).some(n=>group(n)===group(winner));a.bh6Wins+=Number(inBh);a.bhUnknown+=Number(!bhKnown);a.agf68Wins+=Number(Number(w?.agf_rank)>=6&&Number(w?.agf_rank)<=8);a.bmbOutsideBhWins+=Number(bhKnown&&!inBh&&Number(w?.bmb)===1);map.set(key,a)}}return {pre:[...buckets.PRE_RACE.values()],research:[...buckets.RESEARCH.values()]}}
function learn(log,races,{date,kind,race,models}={}){const target=condition(race),seen=new Set(),out={status:'INSUFFICIENT',sample:0,currentHits:0,candidateHits:0,condition:target};if(target.split('|').includes('?')||!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return out;const index=raceIndex(races);for(const s of log||[]){if(!valid(s)||s.evidence!=='PRE_RACE'||s.kind!==kind||s.races.length!==1||s.races[0].race_date>=date||condition(s.races[0])!==target||(models&&(s.races[0].models?.base!==models.base||s.races[0].models?.alternative!==models.alternative)))continue;const key=[s.races[0].file_id,s.races[0].id,s.races[0].race_date,kind].join('|');if(seen.has(key))continue;const q=report([s],races,index);if(q.complete!==1)continue;seen.add(key);out.sample++;out.currentHits+=q.currentHits;out.candidateHits+=q.candidateHits}if(out.sample>=30)out.status=out.candidateHits>out.currentHits?'REVIEW':'KEEP';return out}
function currentDb(){try{return typeof db!=='undefined'?db:g.db}catch(_){return g.db}}
let saveTimer=null;
function persistDefault(){if(saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=null;try{if(!g.tkpPersistTopLevelMetaSoon?.({settings:currentDb()?.settings},'condition-shadow'))g.saveDB?.(false,false)}catch(_){}},300)}
function store(s,deps){const d=deps.db||currentDb();if(!d||!s)return false;d.settings=d.settings||{};const state=d.settings.condition_shadow||(d.settings.condition_shadow={version:VERSION,records:[]});if(!Array.isArray(state.records))return false;const added=append(state.records,s);if(added)(deps.persist||persistDefault)();return added}
function observeCoupons(built,deps={}){let count=0;for(const role of ['main','alt','surprise']){const c=built?.[role],legs=c?.legs||[];if(!c||c.error||c.disabled||c.readOnlySnapshot||legs.length!==6)continue;try{const races=legs.map(l=>l.r),base=legs.map(l=>(l.picks||[]).map(h=>String(h.horse_no??h)));const bh=races.map((r,i)=>{const getBh=deps.bh||g.tkpBhCommonRows;if(typeof getBh!=='function')return null;const rows=getBh(r,legs[i].displayOrder||r.horses);return Array.isArray(rows)?rows.slice(0,6).map(x=>String(x.horse?.horse_no??x.horse_no??x)):null});const metadata=legs.map((l,i)=>({width:base[i].length,single_policy:String(l.singleSelectionAudit?.version||''),excluded:(races[i].horses||[]).map(h=>String(h.horse_no)).filter(n=>!base[i].some(p=>group(p)===group(n))),swaps:(Array.isArray(l.bhOdbRescueSwaps)?l.bhOdbRescueSwaps:[]).map(z=>({out:String(z.out||''),in:String(z.in||''),kind:String(z.kind||'')}))}));const alternative=deps.candidate?deps.candidate(base,legs):base.map((p,i)=>p.length===1?p.slice():g.TKP_PRODUCT_HIT_POLICY.sixPool(p,races[i].horses||[],'AGF',p.filter(n=>(bh[i]||[]).slice(0,4).includes(n))));const r=races[0];const id=['six',r.race_date,r.file_id,r.hippodrome,r.altili_no||1,role].join('|');const s=capture({id,kind:'six',role,races,base,alternative,cost:c.cost,unit:c.unit,bhByLeg:bh,legMetadata:metadata,models:{base:'SELECTED',alternative:'AGF_SWAP'},capturedAt:deps.now||new Date().toISOString()});if(store(s,deps))count++}catch(_){}}return count}
function observeSide(x,deps={}){try{const {race,product,pools,alternative,cost,next,models}=x;const ordered=['sirali','triple','quartet','quintet'].includes(product),n=combos(pools,ordered);if(!(n>0))return false;const races=product==='cifte'?[race,next]:[race];const id=['side',race.race_date,race.file_id,race.id,product].join('|');const d=deps.db||currentDb(),records=d?.settings?.condition_shadow?.records||[];if(records.some(s=>s.id===id))return false;const learning=product==='cifte'||!models?null:learn(records,d?.races||[],{date:race.race_date,kind:product,race,models});return store(capture({id,kind:product,races,base:pools,alternative,cost,models,learning,unit:Number(cost)/n,capturedAt:deps.now||new Date().toISOString()}),deps)}catch(_){return false}}
function trackingHtml(d){const records=d?.settings?.condition_shadow?.records||[],races=d?.races||[];const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const archive=archiveResearch(d),a=conditionAnalysis(records,races),conditionRows=a.pre.sort((x,y)=>y.observations-x.observations).slice(0,30).map(x=>`<tr><td>${escape(x.condition)}</td><td>${x.races.length}</td><td>${x.observations}</td><td>${x.currentHits}/${x.observations}</td><td>${x.candidateHits}/${x.observations}</td><td>${x.singleHits}/${x.singleCount}</td><td>${x.bh6Wins}/${x.observations-x.bhUnknown}</td><td>${x.agf68Wins}</td><td>${x.bmbOutsideBhWins}</td><td>${escape(Object.entries(x.widths).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,v])=>k+':'+v).join(' · '))}</td></tr>`).join('');const archiveRows=archive.conditions.sort((a,b)=>b.observations-a.observations).slice(0,30).map(x=>`<tr><td>${escape(x.condition)}</td><td>${x.observations}</td><td>${x.hits}/${x.observations}</td><td>${x.singleHits}/${x.singleCount}</td><td>${escape(Object.entries(x.widths).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,v])=>k+':'+v).join(' · '))}</td></tr>`).join('');const archiveMainRows=archive.conditions.map(x=>`<tr><td>${escape(x.condition)} <b>· Arşiv araştırması</b></td><td>${x.races.length}</td><td>${x.observations}</td><td>${x.hits}/${x.observations}</td><td>—</td><td>${x.singleHits}/${x.singleCount}</td><td>—</td><td>—</td><td>—</td><td>${escape(Object.entries(x.widths).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,v])=>k+':'+v).join(' · '))}</td></tr>`).join('');const researchRows=[['six','Altılı'],['cifte','Çifte'],['sirali','Sıralı ikili'],['triple','Üçlü'],['quartet','Dörtlü'],['quintet','Beşli']].map(([kind,label])=>{const q=report(records.filter(s=>s.kind===kind&&s.evidence==='RESEARCH'),races);return `<tr><td>${label}</td><td>${q.complete}/${q.locked}</td><td>${q.currentHits}</td><td>${q.candidateHits}</td></tr>`}).join('');const researchConditions=a.research.sort((x,y)=>y.observations-x.observations).slice(0,30).map(x=>`<tr><td>${escape(x.condition)}</td><td>${x.races.length}</td><td>${x.observations}</td><td>${x.currentHits}/${x.observations}</td><td>${x.bh6Wins}/${x.observations-x.bhUnknown}</td><td>${x.agf68Wins}</td></tr>`).join('');return `<div class="card" style="margin:10px 0"><h3>Koşul dağılımı · yarış öncesi kayıtlar</h3><p class="muted">Pist, ırk ve mesafe grubuna göre; aynı koşu farklı kuponlarda birden fazla kupon-ayağı sayılabilir. BH ilk 6 kapsamı yalnız altı sıra bilgisi kaydedilen karşılaştırmalarda hesaplanır; AGF 6–8 ve BH dışı BMB kazanan sayılarıdır. Arşiv araştırması satırları eski kayıtlı veya yeniden kurulmuş kuponlardır; yarış öncesi kanıtı değildir. Eksik bilgiler — ile gösterilir.</p><div class="tableWrap"><table><thead><tr><th>Koşul</th><th>Farklı yarış</th><th>Kupon-ayağı</th><th>Mevcut kapsam</th><th>Aday kapsam</th><th>TEK isabet</th><th>BH ilk 6</th><th>AGF 6–8</th><th>BH dışı BMB</th><th>At sayısı: adet</th></tr></thead><tbody>${conditionRows||'<tr><td colspan="10">Henüz sonuçlanmış yarış öncesi kayıt yok.</td></tr>'}${archiveMainRows}</tbody></table></div><details><summary>Kayıtlı arşiv kuponları · araştırma</summary><p class="muted">${archive.meetings} toplantı · ${archive.coupons} kupon · ${archive.hits}/${archive.legs} ayak kapsandı · ${archive.six}/${archive.coupons} kupon 6/6 · ${archive.skipped} eksik veya çelişkili kayıt dışlandı. Arşivdeki kaydedilmiş veya yeniden kurulmuş kuponlar kullanılır; yarış öncesi kanıt değildir. Aynı toplantıda birden çok kupon-ayağı olabilir.</p><div class="tableWrap"><table><thead><tr><th>Koşul</th><th>Kupon-ayağı</th><th>Kapsam</th><th>TEK isabet</th><th>At sayısı: adet</th></tr></thead><tbody>${archiveRows||'<tr><td colspan="5">Uygun arşiv kuponu yok.</td></tr>'}</tbody></table></div></details><details><summary>Araştırma karşılaştırmaları ve koşul dağılımı</summary><p class="muted">Yarış öncesi zamanı doğrulanmamış veya sonuç bilgisi bulunan kayıtlar; performans kanıtı değildir.</p><div class="tableWrap"><table><thead><tr><th>Ürün</th><th>Sonuçlanan / kayıt</th><th>Mevcut tutan</th><th>Aday tutan</th></tr></thead><tbody>${researchRows}</tbody></table></div><h3>Araştırma koşul dağılımı</h3><div class="tableWrap"><table><thead><tr><th>Koşul</th><th>Farklı yarış</th><th>Kupon-ayağı</th><th>Kapsam</th><th>BH ilk 6</th><th>AGF 6–8</th></tr></thead><tbody>${researchConditions||'<tr><td colspan="6">Sonuçlanmış araştırma kaydı yok.</td></tr>'}</tbody></table></div></details></div>`}
const api={VERSION,capture,valid,append,report,combos,condition,conditionAnalysis,portfolioReport,archiveResearch,learn,observeCoupons,observeSide,trackingHtml};if(typeof module!=='undefined'&&module.exports)module.exports=api;else g.TKP_CONDITION_SHADOW=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this);

}
