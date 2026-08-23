import React, { useState } from 'react';
import { usePOS } from '../../context/POSContext';
import { User, UserRole } from '../../types';
import { verifyPinHash } from '../../lib/auth/pinSecurity';
import {
  Users,
  X,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  Lock,
  UserCheck,
  UserCog,
  Briefcase,
  Store,
  LogOut,
} from 'lucide-react';

interface SwitchUserModalProps {
  onClose: () => void;
  onLogout?: () => void;
}

export const SwitchUserModal: React.FC<SwitchUserModalProps> = ({ onClose, onLogout }) => {
  const { users, currentUser, switchUser, verifyPin } = usePOS();

  const [selectedUser, setSelectedUser] = useState<User | null>(currentUser);
  const [pinInput, setPinInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'ADMIN':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-100 text-purple-900 border border-purple-300 flex items-center space-x-1 shrink-0">
            <UserCog className="w-3 h-3 text-purple-700" />
            <span>ADMIN (Pemilik)</span>
          </span>
        );
      case 'MANAGER':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-900 border border-blue-300 flex items-center space-x-1 shrink-0">
            <Briefcase className="w-3 h-3 text-blue-700" />
            <span>MANAGER</span>
          </span>
        );
      case 'CASHIER':
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center space-x-1 shrink-0">
            <Store className="w-3 h-3 text-emerald-700" />
            <span>KASIR</span>
          </span>
        );
    }
  };

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

  const handleConfirmSwitch = async () => {
    if (!selectedUser) return;

    if (pinInput.length !== 4) {
      setErrorMessage('Masukkan 4 digit PIN pengguna');
      return;
    }

    const isMatch = await verifyPinHash(pinInput, selectedUser.pin);
    if (!isMatch) {
      setErrorMessage('PIN Salah! Silakan coba lagi.');
      setPinInput('');
      return;
    }

    switchUser(selectedUser);
    setSuccessMessage(`Berhasil login sebagai ${selectedUser.name} (${selectedUser.role})`);
    setTimeout(() => {
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-scale-up flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 bg-gradient-to-r from-slate-900 to-amber-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center">
              <Users className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-white">Ganti Akun & Pengguna Kasir</h3>
              <p className="text-xs text-amber-200/80">Pilih profil staf dan masukkan PIN otentikasi</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto flex-1">
          {/* User Selection List */}
          <div className="space-y-3">
            <h4 className="text-xs font-extrabold uppercase text-slate-500 tracking-wider">
              Pilih Pengguna Aktif
            </h4>

            <div className="space-y-2">
              {users.map((user) => {
                const isCurrent = currentUser.id === user.id;
                const isSelected = selectedUser?.id === user.id;

                return (
                  <button
                    key={user.id}
                    onClick={() => {
                      setSelectedUser(user);
                      setPinInput('');
                      setErrorMessage('');
                    }}
                    className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-500/10 border-amber-500 shadow-xs ring-2 ring-amber-500/20'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <img
                        src={
                          user.avatar ||
                          `https://ui-avatars.com/api/?name=${encodeURIComponent(
                            user.name
                          )}&background=f59e0b&color=fff`
                        }
                        alt={user.name}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-xs text-slate-900 truncate">
                            {user.name}
                          </span>
                          {isCurrent && (
                            <span className="bg-emerald-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0">
                              Aktif
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono truncate">
                          @{user.username}
                        </p>
                        <div className="mt-1">{getRoleBadge(user.role)}</div>
                      </div>
                    </div>

                    {isSelected && (
                      <CheckCircle2 className="w-5 h-5 text-amber-600 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* PIN Authentication Keypad */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4">
            <div>
              <div className="text-center mb-3">
                <span className="text-xs text-slate-500 font-semibold block">Otentikasi PIN</span>
                <p className="font-extrabold text-sm text-slate-900">
                  {selectedUser ? selectedUser.name : 'Pilih Akun'}
                </p>
                <p className="text-[10px] text-slate-500 font-mono">
                  Role: {selectedUser?.role || '-'}
                </p>
              </div>

              {/* PIN Display Dots */}
              <div className="flex justify-center items-center space-x-3 py-3 bg-white border border-slate-200 rounded-2xl shadow-inner">
                {[0, 1, 2, 3].map((idx) => {
                  const isFilled = pinInput.length > idx;
                  return (
                    <div
                      key={idx}
                      className={`w-4 h-4 rounded-full transition-all ${
                        isFilled
                          ? 'bg-amber-500 scale-110 shadow-xs ring-2 ring-amber-300'
                          : 'bg-slate-200'
                      }`}
                    />
                  );
                })}
              </div>

              {errorMessage && (
                <p className="text-[11px] font-bold text-rose-600 text-center mt-2 animate-shake">
                  {errorMessage}
                </p>
              )}

              {successMessage && (
                <p className="text-[11px] font-bold text-emerald-600 text-center mt-2">
                  {successMessage}
                </p>
              )}
            </div>

            {/* Keypad Buttons */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeyClick(num)}
                  className="py-3 bg-white hover:bg-slate-100 active:bg-amber-100 border border-slate-200 rounded-xl font-bold text-base text-slate-800 transition-all active:scale-95 shadow-xs"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClear}
                className="py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-xs transition-all active:scale-95"
              >
                C
              </button>
              <button
                type="button"
                onClick={() => handleKeyClick('0')}
                className="py-3 bg-white hover:bg-slate-100 active:bg-amber-100 border border-slate-200 rounded-xl font-bold text-base text-slate-800 transition-all active:scale-95 shadow-xs"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                className="py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-bold text-xs transition-all active:scale-95 flex items-center justify-center"
              >
                ⌫
              </button>
            </div>

            {/* Action Submit */}
            <button
              onClick={handleConfirmSwitch}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-slate-950 font-extrabold text-sm rounded-xl transition-all shadow-md flex items-center justify-center space-x-2 cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              <span>Masuk Sekarang</span>
            </button>

            {onLogout && (
              <button
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 font-extrabold text-xs rounded-xl border border-rose-200 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-rose-600" />
                <span>Keluar ke Halaman Depan</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Footer Role Summary */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 text-[10px] text-slate-600 flex flex-wrap items-center justify-between gap-2 px-6">
          <span className="font-semibold text-slate-700">Petunjuk Akses Role:</span>
          <span><b>ADMIN</b>: Akses Penuh</span>
          <span>• <b>MANAGER</b>: Operasional, Stok & Laporan</span>
          <span>• <b>KASIR</b>: Transaksi POS & Meja</span>
        </div>
      </div>
    </div>
  );
};
