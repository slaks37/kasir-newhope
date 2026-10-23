import type {AuthError,Session} from '@supabase/auth-js';

type SignupUser={id:string;email:string;emailVerified:boolean};
type Credentials={email:string;password:string;options?:{emailRedirectTo?:string;data?:object}};
type NativeSignup=(input:{email:string;password:string;name:string;callbackURL?:string})=>Promise<{data:{user?:SignupUser}|null;error:{message?:string;status?:number;code?:string}|null}>;
type SessionResult={data:{session:Session|null};error:AuthError|null};
const fail=(message:string,status=503,code='MANAGED_SIGNUP_UNAVAILABLE')=>({data:{user:null,session:null},error:{message,status,code} as AuthError});

/** A successful, unverified managed signup deliberately has no session. Never
 * retry signup or infer success from an adapter's error string. Only the native
 * managed response may classify it as awaiting email confirmation. */
export async function signUpManagedEmail(signUp:NativeSignup,getSession:()=>Promise<SessionResult>,credentials:Credentials){
 try{
  const info=credentials.options?.data;
  const fullName=info&&'full_name' in info?info.full_name:undefined;
  const name=typeof fullName==='string'&&fullName.trim()?fullName.trim():credentials.email.split('@')[0];
  const result=await signUp({email:credentials.email,password:credentials.password,name,callbackURL:credentials.options?.emailRedirectTo});
  if(result.error)return fail(result.error.message||'Pendaftaran belum berhasil.',result.error.status||400,result.error.code);
  const user=result.data?.user;
  if(!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) || typeof user.email!=='string' || user.email.toLowerCase()!==credentials.email.trim().toLowerCase() || typeof user.emailVerified!=='boolean')return fail('Respons pendaftaran belum dapat diverifikasi. Periksa email Anda sebelum mencoba kembali.');
  // Do not expose an unverified profile as an authenticated user, create a
  // synthetic token, or request a session that the provider intentionally lacks.
  if(!user.emailVerified)return {data:{user:null,session:null},error:null};
  const current=await getSession();if(current.error)return {data:{user:null,session:null},error:current.error};
  const session=current.data.session;
  if(!session?.access_token || session.user.id!==user.id || !session.user.email_confirmed_at || session.user.email?.toLowerCase()!==user.email.toLowerCase())return fail('Sesi akun belum dapat diverifikasi. Silakan masuk setelah verifikasi email.');
  return {data:{user:session.user,session},error:null};
 }catch(error){
  const e=error as {status?:number;code?:string;message?:string};
  return fail(typeof e.status==='number'?e.message||'Pendaftaran belum berhasil.':'Tidak dapat terhubung ke server. Periksa email sebelum mencoba kembali.',e.status||503,e.code);
 }
}
