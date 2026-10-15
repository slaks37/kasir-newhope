import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {loadBackup} from './backup-common.mjs';
// A read-only drift inventory, never a delta importer or approval generator.
const checkpoint=JSON.parse(fs.readFileSync(process.argv[2]||'build/neon/release-source-checkpoint.json','utf8'));
if(checkpoint.format!=='newhope-release-checkpoint-v1'||checkpoint.sourceProject!=='fqxrhumsgigcgjtlbfuo'||!Array.isArray(checkpoint.fingerprints))throw Error('CHECKPOINT_SCOPE_INVALID');
const start=performance.now();
const {snapshot:s,ciphertextSha256}=await loadBackup('build/neon/source-2026-10-15-fresh.pgp.b64');
const db=new PGlite(),changes=[];
try{
 const seen=new Set();
 for(const t of s.tables){const key=t.schema+'.'+t.name;seen.add(key);const current=checkpoint.fingerprints.find(f=>f.schema===t.schema&&f.name===t.name);
 const base=(await db.query('SELECT count(*)::int rows,md5(coalesce(string_agg(value::text,E\'\\n\' ORDER BY value::text COLLATE "C"),\'\')) digest FROM jsonb_array_elements($1::jsonb) x(value)',['['+t.rows.join(',')+']'])).rows[0];
 if(!current||current.rows!==base.rows||current.digest!==base.digest)changes.push({table:key,before:base.rows,after:current?.rows??null,kind:current?'DATA_DRIFT':'SOURCE_TABLE_MISSING',requiresFrozenSnapshotReview:true});
 }
 for(const t of checkpoint.fingerprints)if(!seen.has(t.schema+'.'+t.name))changes.push({table:t.schema+'.'+t.name,before:null,after:t.rows,kind:'NEW_SOURCE_TABLE',requiresFrozenSnapshotReview:true});
 const receipt={status:changes.length?'DRIFT_REQUIRES_FROZEN_DELTA':'NO_DRIFT_OBSERVED_AT_CHECKPOINT',baselineCapture:s.capturedAt,baselineCiphertextSha256:ciphertextSha256,checkpointAt:checkpoint.capturedAt,tablesCompared:s.tables.length,changes,elapsedMs:Math.round(performance.now()-start),scope:'Credential-free table fingerprint comparison only; no source/target writes, no backup recreated, no final snapshot or device/provider assertion',productionDecision:'NO-GO',cutoverDowntimeEstimate:null};
 fs.writeFileSync('build/neon/release-delta-evidence.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.close();}
