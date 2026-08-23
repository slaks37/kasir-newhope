import React from 'react';
import { usePOS } from '../context/POSContext';
import {
  Store,
  Clock,
  Volume2,
  VolumeX,
  Sparkles,
  ShoppingBag,
  Layers,
  ChefHat,
  Search,
  PauseCircle,
  History,
  UserCheck,
  ChevronDown,
  UserCog,
  Briefcase,
  Globe,
  CloudUpload,
  CloudAlert,
} from 'lucide-react';
import { formatRupiah } from '../utils/formatters';

interface HeaderProps {
  onOpenAiCopilot?: () => void;
  onOpenHoldOrders?: () => void;
  onOpenRecentTransactions?: () => void;
  onOpenSwitchUser?: () => void;
  onOpenClockIn?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAiCopilot,
  onOpenHoldOrders,
  onOpenRecentTransactions,
  onOpenSwitchUser,
  onOpenClockIn,
}) => {
  const {
    settings,
    shift,
    cart,
    heldOrders,
    soundEnabled,
    toggleSound,
    searchQuery,
    setSearchQuery,
    setActiveTab,
    currentUser,
    syncStatus,
    forceSync,
  } = usePOS();

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <header className="bg-white border-b border-slate-200 text-slate-900 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-30 shadow-xs select-none">
      {/* Brand & Store Mode Info */}
      <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-600 shadow-md flex items-center justify-center overflow-hidden shrink-0">
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt="Logo"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <Store className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <h1 className="font-extrabold text-xs sm:text-base leading-tight tracking-wide text-slate-900 truncate">
              {settings.storeName}
            </h1>
            <span className="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold rounded-md bg-amber-100 text-amber-800 border border-amber-200 uppercase tracking-wider shrink-0">
              {settings.storeMode === 'FNB' ? 'F&B' : settings.storeMode === 'RETAIL' ? 'Ritel' : 'Jasa'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 hidden sm:block truncate">{settings.tagline}</p>
        </div>
      </div>

      {/* Global POS Search Bar (Desktop / Tablet only) */}
      <div className="flex-1 max-w-md mx-2 relative hidden md:block">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Cari produk, SKU, atau scan barcode..."
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all shadow-xs"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        )}
      </div>

      {/* Quick Action Toolbar */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
        {/* Staff Attendance Clock In / Out Button (Desktop / Tablet only) */}
        <button
          onClick={() => onOpenClockIn?.()}
          className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300/80 rounded-xl text-xs font-bold transition-all shadow-xs"
          title="Absensi & Presensi Masuk Staff (Clock In / Out)"
        >
          <UserCheck className="w-4 h-4 text-emerald-600" />
          <span className="hidden sm:inline">Clock In</span>
        </button>

        {/* Recent Transactions Button (Desktop only) */}
        <button
          onClick={() => onOpenRecentTransactions?.()}
          className="hidden lg:flex items-center space-x-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs"
          title="Lihat Riwayat Transaksi Terakhir & Void Order"
        >
          <History className="w-4 h-4 text-amber-600" />
          <span>Transaksi Terakhir</span>
        </button>

        {/* Held Orders Badge (Desktop only) */}
        {heldOrders.length > 0 && (
          <button
            onClick={() => onOpenHoldOrders?.()}
            className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300/80 rounded-xl text-xs font-semibold transition-colors shadow-xs"
          >
            <PauseCircle className="w-4 h-4 text-amber-600" />
            <span className="hidden md:inline">Pesanan Tertahan</span>
            <span className="bg-amber-500 text-slate-950 font-bold px-1.5 py-0.5 rounded-full text-[10px]">
              {heldOrders.length}
            </span>
          </button>
        )}

        {/* AI Copilot Button (Desktop only) */}
        <button
          onClick={() => {
            if (onOpenAiCopilot) {
              onOpenAiCopilot();
            } else {
              setActiveTab('ai');
            }
          }}
          className="hidden sm:flex items-center space-x-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all border border-purple-400/20"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          <span className="hidden md:inline">AI Copilot</span>
        </button>

        {/* Active User / Role Badge */}
        <button
          onClick={onOpenSwitchUser}
          className="flex items-center space-x-1.5 sm:space-x-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 p-1 sm:px-2.5 sm:py-1 rounded-xl transition-all shadow-xs group"
          title="Klik untuk ganti pengguna / profil RBAC"
        >
          <img
            src={
              currentUser.avatar ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                currentUser.name
              )}&background=f59e0b&color=fff`
            }
            alt={currentUser.name}
            referrerPolicy="no-referrer"
            className="w-6 h-6 rounded-lg object-cover border border-amber-500/30 shrink-0"
          />
          <div className="text-left hidden sm:block">
            <span className="font-extrabold text-[11px] text-slate-900 block leading-tight truncate max-w-[100px]">
              {currentUser.name}
            </span>
            <span
              className={`text-[9px] font-extrabold px-1 rounded block leading-tight ${
                currentUser.role === 'ADMIN'
                  ? 'bg-purple-100 text-purple-900'
                  : currentUser.role === 'MANAGER'
                  ? 'bg-blue-100 text-blue-900'
                  : 'bg-emerald-100 text-emerald-900'
              }`}
            >
              {currentUser.role}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-colors" />
        </button>

        {/* Shift Badge (Desktop only) */}
        <div className="hidden xl:flex items-center space-x-2 bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl text-xs text-slate-700">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <div>
            <span className="text-slate-500 block text-[10px]">
              Kasir: {shift.cashierName || currentUser?.name || 'Kasir'}
            </span>
            <span className="font-semibold text-emerald-700">{formatRupiah(shift.totalSales)}</span>
          </div>
        </div>

        {/* Sync Status Indicator */}
        {(syncStatus.pending > 0 || syncStatus.failures > 0) && (
          <button
            onClick={forceSync}
            title={
              syncStatus.failures > 0
                ? `Gagal mengirim (${syncStatus.lastError ?? 'tidak diketahui'}). ${syncStatus.pending} transaksi menunggu.`
                : `${syncStatus.pending} transaksi sedang dikirim ke pusat.`
            }
            className={`flex items-center gap-1 px-2 py-1.5 rounded-xl border text-xs font-bold transition-colors ${
              syncStatus.failures > 0
                ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
            }`}
          >
            {syncStatus.failures > 0 ? (
              <CloudAlert className="w-4 h-4" />
            ) : (
              <CloudUpload className={`w-4 h-4 ${syncStatus.inFlight ? 'animate-pulse' : ''}`} />
            )}
            <span className="tabular-nums text-[11px]">{syncStatus.pending}</span>
          </button>
        )}

        {/* Mute/Sound Toggle */}
        <button
          onClick={toggleSound}
          title={soundEnabled ? 'Matikan Suara POS' : 'Aktifkan Suara POS'}
          className="p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-600" /> : <VolumeX className="w-4 h-4 text-rose-500" />}
        </button>
      </div>
    </header>
  );
};
