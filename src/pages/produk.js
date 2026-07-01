// src/pages/produk.js
// Logika halaman katalog produk (marketplace-style)

import { getCategories, getProducts, getProductById, logProductView } from '@/lib/api.js'
import {
  formatRupiah, toast, initDarkMode, toggleDarkMode,
  getCart, cartCount, cartTotal, addToCart, updateCartQty, removeFromCart,
  escapeHtml, debounce, getSessionId
} from '@/lib/utils.js'

const PER_PAGE = 12
const BARU_HARI = 14 // ambang "produk baru" dalam hari

// ── State (disinkronkan dengan URL query string) ────────────
const params = new URLSearchParams(window.location.search)
let state = {
  page:       Number(params.get('page')) || 1,
  categoryId: params.get('kategori') || '',
  search:     params.get('cari') || '',
  sort:       params.get('sort') || 'created_at:desc'
}

let categories = []

// ── Utilitas ─────────────────────────────────────────────────

function syncUrl() {
  const p = new URLSearchParams()
  if (state.page > 1)       p.set('page', state.page)
  if (state.categoryId)     p.set('kategori', state.categoryId)
  if (state.search)         p.set('cari', state.search)
  if (state.sort !== 'created_at:desc') p.set('sort', state.sort)
  const qs = p.toString()
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
}

function isProdukBaru(createdAt) {
  const hari = (Date.now() - new Date(createdAt).getTime()) / 86400000
  return hari <= BARU_HARI
}

function renderStars(rating = 0, ratingCount = 0) {
  if (!ratingCount) return `<span class="text-[11px] text-charcoal-400">Belum ada rating</span>`
  const full = Math.round(rating)
  let stars = ''
  for (let i = 1; i <= 5; i++) {
    stars += i <= full
      ? `<span class="text-amber-400">★</span>`
      : `<span class="text-charcoal-300 dark:text-charcoal-600">★</span>`
  }
  return `<span class="text-xs flex items-center gap-1">${stars}
    <span class="text-charcoal-400 font-normal">(${ratingCount})</span></span>`
}

// ── Kartu Produk ─────────────────────────────────────────────

function renderProductCard(p) {
  const foto   = p.images?.find(i => i.is_primary)?.url_watermarked || p.images?.[0]?.url_watermarked || ''
  const diskon = p.diskon > 0
  const baru   = isProdukBaru(p.created_at)
  const habis  = p.status === 'habis'
  const preOrder = p.status === 'pre_order'

  return `
    <article class="group bg-white dark:bg-charcoal-800 rounded-2xl shadow-card hover:shadow-card-hover
                     transition-all duration-300 overflow-hidden border border-charcoal-100 dark:border-charcoal-800
                     hover:-translate-y-1">
      <div class="relative aspect-[4/3] overflow-hidden bg-charcoal-100 dark:bg-charcoal-700">
        ${foto
          ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(p.nama)}" loading="lazy"
               class="w-full h-full object-cover group-hover:scale-105 transition duration-500">`
          : `<div class="w-full h-full flex items-center justify-center text-charcoal-300 text-4xl">🛋️</div>`
        }

        <!-- Badges -->
        <div class="absolute top-2 left-2 flex flex-col gap-1.5">
          ${baru ? `<span class="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">BARU</span>` : ''}
          ${preOrder ? `<span class="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">PRE-ORDER</span>` : ''}
          ${habis ? `<span class="bg-charcoal-700 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">HABIS</span>` : ''}
        </div>
        ${diskon ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">-${p.diskon}%</span>` : ''}

        <!-- Quick view -->
        <button data-id="${p.id}"
          class="btn-quickview absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100 transition
                 bg-white/95 dark:bg-charcoal-900/95 backdrop-blur text-charcoal-900 dark:text-white
                 text-xs font-semibold py-2 rounded-xl shadow-card">
          Lihat Detail
        </button>
      </div>

      <div class="p-3.5 sm:p-4">
        <p class="text-[11px] text-charcoal-400 mb-1 truncate">${escapeHtml(p.category?.nama || '')}</p>
        <h3 class="text-sm font-medium leading-snug mb-1.5 line-clamp-2 min-h-[2.5rem]">${escapeHtml(p.nama)}</h3>
        <div class="mb-2">${renderStars(p.rating, p.rating_count)}</div>
        <div class="flex items-end gap-2 mb-3 flex-wrap">
          <p class="font-semibold text-wood-700 dark:text-wood-400 text-sm">${formatRupiah(p.harga_jual)}</p>
          ${diskon ? `<p class="text-[11px] text-charcoal-400 line-through">${formatRupiah(p.harga)}</p>` : ''}
        </div>
        <div class="flex gap-2">
          <button data-id="${p.id}"
            class="btn-quickview flex-1 py-2 rounded-xl text-xs font-semibold border border-charcoal-200 dark:border-charcoal-700
                   hover:bg-charcoal-50 dark:hover:bg-charcoal-700 transition">
            Detail
          </button>
          <button
            class="btn-add-cart flex-1 py-2 rounded-xl text-xs font-semibold bg-charcoal-900 hover:bg-wood-600 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
            data-id="${p.id}" data-nama="${escapeHtml(p.nama)}" data-kode="${escapeHtml(p.kode_produk)}"
            data-harga="${p.harga_jual}" data-foto="${escapeHtml(foto)}"
            ${habis ? 'disabled' : ''}>
            ${habis ? 'Stok Habis' : '+ Keranjang'}
          </button>
        </div>
      </div>
    </article>
  `
}

function skeletonGrid(n = 8) {
  return Array(n).fill(`<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 rounded-2xl h-72"></div>`).join('')
}

