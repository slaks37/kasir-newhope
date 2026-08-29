-- =============================================================================
-- 0038_server_side_pin_authorization.sql
--
-- Memindahkan Step-Up Authorization (PIN Manager) dari browser ke server.
--
-- MASALAH YANG DITUTUP
--
-- Sebelum ini, seluruh otorisasi PIN berjalan di perangkat kasir:
--   * PIN dibandingkan di browser terhadap daftar user di localStorage.
--   * Penghitung percobaan gagal juga disimpan di localStorage, sehingga
--     `localStorage.removeItem('newhope_pin_security_state')` mereset lockout.
--     PIN 4 digit hanya 10.000 kemungkinan — tanpa lockout, habis dalam detik.
--   * internal.memberships.pin menyimpan PIN sebagai TEKS POLOS, defaultnya
--     '1234'.
--
-- Artinya VOID transaksi, ubah harga, dan bill House Use dijaga oleh
-- pemeriksaan yang bisa dilewati siapa pun yang bisa membuka DevTools.
--
-- YANG DIBAWA MIGRASI INI
--   1. internal.memberships.pin_hash — hash PBKDF2 (services/shared/pinKdf.ts).
--      Kolom `pin` lama TIDAK dihapus di sini; ia dikosongkan sendiri saat
--      verifikasi pertama yang berhasil (upgrade-on-verify), supaya tidak ada
--      staf yang tiba-tiba terkunci saat rilis.
--   2. pos.pin_attempts — penghitung kegagalan dan lockout MILIK SERVER.
--   3. contract.pin_lockout_status — permukaan baca untuk backoffice.
--
-- Idempoten, aman diulang.
-- =============================================================================


-- 1. HASH PIN DI BIDANG IDENTITAS ---------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'internal' AND table_name = 'memberships'
                      AND column_name = 'pin_hash') THEN
        ALTER TABLE internal.memberships ADD COLUMN pin_hash VARCHAR(255);
    END IF;

    -- Kapan PIN terakhir diganti. Dipakai kebijakan rotasi, dan berguna saat
    -- menelusuri "sejak kapan PIN ini berlaku" pada investigasi selisih kas.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'internal' AND table_name = 'memberships'
                      AND column_name = 'pin_updated_at') THEN
        ALTER TABLE internal.memberships ADD COLUMN pin_updated_at TIMESTAMPTZ;
    END IF;
END $$;

COMMENT ON COLUMN internal.memberships.pin_hash IS
    'Hash PBKDF2-HMAC-SHA256 (format pbkdf2$iterasi$salt$hash). Diisi pos-service; tidak pernah dikirim ke browser.';

COMMENT ON COLUMN internal.memberships.pin IS
    'USANG — teks polos warisan. Dikosongkan otomatis saat verifikasi pertama yang berhasil memindahkannya ke pin_hash. Jangan dipakai untuk otorisasi baru.';


-- 2. PENGHITUNG PERCOBAAN & LOCKOUT MILIK SERVER ------------------------------
--
-- Kuncinya (merchant_id, terminal_key). terminal_key adalah subject sesi yang
-- sudah diverifikasi gateway — bukan sesuatu yang dipilih browser — sehingga
-- membuka tab baru, mode penyamaran, atau membersihkan localStorage tidak
-- menghapus riwayat kegagalan siapa pun.

CREATE TABLE IF NOT EXISTS pos.pin_attempts (
    id                     UUID PRIMARY KEY DEFAULT uuidv7(),
    tenant_id              UUID NOT NULL REFERENCES internal.tenants(id) ON DELETE CASCADE,
    merchant_id            UUID NOT NULL REFERENCES internal.merchants(id) ON DELETE CASCADE,
    outlet_id              UUID REFERENCES internal.outlets(id) ON DELETE SET NULL,

    terminal_key           VARCHAR(200) NOT NULL,

    consecutive_failures   INT NOT NULL DEFAULT 0,
    lockout_count          INT NOT NULL DEFAULT 0,
    locked_until           TIMESTAMPTZ,
    last_failure_at        TIMESTAMPTZ,
    last_success_at        TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_pin_attempt_terminal UNIQUE (merchant_id, terminal_key),
    CONSTRAINT chk_pin_attempt_failures CHECK (consecutive_failures >= 0)
);

CREATE INDEX IF NOT EXISTS idx_pin_attempts_locked
    ON pos.pin_attempts(merchant_id, locked_until) WHERE locked_until IS NOT NULL;

COMMENT ON TABLE pos.pin_attempts IS
    'Penghitung kegagalan PIN dan lockout, dipegang server. Menggantikan penghitung localStorage yang bisa direset dari DevTools.';


-- 3. PERMUKAAN BACA LINTAS DOMAIN ---------------------------------------------

DROP VIEW IF EXISTS contract.pin_lockout_status CASCADE;
CREATE VIEW contract.pin_lockout_status AS
SELECT
    a.tenant_id,
    a.merchant_id,
    m.name                                            AS merchant_name,
    a.outlet_id,
    o.name                                            AS outlet_name,
    a.terminal_key,
    a.consecutive_failures,
    a.lockout_count,
    a.locked_until,
    (a.locked_until IS NOT NULL AND a.locked_until > CURRENT_TIMESTAMP) AS is_locked,
    a.last_failure_at,
    a.last_success_at
  FROM pos.pin_attempts a
  JOIN internal.merchants m ON m.id = a.merchant_id
  LEFT JOIN internal.outlets o ON o.id = a.outlet_id;

COMMENT ON VIEW contract.pin_lockout_status IS
    'Terminal mana yang sedang terkunci dan berapa kali gagal. Lonjakan kegagalan pada satu merchant adalah sinyal penyalahgunaan yang layak dilihat backoffice.';


-- 4. HAK AKSES -----------------------------------------------------------------

DO $$
DECLARE
    svc TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'svc_pos') THEN
        GRANT SELECT, INSERT, UPDATE ON pos.pin_attempts TO svc_pos;
        -- pos-service memverifikasi PIN, jadi ia perlu membaca hash-nya dan
        -- menulis balik hasil upgrade format.
        GRANT SELECT, UPDATE ON internal.memberships TO svc_pos;
    END IF;

    FOREACH svc IN ARRAY ARRAY['svc_pos', 'svc_internal'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('GRANT SELECT ON contract.pin_lockout_status TO %I', svc);
        END IF;
    END LOOP;

    -- Hash PIN tidak pernah boleh dibaca klien anonim/publik.
    FOREACH svc IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = svc) THEN
            EXECUTE format('REVOKE ALL ON internal.memberships, pos.pin_attempts FROM %I', svc);
        END IF;
    END LOOP;
END $$;
