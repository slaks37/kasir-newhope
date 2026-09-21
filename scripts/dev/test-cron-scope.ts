// No environment files, databases or provider calls are used by this test.
import assert from 'node:assert/strict';
import pg from 'pg';
import { isCronJobEnabled } from '../../services/shared/cron';
import { createDailyInsightsHandler } from '../../src/server/dailyInsightsHandler';
import billing from '../../src/server/billingRemindersHandler';
import health from '../../api/cron/merchant-health';

const keys = ['CRON_SECRET', 'CRON_ENABLED_JOBS', 'DATABASE_URL'];
const saved = keys.map(key => process.env[key]);
const originalConnect = pg.Pool.prototype.connect;
let connections = 0;
try {
  pg.Pool.prototype.connect = (() => { connections++; throw new Error('DATABASE_MUST_NOT_CONNECT'); }) as any;
  process.env.CRON_SECRET = 'test-only-cron-secret';
  delete process.env.DATABASE_URL;
  delete process.env.CRON_ENABLED_JOBS;
  assert.equal(isCronJobEnabled('daily-insights'), true);
  process.env.CRON_ENABLED_JOBS = 'daily-insights';
  assert.equal(isCronJobEnabled('daily-insights'), true);
  assert.equal(isCronJobEnabled('billing-reminders'), false);
  assert.equal(isCronJobEnabled('merchant-health'), false);
  process.env.CRON_ENABLED_JOBS = ' daily-insights, merchant-health ';
  assert.equal(isCronJobEnabled('merchant-health'), true);
  assert.equal(isCronJobEnabled('health'), false);
  const daily = createDailyInsightsHandler(async () => { connections++; throw new Error('DATABASE_MUST_NOT_CONNECT'); });
  for (const [name, handler] of [['daily-insights', daily], ['billing-reminders', billing], ['merchant-health', health]] as const) {
    let status = 0, body: any;
    const response = { status: (code: number) => { status = code; return response; }, json: (value: any) => { body = value; return response; } };
    for (const allowed of ['', 'unrelated-job', ...(name === 'daily-insights' ? [] : ['daily-insights'])]) {
      process.env.CRON_ENABLED_JOBS = allowed;
      await handler({ method: 'GET', headers: {} }, response);
      assert.equal(status, 401, `${name}: disabling does not bypass authentication`);
      await handler({ method: 'GET', headers: { authorization: 'Bearer test-only-cron-secret' } }, response);
      assert.equal(status, 200);
      assert.deepEqual(body, { ok: true, skipped: true, reason: 'JOB_DISABLED' });
      await handler({ method: 'POST', headers: { authorization: 'Bearer test-only-cron-secret' } }, response);
      assert.equal(status, 405);
    }
  }
  assert.equal(connections, 0);
  console.log('PASS: exact cron allowlist, backward compatibility, auth/method guards, disabled jobs never connect to database');
} finally {
  pg.Pool.prototype.connect = originalConnect;
  keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
}
