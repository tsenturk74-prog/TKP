/* TKP BH (sürpriz tablosu) istatistiği · koşu şartına göre kazanan BH sırası.
 * Arşivden (db.races) sistemin kendi "sürpriz aday" tablosuyla (tkpRankedSurpriseRows)
 * hesaplanır; arşiv imzasıyla cache'lenir (her açılışta yeniden hesaplamaz, arşiv
 * değişince otomatik yenilenir). SALT GÖSTERGE: kupon/seçim mantığını değiştirmez. */
(function(g){
'use strict';
const num=x=>{const v=Number(x);return Number.isFinite(v)?v:null;};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const grp=h=>{const s=String(h?.horse_no??h);const m=s.match(/-E\d+$/i);return m?m[0]:s;};
function distBand(d){d=num(d)||0;if(!d)return'?';if(d<=1200)return'≤1200';if(d<=1600)return'1300-1600';if(d<=2000)return'1700-2000';return'>2000';}
function fieldBand(n){n=num(n)||0;if(n<=8)return'≤8 at';if(n<=11)return'9-11 at';return'≥12 at';}
function condKey(r){return [String(r.surface||'?'),String(r.breed||'?'),distBand(r.distance),fieldBand((r.horses||[]).length)].join(' · ');}
function signature(db){
  const races=db?.races||[],state=db?.learning_state||{};
  if(state.dataset_signature&&state.outcome_signature)return ['BH_STATS_V4',String(g.TKP_BH_RULES_VERSION||''),races.length,state.dataset_signature,state.outcome_signature].join('|');
  // Legacy data has no reliable revision: count/date alone misses corrected results.
  let hash=2166136261>>>0;
  for(const r of races){const text=JSON.stringify([r.race_date,r.surface,r.breed,r.distance,(r.horses||[]).map(h=>[h.horse_no,h.winner,h.finish_position,h.score,h.agf_rank,h.agf,h.bmb,h.odb,h.hndkp_rank,h.tr_ganyan_rank,h.ypuan,h.value_score,h.scratched,h.non_runner])]);for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;}
  return 'BH_STATS_V4|'+String(g.TKP_BH_RULES_VERSION||'')+'|'+races.length+'|'+hash.toString(16);
}

async function compute(db,{onYield}={}){
  const races=db?.races||[],overall={},byCond={};let legs=0,bhLegs=0,i=0;
  for(const r of races){
    if((++i&63)===0&&onYield)await onYield();
    const horses=(r.horses||[]).filter(h=>h&&!(typeof g.isNonRunner==='function'&&g.isNonRunner(h)));
    if(horses.length<6)continue;
    const winner=horses.find(h=>Number(h.winner)===1||Number(h.finish_position)===1);
    if(!winner)continue;legs++;
    let sr=[];try{sr=g.tkpRankedSurpriseRows(r,horses)||[];}catch(_){continue;}
    if(!sr.length)continue;bhLegs++;
    const winNo=grp(winner),ck=condKey(r);byCond[ck]=byCond[ck]||{};
    for(let k=0;k<Math.min(sr.length,6);k++){
      const won=grp(sr[k]?.horse)===winNo?1:0,rank='BH'+(k+1);
      (overall[rank]=overall[rank]||{w:0,n:0});overall[rank].w+=won;overall[rank].n++;
      (byCond[ck][rank]=byCond[ck][rank]||{w:0,n:0});byCond[ck][rank].w+=won;byCond[ck][rank].n++;
    }
  }
  // BENTER-BH: ayak tipi x kayıtlı BH sırası. Sıralama AGF ile yeniden kurulmaz.
  const bhSeg={S:[[0,0],[0,0],[0,0]],D:[[0,0],[0,0],[0,0]]};
  try{
    const byKey=new Map();
    for(const r of races){try{const k=typeof g.tkpBombHunterRaceKey==='function'?g.tkpBombHunterRaceKey(r):'';if(k&&!byKey.has(k))byKey.set(k,r);}catch(_){}}
    let j=0;
    for(const row of (db?.bomb_hunter_shadow_log||[])){
      if((++j&127)===0&&onYield)await onYield();
      const r=byKey.get(row?.race_key);if(!r)continue;
      const hs=(r.horses||[]).filter(h=>h&&!(typeof g.isNonRunner==='function'&&g.isNonRunner(h)));
      const winner=hs.find(h=>Number(h.winner)===1||Number(h.finish_position)===1);if(!winner)continue;
      const byNo=new Map(hs.map(h=>[String(h.horse_no),h]));
      const stored=(row.candidates||[]).filter(c=>!(typeof g.tkpBombHunterWasPortfolioBackfill==='function'&&g.tkpBombHunterWasPortfolioBackfill(c)));
      const ranked=typeof g.tkpBombHunterThreeFromRows==='function'?g.tkpBombHunterThreeFromRows(r,stored):stored;
      const cs=ranked.filter(c=>String(c?.kind||'BOMBA').toUpperCase()!=='ODB')
        .sort((a,b)=>(Number(a?.category_rank)||99)-(Number(b?.category_rank)||99)||(Number(a?.rank)||99)-(Number(b?.rank)||99))
        .slice(0,3).map(c=>byNo.get(String(c?.horse_no??c?.h?.horse_no??''))).filter(Boolean);
      const seg=typeof g.tkpBhLegWantsBh==='function'&&g.tkpBhLegWantsBh(r)?'S':'D';
      cs.forEach((h,i)=>{bhSeg[seg][i][1]++;if(grp(h)===grp(winner))bhSeg[seg][i][0]++;});
    }
  }catch(_e){}
  return {overall,byCond,legs,bhLegs,bhSeg,at:new Date().toISOString(),signature:signature(db)};
}

const pct=o=>o&&o.n?('%'+(100*o.w/o.n).toFixed(1)):'—';
function html(st){
  if(!st)return '<div class="empty">Veri yok.</div>';
  const ranks=['BH1','BH2','BH3','BH4','BH5','BH6'];
  const oRow=ranks.map(r=>`<td>${pct(st.overall[r])}<br><small class="muted">${st.overall[r]?.w||0}/${st.overall[r]?.n||0}</small></td>`).join('');
  const rows=Object.entries(st.byCond||{}).map(([ck,m])=>{
    const n=m.BH1?.n||0;if(n<20)return null;
    const b12n=(m.BH1?.n||0)+(m.BH2?.n||0),b12w=(m.BH1?.w||0)+(m.BH2?.w||0);
    const multi=ranks.slice(0,3).filter(r=>(m[r]?.w||0)>0).length;
    return {ck,n,m,b12:b12n?100*b12w/b12n:0,multi};
  }).filter(Boolean).sort((a,b)=>b.b12-a.b12);
  const condRows=rows.map(r=>`<tr><td>${esc(r.ck)}</td><td>${r.n}</td>${ranks.map(rk=>`<td>${pct(r.m[rk])}</td>`).join('')}<td>${r.multi>=2?'<b style="color:#15803d">≥2 BH kazanmış</b>':''}</td></tr>`).join('');
  const segTxt={S:'Favori AGF <%30 ve 8-13 at',D:'Diğer ayaklar'};
  const segRows=st.bhSeg?['S','D'].map(k=>`<tr><td>${segTxt[k]}</td>${[0,1,2].map(i=>{const c=st.bhSeg[k][i]||[0,0];return `<td>${c[1]?('%'+(100*c[0]/c[1]).toFixed(1)):'—'}<br><small class="muted">${c[0]}/${c[1]}</small></td>`;}).join('')}</tr>`).join(''):'';
  const benter=segRows?`<div class="tableWrap" style="margin:6px 0 10px;"><table class="compact"><thead><tr><th>BH kupon modeli · ayak tipi</th><th>BH1</th><th>BH2</th><th>BH3</th></tr></thead><tbody>${segRows}</tbody></table><p class="muted" style="margin:4px 0 0;">Kupon kuralı: 3+ atlı her ayakta BH1 kupona girer (AGF ilk 3 korunur). BH1-3 olasılığı bu orandan ×${Number(g.TKP_BH_BOOST_K)||1.5} ile desteklenir, ayak genişlikleri buna göre dağıtılır. Arşiv değiştikçe tablo kendiliğinden güncellenir.</p></div>`:'';
  return benter+`<p class="muted">Sistemin "sürpriz aday" tablosundaki (BH) atların, koşu şartına göre gerçek kazanma oranı. ${st.bhLegs||0} ayak · güncellenme ${String(st.at||'').slice(0,16).replace('T',' ')}. Arşiv değişince otomatik yenilenir; salt bilgi, kuponu değiştirmez.</p>
<div class="tableWrap"><table class="compact"><thead><tr><th>Genel</th>${ranks.map(r=>`<th>${r}</th>`).join('')}</tr></thead><tbody><tr><td><b>Kazanma %</b></td>${oRow}</tr></tbody></table></div>
<div class="tableWrap" style="margin-top:8px;"><table class="compact" data-tkp-sort="preserve"><thead><tr><th>Koşu şartı (zemin·cins·mesafe·saha)</th><th>Ayak</th>${ranks.map(r=>`<th>${r}</th>`).join('')}<th>Not</th></tr></thead><tbody>${condRows||'<tr><td colspan="9" class="empty">Yeterli örnekli koşul yok (≥20 ayak).</td></tr>'}</tbody></table></div>`;
}

let _running=false;
async function render(){
  if(typeof document==='undefined')return;
  const el=document.getElementById('bhConditionStatsTable');if(!el)return;
  const db=g.db;if(!db?.races?.length){el.innerHTML='<div class="empty">Arşiv yüklenmedi.</div>';return;}
  const sig=signature(db),cached=db.settings?.bh_condition_stats;
  if(cached&&cached.signature===sig){el.innerHTML=html(cached);return;}
  if(_running)return;_running=true;
  el.innerHTML='<div class="empty">BH istatistiği hesaplanıyor… (menüleri kullanabilirsiniz)</div>';
  try{
    const y=()=>typeof g.tkpYieldToUi==='function'?g.tkpYieldToUi():new Promise(r=>setTimeout(r,0));
    const st=await compute(db,{onYield:y});
    db.settings=db.settings||{};db.settings.bh_condition_stats=st;
    try{if(typeof g.tkpPersistCollections==='function')g.tkpPersistCollections([],{metaPatch:{settings:db.settings},label:'bh-stats'});}catch(_){}
    const el2=document.getElementById('bhConditionStatsTable');if(el2)el2.innerHTML=html(st);
  }catch(e){const el2=document.getElementById('bhConditionStatsTable');if(el2)el2.innerHTML='<div class="empty">BH istatistiği hesaplanamadı: '+esc(String(e&&e.message||e).slice(0,100))+'</div>';}
  finally{_running=false;}
}
// Arka planda (panel acilmadan) istatistigi hazirlar; BH rozetindeki K sayisi bunu kullanir.
let _ensuring=false;
async function ensure(){
  const db=g.db;if(!db?.races?.length||_ensuring)return null;
  const sig=signature(db),cached=db.settings?.bh_condition_stats;
  if(cached&&cached.signature===sig)return cached;
  _ensuring=true;
  try{
    const y=()=>typeof g.tkpYieldToUi==='function'?g.tkpYieldToUi():new Promise(r=>setTimeout(r,0));
    const st=await compute(db,{onYield:y});
    db.settings=db.settings||{};db.settings.bh_condition_stats=st;
    try{if(typeof g.tkpPersistCollections==='function')g.tkpPersistCollections([],{metaPatch:{settings:db.settings},label:'bh-stats'});}catch(_){}
    try{if(typeof g.renderAll==='function')g.renderAll();}catch(_){}
    return st;
  }catch(_e){return null;}finally{_ensuring=false;}
}
// Bu yarisin kosu sartinda, tablodaki k. sira (BHk) daha once kac kez kazanmis. Sonuclu yarisin kendisi sayilmaz.
let _sigCache={len:-1,sig:null};
function bhWinsFor(r,k,horse){
  const db=g.db,st=db?.settings?.bh_condition_stats;
  const len=db?.races?.length||0;
  if(_sigCache.len!==len){_sigCache={len,sig:null};if(len&&!bhWinsFor._sched){bhWinsFor._sched=true;setTimeout(()=>{bhWinsFor._sched=false;ensure();},1500);}}
  const rv=String(g.TKP_BH_RULES_VERSION||'');
  if(st&&rv&&!String(st.signature||'').includes(rv)&&!_ensuring&&!bhWinsFor._sched){bhWinsFor._sched=true;setTimeout(()=>{bhWinsFor._sched=false;ensure();},1500);}
  if(!st||!String(st.signature||'').startsWith('BH_STATS_V4'))return null;
  const m=st.byCond?.[condKey(r)]?.['BH'+k];if(!m)return 0;
  let w=Number(m.w)||0;
  const hs=(r?.horses||[]);const winner=hs.find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  if(winner&&horse&&grp(winner)===grp(horse))w=Math.max(0,w-1);
  return w;
}
g.tkpBhCondKey=condKey;g.tkpEnsureBhConditionStats=ensure;g.tkpBhConditionWins=bhWinsFor;
g.tkpRenderBhConditionStats=render;g.tkpComputeBhConditionStats=compute;g.tkpBhConditionStatsHTML=html;
})(typeof window!=='undefined'?window:globalThis);
