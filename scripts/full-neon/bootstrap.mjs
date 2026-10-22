import fs from 'node:fs';import pg from 'pg';import dotenv from 'dotenv';import {createHash} from 'node:crypto';
const selection=process.argv[2];if(!['staging','production'].includes(selection))throw Error('EXPLICIT_CLEAN_TARGET_REQUIRED');
if(selection==='production' && process.env.FULL_NEON_CLEAN_PRODUCTION_APPROVED!=='OWNER_CLEAN_START_2026_10_22')throw Error('PRODUCTION_BOOTSTRAP_NOT_APPROVED');
const env=dotenv.parse(fs.readFileSync('.env.full-neon-owner.local'));
const url=new URL(env[selection==='staging'?'FULL_NEON_STAGING_OWNER_URL':'FULL_NEON_PRODUCTION_OWNER_URL']);
const host=selection==='staging'?'ep-flat-recipe-azti3hh0.c-3.ap-southeast-1.aws.neon.tech':'ep-twilight-moon-azqj69l8.c-3.ap-southeast-1.aws.neon.tech';
if(url.hostname.replace('-pooler','')!==host || url.pathname!=='/'+(selection==='staging'?'newhope_full_neon_staging':'neondb'))throw Error('CLEAN_DATABASE_ENDPOINT_MISMATCH');
url.hostname=host;for(const k of ['sslmode','channel_binding'])url.searchParams.delete(k);
const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:15000});await c.connect();
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
try{
 const scoped=await c.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN('r','p') AND n.nspname IN('public','pos','internal','billing','ai','contract')");
 if(scoped.rows[0].n!==0)throw Error('REFUSE_BOOTSTRAP_POPULATED_BUSINESS_DATABASE');
 await c.query('BEGIN');
 const evidence=[];
 for(const file of files){let sql=fs.readFileSync(file,'utf8');
  // Historical bootstrap examples are intentionally excluded in clean launch.
  if(file==='migrations/0004_internal_backoffice.sql'){
   const seed=/INSERT INTO internal_users \(id, email, full_name, role\)\s+VALUES \('int-root',[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/;
   if(!seed.test(sql))throw Error('BOOTSTRAP_SEED_REVIEW_DRIFT');sql=sql.replace(seed,'-- No default administrator in clean launch.');
  }
  if(file==='migrations/0042_connect_blog_and_customers.sql'){
   const at=sql.indexOf('-- Seed artikel awal edukasi bisnis');if(at<0)throw Error('BLOG_SEED_REVIEW_DRIFT');sql=sql.slice(0,at);
  }
  try{await c.query(sql);}catch(e){throw new Error('MIGRATION_FAILED '+file+' SQLSTATE '+e.code,{cause:e});}
  evidence.push({file,sha256:createHash('sha256').update(sql).digest('hex')});
 }
 for(const file of ['docs/security/free-plan-selection.sql','docs/security/free-plan-ai-credit-access.sql','docs/security/restrict-browser-rls-policies.sql'])await c.query(fs.readFileSync(file,'utf8'));
 await c.query(`CREATE TABLE internal.full_neon_bootstrap_evidence(id text PRIMARY KEY,manifest jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 REVOKE ALL ON internal.full_neon_bootstrap_evidence FROM PUBLIC,anon,authenticated;`);
 await c.query('INSERT INTO internal.full_neon_bootstrap_evidence(id,manifest) VALUES($1,$2::jsonb)',['clean-start-2026-10-22',JSON.stringify(evidence)]);
 const clean=(await c.query("SELECT (SELECT count(*) FROM internal.tenants)::int tenants,(SELECT count(*) FROM internal.merchants)::int merchants,(SELECT count(*) FROM internal.outlets)::int outlets,(SELECT count(*) FROM pos.transactions)::int transactions,(SELECT count(*) FROM internal.internal_users)::int admins")).rows[0];
 if(Object.values(clean).some(n=>n!==0))throw Error('REFUSE_DUMMY_DATA_OR_DEFAULT_ADMIN');
 await c.query('COMMIT');
 fs.mkdirSync('build/full-neon',{recursive:true});fs.writeFileSync('build/full-neon/bootstrap-'+selection+'.json',JSON.stringify({status:'PASS',target:selection,files:evidence,clean,managedAuthTouched:false},null,2));console.log(JSON.stringify({status:'PASS',target:selection,migrations:files.length,clean,authSchemaPreserved:true}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{await c.end();}
