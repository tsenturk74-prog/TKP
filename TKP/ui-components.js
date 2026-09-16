// Salt HTML string üreten, DOM'a doğrudan dokunmayan bileşenler.

function tkpVisibleTurkishText(v){
  return String(v??'')
    .replace(/\bDIYARBAKIR\b/g,'DİYARBAKIR').replace(/\bELAZIG\b/g,'ELAZIĞ')
    .replace(/\bISTANBUL\b/g,'İSTANBUL').replace(/\bIZMIR\b/g,'İZMİR')
    .replace(/\bKOCAELI\b/g,'KOCAELİ').replace(/\bSANLIURFA\b/g,'ŞANLIURFA');
}


let _tkpCouponPerformanceHtmlCache={key:null,html:''};
const TKP_MIN_PERCENT_SAMPLE=1; // V1.1.305: 20 yarış zorunluluğu kaldırıldı
// Yan bahis İsabet/Maliyet Yönlendiricisi'nde bir "pozitif ROI" bulgusunun
// OYNA etiketi kazanması için gereken minimum ödeme-bilinen örneklem. Gerçek
// TJK ödemeleriyle yapılan holdout testinde n=36-121 arası "pozitif ROI"
// örnekleri 4 zaman diliminin 3'ünde tersine döndü; bu eşiğin altı yalnız
// TEMKİNLİ olabilir, asla tek başına OYNA tetiklemez.
const TKP_SIDEBET_ROI_TRUST_SAMPLE=150;
function tkpPercentOrSample(numerator,denominator){
  const n=Math.max(0,Number(denominator)||0),k=Math.max(0,Number(numerator)||0);
  if(!(n>0)) return '-';
  return `%${Math.round((k/n)*100)}`;
}
function tkpPercentValueOrNull(numerator,denominator){
  const n=Math.max(0,Number(denominator)||0),k=Math.max(0,Number(numerator)||0);
  return n>0?Math.round((k/n)*100):null;
}
function couponPerformanceHTML(todayRaceResults){ return ''; }

function signalBadgesHTML(h, opts){
  opts = opts || {};
  let out='';
  if(h.bmb===1){
    if(opts.quietBmb){
      // Aynı ayakta birden fazla BMB varsa ekran kalabalığı yapmasın diye
      // sadece en geçerli/en güçlü aday tam rozet alır; diğerleri düz metin.
      out += ' <span class="badge">BMB</span>';
    } else {
      const isTemplate = h.bmb_source==='ŞABLON KURALI';
      out += isTemplate
        ? ' <span class="badge template-bmb">ODB</span>'
        : ' <span class="badge real-bmb">BMB</span>';
    }
  }
  // Race bağlamı annotateTrGanyanProfiles tarafından satıra dondurulur.
  if(Number(h.tr_hidden_fav)===1) out += ' <span class="badge" style="background:#dcfce7;color:#166534;">GİZLİ FVR</span>';
  // TR-BMB ayrı dar hücreleri şişirmesin; DESTEKLER içinde gösterilir.
  // onlyBmb: isim altında sadece BMB durumu gösterilir -- AGF/800G/YPUAN/TKP/GEÇMİŞ
  // zaten Destekler sütununda (supportSummaryHTML) aynen görünüyor, tekrar etmesin.
  if(opts.onlyBmb) return out;
  if(h.result_rank!=null && h.result_rank<=6){ const rr=Number(h.result_rank); out += ` <span class="badge ${rr>=1&&rr<=5?'result-rank-'+rr:'result6'}">SONUÇ ${rr}</span>`; }
  if(h.agf_rank!=null) out += ` <span class="badge agf3">AGF ${h.agf_rank}</span>`;
  if(h.g800!=null) out += ` <span class="badge agf3">800G ${h.g800}</span>`;
  // YPUAN (yorumcu konsensüs puanı) rozeti -- TEK (14) ve üzeri güçlü sinyal, altındaki
  // düşük puanlar (1-2 yorumcunun zayıf desteği) ekranı kalabalıklaştırmasın diye
  // sadece belirgin bir eşiğin (≥10, yani en az "1. sırada" seviyesinde) üzerindeyse gösterilir.
  if(h.ypuan!=null && h.ypuan>=10) out += ` <span class="badge agf3">YPUAN ${h.ypuan}</span>`;
  if(historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30 && !(h.result_rank!=null&&h.result_rank<=6) && h.bmb!==1) out += ' <span class="badge tkp">TKP ≥0,30</span>';
  if(historyStrengthForCandidate(h)>0) out += ' <span class="badge history">GEÇMİŞ</span>';
  return out;
}


function ypuanSignalSquaresHTML(h,r){
  // Y.PUAN hücresi yalnız puanı göstermelidir. BMB/ODB/TKP sinyalleri satır
  // sınıfı ve DESTEKLER sütununda zaten görünür; burada rozet/kare/çizgili
  // dekorasyon üretmek dar hücrede okunabilirliği bozuyordu.
  return '';
}

// X katmanı shadow modunda çalışır: ana tahmin tablosunda gerçek Y.PUAN yanında
// X'in hesapladığı olası +/− puan açıkça görünür; bu değer ŞİMDİLİK tahmine,
// sıralamaya, TEK'e veya kupona uygulanmaz.
function ypuanSourceTitle(h){
  const rows=Array.isArray(h?.ypuan_breakdown)?h.ypuan_breakdown:[];
  const divisor=Math.max(1,Number(h?.ypuan_source_divisor)||1);
  const prefix=divisor>1?`${divisor} kaynak ortalaması · `:'';
  if(rows.length)return prefix+rows.map(x=>`${String(x.source||'').toUpperCase()} / ${x.author||'Yorumcu'}: ${x.rank}. tercih = ${x.points}`).join(' | ');
  const sources=Array.isArray(h?.ypuan_sources)?h.ypuan_sources:[];
  return sources.length?`${prefix}Y.PUAN kaynakları: ${sources.join(' + ')}`:'Y.PUAN kaynak kırılımı yok';
}

function ypuanTwitterHTML(h){
  const twitter=Number(h?.x_kulis_score);
  if(Number.isFinite(twitter)){
    const base=Number(h?.x_base_ypuan),delta=Number(h?.x_ypuan_delta),tkpDelta=Number(h?.x_tkp_score_delta);
    const left=h?.x_base_ypuan!==null && h?.x_base_ypuan!=='' && Number.isFinite(base)
      ? Math.round(base)
      : '-';
    const effect=Number.isFinite(delta)&&delta!==0
      ? `${delta>0?'+':''}${Math.round(delta)}`
      : (Number.isFinite(tkpDelta)&&tkpDelta!==0?`${tkpDelta>0?'+':''}${tkpDelta.toFixed(2)}`:'0');
    return `<span class="ypuanTwitterPair" title="Gerçek Y.PUAN / X gölge +puanı · tahmine uygulanmaz"><b>${left}</b><span class="xShadowPoints" style="color:${Number(effect)>0?'#15803d':Number(effect)<0?'#b91c1c':'#64748b'};font-weight:850">/${effect}</span></span>`;
  }
  return `<b>${Number(h?.ypuan)>0?Math.round(Number(h.ypuan)):'-'}</b>`;
}

function supportHTML(h){
  let txt=(h.why&&h.why.length?h.why.slice(0,5).join(' • '):'Yeterli doğrulanmış destek yok');
  let safe=esc(txt);
  safe=safe.replace(/%(\d+(?:[,.]\d+)?)/g,(_,v)=>'<span class="pct-hit">%'+Math.round(Number(String(v).replace(',','.')))+'</span>');
  
  return safe;
}

function predictionAuditHTML(r, scored){
  const live=(scored||[]).filter(h=>!isNonRunner(h));
  const bmb=live.filter(h=>h.bmb===1).length;
  const r6=live.filter(h=>h.result_rank!=null&&h.result_rank<=6).length;
  const hist=live.filter(h=>historyStrengthForCandidate(h)>0&&(h.score||0)>=0.30&&!(h.result_rank!=null&&h.result_rank<=6)&&h.bmb!==1).length;
  const allRaceHorses=Array.isArray(r?.horses)?r.horses:(scored||[]);
  const non=allRaceHorses.filter(isNonRunner).length;
  const miss=live.filter(h=>h.result_rank==null).length;
  return `<div class="auditBox"><div class="auditItem">BMB (ODS/şablon)<b>${bmb}</b></div><div class="auditItem">SONUÇ ilk 6<b>${r6}</b></div><div class="auditItem">Depodan eklenebilir<b>${hist}</b></div><div class="auditItem">Koşmayan<b>${non}</b></div><div class="auditItem">Eksik SONUÇ<b>${miss}</b></div></div>`;
}

function panelCardHTML(title, bodyHtml, opts){
  opts = opts || {};
  return `<div class="predCard">
    <div class="predCardHead"><span>${title}</span>${opts.headerRight||''}</div>
    <div class="predCardBody">${bodyHtml}</div>
  </div>`;
}

function gaugeSVG(pct){
  pct = Math.max(0, Math.min(100, Math.round(pct||0)));
  let color = pct>=75 ? '#16a34a' : (pct>=60 ? '#2563eb' : (pct>=40 ? '#d99000' : '#e11d48'));
  let label = pct>=75 ? 'ÇOK GÜÇLÜ' : (pct>=60 ? 'GÜÇLÜ' : (pct>=40 ? 'ORTA' : 'ZAYIF'));
  const r=17, c=2*Math.PI*r, off = c*(1-pct/100);
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;min-width:48px;">
    <svg width="45" height="45" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="${r}" fill="none" stroke="#e9edf2" stroke-width="5"/>
      <circle cx="24" cy="24" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 24 24)"/>
      <text x="24" y="27" text-anchor="middle" font-size="10.5" font-weight="950" fill="${color}">%${pct}</text>
    </svg>
    <span style="font-size:8px;font-weight:950;color:${color};white-space:nowrap;">${label}</span>
  </div>`;
}

function strengthBoxHTML(pct){
  pct = Math.round(pct||0);
  let color;
  if (pct>=60) color='#3f8a5c';
  else if (pct>=40) color='#a67c2e';
  else color='#b06a3d';
  return `<span style="color:${color};font-weight:700;font-size:9.5px;white-space:nowrap;">%${pct}</span>`;
}


function ekuriVisualForHorse(h,r){
  const raw=String(h?.horse_no||'');
  let g=h?.ekuri_group || (typeof ekuriGroup==='function' ? ekuriGroup(raw) : null);
  let groupIndex=0;
  if(r && Array.isArray(r.ekuri_groups)){
    const base=String(typeof ekuriBase==='function'?ekuriBase(raw):raw).trim();
    const hitIndex=r.ekuri_groups.findIndex(gr=>Array.isArray(gr?.members)&&gr.members.map(x=>String(typeof ekuriBase==='function'?ekuriBase(x):x).trim()).includes(base));
    if(hitIndex>=0){ groupIndex=hitIndex+1; if(!g) g=r.ekuri_groups[hitIndex]?.tag||('E'+groupIndex); }
  }
  if(!g) return null;
  // Renk mutlaka E etiketi üzerinden sabitlenir. ekuri_groups dizisinin geliş sırası
  // değişse bile E1 her yerde E1 rengini, E2 E2 rengini taşır.
  const tagMatch=String(g).match(/(\d+)/);
  const tagIndex=tagMatch?Number(tagMatch[1]):0;
  const colorIndex=((Math.max(1,tagIndex||groupIndex||1)-1)%8)+1;
  // Eküri paleti derece paletinden AYRIDIR. Özellikle 1.lik yeşili kullanılmaz;
  // E1/E2/E3/E4 aynı krem zeminle birbirine benzetilmez, her grup ayrı rozet alır.
  const palette=[null,
    ['#f5f3ff','#5b21b6'], // E1 mor
    ['#fdf2f8','#9d174d'], // E2 pembe
    ['#fff7ed','#9a3412'], // E3 turuncu
    ['#f1f5f9','#1e293b'], // E4 füme
    ['#fef2f2','#991b1b'], // E5 kırmızı
    ['#eef2ff','#3730a3'], // E6 indigo
    ['#fffbeb','#92400e'], // E7 amber/kahve
    ['#f5f5f4','#57534e']  // E8 taş
  ];
  return {g,colorIndex,pc:palette[colorIndex]||palette[1]};
}
function ekuriHorseNoStyle(h,r){
  const v=ekuriVisualForHorse(h,r); if(!v) return '';
  return `background:${v.pc[0]}!important;color:${v.pc[1]}!important;border-color:${v.pc[1]}!important;box-shadow:inset 0 0 0 1px ${v.pc[1]}22!important;`;
}

function ekuriBadgeForHorse(h,r){
  const v=ekuriVisualForHorse(h,r);
  if(!v) return '';
  return ` <span class="ekuriMiniBadge ekuriGroupColor${v.colorIndex}" data-ekuri-color="${v.colorIndex}" data-ekuri-group="${esc(v.g)}" style="background:${v.pc[0]}!important;color:${v.pc[1]}!important;border:1px solid ${v.pc[1]}!important;box-shadow:inset 0 0 0 1px ${v.pc[0]}!important;" title="Eküri grubu ${esc(v.g)} · renk ${v.colorIndex}">${esc(v.g)}</span>`;
}

function tkpCouponEkuriExplanation(picks,r){
  const selected=new Map();
  for(const h of picks||[]){const v=ekuriVisualForHorse(h,r);if(v)selected.set(v.g,[]);}
  if(!selected.size)return '';
  for(const h of r?.horses||[]){const v=ekuriVisualForHorse(h,r);if(v&&selected.has(v.g))selected.get(v.g).push(String(h.horse_no).replace(/-E\d+$/i,''));}
  for(const group of r?.ekuri_groups||[])if(selected.has(group.tag))selected.get(group.tag).push(...(group.members||[]).map(String));
  const parts=[...selected].map(([tag,nos])=>`${tag}: ${[...new Set(nos)].sort((a,b)=>a.localeCompare(b,'en',{numeric:true})).join(' + ')}`);
  return `<small class="couponEkuriExplanation" style="display:block;color:#64748b;font-size:10px;line-height:1.35;margin-top:4px;white-space:normal;">Eküri kapsamı · ${esc(parts.join(' · '))}. Her grup 1 bahis seçimidir.</small>`;
}

function pastWinCellHTML(h,r){
  // G.PR yalnız gerçek galibiyet oranını gösterir. 0/4 gibi sıfır başarı değerleri
  // bilgi taşımadığı için "-" olur; başarı varsa sade 1/4 biçimi kullanılır.
  const num=(...keys)=>{for(const k of keys){const v=Number(h?.[k]); if(Number.isFinite(v)) return v;} return 0;};
  const priorStarts=num('prediction_prior_starts_snapshot','priorStarts','pastStarts','past_starts','horsePastStarts','horse_starts');
  const priorWins=num('prediction_prior_wins_snapshot','priorWins','pastWins','past_wins','horsePastWins','horse_wins');
  const priorSurprise=num('priorSurpriseHits','pastSurpriseHits','surprise_hits');
  const condStarts=num('prediction_cond_starts_snapshot','condWinStarts','conditionStarts','sameConditionStarts','same_condition_starts');
  const condWins=num('prediction_cond_wins_snapshot','condWinWins','conditionWins','sameConditionWins','same_condition_wins','similar_condition_wins');
  const condSurprise=num('condSurpriseHits','sameConditionSurpriseHits','similar_condition_surprise_hits');
  const gprColorClass=w=>Number(w)>=4?'gprWins4':Number(w)===3?'gprWins3':Number(w)===2?'gprWins2':'gprWins1';

  // Arşiv satırında benzer profil havuzunu tekrar tarama. Önceden dondurulmuş
  // cond/prior alanları yeterli; eksikse "-" gösterilir ve güncel öğrenme verisi
  // eski yarış tablosuna sızmaz.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r)){
    const last6=typeof tkpLastSixStats==='function'?tkpLastSixStats(h):{starts:0,wins:0};
    const starts=Math.max(0,condStarts||priorStarts||last6.starts),wins=Math.max(0,(condStarts?condWins:priorStarts?priorWins:last6.wins));
    if(starts>0){
      const source=condStarts>0?'Kayıtlı aynı şart':priorStarts>0?'Kayıtlı at':'TJK yarış-öncesi Son 6';
      return `<div class="gprBox gprReal ${gprColorClass(wins)}" title="${esc(source)} gerçek galibiyet geçmişi"><span class="gprValue">${wins}/${starts}</span></div>`;
    }
    return '<span class="gprNoData" title="Kayıtlı snapshotta benzer koşu geçmişi yok">-</span>';
  }

  const similar=typeof similarConditionProfileStats==='function'
    ? similarConditionProfileStats(r,h)
    : {starts:0,wins:0,top3:0,direct:false,level:'Veri yok'};
  if(similar.starts>0){
    if(!(Number(similar.wins)>0)) return '<span class="gprNoData" title="Benzer koşu + pist + mesafe/şart havuzunda gerçek galibiyet yok">-</span>';
    const source=similar.direct?'Aynı atın':'Benzer sinyal profilindeki atların';
    return `<div class="gprBox gprReal ${gprColorClass(similar.wins)}" title="${esc(source)} ${esc(similar.level)} koşullarındaki gerçek galibiyeti"><span class="gprValue">${similar.wins}/${similar.starts}</span></div>`;
  }

  if(condStarts>0 && condWins>0){
    const w=Math.max(0,condWins), st=Math.max(1,condStarts);
    const val=wilson(w,st);
    return `<div class="gprBox gprReal ${gprColorClass(w)}" title="Benzer koşuda gerçek galibiyet geçmişi — %${Math.round(val*100)}"><span class="gprValue">${w}/${st}</span></div>`;
  }
  // Eski bağımsız çağrılar/raporlar yarış profilini göndermiyorsa geriye uyumlu
  // genel at geçmişini koru. Normal tahmin tablosunda r doludur; orada bu dal
  // kullanılmaz ve G.PR benzer koşu+pist+mesafe tanımından sapmaz.
  const hasRaceProfile=!!(r&&(r.condition_family||r.condition_text||r.surface||r.distance));
  if(!hasRaceProfile&&priorStarts>0&&priorWins>0){
    return `<div class="gprBox gprReal ${gprColorClass(priorWins)}" title="Atın kayıtlı gerçek galibiyet geçmişi"><span class="gprValue">${priorWins}/${priorStarts}</span></div>`;
  }
  return '<span class="gprNoData" title="Benzer koşu + pist + mesafe/şart havuzunda yeterli geçmiş profil yok">-</span>';
}

function kgCellHTML(h){
  const kg = h.weight_kg;
  if (kg == null) return '<span class="muted" style="font-size:9px;">-</span>';
  const disp = Number.isInteger(kg) ? String(kg) : String(kg).replace('.', ',');
  const over60 = Number(kg) > 60;
  // 60 kg üstü TEK yasağı arka planda canBeCouponSingle() içinde çalışır.
  // Kullanıcı isteği gereği ekranda herhangi bir yasak etiketi/rozeti gösterilmez.
  return `<div style="text-align:center;"><span style="font-size:10.2px;font-weight:750;line-height:1.08;${over60?'color:#b91c1c;':''}">${disp}</span></div>`;
}

// DERECE: TJK'nin kendi "DERECE" sütunu (kişisel en iyi zaman, ör. "1.20.83")
// artı "Son 6 Y." dizisi (her hane bir geçmiş yarıştaki bitiriş sırası; "-"
// farklı yarış grupları arasına konur). Rengin (yeşil/kahve/altın) anlamı henüz
// derece artık tahmin motorunda küçük bir sinyal olarak kullanılır; burada ham değer
// gösterilir, yorum/renk anlamı ayrıca uydurulmaz.
function dereceCellHTML(h){
  if(!h || (typeof isNonRunner==='function' && isNonRunner(h))) return '<span class="muted" style="font-size:9px;">-</span>';
  const explicitStarts=[h.prior_starts,h.career_starts,h.start_count,h.starts].map(Number).filter(Number.isFinite);
  if(explicitStarts.length && Math.max(...explicitStarts)<=0) return '<span class="muted" style="font-size:9px;">-</span>';
  const bt = h.best_time || h.official_time || h.result_time || h.last_result_time || '';
  const s6 = h.son6_raw || '';
  if (!bt && !s6) return '<span class="muted" style="font-size:9px;">-</span>';
  return `<div class="degreeCellContent" style="text-align:center;">${bt?`<b class="degreeTime">${esc(bt)}</b>`:'<span class="degreeEmpty">-</span>'}${s6?`<div class="degreePlacings" title="Son yarışlardaki gerçek bitiriş sıraları (1., 2., 3., 4., 5. ve diğerleri)">${esc(s6)}</div>`:''}</div>`;
}

// Ganyan Canavarı yarış programında jokey formasının sağındaki gerçek p/TR puanı. Bu alan klasör
// birleştirmesinde h.tr_ganyan olarak saklanır; AGF'ye kilitli h.tr alanını ezmez.
function ganyanCanavariTrCellHTML(h){
  const value=typeof tkpTrustedGcTrValue==='function'?tkpTrustedGcTrValue(h):null;
  if(!Number.isFinite(value)) return '<span class="muted" style="font-size:9px;">-</span>';
  const shown=Number.isInteger(value) ? String(value) : String(Math.round(value*100)/100).replace('.',',');
  return `<b class="ganyanTrValue" title="Ganyan Canavarı programı · forma yanındaki p sütunu">${esc(shown)}</b>`;
}


// T.DRC: Bugünkü koşu için hesaplanan tahmini derece.
// Gerçek TJK DERECE alanıyla karışmasın diye ayrı sütunda gösterilir.
// Kaynak yoksa boş bırakılır; uydurma derece yazılmaz.
function tkpFormatRaceTimeSeconds(sec){
  if(!Number.isFinite(sec) || sec<=0) return '';
  const m=Math.floor(sec/60);
  const r=sec-m*60;
  const ss=r.toFixed(2).padStart(5,'0');
  return m>0 ? `${m}:${ss}` : ss;
}
function tahminiDereceSeconds(r,h){
  if(typeof tkpEstimatedRaceTimeSeconds==='function'){
    const est=tkpEstimatedRaceTimeSeconds(r,h);
    if(est && Number.isFinite(est.sec)) return est;
  }
  const base = typeof tkpHorseBestTimeSeconds==='function' ? tkpHorseBestTimeSeconds(h) : null;
  if(!Number.isFinite(base)){
    // YENİ: doğrudan derece yoksa Accurate + en yakın mesafe/pist geçmişinden,
    // gerçek (öğrenilen) sn/metre tempo farkı ve kilo düzeltmesiyle tahmini derece üret.
    const todayDist=Number(r?.distance)||0;
    const hist=(window.__tkpHorseHistoryIndex||{})[fold(h?.horse_name)]||[];
    if(!hist.length || !todayDist) return null;
    const best=hist.slice().sort((a,b)=>{
      const da=Math.abs((a.distance||0)-todayDist)+(a.surface===r?.surface?0:400);
      const db=Math.abs((b.distance||0)-todayDist)+(b.surface===r?.surface?0:400);
      return da-db;
    })[0];
    if(!best) return null;
    const speed=best.speed || (best.time && best.distance ? best.distance/best.time : null);
    if(!speed || !Number.isFinite(speed)) return null;
    let sec=todayDist/speed;
    if(typeof learnedPaceSecPerMeter==='function'){
      sec += learnedPaceSecPerMeter(r?.surface,r?.breed) * (todayDist-(best.distance||todayDist));
    }
    const kgToday=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(h):null;
    if(Number.isFinite(kgToday) && Number.isFinite(best.kg) && kgToday!==best.kg){
      const kgCoef=todayDist>=2000?0.24:(todayDist>=1600?0.20:0.16);
      sec += Math.max(-1.60,Math.min(1.80,(kgToday-best.kg)*kgCoef));
    }
    if(!Number.isFinite(sec) || sec<=20 || sec>=260) return null;
    return {sec, confidence:0.35, estimated:true};
  }
  const live=(r?.horses||[]).filter(x=>!isNonRunner(x));
  const kgs=live.map(x=>typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(x):null).filter(v=>Number.isFinite(v));
  let sec=base;
  let confidence=0.55;
  // Mevcut koşunun Accurate verisi sonuçtan sonra gelir. T.DRC yalnız önceki
  // koşulardan hesaplanan priorAccurate ortalamasını kullanır.
  const accAvg=Number(h?.priorAccurateAvgSpeed ?? h?.prior_accurate_avg_speed ?? 0);
  const dist=Number(r?.distance)||0;
  if(Number.isFinite(accAvg) && accAvg>0 && dist>0){
    const accSec=dist/accAvg;
    if(Number.isFinite(accSec) && accSec>20 && accSec<260){
      sec = (sec*0.55) + (accSec*0.45);
      confidence += 0.14;
    }
  }
  if(kgs.length>=2){
    const kg=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(h):null;
    if(Number.isFinite(kg)){
      const avg=kgs.reduce((a,b)=>a+b,0)/kgs.length;
      const kgDist=Number(r?.distance)||1600;
      const kgCoef = kgDist>=2000 ? 0.24 : (kgDist>=1600 ? 0.20 : 0.16); // sn/kg, kontrollü etki
      sec += Math.max(-1.60, Math.min(1.80, (kg-avg)*kgCoef));
      confidence += 0.10;
    }
  }
  // Kapanış ayarı da yalnız geçmiş yarışların ortalamasından gelir.
  const finish = Number(h?.priorAccurateFinishSignal ?? 0);
  if(Number.isFinite(finish) && finish){ sec -= Math.max(-0.80, Math.min(0.80, finish*0.45)); confidence += 0.08; }
  return {sec, confidence:Math.max(0,Math.min(1,confidence))};
}
function tahminiDereceCellHTML(r,h){
  const est=tahminiDereceSeconds(r,h);
  if(!est || !Number.isFinite(est.sec)) return '<span class="muted" style="font-size:9px;">-</span>';
  return `<div style="text-align:center;"><b style="font-size:10px;white-space:nowrap;color:#111827;font-weight:950;">${esc(tkpFormatRaceTimeSeconds(est.sec))}</b></div>`;
}

function durumBadgeHTML(){
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:999px;background:#eef8f1;color:#3f8a5c;font-weight:700;font-size:9.5px;">✓</span>`;
}

function destekCellHTML(h, r){
  const badges = signalBadgesHTML(h);
  let shortLine = '';
  if (h.result_rank!=null && h.result_rank<=6) shortLine = `${esc(r.condition_family)} şartında ${h.result_rank}. sıradaki at geçmişi`;
  else if (h.bmb===1) shortLine = `${esc(r.condition_family)} şartında BMB at geçmişi`;
  else if (h.why && h.why[0]) shortLine = esc(String(h.why[0]).slice(0,70));
  const chips = [];
  (h.why||[]).forEach(w => {
    if (chips.length>=2) return;
    const pctMatch = String(w).match(/%(\d+(?:[.,]\d+)?)/);
    if (!pctMatch) return;
    const fracMatch = String(w).match(/(\d+)\s*\/\s*(\d+)/);
    chips.push({pct: Math.round(Number(pctMatch[1].replace(',','.'))), frac: fracMatch ? `${fracMatch[1]}/${fracMatch[2]}` : null});
  });
  const chipsHtml = chips.map(c => `<span style="display:inline-block;padding:1px 5px;border-radius:5px;background:#fbeeee;border:1px solid #f0d4d4;color:#a85454;font-weight:700;font-size:8.5px;text-align:center;line-height:1.2;">${c.pct}%${c.frac?` <span style="font-size:7.5px;font-weight:600;color:#b98080;">(${c.frac})</span>`:''}</span>`).join('<span style="align-self:center;color:#c3ccd6;padding:0 1px;font-size:8px;">–</span>');
  return `<div style="min-width:150px;line-height:1.2;">
    <div>${badges || '<span class="muted" style="font-size:8.5px;">Yeterli doğrulanmış destek yok</span>'}</div>
    ${shortLine ? `<div class="muted" style="font-size:8.5px;margin-top:1px;">${shortLine}</div>` : ''}
    ${chipsHtml ? `<div style="display:flex;gap:3px;align-items:center;flex-wrap:wrap;margin-top:1px;">${chipsHtml}</div>` : ''}
  </div>`;
}

function legInfoBarHTML(r, quality){
  const tjkTime=String(r?.tjk_race_time||'').trim();
  const timeText=tjkTime?` · ⏱ ${esc(tjkTime)}`:' · ⏱ Saat yok';
  return `<div class="predTopRibbon">
    <b>🏇 ${r.leg}. AYAK${Number(r._absRaceNo)>0?' · '+Number(r._absRaceNo)+'. KOŞU':''}${timeText} · ${esc(r.condition_family)} / ${esc(r.breed)} · ${r.distance||'?'} m ${esc(r.surface)}</b>
    <span class="predQuality">✓ VERİ KALİTESİ %${quality}</span>
  </div>`;
}

