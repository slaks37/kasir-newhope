/**
 * LoginPage — Halaman Masuk & Pendaftaran Akun Toko Baru
 *
 * Mendukung:
 *   - Masuk dengan Email + Password
 *   - Pendaftaran Akun Toko Baru (Nama Toko, Sektor Usaha, Email, Password)
 *   - Mode Akses Demo Instan (1-Klik)
 *   - Navigasi kembali ke Landing Page
 */

import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  ArrowRight,
  Zap,
  CheckCircle2,
  Coffee,
  ShoppingBag,
  Shirt,
  Scissors,
  Car,
} from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { BusinessSector } from "../../data/businessPresets";

interface LoginPageProps {
  onBackToLanding?: () => void;
  initialMode?: "login" | "register";
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onBackToLanding,
  initialMode = "login",
}) => {
  const { signInWithEmail, signUpWithEmail } = useAuth();

  const [mode, setMode] = useState<"login" | "register">(initialMode);

  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  React.useEffect(() => {
    window.location.hash = mode;
  }, [mode]);

  const [fullName, setFullName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [sector, setSector] = useState<BusinessSector>("FNB");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNotRegistered, setIsNotRegistered] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sectorOptions: {
    id: BusinessSector;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "FNB",
      label: "Resto / Kafe",
      icon: <Coffee className="w-3.5 h-3.5" />,
    },
    {
      id: "RETAIL",
      label: "Toko Ritel",
      icon: <ShoppingBag className="w-3.5 h-3.5" />,
    },
    {
      id: "LAUNDRY",
      label: "Laundry",
      icon: <Shirt className="w-3.5 h-3.5" />,
    },
    {
      id: "BARBERSHOP",
      label: "Barbershop",
      icon: <Scissors className="w-3.5 h-3.5" />,
    },
    { id: "CARWASH", label: "Carwash", icon: <Car className="w-3.5 h-3.5" /> },
  ];

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsNotRegistered(false);

    if (!email.trim() || !password.trim()) {
      setError("Email dan password wajib diisi.");
      return;
    }
    if (password.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }

    if (mode === "register" && !storeName.trim()) {
      setError("Nama toko / usaha wajib diisi.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const { error: err } = await signInWithEmail(email, password);
        if (err) {
          if (
            err.message.toLowerCase().includes("invalid login credentials") ||
            err.message.toLowerCase().includes("user not found") ||
            err.message.toLowerCase().includes("invalid_grant")
          ) {
            setIsNotRegistered(true);
            setError(
              "Akun dengan email ini belum terdaftar atau password salah.",
            );
          } else if (
            err.message.toLowerCase().includes("failed to fetch") ||
            err.message.toLowerCase().includes("fetch failed") ||
            err.message.toLowerCase().includes("network")
          ) {
            setError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda atau coba lagi beberapa saat.");
          } else {
            setError(err.message);
          }
        }
      } else {
        const { error: err } = await signUpWithEmail(email, password, {
          fullName: fullName.trim() || storeName.trim(),
          storeName: storeName.trim(),
          sector,
        });
        if (err) {
          if (
            err.message.toLowerCase().includes("already registered") ||
            err.message.toLowerCase().includes("sudah terdaftar")
          ) {
            setError("Email ini sudah terdaftar! Silakan login.");
            setMode("login");
          } else if (
            err.message.toLowerCase().includes("failed to fetch") ||
            err.message.toLowerCase().includes("fetch failed") ||
            err.message.toLowerCase().includes("network")
          ) {
            setError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda atau coba lagi beberapa saat.");
          } else {
            setError(err.message);
          }
        } else {
          if (storeName.trim()) {
            try {
              const currentSettings = JSON.parse(
                localStorage.getItem("newhope_settings") || "{}",
              );
              localStorage.setItem(
                "newhope_settings",
                JSON.stringify({
                  ...currentSettings,
                  storeName: storeName.trim(),
                  businessSector: sector,
                  storeMode: sector,
                }),
              );
            } catch (e) {
              console.error("Failed to update store settings", e);
            }
          }
          setSuccess("Pendaftaran berhasil! Membuka kasir toko baru Anda...");
          setTimeout(() => {
            window.location.hash = "";
          }, 800);
        }
      }
    } catch {
      setError("Belum dapat terhubung. Periksa koneksi Anda, lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchToRegister = () => {
    setMode("register");
    setError(null);
    setIsNotRegistered(false);
  };

  return (
    <AuthLayout register={mode === "register"} onBack={onBackToLanding}>
      <div className="nh-auth-tabs" aria-label="Jenis akses akun">
        {(["login", "register"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            disabled={loading}
            onClick={() => {
              setMode(item);
              setError(null);
              setSuccess(null);
              setIsNotRegistered(false);
            }}
          >
            {item === "login" ? "Masuk" : "Daftar toko"}
          </button>
        ))}
      </div>
      <div className="nh-form-heading">
        <span className="nh-app-eyebrow">
          {mode === "login" ? "RUANG KERJA ANDA" : "MULAI PERJALANAN ANDA"}
        </span>
        <h1>
          {mode === "login" ? "Masuk ke toko Anda" : "Buat ruang untuk tumbuh."}
        </h1>
        <p>
          {mode === "login"
            ? "Lanjutkan operasional dengan akun yang sudah terdaftar."
            : "Lengkapi informasi usaha. Kami siapkan ruang kasir Anda."}
        </p>
      </div>
      {sessionStorage.getItem("nhpos_pending_checkout_plan") && (
        <div className="nh-form-notice">
          <Zap size={18} />
          <span>
            <strong>Langkah 1 dari 2</strong>
            <br />
            {mode === "login" ? "Masuk" : "Buat akun"} untuk melanjutkan
            pembayaran dan aktivasi paket pilihan.
          </span>
        </div>
      )}
      <form
        onSubmit={handleEmailAuth}
        className="nh-auth-form"
        aria-busy={loading}
      >
        <fieldset disabled={loading} className="nh-form-fields">
          {mode === "register" && (
            <>
              <div className="nh-field-row">
                <div className="nh-field">
                  <label htmlFor="owner-name">
                    Nama pemilik <span>(opsional)</span>
                  </label>
                  <input
                    id="owner-name"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nama lengkap Anda"
                  />
                </div>
                <div className="nh-field">
                  <label htmlFor="store-name">Nama usaha</label>
                  <input
                    id="store-name"
                    autoComplete="organization"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Contoh: Kopi Harapan"
                    required
                  />
                </div>
              </div>
              <fieldset className="nh-sector-field">
                <legend>Jenis usaha</legend>
                <div className="nh-sector-options">
                  {sectorOptions.map((s) => (
                    <label
                      key={s.id}
                      className={sector === s.id ? "is-selected" : ""}
                    >
                      <input
                        type="radio"
                        name="business-sector"
                        value={s.id}
                        checked={sector === s.id}
                        onChange={() => setSector(s.id)}
                      />
                      {s.icon}
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
                <p className="nh-field-hint">
                  Menu kasir akan disesuaikan dengan jenis usaha Anda.
                </p>
              </fieldset>
            </>
          )}
          <div className="nh-field">
            <label htmlFor="login-email">Email</label>
            <div className="nh-input-icon">
              <Mail size={17} />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                autoComplete="email"
                required
              />
            </div>
          </div>
          <div className="nh-field">
            <label htmlFor="login-password">Kata sandi</label>
            <div className="nh-input-icon">
              <Lock size={17} />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === "register"
                    ? "Buat kata sandi Anda"
                    : "Masukkan kata sandi"
                }
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={6}
                aria-describedby={
                  mode === "register" ? "password-hint" : undefined
                }
                required
              />
              <button
                type="button"
                className="nh-password-toggle"
                aria-label={
                  showPassword
                    ? "Sembunyikan kata sandi"
                    : "Tampilkan kata sandi"
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {mode === "register" && (
              <p id="password-hint" className="nh-field-hint">
                Gunakan minimal 6 karakter.
              </p>
            )}
          </div>
        </fieldset>
        {error && (
          <div className="nh-form-alert" role="alert">
            <AlertCircle size={18} />
            <div>
              {error}
              {isNotRegistered && (
                <button
                  type="button"
                  onClick={handleSwitchToRegister}
                  className="nh-app-text-link"
                >
                  Daftarkan akun ini <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        )}
        {success && (
          <div className="nh-form-alert is-success" role="status">
            <CheckCircle2 size={18} />
            <span>{success}</span>
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="nh-app-button-primary nh-auth-submit"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />{" "}
              {mode === "login" ? "Sedang masuk…" : "Menyiapkan toko…"}
            </>
          ) : (
            <>
              {mode === "login" ? "Masuk ke kasir" : "Daftar & buat toko"}
              <ArrowRight size={18} />
            </>
          )}
        </button>
      </form>
      <p className="nh-auth-switch">
        {mode === "login" ? "Baru di New Hope POS?" : "Sudah punya akun?"}{" "}
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
            setSuccess(null);
          }}
        >
          {mode === "login" ? "Buat akun toko" : "Masuk di sini"}
        </button>
      </p>
    </AuthLayout>
  );
};
