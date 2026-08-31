/**
 * gateway — satu-satunya pintu yang terlihat dari luar.
 *
 * Menyajikan SPA (aplikasi kasir dan konsol internal) dan meneruskan request
 * API ke service pemiliknya. Klien tidak pernah tahu ada berapa service; itulah
 * gunanya — jumlah dan batas service boleh berubah tanpa menyentuh browser.
 *
 * EMPAT HAL YANG WAJIB ADA DI GATEWAY, DAN ALASANNYA
 *
 * 1. BATAS WAKTU. Tanpa itu, satu service yang menggantung menahan koneksi
 *    gateway sampai habis dan seluruh sistem ikut mati — termasuk bagian yang
 *    sehat.
 *
 * 2. CIRCUIT BREAKER. Service mati yang terus dihubungi akan memakan slot
 *    gateway untuk percobaan yang sudah pasti gagal. Breaker menolak cepat.
 *
 * 3. CORRELATION ID. Satu klik menyentuh beberapa proses. Tanpa id bersama,
 *    menelusuri satu kegagalan berarti membaca empat log dan menebak.
 *
 * 4. HEADER TEPERCAYA. `x-forwarded-host` HANYA boleh berasal dari sini.
 *    Meneruskan kiriman klien apa adanya berarti siapa pun bisa mengaku berada
 *    di lingkungan internal.
 *
 * Yang TIDAK boleh ada di sini: logika bisnis. Setiap aturan yang diselipkan
 * akan menjadi aturan yang tidak dimiliki service mana pun dan tidak pernah
 * ikut teruji bersama domainnya.
 */

// WAJIB paling awal: PORTS dan SERVICE_URL dievaluasi saat modul dimuat,
// jadi .env harus sudah terbaca sebelum modul lain diimpor.
import '../shared/env';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { PORTS, SERVICE_URL } from '../shared/service';
import { Breaker } from '../shared/breaker';
import { buatLogger, buatRequestId, jalankanDenganKonteks } from '../shared/log';
import { requireGatewayAuthentication, type AuthPrincipal } from '../shared/auth';

const log = buatLogger('gateway');
const PROXY_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS || 35_000);
const RETRY_MAX = Number(process.env.GATEWAY_RETRY || 2);

/**
 * Tabel rute. Prefiks terpanjang menang, jadi /api/v1/assistant diperiksa
 * sebelum /api/v1.
 */
const ROUTES: Array<{ prefix: string; target: string; name: keyof typeof SERVICE_URL }> = [
  { prefix: '/api/v1/assistant', target: SERVICE_URL.ai, name: 'ai' },
  { prefix: '/api/ai', target: SERVICE_URL.ai, name: 'ai' },
  { prefix: '/api/v1/subscription', target: SERVICE_URL.billing, name: 'billing' },
  { prefix: '/api/v1/webhooks', target: SERVICE_URL.billing, name: 'billing' },
  { prefix: '/api/v1/sync', target: SERVICE_URL.pos, name: 'pos' },
  { prefix: '/api/v1/reports', target: SERVICE_URL.pos, name: 'pos' },
  { prefix: '/api/v1/flags', target: SERVICE_URL.pos, name: 'pos' },
  { prefix: '/api/v1/orders', target: SERVICE_URL.pos, name: 'pos' },
  { prefix: '/api/v1/transactions', target: SERVICE_URL.pos, name: 'pos' },
  { prefix: '/api/v1/analytics', target: SERVICE_URL.pos, name: 'pos' },
  { prefix: '/api/admin', target: SERVICE_URL.backoffice, name: 'backoffice' },
  { prefix: '/api/internal', target: SERVICE_URL.backoffice, name: 'backoffice' },
  { prefix: '/api/v1/auth', target: SERVICE_URL.billing, name: 'billing' },
];

