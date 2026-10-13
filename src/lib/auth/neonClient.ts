import {createAuthClient} from '@neondatabase/auth';
import {SupabaseAuthAdapter} from '@neondatabase/auth/vanilla/adapters';
import {AuthError,type GoTrueClient,type Session} from '@supabase/auth-js';

/** Auth-only official adapter. No database key or Data API in the browser.
 * Its MFA and updateUser(password) incompatibilities remain rollout blockers. */
export function createNeonPilotClient(url:string):GoTrueClient {
  const endpoint=new URL(url);
  if(endpoint.protocol!=='https:' || !/(?:^|\.)neon\.(?:tech|build)$/.test(endpoint.hostname))throw Error('INVALID_NEON_AUTH_URL');
  const client=createAuthClient(url,{adapter:SupabaseAuthAdapter()}) as unknown as GoTrueClient;
  const getSession=client.getSession.bind(client),signIn=client.signInWithPassword.bind(client);
  const native=createAuthClient(url);
  const getUser=client.getUser.bind(client),signOut=client.signOut.bind(client);
  const onChange=client.onAuthStateChange.bind(client);
  const pending='nh-neon-onboarding:'+endpoint.href,offline='nh-neon-offline:'+endpoint.href;
  const offlineSession=():Session|null=>{
    if(typeof navigator==='undefined' || navigator.onLine!==false)return null;
    try {const saved=JSON.parse(localStorage.getItem(offline)||'null');
      if(saved && Date.now()-saved.savedAt<86400000)return {...saved.session,access_token:'offline-neon-session',refresh_token:''};
    }catch{/* Corrupt device hints confer no cloud authority. */}
    return null;
  };
  async function mapSession(session:Session|null):Promise<Session|null> {
    if(!session)return null;
    // This flag is a UI check only; the API independently verifies signed JWT
    // and live provider state before binding an identity or opening a tenant.
    const response=await fetch('/api/v1/sync/identity',{headers:{authorization:'Bearer '+session.access_token}});
    if(!response.ok)throw new AuthError('Email belum terverifikasi atau identitas akun perlu ditinjau.');
    const identity=await response.json();
    if(typeof identity.subject!=='string')throw new AuthError('Identitas akun tidak valid.');
    let metadata:Record<string,string>={};
    try {const saved=JSON.parse(localStorage.getItem(pending)||'null');if(saved?.email===session.user.email)metadata=saved.data;}catch{/* display hints only */}
    const provision=await fetch('/api/v1/sync/neon-onboarding',{method:'POST',headers:{authorization:'Bearer '+session.access_token,'content-type':'application/json'},body:JSON.stringify(metadata)});
    if(!provision.ok)throw new AuthError('Penyiapan akun memerlukan pemeriksaan migrasi.');
    localStorage.removeItem(pending);
    const mapped={...session,user:{...session.user,id:identity.subject}};
    localStorage.setItem(offline,JSON.stringify({savedAt:Date.now(),session:mapped}));
    return mapped;
  }
  client.getSession=async()=>{
    const cached=offlineSession();if(cached)return {data:{session:cached},error:null};
    const result=await getSession();
    if(result.error)return result;
    try{const session=await mapSession(result.data.session);return session?{data:{session},error:null}:{data:{session:null},error:null};}
    catch(e){return {data:{session:null},error:e as AuthError};}
  };
  client.signInWithPassword=async credentials=>{
    const result=await signIn(credentials);if(result.error)return result;
    try{const session=await mapSession(result.data.session);if(!session)throw new AuthError('Sesi belum tersedia.');return {data:{user:session.user,session},error:null};}
    catch(e){return {data:{user:null,session:null},error:e as AuthError};}
  };
  client.signUp=async credentials=>{
    if(!('email' in credentials) || !credentials.email)return {data:{user:null,session:null},error:new AuthError('Registrasi memerlukan email.')};
    localStorage.setItem(pending,JSON.stringify({email:credentials.email,data:credentials.options?.data||{}}));
    const result=await native.signUp.email({email:credentials.email,password:credentials.password,
      name:(credentials.options?.data as Record<string,string>|undefined)?.full_name || credentials.email.split('@')[0]});
    if(result.error)return {data:{user:null,session:null},error:new AuthError(result.error.message||'Registrasi belum berhasil.')};
    // Always require email verification before a new business is provisioned.
    // Unlike Supabase this pilot exposes OTP verification on the login page.
    return {data:{user:null,session:null},error:null};
  };
  client.getUser=async jwt=>{
    const result=await getUser(jwt);if(result.error)return result;
    const session=await client.getSession();
    if(session.error)return {data:{user:null},error:session.error};
    const user=session.data.session?.user;
    return user?{data:{user},error:null}:{data:{user:null},error:new AuthError('Sesi belum tersedia.')};
  };
  client.signOut=async options=>{
    localStorage.removeItem(offline);localStorage.removeItem(pending);
    return signOut(options);
  };
  client.onAuthStateChange=callback=>onChange((event,session)=>{
    if(event==='SIGNED_OUT')localStorage.removeItem(offline);
    // Avoid a reentrant getSession in the adapter's notification callback.
    queueMicrotask(()=>{void (async()=>{
      const cached=offlineSession();
      try{await callback(event,cached || await mapSession(session));}
      catch{await callback(event,null);}
    })();});
  });
  // Supported public methods only; SDK MFA rejects rather than faking aal2.
  return client;
}

export function createNeonVerificationClient(url:string) {return createAuthClient(url);}
