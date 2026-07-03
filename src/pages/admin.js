// src/pages/admin.js
// Logika Dashboard Admin NataRuang — CRUD produk, kategori, pesanan,
// pembayaran, ongkir, chatbot FAQ, testimoni, laporan, pengaturan.

import { requireRole, logoutStaff, changeMyPassword, ROLE_LABELS } from '@/lib/auth.js'
import {
  getSettings, updateSetting,
  getCategories, upsertCategory, deleteCategory,
  getProducts, getProductById, upsertProduct, deleteProduct,
  getProductsRingkas,
  uploadFotoProduk, uploadFileUmum, insertProductImage, deleteProductImage,
  getAllShippingRates, upsertShippingRate, deleteShippingRate,
  getOrders, updateOrderStatus,
  getPaymentsPending, verifyPayment,
  getFaqsAdmin, upsertFaq, deleteFaq,
  getTestimonialsAdmin, upsertTestimonial, deleteTestimonial,
  getDashboardSummary, getProdukPalingDilihat, getProdukTerlaris,
  getPenjualanHarian, getPenjualanBulanan, getOrdersExport,
  getPercakapanCS, getPesanPercakapan, kirimPesanCS, updateStatusPercakapan,
  tandaiPesanDibacaCS, hitungPesanBelumDibaca, subscribeSemuaPercakapan,
  getBaganAkun, getJurnalEntries, getJurnalDetail, buatJurnalManual, hapusJurnal,
  getBukuBesar, getNeraca, getLabaRugi,
  getGudang, upsertGudang, getStokLokasi, catatPergerakanStok,
  setujuiPergerakanStok, getPergerakanMenungguApproval, getKartuStok
} from '@/lib/api.js'
import {
  formatRupiah, formatTanggal, formatDatetime, escapeHtml, toast, debounce,
  initDarkMode, toggleDarkMode
} from '@/lib/utils.js'
import { prosesGambarProduk } from '@/lib/watermark.js'
import { exportOrdersExcel, exportOrdersPDF, cetakNotaPesanan } from '@/lib/report.js'

let settingsCache = {}
let currentUser   = null   // { user, profile }
let unsubChatRealtime = null

// ── Guard: wajib login sebagai Admin / CS / Finance ────────────
// Menu sidebar akan menyesuaikan otomatis sesuai role (lihat applyRoleMenu()).
;(async function bootstrap() {
  currentUser = await requireRole(['admin', 'cs', 'finance'])
  if (!currentUser) return // sudah di-redirect ke login.html oleh requireRole()
  await init()
})()

async function init() {
  initDarkMode()
  document.getElementById('btn-darkmode').addEventListener('click', toggleDarkMode)

  renderStaffBadge()
  applyRoleMenu(currentUser.profile.role)

  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (unsubChatRealtime) unsubChatRealtime()
    await logoutStaff()
    window.location.replace('/login.html')
  })

  document.getElementById('btn-ganti-password').addEventListener('click', bukaFormGantiPassword)

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

  if (['admin', 'cs'].includes(currentUser.profile.role)) {
    await perbaruiBadgeLivechat()
    mulaiRealtimeChatJikaBelum()
  }

  await loadDashboard()
}

// ── Tab switching ────────────────────────────────────────────

