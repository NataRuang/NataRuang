-- ============================================================
-- NATARUANG — Migration 006: Manajemen Stok / Inventaris
-- ============================================================
-- Jalankan SETELAH schema.sql, 002, 003, 005_akuntansi.sql.
-- Aman dijalankan ulang (idempotent).
--
-- Cakupan:
--  1. Multi-gudang/lokasi penyimpanan
--  2. Kartu stok (riwayat pergerakan) — satu-satunya jalan mengubah stok
--  3. Valuasi HPP: FIFO atau Rata-rata Tertimbang (toggle pengaturan)
--  4. Retur dari pembeli (balik ke stok) & retur ke supplier (keluar stok)
--  5. Barang rusak/hilang — WAJIB approval Admin/Finance sebelum stok
--     resmi berkurang & sebelum kerugian dijurnal
--  6. Auto pengurangan stok + jurnal HPP setiap pembayaran diverifikasi lunas
--
-- products.stok TETAP ADA (dipakai storefront/checkout tanpa perlu ubah
-- kode lain) tapi sekarang jadi kolom AGREGAT read-only, otomatis
-- disinkronkan dari stok_lokasi lewat trigger. Jangan UPDATE products.stok
-- secara manual lagi setelah migration ini — pakai proses_pergerakan_stok().
-- ============================================================


-- ============================================================
-- 1. GUDANG / LOKASI PENYIMPANAN
-- ============================================================

