import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,restoreTarget,appSchemas,quote,relation,credentialColumns,sha,isHybridRestore} from './backup-common.mjs';
const hybrid=isHybridRestore();
const {snapshot:s,ciphertextSha256}=await loadBackup();
const {env,manifest,...config}=restoreTarget();
const c=new pg.Client(config),evidence={status:'RUNNING',scope:hybrid?'Actual encrypted source business snapshot vs isolated Neon; all business credentials retained privately, Auth/Storage runtime excluded':'Actual encrypted source business snapshot vs isolated Neon restored business data; source credentials deliberately excluded',ciphertextSha256,sourceCapturedAt:s.capturedAt,targetProject:env.NEON_PROJECT_ID,targetBranch:env.NEON_BRANCH_ID,startedAt:new Date().toISOString(),tables:[],checks:{},exceptions:[]};
const fingerprint=rows=>sha(rows.map(r=>r.row).sort().join('\n'));
await c.connect();
try{
 assert(c.connection.stream.authorized&&c.connection.stream.encrypted);
 await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='90s';");
 for(const t of s.tables){
  const excluded=hybrid?[]:[...credentialColumns];if(!hybrid&&t.schema.includes('mcp')&&t.name==='connections')excluded.push('revoked_at');
  const expected=(await c.query('SELECT (x.value - $1::text[])::text row FROM jsonb_array_elements($2::jsonb) x(value)',[excluded,'['+t.rows.join(',')+']'])).rows;
  const actual=(await c.query('SELECT (to_jsonb(t) - $1::text[])::text row FROM '+relation(t)+' t',[excluded])).rows;
  const sourceFingerprint=fingerprint(expected),targetFingerprint=fingerprint(actual);
  const match=expected.length===actual.length&&sourceFingerprint===targetFingerprint;
  evidence.tables.push({schema:t.schema,name:t.name,sourceRows:expected.length,targetRows:actual.length,sourceFingerprint,targetFingerprint,match,excludedColumns:excluded.filter(n=>t.columns.some(a=>a.name===n))});
  if(!match)evidence.exceptions.push({kind:'TABLE_DATA_MISMATCH',table:t.schema+'.'+t.name});
 }
 const catalog=(await c.query("SELECT n.nspname schema,c.relname name,c.relkind kind,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN('r','p','v','m','S') ORDER BY 1,2",[appSchemas])).rows;
 const expectedObjects=[...s.tables.map(t=>({schema:t.schema,name:t.name,kind:t.kind,rls:t.rls,force_rls:t.force_rls})),...(s.views||[]).map(v=>({schema:v.schema,name:v.name,kind:v.kind,rls:false,force_rls:false})),...(s.sequences||[]).map(q=>({schema:q.schema,name:q.name,kind:'S',rls:false,force_rls:false}))].sort((a,b)=>(a.schema+'.'+a.name).localeCompare(b.schema+'.'+b.name));
 const sourceKeys=expectedObjects.map(v=>v.schema+'.'+v.name+':'+v.kind+':'+v.rls+':'+v.force_rls).sort(),targetKeys=catalog.filter(v=>sourceKeys.some(k=>k.startsWith(v.schema+'.'+v.name+':'))).map(v=>v.schema+'.'+v.name+':'+v.kind+':'+v.rls+':'+v.force_rls).sort();
 assert.deepEqual(targetKeys,sourceKeys,'Source relations and RLS flags preserved');
 evidence.checks.sourceRelationsAndRls={status:'PASS',objects:sourceKeys.length};
 const constraints=(await c.query("SELECT n.nspname schema,t.relname AS table,c.conname name,c.contype type,c.convalidated validated,pg_get_constraintdef(c.oid,true) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=ANY($1::text[])",[appSchemas])).rows;
 let constraintMatches=0;const deparserEquivalent=[];
 for(const x of s.constraints||[]){
  const found=constraints.find(t=>t.schema===x.schema&&t.table===x.table&&t.name===x.name);
  if(!found||found.type!==x.type||found.validated!==x.validated){evidence.exceptions.push({kind:'CONSTRAINT_MISMATCH',schema:x.schema,table:x.table,constraint:x.name});continue;}
  if(found.definition===x.definition){constraintMatches++;continue;}
  // PG18 pushes an ARRAY[...]::text[] coercion into each varchar literal.
  // Accept ONLY this specific parser rewrite, then execute each permitted label,
  // an invalid label and NULL against BOTH parsed expressions to verify equality.
  const sourceMatch=x.definition.match(/^CHECK \(([a-z_][a-z0-9_]*)::text = ANY \(ARRAY\[((?:'(?:''|[^'])*'::character varying(?:, )?)+)\]::text\[\]\)\)$/);
  const targetMatch=found.definition.match(/^CHECK \(([a-z_][a-z0-9_]*)::text = ANY \(ARRAY\[((?:'(?:''|[^'])*'::character varying::text(?:, )?)+)\]\)\)$/);
  if(sourceMatch&&targetMatch&&sourceMatch[1]===targetMatch[1]&&sourceMatch[2]===targetMatch[2].replaceAll('::character varying::text','::character varying')){
   const labels=[...sourceMatch[2].matchAll(/'((?:''|[^'])*)'::character varying/g)].map(m=>m[1].replaceAll("''","'"));
   const from=x.definition.slice(7,-1).replace(sourceMatch[1]+'::text','$1::varchar::text');
   const to=found.definition.slice(7,-1).replace(targetMatch[1]+'::text','$1::varchar::text');
   for(const label of [...labels,'__MIGRATION_INVALID_LABEL__',null]){const r=(await c.query('SELECT ('+from+') source_result,('+to+') target_result',[label])).rows[0];assert.equal(r.source_result,r.target_result,'Array cast semantics differ');assert.equal(r.target_result,label===null?null:label!=='__MIGRATION_INVALID_LABEL__');}
   constraintMatches++;deparserEquivalent.push({schema:x.schema,table:x.table,constraint:x.name,acceptedLabels:labels.length,invalidLabelRejected:true,nullSemanticsEqual:true,reason:'PG18 array coercion deparser rewrite; both expressions executed'});
  }else evidence.exceptions.push({kind:'CONSTRAINT_MISMATCH',schema:x.schema,table:x.table,constraint:x.name});
 }
 evidence.checks.postgres17To18ConstraintRewrites=deparserEquivalent;
 evidence.checks.constraints={source:s.constraints.length,exactMatches:constraintMatches};
 const sequences=[];for(const q of s.sequences||[]){const v=(await c.query('SELECT last_value::text AS value,is_called FROM '+relation(q))).rows[0];const matches=v.value===q.state.lastValue&&v.is_called===q.state.isCalled;sequences.push({schema:q.schema,name:q.name,match:matches});if(!matches)evidence.exceptions.push({kind:'SEQUENCE_STATE_MISMATCH',sequence:q.schema+'.'+q.name});}evidence.checks.sequences=sequences;
 const credentials=(await c.query("SELECT (SELECT count(*) FROM pos.financial_pin_credentials)::int pin_credentials,(SELECT count(*) FROM pos.financial_approval_grants)::int approvals,(SELECT count(*) FROM blog_mcp_private.credentials)::int blog_tokens,(SELECT count(*) FROM mcp_private.credentials)::int pos_tokens,(SELECT count(*) FROM blog_mcp_private.connections WHERE revoked_at IS NULL)::int live_blog_connections,(SELECT count(*) FROM mcp_private.connections WHERE revoked_at IS NULL)::int live_pos_connections,(SELECT count(*) FROM information_schema.columns WHERE table_schema=ANY($1::text[]) AND column_name IN('pin','pin_hash','token_hash','password_hash') AND column_default IS NOT NULL)::int credential_defaults",[appSchemas])).rows[0];
 if(hybrid)evidence.checks.businessCredentialsPreserved={status:'PASS',all125TablesExactIncludingCredentialColumns:true,...credentials};else{assert(Object.values(credentials).every(v=>v===0),'No copied active credentials or default PIN');evidence.checks.credentialReset={status:'PASS',...credentials};}
 // Independent arithmetic invariant evidence without tenant/customer identifiers.
 const totals=(await c.query("SELECT jsonb_build_object('transactions',(SELECT jsonb_build_object('rows',count(*),'subtotal',coalesce(sum(subtotal),0)::text,'discount',coalesce(sum(discount_amount),0)::text,'tax',coalesce(sum(tax_amount),0)::text,'service',coalesce(sum(service_charge_amount),0)::text,'total',coalesce(sum(total_amount),0)::text) FROM pos.transactions),'payments',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(amount),0)::text) FROM pos.payments),'cashLedger',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(amount),0)::text) FROM pos.cash_ledger),'refunds',(SELECT jsonb_build_object('rows',count(*),'amount',coalesce(sum(amount),0)::text) FROM pos.transaction_refunds),'aiWallet',(SELECT jsonb_build_object('rows',count(*),'balance',coalesce(sum(balance),0),'used',coalesce(sum(used_this_month),0),'monthlyGrant',coalesce(sum(monthly_grant),0)) FROM ai.merchant_ai_credits),'subscriptions',(SELECT jsonb_build_object('rows',count(*),'active',count(*) FILTER(WHERE status='ACTIVE'),'recurringAmount',coalesce(sum(recurring_amount),0)::text) FROM billing.subscriptions)) totals")).rows[0].totals;
 evidence.checks.financialTotals=totals;
 const tables=s.tables.reduce((n,t)=>n+t.rows.length,0);evidence.checks.totalSourceRows=tables;
 assert.equal(evidence.exceptions.length,0,'Reconciliation discrepancies require review; no data rewriting');
 evidence.status='PASS';console.log(JSON.stringify({status:'PASS',tables:s.tables.length,rows:tables,constraints:constraintMatches,sequences:sequences.length,targetBranch:env.NEON_BRANCH_ID}));
}catch(e){evidence.status='FAIL';evidence.failure=e.message;throw Error(e.message);}finally{await c.query('ROLLBACK').catch(()=>{});await c.end();evidence.finishedAt=new Date().toISOString();fs.writeFileSync('build/neon/source-reconciliation-evidence.json',JSON.stringify(evidence,null,2)+'\n');}
