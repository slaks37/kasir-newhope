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
    -- POS SCHEMA COMMENTS
    COMMENT ON SCHEMA pos IS 'Domain Operasional Kasir: Manajemen Tenant, Staf, Produk, Resep Bahan, Transaksi Penjualan, dan Activity Log.';
    COMMENT ON TABLE pos.tenants IS 'Tabel Utama Merchant/Toko (Multi-Tenant). Menyimpan data bisnis, sektor bisnis (F&B, Retail, Laundry, Barbershop, Carwash), dan status merchant.';
    COMMENT ON TABLE pos.users IS 'Daftar Pengguna Kasir & Manajer Toko per Merchant dengan PIN dan Role berbasis RBAC.';
    COMMENT ON TABLE pos.products IS 'Katalog Produk & Layanan Merchant dengan harga jual, harga modal, SKU, stok, dan kategori per sektor.';
    COMMENT ON TABLE pos.transactions IS 'Data Transaksi Penjualan Kasir (Header) dengan nomor invoice, total tagihan, metode bayar (CASH, QRIS, dll), dan status.';
    COMMENT ON TABLE pos.transaction_items IS 'Rincian Item Produk yang dibeli dalam satu transaksi (Detail Baris).';
    COMMENT ON TABLE pos.ingredients IS 'Bahan Baku & Stok Mentah untuk sektor FNB (Resep) dan Laundry (Deterjen).';
    COMMENT ON TABLE pos.product_recipes IS 'Komposisi Resep / Bill of Materials (BOM) yang menghubungkan produk ke bahan baku.';
    COMMENT ON TABLE pos.inventory_logs IS 'Kartu Stok & Audit Log Pergerakan Bahan Baku (Pengurangan otomatis saat transaksi).';
    COMMENT ON TABLE pos.merchant_activity_log IS 'Log Audit Real-time semua aktivitas operasional merchant (Audit Trail).';
    COMMENT ON TABLE pos.sync_receipts IS 'Tanda terima sinkronisasi transaksi offline-ke-online.';

    -- BILLING SCHEMA COMMENTS
    COMMENT ON SCHEMA billing IS 'Domain Billing & Monetisasi SaaS: Manajemen Paket Langganan, Invoice, dan Webhook Pembayaran.';
    COMMENT ON TABLE billing.plans IS 'Daftar Paket Langganan SaaS POS (Basic Starter, Pro Growth, Enterprise Ultra).';
    COMMENT ON TABLE billing.subscriptions IS 'Status Langganan Aktif Merchant per Paket (TRIAL, ACTIVE, PAST_DUE, EXPIRED).';
    COMMENT ON TABLE billing.invoices IS 'Faktur Tagihan Langganan SaaS POS beserta status pembayaran Payment Gateway.';
    COMMENT ON TABLE billing.webhook_logs IS 'Log Idempotensi Webhook dari Payment Gateway (Mencegah double-charge).';

    -- AI SCHEMA COMMENTS
    COMMENT ON SCHEMA ai IS 'Domain AI Copilot & Smart Insights: Kuota Kredit AI, Analisis Prediktif, Target Bisnis, dan Log Asisten.';
    COMMENT ON TABLE ai.merchant_ai_credits IS 'Sistem Kuota Token/Kredit AI bulanan per merchant.';
    COMMENT ON TABLE ai.daily_merchant_insights IS 'Hasil kalkulasi wawasan bisnis harian (rekomendasi otomatis hemat biaya LLM).';
    COMMENT ON TABLE ai.merchant_targets IS 'Target performa dan omzet bisnis merchant untuk dipantau oleh asisten AI.';
    COMMENT ON TABLE ai.ai_query_logs IS 'Log pertanyaan pengguna ke asisten pintar untuk audit & evaluasi akurasi jawaban.';
    COMMENT ON TABLE ai.batch_job_runs IS 'Riwayat eksekusi cron job malam untuk pemrosesan analitik agregat.';

    -- INTERNAL SCHEMA COMMENTS
    COMMENT ON SCHEMA internal IS 'Domain Internal Backoffice & BI: Pengguna Internal SaaS, Audit Akses, dan Skor Kesehatan Merchant.';
    COMMENT ON TABLE internal.internal_users IS 'Karyawan Internal Penyedia SaaS (Superadmin, Support, Growth Analyst).';
    COMMENT ON TABLE internal.internal_access_log IS 'Audit Log Akses Karyawan Internal saat memeriksa data merchant.';
    COMMENT ON TABLE internal.merchant_health_logs IS 'Log metrik kesehatan merchant harian & skor prediksi Churn Risk.';
    COMMENT ON TABLE internal.feature_usage_events IS 'Aliran event penggunaan fitur POS untuk analisis adopsi produk.';

    -- CONTRACT SCHEMA COMMENTS
    COMMENT ON SCHEMA contract IS 'Domain Kontrak Antar-Layanan & BI Views: Permukaan baca aman yang menyatukan laporan omzet dan analitik.';
  `;

  await client.query(sql);
  console.log('All schemas and tables documented successfully!');

  await client.end();
}

enrichSchemaDocs().catch(console.error);
