import { describe, it, expect, beforeEach, vi } from 'vitest'
import { publishNtfy, _resetEnvCache } from '../index.js'

describe('publishNtfy', () => {
  beforeEach(() => {
    _resetEnvCache()
    process.env['HUB_SKIP_DOTENV'] = '1'
    process.env['ANTHROPIC_API_KEY'] = 'sk-test'
    delete process.env['NTFY_TOPIC']
    delete process.env['NTFY_URL']
  })

  it('is a no-op and returns false when NTFY_TOPIC is unset', async () => {
    const fetchMock = vi.fn()
    const ok = await publishNtfy({ message: 'hi' }, fetchMock as unknown as typeof fetch)
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs to <NTFY_URL>/<NTFY_TOPIC> with title/priority/tags headers', async () => {
    process.env['NTFY_TOPIC'] = 'hub-test'
    process.env['NTFY_URL'] = 'https://ntfy.example.com/'
    _resetEnvCache()

    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok', { status: 200 }))
    const ok = await publishNtfy(
      {
        title: 'Spend warning',
        message: '80% of daily cap',
        priority: 4,
        tags: ['warning', 'money'],
      },
      fetchMock,
    )

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]!
    const url = call[0] as string
    const init = call[1] as RequestInit
    // Trailing slash on NTFY_URL must be stripped.
    expect(url).toBe('https://ntfy.example.com/hub-test')
    const headers = init.headers as Record<string, string>
    expect(headers['Title']).toBe('Spend warning')
    expect(headers['Priority']).toBe('4')
    expect(headers['Tags']).toBe('warning,money')
    expect(init.body).toBe('80% of daily cap')
  })

  it('returns false on non-2xx without throwing', async () => {
    process.env['NTFY_TOPIC'] = 'hub-test'
    _resetEnvCache()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('nope', { status: 500 }))
    const ok = await publishNtfy({ message: 'x' }, fetchMock)
    expect(ok).toBe(false)
  })

  it('returns false on transport error without throwing', async () => {
    process.env['NTFY_TOPIC'] = 'hub-test'
    _resetEnvCache()
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('network down')
    })
    const ok = await publishNtfy({ message: 'x' }, fetchMock)
    expect(ok).toBe(false)
  })
})
