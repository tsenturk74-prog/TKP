(function(global){
  'use strict';

  const safeNum=(v,fallback=0)=>{
    const n=Number(v);
    return Number.isFinite(n)?n:fallback;
  };

  const normalizeNo = h => String(h?.horse_no ?? h?.no ?? h?.name ?? h ?? '');

  const horseKey = h => {
    const no=normalizeNo(h);
    const group = typeof global.ekuriGroup === 'function' ? global.ekuriGroup(no) : null;
    return group ? 'E:'+group : 'N:'+no;
  };

  const legKey = (l,i) => String(l?.r?.id ?? l?.r?.leg ?? i);

  const cloneSet = set => new Set(Array.from(set||[]));


  function finishSteps(steps){let next;do{next=steps.next();}while(!next.done);return next.value;}
  async function finishStepsAsync(steps,pause){
    const wait=pause||(()=>new Promise(resolve=>setTimeout(resolve,0)));
    try{let next;while(!(next=steps.next()).done)await wait();return next.value;}
    finally{steps.return();}
  }

  function unionMass(coupons, masses){
    const valid = coupons.filter(c=>c && !c.error && c.legs?.length===6);
    if(!valid.length) return 0;

    let union = 0;
    for(let mask=1; mask < (1<<valid.length); mask++){
      const subset = valid.filter((_,i)=>(mask&(1<<i)));
      let joint = 1;
      for(let i=0;i<6;i++){
        const key = legKey(subset[0].legs[i], i);
        const map = masses.get(key);

        let intersection = null;
        for(const c of subset){
          const row = c.legs.find((l,j)=>legKey(l,j)===key);
          const picks = new Set((row?.picks || []).map(horseKey));
          intersection = intersection === null
            ? picks
            : new Set([...intersection].filter(n=>picks.has(n)));
        }

        if(!intersection || !intersection.size) {
          joint = 0;
          break;
        }

        let mass = 0;
        for(const k of intersection){mass += map?.get(k) || 0;}
        joint *= mass;
      }
      union += (subset.length % 2 ? 1 : -1) * joint;
    }

    return Math.max(0, Math.min(1, union));
  }

  function coverageRole(role){
    return role==='alt' ? 'alt' : role==='surprise' ? 'surprise' : 'main';
  }

  function normalizeCandidateRows(leg, role){
    const source = (leg?.allHorses?.length ? leg.allHorses : leg?.r?.horses || []).filter((h) => {
      return !(typeof global.isNonRunner === 'function' && global.isNonRunner(h));
    });

    let rows = [];
    try{
      if(!source.length && typeof global.tkpRoleSingleOrder === 'function'){
        rows = global.tkpRoleSingleOrder(leg, role) || [];
      }
    }catch(_){ rows = []; }

    if(!Array.isArray(rows) || !rows.length){
      rows = source;
    }

    const ordered = source.length ? source : rows;
    const seen = new Set();
    const out = [];
    for(const h of ordered){
      if(!h) continue;
      // Keep different members of an ekuri until buildSpec sums their masses.
      const k = normalizeNo(h);
      if(seen.has(k)) continue;
      seen.add(k);
      out.push(h);
    }
    return out;
  }

  function protectedRow(leg, row){
    if(leg?.protectedFlag) return true;

    const no = normalizeNo(row);
    const protectedNos = [];
    if(Array.isArray(leg?.kulisPriorityNos)) protectedNos.push(...leg.kulisPriorityNos);
    if(leg?.protectedSignalNos instanceof Set) protectedNos.push(...Array.from(leg.protectedSignalNos));
    if(leg?.protectedValueNos instanceof Set) protectedNos.push(...Array.from(leg.protectedValueNos));
    // A BMB/ODB tag alone is not evidence of a stronger win probability.
    return row?.__tkpStrategySingle || row?.__tkpStrategyFallbackSingle || protectedNos.includes(String(no));
  }

  function buildSpec(leg,index,role){
    const rows = normalizeCandidateRows(leg, role);
    const grouped = new Map();

    for(const row of rows){
      const p = (() => {
        const raw = row?.tkp_probability ?? row?.probability ?? row?.p ?? row?.score;
        const n = safeNum(raw,0);
        return Math.max(0,n);
      })();

      if(!Number.isFinite(p) || p < 0) continue;
      const key = horseKey(row);

      if(grouped.has(key)){
        const group=grouped.get(key);group.p+=p;group.members.push(row);
        if(p>group.representativeMass){group.h=row;group.horseNo=row.horse_no;group.representativeMass=p;}
      }else{
        grouped.set(key,{
          h: row,
          key,
          horseNo: row?.horse_no,
          p,members:[row],representativeMass:p
        });
      }
    }

    const pool = [...grouped.values()];
    const total = pool.reduce((s, row)=>s+safeNum(row.p),0);
    if(!total) throw Error('Ayak olasılıkları dağılım için hazır değil.');

    pool.forEach((row)=>{row.p = Math.max(0,row.p/total);});

    pool.sort((a,b) => String(a.h?.horse_no).localeCompare(String(b.h?.horse_no), undefined, {numeric:true}) || b.p-a.p);

    const entropy = -pool.reduce((s,row)=>s + (row.p>0 ? row.p * Math.log(row.p) : 0), 0);
    const effective = Math.exp(Math.max(0, entropy));
    const protectedCount = pool.filter(row => protectedRow(leg, row.h)).length;

    try{
      for(const row of pool){
        let consensus = 0;
        try{
          if(typeof global.tkpCommentatorConsensus === 'function'){
            const c = global.tkpCommentatorConsensus(leg.r, row.h);
            consensus = c?.available ? Math.max(0, Math.min(1, Number(c.ratio) || 0)) : 0;
          }
        }catch(_){ }

        // `agf` is a percentage in TKP, including 1 and fractional percentages.
        // Treating AGF=1 as probability=1 gave a 1% outsider a 100% market prior.
        let agf=(row.members||[row.h]).reduce((sum,h)=>{
          const explicit=h?.agf!==null&&h?.agf!==undefined&&h?.agf!=='';
          const raw=Number(explicit?h.agf:h?.agf_score||0);
          return sum+(Number.isFinite(raw)?Math.max(0,explicit?raw/100:raw>1?raw/100:raw):0);
        },0);
        agf=Math.min(1,agf);

        row.isProtectedCandidate = protectedRow(leg,row.h);
        row.protected = row.isProtectedCandidate ? 1 : 0;
        row.consensus = Math.max(0, Math.min(1, consensus));
        row.agf = agf;
      }
    }catch(_){ }

    pool.sort((a,b)=>
      b.p - a.p ||
      Number(b.isProtectedCandidate)-Number(a.isProtectedCandidate) ||
      String(a.h?.horse_no).localeCompare(String(b.h?.horse_no), undefined, {numeric:true})
    );

    const cum=[];
    let running=0;
    for(const row of pool){ running += row.p; cum.push(running); }

    const top = pool[0] || {p:0,h:{}};
    const second = pool[1] || {p:0,h:{}};
    const third = pool[2] || {p:0,h:{}};
    const gap = Math.max(0, top.p - second.p);
    const difficulty = pool.length > 1 ? 100 * (entropy / Math.log(pool.length)) : 0;
    const singleStrength = Number(top.p) + 0.45 * gap;

    // İki güçlü at kümesi: yalnız Y.PUAN'ın 100 üstünde olması yetmez. İlk iki
    // aday aynı zamanda ana TKP sırasında önde kalmalı, AGF desteğini toplamalı
    // ve üçüncü aday ikinciye yaklaşmamalıdır. Bu kanıt varsa ayağı sırf geniş
    // saha/zorluk puanı yüzünden 3-6 ata açmak yerine iki gerçek liderde kapat.
    const ypuanOf=row=>Math.max(0,...(row?.members||[row?.h]).map(h=>safeNum(h?.ypuan,0)));
    const agfOf=row=>Math.max(0,...(row?.members||[row?.h]).map(h=>safeNum(h?.agf,0)));
    const topYpuan=ypuanOf(top),secondYpuan=ypuanOf(second),thirdYpuan=ypuanOf(third);
    const topAgf=agfOf(top),secondAgf=agfOf(second),thirdAgf=agfOf(third);
    const thirdNotClose=pool.length<3 || (
      third.p<=second.p*0.86 &&
      thirdAgf<=Math.max(12,secondAgf*0.50) &&
      thirdYpuan<=Math.min(85,secondYpuan-25)
    );
    const dominantPair=pool.length>=2 && topYpuan>=100 && secondYpuan>=100 &&
      topAgf+secondAgf>=45 && thirdNotClose;

    let minCount;
    if(top.p >= 0.70 && gap >= 0.22) minCount = 1;
    else if(gap >= 0.18) minCount = 2;
    else if(gap >= 0.12) minCount = 3;
    else if(gap >= 0.06) minCount = 4;
    else minCount = 6;

    if(leg.picks?.length===1) minCount = 1;
    if(!Number.isFinite(minCount) || minCount < 1) minCount = 2;

    const preferredSingle = top.p >= 0.62 && gap >= 0.18;

    return {
      leg,
      index,
      pool,
      cum,
      effective,
      difficulty: Math.max(0, Math.min(100, Number(difficulty) || 0)),
      minCount: Math.max(2, Math.min(10, minCount)),
      maxCount: dominantPair ? 2 : Math.min(10, pool.length),
      entropy,
      gap,
      topP: top.p,
      singleStrength,
      protectedCount,
      isSingle: leg.picks?.length===1,
      preferredSingle,
      dominantPair,
      dominantPairEvidence:{topYpuan,secondYpuan,thirdYpuan,topAgf,secondAgf,thirdAgf,thirdToSecond:second.p>0?third.p/second.p:0},
      sourceRows: rows
    };
  }

  function singleCandidateScore(role,spec,row,blocked){
    if(!row || !Number.isFinite(row.p) || row.p<=0) return -Infinity;

    const profiles = {
      main: {p:0.70, gap:0.18, edge:0.10, tail:0.00, kulis:0.18, consensus:0.12},
      alt: {p:0.42, gap:0.14, edge:0.12, tail:0.30, kulis:0.18, consensus:0.08},
      surprise: {p:0.36, gap:0.10, edge:0.12, tail:0.34, kulis:0.20, consensus:0.08}
    };
    const profile = profiles[role] || profiles.main;

    const p = row.p;
    const margin = Math.max(0, spec.gap);
    const agfEdge = Math.max(-0.2, Math.min(0.2, p - (row.agf || 0)));
    const base =
      profile.p * p +
      profile.gap * (margin / 0.25) +
      profile.edge * agfEdge +
      profile.tail * (1 - p) +
      profile.kulis * (row.isProtectedCandidate ? 1 : 0) +
      profile.consensus * (row.consensus || 0) -
      (blocked ? 0.16 : 0) +
      (row.agf || 0) * 0.08;

    return base;
  }

  function eligibleSingle(spec){
    if(Object.prototype.hasOwnProperty.call(spec,'singleCandidate'))return spec.singleCandidate;
    spec.singleCandidate=null;
    const x={...(spec.leg.x||{}),r:spec.leg.r,scored:spec.sourceRows};
    const leader=typeof global.tkpFirstLookLeaderForLeg==='function'
      ?global.tkpFirstLookLeaderForLeg(x):spec.pool[0]?.h;
    if(!leader)return null;
    const row=spec.pool.find(r=>r.key===horseKey(leader));
    if(!row)return null;
    // A raw TKP score is a ranking signal, not a win probability. Use the
    // full-field probability model when explicit probabilities are absent.
    const probability=h=>h?.tkp_probability??h?.probability??h?.p;
    const hasProbability=h=>probability(h)!==null&&probability(h)!==undefined&&probability(h)!==''&&Number.isFinite(Number(probability(h)))&&Number(probability(h))>=0;
    let probabilistic=spec.sourceRows;
    if(!probabilistic.every(hasProbability)){
      try{probabilistic=global.tkpProbabilityPortfolioOrderForRace?.(x.r,spec.sourceRows,'main')||[];}catch(_){return null;}
    }
    if(!probabilistic.length||!probabilistic.every(hasProbability))return null;
    const byKey=new Map();
    for(const h of probabilistic)byKey.set(horseKey(h),(byKey.get(horseKey(h))||0)+Number(probability(h)));
    // Never inflate a probability by normalizing a selected subset.
    if(spec.pool.some(r=>!byKey.has(r.key)))return null;
    const total=[...byKey.values()].reduce((a,b)=>a+b,0);
    if(!(total>0))return null;
    const p=(byKey.get(row.key)||0)/total;
    const rival=Math.max(0,...[...byKey].filter(([k])=>k!==row.key).map(([,v])=>v/total));
    if(!(p>0))return null;
    if(typeof global.canBeCouponSingle==='function'&&!global.canBeCouponSingle(leader))return null;
    let decision=null;
    if(typeof global.dynamicSingleDecision==='function'){
      const second=spec.pool.filter(r=>r.key!==row.key).sort((a,b)=>(byKey.get(b.key)||0)-(byKey.get(a.key)||0))[0]?.h||null;
      try{decision=global.dynamicSingleDecision(x,leader,second);}catch(_){return null;}
      if(!decision||decision.failureBlocked||decision.agfTrap?.hardBlock||decision.xBreakSingle||decision.weightOk===false)return null;
    }
    const strong=p>=.62&&p-rival>=.18&&(!decision||(decision.isSingle&&Number(decision.confidence)>=Number(decision.threshold||68)));
    spec.singleCandidate={...row,h:leader,p,gap:p-rival,strong,confidence:decision?.confidence??null,risk:Number(decision?.risk?.score)||0};
    return spec.singleCandidate;
  }

  function singleEligibility(leg,horse,role='main'){
    try{
      const candidate=eligibleSingle(buildSpec(leg,0,role));
      return {ok:!!candidate&&candidate.key===horseKey(horse),leaderNo:candidate?normalizeNo(candidate.h):null,
        probability:candidate?.p??null,gap:candidate?.gap??null,confidence:candidate?.confidence??null,strong:!!candidate?.strong};
    }catch(_){return {ok:false,leaderNo:null};}
  }

  function* chooseSingleLegsSteps(coupon, role, options={}){
    if(!coupon||!Array.isArray(coupon.legs)||coupon.legs.length!==6)return {ok:false,error:'Kupon ayakları eksik.'};
    const targetRole=coverageRole(role),usage=options.singleUsageByLeg||new Map();
    const specs=coupon.legs.map((leg,index)=>buildSpec(leg,index,targetRole));
    const candidates=[];for(const spec of specs){yield;const row=eligibleSingle(spec);if(row)candidates.push({spec,row});}
    if(!candidates.length)return {ok:false,error:'Genel Bakış liderlerinden uygun TEK seçilemedi; teksiz kupon oluşturulmadı.'};
    for(const item of candidates){
      const used=usage.get(String(item.spec.index))?.has(item.row.key);
      item.value=.55*item.row.p+.25*item.row.gap+.20*(Number(item.row.confidence)||0)/100-.25*item.row.risk/100-(used?.03:0);
    }
    candidates.sort((a,b)=>b.value-a.value||a.spec.index-b.spec.index);
    const strong=candidates.filter(x=>x.row.strong);
    const chosen=strong.length>=2?strong.slice(0,2):[strong[0]||candidates[0]],selected=new Map(chosen.map(x=>[x.spec,x.row]));
    for(const spec of specs){
      const row=selected.get(spec);
      spec.isSingle=!!row;
      spec.leg.protectedFlag=!!row;
      spec.leg.picks=row?[row.h]:spec.pool.slice(0,Math.max(2,spec.minCount)).map(r=>r.h);
      spec.leg.minCoverage=row?1:Math.max(2,spec.minCount);
      spec.leg.maxCoverage=row?1:spec.maxCount;
      spec.leg.singleEligibility=row?{ok:true,leaderNo:normalizeNo(row.h),probability:row.p,gap:row.gap,confidence:row.confidence,strong:row.strong}:null;
      if(row)spec.leg.ordered=spec.pool.map(r=>r.h);
    }
    return {ok:true,specs,selectedSingles:chosen.map(x=>({spec:x.spec,key:x.row.key,legNo:String(x.spec.index)}))};
  }

  function* optimizeSteps(built){
    const all=['main','alt','surprise'].map((k)=>built?.[k]).filter(c=>c&&!c.error&&!c.readOnlySnapshot&&c.legs?.length===6);
    if(all.length!==3 || typeof global.tkpProbabilityPortfolioOrderForRace!=='function') return built;

    const masses = new Map();
    for(const [i,leg] of all[0].legs.entries()){
      const key = legKey(leg,i);
      const source = leg.r?.horses || leg.allHorses || [];
      yield;
      const rows = global.tkpProbabilityPortfolioOrderForRace(leg.r, source, 'main');
      const total = rows.reduce((s,h)=>s+Math.max(0, safeNum(h?.tkp_probability || h?.p, 0)), 0);
      if(!(total>0)) return built;

      const map = new Map();
      for(const h of rows){
        const k = horseKey(h);
        map.set(k, (map.get(k) || 0) + Math.max(0, safeNum(h?.tkp_probability || h?.p, 0))/total);
      }
      masses.set(key, map);
    }

    const isProtected = (leg,h)=>leg.protectedFlag || leg.protectedSignalNos?.has?.(String(h.horse_no)) || leg.protectedValueNos?.has?.(String(h.horse_no)) || leg.protectedBombNos?.has?.(String(h.horse_no)) || Number(h.bmb)===1 || Number(h.odb)===1 || h.__tkpStrategySingle || h.__tkpStrategyFallbackSingle;

    const before = unionMass(all,masses);
    let current = before;
    let checks = 0;
    const changes = [];
    const coveragePoolCache = new Map();

    for(let round=0; round<2; round++){
      let best = null;

      for(const key of ['alt','surprise']){
        for(const [i,leg] of built[key].legs.entries()){
          if(leg.picks?.length < 2) continue;

          const cacheKey = `${key}|${i}`;
          const roleName = coverageRole(key);
          yield;
          if(!coveragePoolCache.has(cacheKey)){
            const base = (typeof global.tkpRoleSingleOrder === 'function') ? global.tkpRoleSingleOrder(leg, roleName) : (leg.ordered||leg.allHorses||[]);
            const seen = new Set();
            const deduped = [];
            for(const row of base){
              const k = horseKey(row);
              if(seen.has(k)) continue;
              seen.add(k);
              if(typeof global.isNonRunner === 'function' && global.isNonRunner(row)) continue;
              deduped.push(row);
            }
            coveragePoolCache.set(cacheKey, deduped.slice(0,10));
          }

          for(const h of coveragePoolCache.get(cacheKey)){
            if(leg.picks?.some(p=>horseKey(p)===horseKey(h))) continue;

            for(let at = Math.max(0, leg.picks.length-2); at < leg.picks.length; at++){
              const old = leg.picks[at];
              if(old && isProtected(leg, old)) continue;
              if((++checks & 15) === 0 && typeof global.tkpCouponCheck === 'function') global.tkpCouponCheck('Üç kuponun ortak kapsamı');

              yield;
              let mass;
              leg.picks[at] = h;
              try {
                mass = unionMass(all,masses);
              } finally {
                leg.picks[at] = old;
              }

              if(Number.isFinite(mass) && mass > current + 1e-10){
                if(!best || mass > best.mass + 1e-10){
                  best = {key, leg, at, h, old, mass};
                }
              }
            }
          }
        }
      }

      if(!best) break;

      best.leg.picks[best.at] = best.h;
      current = best.mass;
      const coupon = built[best.key];
      const idx = coupon.legs.indexOf(best.leg);
      const map = masses.get(legKey(best.leg, idx));
      const count = coupon.legs[idx]?.picks?.reduce((sum,row)=>sum+(map?.get(horseKey(row))||0),0) || 0;
      if(coupon.legs[idx]){
        coupon.legs[idx].portfolioProbability = {
          ...(coupon.legs[idx].portfolioProbability || {}),
          mass: count,
          validated: false
        };
        if(coupon.legs[idx].distributionPlan){
          coupon.legs[idx].distributionPlan.estimatedMass = count;
          coupon.legs[idx].distributionPlan.reason = `Zorluk ${Math.round(coupon.legs[idx].distributionPlan.difficulty)}/100 · etkili rakip ${coupon.legs[idx].distributionPlan.effectiveRivals?.toFixed?.(1) || '?'} · ${coupon.legs[idx].distributionPlan.count} at · tahmini kapsama %${Math.round(count*100)} · ortak kupon kapsamı`;
        }
      }
      changes.push({
        coupon: best.key,
        leg: best.leg.r?.leg,
        removed: String(best.old?.horse_no),
        added: String(best.h?.horse_no)
      });
    }

    built.coverageOptimization = {
      version: 'R16.75',
      before,
      after: current,
      changes,
      checks,
      assumption: 'independent races; estimated win probabilities',
      validatedROI: false
    };
    for(const key of ['alt','surprise']){
      if(built[key]) built[key].coverageOptimization = { ...built.coverageOptimization, changes: changes.filter(c=>c.coupon===key) };
    }

    return built;
  }

  function distributionRule(coupon){
    const widths=(coupon?.legs||[]).map(l=>Array.isArray(l?.picks)?l.picks.length:0);
    const multi=widths.filter(n=>n>1);
    const twoHorseLegs=multi.filter(n=>n===2).length;
    const undersized=multi.filter(n=>n<3).length;
    return {
      valid:widths.length===6 && widths.every(n=>n>0) && twoHorseLegs<=1 && undersized<=twoHorseLegs,
      widths,
      twoHorseLegs,
      maxTwoHorseLegs:1,
      minimumMultiWidth:3,
      undersizedMultiLegs:undersized
    };
  }

  function* planWidthsSteps(coupon, options={}){
    if(!coupon || coupon.error || coupon.readOnlySnapshot || coupon.legs?.length !== 6) return coupon;

    const role = coverageRole(coupon.typeKey || coupon.role || 'main');
    const singleUsage = coupon.__coverageSingleUsageByLeg || new Map();

    if(!options.selectedSingles){
      const singleBuild = yield* chooseSingleLegsSteps(coupon, role, {singleUsageByLeg: singleUsage});
      if(!singleBuild.ok){
        coupon.error = singleBuild.error;
        return coupon;
      }
    }

    const unit = Number(coupon.unit) || 1;
    const low = Math.ceil(1000 / unit - 1e-8);
    const high = Math.floor(1400 / unit + 1e-8);

    const specs=[];
    for(let index=0;index<coupon.legs.length;index++){
      specs.push(buildSpec(coupon.legs[index],index,role));
      yield;
    }
    const singles = specs.filter(spec => spec.isSingle);
    if(singles.length < 1 || singles.length > 2){
      coupon.error = 'Kuponda 1 veya 2 TEK bulunmalı.';
      return coupon;
    }

    const free = specs.filter(spec=>!spec.isSingle).map(s=>({ ...s }));
    const ordered = free.sort((a,b)=>a.difficulty-b.difficulty || a.index-b.index);
    const orderedIndices = ordered.map(s=>s.index);

    // Kupon dağılımı kuralı: iki atlı ayak yalnızca bir kez kullanılabilir.
    // Diğer çoklu ayaklar 3 veya daha fazla aday taşır. Önceki DP her ayağı
    // 2'den başlatabildiği için 1400 TL tavanını doldururken 2-2-2 gibi
    // tekrarlı dar ayaklar üretebiliyordu. Durum anahtarına iki-at sayısını
    // ekleyerek bu kuralı ortak bütçe optimizasyonunun içinde uygularız.
    const states = new Map();
    states.set('1|0', {product:1, twoLegs:0, score: 0, counts: []});

    let visited = 0, transitions = 0;
    for(let orderedPos=0; orderedPos<ordered.length; orderedPos++){
      const spec = ordered[orderedPos];
      const next = new Map();

      for(const entry of states.values()){
        // Kullanıcının bütçe kuralı öğrenilmiş zor-ayar tabanından önce gelir:
        // her çoklu ayak en az 3 attır. Yalnız 3'ten az bağımsız aday bulunan
        // bir ayakta 2 zorunlu olabilir; bu istisna da kupon genelinde bir kez
        // kullanılabilir. Öğrenilmiş `spec.minCount` daha yüksekse tercih
        // sıralamasını etkiler, fakat 1.000–1.400 TL içinde geçerli planı
        // imkânsızlaştırıp eski 2-2-2 dağılımına geri döndürmez.
        const minMulti=spec.maxCount<3?2:3;
        const counts=[];
        // Yalnız veri havuzu gerçekten iki atla sınırlıysa 2 zorunlu olabilir.
        // Normal durumda 2 seçeneği, toplantının yalnız ilk/tek dar ayağına
        // ayrılmış bir yuva olarak en fazla bir defa açılır.
        if(entry.twoLegs===0 && spec.maxCount>=2 && spec.minCount<=3) counts.push(2);
        for(let cnt = minMulti; cnt <= spec.maxCount; cnt++) counts.push(cnt);
        for(const cnt of counts){
          if((++transitions&127)===0)yield;
          if(cnt===2 && entry.twoLegs>0) continue;
          const product2 = entry.product * cnt;
          if(product2 > high) continue;

          const mass = spec.cum[cnt - 1] || 0;
          if(!mass) continue;

          const score = entry.score + Math.log(Math.max(mass, 1e-12));
          const stateCounts = entry.counts.slice();
          stateCounts[orderedPos] = cnt;

          const twoLegs=entry.twoLegs+(cnt===2?1:0);
          const stateKey=`${product2}|${twoLegs}`;
          const existing = next.get(stateKey);
          if(!existing || score > existing.score + 1e-12){
            next.set(stateKey, {
              product:product2,
              twoLegs,
              score,
              counts: stateCounts
            });
          }
        }
      }

      states.clear();
      for(const [k,v] of next) states.set(k,v);
      visited += 1;
      yield;
    }

    let best = null;
    for(const entry of states.values()){
      const product=entry.product;
      if(product < low || product > high) continue;
      if(!best || entry.score > best.score + 1e-12 || (Math.abs(entry.score-best.score)<1e-12 && product < best.product)){
        best = {product, ...entry};
      }
    }

    if(!best){
      coupon.error = 'TEK ve korunan desteklerle 1.000–1.400 TL içinde dağıtım bulunamadı.';
      coupon.distributionPlan = {status:'infeasible', visited, capped:false};
      return coupon;
    }

    const countByLeg = new Map();
    for(let i=0;i<orderedIndices.length;i++){
      const legIndex = orderedIndices[i];
      countByLeg.set(legIndex, best.counts[i] || Math.max(2, ordered[i]?.minCount || 2));
    }

    for(const spec of specs){
      if(spec.isSingle){
        spec.leg.minCoverage = 1;
        spec.leg.maxCoverage = 1;
        spec.leg.ordered = spec.pool.map(g=>g.h);
      }else{
        const count = countByLeg.get(spec.index) || Math.max(2, spec.minCount);
        const orderedPool = spec.pool.map(g=>g.h);
        const dedupe = [];
        const seen = new Set();
        for(const h of orderedPool){
          const key = horseKey(h);
          if(seen.has(key)) continue;
          seen.add(key);
          dedupe.push(h);
        }
        const limit = Math.max(2, Math.min(count, dedupe.length));
        spec.leg.picks = dedupe.slice(0, limit);
        spec.leg.minCoverage = limit;
        spec.leg.maxCoverage = spec.maxCount;
        spec.leg.ordered = dedupe;
      }

      const count = spec.leg.picks.length;
      const mass = spec.pool.slice(0, count).reduce((sum,row)=>sum + row.p,0);
      spec.leg.distributionPlan = {
        difficulty: spec.difficulty,
        effectiveRivals: spec.effective,
        count,
        estimatedMass: mass,
        reason: spec.isSingle
          ? (spec.leg.singleEligibility?.strong?'Genel Bakış lideri; olasılık, rakip farkı ve TEK güven kontrolünü geçti.':'Genel Bakış liderleri arasında olasılık, rakip farkı ve riskle seçilen göreli TEK; güçlü tek eşiği aşılmadı.')
          : `${role==='main'?'Normal':'Sürpriz'} kupon: ${spec.dominantPair?'iki güçlü lider kümesi · ':''}zorluk ${Math.round(spec.difficulty)}/100 · ${count} at · tahmini kapsama %${Math.round(mass*100)}`
      };
    }

    coupon.combos = best.product;
    coupon.cost = best.product * unit;
    const rule=distributionRule(coupon);
    coupon.distributionPlan = {
      status:'planned', visited, capped:false,
      objective:'tek-dengeli kapsam optimizasyonu', bestProduct:best.product,
      twoHorseLegPolicy:'en fazla bir ayak 2 at; diğer çoklu ayaklar en az 3 at',
      rule
    };
    if(!rule.valid){
      coupon.error='2 atlı ayak en fazla bir tane, diğer çoklu ayaklar en az 3 at olmalı.';
      coupon.distributionPlan.status='infeasible';
    }
    coupon.singleCoveragePlan = {role, singleCount: singles.length};
    return coupon;
  }

  const singlePolicyVersion='R16.93-DISTINCT-SINGLE-LEGS-1';
  const couponRoles=['main','alt','surprise'];
  // Accept both live coupons and persisted snapshots. Race/leg identity, not
  // horse number alone, identifies exposure: horse 1 in two races is different.
  function auditSet(built){
    const used=new Map(),singles={},issues=[];
    for(const role of couponRoles){
      const c=built?.[role];singles[role]=[];
      if(!c||c.error||c.legs?.length!==6){issues.push(role+': eksik veya geçersiz kupon');continue;}
      const legIds=new Set();
      for(const [i,l] of c.legs.entries()){
        const leg=String(l.r?.leg??l.x?.r?.leg??l.leg??i+1);
        if(legIds.has(leg))issues.push(role+': tekrarlanan ayak');legIds.add(leg);
        if(!l.picks?.length)issues.push(role+': boş ayak');
        if(l.picks?.length!==1)continue;
        const h=l.picks[0],no=String(h?.horse_no??h);
        singles[role].push({leg,horseNo:no});
        if(used.has(leg))issues.push(leg+'. ayak TEK tekrarı: '+used.get(leg)+' / '+role);
        else used.set(leg,role);
      }
      if(singles[role].length<1||singles[role].length>2)issues.push(role+': 1–2 TEK gerekli');
    }
    return {version:singlePolicyVersion,valid:issues.length===0,singles,issues};
  }
  function enforceSet(built){
    // Historical tickets are facts, never silently rewritten as new predictions.
    if(couponRoles.some(k=>built?.[k]?.readOnlySnapshot))return built;
    const audit=auditSet(built);
    for(const role of couponRoles){const c=built?.[role];if(!c)continue;
      c.singleSetAudit=audit;
      if(!audit.valid&&!c.error)c.error='Farklı ayaklarda uygun TEK ve bütçe şartını sağlayan üç kupon bulunamadı. '+audit.issues.join('; ');
    }
    return built;
  }
  function* planSetSteps(built){
    if(!built?.main||couponRoles.some(k=>built[k]?.readOnlySnapshot))return built;
    // Legacy callers may request one role only; they do not publish a set of three.
    if(couponRoles.filter(k=>built[k]).length===1){
      const original=built.main,copy={...original,legs:original.legs?.map(l=>({...l,picks:l.picks.slice()}))};
      yield* planWidthsSteps(copy);
      if(!copy.error)built.main=copy;
      else if(original.legs?.length===6&&distributionRule(original).valid&&original.cost>=1000&&original.cost<=1400&&original.legs.every(l=>l.picks.length!==1||singleEligibility(l,l.picks[0],'main').ok))original.distributionPlan={status:'kept_valid_plan',reason:copy.error};
      else built.main=copy;
      return built;
    }
    const proposals=[];
    // Solve the three roles jointly. A soft repetition penalty or independent
    // fallback cannot guarantee distinct singles after budget redistribution.
    for(const role of couponRoles){
      const source=built[role];
      if(!source||source.readOnlySnapshot||source.legs?.length!==6)return enforceSet(built);
      const legs=source.legs.slice().sort((a,b)=>Number(a.r?.leg||0)-Number(b.r?.leg||0));
      const specs=[],eligible=[];
      for(let i=0;i<legs.length;i++){
        specs.push(buildSpec(legs[i],i,coverageRole(role)));
        yield;
      }
      for(const spec of specs){yield;const row=eligibleSingle(spec);if(row)eligible.push({spec,row});}
      const subsets=eligible.map(x=>[x]);
      for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++)
        if(eligible[i].row.strong&&eligible[j].row.strong)subsets.push([eligible[i],eligible[j]]);
      const choices=[];
      for(const subset of subsets){
        yield;
        const selected=new Map(subset.map(x=>[x.spec.index,x.row]));
        const coupon={...source,typeKey:role,error:undefined,policyAudit:undefined,legs:specs.map(spec=>{
          const row=selected.get(spec.index);
          return {...spec.leg,protectedFlag:!!row,
            picks:row?[row.h]:spec.pool.slice(0,Math.max(2,spec.minCount)).map(r=>r.h),
            ordered:spec.pool.map(r=>r.h),minCoverage:row?1:Math.max(2,spec.minCount),maxCoverage:row?1:spec.maxCount,
            singleEligibility:row?{ok:true,leaderNo:normalizeNo(row.h),probability:row.p,gap:row.gap,confidence:row.confidence,strong:row.strong}:null};
        })};
        yield* planWidthsSteps(coupon,{selectedSingles:true});
        if(coupon.error)continue;
        let quality=0;
        for(const spec of specs){
          const keys=new Set(coupon.legs[spec.index].picks.map(horseKey));
          const mass=spec.pool.reduce((sum,row)=>sum+(keys.has(row.key)?row.p:0),0);
          quality+=Math.log(Math.max(1e-12,mass));
        }
        const mask=subset.reduce((m,x)=>m|(1<<x.spec.index),0);
        choices.push({coupon,mask,quality});
      }
      proposals.push(choices);
    }
    let best=null,visited=0;
    for(const a of proposals[0])for(const b of proposals[1]){
      if(a.mask&b.mask)continue;
      for(const c of proposals[2]){
        if((++visited&127)===0)yield;
        if((a.mask|b.mask)&c.mask)continue;
        const quality=a.quality+b.quality+c.quality;
        if(!best||quality>best.quality+1e-12)best={items:[a,b,c],quality};
      }
    }
    if(best){
      couponRoles.forEach((role,i)=>{built[role]=best.items[i].coupon;});
    }else{
      // Only a complete already-valid diversified set can be retained.
      const originalOK=auditSet(built).valid&&couponRoles.every(role=>{
        const c=built[role],cost=c.legs.reduce((p,l)=>p*l.picks.length,Number(c.unit)||0);
        return cost>=1000&&cost<=1400&&distributionRule(c).valid&&c.legs.every(l=>l.picks.length!==1||singleEligibility(l,l.picks[0],role).ok);
      });
      if(!originalOK)for(const role of couponRoles)if(built[role])built[role].error='Farklı ayaklarda uygun TEK ve 1.000–1.400 TL şartını sağlayan üç kupon bulunamadı.';
    }
    return enforceSet(built);
  }

  function chooseSingleLegs(...args){return finishSteps(chooseSingleLegsSteps(...args));}
  function planWidths(...args){return finishSteps(planWidthsSteps(...args));}
  function planSet(...args){return finishSteps(planSetSteps(...args));}
  function optimize(...args){return finishSteps(optimizeSteps(...args));}
  function planSetAsync(built,options={}){return finishStepsAsync(planSetSteps(built),options.pause);}
  function optimizeAsync(built,options={}){return finishStepsAsync(optimizeSteps(built),options.pause);}

  global.TKP_COUPON_COVERAGE = {
    singlePolicyVersion,
    auditSet,
    enforceSet,
    buildSpec,
    unionMass,
    optimize,
    horseKey,
    planSetAsync,
    optimizeAsync,
    planWidths,
    planSet,
    distributionRule,
    singleEligibility
  };
})(typeof window!=='undefined' ? window : globalThis);
