'use strict';
const fs=require('fs'), zlib=require('zlib'), path=require('path');

const input=process.argv[2];
const output=process.argv[3]||input;
const reportPath=process.argv[4]||path.join(path.dirname(output),'ARCHIVE_DATA_INTEGRITY_REPORT.json');
if(!input) throw new Error('usage: node ARCHIVE_INTEGRITY_REPAIR.cjs input.tkbz [output.tkbz] [report.json]');

function decode(file){
  const raw=zlib.gunzipSync(fs.readFileSync(file)); let o=0;
  const take=n=>{if(o+n>raw.length)throw new Error('truncated backup');const b=raw.subarray(o,o+n);o+=n;return b;};
  const u32=()=>{if(o+4>raw.length)throw new Error('truncated u32');const n=raw.readUInt32BE(o);o+=4;return n;};
  if(take(4).toString('utf8')!=='TKPB')throw new Error('bad TKPB magic');
  const version=u32(); const env=JSON.parse(take(u32()).toString('utf8'));
  const chunksByName=new Map();
  for(const d of env.collections||[]){
    const chunks=[]; for(let i=0;i<Number(d.chunks||0);i++) chunks.push(JSON.parse(take(u32()).toString('utf8')));
    chunksByName.set(d.name,chunks);
  }
  if(o!==raw.length)throw new Error(`unexpected trailing bytes: ${raw.length-o}`);
  return {version,env,chunksByName};
}
function encode({version,env,chunksByName},file){
  const parts=[]; const pushU32=n=>{const b=Buffer.allocUnsafe(4);b.writeUInt32BE(n>>>0);parts.push(b);};
  parts.push(Buffer.from('TKPB')); pushU32(version);
  const e=Buffer.from(JSON.stringify(env),'utf8'); pushU32(e.length); parts.push(e);
  for(const d of env.collections||[]){for(const chunk of chunksByName.get(d.name)||[]){const b=Buffer.from(JSON.stringify(chunk),'utf8');pushU32(b.length);parts.push(b);}}
  fs.writeFileSync(file,zlib.gzipSync(Buffer.concat(parts),{level:9}));
}
const arr=(pack,name)=>(pack.chunksByName.get(name)||[]).flat();
const baseNo=v=>String(v??'').trim().replace(/-E\d+$/i,'').match(/^\d+/)?.[0]||'';
const fold=v=>String(v??'').toLocaleUpperCase('tr-TR').replace(/[₺©®™]/g,' ').replace(/\b(?:KG|DB|SKG|SK|K|AP|OG|ÖG|GKR|SGKR)\b/g,' ').replace(/[^0-9A-ZÇĞİÖŞÜ]+/g,' ').replace(/\s+/g,' ').trim();
const raceKey=r=>`${String(r.race_date||'')}|${fold(r.hippodrome)}|${Number(r.leg)||0}`;
const fileMeetingKey=f=>`${String(f.race_date||'')}|${fold(f.hippodrome)}|${Number(f.altili_no)||1}`;
const specs={sirali_ikili:2,uclu_bahis:3,tabela:4,sirali_5li:5};
function strictCombo(text,n){
  const s=String(text||'').trim();
  if(!new RegExp(`^\\d+(?:/\\d+){${n-1}}$`).test(s))return null;
  const a=s.split('/'); if(a.length!==n||new Set(a).size!==a.length)return null; return a;
}
function orderedPayoutEvidence(r){
  const seqs=[];
  for(const [key,n] of Object.entries(specs)) for(const p of r.payouts||[]){
    if(p?.key!==key)continue; const seq=strictCombo(p.combo,n); if(seq)seqs.push({key,seq});
  }
  if(!seqs.length)return {status:'NO_ORDERED_PAYOUT',depth:0,seq:null,evidence:[]};
  const uniq=[]; const seen=new Set();
  for(const x of seqs){const sig=x.seq.join('/');if(!seen.has(`${x.key}|${sig}`)){seen.add(`${x.key}|${sig}`);uniq.push(x);}}
  let conflict=false;
  for(let i=0;i<uniq.length;i++)for(let j=i+1;j<uniq.length;j++){
    const m=Math.min(uniq[i].seq.length,uniq[j].seq.length);
    if(uniq[i].seq.slice(0,m).join('/')!==uniq[j].seq.slice(0,m).join('/'))conflict=true;
  }
  if(conflict)return {status:'AMBIGUOUS_PAYOUT_OR_TIE',depth:0,seq:null,evidence:uniq};
  const best=uniq.slice().sort((a,b)=>b.seq.length-a.seq.length)[0];
  const horses=r.horses||[], byNo=new Map();
  for(const h of horses){const n=baseNo(h.horse_no);if(!n)continue;if(!byNo.has(n))byNo.set(n,[]);byNo.get(n).push(h);}
  if(best.seq.some(n=>(byNo.get(n)||[]).length!==1))return {status:'PAYOUT_HORSE_MATCH_FAILED',depth:0,seq:null,evidence:uniq};
  return {status:'VERIFIED_TJK_PAYOUT',depth:best.seq.length,seq:best.seq,evidence:uniq};
}
function clearUntrustedHorseFields(h,stats){
  if(h.start_no!==null&&h.start_no!==undefined&&h.start_no!=='')stats.startNoQuarantined++;
  h.start_no=null;
  for(const k of ['result_time','official_time']){
    if(h[k]!==null&&h[k]!==undefined&&String(h[k]).trim())stats.resultTimeQuarantined++;
    h[k]='';
  }
}

