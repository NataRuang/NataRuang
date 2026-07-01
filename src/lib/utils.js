// src/lib/utils.js

// ── Format & Sanitasi ──────────────────────────────────────

/** Format angka ke Rupiah */
export function formatRupiah(angka) {
  if (angka === null || angka === undefined) return 'Rp 0'
  return new Intl.NumberFormat('id-ID', {
    style:    'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(angka)
}

/** Format tanggal ke Indonesia */
export function formatTanggal(iso, options = {}) {
  if (!iso) return '-'
  const defaults = { day:'numeric', month:'long', year:'numeric' }
  return new Date(iso).toLocaleDateString('id-ID', { ...defaults, ...options })
}

/** Format tanggal + jam */
export function formatDatetime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID', {
    day:'numeric', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  })
}

/** Sanitasi string (escape HTML) untuk mencegah XSS */
export function escapeHtml(str) {
  if (typeof str !== 'string') return ''
  const map = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }
  return str.replace(/[&<>"']/g, m => map[m])
}

/** Buat slug dari teks */
export function toSlug(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
}

/** Validasi nomor WA Indonesia */
export function validateWA(nomor) {
  const clean = nomor.replace(/\D/g, '')
  return /^(08|628)\d{8,12}$/.test(clean)
}

/** Normalize nomor WA ke format 628xxx */
export function normalizeWA(nomor) {
  let clean = nomor.replace(/\D/g, '')
  if (clean.startsWith('08')) clean = '62' + clean.slice(1)
  if (clean.startsWith('8'))  clean = '62' + clean
  return clean
}

// ── Debounce & Throttle ────────────────────────────────────

export function debounce(fn, delay = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function throttle(fn, limit = 1000) {
  let last = 0
  return (...args) => {
    const now = Date.now()
    if (now - last >= limit) { last = now; fn(...args) }
  }
}

// ── Toast Notification ─────────────────────────────────────

let toastContainer

function getToastContainer() {
  if (toastContainer) return toastContainer
  toastContainer = document.createElement('div')
  toastContainer.id = 'toast-container'
  toastContainer.className = [
    'fixed bottom-5 right-5 z-[9999]',
    'flex flex-col gap-2 items-end pointer-events-none'
  ].join(' ')
  document.body.appendChild(toastContainer)
  return toastContainer
}

/**
 * Tampilkan toast notification
 * @param {string} pesan
 * @param {'success'|'error'|'info'|'warning'} tipe
 * @param {number} durasi  ms
 */
export function toast(pesan, tipe = 'info', durasi = 3500) {
  const container = getToastContainer()
  const warna = {
    success: 'bg-green-600 text-white',
    error:   'bg-red-600 text-white',
    warning: 'bg-yellow-500 text-white',
    info:    'bg-charcoal-800 text-white dark:bg-charcoal-200 dark:text-charcoal-900'
  }[tipe] || 'bg-charcoal-800 text-white'

  const el = document.createElement('div')
  el.className = [
    'pointer-events-auto px-4 py-3 rounded-xl shadow-dialog',
    'text-sm font-medium max-w-xs animate-slide-up',
    warna
  ].join(' ')
  el.textContent = escapeHtml(pesan)
  container.appendChild(el)

  setTimeout(() => {
    el.style.transition = 'opacity .3s'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 350)
  }, durasi)
}

// ── Loading Skeleton ───────────────────────────────────────

/** Buat elemen skeleton placeholder */
export function skeleton(w = 'w-full', h = 'h-4') {
  return `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 rounded-lg ${w} ${h}"></div>`
}

// ── Copy ke Clipboard ──────────────────────────────────────

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('Disalin ke clipboard!', 'success', 2000)
  } catch {
    toast('Gagal menyalin', 'error')
  }
}

// ── WhatsApp Deep Link ─────────────────────────────────────

/**
 * Buat URL wa.me dengan pesan terisi otomatis
 * @param {string} nomorWa  format 628xxx (tanpa + atau spasi)
 * @param {string} pesan    teks pesan yang sudah terisi
 */
export function buatLinkWA(nomorWa, pesan) {
  return `https://wa.me/${nomorWa}?text=${encodeURIComponent(pesan)}`
}

/** Buka WhatsApp dengan konteks halaman produk */
export function waKonteksProduk(nomorWa, produk) {
  const pesan = `Halo, saya tertarik dengan produk:\n\n*${produk.nama}*\nKode: ${produk.kode_produk}\nHarga: ${formatRupiah(produk.harga_jual)}\n\nMohon info lebih lanjut.`
  window.open(buatLinkWA(nomorWa, pesan), '_blank', 'noopener')
}

/** Buka WhatsApp dengan konteks nomor invoice */
export function waKonteksInvoice(nomorWa, invoice) {
  const pesan = `Halo, saya ingin menanyakan pesanan dengan nomor invoice:\n*${invoice}*\n\nMohon bantuannya.`
  window.open(buatLinkWA(nomorWa, pesan), '_blank', 'noopener')
}

// ── Keranjang (Cart) — localStorage ───────────────────────

const CART_KEY = 'fs_cart'

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || [] }
  catch { return [] }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
  window.dispatchEvent(new CustomEvent('cart-updated', { detail: cart }))
}

export function addToCart(produk, qty = 1) {
  const cart = getCart()
  const idx  = cart.findIndex(i => i.product_id === produk.id)
  if (idx >= 0) {
    cart[idx].qty += qty
  } else {
    cart.push({
      product_id:  produk.id,
      nama:        produk.nama,
      kode_produk: produk.kode_produk,
      harga:       produk.harga_jual,
      foto:        produk.foto_url || '',
      qty
    })
  }
  saveCart(cart)
  toast(`${produk.nama} ditambahkan ke keranjang`, 'success')
}

export function updateCartQty(productId, qty) {
  const cart = getCart()
  const idx  = cart.findIndex(i => i.product_id === productId)
  if (idx >= 0) {
    if (qty <= 0) cart.splice(idx, 1)
    else cart[idx].qty = qty
    saveCart(cart)
  }
}

export function removeFromCart(productId) {
  saveCart(getCart().filter(i => i.product_id !== productId))
}

export function clearCart() {
  saveCart([])
}

export function cartTotal() {
  return getCart().reduce((sum, i) => sum + i.harga * i.qty, 0)
}

export function cartCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0)
}

// ── Dark Mode ──────────────────────────────────────────────

export function initDarkMode() {
  const saved = localStorage.getItem('fs_darkmode')
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (saved === 'true' || (saved === null && preferDark)) {
    document.documentElement.classList.add('dark')
  }
}

export function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark')
  localStorage.setItem('fs_darkmode', isDark)
  return isDark
}

// ── Misc ───────────────────────────────────────────────────

/** Generate session ID anonim untuk product_views (tanpa data pribadi) */
export function getSessionId() {
  let id = sessionStorage.getItem('fs_session')
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem('fs_session', id)
  }
  return id
}

/** Pagination helper */
export function paginate(page, perPage) {
  const from = (page - 1) * perPage
  const to   = from + perPage - 1
  return { from, to }
}
