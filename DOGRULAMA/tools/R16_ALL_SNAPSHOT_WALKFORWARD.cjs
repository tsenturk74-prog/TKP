'use strict';
/*
 * R16: tüm arşiv için sızıntısız snapshot denetimi ve walk-forward kupon testi.
 *
 * Girdi .tkbz yedeği; çıktı yalnızca yarış-öncesi izinli alanlarla üretilmiş
 * snapshot/test raporudur. finish_position/winner hiçbir sıralama fonksiyonuna
 * geçirilmez: onlar yalnızca final evaluate() adımında okunur.
 *
 * Kullanım:
 * node R16_ALL_SNAPSHOT_WALKFORWARD.cjs backup.tkbz [report.json]
 */
const fs=require('fs');
const zlib=require('zlib');

const input=process.argv[2];
const output=process.argv[3]||'R16_ALL_SNAPSHOT_WALKFORWARD_REPORT.json';
if(!input)throw new Error('Kullanım: node R16_ALL_SNAPSHOT_WALKFORWARD.cjs backup.tkbz [report.json]');

function readBackup(path){
  const raw=zlib.gunzipSync(fs.readFileSync(path)); let offset=0;
  const take=n=>{const part=raw.subarray(offset,offset+n);offset+=n;return part;};
  const u32=()=>{const n=raw.readUInt32BE(offset);offset+=4;return n;};
  if(take(4).toString()!=='TKPB')throw new Error('Geçersiz TKPB başlığı');
  const version=u32(); const envelope=JSON.parse(take(u32()).toString()); const collections={};
  for(const descriptor of envelope.collections||[]){
    const rows=[]; for(let i=0;i<Number(descriptor.chunks||0);i++){
      const chunk=JSON.parse(take(u32()).toString()); if(!Array.isArray(chunk))throw new Error(`${descriptor.name} dizisi bozuk`);
      rows.push(...chunk);
    }
    collections[descriptor.name]=rows;
  }
  if(offset!==raw.length)throw new Error('Yedekte işlenmemiş bayt kaldı');
  return {version,envelope,collections};
}

const num=v=>Number.isFinite(Number(v))?Number(v):null;
const yes=v=>v===true||v===1||v==='1'||String(v).toUpperCase()==='TRUE';
const horseNo=h=>String(h?.horse_no??h?.no??'').trim();
const winnerOf=r=>(r.horses||[]).find(h=>String(h.finish_position??'')==='1'||yes(h.winner))||null;
const profileOf=r=>[r.surface||'?',r.condition_family||String(r.condition_text||'?').split(/\s+/)[0],r.distance_group||'?',r.breed||'?'].map(x=>String(x).trim().toUpperCase()).join('|');

// Yalnızca yarış öncesi kaynaklardan gelen alanlar. Sonuç alanı burada yoktur.
function publicCandidate(h){
  return {
    horse_no:horseNo(h), score:num(h.prediction_score_snapshot), frozen_rank:num(h.prediction_order_snapshot),
    pre_race_score:num(h.pre_race_tkp_score), agf:num(h.agf), agf_rank:num(h.agf_rank),
    bmb:yes(h.bmb), odb:yes(h.odb), tr_bmb:yes(h.tr_bmb_candidate), tr_hidden_fav:yes(h.tr_hidden_fav),
    tr_ganyan:num(h.tr_ganyan), tr_puan:num(h.tr_puan), ypuan:num(h.ypuan), jbyg:num(h.jbyg),
    galop_rank:num(h.galop_rank??h.glp_rank), hndkp:num(h.hndkp), value_score:num(h.value_score),
    prior_accurate:num(h.priorAccurateFinishSignal), x_points:null // arşivde at-bazlı X yok: uydurulmaz.
  };
}

function assignReconstructedRanks(candidates){
  // Eksik arşiv sırası olan koşularda aynı koşunun yalnız yarış-öncesi
  // alanlarından yeni bir sıra üretir. Kazanan/bitiriş bu fonksiyona verilmez.
  const n=candidates.length;
  const scale=(key,desc=true)=>{
    const known=candidates.filter(c=>c[key]!==null).sort((a,b)=>desc?(b[key]-a[key]):(a[key]-b[key]));
    const out=new Map(); known.forEach((c,i)=>out.set(c.horse_no,(known.length-i)/Math.max(1,known.length)));
    return c=>out.get(c.horse_no)||0;
  };
  const agf=scale('agf'), trp=scale('tr_puan'), yp=scale('ypuan'), hnd=scale('hndkp'), val=scale('value_score'), jbyg=scale('jbyg'), galop=scale('galop_rank',false);
  for(const c of candidates){
    c.reconstructed_score=0.30*agf(c)+0.16*trp(c)+0.16*yp(c)+0.12*hnd(c)+0.10*val(c)+0.06*jbyg(c)+0.06*galop(c)+(c.bmb?0.025:0)+(c.tr_bmb?0.02:0)+(c.tr_hidden_fav?0.015:0);
    c.score=c.reconstructed_score;
  }
  candidates.sort((a,b)=>b.score-a.score||a.horse_no.localeCompare(b.horse_no));
  candidates.forEach((c,i)=>{c.frozen_rank=i+1;});
  return candidates;
}

