import { getDb } from './client.js'
import { runs } from './schema.js'
import { and, gte, lt, sql } from 'drizzle-orm'
import { loadEnv } from '@hub/shared'

/**
 * Sum of `runs.cost_usd` for runs started today in the configured timezone.
 * Used by the router's cost ceiling. Returns 0 if no runs or on error —
 * spend tracking must never block a route decision.
 */
export async function getTodaySpendUsd(): Promise<number> {
  try {
    const { start, end } = todayBoundsMs()
    const db = getDb()
    const row = await db
      .select({ total: sql<number>`COALESCE(SUM(${runs.costUsd}), 0)` })
      .from(runs)
      .where(and(gte(runs.startedAt, start), lt(runs.startedAt, end)))
      .get()
    return row?.total ?? 0
  } catch {
    return 0
  }
}

/**
 * [start, end) unix-ms bounds for "today" in `HUB_TIMEZONE`.
 * Uses Intl to resolve the TZ offset without a tz database dep.
 */
function todayBoundsMs(): { start: number; end: number } {
  const env = loadEnv()
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.HUB_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const y = get('year')
  const m = get('month')
  const d = get('day')
  const hh = get('hour')
  const mm = get('minute')
  const ss = get('second')

  // Offset between "wall-clock in TZ" and UTC, in ms.
  const wallMs = Date.UTC(y, m - 1, d, hh, mm, ss)
  const offsetMs = wallMs - (now.getTime() - (now.getTime() % 1000))

  const startUtcMs = Date.UTC(y, m - 1, d) - offsetMs
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000
  return { start: startUtcMs, end: endUtcMs }
}