const breakers: Record<string, Breaker> = {
  pos: new Breaker('pos'),
  ai: new Breaker('ai'),
  billing: new Breaker('billing'),
  backoffice: new Breaker('backoffice'),
};

const app = express();

const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/v1/subscription/plans',
  '/api/v1/assistant/quick-chips',
  // Webhook punya secret terpisah yang diperiksa billing-service.
  '/api/v1/webhooks/payment-gateway',
  '/api/v1/webhooks/doku',
]);

function isPublicApi(url: string): boolean {
  return PUBLIC_API_PATHS.has(url.split('?')[0]);
}

// PENTING: body TIDAK diurai di sini. Gateway meneruskan aliran mentah apa
// adanya. Mengurai lalu menyusunnya kembali mengubah byte-nya — dan pada jalur
// webhook pembayaran itu merusak verifikasi tanda tangan.

app.use((req, res, next) => {
  // ID dari klien tidak dipercaya: klien bisa mengirim id yang sama untuk
  // ribuan request dan membuat penelusuran mustahil. Gateway yang menerbitkan.
  const requestId = buatRequestId();
  res.setHeader('x-request-id', requestId);
  jalankanDenganKonteks({ requestId, service: 'gateway' }, () => next());
});

function pickRoute(url: string) {
  const p = url.split('?')[0];
  let best: (typeof ROUTES)[number] | null = null;
  for (const r of ROUTES) {
    if (p === r.prefix || p.startsWith(r.prefix + '/')) {
      if (!best || r.prefix.length > best.prefix.length) best = r;
    }
  }
  return best;
}

/**
 * Request boleh diulang HANYA kalau mengulanginya aman.
 *
 * GET dan HEAD aman menurut definisi HTTP. POST tidak — mengulang
 * /api/v1/sync/transactions yang sebenarnya berhasil tapi jawabannya hilang
 * akan menggandakan transaksi. Endpoint sync memang punya kunci idempotensi
 * sendiri, tapi gateway tidak boleh berasumsi begitu untuk semua POST; asumsi
 * itu hanya perlu salah sekali untuk merusak pembukuan merchant.
 */
const bolehDiulang = (metode: string) => metode === 'GET' || metode === 'HEAD';

