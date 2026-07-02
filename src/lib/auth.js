// src/lib/auth.js
import { supabase } from './supabase.js'

// Domain semu untuk memetakan username → email (dibaca Supabase Auth saja,
// tidak pernah dipakai mengirim email sungguhan).
const STAFF_EMAIL_DOMAIN = 'staff.nataruang.internal'

export const ROLE_LABELS = {
  admin:   'Admin',
  cs:      'Customer Service',
  finance: 'Finance',
}

function usernameToEmail(username) {
  return `${String(username).trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`
}

/**
 * Login staff memakai USERNAME (bukan email).
 * @param {string} username
 * @param {string} password
 */
export async function loginStaff(username, password) {
  if (!username || !password) {
    throw new Error('Username dan password wajib diisi')
  }
  const email = usernameToEmail(username)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Sembunyikan detail teknis Supabase, tampilkan pesan yang aman & jelas
    throw new Error('Username atau password salah')
  }

  // Pastikan akun punya profil staff aktif; kalau tidak, tolak & logout paksa
  const profile = await getMyProfile()
  if (!profile || !profile.aktif) {
    await supabase.auth.signOut()
    throw new Error('Akun tidak ditemukan atau sudah dinonaktifkan. Hubungi Admin.')
  }

  return { session: data.session, profile }
}

/** Logout staff */
export async function logoutStaff() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Ambil sesi aktif (null kalau belum login) */
export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Ambil user auth aktif (mentah, dari Supabase Auth) */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

/**
 * Ambil profil staff (username, nama_lengkap, role, aktif) milik user
 * yang sedang login. Return null kalau belum login / profil tidak ada.
 */
export async function getMyProfile() {
  const user = await getCurrentUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, username, nama_lengkap, role, aktif')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data) return null
  return data
}

/**
 * Guard untuk halaman staff. Panggil di awal setiap skrip halaman.
 * - Belum login                   → redirect ke /login.html
 * - Login tapi role tidak sesuai  → redirect ke /login.html dengan pesan
 * - Role sesuai                   → return { user, profile }
 *
 * @param {string[]} [allowedRoles] contoh: ['admin'] atau ['admin','cs'].
 *                                  Kosongkan untuk mengizinkan semua staff aktif.
 */
export async function requireRole(allowedRoles) {
  const session = await getSession()
  if (!session) {
    window.location.replace('/login.html')
    return null
  }

  const profile = await getMyProfile()
  if (!profile || !profile.aktif) {
    await supabase.auth.signOut()
    window.location.replace('/login.html?alasan=nonaktif')
    return null
  }

  if (Array.isArray(allowedRoles) && allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
    window.location.replace('/login.html?alasan=akses-ditolak')
    return null
  }

  return { user: session.user, profile }
}

/** Kompatibilitas: dipakai halaman admin, hanya izinkan role admin */
export async function requireAdmin() {
  return requireRole(['admin'])
}

/**
 * Ganti password akun staff yang sedang login.
 * Meminta password lama dulu (re-autentikasi) sebelum mengganti, supaya
 * sesi yang "nyasar tertinggal login" tidak bisa dipakai orang lain
 * mengganti password tanpa tahu password lama.
 */
export async function changeMyPassword(username, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) {
    throw new Error('Password lama dan password baru wajib diisi')
  }
  if (newPassword.length < 6) {
    throw new Error('Password baru minimal 6 karakter')
  }

  const email = usernameToEmail(username)

  // Re-autentikasi dengan password lama sebelum boleh mengganti
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) {
    throw new Error('Password lama salah')
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error('Gagal mengubah password: ' + error.message)

  return true
}

/**
 * Daftarkan listener perubahan sesi (login/logout)
 * @param {Function} callback  dipanggil dengan (event, session)
 */
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback)
}
