# Integrasi, API & MCP

Menu admin ini tersedia untuk Superadmin dengan capability `MANAGE_INTEGRATIONS`.
Guard server memverifikasi sesi Supabase, keanggotaan internal dan MFA. Perubahan
memerlukan verifikasi MFA dalam 10 menit terakhir serta alasan yang diaudit.

## MCP

- Endpoint: `https://kasir.newhope.space/api/mcp`; scope `pos:read`.
- ChatGPT/Claude memakai OAuth + PKCE. Owner menyetujui bisnis yang dapat dibaca.
- Admin melihat koneksi, status izin, penggunaan tools terakhir dan audit MCP.
- Admin dapat mencabut satu koneksi; tokennya tidak lagi diterima. Ini tidak
  menghapus data bisnis atau mengubah ledger.
- Jeda layanan disimpan di `internal.platform_integrations`. Worker MCP membaca
  switch setiap request, bukan dari cache proses. Owner tetap dapat melihat dan
  mencabut izin selama jeda. Request yang sudah berjalan sebelum jeda dapat selesai.
- `MCP_ENABLED=true` dan tabel MCP tetap diperlukan di deployment. Switch admin
  tidak dapat mengaktifkan deployment yang belum disiapkan.
- Penulisan settings memakai optimistic concurrency; admin dengan versi lama
  harus memuat ulang sebelum mengubahnya.

## API dan connector

Halaman API mendokumentasikan endpoint yang sudah tersedia beserta autentikasinya.
API POS/admin memakai JWT sesi; halaman ini **tidak menerbitkan API key global**.
Connector pihak ketiga menampilkan keberadaan konfigurasi server, bukan klaim
bahwa koneksi telah berhasil diuji. Secret dikelola melalui environment Vercel
dan dashboard penyedia; nilai secret, token maupun hash credential tidak dikirim
ke browser. Halaman ini tidak otomatis menghubungkan akun pihak ketiga.

API admin:

- `GET /api/admin/integrations?offset=0`: inventaris; koneksi dipaginasi 50,
  aktivitas dibatasi 30 terbaru; `Cache-Control: no-store`.
- `PUT /api/admin/integrations/mcp`: `{enabled,expectedUpdatedAt,reason}`.
- `POST /api/admin/integrations/mcp/connections/:id/revoke`: `{reason}`.

Migrasi `20261005013557_admin_integrations.sql` (mirror lokal `0058`) menambahkan
satu tabel private tanpa akses anon/authenticated. Tidak memigrasi atau menghapus
koneksi/credential dan tidak menyentuh data POS.

Uji terisolasi: `npm run test:admin-integrations`, `npm run test:mcp`.
