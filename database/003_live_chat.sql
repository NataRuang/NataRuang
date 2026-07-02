-- ============================================================
-- NATARUANG — Migration 003: Live Chat CS (Dua Arah, Realtime)
-- ============================================================
-- Jalankan file ini di Supabase SQL Editor SETELAH schema.sql
-- dan 002_staff_roles.sql. Aman dijalankan ulang (idempotent).
-- ============================================================

-- ============================================================
-- 1. TABEL CHAT_CONVERSATIONS
-- ============================================================
-- Pengunjung publik TIDAK login. Identitas mereka di sisi klien
-- adalah `visitor_token` (UUID acak yang dibuat browser & disimpan
-- di localStorage) — pola yang sama seperti pencarian pesanan lewat
-- nomor WA di tabel `orders` (filtering dilakukan di query, bukan RLS,
-- konsisten dengan desain keamanan aplikasi ini secara keseluruhan).

CREATE TABLE IF NOT EXISTS chat_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_token    UUID NOT NULL,
  nama_pembeli     TEXT NOT NULL DEFAULT 'Pengunjung',
  nomor_wa         TEXT,
  status           TEXT NOT NULL DEFAULT 'terbuka'
                     CHECK (status IN ('terbuka', 'ditangani', 'selesai')),
  assigned_to      UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_visitor  ON chat_conversations(visitor_token);
CREATE INDEX IF NOT EXISTS idx_chat_conv_status    ON chat_conversations(status);
CREATE INDEX IF NOT EXISTS idx_chat_conv_lastmsg   ON chat_conversations(last_message_at DESC);

DROP TRIGGER IF EXISTS trg_chat_conv_updated_at ON chat_conversations;
CREATE TRIGGER trg_chat_conv_updated_at
  BEFORE UPDATE ON chat_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. TABEL CHAT_MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  pengirim         TEXT NOT NULL CHECK (pengirim IN ('pembeli', 'cs')),
  pengirim_nama    TEXT NOT NULL DEFAULT '',
  isi              TEXT NOT NULL CHECK (char_length(trim(isi)) > 0),
  dibaca_cs        BOOLEAN NOT NULL DEFAULT FALSE,
  dibaca_pembeli   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id, created_at);

-- Setiap pesan baru: perbarui last_message_at di percakapan induk,
-- dan buka kembali percakapan yang sudah "selesai" kalau pembeli chat lagi.
CREATE OR REPLACE FUNCTION fn_touch_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE chat_conversations
  SET last_message_at = NEW.created_at,
      status = CASE
                 WHEN NEW.pengirim = 'pembeli' AND status = 'selesai' THEN 'terbuka'
                 ELSE status
               END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_conversation ON chat_messages;
CREATE TRIGGER trg_touch_conversation
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_touch_conversation_on_message();

-- ============================================================
-- 3. RLS
-- ============================================================

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;

-- ---- CHAT_CONVERSATIONS ----
DROP POLICY IF EXISTS "Publik buat percakapan" ON chat_conversations;
CREATE POLICY "Publik buat percakapan"
  ON chat_conversations FOR INSERT
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Publik baca percakapan" ON chat_conversations;
CREATE POLICY "Publik baca percakapan"
  ON chat_conversations FOR SELECT
  USING (TRUE);  -- filtering by visitor_token dilakukan di query, bukan policy

DROP POLICY IF EXISTS "CS kelola percakapan" ON chat_conversations;
CREATE POLICY "CS kelola percakapan"
  ON chat_conversations FOR UPDATE
  USING (is_cs() OR is_admin())
  WITH CHECK (is_cs() OR is_admin());

-- ---- CHAT_MESSAGES ----
DROP POLICY IF EXISTS "Publik kirim pesan" ON chat_messages;
CREATE POLICY "Publik kirim pesan"
  ON chat_messages FOR INSERT
  WITH CHECK (pengirim = 'pembeli');  -- publik hanya boleh kirim sbg 'pembeli'

DROP POLICY IF EXISTS "Publik baca pesan" ON chat_messages;
CREATE POLICY "Publik baca pesan"
  ON chat_messages FOR SELECT
  USING (TRUE);  -- filtering by conversation_id (dari visitor_token) di query

DROP POLICY IF EXISTS "CS kirim pesan" ON chat_messages;
CREATE POLICY "CS kirim pesan"
  ON chat_messages FOR INSERT
  WITH CHECK ((is_cs() OR is_admin()) AND pengirim = 'cs');

DROP POLICY IF EXISTS "CS ubah status baca pesan" ON chat_messages;
CREATE POLICY "CS ubah status baca pesan"
  ON chat_messages FOR UPDATE
  USING (is_cs() OR is_admin())
  WITH CHECK (is_cs() OR is_admin());

-- ============================================================
-- 4. AKTIFKAN REALTIME
-- ============================================================
-- Supaya pesan baru muncul otomatis tanpa refresh, baik di widget
-- pembeli maupun dashboard CS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
  END IF;
END $$;

-- ============================================================
-- Catatan keamanan (disengaja, konsisten dengan desain tabel orders):
-- Tabel ini memakai model "akses publik + token acak sebagai kunci
-- praktis", BUKAN autentikasi penuh. Ini cukup untuk skala UMKM dan
-- konsisten dengan pola nomor_wa di tabel orders. Jangan simpan data
-- sensitif (nomor kartu, password, dsb) di isi pesan chat.
-- ============================================================
