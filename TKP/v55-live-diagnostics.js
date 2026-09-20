/* TKP V55 — canonical TEK, Expert/Kulis blend, live loss diagnosis and rescue statistics.
   Prediction decisions use pre-race fields only. winner/finish/payout fields are read
   exclusively by the post-result diagnosis functions. */

const TKP_V55_ALGORITHM_VERSION='V55_CANONICAL_TEK_EXPERT_DIAGNOSTICS_2026_08_19';

function tkpV55Num(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function tkpV55Clamp(value,min,max){return Math.max(min,Math.min(max,tkpV55Num(value,min)));}
function tkpV55RoundMoney(value){return Math.round(tkpV55Num(value)*100)/100;}
function tkpV55Html(value){try{return typeof esc==='function'?esc(value):String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}catch(_){return String(value??'');}}
function tkpV55SameHorse(a,b){
  const aa=String(a??'').trim().toLocaleUpperCase('tr-TR'),bb=String(b??'').trim().toLocaleUpperCase('tr-TR');
  if(!aa||!bb)return false;if(aa===bb)return true;
  try{return typeof sameEkuri==='function'&&sameEkuri(aa,bb);}catch(_){return false;}
}
function tkpV55SameHorseExact(a,b){
  const norm=value=>{
    const raw=String(value??'').trim();if(!raw)return '';
    let base=raw;try{if(typeof ekuriBase==='function')base=String(ekuriBase(raw)||raw);}catch(_){ }
    return base.trim().replace(/^0+(?=\d)/,'');
  };
  const aa=norm(a),bb=norm(b);return !!aa&&aa===bb;
}
function tkpV55LiveHorses(r,pool){return (pool||r?.horses||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));}
function tkpV55Normalize(value,maxValue){const v=tkpV55Num(value),m=tkpV55Num(maxValue);return m>0?tkpV55Clamp(100*v/m,0,100):0;}
const TKP_V55_MIN_PERCENT_SAMPLE=1; // V1.1.305: 20 yarış zorunluluğu kaldırıldı
function tkpV55CommentatorConsensus(h,race=null){
  // Raw loaded cards, X posts and mutable legacy counters intentionally do not
  // participate here. Only the append-only, timestamp-locked commentator ledger
  // can return an available consensus. Strong ready-coupon authors become eligible
  // after 20 resolved LIVE events with a small automatic cap; the larger 150-event
  // manual approval gate remains available for the higher expert ceiling.
  try{
    if(typeof globalThis.tkpCommentatorConsensus==='function'){
      const governed=globalThis.tkpCommentatorConsensus(race,h);
      if(governed&&typeof governed==='object')return governed;
    }
  }catch(_){ }
  return {available:false,authors:0,score:null,average:null,total:0,positive:0,top2:0,single:0,omissions:0,ratio:0,limited_boost:0,single_eligible:false,comments:[]};
}

let _tkpV55ExpertEvidenceCache=new WeakMap();
let _tkpV55ExpertOrderCache=new WeakMap();
function tkpV55ExpertPoolSignature(r,pool){
  const dbSig=typeof tkpFastDbSignature==='function'?tkpFastDbSignature(db):`${db?.files?.length||0}:${db?.races?.length||0}`;
  const commentatorRevision=typeof globalThis.tkpCommentatorGovernanceRevision==='function'?globalThis.tkpCommentatorGovernanceRevision():0;
  return `${dbSig}|CE:${commentatorRevision}|`+(pool||[]).map(h=>[h?.horse_no,h?.score,h?.prediction_score_snapshot,h?.agf,h?.agf_rank,h?.ypuan,h?.value_score,h?.bmb,h?.odb,h?.tr_hidden_fav,h?.tr_bmb_candidate,h?.ready_coupon_single_site_count,h?.ready_coupon_single_consensus,(h?.ready_coupon_single_sources||[]).join(',')].join(':')).join(';');
}
/* Expert/Kulis score deliberately excludes winner, finish_position, payouts and current-race Accurate. */
function tkpV55ExpertEvidence(r,h,poolArg=null){
  const pool=tkpV55LiveHorses(r,poolArg);
  const cacheTarget=r&&typeof r==='object'?r:null,cacheKey=String(h?.horse_no||'');
  const signature=tkpV55ExpertPoolSignature(r,pool),bucket=cacheTarget?_tkpV55ExpertEvidenceCache.get(cacheTarget):null,cached=bucket?.get(cacheKey);
  if(cached?.signature===signature)return cached.value;
  // Salt-okunur arşivde Expert kanıtı da yarış-öncesi snapshot'tan okunur.
  // Güncel profil/TR taraması arşiv kararına yeni bilgi katmaz; yalnızca aynı
  // kaydı tekrar üretip kupon bütçe hedefini ve yan bahis açılışını yavaşlatır.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r)){
    const raw=typeof tkpArchivedEvidenceScore==='function'
      ?tkpArchivedEvidenceScore(r,h)
      :Math.max(0,Math.min(100,Number(h?.prediction_score_snapshot??h?.score)||0));
    const agf=Number.isFinite(Number(h?.agf))?Math.max(0,Math.min(100,Number(h.agf))):null;
    const ypuan=Number(h?.ypuan??h?.y_puan)||0;
    const value={score:Math.round(raw*10)/10,sourceCount:raw>0?1:0,labels:raw>0?['Kayıtlı TKP snapshotı']:[],parts:[{key:'snapshot',label:'Kayıtlı TKP',value:Math.round(raw*10)/10,weight:100,available:raw>0}],comments:[],commentatorCount:0,commentatorAverage:null,expertTotal:0,expertPositive:0,expertTop2:0,expertSingles:0,expertOmissions:0,expertSupportPct:0,expertPower:0,expertMajority:false,majorityValue:false,readyCouponSingleEligible:false,readyCouponTekSites:0,readyCouponTekSources:[],commentatorSingleEligible:false,champion:Math.round(raw*10)/10,ypuan,agf,x:null};
    if(cacheTarget){const next=bucket||new Map();next.set(cacheKey,{signature,value});_tkpV55ExpertEvidenceCache.set(cacheTarget,next);}
    return value;
  }
  const championRaw=(()=>{try{return typeof altiliWinnerScoreForHorse==='function'?tkpV55Num(altiliWinnerScoreForHorse(r,h)):tkpV55Clamp(100*tkpV55Num(h?.score)/(tkpV55Num(h?.score)+0.5),0,100);}catch(_){return tkpV55Clamp(tkpV55Num(h?.score)*20,0,100);}})();
  const maxY=Math.max(0,...pool.map(x=>tkpV55Num(x?.ypuan)));
  const yRaw=Math.max(0,tkpV55Num(h?.ypuan));
  const ypuan=maxY>0?tkpV55Normalize(yRaw,maxY):0;
  const commentator=tkpV55CommentatorConsensus(h,r);
  const readyTekSites=Math.max(0,tkpV55Num(h?.ready_coupon_single_site_count));
  const readyTekSources=Array.isArray(h?.ready_coupon_single_sources)?h.ready_coupon_single_sources.map(String).filter(Boolean):[];
  // Bu alanlar yalnız race-data'nın Collector SHA + pre-race saat kapısından gelir.
  // Manuel veya yarış sonrası kart, bu bayrağı üretemez.
  const readyCouponSingleEligible=h?.ready_coupon_single_consensus===true&&readyTekSites>=2&&new Set(readyTekSources).size>=2;
  const xAvailable=commentator.available===true;
  // The governance engine caps this in the 50–58 range.  It is a small
  // Expert-only tiebreaker, never a raw X score or a direct coupon instruction.
  const x=xAvailable?tkpV55Clamp(commentator.score,0,100):null;
  const agf=Number.isFinite(Number(h?.agf))?tkpV55Clamp(h.agf,0,100):null;
  let profile=null;try{if(typeof profileStrengthPct==='function')profile=tkpV55Clamp(profileStrengthPct(r,h),0,100);}catch(_){ }
  const bmbOdb=(tkpV55Num(h?.bmb)===1||tkpV55Num(h?.odb)===1||(()=>{try{return typeof isOdbCandidate==='function'&&isOdbCandidate(h,r);}catch(_){return false;}})())?100:0;
  const valueSignal=Math.max(bmbOdb,tkpV55Num(h?.value_score)>0?75:0,tkpV55Num(h?.tr_hidden_fav)===1?90:0,tkpV55Num(h?.tr_bmb_candidate)===1?70:0);
  const majority=commentator.total>=3&&commentator.positive>commentator.omissions;
  const majorityValue=majority&&valueSignal>0;
  const expertSupportPct=commentator.total?100*commentator.positive/commentator.total:0;
  const expertTop2Pct=commentator.total?100*commentator.top2/commentator.total:0;
  const expertSinglePct=commentator.total?100*commentator.single/commentator.total:0;
  // Kullanıcının Uzman Güç Puanı: destek ana omurga; ilk-2 ve açık TEK
  // oyları sıralama kalitesini, BMB/ODB/TR ise bizim veri uyumunu temsil eder.
  const expertPower=tkpV55Clamp(expertSupportPct*.70+expertTop2Pct*.20+expertSinglePct*.05+(valueSignal>0?5:0),0,100);
  const readyConsensus=readyCouponSingleEligible?100:(readyTekSites>0?Math.min(70,readyTekSites*22):0);
  const parts=[
    {key:'champion',label:'Champion',value:championRaw,weight:30,available:true},
    {key:'ypuan',label:'Y.PUAN/Yorumcu',value:ypuan,weight:18,available:maxY>0},
    // Kulis artık küçük bir eşitlik bozucu değil: yönetişimden geçmiş uzman
    // sinyali ve onaylı hazır-kupon mutabakatı Uzman/Kulis kolunun ana eksenidir.
    {key:'x',label:'Onaylı Kulis',value:x??0,weight:22,available:xAvailable},
    {key:'uzman_gucu',label:'Uzman Gücü',value:expertPower,weight:14,available:commentator.total>0},
    {key:'hazir_tek',label:'Hazır Kupon Mutabakatı',value:readyConsensus,weight:8,available:readyTekSites>0},
    {key:'agf',label:'AGF',value:agf??0,weight:5,available:agf!=null},
    {key:'profile',label:'Profil',value:profile??0,weight:3,available:profile!=null}
  ].filter(p=>p.available);
  const weight=parts.reduce((s,p)=>s+p.weight,0)||1;
  let score=parts.reduce((s,p)=>s+p.value*p.weight,0)/weight;
  const priority=globalThis.TKP_COUPON_POLICY?.commentPriority(r,h);
  if(priority?.score>0)score+=8*priority.score;
  const comments=Array.isArray(commentator?.comments)?commentator.comments:[];
  const sourceCount=(championRaw>0?1:0)+(yRaw>0?1:0)+(xAvailable?1:0)+(valueSignal>0?1:0)+(agf!=null?1:0);
  if(majority)score+=4;if(majorityValue)score+=5;if(commentator.single>=2)score+=4;if(readyCouponSingleEligible)score+=4;
  if(sourceCount>=4)score+=3;if(sourceCount<=1)score-=4;
  score=tkpV55Clamp(score,0,100);
  const labels=parts.filter(p=>p.value>=55).map(p=>p.label);
  const value={score:Math.round(score*10)/10,sourceCount,labels,parts,comments:comments.slice(0,6),commentatorCount:commentator.authors,commentatorAverage:commentator.average,expertTotal:commentator.total,expertPositive:commentator.positive,expertTop2:commentator.top2,expertSingles:commentator.single,expertOmissions:commentator.omissions,expertSupportPct:Math.round(expertSupportPct*10)/10,expertPower:Math.round(expertPower*10)/10,expertMajority:majority,majorityValue,readyCouponSingleEligible,readyCouponTekSites:readyTekSites,readyCouponTekSources:readyTekSources,commentatorSingleEligible:commentator.single_eligible===true||readyCouponSingleEligible,champion:Math.round(championRaw*10)/10,ypuan:Math.round(ypuan*10)/10,x:x==null?null:Math.round(x*10)/10,readyConsensus:Math.round(readyConsensus*10)/10};
  if(cacheTarget){const next=bucket||new Map();next.set(cacheKey,{signature,value});_tkpV55ExpertEvidenceCache.set(cacheTarget,next);}
  return value;
}

