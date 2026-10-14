import fs from 'node:fs';
import pg from 'pg';
import {loadBackup,restoreTarget,appSchemas,sha} from './backup-common.mjs';
const {snapshot:s,ciphertextSha256}=await loadBackup();
const {env,manifest,...config}=restoreTarget(),c=new pg.Client(config);
await c.connect();try{
 const refs=new Map();for(const base of ['services','src/server'])for(const p of fs.readdirSync(base,{recursive:true}).filter(p=>p.endsWith('.ts'))){const f=base+'/'+p;const txt=fs.readFileSync(f,'utf8');for(const m of txt.matchAll(/\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?((?:ai|pos|internal|billing|public|contract|mcp_private|blog_mcp_private)\.[a-z_][a-z0-9_]*)/gi)){const arr=refs.get(m[1])||new Set();arr.add(f);refs.set(m[1],arr);}}
 const actual=new Set((await c.query("SELECT n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN('r','p','v','m','S')",[appSchemas])).rows.map(r=>r.name));
 const original=new Set([...s.tables,...s.views,...s.sequences].map(t=>t.schema+'.'+t.name));
 const missingRuntime=[...refs].filter(([name])=>!actual.has(name)).map(([name,files])=>({name,files:[...files]}));
 const sourceMissing=[...refs].filter(([name])=>!original.has(name)).map(([name,files])=>({name,files:[...files]}));
 const rpc=(await c.query("SELECT to_regprocedure('ai.add_ai_credit(uuid,integer,text)') IS NOT NULL topup,to_regclass('ai.credit_ledger') IS NOT NULL ledger,to_regclass('pos.shared_state_versions') IS NOT NULL versions,to_regclass('pos.staff_attendances') IS NOT NULL attendance,to_regclass('pos.staff_payrolls') IS NOT NULL payroll,EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='pos.sync_receipts'::regclass AND attname='outcomes') receiptOutcomes")).rows[0];
 const evidence={status:missingRuntime.length?'RUNTIME_GAPS':'PASS',scope:'Static fully-qualified runtime relation audit plus actual catalog probes; dynamic SQL tested separately',sourceCiphertextSha256:ciphertextSha256,targetBranch:env.NEON_BRANCH_ID,fullyQualifiedRuntimeRelations:refs.size,sourceMissing,missingRuntime,capabilities:rpc,limitations:['Not a SQL parser; dynamic relations and columns require integration tests','Optional syncReceiptOutcomes remains absent; current runtime explicitly uses compatible legacy replay path']};fs.writeFileSync('build/neon/source-runtime-audit-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({status:evidence.status,relations:refs.size,missingRuntime,capabilities:rpc}));
}finally{await c.end();}
