// src/pages/login.js
import { loginAdmin, getSession } from '@/lib/auth.js'
import { initDarkMode } from '@/lib/utils.js'

initDarkMode()

// Redirect jika sudah login
getSession().then(session => {
  if (session) window.location.replace('/admin.html')
})

const form      = document.getElementById('form-login')
const alertEl   = document.getElementById('alert-error')
const btnSubmit = document.getElementById('btn-submit')
const btnLabel  = document.getElementById('btn-label')
const spinner   = document.getElementById('spinner')
const pwInput   = document.getElementById('password')
const emailInput = document.getElementById('email')

// Toggle password visibility
document.getElementById('btn-show-pw').addEventListener('click', () => {
  const isText = pwInput.type === 'text'
  pwInput.type = isText ? 'password' : 'text'
  document.getElementById('icon-eye').classList.toggle('hidden', !isText)
  document.getElementById('icon-eye-off').classList.toggle('hidden', isText)
})

// Rate limit sederhana di client (5 percobaan per 5 menit)
const RL_KEY = 'fs_login_attempts'
function getAttempts() {
  try { return JSON.parse(sessionStorage.getItem(RL_KEY)) || { count: 0, ts: 0 } }
  catch { return { count: 0, ts: 0 } }
}
function recordAttempt() {
  const now = Date.now()
  const a   = getAttempts()
  if (now - a.ts > 5 * 60 * 1000) { a.count = 1; a.ts = now }
  else a.count++
  sessionStorage.setItem(RL_KEY, JSON.stringify(a))
  return a.count
}
function resetAttempts() { sessionStorage.removeItem(RL_KEY) }

// Validasi form
function validate() {
  let ok = true
  const email = emailInput.value.trim()
  const pw    = pwInput.value

  const errEmail = document.getElementById('err-email')
  const errPw    = document.getElementById('err-password')

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEmail.classList.remove('hidden'); ok = false
  } else errEmail.classList.add('hidden')

  if (pw.length < 6) {
    errPw.classList.remove('hidden'); ok = false
  } else errPw.classList.add('hidden')

  return ok
}

function setLoading(on) {
  btnSubmit.disabled = on
  btnLabel.textContent = on ? 'Memverifikasi...' : 'Masuk'
  spinner.classList.toggle('hidden', !on)
}

function showError(msg) {
  alertEl.textContent = msg
  alertEl.classList.remove('hidden')
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  alertEl.classList.add('hidden')

  if (!validate()) return

  const attempts = getAttempts().count
  if (attempts >= 5) {
    showError('Terlalu banyak percobaan login. Coba lagi dalam 5 menit.')
    return
  }

  setLoading(true)
  recordAttempt()

  try {
    await loginAdmin(emailInput.value.trim(), pwInput.value)
    resetAttempts()
    window.location.replace('/admin.html')
  } catch (err) {
    setLoading(false)
    const msg = err.message?.toLowerCase() || ''
    if (msg.includes('invalid') || msg.includes('credentials')) {
      showError('Email atau password salah.')
    } else if (msg.includes('too many')) {
      showError('Terlalu banyak percobaan. Silakan tunggu beberapa menit.')
    } else {
      showError('Gagal login: ' + (err.message || 'Kesalahan tidak diketahui'))
    }
  }
})
