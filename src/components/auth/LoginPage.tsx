/**
 * LoginPage — Halaman Masuk & Pendaftaran Akun Toko Baru
 *
 * Mendukung:
 *   - Masuk dengan Email + Password
 *   - Pendaftaran Akun Toko Baru (Nama Toko, Sektor Usaha, Email, Password)
 *   - Mode Akses Demo Instan (1-Klik)
 *   - Navigasi kembali ke Landing Page
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  LogIn,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Store,
  ArrowRight,
  ArrowLeft,
  Zap,
  User,
  CheckCircle2,
  Coffee,
  ShoppingBag,
  Shirt,
  Scissors,
  Car,
} from 'lucide-react';
import { BusinessSector } from '../../data/businessPresets';

interface LoginPageProps {
  onBackToLanding?: () => void;
  onStartDemo?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onBackToLanding,
  onStartDemo,
}) => {
  const { signInWithEmail, signUpWithEmail, configured } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [sector, setSector] = useState<BusinessSector>('FNB');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNotRegistered, setIsNotRegistered] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sectorOptions: { id: BusinessSector; label: string; icon: React.ReactNode }[] = [
    { id: 'FNB', label: 'Resto / Kafe', icon: <Coffee className="w-3.5 h-3.5" /> },
    { id: 'RETAIL', label: 'Toko Ritel', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
    { id: 'LAUNDRY', label: 'Laundry', icon: <Shirt className="w-3.5 h-3.5" /> },
    { id: 'BARBERSHOP', label: 'Barbershop', icon: <Scissors className="w-3.5 h-3.5" /> },
    { id: 'CARWASH', label: 'Carwash', icon: <Car className="w-3.5 h-3.5" /> },
  ];

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsNotRegistered(false);

    if (!email.trim() || !password.trim()) {
      setError('Email dan password wajib diisi.');
      return;
    }
    if (password.length < 6) {
      setError('Password minimal 6 karakter.');
      return;
    }

    if (mode === 'register' && !storeName.trim()) {
      setError('Nama toko / usaha wajib diisi.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: err } = await signInWithEmail(email, password);
        if (err) {
          if (
            err.message.toLowerCase().includes('invalid login credentials') ||
            err.message.toLowerCase().includes('user not found') ||
            err.message.toLowerCase().includes('invalid_grant')
          ) {
            setIsNotRegistered(true);
            setError('Akun dengan email ini belum terdaftar atau password salah.');
          } else {
            setError(err.message);
          }
        }
      } else {
        const { error: err } = await signUpWithEmail(email, password);
        if (err) {
          if (err.message.toLowerCase().includes('already registered')) {
            setError('Email ini sudah terdaftar! Silakan login.');
            setMode('login');
          } else {
            setError(err.message);
          }
        } else {
          setSuccess('Pendaftaran berhasil! Silakan masuk dengan email dan password Anda.');
          // Auto login attempt or switch to login tab
          setTimeout(() => {
            setMode('login');
          }, 1500);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchToRegister = () => {
    setMode('register');
    setError(null);
    setIsNotRegistered(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden py-10 px-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-amber-500/3 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-scale-up">
        {/* Back to Landing Page Link */}
        {onBackToLanding && (
          <div className="mb-4">
            <button
              onClick={onBackToLanding}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-amber-400 bg-white/5 hover:bg-white/10 px-3.5 py-2 rounded-xl transition-all border border-white/10"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>← Kembali ke Halaman Depan</span>
            </button>
          </div>
        )}

        {/* Logo & Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-600 shadow-xl shadow-amber-500/25 mb-2">
            <Store className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            New Hope <span className="text-amber-400">POS</span>
          </h1>
          <p className="text-slate-400 text-xs mt-1 font-medium">
            {mode === 'login' ? 'Masuk ke Akun Kasir Toko Anda' : 'Daftar Akun Kasir Toko Baru (Gratis)'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5">
          {/* Quick Demo Access Bar */}
          {onStartDemo && (
            <button
              type="button"
              onClick={onStartDemo}
              className="w-full flex items-center justify-between p-3 bg-gradient-to-r from-amber-500/15 via-orange-500/15 to-amber-500/15 hover:from-amber-500/25 hover:to-orange-500/25 border border-amber-500/40 text-amber-300 rounded-2xl transition-all active:scale-98 group"
            >
              <div className="flex items-center gap-2.5 text-left">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 fill-amber-400" />
                </div>
                <div>
                  <span className="text-xs font-black text-amber-300 block">Coba Demo Kasir Instan</span>
                  <span className="text-[10px] text-slate-400">Masuk tanpa login untuk eksplorasi fitur</span>
                </div>
              </div>
              <span className="text-xs font-bold bg-amber-500 text-slate-950 px-2.5 py-1 rounded-lg">
                Coba ➔
              </span>
            </button>
          )}

          {/* Tab Mode Switcher: Login / Register */}
          <div className="grid grid-cols-2 gap-1 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); setIsNotRegistered(false); }}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                mode === 'login'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Masuk (Login)
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(null); setIsNotRegistered(false); }}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                mode === 'register'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Daftar Toko Baru
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleEmailAuth} className="space-y-3.5">
            {mode === 'register' && (
              <>
                {/* Full Name Input */}
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nama Lengkap Pemilik / Kasir"
                    className="w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-2xl text-white placeholder:text-slate-500 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                  />
                </div>

                {/* Store Name Input */}
                <div className="relative">
                  <Store className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Nama Usaha / Toko (Cth: Kopi Kenangan)"
                    className="w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-2xl text-white placeholder:text-slate-500 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                  />
                </div>

                {/* Sector Selector Chips */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 block">
                    Pilih Sektor Usaha:
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {sectorOptions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSector(s.id)}
                        className={`flex flex-col items-center justify-center p-2 rounded-xl text-[10px] font-bold border transition-all ${
                          sector === s.id
                            ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                            : 'bg-slate-950/40 text-slate-400 border-slate-800 hover:text-white'
                        }`}
                      >
                        {s.icon}
                        <span className="mt-1 truncate w-full text-center">{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Email Input */}
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Alamat Email"
                autoComplete="email"
                required
                className="w-full pl-11 pr-4 py-3 bg-slate-950/60 border border-slate-800 rounded-2xl text-white placeholder:text-slate-500 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
              />
            </div>

            {/* Password Input */}
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kata Sandi (min. 6 karakter)"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                className="w-full pl-11 pr-12 py-3 bg-slate-950/60 border border-slate-800 rounded-2xl text-white placeholder:text-slate-500 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Alert Error / User Not Found Helper */}
            {error && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs space-y-2 animate-fade-in">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
                  <span>{error}</span>
                </div>

                {isNotRegistered && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleSwitchToRegister}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <span>👉 Daftar Akun Ini Sekarang (Gratis)</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="flex items-start gap-2 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs animate-fade-in">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                <span>{success}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs rounded-2xl transition-all shadow-lg shadow-amber-500/20 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? <LogIn className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  <span>{mode === 'login' ? 'Masuk ke Kasir' : 'Daftar & Buat Toko Baru'}</span>
                </>
              )}
            </button>
          </form>

          {/* Toggle bottom link */}
          <div className="text-center pt-1 border-t border-slate-800/80">
            {mode === 'login' ? (
              <p className="text-xs text-slate-400">
                Belum punya akun?{' '}
                <button
                  type="button"
                  onClick={handleSwitchToRegister}
                  className="text-amber-400 hover:text-amber-300 font-extrabold transition-colors"
                >
                  Daftar Akun Baru
                </button>
              </p>
            ) : (
              <p className="text-xs text-slate-400">
                Sudah punya akun?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); }}
                  className="text-amber-400 hover:text-amber-300 font-extrabold transition-colors"
                >
                  Masuk di sini
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-500 mt-5">
          © {new Date().getFullYear()} New Hope POS · Cloud Point of Sale System
        </p>
      </div>
    </div>
  );
};
