/**
 * RBAC void — apakah server benar-benar menegakkannya?
 *
 * Memakai fungsi hash PIN yang SAMA dengan sisi klien, supaya yang diuji adalah
 * kecocokan rumus keduanya, bukan salinan yang kebetulan cocok.
 */
import crypto from 'node:crypto';
const line = console.log;
const API = 'http://127.0.0.1:3101';
const post = (path, b) => fetch(API + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
}).then(async r => ({ s: r.status, b: await r.json().catch(() => ({})) }));

for (let i = 0; i < 30; i++) {
  if (await fetch(API + '/ready').then(r => r.ok).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 1000));
}

// Format identik src/lib/auth/pinSecurity.ts: sha256$<salt>$<sha256(pin:salt)>
const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `sha256$${salt}$${crypto.createHash('sha256').update(`${pin}:${salt}`).digest('hex')}`;
};

/*
 * Prefiks unik per jalan.
 *
 * `UNIQUE (tenant_id, client_txn_id)` dan kunci idempotensi bersifat persisten,
 * jadi uji yang memakai id tetap hanya lulus sekali pada database kosong — lalu
 * "gagal" pada jalan berikutnya karena idempotensinya bekerja dengan benar.
 * Uji yang hanya bisa dijalankan sekali bukan uji.
 */
const RUN = Date.now().toString(36);
const base = { businessId: `own-rbac_${RUN}_FNB`, sector: 'FNB', storeName: 'Toko RBAC' };
const mk = (id, extra = {}) => ({
  clientTxnId: id, invoiceNumber: 'INV-' + id, cashierName: 'Kasir', cashierRef: 'kasir-01',
  subtotal: 50000, discountAmount: 0, taxAmount: 0, serviceChargeAmount: 0, totalAmount: 50000,
  paymentMethod: 'CASH', paymentStatus: 'PAID', createdAt: new Date().toISOString(),
  items: [{ productRef: 'p1', productName: 'Kopi', unitPrice: 50000, unitCost: 20000, quantity: 1, totalPrice: 50000 }],
  ...extra,
});

let gagal = 0;
const harus = (nama, kondisi, detail) => {
  if (!kondisi) gagal++;
  line(`     ${kondisi ? 'OK    ' : 'GAGAL '} ${nama.padEnd(46)} ${detail}`);
};

line('\n  1. Daftarkan staf: manajer (PIN 4821) dan kasir (PIN 1111)');
let r = await post('/api/v1/sync/staff', { ...base, staff: [
  { ref: 'mgr-01', nama: 'Sinta Manajer', peran: 'MANAGER', pinHash: hashPin('4821') },
  { ref: 'kasir-01', nama: 'Budi Kasir', peran: 'CASHIER', pinHash: hashPin('1111') },
]});
harus('pendaftaran staf', r.s === 200, `${r.s} tersimpan=${r.b.tersimpan}`);

line('\n  2. Buat transaksi');
r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-a`, transactions: [mk(`${RUN}-RBV-1`)] });
harus('transaksi dibuat', r.b.accepted === 1, `${r.s} accepted=${r.b.accepted}`);

line('\n  3. Coba VOID dengan berbagai otorisasi');

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-b`,
  transactions: [mk(`${RUN}-RBV-1`, { paymentStatus: 'CANCELLED', cashierRole: 'MANAGER' })] });
harus('tanpa otorisasi (mengaku MANAGER)', r.s === 403 && r.b.error === 'AUTHORIZATION_REQUIRED', `${r.s} ${r.b.error || ''}`);

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-c`,
  transactions: [mk(`${RUN}-RBV-1`, { paymentStatus: 'CANCELLED', authorizedByRef: 'kasir-01', authorizationPin: '1111' })] });
harus('PIN kasir benar, tapi peran CASHIER', r.s === 403 && r.b.error === 'ROLE_FORBIDDEN', `${r.s} ${r.b.error || ''}`);

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-d`,
  transactions: [mk(`${RUN}-RBV-1`, { paymentStatus: 'CANCELLED', authorizedByRef: 'mgr-01', authorizationPin: '0000' })] });
