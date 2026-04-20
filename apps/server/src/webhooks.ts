import { Hono } from 'hono'
import { ingest } from '@hub/capture/ingest'
import { getLogger } from '@hub/shared'
import type { CaptureSource } from '@hub/shared'

const log = getLogger('webhooks')

export const webhooks = new Hono()

/**
 * Each webhook normalizes its payload to { source, text, rawContentRef }
 * and hands off to capture.ingest(). Classification + dispatch run async
 * (V1 — see capture/classify.ts).
 *
 * MVP: stubs return 202 with the capture id. Signature validation is
 * per-vendor (Granola HMAC, Plaud bearer, etc.) — wire in V1.
 */

const sources: Array<CaptureSource> = ['granola', 'plaud', 'superwhisper', 'martin', 'manual']

for (const source of sources) {
  webhooks.post(`/${source}`, async (c) => {
    const payload = await c.req.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'invalid_payload' }, 400)
    }

    // Normalize. Each source has a different shape; we do the minimum here.
    const text =
      typeof payload.text === 'string'
        ? payload.text
        : typeof payload.transcript === 'string'
          ? payload.transcript
          : typeof payload.body === 'string'
            ? payload.body
            : null

    if (!text) return c.json({ error: 'no_text_field' }, 400)

    const ref = payload.ref ?? `webhook:${source}:${Date.now()}`
    const result = ingest({ source, text, rawContentRef: ref })
    log.info({ source, captureId: result.id, dup: result.isDuplicate }, 'webhook')
    return c.json(result, 202)
  })
}
