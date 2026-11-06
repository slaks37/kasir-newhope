import {createHash,randomUUID} from 'node:crypto';
import type {Db} from './db';

export type AuthIdentity={provider:'better-auth';issuer:string;subject:string;email:string;isEmailVerified:boolean};
type ReadDb=Pick<Db,'query'>;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest=/^[a-f0-9]{64}$/;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=(code:string):never=>{throw Error(code);};
function issuer(value:string){
 let u:URL;try{u=new URL(value);}catch{return fail('AUTH_IDENTITY_ISSUER_INVALID');}
 if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)fail('AUTH_IDENTITY_ISSUER_INVALID');return value;
}
function subject(value:string){if(typeof value!=='string'||value.length<1||value.length>255||value!==value.trim()||/[\u0000-\u001f\u007f]/.test(value))fail('AUTH_IDENTITY_SUBJECT_INVALID');return value;}
function reference(value:string){if(typeof value!=='string'||value.length<12||value.length>200||/[\u0000-\u001f\u007f]/.test(value))fail('AUTH_IDENTITY_REVIEW_REQUIRED');return value;}
function verified(input:AuthIdentity){
 if(input.provider!=='better-auth'||input.isEmailVerified!==true||typeof input.email!=='string'||input.email.length>320||!/^\S+@\S+\.\S+$/.test(input.email))return false;
 try{issuer(input.issuer);subject(input.subject);return true;}catch{return false;}
}
/** Provider session verification precedes this lookup. Email and sector never
 * select an existing user; only the reviewed issuer+subject binding does. */
export async function resolveAuthIdentity(db:ReadDb,input:AuthIdentity):Promise<string|null>{
 if(!verified(input))return null;
 const rows=(await db.query<{canonical_user_id:string}>(`SELECT b.canonical_user_id FROM internal.auth_identity_bindings b
  JOIN internal.users u ON u.id=b.canonical_user_id AND u.is_active
  WHERE b.provider=$1 AND b.issuer=$2 AND b.provider_subject=$3 AND b.is_active`,[input.provider,input.issuer,input.subject])).rows;
 return rows.length===1?rows[0].canonical_user_id:null;
}
export async function reverseAuthIdentity(db:ReadDb,input:{provider:'better-auth';issuer:string;canonicalSubject:string}):Promise<string|null>{
 if(input.provider!=='better-auth'||!uuid.test(input.canonicalSubject))return null;
 try{issuer(input.issuer);}catch{return null;}
 const rows=(await db.query<{provider_subject:string}>(`SELECT b.provider_subject FROM internal.auth_identity_bindings b
  JOIN internal.users u ON u.id=b.canonical_user_id AND u.is_active
  WHERE b.provider=$1 AND b.issuer=$2 AND b.canonical_user_id=$3 AND b.is_active`,[input.provider,input.issuer,input.canonicalSubject])).rows;
 return rows.length===1?rows[0].provider_subject:null;
}
export const resolveProviderIdentity=reverseAuthIdentity;

/** Maintenance-only enrollment. The caller must independently verify a live
 * new-signup intent; this is not an HTTP endpoint or an email-linking fallback.
 * The runtime instead uses a narrow RPC with live auth-record/intent checks. */
export async function enrollNewAuthIdentity(db:Db,input:AuthIdentity&{name:string;newSignupReference:string}):Promise<string>{
 if(!verified(input))fail('AUTH_IDENTITY_VERIFIED_CREDENTIAL_REQUIRED');reference(input.newSignupReference);
 return db.tx(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['auth-identity-email:'+input.email.toLowerCase()]);
  const known=await resolveAuthIdentity(c,input);if(known)return known;
  if((await c.query('SELECT 1 FROM internal.auth_identity_bindings WHERE provider=$1 AND issuer=$2 AND provider_subject=$3',[input.provider,input.issuer,input.subject])).rows.length)fail('AUTH_IDENTITY_REVIEW_REQUIRED');
  if((await c.query('SELECT 1 FROM internal.users WHERE lower(email)=lower($1)',[input.email])).rows.length)fail('AUTH_IDENTITY_EXISTING_ACCOUNT_REVIEW_REQUIRED');
  const canonical=randomUUID(),enrollmentDigest=hash(JSON.stringify([input.provider,input.issuer,input.subject,canonical,input.newSignupReference]));
  await c.query('INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,$3,true)',[canonical,input.email.toLowerCase(),String(input.name||'New Hope user').slice(0,150)]);
  await c.query(`INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref,manifest_digest)
   VALUES($1,$2,$3,$4,$5,$6)`,[input.provider,input.issuer,input.subject,canonical,input.newSignupReference,enrollmentDigest]);
  await c.query(`INSERT INTO internal.auth_identity_enrollment_events(canonical_user_id,provider,issuer,provider_subject,verification_ref)
   VALUES($1,$2,$3,$4,$5)`,[canonical,input.provider,input.issuer,input.subject,input.newSignupReference]);
  return canonical;
 });
}

