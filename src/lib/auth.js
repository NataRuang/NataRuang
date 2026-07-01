// src/lib/auth.js
import { supabase } from './supabase.js'

/** Login admin dengan email & password */
export async function loginAdmin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

/** Logout admin */
export async function logoutAdmin() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Ambil sesi aktif (null kalau belum login) */
export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Ambil user aktif */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user
}

/**
 * Guard untuk halaman admin.
 * Panggil di awal setiap skrip halaman admin.
 * Jika belum login → redirect ke login.html
 */
export async function requireAdmin() {
  const session = await getSession()
  if (!session) {
    window.location.replace('/login.html')
    return null
  }
  return session.user
}

/**
 * Daftarkan listener perubahan sesi (login/logout)
 * @param {Function} callback  dipanggil dengan (event, session)
 */
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback)
}
