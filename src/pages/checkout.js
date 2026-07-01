// src/pages/checkout.js
import { getShippingByKota, createOrder, createPayment, getSettings } from '@/lib/api.js'
import {
  getCart, clearCart, cartTotal, formatRupiah,
  validateWA, normalizeWA, escapeHtml, toast, initDarkMode, debounce
} from '@/lib/utils.js'

initDarkMode()

let cart       = []
let settings   = {}
let ongkirDipilih = null   // { id, ekspedisi, harga, estimasi_durasi }
let subtotal   = 0

// ── Init ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  cart     = getCart()
  settings = await getSettings().catch(() => ({}))

  if (!cart.length) {
    document.getElementById('empty-cart').classList.remove('hidden')
    document.getElementById('sec-pembeli').classList.add('hidden')
    document.getElementById('sec-alamat').classList.add('hidden')
    document.getElementById('sec-bayar').classList.add('hidden')
    document.getElementById('btn-pesan').classList.add('hidden')
    return
  }

  subtotal = cartTotal()
  renderSummary()

  document.getElementById('btn-cek-ongkir').addEventListener('click', cekOngkir)
  document.getElementById('kota').addEventListener('input', debounce(cekOngkir, 600))
  document.getElementById('btn-pesan').addEventListener('click', handleCheckout)
})

// ── Render ringkasan ───────────────────────────────────────

function renderSummary() {
  const container = document.getElementById('summary-items')
  container.innerHTML = cart.map(i => `
    <div class="flex gap-3 items-start">
      <div class="w-12 h-12 rounded-xl overflow-hidden bg-charcoal-100 dark:bg-charcoal-700 flex-shrink-0">
        ${i.foto
          ? `<img src="${escapeHtml(i.foto)}" alt="${escapeHtml(i.nama)}" class="w-full h-full object-cover">`
          : `<div class="w-full h-full flex items-center justify-center text-xl">🛋️</div>`}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium leading-snug truncate">${escapeHtml(i.nama)}</p>
        <p class="text-xs text-charcoal-400">${i.qty} × ${formatRupiah(i.harga)}</p>
      </div>
      <p class="text-xs font-semibold flex-shrink-0">${formatRupiah(i.harga * i.qty)}</p>
    </div>
  `).join('')

  updateTotals()
}

function updateTotals() {
  const ongkir = ongkirDipilih?.harga || 0
  document.getElementById('sum-subtotal').textContent = formatRupiah(subtotal)
  document.getElementById('sum-ongkir').textContent   = ongkirDipilih
    ? formatRupiah(ongkir) : 'Belum dipilih'
  document.getElementById('sum-ongkir').className = ongkirDipilih
    ? 'font-medium' : 'text-charcoal-400'
  document.getElementById('sum-total').textContent = formatRupiah(subtotal + ongkir)
}

// ── Cek Ongkir ─────────────────────────────────────────────

async function cekOngkir() {
  const kota = document.getElementById('kota').value.trim()
  const container = document.getElementById('ongkir-result')

  if (!kota) {
    container.innerHTML = `<p class="text-xs text-charcoal-400">Isi kota tujuan lalu klik "Cek ongkir"</p>`
    return
  }

  container.innerHTML = `<p class="text-xs text-charcoal-400 animate-pulse">Mencari tarif ongkir...</p>`
  ongkirDipilih = null
  updateTotals()

  try {
    const rates = await getShippingByKota(kota)

    if (!rates.length) {
      container.innerHTML = `
        <div class="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-xs text-amber-700 dark:text-amber-400">
          <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span>Kota "<strong>${escapeHtml(kota)}</strong>" belum terdaftar. Pilih <strong>Ongkir Manual</strong> — admin akan mengkonfirmasi biaya via WhatsApp.</span>
        </div>
        <label class="mt-3 flex items-center gap-3 p-3 border border-amber-300 dark:border-amber-700 rounded-xl cursor-pointer bg-amber-50/50 dark:bg-amber-900/10">
          <input type="radio" name="rate_id" value="manual" class="text-wood-600" checked>
          <div>
            <p class="text-sm font-medium">Ongkir Manual</p>
            <p class="text-xs text-charcoal-400">Biaya dikonfirmasi admin via WhatsApp</p>
          </div>
          <span class="ml-auto text-sm font-medium">TBD</span>
        </label>
      `
      // Set ongkir manual
      ongkirDipilih = { id: null, ekspedisi: 'Manual', harga: 0, estimasi_durasi: 'Dikonfirmasi admin' }
      document.querySelector('input[name="rate_id"][value="manual"]')?.addEventListener('change', () => {
        ongkirDipilih = { id: null, ekspedisi: 'Manual', harga: 0, estimasi_durasi: 'Dikonfirmasi admin' }
        updateTotals()
      })
      updateTotals()
      return
    }

    container.innerHTML = `
      <div class="space-y-2">
        ${rates.map((r, idx) => `
          <label class="flex items-center gap-3 p-3 border border-charcoal-200 dark:border-charcoal-700 rounded-xl cursor-pointer hover:border-wood-400 transition has-[:checked]:border-wood-500 has-[:checked]:bg-wood-50 dark:has-[:checked]:bg-wood-900/20">
            <input type="radio" name="rate_id" value="${r.id}" class="text-wood-600" ${idx === 0 ? 'checked' : ''}
              data-harga="${r.harga}" data-ekspedisi="${escapeHtml(r.ekspedisi)}" data-durasi="${escapeHtml(r.estimasi_durasi || '')}">
            <div class="flex-1">
              <p class="text-sm font-medium">${escapeHtml(r.ekspedisi)}</p>
              ${r.estimasi_durasi ? `<p class="text-xs text-charcoal-400">${escapeHtml(r.estimasi_durasi)}</p>` : ''}
            </div>
            <p class="text-sm font-semibold text-wood-700 dark:text-wood-400">${formatRupiah(r.harga)}</p>
          </label>
        `).join('')}
        <label class="flex items-center gap-3 p-3 border border-charcoal-200 dark:border-charcoal-700 rounded-xl cursor-pointer hover:border-wood-400 transition has-[:checked]:border-wood-500 has-[:checked]:bg-wood-50 dark:has-[:checked]:bg-wood-900/20">
          <input type="radio" name="rate_id" value="manual" class="text-wood-600">
          <div class="flex-1">
            <p class="text-sm font-medium">Ongkir Manual</p>
            <p class="text-xs text-charcoal-400">Biaya dikonfirmasi admin via WhatsApp</p>
          </div>
          <span class="text-xs text-charcoal-400 ml-auto">TBD</span>
        </label>
      </div>
    `

    // Set default pilihan pertama
    const first = rates[0]
    ongkirDipilih = { id: first.id, ekspedisi: first.ekspedisi, harga: first.harga, estimasi_durasi: first.estimasi_durasi }
    updateTotals()

    // Listen perubahan pilihan
    container.querySelectorAll('input[name="rate_id"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.value === 'manual') {
          ongkirDipilih = { id: null, ekspedisi: 'Manual', harga: 0, estimasi_durasi: 'Dikonfirmasi admin' }
        } else {
          ongkirDipilih = {
            id:             radio.value,
            ekspedisi:      radio.dataset.ekspedisi,
            harga:          parseFloat(radio.dataset.harga),
            estimasi_durasi: radio.dataset.durasi
          }
        }
        updateTotals()
      })
    })

  } catch (e) {
    container.innerHTML = `<p class="text-xs text-red-500">Gagal memuat tarif ongkir. Coba lagi.</p>`
    console.error(e)
  }
}

