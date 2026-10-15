import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,restoreTarget,quote,relation,appSchemas,credentialColumns,publicSummary,sha} from './backup-common.mjs';
const args=process.argv.slice(2),reviewed=args[args.indexOf('--reviewed-sha256')+1];
const preserveBusinessCredentials=process.env.NEON_RESTORE_TARGET==='hybrid-staging';
const {snapshot:s,ciphertextSha256}=await loadBackup();
if(!args.includes('--reviewed-sha256')||reviewed!==ciphertextSha256)throw Error('REVIEWED_BACKUP_SHA256_REQUIRED');
assert(!s.unsupported?.length&&!s.inheritance?.length,'Unsupported domain/range/composite/inheritance must be reviewed through native pg_dump');
assert(!s.tables.some(t=>t.kind!=='r'||t.partitioned_child||t.columns.some(c=>c.generated)),'Unsupported partition/generated columns');
assert(!s.views.some(v=>v.kind!=='v'),'Materialized-view data needs dedicated reviewed import');
assert(s.indexes.every(i=>i.valid),'Invalid indexes require source-specific review');
const {env,manifest,...config}=restoreTarget();
const c=new pg.Client(config);
const evidence={status:'RUNNING',scope:s.dataPolicy,sourceProject:s.sourceProject,sourceCapturedAt:s.capturedAt,targetProject:env.NEON_PROJECT_ID,targetBranch:env.NEON_BRANCH_ID,ciphertextSha256,startedAt:new Date().toISOString(),objects:publicSummary(s,ciphertextSha256).objectCounts,credentialResetRows:0,restoredRows:0,checks:{}};
let phase='connect',object='';
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
const number=v=>{assert(/^-?\d+$/.test(String(v)));return String(v)};
const sequenceParams=t=>'AS '+t.type+' INCREMENT BY '+number(t.increment)+' MINVALUE '+number(t.min)+' MAXVALUE '+number(t.max)+' START WITH '+number(t.start)+' CACHE '+number(t.cache)+' '+(t.cycle?'CYCLE':'NO CYCLE');
const pendingSql=[];
async function flushSql(){if(pendingSql.length){const statements=pendingSql.splice(0);try{await c.query(statements.join(';\n'));}catch(e){throw Object.assign(Error('RESTORE_FAILED:'+phase+':'+(e.table||'')+':'+(e.constraint||'')+':'+(e.code||'unknown')),{code:e.code,cause:e});}}}
async function execute(sql,values){try{if(!values){pendingSql.push(sql);return;}await flushSql();return await c.query(sql,values)}catch(e){throw Object.assign(Error('RESTORE_FAILED:'+phase+':'+object+':'+(e.constraint||'')+':'+(e.code||'unknown')),{code:e.code,cause:e})}}
await c.connect();
try{
 assert(c.connection.stream.authorized&&c.connection.stream.encrypted,'Verified TLS required');
 evidence.postgresVersion=(await c.query('SHOW server_version')).rows[0].server_version;
 const populated=(await c.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN('r','p','v','m','S')",[appSchemas])).rows[0].n;
 assert.equal(populated,0,'REFUSE_POPULATED_RESTORE_TARGET');
 await c.query('BEGIN');await c.query("SET LOCAL check_function_bodies=off; SET LOCAL search_path=public,extensions,pg_catalog; SET LOCAL statement_timeout='180s'; SET LOCAL lock_timeout='5s';");
 phase='schemas';for(const n of [...appSchemas,'extensions','auth'])await execute('CREATE SCHEMA IF NOT EXISTS '+quote(n));
 for(const name of ['pgcrypto','uuid-ossp','pg_trgm'])await execute('CREATE EXTENSION IF NOT EXISTS '+quote(name)+' WITH SCHEMA extensions');
 const policyRoles=[...new Set(['anon','authenticated','service_role',...s.policies.flatMap(p=>p.roles)])].filter(n=>n!=='public');
 for(const role of policyRoles)if(!(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount)await execute('CREATE ROLE '+quote(role)+' NOLOGIN NOSUPERUSER NOBYPASSRLS');
 // Legacy Supabase RLS helpers fail closed. Better Auth grants server identity,
 // never through mutable browser JWT metadata. No Supabase auth runtime copied.
 await execute("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULL::uuid$$; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT NULL::text$$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{}'::jsonb$$; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;");
 phase='enums';for(const t of s.enums||[])await execute('CREATE TYPE '+relation(t)+' AS ENUM ('+t.labels.map(literal).join(',')+')');
 phase='sequences';for(const t of s.sequences||[])if(t.ownerColumn?.dependencyType!=='i')await execute('CREATE SEQUENCE '+relation(t)+' '+sequenceParams(t));
 phase='functions';for(const f of s.functions||[]){await execute(f.definition);await execute('REVOKE ALL ON FUNCTION '+quote(f.schema)+'.'+quote(f.name)+'('+f.identity+') FROM PUBLIC');}
 phase='tables';for(const t of s.tables){
  const columns=t.columns.map(a=>{
   let sql=quote(a.name)+' '+a.type+(a.collation?' COLLATE '+a.collation:'');
   if(a.identity){const seq=s.sequences.find(q=>q.ownerColumn?.schema===t.schema&&q.ownerColumn?.table===t.name&&q.ownerColumn?.column===a.name);assert(seq,'Identity sequence metadata required');sql+=' GENERATED '+(a.identity==='a'?'ALWAYS':'BY DEFAULT')+' AS IDENTITY (SEQUENCE NAME '+relation(seq)+' '+sequenceParams(seq).replace(/^AS \S+ /,'' )+')';}
   return sql+(a.notNull?' NOT NULL':'');
  });
  await execute('CREATE TABLE '+relation(t)+' ('+columns.join(',')+')');
  if(t.reloptions?.length)await execute('ALTER TABLE '+relation(t)+' SET ('+t.reloptions.join(',')+')');
 }
 phase='defaults';for(const t of s.tables)for(const a of t.columns){
  // Never reinstate the source's operational default PIN 1234.
  if(a.default&&!a.identity&&!credentialColumns.includes(a.name))await execute('ALTER TABLE '+relation(t)+' ALTER COLUMN '+quote(a.name)+' SET DEFAULT '+a.default);
 }
 for(const t of s.sequences||[])if(t.ownerColumn?.dependencyType==='a')await execute('ALTER SEQUENCE '+relation(t)+' OWNED BY '+quote(t.ownerColumn.schema)+'.'+quote(t.ownerColumn.table)+'.'+quote(t.ownerColumn.column));
 phase='data';for(const t of s.tables){
  const columns=t.columns.filter(a=>!a.generated).map(a=>quote(a.name)).join(',');
  for(let i=0;i<t.rows.length;i+=200){
   const records=t.rows.slice(i,i+200).map(raw=>{
    // Keep raw PostgreSQL JSON strings intact to preserve big integer/numeric precision.
    if(!preserveBusinessCredentials&&t.schema.includes('mcp')&&t.name==='connections'){raw=raw.replace(/"revoked_at":\s*(?:null|"[^"]*")/, '"revoked_at": '+JSON.stringify(s.capturedAt));}
    const reset=preserveBusinessCredentials?[]:t.columns.filter(a=>credentialColumns.includes(a.name));
    if(reset.length){evidence.credentialResetRows++;const additions=t.columns.filter(a=>credentialColumns.includes(a.name)).map(a=>JSON.stringify(a.name)+':'+JSON.stringify(a.notNull?'!RESET!':null)).join(',');return raw.slice(0,-1)+','+additions+'}';}
    return raw;
   });
   await execute('INSERT INTO '+relation(t)+' ('+columns+') OVERRIDING SYSTEM VALUE SELECT '+columns+' FROM jsonb_populate_recordset(NULL::'+relation(t)+',$1::jsonb)',['['+records.join(',')+']']);
  }
  evidence.restoredRows+=t.rows.length;
 }
 phase='constraints';for(const type of ['p','u','c','x','f'])for(const con of (s.constraints||[]).filter(k=>k.type===type)){object=con.schema+'.'+con.table+'.'+con.name;await execute('ALTER TABLE '+quote(con.schema)+'.'+quote(con.table)+' ADD CONSTRAINT '+quote(con.name)+' '+con.definition);}
 phase='indexes';for(const i of s.indexes||[])await execute(i.definition);
 await flushSql();phase='views';const pending=[...(s.views||[])];while(pending.length){let made=0;for(let i=pending.length-1;i>=0;i--){const v=pending[i];await c.query('SAVEPOINT view_import');try{await c.query('CREATE VIEW '+relation(v)+(v.options?.length?' WITH ('+v.options.join(',')+')':'')+' AS '+v.definition);pending.splice(i,1);made++;await c.query('RELEASE SAVEPOINT view_import');}catch(e){await c.query('ROLLBACK TO SAVEPOINT view_import');if(!['42P01','42703','42883'].includes(e.code))throw Object.assign(Error('VIEW_FAILED:'+v.schema+'.'+v.name+':'+e.code),{cause:e});}}assert(made,'UNRESOLVED_VIEW_DEPENDENCIES');}
 phase='triggers';for(const t of s.triggers||[]){await execute(t.definition);if(t.enabled==='D')await execute('ALTER TABLE '+quote(t.schema)+'.'+quote(t.table)+' DISABLE TRIGGER '+quote(t.name));else if(t.enabled==='A')await execute('ALTER TABLE '+quote(t.schema)+'.'+quote(t.table)+' ENABLE ALWAYS TRIGGER '+quote(t.name));else if(t.enabled==='R')await execute('ALTER TABLE '+quote(t.schema)+'.'+quote(t.table)+' ENABLE REPLICA TRIGGER '+quote(t.name));}
 phase='policies';for(const p of s.policies||[])await execute('CREATE POLICY '+quote(p.name)+' ON '+quote(p.schema)+'.'+quote(p.table)+' AS '+p.permissive+' FOR '+p.command+' TO '+p.roles.map(r=>r==='public'?'PUBLIC':quote(r)).join(',')+(p.using?' USING ('+p.using+')':'')+(p.withCheck?' WITH CHECK ('+p.withCheck+')':''));
 for(const t of s.tables){if(t.rls)await execute('ALTER TABLE '+relation(t)+' ENABLE ROW LEVEL SECURITY');if(t.force_rls)await execute('ALTER TABLE '+relation(t)+' FORCE ROW LEVEL SECURITY');}
 phase='sequence-state';for(const t of s.sequences||[])await execute('SELECT setval($1::regclass,$2::bigint,$3::boolean)',[relation(t),t.state.lastValue,t.state.isCalled]);
 phase='least-privilege';for(const n of appSchemas){await execute('REVOKE ALL ON SCHEMA '+quote(n)+' FROM PUBLIC,anon,authenticated');await execute('REVOKE ALL ON ALL TABLES IN SCHEMA '+quote(n)+' FROM PUBLIC,anon,authenticated');await execute('REVOKE ALL ON ALL SEQUENCES IN SCHEMA '+quote(n)+' FROM PUBLIC,anon,authenticated');await execute('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA '+quote(n)+' FROM PUBLIC,anon,authenticated');}
 await flushSql();await c.query('COMMIT');evidence.status='PASS';evidence.checks={verifiedTls:true,emptyChildGuard:true,singleTransactionRestore:true,noSourceMutation:true,legacyPinDefaultsRemoved:true,unsafeSourceAclNotReapplied:true};
 console.log(JSON.stringify({status:evidence.status,restoredRows:evidence.restoredRows,credentialResetRows:evidence.credentialResetRows,objects:evidence.objects,targetBranch:env.NEON_BRANCH_ID}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});evidence.status='FAIL';evidence.failure=e.message;evidence.sqlstate=e.code||e.cause?.code||null;evidence.catalogError=e.cause?.message||null;throw Error(e.message+(e.cause?.message?': '+e.cause.message:''));}
finally{evidence.finishedAt=new Date().toISOString();fs.mkdirSync('build/neon',{recursive:true});fs.writeFileSync('build/neon/source-restore-evidence.json',JSON.stringify(evidence,null,2)+'\n');await c.end();}
