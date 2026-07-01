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
