import {isNative,authRedirect} from '../platform/runtime/platform';
/**
 * AuthContext — sesi identitas aplikasi sebagai React context.
 *
 * Menyediakan:
 *   - `user`    : identitas actor kanonis (null kalau belum login)
 *   - `session` : sesi aktif (null kalau belum login)
 *   - `loading` : true selama pengecekan sesi awal
 *   - `signInWithGoogle()` : OAuth via Google
 *   - `signInWithEmail(email, password)` : email+password
 *   - `signUpWithEmail(email, password)` : registrasi baru
 *   - `signOut()` : logout
 *
 * AuthProvider harus membungkus seluruh app SEBELUM komponen yang butuh data
 * user. Provider Neon memverifikasi cookie/sesi server secara langsung.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session, AuthError } from '../lib/auth/types';
import {authRuntime,isAuthConfigured,isNeonAuth} from '../lib/authRuntime';
import { hashPin, verifyPinHash } from '../lib/auth/pinSecurity';
import { BusinessSector } from '../types';
import { registerCloudAccount } from '../lib/auth/cloudSignup';
import {setReadScope} from '../lib/sync/refreshCoordinator';
import {claimCheckoutIntent} from '../lib/workspace/checkoutIntent';
import {restoreAuthSession} from '../lib/auth/sessionLifecycle';

export interface SignUpOptions {
  fullName?: string;
  storeName?: string;
  sector?: BusinessSector;
  firstOutletName?: string;
  secondOutletName?: string;
}

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  restoreError: boolean;
  /** True when the selected identity provider is configured. */
  configured: boolean;
  mfaRequired:boolean;
  verifySecondFactor:(code:string,recovery?:boolean)=>Promise<{error:AuthError|null}>;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUpWithEmail: (
    email: string,
    password: string,
    options?: string | SignUpOptions
  ) => Promise<{ error: AuthError | null; requiresEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextType | undefined>(undefined);

const LOCAL_SESSION_KEY = 'nhpos_local_session';
const LOCAL_USERS_KEY = 'nhpos_local_auth_users';

interface LocalUserRecord {
  email: string;
  passwordHash?: string;
  fullName?: string;
  storeName?: string;
  sector?: string;
}

function getLocalUsers(): Record<string, LocalUserRecord> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '{}');
  } catch {
    return {};
  }
}

