import fs from 'node:fs';import assert from 'node:assert/strict';import pg from 'pg';
import {loadBackup,restoreTarget,privateFile,sha,relation,quote,appSchemas} from './backup-common.mjs';
import {planBusinessDelta} from './business-delta.mjs';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
assert.equal(process.env.NEON_RESTORE_TARGET,'hybrid-candidate','ISOLATED_CANDIDATE_ONLY');
const file=arg('--archive'),reviewed=arg('--reviewed-sha256');assert(file&&reviewed&&/^[a-f0-9]{64}$/.test(reviewed),'REVIEWED_ARCHIVE_REQUIRED');
const cipher=privateFile(file);assert.equal(sha(cipher),reviewed,'ARCHIVE_HASH_MISMATCH');
const pgp=await import('../../build/neon-tools/node_modules/openpgp/dist/node/openpgp.mjs');
const key=await pgp.readPrivateKey({armoredKey:privateFile('.env.neon-backup-keys.local/private.asc').toString()});
const next=JSON.parse((await pgp.decrypt({message:await pgp.readMessage({binaryMessage:Buffer.from(cipher.toString(),'base64')}),decryptionKeys:key})).data);
assert.equal(next.format,'newhope-pg-recovery-v1');assert.equal(next.sourceProject,'fqxrhumsgigcgjtlbfuo');
assert.deepEqual([...next.schemas].sort(),[...appSchemas].sort());assert.equal(next.tables.length,125);
const {snapshot:baseline,ciphertextSha256:baselineSha}=await loadBackup();
assert.deepEqual((next.authMetadata||[]).map(a=>[a.id,a.created_at]).sort(),(baseline.authMetadata||[]).map(a=>[a.id,a.created_at]).sort(),'CANONICAL_AUTH_INVENTORY_DELTA_REQUIRES_REVIEW');
const {env,manifest,...config}=restoreTarget(),c=new pg.Client(config),apply=args.includes('--apply');
const started=Date.now();await c.connect();
try{
 assert(c.connection.stream.authorized&&c.connection.stream.encrypted);
 await c.query(apply?'BEGIN ISOLATION LEVEL SERIALIZABLE':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await c.query("SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='120s'; SET LOCAL lock_timeout='5s'");
 if(apply)await c.query('LOCK TABLE '+baseline.tables.map(relation).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
 const current={tables:[]};
 for(const t of baseline.tables)current.tables.push({...t,rows:(await c.query('SELECT to_jsonb(t)::text row FROM '+relation(t)+' t')).rows.map(r=>r.row)});
 // Baseline strings already come from source jsonb::text. Canonicalize on this PG
 // version to avoid PG17/18 JSON formatting differences, without JS precision loss.
 for(const s of [baseline,next])for(const t of s.tables)t.rows=(await c.query('SELECT value::text row FROM jsonb_array_elements($1::jsonb)', ['['+t.rows.join(',')+']'])).rows.map(r=>r.row);
 const plans=planBusinessDelta(baseline,next,current);
 // Actual FK graph, including quoted identifiers, must agree with execution order.
 const fks=(await c.query("SELECT conrelid::regclass::text child,confrelid::regclass::text parent FROM pg_constraint WHERE contype='f'")).rows;
 const names=plans.map(t=>t.schema+'.'+t.name);for(const fk of fks){const norm=v=>v.includes('.')?v.replaceAll('"',''):'public.'+v.replaceAll('"','');const child=names.indexOf(norm(fk.child)),parent=names.indexOf(norm(fk.parent));assert(child<0||parent<0||parent<=child,'LIVE_FK_ORDER_REQUIRES_REVIEW');}
 if(apply){
  for(const t of plans){const cols=t.columns.filter(c=>!c.generated).map(c=>c.name);assert(t.columns.every(c=>!c.identity),'IDENTITY_COLUMN_REQUIRES_REVIEW');
   for(const row of t.inserts)await c.query('INSERT INTO '+relation(t)+' ('+cols.map(quote).join(',')+') SELECT '+cols.map(quote).join(',')+' FROM jsonb_populate_record(NULL::'+relation(t)+',$1::jsonb)',[row]);
   const mutable=cols.filter(n=>!t.primaryKey.includes(n));
   for(const row of t.updates){const r=await c.query('UPDATE '+relation(t)+' t SET '+mutable.map(n=>quote(n)+'=s.'+quote(n)).join(',')+' FROM jsonb_populate_record(NULL::'+relation(t)+',$1::jsonb) s WHERE '+t.primaryKey.map(n=>'t.'+quote(n)+'=s.'+quote(n)).join(' AND '),[row]);assert.equal(r.rowCount,1,'UPDATE_CARDINALITY');}
  }
  for(const t of next.tables){const actual=(await c.query('SELECT to_jsonb(t)::text row FROM '+relation(t)+' t')).rows.map(r=>r.row).sort();assert.deepEqual(actual,[...t.rows].sort(),'POST_APPLY_MISMATCH:'+t.schema+'.'+t.name);}
  // Sequence state is nontransactional. No setval in a transactional delta.
  for(const seq of next.sequences||[])assert.deepEqual(seq.state,baseline.sequences.find(s=>s.schema===seq.schema&&s.name===seq.name)?.state,'SEQUENCE_DELTA_REQUIRES_REVIEW');
 }
 const evidence={format:'newhope-reviewed-business-delta-v1',status:apply?'APPLIED_ALL_125_EXACT':'REVIEWED_DRY_RUN',at:new Date().toISOString(),sourceCapturedAt:next.capturedAt,sourceFrozen:false,branch:env.NEON_BRANCH_ID,baselineSha256:baselineSha,ciphertextSha256:reviewed,tables:125,rows:next.tables.reduce((n,t)=>n+t.rows.length,0),changes:plans.map(t=>({table:t.schema+'.'+t.name,inserts:t.inserts.length,updates:t.updates.length,deletes:0})),elapsedMs:Date.now()-started,productionEligible:false,cutoverAllowed:false};
 await c.query(apply?'COMMIT':'ROLLBACK');fs.writeFileSync('build/neon/release-delta-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({status:'BLOCKED',code:String(e.message).split('\n')[0].slice(0,160),recordsOmitted:true}));process.exitCode=2;}finally{await c.end();}