export type IdentityMigrationManifest={version:1;provider:'better-auth';issuer:string;sourceSnapshotDigest:string;reviewerRef:string;freezeRef:string;
 mappings:Array<{providerSubject:string;canonicalSubject:string;evidenceRef:string}>};
export type IdentityMigrationPlan={version:1;manifestDigest:string;businessDigest:string;targetDigest:string;mappingCount:number};
function normalizeManifest(value:IdentityMigrationManifest):IdentityMigrationManifest{
 if(!value||Object.keys(value).sort().join(',')!=='freezeRef,issuer,mappings,provider,reviewerRef,sourceSnapshotDigest,version'||value.version!==1||value.provider!=='better-auth'||!digest.test(value.sourceSnapshotDigest))fail('AUTH_IDENTITY_MANIFEST_INVALID');
 issuer(value.issuer);reference(value.reviewerRef);reference(value.freezeRef);
 if(!Array.isArray(value.mappings)||value.mappings.length<1||value.mappings.length>10000)fail('AUTH_IDENTITY_MANIFEST_SIZE_INVALID');
 const subjects=new Set<string>(),canonical=new Set<string>();
 const mappings=value.mappings.map(row=>{
  if(!row||Object.keys(row).sort().join(',')!=='canonicalSubject,evidenceRef,providerSubject'||!uuid.test(row.canonicalSubject))fail('AUTH_IDENTITY_MAPPING_INVALID');
  subject(row.providerSubject);reference(row.evidenceRef);const id=row.canonicalSubject.toLowerCase();
  if(subjects.has(row.providerSubject)||canonical.has(id))fail('AUTH_IDENTITY_MAPPING_COLLISION');subjects.add(row.providerSubject);canonical.add(id);
  return {providerSubject:row.providerSubject,canonicalSubject:id,evidenceRef:row.evidenceRef};
 }).sort((a,b)=>a.providerSubject.localeCompare(b.providerSubject));
 return {version:1,provider:value.provider,issuer:value.issuer,sourceSnapshotDigest:value.sourceSnapshotDigest,reviewerRef:value.reviewerRef,freezeRef:value.freezeRef,mappings};
}
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const excluded=new Set(['auth_identity_bindings','auth_identity_migration_batches','auth_identity_migration_revocations','auth_identity_enrollment_events']);
const required=['internal.users','internal.tenants','internal.memberships','internal.merchants','internal.outlets','internal.merchant_modules','internal.outlet_modules','billing.module_entitlements','pos.transactions','pos.cash_ledger','pos.inventory_transactions','pos.sync_receipts','pos.shifts'];
async function businessTables(db:ReadDb){
 const rows=(await db.query<{schema_name:string;table_name:string}>(`SELECT n.nspname AS schema_name,c.relname AS table_name FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p') AND n.nspname IN('internal','pos','billing','ai','public','mcp_private','blog_mcp_private') ORDER BY n.nspname,c.relname`)).rows
  .filter(row=>!(row.schema_name==='internal'&&excluded.has(row.table_name))&&row.table_name!=='schema_migrations');
 const names=new Set(rows.map(row=>row.schema_name+'.'+row.table_name));for(const name of required)if(!names.has(name))fail('AUTH_IDENTITY_BASELINE_TABLE_MISSING:'+name);
 return rows;
}
/** Hash every column of every application row, including future membership and
 * ledger actor fields. Only per-row SHA256 digests leave the database. Bounded
 * rehearsal refuses oversized snapshots instead of silently sampling them. */
