import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {parse} from 'dotenv';
import {appSchemas,privateFile,sha,sourceProject} from './backup-common.mjs';
// Optional direct read-only source path. MCP runs the exact same reviewed SQL
// with PUBLIC key substitution and saves ONLY its encrypted response instead.
const file=process.argv[2]||'.env.supabase-source.local';
if(!fs.existsSync(file))throw Error('SOURCE_READ_ONLY_CONNECTION_REQUIRED: see docs/migrations/data-restore.md');
const env=parse(privateFile(file));
if(env.SUPABASE_SOURCE_PROJECT_ID!==sourceProject)throw Error('SOURCE_PROJECT_MISMATCH');
const url=new URL(env.SUPABASE_SOURCE_DATABASE_URL||'');
const direct=url.hostname==='db.'+sourceProject+'.supabase.co';
const sessionPooler=url.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(url.username).endsWith('.'+sourceProject)&&url.port==='5432';
if(!['postgresql:','postgres:'].includes(url.protocol)||(!direct&&!sessionPooler)||url.pathname!=='/postgres'||url.port==='6543')throw Error('SOURCE_READ_ONLY_SESSION_ENDPOINT_REQUIRED');
for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])url.searchParams.delete(key);
const publicKey=fs.readFileSync('.env.neon-backup-keys.local/public.asc','utf8');
const sql=fs.readFileSync('scripts/neon/source-export.sql','utf8').replace('__PUBLIC_KEY__',publicKey.replaceAll("'","''"));
const c=new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,...(env.PGSSLROOTCERT?{ca:fs.readFileSync(env.PGSSLROOTCERT,'utf8')}:{})},options:'-c default_transaction_read_only=on',connectionTimeoutMillis:10000});
const output=path.resolve(process.argv[3]||'build/neon/source-'+new Date().toISOString().replaceAll(':','-')+'.pgp.b64');
if(fs.existsSync(output))throw Error('REFUSE_OVERWRITE_BACKUP');
await c.connect();try{
 if(!c.connection.stream.encrypted||!c.connection.stream.authorized)throw Error('SOURCE_TLS_VERIFICATION_REQUIRED');
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const settings=(await c.query("SELECT current_setting('transaction_read_only') AS read_only,current_setting('server_version') AS version")).rows[0];
 if(settings.read_only!=='on')throw Error('SOURCE_READ_ONLY_TRANSACTION_REQUIRED');
 const row=(await c.query(sql)).rows[0];if(row.status!=='ENCRYPTED'||!row.ciphertext)throw Error('ENCRYPTED_EXPORT_REQUIRED');
 fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});fs.writeFileSync(output,row.ciphertext+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'PASS',format:row.format,plaintextBytes:row.plaintext_bytes,ciphertextSha256:sha(fs.readFileSync(output)),version:settings.version,sourceReadOnly:true,output:output.replace(process.cwd()+'/','')}));
}finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
