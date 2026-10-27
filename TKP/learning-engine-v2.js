/**
 * learning-engine-v2.js
 *
 * Tahmin 1-5, kupon kapsamı ve yan bahis için ortak özellik kayıt sistemi.
 * Mevcut veri şeması ve eski fonksiyon imzaları korunur.
 */

const TKP_LEARNING_MODEL_VERSION = 'R16.57_17_SIGNAL_DECISION_POLICY_R16.55_ALL_OFFICIAL_RESULTS_LEARNING_20260904';
// KÖK FIX (2026-08-12): degree (DRC) sinyaline özel 3x adaptif öğrenme çarpanı
// kaldırıldı (bkz. stats-engine.js:adaptiveWeightsForRace). Gerçek prediction_log
// verisinde V37 -> V40/V41 döneminde bu çarpanla birlikte top-1 isabetinin
// %34,3 -> %22,2 düştüğü doğrulandı. Versiyon etiketi bu düzeltmeyi ayırt etmek
// ve gelecekte "düzeltme öncesi (V41) vs sonrası (V43)" karşılaştırması yapabilmek
// için bump edildi.
const TKP_SIDE_BET_STRATEGY_VERSION = 'R15.6-V46-CHAMPION-CLEAN509-REGULARIZED-SIDEBET';
const TKP_FEATURE_REGISTRY = new Map();
const _tkpPurposeWeightCache = new Map();
const _tkpLearnedCoverageCache = new Map();
// KÖK ÇÖZÜM ("Yan Bahisler 14 saniye açılmadı"): tkpLearnedCoverageCount'un en pahalı
// kısmı (winnerRanks -- profil eşleşen 250'ye kadar geçmiş yarışı tarayıp her birini
// TAM adaptif motorla (historicalOrder) puanlamak) mode'dan (main/alt/surprise) TAMAMEN
// BAĞIMSIZDIR; yalnız son adımdaki quantile hedefi mode'a göre değişir. Eskiden dış
// önbellek anahtarı mode'u da içerdiği için AYNI ayak 3 farklı mode için sorulunca bu
// pahalı tarama 3 KERE tekrarlanıyordu. Şimdi tarama sonucu (winnerRanks) mode'suz ayrı
// bir önbellekte tutuluyor; mode'a göre değişen ucuz adım her seferinde tazeden hesaplanır.
const _tkpWinnerRanksCache = new Map();
const _tkpAllOfficialResultPolicyCache = new Map();
const _tkpAllOfficialResultRankCache = new Map();
const _tkpCustomFeatureStatsCache = new Map();
let _tkpHistoricalSideBetOrderCache = new WeakMap();
let _tkpAltiliWinnerOrderCache = new WeakMap();
let _tkpSideBetPositionRankingsCache = new WeakMap();
let _tkpFinalRankOrderCache = new WeakMap();
let _tkpProductSideBetRankingsCache = new WeakMap();
const _tkpCouponStructureCache = new Map();
// Kupon şekli için tek öğrenme sözleşmesi. İlk 15 çekirdek sinyal, programın
// güncel puan omurgasıdır; SONUÇ (yarış-öncesi ODS puanı) ve J-BYG ile birlikte
// karar katmanında tam 17 parametre değerlendirilir. X/kulis bu ortak modele
// bilerek girmez: yalnız Uzman + Kulis sırasının kendi, ayrı kanıt katmanıdır.
const TKP_DECISION_17_FEATURE_KEYS=Object.freeze([
  'tkp','agf','condition','history','last6','profile','extra','bmb','rules',
  'ypuan','kg','degree','ganyan_tr','accurate','st','sonuc','jbyg'
]);
const _tkpDecisionPolicyCache=new Map();

// Ganyan Canavari TR is a separately owned historical layer.  The legacy `tr`
// column is an ODS/AGF-era field and must never be promoted into this signal.
function tkpLearningGcTrValue(horse){
  const sources=[horse?.tr_ganyan_source,horse?.tr_source].map(v=>String(v??'').trim().toUpperCase());
  if(!sources.includes('GANYAN_CANAVARI_TR'))return NaN;
  for(const raw of [horse?.tr_ganyan,horse?.tr_puan]){
    if(raw==null||String(raw).trim()==='')continue;
    const value=Number(String(raw).replace(',','.'));if(Number.isFinite(value)&&value>0)return value;
  }
  return NaN;
}

let _tkpFrozenWinnerRankIndex={signature:'',byRace:new Map()};
function _tkpFrozenRaceKey(date,hippodrome,altiliNo,leg){
  const hip=typeof fold==='function'?fold(hippodrome||''):String(hippodrome||'').toLocaleUpperCase('tr-TR');
  return [String(date||''),hip,Number(altiliNo)||1,Number(leg)||0].join('|');
}
// R16.58 KÖK FIX (hız darboğazı): tkpFrozenPreRaceWinnerRank her koşu için
// dosyasını (db.files||[]).find(...) ile DOĞRUSAL taratıyordu. Bu fonksiyon
// tkpAllOfficialResultRank -> tkpAllResultCouponPolicy zincirinden arşivdeki
// TÜM öğrenilebilir koşular için tek tek çağrılıyor; sonuç O(koşu × dosya)
// karesel maliyetti (büyük arşivde saniyeler değil dakikalar sürüyordu).
// Aşağıdaki id->dosya indeksi bir kez kurulup db revision'ına göre önbelleğe
// alınır; arama O(1)'e iner.
let _tkpFileByIdIndexCache={db:null,files:null,fileCount:-1,revision:-1,map:new Map()};
function _tkpFileByIdIndex(sourceDb){
  const files=Array.isArray(sourceDb?.files)?sourceDb.files:[];
  let revision=0;
  if(sourceDb===db){try{revision=typeof _tkpDbRevision!=='undefined'?(Number(_tkpDbRevision)||0):0;}catch(_e){revision=0;}}
  if(_tkpFileByIdIndexCache.db===sourceDb&&_tkpFileByIdIndexCache.files===files
    &&_tkpFileByIdIndexCache.fileCount===files.length&&_tkpFileByIdIndexCache.revision===revision){
    return _tkpFileByIdIndexCache.map;
  }
  const map=new Map();
  for(const f of files){if(f&&f.id!=null)map.set(String(f.id),f);}
  _tkpFileByIdIndexCache={db:sourceDb,files,fileCount:files.length,revision,map};
  return map;
}
function _tkpBuildFrozenWinnerRankIndex(){
  const rows=Array.isArray(db?.prediction_log)?db.prediction_log:[];
  const last=rows.length?rows[rows.length-1]:null;
  const signature=[rows.length,last?.ts||'',db?.files?.length||0].join('|');
  if(_tkpFrozenWinnerRankIndex.signature===signature) return _tkpFrozenWinnerRankIndex.byRace;
  const byRace=new Map();
  for(const row of rows){
    const rank=Number(row?.predicted_rank);
    if(!Number.isFinite(rank)||rank<1) continue;
    if(!(Number(row?.winner)===1||Number(row?.finish_position)===1)) continue;
    // Tommy'nin açık veri politikası: resmî sonucu bulunan her koşu öğrenmeye
    // dahildir. Log zamanının yarış gününden sonra yazılmış olması, gerçek arşiv
    // kaydını eleme gerekçesi değildir. Sonuç yalnız kazanan sırasını ölçmek için
    // kullanılır; bu fonksiyon tahmin sırasını değiştirmez ya da sonuçla puan üretmez.
    const key=_tkpFrozenRaceKey(row?.race_date,row?.hippodrome,row?.altili_no,row?.leg);
    const old=byRace.get(key);
    if(!old||String(row?.ts||'')>=String(old.ts||'')) byRace.set(key,{rank,ts:row?.ts||''});
  }
  _tkpFrozenWinnerRankIndex={signature,byRace};
  return byRace;
}
function tkpFrozenPreRaceWinnerRank(race){
  if(!race) return 0;
  const fileId=String(race?.file_id??'');
  const file=_tkpFileByIdIndex(db).get(fileId)||{};
  const altiliNo=Number(race?.altili_no)||Number(file?.altili_no)||1;
  const logged=_tkpBuildFrozenWinnerRankIndex().get(_tkpFrozenRaceKey(race?.race_date||file?.race_date,race?.hippodrome||file?.hippodrome,altiliNo,race?.leg));
  if(logged?.rank>0) return logged.rank;

  const winner=(race?.horses||[]).find(h=>Number(h?.winner)===1||Number(h?.finish_position)===1);
  if(!winner) return 0;
  // Eski kayıtta günlük yoksa yalnız yarış öncesinde kilitlenmiş snapshot alanları
  // kullanılır. Yarışın kendi Accurate/finish/official_time değerleri bu hızlı
  // kapsama öğrenmesine hiçbir noktada girmez.
  const rows=(race?.horses||[]).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h))).slice();
  const savedRank=horse=>{
    const direct=Number(horse?.prediction_order_snapshot??horse?.predicted_rank_snapshot);
    return Number.isFinite(direct)&&direct>0?direct:null;
  };
  rows.sort((left,right)=>{
    const lr=savedRank(left),rr=savedRank(right);
    if(lr!==null||rr!==null) return (lr??999)-(rr??999);
    const ls=Number(left?.prediction_score_snapshot??left?.pre_race_tkp_score??left?.score)||0;
    const rs=Number(right?.prediction_score_snapshot??right?.pre_race_tkp_score??right?.score)||0;
    return rs-ls||(Number(left?.agf_rank)||999)-(Number(right?.agf_rank)||999)||
      TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no||''),String(right?.horse_no||''));
  });
  return rows.findIndex(h=>String(h?.horse_no)===String(winner?.horse_no))+1;
}

function registerTkpFeature(definition){
  if(!definition || !definition.key || typeof definition.value!=='function'){
    throw new Error('Geçersiz özellik tanımı.');
  }
  const predictionBase=Number(definition.basePrediction);
  const sideBetBase=Number(definition.baseSideBet);
  TKP_FEATURE_REGISTRY.set(String(definition.key),{
    label:String(definition.label||definition.key),
    // R16.37: 0 gerçek bir politika değeridir (örn. x_kulis yalnız gölge kayıt).
    // `Number(x)||1` açık sıfırı 1'e çevirip sinyali istemeden modele sokuyordu.
    basePrediction:Number.isFinite(predictionBase)?predictionBase:1,
    baseSideBet:Number.isFinite(sideBetBase)?sideBetBase:(Number.isFinite(predictionBase)?predictionBase:1),
    source:String(definition.source||'core'),
    value:definition.value,
    requiredFields:Array.isArray(definition.requiredFields)?definition.requiredFields.slice():[]
  });
}

function tkpFeatureValue(race,horse,key){
  const feature=TKP_FEATURE_REGISTRY.get(key);
  if(!feature) return 0;
  const value=Number(feature.value(race,horse));
  return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
}

function _tkpRegisterBuiltInFeatures(){
  const labels=typeof ADAPTIVE_LABELS==='object'?ADAPTIVE_LABELS:{};
  const base=typeof ADAPTIVE_BASE_WEIGHTS==='object'?ADAPTIVE_BASE_WEIGHTS:{};
  const fields={
    tkp:['score'],
    agf:['agf','agf_rank'],
    condition:['condition_family','condition_text'],
    history:['priorWins','priorStarts'],
    last6:['son6_raw'],
    profile:['horse_name'],
    extra:['result_rank','agf_rank'],
    bmb:['bmb'],
    rules:['value_score','result_score','hndkp','s_value','g800'],
    ypuan:['ypuan'],
    kg:['weight_kg'],
    degree:['best_time','last_result_time','priorAccurateAvgSpeed'],
    ganyan_tr:['tr_ganyan','tr_puan','tr_ganyan_rank'],
    accurate:['priorAccurateAvgSpeed'],
    st:['start_no']
  };
  for(const key of Object.keys(base)){
    registerTkpFeature({
      key,
      label:labels[key]||key,
      basePrediction:base[key],
      baseSideBet:base[key],
      source:'core',
      requiredFields:fields[key]||[],
      value:(r,h)=>{
        if(key==='ganyan_tr'&&!Number.isFinite(tkpLearningGcTrValue(h)))return 0;
        return typeof adaptiveSignalValue==='function'?adaptiveSignalValue(r,h,key):0;
      }
    });
  }

  const liveRows=race=>typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race?.horses||[]).filter(horse=>!isNonRunner(horse));
  const rankValue=(race,horse,rankField,rawField,direction='higher')=>{
    const rows=liveRows(race);
    const rank=tkpNumericScalar(horse?.[rankField]);
    if(Number.isFinite(rank)&&rank>=1){
      return Math.max(0,1-(rank-1)/Math.max(1,rows.length-1));
    }
    // Number(null) / Number('') => 0 dönüşümü eksik alanları sahte veri yapıyordu.
    // Yerleşik zenginleştirme sinyallerinde de auto-table ile aynı güvenli scalar
    // kuralını kullan; eksik veri 0 puan değildir, ilgili at için veri yoktur.
    const values=rows.map(item=>tkpNumericScalar(item?.[rawField])).filter(Number.isFinite);
    const current=tkpNumericScalar(horse?.[rawField]);
    if(!Number.isFinite(current)||!values.length) return 0;
    const min=Math.min(...values),max=Math.max(...values);
    if(max<=min) return 0.5;
    const normalized=(current-min)/(max-min);
    return direction==='lower'?1-normalized:normalized;
  };
  const extras=[
    {key:'sonuc',label:'SONUÇ Puanı',base:20,fields:['result_score','result_rank'],value:(r,h)=>rankValue(r,h,'result_rank','result_score','lower')},
    {key:'jbyg',label:'J-BYG',base:16,fields:['jbyg','j_byg','jbyg_rate','jbyg_rank','j_byg_rank','team_strength_rank','team_strength_pct','team_rank','jockey_trainer_rank','jokey_antrenor_rank'],value:(r,h)=>rankValue(r,h,'jbyg','jbyg_rate','higher')},
    {key:'g800',label:'400G / 800G',base:14,fields:['g800','g800_rank','galop_rank','glp_rank','workout_800','workout_600','workout_400','glp_raw'],value:(r,h)=>rankValue(r,h,'g800','g800','lower')},
    {key:'hndkp',label:'HNDKP',base:14,fields:['hndkp','hndkp_rank'],value:(r,h)=>rankValue(r,h,'hndkp_rank','hndkp','higher')},
    {key:'s',label:'S Değeri',base:10,fields:['s_value'],value:(r,h)=>{
      const value=Number(h?.s_value);
      if(!Number.isFinite(value)) return 0;
      if(value>=38&&value<=41) return 1;
      if(value>=35&&value<=44) return 0.60;
      return 0;
    }},
    {key:'value',label:'VALUE',base:16,fields:['value_score','value_rank'],value:(r,h)=>rankValue(r,h,'value_rank','value_score','higher')},
    {key:'sp',label:'SP',base:10,fields:['sp','sp_rank'],value:(r,h)=>rankValue(r,h,'sp_rank','sp','higher')}
    // ODS fiziksel satır düzeni ayrı ve düşük ağırlıklı bir yardımcı sinyaldir.
    // TR veya başka bir puanın yerine geçmez; arşiv öğrenmesi fayda göstermiyorsa
    // adaptif ağırlık doğal olarak küçülür.
    ,{key:'ods_order',label:'ODS Satır Sırası',base:4,fields:['ods_row_order'],value:(r,h)=>rankValue(r,h,'ods_row_order','ods_row_order','lower')}
    ,{key:'accurate_tempo',label:'Accurate Geçmiş Güveni',base:8,fields:['priorAccurateStarts'],value:(r,h)=>Number(h?.priorAccurateStarts)>0?rankValue(r,h,'priorAccurateStartsRank','priorAccurateStarts','higher'):0}
    ,{key:'accurate_finish',label:'Geçmiş Accurate Bitiriş',base:12,fields:['priorAccurateFinishSignal'],value:(r,h)=>rankValue(r,h,'priorAccurateFinishRank','priorAccurateFinishSignal','higher')}
    // Legacy X fields are retained only for diagnostics/migration.  They must
    // never enter the shared learner: a raw post or an old persisted force flag
    // cannot move Normal/Sürpriz rankings, odds decisions or a coupon single.
    ,{key:'x_kulis',label:'X / Twitter Kulis (gölge kayıt)',base:0,fields:[],value:()=>0}
    ,{key:'gpr',label:'G.PR',base:16,fields:['gpr_strength','gpr_starts','gpr_wins','condWinStarts','condWinWins','priorStarts','priorWins'],value:(r,h)=>{
      const direct=Number(h?.gpr_strength);
      if(Number.isFinite(direct)&&direct>=0) return Math.max(0,Math.min(1,direct));
      const starts=Math.max(0,Number(h?.condWinStarts)||Number(h?.priorStarts)||0);
      const wins=Math.max(0,Number(h?.condWinWins)||Number(h?.priorWins)||0);
      return starts>0?Math.max(0,Math.min(1,wins/starts)):0;
    }}
    // KÖK FIX (2026-08-23): Ayrı 'odb' anahtarı KALDIRILDI -- ADAPTIVE_BASE_WEIGHTS'teki
    // 'extra' anahtarı zaten 'ODB' etiketiyle kayıtlıydı (bkz. ADAPTIVE_LABELS) ve
    // registerTkpFeature() döngüsü altında otomatik olarak TKP_FEATURE_REGISTRY'ye
    // ekleniyordu; adaptiveSignalValue()'daki 'extra' case'i artık isOdbCandidate()
    // kullandığı için (bkz. stats-engine.js KÖK FIX) bu ikinci 'odb' kaydı birebir
    // aynı bilgiyi (üstelik X-tag/Y.PUAN karışımıyla bulanıklaştırılmış haliyle)
    // ikinci kez üretiyordu -- "Ayrıntılı Analiz" tablosunda iki ayrı "ODB" satırı
    // görünmesinin sebebiydi. Kullanıcı tanımı yalnızca isOdbCandidate() mantığını
    // (AGF ilk 6 değil + SONUÇ ilk 6 değil + BMB almamış + geçmiş kazanma kanıtı)
    // kapsadığından, X-tag (h.odb) ve Y.PUAN-tail (_ypuanOdbTail) bileşenleri de
    // bilerek bırakıldı -- zaten mevcut kural "Y.PUAN ODB'yi ne kurar ne engeller"
    // ve "X/Twitter verisi yalnız Uzman+Kulis'i etkiler, genel TKP/kupon skorunu
    // etkilemez" ilkeleriyle uyumluydu; TKP_FEATURE_REGISTRY'nin genel puanlamaya
    // giren bir anahtarına X/Y.PUAN karıştırmak bu ilkeyi ihlal ederdi.
  ];
  for(const extra of extras){
    if(TKP_FEATURE_REGISTRY.has(extra.key)) continue;
    registerTkpFeature({
      key:extra.key,label:extra.label,basePrediction:extra.base,baseSideBet:extra.base,source:'enrichment',
      requiredFields:extra.fields,value:extra.value
    });
  }
}
_tkpRegisterBuiltInFeatures();


