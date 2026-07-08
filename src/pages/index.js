// src/pages/index.js
// Script utama halaman beranda

import {
  getCategories, getProducts, getTestimonials,
  getSettings, getFaqs, getProdukTerlaris, logProductView
} from '@/lib/api.js'
import {
  formatRupiah, toast, initDarkMode, toggleDarkMode,
  getCart, cartCount, cartTotal, addToCart,
  updateCartQty, removeFromCart,
  buatLinkWA, waKonteksProduk, escapeHtml, getSessionId
} from '@/lib/utils.js'
import { cariJawaban, getQuickReplies, pesanSambutan, linkWAEskalasi } from '@/lib/chatbot.js'
import { supabase } from '@/lib/supabase.js'

// ── Inisialisasi ───────────────────────────────────────────

let settings = {}
let lastChatbotInput = ''

initDarkMode()

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings()
  renderNavbarScroll()
  renderDarkModeBtn()
  renderCartBtn()
  renderFooter()

  // Load konten paralel
  await Promise.all([
    loadBanner(),
    loadKategori(),
    loadProdukTerbaru(),
    loadProdukTerlaris(),
    loadTestimoni()
  ])

  initChatbot()
  initCart()
  initOnlineVisitors()
  document.getElementById('footer-year').textContent = new Date().getFullYear()
})

// ── Pengunjung Online (Supabase Realtime Presence) ──────────
// Tidak menyentuh tabel apapun — murni presence channel sementara,
// gratis dan otomatis hilang saat tab ditutup.

function initOnlineVisitors() {
  const badge = document.getElementById('online-visitors-badge')
  const countEl = document.getElementById('online-visitors-count')

  const channel = supabase.channel('online_visitors', {
    config: { presence: { key: getSessionId() } }
  })

  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const jumlah = Math.max(Object.keys(state).length, 1)
      countEl.textContent = jumlah
      badge.classList.remove('hidden')
      badge.classList.add('flex')
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ online_at: new Date().toISOString() })
      }
    })
}

// ── Settings ───────────────────────────────────────────────

async function loadSettings() {
  try {
    settings = await getSettings()
    // Kontak
    document.getElementById('info-alamat').textContent  = settings.alamat        || 'Alamat belum diisi'
    document.getElementById('info-jam').textContent     = settings.jam_operasional || '-'
    document.getElementById('footer-tagline').textContent = settings.tagline || ''

    const wa = settings.nomor_wa || ''
    if (wa) {
      const el = document.getElementById('info-wa')
      el.textContent = '+' + wa
      el.href = buatLinkWA(wa, 'Halo, saya ingin bertanya tentang produk Anda.')

      document.getElementById('promo-wa').href =
        buatLinkWA(wa, 'Halo, saya ingin konsultasi desain interior gratis.')
    }

    // Maps
    if (settings.maps_embed) {
      document.getElementById('maps-container').innerHTML =
        `<iframe src="${escapeHtml(settings.maps_embed)}" width="100%" height="100%"
          style="border:0" allowfullscreen loading="lazy" title="Lokasi toko"></iframe>`
    }

    // Sosmed footer
    const sosmedContainer = document.getElementById('footer-sosmed')
    const links = [
      { key: 'instagram', icon: 'IG', url: v => `https://instagram.com/${v}` },
      { key: 'facebook',  icon: 'FB', url: v => v.startsWith('http') ? v : `https://facebook.com/${v}` },
      { key: 'tiktok',    icon: 'TT', url: v => `https://tiktok.com/@${v}` }
    ]
    sosmedContainer.innerHTML = links
      .filter(l => settings[l.key])
      .map(l => `<a href="${escapeHtml(l.url(settings[l.key]))}" target="_blank" rel="noopener"
        class="w-8 h-8 bg-charcoal-800 hover:bg-wood-600 text-charcoal-300 hover:text-white rounded-lg flex items-center justify-center text-xs font-bold transition">${l.icon}</a>`)
      .join('')

    renderPromoSection()
    renderMemberSection()

  } catch (e) {
    console.error('Gagal load settings:', e)
  }
}

