// src/pages/admin.js
// Logika Dashboard Admin NataRuang — CRUD produk, kategori, pesanan,
// pembayaran, ongkir, chatbot FAQ, testimoni, laporan, pengaturan.

import { requireAdmin, logoutAdmin } from '@/lib/auth.js'
import {
  getSettings, updateSetting,
  getCategories, upsertCategory, deleteCategory,
  getProducts, getProductById, upsertProduct, deleteProduct,
  uploadFotoProduk, insertProductImage, deleteProductImage,
  getAllShippingRates, upsertShippingRate, deleteShippingRate,
  getOrders, updateOrderStatus,
  getPaymentsPending, verifyPayment,
  getFaqsAdmin, upsertFaq, deleteFaq,
  getTestimonialsAdmin, upsertTestimonial, deleteTestimonial,
  getDashboardSummary, getProdukPalingDilihat, getProdukTerlaris,
  getPenjualanHarian, getPenjualanBulanan, getOrdersExport
} from '@/lib/api.js'
import {
  formatRupiah, formatTanggal, escapeHtml, toast, debounce,
  initDarkMode, toggleDarkMode
} from '@/lib/utils.js'
import { prosesGambarProduk } from '@/lib/watermark.js'
import { exportOrdersExcel, exportOrdersPDF, cetakNotaPesanan } from '@/lib/report.js'

let settingsCache = {}
let currentUser   = null

// ── Guard: wajib login ───────────────────────────────────────
;(async function bootstrap() {
  currentUser = await requireAdmin()
  if (!currentUser) return // sudah di-redirect ke login.html oleh requireAdmin()
  await init()
})()

async function init() {
  initDarkMode()
  document.getElementById('btn-darkmode').addEventListener('click', toggleDarkMode)

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await logoutAdmin()
    window.location.replace('/login.html')
  })

  document.getElementById('btn-sidebar-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('-translate-x-full')
    document.getElementById('sidebar-overlay').classList.toggle('hidden')
  })
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('-translate-x-full')
    document.getElementById('sidebar-overlay').classList.add('hidden')
  })

  initTabs()
  initModal()

  try {
    settingsCache = await getSettings()
  } catch (e) {
    console.error('Gagal memuat pengaturan:', e)
  }

  await loadDashboard()
}

// ── Tab switching ────────────────────────────────────────────

const TAB_TITLES = {
  dashboard: 'Dashboard', produk: 'Produk', kategori: 'Kategori', pesanan: 'Pesanan',
  pembayaran: 'Pembayaran', ongkir: 'Ongkos Kirim', chatbot: 'Chatbot FAQ',
  testimoni: 'Testimoni', laporan: 'Laporan', pengaturan: 'Pengaturan'
}

const loadedTabs = new Set(['dashboard'])

function initTabs() {
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })
}

async function switchTab(tab) {
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'))
  document.getElementById(`tab-${tab}`).classList.remove('hidden')
  document.getElementById('page-title').textContent = TAB_TITLES[tab] || tab

  // Tutup sidebar mobile setelah pilih tab
  document.getElementById('sidebar').classList.add('-translate-x-full')
  document.getElementById('sidebar-overlay').classList.add('hidden')

  const loaders = {
    produk: loadProdukTab, kategori: loadKategoriTab, pesanan: loadPesananTab,
    pembayaran: loadPembayaranTab, ongkir: loadOngkirTab, chatbot: loadFaqTab,
    testimoni: loadTestimoniTab, laporan: loadLaporanTab, pengaturan: loadPengaturanTab
  }

  if (loaders[tab] && !loadedTabs.has(tab)) {
    loadedTabs.add(tab)
    await loaders[tab]()
  } else if (tab === 'dashboard') {
    await loadDashboard()
  } else if (['pesanan', 'pembayaran'].includes(tab)) {
    // Refresh data yang sering berubah setiap dibuka
    await loaders[tab]()
  }
}

// ── Modal generik ────────────────────────────────────────────

function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal)
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal()
  })
}

function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent = title
  document.getElementById('modal-body').innerHTML = bodyHtml
  document.getElementById('modal-overlay').classList.remove('hidden')
  document.getElementById('modal-overlay').classList.add('flex')
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden')
  document.getElementById('modal-overlay').classList.remove('flex')
  document.getElementById('modal-body').innerHTML = ''
}
window.closeModal = closeModal // dipakai tombol batal di beberapa form

// ── DASHBOARD ────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const summary = await getDashboardSummary()
    document.getElementById('m-produk').textContent     = summary.total_produk ?? 0
    document.getElementById('m-pesanan').textContent    = summary.total_pesanan ?? 0
    document.getElementById('m-pendapatan').textContent = formatRupiah(summary.pendapatan_bulan_ini ?? 0)
    document.getElementById('m-verifikasi').textContent = summary.menunggu_verifikasi ?? 0

    const badge = document.getElementById('badge-pesanan')
    const jumlahBaru = summary.menunggu_verifikasi ?? 0
    badge.textContent = jumlahBaru
    badge.classList.toggle('hidden', jumlahBaru === 0)
  } catch (e) {
    console.error('Gagal memuat ringkasan dashboard:', e)
  }

  try {
    const terlaris = await getProdukTerlaris()
    document.getElementById('list-terlaris').innerHTML = terlaris.length
      ? terlaris.slice(0, 5).map((p, i) => `
        <div class="flex items-center gap-3">
          <span class="w-6 h-6 rounded-full bg-charcoal-100 dark:bg-charcoal-800 flex items-center justify-center text-xs font-bold flex-shrink-0">${i + 1}</span>
          <p class="text-sm flex-1 truncate">${escapeHtml(p.nama)}</p>
          <span class="text-xs text-charcoal-400 flex-shrink-0">${p.qty_30hari ?? p.total_qty_all ?? 0}x</span>
        </div>`).join('')
      : `<p class="text-sm text-charcoal-400">Belum ada data</p>`
  } catch (e) {
    document.getElementById('list-terlaris').innerHTML = `<p class="text-sm text-charcoal-400">Gagal memuat data</p>`
  }

  try {
    const dilihat = await getProdukPalingDilihat()
    document.getElementById('list-dilihat').innerHTML = dilihat.length
      ? dilihat.slice(0, 5).map((p, i) => `
        <div class="flex items-center gap-3">
          <span class="w-6 h-6 rounded-full bg-charcoal-100 dark:bg-charcoal-800 flex items-center justify-center text-xs font-bold flex-shrink-0">${i + 1}</span>
          <p class="text-sm flex-1 truncate">${escapeHtml(p.nama)}</p>
          <span class="text-xs text-charcoal-400 flex-shrink-0">${p.views_7hari ?? p.total_views_all ?? 0} views</span>
        </div>`).join('')
      : `<p class="text-sm text-charcoal-400">Belum ada data</p>`
  } catch (e) {
    document.getElementById('list-dilihat').innerHTML = `<p class="text-sm text-charcoal-400">Gagal memuat data</p>`
  }

  await loadChart('harian')
  document.querySelectorAll('.chart-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      loadChart(btn.dataset.period)
    })
  })
}

