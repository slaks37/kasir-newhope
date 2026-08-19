/**
 * GET /api/admin/access-audit — siapa membaca data merchant siapa.
 *
 * Hanya SUPERADMIN. Log audit yang bisa dibaca semua orang yang diaudit
 * kehilangan sebagian besar gunanya.
 */
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_ACCESS_AUDIT', async (db) => {
    const { rows } = await db.query(
      `SELECT l.id, l.internal_role, l.action, l.resource, l.justification,
              l.accessed_at, u.email AS internal_email, u.full_name AS internal_name,
              t.name AS merchant_name
         FROM internal.internal_access_log l
         JOIN internal.internal_users u ON u.id = l.internal_user_id
         LEFT JOIN pos.tenants t ON t.id = l.merchant_id
        ORDER BY l.accessed_at DESC
        LIMIT 200`
    );
    return { rows };
  });
}
