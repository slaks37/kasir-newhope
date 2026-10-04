-- Koreksi konten seed blog dari 0042.
--   1. Video placeholder (bukan konten New Hope) yang diberi keterangan "tutorial"/"demo".
--   2. Artikel QRIS menyatakan kasir mendeteksi lunas otomatis. Kasir saat ini memakai
--      QRIS statis milik toko; QRIS dinamis + webhook belum dibangun.
-- Setiap UPDATE dijaga oleh teks seed aslinya: artikel yang sudah diedit admin tidak tersentuh.
DO $$
BEGIN
  IF to_regclass('public.blog_posts') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.blog_posts
     SET media_embeds = COALESCE((
           SELECT jsonb_agg(embed)
             FROM jsonb_array_elements(media_embeds) AS embed
            WHERE embed->>'url' NOT IN ('https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                                        'https://www.tiktok.com/@tiktok/video/7106594312292453678')), '[]'::jsonb),
         updated_at = now()
   WHERE media_embeds::text LIKE '%dQw4w9WgXcQ%'
      OR media_embeds::text LIKE '%@tiktok/video/7106594312292453678%';

  UPDATE public.blog_posts
     SET excerpt = 'Kupas tuntas perbedaan QRIS Dinamis dan QRIS Statis stiker meja, serta cara mencatat pembayaran QRIS dengan rapi di kasir.',
         updated_at = now()
   WHERE id = 'blog-3' AND excerpt LIKE '%otomatis cair H+1%';

  UPDATE public.blog_posts
     SET seo = seo || jsonb_build_object(
           'metaDescription', 'Apa beda QRIS stiker dan QRIS Dinamis untuk kasir UMKM? Simak perbandingannya dan cara mencegah penipuan bukti bayar palsu.',
           'metaKeywords', jsonb_build_array('qris dinamis', 'pembayaran digital umkm', 'kasir qris', 'new hope pos payment')),
         updated_at = now()
   WHERE id = 'blog-3' AND seo->>'metaDescription' LIKE '%rekonsiliasi instan%';

  UPDATE public.blog_posts
     SET content = replace(content, $seed$## ✅ Keunggulan QRIS Dinamis di New Hope POS:
- **Nominal Otomatis:** Barcode QR di layar kasir sudah berisi total tagihan.
- **Deteksi Otomatis Real-time:** Begitu bayar, layar kasir langsung berubah menjadi LUNAS.
- **Struk Kasir Langsung Tercetak.**$seed$, $fix$## ✅ Keunggulan QRIS Dinamis:
- **Nominal Otomatis:** QR di layar kasir sudah berisi total tagihan, jadi pelanggan tidak mengetik nominal.
- **Konfirmasi dari Penyedia Pembayaran:** Status lunas datang dari payment gateway, bukan dari tangkapan layar pelanggan.
- **Butuh Integrasi:** QRIS Dinamis memerlukan kerja sama dengan payment gateway, dan biaya MDR tetap berlaku.

---

## 📌 Di New Hope POS saat ini
New Hope POS mendukung **QRIS statis milik toko**. Kasir mengonfirmasi dana masuk, lalu mencatat nomor referensi (RRN) di transaksi. Rekap shift memisahkan penjualan tunai dan QRIS. QRIS Dinamis dengan deteksi lunas otomatis **belum tersedia** dan ada di peta jalan produk.$fix$),
         updated_at = now()
   WHERE id = 'blog-3' AND content LIKE '%Keunggulan QRIS Dinamis di New Hope POS%';
END $$;