// ── Kategori chips ───────────────────────────────────────────

function renderKategoriChips() {
  const container = document.getElementById('kategori-chips')
  const chipClass = (active) => `chip-kategori px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition cursor-pointer
    ${active
      ? 'bg-wood-600 text-white shadow'
      : 'bg-charcoal-100 dark:bg-charcoal-800 text-charcoal-600 dark:text-charcoal-300 hover:bg-charcoal-200 dark:hover:bg-charcoal-700'}`

  container.innerHTML = `
    <button class="${chipClass(!state.categoryId)}" data-id="">Semua</button>
    ${categories.map(c => `<button class="${chipClass(state.categoryId === c.id)}" data-id="${c.id}">${escapeHtml(c.nama)}</button>`).join('')}
  `

  container.querySelectorAll('.chip-kategori').forEach(btn => {
    btn.addEventListener('click', () => {
      state.categoryId = btn.dataset.id
      state.page = 1
      syncUrl()
      loadProduk()
    })
  })
}

// ── Pagination ───────────────────────────────────────────────

function renderPagination(totalPages) {
  const container = document.getElementById('pagination')
  if (totalPages <= 1) { container.innerHTML = ''; return }

  const btn = (label, page, opts = {}) => `
    <button class="page-btn ${opts.active ? 'active' : ''}" ${opts.disabled ? 'disabled' : ''} data-page="${page}"
      ${opts.disabled ? 'style="opacity:.35;cursor:not-allowed"' : ''}>${label}</button>`

  let html = btn('‹', state.page - 1, { disabled: state.page <= 1 })

  const windowSize = 2
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= state.page - windowSize && i <= state.page + windowSize)) {
      html += btn(i, i, { active: i === state.page })
    } else if (i === state.page - windowSize - 1 || i === state.page + windowSize + 1) {
      html += `<span class="px-1 text-charcoal-400">…</span>`
    }
  }
  html += btn('›', state.page + 1, { disabled: state.page >= totalPages })

  container.innerHTML = html
  container.querySelectorAll('.page-btn:not([disabled])').forEach(b =>
    b.addEventListener('click', () => {
      state.page = Number(b.dataset.page)
      syncUrl()
      loadProduk()
      window.scrollTo({ top: document.getElementById('filter-bar').offsetTop - 80, behavior: 'smooth' })
    })
  )
}

