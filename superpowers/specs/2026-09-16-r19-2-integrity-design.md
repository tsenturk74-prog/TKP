# TKP R19.2 Integrity + UI Consolidation Design

## Goal
R19.1'i temel alarak kullanıcıya görünen tüm kritik tabloların güncellik, hesaplama, öğrenme, cache ve snapshot zincirlerini güvenilir hale getirmek; ağır arka plan işlerinin UI'yi bloke etmesini engellemek; son UI taleplerini tek authoritative katmanda toplamak.

## Constraints
- Windows 8.1 / eski Opera-Chromium uyumluluğu korunacak.
- Yarış sonucu bilindikten sonra yarış-öncesi snapshot uydurulmayacak; leakage yok.
- Eski frozen TKP / kupon / yan bahis snapshotları salt-okunur kanıt olarak korunacak ve yalnız doğrulanabilir alanlar onarılacak.
- Veri değişmedikçe ağır hesap tekrar edilmeyecek.
- Mevcut R19.1 BMB/ODB tam satır renk mantığı korunacak; Y.PU+X içinde ayrı renkli kare/yama olmayacak.
- Final ZIP iki doğrulama turundan geçmeden üretilmeyecek.

## Architecture
1. `tkp-r19-integrity-runtime.js` merkezi sağlık/onarım orkestratörü olur. Bu modül var olan canonical fonksiyonları çağırır; yeni bir tahmin motoru yaratmaz.
2. Sonuç sonrası pipeline tek event üzerinden mevcut forward tracking, weekly tracker, exact sidebet resolver, adaptive learning ve cache invalidation katmanlarını koordine eder.
3. Eski veride yalnız mevcut pre-race/frozen kanıtlar değerlendirilir. Eksik pre-race kayıt sonuçtan sonra yaratılmaz.
4. UI için tek son authoritative CSS bloğu kullanılır. Önceki kuralları fiziksel olarak silmek yerine final lock ile tutarlı şekilde ezer; böylece baseline regressions sınırlanır.
5. İlk Bakış hızlı boyada güven için mevcut frozen/precomputed `altili_winner_score` / confidence snapshot kullanılır; yoksa kısa “hazırlanıyor” etiketi kalır. Ağır `dynamicSingleDecision` ilk boya kritik yoluna zorla sokulmaz.

## Data Integrity
- `forward_tracking_log`: race_key bazında tek canonical kayıt; duplicate kayıtlar alan bazlı birleştirilir, en güçlü/evaluated kayıt korunur.
- `sidebet_ticket_log`: `lock_key` bazında resolved ve daha yeni kayıt korunur.
- `auto_coupon_log`, `weekly_model_log`, `v55_diagnostic_log`: yalnız byte/semantic olarak tam duplicate kayıtlar kaldırılır; anlamlı farklı snapshotlar korunur.
- Frozen görünür TKP skorları mevcut snapshot değerlerinden kooperatif olarak normalize edilir.
- Yeni sonuç geldiğinde mevcut forward kayıtları değerlendirilir; weekly/sidebet resolver çağrılır; adaptive learning mevcut sonucu bir kez işler.

## Freshness
Kritik takip ekranları son doğrulanmış sonuç tarihi ile son kanıtlı takip tarihini ayırır. Canlı kanıt yoksa tarih geriye dönük uydurulmaz; kullanıcıya açıkça “son kanıtlı takip” gösterilir.

## Performance
- Ağır context upgrade tazelemesi görünür prediction DOM'unu yeniden tam render etmeyecek; cache/model hazırlayıp kullanıcı etkileşimi sonrası kontrollü refresh yapacak.
- Background queue aynı anahtarlı görevleri tekilleştirir.
- Büyük eski veri onarımları 4/8/16 benzeri cooperative chunk/yield ile çalışır.
- Persist collection bazlı ve coalesced yapılır.

## UI Contract
- BMB/ODB rozet ölçüleri eşit.
- BMB/ODB satır renkleri winner yeşili altında tam satır uygulanır.
- Y.PU+X içinde ayrı renkli patch yok.
- DESTEKLER iki satıra kadar tam görünür; badge kesilmez.
- Sağ prediction panelleri kısa/kompakt; ana tabloya alan bırakır.
- Kupon satırında en az 4 at chip'i sığacak geometri; TEK daha küçük.
- `%14TEK` gibi birleşik metin yok, `%14 TEK`.
- Dosyalar tablosunda ODS indir / Düzelt / Dosyayı sil aynı satıra sığar.

## Verification
Tur 1: kaynak klasöründe syntax + static UI contracts + integrity unit tests + mevcut R19 test + R18 model tests + active script wiring.
Tur 2: final ZIP temiz klasöre extract edilip aynı kritik testler + CRC + manifest/hash + dosya referans kontrolü tekrar çalıştırılır.
