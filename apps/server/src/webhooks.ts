import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { ingest } from '@hub/capture/ingest'
import { loadEnv, getLogger } from '@hub/shared'
import type { CaptureSource } from '@hub/shared'

const log = getLogger('webhooks')

export const webhooks = new Hono()

/**
 * All webhook endpoints share one shared-secret header (`x-hub-secret`).
 * Per-vendor signature schemes (Granola HMAC, Plaud bearer) can replace
 * this per source later; at MVP one secret across the board is simpler
 * and dramatically better than the previous unauthenticated stubs.
 *
 * Auth failure modes:
 *   - `HUB_WEBHOOK_SECRET` empty → 503. Server refuses webhooks until
 *     you configure a secret. Prevents "oh I forgot to set it" from
 *     silently exposing the endpoint.
 *   - header missing or wrong length → 401.
 *   - header present but doesn't match → 401 (via timing-safe compare).
 *
 * Each webhook normalizes its payload to { source, text, rawContentRef }
 * and hands off to capture.ingest() which runs classify + inbox filing.
 */
webhooks.use('/*', async (c, next) => {
  const env = loadEnv()
  if (!env.HUB_WEBHOOK_SECRET) {
    log.warn('webhook rejected: HUB_WEBHOOK_SECRET not configured')
    return c.json({ error: 'webhook_not_configured' }, 503)
  }
  const presented = c.req.header('x-hub-secret') ?? ''
  if (!isValidSecret(presented, env.HUB_WEBHOOK_SECRET)) {
    log.warn({ path: c.req.path }, 'webhook auth rejected')
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

const sources: Array<CaptureSource> = ['granola', 'plaud', 'superwhisper', 'martin', 'manual']

for (const source of sources) {
  webhooks.post(`/${source}`, async (c) => {
    const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'invalid_payload' }, 400)
    }

    // Normalize. Each source has a different shape; we do the minimum here.
    const text =
      typeof payload['text'] === 'string'
        ? payload['text']
        : typeof payload['transcript'] === 'string'
          ? payload['transcript']
          : typeof payload['body'] === 'string'
            ? payload['body']
            : null

    if (!text) return c.json({ error: 'no_text_field' }, 400)

    const ref =
      typeof payload['ref'] === 'string' ? payload['ref'] : `webhook:${source}:${Date.now()}`
    const result = await ingest({ source, text, rawContentRef: ref })
    log.info(
      {
        source,
        captureId: result.id,
        dup: result.isDuplicate,
        classified: result.classified,
        filed: result.filed,
      },
      'webhook',
    )
    return c.json(result, 202)
  })
}

/**
 * Timing-safe secret compare. `timingSafeEqual` throws if buffers differ in
 * length, so we pad/truncate the presented value to the expected length —
 * the constant-time compare still fails on content mismatch, and we avoid
 * leaking length via a thrown exception vs. a normal mismatch.
 */
function isValidSecret(presented: string, expected: string): boolean {
  if (!presented) return false
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    const padded = Buffer.alloc(b.length)
    a.copy(padded)
    timingSafeEqual(padded, b)
    return false
  }
  return timingSafeEqual(a, b)
}
