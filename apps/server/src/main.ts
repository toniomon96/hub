import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { loadEnv, getLogger } from '@hub/shared'
import { getDb } from '@hub/db'
import { webhooks } from './webhooks.js'
import { api } from './api.js'

const log = getLogger('server')

export function buildApp(): Hono {
  const app = new Hono()

  // CORS: allow the Vite dev server (5173) and any loopback origin so the UI
  // can hit /api/* during development. Tighten in production if the UI is
  // served from a different origin than the server.
  app.use(
    '/api/*',
    cors({
      origin: (origin) => {
        if (!origin) return '*'
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
        return null
      },
      credentials: false,
    }),
  )

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'hub',
      version: '0.3.0',
      timestamp: new Date().toISOString(),
    }),
  )

  app.route('/webhooks', webhooks)
  app.route('/api', api)

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((err, c) => {
    log.error({ err: err.message, stack: err.stack }, 'server error')
    return c.json({ error: 'internal' }, 500)
  })

  return app
}

export async function main(): Promise<void> {
  const env = loadEnv()
  // Ensure DB is open & schema-ready before accepting traffic.
  getDb()
  const app = buildApp()
  serve({ fetch: app.fetch, port: env.HUB_PORT, hostname: env.HUB_HOST })
  log.info({ port: env.HUB_PORT, host: env.HUB_HOST }, 'hub server listening')
}

const isEntryPoint =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('main.js') ||
  process.argv[1]?.endsWith('main.ts')

if (isEntryPoint) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
