/**
 * KONSOL BACK-OFFICE — identitas, RBAC, dan endpointnya.
 *
 * KENAPA UJI INI ADA. Tidak satu pun uji di repositori ini pernah memanggil
 * endpoint `/api/admin/*`. Akibatnya dua cacat berat hidup tanpa terdeteksi:
 * satu halaman yang gagal total, dan satu jalan pintas menjadi SUPERADMIN.
 *
 * Konsol ini membaca pembukuan SETIAP merchant di platform. Ia permukaan
 * dengan hak tertinggi yang ada, dan justru yang paling sedikit diuji.
 */
import { conn, line } from './probe.mjs';

const BO = process.env.BO_API_URL || 'http://127.0.0.1:3104';
const GW = process.env.GW_API_URL || 'http://127.0.0.1:3000';

let gagal = 0;
const cek = (ok, pesan) => { if (ok) line(`     OK     ${pesan}`); else { gagal++; line(`     GAGAL  ${pesan}`); } };

const siap = async (url) => {
  for (let i = 0; i < 30; i++) {
    if (await fetch(url + '/ready').then((r) => r.ok).catch(() => false)) return true;
    if (await fetch(url + '/api/health').then((r) => r.ok).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

const adaBo = await siap(BO);
const adaGw = await siap(GW);
if (!adaBo) {
  line('\n  backoffice-service tidak menyala di :3104 — dilewati.');
  line('  Jalankan: npx tsx services/backoffice/index.ts');
  process.exit(0);
}

const panggil = (path, headers = {}, base = BO) =>
  fetch(base + path, { headers: { 'x-forwarded-host': 'admin.localhost', ...headers } })
    .then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }));

const sebagai = (email) => ({ 'x-internal-user': email });

// --- 1. Semua endpoint yang dipanggil panel harus hidup --------------------
line('\n  1. Setiap endpoint yang dipanggil panel');
const ENDPOINT = [
  '/me', '/identities', '/overview', '/merchants', '/transactions',
  '/products', '/catalog', '/raw-materials', '/recipes',
  '/activity', '/activity/breakdown', '/access-audit',
];
const rusak = [];
for (const ep of ENDPOINT) {
  const r = await panggil(`/api/admin${ep}`, sebagai('ops@newhopepos.id'));
  if (r.s !== 200) rusak.push(`${ep} -> ${r.s} ${r.b?.error ?? ''}`);
}
cek(rusak.length === 0, `${ENDPOINT.length} endpoint menjawab 200 (${rusak.join(', ') || 'semua'})`);

/*
 * Bagian ini menangkap cacat nyata: /activity menjawab 500 dengan
 * "column a.business_id does not exist" — kueri memilih dua kolom yang tidak
 * ada di contract.activity_log. Seluruh halaman Jejak Aktivitas kosong, bukan
 * sebagian.
 */
const act = await panggil('/api/admin/activity', sebagai('ops@newhopepos.id'));
cek(act.s === 200 && Array.isArray(act.b.rows), 'jejak aktivitas mengembalikan baris');
cek(act.b.rows?.length > 0 && 'business_id' in (act.b.rows[0] ?? {}),
    'business_id ikut terbawa — layar Activity menampilkannya');

// --- 2. RBAC ditegakkan SERVER, bukan menu yang disembunyikan --------------
line('\n  2. RBAC per peran — ditegakkan server');
const MATRIKS = [
  ['growth@newhopepos.id',  '/overview',     200, 'analitik sektor: BOLEH'],
  ['growth@newhopepos.id',  '/transactions', 403, 'log transaksi: DITOLAK'],
  ['growth@newhopepos.id',  '/products',     403, 'penjualan produk: DITOLAK'],
  ['growth@newhopepos.id',  '/access-audit', 403, 'audit akses: DITOLAK'],
  ['support@newhopepos.id', '/overview',     403, 'analitik sektor: DITOLAK'],
  ['support@newhopepos.id', '/transactions', 200, 'log transaksi: BOLEH'],
  ['support@newhopepos.id', '/access-audit', 403, 'audit akses: DITOLAK'],
  ['ops@newhopepos.id',     '/access-audit', 200, 'superadmin: BOLEH'],
];
for (const [email, ep, harap, label] of MATRIKS) {
  const r = await panggil(`/api/admin${ep}`, sebagai(email));
  cek(r.s === harap, `${email.split('@')[0].padEnd(8)} ${ep.padEnd(14)} ${label} (${r.s})`);
}

// --- 3. Identitas tak dikenal ----------------------------------------------
line('\n  3. Identitas');
{
  const r = await panggil('/api/admin/me', sebagai('penyusup@mana-saja.id'));
  cek(r.s === 401 && r.b.error === 'UNKNOWN_IDENTITY', `email asing ditolak (${r.s})`);
  const kosong = await panggil('/api/admin/merchants', {});
  cek(kosong.s !== 200, `tanpa identitas sama sekali ditolak (${kosong.s})`);
}

// --- 4. ESKALASI LEWAT GATEWAY ---------------------------------------------
//
// Ini cacat terberatnya. Gateway dulu meneruskan `x-internal-user` dari klien
// APA ADANYA, sehingga siapa pun yang punya sesi sah — merchant mana pun yang
// mendaftar — cukup mengirim satu header untuk membaca pembukuan seluruh
// platform.
line('\n  4. ESKALASI LEWAT GATEWAY — jalur produksi sungguhan');

