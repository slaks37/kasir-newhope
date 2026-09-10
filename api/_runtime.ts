import express from 'express';
import { connectDb } from '../services/shared/db';
import { registerBillingRoutes } from '../services/billing/routes';
import { registerAdminRoutes } from '../src/server/adminRoutes';
import { registerSyncRoutes } from '../services/pos/sync';
import { authenticateBearer } from '../services/shared/auth';
import { pastikanPaket } from '../services/billing/store';
import { SAAS_PLANS } from '../src/config/saasPlans';

let runtime:Promise<express.Express>|undefined;
async function buildRuntime() {
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL_NOT_CONFIGURED');
  const db=await connectDb({schema:'billing',max:2});
  await pastikanPaket(db,SAAS_PLANS);
  const app=express();
  app.use(express.json({limit:'10mb',verify:(req:any,_res,buf)=>{req.rawBody=buf;}}));
  app.use(async(req,res,next)=>{
    try{
      for(const name of ['x-auth-sub','x-auth-email','x-internal-user','x-newhope-gateway-token']) delete req.headers[name];
      if(!['/api/v1/subscription/plans','/api/v1/webhooks/doku','/api/health'].includes(req.path)){
        const principal=await authenticateBearer(req);
        if(!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
        req.headers['x-auth-sub']=principal.subject;
        if(principal.email) req.headers['x-auth-email']=principal.email;
      }
      next();
    }catch(err){next(err);}
  });
  registerBillingRoutes(app,db);
  registerAdminRoutes(app,async()=>db);
  registerSyncRoutes(app,db);
  app.get('/api/health',(_req,res)=>res.json({ok:true}));
  app.use((_req,res)=>res.status(404).json({ok:false,error:'NOT_FOUND'}));
  app.use((err:any,_req:any,res:any,_next:any)=>{
    console.error('[api]',err.message);res.status(500).json({ok:false,error:'SERVICE_UNAVAILABLE'});
  });
  return app;
}
export async function handleNativeApi(req:any,res:any) {
  try{
    runtime ??= buildRuntime().catch(err=>{runtime=undefined;throw err;});
    const app=await runtime;
    app(req,res);
  }catch{res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});}
}
