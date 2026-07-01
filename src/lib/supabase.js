// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON    = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Variabel VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY wajib diisi di file .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: true,
    storage:           localStorage
  },
  global: {
    headers: { 'x-app-name': 'nataruang' }
  }
})

export default supabase
