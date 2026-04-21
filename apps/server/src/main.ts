import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, getLogger } from '@hub/shared'
import { getDb } from '@hub/db'
import { webhooks } from './webhooks.js'
import { api } from './api.js'
import { requireAuth, loginHandler, logoutHandler } from './auth.js'
import { startScheduler } from './cron.js'
import { startSweeper } from './rate-limit.js'
import { runHealthCheck } from './health.js'

const log = getLogger('server')

/**
 * Resolve the built web UI directory. `apps/web/dist` is produced by
 * `pnpm --filter @hub/web build`. When the server is run from the repo
 * root (dev) or from `apps/server/dist/` (prod) we walk upward until we
 * find it. Returns undefined if not built; the server still works, just
 * without the UI (useful in test/CI).
 */
function resolveWebDist(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, '../../web/dist'), // apps/server/dist -> apps/web/dist
    resolve(here, '../../../apps/web/dist'), // dist nested one more level
    resolve(process.cwd(), 'apps/web/dist'), // running from repo root
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return undefined
}

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
      credentials: true,
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

  // Deep health check: DB round-trip, Ollama reachable, vault writable,
  // backup freshness. Returns 503 if any configured check fails so systemd
  // and uptime monitors can flag outages.
  app.get('/healthz', async (c) => {
    const report = await runHealthCheck()
    return c.json(report, report.ok ? 200 : 503)
  })

  // Browser auth: /auth/login exchanges the UI token for a signed cookie.
  // /auth/logout clears it. The middleware below gates /api/*.
  app.post('/auth/login', loginHandler())
  app.post('/auth/logout', logoutHandler())

  app.use('/api/*', requireAuth)

  app.route('/webhooks', webhooks)
  app.route('/api', api)

  // Static UI (served last so /api, /webhooks, /auth, /health take priority).
  const webDist = resolveWebDist()
  if (webDist) {
    log.info({ webDist }, 'serving web UI')
    app.use(
      '/assets/*',
      serveStatic({
        root: webDist,
        rewriteRequestPath: (p) => p, // keep /assets/...
      }),
    )
    // Serve specific root-level static files (manifest, icons, sw, favicons).
    for (const file of [
      '/manifest.webmanifest',
      '/favicon.ico',
      '/favicon.svg',
      '/robots.txt',
      '/sw.js',
      '/registerSW.js',
      '/icon-192.png',
      '/icon-512.png',
      '/apple-touch-icon.png',
    ]) {
      app.get(file, serveStatic({ root: webDist, path: file }))
    }
    // SPA fallback: any non-API GET returns index.html.
    app.get('*', async (c) => {
      try {
        const html = await readFile(resolve(webDist, 'index.html'), 'utf8')
        return c.html(html)
      } catch {
        return c.text('ui not built', 500)
      }
    })
  } else {
    log.warn('apps/web/dist not found; UI disabled')
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((err, c) => {
    log.error({ err: err.message, stack: err.stack }, 'server error')
    return c.json({ error: 'internal' }, 500)
  })

  return app
}

export async function main(): Promise<void> {
  // Railway injects PORT; map it to HUB_PORT so loadEnv() picks it up.
  if (!process.env['HUB_PORT'] && process.env['PORT']) {
    process.env['HUB_PORT'] = process.env['PORT']
  }
  // Railway requires binding to 0.0.0.0, not the local-only default.
  if (!process.env['HUB_HOST']) {
    process.env['HUB_HOST'] = '0.0.0.0'
  }
  const env = loadEnv()
  // Run DB migrations on every start — idempotent, fast, safe.
  const { migrate } = await import('@hub/db/migrate')
  migrate()
  // Ensure DB is open & schema-ready before accepting traffic.
  getDb()
  const app = buildApp()
  serve({ fetch: app.fetch, port: env.HUB_PORT, hostname: env.HUB_HOST })
  log.info({ port: env.HUB_PORT, host: env.HUB_HOST }, 'hub server listening')
  // Brief scheduler — a no-op unless HUB_BRIEF_ENABLED=1.
  startScheduler()
  // Hourly sweep of the rate-limit bucket map so IP rotation can't leak memory.
  startSweeper()
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
