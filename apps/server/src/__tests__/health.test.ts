import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

async function freshEnv(overrides: Record<string, string | undefined> = {}) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-health-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = tmpdir()
  process.env['HUB_LOG_LEVEL'] = 'fatal'
  process.env['HUB_SKIP_DOTENV'] = '1'
  // Point Ollama at a guaranteed-closed port so the check fails fast.
  process.env['OLLAMA_BASE_URL'] = 'http://127.0.0.1:1'
  delete process.env['OBSIDIAN_VAULT_PATH']
  delete process.env['HUB_BACKUP_DIR']
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  _resetEnvCache()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db')
  migrate()

  return import('../health.js')
}

describe('runHealthCheck', () => {
  beforeEach(() => {
    delete process.env['HUB_DB_PATH']
  })

  afterEach(async () => {
    const { closeDb } = await import('@hub/db')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('db check passes when SQLite is reachable', async () => {
    const { runHealthCheck } = await freshEnv()
    const r = await runHealthCheck()
    const db = r.checks.find((c) => c.name === 'db')
    expect(db).toBeDefined()
    expect(db!.ok).toBe(true)
  })

  it('vault check is ok=true when OBSIDIAN_VAULT_PATH is unset', async () => {
    const { runHealthCheck } = await freshEnv()
    const r = await runHealthCheck()
    const vault = r.checks.find((c) => c.name === 'vault')!
    expect(vault.ok).toBe(true)
    expect(vault.detail).toContain('not configured')
  })

  it('vault check fails when configured path does not exist', async () => {
    const { runHealthCheck } = await freshEnv({
      OBSIDIAN_VAULT_PATH: join(tmpdir(), 'hub-nonexistent-vault-xyz-123'),
    })
    const r = await runHealthCheck()
    const vault = r.checks.find((c) => c.name === 'vault')!
    expect(vault.ok).toBe(false)
  })

  it('vault check passes when path exists and is writable', async () => {
    const vault = join(tmpDir, 'vault')
    mkdirSync(vault, { recursive: true })
    const { runHealthCheck } = await freshEnv({ OBSIDIAN_VAULT_PATH: vault })
    const r = await runHealthCheck()
    const v = r.checks.find((c) => c.name === 'vault')!
    expect(v.ok).toBe(true)
  })

  it('backup check is ok when HUB_BACKUP_DIR is unset', async () => {
    const { runHealthCheck } = await freshEnv()
    const r = await runHealthCheck()
    const b = r.checks.find((c) => c.name === 'backup')!
    expect(b.ok).toBe(true)
  })

  it('backup check fails when dir exists but has no .db files', async () => {
    const backupDir = join(tmpDir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    const { runHealthCheck } = await freshEnv({ HUB_BACKUP_DIR: backupDir })
    const r = await runHealthCheck()
    const b = r.checks.find((c) => c.name === 'backup')!
    expect(b.ok).toBe(false)
    expect(b.detail).toContain('no backups')
  })

  it('backup check fails when newest backup is older than threshold', async () => {
    const backupDir = join(tmpDir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    const oldFile = join(backupDir, '2024-01-01.db')
    writeFileSync(oldFile, 'x')
    // Set mtime to 48h ago.
    const old = (Date.now() - 48 * 3600 * 1000) / 1000
    utimesSync(oldFile, old, old)

    const { runHealthCheck } = await freshEnv({
      HUB_BACKUP_DIR: backupDir,
      HUB_BACKUP_MAX_AGE_H: '26',
    })
    const r = await runHealthCheck()
    const b = r.checks.find((c) => c.name === 'backup')!
    expect(b.ok).toBe(false)
    expect(b.detail).toMatch(/48|47/) // roughly 48h old
  })

  it('backup check passes when newest backup is fresh', async () => {
    const backupDir = join(tmpDir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(join(backupDir, 'latest.db'), 'x')

    const { runHealthCheck } = await freshEnv({ HUB_BACKUP_DIR: backupDir })
    const r = await runHealthCheck()
    const b = r.checks.find((c) => c.name === 'backup')!
    expect(b.ok).toBe(true)
  })

  it('overall ok=false when any check fails', async () => {
    // Ollama points at :1 (closed), so that check fails → overall ok=false.
    const { runHealthCheck } = await freshEnv()
    const r = await runHealthCheck()
    expect(r.ok).toBe(false)
    expect(r.service).toBe('hub')
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
