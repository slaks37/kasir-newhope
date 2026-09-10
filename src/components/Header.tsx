import React from 'react';
import { BrandMark } from './brand/Brand';
import { usePOS } from '../context/POSContext';
import {
  Store,
  MoreHorizontal,
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
  LogOut,
  MessageSquare,
} from 'lucide-react';
import { formatRupiah } from '../utils/formatters';
import { WhatsAppLifecycleCenter } from './whatsapp/WhatsAppLifecycleCenter';
import { generateLifecycleHooks } from '../utils/whatsappLifecycle';

interface HeaderProps {
  onOpenAiCopilot?: () => void;
  onOpenHoldOrders?: () => void;
  onOpenRecentTransactions?: () => void;
  onOpenSwitchUser?: () => void;
  onOpenClockIn?: () => void;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAiCopilot,
  onOpenHoldOrders,
  onOpenRecentTransactions,
  onOpenSwitchUser,
  onOpenClockIn,
  onLogout,
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
    customers,
    orders,
    bookings,
    carwashQueue,
    sentLifecycleHookIds,
  } = usePOS();

  const [showLifecycleCenter, setShowLifecycleCenter] = React.useState(false);

  const pendingHooksCount = React.useMemo(() => {
    const hooks = generateLifecycleHooks({
      customers,
      orders,
      bookings,
      carwashQueue,
      sector: settings.businessSector || 'FNB',
      storeName: settings.storeName,
      sentHookIds: sentLifecycleHookIds,
    });
    return hooks.length;
  }, [customers, orders, bookings, carwashQueue, settings.businessSector, settings.storeName, sentLifecycleHookIds]);

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <header className="nh-workspace-header bg-white border-b border-slate-200 text-slate-900 flex items-center justify-between sticky top-0 z-30">
      <div className="nh-store-identity">
        <div className="nh-store-logo">{settings.logoUrl ? <img src={settings.logoUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full rounded-xl object-cover" /> : <BrandMark />}</div>
        <div className="min-w-0"><strong>{settings.storeName}</strong><span>New Hope POS <i />{settings.storeMode === 'FNB' ? 'F&B' : settings.storeMode === 'RETAIL' ? 'Ritel' : 'Jasa'}</span></div>
      </div>
      <div className="nh-header-search hidden md:block">
        <Search size={17} />
        <input type="search" aria-label="Cari produk, SKU, atau barcode" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Cari produk, SKU, atau barcode…" />
        {searchQuery && <button aria-label="Hapus pencarian" onClick={() => setSearchQuery('')}>×</button>}
      </div>
      <div className="nh-header-actions">
        {(syncStatus.pending > 0 || syncStatus.failures > 0) && <button className={`nh-header-sync ${syncStatus.failures > 0 ? 'has-error' : ''}`} onClick={forceSync} title={syncStatus.failures > 0 ? `Gagal mengirim (${syncStatus.lastError ?? 'tidak diketahui'}). ${syncStatus.pending} transaksi menunggu. Klik untuk mencoba lagi.` : `${syncStatus.pending} transaksi sedang dikirim ke pusat.`}>
          {syncStatus.failures > 0 ? <CloudAlert size={17} /> : <CloudUpload size={17} />}<span>{syncStatus.pending}</span>
        </button>}
        <details className="nh-toolbar-more" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); } }}>
          <summary aria-label="Alat operasional" title="Alat operasional"><MoreHorizontal size={20} /></summary>
          <div className="nh-toolbar-menu" onClick={e => { if ((e.target as HTMLElement).closest('button')) e.currentTarget.closest('details')?.removeAttribute('open'); }}>
            <span className="nh-sidebar-caption">ALAT OPERASIONAL</span>
            <button onClick={() => onOpenRecentTransactions?.()}><History size={17} /> Riwayat transaksi</button>
            <button onClick={() => onOpenHoldOrders?.()}><PauseCircle size={17} /> Pesanan ditahan <small>{heldOrders.length}</small></button>
            <button onClick={() => onOpenClockIn?.()}><UserCheck size={17} /> Absensi staf</button>
            <button onClick={() => onOpenAiCopilot ? onOpenAiCopilot() : setActiveTab('ai')}><Sparkles size={17} /> AI Copilot</button>
            <button onClick={() => setShowLifecycleCenter(true)}><MessageSquare size={17} /> WhatsApp pelanggan {pendingHooksCount > 0 && <small>{pendingHooksCount}</small>}</button>
            <button onClick={toggleSound}>{soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}{soundEnabled ? 'Matikan suara kasir' : 'Aktifkan suara kasir'}</button>
            <div className="nh-toolbar-shift"><Clock size={15} /><span>{shift.status === 'OPEN' ? 'Shift aktif' : 'Shift belum dibuka'}<strong>{formatRupiah(shift.totalSales)}</strong></span></div>
          </div>
        </details>
        <button className="nh-user-button" onClick={onOpenSwitchUser} title="Ganti pengguna / profil" aria-label={`Profil ${currentUser.name}, ${currentUser.role}. Ganti pengguna`}>
          <span className="nh-user-avatar">{currentUser.avatar ? <img src={currentUser.avatar} alt="" referrerPolicy="no-referrer" /> : currentUser.name.charAt(0).toUpperCase()}</span>
          <span className="nh-user-detail"><strong>{currentUser.name}</strong><small>{currentUser.role}</small></span><ChevronDown size={14} />
        </button>
        {onLogout && <button onClick={onLogout} className="nh-header-logout" aria-label="Keluar dari akun" title="Keluar dari akun"><LogOut size={17} /></button>}
      </div>
      <WhatsAppLifecycleCenter isOpen={showLifecycleCenter} onClose={() => setShowLifecycleCenter(false)} />
    </header>
  );
};