const pack=decode(input), files=arr(pack,'files'), races=arr(pack,'races'), pred=arr(pack,'prediction_log'), forward=arr(pack,'forward_tracking_log');
const stats={files:files.length,races:races.length,horses:0,verifiedRaces:0,unverifiedRaces:0,ambiguousRaces:0,depth2:0,depth3:0,depth4:0,depth5:0,oldMultipleWinnerRaces:0,oldDuplicateFinishRankRaces:0,winnerCorrections:0,positionCorrections:0,startNoQuarantined:0,resultTimeQuarantined:0,raceCachePurged:0,predictionRowsRechecked:0,predictionRowsResolved:0,predictionRowsQuarantined:0,forwardRowsRechecked:0};
const verifiedByKey=new Map();
for(const r of races){
  const hs=r.horses||[]; stats.horses+=hs.length;
  const oldW=hs.filter(h=>Number(h.finish_position)===1||Number(h.winner)===1); if(oldW.length>1)stats.oldMultipleWinnerRaces++;
  const oldPos=hs.map(h=>Number(h.finish_position)).filter(n=>Number.isInteger(n)&&n>0); if(new Set(oldPos).size<oldPos.length)stats.oldDuplicateFinishRankRaces++;
  const oldByHorse=new Map(hs.map(h=>[h,{fp:Number(h.finish_position)||null,w:Number(h.winner)===1?1:0}]));
  const ev=orderedPayoutEvidence(r);
  for(const h of hs){h.finish_position=null;h.winner=0;clearUntrustedHorseFields(h,stats);}
  if(r.__tkpLiveHorsesCache!==undefined||r.__tkpLiveHorsesSrc!==undefined){delete r.__tkpLiveHorsesCache;delete r.__tkpLiveHorsesSrc;stats.raceCachePurged++;}
  r.result_verified_depth=0; r.result_integrity_source=''; r.result_integrity_status=ev.status;
  if(ev.status==='VERIFIED_TJK_PAYOUT'){
    const posByNo=new Map(ev.seq.map((n,i)=>[n,i+1]));
    for(const h of hs){const p=posByNo.get(baseNo(h.horse_no));if(p){h.finish_position=p;h.winner=p===1?1:0;} const old=oldByHorse.get(h);if((old?.fp||null)!==(h.finish_position||null))stats.positionCorrections++;if((old?.w||0)!==(h.winner||0))stats.winnerCorrections++;}
    r.result_verified_depth=ev.depth; r.result_integrity_source='TJK_OFFICIAL_ORDERED_PAYOUT'; r.result_integrity_status='VERIFIED';
    stats.verifiedRaces++; stats['depth'+ev.depth]=(stats['depth'+ev.depth]||0)+1;
  }else{
    stats.unverifiedRaces++; if(ev.status==='AMBIGUOUS_PAYOUT_OR_TIE')stats.ambiguousRaces++;
  }
  const k=raceKey(r); if(!verifiedByKey.has(k))verifiedByKey.set(k,[]); verifiedByKey.get(k).push(r);
}
// File-level QC becomes explicit; old "SONUÇLAR GÜNCELLENDİ" is not trusted by itself.
const racesByFile=new Map();for(const r of races){const k=String(r.file_id);if(!racesByFile.has(k))racesByFile.set(k,[]);racesByFile.get(k).push(r);}
for(const f of files){const rs=racesByFile.get(String(f.id))||[];const verified=rs.filter(r=>Number(r.result_verified_depth)>=1).length;const quarantined=rs.length-verified;f.result_quality={...(f.result_quality||{}),verified_races:verified,quarantined_races:quarantined,race_count:rs.length,integrity_version:'R15.3_TJK_PAYOUT_FAIL_CLOSED'};f.qc_status=quarantined===0&&rs.length===6?'SONUÇ DOĞRULANDI':verified>0?'SONUÇ KISMİ DOĞRULANDI':'SONUÇ KARANTİNA';}
// Prediction outcome logs: re-resolve only when horse+race map is unique. Ambiguity becomes pending, never a guessed result.
function findRaceForLog(row){const candidates=verifiedByKey.get(`${String(row.race_date||'')}|${fold(row.hippodrome)}|${Number(row.leg)||0}`)||[];if(candidates.length===1)return candidates[0];const no=baseNo(row.horse_no),nm=fold(row.horse_name);const hits=candidates.filter(r=>(r.horses||[]).some(h=>baseNo(h.horse_no)===no&&(!nm||fold(h.horse_name)===nm)));return hits.length===1?hits[0]:null;}
for(const row of pred){stats.predictionRowsRechecked++;const r=findRaceForLog(row);if(!r||Number(r.result_verified_depth)<1){row.resolved=0;row.winner=0;delete row.finish_position;row.result_integrity_status='UNVERIFIED';stats.predictionRowsQuarantined++;continue;}const no=baseNo(row.horse_no),nm=fold(row.horse_name);const hs=(r.horses||[]).filter(h=>baseNo(h.horse_no)===no&&(!nm||fold(h.horse_name)===nm));const h=hs.length===1?hs[0]:(r.horses||[]).find(h=>baseNo(h.horse_no)===no);if(!h){row.resolved=0;row.winner=0;delete row.finish_position;row.result_integrity_status='HORSE_MATCH_FAILED';stats.predictionRowsQuarantined++;continue;}row.resolved=1;row.winner=Number(h.winner)===1?1:0;if(Number(h.finish_position)>0)row.finish_position=Number(h.finish_position);else delete row.finish_position;row.result_integrity_status='VERIFIED_TJK_PAYOUT';stats.predictionRowsResolved++;}
// Forward-tracking evaluation: winner is always known at depth>=1; top3/top5 only when verified to that depth.
for(const row of forward){stats.forwardRowsRechecked++;const key=`${String(row.race_date||'')}|${fold(row.hippodrome)}|${Number(row.leg)||0}`;let c=verifiedByKey.get(key)||[];if(c.length>1&&row.altili_no!=null){const want=Number(row.altili_no)||1;c=c.filter(r=>{const f=files.find(x=>String(x.id)===String(r.file_id));return (Number(f?.altili_no)||1)===want;});}const r=c.length===1?c[0]:null;const depth=Number(r?.result_verified_depth)||0;if(!r||depth<1){for(const k of ['winner_no','winner_name','leader_finish','leader_win','leader_top3','leader_top5','single_hit','bomb_any_win','bomb_any_top3','bomb_any_top5','single_finish','narrow_bmb_finish','narrow_bmb_win','odb_finish','odb_win','odb_top5','prof_finish','prof_win','prof_top5'])row[k]=null;row.result_integrity_status='UNVERIFIED';continue;}const hs=r.horses||[],winner=hs.find(h=>Number(h.winner)===1);row.winner_no=winner?baseNo(winner.horse_no):'';row.winner_name=winner?.horse_name||'';const byNo=n=>hs.find(h=>baseNo(h.horse_no)===baseNo(n));const leader=byNo(row.leader_no),lf=Number(leader?.finish_position)||0;row.leader_finish=lf||null;row.leader_win=winner&&baseNo(row.leader_no)===baseNo(winner.horse_no)?1:0;row.leader_top3=depth>=3?(lf>0&&lf<=3?1:0):null;row.leader_top5=depth>=5?(lf>0&&lf<=5?1:0):null;if(Number(row.single_candidate)===1){row.single_finish=row.leader_finish;row.single_hit=row.leader_win;}else{row.single_finish=null;row.single_hit=null;}const bombs=Array.isArray(row.bomb_candidates)?row.bomb_candidates:[];const bps=bombs.map(b=>Number(byNo(b.horse_no)?.finish_position)||0);row.bomb_any_win=bps.includes(1)?1:0;row.bomb_any_top3=depth>=3?(bps.some(p=>p>0&&p<=3)?1:0):null;row.bomb_any_top5=depth>=5?(bps.some(p=>p>0&&p<=5)?1:0):null;const nb=byNo(row.narrow_bmb_no),np=Number(nb?.finish_position)||0;row.narrow_bmb_finish=np||null;row.narrow_bmb_win=np===1?1:0;for(const k of ['odb_finish','odb_win','odb_top5','prof_finish','prof_win','prof_top5'])row[k]=null;row.result_integrity_status='VERIFIED_TJK_PAYOUT';}

