// Real browser -> React -> authenticated fixture HTTP routes -> isolated Postgres.
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = process.env.GROWTH_PLAYWRIGHT_PATH
  ? require(process.env.GROWTH_PLAYWRIGHT_PATH)
  : require("playwright");
const output = "build/growth-browser";
fs.mkdirSync(output, { recursive: true });
const api = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/growth/browser-fixture.ts"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GROWTH_ENGINE_ENABLED: "1", VERCEL_ENV: "preview" },
  },
);
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5187",
    "--strictPort",
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      VITE_API_URL: "http://127.0.0.1:5188",
      VITE_SUPABASE_URL: "http://127.0.0.1:5188",
      VITE_SUPABASE_ANON_KEY: "synthetic-public-fixture",
      DISABLE_HMR: "true",
    },
  },
);
for (const [name, child] of [
  ["api", api],
  ["vite", vite],
]) {
  const log = fs.createWriteStream(output + "/" + name + ".log");
  child.stdout.pipe(log);
  child.stderr.pipe(log);
}
let browser, page;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (await fetch("http://127.0.0.1:5188/api/admin/growth/overview"))
          .status === 401 &&
        (await fetch("http://127.0.0.1:5187/admin.html")).ok
      )
        break;
    } catch {}
    if (i === 99) throw Error("Fixture start timeout");
    await new Promise((r) => setTimeout(r, 300));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.GROWTH_BROWSER_EXECUTABLE || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: "Asia/Jakarta",
  });
  const actor = "00000000-0000-4000-8000-000000000001";
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(JSON.stringify({ sub: actor, aal: "aal2", exp })).toString(
      "base64url",
    ) +
    ".synthetic-test-signature";
  await context.addInitScript(
    ({ actor, token, exp }) => {
      localStorage.setItem(
        "nhpos_internal_identity",
        "fixture@example.invalid",
      );
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "synthetic-refresh-fixture",
          expires_at: exp,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: actor,
            email: "fixture@example.invalid",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {},
          },
        }),
      );
    },
    { actor, token, exp },
  );
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5187/admin.html?module=growth");
  await page
    .getByRole("heading", { name: "Growth Engine", exact: false })
    .waitFor();
  await page.getByText("DATA SINTETIS STAGING", { exact: false }).waitFor();
  await page.screenshot({
    path: output + "/overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lead baru", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nama usaha", { exact: true })
    .fill("Browser E2E Sintetis");
  await dialog.getByLabel("Nama kontak").fill("Kontak Pengujian");
  await dialog
    .getByLabel("Email", { exact: true })
    .first()
    .fill("browser@example.invalid");
  await dialog
    .getByLabel("Dasar pengumpulan & bukti persetujuan")
    .fill("Synthetic browser test only");
  await dialog
    .getByRole("button", { name: "Simpan lead", exact: true })
    .click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("navigation", { name: "Modul Growth Engine" })
    .getByRole("button", { name: "Leads", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browser E2E Sintetis", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Browser E2E Sintetis", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Tahap pipeline").selectOption("DEMO");
  await d
    .getByLabel("Catatan", { exact: true })
    .fill("Catatan browser tersimpan di PostgreSQL.");
  await d.getByRole("button", { name: "Simpan aktivitas" }).click();
  await d
    .getByText("Catatan browser tersimpan di PostgreSQL.", { exact: true })
    .waitFor();
  await d.getByRole("button", { name: "Siapkan briefing & draf" }).click();
  await d.getByText("Aturan lokal", { exact: true }).waitFor();
  await d.getByRole("button", { name: "Tutup dialog" }).click();
  await page
    .getByRole("navigation", { name: "Modul Growth Engine" })
    .getByRole("button", { name: "Pipeline", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browser E2E Sintetis", exact: true })
    .waitFor();
  await page.screenshot({
    path: output + "/pipeline-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("navigation", { name: "Modul Growth Engine" })
    .getByRole("button", { name: "Leads", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browser E2E Sintetis", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByText("Catatan browser tersimpan di PostgreSQL.", { exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tutup dialog" })
    .click();
  await page
    .getByRole("navigation", { name: "Modul Growth Engine" })
    .getByRole("button", { name: "Aktivasi trial", exact: true })
    .click();
  await page.getByRole("heading", { name: "Aktivasi trial 45 hari" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Modul Growth Engine" })
    .getByRole("button", { name: "Ringkasan", exact: true })
    .click();
  await page.screenshot({
    path: output + "/overview-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
    "Mobile must not horizontally overflow",
  );
  assert.deepEqual(errors, [], "No uncaught browser exceptions");
  const result = {
    pass: true,
    checks: [
      "Admin fixture MFA + RBAC",
      "Dashboard renders stored synthetic metrics",
      "Lead created through UI and persisted",
      "Pipeline stage updated",
      "Activity persisted across reload",
      "Safe Copilot fallback rendered",
      "Trial activation UI",
      "Desktop and mobile layouts",
      "No uncaught browser errors",
    ],
    note: "Synthetic authenticated fixture, not live Supabase credentials or production acceptance",
  };
  fs.writeFileSync(
    output + "/result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} catch (e) {
  await page
    ?.screenshot({ path: output + "/failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  api.kill("SIGTERM");
  vite.kill("SIGTERM");
}
