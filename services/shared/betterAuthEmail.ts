import {createHash} from 'node:crypto';
import {Resend} from 'resend';
import {authReturnUrl} from './authReturnUrl';
export interface AuthEmail {kind:'VERIFY'|'RESET';email:string;url:string;baseUrl:string}

export function authEmailPayload(mail:AuthEmail,env=process.env) {
  const origin=new URL(mail.baseUrl),link=new URL(mail.url);
  if(origin.origin!==mail.baseUrl||link.origin!==mail.baseUrl||
    (mail.kind==='RESET'?!/^\/api\/auth\/reset-password\/[^/]+$/.test(link.pathname):link.pathname!=='/api/auth/verify-email'))throw Error('AUTH_EMAIL_URL_REJECTED');
  if(link.protocol!=='https:')throw Error('AUTH_EMAIL_HTTPS_REQUIRED');
  const callbacks=link.searchParams.getAll('callbackURL');
  if(callbacks.length!==1)throw Error('AUTH_CALLBACK_REJECTED');
  authReturnUrl(mail.kind,callbacks[0],mail.baseUrl,[mail.baseUrl,...(env.NEWHOPE_AUTH_TRUSTED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
  if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(mail.email))throw Error('AUTH_EMAIL_RECIPIENT_REJECTED');
  if(env.AUTH_EMAIL_ENABLED!=='1'||!env.RESEND_API_KEY||!env.AUTH_EMAIL_FROM||!env.AUTH_EMAIL_VERIFIED_DOMAIN)
    throw Error('AUTH_EMAIL_PROVIDER_NOT_CONFIGURED');
  const sender=env.AUTH_EMAIL_FROM.match(/^(?:[^<>\r\n]+<)?([^<>\s@,;]+@[^<>\s@,;]+)(?:>)?$/)?.[1];
  if(!sender||sender.split('@')[1].toLowerCase()!==env.AUTH_EMAIL_VERIFIED_DOMAIN.toLowerCase())throw Error('AUTH_EMAIL_SENDER_REJECTED');
  if(env.VERCEL_ENV==='preview'||env.APP_ENV==='staging') {
    const allowed=(env.AUTH_EMAIL_ALLOWED_RECIPIENTS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
    if(!allowed.includes(mail.email.toLowerCase()))throw Error('AUTH_EMAIL_STAGING_RECIPIENT_NOT_APPROVED');
  }
  const text=mail.kind==='RESET'?'Atur password New Hope Anda':'Verifikasi email New Hope Anda';
  const safeUrl=mail.url.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const key=createHash('sha256').update(mail.kind+':'+mail.email+':'+mail.url).digest('hex');
  return {payload:{from:env.AUTH_EMAIL_FROM,to:mail.email,
    replyTo:'stefen@newsystem.space',subject:text,text:text+'. Buka tautan ini (berlaku 15 menit): '+mail.url+'\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.',
    html:'<!doctype html><html lang="id"><head><meta charset="utf-8"><title>'+text+'</title></head><body><h1>'+text+'</h1><p>Tautan berlaku 15 menit.</p><p><a href="'+safeUrl+'">'+text+'</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>'},idempotencyKey:'newhope-auth-'+key};
}

/** No default sender, no misleading successful delivery, no token logs.
 * Fixture senders are injected directly by isolated tests, never enabled by
 * public request fields or a production environment switch. */
export async function sendBetterAuthEmail(mail:AuthEmail) {
  const {payload,idempotencyKey}=authEmailPayload(mail);
  const response=await new Resend(process.env.RESEND_API_KEY!).emails.send(payload,{idempotencyKey});
  if(response.error||!response.data?.id)throw Error('AUTH_EMAIL_DELIVERY_FAILED');
}
