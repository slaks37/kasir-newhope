/**
 * Kerangka bersama setiap service.
 *
 * Semua yang ada di sini adalah hal yang, kalau dibiarkan ditulis ulang tiap
 * service, akan berbeda-beda diam-diam: bentuk health check, cara error
 * dilaporkan, perilaku saat dimatikan, dan apa yang bocor ke klien saat terjadi
 * kesalahan.
 */

import express from 'express';
import type { Db } from './db';
import { connectDb } from './db';
import { buatLogger, buatRequestId, jalankanDenganKonteks, type Logger } from './log';
import { requireTrustedGateway } from './auth';

export interface ServiceOptions {
  name: string;
  port: number;
  /** Skema Postgres yang dimiliki service ini. Kosongkan bila tak butuh database. */
  schema?: string;
  register: (app: express.Express, ctx: ServiceContext) => void | Promise<void>;
}

export interface ServiceContext {
  db: Db;
  name: string;
  log: Logger;
}

/** Registri port. Satu tempat, supaya tidak ada dua service berebut angka sama. */
export const PORTS = {
  /*
   * `PORT` didahulukan karena itu konvensi yang dipakai hampir semua pengelola
   * proses — Heroku, Cloud Run, Railway, dan harness preview Claude Code —
   * untuk menetapkan port yang bebas.
   *
   * Tanpa ini, penetapan port otomatis GAGAL DIAM-DIAM: pengelola mengira
   * gateway mendengarkan di port yang ia berikan, gateway tetap mengikat 3000,
   * dan yang terlihat hanyalah "server tidak merespons" tanpa petunjuk sebab.
   *
   * PORT_GATEWAY tetap ada untuk menyetel port secara eksplisit saat kelima
   * service dijalankan berdampingan.
   */
  gateway: Number(process.env.PORT || process.env.PORT_GATEWAY || 3000),
  pos: Number(process.env.PORT_POS || 3101),
  ai: Number(process.env.PORT_AI || 3102),
  billing: Number(process.env.PORT_BILLING || 3103),
  backoffice: Number(process.env.PORT_BACKOFFICE || 3104),
} as const;

export const SERVICE_URL = {
  pos: process.env.URL_POS || `http://127.0.0.1:${PORTS.pos}`,
  ai: process.env.URL_AI || `http://127.0.0.1:${PORTS.ai}`,
  billing: process.env.URL_BILLING || `http://127.0.0.1:${PORTS.billing}`,
  backoffice: process.env.URL_BACKOFFICE || `http://127.0.0.1:${PORTS.backoffice}`,
} as const;

/** Kata kerja HTTP yang mendaftarkan handler pada aplikasi Express. */
const METODE_RUTE = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'] as const;

/**
 * Membuat rejection dari handler `async` sampai ke middleware penangkap error.
 *
 * Express 4 memanggil handler dan mengabaikan nilai kembaliannya. Untuk
 * handler async, nilai itu adalah Promise — jadi kalau ia ditolak, tidak ada
 * yang menangkapnya dan Node melaporkannya sebagai unhandled rejection.
 *
 * Pembungkus ini menyambungkan `.catch(next)` ke setiap handler yang
 * mengembalikan Promise. Handler biasa (bukan async) dilewatkan apa adanya:
 * membungkusnya tidak berbahaya, tapi juga tidak ada gunanya, dan lapisan
 * yang tidak perlu hanya mempersulit pembacaan jejak tumpukan.
 *
 * Middleware penanganan error milik Express dikenali dari JUMLAH ARGUMENNYA
 * (empat). Membungkusnya akan mengubah jumlah itu dan membuat Express berhenti
 * memperlakukannya sebagai penangkap error — karena itu yang berarity 4
 * sengaja dilewati.
 */
function bungkusHandlerAsync(app: express.Express): void {
  for (const metode of METODE_RUTE) {
    const asli = (app as any)[metode].bind(app);
    (app as any)[metode] = (...args: any[]) =>
      asli(...args.map((a: any) => {
        if (typeof a !== 'function' || a.length >= 4) return a;
        const bungkus = (req: any, res: any, next: any) => {
          try {
            const hasil = a(req, res, next);
            if (hasil && typeof hasil.then === 'function') hasil.catch(next);
            return hasil;
          } catch (err) {
            next(err);
          }
        };
        // Nama dipertahankan supaya jejak tumpukan tetap menyebut handler asli.
        Object.defineProperty(bungkus, 'name', { value: a.name || 'handler' });
        return bungkus;
      }));
  }
}

