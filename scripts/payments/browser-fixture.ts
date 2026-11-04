import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
import express from 'express';import {PGlite} from '@electric-sql/pglite';import {createServer as createVite} from 'vite';
import type {Db} from '../../services/shared/db';import {registerBillingRoutes} from '../../services/billing/routes';
import {ensureSubscription} from '../../services/billing/engine';import {SAAS_PLANS} from '../../src/config/saasPlans';import {pastikanPaket} from '../../services/billing/store';
import {generateDigest,generateSignature,DOKU_NOTIFICATION_PATH} from '../../api/_doku';
const pg=new PGlite(),owner=randomUUID(),tenant=randomUUID();
const wrap=(q:any):Db=>({query:async(s,p)=>{const r=await q.query(s,p);return{rows:r.rows,rowCount:r.affectedRows||r.rows.length};},exec:s=>q.exec(s),tx:f=>pg.transaction(t=>f(wrap(t))),close:()=>pg.close()});
const db=wrap(pg);await pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
for(const f of ['migrations/0001_compat.sql','schema.sql','schema_hybrid_pos.sql',...fs.readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)&&f!=='0001_compat.sql').sort().map(f=>'migrations/'+f)])await pg.exec(fs.readFileSync(f,'utf8'));
await pastikanPaket(db,SAAS_PLANS);await db.query("INSERT INTO internal.tenants(id,name,owner_user_ref) VALUES($1,'Synthetic QA',$2)",[tenant,owner]);await ensureSubscription(db,tenant);
await db.query("UPDATE billing.subscriptions SET plan_id='plan-plus-monthly',status='ACTIVE',has_used_trial=true WHERE tenant_id=$1",[tenant]);
let calls=0,inquiries=0,quoteUnavailable=false;const app=express();app.use(express.json({verify:(r:any,_s,b)=>{r.rawBody=b;}}));
app.use((req,res,next)=>{req.headers['x-auth-sub']=owner;if(quoteUnavailable&&req.path.endsWith('/prorated-upgrade'))return res.status(503).json({ok:false,error:'QUOTE_UNAVAILABLE'});next();});
process.env.DOKU_CHECKOUT_PILOT_TENANTS=tenant;process.env.DOKU_API_URL='https://api-sandbox.doku.com';process.env.DOKU_SUBSCRIPTION_PAYMENT_MODE='dynamic_qris_checkout';process.env.DOKU_PAYMENTS_ENABLED='1';process.env.DOKU_CLIENT_ID='MCH-browser-synthetic';process.env.DOKU_SECRET_KEY='synthetic-fixture';process.env.DOKU_ALLOWED_CHANNELS='QRIS';process.env.PUBLIC_APP_URL='https://fixture.test.invalid';
registerBillingRoutes(app,db,true,async payload=>{calls++;if(payload.payment.payment_method_types?.join(',')!=='QRIS')throw Error('CHANNEL_SCOPE_MISSING');return{paymentUrl:'https://sandbox.doku.com/checkout-link-v2/synthetic',rawResponse:{}};},async()=>{inquiries++;return{ok:false,status:'UNKNOWN'};});
app.get('/__fixture/metrics',async(_r,res)=>res.json({calls,inquiries,invoices:(await db.query('SELECT id FROM billing.invoices')).rowCount}));
app.post('/__fixture/quote-off',(_r,res)=>{quoteUnavailable=true;res.json({ok:true});});
app.post('/__fixture/legacy',async(_req,res)=>{
 const id=randomUUID(),number='NH-'+id;
 await db.query(`INSERT INTO billing.invoices(id,tenant_id,subscription_id,invoice_number,amount,currency,due_date,quote,payment_link_url)
 SELECT $1,tenant_id,subscription_id,$2,amount,currency,due_date,jsonb_set(quote,'{allowedChannels}','["QRIS","VIRTUAL_ACCOUNT_BCA"]'::jsonb),'https://sandbox.doku.com/legacy-mixed'
 FROM billing.invoices ORDER BY created_at DESC LIMIT 1`,[id,number]);
 await db.query(`UPDATE billing.invoices SET quote=jsonb_set(quote,'{revision}',to_jsonb((SELECT revision FROM billing.subscriptions WHERE tenant_id=$2))) WHERE id=$1`,[id,tenant]);res.json({id,invoiceNumber:number});
});
let base='';app.post('/__fixture/deliver',async(req,res)=>{
 const inv=(await db.query(`SELECT * FROM billing.invoices WHERE quote->'allowedChannels'='["QRIS"]'::jsonb AND payment_status='PENDING' ORDER BY created_at DESC LIMIT 1`)).rows[0];
 const raw=JSON.stringify({order:{invoice_number:inv.invoice_number,amount:Number(inv.amount),currency:'IDR'},transaction:{status:req.body?.expire?'ORDER_EXPIRED':'SUCCESS'},service:{id:'QRIS'},acquirer:{id:'DOKU'},channel:{id:'QRIS_DOKU'},emoney_payment:{approval_code:'synthetic-browser-approval'}}),event=randomUUID(),time=new Date().toISOString();
 const r=await fetch(base+DOKU_NOTIFICATION_PATH,{method:'POST',headers:{'content-type':'application/json','client-id':'MCH-browser-synthetic','request-id':event,'request-timestamp':time,signature:generateSignature('MCH-browser-synthetic',event,time,DOKU_NOTIFICATION_PATH,generateDigest(raw),'synthetic-fixture')},body:raw});res.status(r.status).json(await r.json());
});
app.use('/api',(_r,res)=>res.status(404).json({ok:false,error:'FIXTURE_NOT_IMPLEMENTED'}));
const mock=process.cwd()+'/build/qris/browser-context.ts';fs.writeFileSync(mock,`export function useAuth(){return {user:{id:${JSON.stringify(owner)}},session:{access_token:'synthetic-browser-session'}}}export function usePOSFields(){return {currentUser:{id:'synthetic-owner'},settings:{storeName:'Synthetic QA',subscription:{planId:'plan-plus-monthly',status:'ACTIVE',hasUsedTrial:true,billingCycle:'MONTHLY',extraOutlets:0,currentPeriodEnd:'2027-01-01T00:00:00Z'}},setActiveTab:()=>{},updateSettings:()=>{}}}`);
const server=createServer(app);const vite=await createVite({root:process.cwd(),envDir:'/private/tmp/no-newhope-qris-env',plugins:[{name:'synthetic-context',enforce:'pre',resolveId(source){if(/context\/(POSDomains|AuthContext)$/.test(source))return mock;}}],server:{middlewareMode:true,hmr:{server},watch:null},appType:'custom'});
app.use(vite.middlewares);app.use(async(req,res,next)=>{if(req.method!=='GET')return next();try{res.type('html').send(await vite.transformIndexHtml(req.originalUrl,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/payments/browser-entry.tsx"></script></body></html>'));}catch(e){next(e);}});
server.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));base='http://127.0.0.1:'+(server.address() as any).port;console.log('QRIS_FIXTURE='+base);
const stop=async()=>{await vite.close();await new Promise<void>(r=>server.close(()=>r()));await pg.close();process.exit();};process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
