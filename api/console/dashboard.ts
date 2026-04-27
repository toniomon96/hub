import { requireHubAuth } from '../_lib/auth'
import { countOutreachThisWeek, loadOperationalData } from '../_lib/console-store'
import { json } from '../_lib/http'
import { loadPlaybookDashboardBase } from '../_lib/playbook'

export async function GET(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError

  try {
    const [base, ops] = await Promise.all([loadPlaybookDashboardBase(), loadOperationalData()])
    const sentThisWeek = ops.configured
      ? countOutreachThisWeek(ops.outreach, base.weekly.weekOf)
      : base.legacyOutreach.sentThisWeek
    const openTodos = ops.todos.filter((todo) => todo.status === 'open').length
    const inboundNew = ops.intake.filter((submission) => submission.status === 'new').length

    return json({
      source: {
        ...base.source,
        warnings: [...base.source.warnings, ...ops.warnings],
      },
      stats: [
        {
          label: 'open todos',
          value: String(openTodos),
          subtext:
            openTodos === 0
              ? 'clear board - choose the next business action'
              : 'live actions from Supabase',
          tone: openTodos === 0 ? 'empty' : 'warn',
        },
        {
          label: 'weekly dms',
          value: `${sentThisWeek} / 3`,
          subtext: sentThisWeek >= 3 ? 'weekly outreach target hit' : 'send the three referral DMs',
          tone: sentThisWeek >= 3 ? 'ok' : 'warn',
        },
        {
          label: 'inbound',
          value: String(inboundNew),
          subtext: inboundNew === 0 ? 'no inbound yet - send the dms' : 'new intake submissions',
          tone: inboundNew === 0 ? 'empty' : 'ok',
        },
        {
          label: 'capacity',
          value: `${base.pipeline.activeEngagements} / 5`,
          subtext:
            base.pipeline.activeEngagements === 0
              ? 'no active engagements - first audit lands here'
              : 'active engagement points',
          tone:
            base.pipeline.activeEngagements === 0
              ? 'empty'
              : base.pipeline.activeEngagements >= 5
                ? 'warn'
                : 'ok',
        },
      ],
      weekly: base.weekly,
      todos: {
        rows: ops.todos,
        openCount: openTodos,
        completedThisWeek: ops.todos.filter((todo) => todo.status === 'done').length,
        configured: ops.configured,
        emptyMessage: ops.configured
          ? 'no todos yet - add the next concrete business action'
          : 'configure Supabase to manage todos from the console',
        sourcePath: 'supabase.admin_todos',
      },
      outreach: {
        rows: ops.configured ? ops.outreach : base.legacyOutreach.rows,
        sentThisWeek,
        target: 3,
        configured: ops.configured,
        emptyMessage: ops.configured
          ? 'no outreach logged yet - send the three referral DMs'
          : 'configure Supabase to log outreach from the console',
        sourcePath: ops.configured ? 'supabase.outreach_events' : base.legacyOutreach.sourcePath,
      },
      intake: {
        rows: ops.intake,
        newCount: inboundNew,
        configured: ops.configured,
        emptyMessage: ops.configured
          ? 'no inbound yet - send the dms'
          : 'configure Supabase to capture consulting intake submissions',
        sourcePath: 'supabase.intake_submissions',
      },
      pipeline: base.pipeline,
      proofArtifacts: base.proofArtifacts,
      roadmap: base.roadmap,
    })
  } catch (error) {
    return json(
      { error: 'console_dashboard_failed', message: errorMessage(error) },
      { status: 500 },
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
