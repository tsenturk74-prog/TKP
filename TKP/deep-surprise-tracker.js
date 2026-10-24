'use strict';
/* TKP R19.47.26 — Deep Surprise forward evidence tracker. UI üretmez; tek kanonik log. */
(function(global){
  const VERSION='R19.47.31-AUDIT1-DEEP-SURPRISE-SHADOW';
  const KEY='deep_surprise_tracking_log';
  const no=h=>String(h?.horse_no??'').trim();
  const up=v=>String(v??'').trim().toLocaleUpperCase('tr-TR').replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C').replace(/[^A-Z0-9]+/g,'');
  const dbx=()=>{try{return global.db||db||null;}catch(_){return null;}};
  const raceKey=r=>[String(r?.race_date||'').slice(0,10),up(r?.hippodrome),Number(r?.altili_no)||1,Number(r?.leg)||Number(r?.sequence_no)||0].join('|');
  const meetingKey=r=>[String(r?.race_date||'').slice(0,10),up(r?.hippodrome),Number(r?.altili_no)||1].join('|');
  let _idxRows=null,_idxLen=-1,_byRace=new Map(),_meetingGroups=new Map(),_rev=0,_summaryCache={rev:-1,value:null};
  function log(){const d=dbx();if(!d)return[];if(!Array.isArray(d[KEY]))d[KEY]=[];return d[KEY];}
  function ensureIndex(){const rows=log();if(rows!==_idxRows||rows.length!==_idxLen){_idxRows=rows;_idxLen=rows.length;_byRace=new Map();_meetingGroups=new Map();for(const rec of rows){if(rec?.race_key)_byRace.set(rec.race_key,rec);if(rec?.meeting_key){const a=_meetingGroups.get(rec.meeting_key)||[];a.push(rec);_meetingGroups.set(rec.meeting_key,a);}}_rev++;_summaryCache={rev:-1,value:null};}return rows;}
  function touch(){_rev++;_summaryCache={rev:-1,value:null};}
  function byRace(key){ensureIndex();return _byRace.get(key)||null;}
  function resultKnown(r){return (r?.horses||[]).some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);}
  function startAt(r){const d=String(r?.race_date||'').slice(0,10),m=String(r?.tjk_race_time||r?.race_time||'').match(/(\d{1,2})[:.](\d{2})/);if(!d||!m)return'';return `${d}T${String(Number(m[1])).padStart(2,'0')}:${m[2]}:00+03:00`;}
  function preRace(r){const s=startAt(r),t=Date.parse(s);return !!s&&Number.isFinite(t)&&Date.now()<t&&!resultKnown(r);}
  function winnerNos(r){return (r?.horses||[]).filter(h=>Number(h?.winner)===1||Number(h?.finish_position)===1).map(no).filter(Boolean);}
  function candidateRows(r,base){
    let ds=[];try{ds=global.tkpDeepSurpriseOutsideTop5?.(r,base,3)||[];}catch(_){ds=[];}
    return ds.map((h,i)=>({rank:i+1,horse_no:no(h),horse_name:String(h?.horse_name||''),deep_surprise_p:Number(global.tkpDeepSurprisePForHorse?.(r,h))||0,catboost_p:Number(global.tkpR17CatBoostPWinForHorse?.(r,h))||0,champion_rank:Math.max(1,base.indexOf(h)+1)}));
  }
  function captureRace(x){
    const r=x?.r||x;if(!r||!preRace(r))return false;const rows=ensureIndex(),key=raceKey(r);if(_byRace.has(key))return false;
    let base=[];try{base=global.bestPredictionRowsForLeg?.(x)||[];}catch(_){base=(x?.scored||r?.horses||[]).slice();}
    if(!base.length)return false;const top5=base.slice(0,5).map(no).filter(Boolean),cands=candidateRows(r,base);
    // Sidecar scoring is asynchronous. Do not freeze an empty candidate list
    // before its payload arrives; a later pre-race pass must be able to capture.
    if(!cands.length)return false;
    const rec={schema:'TKP_DEEP_SURPRISE_TRACK_V1',version:VERSION,race_key:key,meeting_key:meetingKey(r),race_date:String(r?.race_date||'').slice(0,10),hippodrome:String(r?.hippodrome||''),altili_no:Number(r?.altili_no)||1,leg:Number(r?.leg)||0,race_start_at:startAt(r),captured_at:new Date().toISOString(),production_top5:top5,candidates:cands,coupon_picks:{},coupon_costs:{},evaluation:null};rows.push(rec);_byRace.set(key,rec);const mg=_meetingGroups.get(rec.meeting_key)||[];mg.push(rec);_meetingGroups.set(rec.meeting_key,mg);_idxLen=rows.length;touch();
    return true;
  }
  function attachCouponSnapshot(snapshot){
    if(!snapshot||snapshot.pre_race_only!==1||snapshot.snapshot_time_verified!==1||snapshot.backtest_eligible!==1||snapshot.manual_adjustment===1||snapshot.post_collection_reconstruction===1)return false;
    const locked=Date.parse(snapshot.snapshot_locked_at||snapshot.created_at),start=Date.parse(snapshot.meeting_start_at);
    if(!Number.isFinite(locked)||!Number.isFinite(start)||locked>=start)return false;
    let changed=false;ensureIndex();const formats={main:'normal',alt:'surprise',surprise:'expert'};
    for(const [type,c] of Object.entries(snapshot?.coupons||{})){
      const fmt=formats[type];if(!fmt)continue;
      for(const leg of c?.legs||[]){
        const key=[String(snapshot.race_date||'').slice(0,10),up(snapshot.hippodrome),Number(snapshot.altili_no)||1,Number(leg?.leg)||0].join('|'),rec=_byRace.get(key);
        if(!rec||rec.evaluation)continue;
        const picks=(leg?.picks||[]).map(x=>typeof x==='object'?no(x):String(x)).filter(Boolean);if(!picks.length)continue;
        if(rec.coupon_locked_at?.[fmt]){
          if(JSON.stringify(rec.coupon_picks[fmt])!==JSON.stringify(picks)||rec.coupon_snapshot_ids?.[fmt]!==String(snapshot.id||''))continue;
        }else{
          rec.coupon_picks[fmt]=picks;rec.coupon_costs[fmt]=Number(c?.cost)||0;
          rec.coupon_locked_at=rec.coupon_locked_at||{};rec.coupon_locked_at[fmt]=snapshot.snapshot_locked_at||snapshot.created_at;
          rec.coupon_snapshot_ids=rec.coupon_snapshot_ids||{};rec.coupon_snapshot_ids[fmt]=String(snapshot.id||'');changed=true;
        }
        const shadow=c.deepSurpriseShadow,sl=shadow?.legs?.find(l=>Number(l.leg)===Number(leg.leg));
        const shadowAt=Date.parse(shadow?.captured_at||'');
        if(!rec.budgeted_shadow?.[fmt]&&shadow?.mode==='SHADOW_ONLY'&&shadow.eligible===true&&shadow.legs?.length===6&&sl&&shadowAt>=locked&&shadowAt<start&&shadowAt<=Date.now()&&shadow.cost===Number(c.cost)&&shadow.cost<=2000&&JSON.stringify(sl.baseline_picks)===JSON.stringify(picks)){
          rec.budgeted_shadow=rec.budgeted_shadow||{};
          rec.budgeted_shadow[fmt]={version:shadow.version,snapshot_id:snapshot.id||'',captured_at:shadow.captured_at,baseline_picks:picks.slice(),picks:sl.picks.slice(),cost:shadow.cost,baseline_cost:shadow.baseline_cost,candidates:sl.candidates,actions:sl.actions};
          changed=true;
        }
      }
    }
    if(changed)touch();return changed;
  }
  function reconcileAfterScores(races,options={}){
    // Async sidecar arrival may follow the first coupon save. Compare against
    // that immutable ticket only when the exact original decision inputs still
    // match; the shadow receives its own later, still pre-start timestamp.
    const d=dbx();let live=[];
    try{live=global.lastRaceResults||(typeof lastRaceResults!=='undefined'?lastRaceResults:[])||[];}catch(_){}
    if(!d||!live.length||!Array.isArray(races)||typeof global.tkpLiveCouponFingerprint!=='function')return false;
    const keys=new Set(races.map(raceKey)),available=live.filter(x=>keys.has(raceKey(x.r)));
    if(available.length!==live.length)return false;
    const signature=options.decisionSignature||global.tkpLiveCouponFingerprint(live),now=new Date().toISOString();let changed=false;
    for(const snapshot of d.auto_coupon_log||[]){
      // KULLANICI (zaman kavramı olmasın): "meeting başladı" (meeting_start_at<=now) dışlaması
      // kaldırıldı; geç girilen yarış-öncesi veri de gölge/backtest'e girer. Doğrulama artık
      // snapshot bayraklarıyla (pre_race_only/snapshot_time_verified = sonuç gelmeden girildi).
      if(snapshot.pre_race_only!==1||snapshot.snapshot_time_verified!==1||snapshot.backtest_eligible!==1||snapshot.data_signature!==signature)continue;
      const staged=JSON.parse(JSON.stringify(snapshot));let valid=false;
      for(const [format,c] of Object.entries(staged.coupons||{})){
        if(!['main','alt','surprise'].includes(format)||!c.deepSurpriseShadow||c.legs?.length!==6)continue;
        const legs=[];
        for(const saved of c.legs){
          const x=available.find(x=>raceKey(x.r)===[String(snapshot.race_date||'').slice(0,10),up(snapshot.hippodrome),Number(snapshot.altili_no)||1,Number(saved.leg)].join('|'));
          if(!x||!saved.deepSurpriseProtection||!preRace(x.r))break;
          const horses=x.scored||x.r.horses||[],byNo=new Map(horses.map(h=>[no(h),h]));
          const picks=saved.picks.map(n=>byNo.get(String(n))),order=(saved.selectionOrderNos||[]).map(n=>byNo.get(String(n)));
          if(!order.length||picks.some(h=>!h)||order.some(h=>!h))break;
          legs.push({r:x.r,picks,displayOrder:order,ordered:order,allHorses:horses,protectedSignalNos:saved.deepSurpriseProtection.nos,protectedFlag:saved.deepSurpriseProtection.flag});
          changed=captureRace({r:x.r,scored:order})||changed;
        }
        if(legs.length!==6)continue;
        c.deepSurpriseShadow=global.tkpBuildDeepSurpriseShadowCoupon?.({unit:c.unit,legs},{capturedAt:now});valid=true;
      }
      if(valid)changed=attachCouponSnapshot(staged)||changed;
    }
    if(changed){
      try{global.tkpInvalidateBackupCache?.();}catch(_){}
      try{const p=global.tkpPersistCollections?.(['deep_surprise_tracking_log'],{label:'deep-surprise-late-scores'});if(p?.catch)p.catch(e=>global.console?.warn?.('Deep Surprise takip kaydı yazılamadı',e));}catch(e){global.console?.warn?.('Deep Surprise takip kaydı yazılamadı',e);}
    }
    return changed;
  }
  function evaluateRace(r){
    if(!r||!resultKnown(r))return false;const rec=byRace(raceKey(r));if(!rec||rec.evaluation)return false;const wins=winnerNos(r),group=n=>String(n).match(/-(E\d+)$/i)?.[1]?.toUpperCase()||'N:'+n,hit=set=>set.some(a=>wins.some(w=>group(a)===group(w))),cand=rec.candidates||[];
    const base=hit(rec.production_top5||[]),ev={evaluated_at:new Date().toISOString(),winner_nos:wins,base_top5_hit:base?1:0,deep_winner_rank:null,plus1_hit:base?1:0,plus2_hit:base?1:0,plus3_hit:base?1:0,coupon:{}};
    for(const c of cand){if(hit([c.horse_no])&&ev.deep_winner_rank==null)ev.deep_winner_rank=c.rank;}
    for(const n of [1,2,3])ev['plus'+n+'_hit']=hit((rec.production_top5||[]).concat(cand.slice(0,n).map(c=>c.horse_no)))?1:0;
    for(const fmt of ['normal','surprise','expert']){const picks=rec.coupon_picks?.[fmt]||[],actual=hit(picks),extra=cand[0]?.horse_no,plus1=actual||(extra&&!picks.includes(extra)&&hit([extra]));ev.coupon[fmt]={actual_hit:actual?1:0,plus1_hit:plus1?1:0,extra_horse_no:extra||'',extra_would_add:extra&&!picks.includes(extra)?1:0};}
    ev.budgeted_shadow={};
    for(const [fmt,s] of Object.entries(rec.budgeted_shadow||{}))ev.budgeted_shadow[fmt]={baseline_hit:hit(s.baseline_picks)?1:0,shadow_hit:hit(s.picks)?1:0,cost:s.cost,baseline_cost:s.baseline_cost,version:s.version,snapshot_id:s.snapshot_id};
    rec.evaluation=ev;touch();return true;
  }
  function meetingImpact(){
    ensureIndex();const out=[];
    for(const [meeting,allRows] of _meetingGroups){const rows=allRows.filter(r=>r.evaluation);if(!rows.length)continue;const byLeg=new Map(rows.map(r=>[Number(r.leg),r]));if(![1,2,3,4,5,6].every(n=>byLeg.has(n)))continue;const six=[1,2,3,4,5,6].map(n=>byLeg.get(n));const item={meeting_key:meeting,baseline_top5_6of6:six.every(r=>r.evaluation.base_top5_hit)?1:0,plus1_6of6:six.every(r=>r.evaluation.plus1_hit)?1:0,plus2_6of6:six.every(r=>r.evaluation.plus2_hit)?1:0,plus3_6of6:six.every(r=>r.evaluation.plus3_hit)?1:0,formats:{}};
      for(const fmt of ['normal','surprise','expert']){const actualHits=six.reduce((n,r)=>n+Number(r.evaluation.coupon?.[fmt]?.actual_hit||0),0),plusHits=six.reduce((n,r)=>n+Number(r.evaluation.coupon?.[fmt]?.plus1_hit||0),0);item.formats[fmt]={actual_hits:actualHits,plus1_hits:plusHits,five_to_six:actualHits===5&&plusHits===6?1:0,actual_6of6:actualHits===6?1:0,plus1_6of6:plusHits===6?1:0};}
      out.push(item);
    }return out;
  }
  function budgetedImpact(){
    ensureIndex();const rows=[];
    for(const [meeting,all] of _meetingGroups){
      const byLeg=new Map(all.filter(r=>r.evaluation).map(r=>[Number(r.leg),r]));if(![1,2,3,4,5,6].every(i=>byLeg.has(i)))continue;
      for(const format of ['normal','surprise','expert']){
        const six=[1,2,3,4,5,6].map(i=>byLeg.get(i).evaluation.budgeted_shadow?.[format]);
        if(six.some(e=>!e)||new Set(six.map(e=>e.version+'|'+e.snapshot_id)).size!==1||six.some(e=>e.cost>2000||e.cost!==e.baseline_cost))continue;
        rows.push({meeting_key:meeting,format,baseline_hits:six.reduce((n,e)=>n+e.baseline_hit,0),shadow_hits:six.reduce((n,e)=>n+e.shadow_hit,0),cost:six[0].cost,baseline_cost:six[0].baseline_cost,version:six[0].version,snapshot_id:six[0].snapshot_id});
      }
    }
    return {mode:'SHADOW_ONLY',automatic_promotion:false,paired_coupons:rows.length,rows};
  }
  function summary(){ensureIndex();if(_summaryCache.rev===_rev&&_summaryCache.value)return _summaryCache.value;let evaluated=0,base=0,p1=0,p2=0,p3=0,outside=0,deep1=0;for(const r of _idxRows||[]){const e=r?.evaluation;if(!e)continue;evaluated++;base+=Number(e.base_top5_hit||0);p1+=Number(e.plus1_hit||0);p2+=Number(e.plus2_hit||0);p3+=Number(e.plus3_hit||0);if(!e.base_top5_hit){outside++;if(e.deep_winner_rank===1)deep1++;}}const n=evaluated||1,meet=meetingImpact();const value={version:VERSION,races:evaluated,base_top5_pct:100*base/n,plus1_pct:100*p1/n,plus2_pct:100*p2/n,plus3_pct:100*p3/n,outside5_winners:outside,deep_top1_outside5_hits:deep1,meetings:meet.length,meeting_impact:meet,coverage_counterfactual_is_budget_unconstrained:true,budgeted:budgetedImpact()};_summaryCache={rev:_rev,value};return value;}
  global.tkpDeepSurpriseReconcileAfterScores=reconcileAfterScores;
  global.tkpDeepSurpriseTrackerCaptureRace=captureRace;global.tkpDeepSurpriseTrackerAttachCouponSnapshot=attachCouponSnapshot;global.tkpDeepSurpriseTrackerEvaluateRace=evaluateRace;global.tkpDeepSurpriseTrackerSummary=summary;global.tkpDeepSurpriseTrackerLog=()=>log();global.TKP_DEEP_SURPRISE_TRACKER_VERSION=VERSION;
})(globalThis);
