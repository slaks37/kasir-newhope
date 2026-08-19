/**
 * GET /api/admin/merchants/:merchantId — profil satu merchant.
 *
 * Membaca pembukuan merchant yang teridentifikasi, jadi capability-nya berbeda
 * dari daftar: Growth tidak mendapatkannya, dan Support wajib menyertakan
 * alasan. Keduanya ditegakkan layaniBaca lewat merchantId di query.
 */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_MERCHANT_DETAIL', async (db) => {
    const id = String(req.query?.merchantId ?? '');
    const detail = await repo.merchantDetail(db, id);
    if (!detail) throw Object.assign(new Error('MERCHANT_NOT_FOUND'), { notFound: true });
    return detail;
  });
}
