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

export async function startService(opts: ServiceOptions): Promise<void> {
  const app = express();
  const log = buatLogger(opts.name);
  /*
   * Badan MENTAH disimpan sebelum di-parse.
   *
   * Verifikasi tanda tangan webhook menghitung HMAC atas byte yang benar-benar
   * dikirim gateway. Mem-parse JSON lalu menyusunnya ulang mengubah urutan
   * kunci dan spasi, sehingga tanda tangan yang BENAR pun tidak akan pernah
   * cocok — dan gejalanya menyesatkan: terlihat seperti gateway mengirim tanda
   * tangan salah, padahal kitalah yang mengubah pesannya.
   */
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
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
      res.status(503).json({
        ok: false,
        service: opts.name,
        ready: false,
        error: (err as Error).message,
      });
    }
  });

  if (opts.schema) {
    db = await connectDb({ schema: opts.schema });
    ready = true;
  }

  await opts.register(app, { db: db as Db, name: opts.name, log });

  // Penangkap error terakhir. Tanpa ini, error yang tidak tertangani di handler
  // async membuat Express menjawab dengan stack trace HTML — yang membocorkan
  // nama tabel dan jalur berkas ke siapa pun yang memanggil.
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