function buildSnapshotRaces(races){
  const qa={total:races.length,official_result:0,strict_pre_race:0,archived_frozen:0,reconstructed_pre_race:0,quarantined_no_program:0};
  const rows=[];
  for(const race of races){
    const horses=(race.horses||[]).filter(h=>horseNo(h)); const winner=winnerOf(race);
    if(winner)qa.official_result++;
    const allStrict=horses.length>0&&horses.every(h=>num(h.pre_race_tkp_score)!==null&&String(h.pre_race_tkp_version||'').includes('PRE-RACE'));
    const allFrozen=horses.length>0&&horses.every(h=>num(h.prediction_score_snapshot)!==null&&num(h.prediction_order_snapshot)!==null);
    if(allStrict)qa.strict_pre_race++;
    if(allFrozen)qa.archived_frozen++; else qa.reconstructed_pre_race++;
    if(!horses.length){qa.quarantined_no_program++;continue;}
    // Snapshotın tahmin tarafı kesinlikle yalnız publicCandidate'dan oluşur.
    let candidates=horses.map(publicCandidate);
    if(allFrozen)candidates.sort((a,b)=>a.frozen_rank-b.frozen_rank||b.score-a.score||a.horse_no.localeCompare(b.horse_no));
    else candidates=assignReconstructedRanks(candidates);
    rows.push({
      race_id:race.id, file_id:race.file_id, meeting_uid:race.meeting_uid||'', race_date:String(race.race_date||''),
      sequence_no:num(race.sequence_no)||0, leg:num(race.leg)||0, profile:profileOf(race),
      snapshot_kind:allStrict?'ARCHIVED_PRE_RACE':allFrozen?'ARCHIVED_FROZEN_REPLAY':'RECONSTRUCTED_FROM_PRE_RACE_FIELDS', candidates,
      // Sonuç etiketi ayrı tutulur; ranker/öğrenme fonksiyonuna aktarılmaz.
      outcome:winner?{winner_no:horseNo(winner)}:null
    });
  }
  return {rows,qa};
}

function splitChronologically(rows){
  const ordered=[...rows].sort((a,b)=>a.race_date.localeCompare(b.race_date)||a.sequence_no-b.sequence_no||a.race_id-b.race_id);
  const usable=ordered.filter(r=>r.outcome); const a=Math.floor(usable.length*.60),b=Math.floor(usable.length*.80);
  return {train:usable.slice(0,a),validation:usable.slice(a,b),holdout:usable.slice(b),all:usable};
}

function ranked(r,mode,lifts){
  const scale=mode==='normal'?0.20:mode==='surprise'?0.95:0.62;
  return [...r.candidates].sort((a,b)=>{
    const bonus=x=>scale*((x.bmb?lifts.bmb:0)+(x.odb?lifts.odb:0)+(x.tr_bmb?lifts.tr_bmb:0)+(x.tr_hidden_fav?lifts.tr_hidden_fav:0));
    return (a.frozen_rank-bonus(a))-(b.frozen_rank-bonus(b)) || b.score-a.score || a.horse_no.localeCompare(b.horse_no);
  });
}

function learnLifts(train){
  const features=['bmb','odb','tr_bmb','tr_hidden_fav']; const result={};
  for(const f of features){
    let eventW=0,eventN=0,baseW=0,baseN=0;
    for(const r of train)for(const c of r.candidates){const hit=c.horse_no===r.outcome.winner_no;baseN++;if(hit)baseW++;if(c[f]){eventN++;if(hit)eventW++;}}
    // Jeffreys smoothing; sadece kanıt varsa pozitif katkı verilir.
    const base=(baseW+.5)/(baseN+1),event=(eventW+.5)/(eventN+1); result[f]=eventN>=25?Math.max(-1,Math.min(1,Math.log(event/base))):0;
  }
  return result;
}

function learnWidths(train,mode,lifts){
  const target={normal:.80,surprise:.89,expert:.85}[mode]; const global=[],byProfile=new Map();
  for(const r of train){const rs=ranked(r,mode,lifts);const pos=rs.findIndex(c=>c.horse_no===r.outcome.winner_no)+1;if(pos>0){global.push(pos);const a=byProfile.get(r.profile)||[];a.push(pos);byProfile.set(r.profile,a);}}
  const quantile=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.ceil(target*s.length)-1))]||3;};
  const fallback=Math.min(mode==='surprise'?7:6,Math.max(mode==='normal'?2:3,quantile(global)));
  const widths={};for(const [k,a] of byProfile)if(a.length>=12)widths[k]=Math.min(mode==='surprise'?7:6,Math.max(mode==='normal'?2:3,quantile(a)));
  return {target,fallback,byProfile:widths};
}

