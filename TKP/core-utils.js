// Genel amaçlı, durum (state) taşımayan yardımcı fonksiyonlar.

// HIZ KÖK ÇÖZÜM (2026-09): kod tabanının onlarca yerinde sıralama karşılaştırıcıları
// String.prototype.localeCompare(x,'tr',{numeric:true}) çağırıyordu. V8'de locale/
// options argümanlı localeCompare her çağrıda örtük bir Intl.Collator eşdeğeri kurar;
// büyük arşivde (10.000+ koşu) yüzbinlerce kez tekrarlanan bu maliyet tahmin/kupon
// menüsünün en büyük tek darboğazıydı (ölçüm: 2.000.000 çağrıda ~7.2 sn'ye karşı
// paylaşılan bir Intl.Collator ile ~0,15 sn — 47x). Sonuç (sıralama, çıktı) birebir
// aynıdır; yalnız Collator nesnesi bir kez kurulup tekrar tekrar kullanılır. Tüm
// a.localeCompare(b,'tr',{numeric:true}) / a.localeCompare(b,'tr') çağrıları bu iki
// paylaşılan karşılaştırıcıya taşındı (bkz. TKP_TR_COLLATOR / TKP_TR_COLLATOR_NUM).
const TKP_TR_COLLATOR = new Intl.Collator('tr');
const TKP_TR_COLLATOR_NUM = new Intl.Collator('tr', {numeric:true});

// KULLANICI İSTEĞİ (2026-09): "En iyi 5" / "Mükemmel 3" özet panelleri kural
// listesini sabit 5/3 satırla kesiyordu. Kompaktlık korunarak (aynı ruleStatsTable
// stili/küçük yazı tipi, ek scroll yok) satır sayısı büyütüldü. Eşik filtreleri
// (best_min_single, perfect_min_single/rate/lb) DEĞİŞMEDİ -- yalnız o eşikleri
// geçen kurallardan kaçının gösterildiği arttı. Tüm gösterim yerleri (Ana panel/
// Öneriler, Kurallar sekmesi, cache anahtarı, uyarı metni) bu iki sabitten okur.
const TKP_BEST_RULES_SHOWN = 10;
const TKP_PERFECT_RULES_SHOWN = 5;

const _foldCache = new Map();

const $ = (sel) => document.querySelector('#tkpRoot ' + sel);

