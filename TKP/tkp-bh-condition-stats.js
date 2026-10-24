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
function signature(db){const races=db?.races||[];let latest='';for(const r of races){const d=String(r.race_date||'');if(d>latest)latest=d;}return races.length+'|'+latest;}

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
  return {overall,byCond,legs,bhLegs,at:new Date().toISOString(),signature:signature(db)};
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
  return `<p class="muted">Sistemin "sürpriz aday" tablosundaki (BH) atların, koşu şartına göre gerçek kazanma oranı. ${st.bhLegs||0} ayak · güncellenme ${String(st.at||'').slice(0,16).replace('T',' ')}. Arşiv değişince otomatik yenilenir; salt bilgi, kuponu değiştirmez.</p>
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
g.tkpRenderBhConditionStats=render;g.tkpComputeBhConditionStats=compute;g.tkpBhConditionStatsHTML=html;
})(typeof window!=='undefined'?window:globalThis);