// ── Promo / Flash Sale (dikontrol dari admin → Pengaturan) ──

function renderPromoSection() {
  if (settings.promo_aktif !== 'true' || !settings.promo_judul) return

  const section = document.getElementById('promo-section')
  document.getElementById('promo-judul').textContent = settings.promo_judul
  document.getElementById('promo-teks').textContent  = settings.promo_teks || ''
  document.getElementById('promo-cta').href = settings.promo_link || '/produk.html'

  if (settings.promo_berakhir) {
    const berakhir = mulaiCountdownPromo(settings.promo_berakhir)
    if (!berakhir) return // waktu sudah lewat, jangan tampilkan promo basi
  }

  section.classList.remove('hidden')
}

function mulaiCountdownPromo(targetIso) {
  const el     = document.getElementById('promo-countdown')
  const target = new Date(targetIso).getTime()
  if (isNaN(target) || target <= Date.now()) return false

  const unit = [
    ['d', 86400000, 'Hari'],
    ['h', 3600000,  'Jam'],
    ['m', 60000,    'Menit'],
    ['s', 1000,     'Detik']
  ]

  const tick = () => {
    let sisa = target - Date.now()
    if (sisa <= 0) {
      el.innerHTML = `<p class="text-white text-sm font-medium">Promo telah berakhir</p>`
      document.getElementById('promo-section').classList.add('hidden')
      clearInterval(timer)
      return
    }
    el.innerHTML = unit.map(([key, ms, label]) => {
      const val = Math.floor(sisa / ms)
      sisa -= val * ms
      return `
        <div class="bg-white/15 rounded-xl px-3 py-2 min-w-[52px] text-center">
          <p class="text-lg sm:text-xl font-bold text-white leading-none">${String(val).padStart(2, '0')}</p>
          <p class="text-[9px] uppercase tracking-wide text-wood-100 mt-1">${label}</p>
        </div>`
    }).join('')
  }

  tick()
  const timer = setInterval(tick, 1000)
  return true
}

// ── Member (dikontrol dari admin → Pengaturan) ───────────────

function renderMemberSection() {
  if (settings.member_aktif !== 'true') return

  const benefits = [1, 2, 3, 4]
    .map(n => settings['member_benefit_' + n])
    .filter(Boolean)

  if (!benefits.length) return

  benefits.forEach((teks, i) => {
    const el = document.getElementById('member-benefit-' + (i + 1))
    if (el) el.textContent = teks
  })
  // Sembunyikan kartu manfaat yang tidak diisi admin
  for (let n = benefits.length + 1; n <= 4; n++) {
    document.getElementById('member-benefit-' + n)?.closest('div.p-5')?.classList.add('hidden')
  }

  const syaratTransaksi = settings.member_syarat_transaksi || '5'
  const syaratProduk    = settings.member_syarat_produk || '5'
  const diskonPersen    = settings.member_diskon_persen || '10'
  document.getElementById('member-syarat').textContent =
    `Diskon ${diskonPersen}% otomatis setelah ${syaratTransaksi}x transaksi atau membeli ${syaratProduk} jenis produk berbeda`

  document.getElementById('member-section').classList.remove('hidden')
}

// ── Navbar scroll ──────────────────────────────────────────

function renderNavbarScroll() {
  const navbar = document.getElementById('navbar')
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      navbar.classList.add('bg-white/95', 'dark:bg-charcoal-950/95', 'backdrop-blur-md', 'shadow-card')
    } else {
      navbar.classList.remove('bg-white/95', 'dark:bg-charcoal-950/95', 'backdrop-blur-md', 'shadow-card')
    }
  }, { passive: true })

  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('mobile-menu').classList.toggle('hidden')
  })
}

// ── Dark mode ──────────────────────────────────────────────