const _tkpNormalizedTableFieldKeyCache=new Map();
const _tkpTableFieldExclusionCache=new Map();
// R16.37 veri denetimi: yalnız gerçek sayısal skalar değerler öğrenilebilir.
// JS Number('') / Number([]) / Number(null) => 0 yaptığı için eski keşif, boş metin,
// boş dizi ve bazı metadata alanlarını sahte sıfır olarak modele kaydediyordu.
function tkpNumericScalar(value){
  if(typeof value==='number') return Number.isFinite(value)?value:NaN;
  if(typeof value!=='string') return NaN;
  const text=value.trim();
  if(!text||text==='-') return NaN;
  // Türkçe ondalık metinleri kabul et; karma metinleri (BMB, jokey adı vb.) reddet.
  const normalized=(text.includes(',')&&!text.includes('.'))?text.replace(',','.'):text;
  const n=Number(normalized);
  return Number.isFinite(n)?n:NaN;
}
function tkpIsNumericScalar(value){ return Number.isFinite(tkpNumericScalar(value)); }
function tkpNormalizeTableFieldKey(key){
  const raw=String(key||'');
  if(_tkpNormalizedTableFieldKeyCache.has(raw))return _tkpNormalizedTableFieldKeyCache.get(raw);
  const value=raw.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLocaleLowerCase('tr-TR');
  _tkpNormalizedTableFieldKeyCache.set(raw,value);return value;
}
function tkpAllTableFieldExclusionReason(key,value){
  if(!key || !tkpIsNumericScalar(value)) return 'non_numeric';
  return tkpTableFieldNameExclusionReason(key);
}
// Field-name classification is independent of the current horse's value.
// Callers that already parsed a number need not parse the same value again.
function tkpTableFieldNameExclusionReason(key){
  const k=tkpNormalizeTableFieldKey(key);
  if(_tkpTableFieldExclusionCache.has(k))return _tkpTableFieldExclusionCache.get(k);
  let reason='';
  if(/^_/.test(k)) reason='internal';
  // R16.37: model girdisi olmayan yardımcı/alias/derived alanları otomatik keşiften
  // kesin dışla. Bunların bazıları aynı kanıtı ikinci/üçüncü kez sayıyor, bazıları ise
  // yalnız UI/açıklama/proxy metadata'sı.
  else if(/^(?:why|glp_proxy|jbyg_proxy|x_kulis_score|x_ypuan_delta)$/i.test(k)) reason='diagnostic_or_proxy';
  else if(/^expert_/i.test(k)) reason='ypuan_component';
  else if(/^(?:tr|tr_rank)$/i.test(k)) reason='legacy_agf_alias';
  else if(/^(?:value_raw|star_value|galop_drc_contra)$/i.test(k)) reason='derived_or_duplicate';
  else if(/^(?:cond_win_pct|cond_surprise_hits|prior_surprise_hits|tr_bmb_candidate|tr_hidden_fav|tr_profile_score)$/i.test(k)) reason='derived_or_no_lift';
  // Sonuçtan sonra oluşan etiketler/model çıktıları eğitime hedef olarak kalır; canlı
  // tahmine girdi olarak sızamaz. SONUÇ puanı/rankı ayrı pre-race tablo alanıdır, o
  // yüzden result_score/result_rank bilinçli olarak DIŞLANMAZ.
  else if(/(?:^|_)(winner|finish_position|finish_pos|result_position|tjk_result|official|payout|dividend|resolved|resolved_at)(?:$|_)/i.test(k)) reason='result_label';
  else if((/(?:^|_)result_time(?:$|_)/i.test(k)&&!/^last_result_time$/.test(k))||/^result_time$/.test(k)) reason='result_label';
  // Accurate'ın yarıştan sonra gelen mevcut koşu ölçüleri hedef/analiz verisidir.
  // Yalnız priorAccurate* alanları kronolojik geçmişten üretilmiş tahmin girdisidir.
  else if(/^accurate_/.test(k)&&!/^prior_accurate_/.test(k)) reason='current_race_result';
  else if(/(?:prediction_log|coupon|cost|unit|budget|odeme|ikramiye|net|roi)/i.test(k)) reason='bet_or_log';
  else if(/(?:snapshot|locked|display_raw|display_score|legacy_score|common_evidence)/i.test(k)) reason='derived_output';
  else if(/^(?:tr_ganyan_score|ganyan_canavari_tr_score|tr_score)$/.test(k)) reason='derived_output';
  else if(/^(?:adaptive_position|online_hybrid_rank|sidebet_|side_bet_|altili_|v\d+_backtest_|backtest_|pre_race_tkp_score|pre_result_score|sidebet_target_position|best_lb)/i.test(k)) reason='derived_output';
  else if(/^x_(?:base|final|tkp|ypuan|break|kulis_schema)/i.test(k)) reason='derived_x_output';
  else if(/(?:^|_)(created_at|updated_at|ts|id|file_id|race_no|leg|altili_no|horse_no|at_no|saddle_no|schema_version|date|name|label|source|comments|key|group)(?:$|_)/i.test(k)) reason='identifier_or_text';
  _tkpTableFieldExclusionCache.set(k,reason);return reason;
}
function tkpAllTableFieldIsLearnable(key,value){
  return tkpAllTableFieldExclusionReason(key,value)==='';
}
function tkpFeatureRegistryCoversField(key){
  return [...TKP_FEATURE_REGISTRY.values()].some(feature=>(feature?.requiredFields||[]).includes(key));
}

function tkpAllTableFieldDirection(key){
  const k=String(key||'').toLocaleLowerCase('tr-TR');
  if(/(?:rank|sira|sıra|kulvar|start_no|g800|g400|galop|kg|weight|derece|time|fark|gap)/i.test(k)) return 'lower';
  return 'higher';
}

function tkpAllTableFieldLabel(key){
  return String(key||'')
    .replace(/^(?:signal_|feature_)/i,'')
    .replace(/_/g,' ')
    .replace(/([a-zçğıöşü])/g,m=>m.toLocaleUpperCase('tr-TR'));
}

function tkpAllTableFieldBaseWeight(key,count){
  const k=String(key||'').toLocaleLowerCase('tr-TR');
  let w=2;
  if(/(?:score|puan|pct|rate|strength|guc|güç|value|agf|tr|jbyg|hndkp|sp|ypuan|accurate|prior|cond|gpr)/i.test(k)) w=3;
  if(/(?:rank|sira|sıra|start|kg|weight|g800|g400|galop)/i.test(k)) w=2.5;
  if(/(?:bmb|odb|flag|signal|candidate|is_)/i.test(k)) w=1.75;
  if(count>=1000) w+=0.75; else if(count>=300) w+=0.40;
  return Math.max(0.5,Math.min(5,w));
}

function tkpDiscoverAdditionalFeatures(sourceDb=db){
  if(!sourceDb) return [];
  const settings=sourceDb.settings&&typeof sourceDb.settings==='object'?sourceDb.settings:{};
  const configured=Array.isArray(settings.algorithm_features)?settings.algorithm_features:[];
  const definitions=new Map();

  for(const item of configured){
    if(typeof item==='string'){
      definitions.set(item,{key:item,label:item,weight:2,direction:'higher',source:'manual'});
    }else if(item&&item.key){
      definitions.set(String(item.key),{
        key:String(item.key),
        label:String(item.label||item.key),
        weight:Math.max(0.1,Number(item.weight)||2),
        direction:item.direction==='lower'?'lower':'higher',
        source:'manual'
      });
    }
  }

  const races=typeof learningEligibleRaces==='function'?learningEligibleRaces(sourceDb):[];
  const observed=new Map();
  const fieldReasons=new Map();
  for(const race of races){
    for(const horse of (race.horses||[])){
      for(const key of Object.keys(horse||{})){
        let reason=fieldReasons.get(key);
        if(reason===undefined){reason=key?tkpTableFieldNameExclusionReason(key):'non_numeric';fieldReasons.set(key,reason);}
        if(reason||!tkpIsNumericScalar(horse[key])) continue;
        observed.set(key,(observed.get(key)||0)+1);
      }
    }
  }
  for(const [key,count] of observed){
    // Bir alan yerleşik bir sinyalin requiredFields listesinde zaten temsil
    // ediliyorsa ikinci kez auto feature olarak eklenip ağırlığı şişiremez.
    if(count<8 || definitions.has(key) || TKP_FEATURE_REGISTRY.has(key) || tkpFeatureRegistryCoversField(key)) continue;
    definitions.set(key,{
      key,
      label:tkpAllTableFieldLabel(key),
      weight:tkpAllTableFieldBaseWeight(key,count),
      direction:tkpAllTableFieldDirection(key),
      source:'auto_table',
      count
    });
  }

  const added=[];
  // Varsayılan durumda bütün güvenli sayısal tablo alanları kayda alınır. Yalnız
  // kullanıcı açıkça pozitif bir sınır verdiyse o sınır uygulanır.
  const configuredMaxAuto=Number(settings.max_auto_table_features);
  const maxAuto=Number.isFinite(configuredMaxAuto)&&configuredMaxAuto>0?configuredMaxAuto:Infinity;
  const ordered=[...definitions.values()].sort((a,b)=>(a.source==='manual'?0:1)-(b.source==='manual'?0:1)||(Number(b.count)||0)-(Number(a.count)||0)||TKP_TR_COLLATOR.compare(String(a.key),String(b.key)));
  let autoAdded=0;
  for(const definition of ordered){
    // These raw aliases are owned by the provenance-gated ganyan_tr feature.
    // Registering either as a manual/auto field would bypass the source check.
    if(/^(?:tr_ganyan|tr_puan)$/i.test(String(definition.key||'')))continue;
    if(TKP_FEATURE_REGISTRY.has(definition.key)) continue;
    if(definition.source==='auto_table' && autoAdded>=maxAuto) continue;
    registerTkpFeature({
      key:definition.key,
      label:definition.label,
      basePrediction:definition.source==='auto_table'?Math.max(0.5,definition.weight*.55):definition.weight,
      baseSideBet:definition.source==='auto_table'?Math.max(0.5,definition.weight*.55):definition.weight,
      source:definition.source,
      requiredFields:[definition.key],
      value:(race,horse)=>{
        const rows=(race?.horses||[]).filter(item=>!(typeof isNonRunner==='function'&&isNonRunner(item)));
        const values=rows.map(item=>tkpNumericScalar(item?.[definition.key])).filter(Number.isFinite);
        const current=tkpNumericScalar(horse?.[definition.key]);
        if(!Number.isFinite(current)||!values.length) return 0;
        const unique=[...new Set(values.map(v=>Math.round(v*1e9)/1e9))];
        if(unique.length===2 && unique.every(v=>v===0||v===1)) return Math.max(0,Math.min(1,current));
        const min=Math.min(...values),max=Math.max(...values);
        if(max<=min) return 0.5;
        const normalized=(current-min)/(max-min);
        return definition.direction==='lower'?1-normalized:normalized;
      }
    });
    if(definition.source==='auto_table') autoAdded++;
    added.push(definition.key);
  }
  if(sourceDb.learning_state&&typeof sourceDb.learning_state==='object'){
    sourceDb.learning_state.auto_table_features=added.slice();
    sourceDb.learning_state.auto_table_feature_count=added.length;
    sourceDb.learning_state.auto_table_feature_updated_at=new Date().toISOString();
  }
  return added;
}

function tkpAutoTableFeatureKeys(){
  return [...TKP_FEATURE_REGISTRY.keys()].filter(key=>{
    const f=TKP_FEATURE_REGISTRY.get(key);
    return f && Array.isArray(f.requiredFields) && f.requiredFields.length===1 && f.requiredFields[0]===key && tkpAllTableFieldIsLearnable(key,1);
  });
}