app.use('/api', async (req, res, next) => {
  const route = pickRoute(req.originalUrl);
  if (!route) return next();

  if (!isPublicApi(req.originalUrl)) {
    let authenticated = false;
    await requireGatewayAuthentication(req, res, () => {
      authenticated = true;
    });
    if (!authenticated) return;
  }

  const breaker = breakers[route.name];
  if (!breaker.bolehLewat()) {
    log.warn('breaker terbuka, menolak cepat', { service: route.name, path: req.path });
    return res.status(503).json({
      ok: false,
      error: 'SERVICE_UNAVAILABLE',
      service: route.name,
      detail: `Service ${route.name} sedang bermasalah. Coba lagi beberapa saat lagi.`,
    });
  }

  const requestId = String(res.getHeader('x-request-id') || '');
  const percobaanMaks = bolehDiulang(req.method) ? RETRY_MAX : 0;
  let errTerakhir: Error | null = null;

  for (let percobaan = 0; percobaan <= percobaanMaks; percobaan++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    const t0 = Date.now();

    try {
      const DIBUANG = new Set([
        'host', 'connection', 'content-length', 'transfer-encoding',
        'keep-alive', 'upgrade',
        // x-forwarded-* dari klien SELALU dibuang lalu diisi ulang di bawah.
        // Kalau diteruskan, siapa pun bisa mengirim
        // `x-forwarded-host: admin.domainanda.com` dan langsung dianggap berada
        // di lingkungan internal.
        'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-request-id',

        /*
         * x-internal-user DIBUANG DARI KLIEN, lalu diisi dari sesi
         * terverifikasi di bawah. Alasannya sama persis dengan x-auth-sub,
         * dan konsekuensinya jauh lebih besar.
         *
         * Header ini menentukan SIAPA yang sedang membuka konsol back-office,
         * dan konsol itu membaca pembukuan setiap merchant di platform.
         * Sebelum ini gateway meneruskannya apa adanya, sehingga siapa pun
         * yang punya sesi sah — merchant mana pun yang mendaftar — cukup
         * mengirim satu header untuk menjadi SUPERADMIN:
         *
         *   curl .../api/admin/transactions -H 'x-internal-user: ops@...'
         *
         * Diperagakan langsung terhadap gateway yang berjalan: jawabannya 200,
         * berisi transaksi merchant lain.
         *
         * Panel admin memang MENGIRIM header ini — ia login ke Supabase lalu
         * mengirimkan email yang sama. Yang hilang adalah pemeriksaan bahwa
         * keduanya cocok. Sekarang nilai dari klien tidak dipakai sama sekali;
         * yang berlaku adalah email sesi yang sudah diverifikasi.
         */
        'x-internal-user',
      ]);

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (DIBUANG.has(k.toLowerCase())) continue;
        if (typeof v === 'string') headers[k] = v;
        else if (Array.isArray(v)) headers[k] = v.join(', ');
      }

      // Host ASLI dibawa terpisah. `host` harus diganti host tujuan untuk
      // HTTP/1.1, dan tanpa x-forwarded-host backoffice kehilangan satu-satunya
      // cara membedakan admin.domainanda.com dari domain merchant.
      headers['x-forwarded-host'] = String(req.headers.host || '');
      headers['x-forwarded-proto'] = req.protocol;
      headers['x-forwarded-for'] = req.ip || '';
      headers['x-request-id'] = requestId;
      headers['host'] = new URL(route.target).host;
      const principal = res.locals.principal as AuthPrincipal | undefined;
      if (principal) {
        headers['x-auth-sub'] = principal.subject;
        if (principal.email) headers['x-auth-email'] = principal.email;

        /*
         * Identitas back-office = email sesi, bukan yang diakui klien.
         *
         * Backoffice mencarinya di internal.internal_users; email merchant
         * biasa tidak ada di sana, jadi ia dijawab UNKNOWN_IDENTITY. Itulah
         * perilaku yang benar: hak internal mengikuti akun yang benar-benar
         * dipakai masuk.
         */
        if (principal.email) headers['x-internal-user'] = principal.email;
      }
      // Service menolak request tanpa token ini, termasuk yang masuk langsung
      /*
       * PENGEMBANGAN LOKAL SAJA. Dengan AUTH_ALLOW_LOCAL_DEVELOPMENT=1 tidak
       * ada sesi Supabase, sehingga principal tidak membawa email dan konsol
       * admin tidak bisa dipakai sama sekali. Di sana — dan HANYA di sana —
       * nilai dari klien diteruskan.
       *
       * Bendera itu sendiri sudah menolak menyala di produksi
       * (services/shared/env.ts melempar bila NODE_ENV=production), jadi jalan
       * keluar ini tidak bisa terbuka tanpa disengaja.
       */
      if (!headers['x-internal-user'] && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1') {
        const dariKlien = req.headers['x-internal-user'];
        if (typeof dariKlien === 'string') headers['x-internal-user'] = dariKlien;
      }

      // ke port internal dengan x-auth-sub palsu.
      if (process.env.INTERNAL_GATEWAY_TOKEN) {
        headers['x-newhope-gateway-token'] = process.env.INTERNAL_GATEWAY_TOKEN;
      }

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const upstream = await fetch(route.target + req.originalUrl, {
        method: req.method,
        headers,
        body: hasBody ? (req as any) : undefined,
        // @ts-expect-error duplex wajib untuk body berupa stream di undici
        duplex: hasBody ? 'half' : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);
      breaker.catatSukses();

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      // requestId gateway yang menang, bukan gema dari service.
      res.setHeader('x-request-id', requestId);
      res.send(Buffer.from(await upstream.arrayBuffer()));

      const ms = Date.now() - t0;
      if (upstream.status >= 500 || ms > 3000) {
        log.warn('respons lambat atau error', {
          service: route.name, status: upstream.status, ms, path: req.path,
        });
      }
      return;
    } catch (err) {
      clearTimeout(timer);
      errTerakhir = err as Error;
      const aborted = errTerakhir.name === 'AbortError';

      // Timeout TIDAK diulang. Request yang menggantung 35 detik kemungkinan
      // besar sudah diterima service dan sedang diproses; mengulangnya
      // menggandakan pekerjaan yang sama, bukan menyelamatkannya.
      if (aborted || percobaan === percobaanMaks) break;

      const jeda = 100 * 2 ** percobaan;
      log.warn('gagal menghubungi, mengulang', {
        service: route.name, percobaan: percobaan + 1, jedaMs: jeda, sebab: errTerakhir.message,
      });
      await new Promise((r) => setTimeout(r, jeda));
    }
  }

  breaker.catatGagal();
  const aborted = errTerakhir?.name === 'AbortError';
  log.error('service tidak bisa dilayani', {
    service: route.name, method: req.method, path: req.path, sebab: errTerakhir?.message,
  });
  res.status(aborted ? 504 : 503).json({
    ok: false,
    error: aborted ? 'SERVICE_TIMEOUT' : 'SERVICE_UNAVAILABLE',
    service: route.name,
    requestId,
    detail: aborted
      ? `Service ${route.name} tidak menjawab dalam ${PROXY_TIMEOUT_MS / 1000} detik.`
      : `Service ${route.name} tidak bisa dihubungi.`,
  });
});

