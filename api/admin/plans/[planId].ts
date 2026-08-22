/**
 * Satu paket: riwayat, penyimpanan, dan tombol aktif.
 *
 *   GET   /api/admin/plans/:planId   -> riwayat perubahan paket ini
 *   PUT   /api/admin/plans/:planId   -> simpan harga, batas, akses, benefit
 *   PATCH /api/admin/plans/:planId   -> aktifkan / nonaktifkan
 *
 * Paket tidak bisa DIHAPUS, dan itu disengaja — lihat catatan di
 * src/server/plansRepo.ts. Menghapus paket akan memutus `subscriptions.plan_id`
 * merchant yang sedang membayarnya.
 */

type VercelRequest = any;
type VercelResponse = any;

import {
  PlanValidationError,
  bacaMasukanPaket,
  riwayatPaket,
  simpanPaket,
  ubahAktifPaket,
} from '../../../src/server/plansRepo';
import { layaniBaca, layaniTulis } from '../../_lib/adminContext';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const planId = String(req.query?.planId ?? '').trim().toLowerCase();

  if (req.method === 'GET') {
    return layaniBaca(req, res, 'MANAGE_SUBSCRIPTION', (db) =>
      riwayatPaket(db, planId).then((rows) => ({ rows }))
    );
  }

  return layaniTulis(req, res, 'MANAGE_SUBSCRIPTION', ['PUT', 'PATCH'], async (db, who) => {
    if (!planId) throw Object.assign(new Error('planId wajib diisi.'), { kode: 'PLAN_ID_REQUIRED' });

    try {
      if (req.method === 'PATCH') {
        const aktif = req.body?.isActive !== false;
        const plan = await ubahAktifPaket(db, planId, aktif, who.email);
        if (!plan) throw Object.assign(new Error('Paket tidak ditemukan.'), { kode: 'PLAN_NOT_FOUND' });
        return { aksi: aktif ? 'PLAN_ACTIVATE' : 'PLAN_DEACTIVATE', hasil: { plan } };
      }

      // PUT — aktornya diambil dari token, BUKAN dari body. Membiarkan
      // pemanggil menyebut namanya sendiri di `updated_by` membuat riwayat
      // harga bisa ditandatangani atas nama orang lain, dan riwayat yang bisa
      // dipalsukan lebih buruk daripada tidak ada riwayat — ia tetap dipercaya.
      const masukan = bacaMasukanPaket({ ...req.body, id: planId });
      const { plan, kind } = await simpanPaket(db, masukan, who.email);
      return { aksi: `PLAN_${kind}`, hasil: { plan, kind } };
    } catch (err: any) {
      if (err instanceof PlanValidationError) {
        throw Object.assign(err, { kode: 'PLAN_INVALID' });
      }
      throw err;
    }
  });
}