// Eksik kaynak/alan atı düşürmez. Özellik yarışta mevcut olsa bile ilgili atın
// satırında veri yoksa o özellik yalnız o at için paydadan çıkarılır; 0 puan gibi
// işlenmez. Böylece eksik galop, ST, HNDKP veya TR PUAN başka kaynaklardan gelen
// gerçek sinyalleri yapay olarak bastırmaz.
function tkpFeaturePresentForHorse(race,horse,key){
  const present=value=>tkpIsNumericScalar(value);
  const presentText=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&String(value).trim()!=='-';
  if(key==='ganyan_tr')return Number.isFinite(tkpLearningGcTrValue(horse));
  if(key==='degree'){
    const prior=tkpNumericScalar(horse?.priorAccurateAvgSpeed);
    if(Number.isFinite(prior)&&prior>0)return true;
    const sec=typeof tkpHorseBestTimeSeconds==='function'?tkpHorseBestTimeSeconds(horse):null;
    return Number.isFinite(sec)&&sec>0;
  }
  if(key==='accurate'||key==='accurate_max'){
    const prior=tkpNumericScalar(horse?.priorAccurateAvgSpeed);return Number.isFinite(prior)&&prior>0;
  }
  if(key==='accurate_tempo'){
    const starts=tkpNumericScalar(horse?.priorAccurateStarts);return Number.isFinite(starts)&&starts>0;
  }
  if(key==='accurate_finish')return tkpIsNumericScalar(horse?.priorAccurateFinishSignal);
  const horseFields={
    tkp:['score'],agf:['agf','agf_rank'],ypuan:['ypuan'],kg:['weight_kg','kg','weight'],
    degree:['best_time','priorAccurateAvgSpeed'],ganyan_tr:['tr_ganyan','tr_puan','tr_ganyan_rank'],
    accurate:['priorAccurateAvgSpeed'],
    st:['start_no','st','start','kulvar'],history:['priorStarts','priorWins'],
    last6:['son6_raw'],profile:['horse_name'],bmb:['bmb'],
    extra:['result_rank','agf_rank','bmb'],rules:['value_score','result_score','hndkp','s_value','g800'],
    condition:[]
  };
  if(key==='condition')return ['condition_family','condition_text','condition','race_name','race_type'].some(field=>presentText(race?.[field]));
  if(key==='profile')return presentText(horse?.horse_name);
  if(key==='last6')return presentText(horse?.son6_raw);
  if(key==='jbyg')return ['jbyg','j_byg','jbyg_rank','j_byg_rank','team_strength_rank','team_strength_pct','team_rank','jbyg_rate'].some(field=>present(horse?.[field]));
  if(key==='g800')return ['g800','g800_rank','galop_rank','workout_800','workout_400','workout_600'].some(field=>present(horse?.[field]));
  if(key==='hndkp')return ['hndkp','hndkp_rank','handicap','hp'].some(field=>present(horse?.[field]));
  if(key==='s')return ['s_value','s'].some(field=>present(horse?.[field]));
  if(key==='tr')return false; // legacy h.tr/h.tr_rank = AGF compatibility alias; learner'a girmez
  if(key==='value')return ['value_score','value_rank','value'].some(field=>present(horse?.[field]));
  if(key==='sp')return ['sp','sp_rank'].some(field=>present(horse?.[field]));
  const fields=horseFields[key]||TKP_FEATURE_REGISTRY.get(key)?.requiredFields||[];
  return fields.length?fields.some(field=>present(horse?.[field])):true;
}

function tkpTableFeatureAudit(sourceDb=db){
  const races=typeof learningEligibleRaces==='function'?learningEligibleRaces(sourceDb):[];
  const observed=new Map(),excluded=new Map(),fieldReasons=new Map();let horses=0,observations=0;
  for(const race of races){
    for(const horse of (race?.horses||[])){
      horses++;
      for(const key of Object.keys(horse||{})){
        if(!tkpIsNumericScalar(horse[key]))continue;
        let reason=fieldReasons.get(key);
        if(reason===undefined){reason=key?tkpTableFieldNameExclusionReason(key):'non_numeric';fieldReasons.set(key,reason);}
        if(reason){const old=excluded.get(key)||{key,count:0,reason};old.count++;excluded.set(key,old);continue;}
        observed.set(key,(observed.get(key)||0)+1);observations++;
      }
    }
  }
  const covered=new Set();
  for(const [featureKey,feature] of TKP_FEATURE_REGISTRY){
    if(observed.has(featureKey))covered.add(featureKey);
    for(const field of (feature?.requiredFields||[]))if(observed.has(field))covered.add(field);
  }
  const eligible=[...observed.entries()].filter(([,count])=>count>=8).sort((a,b)=>TKP_TR_COLLATOR.compare(String(a[0]),String(b[0])));
  const missing=eligible.filter(([key])=>!covered.has(key)).map(([key,count])=>({key,count}));
  return {
    races:races.length,horses,observations,eligibleFields:eligible.length,
    coveredFields:eligible.length-missing.length,registeredFeatures:TKP_FEATURE_REGISTRY.size,
    observedNumericFields:observed.size+excluded.size,
    fields:eligible.map(([key,count])=>({key,count,covered:covered.has(key)})),missing,
    excluded:[...excluded.values()].sort((a,b)=>TKP_TR_COLLATOR.compare(String(a.key),String(b.key)))
  };
}

function tkpAutoTableCompositeScore(race,horse,purpose='prediction',position=1,model=null){
  const keys=tkpAutoTableFeatureKeys();
  if(!keys.length) return null;
  const learned=model||tkpPurposeWeightsForRace(race,purpose,position);
  let total=0,weight=0;
  for(const key of keys){
    const w=Number(learned?.weights?.[key])||0;
    if(w<=0) continue;
    if(!tkpFeaturePresentForHorse(race,horse,key)) continue;
    const v=tkpFeatureValue(race,horse,key);
    total+=w*v; weight+=w;
  }
  return weight>0?Math.max(0,Math.min(1,total/weight)):null;
}

function tkpTableFeatureSignatureForHorse(horse){
  const keys=tkpAutoTableFeatureKeys();
  if(!keys.length||!horse) return '';
  return keys.map(key=>{const v=tkpNumericScalar(horse?.[key]);return Number.isFinite(v)?`${key}:${Math.round(v*1000)/1000}`:'';}).filter(Boolean).join(',');
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpAutoTableFeatureKeys=tkpAutoTableFeatureKeys;
  globalThis.tkpAutoTableCompositeScore=tkpAutoTableCompositeScore;
  globalThis.tkpTableFeatureSignatureForHorse=tkpTableFeatureSignatureForHorse;
  globalThis.tkpTableFeatureAudit=tkpTableFeatureAudit;
}

function tkpFeatureStatsForRace(targetRace,key,adaptiveStats=null){
  if(adaptiveStats&&adaptiveStats[key]) return adaptiveStats[key];
  const signature=db?.learning_state?.dataset_signature
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):String((db?.races||[]).length));
  const profile=typeof adaptiveCacheKey==='function'?adaptiveCacheKey(targetRace):'ALL';
  const cacheKey=[signature,profile,key].join('|');
  if(_tkpCustomFeatureStatsCache.has(cacheKey)) return _tkpCustomFeatureStatsCache.get(cacheKey);

  // P1/Altılı kök hız düzeltmesi: Eski uygulama kayıt sistemindeki her özellik
  // için adaptiveRaceRows() havuzunu baştan kuruyor ve sort karşılaştırıcısında
  // aynı atın feature değerini defalarca hesaplıyordu. 503 toplantıda bu yol ilk
  // kuponu onlarca saniye tutabiliyordu. Bir profilin eksik bütün özellikleri artık
  // tek tarihsel geçişte hazırlanır; at başına değer yalnız bir kez hesaplanır.
  let rows=[];
  try{
    rows=typeof adaptiveRaceRows==='function'
      ? adaptiveRaceRows(targetRace).rows
      : (typeof learningEligibleRaces==='function'?learningEligibleRaces():[]);
  }catch(_){ rows=[]; }
  const keys=[...TKP_FEATURE_REGISTRY.keys()].filter(featureKey=>!(adaptiveStats&&adaptiveStats[featureKey]));
  const results=new Map();
  const empty=()=>({p1:{ok:0,total:0},p2:{ok:0,total:0},p3:{ok:0,total:0},p4:{ok:0,total:0},p5:{ok:0,total:0}});
  for(const featureKey of keys){
    const featureCacheKey=[signature,profile,featureKey].join('|');
    if(!_tkpCustomFeatureStatsCache.has(featureCacheKey))results.set(featureKey,empty());
  }
  if(!results.size) return _tkpCustomFeatureStatsCache.get(cacheKey)||empty();
  const sameActual=(horse,target)=>String(horse?.horse_no)===String(target?.horse_no)||(typeof sameEkuri==='function'&&sameEkuri(horse?.horse_no,target?.horse_no));
  for(const race of rows){
    const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race.horses||[]).filter(horse=>!isNonRunner(horse));
    const actualByPos={};
    for(let position=1;position<=5;position++)actualByPos[position]=live.filter(horse=>Number(horse.finish_position)===position||(position===1&&Number(horse.winner)===1));
    if(!actualByPos[1].length)continue;
    for(const [featureKey,out] of results){
      const eligible=live.filter(horse=>tkpFeaturePresentForHorse(race,horse,featureKey));
      if(!eligible.length)continue;
      const eligibleSet=new Set(eligible);
      const values=new Map();
      for(const horse of eligible)values.set(horse,tkpFeatureValue(race,horse,featureKey));
      const ordered=eligible.slice().sort((left,right)=>(values.get(right)||0)-(values.get(left)||0)
        || (typeof TKP_TR_COLLATOR_NUM!=='undefined'?TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no||''),String(right?.horse_no||'')):String(left?.horse_no||'').localeCompare(String(right?.horse_no||''))));
      for(let position=1;position<=5;position++){
        const targets=actualByPos[position].filter(target=>eligibleSet.has(target));
        if(!targets.length||ordered.length<position)continue;
        const predicted=ordered[position-1],predictedValue=values.get(predicted);
        let tieCount=0;for(const candidate of eligible){if(values.get(candidate)===predictedValue)tieCount++;}
        if(tieCount!==1)continue;
        const bucket=out[`p${position}`];bucket.total++;
        if(predicted&&targets.some(target=>sameActual(predicted,target)))bucket.ok++;
      }
    }
  }
  for(const [featureKey,out] of results){
    for(const bucketKey of ['p1','p2','p3','p4','p5']){
      const bucket=out[bucketKey];bucket.rawRate=bucket.total?bucket.ok/bucket.total:0;bucket.rate=(bucket.ok+2)/(bucket.total+4);
    }
    _tkpCustomFeatureStatsCache.set([signature,profile,featureKey].join('|'),out);
  }
  return _tkpCustomFeatureStatsCache.get(cacheKey)||empty();
}

function tkpLearningResultCount(sourceDb=db){
  if(!sourceDb || !Array.isArray(sourceDb.races)) return 0;
  let count=0;
  for(const race of sourceDb.races){
    if((race.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1)) count++;
  }
  return count;
}

function tkpEnsureLearningState(){
  if(!db) return false;
  db.learning_state=db.learning_state&&typeof db.learning_state==='object'?db.learning_state:{};
  const state=db.learning_state;
  // HIZ KİLİDİ: loadDB/saveDB kalıcı dataset_signature'ı zaten tutuyor. Aynı
  // imzada açılışta X öğrenmesi + feature keşfi + tüm sonuç sayımı tekrar yapılmaz.
  const persistedSig=String((typeof _lastLearningDatasetSignature!=='undefined'&&_lastLearningDatasetSignature)||state.dataset_signature||'');
  const signature=persistedSig || (typeof learningDatasetSignature==='function'
    ? learningDatasetSignature(db)
    : `${(db.races||[]).length}|${tkpLearningResultCount(db)}`);
  const needsRefresh=state.model_version!==TKP_LEARNING_MODEL_VERSION || !state.dataset_signature || state.dataset_signature!==signature;
  if(needsRefresh){
    try{if(typeof window!=='undefined'&&typeof window.tkpLearnXKulisFromResults==='function')window.tkpLearnXKulisFromResults();}catch(_){ }
    tkpDiscoverAdditionalFeatures(db);
  }
  const resultCount=needsRefresh?tkpLearningResultCount(db):Number(state.result_count||0);
  const now=new Date().toISOString();
  let changed=false;

  if(state.model_version!==TKP_LEARNING_MODEL_VERSION){
    state.model_version=TKP_LEARNING_MODEL_VERSION;
    state.migrated_at=state.migrated_at||now;
    changed=true;
  }

  if(!state.dataset_signature){
    state.dataset_signature=signature;
    state.result_count=resultCount;
    state.last_checked_at=now;
    state.status=resultCount?'GÜNCEL':'VERİ AZ';
    changed=true;
  }else if(state.dataset_signature!==signature){
    state.previous_signature=state.dataset_signature;
    state.dataset_signature=signature;
    state.result_count=resultCount;
    state.updated_at=now;
    state.last_checked_at=now;
    state.status='GÜNCELLENDİ';
    changed=true;
    tkpInvalidateLearningModelCaches();
  }else{
    state.result_count=resultCount;
    state.last_checked_at=state.last_checked_at||now;
    state.status=resultCount?'GÜNCEL':'VERİ AZ';
  }
  // V55.2 — Kontrollü otomatik öğrenme mimarisi kaydı.
  // Champion P1 ve holdout doğrulanmış %30 Challenger payı sabit omurgadır;
  // yeni sonuçlar yalnız alt sıralama/kupon/TEK/yan-bahis ağırlıklarını günceller.
  const policy={
    version:'V55.2-CHAMPION-CHALLENGER-TOMMY-HYBRID',
    champion_p1_locked:true,
    validated_challenger_share:0.30,
    validated_scope:'P2-P5',
    bh_rescue:'P5_MAX1',
    odb_rescue:'P6_HARD_RACE_MAX1',
    altili_coupon_engine:'TOMMY_HYBRID_DYNAMIC_COVERAGE',
    surprise_independent:true,
    expert_kulis_shadow:true,
    sidebet_router:'C-S-S-C-S',
    auto_update:true,
    update_source:'PRE_RACE_SNAPSHOT_PLUS_OFFICIAL_RESULT',
    same_race_feedback:false,
    max_single_penalty:TKP_FAILURE_MAX_SINGLE_PENALTY,
    max_horse_boost:TKP_FAILURE_MAX_HORSE_BOOST,
    min_failure_rows:TKP_FAILURE_MIN_DONE,
    min_failure_misses:TKP_FAILURE_MIN_MISSES
  };
  const oldPolicy=state.adaptive_policy||{};
  if(JSON.stringify(oldPolicy)!==JSON.stringify(policy)){
    state.adaptive_policy=policy;
    state.policy_updated_at=now;
    changed=true;
  }
  return changed;
}

function tkpAdaptivePolicyStatus(){
  const state=db?.learning_state||{};
  const failure=typeof tkpFailureLearningModel==='function'?tkpFailureLearningModel(null):null;
  return {
    ...(state.adaptive_policy||{}),
    result_count:Number(state.result_count)||tkpLearningResultCount(db),
    dataset_signature:state.dataset_signature||'',
    failure_rows:Number(failure?.rows)||0,
    failure_main_miss:Number(failure?.mainMiss)||0,
    failure_single_loss:Number(failure?.singleLoss)||0,
    status:state.status||'GÜNCEL'
  };
}
if(typeof globalThis!=='undefined') globalThis.tkpAdaptivePolicyStatus=tkpAdaptivePolicyStatus;

