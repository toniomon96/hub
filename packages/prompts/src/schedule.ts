import cron, { type ScheduledTask } from 'node-cron'
import { getDb } from '@hub/db'
import { promptTargets } from '@hub/db/schema'
import { loadEnv, getLogger } from '@hub/shared'
import { dispatchPromptRun } from './dispatcher.js'

const log = getLogger('prompt-schedule')

// Module-level map of cron expression → registered job handle.
// Re-registration tears down old handles first.
const scheduledJobs = new Map<string, ScheduledTask>()

/**
 * Register node-cron jobs for all enabled prompt targets with a 'cron:...' trigger.
 *
 * Groups targets by cron expression to avoid duplicate jobs for the same schedule.
 * Safe to call multiple times — clears existing jobs before re-registering.
 * Called on server startup and after every sync.
 */
export async function registerScheduledPromptJobs(): Promise<void> {
  const env = loadEnv()
  const db = getDb()

  // Tear down existing scheduled prompt jobs
  for (const [expr, task] of scheduledJobs) {
    task.stop()
    log.info({ expr }, 'stopped prompt schedule job')
  }
  scheduledJobs.clear()

  // Query all enabled cron targets
  const allTargets = await db.select().from(promptTargets).all()
  const cronTargets = allTargets.filter((t) => t.trigger.startsWith('cron:') && t.enabled === 1)

  if (cronTargets.length === 0) {
    log.info('no scheduled prompt targets configured')
    return
  }

  // Group by cron expression
  const byExpr = new Map<string, typeof cronTargets>()
  for (const t of cronTargets) {
    const expr = t.trigger.slice('cron:'.length)
    if (!cron.validate(expr)) {
      log.warn({ trigger: t.trigger, promptId: t.promptId }, 'invalid cron expression, skipping')
      continue
    }
    const group = byExpr.get(expr) ?? []
    group.push(t)
    byExpr.set(expr, group)
  }

  const tz = env.HUB_TIMEZONE
  for (const [expr, group] of byExpr) {
    const task = cron.schedule(
      expr,
      () => {
        log.info({ expr, targetCount: group.length }, 'cron prompt jobs firing')
        for (const t of group) {
          dispatchPromptRun({
            targetId: t.id,
            trigger: 'scheduled',
          })
            .then((result) => {
              log.info(
                { promptId: t.promptId, repo: t.repo, runId: result.runId },
                'cron prompt dispatch complete',
              )
            })
            .catch((err: unknown) => {
              log.error(
                { promptId: t.promptId, repo: t.repo, err: String(err) },
                'cron prompt dispatch failed',
              )
            })
        }
      },
      { timezone: tz },
    )
    scheduledJobs.set(expr, task)
    log.info({ expr, jobCount: group.length, tz }, 'prompt schedule registered')
  }

  log.info({ expressionCount: scheduledJobs.size }, 'prompt scheduler ready')
}

/** Return current registered schedule for debugging (hub prompt schedule). */
export function getScheduledJobs(): ReadonlyMap<string, ScheduledTask> {
  return scheduledJobs
}
