import {defineConfig,loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {resolve} from 'node:path';
import {httpsOrigin} from './src/platform/runtime/apiPolicy';
export default defineConfig(({mode})=>{
 const env={...loadEnv(mode,process.cwd(),'VITE_'),...process.env};
 const origin=httpsOrigin(env.VITE_NATIVE_API_ORIGIN||'https://unconfigured.invalid');
 const key=env.VITE_SUPABASE_ANON_KEY||'';
 if(key.startsWith('sb_secret_'))throw Error('PRIVILEGED_AUTH_KEY_FORBIDDEN');
 if(key.split('.').length===3){const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(claims.role!=='anon')throw Error('PRIVILEGED_AUTH_KEY_FORBIDDEN');}
 return {root:resolve('mobile'),publicDir:false,envDir:process.cwd(),envPrefix:['VITE_NATIVE_','VITE_SUPABASE_'],plugins:[react(),tailwindcss()],
  resolve:{alias:[{find:'/src',replacement:resolve('src')},{find:'@',replacement:process.cwd()},{find:/.*components\/home\/HomePage$/,replacement:resolve('mobile/MerchantHome.tsx')},{find:/.*\/(SubscriptionBillingTab|SubscriptionPaymentPage|SubscriptionLockScreen)$/,replacement:resolve('mobile/SubscriptionUnavailable.tsx')}]},define:{'import.meta.env.VITE_NATIVE_API_ORIGIN':JSON.stringify(origin),'import.meta.env.VITE_MODULE_WORKSPACES':'"0"'},
  build:{outDir:resolve('dist-mobile'),emptyOutDir:true,manifest:true,rollupOptions:{input:{main:resolve('mobile/index.html')}}}};
});