function veriKontrolPanelHTML(r, scored){
  const live=(scored||[]).filter(h=>!isNonRunner(h));
  const bmb=live.filter(h=>h.bmb===1).length;
  const r6=live.filter(h=>h.result_rank!=null&&h.result_rank<=6).length;
  const hist=live.filter(h=>historyStrengthForCandidate(h)>0&&(h.score||0)>=0.30&&!(h.result_rank!=null&&h.result_rank<=6)&&h.bmb!==1).length;
  // Koşmayanlar skorlama öncesinde `scored` listesinden çıkarıldığı için sayımı
  // doğrudan yarışın resmi at listesinden yap. Aksi halde ekranda KOŞMAZ satırı
  // varken "Koşmayan At 0" gibi çelişkili bilgi görünür.
  const allRaceHorses=Array.isArray(r?.horses)?r.horses:(scored||[]);
  const non=allRaceHorses.filter(isNonRunner).length;
  const miss=live.filter(h=>h.result_rank==null).length;
  const total=allRaceHorses.length;
  const rows1 = [['⭐ ODS Gerçek BMB (adet)', bmb], ['🏆 SONUÇ İlk 6 Adayı (adet)', r6], ['✅ Depodan (TKP ≥ 0,30) (adet)', hist]];
  const rows2 = [[non===0?'✅ Koşmayan At':'❌ Koşmayan At', non], [miss===0?'✅ Eksik SONUÇ Verisi':'ℹ️ Eksik SONUÇ Verisi', miss], ['ℹ️ Toplam At', total]];
  function rowHTML([label,val]){
    // İkon (baştaki emoji) ile metni ayır; ikon sabit genişlik/boyutta kutuya
    // konur ki ⭐🏆✅❌ℹ️ gibi farklı unicode blokları ekranda eşit görünsün.
    const m = /^(\S+)\s+(.*)$/.exec(label);
    const icon = m ? m[1] : '';
    const text = m ? m[2] : label;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #eef2f7;">
      <span style="display:flex;align-items:center;gap:5px;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;font-size:12.5px;line-height:1;">${icon}</span>
        <span style="font-size:12px;color:#334155;">${text}</span>
      </span>
      <b style="font-size:12.5px;color:#0f2442;">${val}</b>
    </div>`;
  }
  const qualityOk = miss===0 && non===0;
  const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 8px;">
      <div>${rows1.map(rowHTML).join('')}</div>
      <div>${rows2.map(rowHTML).join('')}</div>
    </div>
    <p class="muted" style="margin:6px 0 0;font-size:12px;">${qualityOk ? '✅ Veri kalitesi yüksektir.' : 'ℹ️ Veri kalitesi orta düzeydedir.'}</p>`;
  return panelCardHTML(`VERİ KONTROLÜ — ${r.leg}. AYAK`, body);
}

function canonicalSinglePlan(x){
  try{
    if(typeof legCoveragePlan==='function') return legCoveragePlan(x,'main');
  }catch(_){ }
  const d=typeof profileSingleDecision==='function'?profileSingleDecision(x):null;
  return {singleDecision:d,picks:d?.first?[d.first]:[],reliable:!!d?.isSingle};
}

function guvenilirTekPanelHTML(x){
  const plan=canonicalSinglePlan(x);
  const d=plan?.singleDecision||null;
  const top=d?.first||null;
  const reliable=!!(d?.isSingle&&top);
  const outcomeHtml=top?scoreOutcomeCalibrationInlineHTML(x?.r,top,d?.confidence,true):'';
  if (!reliable){
    const reason=esc(d?.reason||'Dinamik tek şartları sağlanmadı.');
    const body = `<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;">
        <span style="font-size:11px;">🚫</span><b style="color:#b5544a;font-size:11.5px;font-weight:700;">BUGÜN GÜVENİLİR TEK YOK</b>
      </div>
      <ul style="margin:0;padding-left:13px;font-size:11px;color:#334155;line-height:1.5;">
        <li>❌ ${reason}</li>
        <li>✅ Bu ayak kuponda çoklu geçilir; skor lideri zorla tek yapılmaz.</li>
      </ul>`;
    return panelCardHTML('GÜVENİLİR TEK ANALİZİ', body, {headerRight:'<span title="Ekran ve kupon aynı tek kararını kullanır" style="opacity:.8;">ⓘ</span>'});
  }
  const body = `<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;">
      <span style="font-size:11px;">✅</span><b style="color:#3f8a5c;font-size:11.5px;font-weight:700;">GÜVENİLİR TEK: ${esc(top.horse_no)} ${esc(top.horse_name)}</b>
    </div>
    <ul style="margin:0;padding-left:13px;font-size:11px;color:#334155;line-height:1.5;">
      <li>✅ Dinamik güven: %${Math.round(Number(d.confidence)||0)} · eşik %${Math.round(Number(d.threshold)||0)}.</li>
      <li>${outcomeHtml||'Sonuç-kalibre lider kanıtı henüz yok.'}</li>
      <li>✅ Ekran, Sağlam Tek ve kupon motoru aynı kararı kullanır.</li>
    </ul>`;
  return panelCardHTML('GÜVENİLİR TEK ANALİZİ', body, {headerRight:'<span style="opacity:.8;">ⓘ</span>'});
}

function kuponDisiPanelHTML(x, soloCoupon, placeCoupon){
  const top = x.top;
  if (!top) return panelCardHTML('KUPON DIŞI GÜÇLÜ ADAYLAR', '<p class="muted" style="margin:0;font-size:11px;">Aday bulunamadı.</p>');
  const included = soloCoupon.some(z=>z.r.leg===x.r.leg) || placeCoupon.some(z=>z.r.leg===x.r.leg);
  const body = `<div class="row" style="margin-bottom:5px;gap:4px;">
      <span class="badge" style="background:#fce7f3;color:#9d174d;">${x.r.leg}</span>
      <b style="font-size:12px;">${esc(top.horse_no)} ${esc(top.horse_name)}</b>
      <span class="badge" style="background:#e0ecff;color:#1d4ed8;">TKP ${fmt2(top.score)}</span>
    </div>
    <p class="muted" style="margin:0;font-size:11px;">${included ? 'Bu ayak için güçlü sinyal taşıyor ve kupon önerilerine dahil edildi.' : 'Bu ayak için güçlü sinyal taşıyor. Bütçe nedeniyle kupon dışı bırakıldı.'}</p>`;
  return panelCardHTML('KUPON DIŞI GÜÇLÜ ADAYLAR', body);
}

function celiskiPanelHTML(x){
  const scored = x.scored||[];
  const weakSignals = scored.filter(h => (h.why||[]).length && (h.score||0) < 0.35).length;
  const uyumlu = (x.margin||0) >= 0.15;
  const body = `<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:15px;font-size:13px;line-height:1;">${uyumlu?'✅':'ℹ️'}</span><span style="font-size:12px;color:#334155;">${uyumlu ? 'Bu ayakta ana sinyaller uyumlu. Güven artırıldı.' : 'Ana sinyaller arasında belirgin bir fark yok.'}</span>
    </div>
    ${weakSignals ? `<div style="display:flex;align-items:center;gap:5px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:15px;font-size:13px;line-height:1;">ℹ️</span><span style="font-size:12px;color:#334155;">${weakSignals} atta sinyaller kısmen zayıf. Güven nötr seviyede.</span></div>` : ''}`;
  return panelCardHTML('ÇELİŞKİ KONTROLÜ', body);
}

function profileSingleMetricsHTML(x, compact=false){
  const plan=canonicalSinglePlan(x);
  const base=plan?.singleDecision||{};
  const first=base.first||null;
  const second=base.second||null;
  const profile=first?profileStrengthPct(x.r,first):0;
  const secondProfile=second?profileStrengthPct(x.r,second):0;
  const gap=Math.max(0,profile-secondProfile);
  const d={...base,first,second,profile,secondProfile,gap,tkp:first?Number(first.score)||0:0,agf:first&&first.agf!=null?Math.round(Number(first.agf)||0):null,total:first?Math.max(0,Math.min(100,Math.round(Number(base.confidence)||0))):0,strong:!!base.isSingle&&profile>=80&&gap>=10};
  if(!d.first) return '';
  const state=d.strong?'GÜÇLÜ TEK':(d.isSingle?'TEK ADAYI':'ÇOKLU GEÇ');
  const cls=d.strong?'profileStrong':(d.isSingle?'profileSingle':'profileMulti');
  return `<div class="profileSingleBox ${cls}">
    <div class="profileSingleHead"><b>${esc(d.first.horse_no)} · ${esc(d.first.horse_name||'')}</b><span>${state}</span></div>
    <div class="profileMetricLine">
      <span><small>TKP</small><b>${fmt2(d.tkp)}</b></span>
      <span><small>Profil</small><b>%${d.profile}</b></span>
      <span><small>AGF</small><b>${d.agf==null?'-':'%'+d.agf}</b></span>
      <span><small>Toplam</small><b>%${d.total}</b></span>
      <span><small>Fark</small><b>${d.gap} puan</b></span>
    </div>
    ${compact?'':`<div class="profileSingleNote">Tek kaynağı: Tahmin algoritması. Profil ≥ %70, profil farkı ≥ 10 ve dinamik güven şartları birlikte aranır. Yan bahis TEKLİ OYUN kartları yalnız Normal/Sürpriz kuponların gerçekten ürettiği TEK ayakları kullanır.</div>`}
  </div>`;
}

function rulePctHTML(h,r){
  const pct=Number(profileStrengthPct(r,h))||0;
  return pct>0?`<span class="rulePctOnly">%${pct}</span>`:'<span class="muted">-</span>';
}

// Bomba Avcısı ana kupon sırasına/elemesine müdahale etmez. Bu bağlam yalnız
// ayak tablosundaki DESTEKLER hücresinde 3 Bomba + 1 ODB portföyünü görünür kılar.
// Sonuçlu bir yarışta dondurulmuş snapshot yoksa yeni aday HESAPLANMAZ; böylece
// geçmiş sonuçtan geriye doğru BH etiketi üretilmez.
function tkpBombHunterSupportContext(r){
  const empty={byHorse:new Map(),candidates:[],profile:null};
  if(!r) return empty;
  const archivedReadOnly=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r);
  let raw=[];
  try{
    const key=typeof tkpBombHunterRaceKey==='function'?tkpBombHunterRaceKey(r):'';
    const log=typeof db!=='undefined'&&Array.isArray(db?.bomb_hunter_shadow_log)
      ? db.bomb_hunter_shadow_log : [];
    const frozen=key?log.find(row=>row?.race_key===key):null;
    if(Array.isArray(frozen?.candidates)&&frozen.candidates.length){
      raw=frozen.candidates;
    }else{
      const hasResult=typeof raceHasConfirmedResult==='function'
        ? raceHasConfirmedResult(r.horses||[])
        : false;
      // Sonuçsuz eski kayıt da salt-okunur kabul edilir. BH snapshot'ı yoksa
      // canlı aday taraması başlatma; aksi hâlde eski ayak tablosu açılırken
      // tüm sürpriz/profil zinciri yeniden çalışıp ana thread'i kilitleyebilir.
      if(!archivedReadOnly&&!hasResult&&typeof tkpBombHunterCandidates==='function') raw=tkpBombHunterCandidates(r)||[];
    }
  }catch(_e){ raw=[]; }

  if(!raw.some(row=>typeof tkpBombHunterIsOdbRow==='function'&&tkpBombHunterIsOdbRow(r,row))){
    const storedOdb=(r.horses||[]).find(h=>Number(h?.odb)===1||h?.bmb_source==='ŞABLON KURALI');
    if(storedOdb)raw=raw.concat([{kind:'ODB',horse_no:String(storedOdb.horse_no||''),horse_name:storedOdb.horse_name||'',score:Number(storedOdb.prediction_score_snapshot??storedOdb.score)||0,reasons:['Kayıtlı ODB snapshotı']}]);
  }
  const selected=typeof tkpBombHunterThreeFromRows==='function'?tkpBombHunterThreeFromRows(r,raw):raw.slice(0,4);
  const candidates=selected.map((row,index)=>{
    const rank=Number(row?.rank);
    return {
      rank:Number.isFinite(rank)&&rank>0?rank:index+1,
      kind:String(row?.kind||'BOMBA').toUpperCase()==='ODB'?'ODB':'BOMBA',
      category_rank:Number(row?.category_rank)||((String(row?.kind||'').toUpperCase()==='ODB')?1:index+1),
      horse_no:String(row?.horse_no??row?.h?.horse_no??'').trim(),
      score:Number(row?.score)||0,
      near_win_score:Number(row?.near_win_score)||0
    };
  }).filter(row=>row.horse_no).sort((a,b)=>a.rank-b.rank).slice(0,4);
  if(!candidates.length) return empty;

  // V1.1.329: Arşiv ayaklarında da "BH geçmiş kazanan / kazanana yakın"
  // renklendirmesi görünür. Performans için tarih + log boyutuna göre küçük bir
  // cache kullanılır; her at satırında yüzlerce BH kaydı yeniden taranmaz.
  let profile=null;
  try{
    const cutoff=String(r.race_date||'');
    const logCount=typeof db!=='undefined'&&Array.isArray(db?.bomb_hunter_shadow_log)?db.bomb_hunter_shadow_log.length:0;
    const histCount=typeof db!=='undefined'&&Array.isArray(db?.settings?.bh_historical_500_profile?.winner_scores_by_date)?db.settings.bh_historical_500_profile.winner_scores_by_date.length:0;
    const cacheKey=`${cutoff}|${logCount}|${histCount}`;
    const cache=tkpBombHunterSupportContext._profileCache||(tkpBombHunterSupportContext._profileCache=new Map());
    if(cache.has(cacheKey)) profile=cache.get(cacheKey);
    else{
      profile=typeof tkpBombHunterWinningScoreProfile==='function'?tkpBombHunterWinningScoreProfile(cutoff):null;
      cache.set(cacheKey,profile);
      if(cache.size>32)cache.delete(cache.keys().next().value);
    }
  }catch(_e){ profile=null; }

  // Bomba Avcısı panelindekiyle aynı eküri koruması: ana ilk 5'teki eküri
  // temsilcisi yüzünden başka bir eküri atına geçmiş-kazanan etiketi taşınmaz.
  const topFive=(r.horses||[]).filter(row=>row&&!(typeof isNonRunner==='function'&&isNonRunner(row))).slice()
    .sort((a,b)=>(Number(b?.score)||0)-(Number(a?.score)||0)).slice(0,5);
  const blockedByTopFiveEkuri=candidate=>topFive.some(row=>
    String(row?.horse_no||'')!==candidate.horse_no
    && typeof sameEkuri==='function'&&sameEkuri(row?.horse_no,candidate.horse_no)
  );
  const eligible=candidate=>!blockedByTopFiveEkuri(candidate);
  const exactMatch=candidate=>eligible(candidate)
    && typeof tkpBombHunterMatchesPastWinningScore==='function'
    && tkpBombHunterMatchesPastWinningScore(candidate,profile);
  const nonExact=candidates.filter(candidate=>eligible(candidate)&&!exactMatch(candidate));
  const nearestKeys=new Set(
    Number(profile?.count||0)&&typeof tkpBombHunterWinnerProfileDistance==='function'
      ? nonExact.slice().sort((a,b)=>tkpBombHunterWinnerProfileDistance(a,profile)-tkpBombHunterWinnerProfileDistance(b,profile))
        .slice(0,2).map(candidate=>candidate.horse_no)
      : []
  );

  const byHorse=new Map();
  for(const candidate of candidates){
    // 23.08.2026 / İzmir 508 görünüm sözleşmesi: destek rozetleri kısa,
    // sıra taşıyan tek adla gösterilir. Ayrı ODB kotasının ilk adayı ODB1'dir.
    const candidateLabel=candidate.kind==='ODB'
      ? 'ODB1'
      : `BH${Math.max(1,Number(candidate.category_rank)||1)}`;
    const badges=[{
      text:candidateLabel,
      cls:'history bh-candidate',
      title:candidate.kind==='ODB'?'Kazanma yakınlığı en yüksek ayrı ODB adayı':`Kazanma yakınlığına göre ${candidate.category_rank}. Bomba adayı`
    }];
    if(exactMatch(candidate)){
      badges.push({
        text:'BH G.KAZ',
        cls:'history bh-past-winner',
        title:'BH puanı, bu yarıştan önce kazanan bir BH adayının puanıyla birebir eşleşiyor.'
      });
    }else if(nearestKeys.has(candidate.horse_no)){
      badges.push({
        text:'BH YAKIN',
        cls:'history bh-near-winner',
        title:'BH puanı, bu yarıştan önceki kazanan BH adaylarının puan profiline en yakın adaylardan biri.'
      });
    }
    byHorse.set(candidate.horse_no,badges);
  }
  return {byHorse,candidates,profile};
}

function tkpBombHunterSupportBadges(h,context){
  const key=String(h?.horse_no??'').trim();
  return key&&context?.byHorse instanceof Map ? (context.byHorse.get(key)||[]) : [];
}

function supportSummaryHTML(h,r,bhContext){
  const parts = [];
  const benterStatus=String(h?.tkp_benter_status||'');
  const benterEdge=Number(h?.tkp_benter_edge);
  const benterValue=(benterStatus==='GUCLU_DEGER'||benterStatus==='SINIRDA_DEGER')&&Number.isFinite(benterEdge);
  const archiveFast=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(r);
  const bhBadges=tkpBombHunterSupportBadges(h,bhContext||tkpBombHunterSupportContext(r));
  const why = fold((h.why||[]).join(' '));
  // SONUÇ derecesi yalnız resmi olarak dereceyi alan atın KENDİ kaydından gelir.
  // Eküri ortağı ilk 5'e girdiyse diğer ortak aynı SONUÇ işaretini/rengini alamaz.
  const directResultRank = Number(h?.result_rank);
  const effectiveResultRank = Number.isFinite(directResultRank) && directResultRank>0
    ? directResultRank
    : null;
  const sameConditionWinner = Number(h.same_condition_winner||0)>0 || Number(h.similar_condition_wins||0)>0 || Number(h.condWinWins||0)>0;
  const raceHorses=(r?.horses||[]).filter(x=>x&&!isNonRunner(x)).slice().sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
  const algoRank=Math.max(1,raceHorses.findIndex(x=>x===h)+1);
  const highWinChance = Number(h.score||0)>=0.30 && algoRank<=3;
  // KÖK FIX (V1.1.06): BMB/ODB, ODS'den gelen gerçek/veri-tabanlı bir sinyaldir -- "belki"
  // niteliğinde bir TKP/GEÇ.PRF ipucu değildir. Satır rengini (real-bmb-row/odb-row,
  // sarı/turkuaz arka plan) belirleyen legTableHTML mantığı da doğrudan h.bmb===1'e bakar,
  // bu kalite kapısından (sameConditionWinner/highWinChance) HİÇ geçmez. Önceden bu erken
  // return, TKP skoru 0,30 altında veya ilk 3 algoritma sırasında olmayan gerçek bir BMB
  // atının satırı sarıya boyanırken Destekler sütununda HİÇBİR rozet göstermemesine yol
  // açıyordu -- kullanıcı "neden bu at sarı ama BMB yazmıyor" diye şaşırıyordu. BMB/ODB
  // artık bu kapıyı her zaman atlar.
  // Gerçek sonuç rozeti algoritmik kalite filtresine tabi değildir. Özellikle
  // zayıf tahmin edilmiş 5. at, önceki erken dönüş yüzünden gri SONUÇ 5 rozetiyle
  // ekranda hiç görünmüyordu. Doğrulanmış ilk 6 sonuç her zaman gösterilir.
  const hasConfirmedResultRank=effectiveResultRank!=null&&effectiveResultRank>=1&&effectiveResultRank<=6;
  const hasTrBmbSupport=Number(h.tr_bmb_candidate)===1;
  if(!sameConditionWinner && !highWinChance && h.bmb!==1 && !hasConfirmedResultRank && !hasTrBmbSupport && !bhBadges.length && !benterValue) return '';

  // BH1/BH2/BH3/ODB1 ile geçmiş-kazanan profil işareti, kompakt görünümde
  // kaybolmaması için önce eklenir. Bu yalnız bilgi katmanıdır; kuponu değiştirmez.
  parts.push(...bhBadges);

  if(benterValue){
    const strong=benterStatus==='GUCLU_DEGER';
    parts.push({text:strong?'BENTER+':'BENTER',cls:strong?'real-bmb':'support-neutral',
      title:`Model-piyasa sonrası ${strong?'güçlü':'sınırda'} değer · net kenar %${Math.round(benterEdge*100)}`});
  }

  // Ana sinyaller, alttaki açıklama anahtarıyla birebir aynı renkte gösterilir.
  if(h.bmb===1){
    // BH bağlamı bu atı zaten ODB1 olarak eklediyse aynı rozet ikinci kez basılmaz.
    if(h.bmb_source==='ŞABLON KURALI'){
      if(!bhBadges.some(b=>b?.text==='ODB1')) parts.push({text:'ODB1', cls:'template-bmb'});
    }
    else parts.push({text:'BMB', cls:'real-bmb'});
    
  }
  // Kullanıcı kararı: TR-BMB dar skor hücresini genişletmez; DESTEKLER içinde erken gösterilir.
  // Erken eklenir ki maksimum 7 rozet sınırında kesilip kaybolmasın.
  if(Number(h.tr_bmb_candidate)===1) parts.push({text:'TR-BMB', cls:'support-neutral tr-bmb-support'});
  if(effectiveResultRank!=null && effectiveResultRank<=6){
    parts.push({text:'SONUÇ '+effectiveResultRank, cls:(effectiveResultRank>=1&&effectiveResultRank<=5)?('result-rank-'+effectiveResultRank):'result6'});
  }
  if(h.agf_rank!=null){
    parts.push({text:'AGF '+h.agf_rank, cls:'agf3'});
  }
  if(h.g800!=null){
    parts.push({text:'800G '+h.g800, cls:'agf3'});
  }
  if(Number(h.galop_drc_contra)===1) parts.push({text:'GLP+DRC', cls:'history'});
  if(historyStrengthForCandidate(h)>0 && (h.score||0)>=0.30 && !(effectiveResultRank!=null&&effectiveResultRank<=6) && h.bmb!==1){
    parts.push({text:'TKP', cls:'tkp'});
  }
  const surpriseProfile=archiveFast?{matched:false,labels:[]}:historicalSurpriseProfileMatch(r,h);
  // GEÇ. PRF yalnız destek açıklamasıdır; G.PR sütununa asla yazılmaz.
  // Çok zayıf, ana motorun kazanabilir görmediği atlarda geçmiş profil etiketi ekranı kirletmesin.
  const hasOdbSignal = typeof isOdbCandidate==='function' && isOdbCandidate(h,r);
  const allowProfileNote = surpriseProfile.matched && (sameConditionWinner || highWinChance || hasOdbSignal || h.bmb===1) && Number(h.score||0)>=0.14;
  if(allowProfileNote){
    const labels = surpriseProfile.labels.filter(Boolean).slice(0,3).join('/');
    if(labels) parts.push({text:'GEÇ. PRF '+labels, cls:'history profile-history'});
  }
  if(historyStrengthForCandidate(h)>0){
    const frac = h.condWinStarts>0
      ? `${h.condWinWins||0}/${h.condWinStarts}`
      : (h.priorStarts>0 ? `${h.priorWins||0}/${h.priorStarts}` : '');
    parts.push({text:'GEÇMİŞ'+(frac?' '+frac:''), cls:'history'});
  }

  // Yardımcı göstergeler nötr renkte kalır; ana sinyal renkleriyle karışmaz.
  if(why.includes('AGF') && h.agf_rank==null) parts.push({text:'AGF', cls:'support-neutral'});
  if(why.includes('800') && h.g800==null) parts.push({text:'800G', cls:'support-neutral'});
  if(why.includes('VALUE')) parts.push({text:'VALUE', cls:'support-neutral'});
  if(/\bTR\b/.test(why)) parts.push({text:'TR', cls:'support-neutral'});
  const dg = archiveFast ? 0 : ((typeof tkpDegreeSignalValue==='function') ? tkpDegreeSignalValue(r,h) : 0);
  const kg = archiveFast ? 0 : ((typeof tkpKgSignalValue==='function') ? tkpKgSignalValue(r,h) : 0);
  if(dg>=0.67) parts.push({text:'DRC+', cls:'support-neutral'});
  if(kg>=0.67) parts.push({text:'KG+', cls:'support-neutral'});

  const seen = new Set();
  const shown = parts.filter(p=>{
    const key=p.text+'|'+p.cls;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0,7);
  if(!shown.length) return '';
  return `<div class="supportBadges">${shown.map(p=>`<span class="badge ${p.cls}"${p.title?` title="${esc(p.title)}"`:''}>${esc(p.text)}</span>`).join('')}</div>`;
}


function v25NumLoose(v){
  if(v==null || v==='') return 0;
  if(typeof v==='number') return Number.isFinite(v) ? v : 0;
  const s=String(v).trim().replace(/\./g,'').replace(',','.');
  const n=Number(s);
  return Number.isFinite(n) ? n : 0;
}
function v25VisiblePercentStrength(r,h){
  // Ayrıntılı Analiz tablosunda görünen yüzde, doğrudan Profil Gücü yüzdesidir.
  // Back Test / geçmiş başarı oranları bu canlı sıralama desteğine karıştırılmaz.
  try{ return Math.max(0,Math.min(100,v25NumLoose(profileStrengthPct(r,h)))); }
  catch(_){ return 0; }
}
function v25TopRankByValue(r,h,field,descending=true){
  const horses=(r?.horses||[]).filter(x=>x&&!isNonRunner(x));
  const usable=horses.filter(x=>x[field]!=null && String(x[field]).trim()!=='' && Number.isFinite(v25NumLoose(x[field])));
  if(!usable.length) return 999;
  usable.sort((a,b)=>{
    const av=v25NumLoose(a[field]), bv=v25NumLoose(b[field]);
    const diff=descending ? bv-av : av-bv;
    if(Math.abs(diff)>0.000001) return diff;
    return TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||''));
  });
  const no=String(h?.horse_no||'');
  const idx=usable.findIndex(x=>String(x.horse_no||'')===no);
  return idx<0?999:idx+1;
}
function v25LiveConsensusInfo(r,h){
  const pct=v25VisiblePercentStrength(r,h);
  // profileStrengthPct hesaplanan bir alan olduğu için sırasını burada doğrudan çıkar.
  const profileRows=(r?.horses||[]).filter(x=>x&&!isNonRunner(x)).map(x=>({h:x,p:v25VisiblePercentStrength(r,x)}))
    .sort((a,b)=>(b.p-a.p)||TKP_TR_COLLATOR_NUM.compare(String(a.h?.horse_no||''),String(b.h?.horse_no||'')));
  const pIdx=profileRows.findIndex(x=>String(x.h?.horse_no||'')===String(h?.horse_no||''));
  const liveProfileRank=pIdx<0?999:pIdx+1;

  let otherTop=0;
  const agfRank=v25NumLoose(h?.agf_rank)||999;
  const resultRank=v25NumLoose(h?.result_rank)||999;
  const jbygRank=v25NumLoose(h?.jbyg)||999;
  const g800Rank=v25NumLoose(h?.g800)||999;
  const hndkpRank=v25NumLoose(h?.hndkp_rank)||999;
  const ypuanRank=v25TopRankByValue(r,h,'ypuan',true);
  const valueRank=v25TopRankByValue(r,h,'value_score',true);

  if(agfRank<=4) otherTop++;
  if(resultRank<=4) otherTop++;
  if(jbygRank<=4) otherTop++;
  if(g800Rank<=4) otherTop++;
  if(hndkpRank<=4) otherTop++;
  if(v25NumLoose(h?.ypuan)>0 && ypuanRank<=4) otherTop++;
  if(v25NumLoose(h?.value_score)>0 && valueRank<=4) otherTop++;
  try{ if(h?.bmb===1 || (typeof isOdbCandidate==='function'&&isOdbCandidate(h))) otherTop++; }catch(_){}

  // Yüksek Profil Gücü tek başına sıralamayı ele geçirmez. Profilde ilk 3'te ve
  // en az iki bağımsız canlı analizde ilk 4'te olan ata, ham TKP farkını en fazla
  // 0,30 kapatabilecek sınırlı bir konsensüs desteği verilir. Böylece Back Test,
  // kupon TEK eşikleri ve ham TKP puanı değişmeden kalır.
  let bonus=0;
  if(pct>=20 && liveProfileRank<=3 && otherTop>=2){
    const rankPart=(4-liveProfileRank)*0.035;
    const pctPart=Math.min(0.09,Math.max(0,pct-20)*0.003);
    const supportPart=Math.min(0.12,(otherTop-2)*0.03+0.06);
    bonus=Math.min(0.30,rankPart+pctPart+supportPart);
  }
  return {pct,profileRank:liveProfileRank,otherTop,bonus};
}
function v25GeneralOverviewCompare(r){
  return (a,b)=>{
    // KRAL TALİMATI: Ayak Görünümü ve Genel Bakış artık SAF TKP puanına göre
    // (yüksekten düşüğe) sıralanır. Önceden buraya +0,30'a kadar bir "canlı
    // konsensüs bonusu" karışıyordu (bkz. v25LiveConsensusInfo) ve bu, TKP puanı
    // daha düşük bir atın ekranda üstte görünmesine yol açabiliyordu -- kullanıcı
    // bunu "TKP sıralaması hatalı" olarak bildirdi. Bonus hesaplama fonksiyonu
    // (başka yerlerde rozet/bilgi amaçlı kullanılabildiği için) hâlâ duruyor,
    // yalnızca burada birincil sıralama anahtarı olmaktan çıkarıldı; skorlar tam
    // eşitse (nadir) ikincil ayraç olarak kullanılmaya devam eder.
    const sa=v25NumLoose(a?.score), sb=v25NumLoose(b?.score);
    if(Math.abs(sb-sa)>0.000001) return sb-sa; // ham TKP puanı, tek ve tam birincil anahtar
    const ca=v25LiveConsensusInfo(r,a), cb=v25LiveConsensusInfo(r,b);
    if(Math.abs(cb.bonus-ca.bonus)>0.000001) return cb.bonus-ca.bonus;
    if(Math.abs(cb.pct-ca.pct)>0.000001) return cb.pct-ca.pct;
    if(cb.otherTop!==ca.otherTop) return cb.otherTop-ca.otherTop;
    const ra=v25NumLoose(a?.result_rank)||999, rb=v25NumLoose(b?.result_rank)||999;
    if(ra!==rb) return ra-rb;
    const aa=v25NumLoose(a?.agf_rank)||999, ab=v25NumLoose(b?.agf_rank)||999;
    if(aa!==ab) return aa-ab;
    return TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||''));
  };
}

function v25SortGeneralOverviewRows(r, rows){
  return (rows||[]).filter(h=>!isNonRunner(h)).slice().sort(v25GeneralOverviewCompare(r));
}

function predictionDisplayRows(x, limit=10, mode='strategy'){
  const {r, scored} = x;
  // Güvenlik ağı: koşmayan (isNonRunner) atlar bu noktaya kadar zaten
  // elenmiş olmalı (bkz. app-controller.js skorlama öncesi filtre), ama
  // tahmin tablosu asla koşmayan bir atı göstermesin diye burada da
  // kesin olarak dışlanır.
  const liveScored=(scored||[]).filter(h=>!isNonRunner(h));
  const hasSealedStrategy=mode!=='score-desc'
    && liveScored.length>0
    && liveScored.every(horse=>Number.isFinite(Number(horse?._strategy_rank)));
  const rows=mode==='score-desc'
    ? v25SortGeneralOverviewRows(r, liveScored)
    : hasSealedStrategy
      ? liveScored.slice().sort((left,right)=>Number(left._strategy_rank)-Number(right._strategy_rank))
      : strategicOrderForRace(r, liveScored);
  // limit=null/Infinity -> tüm atlar (ör. ekrandaki ana tablo). Kupon/yan bahis
  // motorunun kullandığı çağrılar varsayılan (10) limiti değişmeden kullanmaya devam eder.
  const cap = (limit==null || limit>=rows.length) ? rows.length : limit;
  const topNos=new Set(rows.slice(0,cap).map(h=>String(h.horse_no)));
  const extras=liveScored.filter(h=>!topNos.has(String(h.horse_no))&&isExtraBadgeSignal(r,h));
  // V1.1.116: Tam ayak tablosunda KOŞMAZ atlar kaybolmaz; hesap sırasının SONUNA eklenir.
  // Kupon/yan bahis çağrıları limitli olduğu için bu atları almaya devam etmez.
  const nonRunners=(limit==null || limit===Infinity || limit>=9999)
    ? (r?.horses||[]).filter(h=>isNonRunner(h))
    : [];
  return {rows:rows.slice(0,cap).concat(nonRunners),extras};
}

