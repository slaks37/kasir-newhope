/**
 * Step-Up Authorization (PIN Manager) — sisi server.
 *
 * Sebelumnya seluruh pemeriksaan ini berjalan di browser: PIN dibandingkan
 * terhadap daftar user di localStorage, dan penghitung percobaan gagal juga
 * disimpan di localStorage. Keduanya bisa diubah dari DevTools, jadi VOID
 * transaksi, ubah harga, dan bill House Use praktis tidak terjaga.
 *
 * Di sini tiga hal dipindahkan ke tempat yang tidak bisa disentuh kasir:
 *
 *   1. HASH tidak pernah dikirim ke browser. Perbandingannya terjadi di sini.
 *   2. PENGHITUNG KEGAGALAN ada di pos.pin_attempts, berkunci pada subject sesi
 *      yang sudah diverifikasi gateway — bukan pada sesuatu yang dipilih
 *      browser. Membersihkan localStorage tidak menghapusnya.
 *   3. KEPEMILIKAN diperiksa: businessId wajib benar-benar milik pemanggil
 *      (canAccessBusiness), bukan sekadar id yang ditebak.
 *
 * Jawaban ke klien sengaja miskin informasi: berhasil atau tidak, sisa
 * percobaan, dan sisa detik lockout. Tidak ada daftar staf, tidak ada petunjuk
 * PIN siapa yang hampir benar.
 */

import type express from 'express';
import type { Db } from '../shared/db';
import { canAccessBusiness, trustedPrincipal } from '../shared/auth';
import { hashPin, verifyPin } from '../shared/pinKdf';

/** Sama dengan perilaku lama di browser, supaya kasir tidak merasakan bedanya. */
const MAX_ATTEMPTS = 3;
const LOCKOUT_TIERS_SEC = [30, 60, 300];

/**
 * Peran di UI kasir (ADMIN/MANAGER/CASHIER) vs peran di bidang identitas
 * (OWNER/MANAGER/CASHIER/…). Dipetakan di satu tempat supaya tidak ada layar
 * yang diam-diam memakai ejaan lain.
 */
const ROLE_ALIASES: Record<string, string[]> = {
  ADMIN: ['OWNER', 'ADMIN'],
  OWNER: ['OWNER', 'ADMIN'],
  MANAGER: ['MANAGER'],
  CASHIER: ['CASHIER'],
  STAFF: ['STAFF'],
};

function expandRoles(requested: unknown): string[] {
  const list = Array.isArray(requested) ? requested : [];
  const out = new Set<string>();
  for (const raw of list) {
    const key = String(raw || '').trim().toUpperCase();
    if (!key) continue;
    for (const alias of ROLE_ALIASES[key] || [key]) out.add(alias);
  }
  return [...out];
}

interface AttemptState {
  id: string | null;
  consecutiveFailures: number;
  lockoutCount: number;
  lockedUntil: Date | null;
}

async function readAttemptState(db: Db, merchantId: string, terminalKey: string): Promise<AttemptState> {
  const { rows } = await db.query(
    `SELECT id, consecutive_failures, lockout_count, locked_until
       FROM pos.pin_attempts
      WHERE merchant_id = $1 AND terminal_key = $2`,
    [merchantId, terminalKey]
  );
  if (!rows.length) return { id: null, consecutiveFailures: 0, lockoutCount: 0, lockedUntil: null };
  return {
    id: rows[0].id,
    consecutiveFailures: Number(rows[0].consecutive_failures) || 0,
    lockoutCount: Number(rows[0].lockout_count) || 0,
    lockedUntil: rows[0].locked_until ? new Date(rows[0].locked_until) : null,
  };
}