// ── Muat produk ──────────────────────────────────────────────

async function loadProduk() {
  const grid   = document.getElementById('produk-grid')
  const empty  = document.getElementById('empty-state')
  const info   = document.getElementById('hasil-info')
  const resetBtn = document.getElementById('btn-reset-filter')

  grid.classList.remove('hidden')
  empty.classList.add('hidden')
  grid.innerHTML = skeletonGrid()
  info.textContent = 'Memuat produk...'

  resetBtn.classList.toggle('hidden', !(state.categoryId || state.search))

  const [sort, order] = state.sort.split(':')

  try {
    const { data, count, totalPages } = await getProducts({
      page: state.page,
      perPage: PER_PAGE,
      categoryId: state.categoryId || undefined,
      search: state.search || undefined,
      sort, order
    })

    if (!data.length) {
      grid.classList.add('hidden')
      empty.classList.remove('hidden')
      info.textContent = 'Tidak ada produk ditemukan'
      renderPagination(0)
      return
    }

    grid.innerHTML = data.map(renderProductCard).join('')
    grid.querySelectorAll('.btn-add-cart').forEach(bindAddToCart)
    grid.querySelectorAll('.btn-quickview').forEach(b =>
      b.addEventListener('click', () => openQuickView(b.dataset.id))
    )

    const dari = (state.page - 1) * PER_PAGE + 1
    const sampai = Math.min(state.page * PER_PAGE, count)
    info.textContent = `Menampilkan ${dari}–${sampai} dari ${count} produk`

    renderPagination(totalPages)
  } catch (e) {
    console.error(e)
    grid.innerHTML = `<p class="col-span-full text-center text-sm text-charcoal-400 py-10">Gagal memuat produk. Silakan coba lagi.</p>`
    info.textContent = ''
  }
}

// ── Quick view modal ─────────────────────────────────────────

