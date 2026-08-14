import { useCallback, useEffect, useState } from 'react';
import {
  Activity, ClipboardList, LayoutDashboard, LogOut, Package, Receipt, ShieldCheck, Store,
} from 'lucide-react';
import { api, getIdentity, setIdentity, ROLE_LABEL, type Identity, type Session } from './api';
import { ErrorBox, Loading } from './ui';
import Overview from './pages/Overview';
import Merchants from './pages/Merchants';
import Transactions from './pages/Transactions';
import Products from './pages/Products';
import ActivityPage from './pages/Activity';
import Audit from './pages/Audit';
import UserManagement from './pages/UserManagement';

type PageId = 'overview' | 'merchants' | 'transactions' | 'products' | 'activity' | 'audit' | 'users';

/**
 * Setiap menu menyatakan capability yang dibutuhkannya. Menu yang tidak dimiliki
 * role tidak ditampilkan — tapi itu hanya kerapian, bukan keamanan. Yang
 * sesungguhnya menjaga adalah guard di server; menyembunyikan tombol tidak
 * menghalangi siapa pun memanggil endpointnya langsung.
 */
const NAV: Array<{ id: PageId; label: string; icon: any; cap: string }> = [
  { id: 'overview', label: 'Ringkasan Sektor', icon: LayoutDashboard, cap: 'VIEW_SECTOR_ANALYTICS' },
  { id: 'merchants', label: 'Merchant', icon: Store, cap: 'VIEW_MERCHANT_HEALTH' },
  { id: 'users', label: 'User Admin & Client', icon: ShieldCheck, cap: 'VIEW_ACCESS_AUDIT' },
  { id: 'transactions', label: 'Log Transaksi', icon: Receipt, cap: 'VIEW_TRANSACTION_LOG' },
  { id: 'products', label: 'Produk Terjual', icon: Package, cap: 'VIEW_PRODUCT_SALES' },
  { id: 'activity', label: 'Jejak Aktivitas', icon: Activity, cap: 'VIEW_ACTIVITY_LOG' },
  { id: 'audit', label: 'Jejak Akses', icon: ClipboardList, cap: 'VIEW_ACCESS_AUDIT' },
];

function LoginScreen({ onPick }: { onPick: (email: string) => void }) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [email, setEmail] = useState('stefenlaksana.sl@gmail.com');
  const [password, setPassword] = useState('Stefen2012');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.identities().then((r) => setIdentities(r.identities));
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    try {
      if (!email.trim()) {
        setErr('Email admin wajib diisi.');
        return;
      }
      // Direct pass for superadmin / preset identities
      onPick(email.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-xl">
        {/* Return to POS Link */}
        <div className="mb-5">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-amber-400 transition-colors"
          >
            ← Kembali ke Kasir Utama
          </a>
        </div>

        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-amber-500 p-3 text-slate-950 shadow-lg shadow-amber-500/20">
            <ShieldCheck className="h-6 w-6 text-slate-950" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white">
              Back-Office & Admin
            </h1>
            <p className="text-xs text-slate-400">New Hope POS — Konsol Penyedia & Superadmin</p>
          </div>
        </div>

        {/* 1-Click Superadmin Quick Access */}
        <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400">
              Superadmin Account (Active)
            </span>
            <span className="px-2 py-0.5 bg-amber-500 text-slate-950 font-black text-[9px] rounded-full">
              Full Access
            </span>
          </div>
          <p className="text-xs font-bold text-white">stefenlaksana.sl@gmail.com</p>
          <p className="text-[11px] text-slate-400 mb-3">Stefen Laksana (Platform Superadmin)</p>
          <button
            onClick={() => onPick('stefenlaksana.sl@gmail.com')}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Masuk Langsung sebagai Superadmin ➔</span>
          </button>
        </div>

        {/* Email & Password Admin Form */}
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1.5">
              Email Administrator
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@newhopepos.id"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 block mb-1.5">
              Password Administrator
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {err && (
            <p className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
              {err}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-xs rounded-xl transition-all"
          >
            Masuk dengan Akun Di Atas
          </button>
        </form>

        {/* Other Internal Roles */}
        <div className="mt-6 pt-4 border-t border-slate-800">
          <p className="text-[11px] font-bold text-slate-400 mb-2">Pilih Role Internal Lainnya:</p>
          <div className="space-y-1.5">
            {identities.filter(i => i.email !== 'stefenlaksana.sl@gmail.com').map((i) => (
              <button
                key={i.email}
                onClick={() => onPick(i.email)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 hover:bg-slate-950 border border-slate-800/80 hover:border-slate-700 text-left transition-all text-xs"
              >
                <div>
                  <span className="font-bold text-white block">{i.full_name}</span>
                  <span className="text-[10px] text-slate-500">{i.email}</span>
                </div>
                <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
                  {ROLE_LABEL[i.role]}
                </span>
              </button>
            ))}
          </div>
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
    if (!getIdentity()) {
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
        setIdentity(null);
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
          onPick={(email) => {
            setIdentity(email);
            setBooting(true);
            load();
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
                setIdentity(null);
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
        {page === 'overview' && <Overview onOpenSector={openSector} />}
        {page === 'merchants' && <Merchants sector={sector} onSector={setSector} />}
        {page === 'users' && <UserManagement />}
        {page === 'transactions' && <Transactions sector={sector} onSector={setSector} />}
        {page === 'products' && <Products sector={sector} onSector={setSector} />}
        {page === 'activity' && <ActivityPage sector={sector} onSector={setSector} />}
        {page === 'audit' && <Audit />}
      </main>
    </div>
  );
}
