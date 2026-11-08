import {createHash} from 'node:crypto';
import {SAAS_PLANS} from '../../src/config/saasPlans';

export const stagingGrantTarget={projectId:'steep-sea-66546931',branchId:'br-red-smoke-aznyozaq',database:'neondb',host:'ep-gentle-silence-az2bwpz6.c-3.ap-southeast-1.aws.neon.tech'} as const;
export interface StagingModuleGrant {tenantId:string;merchantId:string;outletId:string;ownerId:string;expiresAt:string;reference:string}
const modules=['fnb','retail','laundry','carwash','barber'];
const features=['overview','pos','tables','inventory','reports','customers','labor','settings'];
/** Maintenance SQL only, never an HTTP endpoint or an application authorization path.
 * Execute through the reviewed staging branch connector or an exact pinned direct URL.
 * A single QA outlet hosts isolated module namespaces; no user, membership, subscription,
 * payment, outlet capacity, MFA proof or session is created or changed.
 */
export function stagingModuleGrantSql(input:StagingModuleGrant,apply=false){
 for(const key of ['tenantId','merchantId','outletId','ownerId'] as const)if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input[key]))throw Error('INVALID_STAGING_SCOPE');
 if(!/^pr35-qa-[a-z0-9-]{1,64}$/.test(input.reference))throw Error('INVALID_STAGING_REFERENCE');
 if(!Number.isFinite(Date.parse(input.expiresAt)))throw Error('INVALID_STAGING_EXPIRY');
 const manifest={...Object.fromEntries(['tenantId','merchantId','outletId','ownerId','reference'].map(k=>[k,input[k as keyof StagingModuleGrant]])),expiresAt:new Date(input.expiresAt).toISOString(),modules,features};
 const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
 const literal=JSON.stringify(manifest).replaceAll("'","''");
 return {digest,sql:`DO $staging_grant$
DECLARE p jsonb := '${literal}'::jsonb; tid uuid := (p->>'tenantId')::uuid; mid uuid := (p->>'merchantId')::uuid;
 oid uuid := (p->>'outletId')::uuid; owner_ref uuid := (p->>'ownerId')::uuid; expiry timestamptz := (p->>'expiresAt')::timestamptz;
 module_name text; prior jsonb; subscription_row billing.subscriptions%ROWTYPE; outlet_limit int; used_outlets int;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('pr35-staging-module-grant'));
 IF current_database()<>'neondb' AND current_database()<>'newhope_security_rehearsal' AND current_database()<>'postgres' THEN RAISE EXCEPTION 'STAGING_DATABASE_REJECTED'; END IF;
 -- The connector must select stagingGrantTarget. URL validation belongs to its caller.
 IF expiry<=now() OR expiry>now()+interval '48 hours' THEN RAISE EXCEPTION 'STAGING_EXPIRY_REJECTED'; END IF;
 PERFORM 1 FROM internal.tenants t JOIN internal.users u ON u.id=owner_ref AND u.is_active
 WHERE t.id=tid AND t.owner_user_ref=owner_ref::text AND t.is_active AND t.merged_into IS NULL FOR UPDATE OF t,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAGING_OWNER_MISMATCH'; END IF;
 PERFORM 1 FROM internal.merchants WHERE id=mid AND tenant_id=tid AND is_active AND name LIKE 'QA Staging %' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'QA_MERCHANT_REQUIRED'; END IF;
 PERFORM 1 FROM internal.outlets WHERE id=oid AND merchant_id=mid AND tenant_id=tid AND is_active AND name LIKE 'QA %' FOR UPDATE;
 IF NOT FOUND OR (SELECT count(*) FROM internal.outlets WHERE merchant_id=mid)<>1 THEN RAISE EXCEPTION 'SINGLE_QA_OUTLET_REQUIRED'; END IF;
 SELECT * INTO subscription_row FROM billing.subscriptions WHERE tenant_id=tid FOR UPDATE;
 IF NOT FOUND OR subscription_row.status NOT IN ('TRIAL','TRIALING','ACTIVE') OR subscription_row.current_period_end<expiry
 OR subscription_row.plan_id='plan-free-lifetime' THEN RAISE EXCEPTION 'VALID_TRIAL_OR_PAID_REQUIRED'; END IF;
 SELECT (CASE subscription_row.plan_id ${SAAS_PLANS.map(plan=>`WHEN '${plan.id}' THEN ${plan.maxOutlets}`).join(' ')} ELSE NULL END)+COALESCE(subscription_row.extra_outlets,0) INTO outlet_limit;
 SELECT count(*) INTO used_outlets FROM internal.outlets WHERE tenant_id=tid;
 IF outlet_limit IS NULL OR used_outlets>outlet_limit THEN RAISE EXCEPTION 'OUTLET_CAPACITY_EXCEEDED'; END IF;
 IF EXISTS(SELECT 1 FROM pos.shifts WHERE merchant_id=mid AND status='OPEN') THEN RAISE EXCEPTION 'QA_SHIFT_MUST_BE_CLOSED'; END IF;
 SELECT detail INTO prior FROM internal.audit_logs WHERE merchant_id=mid AND event_type='STAGING_MODULE_GRANT' AND detail->>'reference'=p->>'reference';
 IF prior IS NOT NULL AND prior->>'digest'<>'${digest}' THEN RAISE EXCEPTION 'STAGING_REFERENCE_REUSED'; END IF;
 IF EXISTS(SELECT 1 FROM internal.merchant_modules WHERE merchant_id=mid AND (NOT enabled OR workspace_version<>2 OR NOT guard_legacy_apis))
 OR EXISTS(SELECT 1 FROM billing.module_entitlements WHERE merchant_id=mid AND (NOT enabled OR grant_reference<>p->>'reference' OR expires_at<>expiry OR features<>ARRAY['${features.join("','")}']))
 OR EXISTS(SELECT 1 FROM internal.outlet_modules WHERE merchant_id=mid AND (outlet_id<>oid OR NOT enabled)) THEN RAISE EXCEPTION 'STAGING_GRANT_DRIFT'; END IF;
 IF prior IS NOT NULL THEN
  IF (SELECT count(*) FROM internal.merchant_modules WHERE merchant_id=mid)<>5 OR (SELECT count(*) FROM billing.module_entitlements WHERE merchant_id=mid)<>5 OR (SELECT count(*) FROM internal.outlet_modules WHERE merchant_id=mid)<>5 THEN RAISE EXCEPTION 'STAGING_GRANT_DRIFT'; END IF;
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM internal.merchant_modules WHERE merchant_id=mid) OR EXISTS(SELECT 1 FROM billing.module_entitlements WHERE merchant_id=mid) THEN RAISE EXCEPTION 'EMPTY_QA_GRANTS_REQUIRED'; END IF;
 IF ${apply?'true':'false'} THEN
  FOREACH module_name IN ARRAY ARRAY['${modules.join("','")}'] LOOP
   INSERT INTO internal.merchant_modules(tenant_id,merchant_id,module_id,enabled,guard_legacy_apis,workspace_version) VALUES(tid,mid,module_name,true,true,2);
   INSERT INTO internal.outlet_modules(tenant_id,merchant_id,outlet_id,module_id,enabled) VALUES(tid,mid,oid,module_name,true);
   INSERT INTO billing.module_entitlements(tenant_id,merchant_id,module_id,enabled,features,expires_at,grant_reference) VALUES(tid,mid,module_name,true,ARRAY['${features.join("','")}'],expiry,p->>'reference');
  END LOOP;
  INSERT INTO internal.audit_logs(tenant_id,merchant_id,domain,event_type,severity,actor_id,actor_role,summary,detail)
  VALUES(tid,mid,'SYSTEM','STAGING_MODULE_GRANT','INFO',NULL,'RELEASE_MAINTENANCE','Approved PR35 QA module pilot; no subscription or MFA change',p||jsonb_build_object('digest','${digest}','authorization','PR35 release blocker resolution: staging provisioning','environment','staging'));
 END IF;
END $staging_grant$;`};
}

export function assertStagingGrantConnection(raw:string){
 const u=new URL(raw);
 if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==stagingGrantTarget.host||u.pathname!=='/neondb'||u.username!=='neondb_owner'||u.hash||[...u.searchParams.keys()].some(k=>k!=='sslmode')||u.searchParams.get('sslmode')!=='verify-full')throw Error('STAGING_CONNECTION_REJECTED');
}

/** Produce the complete scoped connector call, rather than accepting a default branch. */
export function stagingModuleGrantRequest(input:StagingModuleGrant,reviewedDigest?:string){
 const plan=stagingModuleGrantSql(input);
 if(reviewedDigest!==undefined&&reviewedDigest!==plan.digest)throw Error('STAGING_REVIEW_DIGEST_MISMATCH');
 return {project_id:stagingGrantTarget.projectId,branch_id:stagingGrantTarget.branchId,database_name:stagingGrantTarget.database,
  sql:stagingModuleGrantSql(input,reviewedDigest!==undefined).sql};
}
