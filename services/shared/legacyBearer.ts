import type {Request} from 'express';
import {AuthUnavailableError, type AuthPrincipal} from './auth';
const LOCAL_BYPASS = () => process.env.NODE_ENV !== 'production' && process.env.AUTH_ALLOW_LOCAL_DEVELOPMENT === '1';
const firstHeader=(value:string|string[]|undefined)=>Array.isArray(value)?String(value[0]||''):String(value||'');
function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  return { url, apiKey };
}

export async function authenticateLegacyBearer(req:Request):Promise<AuthPrincipal|null>{
  const authorization = firstHeader(req.headers.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(authorization);

  if (!match) {
    return LOCAL_BYPASS() ? { subject: 'local-development', isEmailVerified: true } : null;
  }

  const { url, apiKey } = supabaseConfig();
  if (!url || !apiKey) {
    return LOCAL_BYPASS() ? { subject: 'local-development', isEmailVerified: true } : null;
  }

  let upstream: Awaited<ReturnType<typeof fetch>>;
  try {
    upstream = await fetch(`${url}/auth/v1/user`, {
      headers: { authorization: `Bearer ${match[1]}`, apikey: apiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AuthUnavailableError();
  }
  if (upstream.status >= 500 || upstream.status === 429) throw new AuthUnavailableError();
  if (!upstream.ok) return null;

  try {
    const user = (await upstream.json()) as {
      id?: unknown;
      email?: unknown;
      email_confirmed_at?: unknown;
      confirmed_at?: unknown;
    };
    if (typeof user.id !== 'string' || !user.id) return null;
    const isEmailVerified = Boolean(user.email_confirmed_at || user.confirmed_at);
    // Decode ONLY after Auth has verified this exact bearer token. Never trust
    // browser headers, user_metadata, or token_refresh as proof of recent MFA.
    const claims = JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub !== user.id || !Number.isFinite(claims.exp) || claims.exp <= Date.now()/1000) return null;
    const times = Array.isArray(claims.amr) ? claims.amr.filter((a:any)=>a.method==='totp' &&
      Number.isFinite(a.timestamp) && a.timestamp<=Date.now()/1000+30).map((a:any)=>a.timestamp) : [];
    return {
      subject: user.id,
      email: typeof user.email === 'string' ? user.email : undefined,
      isEmailVerified,
      aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
      mfaVerifiedAt: times.length ? Math.max(...times) : undefined,
    };
  } catch {
    return null;
  }
}