function legTableHTML(x, options={}){
  x=globalThis.TKP_RESULT_VIEW?.leg(x)||x;
  const {r, scored} = x;
  // Ekran görünümünde eküri ortağının derecesi bilgi amaçlı taşınabilir. PDF'de ise
  // resmi sonuç rengi yalnız gerçekten derece yapan ata uygulanır; dereceye girmeyen
  // eküri ortağı aynı renk/sonuç işaretini alamaz.
  const directResultOnly=!!options.directResultOnly;
  // Kullanıcı isteği: ODS/Programdaki BÜTÜN atlar ekranda gözüksün -- ana tahmin
  // tablosu artık ilk 10'la sınırlı değil, algoritmanın sıraladığı tüm atları gösterir.
  // Genel Bakış, ayak tablosu, Ayak Önerisi ve kupon motoru aynı TKP ana sırasını
  // kullanır. Böylece ekranda ikinci görünen at kuponda farklı bir lider olamaz.
  const {rows:displayRows, extras} = predictionDisplayRows(x, Infinity, 'score-desc');

  const shownNos = new Set(displayRows.map(h => String(h.horse_no)));
  const missingAgfTop4 = (scored || [])
    .filter(h => !isNonRunner(h) && h.agf_rank!=null && Number(h.agf_rank)<=4 &&
      !shownNos.has(String(h.horse_no)))
    .sort((a,b)=>Number(a.agf_rank)-Number(b.agf_rank));

  const agfWarningHTML = missingAgfTop4.length
    ? `<div class="excludedAlert"><b>⚠ AGF ilk 4 uyarısı:</b> Algoritma ${missingAgfTop4.map(h =>
        `<span class="alertHorseNo">${esc(h.horse_no)}</span> ${esc(h.horse_name)} (AGF ${h.agf_rank}${h.agf!=null?' · %'+Math.round(h.agf):''})`
      ).join(' · ')} atını ilk 10 tahmine almadı. At zorla eklenmedi; algoritmanın bağımsız seçimi gösteriliyor.</div>`
    : '';

  // Tahmin ekranında SONUÇ yok: sonuç uyarısı/etiketi gösterilmez.
  const resultWarningHTML = '';

  // Bir ayakta birden fazla BMB'li at olabilir; ekran kalabalığı yapmasın diye
  // yalnızca en geçerli/en güçlü aday tam rozet + satır vurgusu alır (aşağıda
  // orderedRows üzerinden, ekranda görülen ilk BMB'li at olarak hesaplanır).

  // Görüntü sırası da kupon ve yan bahislerle aynı ortak motoru kullanır.
  // ODB geçmiş kazanan anlamına gelmez; ODS dışı bomba koşulları isOdbCandidate
  // içinde ayrı değerlendirilir ve ekran için ikinci bir sıralama yapılmaz.

  // Ekran, kuponlar ve yan bahisler aynı stratejik sırayı kullanır.
  // Görsel amaçlı ayrı BMB/ODB sıralaması yapılmaz; yalnız ana motorun 6-7 bandı kuralı geçerlidir.
  const orderedRows=displayRows.slice();
  const primaryBmbIdx = orderedRows.findIndex(h => h.bmb === 1);
  // Aynı ayaktaki her satır için yeniden BH profil taraması yapma. Bu bağlam salt
  // görünüm içindir; mevcut kilitli BH snapshotını bir kez okuyup satırlara dağıtır.
  const bhSupportContext=tkpBombHunterSupportContext(r);

  const rows = orderedRows.map((h,i)=>{
    const nonRunner=isNonRunner(h);
    const bhRowBadges=tkpBombHunterSupportBadges(h,bhSupportContext);
    const bhNearWinner=bhRowBadges.some(b=>String(b?.cls||'').split(/\s+/).includes('bh-near-winner'));
    const bhPastWinner=bhRowBadges.some(b=>String(b?.cls||'').split(/\s+/).includes('bh-past-winner'));
    const isTop=i===0 && !nonRunner;
    const isExtra=!nonRunner && isOdbCandidate(h,r);
    const isPrimaryBmb = h.bmb===1 && i===primaryBmbIdx;
    // BMB rengi yalnız ilk BMB adayına değil, gerçek BMB olan TÜM satırlara uygulanır.
    // Önceki sürümlerde primaryBmb şartı yüzünden bir BMB sarı, diğeri beyaz kalıyordu.
    const realBmb = h.bmb===1 && h.bmb_source!=='ŞABLON KURALI';
    const hasOdb = !realBmb && (typeof isOdbCandidate==='function' && isOdbCandidate(h,r));
    const rankNo=i+1;
    const rankClass=rankNo<=4 ? `rank-${rankNo}` : 'rank-other';
    const rank = nonRunner ? `<span class="rankBadge rank-other">—</span>` : `<span class="rankBadge ${rankClass}">${rankNo}</span>`;
    const directFinishInfo = finishMarkInfo(h);
    // V1.1.152: SONUÇ TABLOSU resmi sonucu yalnız ilgili atın kendi finish_position/winner
    // alanından gösterir. Eküri ortağı kazanmışsa diğer ortak aynı yeşil kazanan işaretini
    // veya 1. derece rozetini ALMAZ. Bahis/kupon isabet mantığındaki eküri eşdeğerliği
    // ayrı kalır; burada amaç resmi sonuç görselleştirmesidir.
    const ekuriFinishHorse = null;
    const displayFinishInfo = directFinishInfo;
    const isActualWinnerRow = directFinishInfo?.pos === 1;
    return `<tr class="${nonRunner?'nonRunnerRow ':''}${realBmb?'real-bmb-row ':''}${hasOdb?'odb-row ':''}${isTop&&!realBmb&&!hasOdb?'rankOne':''}${isActualWinnerRow?' actualWinnerRow':''}">
      <td class="num" style="text-align:center;">${rank}</td>
      <td class="horseCell">
        <div class="predictionHorseIdentity"><span class="predictionHorseLead"><span class="predictionHorseNo${displayFinishInfo?' actualPlace actualPlace-p'+displayFinishInfo.pos:''}" style="${displayFinishInfo?'':ekuriHorseNoStyle(h,r)}" title="${displayFinishInfo?esc(displayFinishInfo.title):'Atın resmî program numarası'}">${esc(String(h.horse_no??h.no??h.at_no??h.program_no??'').trim().replace(/-E\d+$/i,''))}</span>${ekuriBadgeForHorse(h,r)}</span><b class="predictionHorseName">${esc(h.horse_name)}${displayFinishInfo?` <small class="finishPositionBadge" title="Resmî bitiriş sırası" style="font-size:.8em;white-space:nowrap">(${displayFinishInfo.pos}.)</small>`:''}</b>${nonRunner?' <span class="badge" style="background:#e5e7eb;color:#475569;">KOŞMAZ</span>':''}</div>
      </td>
      <td class="num kgCell">${kgCellHTML(h)}</td>
      <td class="num stCell">${(()=>{const v=analysisNumericValue(h?.start_no??h?.st??h?.start??h?.kulvar);return v===null?'-':v;})()}</td>
      <td class="num hndkpCell" title="Resmî handikap puanı (HP)">${(()=>{const v=analysisNumericValue(h?.hndkp);return v===null?'-':v;})()}</td>
      ${(()=>{
        // İç katsayı tek başına kullanıcı için anlamlı bir TKP puanı değildir.
        // Ayak tablosu ortak puanı eski TKP ile birleştirir, görünen değeri /3 ölçeğine
        // indirir ve 10,00 üst sınırını uygular. Eski/donmuş kayıtta eski 12 tavanlı
        // değer varsa geriye dönük olarak aynı /3 ölçeğiyle gösterilir.
        const common=Number(h?.tkp_common_evidence);
        const hasCommon=Number.isFinite(common)&&common>0;
        const shown=typeof tkpRaceVisibleDisplayScore==='function'
          ? tkpRaceVisibleDisplayScore(r,h)
          : (typeof tkpVisibleDisplayScore==='function'
            ? tkpVisibleDisplayScore(h,hasCommon?common*100:undefined)
            : (hasCommon?Math.round(Math.max(0,Math.min(10,(common*10+Math.max(0,Number(h?.score)||0))/3))*100)/100:null));
        const common100=hasCommon?common*100:0;
        const color=hasCommon?(common100>=75?'#166534':common100>=55?'#a16207':'#9f1239'):scoreColor(h.score);
        return `<td class="num tkpCell" title="${hasCommon?'TKP = ((Ortak Puan × 0,10) + eski TKP) / 3 · Üst sınır 10,00 · AGF, PROF, Y.PUAN, G.PR, DRC ve gerçek TR PUAN ortak hesabı':'Kayıtlı eski TKP skoru / 3 ölçeği'}">${shown!=null?`<b style="font-size:10.5px;color:${color};">${fmt2(shown)}</b>`:(Number(h.score)>0?`<b style="font-size:10.5px;color:${color};">${fmt2(typeof tkpScaleVisibleScore==='function'?tkpScaleVisibleScore(h.score):h.score)}</b>`:'-')}</td>`;
      })()}
      <td class="num agfCell">${Number(h.agf)>0 ? `<b style="font-size:10.5px;color:#dc2626;">%${Math.round(h.agf)}</b>` : '-'}</td>
      <td class="num ruleCell">${rulePctHTML(h,r)}</td>
      <td class="num ypuanCell${realBmb?' bmbSignalCell':hasOdb?' odbSignalCell':''}" title="${esc(ypuanSourceTitle(h))}">${nonRunner?`<b>${Number(h?.ypuan)>0?Math.round(Number(h.ypuan)):'-'}</b>`:ypuanTwitterHTML(h)}${nonRunner?'':ypuanSignalSquaresHTML(h,r)}</td>
      <td class="num pastWinCell" style="text-align:center;">${pastWinCellHTML(h,r)}</td>
      <td class="num dereceCell">${dereceCellHTML(h)}</td>
      <td class="num ganyanTrCell">${ganyanCanavariTrCellHTML(h)}</td>
      <td class="supportCell${bhNearWinner?' bh-near-winner-cell':''}${bhPastWinner?' bh-past-winner-cell':''}">${nonRunner?'<span class="muted">KOŞMAZ</span>':supportSummaryHTML(h,r,bhSupportContext)}</td>
    </tr>`;
  }).join('');
  return `<div class="tableWrap proPredTable" data-result-view="${esc(globalThis.TKP_RESULT_VIEW?.identity(r)||'')}"><table>
    <colgroup>
      <col style="width:3.2%">
      <col style="width:22.5%">
      <col style="width:3.2%">
      <col style="width:2.8%">
      <col style="width:3.2%">
      <col style="width:4.4%">
      <col style="width:4.4%">
      <col style="width:4.2%">
      <col style="width:7.2%">
      <col style="width:4.0%">
      <col style="width:6.2%">
      <col style="width:4.7%">
      <col style="width:30.0%">
    </colgroup>
    <thead><tr>
      <th class="num">Sıra</th>
      <th>AT ADI</th>
      <th class="num">KG</th>
      <th class="num">ST</th>
      <th class="num" title="Resmî handikap puanı">HND</th>
      <th class="num">TKP</th>
      <th class="num">AGF</th>
      <th class="num">PROF</th>
      <th class="num" title="Gerçek Y.PUAN / X gölge +puanı; tahmine uygulanmaz"><span class="ypuanXHead">Y.PU+X</span></th>
      <th class="num">G.PR</th>
      <th class="num">DRC</th>
      <th class="num" title="Ganyan Canavarı programı · forma yanındaki p sütunu; ayak içi sırası AGF sinyaline katkı verir">TR PU.</th>
      <th>DESTEKLER</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  ${agfWarningHTML}
  ${resultWarningHTML}
  <div class="predLegend">
    <span class="badge real-bmb" title="★ ODS GERÇEK BMB">BMB</span>
    <span class="badge template-bmb">ODB</span>
    <span class="badge result6">SONUÇ İLK 6</span>
    <span class="badge tkp">TKP</span>
    <span class="badge history">GEÇMİŞ</span>
  </div>`;
}

function scoreOutcomeCalibrationForDisplay(race,horse,rawConfidence){
  try{
    return typeof tkpScoreCalibratedConfidence==='function'
      ?tkpScoreCalibratedConfidence(race,horse,rawConfidence)
      :null;
  }catch(_){ return null; }
}

// Ham şart/puanı tekrar hesaplamaz: yalnız daha eski sonuçlanmış lider
// snapshotlarının kanıtını Güven yanında gösterir. Aynı gün/ge gelecek veri bu
// katmana merkezi zaman kesimi nedeniyle hiç giremez.
function scoreOutcomeCalibrationInlineHTML(race,horse,rawConfidence,compact=false){
  const d=scoreOutcomeCalibrationForDisplay(race,horse,rawConfidence);
  if(!d) return '';
  const title=esc(`Sonuç-kalibre güven: ${d.level||'Veri yok'} · ${d.band?.label||'-'} skor bandı · ham model %${Math.round(Number(d.rawConfidence)||0)}. Kupon/TEK seçimi değişmez.`);
  const style='display:inline-block;color:#475569;font-size:9px;font-weight:750;line-height:1.2;';
  if(!d.total){
    return `<span class="scoreOutcomeCalibration" style="${style}" title="${title}">Geçmiş yok · kalibre %${Math.round(Number(d.calibratedConfidence)||0)}</span>`;
  }
  const rate=Math.round(Number(d.rate||0)*100),lb=Math.round(Number(d.lowerBound||0)*100);
  const prefix='Benzer geçmiş';
  return `<span class="scoreOutcomeCalibration" style="${style}" title="${title}">${prefix}: ${d.wins}/${d.total} · %${rate} · alt %${lb} · kalibre %${Math.round(Number(d.calibratedConfidence)||0)}</span>`;
}

function confidenceHeroHTML(x){
  const d=dynamicSingleDecision(x);
  const rawPct=Math.max(0,Math.min(100,Math.round(Number(d.confidence)||0)));
  const leader=d.first||x?.top||(x?.scored||[])[0]||null;
  // Görünen Ayak Güveni, İlk Bakış ile aynı sonuç-kalibre yüzdeyi kullanır.
  // Ham TEK motoru kupon kararını korur; ancak küçük/çelişkili örneklem ham %100'ü
  // kullanıcıya kesin güven gibi gösteremez.
  const calibration=scoreOutcomeCalibrationForDisplay(x?.r,leader,rawPct);
  const pct=calibration?Math.max(0,Math.min(100,Math.round(Number(calibration.calibratedConfidence)||0))):rawPct;
  const color=pct>=d.threshold?'#16a34a':(pct>=70?'#2563eb':(pct>=50?'#d99000':'#e11d48'));
  const displaySingle=d.isSingle===true&&pct>=Number(d.threshold||68);
  const label=displaySingle?'TEK UYGUN':(d.isSingle===true?'KANIT DÜŞÜK':(pct>=70?'GÜÇLÜ':(pct>=50?'ORTA':'ZAYIF')));
  const cls=displaySingle?'veryStrong':(pct>=70?'strong':(pct>=50?'medium':'weak'));
  const rr=32,c=2*Math.PI*rr,off=c*(1-pct/100);
  const benterStatus=String(leader?.tkp_benter_status||'');
  const benterEdge=Number(leader?.tkp_benter_edge);
  const benterSource=String(leader?.tkp_benter_market_source||'');
  const benterLine=benterSource&&benterSource!=='YOK'
    ? `<div class="muted" style="font-size:9.5px;margin-top:3px;">Benter <b>${esc(String(leader?.tkp_benter_label||'Değer yok'))}</b>${Number.isFinite(benterEdge)?` · kenar %${Math.round(benterEdge*100)}`:''} · ${esc(benterSource)}</div>`
    : '<div class="muted" style="font-size:9.5px;margin-top:3px;">Benter · piyasa yok</div>';
  return `<div class="confidenceCard ${cls}">
    <div class="confidenceTitle">🏆 ${x.r.leg}. AYAK GÜVENİ</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:7px;margin-top:3px;">
      <div>
        <div class="confidenceWord" style="color:${color};">${label}</div>
        <div class="muted" style="font-size:10.5px;margin-top:5px;">TEK <b style="color:#111827;">%${d.threshold}</b> · ham %${rawPct}</div>
        <div class="muted" style="font-size:10px;margin-top:3px;">${esc(broadConditionKey(x.r.condition_family))} · ${d.sample} geçmiş koşu</div>
        <div style="margin-top:4px;line-height:1.25;">${scoreOutcomeCalibrationInlineHTML(x?.r,leader,rawPct,false)}</div>
        ${benterLine}
        ${d.isSingle===true&&!displaySingle?'<div class="muted" style="font-size:9.5px;margin-top:3px;">Ham TEK · kanıt yetersiz.</div>':''}
      </div>
      <svg viewBox="0 0 82 82">
        <circle cx="41" cy="41" r="${rr}" fill="none" stroke="#e5e7eb" stroke-width="8"/>
        <circle cx="41" cy="41" r="${rr}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 41 41)"/>
        <text x="41" y="48" text-anchor="middle" font-size="19" font-weight="950" fill="#111827">%${pct}</text>
      </svg>
    </div>
  </div>`;
}

// İlk Bakış Veri Sentezi'nin ortak hesabı. Ham TKP tek başına yeterli olmadığı
// için AGF, profil, Y.PUAN ve küçük örneklemde kademeli G.PR ile birleştirilir.
function tkpEvidenceSynthesisScore(race,horse){
  // Ana TKP hesabı yüklüyse İlk Bakış ve H etiketi onunla bire bir aynı ortak
  // veri hesabını kullanır. Böylece tabloda görünen AGF/PROF/Y.PU+X/G.PR/DRC/TR
  // sütunları ile "Veri Sentezi" farklı iki puan üretmez.
  if(typeof tkpCommonEvidenceForHorse==='function'){
    const common=tkpCommonEvidenceForHorse(race,horse);
    return {
      score:Math.round((Number(common?.value)||0)*100),
      parts:(common?.parts||[]).map(([name,value,weight])=>[name,Math.round((Number(value)||0)*100),weight]),
      missing:common?.missing||[]
    };
  }
  const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race?.horses||[]).filter(h=>h&&!isNonRunner(h));
  const bounded=v=>Math.max(0,Math.min(100,Number(v)||0));
  const rawScore=Number(horse?.score),tkp=Number.isFinite(rawScore)&&rawScore>0?bounded(100*rawScore/(rawScore+.50)):null;
  const agf=Number(horse?.agf),agfPct=Number.isFinite(agf)&&agf>0?bounded(agf):null;
  const profile=typeof profileStrengthPct==='function'?bounded(profileStrengthPct(race,horse)):null;
  // NOT: Bu blok yalnız tkpCommonEvidenceForHorse tanımsızsa çalışır (pratikte
  // hiç olmaz, app-controller.js her zaman yüklü). X/Keşif katkısı bilerek
  // buraya eklenmedi -- gerçek yol zaten yukarıdaki tkpCommonEvidenceForHorse
  // devriyle çalışıyor ve oradaki %8'lik X/Keşif ağırlığını otomatik taşıyor.
  const yRaw=Number(horse?.ypuan),yValue=Number.isFinite(yRaw)&&yRaw>0?yRaw:null;
  const yPool=live.map(h=>Number(h?.ypuan)).filter(v=>Number.isFinite(v)&&v>0);
  const ypuan=yValue!=null&&yPool.length?bounded(100*yValue/Math.max(...yPool)):null;
  const starts=Math.max(0,Number(horse?.gpr_starts)||Number(horse?.condWinStarts)||Number(horse?.priorStarts)||0),wins=Math.max(0,Number(horse?.gpr_wins)||Number(horse?.condWinWins)||Number(horse?.priorWins)||0);
  const gpr=starts>0?bounded(100*(wins/starts)*Math.min(1,Math.sqrt(starts/12))):null;
  const parts=[['TKP',tkp,24],['AGF',agfPct,20],['PROF',profile,20],['Y.PUAN',ypuan,18],['G.PR',gpr,18]].filter(([,v])=>v!=null);
  const weight=parts.reduce((sum,[,,w])=>sum+w,0),score=weight?Math.round(parts.reduce((sum,[,v,w])=>sum+v*w,0)/weight):0;
  return {score,parts,missing:['TKP','AGF','PROF','Y.PUAN','G.PR'].filter(label=>!parts.some(([name])=>name===label))};
}

// TEK GÖRÜNÜR TKP OTORİTESİ: İlk Bakış, Ayak Detayı, A4 ve diğer görünür
// yollar aynı yarış+at girdisinden aynı puanı alır. Bitmiş/kilitli kayıtta
// tkpVisibleDisplayScore frozen snapshot'ı önceliklendirir; canlı kayıtta ise
// güncel ortak kanıt eski tkp_display_* cache'inin önüne geçer.
function tkpRaceVisibleDisplayScore(race,horse){
  if(!horse) return null;
  let fallback=null;
  const frozen=Number(horse?.prediction_score_locked)===1 && Number.isFinite(Number(horse?.prediction_score_snapshot));
  if(!frozen){
    try{
      const evidence=tkpEvidenceSynthesisScore(race,horse);
      if(Number.isFinite(Number(evidence?.score)) && Number(evidence.score)>0) fallback=Number(evidence.score);
    }catch(_){ }
  }
  if(typeof tkpPredictionSnapshotView==='function')return tkpPredictionSnapshotView(horse,race,fallback).visibleTkp;
  if(typeof tkpVisibleDisplayScore==='function') return tkpVisibleDisplayScore(horse,fallback);
  const raw=Number(horse?.tkp_display_score ?? horse?.score);
  return Number.isFinite(raw)?raw:null;
}

// H = yüksek belirsizlik / çoklu ayak. Güven yüzdesinden ayrı olarak doğrudan
// Veri Sentezi dağılımını ölçer: lider zayıfsa ve ilk dört at dar bir banttaysa tek/dar
// yorum yapılmaz. Bu sınıf kupon bandını genişletme uyarısıdır, tahmin sırasını
// veya BMB tanımını değiştirmez.
function tkpHighUncertaintyLeg(x){
  const archiveFast=typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x);
  const scores=(x?.scored||[]).filter(h=>!isNonRunner(h)).map(h=>archiveFast
    ? (typeof tkpArchivedEvidenceScore==='function'?tkpArchivedEvidenceScore(x?.r,h):0)
    : tkpEvidenceSynthesisScore(x?.r,h).score
  ).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>b-a);
  const top=scores[0]||0, fourth=scores[3]||0, sixth=scores[5]||0;
  const isH=scores.length>=4&&top<75&&(top-fourth)<=12;
  return {isH,top,fourth,sixth,field:scores.length};
}

function tkpAdviceSameRace(a,b){
  if(!a||!b) return false;
  try{ if(typeof v25SameRaceForCouponSingle==='function') return v25SameRaceForCouponSingle(a,b); }catch(_){ }
  if(Number(a.leg)!==Number(b.leg)) return false;
  const ad=String(a.race_date||''),bd=String(b.race_date||'');
  if(ad&&bd&&ad!==bd) return false;
  const ah=String(a.hippodrome||'').trim().toLocaleUpperCase('tr-TR'),bh=String(b.hippodrome||'').trim().toLocaleUpperCase('tr-TR');
  if(ah&&bh&&ah!==bh) return false;
  const aa=Number(a.altili_no)||1,ba=Number(b.altili_no)||1;
  return aa===ba;
}
function tkpAdviceSameHorseOrEkuri(a,b){
  const aa=String(a?.horse_no??a??'').trim(),bb=String(b?.horse_no??b??'').trim();
  if(!aa||!bb) return false;
  if(aa===bb) return true;
  try{ if(typeof sameEkuri==='function'&&sameEkuri(aa,bb)) return true; }catch(_){ }
  const ga=typeof ekuriGroup==='function'?ekuriGroup(aa):(aa.match(/-(E\d+)$/i)?.[1]||'');
  const gb=typeof ekuriGroup==='function'?ekuriGroup(bb):(bb.match(/-(E\d+)$/i)?.[1]||'');
  return !!ga&&!!gb&&String(ga).toUpperCase()===String(gb).toUpperCase();
}
function tkpAdviceNormalCouponLeg(x){
  try{
    const coupon=(typeof activeCoupons!=='undefined'&&activeCoupons)?activeCoupons.main:null;
    if(!coupon||coupon.error||!Array.isArray(coupon.legs)) return null;
    return coupon.legs.find(leg=>leg?.r&&tkpAdviceSameRace(leg.r,x?.r))||null;
  }catch(_){ return null; }
}
function tkpAdviceOrderedPicks(x,source){
  const rows=predictionDisplayRows(x,Infinity,'score-desc').rows||[];
  const rank=new Map(rows.map((h,i)=>[String(h?.horse_no||''),i]));
  return (source||[]).filter(Boolean).slice().sort((a,b)=>(rank.get(String(a?.horse_no||''))??999)-(rank.get(String(b?.horse_no||''))??999));
}
function tkpAdvicePickTokens(x,picks){
  const ordered=tkpAdviceOrderedPicks(x,picks);
  const summary=ordered.map(h=>esc(h.horse_no)).join(' / ');
  const html=ordered.map(h=>{
    const rawNo=String(h.horse_no||'');
    const visualNo=rawNo.replace(/-E\d+$/i,'');
    return `<span class="adviceHorseToken">${esc(visualNo)}${ekuriBadgeForHorse(h,x.r)}</span>`;
  }).join('<span class="adviceHorseSep">/</span>');
  return {ordered,summary,html};
}

function recommendedHorsePanelHTML(x){
  const couponLeg=tkpAdviceNormalCouponLeg(x);
  const couponReady=!!(couponLeg&&Array.isArray(couponLeg.picks)&&couponLeg.picks.length);
  // 5. DÜZELTME: Bu panel artık Normal Altılı kuponu oluştuktan sonra ayrı bir
  // aday listesi göstermiyor. Ana satır doğrudan kupondaki gerçek seçimlerden gelir.
  // Ayak önerisinin bütçe nedeniyle dışarıda kalan adayları ise kaybolmaz; alt satırda
  // açıkça gösterilir. Aynı eküri grubu kupondaki temsilciyle kapsanıyorsa "sığmayan"
  // sayılmaz; resmi eküri eşdeğerliği nedeniyle ikinci kez kolon şişirilmez.
  // Küçük Ayak Önerisi tablosu kuponun bütçe budamasını KOPYALAMAZ.
  // Görünür tahmin/TKP sırasındaki ilk plan.count atı gösterir; böylece örneğin
  // 4. sıradaki 12 SELLYGIRL sırf Normal kupona sığmadı diye ekrandan kaybolmaz.
  const visibleRankRows=predictionDisplayRows(x,Infinity,'score-desc').rows.filter(h=>!isNonRunner(h));
  // Kupon üretildikten sonra Ayak Önerisi aynı ayaktaki gerçek kupon sırasını
  // birebir göstermeli; yeniden sıralamak kupon ile TKP görünümünü ayırıyordu.
  // Kupon hazirken agir tarihsel kapsama hesabini yeniden calistirma. Tablodaki
  // TKP 0,85+ adaylari ucuz ve deterministik sığmayan-aday havuzudur.
  const quickStrong=visibleRankRows.filter(h=>Number(typeof tkpCouponVisibleScore==='function'?tkpCouponVisibleScore(h):(h?.tkp_display_score??h?.score))>=.85);
  const plan=couponReady?{picks:quickStrong,count:quickStrong.length,reason:couponLeg.distributionPlan?.reason||'Kesin Normal kupon seçimi; ayak ve bütçe planı birlikte uygulanır.'}:historicalCoveragePlan(x);
  const planPicks=tkpAdviceOrderedPicks(x,plan.picks||[]);
  const targetCount=Math.max(1,Math.min(visibleRankRows.length,Number(plan.count)||planPicks.length||1));
  const mainPicks=couponReady?couponLeg.picks.filter(Boolean).slice():visibleRankRows.slice(0,targetCount);
  // Planin guclu aday havuzu kupon butcesinden genis olabilir. Bu adaylari
  // sessizce kaybetme; kuponda olmayanlari ayri ve acik bir satirda goster.
  const excluded=couponReady?planPicks.filter(candidate=>!couponLeg.picks.some(pick=>tkpAdviceSameHorseOrEkuri(candidate,pick))):[];
  if(!mainPicks.length){
    return `<div class="tkpAdviceSyncPanel" data-advice-panel-leg="${esc(x?.r?.leg||'')}">${panelCardHTML('🎯 Ayak Önerisi',
      `<div style="padding:4px 0;color:#991b1b;font-weight:900;font-size:11px;">Uygun aday bulunamadı</div>`)}</div>`;
  }

  const shown=tkpAdvicePickTokens(x,mainPicks);
  const excludedTokens=tkpAdvicePickTokens(x,excluded);
  const isRealSingle=!!(couponReady?mainPicks.length===1:(plan.singleDecision&&plan.singleDecision.isSingle));
  // Plan count may be zero when the historical pool is unavailable even though
  // the visible race rows still provide a valid fallback candidate. The heading
  // must describe what is actually shown, rather than the unavailable plan.
  const heading=isRealSingle?(couponReady?'NORMAL KUPONDA TEK':'TEK ADAYI'):(couponReady?`${mainPicks.length} AT KUPONDA`:`${mainPicks.length} AT ADAYI`);
  const color=isRealSingle?'#166534':(mainPicks.length<=2?'#1d4ed8':(mainPicks.length<=4?'#a16207':'#9f1239'));
  const bg=isRealSingle?'#ecfdf3':(mainPicks.length<=2?'#eff6ff':(mainPicks.length<=4?'#fffbeb':'#fff1f2'));
  const excludedHtml=excluded.length
    ? `<div class="adviceBudgetExcluded" style="margin-top:6px;padding:5px 6px;border-radius:7px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-size:10px;font-weight:850;"><b>Kupona sığmadı:</b> <span style="display:inline-flex;flex-wrap:wrap;align-items:center;gap:0;">${excludedTokens.html}</span></div>`
    : '';
  const syncNote=couponReady?'<div style="margin-top:4px;font-size:9.5px;color:#64748b;font-weight:750;">Ana satır Normal Altılı kuponuyla senkron.</div>':'';

  return `<div class="tkpAdviceSyncPanel" data-advice-panel-leg="${esc(x?.r?.leg||'')}">${panelCardHTML('🎯 Ayak Önerisi',
    `<div style="padding:7px;border-radius:9px;background:${bg};border:1px solid #dbe4ef;">
      <div style="font-size:13px;font-weight:950;color:${color};margin-bottom:7px;">${heading}</div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0;line-height:1.55;">${shown.html}</div>
      <div style="margin-top:5px;font-size:10.5px;color:#64748b;font-weight:750;">No: ${shown.summary}</div>
      ${excludedHtml}${syncNote}
      <div style="margin-top:6px;font-size:10.5px;color:#334155;line-height:1.4;font-weight:650;">${esc(couponReady?(couponLeg.distributionPlan?.reason||'Kesin Normal kupon seçimi; ayak ve bütçe planı birlikte uygulanır.'):plan.reason)}</div>
    </div>`)}</div>`;
}

function refreshRecommendedHorsePanelsFromCoupon(){
  try{
    if(typeof document==='undefined'||!Array.isArray(lastRaceResults)||!lastRaceResults.length) return false;
    const root=document.getElementById('predictionResult');if(!root)return false;
    const overview=root.querySelector('#tkpNormalCouponDecision');
    if(overview)overview.outerHTML=tkpNormalCouponDecisionHTML(lastRaceResults);
    let changed=0;
    for(const x of lastRaceResults){
      const old=root.querySelector(`.tkpAdviceSyncPanel[data-advice-panel-leg="${String(x?.r?.leg||'')}"]`);
      if(!old)continue;
      old.outerHTML=recommendedHorsePanelHTML(x);changed++;
    }
    return changed>0;
  }catch(_){ return false; }
}

function tkpNormalCouponDecisionHTML(rows){
  return ''; // R18.6: kupon kartında zaten görünen TEK özeti tekrar edilmez.
  const legs=(rows||[]).map(x=>({x,leg:tkpAdviceNormalCouponLeg(x)}));
  if(!legs.length||legs.some(z=>!z.leg)){
    const archived=typeof activeCoupons!=='undefined'&&activeCoupons?.main?.readOnlySnapshot;
    return `<div id="tkpNormalCouponDecision" class="card strongTkpOverviewCard"><b>${archived?'Kayıtlı Normal kupon üstte gösteriliyor.':'Normal kupon henüz oluşturulmadı.'}</b><div class="muted">${archived?'Güncel TEK ve dağılım analizi için yeniden hesapla.':'Kesin TEK ve ayak dağılımı kupon tamamlanınca burada gösterilir.'}</div></div>`;
  }
  const singles=legs.filter(z=>z.leg.picks?.length===1);
  if(!singles.length) return '';
  const singleHTML=singles.map(({x,leg})=>`<span class="badge">${esc(x.r.leg)}. AYAK · TEK: ${esc(leg.picks[0].horse_no)} ${esc(leg.picks[0].horse_name||'')}</span>`).join(' ');
  return `<div id="tkpNormalCouponDecision" class="card strongTkpOverviewCard tkpSinglesOnlyOverview"><h2>Normal Kupon · ${singles.length} TEK</h2><div>${singleHTML}</div></div>`;
}

