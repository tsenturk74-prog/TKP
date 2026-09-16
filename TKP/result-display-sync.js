(function(g){
'use strict';
const base=h=>String(h?.horse_no??h??'').replace(/-E\d+$/i,'');
const hip=v=>typeof g.canonicalHippodrome==='function'?g.canonicalHippodrome(v):String(v||'').toLocaleUpperCase('tr-TR');
function identity(r){return [r?.file_id,r?.race_date,hip(r?.hippodrome),r?.altili_no||1,r?.leg].join('|');}
function reader(source){
 const files=new Map((source?.files||[]).map(f=>[String(f.id),f]));
 const groups=new Map();
 const meeting=r=>[r.race_date||files.get(String(r.file_id))?.race_date,hip(r.hippodrome||files.get(String(r.file_id))?.hippodrome),r.altili_no||files.get(String(r.file_id))?.altili_no||1,r.leg].join('|');
 for(const r of source?.races||[]){
  if(r.result_integrity_status!=='VERIFIED'||!(Number(r.result_verified_depth)>0))continue;
  const k=meeting(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);
 }
 return r=>{
  if(!r)return r;
  const candidates=groups.get(meeting(r))||[],exact=candidates.filter(x=>String(x.file_id)===String(r.file_id));
  const eligible=exact.length?exact:candidates;
  // Conflicting duplicate imports must be resolved upstream, never by whichever
  // file happens to be last in the array.
  const signatures=new Set(eligible.map(x=>JSON.stringify((x.horses||[]).filter(h=>Number(h.finish_position)>0).map(h=>[base(h),Number(h.finish_position)]).sort())));
  if(!eligible.length||signatures.size!==1)return r;
  const latest=eligible[0],byNo=new Map((latest.horses||[]).map(h=>[base(h),h]));
  return {...r,result_integrity_status:latest.result_integrity_status,result_verified_depth:latest.result_verified_depth,
   payouts:latest.payouts||r.payouts,available_bets:latest.available_bets||r.available_bets,
   horses:(r.horses||[]).map(h=>horse(h,byNo.get(base(h))))};
 };
}
function horse(h,result){
 if(!result)return h;
 const out={...h};
 if(Object.prototype.hasOwnProperty.call(result,'finish_position')){out.finish_position=result.finish_position??null;out.winner=Number(result.finish_position)===1?1:0;}
 if(Number.isInteger(Number(result.start_no))&&Number(result.start_no)>0&&/^TJK_PROGRAM/i.test(String(result.start_no_source||''))){out.start_no=Number(result.start_no);out.start_no_source=result.start_no_source;}
 return out;
}
function leg(x,read=reader(g.db)){
 if(!x?.r)return x;const r=read(x.r);
 const byNo=new Map(r.horses.map(h=>[base(h),h])),merge=rows=>rows?.map(h=>horse(h,byNo.get(base(h))));
 return {...x,r,scored:merge(x.scored),allHorses:merge(x.allHorses),ordered:merge(x.ordered),picks:merge(x.picks)};
}
function coupon(c){if(!c?.legs)return c;const read=reader(g.db);return {...c,legs:c.legs.map(x=>leg(x,read))};}
function refreshOverview(root){
 if(typeof document==='undefined')return 0;
 root=root||document;
 const rows=typeof lastRaceResults!=='undefined'?lastRaceResults:[];
 const read=reader(g.db);let changed=0;
 for(const tr of root.querySelectorAll('.firstLookOverviewTable tbody tr')){
  const cells=tr.querySelectorAll('td'),wrap=tr.querySelector('.v55FirstLookHorseWrap');
  if(!wrap||!cells.length)continue;
  const legNo=Number(String(cells[0].textContent||'').match(/\d+/)?.[0]);
  const number=wrap.querySelector('.horseNoBadge');
  if(!number)continue;
  const horseNo=base(String(number.textContent||'').trim());
  const x=(rows||[]).find(x=>Number(x?.r?.leg)===legNo);
  if(!x)continue;
  const race=read(x.r),h=(race.horses||[]).find(h=>base(h)===horseNo);
  if(!h)continue;
  const info=typeof g.tkpV55LegResultInfo==='function'?g.tkpV55LegResultInfo(race,h):null;
  if(!info)continue;
  wrap.querySelectorAll('.v55FirstLookResult').forEach(node=>node.remove());
  for(const cls of [...wrap.classList])if(cls.startsWith('result-'))wrap.classList.remove(cls);
  if(info.known){
   wrap.classList.add('result-'+info.cls);
   const badge=document.createElement('span');badge.className='v55FirstLookResult '+info.cls;
   badge.textContent=info.label;wrap.appendChild(badge);
  }
  changed++;
 }
 return changed;
}
function refresh(){
 if(typeof document==='undefined')return;
 const rows=typeof lastRaceResults!=='undefined'?lastRaceResults:[];
 // Only replace visible result tables/cards. No scoring, training or coupon build.
 for(const x of rows||[]){
  const node=[...document.querySelectorAll('.proPredTable[data-result-view]')].find(n=>n.dataset.resultView===identity(x.r));
  if(!node)continue;
  const top=node.scrollTop,left=node.scrollLeft,holder=document.createElement('div');
  holder.innerHTML=g.legTableHTML(x);const next=holder.firstElementChild;
  if(next){node.replaceWith(next);next.scrollTop=top;next.scrollLeft=left;}
 }
 if(typeof g.renderCouponCard==='function')for(const role of ['main','alt','surprise'])g.renderCouponCard(role);
 refreshOverview();
}
let timer=0;
if(typeof g.addEventListener==='function')g.addEventListener('tkp:db-changed',e=>{
 if(!e?.detail?.resultsChanged&&!e?.detail?.outcomeChanged)return;clearTimeout(timer);timer=setTimeout(refresh,0);
});
g.TKP_RESULT_VIEW={reader,leg,coupon,identity,refresh,refreshOverview};
})(globalThis);