function tkpV55ExpertOrderForRace(r,poolArg=null){
  const base=tkpV55LiveHorses(r,poolArg);
  if(!base.length)return [];
  const cacheTarget=r&&typeof r==='object'?r:null,signature=tkpV55ExpertPoolSignature(r,base),cached=cacheTarget?_tkpV55ExpertOrderCache.get(cacheTarget):null;
  if(cached?.signature===signature)return cached.value.slice();
  // Salt-okunur arşivde yarış-öncesi sıra snapshot'ın kendisidir. Güncel Uzman/Kulis
  // kanıtını yeniden kurmak hem kararı değiştirebilir hem de 3.000+ yarışlık arşivi
  // tekrar tarayarak sekme/kupon açılışını gereksiz yere yavaşlatır. Canlı yarışlarda
  // aşağıdaki tam kanıt yolu aynen korunur.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r)){
    const frozen=typeof tkpArchivedOrderedRows==='function'
      ?tkpArchivedOrderedRows({r,scored:base})
      :base.slice();
    if(cacheTarget)_tkpV55ExpertOrderCache.set(cacheTarget,{signature,value:frozen.slice()});
    return frozen.slice();
  }
  const baseRank=new Map(base.map((h,i)=>[String(h?.horse_no),i]));
  const n=Math.max(1,base.length-1);
  const rows=base.map(h=>{
    const ev=tkpV55ExpertEvidence(r,h,base);
    const rank=tkpV55Num(baseRank.get(String(h?.horse_no)),base.length);
    const basePct=100*(1-rank/n);
    const combined=ev.score*0.82+basePct*0.18;
    try{h.v55_expert_score=Math.round(combined*10)/10;h.v55_expert_evidence=ev;}catch(_){ }
    return {h,ev,combined};
  }).sort((a,b)=>b.combined-a.combined||b.ev.sourceCount-a.ev.sourceCount||(baseRank.get(String(a.h?.horse_no))??999)-(baseRank.get(String(b.h?.horse_no))??999));
  let ordered=rows.map(z=>z.h);
  // Champion's two strongest horses remain inside the first four; the rest is genuinely consensus-driven.
  for(const core of base.slice(0,2)){
    const at=ordered.findIndex(h=>tkpV55SameHorse(h?.horse_no,core?.horse_no));
    if(at>3){ordered.splice(at,1);ordered.splice(Math.min(3,ordered.length),0,core);}
  }
  // Çoğunluğun desteklediği BMB/ODB/TR adayı, azınlığın yazmaması yüzünden
  // uzman kuponunun geniş ilk aday bandından düşmez (12/22 > 10/22 gibi).
  for(const row of rows.filter(z=>z.ev.majorityValue)){
    const at=ordered.findIndex(h=>tkpV55SameHorse(h?.horse_no,row.h?.horse_no));
    if(at>4){ordered.splice(at,1);ordered.splice(Math.min(4,ordered.length),0,row.h);}
  }
  try{if(typeof dedupeEkuri==='function')ordered=dedupeEkuri(ordered,r,'surprise',true);}catch(_){ }
  if(cacheTarget)_tkpV55ExpertOrderCache.set(cacheTarget,{signature,value:ordered.slice()});
  return ordered;
}

function tkpV55ExpertSingleMap(chosen){
  const candidates=[];
  for(let i=0;i<(chosen||[]).length;i++){
    const x=chosen[i],ordered=tkpV55ExpertOrderForRace(x?.r,(x?.scored&&x.scored.length)?x.scored:(x?.r?.horses||[]));
    const h=ordered[0];if(!h)continue;
    let confidence=0,threshold=70;try{const second=ordered[1]||null,d=typeof dynamicSingleDecision==='function'?dynamicSingleDecision(x,h,second):null;confidence=tkpV55Num(d?.confidence);threshold=tkpV55Num(d?.threshold,70);}catch(_){ }
    const ev=tkpV55ExpertEvidence(x.r,h,ordered);
    let difficulty=0;try{difficulty=typeof raceDifficultyIndex==='function'?tkpV55Num(raceDifficultyIndex(x)):0;}catch(_){ }
    // A legacy raw-X veto is never a Kulis rule.  Any permitted Expert/Kulis
    // TEK is decided below from the approved governance consensus only.
    const allowed=(()=>{try{return typeof canBeCouponSingle!=='function'||canBeCouponSingle(h);}catch(_){return true;}})();
    const rankScore=ev.score+confidence*.28-difficulty*.20;
    candidates.push({i,x,h,ev,confidence,threshold,difficulty,allowed,rankScore});
  }
  candidates.sort((a,b)=>b.rankScore-a.rankScore||b.ev.sourceCount-a.ev.sourceCount||b.ev.score-a.ev.score);
  const map=new Map();
  // TEK için iki ayrı güvenli yol vardır: (1) performans yönetişiminden geçmiş,
  // elle onaylı dar yorum; (2) SHA kilitli yarış-öncesi hazır kuponlarda aynı atı
  // tek yazan en az iki bağımsız site. Aynı sitenin tekrar kart/yazarları yetmez.
  const expertTekOk=z=>(z.ev.readyCouponSingleEligible===true&&z.ev.readyCouponTekSites>=2)
    ||(z.ev.commentatorSingleEligible===true&&z.ev.expertTotal>=1&&z.ev.expertSupportPct>=50&&z.ev.expertPower>=50);
  const first=candidates.find(z=>z.allowed&&z.ev.score>=54&&z.confidence>=48&&expertTekOk(z));
  if(first)map.set(first.i,first.h);
  const second=candidates.find(z=>z!==first&&z.allowed&&z.ev.score>=68&&z.confidence>=60&&z.ev.sourceCount>=3&&z.difficulty<78&&expertTekOk(z));
  if(first&&second&&second.rankScore>=first.rankScore-12)map.set(second.i,second.h);
  return map;
}


