import { getDb } from '@hub/db'
import { runs } from '@hub/db/schema'
import { newId, getLogger } from '@hub/shared'
import { eq } from 'drizzle-orm'

const log = getLogger('persist')

export interface RunStartArgs {
  agentName: string
  parentRunId?: string
  modelUsed: string
  permissionTier?: 'R0' | 'R1' | 'R2' | 'R3'
  mcpServers?: string[]
  subagents?: string[]
  // Prompt orchestration context (null for non-prompt runs)
  promptId?: string
  promptVersion?: number
  targetRepo?: string
  runTrigger?: string
}

export interface RunFinishArgs {
  status: 'success' | 'error' | 'partial' | 'skipped'
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  errorMessage?: string
  outputRef?: string
  reversalPayload?: string
  /** §VIII adversarial gate — strongest-case-against result. Null for non-R2/R3 runs. */
  adversarialNote?: string | null
}

export async function startRun(args: RunStartArgs): Promise<string> {
  const db = getDb()
  const id = newId()
  await db
    .insert(runs)
    .values({
      id,
      agentName: args.agentName,
      parentRunId: args.parentRunId ?? null,
      startedAt: Date.now(),
      modelUsed: args.modelUsed,
      permissionTier: args.permissionTier ?? 'R0',
      mcpServersJson: JSON.stringify(args.mcpServers ?? []),
      subagentsJson: JSON.stringify(args.subagents ?? []),
      status: 'running',
      promptId: args.promptId ?? null,
      promptVersion: args.promptVersion ?? null,
      targetRepo: args.targetRepo ?? null,
      runTrigger: args.runTrigger ?? null,
    })
    .run()
  log.debug({ runId: id, agent: args.agentName }, 'run started')
  return id
}

export async function finishRun(runId: string, args: RunFinishArgs): Promise<void> {
  const db = getDb()
  await db
    .update(runs)
    .set({
      endedAt: Date.now(),
      status: args.status,
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
      costUsd: args.costUsd ?? 0,
      errorMessage: args.errorMessage ?? null,
      outputRef: args.outputRef ?? null,
      reversalPayload: args.reversalPayload ?? null,
      adversarialNote: args.adversarialNote ?? null,
    })
    .where(eq(runs.id, runId))
    .run()
  log.debug({ runId, status: args.status }, 'run finished')
}
