/**
 * Penulisan jejak aktivitas merchant.
 *
 * Dimiliki pos-service. `merchant_activity_log` ada di skema `pos`, dan hanya
 * peran svc_pos yang boleh menulisnya — service lain ditolak Postgres, bukan
 * sekadar ditegur saat code review.
 *
 * Fungsi ini sebelumnya tinggal di src/server/repo.ts bersama query admin panel.
 * Setelah pemecahan skema, tempat itu menjadi salah: repo.ts dimiliki
 * backoffice-service, yang perannya tidak punya hak tulis ke pos sama sekali.
 */

import type { Db } from '../shared/db';

export const SECTORS = ['FNB', 'LAUNDRY', 'RETAIL', 'CARWASH', 'BARBERSHOP'] as const;
export type Sector = (typeof SECTORS)[number];

export const APP_MODULES = [
  'POS', 'TABLES', 'INVENTORY', 'CUSTOMERS', 'REPORTS', 'AI', 'SETTINGS', 'SYNC', 'AUTH',
] as const;

export const SEVERITIES = ['INFO', 'NOTICE', 'WARNING', 'CRITICAL'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pick<T extends string>(allowed: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

export interface ActivityInput {
  /**
   * pos.businesses.id. Dulu ada `tenantId` terpisah di sini yang selalu diisi
   * nilai yang sama; kolomnya dibuang di migrasi 0019, dan medannya ikut —
   * dua nama untuk satu hal hanya menunggu keduanya berbeda.
   */
  merchantId: string;
  businessSector: string;
  businessId?: string | null;
  appModule: string;
  eventType: string;
  severity?: string;
  actorUserId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  transactionId?: string | null;
  amountIdr?: number | null;
  summary: string;
  detail?: Record<string, unknown>;
  occurredAt?: string | null;
}

export async function writeActivity(db: Db, a: ActivityInput): Promise<string | null> {
  const sector = pick(SECTORS, a.businessSector);
  const mod = pick(APP_MODULES, a.appModule);
  if (!sector || !mod || !UUID_RE.test(a.merchantId)) return null;

  const { rows } = await db.query(
    `INSERT INTO pos.merchant_activity_log
       (business_id, business_sector, client_key, app_module,
        event_type, severity, actor_user_id, actor_name, actor_role,
        transaction_id, amount_idr, summary, detail, occurred_at)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8, $9,
             $10::uuid, $11, $12, $13::jsonb, COALESCE($14::timestamptz, CURRENT_TIMESTAMP))
     RETURNING id`,
    [
      a.merchantId,
      sector,
      a.businessId ?? null,
      mod,
      a.eventType.slice(0, 48),
      pick(SEVERITIES, a.severity) ?? 'INFO',
      a.actorUserId && UUID_RE.test(a.actorUserId) ? a.actorUserId : null,
      a.actorName ?? null,
      a.actorRole ?? null,
      a.transactionId && UUID_RE.test(a.transactionId) ? a.transactionId : null,
      a.amountIdr ?? null,
      a.summary.slice(0, 240),
      JSON.stringify(a.detail ?? {}),
      a.occurredAt ?? null,
    ]
  );
  return rows[0]?.id ?? null;
}