let chartInstance = null
async function loadChart(period) {
  const canvas = document.getElementById('chart-penjualan')
  try {
    const { default: Chart } = await import('chart.js/auto')
    let data = period === 'bulanan' ? await getPenjualanBulanan() : await getPenjualanHarian()
    if (period === 'bulanan') data = [...data].reverse()

    const labels = data.map(d => d.tanggal ?? d.bulan)
    const nilai  = data.map(d => d.total_pendapatan ?? 0)

    if (chartInstance) chartInstance.destroy()
    chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Pendapatan',
          data: nilai,
          borderColor: '#c07a38',
          backgroundColor: 'rgba(192,122,56,0.12)',
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { callback: v => formatRupiah(v) } }
        }
      }
    })
  } catch (e) {
    console.error('Gagal memuat grafik:', e)
  }
}

// ══════════════════════════════════════════════════════════
// TAB: PRODUK
// ══════════════════════════════════════════════════════════

let produkState = { page: 1, search: '' }
let kategoriListCache = []

async function loadProdukTab() {
  document.getElementById('search-produk').addEventListener('input', debounce(() => {
    produkState.search = document.getElementById('search-produk').value.trim()
    produkState.page = 1
    renderProdukTable()
  }, 400))
  document.getElementById('btn-tambah-produk').addEventListener('click', () => openProdukForm())
  await renderProdukTable()
}

