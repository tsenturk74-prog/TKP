(function(){
 'use strict';
 const trFold=v=>String(v??'').toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/[^A-Z0-9]+/g,' ').trim();
 const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0;};
 const noOf=h=>String(h?.no??h?.horse_no??h?.at_no??'').trim();
 const nameOf=h=>String(h?.name??h?.horse_name??h?.at_adi??'').trim();
 const posRx=/\b(BANKO|BANKOM|GUNUN TEKI|TEKIM|KAZANIR|HAZIR|COK IYI|SAGLAM|KULIS|OLMAZSA OLMAZ|GUVENIYORUM|FAVORIM|FORMDA)\b/;
 const negRx=/\b(EKSIK|HAZIR DEGIL|KOSMAZ|UZAK DUR|SORUN|KOTU|FORMSUZ|TEREDDUT|BEGENMEDIM|YETERSIZ)\b/;
 const strongRx=/\b(BANKO|BANKOM|GUNUN TEKI|TEKIM|KESIN|COK SAGLAM|NET)\b/;
 function getSettings(){try{const d=typeof db!=='undefined'?db:window.db;d.settings=d.settings||{};return d.settings;}catch{return {};}}
 function sourceRecord(handle){const s=getSettings().x_kulis_source_stats||{},x=s[String(handle||'').toLowerCase()]||{};return {total:Math.max(0,num(x.total)),correct:Math.max(0,num(x.correct)),edgeSum:Number(x.edgeSum)||0,selectionTotal:Math.max(0,num(x.selectionTotal))};}
 function sourceHistory(handle){const x=sourceRecord(handle);return Math.max(0,Math.min(100,100*(x.correct+2)/(x.total+4)));}
 function sourceQualified(record,chosen){
  const hitRate=record.total?100*record.correct/record.total:0,edge=record.total?record.edgeSum/record.total:0;
  return record.total>0&&hitRate>=(chosen?58:62)&&edge>=(chosen ? .05 : .08); // sert örnek sayısı kapısı yok
 }
 function contextLeg(text){const f=trFold(text),m=f.match(/(?:AYAK|KOSU)\s*(\d+)|(?:^|\s)(\d+)\s*(?:AYAK|KOSU)/);return Number(m?.[1]||m?.[2])||0;}
 function mentionedHip(text){const f=trFold(text),hips=['DIYARBAKIR','ISTANBUL','IZMIR','ANKARA','BURSA','KOCAELI','SANLIURFA','ELAZIG','ADANA','ANTALYA'];return hips.find(h=>new RegExp(`(?:^| )${h}(?: |$)`).test(f))||'';}
 function mentionedDate(text){const m=String(text||'').match(/(?:^|\D)([0-3]?\d)[.\/-]([01]?\d)[.\/-](20\d{2})(?:\D|$)/);return m?`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`:'';}
 function istanbulDate(value){const ms=Date.parse(String(value||''));return Number.isFinite(ms)?new Date(ms+3*60*60_000).toISOString().slice(0,10):'';}
 // Yalnız bugünkü tarih + hipodrom + koşu + aktif at eşleşmesi puana girer.
 // Tekil at adıyla boşa dönen X araması kullanılmaz; takip/sayfa postları yerelde eşleşir.
 function postAllowed(post,payload,races,mode){
  const strict=Number(payload?.schemaVersion)>=3,cutoff=Date.parse(String(payload?.raceStartAt||'')),postMs=Date.parse(String(post?.datetime||'')),historical=mode==='historical'||payload?.historicalMode===true,windowHours=Math.max(6,Math.min(72,Number(payload?.historicalWindowHours)||36));
  if(strict&&(mode==='live'||historical)&&(!Number.isFinite(cutoff)||!Number.isFinite(postMs)||postMs>=cutoff||postMs<cutoff-windowHours*60*60_000))return false;
  if(strict){
   const raceDate=String(races?.[0]?.race_date||''),explicit=mentionedDate(post?.text),local=istanbulDate(post?.datetime);
   if(explicit&&raceDate&&explicit!==raceDate)return false;
   if(raceDate&&local&&local!==raceDate&&explicit!==raceDate)return false;
  }
  return true;
 }
 function targetLegSet(payload,races){
  const listed=Array.isArray(payload?.targetLegs)?payload.targetLegs.map(Number).filter(Boolean):[];
  if(!listed.length) return null;
  return new Set(listed);
 }
 function raceLeg(race,index){const leg=Number(race?.leg);return leg>=1&&leg<=6?leg:index+1;}
 function raceAbsNo(race,index){const n=Number(race?._absRaceNo||race?.race_no);return Number.isInteger(n)&&n>0?n:raceLeg(race,index);}
 function raceKey(r,index){return String(r?.id??`${r?.race_date||''}|${trFold(r?.hippodrome||'')}|${raceAbsNo(r,index)}|${raceLeg(r,index)}`);}
 function predictionRaces(){
  const payload=Array.isArray(window.__lastPredictionPayload?.races)?window.__lastPredictionPayload.races.filter(r=>Array.isArray(r?.horses)&&r.horses.length):[];
  if(payload.length>=1&&payload.length<=20)return payload;
  const rows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];
  return rows.map(x=>x?.r).filter(r=>Array.isArray(r?.horses)&&r.horses.length);
 }
 const X_PERSIST_FIELDS=['x_base_ypuan','x_base_score','x_base_rank','x_ypuan_delta','x_tkp_score_delta','x_final_ypuan','x_final_tkp_score','x_final_rank','x_kulis_score','x_kulis_direction','x_kulis_comments','x_kulis_single_candidate','x_kulis_applied','x_force_coupon','x_break_single','x_kulis_schema_version','x_kulis_captured_at','x_kulis_race_start_at','x_kulis_training_eligible','x_kulis_provenance'];
 function persistXOverlayToStoredRaces(races){
  if(typeof db==='undefined'||!Array.isArray(db?.races))return 0;
  let changed=0;
  const sameRace=(a,b)=>{
   if(a?.id!=null&&b?.id!=null&&String(a.id)===String(b.id))return true;
   if(a?.race_uid&&b?.race_uid&&String(a.race_uid)===String(b.race_uid))return true;
   if(a?.file_id!=null&&b?.file_id!=null&&String(a.file_id)===String(b.file_id)&&Number(a?.leg)===Number(b?.leg))return true;
   return String(a?.race_date||'')===String(b?.race_date||'')&&trFold(a?.hippodrome||'')===trFold(b?.hippodrome||'')&&Number(a?.altili_no||1)===Number(b?.altili_no||1)&&Number(a?.leg||a?.race_no||0)===Number(b?.leg||b?.race_no||0);
  };
  for(const srcRace of (races||[])){
   const dstRace=db.races.find(r=>sameRace(srcRace,r));if(!dstRace)continue;
   for(const srcHorse of (srcRace?.horses||[])){
    if(!X_PERSIST_FIELDS.some(k=>Object.prototype.hasOwnProperty.call(srcHorse||{},k)))continue;
    const srcNo=String(noOf(srcHorse)||'');
    const srcName=trFold(nameOf(srcHorse));
    const dstHorse=(dstRace.horses||[]).find(h=>String(noOf(h)||'')===srcNo)||(srcName?(dstRace.horses||[]).find(h=>trFold(nameOf(h))===srcName):null);
    if(!dstHorse)continue;
    for(const k of X_PERSIST_FIELDS){
     if(Object.prototype.hasOwnProperty.call(srcHorse,k)){
      const v=srcHorse[k];const next=(v&&typeof v==='object')?JSON.parse(JSON.stringify(v)):v;
      if(JSON.stringify(dstHorse[k])!==JSON.stringify(next)){dstHorse[k]=next;changed++;}
     }
    }
    // Shadow katmanı yalnız görüntüdür. Kalıcı kayıtta da kupon/TEK zorlaması taşıyamaz.
    if(srcHorse.x_kulis_applied!==true){
     if(dstHorse.x_kulis_applied!==false){dstHorse.x_kulis_applied=false;changed++;}
     if(dstHorse.x_force_coupon!==false){dstHorse.x_force_coupon=false;changed++;}
     if(dstHorse.x_break_single!==false){dstHorse.x_break_single=false;changed++;}
    }
   }
  }
  return changed;
 }
 function scoreEntryForRace(r,index){
  const rows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];
  const exact=rows.find((x,i)=>x?.r&&raceKey(x.r,i)===raceKey(r,index));
  if(exact)return exact;
  return rows.find((x,i)=>Number(x?.r?.leg)===raceLeg(r,index)&&trFold(x?.r?.hippodrome)===trFold(r?.hippodrome))||null;
 }
 function raceIsEligible(payload,race,index,mode){
  if(mode!=='live')return true;
  const set=targetLegSet(payload);if(set&&!set.has(raceLeg(race,index)))return false;
  const map=payload?.raceStartMap&&typeof payload.raceStartMap==='object'?payload.raceStartMap:{};
  const cutoff=Date.parse(String(map[String(raceLeg(race,index))]||payload?.raceStartAt||''));
  const captured=Date.parse(String(payload?.capturedAt||''));
  return Number.isFinite(cutoff)&&Number.isFinite(captured)&&captured<cutoff;
 }
 function legSegments(text){
  const raw=String(text||''),lines=raw.split(/\r?\n+/).map(x=>x.trim()).filter(Boolean),out=[];
  // X kuponlarında "4️⃣: 7 BANKO'M" biçimi çok yaygın. Keycap/emoji işaretleri
  // trFold sonrasında temizlenir ve satır "4 7 BANKOM" kalır.
  for(const line of lines){
   const f=trFold(line),markerCount=(f.match(/(?:^| )\d{1,2} +(?:AYAK|KOSU)(?: |$)/g)||[]).length;
   if(markerCount>1)continue;
   const explicit=contextLeg(line),shortMark=line.match(/^\s*(\d{1,2})(?:\ufe0f?\u20e3)?\s*[:.)-]/),short=!explicit?(Number(shortMark?.[1])||((lines.length>1&&/[\ufe0f\u20e3]/.test(line))?Number(f.match(/^(\d{1,2})(?: |$)/)?.[1])||0:0)):0;
   const content=explicit?f.replace(/(?:^| )\d{1,2} +(?:AYAK|KOSU)(?: |$)/,' '):short?f.replace(/^\d{1,2}(?: |$)/,''):f;
   if(explicit||short)out.push({leg:explicit||short,text:line,folded:content.trim(),structured:true});
  }
  // Aynı satıra yazılmış 1.AYAK ... 2.AYAK ... kuponlarını da ayır.
  const f=trFold(raw),rx=/(?:^| )(\d{1,2}) +(AYAK|KOSU)(?: |$)/g,marks=[];let m;
  while((m=rx.exec(f)))marks.push({leg:Number(m[1]),start:m.index,end:rx.lastIndex});
  if(marks.length>1){for(let i=0;i<marks.length;i++)out.push({leg:marks[i].leg,text:f.slice(marks[i].end,marks[i+1]?.start??f.length),folded:f.slice(marks[i].end,marks[i+1]?.start??f.length),structured:true});}
  return out;
 }
 function sentiment(text){const f=trFold(text),positive=posRx.test(f),negative=negRx.test(f);if(positive===negative)return null;return {direction:positive?1:-1,strong:strongRx.test(f),folded:f};}
 function exactMentions(post,races,payload=null,mode='live'){
  const f=trFold(post.text),segments=legSegments(post.text),singleLeg=segments.length===1?segments[0].leg:contextLeg(post.text),out=[];
  races.forEach((race,ri)=>{if(!raceIsEligible(payload,race,ri,mode))return;(race.horses||[]).forEach(h=>{
   const postHip=mentionedHip(post.text),raceHip=trFold(race.hippodrome),postDate=mentionedDate(post.text),raceDate=String(race.race_date||'');
   if(postHip&&raceHip&&postHip!==raceHip)return;
   if(postDate&&raceDate&&postDate!==raceDate)return;
   const hn=trFold(nameOf(h)),horseNo=String(noOf(h)).match(/^\d+/)?.[0]||'';
   const validLeg=n=>n===raceLeg(race,ri)||n===raceAbsNo(race,ri);
   const scoped=segments.filter(s=>validLeg(s.leg));
   if(segments.length&&!scoped.length)return;
   if(!segments.length&&singleLeg&&!validLeg(singleLeg))return;
   const local=scoped.length?scoped.map(s=>s.folded).join(' '):f;
   const leg=scoped[0]?.leg||singleLeg;
   const nameHit=hn.length>=3&&new RegExp(`(?:^| )${hn.replace(/ /g,' +')}(?: |$)`).test(local);
   const anyNamedHorse=(races||[]).some(rr=>(rr?.horses||[]).some(other=>{const on=trFold(nameOf(other));return on.length>=3&&new RegExp(`(?:^| )${on.replace(/ /g,' +')}(?: |$)`).test(local);}));
   // Numara tek başına altı farklı ayakta tekrarlanabilir. Bu nedenle “7 banko/tek”
   // yalnız tweet açıkça AYAK/KOŞU belirtiyorsa güvenli eşleşme sayılır.
   const noRx=horseNo?new RegExp(`(?:^| )(?:AT +)?(?:NO +|NUMARA +|NOLU +|# *)?${horseNo}(?: +NUMARA| +NOLU)?(?: +|$)`):null;
   const hasVerdict=/(?:^| )(?:BANKO|BANKOM|TEK|TEKIM|SAGLAM|KAZANIR|FAVORIM)(?: |$)/.test(local);
   const structuredCoupon=Boolean(scoped.some(s=>s.structured)&&/\d/.test(local));
   const numberHit=Boolean(!anyNamedHorse&&leg&&noRx?.test(local)&&(hasVerdict||structuredCoupon));
   if(!nameHit&&!numberHit)return;
   out.push({race,ri,h,match:nameHit?(leg?100:92):(hasVerdict?88:80),matchType:nameHit?'name':'number',mentionText:local,structuredCoupon});
  });});return out;
 }
 function trustScore(post,match,allPosts,handles,statement){
  const handle=String(post.author||'').toLowerCase(),trusted=handles.some(x=>String(x).replace(/^@/,'').toLowerCase()===handle);
  const base=trusted?75:55,hist=sourceHistory(handle),statementScore=statement.strong?95:72;
  const corroborated=allPosts.some(p=>p!==post&&String(p.author||'').toLowerCase()!==handle&&trFold(p.text).includes(match.horseFold));
  // Tam kupondaki her ata aynı 65'i vermek bilgi kaybıydı. Gerçek paylaşımın
  // seçiciliğini kullan: az atlı seçim ve listede önde yazılan at daha güçlüdür.
  // Açık BANKO/TEK ifadesinde yüksek seçicilik korunur; sayı uydurulmaz.
  let selectivity=statement.strong?90:72;
  if(match.structuredCoupon){
   const picks=[...new Set((String(match.mentionText||'').match(/\b\d{1,2}\b/g)||[]).map(Number).filter(n=>n>0&&n<100))];
   const horseNo=Number(String(noOf(match.h)).match(/^\d+/)?.[0]);
   const position=picks.indexOf(horseNo);
   if(position>=0){
    const breadth=Math.max(45,100-Math.max(0,picks.length-1)*10);
    selectivity=Math.max(35,breadth-position*6);
   }else selectivity=55;
  }
  return Math.round(Math.max(0,Math.min(100,base*.20+hist*.25+match.match*.20+statementScore*.10+(corroborated?100:35)*.10+selectivity*.15)));
 }
 function deltaFor(score,direction){if(score<60)return 0;if(score<75)return 1*direction;if(score<88)return 2*direction;if(score<94)return 3*direction;return 4*direction;}
 function shadowEvidenceDelta(item){
  // Shadow X puanı tahmine dokunmadan kanıt gücünü 1..6 aralığında daha okunur
  // dağıtır. Tek bir zayıf yorum +1/+2, açık güçlü ifade +3 civarı, bağımsız
  // kaynak mutabakatı +4/+5 ve çok yüksek tarihsel güven +6 üretir. Karşıt
  // yorumlar birbirini törpüler; sırf çok post var diye puan şişmez.
  // Gölge görünümde doğrulanmış her post kanıttır. Önceki sürüm yalnız canlıda
  // "uygulanmış" işaret alan kayıtları saydığı için iki post görünmesine rağmen
  // ekranda 0 kalabiliyordu. Aynı postu iki kez saymamak için yazar+URL/metinle
  // tekilleştir; bu görünür etkidir, tahmine/kupona uygulanmaz.
  const seenPosts=new Set();
  const comments=(Array.isArray(item?.comments)?item.comments:[]).filter(c=>{
   if(Number(c?.score)<55)return false;
   // Eski/kanıtsız tam kupon satırı yalnız bilgi olarak gösterilir; X kanıt puanı
   // ancak güncel zaman kanıtı olan shadow taramada veya öğrenilmiş/consensus kaynakta görünür.
   if(c?.couponOnly && !c?.applied && !c?.bootstrapEnough && !c?.learnedEnough && !c?.strongEnough) return false;
   const key=[String(c?.author||'').toLowerCase(),String(c?.url||c?.text||'')].join('|');
   if(seenPosts.has(key))return false;seenPosts.add(key);return true;
  });
  if(!comments.length)return 0;
  const buckets={1:[],[-1]:[]};
  let posWeight=0,negWeight=0;
  for(const c of comments){
   const sc=Math.max(0,Math.min(100,Number(c?.score)||0)),dir=Number(c?.direction)>=0?1:-1;
   const author=String(c?.author||'').toLowerCase();
   const quality=Math.max(.20,(sc-50)/50);
   const proofBoost=(c?.strongEnough?1.12:1)*(c?.learnedEnough?1.08:1);
   const w=quality*proofBoost;
   const rec={score:sc,weight:w,author,strong:Boolean(c?.strongEnough)};
   buckets[dir].push(rec);
   if(dir>0)posWeight+=w;else negWeight+=w;
  }
  const total=posWeight+negWeight;if(total<=0)return 0;
  const net=posWeight-negWeight;
  // Kanıt neredeyse dengedeyse ekranda taraflı +puan uydurma.
  if(Math.abs(net)/total<0.18)return 0;
  const direction=net>0?1:-1,chosen=buckets[direction],opposite=buckets[-direction];
  const chosenWeight=chosen.reduce((a,c)=>a+c.weight,0);
  const weightedScore=chosenWeight?chosen.reduce((a,c)=>a+c.score*c.weight,0)/chosenWeight:0;
  let magnitude=weightedScore<60?1:weightedScore<68?2:weightedScore<76?3:weightedScore<84?4:weightedScore<92?5:6;
  const authors=new Set(chosen.map(c=>c.author).filter(Boolean));
  const strongCount=chosen.filter(c=>c.strong).length;
  const oppositeWeight=opposite.reduce((a,c)=>a+c.weight,0);
  // İki ayrı hesap aynı yöndeyse bir kademe; üç ayrı hesap + güçlü kanıt varsa
  // ikinci kademe ver. Aynı hesabın tekrarları consensus sayılmaz.
  if(authors.size>=2&&weightedScore>=70&&oppositeWeight<chosenWeight*.30)magnitude++;
  if(authors.size>=3&&strongCount>=2&&weightedScore>=80&&oppositeWeight<chosenWeight*.20)magnitude++;
  // Kullanıcı kuralı: aynı ata ait iki ayrı doğrulanmış post, yorum zayıf olsa
  // dahi ekranda en az +2 kanıt göstermelidir. Aynı hesabın tekrarları burada
  // yalnız bu tabanı sağlar; bağımsız hesap mutabakatı için yukarıdaki ayrı kural geçerlidir.
  if(direction>0&&chosen.length>=2)magnitude=Math.max(2,magnitude);
  // Ciddi karşıt kanıt varsa göstergeyi bir kademe aşağı çek.
  if(oppositeWeight>=chosenWeight*.35)magnitude--;
  return Math.max(1,Math.min(6,magnitude))*direction;
 }
 function xHorseIsNonRunner(h){
  if(typeof isNonRunner==='function') return !!isNonRunner(h);
  const raw=String(h?.status||h?.runner_status||h?.note||'').toUpperCase();
  return Number(h?.non_runner)===1 || Number(h?.is_non_runner)===1 || /KOŞMAZ|KOSMAZ|NON.?RUNNER|SCRATCH/.test(raw);
 }
 function applyPayload(payload,{mode='live',racesOverride=null}={}){
  const rows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];
  const races=Array.isArray(racesOverride)&&racesOverride.length?racesOverride:predictionRaces();
  const payloadSchema=Number(payload?.schemaVersion)||0,payloadCutoff=Date.parse(String(payload?.raceStartAt||'')),payloadCaptured=Date.parse(String(payload?.capturedAt||''));
  const strictBlocked=mode==='live'&&(payloadSchema<3||!Number.isFinite(payloadCutoff)||!Number.isFinite(payloadCaptured)||payloadCaptured>=payloadCutoff||payloadCaptured<payloadCutoff-36*60*60_000);
  const rawPosts=Array.isArray(payload?.posts)?payload.posts:[];
  // Kanıtı geçersiz canlı paket, mevcut güvenli X katmanını dahi sıfırlamadan
  // tamamen reddedilir. Böylece eski şema çağrısı aynı oturumda yan etki bırakamaz.
  if(strictBlocked)return {mode,posts:0,matched:0,blockedReason:'invalid_or_late_time_proof',results:[]};
  const posts=strictBlocked?[]:rawPosts.filter(post=>postAllowed(post,payload,races,mode)),handles=Array.isArray(payload?.handles)?payload.handles:[];
  const results=[],applied=new Map();
  // Aynı at için önceki taramada oluşan daha yüksek güven korunur; sonraki tarama yalnız daha güçlü kanıt varsa değeri yükseltebilir.
  const previousScores=new Map();
  try{const prevLast=getSettings()?.x_kulis_last||{},sameContext=(!prevLast.date||!races[0]?.race_date||String(prevLast.date)===String(races[0].race_date))&&(!prevLast.hippodrome||!races[0]?.hippodrome||trFold(prevLast.hippodrome)===trFold(races[0].hippodrome));if(sameContext)for(const x of (prevLast.results||[])){const k=String(x?.leg||'')+'|'+String(x?.no||'');const sc=Number(x?.score);if(k&&Number.isFinite(sc))previousScores.set(k,{score:sc,direction:String(x?.direction||'')});}}catch(_e){}

  races.forEach((race,ri)=>{if(!raceIsEligible(payload,race,ri,mode))return;const scoreEntry=scoreEntryForRace(race,ri);const order=(scoreEntry?.scored||race.horses||[]).map(x=>x.h||x);for(const h of (race.horses||[])){if(xHorseIsNonRunner(h)){h.x_ypuan_delta=0;h.x_tkp_score_delta=0;h.x_kulis_score=0;h.x_kulis_comments=[];h.x_kulis_single_candidate=false;h.x_force_coupon=false;h.x_break_single=false;continue;}const oi=order.findIndex(x=>noOf(x)===noOf(h)||trFold(nameOf(x))===trFold(nameOf(h))),ranked=oi>=0?order[oi]:h,raw=ranked?.ypuan??h?.ypuan,rawScore=ranked?.score??h?.score;if(h.x_base_ypuan==null)h.x_base_ypuan=raw!==null&&raw!==''&&Number.isFinite(Number(raw))?Number(raw):null;if(h.x_base_score==null)h.x_base_score=rawScore!==null&&rawScore!==''&&Number.isFinite(Number(rawScore))?Number(rawScore):null;if(h.x_base_rank==null)h.x_base_rank=oi>=0?oi+1:null;h.x_ypuan_delta=0;h.x_tkp_score_delta=0;h.x_kulis_score=0;h.x_kulis_comments=[];h.x_kulis_single_candidate=false;h.x_force_coupon=false;h.x_break_single=false;h.x_kulis_schema_version=payloadSchema;h.x_kulis_captured_at=String(payload?.capturedAt||'');h.x_kulis_race_start_at=String((payload?.raceStartMap||{})[String(raceLeg(race,ri))]||payload?.raceStartAt||'');h.x_kulis_training_eligible=false;h.x_kulis_provenance=mode==='historical'?'historical_verified':'live_or_shadow';}});
  for(const post of posts){for(const m of exactMentions(post,races,payload,mode)){if(xHorseIsNonRunner(m.h))continue;const stated=sentiment(m.mentionText||post.text),couponOnly=!stated&&m.structuredCoupon,st=stated||(couponOnly?{direction:1,strong:false,folded:trFold(m.mentionText)}:null);if(!st)continue;
   const horseFold=trFold(nameOf(m.h)),score=trustScore(post,{...m,horseFold},posts,handles,st),key=`${m.ri}|${noOf(m.h)}`;
   const baseAvailable=m.h.x_base_ypuan!==null&&m.h.x_base_ypuan!==''&&Number.isFinite(Number(m.h.x_base_ypuan)),baseScoreAvailable=m.h.x_base_score!==null&&m.h.x_base_score!==''&&Number.isFinite(Number(m.h.x_base_score)),
    // V1 evidence governance: legacy x_kulis_source_stats was mutable and could be
    // trained on reconstructed history.  It is now display-only legacy data; it may
    // never unlock a direct score/coupon action.  The immutable commentator ledger
    // below is the only path that can later influence Expert/Kulis.
    learnedCoupon=false,item=applied.get(key)||{raceIndex:m.ri,leg:raceLeg(m.race,m.ri),raceNo:raceAbsNo(m.race,m.ri),horse:m.h,no:noOf(m.h),name:nameOf(m.h),baseRank:m.h.x_base_rank,baseYpuan:baseAvailable?Number(m.h.x_base_ypuan):null,baseScore:baseScoreAvailable?Number(m.h.x_base_score):null,baseAvailable,baseScoreAvailable,delta:0,tkpScoreDelta:0,score:0,comments:[],learnedDelta:0,softAuthors:[],couponAuthors:[],couponConsensusApplied:false};
   const authorKey=String(post.author||'').toLowerCase();
   if(couponOnly&&authorKey&&!item.couponAuthors.includes(authorKey))item.couponAuthors.push(authorKey);
   // X posts are recorded as evidence, not a mutable prediction-score overlay.
   // Even a valid, current post must pass the 150-live-event + manual approval
   // governance in commentator-performance-engine.js before it can nudge ONLY
   // Expert/Kulis.  Consequently no raw post can force a coupon/TEK here.
   const strongEnough=false;
   const learnedEnough=false;
   const softEnough=false;
   const couponConsensusEnough=false;
   const bootstrapEnough=softEnough||couponConsensusEnough;
   let appliedNow=false;
   if(strongEnough||learnedEnough||softEnough||couponConsensusEnough){let yDelta=0;if(strongEnough)yDelta=deltaFor(score,st.direction);else if(learnedEnough){const next=Math.max(-3,Math.min(3,item.learnedDelta+1*st.direction));yDelta=next-item.learnedDelta;item.learnedDelta=next;}else if(softEnough){item.softAuthors.push(authorKey);const softTotal=Math.max(-2,Math.min(2,(Number(item.softDelta)||0)+1*st.direction));yDelta=softTotal-(Number(item.softDelta)||0);item.softDelta=softTotal;}else if(couponConsensusEnough){yDelta=1;item.couponConsensusApplied=true;}if(baseAvailable)item.delta=Math.max(-6,Math.min(6,item.delta+yDelta));else item.tkpScoreDelta=Math.max(-.12,Math.min(.12,item.tkpScoreDelta+yDelta*.015));appliedNow=Boolean(yDelta);}
   // Tahmin kuponunda aynı ayakla açıkça yazılan at, "banko" sözcüsü yoksa da
   // gerçek bir X seçimi sayılır. Shadow modunda bu yalnız görünür +1 kanıtına
   // dönüşür; canlı modda tek başına kuponu/sıralamayı değiştiremez.
   if(mode!=='live'&&couponOnly&&!appliedNow&&payloadSchema>=3) appliedNow=true;
   item.direction=st.direction>=0?'positive':'negative';const prev=previousScores.get(key);if(prev&&prev.direction===item.direction&&Number(prev.score)>Number(item.score))item.score=Number(prev.score);item.score=Math.max(item.score,score);item.comments.push({author:post.author,text:post.text,datetime:post.datetime,url:post.url,score,match:m.match,matchType:m.matchType,direction:st.direction,couponOnly,strongEnough,learnedEnough,bootstrapEnough,applied:appliedNow});applied.set(key,item);
  }}
  for(const item of applied.values()){
   // Shadow modunda ekranda görülen +puan tekdüze 1/2 olmasın: güven, bağımsız kaynak
   // sayısı ve güçlü ifade birlikteliğinden 1..6 arası kanıt puanı üret. Tahmine uygulanmaz.
   if(mode!=='live'&&item.baseAvailable)item.delta=shadowEvidenceDelta(item);
   // X güveni tahmin puanı değildir: kaynak/metin kanıtını ölçer; shadow modunda
   // sıralama ve kupona uygulanmaz.
   const h=item.horse;h.x_ypuan_delta=item.delta;h.x_tkp_score_delta=item.tkpScoreDelta;h.x_final_ypuan=item.baseAvailable?Math.max(0,Math.round((item.baseYpuan+item.delta)*100)/100):null;h.x_final_tkp_score=item.baseScoreAvailable?Math.max(0,Math.round((item.baseScore+item.tkpScoreDelta)*1000)/1000):null;h.x_kulis_score=item.score;h.x_kulis_direction=item.direction;h.x_kulis_comments=item.comments;h.x_kulis_single_candidate=Boolean(item.direction==='positive'&&Number(item.score)>70&&item.comments.length>=2);
   // Never write h.ypuan / h.score here.  `x_kulis_applied` and the force flags
   // must stay false as well; approved evidence is consumed through the separate
   // Expert-only consensus API, not these raw imported fields.
   h.x_kulis_applied=false;h.x_kulis_training_eligible=false;h.x_kulis_provenance=mode==='historical'?'historical_research_shadow':'governed_shadow';h.x_force_coupon=false;h.x_break_single=false;
   // Önceden hesaplanan birleşik Altılı puanı X değişikliğinden sonra kullanılırsa
   // kulis ekranda görünür ama sıralamaya etki etmezdi. At düzeyi önbelleği temizle.
   delete h.altili_winner_score;delete h._altili_winner_model_signature;
   item.finalYpuan=h.x_final_ypuan;item.finalTkpScore=h.x_final_tkp_score;item.forceCoupon=h.x_force_coupon;item.breakSingle=h.x_break_single;results.push(item);
  }
  races.forEach((race,ri)=>{if(!raceIsEligible(payload,race,ri,mode))return;const sorted=[...(race.horses||[])].sort((a,b)=>{const ay=a.ypuan!==null&&a.ypuan!==''&&Number.isFinite(Number(a.ypuan)),by=b.ypuan!==null&&b.ypuan!==''&&Number.isFinite(Number(b.ypuan));return ay&&by?Number(b.ypuan)-Number(a.ypuan):(Number(b.score)||0)-(Number(a.score)||0);});sorted.forEach((h,i)=>{h.x_final_rank=i+1;const item=applied.get(`${ri}|${noOf(h)}`);if(item)item.finalRank=i+1;});});
  // Store exact selections in the append-only governance ledger before preserving
  // the small UI preview cache.  Malformed, anonymous, historical or late posts
  // are retained as research/shadow but cannot count toward a live source.
  try{if(typeof window.tkpCommentatorCaptureX==='function')window.tkpCommentatorCaptureX(payload,races,{mode,results});}catch(_){ }
  const settings=getSettings();settings.x_kulis_last={schemaVersion:payloadSchema,capturedAt:payload?.capturedAt||'',raceStartAt:payload?.raceStartAt||'',targetLegs:Array.isArray(payload?.targetLegs)?payload.targetLegs.slice():[],raceStartMap:payload?.raceStartMap||{},date:races[0]?.race_date||'',hippodrome:races[0]?.hippodrome||'',mode,handles,posts:posts.slice(0,180),results:results.map(x=>({...x,horse:undefined}))};
  // Kayıtlı gün açılırken tahmin yarışları clone olabilir. X yalnız clone üzerinde kalırsa
  // ekranı kapatıp yeniden açınca /+puan kaybolur. X alanlarını gerçek db.races kaydına
  // birebir geri yaz ve sonra saveDB ile kalıcılaştır. Shadow olduğunda tahmine etkisi yoktur.
  const persistedXFields=persistXOverlayToStoredRaces(races);
  try{if(typeof invalidateProfileMatchCache==='function')invalidateProfileMatchCache();if(typeof invalidateConditionStatsCache==='function')invalidateConditionStatsCache();if(typeof tkpInvalidateLearningModelCaches==='function')tkpInvalidateLearningModelCaches();if(typeof rulesDirty!=='undefined')rulesDirty=true;if(typeof saveDB==='function')Promise.resolve(saveDB(false)).catch(()=>{});}catch{}
  const appliedCount=0;
  return {mode,posts:posts.length,matched:results.length,applied:appliedCount,blockedReason:'',results};
 }
 function tableHTML(report){
  const reportRows=Array.isArray(report?.results)?report.results:[];
  const byKey=new Map(reportRows.map(x=>[`${Number(x.leg)||0}|${String(x.no||'')}`,x]));
  const roster=[];
  predictionRaces().forEach((r,ri)=>{const leg=raceLeg(r,ri);(r.horses||[]).forEach(h=>{if(/(?:^|\s)\(KOŞMAZ\)/i.test(String(h?.horse_name||h?.name||'')))return;roster.push({leg,raceNo:raceAbsNo(r,ri),no:noOf(h),name:nameOf(h),horse:h});});});
  const source=roster.length?roster:reportRows.map(x=>({leg:x.leg,no:x.no,name:x.name,horse:null}));
  let found=0,postCount=0,accounts=new Set();
  const rows=source.map(item=>{
    const x=byKey.get(`${Number(item.leg)||0}|${String(item.no||'')}`);
    if(!x)return `<tr class="xNoData"><td>${item.leg}. Ayak</td><td><b>${item.no} ${String(item.name||'')}</b></td><td>—</td><td><b>—</b></td><td>0</td><td>0</td><td>Veri yok</td><td class="muted">İkinci tur dahil güvenli eşleşme bulunamadı.</td></tr>`;
    found++;
    const comments=Array.isArray(x.comments)?x.comments:[];postCount+=comments.length;comments.forEach(c=>accounts.add(String(c.author||'').toLowerCase()));
    const useTkp=x.baseYpuan==null,realYpuan=useTkp?'-':x.baseYpuan,final=useTkp?`TKP ${Number(x.finalTkpScore??x.baseScore??0).toFixed(2)}`:x.finalYpuan,diff=useTkp?Number(x.tkpScoreDelta||0):Number(x.delta||0),effectText=`${diff>0?'+':''}${useTkp?diff.toFixed(2):diff}`;
    const authors=new Set(comments.map(c=>String(c.author||'').toLowerCase()).filter(Boolean));
    const lastTime=comments.map(c=>Date.parse(String(c.datetime||''))).filter(Number.isFinite).sort((a,b)=>b-a)[0];
    const lastText=lastTime?new Date(lastTime).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):'—';
    const matchLabel=comments.some(c=>c?.matchType==='name')?'Ad + ayak':'Numara + ayak';
    const verdict=x.forceCoupon?'Kupona al':x.breakSingle?'TEK boz':diff>0?`${comments.length} post kanıtı · olumlu`:diff<0?`${comments.length} post kanıtı · olumsuz`:`${comments.length} post · nötr`;
    return `<tr><td>${x.leg}. Ayak</td><td><b>${x.no} ${String(x.name||'')}</b></td><td>${x.baseRank||'-'}. / ${realYpuan}</td><td title="Eşleşme güveni; kazanma olasılığı değildir">${matchLabel} · <b>%${x.score}</b></td><td>${comments.length} post</td><td>${authors.size} hesap</td><td style="color:${diff>0?'#15803d':diff<0?'#b91c1c':'#64748b'};font-weight:800">${effectText} · ${lastText}</td><td>${verdict}</td></tr>`;
  }).join('');
  const total=source.length,missing=Math.max(0,total-found),scan=report?.scanStats||{};
  const requested=Number(scan.requestedHandles),attempted=Number(scan.attemptedHandles),matchedAuthors=Number(scan.matchedAuthors);
  const scanInfo=Number.isFinite(requested)&&requested>0
    ? ` · ${requested} tanımlı / ${Number.isFinite(attempted)?attempted:0} profil açıldı / ${Number.isFinite(matchedAuthors)?matchedAuthors:accounts.size} eşleşen yazar`
    : '';
  return `<div class="xKulisCoverage" style="border:1px solid #94a3b8;border-radius:9px;background:#fff;padding:8px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>𝕏 Günlük Kapsama · ${report?.mode==='live'?(Number(report?.applied)>0?'Tahmine uygulandı':'Veri bulundu · etki yok'):'Gölge test'}</b><span style="font-size:10.5px;color:#475569"><b>${total}/${total}</b> aktif at kontrol edildi · <b>${found}</b> atta X verisi · <b>${missing}</b> veri yok · ${postCount} eşleşen post · ${accounts.size} hesap${scanInfo}</span></div><div style="font-size:10px;color:#64748b;margin-top:3px">Eşleşme yüzdesi kazanma olasılığı değildir. İki doğrulanmış post gölge görünümde en az +2 kanıt verir; gölge X tahmini veya kuponu değiştirmez.</div><div style="overflow:auto;margin-top:6px"><table class="xKulisCompactTable" style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr><th>Ayak</th><th>At</th><th>İlk sıra / Y.PUAN</th><th>X güveni</th><th>Kanıt</th><th>Kaynak</th><th>Y.PUAN+X Etki / Son</th><th>Yorum</th></tr></thead><tbody>${rows||'<tr><td colspan="8">Aktif yarış listesi bulunamadı.</td></tr>'}</tbody></table></div></div>`;
 }
 function learnFromResults(){
  // Legacy mutable source statistics are intentionally retired.  Official results
  // resolve immutable ledger rows; the governance engine then computes width-
  // adjusted, conservative performance from those rows only.
  try{
   const all=typeof db!=='undefined'&&Array.isArray(db?.races)?db.races:[];
   const resolved=typeof window.tkpCommentatorResolveResults==='function'?window.tkpCommentatorResolveResults(all):0;
   return {learned:resolved,governed:true};
  }catch(_){return {learned:0,governed:true};}
 }
 function clearOverlay(){const rows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];const races=rows.map(x=>x.r);for(const r of races)for(const h of r.horses||[]){if(h.x_base_ypuan!=null)h.ypuan=h.x_base_ypuan;if(h.x_base_score!=null)h.score=h.x_base_score;for(const k of ['x_base_ypuan','x_base_score','x_base_rank','x_ypuan_delta','x_tkp_score_delta','x_final_ypuan','x_final_tkp_score','x_final_rank','x_kulis_score','x_kulis_direction','x_kulis_comments','x_kulis_single_candidate','x_kulis_applied','x_force_coupon','x_break_single','x_kulis_schema_version','x_kulis_captured_at','x_kulis_race_start_at'])delete h[k];}}
 window.tkpApplyXKulisPayload=applyPayload;window.tkpApplyHistoricalXKulisPayload=(payload,races)=>applyPayload(payload,{mode:'historical',racesOverride:races});window.tkpXKulisTableHTML=tableHTML;window.tkpLearnXKulisFromResults=learnFromResults;window.tkpClearXKulisOverlay=clearOverlay;
})();
