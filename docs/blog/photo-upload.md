# Foto artikel dari perangkat

Admin → Blog → tambah/edit artikel menyediakan unggah foto sampul dan foto isi artikel. JPG, PNG, WebP maksimal 5 MB dikonversi ke JPEG dengan sisi maksimal 1600 px dan payload di bawah 650 KB sebelum dikirim. Foto isi disisipkan sebagai Markdown di akhir artikel; baris tersebut bisa dipindahkan ke paragraf yang diinginkan.

`POST /api/admin/blog/media` memakai autentikasi admin, Superadmin dan verifikasi MFA yang masih baru. Service role Supabase hanya digunakan di server. Bucket `blog-media` dibuat jika belum ada, bersifat publik, hanya menerima JPEG maksimal 500.000 byte. Tidak ada izin unggah anonim. URL unik tidak menimpa gambar lain. Artikel menyimpan URL, bukan file/base64. Gunakan foto berizin tanpa informasi pribadi: file yang diunggah dapat dibaca publik bahkan sebelum artikel diterbitkan.

Simpan artikel menunggu konfirmasi server; kegagalan tidak menutup form. Mengedit artikel mempertahankan metadata sumber berita. Foto milik penulis tidak diberi label ilustrasi AI. Membatalkan editor atau mengganti sampul tidak menghapus file cloud sebelumnya secara otomatis; penghapusan aset memerlukan pemeriksaan referensi artikel terlebih dahulu.

Konfigurasi server: `SUPABASE_URL` (atau `VITE_SUPABASE_URL`) dan `SUPABASE_SERVICE_ROLE_KEY`. Jangan menaruh service key pada variabel `VITE_*`. Bucket privat yang sudah ada tidak otomatis diubah menjadi publik; upload ditolak dengan pesan konfigurasi.

Uji: `node --import tsx scripts/dev/test-blog-photo.ts` menggunakan Storage palsu dan guard admin nyata; tidak mengunggah atau mengubah artikel produksi.
