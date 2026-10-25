import type { BusinessModuleManifest } from '../../platform/modules/contracts';
export const manifest = {
  "id": "fnb",
  "name": "New Hope F&B",
  "sector": "FNB",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Kasir & pesanan",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Dapur & pesanan",
      "tab": "tables",
      "permission": "tables"
    },
    {
      "id": "tables",
      "label": "Meja restoran",
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
    "Pesanan diterima",
    "Dimasak",
    "Siap",
    "Disajikan"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_fnb",
    "pos.tables",
    "pos.kds_stations"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "kitchen",
    "menu",
    "recipes"
  ],
  "dashboardKinds": [
    "kds_tickets",
    "tables"
  ],
  "limitations": ["Mode pilot memakai satu outlet. Resep dan persediaan bahan masih memakai pengelolaan lama."],
  "adapter": "sector-native"
} as const satisfies BusinessModuleManifest;
