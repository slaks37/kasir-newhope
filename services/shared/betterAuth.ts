import {betterAuth} from 'better-auth';
import {bearer,twoFactor} from 'better-auth/plugins';
import {createAuthMiddleware,APIError} from 'better-auth/api';
import {PostgresDialect} from 'kysely';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {getAuthConfig,authDatabaseOptions} from './betterAuthConfig';
import {databasePoolLimits} from './poolConfig';
import {sendBetterAuthEmail,type AuthEmail} from './betterAuthEmail';
import {authReturnUrl} from './authReturnUrl';

/** Mounted on the app host. All auth queries qualify newhope_auth explicitly;
 * no SET search_path and no managed neon_auth credential/schema import. */
export function createBetterAuthRuntime(config=getAuthConfig(),sendEmail:(mail:AuthEmail)=>Promise<void>=sendBetterAuthEmail) {
  const pool=new pg.Pool({...authDatabaseOptions(config.databaseUrl),...databasePoolLimits(2)});
  const auth=betterAuth({
    appName:'New Hope POS',baseURL:config.baseUrl,basePath:'/api/auth',secret:config.secret,
    database:{dialect:new PostgresDialect({pool}),type:'postgres',schemaName:'newhope_auth'},
    trustedOrigins:config.allowedOrigins||[config.baseUrl],telemetry:{enabled:false},logger:{disabled:true},
    advanced:{database:{generateId:()=>randomUUID()},useSecureCookies:config.baseUrl.startsWith('https://')},
    user:{additionalFields:{isActive:{type:'boolean',defaultValue:true,required:true,input:false},onboarding:{type:'json',required:false,input:true}}},
    socialProviders:config.google?{google:config.google}:{},
    account:{accountLinking:{enabled:false}},
    databaseHooks:{user:{create:{after:async(user)=>{await pool.query('INSERT INTO newhope_auth.registration_intents(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);}}}},
    session:{expiresIn:3600,updateAge:900,cookieCache:{enabled:false},freshAge:300},
    emailAndPassword:{enabled:true,requireEmailVerification:true,minPasswordLength:12,maxPasswordLength:128,
      resetPasswordTokenExpiresIn:900,revokeSessionsOnPasswordReset:true,
      sendResetPassword:async({user,url})=>sendEmail({kind:'RESET',email:user.email,url,baseUrl:config.baseUrl})},
    emailVerification:{sendOnSignUp:true,autoSignInAfterVerification:false,expiresIn:900,
      sendVerificationEmail:async({user,url})=>sendEmail({kind:'VERIFY',email:user.email,url,baseUrl:config.baseUrl})},
    rateLimit:{enabled:true,storage:'database',window:60,max:100,
      customRules:{'/sign-in/email':{window:60,max:5},'/two-factor/verify-totp':{window:60,max:5},
        '/two-factor/verify-backup-code':{window:60,max:5},
        '/request-password-reset':{window:3600,max:3},'/send-verification-email':{window:3600,max:3}}},
    plugins:[bearer({requireSignature:true}),twoFactor({issuer:'New Hope POS',skipVerificationOnEnable:false,allowPasswordless:true,
      accountLockout:{enabled:true,maxFailedAttempts:5,durationSeconds:900}})],
    hooks:{
      before:createAuthMiddleware(async ctx=>{
        if(['/request-password-reset','/sign-up/email','/send-verification-email'].includes(ctx.path)&&ctx.body) {
          const reset=ctx.path==='/request-password-reset',field=reset?'redirectTo':'callbackURL';
          try{ctx.body[field]=authReturnUrl(reset?'RESET':'VERIFY',ctx.body[field],config.baseUrl,config.allowedOrigins);}
          catch{throw new APIError('BAD_REQUEST',{message:'Tautan kembali autentikasi tidak valid.',code:'AUTH_CALLBACK_REJECTED'});}
        }
        if(ctx.path==='/sign-up/email'&&ctx.body){
          const raw=ctx.body.onboarding||{};ctx.body.onboarding=Object.fromEntries(['full_name','store_name','business_sector','first_outlet_name','second_outlet_name'].filter(k=>typeof raw[k]==='string'&&raw[k].length<=100).map(k=>[k,raw[k]]));
        }
        if(ctx.path==='/sign-in/social'&&ctx.body){
          let target:URL;try{target=new URL(ctx.body.callbackURL||config.baseUrl+'/overview');}catch{throw new APIError('BAD_REQUEST',{code:'AUTH_CALLBACK_REJECTED'});}
          if(target.origin!==config.baseUrl||target.hash||target.username||target.password||!(['/overview','/login'].includes(target.pathname)&&!target.search||target.pathname==='/api/auth/native/complete'&&target.searchParams.size===1&&/^[-_A-Za-z0-9]{43}$/.test(target.searchParams.get('transaction')||'')))throw new APIError('BAD_REQUEST',{code:'AUTH_CALLBACK_REJECTED'});
          ctx.body.callbackURL=target.href;
        }
        // No remembered-device bypass for financial/admin assurance.
        if(ctx.path.startsWith('/two-factor/')&&ctx.body)ctx.body.trustDevice=false;
        if(['/two-factor/enable','/two-factor/disable','/two-factor/generate-backup-codes','/two-factor/get-totp-uri','/change-password','/revoke-session','/revoke-sessions','/revoke-other-sessions','/list-sessions'].includes(ctx.path)) {
          const current=await auth.api.getSession({headers:ctx.headers||new Headers(),query:{disableCookieCache:true}});
          if(ctx.path==='/two-factor/enable'&&current?.user&&!current.user.twoFactorEnabled&&Date.now()-new Date(current.session.createdAt).getTime()>300000)throw new APIError('FORBIDDEN',{message:'Masuk kembali sebelum menyiapkan autentikator.',code:'REAUTH_REQUIRED'});
          if(current?.user.twoFactorEnabled) {
            const fresh=(await pool.query(`SELECT 1 FROM newhope_auth.mfa_session_proofs
              WHERE session_id=$1 AND user_id=$2 AND method='totp' AND verified_at>now()-interval '10 minutes' AND verified_at<=now()+interval '30 seconds'`,[current.session.id,current.user.id])).rowCount;
            if(!fresh)throw new APIError('FORBIDDEN',{message:'Verifikasi ulang autentikator sebelum mengubah MFA.',code:'REAUTH_REQUIRED'});
          }
        }
      }),
      after:createAuthMiddleware(async ctx=>{
        // A timestamp is recorded ONLY after the official TOTP plugin succeeds.
        // Metadata, password login, backup codes and trusted-device cookies do
        // not manufacture fresh admin TOTP evidence.
        if(!['/two-factor/verify-totp','/two-factor/verify-backup-code'].includes(ctx.path)||ctx.context.returned instanceof APIError)return;
        const result=ctx.context.returned as {token?:string;user?:{id?:string}}|undefined;
        if(!result?.token || !result.user?.id)return;
        // Enrollment rotates the session but its response can still contain
        // the preceding token. The native context holds the newly issued one.
        const fresh=ctx.context.newSession;
        const sessionToken=fresh?.session.token||result.token;
        const userId=fresh?.user.id||result.user.id;
        await pool.query(`INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,method,verified_at)
          SELECT id,"userId",$3,now() FROM newhope_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now()
          ON CONFLICT(session_id) DO UPDATE SET method=EXCLUDED.method,verified_at=EXCLUDED.verified_at`,[sessionToken,userId,ctx.path==='/two-factor/verify-totp'?'totp':'recovery']);
      }),
    },
  });
  const ready=process.env.NODE_ENV==='test'?Promise.resolve():pool.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,pg_has_role(current_user,'svc_auth','MEMBER') AS auth_role,EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos' AND c.relname='transactions' AND has_table_privilege(current_user,c.oid,'SELECT')) AS ledger_access,has_table_privilege(current_user,'internal.auth_identity_bindings','INSERT') AS mapping_write FROM pg_roles r WHERE r.rolname=current_user`).then(result=>{const role=result.rows[0];if(!role||role.rolsuper||role.rolbypassrls||role.rolcreaterole||role.rolcreatedb||!role.auth_role||role.ledger_access||role.mapping_write)throw Error('AUTH_DATABASE_ROLE_REJECTED');});
  void ready.catch(()=>{});
  return {auth,pool,ready,close:()=>pool.end()};
}
let runtime:ReturnType<typeof createBetterAuthRuntime>|undefined;
export function getBetterAuthRuntime(){return runtime??=createBetterAuthRuntime();}
