import plansHandler from '../../api/_subscription/plans';
import freePlanHandler from '../../api/_subscription/free-plan';
import verifyHandler from '../../api/_subscription/verify';
import checkoutHandler from '../../api/_subscription/checkout';
import outletBillingHandler from './outletBillingHandler';
import proratedUpgradeHandler from '../../api/_subscription/prorated-upgrade';
import { normalizeVercelUrl } from './vercelUrl';

export default async function handler(req: any, res: any) {
  normalizeVercelUrl(req);
  let action = '';
  if (req.query?.slug) {
    action = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  }
  if (!action && req.url) {
    const pathname = req.url.split('?')[0].replace(/\/+$/, '');
    const segments = pathname.split('/');
    action = segments[segments.length - 1];
  }

  switch (action) {
    case 'free-plan':
      return freePlanHandler(req, res);
    case 'plans':
      return plansHandler(req, res);
    case 'verify':
      return verifyHandler(req, res);
    case 'checkout':
      return checkoutHandler(req, res);
    case 'start-trial':
    case 'status':
    case 'outlets':
      return outletBillingHandler(req, res);
    case 'prorated-upgrade':
      return proratedUpgradeHandler(req, res);
    default:
      return res.status(404).json({
        ok: false,
        error: 'ENDPOINT_NOT_FOUND',
        requestedAction: action,
        availableActions: ['plans', 'verify', 'checkout', 'start-trial', 'status', 'outlets', 'prorated-upgrade', 'free-plan'],
      });
  }
}