function buildLegPaneHTML(x, cs, soloCoupon, placeCoupon){
  const {r, scored, top, margin}=x;
  const live=(scored||[]).filter(h=>!isNonRunner(h));
  const miss=live.filter(h=>h.result_rank==null).length;
  const quality=scored.length?Math.round(100*(1-miss/scored.length)):100;
  const csText=cs.races
    ? (cs.races>=TKP_MIN_PERCENT_SAMPLE
      ? `${cs.source==='exact'?`<b>${esc(r.condition_family)}</b> şartında`:`Benzer <b>${esc(cs.label)}</b> şartlarında`} ${cs.races} geçmiş koşu incelendi. SONUÇ 1. sıra kazanma %${cs.result1Pct}${cs.bmbRaces>=TKP_MIN_PERCENT_SAMPLE?`, BMB başarı %${cs.bmbPct}`:''}.`
      : `${cs.source==='exact'?`<b>${esc(r.condition_family)}</b> şartında`:`Benzer <b>${esc(cs.label)}</b> şartlarında`} ${cs.races} geçmiş koşu var. <b>n=${cs.races}; yüzde henüz gösterilmiyor.</b>`)
    : `<b>${esc(r.condition_family)}</b> için yeterli geçmiş koşu henüz yok.`;
  const ps=profileSingleDecision(x);
  const hRisk=tkpHighUncertaintyLeg(x);
  const threshold=hRisk.isH
    ? `<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;font-size:10px;font-weight:900;">H · YÜKSEK BELİRSİZLİK: TKP lideri ${fmt2(hRisk.top/10)}, ilk 4 bant ${fmt2(hRisk.fourth/10)}–${fmt2(hRisk.top/10)}. Veriler yakın; bu ayak çoklu/geniş kupon bandında kalmalı.</div>`
    : !ps.isSingle
      ? `<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-size:10px;font-weight:850;">TEK koşulu sağlanmadı: güven %${Math.round(Number(ps.confidence)||0)} / eşik %70${ps.reason&&String(ps.reason).includes('>60')?' · 60 kg üstü TEK yasağı':''}. Bu ayakta çoklu güvenlik kullanılacak.</div>`
      : `<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:#ecfdf3;border:1px solid #86efac;color:#166534;font-size:10px;font-weight:850;">%68 güven TEK koşulu sağlandı: ${esc(ps.first?.horse_no||'')} numara · Güven %${Math.round(Number(ps.confidence)||0)}${ps.profile<70||ps.gap<10?` · yardımcı profil uyarısı: %${ps.profile}, fark ${ps.gap}`:''}.</div>`;
  return `<div class="predProShell">
    ${legInfoBarHTML(r,quality)}
    <div class="predWorkspace">
      <main class="predMain">
        <div class="predProfileNote">📌 ${csText}</div>
        ${legTableHTML(x)}
        ${threshold}
      </main>
      <aside class="predSide">
        ${confidenceHeroHTML(x)}
        ${recommendedHorsePanelHTML(x)}
        ${veriKontrolPanelHTML(r,scored)}
        ${celiskiPanelHTML(x)}
      </aside>
    </div>
  </div>`;
}

function couponVariantHTML(res){
  if (res.error) return `<div class="card couponCard" style="border-left:4px solid #dc2626;">${esc(res.error)}</div>`;
  // Görsel son güvence: eski/kayıtlı bir sonuçtan gelen tekrarlar da ekrana basılmadan temizlenir.
  for(const leg of (res.legs||[])) leg.picks=dedupeEkuri(leg.picks,leg.r,res.typeKey||'main');
  const theme = res.typeKey==='alt'
    ? {border:'#64748b'}
    : (res.typeKey==='surprise' ? {border:'#7c3aed'} : {border:'#15803d'});

  function horseLine(p, isTek, legCtx){
    const badges = signalBadgesHTML(p);
    const ekuriBadge = ekuriBadgeForHorse(p, legCtx?.r);
    const isActualWinner = legCtx && raceHasConfirmedResult(legCtx.r.horses) && (Number(p.winner)===1 || Number(p.finish_position)===1);
    return `<span class="couponHorse${isTek?' couponHorseTek':''}"><b class="${isActualWinner?'couponWinnerNo':''}">${esc(p.horse_no)}</b>${ekuriBadge} · ${esc(p.horse_name)}${badges}</span>`;
  }

  return `<div class="card couponCard" style="border-left:4px solid ${theme.border};">
    <h2>${res.label}</h2>
    <p class="muted couponSummary">${res.legCount}'lü Ganyan · Birim ${fmt2(res.unit)} TL · Toplam <b>${fmt2(res.cost)} TL</b> · Bütçe ${fmt2(res.budgetTL)} TL · ${res.leftover<0?'<b style="color:#b91c1c;">Eksik '+fmt2(Math.abs(res.leftover))+' TL</b>':'Kalan '+fmt2(res.leftover)+' TL'}. ${res.note}</p>
    <div class="tableWrap couponTable"><table><thead><tr><th>Ayak</th><th>Atlar</th><th class="num">Adet</th></tr></thead><tbody>
    ${res.legs.slice().sort((a,b) => a.r.leg - b.r.leg).map(x => {
      const pickedNos = new Set(x.picks.map(p => p.horse_no));
      const missedSignal = (x.allHorses || []).filter(h => (h.bmb || (h.result_rank!=null && h.result_rank<=6) || (h.agf_rank===1 && Number(h.agf)>=18)) && !pickedNos.has(h.horse_no));
      const isTek = x.picks.length === 1;
      // Kupondaki sıra, soldaki analiz tablosunda görünen sırayla birebir aynıdır.
      const displayOrder = predictionDisplayRows({r: x.r, scored: x.allHorses || []}).rows;
      const displayIndex = new Map(displayOrder.map((h,i)=>[String(h.horse_no),i]));
      const tableOrderedPicks = x.picks.slice().sort((a,b)=>(displayIndex.get(String(a.horse_no))??999)-(displayIndex.get(String(b.horse_no))??999));
      // KULLANICI TALİMATI: Altılı Ganyan'da eküri ortağı ayrı at gibi listelenmez (bkz.
      // couponVariantCompactHTML'deki aynı not). Gerçek seçim tekil kalır, rozetle işaretlenir.
      const visiblePicks = tableOrderedPicks;
      const horseDetails = visiblePicks.map(p => horseLine(p, isTek, x)).join('<span class="couponSep">/</span>');
      const numberSummary = visiblePicks.map(p => esc(p.horse_no)).join(' / ');
      let row = `<tr><td>${isTek ? `<span class="couponTek">TEK</span>` : ''}${x.r.leg}. AYAK</td><td><div class="couponHorseList">${horseDetails}</div><div class="couponNoSummary">No: <b>${numberSummary}</b></div></td><td class="num">${x.picks.length}</td></tr>`;
      if (missedSignal.length){
        row += `<tr class="couponAlertRow"><td></td><td colspan="2">⚡ Ayrıca ${missedSignal.map(h => '<b>' + esc(h.horse_no) + '</b> ' + esc(h.horse_name) + (h.bmb?' (BMB)':'') + ((h.result_rank!=null && h.result_rank<=6)?' (SONUÇ İLK 6)':'') + ((h.agf_rank===1 && Number(h.agf)>=18)?' (AGF %'+esc(h.agf)+')':'')).join(', ')} sinyali var; kapsam dışında kaldı.</td></tr>`;
      }
      return row;
    }).join('')}
    </tbody></table></div>
    <p class="muted couponFoot">Bu, geçmiş kural doğrulamasına dayanan bir yapı önerisidir; gerçek kazanma garantisi değildir.</p>
  </div>`;
}

function legHistoricalHitPct(r, pickCount){
  const d=detailedRankStats(r,'result_rank');
  let st=d.stats, sample=st.total||0, level=d.match?.level||'Ayrıntılı profil';
  if(sample<5){
    const broad=statsByCondition('result_rank')[broadConditionKey(r.condition_family)];
    if(broad&&broad.total){st=broad;sample=broad.total;level='Koşu ailesi';}
  }
  if(!sample) return null;
  let cumulative=0;
  for(let i=1;i<=Math.min(Math.max(pickCount,1),7);i++) cumulative+=(st[String(i)]||0);
  return {pct:Math.round(100*cumulative/sample), sample, level};
}

function couponCurrentRaceRows(res){
  const couponLegs=(res?.legs||[]).slice().sort((a,b)=>Number(a?.r?.leg)-Number(b?.r?.leg));
  const first=couponLegs[0]?.r||{};
  const sameMeeting=r=>{
    if(!r||String(r.race_date||'')!==String(first.race_date||''))return false;
    const a=typeof canonicalHippodrome==='function'?canonicalHippodrome(r.hippodrome||''):String(r.hippodrome||'');
    const b=typeof canonicalHippodrome==='function'?canonicalHippodrome(first.hippodrome||''):String(first.hippodrome||'');
    return a===b&&(Number(r.altili_no)||1)===(Number(first.altili_no)||1);
  };
  const live=(typeof lastRaceResults!=='undefined'&&Array.isArray(lastRaceResults))
    ?lastRaceResults.map(x=>x?.r||x).filter(sameMeeting):[];
  const grouped=new Map();
  for(const r of [...couponLegs.map(x=>x.r),...live]){
    const key=String(Number(r?.leg)||'');if(!key)continue;
    if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(r);
  }
  return [...grouped.values()].map(copies=>{
    const hasResult=r=>(r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1)?1:0;
    const base=copies.slice().sort((a,b)=>hasResult(b)-hasResult(a))[0];
    const payouts=[],seen=new Set();
    for(const p of copies.flatMap(r=>Array.isArray(r?.payouts)?r.payouts:[])){
      const sig=[p?.key,p?.label,p?.combo,p?.amount,p?.rollover?1:0].join('|');
      if(seen.has(sig))continue;seen.add(sig);payouts.push(p);
    }
    return {...base,payouts};
  }).sort((a,b)=>Number(a.leg)-Number(b.leg));
}

function couponOfficialFinance(res,payoutKey){
  const races=couponCurrentRaceRows(res);
  const candidates=races.flatMap(r=>Array.isArray(r?.payouts)?r.payouts:[]).filter(p=>{
    const key=typeof tkpCanonicalBetKey==='function'?tkpCanonicalBetKey(p?.key||p?.label):String(p?.key||'');
    return key===payoutKey;
  });
  const altNo=Number(races[0]?.altili_no||res?.legs?.[0]?.r?.altili_no)||1;
  const entry=candidates.find(p=>Number(String(p?.label||'').match(/^\s*(\d+)\s*\./)?.[1])===altNo)
    ||candidates.find(p=>!/^\s*\d+\s*\./.test(String(p?.label||'')))||candidates[0]||null;
  let knownLegs=0,hitLegs=0;
  for(const leg of (res?.legs||[])){
    const race=races.find(r=>Number(r?.leg)===Number(leg?.r?.leg))||leg?.r;
    const winner=(race?.horses||[]).find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
    if(!winner)continue;knownLegs++;
    if((leg?.picks||[]).some(p=>String(p?.horse_no)===String(winner.horse_no)||(typeof sameEkuri==='function'&&sameEkuri(p?.horse_no,winner.horse_no))))hitLegs++;
  }
  const complete=knownLegs===Number(res?.legCount||res?.legs?.length||0)&&knownLegs>0;
  const hit=complete&&hitLegs===knownLegs,cost=Number(res?.cost)||0;
  const payoutAmount=entry&&!entry.rollover?(Number(entry.amount)||0):null;
  const ret=hit&&payoutAmount!=null?payoutAmount:0,net=ret-cost,roi=cost?net/cost*100:0;
  return {entry,knownLegs,hitLegs,complete,hit,cost,payoutAmount,ret,net,roi};
}

function couponFinanceHTML(res,payoutKey){
  if(!payoutKey)return '';
  const f=couponOfficialFinance(res,payoutKey);
  const product=({6:"6'lı",5:"5'li",4:"4'lü",3:"3'lü"})[Number(res.legCount)]||`${res.legCount}'li`;
  if(!f.complete)return `<div class="couponFinanceBox waiting"><b>PARASAL SONUÇ BEKLENİYOR</b><span>Sonuç: ${f.knownLegs}/${res.legCount} ayak tamamlandı.</span></div>`;
  if(!f.entry)return `<div class="couponFinanceBox missing"><b>RESMÎ İKRAMİYE ALINAMADI</b><span>Sonuç: ${f.hitLegs}/${f.knownLegs} · Maliyet: ${fmt2(f.cost)} TL</span><span>TJK ödeme kartı gelmeden bu toplantı parasal olarak tamamlanmış sayılmaz.</span></div>`;
  if(f.entry.rollover)return `<div class="couponFinanceBox rollover"><b>HAVUZ DEVRETTİ</b><span>Sonuç: ${f.hitLegs}/${f.knownLegs} · Maliyet: ${fmt2(f.cost)} TL</span></div>`;
  const sign=f.net>0?'+':'',cls=f.hit?'hit':'miss';
  return `<div class="couponFinanceBox ${cls}"><b>${f.hit?'KAZANDI':'KAZANMADI'} · ${f.hitLegs}/${f.knownLegs}</b><span>Resmî ${product} ikramiye: <strong>${fmt2(f.payoutAmount)} TL</strong></span><span>Kupon getirisi: <strong>${fmt2(f.ret)} TL</strong> · Maliyet: ${fmt2(f.cost)} TL</span><span>Net: <strong>${sign}${fmt2(f.net)} TL</strong> · ROI: <strong>${sign}${fmt2(f.roi)}%</strong></span></div>`;
}

function tkpCouponDisplayAccounting(source){
  if(!source||source.error||!Array.isArray(source.legs))return source;
  const res={...source};
  const widths=res.legs.map(l=>Array.isArray(l.picks)?l.picks.length:0);
  res.combos=widths.length?widths.reduce((a,b)=>a*b,1):0;
  res.cost=Math.round(res.combos*Math.max(0,Number(res.unit)||0)*100)/100;
  res.leftover=(Number(res.budgetTL)||0)-res.cost;
  const outside=widths.length===6&&(res.cost<1000||res.cost>1400);
  const mismatch=Math.abs(res.cost-(Number(source.cost)||0))>.009;
  const notes=[];
  if(res.singlePolicyWarning)notes.push(res.singlePolicyWarning);
  if(outside)notes.push('Güncel 1.000–1.400 TL bütçe şartını sağlamıyor.');
  if(mismatch)notes.push('Kayıtlı tutar seçimlerle uyuşmuyor; görünen seçimlerin tutarı hesaplandı.');
  res.displayAccountingNote=notes.join(' ');
  return res;
}
function tkpCouponRoleDisplayOrder(leg,typeKey){
  const pool=leg.allHorses?.length?leg.allHorses:leg.r?.horses||[];
  // The decision's saved order is authoritative for all three roles. Rendering
  // must never rerun the generic strategy or change an archived expert decision.
  const saved=leg.policyAudit?.input?.map(h=>h.no)||leg.selectionOrderNos;
  const order=saved?.length?saved:(leg.ordered?.length?leg.ordered:pool).map(h=>String(h.horse_no));
  const byNo=new Map([...pool,...(leg.picks||[])].map(h=>[String(h.horse_no),h]));
  const rows=[],seen=new Set();
  for(const n of [...order,...byNo.keys()]){const h=byNo.get(String(n));if(h&&!seen.has(String(n))){rows.push(h);seen.add(String(n));}}
  return rows;
}
function couponVariantCompactHTML(res, shortTitle){
  res=globalThis.TKP_RESULT_VIEW?.coupon(res)||res;
  res=tkpCouponDisplayAccounting(res);
  // R18.9 eski/yeni kupon görünümü: frozen BH snapshotı varsa aynı 6/7/8+ kapsama kilidini görünür kupona da uygula.
  try{if(typeof tkpApplyBmbRescueSwap==='function')tkpApplyBmbRescueSwap(res);}catch(_){ }
  const editingLocked=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked(typeof lastRaceResults!=='undefined'?lastRaceResults:[]);
  if (res.error) return `<div class="card budgetCouponCompact" style="border-left:4px solid #dc2626;"><h2>${esc(shortTitle)}</h2><p class="compactMeta">${esc(res.error)}</p></div>`;
  const border = res.typeKey==='surprise' ? '#7c3aed' : (res.typeKey==='main2' ? '#2563eb' : '#15803d');
  const rows = res.legs.slice().sort((a,b)=>a.r.leg-b.r.leg).map(x=>{
    const displayOrder = tkpCouponRoleDisplayOrder(x,res.typeKey);
    const displayIndex = new Map(displayOrder.map((h,i)=>[String(h.horse_no),i]));
    const picks = x.picks.slice().sort((a,b)=>(displayIndex.get(String(a.horse_no))??999)-(displayIndex.get(String(b.horse_no))??999));
    const isTek = picks.length===1;
    const hasResult = raceHasConfirmedResult(x.r.horses);
    const canRemove = !editingLocked && picks.length>1;
    const pickedNos = new Set(picks.map(p=>String(p.horse_no)));
    // KULLANICI TALİMATI: Altılı Ganyan kuponunda (Normal/Geniş/Sürpriz) bir eküri
    // seçildiğinde ortağı ayrı bir at gibi listelenmesin — gerçek biletde tek numara
    // işaretlenir, ikisi otomatik aynı sonucu paylaşır. Önceden ekuriDisplayHorses()
    // ortağı da ayrı bir "x" ile eklenmiş at gibi gösteriyordu (ör. "6-E1 x 7-E1"),
    // bu da sanki 2 ayrı at seçilmiş gibi yanıltıcıydı. Artık yalnız gerçek seçim
    // gösterilir; eküri grubu küçük bir rozetle (E1) belirtilir. Yan bahislerde
    // (sideBetPoolHTML/ekuriDisplayNos) bu değişikliğe dokunulmadı.
    const visiblePicks=picks;
    const chips = visiblePicks.map(p=>{
      // Kuponun resmi eküri kapsamı legHit'te değerlendirilir; bu at rozeti ise
      // Eküri resmi olarak birlikte değerlendirildiği için ortaklardan biri
      // kazandığında kupondaki seçili diğer ortak da kazanmış işaretlenir.
      const officialWinner = hasResult && (x.r.horses||[]).find(h=>Number(h.winner)===1 || Number(h.finish_position)===1);
      const isWinner = !!(officialWinner && (
        Number(p.winner)===1 ||
        Number(p.finish_position)===1 ||
        String(p.horse_no)===String(officialWinner.horse_no) ||
        sameEkuri(p.horse_no,officialWinner.horse_no)
      ));
      const badge = ekuriBadgeForHorse(p,x.r);
      // horse_no zaten 7-E1 biçimindeyken yanına ikinci kez E1 rozeti eklenmesin.
      // Görselde tablodakiyle aynı şekilde "7 + E1 rozeti"; veri/No özetinde 7-E1 korunur.
      const visualNo=String(p.horse_no||'').replace(/-E\d+$/i,'');
      const numHtml = isWinner ? `<span class="compactWinnerNo">${esc(visualNo)}</span>` : `<span class="compactHorseNo">${esc(visualNo)}</span>`;
      const nameHtml = isTek ? `<span class="compactTekName">${esc(p.horse_name)}</span>` : '';
      const selectedPick=picks.find(q=>String(q.horse_no)===String(p.horse_no)) || picks.find(q=>sameEkuri(q.horse_no,p.horse_no));
      const removeBtn = canRemove && selectedPick ? `<button type="button" class="couponPickRemove" data-leg="${x.r.leg}" data-horse="${esc(selectedPick.horse_no)}" title="Bu bahis seçimini kaldır">×</button>` : '';
      const pickBody = isTek
        ? `<span class="compactTekPick">${nameHtml}<span class="compactTekDot">·</span>${numHtml}${badge}</span>`
        : `${numHtml}${badge}`;
      const kulisBadge=(x.kulisPriorityNos||[]).includes(String(p.horse_no))?'<small title="Doğrulanmış yarış öncesi yorumcu desteği"> · Kulis</small>':'';
      return `<span class="couponPickChip${isTek?' couponPickChipTek':''}${isWinner?' couponPickChipWin':''}">${pickBody}${kulisBadge}${removeBtn}</span>`;
    }).join('<span class="couponSep">/</span>');
    // Sonuç girilen ayaklarda kuponun seçtiği atlar gerçek kazananı kapsıyor mu, doğrudan gösterilir.
    const winnerHorse = hasResult ? (x.r.horses||[]).find(h=>Number(h.winner)===1 || Number(h.finish_position)===1) : null;
    const legHit = !!(winnerHorse && (pickedNos.has(String(winnerHorse.horse_no)) || [...pickedNos].some(pn=>sameEkuri(pn, winnerHorse.horse_no))));
    const statusCell = !hasResult
      ? '<span class="couponLegStatus waiting">BEKLENİYOR</span>'
      : (legHit
          ? '<span class="couponLegStatus hit">TUTTU</span>'
          : `<span class="couponLegStatus miss">TUTMADI</span> <span class="compactWinnerNo">${esc(winnerHorse.horse_no)}</span>`);
    // Ekleme listesi: bu ayakta koşan, henüz seçilmemiş atlar; Tahmin sıralamasıyla aynı sırada.
    const addOptions = editingLocked?'':displayOrder.filter(h=>!isNonRunner(h) && !pickedNos.has(String(h.horse_no)) && ![...pickedNos].some(no=>sameEkuri(no,h.horse_no)))
      .map(h=>`<option value="${esc(h.horse_no)}">${esc(h.horse_no)} - ${esc(h.horse_name)}</option>`).join('');
    const addSelect = addOptions ? `<select class="legAddSelect" data-leg="${x.r.leg}"><option value="">+ At ekle</option>${addOptions}</select>` : '';
    const tekBadge = isTek ? '<span class="compactTek">TEK</span>' : '';
    // Ana kupon kartında ayrı "Teksiz" önerisi gösterilmez; bu ifade gerçek
    // kupon sanılıyor. Çoklu alternatifler yalnız ilgili yan bahis kartlarında
    // kendi başlığıyla gösterilir.
    const teksizHint='';
    // TEK rozeti ile at seçimi aynı satır konteynerinde tutulur. Böylece flex-wrap
    // TEK'i üst satıra, at kartını alt satıra item olarak bölemez.
    const compactPickLine = isTek
      ? `<span class="compactTekLine">${tekBadge}${chips}</span>`
      : chips;
    return `<tr data-leg="${x.r.leg}"><td>${x.r.leg}. AYAK</td><td><span class="compactNos">${compactPickLine}${teksizHint}</span>${tkpCouponEkuriExplanation(picks,x.r)}${addSelect}</td><td>${statusCell}</td></tr>`;
  }).join('');
  const payoutKey = ({6:'altili',5:'besli',4:'dortlu_ganyan',3:'uclu_ganyan'})[res.legCount] || null;
  const payoutLine=couponFinanceHTML(res,payoutKey);
  const fit=res.conditionFit;
  const fitLine=fit&&Number(fit.sample)>0 ? `<div class="compactMeta">Benzer koşu kapsamı: <b>%${fmt2(Number(fit.percent)||0)}</b> · n=${Number(fit.sample)||0}</div>` : '';
  // Bütçe aralığı üstteki Kupon bütçeleri bölümünde zaten görünür. Kartta yalnız
  // arşiv/kilit kaynağı notu korunur; bütçe aralığı ve maliyet tekrarı basılmaz.
  const r174=res.r17Portfolio||null;
  const r174Line=r174?`<div class="tkpR174Portfolio ${r174.recommended?'recommended':''}"><b>R17.4 ${r174.recommended?'ÖNCELİK':'PORTFÖY #'+(Number(r174.rank)||'-')}</b> · EV %${fmt2((Number(r174.rawEv)||0)*100)} · risk-ayarlı %${fmt2((Number(r174.riskAdjustedScore)||0)*100)} · kapsama %${fmt2((Number(r174.modelProbability)||0)*100)}</div>`:'';
  const storedNote=String(res.adaptiveBudgetNote||'').trim();
  const cardArchiveNote=storedNote&&!/^Bütçe\s*:/i.test(storedNote)?storedNote:'';
  // Kupon kartı sade tutulur; kayıp/kurtarma teşhisi ayrı takip merkezinde kalır.
  try{if(typeof tkpV55CouponDiagnosisData==='function')tkpV55CouponDiagnosisData(res);}catch(_){ }
  return `<div class="card budgetCouponCompact" style="border-left:4px solid ${border};">
    <div class="couponTopBlock">
      <h2>${esc(shortTitle)}</h2>
      <p class="compactMeta">${res.legCount}'lü · Birim ${fmt2(res.unit)} TL</p>
      ${fitLine}
      ${cardArchiveNote?`<div class="tkpAdaptiveBudgetNote ${res.adaptiveBudgetRaised?'raised':'base'}">${esc(cardArchiveNote)}</div>`:''}
      ${res.displayAccountingNote?`<p class="compactMeta" role="status">${esc(res.displayAccountingNote)}</p>`:''}
      ${tkpCouponDecisionHTML(res)}
      ${r174Line}
      ${globalThis.TKP_COUPON_POLICY?.html(res)||''}
    </div>
    <table><thead><tr><th>Ayak</th><th>At No</th><th>Durum</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="compactFoot"><span class="tkpCouponCostAmount"><b>Maliyet:</b> ${fmt2(res.cost)} TL</span></p>
    ${payoutLine}
  </div>`;
}

function tkpR17ModelTrackingHTML(){
  const logs=Array.isArray(globalThis.db?.weekly_model_log)?globalThis.db.weekly_model_log:[];
  const completed=logs.filter(r=>r&&r.evaluation&&Number(r.time_lock_eligible)!==0);
  const learned=completed.filter(r=>String(r.model_id||'')==='TABLE_LEARNED_ENSEMBLE_W1');
  const newestVersion=(learned[learned.length-1]?.model_version)||(completed[completed.length-1]?.model_version)||'R17.4';
  const rows=learned.length?learned:completed.filter(r=>String(r.model_version||'')===String(newestVersion));
  const n=rows.length;
  const hit=(key)=>rows.reduce((sum,r)=>sum+(Number(r?.evaluation?.[key])===1?1:0),0);
  const pct=(a,b)=>b?fmt2(100*a/b):'-';
  let singles=0,singleHits=0;
  for(const r of rows){
    const winners=new Set((r?.evaluation?.winner_options||[]).map(String));
    for(const picks of Object.values(r?.coupon_picks||{})){
      if(Array.isArray(picks)&&picks.length===1){singles++;if(winners.has(String(picks[0])))singleHits++;}
    }
  }
  const p1=hit('p1'),p3=hit('top3'),p5=hit('top5');
  const sample=n?`${n} sonuçlu koşu`:'henüz sonuçlu forward kayıt yok';
  return `<div class="tkpR17ModelTracking" id="tkpR17ModelTracking"><div class="trackHead">📈 R17 MODEL TAKİP · ${esc(newestVersion)}</div><div class="trackGrid"><span class="trackChip">Örnek: ${sample}</span><span class="trackChip">Top-1: ${p1}/${n||0} · %${pct(p1,n)}</span><span class="trackChip">İlk 3: ${p3}/${n||0} · %${pct(p3,n)}</span><span class="trackChip">İlk 5: ${p5}/${n||0} · %${pct(p5,n)}</span><span class="trackChip">Yeni model forward TEK: ${singleHits}/${singles} · %${pct(singleHits,singles)}</span><span class="trackChip">Arşiv policy TEK: %48,0</span></div><div class="trackWarn">AutoGluon eğitim raporunda best_model / challenger / holdout metrikleri yok: Eğitim raporu tamamlanmadı. Bu bant gerçek forward sonuçlarını gösterir; arşiv policy TEK yüzdesini yeni model başarısı gibi sunmaz.</div></div>`;
}
function tkpEnsureR17ModelTrackingPanel(){
  try{ document.getElementById('tkpR17ModelTracking')?.remove(); }catch(_){ }
}

function renderCouponCard(typeKey){
  const container=document.getElementById('couponCard-'+typeKey);
  const res=activeCoupons[typeKey];
  if(!container || !res) return;
  container.innerHTML=couponVariantCompactHTML(res, COUPON_CARD_TITLES[typeKey]||'');
  tkpEnsureR17ModelTrackingPanel();
  container.querySelectorAll('.legAddSelect').forEach(sel=>{
    sel.onchange=()=>{ const val=sel.value; if(val) addHorseToCouponLeg(typeKey, sel.dataset.leg, val); };
  });
  container.querySelectorAll('.couponPickRemove').forEach(btn=>{
    btn.onclick=(e)=>{ e.preventDefault(); removeHorseFromCouponLeg(typeKey, btn.dataset.leg, btn.dataset.horse); };
  });
  // offsetHeight okumaları zorunlu reflow üretir. Kart tıklamasını bloklamasın;
  // hizalama bir sonraki frame'de yapılsın.
  if(typeof requestAnimationFrame==='function'){
    requestAnimationFrame(()=>syncCouponRowHeights());
    requestAnimationFrame(()=>requestAnimationFrame(syncCouponRowHeights));
  }
  else setTimeout(()=>{syncCouponRowHeights();setTimeout(syncCouponRowHeights,0);},0);
}

function budgetCouponHTML(res){
  return couponVariantHTML(res);
}

function persistWarningHTML(){
  const status=typeof persistenceStatus==='function'
    ? persistenceStatus()
    : {mode:persistMode,verified:persistMode!=='none',error:''};
  // Her doğrulanmış kalıcı motor (legacy IndexedDB veya segmented IndexedDB V2)
  // güvenlidir. Mod adını sabit bir beyaz listeye bağlamak yeni motoru yanlışlıkla
  // kırmızı hata gibi göstermişti.
  if(status.verified===true) return '';
  if(!status.error) return '';
  return `<div class="card persistErrorCard" style="border-left:5px solid #dc2626;"><b>⚠️ Kalıcı kayıt doğrulanamadı.</b> Veriler bu oturumda çalışmaya devam eder; otomatik dosya indirilmez. Manuel <b>Tam Yedek Al (.tkbz)</b> düğmesini kullanabilirsin.${status.error?`<div class="muted" style="margin-top:5px;">Teknik ayrıntı: ${esc(status.error)}</div>`:''}</div>`;
}

// Analiz tablolarında eksik/sıfır hücreler kalabalık bir "0" denizi oluşturmasın.
// Hesap motorundaki gerçek sıfır korunur; yalnız sunumda tire gösterilir.
function analysisNumberOrDash(value){
  if(value===null||value===undefined||String(value).trim()==='')return '<span class="muted" title="Veri yok">—</span>';
  const n=Number(value);return Number.isFinite(n)?String(n):'<span class="muted" title="Veri yok">—</span>';
}
function analysisNumericValue(value){
  if(value===null||value===undefined)return null;
  if(typeof value==='string'&&!value.trim())return null;
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const text=typeof value==='string'&&value.includes(',')&&!value.includes('.')?value.replace(',','.'):value;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}
function analysisPctOrDash(numerator,denominator){
  const n=Number(numerator),d=Number(denominator);
  if(!(d>0)) return '<span class="muted" title="Veri yok">-</span>';
  return '%'+fmtPct(100*n/d);
}

