import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

vi.mock('@hub/capture/ingest', () => ({
  ingest: vi.fn(),
}))

async function freshApp(secret: string | null) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-webhook-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  // Route logs to tmpdir root (persistent) — afterEach deletes tmpDir and
  // pino's async flush would otherwise race with rmSync on Windows.
  process.env['HUB_LOG_DIR'] = tmpdir()
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  if (secret === null) {
    delete process.env['HUB_WEBHOOK_SECRET']
  } else {
    process.env['HUB_WEBHOOK_SECRET'] = secret
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