function tkpLearningStatus(){
  if(!db) return {status:'VERİ AZ',resultCount:0,updatedAt:''};
  const state=db.learning_state||{};
  return {
    status:state.status||'GÜNCEL',
    resultCount:Number(state.result_count)||tkpLearningResultCount(db),
    updatedAt:state.updated_at||state.migrated_at||'',
    signature:state.dataset_signature||''
  };
}


// V51 — KAÇIRMA / TEK HATASI GERİ-BESLEME KATMANI
// Kaynak yalnız forward_tracking_log içindeki yarış-öncesi snapshot + sonradan gelen resmi sonuçtur.
// Hedef yarış tarihi verilirse yalnız daha ESKİ kayıtlar kullanılır; böylece backtest/forward testte
// aynı yarışın veya geleceğin sonucundan sızıntı oluşmaz. Tek bir sonuç ağırlığı zıplatmasın diye
// minimum örnek, Beta yumuşatma, destek eşiği ve küçük/bounded düzeltme uygulanır.
const _tkpFailureLearningCache=new Map();
const TKP_FAILURE_MIN_DONE=1; // V1.1.305: 20 yarış zorunluluğu kaldırıldı
const TKP_FAILURE_MIN_MISSES=8;
const TKP_FAILURE_SIGNAL_SUPPORT=4;
const TKP_FAILURE_MAX_HORSE_BOOST=8;
const TKP_FAILURE_MAX_SINGLE_PENALTY=8;

function tkpFailureIsoDate(v){
  const s=String(v||'').trim();
  const m=s.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if(!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
}
function tkpFailureSameHorse(a,b){
  const x=String(a??'').trim(),y=String(b??'').trim();
  if(!x||!y) return false;
  if(x===y) return true;
  try{return typeof sameEkuri==='function'&&sameEkuri(x,y);}catch(_){return false;}
}
function tkpFailureFlagsFromSnapshot(s){
  if(!s) return {};
  const rank=Number(s.rank)||0,agf=Number(s.agf_rank)||0,hnd=Number(s.hndkp_rank)||0,jb=Number(s.jbyg_rank)||0,g8=Number(s.g800)||0,tr=Number(s.tr_ganyan_rank)||0;
  return {
    agf69:agf>=6&&agf<=9,
    hndkp3:hnd>0&&hnd<=3,
    jbyg3:(jb>0&&jb<=3)||Number(s.jbyg_signal)===1,
    g8003:(g8>0&&g8<=3)||Number(s.galop_signal)===1,
    tr3:tr>0&&tr<=3,
    value:Number(s.value)>0||Number(s.value_signal)===1,
    bmb:Number(s.bmb)===1,
    odb:Number(s.odb)===1,
    prof60:Number(s.prof)>=60,
    tail58:rank>=5&&rank<=8
  };
}
function tkpFailureFlagsFromHorse(race,h){
  if(!h) return {};
  let prof=0;try{prof=typeof profileStrengthPct==='function'?Number(profileStrengthPct(race,h))||0:0;}catch(_){ }
  const agf=Number(h.agf_rank)||0,hnd=Number(h.hndkp_rank)||0,jb=Number(h.jbyg_rank??h.j_beygir_rank??h.jbyg)||0,g8=Number(h.g800_rank??h.g800)||0,tr=Number(h.tr_ganyan_rank)||0;
  let odb=false;try{odb=typeof isOdbCandidate==='function'&&isOdbCandidate(h,race);}catch(_){ }
  return {
    agf69:agf>=6&&agf<=9,
    hndkp3:hnd>0&&hnd<=3,
    jbyg3:jb>0&&jb<=3,
    g8003:g8>0&&g8<=3,
    tr3:tr>0&&tr<=3,
    value:Number(h.value_score??h.value??h.VALUE)>0,
    bmb:Number(h.bmb)===1,
    odb:!!odb,
    prof60:prof>=60,
    tail58:false
  };
}
function tkpFailurePreRaceRows(rec){
  if(Array.isArray(rec?.pre_race_candidates)&&rec.pre_race_candidates.length) return rec.pre_race_candidates;
  // V51 güvenli tarihsel seed: eski forward kayıtların Strategy Lab snapshotı sonuçtan ÖNCE
  // alınmıştı. P1-P5 + hunter sinyallerini at numarasıyla birleştir; sonuç alanı okunmaz.
  const snap=rec?.strategy_lab?.snapshot;
  if(!snap) return [];
  const byNo=new Map();
  const ensure=(row,no)=>{
    const key=String(no??'').trim();if(!key)return null;
    if(!byNo.has(key))byNo.set(key,{horse_no:key,horse_name:'',rank:null,agf_rank:null,hndkp_rank:null,jbyg_rank:null,g800:null,tr_rank:null,value:null,bmb:0,odb:0,prof:null,jbyg_signal:0,galop_signal:0,value_signal:0});
    return byNo.get(key);
  };
  for(const row of (snap.p1p5||[])){
    const out=ensure(row,row?.horse_no);if(!out)continue;
    out.horse_name=row?.horse_name||out.horse_name;out.rank=Number(row?.rank)||out.rank;
  }
  for(const row of (snap.signals||[])){
    const out=ensure(row,row?.horse_no);if(!out)continue;
    out.horse_name=row?.horse_name||out.horse_name;out.rank=Number(row?.base_rank)||out.rank;out.agf_rank=Number(row?.agf_rank)||out.agf_rank;out.prof=Number(row?.prof)||out.prof;
    const tags=(row?.tags||[]).map(x=>String(x||'').toLocaleUpperCase('tr-TR'));
    if(tags.some(x=>x.includes('BMB')))out.bmb=1;
    if(tags.some(x=>x.includes('ODB')))out.odb=1;
    if(tags.some(x=>x.includes('J-BYG')))out.jbyg_signal=1;
    if(tags.some(x=>x.includes('GALOP')||x.includes('800G')))out.galop_signal=1;
    if(tags.some(x=>x.includes('VALUE')))out.value_signal=1;
  }
  return Array.from(byNo.values());
}
function tkpFailureTrackingRows(targetRace){
  const rows=Array.isArray(db?.forward_tracking_log)?db.forward_tracking_log:[];
  const target=tkpFailureIsoDate(targetRace?.race_date||targetRace?.date||'');
  return rows.filter(rec=>{
    if(!rec?.evaluated_at||!String(rec?.winner_no||'').trim()) return false;
    const d=tkpFailureIsoDate(rec.race_date||'');
    if(target&&d&&d>=target) return false;
    return tkpFailurePreRaceRows(rec).length>0;
  });
}
function tkpFailureLearningModel(targetRace=null){
  const target=tkpFailureIsoDate(targetRace?.race_date||targetRace?.date||'')||'LIVE';
  const log=db?.forward_tracking_log;
  const revision=typeof _tkpDbRevision==='number'?_tkpDbRevision:0;
  const lastRecord=Array.isArray(log)?log[log.length-1]:null;
  const signature=[target,revision,log?.length||0,lastRecord?.evaluated_at||'',db?.settings?.backtest_snapshot_revision||0].join('|');
  const cachedEntry=_tkpFailureLearningCache.get('READY:'+signature);
  if(cachedEntry&&cachedEntry.log===log)return cachedEntry.model;
  const rows=tkpFailureTrackingRows(targetRace);
  const last=rows.length?String(rows[rows.length-1]?.evaluated_at||''):'';
  const key=[target,rows.length,last].join('|');

  const signals=['agf69','hndkp3','jbyg3','g8003','tr3','value','bmb','odb','prof60','tail58'];
  const agg={};for(const k of signals)agg[k]={missWith:0,hitWith:0};
  let mainMiss=0,mainHit=0,singleLoss=0,singleHit=0;
  const singleAgg={};for(const k of signals)singleAgg[k]={lossWith:0,hitWith:0};
  for(const rec of rows){
    const pre=tkpFailurePreRaceRows(rec);
    const winner=pre.find(z=>tkpFailureSameHorse(z?.horse_no,rec.winner_no));
    if(!winner) continue;
    const wf=tkpFailureFlagsFromSnapshot(winner);
    let mainOutcome=Number.isFinite(Number(rec.main_hit))?Number(rec.main_hit):null;
    if(mainOutcome==null){
      const picks=Array.isArray(rec?.coupons?.main)?rec.coupons.main:[];
      if(picks.length)mainOutcome=picks.some(no=>tkpFailureSameHorse(no,rec.winner_no))?1:0;
    }
    if(mainOutcome===0){mainMiss++;for(const k of signals)if(wf[k])agg[k].missWith++;}
    else if(mainOutcome===1){mainHit++;for(const k of signals)if(wf[k])agg[k].hitWith++;}
    if(Number(rec.single_reliable)===1){
      if(Number(rec.single_hit)===0){singleLoss++;for(const k of signals)if(wf[k])singleAgg[k].lossWith++;}
      else if(Number(rec.single_hit)===1){singleHit++;for(const k of signals)if(wf[k])singleAgg[k].hitWith++;}
    }
  }
  const ready=rows.length>=TKP_FAILURE_MIN_DONE&&mainMiss>=TKP_FAILURE_MIN_MISSES;
  const weights={};
  for(const k of signals){
    const a=agg[k];
    const missRate=(a.missWith+1)/(mainMiss+2);
    const hitRate=(a.hitWith+1)/(mainHit+2);
    const support=a.missWith+a.hitWith;
    const trust=(support/(support+8))*(rows.length/(rows.length+24)); // sürekli güven; sert 20 örnek kapısı yok
    const delta=ready&&a.missWith>=TKP_FAILURE_SIGNAL_SUPPORT?Math.max(0,missRate-hitRate)*trust:0;
    weights[k]={...a,missRate,hitRate,support,boost:Math.min(2.2,delta*18)};
  }
  const singleReady=rows.length>=TKP_FAILURE_MIN_DONE&&singleLoss>=6;
  const singleWeights={};
  for(const k of signals){
    const a=singleAgg[k];
    const lossRate=(a.lossWith+1)/(singleLoss+2);
    const hitRate=(a.hitWith+1)/(singleHit+2);
    const support=a.lossWith+a.hitWith;
    const trust=Math.min(1,support/16)*Math.min(1,rows.length/80);
    const delta=singleReady&&a.lossWith>=3?Math.max(0,lossRate-hitRate)*trust:0;
    singleWeights[k]={...a,lossRate,hitRate,support,penalty:Math.min(2.3,delta*18)};
  }
  const model={version:'V51_FAILURE_FEEDBACK',rows:rows.length,mainMiss,mainHit,singleLoss,singleHit,ready,singleReady,weights,singleWeights};
  _tkpFailureLearningCache.set('READY:'+signature,{log,model});
  while(_tkpFailureLearningCache.size>32)_tkpFailureLearningCache.delete(_tkpFailureLearningCache.keys().next().value);
  return model;
}
function tkpFailureLearningHorseBoost(race,horse){
  const model=tkpFailureLearningModel(race);
  if(!model.ready||!horse) return 0;
  const flags=tkpFailureFlagsFromHorse(race,horse);
  let boost=0;for(const [k,on] of Object.entries(flags))if(on)boost+=Number(model.weights?.[k]?.boost)||0;
  return Math.max(0,Math.min(TKP_FAILURE_MAX_HORSE_BOOST,boost));
}
function tkpFailureLearningSingleRisk(race,first,pool){
  const model=tkpFailureLearningModel(race);
  if(!model.singleReady||!first) return {active:false,penalty:0,horse:null,reasons:[],sample:model.singleLoss};
  const rivals=(pool||race?.horses||[]).filter(h=>h&&String(h.horse_no)!==String(first.horse_no)&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
  let best=null,bestPenalty=0,bestReasons=[];
  for(const h of rivals){
    const flags=tkpFailureFlagsFromHorse(race,h);let p=0,reasons=[];
    for(const [k,on] of Object.entries(flags)){
      if(!on)continue;const v=Number(model.singleWeights?.[k]?.penalty)||0;if(v>0){p+=v;reasons.push(k);}
    }
    p=Math.min(TKP_FAILURE_MAX_SINGLE_PENALTY,p);
    if(p>bestPenalty){bestPenalty=p;best=h;bestReasons=reasons;}
  }
  return {active:bestPenalty>=1.5,penalty:bestPenalty,horse:best,reasons:bestReasons,sample:model.singleLoss,model};
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpFailureLearningModel=tkpFailureLearningModel;
  globalThis.tkpFailureLearningHorseBoost=tkpFailureLearningHorseBoost;
  globalThis.tkpFailureLearningSingleRisk=tkpFailureLearningSingleRisk;
  globalThis.tkpInvalidateFailureLearning=function(){_tkpFailureLearningCache.clear();};
}

function tkpInvalidateLearningModelCaches(){
  _tkpFailureLearningCache.clear();
  _tkpPurposeWeightCache.clear();
  _tkpLearnedCoverageCache.clear();
  _tkpWinnerRanksCache.clear();
  _tkpCustomFeatureStatsCache.clear();
  _tkpHistoricalSideBetOrderCache=new WeakMap();
  _tkpAltiliWinnerOrderCache=new WeakMap();
  _tkpSideBetPositionRankingsCache=new WeakMap();
  _tkpCouponStructureCache.clear();
  _tkpDecisionPolicyCache.clear();
  _tkpAllResultRankSummaries.clear();
  _tkpFrozenWinnerRankIndex={signature:'',byRace:new Map()};
}

function _tkpNormalizeWeights(raw){
  const sum=Object.values(raw).reduce((total,value)=>total+(Number(value)||0),0)||1;
  const out={};
  for(const [key,value] of Object.entries(raw)) out[key]=(Number(value)||0)*100/sum;
  return out;
}

function tkpApplyModelFamilyWeightPolicy(raw){
  const adjusted={...raw};
  const autoKeys=Object.keys(adjusted).filter(key=>TKP_FEATURE_REGISTRY.get(key)?.source==='auto_table'&&(Number(adjusted[key])||0)>0);
  const total=Object.values(adjusted).reduce((sum,value)=>sum+(Number(value)||0),0)||1;
  const autoTotal=autoKeys.reduce((sum,key)=>sum+(Number(adjusted[key])||0),0);
  const maxShare=typeof ADAPTIVE_AUTO_TABLE_MAX_SHARE==='number'?ADAPTIVE_AUTO_TABLE_MAX_SHARE:.12;
  if(autoTotal>0&&autoTotal/total>maxShare){
    const scale=(total*maxShare)/autoTotal;
    for(const key of autoKeys) adjusted[key]=(Number(adjusted[key])||0)*scale;
  }
  return adjusted;
}


async function tkpPrepareFeatureStatsForRaceAsync(targetRace,adaptiveStats=null,options={}){
  const signature=db?.learning_state?.dataset_signature
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):String((db?.races||[]).length));
  const profile=typeof adaptiveCacheKey==='function'?adaptiveCacheKey(targetRace):'ALL';
  const pause=typeof options?.pause==='function'?options.pause:()=>new Promise(resolve=>setTimeout(resolve,0));
  let rows=[];
  try{
    rows=typeof adaptiveRaceRows==='function'
      ? adaptiveRaceRows(targetRace).rows
      : (typeof learningEligibleRaces==='function'?learningEligibleRaces():[]);
  }catch(_){ rows=[]; }
  const keys=[...TKP_FEATURE_REGISTRY.keys()].filter(featureKey=>!(adaptiveStats&&adaptiveStats[featureKey]));
  const results=new Map();
  const empty=()=>({p1:{ok:0,total:0},p2:{ok:0,total:0},p3:{ok:0,total:0},p4:{ok:0,total:0},p5:{ok:0,total:0}});
  for(const featureKey of keys){
    const featureCacheKey=[signature,profile,featureKey].join('|');
    if(!_tkpCustomFeatureStatsCache.has(featureCacheKey))results.set(featureKey,empty());
  }
  if(!results.size)return true;
  const sameActual=(horse,target)=>String(horse?.horse_no)===String(target?.horse_no)||(typeof sameEkuri==='function'&&sameEkuri(horse?.horse_no,target?.horse_no));
  for(let raceIndex=0;raceIndex<rows.length;raceIndex++){
    const race=rows[raceIndex];
    const live=typeof tkpLiveHorses==='function'?tkpLiveHorses(race):(race.horses||[]).filter(horse=>!isNonRunner(horse));
    const actualByPos={};
    for(let position=1;position<=5;position++)actualByPos[position]=live.filter(horse=>Number(horse.finish_position)===position||(position===1&&Number(horse.winner)===1));
    if(actualByPos[1].length){
      let featureIndex=0;
      for(const [featureKey,out] of results){
        const eligible=live.filter(horse=>tkpFeaturePresentForHorse(race,horse,featureKey));
        if(eligible.length){
          const eligibleSet=new Set(eligible);
          const values=new Map();
          for(const horse of eligible)values.set(horse,tkpFeatureValue(race,horse,featureKey));
          const ordered=eligible.slice().sort((left,right)=>(values.get(right)||0)-(values.get(left)||0)
            || (typeof TKP_TR_COLLATOR_NUM!=='undefined'?TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no||''),String(right?.horse_no||'')):String(left?.horse_no||'').localeCompare(String(right?.horse_no||''))));
          for(let position=1;position<=5;position++){
            const targets=actualByPos[position].filter(target=>eligibleSet.has(target));
            if(!targets.length||ordered.length<position)continue;
            const predicted=ordered[position-1],predictedValue=values.get(predicted);
            let tieCount=0;for(const candidate of eligible){if(values.get(candidate)===predictedValue)tieCount++;}
            if(tieCount!==1)continue;
            const bucket=out[`p${position}`];bucket.total++;
            if(predicted&&targets.some(target=>sameActual(predicted,target)))bucket.ok++;
          }
        }
        featureIndex++;
        if((featureIndex&7)===0)await pause();
      }
    }
    // Eski Win8.1/Opera'da uzun görev oluşmaması için birkaç yarışta bir ana
    // olay kuyruğuna dön. Hesap değişmez; yalnız çalışma dilimlere ayrılır.
    if((raceIndex&3)===3)await pause();
  }
  for(const [featureKey,out] of results){
    for(const bucketKey of ['p1','p2','p3','p4','p5']){
      const bucket=out[bucketKey];bucket.rawRate=bucket.total?bucket.ok/bucket.total:0;bucket.rate=(bucket.ok+2)/(bucket.total+4);
    }
    _tkpCustomFeatureStatsCache.set([signature,profile,featureKey].join('|'),out);
  }
  return true;
}