function xKulisAnalysisHTML(){
  let races=[];
  try{races=typeof learningEligibleRaces==='function'?learningEligibleRaces():(db?.races||[]);}catch(_){races=[];}
  const rows=[];let archivedComments=0,archivedVerified=0;
  try{for(const rr of (db?.races||[])){const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(rr):(rr?.horses||[]).filter(x=>!(typeof isNonRunner==='function'&&isNonRunner(x)));for(const hh of live)archivedComments+=Array.isArray(hh?.x_kulis_comments)?hh.x_kulis_comments.length:0;}}catch(_e){}
  for(const r of races){ const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(x=>!(typeof isNonRunner==='function'&&isNonRunner(x))); for(const h of live){
    const comments=Array.isArray(h?.x_kulis_comments)?h.x_kulis_comments:[];
    const scoreRaw=analysisNumericValue(h?.x_kulis_score),commentScore=comments.length?comments.map(c=>analysisNumericValue(c?.score)).filter(Number.isFinite):[];
    const score=scoreRaw!==null?scoreRaw:(commentScore.length?commentScore.reduce((a,b)=>a+b,0)/commentScore.length:null);
    const deltaRaw=analysisNumericValue(h?.x_ypuan_delta),delta=deltaRaw!==null?deltaRaw:0;
    if(score===null&&!comments.length)continue;
    const resultKnown=Number(h?.finish_position)>0||Number(h?.winner)===1;
    if(resultKnown)archivedVerified++;
    let direction=delta>0?1:delta<0?-1:0;
    if(direction===0&&comments.length){const dirs=comments.map(c=>Number(c?.direction)||0);direction=dirs.reduce((a,b)=>a+b,0)>0?1:dirs.reduce((a,b)=>a+b,0)<0?-1:0;}
    rows.push({score:score!==null?score:null,delta,direction,resultKnown,won:typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(Number(h?.winner)===1||Number(h?.finish_position)===1),commentCount:comments.length});
  }}
  if(!rows.length) return '<div class="empty">Henüz programdaki at adıyla doğrulanmış X/Twitter kulis kaydı yok.</div>';
  const group=(label,items)=>{
    const known=items.filter(x=>x.resultKnown),wins=known.filter(x=>x.won).length,scored=items.filter(x=>Number.isFinite(x.score));
    const avg=scored.length?scored.reduce((sum,x)=>sum+x.score,0)/scored.length:null;
    const deltaRows=items.filter(x=>Number.isFinite(x.delta)&&x.delta!==0),avgDelta=deltaRows.length?deltaRows.reduce((sum,x)=>sum+x.delta,0)/deltaRows.length:null;
    return `<tr><td><b>${label}</b></td><td class="num">${items.length}</td><td class="num">${avg===null?'—':'%'+fmt2(avg)}</td><td class="num">${avgDelta===null?'—':(avgDelta>0?'+':'')+fmt2(avgDelta)}</td><td class="num">${known.length?wins+'/'+known.length:'—'}</td><td class="num">${known.length?'%'+fmt2(100*wins/known.length):'—'}</td></tr>`;
  };
  const positive=rows.filter(x=>x.direction>0),negative=rows.filter(x=>x.direction<0),neutral=rows.filter(x=>x.direction===0);
  return `<div class="tableWrap"><table><thead><tr><th>X etkisi</th><th class="num">At</th><th class="num">Ort. güven</th><th class="num">Ort. Y.PUAN farkı</th><th class="num">Kazanan / sonuçlu</th><th class="num">Galibiyet</th></tr></thead><tbody>${group('Olumlu kulis',positive)}${group('Olumsuz kulis',negative)}${neutral.length?group('Yönü nötr / yalnız eski kayıt',neutral):''}</tbody></table></div><p class="muted" style="margin:7px 0 0;font-size:10.5px;">Eski arşivdeki X yorumları da taranır. Y.PUAN farkı eski kayıtta yoksa 0 uydurulmaz ve hücre — kalır. Sonucu doğrulanmayan kayıt başarı paydasına katılmaz. Arşiv yorum parçası: ${archivedComments}; sonuçlu at satırı: ${archivedVerified}.</p>`;
}

function analysisDecimalOrDash(value){
  if(value===null||value===undefined||String(value).trim()==='')return '<span class="muted" title="Veri yok">—</span>';
  const n=Number(value);return Number.isFinite(n)?fmt2(n):'<span class="muted" title="Veri yok">—</span>';
}
function analysisPercentValueOrDash(value){
  if(value===null||value===undefined||String(value).trim()==='')return '<span class="muted" title="Veri yok">—</span>';
  const n=Number(value);return Number.isFinite(n)?'%'+fmtPct(n):'<span class="muted" title="Veri yok">—</span>';
}
// Model ailesi ağırlıkları 30+ sinyal arasında normalize edilir. Tam sayıya
// yuvarlamak gerçek, küçük payları yanlışlıkla %0 gösteriyordu (ör. %0,18).
// Bu değer isabet yüzdesi değil, 0–100 arası normalize edilmiş model payıdır.
function analysisWeightPercentOrDash(value){
  if(value===null||value===undefined||String(value).trim()==='')return '<span class="muted" title="Veri yok">—</span>';
  const n=Number(value);
  if(!Number.isFinite(n))return '<span class="muted" title="Veri yok">—</span>';
  if(n===0)return '<span class="muted" title="Bu sinyal modelde ağırlık taşımıyor">—</span>';
  if(n>0&&n<0.01)return '<%0,01';
  return '%'+Number(n).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
}


function historicalPortfolioAnalysisHTML(){
  let s=null;
  try{s=db?.learning_state?.historical_portfolio_training||null;if(typeof globalThis.tkpHistoricalPortfolioTrainingSummary==='function')s=globalThis.tkpHistoricalPortfolioTrainingSummary(db)||s;}catch(_){s=null;}
  if(!s)return '<div class="card tkpHistoricalPortfolioCard"><h3>📚 Eski Arşiv · 3 Altılı + Yan Bahis Snapshot</h3><div class="empty">Tarihsel snapshot özeti hazırlanıyor…</div></div>';
  const fmtRate=(a,b)=>Number(b)>0?'%'+fmt2(100*Number(a||0)/Number(b)):'—';
  const fmtRoi=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':(Number(v)>=0?'+':'')+fmt2(Number(v)*100)+'%';
  const c=s.coupons||{};
  const couponRows=['main','alt','surprise'].map(key=>{
    const g=c[key]||{},label=g.label||(key==='main'?'Normal':key==='alt'?'Sürpriz':'Uzman + Kulis');
    return `<tr><td><b>${esc(label)}</b></td><td class="num">${Number(g.events)||'—'}</td><td class="num">${fmtRate(g.full,g.events)}</td><td class="num">${fmtRate(g.legHits,g.knownLegs)}</td><td class="num">${fmtRate(g.singleHit,g.singles)}</td><td class="num">${fmtRoi(g.roi)}</td></tr>`;
  }).join('');
  const names={cifte:'Çifte',sirali_ikili:'Sıralı İkili',sirali_uclu:'Sıralı Üçlü',tabela:'Dörtlü / Tabela',sirali_5li:"Sıralı 5'li"};
  const sideRows=Object.keys(names).map(key=>{
    const g=s.sidebets?.[key]||{};
    return `<tr><td><b>${names[key]}</b></td><td class="num">${Number(g.events)||'—'}</td><td class="num">${Number(g.resolved)||'—'}</td><td class="num">${fmtRate(g.hits,g.resolved)}</td><td class="num">${Number(g.financialEvents)||'—'}</td><td class="num">${fmtRoi(g.roi)}</td></tr>`;
  }).join('');
  return `<div class="card tkpHistoricalPortfolioCard" style="margin:0 0 8px;border-left:5px solid #0f766e">
    <h3 style="margin:0 0 4px">📚 Eski Arşiv · 3 Altılı + Bütün Yan Bahis Snapshot Analizi</h3>
    <p class="muted" style="margin:0 0 7px">Altı ayaklı eski toplantılar frozen yarış-öncesi sıralamadan snapshotlanır; resmi sonuç yalnız değerlendirmede kullanılır. Bu tarihsel lane analiz/algoritma geliştirme girdisidir; eksik veri 0 yapılmaz.</p>
    <div class="tableWrap"><table class="compact"><thead><tr><th>Altılı</th><th class="num">Snapshot</th><th class="num">6/6</th><th class="num">Ayak isabeti</th><th class="num">TEK isabeti</th><th class="num">ROI*</th></tr></thead><tbody>${couponRows}</tbody></table></div>
    <div class="tableWrap" style="margin-top:7px"><table class="compact"><thead><tr><th>Yan bahis</th><th class="num">Snapshot</th><th class="num">Sonuçlu</th><th class="num">İsabet</th><th class="num">Ödeme eşleşmiş</th><th class="num">ROI*</th></tr></thead><tbody>${sideRows}</tbody></table></div>
    <p class="muted" style="margin:6px 0 0;font-size:10px">* ROI yalnız resmi ödeme kaydı eşleşen olaylarda hesaplanır. Snapshot toplantısı: ${Number(s.snapshotMeetings||0)} · yan bahis bileti: ${Number(s.sidebetTickets||0)}.</p>
  </div>`;
}

