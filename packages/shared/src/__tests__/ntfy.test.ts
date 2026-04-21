import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetEnvCache } from '../env.js'

function resetEnv(overrides: Record<string, string | undefined> = {}) {
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  delete process.env['NTFY_TOPIC']
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  _resetEnvCache()
}

describe('notify (ntfy)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    resetEnv()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('is a no-op when NTFY_TOPIC is not configured', async () => {
    const mockFetch = vi.fn()
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const { notify } = await import('../ntfy.js')
    const r = await notify({ body: 'hello' })

    expect(r.sent).toBe(false)
    expect(r.reason).toContain('NTFY_TOPIC')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('POSTs to <NTFY_URL>/<topic> with headers when configured', async () => {
    resetEnv({ NTFY_TOPIC: 'hub-alerts', NTFY_URL: 'https://ntfy.example.com' })
    const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const { notify } = await import('../ntfy.js')
    const r = await notify({
      title: 'oops',
      body: 'something went wrong',
      priority: 'high',
      tags: ['warning'],
    })

    expect(r.sent).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ntfy.example.com/hub-alerts')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('something went wrong')
    const headers = init.headers as Record<string, string>
    expect(headers['title']).toBe('oops')
    expect(headers['priority']).toBe('high')
    expect(headers['tags']).toBe('warning')
  })

  it('returns sent=false on non-2xx, does NOT throw', async () => {
    resetEnv({ NTFY_TOPIC: 'hub-alerts' })
    globalThis.fetch = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as unknown as typeof fetch

    const { notify } = await import('../ntfy.js')
    const r = await notify({ body: 'hi' })
    expect(r.sent).toBe(false)
    expect(r.reason).toContain('429')
  })

  it('returns sent=false on fetch error, does NOT throw', async () => {
    resetEnv({ NTFY_TOPIC: 'hub-alerts' })
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    const { notify } = await import('../ntfy.js')
    const r = await notify({ body: 'hi' })
    expect(r.sent).toBe(false)
    expect(r.reason).toContain('ECONNREFUSED')
  })

  it('topic override takes precedence over env', async () => {
    resetEnv({ NTFY_TOPIC: 'default-topic' })
    const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const { notify } = await import('../ntfy.js')
    await notify({ body: 'x', topic: 'override-topic' })

    const [url] = (mockFetch.mock.calls[0] ?? []) as unknown as [string]
    expect(url).toContain('/override-topic')
  })
})
