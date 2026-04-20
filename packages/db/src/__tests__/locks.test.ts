import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetEnvCache } from '@hub/shared'

let tmpDir: string

/**
 * Set HUB_DB_PATH to a fresh tmp file, clear env cache, clear getDb() module
 * cache (via dynamic import after vi.resetModules), and apply migrations.
 *
 * Returns fresh module exports bound to the new DB.
 */
async function freshDb() {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-locks-test-'))
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(tmpDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(tmpDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  _resetEnvCache()

  // Force a fresh module instance so the cached singleton in client.ts
  // doesn't bleed from a prior test using a different DB path.
  const { closeDb } = await import('../client.js')
  closeDb()

  const { migrate } = await import('../migrate.js')
  migrate()

  return import('../locks.js')
}

describe('locks', () => {
  beforeEach(() => {
    delete process.env['HUB_DB_PATH']
  })

  afterEach(async () => {
    const { closeDb } = await import('../client.js')
    closeDb()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('acquires a lease when none is held', async () => {
    const { tryAcquireLease } = await freshDb()
    const lease = tryAcquireLease('briefing')
    expect(lease).not.toBeNull()
    expect(lease!.agentName).toBe('briefing')
    expect(lease!.pid).toBe(process.pid)
    expect(lease!.leaseUntil).toBeGreaterThan(Date.now())
  })

  it('blocks a second acquire while a live lease is held by another pid', async () => {
    const { tryAcquireLease } = await freshDb()
    const { getRawDb } = await import('../client.js')
    const raw = getRawDb()

    // Simulate a live lease held by a foreign pid.
    raw
      .prepare(
        `INSERT INTO agent_locks (agent_name, pid, acquired_at, lease_until, holder_hostname)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('briefing', 99999, Date.now(), Date.now() + 60_000, 'other-host')

    expect(tryAcquireLease('briefing')).toBeNull()
  })

  it('auto-evicts a stale (expired) lease and acquires', async () => {
    const { tryAcquireLease } = await freshDb()
    const { getRawDb } = await import('../client.js')
    const raw = getRawDb()

    // Stale lease: lease_until in the past.
    raw
      .prepare(
        `INSERT INTO agent_locks (agent_name, pid, acquired_at, lease_until, holder_hostname)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('classifier', 12345, Date.now() - 10_000, Date.now() - 1_000, 'dead-host')

    const lease = tryAcquireLease('classifier')
    expect(lease).not.toBeNull()
    expect(lease!.pid).toBe(process.pid)
  })

  it('release() frees the lease so another caller can acquire', async () => {
    const { tryAcquireLease } = await freshDb()
    const first = tryAcquireLease('capture-flush')
    expect(first).not.toBeNull()
    first!.release()

    // After release, even a foreign-pid acquire (simulated by re-running) wins.
    const { getRawDb } = await import('../client.js')
    const row = getRawDb()
      .prepare('SELECT pid FROM agent_locks WHERE agent_name = ?')
      .get('capture-flush')
    expect(row).toBeUndefined()

    const second = tryAcquireLease('capture-flush')
    expect(second).not.toBeNull()
  })

  it('different agent names do not contend', async () => {
    const { tryAcquireLease } = await freshDb()
    const a = tryAcquireLease('agent-a')
    const b = tryAcquireLease('agent-b')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
  })

  it('withLease runs fn and releases on success', async () => {
    const { withLease, tryAcquireLease } = await freshDb()
    let ran = false
    const result = await withLease('nightly', async () => {
      ran = true
      return 42
    })
    expect(ran).toBe(true)
    expect(result).toBe(42)

    // Lease released → re-acquire works.
    expect(tryAcquireLease('nightly')).not.toBeNull()
  })

  it('withLease releases on thrown error', async () => {
    const { withLease, tryAcquireLease } = await freshDb()
    await expect(
      withLease('nightly', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    expect(tryAcquireLease('nightly')).not.toBeNull()
  })

  it('withLease returns null when lease is busy', async () => {
    const { withLease } = await freshDb()
    const { getRawDb } = await import('../client.js')
    getRawDb()
      .prepare(
        `INSERT INTO agent_locks (agent_name, pid, acquired_at, lease_until, holder_hostname)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('busy-agent', 99999, Date.now(), Date.now() + 60_000, 'other')

    let ran = false
    const result = await withLease('busy-agent', async () => {
      ran = true
      return 'should-not-run'
    })
    expect(ran).toBe(false)
    expect(result).toBeNull()
  })
})
