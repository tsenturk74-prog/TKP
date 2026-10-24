// GERİ-ALMA sonrası tek-sefer otomatik migrasyon (2026-10-24):
// 2.000-2.200 TL bütçe denemesi geri alındı; bütçe yeniden 2.500-3.000 TL.
// Ama 26.08 öncesi "HISTORICAL_CALIBRATION_FULL" (donmuş geçmiş kalibrasyon /
// backtest kanıtı) snapshot'ları ESKİ düşük bütçeyle (~2.016-2.160 TL) kalmıştı;
// ekranda "güncel maliyet" olarak 2.160 görünüyordu. Bu migrasyon, güncel min
// bütçenin (2.500) altında kalmış bu DONMUŞ araştırma kuponlarını siler; uygulamanın
// KENDİ üreticisi (tkpEnsureHistoricalCouponSnapshots → buildHistoricalArchiveCouponSet,
// budget 3000) eksikleri güncel kuralla 2.500-3.000 bandında, coupons+evaluations+
// forward takip dahil DOĞRU şekilde yeniden kurar. Gerçek yarış-öncesi/MANUEL/SON_KUPON
// kayıtlarına DOKUNULMAZ. Tek sefer (settings.__rev3000_regen_done bayrağı); tamamlanınca
// sonraki açılışlarda no-op. Buton yok; açılışta düşük öncelikli arka planda çalışır.
(function(g){
  'use strict';
  const ROLES=['main','alt','surprise'];
  const DONE_FLAG='rev2500_3000_v1';
  function maxCost(x){let m=0;for(const r of ROLES){const c=Number(x&&x.coupons&&x.coupons[r]&&x.coupons[r].cost)||0;if(c>m)m=c;}return m;}
  async function run(){
    if(g.__tkpRev3000Running)return {running:true};
    g.__tkpRev3000Running=true;
    try{
      const d=g.db;
      if(!d||!Array.isArray(d.auto_coupon_log))return {skipped:'no-db'};
      d.settings=d.settings||{};
      if(d.settings.__rev3000_regen_done===DONE_FLAG)return {skipped:'already-done'};
      if(typeof g.tkpEnsureHistoricalCouponSnapshots!=='function')return {skipped:'no-ensure-fn'};
      const minB=Number(g.TKP_COUPON_FEE_POLICY&&g.TKP_COUPON_FEE_POLICY.minBudgetTL)||2500;
      // Güncel min bütçenin (2.500) altında kalmış DONMUŞ geçmiş kalibrasyon
      // kuponlarını sil. Uygulamanın KENDİ üreticisi (ensure…) tek geçişte,
      // normal kurulumdaki gibi, eksik kapsamı güncel kuralla (3000) yeniden kurar.
      const stale=d.auto_coupon_log.filter(x=>x&&x.source==='HISTORICAL_CALIBRATION_FULL'&&maxCost(x)<minB-1e-9);
      const delIds=new Set(stale.map(x=>String(x.id)));
      let removed=0;
      if(delIds.size){
        const before=d.auto_coupon_log.length;
        d.auto_coupon_log=d.auto_coupon_log.filter(x=>!delIds.has(String(x.id)));
        removed=before-d.auto_coupon_log.length;
        try{ if(typeof g.saveDB==='function') g.saveDB(false); }catch(_e){}
      }
      let rebuilt=null;
      try{ rebuilt=await g.tkpEnsureHistoricalCouponSnapshots({foreground:false}); }
      catch(e){ console.warn('rev3000: yeniden kurma hatası',e); return {removed,error:String(e&&e.message||e)}; }
      d.settings.__rev3000_regen_done=DONE_FLAG;
      try{ if(typeof g.saveDB==='function') g.saveDB(false); }catch(_e){}
      try{ if(typeof g.tkpInvalidateFastBacktestCache==='function') g.tkpInvalidateFastBacktestCache(); }catch(_e){}
      try{ if(typeof g.renderAll==='function') g.renderAll(); }catch(_e){}
      console.warn('TKP rev3000: '+removed+' eski (<'+minB+' TL) donmuş kalibrasyon kuponu silindi; güncel kuralla 2.500-3.000 bandında yeniden üretildi.',rebuilt||'');
      return {removed,rebuilt};
    } finally { g.__tkpRev3000Running=false; }
  }
  g.tkpRev3000Regen=run;
})(globalThis);
