import {betterAuth} from 'better-auth';
import {bearer,twoFactor} from 'better-auth/plugins';
import {createAuthMiddleware,APIError} from 'better-auth/api';
import {PostgresDialect} from 'kysely';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {databaseTransport} from './databaseTls';
import {databasePoolLimits} from './poolConfig';
import {betterAuthPilotConfig} from './betterAuthPilot';
import {sendBetterAuthEmail,type AuthEmail} from './betterAuthEmail';

/** Mounted on the app host. All auth queries qualify newhope_auth explicitly;
 * no SET search_path and no managed neon_auth credential/schema import. */
export function createBetterAuthRuntime(config=betterAuthPilotConfig(),sendEmail:(mail:AuthEmail)=>Promise<void>=sendBetterAuthEmail) {
  const pool=new pg.Pool({...databaseTransport(config.databaseUrl),...databasePoolLimits(2)});
  const auth=betterAuth({
    appName:'New Hope POS',baseURL:config.baseUrl,basePath:'/api/auth',secret:config.secret,
    database:{dialect:new PostgresDialect({pool}),type:'postgres',schemaName:'newhope_auth'},
    trustedOrigins:[config.baseUrl],telemetry:{enabled:false},logger:{disabled:true},
    advanced:{database:{generateId:()=>randomUUID()},useSecureCookies:config.baseUrl.startsWith('https://')},
    user:{additionalFields:{isActive:{type:'boolean',defaultValue:true,required:true,input:false}}},
    session:{expiresIn:3600,updateAge:900,cookieCache:{enabled:false},freshAge:3600},
    emailAndPassword:{enabled:true,requireEmailVerification:true,minPasswordLength:12,maxPasswordLength:128,
      resetPasswordTokenExpiresIn:900,revokeSessionsOnPasswordReset:true,
      sendResetPassword:async({user,url})=>sendEmail({kind:'RESET',email:user.email,url,baseUrl:config.baseUrl})},
    emailVerification:{sendOnSignUp:true,autoSignInAfterVerification:false,expiresIn:900,
      sendVerificationEmail:async({user,url})=>sendEmail({kind:'VERIFY',email:user.email,url,baseUrl:config.baseUrl})},
    rateLimit:{enabled:true,storage:'database',window:60,max:100,
      customRules:{'/sign-in/email':{window:60,max:5},'/two-factor/verify-totp':{window:60,max:5},
        '/request-password-reset':{window:3600,max:3},'/send-verification-email':{window:3600,max:3}}},
    plugins:[bearer({requireSignature:true}),twoFactor({issuer:'New Hope POS',skipVerificationOnEnable:false,
      accountLockout:{enabled:true,maxFailedAttempts:5,durationSeconds:900}})],
    hooks:{
      before:createAuthMiddleware(async ctx=>{
        // No remembered-device bypass for financial/admin assurance.
        if(ctx.path.startsWith('/two-factor/')&&ctx.body)ctx.body.trustDevice=false;
        if(['/two-factor/enable','/two-factor/disable','/two-factor/generate-backup-codes'].includes(ctx.path)) {
          const current=await auth.api.getSession({headers:ctx.headers||new Headers(),query:{disableCookieCache:true}});
          if(current?.user.twoFactorEnabled) {
            const fresh=(await pool.query(`SELECT 1 FROM newhope_auth.mfa_session_proofs
              WHERE session_id=$1 AND user_id=$2 AND verified_at>now()-interval '10 minutes' AND verified_at<=now()+interval '30 seconds'`,[current.session.id,current.user.id])).rowCount;
            if(!fresh)throw new APIError('FORBIDDEN',{message:'Verifikasi ulang autentikator sebelum mengubah MFA.',code:'REAUTH_REQUIRED'});
          }
        }
      }),
      after:createAuthMiddleware(async ctx=>{
        // A timestamp is recorded ONLY after the official TOTP plugin succeeds.
        // Metadata, password login, backup codes and trusted-device cookies do
        // not manufacture fresh admin TOTP evidence.
        if(ctx.path!=='/two-factor/verify-totp'||ctx.context.returned instanceof APIError)return;
        const result=ctx.context.returned as {token?:string;user?:{id?:string}}|undefined;
        if(!result?.token || !result.user?.id)return;
        // Enrollment rotates the session but its response can still contain
        // the preceding token. The native context holds the newly issued one.
        const fresh=ctx.context.newSession;
        const sessionToken=fresh?.session.token||result.token;
        const userId=fresh?.user.id||result.user.id;
        await pool.query(`INSERT INTO newhope_auth.mfa_session_proofs(session_id,user_id,verified_at)
          SELECT id,"userId",now() FROM newhope_auth.session WHERE token=$1 AND "userId"=$2 AND "expiresAt">now()
          ON CONFLICT(session_id) DO UPDATE SET verified_at=EXCLUDED.verified_at`,[sessionToken,userId]);
      }),
    },
  });
  return {auth,pool,close:()=>pool.end()};
}
let runtime:ReturnType<typeof createBetterAuthRuntime>|undefined;
export function getBetterAuthRuntime(){return runtime??=createBetterAuthRuntime();}
