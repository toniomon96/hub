import type { Task } from '@hub/shared'
import { getLogger } from '@hub/shared'
import { route } from '@hub/models/router'
import { getOllamaClient } from '@hub/models/ollama'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { startRun, finishRun } from './persist.js'
import { getTodaySpendUsd } from '@hub/db'
import { buildMcpScopes, type McpScopeName, type McpServerCfg } from './mcp-config.js'
import { loadCommandments, loadUserContext, loadDomainAuthorityPolicy } from './context.js'

// Prepended to every system prompt. Not configurable at runtime — a constitutional constant.
// Warm in tone, direct about what it is. No performance of emotion or friendship.
const LANGUAGE_POLICY = `You are Hub — a precision cognitive tool, not a friend or companion.

- Never use language implying consciousness, emotion, or care: "I care about", "I'm worried", "as your friend", "I feel", "I'm excited about your goals", "I'm here to help".
- Be warm in tone. Be direct. Be honest about uncertainty — say "I don't know" when you don't know.
- Never fabricate facts, citations, or data. Surface gaps explicitly.
- When trade-offs exist, name them. Do not collapse them into a single recommendation unless asked.
- Challenge when the user's plan is weak. Name rationalizations when you see them. A great tool tells the truth.`.trim()

const log = getLogger('agent-runtime')

export interface RunOptions {
  /** Name of the agent (e.g., 'nightly-brief', 'ask-oneshot'). */
  agentName: string
  /** Which MCP scopes to load. */
  scopes?: McpScopeName[]
  /** Hard cap on agent turns. */
  maxTurns?: number
  /** Permission tier for this run (used in confirm hooks + audit). */
  permissionTier?: 'R0' | 'R1' | 'R2' | 'R3'
  /** Optional system prompt override. */
  systemPrompt?: string
  /** Restrict SDK tools (allowlist). Empty = SDK defaults. */
  allowedTools?: string[]
  // Prompt orchestration context — forwarded to startRun() for audit trail
  promptId?: string
  promptVersion?: number
  targetRepo?: string
  runTrigger?: string
}

