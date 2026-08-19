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
import { catatAkses, metodeDilayani, poolSebagaiDb, wajibAdmin } from '../../_lib/adminContext';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!metodeDilayani(req, res, ['GET', 'PUT', 'PATCH'])) return;

  const who = await wajibAdmin(req, res, 'MANAGE_SUBSCRIPTION');
  if (!who) return;

  const planId = String(req.query?.planId ?? '').trim().toLowerCase();
  if (!planId) return res.status(400).json({ ok: false, error: 'PLAN_ID_REQUIRED' });

  const db = poolSebagaiDb();

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, rows: await riwayatPaket(db, planId) });
    }

    if (req.method === 'PATCH') {
      const aktif = req.body?.isActive !== false;
      const plan = await ubahAktifPaket(db, planId, aktif, who.email);
      if (!plan) return res.status(404).json({ ok: false, error: 'PLAN_NOT_FOUND' });

      await catatAkses(who, aktif ? 'PLAN_ACTIVATE' : 'PLAN_DEACTIVATE', `/api/admin/plans/${planId}`, req);
      return res.status(200).json({ ok: true, plan });
    }

    // PUT — aktornya diambil dari token, BUKAN dari body. Membiarkan pemanggil
    // menyebut namanya sendiri di `updated_by` membuat riwayat harga bisa
    // ditandatangani atas nama orang lain, dan riwayat yang bisa dipalsukan
    // lebih buruk daripada tidak ada riwayat — ia tetap dipercaya.
    const masukan = bacaMasukanPaket({ ...req.body, id: planId });
    const { plan, kind } = await simpanPaket(db, masukan, who.email);

    await catatAkses(who, `PLAN_${kind}`, `/api/admin/plans/${planId}`, req);
    return res.status(200).json({ ok: true, plan, kind });
  } catch (err: any) {
    if (err instanceof PlanValidationError) {
      return res.status(400).json({ ok: false, error: 'PLAN_INVALID', issues: err.issues });
    }
    console.error('[admin] gagal menyimpan paket:', err?.message);
    return res.status(500).json({ ok: false, error: 'PLAN_SAVE_FAILED' });
  }
}
