import express from 'express';
import { connectDb } from '../services/shared/db';
import { registerBillingRoutes } from '../services/billing/routes';
import { registerAdminRoutes } from '../src/server/adminRoutes';
import { registerSyncRoutes } from '../services/pos/sync';
import { authenticateBearer } from '../services/shared/auth';
import { pastikanPaket } from '../services/billing/store';
import { SAAS_PLANS } from '../src/config/saasPlans';

async function buildRuntime() {
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL_NOT_CONFIGURED');
  const db=await connectDb({schema:'billing',max:2});
  await pastikanPaket(db,SAAS_PLANS);
  const app=express();
  app.use(express.json({limit:'10mb',verify:(req:any,_res,buf)=>{req.rawBody=buf;}}));
  registerBillingRoutes(app,db);
  registerAdminRoutes(app,async()=>db);
  registerSyncRoutes(app,db);
  app.get('/api/health',(_req,res)=>res.json({ok:true}));
  app.use((_req,res)=>res.status(404).json({ok:false,error:'NOT_FOUND'}));
  app.use((err:any,_req:any,res:any,_next:any)=>{
    if(_req.path==='/api/v1/webhooks/doku') {
      console.warn('[doku] NOTIFICATION_PARSER_OR_RUNTIME_ERROR');
      return res.status(err.type==='entity.parse.failed'?400:err.type==='entity.too.large'?413:500).json({ok:false,error:'NOTIFICATION_REQUEST_FAILED'});
    }
    console.error('[api]',err.message);res.status(500).json({ok:false,error:'SERVICE_UNAVAILABLE'});
  });
  return app;
}
import { normalizeVercelUrl } from '../src/server/vercelUrl';

/** Reject private requests before connecting/seeding the legacy runtime.
 * Only the app/DB promise is shared between requests; identity remains local.
 */
export function createNativeApiHandler(authenticate=authenticateBearer,build=buildRuntime) {
  let runtime:Promise<express.Express>|undefined;
  return async(req:any,res:any)=>{
    normalizeVercelUrl(req);
    res.setHeader('Cache-Control','no-store');
    for(const name of ['x-auth-sub','x-auth-email','x-auth-email-verified','x-internal-user','x-newhope-gateway-token']) delete req.headers[name];
    const path=String(req.url||'').split('?')[0];
    if(!['/api/v1/subscription/plans','/api/v1/webhooks/doku','/api/health'].includes(path)){
      let principal;
      try{principal=await authenticate(req);}catch{return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});}
      if(!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
      req.headers['x-auth-sub']=principal.subject;
      if(principal.email) req.headers['x-auth-email']=principal.email;
    }
    try{
      runtime ??= build().catch(err=>{runtime=undefined;throw err;});
      const app=await runtime;
      app(req,res);
    }catch{res.status(503).json({ok:false,error:'DATABASE_UNAVAILABLE'});}
  };
}

export const handleNativeApi=createNativeApiHandler();
