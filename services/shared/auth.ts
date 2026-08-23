/**
 * Boundary keamanan untuk seluruh API merchant.
 *
 * Browser membuktikan sesi ke gateway; gateway meneruskan principal yang sudah
 * diverifikasi ke service dengan shared secret. Service tidak pernah percaya
 * `merchantId`, `tenantId`, atau header principal yang dikirim langsung klien.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';

export interface AuthPrincipal {
  subject: string;
  email?: string;
}

const LOCAL_BYPASS = () => process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1';

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  return { url, apiKey };
}

/** Verifikasi token ke Auth API; payload JWT yang belum diverifikasi tidak dipakai. */
export async function authenticateBearer(req: Request): Promise<AuthPrincipal | null> {
  const authorization = firstHeader(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match) {
    return LOCAL_BYPASS() ? { subject: 'local-development' } : null;
  }

  const { url, apiKey } = supabaseConfig();
  if (!url || !apiKey) return null;

  try {
    const upstream = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${match[1]}`, apikey: apiKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (!upstream.ok) return null;
    const user = (await upstream.json()) as { id?: unknown; email?: unknown };
    if (typeof user.id !== 'string' || !user.id) return null;
    return { subject: user.id, email: typeof user.email === 'string' ? user.email : undefined };
  } catch {
    return null;
  }
}

/** Dipasang di gateway sebelum proxying semua route yang membutuhkan sesi. */
export async function requireGatewayAuthentication(req: Request, res: Response, next: NextFunction) {
  const principal = await authenticateBearer(req);
  if (!principal) {
    return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });
  }
  res.locals.principal = principal;
  next();
}

/**
 * Dipasang di setiap microservice. Tanpa token ini request langsung ke port
 * service ditolak, sehingga header x-auth-sub tidak bisa dipalsukan.
 */
export function requireTrustedGateway(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.INTERNAL_GATEWAY_TOKEN;
  const received = firstHeader(req.headers['x-newhope-gateway-token']);
  if (configured && received === configured) return next();
  if (LOCAL_BYPASS()) return next();
  return res.status(401).json({ ok: false, error: 'UNTRUSTED_GATEWAY' });
}

export function trustedPrincipal(req: Request): AuthPrincipal | null {
  const subject = firstHeader(req.headers['x-auth-sub']);
  if (subject) return { subject, email: firstHeader(req.headers['x-auth-email']) || undefined };
  return LOCAL_BYPASS() ? { subject: 'local-development' } : null;
}

/** Memastikan unit usaha milik principal, bukan hanya ID yang ditebak klien. */
export async function canAccessBusiness(db: Db, principal: AuthPrincipal, businessId: string): Promise<boolean> {
  if (principal.subject === 'local-development') return true;
  const { rows } = await db.query(
    `SELECT 1
       FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE m.external_ref = $1 AND t.owner_user_ref = $2
      LIMIT 1`,
    [businessId, principal.subject]
  );
  return rows.length === 1;
}

/** Tenant level check untuk billing dan endpoint yang tidak membawa businessId. */
export async function tenantForPrincipal(db: Db, principal: AuthPrincipal): Promise<string | null> {
  if (principal.subject === 'local-development') return null;
  const { rows } = await db.query(
    `SELECT id FROM internal.tenants WHERE owner_user_ref = $1 ORDER BY created_at ASC LIMIT 1`,
    [principal.subject]
  );
  return rows[0]?.id ?? null;
}
