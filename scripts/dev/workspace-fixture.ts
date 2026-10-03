/** Loopback-only browser acceptance fixture. Fresh in-memory PostgreSQL;
 * no env loading, remote calls, real credentials or payment providers. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {PGlite} from '@electric-sql/pglite';
import {createServer as createViteServer} from 'vite';
import type {Db} from '../../services/shared/db';
import {registerSyncRoutes} from '../../services/pos/sync';
import {registerBillingRoutes} from '../../services/billing/routes';
import {ensureSubscription} from '../../services/billing/engine';
import {pastikanPaket} from '../../services/billing/store';
import {SAAS_PLANS} from '../../src/config/saasPlans';

const pg=new PGlite(),owner=randomUUID(),tenant=randomUUID(),businessA=randomUUID(),businessB=randomUUID(),outletA=randomUUID(),outletB=randomUUID();
const wrap=(runner:any):Db=>({query:async(sql,params)=>{const r=await runner.query(sql,params);return {rows:r.rows,rowCount:r.rows.length||r.affectedRows||0};},exec:async sql=>{await runner.exec(sql);},tx:async fn=>pg.transaction(c=>fn(wrap(c))),close:()=>pg.close()});
const db=wrap(pg);
await pg.exec('CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;');
const files=['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)];
for(const file of files)await pg.exec(fs.readFileSync(file,'utf8'));
await pg.exec(fs.readFileSync('docs/security/free-plan-selection.sql','utf8'));
for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_business_scoped_operational_state.sql')).sort())await pg.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
await pastikanPaket(db,SAAS_PLANS);
await db.query("INSERT INTO internal.users(id,email,full_name) VALUES($1,'fixture@localhost.invalid','Fixture Owner')",[owner]);
await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref,owner_user_id) VALUES($1,'Browser fixture',$2::text,$2::uuid)",[tenant,owner]);
await db.query("INSERT INTO internal.merchants(id,tenant_id,name,business_sector,external_ref) VALUES($1,$3,'Laundry Alpha','LAUNDRY',$4),($2,$3,'Laundry Beta','LAUNDRY',$5)",[businessA,businessB,tenant,owner+'_LAUNDRY',owner+'_business_'+randomUUID()]);
await db.query("INSERT INTO internal.outlets(id,tenant_id,merchant_id,name) VALUES($1,$3,$4,'BSD Alpha'),($2,$3,$5,'Serpong Beta')",[outletA,outletB,tenant,businessA,businessB]);
await ensureSubscription(db,tenant);
const records=new Map<string,unknown[]>();
const nativeFetch=globalThis.fetch;
globalThis.fetch=((input:any,init?:RequestInit)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(u.hostname))throw Error('FIXTURE_REMOTE_FETCH_DENIED');return nativeFetch(input,init);}) as typeof fetch;
const servers:any[]=[];
for(const device of ['A','B']){
  const app=express(),metrics:Array<{method:string;path:string;ms:number;bytes:number;status:number}>=[];
  app.use(express.json());
  app.use((req,res,next)=>{if(req.path.startsWith('/api/')){const start=performance.now();let bytes=0;const write=res.write.bind(res),end=res.end.bind(res);res.write=((chunk:any,...args:any[])=>{if(chunk)bytes+=Buffer.byteLength(chunk);return (write as any)(chunk,...args);}) as any;res.end=((chunk:any,...args:any[])=>{if(chunk)bytes+=Buffer.byteLength(chunk);return (end as any)(chunk,...args);}) as any;res.once('finish',()=>metrics.push({method:req.method,path:req.originalUrl,ms:performance.now()-start,bytes,status:res.statusCode}));}req.headers['x-auth-sub']=owner;next();});
  app.get('/__fixture/metrics',(_req,res)=>res.json({device,requests:metrics,ids:{owner,tenant,businessA,businessB,outletA,outletB}}));
  app.post('/__fixture/reset',(_req,res)=>{metrics.length=0;res.json({ok:true});});
  app.post('/__fixture/browser-metrics',(req,res)=>{records.set(device,req.body);console.log('BROWSER_METRICS',device,JSON.stringify(req.body));res.json({ok:true});});
  registerBillingRoutes(app,db,true,async()=>{throw Error('FIXTURE_PAYMENTS_DISABLED');});
  registerSyncRoutes(app,db);
  app.use('/api',(_req,res)=>res.status(404).json({ok:false,error:'FIXTURE_API_NOT_IMPLEMENTED'}));
  const session={user:{id:owner,email:'fixture@localhost.invalid',role:'authenticated',created_at:new Date().toISOString(),user_metadata:{full_name:'Fixture Owner',store_name:'Laundry Alpha',business_sector:'LAUNDRY'},app_metadata:{provider:'email'}},session:{access_token:'fixture-only',expires_at:Math.floor(Date.now()/1000)+3600}};
  const seed=`if(!localStorage.getItem('nhpos_local_session')){localStorage.setItem('nhpos_local_session',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('newhope_workspace_selection_v1_${owner}',${JSON.stringify(JSON.stringify({businessId:businessA,outletId:outletA}))});}`;
  const vite=await createViteServer({root:process.cwd(),envDir:path.join('/private/tmp','newhope-fixture-no-env'),define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(''),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('')},server:{middlewareMode:true,hmr:false,watch:null},appType:'custom'});
  app.use(vite.middlewares);
  app.use(async(req,res,next)=>{if(req.method!=='GET')return next();try{
    const html=await vite.transformIndexHtml(req.originalUrl,`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>POS isolated fixture ${device}</title></head><body><div id="root"></div><script>${seed}</script><script type="module" src="/scripts/dev/workspace-fixture-entry.tsx"></script></body></html>`);
    res.type('html').send(html);
  }catch(error){next(error);}});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));servers.push({server,vite});
  console.log(`FIXTURE_${device}=http://127.0.0.1:${(server.address() as any).port}/pos`);
}
// Same product ID, different merchant projection. Use the actual HTTP sync API.
const origin='http://127.0.0.1:'+(servers[0].server.address() as any).port;
for(const [businessId,outletId,name] of [[businessA,outletA,'Laundry Alpha Wash'],[businessB,outletB,'Laundry Beta Wash']]){
  const r=await fetch(origin+'/api/v1/sync/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sector:'LAUNDRY',businessId,outletId,operations:[
    {kind:'categories',recordId:'cat-test',baseRevision:0,deleted:false,value:{id:'cat-test',name:'Layanan'}},
    {kind:'products',recordId:'same-product',baseRevision:0,deleted:false,value:{id:'same-product',name,price:10000,costPrice:3000,stock:100,categoryId:'cat-test',type:'SERVICE',unit:'pcs',isAvailable:true}},
  ]})});if(!r.ok)throw Error(await r.text());
}
console.log('FIXTURE_READY — isolated data only; stop with Ctrl-C.');
const stop=async()=>{for(const {server,vite} of servers){await new Promise<void>(resolve=>server.close(()=>resolve()));await vite.close();}await pg.close();process.exit(0);};
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
