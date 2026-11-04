import { timingSafeEqual } from 'node:crypto';
import { isCronJobEnabled } from '../../services/shared/cron';
import { connectDb } from '../../services/shared/db';
import { runMerchantHealth } from '../../services/backoffice/merchantHealth';

export function createMerchantHealthHandler(connect = () => connectDb({schema:'internal',max:2})) {
  let database: ReturnType<typeof connect> | undefined;
  return async (req: any, res: any) => {
    const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
    const actual = String(req.headers.authorization || '');
    if (!expected || Buffer.byteLength(actual)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) {
      return res.status(401).json({ok:false,error:'UNAUTHORIZED_CRON'});
    }
    if (req.method !== 'GET') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
    if (!isCronJobEnabled('merchant-health')) return res.status(200).json({ok:true,skipped:true,reason:'JOB_DISABLED'});
    try {
      database ??= connect().catch(error=>{database=undefined;throw error;});
      const result = await runMerchantHealth(await database);
      return res.status(200).json({ok:true,job:'merchant-health',...result});
    } catch {
      console.error('[cron/merchant-health] execution failed');
      return res.status(503).json({ok:false,error:'MERCHANT_HEALTH_UNAVAILABLE'});
    }
  };
}
export default createMerchantHealthHandler();