function picksFor(r,mode,lifts,widths){
  const order=ranked(r,mode,lifts); const base=widths.byProfile[r.profile]||widths.fallback;
  let selected=order.slice(0,base);
  // Kullanıcının açık kuralı: geniş ayakta (4+) TKP >= .90 atı asla atılmaz.
  if(base>=4){for(const c of order)if((c.score??-Infinity)>=.90&&!selected.some(x=>x.horse_no===c.horse_no))selected.push(c);}
  selected.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  return {selected,base,ranked:order};
}

function evaluate(rows,mode,lifts,widths){
  let races=0,covered=0,highScoreCandidates=0,highScoreKept=0; const meetings=new Map();
  for(const r of rows){const p=picksFor(r,mode,lifts,widths), winner=r.outcome.winner_no; races++;if(p.selected.some(c=>c.horse_no===winner))covered++;
    if(p.base>=4){const high=r.candidates.filter(c=>(c.score??-Infinity)>=.90);highScoreCandidates+=high.length;highScoreKept+=high.filter(c=>p.selected.some(x=>x.horse_no===c.horse_no)).length;}
    const key=String(r.file_id||r.meeting_uid||r.race_date);const m=meetings.get(key)||[];m.push({r,p,winner});meetings.set(key,m);
  }
  let complete=0,allHit=0,productSum=0;for(const m of meetings.values())if(m.length===6){complete++;const hit=m.every(x=>x.p.selected.some(c=>c.horse_no===x.winner));if(hit)allHit++;productSum+=m.reduce((z,x)=>z*x.p.selected.length,1);}
  return {races,covered,coverage_rate:+(covered/Math.max(1,races)).toFixed(4),complete_meetings:complete,all_six_hit:allHit,all_six_hit_rate:+(allHit/Math.max(1,complete)).toFixed(4),average_combination_cost:+(productSum/Math.max(1,complete)).toFixed(1),tkp90_required:highScoreCandidates,tkp90_kept:highScoreKept,tkp90_compliance:highScoreCandidates?+(highScoreKept/highScoreCandidates).toFixed(4):1};
}

function main(){
  const backup=readBackup(input), built=buildSnapshotRaces(backup.collections.races||[]), split=splitChronologically(built.rows);
  const lifts=learnLifts(split.train); const modes={};
  for(const mode of ['normal','surprise','expert']){const widths=learnWidths(split.train,mode,lifts);modes[mode]={width_policy:{target:widths.target,fallback:widths.fallback,profile_count:Object.keys(widths.byProfile).length},validation:evaluate(split.validation,mode,lifts,widths),holdout:evaluate(split.holdout,mode,lifts,widths)};}
  const report={
    version:'R16-ALL-SNAPSHOT-WALKFORWARD-1', generated_at:new Date().toISOString(), no_leak_contract:'Sıralama yalnız publicCandidate izinli yarış-öncesi alanlarıyla yapılır; outcome sadece evaluate aşamasında okunur.',
    source:{backup_format:backup.version,meetings:(backup.collections.files||[]).length,races:(backup.collections.races||[]).length},
    snapshot_qa:{...built.qa,usable_with_official_result:split.all.length,strict_pre_race_with_result:built.rows.filter(r=>r.snapshot_kind==='ARCHIVED_PRE_RACE'&&r.outcome).length,archived_frozen_with_result:built.rows.filter(r=>r.snapshot_kind==='ARCHIVED_FROZEN_REPLAY'&&r.outcome).length,reconstructed_with_result:built.rows.filter(r=>r.snapshot_kind==='RECONSTRUCTED_FROM_PRE_RACE_FIELDS'&&r.outcome).length},
    chronology:{train:split.train.length,validation:split.validation.length,holdout:split.holdout.length,rule:'yarış tarihi + sequence_no, 60/20/20; holdout eğitime dokunmaz'},
    learned_signal_lifts:lifts, modes,
    limitations:['At-bazlı Kulis/X alanı arşiv snapshotında yok; sıfır ağırlıkla işaretlendi.','RECONSTRUCTED_FROM_PRE_RACE_FIELDS kayıtlarının alanları yarış-öncesi whitelist ile sınırlandı; fakat orijinal zaman damgası yarış anını kanıtlamıyor.','Bu rapor araştırma/test çıktısıdır; canlı kupon politikasını otomatik etkinleştirmez.']
  };
  fs.writeFileSync(output,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
}
main();
