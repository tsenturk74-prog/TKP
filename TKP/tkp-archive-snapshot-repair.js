(function(global){
  'use strict';
  var VERSION='R16.63-ARCHIVE-SNAPSHOT-REPAIR';
  var indexes=new WeakMap();
  function numeric(v){if(v==null||String(v).trim()==='')return null;var n=Number(v);return Number.isFinite(n)?n:null;}
  function text(v){return String(v==null?'':v).trim().toLocaleUpperCase('tr-TR');}
  function key(r,h,files){
    var f=files.get(String(r.file_id))||{};
    var date=String(r.race_date||f.race_date||''),hip=text(r.hippodrome||f.hippodrome);
    var alt=numeric(r.altili_no)||numeric(f.altili_no),leg=numeric(r.leg),no=String(h.horse_no||'').trim();
    // Belirsiz altılı veya ayak kimliğinde başka yarıştan skor taşınmaz.
    if(!date||!hip||!alt||!leg||!no)return null;
    return [date,hip,alt,leg,no].join('|');
  }
  function first(h,names){for(var i=0;i<names.length;i++){var v=numeric(h&&h[names[i]]);if(v!==null&&v>=0)return {value:v,field:names[i]};}return null;}
  function index(source){
    var logs=source.prediction_log||[],files=source.files||[],cached=indexes.get(source);
    if(cached&&cached.logs===logs&&cached.files===files&&cached.length===logs.length)return cached;
    var fileMap=new Map(files.map(function(f){return [String(f.id),f];})),byKey=new Map();
    logs.forEach(function(log){
      var id=key(log,log,fileMap);if(!id)return;
      var score=first(log,['prediction_score_snapshot','pre_race_tkp_score','score','predicted_score','tkp_score']);if(!score)return;
      if(!byKey.has(id))byKey.set(id,[]);byKey.get(id).push(log);
    });
    cached={logs:logs,files:files,length:logs.length,fileMap:fileMap,byKey:byKey};indexes.set(source,cached);return cached;
  }
  function matchingLog(source,r,h){
    var idx=index(source),id=key(r,h,idx.fileMap);if(!id)return null;
    var candidates=(idx.byKey.get(id)||[]).filter(function(log){
      if(h.horse_name&&log.horse_name&&text(h.horse_name)!==text(log.horse_name))return false;
      var abs=numeric(r._absRaceNo),other=numeric(log._absRaceNo);
      return abs===null||other===null||abs===other;
    });
    // İlk kayıt tercih edilir; 'PRE_RACE' yazısı tek başına zaman doğrulaması değildir.
    candidates=candidates.slice().sort(function(a,b){return String(a.ts||a.created_at||'9999').localeCompare(String(b.ts||b.created_at||'9999'));});
    return candidates[0]||null;
  }
  function repair(source,r){
    var stats={changed:0,preserved:0,missingScore:0,missingRank:0};
    var rows=(r.horses||[]).filter(function(h){return h&&!h.non_runner&&!h.scratched;});
    var reserved=new Set(rows.map(function(h){return numeric(h.prediction_order_snapshot);}).filter(function(v){return v!==null&&v>0;}));
    rows.forEach(function(h){
      var score=numeric(h.prediction_score_snapshot),rank=numeric(h.prediction_order_snapshot),hasScore=score!==null&&score>=0,hasRank=rank!==null&&Number.isInteger(rank)&&rank>0;
      if(hasScore&&hasRank){stats.preserved++;return;}
      var log=matchingLog(source,r,h),changed=[];
      if(!hasScore){
        // Farklı ölçekli altili_winner_score/sidebet_p1_score TKP yerine geçmez.
        var recovered=first(h,['pre_race_tkp_score','score'])||first(log,['prediction_score_snapshot','pre_race_tkp_score','score','predicted_score','tkp_score']);
        if(recovered){h.prediction_score_snapshot=recovered.value;changed.push('score:'+recovered.field);hasScore=true;}
      }
      if(!hasRank){
        var recoveredRank=first(h,['_strategy_rank','predicted_rank'])||first(log,['prediction_order_snapshot','predicted_rank','common_rank']);
        if(recoveredRank&&Number.isInteger(recoveredRank.value)&&recoveredRank.value>0&&recoveredRank.value<=rows.length&&!reserved.has(recoveredRank.value)){
          h.prediction_order_snapshot=recoveredRank.value;reserved.add(recoveredRank.value);changed.push('rank:'+recoveredRank.field);hasRank=true;
        }
      }
      if(changed.length){
        h.prediction_snapshot_provenance='HISTORICAL_ARCHIVE_RECONSTRUCTED';
        h.prediction_snapshot_verified_pre_race=0;
        h.prediction_score_locked=hasScore?1:0;
        h.historical_snapshot_repair={version:VERSION,fields:changed,originalCaptureTimeVerified:false};
        stats.changed++;
      }
      if(!hasScore)stats.missingScore++;if(!hasRank)stats.missingRank++;
    });
    return stats;
  }
  global.tkpRepairArchivedRaceSnapshot=repair;
  global.TKP_ARCHIVE_SNAPSHOT_REPAIR_VERSION=VERSION;
})(typeof window!=='undefined'?window:globalThis);
