(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)Object.assign(root,api);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const RANGE_COLLECTIONS=['bets','prediction_log','auto_coupon_log','forward_tracking_log','weekly_model_log','v55_diagnostic_log','sidebet_ticket_log','commentator_evidence_log','surprise_cohort_tracking_log','bomb_hunter_shadow_log','changelog'];

  function isoDate(value){
    if(value==null)return '';
    const s=String(value).trim();
    let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
    m=s.match(/^(\d{2})[./](\d{2})[./](\d{4})/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;
    return '';
  }
  function rowDate(row){
    if(!row||typeof row!=='object')return '';
    for(const key of ['race_date','date','created_at','createdAt','ts','updated_at','updatedAt','evaluated_at','recorded_at','started_at']){
      const d=isoDate(row[key]);if(d)return d;
    }
    return '';
  }
  function inRange(date,start,end){return !!date&&date>=start&&date<=end;}
  function meetingNaturalKey(x){return [isoDate(x?.race_date||x?.date),String(x?.hippodrome||x?.hip||x?.city||'').trim().toLocaleUpperCase('tr-TR'),Number(x?.altili_no||x?.altili||1)||1,String(x?.filename||'').trim()].join('|');}
  function raceNaturalKey(x){return [isoDate(x?.race_date||x?.date),String(x?.hippodrome||x?.hip||'').trim().toLocaleUpperCase('tr-TR'),Number(x?.altili_no||x?.altili||1)||1,Number(x?.leg||x?.race_no||0)||0].join('|');}
  function rowIdentity(row,index){
    if(!row||typeof row!=='object')return `primitive|${String(row)}|${index}`;
    for(const key of ['id','uid','snapshot_id','snapshotId','coupon_snapshot_id','couponSnapshotId','record_id','recordId'])if(row[key]!=null&&String(row[key]))return `${key}|${String(row[key])}`;
    return [
      rowDate(row),row.meeting_uid||row.meetingUid||'',row.file_id||row.fileId||'',row.hippodrome||row.hip||row.city||'',
      row.altili_no||row.altili||'',row.leg||row.race_no||'',row.horse_no||row.horseNo||'',row.horse_name||row.horseName||'',
      row.couponKey||row.coupon_key||row.couponType||'',row.betGameType||row.bet_game_type||'',row.model_id||'',row.model_version||'',
      row.source_type||'',row.author_id||'',row.type||'',row.note||''
    ].map(x=>String(x??'')).join('|');
  }
  function relatedToSelection(row,fileIds,meetingUids,start,end){
    const d=rowDate(row);if(inRange(d,start,end))return true;
    const fid=String(row?.file_id??row?.fileId??'');if(fid&&fileIds.has(fid))return true;
    const mid=String(row?.meeting_uid??row?.meetingUid??'');if(mid&&meetingUids.has(mid))return true;
    return false;
  }
  function tkpSelectBackupRange(db,start,end){
    start=isoDate(start);end=isoDate(end);
    if(!start||!end)throw new Error('Başlangıç ve bitiş tarihi gerekli.');
    if(start>end)throw new Error('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
    const allFiles=Array.isArray(db?.files)?db.files:[];
    const allRaces=Array.isArray(db?.races)?db.races:[];
    const raceSeed=allRaces.filter(x=>inRange(isoDate(x?.race_date),start,end));
    const referencedFileIds=new Set(raceSeed.map(x=>String(x?.file_id??'')).filter(Boolean));
    const files=allFiles.filter(x=>inRange(isoDate(x?.race_date),start,end)||referencedFileIds.has(String(x?.id??''))).map(x=>({...x}));
    const fileIds=new Set(files.map(x=>String(x?.id??'')).filter(Boolean));
    const meetingUids=new Set(files.map(x=>String(x?.meeting_uid??x?.meetingUid??'')).filter(Boolean));
    const races=allRaces.filter(x=>inRange(isoDate(x?.race_date),start,end)||fileIds.has(String(x?.file_id??''))).map(x=>({...x,horses:Array.isArray(x?.horses)?x.horses.map(h=>({...h})):[]}));
    for(const r of races){const mid=String(r?.meeting_uid??r?.meetingUid??'');if(mid)meetingUids.add(mid);}
    const out={schema_version:db?.schema_version,files,races};
    for(const key of RANGE_COLLECTIONS){
      out[key]=(Array.isArray(db?.[key])?db[key]:[]).filter(row=>relatedToSelection(row,fileIds,meetingUids,start,end)).map(row=>row&&typeof row==='object'?{...row}:row);
    }
    return out;
  }
  function mergeHorseArrays(existing,incoming){
    const out=(Array.isArray(existing)?existing:[]).map(h=>({...h}));
    const by=new Map(out.map((h,i)=>[String(h?.horse_no??h?.no??h?.horse_name??i),i]));
    for(const h of (Array.isArray(incoming)?incoming:[])){
      const k=String(h?.horse_no??h?.no??h?.horse_name??'');
      if(k&&by.has(k)){const i=by.get(k);out[i]={...out[i],...h};}
      else{by.set(k,out.length);out.push({...h});}
    }
    return out;
  }
  function mergeGenericArray(existing,incoming,idMap){
    const out=(Array.isArray(existing)?existing:[]).map(x=>x&&typeof x==='object'?{...x}:x);
    const by=new Map(out.map((x,i)=>[rowIdentity(x,i),i]));
    let added=0,updated=0;
    for(let n=0;n<(Array.isArray(incoming)?incoming:[]).length;n++){
      let row=incoming[n]&&typeof incoming[n]==='object'?{...incoming[n]}:incoming[n];
      if(row&&typeof row==='object'&&row.file_id!=null&&idMap.has(String(row.file_id)))row.file_id=idMap.get(String(row.file_id));
      const k=rowIdentity(row,n);
      if(by.has(k)){const i=by.get(k);if(row&&typeof row==='object'&&out[i]&&typeof out[i]==='object')out[i]={...out[i],...row};else out[i]=row;updated++;}
      else{by.set(k,out.length);out.push(row);added++;}
    }
    return {rows:out,added,updated};
  }
  function tkpMergeSelectiveBackup(target,incoming){
    const db={...(target||{})};
    const currentFiles=(Array.isArray(target?.files)?target.files:[]).map(x=>({...x}));
    const fileByKey=new Map(currentFiles.map((x,i)=>[meetingNaturalKey(x),i]));
    const idMap=new Map();let addedFiles=0,updatedFiles=0;
    for(const f0 of (Array.isArray(incoming?.files)?incoming.files:[])){
      const f={...f0},k=meetingNaturalKey(f);
      if(fileByKey.has(k)){
        const i=fileByKey.get(k),existing=currentFiles[i],keepId=existing?.id;
        currentFiles[i]={...existing,...f};if(keepId!=null)currentFiles[i].id=keepId;
        if(f?.id!=null&&keepId!=null)idMap.set(String(f.id),keepId);updatedFiles++;
      }else{fileByKey.set(k,currentFiles.length);currentFiles.push(f);if(f?.id!=null)idMap.set(String(f.id),f.id);addedFiles++;}
    }
    db.files=currentFiles;

    const currentRaces=(Array.isArray(target?.races)?target.races:[]).map(r=>({...r,horses:Array.isArray(r?.horses)?r.horses.map(h=>({...h})):[]}));
    const raceByKey=new Map(currentRaces.map((x,i)=>[raceNaturalKey(x),i]));
    let addedRaces=0,updatedRaces=0;
    for(const r0 of (Array.isArray(incoming?.races)?incoming.races:[])){
      const r={...r0,horses:Array.isArray(r0?.horses)?r0.horses.map(h=>({...h})):[]};
      if(r.file_id!=null&&idMap.has(String(r.file_id)))r.file_id=idMap.get(String(r.file_id));
      const k=raceNaturalKey(r);
      if(raceByKey.has(k)){
        const i=raceByKey.get(k),existing=currentRaces[i],keepId=existing?.id,keepFile=existing?.file_id;
        currentRaces[i]={...existing,...r,horses:mergeHorseArrays(existing?.horses,r?.horses)};
        if(keepId!=null)currentRaces[i].id=keepId;
        if(keepFile!=null&&!r.file_id)currentRaces[i].file_id=keepFile;
        updatedRaces++;
      }else{raceByKey.set(k,currentRaces.length);currentRaces.push(r);addedRaces++;}
    }
    db.races=currentRaces;

    const summary={addedFiles,updatedFiles,addedRaces,updatedRaces,collections:{}};
    for(const key of RANGE_COLLECTIONS){
      const merged=mergeGenericArray(target?.[key],incoming?.[key],idMap);db[key]=merged.rows;summary.collections[key]={added:merged.added,updated:merged.updated};
    }
    return {db,summary};
  }
  return {tkpSelectBackupRange,tkpMergeSelectiveBackup,tkpSelectiveIsoDate:isoDate,tkpSelectiveRowDate:rowDate};
});
