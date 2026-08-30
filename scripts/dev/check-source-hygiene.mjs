#!/usr/bin/env node
/**
 * Source hygiene gate.
 *
 *   node scripts/dev/check-source-hygiene.mjs
 *
 * Exists because it already happened: a generated file landed with two raw NUL
 * bytes (0x00) used as a string delimiter. TypeScript compiled it, the tests
 * passed, and nobody noticed — until Git classified the 1,866-line analytics
 * core as a *binary* file, killing diffs, blame, merges and grep on it.
 *
 * The fix in code is to write the two-character escape \0 inside the literal.
 * The fix in process is this check.
 *
 * Also catches a few other things that silently break tooling.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { extname, join, relative, sep } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'scripts', 'migrations', 'docs'];
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.sql', '.md', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

/** Tailwind spacing scale has no 0.2 step — `py-0.2` silently renders nothing. */
const INVALID_TW = /\b(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-0\.(?!5\b)\d+\b/;

const problems = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full);
    else if (SCAN_EXT.has(extname(name))) inspect(full);
  }
}

function lineOfOffset(buf, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < buf.length; i++) if (buf[i] === 0x0a) line++;
  return line;
}

function inspect(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const buf = readFileSync(file);

  // 1. Raw NUL bytes — makes Git treat the file as binary.
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      problems.push(
        `${rel}:${lineOfOffset(buf, i)} raw NUL byte (0x00) at offset ${i} — use the escape \\0 inside the string literal instead`
      );
      break; // one report per file is enough
    }
  }

  // 2. UTF-16 BOM — Node and esbuild will choke.
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    problems.push(`${rel}:1 UTF-16 BOM — save the file as UTF-8`);
  }

  const text = buf.toString('utf8');

  // 3. Mojibake: UTF-8 read as Windows-1252 then re-encoded as UTF-8.
  //    Caused here by a PowerShell `Get-Content -Raw | Set-Content -Encoding UTF8`
  //    round-trip, which mangled 99 characters across two files before anyone
  //    noticed. On Windows, always pass -Encoding UTF8 to BOTH ends, or use Node.
  //    Built from escapes so this checker never flags its own source.
  //    Built from char codes so this checker contains no mojibake itself.
  const _c = String.fromCharCode;
  const MOJIBAKE = new RegExp(
    [
      _c(0xe2) + _c(0x20ac),   // UTF-8 E2 80 xx  (dashes, curly quotes, ellipsis)
      _c(0xe2) + _c(0x2020),   // UTF-8 E2 86 xx  (arrows)
      _c(0xc2) + _c(0xa0),     // UTF-8 C2 A0     (non-breaking space)
      _c(0xc3) + "[" + _c(0xa0) + "-" + _c(0xbf) + "]",  // UTF-8 C3 xx (accented latin)
    ].join("|")
  );
  text.split('\n').forEach((line, idx) => {
    if (MOJIBAKE.test(line)) {
      problems.push(
        `${rel}:${idx + 1} mojibake — UTF-8 was decoded as Windows-1252 somewhere. Re-save as UTF-8.`
      );
    }
  });

  // 3b. Collision-prone ids. `${prefix}-${Date.now()}` gives two offline
  //     terminals the same id in the same millisecond; on sync one silently
  //     overwrites the other's row. Use newId() from src/lib/ids.ts.
  if (/\.(ts|tsx)$/.test(file) && !/lib[\\/]ids\.ts$/.test(rel)) {
    text.split('\n').forEach((line, idx) => {
      if (/`[A-Za-z_-]*-\$\{Date\.now\(\)\}/.test(line)) {
        problems.push(
          `${rel}:${idx + 1} id built from Date.now() — collides across offline terminals. Use newId() from src/lib/ids.ts`
        );
      }
    });
  }

  // 4. Invalid Tailwind spacing steps (a real bug this repo already had).
  if (/\.(tsx|jsx)$/.test(file)) {
    text.split('\n').forEach((line, idx) => {
      const m = INVALID_TW.exec(line);
      if (m) problems.push(`${rel}:${idx + 1} invalid Tailwind class "${m[0]}" — not on the spacing scale, renders as nothing`);
    });
  }

  // 4. Anything that looks like a committed provider key.
  const KEY_RE = /\b(sk-[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})\b/;
  if (!rel.startsWith('scripts/dev/')) {
    const km = KEY_RE.exec(text);
    if (km) {
      problems.push(`${rel} looks like it contains a hardcoded API key ("${km[0].slice(0, 8)}…") — keys belong in .env only`);
    }
  }
}

for (const d of SCAN_DIRS) walk(join(ROOT, d));

/* -------------------------------------------------------------------------- */
/* Cross-check: the SQL CHECK constraint must match the TypeScript union.      */
/*                                                                            */
/* These two lists live in different files and different languages, so they    */
/* drift silently. When they do, the nightly cron writes a category the DB     */
/* rejects — and the failure only surfaces in production at 01:00.             */
/* -------------------------------------------------------------------------- */
function checkCategoryParity() {
  let ts;
  let sql;
  try {
    ts = readFileSync(join(ROOT, 'src/lib/assistant/types.ts'), 'utf8');
    sql = readFileSync(join(ROOT, 'migrations/0003_smart_assistant.sql'), 'utf8');
  } catch {
    return; // nothing to compare
  }

  const unionMatch = /export type InsightCategory =([\s\S]*?);/.exec(ts);
  if (!unionMatch) {
    problems.push('types.ts: could not locate the InsightCategory union');
    return;
  }
  const tsCats = new Set([...unionMatch[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));

  const ckMatch = /ck_insight_category[\s\S]{0,120}?CHECK\s*\(([\s\S]*?)\)\s*(?:;|NOT VALID)/i.exec(sql);
  if (!ckMatch) {
    problems.push('migration: could not locate the ck_insight_category CHECK constraint');
    return;
  }
  const sqlCats = new Set([...ckMatch[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));

  for (const c of tsCats) {
    if (!sqlCats.has(c)) {
      problems.push(`category "${c}" exists in types.ts but is MISSING from the SQL CHECK — the cron would fail to insert it`);
    }
  }
  for (const c of sqlCats) {
    if (!tsCats.has(c)) {
      problems.push(`category "${c}" is allowed by the SQL CHECK but no longer exists in types.ts — stale constraint`);
    }
  }
  if (tsCats.size > 0 && sqlCats.size > 0 && problems.length === 0) {
    console.log(`Category parity: OK (${tsCats.size} categories match between types.ts and the migration)`);
  }
}
checkCategoryParity();

/* -------------------------------------------------------------------------- */
/* Tenant isolation: every merchant entity must be scoped per user AND sector. */
/*                                                                            */
/* customers, promo_codes and attendance_logs were originally stored per-user  */
/* only, so a merchant running a cafe and a laundry saw one shared list. Adding */
/* a new entity with getGlobalUserKey() would silently reintroduce that.       */
/* -------------------------------------------------------------------------- */
function checkTenantScoping() {
  // Entities that are *correctly* per-account and NOT per-sector.
  const ALLOWED_GLOBAL = new Set([
    // Holds businessSector itself — scoping it per sector would be circular.
    'settings',
    // One roster across the merchant's businesses; the exposed list is
    // filtered to the active sector in POSContext (sectorStaffMembers).
    'staff_members',
  ]);

  let src;
  try {
    src = readFileSync(join(ROOT, 'src/context/POSContext.tsx'), 'utf8');
  } catch {
    return;
  }

  const globals = new Set(
    [...src.matchAll(/getGlobalUserKey\(\s*'([a-z_]+)'/g)].map((m) => m[1])
  );
  const loaders = new Set(
    [...src.matchAll(/loadGlobalUserData\(\s*'([a-z_]+)'/g)].map((m) => m[1])
  );

  for (const entity of new Set([...globals, ...loaders])) {
    if (!ALLOWED_GLOBAL.has(entity)) {
      problems.push(
        `POSContext: "${entity}" is stored per-account but NOT per-sector — a merchant's other business would see it. Use getScopedKey/loadScopedData, or add it to ALLOWED_GLOBAL with a reason.`
      );
    }
  }

  // The assistant's insight cache must be keyed by sector too.
  try {
    const sched = readFileSync(join(ROOT, 'src/lib/assistant/scheduler.ts'), 'utf8');
    // Must be keyed by the tenant partition (businessId, which encodes the
    // sector) — or at minimum by an explicit sector. Keying by account alone
    // makes two of a merchant's businesses share one cache slot.
    const keyFn = /function cacheKey\(([^)]*)\)/.exec(sched);
    if (keyFn && !/businessId|sector/i.test(keyFn[1])) {
      problems.push(
        'scheduler.ts: cacheKey() is not partitioned by businessId — two businesses of one account would share cached insight cards.'
      );
    }
  } catch {
    /* optional */
  }

  if (problems.length === 0) {
    console.log(
      `Tenant scoping: OK (per-account-only entities limited to: ${[...ALLOWED_GLOBAL].join(', ')})`
    );
  }
}
checkTenantScoping();

