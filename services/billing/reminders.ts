import { randomUUID } from 'node:crypto';
import type { Db } from '../shared/db';

type Mail = { from: string; to: string; subject: string; text: string };
export interface ReminderDependencies {
  verifiedOwnerEmail(subject: string): Promise<string | null>;
  send(mail: Mail, idempotencyKey: string): Promise<string>;
}
export interface ReminderOptions {
  dryRun?: boolean;
  now?: Date;
  from?: string;
  appUrl?: string;
}

export async function runBillingReminders(db: Db, deps: ReminderDependencies, options: ReminderOptions = {}) {
  const now = options.now || new Date();
  const dryRun = options.dryRun !== false;
  const { rows } = await db.query(`SELECT s.id,s.current_period_end,s.status,s.revision,
    t.owner_user_ref,t.name AS merchant_name,p.name AS plan_name,
    CASE WHEN s.current_period_end <= $1::timestamptz+interval '1 day' THEN 'H1' ELSE 'H3' END AS kind
    FROM billing.subscriptions s JOIN billing.plans p ON p.id=s.plan_id
    JOIN internal.tenants t ON t.id=s.tenant_id
    WHERE t.is_active AND s.status IN ('ACTIVE','TRIAL','TRIALING')
    AND ((s.current_period_end > $1::timestamptz AND s.current_period_end <= $1::timestamptz+interval '1 day')
      OR (s.current_period_end > $1::timestamptz+interval '2 days' AND s.current_period_end <= $1::timestamptz+interval '3 days'))
    ORDER BY s.current_period_end,s.id LIMIT 1001`, [now.toISOString()]);
  if (rows.length > 1000) throw new Error('REMINDER_BATCH_TOO_LARGE');
  const result = { dryRun, candidates: rows.length, accepted: 0, skipped: 0, unverifiedOwners: 0, failed: 0, review: 0 };
  if (dryRun) return result; // No auth API, emails, or database writes.
  if (!options.from || !options.appUrl || new URL(options.appUrl).protocol !== 'https:') {
    throw new Error('REMINDER_SENDER_AND_HTTPS_APP_URL_REQUIRED');
  }
  for (const sub of rows) {
    try {
      const email = await deps.verifiedOwnerEmail(sub.owner_user_ref);
      if (!email) { result.skipped++; result.unverifiedOwners++; continue; }
      const end = new Date(sub.current_period_end).toISOString();
      const payload: Mail = {
        from: options.from, to: email,
        subject: `Pengingat masa aktif ${sub.kind === 'H3' ? 'H-3' : 'H-1'} New Hope POS`,
        // Plain text avoids injecting merchant-controlled HTML.
        text: `Halo ${sub.merchant_name},\n\nMasa aktif ${sub.plan_name} berakhir pada ${new Date(end).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.\nPeriksa langganan Anda di ${options.appUrl.replace(/\/$/, '')}/#settings.\n\nEmail ini adalah pengingat, bukan bukti pembayaran.\nTim New Hope POS`,
      };
      const claim = await db.tx(async c => {
        const inserted = await c.query(`INSERT INTO billing.reminder_deliveries
          (id,subscription_id,period_end,kind,state,payload,first_attempt_at,last_attempt_at)
          SELECT $1,s.id,$3,$4,'SENDING',$5::jsonb,$6,$6 FROM billing.subscriptions s
          JOIN internal.tenants t ON t.id=s.tenant_id
          WHERE s.id=$2 AND s.current_period_end=$3 AND s.revision=$7 AND t.is_active
          AND t.owner_user_ref=$8 AND s.status IN ('ACTIVE','TRIAL','TRIALING')
          ON CONFLICT(subscription_id,period_end,kind) DO NOTHING RETURNING *`,
        [randomUUID(),sub.id,end,sub.kind,JSON.stringify(payload),now.toISOString(),sub.revision,sub.owner_user_ref]);
        if (inserted.rows[0]) return inserted.rows[0];
        const existing = (await c.query(`SELECT * FROM billing.reminder_deliveries
          WHERE subscription_id=$1 AND period_end=$2 AND kind=$3 FOR UPDATE`, [sub.id,end,sub.kind])).rows[0];
        if (!existing || existing.state === 'SENT') return null;
        if (existing.state === 'REVIEW') { result.review++; return null; }
        if (existing.state === 'SENDING' && now.getTime()-Date.parse(existing.last_attempt_at) < 10*60_000) return null;
        // Provider keys last 24h: never retry an ambiguous send beyond 23h.
        if (now.getTime()-Date.parse(existing.first_attempt_at) >= 23*60*60_000 || existing.payload.to !== email) {
          await c.query("UPDATE billing.reminder_deliveries SET state='REVIEW',error_code='RETRY_WINDOW_OR_RECIPIENT_CHANGED' WHERE id=$1",[existing.id]);
          result.review++; return null;
        }
        const current = await c.query(`SELECT s.id FROM billing.subscriptions s JOIN internal.tenants t ON t.id=s.tenant_id
          WHERE s.id=$1 AND s.current_period_end=$2 AND s.revision=$3 AND s.status IN ('ACTIVE','TRIAL','TRIALING')
          AND t.is_active AND t.owner_user_ref=$4`,[sub.id,end,sub.revision,sub.owner_user_ref]);
        if (!current.rowCount) return null;
        await c.query("UPDATE billing.reminder_deliveries SET state='SENDING',last_attempt_at=$2 WHERE id=$1",[existing.id,now.toISOString()]);
        return existing; // Retry must use exactly the original payload.
      });
      if (!claim) { result.skipped++; continue; }
      try {
        const id = await deps.send(claim.payload, `billing-reminder/${claim.id}`);
        if (!id) throw new Error('MISSING_PROVIDER_ID');
        await db.query("UPDATE billing.reminder_deliveries SET state='SENT',provider_id=$2,error_code=NULL WHERE id=$1",[claim.id,id]);
        result.accepted++;
      } catch {
        // A lost response can mean accepted: retain payload/key for safe retries.
        await db.query("UPDATE billing.reminder_deliveries SET state='FAILED',error_code='DELIVERY_NOT_CONFIRMED' WHERE id=$1 AND state<>'SENT'",[claim.id]);
        result.failed++;
      }
    } catch { result.failed++; }
  }
  return result;
}
