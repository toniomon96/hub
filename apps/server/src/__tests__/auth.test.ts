import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

async function freshAuth(uiToken: string | null) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-auth-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = tmpdir()
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  if (uiToken === null) {
    delete process.env['HUB_UI_TOKEN']
  } else {
    process.env['HUB_UI_TOKEN'] = uiToken
  }
  delete process.env['HUB_COOKIE_SECRET']
  _resetEnvCache()
  const { _reset: resetRateLimit } = await import('../rate-limit.js')
  resetRateLimit()

  const { requireAuth, loginHandler, logoutHandler, issueCookieValue, verifyCookieValue } =
    await import('../auth.js')
  const app = new Hono()
  app.post('/auth/login', loginHandler())
  app.post('/auth/logout', logoutHandler())
  app.use('/api/*', requireAuth)
  app.get('/api/ping', (c) => c.json({ ok: true }))
  return { app, issueCookieValue, verifyCookieValue }
}

describe('browser auth', () => {
  beforeEach(() => {
    delete process.env['HUB_UI_TOKEN']
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns 503 when HUB_UI_TOKEN is unset', async () => {
    const { app } = await freshAuth(null)
    const res = await app.request('/api/ping')
    expect(res.status).toBe(503)
  })

  it('returns 401 when no auth is presented', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/api/ping')
    expect(res.status).toBe(401)
  })

  it('accepts x-hub-secret header matching HUB_UI_TOKEN', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/api/ping', {
      headers: { 'x-hub-secret': 's3cret-token' },
    })
    expect(res.status).toBe(200)
  })

  it('rejects x-hub-secret with a different value (timing-safe)', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/api/ping', {
      headers: { 'x-hub-secret': 'wrong-token-XXXXX' },
    })
    expect(res.status).toBe(401)
  })

  it('login with correct token sets a hub_ui cookie', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 's3cret-token' }),
    })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie!).toMatch(/^hub_ui=[^;]+;/)
    expect(setCookie!).toMatch(/HttpOnly/i)
    expect(setCookie!).toMatch(/SameSite=Lax/i)
  })

  it('login with wrong token returns 401 and no cookie', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'nope' }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('cookie issued by login is accepted by /api/*', async () => {
    const { app } = await freshAuth('s3cret-token')
    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 's3cret-token' }),
    })
    const setCookie = loginRes.headers.get('set-cookie')!
    const cookieVal = setCookie.split(';')[0]! // hub_ui=xxx.yyy
    const res = await app.request('/api/ping', {
      headers: { cookie: cookieVal },
    })
    expect(res.status).toBe(200)
  })

  it('rejects tampered cookie (different HMAC)', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/api/ping', {
      headers: { cookie: 'hub_ui=aaaabbbb.ccccdddd' },
    })
    expect(res.status).toBe(401)
  })

  it('cookie becomes invalid when HUB_UI_TOKEN rotates', async () => {
    const first = await freshAuth('secret-A')
    const loginRes = await first.app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'secret-A' }),
    })
    const cookieVal = loginRes.headers.get('set-cookie')!.split(';')[0]!

    // Rotate the token. Rebuild the app so new env is picked up.
    rmSync(tmpDir, { recursive: true, force: true })
    const second = await freshAuth('secret-B')

    const res = await second.app.request('/api/ping', {
      headers: { cookie: cookieVal },
    })
    expect(res.status).toBe(401)
  })

  it('logout clears the cookie', async () => {
    const { app } = await freshAuth('s3cret-token')
    const res = await app.request('/auth/logout', { method: 'POST' })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toMatch(/hub_ui=/)
    expect(setCookie).toMatch(/Max-Age=0/i)
  })

  it('/auth/login returns 429 after 5 failed attempts from the same IP', async () => {
    const { app } = await freshAuth('s3cret-token')
    const hdrs = { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ token: 'wrong' }),
      })
      expect(res.status).toBe(401)
    }
    const blocked = await app.request('/auth/login', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ token: 'wrong' }),
    })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })

  it('successful login resets the attempt counter', async () => {
    const { app } = await freshAuth('s3cret-token')
    const hdrs = { 'content-type': 'application/json', 'x-forwarded-for': '5.6.7.8' }
    for (let i = 0; i < 4; i++) {
      await app.request('/auth/login', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ token: 'wrong' }),
      })
    }
    const ok = await app.request('/auth/login', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ token: 's3cret-token' }),
    })
    expect(ok.status).toBe(200)
    // Next wrong attempt should still be allowed (counter reset), landing as 401 not 429.
    const next = await app.request('/auth/login', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ token: 'wrong' }),
    })
    expect(next.status).toBe(401)
  })
})
