import { z } from './z.js'
import { IdString } from './primitives.js'

export const AskRequest = z
  .object({
    input: z.string().min(1),
    forceLocal: z.boolean().optional(),
  })
  .openapi('AskRequest')
export type AskRequest = z.infer<typeof AskRequest>

export const AskResponse = z
  .object({
    runId: IdString,
    output: z.string(),
    modelUsed: z.string(),
    status: z.enum(['success', 'error', 'partial']),
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    costUsd: z.number().optional(),
  })
  .openapi('AskResponse')
export type AskResponse = z.infer<typeof AskResponse>

/**
 * Discriminated union of events emitted on the POST /api/ask/stream SSE
 * channel. Each event is sent as a single SSE frame with `event:` set to
 * the discriminator and `data:` the JSON payload.
 *
 * Event order guarantees:
 *   1. exactly one `meta` frame first,
 *   2. zero-or-more `token` frames,
 *   3. exactly one of `final` | `error` last.
 */
export const AskStreamMeta = z
  .object({
    runId: IdString,
    modelUsed: z.string(),
  })
  .openapi('AskStreamMeta')
export type AskStreamMeta = z.infer<typeof AskStreamMeta>

export const AskStreamToken = z
  .object({
    text: z.string(),
  })
  .openapi('AskStreamToken')
export type AskStreamToken = z.infer<typeof AskStreamToken>

export const AskStreamFinal = AskResponse.openapi('AskStreamFinal')
export type AskStreamFinal = z.infer<typeof AskStreamFinal>

export const AskStreamError = z
  .object({
    message: z.string(),
    runId: IdString.optional(),
  })
  .openapi('AskStreamError')
export type AskStreamError = z.infer<typeof AskStreamError>

export type AskStreamEvent =
  | { event: 'meta'; data: AskStreamMeta }
  | { event: 'token'; data: AskStreamToken }
  | { event: 'final'; data: AskStreamFinal }
  | { event: 'error'; data: AskStreamError }
