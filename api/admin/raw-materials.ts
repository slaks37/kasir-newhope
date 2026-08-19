/** GET /api/admin/raw-materials — bahan baku merchant beserta status menipis. */
import * as repo from '../../src/server/repo';
import { layaniBaca } from '../_lib/adminContext';

export default async function handler(req: any, res: any) {
  return layaniBaca(req, res, 'VIEW_PRODUCT_SALES', (db) =>
    repo.rawMaterials(db, req.query as repo.ListFilter)
  );
}
