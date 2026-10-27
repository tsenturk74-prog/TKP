(function(g){
'use strict';
// Research challenger. This module is deliberately not loaded by the live UI.
// Inputs are an allowlisted numeric view, never a race result or stored prediction.
const roles=['main','alt','surprise'];
const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const norm=a=>{const sum=a.reduce((s,x)=>s+x,0);return a.map(x=>sum>0?x/sum:1/a.length);};
const cmp=(a,b)=>String(a).localeCompare(String(b),'en',{numeric:true});
function policies(){const out=[];
  for(const marketWeight of [.15,.35,.55,.75])for(const fundamental of ['tr','balanced','handicap'])
    for(const commentWeight of [.1,.3,.5])for(const secondSingleThreshold of [null,.25,.35,.45])
      out.push({id:'C'+String(out.length+1).padStart(3,'0'),marketWeight,fundamental,commentWeight,secondSingleThreshold});
  return out;
}
function rankSignal(field,name){
  const known=field.filter(h=>finite(h[name]));
  if(!known.length)return field.map(()=>1);
  return field.map(h=>{if(!finite(h[name]))return Math.exp(-1.25);
    const higher=known.filter(z=>Number(z[name])>Number(h[name])).length;
    const tied=known.filter(z=>Number(z[name])===Number(h[name])).length;
    return Math.exp(-2.5*(higher+(tied-1)/2)/Math.max(1,known.length-1));});
}
function prepare(leg,policy,role){
  const field=leg.field.slice().sort((a,b)=>cmp(a.id,b.id));
  if(!field.length)return [];
  const market=norm(field.map(h=>finite(h.market)?Math.max(0,Number(h.market)):0));
  const tr=norm(rankSignal(field,'tr')),handicap=norm(rankSignal(field,'handicap'));
  const tw=policy.fundamental==='tr'?.75:policy.fundamental==='handicap'?.25:.5;
  const comments=field.map(h=>Math.max(0,Number(h.comments)||0));
  const maxComment=Math.max(1,...comments);
  const groups=new Map();
  field.forEach((h,i)=>{
    const comment=comments[i]/maxComment;
    const base=policy.marketOnly?market[i]:policy.marketWeight*market[i]+(1-policy.marketWeight)*(tw*tr[i]+(1-tw)*handicap[i]);
    let p=base*(1+(policy.commentWeight||0)*comment);
    if(!policy.marketOnly&&role==='alt')p*=1+.2*Math.max(-1,Math.min(1,base/Math.max(.005,market[i])-1));
    if(!policy.marketOnly&&role==='surprise')p*=1+.2*comment;
    const k=h.key||h.id,old=groups.get(k);
    if(old){old.p+=p;old.members.push(h.id);}else groups.set(k,{id:h.id,key:k,members:[h.id],p});
  });
  const out=[...groups.values()].sort((a,b)=>b.p-a.p||cmp(a.id,b.id));
  const total=out.reduce((s,h)=>s+h.p,0);out.forEach(h=>h.p/=total||1);
  return out;
}
// Exact integer-budget dynamic programming, with one best state per product and
// single count. Threshold is relevant only to an exactly-two-single solution.
function solve(fields,unit,exactSingles,threshold,used=new Set(),penalty=.20){
  const low=Math.ceil(1000/unit-1e-9),high=Math.floor(1400/unit+1e-9);
  if(!Number.isFinite(high)||high<1||high>10000||fields.length!==6)return null;
  let states=new Map([[3,{product:1,singles:0,score:0,widths:[]}]]);
  for(let i=0;i<fields.length;i++){
    const field=fields[i],next=new Map();let sum=0;
    const logMass=field.map(h=>Math.log(Math.max(1e-15,sum+=h.p)));
    for(const state of states.values())for(let width=1;width<=field.length;width++){
      const product=state.product*width;if(product>high)break;
      const single=width===1?1:0,singles=state.singles+single;
      if(singles>exactSingles||singles+(5-i)<exactSingles)continue;
      if(single&&exactSingles===2&&field[0].p<threshold)continue;
      const score=state.score+logMass[width-1]-(single&&used.has(i+'|'+field[0].key)?penalty:0);
      const key=product*3+singles,old=next.get(key);
      if(!old||score>old.score+1e-12)next.set(key,{product,singles,score,widths:state.widths.concat(width)});
    }
    states=next;
  }
  let best=null;
  for(const state of states.values())if(state.singles===exactSingles&&state.product>=low)
    if(!best||state.score>best.score+1e-12||(Math.abs(state.score-best.score)<=1e-12&&state.product<best.product))best=state;
  return best;
}
const signature=c=>c.picks.map(row=>row.map(h=>h.key).sort().join(',')).join('|');
function build(meeting,policy){
  const used=new Set(),previous=[],out={};
  if(meeting.legs.length!==6)return {error:'six legs required'};
  for(const role of roles){
    const fields=meeting.legs.map(l=>prepare(l,policy,role));
    if(fields.some(f=>!f.length)){out[role]={error:'empty field'};continue;}
    let best=solve(fields,meeting.unit,1,0,used);
    if(policy.secondSingleThreshold!==null&&policy.secondSingleThreshold!==undefined){
      const two=solve(fields,meeting.unit,2,policy.secondSingleThreshold,used);
      if(two&&(!best||two.score>best.score+1e-12))best=two;
    }
    if(!best){out[role]={error:'infeasible 1000-1400 budget and 1-2 singles'};continue;}
    const c={picks:fields.map((f,i)=>f.slice(0,best.widths[i])),widths:best.widths,cost:best.product*meeting.unit,singles:best.singles};
    if(previous.includes(signature(c))){
      const alternatives=fields.map((f,i)=>({i,n:c.picks[i].length,loss:f[c.picks[i].length-1]?.p-(f[c.picks[i].length]?.p||0)}))
        .filter(a=>a.n>1&&a.n<fields[a.i].length).sort((a,b)=>a.loss-b.loss||a.i-b.i);
      for(const a of alternatives){const old=c.picks[a.i][a.n-1];c.picks[a.i][a.n-1]=fields[a.i][a.n];
        if(!previous.includes(signature(c)))break;c.picks[a.i][a.n-1]=old;}
    }
    c.picks.forEach((row,i)=>{if(row.length===1)used.add(i+'|'+row[0].key);});
    previous.push(signature(c));out[role]=c;
  }
  return out;
}
const api={version:'R16.79-CLEAN-POLICY-SEARCH-1',policies,prepare,solve,build,signature,roles};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else g.TKP_COUPON_POLICY_RESEARCH=api;
})(globalThis);
