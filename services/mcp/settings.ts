import type { Db } from '../shared/db';
/** Environment enables deployment readiness; the admin switch can pause it. */
export async function mcpAdminSettings(db: Db) {
  try {
    const row = (await db.query("SELECT enabled,updated_at FROM internal.platform_integrations WHERE key='mcp'")).rows[0];
    return { enabled: row?.enabled !== false, updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null, available: true };
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error;
    return { enabled: true, updatedAt: null, available: false };
  }
}
