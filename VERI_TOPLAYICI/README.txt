TKP VERI TOPLAYICI - ASCII LIGHT PAKET

1) Normal kullanim: BASLAT.bat
2) Acilmazsa veya tarayici modulleri calismazsa: KUR_ONAR.bat

Bu klasor bilerek az dosyalidir. Node, Playwright ve Chromium/Opera calisma
bilesenleri burada binlerce dosya olarak tutulmaz. Ilk acilista resmi kaynaklardan
indirilir, SHA-256 ile dogrulanir ve su kullanici klasorune kurulur:

%LOCALAPPDATA%\TKP\Runtime\1.1.333

Kilitli uyumluluk:
- Node.js 18.12.1 x64
- Playwright 1.29.2
- Windows 8.1 icin Opera 95 (oncelikli, gorunur) veya Chromium 109 / revision 1041

Windows 8.1 R5 davranisi:
- Opera'nin launcher.exe dosyasi degil gercek 95.x opera.exe dosyasi secilir.
- Opera yoksa veya smoke testini gecemezse paket Chromium 109'a duser.
- Tarayici smoke testi gecmezse kolektor kurulumu artik durmaz.
- Ganyan Canavari, TJK, Misli ve Hipodrom dogrudan HTTP/JSON modunda calisir.
- Yalniz HTML/PDF/giris yedegi kullanilamaz; ayrinti Logs\browser-smoke.log dosyasindadir.

Loglar:
%LOCALAPPDATA%\TKP\Logs

Veri kaynaklari:
- TR: yalniz Ganyan Canavari programinda forma yanindaki P sutunu (API At_Puan). Bir ayak/at eksik gelirse ayni gercek kaynak sayfa-kokenli ikinci okumayla yalniz bos P hucreleri tamamlanir; kaynak yine eksikse deger uydurulmaz.
- GLP: once Ganyan Canavari Galoplar Ozet (800 m); ayni kosuda GC katmani bos kalirsa yalniz Yeni Beygir Galoplar sayfasi yedek olur
- J-BYG: once Ganyan Canavari dogrudan cift orani; kaynakta gercek 0 varsa korunur. GC katmani bos kalirsa yalniz Yeni Beygir Jokey Performans sayfasi yedek olur
- TJK Program: ST, KG, Kulvar, DRC ve diger ana program alanlari
- Hazir kuponlar: Misli, Hipodrom, Bi'Talih ve AtYarisi

Tum kaynaklarda once dogrudan HTTP/JSON denenir. Yalniz dogrudan veri alinamazsa
HTML/tarayici yedegi acilir. Yeni Beygir yalniz tarihsel GC-sonrasi GLP/J-BYG
yedegidir; program, TR, sonuc veya kupon/yorumcu verisi vermez. Atlagel arsiv
kaydi olarak korunur ancak hesaplamaya veya eksik veri zincirine girmez.

Site oturumlari:
- Bi'Talih ve AtYarisi kullanici adi/sifresi TKP'ye yazilmaz.
- HTML Ac ile giris yapilir; yalniz ayri kalici tarayici profilindeki oturum/cerez kalir.
- Durdur dugmesi gorunur site oturumlarini kapatmaz.