async function openQuickView(id) {
  const overlay = document.getElementById('qv-overlay')
  const content = document.getElementById('qv-content')
  overlay.classList.remove('hidden')
  overlay.classList.add('flex')
  content.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-72 rounded-2xl"></div>`

  try {
    const p = await getProductById(id)
    logProductView(id, getSessionId())

    const foto = p.images?.find(i => i.is_primary)?.url_watermarked || p.images?.[0]?.url_watermarked || ''
    const diskon = p.diskon > 0
    const habis = p.status === 'habis'

    content.innerHTML = `
      <div class="flex justify-between items-start mb-4">
        <h2 class="font-serif text-xl font-semibold pr-8">${escapeHtml(p.nama)}</h2>
        <button id="qv-close" class="p-1.5 rounded-lg hover:bg-charcoal-100 dark:hover:bg-charcoal-800 flex-shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="grid sm:grid-cols-2 gap-5">
        <div class="rounded-2xl overflow-hidden bg-charcoal-100 dark:bg-charcoal-700 aspect-[4/3]">
          ${foto ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(p.nama)}" class="w-full h-full object-cover">`
                 : `<div class="w-full h-full flex items-center justify-center text-5xl text-charcoal-300">🛋️</div>`}
        </div>
        <div>
          <p class="text-xs text-charcoal-400 mb-2">${escapeHtml(p.category?.nama || '')}</p>
          <div class="mb-2">${renderStars(p.rating, p.rating_count)}</div>
          <div class="flex items-end gap-2 mb-4">
            <p class="font-semibold text-wood-700 dark:text-wood-400 text-xl">${formatRupiah(p.harga_jual)}</p>
            ${diskon ? `<p class="text-sm text-charcoal-400 line-through">${formatRupiah(p.harga)}</p>` : ''}
          </div>
          <p class="text-sm text-charcoal-600 dark:text-charcoal-400 leading-relaxed mb-4 line-clamp-6">${escapeHtml(p.deskripsi || 'Tidak ada deskripsi.')}</p>
          <dl class="grid grid-cols-2 gap-2 text-xs mb-5">
            ${p.estimasi_produksi ? `<div><dt class="text-charcoal-400">Estimasi Produksi</dt><dd class="font-medium">${escapeHtml(p.estimasi_produksi)}</dd></div>` : ''}
            ${p.estimasi_pengiriman ? `<div><dt class="text-charcoal-400">Estimasi Kirim</dt><dd class="font-medium">${escapeHtml(p.estimasi_pengiriman)}</dd></div>` : ''}
            ${p.berat_kg ? `<div><dt class="text-charcoal-400">Berat</dt><dd class="font-medium">${p.berat_kg} kg</dd></div>` : ''}
            <div><dt class="text-charcoal-400">Stok</dt><dd class="font-medium">${p.stok > 0 ? p.stok : 'Habis'}</dd></div>
          </dl>
          <button id="qv-add-cart"
            class="btn-add-cart w-full py-3 rounded-xl text-sm font-semibold bg-charcoal-900 hover:bg-wood-600 text-white transition disabled:opacity-40"
            data-id="${p.id}" data-nama="${escapeHtml(p.nama)}" data-kode="${escapeHtml(p.kode_produk)}"
            data-harga="${p.harga_jual}" data-foto="${escapeHtml(foto)}"
            ${habis ? 'disabled' : ''}>
            ${habis ? 'Stok Habis' : '+ Tambah ke Keranjang'}
          </button>
        </div>
      </div>
    `
    document.getElementById('qv-close').addEventListener('click', closeQuickView)
    const addBtn = document.getElementById('qv-add-cart')
    addBtn.addEventListener('click', () => {
      addToCart({
        product_id: addBtn.dataset.id, nama: addBtn.dataset.nama, kode_produk: addBtn.dataset.kode,
        harga: Number(addBtn.dataset.harga), foto: addBtn.dataset.foto
      })
      toast('Ditambahkan ke keranjang', 'success')
      window.dispatchEvent(new Event('cart-updated'))
    })
  } catch (e) {
    console.error(e)
    content.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Gagal memuat detail produk.</p>`
  }
}

function closeQuickView() {
  const overlay = document.getElementById('qv-overlay')
  overlay.classList.add('hidden')
  overlay.classList.remove('flex')
}

// ── Keranjang ────────────────────────────────────────────────

function bindAddToCart(btn) {
  btn.addEventListener('click', () => {
    addToCart({
      product_id: btn.dataset.id, nama: btn.dataset.nama, kode_produk: btn.dataset.kode,
      harga: Number(btn.dataset.harga), foto: btn.dataset.foto
    })
    toast('Ditambahkan ke keranjang', 'success')
    window.dispatchEvent(new Event('cart-updated'))
  })
}

function renderCartBadge() {
  const badge = document.getElementById('cart-badge')
  const count = cartCount()
  badge.textContent = count
  badge.classList.toggle('hidden', count === 0)
}

