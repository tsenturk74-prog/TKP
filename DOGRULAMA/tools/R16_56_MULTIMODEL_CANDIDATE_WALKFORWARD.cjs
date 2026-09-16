'use strict';
/*
 * TEK için "ilk sıradakini filtrele" deneyi değildir.
 * Her koşudaki her at, birbirinden bağımsız sinyal aileleri tarafından aday
 * değerlendirilir. Model / kapı seçimi doğrulamada yapılır; holdout'a yalnız
 * bir kez bakılır. Resmi sonuç hiçbir özellikte kullanılmaz.
 *
 * node R16_56_MULTIMODEL_CANDIDATE_WALKFORWARD.cjs backup.tkbz [report.json]
 */
const fs=require('fs'),zlib=require('zlib');
const input=process.argv[2],output=process.argv[3]||'R16_56_MULTIMODEL_CANDIDATE_WALKFORWARD.json';
if(!input)throw Error('Kullanım: node R16_56_MULTIMODEL_CANDIDATE_WALKFORWARD.cjs backup.tkbz [report.json]');
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const yes=v=>v===true||v===1||v==='1';
function load(path){
  const b=zlib.gunzipSync(fs.readFileSync(path));let o=0,take=k=>{const x=b.subarray(o,o+k);o+=k;return x;},u32=()=>{const x=b.readUInt32BE(o);o+=4;return x;};
  if(take(4).toString()!=='TKPB')throw Error('TKPB başlığı yok');u32();const e=JSON.parse(take(u32()).toString()),out={};
  for(const d of e.collections||[]){out[d.name]=[];for(let i=0;i<d.chunks;i++)out[d.name].push(...JSON.parse(take(u32()).toString()));}
  return out;
}
function pctRank(rows,key,desc=true){
  const known=rows.filter(x=>x.raw[key]!==null).sort((a,b)=>desc?b.raw[key]-a.raw[key]:a.raw[key]-b.raw[key]);
  const m=new Map();known.forEach((x,i)=>m.set(x.no,(known.length-i)/Math.max(1,known.length)));return x=>m.get(x.no)||0;
}
function makeRace(r){
  const horses=(r.horses||[]).filter(h=>String(h?.horse_no??'').trim());const winner=horses.find(h=>yes(h.winner)||String(h.finish_position)==='1');
  if(!winner||!horses.length)return null;
  const rows=horses.map(h=>({no:String(h.horse_no),winner:String(h.horse_no)===String(winner.horse_no),raw:{
    score:n(h.prediction_score_snapshot??h.score??h.pre_race_tkp_score),agf:n(h.agf),tr:n(h.tr_puan),ypuan:n(h.ypuan),hnd:n(h.hndkp),value:n(h.value_score),jbyg:n(h.jbyg),galop:n(h.galop_rank??h.glp_rank),
    bmb:yes(h.bmb)?1:0,trbmb:yes(h.tr_bmb_candidate)?1:0,hidden:yes(h.tr_hidden_fav)?1:0,trg:n(h.tr_ganyan),prior:n(h.priorWins),cond:n(h.condWinPct),accurate:n(h.priorAccurateFinishSignal),g800:n(h.g800),sp:n(h.sp)
  }}));
  const score=pctRank(rows,'score'),agf=pctRank(rows,'agf'),tr=pctRank(rows,'tr'),yp=pctRank(rows,'ypuan'),hnd=pctRank(rows,'hnd'),value=pctRank(rows,'value'),jbyg=pctRank(rows,'jbyg'),galop=pctRank(rows,'galop',false),trg=pctRank(rows,'trg',false),prior=pctRank(rows,'prior'),cond=pctRank(rows,'cond'),accurate=pctRank(rows,'accurate'),g800=pctRank(rows,'g800',false),sp=pctRank(rows,'sp',false);
  for(const x of rows)x.f=[1,score(x),agf(x),tr(x),yp(x),hnd(x),value(x),jbyg(x),galop(x),x.raw.bmb,x.raw.trbmb,x.raw.hidden,trg(x),prior(x),cond(x),accurate(x),g800(x),sp(x)];
  return {id:r.id,date:String(r.race_date||''),seq:Number(r.sequence_no)||0,profile:[r.surface,r.breed].map(x=>String(x||'?')).join('|'),rows};
}
function softmax(a){const m=Math.max(...a),e=a.map(x=>Math.exp(Math.max(-50,Math.min(50,x-m)))),s=e.reduce((x,y)=>x+y,0)||1;return e.map(x=>x/s);}
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
function fit(train,active){
  const w=Array(18).fill(0),acc=Array(18).fill(1e-4),on=new Set(active);const epochs=45;
  for(let ep=0;ep<epochs;ep++){
    const lr=.19/(1+ep*.055);
    for(const race of train){const p=softmax(race.rows.map(x=>dot(w,x.f)));for(let i=0;i<race.rows.length;i++){const g=(race.rows[i].winner?1:0)-p[i];for(const j of on){const grad=g*race.rows[i].f[j]-.002*w[j];acc[j]+=grad*grad;w[j]+=lr*grad/Math.sqrt(acc[j]);}}}
  }
  return w;
}
function predMap(race,w){const p=softmax(race.rows.map(x=>dot(w,x.f))),m=new Map();race.rows.forEach((x,i)=>m.set(x.no,{row:x,p:p[i]}));return m;}
function ranked(m){return [...m.values()].sort((a,b)=>b.p-a.p);}
function wilson(hit,total){if(!total)return 0;const z=1.96,p=hit/total,d=1+z*z/total;return (p+z*z/(2*total)-z*Math.sqrt((p*(1-p)+z*z/(4*total))/total))/d;}

