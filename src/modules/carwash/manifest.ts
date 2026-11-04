import type { BusinessModuleManifest } from '../../platform/modules/contracts';
export const manifest = {
  "id": "carwash",
  "name": "New Hope Carwash",
  "sector": "CARWASH",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Checkout kendaraan",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Antrean kendaraan",
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
    "Antrean bay",
    "Cuci",
    "Kering & vakum",
    "Inspeksi",
    "Siap keluar"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_carwash",
    "pos.bays",
    "pos.vehicles"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "bay",
    "vehicle",
    "service"
  ],
  "dashboardKinds": [
    "carwash_queue"
  ],
  "limitations": ["Resource bay dan riwayat kendaraan kanonis belum terhubung penuh ke antrean."],
  "adapter": "sector-native"
} as const satisfies BusinessModuleManifest;
