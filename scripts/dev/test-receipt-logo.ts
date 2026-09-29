import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { registerSyncRoutes } from '../../services/pos/sync';
import type { Db } from '../../services/shared/db';

const logos = new Map<string, string | null>([['owner_FNB', null], ['other_FNB', null]]);
const owners = new Map([['owner_FNB', 'owner'], ['other_FNB', 'other']]);
const db = {
  async query(sql: string, params: unknown[] = []) {
    if (sql.includes('SELECT 1') && sql.includes('internal.merchants')) {
      return { rows: owners.get(String(params[0])) === params[1] ? [{ '?column?': 1 }] : [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT logo_url')) {
      const id = String(params[0]);
      return { rows: logos.has(id) ? [{ logo_url: logos.get(id) }] : [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE internal.merchants SET logo_url')) {
      const id = String(params[1]);
      if (logos.has(id)) logos.set(id, params[0] as string | null);
      return { rows: logos.has(id) ? [{ id }] : [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
} as Db;

const app = express();
app.use(express.json());
registerSyncRoutes(app, db);
const server = app.listen(0, '127.0.0.1');
try {
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_PORT');
  const base = `http://127.0.0.1:${address.port}/api/v1/sync/receipt-logo`;
  const call = async (subject: string, method: 'GET' | 'PUT', businessId: string, logoUrl?: string | null) => {
    const response = await fetch(method === 'GET' ? `${base}?businessId=${businessId}` : base, {
      method,
      headers: { 'x-auth-sub': subject, 'content-type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ businessId, logoUrl }) : undefined,
    });
    return { status: response.status, data: await response.json() };
  };
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal((await call('owner', 'PUT', 'owner_FNB', png)).status, 200);
  assert.equal((await call('owner', 'GET', 'owner_FNB')).data.logoUrl, png);
  assert.equal((await call('other', 'GET', 'owner_FNB')).status, 403);
  assert.equal((await call('other', 'PUT', 'owner_FNB', null)).status, 403);
  assert.equal((await call('owner', 'PUT', 'owner_FNB', 'data:image/svg+xml;base64,PHN2Zz4=')).status, 400);
  assert.equal((await call('owner', 'GET', 'owner_FNB')).data.logoUrl, png);
  assert.equal((await call('owner', 'PUT', 'owner_FNB', null)).status, 200);
  assert.equal((await call('owner', 'GET', 'owner_FNB')).data.logoUrl, null);
  console.log('Receipt logo ownership and save/load/delete: OK');
} finally {
  server.close();
}