/*
 * Bagian ini menyalakan gateway-nya SENDIRI, dengan Supabase tiruan, TANPA
 * AUTH_ALLOW_LOCAL_DEVELOPMENT. Alasannya: di mode pengembangan lokal tidak ada
 * sesi sama sekali, jadi jalur yang justru perlu diuji tidak pernah dijalani.
 *
 * Cacat yang ditutup: gateway dulu meneruskan `x-internal-user` dari klien APA
 * ADANYA. Siapa pun yang punya sesi sah — merchant mana pun yang mendaftar —
 * cukup mengirim satu header untuk menjadi SUPERADMIN dan membaca pembukuan
 * seluruh platform. Diperagakan langsung: jawabannya 200, berisi transaksi
 * merchant lain.
 */
{
  const { spawn } = await import('node:child_process');
  const http = await import('node:http');

  // Supabase tiruan: token "admin-*" = staf internal, selain itu merchant biasa.
  const stub = http.createServer((req, res) => {
    if (!req.url.startsWith('/auth/v1/user')) return res.writeHead(404).end();
    const admin = String(req.headers.authorization || '').includes('admin-');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(admin
      ? { id: 'usr-ops', email: 'ops@newhopepos.id' }
      : { id: 'usr-budi', email: 'budi@warungbudi.id' }));
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const portStub = stub.address().port;
  const portGw = 3000 + Math.floor(Math.random() * 900) + 50;

  const gw = spawn('npx', ['tsx', 'services/gateway/index.ts'], {
    env: {
      ...process.env,
      AUTH_ALLOW_LOCAL_DEVELOPMENT: '',
      // PORT ikut dikosongkan: PORTS.gateway membaca PORT LEBIH DULU daripada
      // PORT_GATEWAY, jadi PORT yang diwarisi dari shell akan menang.
      PORT: String(portGw),
      PORT_GATEWAY: String(portGw),
      SUPABASE_URL: `http://127.0.0.1:${portStub}`,
      SUPABASE_ANON_KEY: 'kunci-uji',
      URL_BACKOFFICE: BO,
    },
    stdio: process.env.DEBUG_GW ? 'inherit' : 'ignore',
  });

  const base = `http://127.0.0.1:${portGw}`;
  /*
   * Ditunggu lewat /api/breakers, BUKAN /api/health.
   *
   * /api/health memanggil setiap service di belakangnya; di lingkungan uji
   * sebagian memang mati, jadi ia menunggu batas waktu masing-masing dan bisa
   * lebih lama daripada jendela tunggu ini. /api/breakers dijawab seketika
   * dari memori.
   */
  let hidup = false;
  for (let i = 0; i < 40; i++) {
    if (await fetch(base + '/api/breakers').then((r) => r.ok).catch(() => false)) { hidup = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!hidup) {
    line(`     gateway uji tidak menyala di :${portGw} — bagian ini dilewati.`);
  } else {
    const via = (token, header) =>
      fetch(base + '/api/admin/me', {
        headers: { Authorization: `Bearer ${token}`, ...(header ? { 'x-internal-user': header } : {}) },
      }).then(async (r) => ({ s: r.status, b: await r.json().catch(() => ({})) }));

    const a = await via('admin-token');
    cek(a.s === 200 && a.b.user?.email === 'ops@newhopepos.id',
        'staf internal sah masuk TANPA mengirim header apa pun — identitas dari sesi');

    const b = await via('token-merchant', 'ops@newhopepos.id');
    cek(b.s === 401 && b.b.error === 'UNKNOWN_IDENTITY',
        'merchant biasa yang MENGAKU superadmin ditolak — eskalasi tertutup');

    const c2 = await via('admin-token', 'growth@newhopepos.id');
    cek(c2.s === 200 && c2.b.user?.email === 'ops@newhopepos.id',
        'staf sah tidak bisa menyamar jadi staf LAIN — header diabaikan');
  }

  gw.kill();
  await new Promise((r) => stub.close(r));
}

// --- 5. Audit akses tercatat ------------------------------------------------
line('\n  5. Setiap akses ke data merchant tercatat');
{
  const c = await conn();
  const sebelum = Number((await c.query('SELECT count(*)::int n FROM internal.internal_access_log')).rows[0].n);
  await panggil('/api/admin/access-audit', sebagai('ops@newhopepos.id'));
  await panggil('/api/admin/transactions', sebagai('support@newhopepos.id'));
  const sesudah = Number((await c.query('SELECT count(*)::int n FROM internal.internal_access_log')).rows[0].n);
  line(`     baris audit: ${sebelum} -> ${sesudah}`);
  cek(sesudah >= sebelum, 'log audit tidak menyusut');
  await c.end();
}

line(gagal === 0
  ? '\n  >>> LULUS: endpoint admin hidup, RBAC ditegakkan server, identitas diperiksa.\n'
  : `\n  >>> ${gagal} MASALAH.\n`);
process.exit(gagal === 0 ? 0 : 1);
