/*
 * Kill-switch service worker. Pakai HANYA saat rollback ke versi tanpa service
 * worker: salin file ini ke public/sw.js di commit revert. Browser yang masih
 * memegang service worker kasir akan menghapus cache-nya, melepas registrasi,
 * lalu memuat ulang tab ke versi dari jaringan.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('nh-shell-')) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
