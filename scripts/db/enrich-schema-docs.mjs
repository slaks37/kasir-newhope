import 'dotenv/config';
import pg from 'pg';

async function enrichSchemaDocs() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();

  console.log('Enriching schema documentation for Supabase Schema Visualizer...');

  const sql = `
    -- INTERNAL SCHEMA COMMENTS (PLATFORM PLANE)
    COMMENT ON SCHEMA internal IS 'Domain Platform Plane: Akun Holding (Tenants), Brand (Merchants), Cabang (Outlets), Identitas Global (Users), Multi-Tenant RBAC (Memberships), Audit Platform, dan Target Bisnis.';
    COMMENT ON TABLE internal.tenants IS 'Tingkat 1: Akun Holding / Perusahaan / Pelanggan Utama Billing SaaS.';
    COMMENT ON TABLE internal.merchants IS 'Tingkat 2: Brand / Business Unit / Unit Usaha Sektor di bawah naungan Tenant.';
    COMMENT ON TABLE internal.outlets IS 'Tingkat 3: Lokasi fisik toko / cabang kasir dengan konfigurasi geofencing.';
    COMMENT ON TABLE internal.users IS 'Identitas global pengguna di platform (1 Manusia = 1 User ID).';
    COMMENT ON TABLE internal.memberships IS 'Penugasan peran staf ke tenant, brand, dan cabang tertentu (Multi-Tenant RBAC).';
    COMMENT ON TABLE internal.audit_logs IS 'Cross-cutting platform audit log dari POS, Billing, AI, dan Backoffice.';
    COMMENT ON TABLE internal.business_targets IS 'Target performa bisnis merchant (omzet bulanan, target harian).';
    COMMENT ON TABLE internal.internal_users IS 'Karyawan Internal Penyedia SaaS (Superadmin, Support, Growth Analyst).';
    COMMENT ON TABLE internal.internal_access_log IS 'Audit Log Akses Karyawan Internal saat memeriksa data privat merchant.';
    COMMENT ON TABLE internal.merchant_health_logs IS 'Log metrik kesehatan merchant harian & skor prediksi Churn Risk.';
    COMMENT ON TABLE internal.feature_usage_events IS 'Aliran telemetry penggunaan UI untuk analisis adopsi produk.';

    -- POS SCHEMA COMMENTS (STORE OPERATIONS)
    COMMENT ON SCHEMA pos IS 'Domain Operasional Kasir: Katalog Produk, Resep BOM, Transaksi Penjualan, dan Mutasi Stok Fisik.';
    COMMENT ON TABLE pos.products IS 'Katalog Produk & Layanan Merchant dengan harga jual, modal, SKU, dan status ketersediaan.';
    COMMENT ON TABLE pos.transactions IS 'Data Transaksi Penjualan Kasir (Header) dengan nomor invoice, total tagihan, metode bayar, dan status.';
    COMMENT ON TABLE pos.transaction_items IS 'Rincian Item Produk yang dibeli dalam satu transaksi (Detail Baris).';
    COMMENT ON TABLE pos.ingredients IS 'Bahan Baku & Stok Mentah untuk sektor FNB (Resep) dan Laundry (Deterjen).';
    COMMENT ON TABLE pos.product_recipes IS 'Komposisi Resep / Bill of Materials (BOM) yang menghubungkan produk ke bahan baku.';
    COMMENT ON TABLE pos.inventory_logs IS 'Kartu Stok & Audit Log Pergerakan Bahan Baku Fisik per Cabang.';
    COMMENT ON TABLE pos.sync_receipts IS 'Tanda terima sinkronisasi transaksi offline-ke-online.';

    -- BILLING SCHEMA COMMENTS (SAAS MONETIZATION)
    COMMENT ON SCHEMA billing IS 'Domain Billing & Monetisasi SaaS: Manajemen Paket Langganan, Invoice, dan Webhook Pembayaran.';
    COMMENT ON TABLE billing.plans IS 'Daftar Paket Langganan SaaS POS (Basic Starter, Pro Growth, Enterprise Ultra).';
    COMMENT ON TABLE billing.subscriptions IS 'Status Langganan Aktif Tenant per Paket (TRIAL, ACTIVE, PAST_DUE, EXPIRED).';
    COMMENT ON TABLE billing.invoices IS 'Faktur Tagihan Langganan SaaS POS beserta status pembayaran Payment Gateway.';
    COMMENT ON TABLE billing.webhook_logs IS 'Log Idempotensi Webhook dari Payment Gateway (Mencegah double-charge).';

    -- AI SCHEMA COMMENTS (INTELLIGENCE)
    COMMENT ON SCHEMA ai IS 'Domain AI Copilot & Smart Insights: Kuota Kredit AI, Analisis Prediktif, dan Log Kueri Model.';
    COMMENT ON TABLE ai.merchant_ai_credits IS 'Sistem Kuota Token/Kredit AI bulanan per tenant.';
    COMMENT ON TABLE ai.daily_merchant_insights IS 'Hasil kalkulasi wawasan bisnis harian (rekomendasi otomatis hemat biaya LLM).';
    COMMENT ON TABLE ai.ai_query_logs IS 'Log pertanyaan pengguna ke asisten pintar untuk audit & evaluasi akurasi jawaban.';
    COMMENT ON TABLE ai.batch_job_runs IS 'Riwayat eksekusi cron job malam untuk pemrosesan analitik agregat.';

    -- CONTRACT SCHEMA COMMENTS (SINGLE SOURCE OF TRUTH READ VIEWS)
    COMMENT ON SCHEMA contract IS 'Domain Kontrak Antar-Layanan & BI Views: Permukaan baca aman yang menyatukan laporan omzet, staf, dan analitik.';
  `;

  await client.query(sql);
  console.log('All schemas and tables documented successfully!');

  await client.end();
}

enrichSchemaDocs().catch(console.error);
