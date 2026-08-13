/**
 * backoffice-service — pemilik skema `internal`.
 *
 * Konsol internal penyedia: kesehatan merchant, log transaksi lintas-merchant,
 * produk terjual, jejak aktivitas, dan audit akses.
 *
 * KENAPA DIPISAH — ini alasan keamanan, bukan alasan skala.
 *
 * Service ini memegang identitas yang boleh membaca pembukuan SETIAP merchant
 * di platform. Selama ia sekelas proses dengan aplikasi merchant, satu bug
 * eskalasi hak akses di sisi merchant berpotensi menjangkaunya. Sebagai proses
 * terpisah dengan peran database sendiri, batasnya ditegakkan Postgres:
 * svc_internal tidak punya hak baca ke pos, billing, maupun ai.
 *
 * Seluruh data merchant dibacanya lewat view di skema `contract` — tidak ada
 * satu pun akses langsung ke tabel milik service lain.
 */

// WAJIB paling awal: PORTS dan SERVICE_URL dievaluasi saat modul dimuat,
// jadi .env harus sudah terbaca sebelum modul lain diimpor.
import '../shared/env';
import { startService, PORTS } from '../shared/service';
import { ensureInternalUsers, registerAdminRoutes } from '../../src/server/adminRoutes';

startService({
  name: 'backoffice',
  port: PORTS.backoffice,
  schema: 'internal',
  register: async (app, ctx) => {
    await ensureInternalUsers(ctx.db as any);

    // registerAdminRoutes menerima getter karena di monolit database dibuka
    // malas. Di sini koneksinya sudah dipegang service sebelum route terpasang,
    // jadi getter-nya cukup mengembalikan yang sudah ada.
    registerAdminRoutes(app, () => Promise.resolve(ctx.db as any));
  },
});
