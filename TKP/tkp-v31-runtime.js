/**
 * tkp-v31-runtime.js
 * Dar kapsamlı hız ve T.DRC hesaplama kilidi.
 * Ekran düzenini değiştirmez; sadece tekrar hesapları ve tahmini derece motorunu düzeltir.
 */
(function(global){
  'use strict';
  const VERSION='R16_68_INDEXED_TDRC';
  const memo=new Map();
  const tdrcMemo=new Map();

  function arr(v){ return Array.isArray(v)?v:[]; }
  function num(v){ const n=Number(v); return Number.isFinite(n)?n:NaN; }
  function fkey(v){ try{ return typeof fold==='function'?fold(v):String(v||'').toLocaleUpperCase('tr-TR'); }catch(_){ return String(v||'').toLocaleUpperCase('tr-TR'); } }
  function raceKey(r){ return [r?.id,r?.file_id,r?.race_date,r?.hippodrome,r?.leg,r?.distance,r?.surface,r?.condition_family||r?.condition_text].join('|'); }
  function horseKey(h){ return [h?.horse_no,h?.horse_name,Number(h?.score)||0,Number(h?.agf_rank)||0,Number(h?.result_rank)||0,Number(h?.start_no)||0,Number(h?.priorAccurateAvgSpeed)||0,Number(h?.priorAccurateFinishSignal)||0].join(':'); }
  function datasetSig(){
    let d={};
    try{ d=(typeof db!=='undefined'&&db)?db:(global.db||{}); }catch(_){ d=global.db||{}; }
    try{ if(typeof tkpFastDbSignature==='function') return tkpFastDbSignature(d); }catch(_){ }
    try{ if(typeof learningDatasetSignature==='function') return learningDatasetSignature(d); }catch(_){ }
    return [arr(d.files).length,arr(d.races).length,arr(d.prediction_log).length,arr(d.bets).length].join('|');
  }
  function getMemo(key, builder){
    if(memo.has(key)) return memo.get(key);
    const val=builder();
    memo.set(key,val);
    if(memo.size>1200){ const first=memo.keys().next().value; memo.delete(first); }
    return val;
  }
  function clear(){ memo.clear(); tdrcMemo.clear(); similarBandCache.clear(); bandHistoryIndex=null; }
  global.addEventListener && global.addEventListener('tkp:db-changed', clear);
  global.tkpV31ClearRuntimeCache=clear;
  global.tkpV31RuntimeInfo=function(){ return {version:VERSION,memo:memo.size,tdrc:tdrcMemo.size}; };

  function wrap(name, keyer){
    const original=global[name];
    if(typeof original!=='function' || original.__tkpV31Wrapped) return;
    const wrapped=function(...args){
      let key='';
      try{ key=VERSION+'|'+name+'|'+datasetSig()+'|'+keyer(...args); }catch(_){ key=''; }
      if(!key) return original.apply(this,args);
      return getMemo(key,()=>original.apply(this,args));
    };
    wrapped.__tkpV31Wrapped=true;
    wrapped.__tkpOriginal=original;
    global[name]=wrapped;
  }

  // V32: Ekran/render düzenini bozabilecek HTML veya mutable-object üreten fonksiyonlar
  // cache'lenmez. Sadece saf geçmiş istatistik/backtest fonksiyonları memoize edilir.
  wrap('historicalOrder',(r)=>raceKey(r));
  wrap('historicalSideBetOrder',(r)=>raceKey(r));
  wrap('sideBetBacktest',(r)=>raceKey(r));
  wrap('sideBetDoubleBacktest',(r,n)=>raceKey(r)+'>'+raceKey(n));

  function parseTime(value){
    if(typeof tkpParseRaceTimeSeconds==='function') return tkpParseRaceTimeSeconds(value);
    const s=String(value||'').replace(/,/g,'.');
    const m=s.match(/(?:(\d+)[:'’])?(\d{1,2})[.:](\d{1,2})/);
    if(!m) return null;
    const sec=(Number(m[1]||0)*60)+Number(m[2])+Number(m[3])/100;
    return Number.isFinite(sec)&&sec>20&&sec<260?sec:null;
  }
  // Yalnız daha eski yarışların tempo bandında kullanılır. Hedef yarış için bu
  // sonuç zamanı okuyucusuna hiçbir çağrı yapılmaz.
  function historicalTimeOfHorse(h){ return parseTime(h?.result_time)||parseTime(h?.official_time)||parseTime(h?.best_time)||parseTime(h?.degree)||parseTime(h?.derece)||parseTime(h?.time); }
  function percentile(sorted,p){
    if(!sorted.length) return NaN;
    const idx=Math.max(0,Math.min(sorted.length-1,Math.round((sorted.length-1)*p)));
    return sorted[idx];
  }
  function bandFromTimes(times){
    const vals=times.filter(v=>Number.isFinite(v)&&v>20&&v<260).sort((a,b)=>a-b);
    if(vals.length<2) return null;
    return {min:percentile(vals,0.08), median:percentile(vals,0.50), max:percentile(vals,0.92), n:vals.length};
  }
  const similarBandCache=new Map();
  let bandHistoryIndex=null;
  function historyIndex(signature){
    const races=arr(global.db?.races);
    if(bandHistoryIndex&&bandHistoryIndex.signature===signature&&bandHistoryIndex.races===races&&bandHistoryIndex.count===races.length)return bandHistoryIndex.rows;
    const rows=races.map(r=>({race:r,date:String(r?.race_date||r?.date||''),distance:Number(r?.distance)||0,
      surface:fkey(r?.surface),breed:fkey(r?.breed),condition:fkey(r?.condition_family||r?.condition_text),
      times:arr(r?.horses).map(historicalTimeOfHorse).filter(Number.isFinite)}));
    bandHistoryIndex={signature,races,count:races.length,rows};
    return rows;
  }
  function similarRaceBand(r){
    const dist=Number(r?.distance)||0;
    if(!dist || !global.db) return null;
    const signature=datasetSig();
    const targetDate=String(r?.race_date||r?.date||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate))return null;
    const key=[signature,targetDate,fkey(r?.hippodrome),fkey(r?.surface),fkey(r?.breed),fkey(r?.condition_family||r?.condition_text),dist].join('|');
    if(similarBandCache.has(key)) return similarBandCache.get(key);
    const surf=fkey(r?.surface), breed=fkey(r?.breed), cond=fkey(r?.condition_family||r?.condition_text);
    const times=[];
    for(const rr of historyIndex(signature)){
      const sourceDate=rr.date;
      if(rr.race===r || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || sourceDate>=targetDate) continue;
      const rd=rr.distance;
      if(!rd || Math.abs(rd-dist)>300) continue;
      const sf=rr.surface, br=rr.breed, cd=rr.condition;
      let penalty=Math.abs(rd-dist)/100;
      if(surf && sf!==surf) penalty+=5;
      if(breed && br!==breed) penalty+=2;
      if(cond && cd!==cond) penalty+=1;
      if(penalty>7) continue;
      for(const t of rr.times){
        times.push(t + (dist-rd)*0.065);
      }
    }
    const band=bandFromTimes(times);
    similarBandCache.set(key,band);
    if(similarBandCache.size>800){ const first=similarBandCache.keys().next().value; similarBandCache.delete(first); }
    return band;
  }
  function strengthPct(r,h){
    const live=arr(r?.horses).filter(x=>!(typeof isNonRunner==='function'&&isNonRunner(x)));
    if(live.length<2) return 0.50;
    const score=x=>{
      let s=0;
      const tkp=Number(x?.score); if(Number.isFinite(tkp)) s+=tkp*2.2;
      const agfRank=Number(x?.agf_rank); if(Number.isFinite(agfRank)&&agfRank>0) s+=Math.max(0,1-(agfRank-1)/Math.max(6,live.length))*1.1;
      const tr=Number(x?.tr); if(Number.isFinite(tr)&&tr>0) s+=tr/100;
      const yp=Number(x?.ypuan); if(Number.isFinite(yp)&&yp>0) s+=Math.min(1,yp/70)*0.8;
      const acc=Number(x?.priorAccurateAvgSpeed); if(Number.isFinite(acc)&&acc>0) s+=acc/18;
      const finish=Number(x?.priorAccurateFinishSignal); if(Number.isFinite(finish)) s+=finish*0.35;
      const g800=Number(x?.g800); if(Number.isFinite(g800)&&g800>0) s+=Math.max(0,1-(g800-1)/6)*0.45; // GLP / 800G iyi derece
      const kg=typeof tkpHorseWeightKg==='function'?tkpHorseWeightKg(x):null; if(Number.isFinite(kg)) s+=(60-kg)*0.025;
      return s;
    };
    const scores=new Map(live.map(horse=>[horse,score(horse)]));
    const ranked=live.slice().sort((a,b)=>scores.get(b)-scores.get(a));
    const idx=ranked.findIndex(x=>String(x.horse_no)===String(h?.horse_no) || fkey(x.horse_name)===fkey(h?.horse_name));
    if(idx<0) return 0.50;
    return 1-(idx/Math.max(1,ranked.length-1)); // 1 güçlü, 0 zayıf
  }
  function calibrateToBand(sec, band, r, h, confidence){
    if(!band || !Number.isFinite(sec)) return {sec,confidence};
    const spread=Math.max(2.4, Math.min(9.0, (band.max-band.min)||4.0));
    const min=band.min-1.2;
    const max=band.max+1.8;
    const strength=strengthPct(r,h);
    // Güçlü ata hızlı uç, zayıfa yavaş uç. Bu sadece T.DRC kalibrasyonu; gerçek DRC'yi değiştirmez.
    const target=(band.median*0.35)+((band.min + (1-strength)*spread)*0.65);
    const blend=confidence>=0.70 ? 0.22 : confidence>=0.50 ? 0.35 : 0.52;
    let out=(sec*(1-blend))+(target*blend);
    if(out<min) out=(min*0.70)+(target*0.30);
    if(out>max) out=(max*0.70)+(target*0.30);
    out=Math.max(min,Math.min(max,out));
    return {sec:out, confidence:Math.min(1,(confidence||0)+0.10)};
  }

  const originalTDRC=global.tkpEstimatedRaceTimeSeconds;
  if(typeof originalTDRC==='function'){
    const wrapped=function(r,h){
      // The final estimate depends on mutable per-horse inputs. Cache the shared
      // historical band only; otherwise a late Y.PUAN/TR/KG update can reuse an
      // estimate made with old inputs.
      let base=null;
      try{ base=originalTDRC(r,h); }catch(_){ base=null; }
      let sec=base&&Number.isFinite(Number(base.sec))?Number(base.sec):NaN;
      let confidence=base&&Number.isFinite(Number(base.confidence))?Number(base.confidence):0;
      let source=base?.source||'';
      const dist=Number(r?.distance)||0;
      // Kaynak hiç üretilemiyorsa benzer gerçek tempo bandından güvenli ilk tahmin.
      // Mevcut yarışın bitiş süreleri sonuç katmanıdır; kalibrasyon yalnız daha
      // önce koşulmuş benzer yarışların tempo bandından gelir.
      const band=similarRaceBand(r);
      if(!Number.isFinite(sec) && band && dist){
        const st=strengthPct(r,h);
        const spread=Math.max(2.4, Math.min(9.0, (band.max-band.min)||4.0));
        sec=band.min + (1-st)*spread;
        confidence=0.36;
        source='field-band';
      }
      if(!Number.isFinite(sec) || sec<=20 || sec>=260) return base;
      // KG / Accurate / GLP zaten baz fonksiyonda var; burada son saha kalibrasyonu yapılır.
      const calibrated=calibrateToBand(sec, band, r, h, confidence);
      const out=Object.assign({}, base||{}, {
        sec:calibrated.sec,
        confidence:Math.max(0,Math.min(1,calibrated.confidence)),
        estimated: true,
        source: source ? (source+'|field-calibrated') : 'field-calibrated',
        calibrated:true
      });
      return out;
    };
    wrapped.__tkpOriginal=originalTDRC;
    global.tkpEstimatedRaceTimeSeconds=wrapped;
  }

})(window);
