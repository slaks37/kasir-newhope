import { growthEnabled } from "./db";
/** Isolated Growth Preview can use a POS/billing-only credential. The CRM role
 * retains no merchant-book access. Ignored on every production runtime. */
export function growthBusinessConnection(env: NodeJS.ProcessEnv = process.env) {
  if (!growthEnabled(env) || !env.GROWTH_BUSINESS_DATABASE_URL)
    return undefined;
  const u = new URL(env.GROWTH_BUSINESS_DATABASE_URL);
  if (
    !u.hostname.endsWith(".neon.tech") &&
    !["localhost", "127.0.0.1"].includes(u.hostname)
  )
    throw Error("UNAPPROVED_GROWTH_BUSINESS_HOST");
  if (u.hostname.endsWith(".neon.tech")) {
    for (const k of ["sslcert", "sslkey", "sslrootcert", "uselibpqcompat"])
      u.searchParams.delete(k);
    u.searchParams.set("sslmode", "verify-full");
  }
  return u.toString();
}
