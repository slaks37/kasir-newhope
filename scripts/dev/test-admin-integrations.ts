// Isolated synthetic data. No external providers, emails or real connections.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import type { Db } from '../../services/shared/db';
import { registerAdminRoutes } from '../../src/server/adminRoutes';
import { createMcpHandler } from '../../src/server/mcpHandler';
import { integrationProviders } from '../../src/server/adminIntegrations';
import { mcpAdminSettings } from '../../services/mcp/settings';
const pg=new PGlite();
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows??r.rows.length};},exec:sql=>runner.exec(sql),tx:fn=>pg.transaction(tx=>fn(wrap(tx))),close:()=>pg.close()});
const db=wrap(pg);
let server:ReturnType<express.Express['listen']>|undefined;
try{
  process.env.MCP_ENABLED='true';process.env.MCP_PUBLIC_ORIGIN='https://kasir.newhope.space';
  await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
  for(const file of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql'&&f!=='0058_admin_integrations.sql').sort().map(f=>'migrations/'+f)])await pg.exec(fs.readFileSync(file,'utf8'));
  assert.equal((await mcpAdminSettings(db)).available,false,'Before rollout, absent settings preserve existing behavior');
  await pg.exec(fs.readFileSync('migrations/0058_admin_integrations.sql','utf8'));
  await pg.exec(fs.readFileSync('migrations/0058_admin_integrations.sql','utf8'));
  assert.equal(fs.readFileSync('migrations/0058_admin_integrations.sql','utf8'),fs.readFileSync('supabase/migrations/20261005013557_admin_integrations.sql','utf8'));
  await pg.exec(fs.readFileSync('supabase/migrations/20260928135919_mcp_readonly_connections.sql','utf8'));
  for(const [id,role] of [['super','ROLE_SUPERADMIN'],['support','ROLE_INTERNAL_SUPPORT'],['growth','ROLE_INTERNAL_GROWTH']]){
    await db.query('INSERT INTO internal.internal_users(id,email,full_name,role,sso_subject) VALUES($1,$2,$3,$4,$3)',[randomUUID(),id+'@test.invalid',id,role]);
  }
  const connection=randomUUID();
  await db.query("INSERT INTO mcp_private.connections(id,owner_ref,business_id,client_id,resource) VALUES($1,'synthetic-owner','synthetic-business','claude','https://kasir.newhope.space/api/mcp')",[connection]);
  await db.query("INSERT INTO mcp_private.credentials(hash,connection_id,kind,expires_at) VALUES('secret-hash-must-not-leak',$1,'access',now()+interval '1 hour')",[connection]);
  const app=express();app.use(express.json());
  registerAdminRoutes(app,async()=>db,async req=>{
    const token=req.headers.authorization?.replace('Bearer ','');
    if(!token)return null;
    return {subject:token==='aal1'||token==='stale'?'super':token,aal:token==='aal1'?'aal1':'aal2',mfaVerifiedAt:Math.floor(Date.now()/1000)-(token==='stale'?1000:0)};
  });
  const mcp=createMcpHandler(async()=>db,async()=>null);
  app.use('/api/mcp',(req,res)=>{req.url='/api/mcp'+req.url;void mcp(req,res);});
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(500).json({error:err.message}));
  server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  async function call(path:string,token?:string,body?:any,method='GET'){
    const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,body:await r.json(),headers:r.headers};
  }
  const path='/api/admin/integrations';
  assert.equal((await call(path)).status,401);
  for(const token of ['support','growth','aal1'])assert.equal((await call(path,token)).status,403);
  const inventory=await call(path,'super');
  assert.equal(inventory.status,200);assert.equal(inventory.body.mcp.scope,'pos:read');
  assert.equal(inventory.body.connections[0].connected,true);assert.equal(inventory.headers.get('cache-control'),'no-store');
  assert.ok(!JSON.stringify(inventory.body).includes('secret-hash-must-not-leak'));
  assert.ok(!JSON.stringify(integrationProviders({RESEND_API_KEY:'private-key'})).includes('private-key'));
  assert.equal((await call(path+'/mcp','stale',{enabled:false,reason:'Test pause'},'PUT')).status,403);
  assert.equal((await call(path+'/mcp','super',{enabled:false},'PUT')).status,400);
  assert.equal((await call('/api/mcp')).status,401);
  const pause=await call(path+'/mcp','super',{enabled:false,reason:'Synthetic maintenance',expectedUpdatedAt:null},'PUT');
  assert.equal(pause.status,200);
  assert.equal((await mcpAdminSettings(db)).enabled,false);
  assert.equal((await call('/api/mcp')).body.error,'MCP_PAUSED_BY_ADMIN','Already-initialized MCP worker observes shared switch');
  assert.equal((await call(path+'/mcp','super',{enabled:true,reason:'Stale version',expectedUpdatedAt:null},'PUT')).status,409);
  const version=(await call(path,'super')).body.mcp.updatedAt;
  process.env.MCP_ENABLED='false';
  assert.equal((await call(path+'/mcp','super',{enabled:true,reason:'Blocked deployment',expectedUpdatedAt:version},'PUT')).status,409);
  process.env.MCP_ENABLED='true';
  assert.equal((await call(path+'/mcp','super',{enabled:true,reason:'Synthetic resume',expectedUpdatedAt:version},'PUT')).status,200);
  assert.equal((await call('/api/mcp')).status,401);
  for(let n=0;n<2;n++)assert.equal((await call(path+'/mcp/connections/'+connection+'/revoke','super',{reason:'Synthetic revocation'},'POST')).status,200);
  assert.equal(Number((await db.query("SELECT count(*) FROM mcp_private.audit WHERE event='admin_revoked'")).rows[0].count),1);
  assert.equal((await call(path,'super')).body.connections[0].revoked_at!==null,true);
  assert.equal((await call(path+'/mcp/connections/not-an-id/revoke','super',{reason:'Invalid ID'},'POST')).status,400);
  const grant=(await db.query("SELECT has_table_privilege('anon','internal.platform_integrations','SELECT') AS allowed")).rows[0];
  assert.equal(grant.allowed,false);
  console.log('PASS: admin integration RBAC/MFA, secret redaction, shared MCP pause, optimistic updates, idempotent revocation and browser grants');
}finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await pg.close();}