function categoryTable(key){
  // İlk görünen yüzde VALUE kapsamıdır; grupları bu orana göre sıralamak
  // karşılaştırmayı kolaylaştırır. Eşitlikte sonuçlu örnek ve örnek sayısı
  // kullanılır; tek kayıtlı bir grubun tesadüfî %100'ü büyük grupları ezmez.
  let rows = categoryAnalysis(key).slice().sort((a,b)=>{
    const ga=a[1]||{},gb=b[1]||{};
    const valueRate=g=>Number(g.races)>0?Number(g.valueRaces||0)/Number(g.races):-1;
    const resultRate=g=>Number(g.resultRaces)>0?Number(g.result1||0)/Number(g.resultRaces):-1;
    return valueRate(gb)-valueRate(ga)||resultRate(gb)-resultRate(ga)||Number(gb.races||0)-Number(ga.races||0)||TKP_TR_COLLATOR.compare(String(a[0]||''),String(b[0]||''));
  });
  return `<div class="tableWrap"><table><thead><tr><th>Grup</th><th class="num">Koşu</th><th class="num">Ort. at</th><th class="num">VALUE kapsamı</th><th class="num">AGF 1 kazandı</th><th class="num">SONUÇ 1 kazandı</th><th class="num">BMB yakalama</th></tr></thead><tbody>${
    rows.map(([k,g]) => `<tr><td><b>${esc(k)}</b></td><td class="num">${analysisNumberOrDash(g.races)}</td><td class="num">${analysisDecimalOrDash(g.races?g.horses/g.races:0)}</td><td class="num">${analysisPctOrDash(g.valueRaces,g.races)}</td><td class="num">${analysisPctOrDash(g.agf1,g.resultRaces)}</td><td class="num">${analysisPctOrDash(g.result1,g.resultRaces)}</td><td class="num">${analysisPctOrDash(g.bmbWin,g.bmbRaces)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">-</td></tr>'
  }</tbody></table></div>`;
}

function positionBreakdownHTML(s){
  if (!s || !s.total) return '<span class="muted">-</span>';
  const pct = n => Number.isFinite(Number(n))?'%'+fmtPct(100*Number(n)/s.total):'<span class="muted">—</span>';
  return `<span class="posCompact">`
    + `<span class="pcell"><span class="pnum p1">1:</span>${pct(s.p1)}</span>`
    + `<span class="pcell"><span class="pnum p2">2:</span>${pct(s.p2)}</span>`
    + `<span class="pcell"><span class="pnum p3">3:</span>${pct(s.p3)}</span>`
    + `<span class="pcell"><span class="pnum p4">4:</span>${pct(s.p4)}</span>`
    + `<span class="pcell"><span class="pnum p5">5:</span>${pct(s.p5)}</span>`
    + `</span>`;
}

function signalPerformanceHTML(){
  const sig = globalSignalStats();
  const rows = Object.values(sig).filter(g=>g.total>0).sort((a,b)=>b.lb-a.lb || b.rate-a.rate);
  const totalW = rows.reduce((s,g)=>s+g.lb,0) || 1;
  return `<div class="tableWrap"><table class="posReportTable"><colgroup><col class="signalNameCol"><col class="signalSampleCol"><col class="signalBreakdownCol"><col class="signalLowerBoundCol"><col class="signalRelativeWeightCol"></colgroup><thead><tr><th>Sinyal</th><th class="num">Örnek</th><th class="num">Derece dağılımı (1./2./3./4./5.)</th><th class="num">Güven alt sınırı</th><th class="num">Önerilen görece ağırlık</th></tr></thead><tbody>${
    rows.map(g=>`<tr><td><b>${esc(tkpVisibleTurkishText(g.label))}</b></td><td class="num">${analysisNumberOrDash(g.total)}</td><td class="num">${positionBreakdownHTML(g)}</td><td class="num"><span class="pct-hit">${analysisPercentValueOrDash(g.lb*100)}</span></td><td class="num">${analysisPercentValueOrDash(g.lb/totalW*100)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">-</td></tr>'
  }</tbody></table></div>
  <p class="muted" style="margin-top:8px;font-size:12px;">📌 Derece dağılımı gerçek 1./2./3./4./5. bitirişleri ayrı ölçer. Listelenen sinyaller Altılı ve yan bahis öğrenme kayıt sistemine girer; yalnız doğrulanmış örnek bulunan sinyalin ilgili pozisyondaki ağırlığı güncellenir, eksik veri nötr kalır.</p>`;
}

function hippodromeSignalHTML(){
  const rows = hippodromeSignalStats();
  return `<div class="tableWrap"><table class="posReportTable"><thead><tr><th>Hipodrom</th><th class="num">Koşu</th><th class="num">BMB (1./2./3./4./5.)</th><th class="num">SONUÇ (1./2./3./4./5.)</th><th class="num">AGF 1 (1./2./3./4./5.)</th><th class="num">ODB (1./2./3./4./5.)</th></tr></thead><tbody>${
    rows.map(([k,g])=>`<tr><td><b>${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(k):tkpVisibleTurkishText(k))}</b></td><td class="num">${analysisNumberOrDash(g.races)}</td><td class="num">${positionBreakdownHTML(g.bmb)}</td><td class="num">${positionBreakdownHTML(g.r6)}</td><td class="num">${positionBreakdownHTML(g.agf1)}</td><td class="num">${positionBreakdownHTML(g.extra)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">-</td></tr>'
  }</tbody></table></div>
  <p class="muted" style="margin-top:8px;font-size:12px;">📌 Her hücre gerçek 1.–5. bitiriş oranını gösterir. Model önce koşu şartı + pist + tür + mesafe + hipodrom eşleşmesini kullanır; örnek azsa aynı sırayla daha geniş doğrulanmış geçmişe düşer.</p>`;
}

function winnerRankTable(rankField, caption){
  let groups = winnerRankDistribution(rankField);
  // Sonuç sırası dağılımında da en yüksek birinci sıra oranı üstte görünür.
  // Örnek sayısı, küçük örneklerin tesadüfî yüksek yüzdelerle öne geçmesini
  // engelleyen ikinci anahtardır.
  let keys = Object.keys(groups).sort((a,b) => {
    const ga=groups[a]||{},gb=groups[b]||{};
    const rate=g=>Number(g.total)>0?Number(g['1']||0)/Number(g.total):-1;
    return rate(gb)-rate(ga)||Number(gb.total||0)-Number(ga.total||0)||TKP_TR_COLLATOR.compare(String(a),String(b));
  });
  let order = ['1','2','3','4','5','6','7','alt1','alt2','alt3','alt4','yok'];
  const labels = {'1':'1.','2':'2.','3':'3.','4':'4.','5':'5.','6':'6.','7':'7.','alt1':'8. (alt1)','alt2':'9. (alt2)','alt3':'10. (alt3)','alt4':'11+ (alt4)','yok':'Değer yok'};
  if (!keys.length) return '<div class="empty">-</div>';
  return `<div class="tableWrap"><table><thead><tr><th>Koşu şartı</th><th class="num rankCountHead">Koşu</th><th class="num rankTieHead">Atbaşı</th>${order.map(o=>`<th class="num">${labels[o]}</th>`).join('')}</tr></thead><tbody>${
    keys.map(k => { let g=groups[k]; return `<tr><td class="rankConditionName" title="${esc(k)}"><b>${esc(k)}</b></td><td class="num rankCountCell">${analysisNumberOrDash(g.races)}</td><td class="num rankTieCell">${analysisNumberOrDash(g.ties)}</td>${order.map(o=>`<td class="num rankDistCell"><span class="rankDistCount">${analysisNumberOrDash(g[o])}</span><span class="rankDistPct">${analysisPctOrDash(g[o],g.total)}</span></td>`).join('')}</tr>`; }).join('')
  }</tbody></table></div><p class="muted" style="margin-top:8px;">${caption} Atbaşı sonuçlanan (2-3 atın birinci olduğu) koşularda her iki/üç at da ayrı bir gözlem olarak sayılır, bu yüzden yüzdeler koşu sayısını değil "kazanan gözlemi" sayısını baz alır.</p>`;
}

function conditionRankTable(){
  return winnerRankTable('result_rank', 'Her satır: o koşu şartında gerçek kazananın SONUÇ değerine göre kaçıncı sırada olduğu. Koşu şartı, dosyandaki tam metne göre ayrılır (örn. "Handikap 13 DHÖW" ve "Handikap 17 H2" ayrı satırlardır).');
}

function agfRankTable(){
  return winnerRankTable('agf_rank', 'Her satır: o koşu şartında gerçek kazananın AGF değerine göre kaçıncı sırada olduğu.');
}

function valueSpecificTable(){
  const hasValue=h=>h?.value_score!==null&&h?.value_score!==undefined&&String(h?.value_score).trim()!==''&&Number.isFinite(Number(h?.value_score));
  let bands = [
    ['VALUE yok', h=>!hasValue(h)],
    ['<60', h=>hasValue(h) && Number(h.value_score)<60],
    ['60-69', h=>hasValue(h) && Number(h.value_score)>=60 && Number(h.value_score)<70],
    ['70-79', h=>hasValue(h) && Number(h.value_score)>=70 && Number(h.value_score)<80],
    ['80-89', h=>hasValue(h) && Number(h.value_score)>=80 && Number(h.value_score)<90],
    ['90-99', h=>hasValue(h) && Number(h.value_score)>=90 && Number(h.value_score)<100],
    ['≥100', h=>hasValue(h) && Number(h.value_score)>=100]
  ];
  const rows=bands.map(([name,test]) => {
      let cand=0, win=0, single=0, sw=0;
      for (const r of learningEligibleRaces()){
        let x = (typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)))).filter(test);
        cand += x.length;
        win += x.filter(h=>typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(h.winner||Number(h.finish_position)===1)).length;
        if (x.length===1){ single++; sw += (typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(x[0]):(x[0].winner||Number(x[0].finish_position)===1)) ? 1 : 0; }
      }
      return {name,cand,win,single,sw};
    }).sort((a,b)=>{
      const rate=x=>x.cand>0?x.win/x.cand:-1;
      const singleRate=x=>x.single>0?x.sw/x.single:-1;
      return rate(b)-rate(a)||singleRate(b)-singleRate(a)||b.cand-a.cand||TKP_TR_COLLATOR.compare(a.name,b.name);
    });
  return `<div class="tableWrap"><table><thead><tr><th>Band</th><th class="num">Aday at</th><th class="num">Kazanan</th><th class="num">At bazlı isabet</th><th class="num">Tek koşu</th><th class="num">Tek kazanan</th></tr></thead><tbody>${
    rows.map(x=>`<tr><td>${x.name}</td><td class="num">${analysisNumberOrDash(x.cand)}</td><td class="num">${analysisNumberOrDash(x.win)}</td><td class="num">${analysisPctOrDash(x.win,x.cand)}</td><td class="num">${analysisNumberOrDash(x.single)}</td><td class="num">${analysisNumberOrDash(x.sw)}${x.single&&x.sw?' (%'+fmt2(100*x.sw/x.single)+')':''}</td></tr>`).join('')
  }</tbody></table></div>`;
}

// Accurate (accurace.net) dosyalarından at başına birçok parametre parse edilip
// saklanıyor (ortalama hız, maksimum hız, kapanış hızı, tempo sinyali, bitiriş/kapanış
// gücü sinyali) ama bu panel eskiden yalnızca ortalama hızı (2 satır: üstü/altı)
// gösteriyordu -- geri kalan parametreler veride var olduğu halde hiç ekrana yansımıyordu.
// Şimdi yakalanan her parametre için aynı mantıkla (o yarıştaki alan ortalamasının/
// medyanının üstü mü altı mı, kazanma % ne) ayrı bir satır üretiliyor.
function _accurateFieldRowStats(ar, field, isNormalizedSignal){
  const isValid = isNormalizedSignal ? (v=>v!==null&&Number.isFinite(v)) : (v=>v!==null&&Number.isFinite(v) && v>0);
  const liveRows=r=>typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
  const known = ar.filter(r=>{const live=liveRows(r);return live.some(h=>typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(h.winner||Number(h.finish_position)===1)) && live.some(h=>isValid(analysisNumericValue(h[field])));});
  let above=0,aboveWin=0,below=0,belowWin=0;
  for(const r of known){
    const live=liveRows(r);
    const vals=live.map(h=>analysisNumericValue(h[field])).filter(isValid);
    if(!vals.length) continue;
    const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
    for(const h of live){
      const v=analysisNumericValue(h[field]);
      if(!isValid(v)) continue;
      if(v>avg){above++; if(typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(h.winner||Number(h.finish_position)===1)) aboveWin++;} else {below++; if(typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(h.winner||Number(h.finish_position)===1)) belowWin++;}
    }
  }
  return {above, aboveWin, below, belowWin};
}
function accurateSpeedSignalHTML(){
  const metrics=[
    {field:'accurate_avg_speed_mps', label:'Accurate ortalama hız', isSignal:false},
    {field:'accurate_max_speed_mps', label:'Accurate maksimum hız', isSignal:false},
    {field:'accurate_closing_speed_mps', label:'Accurate kapanış (seçili bölüm) hızı', isSignal:false},
    {field:'accurate_tempo_signal', label:'Accurate tempo sinyali', isSignal:true},
    {field:'accurate_finish_signal', label:'Accurate bitiriş/kapanış gücü sinyali', isSignal:true},
  ];
  const ar=learningEligibleRaces();
  // Ortalama hız boş olsa bile kapanış/tempo/bitiriş gibi başka bir Accurate
  // alanı dolu olan yarış kaybedilmesin; tüm ölçülebilir kaynak alanları hesaba
  // girsin.
  const withData=ar.filter(r=>(typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)))).some(h=>metrics.some(m=>{
    const n=analysisNumericValue(h?.[m.field]);return m.isSignal?n!==null:(n!==null&&n>0);
  })));
  const known=withData.filter(r=>(typeof tkpLiveHorses==='function'?tkpLiveHorses(r):(r.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)))).some(h=>typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(h.winner||Number(h.finish_position)===1)));
  const rows=metrics.map(m=>{
    const s=_accurateFieldRowStats(ar, m.field, m.isSignal);
    if(!s.above && !s.below) return '';
    return `<tr><td>${esc(m.label)} &gt; alan ortalaması</td><td class="num">${analysisNumberOrDash(s.above)}</td><td class="num">${analysisPctOrDash(s.aboveWin,s.above)}</td></tr>
    <tr><td>${esc(m.label)} ≤ alan ortalaması</td><td class="num">${analysisNumberOrDash(s.below)}</td><td class="num">${analysisPctOrDash(s.belowWin,s.below)}</td></tr>`;
  }).join('');

  return `<div class="tableWrap"><table><thead><tr><th>Grup</th><th class="num">At</th><th class="num">Kazanma %</th></tr></thead><tbody>
    ${rows || '<tr><td colspan="3" class="empty">-</td></tr>'}
  </tbody></table></div>
  <p class="muted" style="margin-top:6px;font-size:11px;">${analysisNumberOrDash(withData.length)} koşuda Accurate verisi var, ${analysisNumberOrDash(known.length)} tanesinin sonucu mevcut. Ortalama/maksimum/kapanış hızı ile tempo/bitiriş sinyali ayrı özellikler olarak Altılı ve yan bahis sıralamalarında öğrenilir.</p>`;
}

function kulvarBandHTML(){
  const startValue=h=>analysisNumericValue(h?.start_no??h?.st??h?.start??h?.kulvar);
  const bands=[
    ['1-3 (iç)', h=>{const n=startValue(h);return n!==null&&n>=1&&n<=3;}],
    ['4-6', h=>{const n=startValue(h);return n!==null&&n>=4&&n<=6;}],
    ['7-9', h=>{const n=startValue(h);return n!==null&&n>=7&&n<=9;}],
    ['10-12', h=>{const n=startValue(h);return n!==null&&n>=10&&n<=12;}],
    ['13+ (dış)', h=>{const n=startValue(h);return n!==null&&n>=13;}],
    ['Kulvar yok', h=>startValue(h)===null]
  ];
  const counts=bands.map(()=>({cand:0,win:0}));
  // Aynı arşivi altı kulvar bandı için altı kez taramak yerine her atı tek kez
  // doğru kovaya koy. İlk Ayrıntılı Analiz açılışındaki uzun görevi küçültür.
  for(const race of learningEligibleRaces()){const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race?.horses||[]).filter(x=>!(typeof isNonRunner==='function'&&isNonRunner(x)));for(const h of live){
    const index=bands.findIndex(([,test])=>test(h));
    if(index<0)continue;
    counts[index].cand++;
    if(typeof tkpAnalysisIsWinner==='function'?tkpAnalysisIsWinner(h):(h?.winner||Number(h?.finish_position)===1))counts[index].win++;
  }}
  // Yüzdeli özet büyükten küçüğe sıralanır; eşitlikte daha büyük örnek üstte kalır.
  const ranked=bands.map(([name],index)=>{
    const {cand,win}=counts[index];
    return {name,cand,win,rate:cand>0?win/cand:-1};
  }).sort((a,b)=>Number(b?.rate||0)-Number(a?.rate||0)||Number(b?.cand||0)-Number(a?.cand||0));
  return `<div class="tableWrap"><table><thead><tr><th>Kulvar</th><th class="num">Aday at</th><th class="num">Kazanan</th><th class="num">At bazlı isabet</th></tr></thead><tbody>${
    ranked.map(({name,cand,win}) => `<tr><td><b>${esc(name)}</b></td><td class="num">${analysisNumberOrDash(cand)}</td><td class="num">${analysisNumberOrDash(win)}</td><td class="num">${analysisPctOrDash(win,cand)}</td></tr>`).join('')
  }</tbody></table></div>`;
}

function coverageHTML(){
  // R16.36: stats() aynı tek geçişte kapsam sayılarını da üretir ve küçük özeti
  // kalıcılaştırır. Menü dönüşünde/Ctrl+F5'te ikinci arşiv taraması yapılmaz.
  const summary=stats(),arTotal=Number(summary?.races)||0;
  const raceCounts=summary?.coverage?.race||{surface:0,breed:0,condition:0,date:0};
  const horseCounts=summary?.coverage?.horse||{total:Number(summary?.horses)||0,value:0,hndkp:0,tr:0,sp:0,result:0};
  let fields = [
    ['Pist', raceCounts.surface, arTotal],
    ['Tür', raceCounts.breed, arTotal],
    ['Koşu şartı', raceCounts.condition, arTotal],
    ['Tarih', raceCounts.date, arTotal],
    ['VALUE', horseCounts.value, horseCounts.total],
    ['HNDKP', horseCounts.hndkp, horseCounts.total],
    ['TR PUAN', horseCounts.tr, horseCounts.total],
    ['SP', horseCounts.sp, horseCounts.total],
    ['SONUÇ', horseCounts.result, horseCounts.total]
  ];
  // Yüzdeli kapsam özeti de büyükten küçüğe sıralanır.
  fields=fields.slice().sort((a,b)=>{
    const rate=x=>x[2]?x[1]/x[2]:-1;
    return rate(b)-rate(a);
  });
  return `<div class="tableWrap coverageCompactWrap"><table class="coverageCompactTable"><colgroup><col style="width:23%"><col style="width:13%"><col style="width:13%"><col style="width:51%"></colgroup><thead><tr><th>Alan</th><th class="num">Dolu</th><th class="num">Toplam</th><th>Kapsam</th></tr></thead><tbody>${
    fields.map(([a,b,c]) => `<tr><td><b>${a}</b></td><td class="num">${analysisNumberOrDash(b)}</td><td class="num">${analysisNumberOrDash(c)}</td><td><div class="bar"><span style="width:${c?100*b/c:0}%"></span></div><b>${analysisPctOrDash(b,c)}</b></td></tr>`).join('')
  }</tbody></table></div>`;
}
function ruleTable(arr){
  if (!arr.length) return '<div class="empty">Bu eşikleri geçen kural yok. Sistem mevcut örneği gösterir; güven alt sınırı eşiği geçmeyen kuralı “Mükemmel” olarak işaretlemez.</div>';
  return `<div class="tableWrap"><table class="ruleStatsTable"><thead><tr><th scope="col">Kural</th><th scope="col" class="num">Tek koşu</th><th scope="col" class="num">Kazanan</th><th scope="col" class="num">Ham isabet</th><th scope="col" class="num">Güncel isabet<br><small>son 20 sinyal</small></th><th scope="col" class="num">Kapsam</th><th scope="col" class="num">Güven alt</th><th scope="col" class="num">Dosya</th><th scope="col" class="num">Hipodrom</th></tr></thead><tbody>${
    arr.map(x => `<tr><td>${esc(tkpVisibleTurkishText(x.name))}</td><td class="num">${analysisNumberOrDash(x.single)}</td><td class="num">${analysisNumberOrDash(x.singleWins)}</td><td class="num"><b>${analysisPercentValueOrDash(x.rate*100)}</b></td><td class="num">${x.recentN?analysisPercentValueOrDash(x.recentRate*100):'—'}</td><td class="num">${analysisNumberOrDash(x.eligible)}</td><td class="num">${analysisPercentValueOrDash(x.lb*100)}</td><td class="num">${analysisNumberOrDash(x.files)}</td><td class="num">${analysisNumberOrDash(x.hippos)}</td></tr>`).join('')
  }</tbody></table></div>`;
}

function buildAdvice(ruleRows){
  const s = stats(), rows=Array.isArray(ruleRows)?ruleRows:tkpPeekCurrentRules(), out = [];
  const best=rows?rows.filter(x=>x.single>=db.settings.best_min_single).slice(0,TKP_BEST_RULES_SHOWN):[];
  const perfect=rows?rows.filter(x=>x.single>=db.settings.perfect_min_single&&x.rate>=db.settings.perfect_min_rate&&x.lb>=db.settings.perfect_min_lb&&x.files>=2).slice(0,TKP_PERFECT_RULES_SHOWN):[];
  const top = best[0];
  if (s.races < 60) out.push({level:'warn', badge:'VERİ', title:'Örnek sayısını büyüt', text:`Şu an ${s.races} koşu var. İlk güçlü karşılaştırmalar için 60, daha sağlam karar için 150 koşuya ulaş.`});
  else out.push({level:'good', badge:'VERİ', title:'Veri tabanı büyüyor', text:`${s.races} koşu analizde. Yeni dosyalar geldikçe hipodrom ve koşu şartı bazlı kurallar daha güvenilir olacak.`});
  if (s.valueRaces < s.races*0.65) out.push({level:'warn', badge:'VALUE', title:'Yorumcu puanı kapsamı düşük', text:`VALUE yalnızca ${s.valueRaces}/${s.races} koşuda var. VALUE kurallarını genel kurallardan ayrı değerlendir.`});
  if (top){
    const lb = fmtPct(top.lb*100), rate = fmtPct(top.rate*100);
    if (top.lb < 0.50) out.push({level:'risk', badge:'KURAL', title:'En iyi kural henüz tek için yeterli değil', text:`${top.name}: ham başarı %${rate}, güven altı %${lb}. Kuponu daraltmak için yardımcı sinyal olarak kullan; kesin tek sayma.`});
    else out.push({level:'good', badge:'KURAL', title:'Güçlü kural adayı', text:`${top.name}: ${top.single} tek koşu, %${rate} başarı ve %${lb} güven altı. Yeni veride ileriye dönük takip et.`});
  }
  if (!rows) out.push({level:'warn', badge:'KURAL', title:'Kurallar henüz hazırlanmadı', text:'En iyi 10 panelindeki “Kuralları yeniden hesapla” düğmesiyle tam geçmiş veri üzerinde hesaplamayı başlat.'});
  else if (!perfect.length) out.push({level:'warn', badge:'MÜKEMMEL 5', title:'Zorla mükemmel kural üretme', text:'Mevcut veride Mükemmel 5 eşiğini geçen kural yok. Bu doğru davranış; düşük örnekli %100 sonuçları kural ilan etme.'});
  else out.push({level:'good', badge:'MÜKEMMEL 5', title:'Doğrulanmış kural bulundu', text:`${perfect.length} kural Mükemmel 5 ölçütünü geçiyor. Günlük tahminde önce bu kuralları kontrol et.`});
  if (s.quarantine > 0) out.push({level:'risk', badge:'QC', title:'Karantina kayıtlarını kontrol et', text:`${s.quarantine} dosya incelemede. Yanlış veya benzer kayıt istatistiği şişirmesin; Dosyalar / QC ekranından karar ver.`});
  if (s.races > 0 && s.races % 30 === 0) out.push({level:'good', badge:'YEDEK', title:'Checkpoint yedeği al', text:`${s.races} koşu checkpointine ulaşıldı. JSON ve CSV yedeğini indir.`});
  out.push({level:'good', badge:'STRATEJİ', title:'Tahmini tek kurala bağlama', text:'Günlük adayda en az iki bağımsız sinyal, yeterli örnek sayısı ve anlamlı güven farkı ara.'});
  return out;
}

function adviceHTML(items){
  return items.map(x => `<div class="advice ${x.level}"><span class="badge ${x.level==='good'?'green':x.level==='risk'?'red':'amber'}">${esc(x.badge)}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p></div>`).join('');
}

function scoreBandStatHTML(score){
  const g=predictionLogStats(score);
  return g.total ? `<span class="scoreBandStat">Skor ${g.band.label}: ${analysisNumberOrDash(g.wins)}/${analysisNumberOrDash(g.total)} kazandı (${analysisPercentValueOrDash(g.rate*100)})</span>` : `<span class="scoreBandStat">Skor ${g.band.label}: -</span>`;
}

function scoreBreakdownHTML(h){
  const c=h.scoreParts||{};
  const parts=[['Ortak veri',c.common],['Kural',c.rules],['BMB',c.bmb],['SONUÇ6',c.result6],['At geçmişi',c.horseHist],['Şart geçmişi',c.condHist],['G.PR',c.gpr],['Son 6',c.last6],['Sıra',c.rank],['KG',c.kg],['DERECE',c.degree]];
  return `<div class="scoreBreakdown">${parts.filter(x=>(x[1]||0)>0.0001).map(([n,v])=>`<span class="scorePart">${n} +${fmt2(v)}</span>`).join('') || '<span class="scorePart">Ek puan yok</span>'}</div>`;
}

function historyPreviewHTML(p, fp){
  // SONUÇ GÜNCELLE akışında dosyanın aynı tarih/hipodrom/numarayı taşıması normaldir;
  // bu bir mükerrer geçmiş dosya değil, mevcut kaydın üzerine sonuç işleme adımıdır.
  // Manuel geçmiş ODS ekranındaki eski görünüm ve duplicate engeli aynen korunur;
  // yalnız RESULT_ODS / RESULT_HTML önizlemesinde onay butonu kilitlenmez.
  const isResultImport = String(p?.file?.import_kind||'').startsWith('RESULT_');
  let seqDup = isResultImport ? null : db.files.find(f => f.sequence_no === p.file.sequence_no);
  let contentDup = isResultImport ? null : db.files.find(f => f.fingerprint === fp);
  let isHtmlSource = /\.html?$/i.test(p.file.filename||'');
  // HIZ FIX: (db.races||[]).find(...) her ayak için (tipik 6x) TÜM arşivi baştan
  // tarıyordu -> O(ayak x db.races.length). Arşiv büyüdükçe (400+ toplantı hedefi)
  // bu doğrusal olarak yavaşlar. Tek seferlik Map ile O(db.races.length + ayak).
  const _existingRaceMap = new Map(
    (db.races||[]).map(er => [`${er.leg}|${er.hippodrome}|${er.race_date}`, er])
  );
  let checks = p.races.map(r => {
    const placed = r.horses.filter(h => Number(h?.winner)===1 || (Number(h?.finish_position)>=1 && Number(h?.finish_position)<=5));
    const missingDerece = isHtmlSource ? [] : placed
      .filter(h => h.star_value==null)
      .map(h => ({no:h.horse_no, name:h.horse_name, pos:Number(h?.winner)===1?1:h.finish_position}))
      .sort((a,b)=>(a.pos||99)-(b.pos||99));
    const winnerRow = r.horses.find(h=>Number(h?.winner)===1) || r.horses.find(h=>Number(h?.finish_position)===1);
    const raceTime = winnerRow?.official_time || winnerRow?.result_time || '';
    const existing = _existingRaceMap.get(`${r.leg}|${r.hippodrome}|${r.race_date}`);
    const existingWinner = existing?.horses?.find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
    const alreadyRecorded = !!(existingWinner && (existingWinner.official_time || existingWinner.result_time));
    const raceTimeStatus = alreadyRecorded ? 'recorded' : (raceTime ? 'value' : 'none');
    const hasPayout=typeof resultRaceHasSupplementalData==='function' ? resultRaceHasSupplementalData(r) : !!(r.payouts?.length||r.available_bets?.length);
    return {leg:r.leg, w:r.horses.filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1).map(h=>({no:h.horse_no,name:h.horse_name})), horses:r.horses.length, surface:r.surface, breed:r.breed, condition:r.condition_text, distance:r.distance, missingDerece, raceTime, raceTimeStatus,hasPayout};
  });
  let legsWithMissingDerece = checks.filter(x => x.missingDerece.length > 0);
  let legsAlreadyRecorded = checks.filter(x => x.raceTimeStatus==='recorded');
  let blocked = !!(seqDup || contentDup);
  // DRC (yarış derecesi) yoksa ayak yine kabul edilebilir -- tek şart kazananın işaretli
  // olması. Zaten dereceyle kayıtlı olan ayaklar ise tekrar kabul edilmez (yeniden yazılmaz).
  let validLegs = checks.filter(x => isResultImport ? (x.w.length>=1 || x.hasPayout) : (x.w.length>=1 && x.raceTimeStatus!=='recorded')).map(x => x.leg);
  let fullyOk = !blocked && p.races.length === 6 && validLegs.length === 6;
  let partiallyOk = !blocked && !fullyOk && validLegs.length > 0;
  let statusTitle = fullyOk ? '✅ Dosya kabul edilebilir' : (partiallyOk ? `⚠️ Kısmen kabul edilebilir (${validLegs.length}/${p.races.length} ayak geçerli)` : '❌ Dosya kabul edilmez');
  let borderColor = fullyOk ? '#16a34a' : (partiallyOk ? '#d97706' : '#dc2626');
  return `<div class="card" style="border-left:5px solid ${borderColor};">
    <h3 style="margin:0 0 8px;">${statusTitle}</h3>
    <p>No: <b>${esc(p.file.sequence_no ?? 'Bulunamadı')}</b> · Hipodrom: <b>${esc(typeof displayHippodromeShort==='function'?displayHippodromeShort(p.file.hippodrome):p.file.hippodrome)}</b> · Tarih: <b>${esc(p.file.race_date || 'Yok')}</b></p>
    ${seqDup ? `<p style="color:#dc2626;">❌ Aynı numara zaten kayıtlı: ${esc(seqDup.filename)}</p>` : ''}
    ${contentDup ? `<p style="color:#dc2626;">❌ Aynı içerik daha önce kayıtlı: ${esc(contentDup.filename)}</p>` : ''}
    ${partiallyOk ? `<p style="color:#92400e;">⚠️ ${checks.length - validLegs.length} ayakta işlenebilir kazanan/sıralama veya ikramiye verisi yok; onaylarsan veri taşıyan ${validLegs.length} ayak mevcut kayda birleştirilir. Beraber bitişlerde aynı derece birden fazla ata verilebilir.</p>` : ''}
    ${legsWithMissingDerece.length ? `<p style="color:#92400e;">⚠️ ${legsWithMissingDerece.length} ayakta bazı atların "Derece" değeri boş (aşağıdaki tabloda ayak bazında görebilirsin). Dosya yine de kaydedilebilir ama bu atların Derece sütunu eksik kalacak.</p>` : ''}
    ${legsAlreadyRecorded.length ? `<p style="color:#1d4ed8;">ℹ️ ${legsAlreadyRecorded.length} ayak zaten dereceyle kayıtlı; bu ayaklar tekrar kaydedilmeyecek.</p>` : ''}
    <div class="tableWrap raceCheckWrap"><table class="raceCheckTable"><thead><tr><th>Ayak</th><th>At sayısı</th><th>Kazanan</th><th>Pist</th><th>Tür</th><th>Mesafe</th><th>Koşu</th><th>Yarış Derecesi</th></tr></thead><tbody>
    ${checks.map(x => `<tr ${(!x.w.length&&!x.hasPayout)?'style="background:#fff7ed;"':''}><td>${x.leg}</td><td>${x.horses}</td><td>${
      x.w.length===0 && x.hasPayout ? 'ℹ️ Kazanan yok; ikramiye/bahis verisi birleştirilecek'
      : x.w.length===0 ? '❌ Kazanan veya ikramiye verisi yok (bu ayak atlanır)'
      : x.w.length===1 ? '✅ '+esc(x.w[0].no)+' - '+esc(x.w[0].name)
      : '✅ Atbaşı ('+x.w.length+' at): '+esc(x.w.map(z=>z.no+' - '+z.name).join(', '))
    }${x.raceTimeStatus==='recorded' ? `<br><span class="raceCheckNote recorded">⏭️ Zaten kayıtlı (bu ayak atlanmayacak)</span>` : ''}${x.missingDerece.length ? `<br><span class="raceCheckNote missing" title="${esc(x.missingDerece.map(m => (m.pos??'?')+'. '+m.no+'-'+m.name).join(', '))}">⚠️ ${x.missingDerece.length} atta derece eksik</span>` : ''}</td><td>${esc(x.surface)}</td><td>${esc(x.breed)}</td><td>${x.distance ?? ''}</td><td>${esc(x.condition)}</td><td>${
      x.raceTimeStatus==='value' ? `<b>${esc(x.raceTime)}</b>`
      : x.raceTimeStatus==='recorded' ? `<span class="muted">Kayıtlı</span>`
      : `<span class="muted">—</span>`
    }</td></tr>`).join('')}
    </tbody></table></div>
    ${fullyOk ? '<button id="confirmImportBtn" class="primary" style="margin-top:10px;">Onayla ve kaydet</button>' : ''}
    ${partiallyOk ? `<button id="confirmImportBtn" class="primary" style="margin-top:10px;background:linear-gradient(135deg,#d97706,#f59e0b);">Sadece geçerli ${validLegs.length} ayağı kaydet</button>` : ''}
  </div>`;
}

// Bu tablo ağır öğrenme istatistiklerini ve altı ayrı amaç ağırlığını bir arada
// üretir. Ayrıntılı Analiz sekmesine her dönüşte aynı veri için yeniden hesaplamak
// gereksizdir. İmza yalnız veri/sonuç veya özellik ayarı değişince değişir.
// V1.1.251 KÖK FIX: eski anahtar script yüklenirken SENKRON JSON.parse/getItem ile
// okunuyor, adaptiveLearningHTML() her çağrıldığında da SENKRON JSON.stringify +
// setItem ile yazılıyordu. Bu, "Sayfa Yanıt Vermiyor" uyarısına yol açan kalan
// ana thread blokajlarından biriydi. Eski anahtar artık yalnız temizlik için
// tutulur; kalıcı anlık görüntü core-utils.js'teki paylaşılan IndexedDB
// store'unda asenkron saklanır (bkz. tkpUiCacheGet/tkpUiCacheSet).
const ADAPTIVE_LEARNING_HTML_CACHE_KEY='TKP_ADAPTIVE_LEARNING_TABLE_V41_ALL_DETAIL_P1_P5';
const ADAPTIVE_LEARNING_DURABLE_CACHE_KEY='tkp_adaptive_learning_table_v3_audit';
let _adaptiveLearningHtmlCache={signature:'',html:''};
let _adaptiveLearningDurableHydrating=false;
let _adaptiveLearningDurableHydratePromise=null;
if(typeof tkpDropLegacyLocalStorageKeySoon==='function') tkpDropLegacyLocalStorageKeySoon(ADAPTIVE_LEARNING_HTML_CACHE_KEY);
async function hydrateAdaptiveLearningDurableCache(expectedSignature,onReady){
  const expected=String(expectedSignature||(typeof adaptiveLearningRenderSignature==='function'?adaptiveLearningRenderSignature():''));
  if(_adaptiveLearningHtmlCache.signature===expected&&_adaptiveLearningHtmlCache.html){ if(typeof onReady==='function')onReady(true); return true; }
  if(typeof tkpUiCacheGet!=='function')return false;
  // Aynı anda başlayan açılış ve panel istekleri tek IndexedDB okumasını paylaşır.
  // İlk istek eski/boş DB imzasıyla başladıysa bittikten sonra gerçek imza için
  // bir kez daha okunur; ikinci çağrı sessizce cache-miss sayılmaz.
  if(_adaptiveLearningDurableHydrating&&_adaptiveLearningDurableHydratePromise){
    try{await _adaptiveLearningDurableHydratePromise;}catch(_e){}
    if(_adaptiveLearningHtmlCache.signature===expected&&_adaptiveLearningHtmlCache.html){if(typeof onReady==='function')onReady(true);return true;}
  }
  _adaptiveLearningDurableHydrating=true;
  _adaptiveLearningDurableHydratePromise=(async()=>{
    const parsed=await tkpUiCacheGet(ADAPTIVE_LEARNING_DURABLE_CACHE_KEY);
    const ok=!!(parsed&&String(parsed.signature||'')===expected&&typeof parsed.html==='string'&&parsed.html.length>50);
    if(ok)_adaptiveLearningHtmlCache={signature:expected,html:parsed.html};
    return ok;
  })();
  let ok=false;
  try{ok=await _adaptiveLearningDurableHydratePromise;return ok;}
  catch(_e){return false;}
  finally{
    _adaptiveLearningDurableHydrating=false;
    _adaptiveLearningDurableHydratePromise=null;
    if(typeof onReady==='function')onReady(ok);
  }
}

function adaptiveLearningRenderSignature(){
  // saveDB sırasında üretilip DB ile birlikte saklanan imza açılışın güvenilir
  // doğruluk kaynağıdır. Her Ctrl+F5'te 30 bin atı yeniden hashlemek hem gereksiz
  // hesap hem de kalıcı HTML cache'inin geç okunmasına neden oluyordu.
  const persisted=String(db?.learning_state?.dataset_signature||'');
  const dataSignature=persisted||(typeof learningDatasetSignature==='function'
    ? learningDatasetSignature(db)
    : `${(db?.files||[]).length}:${(db?.races||[]).length}`);
  let featureSettings='';
  try{ featureSettings=JSON.stringify(db?.settings?.algorithm_features||[]); }catch(_){ }
  const modelVersion=typeof TKP_LEARNING_MODEL_VERSION==='string'
    ? TKP_LEARNING_MODEL_VERSION
    : 'LEGACY_MODEL';
  return `${modelVersion}|${dataSignature}|${featureSettings}|${Number(ADAPTIVE_MIN_RACES)||0}|MODEL_TABLE_AUDIT_V3`;
}

function adaptiveLearningCacheIsCurrent(){
  return !!(_adaptiveLearningHtmlCache.html && _adaptiveLearningHtmlCache.signature===adaptiveLearningRenderSignature());
}

function adaptiveLearningHTML(){
  const renderSignature=adaptiveLearningRenderSignature();
  if(_adaptiveLearningHtmlCache.signature===renderSignature && _adaptiveLearningHtmlCache.html){
    return _adaptiveLearningHtmlCache.html;
  }
  if(typeof tkpDiscoverAdditionalFeatures==='function') tkpDiscoverAdditionalFeatures(db);
  // Ayrıntılı Analiz tablosunda gösterilen ağırlıklar, kupon ve yan bahis motorunun
  // gerçekten kullandığı ortak özellik kayıt sisteminden okunur. Eski adaptiveWeightsForRace
  // yalnız çekirdek sinyalleri bildiği için 400G/J-BYG/Ekip/HNDKP/S/ODS/VALUE/SP/Accurate/
  // X/G.PR/ODB gibi satırlar ağırlık sütununda '-' görünüyordu.
  const modelForPosition=position=>typeof tkpPurposeWeightsForRace==='function'
    ? tkpPurposeWeightsForRace(null,'prediction',position)
    : adaptiveWeightsForRace(null,position);
  const model1=modelForPosition(1);
  const model2=modelForPosition(2);
  const model3=modelForPosition(3);
  const model4=modelForPosition(4);
  const model5=modelForPosition(5);
  const sideModel=typeof tkpPurposeWeightsForRace==='function'
    ? tkpPurposeWeightsForRace(null,'sidebet',4)
    : {weights:model4.weights,stats:model4.stats,sample:model4.sample,trust:0,ready:model4.ready,level:model4.level};
  const keys=typeof TKP_FEATURE_REGISTRY!=='undefined'
    ? [...TKP_FEATURE_REGISTRY.keys()].filter(key=>{const f=TKP_FEATURE_REGISTRY.get(key);return Number(f?.basePrediction)>0||Number(f?.baseSideBet)>0;})
    : Object.keys(ADAPTIVE_BASE_WEIGHTS);
  const learningStatus=typeof tkpLearningStatus==='function'
    ? tkpLearningStatus()
    : {status:model5.ready?'GÜNCEL':'VERİ AZ',resultCount:model5.sample||0};
  const stateCode=String(learningStatus.status||'GÜNCEL').toLocaleUpperCase('tr-TR');
  const stateLabel=stateCode==='GÜNCELLENDİ'
    ? 'Güncellendi'
    : stateCode==='VERİ AZ'
      ? 'Veri az'
      : stateCode==='ÖĞRENİYOR'
        ? 'Öğreniyor'
        : 'Güncel';

  const rows=keys.map(key=>{
    const definition=typeof TKP_FEATURE_REGISTRY!=='undefined' ? TKP_FEATURE_REGISTRY.get(key) : null;
    const label=definition?.label||ADAPTIVE_LABELS[key]||key;
    const statsForKey=sideModel.stats?.[key]||model4.stats?.[key]||{
      p1:{ok:0,total:0,rawRate:0},
      p2:{ok:0,total:0,rawRate:0},
      p3:{ok:0,total:0,rawRate:0},
      p4:{ok:0,total:0,rawRate:0},
      p5:{ok:0,total:0,rawRate:0}
    };
    const cell=group=>{
      const safe=group||{ok:0,total:0,rawRate:0};
      if(!(Number(safe.total)>0)) return '<span class="muted" title="Bu gösterge için doğrulanmış kaynak verisi yok">Veri yok</span>';
      const ok=Number(safe.ok)||0,rate=Math.round((Number(safe.rawRate)||0)*100);
      return `${ok}/${Number(safe.total)} <span class="muted">(%${rate})</span>`;
    };
    const sample=Math.max(
      Number(statsForKey.p1?.total)||0,
      Number(statsForKey.p2?.total)||0,
      Number(statsForKey.p3?.total)||0,
      Number(statsForKey.p4?.total)||0,
      Number(statsForKey.p5?.total)||0
    );
    return `<tr>
      <td><b>${esc(label)}</b><div class="muted" style="font-size:9px;">${esc(key)}</div></td>
      <td class="num">${cell(statsForKey.p1)}</td>
      <td class="num">${cell(statsForKey.p2)}</td>
      <td class="num">${cell(statsForKey.p3)}</td>
      <td class="num">${cell(statsForKey.p4)}</td>
      <td class="num">${cell(statsForKey.p5)}</td>
      <td class="num">${key==='x_kulis'?'<span class="muted" title="X/Kulis genel modele girmez">Gölge</span>':analysisWeightPercentOrDash(model1.weights?.[key])}</td>
      <td class="num">${key==='x_kulis'?'<span class="muted" title="X/Kulis genel modele girmez">Gölge</span>':analysisWeightPercentOrDash(model2.weights?.[key])}</td>
      <td class="num">${key==='x_kulis'?'<span class="muted" title="X/Kulis genel modele girmez">Gölge</span>':analysisWeightPercentOrDash(model3.weights?.[key])}</td>
      <td class="num">${key==='x_kulis'?'<span class="muted" title="X/Kulis genel modele girmez">Gölge</span>':analysisWeightPercentOrDash(model4.weights?.[key])}</td>
      <td class="num">${key==='x_kulis'?'<span class="muted" title="X/Kulis genel modele girmez">Gölge</span>':analysisWeightPercentOrDash(model5.weights?.[key])}</td>
      <td class="num">${key==='x_kulis'?'<span class="muted" title="X/Kulis genel modele girmez">Gölge</span>':analysisWeightPercentOrDash(sideModel.weights?.[key])}</td>
      <td>${sample>=ADAPTIVE_MIN_RACES
        ? '<span class="sideBetReady">Güncel</span>'
        : `<span class="sideBetWait">${Math.max(0,ADAPTIVE_MIN_RACES-sample)} yarış daha</span>`}</td>
    </tr>`;
  }).join('');

  const statusClass=stateCode==='VERİ AZ'?'sideBetWait':'sideBetReady';
  const html=`<div style="margin-bottom:9px;">
      <span class="${statusClass}">${esc(stateLabel)}</span>
      <span class="muted">· ${analysisNumberOrDash(learningStatus.resultCount)} sonuçlu yarış · model yalnız yeni doğrulanmış sonuç geldiğinde güncellenir</span>
    </div>
    <div class="tableWrap adaptiveLearningWrap"><table class="adaptiveLearningTable">
      <thead><tr>
        <th>Gösterge</th>
        <th class="num" title="Yalnız gerçek birinci olan at kullanılır">1. İsabet</th>
        <th class="num" title="Yalnız gerçek ikinci olan at kullanılır">2. İsabet</th>
        <th class="num" title="Yalnız gerçek üçüncü olan at kullanılır">3. İsabet</th>
        <th class="num" title="Yalnız gerçek dördüncü olan at kullanılır">4. İsabet</th>
        <th class="num" title="Yalnız gerçek beşinci olan at kullanılır">5. İsabet</th>
        <th class="num" title="Birinci tahmin adayını seçerken bu göstergenin modeldeki ağırlığı">1. Ağırlık</th>
        <th class="num" title="İkinci tahmin adayını seçerken bu göstergenin modeldeki ağırlığı">2. Ağırlık</th>
        <th class="num" title="Üçüncü tahmin adayını seçerken bu göstergenin modeldeki ağırlığı">3. Ağırlık</th>
        <th class="num" title="Dördüncü tahmin adayını seçerken bu göstergenin modeldeki ağırlığı">4. Ağırlık</th>
        <th class="num" title="Beşinci tahmin adayını seçerken bu göstergenin modeldeki ağırlığı">5. Ağırlık</th>
        <th class="num" title="Yan bahis modelindeki ağırlık">Yan Ağırlık</th>
        <th>Durum</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="muted" style="margin:8px 0 0;">
      Tahmin 1–5 sütunlarının her biri yalnız kendi gerçek bitiriş konumunu ölçer; Tahmin 5 yalnız gerçek beşinci gelen atlarla öğrenir. Aday Ağırlığı sütunları isabet sayısı değil, ilgili sıradaki at seçilirken göstergenin modelde kullandığı yüzde etkidir; küçük ama gerçek paylar iki ondalıkla gösterilir. X/Kulis genel modele girmez ve bu nedenle Gölge olarak işaretlenir. Çekirdek model ailelerinin taban etkisi güçlendirilir; doğrulanmış başarı farkı yeterli örnekte daha belirgin uygulanır. Otomatik eklenen ham tablo alanları toplam etkinin en fazla %12’sini alır. Eksik veri paydaya katılmaz. ACCURATE, KG, DRC, ST, TKP, AGF, Y.PUAN, BMB, profil, geçmiş, koşu uyumu ve kural sinyalleri tahmin ile yan bahis için ayrı ağırlıklarla kullanılır.
    </p>`;
  _adaptiveLearningHtmlCache={signature:renderSignature,html};
  // Fire-and-forget: IndexedDB structured clone ana thread'i senkron
  // JSON.stringify + localStorage.setItem kadar bloklamaz.
  if(typeof tkpUiCacheSet==='function'){
    Promise.resolve().then(()=>tkpUiCacheSet(ADAPTIVE_LEARNING_DURABLE_CACHE_KEY,{signature:renderSignature,html,savedAt:Date.now()})).catch(()=>{});
  }
  return html;
}

// V1.1.308-MEM-FIX (kök neden #2): Ayrıntılı Analiz sekmesine kullanıcı DOĞRUDAN
// (Tahmin sekmesine hiç uğramadan, ya da idle ön-ısıtma daha bitmeden) geldiğinde
// renderAnalytics() bu tabloyu doğrudan senkron adaptiveLearningHTML() ile
// üretiyordu; o da adaptiveSignalStats(null)'ı soğuk tetikleyip gerçek veride
// tek seferde ~187 saniye ana iş parçacığını kilitliyordu (Tahmin sekmesinden
// gelen ön-ısıtma yalnızca DAHA ÖNCE tamamlanmışsa işe yarıyordu). Bu asenkron
// sarmalayıcı, HTML'i üretmeden önce paylaşılan önbelleği (adaptiveSignalStatsAsync
// ile, yarış döngüsü içinde periyodik olarak tarayıcıya nefes vererek) doldurur;
// önbellek zaten güncelse adaptiveSignalStatsAsync anında döner. Ardından mevcut
// adaptiveLearningHTML() DEĞİŞTİRİLMEDEN çağrılır -- artık yalnızca sıcak
// önbellekten okuduğu için milisaniyeler sürer. Böylece sekmeye nasıl gelinirse
// gelinsin (Tahmin üzerinden ya da doğrudan) donma olmaz.
async function adaptiveLearningHTMLAsync(){
  if(typeof adaptiveLearningCacheIsCurrent==='function' && adaptiveLearningCacheIsCurrent()){
    return adaptiveLearningHTML();
  }
  // RAM boşsa önce kalıcı IndexedDB snapshot'ını bekle. Önceki akış bu okumayı
  // beklemeden adaptiveSignalStatsAsync(null) başlatıyor ve program her yeniden
  // açıldığında değişmemiş arşivi tekrar tarıyordu.
  if(typeof hydrateAdaptiveLearningDurableCache==='function'){
    try{
      const hit=await hydrateAdaptiveLearningDurableCache(adaptiveLearningRenderSignature());
      if(hit&&adaptiveLearningCacheIsCurrent())return adaptiveLearningHTML();
    }catch(_e){}
  }
  // V1.1.329 ROCKET: ağır 3.000+ koşu adaptif taraması kullanıcı ekranının
  // gelmesini BEKLETMEZ. Varsa bir önceki kalıcı tablo anında gösterilir; güncel
  // veri arka planda cooperative hesaplanır ve bitince aynı panel yerinde yenilenir.
  if(!globalThis.__tkpAdaptiveLearningBackground){
    globalThis.__tkpAdaptiveLearningBackground=Promise.resolve().then(async()=>{
      if(typeof adaptiveSignalStatsAsync==='function')await adaptiveSignalStatsAsync(null);
      const html=adaptiveLearningHTML();
      if(typeof globalThis.tkpStoreAnalyticsPanelNow==='function')globalThis.tkpStoreAnalyticsPanelNow('adaptiveLearningTable',html);
      else{const el=document.getElementById('adaptiveLearningTable');if(el)el.innerHTML=html;}
      return html;
    }).catch(error=>{
      console.error('Adaptif analiz arka plan hatası:',error);
      return '';
    }).finally(()=>{globalThis.__tkpAdaptiveLearningBackground=null;});
  }
  const stale=String(globalThis.__tkpStaleAnalyticsItems?.adaptiveLearningTable||'');
  if(stale){
    return `<div class="card" style="border-left:5px solid #2563eb;margin-bottom:8px"><b>⚡ Hazır önbellek gösteriliyor.</b> Yeni/değişen veri arka planda güncelleniyor; menüler kullanılabilir.</div>${stale}`;
  }
  const raceCount=(db?.races||[]).length;
  return `<div class="card" style="border-left:5px solid #2563eb"><b>⚡ İlk 5 algoritma analizi arka planda hazırlanıyor.</b><br>${analysisNumberOrDash(raceCount)} koşu taranırken bu ekran ve diğer menüler kilitlenmez. Sonuç hazır olduğunda tablo burada otomatik yenilenir.</div>`;
}
if(typeof globalThis!=='undefined') globalThis.adaptiveLearningHTMLAsync=adaptiveLearningHTMLAsync;

function sideBetPoolHTML(label, pool, raceHorses, rankMap, collapseEkuri=false){
  const clean=(pool||[]).filter(no=>no!=null && String(no).trim()!=='');
  // Çifte'de tek eküri temsilcisi yeterlidir; ekran da maliyet hesabıyla aynı listeyi
  // göstermeli. Diğer yan bahis görünümlerinin mevcut eküri gösterimine dokunulmaz.
  const visible=collapseEkuri ? clean.slice() : ekuriDisplayNos(clean,raceHorses||[]);
  const rankFor=no=>{
    if(!rankMap) return null;
    if(rankMap.has(String(no))) return rankMap.get(String(no));
    for(const sourceNo of clean) if(sameEkuri(sourceNo,no) && rankMap.has(String(sourceNo))) return rankMap.get(String(sourceNo));
    return null;
  };
  return `<div class="sideBetPoolRow"><span class="sideBetPoolLabel">${esc(label)}</span>${visible.length?visible.map(no=>sideBetHorseToken(no,raceHorses,rankFor(no))).join(''):'<span class="sideBetEmptyPool">At yok</span>'}</div>`;
}

function tkpWilsonLower(ok,total,z=1.96){
  const n=Math.max(0,Number(total)||0),k=Math.max(0,Math.min(n,Number(ok)||0));
  if(!n)return 0;
  const p=k/n,zz=z*z,den=1+zz/n;
  const centre=p+zz/(2*n),spread=z*Math.sqrt((p*(1-p)+zz/(4*n))/n);
  return Math.max(0,(centre-spread)/den);
}
function tkpDecisionBadge(label){
  const key=String(label||'').toLocaleUpperCase('tr-TR');
  const cls=key==='OYNA'?'play':(key==='PAS'?'pass':'caution');
  return `<span class="tkpPlayDecision ${cls}">${esc(key||'TEMKİNLİ')}</span>`;
}
function tkpRoiDecision({ok=0,total=0,roi=null,payoutKnown=0,kind='generic'}={}){
  const n=Math.max(0,Number(total)||0),hits=Math.max(0,Number(ok)||0);
  const rate=n?hits/n:0,lower=tkpWilsonLower(hits,n),r=Number.isFinite(Number(roi))?Number(roi):null,pk=Math.max(0,Number(payoutKnown)||0);
  let label='TEMKİNLİ',reason='Kayıt yok';
  if(n<1){ label='TEMKİNLİ'; reason='Kayıt yok'; }
  else if(kind==='altili'){
    if(r!=null&&r<0&&rate<0.10){label='PAS';reason='ROI negatif ve 6/6 oranı düşük';}
    else if(r!=null&&r>0&&rate>=0.10&&lower>=0.04){label='OYNA';reason='Pozitif ROI + tekrarlanabilir 6/6';}
    else if(rate>=0.10&&lower>=0.03){label='TEMKİNLİ';reason='Tam isabet var; maliyet kontrollü tutulmalı';}
    else if(r!=null&&r>0){label='TEMKİNLİ';reason='ROI pozitif ama tam isabet seyrek';}
    else if(lower<0.03){label='PAS';reason='Wilson alt sınırı zayıf';}
  }else{
    // V50 HIT-FIRST: önce gerçek isabet + Wilson; ROI yalnız ciddi zarar filtresidir.
    // Böylece yüksek isabetli/ucuz oyun negatif ROI yüzünden tamamen kaybolmaz,
    // ancak pozitif ROI olmayan oyuna kör OYNA etiketi de verilmez.
    // KÖK GÜÇLENDİRME: gerçek TJK ödemeleriyle yapılan holdout simülasyonunda
    // (bkz. NOTLAR) pk=36-121 aralığındaki "pozitif ROI" örnekleri 4 zaman
    // diliminin 3'ünde tersine döndü -- küçük örneklemde pozitif ROI güvenilir
    // bir OYNA sinyali değil. OYNA artık en az TKP_SIDEBET_ROI_TRUST_SAMPLE
    // ödeme-bilinen gözlem ister; onun altında en iyi ihtimalle TEMKİNLİ'dir.
    // Ciddi zarar eşiği de -25 -> -15'e çekildi: gerçek para simülasyonunda
    // -13 ile -35 arası ROI bu ürün ailesinde İSTİSNA değil KURAL çıktı.
    const roiTrustworthy=pk>=TKP_SIDEBET_ROI_TRUST_SAMPLE;
    if(pk>=5&&r!=null&&r<=-15){label='PAS';reason='Ciddi negatif ROI; isabet maliyeti karşılamıyor';}
    else if(roiTrustworthy&&lower>=0.25&&r!=null&&r>=0){label='OYNA';reason='Yüksek isabet + güçlü Wilson + pozitif ROI (yeterli örneklem)';}
    else if(lower>=0.25&&r!=null&&r>=0){label='TEMKİNLİ';reason=`Pozitif ROI ama örneklem küçük (n=${pk}<${TKP_SIDEBET_ROI_TRUST_SAMPLE}); tek dönemin şansı olabilir`;}
    else if(lower>=0.45&&(r==null||r>-15)){label='TEMKİNLİ';reason='Çok yüksek isabet; ROI negatif olduğu için düşük maliyetle';}
    else if(lower>=0.15&&(r==null||r>-15)){label='TEMKİNLİ';reason='Yüksek isabet / düşük maliyet adayı';}
    else if(pk>=5&&r!=null&&r>=0&&rate>=0.20){label='TEMKİNLİ';reason='ROI pozitif fakat değişkenlik yüksek';}
    else {label='PAS';reason='İsabet-güven-maliyet dengesi zayıf';}
  }
  return {label,reason,rate,lower,roi:r,payoutKnown:pk,total:n,ok:hits};
}
function tkpSideBetArchiveKey(title){
  const t=String(title||'').toLocaleUpperCase('tr-TR');
  if(t.includes('ÇİFTE'))return 'cifte';
  if(t.includes('SIRALI ÜÇLÜ'))return 'sirali_uclu';
  if(t.includes('SIRALI İKİLİ'))return 'sirali_ikili';
  if(t.includes('SIRALI 5')||t.includes("SIRALI 5'"))return 'sirali5li';
  if(t.includes('DÖRTLÜ')||t.includes('TABELA'))return 'tabela';
  return '';
}
function tkpSideBetDecisionHTML(title,metric){
  const key=tkpSideBetArchiveKey(title);
  let finance=null;
  try{ finance=key&&typeof tkpVerifiedOpportunityMetric==='function'?tkpVerifiedOpportunityMetric(key):null; }catch(_e){}
  if(!finance){try{ finance=key&&typeof _v25ArchiveSideBetBacktest==='function'?_v25ArchiveSideBetBacktest(100)?.[key]:null; }catch(_e){}}
  const total=Number(metric?.total)||0,ok=Number(metric?.ok)||0;
  const roi=finance&&Number.isFinite(Number(finance.roi))?Number(finance.roi):null;
  const d=tkpRoiDecision({ok,total,roi,payoutKnown:Number(finance?.payoutKnown)||0,kind:'side'});
  const enough=total>=TKP_MIN_PERCENT_SAMPLE;
  const rate=total?Math.round(100*ok/total):0,lower=Math.round(100*d.lower);
  const metricText=enough?`<b>Tutma %${rate}</b> · Wilson alt %${lower} · ${roi==null?'ROI -':`ROI ${roi>=0?'+':''}%${fmt2(roi)}`}`:`<b>${ok}/${total}</b>`;
  return `<div class="tkpDecisionLine">${tkpDecisionBadge(d.label)}<span>${metricText}</span><span class="tkpDecisionReason">${esc(d.reason)}</span></div>`;
}
function tkpForwardCouponCalibration(typeKey){
  // En hızlı ve en temiz kalibrasyon kaynağı: sonuçtan ÖNCE kaydedilmiş gerçek kupon
  // snapshotları. Render sırasında geçmiş yarışı yeniden tahmin etmez; leakage yoktur.
  const rows=(db?.forward_tracking_log||[]).filter(r=>r?.evaluated_at&&String(r?.winner_no||'').trim()&&Array.isArray(r?.coupons?.[typeKey])&&r.coupons[typeKey].length);
  const groups=new Map();
  const track=v=>String(v||'').toLocaleUpperCase('tr-TR').trim();
  for(const r of rows){
    const key=[String(r.race_date||''),track(r.hippodrome),Number(r.altili_no)||1].join('|');
    if(!groups.has(key))groups.set(key,new Map());
    groups.get(key).set(Number(r.leg)||0,r);
  }
  let meetings=0,full=0,five=0;
  const same=(a,b)=>{
    const aa=String(a??'').trim(),bb=String(b??'').trim();
    if(!aa||!bb)return false;if(aa===bb)return true;
    try{return typeof sameEkuri==='function'&&sameEkuri(aa,bb);}catch(_e){return false;}
  };
  for(const legs of groups.values()){
    const six=[1,2,3,4,5,6].map(n=>legs.get(n));
    if(six.some(x=>!x))continue;
    let hit=0;
    for(const r of six){if((r.coupons[typeKey]||[]).some(no=>same(no,r.winner_no)))hit++;}
    meetings++;if(hit===6)full++;if(hit>=5)five++;
  }
  return {meetings,full,five,source:'PRE-RACE İleri Takip'};
}
function tkpCouponDecisionData(res){
  const frozen=res?.decisionSnapshot;
  const frozenLabel=String(frozen?.label||'').toLocaleUpperCase('tr-TR');
  if(['PAS','TEMKİNLİ','OYNA'].includes(frozenLabel)){
    return {
      label:frozenLabel,
      summary:String(frozen.summary||'Kayıtlı yarış-öncesi karar'),
      reason:String(frozen.reason||'Karar yarış öncesinde donduruldu'),
      frozen:true
    };
  }
  const typeKey=String(res?.typeKey||'');
  let rows=[],metric=null;
  try{
    rows=typeof tkpV55MeetingRows==='function'?tkpV55MeetingRows():[];
    metric=typeof tkpV55WindowMetric==='function'?tkpV55WindowMetric(typeKey,rows.slice(-28)):null;
  }catch(_){metric=null;}
  if(!metric||!metric.n)return {label:'TEMKİNLİ',summary:'Doğrulanmış benzer yarış kaydı yok',reason:'Veri oluşana kadar maliyet kontrollü tutulur',frozen:false};
  const lower=Math.round(100*wilson(metric.hits,metric.n));
  const rate=Math.round(100*metric.hits/metric.n);
  const enough=metric.n>=TKP_MIN_PERCENT_SAMPLE;
  const label=!enough?'TEMKİNLİ':(lower>=18?'OYNA':lower>=7?'TEMKİNLİ':'PAS');
  const pctText=enough?`%${rate} · Wilson alt %${lower}`:`n=${metric.n}`;
  return {label,summary:`Son 28 V55: ${metric.hits}/${metric.n} · ${pctText}`,reason:`6/6 toplantı bazlı · TEK hata ${metric.wrongSingles} · kapsam kaçışı ${metric.coverage} · tarihsel kayıtlar ayrı tutulur`,frozen:false};
}
function tkpCouponDecisionHTML(res){
  if(res?.calculationLimited)return '<div class="tkpDecisionLine"><b>Süre korumalı plan</b><span class="tkpDecisionReason">Bu planın güncel yarışlardaki başarı ölçümü henüz yok.</span></div>';
  const d=tkpCouponDecisionData(res);
  return `<div class="tkpDecisionLine">${tkpDecisionBadge(d.label)}<span><b>${esc(d.summary)}</b></span><span class="tkpDecisionReason">${esc(d.reason)}</span></div>`;
}



// V50 — EN YÜKSEK İSABET + EN DÜŞÜK MALİYET YÖNLENDİRİCİSİ
// Bu kalibrasyonlar 16.08.2026 gerçek .tkpbak üzerinde, sonuç girdileri maskelenmiş
// canonical canlı motor başlangıç kalibrasyonu; V54 canlı bütçe sözleşmesi 1.200 TL Normal / 1.400 TL Sürprizdir
// doğrulanan başlangıç değerleridir. Kullanıcı Back Test'i çalıştırdığında aynı alanlar
// son gerçek arşiv sonucuyla güncellenir; sahte fallback kupon kullanılmaz.
const TKP_V50_VERIFIED_PRODUCT_METRICS=Object.freeze({
  // 16.08.2026 gerçek .tkpbak · 78 dosya / 468 koşu · 29 doğrulanmış toplantı.
  // Canlı kupon motoru, sonuç maskesi, aynı-toplantı öğrenme dışlama ve resmî ikramiye.
  altili_main:{ok:3,total:29,cost:39248,financeCost:39248,ret:26722.61,payoutKnown:29,label:'Altılı · Normal'},
  altili_surprise:{ok:0,total:29,cost:28348.5,financeCost:28348.5,ret:0,payoutKnown:29,label:'Altılı · Sürpriz'},
  besli_main:{ok:3,total:29,cost:21592.5,financeCost:21592.5,ret:7561.56,payoutKnown:29,label:'Beşli Ganyan'},
  besli_surprise:{ok:0,total:29,cost:17767.5,financeCost:17767.5,ret:0,payoutKnown:29,label:'Beşli Ganyan · Sürpriz'},
  dortlu_ganyan_main:{ok:6,total:28,cost:5706.75,financeCost:5706.75,ret:2799.36,payoutKnown:28,label:'Dörtlü Ganyan'},
  dortlu_ganyan_surprise:{ok:3,total:28,cost:10760.75,financeCost:10760.75,ret:703.57,payoutKnown:28,label:'Dörtlü Ganyan · Sürpriz'},
  uclu_ganyan_main:{ok:10,total:30,cost:2054,financeCost:2054,ret:1862.90,payoutKnown:29,label:'Üçlü Ganyan'},
  uclu_ganyan_surprise:{ok:7,total:30,cost:3714,financeCost:3714,ret:1336.20,payoutKnown:29,label:'Üçlü Ganyan · Sürpriz'},
  cifte:{ok:90,total:145,cost:3625,financeCost:3625,ret:2948.10,payoutKnown:145,label:'Çifte'},
  sirali_ikili:{ok:97,total:167,cost:3356,financeCost:3356,ret:2903.00,payoutKnown:167,label:'Sıralı İkili'},
  sirali_uclu:{ok:57,total:101,cost:12312,financeCost:12312,ret:14916.00,payoutKnown:101,label:'Sıralı Üçlü'},
  tabela:{ok:4,total:31,cost:11352,financeCost:11352,ret:4407.82,payoutKnown:31,label:'Tabela / Dörtlü'},
  sirali5li:{ok:7,total:46,cost:70907.5,financeCost:70907.5,ret:65883.28,payoutKnown:46,label:'Sıralı 5’li'}
});
function tkpNormalizeOpportunityMetric(metric){
  const total=Math.max(0,Number(metric?.total??metric?.meetings)||0);
  const ok=Math.max(0,Number(metric?.ok??metric?.full)||0);
  const cost=Math.max(0,Number(metric?.financeCost??metric?.cost)||0);
  const ret=Math.max(0,Number(metric?.ret)||0);
  const payoutKnown=Math.max(0,Number(metric?.payoutKnown)||0);
  const roi=cost?100*(ret-cost)/cost:null;
  return {...metric,total,ok,cost,ret,payoutKnown,roi,rate:total?ok/total:0,avgCost:total?cost/total:0};
}
function tkpLastBacktestMetric(key){
  const result=globalThis.__tkpLastFastBacktestResult;
  if(!result)return null;
  if(key==='altili_main')return result?.out?.main?{...result.out.main,total:result.out.main.meetings,ok:result.out.main.full}:null;
  if(key==='altili_surprise')return result?.out?.surprise?{...result.out.surprise,total:result.out.surprise.meetings,ok:result.out.surprise.full}:null;
  const map={
    besli_main:'besli_main',besli_surprise:'besli_surprise',
    dortlu_ganyan_main:'dortlu_ganyan_main',dortlu_ganyan_surprise:'dortlu_ganyan_surprise',
    uclu_ganyan_main:'uclu_ganyan_main',uclu_ganyan_surprise:'uclu_ganyan_surprise',
    cifte:'cifte',sirali_ikili:'sirali_ikili',sirali_uclu:'sirali_uclu',tabela:'tabela',sirali5li:'sirali5li'
  };
  return map[key]?result?.side?.[map[key]]||null:null;
}
function tkpVerifiedOpportunityMetric(key){
  return tkpNormalizeOpportunityMetric(tkpLastBacktestMetric(key)||TKP_V50_VERIFIED_PRODUCT_METRICS[key]||{});
}
function tkpRaceOffersLiveBet(race,key){
  const canon=value=>{try{return typeof tkpCanonicalBetKey==='function'?tkpCanonicalBetKey(value):String(value||'');}catch(_){return String(value||'');}};
  const offered=(race?.available_bets||[]).map(canon);
  return offered.includes(key)||(race?.payouts||[]).some(p=>canon(p?.key)===key||String(p?.key||'')===key);
}
function tkpMultiGanyanSlice(coupon,raceResults,endIndex,legCount,productKey){
  if(!coupon||coupon.error||!Array.isArray(coupon.legs))return null;
  const rows=(raceResults||[]).slice().sort((a,b)=>Number(a?.r?.leg??a?.leg)-Number(b?.r?.leg??b?.leg));
  const target=rows.slice(endIndex-legCount+1,endIndex+1);
  if(target.length!==legCount)return null;
  const endRace=target[target.length-1]?.r||target[target.length-1];
  // Beşli/Dörtlü/Üçlü Ganyan için eksik available_bets kaydı ürünü yok saydırmaz.
  // Bu ürünler toplantının son 5/4/3 koşusundan üretilir; resmî sonuç geldiyse payout ayrıca eşleşir.
  const byLeg=new Map((coupon.legs||[]).map(leg=>[Number(leg?.r?.leg),leg]));
  const legs=[];
  for(const item of target){
    const race=item?.r||item,source=byLeg.get(Number(race?.leg));
    if(!source||!(source.picks||[]).length)return null;
    legs.push({r:race,picks:[...(source.picks||[])],sourceLeg:source});
  }
  const unit=typeof ganyanUnitPrice==='function'?(Number(ganyanUnitPrice(endRace?.hippodrome,legCount))||2):2;
  const combinations=legs.reduce((n,leg)=>n*Math.max(1,(leg.picks||[]).length),1);
  return {productKey,legCount,legs,unit,combinations,cost:round2ish(combinations*unit),startLeg:Number(legs[0]?.r?.leg)||1,endLeg:Number(endRace?.leg)||legCount,endRace};
}
function tkpMultiProductMetricKey(productKey,variant){
  return `${productKey}_${variant==='surprise'?'surprise':'main'}`;
}
function tkpOpportunityScore(metric,currentCost=0,kind='side'){
  const d=tkpRoiDecision({ok:metric.ok,total:metric.total,roi:metric.roi,payoutKnown:metric.payoutKnown,kind});
  // V50 son karar: İSABET > WILSON > UCUZ MALİYET > ROI zarar filtresi.
  // ROI yalnız küçük denge puanı verir; daha düşük isabetli pahalı ürünü yukarı taşıyamaz.
  const hitPart=(Number(metric.rate)||0)*1000;
  const confidencePart=d.lower*400;
  const cost=Math.max(1,Number(currentCost)||metric.avgCost||1);
  const costPenalty=Math.log10(cost+1)*24;
  const roi=Number.isFinite(Number(metric.roi))?Number(metric.roi):0;
  const roiGuard=Math.max(-10,Math.min(10,roi))*0.4;
  const decisionGuard=d.label==='PAS'?-140:0;
  return hitPart+confidencePart-costPenalty+roiGuard+decisionGuard;
}
function tkpOpportunityCompare(a,b){
  // Gerçek lexicographic sıra: oynanabilirlik filtresi -> tutma -> Wilson -> ucuz maliyet -> ROI.
  const ma=a?.metric||a||{},mb=b?.metric||b||{};
  const da=a?.decision||tkpRoiDecision({ok:ma.ok,total:ma.total,roi:ma.roi,payoutKnown:ma.payoutKnown,kind:a?.kind||'side'});
  const dbb=b?.decision||tkpRoiDecision({ok:mb.ok,total:mb.total,roi:mb.roi,payoutKnown:mb.payoutKnown,kind:b?.kind||'side'});
  const passA=da.label==='PAS'?1:0,passB=dbb.label==='PAS'?1:0;
  if(passA!==passB)return passA-passB;
  const rateA=Number(ma.rate)||0,rateB=Number(mb.rate)||0;if(rateA!==rateB)return rateB-rateA;
  const lowA=Number(da.lower)||0,lowB=Number(dbb.lower)||0;if(lowA!==lowB)return lowB-lowA;
  const costA=Math.max(0,Number(a?.cost)||Number(ma.avgCost)||0),costB=Math.max(0,Number(b?.cost)||Number(mb.avgCost)||0);if(costA!==costB)return costA-costB;
  const roiA=Number.isFinite(Number(ma.roi))?Number(ma.roi):-Infinity,roiB=Number.isFinite(Number(mb.roi))?Number(mb.roi):-Infinity;
  return roiB-roiA;
}
function tkpV54HitFirstGanyanCandidate(productKey,legCount,rows){
  const cfg={
    besli:{widths:[5,3,3,3,3],rank:'strategy',label:'V54 HIT-FIRST 5×3×3×3×3'},
    dortlu_ganyan:{widths:[3,3,4,2],rank:'strategy',label:'V54 HIT-FIRST 3×3×4×2'},
    uclu_ganyan:{widths:[5,4,1],rank:'altili',label:'V54 HIT-FIRST 5×4×1'}
  }[productKey];
  if(!cfg||rows.length<legCount)return null;
  const target=rows.slice(-legCount),legs=[];
  for(let i=0;i<target.length;i++){
    const item=target[i],r=item?.r||item;
    const horses=(item?.scored||r?.horses||[]).filter(h=>h&&!isNonRunner(h));
    let order=[];
    try{
      order=cfg.rank==='altili'&&typeof altiliWinnerOrderForRace==='function'
        ? altiliWinnerOrderForRace(r,horses.slice())
        : (typeof strategicOrderForRace==='function'?strategicOrderForRace(r,horses.slice()):horses.slice());
    }catch(_){order=horses.slice();}
    const width=Math.max(1,Math.min(cfg.widths[i]||1,order.length));
    const picks=order.slice(0,width);
    if(!picks.length)return null;
    legs.push({r,picks,sourceLeg:{r,picks}});
  }
  const endRace=legs[legs.length-1].r;
  const unit=typeof ganyanUnitPrice==='function'?(Number(ganyanUnitPrice(endRace?.hippodrome,legCount))||2):2;
  const combinations=legs.reduce((n,l)=>n*Math.max(1,l.picks.length),1);
  return {productKey,legCount,legs,unit,combinations,cost:round2ish(combinations*unit),startLeg:Number(legs[0].r?.leg)||1,endLeg:Number(endRace?.leg)||legCount,endRace,variant:'hitfirst',v54Label:cfg.label};
}
function tkpMultiGanyanCandidates(productKey,legCount,raceResults,coupons=activeCoupons){
  const rows=(raceResults||[]).slice().sort((a,b)=>Number(a?.r?.leg??a?.leg)-Number(b?.r?.leg??b?.leg));
  const out=[];
  const endIndex=rows.length-1; // kısa ganyanlar daima SON N koşu: 5'li son5, 4'lü son4, 3'lü son3
  if(endIndex<legCount-1)return out;
  const hitFirst=tkpV54HitFirstGanyanCandidate(productKey,legCount,rows);
  if(hitFirst){
    const calib={
      besli:{ok:12,total:41,rate:12/41,avgCost:607.5,roi:3.2,payoutKnown:15},
      dortlu_ganyan:{ok:13,total:40,rate:13/40,avgCost:126,roi:7.1,payoutKnown:15},
      uclu_ganyan:{ok:15,total:43,rate:15/43,avgCost:39.81,roi:-13.2,payoutKnown:17}
    }[productKey]||{ok:0,total:0,rate:0,avgCost:hitFirst.cost,roi:null,payoutKnown:0};
    out.push({...hitFirst,metric:calib,score:tkpOpportunityScore(calib,hitFirst.cost,'side')+25});
  }
  for(const variant of ['main','alt','surprise']){
    const coupon=coupons?.[variant];
    const slice=tkpMultiGanyanSlice(coupon,rows,endIndex,legCount,productKey);
    if(!slice)continue;
    const metric=tkpVerifiedOpportunityMetric(tkpMultiProductMetricKey(productKey,variant));
    out.push({...slice,variant,metric,score:tkpOpportunityScore(metric,slice.cost,'side')});
  }
  return out.sort((a,b)=>{
    if(a.variant==='hitfirst'&&b.variant!=='hitfirst')return -1;
    if(b.variant==='hitfirst'&&a.variant!=='hitfirst')return 1;
    return tkpOpportunityCompare(a,b)||a.startLeg-b.startLeg;
  });
}
function tkpSameHorseOpportunity(a,b){
  const aa=String(a??'').trim(),bb=String(b??'').trim();
  if(!aa||!bb)return false;
  if(aa===bb)return true;
  try{if(typeof ekuriBase==='function'&&ekuriBase(aa)===ekuriBase(bb))return true;}catch(_){}
  try{return typeof sameEkuri==='function'&&sameEkuri(aa,bb);}catch(_){return false;}
}
function tkpCouponSliceHit(slice){
  if(!slice||!Array.isArray(slice.legs))return {known:false,hit:false};
  let known=0,hit=0;
  for(const leg of slice.legs){
    const winners=(leg?.r?.horses||[]).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
    if(!winners.length)continue;
    known++;
    const ok=(leg.picks||[]).some(p=>winners.some(w=>tkpSameHorseOpportunity(p?.horse_no??p,w?.horse_no)));
    if(ok)hit++;
  }
  return {known:known===slice.legs.length,hit:known===slice.legs.length&&hit===slice.legs.length,hits:hit};
}
// V1.1.208 TEMİZLİK: tkpMultiGanyanCardHTML (ve yalnız onun kullandığı
// tkpV55MultiGanyanRescueHTML) kaldırıldı. Bu, Beşli/Dörtlü/Üçlü Ganyan için
// ayrı bir "HIT-FIRST" kart üreticisiydi ama hiçbir yerden çağrılmıyordu —
// tkpMultiGanyanCardsHTML() zaten kasıtlı olarak boş döndürülüyor (aşağıda),
// bu ürünler artık couponVariantCompactHTML üzerinden Altılı ile AYNI kod
// yoluyla (tkpV55CouponDiagnosisData, kind:'coupon') canlı teşhis alıyor.
// tkpMultiGanyanCandidates() dokunulmadı: tkpOpportunityCatalog() içindeki
// multiCost() hâlâ onu kullanıyor.
function tkpMultiGanyanCardsHTML(raceResults,coupons=activeCoupons){ return ''; }

function tkpOpportunityCatalog(raceResults,coupons=activeCoupons){
  const multiCost=(key,legs)=>tkpMultiGanyanCandidates(key,legs,raceResults,coupons)[0]?.cost||0;
  // Karar tablosu eski fallback/whale özetini değil, son canlı Back Test'i;
  // Back Test henüz çalışmadıysa yukarıdaki temiz gerçek-veri kalibrasyonunu kullanır.
  const side={
    cifte:tkpVerifiedOpportunityMetric('cifte'),
    sirali_ikili:tkpVerifiedOpportunityMetric('sirali_ikili'),
    sirali_uclu:tkpVerifiedOpportunityMetric('sirali_uclu'),
    tabela:tkpVerifiedOpportunityMetric('tabela'),
    sirali5li:tkpVerifiedOpportunityMetric('sirali5li')
  };
  const mk=(key,label,metric,kind='side',cost=0)=>{const m=tkpNormalizeOpportunityMetric(metric);const d=tkpRoiDecision({ok:m.ok,total:m.total,roi:m.roi,payoutKnown:m.payoutKnown,kind});return {key,label,metric:m,decision:d,cost:cost||m.avgCost,score:tkpOpportunityScore(m,cost||m.avgCost,kind)};};
  const main=tkpVerifiedOpportunityMetric('altili_main');
  const rows=[
    mk('altili','Altılı · Normal',main,'altili',Number(coupons?.main?.cost)||0),
    mk('besli','Beşli Ganyan',tkpVerifiedOpportunityMetric('besli_main'),'side',multiCost('besli',5)),
    mk('dortlu_ganyan','Dörtlü Ganyan',tkpVerifiedOpportunityMetric('dortlu_ganyan_main'),'side',multiCost('dortlu_ganyan',4)),
    mk('uclu_ganyan','Üçlü Ganyan',tkpVerifiedOpportunityMetric('uclu_ganyan_main'),'side',multiCost('uclu_ganyan',3)),
    mk('cifte','Çifte',side?.cifte||{},'side'),
    mk('sirali_ikili','Sıralı İkili',side?.sirali_ikili||{},'side'),
    mk('sirali_uclu','Sıralı Üçlü',side?.sirali_uclu||{},'side'),
    mk('tabela','Tabela / Dörtlü',side?.tabela||{},'side'),
    mk('sirali5li','Sıralı 5’li',side?.sirali5li||{},'side')
  ];
  return rows;
}
function tkpOpportunityRouterHTML(raceResults,coupons=activeCoupons){
  const items=tkpOpportunityCatalog(raceResults,coupons),difficulty=tkpLiveMeetingDifficulty(raceResults);
  const ranked=items.slice().sort((a,b)=>tkpOpportunityCompare(a,b)||TKP_TR_COLLATOR.compare(String(a.label),String(b.label)));
  const hitBest=ranked.find(x=>x.key!=='altili'&&x.decision.label!=='PAS')||ranked.find(x=>x.key!=='altili')||null;
  const positiveBest=ranked.filter(x=>x.key!=='altili'&&Number(x.metric?.roi)>=0&&x.decision.label!=='PAS').sort(tkpOpportunityCompare)[0]||null;
  const altili=items.find(x=>x.key==='altili');
  let headline='En yüksek güvenilir isabet önde; benzer isabette daha ucuz oyun seçilir.';
  let detail='ROI ciddi zararı engelleyen filtredir; bütün bahisler ekranda kalır.';
  if(difficulty.hard&&hitBest){
    headline=`Altılı ${difficulty.veryHard?'çok zor':'zor'} · isabet/maliyet önceliği ${hitBest.label}.`;
    detail=Number(hitBest.metric?.total)>=TKP_MIN_PERCENT_SAMPLE
      ?`${hitBest.label}: tutma %${Math.round(hitBest.metric.rate*100)}, Wilson alt %${Math.round(hitBest.decision.lower*100)}, maliyet ${fmt2(hitBest.cost||hitBest.metric.avgCost)} TL.`
      :`${hitBest.label}: n=${Number(hitBest.metric?.total)||0}, maliyet ${fmt2(hitBest.cost||hitBest.metric.avgCost)} TL.`;
    if(positiveBest&&positiveBest.key!==hitBest.key)detail+=` Pozitif ROI dengesi için ${positiveBest.label} da öne çıkıyor.`;
  }else if(altili?.decision?.label==='OYNA'){
    headline='Altılı oynanabilir; yan bahisler isabet ve maliyete göre ayrıca sıralandı.';
  }else if(hitBest){
    headline=`Altılı temkinli · en yüksek isabet/düşük maliyet ${hitBest.label}.`;
    if(positiveBest&&positiveBest.key!==hitBest.key)detail=`İsabet önceliği ${hitBest.label}; pozitif ROI dengesi ${positiveBest.label}.`;
  }
  const priority=new Map(ranked.map((item,index)=>[item.key,index+1]));
  const rows=ranked.map(item=>{
    const m=item.metric,d=item.decision,enough=Number(m.total)>=TKP_MIN_PERCENT_SAMPLE;
    const rateCell=enough?`%${Math.round(m.rate*100)}`:`n=${Number(m.total)||0}/${TKP_MIN_PERCENT_SAMPLE}`;
    const wilsonCell=enough?`%${Math.round(d.lower*100)}`:'—';
    const roi=enough?(m.roi==null?'-':`${m.roi>=0?'+':''}%${fmt2(m.roi)}`):'—';
    return `<tr class="tkpOpportunityRow ${d.label==='OYNA'?'play':d.label==='PAS'?'pass':'caution'}"><td class="num"><b>#${priority.get(item.key)}</b></td><td><b>${esc(item.label)}</b></td><td>${tkpDecisionBadge(d.label)}</td><td class="num">${rateCell}</td><td class="num">${wilsonCell}</td><td class="num">${roi}</td><td class="num">${item.cost?fmt2(item.cost)+' TL':'-'}</td></tr>`;
  }).join('');
  const positiveText=positiveBest&&Number(positiveBest.metric?.total)>=TKP_MIN_PERCENT_SAMPLE?` Pozitif ROI lideri: ${positiveBest.label} (${positiveBest.metric.roi>=0?'+':''}%${fmt2(positiveBest.metric.roi)}).`:'';
  const holdPct=altili&&altili.metric&&altili.metric.total?Math.round(altili.metric.rate*100):null;
  return `<div class="card tkpOpportunityRouter"><div class="tkpRouterHeadline"><div><h2>🧭 İsabet / Maliyet Yönlendiricisi</h2><b>${esc(headline)}</b><p>${esc(detail)}</p></div><div class="tkpDifficultyGauge"><span>Altılı tutma ihtimali</span><b>${holdPct==null?'Veri yok':'%'+holdPct}</b></div></div><div class="tableWrap"><table><thead><tr><th class="num">Öncelik</th><th>Bahis</th><th>Karar</th><th class="num">Tutma</th><th class="num">Wilson alt</th><th class="num">ROI</th><th class="num">Maliyet / ort.</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">Tutma ihtimali geçmiş doğrulanmış 6/6 performansıdır; garanti değildir. Önce tutma oranı ve Wilson güveni, yakın seçeneklerde daha düşük maliyet değerlendirilir.${esc(positiveText)}</p></div>`;
}
function tkpRefreshOpportunityPanels(){
  try{
    const router=document.getElementById('tkpOpportunityRouterHost');
    const multi=document.getElementById('tkpMultiGanyanHost');
    if(router)router.innerHTML=tkpOpportunityRouterHTML(lastRaceResults,activeCoupons);
    if(multi)multi.innerHTML=tkpMultiGanyanCardsHTML(lastRaceResults,activeCoupons);
  }catch(error){console.warn('V50 isabet/maliyet yönlendiricisi yenilenemedi',error);}
}

