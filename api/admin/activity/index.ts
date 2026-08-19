/** GET /api/admin/activity — jejak kejadian merchant, bukan hanya penjualan. */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_ACTIVITY_LOG', (db) =>
    repo.activityLog(db, req.query as repo.ListFilter)
  );
}
