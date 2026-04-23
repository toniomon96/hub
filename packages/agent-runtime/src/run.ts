import type { Task } from '@hub/shared'
import { getLogger, loadEnv, isQuietHour } from '@hub/shared'
import { route, type RouterDecision } from '@hub/models/router'
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
- Use "I" only for system-action descriptions: "I searched X", "I found Y", "I cannot retrieve Z". Never for inner states: not "I think", "I believe", "I want", "I agree" — these imply interiority that does not exist. Use "The evidence suggests", "This appears to be", "A stronger approach would be" instead.
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
  const env = loadEnv()
  const tier = opts.permissionTier ?? 'R0'

  // §XII §XIV — Hard quiet-hours gate for R2/R3 actions. Code gate, not a model
  // instruction — cannot be bypassed by editing commandments.md.
  if ((tier === 'R2' || tier === 'R3') && isQuietHour(env.HUB_QUIET_HOURS)) {
    const endHour = env.HUB_QUIET_HOURS.split('-')[1] ?? '??'
    log.warn({ tier, quietHours: env.HUB_QUIET_HOURS }, 'run blocked: quiet hours active')
    return {
      runId: '',
      output: `Run blocked: quiet hours active (${env.HUB_QUIET_HOURS}). ${tier} actions require human presence. Retry after ${endHour}:00.`,
      modelUsed: 'blocked',
      status: 'error',
    }
  }

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
      const adversarialNote = await getAdversarialNote(r.output, decision, tier)
      await finishRun(runId, {
        status: 'success',
        outputRef: r.output,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        adversarialNote: adversarialNote ?? null,
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
    const adversarialNote =
      r.status === 'success' ? await getAdversarialNote(r.output, decision, tier) : undefined
    await finishRun(runId, {
      status: r.status,
      outputRef: r.output,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      adversarialNote: adversarialNote ?? null,
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

// --- §VIII Adversarial second-pass ---------------------------------------

const ADVERSARIAL_SYSTEM =
  'You are an adversarial reviewer. In one sentence, state the single strongest case against the proposed action or output. If you find no material objection, say exactly: "No material objection."'

/**
 * Runs only for R2/R3 successful completions (§VIII). Uses the same provider
 * as the main run to preserve privacy routing — a local-routed run stays local.
 */
async function runAdversarialPass(output: string, decision: RouterDecision): Promise<string> {
  if (decision.spec.provider === 'ollama') {
    const client = getOllamaClient()
    const res = await client.chat.completions.create({
      model: decision.spec.model,
      messages: [
        { role: 'system', content: ADVERSARIAL_SYSTEM },
        { role: 'user', content: output },
      ],
      temperature: 0.1,
    })
    return res.choices[0]?.message?.content?.trim() ?? 'No material objection.'
  }

  // Anthropic path — no MCP, no tools, single turn.
  const q = query({
    prompt: output,
    options: { model: decision.spec.model, systemPrompt: ADVERSARIAL_SYSTEM, maxTurns: 1 },
  })
  for await (const msg of q) {
    if (msg.type === 'result' && msg.subtype === 'success') {
      return msg.result.trim()
    }
  }
  return 'No material objection.'
}

async function getAdversarialNote(
  output: string,
  decision: RouterDecision,
  tier: 'R0' | 'R1' | 'R2' | 'R3',
): Promise<string | undefined> {
  if (tier !== 'R2' && tier !== 'R3') return undefined
  try {
    const note = await runAdversarialPass(output, decision)
    log.info({ tier, note }, 'adversarial check')
    return note
  } catch (err) {
    log.warn({ tier, err: String(err) }, 'adversarial check failed — skipping')
    return undefined
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
