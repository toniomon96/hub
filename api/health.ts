import { json } from './_lib/http'
import { isSupabaseConfigured } from './_lib/supabase'

export function GET(): Response {
  return json({
    ok: true,
    service: 'hub',
    runtime: 'vercel',
    storage: isSupabaseConfigured() ? 'supabase' : 'supabase_not_configured',
    localWorker: 'not_connected',
    version: '0.3.0',
    timestamp: new Date().toISOString(),
  })
}
