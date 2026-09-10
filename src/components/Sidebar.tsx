import React from "react";
import { usePOS } from "../context/POSContext";
import { PermissionFeature } from "../types";
import {
  LayoutDashboard,
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
  Home,
  BookOpen,
  Coins,
} from "lucide-react";

import { BUSINESS_PRESETS } from "../data/businessPresets";

interface SidebarProps {
  onOpenAiCopilot: () => void;
  onOpenEndShift: () => void;
  onOpenClockIn: () => void;
  onGoToHome?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onOpenAiCopilot,
  onOpenEndShift,
  onOpenClockIn,
  onGoToHome,
}) => {
  const {
    activeTab,
    setActiveTab,
    products,
    heldOrders,
    shift,
    hasPermission,
    settings,
    staffMembers,
    getActiveAttendance,
    currentUser,
  } = usePOS();

  const activePreset =
    BUSINESS_PRESETS[settings?.businessSector || "FNB"] || BUSINESS_PRESETS.FNB;
  const layoutTabLabel = activePreset.layoutTerm?.tabLabel || "Denah Layout";

  // Count low stock items for badge alert
  const lowStockCount = products.filter(
    (p) => p.stock <= p.minStockAlert,
  ).length;

  const navItems = [
    {
      id: "overview" as const,
      label: "Ringkasan",
      icon: LayoutDashboard,
    },
    {
      id: "pos" as const,
      label: "Kasir",
      icon: ShoppingCart,
      badge: heldOrders.length > 0 ? heldOrders.length : undefined,
      badgeColor: "bg-amber-500 text-slate-950",
    },
    {
      id: "tables" as const,
      label: layoutTabLabel,
      icon: Grid2X2,
    },
    {
      id: "inventory" as const,
      label: "Produk & Stok",
      icon: Package,
      badge: lowStockCount > 0 ? lowStockCount : undefined,
      badgeColor: "bg-rose-600 text-white",
    },
    {
      id: "customers" as const,
      label: "Pelanggan",
      icon: Users,
    },
    {
      id: "reports" as const,
      label: "Laporan",
      icon: BarChart3,
    },
    {
      id: "ai" as const,
      label: "AI Copilot",
      icon: Bot,
      special: true,
    },
    {
      id: "labor" as const,
      label: "Gaji & Komisi",
      icon: Coins,
    },
    {
      id: "settings" as const,
      label: "Pengaturan",
      icon: Settings,
    },
  ];

  return (
    <aside className="nh-sidebar">
      <div>
        <p className="nh-sidebar-caption">RUANG KERJA</p>
        <nav className="nh-sidebar-nav" aria-label="Navigasi toko">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isAllowed = hasPermission(item.id as PermissionFeature);
            return (
              <button
                key={item.id}
                aria-current={activeTab === item.id ? "page" : undefined}
                className={`nh-sidebar-item ${!isAllowed ? "is-locked" : ""}`}
                title={
                  !isAllowed
                    ? `Akses ${item.label} memerlukan izin Manager / Admin`
                    : undefined
                }
                onClick={() =>
                  item.id === "ai" ? onOpenAiCopilot() : setActiveTab(item.id)
                }
              >
                <Icon />
                <span>{item.label}</span>
                {!isAllowed && <Lock size={13} className="ml-auto" />}
                {isAllowed && item.badge ? (
                  <span className="nh-sidebar-count">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="nh-sidebar-foot">
        <p className="nh-sidebar-caption">OPERASIONAL</p>
        <button onClick={onOpenClockIn} className="nh-sidebar-item">
          <UserCheck />
          <span>
            Absensi staf
            <small>
              {staffMembers.filter((s) => getActiveAttendance(s.id)).length}{" "}
              staf sedang bertugas
            </small>
          </span>
        </button>
        <button onClick={onOpenEndShift} className="nh-sidebar-item">
          <Clock />
          <span>
            {shift.status === "OPEN" ? "Kelola shift" : "Mulai shift"}
            <small>
              {shift.status === "OPEN"
                ? shift.cashierName || currentUser?.name || "Kasir"
                : "Belum ada shift aktif"}
            </small>
          </span>
          <span
            className={`nh-status-dot ${shift.status === "OPEN" ? "is-open" : ""}`}
          />
        </button>
        {onGoToHome && (
          <>
            <button onClick={onGoToHome} className="nh-sidebar-item">
              <Home />
              <span>Halaman utama</span>
            </button>
            <a href="#blog" className="nh-sidebar-item">
              <BookOpen />
              <span>Blog Harapan Baru</span>
            </a>
          </>
        )}
      </div>
    </aside>
  );
};
