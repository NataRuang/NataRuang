// src/lib/api.js
// Layer abstraksi semua query Supabase.
// Komponen UI hanya panggil fungsi dari sini, tidak langsung query Supabase.

import { supabase } from './supabase.js'
import { paginate  } from './utils.js'

// ── Pengaturan Toko ────────────────────────────────────────

/** Ambil semua pengaturan sebagai objek key-value */
export async function getSettings() {
  const { data, error } = await supabase
    .from('store_settings')
    .select('key, value')
  if (error) throw error
  return Object.fromEntries(data.map(r => [r.key, r.value]))
}

/** Update satu pengaturan */
export async function updateSetting(key, value) {
  const { error } = await supabase
    .from('store_settings')
    .update({ value })
    .eq('key', key)
  if (error) throw error
}

// ── Kategori ───────────────────────────────────────────────

export async function getCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .is('deleted_at', null)
    .order('urutan')
  if (error) throw error
  return data
}

export async function upsertCategory(payload) {
  const { data, error } = await supabase
    .from('categories')
    .upsert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCategory(id) {
  const { error } = await supabase
    .from('categories')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Produk ─────────────────────────────────────────────────

const PRODUCT_SELECT = `
  id, kode_produk, nama, slug, deskripsi, spesifikasi,
  harga, diskon, harga_jual, stok, status,
  estimasi_produksi, estimasi_pengiriman, berat_kg,
  view_count, order_count, rating, rating_count, created_at,
  category:categories(id, nama, slug),
  images:product_images(id, url_watermarked, urutan, is_primary),
  videos:product_videos(id, url, judul, urutan)
`

export async function getProducts({ page = 1, perPage = 12, categoryId, status,
  minHarga, maxHarga, search, sort = 'created_at', order = 'desc' } = {}) {

  const { from, to } = paginate(page, perPage)
  let q = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .is('deleted_at', null)
    .range(from, to)

  if (categoryId) q = q.eq('category_id', categoryId)
  if (status)     q = q.eq('status', status)
  if (minHarga)   q = q.gte('harga_jual', minHarga)
  if (maxHarga)   q = q.lte('harga_jual', maxHarga)
  if (search)     q = q.ilike('nama', `%${search}%`)

  q = q.order(sort, { ascending: order === 'asc' })

  const { data, count, error } = await q
  if (error) throw error
  return { data, count, totalPages: Math.ceil(count / perPage) }
}

export async function getProductBySlug(slug) {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('slug', slug)
    .is('deleted_at', null)
    .single()
  if (error) throw error
  return data
}

export async function getProductById(id) {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (error) throw error
  return data
}

export async function upsertProduct(payload) {
  const { data, error } = await supabase
    .from('products')
    .upsert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteProduct(id) {
  const { error } = await supabase
    .from('products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Upload foto produk ke Supabase Storage ─────────────────

export async function uploadFotoProduk(blob, fileName) {
  const path = `produk/${fileName}`
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  return data.publicUrl
}

export async function insertProductImage(productId, urlWatermarked, isPrimary = false) {
  const { data, error } = await supabase
    .from('product_images')
    .insert({ product_id: productId, url_watermarked: urlWatermarked, is_primary: isPrimary })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteProductImage(id) {
  const { error } = await supabase.from('product_images').delete().eq('id', id)
  if (error) throw error
}

// ── Log Kunjungan Produk ───────────────────────────────────

export async function logProductView(productId, sessionId) {
  // Fire-and-forget — tidak perlu await, tidak boleh blokir UI
  supabase.from('product_views')
    .insert({ product_id: productId, session_id: sessionId })
    .then()
}

// ── Ongkos Kirim ───────────────────────────────────────────

export async function getShippingByKota(kota) {
  const { data, error } = await supabase
    .from('shipping_rates')
    .select('*')
    .ilike('kota', `%${kota}%`)
    .eq('aktif', true)
    .order('harga')
  if (error) throw error
  return data
}

export async function getAllShippingRates() {
  const { data, error } = await supabase
    .from('shipping_rates')
    .select('*')
    .order('provinsi').order('kota').order('harga')
  if (error) throw error
  return data
}

export async function upsertShippingRate(payload) {
  const { data, error } = await supabase
    .from('shipping_rates').upsert(payload).select().single()
  if (error) throw error
  return data
}

export async function deleteShippingRate(id) {
  const { error } = await supabase.from('shipping_rates').delete().eq('id', id)
  if (error) throw error
}

// ── Pesanan (Orders) ───────────────────────────────────────

export async function createOrder(orderPayload, items) {
  // Insert order dulu (trigger akan buat invoice_number)
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert(orderPayload)
    .select()
    .single()
  if (orderErr) throw orderErr

  // Insert semua item pesanan
  const itemRows = items.map(i => ({
    order_id:    order.id,
    product_id:  i.product_id,
    nama_produk: i.nama,
    kode_produk: i.kode_produk,
    harga_satuan:i.harga,
    diskon:      0,
    qty:         i.qty,
    subtotal:    i.harga * i.qty
  }))

  const { error: itemErr } = await supabase.from('order_items').insert(itemRows)
  if (itemErr) throw itemErr

  return order
}

export async function getOrderByInvoice(invoice) {
  const { data, error } = await supabase
    .from('orders')
    .select(`*, items:order_items(*, product:products(nama, kode_produk)),
              payment:payments(*)`)
    .eq('invoice_number', invoice)
    .is('deleted_at', null)
    .single()
  if (error) throw error
  return data
}

export async function getOrdersByWA(nomorWa) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, invoice_number, status, total, created_at')
    .eq('nomor_wa', nomorWa)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return data
}

export async function getOrders({ page = 1, perPage = 20, status, search } = {}) {
  const { from, to } = paginate(page, perPage)
  let q = supabase
    .from('orders')
    .select('*, items:order_items(qty)', { count: 'exact' })
    .is('deleted_at', null)
    .range(from, to)
    .order('created_at', { ascending: false })

  if (status) q = q.eq('status', status)
  if (search) q = q.or(`invoice_number.ilike.%${search}%,nama_pembeli.ilike.%${search}%,nomor_wa.ilike.%${search}%`)

  const { data, count, error } = await q
  if (error) throw error
  return { data, count, totalPages: Math.ceil(count / perPage) }
}

export async function updateOrderStatus(id, status, resi = null) {
  const payload = { status }
  if (resi) payload.nomor_resi = resi
  const { error } = await supabase.from('orders').update(payload).eq('id', id)
  if (error) throw error
}

// ── Pembayaran ─────────────────────────────────────────────

export async function createPayment(orderId, metode) {
  const { data, error } = await supabase
    .from('payments')
    .insert({ order_id: orderId, metode, status: 'pending' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function uploadBuktiTransfer(blob, fileName) {
  const path = `bukti/${fileName}`
  const { error } = await supabase.storage
    .from('payment-proofs')
    .upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('payment-proofs').getPublicUrl(path)
  return data.publicUrl
}

export async function submitBuktiTransfer(paymentId, buktiUrl, nominal) {
  const { error } = await supabase
    .from('payments')
    .update({
      bukti_transfer_url: buktiUrl,
      nominal_bayar:      nominal,
      status:             'menunggu_verifikasi'
    })
    .eq('id', paymentId)
  if (error) throw error

  // Update status order juga
  const { data: pay } = await supabase
    .from('payments').select('order_id').eq('id', paymentId).single()
  if (pay) {
    await supabase.from('orders')
      .update({ status: 'menunggu_verifikasi' })
      .eq('id', pay.order_id)
  }
}

export async function verifyPayment(paymentId, approve, catatan = '') {
  const { data: pay, error: fetchErr } = await supabase
    .from('payments').select('order_id').eq('id', paymentId).single()
  if (fetchErr) throw fetchErr

  const payStatus   = approve ? 'lunas' : 'ditolak'
  const orderStatus = approve ? 'lunas' : 'ditolak'

  const { error: payErr } = await supabase
    .from('payments')
    .update({ status: payStatus, catatan_admin: catatan, verified_at: new Date().toISOString() })
    .eq('id', paymentId)
  if (payErr) throw payErr

  const { error: orderErr } = await supabase
    .from('orders').update({ status: orderStatus }).eq('id', pay.order_id)
  if (orderErr) throw orderErr
}

/** Ambil pembayaran yang menunggu verifikasi admin (bukti transfer sudah diunggah) */
export async function getPaymentsPending() {
  const { data, error } = await supabase
    .from('payments')
    .select(`id, metode, status, nominal_bayar, bukti_transfer_url, created_at,
              order:orders(id, invoice_number, nama_pembeli, nomor_wa, total)`)
    .eq('status', 'menunggu_verifikasi')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// ── Chatbot FAQ ────────────────────────────────────────────

export async function getFaqs() {
  const { data, error } = await supabase
    .from('chatbot_faq')
    .select('*, tags:chatbot_tags(keyword)')
    .eq('aktif', true)
    .order('prioritas')
  if (error) throw error
  return data
}

export async function getFaqsAdmin() {
  const { data, error } = await supabase
    .from('chatbot_faq')
    .select('*, tags:chatbot_tags(keyword)')
    .order('prioritas')
  if (error) throw error
  return data
}

export async function upsertFaq(payload, tags = []) {
  const { data: faq, error } = await supabase
    .from('chatbot_faq').upsert(payload).select().single()
  if (error) throw error

  // Sync tags
  await supabase.from('chatbot_tags').delete().eq('faq_id', faq.id)
  if (tags.length) {
    await supabase.from('chatbot_tags').insert(
      tags.map(k => ({ faq_id: faq.id, keyword: k.trim().toLowerCase() }))
    )
  }
  return faq
}

export async function deleteFaq(id) {
  await supabase.from('chatbot_tags').delete().eq('faq_id', id)
  const { error } = await supabase.from('chatbot_faq').delete().eq('id', id)
  if (error) throw error
}

// ── Testimoni ──────────────────────────────────────────────

export async function getTestimonials() {
  const { data, error } = await supabase
    .from('testimonials')
    .select('*')
    .eq('tampil', true)
    .is('deleted_at', null)
    .order('urutan')
  if (error) throw error
  return data
}

export async function getTestimonialsAdmin() {
  const { data, error } = await supabase
    .from('testimonials')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function upsertTestimonial(payload) {
  const { data, error } = await supabase
    .from('testimonials').upsert(payload).select().single()
  if (error) throw error
  return data
}

export async function deleteTestimonial(id) {
  const { error } = await supabase
    .from('testimonials')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── Analitik / Dashboard ───────────────────────────────────

export async function getDashboardSummary() {
  const { data, error } = await supabase.from('v_dashboard_summary').select('*').single()
  if (error) throw error
  return data
}

export async function getProdukPalingDilihat() {
  const { data, error } = await supabase.from('v_produk_paling_dilihat').select('*')
  if (error) throw error
  return data
}

export async function getProdukTerlaris() {
  const { data, error } = await supabase.from('v_produk_terlaris').select('*')
  if (error) throw error
  return data
}

export async function getPenjualanHarian() {
  const { data, error } = await supabase
    .from('v_ringkasan_penjualan_harian').select('*')
  if (error) throw error
  return data
}

export async function getPenjualanBulanan() {
  const { data, error } = await supabase
    .from('v_ringkasan_penjualan_bulanan').select('*').limit(12)
  if (error) throw error
  return data
}

/** Ambil semua pesanan untuk export laporan (admin only) */
export async function getOrdersExport({ dari, sampai, status } = {}) {
  let q = supabase
    .from('orders')
    .select(`invoice_number, nama_pembeli, nomor_wa, kota, provinsi,
             subtotal, ongkir, total, status, created_at,
             payment:payments(metode, status, verified_at),
             items:order_items(nama_produk, kode_produk, qty, harga_satuan, subtotal)`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (dari)   q = q.gte('created_at', dari)
  if (sampai) q = q.lte('created_at', sampai)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw error
  return data
}

// ══════════════════════════════════════════════════════════
// LIVE CHAT (CS ↔ Pengunjung, realtime)
// ══════════════════════════════════════════════════════════

/** [Publik] Buat percakapan baru */
export async function buatPercakapan({ visitor_token, nama_pembeli, nomor_wa = null }) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ visitor_token, nama_pembeli, nomor_wa })
    .select()
    .single()
  if (error) throw error
  return data
}

/** [Publik] Ambil percakapan terbaru milik visitor_token tertentu (null kalau belum pernah chat) */
export async function getPercakapanByToken(visitor_token) {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('visitor_token', visitor_token)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

/** [Publik & CS] Ambil semua pesan dalam satu percakapan, urut lama→baru */
export async function getPesanPercakapan(conversation_id) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/** [Publik] Kirim pesan sebagai pembeli */
export async function kirimPesanPembeli(conversation_id, isi, pengirim_nama = 'Pengunjung') {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ conversation_id, pengirim: 'pembeli', pengirim_nama, isi })
    .select()
    .single()
  if (error) throw error
  return data
}

/** [CS/Admin] Kirim pesan balasan sebagai staff */
export async function kirimPesanCS(conversation_id, isi, pengirim_nama) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ conversation_id, pengirim: 'cs', pengirim_nama, isi })
    .select()
    .single()
  if (error) throw error
  return data
}

/** [CS/Admin] Daftar semua percakapan, terbaru dulu */
export async function getPercakapanCS({ status } = {}) {
  let q = supabase
    .from('chat_conversations')
    .select('*, staff:assigned_to(nama_lengkap, username)')
    .order('last_message_at', { ascending: false })

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw error
  return data
}

/** [CS/Admin] Update status percakapan (terbuka / ditangani / selesai) & opsional ambil-alih (assign) */
export async function updateStatusPercakapan(id, status, assigned_to = undefined) {
  const payload = { status }
  if (assigned_to !== undefined) payload.assigned_to = assigned_to

  const { data, error } = await supabase
    .from('chat_conversations')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/** [CS/Admin] Tandai semua pesan dari pembeli di percakapan ini sudah dibaca */
export async function tandaiPesanDibacaCS(conversation_id) {
  const { error } = await supabase
    .from('chat_messages')
    .update({ dibaca_cs: true })
    .eq('conversation_id', conversation_id)
    .eq('pengirim', 'pembeli')
    .eq('dibaca_cs', false)
  if (error) throw error
}

/** Hitung jumlah pesan pembeli yang belum dibaca CS, per percakapan (dipakai badge sidebar) */
export async function hitungPesanBelumDibaca() {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('conversation_id', { count: 'exact', head: false })
    .eq('pengirim', 'pembeli')
    .eq('dibaca_cs', false)
  if (error) throw error
  return data.length
}

/** Subscribe realtime ke pesan baru pada satu percakapan (dipakai widget pembeli & dashboard CS) */
export function subscribePesanBaru(conversation_id, onInsert) {
  const channel = supabase
    .channel(`chat-messages-${conversation_id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_messages',
      filter: `conversation_id=eq.${conversation_id}`
    }, (payload) => onInsert(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/** Subscribe realtime ke SEMUA percakapan (dipakai dashboard CS untuk badge & list) */
export function subscribeSemuaPercakapan(onChange) {
  const channel = supabase
    .channel('chat-conversations-all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ══════════════════════════════════════════════════════════
// AKUNTANSI (Bagan Akun, Jurnal Umum, Buku Besar, Neraca, Laba Rugi)
// ══════════════════════════════════════════════════════════

/** [Finance/Admin] Daftar Bagan Akun (Chart of Accounts) */
export async function getBaganAkun({ hanyaAktif = true } = {}) {
  let q = supabase.from('akun_akuntansi').select('*').order('kode_akun')
  if (hanyaAktif) q = q.eq('aktif', true)
  const { data, error } = await q
  if (error) throw error
  return data
}

/** [Finance/Admin] Tambah/ubah satu akun */
export async function upsertAkun(akun) {
  const { data, error } = await supabase
    .from('akun_akuntansi')
    .upsert(akun)
    .select()
    .single()
  if (error) throw error
  return data
}

/** [Finance/Admin] Daftar entri jurnal umum (header saja), dengan total debit/kredit per entri */
export async function getJurnalEntries({ dari, sampai, page = 1, perPage = 25 } = {}) {
  let q = supabase
    .from('jurnal_entries')
    .select('*, jurnal_detail(debit, kredit)', { count: 'exact' })
    .order('tanggal', { ascending: false })
    .order('created_at', { ascending: false })

  if (dari)   q = q.gte('tanggal', dari)
  if (sampai) q = q.lte('tanggal', sampai)

  const from = (page - 1) * perPage
  const { data, error, count } = await q.range(from, from + perPage - 1)
  if (error) throw error

  const rows = data.map(j => ({
    ...j,
    total_debit: j.jurnal_detail.reduce((s, d) => s + Number(d.debit), 0),
    total_kredit: j.jurnal_detail.reduce((s, d) => s + Number(d.kredit), 0),
  }))

  return { rows, count, page, perPage, totalPages: Math.ceil(count / perPage) }
}

/** [Finance/Admin] Detail baris satu jurnal (join nama akun) */
export async function getJurnalDetail(jurnalId) {
  const { data, error } = await supabase
    .from('jurnal_detail')
    .select('*, akun:akun_id(kode_akun, nama_akun)')
    .eq('jurnal_id', jurnalId)
  if (error) throw error
  return data
}

/**
 * [Finance/Admin] Buat jurnal manual. baris = [{ akun_id, debit, kredit, keterangan }, ...]
 * Total debit HARUS sama dengan total kredit — divalidasi di database (buat_jurnal()).
 */
export async function buatJurnalManual({ tanggal, keterangan, baris }) {
  const { data, error } = await supabase.rpc('buat_jurnal', {
    p_tanggal: tanggal,
    p_keterangan: keterangan,
    p_sumber: 'manual',
    p_referensi_tabel: null,
    p_referensi_id: null,
    p_baris: baris,
  })
  if (error) throw new Error(error.message.replace(/^.*:\s*/, ''))
  return data
}

/** [Admin] Hapus jurnal (koreksi) — hanya admin */
export async function hapusJurnal(jurnalId) {
  const { error } = await supabase.from('jurnal_entries').delete().eq('id', jurnalId)
  if (error) throw error
}

/** [Finance/Admin] Buku Besar satu akun pada rentang tanggal (dengan saldo berjalan) */
export async function getBukuBesar(akunId, { dari, sampai } = {}) {
  const { data, error } = await supabase.rpc('get_buku_besar', {
    p_akun_id: akunId, p_dari: dari || null, p_sampai: sampai || null,
  })
  if (error) throw error
  return data
}

/** [Finance/Admin] Neraca (posisi keuangan) per tanggal tertentu */
export async function getNeraca(perTanggal) {
  const { data, error } = await supabase.rpc('get_neraca', { p_per_tanggal: perTanggal || new Date().toISOString().slice(0, 10) })
  if (error) throw error
  return data
}

/** [Finance/Admin] Laba Rugi pada rentang tanggal */
export async function getLabaRugi(dari, sampai) {
  const { data, error } = await supabase.rpc('get_laba_rugi', { p_dari: dari, p_sampai: sampai })
  if (error) throw error
  return data
}

// ══════════════════════════════════════════════════════════
// INVENTARIS / STOK (gudang, kartu stok, retur, barang rusak)
// ══════════════════════════════════════════════════════════

/** [Finance/Admin] Daftar gudang */
export async function getGudang() {
  const { data, error } = await supabase.from('gudang').select('*').order('kode_gudang')
  if (error) throw error
  return data
}

/** [Admin] Tambah/ubah gudang */
export async function upsertGudang(gudang) {
  const { data, error } = await supabase.from('gudang').upsert(gudang).select().single()
  if (error) throw error
  return data
}

/** [Finance/Admin] Stok per lokasi untuk satu produk */
export async function getStokLokasi(productId) {
  const { data, error } = await supabase
    .from('stok_lokasi')
    .select('*, gudang:gudang_id(kode_gudang, nama_gudang)')
    .eq('product_id', productId)
  if (error) throw error
  return data
}

/**
 * [Finance/Admin] Catat pergerakan stok baru.
 * tipe: 'masuk_pembelian' | 'masuk_penyesuaian' | 'retur_masuk_pembeli' |
 *       'keluar_penjualan' | 'keluar_penyesuaian' | 'retur_keluar_supplier' | 'rusak_hilang'
 * Untuk 'rusak_hilang', hasilnya berstatus 'menunggu_approval' (belum mengubah stok).
 */
export async function catatPergerakanStok({
  productId, gudangId, tipe, qty, hargaSatuan = null, keterangan = null,
  referensiTabel = null, referensiId = null,
}) {
  const { data, error } = await supabase.rpc('proses_pergerakan_stok', {
    p_product_id: productId,
    p_gudang_id: gudangId,
    p_tipe: tipe,
    p_qty: qty,
    p_harga_satuan: hargaSatuan,
    p_keterangan: keterangan,
    p_referensi_tabel: referensiTabel,
    p_referensi_id: referensiId,
  })
  if (error) throw new Error(error.message.replace(/^.*:\s*/, ''))
  return data
}

/** [Finance/Admin] Setujui atau tolak pergerakan stok yang menunggu approval (barang rusak/hilang) */
export async function setujuiPergerakanStok(movementId, setuju, catatan = null) {
  const { error } = await supabase.rpc('setujui_pergerakan_stok', {
    p_movement_id: movementId, p_setuju: setuju, p_catatan: catatan,
  })
  if (error) throw new Error(error.message.replace(/^.*:\s*/, ''))
}

/** [Finance/Admin] Daftar pergerakan yang MENUNGGU approval (barang rusak/hilang) */
export async function getPergerakanMenungguApproval() {
  const { data, error } = await supabase
    .from('v_kartu_stok')
    .select('*')
    .eq('status', 'menunggu_approval')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** [Finance/Admin] Kartu stok (riwayat pergerakan), filter opsional per produk & gudang */
export async function getKartuStok({ productId, gudangId, page = 1, perPage = 25 } = {}) {
  let q = supabase.from('v_kartu_stok').select('*', { count: 'exact' }).order('created_at', { ascending: false })
  if (productId) q = q.eq('product_id', productId)
  if (gudangId)  q = q.eq('gudang_id', gudangId)

  const from = (page - 1) * perPage
  const { data, error, count } = await q.range(from, from + perPage - 1)
  if (error) throw error
  return { rows: data, count, page, perPage, totalPages: Math.ceil(count / perPage) }
}

/** [Finance/Admin] Daftar ringkas semua produk aktif (utk dropdown & ringkasan stok) */
export async function getProductsRingkas({ search } = {}) {
  let q = supabase
    .from('products')
    .select('id, kode_produk, nama, stok')
    .is('deleted_at', null)
    .order('nama')
  if (search) q = q.ilike('nama', `%${search}%`)
  const { data, error } = await q
  if (error) throw error
  return data
}
