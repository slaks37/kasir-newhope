import { handleNativeApi } from './_runtime';

// When an external gateway is configured, an outage must never switch to a
// synthetic or independently mutable billing backend.
export async function proxyToGateway(req:any,res:any):Promise<void>{
  const base=(process.env.GATEWAY_URL || '').replace(/\/$/,'');
  if(base){
    try{
      if(new URL(base).host===req.headers.host) return void res.status(503).json({ok:false,error:'GATEWAY_SELF_REFERENCE'});
      const headers={...req.headers};
      for(const key of ['host','connection','content-length','transfer-encoding','x-auth-sub','x-auth-email','x-internal-user','x-newhope-gateway-token']) delete headers[key];
      const isDoku=req.url?.split('?')[0]==='/api/v1/webhooks/doku';
      if(isDoku && req.rawBody===undefined && req.body!==undefined)return void res.status(400).json({ok:false,error:'RAW_BODY_REQUIRED'});
      let body=req.rawBody ?? (req.body===undefined ? undefined : JSON.stringify(req.body));
      if(req.url?.split('?')[0]==='/api/v1/webhooks/doku' && body===undefined){
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>1048576) return void res.status(413).end();chunks.push(bytes);}
        body=Buffer.concat(chunks);
      }
      const response=await fetch(base+req.url,{method:req.method,headers,
        body:['GET','HEAD'].includes(req.method)?undefined:body,signal:AbortSignal.timeout(35000)});
      res.status(response.status);res.setHeader('Content-Type',response.headers.get('content-type') || 'application/json');
      for(const name of ['cache-control','x-request-id']) {
        const value=response.headers.get(name);if(value)res.setHeader(name,value);
      }
      res.send(Buffer.from(await response.arrayBuffer()));
    }catch{res.status(503).json({ok:false,error:'GATEWAY_UNAVAILABLE'});}
    return;
  }
  await handleNativeApi(req,res);
}
