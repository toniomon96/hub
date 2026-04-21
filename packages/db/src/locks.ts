import { hostname } from 'node:os'
import { getRawDb } from './client.js'
import { DEFAULT_LEASE_MS } from './schema.js'
import { getLogger } from '@hub/shared'

const log = getLogger('locks')

export interface LeaseOptions {
  /** Lease duration in ms. Default 5 min. Set to ~2× expected runtime. */
  leaseMs?: number
}

export interface Lease {
  agentName: string
  pid: number
  acquiredAt: number
  leaseUntil: number
  release: () => void
}

/**
 * Try to acquire an exclusive lease for `agentName`. Returns null if held by
 * another live process. Stale leases (past leaseUntil) are auto-evicted.
 *
 * LOAD-BEARING (v0.3): this replaces in-process mutexes for cron coordination.
 * Survives process restarts. Does NOT coordinate across machines (Routines
 * fire webhooks into the local Hub instead — see ARCHITECTURE.md §5).
 */
export function tryAcquireLease(agentName: string, opts: LeaseOptions = {}): Lease | null {
  const db = getRawDb()
  const now = Date.now()
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS
  const leaseUntil = now + leaseMs
  const pid = process.pid
  const host = hostname()

  // INSERT-or-UPDATE-if-stale. The WHERE predicate prevents stealing live leases.
  // Positional params for node:sqlite driver compatibility.
  // Raw `node:sqlite` on purpose — see DECISIONS.md (2026-04-23) for the
  // Drizzle-vs-raw-sqlite split. Single atomic statement per call, no ORM surface needed.
  const stmt = db.prepare(`
    INSERT INTO agent_locks (agent_name, pid, acquired_at, lease_until, holder_hostname)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_name) DO UPDATE SET
      pid = excluded.pid,
      acquired_at = excluded.acquired_at,
      lease_until = excluded.lease_until,
      holder_hostname = excluded.holder_hostname
    WHERE lease_until < ?
    RETURNING pid, acquired_at, lease_until
  `)
  const row = stmt.get(agentName, pid, now, leaseUntil, host, now) as
    | { pid: number; acquired_at: number; lease_until: number }
    | undefined

  // If the row's pid is ours, we acquired. Otherwise the lease is held.
  if (!row || row.pid !== pid) {
    log.debug({ agentName, holder: row?.pid }, 'lease busy')
    return null
  }

  log.info({ agentName, leaseMs, until: new Date(leaseUntil).toISOString() }, 'lease acquired')

  return {
    agentName,
    pid,
    acquiredAt: now,
    leaseUntil,
    release: () => releaseLease(agentName, pid),
  }
}

/** Release a lease we hold. No-op if the row was already taken by someone else. */
export function releaseLease(agentName: string, pid: number): void {
  const db = getRawDb()
  const stmt = db.prepare(`DELETE FROM agent_locks WHERE agent_name = ? AND pid = ?`)
  const res = stmt.run(agentName, pid) as { changes: number | bigint }
  const changes = typeof res.changes === 'bigint' ? Number(res.changes) : res.changes
  if (changes > 0) log.info({ agentName }, 'lease released')
}

/**
 * Run `fn` while holding a lease. Returns null if the lease was busy.
 * Auto-releases on completion or error.
 */
export async function withLease<T>(
  agentName: string,
  fn: () => Promise<T>,
  opts: LeaseOptions = {},
): Promise<T | null> {
  const lease = tryAcquireLease(agentName, opts)
  if (!lease) return null
  try {
    return await fn()
  } finally {
    lease.release()
  }
}