// Source/provenance audit for table inputs.
const src={tr:{value:0,source:0,asofFuture:0,badSource:0},glp:{value:0,source:0,asofFuture:0,badSource:0},jbyg:{value:0,source:0,asofFuture:0,badSource:0},agf:{present:0,bad:0},kg:{present:0,bad:0},hndkp:{present:0,bad:0},bestTime:{present:0,badFormat:0},ypuan:{present:0,tagged:0}};
for(const r of races)for(const h of r.horses||[]){const rd=String(r.race_date||'').slice(0,10);if(h.tr_ganyan!=null&&h.tr_ganyan!==''){src.tr.value++;const s=String(h.tr_ganyan_source||'').toUpperCase();if(s)src.tr.source++;if(s!=='GANYAN_CANAVARI_TR')src.tr.badSource++;if(h.tr_ganyan_asof_date&&String(h.tr_ganyan_asof_date).slice(0,10)>rd)src.tr.asofFuture++;}if(h.g800!=null&&h.g800!==''){src.glp.value++;const s=String(h.glp_source||'').toUpperCase();if(s)src.glp.source++;if(s!=='GANYAN_CANAVARI_GALOPLAR_OZET')src.glp.badSource++;if(h.glp_asof_date&&String(h.glp_asof_date).slice(0,10)>rd)src.glp.asofFuture++;}if(h.jbyg!=null&&h.jbyg!==''){src.jbyg.value++;const s=String(h.jbyg_source||'').toUpperCase();if(s)src.jbyg.source++;if(s!=='GANYAN_CANAVARI_JBYG')src.jbyg.badSource++;if(h.jbyg_asof_date&&String(h.jbyg_asof_date).slice(0,10)>rd)src.jbyg.asofFuture++;}if(h.agf!=null&&h.agf!==''){src.agf.present++;const n=Number(h.agf);if(!Number.isFinite(n)||n<0||n>100)src.agf.bad++;}if(h.weight_kg!=null&&h.weight_kg!==''){src.kg.present++;const n=Number(h.weight_kg);if(!Number.isFinite(n)||n<35||n>75)src.kg.bad++;}if(h.hndkp!=null&&h.hndkp!==''){src.hndkp.present++;const n=Number(h.hndkp);if(!Number.isFinite(n)||n<0||n>200)src.hndkp.bad++;}if(h.best_time){src.bestTime.present++;if(!/^\d{1,3}[.:]\d{2}(?:[.:]\d{2})?$/.test(String(h.best_time).trim()))src.bestTime.badFormat++;}if(h.ypuan!=null&&h.ypuan!==''){src.ypuan.present++;if(!h.ypuan_source)h.ypuan_source='ODS_EMBEDDED_YPUAN';src.ypuan.tagged++;}}

