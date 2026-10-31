/* User instruction, 25 Oct 2026: late and transferred selections enter the same evaluation.
   Keep original timestamps/evidence and picks intact; acceptance is not a rewritten time proof. */
(function(g){'use strict';
 const VERSION='USER-ACCEPTED-RECORDS-20261025';
 function validRole(c){
  if(!c||c.error||!Array.isArray(c.legs)||c.legs.length!==6||!(Number(c.unit)>0)||!(Number(c.cost)>0))return false;
  const legs=c.legs.slice().sort((a,b)=>Number(a.leg)-Number(b.leg));
  if(!legs.every((l,i)=>Number(l.leg)===i+1&&Array.isArray(l.picks)&&l.picks.length&&l.picks.every(n=>String(n).trim())&&new Set(l.picks.map(n=>String(n).match(/-E\d+$/i)?.[0]||String(n))).size===l.picks.length))return false;
  const cost=legs.reduce((n,l)=>n*l.picks.length,1)*Number(c.unit);
  return Math.abs(cost-Number(c.cost))<.02;
 }
 function snapshot(s){return !!s?.coupons&&Object.values(s.coupons).some(validRole);}
 g.TKP_RECORD_ACCEPTANCE=Object.freeze({VERSION,validRole,snapshot});
})(globalThis);
