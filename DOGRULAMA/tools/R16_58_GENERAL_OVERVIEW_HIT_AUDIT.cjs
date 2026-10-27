'use strict';
/* Genel Bakış / prediction_log P1 kayıtlarını bağımsız denetler.
 * Varlık: resolved=1 + VERIFIED_TJK_PAYOUT. Her prediction_fp/ayak ayrı
 * bir Genel Bakış görüntüsüdür. Aynı fiziksel yarışın tekrarları ayrıca sayılır.
 */
const fs=require('fs'),zlib=require('zlib');
const input=process.argv[2],output=process.argv[3]||'R16_58_GENERAL_OVERVIEW_HIT_AUDIT.json';
if(!input)throw Error('Kullanım: node R16_58_GENERAL_OVERVIEW_HIT_AUDIT.cjs backup.tkbz [report.json]');
function load(path){const b=zlib.gunzipSync(fs.readFileSync(path));let o=0,t=k=>{const x=b.subarray(o,o+k);o+=k;return x},u=()=>{const x=b.readUInt32BE(o);o+=4;return x};if(t(4).toString()!=='TKPB')throw Error('TKPB başlığı yok');u();const h=JSON.parse(t(u()).toString()),db={};for(const c of h.collections||[]){db[c.name]=[];for(let i=0;i<c.chunks;i++)db[c.name].push(...JSON.parse(t(u()).toString()));}return db;}
const n=x=>Number.isFinite(Number(x))?Number(x):0;
function wilson(h,N){if(!N)return 0;const z=1.96,p=h/N,d=1+z*z/N;return (p+z*z/(2*N)-z*Math.sqrt((p*(1-p)+z*z/(4*N))/N))/d;}
function summary(a){const N=a.length,h=a.reduce((s,x)=>s+(x.winner?1:0),0);return {snapshots:N,hits:h,rate:N?+(h/N).toFixed(4):null,wilson:+wilson(h,N).toFixed(4)};}
function key(x){return [x.prediction_fp,x.race_date,x.hippodrome,x.leg].join('|');}
function build(log){
  const groups=new Map();for(const x of log.filter(x=>x.resolved===1&&x.result_integrity_status==='VERIFIED_TJK_PAYOUT')){const k=key(x);const a=groups.get(k)||[];a.push(x);groups.set(k,a);}
  const events=[];for(const [id,rows] of groups){rows.sort((a,b)=>n(a.predicted_rank)-n(b.predicted_rank));const top=rows[0],second=rows[1],sum=rows.reduce((s,x)=>s+Math.max(0,n(x.score)),0);if(n(top.predicted_rank)!==1)continue;const date=String(top.race_date||''),logTs=top.ts||null;events.push({id,date,version:top.strategy_version||'BİLİNMİYOR',winner:!!top.winner,score:n(top.score),gap:n(top.score)-n(second?.score),share:sum>0?n(top.score)/sum:0,field:rows.length,log_ts:logTs,timing:logTs&&String(logTs).slice(0,10)>date?'RACE_SONRASI_KAYIT':'AYNI_GÜN_VEYA_ÖNCESİ'});}
  return events.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
function by(a,field){const m=new Map;for(const x of a){const k=x[field],r=m.get(k)||[];r.push(x);m.set(k,r)}return [...m.entries()].map(([k,v])=>({[field]:k,...summary(v)})).sort((a,b)=>b.snapshots-a.snapshots);}
function selectorStudy(events){
  const p=Math.floor(events.length*.6),q=Math.floor(events.length*.8),val=events.slice(p,q),hold=events.slice(q);
  // Genel Bakış skorları sürümler arasında değiştiği için salt score değil,
  // ayak içindeki ilk atın toplam puandaki payı ve ikinci ata farkı kullanılır.
  const gates=[];for(const share of [.18,.22,.26,.30,.35,.40,.45])for(const gap of [0,.05,.10,.15,.20]){const s=val.filter(x=>x.share>=share&&x.gap>=gap);if(s.length>=25)gates.push({gate:{share,gap},...summary(s)});}
  gates.sort((a,b)=>b.wilson-a.wilson||b.snapshots-a.snapshots||b.rate-a.rate);const best=gates[0]||{gate:{share:1,gap:1},snapshots:0,hits:0,rate:null,wilson:0};
  return {split:{train:events.slice(0,p).length,validation:val.length,holdout:hold.length},validation_best:best,holdout_for_validation_gate:summary(hold.filter(x=>x.share>=best.gate.share&&x.gap>=best.gate.gap)),holdout_all_p1:summary(hold),top_validation_gates:gates.slice(0,12)};
}
function main(){const db=load(input),events=build(db.prediction_log||[]),versions=by(events,'version'),study=selectorStudy(events),timely=events.filter(x=>x.timing==='AYNI_GÜN_VEYA_ÖNCESİ'),late=events.filter(x=>x.timing==='RACE_SONRASI_KAYIT').length;const r={version:'R16.58-GENEL-BAKIS-P1-RESULT-AUDIT',contract:'Yalnız resmi sonucu doğrulanmış Genel Bakış/prediction_log P1 görüntüleri sayılır. Aynı yarışın farklı prediction_fp görüntüleri bağımsız yarış değildir; model kalitesi için sürüm ve kör dönem kontrolü şarttır.',verified_general_overview_p1_snapshots:events.length,all_p1:summary(events),by_strategy_version:versions,chronological_selector_study:study,logging_time_audit:{by_timing:by(events,'timing'),timely_only_p1:summary(timely),timely_only_selector_study:timely.length>=125?selectorStudy(timely):null},data_integrity_warning:{records_logged_after_race_date:late,meaning:'Bu kayıtlar geçmiş veri üstünde sonradan üretilmiş olabilir. Yüksek oranları canlı tahmin başarısı diye kabul etmeden önce yarış öncesi kilitli snapshot kanıtı gerekir.'}};fs.writeFileSync(output,JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));}
main();