function renderDarkModeBtn() {
  document.getElementById('btn-darkmode').addEventListener('click', toggleDarkMode)
}

// ── Banner Slider ──────────────────────────────────────────

async function loadBanner() {
  // Banner statis dulu; admin bisa set via store_settings
  const slides = [
    {
      bg: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1600&q=80',
      judul: 'Koleksi Sofa Minimalis', sub: 'Kenyamanan dan estetika dalam satu desain'
    },
    {
      bg: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1600&q=80',
      judul: 'Meja Makan Kayu Jati', sub: 'Elegan, kuat, dan tahan lama untuk keluarga Anda'
    },
    {
      bg: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=1600&q=80',
      judul: 'Lemari Minimalis Modern', sub: 'Maksimalkan ruang dengan desain cerdas'
    }
  ]

  const track = document.getElementById('banner-track')
  const dots  = document.getElementById('banner-dots')
  let current = 0

  track.innerHTML = slides.map((s, i) => `
    <div class="min-w-full h-full relative" aria-hidden="${i !== 0}">
      <img src="${s.bg}" alt="${escapeHtml(s.judul)}" loading="${i === 0 ? 'eager' : 'lazy'}"
        class="absolute inset-0 w-full h-full object-cover">
    </div>
  `).join('')

  dots.innerHTML = slides.map((_, i) => `
    <button class="w-2 h-2 rounded-full transition ${i === 0 ? 'bg-white w-5' : 'bg-white/40'}"
      aria-label="Slide ${i + 1}" data-idx="${i}"></button>
  `).join('')

  dots.querySelectorAll('button').forEach(btn =>
    btn.addEventListener('click', () => goTo(+btn.dataset.idx))
  )

  const goTo = (idx) => {
    current = idx
    track.style.transform = `translateX(-${idx * 100}%)`
    dots.querySelectorAll('button').forEach((b, i) => {
      b.className = `transition rounded-full ${i === idx ? 'bg-white w-5 h-2' : 'bg-white/40 w-2 h-2'}`
    })
    // Update hero text
    document.getElementById('hero-title').textContent = slides[idx].judul
    document.getElementById('hero-sub').textContent   = slides[idx].sub
  }

  // Auto play
  setInterval(() => goTo((current + 1) % slides.length), 5000)
}

// ── Kategori ───────────────────────────────────────────────

async function loadKategori() {
  const container = document.getElementById('kategori-grid')
  try {
    const data = await getCategories()
    container.innerHTML = data.map(k => `
      <a href="/produk.html?kategori=${k.slug}"
        class="flex flex-col items-center gap-2 p-4 bg-charcoal-50 dark:bg-charcoal-800 rounded-2xl hover:bg-wood-50 dark:hover:bg-wood-900/20 hover:shadow-card transition group">
        <div class="w-12 h-12 bg-wood-100 dark:bg-wood-900/40 rounded-xl flex items-center justify-center group-hover:bg-wood-200 transition text-wood-600 text-xl">
          ${k.icon || '🪑'}
        </div>
        <p class="text-xs font-medium text-center leading-tight">${escapeHtml(k.nama)}</p>
      </a>
    `).join('')
  } catch (e) {
    container.innerHTML = `<p class="col-span-full text-center text-sm text-charcoal-400">Gagal memuat kategori</p>`
  }
}

// ── Card Produk (shared) ───────────────────────────────────

