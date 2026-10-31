import type { BusinessModuleManifest } from '../../platform/modules/contracts';
export const manifest = {
  "id": "retail",
  "name": "New Hope Retail",
  "sector": "RETAIL",
  "pages": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "tab": "overview",
      "permission": "overview"
    },
    {
      "id": "pos",
      "label": "Kasir barcode",
      "tab": "pos",
      "permission": "pos"
    },
    {
      "id": "operations",
      "label": "Produk, SKU & stok",
      "tab": "inventory",
      "permission": "inventory"
    },
    { "id": "inventory", "label": "Katalog", "tab": "inventory", "permission": "inventory" },
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
    "Purchase order",
    "Penerimaan",
    "Stok tersedia",
    "Penjualan",
    "Replenishment"
  ],
  "dependencies": [
    "pos.shared_state_records",
    "pos.order_context_retail",
    "pos.inventory_transactions"
  ],
  "integrations": [
    "notifications"
  ],
  "settings": [
    "barcode",
    "sku",
    "replenishment"
  ],
  "dashboardKinds": [
    "products",
    "stock_items",
    "inventory_logs"
  ],
  "limitations": ["Purchase order, penerimaan barang, transfer, dan retur belum tersedia sebagai satu alur modul."],
  "adapter": "sector-native"
} as const satisfies BusinessModuleManifest;
