import { useCallback, useEffect, useState } from 'react';
import {
  Activity, ClipboardList, LayoutDashboard, LogOut, Package, Receipt, ShieldCheck, Store, CreditCard, Tags, FlaskConical
} from 'lucide-react';
import { api, getToken, setToken, HALAMAN_DATA_CONTOH, ROLE_LABEL, type Session } from './api';
import { ErrorBox, Loading } from './ui';
import Overview from './pages/Overview';
import Merchants from './pages/Merchants';
import Transactions from './pages/Transactions';
import Products from './pages/Products';
import ActivityPage from './pages/Activity';
import Audit from './pages/Audit';
import UserManagement from './pages/UserManagement';
import Subscriptions from './pages/Subscriptions';
import Plans from './pages/Plans';

type PageId = 'overview' | 'merchants' | 'plans' | 'subscriptions' | 'transactions' | 'products' | 'activity' | 'audit' | 'users';

/**
 * Setiap menu menyatakan capability yang dibutuhkannya. Menu yang tidak dimiliki
 * role tidak ditampilkan — tapi itu hanya kerapian, bukan keamanan. Yang
 * sesungguhnya menjaga adalah guard di server; menyembunyikan tombol tidak
 * menghalangi siapa pun memanggil endpointnya langsung.
 */
const NAV: Array<{ id: PageId; label: string; icon: any; cap: string }> = [
  { id: 'overview', label: 'Ringkasan Sektor', icon: LayoutDashboard, cap: 'VIEW_SECTOR_ANALYTICS' },
  { id: 'merchants', label: 'Merchant', icon: Store, cap: 'VIEW_MERCHANT_HEALTH' },
  { id: 'plans', label: 'Paket & Harga', icon: Tags, cap: 'MANAGE_SUBSCRIPTION' },
  { id: 'subscriptions', label: 'Langganan (SaaS)', icon: CreditCard, cap: 'VIEW_MERCHANT_HEALTH' },
  { id: 'users', label: 'User Admin & Client', icon: ShieldCheck, cap: 'VIEW_ACCESS_AUDIT' },
  { id: 'transactions', label: 'Log Transaksi', icon: Receipt, cap: 'VIEW_TRANSACTION_LOG' },
  { id: 'products', label: 'Produk Terjual', icon: Package, cap: 'VIEW_PRODUCT_SALES' },
  { id: 'activity', label: 'Jejak Aktivitas', icon: Activity, cap: 'VIEW_ACTIVITY_LOG' },
  { id: 'audit', label: 'Jejak Akses', icon: ClipboardList, cap: 'VIEW_ACCESS_AUDIT' },
];

function LoginScreen({ onLoginSuccess }: { onLoginSuccess: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!email.trim() || !password.trim()) {
      setErr('Mohon masukkan Email dan Password administrator.');
      return;
    }

    setLoading(true);
    try {
      const sess = await api.login(email.trim(), password.trim());
      onLoginSuccess(sess);
    } catch (e: any) {
      setErr(e.message || 'Login gagal. Periksa kembali kredensial admin Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-8 shadow-2xl backdrop-blur-xl">
        {/* Return to POS Link */}
        <div className="mb-6">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-amber-400 transition-colors"
          >
            ← Kembali ke Halaman Utama
          </a>
        </div>

        <div className="mb-8 flex items-center gap-3.5">
          <div className="rounded-2xl bg-amber-500 p-3 text-slate-950 shadow-lg shadow-amber-500/20">
            <ShieldCheck className="h-6 w-6 text-slate-950" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">
              Back-Office Console
            </h1>
            <p className="text-xs text-slate-400">Portal Keamanan & Administrator Platform</p>
          </div>
        </div>

        {/* Secure Email & Password Admin Form */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">
              Email Administrator
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@perusahaan.com"
              autoComplete="username"
              required
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1.5">
              Password Administrator
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {err && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
              <span className="font-bold">⚠️</span>
              <span>{err}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Memverifikasi Kredensial…' : 'Masuk ke Konsol Admin ➔'}
          </button>
        </form>

        <div className="mt-8 pt-4 border-t border-slate-800 text-center">
          <p className="text-[11px] text-slate-500 font-medium">
            🔒 Akses dibatasi khusus developer & tim internal platform.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [page, setPage] = useState<PageId>('overview');
  // Filter sektor hidup di sini, bukan di tiap halaman: berpindah dari
  // "Ringkasan" ke "Log Transaksi" harus mempertahankan sektor yang sedang
  // ditelusuri, bukan mengembalikannya ke semua.
  const [sector, setSector] = useState('');

  const load = useCallback(() => {
    if (!getToken()) {
      setBooting(false);
      return;
    }
    api.me().then(
      (s) => {
        setSession(s);
        setError(null);
        setBooting(false);
        const allowed = NAV.filter((n) => s.capabilities.includes(n.cap));
        if (allowed.length && !allowed.some((n) => n.id === page)) setPage(allowed[0].id);
      },
      (e) => {
        setToken(null);
        setError({ code: e.code, message: e.message });
        setBooting(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Loading />
      </div>
    );
  }

  if (!session) {
    return (
      <>
        {error && (
          <div className="mx-auto max-w-md pt-4">
            <ErrorBox error={error} />
          </div>
        )}
        <LoginScreen
          onLoginSuccess={(s) => {
            setSession(s);
            setError(null);
            const allowed = NAV.filter((n) => s.capabilities.includes(n.cap));
            if (allowed.length && !allowed.some((n) => n.id === page)) setPage(allowed[0].id);
          }}
        />
      </>
    );
  }

  const menu = NAV.filter((n) => session.capabilities.includes(n.cap));
  const openSector = (s: string) => {
    setSector(s);
    if (session.capabilities.includes('VIEW_TRANSACTION_LOG')) setPage('transactions');
  };

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-slate-900 p-1.5 dark:bg-slate-100">
              <ShieldCheck className="h-4 w-4 text-white dark:text-slate-900" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Back-Office Internal</p>
              <p className="text-xs text-slate-500">{session.environment}</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <p className="text-xs font-medium text-slate-900 dark:text-slate-100">{session.user.fullName}</p>
              <p className="text-xs text-slate-500">{ROLE_LABEL[session.user.role]}</p>
            </div>
            <button
              onClick={() => {
                api.logout();
                setSession(null);
              }}
              title="Keluar"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2">
          {menu.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                page === n.id
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl p-4">
        {/* Angka yang meyakinkan tapi tidak nyata adalah cara tercepat mengambil
            keputusan yang salah. Halaman yang belum tersambung ke database
            mengatakannya sendiri, di tempat yang tidak bisa dilewatkan. */}
        {HALAMAN_DATA_CONTOH.includes(page) && (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-xs leading-relaxed">
              <b>Halaman ini masih menampilkan data contoh</b>, belum isi database. Jangan dipakai
              mengambil keputusan. Halaman <b>Paket &amp; Harga</b> sudah tersambung ke database sungguhan.
            </p>
          </div>
        )}
        {page === 'overview' && <Overview onOpenSector={openSector} />}
        {page === 'merchants' && <Merchants sector={sector} onSector={setSector} />}
        {page === 'plans' && <Plans />}
        {page === 'subscriptions' && <Subscriptions />}
        {page === 'users' && <UserManagement />}
        {page === 'transactions' && <Transactions sector={sector} onSector={setSector} />}
        {page === 'products' && <Products sector={sector} onSector={setSector} />}
        {page === 'activity' && <ActivityPage sector={sector} onSector={setSector} />}
        {page === 'audit' && <Audit />}
      </main>
    </div>
  );
}
