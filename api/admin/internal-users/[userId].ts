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
import { catatAkses, metodeDilayani, poolSebagaiDb, wajibAdmin } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  if (!metodeDilayani(req, res, ['PATCH'])) return;

  const who = await wajibAdmin(req, res, 'MANAGE_INTERNAL_USERS');
  if (!who) return;

  const userId = String(req.query?.userId ?? '').trim();
  if (!userId) return res.status(400).json({ ok: false, error: 'USER_ID_REQUIRED' });

  const db = poolSebagaiDb();
  const b = req.body ?? {};

  try {
    let user;
    let aksi: string;

    if (typeof b.role === 'string') {
      user = await ubahPeran(db, userId, b.role, who.id);
      aksi = `INTERNAL_USER_ROLE_${b.role}`;
    } else if (typeof b.isActive === 'boolean') {
      user = await ubahAktif(db, userId, b.isActive, who.id);
      aksi = b.isActive ? 'INTERNAL_USER_ACTIVATE' : 'INTERNAL_USER_DEACTIVATE';
    } else if (b.revokePassword === true) {
      user = await cabutPassword(db, userId, who.id);
      aksi = 'INTERNAL_USER_REVOKE_PASSWORD';
    } else {
      return res.status(400).json({
        ok: false,
        error: 'NO_CHANGE',
        detail: 'Sebutkan salah satu: role, isActive, atau revokePassword.',
      });
    }

    await catatAkses(who, aksi, `/api/admin/internal-users/${userId}`, req);
    return res.status(200).json({ ok: true, user });
  } catch (err: any) {
    if (err instanceof InternalUserError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ ok: false, error: err.code, detail: err.message });
    }
    console.error('[admin] internal-users patch:', err?.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
