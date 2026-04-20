import { z } from 'zod'
import { loadEnv, getLogger, Domain, CaptureType } from '@hub/shared'
import { ollamaJson } from '@hub/models/ollama'

const log = getLogger('classify')

/**
 * LOAD-BEARING (v0.3 fix #3): the classifier is a DIRECT Ollama call from
 * `packages/capture/`, NOT an Agent SDK subagent. Subagents inherit the
 * parent's provider — you can't have an Ollama-backed subagent inside a
 * Claude query. So classification lives outside the SDK.
 */

export const ClassifierResult = z.object({
  domain: Domain,
  type: CaptureType,
  confidence: z.number().min(0).max(1),
  entities: z.array(z.string()).default([]),
  actionItems: z
    .array(
      z.object({
        text: z.string(),
        assignee: z.string().optional(),
        due: z.string().optional(),
      }),
    )
    .default([]),
  decisions: z
    .array(
      z.object({
        text: z.string(),
        project: z.string().optional(),
      }),
    )
    .default([]),
  summary: z.string(),
})
export type ClassifierResult = z.infer<typeof ClassifierResult>

const SYSTEM_PROMPT = `You classify personal-life captures (meetings, voice notes, thoughts) for an operating-system-style assistant.

Return JSON ONLY, matching this exact shape:
{
  "domain": "family" | "personal" | "hobby" | "client" | "omnexus" | "dse" | "misc",
  "type": "meeting" | "thought" | "task" | "decision" | "reference" | "other",
  "confidence": 0.0-1.0,
  "entities": ["names", "places", "things"],
  "actionItems": [{ "text": "...", "assignee": "me|name", "due": "YYYY-MM-DD?" }],
  "decisions": [{ "text": "...", "project": "slug?" }],
  "summary": "one-sentence summary"
}

Rules:
- Be conservative on confidence: <0.7 if you'd want a human to review.
- Domains:
  - family: spouse/kids/household
  - personal: solo personal life, health, finance, hobbies that are NOT apps
  - hobby: side projects/apps the user builds for fun
  - client: paid client work
  - omnexus: the user's "Omnexus" product
  - dse: the user's DSE content stream
  - misc: doesn't fit
- Type: pick one. Decision = an explicit choice ("we're going with X").
- Action items: explicit asks/commitments only. Do NOT invent.`

export interface ClassifyOptions {
  text: string
  /** Override model. Default = HUB_LOCAL_MODEL_TRIVIAL (Phi-4-mini). */
  model?: string
}

export async function classify(opts: ClassifyOptions): Promise<ClassifierResult> {
  const env = loadEnv()
  const model = opts.model ?? env.HUB_LOCAL_MODEL_TRIVIAL
  log.debug({ model, len: opts.text.length }, 'classify')

  const raw = await ollamaJson<unknown>({
    model,
    system: SYSTEM_PROMPT,
    user: opts.text,
    maxRetries: 2,
  })

  // Validate. If invalid, throw — caller decides whether to retry with a
  // bigger model (Qwen3 7B) or escalate to the Haiku fallback.
  const parsed = ClassifierResult.safeParse(raw)
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues }, 'classifier returned invalid shape')
    throw new Error(`classifier output invalid: ${parsed.error.message}`)
  }
  return parsed.data
}
