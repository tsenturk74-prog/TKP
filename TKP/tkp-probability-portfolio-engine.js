/*
 * TKP — yarış öncesi olasılık portföy katmanı.
 *
 * Benter düzeni: bağımsız TKP modeli ile piyasa olasılığı önce AYRI üretilir,
 * sonra henüz ileri-test ile doğrulanmamış sabit katsayılarla birleştirilir. Bu dosya sonuç / ikramiye
 * / finish alanlarını asla okumaz. Eğitim canlı düğmede çalışmaz; yarış başına
 * önbellekli sabit katsayılar kullanır.
 */
(function(global){
  'use strict';

  var VERSION='V1.1.333-BENTER-CORRECTNESS-R16.63';
  var cache=new WeakMap();

  // Bu katsayılar canlıda yeniden fit edilmez. `tkpBenterFitCoefficients` yalnız
  // zaman sıralı, yarış-öncesi snapshotlarla çevrimdışı doğrulama için sunulur.
  // Bunlar öğrenilmiş optimum katsayılar değildir. Kalibrasyon yalnız çevrimdışı
  // yapılır; doğrulanmamış fit sonucu canlı politikaya kendiliğinden uygulanmaz.
  var BENTER={
    calibrationStatus:'UNVALIDATED_FIXED',
    returnRate:0.85,
    modes:{main:{model:0.82,market:0.84},alt:{model:1.00,market:0.80},surprise:{model:0.90,market:0.82}},
    minNetEdge:0.06,
    strongExtraEdge:0.08,
    maxQuarterKelly:0.02
  };

  var MODELS={
    main:{
      key:'main',label:'Normal',policy:'field',profile:[1,4,4,4,4,5],
      fields:['locked_rank','locked_score','display_score'],
      weights:[0,-0.05035151,-0.15381522,0,0.05035151,0.15421474,0,0.04145051,0.16352647,0]
    },
    alt:{
      key:'alt',label:'Sürpriz',policy:'prob',profile:[2,2,3,3,4,8],
      fields:['agf','agf_rank','gc_tr','hndkp','sp','value','jbyg','jbyg_rate','g800','ypuan','bmb','odb','jockey_win','trainer_win','owner_win','gpr','team','profile','prior_starts','prior_wins','prior_win_rate','prior_surprise_rate','cond_starts','cond_wins','cond_win_rate','cond_surprise_rate'],
      weights:[0,0.04427018,0.18312262,0,-0.04427018,-0.1188316,0,0.01723795,-0.00153579,-0.00054033,0.02160922,0.04412954,0,0.04427018,0.18312262,0,0,0,0,-0.02586232,-0.06817713,-0.00380786,0.01540204,0.02079189,-0.00380786,0.01828023,-0.00669657,-0.03678822,0,0,0,-0.00648187,0.01255571,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.00542545,-0.017463,0,0.01540204,0.02079189,-0.00380786,0,0,0,-0.01035108,-0.02771971,0,-0.00280822,0.0132623,0,-0.00588697,0.002311,0,-0.0152381,0.00764826,0,-0.00164061,-0.00288617,0,-0.00366645,-0.00123631,0,-0.00853,-0.01497171,0,-0.01334865,-0.00378407,0,0,-0.00230963,0]
    },
    surprise:{
      key:'surprise',label:'Uzman + Kulis',policy:'field',profile:[2,2,4,4,4,5],
      fields:['locked_rank','locked_score','display_score','agf','agf_rank','gc_tr','hndkp','sp','value','jbyg','jbyg_rate','g800','ypuan','bmb','odb'],
      weights:[0,-0.01296113,-0.03471922,0,0.01296113,-0.01882874,0,-0.00238705,0.00716801,0,0.03735623,0.17279784,0,-0.03735623,-0.10636485,0,0.01057619,0.00456722,-0.00029972,0.01678401,0.04148095,0,0.03735623,0.17279784,0,0,0,0,-0.02294286,-0.06791389,-0.0088589,0.02345217,0.04207062,-0.0088589,0.01507022,-0.00435158,-0.03078572,0,0,0,-0.00470671,0.00340984,0,0,0,0,0,-0.00318393,0]
    }
  };

  function number(value){
    if(value==null||String(value).trim()==='')return null;
    var n=Number(String(value).replace(',','.'));
    return Number.isFinite(n)?n:null;
  }
  function safeNumber(value,fallback){var n=number(value);return n===null?fallback:n;}
  function text(value){return String(value==null?'':value).trim();}
  function horseNo(horse){return text(horse&&horse.horse_no);}
  function nonRunner(horse){
    try{if(typeof global.isNonRunner==='function')return !!global.isNonRunner(horse);}catch(_){ }
    return !!(horse&&horse.non_runner);
  }
  function active(rows){
    var seen=new Set();
    return (Array.isArray(rows)?rows:[]).filter(function(h){
      if(!h||nonRunner(h)||!horseNo(h)||seen.has(horseNo(h)))return false;
      seen.add(horseNo(h));return true;
    });
  }
  function sourceIsTrustedJbyg(horse){return /^(?:GANYAN_CANAVARI_JBYG|YENIBEYGIR_JBYG_FALLBACK|TJK_PROGRAM_JBYG)$/i.test(text(horse&&horse.jbyg_source));}
  function sourceIsGcTr(horse){return [horse?.tr_ganyan_source,horse?.tr_source].some(source=>/^GANYAN_CANAVARI_TR$/i.test(text(source)));}
  function trustedTrValue(horse){return sourceIsGcTr(horse)?firstNumber(horse,['tr_ganyan','tr_puan','tr']):null;}
  function sourceIsTrustedGlp(horse){return /^(?:GANYAN_CANAVARI_GALOPLAR_OZET|YENIBEYGIR_GLP_FALLBACK|TJK_PROGRAM_GALOP)$/i.test(text(horse&&horse.glp_source));}
  function bounded(value,min,max){
    var n=number(value);
    return n===null||n<min||n>max?null:n;
  }
  function rankSource(horse,baseRanks){
    var value=number(horse&&horse.prediction_order_snapshot);
    if(value===null)value=number(horse&&horse.predicted_rank);
    if(value===null)value=baseRanks.get(horseNo(horse));
    return value;
  }
  function firstNumber(horse,names){
    for(var i=0;i<names.length;i++){
      var value=number(horse&&horse[names[i]]);
      if(value!==null)return value;
    }
    return null;
  }
  function fieldValue(horse,field,baseRanks,modelOnly){
    var starts,wins,hits;
    if(field==='locked_rank')return rankSource(horse,baseRanks);
    if(field==='locked_score')return firstNumber(horse,['prediction_score_snapshot','pre_race_tkp_score','score']);
    if(field==='display_score')return firstNumber(horse,['prediction_tkp_display_score_snapshot','tkp_display_score']);
    if(field==='gc_tr')return trustedTrValue(horse);
    // GC birincildir; yalnız onun boş kaldığı at/ayakta doğrulanmış Yeni Beygir
    // fallback rankı aynı özelliklere katkı verir. Sayfa hatası/bozuk eski kayıt
    // hiçbir zaman 1-7 / 1-6 dışı sahte değerle olasılığı şişiremez.
    if(field==='jbyg')return sourceIsTrustedJbyg(horse)?bounded(firstNumber(horse,['jbyg','j_b_y_g']),0,7):null;
    if(field==='jbyg_rate')return sourceIsTrustedJbyg(horse)?bounded(firstNumber(horse,['jbyg_rate']),0,100):null;
    if(field==='team')return sourceIsTrustedJbyg(horse)?bounded(firstNumber(horse,['team_strength_pct','jbyg_rate']),0,100):null;
    if(field==='g800')return sourceIsTrustedGlp(horse)?bounded(firstNumber(horse,['g800']),1,6):null;
    if(field==='bmb')return safeNumber(horse&&horse.bmb,0)===1&&text(horse&&horse.bmb_source)!=='ŞABLON KURALI'?1:0;
    if(field==='odb')return safeNumber(horse&&horse.odb,0)===1?1:0;
    if(field==='prior_win_rate'){
      starts=number(horse&&horse.priorStarts);wins=number(horse&&horse.priorWins);
      return starts===null||wins===null?null:(wins+1)/(starts+8);
    }
    if(field==='prior_surprise_rate'){
      starts=number(horse&&horse.priorStarts);hits=number(horse&&horse.priorSurpriseHits);
      return starts===null||hits===null?null:(hits+1)/(starts+8);
    }
    if(field==='cond_win_rate'){
      starts=number(horse&&horse.condWinStarts);wins=number(horse&&horse.condWinWins);
      return starts===null||wins===null?null:(wins+1)/(starts+8);
    }
    if(field==='cond_surprise_rate'){
      starts=number(horse&&horse.condWinStarts);hits=number(horse&&horse.condSurpriseHits);
      return starts===null||hits===null?null:(hits+1)/(starts+8);
    }
    // AGF/AGF sıra piyasa bilgisidir. Benter katmanında bu alanın model tarafına
    // yeniden girmesi aynı bilginin iki defa sayılması demektir; bu yüzden model
    // vektöründe bilinçli olarak eksik kabul edilir, piyasa tarafında kullanılır.
    if(modelOnly&&(field==='agf'||field==='agf_rank'))return null;
    var names={
      agf:['agf'],agf_rank:['agf_rank'],hndkp:['hndkp'],sp:['sp'],value:['value_score','value'],ypuan:['ypuan','y_puan'],
      jockey_win:['jockey_win_pct'],trainer_win:['trainer_win_pct'],owner_win:['owner_win_pct'],gpr:['gpr_strength'],profile:['profile_strength_pct'],
      prior_starts:['priorStarts'],prior_wins:['priorWins'],cond_starts:['condWinStarts'],cond_wins:['condWinWins'],
      hist_horse_win:['__hist_horse_win'],hist_horse_top3:['__hist_horse_top3'],hist_jockey_win:['__hist_jockey_win'],hist_jockey_top3:['__hist_jockey_top3'],
      hist_trainer_win:['__hist_trainer_win'],hist_horse_condition_win:['__hist_horse_condition_win'],hist_jockey_track_win:['__hist_jockey_track_win']
    };
    return firstNumber(horse,names[field]||[]);
  }
  function rankAndZ(values){
    var known=values.filter(function(v){return v!==null;});
    var mean=known.length?known.reduce(function(s,v){return s+v;},0)/known.length:0;
    var variance=known.length?known.reduce(function(s,v){return s+(v-mean)*(v-mean);},0)/known.length:0;
    var deviation=Math.sqrt(variance)||1;
    return values.map(function(value){
      if(value===null)return [0,0,1];
      var higher=0,equal=0;
      known.forEach(function(other){if(other>value)higher++;else if(other===value)equal++;});
      var rank=known.length<=1?.5:1-(higher+(equal-1)/2)/(known.length-1);
      var z=Math.max(-4,Math.min(4,(value-mean)/deviation));
      return [rank,z,0];
    });
  }
  function trAvailability(rows){
    var available=rows.filter(function(h){return trustedTrValue(h)!==null;}).length;
    return {available:available,total:rows.length,complete:available===rows.length,none:available===0};
  }
  function vectorize(rows,model,baseRanks,trState){
    var vectors=rows.map(function(){return [1];});
    model.fields.forEach(function(field){
      // TR PUAN bütün ayakta yoksa bu değişkenin tüm katsayıları eşitlenir.
      // Böylece eksik veri negatif sinyal sayılmaz; model diğer kaynaklarla
      // çalışır. Kısmi TR'de yalnız gerçek kaynaklı satırlar katkı verir.
      var coded=rankAndZ(rows.map(function(horse){return field==='gc_tr'&&trState.none?null:fieldValue(horse,field,baseRanks,true);}));
      coded.forEach(function(bits,index){vectors[index]=vectors[index].concat(bits);});
    });
    if(model.fields.indexOf('bmb')>=0||model.fields.indexOf('odb')>=0){
      // BMB/ODB etkileşimi için dışarıda kalmış AGF'nin sırası yalnız "outsider"
      // tanımı olarak kullanılabilir; ham AGF modeli yükseltmez.
      var agf=rows.map(function(horse){return fieldValue(horse,'agf',baseRanks,false);});
      var market=rankAndZ(agf).map(function(bits){return bits[0];});
      rows.forEach(function(horse,index){
        var bmb=fieldValue(horse,'bmb',baseRanks)>0?1:0;
        var odb=fieldValue(horse,'odb',baseRanks)>0?1:0;
        var outsider=1-market[index];
        vectors[index].push(bmb*odb,bmb*outsider,odb*outsider);
      });
    }
    return vectors;
  }
  function baseOrder(race,input,mode){
    var base=input.slice();
    if(mode==='surprise'){
      try{
        if(typeof global.tkpV55ExpertOrderForRace==='function'){
          var expert=active(global.tkpV55ExpertOrderForRace(race,input.slice()));
          if(expert.length)base=expert;
        }
      }catch(_){ }
    }
    return base;
  }
  function signature(rows,base,model){
    return [VERSION,model.key,base.map(horseNo).join(','),rows.map(function(h){
      return [h.sp_is_decimal_odds===true,h.sp_verified_pre_race===true,
      horseNo(h),h.prediction_order_snapshot,h.predicted_rank,h.prediction_score_snapshot,h.prediction_tkp_display_score_snapshot,h.pre_race_tkp_score,h.tkp_display_score,h.score,h.agf,h.agf_rank,h.tr_ganyan,h.tr_puan,h.tr,h.tr_ganyan_source,h.tr_source,h.hndkp,h.sp,h.value_score,h.value,h.jbyg,h.j_b_y_g,h.jbyg_rate,h.jbyg_source,h.g800,h.glp_source,h.ypuan,h.y_puan,h.bmb,h.bmb_source,h.odb,h.jockey_win_pct,h.trainer_win_pct,h.owner_win_pct,h.gpr_strength,h.team_strength_pct,h.profile_strength_pct,h.priorStarts,h.priorWins,h.priorSurpriseHits,h.condWinStarts,h.condWinWins,h.condSurpriseHits,h.__hist_horse_win,h.__hist_horse_top3,h.__hist_jockey_win,h.__hist_jockey_top3,h.__hist_trainer_win,h.__hist_horse_condition_win,h.__hist_jockey_track_win].join(':');}).join(';')].join('|');
  }
  function normalizedShares(values){
    var clean=values.map(function(v){return Number.isFinite(v)&&v>0?v:0;});
    var total=clean.reduce(function(sum,v){return sum+v;},0);
    return total>0?clean.map(function(v){return v/total;}):null;
  }
  function marketProbabilities(rows){
    // AGF, aynı ayakta kamu parasının doğrudan payıdır; bu nedenle oranlardan
    // türetilmiş dolaylı sayıya tercih edilir. Eksikse geçerli SP ters oranı kullanılır.
    // Kısmi piyasa sıfır paya çevrilemez: eksik atı dışlayıp kalanları %100'e
    // ölçeklemek hem olasılığı hem değer hesabını bozar. Tam bir kaynak gerekir.
    var agfValues=rows.map(function(h){return number(h&&h.agf);});
    if(agfValues.every(function(v){return v!==null&&v>0&&v<=100;}))return {values:normalizedShares(agfValues),source:'AGF',coverage:1};
    // ODS'deki çıplak SP sütununun ganyan olduğu kanıtlanmış değildir. Açık
    // ondalık-oran ve yarış-öncesi doğrulaması yoksa piyasa olarak kullanma.
    var oddsValues=rows.map(function(h){var x=number(h&&h.sp);return h.sp_is_decimal_odds===true&&h.sp_verified_pre_race===true&&x!==null&&x>1?1/x:null;});
    if(oddsValues.every(function(v){return v!==null;}))return {values:normalizedShares(oddsValues),source:'SP',coverage:1};
    return {values:rows.map(function(){return 1/rows.length;}),source:'YOK',coverage:0};
  }
  function featureCoverage(horse,model,baseRanks,trState){
    var known=0,total=0;
    model.fields.forEach(function(field){
      if(field==='agf'||field==='agf_rank'||(field==='gc_tr'&&trState.none))return;
      total++;if(fieldValue(horse,field,baseRanks,true)!==null)known++;
    });
    return total?known/total:0;
  }
  function benterDecision(modelProbability,marketProbability,market,coverage,mode){
    if(market.source==='YOK')return {probability:modelProbability,edge:null,status:'PIYASA_YOK',label:'Piyasa verisi yok',bet:false,stakeFraction:0,uncertainty:1};
    var weights=BENTER.modes[mode]||BENTER.modes.main;
    var mp=Math.max(1e-9,modelProbability),kp=Math.max(1e-9,marketProbability);
    // Normalizasyon build() içinde tüm atlarla tamamlanır; burada yalnız ham logit var.
    var raw=weights.model*Math.log(mp)+weights.market*Math.log(kp);
    var uncertainty=0.035+(1-Math.max(0,Math.min(1,coverage)))*0.08+(1-Math.max(0,Math.min(1,market.coverage)))*0.04;
    return {raw:raw,uncertainty:uncertainty};
  }
  function finalizeBenter(row,probability){
    if(row.market.source==='YOK')return {probability:probability,edge:null,status:'PIYASA_YOK',label:'Piyasa verisi yok',bet:false,stakeFraction:0,uncertainty:1,marketSource:'YOK'};
    var marketP=row.marketProbability,decimal=BENTER.returnRate/Math.max(1e-9,marketP);
    var edge=probability*decimal-1,required=BENTER.minNetEdge+row.decision.uncertainty;
    var status='DEGER_YOK',label='Değer yok',bet=false;
    if(edge>=required+BENTER.strongExtraEdge){status='GUCLU_DEGER';label='Güçlü değer';bet=true;}
    else if(edge>=required){status='SINIRDA_DEGER';label='Sınırda değer';bet=true;}
    var profitOdds=Math.max(1e-9,decimal-1);
    var fullKelly=Math.max(0,(probability*decimal-1)/profitOdds);
    return {probability:probability,edge:edge,status:status,label:label,bet:bet,
      stakeFraction:bet?Math.min(BENTER.maxQuarterKelly,fullKelly*.25):0,
      uncertainty:row.decision.uncertainty,marketSource:row.market.source};
  }
  function build(race,input,mode){
    var model=MODELS[mode]||MODELS.main;
    var rows=active(input),base=baseOrder(race,rows,mode);
    if(!rows.length)return [];
    var sig=signature(rows,base,model),bucket=race&&typeof race==='object'?cache.get(race):null;
    if(bucket&&bucket[sig])return materialize(bucket[sig],rows);
    var baseRanks=new Map();base.forEach(function(horse,index){baseRanks.set(horseNo(horse),index+1);});
    var trState=trAvailability(rows);
    var vectors=vectorize(rows,model,baseRanks,trState);
    var raw=vectors.map(function(vector){return vector.reduce(function(sum,value,index){return sum+value*(model.weights[index]||0);},0);});
    var maximum=Math.max.apply(Math,raw);
    var exp=raw.map(function(score){return Math.exp(Math.max(-30,Math.min(30,score-maximum)));});
    var total=exp.reduce(function(sum,value){return sum+value;},0)||1;
    var modelProbability=exp.map(function(value){return value/total;});
    var market=marketProbabilities(rows);
    var decisions=rows.map(function(horse,index){return benterDecision(modelProbability[index],market.values[index],market,featureCoverage(horse,model,baseRanks,trState),mode);});
    var benterMaximum=Math.max.apply(Math,decisions.map(function(d,index){return d.raw===undefined?Math.log(Math.max(1e-9,modelProbability[index])):d.raw;}));
    var benterExp=decisions.map(function(d,index){var s=d.raw===undefined?Math.log(Math.max(1e-9,modelProbability[index])):d.raw;return Math.exp(Math.max(-30,Math.min(30,s-benterMaximum)));});
    var benterTotal=benterExp.reduce(function(sum,value){return sum+value;},0)||1;
    var basePosition=new Map();base.forEach(function(horse,index){basePosition.set(horseNo(horse),index);});
    var scored=rows.map(function(horse,index){
      var p=modelProbability[index];
      var final=finalizeBenter({marketProbability:market.values[index],market:market,decision:decisions[index]},benterExp[index]/benterTotal);
      // Uzman/Kulis taban sırası bağımsız bir yorumcu kanıtıdır. Etkisi küçük ve
      // sınırlıdır; model olasılığını ezmez fakat yakın adaylarda gerçek katkı sağlar.
      var expertTie=0;
      if(mode==='surprise'){
        var at=basePosition.has(horseNo(horse))?basePosition.get(horseNo(horse)):rows.length-1;
        expertTie=.018*(rows.length<=1?1:1-at/(rows.length-1));
      }
      return {horse:horse,marketProbability:market.values[index],raw:raw[index],modelProbability:p,probability:final.probability,final:final,sortScore:Math.log(Math.max(1e-9,final.probability))+expertTie,expertTie:expertTie};
    });
    scored.sort(function(left,right){
      return right.sortScore-left.sortScore||right.probability-left.probability||(typeof TKP_TR_COLLATOR_NUM!=='undefined'?TKP_TR_COLLATOR_NUM.compare(horseNo(left.horse),horseNo(right.horse)):horseNo(left.horse).localeCompare(horseNo(right.horse),undefined,{numeric:true}));
    });
    var ordered=scored.map(function(row,index){
      var original=row.horse;
      row.horse={};
      try{
        row.horse.tkp_probability_model=mode;
        row.horse.tkp_probability_rank=index+1;
        row.horse.tkp_probability=Number(row.probability.toFixed(6));
        row.horse.tkp_probability_score=Number(row.sortScore.toFixed(6));
        row.horse.tkp_model_probability=Number(row.modelProbability.toFixed(6));
        row.horse.tkp_market_probability=Number(row.marketProbability.toFixed(6));
        row.horse.tkp_benter_probability=Number(row.probability.toFixed(6));
        row.horse.tkp_benter_edge=row.final.edge===null?null:Number(row.final.edge.toFixed(6));
        row.horse.tkp_benter_status=row.final.status;
        row.horse.tkp_benter_label=row.final.label;
        row.horse.tkp_benter_market_source=row.final.marketSource;
        row.horse.tkp_benter_tr_mode=trState.none?'TR_YOK_NOTR':(trState.complete?'TR_TAM':'TR_KISMI');
        row.horse.tkp_benter_uncertainty=Number(row.final.uncertainty.toFixed(6));
        row.horse.tkp_benter_stake_fraction=Number(row.final.stakeFraction.toFixed(6));
        row.horse.tkp_benter_calibration_status=BENTER.calibrationStatus;
        row.horse.tkp_benter_edge_estimated=true;
        row.horse.tkp_probability_kulis_tie=Number(row.expertTie.toFixed(6));
      }catch(_){ }
      return {no:horseNo(original),attributes:row.horse};
    });
    if(race&&typeof race==='object'){
      bucket=bucket||{};bucket[sig]=ordered.slice();
      var keys=Object.keys(bucket);if(keys.length>8)delete bucket[keys[0]];
      cache.set(race,bucket);
    }
    return materialize(ordered,rows);
  }
  function materialize(snapshot,rows){
    var byNo=new Map();rows.forEach(function(h){byNo.set(horseNo(h),h);});
    return snapshot.map(function(row){
      var horse=byNo.get(row.no);
      // Eski tüketiciler için girdi alanları güncellenir; dönen atlar ise bağımsız
      // kopyalardır. Sürpriz hesaplanınca eldeki Normal kuponun olasılığı değişmez.
      try{Object.assign(horse,row.attributes);}catch(_){ }
      return Object.assign({},horse,row.attributes);
    });
  }
  function orderForRace(race,pool,mode){
    var input=active(Array.isArray(pool)?pool:(race&&race.horses));
    return build(race,input,MODELS[mode]?mode:'main');
  }
  function probabilitiesForRace(race,pool,mode){
    var ordered=orderForRace(race,pool,mode);
    return ordered.map(function(horse){return {horse:horse,probability:safeNumber(horse.tkp_probability,0),modelProbability:safeNumber(horse.tkp_model_probability,0),marketProbability:safeNumber(horse.tkp_market_probability,0),edge:horse.tkp_benter_edge,status:horse.tkp_benter_status,rank:safeNumber(horse.tkp_probability_rank,0)};});
  }
  // Çevrimdışı zaman-serili kalibrasyon yardımcı fonksiyonu. Girdi satırları
  // {raceId, modelProbability, marketProbability, outcome} biçimindedir ve çağıran
  // tarafından hedef yarıştan daha eski snapshotlarla sınırlandırılmalıdır.
  function fitCoefficients(rows){
    var data=Array.isArray(rows)?rows:[],groups=new Map();
    var invalid=data.some(function(r){
      if(!r||r.raceId==null||text(r.raceId)==='')return true;
      var pm=number(r.modelProbability),pk=number(r.marketProbability),y=number(r.outcome);
      if(pm===null||pk===null||pm<=0||pk<=0||pm>1||pk>1||(y!==0&&y!==1))return true;
      var key=text(r.raceId);if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({pm:pm,pk:pk,y:y});return false;
    });
    var races=Array.from(groups.values());
    if(invalid||races.some(function(group){return group.length<2||group.reduce(function(s,r){return s+r.y;},0)!==1||Math.abs(group.reduce(function(s,r){return s+r.pm;},0)-1)>1e-4||Math.abs(group.reduce(function(s,r){return s+r.pk;},0)-1)>1e-4;}))return {ready:false,reason:'Tam yarış grubu, normalize olasılıklar ve tek kazanan gerekli',count:data.length};
    if(races.length<20)return {ready:false,reason:'En az 20 tam yarış gerekli',count:data.length,races:races.length};
    var best=null;
    for(var ai=4;ai<=14;ai++)for(var bi=4;bi<=14;bi++){
      var a=ai/10,b=bi/10,loss=0;
      races.forEach(function(group){
        var logits=group.map(function(r){return a*Math.log(r.pm)+b*Math.log(r.pk);});
        var max=Math.max.apply(Math,logits),sum=logits.reduce(function(s,v){return s+Math.exp(v-max);},0);
        group.forEach(function(r,i){if(r.y===1)loss+=max+Math.log(sum)-logits[i];});
      });
      loss/=races.length;
      if(!best||loss<best.logLoss)best={model:a,market:b,logLoss:loss};
    }
    return {ready:true,count:data.length,races:races.length,model:best.model,market:best.market,logLoss:best.logLoss,metric:'race_multinomial_log_loss',validation:'TRAINING_ONLY',applied:false};
  }
  function invalidate(){cache=new WeakMap();}

  global.TKP_PROBABILITY_PORTFOLIO_VERSION=VERSION;
  global.TKP_PROBABILITY_PORTFOLIO_MODELS=MODELS;
  global.TKP_BENTER_POLICY=BENTER;
  global.tkpProbabilityPortfolioOrderForRace=orderForRace;
  global.tkpProbabilityPortfolioProbabilities=probabilitiesForRace;
  global.tkpBenterFitCoefficients=fitCoefficients;
  global.tkpInvalidateProbabilityPortfolio=invalidate;
  if(global.addEventListener)global.addEventListener('tkp:db-changed',invalidate);
})(typeof window!=='undefined'?window:globalThis);
