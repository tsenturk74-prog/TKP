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
function invalidate(){cacheKey='';coverageCache=null;commentatorCache=null;snapshotCache=null;}
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
function commentatorHistoricalPerformance(source){
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

function coverage(source){
  const d=dbNow(source);if(!d)return null;const key=sig(d);if(coverageCache&&cacheKey===key)return coverageCache;
  const out={version:VERSION,files:arr(d.files).length,races:arr(d.races).length,horses:0,verifiedRaces:0,quarantinedRaces:0,
    agf:0,hndkp:0,kg:0,bestTime:0,tr:0,glp:0,jbyg:0,ypuan:0,accurate:0,priorAccurate:0,predictionSnapshot:0,
    bmb:0,odb:0,xKulis:0,expertCommentRows:0,gpr:0,sp:0,value:0,sValue:0,startNo:0,resultHorseRows:0};
  for(const r of arr(d.races)){
    if(verifiedRace(r))out.verifiedRaces++;else if(text(r?.result_integrity_status))out.quarantinedRaces++;
    for(const h of arr(r.horses)){
      out.horses++;const has=k=>finite(h?.[k])!==null;
      if(has('agf'))out.agf++;if(has('hndkp'))out.hndkp++;if(has('weight_kg'))out.kg++;if(present(h?.best_time))out.bestTime++;
      if(trustedTr(h)!==null)out.tr++;if(trustedGlp(h)!==null)out.glp++;if(trustedJbyg(h)!==null)out.jbyg++;if(trustedYpuan(h)!==null)out.ypuan++;
      if(['accurate_avg_speed_mps','accurate_max_speed_mps','accurate_closing_speed_mps','accurate_tempo_signal','accurate_finish_signal'].some(k=>has(k)))out.accurate++;
      if((finite(h?.priorAccurateAvgSpeed)||0)>0||(finite(h?.priorAccurateStarts)||0)>0||Math.abs(finite(h?.priorAccurateFinishSignal)||0)>0)out.priorAccurate++;
      if(has('prediction_order_snapshot')||has('prediction_score_snapshot'))out.predictionSnapshot++;
      if(Number(h?.bmb)===1||Number(h?.tr_bmb_candidate)===1||Number(h?.tr_hidden_fav)===1)out.bmb++;
      if(Number(h?.odb)===1||Number(h?._ypuanOdbTail)===1||/\bODB\b/i.test(text(h?.labels||h?.tag)))out.odb++;
      if(arr(h?.x_kulis_comments).length)out.xKulis++;if(arr(h?.expert_comments).length)out.expertCommentRows++;
      if((finite(h?.gpr_starts)||0)>0||(finite(h?.gpr_wins)||0)>0||Math.abs(finite(h?.gpr_strength)||0)>0)out.gpr++;if(has('sp'))out.sp++;if(has('value_score'))out.value++;if(has('s_value'))out.sValue++;if(has('start_no'))out.startNo++;
      if(verifiedRace(r)&&finish(h)!==null)out.resultHorseRows++;
    }
  }
  const snap=historicalSnapshotStats(d),comm=commentatorHistoricalPerformance(d),rescue=global.TKP_RESCUE509?.training||{};
  out.frozenSnapshotRaces=snap.evaluable;out.forwardTrackingRows=arr(d.forward_tracking_log).length;out.commentatorHistoricalSelections=comm.reduce((n,x)=>n+Number(x.stored_events||0),0);out.commentatorHistoricalEvents=comm.reduce((n,x)=>n+Number(x.events||0),0);out.commentatorHistoricalUnresolved=comm.reduce((n,x)=>n+Number(x.unresolved_events||0),0);
  out.rescueFiles=Number(rescue.files)||0;out.rescueRaces=Number(rescue.races)||0;out.rescueOfficialPayoutMeetings=Number(rescue.officialPayoutMeetings)||0;
  coverageCache=out;cacheKey=key;return out;
}
function coverageHTML(source){
  const c=coverage(source);if(!c)return '';
  const row=(name,n,note='')=>`<tr><td><b>${esc(name)}</b></td><td class="num">${Number(n||0).toLocaleString('tr-TR')}</td><td>${esc(note)}</td></tr>`;
  return `<div class="card tkpAllHistoricalCoverage" style="border-left:5px solid #0f766e"><h3 style="margin:0 0 5px">🗄️ Eski Arşiv · Tüm Tablo Veri Köprüsü</h3><p class="muted" style="margin:0 0 7px">${c.files} toplantı / ${c.races} koşu / ${c.horses.toLocaleString('tr-TR')} at satırı ortak veri katmanına bağlıdır. Eksik kaynak değeri 0 yapılmaz; doğrulanmamış sonuç öğrenmeye girmez.</p><div class="tableWrap"><table class="compact"><thead><tr><th>Kaynak/katman</th><th class="num">Kullanılabilir at/koşu</th><th>Kural</th></tr></thead><tbody>${row('Doğrulanmış sonuç',c.verifiedRaces,'TJK resmî sıralı bahis kanıtı')}${row('Frozen tahmin snapshotı',c.frozenSnapshotRaces,'TEK/İlk Bakış tarihsel araştırma; bugünkü modelle replay yok')}${row('AGF',c.agf,'Mevcut tüm eski değer')}${row('TR PUAN',c.tr,'Yalnız GANYAN_CANAVARI_TR')}${row('GLP / 800G',c.glp,'TJK günlük + Ganyan Canavarı/YeniBeygir tarihsel kaynak')}${row('J-BYG',c.jbyg,'TJK günlük + Ganyan Canavarı/YeniBeygir tarihsel kaynak')}${row('Y.PUAN',c.ypuan,'Misli + Bi\'Talih + Hipodrom.com + AtYarisi.com yorumcu kanıtı; yoksa —')}${row('Accurate',c.accurate,'Hız/tempo/bitiriş alanlarından herhangi biri')}${row('Geçmiş Accurate',c.priorAccurate,'Önceki yarışlardan türetilmiş yarış-öncesi özellikler')}${row('Yorumcu eski seçim olayı',c.commentatorHistoricalSelections,`${c.commentatorHistoricalEvents} sonuç-doğrulanmış · ${c.commentatorHistoricalUnresolved} sonuç karantina; doğrulanmayan isabet 0 sayılmaz`)}${row('X/Kulis at satırı',c.xKulis,'Zaman/provenance uygunsa değerlendirme')}${row('Rescue eğitim arşivi',c.rescueRaces,`${c.rescueFiles} toplantı; ROI kanıtı ${c.rescueOfficialPayoutMeetings} resmî payout toplantısı`)}</tbody></table></div></div>`;
}
function snapshotTrackingHTML(source){
  const s=historicalSnapshotStats(source);
  const rankRows=[1,2,3,4,5,6].map(rank=>`<tr><td><b>${rank}. güçlü ayak lideri</b></td><td class="num">${Number(s.firstLookRankEligible?.[rank]||0)}</td><td class="num">${Number(s.firstLookRankWins?.[rank]||0)}</td><td class="num"><b>${pct(s.firstLookRankWins?.[rank]||0,s.firstLookRankEligible?.[rank]||0)}</b></td></tr>`).join('');
  const meetingRows=[0,1,2,3,4,5,6].map(count=>`<tr><td><b>${count} lider kazandı</b></td><td class="num">${Number(s.meetingLeaderWinCounts?.[count]||0)}</td><td class="num"><b>${pct(s.meetingLeaderWinCounts?.[count]||0,s.trackedMeetings||0)}</b></td></tr>`).join('');
  return `<div class="card tkpHistoricalSnapshotTracking" style="border-left:5px solid #0284c7"><h3 style="margin:0 0 4px">📚 Arşiv + Günlük · İlk Bakıştaki 6 Ayak Lideri</h3><p class="muted" style="margin:0 0 7px">Her Altılıda Genel Bakışta görünen altı ayak lideri kendi aralarında TKP gücüne göre 1–6 sıralanır. Hangilerinin kazandığı ve bir toplantıda kaç liderin kazandığı izlenir. Gerçek kupon TEK'i ayrıca kendi ayak sırasıyla takip edilir; MİRŞEŞEN gibi 2. sıradan seçilmiş TEK'ler dışlanmaz.</p><div class="tkpTrackingKpis"><span><b>Takip edilen Altılı</b> ${Number(s.trackedMeetings||0)}</span><span><b>Takip edilen ayak</b> ${Number(s.evaluable||0)}</span><span><b>Kazanan ayak lideri</b> ${Number(s.leaderWin||0)}</span><span><b>Gerçek forward kayıt</b> ${Number(s.explicitForward||0)}</span></div><div class="tkpTekProfileGrid"><div><h3>Altı liderin güç sırası</h3><div class="tableWrap"><table class="tkpFirstLookTekTable"><thead><tr><th>Genel Bakış sırası</th><th>Altılı</th><th>Kazandı</th><th>İsabet</th></tr></thead><tbody>${rankRows}</tbody></table></div></div><div><h3>Bir Altılıda kazanan lider adedi</h3><div class="tableWrap"><table class="tkpFirstLookTekTable"><thead><tr><th>Adet</th><th>Altılı</th><th>Pay</th></tr></thead><tbody>${meetingRows}</tbody></table></div></div></div></div>`;}
function missingDisplay(v,formatter){if(v===null||v===undefined||String(v).trim()==='')return '—';if(typeof formatter==='function')try{return formatter(v);}catch(_){ }return String(v);}
function historicalHorseVector(r,h,file){
  const verified=verifiedRace(r);const fp=verified?finish(h):null;
  return {
    file:file?.filename||r?.filename||'',status:file?.status||'',date:r?.race_date||file?.race_date||'',hippodrome:r?.hippodrome||file?.hippodrome||'',leg:r?.leg,
    race_id:r?.id??null,file_id:r?.file_id??null,surface:r?.surface??null,breed:r?.breed??null,condition:r?.condition_text??null,distance:r?.distance??null,
    result_integrity_status:r?.result_integrity_status||'',result_integrity_source:r?.result_integrity_source||'',
    horse_no:h?.horse_no??null,horse:h?.horse_name??null,jockey:h?.jockey_name??null,trainer:h?.trainer_name??null,start_no:finite(h?.start_no),
    agf:finite(h?.agf),agf_rank:finite(h?.agf_rank),ypuan:trustedYpuan(h),ypuan_raw:finite(h?.ypuan),ypuan_source:h?.ypuan_source||'',
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
global.tkpHistoricalAllDataCoverageHTML=coverageHTML;
global.tkpHistoricalSnapshotTrackingHTML=snapshotTrackingHTML;
global.tkpHistoricalMissingDisplay=missingDisplay;
global.tkpHistoricalHorseFeatureVector=historicalHorseVector;
global.tkpHistoricalAllDataBackfill=backfillMetadata;
global.tkpHistoricalAllDataBackfillAsync=backfillMetadataAsync;
})(globalThis);
