import type { BusinessModuleManifest } from '../../platform/modules/contracts';
export const manifest = {
  "id": "laundry",
  "name": "New Hope Laundry",
  "sector": "LAUNDRY",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Penerimaan laundry",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Produksi & pengambilan",
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
    "Diterima",
    "Cuci",
    "Kering",
    "Setrika",
    "Packing",
    "Siap ambil",
    "Diambil"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_laundry",
    "pos.operational_jobs"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "pricing",
    "fragrance",
    "rack"
  ],
  "dashboardKinds": [
    "order_operations"
  ],
  "limitations": ["Penjadwalan mesin dan pengiriman notifikasi otomatis belum terintegrasi."],
  "adapter": "sector-native"
} as const satisfies BusinessModuleManifest;
