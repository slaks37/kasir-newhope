import React from 'react';
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
  Clock,
  Play,
  LogOut,
  AlertTriangle,
  Lock,
  UserCheck,
} from 'lucide-react';

import { BUSINESS_PRESETS } from '../data/businessPresets';

interface SidebarProps {
  onOpenAiCopilot: () => void;
  onOpenEndShift: () => void;
  onOpenClockIn: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onOpenAiCopilot,
  onOpenEndShift,
  onOpenClockIn,
}) => {
  const { activeTab, setActiveTab, products, heldOrders, shift, hasPermission, settings, staffMembers, getActiveAttendance } = usePOS();

  const activePreset = BUSINESS_PRESETS[settings?.businessSector || 'FNB'] || BUSINESS_PRESETS.FNB;
  const layoutTabLabel = activePreset.layoutTerm?.tabLabel || 'Denah Layout';

  // Count low stock items for badge alert
  const lowStockCount = products.filter((p) => p.stock <= p.minStockAlert).length;

  const navItems = [
    {
      id: 'home' as const,
      label: 'Beranda / Overview',
      icon: Home,
    },
    {
      id: 'pos' as const,
      label: 'Kasir (POS)',
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
      label: 'Produk & Stok',
      icon: Package,
      badge: lowStockCount > 0 ? lowStockCount : undefined,
      badgeColor: 'bg-rose-600 text-white',
    },
    {
      id: 'customers' as const,
      label: 'Pelanggan',
      icon: Users,
    },
    {
      id: 'reports' as const,
      label: 'Laporan',
      icon: BarChart3,
    },
    {
      id: 'ai' as const,
      label: 'AI Copilot',
      icon: Bot,
      special: true,
    },
    {
      id: 'settings' as const,
      label: 'Pengaturan',
      icon: Settings,
    },
  ];

  return (
    <aside className="w-16 lg:w-60 bg-white border-r border-slate-200 text-slate-700 flex flex-col justify-between shrink-0 select-none shadow-xs">
      {/* Navigation Links */}
      <div className="py-4 space-y-1.5 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isAllowed = hasPermission(item.id as PermissionFeature);

          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'ai') {
                  onOpenAiCopilot();
                } else {
                  setActiveTab(item.id);
                }
              }}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm shadow-amber-500/20'
                  : item.special
                  ? 'text-purple-700 hover:bg-purple-50 border border-purple-200/80'
                  : !isAllowed
                  ? 'text-slate-400 hover:bg-slate-100/70 hover:text-slate-600'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
              title={!isAllowed ? `Akses ${item.label} Memerlukan Role Manager / Admin` : undefined}
            >
              <div className="relative flex items-center justify-center">
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-slate-950' : item.special ? 'text-purple-600' : 'text-slate-500'}`} />
                {item.badge && (
                  <span
                    className={`lg:hidden absolute -top-1.5 -right-1.5 text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center ${item.badgeColor}`}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="hidden lg:inline truncate">{item.label}</span>

              {/* Lock Indicator if not permitted */}
              {!isAllowed && (
                <Lock className="w-3.5 h-3.5 text-slate-400 ml-auto hidden lg:inline-block shrink-0" />
              )}

              {/* Desktop Badge */}
              {isAllowed && item.badge && (
                <span
                  className={`hidden lg:inline-flex ml-auto text-xs font-bold px-2 py-0.5 rounded-full ${item.badgeColor}`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Start / End Shift & Clock In Staff Footer Buttons */}
      <div className="p-3 border-t border-slate-200 space-y-2">
        <button
          onClick={onOpenClockIn}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 shadow-xs"
          title="Presensi & Absensi Masuk/Keluar Staff"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <UserCheck className="w-4 h-4 shrink-0 text-emerald-600" />
            <div className="hidden lg:flex flex-col text-left truncate">
              <span className="truncate leading-tight">Clock In / Absensi</span>
              <span className="text-[10px] text-emerald-700 font-normal truncate">
                {staffMembers.filter((s) => getActiveAttendance(s.id)).length} Staff Online
              </span>
            </div>
          </div>
          <span className="hidden lg:inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
        </button>

        <button
          onClick={onOpenEndShift}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all border ${
            shift.status === 'OPEN'
              ? 'bg-amber-500/10 text-amber-900 border-amber-500/30 hover:bg-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-900 border-emerald-500/30 hover:bg-emerald-500/20'
          }`}
          title="Mulai / Akhiri Shift & Lihat Log Sesi Kasir"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            {shift.status === 'OPEN' ? (
              <Clock className="w-4 h-4 shrink-0 text-amber-600" />
            ) : (
              <Play className="w-4 h-4 shrink-0 text-emerald-600 fill-emerald-600" />
            )}
            <div className="hidden lg:flex flex-col text-left truncate">
              <span className="truncate leading-tight">
                {shift.status === 'OPEN' ? 'Mulai / Akhiri Shift' : 'Mulai Shift Baru'}
              </span>
              <span className="text-[10px] text-slate-500 font-normal truncate">
                {shift.status === 'OPEN' ? `Kasir: ${shift.cashierName}` : 'Status: Ditutup'}
              </span>
            </div>
          </div>

          <span
            className={`hidden lg:inline-block w-2 h-2 rounded-full shrink-0 ${
              shift.status === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
            }`}
          />
        </button>
      </div>
    </aside>
  );
};