async function saveLocalUser(
  email: string,
  pass: string,
  fullName?: string,
  storeName?: string,
  sector?: string
): Promise<void> {
  const users = getLocalUsers();
  const hashedPassword = await hashPin(pass);
  users[email.toLowerCase()] = {
    email: email.toLowerCase(),
    fullName,
    storeName,
    sector,
    passwordHash: hashedPassword,
  };
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

function createLocalSession(email: string, fullName?: string, storeName?: string): { user: User; session: Session } {
  const u: User = {
    id: 'usr-' + email.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email, full_name: fullName || email.split('@')[0], store_name: storeName },
    aud: 'authenticated',
    confirmation_sent_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    email,
    phone: '',
    role: 'authenticated',
    updated_at: new Date().toISOString(),
  } as unknown as User;

  const s: Session = {
    access_token: 'local-session-token-' + Date.now(),
    refresh_token: 'local-session-refresh-' + Date.now(),
    expires_in: 86400 * 30,
    expires_at: Math.floor(Date.now() / 1000) + 86400 * 30,
    token_type: 'bearer',
    user: u,
  };

  return { user: u, session: s };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoreError,setRestoreError]=useState(false);
  const [mfaRequired,setMfaRequired]=useState(false);
  React.useLayoutEffect(()=>{
    setReadScope(user?.id||'anonymous');
    if(user?.id)try{claimCheckoutIntent(user.id);}catch{/* Form hints never block authentication. */}
  },[user?.id]);

  useEffect(() => {
    if (!isAuthConfigured) {
      if(isNative()||isNeonAuth){setLoading(false);return;}
      try {
        const saved = localStorage.getItem(LOCAL_SESSION_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          setUser(parsed.user);
          setSession(parsed.session);
        }
      } catch (e) {
        console.error('Failed to restore local session', e);
      }
      setLoading(false);
      return;
    }

    if(isNeonAuth)authRuntime.auth.startAutoRefresh();
    const stop=restoreAuthSession<Session|null>(
      authRuntime.auth.getSession().then(({data,error})=>{if(error)throw error;return data.session;}),
      receive=>{
        const {data:{subscription}}=authRuntime.auth.onAuthStateChange((event,session)=>{if(event==='MFA_REQUIRED'){setSession(null);setUser(null);setMfaRequired(true);setLoading(false);}else receive(session);});
        return()=>subscription.unsubscribe();
      },
      session=>{setSession(session);setUser(session?.user??null);setMfaRequired(false);setRestoreError(false);setLoading(false);},
      error=>{const mfa=(error as AuthError)?.code==='MFA_REQUIRED';setMfaRequired(mfa);setRestoreError(!mfa);setLoading(false);}
    );
    return()=>{stop();if(isNeonAuth)authRuntime.auth.stopAutoRefresh();};
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if(isNative())return (await import('../platform/runtime/nativeLifecycle')).nativeGoogleLogin();
    if (!isAuthConfigured) {
      if(isNeonAuth)return {error:{code:'AUTH_NOT_CONFIGURED',message:'Autentikasi Neon belum dikonfigurasi.'}};
      const sess = createLocalSession('demo.google@newhope.id', 'Google Demo User');
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
      setUser(sess.user);
      setSession(sess.session);
      return { error: null };
    }
    const { error } = await authRuntime.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: isNeonAuth?window.location.origin+'/overview':authRedirect(),
      },
    });
    return { error };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if((isNative()||isNeonAuth)&&!isAuthConfigured)return {error:{message:'Konfigurasi autentikasi native belum tersedia.'} as AuthError};
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { error: { message: 'Email dan password wajib diisi.' } as AuthError };
    }

    const localUsers = getLocalUsers();
    const userRecord = localUsers[cleanEmail];

    if (isAuthConfigured) {
      try {
        const { data, error } = await authRuntime.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (!error && data.session) {
          setSession(data.session);
          setUser(data.user);setMfaRequired(false);
          return { error: null };
        }

        if (error) {
          if(error.code==='MFA_REQUIRED'){setMfaRequired(true);return {error};}
          const msg = error.message.toLowerCase();
          if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
            return {
              error: {
                message: 'Akun dengan email ini belum terdaftar atau password salah.',
              } as AuthError,
            };
          }
          if (msg.includes('email not confirmed')) {
            return {
              error: {
                message: 'Email belum dikonfirmasi. Silakan periksa inbox email Anda.',
              } as AuthError,
            };
          }

          if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch failed')) {
            return {
              error: {
                message: 'Tidak dapat terhubung ke server cloud. Periksa koneksi internet Anda atau coba beberapa saat lagi.',
              } as AuthError,
            };
          }

          return { error };
        }
      } catch (err: any) {
        return { error: { message: 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.' } as AuthError };
      }
      return { error: { message: 'Login belum menghasilkan sesi yang valid. Silakan coba lagi.' } as AuthError };
    }

    // Offline / Local verification (Verifikasi ketat hash password, TIDAK ADA backdoor)
    if (userRecord && userRecord.passwordHash) {
      const isMatch = await verifyPinHash(password, userRecord.passwordHash);
      if (isMatch) {
        const sess = createLocalSession(cleanEmail, userRecord.fullName, userRecord.storeName);
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
        setUser(sess.user);
        setSession(sess.session);
        return { error: null };
      }
      return { error: { message: 'Password salah! Silakan coba lagi.' } as AuthError };
    }

    return { error: { message: 'Akun dengan email ini belum terdaftar atau password salah.' } as AuthError };
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string, options?: string | SignUpOptions) => {
      if((isNative()||isNeonAuth)&&!isAuthConfigured)return {error:{message:'Konfigurasi autentikasi native belum tersedia.'} as AuthError};
    const cleanEmail = email.trim().toLowerCase();
      const opts: SignUpOptions = typeof options === 'string' ? { storeName: options } : options || {};
      const fullName = opts.fullName?.trim() || opts.storeName?.trim() || cleanEmail.split('@')[0];
      const storeName = opts.storeName?.trim() || 'Toko Baru';
      const sector = opts.sector || 'FNB';
      if (!cleanEmail || !password) return { error: { message: 'Email dan password wajib diisi.' } as AuthError };
      if (password.length < 8) return { error: { message: 'Password minimal 8 karakter.' } as AuthError };

      if (isAuthConfigured) {
        // Cloud signup must never create a synthetic offline session or cache a password.
        const result = await registerCloudAccount(authRuntime, {
          email: cleanEmail, password, fullName, storeName, sector,
          firstOutletName: opts.firstOutletName?.trim() || `${storeName} — Cabang Utama`,
          secondOutletName: opts.secondOutletName?.trim() || '',
          redirectTo: authRedirect(),
        });
        if (result.session) {
          setSession(result.session);
          setUser(result.session.user);
        }
        return { error: result.error, requiresEmailConfirmation: result.requiresEmailConfirmation };
      }

      // Explicit unconfigured demo mode only; never a fallback for a cloud error.
      await saveLocalUser(cleanEmail, password, fullName, storeName, sector);
      const sess = createLocalSession(cleanEmail, fullName, storeName);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
      setUser(sess.user);
      setSession(sess.session);
      return { error: null, requiresEmailConfirmation: false };
    },
    []
  );
  const signOut = useCallback(async () => {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    localStorage.removeItem('newhope_pos_guest_mode');
    sessionStorage.removeItem('nhpos_internal_identity');
    localStorage.removeItem('nhpos_internal_identity');

    if (isAuthConfigured) {
      try {
        const result=await authRuntime.auth.signOut();if(result.error)throw result.error;
      } catch (e) {
        if(isNeonAuth)throw e;console.warn('Logout belum dikonfirmasi server.');
      }
    }

    setUser(null);
    setSession(null);setMfaRequired(false);
  }, []);

  const verifySecondFactor=async(code:string,recovery=false)=>{const result=await authRuntime.auth.mfa.challengeAndVerify({factorId:'neon-totp',code,recovery});if(result.error)return {error:result.error};const restored=await authRuntime.auth.getSession();if(restored.error)return {error:restored.error};setSession(restored.data.session);setUser(restored.data.session?.user||null);setMfaRequired(false);return {error:null};};
  return (
    <AuthCtx.Provider
      value={{
        user,
        session,
        loading,
        restoreError,
        configured: isAuthConfigured,
        mfaRequired,verifySecondFactor,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}
