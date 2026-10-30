# Foto artikel dari perangkat

Admin → Blog → tambah/edit artikel menyediakan unggah foto sampul dan foto isi artikel. JPG, PNG, WebP maksimal 5 MB dikonversi ke JPEG dengan sisi maksimal 1600 px dan payload di bawah 650 KB sebelum dikirim. Foto isi disisipkan sebagai Markdown di akhir artikel; baris tersebut bisa dipindahkan ke paragraf yang diinginkan.

`POST /api/admin/blog/media` memakai autentikasi admin, Superadmin dan verifikasi MFA yang masih baru. Adapter R2 memakai credential server untuk bucket yang diprovisikan terlebih dahulu dan menerima JPEG maksimal 500.000 byte. Tidak ada izin unggah anonim. URL unik tidak menimpa gambar lain. Artikel menyimpan URL, bukan file/base64. Gunakan foto berizin tanpa informasi pribadi: file yang diunggah dapat dibaca publik bahkan sebelum artikel diterbitkan.

Simpan artikel menunggu konfirmasi server; kegagalan tidak menutup form. Mengedit artikel mempertahankan metadata sumber berita. Foto milik penulis tidak diberi label ilustrasi AI. Membatalkan editor atau mengganti sampul tidak menghapus file cloud sebelumnya secara otomatis; penghapusan aset memerlukan pemeriksaan referensi artikel terlebih dahulu.

Konfigurasi server: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_BASE_URL`. Jangan memakai awalan `VITE_*` untuk secret. Lihat [runbook R2](automation-r2-review.md). URL gambar lama tidak diubah.

Uji: `node --import tsx scripts/dev/test-blog-photo.ts` menggunakan Storage palsu dan guard admin nyata; tidak mengunggah atau mengubah artikel produksi.
