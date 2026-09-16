TKP R17 AutoGluon Challenger
============================
1) KUR_AUTOGLOUON.bat  -> AutoGluon 1.6.1 icin ayrik Python ortami kurar.
2) EGIT_R17.bat        -> Backfilled 3.120 kosuluk arsivden temporal model egitir.
3) BASLAT_R17_CANLI.bat-> 127.0.0.1:3763 sidecar servisini manuel baslatir.

TKP_BOOTSTRAP.ps1, egitilmis model ve R17 Python ortami varsa sidecar'i otomatik baslatir.
Sidecar/model yoksa hata verip ana TKP'yi durdurmaz; R16.94 Champion aynen devam eder.
R17 ancak r17_training_report.json icindeki promotion_gate.pass=true ise canli siralamayi etkiler.


R17.2 ROI + BEST MODEL
- KUR_AUTOGLOUON.bat artik autogluon.tabular[all]==1.6.1 kurar (LightGBM/CatBoost/XGBoost/FastAI vb.).
- EGIT_R17.bat best_quality + 7200 sn model taramasi yapar.
- EGIT_R17_HIZLI.bat 1800 sn medium_quality alternatifidir.
- Promotion gate: LogLoss + Brier + Top1 + normalize resmi Ganyan ROI.
- Portfoy raporu: gercek kayitli Altili + yan bahis cost/return/ROI/MaxDD/kayip serisi.

R17.3 AUDIT GUARD
- Tarihsel holdout model gate ile production gate ayrildi.
- promotion_gate.pass=true modelin holdoutta ustun oldugunu gosterir.
- promotion_gate.production_pass=true olmadan canli siralamayi degistirmez.
- Backfilled eski arsivde yarisoncesi AGF/provenance kaniti yoksa varsayilan production_pass=false olur.
- Canli forward snapshot kaniti veya dogrulanmis pre-race provenance ile production gate acilmalidir.


R17.9 DİNAMİK FORM + MONTE CARLO + AKILLI KUPON DARALTMA
- tkp_r17_autogluon.py: 5 yeni özellik (last3_form_score, track_type_win_rate,
  distance_fit_score, jockey_form_30d, handicap_blend_score). İlk 4'ü tamamen
  zaman-nedensel (shift(1)/geçmişe dönük), 5.'si cari satırın AGF/HNDKP/TR/JBYG
  sırasını harmanlar. Hiçbiri sonuç alanı kullanmaz.
- Canlı bülten için geçmiş veri eğitim sürecinde mevcut olmadığından, eğitim
  her çalıştığında r17_form_index.json (at/jokey'in eğitim kesim tarihine kadar
  olan en güncel durumu) üretilir; tkp_r17_service.py bunu otomatik yükler.
- TKP/tkp-monte-carlo-engine.js: 6 ayaklı kartı N kez (varsayılan 10.000) simüle
  eder, aday kupon havuzlarının ampirik isabet oranı + istikrar (batch varyansı)
  metriklerini üretir. Mevcut r17-ev-roi-portfolio-engine.js'nin analitik
  (Plackett-Luce) olasılığını YENİDEN KULLANIR, ayrı bir skorlama icat etmez.
- TKP/tkp-smart-coupon-filter.js: bütçe (TL) + favori/sürpriz dengesi girdisiyle
  kuponu daraltır. %1 altı olasılıklı atları eler; ayak başına minimum 4 at
  tabanını (algorithm-principles.md) hiçbir koşulda delmez; bütçe aşımında son
  ayaktan geriye doğru kırpar (mevcut enforceCouponCostCap yönü ile aynı).
  Orijinal kupon nesnesini mutasyona uğratmaz.
- Kupon üretim zincirine (coupon-builder-r1681-baseline-v2.js) yalnız SHADOW-ONLY
  ve varsayılan KAPALI bir Monte Carlo bilgi katmanı eklendi
  (globalThis.TKP_SMART_FILTER_SETTINGS.monteCarloShadow===true olmadıkça hiç
  çalışmaz); mevcut skor/sıra/maliyet mantığına dokunmaz.
- Testler: tests/r17-9-monte-carlo-engine.test.js, tests/r17-9-smart-coupon-filter.test.js,
  tests/r17-9-coupon-builder-shadow-hook.test.js, tests/r17-9-html-script-load-order.test.cjs,
  DOGRULAMA/tools/test_tkp_r17_autogluon.py (4 yeni test). Tam suite: 187/187 PASS.


