/** GET /api/admin/overview — ringkasan lima sektor untuk kartu depan panel. */
import * as repo from '../../src/server/repo';
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_SECTOR_ANALYTICS', async (db) => {
    const [sectors, totals, daily] = await Promise.all([
      repo.sectorSummary(db),
      repo.platformTotals(db),
      repo.dailyRevenue(db, 30),
    ]);
    return { sectors, totals, daily, sectorLabels: repo.SECTOR_LABEL };
  });
}
