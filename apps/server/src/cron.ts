import cron, { type ScheduledTask } from 'node-cron'
import { loadEnv, getLogger, notify } from '@hub/shared'
import { runBrief } from '@hub/agent-runtime/brief'
import { checkAndWarnSpend } from './spend-warn.js'

const log = getLogger('cron')

const jobs: ScheduledTask[] = []

/**
 * Wire the brief scheduler. Runs four brief jobs plus a spend-warning
 * poller, all in HUB_TIMEZONE:
 *
 *   05:00 — morning brief (what's on deck today)
 *   22:00 — nightly brief (what got done, what's tomorrow)
 *   Fri 17:00 — week retro (summary + what carries forward)
 *   Sun 18:00 — week planning (top three for the coming week)
 *   every 15 min — spend 80% pre-warning via ntfy (idempotent per day)
 *
 * Each brief job calls runBrief() which is idempotent per-date: if the
 * briefing row already exists and --regenerate is not set, it returns the
 * cached path. That makes it safe to re-enable the service mid-day without
 * duplicating work. The spend-warn task uses a marker file under `data/` so
 * it fires at most once per calendar day.
 */
export function startScheduler(): void {
  const env = loadEnv()
  if (env.HUB_BRIEF_ENABLED !== '1') {
    log.info('HUB_BRIEF_ENABLED=0; scheduler not started')
    return
  }

  const tz = env.HUB_TIMEZONE

  jobs.push(
    cron.schedule('0 5 * * *', () => runSafe('morning-brief'), { timezone: tz }),
    cron.schedule('0 22 * * *', () => runSafe('nightly-brief'), { timezone: tz }),
    cron.schedule('0 17 * * 5', () => runSafe('week-retro'), { timezone: tz }),
    cron.schedule('0 18 * * 0', () => runSafe('week-planning'), { timezone: tz }),
    cron.schedule('*/15 * * * *', () => runSpendWarn(), { timezone: tz }),
  )

  log.info({ timezone: tz, jobCount: jobs.length }, 'scheduler started')

  // Register prompt cron jobs (fire-and-forget — avoids making startScheduler async)
  import('@hub/prompts/schedule')
    .then(({ registerScheduledPromptJobs }) => registerScheduledPromptJobs())
    .catch((err: unknown) => log.error({ err: String(err) }, 'prompt schedule init failed'))
}

export function stopScheduler(): void {
  for (const j of jobs) j.stop()
  jobs.length = 0
  log.info('scheduler stopped')
}

async function runSafe(label: string): Promise<void> {
  log.info({ job: label }, 'cron trigger')
  try {
    const r = await runBrief({ regenerate: label !== 'nightly-brief' ? false : true })
    log.info(
      { job: label, date: r.date, runId: r.runId, status: r.status, cached: r.cached },
      'cron brief complete',
    )
    if (r.status === 'error') {
      await notify({
        title: `hub: ${label} errored`,
        body: `runId ${r.runId} for ${r.date} returned status=error`,
        priority: 'high',
        tags: ['warning', 'hub'],
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ job: label, err: msg }, 'cron brief failed')
    await notify({
      title: `hub: ${label} threw`,
      body: msg,
      priority: 'high',
      tags: ['rotating_light', 'hub'],
    })
  }
}

async function runSpendWarn(): Promise<void> {
  try {
    const r = await checkAndWarnSpend()
    if (r.sent) {
      log.info(
        { dateKey: r.state.dateKey, spent: r.state.spent, cap: r.state.cap },
        'spend-warn cron fired',
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ err: msg }, 'spend-warn cron failed')
  }
}
