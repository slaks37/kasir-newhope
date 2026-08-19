/** GET /api/admin/transactions — log transaksi lintas merchant. */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_TRANSACTION_LOG', (db) =>
    repo.transactionLog(db, req.query as repo.ListFilter)
  );
}
