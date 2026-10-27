'use strict';
const fs=require('fs'),zlib=require('zlib');
const input=process.argv[2],output=process.argv[3]||input;if(!input)throw new Error('usage: node R15_6_CALIBRATION_PROVENANCE.cjs input.tkbz [output.tkbz]');
const raw=zlib.gunzipSync(fs.readFileSync(input));let o=0;
const take=n=>{const b=raw.subarray(o,o+n);o+=n;return b;};
const u32=()=>{const n=raw.readUInt32BE(o);o+=4;return n;};
if(take(4).toString()!=='TKPB')throw new Error('bad magic');const version=u32();const env=JSON.parse(take(u32()).toString());
const chunks=new Map();for(const d of env.collections||[]){const a=[];for(let i=0;i<Number(d.chunks||0);i++)a.push(JSON.parse(take(u32()).toString()));chunks.set(d.name,a);}if(o!==raw.length)throw new Error('trailing bytes');
env.scalarFields=env.scalarFields||{};const state=env.scalarFields.learning_state=env.scalarFields.learning_state&&typeof env.scalarFields.learning_state==='object'?env.scalarFields.learning_state:{};
state.r15_6_clean509_joint_calibration={
  version:'R15.6-CLEAN509-WALKFORWARD-JOINT-20260901',
  dataset:{archiveMeetings:509,archiveRaces:3054,verifiedRaces:2886,quarantinedRaces:168,fitRaces:2287,holdoutRaces:599},
  splitRule:'sequence_no <= 407 fit; > 407 untouched holdout',
  p1Decision:'KEEP_CHAMPION_P1',
  policy:{finalTailBlend:.10,sidebetLowSampleBlend:.12,sidebetMidSampleBlend:.08,sidebetHighSampleBlend:.03,sidebetP1MaxBlend:.04,productFormulaDecision:'RETAIN_V46_PRODUCT_SPECIFIC',autoActivateSidebets:false},
  outcomeSignature:String(state.outcome_signature||'OUTCOME:2886:vmn2ib'),
  provenance:'OFFICIAL_RESULT_VERIFIED_WALKFORWARD_RESEARCH',
  generatedAt:'2026-09-01T17:30:00.000Z'
};
env.scalarFields.settings=env.scalarFields.settings||{};env.scalarFields.settings.r15_6_calibration={version:state.r15_6_clean509_joint_calibration.version,verifiedRaces:2886,holdoutRaces:599,sidebetsIncluded:true,noSameRaceFeedback:true};
const parts=[];const put32=n=>{const b=Buffer.allocUnsafe(4);b.writeUInt32BE(n>>>0);parts.push(b);};parts.push(Buffer.from('TKPB'));put32(version);const eb=Buffer.from(JSON.stringify(env));put32(eb.length);parts.push(eb);for(const d of env.collections||[])for(const c of chunks.get(d.name)||[]){const b=Buffer.from(JSON.stringify(c));put32(b.length);parts.push(b);}fs.writeFileSync(output,zlib.gzipSync(Buffer.concat(parts),{level:9}));
console.log(JSON.stringify({version,collections:(env.collections||[]).map(x=>({name:x.name,count:x.count,chunks:x.chunks})),calibration:state.r15_6_clean509_joint_calibration},null,2));
