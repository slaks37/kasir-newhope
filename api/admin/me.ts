/**
 * GET /api/admin/me — siapa pemegang token ini, dan boleh apa saja.
 *
 * Capability SELALU datang dari sini, tidak pernah disusun panel sendiri.
 * Panel yang menentukan daftarnya sendiri hanya menyembunyikan menu; itu
 * kerapian tampilan, bukan batas keamanan.
 */

type VercelRequest = any;
type VercelResponse = any;

import { internalCapabilities } from '../../src/lib/rbac/environments';
import { metodeDilayani, wajibAdmin } from '../_lib/adminContext';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!metodeDilayani(req, res, ['GET'])) return;

  // VIEW_SECTOR_ANALYTICS dimiliki ketiga role internal, jadi ia berlaku
  // sebagai "sudah masuk" tanpa memberi hak apa pun yang belum dimiliki.
  const who = await wajibAdmin(req, res, 'VIEW_SECTOR_ANALYTICS');
  if (!who) return;

  return res.status(200).json({
    ok: true,
    user: { email: who.email, fullName: who.fullName, role: who.role },
    capabilities: internalCapabilities(who.role),
  });
}
