import { createHash, randomUUID } from "node:crypto";
import type { Db } from "../../../services/shared/db";
import { GROWTH_WORKSPACE as W, inWorkspace } from "./db";
import { recordEvent, fail } from "./service";
export const CONSENT_VERSION = "growth-product-analytics-v1";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function ownedTenant(db: Db, subject: string, tenant: string) {
  const r = await db.query(
    `SELECT id FROM internal.tenants WHERE id=$1 AND owner_user_ref=$2 AND is_active AND merged_into IS NULL`,
    [tenant, subject],
  );
  if (r.rows.length !== 1) fail("VERIFIED_TENANT_OWNER_REQUIRED", 403);
}
/** At-least-once delivery; durable source leases survive process death. A target
 * commit followed by ACK failure is safely replayed using the exact payload hash. */
export async function drainOutbox(source: Db, target: Db, limit = 100) {
  const cfg = (
    await source.query("SELECT * FROM growth_source.config WHERE singleton")
  ).rows[0];
  if (!cfg?.enabled) return { processed: 0, failed: 0, disabled: true };
  const lease = randomUUID();
  const batch = await source.tx((c) =>
    c.query(
      `WITH pick AS(SELECT id FROM growth_source.outbox WHERE delivered_at IS NULL AND dead_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY seq LIMIT $1 FOR UPDATE SKIP LOCKED) UPDATE growth_source.outbox o SET lease_id=$2,lease_until=now()+interval '60 seconds',attempts=attempts+1 FROM pick WHERE o.id=pick.id RETURNING o.*`,
      [Math.min(500, Math.max(1, limit)), lease],
    ),
  );
  const started = Date.now();
  let processed = 0,
    failed = 0;
  for (const r of batch.rows.sort((a, b) => Number(a.seq) - Number(b.seq))) {
    if (Date.now() - started > 20000) break;
    try {
      await inWorkspace(target, async (c) => {
        const fingerprint = hash(
          JSON.stringify({
            source: r.source_id,
            tenant: r.tenant_ref,
            subject: r.subject_ref,
            kind: r.kind,
            payload: r.payload,
            data: r.data_class,
            time: new Date(r.occurred_at).toISOString(),
          }),
        );
        const inserted = await c.query(
          "INSERT INTO growth.receipts(workspace_id,source_event_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING source_event_id",
          [W, r.id, fingerprint],
        );
        if (!inserted.rowCount) {
          const old = (
            await c.query(
              "SELECT payload_hash FROM growth.receipts WHERE workspace_id=$1 AND source_event_id=$2",
              [W, r.id],
            )
          ).rows[0];
          if (old.payload_hash !== fingerprint)
            fail("SOURCE_EVENT_CONFLICT", 409);
          return;
        }
        const b = r.payload;
        if (
          !["synthetic", "first_party"].includes(r.data_class) ||
          r.source_id !== cfg.source_id
        )
          fail("SOURCE_BINDING_MISMATCH");
        if (r.kind === "signal") {
          if (
            ![
              "signup",
              "business_setup",
              "outlet_setup",
              "catalog_setup",
              "synced_transaction",
              "report_viewed",
            ].includes(b.signal)
          )
            fail("SOURCE_SIGNAL_NOT_ALLOWED");
          const linked = (
            await c.query(
              `SELECT i.lead_id FROM growth.link_invites i JOIN growth.leads l ON l.workspace_id=i.workspace_id AND l.id=i.lead_id WHERE i.workspace_id=$1 AND i.subject_ref=$2 AND (i.tenant_ref=$3 OR ($3::uuid IS NULL AND $4::text='signup')) AND i.approved_at IS NOT NULL AND i.revoked_at IS NULL AND l.opted_out_at IS NULL AND l.anonymized_at IS NULL`,
              [W, r.subject_ref, r.tenant_ref, b.signal],
            )
          ).rows[0];
          // Opt-out prevents further personal attribution; unlinked minimal events
          // are kept for a short, bounded operational retention period.
          await recordEvent(
            c,
            {
              subject: r.subject_ref,
              leadId: linked?.lead_id,
              signal: b.signal,
              key: "source:" + r.id,
              occurredAt: new Date(r.occurred_at).toISOString(),
            },
            "server",
            true,
          );
          await c.query(
            "UPDATE growth.events SET tenant_ref=$3,source_event_id=$4,data_class=$5 WHERE workspace_id=$1 AND event_key=$2",
            [W, "source:" + r.id, r.tenant_ref, r.id, r.data_class],
          );
          if (linked && b.signal === "synced_transaction") {
            const days = await c.query(
              `SELECT count(DISTINCT (occurred_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS days FROM growth.events WHERE workspace_id=$1 AND lead_id=$2 AND tenant_ref=$3 AND signal='synced_transaction' AND verified AND source_event_id IS NOT NULL`,
              [W, linked.lead_id, r.tenant_ref],
            );
            if (days.rows[0].days >= 2) {
              await recordEvent(
                c,
                {
                  subject: r.subject_ref,
                  leadId: linked.lead_id,
                  signal: "repeat_usage",
                  key: "repeat:" + r.subject_ref + ":" + r.tenant_ref,
                  occurredAt: new Date(r.occurred_at).toISOString(),
                },
                "server",
                true,
              );
              await c.query(
                "UPDATE growth.events SET tenant_ref=$3,data_class=$4 WHERE workspace_id=$1 AND event_key=$2",
                [
                  W,
                  "repeat:" + r.subject_ref + ":" + r.tenant_ref,
                  r.tenant_ref,
                  r.data_class,
                ],
              );
            }
          }
        } else if (r.kind === "ownership") {
          await c.query(
            "UPDATE growth.link_invites SET revoked_at=now() WHERE workspace_id=$1 AND tenant_ref=$2 AND revoked_at IS NULL AND subject_ref::text IS DISTINCT FROM $3::text",
            [W, r.tenant_ref, b.currentSubject ?? null],
          );
          await c.query(
            "UPDATE growth.billing_facts SET paid_verified=false WHERE workspace_id=$1 AND tenant_ref=$2 AND subject_ref::text IS DISTINCT FROM $3::text",
            [W, r.tenant_ref, b.currentSubject ?? null],
          );
          await c.query(
            "INSERT INTO growth.audit(workspace_id,actor_id,action,target_id) VALUES($1,$2,'SOURCE_OWNERSHIP_LINK_REVOKED',$3)",
            [W, r.subject_ref, r.tenant_ref],
          );
        } else if (r.kind === "subscription") {
          if (
            !b.subscriptionId ||
            !Number.isFinite(Number(b.monthlyAmount)) ||
            Number(b.monthlyAmount) < 0
          )
            fail("INVALID_SUBSCRIPTION_FACT");
          await c.query(
            `INSERT INTO growth.billing_history(workspace_id,source_event_id,tenant_ref,status,paid_verified,trial_started_at,trial_ends_at,period_start,period_end,data_class,observed_at,source_seq) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
            [
              W,
              r.id,
              r.tenant_ref,
              b.status,
              b.paidVerified === true,
              b.trialStart,
              b.trialEnd,
              b.periodStart,
              b.periodEnd,
              r.data_class,
              r.occurred_at,
              r.seq,
            ],
          );
          const existing = (
            await c.query(
              "SELECT source_id FROM growth.billing_facts WHERE workspace_id=$1 AND tenant_ref=$2",
              [W, r.tenant_ref],
            )
          ).rows[0];
          if (existing && existing.source_id !== r.source_id)
            fail("SOURCE_REBIND_REQUIRES_REVIEW", 409);
          await c.query(
            `INSERT INTO growth.billing_facts(workspace_id,tenant_ref,subject_ref,subscription_id,status,trial_started_at,trial_ends_at,period_start,period_end,monthly_amount,paid_verified,data_class,source_seq,source_id,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(workspace_id,tenant_ref) DO UPDATE SET subject_ref=EXCLUDED.subject_ref,subscription_id=EXCLUDED.subscription_id,status=EXCLUDED.status,trial_started_at=EXCLUDED.trial_started_at,trial_ends_at=EXCLUDED.trial_ends_at,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,monthly_amount=EXCLUDED.monthly_amount,paid_verified=EXCLUDED.paid_verified,data_class=EXCLUDED.data_class,source_seq=EXCLUDED.source_seq,observed_at=EXCLUDED.observed_at WHERE growth.billing_facts.source_seq<EXCLUDED.source_seq`,
            [
              W,
              r.tenant_ref,
              r.subject_ref,
              b.subscriptionId,
              b.status,
              b.trialStart,
              b.trialEnd,
              b.periodStart,
              b.periodEnd,
              b.monthlyAmount,
              b.paidVerified === true,
              r.data_class,
              r.seq,
              r.source_id,
              r.occurred_at,
            ],
          );
        } else fail("INVALID_SOURCE_KIND");
      });
      await source.query(
        "UPDATE growth_source.outbox SET delivered_at=now(),lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_id=$2",
        [r.id, lease],
      );
      processed++;
    } catch {
      failed++;
      await source.query(
        `UPDATE growth_source.outbox SET lease_until=NULL,available_at=now()+make_interval(secs=>LEAST(3600,power(2,LEAST(attempts,10))::int)),dead_at=CASE WHEN attempts>=8 THEN now() ELSE NULL END,last_error='DELIVERY_FAILED' WHERE id=$1 AND lease_id=$2`,
        [r.id, lease],
      );
    }
  }
  await source.query(
    "UPDATE growth_source.outbox SET lease_until=NULL WHERE lease_id=$1 AND delivered_at IS NULL AND dead_at IS NULL",
    [lease],
  );
  const state = (
    await source.query(
      `SELECT count(*) FILTER(WHERE delivered_at IS NULL AND dead_at IS NULL)::int AS pending,count(*) FILTER(WHERE dead_at IS NOT NULL)::int AS dead,min(occurred_at) FILTER(WHERE delivered_at IS NULL) AS oldest FROM growth_source.outbox`,
    )
  ).rows[0];
  await inWorkspace(target, (c) =>
    c.query(
      `INSERT INTO growth.integration_state(workspace_id,source_id,last_run_at,backfill_at,pending,dead,oldest_pending) VALUES($1,$2,now(),$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET source_id=EXCLUDED.source_id,last_run_at=EXCLUDED.last_run_at,backfill_at=EXCLUDED.backfill_at,pending=EXCLUDED.pending,dead=EXCLUDED.dead,oldest_pending=EXCLUDED.oldest_pending`,
      [
        W,
        cfg.source_id,
        cfg.backfill_at,
        state.pending,
        state.dead,
        state.oldest,
      ],
    ),
  );
  return { processed, failed, ...state };
}
export async function productMetrics(c: Db, now = new Date()) {
  const state =
    (
      await c.query(
        "SELECT * FROM growth.integration_state WHERE workspace_id=$1",
        [W],
      )
    ).rows[0] ?? null;
  const rows = (
    await c.query("SELECT * FROM growth.billing_facts WHERE workspace_id=$1", [
      W,
    ])
  ).rows;
  const fresh =
    !!state?.backfill_at &&
    state.pending === 0 &&
    state.dead === 0 &&
    now.getTime() - new Date(state.last_run_at).getTime() < 15 * 60000;
  const live = rows.filter((r) => r.data_class === "first_party");
  const verified = live.filter((r) => r.paid_verified);
  const mrr = verified
    .filter(
      (r) =>
        r.status === "ACTIVE" &&
        new Date(r.period_start) <= now &&
        new Date(r.period_end) > now,
    )
    .reduce((s, r) => s + Number(r.monthly_amount), 0);
  const history = (
    await c.query(
      "SELECT * FROM growth.billing_history WHERE workspace_id=$1 AND data_class='first_party' ORDER BY observed_at,source_seq,source_event_id",
      [W],
    )
  ).rows;
  const cohort = verifiedCohorts(
    live,
    history,
    state?.backfill_at ? new Date(state.backfill_at) : null,
    now,
  );
  const eventCounts = (
    await c.query(
      "SELECT signal,data_class,count(DISTINCT subject_ref)::int AS accounts FROM growth.events WHERE workspace_id=$1 AND verified AND origin='server' AND (source_event_id IS NOT NULL OR event_key LIKE 'repeat:%') GROUP BY signal,data_class ORDER BY data_class,signal",
      [W],
    )
  ).rows;
  return {
    eventCounts,
    state,
    coverageFresh: fresh,
    syntheticSubscriptions: rows.length - live.length,
    verifiedSubscriptions: verified.length,
    mrr: fresh && live.length ? Math.round(mrr * 100) / 100 : null,
    conversion: fresh ? cohort.conversion : null,
    churn: fresh ? cohort.churn : null,
    cohort,
    reason: !fresh
      ? "SOURCE_COVERAGE_INCOMPLETE_OR_STALE"
      : !live.length
        ? "NO_FIRST_PARTY_BILLING"
        : cohort.churn === null
          ? "HISTORICAL_COHORT_REQUIRED"
          : "VERIFIED_BILLING",
    currency: "IDR",
  };
}
export async function linkedLifecycle(c: Db, leadId: string) {
  return (
    (
      await c.query(
        `SELECT b.* FROM growth.link_invites i JOIN growth.billing_facts b ON b.workspace_id=i.workspace_id AND b.tenant_ref=i.tenant_ref AND b.subject_ref=i.subject_ref WHERE i.workspace_id=$1 AND i.lead_id=$2 AND i.approved_at IS NOT NULL AND i.revoked_at IS NULL`,
        [W, leadId],
      )
    ).rows[0] ?? null
  );
}

/** Mature 30-day observation window. Conversion denominator: trials that started
 * after capture began and ended in this window. Numerator: provider-verified paid
 * activation observed by now. Churn denominator: verified, unexpired ACTIVE at
 * window start; numerator: no verified active coverage at window end. */
export function verifiedCohorts(
  current: any[],
  history: any[],
  backfill: Date | null,
  now = new Date(),
) {
  const start = new Date(now.getTime() - 30 * 86400000);
  if (!backfill || backfill > start)
    return {
      conversion: null,
      churn: null,
      trialCohort: 0,
      converted: 0,
      openingPaid: 0,
      churned: 0,
      windowStart: start.toISOString(),
      windowEnd: now.toISOString(),
    };
  const trial = current.filter(
    (r) =>
      r.trial_started_at &&
      r.trial_ends_at &&
      new Date(r.trial_started_at) >= backfill &&
      new Date(r.trial_ends_at) >= start &&
      new Date(r.trial_ends_at) <= now,
  );
  const converted = trial.filter((r) =>
    history.some(
      (h) =>
        h.tenant_ref === r.tenant_ref &&
        h.paid_verified &&
        h.status === "ACTIVE" &&
        new Date(h.observed_at) >= new Date(r.trial_started_at) &&
        new Date(h.observed_at) <= now,
    ),
  ).length;
  const baseline = new Map<string, any>();
  for (const h of history)
    if (new Date(h.observed_at) <= start) baseline.set(h.tenant_ref, h);
  const opening = [...baseline.values()].filter(
    (h) =>
      h.paid_verified &&
      h.status === "ACTIVE" &&
      new Date(h.period_start) <= start &&
      new Date(h.period_end) > start,
  );
  const churned = opening.filter(
    (h) =>
      !current.some(
        (r) =>
          r.tenant_ref === h.tenant_ref &&
          r.paid_verified &&
          r.status === "ACTIVE" &&
          new Date(r.period_start) <= now &&
          new Date(r.period_end) > now,
      ),
  ).length;
  return {
    conversion: trial.length ? converted / trial.length : null,
    churn: opening.length ? churned / opening.length : null,
    trialCohort: trial.length,
    converted,
    openingPaid: opening.length,
    churned,
    windowStart: start.toISOString(),
    windowEnd: now.toISOString(),
  };
}
