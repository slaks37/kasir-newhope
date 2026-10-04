/**
 * Supabase Auth tiruan untuk PENGEMBANGAN LOKAL saja.
 *
 * Tanpa ini, `npm run dev` tanpa proyek Supabase hanya punya principal
 * `local-development` yang (dengan sengaja) ditolak oleh endpoint bisnis,
 * laporan dan keuangan — jadi aplikasi tidak bisa dipakai ujung ke ujung.
 *
 * Service ini menjawab subset GoTrue yang dipakai aplikasi (signup, login
 * password, refresh, user, logout) dengan JWT HS256, dan memprovisi akun lewat
 * trigger yang SAMA dengan produksi (docs/security/supabase-auth-signup.sql)
 * pada tabel auth.users lokal. Server memverifikasi token persis seperti di
 * produksi: GET /auth/v1/user.
 *
 * Penjagaan: menolak jalan saat NODE_ENV=production dan hanya listen di
 * 127.0.0.1. MFA admin (TOTP) tidak didukung.
 */
import '../shared/env';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pastikanPaket } from '../billing/store';
import { SAAS_PLANS } from '../../src/config/saasPlans';

if (process.env.NODE_ENV === 'production') {
  console.error('[dev-auth] menolak berjalan saat NODE_ENV=production.');
  process.exit(1);
}

const PORT = Number(process.env.DEV_AUTH_PORT || 54321);
const DATA_DIR = path.resolve(process.cwd(), process.env.PGLITE_DIR || '.pgdata');
const SECRET_FILE = path.join(DATA_DIR, '..', '.dev-auth-secret');
const SECRET = (() => {
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch { /* dibuat di bawah */ }
  const created = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, created, { mode: 0o600 }); } catch { /* sesi hanya berlaku sampai restart */ }
  return created;
})();
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/postgres', max: 2 });
db.on('error', error => console.error('[dev-auth] pool:', error.message));
const refreshTokens = new Map<string, string>();

async function bootstrap() {
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      encrypted_password text NOT NULL,
      email_confirmed_at timestamptz,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE SCHEMA IF NOT EXISTS extensions;
    -- PGlite tidak membawa pgcrypto. Pengganti KHUSUS DEV untuk PIN acak trigger.
    CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea
      LANGUAGE sql AS $f$ SELECT decode(string_agg(lpad(to_hex(floor(random()*256)::int),2,'0'),''),'hex') FROM generate_series(1,$1) $f$;
    DROP TRIGGER IF EXISTS provision_verified_auth_business ON auth.users;`);
  // Trigger signup menulis langganan trial; katalog paket harus sudah ada.
  await pastikanPaket({ query: async (sql: string, params?: unknown[]) => { const r = await db.query(sql, params as any[]); return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length }; } } as any, SAAS_PLANS);
  const triggerSql = fs.readFileSync(path.resolve(process.cwd(), 'docs/security/supabase-auth-signup.sql'), 'utf8');
  await db.query(triggerSql);
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function sign(user: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({
    sub: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600,
    aal: 'aal1', amr: [{ method: 'password', timestamp: now }], session_id: crypto.randomUUID(), user_metadata: user.raw_user_meta_data,
  });
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(token: string): string | null {
  const [header, payload, signature] = token.split('.');
  if (!signature) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(header + '.' + payload).digest('base64url');
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return claims.exp > Date.now() / 1000 ? String(claims.sub) : null;
}
const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) =>
  `scrypt$${salt}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
function passwordMatches(password: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  const candidate = crypto.scryptSync(password, salt, 32);
  return candidate.length === Buffer.from(hash, 'hex').length && crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

interface UserRow { id: string; email: string; email_confirmed_at: string; raw_user_meta_data: Record<string, unknown>; created_at: string; encrypted_password: string }
const userJson = (u: UserRow) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at,
  confirmed_at: u.email_confirmed_at, user_metadata: u.raw_user_meta_data, app_metadata: { provider: 'email', providers: ['email'] },
  created_at: u.created_at, updated_at: u.created_at, identities: [],
});
function session(user: UserRow) {
  const refresh = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh, user.id);
  return { access_token: sign(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refresh, user: userJson(user) };
}
const byEmail = async (email: string) => (await db.query<UserRow>('SELECT * FROM auth.users WHERE email=$1', [email.toLowerCase()])).rows[0];
const byId = async (id: string) => (await db.query<UserRow>('SELECT * FROM auth.users WHERE id=$1', [id])).rows[0];
const authError = (status: number, code: string, msg: string) => ({ status, body: { code: status, error_code: code, msg, error: code, error_description: msg } });

async function handle(method: string, url: URL, headers: http.IncomingHttpHeaders, body: any): Promise<{ status: number; body?: unknown }> {
  const bearer = String(headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (url.pathname === '/auth/v1/settings') return { status: 200, body: { external: { email: true }, mailer_autoconfirm: true } };
  if (url.pathname === '/auth/v1/signup' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || password.length < 8) return authError(422, 'validation_failed', 'Email/kata sandi tidak valid (min. 8 karakter).');
    if (await byEmail(email)) return authError(422, 'user_already_exists', 'User already registered');
    const meta = body.data || body.options?.data || {};
    // email_confirmed_at terisi → trigger produksi memprovisi tenant/merchant/outlet/langganan.
    await db.query(`INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,$3,now(),$4::jsonb)`,
      [crypto.randomUUID(), email, hashPassword(password), JSON.stringify(meta)]);
    return { status: 200, body: session((await byEmail(email))!) };
  }
  if (url.pathname === '/auth/v1/token' && method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const user = await byEmail(String(body.email || ''));
      if (!user || !passwordMatches(String(body.password || ''), user.encrypted_password)) return authError(400, 'invalid_credentials', 'Invalid login credentials');
      return { status: 200, body: session(user) };
    }
    if (grant === 'refresh_token') {
      const id = refreshTokens.get(String(body.refresh_token || ''));
      refreshTokens.delete(String(body.refresh_token || ''));
      const user = id ? await byId(id) : undefined;
      return user ? { status: 200, body: session(user) } : authError(400, 'refresh_token_not_found', 'Invalid Refresh Token');
    }
  }
  if (url.pathname === '/auth/v1/user') {
    const id = verify(bearer);
    const user = id ? await byId(id) : undefined;
    if (!user) return authError(401, 'bad_jwt', 'invalid JWT');
    if (method === 'PUT' && typeof body.password === 'string') {
      if (body.password.length < 8) return authError(422, 'weak_password', 'Password should be at least 8 characters.');
      await db.query('UPDATE auth.users SET encrypted_password=$2 WHERE id=$1', [user.id, hashPassword(body.password)]);
    }
    return { status: 200, body: userJson(user) };
  }
  if (url.pathname === '/auth/v1/logout') return { status: 204 };
  return authError(404, 'not_supported_locally', `dev-auth tidak mendukung ${method} ${url.pathname}`);
}

await bootstrap();
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-supabase-api-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 65_536) { res.writeHead(413); res.end(); return; } }
  try {
    const out = await handle(req.method || 'GET', new URL(req.url || '/', 'http://127.0.0.1'), req.headers, raw ? JSON.parse(raw) : {});
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(out.body === undefined ? '' : JSON.stringify(out.body));
  } catch (error) {
    console.error('[dev-auth]', (error as Error).message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 500, msg: 'dev-auth error' }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[dev-auth] Supabase Auth lokal di http://127.0.0.1:${PORT} (khusus pengembangan)`));