/* -------------------------------------------------------------------------- */
/* The churn model exists in THREE places. They must agree.                    */
/*                                                                            */
/*   migrations/0004…sql        compute_churn_risk()  — writes history         */
/*   src/lib/internal/churn.ts  computeChurnRisk()    — scores live in the API */
/*   scripts/batch/merchant-health.mjs                — the nightly job        */
/*                                                                            */
/* If the weights drift, today's dashboard and last week's cohort become two   */
/* different models and nobody notices until a retention decision is wrong.    */
/* -------------------------------------------------------------------------- */
function checkChurnWeightParity() {
  const read = (p) => {
    try {
      return readFileSync(join(ROOT, p), 'utf8');
    } catch {
      return null;
    }
  };
  const sql = read('migrations/0004_internal_backoffice.sql');
  const ts = read('src/lib/internal/churn.ts');
  const job = read('scripts/batch/merchant-health.mjs');
  if (!sql || !ts || !job) return;

  const FACTORS = ['recency', 'activity', 'trend', 'billing', 'adoption', 'support'];

  // SQL:  v_recency  * 0.40 +
  const sqlWeights = {};
  for (const f of FACTORS) {
    const m = new RegExp(`v_${f}\\s*\\*\\s*([0-9.]+)`).exec(sql);
    if (m) sqlWeights[f] = parseFloat(m[1]);
  }
  // TS / job:  recency: 0.4,
  const parseObjWeights = (src, anchor) => {
    const block = new RegExp(`${anchor}[^{]*\\{([^}]*)\\}`).exec(src);
    if (!block) return {};
    const out = {};
    for (const f of FACTORS) {
      const m = new RegExp(`${f}\\s*:\\s*([0-9.]+)`).exec(block[1]);
      if (m) out[f] = parseFloat(m[1]);
    }
    return out;
  };
  const tsWeights = parseObjWeights(ts, 'CHURN_WEIGHTS');
  const jobWeights = parseObjWeights(job, 'const WEIGHTS');

  let compared = 0;
  for (const f of FACTORS) {
    const a = sqlWeights[f];
    const b = tsWeights[f];
    const c = jobWeights[f];
    if (a === undefined || b === undefined || c === undefined) {
      problems.push(`churn weight "${f}" could not be read from all three implementations (sql=${a} ts=${b} job=${c})`);
      continue;
    }
    compared++;
    if (Math.abs(a - b) > 1e-9 || Math.abs(a - c) > 1e-9) {
      problems.push(`churn weight "${f}" differs: sql=${a} ts=${b} job=${c} — the three models have drifted apart`);
    }
  }

  const total = FACTORS.reduce((s, f) => s + (tsWeights[f] ?? 0), 0);
  if (Math.abs(total - 1) > 1e-9) {
    problems.push(`churn weights sum to ${total.toFixed(3)}, not 1.0 — the score could never reach 1.00`);
  }

  if (compared === FACTORS.length) {
    console.log(`Churn model parity: OK (${compared} weights identical across SQL, API and cron; sum = 1.0)`);
  }
}
checkChurnWeightParity();

