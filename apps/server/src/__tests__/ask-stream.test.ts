import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { seedTestEnv, restoreTestEnv } from '@hub/shared/testing/test-env'

/**
 * SSE endpoint smoke test. Stub runStream so we don't touch the router,
 * DB, or any SDK — just verify the server wires the generator to
 * text/event-stream frames in order.
 */

vi.mock('@hub/agent-runtime', () => ({
  resolveAskPolicy: async () => ({
    mode: 'clarify',
    governorDomain: 'misc',
    authority: 'suggest',
    appliedScopes: ['knowledge'],
    deniedScopes: [],
    permissionTier: 'R0',
  }),
  runStream: async function* () {
    yield { type: 'meta', runId: 'run-test-1', modelUsed: 'ollama:phi4-mini' }
    yield { type: 'token', text: 'hello ' }
    yield { type: 'token', text: 'world' }
    yield {
      type: 'final',
      runId: 'run-test-1',
      modelUsed: 'ollama:phi4-mini',
      output: 'hello world',
      status: 'success',
      inputTokens: 5,
      outputTokens: 2,
      costUsd: 0,
    }
  },
}))

beforeEach(() => {
  seedTestEnv({
    HUB_UI_TOKEN: 'test-token',
    HUB_COOKIE_SECRET: 'test-cookie-secret-32chars-xxxxxxxxx',
  })
})
afterEach(() => {
  restoreTestEnv()
})

describe('POST /api/ask/stream', () => {
  it('emits SSE frames in order: meta → token → token → final', async () => {
    const { api } = await import('../api.js')
    const res = await api.request('/ask/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hi' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/event-stream/)

    const body = await res.text()
    // Split on blank-line frame boundary.
    const frames = body
      .split('\n\n')
      .map((f) => f.trim())
      .filter(Boolean)
    expect(frames.length).toBe(4)

    const parse = (frame: string) => {
      const ev = /^event: (\S+)/.exec(frame)?.[1] ?? ''
      const data = /data: (.+)$/m.exec(frame)?.[1] ?? '{}'
      return { event: ev, data: JSON.parse(data) as Record<string, unknown> }
    }
    const parsed = frames.map(parse)
    expect(parsed.map((p) => p.event)).toEqual(['meta', 'token', 'token', 'final'])
    expect(parsed[0]!.data.runId).toBe('run-test-1')
    expect(parsed[0]!.data.modelUsed).toBe('ollama:phi4-mini')
    expect(parsed[0]!.data.appliedMode).toBe('clarify')
    expect(parsed[0]!.data.appliedScopes).toEqual(['knowledge'])
    expect(parsed[1]!.data).toEqual({ text: 'hello ' })
    expect(parsed[2]!.data).toEqual({ text: 'world' })
    expect(parsed[3]!.data.output).toBe('hello world')
    expect(parsed[3]!.data.status).toBe('success')
    expect(parsed[3]!.data.appliedScopes).toEqual(['knowledge'])
  })

  it('returns 400 on missing input', async () => {
    const { api } = await import('../api.js')
    const res = await api.request('/ask/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
