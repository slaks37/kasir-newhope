/** GET /api/admin/merchant-staff — staf kasir milik merchant. PIN tidak ikut. */
import { staffMerchant } from '../../src/server/internalUsersRepo';
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_MERCHANT_PROFILE', (db) => staffMerchant(db, req.query ?? {}));
}
