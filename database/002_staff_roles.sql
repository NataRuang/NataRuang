-- ============================================================
-- NATARUANG — Migration 002: Sistem Akun Staff Multi-Role
-- (Admin / CS / Finance) dengan Login Berbasis Username
-- ============================================================
-- Jalankan file ini di Supabase SQL Editor SETELAH schema.sql.
-- Aman dijalankan ulang (idempotent) selama tabel belum ada isinya
-- yang bentrok dengan constraint di bawah.
-- ============================================================

-- ============================================================
-- 1. TABEL STAFF_PROFILES
-- ============================================================
-- Menyimpan identitas & role staff. Password TETAP disimpan oleh
-- Supabase Auth (auth.users) — tabel ini hanya metadata.
--
-- Login memakai USERNAME, bukan email. Di balik layar, username
-- dipetakan ke email semu berformat:
--     <username>@staff.nataruang.internal
-- Email ini TIDAK PERNAH dikirimi email sungguhan — hanya dipakai
-- sebagai identifier teknis oleh Supabase Auth.

CREATE TABLE IF NOT EXISTS staff_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  nama_lengkap  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'cs', 'finance')),
  aktif         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_.]{3,32}$')
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_role ON staff_profiles(role);

DROP TRIGGER IF EXISTS trg_staff_profiles_updated_at ON staff_profiles;
CREATE TRIGGER trg_staff_profiles_updated_at
  BEFORE UPDATE ON staff_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE staff_profiles IS
  'Metadata staff (Admin/CS/Finance). Password disimpan di auth.users, bukan di sini.';

-- ============================================================
-- 2. HELPER FUNCTIONS ROLE (dipakai di RLS seluruh database)
-- ============================================================
-- SECURITY DEFINER diperlukan supaya fungsi ini bisa membaca
-- staff_profiles tanpa terjebak rekursi RLS pada tabel itu sendiri.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE id = auth.uid() AND role = 'admin' AND aktif = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION is_cs()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE id = auth.uid() AND role = 'cs' AND aktif = TRUE
  );
$$;

CREATE OR REPLACE FUNCTION is_finance()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE id = auth.uid() AND role = 'finance' AND aktif = TRUE
  );
$$;

-- Staf manapun yang aktif (admin/cs/finance)
CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE id = auth.uid() AND aktif = TRUE
  );
$$;

-- Catatan: fungsi is_admin() di atas MENGGANTIKAN definisi lama di
-- schema.sql yang membaca auth.users.raw_app_meta_data. Karena semua
-- CREATE POLICY di schema.sql memanggil is_admin() by name (bukan inline),
-- seluruh kebijakan admin lama otomatis ikut memakai sumber role yang baru
-- tanpa perlu menulis ulang satu per satu.

-- ============================================================
-- 3. RLS — STAFF_PROFILES
-- ============================================================

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Baca profil staff (sendiri atau admin)" ON staff_profiles;
CREATE POLICY "Baca profil staff (sendiri atau admin)"
  ON staff_profiles FOR SELECT
  USING (id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Admin tambah akun staff" ON staff_profiles;
CREATE POLICY "Admin tambah akun staff"
  ON staff_profiles FOR INSERT
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin ubah akun staff" ON staff_profiles;
CREATE POLICY "Admin ubah akun staff"
  ON staff_profiles FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Admin hapus akun staff" ON staff_profiles;
CREATE POLICY "Admin hapus akun staff"
  ON staff_profiles FOR DELETE
  USING (is_admin());

-- ============================================================
-- 4. RLS TAMBAHAN — AKSES CS & FINANCE DI TABEL YANG SUDAH ADA
-- ============================================================
-- Tabel orders/order_items/payments sudah punya kebijakan publik
-- "USING (TRUE)" untuk SELECT (dipakai halaman status pesanan publik),
-- jadi CS & Finance yang login otomatis sudah bisa MEMBACA data itu.
-- Yang perlu ditambah hanyalah izin UPDATE sesuai tugas masing-masing.

-- ---- ORDERS: CS boleh update status & catatan pesanan ----
DROP POLICY IF EXISTS "CS update pesanan" ON orders;
CREATE POLICY "CS update pesanan"
  ON orders FOR UPDATE
  USING (is_cs())
  WITH CHECK (is_cs());

-- ---- PAYMENTS: Finance boleh verifikasi/kelola pembayaran ----
DROP POLICY IF EXISTS "Finance kelola pembayaran" ON payments;
CREATE POLICY "Finance kelola pembayaran"
  ON payments FOR UPDATE
  USING (is_finance())
  WITH CHECK (is_finance());

-- ---- PRODUCTS: Finance perlu lihat semua produk (termasuk nonaktif)
--      untuk keperluan laporan keuangan yang akurat ----
DROP POLICY IF EXISTS "Finance baca semua produk" ON products;
CREATE POLICY "Finance baca semua produk"
  ON products FOR SELECT
  USING (is_finance());

-- ---- AUDIT LOG: semua staff aktif boleh baca (transparansi internal) ----
DROP POLICY IF EXISTS "Staff baca audit log" ON audit_logs;
CREATE POLICY "Staff baca audit log"
  ON audit_logs FOR SELECT
  USING (is_staff());

-- ============================================================
-- 5. CARA MEMBUAT AKUN STAFF PERTAMA (MANUAL, VIA DASHBOARD)
-- ============================================================
-- Karena project ini murni JAMstack (tanpa backend/serverless
-- function), pembuatan user Supabase Auth TIDAK bisa dilakukan dari
-- browser (butuh service_role key yang tidak boleh ada di frontend).
-- Jadi pembuatan akun staff dilakukan manual oleh pemilik project:
--
-- LANGKAH:
-- 1. Buka Supabase Dashboard → Authentication → Users → Add user
--    Email     : <username>@staff.nataruang.internal
--    Password  : (tentukan password awal, sampaikan ke staff)
--    Auto Confirm User : ON (wajib dicentang, supaya tidak perlu verifikasi email)
--
-- 2. Salin User UID yang baru dibuat, lalu jalankan di SQL Editor:
--
--    INSERT INTO staff_profiles (id, username, nama_lengkap, role)
--    VALUES ('TEMPEL-UUID-DI-SINI', 'budi', 'Budi Santoso', 'admin');
--
--    -- role hanya boleh: 'admin' | 'cs' | 'finance'
--
-- 3. Staff login di /login.html memakai username "budi" (bukan email)
--    dan password yang ditentukan di langkah 1. Setelah login, staff
--    bisa ganti password sendiri lewat menu "Ganti Password" di dashboard.
-- ============================================================