function renderProductCard(p) {
  const foto   = p.images?.find(i => i.is_primary)?.url_watermarked || p.images?.[0]?.url_watermarked || ''
  const diskon = p.diskon > 0
  return `
    <article class="bg-white dark:bg-charcoal-800 rounded-2xl shadow-card hover:shadow-card-hover transition group overflow-hidden">
      <a href="/produk/${p.slug}" class="block relative aspect-[4/3] overflow-hidden bg-charcoal-100 dark:bg-charcoal-700">
        ${foto
          ? `<img src="${escapeHtml(foto)}" alt="${escapeHtml(p.nama)}" loading="lazy"
               class="w-full h-full object-cover group-hover:scale-105 transition duration-500">`
          : `<div class="w-full h-full flex items-center justify-center text-charcoal-300 text-4xl">🛋️</div>`
        }
        ${p.status === 'pre_order'
          ? `<span class="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">PRE-ORDER</span>`
          : p.status === 'habis'
          ? `<span class="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">HABIS</span>`
          : ''}
        ${diskon
          ? `<span class="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">-${p.diskon}%</span>`
          : ''}
      </a>
      <div class="p-4">
        <p class="text-xs text-charcoal-400 mb-1">${escapeHtml(p.category?.nama || '')}</p>
        <h3 class="text-sm font-medium leading-snug mb-2 line-clamp-2">${escapeHtml(p.nama)}</h3>
        <div class="flex items-end gap-2 mb-3">
          <p class="font-semibold text-wood-700 dark:text-wood-400">${formatRupiah(p.harga_jual)}</p>
          ${diskon ? `<p class="text-xs text-charcoal-400 line-through">${formatRupiah(p.harga)}</p>` : ''}
        </div>
        <button
          class="btn-add-cart w-full py-2 rounded-xl text-xs font-semibold bg-charcoal-900 hover:bg-wood-600 text-white transition"
          data-id="${p.id}"
          data-nama="${escapeHtml(p.nama)}"
          data-kode="${escapeHtml(p.kode_produk)}"
          data-harga="${p.harga_jual}"
          data-foto="${escapeHtml(foto)}"
          ${p.status === 'habis' ? 'disabled' : ''}>
          ${p.status === 'habis' ? 'Stok Habis' : '+ Keranjang'}
        </button>
      </div>
    </article>
  `
}

async function loadProdukTerbaru() {
  const container = document.getElementById('produk-terbaru-grid')
  container.innerHTML = Array(4).fill(
    `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 rounded-2xl h-72"></div>`
  ).join('')
  try {
    const { data } = await getProducts({ perPage: 8, sort: 'created_at', order: 'desc' })
    container.innerHTML = data.map(renderProductCard).join('')
    container.querySelectorAll('.btn-add-cart').forEach(bindAddToCart)
  } catch (e) {
    container.innerHTML = `<p class="col-span-full text-center text-sm text-charcoal-400">Gagal memuat produk</p>`
  }
}

async function loadProdukTerlaris() {
  const container = document.getElementById('produk-terlaris-grid')
  container.innerHTML = Array(4).fill(
    `<div class="animate-skeleton bg-charcoal-100 dark:bg-charcoal-800 rounded-2xl h-72"></div>`
  ).join('')
  try {
    const terlaris = await getProdukTerlaris()
    // Ambil detail produk penuh berdasarkan ID dari view
    if (!terlaris.length) { container.innerHTML = '<p class="col-span-full text-center text-sm text-charcoal-400">Belum ada data</p>'; return }
    const ids = terlaris.slice(0, 4).map(p => p.id)
    const { data } = await getProducts({ perPage: 4, sort: 'order_count', order: 'desc' })
    container.innerHTML = data.map(renderProductCard).join('')
    container.querySelectorAll('.btn-add-cart').forEach(bindAddToCart)
  } catch (e) {
    container.innerHTML = `<p class="col-span-full text-center text-sm text-charcoal-400">Gagal memuat produk</p>`
  }
}

function bindAddToCart(btn) {
  btn.addEventListener('click', () => {
    addToCart({
      id:          btn.dataset.id,
      nama:        btn.dataset.nama,
      kode_produk: btn.dataset.kode,
      harga_jual:  parseFloat(btn.dataset.harga),
      foto_url:    btn.dataset.foto
    })
    renderCartBadge()
    openCartDrawer()
  })
}

// ── Testimoni ──────────────────────────────────────────────

