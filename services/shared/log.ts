/**
 * Log terstruktur dengan correlation ID.
 *
 * MASALAH YANG DISELESAIKAN. Satu klik di browser bisa menyentuh gateway, lalu
 * backoffice, lalu database. Sebelum ini, satu request gagal berarti membaca
 * empat log terpisah tanpa benang penghubung — dan menebak baris mana milik
 * request yang mana berdasarkan jam. Pada trafik sepi itu menyebalkan; pada
 * trafik ramai itu mustahil.
 *
 * Sekarang gateway menerbitkan satu `requestId` dan meneruskannya lewat header
 * `x-request-id`. Setiap baris log dari service mana pun membawanya, dan klien
 * juga menerimanya di header respons — sehingga laporan bug dari pengguna bisa
 * langsung ditelusuri.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface Konteks {
  requestId: string;
  service: string;
}

/**
 * Menyimpan konteks per-request tanpa harus mengoper parameter ke setiap
 * fungsi. AsyncLocalStorage mengikuti rantai async, jadi query database yang
 * dimulai di dalam handler tetap tahu request mana yang memicunya.
 */
const penyimpanan = new AsyncLocalStorage<Konteks>();

export function jalankanDenganKonteks<T>(ctx: Konteks, fn: () => T): T {
  return penyimpanan.run(ctx, fn);
}

export function requestIdSaatIni(): string | null {
  return penyimpanan.getStore()?.requestId ?? null;
}

export function buatRequestId(): string {
  return randomUUID().slice(0, 8);
}

type Level = 'info' | 'warn' | 'error';

/**
 * Kunci yang nilainya TIDAK PERNAH boleh sampai ke log.
 *
 * Dipasang setelah kejadian nyata: handler webhook mencatat `req.headers` utuh
 * saat menolak tanda tangan yang tidak sah. Objek itu memuat `signature`,
 * `client-id`, dan — karena request lewat gateway — `x-newhope-gateway-token`,
 * yaitu shared secret yang membedakan pemanggil tepercaya dari yang bukan.
 * Siapa pun yang bisa membaca log jadi bisa memanggil port service internal
 * langsung dengan `x-auth-sub` pilihan sendiri.
 *
 * Diperiksa di sini, bukan di setiap pemanggil, karena satu pemanggil yang lupa
 * sudah cukup untuk membocorkannya lagi. Pencocokan dilakukan pada nama kunci
 * apa pun kedalamannya — `{ headers: { ... } }` ikut tersaring.
 */
const KUNCI_RAHASIA = [
  'authorization', 'cookie', 'set-cookie',
  'x-newhope-gateway-token', 'x-ai-topup-secret', 'x-payment-webhook-secret',
  'signature', 'apikey', 'api-key', 'x-api-key',
  'password', 'passwordhash', 'secret', 'token', 'access_token', 'refresh_token',
];

const rahasia = (kunci: string): boolean => {
  const k = kunci.toLowerCase();
  return KUNCI_RAHASIA.some((r) => k === r || k.endsWith(r));
};

/** Kedalaman dibatasi: struktur melingkar tidak boleh menggantung proses. */
function sunting(nilai: unknown, sisaKedalaman = 4): unknown {
  if (nilai === null || typeof nilai !== 'object') return nilai;
  if (sisaKedalaman <= 0) return '[dalam]';
  if (Array.isArray(nilai)) return nilai.map((v) => sunting(v, sisaKedalaman - 1));

  const keluar: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(nilai as Record<string, unknown>)) {
    keluar[k] = rahasia(k) ? '[disunting]' : sunting(v, sisaKedalaman - 1);
  }
  return keluar;
}

function keluarkan(level: Level, service: string, pesan: string, data?: Record<string, unknown>) {
  const ctx = penyimpanan.getStore();
  const baris: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    service: ctx?.service || service,
    msg: pesan,
  };
  if (ctx?.requestId) baris.req = ctx.requestId;
  if (data) Object.assign(baris, sunting(data) as Record<string, unknown>);

  // JSON di produksi (bisa di-ingest agregator log), teks berwarna di
  // pengembangan (bisa dibaca manusia). Log yang tidak terbaca tidak akan
  // pernah dipakai orang saat sedang panik.
  if (process.env.NODE_ENV === 'production' || process.env.LOG_JSON === '1') {
    console[level === 'error' ? 'error' : 'log'](JSON.stringify(baris));
    return;
  }

  const warna = { info: '\x1b[0m', warn: '\x1b[33m', error: '\x1b[31m' }[level];
  const req = ctx?.requestId ? ` \x1b[90m(${ctx.requestId})\x1b[0m` : '';
  const ekstra = data ? ' ' + JSON.stringify(data) : '';
  console[level === 'error' ? 'error' : 'log'](
    `${warna}[${ctx?.service || service}]${req} ${pesan}${ekstra}\x1b[0m`
  );
}

export function buatLogger(service: string) {
  return {
    info: (pesan: string, data?: Record<string, unknown>) => keluarkan('info', service, pesan, data),
    warn: (pesan: string, data?: Record<string, unknown>) => keluarkan('warn', service, pesan, data),
    error: (pesan: string, data?: Record<string, unknown>) => keluarkan('error', service, pesan, data),
  };
}

export type Logger = ReturnType<typeof buatLogger>;
