import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { installAuthenticatedFetch } from '../lib/authenticatedFetch';
import AdminApp from './AdminApp';

/*
 * WAJIB, dan mudah terlewat.
 *
 * Gateway menuntut Bearer token untuk /api/admin/* — jalur itu tidak ada di
 * PUBLIC_API_PATHS. Aplikasi kasir memasang pembungkus ini di src/main.tsx,
 * tapi konsol admin punya entrypoint sendiri dan tidak pernah ikut.
 *
 * Selama konsol dilayani dari fikstur, ketiadaannya tidak terasa: tidak ada
 * permintaan jaringan yang bisa gagal. Begitu api.ts benar-benar memanggil
 * server, setiap layar akan menjawab 401 tanpa petunjuk sebab.
 */
installAuthenticatedFetch();

const el = document.getElementById('admin-root');
if (!el) throw new Error('#admin-root tidak ditemukan di admin.html');

createRoot(el).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
);
