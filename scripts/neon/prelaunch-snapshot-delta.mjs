import fs from 'node:fs';import assert from 'node:assert/strict';
import {loadBackup,privateFile,sha} from './backup-common.mjs';
// Inventory only. Never imports/replays/deletes source or destination records.
const original=process.env.NEON_RESTORE_TARGET;
try{
 process.env.NEON_RESTORE_TARGET='hybrid-staging';const before=(await loadBackup()).snapshot;
 process.env.NEON_RESTORE_TARGET='hybrid-candidate';const {snapshot:after,ciphertextSha256}=await loadBackup();
 const canonical=rows=>sha([...rows].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).join('\n'));
 const drift=[];for(const t of after.tables){const old=before.tables.find(x=>x.schema===t.schema&&x.name===t.name);if(!old||canonical(old.rows)!==canonical(t.rows))drift.push({table:t.schema+'.'+t.name,before:old?.rows.length??null,after:t.rows.length});}
 for(const t of before.tables)if(!after.tables.some(x=>x.schema===t.schema&&x.name===t.name))drift.push({table:t.schema+'.'+t.name,before:t.rows.length,after:null});
 const checkpoint=JSON.parse(privateFile(process.argv[2]||'build/neon/private-prelaunch-source-fingerprints.json'));
 assert.equal(checkpoint.format,'newhope-prelaunch-source-fingerprints-v1');assert.equal(checkpoint.sourceProject,after.sourceProject);
 const currentDrift=[];for(const t of after.tables){const current=checkpoint.tables.find(v=>v.schema===t.schema&&v.name===t.name);if(!current||current.fingerprint.rows!==t.rows.length||current.fingerprint.sha256!==canonical(t.rows))currentDrift.push(t.schema+'.'+t.name);}
 for(const t of checkpoint.tables)if(!after.tables.some(x=>x.schema===t.schema&&x.name===t.name))currentDrift.push(t.schema+'.'+t.name);
 const evidence={format:'newhope-prelaunch-snapshot-delta-v1',baselineCapture:before.capturedAt,candidateCapture:after.capturedAt,candidateCiphertextSha256:ciphertextSha256,checkpointAt:checkpoint.capturedAt,tables:after.tables.length,rows:after.tables.reduce((n,t)=>n+t.rows.length,0),baselineChanges:drift,currentDrift,sourceFrozen:false,status:currentDrift.length?'DRIFT_REQUIRES_REVIEW':'NO_DRIFT_AT_READ_ONLY_CHECKPOINT',deltaApplied:false,cutoverAllowed:false};
 fs.writeFileSync('build/neon/prelaunch-source-delta-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{if(original===undefined)delete process.env.NEON_RESTORE_TARGET;else process.env.NEON_RESTORE_TARGET=original;}
