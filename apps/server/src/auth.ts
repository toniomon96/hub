import type { Context, MiddlewareHandler } from 'hono'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { timingSafeEqual, createHmac, randomBytes } from 'node:crypto'
import { loadEnv, getLogger } from '@hub/shared'

const log = getLogger('auth')

const COOKIE_NAME = 'hub_ui'
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 90 // 90 days

/**
 * Auth model:
 *   - CLI / webhooks / tools present `x-hub-secret: <HUB_UI_TOKEN>` header.
 *     (This is a deliberate re-use: they already know the token.)
 *   - Browser UI presents a signed `hub_ui` cookie issued via POST /auth/login.
 *
 * Cookie format: `base64url(random16).base64url(hmacSHA256(random16, secret))`
 * The cookie itself carries no sensitive data; it's an opaque bearer that we
 * verify by recomputing the HMAC with the server secret. Rotating
 * HUB_UI_TOKEN invalidates every outstanding cookie immediately.
 */

function cookieSecret(): Buffer {
  const env = loadEnv()
  const raw = env.HUB_COOKIE_SECRET || env.HUB_UI_TOKEN
  if (!raw) throw new Error('HUB_UI_TOKEN (or HUB_COOKIE_SECRET) must be set to issue cookies')
  return Buffer.from(raw, 'utf8')
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/** Issue a fresh opaque signed cookie value. */
export function issueCookieValue(): string {
  const nonce = randomBytes(16)
  const sig = createHmac('sha256', cookieSecret()).update(nonce).digest()
  return `${b64url(nonce)}.${b64url(sig)}`
}

/** Verify a cookie value. Timing-safe. */
export function verifyCookieValue(value: string | undefined | null): boolean {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 2) return false
  const [noncePart, sigPart] = parts
  if (!noncePart || !sigPart) return false
  let nonce: Buffer
  let sig: Buffer
  try {
    nonce = b64urlDecode(noncePart)
    sig = b64urlDecode(sigPart)
  } catch {
    return false
  }
  if (nonce.length === 0 || sig.length !== 32) return false
  const expected = createHmac('sha256', cookieSecret()).update(nonce).digest()
  if (sig.length !== expected.length) return false
  return timingSafeEqual(sig, expected)
}

/** Timing-safe compare of presented token against the configured token. */
export function verifyHeaderToken(presented: string | undefined | null): boolean {
  if (!presented) return false
  const env = loadEnv()
  if (!env.HUB_UI_TOKEN) return false
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(env.HUB_UI_TOKEN, 'utf8')
  if (a.length !== b.length) {
    // pad to equal length so timingSafeEqual won't throw; result still false
    const padded = Buffer.alloc(b.length)
    a.copy(padded)
    timingSafeEqual(padded, b)
    return false
  }
  return timingSafeEqual(a, b)
}

function setSessionCookie(c: Context, value: string, maxAgeSec: number): void {
  const xfp = c.req.header('x-forwarded-proto')
  const isHttps = xfp === 'https' || c.req.url.startsWith('https://')
  setCookie(c, COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps,
    maxAge: maxAgeSec,
  })
}

/**
 * Require auth for /api/*. Accepts either:
 *   - `x-hub-secret` header matching HUB_UI_TOKEN (CLI/tools), OR
 *   - a valid `hub_ui` cookie (browser, issued by /auth/login)
 *
 * 503 if server not configured; 401 if auth missing or invalid.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const env = loadEnv()
  if (!env.HUB_UI_TOKEN) {
    log.warn('api rejected: HUB_UI_TOKEN not configured')
    return c.json({ error: 'ui_not_configured' }, 503)
  }
  const headerOk = verifyHeaderToken(c.req.header('x-hub-secret'))
  if (headerOk) return next()

  const cookieVal = getCookie(c, COOKIE_NAME)
  if (verifyCookieValue(cookieVal)) return next()

  return c.json({ error: 'unauthorized' }, 401)
}

/** Mount /auth/login and /auth/logout on the given app. */
export function loginHandler(): (c: Context) => Promise<Response> {
  return async (c) => {
    const env = loadEnv()
    if (!env.HUB_UI_TOKEN) {
      return c.json({ error: 'ui_not_configured' }, 503)
    }
    const body = (await c.req.json().catch(() => null)) as { token?: string } | null
    const token = body?.token ?? ''
    if (!verifyHeaderToken(token)) {
      log.warn('login rejected')
      return c.json({ error: 'unauthorized' }, 401)
    }
    const value = issueCookieValue()
    setSessionCookie(c, value, COOKIE_MAX_AGE_SEC)
    return c.json({ ok: true })
  }
}

export function logoutHandler(): (c: Context) => Promise<Response> {
  return async (c) => {
    deleteCookie(c, COOKIE_NAME, { path: '/' })
    return c.json({ ok: true })
  }
}
