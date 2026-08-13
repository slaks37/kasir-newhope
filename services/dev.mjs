/**
 * Menjalankan seluruh sistem secara lokal — satu perintah, tanpa Docker.
 *
 *   npm run services
 *
 * Urutannya bukan selera: database dulu, lalu migrasi sampai SELESAI, baru
 * service. Menyalakan service sebelum migrasi selesai berarti lima proses
 * berlomba membaca skema yang sedang berubah, dan kegagalannya berbeda-beda
 * tiap kali dijalankan — jenis bug yang paling mahal untuk ditelusuri.
 *
 * Ctrl-C mematikan semuanya dengan tertib.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const WARNA = {
  'db-server': '\x1b[35m',
  migrate: '\x1b[90m',
  pos: '\x1b[36m',
  ai: '\x1b[33m',
  billing: '\x1b[32m',
  backoffice: '\x1b[34m',
  gateway: '\x1b[95m',
};
const RESET = '\x1b[0m';

const anak = [];
let mematikan = false;

const percobaanUlang = new Map();

function jalankan(nama, args, extraEnv = {}) {
  const p = spawn('npx', ['tsx', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });

  const tulis = (aliran) => (data) => {
    const warna = WARNA[nama] || '';
    for (const baris of String(data).split('\n')) {
      if (baris.trim()) aliran.write(`${warna}[${nama}]${RESET} ${baris}\n`);
    }
  };
  p.stdout.on('data', tulis(process.stdout));
  p.stderr.on('data', tulis(process.stderr));

  p.on('exit', (code) => {
    if (mematikan) return;

    /*
     * Service yang mati DIHIDUPKAN LAGI, bukan menjatuhkan seluruh sistem.
     *
     * Versi sebelumnya mematikan semuanya begitu satu service berhenti. Itu
     * menyakitkan saat mengembangkan — satu salah ketik di ai-service mematikan
     * kasir yang sedang diuji — dan yang lebih buruk, menyembunyikan sifat yang
     * justru jadi alasan memecah service: kegagalan seharusnya TETAP LOKAL.
     * Perilaku ini juga menyamai `restart: unless-stopped` di docker-compose,
     * sehingga yang diuji lokal sama dengan yang berjalan nanti.
     *
     * db-server dikecualikan: tanpa database tidak ada yang bisa diuji sama
     * sekali, jadi kematiannya memang harus berisik dan menghentikan semuanya.
     */
    const n = (percobaanUlang.get(nama) || 0) + 1;
    percobaanUlang.set(nama, n);

    if (nama === 'db-server' || n > 5) {
      console.error(
        `\n[dev] "${nama}" berhenti (kode ${code})` +
          (nama === 'db-server' ? '.' : ` dan sudah gagal ${n} kali.`) +
          ' Mematikan sisanya.'
      );
      matikan(1);
      return;
    }

    const jeda = Math.min(1000 * 2 ** (n - 1), 10_000);
    console.error(
      `[dev] "${nama}" mati (kode ${code}). Dihidupkan lagi dalam ${jeda / 1000}s (percobaan ${n}/5).`
    );
    setTimeout(() => {
      if (!mematikan) jalankan(nama, args, extraEnv);
    }, jeda);
  });

  anak.push({ nama, proc: p });
  return p;
}

function matikan(kode = 0) {
  if (mematikan) return;
  mematikan = true;
  for (const { proc } of anak) {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* sudah mati */
    }
  }
  setTimeout(() => process.exit(kode), 1500);
}

process.on('SIGINT', () => {
  console.log('\n[dev] menutup semua service…');
  matikan(0);
});
process.on('SIGTERM', () => matikan(0));

async function tungguSiap(url, batasMs = 30_000) {
  const mulai = Date.now();
  while (Date.now() - mulai < batasMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  console.log('[dev] 1/3 database…');
  jalankan('db-server', ['services/db-server/index.ts']);

  console.log('[dev] 2/3 migrasi…');
  const migrasi = spawn('npx', ['tsx', 'services/db-server/migrate.ts'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  const kode = await new Promise((r) => migrasi.on('exit', r));
  if (kode !== 0) {
    console.error('[dev] migrasi gagal. Tidak melanjutkan.');
    matikan(1);
    return;
  }

  console.log('[dev] 3/3 service…');
  jalankan('pos', ['services/pos/index.ts']);
  jalankan('ai', ['services/ai/index.ts']);
  jalankan('billing', ['services/billing/index.ts']);
  jalankan('backoffice', ['services/backoffice/index.ts']);

  // Gateway terakhir: kalau lebih dulu, ia akan menjawab 503 untuk request yang
  // sebenarnya hanya datang terlalu cepat.
  const siap = await Promise.all([
    tungguSiap('http://127.0.0.1:3101/ready'),
    tungguSiap('http://127.0.0.1:3102/ready'),
    tungguSiap('http://127.0.0.1:3103/ready'),
    tungguSiap('http://127.0.0.1:3104/ready'),
  ]);

  if (siap.some((s) => !s)) {
    console.error('[dev] ada service yang tidak siap dalam 30 detik.');
    matikan(1);
    return;
  }

  jalankan('gateway', ['services/gateway/index.ts']);
  console.log('\n[dev] semua siap → http://localhost:3000 (kasir) · /admin (internal)\n');
}

main().catch((err) => {
  console.error('[dev] gagal:', err.message);
  matikan(1);
});
