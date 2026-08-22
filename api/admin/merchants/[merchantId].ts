/**
 * GET /api/admin/merchants/:merchantId — profil satu merchant.
 *
 * Membaca pembukuan merchant yang teridentifikasi, jadi capability-nya berbeda
 * dari daftar: Growth tidak mendapatkannya, dan Support wajib menyertakan
 * alasan. Keduanya ditegakkan layaniBaca lewat merchantId di query.
 */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';
import { internalCapabilities } from '../../../src/lib/rbac/environments';

export default async function handler(req: any, res: any) {
  // Profil dulu. Blok keuangannya ikut HANYA bila pemanggilnya juga memegang
  // VIEW_MERCHANT_FINANCIAL — capability tunggal yang lama membuka keduanya
  // sekaligus, jadi yang perlu memeriksa nama cabang ikut membaca pembukuannya.
  return layaniBaca(req, res, 'VIEW_MERCHANT_PROFILE', async (db, who) => {
    const id = String(req.query?.merchantId ?? '');
    const bolehKeuangan = internalCapabilities(who.role).includes('VIEW_MERCHANT_FINANCIAL');
    const detail = await repo.merchantDetail(db, id, { bolehKeuangan });
    if (!detail) throw Object.assign(new Error('MERCHANT_NOT_FOUND'), { notFound: true });
    return detail;
  });
}