export async function startService(opts: ServiceOptions): Promise<void> {
  const app = express();
  const log = buatLogger(opts.name);
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  /*
   * Correlation ID mengalir dari gateway.
   *
   * Gateway yang menerbitkannya dan meneruskannya lewat `x-request-id`. Service
   * TIDAK menerbitkan sendiri kalau header ada — kalau tiap service membuat id
   * baru, rantainya putus dan penelusuran lintas service mustahil, yang justru
   * masalah yang mau diselesaikan.
   *
   * Dipanggil langsung tanpa gateway (uji, health check dari orkestrator),
   * service menerbitkan sendiri agar setiap baris log tetap punya penanda.
   */
  app.use((req, res, next) => {
    const dariGateway = String(req.headers['x-request-id'] || '').trim();
    const requestId = dariGateway || buatRequestId();
    res.setHeader('x-request-id', requestId);
    jalankanDenganKonteks({ requestId, service: opts.name }, () => next());
  });

  const startedAt = Date.now();
  let db: Db | null = null;
  let ready = false;

  /*
   * LIVENESS vs READINESS — dua pertanyaan berbeda yang sering disatukan.
   *
   *   /health  "apakah proses ini hidup?"    -> selalu 200 selama proses jalan
   *   /ready   "boleh dikirimi trafik?"      -> 503 sampai database tersambung
   *
   * Menyatukannya berarti orkestrator akan MEMBUNUH service yang sebenarnya
   * sehat hanya karena database sedang lambat — dan restart tidak pernah
   * memperbaiki database.
   */
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: opts.name,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  app.get('/ready', async (_req, res) => {
    if (!opts.schema) return res.json({ ok: true, service: opts.name, ready: true });
    if (!db || !ready) {
      return res.status(503).json({ ok: false, service: opts.name, ready: false });
    }
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, service: opts.name, ready: true });
    } catch (err) {
      log.warn('readiness probe database gagal', { sebab: (err as Error).message });
      res.status(503).json({
        ok: false,
        service: opts.name,
        ready: false,
        error: 'DATABASE_UNAVAILABLE',
      });
    }
  });

  // Semua route bisnis hanya boleh dicapai melalui gateway. Health/readiness
  // sengaja dipasang sebelumnya agar orkestrator tidak memerlukan kredensial.
  app.use(requireTrustedGateway);

  if (opts.schema) {
    db = await connectDb({ schema: opts.schema });
    ready = true;
  }

  /*
   * ================================================================
   * SATU KUERI GAGAL TIDAK BOLEH MEMATIKAN SELURUH SERVICE
   * ================================================================
   *
   * Express 4 TIDAK meneruskan rejection dari handler `async` ke middleware
   * penangkap error di bawah. Handler async yang melempar menghasilkan
   * unhandled rejection, dan kebijakan di bagian bawah berkas ini
   * mematikan proses ketika itu terjadi.
   *
   * Akibatnya: satu kueri yang gagal pada SATU permintaan memutus koneksi
   * SETIAP kasir yang sedang tersambung. Terekam dari uji beban
   * (scripts/dev/audit/t-beban.mjs): saat laporan dibaca bersamaan dengan
   * transaksi yang masuk, satu galat basis data menjatuhkan pos-service dan
   * 39 checkout yang sedang berjalan ikut gagal dengan "fetch failed".
   *
   * Middleware penangkap error itu sudah ada — ia hanya tidak pernah bisa
   * dicapai oleh handler async, yang berarti seluruh rute di service ini.
   *
   * Pembungkus di bawah menyambungkan keduanya: rejection apa pun dari
   * handler async diteruskan ke `next(err)`, sehingga permintaan ITU dijawab
   * 500 dan sisanya berjalan terus.
   *
   * Dipasang di sini, bukan di setiap rute, karena aturan yang harus diingat
   * di lima puluh tempat adalah aturan yang cepat atau lambat terlupakan di
   * tempat kelima puluh satu — dan yang terlupakan itu yang akan mematikan
   * kasir saat jam ramai.
   */
  bungkusHandlerAsync(app);

  await opts.register(app, { db: db as Db, name: opts.name, log });

  // Penangkap error terakhir. Tanpa ini, error yang tidak tertangani di handler
  // async membuat Express menjawab dengan stack trace HTML — yang membocorkan
  // nama tabel dan jalur berkas ke siapa pun yang memanggil.
  //
  // Bisa dicapai oleh handler async HANYA karena bungkusHandlerAsync() di atas.
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('handler gagal', { method: req.method, path: req.path, sebab: err?.message || String(err) });
    if (res.headersSent) return;
    res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  });

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'NOT_FOUND', path: req.path });
  });

  const server = app.listen(opts.port, '0.0.0.0', () => {
    log.info(`siap di :${opts.port}${opts.schema ? ` (skema ${opts.schema})` : ''}`);
  });

  /*
   * Mematikan dengan tertib.
   *
   * Berhenti menerima koneksi baru, biarkan yang sedang berjalan selesai, baru
   * tutup database. Langsung process.exit() akan memutus transaksi di
   * tengah — dan pada jalur sinkronisasi kasir itu berarti transaksi yang
   * sudah diterima tapi belum sempat dicatat.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} diterima, menutup…`);
    ready = false;

    const forced = setTimeout(() => {
      log.error('tidak selesai dalam 10 detik, dipaksa keluar.');
      process.exit(1);
    }, 10_000);

    server.close(async () => {
      clearTimeout(forced);
      try {
        await db?.close();
      } catch {
        /* sudah tertutup */
      }
      log.info('selesai.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Error yang tidak tertangani harus MEMATIKAN proses, bukan dibiarkan.
  // Proses Node yang terus jalan setelah rejection tak tertangani berada dalam
  // keadaan yang tidak diketahui siapa pun; orkestrator lebih baik
  // menghidupkannya kembali dari awal yang bersih.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { reason: String(reason) });
    void shutdown('unhandledRejection');
  });
}
