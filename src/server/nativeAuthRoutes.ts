import {createHash,randomBytes} from 'node:crypto';
import {resolveNeonSession,NeonIdentityError} from '../../services/shared/betterAuthPrincipal';
import {sealAuthState,openAuthState} from '../../services/shared/nativeAuthState';
import type {getBetterAuthRuntime} from '../../services/shared/betterAuth';
import type {getAuthConfig} from '../../services/shared/betterAuthConfig';
const digest=(v:string)=>createHash('sha256').update(v).digest('base64url');
const callback='space.newhope.kasir://auth/callback';
type Context={req:any;res:any;url:URL;headers:Headers;bytes?:Buffer;runtime:ReturnType<typeof getBetterAuthRuntime>;config:ReturnType<typeof getAuthConfig>};
async function throttle(c:Context){
 const now=Date.now(),key='native:'+digest((c.headers.get('x-forwarded-for')||'unknown')+c.url.pathname),r=await c.runtime.pool.query(`INSERT INTO newhope_auth."rateLimit"(id,key,count,"lastRequest") VALUES($1,$1,1,$2)
 ON CONFLICT(key) DO UPDATE SET count=CASE WHEN newhope_auth."rateLimit"."lastRequest"<$2-60000 THEN 1 ELSE newhope_auth."rateLimit".count+1 END,"lastRequest"=CASE WHEN newhope_auth."rateLimit"."lastRequest"<$2-60000 THEN $2 ELSE newhope_auth."rateLimit"."lastRequest" END RETURNING count`,[key,now]);return Number(r.rows[0]?.count)<=20;
}
function cookies(response:Response,res:any){const values=response.headers.getSetCookie();if(values.length)res.setHeader('Set-Cookie',values);}
function html(res:any,body:string,status=200){res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");res.setHeader('Content-Type','text/html; charset=utf-8');return res.status(status).send('<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>New Hope Login</title><body><main>'+body+'</main></body></html>');}
export async function handleNativeAuth(c:Context){
 const {req,res,url,headers,runtime:r,config}=c,path=url.pathname;
 if(!await throttle(c)){res.setHeader('Retry-After','60');return res.status(429).json({error:'AUTH_RATE_LIMITED'});}
 if(path==='/api/auth/native/start'&&req.method==='GET'){
  const challenge=url.searchParams.get('challenge');if(url.searchParams.size!==1||!challenge||!/^[-_A-Za-z0-9]{43}$/.test(challenge))return res.status(400).json({error:'PKCE_REQUIRED'});
  if(!config.google)return res.status(503).json({error:'GOOGLE_AUTH_NOT_CONFIGURED'});
  const transaction=randomBytes(32).toString('base64url');
  await r.pool.query("INSERT INTO newhope_auth.native_transactions(id,challenge,expires_at) VALUES($1,$2,now()+interval '5 minutes')",[transaction,challenge]);
  const response=await r.auth.handler(new Request(config.baseUrl+'/api/auth/sign-in/social',{method:'POST',headers:{origin:config.baseUrl,'content-type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:config.baseUrl+'/api/auth/native/complete?transaction='+transaction,disableRedirect:true})}));
  if(!response.ok)return res.status(503).json({error:'GOOGLE_AUTH_UNAVAILABLE'});const data=await response.json();let target:URL;try{target=new URL(data.url);if(target.protocol!=='https:'||target.hostname!=='accounts.google.com'||target.searchParams.get('redirect_uri')!==config.baseUrl+'/api/auth/callback/google')throw Error();}catch{return res.status(503).json({error:'GOOGLE_AUTH_URL_REJECTED'});}
  cookies(response,res);return res.redirect(303,target.href);
 }
 if(path==='/api/auth/native/complete'&&['GET','POST'].includes(req.method)){
  const transaction=url.searchParams.get('transaction');if(!transaction||!/^[-_A-Za-z0-9]{43}$/.test(transaction)||url.searchParams.size!==1)return res.status(400).json({error:'NATIVE_TRANSACTION_REJECTED'});
  const tx=(await r.pool.query('SELECT id FROM newhope_auth.native_transactions WHERE id=$1 AND completed_at IS NULL AND expires_at>now()',[transaction])).rows[0];if(!tx)return res.status(410).json({error:'NATIVE_TRANSACTION_EXPIRED'});
  if(req.method==='POST'){
   if(String(req.headers.origin||'')!==config.baseUrl)return res.status(403).json({error:'AUTH_ORIGIN_REJECTED'});
   let code='';try{code=headers.get('content-type')?.startsWith('application/json')?JSON.parse(c.bytes?.toString()||'{}').code:new URLSearchParams(c.bytes?.toString()).get('code')||'';}catch{/* rejected below */}
   if(!/^\d{6}$/.test(code))return html(res,'<h1>Kode autentikator tidak valid</h1>',400);
   const response=await r.auth.handler(new Request(config.baseUrl+'/api/auth/two-factor/verify-totp',{method:'POST',headers:new Headers({...Object.fromEntries(headers),'content-type':'application/json'}),body:JSON.stringify({code,trustDevice:false})}));
   cookies(response,res);if(!response.ok)return html(res,'<h1>Verifikasi belum berhasil</h1><p>Kembali dan coba kode autentikator terbaru.</p>',401);return res.redirect(303,url.pathname+url.search);
  }
  let verified;try{verified=await resolveNeonSession(headers,{enroll:true},r);}catch(e){if(e instanceof NeonIdentityError&&e.code==='MFA_REQUIRED')return html(res,`<h1>Verifikasi autentikator</h1><form method="post" action="/api/auth/native/complete?transaction=${transaction}"><label>Kode 6 digit <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><button>Verifikasi dan kembali ke aplikasi</button></form>`);throw e;}
  if(!verified)return html(res,'<h1>Sesi tidak tersedia</h1><p>Mulai kembali login dari aplikasi New Hope.</p>',401);
  const context=await r.auth.$context,name=context.authCookies.sessionToken.name;
  const token=(headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);if(!token)return res.status(401).json({error:'NATIVE_SESSION_REQUIRED'});
  const code=randomBytes(32).toString('base64url'),client=await r.pool.connect();
  try{await client.query('BEGIN');const updated=await client.query('UPDATE newhope_auth.native_transactions SET completed_at=now() WHERE id=$1 AND completed_at IS NULL AND expires_at>now() RETURNING id',[transaction]);if(updated.rowCount!==1)throw Error('NATIVE_TRANSACTION_REPLAY');await client.query("INSERT INTO newhope_auth.native_handoffs(code_hash,transaction_id,token_encrypted,expires_at) VALUES($1,$2,$3,now()+interval '60 seconds')",[digest(code),transaction,sealAuthState(token,config.secret,'native-session:'+config.baseUrl,60)]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return res.redirect(303,callback+'?code='+code);
 }
 if(path==='/api/auth/native/exchange'&&req.method==='POST'){
  let body:any;try{body=JSON.parse(c.bytes?.toString()||'{}');}catch{return res.status(400).json({error:'PKCE_REJECTED'});}
  if(typeof body.code!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(body.code)||typeof body.verifier!=='string'||!/^[-_A-Za-z0-9]{43,128}$/.test(body.verifier))return res.status(400).json({error:'PKCE_REJECTED'});
  const row=(await r.pool.query(`UPDATE newhope_auth.native_handoffs h SET consumed_at=now() FROM newhope_auth.native_transactions t WHERE h.transaction_id=t.id AND h.code_hash=$1 AND h.consumed_at IS NULL AND h.expires_at>now() AND t.challenge=$2 RETURNING h.token_encrypted`,[digest(body.code),digest(body.verifier)])).rows[0];
  if(!row)return res.status(401).json({error:'NATIVE_CODE_REJECTED'});
  const token=openAuthState(row.token_encrypted,config.secret,'native-session:'+config.baseUrl);if(typeof token!=='string')throw Error('NATIVE_TOKEN_REJECTED');
  const verified=await resolveNeonSession(new Headers({authorization:'Bearer '+token}),{},r);if(!verified)return res.status(401).json({error:'AUTH_SESSION_REQUIRED'});
  res.setHeader('set-auth-token',token);return res.json({ok:true});
 }
 return res.status(404).json({error:'NOT_FOUND'});
}