function sideBetTicketCard(title, pools, combos, cost, status, metric, extraClass='', raceHorses=null, rankMap=null, unitLabel='yarış', profileNote=null, realPayoutHTML=''){
  const hasMetric=!!(metric&&metric.total);
  const rate=hasMetric?Math.round(metric.rate*100):null;
  const sample=hasMetric?`${Number(metric.ok)>0?metric.ok:'-'}/${metric.total} ${unitLabel}`:`- ${unitLabel}`;
  // V1.1.203 KÖK FIX: bu eşik yanlışlıkla SIDE_BET_MIN_RACES (=1) kullanıyordu; o sabit
  // kupon genişliği/öğrenme mantığı için bilerek düşük tutulan ayrı bir eşiktir. Yüzde
  // GÖSTERİMİ için asıl var olan (ama kullanılmayan) SIDE_BET_FULL_TRUST_RACES (=20)
  // V1.1.305: sert minimum örnek eşiği yok; kayıt varsa oran hesaplanır.
  // V1.1.305: sert minimum örnek kapısı yok; kayıt varsa yüzde gösterilir.
  const enoughSample=hasMetric&&metric.total>=SIDE_BET_FULL_TRUST_RACES;
  const rateDisplay=enoughSample&&rate!=null?'%'+rate:(hasMetric?`n=${metric.total}/${SIDE_BET_FULL_TRUST_RACES}`:'-');
  const stat=`<div class="sideBetMiniStat" title="Aynı profil geçmişindeki başarı oranı"><span class="sideBetMiniRate">${rateDisplay}</span><span class="sideBetMiniSample">${sample}</span></div>`;
  const lowSample=hasMetric&&!enoughSample;
  const sentence=metric&&metric.total
    ? `Bu şartlarda geçmişte <b>${metric.total}</b> ${unitLabel} oynandı, <b>${Number(metric.ok)>0?metric.ok:'-'}</b> tanesi tuttu — başarı oranı <span class="pct-hit">${enoughSample&&rate!=null?'%'+rate:'n='+metric.total+'/'+SIDE_BET_FULL_TRUST_RACES}</span>.`
    : 'Geçmiş örnek: -';
  const sampleLine=`<div class="sideBetSampleLine" style="color:#64748b;font-size:11px;margin:2px 0 6px;">${sentence}${lowSample?'':''}${profileNote?' · '+esc(profileNote):''}</div>`;
  const normalizedStatus=String(status||'');
  const missed=normalizedStatus.includes('TUTMADI');
  const hit=!missed&&(normalizedStatus.includes('TUTTU')||normalizedStatus.includes('SIRASIZ TUTTU'));
  let financeHTML=realPayoutHTML||'';
  if(missed){
    financeHTML+=`<div class="sideBetFinance miss"><b>Kaybedilen tutar:</b> ${fmt2(cost)} TL</div>`;
  }else if(hit&&!realPayoutHTML){
    financeHTML='<div class="sideBetFinance hit"><b>Kazanılan miktar:</b> İkramiye verisi bulunamadı</div>';
  }else if(!hit&&!missed){
    financeHTML+=`<div class="sideBetFinance waiting"><b>Kupon maliyeti:</b> ${fmt2(cost)} TL</div>`;
  }
  const collapseEkuri=String(extraClass||'').split(/\s+/).includes('doubleTicket');
  return `<div class="sideBetTicketCard ${extraClass}">
    <div class="sideBetTicketHead"><h4>${esc(title)}</h4>${stat}</div>
    ${sampleLine}
    ${tkpSideBetDecisionHTML(title,metric)}
    <div class="sideBetPools">${pools.map((pool,index)=>{
      const poolHorses=Array.isArray(raceHorses?.[0]) ? (raceHorses[index]||[]) : raceHorses;
      const poolRankMap=Array.isArray(rankMap)?rankMap[index]:rankMap;
      return sideBetPoolHTML(String(index+1)+'.',pool,poolHorses,poolRankMap,collapseEkuri);
    }).join('')}</div>
    <div class="sideBetTicketMeta"><span class="sideBetCost">${combos} kolon · ${fmt2(cost)} TL</span>${status}</div>
    ${financeHTML}
  </div>`;
}

