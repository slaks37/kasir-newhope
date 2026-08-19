/** GET /api/admin/branches — cabang merchant beserta pemakaian kuota outletnya. */
import * as repo from '../../src/server/repo';
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_MERCHANT_DETAIL', (db) =>
    repo.branches(db, req.query as repo.ListFilter)
  );
}
