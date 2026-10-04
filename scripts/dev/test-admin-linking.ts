// Email-based admin linking can never escalate, re-bind or reactivate. Isolated PGlite; no network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import type { Db } from '../../services/shared/db';
import { registerAdminRoutes } from '../../src/server/adminRoutes';

const pg = new PGlite();
const wrap = (runner: any): Db => ({ query: async (sql, params) => { const r = await runner.query(sql, params); return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 }; },
  exec: async sql => { await runner.exec(sql); }, tx: async fn => pg.transaction(c => fn(wrap(c))), close: () => pg.close() });
const db = wrap(pg);
for (const file of ['migrations/0001_compat.sql', 'schema.sql', 'schema_hybrid_pos.sql', ...fs.readdirSync('migrations').filter(f => /^\d{4}_.*\.sql$/.test(f) && f !== '0001_compat.sql').sort().map(f => 'migrations/' + f)])
  await pg.exec(fs.readFileSync(file, 'utf8'));
await pg.exec(`CREATE TABLE IF NOT EXISTS public.admin_users(id uuid DEFAULT gen_random_uuid(), email text, full_name text, role text, is_active boolean)`);

const principals: Record<string, { subject: string; email: string; isEmailVerified: boolean; aal: 'aal2'; mfaVerifiedAt: number }> = {};
const as = (token: string, subject: string, email: string, isEmailVerified = true) => { principals[token] = { subject, email, isEmailVerified, aal: 'aal2', mfaVerifiedAt: Date.now() / 1000 }; };
const app = express(); app.use(express.json());
registerAdminRoutes(app, async () => db, async (req: any) => principals[String(req.headers.authorization || '').replace('Bearer ', '')] ?? null);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const me = async (token: string) => { const r = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/me`, { headers: { authorization: 'Bearer ' + token } }); const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { throw new Error(`${token}: HTTP ${r.status} ${text.replace(/<[^>]+>/g, ' ').slice(0, 300)}`); } return { status: r.status, body }; };
const row = async (email: string) => (await db.query('SELECT role,is_active,sso_subject FROM internal.internal_users WHERE email=$1', [email])).rows[0];

try {
  // Unverified email never links, in any NODE_ENV.
  await db.query(`INSERT INTO internal.internal_users(id,email,full_name,role) VALUES($1,'new@test.invalid','New','ROLE_INTERNAL_SUPPORT')`, [randomUUID()]);
  as('unverified', 'sub-unverified', 'new@test.invalid', false);
  assert.equal((await me('unverified')).body.error, 'EMAIL_VERIFICATION_REQUIRED');
  assert.equal((await row('new@test.invalid')).sso_subject, null);

  // A verified first sign-in links an unbound row without changing its role.
  as('first', 'sub-first', 'new@test.invalid');
  assert.equal((await me('first')).status, 200);
  assert.deepEqual(await row('new@test.invalid'), { role: 'ROLE_INTERNAL_SUPPORT', is_active: true, sso_subject: 'sub-first' });

  // Another identity with the same email cannot take over an already bound admin.
  as('takeover', 'sub-attacker', 'new@test.invalid');
  assert.equal((await me('takeover')).status, 403);
  assert.equal((await row('new@test.invalid')).sso_subject, 'sub-first');

  // A disabled admin is not reactivated (nor promoted) by a legacy public.admin_users row.
  await db.query(`INSERT INTO internal.internal_users(id,email,full_name,role,is_active) VALUES($1,'off@test.invalid','Off','ROLE_INTERNAL_SUPPORT',false)`, [randomUUID()]);
  await db.query(`INSERT INTO public.admin_users(email,full_name,role,is_active) VALUES('off@test.invalid','Off','ROLE_SUPERADMIN',true)`);
  as('disabled', 'sub-disabled', 'off@test.invalid');
  assert.equal((await me('disabled')).status, 403);
  assert.deepEqual(await row('off@test.invalid'), { role: 'ROLE_INTERNAL_SUPPORT', is_active: false, sso_subject: null });

  // A brand-new legacy admin is imported once with its recorded role.
  await db.query(`INSERT INTO public.admin_users(email,full_name,role,is_active) VALUES('legacy@test.invalid','Legacy','ROLE_INTERNAL_GROWTH',true)`);
  as('legacy', 'sub-legacy', 'legacy@test.invalid');
  assert.equal((await me('legacy')).status, 200);
  assert.deepEqual(await row('legacy@test.invalid'), { role: 'ROLE_INTERNAL_GROWTH', is_active: true, sso_subject: 'sub-legacy' });
  console.log('PASS: admin linking requires verified email, never re-binds a linked admin, never reactivates or promotes, imports new legacy admins once');
} finally { server.close(); await pg.close(); }
