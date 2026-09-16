/**
 * TKP Research Analytics V1.1.194
 * Shadow-only measurement layer. Champion / live coupon logic is NEVER changed here.
 * Uses only PRE-RACE-FROZEN prediction_log rows and already-recorded real bets.
 */
(function(global){
  'use strict';
  const VERSION='V1.1.335-RESEARCH-ANALYTICS-SIGNAL-COVERAGE';
  const EPS=1e-9;
  function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d;}
  function researchGcTrValue(horse){
    const sources=[horse?.tr_ganyan_source,horse?.tr_source].map(v=>String(v??'').trim().toUpperCase());
    if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
    for(const raw of [horse?.tr_ganyan,horse?.tr_puan]){
      if(raw==null||String(raw).trim()==='')continue;
      const value=Number(String(raw).replace(',','.'));if(Number.isFinite(value))return value;
    }
    return NaN;
  }
  function clamp(v,a=0,b=1){return Math.max(a,Math.min(b,n(v)));}
  function fold(v){return String(v||'').trim().toLocaleUpperCase('tr-TR').replace(/İ/g,'I').replace(/Ğ/g,'G').replace(/Ü/g,'U').replace(/Ş/g,'S').replace(/Ö/g,'O').replace(/Ç/g,'C');}
  function key(r){return [r.race_date||'',fold(r.hippodrome||''),Number(r.altili_no)||1,Number(r.leg)||0].join('|');}
  function mean(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}
  function pct(x){return Math.round(x*1000)/10;}

  // Earliest PRE-RACE-FROZEN batch per race. Later snapshots are not selected after seeing results.
  function frozenGroups(db,prefilteredRows){
    const rows=prefilteredRows||(db?.prediction_log||[]).filter(r=>r&&/PRE-RACE-FROZEN/i.test(String(r.strategy_version||''))&&r.race_date&&r.hippodrome&&Number(r.leg));
    const by=new Map();
    for(const r of rows){
      const k=key(r), ts=String(r.ts||'');
      let g=by.get(k);
      if(!g||ts<g.ts){g={key:k,ts,rows:[r]};by.set(k,g);} else if(ts===g.ts) g.rows.push(r);
    }
    return [...by.values()].map(g=>{
      const uniq=new Map();
      for(const r of g.rows){const no=String(r.horse_no||'');if(!no)continue;const old=uniq.get(no);if(!old||n(r.predicted_rank,999)<n(old.predicted_rank,999))uniq.set(no,r);}
      // Research hesapları kaynak prediction_log nesnelerini ASLA değiştirmez.
      // Türetilmiş olasılıklar yalnız bu yerel kopyalarda tutulur.
      const rs=[...uniq.values()].map(r=>({...r}));
      const scoreSum=rs.reduce((s,r)=>s+Math.max(EPS,n(r.score)),0);
      const agfSum=rs.reduce((s,r)=>s+Math.max(0,n(r.agf)),0);
      for(const r of rs){
        r.__modelProb=Number.isFinite(Number(r.model_prob_proxy))?clamp(r.model_prob_proxy):Math.max(EPS,n(r.score))/scoreSum;
        r.__marketProb=Number.isFinite(Number(r.market_prob))?clamp(r.market_prob):(agfSum>0?Math.max(0,n(r.agf))/agfSum:null);
      }
      return {...g,rows:rs};
    }).filter(g=>g.rows.length>=2);
  }

  // One immutable preprocessing pass shared by every research panel.
  // Prevents repeated full scans of prediction_log/races within one render.
  function prepareContext(db){
    const rawFrozenRows=(db?.prediction_log||[]).filter(r=>r&&/PRE-RACE-FROZEN/i.test(String(r.strategy_version||'')));
    const validFrozenRows=rawFrozenRows.filter(r=>r.race_date&&r.hippodrome&&Number(r.leg));
    const groups=frozenGroups(db,validFrozenRows);
    const resolvedGroups=groups.filter(g=>g.rows.some(r=>n(r.resolved)===1));
    const races=(db?.races||[]).filter(r=>r&&r.race_date&&Array.isArray(r.horses)).slice()
      .sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date))||fold(a.hippodrome).localeCompare(fold(b.hippodrome))||n(a.altili_no)-n(b.altili_no)||n(a.leg)-n(b.leg));
    const edgeLeaders=[];
    for(const g of resolvedGroups){
      let best=null,bestEdge=-Infinity;
      for(const r of g.rows){
        if(n(r.resolved)!==1||r.__marketProb==null) continue;
        const e=r.__modelProb-r.__marketProb;
        if(e>bestEdge){bestEdge=e;best=r;}
      }
      if(best) edgeLeaders.push({row:best,edge:bestEdge});
    }
    return {db,groups,resolvedGroups,rawFrozenRows,races,edgeLeaders};
  }

  function calibration(ctx){
    const groups=ctx.resolvedGroups;
    const rows=[];
    for(const g of groups) for(const r of g.rows){
      if(n(r.resolved)!==1) continue;
      rows.push({p:clamp(r.__modelProb),m:r.__marketProb==null?null:clamp(r.__marketProb),y:n(r.winner)===1?1:0,rank:n(r.predicted_rank,999)});
    }
    if(!rows.length) return {races:0,horse_rows:0,brier:null,logloss:null,ece:null,bins:[],market_brier:null,market_logloss:null,top_edge:{starts:0,wins:0,rate:0,avg_edge:0},proxy_note:'PRE-RACE-FROZEN veri bekleniyor'};
    const brier=mean(rows.map(r=>(r.p-r.y)**2));
    const logloss=mean(rows.map(r=>-(r.y*Math.log(Math.max(EPS,r.p))+(1-r.y)*Math.log(Math.max(EPS,1-r.p)))));
    const mr=rows.filter(r=>r.m!=null);
    const marketBrier=mr.length?mean(mr.map(r=>(r.m-r.y)**2)):null;
    const marketLog=mr.length?mean(mr.map(r=>-(r.y*Math.log(Math.max(EPS,r.m))+(1-r.y)*Math.log(Math.max(EPS,1-r.m))))):null;
    const bins=[];let ece=0;
    for(let lo=0;lo<1;lo+=0.1){
      const hi=lo+0.1, z=rows.filter(r=>r.p>=lo&&(hi>=1?r.p<=hi:r.p<hi));
      if(!z.length) continue;
      const pred=mean(z.map(r=>r.p)),actual=mean(z.map(r=>r.y)); ece+=z.length/rows.length*Math.abs(pred-actual);
      bins.push({lo:pct(lo),hi:pct(hi),n:z.length,pred:pct(pred),actual:pct(actual),gap:pct(actual-pred)});
    }
    const edge=ctx.edgeLeaders.filter(x=>x.edge>0);
    const edgeWins=edge.reduce((s,x)=>s+(n(x.row.winner)===1?1:0),0);
    return {races:groups.length,horse_rows:rows.length,brier,logloss,ece,market_brier:marketBrier,market_logloss:marketLog,bins,
      top_edge:{starts:edge.length,wins:edgeWins,rate:edge.length?edgeWins/edge.length:0,avg_edge:edge.length?mean(edge.map(x=>x.edge)):0},
      proxy_note:'Model olasılığı = yarış içi normalize PRE-RACE-FROZEN TKP skor payı; Champion olasılığı değildir.'};
  }

  function longshot(ctx){
    const groups=ctx.groups; const rows=[];
    for(const g of groups) for(const r of g.rows) if(n(r.resolved)===1&&r.__marketProb!=null) rows.push({p:r.__marketProb,y:n(r.winner)===1?1:0,agf_rank:n(r.agf_rank,99)});
    const defs=[
      ['Favori · AGF sıra 1',r=>r.agf_rank===1],['AGF sıra 2–3',r=>r.agf_rank>=2&&r.agf_rank<=3],['AGF sıra 4–5',r=>r.agf_rank>=4&&r.agf_rank<=5],['Longshot · AGF sıra 6+',r=>r.agf_rank>=6&&r.agf_rank<99]
    ];
    return defs.map(([label,fn])=>{const z=rows.filter(fn),w=z.reduce((s,r)=>s+r.y,0);return {label,n:z.length,wins:w,actual:z.length?w/z.length:0,market:z.length?mean(z.map(r=>r.p)):0,bias:z.length?(w/z.length)-mean(z.map(r=>r.p)):0};});
  }

  // Chronological 70/30 holdout. This is diagnostics, not a model-fit feature importance claim.
  // IMPORTANT: "0 aday" ile "bu alan yarış-öncesi snapshotta hiç yok" aynı şey
  // değildir. Eski kayıtlar X/PROF/VALUE/Pace alanlarını taşımayabilir. Bunları
  // %0 ve negatif lift diye göstermek hem yanıltıcı olur hem de eksik veriyi
  // algoritmanın aleyhine kanıt gibi kullanır. Yalnız gerçekten kaydedilmiş
  // yarış-öncesi alanlar kendi sinyal hesabının paydasına girer.
  function featureDiagnostics(db){
    const rows=(db?.forward_tracking_log||[]).filter(r=>r?.evaluated_at&&r.race_date&&r.leader_win!=null).slice().sort((a,b)=>String(a.race_date).localeCompare(String(b.race_date))||String(a.created_at||'').localeCompare(String(b.created_at||'')));
    const cut=Math.max(1,Math.floor(rows.length*0.70));
    const own=(r,k)=>Object.prototype.hasOwnProperty.call(r||{},k);
    const finite=(r,k)=>own(r,k)&&Number.isFinite(Number(r[k]));
    const marked=(r,k,legacy)=>{
      const p=r?.feature_presence;
      if(p&&Object.prototype.hasOwnProperty.call(p,k)) return p[k]===true;
      return legacy(r);
    };
    const defs=[
      ['AGF lideri',r=>n(r.agf_rank,99)===1,r=>marked(r,'agf',x=>finite(x,'agf_rank'))],
      ['TR PUAN ilk 3',r=>n(r.tr_ganyan_rank,99)<=3,r=>marked(r,'tr_ganyan',x=>finite(x,'tr_ganyan_rank'))],
      ['J-BYG ilk 3',r=>n(r.jbyg_rank,99)<=3,r=>marked(r,'jbyg',x=>finite(x,'jbyg_rank'))],
      ['BMB',r=>n(r.bmb)===1,r=>marked(r,'bmb',x=>finite(x,'bmb'))],
      ['ODB',r=>n(r.odb)===1,r=>marked(r,'odb',x=>finite(x,'odb'))],
      ['PROF ≥60',r=>n(r.leader_prof)>=60,r=>marked(r,'prof',x=>finite(x,'leader_prof'))],
      ['VALUE ≥70',r=>n(r.value)>=70,r=>marked(r,'value',x=>finite(x,'value'))],
      // Eski şemada x_points eksik olduğunda 0 yazılıyordu. Pozitif değer tek
      // başına güvenli kanıttır; 0 ise V2 varlık işareti yoksa "kapsam yok"tur.
      ['X pozitif',r=>n(r.x_points)>0,r=>marked(r,'x',x=>finite(x,'x_points')&&n(x.x_points)!==0)],
      ['Sağlam TEK',r=>n(r.single_reliable)===1,r=>marked(r,'single',x=>own(x,'single_reliable')||own(x,'single_candidate'))],
      ['Pace geçmişi var',r=>n(r.prior_accurate_starts)>0,r=>marked(r,'pace',x=>finite(x,'prior_accurate_starts'))]
    ];
    function stats(set,fn,available){
      const eligible=set.filter(available), base=eligible.length?mean(eligible.map(r=>n(r.leader_win))):null;
      const z=eligible.filter(fn),wr=z.length?mean(z.map(r=>n(r.leader_win))):null;
      return {n:z.length,available:eligible.length,win:wr,lift:wr==null||base==null?null:wr-base,base};
    }
    // Tüm sinyaller görünür kalır: "Kapsam yok" satırı sorunları saklamaz, ama
    // veri bulunmayan alanı yanlışlıkla %0 başarı / negatif lift olarak göstermez.
    return defs.map(([label,fn,available])=>({label,train:stats(rows.slice(0,cut),fn,available),test:stats(rows.slice(cut),fn,available)}));
  }

  function risk(ctx,cal){
    const db=ctx.db;
    const bets=(db?.bets||[]).filter(b=>n(b.cost)>0).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    let equity=0,peak=0,maxDd=0,lose=0,maxLose=0,cost=0,payout=0;
    for(const b of bets){const c=n(b.cost),p=n(b.payout);cost+=c;payout+=p;equity+=p-c;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,peak-equity);if(p-c<0){lose++;maxLose=Math.max(maxLose,lose);}else lose=0;}
    let kRows=[];
    for(const x of ctx.edgeLeaders){
      const r=x.row, q=clamp(r.__marketProb), p=clamp(r.__modelProb); if(q<=0||q>=1||p<=q) continue;
      const decimal=1/q, b=decimal-1, full=(b*p-(1-p))/b, quarter=Math.max(0,Math.min(.05,full*.25));
      kRows.push({p,market:q,edge:p-q,kelly:quarter,win:n(r.winner)===1?1:0});
    }
    return {bets:bets.length,cost,payout,net:payout-cost,roi:cost?(payout-cost)/cost:0,max_drawdown:maxDd,max_losing_streak:maxLose,
      theoretical_kelly:{samples:kRows.length,avg_fraction:kRows.length?mean(kRows.map(x=>x.kelly)):0,max_fraction:kRows.length?Math.max(...kRows.map(x=>x.kelly)):0,note:'AGF-implied teorik oran; gerçek bahis oranı değildir. Shadow karar desteği.'},calibration:cal};
  }

  function coverage(ctx){
    const p=ctx.rawFrozenRows;
    const count=f=>p.reduce((s,r)=>s+(f(r)?1:0),0), total=p.length;
    return {rows:total,agf:count(r=>n(r.agf)>0),ypuan:count(r=>r.ypuan!=null&&Number.isFinite(Number(r.ypuan))),market_prob:count(r=>r.market_prob!=null&&Number.isFinite(Number(r.market_prob))),model_prob:count(r=>r.model_prob_proxy!=null&&Number.isFinite(Number(r.model_prob_proxy))),pace:count(r=>n(r.prior_accurate_starts)>0),
      future_note:'Research mevcut PRE-RACE-FROZEN kayıtları salt-okunur analiz eder. Eksik market/model/pace alanları kullanıcı DB\'sine geri yazılmaz.'};
  }

  function historicalReuse(ctx){
    const races=ctx.races;
    const hist=new Map();
    let horseRows=0, paceRows=0, formRows=0, resolvedRows=0, paceRaceN=0, paceTopWins=0, paceTop3=0, paceTop5=0;
    let i=0;
    while(i<races.length){
      const date=String(races[i].race_date); let j=i; while(j<races.length&&String(races[j].race_date)===date) j++;
      const day=races.slice(i,j);
      for(const r of day){
        const rows=[];
        for(const h of (r.horses||[])){
          horseRows++; const hk=fold(h.horse_name); if(!hk) continue;
          const z=hist.get(hk)||[], acc=z.filter(x=>x.speed!=null||x.finish!=null);
          const speed=acc.filter(x=>x.speed!=null).map(x=>x.speed), finish=acc.filter(x=>x.finish!=null).map(x=>x.finish);
          const priorStarts=z.length, priorWins=z.reduce((s,x)=>s+(x.win?1:0),0); if(priorStarts) formRows++; if(acc.length) paceRows++;
          const fp=n(h.finish_position,999), win=n(h.winner)===1||fp===1; if(fp<999||win) resolvedRows++;
          rows.push({pace:speed.length?mean(speed):null,finish:finish.length?mean(finish):null,starts:priorStarts,wins:priorWins,win:win?1:0,fp});
        }
        const paceCandidates=rows.filter(x=>x.pace!=null).sort((a,b)=>b.pace-a.pace);
        if(paceCandidates.length>=2){const top=paceCandidates[0];paceRaceN++;paceTopWins+=top.win;paceTop3+=(top.fp<=3?1:0);paceTop5+=(top.fp<=5?1:0);}
      }
      for(const r of day) for(const h of (r.horses||[])){
        const hk=fold(h.horse_name); if(!hk) continue;
        const speed=Number(h.accurate_avg_speed_mps), finish=Number(h.accurate_finish_signal), fp=n(h.finish_position,999);
        const rec={speed:Number.isFinite(speed)&&speed>0?speed:null,finish:Number.isFinite(finish)?finish:null,win:(n(h.winner)===1||fp===1)?1:0};
        if(!hist.has(hk)) hist.set(hk,[]); hist.get(hk).push(rec);
      }
      i=j;
    }
    return {mode:'TEMPORAL-RECONSTRUCTED-EXPLORATORY',strict_prior_date:true,champion_eligible:false,horse_rows:horseRows,resolved_rows:resolvedRows,reconstructed_form_rows:formRows,reconstructed_pace_rows:paceRows,pace_races:paceRaceN,
      pace_top:{wins:paceTopWins,win_rate:paceRaceN?paceTopWins/paceRaceN:0,top3:paceTop3,top3_rate:paceRaceN?paceTop3/paceRaceN:0,top5:paceTop5,top5_rate:paceRaceN?paceTop5/paceRaceN:0},
      note:'Yalnız hedef yarış tarihinden daha eski yarışlar kullanılır. Aynı gün ve hedef yarışın kendi Accurate/sonuç verisi dahil edilmez. Bu hat keşif içindir; forward kanıt yerine geçmez.'};
  }

  function integrity(ctx){
    const db=ctx.db, files=db?.files||[], races=db?.races||[], preds=db?.prediction_log||[];
    const fileIds=new Set(files.map(f=>String(f.id))), raceKeys=new Map(), meetingRaceKeys=new Map();
    let duplicateRaceKeys=0,duplicateMeetingRaces=0,orphanRaces=0,winnerOk=0,winnerMissing=0,winnerMulti=0,deadHeat=0,winnerMultiUnexplained=0,payoutRaces=0;
    for(const r of races){
      const k=[String(r.file_id??''),n(r.leg)].join('|');raceKeys.set(k,(raceKeys.get(k)||0)+1);
      const mk=[r.race_date||'',fold(r.hippodrome||''),n(r.leg)].join('|');meetingRaceKeys.set(mk,(meetingRaceKeys.get(mk)||0)+1);
      if(r.file_id!=null&&!fileIds.has(String(r.file_id))) orphanRaces++;
      const winners=(r.horses||[]).filter(h=>n(h.winner)===1||n(h.finish_position,999)===1), w=winners.length;
      if(w===1)winnerOk++;else if(w===0)winnerMissing++;else{
        winnerMulti++;
        const nums=new Set(winners.map(h=>String(h.horse_no||''))), payouts=Array.isArray(r.payouts)?r.payouts:[];
        const ganyanNums=new Set(payouts.filter(p=>fold(p?.label).includes('GANYAN')&&/^\d+$/.test(String(p?.combo||'').trim())).map(p=>String(p.combo).trim()));
        const confirmed=[...nums].every(x=>ganyanNums.has(x));
        if(confirmed)deadHeat++;else winnerMultiUnexplained++;
      }
      if((Array.isArray(r.payouts)&&r.payouts.length)||(r.payouts&&!Array.isArray(r.payouts)&&Object.keys(r.payouts).length))payoutRaces++;
    }
    for(const c of raceKeys.values())if(c>1)duplicateRaceKeys+=c-1;
    for(const c of meetingRaceKeys.values())if(c>1)duplicateMeetingRaces+=c-1;
    return {files:files.length,races:races.length,prediction_rows:preds.length,frozen_rows:ctx.rawFrozenRows.length,duplicate_race_keys:duplicateRaceKeys,duplicate_meeting_races:duplicateMeetingRaces,orphan_races:orphanRaces,winner_ok:winnerOk,winner_missing:winnerMissing,winner_multi:winnerMulti,dead_heat:deadHeat,winner_multi_unexplained:winnerMultiUnexplained,payout_races:payoutRaces,hard_fail:duplicateRaceKeys>0||orphanRaces>0||winnerMultiUnexplained>0};
  }

  function safeReuseCoverage(ctx){
    const resolved=ctx.resolvedGroups;
    let rows=0,score=0,frozenAgf=0,ypuan=0,bmb=0,odb=0;
    for(const g of resolved)for(const r of g.rows){if(n(r.resolved)!==1)continue;rows++;if(Number.isFinite(Number(r.score)))score++;if(n(r.agf)>0)frozenAgf++;if(Number.isFinite(Number(r.ypuan)))ypuan++;if(r.bmb!=null)bmb++;if(r.odb!=null)odb++;}
    return {resolved_races:resolved.length,resolved_rows:rows,frozen_score_rows:score,frozen_agf_rows:frozenAgf,frozen_ypuan_rows:ypuan,frozen_bmb_rows:bmb,frozen_odb_rows:odb,model_proxy_safe_rows:score,market_safe_rows:frozenAgf,note:'Model proxy eski donmuş score’dan güvenle üretilebilir. Piyasa olasılığı yalnız snapshot içinde AGF varsa güvenli sayılır; arşivde sonradan bulunan AGF kalibrasyona geri yazılmaz.'};
  }

  // Temizlenmiş tarihsel havuzdan BH ve Profil Gücü ölçümü. Aday üretiminde
  // finish_position/winner okunmaz; bu alanlar yalnız adaylar dondurulduktan sonra
  // isabet etiketi olarak kullanılır. Böylece aynı 500 veri analiz tablosunu besler,
  // fakat sonuç bilgisi seçim puanına sızmaz.
  function historicalBhAndProfile(ctx){
    const races=ctx.races;
    const rankMap=(horses,read,lower=false)=>{const rows=horses.map(h=>({h,v:Number(read(h))})).filter(x=>Number.isFinite(x.v));rows.sort((a,b)=>lower?a.v-b.v:b.v-a.v);const map=new Map();rows.forEach((x,i)=>map.set(x.h,i+1));return {map,count:rows.length};};
    const rankScore=(m,h)=>{const rank=m.map.get(h);return !rank||!m.count?0:m.count<=1?1:Math.max(0,1-(rank-1)/(m.count-1));};
    const profileValue=h=>{for(const v of [h?.team_strength_pct,h?.profile_strength_pct,h?.prof,h?.leader_prof]){const x=Number(v);if(Number.isFinite(x))return x;}return null;};
    const bands=[{label:'<50',lo:-Infinity,hi:50},{label:'50–59',lo:50,hi:60},{label:'60–69',lo:60,hi:70},{label:'70+',lo:70,hi:Infinity}].map(x=>({...x,starts:0,wins:0,top3:0,top5:0}));
    let bhRaces=0,anyWin=0,anyTop3=0,anyTop5=0,firstWin=0,secondWin=0;const winnerScoresByDate=[];
    for(const r of races){
      const hs=(r.horses||[]).filter(h=>h&&!h.non_runner&&!h.scratched),winnerKnown=hs.some(h=>n(h.winner)===1||n(h.finish_position,999)===1);if(!winnerKnown)continue;
      for(const h of hs){const p=profileValue(h),fp=n(h.finish_position,999),win=n(h.winner)===1||fp===1;if(p==null)continue;const band=bands.find(x=>p>=x.lo&&p<x.hi);if(band){band.starts++;if(win)band.wins++;if(fp<=3)band.top3++;if(fp<=5)band.top5++;}}
      const maps={value:rankMap(hs,h=>h?.value_score),hndkp:rankMap(hs,h=>h?.hndkp_rank,true),tr:rankMap(hs,researchGcTrValue),jbyg:rankMap(hs,h=>h?.jbyg??h?.jbyg_rank,true),g800:rankMap(hs,h=>h?.g800,true),ypuan:rankMap(hs,h=>h?.ypuan),base:rankMap(hs,h=>h?.score)};
      const candidates=hs.filter(h=>(Number(h?.agf_rank)||99)>=6).map(h=>{
        const prof=profileValue(h),odb=n(h?.odb)===1||n(h?._ypuanOdbTail)===1;
        const score=.18*rankScore(maps.value,h)+.12*rankScore(maps.hndkp,h)+.14*rankScore(maps.tr,h)+.10*rankScore(maps.jbyg,h)+.08*rankScore(maps.g800,h)+.08*rankScore(maps.ypuan,h)+.08*rankScore(maps.base,h)+(n(h?.bmb)===1?.12:0)+(odb?.10:0)+(prof==null?0:Math.max(0,Math.min(1,prof/100))*.08);
        return {h,score};
      }).filter(x=>x.score>.18).sort((a,b)=>b.score-a.score||(Number(a.h?.agf_rank)||99)-(Number(b.h?.agf_rank)||99)).slice(0,4);
      if(!candidates.length)continue;bhRaces++;
      const hit=candidates.filter(x=>n(x.h?.winner)===1||n(x.h?.finish_position,999)===1);if(hit.length){anyWin++;for(const x of hit)winnerScoresByDate.push({race_date:String(r.race_date),score:Number((x.score*100).toFixed(2))});}
      if(candidates.some(x=>n(x.h?.finish_position,999)<=3))anyTop3++;if(candidates.some(x=>n(x.h?.finish_position,999)<=5))anyTop5++;if(n(candidates[0]?.h?.winner)===1||n(candidates[0]?.h?.finish_position,999)===1)firstWin++;
      // BH 2. sıradaki adayın kendi başına isabetini de ayrı sayıyoruz (1. aday ile
      // karıştırılmadan): "BH 1./2. öğrenme" kullanıcı gereksinimi -- 1. ve 2. aday
      // performansı ayrı ayrı görünür olmalı, tek bir "herhangi biri tuttu" ölçüsüne gömülmemeli.
      if(candidates[1]&&(n(candidates[1].h?.winner)===1||n(candidates[1].h?.finish_position,999)===1))secondWin++;
    }
    return {version:'BH-500-PRE-RACE-V1',strict_pre_race:true,races:bhRaces,any_win:anyWin,any_top3:anyTop3,any_top5:anyTop5,first_win:firstWin,second_win:secondWin,win_rate:bhRaces?anyWin/bhRaces:0,top3_rate:bhRaces?anyTop3/bhRaces:0,top5_rate:bhRaces?anyTop5/bhRaces:0,first_win_rate:bhRaces?firstWin/bhRaces:0,second_win_rate:bhRaces?secondWin/bhRaces:0,winner_scores_by_date:winnerScoresByDate,profile_bands:bands.map(x=>({label:x.label,starts:x.starts,wins:x.wins,win_rate:x.starts?x.wins/x.starts:0,top3:x.top3,top3_rate:x.starts?x.top3/x.starts:0,top5:x.top5,top5_rate:x.starts?x.top5/x.starts:0,eligible:x.starts>0}))};
  }

  let _buildCache={db:null,revision:null,files:null,races:null,preds:null,forward:null,bets:null,value:null};
  function currentRevision(){try{return typeof _tkpDbRevision!=='undefined'?Number(_tkpDbRevision):null;}catch(_e){return null;}}
  const TKP_ANALYSIS_CACHE_KEY='research_analytics_v2_signal_coverage';
  function build(db){
    const revision=currentRevision(), files=db?.files, races=db?.races, preds=db?.prediction_log, forward=db?.forward_tracking_log, bets=db?.bets;
    if(_buildCache.db===db&&_buildCache.revision===revision&&_buildCache.files===files&&_buildCache.races===races&&_buildCache.preds===preds&&_buildCache.forward===forward&&_buildCache.bets===bets&&_buildCache.value) return _buildCache.value;
    // V1.1.324: sayfa yenilenince/oturum kapanınca yukarıdaki _buildCache sıfırlanır --
    // veri hiç değişmemiş olsa bile analiz baştan hesaplanırdı. tkp-analysis-cache.js
    // (veri parmak izi + model sürümü + 3 günlük TTL ile) kalıcı katman sağlıyor; burada
    // önce ona bakılır, yalnız gerçekten gerekliyse (veri/model değişti VEYA 3 gün doldu)
    // aşağıdaki tam hesap çalışır.
    if(typeof global.tkpAnalysisCacheRead==='function'){
      const persisted=global.tkpAnalysisCacheRead(db,TKP_ANALYSIS_CACHE_KEY);
      if(persisted){ _buildCache={db,revision,files,races,preds,forward,bets,value:persisted}; return persisted; }
    }
    const ctx=prepareContext(db),cal=calibration(ctx);
    const value={version:VERSION,shadow_only:true,champion_untouched:true,calibration:cal,longshot:longshot(ctx),features:featureDiagnostics(db),risk:risk(ctx,cal),coverage:coverage(ctx),safe_reuse:safeReuseCoverage(ctx),historical_reuse:historicalReuse(ctx),bomb_hunter_500:historicalBhAndProfile(ctx),integrity:integrity(ctx)};
    _buildCache={db,revision,files,races,preds,forward,bets,value};
    if(typeof global.tkpAnalysisCacheWrite==='function') global.tkpAnalysisCacheWrite(db,TKP_ANALYSIS_CACHE_KEY,value);
    return value;
  }
  global.TKP_RESEARCH_ANALYTICS_VERSION=VERSION;
  global.tkpResearchAnalytics=build;
})(window);
