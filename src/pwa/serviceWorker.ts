import {isNative} from '../platform/runtime/platform';
/**
 * Service worker aplikasi kasir, dibangkitkan saat build (vite.config.ts).
 *
 * Tujuan tunggal: kasir yang me-refresh halaman saat internet mati tetap bisa
 * membuka aplikasi. Data offline (antrean penjualan, snapshot toko) sudah
 * disimpan aplikasi sendiri; service worker hanya menyimpan file statis.
 *
 *  - Navigasi (halaman kasir): network-first, fallback ke app.html tersimpan.
 *  - /assets/* (nama ber-hash, tidak pernah berubah): cache-first.
 *  - TIDAK PERNAH: /api/*, /admin*, /blog*, sitemap/RSS, request non-GET, domain lain (Supabase, CDN).
 *  - Versi baru menunggu sampai semua tab lama ditutup (tanpa skipWaiting), agar
 *    satu tab tidak memuat campuran chunk dari dua build.
 */
export function serviceWorkerSource(buildId: string, assets: readonly string[]): string {
  return `/* New Hope POS service worker — build ${buildId}. Generated; do not edit. */
const SHELL = 'nh-shell-${buildId}';
const PRECACHE = ${JSON.stringify(['/app.html', '/manifest.json', '/favicon.svg', '/images/products/kopi-susu.webp', '/images/products/matcha-latte.webp', '/images/products/nasi-goreng.webp', '/images/products/croissant.webp', ...assets])};

function route(request) {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return 'network';
  if (url.pathname.startsWith('/api/') || url.pathname === '/api' || url.pathname.startsWith('/admin') || url.pathname === '/sw.js') return 'network';
  // Server-rendered pages and AI discoverability files: never cached as the app shell.
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/landing.html' || url.pathname === '/blog' || url.pathname.startsWith('/blog/') || url.pathname === '/sitemap.xml' || url.pathname === '/rss.xml' || url.pathname === '/llms.txt' || url.pathname.startsWith('/.well-known/') || url.pathname === '/robots.txt') return 'network';
  if (request.mode === 'navigate') return 'shell';
  if (url.pathname.startsWith('/assets/')) return 'asset';
  return 'network';
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(PRECACHE);
    const app = await cache.match('/app.html');
    // Previous workers used /index.html as their cashier fallback. Keep that
    // fallback operational while this worker waits for existing tabs to close.
    if (app) for (const key of await caches.keys()) {
      if (key.startsWith('nh-shell-') && key !== SHELL) {
        await (await caches.open(key)).put('/index.html', app.clone());
      }
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('nh-shell-') && key !== SHELL).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function shell(request) {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
      const cache = await caches.open(SHELL);
      await cache.put('/app.html', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('/app.html');
    return cached || Response.error();
  }
}

async function asset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(SHELL);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const kind = route(event.request);
  if (kind === 'shell') event.respondWith(shell(event.request));
  else if (kind === 'asset') event.respondWith(asset(event.request));
});
`;
}

/** Registers the worker in production builds only, never for the internal console. */
export function registerServiceWorker(): void {
  if (isNative() || !import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (window.location.pathname.startsWith('/admin')) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('[pwa] registrasi service worker gagal:', error));
  });
}
