import { timingSafeEqual } from "node:crypto";
import { growthDb, growthEnabled } from "./growth/db";
import { sourceDb } from "./growth/sourceDb";
import { drainOutbox } from "./growth/integration";
import { maintainRetention } from "./growth/retention";
/** No new schedule is activated. Preview external scheduler/maintainer calls this
 * authenticated entry; production remains disabled pending release review. */
export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (!growthEnabled())
    return res.status(404).json({ ok: false, error: "GROWTH_DISABLED" });
  const a = Buffer.from(String(req.headers.authorization || "")),
    b = Buffer.from("Bearer " + (process.env.CRON_SECRET || ""));
  if (
    !process.env.CRON_SECRET ||
    a.length !== b.length ||
    !timingSafeEqual(a, b)
  )
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED_CRON" });
  if (req.method !== "GET")
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  try {
    const source = await sourceDb(),
      target = await growthDb();
    const result = await drainOutbox(source, target, 500);
    const retention = await maintainRetention(source, target);
    res.json({ ok: true, ...result, retention });
  } catch {
    return res
      .status(503)
      .json({ ok: false, error: "GROWTH_WORKER_UNAVAILABLE" });
  }
}
