/* Table display policy: display-only rounding/missing labels; raw model data is
 * never mutated. Semantic row order and interactive controls are preserved. */
(function(root){
 'use strict';
 const doc=root.document;if(!doc)return;
 const numericCache=new WeakMap(),sortState=new WeakMap(),pending=new Set();let scheduled=false;
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').toLowerCase().replace(/\s+/g,' ').trim();
 const protectedHeader=s=>/^(no|#|id|dosya|kaynak|tarih|saat|at|at adi|hipodrom|ayak|kosu|derece|bitiris|start|kulvar|sira|secim|kupon|siralama)(\b|$)/.test(normalize(s));
 const formatter=new Intl.NumberFormat('tr-TR',{maximumFractionDigits:2});
 const tkpFormatter=new Intl.NumberFormat('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2});
 function parse(text,decimalHint=false){
   let s=String(text??'').trim().replace(/[−]/g,'-').replace(/[%₺€$]|\b(TL|TRY|kg|puan|ms)\b/gi,'').replace(/\s/g,'');
   if(!/^[+-]?(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:e[+-]?\d+)?$/i.test(s))return null;
   if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
   else if(s.includes(','))s=s.replace(',','.');
   else if(!decimalHint&&/^[+-]?[1-9]\d{0,2}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
   const n=Number(s);return Number.isFinite(n)?n:null;
 }
 function formatText(text,decimalHint=false,tkpScore=false){
   if(tkpScore){const n=parse(text,true);return n===null?text:tkpFormatter.format(n);}
   if(/^\s*p\s*=\s*[+-]?[\d.,]+\s*$/i.test(text))return text.replace(/[+-]?[\d.,]+/,s=>formatter.format(parse(s,true)));
   if(!/[.,]\d/.test(text))return text;
   if(parse(text,decimalHint)===null)return text;
   return text.replace(/[+-]?(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:e[+-]?\d+)?/i,token=>{const n=parse(token,decimalHint||text.includes('%'));return n===null?token:formatter.format(n);});
 }
 function headers(table){return Array.from(table.tHead?.rows||[]).at(-1)?.cells||[];}
 function cellNumber(cell){
   if(!cell||cell.dataset.tkpMissing==='true')return null;
   if(cell.hasAttribute('data-tkp-number')){const n=Number(cell.dataset.tkpNumber);return Number.isFinite(n)?n:null;}
   const cached=numericCache.get(cell);if(cached&&cached.text===cell.textContent)return cached.value;
   return parse(cell.textContent,priority(headers(cell.closest('table'))[cell.cellIndex]?.textContent)>=50);
 }
 function polishCell(cell,header){
   if(cell.querySelector('input,select,textarea,button,[contenteditable="true"],table'))return;
   const text=cell.textContent.trim(),missing=cell.dataset.tkpMissing==='true';
   if(/^\d{4}-\d{2}-\d{2}$|^\d{2}\.\d{2}\.\d{4}$/.test(text))cell.classList.add('tkpDate');
   if(cell.dataset.tkpEmpty==='preserve'&&(!text||/^[-—–]$/.test(text))){cell.textContent='';return;}
   if(!text||/^[-—–]$/.test(text)){
     cell.textContent='—';cell.dataset.tkpMissing='true';cell.title='Kaynak değer mevcut değil.';return;
   }
   // A renderer can replace a formerly missing cell in place.
   if(missing&&text!=='0'){delete cell.dataset.tkpMissing;cell.removeAttribute('title');}
   // Keep unusually long names/descriptions compact and fully accessible.
   if(text.length>120&&cell.childElementCount===0&&parse(text)===null){
     const details=doc.createElement('details'),summary=doc.createElement('summary'),full=doc.createElement('div');
     details.className='tkpLongCell';summary.textContent=Array.from(text).slice(0,72).join('')+'…';summary.setAttribute('aria-label','Tam metni aç: '+text.slice(0,72));full.textContent=text;full.style.cssText='margin-top:6px;overflow-wrap:anywhere';details.append(summary,full);cell.replaceChildren(details);return;
   }
   if(protectedHeader(header)&&!cell.classList.contains('num')&&!cell.hasAttribute('data-tkp-number'))return;
   const previous=numericCache.get(cell),value=previous?.text===cell.textContent?previous.value:cellNumber(cell);
   if(previous?.text===cell.textContent&&!cell.hasAttribute('data-tkp-number'))return;
   const tkpScore=cell.classList.contains('tkpCell')||/^tkp(?:\s+(?:puani?|skoru?))?$/.test(normalize(header));
   if(cell.hasAttribute('data-tkp-number')&&value!==null&&cell.childElementCount===0){cell.textContent=(tkpScore?tkpFormatter:formatter).format(value);cell.classList.add('tkpNumeric');numericCache.set(cell,{text:cell.textContent,value});return;}
   const decimalHint=priority(header)>=50;
   const walker=doc.createTreeWalker(cell,NodeFilter.SHOW_TEXT);let node;
   while((node=walker.nextNode())){const original=node.nodeValue;if(/^\s*[-—–]\s*$/.test(original)){node.nodeValue='—';node.parentElement.dataset.tkpMissing='true';node.parentElement.title='Kaynak değer mevcut değil.';}else{const formatted=formatText(original,decimalHint,tkpScore);if(original!==formatted)node.nodeValue=formatted;}}
   if(value!==null){cell.classList.add('tkpNumeric');numericCache.set(cell,{text:cell.textContent,value});}
 }
 function priority(header){
   const h=normalize(header);
   if(/^(ypuan|y\.puan|y puan)$/.test(h))return 110;
   if(/^(tkp|model|tahmin|guven|nihai|toplam)?\s*(skor|puani?|guc)(\b|$)/.test(h))return 100;
   if(/isabet|basari|kazanma|win rate/.test(h))return 90;
   if(/net getiri|roi|beklenen getiri|kar|kâr/.test(h))return 80;
   if(/^(value|sonuc|sp|agf|tr puan)$/.test(h))return 70;
   if(/oran|pay|yuzde/.test(h))return 60;
   if(/^(kazandi|kazanan|kazanma adedi)$/.test(h))return 50;
   if(/^(orneklem|adet|toplam|kosu sayisi|at sayisi)$/.test(h))return 20;
   return 0;
 }
 function sortable(table){
   if(table.closest('.proPredTable,.couponTable,.couponCard'))return false;
   if(Array.from(headers(table)).some(h=>/^(ayak|tarih|hafta|saat|sira|bitiris|no|boyut)$/.test(normalize(h.textContent))))return false;
   if(table.dataset.tkpSort==='preserve'||table.tBodies.length!==1||table.querySelector('input,select,textarea,[contenteditable="true"]'))return false;
   if(Array.from(table.tHead?.rows||[]).length!==1)return false;
   return !Array.from(table.tBodies[0].rows).some(r=>Array.from(r.cells).some(c=>c.rowSpan>1||c.colSpan>1));
 }
 function sort(table,column,direction){
   if(!sortable(table))return;
   const body=table.tBodies[0],rows=Array.from(body.rows);
   const sorted=rows.map((row,i)=>({row,i,value:cellNumber(row.cells[column])})).sort((a,b)=>{
     if(a.value===null&&b.value!==null)return 1;if(b.value===null&&a.value!==null)return -1;
     return (direction==='descending'?(b.value??0)-(a.value??0):(a.value??0)-(b.value??0))||a.i-b.i;
   });
   if(sorted.some((x,i)=>x.row!==rows[i])){const fragment=doc.createDocumentFragment();for(const x of sorted)fragment.append(x.row);body.append(fragment);}
   const hs=Array.from(headers(table));hs.forEach((h,i)=>{if(i===column)h.setAttribute('aria-sort',direction);else h.removeAttribute('aria-sort');});
   sortState.set(table,{column,direction});
 }
 function empty(table){
   const rows=Array.from(table.tBodies).flatMap(b=>Array.from(b.rows)).filter(r=>!r.hidden);
   return !rows.length||rows.every(r=>r.querySelector('.empty')||/^(veri yok|henüz .+ yok|eşleşen veri yok|[-—–])\.?$/i.test(r.textContent.trim()));
 }
 function hideUnmeasured(table){
   const host=table.closest('#pane-analytics,#adaptiveLearningTable,#signalPerfTable,#hippoSignalTable,#accurateSpeedTable,#xKulisAnalysisTable,#kulvarTable,#conditionRankTable,#agfRankTableEl,#valueTable');
   if(!host)return;
   const missing=c=>!!c&&(c.dataset.tkpMissing==='true'||/^(?:veri yok|[-—–])?$/i.test(c.textContent.trim()));
   const allRows=Array.from(table.tBodies).flatMap(b=>Array.from(b.rows));
   if(table.classList.contains('adaptiveLearningTable'))for(const row of allRows){
     if(row.cells.length>=6)row.hidden=Array.from(row.cells).slice(1,6).every(missing);
   }
   const rows=allRows.filter(r=>!r.hidden),hs=Array.from(headers(table));
   if(!rows.length||rows.some(r=>r.cells.length!==hs.length||Array.from(r.cells).some(c=>c.colSpan!==1||c.rowSpan!==1)))return;
   hs.forEach((h,i)=>{
     const hide=i>0&&rows.every(r=>missing(r.cells[i]));
     for(const row of table.rows)if(row.cells[i])row.cells[i].classList.toggle('tkpUnmeasuredColumn',hide);
     const col=table.querySelectorAll('colgroup col')[i];if(col)col.classList.toggle('tkpUnmeasuredColumn',hide);
   });
 }
 function polish(table){
   if(!table.isConnected||table.closest('template,[data-tkp-presentation="off"]'))return;
   table.classList.add('tkpReadable');
   table.classList.toggle('tkpPlainTable',!table.closest('.proPredTable'));
   let wrapper=table.parentElement;
   if(!wrapper.classList.contains('tableWrap')&&!wrapper.classList.contains('tkpTableScroll')){const host=doc.createElement('div');host.className='tkpTableScroll';wrapper.insertBefore(host,table);host.append(table);wrapper=host;}
   wrapper.classList.add('tkpTableScroll');
   const hs=Array.from(headers(table));
   // These legacy aggregate builders still consume db.races. Do not label the
   // materialized tail as a complete archive when segmented mode is active.
   const reportHost=table.closest('#coverage,#categoryAnalysisTable,#conditionRankTable,#agfRankTableEl,#valueTable,#signalPerfTable,#hippoSignalTable,#accurateSpeedTable,#xKulisAnalysisTable,#kulvarTable');
   if(reportHost){
     const current=typeof db!=='undefined'?db:root.db;
     const limited=current?.__segmented_storage?.safeMode&&!root.TKPArchiveAnalytics?.peek(current)&&Number(current.__segmented_storage.collections?.races?.loadedOffset)>0;
     let note=reportHost.querySelector(':scope > .tkpTableScope');
     if(limited){if(!note){note=doc.createElement('p');note.className='muted tkpTableScope';reportHost.prepend(note);}note.textContent='Kapsam: Tam arşiv analizi hazırlanıyor; hesaplama tamamlanmadan bu görünüm nihai sonuç sayılmaz.';}
     else note?.remove();
   }
   hideUnmeasured(table);
   table.style.setProperty('--tkp-table-min',Math.max(0,hs.filter(h=>!h.classList.contains('tkpUnmeasuredColumn')).length*72)+'px');
   for(const body of table.tBodies)for(const row of body.rows)for(const cell of row.cells)if(cell.colSpan===1)polishCell(cell,hs[cell.cellIndex]?.textContent||'');
   if(sortable(table)){
     let best=-1,weight=0;
     hs.forEach((h,i)=>{
       const p=priority(h.textContent);
       if(p>0&&Array.from(table.tBodies[0].rows).some(r=>cellNumber(r.cells[i])!==null)){
         h.dataset.tkpSortColumn=String(i);h.tabIndex=0;h.title='Görünen satırları bu sütuna göre sırala';
         if(p>weight){weight=p;best=i;}
       }
     });
     const state=sortState.get(table);if(state)sort(table,state.column,state.direction);else if(best>=0)sort(table,best,'descending');
   }
   const isEmpty=empty(table);table.dataset.tkpEmpty=String(isEmpty);
   const card=table.closest('.card');
   if(card){
     const tables=Array.from(card.querySelectorAll('table'));
     const hasControls=!!card.querySelector('button,input,select,textarea,a[href],[role="button"]');
     card.classList.toggle('tkpEmptyReport',!hasControls&&tables.length>0&&tables.every(empty));
   }
 }
 const observe=()=>observer.observe(doc.body,{childList:true,subtree:true,characterData:true});
 const observer=new MutationObserver(records=>{
   for(const r of records){const el=r.target.nodeType===1?r.target:r.target.parentElement;
     const table=el?.closest('table');if(table)pending.add(table);
     for(const node of r.addedNodes)if(node.nodeType===1){if(node.matches('table'))pending.add(node);for(const t of node.querySelectorAll('table'))pending.add(t);}
   }
   schedule();
 });
 function schedule(){if(scheduled||!pending.size)return;scheduled=true;setTimeout(flush,0);}
 function flush(){
   scheduled=false;observer.disconnect();
   const start=performance.now();try{for(const t of pending){pending.delete(t);polish(t);if(performance.now()-start>8)break;}}finally{observe();}
   schedule();
 }
 function refresh(scope=doc){if(scope.matches?.('table'))pending.add(scope);for(const t of scope.querySelectorAll('table'))pending.add(t);schedule();}
 function activate(event){
   if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
   const h=event.target.closest?.('th[data-tkp-sort-column]');if(!h||event.target.closest('button,a,input'))return;
   event.preventDefault();const table=h.closest('table'),column=Number(h.dataset.tkpSortColumn),state=sortState.get(table);
   observer.disconnect();try{sort(table,column,state?.column===column&&state.direction==='descending'?'ascending':'descending');}finally{observe();}
 }
 doc.addEventListener('click',activate);doc.addEventListener('keydown',activate);
 const css=doc.createElement('style');css.id='tkp-table-presentation-r1943';css.textContent=`
 #tkpRoot .card{min-width:0}
 .tkpTableScroll,#tkpRoot .tkpTableScroll{display:block;max-width:100%;min-width:0;overflow-x:auto!important;overscroll-behavior-x:contain}
 table.tkpReadable,#tkpRoot table.tkpReadable{width:100%!important;max-width:none!important;min-width:var(--tkp-table-min,0)!important;table-layout:auto!important;border-collapse:collapse;font-size:12px;line-height:1.35}
 table.tkpReadable th,table.tkpReadable td,#tkpRoot table.tkpReadable th,#tkpRoot table.tkpReadable td{padding:4px 6px!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:normal!important;max-width:36ch;vertical-align:middle;height:auto!important;overflow:visible!important;text-overflow:clip!important}
 table.tkpReadable th{font-weight:650}
 table.tkpReadable .num,table.tkpReadable .tkpNumeric,#tkpRoot table.tkpReadable .num,#tkpRoot table.tkpReadable .tkpNumeric{white-space:nowrap!important;font-variant-numeric:tabular-nums;text-align:right}
 table.tkpReadable .tkpDate,#tkpRoot table.tkpReadable .tkpDate{white-space:nowrap!important;min-width:10ch}
 table.tkpReadable th[data-tkp-sort-column]{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
 table.tkpReadable th[aria-sort="descending"]::after{content:' ↓'}table.tkpReadable th[aria-sort="ascending"]::after{content:' ↑'}
 table.tkpReadable td[data-tkp-missing="true"]{color:#64748b}
 .tkpTablePager{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin:8px 0}.tkpTablePager button{padding:5px 10px}
 .tkpEmptyReport{display:none!important}
 table.tkpReadable .tkpUnmeasuredColumn,table.tkpReadable tr[hidden]{display:none!important}
 `;doc.head.append(css);observe();refresh();
 root.TKPTablePresentation={refresh,parse,formatText,polish,cellNumber};
})(globalThis);
