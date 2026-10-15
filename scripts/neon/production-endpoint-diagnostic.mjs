import fs from 'node:fs';
import pg from 'pg';
import {parse} from 'dotenv';
// Operator runs inside the existing deployment environment, or supplies a private
// attested copy. Never fetch secrets from Vercel or print endpoints/credentials.
// No DDL, grants, production configuration changes, or business writes.
let env=process.env;
if(process.argv[2]){if(fs.statSync(process.argv[2]).mode&0o077)throw Error('PRIVATE_ENV_REQUIRED');env=parse(fs.readFileSync(process.argv[2]));}
let c;
try{
 const url=new URL(env.DATABASE_URL||'');
 if(!['postgresql:','postgres:'].includes(url.protocol)||url.hash||(url.port&&!['5432','6543'].includes(url.port))||[...url.searchParams.keys()].some(k=>!['sslmode','channel_binding','application_name','pgbouncer'].includes(k)))throw Error('UNREVIEWED_ENDPOINT');
 const source='fqxrhumsgigcgjtlbfuo';
 const supabaseDirect=url.hostname==='db.'+source+'.supabase.co'&&url.pathname==='/postgres';
 const supabasePooler=url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith('.'+source)&&url.pathname==='/postgres';
 const manifests=['full-restore','clean-rehearsal','fresh-candidate','hybrid-staging','hybrid-candidate','prelaunch-rehearsal'].map(n=>JSON.parse(fs.readFileSync('neon/targets/'+n+'.json','utf8')));
 const neon=manifests.find(m=>url.hostname.replace('-pooler','')===m.host&&url.pathname==='/'+m.database);
 if(!supabaseDirect&&!supabasePooler&&!neon)throw Error('UNREVIEWED_ENDPOINT');
 const connectionMode=supabasePooler?(url.port==='6543'?'SUPABASE_TRANSACTION_POOL':'SUPABASE_SESSION_POOL'):supabaseDirect?'SUPABASE_DIRECT':url.hostname.includes('-pooler.')?'NEON_TRANSACTION_POOL':'NEON_DIRECT';
 for(const k of ['sslmode','channel_binding','pgbouncer'])url.searchParams.delete(k);
 c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,...(env.PGSSLROOTCERT?{ca:fs.readFileSync(env.PGSSLROOTCERT,'utf8')}:{})},connectionTimeoutMillis:10000,options:'-c default_transaction_read_only=on'});
 await c.connect();
 if(!c.connection.stream.encrypted||!c.connection.stream.authorized)throw Error('VERIFIED_TLS_REQUIRED');
 await c.query("BEGIN READ ONLY; SET LOCAL statement_timeout='10s'");
 const r=(await c.query("SELECT current_setting('transaction_read_only')='on' read_only,r.rolsuper superuser,r.rolbypassrls bypass_rls,r.rolcreatedb create_db,r.rolcreaterole create_role,has_database_privilege(current_user,current_database(),'CREATE') database_create,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) compute_ssl FROM pg_roles r WHERE rolname=current_user")).rows[0];
 const dangerous=r.superuser||r.bypass_rls||r.create_db||r.create_role||r.database_create;
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),scope:'Read-only attested runtime endpoint diagnostic; no endpoint strings or credential values',connectionMode,sourceProjectMatches:supabaseDirect||supabasePooler,neonIsRehearsalBranch:!!neon&&!neon.productionEligible,verifiedClientTls:true,postgresBackendSslObserved:r.compute_ssl,internalTransportAttestation:'NOT_ESTABLISHED_BY_THIS_DIAGNOSTIC',readOnlyTransaction:r.read_only,roleIsLeastPrivilege:!dangerous,productionCutoverApproval:'NOT_ESTABLISHED',runtimeProvenance:'Operator must attest this environment belongs to the active deployment; a local file alone cannot prove it'}));
}catch(e){console.log(JSON.stringify({status:'BLOCKED',code:typeof e.code==='string'?e.code:'CONFIG_OR_VERIFICATION_FAILED',secretValuesOmitted:true}));process.exitCode=2;}
finally{if(c){await c.query('ROLLBACK').catch(()=>{});await c.end().catch(()=>{});}}
