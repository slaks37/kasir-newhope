import express from 'express';
import { authenticateBearer } from '../../services/shared/auth';
import { connectDb } from '../../services/shared/db';
import { registerBillingRoutes } from '../../services/billing/routes';
import { normalizeVercelUrl } from './vercelUrl';

const methods = new Map([
  ['/api/v1/subscription/outlets', ['GET', 'POST']],
  ['/api/v1/subscription/status', ['GET']],
  ['/api/v1/subscription/start-trial', ['POST']],
]);

/** Native Vercel entry uses exactly the tested billing service and verified owner. */
export function createOutletBillingHandler(authenticate = authenticateBearer, connect = () => connectDb({schema:'billing',max:2})) {
  let runtime: Promise<express.Express> | undefined;
  return async (req:any,res:any) => {
    normalizeVercelUrl(req);
    res.setHeader('Cache-Control','no-store');
    const path=String(req.url || '').split('?')[0].replace(/\/+$/,'');
    if (!methods.has(path)) return res.status(404).json({ok:false,error:'NOT_FOUND'});
    if (!methods.get(path)!.includes(req.method)) return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const principal=await authenticate(req);
    if (!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    for (const key of ['x-auth-sub','x-auth-email','x-internal-user','x-newhope-gateway-token']) delete req.headers[key];
    req.headers['x-auth-sub']=principal.subject;
    if (principal.email) req.headers['x-auth-email']=principal.email;
    try {
      runtime ??= connect().then(db=>{
        const app=express();
        const parse=express.json({limit:'32kb'});
        app.use((req,res,next)=>req.body!==undefined?next():parse(req,res,next));
        registerBillingRoutes(app,db,true);
        app.use((_req,res)=>res.status(404).json({ok:false,error:'NOT_FOUND'}));
        app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.type==='entity.too.large'?413:400).json({ok:false,error:'INVALID_REQUEST'}));
        return app;
      }).catch(error=>{runtime=undefined;throw error;});
      (await runtime)(req,res);
    } catch { return res.status(503).json({ok:false,error:'BILLING_UNAVAILABLE'}); }
  };
}

export default createOutletBillingHandler();
