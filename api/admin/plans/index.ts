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
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return layaniBaca(req, res, 'MANAGE_SUBSCRIPTION', async (db) => {
    const [plans, subscriberCounts] = await Promise.all([daftarPaket(db), pemakaiPaket(db)]);
    return { plans, subscriberCounts };
  });
}