async function loadTestimoni() {
  const container = document.getElementById('testimoni-grid')
  try {
    const data = await getTestimonials()
    if (!data.length) { container.innerHTML = '<p class="col-span-full text-center text-sm text-charcoal-400">Belum ada testimoni</p>'; return }
    container.innerHTML = data.map(t => `
      <div class="bg-white dark:bg-charcoal-800 rounded-2xl p-6 shadow-card">
        <div class="flex gap-1 mb-3">
          ${Array(t.rating).fill('<span class="text-amber-400 text-sm">★</span>').join('')}
          ${Array(5 - t.rating).fill('<span class="text-charcoal-200 dark:text-charcoal-600 text-sm">★</span>').join('')}
        </div>
        <p class="text-sm text-charcoal-600 dark:text-charcoal-300 leading-relaxed mb-4">"${escapeHtml(t.pesan)}"</p>
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-wood-100 dark:bg-wood-900/40 rounded-full flex items-center justify-center text-wood-600 font-semibold text-sm flex-shrink-0">
            ${escapeHtml(t.nama.charAt(0).toUpperCase())}
          </div>
          <div>
            <p class="text-sm font-medium">${escapeHtml(t.nama)}</p>
            ${t.kota ? `<p class="text-xs text-charcoal-400">${escapeHtml(t.kota)}</p>` : ''}
          </div>
        </div>
      </div>
    `).join('')
  } catch (e) {
    container.innerHTML = '<p class="col-span-full text-center text-sm text-charcoal-400">Gagal memuat testimoni</p>'
  }
}

// ── Cart ───────────────────────────────────────────────────

function renderCartBtn() {
  document.getElementById('btn-cart').addEventListener('click', e => {
    e.preventDefault()
    openCartDrawer()
  })
}

function renderCartBadge() {
  const badge = document.getElementById('cart-badge')
  const count = cartCount()
  badge.textContent = count
  badge.classList.toggle('hidden', count === 0)
}

function openCartDrawer() {
  renderCartDrawer()
  document.getElementById('cart-drawer').classList.remove('translate-x-full')
  document.getElementById('cart-overlay').classList.remove('hidden')
}

function closeCartDrawer() {
  document.getElementById('cart-drawer').classList.add('translate-x-full')
  document.getElementById('cart-overlay').classList.add('hidden')
}

