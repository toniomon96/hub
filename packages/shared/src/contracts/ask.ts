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
