import type { Task } from '@hub/shared'
import { getLogger, loadEnv, isQuietHour } from '@hub/shared'
import { route } from '@hub/models/router'
import { getOllamaClient } from '@hub/models/ollama'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { startRun, finishRun } from './persist.js'
import { getTodaySpendUsd } from '@hub/db'
import { buildMcpScopes, type McpScopeName, type McpServerCfg } from './mcp-config.js'
import { assembleSystemPrompt } from './system-prompt.js'

const log = getLogger('agent-runtime-stream')

export interface RunStreamOptions {
  agentName: string
  scopes?: McpScopeName[]
  maxTurns?: number
  permissionTier?: 'R0' | 'R1' | 'R2' | 'R3'
  systemPrompt?: string
  allowedTools?: string[]
  /** Abort signal — when aborted, the generator finalizes the run as `partial`. */
  signal?: AbortSignal
}

export type RunStreamEvent =
  | { type: 'meta'; runId: string; modelUsed: string }
  | { type: 'token'; text: string }
  | {
      type: 'final'
      runId: string
      modelUsed: string
      output: string
      status: 'success' | 'error' | 'partial'
      inputTokens?: number
      outputTokens?: number
      costUsd?: number
    }
  | { type: 'error'; runId?: string; message: string }

/**
 * Streaming counterpart to `run()`. Yields `meta` first, then zero-or-more
 * `token` events, then exactly one terminal event (`final` or `error`).
 *
 * Ollama path streams OpenAI-compatible chunks token-by-token. Anthropic
 * path yields message-level deltas emitted by `claude-agent-sdk` — the SDK
 * does not currently expose sub-message token deltas, so "tokens" here are
 * really "assistant message chunks". Good enough for perceived latency
 * (first byte <500ms) and keeps the event contract stable when the SDK
 * grows finer granularity later.
 *
 * The caller may pass an `AbortSignal`; aborting mid-stream finalizes the
 * run with status `partial` and emits a terminal `error`-style event with
 * message `'aborted'`.
 */
export async function* runStream(
  task: Task,
  opts: RunStreamOptions,
): AsyncGenerator<RunStreamEvent, void, void> {
  const env = loadEnv()
  const tier = opts.permissionTier ?? 'R0'
  if (
    (tier === 'R2' || tier === 'R3') &&
    isQuietHour(env.HUB_QUIET_HOURS, { timeZone: env.HUB_TIMEZONE })
  ) {
    const endHour = env.HUB_QUIET_HOURS.split('-')[1] ?? '??'
    const runId = await startRun({
      agentName: opts.agentName,
      modelUsed: 'blocked:quiet-hours',
      permissionTier: tier,
    })
    const message = `Run blocked: quiet hours active (${env.HUB_QUIET_HOURS}). ${tier} actions require human presence. Retry after ${endHour}:00.`
    await finishRun(runId, {
      status: 'error',
      errorMessage: 'quiet_hours_blocked',
      outputRef: message,
    })
    log.warn({ tier, quietHours: env.HUB_QUIET_HOURS }, 'runStream blocked: quiet hours active')
    yield { type: 'meta', runId, modelUsed: 'blocked:quiet-hours' }
    yield { type: 'error', runId, message }
    return
  }

  const todaySpendUsd = await getTodaySpendUsd()
  const decision = route(task, { todaySpendUsd })
  const scopeNames = opts.scopes ?? []
  const scopeMap = buildMcpScopes()
  const mcpServers: Record<string, McpServerCfg> = {}
  for (const name of scopeNames) {
    scopeMap[name].forEach((cfg, idx) => {
      mcpServers[`${name}-${idx}`] = cfg
    })
  }

  const runId = await startRun({
    agentName: opts.agentName,
    modelUsed: `${decision.spec.provider}:${decision.spec.model}`,
    permissionTier: tier,
    mcpServers: Object.keys(mcpServers),
  })

  const modelUsed = `${decision.spec.provider}:${decision.spec.model}`
  const fullSystemPrompt = assembleSystemPrompt(opts.systemPrompt)
  yield { type: 'meta', runId, modelUsed }

  let accumulated = ''
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  let aborted = false

  const onAbort = () => {
    aborted = true
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (decision.spec.provider === 'ollama') {
      const client = getOllamaClient()
      const messages = [
        ...(fullSystemPrompt ? [{ role: 'system' as const, content: fullSystemPrompt }] : []),
        { role: 'user' as const, content: task.input },
      ]
      const stream = await client.chat.completions.create({
        model: decision.spec.model,
        messages,
        temperature: 0.2,
        stream: true,
      })
      for await (const chunk of stream) {
        if (aborted) break
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta) {
          accumulated += delta
          yield { type: 'token', text: delta }
        }
        const usage = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } })
          .usage
        if (usage) {
          inputTokens = usage.prompt_tokens ?? inputTokens
          outputTokens = usage.completion_tokens ?? outputTokens
        }
      }
    } else {
      const sdkOptions: Options = {
        model: decision.spec.model,
        ...(fullSystemPrompt ? { systemPrompt: fullSystemPrompt } : {}),
        ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
        ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
        ...(Object.keys(mcpServers).length > 0
          ? { mcpServers: mcpServers as unknown as NonNullable<Options['mcpServers']> }
          : {}),
      }

      const q = query({ prompt: task.input, options: sdkOptions })
      for await (const msg of q) {
        if (aborted) break
        if (msg.type === 'assistant') {
          // Extract text deltas from assistant message blocks.
          const blocks = (msg.message as { content?: Array<{ type: string; text?: string }> })
            .content
          if (Array.isArray(blocks)) {
            for (const b of blocks) {
              if (b.type === 'text' && b.text) {
                accumulated += b.text
                yield { type: 'token', text: b.text }
              }
            }
          }
        } else if (msg.type === 'result') {
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number } | undefined
          inputTokens = usage?.input_tokens ?? 0
          outputTokens = usage?.output_tokens ?? 0
          costUsd = msg.total_cost_usd ?? 0
          if (msg.subtype === 'success' && msg.result) {
            // Replace accumulated with the canonical final text — the SDK's
            // final `result` string is the authoritative output.
            accumulated = msg.result
          }
          break
        }
      }
    }

    if (aborted) {
      await finishRun(runId, {
        status: 'partial',
        outputRef: accumulated,
        inputTokens,
        outputTokens,
        costUsd,
        errorMessage: 'aborted',
      })
      yield { type: 'error', runId, message: 'aborted' }
      return
    }

    await finishRun(runId, {
      status: 'success',
      outputRef: accumulated,
      inputTokens,
      outputTokens,
      costUsd,
    })
    yield {
      type: 'final',
      runId,
      modelUsed,
      output: accumulated,
      status: 'success',
      inputTokens,
      outputTokens,
      costUsd,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error({ runId, err: message }, 'runStream failed')
    await finishRun(runId, { status: 'error', errorMessage: message })
    yield { type: 'error', runId, message }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
