import assert from 'node:assert/strict';
import {betterAuthPilotConfig} from '../../services/shared/betterAuthPilot';
import {authenticateBearer} from '../../services/shared/auth';
import {sendBetterAuthEmail} from '../../services/shared/betterAuthEmail';
const env={BETTER_AUTH_MIGRATION_PILOT:'1',NEON_PROJECT_ID:'steep-sea-66546931',NEON_BRANCH_ID:'br-icy-dust-azqi5vlc',
  NEON_STAGING_DATABASE_URL:'postgresql://fixture:fixture@ep-damp-pine-azrnsoge-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb',
  BETTER_AUTH_URL:'http://127.0.0.1:5173',BETTER_AUTH_SECRET:'fixture-secret-'.repeat(5)};
const database='postgresql://fixture:fixture@ep-damp-pine-azrnsoge-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb';
const base={...env,DATABASE_URL:database};
assert.doesNotThrow(()=>betterAuthPilotConfig(base));
for(const extra of [{VERCEL_ENV:'production'},{NODE_ENV:'production'},{BETTER_AUTH_MIGRATION_PILOT:'0'},
  {NEON_BRANCH_ID:'br-falling-butterfly-az989m86'},{NEON_PROJECT_ID:'rapid-truth-63824854'},
  {DATABASE_URL:'postgresql://fixture:fixture@db.fqxrhumsgigcgjtlbfuo.supabase.co/postgres'},
  {BETTER_AUTH_URL:'https://fixture.invalid/user-chosen/path'},{BETTER_AUTH_URL:'http://fixture.invalid'},
  {BETTER_AUTH_SECRET:'1234'},{DATABASE_URL:''},{BETTER_AUTH_DATABASE_URL:database,DATABASE_URL:database+'?host=foreign.invalid'},
  {BETTER_AUTH_DATABASE_URL:database,DATABASE_URL:'postgresql://fixture@db.fqxrhumsgigcgjtlbfuo.supabase.co/postgres'}])assert.throws(()=>betterAuthPilotConfig({...base,...extra}));
assert.doesNotThrow(()=>betterAuthPilotConfig({...base,BETTER_AUTH_URL:'https://fixture.invalid',NODE_ENV:'production',VERCEL_ENV:'preview'}));
const restoreHost='ep-plain-dream-azghoyf7-pooler.c-3.ap-southeast-1.aws.neon.tech';
const candidate={...base,NEON_BRANCH_ID:'br-curly-truth-aze21ktf',NEON_STAGING_DATABASE_URL:'',
  DATABASE_URL:`postgresql://newhope_runtime_login:fixture@${restoreHost}/neondb`,
  BETTER_AUTH_DATABASE_URL:`postgresql://newhope_auth_runtime_login:fixture@${restoreHost}/neondb`,
  BETTER_AUTH_URL:'https://kasir.newhope.space',BETTER_AUTH_TRUSTED_ORIGINS:'https://admin.newhope.space',
  NODE_ENV:'production',VERCEL_ENV:'production',NEON_PRODUCTION_CUTOVER_APPROVED:'1',
  STORAGE_PROVIDER:'neon',AUTH_EMAIL_ENABLED:'1'};
assert.throws(()=>betterAuthPilotConfig(candidate),/BETTER_AUTH_PRODUCTION_CUTOVER_BLOCKED/,'Restore rehearsal contains fixtures and cannot be activated as production even with the flag');
assert.deepEqual(betterAuthPilotConfig({...candidate,VERCEL_ENV:'preview'}).allowedOrigins,['https://kasir.newhope.space','https://admin.newhope.space']);
for(const extra of [{NEON_PRODUCTION_CUTOVER_APPROVED:'0'},{DATABASE_URL:`postgresql://neondb_owner:fixture@${restoreHost}/neondb`},
  {BETTER_AUTH_DATABASE_URL:candidate.DATABASE_URL},{BETTER_AUTH_URL:'https://preview.invalid'},
  {BETTER_AUTH_TRUSTED_ORIGINS:'https://foreign.invalid'},{BETTER_AUTH_TRUSTED_ORIGINS:'https://admin.newhope.space/path'},
  {BETTER_AUTH_TRUSTED_ORIGINS:'https://*.newhope.space'},{STORAGE_PROVIDER:'supabase'},{AUTH_EMAIL_ENABLED:'0'}])
  assert.throws(()=>betterAuthPilotConfig({...candidate,...extra}));
process.env.AUTH_PROVIDER='better-auth';process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT='1';
assert.equal(await authenticateBearer({headers:{}} as any),null,'Local development bypass cannot create a Better Auth identity');
delete process.env.AUTH_PROVIDER;delete process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT;
await assert.rejects(()=>sendBetterAuthEmail({kind:'RESET',email:'fixture@example.invalid',baseUrl:'https://fixture.invalid',url:'https://foreign.invalid/api/auth/reset-password/fixture'}),/AUTH_EMAIL_URL_REJECTED/);
await assert.rejects(()=>sendBetterAuthEmail({kind:'VERIFY',email:'fixture@example.invalid',baseUrl:'http://127.0.0.1:5173',url:'http://127.0.0.1:5173/api/auth/verify-email?token=fixture'}),/AUTH_EMAIL_HTTPS_REQUIRED/);
console.log('PASS: Better Auth enforces explicit cutover gate, approved restore branch, split restricted roles, exact POS/admin origins, storage/email dependencies and HTTPS email links');
