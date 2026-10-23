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
  function d2(v){ if(v===null||v===undefined||String(v).trim()==='')return '—'; const n=Number(String(v).replace(',','.')); return Number.isFinite(n)?n.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}):v; }

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

  const dataColumns=[['Dosya','file'],['Durum','status'],['Tarih','date'],['Hipodrom','hippodrome'],['Ayak','leg'],['Pist','surface'],['Tür','breed'],['Koşu','condition'],['Mesafe','distance'],['No','horse_no'],['At','horse'],['AGF','agf'],['YPUAN','ypuan'],['KG','kg'],['DERECE','best_time'],['800G','g800'],['HNDKP','hndkp'],['S','s_value'],['TR PUAN','tr'],['VALUE','value'],['SP','sp'],['SONUÇ','result'],['BMB','bmb'],['Bitiriş','finish_position']];
  const numberFields=new Set(['leg','distance','agf','ypuan','kg','g800','hndkp','s_value','tr','value','sp','result','finish_position']);
  function dataRowsHTML(rows,note){
    const cell=(x,key)=>{
      let value=x[key];
      if(key==='result')value=x.result??x.result_score;
      if(value==null||String(value).trim()==='')return '<td data-tkp-missing="true" title="Kaynak değer mevcut değil.">—</td>';
      if(key==='date')value=dateTR(value);
      if(key==='file')return `<td class="tkpFilenameCell" title="${e(value)}"><span class="tkpFilenameName">${e(value)}</span></td>`;
      if(key==='hippodrome')return `<td class="tkpHippodromeCell" title="${e(value)}"><span class="tkpHippodromeName">${e(value)}</span></td>`;
      if(key==='bmb')return `<td>${Number(value)===1?'BMB':'0'}</td>`;
      if(numberFields.has(key)){
        const n=Number(String(value).replace(',','.'));
        if(Number.isFinite(n)){
          const label=key==='result'?(x.result!=null?d2(x.result):d2(value)):n.toLocaleString('tr-TR',{maximumFractionDigits:2});
          return `<td class="num" data-tkp-number="${n}">${e(label)}</td>`;
        }
      }
      return `<td>${e(value)}</td>`;
    };
    const body=rows.map(x=>`<tr ${Number(x.winner)===1?'class="actualWinnerRow"':''}>${dataColumns.map(([,key])=>cell(x,key)).join('')}</tr>`).join('')||`<tr><td colspan="${dataColumns.length}" class="empty">Eşleşen veri yok.</td></tr>`;
    return `<div class="tableWrap"><table data-tkp-sort="preserve" data-tkp-scope="full"><thead><tr>${dataColumns.map(([label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div><p class="muted">${e(note)}</p>`;
  }
  function tkpDataTableHTML(query,limit){
    const res=tkpDataRowsFiltered(query,limit||150);
    return dataRowsHTML(res.rows,'Sınırlı bellek önizlemesi; tam arşiv araması asenkron veri tablosundadır.');
  }
  async function tkpRenderDataTableAsync(container,database,query){
    if(!container)return;
    container.__tkpDataAbort?.abort();
    const abort=new AbortController();container.__tkpDataAbort=abort;
    const cursors=[null];let page=0;
    const signature=()=>[database.__segmented_storage?.baseGeneration,database.races,database.files,typeof _tkpDbRevision==='number'?_tkpDbRevision:0];
    const initial=signature();
    async function draw(){
      if(abort.signal.aborted)return;
      if(signature().some((x,i)=>x!==initial[i])){return tkpRenderDataTableAsync(container,database,query);}
      container.innerHTML='<p role="status">Tüm arşiv taranıyor…</p><button type="button" data-tkp-cancel>Taramayı durdur</button>';
      container.querySelector('[data-tkp-cancel]').onclick=()=>{abort.abort();container.innerHTML='<p>Tarama durduruldu. Yeniden başlatmak için aramayı değiştirin.</p>';};
      try{
        const result=await global.TKPDataTableQuery.query(database,{query,limit:150,after:cursors[page],signal:abort.signal,onProgress:progress=>{
          const status=container.querySelector('[role="status"]');if(status)status.textContent=progress.phase==='file-index'?`Dosya indeksi hazırlanıyor: ${progress.processed}`:`Tüm arşiv taranıyor: ${progress.processed} at satırı`;
        }});
        if(abort.signal.aborted)return;
        if(signature().some((x,i)=>x!==initial[i]))return tkpRenderDataTableAsync(container,database,query);
        const note=`${result.totalMatched.toLocaleString('tr-TR')} eşleşme · Sayfa ${page+1} · ${result.rows.length} satır · Tüm arşivde YPUAN yüksekten düşüğe. — kaynak değerin eksik olduğunu gösterir.`;
        container.innerHTML=dataRowsHTML(result.rows,note)+'<div class="tkpTablePager"><button type="button" data-prev>Önceki</button><button type="button" data-next>Sonraki</button></div>';
        const prev=container.querySelector('[data-prev]'),next=container.querySelector('[data-next]');
        prev.disabled=page===0;next.disabled=!result.hasMore;
        prev.onclick=()=>{page--;draw();};next.onclick=()=>{cursors[++page]=result.nextCursor;draw();};
      }catch(error){if(!abort.signal.aborted)container.innerHTML=`<p role="alert">Tablo tamamlanamadı: ${e(error.message)}. Eksik tarama sonucu gösterilmedi.</p>`;}
    }
    return draw();
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
          <button class="fileActBtn danger" onclick="window.__tkp_deleteFile(${Number(f.id)},${Number(f.sequence_no)})">Dosyayı sil</button>
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
    const offset=Math.max(0,Number(opts.offset)||0);
    const list=(files||[]).slice(offset,offset+limit);
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
    const offset=Math.max(0,Number(opts.offset)||0);
    const list=(files||[]).slice(offset,offset+limit);
    const ix=typeof global.tkpGetIndexes==='function' ? global.tkpGetIndexes() : null;
    const generation=(container.__tkpFilesRenderGen=(container.__tkpFilesRenderGen||0)+1);
    const shell=_tkpFilesTableShell('', files, list);
    if(!list.length){
      container.innerHTML=shell.wrap('<tr><td colspan="8" class="empty">Henüz dosya yok.</td></tr>');
      return;
    }
    container.innerHTML=shell.wrap('');
    const tbody=container.querySelector('tbody');
    if(!tbody){ container.innerHTML=shell.wrap(list.map(f=>_tkpFileRowHTML(f,ix)).join('')); return; }
    for(let i=0;i<list.length;i+=chunkSize){
      if(container.__tkpFilesRenderGen!==generation) return; // sekme değişti/yeniden render edildi
      const chunkHtml=list.slice(i,i+chunkSize).map(f=>_tkpFileRowHTML(f,ix)).join('');
      tbody.insertAdjacentHTML('beforeend', chunkHtml);
      if(i+chunkSize<list.length){
        if(typeof global.tkpYieldToUi==='function') await global.tkpYieldToUi();
        else await new Promise(res=>setTimeout(res,0));
      }
    }
    if((files||[]).length>limit){
      const nav=document.createElement('div');nav.className='tkpTablePager';
      nav.innerHTML='<button type="button" data-prev>Önceki</button><span></span><button type="button" data-next>Sonraki</button>';
      nav.querySelector('span').textContent=`${offset+1}–${offset+list.length} / ${files.length}`;
      const prev=nav.querySelector('[data-prev]'),next=nav.querySelector('[data-next]');prev.disabled=offset===0;next.disabled=offset+limit>=files.length;
      prev.onclick=()=>tkpRenderFilesTableProgressive(container,files,{...opts,offset:Math.max(0,offset-limit)});
      next.onclick=()=>tkpRenderFilesTableProgressive(container,files,{...opts,offset:offset+limit});container.appendChild(nav);
    }
  }

  global.tkpRenderDataTableAsync = tkpRenderDataTableAsync;
  global.tkpDataTableHTML = tkpDataTableHTML;
  global.tkpDataRowsFiltered = tkpDataRowsFiltered;
  global.tkpFilesTableHTML = tkpFilesTableHTML;
  global.tkpRenderFilesTableProgressive = tkpRenderFilesTableProgressive;
})(window);
