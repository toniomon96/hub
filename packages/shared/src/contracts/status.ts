import { z } from './z.js'
import { EpochMs, IdString } from './primitives.js'

export const Lease = z
  .object({
    name: z.string(),
    holderPid: z.number().int(),
    leaseUntil: EpochMs,
    acquiredAt: EpochMs,
  })
  .openapi('Lease')
export type Lease = z.infer<typeof Lease>

export const RecentRun = z
  .object({
    id: IdString,
    agent: z.string(),
    model: z.string(),
    status: z.string(),
    startedAt: EpochMs,
    endedAt: EpochMs.nullable(),
    costUsd: z.number().nullable(),
  })
  .openapi('RecentRun')
export type RecentRun = z.infer<typeof RecentRun>

export const StatusResponse = z
  .object({
    version: z.string(),
    counts: z.object({
      captures: z.number().int(),
      runs: z.number().int(),
      leases: z.number().int(),
    }),
    leases: z.array(Lease),
    recentRuns: z.array(RecentRun),
  })
  .openapi('StatusResponse')
export type StatusResponse = z.infer<typeof StatusResponse>
