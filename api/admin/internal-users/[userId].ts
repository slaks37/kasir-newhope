/**
 * PATCH /api/admin/internal-users/:userId — ubah peran, aktif, atau cabut password.
 *
 * Tidak ada DELETE. Akun internal tidak pernah dihapus: `internal_access_log`
 * menunjuk barisnya, dan jejak audit yang kehilangan pelakunya berhenti menjadi
 * jejak audit. Yang bisa dilakukan adalah menonaktifkannya.
 */
import {
  InternalUserError,
  cabutPassword,
  ubahAktif,
  ubahPeran,
} from '../../../src/server/internalUsersRepo';
import { layaniTulis } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniTulis(req, res, 'MANAGE_INTERNAL_USERS', ['PATCH'], async (db, who) => {
    const userId = String(req.query?.userId ?? '').trim();
    if (!userId) throw Object.assign(new Error('userId wajib diisi.'), { kode: 'USER_ID_REQUIRED' });

    const b = req.body ?? {};
    try {
      if (typeof b.role === 'string') {
        const user = await ubahPeran(db, userId, b.role, who.id);
        return { aksi: `INTERNAL_USER_ROLE_${b.role}`, hasil: { user } };
      }
      if (typeof b.isActive === 'boolean') {
        const user = await ubahAktif(db, userId, b.isActive, who.id);
        return {
          aksi: b.isActive ? 'INTERNAL_USER_ACTIVATE' : 'INTERNAL_USER_DEACTIVATE',
          hasil: { user },
        };
      }
      if (b.revokePassword === true) {
        const user = await cabutPassword(db, userId, who.id);
        return { aksi: 'INTERNAL_USER_REVOKE_PASSWORD', hasil: { user } };
      }
    } catch (err: any) {
      if (err instanceof InternalUserError) throw Object.assign(err, { kode: err.code });
      throw err;
    }

    throw Object.assign(
      new Error('Sebutkan salah satu: role, isActive, atau revokePassword.'),
      { kode: 'NO_CHANGE' }
    );
  });
}
