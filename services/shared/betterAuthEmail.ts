import {createHash} from 'node:crypto';
import {Resend} from 'resend';
export interface AuthEmail {kind:'VERIFY'|'RESET';email:string;url:string;baseUrl:string}

/** No default sender, no misleading successful delivery, no token logs.
 * Fixture senders are injected directly by isolated tests, never enabled by
 * public request fields or a production environment switch. */
export async function sendBetterAuthEmail(mail:AuthEmail) {
  const link=new URL(mail.url);
  if(link.origin!==mail.baseUrl||!link.pathname.startsWith('/api/auth/'))throw Error('AUTH_EMAIL_URL_REJECTED');
  if(link.protocol!=='https:')throw Error('AUTH_EMAIL_HTTPS_REQUIRED');
  if(process.env.AUTH_EMAIL_ENABLED!=='1'||!process.env.RESEND_API_KEY||!process.env.AUTH_EMAIL_FROM)
    throw Error('AUTH_EMAIL_PROVIDER_NOT_CONFIGURED');
  const text=mail.kind==='RESET'?'Atur password New Hope Anda':'Verifikasi email New Hope Anda';
  const safeUrl=mail.url.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const key=createHash('sha256').update(mail.kind+':'+mail.email+':'+mail.url).digest('hex');
  const response=await new Resend(process.env.RESEND_API_KEY).emails.send({from:process.env.AUTH_EMAIL_FROM,to:mail.email,
    replyTo:'stefen@newsystem.space',subject:text,text:text+'. Buka tautan ini (berlaku 15 menit): '+mail.url+'\nJika Anda tidak meminta ini, abaikan email dan hubungi dukungan.',
    html:'<!doctype html><html lang="id"><body><h1>'+text+'</h1><p>Tautan berlaku 15 menit.</p><p><a href="'+safeUrl+'">'+text+'</a></p><p>Jika Anda tidak meminta ini, abaikan email dan hubungi stefen@newsystem.space.</p></body></html>'},
    {idempotencyKey:'newhope-auth-'+key});
  if(response.error||!response.data?.id)throw Error('AUTH_EMAIL_DELIVERY_FAILED');
}
