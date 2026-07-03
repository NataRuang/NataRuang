-- ============================================================
-- NATARUANG — Migration 005: Akuntansi (Jurnal, Buku Besar, Neraca)
-- ============================================================
-- Jalankan SETELAH schema.sql, 002_staff_roles.sql, 003_live_chat.sql.
-- Aman dijalankan ulang (idempotent).
--
-- Cakupan:
--  1. Bagan Akun (Chart of Accounts) standar untuk UMKM
--  2. Jurnal Umum + Buku Besar (double-entry, selalu balance dijamin
--     oleh function buat_jurnal() — tidak ada jalur INSERT langsung)
--  3. Auto-jurnal setiap pembayaran diverifikasi "lunas"
--  4. Pondasi PPN (dorman/nonaktif secara default lewat toggle toko_pkp)
--  5. Neraca & Laba Rugi (function, bukan tabel statis)
--
-- BELUM tercakup (menyusul tahap berikutnya): pencatatan beban/pengeluaran
-- operasional (gaji, sewa, HPP dsb). Akunnya sudah disiapkan di bagian
-- BEBAN, tinggal dibuatkan form input di Stage berikutnya.
-- ============================================================


-- ============================================================
-- 1. TIPE DATA
-- ============================================================

DO $$ BEGIN
  CREATE TYPE akun_tipe AS ENUM ('aset', 'kewajiban', 'ekuitas', 'pendapatan', 'beban');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE saldo_normal_tipe AS ENUM ('debit', 'kredit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. BAGAN AKUN (CHART OF ACCOUNTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS akun_akuntansi (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_akun     VARCHAR(20) NOT NULL UNIQUE,
  nama_akun     VARCHAR(150) NOT NULL,
  tipe          akun_tipe NOT NULL,
  saldo_normal  saldo_normal_tipe NOT NULL,
  kontra        BOOLEAN NOT NULL DEFAULT FALSE,  -- akun kontra, mis. "Diskon Penjualan", "Prive"
  aktif         BOOLEAN NOT NULL DEFAULT TRUE,
  keterangan    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_akun_tipe ON akun_akuntansi(tipe);

-- ============================================================
-- 3. JURNAL UMUM (HEADER + DETAIL)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS seq_jurnal START 1;

CREATE TABLE IF NOT EXISTS jurnal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor_jurnal     VARCHAR(20) UNIQUE,
  tanggal          DATE NOT NULL DEFAULT CURRENT_DATE,
  keterangan       TEXT NOT NULL,
  sumber           VARCHAR(30) NOT NULL DEFAULT 'manual'
                     CHECK (sumber IN ('manual', 'otomatis_pembayaran', 'otomatis_lainnya')),
  referensi_tabel  VARCHAR(50),
  referensi_id     UUID,
  dibuat_oleh      UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal    ON jurnal_entries(tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_referensi  ON jurnal_entries(referensi_tabel, referensi_id);

CREATE TABLE IF NOT EXISTS jurnal_detail (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurnal_id    UUID NOT NULL REFERENCES jurnal_entries(id) ON DELETE CASCADE,
  akun_id      UUID NOT NULL REFERENCES akun_akuntansi(id),
  debit        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  kredit       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (kredit >= 0),
  keterangan   TEXT,
  CONSTRAINT chk_jurnal_detail_satu_sisi CHECK (NOT (debit > 0 AND kredit > 0))
);

CREATE INDEX IF NOT EXISTS idx_jurnal_detail_jurnal ON jurnal_detail(jurnal_id);
CREATE INDEX IF NOT EXISTS idx_jurnal_detail_akun   ON jurnal_detail(akun_id);

-- Nomor jurnal otomatis: JU-000001, JU-000002, dst.
CREATE OR REPLACE FUNCTION generate_nomor_jurnal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nomor_jurnal IS NULL OR NEW.nomor_jurnal = '' THEN
    NEW.nomor_jurnal := 'JU-' || LPAD(nextval('seq_jurnal')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jurnal_nomor ON jurnal_entries;
CREATE TRIGGER trg_jurnal_nomor
  BEFORE INSERT ON jurnal_entries
  FOR EACH ROW EXECUTE FUNCTION generate_nomor_jurnal();

-- ============================================================
-- 4. FUNCTION: buat_jurnal() — SATU-SATUNYA JALUR MENULIS JURNAL
-- ============================================================
-- Menjamin setiap entri SELALU balance (total debit = total kredit)
-- sebelum baris manapun disimpan. Dipanggil dari UI (manual) maupun
-- trigger otomatis (pembayaran lunas).

CREATE OR REPLACE FUNCTION buat_jurnal(
  p_tanggal          DATE,
  p_keterangan       TEXT,
  p_sumber           TEXT,
  p_referensi_tabel  TEXT,
  p_referensi_id     UUID,
  p_baris            JSONB   -- [{"akun_id": "...", "debit": 0, "kredit": 0, "keterangan": "..."}, ...]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jurnal_id     UUID;
  v_total_debit   NUMERIC := 0;
  v_total_kredit  NUMERIC := 0;
  v_baris         JSONB;
BEGIN
  IF NOT (is_admin() OR is_finance()) THEN
    RAISE EXCEPTION 'Tidak memiliki akses membuat jurnal akuntansi';
  END IF;

  IF jsonb_array_length(p_baris) < 2 THEN
    RAISE EXCEPTION 'Jurnal minimal harus punya 2 baris (debit & kredit)';
  END IF;

  SELECT COALESCE(SUM((b->>'debit')::numeric), 0), COALESCE(SUM((b->>'kredit')::numeric), 0)
  INTO v_total_debit, v_total_kredit
  FROM jsonb_array_elements(p_baris) b;

  IF v_total_debit <> v_total_kredit THEN
    RAISE EXCEPTION 'Jurnal tidak balance: total debit % ≠ total kredit %', v_total_debit, v_total_kredit;
  END IF;

  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'Jurnal tidak boleh kosong (debit dan kredit = 0)';
  END IF;

  INSERT INTO jurnal_entries (tanggal, keterangan, sumber, referensi_tabel, referensi_id, dibuat_oleh)
  VALUES (p_tanggal, p_keterangan, p_sumber, p_referensi_tabel, p_referensi_id, auth.uid())
  RETURNING id INTO v_jurnal_id;

  FOR v_baris IN SELECT * FROM jsonb_array_elements(p_baris)
  LOOP
    INSERT INTO jurnal_detail (jurnal_id, akun_id, debit, kredit, keterangan)
    VALUES (
      v_jurnal_id,
      (v_baris->>'akun_id')::uuid,
      COALESCE((v_baris->>'debit')::numeric, 0),
      COALESCE((v_baris->>'kredit')::numeric, 0),
      v_baris->>'keterangan'
    );
  END LOOP;

  RETURN v_jurnal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION buat_jurnal(DATE, TEXT, TEXT, TEXT, UUID, JSONB) TO authenticated;

-- ============================================================
-- 5. AUTO-JURNAL: PEMBAYARAN DIVERIFIKASI "LUNAS"
-- ============================================================
-- Setiap payments.status berubah MENJADI 'lunas', otomatis dibuatkan
-- jurnal: Debit Bank, Kredit Pendapatan Penjualan (+ Kredit Utang PPN
-- Keluaran bila toko_pkp aktif) + Kredit Pendapatan Ongkos Kirim.
-- Kalau COA belum lengkap / ada error, auto-jurnal DILEWATI (tidak
-- menggagalkan proses verifikasi pembayaran itu sendiri).

CREATE OR REPLACE FUNCTION fn_auto_jurnal_pembayaran()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order            RECORD;
  v_pkp              BOOLEAN;
  v_tarif            NUMERIC;
  v_dpp              NUMERIC;
  v_ppn              NUMERIC;
  v_akun_kas         UUID;
  v_akun_pendapatan  UUID;
  v_akun_ongkir      UUID;
  v_akun_ppn         UUID;
  v_akun_diskon      UUID;
  v_baris            JSONB;
  v_sudah_ada        BOOLEAN;
BEGIN
  IF NEW.status <> 'lunas' OR (TG_OP = 'UPDATE' AND OLD.status = 'lunas') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jurnal_entries WHERE referensi_tabel = 'payments' AND referensi_id = NEW.id
  ) INTO v_sudah_ada;
  IF v_sudah_ada THEN
    RETURN NEW; -- cegah jurnal dobel
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE((SELECT value FROM store_settings WHERE key = 'toko_pkp'), 'false') = 'true' INTO v_pkp;
  SELECT COALESCE((SELECT value FROM store_settings WHERE key = 'tarif_ppn_persen'), '11')::numeric INTO v_tarif;

  SELECT id INTO v_akun_kas        FROM akun_akuntansi WHERE kode_akun = '1-102';
  SELECT id INTO v_akun_pendapatan FROM akun_akuntansi WHERE kode_akun = '4-101';
  SELECT id INTO v_akun_ongkir     FROM akun_akuntansi WHERE kode_akun = '4-102';
  SELECT id INTO v_akun_ppn        FROM akun_akuntansi WHERE kode_akun = '2-102';
  SELECT id INTO v_akun_diskon     FROM akun_akuntansi WHERE kode_akun = '4-103';

  IF v_akun_kas IS NULL OR v_akun_pendapatan IS NULL THEN
    RETURN NEW; -- COA belum di-setup, jangan gagalkan verifikasi pembayaran
  END IF;

  IF v_pkp AND v_tarif > 0 THEN
    v_dpp := ROUND(v_order.subtotal / (1 + v_tarif / 100), 2);
    v_ppn := v_order.subtotal - v_dpp;
  ELSE
    v_dpp := v_order.subtotal;
    v_ppn := 0;
  END IF;

  v_baris := jsonb_build_array(
    jsonb_build_object('akun_id', v_akun_kas, 'debit', v_order.total, 'kredit', 0,
      'keterangan', 'Penerimaan pembayaran ' || v_order.invoice_number)
  );

  IF v_order.diskon_voucher > 0 AND v_akun_diskon IS NOT NULL THEN
    v_baris := v_baris || jsonb_build_array(
      jsonb_build_object('akun_id', v_akun_diskon, 'debit', v_order.diskon_voucher, 'kredit', 0,
        'keterangan', 'Diskon voucher ' || COALESCE(v_order.voucher_code, ''))
    );
  END IF;

  v_baris := v_baris || jsonb_build_array(
    jsonb_build_object('akun_id', v_akun_pendapatan, 'debit', 0, 'kredit', v_dpp,
      'keterangan', 'Penjualan produk ' || v_order.invoice_number)
  );

  IF v_ppn > 0 AND v_akun_ppn IS NOT NULL THEN
    v_baris := v_baris || jsonb_build_array(
      jsonb_build_object('akun_id', v_akun_ppn, 'debit', 0, 'kredit', v_ppn,
        'keterangan', 'PPN Keluaran ' || v_order.invoice_number)
    );
  END IF;

  IF v_order.ongkir > 0 AND v_akun_ongkir IS NOT NULL THEN
    v_baris := v_baris || jsonb_build_array(
      jsonb_build_object('akun_id', v_akun_ongkir, 'debit', 0, 'kredit', v_order.ongkir,
        'keterangan', 'Ongkos kirim ' || v_order.invoice_number)
    );
  END IF;

  PERFORM buat_jurnal(
    CURRENT_DATE, 'Pelunasan ' || v_order.invoice_number,
    'otomatis_pembayaran', 'payments', NEW.id, v_baris
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Auto-jurnal gagal untuk payment %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_jurnal_pembayaran ON payments;
CREATE TRIGGER trg_auto_jurnal_pembayaran
  AFTER UPDATE ON payments
  FOR EACH ROW
  WHEN (NEW.status = 'lunas' AND OLD.status IS DISTINCT FROM 'lunas')
  EXECUTE FUNCTION fn_auto_jurnal_pembayaran();

-- ============================================================
-- 6. BUKU BESAR, NERACA, LABA RUGI (function, bukan tabel statis)
-- ============================================================

CREATE OR REPLACE FUNCTION get_buku_besar(p_akun_id UUID, p_dari DATE DEFAULT NULL, p_sampai DATE DEFAULT NULL)
RETURNS TABLE (
  tanggal DATE, nomor_jurnal VARCHAR, keterangan TEXT, debit NUMERIC, kredit NUMERIC, saldo NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saldo_normal saldo_normal_tipe;
BEGIN
  IF NOT (is_admin() OR is_finance()) THEN
    RAISE EXCEPTION 'Tidak memiliki akses';
  END IF;

  SELECT saldo_normal INTO v_saldo_normal FROM akun_akuntansi WHERE id = p_akun_id;

  RETURN QUERY
  SELECT je.tanggal, je.nomor_jurnal, COALESCE(NULLIF(jd.keterangan, ''), je.keterangan),
    jd.debit, jd.kredit,
    SUM(CASE WHEN v_saldo_normal = 'debit' THEN jd.debit - jd.kredit ELSE jd.kredit - jd.debit END)
      OVER (ORDER BY je.tanggal, je.created_at, jd.id) AS saldo
  FROM jurnal_detail jd
  JOIN jurnal_entries je ON je.id = jd.jurnal_id
  WHERE jd.akun_id = p_akun_id
    AND (p_dari IS NULL OR je.tanggal >= p_dari)
    AND (p_sampai IS NULL OR je.tanggal <= p_sampai)
  ORDER BY je.tanggal, je.created_at, jd.id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_buku_besar(UUID, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION get_neraca(p_per_tanggal DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (akun_id UUID, kode_akun VARCHAR, nama_akun VARCHAR, tipe akun_tipe, kontra BOOLEAN, saldo NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_admin() OR is_finance()) THEN
    RAISE EXCEPTION 'Tidak memiliki akses';
  END IF;

  RETURN QUERY
  SELECT a.id, a.kode_akun, a.nama_akun, a.tipe, a.kontra,
    COALESCE(SUM(CASE WHEN a.saldo_normal = 'debit' THEN jd.debit - jd.kredit ELSE jd.kredit - jd.debit END), 0) AS saldo
  FROM akun_akuntansi a
  LEFT JOIN (
    jurnal_detail jd JOIN jurnal_entries je
      ON je.id = jd.jurnal_id AND je.tanggal <= p_per_tanggal
  ) ON jd.akun_id = a.id
  WHERE a.tipe IN ('aset', 'kewajiban', 'ekuitas')
  GROUP BY a.id, a.kode_akun, a.nama_akun, a.tipe, a.kontra
  ORDER BY a.kode_akun;
END;
$$;

GRANT EXECUTE ON FUNCTION get_neraca(DATE) TO authenticated;

CREATE OR REPLACE FUNCTION get_laba_rugi(p_dari DATE, p_sampai DATE)
RETURNS TABLE (akun_id UUID, kode_akun VARCHAR, nama_akun VARCHAR, tipe akun_tipe, kontra BOOLEAN, jumlah NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (is_admin() OR is_finance()) THEN
    RAISE EXCEPTION 'Tidak memiliki akses';
  END IF;

  RETURN QUERY
  SELECT a.id, a.kode_akun, a.nama_akun, a.tipe, a.kontra,
    COALESCE(SUM(CASE WHEN a.saldo_normal = 'debit' THEN jd.debit - jd.kredit ELSE jd.kredit - jd.debit END), 0) AS jumlah
  FROM akun_akuntansi a
  LEFT JOIN (
    jurnal_detail jd JOIN jurnal_entries je
      ON je.id = jd.jurnal_id AND je.tanggal BETWEEN p_dari AND p_sampai
  ) ON jd.akun_id = a.id
  WHERE a.tipe IN ('pendapatan', 'beban')
  GROUP BY a.id, a.kode_akun, a.nama_akun, a.tipe, a.kontra
  ORDER BY a.kode_akun;
END;
$$;

GRANT EXECUTE ON FUNCTION get_laba_rugi(DATE, DATE) TO authenticated;

-- ============================================================
-- 7. RLS
-- ============================================================

ALTER TABLE akun_akuntansi ENABLE ROW LEVEL SECURITY;
ALTER TABLE jurnal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE jurnal_detail  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance baca akun" ON akun_akuntansi;
CREATE POLICY "Finance baca akun" ON akun_akuntansi
  FOR SELECT USING (is_admin() OR is_finance());

DROP POLICY IF EXISTS "Finance kelola akun" ON akun_akuntansi;
CREATE POLICY "Finance kelola akun" ON akun_akuntansi
  FOR ALL USING (is_admin() OR is_finance()) WITH CHECK (is_admin() OR is_finance());

DROP POLICY IF EXISTS "Finance baca jurnal" ON jurnal_entries;
CREATE POLICY "Finance baca jurnal" ON jurnal_entries
  FOR SELECT USING (is_admin() OR is_finance());

DROP POLICY IF EXISTS "Finance baca jurnal detail" ON jurnal_detail;
CREATE POLICY "Finance baca jurnal detail" ON jurnal_detail
  FOR SELECT USING (is_admin() OR is_finance());

-- Sengaja TIDAK ada policy INSERT langsung di jurnal_entries/jurnal_detail —
-- semua entri WAJIB lewat buat_jurnal() supaya balance selalu terjamin.
-- Hanya Admin yang boleh menghapus (koreksi), demi jejak audit.
DROP POLICY IF EXISTS "Admin hapus jurnal" ON jurnal_entries;
CREATE POLICY "Admin hapus jurnal" ON jurnal_entries
  FOR DELETE USING (is_admin());

-- ============================================================
-- 8. PONDASI PPN (dorman secara default)
-- ============================================================

INSERT INTO store_settings (key, value, keterangan) VALUES
  ('toko_pkp',          'false', 'Apakah toko sudah dikukuhkan sebagai Pengusaha Kena Pajak (PKP). Kalau true, PPN otomatis dipisah di jurnal penjualan.'),
  ('tarif_ppn_persen',  '11',    'Tarif PPN (%) yang dipakai kalau toko_pkp = true')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 9. SEED BAGAN AKUN STANDAR
-- ============================================================

INSERT INTO akun_akuntansi (kode_akun, nama_akun, tipe, saldo_normal, kontra, keterangan) VALUES
  ('1-101', 'Kas',                            'aset',       'debit',  FALSE, 'Kas tunai di tangan'),
  ('1-102', 'Bank',                           'aset',       'debit',  FALSE, 'Saldo rekening bank/e-wallet toko — dipakai auto-jurnal pembayaran'),
  ('1-103', 'Piutang Usaha',                  'aset',       'debit',  FALSE, 'Piutang dari pelanggan'),
  ('1-104', 'Persediaan Barang Dagang',       'aset',       'debit',  FALSE, 'Nilai stok barang dagang'),
  ('1-201', 'Peralatan',                      'aset',       'debit',  FALSE, 'Peralatan & inventaris toko'),
  ('1-202', 'Akumulasi Penyusutan Peralatan', 'aset',       'kredit', TRUE,  'Kontra aset — akumulasi penyusutan'),
  ('2-101', 'Utang Usaha',                    'kewajiban',  'kredit', FALSE, 'Utang ke supplier/pemasok'),
  ('2-102', 'Utang PPN Keluaran',             'kewajiban',  'kredit', FALSE, 'PPN yang dipungut dari pembeli, wajib disetor — dipakai auto-jurnal kalau toko_pkp aktif'),
  ('2-103', 'Utang PPh',                      'kewajiban',  'kredit', FALSE, 'Pondasi pajak penghasilan — belum aktif dipakai'),
  ('3-101', 'Modal Pemilik',                  'ekuitas',    'kredit', FALSE, 'Setoran modal pemilik'),
  ('3-102', 'Prive',                          'ekuitas',    'debit',  TRUE,  'Pengambilan pribadi pemilik — kontra ekuitas'),
  ('3-103', 'Laba Ditahan',                   'ekuitas',    'kredit', FALSE, 'Akumulasi laba tahun berjalan/lalu'),
  ('4-101', 'Pendapatan Penjualan',           'pendapatan', 'kredit', FALSE, 'Pendapatan dari penjualan produk — dipakai auto-jurnal pembayaran'),
  ('4-102', 'Pendapatan Ongkos Kirim',        'pendapatan', 'kredit', FALSE, 'Ongkos kirim yang diterima dari pembeli'),
  ('4-103', 'Diskon Penjualan',               'pendapatan', 'debit',  TRUE,  'Kontra pendapatan — potongan/voucher'),
  ('5-101', 'Harga Pokok Penjualan (HPP)',    'beban',      'debit',  FALSE, 'Pondasi — pencatatan HPP menyusul di tahap berikutnya'),
  ('6-101', 'Beban Operasional',              'beban',      'debit',  FALSE, 'Pondasi — biaya operasional umum menyusul di tahap berikutnya'),
  ('6-102', 'Beban Gaji',                     'beban',      'debit',  FALSE, 'Pondasi — biaya gaji menyusul di tahap berikutnya'),
  ('6-103', 'Beban Sewa',                     'beban',      'debit',  FALSE, 'Pondasi — biaya sewa menyusul di tahap berikutnya'),
  ('6-104', 'Beban Pajak Penghasilan (PPh)',  'beban',      'debit',  FALSE, 'Pondasi perpajakan — menyusul di tahap berikutnya')
ON CONFLICT (kode_akun) DO NOTHING;

-- ============================================================
-- Catatan penting:
-- - Semua entri jurnal WAJIB lewat function buat_jurnal() — tidak ada
--   jalur INSERT langsung ke jurnal_entries/jurnal_detail dari client,
--   supaya tidak mungkin ada jurnal yang tidak balance.
-- - Auto-jurnal HANYA jalan saat payments.status berubah MENJADI 'lunas'
--   (bukan re-trigger kalau statusnya sudah lunas sebelumnya).
-- - PPN masih DORMAN (toko_pkp = false) sampai diaktifkan lewat menu
--   Pengaturan Pajak di dashboard Finance/Admin.
-- ============================================================
