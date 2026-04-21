import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

vi.mock('@hub/capture/ingest', () => ({
  ingest: vi.fn(),
}))

async function freshApp(
  secret: string | null,
  perVendor: Partial<Record<'GRANOLA' | 'PLAUD' | 'MARTIN', string>> = {},
) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-webhook-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = tmpdir()
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  if (secret === null) {
    delete process.env['HUB_WEBHOOK_SECRET']
  } else {
    process.env['HUB_WEBHOOK_SECRET'] = secret
  }
  for (const k of ['GRANOLA', 'PLAUD', 'MARTIN'] as const) {
    const v = perVendor[k]
    if (v === undefined) delete process.env[`HUB_WEBHOOK_SECRET_${k}`]
    else process.env[`HUB_WEBHOOK_SECRET_${k}`] = v
  }
  _resetEnvCache()

  const { webhooks } = await import('../webhooks.js')
  const { ingest } = await import('@hub/capture/ingest')
  return { webhooks, ingest: ingest as unknown as ReturnType<typeof vi.fn> }
}

describe('webhooks auth', () => {
  beforeEach(() => {
    delete process.env['HUB_WEBHOOK_SECRET']
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns 503 when HUB_WEBHOOK_SECRET is unset', async () => {
    const { webhooks, ingest } = await freshApp(null)
    const res = await webhooks.request('/superwhisper', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 'anything' },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'webhook_not_configured' })
    expect(ingest).not.toHaveBeenCalled()
  })

  it('returns 401 when header is missing', async () => {
    const { webhooks, ingest } = await freshApp('correct-horse-battery-staple')
    const res = await webhooks.request('/superwhisper', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('returns 401 when header does not match', async () => {
    const { webhooks, ingest } = await freshApp('correct-horse-battery-staple')
    const res = await webhooks.request('/superwhisper', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 'wrong-value' },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('returns 401 on short/wrong-length header (no length-based bypass)', async () => {
    const { webhooks, ingest } = await freshApp('correct-horse-battery-staple')
    const res = await webhooks.request('/superwhisper', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 'x' },
      body: JSON.stringify({ text: 'hi' }),
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('accepts a valid secret and calls ingest with source=superwhisper', async () => {
    const { webhooks, ingest } = await freshApp('correct-horse-battery-staple')
    ingest.mockResolvedValueOnce({
      id: 'ULID123',
      isDuplicate: false,
      classified: true,
      filed: true,
    })

    const res = await webhooks.request('/superwhisper', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ text: 'buy milk', ref: 'sw://1' }),
    })
    expect(res.status).toBe(202)
    expect(ingest).toHaveBeenCalledOnce()
    expect(ingest).toHaveBeenCalledWith({
      source: 'superwhisper',
      text: 'buy milk',
      rawContentRef: 'sw://1',
    })
    const body = await res.json()
    expect(body).toMatchObject({ id: 'ULID123', filed: true })
  })

  it('accepts { transcript } as the text field alias', async () => {
    const { webhooks, ingest } = await freshApp('s3cret-value-xyz')
    ingest.mockResolvedValueOnce({ id: 'ULID456', isDuplicate: false })

    const res = await webhooks.request('/granola', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 's3cret-value-xyz' },
      body: JSON.stringify({ transcript: 'standup notes' }),
    })
    expect(res.status).toBe(202)
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'granola', text: 'standup notes' }),
    )
  })

  it('returns 400 on payload with no recognized text field', async () => {
    const { webhooks } = await freshApp('s3cret-value-xyz')
    const res = await webhooks.request('/superwhisper', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 's3cret-value-xyz' },
      body: JSON.stringify({ title: 'no text here' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'no_text_field' })
  })
})

describe('webhooks per-vendor signatures', () => {
  beforeEach(() => {
    delete process.env['HUB_WEBHOOK_SECRET']
    delete process.env['HUB_WEBHOOK_SECRET_GRANOLA']
    delete process.env['HUB_WEBHOOK_SECRET_PLAUD']
    delete process.env['HUB_WEBHOOK_SECRET_MARTIN']
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('granola: accepts valid HMAC-SHA256 x-granola-signature', async () => {
    const { webhooks, ingest } = await freshApp('legacy-not-used', { GRANOLA: 'granola-secret' })
    ingest.mockResolvedValueOnce({ id: 'g1', isDuplicate: false })

    const body = JSON.stringify({ transcript: 'standup notes' })
    const sig = createHmac('sha256', 'granola-secret').update(body, 'utf8').digest('hex')
    const res = await webhooks.request('/granola', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-granola-signature': `sha256=${sig}` },
      body,
    })
    expect(res.status).toBe(202)
    expect(ingest).toHaveBeenCalledOnce()
  })

  it('granola: rejects wrong HMAC', async () => {
    const { webhooks, ingest } = await freshApp('legacy-not-used', { GRANOLA: 'granola-secret' })
    const body = JSON.stringify({ transcript: 'x' })
    const res = await webhooks.request('/granola', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-granola-signature': 'sha256=deadbeef' },
      body,
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('granola: rejects bare x-hub-secret when HUB_WEBHOOK_SECRET_GRANOLA is set', async () => {
    const { webhooks, ingest } = await freshApp('granola-secret', { GRANOLA: 'granola-secret' })
    const body = JSON.stringify({ transcript: 'x' })
    const res = await webhooks.request('/granola', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 'granola-secret' },
      body,
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('plaud: accepts `authorization: Bearer <token>`', async () => {
    const { webhooks, ingest } = await freshApp('legacy', { PLAUD: 'plaud-token-42' })
    ingest.mockResolvedValueOnce({ id: 'p1', isDuplicate: false })
    const res = await webhooks.request('/plaud', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer plaud-token-42' },
      body: JSON.stringify({ transcript: 'voice note' }),
    })
    expect(res.status).toBe(202)
  })

  it('plaud: rejects wrong bearer', async () => {
    const { webhooks, ingest } = await freshApp('legacy', { PLAUD: 'plaud-token-42' })
    const res = await webhooks.request('/plaud', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ transcript: 'x' }),
    })
    expect(res.status).toBe(401)
    expect(ingest).not.toHaveBeenCalled()
  })

  it('martin: HMAC works the same as granola', async () => {
    const { webhooks, ingest } = await freshApp('legacy', { MARTIN: 'martin-secret' })
    ingest.mockResolvedValueOnce({ id: 'm1', isDuplicate: false })
    const body = JSON.stringify({ body: 'a reminder' })
    const sig = createHmac('sha256', 'martin-secret').update(body, 'utf8').digest('hex')
    const res = await webhooks.request('/martin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-martin-signature': `sha256=${sig}` },
      body,
    })
    expect(res.status).toBe(202)
  })

  it('legacy fallback: unset vendor env keeps x-hub-secret working for granola', async () => {
    const { webhooks, ingest } = await freshApp('legacy-shared')
    ingest.mockResolvedValueOnce({ id: 'g2', isDuplicate: false })
    const res = await webhooks.request('/granola', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 'legacy-shared' },
      body: JSON.stringify({ transcript: 'x' }),
    })
    expect(res.status).toBe(202)
  })

  it('unknown source: 404', async () => {
    const { webhooks } = await freshApp('legacy')
    const res = await webhooks.request('/pwned', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-secret': 'legacy' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })
})
