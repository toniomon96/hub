import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { json } from './http'

const COOKIE_NAME = 'hub_ui'
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 90

export function requireHubAuth(request: Request): Response | null {
  if (!process.env['HUB_UI_TOKEN']) {
    return json({ error: 'ui_not_configured' }, { status: 503 })
  }

  const headerSecret =
    request.headers.get('x-hub-secret') ?? bearerToken(request.headers.get('authorization'))
  if (verifyHeaderToken(headerSecret)) return null

  const cookie = parseCookies(request.headers.get('cookie'))[COOKIE_NAME]
  if (verifyCookieValue(cookie)) return null

  return json({ error: 'unauthorized' }, { status: 401 })
}

export function issueSessionCookie(request: Request): string {
  const nonce = randomBytes(16)
  const signature = createHmac('sha256', cookieSecret()).update(nonce).digest()
  const secure =
    request.url.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https'
  return serializeCookie(COOKIE_NAME, `${b64url(nonce)}.${b64url(signature)}`, {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_SEC,
    path: '/',
    sameSite: 'Lax',
    secure,
  })
}

export function clearSessionCookie(): string {
  return serializeCookie(COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'Lax',
    secure: true,
  })
}

export function verifyHeaderToken(presented: string | undefined | null): boolean {
  const expected = process.env['HUB_UI_TOKEN']
  if (!presented || !expected) return false
  const actualBuffer = Buffer.from(presented, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (actualBuffer.length !== expectedBuffer.length) {
    const padded = Buffer.alloc(expectedBuffer.length)
    actualBuffer.copy(padded)
    timingSafeEqual(padded, expectedBuffer)
    return false
  }
  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function verifyCookieValue(value: string | undefined | null): boolean {
  if (!value) return false
  const parts = value.split('.')
  if (parts.length !== 2) return false

  const [noncePart, sigPart] = parts
  if (!noncePart || !sigPart) return false

  let nonce: Buffer
  let signature: Buffer
  try {
    nonce = b64urlDecode(noncePart)
    signature = b64urlDecode(sigPart)
  } catch {
    return false
  }

  if (nonce.length === 0 || signature.length !== 32) return false
  const expected = createHmac('sha256', cookieSecret()).update(nonce).digest()
  if (signature.length !== expected.length) return false
  return timingSafeEqual(signature, expected)
}

function cookieSecret(): Buffer {
  const explicit = process.env['HUB_COOKIE_SECRET']
  if (explicit) return Buffer.from(explicit, 'utf8')

  const token = process.env['HUB_UI_TOKEN'] ?? ''
  return Buffer.from(token ? `${token}:cookie:dev` : '', 'utf8')
}

function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    const key = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    if (key) result[key] = decodeURIComponent(value)
  }
  return result
}

function bearerToken(value: string | null): string | null {
  if (!value) return null
  const match = value.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function b64urlDecode(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function b64url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean
    maxAge: number
    path: string
    sameSite: 'Lax' | 'Strict' | 'None'
    secure: boolean
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite}`,
  ]
  if (options.httpOnly) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}
