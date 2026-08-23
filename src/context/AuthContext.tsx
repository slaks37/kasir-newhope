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
  signUpWithEmail: (
    email: string,
    password: string,
    toko?: { storeName: string; sector: string }
  ) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthContextType | undefined>(undefined);

/*
 * TIDAK ADA LAGI SESI LOKAL.
 *
 * Sebelumnya, bila Supabase belum dikonfigurasi, seluruh autentikasi berjalan
 * di dalam browser: siapa pun bisa "mendaftar" dengan email apa pun, mendapat
 * sesi buatan sendiri, dan langsung masuk ke aplikasi kasir. Tidak ada satu
 * permintaan pun ke server. Itu bukan login — itu tombol masuk yang menyamar
 * sebagai login, dan ia melewati seluruh paywall sekaligus.
 *
 * Sekarang aplikasi GAGAL TERTUTUP: tanpa konfigurasi yang benar tidak ada yang
 * bisa masuk, dan pesannya menyebut persis apa yang belum diisi. Lebih baik
 * berhenti dengan jelas daripada melayani orang yang sebenarnya tidak dikenal.
 */

const PESAN_BELUM_DIKONFIGURASI =
  'Layanan akun belum tersambung, jadi tidak ada yang bisa masuk. ' +
  'Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di server, lalu muat ulang.';

function galatBelumDikonfigurasi(): { error: AuthError } {
  return { error: { message: PESAN_BELUM_DIKONFIGURASI } as AuthError };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Tidak ada sesi yang dipulihkan. Sesi lokal yang mungkin tertinggal dari
      // versi lama ikut dibuang, supaya perangkat yang pernah memakainya tidak
      // tetap "masuk" tanpa pernah benar-benar login.
      try {
        localStorage.removeItem('nhpos_local_session');
        localStorage.removeItem('nhpos_local_auth_users');
      } catch { /* penyimpanan tidak bisa dibaca: tidak ada yang perlu dibersihkan */ }
      setUser(null);
      setSession(null);
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
    if (!isSupabaseConfigured) return galatBelumDikonfigurasi();
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
    // PINTU BELAKANG DICABUT.
    //
    // Baris di sini dulu berbunyi:
    //
    //     const isDemo = cleanEmail.includes('budi') || cleanEmail.includes('admin')
    //                 || cleanEmail.includes('stefen') || cleanEmail.includes('ops');
    //     if (userRecord || isDemo) { ...beri sesi... }
    //
    // Artinya email apa pun yang MENGANDUNG kata "admin" — termasuk
    // admin@apapun.com — masuk dengan password apa pun, tanpa satu permintaan
    // pun ke server. Tidak ada akun, tidak ada merchant, tidak ada langganan,
    // dan karena itu tidak ada satu batas paket pun yang bisa ditegakkan.
    if (!isSupabaseConfigured) return galatBelumDikonfigurasi();

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }, []);

  const signUpWithEmail = useCallback(async (
    email: string,
    password: string,
    toko?: { storeName: string; sector: string }
  ) => {
    if (!isSupabaseConfigured) return galatBelumDikonfigurasi();

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

      // TOKONYA DIBUAT DI SERVER, bukan hanya di penyimpanan browser.
      //
      // Sebelumnya nama toko dan sektor hanya ditulis ke localStorage, dan baris
      // toko di server baru lahir saat sinkron pertama. Akibatnya pemilik baru
      // punya "toko" yang tidak ada di mana pun kecuali di perangkatnya sendiri
      // — tanpa merchant, tanpa langganan percobaan, dan tanpa batas paket yang
      // bisa ditegakkan.
      if (toko?.storeName && toko?.sector) {
        const res = await fetch('/api/v1/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: `${idPemilik}_${toko.sector}`,
            ownerRef: idPemilik,
            storeName: toko.storeName,
            sector: toko.sector,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          // Akunnya sudah jadi, tokonya belum. Dikatakan apa adanya alih-alih
          // membiarkan pemilik masuk ke kasir yang tidak punya toko.
          return { error: { message:
            'Akun berhasil dibuat, tetapi toko gagal didaftarkan. Coba masuk lagi, ' +
            'atau hubungi kami bila tetap gagal.' } as AuthError };
        }
        try {
          localStorage.setItem(`newhope_token_toko_${data.businessId}`, data.token);
        } catch { /* penyimpanan penuh: token diambil ulang saat dibutuhkan */ }
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
      localStorage.removeItem('nhpos_local_session');
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
