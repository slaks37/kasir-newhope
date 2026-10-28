import {getBetterAuthRuntime} from '../../services/shared/betterAuth';
import {authProvider,getAuthConfig} from '../../services/shared/betterAuthConfig';
import {resolveNeonSession,NeonIdentityError} from '../../services/shared/betterAuthPrincipal';
import {sealAuthState,openAuthState} from '../../services/shared/nativeAuthState';
import {normalizeVercelUrl} from './vercelUrl';
import {handleNativeAuth} from './nativeAuthRoutes';
const pendingCookie=/^(?:__Secure-)?better-auth\.two_factor=/;
export function createNeonAuthHandler(runtime=getBetterAuthRuntime){return async(req:any,res:any)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(authProvider()!=='neon')return res.status(404).json({error:'NOT_FOUND'});
 normalizeVercelUrl(req);
 try{
  const config=getAuthConfig(),url=new URL(req.originalUrl||req.url,config.baseUrl),path=url.pathname;
  if(!path.startsWith('/api/auth/')||!['GET','POST','OPTIONS'].includes(req.method))return res.status(404).json({error:'NOT_FOUND'});
  const origin=String(req.headers.origin||''),native=['capacitor://localhost','https://localhost'].includes(origin);
  if(origin&&!(native?config.nativeOrigins:config.allowedOrigins).includes(origin))return res.status(403).json({error:'AUTH_ORIGIN_REJECTED'});
  if(native){
   const requested=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
   if(requested.some(h=>!['authorization','content-type','x-newhope-auth-state'].includes(h)))return res.status(403).json({error:'AUTH_CORS_REJECTED'});
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Newhope-Auth-State');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Expose-Headers','set-auth-token, X-Newhope-Auth-State');
  }
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method==='POST'&&!origin)return res.status(403).json({error:'AUTH_ORIGIN_REQUIRED'});
  // Never let upstream route normalization bypass the excluded API surfaces.
  if(path.includes('%')||path.includes('//')||path.endsWith('/'))return res.status(404).json({error:'NOT_FOUND'});
  // Provider credentials and alternate identity linking are not app workflows.
  if(['/api/auth/get-access-token','/api/auth/refresh-token','/api/auth/account-info','/api/auth/link-social','/api/auth/unlink-account'].includes(path))return res.status(404).json({error:'NOT_FOUND'});
  const r=runtime();await r.ready;
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(typeof v==='string'&&!['host','content-length','connection','transfer-encoding','x-auth-sub','x-auth-email','x-auth-aal','x-real-ip','x-forwarded-for'].includes(k))headers.set(k,v);}
  // An explicit bearer must never fall back to a different cookie principal.
  // Native MFA may add only its separately sealed pending challenge below.
  if(headers.has('authorization'))headers.delete('cookie');
  headers.set('x-forwarded-for',process.env.VERCEL?String(req.headers['x-vercel-forwarded-for']||'unknown'):String(req.socket?.remoteAddress||'unknown'));
  if(native){headers.delete('cookie');headers.set('origin',config.baseUrl);const state=req.headers['x-newhope-auth-state'];if(state){const cookies=openAuthState(String(state),config.secret,'native-pending:'+config.baseUrl+':'+origin);if(typeof cookies!=='string'||!cookies.split('; ').every(c=>pendingCookie.test(c)))return res.status(400).json({error:'AUTH_STATE_REJECTED'});headers.set('cookie',cookies);}}
  let bytes:Buffer|undefined;
  if(req.method==='POST'){
   if(req.body!==undefined)bytes=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
   else{const chunks:Buffer[]=[];let count=0;for await(const chunk of req){count+=chunk.length;if(count>32768)return res.status(413).json({error:'BODY_TOO_LARGE'});chunks.push(Buffer.from(chunk));}bytes=Buffer.concat(chunks);}
   if(bytes&&bytes.length>32768)return res.status(413).json({error:'BODY_TOO_LARGE'});
  }
  if(path.startsWith('/api/auth/native/'))return await handleNativeAuth({req,res,url,headers,bytes,runtime:r,config});
  if(path==='/api/auth/identity'){
   if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
   const verified=await resolveNeonSession(headers,{enroll:true},r);if(!verified)return res.status(401).json({error:'AUTH_SESSION_REQUIRED'});
   const {session,principal,refreshHeaders}=verified;
   if(native){const token=refreshHeaders.get('set-auth-token');if(token)res.setHeader('set-auth-token',token);}else{const cookies=refreshHeaders.getSetCookie();if(cookies.length)res.setHeader('set-cookie',cookies);}
   const accounts=(await r.pool.query('SELECT "providerId",password IS NOT NULL AS credential FROM newhope_auth.account WHERE "userId"=$1',[session.user.id])).rows;
   return res.json({user:{id:principal.subject,email:principal.email,emailVerified:true,twoFactorEnabled:session.user.twoFactorEnabled===true,passwordCredential:accounts.some(a=>a.providerId==='credential'&&a.credential),providers:accounts.map(a=>a.providerId),user_metadata:{...(session.user.onboarding as object||{}),full_name:session.user.name}},session:{id:session.session.id,expiresAt:session.session.expiresAt,aal:principal.aal,mfaVerifiedAt:principal.mfaVerifiedAt}});
  }
  const response=await r.auth.handler(new Request(config.baseUrl+path+url.search,{method:req.method,headers,body:bytes as any}));
  const result=Buffer.from(await response.arrayBuffer());let pending=false;try{pending=JSON.parse(result.toString()).twoFactorRedirect===true;}catch{/* HTML/redirect response */}
  response.headers.forEach((v,k)=>{if(!['set-cookie','set-auth-token','access-control-expose-headers'].includes(k))res.setHeader(k,v);});
  const cookies=response.headers.getSetCookie();
  if(native){const token=response.headers.get('set-auth-token');if(token&&!pending)res.setHeader('set-auth-token',token);const challenge=cookies.map(c=>c.split(';')[0]).filter(c=>pendingCookie.test(c));if(challenge.length)res.setHeader('X-Newhope-Auth-State',sealAuthState(challenge.join('; '),config.secret,'native-pending:'+config.baseUrl+':'+origin));}
  else if(cookies.length)res.setHeader('set-cookie',cookies);
  return res.status(response.status).send(result);
 }catch(error){
  if(error instanceof NeonIdentityError)return res.status(error.code==='MFA_REQUIRED'?401:403).json({error:error.code});
  return res.status(503).json({error:'AUTH_UNAVAILABLE'});
 }
};}
export default createNeonAuthHandler();
