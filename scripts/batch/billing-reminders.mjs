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
  const startedAt = Date.now();
  const runId = `run-billing-${Date.now()}`;

  try {
    // Record start in batch_job_runs
    try {
      await pool.query(
        `INSERT INTO batch_job_runs (id, job_name, started_at, status)
         VALUES ($1, 'billing-reminders', CURRENT_TIMESTAMP, 'RUNNING')
         ON CONFLICT (id) DO NOTHING`,
        [runId]
      );
    } catch {}

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

    let sentCount = 0;
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
        sentCount++;
      } catch (e) {
        console.error(`   [ERROR] Gagal mengirim ke ${sub.email}:`, e);
      }
    }

    const durationMs = Date.now() - startedAt;
    try {
      await pool.query(
        `UPDATE batch_job_runs
            SET finished_at = CURRENT_TIMESTAMP,
                status = 'SUCCESS',
                duration_ms = $2,
                insights_written = $3
          WHERE id = $1`,
        [runId, durationMs, subscriptions.length]
      );
    } catch {}

  } catch (error) {
    console.error('[Billing Reminder] Gagal menjalankan script:', error);
    const durationMs = Date.now() - startedAt;
    try {
      await pool.query(
        `UPDATE batch_job_runs
            SET finished_at = CURRENT_TIMESTAMP,
                status = 'FAILED',
                duration_ms = $2,
                error_message = $3
          WHERE id = $1`,
        [runId, durationMs, error?.message || 'UNKNOWN_ERROR']
      );
    } catch {}
  } finally {
    await pool.end();
    console.log('[Billing Reminder] Selesai.');
  }
}

run();

