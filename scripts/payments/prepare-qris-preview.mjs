// Explicit bootstrap for this new, empty, synthetic-only database. Never runtime.
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import {SAAS_PLANS} from '../../src/config/saasPlans';
import {pastikanPaket} from '../../services/billing/store';
const original=dotenv.parse(fs.readFileSync('../kasir-newhope/.env.neon-hybrid-candidate.local'));
const u=new URL(original.NEON_RESTORE_DATABASE_URL);
u.hostname='ep-long-glade-azcugn8m.c-3.ap-southeast-1.aws.neon.tech';u.pathname='/newhope_qris_preview';
for(const k of ['sslmode','uselibpqcompat'])u.searchParams.delete(k);
if(u.username!=='neondb_owner')throw Error('OWNER_REQUIRED');
const c=new pg.Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true}});
try{
 await c.connect();
 const actual=(await c.query('SELECT current_database() db,current_user owner')).rows[0];
 if(actual.db!=='newhope_qris_preview'||actual.owner!=='neondb_owner')throw Error('WRONG_TARGET');
 if(Number((await c.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema NOT IN('pg_catalog','information_schema')")).rows[0].n))throw Error('REFUSE_POPULATED_DATABASE');
 const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f),
 ...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort().map(f=>'supabase/migrations/'+f),
 ...['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql'].map(f=>'docs/security/'+f)];
 for(const f of files)await c.query(fs.readFileSync(f,'utf8'));
 await pastikanPaket({query:(s,p)=>c.query(s,p)},SAAS_PLANS);
 const role='newhope_qris_preview_runtime',pw=crypto.randomBytes(40).toString('base64url');
 if((await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)throw Error('EXISTING_ROLE_REFUSE_ROTATION');
 await c.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${pw}'`);
 await c.query(`GRANT CONNECT ON DATABASE newhope_qris_preview TO ${role};GRANT USAGE ON SCHEMA internal,billing,contract TO ${role};
 GRANT SELECT,INSERT,UPDATE ON billing.subscriptions,billing.invoices TO ${role};GRANT SELECT ON billing.plans TO ${role};GRANT SELECT,INSERT ON billing.payment_events TO ${role};
 GRANT SELECT,INSERT,UPDATE(id) ON internal.tenants TO ${role};GRANT SELECT ON internal.merchants TO ${role};GRANT SELECT,INSERT,UPDATE ON internal.outlets TO ${role};GRANT SELECT ON contract.subscription_operations TO ${role};`);
 for(const t of ['billing.subscriptions','billing.invoices','billing.payment_events','billing.plans','internal.tenants','internal.merchants','internal.outlets'])await c.query(`CREATE POLICY qris_preview_service ON ${t} TO ${role} USING(true) WITH CHECK(true)`);
 const runtime=new URL(u);runtime.hostname=runtime.hostname.replace('.c-3','-pooler.c-3');runtime.username=role;runtime.password=pw;runtime.searchParams.set('sslmode','verify-full');
 const env={DATABASE_URL:runtime.href,DOKU_PAYMENTS_ENABLED:'0',DOKU_CLIENT_ID:'',DOKU_SECRET_KEY:'',DOKU_ALLOWED_CHANNELS:'QRIS',DOKU_API_URL:'https://api-sandbox.doku.com',AUTH_PROVIDER:'supabase',AUTH_EMAIL_ENABLED:'0',APP_ENV:'staging',GROWTH_ENGINE_ENABLED:'0',GROWTH_CAPTURE_ENABLED:'0'};
 fs.writeFileSync('.env.qris-preview.local',Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600});fs.chmodSync('.env.qris-preview.local',0o600);
 console.log('PASS: explicit schema installation into new synthetic database; restricted runtime saved privately; payments paused');
}finally{await c.end();}