export interface RunResult {
  runId: string
  output: string
  modelUsed: string
  status: 'success' | 'error' | 'partial'
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

/**
 * Assemble the full system prompt in priority order:
 *   1. LANGUAGE_POLICY  — constitutional, always first
 *   2. Commandments     — hard refusals loaded from /data/commandments.md
 *   3. User context     — budget-managed context.md (empty string if file missing)
 *   4. Task-specific    — skill/instruction passed by the caller
 *
 * Sections are separated by a horizontal rule so the model treats them as
 * distinct layers rather than one continuous block.
 */
function assembleSystemPrompt(taskSpecific?: string): string {
  const parts: string[] = [LANGUAGE_POLICY]

  const commandments = loadCommandments()
  if (commandments) parts.push(commandments)

  const context = loadUserContext()
  if (context) parts.push(`## User Context\n\n${context}`)

  // Domain authority policy — injected after context so it references context.md's
  // ## Domain Authority section. Empty string when no entries are configured.
  const domainPolicy = loadDomainAuthorityPolicy()
  if (domainPolicy) parts.push(domainPolicy)

  if (taskSpecific) parts.push(taskSpecific)

  return parts.join('\n\n---\n\n')
}

/**
 * Top-level entry point for any agent invocation.
 *
 * - Anthropic provider → Claude Agent SDK `query()` with composed MCP servers.
 * - Ollama provider    → direct OpenAI-compatible chat (SDK is Anthropic-only
 *                        and cannot natively route to local models).
 *
 * Persists a `runs` row on entry and finalizes it on exit with cost + tokens.
 */
export async function run(task: Task, opts: RunOptions): Promise<RunResult> {
  const todaySpendUsd = await getTodaySpendUsd()
  const decision = route(task, { todaySpendUsd })
  const scopeNames = opts.scopes ?? []
  const scopeMap = buildMcpScopes()

  // Flatten selected scope arrays into a name → config map for the SDK.
  const mcpServers: Record<string, McpServerCfg> = {}
  for (const name of scopeNames) {
    scopeMap[name].forEach((cfg, idx) => {
      mcpServers[`${name}-${idx}`] = cfg
    })
  }

  const runId = await startRun({
    agentName: opts.agentName,
    modelUsed: `${decision.spec.provider}:${decision.spec.model}`,
    permissionTier: opts.permissionTier ?? 'R0',
    mcpServers: Object.keys(mcpServers),
    ...(opts.promptId !== undefined ? { promptId: opts.promptId } : {}),
    ...(opts.promptVersion !== undefined ? { promptVersion: opts.promptVersion } : {}),
    ...(opts.targetRepo !== undefined ? { targetRepo: opts.targetRepo } : {}),
    ...(opts.runTrigger !== undefined ? { runTrigger: opts.runTrigger } : {}),
  })

  log.info(
    {
      runId,
      agent: opts.agentName,
      provider: decision.spec.provider,
      model: decision.spec.model,
      reason: decision.spec.reason,
      sensitivity: decision.triage.sensitivity,
      mcpServerCount: Object.keys(mcpServers).length,
    },
    'agent run',
  )

  const fullSystemPrompt = assembleSystemPrompt(opts.systemPrompt)

  try {
    if (decision.spec.provider === 'ollama') {
      const r = await runOllama(task, decision.spec.model, {
        ...opts,
        systemPrompt: fullSystemPrompt,
      })
      await finishRun(runId, {
        status: 'success',
        outputRef: r.output,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      })
      return {
        runId,
        output: r.output,
        modelUsed: `ollama:${decision.spec.model}`,
        status: 'success',
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
      }
    }

    const r = await runAnthropic(task, decision.spec.model, mcpServers, {
      ...opts,
      systemPrompt: fullSystemPrompt,
    })
    await finishRun(runId, {
      status: r.status,
      outputRef: r.output,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      ...(r.errorMessage ? { errorMessage: r.errorMessage } : {}),
    })
    return {
      runId,
      output: r.output,
      modelUsed: `anthropic:${decision.spec.model}`,
      status: r.status,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ runId, err: msg }, 'agent run failed')
    await finishRun(runId, { status: 'error', errorMessage: msg })
    return {
      runId,
      output: '',
      modelUsed: `${decision.spec.provider}:${decision.spec.model}`,
      status: 'error',
    }
  }
}

// --- Anthropic Agent SDK path --------------------------------------------

interface AnthropicResult {
  output: string
  status: 'success' | 'error' | 'partial'
  inputTokens: number
  outputTokens: number
  costUsd: number
  errorMessage?: string
}

async function runAnthropic(
  task: Task,
  model: string,
  mcpServers: Record<string, McpServerCfg>,
  opts: RunOptions,
): Promise<AnthropicResult> {
  const sdkOptions: Options = {
    model,
    ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
    ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
    ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
    ...(Object.keys(mcpServers).length > 0
      ? { mcpServers: mcpServers as unknown as NonNullable<Options['mcpServers']> }
      : {}),
  }

  const q = query({ prompt: task.input, options: sdkOptions })

  let finalText = ''
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  let status: AnthropicResult['status'] = 'success'
  let errorMessage: string | undefined

  for await (const msg of q) {
    if (msg.type === 'result') {
      const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined
      inputTokens = usage?.input_tokens ?? 0
      outputTokens = usage?.output_tokens ?? 0
      costUsd = msg.total_cost_usd ?? 0
      if (msg.subtype === 'success') {
        finalText = msg.result
        status = 'success'
      } else {
        status = 'error'
        errorMessage = msg.errors?.join('; ') ?? msg.subtype
      }
      break
    }
  }

  return {
    output: finalText,
    status,
    inputTokens,
    outputTokens,
    costUsd,
    ...(errorMessage ? { errorMessage } : {}),
  }
}

// --- Ollama path ---------------------------------------------------------

interface OllamaRunResult {
  output: string
  inputTokens: number
  outputTokens: number
}

async function runOllama(task: Task, model: string, opts: RunOptions): Promise<OllamaRunResult> {
  const client = getOllamaClient()
  const messages = [
    ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
    { role: 'user' as const, content: task.input },
  ]
  const res = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.2,
  })
  const output = res.choices[0]?.message?.content ?? ''
  return {
    output,
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  }
}