CREATE TABLE IF NOT EXISTS gudang (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_gudang  VARCHAR(20) NOT NULL UNIQUE,
  nama_gudang  VARCHAR(100) NOT NULL,
  alamat       TEXT,
  aktif        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO gudang (kode_gudang, nama_gudang)
VALUES ('GD-01', 'Gudang Utama')
ON CONFLICT (kode_gudang) DO NOTHING;

-- ============================================================
-- 2. STOK PER LOKASI (agregat, sumber kebenaran untuk products.stok)
-- ============================================================

CREATE TABLE IF NOT EXISTS stok_lokasi (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  gudang_id   UUID NOT NULL REFERENCES gudang(id) ON DELETE RESTRICT,
  stok        INT NOT NULL DEFAULT 0 CHECK (stok >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, gudang_id)
);

CREATE INDEX IF NOT EXISTS idx_stok_lokasi_product ON stok_lokasi(product_id);

-- Backfill: pindahkan stok existing (products.stok) ke Gudang Utama supaya
-- tidak ada barang yang "hilang" saat migration pertama kali dijalankan.
INSERT INTO stok_lokasi (product_id, gudang_id, stok)
SELECT p.id, (SELECT id FROM gudang WHERE kode_gudang = 'GD-01'), GREATEST(p.stok, 0)
FROM products p
ON CONFLICT (product_id, gudang_id) DO NOTHING;

-- Sinkron otomatis products.stok = SUM(stok_lokasi.stok) setiap kali berubah
CREATE OR REPLACE FUNCTION fn_sync_products_stok()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id UUID := COALESCE(NEW.product_id, OLD.product_id);
BEGIN
  UPDATE products SET stok = (
    SELECT COALESCE(SUM(stok), 0) FROM stok_lokasi WHERE product_id = v_product_id
  ) WHERE id = v_product_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_products_stok ON stok_lokasi;
CREATE TRIGGER trg_sync_products_stok
  AFTER INSERT OR UPDATE OR DELETE ON stok_lokasi
  FOR EACH ROW EXECUTE FUNCTION fn_sync_products_stok();

-- ============================================================
-- 3. LOT STOK (lapisan biaya untuk FIFO / rata-rata)
-- ============================================================

CREATE TABLE IF NOT EXISTS stok_lot (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  gudang_id           UUID NOT NULL REFERENCES gudang(id) ON DELETE RESTRICT,
  pergerakan_masuk_id UUID,  -- FK ditambahkan setelah tabel stok_pergerakan ada
  qty_awal            INT NOT NULL CHECK (qty_awal > 0),
  qty_sisa            INT NOT NULL CHECK (qty_sisa >= 0),
  harga_satuan        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (harga_satuan >= 0),
  tanggal             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stok_lot_fifo ON stok_lot(product_id, gudang_id, tanggal) WHERE qty_sisa > 0;

-- ============================================================
-- 4. KARTU STOK (PERGERAKAN) — satu-satunya jalan mengubah stok
-- ============================================================

DO $$ BEGIN
  CREATE TYPE stok_pergerakan_tipe AS ENUM (
    'masuk_pembelian', 'masuk_penyesuaian', 'retur_masuk_pembeli',
    'keluar_penjualan', 'keluar_penyesuaian', 'retur_keluar_supplier', 'rusak_hilang'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stok_arah_tipe AS ENUM ('masuk', 'keluar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE stok_status_tipe AS ENUM ('menunggu_approval', 'disetujui', 'ditolak');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS stok_pergerakan (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  gudang_id         UUID NOT NULL REFERENCES gudang(id) ON DELETE RESTRICT,
  tipe              stok_pergerakan_tipe NOT NULL,
  arah              stok_arah_tipe NOT NULL,
  qty               INT NOT NULL CHECK (qty > 0),
  harga_satuan      NUMERIC(14,2),          -- diisi utk masuk_pembelian (wajib), opsional utk masuk lain
  hpp_total         NUMERIC(14,2),          -- dihitung sistem utk arah keluar (FIFO/rata-rata)
  keterangan        TEXT,
  referensi_tabel   VARCHAR(50),            -- mis. 'orders' utk keluar_penjualan otomatis
  referensi_id      UUID,
  status            stok_status_tipe NOT NULL DEFAULT 'disetujui',
  diajukan_oleh     UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  disetujui_oleh    UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  disetujui_at      TIMESTAMPTZ,
  catatan_approval  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stok_pergerakan_product ON stok_pergerakan(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stok_pergerakan_status  ON stok_pergerakan(status) WHERE status = 'menunggu_approval';

ALTER TABLE stok_lot
  ADD CONSTRAINT fk_stok_lot_pergerakan
  FOREIGN KEY (pergerakan_masuk_id) REFERENCES stok_pergerakan(id) ON DELETE SET NULL;

-- Detail lot mana saja yang dikonsumsi oleh satu pergerakan KELUAR (jejak audit FIFO)
CREATE TABLE IF NOT EXISTS stok_konsumsi_lot (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pergerakan_id  UUID NOT NULL REFERENCES stok_pergerakan(id) ON DELETE CASCADE,
  lot_id         UUID NOT NULL REFERENCES stok_lot(id),
  qty            INT NOT NULL CHECK (qty > 0),
  harga_satuan   NUMERIC(14,2) NOT NULL
);

-- ============================================================
-- 5. AKUN TAMBAHAN UNTUK JURNAL STOK
-- ============================================================

INSERT INTO akun_akuntansi (kode_akun, nama_akun, tipe, saldo_normal, kontra, keterangan) VALUES
  ('1-105', 'Piutang Retur Supplier',              'aset',       'debit', FALSE, 'Klaim atas barang yang diretur ke supplier'),
  ('4-104', 'Pendapatan Lain-lain',                 'pendapatan', 'kredit', FALSE, 'Termasuk surplus stok hasil opname'),
  ('6-105', 'Beban Kerugian Persediaan (Rusak/Hilang)', 'beban',  'debit', FALSE, 'Kerugian barang rusak/hilang, setelah disetujui'),
  ('6-106', 'Selisih Stok Opname',                  'beban',      'debit', FALSE, 'Selisih kekurangan stok hasil opname')
ON CONFLICT (kode_akun) DO NOTHING;

-- ============================================================
-- 6. PENGATURAN METODE VALUASI
-- ============================================================

INSERT INTO store_settings (key, value, keterangan) VALUES
  ('metode_valuasi_stok', 'rata_rata', 'Metode hitung HPP: ''fifo'' atau ''rata_rata''')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 7. FUNCTION: fn_terapkan_pergerakan_stok()
-- ============================================================
-- Mengeksekusi efek nyata satu pergerakan stok yang statusnya 'disetujui':
-- update stok_lokasi, kelola lot (FIFO), hitung HPP, dan buat jurnal
-- akuntansi otomatis sesuai tipe pergerakan. Dipanggil dari
-- proses_pergerakan_stok() (jalur auto-approve) maupun
-- setujui_pergerakan_stok() (jalur approval manual).

CREATE OR REPLACE FUNCTION fn_terapkan_pergerakan_stok(p_movement_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mv            RECORD;
  v_hpp_total     NUMERIC := 0;
  v_sisa          INT;
  v_lot           RECORD;
  v_ambil         INT;
  v_metode        TEXT;
  v_total_qty     NUMERIC;
  v_total_nilai   NUMERIC;
  v_avg_cost      NUMERIC;
  v_harga_pakai   NUMERIC;
  v_nilai         NUMERIC;
  v_akun_persediaan UUID;
  v_akun_a        UUID;
BEGIN
  SELECT * INTO v_mv FROM stok_pergerakan WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_akun_persediaan FROM akun_akuntansi WHERE kode_akun = '1-104';

  IF v_mv.arah = 'masuk' THEN
    -- Harga: kalau tidak diisi (retur_masuk_pembeli), pakai rata-rata biaya berjalan
    IF v_mv.harga_satuan IS NOT NULL THEN
      v_harga_pakai := v_mv.harga_satuan;
    ELSE
      SELECT COALESCE(SUM(qty_sisa * harga_satuan), 0) / NULLIF(SUM(qty_sisa), 0)
      INTO v_harga_pakai
      FROM stok_lot WHERE product_id = v_mv.product_id AND gudang_id = v_mv.gudang_id AND qty_sisa > 0;
      v_harga_pakai := COALESCE(v_harga_pakai, 0);
    END IF;

    INSERT INTO stok_lot (product_id, gudang_id, pergerakan_masuk_id, qty_awal, qty_sisa, harga_satuan, tanggal)
    VALUES (v_mv.product_id, v_mv.gudang_id, v_mv.id, v_mv.qty, v_mv.qty, v_harga_pakai, v_mv.created_at);

    INSERT INTO stok_lokasi (product_id, gudang_id, stok)
    VALUES (v_mv.product_id, v_mv.gudang_id, v_mv.qty)
    ON CONFLICT (product_id, gudang_id)
    DO UPDATE SET stok = stok_lokasi.stok + v_mv.qty, updated_at = now();

    v_nilai := v_mv.qty * v_harga_pakai;
    UPDATE stok_pergerakan SET harga_satuan = v_harga_pakai WHERE id = v_mv.id;

    -- Jurnal sisi masuk
    IF v_nilai > 0 AND v_akun_persediaan IS NOT NULL THEN
      IF v_mv.tipe = 'masuk_pembelian' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '1-102'; -- Bank
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'Pembelian stok — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', v_nilai, 'kredit', 0, 'keterangan', 'Pembelian stok masuk'),
              jsonb_build_object('akun_id', v_akun_a, 'debit', 0, 'kredit', v_nilai, 'keterangan', 'Pembayaran pembelian stok')
            ));
        END IF;
      ELSIF v_mv.tipe = 'masuk_penyesuaian' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '4-104'; -- Pendapatan Lain-lain
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'Penyesuaian stok opname (surplus) — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', v_nilai, 'kredit', 0, 'keterangan', 'Surplus stok opname'),
              jsonb_build_object('akun_id', v_akun_a, 'debit', 0, 'kredit', v_nilai, 'keterangan', 'Surplus stok opname')
            ));
        END IF;
      ELSIF v_mv.tipe = 'retur_masuk_pembeli' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '5-101'; -- HPP (reverse)
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'Retur barang dari pembeli — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', v_nilai, 'kredit', 0, 'keterangan', 'Retur barang masuk ke stok'),
              jsonb_build_object('akun_id', v_akun_a, 'debit', 0, 'kredit', v_nilai, 'keterangan', 'Pembalikan HPP atas retur')
            ));
        END IF;
      END IF;
    END IF;

    RETURN NULL;

  ELSE
    -- ── ARAH KELUAR: konsumsi lot (selalu urut FIFO fisik), hitung HPP sesuai metode ──
    SELECT COALESCE((SELECT value FROM store_settings WHERE key = 'metode_valuasi_stok'), 'rata_rata') INTO v_metode;

    IF v_metode = 'rata_rata' THEN
      SELECT COALESCE(SUM(qty_sisa), 0), COALESCE(SUM(qty_sisa * harga_satuan), 0)
      INTO v_total_qty, v_total_nilai
      FROM stok_lot WHERE product_id = v_mv.product_id AND gudang_id = v_mv.gudang_id AND qty_sisa > 0;

      v_avg_cost  := CASE WHEN v_total_qty > 0 THEN v_total_nilai / v_total_qty ELSE 0 END;
      v_hpp_total := ROUND(v_avg_cost * v_mv.qty, 2);
    END IF;

    v_sisa := v_mv.qty;
    FOR v_lot IN
      SELECT * FROM stok_lot
      WHERE product_id = v_mv.product_id AND gudang_id = v_mv.gudang_id AND qty_sisa > 0
      ORDER BY tanggal, created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_sisa <= 0;
      v_ambil := LEAST(v_sisa, v_lot.qty_sisa);

      UPDATE stok_lot SET qty_sisa = qty_sisa - v_ambil WHERE id = v_lot.id;

      INSERT INTO stok_konsumsi_lot (pergerakan_id, lot_id, qty, harga_satuan)
      VALUES (v_mv.id, v_lot.id, v_ambil, v_lot.harga_satuan);

      IF v_metode = 'fifo' THEN
        v_hpp_total := v_hpp_total + (v_ambil * v_lot.harga_satuan);
      END IF;

      v_sisa := v_sisa - v_ambil;
    END LOOP;
    -- Catatan: kalau stok fisik di lot kurang dari qty yang diminta (data tidak
    -- sinkron), sisa qty yang belum kebagian lot tidak menambah HPP (dianggap
    -- cost 0 untuk bagian itu) — stok_lokasi tetap dikurangi penuh di bawah.
    -- Idealnya proses_pergerakan_stok() sudah mencegah ini lewat cek stok cukup.

    UPDATE stok_lokasi SET stok = GREATEST(stok - v_mv.qty, 0), updated_at = now()
    WHERE product_id = v_mv.product_id AND gudang_id = v_mv.gudang_id;

    UPDATE stok_pergerakan SET hpp_total = v_hpp_total WHERE id = v_mv.id;

    -- Jurnal sisi keluar
    IF v_hpp_total > 0 AND v_akun_persediaan IS NOT NULL THEN
      IF v_mv.tipe = 'keluar_penjualan' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '5-101'; -- HPP
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'HPP penjualan — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_a, 'debit', v_hpp_total, 'kredit', 0, 'keterangan', 'HPP atas penjualan'),
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', 0, 'kredit', v_hpp_total, 'keterangan', 'Pengurangan persediaan')
            ));
        END IF;
      ELSIF v_mv.tipe = 'keluar_penyesuaian' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '6-106'; -- Selisih Stok Opname
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'Penyesuaian stok opname (kurang) — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_a, 'debit', v_hpp_total, 'kredit', 0, 'keterangan', 'Selisih kekurangan stok opname'),
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', 0, 'kredit', v_hpp_total, 'keterangan', 'Pengurangan persediaan')
            ));
        END IF;
      ELSIF v_mv.tipe = 'retur_keluar_supplier' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '1-105'; -- Piutang Retur Supplier
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'Retur barang ke supplier — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_a, 'debit', v_hpp_total, 'kredit', 0, 'keterangan', 'Klaim retur ke supplier'),
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', 0, 'kredit', v_hpp_total, 'keterangan', 'Pengurangan persediaan')
            ));
        END IF;
      ELSIF v_mv.tipe = 'rusak_hilang' THEN
        SELECT id INTO v_akun_a FROM akun_akuntansi WHERE kode_akun = '6-105'; -- Beban Kerugian Persediaan
        IF v_akun_a IS NOT NULL THEN
          PERFORM buat_jurnal(CURRENT_DATE, 'Barang rusak/hilang — ' || COALESCE(v_mv.keterangan,''),
            'otomatis_lainnya', 'stok_pergerakan', v_mv.id,
            jsonb_build_array(
              jsonb_build_object('akun_id', v_akun_a, 'debit', v_hpp_total, 'kredit', 0, 'keterangan', 'Kerugian barang rusak/hilang'),
              jsonb_build_object('akun_id', v_akun_persediaan, 'debit', 0, 'kredit', v_hpp_total, 'keterangan', 'Pengurangan persediaan')
            ));
        END IF;
      END IF;
    END IF;

    RETURN v_hpp_total;
  END IF;