harus('manajer, PIN salah', r.s === 403 && r.b.error === 'INVALID_PIN', `${r.s} ${r.b.error || ''}`);

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-e`,
  transactions: [mk(`${RUN}-RBV-1`, { paymentStatus: 'CANCELLED', authorizedByRef: 'hantu-99', authorizationPin: '4821' })] });
harus('staf tidak terdaftar', r.s === 403 && r.b.error === 'STAFF_NOT_FOUND', `${r.s} ${r.b.error || ''}`);

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-f`,
  transactions: [mk(`${RUN}-RBV-1`, { paymentStatus: 'CANCELLED', authorizedByRef: 'mgr-01', authorizationPin: '4821' })] });
harus('manajer, PIN benar', r.s === 200 && r.b.voided === 1, `${r.s} voided=${r.b.voided}`);

line('\n  4. Jalur BUKTI terikat-transaksi (yang dipakai aplikasi kasir offline)');
// Klien menyimpan pinHash; buktinya sha256(pinHash:clientTxnId) — PIN apa adanya
// tidak pernah masuk antrian localStorage.
const pinHashMgr = hashPin('7788');
r = await post('/api/v1/sync/staff', { ...base, staff: [
  { ref: 'mgr-02', nama: 'Rudi Manajer', peran: 'MANAGER', pinHash: pinHashMgr },
]});
harus('daftarkan manajer kedua', r.s === 200, `${r.s}`);

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-g`, transactions: [mk(`${RUN}-RBV-2`)] });
harus('transaksi kedua dibuat', r.b.accepted === 1, `${r.s} accepted=${r.b.accepted}`);

const bukti = (txn) => crypto.createHash('sha256').update(`${pinHashMgr}:${txn}`).digest('hex');

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-h`,
  transactions: [mk(`${RUN}-RBV-2`, { paymentStatus:'CANCELLED', authorizedByRef:'mgr-02', authorizationProof: bukti(`${RUN}-RBV-LAIN`) })] });
harus('bukti untuk transaksi LAIN', r.s === 403 && r.b.error === 'INVALID_PIN', `${r.s} ${r.b.error || ''}`);

r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-rb-i`,
  transactions: [mk(`${RUN}-RBV-2`, { paymentStatus:'CANCELLED', authorizedByRef:'mgr-02', authorizationProof: bukti(`${RUN}-RBV-2`) })] });
harus('bukti terikat transaksi yang benar', r.s === 200 && r.b.voided === 1, `${r.s} voided=${r.b.voided}`);

line('\n  5. Kunci idempotensi TIDAK boleh bocor antar merchant');
const lain = { businessId: `own-lain_${RUN}_FNB`, sector: 'FNB', storeName: 'Toko Lain' };
r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-tabrakan-1`, transactions: [mk(`${RUN}-X-1`)] });
harus('merchant A pakai kunci "tabrakan-1"', r.b.accepted === 1, `${r.s} accepted=${r.b.accepted}`);
r = await post('/api/v1/sync/transactions', { ...lain, idempotencyKey: `${RUN}-tabrakan-1`, transactions: [mk(`${RUN}-X-2`)] });
harus('merchant B pakai kunci SAMA', r.b.replayed === false && r.b.accepted === 1,
  `${r.s} replayed=${r.b.replayed} accepted=${r.b.accepted}`);
r = await post('/api/v1/sync/transactions', { ...base, idempotencyKey: `${RUN}-tabrakan-1`, transactions: [mk(`${RUN}-X-1`)] });
harus('merchant A kirim ulang -> replay', r.b.replayed === true, `${r.s} replayed=${r.b.replayed}`);

line(gagal === 0 ? '\n  >>> LULUS: otorisasi ditegakkan server, PIN tidak masuk antrian, idempotensi per tenant.\n' : `\n  >>> ${gagal} pemeriksaan GAGAL.\n`);
process.exit(gagal === 0 ? 0 : 1);
