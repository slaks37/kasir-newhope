#!/usr/bin/env node
// API and CLI share canonical schema, scoring, terminal history and locking.
// Run with node --import tsx (or npm run batch:health[:dry]).
import { connectDb } from '../../services/shared/db.ts';
import { runMerchantHealth } from '../../services/backoffice/merchantHealth.ts';
const args = process.argv.slice(2);
if (args.some(value=>value!=='--dry-run')) throw new Error('INVALID_ARGUMENTS');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
// This job writes health/history: a read-only analytics replica is not a writer.
const db = await connectDb({schema:'internal',max:1});
try { console.log(JSON.stringify(await runMerchantHealth(db,{dryRun:args.includes('--dry-run')}))); }
finally { await db.close(); }