async function renderProdukTable() {
  const container = document.getElementById('tbl-produk')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-64 rounded-2xl"></div>`
  try {
    if (!kategoriListCache.length) kategoriListCache = await getCategories()
    const { data, totalPages } = await getProducts({ page: produkState.page, perPage: 10, search: produkState.search || undefined })

    if (!data.length) {
      container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Belum ada produk</p>`
      document.getElementById('paginasi-produk').innerHTML = ''
      return
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead><tr>
          <th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok</th><th>Status</th><th class="text-right">Aksi</th>
        </tr></thead>
        <tbody>
          ${data.map(p => {
            const foto = p.images?.find(i => i.is_primary)?.url_watermarked || p.images?.[0]?.url_watermarked || ''
            const statusBadge = { ready: 'badge-green', pre_order: 'badge-amber', habis: 'badge-red' }[p.status] || 'badge-gray'
            return `
            <tr>
              <td>
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-lg bg-charcoal-100 dark:bg-charcoal-700 overflow-hidden flex-shrink-0">
                    ${foto ? `<img src="${escapeHtml(foto)}" class="w-full h-full object-cover">` : ''}
                  </div>
                  <div class="min-w-0">
                    <p class="font-medium truncate max-w-[180px]">${escapeHtml(p.nama)}</p>
                    <p class="text-xs text-charcoal-400">${escapeHtml(p.kode_produk)}</p>
                  </div>
                </div>
              </td>
              <td>${escapeHtml(p.category?.nama || '-')}</td>
              <td>${formatRupiah(p.harga_jual)}${p.diskon > 0 ? `<span class="text-xs text-red-500 ml-1">-${p.diskon}%</span>` : ''}</td>
              <td>${p.stok}</td>
              <td><span class="badge ${statusBadge}">${p.status}</span></td>
              <td class="text-right whitespace-nowrap">
                <button class="btn-edit-produk text-wood-600 hover:underline text-xs font-medium mr-3" data-id="${p.id}">Edit</button>
                <button class="btn-hapus-produk text-red-500 hover:underline text-xs font-medium" data-id="${p.id}">Hapus</button>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>`

    container.querySelectorAll('.btn-edit-produk').forEach(b =>
      b.addEventListener('click', () => openProdukForm(b.dataset.id)))
    container.querySelectorAll('.btn-hapus-produk').forEach(b =>
      b.addEventListener('click', () => hapusProduk(b.dataset.id)))

    renderSimplePagination('paginasi-produk', produkState.page, totalPages, (page) => {
      produkState.page = page
      renderProdukTable()
    })
  } catch (e) {
    console.error(e)
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat produk</p>`
  }
}

async function hapusProduk(id) {
  if (!confirm('Hapus produk ini? Produk akan disembunyikan dari toko (soft delete).')) return
  try {
    await deleteProduct(id)
    toast('Produk dihapus', 'success')
    renderProdukTable()
  } catch (e) {
    toast('Gagal menghapus produk: ' + e.message, 'error')
  }
}

async function openProdukForm(id = null) {
  let produk = null
  if (id) {
    try { produk = await getProductById(id) } catch (e) { toast('Gagal memuat produk', 'error'); return }
  }

  const kategoriOptions = kategoriListCache.map(k =>
    `<option value="${k.id}" ${produk?.category_id === k.id ? 'selected' : ''}>${escapeHtml(k.nama)}</option>`
  ).join('')

  openModal(produk ? 'Edit Produk' : 'Tambah Produk', `
    <form id="form-produk" class="space-y-4">
      <div>
        <label class="label">Nama Produk</label>
        <input id="pf-nama" required class="input-field" value="${escapeHtml(produk?.nama || '')}">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Kode Produk</label>
          <input id="pf-kode" required class="input-field" value="${escapeHtml(produk?.kode_produk || 'PRD-' + Date.now().toString().slice(-6))}">
        </div>
        <div>
          <label class="label">Kategori</label>
          <select id="pf-kategori" required class="input-field">
            <option value="">Pilih kategori</option>${kategoriOptions}
          </select>
        </div>
      </div>
      <div>
        <label class="label">Deskripsi</label>
        <textarea id="pf-deskripsi" rows="3" class="input-field">${escapeHtml(produk?.deskripsi || '')}</textarea>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <label class="label">Harga (Rp)</label>
          <input id="pf-harga" type="number" min="0" required class="input-field" value="${produk?.harga || ''}">
        </div>
        <div>
          <label class="label">Diskon (%)</label>
          <input id="pf-diskon" type="number" min="0" max="100" class="input-field" value="${produk?.diskon || 0}">
        </div>
        <div>
          <label class="label">Stok</label>
          <input id="pf-stok" type="number" min="0" required class="input-field" value="${produk?.stok ?? 0}">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Status</label>
          <select id="pf-status" class="input-field">
            <option value="ready" ${produk?.status === 'ready' ? 'selected' : ''}>Ready</option>
            <option value="pre_order" ${produk?.status === 'pre_order' ? 'selected' : ''}>Pre-Order</option>
            <option value="habis" ${produk?.status === 'habis' ? 'selected' : ''}>Habis</option>
          </select>
        </div>
        <div>
          <label class="label">Berat (kg)</label>
          <input id="pf-berat" type="number" step="0.1" min="0" class="input-field" value="${produk?.berat_kg || ''}">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Estimasi Produksi</label>
          <input id="pf-estprod" class="input-field" placeholder="misal 7 hari kerja" value="${escapeHtml(produk?.estimasi_produksi || '')}">
        </div>
        <div>
          <label class="label">Estimasi Kirim</label>
          <input id="pf-estkirim" class="input-field" placeholder="misal 3-5 hari" value="${escapeHtml(produk?.estimasi_pengiriman || '')}">
        </div>
      </div>

      <div>
        <label class="label">Foto Produk (bisa lebih dari satu, otomatis diberi watermark)</label>
        <input id="pf-foto" type="file" accept="image/jpeg,image/png,image/webp" multiple class="input-field">
        <div id="pf-foto-preview" class="flex flex-wrap gap-2 mt-3">
          ${(produk?.images || []).map(img => `
            <div class="relative w-16 h-16 rounded-lg overflow-hidden bg-charcoal-100 dark:bg-charcoal-700 group">
              <img src="${escapeHtml(img.url_watermarked)}" class="w-full h-full object-cover">
              ${img.is_primary ? '<span class="absolute bottom-0 inset-x-0 bg-wood-600 text-white text-[9px] text-center">Utama</span>' : ''}
              <button type="button" data-img-id="${img.id}"
                class="btn-hapus-foto absolute top-0.5 right-0.5 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100">✕</button>
            </div>`).join('')}
        </div>
      </div>

      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="btn-outline flex-1 py-2.5 rounded-xl text-sm">Batal</button>
        <button type="submit" id="pf-submit" class="btn-primary flex-1 py-2.5 rounded-xl text-sm">Simpan Produk</button>
      </div>
    </form>
  `)

  document.querySelectorAll('.btn-hapus-foto').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Hapus foto ini?')) return
      try { await deleteProductImage(b.dataset.imgId); b.closest('div').remove(); toast('Foto dihapus', 'success') }
      catch (e) { toast('Gagal menghapus foto', 'error') }
    })
  })

  document.getElementById('form-produk').addEventListener('submit', async (e) => {
    e.preventDefault()
    const submitBtn = document.getElementById('pf-submit')
    submitBtn.disabled = true
    submitBtn.textContent = 'Menyimpan...'

    try {
      const nama = document.getElementById('pf-nama').value.trim()
      const payload = {
        id: produk?.id,
        category_id: document.getElementById('pf-kategori').value,
        kode_produk: document.getElementById('pf-kode').value.trim(),
        nama,
        slug: (produk?.slug) || (await import('@/lib/utils.js')).toSlug(nama) + '-' + Date.now().toString().slice(-5),
        deskripsi: document.getElementById('pf-deskripsi').value.trim(),
        harga: Number(document.getElementById('pf-harga').value),
        diskon: Number(document.getElementById('pf-diskon').value) || 0,
        stok: Number(document.getElementById('pf-stok').value),
        status: document.getElementById('pf-status').value,
        berat_kg: Number(document.getElementById('pf-berat').value) || null,
        estimasi_produksi: document.getElementById('pf-estprod').value.trim() || null,
        estimasi_pengiriman: document.getElementById('pf-estkirim').value.trim() || null
      }

      const savedProduk = await upsertProduct(payload)

      // Upload foto baru (jika ada)
      const files = document.getElementById('pf-foto').files
      const punyaFotoUtama = (produk?.images || []).some(i => i.is_primary)
      for (let i = 0; i < files.length; i++) {
        const { blob, fileName } = await prosesGambarProduk(files[i], settingsCache.watermark_text || 'NataRuang',
          { opacity: Number(settingsCache.watermark_opacity) || 0.35 })
        const url = await uploadFotoProduk(blob, fileName)
        await insertProductImage(savedProduk.id, url, !punyaFotoUtama && i === 0)
      }

      toast('Produk berhasil disimpan', 'success')
      closeModal()
      renderProdukTable()
    } catch (err) {
      console.error(err)
      toast('Gagal menyimpan produk: ' + err.message, 'error')
      submitBtn.disabled = false
      submitBtn.textContent = 'Simpan Produk'
    }
  })
}

// ══════════════════════════════════════════════════════════
// TAB: KATEGORI
// ══════════════════════════════════════════════════════════

async function loadKategoriTab() {
  document.getElementById('btn-tambah-kategori').addEventListener('click', () => openKategoriForm())
  await renderKategoriTable()
}

