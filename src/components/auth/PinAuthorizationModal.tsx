import React, { useState, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { UserRole } from '../../types';
import { ShieldAlert, X, KeyRound, Lock, AlertCircle, ShieldCheck } from 'lucide-react';
import { getPinLockoutStatus } from '../../lib/auth/pinSecurity';

interface PinAuthorizationModalProps {
  title?: string;
  description?: string;
  requiredRoles?: UserRole[];
  onClose: () => void;
  onAuthorized: (authorizedByRole: UserRole, authorizedByName: string) => void;
}

export const PinAuthorizationModal: React.FC<PinAuthorizationModalProps> = ({
  title = 'Otorisasi Manager / Admin Required',
  description = 'Fitur ini memerlukan verifikasi PIN dari Manager atau Admin toko.',
  requiredRoles = ['ADMIN', 'MANAGER'],
  onClose,
  onAuthorized,
}) => {
  const { verifyPin } = usePOS();
  const [pinInput, setPinInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Status Lockout & Percobaan
  const [lockoutSec, setLockoutSec] = useState(() => getPinLockoutStatus().remainingSec);
  const [attemptsLeft, setAttemptsLeft] = useState(() => getPinLockoutStatus().attemptsLeft);

  // Timer hitung mundur saat lockout aktif
  useEffect(() => {
    if (lockoutSec <= 0) return;
    const interval = setInterval(() => {
      setLockoutSec((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setAttemptsLeft(3);
          setErrorMessage('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutSec]);

  const isLockedOut = lockoutSec > 0;

  const handleKeyClick = (num: string) => {
    if (isLockedOut || isVerifying) return;
    if (pinInput.length < 4) {
      setPinInput((prev) => prev + num);
      setErrorMessage('');
    }
  };

  const handleBackspace = () => {
    if (isLockedOut || isVerifying) return;
    setPinInput((prev) => prev.slice(0, -1));
    setErrorMessage('');
  };

  const handleClear = () => {
    if (isLockedOut || isVerifying) return;
    setPinInput('');
    setErrorMessage('');
  };

  const handleVerify = async () => {
    if (isLockedOut || isVerifying) return;

    if (pinInput.length !== 4) {
      setErrorMessage('Masukkan 4 digit PIN Supervisor / Manager');
      return;
    }

    setIsVerifying(true);
    try {
      const result = await verifyPin(pinInput, requiredRoles);

      if (result.isLockedOut && result.remainingSec) {
        setLockoutSec(result.remainingSec);
        setAttemptsLeft(0);
        setErrorMessage(result.message || 'Terminal terkunci!');
        setPinInput('');
        return;
      }

      if (!result.success) {
        setAttemptsLeft(result.attemptsLeft ?? 0);
        setErrorMessage(result.message || 'PIN Salah atau Otorisasi Ditolak!');
        setPinInput('');
        return;
      }

      /*
       * Sengaja TIDAK menuntut result.user.
       *
       * Otorisasi diverifikasi server terhadap internal.memberships, dan
       * manajer yang menyetujui belum tentu ada di daftar staf yang tersimpan
       * di perangkat ini. Menuntut kecocokan lokal akan menolak otorisasi yang
       * justru sah — persis kasus yang paling sering terjadi di cabang baru.
       */
      onAuthorized(
        result.authorizedByRole || result.user?.role || 'MANAGER',
        result.authorizedByName || result.user?.name || 'Manajer'
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-scale-up">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-rose-900 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-400/30 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">{title}</h3>
              <p className="text-xs text-rose-200/80">{description}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content & Keypad */}
        <div className="p-6 space-y-5">
          {/* Lockout Active Banner */}
          {isLockedOut ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-1 animate-pulse">
              <div className="flex items-center justify-center space-x-2 text-rose-700 font-extrabold text-sm">
                <Lock className="w-4 h-4 text-rose-600" />
                <span>TERMINAL POS TERKUNCI</span>
              </div>
              <p className="text-xs text-rose-600">
                Terlalu banyak percobaan PIN salah. Coba lagi dalam:
              </p>
              <div className="font-mono font-black text-2xl text-rose-800 pt-1">
                00:{lockoutSec.toString().padStart(2, '0')}
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-xs font-semibold text-slate-600">
                Masukkan PIN Supervisor (Role: {requiredRoles.join(' atau ')})
              </p>

              {/* PIN Display Dots */}
              <div className="flex justify-center items-center space-x-3 py-3 mt-3 bg-slate-50 border border-slate-200 rounded-2xl shadow-inner">
                {[0, 1, 2, 3].map((idx) => {
                  const isFilled = pinInput.length > idx;
                  return (
                    <div
                      key={idx}
                      className={`w-4 h-4 rounded-full transition-all ${
                        isFilled
                          ? 'bg-rose-600 scale-110 shadow-xs ring-2 ring-rose-300'
                          : 'bg-slate-300'
                      }`}
                    />
                  );
                })}
              </div>

              {/* Remaining Attempts Warning */}
              {attemptsLeft < 3 && attemptsLeft > 0 && !errorMessage && (
                <p className="text-[11px] font-bold text-amber-700 mt-2 flex items-center justify-center space-x-1">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Sisa {attemptsLeft} kali percobaan sebelum terminal terkunci</span>
                </p>
              )}

              {errorMessage && (
                <p className="text-xs font-bold text-rose-600 text-center mt-2 animate-shake">
                  {errorMessage}
                </p>
              )}
            </div>
          )}

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                type="button"
                disabled={isLockedOut || isVerifying}
                onClick={() => handleKeyClick(num)}
                className="py-3 bg-slate-50 hover:bg-slate-100 active:bg-rose-100 disabled:opacity-40 disabled:pointer-events-none border border-slate-200 rounded-2xl font-bold text-base text-slate-800 transition-all active:scale-95 shadow-xs"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              disabled={isLockedOut || isVerifying}
              onClick={handleClear}
              className="py-3 bg-slate-200 hover:bg-slate-300 disabled:opacity-40 disabled:pointer-events-none text-slate-700 rounded-2xl font-bold text-xs transition-all active:scale-95"
            >
              C
            </button>
            <button
              type="button"
              disabled={isLockedOut || isVerifying}
              onClick={() => handleKeyClick('0')}
              className="py-3 bg-slate-50 hover:bg-slate-100 active:bg-rose-100 disabled:opacity-40 disabled:pointer-events-none border border-slate-200 rounded-2xl font-bold text-base text-slate-800 transition-all active:scale-95 shadow-xs"
            >
              0
            </button>
            <button
              type="button"
              disabled={isLockedOut || isVerifying}
              onClick={handleBackspace}
              className="py-3 bg-slate-200 hover:bg-slate-300 disabled:opacity-40 disabled:pointer-events-none text-slate-700 rounded-2xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center"
            >
              ⌫
            </button>
          </div>

          {/* Security Badge */}
          <div className="flex items-center justify-center space-x-1.5 text-[10px] text-slate-400 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Enkripsi Kriptografis SHA-256 + Anti Brute-Force Rate Limiting</span>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isLockedOut || isVerifying || pinInput.length !== 4}
              onClick={handleVerify}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 disabled:pointer-events-none text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center justify-center space-x-1.5"
            >
              <KeyRound className="w-4 h-4" />
              <span>{isVerifying ? 'Memverifikasi...' : 'Verifikasi PIN'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

