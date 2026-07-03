-- ============================================================
-- NATARUANG — Migration 007: Perbaikan Keamanan View (RLS Bypass)
-- ============================================================
-- Jalankan SETELAH schema.sql, 002, 003, 005, 006.
-- Aman dijalankan ulang (idempotent).
--
-- MASALAH:
-- Secara default, VIEW di Postgres dieksekusi dengan hak akses
-- PEMBUATNYA (biasanya superuser/owner yang bisa bypass RLS),
-- BUKAN hak akses pengguna yang men-query. Karena view TIDAK BISA
-- diberi RLS langsung (RLS hanya berlaku di tabel), semua view yang
-- kita buat SEBELUM migration ini berpotensi membocorkan data di luar
-- kebijakan RLS tabel aslinya kalau diakses langsung lewat REST API
-- Supabase (bukan cuma lewat aplikasi).
--
-- Temuan konkret: v_produk_paling_dilihat menggabungkan product_views
-- (RLS: admin-only) — tanpa perbaikan ini, SIAPA SAJA dengan anon key
-- bisa membaca data analitik admin lewat view tsb.
--
-- PERBAIKAN:
-- PostgreSQL 15+ (Supabase sudah di versi ini) mendukung opsi view
-- `security_invoker = true`, yang membuat view dieksekusi dengan hak
-- akses PEMANGGIL (bukan pembuat) — sehingga RLS tabel di baliknya
-- benar-benar berlaku. Migration ini DROP + CREATE ULANG semua view
-- yang ada dengan opsi tsb.
-- ============================================================

DROP VIEW IF EXISTS v_produk_paling_dilihat;
CREATE VIEW v_produk_paling_dilihat
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.nama,
  p.kode_produk,
  p.harga_jual,
  p.view_count                               AS total_views_all,
  COUNT(pv.id)                               AS views_7hari,
  (SELECT url_watermarked FROM product_images
    WHERE product_id = p.id AND is_primary = TRUE LIMIT 1) AS foto_url
FROM products p
LEFT JOIN product_views pv
  ON pv.product_id = p.id
  AND pv.viewed_at >= NOW() - INTERVAL '7 days'
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.nama, p.kode_produk, p.harga_jual, p.view_count
ORDER BY views_7hari DESC, total_views_all DESC
LIMIT 20;

DROP VIEW IF EXISTS v_produk_terlaris;
CREATE VIEW v_produk_terlaris
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.nama,
  p.kode_produk,
  p.harga_jual,
  p.order_count                              AS total_qty_all,
  COALESCE(SUM(oi.qty), 0)                  AS qty_30hari,
  COALESCE(COUNT(DISTINCT oi.order_id), 0)  AS jumlah_pesanan_30hari,
  (SELECT url_watermarked FROM product_images
    WHERE product_id = p.id AND is_primary = TRUE LIMIT 1) AS foto_url
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN orders o ON o.id = oi.order_id
  AND o.status NOT IN ('dibatalkan','ditolak')
  AND o.created_at >= NOW() - INTERVAL '30 days'
  AND o.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.nama, p.kode_produk, p.harga_jual, p.order_count
ORDER BY qty_30hari DESC, total_qty_all DESC
LIMIT 20;

DROP VIEW IF EXISTS v_ringkasan_penjualan_harian;
CREATE VIEW v_ringkasan_penjualan_harian
WITH (security_invoker = true) AS
SELECT
  DATE(o.created_at)        AS tanggal,
  COUNT(*)                  AS jumlah_pesanan,
  SUM(o.total)              AS total_pendapatan,
  SUM(CASE WHEN o.status = 'lunas' THEN o.total ELSE 0 END) AS pendapatan_lunas
FROM orders o
WHERE o.deleted_at IS NULL
  AND o.created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(o.created_at)
ORDER BY tanggal ASC;

DROP VIEW IF EXISTS v_ringkasan_penjualan_bulanan;
CREATE VIEW v_ringkasan_penjualan_bulanan
WITH (security_invoker = true) AS
SELECT
  TO_CHAR(o.created_at, 'YYYY-MM')  AS bulan,
  COUNT(*)                           AS jumlah_pesanan,
  SUM(o.total)                       AS total_pendapatan,
  SUM(CASE WHEN o.status = 'lunas' THEN o.total ELSE 0 END) AS pendapatan_lunas,
  COUNT(CASE WHEN o.status = 'lunas' THEN 1 END)            AS pesanan_lunas,
  COUNT(CASE WHEN o.status = 'ditolak' THEN 1 END)          AS pesanan_ditolak
FROM orders o
WHERE o.deleted_at IS NULL
GROUP BY TO_CHAR(o.created_at, 'YYYY-MM')
ORDER BY bulan DESC;

DROP VIEW IF EXISTS v_dashboard_summary;
CREATE VIEW v_dashboard_summary
WITH (security_invoker = true) AS
SELECT
  (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL)          AS total_produk,
  (SELECT COUNT(*) FROM orders   WHERE deleted_at IS NULL)          AS total_pesanan,
  (SELECT COUNT(*) FROM orders   WHERE status='menunggu_verifikasi'
                                   AND deleted_at IS NULL)          AS menunggu_verifikasi,
  (SELECT COALESCE(SUM(total),0) FROM orders
    WHERE status='lunas' AND deleted_at IS NULL)                    AS total_pendapatan,
  (SELECT COALESCE(SUM(total),0) FROM orders
    WHERE status='lunas'
      AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
      AND deleted_at IS NULL)                                       AS pendapatan_bulan_ini,
  (SELECT COUNT(*) FROM orders
    WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
      AND deleted_at IS NULL)                                       AS pesanan_bulan_ini;

DROP VIEW IF EXISTS v_kartu_stok;
CREATE VIEW v_kartu_stok
WITH (security_invoker = true) AS
SELECT
  sp.id, sp.product_id, p.nama AS nama_produk, p.kode_produk,
  sp.gudang_id, g.nama_gudang,
  sp.tipe, sp.arah, sp.qty, sp.harga_satuan, sp.hpp_total,
  sp.status, sp.keterangan, sp.referensi_tabel, sp.referensi_id,
  sd.nama_lengkap AS diajukan_oleh_nama,
  sa.nama_lengkap AS disetujui_oleh_nama,
  sp.disetujui_at, sp.catatan_approval, sp.created_at
FROM stok_pergerakan sp
JOIN products p        ON p.id = sp.product_id
JOIN gudang g           ON g.id = sp.gudang_id
LEFT JOIN staff_profiles sd ON sd.id = sp.diajukan_oleh
LEFT JOIN staff_profiles sa ON sa.id = sp.disetujui_oleh;

-- ============================================================
-- Verifikasi manual (opsional) — jalankan setelah migration ini:
--
--   SELECT relname, reloptions FROM pg_class
--   WHERE relname LIKE 'v\_%' AND relkind = 'v';
--
-- Kolom reloptions pada tiap baris harus memuat "security_invoker=true".
-- ============================================================
