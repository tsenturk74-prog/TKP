(function(global){
  'use strict';

  function fold(v){
    return String(v??'').trim().toLocaleUpperCase('tr-TR')
      .replace(/[İI]/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G')
      .replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C')
      .replace(/[^A-Z0-9]+/g,' ').trim();
  }
  function normalizeSurface(v){
    const x=fold(v);
    if(x.includes('SENT')) return 'SENTETIK';
    if(x.includes('CIM')) return 'CIM';
    if(x.includes('KUM')) return 'KUM';
    return x;
  }
  function broadCondition(v){
    const x=fold(v);
    if(/HANDI?KAP/.test(x)) return 'HANDIKAP';
    if(/MAIDEN/.test(x)) return 'MAIDEN';
    if(/SARTLI/.test(x)) return 'SARTLI';
    if(/SATIS/.test(x)) return 'SATIS';
    if(/\bKV\s*\d/.test(x)) return 'KV';
    if(/\bG\s*\d\b|ACIK/.test(x)) return 'GRUP/ACIK';
    return x;
  }
  function normalizeBreed(v){
    const x=fold(v);
    if(x.includes('ARAP')) return 'ARAP';
    if(x.includes('ING')) return 'INGILIZ';
    return x;
  }
  function profileSignature(r){
    return [
      fold(r?.condition_text||r?.condition_family||''),
      Number(r?.distance)||0,
      normalizeSurface(r?.surface),
      normalizeBreed(r?.breed),
      fold(r?.hippodrome||'')
    ].join('|');
  }
  function hasResult(r){
    return Array.isArray(r?.horses)&&r.horses.some(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  }
  function fieldSize(r){ return Array.isArray(r?.horses)?r.horses.filter(h=>!h?.non_runner).length:0; }
  function dateValue(v){
    const n=Date.parse(String(v||''));
    return Number.isFinite(n)?n:0;
  }
  function score(target,candidate,context={}){
    if(!target||!candidate||!hasResult(candidate)) return 0;
    const targetDate=dateValue(context.targetDate||target.race_date);
    const candidateDate=dateValue(candidate.race_date);
    if(targetDate&&candidateDate&&candidateDate>=targetDate) return 0; // Gelecek bilgisi sızıntısını engelle.

    let total=0;
    const ts=normalizeSurface(target.surface), cs=normalizeSurface(candidate.surface);
    if(ts&&cs&&ts===cs) total+=30; else return 0;

    const td=Number(target.distance)||0, cd=Number(candidate.distance)||0;
    const dd=Math.abs(td-cd);
    if(td&&cd){
      if(dd===0) total+=25;
      else if(dd<=100) total+=22;
      else if(dd<=200) total+=15;
      else if(dd<=300) total+=8;
      else return 0;
    }

    const te=fold(target.condition_text||target.condition_family), ce=fold(candidate.condition_text||candidate.condition_family);
    if(te&&ce&&te===ce) total+=25;
    else if(broadCondition(te)&&broadCondition(te)===broadCondition(ce)) total+=15;
    else return 0;

    const tb=normalizeBreed(target.breed), cb=normalizeBreed(candidate.breed);
    if(tb&&cb&&tb===cb) total+=10;

    if(fold(target.hippodrome)&&fold(target.hippodrome)===fold(candidate.hippodrome)) total+=5;

    const tf=fieldSize(target), cf=fieldSize(candidate);
    if(tf&&cf){
      const fd=Math.abs(tf-cf);
      if(fd<=1) total+=5;
      else if(fd<=3) total+=3;
    }

    if(targetDate&&candidateDate){
      const days=(targetDate-candidateDate)/86400000;
      if(days<=180) total+=5;
      else if(days<=365) total+=4;
      else if(days<=730) total+=2;
    }
    return Math.max(0,Math.min(100,total));
  }
  function resolveRaceDate(r,filesById){
    return r?.race_date||filesById?.get(String(r?.file_id))?.race_date||'';
  }
  function resolveHip(r,filesById){
    return r?.hippodrome||filesById?.get(String(r?.file_id))?.hippodrome||'';
  }
  function findForTarget(target,history,options={}){
    const minScore=Math.max(0,Math.min(100,Number(options.minScore)||80));
    const limit=Math.max(1,Math.min(50,Number(options.limit)||10));
    const targetDate=options.targetDate||target?.race_date||'';
    const filesById=options.filesById||new Map();
    const currentIds=new Set((options.excludeRaceIds||[]).map(String));
    const out=[];
    const seen=new Set();
    for(const raw of Array.isArray(history)?history:[]){
      if(!raw||currentIds.has(String(raw.id))) continue;
      const candidate={...raw,race_date:resolveRaceDate(raw,filesById),hippodrome:resolveHip(raw,filesById)};
      const key=String(candidate.id??[candidate.file_id,candidate.leg,candidate.race_date].join('|'));
      if(seen.has(key)) continue;
      seen.add(key);
      const similarity=score({...target,race_date:targetDate},candidate,{targetDate});
      if(similarity<minScore) continue;
      out.push({race:candidate,score:similarity});
    }
    out.sort((a,b)=>b.score-a.score||dateValue(b.race.race_date)-dateValue(a.race.race_date)||Number(a.race.leg||0)-Number(b.race.leg||0));
    return out.slice(0,limit);
  }
  function findPools(targets,history,options={}){
    const filesById=options.filesById||new Map();
    const exclude=(Array.isArray(targets)?targets:[]).map(r=>r?.id).filter(v=>v!=null);
    return (Array.isArray(targets)?targets:[]).map((target,index)=>{
      const enriched={...target,hippodrome:target?.hippodrome||options.hippodrome||'',race_date:target?.race_date||options.targetDate||''};
      const matches=findForTarget(enriched,history,{...options,filesById,excludeRaceIds:exclude,targetDate:options.targetDate||enriched.race_date});
      return {target:enriched,targetIndex:index,signature:profileSignature(enriched),matches,ready:matches.length>=(Number(options.required)||10)};
    });
  }

  global.TkpSimilarRaceEngine={fold,normalizeSurface,broadCondition,normalizeBreed,profileSignature,hasResult,score,findForTarget,findPools};
})(typeof window!=='undefined'?window:globalThis);