async function tkpPrewarmAltiliWinnerOrderAsync(race,horses=null,options={}){
  if(!race)return [];
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race))return altiliWinnerOrderForRace(race,horses);
  const pause=typeof options?.pause==='function'?options.pause:()=>new Promise(resolve=>setTimeout(resolve,0));
  // adaptiveSignalStats ortak istatistikleri hazırlar; kayıt-sistemi feature
  // istatistikleri ise aşağıda aynı matematikle fakat kooperatif dilimlerle oluşur.
  const adaptiveStats=typeof adaptiveSignalStatsAsync==='function'
    ? await adaptiveSignalStatsAsync(race)
    : (typeof adaptiveSignalStats==='function'?adaptiveSignalStats(race):null);
  await pause();
  await tkpPrepareFeatureStatsForRaceAsync(race,adaptiveStats,{pause});
  await pause();
  // Cache hazır olduğunda bu çağrı tam tarihsel tarama yapmaz.
  tkpPurposeWeightsForRace(race,'altili',1);
  await pause();
  return altiliWinnerOrderForRace(race,horses);
}
if(typeof globalThis!=='undefined')globalThis.tkpPrewarmAltiliWinnerOrderAsync=tkpPrewarmAltiliWinnerOrderAsync;

function tkpPurposeWeightsForRace(targetRace,purpose='prediction',position=4,options=null){
  const safePosition=Math.max(1,Math.min(5,Number(position)||4));
  const noScan=options?.noScan===true;
  const signature=(db?.learning_state?.dataset_signature)
    || (typeof learningDatasetSignature==='function'?learningDatasetSignature(db):String((db?.races||[]).length));
  const profile=typeof adaptiveCacheKey==='function'?adaptiveCacheKey(targetRace):'ALL';
  const cacheKey=[signature,profile,purpose,safePosition,noScan?'NOSCAN':'FULL'].join('|');
  if(_tkpPurposeWeightCache.has(cacheKey)) return _tkpPurposeWeightCache.get(cacheKey);

  // Salt-okunur/arşiv UI yolu hiçbir zaman eksik cache yüzünden tam tarihsel tarama
  // başlatmaz. Varsa kalıcı istatistiği okur; yoksa kayıt sisteminin aynı taban
  // ağırlıklarını kullanır. Canlı öğrenme ve Back Test'in FULL yolu değişmeden kalır.
  let stats=null;
  if(noScan){
    try{
      const persistedKey=typeof adaptiveCacheKey==='function'?adaptiveCacheKey(targetRace):'';
      stats=persistedKey&&typeof tkpAdaptiveStatsPersistRead==='function'?tkpAdaptiveStatsPersistRead(persistedKey):null;
    }catch(_){ stats=null; }
  }else stats=typeof adaptiveSignalStats==='function'?adaptiveSignalStats(targetRace):null;
  const sample=Number(stats?._source?.rows?.length)||0;
  const trust=Math.max(0,Math.min(1,sample/(typeof ADAPTIVE_FULL_TRUST_RACES==='number'?ADAPTIVE_FULL_TRUST_RACES:25)));
  const keys=[...TKP_FEATURE_REGISTRY.keys()];
  const targetMix=purpose==='sidebet_position'
    ? {[`p${safePosition}`]:1}
    : purpose==='sidebet'
    ? {p1:0.30,p2:0.25,p3:0.20,p4:0.15,p5:0.10}
    : {[`p${safePosition}`]:1};
  const targetBuckets=Object.keys(targetMix);

  const rates={};
  const featureStats={};
  for(const key of keys){
    featureStats[key]=noScan?(stats?.[key]||null):tkpFeatureStatsForRace(targetRace,key,stats);
    let rate=0;
    let mixTotal=0;
    for(const [bucket,weight] of Object.entries(targetMix)){
      const group=featureStats[key]?.[bucket];
      // Hedef konumda doğrulanmış örnek yoksa Beta varsayımını gerçek veri gibi
      // ağırlık öğrenmesine katma. Örn. p2 verisi olmayan gösterge Tahmin 2'den
      // güven kazanamaz.
      if(!group || !(Number(group.total)>0)) continue;
      rate+=(Number(group.rate)||0)*weight;
      mixTotal+=weight;
    }
    rates[key]=mixTotal?rate/mixTotal:0.5;
  }
  const availableKeys=keys.filter(key=>targetBuckets.some(bucket=>(Number(featureStats[key]?.[bucket]?.total)||0)>0));
  const mean=availableKeys.length
    ? availableKeys.reduce((total,key)=>total+rates[key],0)/availableKeys.length
    : 0.5;
  const raw={};
  for(const key of keys){
    const feature=TKP_FEATURE_REGISTRY.get(key);
    const baseWeight=(purpose==='sidebet'||purpose==='sidebet_position')?feature.baseSideBet:feature.basePrediction;
    const learned=Math.max(
      typeof ADAPTIVE_LEARNED_WEIGHT_FLOOR==='number'?ADAPTIVE_LEARNED_WEIGHT_FLOOR:.55,
      Math.min(typeof ADAPTIVE_LEARNED_WEIGHT_CEILING==='number'?ADAPTIVE_LEARNED_WEIGHT_CEILING:1.75,(rates[key]||mean)/mean)
    );
    const keySamples=targetBuckets.map(bucket=>{
      const total=Number(featureStats[key]?.[bucket]?.total)||0;
      return total;
    });
    const keySample=keySamples.length?Math.max(...keySamples):0;
    const keyTrust=Math.max(0,Math.min(1,keySample/(typeof ADAPTIVE_WEIGHT_FULL_TRUST_RACES==='number'?ADAPTIVE_WEIGHT_FULL_TRUST_RACES:60)));
    raw[key]=baseWeight*(1+(learned-1)*keyTrust);
  }

  const weights=_tkpNormalizeWeights(tkpApplyModelFamilyWeightPolicy(raw));
  const result={
    purpose,
    position:safePosition,
    weights,
    stats:{...(stats||{}),...featureStats},
    sample,
    trust,
    level:stats?._source?.level||'Tüm geçmiş',
    ready:sample>=(typeof ADAPTIVE_MIN_RACES==='number'?ADAPTIVE_MIN_RACES:1)
  };
  _tkpPurposeWeightCache.set(cacheKey,result);
  return result;
}

function tkpPurposeCompositeScore(race,horse,purpose='prediction',position=4,model=null){
  const learned=model||tkpPurposeWeightsForRace(race,purpose,position);
  let total=0,weight=0;
  for(const key of TKP_FEATURE_REGISTRY.keys()){
    const w=Number(learned.weights[key])||0;
    if(w<=0||!tkpFeaturePresentForHorse(race,horse,key))continue;
    total+=w*tkpFeatureValue(race,horse,key);weight+=w;
  }
  return weight>0?Math.max(0,Math.min(100,total*100/weight)):0;
}

function altiliWinnerScoreForHorse(race,horse,models=null){
  // Arşiv/frozen görünümde Altılı 1.lik modeli yeniden öğrenilmez. Varsa kayıtlı
  // altili_winner_score kullanılır; eski snapshotta bu alan yoksa aynı ayaktaki
  // dondurulmuş TKP dağılımı yalnız görünür yardımcı puan olur. Böylece İlk Bakış
  // ve TEK kartları eski yarış açılışında adaptiveSignalStats() taraması başlatmaz.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race)){
    const stored=Number(horse?.altili_winner_score??horse?.sidebet_p1_score);
    if(Number.isFinite(stored)) return stored;
    return typeof tkpArchivedEvidenceScore==='function'?tkpArchivedEvidenceScore(race,horse):0;
  }
  const modelSignature=[
    TKP_LEARNING_MODEL_VERSION,
    db?.learning_state?.dataset_signature||String((db?.races||[]).length),
    typeof adaptiveCacheKey==='function'?adaptiveCacheKey(race):'ALL'
  ].join('|');
  if(!models&&horse?._altili_winner_model_signature===modelSignature&&Number.isFinite(Number(horse?.altili_winner_score))){
    return Number(horse.altili_winner_score);
  }
  const legacy=models?.legacy||adaptiveWeightsForRace(race,1);
  const registry=models?.registry||tkpPurposeWeightsForRace(race,'altili',1);
  const legacyScore=adaptiveCompositeScore(race,horse,legacy);
  const registryScore=tkpPurposeCompositeScore(race,horse,'altili',1,registry);
  // Altılı tek hedeflidir: bütün ayaklarda gerçek birinciyi öğrenen p1 modeli.
  // Eski çoklu-sinyal omurgası ile ayrıntılı analiz kayıt sistemi birlikte kullanılır.
  const score=Math.max(0,Math.min(100,legacyScore*0.60+registryScore*0.40));
  horse.altili_winner_score=score;
  horse._altili_winner_model_signature=modelSignature;
  return score;
}

function altiliWinnerOrderForRace(race,horses=null){
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race)){
    const rows=typeof tkpArchivedOrderedRows==='function'
      ?tkpArchivedOrderedRows({r:race,scored:horses||race?.horses||[]})
      :Array.from(horses||race?.horses||[]).filter(h=>!isNonRunner(h));
    rows.forEach((h,index)=>{ if(!Number.isFinite(Number(h.altili_winner_score))) h.altili_winner_score=typeof tkpArchivedEvidenceScore==='function'?tkpArchivedEvidenceScore(race,h):0; h.altili_winner_rank=index+1; });
    return rows;
  }
  const source=horses||race?.horses||[];
  const signature=typeof adaptiveOrderSignature==='function'
    ? 'ALTILI_P1|'+adaptiveOrderSignature(race,source)
    : 'ALTILI_P1|'+String(db?.learning_state?.dataset_signature||'')+'|'+source.length;
  const cacheTarget=(race&&typeof race==='object')?race:(Array.isArray(source)?source:null);
  const cached=cacheTarget?_tkpAltiliWinnerOrderCache.get(cacheTarget):null;
  if(cached&&cached.signature===signature) return cached.ordered.slice();
  const rows=Array.from(source).filter(horse=>!isNonRunner(horse));
  // R17.1: Kupon kritik yolunda P1 cache soğuksa bütün geçmişi burada taramak
  // yerine mevcut pre-race TKP/score sırasını kullan. Tam P1 modeli kupon
  // boyandıktan sonra tkpScheduleCouponLearningPrewarm tarafından hazırlanır.
  if(typeof globalThis!=='undefined'&&globalThis.__tkpCouponCriticalPath===true){
    rows.sort((left,right)=>
      (Number(right?.score??right?.tkp_score??right?.TKP??0)||0)-(Number(left?.score??left?.tkp_score??left?.TKP??0)||0)
      || TKP_TR_COLLATOR_NUM.compare(String(left?.horse_no||''),String(right?.horse_no||''))
    );
    for(let index=0;index<rows.length;index++){
      rows[index].altili_winner_rank=index+1;
      if(!Number.isFinite(Number(rows[index].altili_winner_score))) rows[index].altili_winner_score=Number(rows[index]?.score??rows[index]?.tkp_score??rows[index]?.TKP??0)||0;
    }
    return rows;
  }
  const models={
    legacy:adaptiveWeightsForRace(race,1),
    registry:tkpPurposeWeightsForRace(race,'altili',1)
  };
  const scores=new Map();
  for(const horse of rows) scores.set(horse,altiliWinnerScoreForHorse(race,horse,models));
  rows.sort((left,right)=>
    (scores.get(right)||0)-(scores.get(left)||0)
    || (Number(right.score)||0)-(Number(left.score)||0)
    || TKP_TR_COLLATOR_NUM.compare(String(left.horse_no),String(right.horse_no))
  );
  for(let index=0;index<rows.length;index++){
    rows[index].altili_winner_rank=index+1;
    rows[index].altili_winner_score=scores.get(rows[index])||0;
  }
  if(cacheTarget) _tkpAltiliWinnerOrderCache.set(cacheTarget,{signature,ordered:rows.slice()});
  return rows;
}

