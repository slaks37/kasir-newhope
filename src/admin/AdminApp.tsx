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

type PageId = 'overview' | 'merchants' | 'transactions' | 'products' | 'activity' | 'audit';

/**
 * Setiap menu menyatakan capability yang dibutuhkannya. Menu yang tidak dimiliki
 * role tidak ditampilkan — tapi itu hanya kerapian, bukan keamanan. Yang
 * sesungguhnya menjaga adalah guard di server; menyembunyikan tombol tidak
 * menghalangi siapa pun memanggil endpointnya langsung.
 */
const NAV: Array<{ id: PageId; label: string; icon: any; cap: string }> = [
  { id: 'overview', label: 'Ringkasan Sektor', icon: LayoutDashboard, cap: 'VIEW_SECTOR_ANALYTICS' },
  { id: 'merchants', label: 'Merchant', icon: Store, cap: 'VIEW_MERCHANT_HEALTH' },
  { id: 'transactions', label: 'Log Transaksi', icon: Receipt, cap: 'VIEW_TRANSACTION_LOG' },
  { id: 'products', label: 'Produk Terjual', icon: Package, cap: 'VIEW_PRODUCT_SALES' },
  { id: 'activity', label: 'Jejak Aktivitas', icon: Activity, cap: 'VIEW_ACTIVITY_LOG' },
  { id: 'audit', label: 'Jejak Akses', icon: ClipboardList, cap: 'VIEW_ACCESS_AUDIT' },
];

function LoginScreen({ onPick }: { onPick: (email: string) => void }) {
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.identities().then(
      (r) => setIdentities(r.identities),
      (e) => setErr(e.message)
    );
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="rounded-lg bg-slate-900 p-2 dark:bg-slate-100">
            <ShieldCheck className="h-5 w-5 text-white dark:text-slate-900" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Back-Office Internal
            </h1>
            <p className="text-xs text-slate-500">New Hope POS — konsol penyedia</p>
          </div>
        </div>

        {err && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        {!identities && !err && <Loading label="Memuat identitas…" />}

        {identities && (
          <>
            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              Pilih identitas untuk masuk. Perhatikan bedanya menu tiap role.
            </p>
            <div className="space-y-2">
              {identities.map((i) => (
                <button
                  key={i.email}
                  onClick={() => onPick(i.email)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-left transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{i.full_name}</p>
                  <p className="text-xs text-slate-500">{i.email}</p>
                  <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                    {ROLE_LABEL[i.role]}
                  </p>
                </button>
              ))}
            </div>

            {/*
              Ini bukan autentikasi dan tidak boleh disalahpahami sebagai
              autentikasi. Ditulis di layar supaya tidak ada yang lupa.
            */}
            <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
              <b>Belum ada autentikasi.</b> Identitas dikirim lewat header, tanpa kata sandi. Cukup
              untuk pengembangan di localhost — wajib diganti SSO sebelum konsol ini menyala di
              admin.domainanda.com.
            </p>
          </>
        )}
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
        {page === 'transactions' && <Transactions sector={sector} onSector={setSector} />}
        {page === 'products' && <Products sector={sector} onSector={setSector} />}
        {page === 'activity' && <ActivityPage sector={sector} onSector={setSector} />}
        {page === 'audit' && <Audit />}
      </main>
    </div>
  );
}