/* -------------------------------------------------------------------------- */
/* SATU KATALOG HARGA                                                          */
/* -------------------------------------------------------------------------- */
//
// Katalog paket pernah ditulis EMPAT KALI — sekali di billing-service dan tiga
// kali di permukaan serverless — dengan literal harganya tersebar di dua belas
// berkas. Keempatnya kebetulan masih sama nilainya; yang tidak ada adalah
// mekanisme apa pun yang menjaganya tetap begitu.
//
// Sekarang sumbernya satu (src/data/saasPlans.ts). Pemeriksa ini menolak
// salinan berikutnya sebelum sempat menyimpang: satu perubahan harga yang
// terlewat berarti merchant ditagih berbeda dari yang ditampilkan kepadanya.
function checkSinglePriceCatalog() {
  const SUMBER = 'src/data/saasPlans.ts';
  const HARGA = /\b(99000|299000|79000|239000|59000|49000)\b/;

  // Berkas yang memang berhak menyebut angka rupiah paket.
  const DIKECUALIKAN = new Set([
    SUMBER,
    // Skrip operasional yang menyinkronkan katalog ke database jarak jauh; ia
    // memang membandingkan angka, dan tidak ikut dibundel ke mana pun.
    'scripts/db/sync-plans.mjs',
    'scripts/db/bootstrap.mjs',
    'scripts/db/fix-supabase-database.mjs',
    'scripts/dev/verify-supabase.mjs',
    'scripts/dev/check-source-hygiene.mjs',
  ]);

  if (!existsSync(join(ROOT, SUMBER))) {
    problems.push(`${SUMBER} tidak ditemukan — katalog paket kehilangan sumber tunggalnya`);
    return;
  }

  const duplikat = [];
  const scan = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        scan(full);
        continue;
      }
      if (!['.ts', '.tsx', '.mjs'].includes(extname(name))) continue;

      const rel = relative(ROOT, full).split(sep).join('/');
      if (DIKECUALIKAN.has(rel)) continue;

      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        // Hanya baris yang benar-benar menetapkan harga, bukan yang menyebutnya
        // di komentar atau membandingkannya.
        if (!/(priceIdr|priceYearlyIdr|extraOutletPriceIdr|ADDON_PRICE_IDR)\s*[:=]/.test(line)) return;
        if (!HARGA.test(line)) return;
        duplikat.push(`${rel}:${idx + 1} ${line.trim().slice(0, 70)}`);
      });
    }
  };

  for (const d of ['src', 'services', 'api', 'scripts']) {
    if (existsSync(join(ROOT, d))) scan(join(ROOT, d));
  }

  if (duplikat.length) {
    problems.push(
      `harga paket ditulis di luar ${SUMBER} (${duplikat.length} tempat) — ` +
        `impor SAAS_PLANS dari sana:\n      ${duplikat.join('\n      ')}`
    );
    return;
  }

  console.log(`Price catalog: OK (satu-satunya definisi ada di ${SUMBER})`);
}
checkSinglePriceCatalog();

