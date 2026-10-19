import {createHash,randomUUID} from 'node:crypto';

export const identitySourceProject='fqxrhumsgigcgjtlbfuo';
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=code=>{throw Error(code);};
const exactKeys=(value,keys)=>Object.keys(value).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(value,k));
export function validateIdentityManifest(input) {
  const keys=['version','sourceProject','backupRef','reviewerRef','users',...(Object.hasOwn(input||{},'canonicalCreateIds')?['canonicalCreateIds']:[])];
  if(!input||!exactKeys(input,keys)||input.version!==1||input.sourceProject!==identitySourceProject)fail('IDENTITY_MANIFEST_INVALID');
  for(const ref of [input.backupRef,input.reviewerRef])if(typeof ref!=='string'||ref.length<8||ref.length>200||/[\r\n]/.test(ref))fail('IDENTITY_REVIEW_REFERENCE_REQUIRED');
  if(!Array.isArray(input.users)||!input.users.length||input.users.length>100000)fail('IDENTITY_MANIFEST_SIZE_INVALID');
  const ids=new Set(),emails=new Set();
  const users=input.users.map(u=>{
    // Explicit allowlist rejects passwords, password hashes, tokens, metadata,
    // caller roles and MFA secrets rather than silently retaining them.
    if(!u||!exactKeys(u,['id','email','emailVerified','isActive','name'])||typeof u.id!=='string'||!uuid.test(u.id)||typeof u.email!=='string'||u.email!==u.email.trim()||!/^\S+@\S+\.\S+$/.test(u.email)||u.email.length>160||typeof u.emailVerified!=='boolean'||typeof u.isActive!=='boolean'||typeof u.name!=='string'||u.name.length>200||/[\u0000-\u001f]/.test(u.name))fail('IDENTITY_ROW_INVALID');
    const user={...u,id:u.id.toLowerCase(),email:u.email.toLowerCase()};
    if(ids.has(user.id)||emails.has(user.email))fail('IDENTITY_SOURCE_COLLISION');
    ids.add(user.id);emails.add(user.email);return user;
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const canonicalCreateIds=input.canonicalCreateIds;
  if(canonicalCreateIds!==undefined&&(!Array.isArray(canonicalCreateIds)||new Set(canonicalCreateIds).size!==canonicalCreateIds.length||canonicalCreateIds.some(id=>typeof id!=='string'||!uuid.test(id)||!ids.has(id.toLowerCase()))))fail('IDENTITY_CANONICAL_CREATE_REVIEW_INVALID');
  const manifest={...input,users,...(canonicalCreateIds?{canonicalCreateIds:canonicalCreateIds.map(id=>id.toLowerCase()).sort()}: {})};return {manifest,sourceDigest:digest(manifest)};
}

async function businessDigest(c,ids,excludeProfileIds=[]) {
  // Credential and identity-binding tables are deliberately excluded. Every
  // restored business row touched by the owner remains byte-for-byte stable.
  const r=await c.query(`WITH tenant_ids AS (
      SELECT tenant_id AS id FROM internal.memberships WHERE user_id=ANY($1::uuid[])
      UNION SELECT id FROM internal.tenants WHERE owner_user_id=ANY($1::uuid[]) OR owner_user_ref=ANY($1::uuid[]::text[])
    ) SELECT jsonb_build_object(
      'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM internal.users u WHERE id=ANY($1::uuid[]) AND NOT id=ANY($2::uuid[])),
      'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM internal.memberships m WHERE user_id=ANY($1::uuid[])),
      'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM internal.tenants t WHERE id IN(SELECT id FROM tenant_ids)),
      'pos_tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM pos.tenants t WHERE id IN(SELECT id FROM tenant_ids)),
      'merchants',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM internal.merchants m WHERE tenant_id IN(SELECT id FROM tenant_ids)),
      'outlets',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM internal.outlets o WHERE tenant_id IN(SELECT id FROM tenant_ids)),
      'subscriptions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM billing.subscriptions s WHERE tenant_id IN(SELECT id FROM tenant_ids)),
      'wallets',(SELECT jsonb_agg(to_jsonb(w) ORDER BY merchant_id) FROM ai.merchant_ai_credits w WHERE tenant_id IN(SELECT id FROM tenant_ids))
    ) AS data`,[ids,excludeProfileIds]);
  return digest(r.rows[0].data);
}

async function inspect(c,manifest,issuer) {
  const snapshot=[];
  for(const u of manifest.users) {
    const canonical=(await c.query('SELECT id,email,is_active FROM internal.users WHERE id=$1',[u.id])).rows[0];
    const create=(manifest.canonicalCreateIds||[]).includes(u.id);
    if(!canonical) {
      if(!create||!u.emailVerified||!u.isActive)fail('IDENTITY_CANONICAL_RESTORE_MISMATCH');
      if((await c.query('SELECT 1 FROM internal.users WHERE lower(email)=$1',[u.email])).rowCount)fail('IDENTITY_CANONICAL_EMAIL_COLLISION');
      // UUID evidence originates in the restored source; an email comparison
      // alone can never authorize creation or linking to existing business.
      const legacyTable=(await c.query("SELECT to_regclass('public.users') AS table")).rows[0].table;
      const legacyQuery=legacyTable?"(SELECT jsonb_agg(to_jsonb(u)->>'id' ORDER BY to_jsonb(u)->>'id') FROM public.users u WHERE to_jsonb(u)->>'id'=$1 OR to_jsonb(u)->>'external_ref'=$1)":"NULL";
      const evidence=(await c.query(`SELECT jsonb_build_object(
        'ownerRefs',(SELECT jsonb_agg(id::text ORDER BY id) FROM internal.tenants WHERE owner_user_ref=$1 OR owner_user_id::text=$1),
        'posRefs',(SELECT jsonb_agg(id::text ORDER BY id) FROM pos.users WHERE id::text=$1 OR external_ref=$1),
        'legacyRefs',${legacyQuery}
      ) AS evidence`,[u.id])).rows[0].evidence;
      if(!Object.values(evidence).some(values=>Array.isArray(values)&&values.length))fail('IDENTITY_CANONICAL_UUID_EVIDENCE_MISSING');
      snapshot.push({id:u.id,operation:'CREATE_CANONICAL_FROM_SOURCE_AUTH',evidenceDigest:digest(evidence)});
    }else {
      if(create)fail('IDENTITY_CANONICAL_CREATE_ALREADY_EXISTS');
      if(canonical.email.toLowerCase()!==u.email||canonical.is_active!==u.isActive)fail('IDENTITY_CANONICAL_RESTORE_MISMATCH');
      snapshot.push(canonical);
    }
    const existing=(await c.query('SELECT id,email,"emailVerified","isActive" FROM newhope_auth."user" WHERE id=$1 OR lower(email)=$2',[u.id,u.email])).rows;
    // Even a same-UUID native account is not adopted without batch ownership.
    if(existing.length)fail('IDENTITY_TARGET_ACCOUNT_COLLISION');
    const bindings=(await c.query(`SELECT provider,issuer,provider_subject,canonical_user_id,is_active FROM internal.auth_identity_bindings
      WHERE (provider='better-auth' AND issuer=$1 AND (provider_subject=$2 OR canonical_user_id=$3))`,[issuer,u.id,u.id])).rows;
    if(bindings.length)fail('IDENTITY_TARGET_BINDING_COLLISION');
  }
  return digest(snapshot);
}

function validIssuer(issuer) {
  const u=new URL(issuer);
  if(u.origin!==issuer||u.username||u.password||(u.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u.hostname)))fail('IDENTITY_ISSUER_INVALID');
}
export async function planIdentityImport(c,input,issuer) {
  validIssuer(issuer);
  const {manifest,sourceDigest}=validateIdentityManifest(input);
  const prior=(await c.query('SELECT id FROM newhope_auth.identity_import_batches WHERE source_digest=$1',[sourceDigest])).rows[0];
  if(prior)fail('IDENTITY_BATCH_ALREADY_EXISTS');
  const targetDigest=await inspect(c,manifest,issuer);
  const business=await businessDigest(c,manifest.users.map(u=>u.id),manifest.canonicalCreateIds||[]);
  return {version:1,sourceProject:identitySourceProject,sourceDigest,issuer,rowCount:manifest.users.length,targetDigest,businessDigest:business,backupRef:manifest.backupRef,reviewerRef:manifest.reviewerRef,canonicalCreates:manifest.canonicalCreateIds||[],strategy:'PRESERVE_UUID_REQUIRE_NATIVE_PASSWORD_RESET_NO_EMAIL_LINK'};
}
export async function applyIdentityImport(c,input,review) {
  const {manifest,sourceDigest}=validateIdentityManifest(input);
  if(review?.sourceDigest!==sourceDigest||review.issuer===undefined)fail('IDENTITY_REVIEW_DIGEST_MISMATCH');
  validIssuer(review.issuer);
  await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('newhope-identity-import',0))");
    const prior=(await c.query(`SELECT b.id,EXISTS(SELECT 1 FROM newhope_auth.identity_import_revocations r WHERE r.batch_id=b.id) AS revoked
      FROM newhope_auth.identity_import_batches b WHERE b.source_digest=$1`,[sourceDigest])).rows[0];
    if(prior) {
      if(prior.revoked)fail('IDENTITY_REVOKED_BATCH_REAPPLY_DENIED');
      const count=(await c.query(`SELECT count(*)::integer AS count FROM newhope_auth.identity_import_items i
        JOIN internal.auth_identity_bindings b ON b.canonical_user_id=i.canonical_user_id AND b.provider_subject=i.provider_subject
          AND b.provider='better-auth' AND b.issuer=$2 AND b.is_active=i.source_active
        JOIN newhope_auth."user" u ON u.id=i.provider_subject AND u."isActive"=i.source_active
        WHERE i.batch_id=$1`,[prior.id,review.issuer])).rows[0].count;
      if(count!==manifest.users.length)fail('IDENTITY_BATCH_STATE_DRIFT');
      await c.query('COMMIT');return {status:'UNCHANGED',batchId:prior.id,rowCount:count,sourceDigest};
    }
    const planned=await planIdentityImport(c,manifest,review.issuer);
    if(JSON.stringify(planned)!==JSON.stringify(review))fail('IDENTITY_REVIEW_TARGET_CHANGED');
    const batchId=randomUUID();
    await c.query(`INSERT INTO newhope_auth.identity_import_batches(id,source_project,source_digest,source_backup_ref,reviewer_ref,issuer,row_count,business_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[batchId,identitySourceProject,sourceDigest,manifest.backupRef,manifest.reviewerRef,review.issuer,manifest.users.length,planned.businessDigest]);
    for(const u of manifest.users) {
      if((manifest.canonicalCreateIds||[]).includes(u.id)) {
        await c.query(`INSERT INTO internal.users(id,email,full_name,is_active) VALUES($1,$2,$3,true)`,[u.id,u.email,(u.name||'Pemilik Toko').slice(0,150)]);
        await c.query(`INSERT INTO newhope_auth.identity_import_canonical_creates(batch_id,canonical_user_id,reviewed_target_digest)
          VALUES($1,$2,$3)`,[batchId,u.id,planned.targetDigest]);
      }
      await c.query(`INSERT INTO newhope_auth."user"(id,name,email,"emailVerified","twoFactorEnabled","isActive") VALUES($1,$2,$3,$4,false,$5)`,[u.id,u.name||'Pemilik Toko',u.email,u.emailVerified,u.isActive]);
      await c.query(`INSERT INTO internal.auth_identity_bindings(provider,issuer,provider_subject,canonical_user_id,is_active,verification_ref)
        VALUES('better-auth',$1,$2::text,$2::text::uuid,$3,$4)`,[review.issuer,u.id,u.isActive,'REVIEWED_SOURCE_BACKUP:'+batchId]);
      await c.query(`INSERT INTO newhope_auth.identity_import_items(batch_id,canonical_user_id,provider_subject,email_digest,source_email_verified,source_active)
        VALUES($1,$2::uuid,$2::uuid::text,$3,$4,$5)`,[batchId,u.id,digest(u.email),u.emailVerified,u.isActive]);
    }
    if(await businessDigest(c,manifest.users.map(u=>u.id),manifest.canonicalCreateIds||[])!==planned.businessDigest)fail('IDENTITY_BUSINESS_CHANGED');
    await c.query('COMMIT');return {status:'APPLIED',batchId,rowCount:manifest.users.length,sourceDigest,businessDigest:planned.businessDigest,credentialsImported:false,sessionsImported:false,mfaSecretsImported:false};
  }catch(e){await c.query('ROLLBACK');throw e;}
}

export async function revokeIdentityImport(c,batchId,reviewerRef,reason) {
  if(!uuid.test(batchId)||!reviewerRef||reviewerRef.length<8||!reason||reason.length<8)fail('IDENTITY_REVOCATION_REVIEW_REQUIRED');
  await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('newhope-identity-import',0))");
    const batch=(await c.query('SELECT issuer FROM newhope_auth.identity_import_batches WHERE id=$1 FOR UPDATE',[batchId])).rows[0];
    if(!batch)fail('IDENTITY_BATCH_UNKNOWN');
    const prior=(await c.query('SELECT 1 FROM newhope_auth.identity_import_revocations WHERE batch_id=$1',[batchId])).rowCount;
    if(prior){await c.query('COMMIT');return {status:'UNCHANGED',batchId};}
    const ids=(await c.query('SELECT provider_subject FROM newhope_auth.identity_import_items WHERE batch_id=$1',[batchId])).rows.map(r=>r.provider_subject);
    const createdIds=(await c.query('SELECT canonical_user_id FROM newhope_auth.identity_import_canonical_creates WHERE batch_id=$1',[batchId])).rows.map(r=>r.canonical_user_id);
    const before=await businessDigest(c,ids,createdIds);
    await c.query('UPDATE newhope_auth."user" SET "isActive"=false,"updatedAt"=now() WHERE id=ANY($1::text[])',[ids]);
    await c.query("UPDATE internal.auth_identity_bindings SET is_active=false WHERE provider='better-auth' AND issuer=$1 AND provider_subject=ANY($2::text[])",[batch.issuer,ids]);
    await c.query('DELETE FROM newhope_auth.session WHERE "userId"=ANY($1::text[])',[ids]);
    // Outstanding reset/verification links must not reactivate a revoked import.
    await c.query('DELETE FROM newhope_auth.verification WHERE value=ANY($1::text[])',[ids]);
    await c.query('INSERT INTO newhope_auth.identity_import_revocations(batch_id,reviewer_ref,reason) VALUES($1,$2,$3)',[batchId,reviewerRef,reason]);
    if(await businessDigest(c,ids,createdIds)!==before)fail('IDENTITY_BUSINESS_CHANGED');
    await c.query('COMMIT');return {status:'REVOKED',batchId,rowCount:ids.length,businessDigest:before};
  }catch(e){await c.query('ROLLBACK');throw e;}
}
