const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const active=fs.readFileSync(path.join(root,'TKP','app-controller-r1681-baseline-v24.js'),'utf8');
const legacy=fs.readFileSync(path.join(root,'TKP','app-controller.js'),'utf8');
const html=fs.readFileSync(path.join(root,'TKP','TKP_CORE_CLAUDE.html'),'utf8');
function assert(cond,msg){if(!cond){throw new Error(msg)}}
function checkController(src,name){
  assert(src.includes('id="shareCouponShot"'),`${name}: shareCouponShot button yok`);
  assert(src.includes('3 Kuponu X'),`${name}: eski 3 Kuponu X'te Paylaş etiketi yok`);
  assert(src.includes('tkpPersistFinalCouponSnapshot'),`${name}: son kupon snapshotını kalıcılaştırma yok`);
  assert(src.includes('activeCoupons.main')&&src.includes('activeCoupons.surprise')&&src.includes('activeCoupons.alt'),`${name}: üç kupon snapshotı aynı paylaşımda kullanılmıyor`);
  assert(src.includes('x.com/intent/post'),`${name}: X intent açılmıyor`);
  assert(!src.includes('𝕏 PNG Kaydet + X\'i Aç'),`${name}: yanlış yeni etiket hâlâ duruyor`);
  assert(src.includes("picks.map(esc).join(' - ')"),`${name}: eski sade X kupon satırı yok`);
}
checkController(active,'aktif controller');
checkController(legacy,'legacy controller');
assert(/<script src="app-controller-r1681-baseline-v24\.js\?v=r19\.4-x-share-viewport/.test(html),'HTML aktif controller cache-bust sürümü r19.4 değil');
assert(html.includes('id="r19-4-x-share-viewport-final"'),'R19.4 final viewport CSS kilidi yok');
assert(/#tkpRoot\s*\{[^}]*width:100%\s*!important[^}]*max-width:none\s*!important/s.test(html),'tkpRoot tam genişlik kilidi yok');
assert(!/#tkpRoot\s*\{[^}]*zoom\s*:\s*0\./s.test(html),'tkpRoot üzerinde küçülten zoom olmamalı');
assert(!/#tkpRoot\s*\{[^}]*transform\s*:\s*scale\s*\(\s*0\./s.test(html),'tkpRoot üzerinde küçülten scale transform olmamalı');
assert(html.includes('calc(20% - 2px)'), 'Kupon seçim ızgarası beş atı tek satıra sığdırmalı');
assert(html.includes('max-width:1600px'), 'Program görünümü sınırlı merkez genişlikte olmalı');
assert(html.includes('.couponPickChip.couponPickChipWin{background:#dcfce7'), 'Kazanan kupon seçimi yeşil görünmeli');
assert(html.includes('.couponLegStatus.hit{background:#bbf7d0'), 'Tutan ayak yeşil görünmeli');
assert(html.includes('.couponLegStatus.miss{background:#fee2e2'), 'Tutmayan ayak kırmızı görünmeli');
const ui=fs.readFileSync(path.join(root,'TKP','ui-components.js'),'utf8');
assert(ui.includes('sameEkuri(p.horse_no,officialWinner.horse_no)'), 'Eküri ortağı kazanımı kupon seçiminde işaretlenmeli');
assert(html.includes('font-size:9.5px!important;line-height:16px'), 'Kupon numara rozetleri kompakt olmalı');
console.log('PASS r19.4 X share + viewport lock');
