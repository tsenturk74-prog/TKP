/**
 * TKP R15.5 — ALL TABLE HISTORICAL DATA BRIDGE
 *
 * Amaç: Eski arşivde gerçekten var olan yarış-öncesi/veri kaynağı alanlarını
 * tüm analiz tablolarına ortak, fail-closed bir katmandan açmak. Eksik veri 0
 * değildir; doğrulanmamış sonuç eğitim verisi değildir; geçmişe bugünkü modelle
 * karar uydurulmaz.
 */
(function(global){
'use strict';
const VERSION='R16_51_FIRST_LOOK_SIX_LEG_LEADERS_2026_09_07';
let cacheKey='',coverageCache=null,commentatorCache=null,snapshotCache=null;
const arr=v=>Array.isArray(v)?v:[];
const finite=v=>{if(v===null||v===undefined||String(v).trim()==='')return null;const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:null;};
const present=v=>v!==null&&v!==undefined&&String(v).trim()!=='';
const text=v=>String(v??'').trim();
const esc=v=>text(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pct=(a,b)=>b>0?'%'+(100*a/b).toFixed(1).replace('.',','):'—';
const trackText=v=>text(v).toLocaleUpperCase('tr-TR').replace(/[İI]/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C');
const trackKey=r=>text(r?.race_key)||[text(r?.race_date).slice(0,10),trackText(r?.hippodrome),Number(r?.altili_no)||1,Number(r?.leg)||Number(r?.sequence_no)||0].join('|');
function dbNow(source){try{return source||(typeof db!=='undefined'?db:global.db)||null;}catch(_){return source||global.db||null;}}
function sig(source){
  const d=dbNow(source)||{};const races=arr(d.races),files=arr(d.files),fwd=arr(d.forward_tracking_log);
  const last=races.length?races[races.length-1]:null,lastF=fwd.length?fwd[fwd.length-1]:null;
  return [VERSION,files.length,races.length,fwd.length,arr(d.prediction_log).length,arr(d.auto_coupon_log).length,arr(d.sidebet_ticket_log).length,
    text(last?.updated_at||last?.race_date),text(lastF?.evaluated_at||lastF?.created_at),text(d?.settings?.historical_portfolio_training?.updated_at||'')].join('|');
}
function invalidate(){if(typeof _surpriseProfScan!=='undefined')_surpriseProfScan.key='';cacheKey='';coverageCache=null;commentatorCache=null;snapshotCache=null;}
// FIX (Tommy talebi — "tıkanan/eksik veri gösteren tabloları düzeltelim"):
// büyük arşivlerde tkp-segmented-idb.js belleği korumak için koleksiyonları
// kısmi ("sıcak pencere") yükler; soğuk kalan kayıtlar silinmedi, sadece bu
// oturumda belleğe alınmadı. Önceden bu kartlar soğuk bir koleksiyonu sessizce
// 0 gibi gösteriyordu (geçmiş yokmuş gibi okunuyordu). Artık gerçek toplam ve
// yüklenen sayı açıkça yazılır; hiçbir sayı gizlenmez veya uydurulmaz.
function coldNotice(source,name,label){
  const d=dbNow(source);const info=d?.__segmented_storage?.collections?.[name];
  if(!info||!Number(info.coldCount))return '';
  const loaded=Number(info.loadedCount||0).toLocaleString('tr-TR'),total=Number(info.total||0).toLocaleString('tr-TR'),cold=Number(info.coldCount||0).toLocaleString('tr-TR');
  return `<p class="muted" style="color:#b45309;margin:4px 0 0">⚠️ ${esc(label)}: bellek güvenliği için bu oturumda yalnız <b>${loaded}/${total}</b> kayıt yüklü (${cold} kayıt soğuk arşivde duruyor, silinmedi). Aşağıdaki sayılar bu kısmi pencereye aittir; tam arşiv değildir.</p>`;
}
function verifiedRace(r){
  const status=text(r?.result_integrity_status).toUpperCase();
  const source=text(r?.result_integrity_source).toUpperCase();
  if(status==='VERIFIED'&&source==='TJK_OFFICIAL_ORDERED_PAYOUT')return true;
  // Eski arşiv snapshotlarında sonuç doğrulama derinliği korunmuş, ancak yeni
  // bütünlük etiketlerinden biri eksik kalmış olabilir. Derinlik, resmi sıralı
  // ödeme eşlemesinden üretildiği için bu yol güvenli bir uyumluluk fallback'idir.
  return Number(r?.result_verified_depth)>=1 && (
    status==='VERIFIED' || status==='VERIFIED_TJK_PAYOUT' || source==='TJK_OFFICIAL_ORDERED_PAYOUT'
  );
}
function trustedTr(h){
  try{if(typeof global.tkpTrustedGcTrValue==='function')return global.tkpTrustedGcTrValue(h);}catch(_){ }
  if(![h?.tr_ganyan_source,h?.tr_source].some(source=>text(source).toUpperCase()==='GANYAN_CANAVARI_TR'))return null;
  return finite(h?.tr_ganyan??h?.tr_puan);
}
function trustedGlp(h){
  const src=text(h?.glp_source||h?.g800_source||h?.workout_source||h?.program_source).toUpperCase();
  // Günlük yarışta TJK İdman, eski sonuçlarda Ganyan Canavarı ve YeniBeygir fallback
  // kullanıcı tarafından doğrulanmış kaynak sahipliğidir. Bunların dışındaki sentetik/
  // kaynaksız GLP tarihsel analize alınmaz.
  const trusted=!src || src.includes('TJK') || src.includes('GANYAN_CANAVARI') || src.includes('YENIBEYGIR') || src.includes('YENİBEYGİR');
  if(!trusted)return null;
  for(const v of [h?.glp_raw,h?.g800,h?.workout_800]){const n=finite(v);if(n!==null)return n;}
  return null;
}
function trustedJbyg(h){
  const src=text(h?.jbyg_source||h?.team_strength_source||h?.program_source).toUpperCase();
  const n=finite(h?.jbyg??h?.jbyg_rank);
  if(n===null)return null;
  if(src.includes('TJK')||src.includes('GANYAN_CANAVARI')||src.includes('YENIBEYGIR')||src.includes('YENİBEYGİR'))return n;
  // Eski TJK program zenginleştirmelerinde source etiketi yoktu; pozitif gerçek
  // jokey/antrenör yüzdesi + kişi adı birlikteyse güvenilir uyumluluk fallback'i.
  const team=finite(h?.team_strength_pct);
  if(!src&&team!==null&&team>0&&(text(h?.jockey_name)||text(h?.trainer_name)))return n;
  return null;
}
function trustedYpuan(h){
  // R16.48 sonrası bağımsız yorumcu katkıları ypuan_breakdown/source_counts ile
  // kanıtlanır. Eski kaynak etiketli değerler de aynen korunur.
  const n=finite(h?.ypuan);if(n===null)return null;
  if(text(h?.ypuan_source))return n;
  if(Number(h?.ypuan_contributor_count)>0)return n;
  if(arr(h?.ypuan_breakdown).length)return n;
  if(h?.ypuan_source_counts&&typeof h.ypuan_source_counts==='object'&&Object.keys(h.ypuan_source_counts).length)return n;
  return null;
}
function isNonRunner(h){try{return typeof global.isNonRunner==='function'&&global.isNonRunner(h);}catch(_){return false;}}
function finish(h){
  for(const v of [h?.finish_position,h?.result_position,h?.official_position,h?.place]){const n=finite(v);if(n!==null&&n>0)return n;}
  return Number(h?.winner)===1?1:null;
}
function frozenOrderForRace(r){
  const horses=arr(r?.horses).filter(h=>h&&!isNonRunner(h));
  const ranked=horses.filter(h=>{const n=finite(h?.prediction_order_snapshot);return n!==null&&n>=1;});
  if(ranked.length>=1)return ranked.slice().sort((a,b)=>finite(a.prediction_order_snapshot)-finite(b.prediction_order_snapshot)||String(a.horse_no).localeCompare(String(b.horse_no),'tr',{numeric:true}));
  const strategy=horses.filter(h=>{const n=finite(h?._strategy_rank);return n!==null&&n>=1;});
  if(strategy.length>=1)return strategy.slice().sort((a,b)=>finite(a._strategy_rank)-finite(b._strategy_rank)||String(a.horse_no).localeCompare(String(b.horse_no),'tr',{numeric:true}));
  const snap=horses.filter(h=>finite(h?.prediction_score_snapshot)!==null);
  if(snap.length>=1)return snap.slice().sort((a,b)=>finite(b.prediction_score_snapshot)-finite(a.prediction_score_snapshot)||String(a.horse_no).localeCompare(String(b.horse_no),'tr',{numeric:true}));
  return [];
}
function historicalSnapshotStats(source){
  const d=dbNow(source);if(!d)return {verifiedRaces:0,evaluable:0,leaderWin:0,leaderTop3:0,leaderTop5:0,explicitForward:0,firstLookRankWins:[0,0,0,0,0,0,0],firstLookRankEligible:[0,0,0,0,0,0,0],meetingLeaderWinCounts:[0,0,0,0,0,0,0],trackedMeetings:0};
  const key=sig(d);if(snapshotCache&&cacheKey===key)return snapshotCache;
  let verifiedRaces=0,evaluable=0,leaderWin=0,top3Evaluable=0,leaderTop3=0,top5Evaluable=0,leaderTop5=0,snapshotRaces=0,snapshotHorses=0,dailyForwardAdded=0;
  const trackedKeys=new Set();
  const meetings=new Map();
  const addMeetingLeader=(r,score,won)=>{
    const meetingKey=[text(r?.file_id)||text(r?.race_date).slice(0,10),trackText(r?.hippodrome),Number(r?.altili_no)||1].join('|');
    if(!meetings.has(meetingKey))meetings.set(meetingKey,[]);
    meetings.get(meetingKey).push({leg:Number(r?.leg)||Number(r?.sequence_no)||0,score:Number.isFinite(Number(score))?Number(score):0,won:!!won});
  };
  for(const r of arr(d.races)){
    if(!verifiedRace(r))continue;verifiedRaces++;
    const order=frozenOrderForRace(r);if(!order.length)continue;
    snapshotRaces++;snapshotHorses+=order.length;
    const leader=order[0],winner=arr(r.horses).find(h=>finish(h)===1);if(!winner)continue;evaluable++;
    trackedKeys.add(trackKey(r));
    const leaderWon=text(leader?.horse_no)===text(winner?.horse_no);
    if(leaderWon)leaderWin++;
    addMeetingLeader(r,finite(leader?.prediction_score_snapshot)??finite(leader?.score)??finite(leader?.tkp_score_snapshot)??0,leaderWon);
    const depth=Math.max(1,Number(r?.result_verified_depth)||1),p=finish(leader);
    if(depth>=3){top3Evaluable++;if(p!==null&&p<=3)leaderTop3++;}
    if(depth>=5){top5Evaluable++;if(p!==null&&p<=5)leaderTop5++;}
  }
  // Günlük yarışın altı İlk Bakış lideri yarıştan önce forward_tracking_log içine
  // dondurulur. Sonuç gelince liderin kazanıp kazanmadığı eklenir. races içinde
  // aynı frozen koşu zaten varsa ikinci kez sayılmaz.
  for(const rec of arr(d.forward_tracking_log)){
    if(!text(rec?.evaluated_at)||!text(rec?.winner_no))continue;
    const key=trackKey(rec);if(trackedKeys.has(key))continue;
    if(!text(rec?.leader_no))continue;
    trackedKeys.add(key);dailyForwardAdded++;evaluable++;snapshotRaces++;snapshotHorses+=arr(rec?.pre_race_candidates).length;
    const leaderWon=Number(rec?.leader_win)===1;if(leaderWon)leaderWin++;
    addMeetingLeader(rec,finite(rec?.leader_score)??0,leaderWon);
    const leaderFinish=finite(rec?.leader_finish);
    if(leaderFinish!==null){top3Evaluable++;if(leaderFinish<=3)leaderTop3++;top5Evaluable++;if(leaderFinish<=5)leaderTop5++;}
  }
  // Genel Bakış altı ayak liderini TKP puanına göre yüksekten düşüğe dizer.
  // Buradaki 1-6 sırası ayak içindeki at sırası değil, o altı liderin güç sırasıdır.
  const firstLookRankWins=[0,0,0,0,0,0,0],firstLookRankEligible=[0,0,0,0,0,0,0],meetingLeaderWinCounts=[0,0,0,0,0,0,0];
  let trackedMeetings=0;
  for(const rows0 of meetings.values()){
    const byLeg=new Map();for(const row of rows0)if(row.leg&&!byLeg.has(row.leg))byLeg.set(row.leg,row);
    const rows=[...byLeg.values()].sort((a,b)=>b.score-a.score||a.leg-b.leg).slice(0,6);
    if(rows.length<6)continue;trackedMeetings++;
    let wins=0;for(let i=0;i<6;i++){firstLookRankEligible[i+1]++;if(rows[i].won){firstLookRankWins[i+1]++;wins++;}}
    meetingLeaderWinCounts[Math.max(0,Math.min(6,wins))]++;
  }
  const explicitForward=arr(d.forward_tracking_log).filter(x=>text(x?.evaluated_at)&&text(x?.winner_no)).length;
  snapshotCache={version:VERSION,verifiedRaces,evaluable,leaderWin,top3Evaluable,leaderTop3,top5Evaluable,leaderTop5,snapshotRaces,snapshotHorses,explicitForward,dailyForwardAdded,firstLookRankWins,firstLookRankEligible,meetingLeaderWinCounts,trackedMeetings,missingMath:Math.max(0,verifiedRaces-evaluable),lane:'HISTORICAL_FROZEN_SNAPSHOT_RESEARCH'};
  cacheKey=key;return snapshotCache;
}
// FIX (Tommy talebi — "en buyuk sürpriz kazananların PROF'u düşük bantta
// kümeleniyor mu, takip edelim"): kullanıcı gözlemi, AGF sırası ~11-13 olup
// kazanan atların PROF'unun ~%18 civarında olduğu yönünde. Bu sabit bir kural
// DEĞİL; yalnız AGF sırasına göre kovalara ayrılmış gerçek PROF dağılımını
// gösteren bir gözlem/takip tablosudur. Örneklem küçükse "kanıtlanmış kural"
// gibi sunulmaz — sadece sayılar gösterilir.
const SURPRISE_PROF_BUCKETS=[[6,10,'AGF 6–9'],[10,14,'AGF 10–13'],[14,999,'AGF 14+']];
function surpriseProfAggregate(){return SURPRISE_PROF_BUCKETS.map(()=>({n:0,distribution:{}}));}
function surpriseWinnerProfScanRace(r,agg,rankTracking={}){
  if(!verifiedRace(r))return;
  const live=arr(r.horses).filter(h=>!isNonRunner(h));
  const winner=live.find(h=>finish(h)===1);if(!winner)return;
  const positions=typeof tkpProfBottomPositions==='function'?tkpProfBottomPositions(r):new Map();
  const condition=[text(r.hippodrome)||'Pist bilinmiyor',text(r.condition_family||r.condition)||'Şart bilinmiyor',text(r.breed)||'Irk bilinmiyor',text(r.surface||r.track_type)||'Zemin bilinmiyor',text(r.distance_m||r.distance)||'Mesafe bilinmiyor'].join(' · ');
  const frozen=frozenOrderForRace(r),tablePositions=new Map();
  if(frozen.length===live.length)for(let i=Math.max(0,frozen.length-4);i<frozen.length;i++)tablePositions.set(String(frozen[i].horse_no),{rank:frozen.length-i});
  for(const h of live){
    const position=tablePositions.get(String(h.horse_no));if(!position)continue;
    const key=condition+'|'+position.rank;
    const entry=rankTracking[key]||(rankTracking[key]={condition,rank:position.rank,candidates:0,wins:0,bmbCandidates:0,bmbWins:0});
    const bmb=Number(h.bmb)===1&&h.bmb_source!=='ŞABLON KURALI';
    entry.candidates++;if(finish(h)===1)entry.wins++;
    if(bmb){entry.bmbCandidates++;if(finish(h)===1)entry.bmbWins++;}
  }
  const rank=finite(winner.agf_rank);if(rank===null||rank<6)return;
  let prof=null;try{prof=typeof profileStrengthPct==='function'?profileStrengthPct(r,winner):null;}catch(_){ }
  if(prof===null||!Number.isFinite(Number(prof)))return;
  prof=Number(prof);
  const idx=SURPRISE_PROF_BUCKETS.findIndex(([min,max])=>rank>=min&&rank<max);if(idx<0)return;
  const position=positions.get(String(winner.horse_no)),bottom=position?.rank??null;
  const a=agg[idx];a.n++;
  const key=prof+'|'+(bottom??'unknown');
  const row=a.distribution[key]||(a.distribution[key]={prof,rank:bottom,wins:0,bmbWins:0});
  row.wins++;if(Number(winner.bmb)===1&&winner.bmb_source!=='ŞABLON KURALI')row.bmbWins++;
}
function surpriseWinnerProfStats(source){
  const d=dbNow(source),agg=surpriseProfAggregate(),rankTracking={};
  if(d)for(const r of arr(d.races))surpriseWinnerProfScanRace(r,agg,rankTracking);
  return {buckets:SURPRISE_PROF_BUCKETS.map(([,,label])=>label),agg,rankTracking,scanned:arr(d?.races).length};
}
// FIX (Tommy talebi — "eski örneklerden de veri alsın"): db.races bellek
// güvenliği için yalnız en güncel ("sıcak") pencereyi tutar; eski ("soğuk")
// koşular silinmedi, diskte/IndexedDB'de duruyor. Bu, arka planda
// tkpLoadPersistedCollectionPage ile soğuk sayfaları da tek tek okuyup aynı
// istatistiğe katar — tüm arşivi kalıcı olarak belleğe yüklemeden. Sonuç
// oturum içinde önbelleğe alınır; tek seferlik arka plan taraması biter
// bitmez bir sonraki sekme açılışında tam sonuç görünür.
let _surpriseProfScan={key:'',result:null,inFlight:false};
function surpriseProfScanKey(d){const seg=d?.__segmented_storage?.collections?.races;return ['PROF_V4_TABLE_BOTTOM_FOUR',sig(d),seg?.total||0,seg?.coldCount||0,text(d?.learning_state?.dataset_signature),text(d?.learning_state?.outcome_signature)].join('|');}
async function surpriseWinnerProfFullScan(source){
  const d=dbNow(source);if(!d)return null;
  const seg=d.__segmented_storage?.collections?.races;
  const key=surpriseProfScanKey(d);
  if(_surpriseProfScan.key===key&&_surpriseProfScan.result)return _surpriseProfScan.result;
  if(_surpriseProfScan.inFlight)return null;
  _surpriseProfScan.inFlight=true;
  try{
    const agg=surpriseProfAggregate(),rankTracking={};
    for(const r of arr(d.races))surpriseWinnerProfScanRace(r,agg,rankTracking);
    let scannedCold=0;
    const coldTotal=Number(seg?.coldCount)||0;
    if(coldTotal>0&&typeof global.tkpLoadPersistedCollectionPage==='function'){
      const pageSize=500;
      for(let offset=0;offset<coldTotal;offset+=pageSize){
        const page=await global.tkpLoadPersistedCollectionPage('races',{offset,limit:Math.min(pageSize,coldTotal-offset)});
        for(const r of arr(page?.rows))surpriseWinnerProfScanRace(r,agg,rankTracking);
        scannedCold+=arr(page?.rows).length;
        if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();
      }
    }
    const result={buckets:SURPRISE_PROF_BUCKETS.map(([,,label])=>label),agg,rankTracking,scanned:arr(d.races).length+scannedCold,archiveTotal:seg?.total||arr(d.races).length};
    _surpriseProfScan={key,result,inFlight:false};
    return result;
  }catch(_){ _surpriseProfScan.inFlight=false;return null; }
}
let _profConditionRows=[];
function profConditionRowsHTML(rows){return rows.map(x=>`<tr><td>${esc(x.condition)}</td><td>${x.rank}.</td><td>${x.candidates}</td><td>${x.wins}</td><td>${x.bmbWins}/${x.bmbCandidates}</td><td>${x.wins-x.bmbWins}/${x.candidates-x.bmbCandidates}</td></tr>`).join('');}
function profConditionPageHTML(page){
  const size=50,pages=Math.max(1,Math.ceil(_profConditionRows.length/size)),index=Math.max(0,Math.min(pages-1,Number(page)||0));
  return {body:profConditionRowsHTML(_profConditionRows.slice(index*size,(index+1)*size)),controls:`<button data-tkp-prof-page="${index-1}"${index===0?' disabled':''}>Önceki</button> <span>${index+1}/${pages} sayfa · ${_profConditionRows.length} grup</span> <button data-tkp-prof-page="${index+1}"${index===pages-1?' disabled':''}>Sonraki</button>`};
}
try{global.document?.addEventListener('click',event=>{const button=event.target?.closest?.('[data-tkp-prof-page]');if(!button||button.disabled)return;const panel=button.closest('.tkpProfBottomConditions');if(!panel)return;const page=profConditionPageHTML(button.dataset.tkpProfPage);panel.querySelector('tbody').innerHTML=page.body;panel.querySelector('.tkpProfPageControls').innerHTML=page.controls;});}catch(_){ }
function surpriseWinnerProfHTML(source){
  const d=dbNow(source),cached=_surpriseProfScan.key===surpriseProfScanKey(d)?_surpriseProfScan.result:null;
  const live=cached||surpriseWinnerProfStats(source);
  if(!cached&&!_surpriseProfScan.inFlight)surpriseWinnerProfFullScan(source).catch(()=>{});
  const scanNote=cached?`${live.scanned}/${live.archiveTotal} koşu; soğuk arşiv dahil`:`Yüklü ${live.scanned} koşu; tam arşiv taraması sürüyor`;
  const rows=live.buckets.map((label,i)=>{
    const a=live.agg[i],dist=Object.values(a.distribution).sort((x,y)=>y.wins-x.wins||x.prof-y.prof||(x.rank??999)-(y.rank??999));
    const body=dist.map(x=>`<tr><td>%${esc(x.prof)}</td><td>${x.rank==null?'Sıra verisi eksik':x.rank+'.'}</td><td>${x.wins}</td><td>${x.bmbWins}</td><td>${x.wins-x.bmbWins}</td></tr>`).join('');
    return `<tr><td><b>${esc(label)}</b></td><td>${a.n}</td><td><details><summary>PROF yüzdesi ve alttan sıra (${dist.length} grup)</summary><table class="compact"><thead><tr><th>PROF</th><th>PROF alttan sıra</th><th>Kazanan</th><th>BMB olan</th><th>BMB olmayan</th></tr></thead><tbody>${body||'<tr><td colspan="5">Kayıt yok</td></tr>'}</tbody></table></details></td></tr>`;
  }).join('');
  _profConditionRows=Object.values(live.rankTracking||{}).sort((a,b)=>b.wins-a.wins||b.candidates-a.candidates||a.rank-b.rank);
  const page=profConditionPageHTML(0),tracking=page.body;

  return `<div class="tkpProfBottomTracking" style="margin-top:10px"><h3>Büyük sürpriz kazananlarda PROF yüzdesi ve alttan sıra</h3><p class="muted">${scanNote}. PROF yüzdeleri tek tek gösterilir; ortalama alınmaz. Bu araştırmadaki PROF sırası düşük yüzdeden başlar; eşit yüzdeler aynı sırayı alır. Ayak tablosundaki ALT etiketi ise ana tablo sırasının son dört atını, benzer koşullarda geçmişte kazanan alttan sıralarla eşleştirir; atın kişisel galibiyetini ölçmez. Eski Son 4/TR takibi ana tahmin sırasına aittir. Bu tablo tarihsel araştırmadır; yarış-öncesi kanıt ve başarı şartları sağlanmadan kupona otomatik uygulanmaz.</p><div class="tableWrap"><table class="compact"><thead><tr><th>AGF sırası</th><th>Kazanan</th><th>Gerçek PROF dağılımı</th></tr></thead><tbody>${rows}</tbody></table></div><details class="tkpProfBottomConditions"><summary>Ayak tablosunun son 4 atı hangi koşularda kazanıyor? (${Object.keys(live.rankTracking||{}).length} koşu şartı/sıra grubu)</summary><div class="tkpProfPageControls">${page.controls}</div><p class="muted">Yalnız eksiksiz kayıtlı yarış-öncesi ayak sırasının son dört atı ölçülür. Aday sayısı kazanan ve kaybeden atları birlikte içerir; PROF sırası bu takipte kullanılmaz. BMB ve BMB olmayan sütunları kazanan/aday adedidir. Mesafe veya zemin eksikse açıkça belirtilir.</p><div class="tableWrap"><table class="compact"><thead><tr><th>Pist · Koşu şartı · Irk · Zemin · Mesafe</th><th>Tablodan alttan sıra</th><th>Aday</th><th>Kazandı</th><th>BMB kazandı/aday</th><th>BMB olmayan kazandı/aday</th></tr></thead><tbody>${tracking||'<tr><td colspan="6">Doğrulanmış sonuç/sıra verisi yok.</td></tr>'}</tbody></table></div></details></div>`;
}

function commentatorHistoricalPerformance(source){
  const archive=global.TKPArchiveAnalytics?.peek(source||dbNow());if(archive)return archive.commentators;
  const d=dbNow(source);if(!d)return [];
  const key=sig(d);if(commentatorCache&&cacheKey===key)return commentatorCache;
  const events=new Map();
  for(const r of arr(d.races)){
    const horses=arr(r.horses).filter(h=>h&&!isNonRunner(h));if(!horses.length)continue;
    const raceKey=[r.file_id,r.id??r.leg??'',r.race_date].join('|'),isVerified=verifiedRace(r),winner=isVerified?horses.find(h=>finish(h)===1):null;
    for(const h of horses){
      // R16.48: her hazır-kupon yorumcusu at bazında ypuan_breakdown içinde
      // source/author/rank/points ile saklanır. Eski expert_comments yoksa bile
      // bu gerçek kaynak satırları tarihsel yorumcu analizine girmelidir.
      for(const c of arr(h?.ypuan_breakdown)){
        const sourceType=text(c?.source||c?.site).toLowerCase(),author=text(c?.author||c?.author_id||c?.name||'site_yorumcusu').toLowerCase();
        if(!sourceType||!author)continue;
        const k=sourceType+'|'+author+'|'+raceKey;let e=events.get(k);
        if(!e){e={source_type:sourceType,author_id:author,raceKey,runnerCount:horses.length,selections:new Set(),winnerNo:winner?text(winner.horse_no):'',verified:!!winner,single:false};events.set(k,e);}
        e.selections.add(text(h.horse_no));if(Number(c?.points)>=14||Number(c?.single)===1)e.single=true;
      }
      for(const c of arr(h?.expert_comments)){
        if(!c||Number(c.direction)===0)continue;
        const sourceType=text(c.source||c.site).toLowerCase(),author=text(c.author||c.author_id||c.name).toLowerCase();
        if(!sourceType||!author)continue;
        const k=sourceType+'|'+author+'|'+raceKey;let e=events.get(k);
        if(!e){e={source_type:sourceType,author_id:author,raceKey,runnerCount:horses.length,selections:new Set(),winnerNo:winner?text(winner.horse_no):'',verified:!!winner,single:false};events.set(k,e);}
        e.selections.add(text(h.horse_no));if(c.single===true)e.single=true;
      }
    }
  }
  const agg=new Map();
  for(const e of events.values()){
    const k=e.source_type+'|'+e.author_id;let a=agg.get(k);if(!a){a={source_type:e.source_type,author_id:e.author_id,stored_events:0,events:0,unresolved_events:0,hits:0,selected_horses:0,expected_sum:0,single_events:0,single_hits:0,lane:'HISTORICAL_EMBEDDED_RESEARCH'};agg.set(k,a);}
    const width=e.selections.size;if(!width)continue;a.stored_events++;a.selected_horses+=width;
    if(!e.verified){a.unresolved_events++;continue;}
    const hit=e.selections.has(e.winnerNo)?1:0;a.events++;a.hits+=hit;a.expected_sum+=Math.min(1,width/Math.max(1,e.runnerCount));
    if(e.single||width===1){a.single_events++;a.single_hits+=hit;}
  }
  commentatorCache=[...agg.values()].map(a=>{
    const accuracy=a.events?a.hits/a.events:null,expected=a.events?a.expected_sum/a.events:null,edge=a.events?accuracy-expected:null;
    const avgSelections=a.stored_events?a.selected_horses/a.stored_events:null;
    // Sonuç kanıtı olmasa bile kayıt değerlendirme dışı değildir: seçim genişliği ve
    // kaynak aktivitesi ölçülür. Yalnız isabet/edge sonucu bilinmeden uydurulmaz.
    return {...a,accuracy,expected,edge,avg_selections:avgSelections,descriptive_events:a.stored_events,descriptive_coverage:a.stored_events?1:0};
  }).sort((a,b)=>b.stored_events-a.stored_events||Number(b.edge||-99)-Number(a.edge||-99));
  cacheKey=key;return commentatorCache;
}

function coverage(source,opts){
  const archive=global.TKPArchiveAnalytics?.peek(source||dbNow());if(archive&&!opts?.fullScan)return archive.coverage;
  // FIX (Tommy talebi — "eksik veriler için 1 kerelik tarama açalım"): normal
  // çağrı (opts yok) hâlâ hızlı önizleme kartı için ilk 30 örnekle önbelleklenir.
  // fullScan:true geçilirse TÜM eksik yarışlar toplanır ve — tek seferlik, elle
  // tetiklenen bir işlem olduğu için — önbelleğe YAZILMAZ/ONDAN OKUNMAZ; aksi
  // halde küçük önizleme kartı yanlışlıkla devasa listeyi saklar ya da tam
  // tarama eski 30'luk önbelleği geri döndürür.
  const fullScan=!!opts?.fullScan;
  const sampleLimit=fullScan?Infinity:30;
  const d=dbNow(source);if(!d)return null;const key=sig(d);
  if(!fullScan&&coverageCache&&cacheKey===key)return coverageCache;
  const out={version:VERSION,files:arr(d.files).length,races:arr(d.races).length,horses:0,verifiedRaces:0,verifiedWithoutWinner:0,verifiedWithoutWinnerSamples:[],quarantinedRaces:0,
    agf:0,hndkp:0,kg:0,bestTime:0,tr:0,glp:0,jbyg:0,ypuan:0,accurate:0,priorAccurate:0,predictionSnapshot:0,
    bmb:0,odb:0,xKulis:0,expertCommentRows:0,gpr:0,sp:0,value:0,sValue:0,startNo:0,resultHorseRows:0,
    // FIX (Tommy talebi — "start no olmayan kg olmayan tr puan olmayan eksik
    // sonuçları olan yarışlar var"): koşu seviyesindeki alanlar hiç sayılmıyordu;
    // aşağıdaki döngüde toplanır ve coverageHTML() içinde ayrı satır olarak
    // gösterilir, böylece hangi eski yarışlarda hangi alan eksik kalmış görünür.
    raceSurface:0,raceBreed:0,raceCondition:0,raceDistance:0,raceDate:0,incompleteRaces:0};
  const MISSING_FIELD_LABELS={surface:'Pist',breed:'Safkan türü',condition:'Koşu şartı',distance:'Mesafe',startNo:'Start No',kg:'Kilo (KG)',tr:'TR PUAN'};
  const missingByField={};
  const incompleteRaceKeys=[];
  for(const r of arr(d.races)){
    const isVerified=verifiedRace(r);
    const hasWinner=arr(r?.horses).some(h=>finish(h)===1);
    if(isVerified){
      out.verifiedRaces++;
      if(!hasWinner){
        out.verifiedWithoutWinner++;
        if(out.verifiedWithoutWinnerSamples.length<sampleLimit){
          const file=d.files?.find?.(f=>String(f?.id)===String(r?.file_id));
          out.verifiedWithoutWinnerSamples.push({date:text(r?.race_date).slice(0,10),hippodrome:text(r?.hippodrome),leg:Number(r?.leg)||0,file:text(r?.filename)||text(file?.filename)});
        }
      }
    }else if(text(r?.result_integrity_status))out.quarantinedRaces++;
    if(present(r?.surface))out.raceSurface++;if(present(r?.breed))out.raceBreed++;
    if(present(r?.condition_text))out.raceCondition++;if(present(r?.distance))out.raceDistance++;
    if(present(r?.race_date))out.raceDate++;
    let raceIncomplete=false;
    const flagRace=field=>{
      missingByField[field]=(missingByField[field]||0)+1;
      raceIncomplete=true;
    };
    if(!present(r?.surface))flagRace('surface');
    if(!present(r?.breed))flagRace('breed');
    if(!present(r?.condition_text))flagRace('condition');
    if(!present(r?.distance))flagRace('distance');
    for(const h of arr(r.horses)){
      out.horses++;const has=k=>finite(h?.[k])!==null;
      if(has('agf'))out.agf++;if(has('hndkp'))out.hndkp++;if(has('weight_kg'))out.kg++;else flagRace('kg');if(present(h?.best_time))out.bestTime++;
      if(trustedTr(h)!==null)out.tr++;else flagRace('tr');if(trustedGlp(h)!==null)out.glp++;if(trustedJbyg(h)!==null)out.jbyg++;if(trustedYpuan(h)!==null)out.ypuan++;
      if(['accurate_avg_speed_mps','accurate_max_speed_mps','accurate_closing_speed_mps','accurate_tempo_signal','accurate_finish_signal'].some(k=>has(k)))out.accurate++;
      if((finite(h?.priorAccurateAvgSpeed)||0)>0||(finite(h?.priorAccurateStarts)||0)>0||Math.abs(finite(h?.priorAccurateFinishSignal)||0)>0)out.priorAccurate++;
      if(has('prediction_order_snapshot')||has('prediction_score_snapshot'))out.predictionSnapshot++;
      if(Number(h?.bmb)===1||Number(h?.tr_bmb_candidate)===1||Number(h?.tr_hidden_fav)===1)out.bmb++;
      if(Number(h?.odb)===1||Number(h?._ypuanOdbTail)===1||/\bODB\b/i.test(text(h?.labels||h?.tag)))out.odb++;
      if(arr(h?.x_kulis_comments).length)out.xKulis++;if(arr(h?.expert_comments).length)out.expertCommentRows++;
      if((finite(h?.gpr_starts)||0)>0||(finite(h?.gpr_wins)||0)>0||Math.abs(finite(h?.gpr_strength)||0)>0)out.gpr++;if(has('sp'))out.sp++;if(has('value_score'))out.value++;if(has('s_value'))out.sValue++;
      if(has('start_no'))out.startNo++;else flagRace('startNo');
      if(verifiedRace(r)&&finish(h)!==null)out.resultHorseRows++;
    }
    // FIX: bir yarışta EN AZ bir at start_no/kg/TR PUAN'dan yoksun veya koşu
    // kendisi Pist/Safkan/Koşu şartı/Mesafe'den yoksunsa, o yarış "eksik veri"
    // sayılır ve dosya/hipodrom/tarih ile birlikte listelenir (en fazla 30 örnek
    // saklanır; kullanıcı arayüzünde hangi kartların düzeltilmesi gerektiği görünür).
    if(raceIncomplete){
      out.incompleteRaces++;
      const missingHere=[];
      if(!present(r?.surface))missingHere.push('surface');if(!present(r?.breed))missingHere.push('breed');
      if(!present(r?.condition_text))missingHere.push('condition');if(!present(r?.distance))missingHere.push('distance');
      if(arr(r.horses).some(h=>finite(h?.weight_kg)===null))missingHere.push('kg');
      if(arr(r.horses).some(h=>trustedTr(h)===null))missingHere.push('tr');
      if(arr(r.horses).some(h=>finite(h?.start_no)===null))missingHere.push('startNo');
      if(incompleteRaceKeys.length<sampleLimit){
        incompleteRaceKeys.push({file:text(r?.filename)||text(d.files?.find?.(f=>String(f?.id)===String(r?.file_id))?.filename),
          hippodrome:text(r?.hippodrome),date:text(r?.race_date).slice(0,10),leg:Number(r?.leg)||0,
          missing:missingHere.map(f=>MISSING_FIELD_LABELS[f]||f).join(', ')});
      }
    }
  }
  const snap=historicalSnapshotStats(d),comm=commentatorHistoricalPerformance(d),rescue=global.TKP_RESCUE509?.training||{};
  out.missingByField=missingByField;out.incompleteRaceSamples=incompleteRaceKeys;out.missingFieldLabels=MISSING_FIELD_LABELS;out.fullScan=fullScan;
  out.frozenSnapshotRaces=snap.evaluable;out.forwardTrackingRows=arr(d.forward_tracking_log).length;out.commentatorHistoricalSelections=comm.reduce((n,x)=>n+Number(x.stored_events||0),0);out.commentatorHistoricalEvents=comm.reduce((n,x)=>n+Number(x.events||0),0);out.commentatorHistoricalUnresolved=comm.reduce((n,x)=>n+Number(x.unresolved_events||0),0);
  out.rescueFiles=Number(rescue.files)||0;out.rescueRaces=Number(rescue.races)||0;out.rescueOfficialPayoutMeetings=Number(rescue.officialPayoutMeetings)||0;
  if(!fullScan){coverageCache=out;cacheKey=key;}
  return out;
}
// FIX (Tommy talebi — "eksik veriler için 1 kerelik tarama açalım"): elle
// tetiklenen, tam (30 örnekle sınırlı olmayan) tek seferlik tarama. Buton
// tıklamasında çağrılır; normal coverageHTML() önizlemesini yavaşlatmaz.
function runMissingDataFullScan(source){
  const archive=global.TKPArchiveAnalytics?.peek(source||dbNow());if(archive)return {ok:true,rows:archive.coverage.incompleteRaceSamples,incompleteRaces:archive.coverage.incompleteRaces,totalRaces:archive.coverage.races,html:coverageHTML(source)+'<p>Tam arşiv sayımları yukarıdadır. Ayrıntı görünümü ilk 30 örnekle sınırlıdır; kayıt araması Veri tablosunda tüm arşivi tarar.</p>'};
  const c=coverage(source,{fullScan:true});
  if(!c)return {ok:false,html:'<p class="muted">Veri bulunamadı.</p>'};
  if(!c.incompleteRaces)return {ok:true,rows:[],html:'<p class="muted">✅ Taramada eksik alanlı yarış bulunamadı.</p>'};
  const rows=c.incompleteRaceSamples||[];
  const missingRows=Object.entries(c.missingByField||{})
    .sort((a,b)=>b[1]-a[1])
    .map(([field,n])=>`<tr><td><b>${esc(c.missingFieldLabels?.[field]||field)}</b></td><td class="num" style="color:#b91c1c">${Number(n||0).toLocaleString('tr-TR')}</td></tr>`).join('');
  const detailRows=rows.map(s=>`<tr><td>${esc(s.date||'—')}</td><td>${esc(s.hippodrome||'—')}</td><td class="num">${s.leg||'—'}</td><td>${esc(s.file||'—')}</td><td>${esc(s.missing||'—')}</td></tr>`).join('');
  const html=`<p class="muted" style="margin:0 0 7px"><b>${c.incompleteRaces.toLocaleString('tr-TR')}</b> koşuda en az bir alan eksik bulundu (toplam ${c.races.toLocaleString('tr-TR')} koşu tarandı). Kaynak dosyada gerçekten olmayan bir değer buradan icat edilemez — aşağıdaki kartların kaynak dosyasını yeniden indirip/yükleyerek düzeltmen gerekir.</p>
<div class="tableWrap"><table class="compact"><thead><tr><th>Eksik alan</th><th class="num">Eksik satır</th></tr></thead><tbody>${missingRows}</tbody></table></div>
<div class="tableWrap" style="margin-top:8px"><table class="compact"><thead><tr><th>Tarih</th><th>Hipodrom</th><th class="num">Ayak</th><th>Dosya</th><th>Eksik olan</th></tr></thead><tbody>${detailRows}</tbody></table></div>`;
  return {ok:true,rows,incompleteRaces:c.incompleteRaces,totalRaces:c.races,html};
}
function coverageHTML(source){
  const c=coverage(source);if(!c)return '';
  const cold=coldNotice(source,'races','Koşu arşivi')+coldNotice(source,'forward_tracking_log','İlk Bakış forward kaydı')+coldNotice(source,'prediction_log','Tahmin kaydı');
  const row=(name,n,note='')=>`<tr><td><b>${esc(name)}</b></td><td class="num">${Number(n||0).toLocaleString('tr-TR')}</td><td>${esc(note)}</td></tr>`;
  // FIX (Tommy talebi — "start no olmayan kg olmayan tr puan olmayan eksik
  // sonuçları olan yarışlar var, düzeltelim"): coverage() bu alanları zaten
  // sayıyordu (c.kg, c.startNo, c.hndkp, c.value, c.sValue, c.sp) ama bu tablo
  // hiçbirini göstermiyordu — kullanıcı eksik veriyi göremediği için hangi
  // kartın düzeltilmesi gerektiğini bilemiyordu. Aşağıdaki satırlar eklendi;
  // ayrıca ui-components.js'teki adı-çakışan (ve bu yüzden hiç çalışmayan)
  // eski coverageHTML() burada birleştirildi (Pist/Safkan/Koşu şartı/Mesafe).
  // Missing-data diagnostic tables removed from the presentation at user request.
  const integrityNote=(c.verifiedWithoutWinnerSamples||[]).map(x=>`${x.date||'Tarih yok'} ${x.hippodrome||'Hipodrom yok'} ${x.leg?`${x.leg}. ayak`:''} ${x.file||''}`.trim()).join(' · ');
  const integrityRow=`<tr><td><b>Doğrulama etiketi var, kazanan derecesi yok</b></td><td class="num">${Number(c.verifiedWithoutWinner||0).toLocaleString('tr-TR')}</td><td>${esc(integrityNote||'Tüm doğrulanmış koşularda kazanan derecesi mevcut')}</td></tr>`;
  return `<div class="card tkpAllHistoricalCoverage" style="border-left:5px solid #0f766e"><h3 style="margin:0 0 5px">🗄️ Eski Arşiv · Tüm Tablo Veri Köprüsü</h3><p class="muted" style="margin:0 0 7px">${c.files} toplantı / ${c.races} koşu / ${c.horses.toLocaleString('tr-TR')} at satırı ortak veri katmanına bağlıdır. Eksik kaynak değeri 0 yapılmaz; doğrulanmamış sonuç öğrenmeye girmez.</p>${cold}<div class="tableWrap"><table class="compact"><thead><tr><th>Kaynak/katman</th><th class="num">Kullanılabilir at/koşu</th><th>Kural</th></tr></thead><tbody>${row('Doğrulanmış sonuç',c.verifiedRaces,'TJK resmî sıralı bahis kanıtı')}${integrityRow}${row('Frozen tahmin snapshotı',c.frozenSnapshotRaces,'TEK/İlk Bakış tarihsel araştırma; bugünkü modelle replay yok')}${row('Pist',c.raceSurface,'Koşu seviyesi alan')}${row('Safkan türü',c.raceBreed,'Koşu seviyesi alan')}${row('Koşu şartı',c.raceCondition,'Koşu seviyesi alan')}${row('Mesafe',c.raceDistance,'Koşu seviyesi alan')}${row('Tarih',c.raceDate,'Koşu seviyesi alan')}${row('SONUÇ (doğrulanmış at satırı)',c.resultHorseRows,'Yalnız doğrulanmış koşularda')}${row('Start No',c.startNo,'At seviyesi — kupon ayak eşleşmesi için gerekli')}${row('Kilo (KG)',c.kg,'At seviyesi')}${row('HNDKP',c.hndkp,'At seviyesi')}${row('AGF',c.agf,'Mevcut tüm eski değer')}${row('TR PUAN',c.tr,'Yalnız GANYAN_CANAVARI_TR')}${row('VALUE',c.value,'At seviyesi')}${row('S-VALUE',c.sValue,'At seviyesi')}${row('SP',c.sp,'At seviyesi')}${row('GLP / 800G',c.glp,'TJK günlük + Ganyan Canavarı/YeniBeygir tarihsel kaynak')}${row('J-BYG',c.jbyg,'TJK günlük + Ganyan Canavarı/YeniBeygir tarihsel kaynak')}${row('Y.PUAN',c.ypuan,'Misli + Bi\'Talih + Hipodrom.com + AtYarisi.com yorumcu kanıtı; yoksa —')}${row('Accurate',c.accurate,'Hız/tempo/bitiriş alanlarından herhangi biri')}${row('Geçmiş Accurate',c.priorAccurate,'Önceki yarışlardan türetilmiş yarış-öncesi özellikler')}${row('Yorumcu eski seçim olayı',c.commentatorHistoricalSelections,`${c.commentatorHistoricalEvents} sonuç-doğrulanmış · ${c.commentatorHistoricalUnresolved} sonuç karantina; doğrulanmayan isabet 0 sayılmaz`)}${row('X/Kulis at satırı',c.xKulis,'Zaman/provenance uygunsa değerlendirme')}${row('Rescue eğitim arşivi',c.rescueRaces,`${c.rescueFiles} toplantı; ROI kanıtı ${c.rescueOfficialPayoutMeetings} resmî payout toplantısı`)}</tbody></table></div></div>`;
}
function snapshotTrackingHTML(source){
  const s=historicalSnapshotStats(source);
  const cold=coldNotice(source,'forward_tracking_log','İlk Bakış forward kaydı')+coldNotice(source,'races','Koşu arşivi');
  const rankRows=[1,2,3,4,5,6].map(rank=>`<tr><td><b>${rank}. güçlü ayak lideri</b></td><td class="num">${Number(s.firstLookRankEligible?.[rank]||0)}</td><td class="num">${Number(s.firstLookRankWins?.[rank]||0)}</td><td class="num"><b>${pct(s.firstLookRankWins?.[rank]||0,s.firstLookRankEligible?.[rank]||0)}</b></td></tr>`).join('');
  const meetingRows=[0,1,2,3,4,5,6].map(count=>`<tr><td><b>${count} lider kazandı</b></td><td class="num">${Number(s.meetingLeaderWinCounts?.[count]||0)}</td><td class="num"><b>${pct(s.meetingLeaderWinCounts?.[count]||0,s.trackedMeetings||0)}</b></td></tr>`).join('');
  return `<div class="card tkpHistoricalSnapshotTracking" style="border-left:5px solid #0284c7"><h3 style="margin:0 0 4px">📚 Arşiv + Günlük · İlk Bakıştaki 6 Ayak Lideri</h3><p class="muted" style="margin:0 0 7px">Her Altılıda Genel Bakışta görünen altı ayak lideri kendi aralarında TKP gücüne göre 1–6 sıralanır. Hangilerinin kazandığı ve bir toplantıda kaç liderin kazandığı izlenir. Gerçek kupon TEK'i ayrıca kendi ayak sırasıyla takip edilir; MİRŞEŞEN gibi 2. sıradan seçilmiş TEK'ler dışlanmaz.</p>${cold}<div class="tkpTrackingKpis"><span><b>Takip edilen Altılı</b> ${Number(s.trackedMeetings||0)}</span><span><b>Takip edilen ayak</b> ${Number(s.evaluable||0)}</span><span><b>Kazanan ayak lideri</b> ${Number(s.leaderWin||0)}</span><span><b>Gerçek forward kayıt</b> ${Number(s.explicitForward||0)}</span></div><div class="tkpTekProfileGrid"><div><h3>Altı liderin güç sırası</h3><div class="tableWrap"><table class="tkpFirstLookTekTable"><thead><tr><th>Genel Bakış sırası</th><th>Altılı</th><th>Kazandı</th><th>İsabet</th></tr></thead><tbody>${rankRows}</tbody></table></div></div><div><h3>Bir Altılıda kazanan lider adedi</h3><div class="tableWrap"><table class="tkpFirstLookTekTable"><thead><tr><th>Adet</th><th>Altılı</th><th>Pay</th></tr></thead><tbody>${meetingRows}</tbody></table></div></div></div>${surpriseWinnerProfHTML(source)}</div>`;}
function missingDisplay(v,formatter){if(v===null||v===undefined||String(v).trim()==='')return '—';if(typeof formatter==='function')try{return formatter(v);}catch(_){ }return String(v);}
function historicalHorseVector(r,h,file){
  const verified=verifiedRace(r);const storedFinish=finish(h);const fp=verified?storedFinish:null;
  const storedWinner=h?.winner==null?null:(Number(h.winner)===1?1:0);
  return {
    file:file?.filename||r?.filename||'',status:file?.status||'',date:r?.race_date||file?.race_date||'',hippodrome:r?.hippodrome||file?.hippodrome||'',leg:r?.leg,
    race_id:r?.id??null,file_id:r?.file_id??null,surface:r?.surface??null,breed:r?.breed??null,condition:r?.condition_text??null,distance:r?.distance??null,
    result_integrity_status:r?.result_integrity_status||'',result_integrity_source:r?.result_integrity_source||'',
    horse_no:h?.horse_no??null,horse:h?.horse_name??null,jockey:h?.jockey_name??null,trainer:h?.trainer_name??null,start_no:finite(h?.start_no),
    agf:finite(h?.agf),agf_rank:finite(h?.agf_rank),ypuan:trustedYpuan(h),ypuan_raw:finite(h?.ypuan_raw),ypuan_source:h?.ypuan_source||'',
    tr:trustedTr(h),tr_source:h?.tr_ganyan_source||'',tr_rank:finite(h?.tr_rank??h?.tr_ganyan_rank),
    glp:trustedGlp(h),g800:finite(h?.g800),glp_rank:finite(h?.glp_rank??h?.g800_rank),glp_source:h?.glp_source||'',
    jbyg:trustedJbyg(h),jbyg_rank:finite(h?.jbyg_rank),jbyg_source:h?.jbyg_source||'',
    kg:finite(h?.weight_kg),best_time:present(h?.best_time)?h.best_time:null,hndkp:finite(h?.hndkp),hndkp_rank:finite(h?.hndkp_rank),s_value:finite(h?.s_value),sp:finite(h?.sp),
    value:finite(h?.value_score),value_raw:finite(h?.value_raw),result_score:finite(h?.result_score),result:finite(h?.result_score),bmb:finite(h?.bmb),odb:finite(h?.odb??h?._ypuanOdbTail),
    accurate_avg_speed_mps:finite(h?.accurate_avg_speed_mps),accurate_max_speed_mps:finite(h?.accurate_max_speed_mps),accurate_closing_speed_mps:finite(h?.accurate_closing_speed_mps),accurate_tempo_signal:finite(h?.accurate_tempo_signal),accurate_finish_signal:finite(h?.accurate_finish_signal),
    prior_accurate_avg_speed:finite(h?.priorAccurateAvgSpeed),prior_accurate_finish_signal:finite(h?.priorAccurateFinishSignal),prior_accurate_starts:finite(h?.priorAccurateStarts),
    prior_starts:finite(h?.priorStarts),prior_wins:finite(h?.priorWins),cond_win_starts:finite(h?.condWinStarts),cond_win_wins:finite(h?.condWinWins),cond_win_pct:finite(h?.condWinPct),prior_surprise_hits:finite(h?.priorSurpriseHits),cond_surprise_hits:finite(h?.condSurpriseHits),
    gpr_starts:finite(h?.gpr_starts),gpr_wins:finite(h?.gpr_wins),gpr_strength:finite(h?.gpr_strength),
    prediction_order_snapshot:finite(h?.prediction_order_snapshot),prediction_score_snapshot:finite(h?.prediction_score_snapshot),prediction_score_locked:Number(h?.prediction_score_locked)===1?1:0,prediction_score_model_version:h?.prediction_score_model_version||'',strategy_rank:finite(h?._strategy_rank),
    x_kulis_comments:arr(h?.x_kulis_comments),expert_comments:arr(h?.expert_comments),x_kulis_captured_at:h?.x_kulis_captured_at||null,x_kulis_race_start_at:h?.x_kulis_race_start_at||null,
    stored_finish_position:storedFinish,stored_winner:storedWinner,
    finish_position:fp,winner:verified&&fp===1?1:(verified&&fp!==null?0:null)
  };
}
function backfillMetadata(source){
  const d=dbNow(source);if(!d)return false;d.settings=d.settings&&typeof d.settings==='object'?d.settings:{};
  const c=coverage(d),s=historicalSnapshotStats(d),comm=commentatorHistoricalPerformance(d);
  d.settings.historical_all_table_bridge={version:VERSION,completed:true,updated_at:new Date().toISOString(),coverage:c,snapshot_tracking:s,commentator_rows:comm.length,policy:'USE_EVERY_AVAILABLE_HISTORICAL_FIELD_PARTIAL_EVALUATION_ALLOWED_MISSING_IS_NOT_ZERO'};
  return d.settings.historical_all_table_bridge;
}
async function backfillMetadataAsync(source){const d=dbNow(source);if(typeof global.tkpWaitForBackgroundSafeWindow==='function')await global.tkpWaitForBackgroundSafeWindow({minIdleMs:900,retryMs:120});const out=backfillMetadata(d);if(typeof global.tkpYieldToUi==='function')await global.tkpYieldToUi();return out;}
try{global.addEventListener?.('tkp:db-changed',invalidate);}catch(_){ }
global.TKP_HISTORICAL_ALL_DATA_BRIDGE_VERSION=VERSION;
global.tkpHistoricalVerifiedRace=verifiedRace;
global.tkpHistoricalFrozenOrderForRace=frozenOrderForRace;
global.tkpHistoricalSnapshotStats=historicalSnapshotStats;
global.tkpHistoricalCommentatorPerformanceReport=commentatorHistoricalPerformance;
global.tkpHistoricalAllDataCoverage=coverage;
global.tkpHistoricalAllDataCoverageHTML=(...args)=>coverageHTML(...args);
global.tkpRunMissingDataFullScan=runMissingDataFullScan;
global.tkpHistoricalSnapshotTrackingHTML=(...args)=>snapshotTrackingHTML(...args);
global.tkpHistoricalMissingDisplay=missingDisplay;
global.tkpHistoricalHorseFeatureVector=historicalHorseVector;
global.tkpHistoricalAllDataBackfill=backfillMetadata;
global.tkpHistoricalAllDataBackfillAsync=backfillMetadataAsync;
})(globalThis);
