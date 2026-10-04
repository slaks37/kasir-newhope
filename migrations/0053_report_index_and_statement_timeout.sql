-- Laporan dan view contract.merchant_revenue menghitung HPP per transaksi
-- (`WHERE i.transaction_id = x.id`). Satu-satunya index yang ada bersifat
-- parsial (client_item_id IS NOT NULL) sehingga planner memindai SELURUH
-- pos.transaction_items (semua tenant) untuk setiap transaksi. Diukur pada
-- 100k transaksi / 250k item: laporan "hari ini" 20,8 dtk -> 88 ms dengan
-- angka omzet/HPP identik.
--
-- Produksi dengan tabel besar: jalankan versi CONCURRENTLY secara manual
-- lebih dulu agar tidak mengunci tulis, lalu migrasi ini menjadi no-op:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_items_transaction
--     ON pos.transaction_items (transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction
  ON pos.transaction_items (transaction_id);

-- Batas waktu default untuk peran service. Request yang ditinggal klien
-- (gateway 10 dtk) tidak boleh meninggalkan query yang terus berjalan.
-- db.tx juga memasang SET LOCAL statement_timeout per transaksi.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['svc_pos','svc_ai','svc_billing','svc_internal','svc_backoffice'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      BEGIN
        EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r, '8s');
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '0053: tidak berhak mengubah peran % (lewati)', r;
      END;
    END IF;
  END LOOP;
END $$;
