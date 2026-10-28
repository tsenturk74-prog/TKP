// YAN BAHIS PERFORMANS TAKIBI (gorunur ogrenme):
// sidebet_ticket_log'daki sonuclu kayitlardan urun bazinda tutma%/ROI/ort-ikramiye hesaplar,
// Izleme Merkezi'nde tablo olarak gosterir. Sistem zaten kaydediyor; bu kart yalnizca
// mevcut ogrenmeyi GORUNUR kilar (kupon/secim mantigini DEGISTIRMEZ). Her acilista taze.
(function(){
  'use strict';
  const LABELS={cifte:'Çifte',sirali_ikili:'Sıralı İkili',sirali_uclu:'Sıralı Üçlü',uclu_bahis:'Üçlü',tabela:'Tabela (4lü)',sirali_5li:'Sıralı 5li'};
  const ORDER=['cifte','sirali_ikili','sirali_uclu','uclu_bahis','tabela','sirali_5li'];
  // Backtest (tum gecmis) onerisi: hicbiri +EV degil; en az kotu Cifte. "OYNA" = en iyi cep.
  const ONERI={
    cifte:{t:'🟢 OYNA · açık ayakta',c:'#166534'},
    sirali_ikili:{t:'🟡 Seçici · BH koşusunda',c:'#b45309'},
    sirali_uclu:{t:'🟡 Seçici · BH koşusunda',c:'#b45309'},
    uclu_bahis:{t:'🟡 Seçici · BH koşusunda',c:'#b45309'},
    tabela:{t:'❌ OYNAMA · yapısal zarar',c:'#b91c1c'},
    sirali_5li:{t:'❌ OYNAMA · yapısal zarar',c:'#b91c1c'}
  };
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
        const o=ONERI[p]||{t:'',c:'#64748b'};
        rows+=`<tr><td>${LABELS[p]||p}</td><td class="num">${a.res}</td><td class="num">${hitPct}</td><td class="num" style="color:${col};font-weight:700">${roi==null?'—':'%'+roi}</td><td class="num">${avgWin.toLocaleString('tr-TR')}</td><td style="color:${o.c};font-weight:700;white-space:nowrap">${o.t}</td></tr>`;
      }
      if(!rows){ el.innerHTML='<div class="empty">Henüz sonuçlu yan bahis kaydı yok.</div>'; return; }
      el.innerHTML='<p class="muted" style="margin:0 0 6px;font-size:11px;">Tüm geçmiş (sonuçlu '+L.length+' kayıt + sistem backtest\'i) üzerinden otomatik. ROI negatifse ganyan kesintisi sistemin avantajını yiyor. Hiçbiri +EV değil; OYNA = en az kötü cep. Asıl kazanç Altılı.</p><div class="tableWrap"><table><thead><tr><th>Ürün</th><th>Sonuçlu</th><th>Tutma %</th><th>ROI</th><th>Tutunca ort. ikramiye</th><th>Öneri (OYNA)</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    }catch(e){ try{console.warn('sidebet stats render',e);}catch(_){} }
  }
  if(typeof globalThis!=='undefined')globalThis.tkpRenderSidebetStats=tkpRenderSidebetStats;
})();