// V46 — TEK SIRALAMA OTORİTESİ
// P1, gerçek Altılı birincilik (Champion) lideri olarak kilitlidir. P2 ve sonrası,
// 16.08.2026 tarihli son gerçek yedekte zaman sıralı taramayla seçilmiş, açıklanabilir
// rank-blend ile düzenlenir. Bu düzen, son 60 holdoutta Champion P3/P5'i düşürmeden
// geniş tarihte P3/P5'i artırdı. Sonuç/finish_position hiçbir girdide kullanılmaz.
const TKP_FINAL_RANK_STRATEGY_VERSION='V46-P1-CHAMPION-P2P5-RANKBLEND';
function tkpFirstFiniteNumber(values,fallback=0){
  for(const value of values||[]){const n=Number(value);if(Number.isFinite(n))return n;}
  return fallback;
}
function tkpFirstPresentFiniteNumber(values,fallback=NaN){
  for(const value of values||[]){if(value==null||String(value).trim()==='')continue;const n=Number(value);if(Number.isFinite(n))return n;}
  return fallback;
}
function tkpRaceRankPercentMap(rows,valueGetter,direction='higher'){
  const list=(rows||[]).map((horse,index)=>{const value=Number(valueGetter(horse));return {horse,index,value,known:Number.isFinite(value)};});
  const knownCount=list.filter(row=>row.known).length,out=new Map();
  // Kaynak yarışın tamamında yoksa at numarasına göre sahte bir sıra üretme; bütün
  // atlar nötr destek alır. Kısmi kaynakta ise eksik atlar gerçek listenin altında kalır.
  if(!knownCount){for(const row of list)out.set(row.horse,.5);return out;}
  const lowerIsBetter=direction==='lower';
  list.sort((a,b)=>(a.known===b.known?0:(a.known?-1:1))||(lowerIsBetter?a.value-b.value:b.value-a.value)||TKP_TR_COLLATOR_NUM.compare(String(a.horse?.horse_no||''),String(b.horse?.horse_no||'')));
  const n=list.length;
  let i=0;
  while(i<n){let j=i+1;while(j<n&&list[j].known===list[i].known&&(!list[i].known||Math.abs(list[j].value-list[i].value)<1e-12))j++;
    const avgRank=(i+1+j)/2;const pct=list[i].known?(n<=1?1:1-(avgRank-1)/(n-1)):0;
    for(let k=i;k<j;k++)out.set(list[k].horse,pct);i=j;
  }
  return out;
}

// R15.6 CLEAN509 — 2,886 resmî sonucu doğrulanmış yarıştan, kronolojik
// 2,287 fit + 599 untouched holdout ile çıkarılmış düşük-etkili prior.
// Bu fonksiyon SONUÇ/finish_position/winner okumaz; yalnız yarış öncesi güvenli
// alanların AYNI YARIŞ içi yüzdelik sırasını kullanır. Arşiv/frozen ekran yolu
// yukarıdaki çağırıcılarda önceden döndüğü için geçmiş tahmin asla yeniden yazılmaz.
function tkpR156Clean509PriorScoreMap(race,rows,position=1){
  const live=Array.from(rows||[]);
  const calibration=globalThis.TKP_R156_CLEAN509_CALIBRATION;
  const neutral=new Map(live.map(h=>[h,.5]));
  if(!live.length||!calibration?.positionPrior)return neutral;
  const weights=calibration.positionPrior(position)||{};
  const specs={
    prediction:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.prediction_score_snapshot,h?.prediction_score,h?.pre_race_tkp_score,h?.v27_score,h?.strategic_score,h?.score],NaN)},
    agf:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.agf],NaN)},
    hndkp:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.hndkp,h?.handicap,h?.hp],NaN)},
    result:{direction:'lower',get:h=>tkpFirstPresentFiniteNumber([h?.result_score_snapshot,h?.sonuc_puani_snapshot,h?.result_score,h?.sonuc_puani,h?.sonuc_score],NaN)},
    tr:{direction:'higher',get:h=>tkpLearningGcTrValue(h)},
    jbyg:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.jbyg_rate,h?.j_byg_rate,h?.jbyg],NaN)},
    accurateFinish:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.priorAccurateFinishSignal],NaN)},
    ypuan:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.ypuan,h?.y_puan],NaN)},
    value:{direction:'higher',get:h=>tkpFirstPresentFiniteNumber([h?.value_score,h?.value],NaN)}
  };
  const maps={};
  for(const [key,spec] of Object.entries(specs)){
    const raw=new Map(live.map(h=>[h,Number(spec.get(h))]));
    const pct=tkpRaceRankPercentMap(live,h=>raw.get(h),spec.direction);
    // Kalibrasyon fitinde eksik güvenli alan nötr=.5 idi. Runtime da aynısını
    // uygular; eksik veri 0/sonuncu gibi davranıp atı yapay şekilde cezalandırmaz.
    for(const h of live) if(!Number.isFinite(raw.get(h))) pct.set(h,.5);
    maps[key]=pct;
  }
  const out=new Map();
  let sum=0;for(const w of Object.values(weights))sum+=Math.max(0,Number(w)||0);sum=sum||1;
  for(const h of live){
    let score=0;
    for(const [key,w0] of Object.entries(weights)){
      const w=Math.max(0,Number(w0)||0);if(!w)continue;
      score+=w*Number(maps[key]?.get(h)??.5);
    }
    out.set(h,Math.max(0,Math.min(1,score/sum)));
  }
  return out;
}

function tkpArchivedSideBetFrozenOrder(race,live,rankField=''){
  const frozen=typeof tkpArchivedOrderedRows==='function'
    ?tkpArchivedOrderedRows({r:race,scored:live})
    :live.slice().sort((a,b)=>(Number(b?.prediction_score_snapshot??b?.score)||0)-(Number(a?.prediction_score_snapshot??a?.score)||0)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||'')));
  const rankFields=Array.isArray(rankField)?rankField.filter(Boolean):(rankField?[rankField]:[]);
  if(!rankFields.length)return frozen;
  const rankOf=h=>{
    for(const field of rankFields){const rank=Number(h?.[field]);if(Number.isFinite(rank)&&rank>0)return rank;}
    return null;
  };
  const hasExact=frozen.length>0&&frozen.every(h=>rankOf(h)!=null);
  return hasExact
    ?frozen.slice().sort((a,b)=>rankOf(a)-rankOf(b)||TKP_TR_COLLATOR_NUM.compare(String(a?.horse_no||''),String(b?.horse_no||'')))
    :frozen;
}

function tkpFinalRankOrderForRace(race,horses=null){
  const source=horses||race?.horses||[];
  const live=Array.from(source).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
  if(!live.length)return [];
  // Kayıtlı yarışta final/yan-bahis sırası, snapshot yoksa dahi aynı yarışın
  // dondurulmuş tahmin sırasından gelir. Burada adaptif sıra/ağırlık taraması
  // başlatmak eski kayıt İSTATİSTİK sekmesini onlarca saniye kilitliyordu ve
  // güncel bilgiyi geçmiş tahmine sızdırıyordu.
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race)){
    return tkpArchivedSideBetFrozenOrder(race,live,['tkp_final_rank_snapshot','final_rank_snapshot']);
  }
  const calibrationVersion=globalThis.TKP_R156_CLEAN509_CALIBRATION?.VERSION||'NO_CLEAN509';
  const signature=(typeof adaptiveOrderSignature==='function'?adaptiveOrderSignature(race,live):String(live.length))+'|'+TKP_FINAL_RANK_STRATEGY_VERSION+'|'+calibrationVersion;
  const target=(race&&typeof race==='object')?race:null;
  const cached=target?_tkpFinalRankOrderCache.get(target):null;
  if(cached&&cached.signature===signature)return cached.ordered.slice();

  // Daha önce final sırası gerçekten snapshotlandıysa bitmiş yarışta onu mutlak koru.
  const snapshotRank=horse=>{
    const n=tkpFirstFiniteNumber([horse?.tkp_final_rank_snapshot,horse?.final_rank_snapshot],NaN);
    return Number.isFinite(n)&&n>0?n:null;
  };
  const known=live.filter(h=>snapshotRank(h)!=null).length;
  if(known===live.length){
    const frozen=live.slice().sort((a,b)=>snapshotRank(a)-snapshotRank(b)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
    if(target)_tkpFinalRankOrderCache.set(target,{signature,ordered:frozen.slice()});
    return frozen;
  }

  const champion=(typeof altiliWinnerOrderForRace==='function'?altiliWinnerOrderForRace(race,live):live.slice());
  const champPct=new Map(champion.map((h,i)=>[h,champion.length<=1?1:1-i/(champion.length-1)]));
  const agfPct=tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.agf],0));
  // ODS Sonuç Puanı bir mesafe/ceza puanıdır: düşük değer daha iyidir. Registry
  // katmanı bunu zaten "lower" olarak tanımlar; final rank blend de aynı yönü
  // kullanmalıdır. Aksi hâlde en kötü ODS puanı karma modelde ödüllendirilir.
  const resultPct=tkpRaceRankPercentMap(live,h=>tkpFirstPresentFiniteNumber([h?.result_score_snapshot,h?.sonuc_puani_snapshot,h?.result_score,h?.sonuc_puani,h?.sonuc_score],NaN),'lower');
  const trPct=tkpRaceRankPercentMap(live,tkpLearningGcTrValue);
  const ypuanPct=tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.ypuan,h?.y_puan],0));
  const profilePct=tkpRaceRankPercentMap(live,h=>{
    try{if(typeof profileStrengthPct==='function')return profileStrengthPct(race,h);}catch(_){ }
    return tkpFirstFiniteNumber([h?.profile_strength_pct,h?.profile],0);
  });
  const visiblePct=tkpRaceRankPercentMap(live,h=>{
    try{if(typeof tkpRaceVisibleDisplayScore==='function')return tkpRaceVisibleDisplayScore(race,h);}catch(_){ }
    return tkpFirstFiniteNumber([h?.prediction_score_snapshot,h?.pre_race_tkp_score,h?.score],0);
  });
  const predictionPct=tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.prediction_score_snapshot,h?.prediction_score,h?.v27_score,h?.strategic_score,h?.score],0));
  const valuePct=tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.value_score,h?.value],0));
  const clean509=tkpR156Clean509PriorScoreMap(race,live,1);
  const cleanPolicy=globalThis.TKP_R156_CLEAN509_CALIBRATION?.POLICY||{};
  const cleanBlend=Math.max(0,Math.min(.20,Number(cleanPolicy.finalTailBlend)||0));
  const score=new Map();
  for(const h of live){
    const base=0.4963368218*(champPct.get(h)||0)
      +0.2466790262*(predictionPct.get(h)||0)
      +0.0921204305*(visiblePct.get(h)||0)
      +0.0693324163*(trPct.get(h)||0)
      +0.0367815697*(resultPct.get(h)||0)
      +0.0228490443*(agfPct.get(h)||0)
      +0.0167558113*(ypuanPct.get(h)||0)
      +0.0177485027*(profilePct.get(h)||0)
      +0.0013963772*(valuePct.get(h)||0);
    const prior=Number(clean509.get(h)??.5);
    const v=(1-cleanBlend)*base+cleanBlend*prior;
    h.r156_clean509_final_prior=Math.round(prior*10000)/100;
    score.set(h,v);
  }
  const leader=champion[0]||live[0];
  const ordered=live.slice().sort((a,b)=>(score.get(b)||0)-(score.get(a)||0)||(champPct.get(b)||0)-(champPct.get(a)||0)||(agfPct.get(b)||0)-(agfPct.get(a)||0)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
  const li=ordered.indexOf(leader);if(li>0){ordered.splice(li,1);ordered.unshift(leader);}
  ordered.forEach((h,i)=>{h.final_rank_order=i+1;h.final_rank_score=Math.round((score.get(h)||0)*10000)/100;});
  if(target)_tkpFinalRankOrderCache.set(target,{signature,ordered:ordered.slice()});
  return ordered;
}

const TKP_SIDE_BET_PRODUCT_FORMULAS={
  triple:{1:{altili:.50,current:.25,ypuan:.25},2:{agf:1},3:{prediction:.2632,profile:.2612,tr:.4756}},
  quartet:{1:{altili:1},2:{agf:1},3:{altili:.0091,prediction:.0184,tr:.3248,value:.3223,ypuan:.3254},4:{current:.043,profile:.3909,result:.3969,tr:.1692}},
  quintet:{1:{current:1},2:{prediction:.0478,result:.1887,tr:.4568,value:.2559,visible:.0508},3:{altili:.0091,prediction:.0184,tr:.3248,value:.3223,ypuan:.3254},4:{current:.043,profile:.3909,result:.3969,tr:.1692},5:{result:1}}
};
function tkpSideBetProductPositionRankingsForRace(race,horses=null,product='triple'){
  const source=horses||race?.horses||[];const live=Array.from(source).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race)){
    const archived={};
    for(let position=1;position<=5;position++)archived['p'+position]=tkpArchivedSideBetFrozenOrder(race,live,`sidebet_${product}_p${position}_rank`);
    return archived;
  }
  const formulas=TKP_SIDE_BET_PRODUCT_FORMULAS[product]||TKP_SIDE_BET_PRODUCT_FORMULAS.triple;
  const calibrationVersion=globalThis.TKP_R156_CLEAN509_CALIBRATION?.VERSION||'NO_CLEAN509';
  const panelNoScan=globalThis.__tkpSideBetPanelNoScan===true;
  const signature=(typeof adaptiveOrderSignature==='function'?adaptiveOrderSignature(race,live):String(live.length))+'|'+TKP_SIDE_BET_STRATEGY_VERSION+'|'+product+'|'+calibrationVersion+'|'+(panelNoScan?'NOSCAN':'FULL');
  const target=(race&&typeof race==='object')?race:null;let productCache=target?_tkpProductSideBetRankingsCache.get(target):null;
  if(productCache?.[product]?.signature===signature){const copy={};for(const key of Object.keys(productCache[product].rankings))copy[key]=productCache[product].rankings[key].slice();return copy;}
  const altiliScore=new Map();const altiliOrder=typeof altiliWinnerOrderForRace==='function'?altiliWinnerOrderForRace(race,live):live;
  altiliOrder.forEach((h,i)=>altiliScore.set(h,altiliOrder.length<=1?1:1-i/(altiliOrder.length-1)));
  const maps={
    altili:altiliScore,
    agf:tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.agf],0)),
    result:tkpRaceRankPercentMap(live,h=>tkpFirstPresentFiniteNumber([h?.result_score_snapshot,h?.sonuc_puani_snapshot,h?.result_score,h?.sonuc_puani,h?.sonuc_score],NaN),'lower'),
    tr:tkpRaceRankPercentMap(live,tkpLearningGcTrValue),
    ypuan:tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.ypuan,h?.y_puan],0)),
    profile:tkpRaceRankPercentMap(live,h=>{try{if(typeof profileStrengthPct==='function')return profileStrengthPct(race,h);}catch(_){ }return tkpFirstFiniteNumber([h?.profile_strength_pct,h?.profile],0);}),
    visible:tkpRaceRankPercentMap(live,h=>{try{if(typeof tkpRaceVisibleDisplayScore==='function')return tkpRaceVisibleDisplayScore(race,h);}catch(_){ }return tkpFirstFiniteNumber([h?.prediction_score_snapshot,h?.pre_race_tkp_score,h?.score],0);}),
    prediction:tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.prediction_score_snapshot,h?.prediction_score,h?.v27_score,h?.strategic_score,h?.score],0)),
    value:tkpRaceRankPercentMap(live,h=>tkpFirstFiniteNumber([h?.value_score,h?.value],0))
  };
  const rankings={};
  for(const [posKey,weights] of Object.entries(formulas)){
    const position=Number(posKey);const locked=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked([race]);
    const currentModel=typeof tkpPurposeWeightsForRace==='function'?tkpPurposeWeightsForRace(race,'sidebet_position',position,{noScan:locked||panelNoScan}):null;
    const currentRaw=new Map();for(const h of live){let v=0;try{if(typeof tkpPurposeCompositeScore==='function')v=tkpPurposeCompositeScore(race,h,'sidebet_position',position,currentModel);}catch(_){ }currentRaw.set(h,Number(v)||0);}
    const current=tkpRaceRankPercentMap(live,h=>currentRaw.get(h)||0);const scores=new Map();
    const clean509=tkpR156Clean509PriorScoreMap(race,live,position);
    const cleanCal=globalThis.TKP_R156_CLEAN509_CALIBRATION;
    const cleanBlend=cleanCal?.sidebetPriorBlend?Math.max(0,Math.min(.15,Number(cleanCal.sidebetPriorBlend(position,currentModel?.sample))||0)):0;
    for(const h of live){
      let base=0;for(const [name,w] of Object.entries(weights))base+=Number(w)*(name==='current'?(current.get(h)||0):(maps[name]?.get(h)||0));
      const prior=Number(clean509.get(h)??.5),s=(1-cleanBlend)*base+cleanBlend*prior;
      h[`r156_clean509_sidebet_p${position}_prior`]=Math.round(prior*10000)/100;
      h[`r156_clean509_sidebet_p${position}_blend`]=cleanBlend;
      scores.set(h,s);
    }
    const rows=live.slice().sort((a,b)=>(scores.get(b)||0)-(scores.get(a)||0)||(altiliScore.get(b)||0)-(altiliScore.get(a)||0)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
    rows.forEach((h,i)=>{h[`sidebet_${product}_p${position}_rank`]=i+1;h[`sidebet_${product}_p${position}_score`]=Math.round((scores.get(h)||0)*10000)/100;});
    rankings['p'+position]=rows;
  }
  productCache=productCache||{};productCache[product]={signature,rankings};if(target)_tkpProductSideBetRankingsCache.set(target,productCache);
  const copy={};for(const key of Object.keys(rankings))copy[key]=rankings[key].slice();return copy;
}

