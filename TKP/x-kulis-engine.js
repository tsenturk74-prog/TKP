(function(){
 'use strict';
 const trFold=v=>String(v??'').toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/[^A-Z0-9]+/g,' ').trim();
 const num=v=>{const n=Number(String(v??'').replace(',','.'));return Number.isFinite(n)?n:0;};
 const noOf=h=>String(h?.no??h?.horse_no??h?.at_no??'').trim();
 const nameOf=h=>String(h?.name??h?.horse_name??h?.at_adi??'').trim();
 const posRx=/\b(BANKO|BANKOM|GUNUN TEKI|TEKIM|KAZANIR|HAZIR|COK IYI|SAGLAM|OLMAZSA OLMAZ|GUVENIYORUM|FAVORIM|FORMDA)\b/;
 const negRx=/\b(EKSIK|HAZIR DEGIL|KOSMAZ|UZAK DUR|SORUN|KOTU|FORMSUZ|TEREDDUT|BEGENMEDIM|YETERSIZ)\b/;
 const strongRx=/\b(BANKO|BANKOM|GUNUN TEKI|TEKIM|KESIN|COK SAGLAM|NET)\b/;
 function getSettings(){try{const d=typeof db!=='undefined'?db:window.db;d.settings=d.settings||{};return d.settings;}catch{return {};}}
 // DÜZELTME (2026-09-22, kendi bulgum — "yorumcu puanları verimli alınıyor mu"
 // sorusu üzerine incelendi): sourceHistory() eskiden `x_kulis_source_stats`
 // adlı, artık HİÇBİR yerde yazılmayan (bkz. learnFromResults() — "Legacy
 // mutable source statistics are intentionally retired") bir ayarı okuyordu.
 // Bu yüzden trustScore()'daki "hist" bileşeni her yazar için sabit 50 dönüyordu —
 // yani bir yorumcunun geçmişte gerçekten haklı çıkıp çıkmadığı, TEK BİR X
 // taramasının kanıt gücüne (magnitude/shadowEvidenceDelta) hiç yansımıyordu.
 // Artık gerçek, sonuçla doğrulanmış performans commentator-performance-engine.js'in
 // immutable ledger'ından (tkpCommentatorPerformance) okunur. Küçük örneklemde
 // (events azken) nötr 50'ye yakın kalır; örnek büyüdükçe gerçek edge'e göre kayar.
 function sourceHistory(handle){
  try{
   const perf=typeof globalThis.tkpCommentatorPerformance==='function'?globalThis.tkpCommentatorPerformance('x',handle):null;
   if(!perf||!Number(perf.events))return 50;
   const reliability=perf.events/(perf.events+8);
   return Math.max(0,Math.min(100,50+Number(perf.edge||0)*100*reliability));
  }catch{return 50;}
 }
 function contextLeg(text){const f=trFold(text),m=f.match(/(?:AYAK|KOSU)\s*(\d+)|(?:^|\s)(\d+)\s*(?:AYAK|KOSU)/);return Number(m?.[1]||m?.[2])||0;}
 function mentionedHip(text){const f=trFold(text),hips=['DIYARBAKIR','ISTANBUL','IZMIR','ANKARA','BURSA','KOCAELI','SANLIURFA','ELAZIG','ADANA','ANTALYA'];return hips.find(h=>new RegExp(`(?:^| )${h}(?: |$)`).test(f))||'';}
 function mentionedDate(text){const m=String(text||'').match(/(?:^|\D)([0-3]?\d)[.\/-]([01]?\d)[.\/-](20\d{2})(?:\D|$)/);return m?`${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`:'';}
 function istanbulDate(value){const ms=Date.parse(String(value||''));return Number.isFinite(ms)?new Date(ms+3*60*60_000).toISOString().slice(0,10):'';}
 // Yalnız bugünkü tarih + hipodrom + koşu + aktif at eşleşmesi puana girer.
 // Tekil at adıyla boşa dönen X araması kullanılmaz; takip/sayfa postları yerelde eşleşir.
 function postAllowed(post,payload,races,mode){
  const strict=Number(payload?.schemaVersion)>=3,cutoff=Date.parse(String(payload?.raceStartAt||'')),postMs=Date.parse(String(post?.datetime||'')),historical=mode==='historical'||payload?.historicalMode===true,windowHours=Math.max(6,Math.min(72,Number(payload?.historicalWindowHours)||36));
  if(strict&&(!Number.isFinite(cutoff)||!Number.isFinite(postMs)||(!historical&&(postMs>=cutoff||postMs<cutoff-windowHours*60*60_000))))return false;
  const captured=Date.parse(String(payload?.capturedAt||''));
  if(strict&&Number.isFinite(captured)&&postMs>captured)return false;
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
   const indexed=typeof globalThis.tkpRaceLookup==='function'?globalThis.tkpRaceLookup(srcRace):null;
   const dstRace=indexed||db.races.find(r=>sameRace(srcRace,r));if(!dstRace)continue;
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
 // V1.1.336 (kullanıcı talebi · DİKKAT: VERİ SIZINTISI): Yarış başladıktan SONRA
 // toplanan X yorumları da tahmine/puana/öğrenmeye uygulanır. true iken yarış-başlangıç
 // kesme (cutoff) korumaları devre dışı kalır; backtest ve öğrenme geçerliliği bundan
 // etkilenir (model yarış-sonrası bilgiyi görür). Eski güvenli davranış için false yap.
 const TKP_X_APPLY_LATE_POSTS=false;
 function raceIsEligible(payload,race,index,mode){
  const set=targetLegSet(payload);if(set&&!set.has(raceLeg(race,index)))return false;
  if(TKP_X_APPLY_LATE_POSTS)return true;
  const map=payload?.raceStartMap&&typeof payload.raceStartMap==='object'?payload.raceStartMap:{};
  const cutoff=Date.parse(String(map[String(raceLeg(race,index))]||payload?.raceStartAt||''));
  const captured=Date.parse(String(payload?.capturedAt||''));
  return (mode==='historical'||payload?.historicalMode===true)|| (Number.isFinite(cutoff)&&Number.isFinite(captured)&&captured<cutoff);
 }
 function legSegments(text){
  const lines=String(text||'').split(/\r?\n+/).map(x=>x.trim()).filter(Boolean),out=[];
  for(const line of lines){
   const f=trFold(line),rx=/(?:^| )(?:([1-9]\d?) +(AYAK|KOSU)|(AYAK|KOSU) +([1-9]\d?))(?= |$)/g,marks=[];let m;
   while((m=rx.exec(f)))marks.push({leg:Number(m[1]||m[4]),kind:m[2]||m[3],start:m.index,end:rx.lastIndex});
   if(marks.length){
    for(let i=0;i<marks.length;i++){const mark=marks[i],content=f.slice(mark.end,marks[i+1]?.start??f.length).trim();out.push({leg:mark.leg,kind:mark.kind,text:line,folded:content,structured:true});}
   }else{
    const short=line.match(/^\s*([1-6])(?:\ufe0f?\u20e3)?\s*[:.)-]/)||line.match(/^\s*([1-6])\ufe0f?\u20e3/);
    if(short)out.push({leg:Number(short[1]),kind:'AYAK',text:line,folded:f.replace(/^\d+(?: |$)/,'').trim(),structured:true});
   }
  }
  return out;
 }
 function sentiment(text){const f=trFold(text),positive=posRx.test(f),negative=negRx.test(f);if(positive===negative)return null;return {direction:positive?1:-1,strong:strongRx.test(f),folded:f};}
 function exactMentions(post,races,payload=null,mode='live'){
  const f=trFold(post.text),segments=legSegments(post.text),singleLeg=segments.length===1?segments[0].leg:contextLeg(post.text),out=[];
  const namePatterns=(races||[]).flatMap(r=>(r.horses||[]).map(h=>trFold(nameOf(h))).filter(name=>name.length>=3).map(name=>new RegExp(`(?:^| )${name.replace(/ /g,' +')}(?: |$)`))),namedLocalCache=new Map();
  const containsNamedHorse=local=>{if(!namedLocalCache.has(local))namedLocalCache.set(local,namePatterns.some(rx=>rx.test(local)));return namedLocalCache.get(local);};
  const couponNumbers=[...f.matchAll(/(?:^| )([12]) ALTILI(?: |$)/g)].map(m=>Number(m[1]));
  races.forEach((race,ri)=>{if(!raceIsEligible(payload,race,ri,mode))return;
   const cutoff=Date.parse(String(payload?.raceStartMap?.[String(raceLeg(race,ri))]||payload?.raceStartAt||'')),postMs=Date.parse(String(post.datetime||''));
   if(!TKP_X_APPLY_LATE_POSTS && Number.isFinite(cutoff)&&(!Number.isFinite(postMs)||postMs>=cutoff))return;
   (race.horses||[]).forEach(h=>{
   const postHip=mentionedHip(post.text),raceHip=trFold(race.hippodrome),postDate=mentionedDate(post.text),raceDate=String(race.race_date||'');
   if(postHip&&raceHip&&postHip!==raceHip)return;
   if(postDate&&raceDate&&postDate!==raceDate)return;
   const hn=trFold(nameOf(h)),horseNo=String(noOf(h)).match(/^\d+/)?.[0]||'';
   const scoped=segments.filter(s=>s.leg===(s.kind==='KOSU'?raceAbsNo(race,ri):raceLeg(race,ri)));
   // Relative AYAK numbers belong to one altılı; absolute KOSU numbers remain unambiguous.
   if(scoped.some(s=>s.kind==='AYAK')&&couponNumbers.length&&(new Set(couponNumbers).size!==1||couponNumbers[0]!==Number(race.altili_no||2)))return;
   if(segments.length&&!scoped.length)return;
   const local=scoped.length?scoped.map(s=>s.folded).join(' '):f;
   const leg=scoped[0]?.leg||singleLeg;
   const nameHit=hn.length>=3&&new RegExp(`(?:^| )${hn.replace(/ /g,' +')}(?: |$)`).test(local);
   const anyNamedHorse=containsNamedHorse(local);
   // Numara tek başına altı farklı ayakta tekrarlanabilir. Bu nedenle “7 banko/tek”
   // yalnız tweet açıkça AYAK/KOŞU belirtiyorsa güvenli eşleşme sayılır.
   const noRx=horseNo?new RegExp(`(?:^| )(?:AT +)?(?:NO +|NUMARA +|NOLU +|# *)?${horseNo}(?: +NUMARA| +NOLU)?(?: +|$)`):null;
   const hasVerdict=/(?:^| )(?:BANKO|BANKOM|TEK|TEKIM|SAGLAM|KAZANIR|FAVORIM)(?: |$)/.test(local);
   const structuredCoupon=Boolean(scoped.some(s=>s.structured)&&/\d/.test(local));
   const numberHit=Boolean(!anyNamedHorse&&leg&&noRx?.test(local)&&(hasVerdict||structuredCoupon));
   if(!nameHit&&!numberHit)return;
   out.push({race,ri,h,match:nameHit?(leg?100:92):(hasVerdict?88:80),matchType:nameHit?'name':'number',mentionText:local,structuredCoupon});
  });});
  // V1.1.337 (canlı İstanbul testi): bir post bir ayağın neredeyse TÜM atlarını sıralıyorsa
  // (ör. "2. AYAK: 1 ... 2 ... 3 ... 10 ...") bu bir seçim değil tam kadro/program listesidir.
  // Her ata aynı kanıt (+2, 63 puan) yazıp ayrım gücü olmayan X skoru üretiyordu. Yalnız yapısal
  // kupon/isim eşleşmeleri düşürülür; numara+hüküm (banko/tek) eşleşmeleri korunur.
  const perRace=new Map();for(const m of out){if(!perRace.has(m.ri))perRace.set(m.ri,[]);perRace.get(m.ri).push(m);}
  const dropped=new Set();
  for(const [ri,list] of perRace){const race=list[0].race;const active=(race.horses||[]).filter(h=>!xHorseIsNonRunner(h)).length;
   const coupon=list.filter(m=>m.structuredCoupon||m.matchType==='name');
   if(active>=5&&coupon.length>=Math.max(5,Math.ceil(active*0.8))){coupon.forEach(m=>dropped.add(m));}}
  return dropped.size?out.filter(m=>!dropped.has(m)):out;
 }
 function trustScore(post,match,allPosts,handles,statement,context={}){
  const handle=String(post.author||'').toLowerCase(),trusted=handles.some(x=>String(x).replace(/^@/,'').toLowerCase()===handle);
  const base=trusted?75:55,hist=context.historyCache?.has(handle)?context.historyCache.get(handle):sourceHistory(handle),statementScore=statement.strong?95:72;
  context.historyCache?.set(handle,hist);
  const corroborated=allPosts.some(p=>p!==post&&String(p.author||'').toLowerCase()!==handle&&(context.mentionsByPost?.get(p)||[]).some(m=>{
   if(m.ri!==match.ri||noOf(m.h)!==noOf(match.h))return false;
   const other=sentiment(m.mentionText||p.text)||(m.structuredCoupon?{direction:1}:null);
   return other?.direction===statement.direction;
  }));
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
  // Shadow X puanı tahmine dokunmadan kanıt gücünü 1..8 aralığında (V1.1.337: tavan 6'dan 8'e) daha okunur
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
  let magnitude=weightedScore<60?1:weightedScore<68?2:weightedScore<76?3:weightedScore<84?4:weightedScore<90?5:weightedScore<94?6:weightedScore<97?7:8;
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
  return Math.max(1,Math.min(8,magnitude))*direction;
 }
 function xHorseIsNonRunner(h){
  if(typeof isNonRunner==='function') return !!isNonRunner(h);
  const raw=String(h?.status||h?.runner_status||h?.note||'').toUpperCase();
  return Number(h?.non_runner)===1 || Number(h?.is_non_runner)===1 || /KOŞMAZ|KOSMAZ|NON.?RUNNER|SCRATCH/.test(raw);
 }
 function* applyPayloadSteps(payload,{mode='live',racesOverride=null}={}){
  const rows=typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults)?lastRaceResults:[];
  const races=Array.isArray(racesOverride)&&racesOverride.length?racesOverride:predictionRaces();
  const payloadSchema=Number(payload?.schemaVersion)||0,payloadCutoff=Date.parse(String(payload?.raceStartAt||'')),payloadCaptured=Date.parse(String(payload?.capturedAt||''));
  // V1.1.336 (kullanıcı talebi): TKP_X_APPLY_LATE_POSTS açıkken yarış-başlangıç zaman
  // koşulları (captured>=cutoff ve 36 saatten eski) payload'ı reddetmez; yalnız şema ve
  // geçerli tarih kontrolleri korunur. Kapalıyken eski güvenli davranış aynen geçerli.
  const strictBlocked=(mode==='live'||mode==='shadow')&&(payloadSchema<3||!Number.isFinite(payloadCutoff)||!Number.isFinite(payloadCaptured)||(!TKP_X_APPLY_LATE_POSTS&&(payloadCaptured>=payloadCutoff||payloadCaptured<payloadCutoff-36*60*60_000)));
  const rawPosts=(Array.isArray(payload?.posts)?payload.posts:[]).flatMap(post=>[
   ...(post?.text?[post]:[]),
   ...(payloadSchema>=6&&Array.isArray(post?.imageEvidence)?post.imageEvidence:[])
    .filter(image=>image?.verified===true&&Number(image.verifiedRows)>0&&typeof image.text==='string')
    .map(image=>({...post,text:image.text,imageEvidence:undefined,evidenceKind:'image_ocr',imageUrl:image.imageUrl,couponColumn:image.couponColumn}))
  ]);
  // Kanıtı geçersiz canlı paket, mevcut güvenli X katmanını dahi sıfırlamadan
  // tamamen reddedilir. Böylece eski şema çağrısı aynı oturumda yan etki bırakamaz.
  if(strictBlocked)return {mode,posts:0,matched:0,blockedReason:'invalid_or_late_time_proof',results:[]};
  const quality={received:rawPosts.length,accepted:0,duplicates:0,rejected:0},seenPosts=new Set();
  const posts=rawPosts.filter(post=>{
   const author=String(post?.author||'').replace(/^@/,'').toLowerCase();
   const link=String(post?.url||'').match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:(\w{1,15})\/status|i\/web\/status)\/(\d+)(?:[/?#]|$)/i);
   if(!/^[a-z0-9_]{1,15}$/.test(author)||!link||(link[1]&&link[1].toLowerCase()!==author)||!postAllowed(post,payload,races,mode)){quality.rejected++;return false;}
   const key=[link[2],post.evidenceKind||'text',post.evidenceKind==='image_ocr'?String(post.imageUrl||'')+'|'+String(post.couponColumn||''):'' ].join('|');
   if(seenPosts.has(key)){quality.duplicates++;return false;}seenPosts.add(key);quality.accepted++;return true;
  }),handles=Array.isArray(payload?.handles)?payload.handles:[];
  const results=[],applied=new Map();
  const historyCache=new Map(),mentionsByPost=new Map();
  const scoreContext={historyCache,mentionsByPost};let processed=0,sliceStarted=Date.now();
  // Reuse exact, time-scoped matches for corroboration as well as direct evidence.
  for(const post of posts){mentionsByPost.set(post,exactMentions(post,races,payload,mode));if(++processed%8===0&&(processed===8||Date.now()-sliceStarted>=8)){yield;sliceStarted=Date.now();}}
  processed=0;sliceStarted=Date.now();
  // Aynı at için önceki taramada oluşan daha yüksek güven korunur; sonraki tarama yalnız daha güçlü kanıt varsa değeri yükseltebilir.
  const previousScores=new Map();
  try{const prevLast=getSettings()?.x_kulis_last||{},sameContext=(!prevLast.date||!races[0]?.race_date||String(prevLast.date)===String(races[0].race_date))&&(!prevLast.hippodrome||!races[0]?.hippodrome||trFold(prevLast.hippodrome)===trFold(races[0].hippodrome));if(sameContext)for(const x of (prevLast.results||[])){const k=String(x?.leg||'')+'|'+String(x?.no||'');const sc=Number(x?.score);if(k&&Number.isFinite(sc))previousScores.set(k,{score:sc,direction:String(x?.direction||'')});}}catch(_e){}

  races.forEach((race,ri)=>{if(!raceIsEligible(payload,race,ri,mode))return;const scoreEntry=scoreEntryForRace(race,ri);const order=(scoreEntry?.scored||race.horses||[]).map(x=>x.h||x);for(const h of (race.horses||[])){if(xHorseIsNonRunner(h)){h.x_ypuan_delta=0;h.x_tkp_score_delta=0;h.x_kulis_score=0;h.x_kulis_comments=[];h.x_kulis_single_candidate=false;h.x_force_coupon=false;h.x_break_single=false;continue;}const oi=order.findIndex(x=>noOf(x)===noOf(h)||trFold(nameOf(x))===trFold(nameOf(h))),ranked=oi>=0?order[oi]:h,raw=ranked?.ypuan??h?.ypuan,rawScore=ranked?.score??h?.score;if(h.x_base_ypuan==null)h.x_base_ypuan=raw!==null&&raw!==''&&Number.isFinite(Number(raw))?Number(raw):null;if(h.x_base_score==null)h.x_base_score=rawScore!==null&&rawScore!==''&&Number.isFinite(Number(rawScore))?Number(rawScore):null;if(h.x_base_rank==null)h.x_base_rank=oi>=0?oi+1:null;h.x_ypuan_delta=0;h.x_tkp_score_delta=0;h.x_kulis_score=0;h.x_kulis_comments=[];h.x_kulis_single_candidate=false;h.x_force_coupon=false;h.x_break_single=false;h.x_kulis_schema_version=payloadSchema;h.x_kulis_captured_at=String(payload?.capturedAt||'');h.x_kulis_race_start_at=String((payload?.raceStartMap||{})[String(raceLeg(race,ri))]||payload?.raceStartAt||'');h.x_kulis_training_eligible=false;h.x_kulis_provenance=mode==='historical'?'historical_verified':'live_or_shadow';}});
  for(const post of posts){if(++processed%8===0&&(processed===8||Date.now()-sliceStarted>=8)){yield;sliceStarted=Date.now();}for(const m of mentionsByPost.get(post)||[]){if(xHorseIsNonRunner(m.h))continue;const stated=sentiment(m.mentionText||post.text),couponOnly=!stated&&m.structuredCoupon,st=stated||(couponOnly?{direction:1,strong:false,folded:trFold(m.mentionText)}:null);if(!st)continue;
   const horseFold=trFold(nameOf(m.h)),score=trustScore(post,{...m,horseFold},posts,handles,st,scoreContext),key=`${m.ri}|${noOf(m.h)}`;
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
   if(strongEnough||learnedEnough||softEnough||couponConsensusEnough){let yDelta=0;if(strongEnough)yDelta=deltaFor(score,st.direction);else if(learnedEnough){const next=Math.max(-3,Math.min(3,item.learnedDelta+1*st.direction));yDelta=next-item.learnedDelta;item.learnedDelta=next;}else if(softEnough){item.softAuthors.push(authorKey);const softTotal=Math.max(-2,Math.min(2,(Number(item.softDelta)||0)+1*st.direction));yDelta=softTotal-(Number(item.softDelta)||0);item.softDelta=softTotal;}else if(couponConsensusEnough){yDelta=1;item.couponConsensusApplied=true;}if(baseAvailable)item.delta=Math.max(-8,Math.min(8,item.delta+yDelta));else item.tkpScoreDelta=Math.max(-.12,Math.min(.12,item.tkpScoreDelta+yDelta*.015));appliedNow=Boolean(yDelta);}
   // Tahmin kuponunda aynı ayakla açıkça yazılan at, "banko" sözcüsü yoksa da
   // gerçek bir X seçimi sayılır. Shadow modunda bu yalnız görünür +1 kanıtına
   // dönüşür; canlı modda tek başına kuponu/sıralamayı değiştiremez.
   if(mode!=='live'&&couponOnly&&!appliedNow&&payloadSchema>=3) appliedNow=true;
   item.direction=st.direction>=0?'positive':'negative';const prev=previousScores.get(key);if(prev&&prev.direction===item.direction&&Number(prev.score)>Number(item.score))item.score=Number(prev.score);item.score=Math.max(item.score,score);item.comments.push({author:post.author,text:post.text,datetime:post.datetime,url:post.url,evidenceKind:post.evidenceKind||'text',imageUrl:post.imageUrl||'',score,match:m.match,matchType:m.matchType,direction:st.direction,couponOnly,strongEnough,learnedEnough,bootstrapEnough,applied:appliedNow});applied.set(key,item);
  }}
  // V1.1.337 (kullanıcı talebi): ayak içi ayrım. Gölge modda aynı ayakta çoğu at +4'e yığılıyordu
  // (geniş kupon sütunları). Her atın desteği = bağımsız hesapların en iyi yorum kalitesi toplamı;
  // ayak lideriyle kıyaslanır. Lider (>=3 hesap) +1, desteği liderin yarısından azı -1, %30'dan azı -2.
  const shadowSupport=new Map(),legMaxSupport=new Map();
  if(mode!=='live'){for(const item of applied.values()){const best=new Map();for(const c of (item.comments||[])){if(Number(c?.score)<55)continue;const au=String(c?.author||'').toLowerCase();const q=Math.max(.2,(Number(c.score)-50)/50);if(!best.has(au)||best.get(au)<q)best.set(au,q);}
   const sup=[...best.values()].reduce((x,y)=>x+y,0);shadowSupport.set(item,{sup,authors:best.size});legMaxSupport.set(item.raceIndex,Math.max(legMaxSupport.get(item.raceIndex)||0,sup));}}
  for(const item of applied.values()){
   // Shadow modunda ekranda görülen +puan tekdüze 1/2 olmasın: güven, bağımsız kaynak
   // sayısı ve güçlü ifade birlikteliğinden 1..6 arası kanıt puanı üret. Tahmine uygulanmaz.
   if(mode!=='live'&&item.baseAvailable){item.delta=shadowEvidenceDelta(item);
    const sp=shadowSupport.get(item),mx=legMaxSupport.get(item.raceIndex)||0;
    if(sp&&mx>0&&item.delta>0){const rel=sp.sup/mx;let adj=0;if(rel>=0.999&&sp.authors>=3)adj=1;else if(rel<0.3)adj=-2;else if(rel<0.5)adj=-1;item.delta=Math.max(1,Math.min(8,item.delta+adj));}}
   // X güveni tahmin puanı değildir: kaynak/metin kanıtını ölçer; shadow modunda
   // sıralama ve kupona uygulanmaz.
   const h=item.horse;h.x_ypuan_delta=item.delta;h.x_tkp_score_delta=item.tkpScoreDelta;h.x_final_ypuan=item.baseAvailable?Math.max(0,Math.round((item.baseYpuan+item.delta)*100)/100):null;h.x_final_tkp_score=item.baseScoreAvailable?Math.max(0,Math.round((item.baseScore+item.tkpScoreDelta)*1000)/1000):null;h.x_kulis_score=item.score;h.x_kulis_direction=item.direction;h.x_kulis_comments=item.comments;h.x_kulis_single_candidate=Boolean(item.direction==='positive'&&Number(item.score)>70&&item.comments.length>=2);
   // Never write h.ypuan / h.score here.  `x_kulis_applied` and the force flags
   // must stay false as well; approved evidence is consumed through the separate
   // Expert-only consensus API, not these raw imported fields.
   h.x_kulis_applied=false;h.x_kulis_training_eligible=false;h.x_kulis_provenance=mode==='historical'?'historical_research_shadow':'governed_shadow';h.x_force_coupon=false;h.x_break_single=false;
   // Governed shadow evidence does not invalidate the base ranking cache.
   item.finalYpuan=h.x_final_ypuan;item.finalTkpScore=h.x_final_tkp_score;item.forceCoupon=h.x_force_coupon;item.breakSingle=h.x_break_single;results.push(item);
  }
  races.forEach((race,ri)=>{if(!raceIsEligible(payload,race,ri,mode))return;const sorted=[...(race.horses||[])].sort((a,b)=>{const ay=a.ypuan!==null&&a.ypuan!==''&&Number.isFinite(Number(a.ypuan)),by=b.ypuan!==null&&b.ypuan!==''&&Number.isFinite(Number(b.ypuan));return ay&&by?Number(b.ypuan)-Number(a.ypuan):(Number(b.score)||0)-(Number(a.score)||0);});sorted.forEach((h,i)=>{h.x_final_rank=i+1;const item=applied.get(`${ri}|${noOf(h)}`);if(item)item.finalRank=i+1;});});
  // Store exact selections in the append-only governance ledger before preserving
  // the small UI preview cache.  Malformed, anonymous, historical or late posts
  // are retained as research/shadow but cannot count toward a live source.
  try{
   let cap=null,err='';
   if(typeof window.tkpCommentatorCaptureX==='function')cap=window.tkpCommentatorCaptureX(payload,races,{mode,results});
   else err='tkpCommentatorCaptureX yok (commentator-performance-engine.js yüklenmedi)';
   // Sessiz yutma yerine son X yakalama sonucu kalıcı tanıya yazılır; Yorumcu Takibi panelinde görünür.
   getSettings().x_capture_diag={at:new Date().toISOString(),mode,posts_received:quality.received,posts_accepted:quality.accepted,posts_rejected:quality.rejected,matched_horses:results.length,
    groups:cap?.groups??0,appended:cap?.appended??0,error:err,
    reason:err||(strictBlocked?'zaman_kanıtı_geçersiz_veya_yarış_başlamış':(!quality.received?'tarama_post_getirmedi (X girişi/ön-yarış tahmini?)':(!quality.accepted?'tüm_postlar_reddedildi (tarih/hipodrom/ayak eşleşmedi)':(!results.length?'post_kabul_edildi_ama_at_eşleşmedi':(cap&&!cap.appended?'kanıt_zaten_kayıtlı_veya_yazar_anonim':'ok')))))};
  }catch(e){
   try{getSettings().x_capture_diag={at:new Date().toISOString(),mode,error:String(e&&e.message||e),reason:'yakalama_hatası'};console.warn('[TKP] X yorumcu yakalama hatası',e);}catch(_){ }
  }
  const contextSignature=races.map((r,i)=>[r?.id||r?.file_id||'',r?.race_date||'',String(r?.hippodrome||'').toLocaleUpperCase('tr-TR'),Number(r?.altili_no)||2,Number(r?.leg)||i+1].join('|')).sort().join(';');
  const settings=getSettings();settings.x_kulis_last={schemaVersion:payloadSchema,contextSignature,capturedAt:payload?.capturedAt||'',raceStartAt:payload?.raceStartAt||'',targetLegs:Array.isArray(payload?.targetLegs)?payload.targetLegs.slice():[],raceStartMap:payload?.raceStartMap||{},date:races[0]?.race_date||'',hippodrome:races[0]?.hippodrome||'',mode,handles,posts:posts.slice(0,180),results:results.map(x=>({...x,horse:undefined}))};
  // Kayıtlı gün açılırken tahmin yarışları clone olabilir. X yalnız clone üzerinde kalırsa
  // ekranı kapatıp yeniden açınca /+puan kaybolur. X alanlarını gerçek db.races kaydına
  // birebir geri yaz ve sonra saveDB ile kalıcılaştır. Shadow olduğunda tahmine etkisi yoktur.
  const persistedXFields=persistXOverlayToStoredRaces(races);
  // R19.47.31: Shadow X tahmini/kuponu değiştirmez. Bu nedenle profile/condition/
  // öğrenme cache'lerini geçersiz kılıp bütün ağır analiz zincirini yeniden başlatmak
  // gereksizdir ve veri alırken ana ekranın kasmasının önemli bir nedenidir.
  // Yalnız gerçekten canlı/uygulanmış modda bu cache'ler kirli sayılır; shadow'da
  // X alanları arka planda kalıcılaştırılır ve görünür hücre delta ile güncellenir.
  try{
   if(mode==='live'){
    if(typeof invalidateProfileMatchCache==='function')invalidateProfileMatchCache();
    if(typeof invalidateConditionStatsCache==='function')invalidateConditionStatsCache();
    if(typeof tkpInvalidateLearningModelCaches==='function')tkpInvalidateLearningModelCaches();
    if(typeof rulesDirty!=='undefined')rulesDirty=true;
   }
   persistXState(true);
  }catch{}
  const appliedCount=0;
  return {mode,posts:posts.length,matched:results.length,applied:appliedCount,blockedReason:'',quality,results};
 }
 function applyPayload(payload,options){const steps=applyPayloadSteps(payload,options);let step;do{step=steps.next();}while(!step.done);return step.value;}
 let asyncApplyQueue=Promise.resolve();
 let xPersistQueued=false,xPersistEvidence=false,xPersistDirty=false,xPersistRetries=0;
 function persistXState(evidence=false,retry=false){
  xPersistDirty=true;if(!retry)xPersistRetries=0;
  xPersistEvidence=xPersistEvidence||evidence;
  if(xPersistQueued)return true;
  if(typeof window.tkpPersistCollections!=='function'||typeof window.tkpPersistTopLevelMetaSoon!=='function'){
   if(typeof saveDB==='function')Promise.resolve(saveDB(false)).catch(()=>{});return false;
  }
  xPersistQueued=true;
  const run=async()=>{
   const writeEvidence=xPersistEvidence;xPersistEvidence=false;xPersistDirty=false;
   let succeeded=false;
   try{
    if(writeEvidence){
     const ok=await window.tkpPersistCollections(['races','commentator_evidence_log'],{metaPatch:{settings:getSettings()},label:'x-evidence-persist'});
     if(!ok)throw Error('X kayıtları kalıcılaştırılamadı');
    }else window.tkpPersistTopLevelMetaSoon({settings:getSettings()},'x-settings-persist');
    succeeded=true;return true;
   }catch(e){xPersistEvidence=xPersistEvidence||writeEvidence;xPersistDirty=true;console.warn('X kayıt yazımı bekliyor',e);return false;}
   finally{
    xPersistQueued=false;
    if(succeeded){xPersistRetries=0;if(xPersistDirty||xPersistEvidence)persistXState(xPersistEvidence);}
    else if(xPersistRetries<2){const delay=3000*(++xPersistRetries);setTimeout(()=>{if(!xPersistQueued&&xPersistDirty)persistXState(xPersistEvidence,true);},delay);}
   }
  };
  if(typeof window.tkpQueueTask==='function')window.tkpQueueTask('x-evidence-persist',run,{priority:'background',replace:true,minIdleMs:700});
  else setTimeout(()=>{void run();},0);
  return true;
 }
 window.tkpPersistXKulisState=persistXState;
 function applyPayloadAsync(payload,options){
  // Keep mutations serialized while allowing input/paint between matching slices.
  const run=async()=>{const steps=applyPayloadSteps(payload,options);let step;do{step=steps.next();if(!step.done)await new Promise(resolve=>setTimeout(resolve,0));}while(!step.done);return step.value;};
  const result=asyncApplyQueue.then(run,run);asyncApplyQueue=result.catch(()=>{});return result;
 }
 function tableHTML(report){
  const reportRows=Array.isArray(report?.results)?report.results:[];
  const archived=report?.mode==='historical'||report?.historicalMode===true;
  const byKey=new Map(reportRows.map(x=>[`${Number(x.leg)||0}|${String(x.no||'')}`,x]));
  const roster=[];
  predictionRaces().forEach((r,ri)=>{const leg=raceLeg(r,ri);(r.horses||[]).forEach(h=>{if(/(?:^|\s)\(KOŞMAZ\)/i.test(String(h?.horse_name||h?.name||'')))return;roster.push({leg,raceNo:raceAbsNo(r,ri),no:noOf(h),name:nameOf(h),horse:h});});});
  const source=roster.length?roster:reportRows.map(x=>({leg:x.leg,no:x.no,name:x.name,horse:null}));
  let found=0,postCount=0,accounts=new Set();
  const rows=source.map(item=>{
    const x=byKey.get(`${Number(item.leg)||0}|${String(item.no||'')}`);
    if(!x){const pending=report?.coveragePending===true;return `<tr class="xNoData"><td>${item.leg}. Ayak</td><td><b>${item.no} ${String(item.name||'')}</b></td><td>—</td><td><b>—</b></td><td>0</td><td>0</td><td>${pending?'Tarama sürüyor':'X eşleşmesi yok'}</td><td class="muted">${pending?'Kalan yorumcu profilleri sonraki turda kontrol edilir.':'Taranan doğrulanmış X kaynaklarında bu at için güvenli yarış-öncesi eşleşme bulunmadı.'}</td></tr>`;}
    found++;
    const comments=Array.isArray(x.comments)?x.comments:[];postCount+=comments.length;comments.forEach(c=>accounts.add(String(c.author||'').toLowerCase()));
    const useTkp=x.baseYpuan==null,realYpuan=useTkp?'-':Number(x.baseYpuan).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}),final=useTkp?`TKP ${Number(x.finalTkpScore??x.baseScore??0).toFixed(2)}`:x.finalYpuan,diff=useTkp?Number(x.tkpScoreDelta||0):Number(x.delta||0),effectText=`${diff>0?'+':''}${useTkp?diff.toFixed(2):diff}`;
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
  return `<div class="xKulisCoverage" style="border:1px solid #94a3b8;border-radius:9px;background:#fff;padding:8px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>𝕏 Günlük Kapsama · ${archived?'ESKİ X VERİSİ · TAHMİNE ETKİ ETMEZ':report?.mode==='live'?(Number(report?.applied)>0?'Tahmine uygulandı':'Veri bulundu · etki yok'):'Gölge test'}</b><span style="font-size:10.5px;color:#475569"><b>${total}/${total}</b> aktif at kontrol edildi · <b>${found}</b> atta X verisi · <b>${missing}</b> veri yok · ${postCount} eşleşen post · ${accounts.size} hesap${scanInfo}</span></div><div style="font-size:10px;color:#64748b;margin-top:3px">Eşleşme yüzdesi kazanma olasılığı değildir. İki doğrulanmış post gölge görünümde en az +2 kanıt verir; gölge X tahmini veya kuponu değiştirmez.</div><div style="overflow:auto;margin-top:6px"><table class="xKulisCompactTable" style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr><th>Ayak</th><th>At</th><th>İlk sıra / Y.PUAN</th><th>X güveni</th><th>Kanıt</th><th>Kaynak</th><th>Y.PUAN+X Etki / Son</th><th>Yorum</th></tr></thead><tbody>${rows||'<tr><td colspan="8">Aktif yarış listesi bulunamadı.</td></tr>'}</tbody></table></div></div>`;
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
 window.tkpApplyXKulisPayload=applyPayload;window.tkpApplyXKulisPayloadAsync=applyPayloadAsync;window.tkpApplyHistoricalXKulisPayload=(payload,races)=>applyPayload(payload,{mode:'historical',racesOverride:races});window.tkpXKulisTableHTML=tableHTML;window.tkpLearnXKulisFromResults=learnFromResults;window.tkpClearXKulisOverlay=clearOverlay;
})();
