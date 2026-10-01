import React from "react";
import { BrandMark } from "./brand/Brand";
import { usePOS } from "../context/POSContext";
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
  CloudAlert,
  LogOut,
  MessageSquare,
} from "lucide-react";
import { formatRupiah } from "../utils/formatters";
import { WhatsAppLifecycleCenter } from "./whatsapp/WhatsAppLifecycleCenter";
import { generateLifecycleHooks } from "../utils/whatsappLifecycle";
import { useTranslation } from "../i18n/LanguageContext";
import { LanguageSwitcher } from "./common/LanguageSwitcher";

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
    syncCenter,
    openSyncCenter,
    customers,
    orders,
    bookings,
    carwashQueue,
    sentLifecycleHookIds,
  } = usePOS();
  const { t } = useTranslation();

  const [showLifecycleCenter, setShowLifecycleCenter] = React.useState(false);

  const pendingHooksCount = React.useMemo(() => {
    const hooks = generateLifecycleHooks({
      customers,
      orders,
      bookings,
      carwashQueue,
      sector: settings.businessSector || "FNB",
      storeName: settings.storeName,
      sentHookIds: sentLifecycleHookIds,
    });
    return hooks.length;
  }, [
    customers,
    orders,
    bookings,
    carwashQueue,
    settings.businessSector,
    settings.storeName,
    sentLifecycleHookIds,
  ]);

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const syncFailed=syncCenter.phase==='error';
  const syncReview=syncCenter.phase==='review';

  return (
    <header className="nh-workspace-header bg-white border-b border-slate-200 text-slate-900 flex items-center justify-between sticky top-0 z-30">
      <div className="nh-store-identity">
        <div className="nh-store-logo">
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="w-full h-full rounded-xl object-cover"
            />
          ) : (
            <BrandMark />
          )}
        </div>
        <div className="min-w-0">
          <strong>{settings.storeName}</strong>
          <span>
            New Hope POS <i />
            {settings.storeMode === "FNB"
              ? "F&B"
              : settings.storeMode === "RETAIL"
                ? "Ritel"
                : "Jasa"}
          </span>
        </div>
      </div>
      <div className="nh-header-search hidden md:block">
        <Search size={17} />
        <input
          type="search"
          aria-label={t('header.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('header.searchPlaceholder')}
        />
        {searchQuery && (
          <button
            aria-label={t('header.clearSearch')}
            onClick={() => setSearchQuery("")}
          >
            ×
          </button>
        )}
      </div>
      <div className="nh-header-actions flex items-center gap-2">
        {heldOrders.length > 0 && (
          <button
            onClick={() => onOpenHoldOrders ? onOpenHoldOrders() : onOpenRecentTransactions?.()}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black shadow-xs transition-all animate-pulse cursor-pointer shrink-0"
            title={t('header.heldOrdersTitle', { count: heldOrders.length })}
          >
            <Clock size={14} />
            <span>{t('header.heldOrdersCount', { count: heldOrders.length })}</span>
          </button>
        )}
          {(syncFailed||syncReview||syncCenter.phase==='offline')&&<button
            className={`nh-header-sync ${syncFailed?'has-error':syncReview?'needs-review':''}`}
            onClick={openSyncCenter} title="Periksa data yang memerlukan perhatian"
            aria-label="Periksa data yang memerlukan perhatian" aria-haspopup="dialog"
          >
            <CloudAlert size={17}/>
            <span className="flex flex-col items-start text-left" aria-live="polite">
              <strong>{syncReview?'Data lama perlu ditinjau':syncCenter.phase==='offline'?'Offline · data tersimpan':'Koneksi data perlu diperiksa'}</strong>
            </span>
          </button>}
        <details
          className="nh-toolbar-more"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.open = false;
              e.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label={t('header.toolsMenu')} title={t('header.toolsMenu')}>
            <MoreHorizontal size={20} />
          </summary>
          <div
            className="nh-toolbar-menu"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button"))
                e.currentTarget.closest("details")?.removeAttribute("open");
            }}
          >
            <span className="nh-sidebar-caption">{t('header.toolsMenu')}</span>
            <button onClick={openSyncCenter}><CloudAlert size={17}/> Kesehatan data & pemulihan</button>
            <button onClick={() => onOpenRecentTransactions?.()}>
              <History size={17} /> {t('header.recentTransactions')}
            </button>
            <button onClick={() => onOpenHoldOrders?.()}>
              <PauseCircle size={17} /> {t('header.heldOrders')}{" "}
              <small>{heldOrders.length}</small>
            </button>
            <button onClick={() => onOpenClockIn?.()}>
              <UserCheck size={17} /> {t('header.staffAttendance')}
            </button>
            <button
              onClick={() =>
                onOpenAiCopilot ? onOpenAiCopilot() : setActiveTab("ai")
              }
            >
              <Sparkles size={17} /> {t('header.aiCopilot')}
            </button>
            <button onClick={() => setShowLifecycleCenter(true)}>
              <MessageSquare size={17} /> {t('header.whatsappCustomer')}{" "}
              {pendingHooksCount > 0 && <small>{pendingHooksCount}</small>}
            </button>
            <button onClick={toggleSound}>
              {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
              {soundEnabled ? t('header.soundMute') : t('header.soundUnmute')}
            </button>
            <div className="nh-toolbar-shift">
              <Clock size={15} />
              <span>
                {shift.status === "OPEN" ? t('header.shiftActive') : t('header.shiftClosed')}
                <strong>{formatRupiah(shift.totalSales)}</strong>
              </span>
            </div>
          </div>
        </details>

        {/* Multi-Language Switcher */}
        <LanguageSwitcher mode="compact" />

        <button
          className="nh-user-button"
          onClick={onOpenSwitchUser}
          title={t('header.switchUser')}
          aria-label={`Profil ${currentUser.name}, ${currentUser.role}. ${t('header.switchUser')}`}
        >
          <span className="nh-user-avatar">
            {currentUser.avatar ? (
              <img
                src={currentUser.avatar}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              currentUser.name.charAt(0).toUpperCase()
            )}
          </span>
          <span className="nh-user-detail">
            <strong>{currentUser.name}</strong>
            <small>{currentUser.role}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            className="nh-header-logout"
            aria-label={t('header.logout')}
            title={t('header.logout')}
          >
            <LogOut size={17} />
          </button>
        )}
      </div>
      <WhatsAppLifecycleCenter
        isOpen={showLifecycleCenter}
        onClose={() => setShowLifecycleCenter(false)}
      />
    </header>
  );
};
