// src/pages/status.js
import { getOrderByInvoice, submitBuktiTransfer, uploadBuktiTransfer, getSettings } from '@/lib/api.js'
import { supabase } from '@/lib/supabase.js'
import {
  formatRupiah, formatDatetime, escapeHtml, toast,
  initDarkMode, copyToClipboard, waKonteksInvoice
} from '@/lib/utils.js'
import { generateFileName } from '@/lib/watermark.js'

initDarkMode()

let settings    = {}
let currentOrder = null

const STATUS_LABEL = {
  menunggu_pembayaran:   { label: 'Menunggu Pembayaran', color: 'amber' },
  menunggu_verifikasi:   { label: 'Menunggu Verifikasi', color: 'blue' },
  lunas:                 { label: 'Pembayaran Lunas',    color: 'green' },
  ditolak:               { label: 'Pembayaran Ditolak',  color: 'red' },
  dikirim:               { label: 'Dalam Pengiriman',    color: 'blue' },
  selesai:               { label: 'Pesanan Selesai',     color: 'green' },
  dibatalkan:            { label: 'Dibatalkan',          color: 'red' }
}

document.addEventListener('DOMContentLoaded', async () => {
  settings = await getSettings().catch(() => ({}))

  // Ambil invoice dari URL
  const params  = new URLSearchParams(window.location.search)
  const invoice = params.get('invoice')

  const inputEl = document.getElementById('input-invoice')
  if (invoice) {
    inputEl.value = invoice
    await cariPesanan(invoice)
  }

  document.getElementById('btn-cari').addEventListener('click', () => {
    const val = inputEl.value.trim().toUpperCase()
    if (!val) { toast('Masukkan nomor invoice', 'error'); return }
    cariPesanan(val)
    // Update URL tanpa reload
    window.history.replaceState({}, '', `/status.html?invoice=${val}`)
  })

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-cari').click()
  })
})

// ── Cari pesanan ───────────────────────────────────────────

async function cariPesanan(invoice) {
  const skeleton = document.getElementById('skeleton')
  const result   = document.getElementById('order-result')

  skeleton.classList.remove('hidden')
  result.innerHTML = ''

  try {
    currentOrder = await getOrderByInvoice(invoice)
    skeleton.classList.add('hidden')
    renderOrder(currentOrder)
    subscribeRealtime(currentOrder.id)
  } catch (e) {
    skeleton.classList.add('hidden')
    result.innerHTML = `
      <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-8 shadow-card text-center">
        <p class="text-3xl mb-3">🔍</p>
        <p class="font-medium mb-1">Pesanan tidak ditemukan</p>
        <p class="text-sm text-charcoal-400">Periksa kembali nomor invoice Anda</p>
      </div>
    `
  }
}

// ── Render detail pesanan ──────────────────────────────────

