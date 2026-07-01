// src/lib/chatbot.js
// Chatbot rule-based menggunakan keyword matching dari tabel chatbot_faq.
// Tidak memerlukan API berbayar — murni query Supabase + logika client.

import { getFaqs }      from './api.js'
import { buatLinkWA }   from './utils.js'

let faqCache = null
let loadedAt  = 0
const CACHE_TTL = 5 * 60 * 1000  // 5 menit

/** Muat FAQ dari Supabase (dengan cache sederhana) */
async function loadFaqs() {
  if (faqCache && Date.now() - loadedAt < CACHE_TTL) return faqCache
  faqCache = await getFaqs()
  loadedAt  = Date.now()
  return faqCache
}

/**
 * Cari jawaban berdasarkan teks pertanyaan pengguna
 * @param {string} teks   Input dari pengguna
 * @returns {Promise<{ jawaban: string|null, faq: object|null }>}
 */
export async function cariJawaban(teks) {
  const faqs   = await loadFaqs()
  const needle = teks.toLowerCase().trim()

  // Skor setiap FAQ berdasarkan berapa banyak keyword yang cocok
  let best = null, bestScore = 0

  for (const faq of faqs) {
    const keywords = faq.tags?.map(t => t.keyword) || []
    let score = 0

    for (const kw of keywords) {
      if (needle.includes(kw)) {
        // Keyword lebih panjang → skor lebih tinggi
        score += kw.length
      }
    }

    // Cek juga kecocokan langsung dengan teks pertanyaan
    if (needle.includes(faq.pertanyaan.toLowerCase().slice(0, 15))) {
      score += 20
    }

    if (score > bestScore) {
      bestScore = score
      best = faq
    }
  }

  if (bestScore > 0) {
    return { jawaban: best.jawaban, faq: best }
  }
  return { jawaban: null, faq: null }
}

/** Dapatkan daftar pertanyaan populer untuk quick reply */
export async function getQuickReplies(maks = 4) {
  const faqs = await loadFaqs()
  return faqs.slice(0, maks).map(f => f.pertanyaan)
}

/**
 * Sapa pembuka saat chatbot pertama dibuka
 */
export function pesanSambutan() {
  const jam = new Date().getHours()
  const waktu = jam < 12 ? 'pagi' : jam < 15 ? 'siang' : jam < 19 ? 'sore' : 'malam'
  return `Selamat ${waktu}! Ada yang bisa kami bantu seputar produk atau pesanan? 😊`
}

/**
 * Buat link WhatsApp dengan konteks pertanyaan yang tidak terjawab
 */
export function linkWAEskalasi(nomorWa, pertanyaan) {
  const pesan = `Halo, saya ingin bertanya:\n\n"${pertanyaan}"\n\nMohon bantuannya.`
  return buatLinkWA(nomorWa, pesan)
}
