/**
 * AuthContext — sesi Supabase Auth sebagai React context.
 *
 * Menyediakan:
 *   - `user`    : objek user Supabase (null kalau belum login)
 *   - `session` : sesi aktif (null kalau belum login)
 *   - `loading` : true selama pengecekan sesi awal
 *   - `signInWithGoogle()` : OAuth via Google
 *   - `signInWithEmail(email, password)` : email+password
 *   - `signUpWithEmail(email, password)` : registrasi baru
 *   - `signOut()` : logout
 *
 * AuthProvider harus membungkus seluruh app SEBELUM komponen yang butuh data
 * user. Session di-persist oleh Supabase di localStorage; buka tab baru tidak
 * perlu login ulang.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { hashPin, verifyPinHash } from '../lib/auth/pinSecurity';
import { BusinessSector } from '../types';

export interface SignUpOptions {
  fullName?: string;
  storeName?: string;
  sector?: BusinessSector;
}

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True kalau Supabase env vars sudah terisi. */
  configured: boolean;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUpWithEmail: (
    email: string,
    password: string,
    options?: string | SignUpOptions
  ) => Promise<{ error: AuthError | null }>;
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

  useEffect(() => {
    if (!isSupabaseConfigured) {
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

    // Ambil sesi yang sudah ada di localStorage / Supabase SDK
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Subscribe ke perubahan state auth (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) {
      const sess = createLocalSession('demo.google@newhope.id', 'Google Demo User');
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
      setUser(sess.user);
      setSession(sess.session);
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    return { error };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { error: { message: 'Email dan password wajib diisi.' } as AuthError };
    }

    const localUsers = getLocalUsers();
    const userRecord = localUsers[cleanEmail];

    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (!error && data.session) {
          setSession(data.session);
          setUser(data.user);
          return { error: null };
        }

        if (error) {
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

          // Jika jaringan offline / Supabase down, cek verifikasi hash lokal
          if (userRecord && userRecord.passwordHash) {
            const isMatch = await verifyPinHash(password, userRecord.passwordHash);
            if (isMatch) {
              const sess = createLocalSession(cleanEmail, userRecord.fullName, userRecord.storeName);
              localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
              setUser(sess.user);
              setSession(sess.session);
              return { error: null };
            }
          }
          return { error };
        }
      } catch (err: any) {
        console.warn('[auth] Supabase network error, verifying local salted hash credentials:', err);
      }
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
      const cleanEmail = email.trim().toLowerCase();
      const opts: SignUpOptions = typeof options === 'string' ? { storeName: options } : options || {};
      const fullName = opts.fullName?.trim() || opts.storeName?.trim() || cleanEmail.split('@')[0];
      const storeName = opts.storeName?.trim() || 'Toko Baru';
      const sector = opts.sector || 'FNB';

      if (!cleanEmail || !password) {
        return { error: { message: 'Email dan password wajib diisi.' } as AuthError };
      }
      if (password.length < 6) {
        return { error: { message: 'Password minimal 6 karakter.' } as AuthError };
      }

      // 1. Simpan user secara lokal dengan salted hash (aman offline-first)
      await saveLocalUser(cleanEmail, password, fullName, storeName, sector);

      if (isSupabaseConfigured) {
        try {
          // A. Coba custom_signup RPC yang menyiapkan tenant, merchant, outlet, & role OWNER secara atomik
          try {
            const { data: rpcData, error: rpcErr } = await supabase.rpc('custom_signup', {
              user_email: cleanEmail,
              user_password: password,
              store_name: storeName,
              full_name: fullName,
              sector: sector,
            });

            if (!rpcErr && rpcData?.ok) {
              const loginRes = await supabase.auth.signInWithPassword({
                email: cleanEmail,
                password,
              });
              if (!loginRes.error && loginRes.data.session) {
                setSession(loginRes.data.session);
                setUser(loginRes.data.user);
                return { error: null };
              }
            }

            if (rpcErr || (rpcData && !rpcData.ok)) {
              const errMsg = rpcData?.error || rpcErr?.message || '';
              if (errMsg.toLowerCase().includes('already registered') || errMsg.toLowerCase().includes('sudah terdaftar')) {
                return { error: { message: 'Email ini sudah terdaftar! Silakan login.' } as AuthError };
              }
            }
          } catch (rpcEx) {
            console.warn('[auth] custom_signup RPC fallback to standard signup:', rpcEx);
          }

          // B. Fallback ke standard Supabase Auth signUp
          const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: fullName,
                store_name: storeName,
                business_sector: sector,
              },
            },
          });

          if (signUpErr) {
            if (signUpErr.message.toLowerCase().includes('already registered')) {
              return { error: { message: 'Email ini sudah terdaftar! Silakan login.' } as AuthError };
            }
            return { error: signUpErr };
          }

          if (signUpData?.user) {
            if (signUpData.session) {
              setSession(signUpData.session);
              setUser(signUpData.user);
              return { error: null };
            }
            // Auto login jika email confirmation tidak wajib
            const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            });
            if (!signInErr && signInData.session) {
              setSession(signInData.session);
              setUser(signInData.user);
              return { error: null };
            }
          }
        } catch (err: any) {
          console.warn('[auth] Supabase signup error, using local fallback:', err);
        }
      }

      // 2. Resilient local session fallback
      const sess = createLocalSession(cleanEmail, fullName, storeName);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
      setUser(sess.user);
      setSession(sess.session);

      // Kirim email selamat datang jika service billing aktif
      fetch('/api/v1/auth/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      }).catch(() => {});

      return { error: null };
    },
    []
  );

  const signOut = useCallback(async () => {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    localStorage.removeItem('newhope_pos_guest_mode');
    sessionStorage.removeItem('nhpos_internal_identity');
    localStorage.removeItem('nhpos_internal_identity');

    if (isSupabaseConfigured) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.error('Supabase signOut error', e);
      }
    }

    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        session,
        loading,
        configured: isSupabaseConfigured,
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
