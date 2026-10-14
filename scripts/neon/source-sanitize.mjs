import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,restoreTarget,sha} from './backup-common.mjs';
const {snapshot:s,ciphertextSha256}=await loadBackup();
const output='build/neon/source-2026-10-13-v3.pgp.b64';
if(fs.existsSync(output))throw Error('REFUSE_OVERWRITE_SANITIZED_CAPTURE');
const {env,manifest,...config}=restoreTarget(),c=new pg.Client(config);
const evidence={status:'RUNNING',scope:'Explicit staging-only credential redaction; no source writes',targetBranch:env.NEON_BRANCH_ID,sourceCapturedAt:s.capturedAt,oldCiphertextSha256:ciphertextSha256,table:'internal.tenant_identity_recovery',path:'snapshot.memberships[].pin',startedAt:new Date().toISOString(),supersededCapturesRequireOwnerSecureDisposal:['source-2026-10-13.pgp.b64','source-2026-10-13-v2.pgp.b64']};
const fingerprint=rows=>sha(rows.map(r=>r.row).sort().join('\n'));
await c.connect();try{
 assert(c.connection.stream.authorized&&c.connection.stream.encrypted);
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'");
 const table=s.tables.find(t=>t.schema==='internal'&&t.name==='tenant_identity_recovery');
 const expected=(await c.query('SELECT x.value::text row FROM jsonb_array_elements($1::jsonb) x(value)',['['+table.rows.join(',')+']'])).rows;
 const before=(await c.query('SELECT to_jsonb(t)::text row FROM internal.tenant_identity_recovery t')).rows;
 assert.equal(fingerprint(before),fingerprint(expected),'Unexpected identity-recovery changes; stop rather than overwrite');
 evidence.originalTableFingerprint=fingerprint(before);
 const count=(await c.query("SELECT count(*)::int n FROM internal.tenant_identity_recovery r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.snapshot->'memberships','[]'::jsonb)) member WHERE member ? 'pin'")).rows[0].n;
 assert.equal(count,2,'Only the reviewed two nested credential fields may change');
 const result=await c.query("UPDATE internal.tenant_identity_recovery r SET snapshot=jsonb_set(r.snapshot,'{memberships}',(SELECT coalesce(jsonb_agg(member - 'pin' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(r.snapshot->'memberships') WITH ORDINALITY a(member,ord))) WHERE jsonb_path_exists(r.snapshot,'$.memberships[*].pin')");
 const after=(await c.query('SELECT to_jsonb(t)::text row FROM internal.tenant_identity_recovery t')).rows;
 const projected=(await c.query("SELECT jsonb_set(x.value,'{snapshot,memberships}',(SELECT coalesce(jsonb_agg(member - 'pin' ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(x.value #> '{snapshot,memberships}') WITH ORDINALITY a(member,ord)))::text row FROM jsonb_array_elements($1::jsonb) x(value)",['['+table.rows.join(',')+']'])).rows;
 assert.equal(fingerprint(after),fingerprint(projected),'Only reviewed nested credential fields changed');
 const residual=(await c.query("SELECT count(*)::int n FROM internal.tenant_identity_recovery WHERE jsonb_path_exists(snapshot,'$.memberships[*].pin')")).rows[0].n;assert.equal(residual,0);
 table.rows=after.map(r=>r.row);
 s.redactedNestedPaths=[{table:evidence.table,path:evidence.path,fields:2}];
 s.dataPolicy+='; historical identity recovery nested PIN fields redacted explicitly';
 // Key-name scan is private and never prints values. All snapshot business rows
 // must now contain zero credential keys at any depth.
 let sensitiveKeys=0;function scan(v){if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(/^(?:pin|password|password_hash|pin_hash|token|token_hash|secret|api_key|access_token|refresh_token)$/i.test(k))sensitiveKeys++;scan(x);}}
 for(const t of s.tables)for(const r of t.rows)scan(JSON.parse(r));assert.equal(sensitiveKeys,0,'Residual sensitive key in scoped capture');
 const openpgp=await import('../../build/neon-tools/node_modules/openpgp/dist/node/openpgp.mjs');
 const publicKey=await openpgp.readKey({armoredKey:fs.readFileSync('.env.neon-backup-keys.local/public.asc','utf8')});
 const encrypted=await openpgp.encrypt({message:await openpgp.createMessage({text:JSON.stringify(s)}),encryptionKeys:publicKey,format:'binary',config:{preferredSymmetricAlgorithm:openpgp.enums.symmetric.aes256}});
 fs.writeFileSync(output,Buffer.from(encrypted).toString('base64')+'\n',{mode:0o600});
 evidence.sanitizedCiphertextSha256=sha(fs.readFileSync(output));evidence.sanitizedTableFingerprint=fingerprint(after);evidence.rowsChanged=result.rowCount;evidence.fieldsRedacted=count;evidence.residualSensitiveKeys=0;
 await c.query('COMMIT');evidence.status='PASS';console.log(JSON.stringify({status:'PASS',rowsChanged:result.rowCount,fieldsRedacted:count,residualSensitiveKeys:0,sanitizedCiphertextSha256:evidence.sanitizedCiphertextSha256}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.failure=e.message;throw Error(e.message);}finally{await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/source-credential-redaction-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
