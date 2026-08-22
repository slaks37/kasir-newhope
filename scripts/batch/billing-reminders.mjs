#!/usr/bin/env node
/**
 * Pengingat tagihan H-3.
 *
 * Versi sebelumnya membaca `billing.saas_plans` dan tabel `settings` — keduanya
 * tidak ada di skema ini — dan menempelkan SATU alamat email milik pengembang
 * sebagai penerima untuk setiap merchant. Kalau RESEND_API_KEY pernah terisi,
 * yang terjadi bukan pengingat terkirim, melainkan satu orang menerima tagihan
 * seluruh pelanggan. Skrip ini tidak pernah bisa berhasil, jadi kegagalannya
 * tidak pernah terlihat.
 *
 * Sekarang: langganan dibaca lewat MERCHANT (pemiliknya, yang membayar), dan
 * alamat tujuannya diambil dari pos.merchants.email. Merchant tanpa email
 * dilewati dan dilaporkan, bukan dikirimi ke alamat cadangan siapa pun.
 *
 *   npm run batch:billing
 */
import pg from 'pg';
import { Resend } from 'resend';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
// Domain pengirim harus terverifikasi di Resend. Dibuat bisa diatur supaya
// deployment yang memakai domain lain tidak perlu menyunting berkas ini.
const DARI = process.env.BILLING_EMAIL_FROM || 'billing@newhopepos.id';

if (!DATABASE_URL) {
  console.error('DATABASE_URL belum diisi.');
  process.exit(1);
}
if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY belum diisi.');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);
const pool = new pg.Pool({ connectionString: DATABASE_URL });

const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

async function run() {
  console.log('[tagihan] mencari langganan yang habis 3 hari lagi...');

  let dikirim = 0;
  let tanpaEmail = 0;

  try {
    // Satu baris per MERCHANT, bukan per unit usaha: pemilik dengan kafe dan
    // laundry hanya punya satu langganan dan tidak boleh menerima dua email
    // tentang tagihan yang sama.
    const { rows } = await pool.query(`
      SELECT s.id,
             s.merchant_id,
             s.status,
             s.current_period_end,
             p.name       AS plan_name,
             p.price_idr,
             m.name       AS merchant_name,
             m.email
        FROM billing.subscriptions s
        JOIN billing.plans p   ON p.id = s.plan_id
        JOIN pos.merchants m   ON m.id = s.merchant_id
       WHERE s.status IN ('ACTIVE', 'TRIAL')
         AND m.is_active
         AND s.current_period_end >= CURRENT_TIMESTAMP + INTERVAL '2 days'
         AND s.current_period_end <  CURRENT_TIMESTAMP + INTERVAL '3 days'
    `);

    console.log(`[tagihan] ${rows.length} langganan jatuh tempo H-3.`);

    for (const sub of rows) {
      if (!sub.email) {
        tanpaEmail++;
        console.warn(`   [lewat] ${sub.merchant_name} belum punya alamat email.`);
        continue;
      }

      const tanggal = new Date(sub.current_period_end).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric',
      });

      const html = `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="margin-bottom: 4px;">Masa aktif paket Anda tinggal 3 hari</h2>
          <p>Halo ${sub.merchant_name},</p>
          <p>Paket <strong>${sub.plan_name}</strong> (${rupiah(sub.price_idr)}/bulan)
             berakhir pada <strong>${tanggal}</strong>.</p>
          <p>Setelah itu masih ada masa tenggang 3 hari. Lewat dari itu, batas
             produk, outlet, dan kuota AI turun ke tingkat Free — data Anda tetap
             utuh dan kembali begitu pembayaran masuk.</p>
          <p>Perpanjang lewat menu <strong>Pengaturan &rsaquo; Langganan</strong> di aplikasi.</p>
          <p style="margin-top: 24px;">Terima kasih,<br/>Tim New Hope POS</p>
        </div>
      `;

      try {
        await resend.emails.send({
          from: DARI,
          to: sub.email,
          subject: `Paket ${sub.plan_name} Anda berakhir ${tanggal}`,
          html,
        });
        dikirim++;
        console.log(`   [ok] ${sub.merchant_name}`);
      } catch (e) {
        console.error(`   [gagal] ${sub.merchant_name}:`, e?.message || e);
      }
    }

    console.log(`[tagihan] selesai. terkirim=${dikirim} tanpa-email=${tanpaEmail}`);
  } catch (error) {
    console.error('[tagihan] gagal:', error?.message || error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
