#!/usr/bin/env node
// Run via npm run batch:billing (dry-run), or append -- --send after approval.
import { config } from 'dotenv';
import { connectDb } from '../../services/shared/db.ts';
import { runBillingReminders } from '../../services/billing/reminders.ts';
import { createReminderProvider } from '../../services/billing/reminderProvider.ts';

config({path:new URL('../../.env',import.meta.url).pathname});
let db;
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const dryRun = !process.argv.includes('--send');
  if (!dryRun && process.env.BILLING_REMINDERS_ENABLED !== '1') throw new Error('REMINDERS_NOT_ENABLED');
  const deps = dryRun ? {verifiedOwnerEmail:async()=>null,send:async()=>{throw new Error('DRY_RUN');}} : createReminderProvider();
  db = await connectDb({schema:'billing',max:2});
  const result = await runBillingReminders(db,deps,{dryRun,from:process.env.BILLING_EMAIL_FROM,appUrl:process.env.PUBLIC_APP_URL});
  console.log(JSON.stringify(result));
  if (result.failed || result.review) process.exitCode=1;
} catch (err) {
  console.error('Billing reminder gagal:',err.message);
  process.exitCode=1;
} finally { if(db) await db.close(); }
