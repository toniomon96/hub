import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as SharedModule from '@hub/shared'
import { seedTestEnv, restoreTestEnv } from '@hub/shared/testing/test-env'
import { _resetEnvCache } from '@hub/shared'

/**
 * Mock the `getSpendState` and `publishNtfy` entry points so the task can
 * be exercised without touching SQLite or the network. The marker file is
 * still written to a real tmp dir so the idempotency path is covered.
 */
const getSpendStateMock = vi.fn()
const publishNtfyMock = vi.fn()

vi.mock('@hub/db', () => ({
  getSpendState: (...args: unknown[]) => getSpendStateMock(...args),
}))

vi.mock('@hub/shared', async () => {
  const actual = await vi.importActual<typeof SharedModule>('@hub/shared')
  return {
    ...actual,
    publishNtfy: (...args: unknown[]) => publishNtfyMock(...args),
  }
})

import { checkAndWarnSpend, SPEND_WARN_THRESHOLD } from '../spend-warn.js'

let tmp: string

describe('checkAndWarnSpend', () => {
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'hub-spend-warn-'))
    seedTestEnv({
      HUB_DB_PATH: join(tmp, 'hub.db'),
      HUB_DAILY_USD_CAP: '5',
      NTFY_TOPIC: 'hub-test',
    })
    _resetEnvCache()
    getSpendStateMock.mockReset()
    publishNtfyMock.mockReset()
  })

  afterEach(() => {
    restoreTestEnv()
    _resetEnvCache()
    rmSync(tmp, { recursive: true, force: true })
  })

  function state(overrides: Partial<{ spent: number; cap: number; dateKey: string }> = {}) {
    const cap = overrides.cap ?? 5
    const spent = overrides.spent ?? 0
    return {
      dateKey: overrides.dateKey ?? '2026-04-21',
      spent,
      cap,
      ratio: cap > 0 ? spent / cap : Number.NaN,
    }
  }

  it('skips with reason=no-cap when HUB_DAILY_USD_CAP=0', async () => {
    getSpendStateMock.mockResolvedValue(state({ cap: 0, spent: 100 }))
    const r = await checkAndWarnSpend()
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('no-cap')
    expect(publishNtfyMock).not.toHaveBeenCalled()
  })

  it('skips with reason=below-threshold below 80%', async () => {
    getSpendStateMock.mockResolvedValue(state({ cap: 5, spent: 3.99 })) // 79.8%
    const r = await checkAndWarnSpend()
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('below-threshold')
    expect(publishNtfyMock).not.toHaveBeenCalled()
  })

  it('fires exactly one ntfy per day at ≥80% and writes a marker', async () => {
    getSpendStateMock.mockResolvedValue(state({ cap: 5, spent: 4 })) // 80%
    publishNtfyMock.mockResolvedValue(true)

    const first = await checkAndWarnSpend()
    expect(first.sent).toBe(true)
    expect(first.reason).toBe('sent')
    expect(publishNtfyMock).toHaveBeenCalledTimes(1)

    const marker = join(tmp, '.spend-warning-2026-04-21.flag')
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, 'utf8').length).toBeGreaterThan(0)

    const second = await checkAndWarnSpend()
    expect(second.sent).toBe(false)
    expect(second.reason).toBe('already-sent')
    expect(publishNtfyMock).toHaveBeenCalledTimes(1)
  })

  it('returns reason=publish-failed and leaves no marker when ntfy returns false', async () => {
    getSpendStateMock.mockResolvedValue(state({ cap: 5, spent: 4.5 }))
    publishNtfyMock.mockResolvedValue(false)

    const r = await checkAndWarnSpend()
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('publish-failed')
    expect(existsSync(join(tmp, '.spend-warning-2026-04-21.flag'))).toBe(false)
  })

  it('writes marker but does not publish when NTFY_TOPIC is unset', async () => {
    delete process.env['NTFY_TOPIC']
    getSpendStateMock.mockResolvedValue(state({ cap: 5, spent: 4 }))

    const r = await checkAndWarnSpend()
    expect(r.sent).toBe(false)
    expect(r.reason).toBe('ntfy-disabled')
    expect(publishNtfyMock).not.toHaveBeenCalled()
    // Marker still written so subsequent cron ticks are silent.
    expect(existsSync(join(tmp, '.spend-warning-2026-04-21.flag'))).toBe(true)
  })

  it('SPEND_WARN_THRESHOLD is pinned at 0.8 (roadmap acceptance)', () => {
    expect(SPEND_WARN_THRESHOLD).toBe(0.8)
  })
})
