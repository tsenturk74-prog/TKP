/* Full archive UI orchestration and the second, feature-learning pass. */
async function tkpBuildFullArchiveAdaptive(database,summary,options={}){
  tkpDiscoverAdditionalFeatures(database,summary.observed);
  const core=Object.keys(ADAPTIVE_BASE_WEIGHTS),keys=[...TKP_FEATURE_REGISTRY.keys()],extra=keys.filter(k=>!core.includes(k)),out=_adaptiveStatsInit(keys);
  let processed=0,last=performance.now();
  const pause=async()=>{options.check?.();if(performance.now()-last>=8){await new Promise(r=>setTimeout(r,0));last=performance.now();}};
  await TKPHistoryQuery.withHistory(database,async pages=>{
    for await(const page of pages){for(const race of page){
      options.check?.();processed++;
      const live=tkpLiveHorses(race),actual={};for(let pos=1;pos<=5;pos++)actual[pos]=live.filter(h=>tkpAnalysisFinishPosition(h)===pos);
      if(!actual[1].length){await pause();continue;}
      race.__tkpArchiveCondition=TKPArchiveAnalytics.conditionBefore(summary,race);
      // This overrides only the nested-history lookup, not the feature formula.
      await _adaptiveAccumulateRaceAsync(race,core,out,{sliceStart:performance.now()});
      for(const key of extra){
        const eligible=live.filter(h=>tkpFeaturePresentForHorse(race,h,key));
        if(eligible.length){
          const values=tkpFeatureBatchValues(race,eligible,key,live);
          const ordered=eligible.slice().sort((a,b)=>(values.get(b)||0)-(values.get(a)||0)||TKP_TR_COLLATOR_NUM.compare(String(a.horse_no||''),String(b.horse_no||'')));
          const set=new Set(eligible);
          for(let pos=1;pos<=5;pos++){
            const targets=actual[pos].filter(h=>set.has(h));if(!targets.length||ordered.length<pos)continue;
            const predicted=ordered[pos-1],value=values.get(predicted);if(eligible.filter(h=>values.get(h)===value).length!==1)continue;
            const g=out[key]['p'+pos];g.total++;if(targets.some(h=>String(h.horse_no)===String(predicted.horse_no)||(typeof sameEkuri==='function'&&sameEkuri(h.horse_no,predicted.horse_no))))g.ok++;
          }
        }
        await pause();
      }
      await pause();
    }options.onProgress?.({phase:'adaptive',processed,total:summary.source.races});}
  },{...options,activeOnly:false,includeFile:true});
  options.check?.();
  _adaptiveStatsFinalize(out,keys,{count:summary.stats.races,rows:[],level:'Tüm arşiv · disk + bellek'});
  summary.adaptive=out;
  if(typeof _tkpPurposeWeightCache!=='undefined')_tkpPurposeWeightCache.clear();
}
(function(root){
 'use strict';const pending=new Map();
 const api=()=>root.TKPArchiveAnalytics;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function progress(el,p){if(el)el.innerHTML=`<p role="status" class="tkpArchiveProgress">${p?.phase==='adaptive'?'Adaptif özellikler':'Tüm arşiv'} hesaplanıyor: ${Number(p?.processed||0).toLocaleString('tr-TR')} / ${Number(p?.total||0).toLocaleString('tr-TR')} koşu. Menüleri kullanabilirsiniz.</p>`;}
 function after(hostId,callback,adaptive=false){
  const el=document.getElementById(hostId);if(!el)return Promise.resolve(false);
  const wanted=api().signature(),key=hostId+'|'+wanted;if(pending.has(key))return pending.get(key);
  progress(el);const task=(adaptive?api().ensureAdaptive(undefined,{onProgress:p=>progress(el,p)}):api().ensure(undefined,{onProgress:p=>progress(el,p)})).then(()=>{
    if(api().signature()!==wanted)return false;return callback();
  }).catch(e=>{if(api().signature()===wanted)el.innerHTML=`<p role="alert">Tam arşiv analizi tamamlanamadı: ${escape(e.message)}</p><button type="button" data-tkp-archive-retry>Yeniden hesapla</button>`;const b=el.querySelector('[data-tkp-archive-retry]');if(b)b.onclick=()=>after(hostId,callback,adaptive);return false;}).finally(()=>pending.delete(key));
  pending.set(key,task);return task;
 }
 function renderInto(id,builder){
  return after(id,()=>{const wanted=api().signature(),el=document.getElementById(id);return Promise.resolve(builder()).then(html=>{if(api().signature()!==wanted)return false;el.innerHTML=String(html||'');for(const t of el.querySelectorAll('table'))t.dataset.tkpScope='full';root.TKPTablePresentation?.refresh(el);return true;});},id==='adaptiveLearningTable');
 }
 function xHTML(full){
  const rows=full.x.groups.filter(g=>g.count).map(g=>{const rate=(a,b)=>b?'%'+(a/b*100).toLocaleString('tr-TR',{maximumFractionDigits:2}):'—';return `<tr><td>${g.direction>0?'Olumlu kulis':g.direction<0?'Olumsuz kulis':'Yönü nötr / eski kayıt'}</td><td class="num">${g.count}</td><td class="num">${g.scoreCount?'%'+(g.scoreSum/g.scoreCount).toLocaleString('tr-TR',{maximumFractionDigits:2}):'—'}</td><td class="num">${g.deltaCount?(g.deltaSum/g.deltaCount).toLocaleString('tr-TR',{maximumFractionDigits:2}):'—'}</td><td>${g.known?g.wins+'/'+g.known:'—'}</td><td class="num">${rate(g.wins,g.known)}</td></tr>`;}).join('');
  return `<div class="tableWrap"><table data-tkp-scope="full"><thead><tr><th>X etkisi</th><th>At</th><th>Ort. güven</th><th>Ort. YPUAN farkı</th><th>Kazanan / sonuçlu</th><th>İsabet</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="empty">Veri yok.</td></tr>'}</tbody></table></div><p class="muted">Tüm arşiv · ${full.x.archivedComments} yorum parçası · ${full.x.archivedVerified} sonuçlu at satırı.</p>`;
 }
 root.TKPArchiveAnalyticsUI={after,renderInto,xHTML};
})(globalThis);
