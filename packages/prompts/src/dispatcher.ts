import { getDb, getRawDb, withLease } from '@hub/db'
import { prompts as promptsTable, promptTargets } from '@hub/db/schema'
import { eq, and } from 'drizzle-orm'
import { run } from '@hub/agent-runtime/run'
import { startRun, finishRun } from '@hub/agent-runtime/persist'
import { getLogger } from '@hub/shared'
import type { Task } from '@hub/shared'
import { Parser, type Value } from 'expr-eval'
import { handleOutputs } from './outputs.js'

const log = getLogger('dispatcher')
const exprParser = new Parser()

/**
 * when_expr evaluator uses expr-eval:
 *   - Supports arithmetic (+, -, *, /, %)
 *   - Logical: and, or, not (expr-eval uses word operators, not &&/||)
 *   - Comparison: ==, !=, <, >, <=, >=
 *   - Member access: payload.field via context variables
 *
 * Security: expr-eval never calls eval() or Function(); it builds an AST
 * and interprets it. Context variables come from trusted operator-authored
 * registry entries, not from external input.
 */

export type DispatchOpts = {
  targetId?: number
  promptId?: string
  repo?: string
  branch?: string
  args?: Record<string, unknown>
  trigger: 'scheduled' | 'event' | 'manual'
  eventPayload?: unknown
  signal?: AbortSignal
}

export async function dispatchPromptRun(opts: DispatchOpts): Promise<{ runId: string }> {
  const db = getDb()

  // Resolve prompt and target — keep the loaded target object to avoid a second round-trip.
  let resolvedPromptId: string
  let resolvedRepo: string
  let persistentTarget: (typeof promptTargets)['$inferSelect'] | undefined

  if (opts.targetId !== undefined) {
    const target = await db
      .select()
      .from(promptTargets)
      .where(eq(promptTargets.id, opts.targetId))
      .get()
    if (!target) {
      throw new Error(`Prompt target ${opts.targetId} not found`)
    }
    resolvedPromptId = target.promptId
    resolvedRepo = opts.repo ?? target.repo
    persistentTarget = target
  } else if (opts.promptId && opts.repo) {
    resolvedPromptId = opts.promptId
    resolvedRepo = opts.repo
    // Try to find a matching persistent target (optional)
    persistentTarget = await db
      .select()
      .from(promptTargets)
      .where(and(eq(promptTargets.promptId, opts.promptId), eq(promptTargets.repo, opts.repo)))
      .get()
  } else {
    throw new Error('dispatchPromptRun requires either targetId or both promptId and repo')
  }

  const prompt = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, resolvedPromptId))
    .get()

  if (!prompt) {
    throw new Error(`Prompt "${resolvedPromptId}" not found`)
  }

  // Evaluate when_expr if present
  if (persistentTarget?.whenExpr) {
    const eventPayload =
      opts.eventPayload !== null && typeof opts.eventPayload === 'object'
        ? (opts.eventPayload as Record<string, unknown>)
        : {}
    const context: Record<string, unknown> = {
      ...eventPayload,
      repo: resolvedRepo,
      ...opts.args,
    }
    let result: unknown
    try {
      result = exprParser.evaluate(persistentTarget.whenExpr, context as Record<string, Value>)
    } catch (err) {
      log.warn(
        {
          promptId: resolvedPromptId,
          repo: resolvedRepo,
          when_expr: persistentTarget.whenExpr,
          err: String(err),
        },
        'when_expr evaluation error, skipping dispatch',
      )
      const runId = await recordSkippedRun(
        resolvedPromptId,
        resolvedRepo,
        opts.trigger,
        'when_expr_error',
        prompt.version,
      )
      return { runId }
    }
    if (!result) {
      log.info(
        { promptId: resolvedPromptId, repo: resolvedRepo, when_expr: persistentTarget.whenExpr },
        'when_expr falsy, skipping dispatch',
      )
      const runId = await recordSkippedRun(
        resolvedPromptId,
        resolvedRepo,
        opts.trigger,
        'when_expr_false',
        prompt.version,
      )
      return { runId }
    }
  }

  // Acquire lease
  const leaseKey = `prompt:${resolvedPromptId}:${resolvedRepo}`
  const leaseResult = await withLease(leaseKey, async () => {
    // Merge args: persistent target args + call-time overrides
    const baseArgs: Record<string, unknown> = persistentTarget
      ? (JSON.parse(persistentTarget.args) as Record<string, unknown>)
      : {}
    const mergedArgs: Record<string, unknown> = { ...baseArgs, ...opts.args }

    // Interpolate prompt body with args
    const interpolated = interpolateTemplate(prompt.body, {
      repo: resolvedRepo,
      ...mergedArgs,
    })

    // Resolve sensitivity and complexity
    const sensitivity =
      (persistentTarget?.sensitivityOverride as 'low' | 'medium' | 'high' | null | undefined) ??
      (prompt.sensitivity as 'low' | 'medium' | 'high')

    // Translate complexity: 'standard' → 'moderate' for the router
    const routerComplexity =
      prompt.complexity === 'standard'
        ? 'moderate'
        : (prompt.complexity as 'trivial' | 'moderate' | 'complex')

    const task: Task = {
      input: interpolated,
      source: 'cli',
      forceLocal: sensitivity === 'high',
      ...(routerComplexity === 'trivial' ? { domainHint: undefined } : {}),
    }

    const result = await run(task, {
      agentName: `prompt:${resolvedPromptId}`,
      permissionTier: 'R1',
      ...(resolvedPromptId ? { promptId: resolvedPromptId } : {}),
      ...(prompt.version ? { promptVersion: prompt.version } : {}),
      ...(resolvedRepo ? { targetRepo: resolvedRepo } : {}),
      runTrigger: opts.trigger,
    })

    // Handle outputs
    const outputConfig = JSON.parse(prompt.outputConfig) as Record<string, unknown>
    const date = new Date().toISOString().slice(0, 10)
    await handleOutputs(outputConfig, result.output, {
      repo: resolvedRepo,
      promptId: resolvedPromptId,
      runId: result.runId,
      args: mergedArgs,
      date,
    })

    // Update last_run on persistent target
    if (persistentTarget !== undefined) {
      const db2 = getDb()
      await db2
        .update(promptTargets)
        .set({ lastRunId: result.runId, lastRunAt: Date.now() })
        .where(eq(promptTargets.id, persistentTarget.id))
        .run()
    }

    log.info(
      {
        promptId: resolvedPromptId,
        repo: resolvedRepo,
        runId: result.runId,
        trigger: opts.trigger,
      },
      'prompt dispatch complete',
    )

    return { runId: result.runId }
  })

  if (leaseResult === null) {
    log.info({ promptId: resolvedPromptId, repo: resolvedRepo }, 'lease busy, skipping dispatch')
    const runId = await recordSkippedRun(
      resolvedPromptId,
      resolvedRepo,
      opts.trigger,
      'lease_held',
      prompt.version,
    )
    return { runId }
  }

  return leaseResult
}

async function recordSkippedRun(
  promptId: string,
  repo: string,
  trigger: string,
  reason: string,
  promptVersion: number,
): Promise<string> {
  const runId = await startRun({
    agentName: `prompt:${promptId}`,
    modelUsed: 'none',
    promptId,
    promptVersion,
    targetRepo: repo,
    runTrigger: trigger,
  })
  await finishRun(runId, { status: 'skipped', errorMessage: reason })
  return runId
}

/** Replace {{key}} placeholders in a template string with values from vars. */
function interpolateTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`,
  )
}
