import type { BusinessModuleManifest } from '../../platform/modules/contracts';
export const manifest = {
  "id": "barber",
  "name": "New Hope Barbershop",
  "sector": "BARBERSHOP",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Layanan & produk",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Booking & stylist",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "inventory",
      "label": "Katalog & persediaan",
      "tab": "inventory",
      "permission": "inventory"
    },
    {
      "id": "customers",
      "label": "Pelanggan",
      "tab": "customers",
      "permission": "customers"
    },
    {
      "id": "labor",
      "label": "Staf & komisi",
      "tab": "labor",
      "permission": "labor"
    },
    {
      "id": "reports",
      "label": "Laporan",
      "tab": "reports",
      "permission": "reports"
    },
    {
      "id": "group-reports",
      "label": "Laporan semua bisnis",
      "tab": "reports",
      "permission": "reports",
      "ownerOnly": true
    },
    {
      "id": "ai",
      "label": "Intelligence",
      "tab": "ai",
      "permission": "ai"
    },
    {
      "id": "settings",
      "label": "Pengaturan",
      "tab": "settings",
      "permission": "settings"
    },
    {
      "id": "payment",
      "label": "Langganan",
      "tab": "payment",
      "permission": "payment"
    },
    {
      "id": "businesses",
      "label": "Bisnis & outlet",
      "tab": "businesses",
      "permission": "businesses"
    }
  ],
  "workflow": [
    "Booking / walk-in",
    "Antrean",
    "Stylist",
    "Layanan",
    "Pembayaran",
    "Komisi"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_barber",
    "pos.chairs",
    "pos.staff_commissions"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "chair",
    "stylist",
    "commission"
  ],
  "dashboardKinds": [
    "bookings",
    "staff_members"
  ],
  "limitations": ["Pencegahan bentrok jadwal, walk-in, dan komisi per modul masih perlu validasi lanjutan."],
  "adapter": "sector-native"
} as const satisfies BusinessModuleManifest;
