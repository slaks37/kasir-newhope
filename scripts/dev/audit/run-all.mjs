#!/usr/bin/env node
/**
 * Menjalankan seluruh probe kesiapan produksi secara berurutan.
 *
 * Sengaja TIDAK berhenti pada probe yang gagal: tujuannya memotret keadaan
 * secara utuh, bukan berhenti di temuan pertama.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const probes = [
  ['Konkurensi & overselling', 't-concurrency.mjs'],
  ['ACID & rollback', 't-acid.mjs'],
  ['Presisi finansial', 't-presisi.mjs'],
  ['Isolasi tenant', 't-isolasi.mjs'],
  // Butuh pos-service menyala di :3101 — dilewati dengan pesan jelas bila tidak.
  ['Otorisasi void & idempotensi', 't-rbac.mjs'],
  ['Konflik katalog antar perangkat', 't-katalog.mjs'],
  ['Kelengkapan laporan merchant', 't-laporan.mjs'],
];

let gagal = 0;
for (const [judul, berkas] of probes) {
  console.log(`\n${'='.repeat(74)}\n  ${judul}\n${'='.repeat(74)}`);
  const r = spawnSync('npx', ['tsx', join(here, berkas)], { stdio: 'inherit' });
  if (r.status !== 0) gagal++;
}

console.log(`\n${'='.repeat(74)}`);
console.log(gagal === 0 ? '  Seluruh probe selesai dijalankan.' : `  ${gagal} probe berhenti dengan error.`);
console.log('  Catatan: "selesai" berarti probe BERJALAN — bukan berarti hasilnya baik.');
console.log('  Baca keluarannya; beberapa probe memang dirancang menunjukkan cacat.');
console.log(`${'='.repeat(74)}\n`);
