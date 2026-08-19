/**
 * GET /api/admin/plans — katalog paket beserta jumlah pemakainya.
 *
 * Jumlah pemakai ikut dikirim karena menaikkan harga paket yang sedang dipakai
 * 40 merchant adalah keputusan yang berbeda dari menaikkan harga paket yang
 * belum dipakai siapa-siapa — dan layarnya harus menunjukkan bedanya sebelum
 * tombol simpan ditekan, bukan sesudah.
 */

type VercelRequest = any;
type VercelResponse = any;

import { daftarPaket, pemakaiPaket } from '../../../src/server/plansRepo';
import { metodeDilayani, poolSebagaiDb, wajibAdmin } from '../../_lib/adminContext';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!metodeDilayani(req, res, ['GET'])) return;

  const who = await wajibAdmin(req, res, 'MANAGE_SUBSCRIPTION');
  if (!who) return;

  try {
    const db = poolSebagaiDb();
    const [plans, subscriberCounts] = await Promise.all([daftarPaket(db), pemakaiPaket(db)]);
    return res.status(200).json({ ok: true, plans, subscriberCounts });
  } catch (err: any) {
    console.error('[admin] gagal memuat paket:', err?.message);
    return res.status(503).json({ ok: false, error: 'DATABASE_UNAVAILABLE' });
  }
}