function renderOrder(order) {
  const result  = document.getElementById('order-result')
  const payment = order.payment?.[0] || order.payment
  const status  = STATUS_LABEL[order.status] || { label: order.status, color: 'gray' }
  const colorMap = {
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    blue:  'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    red:   'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400',
    gray:  'bg-charcoal-100 text-charcoal-700 dark:bg-charcoal-700 dark:text-charcoal-300'
  }

  result.innerHTML = `
    <!-- Status card -->
    <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-6 shadow-card">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p class="text-xs text-charcoal-400 mb-1">No. Invoice</p>
          <p class="font-semibold text-lg">${escapeHtml(order.invoice_number)}</p>
          <p class="text-xs text-charcoal-400 mt-0.5">${formatDatetime(order.created_at)}</p>
        </div>
        <span class="px-3 py-1.5 rounded-full text-xs font-semibold ${colorMap[status.color]}">${status.label}</span>
      </div>

      <!-- Progress bar -->
      <div class="relative mb-5">
        <div class="absolute top-2 left-0 right-0 h-0.5 bg-charcoal-100 dark:bg-charcoal-800"></div>
        <div class="absolute top-2 left-0 h-0.5 bg-wood-500 transition-all duration-700"
          style="width: ${getProgressWidth(order.status)}%"></div>
        <div class="relative flex justify-between text-[10px] text-charcoal-400">
          ${['menunggu_pembayaran','menunggu_verifikasi','lunas','dikirim','selesai'].map((s, i) => `
            <div class="flex flex-col items-center gap-1.5">
              <div class="w-4 h-4 rounded-full border-2 ${isStepDone(order.status, i) ? 'bg-wood-500 border-wood-500' : 'bg-white dark:bg-charcoal-900 border-charcoal-300 dark:border-charcoal-700'}"></div>
              <span class="text-center hidden sm:block">${['Pembayaran','Verifikasi','Lunas','Dikirim','Selesai'][i]}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Info pembeli -->
      <div class="grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p class="text-xs text-charcoal-400">Nama</p>
          <p class="font-medium">${escapeHtml(order.nama_pembeli)}</p>
        </div>
        <div>
          <p class="text-xs text-charcoal-400">WhatsApp</p>
          <p class="font-medium">${escapeHtml(order.nomor_wa)}</p>
        </div>
        <div class="sm:col-span-2">
          <p class="text-xs text-charcoal-400">Alamat</p>
          <p class="font-medium">${escapeHtml(order.alamat)}, ${escapeHtml(order.kota)}, ${escapeHtml(order.provinsi)} ${order.kode_pos || ''}</p>
        </div>
        ${order.ekspedisi ? `
          <div>
            <p class="text-xs text-charcoal-400">Ekspedisi</p>
            <p class="font-medium">${escapeHtml(order.ekspedisi)}</p>
          </div>
        ` : ''}
        ${order.nomor_resi ? `
          <div>
            <p class="text-xs text-charcoal-400">No. Resi</p>
            <p class="font-medium font-mono">${escapeHtml(order.nomor_resi)}</p>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Item pesanan -->
    <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-6 shadow-card">
      <h2 class="font-semibold text-sm mb-4">Item Pesanan</h2>
      <div class="space-y-3 mb-4">
        ${(order.items || []).map(i => `
          <div class="flex justify-between items-start gap-3 text-sm">
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">${escapeHtml(i.nama_produk)}</p>
              <p class="text-xs text-charcoal-400">${i.qty} × ${formatRupiah(i.harga_satuan)}</p>
            </div>
            <p class="font-medium flex-shrink-0">${formatRupiah(i.subtotal)}</p>
          </div>
        `).join('')}
      </div>
      <div class="border-t border-charcoal-100 dark:border-charcoal-800 pt-3 space-y-1.5 text-sm">
        <div class="flex justify-between"><span class="text-charcoal-400">Subtotal</span><span>${formatRupiah(order.subtotal)}</span></div>
        <div class="flex justify-between"><span class="text-charcoal-400">Ongkir (${escapeHtml(order.ekspedisi || 'Manual')})</span><span>${formatRupiah(order.ongkir)}</span></div>
        <div class="flex justify-between font-semibold text-base pt-1">
          <span>Total</span>
          <span class="text-wood-700 dark:text-wood-400">${formatRupiah(order.total)}</span>
        </div>
      </div>
    </div>

    <!-- Pembayaran -->
    ${renderSeksiPembayaran(order, payment)}

    <!-- Aksi -->
    <div class="flex flex-wrap gap-3">
      <button id="btn-wa-tanya"
        class="flex-1 py-3 rounded-xl border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-900/20 transition flex items-center justify-center gap-2">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.083.528 4.04 1.465 5.743L.036 23.5l5.875-1.406A11.942 11.942 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.032-1.38l-.36-.214-3.735.89.942-3.617-.235-.37A9.773 9.773 0 012.182 12C2.182 6.578 6.578 2.182 12 2.182S21.818 6.578 21.818 12 17.422 21.818 12 21.818z"/>
        </svg>
        Tanya via WhatsApp
      </button>
      <a href="/produk.html"
        class="flex-1 py-3 rounded-xl border border-charcoal-200 dark:border-charcoal-700 text-charcoal-600 dark:text-charcoal-300 text-sm font-medium hover:bg-charcoal-50 dark:hover:bg-charcoal-800 transition text-center">
        Lanjut Belanja
      </a>
    </div>
  `

  // Bind tombol WA
  document.getElementById('btn-wa-tanya')?.addEventListener('click', () => {
    const wa = settings.nomor_wa
    if (!wa) { toast('Nomor WhatsApp belum dikonfigurasi', 'error'); return }
    waKonteksInvoice(wa, order.invoice_number)
  })

  // Bind upload bukti jika ada
  if (order.status === 'menunggu_pembayaran' && payment) {
    document.getElementById('btn-upload-bukti')?.addEventListener('click', () =>
      document.getElementById('input-bukti').click()
    )
    document.getElementById('input-bukti')?.addEventListener('change', e =>
      handleUploadBukti(e.target.files[0], payment.id)
    )
  }

  // Copy rekening
  document.getElementById('btn-copy-rek')?.addEventListener('click', () => {
    copyToClipboard(settings.bank_rekening || '')
  })
}

function renderSeksiPembayaran(order, payment) {
  if (!payment) return ''

  if (order.status === 'menunggu_pembayaran') {
    const metode = payment.metode
    return `
      <div class="bg-white dark:bg-charcoal-900 rounded-2xl p-6 shadow-card">
        <h2 class="font-semibold text-sm mb-4">Instruksi Pembayaran</h2>
        ${metode === 'transfer_bank' ? `
          <div class="bg-charcoal-50 dark:bg-charcoal-800 rounded-xl p-4 mb-4">
            <p class="text-xs text-charcoal-400 mb-1">Transfer ke</p>
            <p class="font-semibold">${escapeHtml(settings.bank_nama || '-')}</p>
            <div class="flex items-center gap-2 mt-1">
              <p class="font-mono text-lg font-bold">${escapeHtml(settings.bank_rekening || '-')}</p>
              <button id="btn-copy-rek"
                class="text-xs text-wood-600 hover:text-wood-700 flex items-center gap-1 border border-wood-300 dark:border-wood-700 px-2 py-1 rounded-lg">
                Salin
              </button>
            </div>
            <p class="text-sm text-charcoal-500 mt-1">a.n. ${escapeHtml(settings.bank_atas_nama || '-')}</p>
          </div>
          <div class="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400 mb-4">
            Transfer tepat <strong>${formatRupiah(order.total)}</strong> agar verifikasi cepat.
          </div>
        ` : `
          <div class="flex justify-center mb-4">
            ${settings.qris_url
              ? `<img src="${escapeHtml(settings.qris_url)}" alt="QRIS" class="w-48 h-48 object-contain rounded-xl border border-charcoal-200 dark:border-charcoal-700">`
              : `<p class="text-sm text-charcoal-400">QRIS belum dikonfigurasi</p>`
            }
          </div>
        `}
        <p class="text-xs text-charcoal-400 mb-3">Setelah transfer, upload bukti pembayaran di bawah ini.</p>
        <input id="input-bukti" type="file" accept="image/*" class="hidden">
        <button id="btn-upload-bukti"
          class="w-full py-3 rounded-xl bg-wood-600 hover:bg-wood-700 text-white text-sm font-semibold transition flex items-center justify-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
          </svg>
          Upload Bukti Transfer
        </button>
      </div>
    `
  }

  if (order.status === 'menunggu_verifikasi') {
    return `
      <div class="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-2xl p-5 text-center">
        <p class="text-2xl mb-2">⏳</p>
        <p class="font-medium text-blue-700 dark:text-blue-400">Bukti transfer sedang diverifikasi</p>
        <p class="text-xs text-blue-600 dark:text-blue-500 mt-1">Admin akan memverifikasi dalam 1×24 jam</p>
      </div>
    `
  }

  if (order.status === 'lunas') {
    return `
      <div class="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-2xl p-5 text-center">
        <p class="text-2xl mb-2">✅</p>
        <p class="font-medium text-green-700 dark:text-green-400">Pembayaran Lunas</p>
        <p class="text-xs text-green-600 dark:text-green-500 mt-1">Pesanan Anda sedang diproses</p>
      </div>
    `
  }

  if (order.status === 'ditolak') {
    return `
      <div class="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-2xl p-5 text-center">
        <p class="text-2xl mb-2">❌</p>
        <p class="font-medium text-red-700 dark:text-red-400">Pembayaran Ditolak</p>
        ${payment?.catatan_admin ? `<p class="text-xs text-red-600 dark:text-red-500 mt-1">${escapeHtml(payment.catatan_admin)}</p>` : ''}
        <p class="text-xs text-charcoal-400 mt-2">Hubungi admin via WhatsApp untuk informasi lebih lanjut</p>
      </div>
    `
  }

  return ''
}

// ── Upload Bukti Transfer ──────────────────────────────────

async function handleUploadBukti(file, paymentId) {
  if (!file) return

  const MAX_MB = 5
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`Ukuran file maksimal ${MAX_MB} MB`, 'error'); return
  }
  if (!file.type.startsWith('image/')) {
    toast('File harus berupa gambar', 'error'); return
  }

  const btn = document.getElementById('btn-upload-bukti')
  btn.disabled = true
  btn.textContent = 'Mengunggah...'

  try {
    const fileName = generateFileName(file.name, 'bukti')
    const url      = await uploadBuktiTransfer(file, fileName)
    await submitBuktiTransfer(paymentId, url, currentOrder.total)
    toast('Bukti transfer berhasil dikirim!', 'success')
    // Reload order
    await cariPesanan(currentOrder.invoice_number)
  } catch (e) {
    toast('Gagal upload: ' + (e.message || 'Coba lagi'), 'error')
    btn.disabled = false
    btn.textContent = 'Upload Bukti Transfer'
  }
}

// ── Realtime status pesanan ────────────────────────────────

let realtimeChannel = null

function subscribeRealtime(orderId) {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel)
  realtimeChannel = supabase
    .channel(`order-${orderId}`)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'orders',
      filter: `id=eq.${orderId}`
    }, payload => {
      if (payload.new?.status && payload.new.status !== currentOrder.status) {
        toast('Status pesanan diperbarui: ' + (STATUS_LABEL[payload.new.status]?.label || payload.new.status), 'info')
        cariPesanan(currentOrder.invoice_number)
      }
    })
    .subscribe()
}

// ── Helper progress bar ────────────────────────────────────

function getProgressWidth(status) {
  const map = {
    menunggu_pembayaran:  10,
    menunggu_verifikasi:  30,
    lunas:                55,
    dikirim:              80,
    selesai:              100,
    ditolak:              30,
    dibatalkan:           10
  }
  return map[status] || 0
}

function isStepDone(status, idx) {
  const order = ['menunggu_pembayaran','menunggu_verifikasi','lunas','dikirim','selesai']
  const cur   = order.indexOf(status)
  return cur >= idx
}
