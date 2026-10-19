import { growthDb, growthEnabled, inWorkspace } from "./db";
import { recordEvent } from "./service";
import type { Signal } from "../../lib/growth/model";
/** Optional, best-effort telemetry after business commit. No PII, amounts or items.
 * Failure never changes the POS response. Not a billing/audit source of truth.
 * Unlinked subjects remain separate from CRM leads until ownership review.
 */
export function captureGrowthSignal(
  subject: string,
  signal: Signal,
  key: string,
  now = new Date(),
  sink = async () => {
    const db = await growthDb();
    await inWorkspace(db, (c) =>
      recordEvent(
        c,
        { subject, signal, key, occurredAt: now.toISOString() },
        "server",
        true,
      ),
    );
  },
) {
  if (!growthEnabled() || process.env.GROWTH_CAPTURE_ENABLED !== "1") return;
  void Promise.resolve()
    .then(sink)
    .catch(() => {
      console.warn("[growth] optional telemetry not recorded");
    });
}
