import React, { useState } from 'react';
import { usePOS } from '../context/POSContext';
import { PermissionFeature } from '../types';
import {
  Home,
  ShoppingCart,
  Grid2X2,
  Package,
  Users,
  BarChart3,
  Bot,
  Settings,
  MoreHorizontal,
  X,
  UserCheck,
  LogOut,
  Clock,
  Shield,
} from 'lucide-react';
import { BUSINESS_PRESETS } from '../data/businessPresets';

interface MobileNavBarProps {
  onOpenAiCopilot: () => void;
  onOpenEndShift: () => void;
  onOpenClockIn: () => void;
  onOpenSwitchUser: () => void;
}

export const MobileNavBar: React.FC<MobileNavBarProps> = ({
  onOpenAiCopilot,
  onOpenEndShift,
  onOpenClockIn,
  onOpenSwitchUser,
}) => {
  const {
    activeTab,
    setActiveTab,
    products,
    heldOrders,
    hasPermission,
    settings,
    currentUser,
    shift,
  } = usePOS();

  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const activePreset = BUSINESS_PRESETS[settings?.businessSector || 'FNB'] || BUSINESS_PRESETS.FNB;
  const layoutTabLabel = activePreset.layoutTerm?.tabLabel || 'Meja';

  const lowStockCount = products.filter((p) => p.stock <= p.minStockAlert).length;

  const mainNavItems = [
    {
      id: 'home' as const,
      label: 'Beranda',
      icon: Home,
    },
    {
      id: 'pos' as const,
      label: 'Kasir',
      icon: ShoppingCart,
      badge: heldOrders.length > 0 ? heldOrders.length : undefined,
      badgeColor: 'bg-amber-500 text-slate-950',
    },
    {
      id: 'tables' as const,
      label: layoutTabLabel,
      icon: Grid2X2,
    },
    {
      id: 'inventory' as const,
      label: 'Stok',
      icon: Package,
      badge: lowStockCount > 0 ? lowStockCount : undefined,
      badgeColor: 'bg-rose-600 text-white',
    },
  ];

  const moreNavItems = [
    {
      id: 'customers' as const,
      label: 'Pelanggan & Member',
      icon: Users,
      desc: 'Database & riwayat poin pelanggan',
    },
    {
      id: 'reports' as const,
      label: 'Laporan & Analitik',
      icon: BarChart3,
      desc: 'Omzet harian, laba kotor & ringkasan kas',
    },
    {
      id: 'ai' as const,
      label: 'AI Copilot Assistant',
      icon: Bot,
      desc: 'Tanya asisten pintar bisnis Anda',
      special: true,
    },
    {
      id: 'settings' as const,
      label: 'Pengaturan Toko',
      icon: Settings,
      desc: 'Struk, pajak, staf & langganan',
    },
  ];

  return (
    <>
      {/* Bottom Navigation Bar (Visible only on mobile/tablet < 1024px) */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-2 pt-1 pb-safe flex items-center justify-around select-none"
        aria-label="Mobile Navigation"
      >
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id && !showMoreMenu;
          const isAllowed = hasPermission(item.id as PermissionFeature);

          return (
            <button
              key={item.id}
              onClick={() => {
                setShowMoreMenu(false);
                setActiveTab(item.id);
              }}
              className={`relative flex flex-col items-center justify-center flex-1 py-1.5 px-1 rounded-xl transition-all ${
                isActive
                  ? 'text-amber-600 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                {item.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center shadow-xs ${
                      item.badgeColor || 'bg-amber-500 text-slate-950'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 w-8 h-0.5 bg-amber-500 rounded-full" />
              )}
            </button>
          );
        })}

        {/* "Lainnya" / More Menu Button */}
        <button
          onClick={() => setShowMoreMenu(true)}
          className={`relative flex flex-col items-center justify-center flex-1 py-1.5 px-1 rounded-xl transition-all ${
            showMoreMenu || ['customers', 'reports', 'ai', 'settings'].includes(activeTab)
              ? 'text-amber-600 font-bold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] tracking-tight mt-0.5">Lainnya</span>
          {(showMoreMenu || ['customers', 'reports', 'ai', 'settings'].includes(activeTab)) && (
            <span className="absolute bottom-0 w-8 h-0.5 bg-amber-500 rounded-full" />
          )}
        </button>
      </nav>

      {/* Slide-Up More Menu Bottom Sheet */}
      {showMoreMenu && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/60 backdrop-blur-xs animate-fade-in">
          {/* Backdrop click to close */}
          <div className="flex-1" onClick={() => setShowMoreMenu(false)} />

          {/* Drawer Body */}
          <div className="bg-white rounded-t-3xl shadow-2xl p-5 pb-safe space-y-4 max-h-[85vh] overflow-y-auto animate-slide-up border-t border-slate-100">
            {/* Header Drawer */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-base text-slate-900">Menu & Layanan</h3>
                <p className="text-xs text-slate-500">
                  Login: <b>{currentUser.name}</b> ({currentUser.role})
                </p>
              </div>
              <button
                onClick={() => setShowMoreMenu(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Menu Nav Links */}
            <div className="grid grid-cols-1 gap-2">
              {moreNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const isAllowed = hasPermission(item.id as PermissionFeature);

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setShowMoreMenu(false);
                      setActiveTab(item.id);
                    }}
                    className={`w-full flex items-center gap-3.5 p-3 rounded-2xl text-left transition-all ${
                      isActive
                        ? 'bg-amber-500/10 text-amber-900 border border-amber-300 shadow-xs'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200/70'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        item.special
                          ? 'bg-gradient-to-tr from-amber-500 to-orange-500 text-slate-950 shadow-xs'
                          : isActive
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-white text-slate-700 border border-slate-200'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {item.label}
                        </span>
                        {!isAllowed && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[9px] font-bold">
                            Terkunci
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{item.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Quick Actions (Switch User, Shift, Clock In) */}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenSwitchUser();
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center gap-2 transition-all"
              >
                <UserCheck className="w-4 h-4 text-slate-600" />
                <span>Ganti Kasir</span>
              </button>

              <button
                onClick={() => {
                  setShowMoreMenu(false);
                  onOpenEndShift();
                }}
                className="py-2.5 px-3 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold flex items-center justify-center gap-2 transition-all"
              >
                <Clock className="w-4 h-4 text-amber-700" />
                <span>{shift ? 'Tutup Shift' : 'Buka Shift'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
