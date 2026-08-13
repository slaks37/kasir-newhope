import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { UserRole } from '../../types';
import { ShieldAlert, X, KeyRound, CheckCircle2, Lock } from 'lucide-react';

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

  const handleKeyClick = (num: string) => {
    if (pinInput.length < 4) {
      setPinInput((prev) => prev + num);
      setErrorMessage('');
    }
  };

  const handleBackspace = () => {
    setPinInput((prev) => prev.slice(0, -1));
    setErrorMessage('');
  };

  const handleClear = () => {
    setPinInput('');
    setErrorMessage('');
  };

  const handleVerify = () => {
    if (pinInput.length !== 4) {
      setErrorMessage('Masukkan 4 digit PIN Supervisor / Manager');
      return;
    }

    const result = verifyPin(pinInput, requiredRoles);
    if (!result.success || !result.user) {
      setErrorMessage(result.message || 'PIN Salah atau Otorisasi Ditolak!');
      setPinInput('');
      return;
    }

    onAuthorized(result.user.role, result.user.name);
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

            {errorMessage && (
              <p className="text-xs font-bold text-rose-600 text-center mt-2 animate-shake">
                {errorMessage}
              </p>
            )}
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleKeyClick(num)}
                className="py-3 bg-slate-50 hover:bg-slate-100 active:bg-rose-100 border border-slate-200 rounded-2xl font-bold text-base text-slate-800 transition-all active:scale-95 shadow-xs"
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              className="py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-2xl font-bold text-xs transition-all active:scale-95"
            >
              C
            </button>
            <button
              type="button"
              onClick={() => handleKeyClick('0')}
              className="py-3 bg-slate-50 hover:bg-slate-100 active:bg-rose-100 border border-slate-200 rounded-2xl font-bold text-base text-slate-800 transition-all active:scale-95 shadow-xs"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              className="py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-2xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center"
            >
              ⌫
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleVerify}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center justify-center space-x-1.5"
            >
              <KeyRound className="w-4 h-4" />
              <span>Verifikasi PIN</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
