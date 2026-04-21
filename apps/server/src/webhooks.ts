import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { ingest } from '@hub/capture/ingest'
import { loadEnv, getLogger } from '@hub/shared'

const log = getLogger('webhooks')

/** Sources that accept webhook delivery. A subset of CaptureSource. */
type WebhookSource = 'granola' | 'plaud' | 'superwhisper' | 'martin' | 'manual'

export const webhooks = new Hono<{ Variables: { webhookPayload: Record<string, unknown> } }>()

const sources: WebhookSource[] = ['granola', 'plaud', 'superwhisper', 'martin', 'manual']

/**
 * Webhook auth, per vendor:
 *
 *   | Source       | Scheme                                                         |
 *   | ------------ | -------------------------------------------------------------- |
 *   | granola      | HMAC-SHA256(body) in `x-granola-signature: sha256=<hex>`       |
 *   | plaud        | Bearer token in `authorization: Bearer <token>`                |
 *   | martin       | HMAC-SHA256(body) in `x-martin-signature: sha256=<hex>`        |
 *   | superwhisper | Shared secret in `x-hub-secret` (legacy, HUB_WEBHOOK_SECRET)   |
 *   | manual       | Shared secret in `x-hub-secret` (legacy)                       |
 *
 * If a per-vendor secret env var is NOT set, that source falls back to the
 * legacy `HUB_WEBHOOK_SECRET` + `x-hub-secret` header. This keeps existing
 * deployments working while encouraging per-vendor separation.
 *
 * Failure modes:
 *   - Source is configured but no secret is available (per-vendor AND legacy empty) → 503.
 *   - Signature / bearer / header missing or wrong → 401 (timing-safe compare).
 *
 * Middleware reads the raw body once, verifies, stashes the parsed payload
 * on the context, and the handler reuses it — Fetch's Request body stream
 * can only be consumed once.
 */
webhooks.use('/*', async (c, next) => {
  const source = c.req.path.replace(/^\/+/, '').split('/')[0] ?? ''
  if (!sources.includes(source as WebhookSource)) {
    return c.json({ error: 'unknown_source' }, 404)
  }

  const env = loadEnv()
  const rawBody = await c.req.text()

  const result = await verifyWebhook(source as WebhookSource, c.req.raw.headers, rawBody, env)
  if (result.status !== 'ok') {
    log.warn({ source, reason: result.reason }, 'webhook auth rejected')
    return c.json({ error: result.reason }, result.status)
  }

  try {
    const parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
    c.set('webhookPayload', parsed)
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  return next()
})

for (const source of sources) {
  webhooks.post(`/${source}`, async (c) => {
    const payload = c.get('webhookPayload')
    if (!payload || typeof payload !== 'object') {
      return c.json({ error: 'invalid_payload' }, 400)
    }

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

// --- Auth ---------------------------------------------------------------

type VerifyResult = { status: 'ok' } | { status: 401 | 503; reason: string }

interface EnvSubset {
  HUB_WEBHOOK_SECRET: string
  HUB_WEBHOOK_SECRET_GRANOLA: string
  HUB_WEBHOOK_SECRET_PLAUD: string
  HUB_WEBHOOK_SECRET_MARTIN: string
}

export async function verifyWebhook(
  source: WebhookSource,
  headers: Headers,
  rawBody: string,
  env: EnvSubset,
): Promise<VerifyResult> {
  // Migration policy: use the vendor-specific scheme ONLY when the
  // corresponding env var is set. Otherwise fall back to the legacy
  // `x-hub-secret` + HUB_WEBHOOK_SECRET so existing deployments keep working
  // until the operator opts in. Once set, the stricter scheme is enforced.
  switch (source) {
    case 'granola':
      if (env.HUB_WEBHOOK_SECRET_GRANOLA) {
        return verifyHmac(
          headers.get('x-granola-signature'),
          rawBody,
          env.HUB_WEBHOOK_SECRET_GRANOLA,
          'granola',
        )
      }
      return verifyLegacy(headers.get('x-hub-secret'), env.HUB_WEBHOOK_SECRET)
    case 'martin':
      if (env.HUB_WEBHOOK_SECRET_MARTIN) {
        return verifyHmac(
          headers.get('x-martin-signature'),
          rawBody,
          env.HUB_WEBHOOK_SECRET_MARTIN,
          'martin',
        )
      }
      return verifyLegacy(headers.get('x-hub-secret'), env.HUB_WEBHOOK_SECRET)
    case 'plaud':
      if (env.HUB_WEBHOOK_SECRET_PLAUD) {
        return verifyBearer(headers.get('authorization'), env.HUB_WEBHOOK_SECRET_PLAUD)
      }
      return verifyLegacy(headers.get('x-hub-secret'), env.HUB_WEBHOOK_SECRET)
    case 'superwhisper':
    case 'manual':
      return verifyLegacy(headers.get('x-hub-secret'), env.HUB_WEBHOOK_SECRET)
    default: {
      // Exhaustiveness guard: CaptureSource union is closed; if a new source
      // is added this forces an explicit auth decision here.
      const _exhaust: never = source
      return { status: 401, reason: `unhandled_source_${_exhaust as string}` }
    }
  }
}

/**
 * Verify an HMAC-SHA256 signature header of the form `sha256=<hex>`.
 * Returns 503 if no secret is configured, 401 on missing/mismatched sig.
 */
function verifyHmac(
  header: string | null,
  body: string,
  secret: string,
  vendor: string,
): VerifyResult {
  if (!secret) return { status: 503, reason: `${vendor}_secret_not_configured` }
  if (!header) return { status: 401, reason: 'missing_signature' }
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  const presented = header.startsWith('sha256=') ? header.slice('sha256='.length) : header
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) {
    const padded = Buffer.alloc(b.length)
    a.copy(padded)
    timingSafeEqual(padded, b)
    return { status: 401, reason: 'bad_signature' }
  }
  return timingSafeEqual(a, b) ? { status: 'ok' } : { status: 401, reason: 'bad_signature' }
}

function verifyBearer(header: string | null, secret: string): VerifyResult {
  if (!secret) return { status: 503, reason: 'plaud_secret_not_configured' }
  if (!header) return { status: 401, reason: 'missing_bearer' }
  const presented = header.replace(/^Bearer\s+/i, '').trim()
  if (!presented) return { status: 401, reason: 'missing_bearer' }
  return timingSafeCompareStrings(presented, secret)
    ? { status: 'ok' }
    : { status: 401, reason: 'bad_bearer' }
}

function verifyLegacy(header: string | null, secret: string): VerifyResult {
  if (!secret) return { status: 503, reason: 'webhook_not_configured' }
  if (!header) return { status: 401, reason: 'missing_secret' }
  return timingSafeCompareStrings(header, secret)
    ? { status: 'ok' }
    : { status: 401, reason: 'bad_secret' }
}

function timingSafeCompareStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    const padded = Buffer.alloc(bBuf.length)
    aBuf.copy(padded)
    timingSafeEqual(padded, bBuf)
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}
