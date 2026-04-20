import type { Task } from '@hub/shared'
import { getLogger } from '@hub/shared'
import { route } from '@hub/models/router'
import { startRun, finishRun } from './persist.js'
import { buildMcpScopes } from './mcp-config.js'

const log = getLogger('agent-runtime')

export interface RunOptions {
  /** Name of the agent (e.g., 'nightly-brief', 'ask-oneshot'). */
  agentName: string
  /** Which MCP scopes to load. */
  scopes?: Array<keyof ReturnType<typeof buildMcpScopes>>
  /** Hard cap on agent turns. SDK default may be higher. */
  maxTurns?: number
  /** Permission tier for this run (used in confirm hooks + audit). */
  permissionTier?: 'R0' | 'R1' | 'R2' | 'R3'
}

export interface RunResult {
  runId: string
  output: string
  modelUsed: string
  status: 'success' | 'error' | 'partial'
}

/**
 * Top-level entry point for any agent invocation.
 *
 * MVP behavior (v0.3): routes via the privacy-gated router, persists the run,
 * and returns a stub response. The full Agent SDK call lands in MVP epic B
 * once `@anthropic-ai/claude-agent-sdk` is installed and we wire the
 * mcpServers / settingSources / hooks pieces.
 *
 * This stub exists so apps/cli + apps/server can integrate against a stable
 * surface from day one and we can swap in the SDK call without touching callers.
 */
export async function run(task: Task, opts: RunOptions): Promise<RunResult> {
  const decision = route(task)
  const scopes = opts.scopes ?? []
  const scopeMap = buildMcpScopes()
  const mcpServerNames = scopes.flatMap((s) =>
    scopeMap[s].map((cfg) => ('command' in cfg ? cfg.command : cfg.url)),
  )

  const runId = startRun({
    agentName: opts.agentName,
    modelUsed: `${decision.spec.provider}:${decision.spec.model}`,
    permissionTier: opts.permissionTier ?? 'R0',
    mcpServers: mcpServerNames,
  })

  log.info(
    {
      runId,
      agent: opts.agentName,
      provider: decision.spec.provider,
      model: decision.spec.model,
      reason: decision.spec.reason,
      sensitivity: decision.triage.sensitivity,
    },
    'agent run',
  )

  // TODO (Epic B ticket #6): wire actual Agent SDK query() here.
  // For Anthropic provider:
  //   import { query } from '@anthropic-ai/claude-agent-sdk'
  //   for await (const msg of query({ prompt: task.input, options: {...} })) ...
  // For Ollama provider: call ollamaJson or stream chat completion.
  const stubOutput = `[stub] would route ${task.input.slice(0, 60)}... to ${decision.spec.provider}:${decision.spec.model} (${decision.spec.reason})`

  finishRun(runId, {
    status: 'success',
    outputRef: stubOutput,
  })

  return {
    runId,
    output: stubOutput,
    modelUsed: `${decision.spec.provider}:${decision.spec.model}`,
    status: 'success',
  }
}
