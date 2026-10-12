import { authenticateBearer } from '../../services/shared/auth';
import { connectDb } from '../../services/shared/db';
import { registerSyncRoutes } from '../../services/pos/sync';
import { createServerlessBoundary } from './serverlessBoundary';

const allowedMethods: Record<string, readonly string[]> = {
  '/api/v1/privacy/requests':['GET','POST'],
  '/api/v1/privacy/notices':['POST'],
  '/api/v1/sync/business': ['GET','POST'],
  '/api/v1/sync/catalog': ['GET', 'POST'],
  '/api/v1/sync/transactions': ['POST'],
  '/api/v1/sync/activity': ['POST'],
  '/api/v1/sync/customers': ['POST'],
  '/api/v1/sync/attendance': ['POST'],
  '/api/v1/sync/payroll': ['POST'],
  '/api/v1/sync/state': ['GET','POST'],
  '/api/v1/sync/status': ['GET'],
  '/api/v1/sync/receipt-logo': ['GET', 'PUT'],
  '/api/v1/reports/summary': ['GET'],
  '/api/v1/reports/transactions': ['GET'],
  '/api/v1/finance/pin': ['POST'],
  '/api/v1/finance/approve': ['POST'],
  '/api/v1/finance/refund': ['POST'],
  '/api/v1/finance/cash': ['POST'],
  '/api/v1/finance/cash/reverse': ['POST'],
  '/api/v1/finance/shift': ['GET'],
  '/api/v1/finance/shift/open': ['POST'],
  '/api/v1/finance/shift/close': ['POST'],
};

/** POS-only runtime. No admin, billing, webhook or anonymous routes mounted. */
export function createSyncHandler(
  authenticate=authenticateBearer,
  connect=()=>connectDb({schema:'pos',max:2}),
) {
  return createServerlessBoundary({
    name:'sync',routes:allowedMethods,bodyLimit:'10mb',register:registerSyncRoutes,
    unavailableError:'SYNC_UNAVAILABLE',invalidRequestError:'INVALID_SYNC_REQUEST',
  },authenticate,connect);
}

export default createSyncHandler();