GERÇEK EĞİTİM SONUCU — DÜZELTME (2026-09-14)
İlk çalıştırmada (aşağıdaki "İLK ÇALIŞTIRMA (SIZINTILI, GEÇERSİZ)" bölümüne
taşındı) challenger champion'ı eziyor gibi görünmüştü (%165 ROI). Feature
importance incelemesinde bunun büyük ölçüde VERİ SIZINTISI olduğu ortaya
çıktı: accurate_avg_speed_mps/accurate_closing_speed_mps/accurate_max_speed_mps/
accurate_finish_signal alanları — projenin kendi stats-engine.js'indeki
2026-08-09 tarihli KÖK DÜZELTME yorumunun da doğruladığı gibi — yalnızca
SONUÇLA birlikte, yarış BİTTİKTEN SONRA toplanıyor. Bunlar ham haliyle
NUMERIC_FEATURES'a girmiş, model gizlice "sonucu" görüp tahmin ediyormuş
gibi davranmıştı. LEAK_FIELDS'a taşındı, FEATURE_COLUMNS'tan çıkarıldı,
regresyon testi eklendi (test_post_race_accurate_gps_fields_excluded_from_features).

Sızıntı düzeltildikten sonra GERÇEK sonuç (aynı 3.095 koşu, 464 holdout,
medium_quality/150s — best_quality/7200s ile henüz denenmedi):
- CHALLENGER (düzeltilmiş): top1_hit %25.86 · brier 0.07674 · log_loss 0.2658
  · Ganyan ROI **-%37.7** (112/464 isabet)
- CHAMPION (canlı tkp_display_score): top1_hit %30.39 · ROI %2.0 (değişmedi)
- promotion_gate: **pass=false** — challenger champion'ı YENEMİYOR.

backfill_fraction'ın da (ikinci en önemli özellik) meşru olmayan bir zaman/
dönem vekili olabileceğinden şüphelenip ayrıca çıkarılarak test edildi;
sonuç değişmedi (top1_hit %26.08, ROI -%42.4) — yani asıl sorun accurate_*
alanlarıydı, backfill_fraction listede kaldı.

DÜRÜST SONUÇ: Sızıntısız haliyle, 150 saniyelik hızlı bir AutoGluon geçişi
mevcut canlı skor algoritmasını YENEMİYOR. Bu şaşırtıcı değil — champion
aylarca süren adaptif ağırlık/kalibrasyon/backtest turlarından geçmiş
(bkz. algorithm-principles.md), ham özelliklerden 150 saniyede onu geçmek
zor. R17.9 kodu (dinamik özellikler + Monte Carlo + akıllı filtre) hâlâ
doğru ve zararsız çalışıyor, ama "eskiyi değiştirecek kanıtlanmış model"
iddiası GERİ ÇEKİLDİ.

SONRAKİ GERÇEKÇİ ADIMLAR (öncelik sırasıyla):
1. Tam best_quality/7200s eğitim (EGIT_R17.bat) — 150s'lik hızlı deneme
   yetersiz kalmış olabilir; ama %2 → -%37.7 farkının tamamen kapanması
   beklenmemeli.
2. Champion'ın kendi skorunu (tkp_display_score) "yeniden sıralayan" bir
   stacking/blender yaklaşımı — sıfırdan yarışmak yerine mevcut, aylarca
   kalibre edilmiş sinyalin üstüne ince ayar yapmak daha gerçekçi bir hedef.
3. Daha fazla koşu birikmesi (şu an 3.095 koşu, holdout sadece 464) —
   örneklem küçük, gürültü payı yüksek.
4. 5 yeni dinamik özellik (last3_form_score vb.) feature importance'ta hâlâ
   çok düşük (<0.001) — mevcut haliyle ayrıca fayda kanıtlanmadı, TAKİPTE.

İLK ÇALIŞTIRMA (SIZINTILI, GEÇERSİZ — yalnız kayıt için tutuluyor)
- CHALLENGER: top1_hit %45.04 · ROI %165.7 — accurate_* sızıntısı nedeniyle
  GEÇERSİZ, gerçek performansı yansıtmıyor.
