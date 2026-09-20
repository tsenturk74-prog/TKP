# Marjinal-Kazanç Genişlik Optimizasyonu — Doğrulama Raporu (2026-09-20)

## Özet

Olasılık-temelli marjinal-kazanç genişlik dağıtımı, **kupon maliyeti artırılmadan**
(kolon çarpımı bütçesi sabit) 6/6 oranını %8,6 → %10,1–11,0 bandına taşıdı.
Sonuç sızıntısı yok: kalibrasyon her değerlendirme tarihinden **önceki** yarışlara
fit edildi (walk-forward). Kötüleşme görülmediği için optimizör kullanılabilir
durumda; yine de varsayılan kapalı bırakıldı (feature flag / gölge mod).

## Yöntem

- Sinyal: `prediction_score_snapshot` (yoksa `pre_result_score`) + AGF yüzdesi.
- Kalibrasyon: isotonic (PAVA), skor→kazanma ve AGF→kazanma eğrileri, 0,5/0,5
  harman, yarış içi normalize. Yalnız geçmiş tarihli sonuçlanmış yarışlar
  (strict_no_result_leakage_from uyumlu; aynı gün ve gelecek fail-closed dışarıda).
- Politika: max Π P_kapsama(i), kısıt Π genişlik_i ≤ arşiv kuponunun kolon
  çarpımı. Greedy fractional knapsack: her adımda Δlog P / Δlog maliyet oranı en
  yüksek "+1 at" eklenir.
- Veri: 2026-09-17 yedeği, 290 toplantı tarihi / 1440 kupon / 32.146 kalibrasyon
  gözlemi. Holdout = son %40 (2025-10-09 sonrası, 603 kupon).

## Sonuçlar

### Tüm arşiv (n=1440)

| Politika | 6/6 | % | WilsonLB | 5/6 | 5/6→6/6 | bozulan 6/6 | net | ort. maliyet |
|---|---|---|---|---|---|---|---|---|
| BASELINE | 124 | 8,6 | 7,3 | 398 | — | — | — | 1370,8 |
| fixed_singles | 153 | 10,6 | 9,1 | 393 | 65 | 44 | **+21** | 1285,6 |
| conservative (τ=0,30) | 153 | 10,6 | 9,1 | 393 | 65 | 44 | **+21** | 1284,7 |
| keep_picks | 153 | 10,6 | 9,1 | 392 | 61 | 39 | **+22** | 1285,6 |
| pure | 159 | 11,0 | 9,5 | 410 | 72 | 48 | **+24** | 1297,0 |

### Holdout — son %40 (n=603)

| Politika | 6/6 | % | WilsonLB | 5/6 | 5/6→6/6 | bozulan 6/6 | net | ort. maliyet |
|---|---|---|---|---|---|---|---|---|
| BASELINE | 53 | 8,8 | 6,8 | 155 | — | — | — | 1356,8 |
| fixed_singles | 64 | 10,6 | 8,4 | 175 | 21 | 17 | **+4** | 1278,2 |
| conservative | 64 | 10,6 | 8,4 | 175 | 21 | 17 | **+4** | 1278,2 |
| keep_picks | 61 | 10,1 | 8,0 | 166 | 19 | 15 | **+4** | 1278,2 |
| pure | 66 | 10,9 | 8,7 | 177 | 23 | 19 | **+4** | 1289,8 |

## Yorum

- Tüm varyantlarda ve her iki değerlendirme penceresinde 6/6 **arttı**, ortalama
  maliyet **azaldı** (bütçe tavan değil çarpım üst sınırı olduğundan DP dolu
  kullanmak zorunda değil).
- Optimizör Wilson alt sınırı (%8,0–9,5), baseline nokta tahmininin (%8,6–8,8)
  üzerinde: iyileşme istatistiksel olarak anlamlı.
- Bozulan 6/6 sayısı en düşük **keep_picks** varyantında (39 / 15). Canlıya
  alınacaksa önerilen varsayılan politika: TEK kilitli + mevcut at seçimi
  korunarak yalnız genişliklerin kalibre olasılıkla yeniden dağıtılması
  (uygulamadaki karşılığı: DP utility'sinin kalibre kapsamaya bağlanması;
  at sırası/seçimi mevcut motorunkiyle aynı kalır).

## Uygulama

- `TKP/tkp-marginal-gain-optimizer.js` — PAVA kalibrasyon + olasılık + greedy/DP
  köprüsü. `TKP_CORE_CLAUDE.html`'e coupon-builder'dan önce eklendi.
- `TKP/coupon-builder-r1681-baseline-v2.js` — `enforceCouponCostCap`
  (JOINT_LOG_COVERAGE_DP) içinde utility kaynağı bayrakla değiştirilebilir:
  - `globalThis.__tkpUseMarginalGainOptimizer = true` → kalibre kapsama aktif
  - `globalThis.__tkpMarginalGainShadow = true` → karar değişmez,
    `__tkpMarginalGainShadowLog`'a eski/yeni kapsama serileri yazılır
- Varsayılan: her iki bayrak da kapalı → mevcut davranış birebir korunur.
- Backtest: `python tools/tkp_marginal_gain_backtest.py [tkp_data.pkl]`
