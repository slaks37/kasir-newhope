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

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True kalau Supabase env vars sudah terisi. */
  configured: boolean;
  signInWithGoogle: () => Promise<{ error: AuthError | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextType | undefined>(undefined);

const LOCAL_SESSION_KEY = 'nhpos_local_session';
const LOCAL_USERS_KEY = 'nhpos_local_auth_users';

function getLocalUsers(): Record<string, { email: string; passwordHash?: string; fullName?: string }> {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * Mengacak kata sandi sebelum disimpan.
 *
 * Sebelumnya baris ini menyimpan `passwordHash: pass` — nama kolomnya
 * menyiratkan sudah diamankan, isinya kata sandi asli. Siapa pun yang membuka
 * penyimpanan browser di perangkat kasir dapat membacanya, dan karena orang
 * sering memakai kata sandi yang sama, dampaknya melampaui aplikasi ini.
 *
 * Memakai SubtleCrypto (PBKDF2, 210.000 putaran) — tersedia di semua browser
 * modern tanpa menambah satu pun dependensi. Ini BUKAN pengganti autentikasi
 * server: mode ini memang hanya untuk pemasangan tanpa Supabase, dan siapa pun
 * yang memegang perangkat tetap bisa mengubah isi penyimpanan. Yang ia tutup
 * adalah kebocoran kata sandi itu sendiri.
 */
const PUTARAN_PBKDF2 = 210_000;

async function acakSandi(pass: string, garamB64?: string): Promise<string> {
  const enc = new TextEncoder();
  const garam = garamB64
    ? Uint8Array.from(atob(garamB64), (c) => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));
  const kunci = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bit = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: garam, iterations: PUTARAN_PBKDF2, hash: 'SHA-256' }, kunci, 256);
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  return `pbkdf2$${PUTARAN_PBKDF2}$${b64(garam)}$${b64(new Uint8Array(bit))}`;
}

async function sandiCocok(pass: string, tersimpan: string | undefined): Promise<boolean> {
  if (!tersimpan) return false;
  const bagian = tersimpan.split('$');
  // Nilai lama yang tersimpan apa adanya (sebelum perbaikan ini) tetap diterima
  // sekali supaya pengguna tidak terkunci di luar akunnya sendiri.
  if (bagian.length !== 4 || bagian[0] !== 'pbkdf2') return tersimpan === pass;
  const ulang = await acakSandi(pass, bagian[2]);
  // Perbandingan waktu-tetap tidak berarti di sini: seluruh datanya sudah ada
  // di perangkat penyerang. Yang penting kata sandinya tidak terbaca.
  return ulang === tersimpan;
}

async function saveLocalUser(email: string, pass: string, fullName?: string) {
  const users = getLocalUsers();
  users[email.toLowerCase()] = { email, fullName, passwordHash: await acakSandi(pass) };
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
}

function createLocalSession(email: string, fullName?: string): { user: User; session: Session } {
  const u: User = {
    id: 'usr-' + email.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email, full_name: fullName || email.split('@')[0] },
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

    // Ambil sesi yang sudah ada di localStorage.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Subscribe ke perubahan state auth (login, logout, token refresh).
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
        // Setelah Google selesai, kembali ke halaman ini.
        redirectTo: window.location.origin,
      },
    });
    return { error };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      const cleanEmail = email.trim().toLowerCase();
      const localUsers = getLocalUsers();
      const userRecord = localUsers[cleanEmail];

      const isDemo = cleanEmail.includes('budi') || cleanEmail.includes('admin') || cleanEmail.includes('stefen') || cleanEmail.includes('ops');
      if (userRecord || isDemo) {
        if (userRecord && userRecord.passwordHash && !(await sandiCocok(password, userRecord.passwordHash))) {
          return { error: { message: 'Password salah!' } as AuthError };
        }
        const sess = createLocalSession(email, userRecord?.fullName);
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
        setUser(sess.user);
        setSession(sess.session);
        return { error: null };
      }

      return { error: { message: 'Akun dengan email ini belum terdaftar atau password salah.' } as AuthError };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) {
      const cleanEmail = email.trim().toLowerCase();
      const localUsers = getLocalUsers();
      if (localUsers[cleanEmail]) {
        return { error: { message: 'Email ini sudah terdaftar! Silakan login.' } as AuthError };
      }
      await saveLocalUser(email, password);
      const sess = createLocalSession(email);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(sess));
      setUser(sess.user);
      setSession(sess.session);

      // Kirim email welcome via backend jika service aktif (fire-and-forget)
      fetch('/api/v1/auth/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => {});

      return { error: null };
    }

    try {
      // Pendaftaran akun ditangani Supabase Auth; pembuatan TOKO ditangani
      // endpoint kita sendiri (lihat api/v1/auth/register.ts).
      //
      // Sebelumnya keduanya dilakukan oleh satu fungsi basis data bernama
      // `custom_signup` — yang tidak pernah ada di rantai migrasi, sehingga
      // pendaftaran selalu gagal dan tidak ada pengguna baru yang bisa masuk.
      const { data: daftar, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      const idPemilik = daftar?.user?.id;
      if (!idPemilik) {
        return { error: { message: 'Pendaftaran akun gagal. Coba lagi.' } as AuthError };
      }

      // Jika berhasil, panggil backend untuk kirim email welcome (fire-and-forget)
      fetch('/api/v1/auth/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      }).catch(() => {});

      // Langsung login menggunakan password
      return await supabase.auth.signInWithPassword({ email, password });
    } catch (err: any) {
      return { error: { message: err.message } as AuthError };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      setUser(null);
      setSession(null);
      return;
    }
    await supabase.auth.signOut();
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
