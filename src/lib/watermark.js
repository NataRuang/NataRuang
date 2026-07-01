// src/lib/watermark.js
// Semua proses terjadi di sisi client (browser), tanpa server function.
// Hasilnya berupa Blob yang langsung diunggah ke Supabase Storage.

/**
 * Terapkan watermark teks pada gambar
 * @param {File|Blob} imageFile   File foto asli dari input
 * @param {string}    teks        Teks watermark (misal nama toko)
 * @param {object}    opts        Opsi opsional
 * @returns {Promise<Blob>}       Blob hasil watermark (JPEG, quality 0.88)
 */
export async function applyWatermark(imageFile, teks = 'NataRuang', opts = {}) {
  const {
    opacity    = 0.35,    // transparansi watermark (0–1)
    fontSize   = null,    // null = auto berdasarkan lebar gambar
    color      = '#ffffff',
    repeat     = true,    // ulangi watermark secara diagonal
    quality    = 0.88     // kualitas JPEG output
  } = opts

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = reject
    img.onload = () => {
      const canvas  = document.createElement('canvas')
      const W       = img.naturalWidth
      const H       = img.naturalHeight
      canvas.width  = W
      canvas.height = H

      const ctx = canvas.getContext('2d')

      // Gambar foto asli
      ctx.drawImage(img, 0, 0, W, H)

      // Konfigurasi teks watermark
      const size = fontSize || Math.max(16, Math.round(W / 18))
      ctx.font        = `${size}px sans-serif`
      ctx.fillStyle   = color
      ctx.globalAlpha = opacity

      if (repeat) {
        // Watermark berulang diagonal
        ctx.save()
        ctx.translate(W / 2, H / 2)
        ctx.rotate(-Math.PI / 6)  // 30° miring

        const cols = Math.ceil(W / (size * 10)) + 2
        const rows = Math.ceil(H / (size * 3))  + 2
        const gapX = size * 10
        const gapY = size * 3.5

        for (let r = -rows; r <= rows; r++) {
          for (let c = -cols; c <= cols; c++) {
            ctx.fillText(teks, c * gapX, r * gapY)
          }
        }
        ctx.restore()
      } else {
        // Watermark sekali di pojok kanan bawah
        ctx.textAlign    = 'right'
        ctx.textBaseline = 'bottom'
        const pad = Math.round(W * 0.02)
        ctx.fillText(teks, W - pad, H - pad)
      }

      ctx.globalAlpha = 1
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Gagal konversi canvas ke Blob')),
        'image/jpeg', quality)
    }
    img.src = URL.createObjectURL(imageFile)
  })
}

/**
 * Resize gambar sebelum proses watermark agar tidak terlalu besar
 * @param {File|Blob} imageFile
 * @param {number}    maxWidth    default 1920px
 * @param {number}    maxHeight   default 1920px
 * @returns {Promise<Blob>}
 */
export async function resizeImage(imageFile, maxWidth = 1920, maxHeight = 1920) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = reject
    img.onload = () => {
      let W = img.naturalWidth
      let H = img.naturalHeight

      if (W <= maxWidth && H <= maxHeight) {
        // Tidak perlu resize
        resolve(imageFile)
        return
      }

      const ratio = Math.min(maxWidth / W, maxHeight / H)
      W = Math.round(W * ratio)
      H = Math.round(H * ratio)

      const canvas = document.createElement('canvas')
      canvas.width  = W
      canvas.height = H
      canvas.getContext('2d').drawImage(img, 0, 0, W, H)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Gagal resize')),
        'image/jpeg', 0.92)
    }
    img.src = URL.createObjectURL(imageFile)
  })
}

/**
 * Validasi file gambar sebelum proses
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImageFile(file) {
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
  const MAX_MB  = 5

  if (!ALLOWED.includes(file.type)) {
    return { valid: false, error: 'Format file harus JPG, PNG, atau WebP' }
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    return { valid: false, error: `Ukuran file maksimal ${MAX_MB} MB` }
  }
  return { valid: true }
}

/**
 * Buat nama file yang aman dan unik untuk Supabase Storage
 * @param {string} originalName
 * @param {string} prefix        misal 'produk'
 * @returns {string}             misal 'produk-1718800000000-a1b2c3.jpg'
 */
export function generateFileName(originalName, prefix = 'img') {
  const ext    = originalName.split('.').pop().toLowerCase().replace('jpg', 'jpg')
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now()}-${random}.${ext === 'jpeg' ? 'jpg' : ext}`
}

/**
 * Proses lengkap: validasi → resize → watermark → siap upload
 * @param {File}      file        File asli dari <input type="file">
 * @param {string}    teksWM      Teks watermark
 * @param {object}    wmOpts      Opsi watermark
 * @returns {Promise<{ blob: Blob, fileName: string, previewUrl: string }>}
 */
export async function prosesGambarProduk(file, teksWM = 'NataRuang', wmOpts = {}) {
  const validasi = validateImageFile(file)
  if (!validasi.valid) throw new Error(validasi.error)

  const resized      = await resizeImage(file)
  const watermarked  = await applyWatermark(resized, teksWM, wmOpts)
  const fileName     = generateFileName(file.name, 'produk')
  const previewUrl   = URL.createObjectURL(watermarked)

  return { blob: watermarked, fileName, previewUrl }
}
