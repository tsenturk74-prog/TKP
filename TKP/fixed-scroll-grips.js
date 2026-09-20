(function tkpInstallFixedScrollGrips(){
globalThis.tkpInstallFixedScrollGrips=tkpInstallFixedScrollGrips;
'use strict';
if(typeof document==='undefined'||!document.head||document.getElementById('tkp-fixed-scroll-grips-style')||typeof ResizeObserver!=='function'||typeof MutationObserver!=='function')return;
// Native thumbs are proportional; min-height alone cannot give equal grips.
// The content keeps native scrolling. Only its visual controls are replaced.
// Both axes use the same compact handle so every scrollbar has a consistent
// minimum 2 cm grip (76 CSS px), clipped only when the track is shorter.
const LENGTH_X=76,LENGTH_Y=76,WIDTH=7,owners=new Map();let frame=0,discover=true,sequence=0;
const selector='.tableWrap,.forwardMainScroll,.forwardTopScroll,.sideBetPoolRow,.adaptiveLearningWrap,.tkpCommentatorTableWrap,.tkpSystemFoldBody,.raceCheckWrap,.firstLookOverviewTable,.pane,#tkpRoot';
const style=document.createElement('style');style.id='tkp-fixed-scroll-grips-style';
style.textContent=`
html.tkpFixedScrollOwner::-webkit-scrollbar,body.tkpFixedScrollOwner::-webkit-scrollbar,
#tkpRoot#tkpRoot#tkpRoot#tkpRoot#tkpRoot#tkpRoot.tkpFixedScrollOwner::-webkit-scrollbar,
#tkpRoot#tkpRoot#tkpRoot#tkpRoot#tkpRoot#tkpRoot .tkpFixedScrollOwner::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}
.tkpFixedScrollRail{position:fixed!important;z-index:1200!important;background:#edf2f7!important;border:0!important;border-radius:8px!important;padding:0!important;margin:0!important;touch-action:none;user-select:none;box-sizing:border-box!important;overflow:hidden!important}
.tkpFixedScrollRail[hidden]{display:none!important}
.tkpFixedScrollGrip{position:absolute!important;background:#9fb0c3!important;border:1px solid #edf2f7!important;border-radius:8px!important;box-sizing:border-box!important;cursor:grab;touch-action:none}
.tkpFixedScrollRail:focus-visible{outline:2px solid #64748b!important;outline-offset:1px!important}
.tkpFixedScrollRail:active .tkpFixedScrollGrip{cursor:grabbing}
@media print{.tkpFixedScrollRail{display:none!important}}
`;
document.head.appendChild(style);
const schedule=(scan=false)=>{discover=discover||scan;if(!frame)frame=requestAnimationFrame(update);};
const resize=new ResizeObserver(()=>schedule());
function control(owner,axis){
 const rail=document.createElement('div'),grip=document.createElement('div');
 rail.className='tkpFixedScrollRail';grip.className='tkpFixedScrollGrip';rail.appendChild(grip);
 rail.dataset.axis=axis;rail.setAttribute('role','scrollbar');rail.tabIndex=0;
 rail.setAttribute('aria-controls',owner.id);rail.setAttribute('aria-orientation',axis==='x'?'horizontal':'vertical');
 rail.setAttribute('aria-label',axis==='x'?'Tabloyu yatay kaydır':'İçeriği dikey kaydır');rail.setAttribute('aria-valuemin','0');
 document.body.appendChild(rail);
 const result={rail,grip,axis,range:0,travel:0,length:0};
 const get=()=>axis==='x'?owner.scrollLeft:owner.scrollTop;
 const set=value=>{if(axis==='x')owner.scrollLeft=value;else owner.scrollTop=value;schedule();};
 let drag=null;
 rail.addEventListener('pointerdown',event=>{
  if(event.button!==0)return;event.preventDefault();rail.focus({preventScroll:true});
  const point=axis==='x'?event.clientX:event.clientY,rect=rail.getBoundingClientRect();
  if(event.target!==grip){const at=point-(axis==='x'?rect.left:rect.top)-result.length/2;set(result.travel?at/result.travel*result.range:0);}
  drag={point,value:get()};rail.setPointerCapture(event.pointerId);
 });
 rail.addEventListener('pointermove',event=>{if(!drag)return;const point=axis==='x'?event.clientX:event.clientY;set(drag.value+(point-drag.point)/Math.max(1,result.travel)*result.range);});
 const end=()=>{drag=null;};rail.addEventListener('pointerup',end);rail.addEventListener('pointercancel',end);rail.addEventListener('lostpointercapture',end);
 rail.addEventListener('keydown',event=>{
  const page=axis==='x'?owner.clientWidth:owner.clientHeight;
  const steps={ArrowLeft:-40,ArrowUp:-40,ArrowRight:40,ArrowDown:40,PageUp:-page,PageDown:page};
  if(event.key==='Home'){event.preventDefault();set(0);}else if(event.key==='End'){event.preventDefault();set(result.range);}else if(event.key in steps){event.preventDefault();set(get()+steps[event.key]);}
 });
 rail.addEventListener('wheel',event=>{event.preventDefault();set(get()+(axis==='x'?(event.deltaX||event.deltaY):event.deltaY));},{passive:false});
 return result;
}
function attach(owner){
 if(owners.has(owner))return;
 if(!owner.id)owner.id='tkp-scroll-owner-'+(++sequence);
 const item={owner,x:control(owner,'x'),y:control(owner,'y'),child:owner.firstElementChild};owners.set(owner,item);
 owner.classList.add('tkpFixedScrollOwner');owner.style.setProperty('scrollbar-width','none','important');
 resize.observe(owner);if(item.child)resize.observe(item.child);
}
function update(){
 frame=0;
 if(discover){discover=false;
  const root=document.getElementById('tkpRoot');
  if(root){for(const owner of root.querySelectorAll(selector)){
   const css=getComputedStyle(owner);if(/auto|scroll/.test(css.overflowX+' '+css.overflowY))attach(owner);
  }const css=getComputedStyle(root);if(/auto|scroll/.test(css.overflowX+' '+css.overflowY))attach(root);}
  if(document.scrollingElement)attach(document.scrollingElement);
 }
 for(const [owner,item] of owners){
  if(!owner.isConnected){resize.unobserve(owner);if(item.child)resize.unobserve(item.child);item.x.rail.remove();item.y.rail.remove();owners.delete(owner);continue;}
  const page=owner===document.scrollingElement,box=page?{left:0,top:0,right:innerWidth,bottom:innerHeight,width:innerWidth,height:innerHeight}:owner.getBoundingClientRect();
  const visible=box.width>0&&box.height>0&&box.right>0&&box.bottom>0&&box.left<innerWidth&&box.top<innerHeight;
  const horizontal=owner.scrollWidth>owner.clientWidth+1,vertical=owner.scrollHeight>owner.clientHeight+1;
  for(const axis of ['x','y']){
   const c=item[axis],isX=axis==='x',range=isX?owner.scrollWidth-owner.clientWidth:owner.scrollHeight-owner.clientHeight;
   const enabled=visible&&range>1&&(isX?box.bottom>0&&box.bottom<=innerHeight+1:box.right>0&&box.right<=innerWidth+1);
   c.rail.hidden=!enabled;if(!enabled)continue;
   // Clip the track to the viewport; horizontal and vertical grips have
   // separate fixed visual lengths while the content keeps native scrolling.
   const start=Math.max(0,isX?box.left:box.top),end=Math.min(isX?innerWidth:innerHeight,isX?box.right:box.bottom);
   const track=Math.max(0,end-start-((isX?vertical:horizontal)?WIDTH:0));
   c.range=range;c.length=Math.min(isX?LENGTH_X:LENGTH_Y,track);c.travel=Math.max(0,track-c.length);
   const offset=(isX?owner.scrollLeft:owner.scrollTop)/range*c.travel;
   Object.assign(c.rail.style,isX?{left:start+'px',top:(box.bottom-WIDTH)+'px',width:track+'px',height:WIDTH+'px'}:{left:(box.right-WIDTH)+'px',top:start+'px',width:WIDTH+'px',height:track+'px'});
   Object.assign(c.grip.style,isX?{left:offset+'px',top:'0px',width:c.length+'px',height:WIDTH+'px'}:{left:'0px',top:offset+'px',width:WIDTH+'px',height:c.length+'px'});
   c.rail.setAttribute('aria-valuemax',String(Math.round(range)));c.rail.setAttribute('aria-valuenow',String(Math.round(isX?owner.scrollLeft:owner.scrollTop)));
  }
 }
}
function start(){
 // The application creates #tkpRoot after the initial scripts run. Observe the
 // body in that case so the first render is still picked up; observing only a
 // missing root silently disabled the custom controls on the live page.
 const observeRoot=document.getElementById('tkpRoot')||document.body;if(!observeRoot)return;
 new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.tkpFixedScrollRail')))schedule(true);}).observe(observeRoot,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 document.addEventListener('scroll',()=>schedule(),{capture:true,passive:true});
 window.addEventListener('resize',()=>schedule(true));schedule(true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
