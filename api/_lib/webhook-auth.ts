import { createHmac, timingSafeEqual } from 'node:crypto'
import type { WebhookSource } from './hub-cloud-store'

type VerifyResult = { ok: true } | { ok: false; status: 401 | 503; reason: string }

export function verifyWebhookRequest(
  source: WebhookSource,
  headers: Headers,
  rawBody: string,
): VerifyResult {
  switch (source) {
    case 'granola':
      if (process.env['HUB_WEBHOOK_SECRET_GRANOLA']) {
        return verifyHmac(
          headers.get('x-granola-signature'),
          rawBody,
          process.env['HUB_WEBHOOK_SECRET_GRANOLA'],
          'granola',
        )
      }
      return verifyLegacy(headers.get('x-hub-secret'))
    case 'martin':
      if (process.env['HUB_WEBHOOK_SECRET_MARTIN']) {
        return verifyHmac(
          headers.get('x-martin-signature'),
          rawBody,
          process.env['HUB_WEBHOOK_SECRET_MARTIN'],
          'martin',
        )
      }
      return verifyLegacy(headers.get('x-hub-secret'))
    case 'plaud':
      if (process.env['HUB_WEBHOOK_SECRET_PLAUD']) {
        return verifyBearer(headers.get('authorization'), process.env['HUB_WEBHOOK_SECRET_PLAUD'])
      }
      return verifyLegacy(headers.get('x-hub-secret'))
    case 'manual':
    case 'superwhisper':
      return verifyLegacy(headers.get('x-hub-secret'))
  }
}

export function parseWebhookSource(value: string | null): WebhookSource | null {
  if (
    value === 'granola' ||
    value === 'plaud' ||
    value === 'superwhisper' ||
    value === 'martin' ||
    value === 'manual'
  ) {
    return value
  }
  return null
}

function verifyHmac(
  header: string | null,
  body: string,
  secret: string | undefined,
  vendor: string,
): VerifyResult {
  if (!secret) return { ok: false, status: 503, reason: `${vendor}_secret_not_configured` }
  if (!header) return { ok: false, status: 401, reason: 'missing_signature' }
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  const presented = header.startsWith('sha256=') ? header.slice('sha256='.length) : header
  return timingSafeCompareStrings(presented, expected)
    ? { ok: true }
    : { ok: false, status: 401, reason: 'bad_signature' }
}

function verifyBearer(header: string | null, secret: string | undefined): VerifyResult {
  if (!secret) return { ok: false, status: 503, reason: 'plaud_secret_not_configured' }
  if (!header) return { ok: false, status: 401, reason: 'missing_bearer' }
  const presented = header.replace(/^Bearer\s+/i, '').trim()
  if (!presented) return { ok: false, status: 401, reason: 'missing_bearer' }
  return timingSafeCompareStrings(presented, secret)
    ? { ok: true }
    : { ok: false, status: 401, reason: 'bad_bearer' }
}

function verifyLegacy(header: string | null): VerifyResult {
  const secret = process.env['HUB_WEBHOOK_SECRET']
  if (!secret) return { ok: false, status: 503, reason: 'webhook_not_configured' }
  if (!header) return { ok: false, status: 401, reason: 'missing_secret' }
  return timingSafeCompareStrings(header, secret)
    ? { ok: true }
    : { ok: false, status: 401, reason: 'bad_secret' }
}

function timingSafeCompareStrings(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, 'utf8')
  const bBuffer = Buffer.from(b, 'utf8')
  if (aBuffer.length !== bBuffer.length) {
    const padded = Buffer.alloc(bBuffer.length)
    aBuffer.copy(padded)
    timingSafeEqual(padded, bBuffer)
    return false
  }
  return timingSafeEqual(aBuffer, bBuffer)
}
