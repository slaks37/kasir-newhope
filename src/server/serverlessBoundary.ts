import express from 'express';
import { AuthUnavailableError, authenticateBearer, type AuthPrincipal } from '../../services/shared/auth';
import type { Db } from '../../services/shared/db';
import { normalizeVercelUrl } from './vercelUrl';

/**
 * Header identitas yang hanya boleh diisi oleh boundary ini atau gateway.
 * Satu daftar untuk semua entry agar tidak ada entry yang lupa menghapus
 * salah satunya.
 */
export const TRUSTED_IDENTITY_HEADERS = [
  'x-auth-source-created-at', 'x-auth-sub', 'x-auth-email', 'x-auth-email-verified', 'x-internal-user', 'x-env-override', 'x-newhope-gateway-token',
] as const;

export function stripIdentityHeaders(req: { headers: Record<string, unknown> }): void {
  for (const key of TRUSTED_IDENTITY_HEADERS) delete req.headers[key];
}

export function applyPrincipal(req: { headers: Record<string, unknown> }, principal: AuthPrincipal): void {
  stripIdentityHeaders(req);
  req.headers['x-auth-sub'] = principal.subject;
  if (principal.sourceCreatedAt) req.headers['x-auth-source-created-at'] = principal.sourceCreatedAt;
  if (principal.email) req.headers['x-auth-email'] = principal.email;
  if (principal.isEmailVerified) req.headers['x-auth-email-verified'] = 'true';
}

const MAX_RAW_BODY = 1_048_576;

/** Ambil byte asli body. Signature webhook dihitung dari byte ini, bukan dari JSON hasil parse. */
async function readRawBody(req: any): Promise<Buffer | null> {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  if (req.readableEnded || typeof req[Symbol.asyncIterator] !== 'function') return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_RAW_BODY) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 });
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function setParsedBody(req: any, raw: Buffer): void {
  let parsed: unknown = {};
  try { parsed = JSON.parse(raw.toString('utf8') || '{}'); } catch { parsed = {}; }
  req.rawBody = raw;
  try { Object.defineProperty(req, 'body', { value: parsed, writable: true, configurable: true, enumerable: true }); }
  catch { req.body = parsed; }
}

export interface ServerlessBoundaryOptions {
  /** Prefix log dan kode error, mis. 'billing'. */
  name: string;
  /** Path persis → method yang diizinkan. Path lain 404. */
  routes: Record<string, readonly string[]>;
  /** Path yang boleh diakses tanpa sesi (mis. katalog paket, webhook bertanda tangan). */
  publicRoutes?: readonly string[];
  /** Path yang wajib membawa byte body asli (webhook). */
  rawBodyRoutes?: readonly string[];
  bodyLimit: string;
  register: (app: express.Express, db: Db) => void;
  unavailableError: string;
  invalidRequestError: string;
}

/**
 * Entry Vercel untuk satu domain service. Urutannya tetap:
 * normalisasi URL → allowlist path/method → autentikasi → hapus header palsu →
 * baru menyentuh database. Request anonim tidak pernah membuka koneksi DB.
 */
export function createServerlessBoundary(
  options: ServerlessBoundaryOptions,
  authenticate: (req: any) => Promise<AuthPrincipal | null> = authenticateBearer,
  connect: () => Promise<Db>,
) {
  const publicRoutes = new Set(options.publicRoutes ?? []);
  const rawBodyRoutes = new Set(options.rawBodyRoutes ?? []);
  let runtime: Promise<express.Express> | undefined;
  return async (req: any, res: any) => {
    normalizeVercelUrl(req);
    res.setHeader('Cache-Control', 'no-store');
    const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
    if (!Object.hasOwn(options.routes, path)) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    if (!options.routes[path].includes(req.method)) return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

    if (publicRoutes.has(path)) {
      stripIdentityHeaders(req);
    } else {
      let principal: AuthPrincipal | null = null;
      try { principal = await authenticate(req); } catch (error) {
        if (error instanceof AuthUnavailableError) {
          res.setHeader('Retry-After', '2');
          return res.status(503).json({ ok: false, error: 'AUTH_UNAVAILABLE' });
        }
        principal = null;
      }
      if (!principal || principal.subject === 'local-development') {
        return res.status(401).json({ ok: false, error: 'AUTHENTICATION_REQUIRED' });
      }
      applyPrincipal(req, principal);
    }

    if (rawBodyRoutes.has(path) && req.method === 'POST') {
      try {
        const raw = await readRawBody(req);
        if (!raw) return res.status(400).json({ ok: false, error: 'RAW_BODY_REQUIRED' });
        setParsedBody(req, raw);
      } catch (error) {
        return res.status((error as { status?: number }).status === 413 ? 413 : 400).json({ ok: false, error: 'INVALID_REQUEST_BODY' });
      }
    }

    try {
      runtime ??= connect().then(db => {
        const app = express();
        const parse = express.json({ limit: options.bodyLimit });
        // Vercel bisa sudah mem-parse body; stream yang sudah terbaca tidak dibaca ulang.
        app.use((request, response, next) => request.body !== undefined ? next() : parse(request, response, next));
        options.register(app, db);
        app.use((_request, response) => response.status(404).json({ ok: false, error: 'NOT_FOUND' }));
        app.use((error: any, _request: any, response: any, _next: any) =>
          response.status(error?.type === 'entity.too.large' ? 413 : 400).json({ ok: false, error: options.invalidRequestError }));
        return app;
      }).catch(error => { runtime = undefined; throw error; });
      (await runtime)(req, res);
    } catch (error) {
      const diagnostic = error as { name?: string; code?: string; cause?: { code?: string }; stack?: string };
      console.error(`[${options.name}] runtime unavailable`, { name: diagnostic.name, code: diagnostic.code || diagnostic.cause?.code, frames: diagnostic.stack?.split('\n').slice(1, 4) });
      return res.status(503).json({ ok: false, error: options.unavailableError });
    }
  };
}
