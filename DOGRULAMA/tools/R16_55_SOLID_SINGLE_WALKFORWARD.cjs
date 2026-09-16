'use strict';
/*
 * R16.55 sağlam TEK araştırması. Girdi alanları yalnız yarış öncesi program
 * verileridir; resmi sonuç sadece y=kazanan etiketi olarak en sonda kullanılır.
 * node R16_55_SOLID_SINGLE_WALKFORWARD.cjs backup.tkbz [report.json]
 */
const fs=require('fs'),zlib=require('zlib');
const input=process.argv[2],output=process.argv[3]||'R16_55_SOLID_SINGLE_WALKFORWARD.json';
if(!input)throw Error('Kullanım: node R16_55_SOLID_SINGLE_WALKFORWARD.cjs backup.tkbz [report.json]');
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const yes=v=>v===true||v===1||v==='1';
function load(path){
  const b=zlib.gunzipSync(fs.readFileSync(path));let o=0,take=k=>{const x=b.subarray(o,o+k);o+=k;return x;},u32=()=>{const x=b.readUInt32BE(o);o+=4;return x;};
  if(take(4).toString()!=='TKPB')throw Error('TKPB başlığı yok');u32();const e=JSON.parse(take(u32()).toString()),out={};
  for(const d of e.collections||[]){out[d.name]=[];for(let i=0;i<d.chunks;i++)out[d.name].push(...JSON.parse(take(u32()).toString()));}
  return out;
}
function pctRank(rows,key,desc=true){
  const known=rows.filter(x=>x.raw[key]!==null).sort((a,b)=>desc?b.raw[key]-a.raw[key]:a.raw[key]-b.raw[key]);const m=new Map();known.forEach((x,i)=>m.set(x.no,(known.length-i)/Math.max(1,known.length)));return x=>m.get(x.no)||0;
}
function makeRace(r){
  const horses=(r.horses||[]).filter(h=>String(h?.horse_no??'').trim());const winner=horses.find(h=>yes(h.winner)||String(h.finish_position)==='1');if(!winner||!horses.length)return null;
  const rows=horses.map(h=>({no:String(h.horse_no),winner:String(h.horse_no)===String(winner.horse_no),raw:{
    score:n(h.prediction_score_snapshot??h.score??h.pre_race_tkp_score),agf:n(h.agf),tr:n(h.tr_puan),ypuan:n(h.ypuan),hnd:n(h.hndkp),value:n(h.value_score),jbyg:n(h.jbyg),galop:n(h.galop_rank??h.glp_rank),bmb:yes(h.bmb)?1:0,trbmb:yes(h.tr_bmb_candidate)?1:0,hidden:yes(h.tr_hidden_fav)?1:0,
    trg:n(h.tr_ganyan),prior:n(h.priorWins),cond:n(h.condWinPct),accurate:n(h.priorAccurateFinishSignal),g800:n(h.g800),sp:n(h.sp)
  }}));
  const score=pctRank(rows,'score'),agf=pctRank(rows,'agf'),tr=pctRank(rows,'tr'),yp=pctRank(rows,'ypuan'),hnd=pctRank(rows,'hnd'),value=pctRank(rows,'value'),jbyg=pctRank(rows,'jbyg'),galop=pctRank(rows,'galop',false),trg=pctRank(rows,'trg',false),prior=pctRank(rows,'prior'),cond=pctRank(rows,'cond'),accurate=pctRank(rows,'accurate'),g800=pctRank(rows,'g800',false),sp=pctRank(rows,'sp',false);
  for(const x of rows)x.f=[1,score(x),agf(x),tr(x),yp(x),hnd(x),value(x),jbyg(x),galop(x),x.raw.bmb,x.raw.trbmb,x.raw.hidden,trg(x),prior(x),cond(x),accurate(x),g800(x),sp(x)];
  return {id:r.id,date:String(r.race_date||''),seq:Number(r.sequence_no)||0,profile:[r.surface,r.condition_family,r.distance_group,r.breed].map(x=>String(x||'?')).join('|'),rows};
}
function softmax(a){const m=Math.max(...a),e=a.map(x=>Math.exp(Math.max(-50,Math.min(50,x-m)))),s=e.reduce((x,y)=>x+y,0)||1;return e.map(x=>x/s);}
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function fit(train,dim){
  const w=Array(dim).fill(0),acc=Array(dim).fill(1e-4);const epochs=45;
  for(let ep=0;ep<epochs;ep++){
    const lr=.19/(1+ep*.055);
    for(const race of train){const p=softmax(race.rows.map(x=>dot(w,x.f)));for(let i=0;i<race.rows.length;i++){const g=(race.rows[i].winner?1:0)-p[i];for(let j=0;j<dim;j++){const grad=g*race.rows[i].f[j]-.002*w[j];acc[j]+=grad*grad;w[j]+=lr*grad/Math.sqrt(acc[j]);}}}
  }
  return w;
}
function predict(race,w){const p=softmax(race.rows.map(x=>dot(w,x.f)));return race.rows.map((x,i)=>({...x,p:p[i]})).sort((a,b)=>b.p-a.p);}
function wilson(hit,total){if(!total)return 0;const z=1.96,p=hit/total,d=1+z*z/total,c=(p+z*z/(2*total)-z*Math.sqrt((p*(1-p)+z*z/(4*total))/total))/d;return c;}
function evaluate(rows,w,gate){let selected=0,hits=0,baseHits=0;for(const r of rows){const o=predict(r,w),lead=o[0],gap=lead.p-(o[1]?.p||0);if(lead.winner)baseHits++;if(lead.p>=gate.p&&gap>=gate.gap){selected++;if(lead.winner)hits++;}}return {races:rows.length,selected,hits,rate:selected?+(hits/selected).toFixed(4):null,wilson:+wilson(hits,selected).toFixed(4),baseline_p1_rate:+(baseHits/Math.max(1,rows.length)).toFixed(4)};}
function main(){
  const db=load(input),races=(db.races||[]).map(makeRace).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq||a.id-b.id);
  const a=Math.floor(races.length*.60),b=Math.floor(races.length*.80),train=races.slice(0,a),validation=races.slice(a,b),holdout=races.slice(b);const w=fit(train,18);
  const candidates=[];for(let pi=18;pi<=52;pi+=2)for(let gi=0;gi<=22;gi+=2){const gate={p:pi/100,gap:gi/100};const e=evaluate(validation,w,gate);if(e.selected>=15)candidates.push({gate,...e});}
  candidates.sort((x,y)=>y.wilson-x.wilson||y.selected-x.selected||y.rate-x.rate);
  const best=candidates[0]||{gate:{p:.99,gap:.99},selected:0,hits:0,rate:null,wilson:0};
  const hold=evaluate(holdout,w,best.gate),baseline=evaluate(holdout,w,{p:0,gap:0});
  // Holdout sonucu görüldükten sonra canlıda kullanılacak nihai ağırlıklar tüm
  // 2.886 resmî sonuçla yeniden eğitilir. Bu ağırlıklar holdout skorunu değiştirmez.
  const finalWeights=fit(races,18);
  const range=rows=>({from:rows[0]?.date||null,to:rows.at(-1)?.date||null});
  const report={version:'R16.55-SOLID-SINGLE-WALKFORWARD',contract:'Model yalnız yarış-öncesi score/AGF/TR/Y.PUAN/HNDKP/VALUE/JBYG/galop/BMB alanlarını görür; sonuç yalnız eğitim etiketi ve test ölçümüdür.',
    all_official_result_races:races.length,
    split:{train:{rows:train.length,...range(train)},validation:{rows:validation.length,...range(validation)},holdout:{rows:holdout.length,...range(holdout)}},
    validation_weights:w.map(x=>+x.toFixed(5)),validation_gate:best,top_validation_gates:candidates.slice(0,12),holdout:hold,holdout_baseline_p1:baseline,
    final_live_model:{trained_with_all_official_result_races:races.length,weights:finalWeights.map(x=>+x.toFixed(5)),rule:'Holdout yalnız kanıt içindi; nihai canlı ağırlıklar tüm sonuçlarla yeniden eğitildi.'},
    decision:hold.selected>=10&&hold.rate!==null&&hold.rate>hold.baseline_p1_rate&&hold.wilson>=.40?'ADAY TEK KAPISI VAR':'SAĞLAM TEK KAPISI KANITLANMADI; CANLIYA ALMA'};
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main();
