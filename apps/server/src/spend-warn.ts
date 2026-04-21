import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadEnv, getLogger, publishNtfy } from '@hub/shared'
import { getSpendState, type SpendState } from '@hub/db'

const log = getLogger('spend-warn')

/**
 * Fraction of the daily cap at which the warning fires. 0.8 = 80%. Kept as a
 * module const (not env) because the roadmap acceptance criterion pins it:
 * "Spend = 80% fires exactly one ntfy per window; 100% still hard-stops."
 */
export const SPEND_WARN_THRESHOLD = 0.8

/**
 * Resolve the per-day marker file path under `data/`. Marker presence =
 * "we've already sent today's warning". Cheaper + simpler than a DB row,
 * and survives server restarts within the same calendar day.
 */
function markerPathFor(dateKey: string): string {
  const env = loadEnv()
  // HUB_DB_PATH lives in data/hub.db; derive the parent dir once.
  const dataDir = dirname(env.HUB_DB_PATH) || './data'
  return join(dataDir, `.spend-warning-${dateKey}.flag`)
}

export interface SpendWarnResult {
  /** Whether a fresh ntfy was published on this call. */
  sent: boolean
  /** `skipped` reason when `sent === false`: `'no-cap' | 'below-threshold' | 'already-sent' | 'ntfy-disabled' | 'publish-failed'`. */
  reason:
    | 'sent'
    | 'no-cap'
    | 'below-threshold'
    | 'already-sent'
    | 'ntfy-disabled'
    | 'publish-failed'
  state: SpendState
}

/**
 * Check today's spend against the cap and fire a single ntfy per day when
 * we cross `SPEND_WARN_THRESHOLD` (default 80%). The 100% hard stop lives
 * in the router (rule 3) and is unaffected by this task.
 *
 * Idempotent: a marker file under `data/` records that the day's warning
 * fired, so the 15-minute cron doesn't spam notifications. Delete the
 * marker to re-arm the warning for manual testing.
 */
export async function checkAndWarnSpend(): Promise<SpendWarnResult> {
  const env = loadEnv()
  const state = await getSpendState()

  if (state.cap <= 0) return { sent: false, reason: 'no-cap', state }
  if (state.ratio < SPEND_WARN_THRESHOLD) {
    return { sent: false, reason: 'below-threshold', state }
  }

  const marker = markerPathFor(state.dateKey)
  if (existsSync(marker)) {
    return { sent: false, reason: 'already-sent', state }
  }

  if (!env.NTFY_TOPIC) {
    // Still write the marker: without ntfy there's no channel to warn on,
    // but we log once and move on so each cron tick doesn't re-log.
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, new Date().toISOString(), 'utf8')
    log.warn(
      { dateKey: state.dateKey, spent: state.spent, cap: state.cap, ratio: state.ratio },
      'spend ≥80% but NTFY_TOPIC unset; skipping notification',
    )
    return { sent: false, reason: 'ntfy-disabled', state }
  }

  const percentTxt = `${Math.round(state.ratio * 100)}%`
  const ok = await publishNtfy({
    title: `Hub spend ${percentTxt} of daily cap`,
    message: `Spent $${state.spent.toFixed(2)} of $${state.cap.toFixed(2)} today (${state.dateKey}). The router will downgrade cloud routes to local fallback once 100% is reached.`,
    priority: 4,
    tags: ['warning', 'moneybag'],
  })

  if (!ok) return { sent: false, reason: 'publish-failed', state }

  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, new Date().toISOString(), 'utf8')
  log.info({ dateKey: state.dateKey, spent: state.spent, cap: state.cap }, 'spend warning sent')
  return { sent: true, reason: 'sent', state }
}
