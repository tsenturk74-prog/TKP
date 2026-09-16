(function(root){
  'use strict';
  const VERSION='R16.71-features-2';
  const fields=[['handicap',['hndkp']],['weight',['weight_kg','kg']],['draw',['start_no']],['workout',['g800']],['TR',['tr_ganyan','tr_puan']],['team',['jbyg_rate','team_strength_pct']],['jbyg',['jbyg']],['commentators',['ypuan','y_puan']]];
  const post=['finish_position','accurate_avg_speed_mps','accurate_closing_speed_mps','accurate_finish_signal','accurate_fark'];
  const names=fields.map(x=>x[0]).concat(['horse_win','horse_starts','jockey_win','trainer_win'],post.map(x=>'previous_'+x));
  const num=v=>{if(v==null||v==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};
  const name=v=>String(v||'').trim().toLocaleLowerCase('tr-TR');
  const live=h=>h&&!h.non_runner&&!h.is_non_runner&&!h.scratched;
  function keys(h){return [['horse',name(h.horse_name)],['jockey',name(h.jockey_name)],['trainer',name(h.trainer_name)]].filter(x=>x[1]);}
  function update(history,race){
    const resolved=(race.horses||[]).filter(live).filter(h=>num(h.finish_position)===1||Number(h.winner)===1).length===1;
    for(const h of (race.horses||[]).filter(live))for(const [kind,key] of keys(h)){
      const id=kind+':'+key,s=history.get(id)||{starts:0,wins:0,metrics:{}};
      const finish=num(h.finish_position),won=finish===1||Number(h.winner)===1;
      // Missing results still contribute participation; no fabricated loss label.
      if(resolved||finish!==null&&finish>0||won){s.starts++;s.wins+=won?1:0;}
      if(kind==='horse')for(const k of post){const v=num(h[k]);if(v!==null){const m=s.metrics[k]||{count:0,sum:0};m.count++;m.sum+=v;s.metrics[k]=m;}}
      history.set(id,s);
    }
  }
  function values(h,history){
    const value=fields.map(([,aliases])=>{for(const k of aliases){const v=num(h[k]);if(v!==null)return v;}return null;});
    const a=history.get('horse:'+name(h.horse_name)),j=history.get('jockey:'+name(h.jockey_name)),t=history.get('trainer:'+name(h.trainer_name));
    const rate=s=>s?(s.wins+1)/(s.starts+8):1/8;
    return value.concat([rate(a),Math.log1p(a?.starts||0),rate(j),rate(t)],post.map(k=>a?.metrics?.[k]?.count?a.metrics[k].sum/a.metrics[k].count:null));
  }
  function vectors(race,horses,history){
    const all=horses.map(h=>values(h,history)),out=horses.map(()=>[]);
    for(let j=0;j<names.length;j++){
      const known=all.map(v=>v[j]).filter(v=>v!==null),mean=known.reduce((s,v)=>s+v,0)/(known.length||1);
      const sd=Math.sqrt(known.reduce((s,v)=>s+(v-mean)**2,0)/(known.length||1))||1;
      all.forEach((v,i)=>{const z=v[j]===null?0:Math.max(-3,Math.min(3,(v[j]-mean)/sd));out[i].push(z,z*Math.abs(z),v[j]===null?1:0);});
    }
    return out;
  }
  function historical(races,before){
    const history=new Map();
    for(const r of races||[])if(String(r.race_date||r.date||'')&&String(r.race_date||r.date)<String(before))update(history,r);
    return history;
  }
  const api={VERSION,names,post,num,live,update,vectors,historical};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TKP_LEARNED_FEATURES=api;
})(typeof globalThis!=='undefined'?globalThis:this);
