-- ============================================================
-- FURNITURE STORE — PostgreSQL Schema
-- Target: Supabase (PostgreSQL 15+)
-- Normalisasi: 3NF
-- Konvensi: UUID PK, soft delete, timestamp, RLS aktif
-- ============================================================

-- Aktifkan ekstensi UUID (sudah tersedia di Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

CREATE TYPE product_status   AS ENUM ('ready', 'pre_order', 'habis');
CREATE TYPE order_status     AS ENUM ('menunggu_pembayaran','menunggu_verifikasi','lunas','ditolak','dikirim','selesai','dibatalkan');
CREATE TYPE payment_status   AS ENUM ('pending','menunggu_verifikasi','lunas','ditolak');
CREATE TYPE payment_method   AS ENUM ('transfer_bank','qris');
CREATE TYPE shipping_method  AS ENUM ('ekspedisi','instan','manual');

-- ============================================================
-- 2. KATEGORI
-- ============================================================

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        VARCHAR(100) NOT NULL,
  slug        VARCHAR(110) NOT NULL UNIQUE,
  icon        VARCHAR(60),            -- nama icon Tabler, misal "ti-sofa"
  urutan      SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ                             -- soft delete
);

CREATE INDEX idx_categories_slug      ON categories(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_urutan    ON categories(urutan) WHERE deleted_at IS NULL;

-- ============================================================
-- 3. PRODUK
-- ============================================================

CREATE TABLE products (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id          UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  kode_produk          VARCHAR(30) NOT NULL UNIQUE,
  nama                 VARCHAR(200) NOT NULL,
  slug                 VARCHAR(220) NOT NULL UNIQUE,
  deskripsi            TEXT,
  spesifikasi          JSONB,          -- {material, dimensi, berat, warna, ...}
  harga                NUMERIC(14,2) NOT NULL CHECK (harga >= 0),
  diskon               NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (diskon BETWEEN 0 AND 100),
  harga_jual           NUMERIC(14,2) GENERATED ALWAYS AS
                         (ROUND(harga * (1 - diskon/100), 2)) STORED,
  stok                 INT NOT NULL DEFAULT 0 CHECK (stok >= 0),
  status               product_status NOT NULL DEFAULT 'ready',
  estimasi_produksi    VARCHAR(60),    -- misal "7 hari kerja"
  estimasi_pengiriman  VARCHAR(60),    -- misal "3-5 hari"
  berat_kg             NUMERIC(8,2),
  view_count           INT NOT NULL DEFAULT 0,  -- cache cepat, diperbarui trigger
  order_count          INT NOT NULL DEFAULT 0,  -- cache cepat
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

CREATE INDEX idx_products_category    ON products(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_status      ON products(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_harga_jual  ON products(harga_jual) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_slug        ON products(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_kode        ON products(kode_produk);

-- ============================================================
-- 4. FOTO PRODUK
-- ============================================================

CREATE TABLE product_images (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url_original     TEXT,               -- path di Supabase Storage (hanya admin)
  url_watermarked  TEXT NOT NULL,      -- path publik dengan watermark
  urutan           SMALLINT NOT NULL DEFAULT 0,
  is_primary       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_images_product ON product_images(product_id);
CREATE INDEX idx_product_images_primary ON product_images(product_id, is_primary);

-- Pastikan hanya satu foto utama per produk
CREATE UNIQUE INDEX idx_product_images_one_primary
  ON product_images(product_id) WHERE is_primary = TRUE;

-- ============================================================
-- 5. VIDEO PRODUK
-- ============================================================

CREATE TABLE product_videos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  judul       VARCHAR(150),
  urutan      SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_videos_product ON product_videos(product_id);

-- ============================================================
-- 6. TARIF ONGKOS KIRIM
-- ============================================================

CREATE TABLE shipping_rates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provinsi          VARCHAR(100) NOT NULL,
  kota              VARCHAR(100) NOT NULL,
  ekspedisi         VARCHAR(60) NOT NULL,    -- misal "JNE Reguler"
  metode            shipping_method NOT NULL DEFAULT 'ekspedisi',
  harga             NUMERIC(12,2) NOT NULL CHECK (harga >= 0),
  estimasi_durasi   VARCHAR(60),             -- misal "3-5 hari kerja"
  aktif             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shipping_rates_kota      ON shipping_rates(kota, aktif);
CREATE INDEX idx_shipping_rates_provinsi  ON shipping_rates(provinsi, aktif);

-- ============================================================
-- 7. PESANAN (ORDERS)
-- ============================================================

CREATE TABLE orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number      VARCHAR(25) NOT NULL UNIQUE,  -- INV-YYYYMMDD-XXXX (di-generate trigger)
  -- Data pembeli
  nama_pembeli        VARCHAR(150) NOT NULL,
  nomor_wa            VARCHAR(20) NOT NULL,
  email               VARCHAR(150),
  -- Alamat pengiriman
  alamat              TEXT NOT NULL,
  provinsi            VARCHAR(100) NOT NULL,
  kota                VARCHAR(100) NOT NULL,
  kecamatan           VARCHAR(100),
  kelurahan           VARCHAR(100),
  kode_pos            VARCHAR(10),
  catatan             TEXT,
  -- Pengiriman
  shipping_rate_id    UUID REFERENCES shipping_rates(id) ON DELETE SET NULL,
  metode_pengiriman   shipping_method NOT NULL DEFAULT 'ekspedisi',
  ekspedisi           VARCHAR(60),
  ongkir              NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (ongkir >= 0),
  nomor_resi          VARCHAR(60),
  -- Nilai
  subtotal            NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  diskon_voucher      NUMERIC(14,2) NOT NULL DEFAULT 0,
  total               NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  voucher_code        VARCHAR(30),
  -- Status
  status              order_status NOT NULL DEFAULT 'menunggu_pembayaran',
  -- Timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_orders_invoice     ON orders(invoice_number);
CREATE INDEX idx_orders_status      ON orders(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_nomor_wa    ON orders(nomor_wa) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_created_at  ON orders(created_at DESC) WHERE deleted_at IS NULL;

-- ============================================================
-- 8. ITEM PESANAN
-- ============================================================

CREATE TABLE order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  nama_produk  VARCHAR(200) NOT NULL,  -- snapshot nama saat pesan
  kode_produk  VARCHAR(30) NOT NULL,   -- snapshot kode saat pesan
  harga_satuan NUMERIC(14,2) NOT NULL CHECK (harga_satuan >= 0),
  diskon       NUMERIC(5,2) NOT NULL DEFAULT 0,
  qty          INT NOT NULL CHECK (qty > 0),
  subtotal     NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order    ON order_items(order_id);
CREATE INDEX idx_order_items_product  ON order_items(product_id);

-- ============================================================
-- 9. PEMBAYARAN
-- ============================================================

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  metode              payment_method NOT NULL,
  bank                VARCHAR(50),                 -- misal "BCA", "Mandiri"
  nomor_rekening      VARCHAR(30),
  atas_nama           VARCHAR(100),
  bukti_transfer_url  TEXT,                        -- path Supabase Storage
  nominal_bayar       NUMERIC(14,2),
  status              payment_status NOT NULL DEFAULT 'pending',
  catatan_admin       TEXT,
  verified_by         UUID,                        -- Supabase Auth user id admin
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_order   ON payments(order_id);
CREATE INDEX idx_payments_status  ON payments(status);

-- ============================================================
-- 10. CHATBOT FAQ
-- ============================================================

CREATE TABLE chatbot_faq (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pertanyaan   TEXT NOT NULL,
  jawaban      TEXT NOT NULL,
  prioritas    SMALLINT NOT NULL DEFAULT 0,  -- urutan tampil di quick reply
  aktif        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chatbot_faq_aktif ON chatbot_faq(aktif, prioritas);

CREATE TABLE chatbot_tags (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  faq_id  UUID NOT NULL REFERENCES chatbot_faq(id) ON DELETE CASCADE,
  keyword VARCHAR(60) NOT NULL
);

CREATE INDEX idx_chatbot_tags_faq     ON chatbot_tags(faq_id);
CREATE INDEX idx_chatbot_tags_keyword ON chatbot_tags(keyword);

-- ============================================================
-- 11. PRODUCT VIEWS (log kunjungan halaman detail produk)
-- ============================================================

CREATE TABLE product_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  session_id  VARCHAR(64),   -- anonim, dari localStorage key
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index — hanya buat query agregasi per produk efisien
CREATE INDEX idx_product_views_product   ON product_views(product_id, viewed_at DESC);
CREATE INDEX idx_product_views_daily     ON product_views(viewed_at DESC);

-- ============================================================
-- 12. TESTIMONI
-- ============================================================

CREATE TABLE testimonials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama        VARCHAR(100) NOT NULL,
  kota        VARCHAR(80),
  pesan       TEXT NOT NULL,
  rating      SMALLINT NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  foto_url    TEXT,
  tampil      BOOLEAN NOT NULL DEFAULT FALSE,  -- harus disetujui admin dulu
  urutan      SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_testimonials_tampil ON testimonials(tampil, urutan) WHERE deleted_at IS NULL;

-- ============================================================
-- 13. PENGATURAN TOKO (key-value store)
-- ============================================================

CREATE TABLE store_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         VARCHAR(80) NOT NULL UNIQUE,
  value       TEXT,
  keterangan  VARCHAR(200),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_store_settings_key ON store_settings(key);

-- Seed data pengaturan dasar
INSERT INTO store_settings (key, value, keterangan) VALUES
  ('nama_toko',       'NataRuang',              'Nama toko yang tampil di website'),
  ('tagline',         'Kualitas Premium, Harga Terjangkau', 'Tagline toko'),
  ('alamat',          '',                             'Alamat lengkap toko'),
  ('nomor_wa',        '',                             'Nomor WhatsApp (format 628xxx)'),
  ('email',           '',                             'Email toko'),
  ('jam_operasional', 'Senin–Sabtu, 08.00–17.00 WIB','Jam operasional'),
  ('instagram',       '',                             'Username Instagram (tanpa @)'),
  ('facebook',        '',                             'URL halaman Facebook'),
  ('tiktok',          '',                             'Username TikTok (tanpa @)'),
  ('bank_nama',       '',                             'Nama bank untuk transfer'),
  ('bank_rekening',   '',                             'Nomor rekening'),
  ('bank_atas_nama',  '',                             'Nama pemilik rekening'),
  ('qris_url',        '',                             'URL file gambar QRIS'),
  ('logo_url',        '',                             'URL logo toko'),
  ('watermark_text',  'NataRuang',              'Teks watermark pada foto produk'),
  ('watermark_opacity','0.35',                        'Opasitas watermark (0–1)'),
  ('maps_embed',      '',                             'Embed URL Google Maps');

-- ============================================================
-- 14. AUDIT LOG
-- ============================================================

CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tabel       VARCHAR(60) NOT NULL,
  record_id   UUID,
  aktor       VARCHAR(100),  -- 'admin' atau email admin
  aksi        VARCHAR(30) NOT NULL,  -- INSERT / UPDATE / DELETE / APPROVE / REJECT
  data_lama   JSONB,
  data_baru   JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_tabel     ON audit_logs(tabel, created_at DESC);
CREATE INDEX idx_audit_logs_record    ON audit_logs(record_id);
CREATE INDEX idx_audit_logs_created   ON audit_logs(created_at DESC);

-- ============================================================
-- 15. TRIGGER: updated_at otomatis
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_store_settings_updated_at
  BEFORE UPDATE ON store_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_testimonials_updated_at
  BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_shipping_rates_updated_at
  BEFORE UPDATE ON shipping_rates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_chatbot_faq_updated_at
  BEFORE UPDATE ON chatbot_faq
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 16. TRIGGER: NOMOR INVOICE OTOMATIS
-- Format: INV-YYYYMMDD-XXXX (urut harian, reset tiap hari baru)
-- Aman untuk concurrent insert (menggunakan advisory lock per tanggal)
-- ============================================================

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date    TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  v_prefix  TEXT := 'INV-' || v_date || '-';
  v_last    TEXT;
  v_seq     INT;
BEGIN
  -- Kunci advisory berdasarkan hash tanggal agar aman saat concurrent insert
  PERFORM pg_advisory_xact_lock(hashtext(v_date));

  SELECT invoice_number INTO v_last
    FROM orders
   WHERE invoice_number LIKE v_prefix || '%'
   ORDER BY invoice_number DESC
   LIMIT 1;

  IF v_last IS NULL THEN
    v_seq := 1;
  ELSE
    v_seq := CAST(SUBSTRING(v_last FROM LENGTH(v_prefix) + 1) AS INT) + 1;
  END IF;

  NEW.invoice_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_invoice_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
  EXECUTE FUNCTION generate_invoice_number();

-- ============================================================
-- 17. TRIGGER: UPDATE CACHE view_count & order_count DI PRODUCTS
-- ============================================================

-- Cache view_count (increment saat product_views di-insert)
CREATE OR REPLACE FUNCTION increment_product_view_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
     SET view_count = view_count + 1
   WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_increment_view_count
  AFTER INSERT ON product_views
  FOR EACH ROW EXECUTE FUNCTION increment_product_view_count();

-- Cache order_count (increment saat order_items di-insert)
CREATE OR REPLACE FUNCTION increment_product_order_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products
     SET order_count = order_count + NEW.qty
   WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_increment_order_count
  AFTER INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION increment_product_order_count();

-- ============================================================
-- 18. VIEW ANALITIK
-- ============================================================

-- Produk paling banyak dilihat (7 hari terakhir)
CREATE OR REPLACE VIEW v_produk_paling_dilihat AS
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

-- Produk paling sering dipesan (30 hari terakhir)
CREATE OR REPLACE VIEW v_produk_terlaris AS
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

-- Ringkasan penjualan harian (30 hari terakhir)
CREATE OR REPLACE VIEW v_ringkasan_penjualan_harian AS
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

-- Ringkasan penjualan bulanan
CREATE OR REPLACE VIEW v_ringkasan_penjualan_bulanan AS
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

-- Dashboard summary (dipakai kartu statistik atas dashboard)
CREATE OR REPLACE VIEW v_dashboard_summary AS
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

-- ============================================================
-- 19. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Aktifkan RLS pada semua tabel
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images   ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_videos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_rates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_faq      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_tags     ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_views    ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials     ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;

-- Helper: cek apakah requester adalah admin (Supabase Auth)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND raw_app_meta_data->>'role' = 'admin'
  );
$$;

-- ---- CATEGORIES ----
CREATE POLICY "Publik baca kategori aktif"
  ON categories FOR SELECT
  USING (deleted_at IS NULL);

CREATE POLICY "Admin kelola kategori"
  ON categories FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ---- PRODUCTS ----
CREATE POLICY "Publik baca produk aktif"
  ON products FOR SELECT
  USING (deleted_at IS NULL);

CREATE POLICY "Admin kelola produk"
  ON products FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ---- PRODUCT_IMAGES ----
CREATE POLICY "Publik baca foto produk"
  ON product_images FOR SELECT USING (TRUE);

CREATE POLICY "Admin kelola foto"
  ON product_images FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- PRODUCT_VIDEOS ----
CREATE POLICY "Publik baca video produk"
  ON product_videos FOR SELECT USING (TRUE);

CREATE POLICY "Admin kelola video"
  ON product_videos FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- SHIPPING_RATES ----
CREATE POLICY "Publik baca tarif ongkir aktif"
  ON shipping_rates FOR SELECT
  USING (aktif = TRUE);

CREATE POLICY "Admin kelola ongkir"
  ON shipping_rates FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- ORDERS ----
-- Customer tidak login; mereka bisa INSERT pesanan baru
-- Setelah itu hanya bisa SELECT berdasarkan nomor_wa (cari pesanan)
CREATE POLICY "Publik insert pesanan"
  ON orders FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Cari pesanan by nomor WA"
  ON orders FOR SELECT
  USING (TRUE);  -- filtering by nomor_wa dilakukan di query, bukan policy

CREATE POLICY "Admin kelola pesanan"
  ON orders FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- ORDER_ITEMS ----
CREATE POLICY "Publik insert item pesanan"
  ON order_items FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Publik baca item pesanan"
  ON order_items FOR SELECT USING (TRUE);

CREATE POLICY "Admin kelola item pesanan"
  ON order_items FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- PAYMENTS ----
CREATE POLICY "Publik insert pembayaran"
  ON payments FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Publik baca status pembayaran"
  ON payments FOR SELECT USING (TRUE);

CREATE POLICY "Publik update bukti transfer"
  ON payments FOR UPDATE
  USING (status = 'pending')
  WITH CHECK (status IN ('pending','menunggu_verifikasi'));

CREATE POLICY "Admin kelola pembayaran"
  ON payments FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- CHATBOT_FAQ ----
CREATE POLICY "Publik baca FAQ aktif"
  ON chatbot_faq FOR SELECT USING (aktif = TRUE);

CREATE POLICY "Admin kelola FAQ"
  ON chatbot_faq FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Publik baca tag FAQ"
  ON chatbot_tags FOR SELECT USING (TRUE);

CREATE POLICY "Admin kelola tag FAQ"
  ON chatbot_tags FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- PRODUCT_VIEWS ----
CREATE POLICY "Publik insert product view"
  ON product_views FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Admin baca product views"
  ON product_views FOR SELECT USING (is_admin());

-- ---- TESTIMONIALS ----
CREATE POLICY "Publik baca testimoni aktif"
  ON testimonials FOR SELECT
  USING (tampil = TRUE AND deleted_at IS NULL);

CREATE POLICY "Admin kelola testimoni"
  ON testimonials FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- STORE_SETTINGS ----
CREATE POLICY "Publik baca pengaturan"
  ON store_settings FOR SELECT USING (TRUE);

CREATE POLICY "Admin kelola pengaturan"
  ON store_settings FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ---- AUDIT_LOGS ----
CREATE POLICY "Admin baca audit log"
  ON audit_logs FOR SELECT USING (is_admin());

CREATE POLICY "Service insert audit log"
  ON audit_logs FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- 20. SEED DATA DEMO (Chatbot FAQ)
-- ============================================================

INSERT INTO chatbot_faq (pertanyaan, jawaban, prioritas) VALUES
('Bagaimana cara memesan?',
 'Untuk memesan, pilih produk yang diinginkan → klik Tambah ke Keranjang → isi data pengiriman di halaman Checkout → pilih metode pembayaran → konfirmasi pesanan. Nomor invoice akan otomatis dikirimkan.',
 1),
('Berapa lama estimasi pengiriman?',
 'Estimasi pengiriman tergantung lokasi dan ekspedisi yang dipilih. Biasanya 2-7 hari kerja untuk Jawa, dan 5-14 hari untuk luar Jawa.',
 2),
('Apa saja metode pembayaran yang tersedia?',
 'Kami menerima Transfer Bank (BCA, Mandiri, BRI, BNI) dan QRIS. Setelah transfer, mohon upload bukti pembayaran di halaman status pesanan.',
 3),
('Bagaimana cara cek status pesanan?',
 'Masukkan nomor invoice atau nomor WhatsApp Anda di halaman Cek Pesanan. Anda juga bisa menghubungi kami langsung via WhatsApp.',
 4),
('Apakah ada garansi produk?',
 'Ya, semua produk bergaransi kerusakan material selama 30 hari sejak diterima. Hubungi kami via WhatsApp untuk klaim garansi.',
 5),
('Apakah bisa custom ukuran?',
 'Bisa! Hubungi kami via WhatsApp untuk konsultasi custom ukuran, warna, dan material. Estimasi produksi custom 14-21 hari kerja.',
 6);

INSERT INTO chatbot_tags (faq_id, keyword)
SELECT id, unnest(ARRAY['pesan','order','beli','cara pesan','pemesanan'])
  FROM chatbot_faq WHERE prioritas = 1;

INSERT INTO chatbot_tags (faq_id, keyword)
SELECT id, unnest(ARRAY['kirim','pengiriman','ongkir','estimasi','lama'])
  FROM chatbot_faq WHERE prioritas = 2;

INSERT INTO chatbot_tags (faq_id, keyword)
SELECT id, unnest(ARRAY['bayar','pembayaran','transfer','qris','rekening'])
  FROM chatbot_faq WHERE prioritas = 3;

INSERT INTO chatbot_tags (faq_id, keyword)
SELECT id, unnest(ARRAY['status','cek','invoice','nomor pesanan','tracking'])
  FROM chatbot_faq WHERE prioritas = 4;

INSERT INTO chatbot_tags (faq_id, keyword)
SELECT id, unnest(ARRAY['garansi','rusak','klaim','jaminan'])
  FROM chatbot_faq WHERE prioritas = 5;

INSERT INTO chatbot_tags (faq_id, keyword)
SELECT id, unnest(ARRAY['custom','ukuran','warna','pesan khusus','bespoke'])
  FROM chatbot_faq WHERE prioritas = 6;

-- ============================================================
-- 15. RATING PRODUK (tambahan aditif — aman dijalankan ulang)
-- ============================================================
-- Rata-rata rating & jumlah rating per produk, dipakai kartu
-- produk di produk.html (marketplace). Diperbarui otomatis
-- dari tabel testimonials bila kolom product_id diisi admin,
-- atau di-update manual via dashboard admin. Default 0 = belum
-- ada rating (kartu produk otomatis menyembunyikan bintang).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS rating       NUMERIC(2,1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0 CHECK (rating_count >= 0);

CREATE INDEX IF NOT EXISTS idx_products_rating ON products(rating) WHERE deleted_at IS NULL;

-- Tautkan testimoni ke produk tertentu (opsional)
ALTER TABLE testimonials
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

-- Fungsi + trigger: setiap testimoni tampil yang tertaut ke
-- produk otomatis memperbarui rating & rating_count produk itu.
CREATE OR REPLACE FUNCTION fn_recalc_product_rating() RETURNS TRIGGER AS $$
DECLARE
  target_id UUID := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  IF target_id IS NOT NULL THEN
    UPDATE products p SET
      rating       = COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM testimonials
                                WHERE product_id = target_id AND tampil = TRUE AND deleted_at IS NULL), 0),
      rating_count = COALESCE((SELECT COUNT(*) FROM testimonials
                                WHERE product_id = target_id AND tampil = TRUE AND deleted_at IS NULL), 0)
    WHERE p.id = target_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalc_product_rating ON testimonials;
CREATE TRIGGER trg_recalc_product_rating
  AFTER INSERT OR UPDATE OR DELETE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION fn_recalc_product_rating();

-- Badge "Produk Baru" di produk.html dihitung langsung di
-- frontend dari created_at (≤ 14 hari), tidak perlu kolom baru.

-- ============================================================
-- SELESAI — schema.sql
-- Jalankan di Supabase: Dashboard → SQL Editor → Run
-- ============================================================
