/**
 * In-process sliding-window rate limiter for /auth/login.
 *
 * Two windows enforced simultaneously per client key:
 *   - short: SHORT_MAX requests per SHORT_MS
 *   - long:  LONG_MAX requests per LONG_MS
 *
 * First limit exceeded wins. Counts only FAILED attempts (success clears the
 * client's history), so the correct-password path is never rate-limited.
 *
 * Deliberately in-memory and process-local. Hub is a single-process server;
 * adding Redis for this would be over-engineering. Restart clears the limiter,
 * which is fine — attackers racing a hub restart were not going to get far
 * against the underlying timing-safe token compare anyway.
 */

const SHORT_MS = 60_000
const SHORT_MAX = 5
const LONG_MS = 3_600_000
const LONG_MAX = 20

interface Entry {
  attempts: number[] // unix ms timestamps, ascending
}

const buckets = new Map<string, Entry>()

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec: number
  remainingShort: number
  remainingLong: number
}

function prune(entry: Entry, now: number): void {
  const cutoff = now - LONG_MS
  while (entry.attempts.length > 0 && entry.attempts[0]! < cutoff) {
    entry.attempts.shift()
  }
}

/** Record a failed attempt and return whether the NEXT attempt is allowed. */
export function recordFailure(key: string, now = Date.now()): RateLimitResult {
  let entry = buckets.get(key)
  if (!entry) {
    entry = { attempts: [] }
    buckets.set(key, entry)
  }
  entry.attempts.push(now)
  prune(entry, now)
  return check(key, now)
}

/** Check without recording. */
export function check(key: string, now = Date.now()): RateLimitResult {
  const entry = buckets.get(key)
  if (!entry || entry.attempts.length === 0) {
    return { allowed: true, retryAfterSec: 0, remainingShort: SHORT_MAX, remainingLong: LONG_MAX }
  }
  prune(entry, now)

  const shortSince = now - SHORT_MS
  const longCount = entry.attempts.length
  const shortCount = entry.attempts.filter((t) => t >= shortSince).length

  if (shortCount >= SHORT_MAX) {
    const oldest = entry.attempts.find((t) => t >= shortSince)!
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + SHORT_MS - now) / 1000)),
      remainingShort: 0,
      remainingLong: Math.max(0, LONG_MAX - longCount),
    }
  }
  if (longCount >= LONG_MAX) {
    const oldest = entry.attempts[0]!
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + LONG_MS - now) / 1000)),
      remainingShort: Math.max(0, SHORT_MAX - shortCount),
      remainingLong: 0,
    }
  }
  return {
    allowed: true,
    retryAfterSec: 0,
    remainingShort: SHORT_MAX - shortCount,
    remainingLong: LONG_MAX - longCount,
  }
}

/** Clear a key's history (call on successful login). */
export function clear(key: string): void {
  buckets.delete(key)
}

/** Test-only: wipe all state. */
export function _reset(): void {
  buckets.clear()
}

/**
 * Evict any bucket whose attempts are all older than LONG_MS. Prevents
 * unbounded Map growth from an attacker rotating IPs: without this, every
 * distinct client key leaks ~100 bytes forever.
 *
 * Cheap to call — O(n) over the bucket count with the per-entry prune we
 * already run on access. Returns the number of evicted keys for observability.
 */
export function sweep(now = Date.now()): number {
  let evicted = 0
  for (const [key, entry] of buckets) {
    prune(entry, now)
    if (entry.attempts.length === 0) {
      buckets.delete(key)
      evicted++
    }
  }
  return evicted
}

/**
 * Install a periodic sweeper on a hidden `setInterval`. Called from the
 * server bootstrap; noop if already installed. The interval is unref'd so
 * it never blocks process exit.
 */
let sweeperTimer: ReturnType<typeof setInterval> | undefined
export function startSweeper(intervalMs = LONG_MS): void {
  if (sweeperTimer) return
  sweeperTimer = setInterval(() => {
    sweep()
  }, intervalMs)
  sweeperTimer.unref?.()
}

export function stopSweeper(): void {
  if (sweeperTimer) {
    clearInterval(sweeperTimer)
    sweeperTimer = undefined
  }
}

/** Test-only: report current bucket count. */
export function _size(): number {
  return buckets.size
}