function tkpV55ExpertPartsHTML(ev){
  return (ev?.parts||[]).map(p=>`<span title="Ağırlık %${p.weight}">${tkpV55Html(p.label)} <b>${Math.round(tkpV55Num(p.value))}</b></span>`).join(' · ');
}
function tkpV55ExpertCouponEvidenceHTML(res){
  if(!res||res.error||String(res.typeKey||'')!=='surprise'||!Array.isArray(res.legs))return '';
  const rows=res.legs.slice().sort((a,b)=>tkpV55Num(a?.r?.leg??a?.x?.r?.leg)-tkpV55Num(b?.r?.leg??b?.x?.r?.leg)).map((leg,index)=>{
    const r=leg?.r||leg?.x?.r||{};
    const base=(leg?.allHorses?.length?leg.allHorses:(r?.horses||[])).filter(Boolean);
    const ordered=tkpV55ExpertOrderForRace(r,base);
    const selected=(leg?.picks||[]).map(h=>String(h?.horse_no??h));
    const candidates=ordered.slice(0,3).map((h,i)=>{
      const ev=tkpV55ExpertEvidence(r,h,base);
      const chosen=selected.some(no=>tkpV55SameHorse(no,h?.horse_no));
      const governedVote=ev.expertTotal?` · ${ev.expertPositive}/${ev.expertTotal} uzman (%${Math.round(ev.expertSupportPct)}) · Güç ${Math.round(ev.expertPower)}${ev.expertSingles?` · ${ev.expertSingles} TEK`:''} · ${ev.expertOmissions} yazmadı`:'';
      const readyVote=ev.readyCouponTekSites?` · Hazır kupon TEK ${ev.readyCouponTekSites} site${ev.readyCouponSingleEligible?' (mutabakat)':''}`:'';
      const vote=governedVote+readyVote;
      return `<div class="v55ExpertCandidate ${chosen?'selected':''}"><b>${i+1}. ${tkpV55Html(h?.horse_no)} ${tkpV55Html(h?.horse_name)}</b><em>Uzman ${ev.score} · ${ev.sourceCount} kaynak${vote}${chosen?' · KUPONDA':''}</em><small>${tkpV55ExpertPartsHTML(ev)||'Yalnız Champion kanıtı'}</small></div>`;
    }).join('');
    return `<tr><td>${tkpV55Num(r?.leg,index+1)}. AYAK</td><td>${candidates||'<span class="muted">Aday yok</span>'}</td></tr>`;
  }).join('');
  return `<details class="v55ExpertEvidence"><summary>🧠 Uzman + Kulis kanıt birleşimi</summary><p>Champion, hazır-kupon temelli Y.PUAN, AGF, profil ve BMB/ODB/TR yarış öncesi verileri kullanılır. Kulis katkısı yalnız kimliği belli, yarış öncesi kilitli, en az 150 canlı sonuçla ölçülmüş ve elle onaylanmış kaynaklardan sınırlı olarak gelir. Hazır-kupon TEK'i ise yalnız Collector SHA kilitli yarış-öncesi kartlarda en az iki bağımsız site aynı atı tek yazarsa kullanılabilir; manuel/eski/yarış sonrası kart TEK oluşturamaz. Sonuç ve ikramiye alanları karar kaynağı değildir.</p><div class="tableWrap"><table><thead><tr><th>Ayak</th><th>İlk 3 hibrit aday ve kaynakları</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

function tkpV55MeetingDifficulty(raceResults){
  const values=(raceResults||[]).map(x=>{try{return typeof raceDifficultyIndex==='function'?tkpV55Clamp(raceDifficultyIndex(x),0,100):50;}catch(_){return 50;}});
  const avg=values.length?values.reduce((s,v)=>s+v,0)/values.length:50;
  return {avg,hard:values.filter(v=>v>=62).length,veryHard:values.filter(v=>v>=82).length,values};
}
function tkpV55VisibleHorseScore(race,horse){
  let value=null;
  try{if(typeof tkpRaceVisibleDisplayScore==='function')value=Number(tkpRaceVisibleDisplayScore(race,horse));}catch(_){ }
  if(!Number.isFinite(value)){
    for(const key of ['tkp_display_score','prediction_tkp_display_score_snapshot','prediction_visible_tkp_snapshot','visible_tkp','score']){
      const n=Number(horse?.[key]);if(Number.isFinite(n)){value=n;break;}
    }
  }
  return Number.isFinite(value)?value:0;
}
function tkpV55StrongHorseMeetingSummary(raceResults){
  // "Güçlü" etiketi tek başına favori/AGF-1 değildir. Yalnız görünür TKP'de
  // belirgin ayrışma veya TKP + AGF ortak ayrışması bütçeyi 1.000 TL'ye indirir.
  let strongLegs=0;
  for(const x of raceResults||[]){
    const race=x?.r||x||{};
    const rows=(x?.scored?.length?x.scored:(race?.horses||[])).filter(h=>h&&!h.non_runner&&!h.scratched);
    if(rows.length<2)continue;
    const ordered=rows.slice().sort((a,b)=>tkpV55VisibleHorseScore(race,b)-tkpV55VisibleHorseScore(race,a));
    const leader=ordered[0],second=ordered[1];
    const leaderScore=tkpV55VisibleHorseScore(race,leader),gap=leaderScore-tkpV55VisibleHorseScore(race,second);
    const agf=rows.slice().sort((a,b)=>Number(b?.agf||0)-Number(a?.agf||0));
    const agfLeader=agf[0],agfGap=Number(agfLeader?.agf||0)-Number(agf[1]?.agf||0);
    const tkpAnchor=leaderScore>=2.80&&gap>=0.35;
    const consensusAnchor=leaderScore>=2.40&&gap>=0.20&&String(leader?.horse_no??'')===String(agfLeader?.horse_no??'')&&Number(agfLeader?.agf||0)>=30&&agfGap>=10;
    if(tkpAnchor||consensusAnchor)strongLegs++;
  }
  return {strongLegs,hasStrongHorse:strongLegs>0};
}
function tkpV55BudgetTarget(raceResults,userCap,type='main',singleCount=1){
  const max=tkpV55Clamp(userCap||1400,1000,1400);
  const d=tkpV55MeetingDifficulty(raceResults);
  let raw;
  if(type==='main2'||singleCount>=2) raw=700+d.avg*1.75+d.hard*24+d.veryHard*34;
  else if(type==='alt'){
    // Gerçek Sürpriz: Uzman/Kulis kopyası değil; zorluk + value/ters piyasa için
    // biraz daha geniş alan açar ama yorumcu uyuşmazlığına göre bütçe şişirmez.
    raw=700+d.avg*2.58+d.hard*39+d.veryHard*53;
  }
  else if(type==='surprise'){
    // Uzman + Kulis: yorumcu/kulis iki lideri birbirine yakınsa daha fazla senaryo ister.
    const disagreement=(raceResults||[]).reduce((sum,x)=>{
      const order=tkpV55ExpertOrderForRace(x?.r,(x?.scored&&x.scored.length)?x.scored:(x?.r?.horses||[]));
      if(order.length<2)return sum+35;
      const a=tkpV55ExpertEvidence(x.r,order[0],order).score,b=tkpV55ExpertEvidence(x.r,order[1],order).score;
      return sum+Math.max(0,30-(a-b));
    },0)/Math.max(1,(raceResults||[]).length);
    raw=700+d.avg*2.65+d.hard*42+d.veryHard*55+disagreement*1.1;
  }else raw=700+d.avg*2.45+d.hard*34+d.veryHard*48;
  const rounded=Math.round(raw/25)*25;
  const difficultyTarget=Math.min(max,Math.max(1000,rounded));
  const strong=tkpV55StrongHorseMeetingSummary(raceResults);
  // Bir güçlü ayak, zor toplantıyı 1.000 TL'ye kilitleyemez. Eski davranışta
  // beş kaotik ayak + bir net favori, net favori yüzünden bütün kuponu 1.000
  // TL'ye indiriyordu. Güçlü ayak yalnız sınırlı bir indirimdir; ana otorite
  // toplantının ortalama/sert zorluk dağılımıdır.
  let anchorDiscount=0;
  if(strong.hasStrongHorse){
    anchorDiscount=Math.min(125,Number(strong.strongLegs||0)*25+(d.avg<62?75:(d.avg<75?25:0)));
  }
  return Math.min(max,Math.max(1000,Math.round((difficultyTarget-anchorDiscount)/25)*25));
}


function tkpV55CurrentMeetingContext(){
  const raw=(typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)&&lastRaceResults.length)?(lastRaceResults[0]||{}):{};
  const first=raw?.r||raw;
  const date=String(first?.race_date||first?.date||'').trim();
  let hippodrome=String(first?.hippodrome||'').trim();
  try{if(typeof couponCanonicalTrackName==='function')hippodrome=couponCanonicalTrackName(hippodrome);}catch(_){ }
  const altiliNo=Math.max(1,tkpV55Num(first?.altili_no,1));
  return {date,hippodrome,altiliNo,key:[date,hippodrome,altiliNo].join('|')};
}
function tkpV55TinyHash(value){
  let h=2166136261>>>0;const text=JSON.stringify(value??null);
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return (h>>>0).toString(36);
}
let _tkpV55PersistTimer=null;
function tkpV55ScheduleSave(){
  if(_tkpV55PersistTimer)return;
  _tkpV55PersistTimer=setTimeout(async()=>{
    _tkpV55PersistTimer=null;
    try{
      if(typeof tkpPersistCollections==='function')await tkpPersistCollections(['v55_diagnostic_log'],{label:'v55-diagnostic'});
      else if(typeof saveDB==='function')await saveDB(false);
    }catch(_){ }
  },250);
}
function tkpV55PersistDiagnostic(record){
  try{
    if(typeof db!=='object'||!db||!record)return false;
    if(!Array.isArray(db.v55_diagnostic_log))db.v55_diagnostic_log=[];
    const ctx=tkpV55CurrentMeetingContext();
    const normalized={
      ...record,algorithm_version:TKP_V55_ALGORITHM_VERSION,
      race_date:String(record.race_date||ctx.date||''),hippodrome:String(record.hippodrome||ctx.hippodrome||''),
      altili_no:tkpV55Num(record.altili_no,ctx.altiliNo),updated_at:new Date().toISOString()
    };
    normalized.key=String(record.key||[normalized.race_date,normalized.hippodrome,normalized.altili_no,normalized.kind||'',normalized.product||''].join('|'));
    normalized.signature=tkpV55TinyHash({...normalized,updated_at:undefined,signature:undefined});
    const at=db.v55_diagnostic_log.findIndex(x=>String(x?.key||'')===normalized.key&&String(x?.algorithm_version||'')===TKP_V55_ALGORITHM_VERSION);
    if(at>=0&&String(db.v55_diagnostic_log[at]?.signature||'')===normalized.signature)return false;
    if(at>=0)db.v55_diagnostic_log[at]=normalized;else db.v55_diagnostic_log.push(normalized);
    // Tanı kanıtını koru; eski kayıtlar son-N sınırıyla silinmez.
    tkpV55ScheduleSave();
    return true;
  }catch(_){return false;}
}
function tkpV55MinimalOrderedAdds(order,picks,winner){
  const selected=new Set((picks||[]).map(h=>String(h?.horse_no??h)));
  let additions=0,rank=0;
  for(const h of order||[]){
    rank++;
    if(tkpV55SameHorse(h?.horse_no,winner?.horse_no))return {found:true,rank,additions:selected.has(String(h?.horse_no))?0:additions+1};
    if(![...selected].some(no=>tkpV55SameHorse(no,h?.horse_no)))additions++;
  }
  return {found:false,rank:0,additions:null};
}

function tkpV55Winner(r){return (r?.horses||[]).find(h=>tkpV55Num(h?.winner)===1||tkpV55Num(h?.finish_position)===1)||null;}
function tkpV55HasResult(r){return !!tkpV55Winner(r);}
function tkpV55LegResultInfo(r,h){
  if(!tkpV55HasResult(r))return {known:false,finish:0,cls:'waiting',label:''};
  const actual=(r?.horses||[]).find(x=>tkpV55SameHorse(x?.horse_no,h?.horse_no))||h;
  const finish=tkpV55Num(actual?.finish_position,tkpV55Num(actual?.winner)===1?1:0);
  if(finish===1)return {known:true,finish:1,cls:'hit',label:'KAZANDI'};
  // İlk Bakış bütün arşivde aynı resmi TJK İlk-5 dilini kullanır: 2-5 arasındaysa
  // kesin derece, resmi ilk beşte yoksa veri derinliğinden bağımsız "İLK 5 DIŞI".
  if(finish>1&&finish<=4)return {known:true,finish,cls:'miss',label:`${finish}. OLDU`};
  if(finish===5)return {known:true,finish,cls:'miss-out',label:'5. OLDU'};
  return {known:true,finish,cls:'miss-out',label:'İLK 5 DIŞI'};
}
function tkpV55LegResultBadge(r,h){
  const info=tkpV55LegResultInfo(r,h);
  if(!info.known)return '';
  return `<span class="v55FirstLookResult ${info.cls}">${tkpV55Html(info.label)}</span>`;
}

function tkpV55CouponDiagnosisData(res){
  if(!res||res.error||!Array.isArray(res.legs))return {ready:false,legs:[]};
  const legs=[],misses=[];let complete=0,hit=0,rescueFactor=1,orderedRescuePossible=true;
  for(const leg of res.legs.slice().sort((a,b)=>tkpV55Num(a?.r?.leg)-tkpV55Num(b?.r?.leg))){
    const r=leg?.r||leg?.x?.r||{},winner=tkpV55Winner(r),picks=(leg?.picks||[]).filter(Boolean);
    if(!winner){legs.push({leg:tkpV55Num(r?.leg),status:'BEKLİYOR'});continue;}
    complete++;
    const covered=picks.some(p=>tkpV55SameHorse(p?.horse_no,winner?.horse_no));
    if(covered){hit++;legs.push({leg:tkpV55Num(r?.leg),status:'TUTTU',winner,count:picks.length});continue;}
    const order=(leg?.displayOrder&&leg.displayOrder.length?leg.displayOrder:leg?.ordered&&leg.ordered.length?leg.ordered:leg?.allHorses||r?.horses||[]).filter(Boolean);
    const rescue=tkpV55MinimalOrderedAdds(order,picks,winner);
    const winnerRank=rescue.rank;
    const isSingle=picks.length===1;
    const strong=[];
    if(tkpV55Num(winner?.bmb)===1)strong.push('BMB');
    try{if(typeof isOdbCandidate==='function'&&isOdbCandidate(winner,r))strong.push('ODB');}catch(_){ }
    if(tkpV55Num(winner?.ypuan)>8)strong.push('Y.PUAN');
    try{if(typeof tkpCommentatorConsensus==='function'&&tkpCommentatorConsensus(r,winner)?.available)strong.push('Onaylı Kulis');}catch(_){ }
    if(tkpV55Num(winner?.hndkp_rank)>0&&tkpV55Num(winner?.hndkp_rank)<=2)strong.push('HND ilk 2');
    let code,reason;
    if(isSingle&&rescue.additions===1){code='WRONG_SINGLE_NEAREST';reason='TEK yattı; canonical sıradaki ilk rakip kazandı';}
    else if(isSingle){code='WRONG_SINGLE_DEEP';reason=`TEK yattı; kazanan canonical sırada ${winnerRank||'havuz dışı'}`;}
    else if(rescue.additions===1){code='FIRST_BUDGET_CUT';reason='Kazanan bütçe kesiminde ilk dışarıda kalan adaydı';}
    else if(winnerRank>0&&winnerRank<=5){code='CORE_COVERAGE';reason=`Kazanan ilk 5 içindeydi fakat kapsam ${picks.length} atta kesildi`;}
    else if(strong.length){code='SIGNAL_MISSED';reason=`Kazananın ${strong.join('+')} sinyali vardı fakat korunmadı`;}
    else{code='MODEL_RANK';reason=`Kazanan modelde düşük sıradaydı${winnerRank?` (${winnerRank}.)`:''}`;}
    const oldCount=Math.max(1,picks.length),neededAdds=Number.isFinite(rescue.additions)?Math.max(1,rescue.additions):null;
    if(neededAdds==null){orderedRescuePossible=false;rescueFactor=Infinity;}
    else rescueFactor*=((oldCount+neededAdds)/oldCount);
    const row={leg:tkpV55Num(r?.leg),status:'TUTMADI',winner,count:oldCount,isSingle,winnerRank,strong,code,reason,
      neededAdds,preRaceRescuable:neededAdds!=null&&neededAdds<=2,factor:neededAdds==null?null:(oldCount+neededAdds)/oldCount};
    if(!row.preRaceRescuable)orderedRescuePossible=false;
    legs.push(row);misses.push(row);
  }
  const rescueCost=Number.isFinite(rescueFactor)?tkpV55RoundMoney(tkpV55Num(res.cost)*rescueFactor):null;
  const maxBudget=tkpV55Num(res.maxBudgetTL||res.userCapTL||res.inputCapTL||res.budgetTL);
  const fullResolved=complete===res.legs.length;
  const rescuable=fullResolved&&misses.length>0&&orderedRescuePossible&&rescueCost!=null&&(!maxBudget||rescueCost<=maxBudget+1e-9);
  const out={ready:complete>0,complete,hit,misses,legs,rescueCost,maxBudget,rescuable,orderedRescuePossible,
    extraCost:rescueCost==null?null:tkpV55RoundMoney(rescueCost-tkpV55Num(res.cost)),fullHit:fullResolved&&hit===complete,fullResolved};
  if(fullResolved&&!res.suppressDiagnosticPersist){
    tkpV55PersistDiagnostic({kind:'coupon',product:String(res.typeKey||'coupon'),status:out.fullHit?'TUTTU':'KAÇTI',
      cost:tkpV55Num(res.cost),rescue_cost:rescueCost,extra_cost:out.extraCost,max_budget:maxBudget,rescuable,
      hit_legs:hit,total_legs:res.legs.length,miss_count:misses.length,
      causes:misses.map(m=>m.code),needed_adds:misses.map(m=>m.neededAdds),winner_ranks:misses.map(m=>m.winnerRank||null),
      single_misses:misses.filter(m=>m.isSingle).length,coverage_misses:misses.filter(m=>!m.isSingle).length});
  }
  return out;
}
function tkpV55CouponDiagnosisHTML(res){
  const d=tkpV55CouponDiagnosisData(res);if(!d.ready)return '<div class="v55Diagnosis waiting"><b>Canlı teşhis:</b> Sonuç geldikten sonra neden kaçtı / kurtarılabilir miydi hesabı açılır.</div>';
  const rows=d.legs.map(z=>{
    if(z.status==='BEKLİYOR')return `<tr><td>${z.leg}. AYAK</td><td>BEKLİYOR</td><td>-</td><td>-</td></tr>`;
    if(z.status==='TUTTU')return `<tr class="hit"><td>${z.leg}. AYAK</td><td>TUTTU</td><td>${tkpV55Html(z.winner?.horse_no)} ${tkpV55Html(z.winner?.horse_name)}</td><td>Kapsam doğru</td></tr>`;
    const rescue=z.neededAdds==null?'Canonical havuz dışında; +1/+2 ile kurtarılamaz':z.neededAdds<=2
      ? `${z.isSingle?'TEK aç':'Kapsam genişlet'} · pre-race sıradan +${z.neededAdds}`
      : `Pre-race sıradan +${z.neededAdds} gerekir; pratik kurtarma zayıf`;
    return `<tr class="miss"><td>${z.leg}. AYAK</td><td>${z.isSingle?'TEK KAÇTI':'KAPSAM KAÇTI'}</td><td>${tkpV55Html(z.winner?.horse_no)} ${tkpV55Html(z.winner?.horse_name)}${z.winnerRank?` · sıra ${z.winnerRank}`:''}</td><td><b>${tkpV55Html(z.reason)}</b><br><span>${tkpV55Html(rescue)}</span></td></tr>`;
  }).join('');
  let meeting;
  if(d.fullHit)meeting='<b class="ok">Kupon tuttu; kurtarma gerekmiyor.</b>';
  else if(!d.fullResolved)meeting=`<b>Canlı:</b> ${d.complete}/${res.legs.length} ayak sonuçlandı.`;
  else if(d.rescuable)meeting=`<b class="ok">PRE-RACE SIRADAN KURTARILABİLİRDİ</b> · yaklaşık ${typeof fmt2==='function'?fmt2(d.rescueCost):d.rescueCost} TL · ek maliyet ${typeof fmt2==='function'?fmt2(d.extraCost):d.extraCost} TL / üst sınır ${typeof fmt2==='function'?fmt2(d.maxBudget):d.maxBudget} TL`;
  else if(!d.orderedRescuePossible)meeting='<b class="bad">+1/+2 canonical genişletmeyle kurtarılamazdı.</b> Model sırası veya TEK kuralı düzeltilmeli.';
  else meeting=`<b class="bad">Kurtarma kullanıcı üst sınırına sığmıyordu.</b> · yaklaşık ${typeof fmt2==='function'?fmt2(d.rescueCost):d.rescueCost} TL${d.maxBudget?` / üst sınır ${typeof fmt2==='function'?fmt2(d.maxBudget):d.maxBudget} TL`:''}`;
  return `<details class="v55Diagnosis" open><summary>🔎 Neden kaçtı / kurtarılabilir miydi?</summary><div class="v55DiagnosisMeeting">${meeting}</div><div class="tableWrap"><table><thead><tr><th>Ayak</th><th>Hata</th><th>Kazanan</th><th>Neden / pre-race kurtarma</th></tr></thead><tbody>${rows}</tbody></table></div><p>“Kurtarılabilirdi” yalnız yarış öncesindeki canonical sıradan +1/+2 aday ekleme simülasyonudur; kazananı sonradan elle ekleyip sahte başarı yazılmaz.</p></details>`;
}

function tkpV55MeetingRows(){
  const database=(typeof db==='object'&&db)?db:null;
  const snapshots=database&&Array.isArray(database.auto_coupon_log)?database.auto_coupon_log:[];
  const exact=snapshots.filter(s=>String(s?.algorithm_version||'')===TKP_V55_ALGORITHM_VERSION);
  const byMeeting=new Map();
  for(const s of exact){
    const key=[s.race_date,s.hippodrome,tkpV55Num(s.altili_no,1)].join('|');
    const prev=byMeeting.get(key);if(!prev||String(s.created_at||'')>String(prev.created_at||''))byMeeting.set(key,s);
  }
  const rows=[...byMeeting.values()].map(snapshot=>{
    const races=((database&&Array.isArray(database.races))?database.races:[]).filter(r=>String(r?.race_date||'')===String(snapshot.race_date||'')&&
      String((typeof couponCanonicalTrackName==='function'?couponCanonicalTrackName(r?.hippodrome):r?.hippodrome)||'')===String(snapshot.hippodrome||'')&&
      (tkpV55Num(r?.altili_no,1)===tkpV55Num(snapshot?.altili_no,1)));
    const raceByLeg=new Map(races.map(r=>[tkpV55Num(r?.leg),r]));
    const evaluated={};
    for(const [type,c] of Object.entries(snapshot.coupons||{})){
      if(!Array.isArray(c?.legs))continue;let known=0,hits=0,missCodes=[];
      for(const l of c.legs){const r=raceByLeg.get(tkpV55Num(l?.leg)),w=tkpV55Winner(r);if(!w)continue;known++;if((l?.picks||[]).some(no=>tkpV55SameHorse(no,w.horse_no)))hits++;else missCodes.push((l?.picks||[]).length===1?'WRONG_SINGLE':'COVERAGE');}
      evaluated[type]={known,hits,full:known===c.legs.length&&hits===known,missCodes,cost:tkpV55Num(c.cost),source:'LIVE_SNAPSHOT'};
    }
    return {snapshot,evaluated,date:String(snapshot.race_date||''),source:'LIVE_SNAPSHOT'};
  }).filter(x=>Object.values(x.evaluated).some(e=>e.known>0));

  const permanent=(typeof globalThis!=='undefined'?globalThis.TKP_REAL509_ARCHIVE:null);
  const hasPermanentArchive=Array.isArray(permanent?.meetings)&&permanent.meetings.length>0;
  // Eski arşivde aynı V55 sürüm etiketi bulunmasa da yarış-öncesi frozen sıra/skor
  // ve resmi sonuç vardır. Hızlı Back Test motorunun doğrulanmış replay kayıtlarını
  // yalnız kalıcı referans arşiv yoksa bu tarihsel pencereye ekle. REAL509/V46 ile
  // güncel V55 replay'i aynı toplama katmak aynı toplantıyı iki kez sayabilir.
  const replay=(typeof globalThis!=='undefined'?globalThis.__tkpLastFastBacktestResult:null);
  if(!hasPermanentArchive&&replay?.verifiedOnly&&replay?.predictionUsage?.fallback===0){
    const replayMeetings=new Map();
    for(const type of ['main','alt','surprise']){
      for(const record of (replay?.out?.[type]?.records||[])){
        if(Number(record?.known)!==6)continue;
        const key=[String(record?.date||''),String(record?.hip||''),tkpV55Num(record?.altili,1)].join('|');
        let row=replayMeetings.get(key);
        if(!row){row={date:String(record?.date||''),source:'ARCHIVE_REPLAY',snapshot:null,evaluated:{},hippodrome:String(record?.hip||''),altili_no:tkpV55Num(record?.altili,1)};replayMeetings.set(key,row);}
        const details=Array.isArray(record?.legDetail)?record.legDetail:[];
        const missCodes=details.filter(item=>!item?.hit).map(item=>(Array.isArray(item?.picks)&&item.picks.length===1)?'WRONG_SINGLE':'COVERAGE');
        row.evaluated[type]={known:6,hits:tkpV55Num(record?.hits),full:Boolean(record?.hit),missCodes,cost:tkpV55Num(record?.cost),source:'ARCHIVE_REPLAY'};
      }
    }
    const liveKeys=new Set(rows.map(row=>[row.date,String(row?.snapshot?.hippodrome||''),tkpV55Num(row?.snapshot?.altili_no,1)].join('|')));
    for(const row of replayMeetings.values()){
      const key=[row.date,row.hippodrome,row.altili_no].join('|');
      if(!liveKeys.has(key))rows.push(row);
    }
  }
  // V1.1.329 ROCKET: 509 arşiv için daha önce tamamlanmış, denetlenmiş V46
  // kronolojik analizi paket içinde kalıcıdır. Ctrl+F5 sonrası RAM replay cache'i
  // boş olsa bile 387 toplantı anında görünür; canlı/current replay hazır olunca
  // aynı tarih-pist kaydı tekrar eklenmez. Bu tablo sonuçtan yeniden tahmin üretmez.
  const seen=new Set(rows.map(row=>[String(row?.date||''),String(row?.snapshot?.hippodrome||row?.hippodrome||''),tkpV55Num(row?.snapshot?.altili_no??row?.altili_no,1)].join('|')));
  if(Array.isArray(permanent?.meetings)){
    const unpack=value=>{
      const full=Number(value?.[0])===1,cost=tkpV55Num(value?.[1]),missCodes=Array.isArray(value?.[2])?value[2].slice():[];
      return {known:6,hits:full?6:Math.max(0,6-missCodes.length),full,missCodes,cost,source:'REAL509_V46_ARCHIVE'};
    };
    for(const raw of permanent.meetings){
      if(!Array.isArray(raw)||raw.length<6)continue;
      const date=String(raw[1]||''),hippodrome=String(raw[2]||''),key=[date,hippodrome,1].join('|');
      if(seen.has(key))continue;
      rows.push({date,hippodrome,altili_no:1,source:'REAL509_V46_ARCHIVE',snapshot:null,evaluated:{main:unpack(raw[3]),alt:unpack(raw[4]),surprise:unpack(raw[5])}});
      seen.add(key);
    }
  }
  return rows.filter(x=>Object.values(x.evaluated).some(e=>e.known>0)).sort((a,b)=>a.date.localeCompare(b.date));
}
function tkpV55WindowMetric(type,rows){
  const e=rows.map(r=>r.evaluated[type]).filter(Boolean);const resolved=e.filter(x=>x.known>=6),hits=resolved.filter(x=>x.full).length;
  return {n:resolved.length,hits,rate:resolved.length?Math.round(100*hits/resolved.length):null,wrongSingles:resolved.reduce((s,x)=>s+x.missCodes.filter(c=>c==='WRONG_SINGLE').length,0),coverage:resolved.reduce((s,x)=>s+x.missCodes.filter(c=>c==='COVERAGE').length,0)};
}
function tkpV55PerformanceWindowsHTML(){
  const rows=tkpV55MeetingRows(),ctx=tkpV55CurrentMeetingContext(),calendarMonth=(ctx.date?String(ctx.date).slice(0,7):new Date().toISOString().slice(0,7));
  const calendarRows=rows.filter(r=>r.date.startsWith(calendarMonth));
  // Ayın ilk saatlerinde henüz canlı kayıt yoksa boş bir "Bu ay" sütunu üretme;
  // en son doğrulanmış arşiv ayını göster. İlk canlı kayıt geldiğinde otomatik
  // olarak gerçek takvim ayına döner.
  const latestMonth=rows.length?String(rows[rows.length-1].date||'').slice(0,7):calendarMonth;
  const shownMonth=calendarRows.length?calendarMonth:latestMonth;
  const monthLabel=calendarRows.length?'Bu ay':`Son arşiv ayı (${shownMonth})`;
  const windows=[['Son 10',rows.slice(-10)],['Son 28',rows.slice(-28)],[monthLabel,rows.filter(r=>r.date.startsWith(shownMonth))],['Tüm doğrulanmış',rows]];
  const types=[['main','Normal'],['alt','Sürpriz'],['surprise','Uzman + Kulis']];
  const liveCount=rows.filter(row=>row.source==='LIVE_SNAPSHOT').length,replayCount=rows.filter(row=>row.source==='ARCHIVE_REPLAY').length,permanentCount=rows.filter(row=>row.source==='REAL509_V46_ARCHIVE').length;
  const body=types.map(([type,label])=>`<tr><td><b>${label}</b></td>${windows.map(([,subset])=>{const m=tkpV55WindowMetric(type,subset);const pct=m.n>=TKP_V55_MIN_PERCENT_SAMPLE?` · %${m.rate}`:` · <span class="tkpSampleInsufficient">n=${m.n}/${TKP_V55_MIN_PERCENT_SAMPLE}</span>`;return `<td>${m.n?`<b>${m.hits}/${m.n}</b>${pct} <small>TEK hata ${m.wrongSingles} · kapsam ${m.coverage}</small>`:'<span class="muted">Kayıt yok</span>'}</td>`;}).join('')}</tr>`).join('');
  const sourceNote=`Kalıcı REAL509/V46 yarış-öncesi arşiv <b>${permanentCount}</b> toplantı · güncel frozen replay <b>${replayCount}</b> · gerçek V55 canlı snapshot <b>${liveCount}</b>. Kalıcı arşiv sonuçları ANALIZ dosyalarındaki denetlenmiş çıktıdır; bugünkü motor sonucu diye gösterilmez.`;
  return `<div class="card v55WindowCard"><h2>📊 Performans pencereleri · doğrulanmış arşiv dahil</h2><p>Ölçü birimi <b>6/6 Altılı toplantısıdır</b>. ${sourceNote}</p><div class="tableWrap"><table><thead><tr><th>Kupon</th>${windows.map(([n])=>`<th>${n}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function tkpV55CurrentReplaySummaryHTML(){
  const replay=(typeof globalThis!=='undefined'?globalThis.__tkpLastFastBacktestResult:null);
  if(!(replay?.verifiedOnly&&replay?.predictionUsage?.fallback===0)){
    return `<div class="card v55CurrentReplaySummary" style="border-left:5px solid #315b7d"><h2>🧪 Güncel algoritma · güvenli replay</h2><p class="muted">Bu kart tarihsel REAL509/V46 referansından ayrıdır. Güncel algoritmanın yarış-öncesi frozen snapshot replay'i Back Test açıldığında cooperative olarak hazırlanır; doğrulanmamış tahmin kullanılmaz.</p></div>`;
  }
  const eligibility=replay.eligibility||{},usage=replay.predictionUsage||{};
  const rows=[['main','Normal'],['alt','Sürpriz'],['surprise','Uzman + Kulis']].map(([key,label])=>{
    const item=replay?.out?.[key]||{};
    const total=tkpV55Num(item.meetings??item.total),full=tkpV55Num(item.full??item.ok);
    const pct=total?`%${(100*full/total).toFixed(2)}`:'—';
    return `<tr><td><b>${label}</b></td><td class="num">${full}/${total}</td><td class="num">${pct}</td></tr>`;
  }).join('');
  return `<div class="card v55CurrentReplaySummary" style="border-left:5px solid #315b7d"><h2>🧪 Güncel algoritma · güvenli replay</h2><p class="muted">Kalıcı V46 referansına eklenmez ve onunla çift sayılmaz. Replay uygun <b>${tkpV55Num(eligibility.replayEligible)}</b> / toplam <b>${tkpV55Num(eligibility.total)}</b> · eksik snapshot ${tkpV55Num(eligibility.missingSnapshot)} · eksik sonuç/6 ayak ${tkpV55Num(eligibility.missingResult)} · ağır eksik ${tkpV55Num(eligibility.heavyMissing)} · frozen ayak ${tkpV55Num(usage.current)+tkpV55Num(usage.archive)} · fallback <b>${tkpV55Num(usage.fallback)}</b>.</p><div class="tableWrap"><table><thead><tr><th>Kupon</th><th class="num">6/6</th><th class="num">Oran</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

let _tkpV55SideBetDiagnoses=[];
function tkpV55PoolNos(pool){return (pool||[]).map(x=>String(x?.horse_no??x)).filter(Boolean);}
function tkpV55SideBetLimit(title){
  const t=String(title||'').toLocaleUpperCase('tr-TR');
  if(t.includes('SIRALI 5')||t.includes("5'LI"))return 750;
  if(t.includes('DÖRTLÜ')||t.includes('TABELA'))return 750;
  if(t.includes('ÜÇLÜ'))return 450;
  if(t.includes('ÇİFTE'))return typeof DOUBLE_COST_LIMIT==='number'?DOUBLE_COST_LIMIT:120;
  if(t.includes('İKİLİ'))return 250;
  return 0;
}
function tkpV55RegisterSideRuntime(row){
  const key=[row.title,row.status,row.detail,row.cost,row.rescueCost].join('|');
  const at=_tkpV55SideBetDiagnoses.findIndex(x=>x._key===key);
  const next={...row,_key:key};if(at>=0)_tkpV55SideBetDiagnoses[at]=next;else _tkpV55SideBetDiagnoses.push(next);
  if(_tkpV55SideBetDiagnoses.length>120)_tkpV55SideBetDiagnoses=_tkpV55SideBetDiagnoses.slice(-120);
}
function tkpV55RankForHorse(rankMap,no,sameFn=tkpV55SameHorse){
  if(!rankMap||typeof rankMap.get!=='function')return null;
  if(rankMap.has(String(no)))return tkpV55Num(rankMap.get(String(no)),null);
  for(const [key,value] of rankMap.entries())if(sameFn(key,no))return tkpV55Num(value,null);
  return null;
}
function tkpV55RankEntries(rankMap){
  if(!rankMap||typeof rankMap.entries!=='function')return [];
  return [...rankMap.entries()].map(([no,rank])=>({no:String(no),rank:tkpV55Num(rank,999)})).filter(x=>x.no&&Number.isFinite(x.rank)).sort((a,b)=>a.rank-b.rank);
}
function tkpV55PositionRankMap(rankMap,index){
  return Array.isArray(rankMap)?(rankMap[index]||null):rankMap;
}
function tkpV55CanonicalWidenPool(pool,winner,rankMap,sameFn=tkpV55SameHorse){
  const original=(pool||[]).map(String),widened=original.slice(),added=[];
  if(original.some(no=>sameFn(no,winner?.horse_no)))return {found:true,rank:tkpV55RankForHorse(rankMap,winner?.horse_no,sameFn),additions:0,widened,added};
  const entries=tkpV55RankEntries(rankMap);if(!entries.length)return {found:false,rank:null,additions:null,widened,added};
  let winnerRank=null;
  for(const row of entries){
    if(!widened.some(no=>sameFn(no,row.no))){widened.push(row.no);added.push(row.no);}
    if(sameFn(row.no,winner?.horse_no)){winnerRank=row.rank;break;}
  }
  if(winnerRank==null)return {found:false,rank:null,additions:null,widened:original,added:[]};
  return {found:true,rank:winnerRank,additions:added.length,widened,added};
}
function tkpV55SideBetRescueHTML(title,pools,combos,cost,status,raceHorses,rankMap=null){
  try{
    const doubleRace=Array.isArray(raceHorses?.[0]);
    const sameFn=doubleRace?tkpV55SameHorse:tkpV55SameHorseExact;
    const normalized=(pools||[]).map(tkpV55PoolNos);
    const required=[];
    if(doubleRace){
      for(let i=0;i<normalized.length;i++){const w=tkpV55Winner({horses:raceHorses[i]||[]});if(!w)return '';required.push(w);}
    }else{
      const finished=(raceHorses||[]).filter(h=>tkpV55Num(h?.finish_position)>0).sort((a,b)=>tkpV55Num(a.finish_position)-tkpV55Num(b.finish_position));
      if(finished.length<normalized.length)return '';
      required.push(...finished.slice(0,normalized.length));
    }
    const missing=[];
    for(let i=0;i<required.length;i++)if(!normalized[i].some(no=>sameFn(no,required[i]?.horse_no)))missing.push({position:i+1,horse:required[i]});
    const limit=tkpV55SideBetLimit(title);
    if(!missing.length){
      const row={title,status:'TUTTU',missing:0,cost:tkpV55Num(cost),rescueCost:tkpV55Num(cost),limit,detail:'Resmî sıra havuzlarda'};
      tkpV55RegisterSideRuntime(row);tkpV55PersistDiagnostic({kind:'sidebet',product:title,status:'TUTTU',cost:row.cost,rescue_cost:row.rescueCost,max_budget:limit,missing_positions:0,rescuable:true});
      // Teşhis kaydı tutulur; uzun açıklama yan bahis kartına basılmaz. İleri Takip'in
      // en altındaki ayrı "Yan Bahis Kurtarma Takibi" kartında gösterilir.
      return '';
    }
    const widened=normalized.map(p=>p.slice()),details=[];let totalAdds=0,allFound=true;
    for(const m of missing){
      const map=tkpV55PositionRankMap(rankMap,m.position-1);
      const rescue=tkpV55CanonicalWidenPool(normalized[m.position-1],m.horse,map,sameFn);
      m.preRank=rescue.rank;m.neededAdds=rescue.additions;m.added=rescue.added;
      if(!rescue.found){allFound=false;details.push(`${m.position}. sıra: ${m.horse.horse_no} ${m.horse.horse_name||''} (yarış öncesi canonical sırada yok)`);continue;}
      widened[m.position-1]=rescue.widened;totalAdds+=rescue.additions;
      details.push(`${m.position}. sıra: ${m.horse.horse_no} ${m.horse.horse_name||''} · pre-race sıra ${rescue.rank} · +${rescue.additions}`);
    }
    const newCombos=allFound?(doubleRace?widened.reduce((n,p)=>n*Math.max(1,p.length),1):(typeof permCount==='function'?permCount(widened):widened.reduce((n,p)=>n*Math.max(1,p.length),1))):null;
    const unit=tkpV55Num(combos)>0?tkpV55Num(cost)/tkpV55Num(combos):0;
    const rescueCost=newCombos==null?null:tkpV55RoundMoney(newCombos*unit),extra=rescueCost==null?null:tkpV55RoundMoney(rescueCost-tkpV55Num(cost));
    const practical=allFound&&totalAdds>0&&totalAdds<=2;
    const fits=rescueCost!=null&&(!limit||rescueCost<=limit+1e-9);
    const rescuable=practical&&fits;
    const detail=details.join(' · ');
    const row={title,status:'KAÇTI',missing:missing.length,cost:tkpV55Num(cost),rescueCost,limit,rescuable,detail,totalAdds};
    tkpV55RegisterSideRuntime(row);tkpV55PersistDiagnostic({kind:'sidebet',product:title,status:'KAÇTI',cost:row.cost,rescue_cost:rescueCost,extra_cost:extra,max_budget:limit,missing_positions:missing.length,rescuable,needed_adds:missing.map(m=>m.neededAdds),winner_ranks:missing.map(m=>m.preRank),detail});
    let verdict;
    if(!allFound)verdict='<b>Yarış öncesi canonical sırada bulunmadığı için sonradan kazanan eklenerek kurtarılmış sayılmaz.</b>';
    else if(totalAdds>2)verdict=`<b>Canonical genişletme +${totalAdds} aday ister; pratik +1/+2 kurtarma sınırını aşar.</b>`;
    else if(!fits)verdict=`<b>Canonical +${totalAdds} genişletme tavanı aşardı.</b>`;
    else verdict=`<b class="ok">YARIŞ ÖNCESİ CANONICAL SIRADAN KURTARILABİLİRDİ</b> · +${totalAdds} aday`;
    const money=rescueCost==null?'':` · ${newCombos} kolon · yaklaşık ${typeof fmt2==='function'?fmt2(rescueCost):rescueCost} TL (+${typeof fmt2==='function'?fmt2(extra):extra} TL)${limit?` / tavan ${limit} TL`:''}`;
    return '';
  }catch(_){return '';}
}

// V1.1.208 TEMİZLİK: tkpV55MultiGanyanRescueHTML kaldırıldı — yalnız artık
// silinmiş tkpMultiGanyanCardHTML tarafından çağrılıyordu, başka kullanıcısı yoktu.
function tkpV55SideBetDiagnosticsHTML(){
  const rows=_tkpV55SideBetDiagnoses.slice(-80);if(!rows.length)return '<div class="card"><h2>🎯 Yan bahis teşhisi</h2><p class="muted">Yan bahis kartları oluşturulduğunda canlı neden/kurtarma kayıtları burada görünür.</p></div>';
  const body=rows.map(x=>`<tr><td>${tkpV55Html(x.title)}</td><td>${x.status}</td><td>${x.missing||0}</td><td>${typeof fmt2==='function'?fmt2(x.cost):x.cost} TL</td><td>${typeof fmt2==='function'?fmt2(x.rescueCost):x.rescueCost} TL</td><td>${x.rescuable===false?'HAYIR':'EVET'}</td><td>${tkpV55Html(x.detail||'Doğru kapsam')}</td></tr>`).join('');
  return `<div class="card v55SideBetDiagnosis"><h2>🎯 Yan bahis · neden kaçtı / kurtarma</h2><div class="tableWrap"><table><thead><tr><th>Bahis</th><th>Durum</th><th>Eksik poz.</th><th>Maliyet</th><th>Kurtarma</th><th>Tavana sığar</th><th>Neden</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
function tkpV55ProductLabel(value){
  const key=String(value||'');
  if(key==='main')return 'Normal · 1 TEK';
  if(key==='alt')return 'Sürpriz';
  if(key==='surprise')return 'Uzman + Kulis';
  return key||'Diğer';
}
function tkpV55AlgorithmParametersHTML(){
  const database=(typeof db==='object'&&db)?db:null;
  const logs=database&&Array.isArray(database.v55_diagnostic_log)?database.v55_diagnostic_log.filter(x=>String(x?.algorithm_version||'')===TKP_V55_ALGORITHM_VERSION):[];
  const snapshots=database&&Array.isArray(database.auto_coupon_log)?database.auto_coupon_log.filter(x=>String(x?.algorithm_version||'')===TKP_V55_ALGORITHM_VERSION):[];
  const archive=(typeof globalThis!=='undefined'?globalThis.TKP_REAL509_ARCHIVE:null),archiveSet=archive?.dataset||{};
  const current=(typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[]).map(x=>x?.r||x).filter(Boolean);
  const horses=current.flatMap(r=>r?.horses||[]);
  const yCount=horses.filter(h=>tkpV55Num(h?.ypuan)>0).length;
  const xCount=horses.filter(h=>{try{return typeof tkpCommentatorConsensus==='function'&&tkpCommentatorConsensus(current.find(r=>(r?.horses||[]).includes(h))||{},h)?.available;}catch(_){return false;}}).length;
  const signalCount=horses.filter(h=>tkpV55Num(h?.bmb)===1||tkpV55Num(h?.odb)===1||tkpV55Num(h?.tr_bmb_candidate)===1||tkpV55Num(h?.tr_hidden_fav)===1).length;
  return `<div class="card v55Parameters"><h2>⚙️ Canlı karar parametreleri ve veri kalitesi</h2><div class="tableWrap"><table><tbody>
    <tr><th>Sürüm</th><td>${TKP_V55_ALGORITHM_VERSION}</td><th>Sonuç sızıntısı</th><td><b class="ok">KAPALI</b> · sonuç yalnız teşhis katmanında</td></tr>
    <tr><th>TEK otoritesi</th><td>Canonical İlk Bakış · Normal 1 için ilk 3, Normal 2 için ilk 4 aday</td><th>Bütçe</th><td>Normal 700–1.200 · Sürpriz/Uzman 700–1.200 TL; tavan hedef değildir</td></tr>
    <tr><th>Uzman/Kulis ağırlıkları</th><td colspan="3">Champion %42 · Y.PUAN %23 · yalnız onaylı/kilitli Kulis en çok %10 · AGF %8 · Profil %7 · BMB/ODB/TR %5</td></tr>
    <tr><th>Bu toplantı veri kapsamı</th><td>${current.length||horses.length?`${current.length} ayak · ${horses.length} at`:`<span class="muted">Aktif toplantı seçilmedi</span>`}</td><th>Harici sinyal</th><td>${horses.length?`Y.PUAN ${yCount} at · Onaylı Kulis ${xCount} at · BMB/ODB/TR ${signalCount} at`:`<span class="muted">Aktif toplantı verisi bekleniyor</span>`}</td></tr>
    <tr><th>Doğrulanmış V55 snapshot</th><td>${snapshots.length}</td><th>V55 teşhis kaydı</th><td>${logs.length}</td></tr>
    <tr><th>Tarihsel arşiv referansı</th><td>${tkpV55Num(archiveSet.archive_meetings)} dosya/toplantı · ${tkpV55Num(archiveSet.archive_races)} koşu</td><th>Güvenli tam Altılı</th><td>${tkpV55Num(archiveSet.complete_v46_sixleg_meetings)} toplantı · ${tkpV55Num(archiveSet.usable_v46_races)} koşu</td></tr>
  </tbody></table></div></div>`;
}
function v55DashIfUnavailable(value,available){return available?(Number.isFinite(Number(value))?String(value):'—'):'—';}
function tkpV55HistoricalDiagnosticRows(){
  const rows=tkpV55MeetingRows().filter(row=>row?.source==='REAL509_V46_ARCHIVE');
  const products=[['main','Normal · tarihsel V46'],['alt','Sürpriz · tarihsel V46'],['surprise','Uzman + Kulis · tarihsel V46']];
  return products.map(([type,label])=>{
    const metric=tkpV55WindowMetric(type,rows),misses=Math.max(0,metric.n-metric.hits);
    return `<tr class="tkpHistoricalEvidenceRow"><td><b>${tkpV55Html(label)}</b><small>Doğrulanmış yarış-öncesi arşiv</small></td><td class="num">${metric.n}</td><td class="num">${metric.hits}</td><td class="num">${misses}</td><td class="num">${metric.wrongSingles}</td><td class="num">—</td><td class="num">${metric.coverage}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`;
  }).join('');
}
function tkpV55CanonicalLiveDiagnosticRows(){
  const database=(typeof db==='object'&&db)?db:null;
  const logs=(database&&Array.isArray(database.v55_diagnostic_log)?database.v55_diagnostic_log:[])
    .filter(x=>String(x?.algorithm_version||'')===TKP_V55_ALGORITHM_VERSION&&String(x?.kind||'')==='coupon');
  const meetings=tkpV55MeetingRows().filter(row=>row?.source==='LIVE_SNAPSHOT');
  const types=[['main','Normal'],['alt','Sürpriz'],['surprise','Uzman + Kulis']];
  return types.map(([type,label])=>{
    const evals=meetings.map(row=>row?.evaluated?.[type]).filter(e=>e&&tkpV55Num(e.known)>=6);
    const detail=logs.filter(x=>String(x?.product||'')===type);
    const canonical=evals.length>0;
    const tests=canonical?evals.length:detail.length;
    if(!tests)return '';
    const hits=canonical?evals.filter(e=>e.full===true).length:detail.filter(x=>String(x?.status||'')==='TUTTU').length;
    const misses=Math.max(0,tests-hits);
    const wrong=canonical?evals.reduce((n,e)=>n+(e.missCodes||[]).filter(c=>String(c).startsWith('WRONG_SINGLE')).length,0)
      :detail.reduce((n,x)=>n+(x.causes||[]).filter(c=>String(c).startsWith('WRONG_SINGLE')).length,0);
    const coverageCanonical=canonical?evals.reduce((n,e)=>n+(e.missCodes||[]).filter(c=>c==='COVERAGE').length,0):0;
    const detailedMisses=detail.filter(x=>String(x?.status||'')!=='TUTTU');
    const budget=detailedMisses.reduce((n,x)=>n+(x.causes||[]).filter(c=>c==='FIRST_BUDGET_CUT').length,0);
    const model=detailedMisses.reduce((n,x)=>n+(x.causes||[]).filter(c=>c==='MODEL_RANK'||c==='SIGNAL_MISSED').length,0);
    const coverage=canonical?coverageCanonical:detailedMisses.reduce((n,x)=>n+(x.causes||[]).filter(c=>c==='CORE_COVERAGE').length,0);
    const rescuable=detailedMisses.filter(x=>x.rescuable===true).length;
    const extra=detailedMisses.map(x=>tkpV55Num(x.extra_cost,NaN)).filter(Number.isFinite);
    const additions=detailedMisses.flatMap(x=>Array.isArray(x.needed_adds)?x.needed_adds:[x.needed_adds]).map(x=>tkpV55Num(x,NaN)).filter(Number.isFinite);
    const ranks=detailedMisses.flatMap(x=>Array.isArray(x.winner_ranks)?x.winner_ranks:[x.winner_ranks]).map(x=>tkpV55Num(x,NaN)).filter(Number.isFinite);
    const avg=v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
    return `<tr><td><b>${tkpV55Html(label)}</b><small>${canonical?'auto_coupon_log + resmî sonuç':'detaylı teşhis yedeği'}</small></td><td class="num">${tests}</td><td class="num">${hits}</td><td class="num">${misses}</td><td class="num">${wrong}</td><td class="num">${budget}</td><td class="num">${coverage+model}</td><td class="num">${detailedMisses.length?`${rescuable}/${detailedMisses.length}`:'—'}</td><td class="num">${additions.length?avg(additions).toFixed(1):'—'}</td><td class="num">${ranks.length?avg(ranks).toFixed(1):'—'}</td><td class="num">${extra.length?(typeof fmt2==='function'?fmt2(avg(extra)):avg(extra).toFixed(2))+' TL':'—'}</td></tr>`;
  }).join('');
}
function tkpV55PersistentDiagnosticsHTML(){
  const liveRows=tkpV55CanonicalLiveDiagnosticRows();
  const historicalRows=tkpV55HistoricalDiagnosticRows();
  if(!historicalRows&&!liveRows)return '<div class="card v55DiagnosticStats"><h2>📚 Birikimli çözüm istatistiği</h2><p class="muted">Doğrulanmış tarihsel veya canlı teşhis kaydı bulunamadı.</p></div>';
  return `<div class="card v55DiagnosticStats"><h2>📚 Birikimli çözüm istatistiği · tek kanonik kaynak</h2><p class="muted">Canlı Test/Tuttu/Kaçtı/TEK/Kapsam sayıları ayrı bir tabloya yeniden yazılmaz; <b>auto_coupon_log + resmî sonuç</b> üzerinden türetilir. v55_diagnostic_log yalnız +1/+2 kurtarma, neden ve ek maliyet gibi ayrıntıları zenginleştirir. Tarihsel V46 kanıtı ayrı şeritte tutulur ve canlı veriyle karıştırılmaz.</p><div class="tableWrap"><table><thead><tr><th>Ürün</th><th class="num">Test</th><th class="num">Tuttu</th><th class="num">Kaçtı</th><th class="num">TEK hata</th><th class="num">İlk bütçe kesimi</th><th class="num">Kapsam/model</th><th class="num">Kurtarılabilir</th><th class="num">Ort. +aday</th><th class="num">Ort. kazanan sıra</th><th class="num">Ort. ek maliyet</th></tr></thead><tbody>${historicalRows}${liveRows}</tbody></table></div></div>`;
}

function tkpV55Real509SideBetReferenceHTML(){
  const archive=(typeof globalThis!=='undefined'?globalThis.TKP_REAL509_ARCHIVE:null),summary=archive?.sidebetSummary;
  if(!summary||typeof summary!=='object')return '';
  const rows=Object.entries(summary).map(([name,item])=>{
    const all=item?.finalAll||{},holdout=item?.finalHoldout||{};
    const decision=name==="Sıralı 5'li"?'SHADOW ADAY':'PAS';
    const roi=value=>Number.isFinite(Number(value))?'%'+(Number(value)*100).toFixed(2):'—';
    return `<tr><td><b>${tkpV55Html(name)}</b></td><td class="num">${tkpV55Num(all.hits)}/${tkpV55Num(all.total)}</td><td class="num">${all.total?'%'+(tkpV55Num(all.rate)*100).toFixed(2):'—'}</td><td class="num">${roi(all.roi)}</td><td class="num">${tkpV55Num(holdout.hits)}/${tkpV55Num(holdout.total)}</td><td class="num">${roi(holdout.roi)}</td><td>${decision}</td></tr>`;
  }).join('');
  return `<div class="card v55Real509Reference" style="border-left:5px solid #0f766e"><h2>⚡ REAL509/V46 kalıcı yan bahis kalibrasyonu</h2><p class="muted">Bu tablo canlı V55 tanı kaydı değildir; 509 arşivdeki yarış-öncesi V46 olaylarından önceden tamamlanmış denetlenmiş analizdir. Panel açılışında yeniden hesaplanmaz.</p><div class="tableWrap"><table><thead><tr><th>Ürün</th><th class="num">Tüm isabet</th><th class="num">Tüm %</th><th class="num">Tüm ROI</th><th class="num">Holdout</th><th class="num">Holdout ROI</th><th>Karar</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function tkpV55DiagnosticsCenterHTML(){
  const coupons=(typeof activeCoupons==='object'&&activeCoupons)||{};
  const current=['main','alt','surprise'].map(k=>coupons[k]?`<div class="card"><h2>${tkpV55Html((typeof COUPON_CARD_TITLES==='object'&&COUPON_CARD_TITLES[k])||k)}</h2>${tkpV55CouponDiagnosisHTML(coupons[k])}</div>`:'').join('');
  // Yan bahis kurtarma tablosu bu merkezde/yan bahis görünümünün yakınında gösterilmez.
  // Kayıtlar yine v55_diagnostic_log + runtime log'a yazılır; İleri Takip'te ayrı,
  // hafif metin özeti olarak sunulur. Böylece yan bahis ekranı sade ve hızlı kalır.
  return `<div class="v55DiagnosticsCenter"><div class="card v55DiagnosticsIntro"><h2>🧪 V55 Kayıp ve Kurtarma Merkezi</h2><p>TEK hatası, bütçe kesimi, model sırası, güçlü sinyal dışlanması, +1/+2 aday maliyeti ve bütçe içinde kurtarılabilirlik ayrı kaydedilir. Sonuç verisi yalnız teşhiste kullanılır.</p></div>${tkpV55AlgorithmParametersHTML()}${tkpV55PerformanceWindowsHTML()}${tkpV55CurrentReplaySummaryHTML()}${tkpV55Real509SideBetReferenceHTML()}${tkpV55PersistentDiagnosticsHTML()}${current}</div>`;
}

async function tkpV55DiagnosticsCenterHTMLAsync(onProgress=null){
  // Kalıcı V46 referansının bulunması güncel algoritma replay'ini artık iptal etmez.
  // Ağır öğrenme görünümü zaten veri imzasıyla IndexedDB'de saklandığı için bu iş
  // aynı veri/sürümde bir kez çalışır; Ctrl+F5 veya menü geçişi yeniden hesaplatmaz.
  // Hesap cooperative'dir ve her toplantı diliminde event-loop'a döner.
  if(typeof globalThis.tkpFastBacktestCoreAsync==='function'){
    const main=typeof globalThis.tkpCouponBudgetFor==='function'?globalThis.tkpCouponBudgetFor(undefined,'main'):1200;
    const expert=typeof globalThis.tkpCouponBudgetFor==='function'?globalThis.tkpCouponBudgetFor(undefined,'expert'):1200;
    const progress=state=>{if(typeof onProgress==='function')try{onProgress(state?.processed||0,state?.total||0,state?.phase||'replay');}catch(_e){}};
    try{await globalThis.tkpFastBacktestCoreAsync({main,main2:main,alt:main,surprise:expert},509,'',progress);}catch(error){console.warn('V55 arşiv replay hazırlığı:',error);}
  }
  return tkpV55DiagnosticsCenterHTML();
}

function tkpV55SideBetTrackingTextHTML(){
  const database=(typeof db==='object'&&db)?db:null;
  const persisted=(database&&Array.isArray(database.v55_diagnostic_log)?database.v55_diagnostic_log:[])
    .filter(x=>String(x?.algorithm_version||'')===TKP_V55_ALGORITHM_VERSION && String(x?.kind||'')==='sidebet');
  const runtime=Array.isArray(_tkpV55SideBetDiagnoses)?_tkpV55SideBetDiagnoses:[];
  const all=persisted.length?persisted:runtime;
  const tkpLatestSideBetTrackingDate=rows=>{
    let latest='';
    for(const row of (Array.isArray(rows)?rows:[])){
      const date=String(row?.race_date||'').slice(0,10);
      if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>latest)latest=date;
    }
    return latest;
  };
  const displayDate=tkpLatestSideBetTrackingDate(all);
  const scoped=displayDate?all.filter(x=>String(x?.race_date||'').slice(0,10)===displayDate):all;
  const rows=scoped.slice(-8).reverse();
  if(!rows.length)return `<div id="tkpSideBetRescueDailyPanel" class="card v55SideBetTrackingText"><h2>📝 Yan Bahis Kurtarma Takibi</h2><p class="muted">${displayDate?'Seçili gün için':'Bu gün için'} kaydedilmiş yan bahis kurtarma kaydı yok. Tüm geçmiş korunur; kayıt geldikçe burada yalnız o günün özeti görünür.</p></div>`;
  const total=all.length;
  const misses=scoped.filter(x=>String(x?.status||'')!=='TUTTU');
  const rescuable=misses.filter(x=>x?.rescuable===true).length;
  const notes=rows.map(x=>{
    const product=tkpV55Html(x?.product||x?.title||'Yan bahis');
    const status=tkpV55Html(x?.status||'KAYIT');
    const adds=Array.isArray(x?.needed_adds)?x.needed_adds.reduce((a,b)=>a+tkpV55Num(b),0):tkpV55Num(x?.totalAdds??x?.needed_adds,0);
    const extra=tkpV55Num(x?.extra_cost,NaN);
    const rescue=tkpV55Num(x?.rescue_cost??x?.rescueCost,NaN);
    const detail=tkpV55Html(x?.detail||'');
    const rescueText=x?.rescuable===true?'kurtarılabilirdi':(x?.rescuable===false?'kurtarma sınırı dışında':'takip');
    return `<p class="v55SideBetTrackingLine"><b>${product}</b> · ${status} · ${rescueText}${adds?` · +${adds} aday`:''}${Number.isFinite(rescue)?` · yaklaşık ${typeof fmt2==='function'?fmt2(rescue):rescue} TL`:''}${Number.isFinite(extra)?` · ek ${typeof fmt2==='function'?fmt2(extra):extra} TL`:''}${detail?` · ${detail}`:''}</p>`;
  }).join('');
  const dayLabel=displayDate||'Seçili gün';
  return `<div id="tkpSideBetRescueDailyPanel" class="card v55SideBetTrackingText"><h2>📝 Yan Bahis Kurtarma Takibi · ${tkpV55Html(dayLabel)}</h2><p class="muted">Ekranda yalnız seçili günün ${scoped.length} kaydı var · kaçan ${misses.length} · kurtarılabilir ${rescuable}. Tüm geçmişte ${total} kayıt kalıcı olarak tutulur.</p><div class="v55SideBetTrackingNotes">${notes}</div></div>`;
}

globalThis.TKP_V55_ALGORITHM_VERSION=TKP_V55_ALGORITHM_VERSION;
globalThis.tkpV55DiagnosticsCenterHTMLAsync=tkpV55DiagnosticsCenterHTMLAsync;
globalThis.tkpInvalidateV55ExpertEvidenceCache=()=>{_tkpV55ExpertEvidenceCache=new WeakMap();_tkpV55ExpertOrderCache=new WeakMap();};
if(typeof addEventListener==='function')addEventListener('tkp:db-changed',()=>{_tkpV55ExpertEvidenceCache=new WeakMap();_tkpV55ExpertOrderCache=new WeakMap();});