export async function authIdentityBusinessFingerprint(db:ReadDb):Promise<string>{
 const result:Array<{table:string;rows:string[]}>=[];let total=0;
 for(const table of await businessTables(db)){
  const name=quote(table.schema_name)+'.'+quote(table.table_name);
  const rows=(await db.query<{row_digest:string}>(`SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_digest FROM ${name} t ORDER BY row_digest LIMIT 20001`)).rows;
  total+=rows.length;if(rows.length>20000||total>100000)fail('AUTH_IDENTITY_SNAPSHOT_TOO_LARGE');
  result.push({table:table.schema_name+'.'+table.table_name,rows:rows.map(row=>row.row_digest)});
 }
 return hash(JSON.stringify(result));
}
async function targetFingerprint(db:ReadDb,manifest:IdentityMigrationManifest){
 const result=[];
 for(const row of manifest.mappings){
  const user=(await db.query('SELECT id,is_active FROM internal.users WHERE id=$1',[row.canonicalSubject])).rows;
  if(user.length!==1||!user[0].is_active)fail('AUTH_IDENTITY_CANONICAL_USER_REQUIRED');
  const bindings=(await db.query(`SELECT provider_subject,canonical_user_id,is_active,verification_ref,manifest_digest FROM internal.auth_identity_bindings
   WHERE provider=$1 AND issuer=$2 AND (provider_subject=$3 OR canonical_user_id=$4) ORDER BY provider_subject`,[manifest.provider,manifest.issuer,row.providerSubject,row.canonicalSubject])).rows;
  if(bindings.length)fail('AUTH_IDENTITY_EXISTING_BINDING_REVIEW_REQUIRED');result.push({user:user[0],providerSubject:row.providerSubject});
 }
 return hash(JSON.stringify(result));
}
export async function planAuthIdentityMigration(db:Db,input:IdentityMigrationManifest):Promise<IdentityMigrationPlan>{
 const manifest=normalizeManifest(input);return {version:1,manifestDigest:hash(JSON.stringify(manifest)),businessDigest:await authIdentityBusinessFingerprint(db),targetDigest:await targetFingerprint(db,manifest),mappingCount:manifest.mappings.length};
}
export async function applyAuthIdentityMigration(db:Db,input:IdentityMigrationManifest,reviewed:IdentityMigrationPlan){
 const manifest=normalizeManifest(input),manifestDigest=hash(JSON.stringify(manifest));
 if(!reviewed||reviewed.version!==1||reviewed.manifestDigest!==manifestDigest)fail('AUTH_IDENTITY_PLAN_MISMATCH');
 return db.tx(async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('newhope-reviewed-auth-identity-migration',0))");
  if((await c.query('SELECT 1 FROM internal.auth_identity_migration_revocations WHERE manifest_digest=$1',[manifestDigest])).rows.length)fail('AUTH_IDENTITY_REVOKED_BATCH');
  const prior=(await c.query('SELECT * FROM internal.auth_identity_migration_batches WHERE manifest_digest=$1',[manifestDigest])).rows[0];
  if(prior){
   const bindings=(await c.query('SELECT provider_subject,canonical_user_id,is_active FROM internal.auth_identity_bindings WHERE provider=$1 AND issuer=$2 AND manifest_digest=$3 ORDER BY provider_subject',[manifest.provider,manifest.issuer,manifestDigest])).rows;
   const expected=manifest.mappings.map(row=>({provider_subject:row.providerSubject,canonical_user_id:row.canonicalSubject,is_active:true}));
   if(JSON.stringify(bindings)!==JSON.stringify(expected))fail('AUTH_IDENTITY_BATCH_STATE_DRIFT');return {status:'UNCHANGED' as const,manifestDigest};
  }
  // Do not race operational writers. This owner-only maintenance operation is
  // for an explicitly frozen staging/cutover window; NOWAIT refuses active use.
  for(const table of await businessTables(c))await c.exec('LOCK TABLE '+quote(table.schema_name)+'.'+quote(table.table_name)+' IN SHARE MODE NOWAIT');
  const current=await planAuthIdentityMigration(c,manifest);if(JSON.stringify(current)!==JSON.stringify(reviewed))fail('AUTH_IDENTITY_REVIEW_TARGET_CHANGED');
  await c.query(`INSERT INTO internal.auth_identity_migration_batches(manifest_digest,provider,issuer,source_snapshot_digest,reviewer_ref,freeze_ref,business_digest,target_digest,mapping_count)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[manifestDigest,manifest.provider,manifest.issuer,manifest.sourceSnapshotDigest,manifest.reviewerRef,manifest.freezeRef,reviewed.businessDigest,reviewed.targetDigest,manifest.mappings.length]);
  for(const row of manifest.mappings)await c.query(`INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,verification_ref,manifest_digest)
   VALUES($1,$2,$3,$4,$5,$6)`,[manifest.provider,manifest.issuer,row.providerSubject,row.canonicalSubject,row.evidenceRef,manifestDigest]);
  if(await authIdentityBusinessFingerprint(c)!==reviewed.businessDigest)fail('AUTH_IDENTITY_BUSINESS_ROWS_CHANGED');
  return {status:'APPLIED' as const,manifestDigest};
 });
}
/** Disable the imported login mappings; keep canonical IDs and audit rows.
 * Provider-session revocation is a separate mandatory provider operation. */
export async function revokeAuthIdentityMigration(db:Db,manifestDigest:string,reviewerRef:string,reason:string){
 if(!digest.test(manifestDigest))fail('AUTH_IDENTITY_MANIFEST_INVALID');reference(reviewerRef);if(typeof reason!=='string'||reason.trim().length<12||reason.length>500)fail('AUTH_IDENTITY_REVOCATION_REASON_REQUIRED');
 return db.tx(async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('newhope-reviewed-auth-identity-migration',0))");
  if(!(await c.query('SELECT 1 FROM internal.auth_identity_migration_batches WHERE manifest_digest=$1',[manifestDigest])).rows.length)fail('AUTH_IDENTITY_BATCH_UNKNOWN');
  if((await c.query('SELECT 1 FROM internal.auth_identity_migration_revocations WHERE manifest_digest=$1',[manifestDigest])).rows.length)return {status:'UNCHANGED' as const};
  await c.query('UPDATE internal.auth_identity_bindings SET is_active=false WHERE manifest_digest=$1',[manifestDigest]);
  await c.query('INSERT INTO internal.auth_identity_migration_revocations(manifest_digest,reviewer_ref,reason) VALUES($1,$2,$3)',[manifestDigest,reviewerRef,reason.trim()]);return {status:'REVOKED' as const};
 });
}
