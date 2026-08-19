/** GET /api/admin/merchants — direktori merchant, tersaring dan berhalaman. */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_MERCHANT_HEALTH', (db) =>
    repo.merchantDirectory(db, req.query as repo.ListFilter)
  );
}