function sideBetPositionRankingsForRace(race,horses=null){
  const source=horses||race?.horses||[];
  if(typeof tkpIsArchivedReadOnly==='function'&&tkpIsArchivedReadOnly(race)){
    const live=Array.from(source).filter(h=>!(typeof isNonRunner==='function'&&isNonRunner(h)));
    const archived={};
    for(let position=1;position<=5;position++)archived['p'+position]=tkpArchivedSideBetFrozenOrder(race,live,`sidebet_p${position}_rank`);
    return archived;
  }
  const cleanCalibrationVersion=globalThis.TKP_R156_CLEAN509_CALIBRATION?.VERSION||'NO_CLEAN509';
  const panelNoScan=globalThis.__tkpSideBetPanelNoScan===true;
  const signature=typeof adaptiveOrderSignature==='function'
    ? 'SIDE_P1_P5|'+adaptiveOrderSignature(race,source)+'|'+cleanCalibrationVersion+'|'+(panelNoScan?'NOSCAN':'FULL')
    : 'SIDE_P1_P5|'+String(db?.learning_state?.dataset_signature||'')+'|'+source.length+'|'+cleanCalibrationVersion+'|'+(panelNoScan?'NOSCAN':'FULL');
  // Yan bahis paneli aynı yarış için çoğu yerde race.horses.slice() gönderiyor.
  // Diziye göre WeakMap cache bu yüzden her çağrıda boşa düşüyordu; yarış nesnesi
  // ve imza birlikte kullanıldığında aynı hesap sekme boyunca gerçekten paylaşılır.
  const cacheTarget=(race&&typeof race==='object')?race:(Array.isArray(source)?source:null);
  const cached=cacheTarget?_tkpSideBetPositionRankingsCache.get(cacheTarget):null;
  if(cached&&cached.signature===signature){
    const copy={};
    for(let position=1;position<=5;position++) copy['p'+position]=cached.rankings['p'+position].slice();
    return copy;
  }
  const live=Array.from(source).filter(horse=>!isNonRunner(horse));
  const rankings={};
  const locked=typeof tkpCouponMeetingLocked==='function'&&tkpCouponMeetingLocked([race]);
  for(let position=1;position<=5;position++){
    const model=tkpPurposeWeightsForRace(race,'sidebet_position',position,{noScan:locked||panelNoScan});
    const scores=new Map();
    const rows=live.slice();
    const clean509=tkpR156Clean509PriorScoreMap(race,rows,position);
    const cleanCal=globalThis.TKP_R156_CLEAN509_CALIBRATION;
    const cleanBlend=cleanCal?.sidebetPriorBlend?Math.max(0,Math.min(.15,Number(cleanCal.sidebetPriorBlend(position,model?.sample))||0)):0;
    for(const horse of rows){
      const current=tkpPurposeCompositeScore(race,horse,'sidebet_position',position,model);
      const prior=Number(clean509.get(horse)??.5);
      scores.set(horse,(1-cleanBlend)*current+cleanBlend*prior*100);
      horse[`r156_clean509_sidebet_p${position}_prior`]=Math.round(prior*10000)/100;
      horse[`r156_clean509_sidebet_p${position}_blend`]=cleanBlend;
    }
    rows.sort((left,right)=>
      (scores.get(right)||0)-(scores.get(left)||0)
      || (Number(right.score)||0)-(Number(left.score)||0)
      || TKP_TR_COLLATOR_NUM.compare(String(left.horse_no),String(right.horse_no))
    );
    for(let index=0;index<rows.length;index++){
      rows[index]['sidebet_p'+position+'_rank']=index+1;
      rows[index]['sidebet_p'+position+'_score']=scores.get(rows[index])||0;
    }
    rankings['p'+position]=rows;
  }
  if(cacheTarget) _tkpSideBetPositionRankingsCache.set(cacheTarget,{signature,rankings});
  const copy={};
  for(let position=1;position<=5;position++) copy['p'+position]=rankings['p'+position].slice();
  return copy;
}

function sideBetAdaptiveOrderForRace(race,horses=null){
  const source=horses||race?.horses||[];
  const remaining=Array.from(source).filter(h=>!isNonRunner(h)).slice();
  const ordered=[];
  const finalScores=new Map();
  const rankings=sideBetPositionRankingsForRace(race,source);

  // Yan bahis sırası tek bir genel puanın 1-5 diye kesilmesi değildir. Her sıra,
  // yalnız o gerçek bitiriş konumundan öğrenilmiş ayrı modelle ve daha önce seçilen
  // at çıkarılarak belirlenir.
  for(let position=1;position<=5&&remaining.length;position++){
    const candidates=rankings['p'+position]||[];
    const selected=candidates.find(horse=>remaining.includes(horse))||remaining[0];
    remaining.splice(remaining.indexOf(selected),1);
    finalScores.set(selected,Number(selected?.['sidebet_p'+position+'_score'])||0);
    ordered.push(selected);
  }

  if(remaining.length){
    const tailModel=tkpPurposeWeightsForRace(race,'sidebet',5);
    for(const horse of remaining){
      finalScores.set(horse,tkpPurposeCompositeScore(race,horse,'sidebet',5,tailModel));
    }
    remaining.sort((left,right)=>
      (finalScores.get(right)||0)-(finalScores.get(left)||0)
      || (Number(right.score)||0)-(Number(left.score)||0)
      || TKP_TR_COLLATOR_NUM.compare(String(left.horse_no),String(right.horse_no))
    );
    ordered.push(...remaining);
  }

  for(let index=0;index<ordered.length;index++){
    ordered[index].sidebet_adaptive_rank=index+1;
    ordered[index].sidebet_adaptive_score=finalScores.get(ordered[index])||0;
    ordered[index].sidebet_target_position=Math.min(5,index+1);
  }
  return ordered;
}

function historicalSideBetOrder(race){
  if(!race) return [];
  const source=race.horses||[];
  const signature=typeof adaptiveOrderSignature==='function'
    ? 'SIDE_HISTORY|'+adaptiveOrderSignature(race,source)
    : 'SIDE_HISTORY|'+String(db?.learning_state?.dataset_signature||'')+'|'+source.length;
  const cached=_tkpHistoricalSideBetOrderCache.get(race);
  if(cached&&cached.signature===signature) return cached.ordered.slice();
  const ordered=sideBetAdaptiveOrderForRace(race,source.slice());
  _tkpHistoricalSideBetOrderCache.set(race,{signature,ordered:ordered.slice()});
  return ordered.slice();
}

function _tkpQuantile(values,q){
  if(!values.length) return null;
  const sorted=values.slice().sort((a,b)=>a-b);
  const index=Math.max(0,Math.min(sorted.length-1,Math.ceil(q*sorted.length)-1));
  return sorted[index];
}

// R16.55: Her resmî sonuçlu koşu, üç kupon için ortak ama birbirinden bağımsız
// öğrenme kaynağıdır. Sonuç yalnız kazananın geçmiş sırasını ölçer; canlı at
// puanına/aday listesine sonuç alanı eklenmez.
function tkpAllOfficialResultRank(race){
  const signature=[db?.learning_state?.dataset_signature||'',db?.races?.length||0].join('|');
  const key=signature+'|'+String(race?.id||race?.race_uid||'');
  if(_tkpAllOfficialResultRankCache.has(key))return _tkpAllOfficialResultRankCache.get(key);
  const rank=tkpFrozenPreRaceWinnerRank(race);
  _tkpAllOfficialResultRankCache.set(key,rank);
  if(_tkpAllOfficialResultRankCache.size>7000)_tkpAllOfficialResultRankCache.clear();
  return rank;
}

const _tkpAllResultProfileKeys=new WeakMap();
const _tkpAllResultRankSummaries=new Map();
function tkpAllResultProfileKey(race){
  const surface=race?.surface,condition=race?.condition_family||race?.condition_text;
  const distance=race?.distance_group,breed=race?.breed;
  const objectRace=race&&typeof race==='object';
  const cached=objectRace?_tkpAllResultProfileKeys.get(race):null;
  if(cached&&cached.surface===surface&&cached.condition===condition&&cached.distance===distance&&cached.breed===breed)return cached.key;
  const clean=v=>String(v||'?').trim().toLocaleUpperCase('tr-TR');
  const key=[clean(surface),clean(condition),clean(distance),clean(breed)].join('|');
  if(objectRace)_tkpAllResultProfileKeys.set(race,{surface,condition,distance,breed,key});
  return key;
}

function tkpAllResultCouponPolicy(targetRace,mode='main',fallback=4,orderedRows=[]){
  const signature=[
    db?.learning_state?.dataset_signature||'',
    db?.learning_state?.result_count||'',
    db?.learning_state?.updated_at||'',
    (db?.races||[]).length
  ].join('|');
  const cutoff=targetRace&&typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'ALL';
  const profile=tkpAllResultProfileKey(targetRace);
  // fallback yalnız veri yokken kullanılır; mevcut arşivde tüm sonucu olan satırlar
  // bulunduğunda aynı profil için ikinci kez tarama başlatmamalıdır.
  const cacheKey=[signature,cutoff,profile,mode].join('|');
  const cached=_tkpAllOfficialResultPolicyCache.get(cacheKey);
  if(cached)return {...cached};

  const target={main:.74,alt:.82,surprise:.79}[mode]??.78;
  const limits=mode==='main'?{min:2,max:4,single:.38}:mode==='alt'?{min:3,max:5,single:.31}:{min:3,max:5,single:.34};
  const summaryKey=[signature,cutoff,profile].join('|');
  let summary=_tkpAllResultRankSummaries.get(summaryKey);
  if(!summary){
    const all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
    const rows=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
      ?tkpTrainingRowsBeforeTarget(all,targetRace,db):all;
    const globalRanks=[],profileRanks=[];
    for(let i=0;i<rows.length;i++){
      if((i&31)===0&&typeof tkpCouponCheck==='function')tkpCouponCheck();
      const race=rows[i],rank=tkpAllOfficialResultRank(race);if(rank<=0)continue;
      globalRanks.push(rank);if(tkpAllResultProfileKey(race)===profile)profileRanks.push(rank);
    }
    summary={globalRanks,profileRanks};_tkpAllResultRankSummaries.set(summaryKey,summary);
    if(_tkpAllResultRankSummaries.size>64)_tkpAllResultRankSummaries.delete(_tkpAllResultRankSummaries.keys().next().value);
  }
  const {globalRanks,profileRanks}=summary;
  if(!globalRanks.length){
    const result={mode,status:'VERİ YOK',sample:0,profileSample:0,coverage:Math.max(limits.min,Math.min(limits.max,Number(fallback)||limits.min)),leaderRate:0,singleEligible:false,confidence:0};
    _tkpAllOfficialResultPolicyCache.set(cacheKey,result);return {...result};
  }
  const globalQ=_tkpQuantile(globalRanks,target)||Number(fallback)||limits.min;
  const profileQ=profileRanks.length?_tkpQuantile(profileRanks,target):globalQ;
  // Profil küçükken yine tüm sonuçlar kullanılır; profil payı örnek büyüdükçe artar.
  const profileTrust=profileRanks.length/(profileRanks.length+30);
  const rawCoverage=Math.round(globalQ*(1-profileTrust)+profileQ*profileTrust);
  const coverage=Math.max(limits.min,Math.min(limits.max,rawCoverage));
  const globalP1=globalRanks.filter(x=>x===1).length/globalRanks.length;
  const profileP1=profileRanks.length?profileRanks.filter(x=>x===1).length/profileRanks.length:globalP1;
  const leaderRate=globalP1*(1-profileTrust)+profileP1*profileTrust;
  const rowsNow=Array.isArray(orderedRows)?orderedRows:[];
  const first=Number(rowsNow[0]?.altili_winner_score??rowsNow[0]?.score??0);
  const second=Number(rowsNow[1]?.altili_winner_score??rowsNow[1]?.score??0);
  const margin=Math.max(0,first-second)/Math.max(.01,Math.abs(first)||1);
  const confidence=Math.round(Math.max(0,Math.min(100,(leaderRate*.75+Math.min(.15,margin)*.25)*100)));
  const singleEligible=rowsNow.length>1&&leaderRate>=limits.single&&margin>=.035;
  const result={mode,status:'ÖĞRENİLDİ',sample:globalRanks.length,profileSample:profileRanks.length,coverage,leaderRate:+leaderRate.toFixed(4),singleEligible,confidence,target,profileTrust:+profileTrust.toFixed(4)};
  _tkpAllOfficialResultPolicyCache.set(cacheKey,result);
  if(_tkpAllOfficialResultPolicyCache.size>192)_tkpAllOfficialResultPolicyCache.delete(_tkpAllOfficialResultPolicyCache.keys().next().value);
  return {...result};
}

