/** GET /api/admin/activity/breakdown — rekap kejadian per sektor x modul x tingkat. */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_ACTIVITY_LOG', async (db) => ({
    rows: await repo.activityBreakdown(db),
  }));
}
