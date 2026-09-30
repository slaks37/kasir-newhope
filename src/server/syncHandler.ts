import express from 'express';
import { authenticateBearer } from '../../services/shared/auth';
import { connectDb } from '../../services/shared/db';
import { registerSyncRoutes } from '../../services/pos/sync';
import { normalizeVercelUrl } from './vercelUrl';

const allowedMethods: Record<string, readonly string[]> = {
  '/api/v1/sync/business': ['POST'],
  '/api/v1/sync/catalog': ['GET', 'POST'],
  '/api/v1/sync/transactions': ['POST'],
  '/api/v1/sync/activity': ['POST'],
  '/api/v1/sync/customers': ['POST'],
  '/api/v1/sync/attendance': ['POST'],
  '/api/v1/sync/payroll': ['POST'],
  '/api/v1/sync/receipt-logo': ['GET', 'PUT'],
};

/** POS-only runtime. No admin, billing, webhook or anonymous routes mounted. */
export function createSyncHandler(
  authenticate=authenticateBearer,
  connect=()=>connectDb({schema:'pos',max:2}),
) {
  let runtime:Promise<express.Express>|undefined;
  return async (req:any,res:any)=>{
    normalizeVercelUrl(req);
    res.setHeader('Cache-Control','no-store');
    const path=String(req.url||'').split('?')[0].replace(/\/+$/,'');
    if(!Object.hasOwn(allowedMethods,path)) return res.status(404).json({ok:false,error:'NOT_FOUND'});
    if(!allowedMethods[path].includes(req.method)) return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const principal=await authenticate(req);
    if(!principal || principal.subject==='local-development') return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    // Never trust browser-supplied gateway or principal headers.
    for(const key of ['x-auth-sub','x-auth-email','x-internal-user','x-newhope-gateway-token']) delete req.headers[key];
    req.headers['x-auth-sub']=principal.subject;
    if(principal.email) req.headers['x-auth-email']=principal.email;
    try {
      runtime ??= connect().then(db=>{
        const app=express();
        const parseJson=express.json({limit:'10mb'});
        // Vercel may already have parsed the body; never reread a consumed stream.
        app.use((req,res,next)=>req.body!==undefined?next():parseJson(req,res,next));
        registerSyncRoutes(app,db);
        app.use((_req,res)=>res.status(404).json({ok:false,error:'NOT_FOUND'}));
        app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.type==='entity.too.large'?413:400).json({ok:false,error:'INVALID_SYNC_REQUEST'}));
        return app;
      }).catch(error=>{runtime=undefined;throw error;});
      (await runtime)(req,res);
    } catch { return res.status(503).json({ok:false,error:'SYNC_UNAVAILABLE'}); }
  };
}

export default createSyncHandler();
