import {Browser} from '@capacitor/browser';
import {supabase} from '../../lib/supabase';
/** Rollback-only adapter. Removed from Neon build graphs. */
export async function legacyNativeGoogleLogin(){
 const {data,error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:'space.newhope.kasir://auth/callback',skipBrowserRedirect:true}});
 if(error)return {error};if(!data.url)throw Error('OAUTH_URL_MISSING');
 const url=new URL(data.url),auth=new URL(import.meta.env.VITE_SUPABASE_URL);
 if(url.protocol!=='https:'||url.origin!==auth.origin||url.pathname!=='/auth/v1/authorize')throw Error('UNTRUSTED_AUTH_URL');
 await Browser.open({url:url.href});return {error:null};
}
