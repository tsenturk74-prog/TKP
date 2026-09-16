const fs=require('fs'),vm=require('vm'),assert=require('assert');
const code=fs.readFileSync('TKP/tkp-r19-integrity-runtime.js','utf8');
const ctx={console,setTimeout,clearTimeout,performance:{now:()=>Date.now()},globalThis:null,window:null,document:{querySelector:()=>null}};
ctx.globalThis=ctx;ctx.window=ctx;
vm.createContext(ctx);vm.runInContext(code,ctx,{filename:'tkp-r19-integrity-runtime.js'});
assert.equal(typeof ctx.tkpIntegrityRaceKey,'function');
assert.equal(ctx.tkpIntegrityRaceKey({race_date:'2026-09-16',hippodrome:'İZMİR',altili_no:2,leg:4}),'2026-09-16|IZMIR|2|4');
const rows=[
 {race_key:'A',created_at:'2026-09-01T10:00:00Z',coupons:{main:['1']}},
 {race_key:'A',evaluated_at:'2026-09-01T12:00:00Z',winner_no:'2',coupons:{surprise:['2']}},
 {race_key:'B',created_at:'2026-09-02T10:00:00Z'}
];
const d=ctx.tkpIntegrityMergeForwardRows(rows);
assert.equal(d.rows.length,2);
const a=d.rows.find(x=>x.race_key==='A');
assert.equal(a.winner_no,'2');assert.deepEqual(JSON.parse(JSON.stringify(a.coupons.main)),['1']);assert.deepEqual(JSON.parse(JSON.stringify(a.coupons.surprise)),['2']);
const side=ctx.tkpIntegrityDedupeByKey([
 {lock_key:'X',integrity:'PENDING',captured_at:'2026-09-01T10:00:00Z'},
 {lock_key:'X',integrity:'RESOLVED',integrity_checked_at:'2026-09-01T12:00:00Z'}
],r=>r.lock_key,ctx.tkpIntegrityPreferResolved);
assert.equal(side.rows.length,1);assert.equal(side.rows[0].integrity,'RESOLVED');
console.log('R19.2 runtime unit: PASS');