function renderCartDrawer() {
  const items   = getCart()
  const total   = cartTotal()
  const container = document.getElementById('cart-items')

  if (!items.length) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-charcoal-400 py-12">
        <p class="text-4xl mb-3">🛒</p>
        <p class="text-sm">Keranjang masih kosong</p>
        <a href="/produk.html" class="mt-4 text-wood-600 hover:text-wood-700 text-sm font-medium">Mulai belanja</a>
      </div>
    `
  } else {
    container.innerHTML = items.map(i => `
      <div class="flex gap-3">
        <div class="w-16 h-16 rounded-xl overflow-hidden bg-charcoal-100 dark:bg-charcoal-700 flex-shrink-0">
          ${i.foto
            ? `<img src="${escapeHtml(i.foto)}" alt="${escapeHtml(i.nama)}" class="w-full h-full object-cover">`
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
            <button data-id="${i.product_id}"
              class="btn-remove ml-auto text-red-400 hover:text-red-600 transition" aria-label="Hapus">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `).join('')

    container.querySelectorAll('.btn-qty').forEach(b =>
      b.addEventListener('click', () => {
        const item  = items.find(i => i.product_id === b.dataset.id)
        if (item) { updateCartQty(b.dataset.id, item.qty + (+b.dataset.delta)); renderCartDrawer(); renderCartBadge() }
      })
    )
    container.querySelectorAll('.btn-remove').forEach(b =>
      b.addEventListener('click', () => {
        removeFromCart(b.dataset.id); renderCartDrawer(); renderCartBadge()
      })
    )
  }

  document.getElementById('cart-total').textContent = formatRupiah(total)
}

function initCart() {
  renderCartBadge()
  document.getElementById('btn-cart-close').addEventListener('click', closeCartDrawer)
  document.getElementById('cart-overlay').addEventListener('click', closeCartDrawer)
  window.addEventListener('cart-updated', () => { renderCartBadge(); if (!document.getElementById('cart-drawer').classList.contains('translate-x-full')) renderCartDrawer() })
}

// ── Chatbot ────────────────────────────────────────────────

function initChatbot() {
  const panel    = document.getElementById('chatbot-panel')
  const messages = document.getElementById('chatbot-messages')
  const input    = document.getElementById('chatbot-input')
  const quickR   = document.getElementById('chatbot-quickreply')
  let   opened   = false

  const appendMsg = (teks, from = 'bot') => {
    const el = document.createElement('div')
    el.className = from === 'bot'
      ? 'self-start max-w-[80%] bg-charcoal-100 dark:bg-charcoal-700 rounded-2xl rounded-tl-none px-3 py-2 text-sm'
      : 'self-end max-w-[80%] bg-wood-600 text-white rounded-2xl rounded-tr-none px-3 py-2 text-sm'
    el.style.alignSelf = from === 'user' ? 'flex-end' : 'flex-start'
    el.textContent = teks
    messages.appendChild(el)
    messages.scrollTop = messages.scrollHeight
  }

  const renderQuickReplies = async () => {
    const qr = await getQuickReplies(4)
    quickR.innerHTML = qr.map(q =>
      `<button class="qr-btn text-xs border border-wood-300 dark:border-wood-700 text-wood-700 dark:text-wood-400 px-3 py-1.5 rounded-xl hover:bg-wood-50 dark:hover:bg-wood-900/20 transition">
        ${escapeHtml(q)}
      </button>`
    ).join('')
    quickR.querySelectorAll('.qr-btn').forEach(b =>
      b.addEventListener('click', () => handleSend(b.textContent.trim()))
    )
  }

  const handleSend = async (teks) => {
    if (!teks.trim()) return
    lastChatbotInput = teks.trim()
    appendMsg(teks, 'user')
    input.value = ''
    quickR.innerHTML = ''

    // Typing indicator
    const typing = document.createElement('div')
    typing.className = 'text-xs text-charcoal-400 ml-1'
    typing.textContent = 'Mengetik...'
    messages.appendChild(typing)
    messages.scrollTop = messages.scrollHeight

    try {
      const { jawaban } = await cariJawaban(teks)
      typing.remove()
      if (jawaban) {
        appendMsg(jawaban, 'bot')
      } else {
        appendMsg('Maaf, saya belum bisa menjawab pertanyaan itu. Silakan lanjutkan via WhatsApp ya 😊', 'bot')
      }
    } catch {
      typing.remove()
      appendMsg('Terjadi kendala koneksi. Silakan hubungi kami via WhatsApp.', 'bot')
    }
  }

  document.getElementById('btn-chatbot-open').addEventListener('click', async () => {
    panel.classList.toggle('hidden')
    opened = !opened
    if (opened && !messages.children.length) {
      messages.style.display = 'flex'
      messages.style.flexDirection = 'column'
      appendMsg(pesanSambutan(), 'bot')
      await renderQuickReplies()
    }
  })

  document.getElementById('btn-chatbot-close').addEventListener('click', () => {
    panel.classList.add('hidden')
    opened = false
  })

  document.getElementById('btn-chatbot-send').addEventListener('click', () => handleSend(input.value))
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSend(input.value) })

  document.getElementById('btn-chatbot-wa').addEventListener('click', () => {
    const wa = settings.nomor_wa || import.meta.env.VITE_NOMOR_WA || ''
    if (!wa) { toast('Nomor WhatsApp belum dikonfigurasi', 'error'); return }
    window.open(linkWAEskalasi(wa, lastChatbotInput || 'Ingin bertanya tentang produk'), '_blank', 'noopener')
  })
}

// ── Footer ─────────────────────────────────────────────────

function renderFooter() {
  document.getElementById('footer-year').textContent = new Date().getFullYear()
}
