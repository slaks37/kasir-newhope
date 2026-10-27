import {App} from '@capacitor/app';
import {Browser} from '@capacitor/browser';
import {Network} from '@capacitor/network';
import {isNative} from './platform';
import {parseAuthCallback} from './apiPolicy';
import {supabase} from '../../lib/supabase';
import {navigate} from '../../lib/navigation/workspaceRouter';
export const nativeCallback='space.newhope.kasir://auth/callback';
export const authRedirect=()=>isNative()?nativeCallback:window.location.origin;
let installed=false,exchanging=false,recovering=false;
export async function installNativeLifecycle(){
 if(!isNative()||installed)return;installed=true;
 supabase.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')recovering=true;});
 const receive=async(raw:string)=>{
  const code=parseAuthCallback(raw,nativeCallback);if(!code||exchanging)return;
  exchanging=true;recovering=false;
  try{const {error}=await supabase.auth.exchangeCodeForSession(code);if(error)throw error;await Browser.close().catch(()=>{});navigate(recovering?'/reset-password':'/overview',true);}
  catch{window.dispatchEvent(new CustomEvent('native-auth-error'));}
  finally{exchanging=false;}
 };
 // Subscribe before reading cold-launch URL so both warm and terminated launches work.
 await App.addListener('appUrlOpen',e=>void receive(e.url));
 await App.addListener('appStateChange',({isActive})=>{
  if(!isActive){supabase.auth.stopAutoRefresh();return;}
  supabase.auth.startAutoRefresh();
  void supabase.auth.getSession().then(()=>window.dispatchEvent(new Event('focus'))).catch(()=>window.dispatchEvent(new CustomEvent('native-auth-error')));
 });
 await App.addListener('backButton',({canGoBack})=>{if(canGoBack)window.history.back();else void App.minimizeApp();});
 await Network.addListener('networkStatusChange',({connected})=>window.dispatchEvent(new Event(connected?'online':'offline')));
 const launch=await App.getLaunchUrl();if(launch?.url)await receive(launch.url);
 supabase.auth.onAuthStateChange((event)=>{if(event==='PASSWORD_RECOVERY')navigate('/reset-password',true);});
}
export async function nativeGoogleLogin(){
 const {data,error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:nativeCallback,skipBrowserRedirect:true}});
 if(error)return {error};if(!data.url)throw Error('OAUTH_URL_MISSING');
 const url=new URL(data.url),auth=new URL(import.meta.env.VITE_SUPABASE_URL);
 if(url.protocol!=='https:'||url.origin!==auth.origin||url.pathname!=='/auth/v1/authorize')throw Error('UNTRUSTED_AUTH_URL');
 await Browser.open({url:url.href});return {error:null};
}