/* -------------------------------------------------------------------------- */
/* KLAIM JUMLAH VIEW KONTRAK HARUS BENAR                                       */
/* -------------------------------------------------------------------------- */
//
// README menyebut berapa view yang ada di skema `contract`. Angka itu pernah
// tertinggal jauh — tertulis 13 sementara migrasi membuat 29 — dan tidak ada
// yang menyadarinya karena tidak ada yang menghitungnya.
//
// Dihitung dari DDL, bukan dari database, supaya pemeriksa ini tetap berjalan
// di CI tanpa Postgres. Yang dihitung adalah keadaan AKHIR: view yang dibuat
// lalu dijatuhkan oleh DROP ... CASCADE di migrasi berikutnya tidak boleh ikut.
function checkContractViewCount() {
  const dir = join(ROOT, 'migrations');
  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Dijalankan berurutan seperti penerap migrasi: CREATE menambah, DROP
  // membuang. Itu satu-satunya cara menghitung yang benar-benar tersisa.
  // Komentar DIBUANG lebih dulu. Migrasi di repositori ini menjelaskan sebab
  // perubahannya dengan mengutip perintah SQL di dalam komentar — dan parser
  // yang membaca kutipan itu sebagai pernyataan akan menghitung DROP yang tidak
  // pernah dijalankan. Persis itu yang terjadi: satu komentar di 0040 yang
  // mengutip `DROP VIEW ... contract.merchant_revenue` membuat hitungannya
  // meleset satu.
  const tanpaKomentar = (sql) =>
    sql
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // blok
      .replace(/--[^\n]*/g, ' '); // baris

  // Dijalankan berurutan seperti penerap migrasi. Per berkas, DROP diproses
  // sebelum CREATE karena pola yang dipakai repositori ini selalu
  // "drop-lalu-buat-ulang" dalam satu berkas.
  const hidup = new Set();
  for (const f of files) {
    const sql = tanpaKomentar(readFileSync(join(dir, f), 'utf8'));
    for (const m of sql.matchAll(/DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?contract\.([a-z_]+)/gi)) {
      hidup.delete(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+contract\.([a-z_]+)/gi)) {
      hidup.add(m[1].toLowerCase());
    }
  }

  if (hidup.size === 0) return; // tidak ada yang bisa dibandingkan

  const readme = (() => {
    try {
      return readFileSync(join(ROOT, 'README.md'), 'utf8');
    } catch {
      return null;
    }
  })();
  if (!readme) return;

  const m = /contract\.\*\s*←\s*(\d+)\s*view/.exec(readme);
  if (!m) {
    problems.push('README: klaim jumlah view kontrak tidak ditemukan — pemeriksa ini tidak bisa menjaganya');
    return;
  }

  const diklaim = Number(m[1]);
  if (diklaim !== hidup.size) {
    problems.push(
      `README menyebut ${diklaim} view kontrak, migrasi menghasilkan ${hidup.size} — perbarui angkanya di README.md`
    );
    return;
  }

  console.log(`Contract views: OK (README dan migrasi sama-sama ${hidup.size})`);
}
checkContractViewCount();

