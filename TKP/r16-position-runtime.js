(function(global){
  'use strict';
  const F=global.TKP_LEARNED_FEATURES,M=global.TKP_LEARNED_MODEL;
  if(!F||!M||F.VERSION!==M.featureVersion)return;
  const original=global.sideBetPositionRankingsForRace,productOriginal=global.tkpSideBetProductPositionRankingsForRace;
  const probabilityOriginal=global.tkpProbabilityPortfolioOrderForRace;
  let histories=new Map(),cache=new WeakMap();
  const softmax=values=>{const max=Math.max(...values),ex=values.map(v=>Math.exp(Math.max(-60,v-max))),sum=ex.reduce((a,b)=>a+b,0);return ex.map(v=>v/sum);};
  function database(){try{return typeof db!=='undefined'?db:global.db||{};}catch(_){return {};}}
  function history(race){
    const d=database(),date=String(race.race_date||race.date||'');
    const revision=String(d.learning_state?.dataset_signature||'')+'|'+(d.races||[]).length+'|'+(d.changelog||[]).length;
    const key=date+'|'+revision;
    if(!histories.has(key)){histories.set(key,F.historical(d.races||[],date));if(histories.size>3)histories.delete(histories.keys().next().value);}
    return histories.get(key);
  }
  function eligible(race){
    const date=String(race?.race_date||race?.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<=M.trainedThrough)return false;
    if(typeof global.tkpIsArchivedReadOnly==='function'&&global.tkpIsArchivedReadOnly(race))return false;
    return Object.values(M.positions).some(p=>p.enabled===true);
  }
  function prepare(race,input){
    if(!eligible(race))return null;
    const rows=(input?.length?input:race.horses||[]).filter(h=>F.live(h)&&!(typeof global.isNonRunner==='function'&&global.isNonRunner(h)));
    if(rows.length<2)return null;
    const agf=rows.map(h=>F.num(h.agf)),known=agf.every(v=>v!==null&&v>=0)&&agf.reduce((a,b)=>a+b,0)>0;
    // Training uses complete AGF fields; incomplete markets keep the existing engine.
    if(!known)return null;
    const total=agf.reduce((a,b)=>a+b,0),market=agf.map(v=>(v+.0001)/(total+.0001*rows.length));
    const vectors=F.vectors(race,rows,history(race));
    const sig=JSON.stringify([rows.map(h=>String(h.horse_no)),market,vectors,M.modelSignature||M.version]);
    const prev=cache.get(race);if(prev?.signature===sig)return {...prev,rows};
    const base=typeof probabilityOriginal==='function'?probabilityOriginal(race,rows.slice(),'main'):[];
    const pByNo=new Map(base.map(h=>[String(h.horse_no),Number(h.tkp_probability)]));
    const fallback=rows.map((h,i)=>Math.log(Math.max(1e-12,pByNo.get(String(h.horse_no))||market[i])));
    const scores=[];
    for(let pos=1;pos<=5;pos++){
      const spec=M.positions[String(pos)];
      scores.push(spec?.enabled?vectors.map((x,i)=>x.reduce((s,v,j)=>s+v*spec.weights[j],0)+Math.log(market[i])*spec.weights[x.length]):fallback.slice());
    }
    const value={signature:sig,rows,scores,market};cache.set(race,value);return value;
  }
  function conditional(scores,used){
    const indexes=scores.map((_,i)=>i).filter(i=>!used.includes(i));
    const p=softmax(indexes.map(i=>scores[i]));return indexes.map((i,k)=>({i,p:p[k]}));
  }
  function marginals(prepared,maxStates=512){
    if(prepared.marginals)return prepared.marginals;
    const result=[],coverage=[];let states=[{used:[],mass:1}];
    const depth=Math.min(3,prepared.rows.length);
    for(let pos=0;pos<depth;pos++){
      coverage.push(states.reduce((s,x)=>s+x.mass,0));
      const values=prepared.rows.map(()=>0),next=new Map();
      for(const state of states)for(const row of conditional(prepared.scores[pos],state.used)){
        const mass=state.mass*row.p;values[row.i]+=mass;
        if(pos+1<depth){const used=state.used.concat(row.i).sort((a,b)=>a-b),key=used.join(',');
          if(next.has(key))next.get(key).mass+=mass;else next.set(key,{used,mass});}
      }
      result.push(values);states=[...next.values()].sort((a,b)=>b.mass-a.mass).slice(0,maxStates);
    }
    return prepared.marginals={values:result,coverage};
  }
  function rankings(race,rows,product){
    const prepared=prepare(race,rows);if(!prepared)return null;
    const marginal=marginals(prepared),out={};
    for(let pos=1;pos<=5;pos++){
      const values=marginal.values[pos-1]||prepared.rows.map(()=>0);
      out['p'+pos]=prepared.rows.map((h,i)=>({...h,__positionProbability:values[i]})).sort((a,b)=>b.__positionProbability-a.__positionProbability||String(a.horse_no).localeCompare(String(b.horse_no),undefined,{numeric:true}));
      out['p'+pos].forEach((h,i)=>{
        h['sidebet_p'+pos+'_rank']=i+1;h['sidebet_p'+pos+'_score']=h.__positionProbability*100;
        if(product){h['sidebet_'+product+'_p'+pos+'_rank']=i+1;h['sidebet_'+product+'_p'+pos+'_score']=h.__positionProbability*100;}
        h.r1671_model=M.version;h.r1671_retained_mass=marginal.coverage[pos-1]||0;
      });
    }
    return out;
  }
  function sequenceProbability(race,sequence){
    const p=prepare(race,race?.horses);if(!p)return null;
    const used=[];let probability=1;
    if(!Array.isArray(sequence)||sequence.length>5)return 0;
    for(let pos=0;pos<sequence.length;pos++){
      const no=String(sequence[pos]?.horse_no??sequence[pos]),i=p.rows.findIndex(h=>String(h.horse_no)===no);
      const row=conditional(p.scores[pos],used).find(r=>r.i===i);if(!row)return 0;
      probability*=row.p;used.push(i);
    }
    return probability;
  }
  function merge(base,learned,positions){
    if(!learned)return base;
    const out={...base};for(const pos of positions)if(M.positions[String(pos)]?.enabled)out['p'+pos]=learned['p'+pos];
    return out;
  }
  // Generic ticket routing is ordered-pair P2; triple alone uses learned P2/P3.
  // Quartet/quintet did not improve at equal ticket counts and keep their old route.
  function orderedPairRankings(race,rows,base){return merge(base||(typeof original==='function'?original(race,rows):null),rankings(race,rows),[2]);}
  if(typeof productOriginal==='function')global.tkpSideBetProductPositionRankingsForRace=function(race,rows,product){const base=productOriginal.apply(this,arguments);return product==='triple'?merge(base,rankings(race,rows,product),[2,3]):base;};
  const invalidate=()=>{histories=new Map();cache=new WeakMap();};
  global.TKP_POSITION_RUNTIME={version:M.version,eligible,prepare,marginals,rankings,orderedPairRankings,sequenceProbability,invalidate,enabledPositions:Object.keys(M.positions).filter(k=>M.positions[k].enabled)};
  if(global.addEventListener)global.addEventListener('tkp:db-changed',invalidate);
})(typeof window!=='undefined'?window:globalThis);