// R16.57 — ORTAK TEK / DAR / GENİŞ KARAR KATMANI
//
// Bu katman puanı yeniden yazmaz. Onun işi, mevcut yarış-öncesi sıralamanın
// geçmişte hangi derinlikte kazananı taşıdığını öğrenip her ayak/pozisyon için
// "TEK, DAR veya GENİŞ" kararını vermektir. Öğrenme hedefi yalnız resmî sonuçtur;
// girdi sırası ise sadece yarıştan ÖNCE kilitlenmiş prediction/sidebet rank
// snapshot'larından okunur. Böylece aynı yarışın sonucu bugünkü özelliğe sızmaz.
function tkpDecisionPolicyProfileKey(race){
  return tkpAllResultProfileKey(race)+'|L'+(Number(race?.leg)||0);
}
function tkpDecisionPolicyHistoricalRank(race,product='altili',position=1){
  const pos=Math.max(1,Math.min(5,Number(position)||1));
  if(product==='altili'||product==='coupon') return tkpFrozenPreRaceWinnerRank(race);
  const actual=(race?.horses||[]).find(h=>Number(h?.finish_position)===pos||(pos===1&&Number(h?.winner)===1));
  if(!actual) return 0;
  // Sadece dondurulmuş sıralar kabul edilir. Canlı hesaplanmış, sonuçtan sonra
  // yazılmış bir sidebet_* alanı eğitim verisi değildir.
  const keys=[
    `sidebet_${product}_p${pos}_rank`,
    `sidebet_p${pos}_rank_snapshot`,
    `sidebet_p${pos}_rank`
  ];
  for(const key of keys){
    const n=Number(actual?.[key]);
    if(Number.isFinite(n)&&n>=1)return n;
  }
  return 0;
}
function tkpDecision17FeatureConsensus(race,orderedRows=[]){
  const rows=(orderedRows||[]).filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
  const leader=rows[0]||null;
  if(!leader||rows.length<2)return {featureCount:0,leaderSupport:0,gap:0,leaderWins:0};
  const support=new Map(rows.map(h=>[h,0]));let available=0,leaderWins=0;
  for(const key of TKP_DECISION_17_FEATURE_KEYS){
    if(!TKP_FEATURE_REGISTRY.has(key))continue;
    const values=rows.map(h=>({h,v:tkpFeaturePresentForHorse(race,h,key)?tkpFeatureValue(race,h,key):NaN}))
      .filter(row=>Number.isFinite(row.v));
    if(values.length<2)continue;
    available++;
    // Özellik değerleri zaten 0..1 ölçeğinde. Bunları yarış içindeki min/max'a
    // tekrar germek, iki atlı ayakta 0,97 ile 1,00 arasındaki gerçek farkı 0-1
    // gibi gösterip dar ayak kararını bozar. Mutlak yarış-öncesi destek korunur.
    let best=-Infinity;
    for(const row of values){
      support.set(row.h,(support.get(row.h)||0)+row.v);
      if(row.v>best)best=row.v;
    }
    const leaderValue=values.find(row=>row.h===leader)?.v;
    if(Number.isFinite(leaderValue)&&Math.abs(leaderValue-best)<1e-9)leaderWins++;
  }
  if(!available)return {featureCount:0,leaderSupport:0,gap:0,leaderWins:0};
  const ranked=rows.slice().sort((a,b)=>(support.get(b)||0)-(support.get(a)||0));
  const lead=support.get(leader)||0,second=support.get(ranked.find(h=>h!==leader))||0;
  return {
    featureCount:available,
    leaderSupport:+Math.max(0,Math.min(1,lead/available)).toFixed(4),
    gap:+Math.max(0,Math.min(1,(lead-second)/available)).toFixed(4),
    leaderWins
  };
}
function tkpDecisionPolicyTarget(mode,product,position){
  if(product!=='altili'&&product!=='coupon'){
    // Sıralı bahislerde alt sıralar doğal olarak daha karışıktır; aynı tek
    // hedefi zorla bütün pozisyonlara uygulamak yerine kademeli kapsama öğrenilir.
    return Math.min(.92,.68+Math.max(0,Number(position)-1)*.05);
  }
  return mode==='alt'?.92:mode==='surprise'?.87:.82;
}
function tkpAdaptiveDecisionPolicy(targetRace,orderedRows=[],options={}){
  const mode=String(options.mode||'main');
  const product=String(options.product||'altili');
  const position=Math.max(1,Math.min(5,Number(options.position)||1));
  const fallback=Math.max(1,Math.min(12,Number(options.fallback)||4));
  const signature=[
    db?.learning_state?.dataset_signature||'',
    db?.learning_state?.result_count||'',
    db?.learning_state?.updated_at||'',
    (db?.races||[]).length
  ].join('|');
  const cutoff=targetRace&&typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'ALL';
  const cacheKey=[signature,cutoff,tkpDecisionPolicyProfileKey(targetRace),product,position].join('|');
  const cached=_tkpDecisionPolicyCache.get(cacheKey);
  // Canlı 17-parametre dağılımı değişirse geçmiş örnek sabit kalsa bile kararın
  // yeniden üretilmesi gerekir; sadece tarihsel çekirdek önbelleğe alınır.
  let historical=cached;
  if(!historical){
    const all=typeof learningEligibleRaces==='function'?learningEligibleRaces():[];
    const training=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
      ?tkpTrainingRowsBeforeTarget(all,targetRace,db):all;
    const profile=tkpDecisionPolicyProfileKey(targetRace);
    const globalRanks=[],profileRanks=[];
    for(let i=0;i<training.length;i++){
      if((i&31)===0&&typeof tkpCouponCheck==='function')tkpCouponCheck();
      const race=training[i];
      const rank=tkpDecisionPolicyHistoricalRank(race,product,position);
      if(rank<=0)continue;
      globalRanks.push(rank);if(tkpDecisionPolicyProfileKey(race)===profile)profileRanks.push(rank);
    }
    historical={globalRanks,profileRanks};
    _tkpDecisionPolicyCache.set(cacheKey,historical);
    if(_tkpDecisionPolicyCache.size>240)_tkpDecisionPolicyCache.delete(_tkpDecisionPolicyCache.keys().next().value);
  }
  const globalRanks=historical.globalRanks||[],profileRanks=historical.profileRanks||[];
  const sample=globalRanks.length,profileSample=profileRanks.length;
  const consensus=tkpDecision17FeatureConsensus(targetRace,orderedRows);
  if(!sample){
    return {version:'R16.57_17_SIGNAL',status:'VERİ YOK',mode,product,position,sample:0,profileSample:0,
      coverage:fallback,tier:fallback<=1?'TEK':fallback<=3?'DAR':'GENİŞ',singleEligible:false,singleBlocked:false,
      leaderRate:0,confidence:0,consensus,preRaceOnly:true};
  }
  const target=tkpDecisionPolicyTarget(mode,product,position);
  const globalQ=_tkpQuantile(globalRanks,target)||fallback;
  const profileQ=profileRanks.length?_tkpQuantile(profileRanks,target):globalQ;
  const profileTrust=profileSample/(profileSample+30);
  const learned=globalQ*(1-profileTrust)+profileQ*profileTrust;
  const historyTrust=sample/(sample+36);
  let coverage=Math.round(fallback*(1-historyTrust)+learned*historyTrust);
  // Aynı 17 parametrenin lideri destekleyip desteklemediği yalnız güncel kararın
  // derinliğini etkiler; tarihsel sonucun kendisini sinyal olarak kullanmaz.
  if(consensus.featureCount>=6&&consensus.leaderSupport>=.68&&consensus.gap>=.14)coverage--;
  if(consensus.featureCount>=6&&(consensus.leaderSupport<.48||consensus.gap<.045))coverage++;
  coverage=Math.max(1,Math.min(12,coverage));
  const rank1=globalRanks.filter(rank=>rank===1).length/globalRanks.length;
  const profileRank1=profileRanks.length?profileRanks.filter(rank=>rank===1).length/profileRanks.length:rank1;
  const leaderRate=rank1*(1-profileTrust)+profileRank1*profileTrust;
  const confidence=Math.round(Math.max(0,Math.min(100,(leaderRate*.70+consensus.leaderSupport*.20+Math.min(.20,consensus.gap)*.50)*100)));
  const singleEligible=sample>=12&&leaderRate>=.42&&consensus.featureCount>=6&&consensus.leaderSupport>=.62&&consensus.gap>=.09;
  // Sadece yeterli örnekte, tarihsel P1 başarısı belirgin zayıf VE bugünkü 17
  // parametre desteği dağınıksa TEK veto edilir. Böylece düşük örnek modeli
  // kuponun zorunlu 1–2 TEK yapısını keyfi biçimde bozamaz.
  const singleBlocked=sample>=40&&leaderRate<.27&&consensus.featureCount>=6&&consensus.leaderSupport<.55;
  return {version:'R16.57_17_SIGNAL',status:'ÖĞRENİLDİ',mode,product,position,sample,profileSample,target,
    coverage,tier:coverage<=1?'TEK':coverage<=3?'DAR':'GENİŞ',singleEligible,singleBlocked,
    leaderRate:+leaderRate.toFixed(4),confidence,profileTrust:+profileTrust.toFixed(4),consensus,preRaceOnly:true};
}
if(typeof globalThis!=='undefined'){
  globalThis.TKP_DECISION_17_FEATURE_KEYS=TKP_DECISION_17_FEATURE_KEYS;
  globalThis.tkpAdaptiveDecisionPolicy=tkpAdaptiveDecisionPolicy;
}

function tkpLearnedCoverageCount(targetRace,mode='main',fallback=4){
  const signature=db?.learning_state?.dataset_signature||String((db?.races||[]).length);
  const profile=typeof adaptiveCacheKey==='function'?adaptiveCacheKey(targetRace):'ALL';
  const cutoff=targetRace&&typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'ALL';
  const cacheKey=[signature,cutoff,profile,Number(targetRace?.leg)||0,mode,fallback].join('|');
  if(_tkpLearnedCoverageCache.has(cacheKey)) return _tkpLearnedCoverageCache.get(cacheKey);

  // Pahalı adım (profil eşleşen geçmiş yarışları TAM adaptif motorla puanlamak) mode'dan
  // bağımsızdır -- ayrı, mode içermeyen bir anahtarla önbelleğe alınır ki aynı ayak farklı
  // mode'lar (main/alt/surprise) için sorulduğunda tekrar taranmasın.
  const winnerRanksKey=[signature,cutoff,profile,Number(targetRace?.leg)||0].join('|');
  let winnerRanks;
  if(_tkpWinnerRanksCache.has(winnerRanksKey)){
    winnerRanks=_tkpWinnerRanksCache.get(winnerRanksKey);
  } else {
    let rows=[];
    try{
      rows=targetRace&&typeof detailedProfileMatch==='function'
        ? detailedProfileMatch(targetRace,5).rows
        : learningEligibleRaces();
    }catch(_){ rows=[]; }
    rows=rows.filter(r=>(r.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1));

    winnerRanks=[];
    for(const race of rows){
      const rank=tkpFrozenPreRaceWinnerRank(race);
      if(rank>0) winnerRanks.push(rank);
    }
    _tkpWinnerRanksCache.set(winnerRanksKey,winnerRanks);
  }

  if(!winnerRanks.length){
    const result=Math.max(1,Math.min(10,Number(fallback)||4));
    _tkpLearnedCoverageCache.set(cacheKey,result);
    return result;
  }

  // R16.2: elde tek bir doğrulanmış tarihsel örnek bile varsa değerlendirmeye girer.
  // Küçük örneklem veriyi dışlamaz; yalnız güven katsayısını düşürür.
  const target=mode==='alt'?0.92:mode==='surprise'?0.87:0.82;
  const learned=_tkpQuantile(winnerRanks,target);
  const historyTrust=Math.max(.05,Math.min(1,winnerRanks.length/(winnerRanks.length+8)));
  const structure=typeof tkpCouponStructureLearning==='function'?tkpCouponStructureLearning(targetRace):null;
  const legRule=structure?.legs?.[Number(targetRace?.leg)||0];
  const legLearned=Number(legRule?.[mode]);
  const fallbackValue=Number(fallback)||4;
  const evidence=Number(learned)||fallbackValue;
  const legEvidence=Number.isFinite(legLearned)?legLearned:evidence;
  const historicalBlend=(evidence*.60+legEvidence*.40);
  const blended=Math.round(fallbackValue*(1-historyTrust)+historicalBlend*historyTrust);
  const result=Math.max(1,Math.min(10,blended));
  _tkpLearnedCoverageCache.set(cacheKey,result);
  return result;
}

function tkpCouponStructureLearning(targetRace=null){
  const signature=db?.learning_state?.dataset_signature||String((db?.races||[]).length);
  const cutoff=targetRace&&typeof tkpChronologyCutoffKey==='function'?tkpChronologyCutoffKey(targetRace,db):'ALL';
  const cacheKey=[signature,cutoff].join('|');
  if(_tkpCouponStructureCache.has(cacheKey))return _tkpCouponStructureCache.get(cacheKey);
  const all=(typeof learningEligibleRaces==='function'?learningEligibleRaces():[]);
  const races=targetRace&&typeof tkpTrainingRowsBeforeTarget==='function'
    ?tkpTrainingRowsBeforeTarget(all,targetRace,db)
    :all;
  const rankByLeg=new Map();
  let rank1=0;
  let total=0;
  for(const race of races){
    const rank=tkpFrozenPreRaceWinnerRank(race);
    if(rank<=0) continue;
    total++;
    if(rank===1) rank1++;
    const leg=Number(race.leg)||0;
    if(!rankByLeg.has(leg)) rankByLeg.set(leg,[]);
    rankByLeg.get(leg).push(rank);
  }
  const legs={};
  for(const [leg,ranks] of rankByLeg){
    legs[leg]={
      sample:ranks.length,
      main:_tkpQuantile(ranks,0.82)||4,
      alt:_tkpQuantile(ranks,0.92)||5,
      surprise:_tkpQuantile(ranks,0.87)||5,
      keepLeaderRate:ranks.filter(x=>x===1).length/ranks.length
    };
  }
  const result={
    sample:total,
    rank1Rate:total?rank1/total:0,
    legs,
    recommendedDifferentLegs:total?Math.max(1,Math.min(4,Math.round(6*(1-rank1/total)))):2,
    status:total>0?'GÜNCEL':'VERİ YOK'
  };
  _tkpCouponStructureCache.set(cacheKey,result);
  if(_tkpCouponStructureCache.size>96)_tkpCouponStructureCache.delete(_tkpCouponStructureCache.keys().next().value);
  return result;
}

function tkpCouponStructureHTML(){
  const model=tkpCouponStructureLearning();
  const rows=Object.keys(model.legs).sort((a,b)=>Number(a)-Number(b)).map(leg=>{
    const x=model.legs[leg];
    return `<tr><td><b>${esc(leg)}. Ayak</b></td><td class="num">${x.sample}</td><td class="num">${x.main}</td><td class="num">${x.alt}</td><td class="num">${x.surprise}</td><td class="num">${x.sample>0?'%'+fmt2(x.keepLeaderRate*100):'—'}</td></tr>`;
  }).join('');
  return `<div class="card couponLearningCard"><h3 style="margin:0 0 6px;">Kupon dağılım öğrenmesi</h3>
    <p class="muted" style="margin:0 0 8px;">${model.sample} sonuçlu yarıştan; ayak başına at sayısı ve kolonlar arası çeşitlilik güncellenir. Önerilen farklılaştırılmış ayak: <b>${model.recommendedDifferentLegs}</b>.</p>
    <div class="tableWrap compactBacktest"><table><thead><tr><th>Ayak</th><th class="num">Örnek</th><th class="num">Normal</th><th class="num">Geniş</th><th class="num">Sürpriz</th><th class="num">Lideri koru</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Henüz sonuç kaydı yok.</td></tr>'}</tbody></table></div>
  </div>`;
}
