import fs from 'node:fs';
import {migrationBody} from '../../services/db-server/atomicMigration.ts';
export function cleanSchemaFiles(){return ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',
 ...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f),
 ...['free-plan-selection.sql','free-plan-ai-credit-access.sql','restrict-browser-rls-policies.sql','intelligence-cache.sql','intelligence-wallet.sql'].map(f=>'docs/security/'+f),
 ...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort().map(f=>'supabase/migrations/'+f),
 'docs/full-neon/clean-runtime-schema.sql'];}
export function cleanSchemaBody(file){
 let sql=fs.readFileSync(file,'utf8');
 if(file==='migrations/0004_internal_backoffice.sql'){
  const seed=/INSERT INTO internal_users \(id, email, full_name, role\)\s+VALUES \('int-root',[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/;
  if(!seed.test(sql))throw Error('BOOTSTRAP_SEED_REVIEW_DRIFT');sql=sql.replace(seed,'-- No default administrator in clean launch.');
 }
 if(file==='migrations/0042_connect_blog_and_customers.sql'){
  const at=sql.indexOf('-- Seed artikel awal edukasi bisnis');if(at<0)throw Error('BLOG_SEED_REVIEW_DRIFT');sql=sql.slice(0,at);
 }
 return migrationBody(sql);
}
