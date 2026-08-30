import { conn, line } from './probe.mjs';
const c = await conn();

// Dua pemilik berbeda, masing-masing satu unit usaha
for (const [own,biz,nama] of [['owner-A','owner-A_FNB','Kafe A'],['owner-B','owner-B_FNB','Kafe B']]) {
  const t=await c.query(`INSERT INTO internal.tenants (id,name,external_ref,owner_user_ref)
    VALUES (uuidv7(),$1,$2,$2) ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
    DO UPDATE SET name=EXCLUDED.name RETURNING id`,[nama,own]);
  await c.query(`INSERT INTO internal.merchants (id,tenant_id,name,business_sector,external_ref)
    VALUES (uuidv7(),$1,$2,'FNB',$3) ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL
    DO UPDATE SET name=EXCLUDED.name RETURNING id`,[t.rows[0].id,nama,biz]);
}

// Query PERSIS dari services/shared/auth.ts:canAccessBusiness
const canAccess = async (subject, businessId) => {
  const r = await c.query(
    `SELECT 1 FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE m.external_ref = $1 AND t.owner_user_ref = $2 LIMIT 1`, [businessId, subject]);
  return r.rows.length === 1;
};

// Query PERSIS dari services/pos/sync.ts:assertBusinessCanBeClaimed
const canClaim = async (subject, businessId) => {
  const r = await c.query(
    `SELECT t.owner_user_ref FROM internal.merchants m
       JOIN internal.tenants t ON t.id = m.tenant_id
      WHERE m.external_ref = $1 LIMIT 1`, [businessId]);
  if (r.rows.length && r.rows[0].owner_user_ref !== subject) return false;
  return true;
};

line('\n  canAccessBusiness (baca AI/admin):');
for (const [s,b] of [['owner-A','owner-A_FNB'],['owner-A','owner-B_FNB'],['owner-B','owner-A_FNB'],['penyusup','owner-A_FNB']]) {
  const ok = await canAccess(s,b);
  line(`     ${s.padEnd(10)} -> ${b.padEnd(14)} ${ok?'BOLEH':'ditolak'} ${s!=='owner-'+b[6]&&ok?'  <-- BOCOR':''}`);
}

line('\n  assertBusinessCanBeClaimed (tulis sync):');
for (const [s,b] of [['owner-A','owner-A_FNB'],['owner-A','owner-B_FNB'],['penyusup','owner-A_FNB'],['penyusup','biz-baru_FNB']]) {
  const ok = await canClaim(s,b);
  line(`     ${s.padEnd(10)} -> ${b.padEnd(14)} ${ok?'BOLEH':'ditolak'}`);
}
line('\n  Catatan: unit usaha yang BELUM ADA selalu boleh diklaim — itu memang');
line('  jalur pendaftaran merchant baru lewat sinkronisasi pertama.');
await c.end();