// ── Validasi form ──────────────────────────────────────────

function getFormData() {
  return {
    nama:      document.getElementById('nama').value.trim(),
    nomor_wa:  document.getElementById('nomor_wa').value.trim(),
    email:     document.getElementById('email').value.trim(),
    provinsi:  document.getElementById('provinsi').value.trim(),
    kota:      document.getElementById('kota').value.trim(),
    kecamatan: document.getElementById('kecamatan').value.trim(),
    kelurahan: document.getElementById('kelurahan').value.trim(),
    kode_pos:  document.getElementById('kode_pos').value.trim(),
    alamat:    document.getElementById('alamat').value.trim(),
    catatan:   document.getElementById('catatan').value.trim(),
    metode_bayar: document.querySelector('input[name="metode_bayar"]:checked')?.value || 'transfer_bank'
  }
}

function validateForm(f) {
  const errors = []
  if (!f.nama)     errors.push('Nama lengkap wajib diisi')
  if (!f.nomor_wa) errors.push('Nomor WhatsApp wajib diisi')
  else if (!validateWA(f.nomor_wa)) errors.push('Format nomor WhatsApp tidak valid (contoh: 08123456789)')
  if (!f.provinsi) errors.push('Provinsi wajib diisi')
  if (!f.kota)     errors.push('Kota/kabupaten wajib diisi')
  if (!f.alamat)   errors.push('Alamat lengkap wajib diisi')
  if (!ongkirDipilih) errors.push('Pilih metode pengiriman terlebih dahulu')
  return errors
}

// ── Submit checkout ────────────────────────────────────────

async function handleCheckout() {
  const f = getFormData()
  const errors = validateForm(f)

  if (errors.length) {
    toast(errors[0], 'error')
    return
  }

  const btnLabel   = document.getElementById('btn-pesan-label')
  const btnSpinner = document.getElementById('btn-pesan-spinner')
  const btn        = document.getElementById('btn-pesan')
  btn.disabled     = true
  btnLabel.textContent = 'Memproses...'
  btnSpinner.classList.remove('hidden')

  try {
    const ongkir  = ongkirDipilih.harga
    const total   = subtotal + ongkir
    const wa      = normalizeWA(f.nomor_wa)

    // Buat order (trigger PostgreSQL generate invoice_number)
    const order = await createOrder({
      nama_pembeli:      f.nama,
      nomor_wa:          wa,
      email:             f.email || null,
      alamat:            f.alamat,
      provinsi:          f.provinsi,
      kota:              f.kota,
      kecamatan:         f.kecamatan || null,
      kelurahan:         f.kelurahan || null,
      kode_pos:          f.kode_pos || null,
      catatan:           f.catatan || null,
      shipping_rate_id:  ongkirDipilih.id || null,
      metode_pengiriman: ongkirDipilih.id ? 'ekspedisi' : 'manual',
      ekspedisi:         ongkirDipilih.ekspedisi,
      ongkir:            ongkir,
      subtotal:          subtotal,
      diskon_voucher:    0,
      total:             total,
      status:            'menunggu_pembayaran'
    }, cart)

    // Buat record pembayaran
    await createPayment(order.id, f.metode_bayar)

    // Kosongkan keranjang
    clearCart()

    // Redirect ke halaman status pesanan
    window.location.href = `/status.html?invoice=${order.invoice_number}`

  } catch (e) {
    console.error('Checkout error:', e)
    toast('Gagal membuat pesanan: ' + (e.message || 'Coba lagi'), 'error')
    btn.disabled = false
    btnLabel.textContent = 'Buat Pesanan'
    btnSpinner.classList.add('hidden')
  }
}
