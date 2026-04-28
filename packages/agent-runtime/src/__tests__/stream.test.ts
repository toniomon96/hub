import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'
import type { RunStreamEvent } from '../stream.js'

/**
 * Drive runStream() through a mocked Ollama path (no network, no SDK).
 * Asserts event ordering (meta → token* → final) and the abort contract.
 */

const ollamaChunks: Array<{
  text?: string
  usage?: { prompt_tokens: number; completion_tokens: number }
}> = []
let lastCreateArgs:
  | {
      model: string
      messages: Array<{ role: 'system' | 'user'; content: string }>
      temperature: number
      stream: true
    }
  | undefined

vi.mock('@hub/models/ollama', () => ({
  getOllamaClient: () => ({
    chat: {
      completions: {
        create: vi.fn(async (args) => {
          lastCreateArgs = args as typeof lastCreateArgs
          async function* gen() {
            for (const c of ollamaChunks) {
              const chunk: Record<string, unknown> = {
                choices: [{ delta: c.text ? { content: c.text } : {} }],
              }
              if (c.usage) chunk.usage = c.usage
              yield chunk
            }
          }
          return gen()
        }),
      },
    },
  }),
}))

// Force the router into Ollama so we never touch the SDK import path.
vi.mock('@hub/models/router', () => ({
  route: vi.fn(() => ({
    spec: { provider: 'ollama', model: 'phi4-mini', reason: 'test-forced' },
    triage: { sensitivity: 'high', complexity: 'trivial', localOnly: true },
  })),
}))

let tmpDir: string

async function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-stream-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_TIMEZONE'] = 'UTC'
  _resetEnvCache()

  const { closeDb, migrate } = await import('@hub/db')
  closeDb()
  migrate()

  return import('../stream.js')
}

describe('runStream (Ollama path)', () => {
  beforeEach(() => {
    ollamaChunks.length = 0
    lastCreateArgs = undefined
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('emits meta → token* → final in order with accumulated output', async () => {
    ollamaChunks.push(
      { text: 'Hello' },
      { text: ', ' },
      { text: 'world!' },
      { usage: { prompt_tokens: 5, completion_tokens: 3 } },
    )
    const { runStream } = await setup()
    const events: RunStreamEvent[] = []
    for await (const ev of runStream(
      { input: 'hi', source: 'cli', forceLocal: false },
      { agentName: 't' },
    )) {
      events.push(ev)
    }
    expect(events[0]!.type).toBe('meta')
    expect(
      events.filter((e) => e.type === 'token').map((e) => (e.type === 'token' ? e.text : '')),
    ).toEqual(['Hello', ', ', 'world!'])
    const last = events[events.length - 1]!
    expect(last.type).toBe('final')
    if (last.type === 'final') {
      expect(last.output).toBe('Hello, world!')
      expect(last.status).toBe('success')
      expect(last.inputTokens).toBe(5)
      expect(last.outputTokens).toBe(3)
      expect(last.modelUsed).toBe('ollama:phi4-mini')
    }
  })

  it('aborts mid-stream: finalizes partial + emits error with message=aborted', async () => {
    ollamaChunks.push({ text: 'one' }, { text: 'two' }, { text: 'three' })
    const { runStream } = await setup()
    const ctrl = new AbortController()
    const events: RunStreamEvent[] = []
    for await (const ev of runStream(
      { input: 'hi', source: 'cli', forceLocal: false },
      { agentName: 't', signal: ctrl.signal },
    )) {
      events.push(ev)
      if (ev.type === 'token' && ev.text === 'one') ctrl.abort()
    }
    const last = events[events.length - 1]!
    expect(last.type).toBe('error')
    if (last.type === 'error') expect(last.message).toBe('aborted')
    // Confirm the run row was finalized as partial.
    const { getDb } = await import('@hub/db')
    const { runs } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const meta = events.find((e) => e.type === 'meta')!
    if (meta.type !== 'meta') throw new Error('expected meta')
    const row = await getDb().select().from(runs).where(eq(runs.id, meta.runId)).get()
    expect(row?.status).toBe('partial')
    expect(row?.errorMessage).toBe('aborted')
  })

  it('composes the same constitutional system prompt for streaming runs', async () => {
    ollamaChunks.push({ text: 'ok' })
    const { runStream } = await setup()
    for await (const ev of runStream(
      { input: 'hi', source: 'cli', forceLocal: false },
      { agentName: 't', systemPrompt: 'Task-specific instruction.' },
    )) {
      void ev
    }

    const system = lastCreateArgs?.messages[0]
    expect(system?.role).toBe('system')
    expect(system?.content).toContain("You are Toni Montez's personal operating system")
    expect(system?.content).toContain('Task-specific instruction.')
  }, 30000)

  it('records a blocked R3 streaming run during quiet hours', async () => {
    process.env['HUB_QUIET_HOURS'] = '00-23'
    _resetEnvCache()
    const { runStream } = await setup()
    const events: RunStreamEvent[] = []
    for await (const ev of runStream(
      { input: 'ship it', source: 'cli', forceLocal: false },
      { agentName: 't', permissionTier: 'R3' },
    )) {
      events.push(ev)
    }

    expect(events.map((e) => e.type)).toEqual(['meta', 'error'])
    const meta = events[0]
    expect(meta?.type).toBe('meta')
    if (meta?.type !== 'meta') throw new Error('expected meta')

    const { getDb } = await import('@hub/db')
    const { runs } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(runs).where(eq(runs.id, meta.runId)).get()
    expect(row?.status).toBe('error')
    expect(row?.errorMessage).toBe('quiet_hours_blocked')
    expect(row?.modelUsed).toBe('blocked:quiet-hours')
  })
})
