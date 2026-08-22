/**
 * Tabel izin di perangkat dan tabel izin di database harus sama.
 *
 * Aplikasi kasir offline-first: pemeriksaan izin terjadi di perangkat, dari
 * src/data/rolePermissions.ts, karena kasir yang kehilangan internet tetap harus
 * bisa melayani. Servernya punya salinannya sendiri di pos.role_permissions,
 * yang dipakai saat ada yang menembus langsung ke endpoint.
 *
 * Dua salinan berarti dua kesempatan untuk menyimpang, dan menyimpangnya tidak
 * berisik: yang terjadi bukan galat, melainkan kasir yang bisa melakukan sesuatu
 * di layar yang ditolak servernya — atau lebih buruk, sebaliknya. Berkas ini
 * yang membuat perbedaan itu berbunyi.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { ADA_DB, db, tutupDb } from './helper-db';
import { ROLE_PERMISSIONS } from '../src/data/rolePermissions';

const d = describe.skipIf(!ADA_DB);

d('izin peran: berkas klien vs pos.role_permissions', () => {
  afterAll(tutupDb);

  it('katalog izinnya sama persis', async () => {
    const { rows } = await db().query('SELECT code FROM pos.permissions');
    const diDb = new Set(rows.map((r) => r.code as string));
    const diKlien = new Set(Object.values(ROLE_PERMISSIONS).flat());

    // Izin yang hanya ada di klien tidak pernah bisa ditegakkan server; izin
    // yang hanya ada di server tidak pernah bisa diberikan lewat layar mana pun.
    expect([...diKlien].filter((c) => !diDb.has(c))).toEqual([]);
    expect([...diDb].filter((c) => !diKlien.has(c))).toEqual([]);
  });

  it('setiap peran memberi izin yang sama di kedua tempat', async () => {
    const { rows } = await db().query(
      `SELECT role_code, array_agg(permission_code ORDER BY permission_code) AS izin
         FROM pos.role_permissions GROUP BY role_code`
    );
    const diDb = new Map(rows.map((r) => [r.role_code as string, (r.izin as string[])]));

    for (const [peran, izin] of Object.entries(ROLE_PERMISSIONS)) {
      expect(diDb.has(peran), `peran ${peran} tidak ada di pos.roles`).toBe(true);
      expect([...izin].sort(), `izin ${peran} berbeda`).toEqual(diDb.get(peran));
    }
    // Dan tidak ada peran di database yang tidak dikenali aplikasi kasir.
    for (const peran of diDb.keys()) {
      expect(Object.keys(ROLE_PERMISSIONS)).toContain(peran);
    }
  });

  it('MANAGER tidak bisa mengubah langganan, ADMIN bisa', async () => {
    // Bukan sekadar mengulang tabel di atas: ini yang membedakan kedua peran.
    // Sebelum 0033 daftarnya identik, dan menurunkan orang dari Admin ke
    // Manajer tidak mencabut apa pun.
    const { rows } = await db().query(
      `SELECT role_code FROM pos.role_permissions
        WHERE permission_code = 'billing_subscription' ORDER BY role_code`
    );
    expect(rows.map((r) => r.role_code)).toEqual(['ADMIN']);
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('billing_subscription');
    expect(ROLE_PERMISSIONS.ADMIN).toContain('billing_subscription');
  });
});