// Sinyal aileleri bağımsız tutulur. Bu, tek bir eski TKP sıralamasına kör
// biçimde bağlanmak yerine farklı adaylar üretir.
const F={
  snapshot:[1],
  market:[1,2,3,4,5,6,7,9,10,11,12,13],
  provider:[2,3,4,5,6,7,10,11,12],
  form:[1,8,13,14,15,16,17],
  all:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]
};
function buildModels(train){
  const out={};for(const [name,active] of Object.entries(F))out[name]=fit(train,active);
  // Geçmişin tamamının bugünkü yarış davranışını temsil ettiği varsayımı doğru
  // olmayabilir. Bu iki model, yakın dönem ve pist/safkan uzmanlığını ayrıca
  // sınar; doğrulama/holdout geçmezse canlıya giremez.
  out.recent_all=fit(train.slice(-Math.min(700,train.length)),F.all);
  const buckets=new Map();for(const race of train){const a=buckets.get(race.profile)||[];a.push(race);buckets.set(race.profile,a);}
  const byProfile={};for(const [key,rows] of buckets)if(rows.length>=80)byProfile[key]=fit(rows,F.all);
  out.type_expert={global:out.all,byProfile};
  return out;
}
function mapsFor(race,models){const o={};for(const [k,w] of Object.entries(models)){const actual=w?.byProfile?(w.byProfile[race.profile]||w.global):w;o[k]=predMap(race,actual);}return o;}
function candidateBy(maps,name){const list=ranked(maps[name]);return {chosen:list[0],confidence:list[0].p,gap:list[0].p-(list[1]?.p||0),support:1};}
function weightedCandidate(maps,weights,{excludeSnapshotLeader=false,needSupport=0}={}){
  const nos=[...maps.all.keys()],tops={};for(const [name,m] of Object.entries(maps))tops[name]=new Set(ranked(m).slice(0,3).map(x=>x.row.no));
  const snapshotLead=ranked(maps.snapshot)[0].row.no;
  let c=nos.map(no=>{
    const p=Object.entries(weights).reduce((s,[k,v])=>s+v*(maps[k].get(no)?.p||0),0);
    const support=Object.entries(tops).filter(([k,set])=>k!=='snapshot'&&set.has(no)).length;
    return {row:maps.all.get(no).row,p,support};
  });
  if(excludeSnapshotLeader)c=c.filter(x=>x.row.no!==snapshotLead&&x.support>=needSupport);
  c.sort((a,b)=>b.p-a.p||b.support-a.support);const first=c[0];if(!first)return null;
  return {chosen:first,confidence:first.p,gap:first.p-(c[1]?.p||0),support:first.support};
}
const STRATEGIES={
  snapshot:m=>candidateBy(m,'snapshot'),
  market_ranker:m=>candidateBy(m,'market'),
  provider_ranker:m=>candidateBy(m,'provider'),
  form_ranker:m=>candidateBy(m,'form'),
  all_signal_ranker:m=>candidateBy(m,'all'),
  recent_ranker:m=>candidateBy(m,'recent_all'),
  race_type_expert:m=>candidateBy(m,'type_expert'),
  consensus_ensemble:m=>weightedCandidate(m,{market:.35,provider:.25,form:.20,all:.20}),
  adaptive_ensemble:m=>weightedCandidate(m,{recent_all:.32,type_expert:.28,market:.18,form:.12,provider:.10}),
  // Bu iki model ilk TKP liderini bilinçli olarak dışarıda bırakır: adayın en az
  // iki bağımsız aileden ilk 3 desteği yoksa hiç aday üretmez.
  challenger_2_support:m=>weightedCandidate(m,{provider:.42,form:.30,market:.18,all:.10},{excludeSnapshotLeader:true,needSupport:2}),
  challenger_3_support:m=>weightedCandidate(m,{provider:.35,form:.35,market:.20,all:.10},{excludeSnapshotLeader:true,needSupport:3})
};
function choose(race,models,strategy){return STRATEGIES[strategy](mapsFor(race,models));}
function evaluate(rows,models,strategy,gate){
  let eligible=0,selected=0,hits=0,changed=0,baseHits=0;
  for(const r of rows){
    const maps=mapsFor(r,models),base=ranked(maps.snapshot)[0],c=STRATEGIES[strategy](maps);if(base.row.winner)baseHits++;
    // Ham olasılık, alan 5 atlıyken ve 15 atlıyken aynı anlama gelmez. Bu yüzden
    // kapı olasılığı yarıştaki at sayısına göre normalize edilir: 1 = rastgele
    // eşit olasılık düzeyi, 1.20 = rastgele seçime göre %20 daha güçlü aday.
    if(!c)continue;eligible++;const strength=c.confidence*r.rows.length,separation=c.gap*r.rows.length;
    if(strength>=gate.strength&&separation>=gate.separation){selected++;if(c.chosen.row.winner)hits++;if(c.chosen.row.no!==base.row.no)changed++;}
  }
  return {races:rows.length,eligible,selected,hits,rate:selected?+(hits/selected).toFixed(4):null,wilson:+wilson(hits,selected).toFixed(4),changed,changed_rate:selected?+(changed/selected).toFixed(4):null,baseline_snapshot_rate:+(baseHits/Math.max(1,rows.length)).toFixed(4)};
}
function bestGate(validation,models,strategy){
  // Geniş bir eşik ızgarasında en iyi tesadüfü aramak overfit üretir. Önceden
  // tanımlı, az sayıda anlamlı güç/ayrışma seviyesi kullanıyoruz.
  const strengths=[.80,.95,1.05,1.15,1.30,1.50],separations=[0,.05,.10,.20];
  const a=[];for(const strength of strengths)for(const separation of separations){const gate={strength,separation},e=evaluate(validation,models,strategy,gate);if(e.selected>=25)a.push({gate,...e});}
  a.sort((x,y)=>y.wilson-x.wilson||y.selected-x.selected||y.rate-x.rate);return a[0]||{gate:{p:.99,gap:.99},selected:0,hits:0,rate:null,wilson:0};
}
function run(){
  const db=load(input),races=(db.races||[]).map(makeRace).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq||a.id-b.id);
  const a=Math.floor(races.length*.60),b=Math.floor(races.length*.80),train=races.slice(0,a),validation=races.slice(a,b),holdout=races.slice(b),models=buildModels(train);
  const results=[];for(const strategy of Object.keys(STRATEGIES)){
    const gate=bestGate(validation,models,strategy),holdoutResult=evaluate(holdout,models,strategy,gate);
    // Eşik üstü seçimi ile modelin ham aday kalitesini ayır: dağılım kayması
    // eşiği boşaltabilir, fakat eşiksiz yarış-başı aday sonucu gerçeği gösterir.
    const holdoutNoGate=evaluate(holdout,models,strategy,{strength:0,separation:0});
    results.push({strategy,validation:gate,holdout:holdoutResult,holdout_no_gate:holdoutNoGate,decision:holdoutResult.selected>=25&&holdoutResult.rate>holdoutResult.baseline_snapshot_rate&&holdoutResult.wilson>=.40?'ADAY':'KANIT YETERSİZ'});
  }
  results.sort((x,y)=>y.validation.wilson-x.validation.wilson);
  const r=xs=>({rows:xs.length,from:xs[0]?.date||null,to:xs.at(-1)?.date||null});
  const report={version:'R16.56-MULTIMODEL-ALL-HORSE-CANDIDATE-WALKFORWARD',contract:'Her koşudaki her at adaydır. Sonuç alanı yalnız eğitim etiketi/test ölçümüdür. Kapı ve model seçimi validation ile yapılır; holdout seçimde kullanılmaz.',features:['TKP score','AGF','TR puan','Y.PUAN','HNDKP','VALUE','JBYG','galop','BMB','TR BMB','TR hidden','TR ganyan','önceki galibiyet','kondisyon kazanma','Accurate','800m galop','SP'],all_official_result_races:races.length,split:{train:r(train),validation:r(validation),holdout:r(holdout)},model_families:{...F,recent_all:'Son 700 eğitim koşusu',type_expert:'Pist+safkan profili; en az 80 eğitim koşusu, yoksa genel model'},results,live_model_note:'Canlıya yalnız holdout kanıtı bulunan model alınabilir; burada model ağırlıkları tüm veriyle henüz yeniden eğitilmedi.'};
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
run();
