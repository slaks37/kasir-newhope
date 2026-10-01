import assert from 'node:assert/strict';
import { databasePoolLimits, serverlessConnectionString } from '../../services/shared/poolConfig';

const session = 'postgresql://svc_pos.project:p%40ss%3Aword@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
const transaction = serverlessConnectionString(session, '1');
const before = new URL(session), after = new URL(transaction);
assert.equal(after.port, '6543');
for (const field of ['hostname','username','password','pathname','search','protocol'] as const) {
  assert.equal(after[field], before[field], `${field} must not change`);
}
assert.equal(serverlessConnectionString(session, '0'), session);
assert.equal(serverlessConnectionString(transaction, '1'), transaction);
for (const unchanged of [
  'postgres://postgres@127.0.0.1:5432/postgres',
  'postgres://postgres@db.project.supabase.co:5432/postgres',
  'postgres://postgres@aws-0-us-east-1.pooler.supabase.com.evil.test:5432/postgres',
  'postgres://postgres@another-provider.test:5432/postgres',
  'not-a-url',
]) assert.equal(serverlessConnectionString(unchanged, '1'), unchanged);
assert.deepEqual(databasePoolLimits(10,'1'), {max:2,idleTimeoutMillis:5000,connectionTimeoutMillis:10000});
assert.equal(databasePoolLimits(1,'1').max, 1);
assert.equal(databasePoolLimits(10,'0').max, 10);
console.log('PASS serverless transaction pool: endpoint, credentials, local/provider isolation, bounded connections');
