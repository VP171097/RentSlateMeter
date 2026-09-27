import { createClient } from '@supabase/supabase-js'

// Publishable (browser-safe) key. Never put a service-role/secret key here.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ztsucnutfmlernqayqwx.supabase.co'
export const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_XHkcEEx_K1YoOOSDAJD_8Q_0kmd4VUq'
export const EDGE_URL = SUPABASE_URL + '/functions/v1/meter-portal'

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

export const supabase = createClient(SUPABASE_URL, PUBLIC_KEY)