/**
 * Spesifikasi OpenAPI harus memuat SETIAP rute yang benar-benar ada, dan tidak
 * memuat rute yang sudah tidak ada.
 *
 * KENAPA PEMERIKSAAN INI ADA. Dokumentasi API yang ditulis tangan selalu
 * benar pada hari ia ditulis, lalu meleset diam-diam. Yang membuatnya
 * berbahaya bukan ketiadaan dokumentasi, melainkan dokumentasi yang SALAH:
 * integrator membangun di atasnya, dan kesalahannya baru terlihat di produksi
 * milik orang lain.
 *
 * Yang diperiksa hanya keberadaan jalur — bentuk muatannya tidak bisa
 * diverifikasi tanpa menjalankan servernya, dan pemeriksaan yang mengaku lebih
 * daripada yang ia lakukan lebih buruk daripada tidak ada.
 */
function checkOpenApiCoverage() {
  const spec = 'docs/api/openapi.yaml';
  if (!existsSync(spec)) {
    problems.push(`${spec} tidak ada — dokumentasi API hilang.`);
    return;
  }
  const teks = readFileSync(spec, 'utf8');

  // Jalur di spec: kunci dua-spasi di bawah `paths:`.
  const didokumentasikan = new Set(
    [...teks.matchAll(/^ {2}(\/[^\s:]*):\s*$/gm)].map((m) => m[1])
  );

  // Rute nyata dari sumber. Rute internal antar-service dan penangkap SPA
  // sengaja dikecualikan: keduanya bukan API publik.
  const kode = execSync(
    `grep -rhoE "app\\.(get|post|put|patch|delete)\\('[^']+'" services/ 2>/dev/null || true`,
    { encoding: 'utf8' }
  );
  const nyata = new Set();
  for (const baris of kode.split('\n')) {
    const m = /app\.\w+\('([^']+)'/.exec(baris);
    if (!m) continue;
    const jalur = m[1];
    if (jalur === '*' || jalur === '/health' || jalur === '/ready') continue;
    if (jalur.startsWith('/internal/')) continue;
    if (jalur.startsWith('/api/admin/')) continue;
    nyata.add(jalur);
  }

  const hilang = [...nyata].filter((r) => !didokumentasikan.has(r)).sort();
  const hantu = [...didokumentasikan].filter((r) => !nyata.has(r)).sort();

  if (hilang.length) {
    problems.push(
      `${spec} tidak memuat ${hilang.length} rute yang ada di kode: ${hilang.join(', ')}`
    );
  }
  if (hantu.length) {
    problems.push(
      `${spec} memuat ${hantu.length} rute yang tidak ada di kode: ${hantu.join(', ')}`
    );
  }
  if (!hilang.length && !hantu.length) {
    console.log(`OpenAPI: OK (${nyata.size} rute publik terdokumentasi, tidak ada yang meleset)`);
  }
}
checkOpenApiCoverage();

if (problems.length === 0) {
  console.log('Source hygiene: OK');
  process.exit(0);
}

console.error(`Source hygiene: ${problems.length} problem(s)\n`);
problems.forEach((p, i) => console.error(`${String(i + 1).padStart(3)}. ${p}`));
process.exit(1);
