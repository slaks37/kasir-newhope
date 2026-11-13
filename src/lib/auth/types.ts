/** Application identity contract. IDs always refer to the canonical historical actor. */
export interface User {
 id:string;email?:string;email_confirmed_at?:string;confirmed_at?:string;
 user_metadata:Record<string,any>;app_metadata:Record<string,any>;
 aud?:string;created_at?:string;twoFactorEnabled?:boolean;passwordCredential?:boolean;providers?:string[];
}
export interface Session {
 access_token:string;refresh_token?:string;token_type?:string;expires_in?:number;expires_at?:number;
 user:User;aal?:'aal1'|'aal2';mfaVerifiedAt?:number;
 /** Non-secret server-session discriminator for in-flight request isolation. */
 sessionId?:string;
 /** Bounded local cache/queue UI only; never API authority or fresh MFA. */
 offlineRecovery?:boolean;
}
export interface AuthError {message:string;code?:string;status?:number}
export type AuthEvent='INITIAL_SESSION'|'SIGNED_IN'|'SIGNED_OUT'|'TOKEN_REFRESHED'|'PASSWORD_RECOVERY'|'USER_UPDATED'|'MFA_REQUIRED';
export interface AuthResult {data:{session:Session|null;user:User|null};error:AuthError|null}
export interface AppAuthClient {
 getSession():Promise<{data:{session:Session|null};error:AuthError|null}>;
 getUser():Promise<{data:{user:User|null};error:AuthError|null}>;
 signInWithPassword(input:{email:string;password:string}):Promise<AuthResult>;
 signUp(input:{email:string;password:string;options?:{emailRedirectTo?:string;data?:Record<string,unknown>}}):Promise<AuthResult>;
 signInWithOAuth(input:{provider:'google';options?:{redirectTo?:string;skipBrowserRedirect?:boolean}}):Promise<{data:{url?:string|null};error:AuthError|null}>;
 signOut(options?:{scope?:'local'|'global'|'others'}):Promise<{error:AuthError|null}>;
 resetPasswordForEmail(email:string,options?:{redirectTo?:string}):Promise<{error:AuthError|null}>;
 updateUser(input:{password:string}):Promise<{data?:{user:User|null};error:AuthError|null}>;
 exchangeCodeForSession(code:string):Promise<{error:AuthError|null}>;
 onAuthStateChange(callback:(event:AuthEvent,session:Session|null)=>void):{data:{subscription:{unsubscribe():void}}};
 startAutoRefresh():void;stopAutoRefresh():void;
 mfa:{
  listFactors():Promise<{data:{totp:Array<{id:string;friendly_name?:string;status:string}>};error:AuthError|null}>;
  enroll(input:{factorType:'totp';friendlyName?:string;password?:string}):Promise<{data:{id:string;totp:{qr_code:string;secret:string};backupCodes?:string[]};error:AuthError|null}>;
  challengeAndVerify(input:{factorId:string;code:string;recovery?:boolean}):Promise<{error:AuthError|null}>;
 };
}