export function registerPinRoutes(app: express.Express, db: Db): void {
  /**
   * POST /api/v1/pos/verify-pin
   *
   * { businessId, pin, requiredRoles?: ['ADMIN','MANAGER'] }
   *   -> 200 { ok: true,  authorizedBy: { name, role } }
   *   -> 200 { ok: false, attemptsLeft }
   *   -> 423 { ok: false, lockedOut: true, remainingSec }
   */
  app.post('/api/v1/pos/verify-pin', async (req, res) => {
    const principal = trustedPrincipal(req);
    if (!principal) return res.status(401).json({ ok: false, error: 'UNAUTHENTICATED' });

    const body = req.body ?? {};
    const businessId = String(body.businessId || '').trim();
    const pin = String(body.pin || '').trim();
    if (!businessId || !pin) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', detail: 'businessId dan pin wajib diisi.' });
    }

    // Unit usaha wajib milik pemanggil. Tanpa ini, siapa pun yang punya sesi
    // bisa menebak PIN manager toko orang lain.
    if (!(await canAccessBusiness(db, principal, businessId))) {
      return res.status(403).json({ ok: false, error: 'BUSINESS_NOT_OWNED' });
    }

    const merchant = await db.query(
      `SELECT id, tenant_id FROM internal.merchants WHERE external_ref = $1 LIMIT 1`,
      [businessId]
    );
    if (!merchant.rows.length) return res.status(404).json({ ok: false, error: 'BUSINESS_NOT_FOUND' });

    const merchantId: string = merchant.rows[0].id;
    const tenantId: string = merchant.rows[0].tenant_id;
    const terminalKey = principal.subject.slice(0, 200);
    const now = new Date();

    const state = await readAttemptState(db, merchantId, terminalKey);
    if (state.lockedUntil && state.lockedUntil > now) {
      const remainingSec = Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000);
      return res.status(423).json({ ok: false, lockedOut: true, remainingSec, attemptsLeft: 0 });
    }

    const roles = expandRoles(body.requiredRoles);
    const candidates = await db.query(
      `SELECT ms.id, ms.role, ms.pin, ms.pin_hash, u.full_name
         FROM internal.memberships ms
         JOIN internal.users u ON u.id = ms.user_id
        WHERE ms.is_active
          AND (ms.merchant_id = $1 OR (ms.merchant_id IS NULL AND ms.tenant_id = $2))
          AND ($3::text[] IS NULL OR array_length($3::text[], 1) IS NULL OR ms.role = ANY($3::text[]))`,
      [merchantId, tenantId, roles.length ? roles : null]
    );

    let matched: { id: string; role: string; fullName: string; needsRehash: boolean } | null = null;
    for (const row of candidates.rows) {
      // pin_hash didahulukan; kolom `pin` teks polos hanya jalur warisan.
      const stored = row.pin_hash || row.pin;
      const result = await verifyPin(pin, stored);
      if (result.ok) {
        matched = {
          id: row.id,
          role: row.role,
          fullName: row.full_name,
          needsRehash: result.needsRehash || !row.pin_hash,
        };
        break;
      }
    }

    if (!matched) {
      const failures = state.consecutiveFailures + 1;
      const willLock = failures >= MAX_ATTEMPTS;
      const tier = Math.min(state.lockoutCount, LOCKOUT_TIERS_SEC.length - 1);
      const lockSec = LOCKOUT_TIERS_SEC[tier];
      const lockedUntil = willLock ? new Date(now.getTime() + lockSec * 1000) : null;

      await db.query(
        `INSERT INTO pos.pin_attempts
           (tenant_id, merchant_id, terminal_key, consecutive_failures, lockout_count,
            locked_until, last_failure_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (merchant_id, terminal_key) DO UPDATE
            SET consecutive_failures = EXCLUDED.consecutive_failures,
                lockout_count        = EXCLUDED.lockout_count,
                locked_until         = EXCLUDED.locked_until,
                last_failure_at      = CURRENT_TIMESTAMP,
                updated_at           = CURRENT_TIMESTAMP`,
        [
          tenantId,
          merchantId,
          terminalKey,
          willLock ? 0 : failures,
          willLock ? state.lockoutCount + 1 : state.lockoutCount,
          lockedUntil,
        ]
      );

      if (willLock) {
        return res.status(423).json({ ok: false, lockedOut: true, remainingSec: lockSec, attemptsLeft: 0 });
      }
      return res.json({ ok: false, lockedOut: false, attemptsLeft: MAX_ATTEMPTS - failures });
    }

    // Berhasil: bersihkan penghitung, termasuk lockout_count — supaya tangga
    // hukumannya tidak terus menanjak seumur hidup terminal.
    await db.query(
      `INSERT INTO pos.pin_attempts
         (tenant_id, merchant_id, terminal_key, consecutive_failures, lockout_count,
          locked_until, last_success_at, updated_at)
       VALUES ($1, $2, $3, 0, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (merchant_id, terminal_key) DO UPDATE
          SET consecutive_failures = 0,
              lockout_count        = 0,
              locked_until         = NULL,
              last_success_at      = CURRENT_TIMESTAMP,
              updated_at           = CURRENT_TIMESTAMP`,
      [tenantId, merchantId, terminalKey]
    );

    /*
     * Naik kelas ke PBKDF2 saat verifikasi berhasil.
     *
     * Inilah satu-satunya momen PIN polos tersedia di server, jadi inilah satu-
     * satunya kesempatan menghitung hash-nya. Kegagalan di sini tidak boleh
     * membatalkan otorisasi yang sudah sah — paling buruk, upgradenya terjadi
     * pada percobaan berikutnya.
     */
    if (matched.needsRehash) {
      try {
        const fresh = await hashPin(pin);
        await db.query(
          `UPDATE internal.memberships
              SET pin_hash = $2, pin = '', pin_updated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [matched.id, fresh]
        );
      } catch (err) {
        console.error('[pin] gagal memutakhirkan hash PIN:', (err as Error).message);
      }
    }

    res.json({
      ok: true,
      authorizedBy: { name: matched.fullName, role: matched.role },
      attemptsLeft: MAX_ATTEMPTS,
    });
  });
}
