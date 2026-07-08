-- Migration: Program Member Otomatis
-- Syarat: pelanggan otomatis jadi member jika sudah pernah bertransaksi (status lunas/dikirim/selesai)
--   >= N kali TRANSAKSI, ATAU membeli >= N JENIS PRODUK berbeda (N bisa diatur admin lewat Pengaturan).
-- Aman dijalankan berkali-kali (idempotent).

-- 1. Pengaturan baru
INSERT INTO store_settings (key, value, keterangan) VALUES
  ('member_syarat_transaksi', '5',  'Jumlah transaksi berhasil minimal untuk jadi member otomatis'),
  ('member_syarat_produk',    '5',  'Jumlah jenis produk berbeda minimal untuk jadi member otomatis'),
  ('member_diskon_persen',    '10', 'Persentase diskon otomatis untuk member (dari subtotal)')
ON CONFLICT (key) DO NOTHING;

-- 2. Fungsi cek status member
-- Dipanggil dari frontend (checkout) dengan nomor WA pembeli untuk cek apakah dia sudah
-- memenuhi syarat member, sekaligus dapat berapa diskon yang berhak dia terima.
CREATE OR REPLACE FUNCTION cek_status_member(p_nomor_wa VARCHAR)
RETURNS TABLE (
  total_transaksi    INT,
  total_produk_unik  INT,
  is_member          BOOLEAN,
  diskon_persen      NUMERIC,
  syarat_transaksi   INT,
  syarat_produk      INT
) AS $$
DECLARE
  v_syarat_transaksi INT;
  v_syarat_produk    INT;
  v_diskon           NUMERIC;
BEGIN
  SELECT COALESCE((SELECT value FROM store_settings WHERE key = 'member_syarat_transaksi'), '5')::INT INTO v_syarat_transaksi;
  SELECT COALESCE((SELECT value FROM store_settings WHERE key = 'member_syarat_produk'),    '5')::INT INTO v_syarat_produk;
  SELECT COALESCE((SELECT value FROM store_settings WHERE key = 'member_diskon_persen'),    '10')::NUMERIC INTO v_diskon;

  RETURN QUERY
  WITH order_valid AS (
    SELECT o.id FROM orders o
    WHERE o.nomor_wa = p_nomor_wa
      AND o.status IN ('lunas', 'dikirim', 'selesai')
      AND o.deleted_at IS NULL
  ),
  agg AS (
    SELECT
      (SELECT COUNT(*) FROM order_valid)::INT AS jml_transaksi,
      (SELECT COUNT(DISTINCT oi.product_id) FROM order_items oi
        WHERE oi.order_id IN (SELECT id FROM order_valid))::INT AS jml_produk
  )
  SELECT
    agg.jml_transaksi,
    agg.jml_produk,
    (agg.jml_transaksi >= v_syarat_transaksi OR agg.jml_produk >= v_syarat_produk),
    v_diskon,
    v_syarat_transaksi,
    v_syarat_produk
  FROM agg;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION cek_status_member(VARCHAR) TO anon, authenticated;
