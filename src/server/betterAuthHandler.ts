import {getBetterAuthRuntime} from '../../services/shared/betterAuth';
import {betterAuthPilotConfig} from '../../services/shared/betterAuthPilot';
import {normalizeVercelUrl} from './vercelUrl';

/** Same-origin auth endpoint; native Better Auth handles CSRF, signed cookies,
 * password hashing, persistent throttling, email tokens and TOTP challenges. */
export function createBetterAuthHandler(runtime=getBetterAuthRuntime) {return async function betterAuthHandler(req:any,res:any) {
  res.setHeader('Cache-Control','no-store');
  if(process.env.AUTH_PROVIDER!=='better-auth')return res.status(404).json({error:'NOT_FOUND'});
  normalizeVercelUrl(req);
  const relative=new URL(req.originalUrl||req.url,'http://localhost');
  if(!relative.pathname.startsWith('/api/auth/')||!['GET','POST'].includes(req.method))return res.status(404).json({error:'NOT_FOUND'});
  try {
    const config=betterAuthPilotConfig();
    // Native CSRF checks focus on cookie-bearing requests. Also reject an
    // explicit foreign browser Origin on public email/sign-in endpoints.
    if(req.headers.origin && req.headers.origin!==config.baseUrl)return res.status(403).json({error:'INVALID_ORIGIN'});
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers)) {
      if(['host','content-length','connection','transfer-encoding'].includes(key))continue;
      if(typeof value==='string')headers.set(key,value);
    }
    // Never let a client choose its rate-limit identity. Only Vercel's platform
    // header, or the direct gateway socket address, supplies the client IP.
    const ip=process.env.VERCEL?String(req.headers['x-vercel-forwarded-for']||'unknown'):String(req.socket?.remoteAddress||'unknown');
    headers.set('x-forwarded-for',ip);headers.delete('x-real-ip');
    let body:Buffer|undefined;
    if(req.method==='POST') {
      if(req.body!==undefined)body=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
      else {
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>32768)return res.status(413).json({error:'BODY_TOO_LARGE'});chunks.push(Buffer.from(chunk));}
        body=Buffer.concat(chunks);
      }
      if(body && body.length>32768)return res.status(413).json({error:'BODY_TOO_LARGE'});
    }
    const request=new Request(config.baseUrl+relative.pathname+relative.search,{method:req.method,headers,body:body as any});
    const response=await runtime().auth.handler(request);
    const bytes=Buffer.from(await response.arrayBuffer());
    let pendingMfa=false;
    if(relative.pathname==='/api/auth/sign-in/email')try{pendingMfa=JSON.parse(bytes.toString()).twoFactorRedirect===true;}catch{/* native error response */}
    response.headers.forEach((value,key)=>{if(key!=='set-cookie' && !(pendingMfa&&key==='set-auth-token'))res.setHeader(key,value);});
    const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);
    return res.status(response.status).send(bytes);
  }catch{return res.status(503).json({error:'AUTH_UNAVAILABLE'});}
}

}
export default createBetterAuthHandler();
