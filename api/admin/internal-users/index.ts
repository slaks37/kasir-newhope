/**
 * GET  /api/admin/internal-users — daftar akun konsol internal.
 * POST /api/admin/internal-users — undang akun baru (tanpa password).
 */
import {
  InternalUserError,
  daftarUserInternal,
  undangUserInternal,
} from '../../../src/server/internalUsersRepo';
import { layaniBaca, layaniTulis } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  // Membaca daftar dan MEMBUAT akun adalah dua hal berbeda, jadi dua
  // pembungkus berbeda. Yang kedua menuntut alasan tertulis dan mencatat
  // hasilnya — termasuk saat gagal.
  if (req.method === 'GET') {
    return layaniBaca(req, res, 'MANAGE_INTERNAL_USERS', (db) =>
      daftarUserInternal(db).then((rows) => ({ rows }))
    );
  }

  return layaniTulis(req, res, 'MANAGE_INTERNAL_USERS', ['POST'], async (db) => {
    try {
      const user = await undangUserInternal(db, req.body ?? {});
      return { aksi: 'INTERNAL_USER_INVITE', hasil: { user }, status: 201 };
    } catch (err: any) {
      if (err instanceof InternalUserError) {
        throw Object.assign(err, { kode: err.code });
      }
      throw err;
    }
  });
}
