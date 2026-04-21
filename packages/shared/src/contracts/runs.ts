import { z } from './z.js'
import { PermissionTier } from '../types.js'
import { EpochMs, IdString } from './primitives.js'

export const RunDetail = z
  .object({
    id: IdString,
    agentName: z.string(),
    parentRunId: IdString.nullable(),
    startedAt: EpochMs,
    endedAt: EpochMs.nullable(),
    modelUsed: z.string(),
    inputTokens: z.number().int().nullable(),
    outputTokens: z.number().int().nullable(),
    costUsd: z.number().nullable(),
    status: z.string(),
    permissionTier: PermissionTier,
    errorMessage: z.string().nullable(),
    outputRef: z.string().nullable(),
  })
  .openapi('RunDetail')
export type RunDetail = z.infer<typeof RunDetail>
