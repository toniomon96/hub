import OpenAI from 'openai'
import { loadEnv, getLogger } from '@hub/shared'

const log = getLogger('ollama')

let client: OpenAI | undefined

/**
 * Ollama exposes an OpenAI-compatible endpoint. We talk to it via the
 * `openai` npm with a custom baseURL — no Ollama-specific SDK needed.
 *
 * Stub here is intentionally minimal. Capture classifier and `runLocal()`
 * import this and add their own retry/format logic.
 */
export function getOllamaClient(): OpenAI {
  if (client) return client
  const env = loadEnv()
  client = new OpenAI({
    baseURL: `${env.OLLAMA_BASE_URL}/v1`,
    apiKey: 'ollama', // Ollama ignores the key
  })
  return client
}

export interface OllamaJsonOptions {
  model: string
  system?: string
  user: string
  /** Max retries on JSON parse failure. */
  maxRetries?: number
}

/**
 * Call Ollama with `format: json`, parse the result, and retry on parse failure.
 * Used by the capture classifier (NOT an Agent SDK subagent — see ARCHITECTURE.md §7).
 */
export async function ollamaJson<T = unknown>(opts: OllamaJsonOptions): Promise<T> {
  const c = getOllamaClient()
  const max = opts.maxRetries ?? 2
  let lastErr: unknown
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      const res = await c.chat.completions.create({
        model: opts.model,
        messages: [
          ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
          { role: 'user' as const, content: opts.user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      })
      const content = res.choices[0]?.message?.content ?? ''
      return JSON.parse(content) as T
    } catch (err) {
      lastErr = err
      log.warn({ attempt, err: String(err) }, 'ollama json parse failed')
    }
  }
  throw new Error(`ollama json failed after ${max + 1} attempts: ${String(lastErr)}`)
}
