# Probe kesiapan produksi

Skrip di sini **membuktikan atau membantah** klaim kesiapan POS dengan
menjalankannya, bukan dengan membaca kode. Semuanya menulis ke database
pengembangan lokal dan tidak boleh diarahkan ke produksi.

```bash
# database bersih dulu
rm -rf .pgdata
npx tsx services/db-server/index.ts &
npx tsx services/db-server/migrate.ts

npm run audit:prod           # seluruh probe
```

| Probe | Menjawab |
|---|---|
| `t-concurrency.mjs` | Dua kasir menjual unit terakhir yang sama — bisakah stok jadi minus? |
| `t-acid.mjs` | Transaksi gagal di tengah — apakah mutasi stok ikut dibatalkan? |
| `t-presisi.mjs` | Diskon, pajak, dan kembalian — adakah pecahan rupiah atau galat floating-point? |
| `t-isolasi.mjs` | Bisakah pemilik A membaca atau menulis unit usaha pemilik B? |
| `t-rbac-tenant.mjs` | Apakah server menegakkan peran untuk void, atau hanya UI? (butuh pos-service menyala) |

Hasil pemeriksaan terakhir dan artinya ada di
[`docs/reverse-engineering/07-kesiapan-produksi.md`](../../../docs/reverse-engineering/07-kesiapan-produksi.md).