pack.env.scalarFields=pack.env.scalarFields||{};pack.env.scalarFields.settings=pack.env.scalarFields.settings||{};pack.env.scalarFields.settings.archive_integrity_repair={version:'R15.3_TJK_PAYOUT_FAIL_CLOSED',at:'2026-09-01',verified_races:stats.verifiedRaces,quarantined_races:stats.unverifiedRaces};
const report={version:'R15.3_TJK_PAYOUT_FAIL_CLOSED',generated_at:new Date().toISOString(),policy:{result:'Only strict, internally-consistent TJK ordered payout combinations are accepted. Ambiguous/tied/unmatched results are quarantined.',start_no:'Legacy ODS archive ST values populated through the old result parser are unverified and are cleared.',result_time:'Legacy result_time/official_time values from the old result parser are unverified and are cleared. best_time from the program layer is retained.',tr:'Only GANYAN_CANAVARI_TR with race-date-safe provenance is trusted for TR PUAN.',glp:'Only GANYAN_CANAVARI_GALOPLAR_OZET provenance is trusted.',jbyg:'Only GANYAN_CANAVARI_JBYG provenance is trusted.',legacy_tr:'h.tr is an ODS AGF compatibility alias and must never be displayed as GC TR PUAN.'},stats,sources:src};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
encode(pack,output);
console.log(JSON.stringify(report,null,2));
