import pg from "pg";
import type { Db } from "../../../services/shared/db";
import { growthEnabled } from "./db";
let pool: pg.Pool | undefined;
/** Worker credential reads only the minimized outbox + canonical ownership columns.
 * It cannot read merchant financial tables or access the CRM. */
export async function sourceDb(): Promise<Db> {
  if (!growthEnabled() || !process.env.GROWTH_SOURCE_DATABASE_URL)
    throw Error("GROWTH_SOURCE_NOT_CONFIGURED");
  if (!pool) {
    const u = new URL(process.env.GROWTH_SOURCE_DATABASE_URL);
    if (
      !["localhost", "127.0.0.1"].includes(u.hostname) &&
      !u.hostname.endsWith(".neon.tech")
    )
      throw Error("UNAPPROVED_SOURCE_HOST");
    for (const k of [
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "uselibpqcompat",
    ])
      u.searchParams.delete(k);
    pool = new pg.Pool({
      connectionString: u.toString(),
      ssl: ["localhost", "127.0.0.1"].includes(u.hostname)
        ? undefined
        : { rejectUnauthorized: true },
      max: 2,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      idleTimeoutMillis: 10000,
    });
    pool.on("error", () => console.error("[growth] source worker unavailable"));
  }
  const wrap = (q: Pick<pg.PoolClient, "query">): Db => ({
    query: async (s, p) => {
      const r = await q.query(s, p as any[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    exec: async (s) => {
      await q.query(s);
    },
    tx: async (fn) => {
      const c = await pool!.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(wrap(c));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => {
      await pool?.end();
      pool = undefined;
    },
  });
  return wrap(pool);
}
