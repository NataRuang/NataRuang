# 🪑 NataRuang

Toko furniture online premium untuk **Malang Raya** (Kota Malang, Kabupaten Malang, Kota Batu) — dibangun dengan Vite + Tailwind CSS + Supabase, siap deploy ke Vercel/Netlify.

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|---|---|
| Katalog produk | Filter, pencarian, sort, zoom foto, multi foto |
| Chatbot web | Rule-based FAQ + eskalasi WhatsApp |
| Estimasi ongkir | Lookup kota dari tabel, fallback manual |
| Watermark foto | Canvas API — otomatis saat upload |
| Invoice otomatis | `INV-YYYYMMDD-XXXX` via PostgreSQL trigger |
| Dashboard analitik | Produk terlaris, paling dilihat, grafik tren |
| Export laporan | Excel (SheetJS) + PDF (jsPDF) |
| Pembayaran manual | Transfer bank / QRIS + verifikasi admin |
| Realtime status | Supabase Realtime — tanpa refresh |
| Dark mode | Tersimpan di localStorage |

---

## 🛠 Stack

- **Frontend**: HTML5, Tailwind CSS v3, JavaScript ES6 (Vite)
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Realtime)
- **Hosting**: Vercel (free tier) — Netlify juga didukung via `netlify.toml`
- **Library**: jsPDF, SheetJS, QRCode.js, Chart.js

---

## 📦 Instalasi Lokal

### Prasyarat
- Node.js ≥ 20
- Akun Supabase (gratis)
- Akun Netlify (gratis)

### Langkah

```bash
# 1. Clone repo
git clone https://github.com/username/nataruang.git
cd nataruang

# 2. Install dependensi
npm install

# 3. Salin file env
cp .env.example .env
# Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY

# 4. Jalankan lokal
npm run dev
# Buka http://localhost:5173
```

---

## 🗄 Setup Database (Supabase)

