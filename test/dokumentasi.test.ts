/**
 * Dokumentasi harus menyebut apa yang benar-benar ada.
 *
 * docs/erd.md sempat menyatakan "27 tabel dan 19 view kontrak" ketika yang ada
 * 35 dan 30, dan masih memakai entitas `tenants` yang diganti nama pada 0025 —
 * delapan tabel hilang dari diagramnya, termasuk seluruh tulang punggung
 * peristiwa dan ledger.
 *
 * Dokumentasi yang salah lebih berbahaya daripada dokumentasi yang tidak ada:
 * yang tidak ada membuat orang membaca kode, yang salah membuat orang percaya.
 * Dan itu tidak pernah menimbulkan galat — ia hanya semakin jauh dari
 * kenyataan setiap kali ada migrasi baru.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADA_DB, db, tutupDb } from './helper-db';

const d = describe.skipIf(!ADA_DB);

const baca = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

d('dokumentasi sesuai skema', () => {
  afterAll(tutupDb);

  const erd = baca('docs/erd.md');
  const dfd = baca('Dokumentasi.md');

  it('setiap tabel disebut di docs/erd.md', async () => {
    const { rows } = await db().query(
      `SELECT table_schema AS s, table_name AS t
         FROM information_schema.tables
        WHERE table_schema IN ('pos','billing','ai','internal')
          AND table_type = 'BASE TABLE'
        ORDER BY 1, 2`
    );
    const hilang = rows
      .filter((r: any) => !new RegExp(`\\b${r.t}\\b`).test(erd))
      .map((r: any) => `${r.s}.${r.t}`);
    expect(hilang, `tabel tidak disebut di docs/erd.md: ${hilang.join(', ')}`).toEqual([]);
  });

  it('jumlah tabel dan view yang tertulis di erd.md benar', async () => {
    const { rows: t } = await db().query(
      `SELECT COUNT(*)::int n FROM information_schema.tables
        WHERE table_schema IN ('pos','billing','ai','internal') AND table_type='BASE TABLE'`
    );
    const { rows: v } = await db().query(
      `SELECT COUNT(*)::int n FROM information_schema.views WHERE table_schema='contract'`
    );
    // Angka pembuka erd.md, mis. "**35 tabel dan 30 view kontrak".
    const cocok = erd.match(/\*\*(\d+) tabel dan (\d+) view kontrak/);
    expect(cocok, 'baris jumlah tabel/view tidak ditemukan di erd.md').not.toBeNull();
    expect(Number(cocok![1])).toBe(t[0].n);
    expect(Number(cocok![2])).toBe(v[0].n);
  });

  it('neraca store di Dokumentasi.md cocok dengan jumlah tabel per skema', async () => {
    const { rows } = await db().query(
      `SELECT table_schema AS s, COUNT(*)::int n
         FROM information_schema.tables
        WHERE table_schema IN ('pos','billing','ai','internal') AND table_type='BASE TABLE'
        GROUP BY 1`
    );
    const per = Object.fromEntries(rows.map((r: any) => [r.s, r.n]));

    // Baris tabel neraca: | `D1` pos | ... | ... | 19 |
    for (const [skema, jumlah] of Object.entries(per)) {
      const pola = new RegExp(`\\|\\s*\`D\\d\`\\s*${skema}\\s*\\|[^|]*\\|[^|]*\\|\\s*(\\d+)\\s*\\|`);
      const cocok = dfd.match(pola);
      expect(cocok, `baris neraca untuk skema ${skema} tidak ditemukan`).not.toBeNull();
      expect(Number(cocok![1]), `jumlah tabel ${skema}`).toBe(jumlah);
    }

    const total = Object.values(per).reduce((a, b) => a + (b as number), 0);
    expect(dfd).toContain(`**Total ${total} tabel.**`);
  });

  it('setiap view kontrak disebut di salah satu dokumen', async () => {
    const { rows } = await db().query(
      `SELECT table_name AS v FROM information_schema.views
        WHERE table_schema='contract' ORDER BY 1`
    );
    const gabungan = erd + '\n' + dfd;
    const hilang = rows
      .filter((r: any) => !new RegExp(`\\b${r.v}\\b`).test(gabungan))
      .map((r: any) => r.v);
    expect(hilang, `view kontrak tidak disebut di dokumen mana pun: ${hilang.join(', ')}`).toEqual([]);
  });

  it('contract TIDAK digambarkan sebagai data store', () => {
    // Poin pemodelan yang paling sering keliru dibaca, dan yang membuat Level 1
    // dan Level 2 tidak pernah bisa diseimbangkan kalau salah.
    expect(dfd).toContain('`contract` BUKAN data store');
    expect(dfd).toMatch(/single source of truth.*keliru|keliru.*single source of truth/is);
    // Tidak boleh ada Dn yang menunjuk contract.
    expect(dfd).not.toMatch(/D\d[^\n]*·\s*contract/);
  });

  it('setiap proses Level 1 punya rincian Level 2', () => {
    const l1 = [...dfd.matchAll(/\bP(\d)\s*·/g)].map((m) => m[1]);
    const unik = [...new Set(l1)].sort();
    expect(unik.length).toBeGreaterThanOrEqual(5);
    for (const n of unik) {
      expect(dfd, `P${n} tidak punya bagian Level 2`).toMatch(
        new RegExp(`## Level 2 — P${n} ·`)
      );
    }
  });
});
