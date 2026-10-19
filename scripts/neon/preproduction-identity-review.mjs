import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,privateFile} from './backup-common.mjs';
import {parse} from 'dotenv';
// Read-only owner report. Never import, activate, link by email, or print personal data.
const {snapshot:s,ciphertextSha256}=await loadBackup('build/neon/source-2026-10-15-fresh.pgp.b64');
const rows=(schema,name)=>(s.tables.find(t=>t.schema===schema&&t.name===name)?.rows||[]).map(JSON.parse);
const canonical=rows('internal','users'),tenants=rows('internal','tenants'),members=rows('internal','memberships'),merchants=rows('internal','merchants'),outlets=rows('internal','outlets');
const exceptions=[];
for(const a of s.authMetadata){
 const email=a.email?.trim().toLowerCase(),existing=canonical.find(u=>u.id===a.id),collision=canonical.find(u=>u.id!==a.id&&u.email?.trim().toLowerCase()===email);
 const direct=tenants.filter(t=>t.owner_user_ref===a.id||t.owner_user_id===a.id);
 const pos=rows('pos','users').filter(u=>u.id===a.id||u.external_ref===a.id),legacy=rows('public','users').filter(u=>u.id===a.id||u.external_ref===a.id);
 const reason=collision?'DIFFERENT_UUID_CANONICAL_EMAIL_COLLISION':!existing&&!direct.length&&!pos.length&&!legacy.length?'CANONICAL_UUID_EVIDENCE_MISSING':null;
 if(!reason)continue;
 const ids=[a.id,...(collision?[collision.id]:[])];
 const relatedTenants=tenants.filter(t=>ids.includes(t.owner_user_id)||ids.includes(t.owner_user_ref)||members.some(m=>ids.includes(m.user_id)&&m.tenant_id===t.id));
 const tenantIds=relatedTenants.map(t=>t.id);
 exceptions.push({sourceUuid:a.id,sourceEmail:a.email,destinationUuid:existing?.id||null,conflictingDestinationUuid:collision?.id||null,reason,
 evidence:{sourceProject:s.sourceProject,capturedAt:s.capturedAt,ciphertextSha256,sourceEmailConfirmedAt:a.email_confirmed_at,sourceCreatedAt:a.created_at,canonicalUuidMatch:!!existing,emailCollisionIsOwnershipProof:false,verifiedHumanOwnership:false},
 canonicalProfiles:canonical.filter(u=>ids.includes(u.id)).map(u=>({id:u.id,email:u.email,isActive:u.is_active,isPlatformUser:u.is_platform_user})),
 tenants:relatedTenants.map(t=>({id:t.id,ownerUserId:t.owner_user_id,ownerUserRef:t.owner_user_ref,isActive:t.is_active,mergedInto:t.merged_into})),
 memberships:members.filter(m=>ids.includes(m.user_id)).map(m=>({userId:m.user_id,tenantId:m.tenant_id,merchantId:m.merchant_id,outletId:m.outlet_id,role:m.role,scopeType:m.scope_type,isActive:m.is_active})),
 merchants:merchants.filter(m=>tenantIds.includes(m.tenant_id)).map(m=>({id:m.id,tenantId:m.tenant_id,externalRef:m.external_ref,isActive:m.is_active})),
 outlets:outlets.filter(o=>tenantIds.includes(o.tenant_id)).map(o=>({id:o.id,tenantId:o.tenant_id,merchantId:o.merchant_id,isActive:o.is_active})),
 sourcePosUuids:pos.map(u=>u.id),sourceLegacyUuids:legacy.map(u=>u.id),
 recommendation:collision?'HOLD both UUIDs separately. Owner must establish whether these represent the same person using authenticated source session and recorded tenant authority. If distinct, preserve separate profiles; if same, approve a reviewed explicit source-to-canonical mapping and impact manifest. No automatic merge or email-only link.':'HOLD without activation. Ask owner for authenticated source UUID plus authoritative tenant/merchant membership or a signed confirmation that this is a standalone account with no business authority. Only then review an explicit same-source-UUID canonical create.',
 requiredOwnerDecision:collision?'Provide verified ownership evidence for both UUIDs and tenant relationships; approve exact mapping and affected permissions or confirm distinct accounts.':'Confirm account owner and authorized tenant/merchant scope, or explicitly confirm no business ownership; approve same-UUID canonical provisioning if justified.',ownerApproval:'NOT_RECEIVED'});
}
if(exceptions.length!==3)throw Error('IDENTITY_EXCEPTION_COUNT_CHANGED_REVIEW_REQUIRED');
const env=parse(privateFile('.env.neon-data-restore.local')),url=new URL(env.NEON_RESTORE_DATABASE_URL);
if(env.NEON_BRANCH_ID!=='br-curly-truth-aze21ktf'||url.hostname.replace('-pooler','')!=='ep-plain-dream-azghoyf7.c-3.ap-southeast-1.aws.neon.tech'||url.pathname!=='/neondb')throw Error('REPORT_TARGET_MISMATCH');
url.hostname=url.hostname.replace('-pooler','');url.search='';
const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000});
await c.connect();try{
 if(!c.connection.stream.authorized||!c.connection.stream.encrypted)throw Error('TLS_REQUIRED');
 await c.query('BEGIN READ ONLY');
 for(const e of exceptions){const ids=[e.sourceUuid,e.conflictingDestinationUuid].filter(Boolean);
 e.destinationObservedAt=new Date().toISOString();
 e.stagingCanonicalProfiles=(await c.query('SELECT id,email,is_active,is_platform_user FROM internal.users WHERE id=ANY($1::uuid[])',[ids])).rows;
 e.stagingBindings=(await c.query('SELECT provider,issuer,provider_subject,canonical_user_id,is_active,verification_ref FROM internal.auth_identity_bindings WHERE canonical_user_id=ANY($1::uuid[]) OR provider_subject=ANY($2::text[])',[ids,ids])).rows;
 }
}finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
const report={classification:'PRIVATE OWNER REVIEW - NEVER COMMIT',createdAt:new Date().toISOString(),sourceCaptureAt:s.capturedAt,sourceBackupSha256:ciphertextSha256,note:'Confirmed email is provider metadata, not proof of current human ownership. No account or permission was changed. No password/session/MFA material included.',exceptions};
fs.mkdirSync('build/neon',{recursive:true,mode:0o700});
fs.writeFileSync('build/neon/private-owner-identity-review.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
fs.writeFileSync('build/neon/preproduction-identity-summary.json',JSON.stringify({checkedAt:report.createdAt,sourceCaptureAt:s.capturedAt,sourceBackupSha256:ciphertextSha256,exceptions:exceptions.map(e=>({reason:e.reason,sourceUuidMatch:e.evidence.canonicalUuidMatch,relatedTenants:e.tenants.length,relatedMerchants:e.merchants.length,relatedOutlets:e.outlets.length,stagingBindings:e.stagingBindings.length,verifiedHumanOwnership:false,ownerApproval:e.ownerApproval})),scope:'Read-only; private UUID/evidence report retained outside Git; no identities activated or modified'},null,2)+'\n');
console.log(JSON.stringify({status:'OWNER_REVIEW_REQUIRED',exceptions:exceptions.length,privateReport:'build/neon/private-owner-identity-review.json',accountChanges:0}));
