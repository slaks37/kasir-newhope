import fs from 'node:fs';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
import {privateFile,sha,quote,relation} from './backup-common.mjs';
import * as pgp from '../../build/neon-tools/node_modules/openpgp/dist/node/openpgp.mjs';
// Owner-approved full-auth archive only. Offline, memory-only PostgreSQL. Never
// connect a copied session/password database to a public auth service or app.
const file='build/neon/source-recovery-drive-readback.pgp.b64',cipher=privateFile(file);
const expected=JSON.parse(fs.readFileSync('build/neon/recovery-archive-summary.json'));
assert.equal(sha(cipher),expected.ciphertextSha256,'ESCROW_CIPHERTEXT_MISMATCH');
const key=await pgp.readPrivateKey({armoredKey:privateFile('.env.neon-backup-keys.local/private.asc').toString()});
const decode=async bytes=>JSON.parse((await pgp.decrypt({message:await pgp.readMessage({binaryMessage:Buffer.from(bytes.toString(),'base64')}),decryptionKeys:key})).data);
const s=await decode(cipher);assert.equal(s.format,'newhope-pg-recovery-v1');assert.equal(s.sourceProject,'fqxrhumsgigcgjtlbfuo');
const db=new PGlite(),receipt={status:'RUNNING',scope:'Owner-approved encrypted recovery archive from private Drive; offline memory-only auth table data/constraint restore and archive payload roundtrip; not a full Supabase service/platform-key recovery',startedAt:new Date().toISOString(),ciphertextSha256:sha(cipher),publicKeyFingerprint:key.getFingerprint(),checks:{},limitations:['No native pg_dump source connection available','Supabase GoTrue service, encryption-root/Vault keys and MFA decryptability not verified','Partitioned realtime catalog and managed extension/platform restore not executed','Private key escrow and independent operator acceptance remain unverified']};
let phase='archive-integrity';
try{
 const b=Buffer.from(cipher.toString(),'base64');b[Math.floor(b.length/2)]^=1;await assert.rejects(()=>decode(Buffer.from(b.toString('base64'))));receipt.checks.ciphertextTamperDenied=true;
 // Exercise every archived row through PostgreSQL JSONB, not just JSON parsing.
 await db.exec('CREATE SCHEMA archive_verify; CREATE TABLE archive_verify.rows(schema_name text,table_name text,payload jsonb)');
 let total=0;for(const t of s.tables){await db.query('INSERT INTO archive_verify.rows SELECT $1,$2,r FROM jsonb_array_elements($3::jsonb) r',[t.schema,t.name,'['+t.rows.join(',')+']']);const expectedRows=(await db.query('SELECT value::text row FROM jsonb_array_elements($1::jsonb)',['['+t.rows.join(',')+']'])).rows.map(r=>r.row).sort();const actual=(await db.query('SELECT payload::text row FROM archive_verify.rows WHERE schema_name=$1 AND table_name=$2',[t.schema,t.name])).rows.map(r=>r.row).sort();assert.deepEqual(actual,expectedRows);total+=actual.length;}
 receipt.checks.archivePayloadRoundtrip={tables:s.tables.length,rows:total,exactValues:true};
 phase='native-auth-schema';await db.exec('CREATE SCHEMA auth');
 for(const e of s.enums.filter(e=>e.schema==='auth'))await db.exec('CREATE TYPE '+relation(e)+' AS ENUM ('+e.labels.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')+')');
 const authTables=s.tables.filter(t=>t.schema==='auth');assert.equal(authTables.length,27);
 for(const t of authTables){const columns=t.columns.map(a=>quote(a.name)+' '+a.type+(a.generated?' GENERATED ALWAYS AS ('+a.default+') STORED':'')+(a.notNull?' NOT NULL':''));await db.exec('CREATE TABLE '+relation(t)+'('+columns.join(',')+')');}
 phase='native-auth-data';
 for(const t of authTables){const cols=t.columns.filter(c=>!c.generated).map(c=>quote(c.name));await db.query('INSERT INTO '+relation(t)+'('+cols.join(',')+') SELECT '+cols.map(c=>'r.'+c).join(',')+' FROM jsonb_populate_recordset(NULL::'+relation(t)+',$1::jsonb) r',['['+t.rows.join(',')+']']);}
 phase='native-auth-constraints';let constraints=0;
 for(const type of ['p','u','c','f'])for(const k of s.constraints.filter(c=>c.schema==='auth'&&c.type===type)){await db.exec('ALTER TABLE '+quote(k.schema)+'.'+quote(k.table)+' ADD CONSTRAINT '+quote(k.name)+' '+k.definition);constraints++;}
 phase='native-auth-reconcile';let authRows=0;
 for(const t of authTables){const expectedRows=(await db.query('SELECT to_jsonb(r)::text row FROM jsonb_populate_recordset(NULL::'+relation(t)+',$1::jsonb) r',['['+t.rows.join(',')+']'])).rows.map(r=>r.row).sort();const actual=(await db.query('SELECT to_jsonb(t)::text row FROM '+relation(t)+' t')).rows.map(r=>r.row).sort();if(JSON.stringify(actual)!==JSON.stringify(expectedRows)){const a=actual.map(JSON.parse),b=expectedRows.map(JSON.parse);const changedColumns=[...new Set(b.flatMap(row=>{const current=a.find(x=>x.id===row.id)||{};return Object.keys(row).filter(k=>JSON.stringify(current[k])!==JSON.stringify(row[k]));}))];receipt.mismatch={table:t.name,columns:changedColumns};console.log(JSON.stringify({authReconcileMismatchTable:t.name,changedColumns}));}assert.deepEqual(actual,expectedRows);authRows+=actual.length;}
 receipt.checks.nativeAuthRestore={tables:authTables.length,rows:authRows,constraints,exactAllColumnValuesAfterNativeTypeNormalization:true,timestampFormattingNormalizedByPostgresType:true,passwordSessionMfaRowsPreserved:true,networkOrOutboundMessages:0,persistentPlaintextFiles:0};
 receipt.status='PASS_WITH_EXTERNAL_RECOVERY_GATES';console.log(JSON.stringify({status:receipt.status,archiveTables:s.tables.length,archiveRows:total,authTables:authTables.length,authRows,constraints,fullSupabaseServiceRecovery:false,plaintextWritten:false}));
}catch(e){receipt.status='FAIL';receipt.failedPhase=phase;receipt.code=e.code||'ASSERTION';console.log(JSON.stringify({status:'FAIL',phase,code:receipt.code,sensitiveErrorDetailsWithheld:true}));process.exitCode=2;}
finally{await db.close();receipt.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/recovery-restore-evidence.json',JSON.stringify(receipt,null,2)+'\n');}
