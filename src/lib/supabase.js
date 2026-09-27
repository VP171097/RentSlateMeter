import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://ztsucnutfmlernqayqwx.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_XHkcEEx_K1YoOOSDAJD_8Q_0kmd4VUq'
export const supabase = createClient(url,key)
