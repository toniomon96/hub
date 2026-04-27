import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export interface SupabaseRuntimeConfig {
  url: string
  key: string
}

export function getSupabaseConfig(): SupabaseRuntimeConfig | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['CONSULTING_SUPABASE_URL'] ?? ''
  const key =
    process.env['SUPABASE_SECRET_KEY'] ??
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ??
    process.env['CONSULTING_SUPABASE_SERVICE_ROLE_KEY'] ??
    ''

  if (!url || !key) return null
  return { url, key }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig() !== null
}

export function getSupabaseAdmin(): SupabaseClient {
  const config = getSupabaseConfig()
  if (!config) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.',
    )
  }

  cached ??= createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return cached
}
