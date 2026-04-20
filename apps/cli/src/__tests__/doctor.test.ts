import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hub-doctor-'))
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_DB_PATH'] = join(tmp, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmp, 'logs')
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  // Force a non-routable host so the ollama check fails fast (1.5s timeout)
  process.env['OLLAMA_BASE_URL'] = 'http://127.0.0.1:1'
})

afterEach(async () => {
  const { _resetEnvCache } = await import('@hub/shared')
  _resetEnvCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('doctor', () => {
  it('reports ok=true when required checks pass and only optional ones fail', async () => {
    const { _resetEnvCache } = await import('@hub/shared')
    _resetEnvCache()
    const { runDoctor } = await import('../doctor.js')
    const { results, ok } = await runDoctor()

    const node = results.find((r) => r.name === 'node version')
    const sqlite = results.find((r) => r.name === 'node:sqlite builtin')
    const env = results.find((r) => r.name === 'env (.env + zod)')
    const log = results.find((r) => r.name === 'log dir')
    const dbFile = results.find((r) => r.name === 'db file')
    const ollama = results.find((r) => r.name === 'ollama')

    expect(node?.status).toBe('ok')
    expect(sqlite?.status).toBe('ok')
    expect(env?.status).toBe('ok')
    expect(log?.status).toBe('ok')
    expect(dbFile?.status).toBe('ok')
    // Ollama unreachable -> fail, but optional, so overall still ok
    expect(ollama?.status).toBe('fail')
    expect(ollama?.required).toBe(false)
    expect(ok).toBe(true)
  })

  it('reports ok=false when env is invalid', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    const { _resetEnvCache } = await import('@hub/shared')
    _resetEnvCache()
    const { runDoctor } = await import('../doctor.js')
    const { results, ok } = await runDoctor()
    expect(ok).toBe(false)
    const env = results.find((r) => r.name === 'env (.env + zod)')
    expect(env?.status).toBe('fail')
  })
})
