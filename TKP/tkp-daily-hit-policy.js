(function(g){'use strict';
  const VERSION='DAILY-HIT-15000-V1',LIMIT={total:15000,altili:10000,side:5000};
  const pending=new Map();let saveTimer=null;
  function database(){try{return typeof db!=='undefined'?db:null;}catch(_){return null;}}
  function ledger(){const d=database();if(!d)return null;d.settings=d.settings||{};const old=d.settings.daily_hit_plan;if(!old||old.version!==VERSION)d.settings.daily_hit_plan={version:VERSION,objective:'hit_rate',limits:{...LIMIT},days:old?.days||{}};return d.settings.daily_hit_plan;}
  function persist(){if(saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=null;try{if(!g.tkpPersistTopLevelMetaSoon?.({settings:database()?.settings},'daily-hit-plan'))g.saveDB?.(false,false);}catch(_){}},250);}
  function offer(date,item){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!item?.id||!['altili','side'].includes(item.kind)||!Number.isFinite(item.cost)||item.cost<=0)return false;
    const l=ledger();if(!l)return false;const day=l.days[date]||(l.days[date]={offers:{}});
    const rate=item.rate==null?null:Number(item.rate);if(rate!=null&&(!Number.isFinite(rate)||rate<0||rate>1))return false;
    day.offers[item.id]={...item,rate,cost:Math.round(item.cost*100)/100};persist();return true;
  }
  function choose(items,cap,keepUnscored=false){
    const known=items.filter(x=>x.rate!=null&&x.rate>0).sort((a,b)=>a.id.localeCompare(b.id));
    // Exact kuruş cost states; prune states that cost more without raising expected hits.
    let states=[{cost:0,value:0,ids:[]}];
    for(const item of known){const cost=Math.round(item.cost*100),next=new Map(states.map(s=>[s.cost,s]));
      for(const s of states){const nc=s.cost+cost;if(nc>cap*100)continue;const n={cost:nc,value:s.value+item.rate,ids:s.ids.concat(item.id)},old=next.get(nc);if(!old||n.value>old.value+1e-12)next.set(nc,n);}
      let best=-1;states=[...next.values()].sort((a,b)=>a.cost-b.cost).filter(s=>{if(s.value>best+1e-12){best=s.value;return true;}return false;});
    }
    const best=states.sort((a,b)=>b.value-a.value||a.cost-b.cost)[0];
    if(keepUnscored)for(const item of items.filter(x=>x.rate==null)){const c=Math.round(item.cost*100);if(best.cost+c<=cap*100){best.cost+=c;best.ids.push(item.id);}}
    return best;
  }
  function plan(date){const races=new Map((database()?.races||[]).map(r=>[String(r.id),r]));const items=Object.values(ledger()?.days?.[date]?.offers||{}).filter(x=>!(x.refs||[]).some(id=>(races.get(String(id))?.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)>0))),a=choose(items.filter(x=>x.kind==='altili'),LIMIT.altili,true),s=choose(items.filter(x=>x.kind==='side'),LIMIT.side);return {version:VERSION,date,limit:LIMIT.total,altiliCost:a.cost/100,sideCost:s.cost/100,total:(a.cost+s.cost)/100,selected:a.ids.concat(s.ids),offers:items,objective:'sum_of_estimated_ticket_hits',isActualSpend:false};}
  function compare(base,candidate,from,to){
    const valid=r=>r&&r.date>=from&&r.date<=to&&Number.isFinite(r.cost)&&r.cost>0&&typeof r.hit==='boolean';
    const b=new Map(base.filter(valid).map(r=>[r.key,r]));let n=0,bh=0,ch=0;
    for(const c of new Map(candidate.filter(valid).map(r=>[r.key,r])).values()){const old=b.get(c.key);if(!old||old.date!==c.date||c.cost>old.cost+1e-8)continue;n++;bh+=Number(old.hit);ch+=Number(c.hit);}
    return {paired:n,baselineHits:bh,candidateHits:ch,promote:n>=30&&ch>bh,objective:'hit_rate',maxCostRatio:1};
  }
  function live(r){const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Istanbul'});return r&&String(r.race_date||'')>=today&&!(r.horses||[]).some(h=>Number(h.winner)===1||Number(h.finish_position)===1);}
  const meeting=r=>[r.race_date,r.hippodrome,r.altili_no||1].join('|');
  function recordCoupons(built){
    for(const key of ['main','alt','surprise']){const c=built?.[key],r=c?.legs?.[0]?.r;if(!c||c.error||c.disabled||c.readOnlySnapshot||!live(r)||!(c.cost>=2500&&c.cost<=3000))continue;
      const id=meeting(r)+'|'+key,fit=c.conditionFit;
      offer(r.race_date,{id,kind:'altili',refs:c.legs.map(l=>l.r?.id),title:[r.hippodrome,r.altili_no||1,c.label||key].join(' · '),pools:c.legs.map(l=>(l.picks||[]).map(h=>String(h.horse_no))),cost:Number(c.cost),rate:fit?.sample>0&&Number.isFinite(fit.probability)?fit.probability:null,algorithm:c.productHitPolicy?.coverage?.model||c.probRealloc?.version||c.algorithmVersion||'CURRENT_PRODUCTION'});
      c.dailyHitPlan={version:VERSION,date:r.race_date,offerId:id,limit:LIMIT.total,plannedOnly:true};
    }
    return built;
  }
  const fingerprint=(title,pools,cost)=>JSON.stringify([title,pools,Number(cost)]);
  function stageSide(r,title,pools,cost,races=[r],product=''){if(races.every(live)){pending.set(fingerprint(title,pools,cost),{date:r.race_date,id:meeting(r)+'|'+r.leg+'|'+(product||title),refs:races.map(x=>x.id),title:[r.hippodrome,r.leg+'. ayak',title].join(' · '),pools:pools.map(p=>p.map(String))});while(pending.size>300)pending.delete(pending.keys().next().value);}}
  function recordSide(title,pools,cost,metric){const p=pending.get(fingerprint(title,pools,cost));if(!p||!(Number(metric?.total)>0))return;offer(p.date,{...p,kind:'side',cost:Number(cost),rate:Number(metric.rate),algorithm:'CURRENT_PRODUCT_POLICY'});}
  function html(date){const p=plan(date),money=n=>n.toLocaleString('tr-TR',{maximumFractionDigits:2}),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const chosen=p.offers.filter(x=>p.selected.includes(x.id));
    return '<div class="card dailyHitPlan"><h3>Günlük seçili plan · '+esc(date)+'</h3><p><b>'+money(p.total)+' / 15.000 TL</b> · Altılı '+money(p.altiliCost)+' / 10.000 TL · Yan bahis '+money(p.sideCost)+' / 5.000 TL</p><p>Gösterilen aday kartların tamamı seçili değildir. Bu bir öneri planıdır; oynanmış bahis veya harcama kaydı değildir.</p><ul>'+chosen.map(x=>'<li>'+esc(x.title)+' · '+money(x.cost)+' TL'+(x.rate==null?' · isabet verisi yok':(x.kind==='side'?' · geçmiş isabet %':' · tahmini kapsama %')+(x.rate*100).toFixed(1))+'<br>'+esc((x.pools||[]).map(p=>p.join(',')).join(' / '))+'</li>').join('')+'</ul></div>';
  }
  g.TKP_DAILY_HIT_POLICY=Object.freeze({VERSION,LIMIT,offer,plan,compare,recordCoupons,stageSide,recordSide,html});
})(globalThis);

