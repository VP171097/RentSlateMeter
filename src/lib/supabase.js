import { createClient, processLock } from '@supabase/supabase-js'

// Publishable (browser-safe) key. Never put a service-role/secret key here.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ztsucnutfmlernqayqwx.supabase.co'
export const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_XHkcEEx_K1YoOOSDAJD_8Q_0kmd4VUq'
export const EDGE_URL = SUPABASE_URL + '/functions/v1/meter-portal'

// RentSlate Meter lives in its own "meter" schema and buckets, so it can share a
// Supabase project with other apps (Finance Dashboard) without any overlap.
export const DB_SCHEMA = 'meter'
export const BILLS_BUCKET = 'meter-bills'
export const PHOTOS_BUCKET = 'meter-photos'

// Read the auth-email link state before the client consumes and clears the
// URL fragment (password-reset links arrive as #access_token=…&type=recovery,
// expired links as #error=…&error_description=…).
const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
export const AUTH_LINK = {
  recovery: hash.get('type') === 'recovery',
  error: hash.get('error_description')
    ? (hash.get('error_code') === 'otp_expired' ? 'This email link has expired or was already used. Request a new one.' : hash.get('error_description'))
    : null,
}
if (AUTH_LINK.error) history.replaceState(null, '', location.pathname + location.search)

// Every Supabase request gets a time limit, so a stalled mobile connection
// fails (and can be retried) instead of leaving the app waiting forever.
const REQUEST_TIMEOUT_MS = 30000
function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason)
    else init.signal.addEventListener('abort', () => controller.abort(init.signal.reason), { once: true })
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export const AUTH_STORAGE_KEY = 'sb-' + new URL(SUPABASE_URL).hostname.split('.')[0] + '-auth-token'

export const supabase = createClient(SUPABASE_URL, PUBLIC_KEY, {
  // The default cross-tab lock (navigator.locks) is waited on with no time
  // limit at start-up; a frozen background tab or the installed app holding it
  // left the app stuck on the logo. An in-tab lock can't be blocked that way.
  auth: { lock: processLock },
  db: { schema: DB_SCHEMA },
  global: { fetch: fetchWithTimeout },
})
