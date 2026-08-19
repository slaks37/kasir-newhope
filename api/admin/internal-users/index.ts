/**
 * GET  /api/admin/internal-users — daftar akun konsol internal.
 * POST /api/admin/internal-users — undang akun baru (tanpa password).
 */
import {
  InternalUserError,
  daftarUserInternal,
  undangUserInternal,
} from '../../../src/server/internalUsersRepo';
import { catatAkses, metodeDilayani, poolSebagaiDb, wajibAdmin } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  if (!metodeDilayani(req, res, ['GET', 'POST'])) return;

  const who = await wajibAdmin(req, res, 'MANAGE_INTERNAL_USERS');
  if (!who) return;

  const db = poolSebagaiDb();

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, rows: await daftarUserInternal(db) });
    }

    const user = await undangUserInternal(db, req.body ?? {});
    await catatAkses(who, 'INTERNAL_USER_INVITE', `/api/admin/internal-users/${user.id}`, req);
    return res.status(201).json({ ok: true, user });
  } catch (err: any) {
    if (err instanceof InternalUserError) {
      return res.status(400).json({ ok: false, error: err.code, detail: err.message });
    }
    console.error('[admin] internal-users:', err?.message);
    return res.status(500).json({ ok: false, error: 'INTERNAL_ERROR' });
  }
}
