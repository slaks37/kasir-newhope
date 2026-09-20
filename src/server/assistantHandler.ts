import express from 'express';
import { authenticateBearer } from '../../services/shared/auth';
import { connectDb } from '../../services/shared/db';
import { registerAssistantRoutes } from '../../services/ai/routes';

const methods: Record<string,string> = {
  '/api/v1/assistant/query':'POST', '/api/v1/assistant/credits':'GET',
  '/api/v1/assistant/quick-chips':'GET', '/api/v1/assistant/audit':'GET',
  '/api/v1/assistant/group':'GET',
  '/api/v1/assistant/daily-brief':'GET',
};
/** Same verified-session boundary as sync. No unauthenticated cron or top-up. */
export function createAssistantHandler(authenticate=authenticateBearer, connect=()=>connectDb({schema:'ai',max:2})) {
  let runtime: Promise<express.Express>|undefined;
  return async (req:any,res:any) => {
    res.setHeader('Cache-Control','no-store');
    const path=String(req.url||'').split('?')[0].replace(/\/+$/,'');
    if(!methods[path])return res.status(404).json({ok:false,error:'NOT_FOUND'});
    if(req.method!==methods[path])return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    const principal=await authenticate(req);
    if(!principal||principal.subject==='local-development')return res.status(401).json({ok:false,error:'AUTHENTICATION_REQUIRED'});
    for(const key of ['x-auth-sub','x-auth-email','x-internal-user','x-newhope-gateway-token'])delete req.headers[key];
    req.headers['x-auth-sub']=principal.subject;
    if(principal.email)req.headers['x-auth-email']=principal.email;
    try {
      runtime??=connect().then(db=>{
        const app=express(); const parse=express.json({limit:'2mb'});
        app.use((req,res,next)=>req.body!==undefined?next():parse(req,res,next));
        registerAssistantRoutes(app,db);
        app.use((_req,res)=>res.status(404).json({ok:false,error:'NOT_FOUND'}));
        app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.type==='entity.too.large'?413:500).json({ok:false,error:'ASSISTANT_UNAVAILABLE'}));
        return app;
      }).catch(error=>{runtime=undefined;throw error;});
      (await runtime)(req,res);
    } catch { return res.status(503).json({ok:false,error:'ASSISTANT_UNAVAILABLE'}); }
  };
}
export default createAssistantHandler();
