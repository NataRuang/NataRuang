-- Migration: tambah pengaturan Promo/Flash Sale & Member ke store_settings
-- Aman dijalankan berkali-kali (idempotent) — baris yang sudah ada tidak akan diduplikasi/ditimpa.

INSERT INTO store_settings (key, value, keterangan) VALUES
  ('promo_aktif',      'false', 'Tampilkan banner promo/flash sale di halaman utama? (true/false)'),
  ('promo_judul',      '',      'Judul promo, mis. "Flash Sale Akhir Bulan"'),
  ('promo_teks',       '',      'Deskripsi singkat promo'),
  ('promo_link',       '/produk.html', 'Link tombol "Lihat Promo", mis. /produk.html?kategori=sofa'),
  ('promo_berakhir',   '',      'Tanggal & jam promo berakhir, format: 2026-07-31T23:59 (untuk hitung mundur)'),

  ('member_aktif',     'false', 'Tampilkan bagian Member di halaman utama? (true/false)'),
  ('member_benefit_1', 'Diskon eksklusif hingga 10% setiap belanja', 'Manfaat member #1'),
  ('member_benefit_2', 'Respon WhatsApp prioritas & lebih cepat',    'Manfaat member #2'),
  ('member_benefit_3', 'Akses lebih awal ke promo & koleksi baru',   'Manfaat member #3'),
  ('member_benefit_4', 'Gratis konsultasi desain interior',          'Manfaat member #4')
ON CONFLICT (key) DO NOTHING;