/** Kesehatan seluruh sistem dalam satu panggilan. */
app.get('/api/health', async (_req, res) => {
  const names = ['pos', 'ai', 'billing', 'backoffice'] as const;
  const checks = await Promise.all(
    names.map(async (n) => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${SERVICE_URL[n]}/ready`, { signal: AbortSignal.timeout(3000) });
        const body = await r.json().catch(() => ({}));
        return {
          service: n,
          ok: r.ok && body?.ok !== false,
          latencyMs: Date.now() - t0,
          breaker: breakers[n].status(),
        };
      } catch (err) {
        return {
          service: n,
          ok: false,
          latencyMs: Date.now() - t0,
          breaker: breakers[n].status(),
          error: 'UNAVAILABLE',
        };
      }
    })
  );
  const allOk = checks.every((c) => c.ok);
  // 503 kalau ada yang tidak siap: health check yang selalu 200 tidak berguna
  // bagi load balancer mana pun.
  res.status(allOk ? 200 : 503).json({ ok: allOk, services: checks });
});

/** Keadaan breaker, untuk menjawab "kenapa 503 padahal service-nya hidup?". */
app.get('/api/breakers', (_req, res) => {
  res.json({ ok: true, breakers: Object.values(breakers).map((b) => b.ringkasan()) });
});

app.get('/api/environment', (req, res) => {
  res.json({ ok: true, host: req.headers.host ?? null });
});

async function start() {
  const isAdminPath = (url: string) => url === '/admin' || url.startsWith('/admin/');

  if (process.env.NODE_ENV !== 'production') {
    app.use((req, _res, next) => {
      if (isAdminPath(req.url.split('?')[0])) req.url = '/admin.html';
      next();
    });
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, isAdminPath(req.path) ? 'admin.html' : 'index.html'));
    });
  }

  app.listen(PORTS.gateway, '0.0.0.0', () => {
    log.info(`siap di :${PORTS.gateway}`);
    for (const r of ROUTES) log.info(`  ${r.prefix.padEnd(22)} -> ${r.name}`);
  });
}

start().catch((err) => {
  log.error('gagal start', { sebab: err.message });
  process.exit(1);
});
