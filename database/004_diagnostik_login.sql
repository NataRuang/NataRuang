-- ============================================================
-- NATARUANG — Diagnostik & Perbaikan Akun Staff
-- ============================================================
-- Jalankan bagian per bagian di Supabase SQL Editor (bukan sekaligus),
-- baca hasilnya dulu sebelum lanjut ke bagian berikutnya.
-- ============================================================


-- ============================================================
-- BAGIAN 1 — DIAGNOSIS: bandingkan auth.users vs staff_profiles
-- ============================================================
-- Jalankan ini dulu. Lihat kolom "status_id":
--   ✅ COCOK        → UUID sudah sama, masalah kemungkinan di password/email confirm
--   ❌ TIDAK COCOK   → UUID beda, ini penyebab "Login Auth berhasil tapi profil
--                      staff tidak ditemukan" → lanjut ke BAGIAN 2
--   profile_id NULL → belum ada row di staff_profiles sama sekali → lanjut BAGIAN 3
--   auth_user_id NULL → belum ada user di Supabase Auth sama sekali → buat dulu
--                        lewat Dashboard (Authentication → Users → Add user)

SELECT
  au.id                 AS auth_user_id,
  au.email              AS auth_email,
  au.email_confirmed_at,
  sp.id                 AS profile_id,
  sp.username,
  sp.role,
  sp.aktif,
  CASE
    WHEN au.id IS NULL THEN '⚠️ Belum ada user Auth'
    WHEN sp.id IS NULL THEN '⚠️ Belum ada profil staff'
    WHEN au.id = sp.id  THEN '✅ COCOK'
    ELSE '❌ TIDAK COCOK'
  END AS status_id
FROM auth.users au
FULL OUTER JOIN staff_profiles sp
  ON sp.username = split_part(au.email, '@', 1)
WHERE au.email LIKE '%@staff.nataruang.internal'
   OR sp.username IS NOT NULL
ORDER BY COALESCE(au.email, sp.username);


-- ============================================================
-- BAGIAN 2 — PERBAIKAN: UUID staff_profiles tidak sama dengan auth.users
-- ============================================================
-- Ganti 'admin' di bawah dengan username yang bermasalah.
-- Query ini otomatis menyamakan id di staff_profiles dengan id asli
-- dari auth.users berdasarkan email internalnya.

UPDATE staff_profiles
SET id = (
  SELECT id FROM auth.users
  WHERE email = 'admin@staff.nataruang.internal'   -- ganti sesuai username
)
WHERE username = 'admin';                            -- ganti sesuai username

-- Setelah ini, jalankan lagi query BAGIAN 1 — pastikan status_id jadi ✅ COCOK.


-- ============================================================
-- BAGIAN 3 — PERBAIKAN: profil staff belum ada sama sekali
-- ============================================================
-- Dipakai kalau di BAGIAN 1 "profile_id" NULL (user Auth sudah ada,
-- tapi belum pernah di-insert ke staff_profiles).

INSERT INTO staff_profiles (id, username, nama_lengkap, role, aktif)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'admin@staff.nataruang.internal'), -- ganti
  'admin',            -- username, harus sama persis dengan sebelum '@' di email
  'Nama Lengkap',      -- ganti dengan nama staff sesungguhnya
  'admin',             -- 'admin' | 'cs' | 'finance'
  TRUE
)
ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      role     = EXCLUDED.role,
      aktif    = TRUE;


-- ============================================================
-- BAGIAN 4 — PERBAIKAN: akun belum dikonfirmasi (Email not confirmed)
-- ============================================================
-- Dipakai kalau saat membuat user di Dashboard lupa mencentang
-- "Auto Confirm User". Ini menyamakan efeknya secara manual.

UPDATE auth.users
SET email_confirmed_at = now()
WHERE email = 'admin@staff.nataruang.internal'   -- ganti sesuai username
  AND email_confirmed_at IS NULL;


-- ============================================================
-- BAGIAN 5 — RESET PASSWORD (kalau lupa / salah set password)
-- ============================================================
-- TIDAK BISA lewat SQL Editor biasa (password di-hash oleh Supabase Auth).
-- Caranya lewat Dashboard:
--   Authentication → Users → klik user yang dimaksud → "..." → Reset Password
--   atau hapus & buat ulang usernya dengan password baru, lalu ulangi BAGIAN 2.
-- ============================================================


-- ============================================================
-- CARA LOGIN YANG BENAR (bukan lewat URL, harus lewat form di halaman)
-- ============================================================
-- 1. Buka https://nataruang.vercel.app/login.html
-- 2. Kolom "Username"  → isi:  admin            (bukan email, bukan URL param)
-- 3. Kolom "Password"  → isi:  PASSWORD ASLI yang ditentukan saat membuat user
--                               di Supabase Dashboard.
--    ⚠️ "admin@staff.nataruang.internal" itu EMAIL INTERNAL, BUKAN PASSWORD.
--       Jangan pernah diisi ke kolom Username atau Password.
-- 4. Klik tombol "Masuk"
-- ============================================================
