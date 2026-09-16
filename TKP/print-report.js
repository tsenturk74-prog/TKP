/* TKP V1.1.225 — V55 canonical üç kuponlu kompakt A4 tahmin bülteni.
   Yazdır akışı yoktur; PDF doğrudan indirilir. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const N=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const val=(h,keys)=>{for(const k of keys){const v=h?.[k];if(v!==null&&v!==undefined&&String(v).trim()!=='')return v;}return '';};
  const rank=(h,keys,max)=>{const n=N(val(h,keys));return n&&n>=1&&n<=max?String(Math.trunc(n)):'-';};
  const _tkpA4SectionCache=new Map();
  function tkpA4SectionKey(kind,results){
    const perf=typeof tkpPerformanceSignature==='function'?tkpPerformanceSignature():`${(db?.files||[]).length}|${(db?.races||[]).length}`;
    const raceSig=typeof tkpRaceResultsSignature==='function'?tkpRaceResultsSignature(results):(results||[]).map(x=>`${x?.r?.id||''}:${x?.r?.leg||''}`).join('|');
    const couponSig=typeof tkpCouponStateSignature==='function'?tkpCouponStateSignature():'';
    return `A4SEC2|${kind}|${perf}|${raceSig}|${couponSig}`;
  }
  function tkpA4SectionGet(key){const hit=_tkpA4SectionCache.get(key);if(hit!==undefined){_tkpA4SectionCache.delete(key);_tkpA4SectionCache.set(key,hit);}return hit;}
  function tkpA4SectionSet(key,value){_tkpA4SectionCache.set(key,value);while(_tkpA4SectionCache.size>18)_tkpA4SectionCache.delete(_tkpA4SectionCache.keys().next().value);return value;}
  const f2=v=>{const n=N(v);return n===null?'-':n.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:2});};
  function accurateSpeedText(h,r){
    let mps=N(h?.accurate_avg_speed_mps);
    if(!(mps>0)){
      const sec=N(h?.accurate_finish_time_sec),distance=N(r?.distance);
      if(sec>0&&distance>0)mps=distance/sec;
    }
    return mps>0?`${f2(mps*3.6)} km/sa`:'-';
  }
  function gprText(h,r){try{if(typeof pastWinCellHTML==='function'){const d=document.createElement('div');d.innerHTML=pastWinCellHTML(h,r);return d.textContent.trim()||'-';}}catch(_e){}return String(val(h,['gpr_display','gpr','past_win_display'])||'-');}
  function gprPrintClass(text){const wins=Number(String(text||'').split('/')[0])||0;return wins>=4?'gpr4':wins===3?'gpr3':wins===2?'gpr2':wins===1?'gpr1':'';}
  function archivedPdfYpuan(r,h){
    // Sonuçtan sonra aynı yarış yeniden veri topladığında Y.PUAN değişebilir. Eski
    // yarış PDF'i, yarış öncesinde prediction_log'a ilk kaydedilen değeri gösterir.
    // Böylece sonuç yalnız derece/renk ekler; geçmiş analiz verisini değiştirmez.
    const rows=(typeof db!=='undefined'&&Array.isArray(db?.prediction_log))?db.prediction_log:[];
    if(!rows.length)return undefined;
    const file=(db?.files||[]).find(f=>String(f.id)===String(r?.file_id));
    const date=String(r?.race_date||'');
    const hip=typeof fold==='function'?fold(r?.hippodrome||''):String(r?.hippodrome||'').toUpperCase();
    const alt=Number(r?.altili_no)||Number(file?.altili_no)||1;
    const leg=String(r?.leg||'');
    const no=String(h?.horse_no||'');
    const name=typeof fold==='function'?fold(h?.horse_name||''):String(h?.horse_name||'').toUpperCase();
    const candidates=rows.filter(rec=>
      (!String(rec?.race_date||'')||!date||String(rec.race_date)===date) &&
      (typeof fold==='function'?fold(rec?.hippodrome||''):String(rec?.hippodrome||'').toUpperCase())===hip &&
      (Number(rec?.altili_no)||1)===alt && String(rec?.leg||'')===leg
    );
    const exactNo=candidates.filter(rec=>String(rec?.horse_no||'')===no);
    const exactName=candidates.filter(rec=>(typeof fold==='function'?fold(rec?.horse_name||''):String(rec?.horse_name||'').toUpperCase())===name);
    const record=(exactNo.length?exactNo:exactName).slice().sort((a,b)=>String(a?.ts||'').localeCompare(String(b?.ts||'')))[0];
    if(!record||record.ypuan===null||record.ypuan===undefined||record.ypuan==='')return undefined;
    const score=N(record.ypuan);
    return score===null?undefined:score;
  }
  function pdfLegContext(x){
    const race=x?.r;
    const confirmed=typeof raceHasConfirmedResult==='function'
      ? raceHasConfirmedResult(race?.horses||[])
      : (race?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)>=1);
    if(!confirmed)return x;
    const clones=new Map();
    const cloneHorse=h=>{
      const key=String(h?.horse_no||'');
      let copy=clones.get(key);
      if(!copy){copy={...h};clones.set(key,copy);}else Object.assign(copy,h);
      const archived=archivedPdfYpuan(race,h);
      if(archived!==undefined)copy.ypuan=archived;
      return copy;
    };
    const horses=(race?.horses||[]).map(cloneHorse);
    const scored=(x?.scored||race?.horses||[]).map(cloneHorse);
    return {...x,r:{...race,horses},scored};
  }
  function raceRows(x){
    // A4 Ana Tahminler ve Ayak Verileri aynı saf TKP sırasını kullanır. Varsayılan
    // stratejik/snapshot sırası burada kullanılırsa özet ilk 5 ile ayak tablosu
    // farklı görünebiliyordu (İstanbul 1. ayak 15 İLKUTHAN örneği).
    const source=(typeof predictionDisplayRows==='function')
      ? predictionDisplayRows({r:x.r,scored:x.scored||x.r?.horses||[]},Infinity,'score-desc').rows
      : (x.scored||x.r?.horses||[]);
    return (source||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
  }
  function pickedNosForRace(leg){
    const out=new Set();
    try{for(const c of Object.values(activeCoupons||{})){for(const x of c?.legs||[]){if(Number(x.r?.leg)===Number(leg))for(const p of x.picks||[])out.add(String(p.horse_no));}}}catch(_e){}
    return out;
  }
  function couponTable(c,title){
    if(!c||c.error)return `<div class="coupon"><h3>${E(title)}</h3><div class="muted">${E(c?.error||'Kupon henüz oluşturulmadı')}</div></div>`;
    const rows=(c.legs||[]).slice().sort((a,b)=>Number(a.r?.leg)-Number(b.r?.leg)).map(x=>{
      const order=typeof tkpCouponRoleDisplayOrder==='function'?tkpCouponRoleDisplayOrder(x,c.typeKey):x.picks||[];
      const ranks=new Map(order.map((h,i)=>[String(h.horse_no),i]));
      const picks=(x.picks||[]).slice().sort((a,b)=>(ranks.get(String(a.horse_no))??999)-(ranks.get(String(b.horse_no))??999));
      return `<tr><td>${E(x.r?.leg)}.</td><td>${picks.map(p=>E(p.horse_no)).join(' / ')||'-'}</td></tr>`;
    }).join('');
    return `<div class="coupon"><h3>${E(title)}</h3><table><tbody>${rows}</tbody></table><div class="couponFoot">Maliyet: ${f2(c.cost)} TL</div></div>`;
  }
  function bombHunterPrintSection(results){
    const cards=(results||[]).map(x=>{
      const r=x?.r||x; if(!r)return '';
      let candidates=[];
      try{
        const key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(r):'';
        const log=(typeof db!=='undefined'&&Array.isArray(db?.bomb_hunter_shadow_log))?db.bomb_hunter_shadow_log:[];
        const frozen=key?log.find(z=>z?.race_key===key):null;
        if(frozen?.candidates?.length) candidates=frozen.candidates.slice();
        else {
          const resultKnown=(r.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
          if(!resultKnown && typeof tkpBombHunterCandidates==='function') candidates=tkpBombHunterCandidates(r).map((z,i)=>({rank:i+1,horse_no:String(z.h?.horse_no||''),horse_name:z.h?.horse_name||'',score:Number(z.score)||0,reasons:z.reasons||[]}));
        }
      }catch(_e){}
      if(!candidates.length)return '';
      const rows=candidates.map((c,index)=>{const kind=String(c?.kind||'').toUpperCase()==='ODB'?'ODB1':`BH${Math.max(1,Number(c?.category_rank)||index+1)}`;return `<span class="bhPrintChip"><b>${E(kind)} · ${E(c.horse_no)} ${E(c.horse_name)}</b><em>BH ${f2((Number(c.score)||0)*100)}</em></span>`;}).join('');
      return `<div class="bhPrintLeg"><h3>${E(r.leg)}. AYAK</h3><div class="bhPrintPicks">${rows}</div></div>`;
    }).filter(Boolean).join('');
    return cards?`<section class="bhPrint"><h2>Bomba Avcısı</h2><div class="bhPrintGrid">${cards}</div></section>`:'';
  }
  function topPredictionTable(results){
    const rows=(results||[]).map(x=>{
      const arr=raceRows(x); const top=arr[0];
      const top5=arr.slice(0,5).map(h=>`${E(h.horse_no)} ${E(h.horse_name)}`).join(' · ');
      const raceHorses=x.r?.horses||[];
      const resultKnown=typeof raceHasConfirmedResult==='function'
        ? raceHasConfirmedResult(raceHorses)
        : raceHorses.some(h=>Number(h.winner)===1||Number(h.finish_position)===1);
      const winner=raceHorses.find(h=>Number(h.winner)===1)||raceHorses.find(h=>Number(h.finish_position)===1);
      const predictedFinish=top&&resultKnown
        ? (Number(top.finish_position)>=1&&Number(top.finish_position)<=5?`${Math.trunc(Number(top.finish_position))}. geldi`:'ilk 5 dışında')
        : '';
      const actual=resultKnown
        ? `<b>Kazanan: ${winner?E(winner.horse_no)+' '+E(winner.horse_name):'-'}</b>${top?`<small>${E(top.horse_no)}: ${E(predictedFinish)}</small>`:''}`
        : '<span class="muted">Bekleniyor</span>';
      const gpr=top?gprText(top,x.r):'-';
      const profile=top&&typeof profileStrengthPct==='function'?profileStrengthPct(x.r,top):null;
      const speed=top?accurateSpeedText(top,x.r):'-';
      const xDelta=N(top?.x_ypuan_delta);
      const xEffect=xDelta!==null&&xDelta!==0?`${xDelta>0?'+':''}${f2(xDelta)}`:'-';
      let decision=null;try{decision=top&&typeof dynamicSingleDecision==='function'?dynamicSingleDecision(x,top):null;}catch(_e){}
      const tek=decision?`${decision.isSingle?'TEK':'ÇOKLU'} %${Math.round(Number(decision.confidence)||0)}`:'-';
      const displayTkp=top&&typeof tkpRaceVisibleDisplayScore==='function'?tkpRaceVisibleDisplayScore(x.r,top):(top&&typeof tkpVisibleDisplayScore==='function'?tkpVisibleDisplayScore(top):N(top?.tkp_display_score??top?.score));
      const strong=top&&Number(displayTkp)>1.40?' tkpStrong':'';
      return `<tr><td>${E(x.r?.leg)}. Ayak</td><td><b>${top?E(top.horse_no)+' '+E(top.horse_name):'-'}</b></td><td class="${strong}">${top&&displayTkp!=null?f2(displayTkp):'-'}</td><td class="${gprPrintClass(gpr)}">${E(gpr)}</td><td>${profile===null?'-':'%'+f2(profile)}</td><td class="accurateSpeed">${E(speed)}</td><td class="xEffect ${xDelta!==null&&xDelta<0?'xNeg':xDelta!==null&&xDelta>0?'xPos':''}">${E(xEffect)}</td><td>${E(tek)}</td><td class="small">${top5||'-'}</td><td class="actualResult">${actual}</td></tr>`;
    }).join('');
    return `<section><h2>Ana Tahminler · Güncel Karar Özeti</h2><table class="mainPred"><thead><tr><th>Ayak</th><th>1. Aday</th><th>TKP</th><th>G.PR</th><th>Profil</th><th>HIZ</th><th>X Etkisi</th><th>Karar</th><th>İlk 5</th><th>Gerçek Sonuç</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }
  function legCard(x){
    const cacheKey=tkpA4SectionKey('leg-'+String(x?.r?.leg||''),[x]);
    const cached=tkpA4SectionGet(cacheKey);if(cached!==undefined)return cached;
    // Tek kaynak kuralı: A4 ayak tablosu kendi satır/sütun HTML'ini üretmez.
    // Ekrandaki Ayaklar tablosunu oluşturan legTableHTML çalıştırılır ve aynı TABLE
    // düğümü aynen rapora taşınır. Böylece sıra, at numarası/adı, eküri, sonuç sınıfı,
    // 13 sütun, hücre formülleri ve tüm at kapsamı iki ekranda farklılaşamaz.
    if(typeof legTableHTML!=='function') return '<div class="legCard"><div class="muted">Ayak tablosu hazırlanamadı.</div></div>';
    const holder=document.createElement('div');
    // PDF'de eküri ortağına sonuç rengi kopyalanmaz: yalnız resmi olarak dereceye
    // giren atın kendi finish_position/winner kaydı işaretlenir.
    holder.innerHTML=legTableHTML(pdfLegContext(x),{directResultOnly:true});
    const legHtml=String(holder.innerHTML||'');
    const sourceTable=typeof holder.querySelector==='function'?holder.querySelector('.proPredTable table'):null;
    // Test/başsız DOM ortamında querySelector bulunmayabilir. A4 çıktısını boş bırakmak
    // yerine ekranın ürettiği aynı TABLE HTML'ini doğrudan taşı. Gerçek tarayıcıda normal
    // DOM yolu kullanılır; bu yalnız güvenli fallback'tir.
    let sourceTableHtml=sourceTable?.outerHTML||'';
    if(!sourceTableHtml){
      const m=String(legHtml||'').match(/<table\b[\s\S]*?<\/table>/i);
      sourceTableHtml=m?.[0]||'';
    }
    if(!sourceTableHtml) return '<div class="legCard"><div class="muted">Ayak tablosu hazırlanamadı.</div></div>';
    const tjkTime=String(x.r?.tjk_race_time||'').trim();
    const info=[tjkTime?`⏱ ${tjkTime}`:'⏱ Saat yok',x.r?.condition_family,x.r?.distance?x.r.distance+' m':'',x.r?.surface].filter(Boolean).join(' · ');
    return tkpA4SectionSet(cacheKey,`<div class="legCard"><h3>${E(x.r?.leg)}. AYAK <span>${E(info)}</span></h3>${sourceTableHtml}</div>`);
  }
  function sideBetSummary(results,prebuiltHtml=''){
    const cacheKey=tkpA4SectionKey('sidebets',results);
    const cached=tkpA4SectionGet(cacheKey);if(cached!==undefined)return cached;
    if(typeof sideBetPanelHTML!=='function')return '<div class="muted">Yan bahis motoru hazır değil.</div>';
    let html=String(prebuiltHtml||'');
    if(!html){ try{html=sideBetPanelHTML(results||[]);}catch(e){return `<div class="muted">Yan bahis hazırlanamadı: ${E(e.message)}</div>`;} }
    const box=document.createElement('div');box.innerHTML=html;
    const raceCards=[...box.querySelectorAll('.sideBetRaceCard')];
    const blocks=[];
    for(const rc of raceCards){
      const raceTitle=rc.querySelector('.sideBetRaceHead h3')?.textContent?.trim()||'Ayak';
      const gameGroups=new Map();
      const gameType=title=>{
        const definitions=[
          {pattern:/^Çifte(?=\s|·|$)/i,label:'ÇİFTE',className:'gameCifte'},
          {pattern:/^Sıralı İkili(?=\s|·|$)/i,label:'SIRALI İKİLİ',className:'gameIkili'},
          {pattern:/^Sıralı Üçlü(?=\s|·|$)/i,label:'SIRALI ÜÇLÜ',className:'gameUclu'},
          {pattern:/^(?:Dörtlü\s*\/\s*Tabela|Tabela\s*\/\s*Dörtlü|Dörtlü|Tabela)(?=\s|·|$)/i,label:'DÖRTLÜ / TABELA',className:'gameDortlu'},
          {pattern:/^Sıralı 5\s*[\'’]?li(?:\s+Bahis)?(?=\s|·|$)/i,label:"SIRALI 5'Lİ",className:'gameBesli'}
        ];
        const found=definitions.find(item=>item.pattern.test(title));
        if(!found)return {label:'DİĞER',className:'gameOther',variant:title};
        return {...found,variant:title.replace(found.pattern,'').replace(/^[\s·:\/-]+/,'').trim()||'Öneri'};
      };
      for(const bc of rc.querySelectorAll('.sideBetTicketCard')){
        const title=bc.querySelector('.sideBetTicketHead h4')?.textContent?.trim(); if(!title)continue;
        // PDF'de 1./2./3. konum etiketlerini ayrı sütunlar halinde tekrarlamak yerine
        // oyun dizilimini standart kupon gösterimiyle yaz: aynı konumdaki atlar "-",
        // sonraki konum "/". Örnek: 1-5/2-3-4/3-5-6/7-8.
        const positionGroups=[...bc.querySelectorAll('.sideBetPoolRow')].map(pr=>
          [...pr.querySelectorAll('.sideBetHorseNo')].map(n=>n.textContent.trim()).filter(Boolean).join('-')
        );
        // At havuzu oluşmayan/oynanamayan kartlar PDF'de boş oyun satırı üretmesin.
        if(!positionGroups.length||positionGroups.some(group=>!group))continue;
        const pools=positionGroups.join(' / ');
        const cost=bc.querySelector('.sideBetCost')?.textContent?.trim()||'';
        const type=gameType(title);
        if(!gameGroups.has(type.label))gameGroups.set(type.label,{...type,bets:[]});
        gameGroups.get(type.label).bets.push(`<div class="bet"><b>${E(type.variant)}</b><span>${E(pools)}</span><em>${E(cost)}</em></div>`);
      }
      const games=[...gameGroups.values()].filter(group=>group.bets.length).map(group=>
        `<div class="gameGroup ${group.className}"><div class="gameTypeHead">${E(group.label)}</div>${group.bets.join('')}</div>`
      ).join('');
      if(games)blocks.push(`<div class="sideRace"><h3>${E(raceTitle)}</h3>${games}</div>`);
    }
    if(!blocks.length){
      // Başsız/test DOM'unda querySelectorAll yoksa mevcut yan-bahis HTML'ini kaybetme.
      // Gerçek tarayıcıda üstteki dönüştürülmüş, kompakt PDF yolu aynen çalışır.
      if(String(html||'').trim()) return tkpA4SectionSet(cacheKey,`<div class="sideFallback">${html}</div>`);
      return '<div class="muted">Yan bahis kuponu bulunamadı.</div>';
    }
    return tkpA4SectionSet(cacheKey,`<div class="sideCol">${blocks.join('')}</div>`);
  }
  async function sideBetSummaryAsyncUnshared(results){
    const cacheKey=tkpA4SectionKey('sidebets',results);
    const cached=tkpA4SectionGet(cacheKey);if(cached!==undefined)return cached;
    if(typeof tkpYield==='function') await tkpYield(); else await new Promise(resolve=>setTimeout(resolve,0));
    let html='';
    try{
      if(typeof tkpGetSideBetPanelHTMLAsync==='function') html=await tkpGetSideBetPanelHTMLAsync(results||[]);
      else if(typeof tkpArchivedSideBetPanelHTMLAsync==='function') html=await tkpArchivedSideBetPanelHTMLAsync(results||[]);
      else if(typeof sideBetPanelHTMLAsync==='function') html=await sideBetPanelHTMLAsync(results||[]);
      else if(typeof sideBetPanelHTML==='function') html=sideBetPanelHTML(results||[]);
    }catch(e){return `<div class="muted">Yan bahis hazırlanamadı: ${E(e.message)}</div>`;}
    if(typeof tkpYield==='function') await tkpYield();
    return sideBetSummary(results,html);
  }
  let _tkpSideBetSummaryPromise=null;
  async function sideBetSummaryAsync(results){
    const cacheKey=tkpA4SectionKey('sidebets',results);
    const cached=tkpA4SectionGet(cacheKey);if(cached!==undefined)return cached;
    if(_tkpSideBetSummaryPromise)return _tkpSideBetSummaryPromise;
    _tkpSideBetSummaryPromise=sideBetSummaryAsyncUnshared(results).finally(()=>{_tkpSideBetSummaryPromise=null;});
    return _tkpSideBetSummaryPromise;
  }
  // R18.6.1 — A4 salt-okunur snapshot yolu. PDF düğmesi yan bahis/model
  // hesabını ASLA başlatmaz; ekranda/RAM'de veya kalıcı UI cache'inde hazır olan
  // paneli kullanır. Hazır snapshot yoksa bunu açıkça yazar ve kullanıcı arayüzünü
  // 20+ saniyelik sideBet hesap zincirine sokmaz.
  async function sideBetSummarySnapshotOnlyAsync(results){
    const cacheKey=tkpA4SectionKey('sidebets',results);
    const sectionCached=tkpA4SectionGet(cacheKey);if(sectionCached!==undefined)return sectionCached;
    let html='';
    try{
      if(typeof tkpGetSideBetPanelHTMLCached==='function') html=tkpGetSideBetPanelHTMLCached(results||[])||'';
      if(!html && typeof document!=='undefined'){
        const visible=document.querySelector?.('#predictionResult .sideBetPanel, .predLegPane[data-predpane="stats"] .sideBetPanel');
        if(visible?.outerHTML) html=visible.outerHTML;
      }
      if(!html && typeof tkpSideBetPanelCacheKey==='function' && typeof tkpReadPersistentSideBet==='function'){
        const key=tkpSideBetPanelCacheKey(results||[]);
        html=await tkpReadPersistentSideBet(key)||'';
      }
    }catch(_e){html='';}
    if(!String(html||'').trim()){
      return tkpA4SectionSet(cacheKey,'<div class="muted">Yan bahis/Oyun Portföyü snapshotı henüz hazır değil. A4 bu ekranda yeniden hesaplama yapmaz.</div>');
    }
    return tkpA4SectionSet(cacheKey,sideBetSummary(results,html));
  }
  function header(results){
    const r=results?.[0]?.r||{}; const p=window.__lastPredictionPayload||{};
    const date=r.race_date||p.file?.race_date||''; const hip=r.hippodrome||p.file?.hippodrome||''; const alt=r.altili_no||p.file?.altili_no||2;
    return `<header><div><h1>TKP Tahmin Bülteni</h1><p>${E(date)} · ${E(hip)} · ${E(alt)}. Altılı</p></div><div class="stamp">${new Date().toLocaleString('tr-TR')}</div></header>`;
  }
  function couponLegRaceIds(coupon){
    return (coupon?.legs||[]).map(l=>String(l?.r?.id ?? `${l?.r?.race_date}|${l?.r?.hippodrome}|${l?.r?.leg}`)).sort().join(',');
  }
  function couponMatchesResults(coupon,results){
    if(!coupon || coupon.error || !Array.isArray(coupon.legs) || !coupon.legs.length) return false;
    const resultIds=(results||[]).map(x=>String(x?.r?.id ?? `${x?.r?.race_date}|${x?.r?.hippodrome}|${x?.r?.leg}`)).sort().join(',');
    return couponLegRaceIds(coupon)===resultIds;
  }
  function buildReport(){
    const button=$('tkpPrintA4');
    if(button&&typeof window.tkpRunButtonTask==='function'){
      return window.tkpRunButtonTask(button,'working',()=>buildReportAsync({managedButton:true}),{silent:true,actionName:'A4 oyun föyü',actionBudgetMs:15000,safetyTimeoutMs:15000,timeoutDetail:'A4 föy arka planda hazırlanıyor',doneDetail:'PDF indirildi',errorDetail:'A4 föy oluşturulamadı'});
    }
    const started=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    let actionError=null;
    return Promise.resolve(buildReportAsync()).catch(error=>{actionError=error;throw error;}).finally(()=>{
      try{if(typeof tkpRecordAction==='function')tkpRecordAction('A4 oyun föyü',started,actionError,{budgetMs:15000});}catch(_e){}
    });
  }
  async function buildReportAsync({managedButton=false}={}){
    const htmlStarted=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const results=(Array.isArray(lastRaceResults)?lastRaceResults:[]).map(x=>globalThis.TKP_RESULT_VIEW?.leg(x)||x);
    if(!results.length){alert('Önce tahmini yükle/hesapla.');return;}
    // V1.1.329 ROCKET: kullanıcı tıklamasını önce boya, hesaplamayı sonraki
    // event-loop turuna bırak. Ayak tablolarındaki hızlı UI deseni PDF'e de uygulanır.
    const btn=$('tkpPrintA4'); const oldText=btn?.textContent;
    if(btn&&!managedButton){btn.disabled=true;btn.textContent='⏳ PDF hazırlanıyor…';}
    if(typeof tkpYield==='function') await tkpYield(); else await new Promise(resolve=>setTimeout(resolve,0));
    // Printing is read-only. Never rebuild/replace the visible coupons here.
    const printCoupons=Object.fromEntries(['main','alt','surprise'].map(role=>[role,
      couponMatchesResults(activeCoupons?.[role],results)?activeCoupons[role]:{error:'Bu toplantının kuponu hazır değil; Tahmin ekranında kupon oluştur.'}]));
    // A4 sıra kilidi: kupon + ana karar özetinden sonra önce AYAK TABLOLARI,
    // en sonda YAN BAHİSLER gelir. Böylece PDF akışı ekrandaki inceleme mantığıyla
    // uyumlu olur ve yan bahisler ayak verilerinin önüne geçip görüntü kirliliği yapmaz.
    const normalPrint=printCoupons.main;
    const normalTitle='Normal';
    const page1=`<div class="page summaryPage">${header(results)}<section><h2>Ana Kuponlar</h2><div class="couponGrid">${couponTable(normalPrint,normalTitle)}${couponTable(printCoupons.surprise,'Uzman + Kulis')}${couponTable(printCoupons.alt,'Sürpriz Altılı')}</div></section>${topPredictionTable(results)}${bombHunterPrintSection(results)}</div>`;
    // Ayak tabloları yapay 3+3 sayfa gruplarına bölünmez. Tarayıcının doğal A4 akışı
    // kalan alandan devam eder; bölüm başlığı ilk ayak kartıyla birlikte tutulur.
    const legCards=[];
    for(const item of results){ legCards.push(legCard(item)); if(typeof tkpYield==='function') await tkpYield(); }
    // V44 PDF akışı: başlık ilk ayak kartıyla dev bir 'break-inside:avoid' bloğuna
    // bağlanmaz. Başlık birlikte kalır, ilk tablo sayfada kalan gerçek boşluğu kullanır.
    // Tablo satırları bölünmez ve yeni sayfada thead tekrar edilir.
    const legPages=`<div class="page legsPage"><section class="legSection"><div class="legSectionStart">${header(results)}<h2>Ayak Verileri · Tüm Atlar</h2></div><div class="legs legRest">${legCards.join('')}</div></section></div>`;
    const sideSummary=await sideBetSummarySnapshotOnlyAsync(results);
    const sidePages=`<div class="page sidePage"><section class="side"><h2>Yan Bahisler</h2><div class="sideGrid">${sideSummary}</div></section></div>`;
    // KÖK FIX: Ayak tablosu artık 13 sütun (ekrandakiyle aynı) olduğu için 2 sütunlu dar
    // kart düzeni sığmıyordu; tek sütun tam genişlik düzenine geçildi (aşağıdaki CSS'te
    // .legs{grid-template-columns:1fr}).
    const css=`@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111827;background:#fff;font-size:7.8pt}.page{width:100%;max-width:190mm;margin:0 auto;min-height:0;height:auto;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto!important;break-after:auto!important}header{height:11.5mm;border-bottom:1.4px solid #24364f;display:flex;justify-content:space-between;align-items:center;margin-bottom:1.3mm}h1{font-size:13pt;margin:0;color:#17365d}header p{margin:1mm 0 0;font-weight:700}.stamp{font-size:7.3pt;color:#64748b}h2{font-size:9.2pt;margin:1mm 0 .7mm;color:#17365d;border-bottom:1px solid #dbe3ee;padding-bottom:.7mm}h3{margin:0;font-size:8.5pt}.couponGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm}.coupon{border:1px solid #b8c5d6;border-radius:1.3mm;padding:.9mm}.coupon h3{color:#17365d;margin-bottom:.7mm}.coupon table{width:100%;border-collapse:collapse}.coupon td{border-top:.3px solid #e5e7eb;padding:.3mm .6mm;font-size:6.9pt}.coupon td:first-child{width:20mm;font-weight:700}.couponFoot{margin-top:.5mm;font-weight:700;font-size:6.7pt}.mainPred{width:100%;border-collapse:collapse;table-layout:fixed}.mainPred th,.mainPred td{border:1px solid #d6dde7;padding:.45mm;font-size:5.5pt;text-align:left;vertical-align:top}.mainPred th{background:#eef3f8}.mainPred th:nth-child(1),.mainPred td:nth-child(1){width:11mm}.mainPred th:nth-child(2),.mainPred td:nth-child(2){width:24mm}.mainPred th:nth-child(3),.mainPred td:nth-child(3){width:10mm;text-align:center}.mainPred th:nth-child(4),.mainPred td:nth-child(4){width:11mm;text-align:center}.mainPred th:nth-child(5),.mainPred td:nth-child(5){width:11mm;text-align:center}.mainPred th:nth-child(6),.mainPred td:nth-child(6){width:17mm;text-align:center}.mainPred th:nth-child(7),.mainPred td:nth-child(7){width:18mm;text-align:center}.mainPred th:nth-child(8),.mainPred td:nth-child(8){width:17mm;text-align:center}.mainPred th:nth-child(10),.mainPred td:nth-child(10){width:28mm}.mainPred .small{font-size:5.5pt}.mainPred .tkpStrong{background:#dcfce7;font-weight:900;color:#166534}.mainPred .gpr1{background:#f1f5f9}.mainPred .gpr2{background:#fef3c7}.mainPred .gpr3{background:#dbeafe}.mainPred .gpr4{background:#dcfce7}.mainPred .accurateSpeed{font-weight:800;color:#0f4c81}.mainPred .xPos{color:#166534;font-weight:800}.mainPred .xNeg{color:#b91c1c;font-weight:800}.actualResult{background:#f8fafc}.actualResult b{display:block;color:#166534}.actualResult small{display:block;margin-top:.4mm;color:#475569;font-size:6.2pt}.note{margin-top:1mm;border:1px solid #dbe3ee;background:#f8fafc;padding:.8mm;font-size:6.5pt}.legs{display:grid;grid-template-columns:1fr;gap:8mm}.legCard{border:1px solid #cbd5e1;border-radius:1.5mm;overflow:visible;break-inside:auto;page-break-inside:auto;margin-bottom:0}.legCard h3{break-after:avoid;page-break-after:avoid}.legCard thead{display:table-header-group}.legCard tr{break-inside:avoid;page-break-inside:avoid}.legCard h3{background:#eef3f8;padding:.6mm 1mm;color:#17365d}.legCard h3 span{font-size:6.6pt;font-weight:400;color:#475569}.legCard table{width:100%;border-collapse:collapse;table-layout:fixed}.legCard th,.legCard td{border-top:.3px solid #e5e7eb;padding:.32mm .55mm;text-align:left;font-size:5.9pt;overflow:hidden;text-overflow:ellipsis}.legCard th{background:#f8fafc;font-size:6.1pt}.legCard td.num,.legCard th.num{text-align:center}.legCard th:nth-child(1),.legCard td:nth-child(1),.legCard th:nth-child(3),.legCard td:nth-child(3),.legCard th:nth-child(4),.legCard td:nth-child(4),.legCard th:nth-child(5),.legCard td:nth-child(5),.legCard th:nth-child(6),.legCard td:nth-child(6),.legCard th:nth-child(7),.legCard td:nth-child(7),.legCard th:nth-child(8),.legCard td:nth-child(8),.legCard th:nth-child(9),.legCard td:nth-child(9),.legCard th:nth-child(10),.legCard td:nth-child(10),.legCard th:nth-child(11),.legCard td:nth-child(11),.legCard th:nth-child(12),.legCard td:nth-child(12){text-align:center}.legCard .horseCell{text-align:left}.legCard .predictionHorseIdentity{display:grid;grid-template-columns:46px minmax(0,1fr);align-items:center;column-gap:6px;width:100%}.legCard .predictionHorseLead{display:flex;align-items:center;justify-content:flex-start;gap:2px;min-width:0}.legCard .predictionHorseName{display:block;min-width:0;text-align:left;white-space:normal}.legCard .rankBadge{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;font-weight:900}.legCard .rank-1{background:#34d399}.legCard .rank-2{background:#60a5fa}.legCard .rank-3{background:#fb923c}.legCard .rank-4{background:#a78bfa}.legCard .supportCell{text-align:left!important;font-size:5.8pt;white-space:normal}.legCard .badge{display:inline-block;margin:0 .3mm .3mm 0}.side{margin-top:8mm}.sideGrid{display:grid;grid-template-columns:1fr;gap:5mm;align-items:start}.sideRace{border:1.2px solid #9aabc0;border-radius:1.8mm;padding:1.2mm;break-inside:avoid;page-break-inside:avoid}.sideRace h3{color:#17365d;background:#eaf0f7;border-bottom:1px solid #b8c5d6;padding:1mm 1.2mm;margin:-1.2mm -1.2mm 1mm;font-size:8.2pt}.bet{display:grid;grid-template-columns:26mm minmax(0,1fr) 23mm;gap:1mm;align-items:center;border:1px solid #d7e0ea;border-radius:1.2mm;padding:.9mm 1mm;margin:.9mm 0;font-size:6.3pt;line-height:1.28;background:#fff}.bet:nth-child(odd){background:#f8fafc}.bet b{display:block;background:#17365d;color:#fff;border-radius:1mm;padding:.7mm 1mm;font-size:6.5pt;letter-spacing:.1px}.bet span{font-weight:800;overflow-wrap:anywhere}.bet em{font-style:normal;color:#334155;font-size:6pt;font-weight:700;text-align:right}.bhPrint{margin-top:1mm}.bhPrint h2{font-size:8pt;margin:1mm 0 .8mm}.bhPrintGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:.8mm}.bhPrintLeg{border:1px solid #d6dde7;border-radius:.8mm;padding:.55mm}.bhPrintLeg h3{font-size:5.8pt;color:#17365d;margin:0 0 .35mm}.bhPrintPicks{display:flex;flex-wrap:wrap;gap:.35mm}.bhPrintChip{display:inline-flex;align-items:center;gap:.45mm;max-width:100%;border:1px solid #e5e7eb;background:#f8fafc;border-radius:99px;padding:.28mm .55mm;font-size:4.9pt;line-height:1.05;white-space:nowrap}.bhPrintChip b{overflow:hidden;text-overflow:ellipsis}.bhPrintChip em{font-style:normal;font-weight:900;color:#92400e;font-size:4.6pt}.muted{color:#64748b}@media print{button{display:none!important}}`;
    // Bölüm sarmalayıcıları sayfa sonu üretmez. Yalnız tek bir ayak kartı ve tek bir
    // yan bahis oyun grubu mümkün olduğu sürece parçalanmadan sonraki sayfaya geçer.
    // Yan bahis dikey aralıkları özellikle kompakt tutulur; 6 ayaklık tipik föyün son sayfasında
    // büyük beyaz alan bırakmak yerine tam genişlikte doğal A4 akışına mümkün olduğunca sığar.
    const paginationCss='.coupon,.mainPred,.bhPrint,.legCard,.sideRace,.gameGroup,table{break-inside:avoid;page-break-inside:avoid}.couponGrid{break-inside:avoid;page-break-inside:avoid}.page section>h2{break-after:avoid;page-break-after:avoid}.page{page-break-after:auto!important;break-after:auto!important}.summaryPage,.legsPage{page-break-inside:auto;break-inside:auto}.sidePage{page-break-inside:auto;break-inside:auto}.continuationPage{padding-top:0}.legSectionStart{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}.legSectionStart header,.legSectionStart h2{break-after:avoid;page-break-after:avoid}.summaryPage section+section{margin-top:8mm}.legSectionStart{break-inside:avoid;page-break-inside:avoid}.sideCol{display:grid;gap:2.5mm}.legRest{margin-top:8mm}.legs{gap:8mm}.legCard{margin-bottom:0;break-inside:avoid;page-break-inside:avoid}.side{margin-top:8mm}.side h2{margin:.5mm 0 .45mm;break-after:avoid;page-break-after:avoid}.sideGrid{grid-template-columns:1fr;gap:5mm}';
    // Yan bahis türleri görsel olarak ayrı bloklardır. Renk yalnız tür ayrımını
    // kolaylaştırır; at havuzları ve maliyet hesapları kaynak karttan aynen gelir.
    const sideGameCss='.sideCol{display:flex;flex-direction:column;gap:5mm;min-width:0}.sideRace{padding:.65mm;break-inside:avoid;page-break-inside:avoid;overflow:visible}.sideRace h3{padding:.45mm .85mm;margin:-.65mm -.65mm .45mm;font-size:7.5pt;line-height:1.1;break-after:avoid;page-break-after:avoid}.gameGroup{--game:#475569;border:1px solid #d8e0ea;border-left:2.2px solid var(--game);border-radius:1mm;margin:1.6mm 0;overflow:visible;background:#fff;break-inside:avoid;page-break-inside:avoid}.gameGroup .gameTypeHead{break-after:avoid;page-break-after:avoid}.gameGroup .bet{break-inside:avoid;page-break-inside:avoid}.gameTypeHead{color:#fff;background:var(--game);font-size:6.4pt;font-weight:900;letter-spacing:.12px;padding:.65mm .9mm;line-height:1.05}.gameCifte{--game:#2563eb}.gameIkili{--game:#059669}.gameUclu{--game:#d97706}.gameDortlu{--game:#7c3aed}.gameBesli{--game:#dc2626}.gameOther{--game:#475569}.gameGroup .bet{grid-template-columns:28mm minmax(0,1fr) 26mm;gap:1.1mm;align-items:start;border:0;border-top:.3px solid #e5e7eb;border-radius:0;margin:0;padding:.9mm .9mm;background:#fff;font-size:6.15pt;line-height:1.12}.gameGroup .bet:first-of-type{border-top:0}.gameGroup .bet:nth-child(odd){background:#f8fafc}.gameGroup .bet b{background:transparent;color:#17365d;border-radius:0;padding:0;font-size:6.15pt;line-height:1.12}.gameGroup .bet span{font-size:6.15pt;line-height:1.12;letter-spacing:0;overflow-wrap:normal;word-break:normal}.gameGroup .bet em{font-size:5.9pt;line-height:1.12;white-space:nowrap;text-align:right}.sideFallback{font-size:6.1pt;line-height:1.12}.sideFallback button{display:none!important}.sideFallback .sideBetRaceCard,.sideFallback .sideBetTicketCard{break-inside:avoid;page-break-inside:avoid;border:1px solid #d8e0ea;border-radius:1mm;margin:1.2mm 0;padding:.8mm}.sideFallback table{width:100%;border-collapse:collapse}.sideFallback th,.sideFallback td{font-size:6pt;padding:.5mm;border:.3px solid #e5e7eb}';
    const resultPdfCss='.legCard .rankBadge,.legCard .rank-1,.legCard .rank-2,.legCard .rank-3,.legCard .rank-4,.legCard .rank-other{display:inline!important;width:auto!important;height:auto!important;background:transparent!important;border:0!important;border-radius:0!important;color:#111827!important;box-shadow:none!important}.legCard .predictionHorseNo.actualPlace{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;border-radius:50%;font-weight:900}.legCard .predictionHorseNo.actualPlace-p1{background:#86efac;border:1px solid #15803d;color:#14532d}.legCard .predictionHorseNo.actualPlace-p2{background:#7dd3fc;border:1px solid #0369a1;color:#0c4a6e}.legCard .predictionHorseNo.actualPlace-p3{background:#fde047;border:1px solid #a16207;color:#713f12}.legCard .predictionHorseNo.actualPlace-p4{background:#d8b4fe;border:1px solid #7e22ce;color:#581c87}.legCard .predictionHorseNo.actualPlace-p5{background:#9ca3af;border:1px solid #4b5563;color:#111827}.legCard .badge.result-rank-1{background:#86efac;color:#14532d}.legCard .badge.result-rank-2{background:#7dd3fc;color:#0c4a6e}.legCard .badge.result-rank-3{background:#fde047;color:#713f12}.legCard .badge.result-rank-4{background:#d8b4fe;color:#581c87}.legCard .badge.result-rank-5{background:#9ca3af;color:#111827}';
    // Padding cannot collapse with the preceding table margin. Keep the TKP
    // section heading with its title when the report flows across A4 pages.
    const sectionSpacingCss='.legsPage{padding-top:10mm}.legSectionStart{break-inside:avoid;page-break-inside:avoid}';
    const previewGrips=typeof globalThis.tkpInstallFixedScrollGrips==='function'?'<script>('+globalThis.tkpInstallFixedScrollGrips.toString()+')();<'+ '/script>':'';
    let filename='',html='';
    let pdfTimeout=0;
    try{
      const first=results[0]?.r||{};const safe=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^0-9A-Za-z_-]+/g,'_').replace(/^_+|_+$/g,'');
      filename=`TKP_A4_${safe(first.race_date||new Date().toISOString().slice(0,10))}_${safe(first.hippodrome||'YARIS')}.pdf`;
      html=`<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${css}${paginationCss}${sideGameCss}${resultPdfCss}${sectionSpacingCss}</style></head><body>${page1}${legPages}${sidePages}${previewGrips}</body></html>`;
      try{if(typeof tkpRecordPerformance==='function')tkpRecordPerformance('a4:html-ready',htmlStarted);}catch(_e){}
      // Collector/PDF servisi askıda kalırsa bütün TKP arayüzünü sonsuza kadar
      // bekletme. AbortController eski Chromium'da yoksa normal fetch kullanılır;
      // buton her durumda finally içinde serbest kalır.
      const controller=typeof AbortController==='function'?new AbortController():null;
      if(controller)pdfTimeout=setTimeout(()=>controller.abort(),15000);
      const response=await fetch('http://127.0.0.1:3762/api/v1/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html,filename}),...(controller?{signal:controller.signal}:{})});
      if(pdfTimeout){clearTimeout(pdfTimeout);pdfTimeout=0;}
      if(!response.ok){let detail='';try{detail=(await response.json())?.error||'';}catch(_e){}throw new Error(detail||`PDF servisi HTTP ${response.status}`);}
      const blob=await response.blob();
      if(!blob.size)throw new Error('PDF dosyası boş döndü');
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    }catch(err){
      console.error('PDF indirilemedi',err);
      // PDF motoru kullanılamazsa kullanıcı çalışma föyünü kaybetmesin. Aynı A4 HTML
      // çıktısı taşınabilir bir yedek olarak indirilir; PDF servisi düzeldiğinde aynı
      // içerik yeniden PDF'e çevrilebilir. Bu fallback hesap/tahmin üretmez.
      try{
        const htmlName=filename.replace(/\.pdf$/i,'.html');
        const htmlBlob=new Blob([html],{type:'text/html;charset=utf-8'});
        const htmlUrl=URL.createObjectURL(htmlBlob);const a=document.createElement('a');a.href=htmlUrl;a.download=htmlName;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(htmlUrl),1500);
        alert('PDF servisi kullanılamadı: '+(err?.message||err)+'\nAynı A4 çalışma föyü HTML yedeği olarak indirildi.');
      }catch(fallbackError){
        alert('PDF indirilemedi: '+(err?.message||err)+'\nHTML yedeği de oluşturulamadı: '+(fallbackError?.message||fallbackError));
      }
    }finally{ if(pdfTimeout)clearTimeout(pdfTimeout); if(btn&&!managedButton){btn.disabled=false;btn.textContent=oldText||'⬇️ PDF İndir · A4 Oyun Föyü';} }
  }
  function init(){const b=$('tkpPrintA4');if(b&&!b.dataset.bound){b.dataset.bound='1';b.addEventListener('click',buildReport);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  window.tkpPrintA4Report=buildReport;
})();
