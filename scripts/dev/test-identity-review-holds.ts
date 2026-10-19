import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();await db.exec('CREATE SCHEMA internal; CREATE SCHEMA newhope_auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE newhope_runtime; CREATE ROLE newhope_auth_runtime; CREATE TABLE newhope_auth."user"(id text PRIMARY KEY,"isActive" boolean); CREATE TABLE internal.auth_identity_bindings(provider text,provider_subject text,canonical_user_id uuid,is_active boolean)');
const sql=fs.readFileSync('neon/migrations/0010_identity_review_holds.sql','utf8');await db.exec(sql);await db.exec(sql);
const held=randomUUID(),canonical=randomUUID(),other=randomUUID();
await db.query('INSERT INTO newhope_auth.identity_review_holds VALUES($1,$2,$3,$4,$5,$6,now())',['fqxrhumsgigcgjtlbfuo',held,canonical,'DIFFERENT_UUID_CANONICAL_EMAIL_COLLISION','a'.repeat(64),'OWNER_AUTHORIZED_SAFE_SEPARATION']);
await db.query('INSERT INTO newhope_auth."user" VALUES($1,false)',[held]);
async function denied(query:string,params:any[]=[]){await assert.rejects(()=>db.query(query,params),(e:any)=>e.code==='42501');}
await denied('UPDATE newhope_auth."user" SET "isActive"=true WHERE id=$1',[held]);
await denied("INSERT INTO internal.auth_identity_bindings VALUES('better-auth',$1,$2,true)",[held,canonical]);
await denied('DELETE FROM newhope_auth.identity_review_holds WHERE source_subject=$1',[held]);
await db.query('INSERT INTO newhope_auth."user" VALUES($1,true)',[other]);
await db.query("INSERT INTO internal.auth_identity_bindings VALUES('better-auth',$1,$2,true)",[other,canonical]);
// Holding a conflicting source UUID must never disable/reassign the legitimate
// canonical account or let runtime write its own verification evidence.
await db.exec('SET ROLE newhope_auth_runtime');await denied("INSERT INTO newhope_auth.identity_review_resolutions VALUES('"+held+"','"+'b'.repeat(64)+"','FAKE_RUNTIME_APPROVAL','VERIFIED_EXPLICIT_MAPPING',now())");await db.exec('RESET ROLE');
await db.query('INSERT INTO newhope_auth.identity_review_resolutions VALUES($1,$2,$3,$4,now())',[held,'b'.repeat(64),'SYNTHETIC_OWNER_VERIFIED_PROOF','VERIFIED_SEPARATE_ACCOUNT']);
await db.query('UPDATE newhope_auth."user" SET "isActive"=true WHERE id=$1',[held]);
await denied('DELETE FROM newhope_auth.identity_review_resolutions WHERE source_subject=$1',[held]);
await db.close();console.log('PASS: unresolved UUIDs cannot activate or bind, canonical owner unchanged, runtime cannot approve its own proof, immutable review evidence and reviewed release path; no email-only mapping');
