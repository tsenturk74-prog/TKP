/*
 * TKP baseline kanıt defteri.
 *
 * Bu dosya çalışma sırasında kullanılan geçici yardımcıları sisteme eklemez.
 * Sadece hangi davranışın hangi regresyon kanıtıyla korunduğunu uygulama içinde
 * ekranda göstermeden dışa aktarılabilir tutar. Son paketleme adımında finalRun alanı
 * güncellenir; sonuç "PASS" olmadan bu paket baseline olarak işaretlenmez.
 */
(function(global){
  'use strict';

  const VERSION='V1.1.333-R16.93-EVIDENCE-2026-09-07';
  const FINAL_RUN={
    state:'LOCAL_CHECKS_ONLY',
    completedAt:'2026-09-07',
    suite:'R16.79 tam yerel regresyon ve kaydedilmiş gerçek TJK HTML kontrolü',
    passed:136,
    total:136,
    liveVerified:false,
    note:'136 yerel regresyon testi geçti. Kaydedilmiş 12 TJK HTML dosyasında 100 koşunun İlk-5 sırası doğrulandı. Bu kayıt tüm uygulamanın veya mevcut kurulumdaki canlı kaynakların hatasız olduğunu kanıtlamaz. 144 algoritma adayı için başarı sonucu henüz yok. Ayrıntılar DOGRULAMA klasöründedir.'
  };

  const CHECKS=Object.freeze([
    {id:'source-policy',title:'Kaynak sahipliği',test:'historical-source-contract + historical-provenance-persistence + tr-source-provenance + collector-yenibeygir-fallback-contract',scope:'TJK program/ST/KG/HNDKP/DRC; tarihsel TR yalnız Ganyan Canavarı; GLP/J-BYG Ganyan Canavarı birincil, yalnız aynı alan eksikse Yeni Beygir GLP/J-BYG fallback. Atlagel ve diğer geçmiş kaynaklar kapalı.',kind:'INTEGRITY'},
    {id:'gc-program-p',title:'Ganyan Canavarı P sütunu',test:'historical-source-contract',scope:'Yalnız programdaki forma yanındaki P/At_Puan alınır. Tarih, şehir, koşu ve at kimliği birlikte doğrulanır; çelişkili metadata reddedilir.',kind:'REGRESSION'},
    {id:'collector-critical-path',title:'Veri → ayak → üç kupon',test:'ready-coupon-critical-path + task-barrier-runtime + prediction-first-paint-nonblocking',scope:'İlk ekran tam üçlü kupon renderer\'ını beklemez. Arka plan bariyeri açıkken USER üç-kupon görevi geçer; BH/istatistik/A4 yalnız kartlardan sonra tek sahipte başlar.',kind:'PERFORMANCE'},
    {id:'startup-read',title:'Açılış ve segmentli arşiv okuma',test:'segmented-startup-read + preboot-pane-guard',scope:'4 MB sınırlı okuma, tur başına tek transaction; DB hazır olmadan ağır pane rendererı çalışmaz.',kind:'PERFORMANCE'},
    {id:'no-recompute',title:'Değişmeyen veri yeniden hesaplanmaz',test:'no-change-artifact-ledger + restart-cache-and-compact-ui',scope:'Restart, Başlangıç Menüsü ve Ctrl+F5 kayıtlı tahmin/üç kupon/yan bahis/istatistiği açar; yalnız veri imzası değişirse yeniler.',kind:'INTEGRITY'},
    {id:'final-agf',title:'Son AGF kısmi güncellemesi',test:'no-change-artifact-ledger',scope:'AGF/AGF sırası/koşmayan değişirse bir kez yeniler; diğer kaynak hashlerini silmez.',kind:'INTEGRITY'},
    {id:'statistics',title:'Arşiv istatistikleri',test:'archive-page-population + archived-statistics-progress',scope:'Sonuçlu geçmiş havuzu tabloları besler; büyük arşiv cooperative parçalarla çizilir ve cache kullanır.',kind:'PERFORMANCE'},
    {id:'tkp-snapshot',title:'TKP puanı ve geçmiş profil',test:'tkp-snapshot-restore',scope:'Pozitif frozen/eski TKP placeholder 0 tarafından ezilmez; Genel Bakış, ayak ve A4 aynı yarış-öncesi puanı kullanır.',kind:'INTEGRITY'},
    {id:'izmir508-format',title:'23.08.2026 İzmir 508 formatı',test:'izmir508-format-contract + bh-two-bomb-one-odb',scope:'TKP, geçmiş profil, BH1/BH2/ODB1, PAS/TEMKİNLİ ve kompakt kart/ayak tablosu korunur.',kind:'UI'},
    {id:'buttons',title:'Düğmeler ve eksik destek',test:'button-handler-and-missing-support',scope:'Ana ve collector düğmeleri gerçek handler taşır; eksik destek toplama kaynağa bağlı çalışır.',kind:'REGRESSION'},
    {id:'sidebet',title:'Yan bahis ve A4 hazırlığı',test:'performance-bottleneck-contract + restart-cache-and-compact-ui + coupon-snapshot-fast-path',scope:'Yan bahis/A4 kullanılabilir ekranı bekletmez; kalıcı imza/cache aynı veride ikinci iş üretmez. Kupon WAL ve dar kapsamlı snapshot invalidation kartları bekletmez.',kind:'PERFORMANCE'},
    {id:'commentator-kulis',title:'Yorumcu/Kulis konsensüsü',test:'commentator-ready-consensus',scope:'Tek yorumları ayrı değerlendirilir; canlı TEK için bağımsız kaynak uzlaşması korunur.',kind:'GOVERNANCE'},
    {id:'tracking-center',title:'Takip Merkezi ve blok kaynağı',test:'tracking-center-and-bottleneck-source',scope:'Yorumcu başarısı Sistem ekranından ayrıdır. İlk Bakış lideri ile canonical güvenilir TEK ayrı snapshot metriklerinde izlenir; uzun ana-thread blokları düğme/kuyruk/açılış kaynağıyla etiketlenir.',kind:'PERFORMANCE'},
    {id:'prediction-critical-path-telemetry',title:'Tahmin kritik-yol süre takibi',test:'prediction-critical-path-telemetry',scope:'Veri toplama, eksik destek, kulis, üç kupon, istatistik ve Back Test aynı süre defterine yazılır; kuyrukta bekleme ile gerçek çalışma ayrı görünür.',kind:'PERFORMANCE'},
    {id:'champion-challenger',title:'Altılı ve yan bahis canlı terfi kapısı',test:'champion-challenger-forward-gate',scope:'Holdout kaybeden aday Championı değiştirmez; aynı yarışta kilitli üç-kupon portföyü eşlenik test/maliyetle ölçülür. Yan bahis ROI ve ödeme yoğunlaşması birlikte geçmeden SHADOW kalır.',kind:'GOVERNANCE'},
    {id:'r16-engine',title:'R16 Challenger motoru',test:'r16-selective-single-contract + r16-archive-single-evidence + r16-baseline-release-contract',scope:'Champion anchor + Market Residual + Pairwise + Race-Type Experts + Meta Ensemble + Sidebet Position; P1 yalniz Selective TEK guven kapisiyla degisir.',kind:'MODEL'},
    {id:'win81-fast-start',title:'Windows 8.1 hizli acilis',test:'r16-win81-fast-start-contract',scope:'PowerShell 4/5.1 uyumlu bootstrap; saglam runtime Repair ile yeniden npm/Node kurulmaz; dogrulanmis Chrome/Chromium UI icin dogrudan kullanilir; collector gizli baslar.',kind:'PERFORMANCE'},
    {id:'package-gate',title:'Baseline paket kapısı',test:'baseline-integrity-tracking + DOGRULAMA/BASELINE_VALIDATE.cjs',scope:'Manifest dosya hashleri, sürüm, kolektör kimliği ve tam TKP regresyonu geçmeden baseline geçerli sayılmaz.',kind:'INTEGRITY'}
  ]);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function snapshot(){
    return {version:VERSION,finalRun:{...FINAL_RUN},checks:CHECKS.map(row=>({...row}))};
  }
  function evidenceHTML(){
    // Baseline evidence remains exportable; the application screen stays focused on use.
    return '';
  }
  global.TKP_BASELINE_EVIDENCE_VERSION=VERSION;
  global.tkpBaselineEvidenceSnapshot=snapshot;
  global.tkpBaselineEvidenceHTML=evidenceHTML;
})(typeof globalThis!=='undefined'?globalThis:window);
