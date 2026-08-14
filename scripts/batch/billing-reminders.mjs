#!/usr/bin/env node
import pg from 'pg';
import { Resend } from 'resend';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY missing in .env');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('DATABASE_URL missing in .env');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function run() {
  console.log('[Billing Reminder] Memulai pengecekan langganan yang akan habis H-3...');

  try {
    // Cari langganan aktif/trial yang akan kedaluwarsa 3 hari lagi.
    // Interval 3 hari berarti: sisa waktu antara > 2 hari dan < 3 hari
    const res = await pool.query(`
      SELECT s.id, s.tenant_id, s.status, s.current_period_end, p.name as plan_name, m.email, m.merchant_name
      FROM billing.subscriptions s
      JOIN billing.saas_plans p ON s.plan_id = p.id
      JOIN (
        SELECT id, name as merchant_name, 'stefen.maxy.academy@gmail.com' as email -- Placeholder email untuk tenant (atau dapatkan dari tabel akun tenant)
        FROM settings
      ) m ON m.id = s.tenant_id
      WHERE s.status IN ('ACTIVE', 'TRIAL')
        AND s.current_period_end >= NOW() + INTERVAL '2 days'
        AND s.current_period_end < NOW() + INTERVAL '3 days'
    `);

    const subscriptions = res.rows;
    console.log(`[Billing Reminder] Ditemukan ${subscriptions.length} langganan yang jatuh tempo H-3.`);

    for (const sub of subscriptions) {
      console.log(`-> Mengirim pengingat ke ${sub.tenant_id} (Paket: ${sub.plan_name})...`);
      
      const emailHtml = `
        <div style="font-family: sans-serif; max-w-md; margin: 0 auto;">
          <h2>Pemberitahuan Tagihan H-3</h2>
          <p>Halo ${sub.merchant_name},</p>
          <p>Masa aktif paket <strong>${sub.plan_name}</strong> Anda (saat ini berstatus <strong>${sub.status}</strong>) akan berakhir pada <strong>${new Date(sub.current_period_end).toLocaleDateString('id-ID')}</strong>.</p>
          <p>Silakan pastikan Anda telah menyelesaikan pembayaran pada dashboard untuk menghindari gangguan layanan sistem kasir Anda.</p>
          <br/>
          <p>Terima kasih,<br/>Tim New Hope POS</p>
        </div>
      `;

      try {
        await resend.emails.send({
          from: 'billing@newhopepos.id', // Pastikan domain ini diverifikasi di Resend
          to: sub.email,
          subject: 'Pemberitahuan Tagihan H-3 New Hope POS',
          html: emailHtml
        });
        console.log(`   [OK] Email berhasil dikirim ke ${sub.email}.`);
      } catch (e) {
        console.error(`   [ERROR] Gagal mengirim ke ${sub.email}:`, e);
      }
    }
  } catch (error) {
    console.error('[Billing Reminder] Gagal menjalankan script:', error);
  } finally {
    await pool.end();
    console.log('[Billing Reminder] Selesai.');
  }
}

run();
