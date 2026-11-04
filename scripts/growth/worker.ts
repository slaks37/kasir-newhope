// Use an approved private env, not command-line connection strings. Preview only.
import fs from "node:fs";
import dotenv from "dotenv";
import { sourceDb } from "../../src/server/growth/sourceDb";
import { growthDb, growthEnabled } from "../../src/server/growth/db";
import { maintainRetention } from "../../src/server/growth/retention";
import { drainOutbox } from "../../src/server/growth/integration";
if (fs.existsSync(".env.growth-preview.local"))
  Object.assign(
    process.env,
    dotenv.parse(fs.readFileSync(".env.growth-preview.local")),
  );
process.env.VERCEL_ENV ??= "preview";
if (!growthEnabled() || process.env.APP_ENV === "production")
  throw Error("STAGING_ONLY");
const source = await sourceDb(),
  target = await growthDb();
try {
  console.log(
    JSON.stringify({
      delivery: await drainOutbox(source, target, 500),
      retention: await maintainRetention(source, target),
    }),
  );
} finally {
  await source.close();
  await target.close();
}
