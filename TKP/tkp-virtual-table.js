/**
 * tkp-virtual-table.js — büyük tablo koruması
 *
 * Gerçek DOM sanallaştırmasını eski menüleri riske atmadan taklit eden güvenli katman:
 * büyük veri setlerinde ilk blok çizilir, kullanıcı arama yaptığında sonuçlar daraltılır.
 */
(function(global){
  'use strict';
  function currentDb(){ try { return (typeof db !== 'undefined' && db) ? db : global.db; } catch(_){ return global.db; } }
  function e(v){ try { return typeof esc==='function' ? esc(v) : String(v??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); } catch(_){ return String(v??''); } }
  function dateTR(v){ try { return typeof displayDateTR==='function' ? displayDateTR(v||'') : (v||''); } catch(_){ return v||''; } }
  function foldSafe(v){ try { return typeof fold==='function' ? fold(v) : String(v||'').toLowerCase(); } catch(_){ return String(v||'').toLowerCase(); } }
  function hipShort(v){ try { return typeof global.displayHippodromeShort==='function' ? global.displayHippodromeShort(v) : v; } catch(_){ return v; } }
  function d(v){ return v===null||v===undefined||String(v).trim()===''?'—':v; }

  // V1.1.334 — 10M bounded arama. Kaynak satırları da sınırlıdır: eski sürüm
  // filtre limiti koysa da tkpMasterRowsFast(0) ile önce bütün atları üretiyordu.
  // Artık hem oluşturma hem arama yalnız sıcak pencerenin küçük bir bölümündedir.
  function tkpDataRowsFiltered(query, hardLimit){
    const q=foldSafe(query||'');
    const out=[];
    const limit=Number(hardLimit)>0 ? Number(hardLimit) : 1000;
    const scanLimit=Math.max(limit,Math.min(3000,Math.max(1000,limit*20)));
    const source = typeof global.tkpMasterRowsFast === 'function'
      ? global.tkpMasterRowsFast(scanLimit)
      : (typeof global.masterRows === 'function' ? global.masterRows(scanLimit) : []);
    let scanned=0;
    if(!q){
      const end=Math.min(source.length,limit);
      for(let i=0;i<end;i++)out.push(source[i]);
      return {rows:out,totalMatched:source.length,totalSource:source.length,limit,scanned:end,scanLimit,truncated:source.length>end,searchWindowLimited:source.length>=scanLimit};
    }
    for(let i=0;i<source.length;i++){
      const x=source[i];scanned++;
      const blob=foldSafe(Object.values(x||{}).join(' '));
      if(!blob.includes(q)) continue;
      out.push(x);
      if(out.length>=limit)break;
    }
    return {rows:out,totalMatched:out.length,totalSource:source.length,limit,scanned,scanLimit,truncated:out.length>=limit&&scanned<source.length,searchWindowLimited:source.length>=scanLimit};
  }

  function tkpDataTableHTML(query, limit){
    const res=tkpDataRowsFiltered(query, limit||750);
    const rows=res.rows;
    const body=rows.map(x => `<tr ${x.winner ? 'style="background:#f0fdf4;"' : ''}><td>${e(d(x.file))}</td><td>${e(d(x.status))}</td><td>${e(d(x.date?dateTR(x.date):null))}</td><td>${e(d(hipShort(x.hippodrome)))}</td><td>${d(x.leg)}</td><td>${e(d(x.surface))}</td><td>${e(d(x.breed))}</td><td>${e(d(x.condition))}</td><td>${d(x.distance)}</td><td>${e(d(x.horse_no))}</td><td>${e(d(x.horse))}</td><td>${d(x.agf)}</td><td>${d(x.kg)}</td><td>${e(d(x.best_time))}</td><td>${d(x.g800)}</td><td>${d(x.hndkp)}</td><td>${d(x.s_value)}</td><td>${d(x.tr)}</td><td>${d(x.value)}</td><td>${d(x.sp)}</td><td>${d(x.result)}</td><td>${Number(x.bmb)===1?'BMB':'—'}</td><td>${d(x.finish_position)}</td></tr>`).join('') || '<tr><td colspan="23" class="empty">Veri yok.</td></tr>';
    const note = res.searchWindowLimited
      ? `Büyük arşiv koruması: sıcak penceredeki ilk ${res.scanLimit} satır tarandı; ${rows.length} kayıt gösteriliyor.`
      : (res.truncated
        ? `İlk ${rows.length} eşleşme gösteriliyor; performans için tarama burada durduruldu. Daha dar arama yazarsan hedef kayıt daha hızlı bulunur.`
        : (res.totalSource>rows.length&&!String(query||'').trim()?`Gösterilen ${rows.length} / ${res.totalSource} kayıt.`:`Gösterilen ${rows.length} kayıt.`));
    return `<div class="tableWrap"><table><thead><tr><th>Dosya</th><th>Durum</th><th>Tarih</th><th>Hipodrom</th><th>Ayak</th><th>Pist</th><th>Tür</th><th>Koşu</th><th>Mesafe</th><th>No</th><th>At</th><th>AGF</th><th>KG</th><th>DERECE</th><th>800G</th><th>HNDKP</th><th>S</th><th>TR PUAN</th><th>VALUE</th><th>SP</th><th>SONUÇ</th><th>BMB</th><th>Derece</th></tr></thead><tbody>${body}</tbody></table></div><p class="muted" style="margin-top:8px;">${e(note)}</p>`;
  }

  // V1.1.308-MEM-FIX: tek satır şablonu, hem senkron tkpFilesTableHTML hem de
  // aşağıdaki kademeli (chunked) DOM ekleme fonksiyonu tarafından TAM OLARAK
  // AYNI şekilde kullanılır -- görünüm/markup birebir aynı kalır, kod tekrarı yok.
  function _tkpFileRowHTML(f, ix){
    const fid=String(f.id);
    const hasRace=ix ? ((ix.racesByFileId.get(fid)||[]).length>0) : ((currentDb()?.races||[]).some(r=>String(r.file_id)===fid));
    const dur=typeof global.tkpDurumBadge==='function' ? global.tkpDurumBadge(f) : e(f.status||'');
    return `<tr>
        <td style="white-space:nowrap;">${String(f.sequence_no).padStart(3,'0')}</td>
        <td class="fileName">${e(f.filename)}</td>
        <td class="fileName">${e(f.original_filename||'')}</td>
        <td style="white-space:nowrap;">${e(f.race_date ? dateTR(f.race_date) : '-')}</td>
        <td>${e(hipShort(f.hippodrome))}</td>
        <td>${e(f.status)}</td>
        <td>${dur}</td>
        <td><div style="display:flex;flex-direction:row;flex-wrap:nowrap;gap:6px;align-items:center;">
          ${hasRace ? `<button class="fileActBtn" onclick="window.__tkp_downloadFileOds(${Number(f.id)})">📥 ODS indir</button>` : ''}
          ${f.status==='REVIEW_NEAR_DUPLICATE' ? `<button class="fileActBtn" onclick="window.__tkp_toggleFileStatus(${Number(f.id)},true)">Analize dahil et</button>` : (f.duplicate_of ? `<button class="fileActBtn" onclick="window.__tkp_toggleFileStatus(${Number(f.id)},false)">İncelemeye al</button>` : '')}
          <button class="fileActBtn" onclick="window.__tkp_editFile(${Number(f.id)})">✏️ Düzelt</button>
          <button class="fileActBtn danger" onclick="window.__tkp_deleteFile(${Number(f.id)})">Dosyayı sil</button>
        </div></td>
      </tr>`;
  }

  function _tkpFilesTableShell(bodyHtml, files, list){
    const note=(files||[]).length>list.length ? `<p class="muted" style="margin-top:8px;">Performans koruması: ${list.length} / ${(files||[]).length} dosya gösteriliyor.</p>` : '';
    return { note, wrap:(inner)=>`<div class="tableWrap"><table><thead><tr><th>No</th><th>Dosya</th><th>Kaynak</th><th>Tarih</th><th>Hipodrom</th><th>Kayıt</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>${inner}</tbody></table></div>${note}<p class="muted" style="margin-top:8px;">Dosya silme işleminden önce .tkbz tam yedeği alınması önerilir.</p>` };
  }

  function tkpFilesTableHTML(files, options){
    const opts=options||{};
    const limit=Number(opts.limit)||600;
    const list=(files||[]).slice(0,limit);
    const ix=typeof global.tkpGetIndexes==='function' ? global.tkpGetIndexes() : null;
    const body=list.map(f=>_tkpFileRowHTML(f,ix)).join('') || '<tr><td colspan="8" class="empty">Henüz dosya yok.</td></tr>';
    return _tkpFilesTableShell(body, files, list).wrap(body);
  }

  // V1.1.308-MEM-FIX (kök neden #3, "hepsini ölç" taramasında bulundu): 250 satırlık
  // dosya tablosunu TEK seferde innerHTML ile basmak, gerçek veride (503 dosya, limit
  // 250) sekmeye geçişte ölçülebilir tek bir ~2 saniyelik tarayıcı düzen (layout)
  // duraklamasına yol açıyordu -- JS hesap süresi değil, DOM'a binlerce düğüm ekleme
  // maliyeti. Bu fonksiyon AYNI nihai HTML/markup'ı üretir, ama satırları küçük
  // gruplar halinde ardışık animasyon çerçevelerinde ekler; böylece tarayıcı her
  // grup arasında nefes alır ve sekme "donmadan" dolar. Görünüm, sıralama ve
  // içerik tkpFilesTableHTML ile birebir AYNIDIR -- yalnızca DOM'a yazılma şekli
  // kademelidir.
  async function tkpRenderFilesTableProgressive(container, files, options){
    if(!container) return;
    const opts=options||{};
    const limit=Number(opts.limit)||600;
    const chunkSize=Number(opts.chunkSize)||40;
    const list=(files||[]).slice(0,limit);
    const ix=typeof global.tkpGetIndexes==='function' ? global.tkpGetIndexes() : null;
    const shell=_tkpFilesTableShell('', files, list);
    if(!list.length){
      container.innerHTML=shell.wrap('<tr><td colspan="8" class="empty">Henüz dosya yok.</td></tr>');
      return;
    }
    container.innerHTML=shell.wrap('');
    const tbody=container.querySelector('tbody');
    if(!tbody){ container.innerHTML=shell.wrap(list.map(f=>_tkpFileRowHTML(f,ix)).join('')); return; }
    const generation=(container.__tkpFilesRenderGen=(container.__tkpFilesRenderGen||0)+1);
    for(let i=0;i<list.length;i+=chunkSize){
      if(container.__tkpFilesRenderGen!==generation) return; // sekme değişti/yeniden render edildi
      const chunkHtml=list.slice(i,i+chunkSize).map(f=>_tkpFileRowHTML(f,ix)).join('');
      tbody.insertAdjacentHTML('beforeend', chunkHtml);
      if(i+chunkSize<list.length){
        if(typeof global.tkpYieldToUi==='function') await global.tkpYieldToUi();
        else await new Promise(res=>setTimeout(res,0));
      }
    }
  }

  global.tkpDataTableHTML = tkpDataTableHTML;
  global.tkpDataRowsFiltered = tkpDataRowsFiltered;
  global.tkpFilesTableHTML = tkpFilesTableHTML;
  global.tkpRenderFilesTableProgressive = tkpRenderFilesTableProgressive;
})(window);
