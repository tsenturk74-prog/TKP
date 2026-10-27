/*
 * TKP — zaman sıralı kalibrasyon ve aylık kasa kapısı.
 *
 * Tarihsel arşiv araştırma/kalibrasyon içindir. "HISTORICAL_RESEARCH" sonucu
 * asla canlı politikayı AKTİF yapmaz. Üretime terfi yalnız gerçek yarış öncesi
 * zaman kilidi bulunan weekly_model_log kayıtlarıyla mümkün olabilir.
 */
(function(global){
  'use strict';

  const VERSION='R15.6-CALIBRATION-WALKFORWARD-CLEAN509-JOINT';
  const DEFAULT_BANKROLL=Object.freeze({monthlyTargetTL:50000,monthlyHardLimitTL:90000});
  const DEFAULT_FOLDS=Object.freeze({warmupMeetings:100,foldCount:5,minLiveEvents:150});
  const number=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
  const list=value=>Array.isArray(value)?value:[];
  const text=value=>String(value??'');
  const esc=value=>text(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const database=source=>source||(typeof db!=='undefined'?db:null);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function policy(){
    const source=global.TKP_COUPON_BUDGET_POLICY||{};
    return {
      monthlyTargetTL:number(source.monthlyTargetTL,DEFAULT_BANKROLL.monthlyTargetTL),
      monthlyHardLimitTL:number(source.monthlyHardLimitTL,DEFAULT_BANKROLL.monthlyHardLimitTL)
    };
  }
  function monthKey(date){
    const value=text(date).slice(0,7);
    return /^\d{4}-\d{2}$/.test(value)?value:'';
  }
  function nowMonth(){return new Date().toISOString().slice(0,7);}
  function tkpMonthlyBankrollStatus(date='',sourceDb=null){
    const source=database(sourceDb)||{};
    const p=policy(),month=monthKey(date)||nowMonth();
    const rows=list(source.bets).filter(row=>monthKey(row?.date)===month);
    const spent=rows.reduce((sum,row)=>sum+Math.max(0,number(row?.cost)),0);
    const payout=rows.reduce((sum,row)=>sum+Math.max(0,number(row?.payout)),0);
    const remaining=Math.max(0,p.monthlyHardLimitTL-spent);
    return {
      month,spent,payout,net:payout-spent,remaining,targetRemaining:Math.max(0,p.monthlyTargetTL-spent),
      monthlyTargetTL:p.monthlyTargetTL,monthlyHardLimitTL:p.monthlyHardLimitTL,
      pct:clamp(spent/Math.max(1,p.monthlyHardLimitTL),0,1),
      state:spent>=p.monthlyHardLimitTL?'LİMİT':spent>=p.monthlyTargetTL?'DİKKAT':'UYGUN',
      records:rows.length
    };
  }
  function tkpCanRecordBankrollBet(date,cost,sourceDb=null){
    const status=tkpMonthlyBankrollStatus(date,sourceDb),next=Math.max(0,number(cost));
    return {...status,requested:next,allowed:status.spent+next<=status.monthlyHardLimitTL+1e-9,after:status.spent+next};
  }
  function tkpMonthlyBankrollHTML(date='',sourceDb=null){
    const s=tkpMonthlyBankrollStatus(date,sourceDb);
    const color=s.state==='LİMİT'?'#b91c1c':s.state==='DİKKAT'?'#b45309':'#0f766e';
    const money=v=>`${(Math.round(number(v)*100)/100).toLocaleString('tr-TR')} TL`;
    return `<div class="card tkpBankrollCard" style="border-left:5px solid ${color};margin:8px 0"><b>📊 Aylık kasa · ${esc(s.month)}</b> · ${esc(s.state)}<br><span class="muted">Kayıtlı harcama: <b>${esc(money(s.spent))}</b> / sert limit <b>${esc(money(s.monthlyHardLimitTL))}</b> · kalan <b>${esc(money(s.remaining))}</b> · ${s.records} gerçek kayıt. Otomatik üretilen kuponlar gerçek harcama sayılmaz.</span></div>`;
  }

  function evidenceClass(record){
    const explicit=text(record?.evidence_class||record?.evidenceClass).toUpperCase();
    if(explicit==='LIVE_PRE_RACE_LOCKED')return 'LIVE_PRE_RACE_LOCKED';
    const starts=Date.parse(text(record?.race_start_at||record?.raceStartAt));
    const captured=Date.parse(text(record?.captured_at||record?.created_at||record?.coupon_locked_at));
    if(number(record?.time_lock_eligible)===1&&record?.pre_race_only!==false&&Number.isFinite(starts)&&Number.isFinite(captured)&&captured<starts)return 'LIVE_PRE_RACE_LOCKED';
    return 'HISTORICAL_RESEARCH';
  }
  function recordMeetingKey(record){
    return text(record?.meeting_uid||record?.meetingUid||record?.file_id||record?.fileId||[
      text(record?.date||record?.race_date).slice(0,10),text(record?.hip||record?.hippodrome),number(record?.alt||record?.altili_no,1)
    ].join('|'));
  }
  function sequenceFor(record,sourceDb){
    const source=database(sourceDb)||{};
    const direct=number(record?.sequence_no||record?.sequence);
    if(direct>0)return direct;
    const id=text(record?.file_id||record?.fileId||'');
    const file=id?list(source.files).find(x=>text(x?.id)===id):null;
    return number(file?.sequence_no);
  }
  function normalizeCandidateRecord(record,sourceDb){
    const cost=number(record?.financeCost??record?.cost);
    const payoutKnown=record?.payoutKnown===undefined?Number.isFinite(Number(record?.ret)):!!record?.payoutKnown;
    const ret=payoutKnown?number(record?.ret):0;
    return {
      key:recordMeetingKey(record),date:text(record?.date||record?.race_date).slice(0,10),sequence:sequenceFor(record,sourceDb),
      hit:!!record?.hit,cost,ret,payoutKnown,net:payoutKnown?ret-cost:null
    };
  }
  function meetingRows(records,sourceDb){
    const map=new Map();
    for(const record of list(records)){
      const row=normalizeCandidateRecord(record,sourceDb);if(!row.key)continue;
      // Altılı metriklerinde her toplantı için tek kayıt beklenir. Birden çok kayıt
      // gelirse resmî para bilgisi olanı tercih edip çift sayımı engelleriz.
      const previous=map.get(row.key);
      if(!previous||(!previous.payoutKnown&&row.payoutKnown))map.set(row.key,row);
    }
    return [...map.values()].sort((a,b)=>{
      if(a.sequence&&b.sequence&&a.sequence!==b.sequence)return a.sequence-b.sequence;
      return a.date.localeCompare(b.date)||a.key.localeCompare(b.key);
    });
  }
  function tkpWilsonLowerBound(hits,total,z=1.96){
    const n=number(total);if(n<=0)return 0;const p=clamp(number(hits)/n,0,1),z2=z*z;
    return Math.max(0,(p+z2/(2*n)-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/(1+z2/n));
  }
  function foldsForRows(rows,options={}){
    const warmup=Math.max(0,Math.min(rows.length,number(options.warmupMeetings,DEFAULT_FOLDS.warmupMeetings)));
    const count=Math.max(1,Math.min(8,Math.floor(number(options.foldCount,DEFAULT_FOLDS.foldCount))));
    const usable=Math.max(0,rows.length-warmup),base=Math.floor(usable/count),extra=usable%count;
    const out=[];let start=warmup;
    for(let index=0;index<count;index++){
      const size=base+(index<extra?1:0),slice=rows.slice(start,start+size);
      if(slice.length)out.push({index:index+1,trainMeetings:start,testMeetings:slice.length,rows:slice,from:slice[0]?.date||'',to:slice.at(-1)?.date||''});
      start+=size;
    }
    return {warmup,folds:out};
  }
  function roiLowerBound(rows){
    const official=rows.filter(row=>row.payoutKnown&&row.cost>0);
    if(official.length<1)return null; // V1.1.305: minimum 20 yarış kapısı kaldırıldı
    const values=official.map(row=>number(row.net)),mean=values.reduce((sum,v)=>sum+v,0)/values.length;
    const variance=values.length>1?values.reduce((sum,v)=>sum+(v-mean)*(v-mean),0)/(values.length-1):0;
    const cost=official.reduce((sum,row)=>sum+row.cost,0)/official.length;
    return cost>0?(mean-1.96*Math.sqrt(variance/official.length))/cost*100:null;
  }
  function metric(rows){
    const official=rows.filter(row=>row.payoutKnown),total=rows.length,hits=rows.filter(row=>row.hit).length;
    const cost=official.reduce((sum,row)=>sum+row.cost,0),ret=official.reduce((sum,row)=>sum+row.ret,0),net=ret-cost;
    return {meetings:total,hits,rate:total?hits/total:0,wilsonLower:tkpWilsonLowerBound(hits,total),
      officialMeetings:official.length,cost,ret,net,roi:cost?net/cost*100:null,roiLower:roiLowerBound(rows),
      avgCost:total?rows.reduce((sum,row)=>sum+row.cost,0)/total:0};
  }
  function tkpEvaluateCalibrationCandidate(candidate,options={}){
    const rows=meetingRows(candidate?.records,options.sourceDb),plan=foldsForRows(rows,options);
    const folds=plan.folds.map(fold=>({index:fold.index,trainMeetings:fold.trainMeetings,testMeetings:fold.testMeetings,from:fold.from,to:fold.to,...metric(fold.rows)}));
    const all=metric(rows),positiveRoiFolds=folds.filter(row=>row.roi!=null&&row.roi>0).length;
    const source=text(candidate?.source||'HISTORICAL_RESEARCH');
    return {
      id:text(candidate?.id||candidate?.mode||'POLICY'),label:text(candidate?.label||candidate?.id||'Politika'),mode:text(candidate?.mode||''),budget:number(candidate?.budget),
      evidenceClass:source==='LIVE_PRE_RACE_LOCKED'?'LIVE_PRE_RACE_LOCKED':'HISTORICAL_RESEARCH',
      warmupMeetings:plan.warmup,folds,positiveRoiFolds,foldCount:folds.length,
      ...all,
      researchPass:folds.length>=4&&positiveRoiFolds>=4&&all.roiLower!=null&&all.roiLower>0,
      // Araştırma hiçbir zaman otomatik terfi olamaz; bu alanı UI ve gelecekteki
      // live scheduler aynı şekilde okur.
      promotionState:source==='LIVE_PRE_RACE_LOCKED'?'SHADOW':'ARAŞTIRMA'
    };
  }
  function comparePolicies(a,b){
    const aLower=Number.isFinite(a.roiLower)?a.roiLower:-Infinity,bLower=Number.isFinite(b.roiLower)?b.roiLower:-Infinity;
    if(aLower!==bLower)return bLower-aLower;
    const aRoi=Number.isFinite(a.roi)?a.roi:-Infinity,bRoi=Number.isFinite(b.roi)?b.roi:-Infinity;
    if(aRoi!==bRoi)return bRoi-aRoi;
    return a.avgCost-b.avgCost;
  }
  function tkpBuildCalibrationReport(candidates,options={}){
    const sourceDb=database(options.sourceDb),source=text(options.source||'HISTORICAL_RESEARCH');
    const evaluated=list(candidates).map(candidate=>tkpEvaluateCalibrationCandidate({...candidate,source}, {...options,sourceDb}));
    const ordered=evaluated.slice().sort(comparePolicies),best=ordered[0]||null;
    const live=source==='LIVE_PRE_RACE_LOCKED';
    return {
      version:VERSION,createdAt:new Date().toISOString(),source,
      chronology:'sequence_no: 1=en eski, N=en yeni; aynı gün hedef toplantı eğitim dışı',
      policy:'En düşük maliyet + en yüksek ROI, ancak ROI alt güven sınırı / fold kapısı ile',
      candidates:evaluated,selectedResearchPolicy:best?{id:best.id,label:best.label,budget:best.budget,roiLower:best.roiLower,avgCost:best.avgCost}:null,
      livePromotionAllowed:live&&!!best&&best.researchPass&&best.meetings>=DEFAULT_FOLDS.minLiveEvents,
      promotionState:live?(best?.researchPass&&best.meetings>=DEFAULT_FOLDS.minLiveEvents?'İNCELEME':'SHADOW'):'ARAŞTIRMA',
      warning:live?'Canlı zaman-kilitli örnekler ayrı değerlendirilir; otomatik terfi kapalıdır.':'Tarihsel sonuçlar yalnız araştırmadır; canlı algoritmayı otomatik değiştiremez.'
    };
  }
  // Güncel Replay havuzunda doğrulanmış kayıt yoksa Kalibrasyon ekranı 0/0
  // göstermemelidir. REAL509/V46 içindeki toplantılar yarış-öncesi snapshotlardan
  // oluşur; bu nedenle sadece araştırma satırı olarak yürütülebilir. Payout
  // ayrıntısı olmadığından ROI uydurulmaz, yalnız 6/6 / Wilson / maliyet ölçülür.
  function tkpReal509FrozenCandidateRecords(kind){
    const columns={main:3,alt:4,surprise:5};
    const column=columns[String(kind||'')];
    const archive=global.TKP_REAL509_ARCHIVE||{};
    if(!Number.isInteger(column)||!Array.isArray(archive.meetings))return [];
    return archive.meetings.map((meeting,index)=>{
      const row=list(meeting),pick=list(row[column]),date=text(row[1]).slice(0,10),hip=text(row[2]);
      if(!date||pick.length<2)return null;
      return {
        meeting_uid:`REAL509|${date}|${hip}|${index+1}`,
        date,sequence_no:index+1,
        hit:number(pick[0])>0,cost:Math.max(0,number(pick[1])),
        payoutKnown:false,source:'REAL509_V46_PRE_RACE_FROZEN'
      };
    }).filter(Boolean);
  }
  function tkpResearchCalibrationFromFastResult(result,budgets={},sourceDb=null){
    const out=result?.out||{};
    const recordsFor=(kind,records)=>{
      const current=list(records);
      if(current.length)return {records:current,archiveFallback:false};
      return {records:tkpReal509FrozenCandidateRecords(kind),archiveFallback:true};
    };
    const normal=recordsFor('main',out.main?.records);
    const surprise=recordsFor('alt',out.alt?.records);
    const expert=recordsFor('surprise',out.surprise?.records);
    const archiveFallback=normal.archiveFallback||surprise.archiveFallback||expert.archiveFallback;
    const candidates=[
      {id:'normal-current',label:normal.archiveFallback?'Normal · KALICI V46':'Normal',mode:'normal',budget:number(budgets.main,1200),records:normal.records},
      {id:'surprise-current',label:surprise.archiveFallback?'Sürpriz · KALICI V46':'Sürpriz',mode:'surprise',budget:number(budgets.alt??budgets.surprise,1000),records:surprise.records},
      {id:'expert-current',label:expert.archiveFallback?'Uzman + Kulis · KALICI V46':'Uzman + Kulis',mode:'expert',budget:number(budgets.surprise,1000),records:expert.records}
    ];
    const report=tkpBuildCalibrationReport(candidates,{source:'HISTORICAL_RESEARCH',sourceDb});
    const archive=global.TKP_REAL509_ARCHIVE?.dataset||{};
    report.researchSample={
      source:archiveFallback?'KALICI_REAL509_V46':'GUNCEL_REPLAY',
      archiveMeetings:number(archive.archive_meetings),
      verifiedSixLegMeetings:Math.max(0,...candidates.map(row=>list(row.records).length))
    };
    global.__tkpLastCalibrationReport=report;return report;
  }
  function tkpPersistCalibrationReport(report,sourceDb=null){
    const source=database(sourceDb);if(!source||!report)return false;
    source.learning_state=source.learning_state&&typeof source.learning_state==='object'?source.learning_state:{};
    const prior=source.learning_state.calibration&&typeof source.learning_state.calibration==='object'?source.learning_state.calibration:{};
    const key=report.source==='LIVE_PRE_RACE_LOCKED'?'live':'research';
    source.learning_state.calibration={...prior,version:VERSION,[key]:report,lastUpdatedAt:new Date().toISOString(),activePolicies:prior.activePolicies||{}};
    const clean=global.TKP_R156_CLEAN509_CALIBRATION;
    if(clean)source.learning_state.r15_6_clean509_joint_calibration={version:clean.VERSION,dataset:clean.DATASET,policy:clean.POLICY,mainHoldout:clean.MAIN_HOLDOUT,lastUpdatedAt:new Date().toISOString()};
    // Historical selection MAY be shown as a challenger but never copied into
    // activePolicies. The weekly live gate owns promotion.
    return true;
  }
  function tkpLiveCalibrationReadiness(sourceDb=null){
    const source=database(sourceDb)||{};
    const rows=list(source.weekly_model_log).filter(row=>evidenceClass(row)==='LIVE_PRE_RACE_LOCKED'&&row?.evaluation);
    const side={};
    for(const row of rows) for(const [product,value] of Object.entries(row?.evaluation?.sidebets||{})){
      const item=side[product]||(side[product]={events:0,hits:0});item.events+=number(value?.known);item.hits+=number(value?.hit);
    }
    for(const item of Object.values(side)){
      item.rate=item.events?item.hits/item.events:0;item.wilsonLower=tkpWilsonLowerBound(item.hits,item.events);
      // Exact ticket snapshots are not yet complete in old logs: pass is the
      // safe default even if there are enough events.
      item.state=item.events>=DEFAULT_FOLDS.minLiveEvents?'SHADOW / exact bilet doğrulaması bekliyor':'İZLEME';
    }
    return {version:VERSION,liveLockedRaces:rows.length,minimumPerProduct:DEFAULT_FOLDS.minLiveEvents,sidebets:side,promotionState:'SHADOW'};
  }
  function tkpR156Clean509CalibrationHTML(){
    const cal=global.TKP_R156_CLEAN509_CALIBRATION;if(!cal)return '';
    const d=cal.DATASET||{},m=cal.MAIN_HOLDOUT||{},p=cal.POLICY||{};
    const products=global.TKP_V321_SIDEBET_CALIBRATION?.PRODUCTS||{};
    const generic=cal.GENERIC_SIDEBET_CROSSCHECK||{};
    const productKeys=['sirali','triple','quartet','quintet','cifte'];
    const rows=productKeys.map(key=>{
      const prod=products[key],cross=generic[key];if(!prod)return '';
      const cleanRoi=cross?.holdout?.roiPct;
      const cleanText=Number.isFinite(Number(cleanRoi))?`%${Number(cleanRoi).toFixed(2)}`:'—';
      return `<tr><td><b>${esc(prod.label)}</b></td><td class="num">${esc(prod.holdout?.tests||0)}</td><td class="num">%${esc(Number(prod.holdout?.hitPct||0).toFixed(2))}</td><td class="num">%${esc(Number(prod.holdout?.roiPct||0).toFixed(2))}</td><td class="num">${esc(cleanText)}</td><td>${esc(prod.mode==='SHADOW_CANDIDATE'?'SHADOW ADAY':'PAS')}</td></tr>`;
    }).join('');
    return `<div class="card tkpClean509CalibrationCard" style="border-left:5px solid #0f766e;margin:10px 0"><h3 style="margin:0 0 5px">🧪 R15.6 CLEAN509 Ortak Kalibrasyon</h3><p class="muted" style="margin:0 0 7px"><b>${esc(d.verifiedRaces||0)}</b> doğrulanmış yarış · ${esc(d.fitRaces||0)} fit + <b>${esc(d.holdoutRaces||0)}</b> dokunulmamış holdout. P1 challenger holdout %${esc(Number(m.learned?.p1Pct||0).toFixed(2))}; AGF %${esc(Number(m.agf?.p1Pct||0).toFixed(2))}. Bu nedenle <b>Champion P1 kilidi korunur</b>; CLEAN509 yalnız P2–P5/kapsama için %${esc(Math.round(Number(p.finalTailBlend||0)*100))} düşük-etkili prior ve yan bahis düşük-örneklem düzenleyicisi olarak kullanılır.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Yan bahis</th><th class="num">V46 holdout</th><th class="num">İsabet</th><th class="num">V46 ROI</th><th class="num">Generic CLEAN509 ROI</th><th>Karar</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted" style="margin:7px 0 0">Generic CLEAN509 yan-bahis refiti ürün-bazlı V46 formüllerini holdout ROI'de geçmedi. Bu yüzden V46 formülleri korunur; geçmiş sonuç yalnız regularizer/kanıt kapısıdır ve hiçbir yan bahsi otomatik OYNA yapmaz.</p></div>`;
  }
  function tkpCalibrationReportHTML(report){
    if(!report)return '';
    const numberText=value=>Number.isFinite(Number(value))?`%${(Number(value)).toFixed(2)}`:'—';
    const sample=report.researchSample||{};
    const sampleNote=sample.source==='KALICI_REAL509_V46'
      ?` ${number(sample.archiveMeetings)} arşiv toplantısından yarış-öncesi snapshotlı ${number(sample.verifiedSixLegMeetings)} tam Altılı araştırmaya alındı; bu veri canlı terfiye yazılmaz.`:'';
    const rows=list(report.candidates).map(row=>`<tr><td><b>${esc(row.label)}</b></td><td class="num">${esc(row.meetings)}</td><td class="num">${esc(row.hits)}</td><td class="num">%${esc((row.rate*100).toFixed(2))}</td><td class="num">${esc(numberText(row.wilsonLower*100))}</td><td class="num">${esc(row.avgCost.toFixed(2))} TL</td><td class="num">${esc(numberText(row.roi))}</td><td class="num">${esc(numberText(row.roiLower))}</td><td>${esc(row.promotionState)}</td></tr>`).join('');
    const base=`<div class="card tkpCalibrationCard" style="border-left:5px solid #7c3aed;margin:10px 0"><h3 style="margin:0 0 5px">🧭 Zaman Sıralı Kalibrasyon · ${esc(report.promotionState)}</h3><p class="muted" style="margin:0 0 7px">${esc(report.warning)}${esc(sampleNote)} 5 fold / ilk 100 toplantı ısınma; karar ROI tek başına değil ROI alt güven sınırı ve maliyetle verilir.</p><div class="tableWrap compactBacktest"><table><thead><tr><th>Politika</th><th class="num">Test</th><th class="num">6/6</th><th class="num">Oran</th><th class="num">Wilson alt</th><th class="num">Ort. maliyet</th><th class="num">ROI</th><th class="num">ROI alt</th><th>Durum</th></tr></thead><tbody>${rows||'<tr><td colspan="9">Kalibrasyon verisi yok.</td></tr>'}</tbody></table></div></div>`;
    return base+tkpR156Clean509CalibrationHTML();
  }

  global.TKP_CALIBRATION_ENGINE_VERSION=VERSION;
  global.tkpMonthlyBankrollStatus=tkpMonthlyBankrollStatus;
  global.tkpCanRecordBankrollBet=tkpCanRecordBankrollBet;
  global.tkpMonthlyBankrollHTML=tkpMonthlyBankrollHTML;
  global.tkpCalibrationEvidenceClass=evidenceClass;
  global.tkpWilsonLowerBound=tkpWilsonLowerBound;
  global.tkpEvaluateCalibrationCandidate=tkpEvaluateCalibrationCandidate;
  global.tkpBuildCalibrationReport=tkpBuildCalibrationReport;
  global.tkpResearchCalibrationFromFastResult=tkpResearchCalibrationFromFastResult;
  global.tkpPersistCalibrationReport=tkpPersistCalibrationReport;
  global.tkpLiveCalibrationReadiness=tkpLiveCalibrationReadiness;
  global.tkpR156Clean509CalibrationHTML=tkpR156Clean509CalibrationHTML;
  global.tkpCalibrationReportHTML=tkpCalibrationReportHTML;
})(globalThis);