function renderCartDrawer() {
  const items = getCart()
  const container = document.getElementById('cart-items')

  if (!items.length) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-charcoal-400 py-12">
        <p class="text-4xl mb-3">🛒</p>
        <p class="text-sm">Keranjang masih kosong</p>
      </div>`
  } else {
    container.innerHTML = items.map(i => `
      <div class="flex gap-3">
        <div class="w-16 h-16 rounded-xl overflow-hidden bg-charcoal-100 dark:bg-charcoal-700 flex-shrink-0">
          ${i.foto ? `<img src="${escapeHtml(i.foto)}" alt="${escapeHtml(i.nama)}" class="w-full h-full object-cover">`
                    : `<div class="w-full h-full flex items-center justify-center text-2xl">🛋️</div>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate">${escapeHtml(i.nama)}</p>
          <p class="text-xs text-charcoal-400 mb-1">${formatRupiah(i.harga)}</p>
          <div class="flex items-center gap-2">
            <button data-id="${i.product_id}" data-delta="-1"
              class="btn-qty w-6 h-6 rounded bg-charcoal-100 dark:bg-charcoal-700 text-xs font-bold flex items-center justify-center">-</button>
            <span class="text-sm font-medium w-6 text-center">${i.qty}</span>
            <button data-id="${i.product_id}" data-delta="1"
              class="btn-qty w-6 h-6 rounded bg-charcoal-100 dark:bg-charcoal-700 text-xs font-bold flex items-center justify-center">+</button>
            <button data-id="${i.product_id}" class="btn-remove ml-auto text-red-400 hover:text-red-600 transition" aria-label="Hapus">✕</button>
          </div>
        </div>
      </div>
    `).join('')

    container.querySelectorAll('.btn-qty').forEach(b =>
      b.addEventListener('click', () => {
        const item = items.find(i => i.product_id === b.dataset.id)
        if (item) { updateCartQty(b.dataset.id, item.qty + (+b.dataset.delta)); renderCartDrawer(); renderCartBadge() }
      })
    )
    container.querySelectorAll('.btn-remove').forEach(b =>
      b.addEventListener('click', () => { removeFromCart(b.dataset.id); renderCartDrawer(); renderCartBadge() })
    )
  }

  document.getElementById('cart-total').textContent = formatRupiah(cartTotal())
}

function initCart() {
  renderCartBadge()
  document.getElementById('btn-cart').addEventListener('click', e => {
    e.preventDefault()
    renderCartDrawer()
    document.getElementById('cart-drawer').classList.remove('translate-x-full')
    document.getElementById('cart-overlay').classList.remove('hidden')
  })
  const close = () => {
    document.getElementById('cart-drawer').classList.add('translate-x-full')
    document.getElementById('cart-overlay').classList.add('hidden')
  }
  document.getElementById('btn-cart-close').addEventListener('click', close)
  document.getElementById('cart-overlay').addEventListener('click', close)
  window.addEventListener('cart-updated', () => {
    renderCartBadge()
    if (!document.getElementById('cart-drawer').classList.contains('translate-x-full')) renderCartDrawer()
  })
}

// ── Init ─────────────────────────────────────────────────────

async function init() {
  initDarkMode()
  document.getElementById('btn-darkmode').addEventListener('click', toggleDarkMode)
  document.getElementById('btn-menu').addEventListener('click', () =>
    document.getElementById('mobile-menu').classList.toggle('hidden'))
  document.getElementById('footer-year').textContent = new Date().getFullYear()
  document.getElementById('qv-overlay').addEventListener('click', e => {
    if (e.target.id === 'qv-overlay') closeQuickView()
  })

  initCart()

  // Search
  const searchInput = document.getElementById('search-input')
  searchInput.value = state.search
  searchInput.addEventListener('input', debounce(() => {
    state.search = searchInput.value.trim()
    state.page = 1
    syncUrl()
    loadProduk()
  }, 400))

  // Sort
  const sortSelect = document.getElementById('sort-select')
  sortSelect.value = state.sort
  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value
    state.page = 1
    syncUrl()
    loadProduk()
  })

  // Reset filter
  const resetFilter = () => {
    state = { page: 1, categoryId: '', search: '', sort: 'created_at:desc' }
    searchInput.value = ''
    sortSelect.value = state.sort
    syncUrl()
    renderKategoriChips()
    loadProduk()
  }
  document.getElementById('btn-reset-filter').addEventListener('click', resetFilter)
  document.getElementById('btn-empty-reset').addEventListener('click', resetFilter)

  try {
    categories = await getCategories()
  } catch (e) {
    console.error('Gagal memuat kategori:', e)
    categories = []
  }
  renderKategoriChips()
  loadProduk()
}

document.addEventListener('DOMContentLoaded', init)
