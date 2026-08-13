/**
 * ID GENERATION
 * =============
 *
 * Every id in this app used to be `${prefix}-${Date.now()}`. On an offline-first
 * POS that is a correctness bug, not a style issue: two terminals working
 * offline in the same millisecond mint the SAME id, and on sync one silently
 * overwrites the other's row.
 *
 * `crypto.randomUUID()` is available in every browser this POS targets and in
 * Node 19+. The fallback below is only for exotic embedded webviews without it.
 *
 * See migrations/0005_uuid_keys.sql for the database half of this decision.
 */

function fallbackUuid(): string {
  // RFC 4122 v4 shape, built from the best entropy available.
  const bytes = new Uint8Array(16);
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.getRandomValues === 'function') {
    g.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A globally unique identifier. Safe to generate offline on many devices. */
export function newUuid(): string {
  const g = (globalThis as { crypto?: Crypto }).crypto;
  if (g && typeof g.randomUUID === 'function') return g.randomUUID();
  return fallbackUuid();
}

/**
 * Prefixed id, e.g. `newId('stf')` -> 'stf-3f2a…'.
 *
 * The prefix is kept purely so ids stay recognisable in logs and support
 * tickets; uniqueness comes entirely from the UUID. `legacy_uuid()` in the
 * migration maps these to real UUIDs deterministically on the server side.
 */
export function newId(prefix?: string): string {
  const uuid = newUuid();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

/**
 * Human-facing document number, e.g. INV-20260812-8F2A.
 *
 * Deliberately NOT a primary key — see THE RULE in 0005. Sequence-free so it
 * cannot collide offline, and it no longer leaks daily transaction volume the
 * way `INV-20260811-0004` did.
 */
export function newDocumentNumber(prefix = 'INV', now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = newUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
  return `${prefix}-${y}${m}${d}-${suffix}`;
}
