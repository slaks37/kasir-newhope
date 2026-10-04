-- Sinkronisasi transaksi kini menerima/menolak PER penjualan. Receipt
-- idempotensi menyimpan daftar yang ditolak/dinomori ulang agar replay setelah
-- ACK hilang memberi jawaban yang sama persis (tidak ada penjualan yang
-- dianggap terkirim padahal ditolak).
ALTER TABLE pos.sync_receipts
  ADD COLUMN IF NOT EXISTS outcomes jsonb NOT NULL DEFAULT '{"rejected":[],"renumbered":[]}'::jsonb;
