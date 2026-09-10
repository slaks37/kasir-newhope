import { useCallback, useEffect, useState, useRef } from "react";
import {
  Menu,
  X,
  ArrowRight,
  Activity,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Package,
  Receipt,
  ShieldCheck,
  Store,
  CreditCard,
  BookOpen,
  Award,
} from "lucide-react";
import {
  api,
  getIdentity,
  setIdentity,
  ROLE_LABEL,
  type Identity,
  type Session,
} from "./api";
import { ErrorBox, Loading } from "./ui";
import { AuthLayout } from "../components/auth/AuthLayout";
import { Brand } from "../components/brand/Brand";
import Overview from "./pages/Overview";
import Merchants from "./pages/Merchants";
import Transactions from "./pages/Transactions";
import Products from "./pages/Products";
import ActivityPage from "./pages/Activity";
import Audit from "./pages/Audit";
import UserManagement from "./pages/UserManagement";
import Subscriptions from "./pages/Subscriptions";
import BlogManagement from "./pages/BlogManagement";
import StaffCommissions from "./pages/StaffCommissions";

type PageId =
  | "overview"
  | "merchants"
  | "subscriptions"
  | "commissions"
  | "users"
  | "blog"
  | "transactions"
  | "products"
  | "activity"
  | "audit";

/**
 * Setiap menu menyatakan capability yang dibutuhkannya. Menu yang tidak dimiliki
 * role tidak ditampilkan — tapi itu hanya kerapian, bukan keamanan. Yang
 * sesungguhnya menjaga adalah guard di server; menyembunyikan tombol tidak
 * menghalangi siapa pun memanggil endpointnya langsung.
 */
const NAV: Array<{ id: PageId; label: string; icon: any; cap: string }> = [
  {
    id: "overview",
    label: "Ringkasan Sektor",
    icon: LayoutDashboard,
    cap: "VIEW_SECTOR_ANALYTICS",
  },
  {
    id: "merchants",
    label: "Merchant",
    icon: Store,
    cap: "VIEW_MERCHANT_HEALTH",
  },
  {
    id: "subscriptions",
    label: "Langganan (SaaS)",
    icon: CreditCard,
    cap: "VIEW_MERCHANT_HEALTH",
  },
  {
    id: "commissions",
    label: "Komisi & Staf",
    icon: Award,
    cap: "VIEW_TRANSACTION_LOG",
  },
  {
    id: "blog",
    label: "Blog Harapan Baru",
    icon: BookOpen,
    cap: "VIEW_SECTOR_ANALYTICS",
  },
  {
    id: "users",
    label: "User Admin & Client",
    icon: ShieldCheck,
    cap: "VIEW_ACCESS_AUDIT",
  },
  {
    id: "transactions",
    label: "Log Transaksi",
    icon: Receipt,
    cap: "VIEW_TRANSACTION_LOG",
  },
  {
    id: "products",
    label: "Produk Terjual",
    icon: Package,
    cap: "VIEW_PRODUCT_SALES",
  },
  {
    id: "activity",
    label: "Jejak Aktivitas",
    icon: Activity,
    cap: "VIEW_ACTIVITY_LOG",
  },
  {
    id: "audit",
    label: "Jejak Akses",
    icon: ClipboardList,
    cap: "VIEW_ACCESS_AUDIT",
  },
];

