import pg from "pg";
import type { Db } from "../../../services/shared/db";
export const GROWTH_WORKSPACE = "b1b56887-e47e-45ec-9e10-d58d378709ce";
export function growthEnabled(env: NodeJS.ProcessEnv = process.env) {
  const staging =
    env.VERCEL_ENV === "preview" ||
    env.VERCEL_ENV === "development" ||
    (!env.VERCEL_ENV && env.NODE_ENV !== "production");
  return (
    env.GROWTH_ENGINE_ENABLED === "1" && staging && env.APP_ENV !== "production"
  );
}
let pool: pg.Pool | undefined;
export async function growthDb(): Promise<Db> {
  if (!growthEnabled() || !process.env.GROWTH_DATABASE_URL)
    throw Error("GROWTH_NOT_CONFIGURED");
  if (!pool) {
    const u = new URL(process.env.GROWTH_DATABASE_URL);
    const local = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (!local && !u.hostname.endsWith(".neon.tech"))
      throw Error("GROWTH_DATABASE_HOST_NOT_APPROVED");
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
      ssl: local ? undefined : { rejectUnauthorized: true },
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 5000,
    });
    pool.on("error", () => console.error("[growth] database pool unavailable"));
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
        const result = await fn(wrap(c));
        await c.query("COMMIT");
        return result;
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
export async function inWorkspace<T>(
  db: Db,
  fn: (db: Db) => Promise<T>,
  workspace = GROWTH_WORKSPACE,
) {
  return db.tx(async (c) => {
    await c.query("SELECT set_config('app.growth_workspace',$1,true)", [
      workspace,
    ]);
    return fn(c);
  });
}
