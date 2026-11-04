import {growthBusinessConnection} from './growth/businessConnection';
import { authenticateBearer } from '../../services/shared/auth';
import { connectDb } from '../../services/shared/db';
import { registerBillingRoutes } from '../../services/billing/routes';
import { DOKU_NOTIFICATION_PATH } from '../../api/_doku';
import { createServerlessBoundary } from './serverlessBoundary';

/**
 * Satu-satunya entry Vercel untuk langganan dan webhook DOKU.
 *
 * Semua route memakai services/billing yang sama dengan gateway: invoice
 * disimpan sebelum checkout, pembayaran direkonsiliasi lewat webhook
 * bertanda tangan, dan verify hanya membaca invoice milik tenant sendiri.
 */
export const BILLING_ROUTES = {
  '/api/v1/subscription/plans': ['GET'],
  '/api/v1/subscription/status': ['GET'],
  '/api/v1/subscription/start-trial': ['POST'],
  '/api/v1/subscription/free-plan': ['POST'],
  '/api/v1/subscription/outlets': ['GET', 'POST'],
  '/api/v1/subscription/prorated-upgrade': ['POST'],
  '/api/v1/subscription/checkout': ['POST'],
  '/api/v1/subscription/verify': ['GET'],
  [DOKU_NOTIFICATION_PATH]: ['POST'],
} as const satisfies Record<string, readonly string[]>;

export function createBillingHandler(authenticate = authenticateBearer, connect = () => connectDb({ schema: 'billing', max: 2,connectionString:growthBusinessConnection() })) {
  return createServerlessBoundary({
    name: 'billing',
    routes: BILLING_ROUTES,
    publicRoutes: ['/api/v1/subscription/plans', DOKU_NOTIFICATION_PATH],
    rawBodyRoutes: [DOKU_NOTIFICATION_PATH],
    bodyLimit: '32kb',
    register: (app, db) => registerBillingRoutes(app, db, true),
    unavailableError: 'BILLING_UNAVAILABLE',
    invalidRequestError: 'INVALID_REQUEST',
  }, authenticate, connect);
}

export default createBillingHandler();