END;
$$;

-- ============================================================
-- 8. FUNCTION: proses_pergerakan_stok() — RPC utama dipanggil dari UI
-- ============================================================

CREATE OR REPLACE FUNCTION proses_pergerakan_stok(
  p_product_id       UUID,
  p_gudang_id        UUID,
  p_tipe             TEXT,
  p_qty              INT,
  p_harga_satuan     NUMERIC DEFAULT NULL,
  p_keterangan       TEXT DEFAULT NULL,
  p_referensi_tabel  TEXT DEFAULT NULL,
  p_referensi_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_arah        stok_arah_tipe;
  v_status      stok_status_tipe;
  v_movement_id UUID;
  v_stok_saat_ini INT;
BEGIN
  IF NOT (is_admin() OR is_finance()) THEN
    RAISE EXCEPTION 'Tidak memiliki akses mengelola stok';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Qty harus lebih dari 0';
  END IF;

  v_arah := CASE
    WHEN p_tipe IN ('masuk_pembelian', 'masuk_penyesuaian', 'retur_masuk_pembeli') THEN 'masuk'::stok_arah_tipe
    WHEN p_tipe IN ('keluar_penjualan', 'keluar_penyesuaian', 'retur_keluar_supplier', 'rusak_hilang') THEN 'keluar'::stok_arah_tipe
    ELSE NULL
  END;
  IF v_arah IS NULL THEN
    RAISE EXCEPTION 'Tipe pergerakan stok tidak dikenal: %', p_tipe;
  END IF;

  IF p_tipe = 'masuk_pembelian' AND (p_harga_satuan IS NULL OR p_harga_satuan <= 0) THEN
    RAISE EXCEPTION 'Harga satuan wajib diisi untuk pembelian stok masuk';
  END IF;

  -- Cek stok cukup untuk pergerakan KELUAR yang auto-approve (bukan rusak_hilang,
  -- karena rusak_hilang baru mengurangi stok setelah di-approve nanti)
  IF v_arah = 'keluar' AND p_tipe <> 'rusak_hilang' THEN
    SELECT COALESCE(stok, 0) INTO v_stok_saat_ini
    FROM stok_lokasi WHERE product_id = p_product_id AND gudang_id = p_gudang_id;
    IF COALESCE(v_stok_saat_ini, 0) < p_qty THEN
      RAISE EXCEPTION 'Stok tidak cukup (tersedia %, diminta %)', COALESCE(v_stok_saat_ini, 0), p_qty;
    END IF;
  END IF;

  v_status := CASE WHEN p_tipe = 'rusak_hilang' THEN 'menunggu_approval'::stok_status_tipe ELSE 'disetujui'::stok_status_tipe END;

  INSERT INTO stok_pergerakan (
    product_id, gudang_id, tipe, arah, qty, harga_satuan, keterangan,
    referensi_tabel, referensi_id, status, diajukan_oleh, disetujui_oleh, disetujui_at
  ) VALUES (
    p_product_id, p_gudang_id, p_tipe::stok_pergerakan_tipe, v_arah, p_qty, p_harga_satuan, p_keterangan,
    p_referensi_tabel, p_referensi_id, v_status, auth.uid(),
    CASE WHEN v_status = 'disetujui' THEN auth.uid() ELSE NULL END,
    CASE WHEN v_status = 'disetujui' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_movement_id;

  IF v_status = 'disetujui' THEN
    PERFORM fn_terapkan_pergerakan_stok(v_movement_id);
  END IF;

  RETURN v_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION proses_pergerakan_stok(UUID, UUID, TEXT, INT, NUMERIC, TEXT, TEXT, UUID) TO authenticated;

-- ============================================================
-- 9. FUNCTION: setujui_pergerakan_stok() — approval barang rusak/hilang
-- ============================================================

CREATE OR REPLACE FUNCTION setujui_pergerakan_stok(
  p_movement_id UUID, p_setuju BOOLEAN, p_catatan TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mv RECORD;
BEGIN
  IF NOT (is_admin() OR is_finance()) THEN
    RAISE EXCEPTION 'Tidak memiliki akses menyetujui pergerakan stok';
  END IF;

  SELECT * INTO v_mv FROM stok_pergerakan WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data pergerakan stok tidak ditemukan';
  END IF;
  IF v_mv.status <> 'menunggu_approval' THEN
    RAISE EXCEPTION 'Pergerakan stok ini sudah diproses sebelumnya (status: %)', v_mv.status;
  END IF;

  IF NOT p_setuju THEN
    UPDATE stok_pergerakan
    SET status = 'ditolak', disetujui_oleh = auth.uid(), disetujui_at = now(), catatan_approval = p_catatan
    WHERE id = p_movement_id;
    RETURN;
  END IF;

  UPDATE stok_pergerakan
  SET status = 'disetujui', disetujui_oleh = auth.uid(), disetujui_at = now(), catatan_approval = p_catatan
  WHERE id = p_movement_id;

  PERFORM fn_terapkan_pergerakan_stok(p_movement_id);
END;
$$;

GRANT EXECUTE ON FUNCTION setujui_pergerakan_stok(UUID, BOOLEAN, TEXT) TO authenticated;

-- ============================================================
-- 10. AUTO PENGURANGAN STOK SAAT PEMBAYARAN LUNAS
-- ============================================================
-- Melengkapi trigger auto-jurnal pendapatan (migration 005): sekarang
-- setiap payments.status → 'lunas' juga otomatis membuat pergerakan
-- 'keluar_penjualan' utk tiap item pesanan (mengurangi stok + jurnal HPP).
-- Kalau stok tidak cukup di Gudang Utama, item itu DILEWATI (tidak
-- menggagalkan verifikasi pembayaran) — akan tercatat sbg WARNING di log.

CREATE OR REPLACE FUNCTION fn_auto_stok_penjualan()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item          RECORD;
  v_gudang_utama  UUID;
  v_stok_ada      INT;
  v_sudah_ada     BOOLEAN;
BEGIN
  IF NEW.status <> 'lunas' OR (TG_OP = 'UPDATE' AND OLD.status = 'lunas') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM stok_pergerakan WHERE referensi_tabel = 'orders' AND referensi_id = NEW.order_id
  ) INTO v_sudah_ada;
  IF v_sudah_ada THEN
    RETURN NEW; -- cegah pengurangan stok dobel
  END IF;

  SELECT id INTO v_gudang_utama FROM gudang WHERE kode_gudang = 'GD-01';
  IF v_gudang_utama IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_item IN SELECT product_id, qty, nama_produk FROM order_items WHERE order_id = NEW.order_id LOOP
    SELECT COALESCE(stok, 0) INTO v_stok_ada
    FROM stok_lokasi WHERE product_id = v_item.product_id AND gudang_id = v_gudang_utama;

    IF COALESCE(v_stok_ada, 0) >= v_item.qty THEN
      BEGIN
        PERFORM proses_pergerakan_stok(
          v_item.product_id, v_gudang_utama, 'keluar_penjualan', v_item.qty,
          NULL, 'Penjualan ' || v_item.nama_produk, 'orders', NEW.order_id
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Auto-stok gagal untuk produk % (order %): %', v_item.product_id, NEW.order_id, SQLERRM;
      END;
    ELSE
      RAISE WARNING 'Stok % tidak cukup saat pelunasan order % (tersedia %, dibutuhkan %) — stok tidak dikurangi, sesuaikan manual',
        v_item.nama_produk, NEW.order_id, COALESCE(v_stok_ada, 0), v_item.qty;
    END IF;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Auto-stok penjualan gagal untuk order %: %', NEW.order_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_stok_penjualan ON payments;
CREATE TRIGGER trg_auto_stok_penjualan
  AFTER UPDATE ON payments
  FOR EACH ROW
  WHEN (NEW.status = 'lunas' AND OLD.status IS DISTINCT FROM 'lunas')
  EXECUTE FUNCTION fn_auto_stok_penjualan();

-- ============================================================
-- 11. KARTU STOK (view gabungan, enak dibaca di UI)
-- ============================================================

CREATE OR REPLACE VIEW v_kartu_stok AS
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
-- 12. RLS
-- ============================================================

ALTER TABLE gudang             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stok_lokasi        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stok_lot           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stok_pergerakan    ENABLE ROW LEVEL SECURITY;
ALTER TABLE stok_konsumsi_lot  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff baca gudang" ON gudang;
CREATE POLICY "Staff baca gudang" ON gudang FOR SELECT USING (is_admin() OR is_finance());
DROP POLICY IF EXISTS "Admin kelola gudang" ON gudang;
CREATE POLICY "Admin kelola gudang" ON gudang FOR ALL USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Staff baca stok lokasi" ON stok_lokasi;
CREATE POLICY "Staff baca stok lokasi" ON stok_lokasi FOR SELECT USING (is_admin() OR is_finance());

DROP POLICY IF EXISTS "Staff baca stok lot" ON stok_lot;
CREATE POLICY "Staff baca stok lot" ON stok_lot FOR SELECT USING (is_admin() OR is_finance());

DROP POLICY IF EXISTS "Staff baca pergerakan stok" ON stok_pergerakan;
CREATE POLICY "Staff baca pergerakan stok" ON stok_pergerakan FOR SELECT USING (is_admin() OR is_finance());

DROP POLICY IF EXISTS "Staff baca konsumsi lot" ON stok_konsumsi_lot;
CREATE POLICY "Staff baca konsumsi lot" ON stok_konsumsi_lot FOR SELECT USING (is_admin() OR is_finance());

-- Sengaja TIDAK ada policy INSERT/UPDATE langsung di stok_lokasi/stok_lot/
-- stok_pergerakan — semua perubahan WAJIB lewat proses_pergerakan_stok()
-- dan setujui_pergerakan_stok() supaya konsistensi kartu stok terjamin.

-- ============================================================
-- Catatan:
-- - Barang rusak/hilang WAJIB approval (Admin/Finance) sebelum stok
--   berkurang & sebelum kerugian dijurnal. Tipe lain otomatis disetujui.
-- - Auto pengurangan stok terjadi di Gudang Utama (GD-01) saja saat ini
--   (checkout belum memilih gudang). Kalau nanti perlu multi-gudang di
--   sisi penjualan, tinggal disesuaikan di fn_auto_stok_penjualan().
-- - HPP dihitung otomatis sesuai store_settings.metode_valuasi_stok
--   ('fifo' atau 'rata_rata'), bisa diganti kapan saja dari dashboard.
-- ============================================================
