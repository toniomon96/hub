import { z } from 'zod'

/** Top-level life domains. Used in classification, routing, and Notion Areas. */
export const Domain = z.enum(['family', 'personal', 'hobby', 'client', 'omnexus', 'dse', 'misc'])
export type Domain = z.infer<typeof Domain>

/** Task complexity heuristic (router input). */
export const Complexity = z.enum(['trivial', 'moderate', 'complex'])
export type Complexity = z.infer<typeof Complexity>

/** Privacy sensitivity (router input). HIGH = local-only, never leaves machine. */
export const Sensitivity = z.enum(['low', 'medium', 'high'])
export type Sensitivity = z.infer<typeof Sensitivity>

/** Capture sources. */
export const CaptureSource = z.enum([
  'granola',
  'plaud',
  'superwhisper',
  'martin',
  'manual',
  'cli',
  'pwa',
  'claude-desktop',
])
export type CaptureSource = z.infer<typeof CaptureSource>

/** Capture types. */
export const CaptureType = z.enum(['meeting', 'thought', 'task', 'decision', 'reference', 'other'])
export type CaptureType = z.infer<typeof CaptureType>

/** Permission tiers (R0–R3). See ARCHITECTURE.md §7. */
export const PermissionTier = z.enum(['R0', 'R1', 'R2', 'R3'])
export type PermissionTier = z.infer<typeof PermissionTier>

/** Model spec returned by the router. */
export const ModelSpec = z.object({
  provider: z.enum(['anthropic', 'ollama']),
  model: z.string(),
  reason: z.string(),
})
export type ModelSpec = z.infer<typeof ModelSpec>

/** Triage signals (router input). */
export const Triage = z.object({
  sensitivity: Sensitivity,
  complexity: Complexity,
  domain: Domain,
  /** Hard pin — if true, router MUST stay local. Not overridable by flags. */
  localOnly: z.boolean().default(false),
})
export type Triage = z.infer<typeof Triage>

/** A user task heading into the agent runtime. */
export const Task = z.object({
  input: z.string(),
  source: CaptureSource.default('cli'),
  domainHint: Domain.optional(),
  /** Caller can request local-only routing explicitly. Cannot loosen the policy. */
  forceLocal: z.boolean().default(false),
})
export type Task = z.infer<typeof Task>
