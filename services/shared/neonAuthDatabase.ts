import pg from 'pg';
import {fullNeonConfig} from './fullNeon';
import {databaseTransport} from './databaseTls';
let pool:pg.Pool|undefined;
/** Read only managed identity metadata; credentials remain server-side. */
export function neonAuthDatabase(){
 if(!pool){const t=fullNeonConfig(),url=new URL(process.env.NEON_AUTH_DATABASE_URL||process.env.DATABASE_URL||'');
  if(url.hostname.replace('-pooler','')!==t.host||url.pathname!=='/neondb'||url.username!=='newhope_clean_runtime')throw Error('MANAGED_AUTH_DATABASE_BINDING_REQUIRED');
  pool=new pg.Pool({...databaseTransport(url.href),max:2,connectionTimeoutMillis:5000,statement_timeout:8000});}
 return {query:async(sql:string,p?:unknown[])=>{const r=await pool!.query(sql,p);return {rows:r.rows,rowCount:r.rowCount||0};}};
}
export async function managedOwnerIdentity(subject:string){
 if(!/^[0-9a-f-]{36}$/i.test(subject))return null;
 const row=(await neonAuthDatabase().query('SELECT id,email,"emailVerified",banned FROM neon_auth."user" WHERE id::text=$1',[subject])).rows[0];
 return row&&!row.banned?{email:row.email as string,verified:row.emailVerified===true}:null;
}