const $$ = (sel) => [...document.querySelectorAll('#tkpRoot ' + sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmt2 = (v) => Number(v || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2});

// Ortak TL biçimlendirici: kupon/geri test ekranlarının tamamında erişilebilir.
const fmtTL = (v) => fmt2(v) + ' TL';

// Görünen TKP ölçeği: kullanıcı ekranında gösterilen TKP, ham birleşik puanın
// üçte biridir ve 10,00 üst sınırını aşamaz. Bu yalnız kullanıcıya gösterilen
// TKP değeridir; ana sıralama/kupon motorunun iç katsayısını gizlice değiştirmez.
const TKP_VISIBLE_SCORE_DIVISOR = 3;
const TKP_VISIBLE_SCORE_MAX = 10;
const TKP_VISIBLE_SCORE_SCALE_VERSION = 'DIV3_MAX10_V1';
function tkpRound2(v){ return Math.round((Number(v)||0)*100)/100; }

// V1.1.212 HIZ DÜZELTMESİ: koşu başına "koşmayan at hariç" listesi (live horses),
// backtest/kupon/öğrenme motorlarının onlarca farklı yerinde AYNI koşu için
// tekrar tekrar (isNonRunner regex testi dahil) yeniden hesaplanıyordu. Gerçek DB
// (72 toplantı/432 koşu) üzerinde profil çıkarıldığında bu tek satır tüm CPU
// zamanının ~%25'ini tüketiyordu (bkz. SÜRÜM NOTLARI). Bu yardımcı, r.horses
// dizisinin AYNI referansı için sonucu koşu nesnesinin üzerinde önbelleğe alır;
// .horses yeni bir diziyle değiştirildiğinde (veri yenileme/import) önbellek
// otomatik geçersiz olur çünkü kaynak dizi referansı karşılaştırılır. Mevcut
// _accurateFieldAvgCache düzenindeki gibi koşu nesnesi üzerinde saklanır.
function tkpLiveHorses(r){
  if(!r) return [];
  const horses=r.horses||[];
  if(r.__tkpLiveHorsesSrc===horses && r.__tkpLiveHorsesCache) return r.__tkpLiveHorsesCache;
  const live=horses.filter(h=>h&&!(typeof isNonRunner==='function'&&isNonRunner(h)));
  try{ r.__tkpLiveHorsesCache=live; r.__tkpLiveHorsesSrc=horses; }catch(_e){}
  return live;
}
function tkpFiniteStoredNumber(v){ if(v===null||v===undefined||v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
function tkpScaleVisibleScore(raw){
  const n=Number(raw);
  if(!Number.isFinite(n)) return null;
  return tkpRound2(Math.max(0,Math.min(TKP_VISIBLE_SCORE_MAX,n/TKP_VISIBLE_SCORE_DIVISOR)));
}
function tkpPositiveStoredNumber(v){
  const n=tkpFiniteStoredNumber(v);
  return n!==null&&n>0?n:null;
}

// Eski ve yeni kayıt alanları farklı etiketler taşıyabilir; doğru GC-TR
// etiketi herhangi bir kanonik alanda varsa eski TJK etiketi gölgeleyemez.
function tkpTrustedGcTrSource(h){
  if(!h)return null;
  const sources=[h.tr_ganyan_source,h.tr_source]
    .map(v=>String(v??'').trim().toUpperCase())
    .filter(Boolean);
  return sources.includes('GANYAN_CANAVARI_TR')?'GANYAN_CANAVARI_TR':null;
}

// Eski tarihsel snapshot migrasyonunun bazı sürümleri, gerçek yarış-öncesi skor
// bulunmadığı halde 0 değerini kilitleyip bunu doğrulanmış TKP gibi gösteriyordu.
// Bu kayıt gerçek bir sıfır değildir: provenance açıkça reconstructed/unverified
// ve PRE-RACE doğrulama bayrağı yoktur. Tek kanonik çözümleyici bu placeholder'ı
// reddeder; varsa prediction_log'daki gerçek yarış-öncesi kayıt üst katmanda
// geri yüklenir, o da yoksa ekranda "-" görünür.
function tkpIsUnverifiedReconstructedZeroSnapshot(h){
  if(!h||Number(h.prediction_score_locked)!==1||tkpFiniteStoredNumber(h.prediction_score_snapshot)!==0)return false;
  if(Number(h.prediction_snapshot_verified_pre_race)===1)return false;
  const provenance=String(h.prediction_snapshot_provenance||h.historical_snapshot_mode||'').toUpperCase();
  return /HISTORICAL.*(?:RECONSTRUCT|UNVERIFIED)|RECONSTRUCTED_FROM_EXISTING_ARCHIVE/.test(provenance)
    || Boolean(h.historical_snapshot_backfill_version);
}

function tkpTrustedGcTrValue(h){
  if(!h)return null;
  const source=tkpTrustedGcTrSource(h);
  if(source!=='GANYAN_CANAVARI_TR')return null;
  for(const raw of [h.tr_ganyan,h.tr_puan]){
    const value=tkpFiniteStoredNumber(typeof raw==='string'?raw.replace(',','.'):raw);
    if(value!==null&&value>0)return value;
  }
  return null;
}

// Arşiv, Genel Bakış, ayak tabloları ve PDF aynı yarış-öncesi kaydı okumalıdır.
// Eski yedeklerin bir kısmı "henüz hesaplanmadı" değerini 0 olarak yazdığı için
// pozitif bir frozen skor/alias varken bu sıfır gerçek TKP kabul edilmez.
function tkpPredictionSnapshotView(h,race=null,fallbackCommonScore=null){
  if(!h)return {score:null,visibleTkp:null,visibleRaw:null,locked:false,source:'NONE',modelVersion:''};
  const unverifiedZero=tkpIsUnverifiedReconstructedZeroSnapshot(h);
  const snapScore=tkpFiniteStoredNumber(h.prediction_score_snapshot);
  const legacyScore=tkpFiniteStoredNumber(h.pre_race_tkp_score ?? h.tkp_legacy_score ?? h.score);
  const locked=Number(h.prediction_score_locked)===1;
  const score=!unverifiedZero&&snapScore!==null?snapScore:legacyScore;
  const modelVersion=String(h.prediction_score_model_version||h.prediction_score_scale_version||'');
  const scaleFromShown=(shown,version)=>{
    const n=tkpPositiveStoredNumber(shown);
    if(n===null)return null;
    return String(version||'')===TKP_VISIBLE_SCORE_SCALE_VERSION?tkpRound2(n*TKP_VISIBLE_SCORE_DIVISOR):n;
  };
  const candidates=[
    ['FROZEN_RAW',tkpPositiveStoredNumber(h.prediction_tkp_display_raw_snapshot)],
    ['FROZEN_RAW_ALIAS',tkpPositiveStoredNumber(h.prediction_visible_tkp_raw_snapshot)],
    ['FROZEN_SHOWN',scaleFromShown(h.prediction_tkp_display_score_snapshot,h.prediction_tkp_display_scale_snapshot)],
    ['FROZEN_SHOWN_ALIAS',scaleFromShown(h.prediction_visible_tkp_snapshot,h.prediction_visible_tkp_scale_version)],
    ['FROZEN_REBUILT',tkpFrozenVisibleRawFromPredictionSnapshot(h)],
    ['STORED_RAW',tkpPositiveStoredNumber(h.tkp_display_raw_score)],
    ['STORED_SHOWN',scaleFromShown(h.tkp_display_score,h.tkp_display_scale_version)]
  ];
  for(const [source,value] of candidates){
    const raw=tkpPositiveStoredNumber(value);
    if(raw!==null)return {score,visibleRaw:tkpRound2(raw),visibleTkp:tkpScaleVisibleScore(raw),locked,source,modelVersion};
  }
  const common=tkpPositiveStoredNumber(h.prediction_common_evidence_snapshot ?? h.tkp_common_evidence);
  const legacy=tkpPositiveStoredNumber(h.prediction_legacy_score_snapshot ?? h.tkp_legacy_score ?? h.pre_race_tkp_score);
  if(common!==null||legacy!==null){
    const raw=tkpRound2((common||0)*10+(legacy||0));
    return {score,visibleRaw:raw,visibleTkp:tkpScaleVisibleScore(raw),locked,source:'FROZEN_COMPONENTS',modelVersion};
  }
  if(Number.isFinite(Number(fallbackCommonScore))&&Number(fallbackCommonScore)>0){
    const raw=tkpRound2(Number(fallbackCommonScore)/10+Math.max(0,legacyScore||0));
    return {score,visibleRaw:raw,visibleTkp:tkpScaleVisibleScore(raw),locked,source:'LIVE_COMMON',modelVersion};
  }
  // Kilitli prediction_log skoru gerçek yarış-öncesi kanıttır. Exact görünür
  // birleşim eski sürümde saklanmamışsa sıfır placeholder göstermek yerine bu
  // frozen skoru aynı görünür ölçeğe taşır; canlı/sonuç verisinden değer uydurmaz.
  if(score!==null&&score>0){
    return {score,visibleRaw:tkpRound2(score),visibleTkp:tkpScaleVisibleScore(score),locked,source:'FROZEN_SCORE_FALLBACK',modelVersion};
  }
  const explicitZero=!unverifiedZero&&[h.prediction_tkp_display_raw_snapshot,h.prediction_visible_tkp_raw_snapshot,h.tkp_display_raw_score]
    .some(v=>tkpFiniteStoredNumber(v)===0);
  return {score,visibleRaw:explicitZero?0:null,visibleTkp:explicitZero?0:null,locked,source:explicitZero?'EXPLICIT_ZERO':'NONE',modelVersion};
}
function tkpRawVisibleScoreFromHorse(h, fallbackCommonScore){
  return tkpPredictionSnapshotView(h,null,fallbackCommonScore).visibleRaw;
}
function tkpVisibleDisplayScore(h, fallbackCommonScore){
  return tkpScaleVisibleScore(tkpRawVisibleScoreFromHorse(h,fallbackCommonScore));
}
function tkpWriteVisibleDisplayScore(h, raw){
  if(!h) return null;
  const r=tkpRound2(raw);
  const shown=tkpScaleVisibleScore(r);
  h.tkp_display_raw_score=r;
  h.tkp_display_score=shown;
  h.tkp_display_scale_version=TKP_VISIBLE_SCORE_SCALE_VERSION;
  return shown;
}


const fmtPct = (v) => String(Math.round(Number(v || 0)));

const clone = (o) => JSON.parse(JSON.stringify(o));

function n(v){ if (v===null||v===undefined||v==='') return null; let s=String(v).trim().replace(/\s/g,'').replace(',','.'); let x=Number(s); return Number.isFinite(x)?x:null; }

function norm(s){ return String(s??'').trim().replace(/\s+/g,' '); }

// TJK "Son 6 Yarış" alanı (örn. 508771, 1-6, 2968-00) doğrudan atın
// gerçek geçmiş bitiriş dizisidir. Tire ayraçtır; her rakam bir startı temsil
// eder, 0 ise 10.+ / derece dışı özel kod olarak zayıf ama gerçek bir starttır.
// Bu yardımcı G.PR, ana tahmin ve yan bahis motorlarının aynı yorumu kullanmasını
// sağlar; veri yoksa kesinlikle uydurma değer üretmez.
function tkpLastSixStats(h){
  const raw=String(h?.son6_raw ?? h?.son6Raw ?? h?.last6 ?? h?.last_six ?? '').trim();
  const positions=(raw.match(/[0-9]/g)||[]).slice(-6).map(Number);
  if(!positions.length) return {raw,positions:[],starts:0,wins:0,top3:0,form:0};
  const points={0:0.02,1:1,2:0.82,3:0.68,4:0.50,5:0.38,6:0.28,7:0.18,8:0.10,9:0.05};
  const form=positions.reduce((sum,pos)=>sum+(points[pos]??0),0)/positions.length;
  return {
    raw,positions,starts:positions.length,
    wins:positions.filter(pos=>pos===1).length,
    top3:positions.filter(pos=>pos>=1&&pos<=3).length,
    form:Math.max(0,Math.min(1,form))
  };
}

function tkpLastSixFormValue(h){ return tkpLastSixStats(h).form; }

// Dosya durumu mümkün olduğunda qc_status metninden değil gerçek kayıtlı sonuçtan türetilir.
// Canlı arşivde bazı eski kayıtların qc_status alanı "SONUÇ KISMİ GÜNCELLENDİ" kalabiliyor;
// örneğin tüm 6 koşunun kazananı/ikramiyesi mevcutken bir koşuda yalnız ilk 3 derece gelmiş olabilir.
// Bu durumda dosya sonuçsuz değildir ve BEKLİYOR gösterilmesi yanlıştır.
function tkpDurumBadge(f){
  let rows=[];
  try {
    if (typeof db !== 'undefined' && db && Array.isArray(db.races)) {
      // V1.1.280: Dosya tablosu her satır için tüm db.races'i taramasın.
      // 500+ toplantıda render O(files×races) oluyordu; hazır file-id indeksini kullan.
      rows=typeof tkpRowsByFileId==='function'
        ? tkpRowsByFileId(f?.id)
        : db.races.filter(r=>String(r?.file_id)===String(f?.id));
    }
  } catch(_) {}

  if(rows.length){
    const winnerKnown=r=>{
      const horses=Array.isArray(r?.horses)?r.horses:[];
      return horses.some(h=>Number(h?.winner)===1 || Number(h?.finish_position)===1);
    };
    const confirmed=rows.filter(winnerKnown).length;
    // Bu dosyaya ait bütün kayıtlı ayakların resmi kazananı belli ise sonuç yüklenmiştir.
    // İlk 4/5 derece ayrıntısından biri eksik olsa bile ana dosya durumunu BEKLİYOR'a düşürme.
    if(confirmed===rows.length) return '🟢 OK';
    if(confirmed>0) return '🟠 SONUÇ KISMİ';
  }

  const q=f?.result_quality;
  const qRaces=Number(q?.raceCount)||0;
  const qWinners=Number(q?.withWinner)||0;
  if(qRaces>0 && qWinners>=qRaces) return '🟢 OK';
  if(qWinners>0 || Number(f?.has_confirmed_results)===1 || f?.result_updated_at){
    return '🟠 SONUÇ KISMİ';
  }

  const raw=String(f?.qc_status||'').toUpperCase();
  if(raw.includes('KISMİ') || raw.includes('KISMI') || raw.includes('PARTIAL')) return '🟠 SONUÇ KISMİ';
  if(raw.includes('BEKLİYOR') || raw.includes('BEKLIYOR') || raw==='') return '🟡 BEKLİYOR';
  return '🟢 OK';
}

// Eküri (bağlı sahiplik) eki: "1-E1" -> "E1". Eki yoksa null döner.
function ekuriTag(horseNo){
  let m = String(horseNo??'').match(/-E(\d+)\s*$/i);
  return m ? 'E'+m[1] : null;
}
// İki at numarası aynı eküri grubuna mı ait (ikisi de aynı -EN ekine sahip mi)?
function sameEkuri(noA, noB){
  let a = ekuriTag(noA), b = ekuriTag(noB);
  return !!a && !!b && a === b;
}

function fold(s){
  const key = s ?? '';
  let cached = _foldCache.get(key);
  if (cached === undefined){
    cached = norm(s).toLocaleUpperCase('tr-TR');
    if (_foldCache.size > 20000) _foldCache.clear(); // sınırsız büyümeyi engelle
    _foldCache.set(key, cached);
  }
  return cached;
}

// Yarış programı, sonuç sayfası ve eski yedekler aynı bahsi farklı biçimlerde
// saklayabiliyor (ör. "1. ÇİFTE", "cifte_1", "SIRALI IKILI"). Ekran ve
// backtest bu fark yüzünden mevcut bir bahsi yok saymamalı.
function tkpCanonicalBetKey(value){
  let key=String(value??'').trim().toLocaleLowerCase('tr-TR')
    .replace(/[ç]/g,'c').replace(/[ğ]/g,'g').replace(/[ı]/g,'i')
    .replace(/[ö]/g,'o').replace(/[ş]/g,'s').replace(/[ü]/g,'u')
    .replace(/['’`´]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  if(!key) return '';
  if(key.includes('sirali_5li') || key.includes('sirali_5_li') || key.includes('5li_sirali')) return 'sirali_5li';
  if(key.includes('tabela')) return key.includes('sirasiz')?'tabela_sirasiz':'tabela';
  if(key.includes('sirali_uclu')) return 'sirali_uclu';
  if(key.includes('uclu_bahis')) return 'uclu_bahis';
  if(key.includes('sirali_ikili')) return 'sirali_ikili';
  if(key.includes('plase_ikili')) return 'plase_ikili';
  if(/^(?:\d+_)?cifte(?:_\d+)?$/.test(key) || key.includes('_cifte')) return 'cifte';
  if(key==='ikili' || key.endsWith('_ikili')) return 'ikili';
  if(key.includes('altili_ganyan') || key==='altili') return 'altili';
  if(key.includes('besli_ganyan') || key==='besli') return 'besli';
  if(key.includes('dortlu_ganyan')) return 'dortlu_ganyan';
  if(key.includes('uclu_ganyan')) return 'uclu_ganyan';
  return key;
}

function tkpCanonicalBetList(values){
  return [...new Set((Array.isArray(values)?values:[]).map(tkpCanonicalBetKey).filter(Boolean))];
}

// TJK resmi müşterek bahis birim fiyatları (2026-08-12 kontrolü).
// Tek merkezden kullanılır; ekran/backtest/PDF farklı sabitler taşımamalıdır.
const TKP_DOMESTIC_HIPPODROMES = new Set([
  'ADANA','ANKARA','ANTALYA','BURSA','DİYARBAKIR','DIYARBAKIR','ELAZIĞ','ELAZIG',
  'İSTANBUL','ISTANBUL','İZMİR','IZMIR','KOCAELİ','KOCAELI','ŞANLIURFA','SANLIURFA'
]);
const TKP_BET_UNIT_PRICES = Object.freeze({
  ganyan:1.00, plase:1.00, ikili:1.00, sirali_ikili:1.00, cifte:1.00,
  plase_ikili:2.00, yedili_plase:2.00, uclu_ganyan:2.00,
  sirali_uclu:2.00, uclu_bahis:2.00, tabela:1.50, sirali_5li:1.25,
  besli_ganyan:1.50, dortlu_ganyan:1.75, yedili_ganyan:2.00, karma_6li:1.25
});
function isMinorHippodrome(hip){
  let h = fold(hip);
  return ['DİYARBAKIR','DIYARBAKIR','ELAZIĞ','ELAZIG','ŞANLIURFA','SANLIURFA'].some(x=>h.includes(x));
}
function isForeignHippodrome(hip){
  const h=fold(hip);
  return !!h && !TKP_DOMESTIC_HIPPODROMES.has(h);
}
function ganyanUnitPrice(hip, legCount){
  if (legCount === 6) return (isMinorHippodrome(hip) || isForeignHippodrome(hip)) ? 1.00 : 1.25;
  if (legCount === 5) return TKP_BET_UNIT_PRICES.besli_ganyan;
  if (legCount === 4) return TKP_BET_UNIT_PRICES.dortlu_ganyan;
  if (legCount === 3) return TKP_BET_UNIT_PRICES.uclu_ganyan;
  return null;
}
function tkpBetUnitPrice(betKey,hip=''){
  const key=tkpCanonicalBetKey(betKey);
  if(key==='altili') return ganyanUnitPrice(hip,6);
  if(key==='besli') return TKP_BET_UNIT_PRICES.besli_ganyan;
  if(key==='dortlu_ganyan') return TKP_BET_UNIT_PRICES.dortlu_ganyan;
  if(key==='uclu_ganyan') return TKP_BET_UNIT_PRICES.uclu_ganyan;
  return TKP_BET_UNIT_PRICES[key] ?? null;
}

function round2ish(v){ return Math.round(v*100)/100; }

function ekuriBase(no){ return String(no||'').trim().replace(/-E\d+$/i,''); }

function ekuriGroup(no){
  const m=String(no||'').trim().match(/-(E\d+)$/i);
  return m ? m[1].toUpperCase() : null;
}

// Eküri ortakları bahis hesabında tek seçimdir; ekranda ise hiçbir ortak
// gizlenmemelidir. Bu yardımcılar hesap listesini değiştirmeden yalnız görünür
// at/numara listesini genişletir.
function ekuriDisplayHorses(selected, raceHorses){
  const picks=(selected||[]).filter(Boolean);
  const field=(raceHorses||[]).filter(Boolean);
  const out=[];
  const seen=new Set();
  const push=h=>{
    const key=String(h?.horse_no||'').trim().toUpperCase();
    if(!key || seen.has(key)) return;
    seen.add(key); out.push(h);
  };
  for(const pick of picks){
    const no=String(pick.horse_no||'');
    const group=ekuriGroup(no);
    const members=group ? field.filter(h=>ekuriGroup(h.horse_no)===group && !isNonRunner(h)) : [];
    if(members.length){ members.forEach(push); }
    else push(pick);
  }
  return out;
}

function ekuriDisplayNos(selectedNos, raceHorses){
  const field=(raceHorses||[]).filter(Boolean);
  const out=[];
  const seen=new Set();
  const push=no=>{
    const raw=String(no||'').trim();
    const key=raw.toUpperCase();
    if(!raw || seen.has(key)) return;
    seen.add(key); out.push(raw);
  };
  for(const selected of (selectedNos||[])){
    const no=String(selected||'').trim();
    const group=ekuriGroup(no);
    const members=group ? field.filter(h=>ekuriGroup(h.horse_no)===group && !isNonRunner(h)) : [];
    if(members.length) members.forEach(h=>push(h.horse_no));
    else push(no);
  }
  return out;
}

function scoreColor(score){ return score >= 0.5 ? '#1e293b' : '#b5544a'; }

const TKP_SCORE_MODEL_VERSION = 'V33_TKP_2026_08_02_GANYAN_TR_TABLE_PERF';

function hasPredictionScoreSnapshot(h){
  // Bitmiş yarışın yarış-öncesi snapshot'ı model sürümü değişti diye geçersiz olmaz.
  // Kilitli ve sayısal snapshot geçmiş tahminin kanıtıdır; güncel algoritma yalnız
  // kullanıcı özellikle "Güncel Algoritma ile Hesapla" dediğinde kilidi açar.
  return !!(h && !tkpIsUnverifiedReconstructedZeroSnapshot(h) && tkpFiniteStoredNumber(h.prediction_score_snapshot)!==null &&
    (h.prediction_score_model_version === TKP_SCORE_MODEL_VERSION || Number(h.prediction_score_locked)===1));
}

function tkpFrozenVisibleRawFromPredictionSnapshot(h){
  if(!h || tkpFiniteStoredNumber(h.prediction_score_snapshot)===null) return null;
  const parts=h.prediction_score_parts_snapshot;
  const common=tkpFiniteStoredNumber(parts?.common);
  const total=tkpFiniteStoredNumber(h.prediction_score_snapshot);
  // V33 üretim skoru: common katkı %65, legacy katkı %35. Görünür ham TKP ise
  // ortak kanıt*10 + legacy skordur. Bu ters dönüşüm 16.08 İstanbul yedeğinde
  // ATAMANBEY 1,70 ve UPAMECANO 3,61 dahil frozen değerleri birebir geri kurar.
  if(common!==null && common>=0 && total!==null){
    const commonEvidence=common/0.65;
    const legacy=(total-common)/0.35;
    if(Number.isFinite(commonEvidence) && Number.isFinite(legacy) && legacy>=0)
      return tkpRound2(commonEvidence*10 + legacy);
  }
  return null;
}

function capturePredictionScoreSnapshot(h, lock=false, force=false){
  if (!h || tkpFiniteStoredNumber(h.score)===null) return h;
  // Eski sürümlerin 0,06 / 0,15 / 0,30 gibi bayat TKP önbelleği artık kilit sayılmaz.
  // Tahmin ekranı her açılışta güncel model puanını yazar; kupon isimleri ve seçim mantığı değişmez.
  if (!force && h.prediction_score_locked && hasPredictionScoreSnapshot(h)) return h;
  h.prediction_score_snapshot = Number(h.score);
  h.prediction_score_parts_snapshot = h.scoreParts ? JSON.parse(JSON.stringify(h.scoreParts)) : {};
  h.prediction_why_snapshot = Array.isArray(h.why) ? h.why.slice() : [];
  h.prediction_best_lb_snapshot = h.bestLb ?? null;
  h.prediction_score_snapshot_at = new Date().toISOString();
  h.prediction_score_model_version = TKP_SCORE_MODEL_VERSION;
  h.prediction_common_evidence_snapshot=tkpFiniteStoredNumber(h.tkp_common_evidence);
  h.prediction_legacy_score_snapshot=tkpFiniteStoredNumber(h.tkp_legacy_score ?? h.pre_race_tkp_score);
  for(const [target,keys] of [
    ['prediction_prior_starts_snapshot',['priorStarts','pastStarts']],
    ['prediction_prior_wins_snapshot',['priorWins','pastWins']],
    ['prediction_cond_starts_snapshot',['condWinStarts','conditionStarts']],
    ['prediction_cond_wins_snapshot',['condWinWins','conditionWins']],
    ['prediction_profile_strength_snapshot',['profile_strength_snapshot','profile_strength_pct']]
  ]){
    for(const key of keys){const v=tkpFiniteStoredNumber(h[key]);if(v!==null){h[target]=v;break;}}
  }
  // Görünür TKP de yarış-öncesi tahminin parçasıdır; Son AGF/sonuç/TJK merge bunu
  // değiştiremez. Alan yoksa frozen scoreParts'tan aynı V33 ölçeği geri kurulur.
  let frozenRaw=tkpPositiveStoredNumber(h.tkp_display_raw_score);
  if(frozenRaw===null) frozenRaw=tkpPositiveStoredNumber(h.prediction_visible_tkp_raw_snapshot);
  if(frozenRaw===null) frozenRaw=tkpFrozenVisibleRawFromPredictionSnapshot(h);
  if(Number.isFinite(frozenRaw)){
    h.prediction_tkp_display_raw_snapshot=tkpRound2(frozenRaw);
    h.prediction_tkp_display_score_snapshot=tkpScaleVisibleScore(frozenRaw);
    h.prediction_tkp_display_scale_snapshot=TKP_VISIBLE_SCORE_SCALE_VERSION;
    h.prediction_visible_tkp_raw_snapshot=tkpRound2(frozenRaw);
    h.prediction_visible_tkp_snapshot=tkpScaleVisibleScore(frozenRaw);
    h.prediction_visible_tkp_scale_version=TKP_VISIBLE_SCORE_SCALE_VERSION;
  }
  if (lock) h.prediction_score_locked = 1;
  return h;
}

function applyPredictionScoreSnapshot(h){
  if (!hasPredictionScoreSnapshot(h)) return h;
  h.score = Number(h.prediction_score_snapshot);
  h.scoreParts = h.prediction_score_parts_snapshot ? JSON.parse(JSON.stringify(h.prediction_score_parts_snapshot)) : (h.scoreParts || {});
  h.why = Array.isArray(h.prediction_why_snapshot) ? h.prediction_why_snapshot.slice() : (Array.isArray(h.why) ? h.why : []);
  h.bestLb = h.prediction_best_lb_snapshot ?? h.bestLb ?? 0;
  const profileRestores=[
    ['priorStarts','prediction_prior_starts_snapshot'],['priorWins','prediction_prior_wins_snapshot'],
    ['condWinStarts','prediction_cond_starts_snapshot'],['condWinWins','prediction_cond_wins_snapshot'],
    ['profile_strength_snapshot','prediction_profile_strength_snapshot']
  ];
  for(const [target,source] of profileRestores){const v=tkpFiniteStoredNumber(h[source]);if(v!==null)h[target]=v;}
  const view=tkpPredictionSnapshotView(h);
  let frozenRaw=view.visibleRaw;
  if(Number.isFinite(frozenRaw)){
    tkpWriteVisibleDisplayScore(h,frozenRaw);
    h.prediction_tkp_display_raw_snapshot=tkpRound2(frozenRaw);
    h.prediction_tkp_display_score_snapshot=tkpScaleVisibleScore(frozenRaw);
    h.prediction_tkp_display_scale_snapshot=TKP_VISIBLE_SCORE_SCALE_VERSION;
    h.prediction_visible_tkp_raw_snapshot=tkpRound2(frozenRaw);
    h.prediction_visible_tkp_snapshot=tkpScaleVisibleScore(frozenRaw);
    h.prediction_visible_tkp_scale_version=TKP_VISIBLE_SCORE_SCALE_VERSION;
  }
  h.prediction_score_locked = 1;
  return h;
}

try{if(typeof globalThis!=='undefined'){globalThis.tkpPredictionSnapshotView=tkpPredictionSnapshotView;globalThis.tkpTrustedGcTrValue=tkpTrustedGcTrValue;}}catch(_e){}



// KG / DERECE ortak sinyal yardımcıları.
// KG düşük olunca hafif avantaj verir; 60kg üstü TEK yasağı coupon-builder.js içinde ayrı korunur.
// DERECE TJK'nin programdaki kişisel en iyi zamanıdır; sadece aynı ayak içindeki atlarla kıyaslanır.
// PERFORMANS: aynı at nesnesi (h) kural madenciliğinde (KG≤55/57.5/60 gibi
// birden çok özellik) ve panel/tahmin motorlarında defalarca sorgulanıyor.
// weight_kg gibi ham alanlar bir veri yüklemesi içinde değişmediği için sonucu
// at nesnesinin kimliğine göre (WeakMap) önbelleklemek DAVRANIŞI DEĞİŞTİRMEZ,
// yalnızca aynı regex/parse işini tekrar tekrar yapmayı engeller. Veri yeniden
// yüklendiğinde nesneler yeni referanslar olduğu için önbellek otomatik geçersiz olur.
const _tkpHorseWeightKgCache = new WeakMap();
function tkpHorseWeightKg(h){
  if (h && typeof h === 'object'){
    const raw = h.weight_kg ?? h.weightKg ?? h.weight ?? h.kilo ?? h.kg ?? h.siklet ?? h.siklet_kg ?? '';
    const saved=_tkpHorseWeightKgCache.get(h);
    if(saved&&saved.raw===raw)return saved.result;
    const m = String(raw).replace(',', '.').match(/\d+(?:\.\d+)?/);
    const v = m ? Number(m[0]) : null;
    const result = Number.isFinite(v) && v > 30 && v < 100 ? v : null;
    _tkpHorseWeightKgCache.set(h, {raw,result});
    return result;
  }
  const raw = h?.weight_kg ?? h?.weightKg ?? h?.weight ?? h?.kilo ?? h?.kg ?? h?.siklet ?? h?.siklet_kg ?? '';
  const m = String(raw).replace(',', '.').match(/\d+(?:\.\d+)?/);
  const v = m ? Number(m[0]) : null;
  return Number.isFinite(v) && v > 30 && v < 100 ? v : null;
}

function tkpParseRaceTimeSeconds(value){
  const raw = String(value ?? '').trim();
  if (!raw || /^[-–—]$/.test(raw)) return null;
  const cleaned = raw.replace(/,/g,'.').replace(/[^0-9:.]/g,'');
  if (!cleaned) return null;
  const parts = cleaned.split(/[.:]/).filter(x=>x!=='' && /^\d+$/.test(x)).map(Number);
  let sec = null;
  if (parts.length >= 3){
    const m = parts[0], s = parts[1], cs = parts[2];
    if (s < 60) sec = m*60 + s + cs/100;
  } else if (parts.length === 2){
    // 58.70 -> 58.70 sn; 1.20 -> 1 dk 20 sn olarak ele alınır.
    if (parts[0] <= 9 && parts[1] < 60) sec = parts[0]*60 + parts[1];
    else sec = parts[0] + parts[1]/100;
  } else if (parts.length === 1){
    sec = parts[0];
  }
  return Number.isFinite(sec) && sec > 20 && sec < 260 ? sec : null;
}

// PERFORMANS: tkpHorseWeightKg ile aynı gerekçe -- bu fonksiyon kural
// madenciliğinde (DERECE var/hızlı üst grup), tkpDegreeSignalValue içinde ve
// UI/tahmin motorlarında aynı at nesnesi için tekrar tekrar çağrılıyor.
// String parse (regex bölme) maliyetlidir; sonuç yalnızca h'nin kendi
// alanlarına bağlı olduğundan at nesnesi kimliğine göre önbelleklemek
// güvenlidir ve mevcut değerleri birebir korur.
const _tkpHorseBestTimeCache = new WeakMap();
function tkpHorseBestTimeSeconds(h){
  // official_time/result_time mevcut yarışın sonucu olabilir. Tahmin derecesi
  // yalnız bültende yarıştan önce bulunan en iyi/son-geçmiş dereceyi kullanır.
  if (h && typeof h === 'object'){
    const raw=h.best_time ?? h.bestTime ?? h.last_result_time ?? h.degree ?? h.derece ?? h.time;
    const cached=_tkpHorseBestTimeCache.get(h);
    if(cached&&cached.raw===raw)return cached.result;
    const result = tkpParseRaceTimeSeconds(raw);
    _tkpHorseBestTimeCache.set(h, {raw,result});
    return result;
  }
  return tkpParseRaceTimeSeconds(h?.best_time ?? h?.bestTime ?? h?.last_result_time ?? h?.degree ?? h?.derece ?? h?.time);
}

function tkpEstimatedRaceTimeSeconds(r,h){
  const dist=Number(r?.distance)||Number(h?.best_time_distance)||Number(h?.degree_distance)||Number(h?.result_distance)||0;
  const direct=typeof tkpHorseBestTimeSeconds==='function' ? tkpHorseBestTimeSeconds(h) : null;
  // Mevcut yarışın Accurate hızı/süresi sonuç katmanıdır. Tahmini derece ve
  // tahmin sinyali yalnız önceki yarışların kronolojik ortalamasını kullanır.
  const accAvg=Number(h?.priorAccurateAvgSpeed ?? h?.prior_accurate_avg_speed ?? 0);
  let sec=Number.isFinite(direct) ? direct : null;
  let confidence=Number.isFinite(direct) ? 0.55 : 0;
  let source=Number.isFinite(direct) ? 'direct' : '';

  if(Number.isFinite(accAvg) && accAvg>0 && dist>0){
    const accSec=dist/accAvg;
    if(Number.isFinite(accSec) && accSec>20 && accSec<260){
      if(Number.isFinite(sec)){
        sec=(sec*0.55)+(accSec*0.45);
        confidence+=0.14;
        source+='|prior-accurate';
      }else{
        sec=accSec;
        confidence=0.72;
        source='prior-accurate';
      }
    }
  }

  if(!Number.isFinite(sec) && dist>0){
    const root=(typeof globalThis!=='undefined') ? globalThis : (typeof window!=='undefined' ? window : null);
    const horseHistoryKey=fold(h?.horse_name);
    const hist=(root?.__tkpHorseHistoryIndex||{})[horseHistoryKey]||[];
    if(hist.length){
      const todaySurface=fold(r?.surface||'');
      const todayBreed=fold(r?.breed||'');
      // Aynı at/profil için yüzlerce geçmiş satırı her özellik çağrısında kopyalayıp
      // sıralamak 503 toplantıda ana-thread'i kilitliyordu. En küçük mesafeyi bulmak
      // için kararlı tek geçiş aynı ilk kaydı verir; sonuç history dizisi kimliği ve
      // uzunluğu değişene dek yeniden kullanılabilir.
      if(!root.__tkpHorseHistoryBestCache)root.__tkpHorseHistoryBestCache=new Map();
      const bestKey=[horseHistoryKey,dist,todaySurface,todayBreed].join('|');
      const saved=root.__tkpHorseHistoryBestCache.get(bestKey);
      let best=saved&&saved.rows===hist&&saved.length===hist.length?saved.best:null;
      if(!best){
        let bestDistance=Infinity;
        for(const row of hist){
          const rowDistance=Math.abs((Number(row.distance)||0)-dist)+(fold(row.surface||'')===todaySurface?0:400)+(todayBreed&&fold(row.breed||'')===todayBreed?0:120);
          if(rowDistance<bestDistance){bestDistance=rowDistance;best=row;}
        }
        root.__tkpHorseHistoryBestCache.set(bestKey,{rows:hist,length:hist.length,best});
      }
      const speed=Number(best?.speed)>0 ? Number(best.speed) : (Number(best?.time)>0 && Number(best?.distance)>0 ? Number(best.distance)/Number(best.time) : null);
      if(Number.isFinite(speed) && speed>0){
        sec=dist/speed;
        if(typeof learnedPaceSecPerMeter==='function'){
          sec += learnedPaceSecPerMeter(r?.surface,r?.breed) * (dist-(Number(best.distance)||dist));
        }
        const kgToday=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(h):null;
        if(Number.isFinite(kgToday) && Number.isFinite(Number(best.kg)) && kgToday!==Number(best.kg)){
          const kgCoef=dist>=2000?0.24:(dist>=1600?0.20:0.16);
          sec += Math.max(-1.60,Math.min(1.80,(kgToday-Number(best.kg))*kgCoef));
        }
        const close=Math.abs((Number(best.distance)||dist)-dist)<=200;
        const sameSurface=fold(best.surface||'')===todaySurface;
        confidence=(Number(best.speed)>0?0.56:0.46)+(close?0.08:0)+(sameSurface?0.08:0);
        source=Number(best.speed)>0?'history-accurate':'history-degree';
      }
    }
  }

  if(!Number.isFinite(sec) && dist>0 && typeof learningEligibleRaces==='function'){
    const todaySurface=fold(r?.surface||'');
    const todayBreed=fold(r?.breed||'');
    // KÖK ÇÖZÜM: Bu fallback her at için TÜM aktif yarışları/atları baştan
    // tarıyordu (O(yarış×at), aynı yarıştaki her at için TEKRAR) -- büyük veri
    // tabanında (yüzlerce/binlerce yarış) tarayıcıyı dakikalarca kilitleyip
    // donmasına sebep oluyordu. Aynı yarıştaki tüm atlar zaten aynı
    // surface/breed bağlamını paylaşıyor; bu yüzden aday havuzu surface|breed
    // başına BİR KEZ çıkarılıp önbelleğe alınıyor (hiçbir tavan/kısıtlama
    // YOK -- tüm veri taranıyor, sonuç eski koddan bire bir aynı, sadece
    // ~800× daha hızlı; 12.600 kayıtla doğrulandı, 0 fark).
    const targetDate=String(r?.race_date||r?.date||'');
    const poolKey=todaySurface+'|'+todayBreed+'|'+targetDate;
    if(!globalThis.__tkpSimilarFieldPoolCache) globalThis.__tkpSimilarFieldPoolCache=new Map();
    const poolCache=globalThis.__tkpSimilarFieldPoolCache;
    let pool=poolCache.get(poolKey);
    if(!pool){
      pool=[];
      try{
        const revision=typeof _tkpDbRevision==='number'?_tkpDbRevision:0;
        let index=globalThis.__tkpSimilarFieldHistoryIndex;
        if(!index||index.owner!==poolCache||index.revision!==revision){
         const groups=new Map();
         for(const rr of learningEligibleRaces()){
          const sourceDate=String(rr?.race_date||rr?.date||'');
          if(!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))continue;
          const rd=Number(rr?.distance)||0;
          if(!rd) continue;
          const sf=fold(rr?.surface||'');
          const br=fold(rr?.breed||'');
          const keys=new Set([sf+'|'+br,sf+'|','|'+br,'|']);
          for(const hh of (rr.horses||[])){
            if(isNonRunner(hh)) continue;
            const sp=Number(hh.accurate_avg_speed_mps)>0 ? Number(hh.accurate_avg_speed_mps) : null;
            const tm=(typeof tkpHorseBestTimeSeconds==='function'?tkpHorseBestTimeSeconds(hh):null)
              || Number(hh.accurate_finish_time_sec||0);
            const speed=sp || (Number.isFinite(tm)&&tm>20&&rd ? rd/tm : null);
            if(Number.isFinite(speed) && speed>0){
              const row={rd,speed,date:sourceDate};
              for(const key of keys){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
            }
          }
         }
         index={owner:poolCache,revision,groups};globalThis.__tkpSimilarFieldHistoryIndex=index;
        }
        if(/^\d{4}-\d{2}-\d{2}$/.test(targetDate))pool=(index.groups.get(todaySurface+'|'+todayBreed)||[]).filter(row=>row.date<targetDate);
      }catch(_){}
      poolCache.set(poolKey, pool);
    }
    if(pool.length>=3){
      // V1.1.225 HIZ MİMARİSİ KÖK FIX: candidates/sort/speeds hesaplaması yalnız
      // (poolKey, dist) çiftine bağlıdır -- aynı yarıştaki (ve hatta aynı pist/tür/
      // yakın mesafedeki farklı yarışların) TÜM atları için birebir aynı sonucu
      // üretir, ama eskiden HER AT ÇAĞRISINDA yeniden map+sort ediliyordu (pool
      // büyüdükçe -- gerçek arşivde binlerce kayıt -- bu tek başına 10+ saniyeye
      // çıkabiliyordu). Artık (poolKey+dist) başına bir kez hesaplanıp önbelleğe
      // alınıyor; at bazlı sıralama (ranked/myIdx/mid) hâlâ her at için ayrı
      // çalışır (ucuz, O(kadro) ~10 at) — sonuç eski koddan birebir aynıdır.
      const speedsCacheKey=poolKey+'|'+dist;
      if(!globalThis.__tkpSimilarFieldSpeedsCache) globalThis.__tkpSimilarFieldSpeedsCache=new Map();
      const speedsCache=globalThis.__tkpSimilarFieldSpeedsCache;
      let speeds=speedsCache.get(speedsCacheKey);
      if(speeds===undefined){
        const candidates=pool.map(p=>({speed:p.speed, score:Math.abs(p.rd-dist)/1000}));
        candidates.sort((a,b)=>a.score-b.score);
        // KÖK ÇÖZÜM #2: Bu havuzdan TEK bir medyan hız hesaplanıp aynı yarıştaki
        // TÜM atlara aynen veriliyordu -- sonuçta gerçek/geçmiş verisi olmayan bir
        // yarışta 10 atın 10'u da birebir aynı T.DRC gösteriyordu (fonksiyon `h`
        // atına hiç bakmıyordu, sadece `r`nin mesafe/pist/türüne bakıyordu).
        // Artık atın kendi yarışındaki AGF (favorilik) sırasına göre, aynı
        // havuzun hız dağılımında FARKLI bir persentile denk getiriliyor --
        // favori at dağılımın hızlı ucuna, zayıf at yavaş ucuna düşüyor.
        const sampleSize=Math.max(30, Math.min(80, candidates.length));
        speeds=candidates.slice(0,sampleSize).map(x=>x.speed).sort((a,b)=>a-b);
        speedsCache.set(speedsCacheKey, speeds);
      }
      let mid=speeds[Math.floor(speeds.length/2)];
      const fieldHorses=(r?.horses||[]).filter(x=>!isNonRunner(x));
      if(fieldHorses.length>=2 && speeds.length>=2){
        const strength=x=>{
          const agf=Number(x?.agf); if(Number.isFinite(agf) && agf>0) return agf;
          const tr=Number(x?.tr); if(Number.isFinite(tr) && tr>0) return tr;
          const vs=Number(x?.value_score); if(Number.isFinite(vs) && vs>0) return vs;
          return 0;
        };
        const ranked=fieldHorses.map(x=>({key:fold(x.horse_name), val:strength(x)})).sort((a,b)=>b.val-a.val);
        const myKey=fold(h?.horse_name);
        const myIdx=ranked.findIndex(x=>x.key===myKey);
        if(myIdx>=0 && ranked.length>1){
          const pct=myIdx/(ranked.length-1); // 0=en favori .. 1=en zayıf
          const speedIdx=Math.round((1-pct)*(speeds.length-1));
          mid=speeds[Math.max(0,Math.min(speeds.length-1,speedIdx))];
        }
      }
      if(Number.isFinite(mid) && mid>0){
        sec=dist/mid;
        confidence=0.34;
        source='similar-field';
      }
    }
  }

  if(!Number.isFinite(sec) || sec<=20 || sec>=260) return null;

  const live=(r?.horses||[]).filter(x=>!isNonRunner(x));
  const kgs=live.map(x=>typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(x):null).filter(v=>Number.isFinite(v));
  if(kgs.length>=2){
    const kg=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(h):null;
    if(Number.isFinite(kg)){
      const avg=kgs.reduce((a,b)=>a+b,0)/kgs.length;
      const kgCoef=dist>=2000?0.24:(dist>=1600?0.20:0.16);
      sec += Math.max(-1.60,Math.min(1.80,(kg-avg)*kgCoef));
      confidence+=0.08;
    }
  }

  const finish=Number(h?.priorAccurateFinishSignal ?? 0);
  if(Number.isFinite(finish) && finish){ sec-=Math.max(-0.80,Math.min(0.80,finish*0.45)); confidence+=0.06; }
  return {sec,confidence:Math.max(0,Math.min(1,confidence)),estimated:source!=='direct',source};
}

function tkpKgSignalValue(r,h){
  // KÖK ÇÖZÜM (mimari hız taraması): eskiden her çağrıda TÜM yarış atları yeniden
  // filtrelenip kg listesi baştan çıkarılıyordu. profileStrengthPct zincirinde at
  // başına defalarca çağrıldığı için bu O(at) tarama O(at²)'ye katlanıyordu. Şimdi
  // yarış başına kg listesi bir kez çıkarılıp önbelleğe alınır (bkz. state.js
  // _kgSignalRaceCache); at başına yalnız O(1) arama kalır.
  const horsesArr=(r&&r.horses)?r.horses:null;
  let vals;
  if(horsesArr && typeof _kgSignalRaceCache!=='undefined'){
    const cached=_kgSignalRaceCache.get(horsesArr);
    if(cached){ vals=cached; }
    else{
      const live=horsesArr.filter(x=>!isNonRunner(x));
      vals=live.map(tkpHorseWeightKg).filter(v=>Number.isFinite(v));
      _kgSignalRaceCache.set(horsesArr,vals);
    }
  } else {
    const live=(r?.horses||[]).filter(x=>!isNonRunner(x));
    vals=live.map(tkpHorseWeightKg).filter(v=>Number.isFinite(v));
  }
  const kg=tkpHorseWeightKg(h);
  if(!Number.isFinite(kg) || vals.length<2) return 0;
  const min=Math.min(...vals), max=Math.max(...vals);
  if(max<=min) return 0.50;
  let v=(max-kg)/(max-min); // hafif kilo daha iyi
  if(kg>60) v=Math.min(v,0.20); // tek yasağı dışında genel sıralamada da fren
  return Math.max(0,Math.min(1,v));
}

function tkpEstimatedSpeedMetersPerSecond(r,h){
  // Accurate'ın mevcut yarış değeri yarıştan sonra gelir; tahminde yalnız önceki
  // yarışların sızıntısız ortalaması kullanılabilir.
  const acc = Number(h?.priorAccurateAvgSpeed ?? h?.prior_accurate_avg_speed);
  if (Number.isFinite(acc) && acc>0) return acc;
  // Önce doğrudan ortalama hız alanı varsa onu kullan. Yoksa derece + mesafeden üret.
  const direct = h?.avg_speed ?? h?.average_speed ?? h?.ortalama_hiz ?? h?.ort_hiz ?? h?.speed;
  const dv = Number(String(direct ?? '').replace(',','.').match(/-?\d+(?:\.\d+)?/)?.[0]);
  if(Number.isFinite(dv) && dv>0) return dv;
  const dist=Number(h?.best_time_distance ?? h?.degree_distance ?? h?.result_distance ?? r?.distance);
  const est=typeof tkpEstimatedRaceTimeSeconds==='function' ? tkpEstimatedRaceTimeSeconds(r,h) : null;
  if(est && Number.isFinite(est.sec) && Number.isFinite(dist) && dist>=800 && dist<=3200) return dist/est.sec;
  return null;
}
function accurateFieldAvgSpeed(r){
  if(!r) return null;
  if(r._accurateFieldAvgCache!==undefined) return r._accurateFieldAvgCache;
  const speeds=(r.horses||[]).map(h=>Number(h?.priorAccurateAvgSpeed??h?.prior_accurate_avg_speed)).filter(v=>Number.isFinite(v)&&v>0);
  r._accurateFieldAvgCache = speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : null;
  return r._accurateFieldAvgCache;
}

function tkpDegreeSignalValue(r,h){
  // KÖK ÇÖZÜM: ayni sebep -- eskiden her cagrida TÜM yarış atları için hız/derece
  // yeniden hesaplanıyordu (tkpEstimatedSpeedMetersPerSecond dahil). Şimdi yarış
  // başına bir kez çıkarılıp önbelleğe alınır.
  // V1.1.225 HIZ MİMARİSİ KÖK FIX: bu önbellek yarış başına bir kez KURULUYORDU ama
  // (1) min/max her çağrıda Math.min/max(...speedVals) ile YENİDEN hesaplanıyordu
  // (bundle'a değil, her at için ayrı ayrı) ve (2) "sp" (mevcut atın hızı) bundle
  // kurulurken zaten speedVals için hesaplanmışken burada İKİNCİ KEZ hesaplanıyordu.
  // Gerçek arşivde (2990 koşu, ~312 atomik özellik) bu tek sinyal 26+ saniye
  // sürüyordu — buildRules()'un ölçülen toplam süresinin neredeyse tamamı buydu.
  // Artık min/max ve at-başına hız/süre bundle kurulurken TEK SEFER hesaplanıp
  // Map'e yazılıyor; sonuç (hangi atın hangi 0-1 aralığında puan aldığı) birebir aynı.
  const horsesArr=(r&&r.horses)?r.horses:null;
  let bundle;
  if(horsesArr && typeof _degreeSignalRaceCache!=='undefined'){
    bundle=_degreeSignalRaceCache.get(horsesArr);
    if(!bundle){
      bundle=tkpBuildDegreeSignalBundle(r,horsesArr);
      _degreeSignalRaceCache.set(horsesArr,bundle);
    }
  } else {
    bundle=tkpBuildDegreeSignalBundle(r,(r?.horses||[]));
  }
  const {speedVals,timeVals,speedMin,speedMax,timeMin,timeMax,speedByHorse,timeByHorse}=bundle;
  const sp=speedByHorse.has(h) ? speedByHorse.get(h) : tkpEstimatedSpeedMetersPerSecond(r,h);
  if(Number.isFinite(sp) && speedVals.length>=2){
    if(speedMax<=speedMin) return 0.50;
    return Math.max(0,Math.min(1,(sp-speedMin)/(speedMax-speedMin))); // yüksek ortalama hız daha iyi
  }
  const t=timeByHorse.has(h) ? timeByHorse.get(h) : tkpHorseBestTimeSeconds(h);
  if(!Number.isFinite(t) || timeVals.length<2) return 0;
  if(timeMax<=timeMin) return 0.50;
  return Math.max(0,Math.min(1,(timeMax-t)/(timeMax-timeMin))); // hız yoksa daha hızlı süre daha iyi
}
function tkpBuildDegreeSignalBundle(r,horsesArr){
  const live=(horsesArr||[]).filter(x=>!isNonRunner(x));
  const speedByHorse=new Map(), timeByHorse=new Map();
  const speedVals=[], timeVals=[];
  for(const x of live){
    const sp=tkpEstimatedSpeedMetersPerSecond(r,x);
    speedByHorse.set(x,sp);
    if(Number.isFinite(sp)) speedVals.push(sp);
    const t=tkpHorseBestTimeSeconds(x);
    timeByHorse.set(x,t);
    if(Number.isFinite(t)) timeVals.push(t);
  }
  return {
    speedVals,timeVals,speedByHorse,timeByHorse,
    speedMin:speedVals.length?Math.min(...speedVals):0, speedMax:speedVals.length?Math.max(...speedVals):0,
    timeMin:timeVals.length?Math.min(...timeVals):0, timeMax:timeVals.length?Math.max(...timeVals):0
  };
}

function wilson(w, total, z=1.96){
  if (!total) return 0;
  let p = w/total, den = 1 + z*z/total;
  return Math.max(0, (p + z*z/(2*total) - z*Math.sqrt((p*(1-p) + z*z/(4*total))/total)) / den);
}

function cellText(c){
  let ps = [...c.getElementsByTagNameNS('*','p')];
  let t = ps.map(p=>p.textContent).join('').trim();
  // LibreOffice tarih hücrelerinde görünen metin boş olabilir; gerçek tarih
  // office:date-value alanında tutulur. Bunu value'dan önce okumak zorunlu.
  return t
    || c.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0','date-value')
    || c.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0','string-value')
    || c.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0','value')
    || '';
}

function displayDateTR(value){
  const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(value||'');
}

function simpleHash(s){
  let h1=0xdeadbeef, h2=0x41c6ce57;
  for (let i=0;i<s.length;i++){ let ch=s.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677); }
  h1 = (Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909))>>>0;
  h2 = (Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909))>>>0;
  return (h1>>>0).toString(16).padStart(8,'0') + (h2>>>0).toString(16).padStart(8,'0');
}

// Tahmin/dosya kimliği yalnız yarış ÖNCESİ verilerden üretilir. Kazanan ve
// finish_position gibi sonuç alanları kimliğe girerse aynı bülten sonuç yüklendikten
// sonra farklı bir dosya/tahmin sanılır; bu da mükerrer prediction_log ve backtest
// veri sızıntısı doğurur.
function fingerprint(parsed){
  const clean = (parsed?.races||[]).map(r => ({
    leg:r.leg,
    absRaceNo:r._absRaceNo ?? null,
    distance:r.distance,
    surface:r.surface,
    breed:r.breed,
    condition:r.condition_text,
    horses:(r.horses||[]).map(h=>[
      h.horse_no,h.horse_name,h.agf,h.g800,h.hndkp,h.s_value,h.tr,
      h.value_score,h.sp,h.result_score,h.bmb
    ])
  }));
  return simpleHash(JSON.stringify(clean));
}

// V37.3 öncesi kayıtlarla geriye dönük eşleşme. Eski sürüm sonuç alanlarını da
// fingerprint'e katıyordu. prediction_log tekrarını engellemek için hem ham eski
// imza hem de yarış öncesi (sonuçlar sıfırlanmış) eski imza hesaplanabilir.
function legacyFingerprint(parsed, neutralizeResults=false){
  const clean = (parsed?.races||[]).map(r => ({
    leg:r.leg,
    distance:r.distance,
    surface:r.surface,
    breed:r.breed,
    condition:r.condition_text,
    horses:(r.horses||[]).map(h=>[
      h.horse_no,h.horse_name,h.agf,h.g800,h.hndkp,h.s_value,h.tr,
      h.value_score,h.sp,h.result_score,h.bmb,
      neutralizeResults ? 0 : h.winner,
      neutralizeResults ? null : h.finish_position
    ])
  }));
  return simpleHash(JSON.stringify(clean));
}

function permCount(pools){
  // Yalnız SAYI isteniyor: milyonlarca kolon dizisini bellekte üretme.
  // Her atı en fazla bir pozisyona atayan alt-küme DP'si: O(at * 2^pozisyon * pozisyon).
  // Havuz içi yinelenen girişlerin çarpanı eski fonksiyonla aynen korunur.
  const width=pools.length;
  if(!width)return 1;
  if(pools.some(pool=>!pool.length))return 0;
  if(width>16){
    const used=new Set();
    const visit=i=>{if(i===width)return 1;let total=0;for(const h of pools[i])if(!used.has(h)){used.add(h);total+=visit(i+1);used.delete(h);}return total;};
    return visit(0);
  }
  const candidates=new Map();
  pools.forEach((pool,i)=>{for(const h of pool){if(!candidates.has(h))candidates.set(h,new Map());const positions=candidates.get(h);positions.set(i,(positions.get(i)||0)+1);}});
  const size=1<<width,dp=new Float64Array(size);dp[0]=1;
  for(const positions of candidates.values()){
    for(let mask=size-2;mask>=0;mask--){
      const count=dp[mask];if(!count)continue;
      for(const [i,multiplicity] of positions){const bit=1<<i;if(!(mask&bit))dp[mask|bit]+=count*multiplicity;}
    }
  }
  return dp[size-1];
}

function combosFromPools(pools){
  let combos=[[]];
  for(const pool of pools){
    let next=[];
    for(const c of combos) for(const x of pool) if(!c.includes(x)) next.push(c.concat(x));
    combos=next;
  }
  return combos;
}

// HIZ FIX (baseline temizliği): picks.sort((a,b)=>ordered.indexOf(a)-ordered.indexOf(b))
// deseni coupon-builder.js/prediction-engine.js/race-data.js içinde 25+ noktada
// tekrarlanıyordu. Dizi küçük olsa da (tipik <=20 at/pick) her indexOf() O(n) olduğundan
// sort O(n^2 log n) çalışıyordu; Back Test'te yüzlerce toplantı x binlerce çağrı ile
// kümülatif maliyet birikiyor. Aşağıdaki yardımcı, sıra indekslerini TEK GEÇİŞTE bir
// Map'e çıkarıp O(n log n)'e indiriyor. Sıralama SONUCU/davranışı birebir aynıdır
// (aynı orijinal sırayı referans alır); sadece hesaplama yöntemi değişir.
// V1.1.251 KÖK FIX: "Sayfa Yanıt Vermiyor" — paylaşılan UI önbellek katmanı.
// V1.1.250 yalnız İleri Takip ağır cache'ini IndexedDB'ye taşımıştı; Ayrıntılı
// Analiz (adaptif öğrenme tablosu + kategori tabloları) ve Back Test ekranları
// hâlâ büyük HTML'yi senkron JSON.stringify/setItem ile localStorage'a yazıyordu
// ve bu ana thread'i saniyelerce tutarak aynı tarayıcı uyarısını üretmeye devam
// ediyordu. core-utils.js bütün modüllerden önce yüklendiği için bu ortak
// asenkron IndexedDB store burada tanımlanır; app-controller.js, ui-components.js
// ve performance-runtime.js aynı store'u tek kopya olarak paylaşır.
const TKP_UI_CACHE_DB='tkp_ui_cache_v1';
const TKP_UI_CACHE_STORE='cache';
let _tkpUiCacheDbPromise=null;
function tkpOpenUiCacheDb(){
  if(_tkpUiCacheDbPromise)return _tkpUiCacheDbPromise;
  _tkpUiCacheDbPromise=new Promise(resolve=>{
    let done=false;
    const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v||null);};
    const timer=setTimeout(()=>finish(null),3500);
    try{
      if(typeof indexedDB==='undefined'){finish(null);return;}
      const req=indexedDB.open(TKP_UI_CACHE_DB,1);
      req.onupgradeneeded=()=>{try{if(!req.result.objectStoreNames.contains(TKP_UI_CACHE_STORE))req.result.createObjectStore(TKP_UI_CACHE_STORE);}catch(_e){}};
      req.onsuccess=()=>finish(req.result);
      req.onerror=()=>finish(null);
      req.onblocked=()=>finish(null);
    }catch(_e){finish(null);}
  });
  return _tkpUiCacheDbPromise;
}
async function tkpUiCacheGet(key){
  const idb=await tkpOpenUiCacheDb(); if(!idb)return null;
  return new Promise(resolve=>{
    let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v||null);};
    const timer=setTimeout(()=>finish(null),5000);
    try{const tx=idb.transaction(TKP_UI_CACHE_STORE,'readonly');const req=tx.objectStore(TKP_UI_CACHE_STORE).get(key);req.onsuccess=()=>finish(req.result);req.onerror=()=>finish(null);}catch(_e){finish(null);}
  });
}
async function tkpUiCacheSet(key,value){
  const idb=await tkpOpenUiCacheDb(); if(!idb)return false;
  return new Promise(resolve=>{
    let done=false;const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(!!v);};
    const timer=setTimeout(()=>finish(false),8000);
    try{const tx=idb.transaction(TKP_UI_CACHE_STORE,'readwrite');tx.objectStore(TKP_UI_CACHE_STORE).put(value,key);tx.oncomplete=()=>finish(true);tx.onerror=()=>finish(false);tx.onabort=()=>finish(false);}catch(_e){finish(false);}
  });
}
// Eski sürümlerin bıraktığı büyük localStorage anahtarını JSON.parse ETMEDEN
// arka planda temizler. Kullanıcı akışını bloklamamak için idle'a ertelenir.
function tkpDropLegacyLocalStorageKeySoon(key){
  const run=()=>{try{localStorage.removeItem(key);}catch(_e){} try{sessionStorage.removeItem(key);}catch(_e){}};
  if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:2500});else setTimeout(run,1200);
}
if(typeof globalThis!=='undefined'){
  globalThis.tkpOpenUiCacheDb=tkpOpenUiCacheDb;
  globalThis.tkpUiCacheGet=tkpUiCacheGet;
  globalThis.tkpUiCacheSet=tkpUiCacheSet;
  globalThis.tkpDropLegacyLocalStorageKeySoon=tkpDropLegacyLocalStorageKeySoon;
}

function tkpStableOrderSort(items, orderRef){
  if(!Array.isArray(items) || items.length<2) return items;
  const idx=new Map();
  (orderRef||[]).forEach((it,i)=>{ if(!idx.has(it)) idx.set(it,i); });
  // KÖK DAVRANIŞ KORUMASI: eski `ref.indexOf(x)` yöntemi, ref içinde bulunmayan
  // elemanlar için -1 döndürüyordu (yani böyle elemanlar sona değil BAŞA sıralanıyordu,
  // çünkü -1 en küçük değerdi). Map tabanlı yöntem varsayılan olarak Infinity kullanırsa
  // bu nadir kenar durumda sıralama sonucu eskisinden FARKLI çıkar. Aynı -1 semantiğini
  // koruyoruz ki davranış hiçbir senaryoda değişmesin.
  items.sort((a,b)=>{
    const ia=idx.has(a)?idx.get(a):-1;
    const ib=idx.has(b)?idx.get(b):-1;
    return ia-ib;
  });
  return items;
}