async function renderKategoriTable() {
  const container = document.getElementById('tbl-kategori')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-48 rounded-2xl"></div>`
  try {
    kategoriListCache = await getCategories()
    if (!kategoriListCache.length) {
      container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Belum ada kategori</p>`
      return
    }
    container.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Nama</th><th>Slug</th><th>Urutan</th><th class="text-right">Aksi</th></tr></thead>
        <tbody>
          ${kategoriListCache.map(k => `
            <tr>
              <td class="font-medium">${escapeHtml(k.nama)}</td>
              <td class="text-charcoal-400">${escapeHtml(k.slug)}</td>
              <td>${k.urutan}</td>
              <td class="text-right whitespace-nowrap">
                <button class="btn-edit-kategori text-wood-600 hover:underline text-xs font-medium mr-3" data-id="${k.id}">Edit</button>
                <button class="btn-hapus-kategori text-red-500 hover:underline text-xs font-medium" data-id="${k.id}">Hapus</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`
    container.querySelectorAll('.btn-edit-kategori').forEach(b =>
      b.addEventListener('click', () => openKategoriForm(kategoriListCache.find(k => k.id === b.dataset.id))))
    container.querySelectorAll('.btn-hapus-kategori').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Hapus kategori ini?')) return
        try { await deleteCategory(b.dataset.id); toast('Kategori dihapus', 'success'); renderKategoriTable() }
        catch (e) { toast('Gagal menghapus (mungkin masih dipakai produk)', 'error') }
      }))
  } catch (e) {
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat kategori</p>`
  }
}

async function openKategoriForm(kategori = null) {
  const { toSlug } = await import('@/lib/utils.js')
  openModal(kategori ? 'Edit Kategori' : 'Tambah Kategori', `
    <form id="form-kategori" class="space-y-4">
      <div>
        <label class="label">Nama Kategori</label>
        <input id="kf-nama" required class="input-field" value="${escapeHtml(kategori?.nama || '')}">
      </div>
      <div>
        <label class="label">Urutan Tampil</label>
        <input id="kf-urutan" type="number" class="input-field" value="${kategori?.urutan ?? 0}">
      </div>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="btn-outline flex-1 py-2.5 rounded-xl text-sm">Batal</button>
        <button type="submit" class="btn-primary flex-1 py-2.5 rounded-xl text-sm">Simpan</button>
      </div>
    </form>
  `)
  document.getElementById('form-kategori').addEventListener('submit', async e => {
    e.preventDefault()
    try {
      const nama = document.getElementById('kf-nama').value.trim()
      await upsertCategory({
        id: kategori?.id,
        nama,
        slug: kategori?.slug || toSlug(nama),
        urutan: Number(document.getElementById('kf-urutan').value) || 0
      })
      toast('Kategori disimpan', 'success')
      closeModal()
      renderKategoriTable()
    } catch (err) {
      toast('Gagal menyimpan kategori: ' + err.message, 'error')
    }
  })
}

// ── Pagination helper sederhana (dipakai beberapa tab) ──────
function renderSimplePagination(containerId, currentPage, totalPages, onPage) {
  const container = document.getElementById(containerId)
  if (totalPages <= 1) { container.innerHTML = ''; return }
  let html = ''
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`
  }
  container.innerHTML = html
  container.querySelectorAll('.page-btn').forEach(b =>
    b.addEventListener('click', () => onPage(Number(b.dataset.page))))
}

// ══════════════════════════════════════════════════════════
// TAB: PESANAN
// ══════════════════════════════════════════════════════════

let pesananState = { page: 1, search: '', status: '' }

async function loadPesananTab() {
  document.getElementById('search-pesanan').addEventListener('input', debounce(() => {
    pesananState.search = document.getElementById('search-pesanan').value.trim()
    pesananState.page = 1
    renderPesananTable()
  }, 400))
  document.getElementById('filter-status-pesanan').addEventListener('change', (e) => {
    pesananState.status = e.target.value
    pesananState.page = 1
    renderPesananTable()
  })
  await renderPesananTable()
}

const STATUS_BADGE = {
  menunggu_pembayaran: 'badge-gray', menunggu_verifikasi: 'badge-amber', lunas: 'badge-green',
  dikirim: 'badge-blue', selesai: 'badge-green', ditolak: 'badge-red', dibatalkan: 'badge-red'
}

async function renderPesananTable() {
  const container = document.getElementById('tbl-pesanan')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-64 rounded-2xl"></div>`
  try {
    const { data, totalPages } = await getOrders({
      page: pesananState.page, perPage: 15,
      search: pesananState.search || undefined, status: pesananState.status || undefined
    })
    if (!data.length) {
      container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Belum ada pesanan</p>`
      document.getElementById('paginasi-pesanan').innerHTML = ''
      return
    }
    container.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr>
          <th>Invoice</th><th>Pembeli</th><th>Kota</th><th>Total</th><th>Status</th><th>Tanggal</th><th class="text-right">Aksi</th>
        </tr></thead>
        <tbody>
          ${data.map(o => `
            <tr>
              <td class="font-medium">${escapeHtml(o.invoice_number)}</td>
              <td>${escapeHtml(o.nama_pembeli)}</td>
              <td>${escapeHtml(o.kota)}</td>
              <td>${formatRupiah(o.total)}</td>
              <td><span class="badge ${STATUS_BADGE[o.status] || 'badge-gray'}">${o.status.replace(/_/g, ' ')}</span></td>
              <td class="text-charcoal-400 text-xs">${formatTanggal(o.created_at)}</td>
              <td class="text-right"><button class="btn-detail-pesanan text-wood-600 hover:underline text-xs font-medium" data-invoice="${escapeHtml(o.invoice_number)}">Detail</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`
    container.querySelectorAll('.btn-detail-pesanan').forEach(b =>
      b.addEventListener('click', () => openDetailPesanan(b.dataset.invoice)))
    renderSimplePagination('paginasi-pesanan', pesananState.page, totalPages, (page) => {
      pesananState.page = page
      renderPesananTable()
    })
  } catch (e) {
    console.error(e)
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat pesanan</p>`
  }
}

async function openDetailPesanan(invoice) {
  openModal('Detail Pesanan', `<div class="animate-skeleton h-48 bg-charcoal-100 dark:bg-charcoal-800 rounded-xl"></div>`)
  try {
    const { getOrderByInvoice } = await import('@/lib/api.js')
    const order = await getOrderByInvoice(invoice)

    document.getElementById('modal-body').innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-start">
          <div>
            <p class="font-semibold">${escapeHtml(order.invoice_number)}</p>
            <p class="text-xs text-charcoal-400">${formatTanggal(order.created_at)}</p>
          </div>
          <span class="badge ${STATUS_BADGE[order.status] || 'badge-gray'}">${order.status.replace(/_/g, ' ')}</span>
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div><p class="text-charcoal-400 text-xs">Pembeli</p><p class="font-medium">${escapeHtml(order.nama_pembeli)}</p></div>
          <div><p class="text-charcoal-400 text-xs">WhatsApp</p><p class="font-medium">${escapeHtml(order.nomor_wa)}</p></div>
          <div class="col-span-2"><p class="text-charcoal-400 text-xs">Alamat</p><p class="font-medium">${escapeHtml(order.alamat)}, ${escapeHtml(order.kota)}, ${escapeHtml(order.provinsi)}</p></div>
        </div>

        <div class="border-t border-charcoal-100 dark:border-charcoal-800 pt-3 space-y-1.5">
          ${(order.items || []).map(i => `
            <div class="flex justify-between text-sm">
              <span>${escapeHtml(i.nama_produk)} × ${i.qty}</span>
              <span>${formatRupiah(i.subtotal)}</span>
            </div>`).join('')}
        </div>
        <div class="border-t border-charcoal-100 dark:border-charcoal-800 pt-3 space-y-1 text-sm">
          <div class="flex justify-between"><span class="text-charcoal-400">Subtotal</span><span>${formatRupiah(order.subtotal)}</span></div>
          <div class="flex justify-between"><span class="text-charcoal-400">Ongkir</span><span>${formatRupiah(order.ongkir)}</span></div>
          <div class="flex justify-between font-semibold"><span>Total</span><span>${formatRupiah(order.total)}</span></div>
        </div>

        <div class="border-t border-charcoal-100 dark:border-charcoal-800 pt-4 space-y-3">
          <div>
            <label class="label text-xs">Ubah Status</label>
            <select id="dp-status" class="input-field">
              ${Object.keys(STATUS_BADGE).map(s => `<option value="${s}" ${order.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="label text-xs">Nomor Resi (opsional)</label>
            <input id="dp-resi" class="input-field" value="${escapeHtml(order.nomor_resi || '')}">
          </div>
          <div class="flex gap-3">
            <button id="dp-simpan" class="btn-primary flex-1 py-2.5 rounded-xl text-sm">Simpan Perubahan</button>
            <button id="dp-cetak" class="btn-outline px-4 py-2.5 rounded-xl text-sm">🖨 Cetak Nota</button>
          </div>
        </div>
      </div>
    `
    document.getElementById('dp-simpan').addEventListener('click', async () => {
      try {
        await updateOrderStatus(order.id, document.getElementById('dp-status').value, document.getElementById('dp-resi').value.trim() || null)
        toast('Status pesanan diperbarui', 'success')
        closeModal()
        renderPesananTable()
        loadDashboard()
      } catch (e) { toast('Gagal memperbarui status', 'error') }
    })
    document.getElementById('dp-cetak').addEventListener('click', () => cetakNotaPesanan(order, settingsCache.nama_toko || 'NataRuang'))
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<p class="text-sm text-red-400 text-center py-8">Gagal memuat detail pesanan</p>`
  }
}

// ══════════════════════════════════════════════════════════
// TAB: PEMBAYARAN
// ══════════════════════════════════════════════════════════

async function loadPembayaranTab() {
  const container = document.getElementById('tbl-pembayaran')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-40 rounded-2xl"></div>`
  try {
    const payments = await getPaymentsPending()
    if (!payments.length) {
      container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10 bg-white dark:bg-charcoal-900 rounded-2xl shadow-card">Tidak ada pembayaran yang menunggu verifikasi 🎉</p>`
      return
    }
    container.innerHTML = payments.map(p => `
      <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-5 shadow-card flex flex-col sm:flex-row gap-4">
        <div class="w-full sm:w-32 h-32 rounded-xl overflow-hidden bg-charcoal-100 dark:bg-charcoal-700 flex-shrink-0">
          ${p.bukti_transfer_url
            ? `<a href="${escapeHtml(p.bukti_transfer_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(p.bukti_transfer_url)}" class="w-full h-full object-cover"></a>`
            : `<div class="w-full h-full flex items-center justify-center text-2xl text-charcoal-300">🧾</div>`}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold">${escapeHtml(p.order?.invoice_number || '-')}</p>
          <p class="text-sm text-charcoal-500">${escapeHtml(p.order?.nama_pembeli || '-')} · ${escapeHtml(p.order?.nomor_wa || '-')}</p>
          <p class="text-xs text-charcoal-400 mt-1">Metode: ${p.metode === 'qris' ? 'QRIS' : 'Transfer Bank'} · ${formatTanggal(p.created_at)}</p>
          <div class="flex items-end gap-2 mt-2">
            <p class="text-sm text-charcoal-400">Total Pesanan: <span class="font-medium text-charcoal-900 dark:text-white">${formatRupiah(p.order?.total || 0)}</span></p>
          </div>
          <p class="text-sm mt-1">Nominal dibayar: <span class="font-semibold text-wood-600">${formatRupiah(p.nominal_bayar || 0)}</span></p>
          <div class="flex gap-2 mt-3">
            <button class="btn-verify-approve bg-green-600 hover:bg-green-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition" data-id="${p.id}">✓ Setujui</button>
            <button class="btn-verify-reject bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-xl transition" data-id="${p.id}">✕ Tolak</button>
          </div>
        </div>
      </div>
    `).join('')

    container.querySelectorAll('.btn-verify-approve').forEach(b =>
      b.addEventListener('click', () => prosesVerifikasi(b.dataset.id, true)))
    container.querySelectorAll('.btn-verify-reject').forEach(b =>
      b.addEventListener('click', () => prosesVerifikasi(b.dataset.id, false)))
  } catch (e) {
    console.error(e)
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat data pembayaran</p>`
  }
}

async function prosesVerifikasi(paymentId, approve) {
  const catatan = approve ? '' : (prompt('Alasan penolakan (opsional):') || '')
  if (!confirm(approve ? 'Setujui pembayaran ini?' : 'Tolak pembayaran ini?')) return
  try {
    await verifyPayment(paymentId, approve, catatan)
    toast(approve ? 'Pembayaran disetujui' : 'Pembayaran ditolak', 'success')
    loadPembayaranTab()
    loadDashboard()
  } catch (e) {
    toast('Gagal memproses verifikasi: ' + e.message, 'error')
  }
}

// ══════════════════════════════════════════════════════════
// TAB: ONGKOS KIRIM
// ══════════════════════════════════════════════════════════

async function loadOngkirTab() {
  document.getElementById('btn-tambah-ongkir').addEventListener('click', () => openOngkirForm())
  await renderOngkirTable()
}

async function renderOngkirTable() {
  const container = document.getElementById('tbl-ongkir')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-64 rounded-2xl"></div>`
  try {
    const rates = await getAllShippingRates()
    if (!rates.length) {
      container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Belum ada tarif ongkir. Tambahkan tarif untuk kota-kota di Malang Raya.</p>`
      return
    }
    container.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>Kota</th><th>Ekspedisi</th><th>Harga</th><th>Estimasi</th><th>Status</th><th class="text-right">Aksi</th></tr></thead>
        <tbody>
          ${rates.map(r => `
            <tr>
              <td class="font-medium">${escapeHtml(r.kota)}<span class="block text-xs text-charcoal-400">${escapeHtml(r.provinsi)}</span></td>
              <td>${escapeHtml(r.ekspedisi)}</td>
              <td>${formatRupiah(r.harga)}</td>
              <td>${escapeHtml(r.estimasi_durasi || '-')}</td>
              <td><span class="badge ${r.aktif ? 'badge-green' : 'badge-gray'}">${r.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
              <td class="text-right whitespace-nowrap">
                <button class="btn-edit-ongkir text-wood-600 hover:underline text-xs font-medium mr-3" data-id="${r.id}">Edit</button>
                <button class="btn-hapus-ongkir text-red-500 hover:underline text-xs font-medium" data-id="${r.id}">Hapus</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>`
    container.querySelectorAll('.btn-edit-ongkir').forEach(b =>
      b.addEventListener('click', () => openOngkirForm(rates.find(r => r.id === b.dataset.id))))
    container.querySelectorAll('.btn-hapus-ongkir').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Hapus tarif ini?')) return
        try { await deleteShippingRate(b.dataset.id); toast('Tarif dihapus', 'success'); renderOngkirTable() }
        catch (e) { toast('Gagal menghapus tarif', 'error') }
      }))
  } catch (e) {
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat data ongkir</p>`
  }
}

async function openOngkirForm(rate = null) {
  openModal(rate ? 'Edit Tarif Ongkir' : 'Tambah Tarif Ongkir', `
    <form id="form-ongkir" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Provinsi</label><input id="of-provinsi" required class="input-field" value="${escapeHtml(rate?.provinsi || 'Jawa Timur')}"></div>
        <div><label class="label">Kota/Kabupaten</label><input id="of-kota" required class="input-field" value="${escapeHtml(rate?.kota || '')}" placeholder="misal Kota Malang"></div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Ekspedisi</label><input id="of-ekspedisi" required class="input-field" value="${escapeHtml(rate?.ekspedisi || '')}" placeholder="misal Kurir Toko / JNE"></div>
        <div>
          <label class="label">Metode</label>
          <select id="of-metode" class="input-field">
            <option value="instan" ${rate?.metode === 'instan' ? 'selected' : ''}>Instan (dalam kota)</option>
            <option value="ekspedisi" ${!rate || rate?.metode === 'ekspedisi' ? 'selected' : ''}>Ekspedisi</option>
            <option value="manual" ${rate?.metode === 'manual' ? 'selected' : ''}>Manual</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Harga (Rp)</label><input id="of-harga" type="number" min="0" required class="input-field" value="${rate?.harga || ''}"></div>
        <div><label class="label">Estimasi Durasi</label><input id="of-estimasi" class="input-field" value="${escapeHtml(rate?.estimasi_durasi || '')}" placeholder="misal 1-2 hari"></div>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input id="of-aktif" type="checkbox" ${rate?.aktif !== false ? 'checked' : ''} class="rounded border-charcoal-300">
        Tarif aktif (tampil di checkout)
      </label>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="btn-outline flex-1 py-2.5 rounded-xl text-sm">Batal</button>
        <button type="submit" class="btn-primary flex-1 py-2.5 rounded-xl text-sm">Simpan</button>
      </div>
    </form>
  `)
  document.getElementById('form-ongkir').addEventListener('submit', async e => {
    e.preventDefault()
    try {
      await upsertShippingRate({
        id: rate?.id,
        provinsi: document.getElementById('of-provinsi').value.trim(),
        kota: document.getElementById('of-kota').value.trim(),
        ekspedisi: document.getElementById('of-ekspedisi').value.trim(),
        metode: document.getElementById('of-metode').value,
        harga: Number(document.getElementById('of-harga').value),
        estimasi_durasi: document.getElementById('of-estimasi').value.trim() || null,
        aktif: document.getElementById('of-aktif').checked
      })
      toast('Tarif ongkir disimpan', 'success')
      closeModal()
      renderOngkirTable()
    } catch (err) { toast('Gagal menyimpan tarif: ' + err.message, 'error') }
  })
}

// ══════════════════════════════════════════════════════════
// TAB: CHATBOT FAQ
// ══════════════════════════════════════════════════════════

async function loadFaqTab() {
  document.getElementById('btn-tambah-faq').addEventListener('click', () => openFaqForm())
  await renderFaqList()
}

async function renderFaqList() {
  const container = document.getElementById('tbl-faq')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-32 rounded-2xl"></div>`
  try {
    const faqs = await getFaqsAdmin()
    if (!faqs.length) { container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Belum ada FAQ</p>`; return }
    container.innerHTML = faqs.map(f => `
      <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-4 shadow-card">
        <div class="flex justify-between items-start gap-3">
          <div class="min-w-0">
            <p class="font-medium text-sm mb-1">${escapeHtml(f.pertanyaan)}</p>
            <p class="text-xs text-charcoal-500 line-clamp-2">${escapeHtml(f.jawaban)}</p>
            <div class="flex flex-wrap gap-1 mt-2">
              ${(f.tags || []).map(t => `<span class="badge badge-gray text-[10px]">${escapeHtml(t.keyword)}</span>`).join('')}
            </div>
          </div>
          <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
            <span class="badge ${f.aktif ? 'badge-green' : 'badge-gray'}">${f.aktif ? 'Aktif' : 'Nonaktif'}</span>
            <div class="flex gap-2">
              <button class="btn-edit-faq text-wood-600 hover:underline text-xs" data-id="${f.id}">Edit</button>
              <button class="btn-hapus-faq text-red-500 hover:underline text-xs" data-id="${f.id}">Hapus</button>
            </div>
          </div>
        </div>
      </div>
    `).join('')
    container.querySelectorAll('.btn-edit-faq').forEach(b =>
      b.addEventListener('click', () => openFaqForm(faqs.find(f => f.id === b.dataset.id))))
    container.querySelectorAll('.btn-hapus-faq').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Hapus FAQ ini?')) return
        try { await deleteFaq(b.dataset.id); toast('FAQ dihapus', 'success'); renderFaqList() }
        catch (e) { toast('Gagal menghapus FAQ', 'error') }
      }))
  } catch (e) {
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat FAQ</p>`
  }
}

async function openFaqForm(faq = null) {
  openModal(faq ? 'Edit FAQ' : 'Tambah FAQ', `
    <form id="form-faq" class="space-y-4">
      <div><label class="label">Pertanyaan</label><input id="ff-pertanyaan" required class="input-field" value="${escapeHtml(faq?.pertanyaan || '')}"></div>
      <div><label class="label">Jawaban</label><textarea id="ff-jawaban" rows="3" required class="input-field">${escapeHtml(faq?.jawaban || '')}</textarea></div>
      <div><label class="label">Kata Kunci (pisahkan dengan koma)</label>
        <input id="ff-tags" class="input-field" value="${(faq?.tags || []).map(t => t.keyword).join(', ')}" placeholder="pesan, order, cara beli">
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Prioritas</label><input id="ff-prioritas" type="number" class="input-field" value="${faq?.prioritas ?? 0}"></div>
        <label class="flex items-center gap-2 text-sm mt-6">
          <input id="ff-aktif" type="checkbox" ${faq?.aktif !== false ? 'checked' : ''} class="rounded border-charcoal-300"> Aktif
        </label>
      </div>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="btn-outline flex-1 py-2.5 rounded-xl text-sm">Batal</button>
        <button type="submit" class="btn-primary flex-1 py-2.5 rounded-xl text-sm">Simpan</button>
      </div>
    </form>
  `)
  document.getElementById('form-faq').addEventListener('submit', async e => {
    e.preventDefault()
    try {
      const tags = document.getElementById('ff-tags').value.split(',').map(t => t.trim()).filter(Boolean)
      await upsertFaq({
        id: faq?.id,
        pertanyaan: document.getElementById('ff-pertanyaan').value.trim(),
        jawaban: document.getElementById('ff-jawaban').value.trim(),
        prioritas: Number(document.getElementById('ff-prioritas').value) || 0,
        aktif: document.getElementById('ff-aktif').checked
      }, tags)
      toast('FAQ disimpan', 'success')
      closeModal()
      renderFaqList()
    } catch (err) { toast('Gagal menyimpan FAQ: ' + err.message, 'error') }
  })
}

// ══════════════════════════════════════════════════════════
// TAB: TESTIMONI
// ══════════════════════════════════════════════════════════

async function loadTestimoniTab() {
  document.getElementById('btn-tambah-testimoni').addEventListener('click', () => openTestimoniForm())
  await renderTestimoniList()
}

async function renderTestimoniList() {
  const container = document.getElementById('tbl-testimoni')
  container.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-32 rounded-2xl"></div>`
  try {
    const list = await getTestimonialsAdmin()
    if (!list.length) { container.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-10">Belum ada testimoni</p>`; return }
    container.innerHTML = list.map(t => `
      <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-4 shadow-card flex justify-between items-start gap-3">
        <div class="min-w-0">
          <p class="font-medium text-sm">${escapeHtml(t.nama)} <span class="text-xs text-charcoal-400 font-normal">· ${escapeHtml(t.kota || '-')}</span></p>
          <p class="text-amber-400 text-xs mb-1">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</p>
          <p class="text-xs text-charcoal-500 line-clamp-2">${escapeHtml(t.pesan)}</p>
        </div>
        <div class="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span class="badge ${t.tampil ? 'badge-green' : 'badge-gray'}">${t.tampil ? 'Tampil' : 'Disembunyikan'}</span>
          <div class="flex gap-2">
            <button class="btn-edit-testi text-wood-600 hover:underline text-xs" data-id="${t.id}">Edit</button>
            <button class="btn-hapus-testi text-red-500 hover:underline text-xs" data-id="${t.id}">Hapus</button>
          </div>
        </div>
      </div>
    `).join('')
    container.querySelectorAll('.btn-edit-testi').forEach(b =>
      b.addEventListener('click', () => openTestimoniForm(list.find(t => t.id === b.dataset.id))))
    container.querySelectorAll('.btn-hapus-testi').forEach(b =>
      b.addEventListener('click', async () => {
        if (!confirm('Hapus testimoni ini?')) return
        try { await deleteTestimonial(b.dataset.id); toast('Testimoni dihapus', 'success'); renderTestimoniList() }
        catch (e) { toast('Gagal menghapus testimoni', 'error') }
      }))
  } catch (e) {
    container.innerHTML = `<p class="text-center text-sm text-red-400 py-10">Gagal memuat testimoni</p>`
  }
}

async function openTestimoniForm(testi = null) {
  openModal(testi ? 'Edit Testimoni' : 'Tambah Testimoni', `
    <form id="form-testi" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">Nama</label><input id="tf-nama" required class="input-field" value="${escapeHtml(testi?.nama || '')}"></div>
        <div><label class="label">Kota</label><input id="tf-kota" class="input-field" value="${escapeHtml(testi?.kota || '')}"></div>
      </div>
      <div><label class="label">Pesan</label><textarea id="tf-pesan" rows="3" required class="input-field">${escapeHtml(testi?.pesan || '')}</textarea></div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label">Rating</label>
          <select id="tf-rating" class="input-field">
            ${[5,4,3,2,1].map(r => `<option value="${r}" ${(testi?.rating || 5) === r ? 'selected' : ''}>${r} bintang</option>`).join('')}
          </select>
        </div>
        <label class="flex items-center gap-2 text-sm mt-6">
          <input id="tf-tampil" type="checkbox" ${testi?.tampil ? 'checked' : ''} class="rounded border-charcoal-300"> Tampilkan di beranda
        </label>
      </div>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="btn-outline flex-1 py-2.5 rounded-xl text-sm">Batal</button>
        <button type="submit" class="btn-primary flex-1 py-2.5 rounded-xl text-sm">Simpan</button>
      </div>
    </form>
  `)
  document.getElementById('form-testi').addEventListener('submit', async e => {
    e.preventDefault()
    try {
      await upsertTestimonial({
        id: testi?.id,
        nama: document.getElementById('tf-nama').value.trim(),
        kota: document.getElementById('tf-kota').value.trim() || null,
        pesan: document.getElementById('tf-pesan').value.trim(),
        rating: Number(document.getElementById('tf-rating').value),
        tampil: document.getElementById('tf-tampil').checked
      })
      toast('Testimoni disimpan', 'success')
      closeModal()
      renderTestimoniList()
    } catch (err) { toast('Gagal menyimpan testimoni: ' + err.message, 'error') }
  })
}

// ══════════════════════════════════════════════════════════
// TAB: LAPORAN
// ══════════════════════════════════════════════════════════

async function loadPengaturanTab() {
  await renderSettingsForm()
}

const SETTINGS_FIELDS = {
  nama_toko:         { label: 'Nama Toko' },
  tagline:           { label: 'Tagline' },
  alamat:            { label: 'Alamat Toko' },
  nomor_wa:          { label: 'Nomor WhatsApp (628xxx)' },
  email:             { label: 'Email Toko' },
  jam_operasional:   { label: 'Jam Operasional' },
  instagram:         { label: 'Instagram (tanpa @)' },
  facebook:          { label: 'URL Facebook' },
  tiktok:            { label: 'TikTok (tanpa @)' },
  bank_nama:         { label: 'Nama Bank' },
  bank_rekening:     { label: 'Nomor Rekening' },
  bank_atas_nama:    { label: 'Atas Nama Rekening' },
  qris_url:          { label: 'URL Gambar QRIS' },
  logo_url:          { label: 'URL Logo' },
  watermark_text:    { label: 'Teks Watermark Foto' },
  watermark_opacity: { label: 'Opasitas Watermark (0–1)' },
  maps_embed:        { label: 'Embed URL Google Maps' },

  promo_aktif:      { label: 'Tampilkan Banner Promo di Halaman Utama', type: 'toggle', group: 'Promo / Flash Sale' },
  promo_judul:      { label: 'Judul Promo (mis. Flash Sale Akhir Bulan)', group: 'Promo / Flash Sale' },
  promo_teks:       { label: 'Deskripsi Promo', group: 'Promo / Flash Sale' },
  promo_link:       { label: 'Link Tombol "Lihat Promo"', group: 'Promo / Flash Sale' },
  promo_berakhir:   { label: 'Promo Berakhir Pada', type: 'datetime-local', group: 'Promo / Flash Sale' },

  member_aktif:     { label: 'Tampilkan Bagian Member di Halaman Utama', type: 'toggle', group: 'Program Member' },
  member_benefit_1: { label: 'Manfaat Member #1', group: 'Program Member' },
  member_benefit_2: { label: 'Manfaat Member #2', group: 'Program Member' },
  member_benefit_3: { label: 'Manfaat Member #3', group: 'Program Member' },
  member_benefit_4: { label: 'Manfaat Member #4', group: 'Program Member' }
}

function fieldInputHtml(key, field, value) {
  if (field.type === 'toggle') {
    const checked = value === 'true'
    return `
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" data-key="${key}" class="setting-input w-4 h-4 text-wood-600 rounded" ${checked ? 'checked' : ''}>
        <span class="text-xs text-charcoal-500">${checked ? 'Aktif' : 'Nonaktif'}</span>
      </label>`
  }
  if (field.type === 'datetime-local') {
    return `<input type="datetime-local" data-key="${key}" class="input-field setting-input" value="${escapeHtml(value)}">`
  }
  return `<input data-key="${key}" class="input-field setting-input" value="${escapeHtml(value)}">`
}

async function renderSettingsForm() {
  const container = document.getElementById('form-settings')
  try {
    settingsCache = await getSettings()

    let lastGroup = null
    container.innerHTML = Object.keys(SETTINGS_FIELDS).map(key => {
      const field = SETTINGS_FIELDS[key]
      const groupHeader = field.group && field.group !== lastGroup
        ? `<p class="text-xs font-semibold text-wood-600 uppercase tracking-wide pt-4 pb-1 ${lastGroup ? 'border-t border-charcoal-100 dark:border-charcoal-800 mt-2' : ''}">${field.group}</p>`
        : ''
      lastGroup = field.group || lastGroup
      return `
        ${groupHeader}
        <div>
          <label class="label text-xs">${field.label}</label>
          ${fieldInputHtml(key, field, settingsCache[key] || '')}
        </div>`
    }).join('')

    container.innerHTML += `
      <button id="btn-simpan-settings" class="btn-primary w-full py-2.5 rounded-xl text-sm mt-2">Simpan Semua Pengaturan</button>
      <p class="text-[11px] text-charcoal-400 text-center mt-2">Kredensial Supabase (URL &amp; anon key) diatur lewat file .env, bukan di sini, demi keamanan.</p>
    `
    document.getElementById('btn-simpan-settings').addEventListener('click', async (e) => {
      e.preventDefault()
      const btn = e.currentTarget
      btn.disabled = true
      btn.textContent = 'Menyimpan...'
      try {
        const inputs = container.querySelectorAll('.setting-input')
        for (const input of inputs) {
          const key    = input.dataset.key
          const newVal = input.type === 'checkbox' ? String(input.checked) : input.value
          if (newVal !== (settingsCache[key] || '')) {
            await updateSetting(key, newVal)
          }
        }
        toast('Pengaturan berhasil disimpan', 'success')
        settingsCache = await getSettings()
      } catch (err) {
        toast('Gagal menyimpan pengaturan: ' + err.message, 'error')
      } finally {
        btn.disabled = false
        btn.textContent = 'Simpan Semua Pengaturan'
      }
    })
  } catch (e) {
    container.innerHTML = `<p class="text-sm text-red-400">Gagal memuat pengaturan</p>`
  }
}

async function loadLaporanTab() {
  document.getElementById('btn-export-excel').addEventListener('click', () => exportLaporan('excel'))
  document.getElementById('btn-export-pdf').addEventListener('click', () => exportLaporan('pdf'))
}

async function exportLaporan(tipe) {
  const dari = document.getElementById('lap-dari').value || undefined
  const sampai = document.getElementById('lap-sampai').value || undefined
  const status = document.getElementById('lap-status').value || undefined
  const btn = document.getElementById(tipe === 'excel' ? 'btn-export-excel' : 'btn-export-pdf')
  const teksAsli = btn.textContent
  btn.disabled = true
  btn.textContent = 'Memproses...'

  try {
    const orders = await getOrdersExport({ dari, sampai, status })
    if (!orders.length) {
      toast('Tidak ada data pesanan pada rentang/filter tersebut', 'error')
      return
    }

    document.getElementById('tbl-laporan').innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>Invoice</th><th>Pembeli</th><th>Tanggal</th><th>Status</th><th>Total</th></tr></thead>
        <tbody>
          ${orders.map(o => `<tr>
            <td>${escapeHtml(o.invoice_number)}</td><td>${escapeHtml(o.nama_pembeli)}</td>
            <td>${formatTanggal(o.created_at)}</td><td><span class="badge ${STATUS_BADGE[o.status] || 'badge-gray'}">${o.status.replace(/_/g, ' ')}</span></td>
            <td>${formatRupiah(o.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`

    if (tipe === 'excel') exportOrdersExcel(orders)
    else exportOrdersPDF(orders, settingsCache.nama_toko || 'NataRuang')

    toast('Laporan berhasil diunduh', 'success')
  } catch (e) {
    console.error(e)
    toast('Gagal membuat laporan: ' + e.message, 'error')
  } finally {
    btn.disabled = false
    btn.textContent = teksAsli
  }
}
