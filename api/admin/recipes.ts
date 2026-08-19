/** GET /api/admin/recipes — komposisi BOM per produk beserta biaya per porsi. */
import * as repo from '../../src/server/repo';
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_PRODUCT_SALES', (db) =>
    repo.productRecipes(db, req.query as repo.ListFilter)
  );
}