1. Buat project baru di [supabase.com](https://supabase.com)
2. Buka **SQL Editor**
3. Salin seluruh isi `database/schema.sql` → **Run**
4. Salin seluruh isi `database/002_staff_roles.sql` → **Run**
   (migration ini menambahkan sistem akun staff multi-role: Admin / CS / Finance)

### Buat akun staff (Admin / CS / Finance)
Login staff memakai **username**, bukan email — tapi Supabase Auth tetap butuh
format email di baliknya. Karena project ini murni JAMstack (tanpa backend),
pembuatan akun dilakukan manual lewat Dashboard:

1. Supabase Dashboard → **Authentication** → **Users** → **Add user**
   - Email: `<username>@staff.nataruang.internal` (ganti `<username>` sesuai keinginan, huruf kecil, tanpa spasi)
   - Password: tentukan password awal
   - **Auto Confirm User**: wajib dicentang

2. Salin **User UID** yang baru dibuat, lalu jalankan di SQL Editor:
   ```sql
   INSERT INTO staff_profiles (id, username, nama_lengkap, role)
   VALUES ('TEMPEL-UUID-DI-SINI', 'budi', 'Budi Santoso', 'admin');
   -- role hanya boleh: 'admin' | 'cs' | 'finance'
   ```

3. Staff login di `/login.html` memakai **username** (`budi`) dan password dari
   langkah 1. Setelah login, password bisa diganti sendiri lewat tombol
   **Ganti Password** di dashboard — tidak perlu lewat Supabase Dashboard lagi.

> Catatan tahap saat ini: dashboard penuh (`admin.html`) baru aktif untuk role
> **Admin**. Dashboard khusus **CS** (live chat) dan **Finance** (laporan)
> menyusul di tahap pengembangan berikutnya — akun CS/Finance sudah bisa
> dibuat & login, tapi untuk sementara akan diarahkan kembali ke halaman
> login sampai dashboard masing-masing selesai dibangun.

### Setup Storage
Di Supabase Dashboard → **Storage** → buat dua bucket:
- `product-images` (public)
- `payment-proofs` (public)

Policy Storage untuk `product-images`:
```sql
-- Public read
CREATE POLICY "Public read product images"
ON storage.objects FOR SELECT USING (bucket_id = 'product-images');

-- Admin upload
CREATE POLICY "Admin upload product images"
ON storage.objects FOR INSERT
USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');
```

---

## 🚀 Deploy ke GitHub, Vercel & Supabase

### 1. Push ke GitHub
```bash
git init
git add .
git commit -m "Initial commit — NataRuang"
git branch -M main
git remote add origin https://github.com/USERNAME/nataruang.git
git push -u origin main
```
> `.gitignore` sudah mengecualikan `node_modules/`, `dist/`, dan `.env` — pastikan tidak pernah meng-commit file `.env` yang berisi kredensial.

### 2. Setup Supabase
Ikuti bagian **🗄 Setup Database (Supabase)** di bawah untuk membuat project, menjalankan `database/schema.sql` + `database/002_staff_roles.sql`, membuat akun staff, dan mengatur Storage bucket.

### 3. Deploy ke Vercel
**Via Vercel Dashboard (disarankan):**
1. Buka [vercel.com](https://vercel.com) → **Add New Project** → **Import Git Repository** → pilih repo `nataruang`
2. Vercel otomatis mendeteksi konfigurasi dari `vercel.json` (build command `npm run build`, output `dist`)
3. Di step **Environment Variables**, tambahkan:
   - `VITE_SUPABASE_URL` = URL project Supabase Anda
   - `VITE_SUPABASE_ANON_KEY` = anon/public key Supabase Anda (**bukan** `service_role` key!)
4. Klik **Deploy**

**Via Vercel CLI:**
```bash
npm install -g vercel
vercel login
vercel link
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel --prod
```

### 4. Setelah deploy
- Buka `https://nama-project-anda.vercel.app` — pastikan homepage & katalog produk tampil
- Buka `/login.html` lalu login dengan akun admin Supabase Auth yang sudah dibuat
- Cek tab **Pengaturan** di dashboard admin untuk mengisi info toko, rekening bank, dan QRIS

---

## 🌐 Deploy ke Netlify (alternatif)

### Via Netlify CLI
```bash
npm install -g netlify-cli
netlify login
netlify init
netlify env:set VITE_SUPABASE_URL      "https://xxx.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "eyJ..."
netlify deploy --prod
```

### Via Netlify Web
1. Push repo ke GitHub
2. Netlify Dashboard → **Add new site** → **Import from Git**
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Tambahkan environment variables di **Site settings → Environment variables**

---

## 🔑 Login Staff (Admin / CS / Finance)

Buka `https://nataruang.vercel.app/login.html` (atau link **Staff Login** di footer situs)

Gunakan **username** (bukan email) dan password akun staff — lihat bagian
**Buat akun staff** di atas untuk cara membuatnya. Password bisa diganti
sendiri lewat tombol **Ganti Password** setelah login.

---

## 📤 Backup Database

### Manual (via Supabase Dashboard)
```
Supabase Dashboard → Settings → Database → Backups → Download
```

### Via pg_dump (jika pakai Supabase Pro / Self-hosted)
```bash
pg_dump \
  --host=db.xxxx.supabase.co \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --format=custom \
  --file=backup-$(date +%Y%m%d).dump
```

### Script backup otomatis (simpan sebagai `scripts/backup.sh`)
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR

pg_dump \
  "postgresql://postgres:$DB_PASSWORD@db.$SUPABASE_REF.supabase.co:5432/postgres" \
  --format=custom \
  --file="$BACKUP_DIR/nataruang-$DATE.dump"

echo "Backup selesai: $BACKUP_DIR/nataruang-$DATE.dump"

# Hapus backup lebih dari 30 hari
find $BACKUP_DIR -name "*.dump" -mtime +30 -delete
```

---

## ♻ Restore Database

```bash
pg_restore \
  --host=db.xxxx.supabase.co \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --clean \
  --if-exists \
  backup-20260101.dump
```

> ⚠️ **Peringatan**: `--clean` akan menghapus data yang ada. Pastikan backup aman sebelum restore.

---

## 📁 Struktur Folder

```
nataruang/
├── index.html              # Beranda
├── admin.html              # Dashboard admin
├── login.html              # Login admin
├── checkout.html           # Halaman checkout
├── status.html             # Status pesanan
├── produk.html             # Katalog produk (marketplace)
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js       # Wajib ada agar Tailwind ter-compile oleh Vite
├── vercel.json             # Konfigurasi deploy Vercel + security headers
├── netlify.toml            # Konfigurasi deploy Netlify (alternatif)
├── .env.example
├── .gitignore
├── database/
│   ├── schema.sql          # Seluruh SQL (tabel, trigger, RLS, view, rating)
│   └── 002_staff_roles.sql # Migration: akun staff Admin/CS/Finance (login username)
├── public/
│   ├── images/
│   ├── icons/
│   ├── robots.txt
│   └── sitemap.xml
└── src/
    ├── lib/
    │   ├── supabase.js     # Supabase client
    │   ├── auth.js         # Autentikasi
    │   ├── api.js          # Semua query Supabase
    │   ├── utils.js        # Utilitas umum
    │   ├── watermark.js    # Watermark Canvas API
    │   ├── chatbot.js      # Engine chatbot rule-based
    │   └── report.js       # Export Excel & PDF
    ├── pages/
    │   ├── index.js        # Beranda
    │   ├── produk.js       # Katalog produk (search, filter, sort, pagination)
    │   ├── login.js        # Login
    │   ├── checkout.js     # Checkout
    │   ├── status.js       # Status pesanan
    │   └── admin.js        # Dashboard admin (semua tab CRUD)
    └── styles/
        └── main.css        # Tailwind + custom components
```

---

## 🔒 Keamanan

- ✅ Supabase RLS aktif pada semua tabel
- ✅ JWT via Supabase Auth
- ✅ Sanitasi HTML (`escapeHtml`) pada semua output dinamis
- ✅ Validasi input client-side + server-side (constraint DB)
- ✅ Rate limit login (client-side, 5 percobaan/5 menit)
- ✅ Security headers via `vercel.json` (dan `netlify.toml` untuk alternatif Netlify)
- ✅ Content Security Policy
- ✅ File upload validation (ukuran + jenis file)
- ✅ Watermark foto otomatis (cegah pemakaian tanpa izin)
- ✅ Soft delete (data tidak hilang permanen)
- ✅ Audit log perubahan status pesanan

---

## 📞 Dukungan

Hubungi tim pengembang via WhatsApp atau buka issue di repository ini.
