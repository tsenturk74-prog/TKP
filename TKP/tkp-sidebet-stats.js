// YAN BAHIS PERFORMANS TAKIBI (gorunur ogrenme):
// sidebet_ticket_log'daki sonuclu kayitlardan urun bazinda tutma%/ROI/ort-ikramiye hesaplar,
// Izleme Merkezi'nde tablo olarak gosterir. Sistem zaten kaydediyor; bu kart yalnizca
// mevcut ogrenmeyi GORUNUR kilar (kupon/secim mantigini DEGISTIRMEZ). Her acilista taze.
(function(){
  'use strict';
  const LABELS={cifte:'Çifte',sirali_ikili:'Sıralı İkili',sirali_uclu:'Sıralı Üçlü',uclu_bahis:'Üçlü',tabela:'Tabela (4lü)',sirali_5li:'Sıralı 5li'};
  const ORDER=['cifte','sirali_ikili','sirali_uclu','uclu_bahis','tabela','sirali_5li'];
  function tkpRenderSidebetStats(){
    try{
      const el=document.getElementById('sidebetStatsTable'); if(!el)return;
      const d=globalThis.db; const L=(d&&Array.isArray(d.sidebet_ticket_log))?d.sidebet_ticket_log:[];
      const agg={};
      for(const x of L){
        if(!x||!x.product||!x.evaluation)continue; const e=x.evaluation;
        if(!(Number(e.known)===1||e.known===true))continue;
        const p=x.product; const a=agg[p]=agg[p]||{res:0,hit:0,cost:0,ret:0};
        a.res++; if(Number(e.hit)>0)a.hit++;
        a.cost+=Number(e.cost)||Number(x.cost)||0; a.ret+=Number(e.return)||0;
      }
      let rows='';
      for(const p of ORDER){ const a=agg[p]; if(!a||!a.res)continue;
        const hitPct=(100*a.hit/a.res).toFixed(1);
        const roi=a.cost?Math.round(100*(a.ret-a.cost)/a.cost):null;
        const avgWin=a.hit?Math.round(a.ret/a.hit):0;
        const col=roi==null?'#64748b':(roi>=0?'#166534':roi>=-20?'#b45309':'#b91c1c');
        const flag=roi==null?'':(roi>=-15?' 🟡 en az kötü':(roi<=-70?' ❌ oynama':''));
        rows+=`<tr><td>${LABELS[p]||p}</td><td class="num">${a.res}</td><td class="num">${hitPct}</td><td class="num" style="color:${col};font-weight:700">${roi==null?'—':'%'+roi}${flag}</td><td class="num">${avgWin.toLocaleString('tr-TR')}</td></tr>`;
      }
      if(!rows){ el.innerHTML='<div class="empty">Henüz sonuçlu yan bahis kaydı yok.</div>'; return; }
      el.innerHTML='<p class="muted" style="margin:0 0 6px;font-size:11px;">Sonuçlu '+L.length+' kayıttan otomatik. ROI = (ikramiye−maliyet)/maliyet; negatifse ganyan kesintisi sistemin avantajını yiyor. Çifte en az kötü; Tabela/5li yapısal zararlı. Altılı asıl kazanç hattıdır.</p><div class="tableWrap"><table><thead><tr><th>Ürün</th><th>Sonuçlu</th><th>Tutma %</th><th>ROI</th><th>Tutunca ort. ikramiye (1 misli)</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    }catch(e){ try{console.warn('sidebet stats render',e);}catch(_){} }
  }
  if(typeof globalThis!=='undefined')globalThis.tkpRenderSidebetStats=tkpRenderSidebetStats;
})();
