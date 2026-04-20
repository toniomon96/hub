import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadEnv, getLogger } from '@hub/shared'
import { getDb } from '@hub/db'
import { webhooks } from './webhooks.js'

const log = getLogger('server')

export function buildApp(): Hono {
  const app = new Hono()

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'hub',
      version: '0.3.0',
      timestamp: new Date().toISOString(),
    }),
  )

  app.route('/webhooks', webhooks)

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
