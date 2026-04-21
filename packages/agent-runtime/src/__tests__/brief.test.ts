import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string
let vaultDir: string

// Mock the agent run so the brief never touches the real SDK or Ollama.
// Tests pin the output + tokens + cost deterministically.
vi.mock('../run.js', () => ({
  run: vi.fn(async (_task, opts) => ({
    runId: `run-${opts.agentName}-${Date.now()}`,
    output: `# Mock brief\n\n(fake)\n`,
    modelUsed: 'mock:mock-model',
    status: 'success' as const,
    inputTokens: 10,
    outputTokens: 20,
    costUsd: 0,
  })),
}))

async function freshEnv(overrides: Record<string, string> = {}) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-brief-test-'))
  vaultDir = join(tmpDir, 'vault')
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_TIMEZONE'] = 'UTC'
  process.env['OBSIDIAN_VAULT_PATH'] = vaultDir
  for (const [k, v] of Object.entries(overrides)) {
    if (v === '') delete process.env[k]
    else process.env[k] = v
  }
  _resetEnvCache()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db')
  migrate()

  return import('../brief.js')
}

describe('runBrief', () => {
  beforeEach(() => {
    delete process.env['OBSIDIAN_VAULT_PATH']
    delete process.env['HUB_DB_PATH']
    vi.clearAllMocks()
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('todayInTz returns YYYY-MM-DD', async () => {
    const { todayInTz } = await freshEnv()
    const s = todayInTz('UTC')
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('writes the brief body to <vault>/Daily/<date>.md and records a briefing row', async () => {
    const { runBrief } = await freshEnv()
    const result = await runBrief({ date: '2026-04-20', localOnly: true })

    expect(result.status).toBe('success')
    expect(result.cached).toBe(false)
    expect(result.path).toBe(join(vaultDir, 'Daily', '2026-04-20.md'))
    expect(existsSync(result.path!)).toBe(true)
    expect(readFileSync(result.path!, 'utf8')).toContain('Mock brief')

    // briefings row upserted
    const { getDb } = await import('@hub/db')
    const { briefings } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(briefings).where(eq(briefings.date, '2026-04-20')).get()
    expect(row).toBeDefined()
    expect(row!.runId).toBe(result.runId)
    expect(row!.obsidianRef).toBe(result.path)
  })

  it('second call hits the cache and does NOT re-run the agent', async () => {
    const { runBrief } = await freshEnv()
    const runMod = await import('../run.js')

    const first = await runBrief({ date: '2026-04-21', localOnly: true })
    expect(first.cached).toBe(false)
    expect(runMod.run).toHaveBeenCalledTimes(1)

    const second = await runBrief({ date: '2026-04-21', localOnly: true })
    expect(second.cached).toBe(true)
    expect(second.runId).toBe(first.runId)
    expect(second.path).toBe(first.path)
    expect(runMod.run).toHaveBeenCalledTimes(1) // still 1
  })

  it('regenerate=true bypasses the cache', async () => {
    const { runBrief } = await freshEnv()
    const runMod = await import('../run.js')

    await runBrief({ date: '2026-04-22', localOnly: true })
    expect(runMod.run).toHaveBeenCalledTimes(1)

    const second = await runBrief({ date: '2026-04-22', localOnly: true, regenerate: true })
    expect(second.cached).toBe(false)
    expect(runMod.run).toHaveBeenCalledTimes(2)
  })

  it('with no OBSIDIAN_VAULT_PATH, returns path=null and does NOT record a briefing row', async () => {
    const { runBrief } = await freshEnv({ OBSIDIAN_VAULT_PATH: '' })
    const result = await runBrief({ date: '2026-04-23', localOnly: true })

    expect(result.path).toBeNull()

    const { getDb } = await import('@hub/db')
    const { briefings } = await import('@hub/db/schema')
    const { eq } = await import('drizzle-orm')
    const row = await getDb().select().from(briefings).where(eq(briefings.date, '2026-04-23')).get()
    expect(row).toBeUndefined()
  })

  it('forwards localOnly=true to the runtime with empty scopes', async () => {
    const { runBrief } = await freshEnv()
    const runMod = await import('../run.js')

    await runBrief({ date: '2026-04-24', localOnly: true })

    const call = (runMod.run as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const [task, opts] = call as [{ forceLocal: boolean }, { scopes: string[] }]
    expect(task.forceLocal).toBe(true)
    expect(opts.scopes).toEqual([])
  })
})
