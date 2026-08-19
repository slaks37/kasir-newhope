/** GET /api/admin/catalog — katalog produk merchant, termasuk yang belum laku. */
import * as repo from '../../src/server/repo';
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_PRODUCT_SALES', (db) =>
    repo.catalog(db, req.query as repo.ListFilter)
  );
}
