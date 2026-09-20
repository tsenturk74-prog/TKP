(function(g){
'use strict';
const VERSION='R16.79-ARCHIVE-REPLAN-1';
const modes=['main','alt','surprise'];
  function finishSteps(steps){let next;do{next=steps.next();}while(!next.done);return next.value;}
  async function finishStepsAsync(steps,pause){
    const wait=pause||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    try{let next;while(!(next=steps.next()).done)await wait();return next.value;}
    finally{steps.return();}
  }

const no=h=>String(h?.horse_no||'');
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const key=h=>{const group=typeof g.ekuriGroup==='function'?g.ekuriGroup(no(h)):null;return group?'E:'+group:'N:'+no(h);};
function* fieldSteps(x,role){
  const source=(x.scored||x.r?.horses||[]).filter(h=>h&&!(typeof g.isNonRunner==='function'&&g.isNonRunner(h)));
  const rank=h=>Number(h.prediction_order_snapshot||h.predicted_rank)||9999;
  const rows=source.slice().sort((a,b)=>rank(a)-rank(b)||(Number(b.prediction_score_snapshot??b.score)||0)-(Number(a.prediction_score_snapshot??a.score)||0)||no(a).localeCompare(no(b),'en',{numeric:true}));
  const values=rows.map((h,i)=>{
    const score=h.prediction_score_snapshot??h.score;
    return finite(score)&&Number(score)>0?Number(score):(rank(h)<9999?1/Math.sqrt(rank(h)):1);
  });
  const total=values.reduce((s,v)=>s+v,0)||1;
  const maxComment=Math.max(1,...rows.map(h=>Math.max(0,Number(h.ypuan)||0)+Math.max(0,Number(h.kulis_score)||0)));
  const groups=new Map();
  for(let i=0;i<rows.length;i++){
    yield;const h=rows[i];
    const p=values[i]/total,agf=Math.max(.005,(Number(h.agf)||0)/100);
    const commentator=(Math.max(0,Number(h.ypuan)||0)+Math.max(0,Number(h.kulis_score)||0))/maxComment;
    const priority=g.TKP_COUPON_POLICY?.commentPriority(x.r,h)?.score||0;
    const preference=(role==='alt'?p*(1+.20*Math.max(-1,Math.min(1,p/agf-1))+.12*commentator):role==='surprise'?p*(1+.35*commentator):p*(1+.10*commentator))*(1+priority*(role==='surprise'?.75:role==='alt'?.35:.25));
    const k=key(h),old=groups.get(k);
    if(old){old.p+=p;old.preference+=preference;}else groups.set(k,{h,p,preference,k,rank:i});
  }
  const pool=[...groups.values()].sort((a,b)=>b.preference-a.preference||a.rank-b.rank);
  const entropy=-pool.reduce((s,r)=>s+r.p*Math.log(Math.max(r.p,1e-12)),0);
  const difficulty=pool.length>1?entropy/Math.log(pool.length):0;
  return {x,pool,difficulty};
}
function signature(c){return c.legs.map(l=>l.picks.map(key).sort().join(',')).join('|');}
function* solveSteps(fields,singleIndices,unit,cap){
  let visits=0;
  const low=Math.ceil(1000/unit-1e-8),high=Math.floor(cap/unit+1e-8);
  const singles=new Set(singleIndices),ordered=fields.map((f,i)=>({...f,index:i})).filter(f=>!singles.has(f.index)).sort((a,b)=>a.difficulty-b.difficulty||a.index-b.index);
  // Arşiv yeniden planı canlı kuponla aynı dağılım sözleşmesini kullanır:
  // iki atlı ayak en fazla bir kez, diğer çoklu ayaklar en az üç at.
  let states=new Map([['1|0',{product:1,twoLegs:0,score:0,widths:[]}]]);
  for(const f of ordered){
    const next=new Map();let mass=0;const sums=f.pool.map(r=>(mass+=r.p));
    for(const state of states.values()){
      const minMulti=f.pool.length<3?2:3;
      for(let count=minMulti;count<=f.pool.length;count++){
        if((++visits&127)===0)yield;
        const prod=state.product*count;if(prod>high)continue;
        const twoLegs=state.twoLegs+(count===2?1:0);if(twoLegs>1)continue;
        const candidate={product:prod,twoLegs,score:state.score+Math.log(Math.max(sums[count-1],1e-12)),widths:state.widths.concat(count)};
        const stateKey=`${prod}|${twoLegs}`;
        if(!next.has(stateKey)||candidate.score>next.get(stateKey).score)next.set(stateKey,candidate);
      }
    }
    states=next;
  }
  let best=null;
  const singleScore=singleIndices.reduce((s,i)=>s+Math.log(Math.max(fields[i].pool[0].p,1e-12)),0);
  for(const state of states.values()){
    const product=state.product;
    if(product<low)continue;
    const score=state.score+singleScore;
    if(!best||score>best.score+1e-12||(Math.abs(score-best.score)<1e-12&&product<best.product))best={...state,score,product};
  }
  if(!best)return null;
  const counts=fields.map(()=>1);ordered.forEach((f,i)=>counts[f.index]=best.widths[i]);
  return {...best,counts};
}
function* buildSteps(raceResults,budget=1400,options={}){
  const rows=(raceResults||[]).slice().sort((a,b)=>Number(a.r?.leg)-Number(b.r?.leg));
  if(rows.length!==6||new Set(rows.map(x=>Number(x.r?.leg))).size!==6)return Object.fromEntries(modes.map(k=>[k,{error:'Altı farklı gerçek ayak gerekli.'}]));
  const unit=typeof g.ganyanUnitPrice==='function'?Number(g.ganyanUnitPrice(rows[0].r?.hippodrome,6))||1:1;
  const cap=Math.max(1000,Math.min(1400,Number(budget)||1400));
  const usedSingles=new Set(),previous=[],out={};
  for(const role of modes){
    const fields=[];for(const x of rows)fields.push(yield* fieldSteps(x,role));
    if(fields.some(f=>!f.pool.length)){out[role]={error:'At listesi eksik; kupon üretilemedi.'};continue;}
    const forced=fields.map((f,i)=>f.pool.length===1?i:-1).filter(i=>i>=0);
    const combinations=forced.length?[forced]:fields.map((_,i)=>[i]);
    if(forced.length<=1)for(let a=0;a<6;a++)for(let b=a+1;b<6;b++){
      if(forced.length&&!forced.includes(a)&&!forced.includes(b))continue;
      // A second single is considered only where both leaders have substantial mass.
      if(fields[a].pool[0].p>=.40&&fields[b].pool[0].p>=.40)combinations.push([a,b]);
    }
    let best=null;
    for(const singleIndices of combinations){
      if(singleIndices.length>2)continue;
      yield;const plan=yield* solveSteps(fields,singleIndices,unit,cap);if(!plan)continue;
      const repeated=singleIndices.filter(i=>usedSingles.has(i+'|'+fields[i].pool[0].k)).length;
      const objective=plan.score-(role==='main'?0:.30*repeated);
      if(!best||objective>best.objective)best={...plan,objective,singleIndices};
    }
    if(!best){out[role]={error:'Gerçek at sayıları ve 1–2 tek ile 1.000–1.400 TL planı bulunamadı.',archive_snapshot:1};continue;}
    const legs=fields.map((f,i)=>({r:f.x.r,x:f.x,leg:Number(f.x.r.leg),allHorses:f.pool.map(r=>r.h),ordered:f.pool.map(r=>r.h),picks:f.pool.slice(0,best.counts[i]).map(r=>r.h),distributionPlan:{difficulty:Math.round(f.difficulty*100),count:best.counts[i],reason:best.counts[i]===1?'Arşiv puanlarına göre göreli TEK adayı':'Ayak belirsizliği ve ortak bütçeyle kapsama'}}));
    const c={typeKey:role,legs,legCount:6,unit,combos:best.product,cost:best.product*unit,budgetTL:cap,validatedPrediction:false};
    if(options.current===true){
      c.boundedCoveragePlan=true;
      c.sourceLabel='Süre korumalı kapsama planı';
      for(const leg of legs)leg.distributionPlan.reason=leg.picks.length===1?'Mevcut puanlara göre göreli TEK adayı':'Ayak belirsizliği ve bütçeyle kapsama';
    }else{c.archive_snapshot=1;c.archive_coupon_layout_version=VERSION;c.sourceLabel='Geçmiş yeniden hesaplama';}
    // Equal source evidence can still produce identical tickets. Use the closest
    // role-ranked replacement in a multiple leg, preserving the budget and singles.
    if(previous.some(p=>signature(p)===signature(c))){
      const alternatives=[];
      fields.forEach((f,i)=>{const count=legs[i].picks.length;if(count<=1||count>=f.pool.length)return;
        alternatives.push({i,count,loss:f.pool[count-1].preference-f.pool[count].preference});});
      alternatives.sort((a,b)=>a.loss-b.loss||b.i-a.i);
      for(const a of alternatives){const old=legs[a.i].picks[a.count-1];legs[a.i].picks[a.count-1]=fields[a.i].pool[a.count].h;
        if(!previous.some(p=>signature(p)===signature(c)))break;legs[a.i].picks[a.count-1]=old;}
    }
    best.singleIndices.forEach(i=>usedSingles.add(i+'|'+fields[i].pool[0].k));
    out[role]=c;previous.push(c);
  }
  out.main2={disabled:true,removed:true,legs:[],cost:0};return out;
}
function build(raceResults,budget=1400,options={}){return finishSteps(buildSteps(raceResults,budget,options));}
function buildAsync(raceResults,budget=1400,options={}){return finishStepsAsync(buildSteps(raceResults,budget,options),options.pause);}
g.TKP_ARCHIVE_COUPON_PLANNER={version:VERSION,build,buildAsync,signature};
})(globalThis);