function LoginScreen({
  onLoginSuccess,
}: {
  onLoginSuccess: (session: Session) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);

    if (!email.trim() || !password.trim()) {
      setErr("Mohon masukkan Email dan Password administrator.");
      return;
    }

    setLoading(true);
    try {
      const sess = await api.login(email.trim(), password.trim());
      onLoginSuccess(sess);
    } catch (e: any) {
      setErr(
        e.message || "Login gagal. Periksa kembali kredensial admin Anda.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout admin>
      <div className="nh-form-heading">
        <span className="nh-app-eyebrow">ADMIN WORKSPACE</span>
        <h1>Masuk ke konsol admin</h1>
        <p>
          Gunakan akun administrator yang telah diberikan akses ke platform New
          Hope POS.
        </p>
      </div>
      <form
        onSubmit={handleLoginSubmit}
        className="nh-auth-form"
        aria-busy={loading}
      >
        <fieldset disabled={loading} className="nh-form-fields">
          <div className="nh-field">
            <label htmlFor="admin-email">Email administrator</label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nama@perusahaan.com"
              autoComplete="username"
              required
            />
          </div>
          <div className="nh-field">
            <label htmlFor="admin-password">Kata sandi</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan kata sandi"
              autoComplete="current-password"
              required
            />
          </div>
        </fieldset>
        {err && (
          <div className="nh-form-alert" role="alert">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="nh-app-button-primary nh-auth-submit"
        >
          {loading ? "Memverifikasi akses…" : "Masuk ke konsol admin"}
          <ArrowRight size={18} />
        </button>
      </form>
      <div className="nh-auth-switch flex items-center justify-center gap-2">
        <ShieldCheck size={16} /> Khusus administrator yang berwenang.
      </div>
    </AuthLayout>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<{ code?: string; message: string } | null>(
    null,
  );
  const [page, setPage] = useState<PageId>("overview");
  // Filter sektor hidup di sini, bukan di tiap halaman: berpindah dari
  // "Ringkasan" ke "Log Transaksi" harus mempertahankan sektor yang sedang
  // ditelusuri, bukan mengembalikannya ke semua.
  const [sector, setSector] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 1023px)").matches,
  );
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => {
      setCompact(media.matches);
      if (!media.matches) setNavOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () =>
      Array.from(
        navRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])",
        ) || [],
      ).filter((el) => el.getClientRects().length);
    elements()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
      if (event.key !== "Tab") return;
      const items = elements(),
        first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      menuRef.current?.focus();
    };
  }, [navOpen]);

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
        if (allowed.length && !allowed.some((n) => n.id === page))
          setPage(allowed[0].id);
      },
      (e) => {
        setIdentity(null);
        setError({ code: e.code, message: e.message });
        setBooting(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(load, [load]);

  if (booting) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
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
            if (allowed.length && !allowed.some((n) => n.id === page))
              setPage(allowed[0].id);
          }}
        />
      </>
    );
  }

  const menu = NAV.filter((n) => session.capabilities.includes(n.cap));
  const openSector = (s: string) => {
    setSector(s);
    if (session.capabilities.includes("VIEW_TRANSACTION_LOG"))
      setPage("transactions");
  };

  return (
    <div className="nh-admin">
      {navOpen && (
        <button
          className="nh-admin-overlay"
          onClick={() => setNavOpen(false)}
          aria-label="Tutup navigasi admin"
          tabIndex={-1}
        />
      )}
      <aside
        ref={navRef}
        id="admin-navigation"
        className={`nh-admin-sidebar ${navOpen ? "is-open" : ""}`}
        inert={compact && !navOpen ? true : undefined}
        role={compact && navOpen ? "dialog" : undefined}
        aria-modal={compact && navOpen ? true : undefined}
        aria-label="Navigasi administrator"
      >
        <div className="flex items-center justify-between gap-2 px-2">
          <a href="/" aria-label="New Hope POS — halaman utama">
            <Brand admin />
          </a>
          {compact && (
            <button
              onClick={() => setNavOpen(false)}
              className="nh-admin-menu-toggle"
              aria-label="Tutup navigasi"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <div>
          <p className="nh-sidebar-caption">KELOLA PLATFORM</p>
          <nav className="nh-sidebar-nav">
            {menu.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setPage(n.id);
                  setNavOpen(false);
                }}
                aria-current={page === n.id ? "page" : undefined}
                className="nh-sidebar-item"
              >
                <n.icon />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="nh-sidebar-foot">
          <span>
            <ShieldCheck size={16} /> Akses sesuai peran
          </span>
          <strong>{ROLE_LABEL[session.user.role]}</strong>
          <small>Lingkungan: {session.environment}</small>
          <a href="/" className="nh-app-text-link">
            Ke halaman utama <ArrowRight size={14} />
          </a>
        </div>
      </aside>
      <div className="nh-admin-body" inert={navOpen ? true : undefined}>
        <header className="nh-admin-header">
          <button
            ref={menuRef}
            className="nh-admin-menu-toggle"
            aria-label="Buka navigasi admin"
            aria-controls="admin-navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div>
            <span className="nh-app-eyebrow">PLATFORM / ADMINISTRASI</span>
            <h1>
              {menu.find((n) => n.id === page)?.label || "Admin workspace"}
            </h1>
          </div>
          <div className="nh-admin-account">
            <div className="nh-admin-avatar" aria-hidden="true">
              {session.user.fullName.charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>{session.user.fullName}</strong>
              <small>{ROLE_LABEL[session.user.role]}</small>
            </div>
            <button
              onClick={() => {
                void api.logout();
                setIdentity(null);
                setSession(null);
              }}
              aria-label="Keluar dari admin"
              title="Keluar dari admin"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="nh-admin-main" id="admin-main">
          {page === "overview" && <Overview onOpenSector={openSector} />}
          {page === "merchants" && (
            <Merchants sector={sector} onSector={setSector} />
          )}
          {page === "subscriptions" && <Subscriptions />}
          {page === "commissions" && <StaffCommissions />}
          {page === "users" && <UserManagement />}
          {page === "blog" && <BlogManagement />}
          {page === "transactions" && (
            <Transactions sector={sector} onSector={setSector} />
          )}
          {page === "products" && (
            <Products sector={sector} onSector={setSector} />
          )}
          {page === "activity" && (
            <ActivityPage sector={sector} onSector={setSector} />
          )}
          {page === "audit" && <Audit />}
        </main>
      </div>
    </div>
  );
}
