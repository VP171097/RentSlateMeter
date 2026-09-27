import { createClient } from '@supabase/supabase-js'

// Publishable (browser-safe) key. Never put a service-role/secret key here.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://ztsucnutfmlernqayqwx.supabase.co'
export const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_XHkcEEx_K1YoOOSDAJD_8Q_0kmd4VUq'
export const EDGE_URL = SUPABASE_URL + '/functions/v1/meter-portal'
export const supabase = createClient(SUPABASE_URL, PUBLIC_KEY)