function doubleAnalysisHTML(raceResults){
  const ordered=(raceResults||[]).slice().sort((a,b)=>Number(a.r.leg)-Number(b.r.leg));
  const cards=[];
  for(let i=0;i<ordered.length-1;i++){
    const a=ordered[i], b=ordered[i+1];
    if(Number(b.r.leg)!==Number(a.r.leg)+1) continue;
    const pa=doublePoolForRace(a), pb=doublePoolForRace(b);
    if(!pa.pool.length || !pb.pool.length) continue;
    const combos=pa.pool.length*pb.pool.length;
    const cost=combos*SIDE_BET_UNITS.cifte;
    const combined=Math.round((pa.coverage/100)*(pb.coverage/100)*100);
    const dstat=sideBetDoubleBacktestFast(a.r,b.r);
    const metric={rate:dstat.rate,total:dstat.total,ok:dstat.ok};
    const pools=[pa.pool,pb.pool];
    const title=`Çifte ${a.r.leg}-${b.r.leg}. Koşu`;
    // Her iki koşunun da gerçek birincisi belliyse (sonuç işlenmişse) TUTTU/TUTMADI rengi
    // ve gerçek TJK ikramiyesi gösterilir; sonuç yoksa nötr "aktif öneri" durumu kalır.
    const winnerA=(a.r.horses||[]).find(h=>Number(h.winner)===1||Number(h.finish_position)===1);
    const winnerB=(b.r.horses||[]).find(h=>Number(h.winner)===1||Number(h.finish_position)===1);
    let status='<span class="sideBetReady">İki ardışık koşunun birincisi</span>';
    let realPayoutHTML='';
    if(winnerA && winnerB){
      const won=pa.pool.some(no=>_v25SameHorseOrEkuri(no,winnerA.horse_no)) && pb.pool.some(no=>_v25SameHorseOrEkuri(no,winnerB.horse_no));
      status=won?`<span class="sideBetResult hit">TUTTU · Kazanan: ${esc(winnerA.horse_no)} / ${esc(winnerB.horse_no)}</span>`:`<span class="sideBetResult miss">TUTMADI · Kazanan: ${esc(winnerA.horse_no)} / ${esc(winnerB.horse_no)}</span>`;
      realPayoutHTML=sideBetRealPayoutHTML(a.r,['cifte'],won);
    }
    const dprofileNote=dstat.total?`Profil: ${dstat._profile.level}`:null;
    cards.push(sideBetTicketCard(title,pools,combos,cost,status,metric,'doubleTicket',[a.r.horses,b.r.horses],null,'çift',dprofileNote,realPayoutHTML)
      .replace('1.</span>',''+a.r.leg+'. Koşu</span>')
      .replace('2.</span>',''+b.r.leg+'. Koşu</span>'));
  }
  if(!cards.length) return '<div class="empty">Çifte için ardışık iki koşu bulunamadı.</div>';
  return `<div class="card"><h2 style="margin:0 0 5px;">🔗 Çifte analizi</h2><p class="muted" style="margin:0 0 10px;">Hedef, ardışık iki koşunun birincisini birlikte bulmaktır. Her koşunun at havuzu Tahmin ve Altılı analizindeki aynı kapsama/tek mantığından alınır. İki havuz çarpılarak kolon sayısı hesaplanır; birim fiyat 1,00 TL’dir.</p><div class="sideBetTicketGrid">${cards.join('')}</div></div>`;
}

let _tkpSideBetRefreshGeneration=0;
function refreshRenderedSideBetPanel(){
  try{
    if(!Array.isArray(lastRaceResults)||!lastRaceResults.length) return false;
    const root=document.getElementById('predictionResult');
    const pane=root&&root.querySelector('.predLegPane[data-predpane="stats"]');
    // İstatistik sekmesi daha önce açılıp gerçek yan bahis paneli oluşturulduysa,
    // kupon üretimi/değişikliği sonrası paneli ayrı bir arka plan görevinde yenile.
    // Burada senkron sideBetPanelHTML çağrısı yapılmaz; kupon kritik yolu tekrar
    // uzun tarihsel sıralama hesabına kapılmaz.
    if(!pane || !pane.querySelector('.sideBetPanel')) return false;
    const generation=++_tkpSideBetRefreshGeneration;
    const rows=lastRaceResults;
    const build=async()=>{
      if(generation!==_tkpSideBetRefreshGeneration||!pane.isConnected)return false;
      const html=typeof tkpGetSideBetPanelHTMLAsync==='function'
        ?await tkpGetSideBetPanelHTMLAsync(rows)
        :sideBetPanelHTML(rows);
      if(generation!==_tkpSideBetRefreshGeneration||!pane.isConnected)return false;
      pane.innerHTML=html;
      return true;
    };
    if(typeof tkpQueueTask==='function'){
      tkpQueueTask('sidebet-panel-refresh',build,{priority:'background',replace:true,minIdleMs:900});
    }else if(typeof setTimeout==='function'){
      setTimeout(()=>{build().catch(()=>{});},0);
    }else{
      Promise.resolve().then(build).catch(()=>{});
    }
    return true;
  }catch(_){ return false; }
}

function ensureSideBetCouponSources(raceResults){
  const rows=(raceResults||[]).filter(x=>x?.r);
  if(!rows.length) return false;
  const matchesCurrentMeeting=coupon=>{
    if(!coupon || coupon.error || !Array.isArray(coupon.legs) || !coupon.legs.length) return false;
    return coupon.legs.every(leg=>rows.some(x=>v25SameRaceForCouponSingle(leg.r,x.r)));
  };
  if(['main','alt','surprise'].every(k=>matchesCurrentMeeting(activeCoupons&&activeCoupons[k]))) return true;
  // Geçmiş/kilitli toplantıda yeni kupon hesaplamak hem yanlış hem pahalıdır.
  // Varsa yarış öncesi kayıtlı kuponu geri çağır; yoksa yan bahis istatistiği
  // kupon TEK kartı olmadan gösterilsin, bütün kupon motoru çalıştırılmasın.
  try{
    if(typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked(rows)){
      if(typeof tkpRestoreLatestPreRaceCouponSnapshot==='function') tkpRestoreLatestPreRaceCouponSnapshot(rows);
      return ['main','alt','surprise'].some(k=>matchesCurrentMeeting(activeCoupons&&activeCoupons[k]));
    }
  }catch(_e){}
  try{
    const budgets=typeof _v24ReadBudgets==='function' ? _v24ReadBudgets() : {main:1000,main2:1000,alt:0,surprise:1100};
    const fastSet=typeof tkpBuildCouponSetAdaptive==='function'
      ? tkpBuildCouponSetAdaptive(rows,{...budgets,mainMax:2400,surpriseMax:1200})
      : (typeof buildCouponSetFast==='function'
        ? buildCouponSetFast(rows,budgets)
        : {main:buildSolidCoupon(rows,budgets.main),main2:buildNormalTwoSingleCoupon(rows,budgets.main2??budgets.main),alt:{disabled:true,legs:[],cost:0},surprise:buildBombaCoupon(rows,budgets.surprise)});
    activeCoupons.main=fastSet.main;
    activeCoupons.main2=fastSet.main2;
    activeCoupons.alt=fastSet.alt;
    activeCoupons.surprise=fastSet.surprise;
    return ['main','alt','surprise'].some(k=>matchesCurrentMeeting(activeCoupons[k]));
  }catch(_){ return false; }
}

async function ensureSideBetCouponSourcesAsync(raceResults){
  const rows=(raceResults||[]).filter(x=>x?.r);
  if(!rows.length)return false;
  const matchesCurrentMeeting=coupon=>coupon&&!coupon.error&&Array.isArray(coupon.legs)&&coupon.legs.length&&coupon.legs.every(leg=>rows.some(x=>v25SameRaceForCouponSingle(leg.r,x.r)));
  if(['main','alt','surprise'].every(key=>matchesCurrentMeeting(activeCoupons&&activeCoupons[key])))return true;
  if(typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked(rows))return ensureSideBetCouponSources(rows);
  // R16.38 — İSTATİSTİK 20 sn tavanı: bu panel kupon motorunun ikinci sahibi değildir.
  // Üç kupon ayrı USER görevidir. Kupon henüz hazır değilse istatistik kartları
  // TEKLİ OYUN bölümü olmadan açılır; kupon geldiğinde refreshRenderedSideBetPanel()
  // aynı paneli ucuz biçimde yeniler. Böylece frozen snapshot/kupon hatası İSTATİSTİK
  // sekmesini 100+ saniyelik yeniden kupon hesabına sürükleyemez.
  if(typeof tkpYield==='function')await tkpYield();
  return false;
}

function sideBetRaceHeadingLabel(r,profile){
  // Kart başlığı mevcut yarışın durumunu anlatır; profilin geçmiş yarışlardan
  // öğrenmesi, yeni bir tahmini yanlış biçimde "Geçmiş tahmin sonuçları" yapmaz.
  const confirmed=typeof raceHasConfirmedResult==='function'
    ? raceHasConfirmedResult(r?.horses||[])
    : (r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  return confirmed ? (profile?.label||'Geçmiş tahmin sonuçları') : 'Yarış öncesi tahmin';
}

function tkpWithSideBetPanelNoScan(fn){
  const previous=globalThis.__tkpSideBetPanelNoScan===true;
  globalThis.__tkpSideBetPanelNoScan=true;
  try{return fn();}finally{globalThis.__tkpSideBetPanelNoScan=previous;}
}
async function tkpPrepareSideBetRaceAsync(x){
  const source=(x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h));
  const steps=[()=>sideBetStrategyPlan(x),()=>sideBetPositionRankingsForRace(x.r,source),
    ...['triple','quartet','quintet'].map(product=>()=>tkpSideBetProductRankings(x.r,source,product))];
  for(const step of steps){await tkpYield();tkpWithSideBetPanelNoScan(step);}
}
function sideBetPanelHTML(raceResults){
  // Senkron yedek yol yalnız mevcut kaynakları çizer. Kupon kaynağı hazırlığı
  // sideBetPanelHTMLAsync içindeki bütçeli arka plan adımının tek sahibidir.
  const labels={sirali:'Sıralı ikili',uclu:'Sıralı Üçlü',dortlu:'Dörtlü/Tabela'};
  const ordered=(raceResults||[]).slice().sort((a,b)=>Number(a.r.leg)-Number(b.r.leg));
  const blocks=ordered.map((x,i)=>{
    const st=sideBetPanelStatsFast(x.r);
    const next=(ordered[i+1] && Number(ordered[i+1].r.leg)===Number(x.r.leg)+1)?ordered[i+1]:null;
    const ticket=tkpWithSideBetPanelNoScan(()=>sideBetTicketForRace(x,st,next));
    return `<div class="card sideBetRaceCard"><div class="sideBetRaceHead"><h3>${x.r.leg}. Ayak — ${esc(sideBetRaceHeadingLabel(x.r,st._profile))}</h3><span>${st._profile.rows.length} geçmiş yarış</span></div><p class="muted sideBetLevel">Profil düzeyi: <b>${esc(st._profile.level)}</b></p>${ticket||''}</div>`;
  }).join('');
  return `<div class="card sideBetPanel"><div class="sideBetPanelHead"><div><h2>🎯 Yan bahis analizleri</h2><p>Çifte, Sıralı İkili, Sıralı Üçlü ve Dörtlü/Tabela ortak aday sırasını kullanır. TEKLİ OYUN yalnız ekranda seçilen Normal, Sürpriz ve Uzman + Kulis kuponlarının ürettiği TEK ayaklarda gösterilir; diğer ayaklarda Teksiz Alternatif korunur.</p></div></div>${blocks||'<div class="empty">Koşu bulunamadı.</div>'}</div>`;
}

async function sideBetPanelHTMLAsync(raceResults,options={}){
  globalThis.__tkpSideBetBuildDepth=(Number(globalThis.__tkpSideBetBuildDepth)||0)+1;
  try{return await tkpSideBetPanelBuildAsync(raceResults,options);}
  finally{globalThis.__tkpSideBetBuildDepth=Math.max(0,(Number(globalThis.__tkpSideBetBuildDepth)||0)-1);}
}
async function tkpSideBetPanelBuildAsync(raceResults,options={}){
  const timingStart=typeof performance!=='undefined'?performance.now():Date.now();
  const TKP_STATS_HARD_BUDGET_MS=17500;
  const deadline=timingStart+TKP_STATS_HARD_BUDGET_MS;
  const nowMs=()=>typeof performance!=='undefined'?performance.now():Date.now();
  const budgetLeft=()=>deadline-nowMs();
  const timing={couponSourcesMs:0,legs:[],totalMs:0,budgetMs:TKP_STATS_HARD_BUDGET_MS,truncated:false};
  const archivedReadOnly=Array.isArray(raceResults)
    && raceResults.some(x=>typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(x));
  if(archivedReadOnly){
    // Arşivde de V1.1.298'in tam yan bahis kartları gösterilir. Yalnız
    // yarış-öncesi snapshot/sıralama korunur; canlı ön-ısıtma veya yeniden
    // tahmin üretimi başlatılmaz. Async yol kartlar arasında yield eder.
    const html=await tkpArchivedSideBetPanelHTMLAsync(raceResults,options);
    timing.totalMs=Math.round(((typeof performance!=='undefined'?performance.now():Date.now())-timingStart)*10)/10;
    if(typeof globalThis!=='undefined')globalThis.__tkpLastSideBetTiming=timing;
    return html;
  }
  // R16.38: İstatistik renderi hiçbir koşulda soğuk FULL tarihsel model taraması
  // başlatamaz. Bayrak yalnız SENKRON sıralama/ticket çağrısının çevresinde tutulur;
  // await/yield boyunca global durumda kalmaz, dolayısıyla kupon motorunun hesabına
  // sızıp model davranışını değiştiremez.

  if(typeof tkpYield==='function') await tkpYield();
  if(typeof ensureSideBetCouponSourcesAsync==='function')await ensureSideBetCouponSourcesAsync(raceResults);
  else ensureSideBetCouponSources(raceResults);
  const firstRace=(raceResults||[]).find(x=>x?.r)?.r;
  const sideBetRows=(raceResults||[]).filter(x=>x?.r);
  const archivedOrLocked=typeof tkpCouponMeetingLocked==='function'
    ? tkpCouponMeetingLocked(sideBetRows)
    : sideBetRows.every(x=>raceHasConfirmedResult(x.r?.horses||[]));
  // P2/P3/P5 eğitimi yalnız canlı toplantıda ve kullanıcı boşta kaldığında yapılır.
  // Sonuçlanmış/arşiv toplantısını görüntülerken bunu tekrar başlatmak ekrana bir şey
  // kazandırmıyor, fakat eski Windows'ta panel hazırlandıktan sonra bile uzun CPU yükü
  // oluşturuyordu. Arşiv sıraları frozen/snapshot ve kalıcı öğrenme cache'lerinden okunur.
  if(firstRace&&!archivedOrLocked&&typeof globalThis.tkpPretrainOnlinePositionsAsync==='function'){
    if(typeof globalThis.tkpScheduleOnlinePositionsTraining==='function')globalThis.tkpScheduleOnlinePositionsTraining(firstRace,[2,3,5]);
  }
  timing.couponSourcesMs=Math.round(((typeof performance!=='undefined'?performance.now():Date.now())-timingStart)*10)/10;
  if(typeof tkpYield==='function') await tkpYield();
  const ordered=(raceResults||[]).slice().sort((a,b)=>Number(a.r.leg)-Number(b.r.leg));
  const blocks=[];
  for(let i=0;i<ordered.length;i++){
    if(options.signal?.aborted)throw new Error('İstatistik hesabı iptal edildi.');
    const legStart=typeof performance!=='undefined'?performance.now():Date.now();
    const x=ordered[i];
    const st=sideBetPanelStatsFast(x.r);
    const statsEnd=typeof performance!=='undefined'?performance.now():Date.now();
    // Plan ve konuma özel ürün sıralamalarını küçük görevler halinde önceden
    // doldur. sideBetTicketForRace aynı cache'leri okuyup yalnız HTML/kombinasyon
    // işini yapar; her ürün arasında tarayıcı giriş/çizim olaylarını işleyebilir.
    const prewarmBlocks=[];
    if(typeof tkpYield==='function') await tkpYield();
    let prewarmStarted=typeof performance!=='undefined'?performance.now():Date.now();
    if(typeof sideBetStrategyPlan==='function')tkpWithSideBetPanelNoScan(()=>sideBetStrategyPlan(x));
    prewarmBlocks.push({stage:'plan',ms:Math.round(((typeof performance!=='undefined'?performance.now():Date.now())-prewarmStarted)*10)/10});
    const source=(x.scored||x.r?.horses||[]).filter(h=>!isNonRunner(h));
    prewarmStarted=typeof performance!=='undefined'?performance.now():Date.now();
    if(typeof sideBetPositionRankingsForRace==='function')tkpWithSideBetPanelNoScan(()=>sideBetPositionRankingsForRace(x.r,source));
    prewarmBlocks.push({stage:'positions',ms:Math.round(((typeof performance!=='undefined'?performance.now():Date.now())-prewarmStarted)*10)/10});
    for(const product of ['triple','quartet','quintet']){
      if(options.signal?.aborted)throw new Error('İstatistik hesabı iptal edildi.');
      if(typeof tkpYield==='function') await tkpYield();
      prewarmStarted=typeof performance!=='undefined'?performance.now():Date.now();
      if(typeof tkpSideBetProductRankings==='function')tkpWithSideBetPanelNoScan(()=>tkpSideBetProductRankings(x.r,source,product));
      prewarmBlocks.push({stage:product,ms:Math.round(((typeof performance!=='undefined'?performance.now():Date.now())-prewarmStarted)*10)/10});
    }
    if(typeof tkpYield==='function') await tkpYield();
    const ticketStarted=typeof performance!=='undefined'?performance.now():Date.now();
    const next=(ordered[i+1] && Number(ordered[i+1].r.leg)===Number(x.r.leg)+1)?ordered[i+1]:null;
    const ticket=tkpWithSideBetPanelNoScan(()=>sideBetTicketForRace(x,st,next));
    const ticketEnd=typeof performance!=='undefined'?performance.now():Date.now();
    timing.legs.push({leg:Number(x.r.leg)||i+1,statsMs:Math.round((statsEnd-legStart)*10)/10,prewarmBlocks,maxPrewarmBlockMs:prewarmBlocks.length?Math.max(...prewarmBlocks.map(row=>row.ms)):0,ticketMs:Math.round((ticketEnd-ticketStarted)*10)/10});
    blocks.push(`<div class="card sideBetRaceCard"><div class="sideBetRaceHead"><h3>${x.r.leg}. Ayak — ${esc(sideBetRaceHeadingLabel(x.r,st._profile))}</h3><span>${st._profile.rows.length} geçmiş yarış</span></div><p class="muted sideBetLevel">Profil düzeyi: <b>${esc(st._profile.level)}</b></p>${ticket||''}</div>`);
    if(typeof options.onProgress==='function')options.onProgress('<div class="card sideBetPanel" data-progressive="1"><h2>Yan bahis analizleri · '+(i+1)+'/'+ordered.length+' ayak hazır</h2>'+blocks.join('')+'</div>',{done:i+1,total:ordered.length});
    // Her ayaktan sonra tarayıcı olay kuyruğuna dön; sayfa "yanıt vermiyor" durumuna düşmez.
    if(typeof tkpYield==='function') await tkpYield();
  }
  timing.totalMs=Math.round((nowMs()-timingStart)*10)/10;
  if(typeof globalThis!=='undefined')globalThis.__tkpLastSideBetTiming=timing;
  const budgetNote=timing.truncated?'<div class="card" style="border-left:5px solid #f59e0b;"><b>20 sn koruması:</b> gerekli kartlar gösterildi; kalan düşük öncelikli ayrıntılar arka plan cache hazır olduğunda tamamlanır.</div>':'';
  return `<div class="card sideBetPanel" data-build-ms="${timing.totalMs}" data-budget-ms="${TKP_STATS_HARD_BUDGET_MS}" data-truncated="${timing.truncated?1:0}" data-coupon-ms="${timing.couponSourcesMs}" data-leg-ms="${timing.legs.map(x=>`${x.leg}:${x.statsMs}:${x.ticketMs}`).join('|')}"><div class="sideBetPanelHead"><div><h2>🎯 Yan bahis analizleri</h2><p>Çifte, Sıralı İkili, Sıralı Üçlü ve Dörtlü/Tabela ortak aday sırasını kullanır. Öğrenme yalnız yarış öncesi kaydedilmiş ve gerçek sonuçla doğrulanmış tahminlerden güncellenir.</p></div></div>${budgetNote}${blocks.join('')||'<div class="empty">Koşu bulunamadı.</div>'}</div>`;
}

// Geçmiş toplantının İSTATİSTİK sekmesi salt-okunur/frozen kalır; ancak 298'deki
// tam yan bahis tabloları kaybolmaz. Kayıtlı yarış-öncesi sıra/snapshot kararın
// kaynağıdır, tüm doğrulanmış geçmiş ise oran/örneklem/istatistik satırlarını
// günceller. Böylece arşiv görünümü hem eski tablo sözleşmesini hem de yeni veri
// kümesini birlikte taşır.
function tkpArchivedSideBetPanelHTML(raceResults){
  // Senkron çağrı eski dış çağrıları bozmasın; normalde async render yolu
  // kullanılır ve arşivde UI'ye yarışlar arasında geri döner.
  try{return sideBetPanelHTML(raceResults);}catch(_e){
    return '<div class="card sideBetPanel" data-archive-full="1"><div class="empty">Yan bahis tablosu hazırlanamadı.</div></div>';
  }
}

async function tkpArchivedSideBetPanelHTMLAsync(raceResults,options={}){
  const ordered=(raceResults||[]).filter(x=>x?.r).slice().sort((a,b)=>Number(a.r.leg)-Number(b.r.leg));
  const onProgress=typeof options?.onProgress==='function'?options.onProgress:null;
  const shell=(body,status='')=>`<div class="card sideBetPanel" data-archive-full="1" data-progressive="1"><div class="sideBetPanelHead"><div><h2>🎯 Yan bahis analizleri</h2><p>Arşiv yarış-öncesi snapshot'ı korunur; kayıtlı sonuç ve istatistikler yeniden tahmin üretilmeden gösterilir.</p></div></div>${status?`<div class="card" style="border-left:5px solid #2563eb;">${status}</div>`:''}${body||'<div class="empty">Koşu bulunamadı.</div>'}</div>`;
  try{if(onProgress)onProgress(shell('',`Kayıtlı istatistik açıldı · 0/${ordered.length} ayak`),{done:0,total:ordered.length});}catch(_e){}
  try{ensureSideBetCouponSources(raceResults);}catch(_e){}
  const blocks=[];
  for(let i=0;i<ordered.length;i++){
    if(typeof tkpYield==='function')await tkpYield();
    const x=ordered[i],st=sideBetPanelStatsFast(x.r);
    try{if(onProgress)onProgress(shell(blocks.join(''),`${Number(x.r.leg)||i+1}. ayak kartları hazırlanıyor · ${i}/${ordered.length}`),{done:i,total:ordered.length,leg:Number(x.r.leg)||i+1,stage:'ticket'});}catch(_e){}
    if(typeof tkpYield==='function')await tkpYield();
    const next=(ordered[i+1]&&Number(ordered[i+1].r.leg)===Number(x.r.leg)+1)?ordered[i+1]:null;
    // sideBetTicketForRace aynı V1.1.298 tam kartlarını üretir. Arşiv işareti
    // yalnız skorun yeniden üretilmesini engeller; görünür tabloyu kısaltmaz.
    const ticket=sideBetTicketForRace(x,st,next,{archivedFull:true});
    blocks.push(`<div class="card sideBetRaceCard"><div class="sideBetRaceHead"><h3>${x.r.leg}. Ayak — ${esc(sideBetRaceHeadingLabel(x.r,st._profile))}</h3><span>${st._profile.rows.length} geçmiş yarış · Frozen</span></div><p class="muted sideBetLevel">Profil düzeyi: <b>${esc(st._profile.level)}</b></p>${ticket||''}</div>`);
    try{if(onProgress)onProgress(shell(blocks.join(''),`${i+1}/${ordered.length} ayak hazır`),{done:i+1,total:ordered.length,leg:Number(x.r.leg)||i+1,stage:'ready'});}catch(_e){}
    if(typeof tkpYield==='function')await tkpYield();
  }
  return `<div class="card sideBetPanel" data-archive-full="1"><div class="sideBetPanelHead"><div><h2>🎯 Yan bahis analizleri</h2><p>298 tablosu geri bağlandı. Arşiv yarış-öncesi snapshot'ı korunur; oran, örneklem ve sonuçlar yüklenen tüm doğrulanmış geçmiş veriden güncellenir.</p></div></div>${blocks.join('')||'<div class="empty">Koşu bulunamadı.</div>'}</div>`;
}

function kpiCard(label, value, cls){ return `<div class="card kpi ${cls||''}"><span>${esc(label)}</span><b style="white-space:nowrap;padding-right:12px">${esc(value)}</b></div>`; }

function suggestBudgetHTML(){
  let rows = (db.bets || []).filter(b => b.cost > 0);
  if (rows.length < 3) return '';
  let profitable = rows.filter(b => (b.payout||0) > b.cost);
  if (!profitable.length) return '';
  let avgProfitableCost = profitable.reduce((s,b)=>s+b.cost,0) / profitable.length;
  let bestRoi = profitable.slice().sort((a,b)=>((b.payout-b.cost)/b.cost)-((a.payout-a.cost)/a.cost))[0];
  return `<p style="font-size:12.5px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;margin:0;">📊 <b>Geçmiş verilerine göre öneri:</b> ${rows.length} kupon kaydından ${profitable.length} tanesi kârlı sonuçlanmış; bu kârlı kuponların ortalama maliyeti <b>${fmt2(avgProfitableCost)} TL</b>. En yüksek ROI'li kupon ${fmt2(bestRoi.cost)} TL maliyetle %${fmt2(100*(bestRoi.payout-bestRoi.cost)/bestRoi.cost)} getiri sağlamış. Bu bir garanti değil, sadece geçmiş eğilimdir.</p>`;
}

function couponTypeLabel(t){ return COUPON_TYPE_LABELS[t] || COUPON_TYPE_LABELS.other; }

function betGameTypeLabel(t){ return BET_GAME_TYPE_LABELS[t] || '-'; }

function betSessionLabel(s){ return s==='1' ? '1.' : (s==='2' ? '2.' : ''); }

function raceCityGroups(){
  const dedupKey = s => fold(s).replace(/I/g,'İ');
  const domestic = DEFAULT_RACE_CITIES.slice();
  const domesticKeys = new Set(domestic.map(dedupKey));
  const foreign = new Map();

  // Yabancı pistler hazır liste olarak gelmez. Kullanıcı o pist için kupon
  // kaydettiğinde sonraki açılışlarda Yurtdışı grubuna otomatik eklenir.
  for (const b of (db.bets||[])){
    let h = String(b.betCity||'').trim();
    if (!h || h==='—') continue;
    h = h.replace(/[\s_-]*\d+\s*$/,'').trim();
    if (!h) continue;
    const key = dedupKey(h);
    if (domesticKeys.has(key) || foreign.has(key)) continue;
    const title = h.toLocaleUpperCase('tr-TR')
      .split(/\s+/).map(w => w.charAt(0)+w.slice(1).toLocaleLowerCase('tr-TR')).join(' ');
    foreign.set(key,title);
  }
  return {
    domestic,
    foreign:[...foreign.values()].sort((a,b)=>TKP_TR_COLLATOR.compare(a,b))
  };
}

function raceCityOptions(){
  const g=raceCityGroups();
  return [...g.domestic,...g.foreign];
}
