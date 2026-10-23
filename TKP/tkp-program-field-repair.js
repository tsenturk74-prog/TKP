(function(root,factory){
  const api=factory(root||globalThis);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)Object.assign(root,api);
})(typeof globalThis!=='undefined'?globalThis:this,function(g){
'use strict';
const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/ı/g,'i').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const baseNo=v=>String(v??'').trim().replace(/-E\d+$/i,'');
const validStart=h=>{const n=Number(h?.start_no??h?.st??h?.start??h?.kulvar);return Number.isInteger(n)&&n>0?n:null;};
const trustedSource=h=>/^TJK_PROGRAM/i.test(String(h?.start_no_source||''));
function sameMeetingRace(a,b){
  if(!a||!b)return false;
  if(String(a.race_date||'').slice(0,10)!==String(b.race_date||'').slice(0,10))return false;
  if(fold(a.hippodrome)!==fold(b.hippodrome))return false;
  const aa=Number(a.altili_no||1),ba=Number(b.altili_no||1);if(aa!==ba)return false;
  if(a._absRaceNo!=null&&b._absRaceNo!=null)return Number(a._absRaceNo)===Number(b._absRaceNo);
  return Number(a.leg||0)===Number(b.leg||0);
}
function donorForHorse(race,horse,db){
  const no=baseNo(horse?.horse_no),name=fold(horse?.horse_name);
  const candidates=[];
  for(const r of db?.races||[]){
    if(r===race||!sameMeetingRace(race,r))continue;
    for(const h of r.horses||[]){
      const st=validStart(h);if(!st||!trustedSource(h))continue;
      const noMatch=no&&baseNo(h.horse_no)===no,nameMatch=name&&fold(h.horse_name)===name;
      if(noMatch&&nameMatch)candidates.unshift({h,st,quality:3});
      else if(noMatch)candidates.push({h,st,quality:2});
      else if(nameMatch)candidates.push({h,st,quality:1});
    }
  }
  candidates.sort((a,b)=>b.quality-a.quality);
  if(!candidates.length)return null;
  if(candidates.length>1&&candidates[0].quality===candidates[1].quality&&candidates[0].st!==candidates[1].st)return null;
  return candidates[0];
}
function resolveStartNo(race,horse,db=g.db){
  const direct=validStart(horse);if(direct)return direct;
  const local=(race?.horses||[]).find(h=>h!==horse&&baseNo(h?.horse_no)===baseNo(horse?.horse_no)&&fold(h?.horse_name)===fold(horse?.horse_name)&&validStart(h)&&trustedSource(h));
  if(local)return validStart(local);
  return donorForHorse(race,horse,db)?.st??null;
}
function repairRaceStartNumbers(race,db=g.db){
  if(!race||!Array.isArray(race.horses))return 0;let changed=0;
  for(const h of race.horses){
    if(validStart(h))continue;
    const donor=donorForHorse(race,h,db);if(!donor)continue;
    h.start_no=donor.st;h.start_no_source=String(donor.h.start_no_source||'TJK_PROGRAM_REPAIRED');changed++;
  }
  return changed;
}
function repairMeetingStartNumbers(races,db=g.db){return (races||[]).reduce((n,r)=>n+repairRaceStartNumbers(r,db),0);}
return {tkpResolveStartNo:resolveStartNo,tkpRepairRaceStartNumbers:repairRaceStartNumbers,tkpRepairMeetingStartNumbers:repairMeetingStartNumbers,resolveStartNo,repairRaceStartNumbers,repairMeetingStartNumbers};
});
