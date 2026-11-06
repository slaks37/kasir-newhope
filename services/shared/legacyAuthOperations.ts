/** Rollback-only provider. Never loaded by the Neon runtime selection. */
import type {AuthProviderOperations,OwnerIdentity} from './authProviderOperations';
import {AuthOperationError} from './authProviderOperations';

export function createLegacyAuthOperations():AuthProviderOperations {
 const url=(process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL||'').replace(/\/$/,'');
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 const anonKey=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY||'';
 let opening:Promise<any>|undefined;
 const client=async()=>{
  if(!url||!serviceKey)throw new AuthOperationError(503,'SUPPORT_AUTH_NOT_CONFIGURED');
  return opening??=import('@supabase/supabase-js').then(({createClient})=>createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(5000)})}}));
 };
 const identity=async(subject:string):Promise<OwnerIdentity|null>=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subject))return null;
  const auth=await client(),{data,error}=await auth.auth.admin.getUserById(subject);
  if(error){if(error.status===404)return null;throw new AuthOperationError(502,'OWNER_LOOKUP_FAILED');}
  const u=data.user;
  return u?.id===subject&&!u.deleted_at&&(!u.banned_until||Date.parse(u.banned_until)<=Date.now())&&u.email?{email:u.email,verified:!!u.email_confirmed_at}:null;
 };
 const destination=(path:string)=>{
  let target:URL;try{target=new URL(path,process.env.APP_URL||'https://kasir.newhope.space');}catch{throw new AuthOperationError(503,'SUPPORT_REDIRECT_NOT_CONFIGURED');}
  if(target.protocol!=='https:'||target.username||target.password)throw new AuthOperationError(503,'SUPPORT_REDIRECT_NOT_CONFIGURED');return target.href;
 };
 return {provider:'supabase',configured:!!url&&!!serviceKey,ownerIdentity:identity,
  async sendConfirmation(email){const auth=await client();const {error}=await auth.auth.resend({type:'signup',email,options:{emailRedirectTo:destination('/login')}});if(error)throw new AuthOperationError(error.status===429?429:502,'EMAIL_CONFIRMATION_PROVIDER_REJECTED');},
  async sendReset(email){const auth=await client();const {error}=await auth.auth.resetPasswordForEmail(email,{redirectTo:destination('/reset-password')});if(error)throw new AuthOperationError(error.status===429?429:502,'PASSWORD_RESET_PROVIDER_REJECTED');},
  async reauthenticate(_req,subject,password,verifiedEmail){
   if(!verifiedEmail||!password||password.length>1024)return false;
   if(!url.startsWith('https://')||!anonKey)throw new AuthOperationError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');
   let response:Response;try{response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anonKey,'content-type':'application/json'},body:JSON.stringify({email:verifiedEmail,password}),redirect:'error',signal:AbortSignal.timeout(5000)});}catch{throw new AuthOperationError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');}
   if(response.status>=500||response.status===429)throw new AuthOperationError(503,'OWNER_REAUTHENTICATION_UNAVAILABLE');if(!response.ok)return false;
   const data=await response.json();return data.user?.id===subject&&Boolean(data.user?.email_confirmed_at||data.user?.confirmed_at);
  },
 };
}