const TAB_TITLES = {
  dashboard: 'Dashboard', produk: 'Produk', kategori: 'Kategori', stok: 'Stok', pesanan: 'Pesanan',
  livechat: 'Live Chat', pembayaran: 'Pembayaran', ongkir: 'Ongkos Kirim', chatbot: 'Chatbot FAQ',
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
    produk: loadProdukTab, kategori: loadKategoriTab, stok: loadStokTab, pesanan: loadPesananTab,
    livechat: loadLiveChatTab,
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

// ── STAFF BADGE, GANTI PASSWORD & FILTER MENU PER ROLE ─────────

function applyRoleMenu(role) {
  document.querySelectorAll('.sidebar-btn[data-roles]').forEach(btn => {
    const allowed = btn.dataset.roles.split(',')
    if (!allowed.includes(role)) btn.classList.add('hidden')
  })
}

function renderStaffBadge() {
  const el = document.getElementById('staff-badge')
  if (!el || !currentUser) return
  const { nama_lengkap, role } = currentUser.profile
  el.textContent = `${nama_lengkap} · ${ROLE_LABELS[role] || role}`
}

function bukaFormGantiPassword() {
  openModal('Ganti Password', `
    <form id="form-ganti-password" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5">Password Lama</label>
        <input type="password" id="gp-lama" required minlength="6" class="input-field w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1.5">Password Baru</label>
        <input type="password" id="gp-baru" required minlength="6" class="input-field w-full">
      </div>
      <div>
        <label class="block text-sm font-medium mb-1.5">Ulangi Password Baru</label>
        <input type="password" id="gp-ulang" required minlength="6" class="input-field w-full">
      </div>
      <p id="gp-error" class="text-red-500 text-xs hidden"></p>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-charcoal-200 dark:border-charcoal-700">Batal</button>
        <button type="submit" class="flex-1 btn-primary py-2.5 rounded-xl text-sm font-semibold">Simpan</button>
      </div>
    </form>
  `)

  document.getElementById('form-ganti-password').addEventListener('submit', async (e) => {
    e.preventDefault()
    const errEl  = document.getElementById('gp-error')
    const lama   = document.getElementById('gp-lama').value
    const baru   = document.getElementById('gp-baru').value
    const ulang  = document.getElementById('gp-ulang').value

    errEl.classList.add('hidden')

    if (baru !== ulang) {
      errEl.textContent = 'Password baru dan ulangi password tidak sama'
      errEl.classList.remove('hidden')
      return
    }

    try {
      await changeMyPassword(currentUser.profile.username, lama, baru)
      closeModal()
      toast('Password berhasil diubah')
    } catch (err) {
      errEl.textContent = err.message || 'Gagal mengubah password'
      errEl.classList.remove('hidden')
    }
  })
}

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

const SETTINGS_SECTIONS = [
  {
    judul: 'Informasi Toko',
    fields: {
      nama_toko: 'Nama Toko', tagline: 'Tagline', alamat: 'Alamat Toko',
      nomor_wa: 'Nomor WhatsApp (format 628xxx)', email: 'Email Toko', jam_operasional: 'Jam Operasional',
    },
  },
  {
    judul: 'Pembayaran (Rekening Bank & QRIS)',
    fields: {
      bank_nama: 'Nama Bank', bank_rekening: 'Nomor Rekening', bank_atas_nama: 'Atas Nama Rekening',
    },
  },
  {
    judul: 'Sosial Media',
    fields: { instagram: 'Instagram (tanpa @)', facebook: 'URL Facebook', tiktok: 'TikTok (tanpa @)' },
  },
  {
    judul: 'Lainnya',
    fields: {
      logo_url: 'URL Logo', watermark_text: 'Teks Watermark Foto', watermark_opacity: 'Opasitas Watermark (0–1)',
      maps_embed: 'Embed URL Google Maps',
    },
  },
]

async function renderSettingsForm() {
  const container = document.getElementById('form-settings')
  try {
    settingsCache = await getSettings()

    container.innerHTML = SETTINGS_SECTIONS.map(sec => `
      <div class="mb-6">
        <h3 class="font-semibold text-sm mb-3 text-charcoal-500 dark:text-charcoal-400">${sec.judul}</h3>
        <div class="space-y-4">
          ${Object.keys(sec.fields).map(key => `
            <div>
              <label class="label text-xs">${sec.fields[key]}</label>
              <input data-key="${key}" class="input-field w-full setting-input" value="${escapeHtml(settingsCache[key] || '')}">
            </div>`).join('')}
        </div>
      </div>`).join('') + `
      <div class="mb-6">
        <h3 class="font-semibold text-sm mb-3 text-charcoal-500 dark:text-charcoal-400">Gambar QRIS</h3>
        <div class="flex items-start gap-4">
          <div id="qris-preview-wrap" class="w-32 h-32 rounded-xl border border-charcoal-200 dark:border-charcoal-700 overflow-hidden flex items-center justify-center bg-charcoal-50 dark:bg-charcoal-800 flex-shrink-0">
            ${settingsCache.qris_url
              ? `<img id="qris-preview" src="${escapeHtml(settingsCache.qris_url)}" class="w-full h-full object-contain">`
              : `<span class="text-[10px] text-charcoal-400 text-center px-2">Belum ada QRIS</span>`}
          </div>
          <div class="flex-1">
            <input id="qris-file" type="file" accept="image/jpeg,image/png,image/webp" class="input-field w-full text-xs">
            <p class="text-[11px] text-charcoal-400 mt-1.5">Upload foto/screenshot QRIS toko (JPG/PNG/WebP). Tampil otomatis di halaman pembayaran pembeli.</p>
            <p id="qris-upload-status" class="text-xs mt-1 hidden"></p>
          </div>
        </div>
        <input type="hidden" data-key="qris_url" id="qris-url-hidden" value="${escapeHtml(settingsCache.qris_url || '')}">
      </div>
      <button id="btn-simpan-settings" class="btn-primary w-full py-2.5 rounded-xl text-sm mt-2">Simpan Semua Pengaturan</button>
      <p class="text-[11px] text-charcoal-400 text-center mt-2">Kredensial Supabase (URL &amp; anon key) diatur lewat file .env, bukan di sini, demi keamanan.</p>
    `

    document.getElementById('qris-file').addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      const statusEl = document.getElementById('qris-upload-status')
      statusEl.textContent = 'Mengunggah...'
      statusEl.classList.remove('hidden', 'text-red-500')
      try {
        const url = await uploadFileUmum(file, 'pengaturan')
        document.getElementById('qris-url-hidden').value = url
        document.getElementById('qris-preview-wrap').innerHTML = `<img id="qris-preview" src="${url}" class="w-full h-full object-contain">`
        statusEl.textContent = 'Berhasil diunggah — klik "Simpan Semua Pengaturan" untuk menerapkan'
        statusEl.classList.add('text-green-600')
      } catch (err) {
        statusEl.textContent = 'Gagal upload: ' + err.message
        statusEl.classList.add('text-red-500')
      }
    })

    document.getElementById('btn-simpan-settings').addEventListener('click', async (e) => {
      e.preventDefault()
      const btn = e.currentTarget
      btn.disabled = true
      btn.textContent = 'Menyimpan...'
      try {
        const inputs = container.querySelectorAll('.setting-input, #qris-url-hidden')
        for (const input of inputs) {
          if (input.value !== (settingsCache[input.dataset.key] || '')) {
            await updateSetting(input.dataset.key, input.value)
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

let laporanSubTabsInit = false
let stokSubTabsInit = false

async function loadLaporanTab() {
  document.getElementById('btn-export-excel').addEventListener('click', () => exportLaporan('excel'))
  document.getElementById('btn-export-pdf').addEventListener('click', () => exportLaporan('pdf'))

  if (!laporanSubTabsInit) {
    laporanSubTabsInit = true
    const nav = document.querySelectorAll('#tab-laporan .lap-subtab-btn')
    nav.forEach(btn => {
      btn.addEventListener('click', () => {
        nav.forEach(b => b.classList.toggle('active', b === btn))
        document.querySelectorAll('#tab-laporan .lap-subpanel').forEach(p => p.classList.add('hidden'))
        document.getElementById(`lap-sub-${btn.dataset.sub}`).classList.remove('hidden')
        onShowLaporanSubTab(btn.dataset.sub)
      })
    })
  }

  document.getElementById('btn-filter-jurnal').addEventListener('click', () => renderJurnalUmum(1))
  document.getElementById('btn-jurnal-manual').addEventListener('click', bukaFormJurnalManual)
  document.getElementById('btn-filter-bb').addEventListener('click', renderBukuBesar)
  document.getElementById('btn-filter-neraca').addEventListener('click', renderNeraca)
  document.getElementById('btn-filter-lr').addEventListener('click', renderLabaRugi)
  document.getElementById('form-pajak').addEventListener('submit', simpanPengaturanPajak)

  const today = new Date().toISOString().slice(0, 10)
  document.getElementById('neraca-tanggal').value = today
  document.getElementById('lr-dari').value = today.slice(0, 8) + '01'
  document.getElementById('lr-sampai').value = today
}

let laporanSubTabLoaded = new Set()

function onShowLaporanSubTab(sub) {
  if (laporanSubTabLoaded.has(sub)) return
  laporanSubTabLoaded.add(sub)
  if (sub === 'jurnal')     renderJurnalUmum(1)
  if (sub === 'bukubesar')  isiDropdownAkun()
  if (sub === 'neraca')     renderNeraca()
  if (sub === 'labarugi')   renderLabaRugi()
  if (sub === 'pajak')      isiFormPajak()
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

// ══════════════════════════════════════════════════════════
// LAPORAN — SUB: JURNAL UMUM
// ══════════════════════════════════════════════════════════

async function renderJurnalUmum(page = 1) {
  const dari = document.getElementById('jurnal-dari').value || undefined
  const sampai = document.getElementById('jurnal-sampai').value || undefined
  const tbl = document.getElementById('tbl-jurnal')
  tbl.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-40 m-4 rounded-xl"></div>`

  try {
    const { rows, totalPages } = await getJurnalEntries({ dari, sampai, page })

    if (!rows.length) {
      tbl.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-8">Belum ada jurnal pada rentang ini</p>`
      document.getElementById('paginasi-jurnal').innerHTML = ''
      return
    }

    tbl.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>No. Jurnal</th><th>Tanggal</th><th>Keterangan</th><th>Sumber</th><th>Debit</th><th>Kredit</th><th></th></tr></thead>
        <tbody>
          ${rows.map(j => `<tr class="cursor-pointer" data-id="${j.id}">
            <td class="font-mono text-xs">${j.nomor_jurnal}</td>
            <td>${formatTanggal(j.tanggal)}</td>
            <td>${escapeHtml(j.keterangan)}</td>
            <td><span class="text-xs text-charcoal-400">${j.sumber === 'manual' ? 'Manual' : 'Otomatis'}</span></td>
            <td>${formatRupiah(j.total_debit)}</td>
            <td>${formatRupiah(j.total_kredit)}</td>
            <td>
              ${currentUser.profile.role === 'admin'
                ? `<button class="btn-hapus-jurnal text-red-500 hover:text-red-600 text-xs" data-id="${j.id}">Hapus</button>`
                : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`

    tbl.querySelectorAll('tr[data-id]').forEach(tr =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.btn-hapus-jurnal')) return
        lihatDetailJurnal(tr.dataset.id)
      })
    )
    tbl.querySelectorAll('.btn-hapus-jurnal').forEach(btn =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm('Hapus jurnal ini? Tindakan ini tidak bisa dibatalkan.')) return
        try {
          await hapusJurnal(btn.dataset.id)
          toast('Jurnal dihapus')
          renderJurnalUmum(page)
        } catch (err) {
          toast('Gagal menghapus: ' + err.message, 'error')
        }
      })
    )

    renderSimplePagination('paginasi-jurnal', page, totalPages, (p) => renderJurnalUmum(p))
  } catch (e) {
    tbl.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat jurnal</p>`
  }
}

async function lihatDetailJurnal(jurnalId) {
  try {
    const baris = await getJurnalDetail(jurnalId)
    openModal('Detail Jurnal', `
      <table class="admin-table">
        <thead><tr><th>Akun</th><th>Debit</th><th>Kredit</th><th>Keterangan</th></tr></thead>
        <tbody>
          ${baris.map(b => `<tr>
            <td>${b.akun.kode_akun} — ${escapeHtml(b.akun.nama_akun)}</td>
            <td>${Number(b.debit) > 0 ? formatRupiah(b.debit) : '-'}</td>
            <td>${Number(b.kredit) > 0 ? formatRupiah(b.kredit) : '-'}</td>
            <td class="text-xs text-charcoal-400">${escapeHtml(b.keterangan || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `)
  } catch (e) {
    toast('Gagal memuat detail jurnal', 'error')
  }
}

let baganAkunCache = []

async function bukaFormJurnalManual() {
  if (!baganAkunCache.length) baganAkunCache = await getBaganAkun()

  const opsiAkun = baganAkunCache.map(a => `<option value="${a.id}">${a.kode_akun} — ${escapeHtml(a.nama_akun)}</option>`).join('')

  openModal('Jurnal Manual', `
    <form id="form-jurnal-manual" class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label text-xs">Tanggal</label>
          <input type="date" id="jm-tanggal" required class="input-field w-full" value="${new Date().toISOString().slice(0,10)}">
        </div>
      </div>
      <div>
        <label class="label text-xs">Keterangan</label>
        <input type="text" id="jm-keterangan" required class="input-field w-full" placeholder="Mis. Pembayaran sewa toko bulan Juli">
      </div>
      <div>
        <label class="label text-xs">Baris Jurnal (minimal 2, total debit harus = total kredit)</label>
        <div id="jm-baris" class="space-y-2"></div>
        <button type="button" id="jm-tambah-baris" class="text-xs text-wood-600 mt-2">+ Tambah baris</button>
      </div>
      <div class="flex justify-between text-xs font-semibold pt-2 border-t border-charcoal-100 dark:border-charcoal-800">
        <span>Total Debit: <span id="jm-total-debit">Rp 0</span></span>
        <span>Total Kredit: <span id="jm-total-kredit">Rp 0</span></span>
      </div>
      <p id="jm-error" class="text-red-500 text-xs hidden"></p>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-charcoal-200 dark:border-charcoal-700">Batal</button>
        <button type="submit" class="flex-1 btn-primary py-2.5 rounded-xl text-sm font-semibold">Simpan Jurnal</button>
      </div>
    </form>
  `)

  const barisEl = document.getElementById('jm-baris')

  function tambahBaris() {
    const row = document.createElement('div')
    row.className = 'flex gap-2 items-start jm-row'
    row.innerHTML = `
      <select class="input-field flex-1 jm-akun text-xs">${opsiAkun}</select>
      <input type="number" min="0" step="1" placeholder="Debit" class="input-field w-28 jm-debit text-xs">
      <input type="number" min="0" step="1" placeholder="Kredit" class="input-field w-28 jm-kredit text-xs">
      <button type="button" class="jm-hapus-baris text-red-500 text-xs px-1">✕</button>
    `
    barisEl.appendChild(row)
    row.querySelector('.jm-debit').addEventListener('input', hitungTotalJurnal)
    row.querySelector('.jm-kredit').addEventListener('input', hitungTotalJurnal)
    row.querySelector('.jm-hapus-baris').addEventListener('click', () => { row.remove(); hitungTotalJurnal() })
  }

  function hitungTotalJurnal() {
    let td = 0, tk = 0
    barisEl.querySelectorAll('.jm-row').forEach(r => {
      td += Number(r.querySelector('.jm-debit').value || 0)
      tk += Number(r.querySelector('.jm-kredit').value || 0)
    })
    document.getElementById('jm-total-debit').textContent = formatRupiah(td)
    document.getElementById('jm-total-kredit').textContent = formatRupiah(tk)
  }

  document.getElementById('jm-tambah-baris').addEventListener('click', tambahBaris)
  tambahBaris()
  tambahBaris()

  document.getElementById('form-jurnal-manual').addEventListener('submit', async (e) => {
    e.preventDefault()
    const errEl = document.getElementById('jm-error')
    errEl.classList.add('hidden')

    const baris = [...barisEl.querySelectorAll('.jm-row')].map(r => ({
      akun_id: r.querySelector('.jm-akun').value,
      debit: Number(r.querySelector('.jm-debit').value || 0),
      kredit: Number(r.querySelector('.jm-kredit').value || 0),
    })).filter(b => b.debit > 0 || b.kredit > 0)

    try {
      await buatJurnalManual({
        tanggal: document.getElementById('jm-tanggal').value,
        keterangan: document.getElementById('jm-keterangan').value,
        baris,
      })
      closeModal()
      toast('Jurnal berhasil disimpan')
      laporanSubTabLoaded.delete('jurnal')
      renderJurnalUmum(1)
    } catch (err) {
      errEl.textContent = err.message
      errEl.classList.remove('hidden')
    }
  })
}

// ══════════════════════════════════════════════════════════
// LAPORAN — SUB: BUKU BESAR
// ══════════════════════════════════════════════════════════

async function isiDropdownAkun() {
  if (!baganAkunCache.length) baganAkunCache = await getBaganAkun()
  const sel = document.getElementById('bb-akun')
  sel.innerHTML = baganAkunCache.map(a => `<option value="${a.id}">${a.kode_akun} — ${escapeHtml(a.nama_akun)}</option>`).join('')
}

async function renderBukuBesar() {
  const akunId = document.getElementById('bb-akun').value
  const dari = document.getElementById('bb-dari').value || undefined
  const sampai = document.getElementById('bb-sampai').value || undefined
  const tbl = document.getElementById('tbl-bukubesar')
  if (!akunId) return
  tbl.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-40 m-4 rounded-xl"></div>`

  try {
    const rows = await getBukuBesar(akunId, { dari, sampai })
    if (!rows.length) {
      tbl.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-8">Belum ada transaksi pada akun/rentang ini</p>`
      return
    }
    tbl.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>Tanggal</th><th>No. Jurnal</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${formatTanggal(r.tanggal)}</td>
            <td class="font-mono text-xs">${r.nomor_jurnal}</td>
            <td class="text-xs">${escapeHtml(r.keterangan || '')}</td>
            <td>${Number(r.debit) > 0 ? formatRupiah(r.debit) : '-'}</td>
            <td>${Number(r.kredit) > 0 ? formatRupiah(r.kredit) : '-'}</td>
            <td class="font-semibold">${formatRupiah(r.saldo)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`
  } catch (e) {
    tbl.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat buku besar</p>`
  }
}

// ══════════════════════════════════════════════════════════
// LAPORAN — SUB: NERACA
// ══════════════════════════════════════════════════════════

async function renderNeraca() {
  const perTanggal = document.getElementById('neraca-tanggal').value
  const el = document.getElementById('tbl-neraca')
  el.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-40 rounded-xl"></div>`

  try {
    const rows = await getNeraca(perTanggal)
    const kelompok = { aset: [], kewajiban: [], ekuitas: [] }
    rows.forEach(r => kelompok[r.tipe]?.push(r))

    const totalAset = kelompok.aset.reduce((s, r) => s + Number(r.saldo), 0)
    const totalKewajiban = kelompok.kewajiban.reduce((s, r) => s + Number(r.saldo), 0)
    const totalEkuitas = kelompok.ekuitas.reduce((s, r) => s + Number(r.saldo), 0)
    const balance = Math.round(totalAset - (totalKewajiban + totalEkuitas))

    const seksi = (judul, items, total) => `
      <div class="mb-5">
        <h3 class="font-semibold text-sm mb-2">${judul}</h3>
        <table class="admin-table">
          <tbody>
            ${items.map(r => `<tr><td>${r.kode_akun} — ${escapeHtml(r.nama_akun)}</td><td class="text-right">${formatRupiah(r.saldo)}</td></tr>`).join('') || '<tr><td colspan="2" class="text-xs text-charcoal-400">Tidak ada saldo</td></tr>'}
            <tr class="font-semibold border-t border-charcoal-200 dark:border-charcoal-700"><td>Total</td><td class="text-right">${formatRupiah(total)}</td></tr>
          </tbody>
        </table>
      </div>`

    el.innerHTML = `
      <div class="grid md:grid-cols-2 gap-6">
        <div>${seksi('Aset', kelompok.aset, totalAset)}</div>
        <div>
          ${seksi('Kewajiban', kelompok.kewajiban, totalKewajiban)}
          ${seksi('Ekuitas', kelompok.ekuitas, totalEkuitas)}
        </div>
      </div>
      <div class="mt-2 p-3 rounded-xl text-xs font-semibold ${balance === 0 ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}">
        ${balance === 0 ? '✓ Neraca balance (Aset = Kewajiban + Ekuitas)' : `⚠ Selisih ${formatRupiah(Math.abs(balance))} — mohon periksa jurnal`}
      </div>`
  } catch (e) {
    el.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat neraca</p>`
  }
}

// ══════════════════════════════════════════════════════════
// LAPORAN — SUB: LABA RUGI
// ══════════════════════════════════════════════════════════

async function renderLabaRugi() {
  const dari = document.getElementById('lr-dari').value
  const sampai = document.getElementById('lr-sampai').value
  const el = document.getElementById('tbl-labarugi')
  el.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-40 rounded-xl"></div>`

  try {
    const rows = await getLabaRugi(dari, sampai)
    const pendapatan = rows.filter(r => r.tipe === 'pendapatan' && !r.kontra)
    const kontraPendapatan = rows.filter(r => r.tipe === 'pendapatan' && r.kontra)
    const beban = rows.filter(r => r.tipe === 'beban')

    const totalPendapatanKotor = pendapatan.reduce((s, r) => s + Number(r.jumlah), 0)
    const totalKontra = kontraPendapatan.reduce((s, r) => s + Number(r.jumlah), 0)
    const totalPendapatanBersih = totalPendapatanKotor - totalKontra
    const totalBeban = beban.reduce((s, r) => s + Number(r.jumlah), 0)
    const labaBersih = totalPendapatanBersih - totalBeban

    const baris = (r) => `<tr><td>${r.kode_akun} — ${escapeHtml(r.nama_akun)}</td><td class="text-right">${formatRupiah(r.jumlah)}</td></tr>`

    el.innerHTML = `
      <table class="admin-table">
        <tbody>
          <tr class="font-semibold"><td colspan="2" class="pt-3">Pendapatan</td></tr>
          ${pendapatan.map(baris).join('') || '<tr><td colspan="2" class="text-xs text-charcoal-400">Tidak ada data</td></tr>'}
          ${kontraPendapatan.map(r => `<tr><td class="text-xs text-charcoal-400">(-) ${r.kode_akun} — ${escapeHtml(r.nama_akun)}</td><td class="text-right text-xs text-charcoal-400">(${formatRupiah(r.jumlah)})</td></tr>`).join('')}
          <tr class="font-semibold border-t border-charcoal-200 dark:border-charcoal-700"><td>Pendapatan Bersih</td><td class="text-right">${formatRupiah(totalPendapatanBersih)}</td></tr>

          <tr class="font-semibold"><td colspan="2" class="pt-4">Beban</td></tr>
          ${beban.map(baris).join('') || '<tr><td colspan="2" class="text-xs text-charcoal-400">Belum ada data beban (menyusul tahap berikutnya)</td></tr>'}
          <tr class="font-semibold border-t border-charcoal-200 dark:border-charcoal-700"><td>Total Beban</td><td class="text-right">${formatRupiah(totalBeban)}</td></tr>

          <tr class="font-bold text-base border-t-2 border-charcoal-300 dark:border-charcoal-600">
            <td class="pt-3">Laba/Rugi Bersih</td>
            <td class="text-right pt-3 ${labaBersih >= 0 ? 'text-green-600' : 'text-red-500'}">${formatRupiah(labaBersih)}</td>
          </tr>
        </tbody>
      </table>`
  } catch (e) {
    el.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat laba rugi</p>`
  }
}

// ══════════════════════════════════════════════════════════
// LAPORAN — SUB: PENGATURAN PAJAK
// ══════════════════════════════════════════════════════════

function isiFormPajak() {
  document.getElementById('pajak-pkp').checked = settingsCache.toko_pkp === 'true'
  document.getElementById('pajak-tarif').value = settingsCache.tarif_ppn_persen || '11'
}

async function simpanPengaturanPajak(e) {
  e.preventDefault()
  try {
    const pkp = document.getElementById('pajak-pkp').checked
    const tarif = document.getElementById('pajak-tarif').value
    await updateSetting('toko_pkp', pkp ? 'true' : 'false')
    await updateSetting('tarif_ppn_persen', tarif)
    settingsCache.toko_pkp = pkp ? 'true' : 'false'
    settingsCache.tarif_ppn_persen = tarif
    toast('Pengaturan pajak disimpan')
  } catch (err) {
    toast('Gagal menyimpan: ' + err.message, 'error')
  }
}

// ══════════════════════════════════════════════════════════
// TAB: STOK / INVENTARIS
// ══════════════════════════════════════════════════════════

async function loadStokTab() {
  if (!stokSubTabsInit) {
    stokSubTabsInit = true
    const nav = document.querySelectorAll('#tab-stok .lap-subtab-btn')
    nav.forEach(btn => {
      btn.addEventListener('click', () => {
        nav.forEach(b => b.classList.toggle('active', b === btn))
        document.querySelectorAll('#tab-stok .stok-subpanel').forEach(p => p.classList.add('hidden'))
        document.getElementById(`stok-sub-${btn.dataset.sub}`).classList.remove('hidden')
        onShowStokSubTab(btn.dataset.sub)
      })
    })
  }

  document.getElementById('btn-catat-pergerakan').addEventListener('click', bukaFormPergerakanStok)
  document.getElementById('btn-filter-kartustok').addEventListener('click', () => renderKartuStok(1))
  document.getElementById('btn-tambah-gudang').addEventListener('click', bukaFormGudang)
  document.getElementById('stok-cari').addEventListener('input', debounce(() => renderRingkasanStok(), 400))

  await renderRingkasanStok()
  await perbaruiBadgeApprovalStok()
}

let stokSubTabLoaded = new Set()

function onShowStokSubTab(sub) {
  if (stokSubTabLoaded.has(sub)) return
  stokSubTabLoaded.add(sub)
  if (sub === 'kartustok') { isiDropdownProdukStok(); renderKartuStok(1) }
  if (sub === 'approval')  renderApprovalStok()
  if (sub === 'gudang')    renderGudang()
}

async function perbaruiBadgeApprovalStok() {
  try {
    const list = await getPergerakanMenungguApproval()
    const badge = document.getElementById('badge-stok-approval')
    const badgeSidebar = document.getElementById('badge-stok')
    if (list.length > 0) {
      badge.textContent = list.length
      badge.classList.remove('hidden')
      badgeSidebar.textContent = list.length
      badgeSidebar.classList.remove('hidden')
    } else {
      badge.classList.add('hidden')
      badgeSidebar.classList.add('hidden')
    }
  } catch (e) { /* diamkan */ }
}

async function renderRingkasanStok() {
  const search = document.getElementById('stok-cari').value.trim()
  const tbl = document.getElementById('tbl-ringkasan-stok')
  tbl.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-48 rounded-2xl"></div>`

  try {
    const produk = await getProductsRingkas({ search })
    if (!produk.length) {
      tbl.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-8">Tidak ada produk ditemukan</p>`
      return
    }
    tbl.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>Kode</th><th>Nama Produk</th><th>Stok Saat Ini</th><th></th></tr></thead>
        <tbody>
          ${produk.map(p => `<tr>
            <td class="font-mono text-xs">${escapeHtml(p.kode_produk)}</td>
            <td>${escapeHtml(p.nama)}</td>
            <td class="font-semibold ${p.stok <= 0 ? 'text-red-500' : ''}">${p.stok}</td>
            <td><button class="btn-riwayat-produk text-wood-600 text-xs" data-id="${p.id}">Riwayat</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`

    tbl.querySelectorAll('.btn-riwayat-produk').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelector('#tab-stok .lap-subtab-btn[data-sub="kartustok"]').click()
        setTimeout(async () => {
          await isiDropdownProdukStok()
          document.getElementById('ks-produk').value = btn.dataset.id
          renderKartuStok(1)
        }, 50)
      })
    )
  } catch (e) {
    tbl.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat ringkasan stok</p>`
  }
}

async function isiDropdownProdukStok() {
  const produk = await getProductsRingkas()
  const sel = document.getElementById('ks-produk')
  sel.innerHTML = `<option value="">Semua produk</option>` +
    produk.map(p => `<option value="${p.id}">${escapeHtml(p.nama)}</option>`).join('')
}

async function renderKartuStok(page) {
  const productId = document.getElementById('ks-produk').value || undefined
  const tbl = document.getElementById('tbl-kartu-stok')
  tbl.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-48 rounded-2xl"></div>`

  const TIPE_LABEL = {
    masuk_pembelian: 'Pembelian Masuk', masuk_penyesuaian: 'Penyesuaian (+)',
    retur_masuk_pembeli: 'Retur dari Pembeli', keluar_penjualan: 'Penjualan',
    keluar_penyesuaian: 'Penyesuaian (-)', retur_keluar_supplier: 'Retur ke Supplier',
    rusak_hilang: 'Rusak/Hilang',
  }
  const STATUS_LABEL = { menunggu_approval: 'Menunggu Approval', disetujui: 'Disetujui', ditolak: 'Ditolak' }
  const STATUS_CLS = { menunggu_approval: 'badge-amber', disetujui: 'badge-green', ditolak: 'badge-gray' }

  try {
    const { rows, totalPages } = await getKartuStok({ productId, page })
    if (!rows.length) {
      tbl.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-8">Belum ada pergerakan stok</p>`
      document.getElementById('paginasi-kartustok').innerHTML = ''
      return
    }
    tbl.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>Tanggal</th><th>Produk</th><th>Tipe</th><th>Arah</th><th>Qty</th><th>Nilai</th><th>Status</th><th>Keterangan</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="text-xs">${formatDatetime(r.created_at)}</td>
            <td>${escapeHtml(r.nama_produk)}</td>
            <td class="text-xs">${TIPE_LABEL[r.tipe] || r.tipe}</td>
            <td>${r.arah === 'masuk' ? '<span class="text-green-600">Masuk</span>' : '<span class="text-red-500">Keluar</span>'}</td>
            <td>${r.qty}</td>
            <td class="text-xs">${r.hpp_total ? formatRupiah(r.hpp_total) : (r.harga_satuan ? formatRupiah(r.harga_satuan * r.qty) : '-')}</td>
            <td><span class="badge ${STATUS_CLS[r.status]}">${STATUS_LABEL[r.status]}</span></td>
            <td class="text-xs text-charcoal-400">${escapeHtml(r.keterangan || '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`
    renderSimplePagination('paginasi-kartustok', page, totalPages, (p) => renderKartuStok(p))
  } catch (e) {
    tbl.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat kartu stok</p>`
  }
}

async function renderApprovalStok() {
  const tbl = document.getElementById('tbl-approval-stok')
  tbl.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-32 rounded-2xl"></div>`

  try {
    const list = await getPergerakanMenungguApproval()
    if (!list.length) {
      tbl.innerHTML = `<p class="text-center text-sm text-charcoal-400 py-8">Tidak ada pengajuan yang menunggu approval 🎉</p>`
      return
    }
    tbl.innerHTML = `
      <div class="overflow-x-auto">
      <table class="admin-table">
        <thead><tr><th>Tanggal</th><th>Produk</th><th>Qty</th><th>Keterangan</th><th>Diajukan Oleh</th><th></th></tr></thead>
        <tbody>
          ${list.map(r => `<tr>
            <td class="text-xs">${formatDatetime(r.created_at)}</td>
            <td>${escapeHtml(r.nama_produk)}</td>
            <td>${r.qty}</td>
            <td class="text-xs text-charcoal-400">${escapeHtml(r.keterangan || '')}</td>
            <td class="text-xs">${escapeHtml(r.diajukan_oleh_nama || '-')}</td>
            <td class="flex gap-2">
              <button class="btn-approve-stok text-green-600 text-xs font-semibold" data-id="${r.id}">Setujui</button>
              <button class="btn-reject-stok text-red-500 text-xs font-semibold" data-id="${r.id}">Tolak</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
      </div>`

    tbl.querySelectorAll('.btn-approve-stok').forEach(btn =>
      btn.addEventListener('click', () => prosesApprovalStok(btn.dataset.id, true))
    )
    tbl.querySelectorAll('.btn-reject-stok').forEach(btn =>
      btn.addEventListener('click', () => prosesApprovalStok(btn.dataset.id, false))
    )
  } catch (e) {
    tbl.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat daftar approval</p>`
  }
}

async function prosesApprovalStok(movementId, setuju) {
  const catatan = window.prompt(setuju ? 'Catatan approval (opsional):' : 'Alasan penolakan (opsional):', '') || null
  try {
    await setujuiPergerakanStok(movementId, setuju, catatan)
    toast(setuju ? 'Disetujui — stok & jurnal kerugian sudah diproses' : 'Pengajuan ditolak')
    await renderApprovalStok()
    await perbaruiBadgeApprovalStok()
    await renderRingkasanStok()
  } catch (err) {
    toast('Gagal memproses: ' + err.message, 'error')
  }
}

async function renderGudang() {
  const tbl = document.getElementById('tbl-gudang')
  tbl.innerHTML = `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 h-32 rounded-2xl"></div>`
  try {
    const list = await getGudang()
    tbl.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Kode</th><th>Nama Gudang</th><th>Alamat</th><th>Status</th></tr></thead>
        <tbody>
          ${list.map(g => `<tr>
            <td class="font-mono text-xs">${escapeHtml(g.kode_gudang)}</td>
            <td>${escapeHtml(g.nama_gudang)}</td>
            <td class="text-xs text-charcoal-400">${escapeHtml(g.alamat || '-')}</td>
            <td><span class="badge ${g.aktif ? 'badge-green' : 'badge-gray'}">${g.aktif ? 'Aktif' : 'Nonaktif'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`
  } catch (e) {
    tbl.innerHTML = `<p class="text-center text-sm text-red-500 py-8">Gagal memuat gudang</p>`
  }
}

function bukaFormGudang() {
  openModal('Tambah Gudang', `
    <form id="form-gudang" class="space-y-4">
      <div>
        <label class="label text-xs">Kode Gudang</label>
        <input type="text" id="gd-kode" required placeholder="GD-02" class="input-field w-full">
      </div>
      <div>
        <label class="label text-xs">Nama Gudang</label>
        <input type="text" id="gd-nama" required placeholder="Gudang Cabang Batu" class="input-field w-full">
      </div>
      <div>
        <label class="label text-xs">Alamat</label>
        <textarea id="gd-alamat" rows="2" class="input-field w-full"></textarea>
      </div>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-charcoal-200 dark:border-charcoal-700">Batal</button>
        <button type="submit" class="flex-1 btn-primary py-2.5 rounded-xl text-sm font-semibold">Simpan</button>
      </div>
    </form>
  `)

  document.getElementById('form-gudang').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await upsertGudang({
        kode_gudang: document.getElementById('gd-kode').value.trim(),
        nama_gudang: document.getElementById('gd-nama').value.trim(),
        alamat: document.getElementById('gd-alamat').value.trim() || null,
      })
      closeModal()
      toast('Gudang ditambahkan')
      renderGudang()
    } catch (err) {
      toast('Gagal menyimpan gudang: ' + err.message, 'error')
    }
  })
}

const TIPE_PERGERAKAN_OPTIONS = [
  { value: 'masuk_pembelian',      label: 'Pembelian Stok Masuk (perlu harga satuan)' },
  { value: 'masuk_penyesuaian',    label: 'Penyesuaian Stok Opname (surplus)' },
  { value: 'retur_masuk_pembeli',  label: 'Retur dari Pembeli (balik ke stok)' },
  { value: 'keluar_penyesuaian',   label: 'Penyesuaian Stok Opname (kurang)' },
  { value: 'retur_keluar_supplier',label: 'Retur ke Supplier' },
  { value: 'rusak_hilang',         label: 'Barang Rusak/Hilang (perlu approval)' },
]

async function bukaFormPergerakanStok() {
  const produk = await getProductsRingkas()
  const gudangList = await getGudang()

  openModal('Catat Pergerakan Stok', `
    <form id="form-pergerakan-stok" class="space-y-4">
      <div>
        <label class="label text-xs">Produk</label>
        <select id="ps-produk" required class="input-field w-full">
          <option value="">Pilih produk</option>
          ${produk.map(p => `<option value="${p.id}">${escapeHtml(p.nama)} (stok: ${p.stok})</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label text-xs">Gudang</label>
        <select id="ps-gudang" required class="input-field w-full">
          ${gudangList.map(g => `<option value="${g.id}">${escapeHtml(g.nama_gudang)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="label text-xs">Jenis Pergerakan</label>
        <select id="ps-tipe" required class="input-field w-full">
          ${TIPE_PERGERAKAN_OPTIONS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="label text-xs">Qty</label>
          <input type="number" id="ps-qty" min="1" required class="input-field w-full">
        </div>
        <div id="ps-harga-wrap">
          <label class="label text-xs">Harga Satuan</label>
          <input type="number" id="ps-harga" min="0" class="input-field w-full">
        </div>
      </div>
      <div>
        <label class="label text-xs">Keterangan</label>
        <textarea id="ps-keterangan" rows="2" class="input-field w-full" placeholder="Mis. supplier, nomor faktur, alasan, dll"></textarea>
      </div>
      <p id="ps-error" class="text-red-500 text-xs hidden"></p>
      <div class="flex gap-3 pt-2">
        <button type="button" onclick="closeModal()" class="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-charcoal-200 dark:border-charcoal-700">Batal</button>
        <button type="submit" class="flex-1 btn-primary py-2.5 rounded-xl text-sm font-semibold">Simpan</button>
      </div>
    </form>
  `)

  const tipeSel = document.getElementById('ps-tipe')
  const hargaWrap = document.getElementById('ps-harga-wrap')
  const toggleHarga = () => { hargaWrap.style.display = tipeSel.value === 'masuk_pembelian' ? '' : 'none' }
  tipeSel.addEventListener('change', toggleHarga)
  toggleHarga()

  document.getElementById('form-pergerakan-stok').addEventListener('submit', async (e) => {
    e.preventDefault()
    const errEl = document.getElementById('ps-error')
    errEl.classList.add('hidden')
    const tipe = tipeSel.value

    try {
      const id = await catatPergerakanStok({
        productId: document.getElementById('ps-produk').value,
        gudangId: document.getElementById('ps-gudang').value,
        tipe,
        qty: Number(document.getElementById('ps-qty').value),
        hargaSatuan: tipe === 'masuk_pembelian' ? Number(document.getElementById('ps-harga').value) : null,
        keterangan: document.getElementById('ps-keterangan').value.trim() || null,
      })
      closeModal()
      toast(tipe === 'rusak_hilang' ? 'Pengajuan tercatat, menunggu approval' : 'Pergerakan stok berhasil dicatat')
      stokSubTabLoaded.delete('kartustok')
      stokSubTabLoaded.delete('approval')
      await renderRingkasanStok()
      await perbaruiBadgeApprovalStok()
    } catch (err) {
      errEl.textContent = err.message
      errEl.classList.remove('hidden')
    }
  })
}

let percakapanAktifId = null
let percakapanCache   = []

async function loadLiveChatTab() {
  document.getElementById('filter-status-livechat').addEventListener('change', renderDaftarPercakapan)
  document.getElementById('livechat-status').addEventListener('change', ubahStatusPercakapanAktif)
  document.getElementById('form-livechat-reply').addEventListener('submit', kirimBalasanCS)

  await renderDaftarPercakapan()
  await perbaruiBadgeLivechat()
  mulaiRealtimeChatJikaBelum()
}

function mulaiRealtimeChatJikaBelum() {
  if (unsubChatRealtime) return
  unsubChatRealtime = subscribeSemuaPercakapan(async () => {
    await perbaruiBadgeLivechat()
    // Refresh list & (kalau sedang dibuka) thread aktif supaya realtime terasa "hidup"
    if (loadedTabs.has('livechat')) await renderDaftarPercakapan()
    if (percakapanAktifId) await renderThreadPercakapan(percakapanAktifId, { scrollBottom: true })
  })
}

async function perbaruiBadgeLivechat() {
  try {
    const jumlah = await hitungPesanBelumDibaca()
    const badge = document.getElementById('badge-livechat')
    if (jumlah > 0) {
      badge.textContent = jumlah > 99 ? '99+' : jumlah
      badge.classList.remove('hidden')
    } else {
      badge.classList.add('hidden')
    }
  } catch (e) {
    console.error('Gagal memuat jumlah pesan belum dibaca:', e)
  }
}

async function renderDaftarPercakapan() {
  const status = document.getElementById('filter-status-livechat').value || undefined
  const listEl = document.getElementById('list-percakapan')

  try {
    percakapanCache = await getPercakapanCS({ status })
  } catch (e) {
    listEl.innerHTML = `<p class="text-xs text-red-500 p-4">Gagal memuat percakapan</p>`
    return
  }

  if (!percakapanCache.length) {
    listEl.innerHTML = `<p class="text-xs text-charcoal-400 p-4 text-center">Belum ada percakapan</p>`
    return
  }

  const STATUS_DOT = { terbuka: 'bg-red-500', ditangani: 'bg-amber-500', selesai: 'bg-charcoal-300 dark:bg-charcoal-600' }

  listEl.innerHTML = percakapanCache.map(p => `
    <button class="btn-percakapan w-full text-left p-3 hover:bg-charcoal-50 dark:hover:bg-charcoal-800 transition ${p.id === percakapanAktifId ? 'bg-wood-50 dark:bg-wood-900/20' : ''}"
      data-id="${p.id}">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] || 'bg-charcoal-300'}"></span>
        <p class="text-sm font-medium truncate flex-1">${escapeHtml(p.nama_pembeli)}</p>
      </div>
      <p class="text-[11px] text-charcoal-400 mt-1">${formatDatetime(p.last_message_at)}</p>
    </button>
  `).join('')

  listEl.querySelectorAll('.btn-percakapan').forEach(btn =>
    btn.addEventListener('click', () => bukaPercakapan(btn.dataset.id))
  )
}

async function bukaPercakapan(id) {
  percakapanAktifId = id
  document.getElementById('livechat-empty').classList.add('hidden')
  document.getElementById('livechat-thread').classList.remove('hidden')

  document.querySelectorAll('.btn-percakapan').forEach(b =>
    b.classList.toggle('bg-wood-50', b.dataset.id === id)
  )

  const p = percakapanCache.find(x => x.id === id)
  if (p) {
    document.getElementById('livechat-nama').textContent = p.nama_pembeli
    document.getElementById('livechat-wa').textContent = p.nomor_wa || '—'
    document.getElementById('livechat-status').value = p.status
  }

  await renderThreadPercakapan(id, { scrollBottom: true })

  try {
    await tandaiPesanDibacaCS(id)
    await perbaruiBadgeLivechat()
  } catch (e) {
    console.error('Gagal menandai pesan terbaca:', e)
  }
}

async function renderThreadPercakapan(id, { scrollBottom = false } = {}) {
  if (id !== percakapanAktifId) return
  const messagesEl = document.getElementById('livechat-messages')

  let pesan = []
  try {
    pesan = await getPesanPercakapan(id)
  } catch (e) {
    messagesEl.innerHTML = `<p class="text-xs text-red-500">Gagal memuat pesan</p>`
    return
  }

  messagesEl.innerHTML = pesan.map(m => `
    <div class="flex flex-col ${m.pengirim === 'cs' ? 'items-end' : 'items-start'}">
      <div class="max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
        m.pengirim === 'cs'
          ? 'bg-wood-600 text-white rounded-tr-none'
          : 'bg-charcoal-100 dark:bg-charcoal-700 rounded-tl-none'
      }">${escapeHtml(m.isi)}</div>
      <span class="text-[10px] text-charcoal-400 mt-0.5">${m.pengirim === 'cs' ? (m.pengirim_nama || 'CS') : m.pengirim_nama} · ${formatDatetime(m.created_at)}</span>
    </div>
  `).join('')

  if (scrollBottom) messagesEl.scrollTop = messagesEl.scrollHeight
}

async function kirimBalasanCS(e) {
  e.preventDefault()
  if (!percakapanAktifId) return

  const input = document.getElementById('livechat-input')
  const isi = input.value.trim()
  if (!isi) return

  input.value = ''
  input.disabled = true

  try {
    await kirimPesanCS(percakapanAktifId, isi, currentUser.profile.nama_lengkap)
    // Kalau masih 'terbuka', otomatis pindah ke 'ditangani' saat CS pertama kali membalas
    const p = percakapanCache.find(x => x.id === percakapanAktifId)
    if (p && p.status === 'terbuka') {
      await updateStatusPercakapan(percakapanAktifId, 'ditangani', currentUser.user.id)
      document.getElementById('livechat-status').value = 'ditangani'
    }
    await renderThreadPercakapan(percakapanAktifId, { scrollBottom: true })
  } catch (err) {
    toast('Gagal mengirim balasan: ' + err.message, 'error')
  } finally {
    input.disabled = false
    input.focus()
  }
}

async function ubahStatusPercakapanAktif(e) {
  if (!percakapanAktifId) return
  const status = e.target.value
  try {
    await updateStatusPercakapan(percakapanAktifId, status, currentUser.user.id)
    toast('Status percakapan diperbarui')
    await renderDaftarPercakapan()
  } catch (err) {
    toast('Gagal mengubah status: ' + err.message, 'error')
  }
}
