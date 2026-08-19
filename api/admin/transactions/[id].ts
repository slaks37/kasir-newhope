/** GET /api/admin/transactions/:id — satu struk beserta barisnya. */
import * as repo from '../../../src/server/repo';
import { layaniBaca } from '../../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_TRANSACTION_LOG', async (db) => {
    const detail = await repo.transactionDetail(db, String(req.query?.id ?? ''));
    if (!detail) throw Object.assign(new Error('TRANSACTION_NOT_FOUND'), { notFound: true });
    return detail;
  });
}
