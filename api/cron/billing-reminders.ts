import { connectDb, type Db } from '../../services/shared/db';
import { runBillingReminders, type ReminderDependencies } from '../../services/billing/reminders';
import { createReminderProvider } from '../../services/billing/reminderProvider';

let database: Promise<Db> | undefined;
const dryProvider: ReminderDependencies = {
  verifiedOwnerEmail:async()=>{throw new Error('DRY_RUN_MUST_NOT_LOOK_UP_USERS');},
  send:async()=>{throw new Error('DRY_RUN_MUST_NOT_SEND');},
};
export default async function handler(req:any,res:any) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ok:false,error:'UNAUTHORIZED_CRON'});
  }
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  if (!process.env.DATABASE_URL) return res.status(503).json({ok:false,error:'DATABASE_NOT_CONFIGURED'});
  try {
    const dryRun = process.env.BILLING_REMINDERS_ENABLED !== '1';
    const provider = dryRun ? dryProvider : createReminderProvider();
    database ??= connectDb({schema:'billing',max:2}).catch(err=>{database=undefined;throw err;});
    const result = await runBillingReminders(await database,provider,{
      dryRun,from:process.env.BILLING_EMAIL_FROM,appUrl:process.env.PUBLIC_APP_URL,
    });
    return res.status(result.failed || result.review ? 503 : 200).json({ok:!result.failed && !result.review,...result});
  } catch {
    return res.status(503).json({ok:false,error:'BILLING_REMINDERS_UNAVAILABLE'});
  }
}
