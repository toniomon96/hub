import { recordCronRun, type CronJobName } from '../_lib/hub-cloud-store'
import { json } from '../_lib/http'

const JOBS = new Set<CronJobName>([
  'morning-brief',
  'nightly-brief',
  'week-retro',
  'week-planning',
  'spend-warning',
  'prompt-schedules',
  'weekly-export',
])

export async function GET(request: Request): Promise<Response> {
  const secretError = requireCronSecret(request)
  if (secretError) return secretError

  const job = parseJob(request)
  if (!job) return json({ error: 'unknown_cron_job' }, { status: 404 })

  try {
    const row = await recordCronRun(job)
    return json({
      ok: true,
      job,
      row,
      note:
        job === 'spend-warning'
          ? 'Spend-warning bookkeeping is registered in Vercel/Supabase.'
          : 'This cloud cron is registered; actual local-only work waits for the local worker.',
    })
  } catch (error) {
    return json(
      {
        error: 'cron_run_failed',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

function requireCronSecret(request: Request): Response | null {
  const expected = process.env['CRON_SECRET']
  if (!expected) return json({ error: 'cron_secret_not_configured' }, { status: 503 })

  const auth = request.headers.get('authorization') ?? ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  const header = request.headers.get('x-cron-secret') ?? ''
  const query = new URL(request.url).searchParams.get('secret') ?? ''
  if (bearer === expected || header === expected || query === expected) return null
  return json({ error: 'unauthorized' }, { status: 401 })
}

function parseJob(request: Request): CronJobName | null {
  const part = new URL(request.url).pathname.split('/').filter(Boolean).at(-1)
  return part && JOBS.has(part as CronJobName) ? (part as CronJobName) : null
}
