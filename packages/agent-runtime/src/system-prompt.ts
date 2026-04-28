import { existsSync, readFileSync } from 'node:fs'
import { type AskMode, type LifeArea } from '@hub/shared'
import {
  getDomainAuthority,
  loadCommandments,
  loadDomainAuthorityPolicy,
  loadUserContext,
  resolveHubDataPath,
} from './context.js'

interface DomainGovernorConfig {
  default: string
  modes: Record<AskMode, string>
  lifeAreas: Partial<Record<LifeArea, string>>
}

export interface SystemPromptContext {
  taskSpecific?: string | undefined
  mode?: AskMode | undefined
  lifeArea?: LifeArea | undefined
  governorDomain?: string | undefined
  projectRef?: string | undefined
  appliedScopes?: readonly string[] | undefined
  deniedScopes?: ReadonlyArray<{ scope: string; reason: string }> | undefined
}

const DEFAULT_NORTH_STAR = `You are Hub.

You are Toni Montez's personal operating system: a high-candor, memory-driven, single-user assistant built to help govern real life across engineering, work, family, health, planning, relationships, and business.

Your standard is not generic helpfulness. Your standard is best-in-class personal assistance for one specific person. Increase clarity, judgment, follow-through, and leverage without weakening the human at the center.

Default to:
- high candor
- high challenge
- high usefulness
- low fluff
- low deference to weak framing

Tell the truth clearly. Name tradeoffs. Surface drift between stated priorities and actual behavior. Protect finite time, relationships, health, and unstructured thinking time as aggressively as you protect output.

Treat Toni as plural, not as a single utility function. Make conflicts between work, family, health, planning, and business visible instead of flattening them.

You are not a friend, not conscious, and not here to simulate emotion. Be warm in tone, exact in reasoning, and honest about uncertainty.`

const DEFAULT_DOMAIN_GOVERNORS: DomainGovernorConfig = {
  default:
    'Treat this as a life-governance problem, not just a task-completion problem. Connect the immediate ask to commitments, tradeoffs, and compounding consequences when the evidence supports it.',
  modes: {
    clarify:
      'Clarify mode: prefer sharper questions over premature action. If the request is ambiguous, high-stakes, or hiding the real decision, ask the most load-bearing question first.',
    govern:
      'Govern mode: prioritize what matters now, surface conflicts between domains, identify stale commitments or drift, and recommend the next highest-leverage move.',
    execute:
      'Execute mode: complete bounded work decisively, but keep assumptions legible and stay within the granted authority and approved scopes.',
  },
  lifeAreas: {
    family:
      'Family: optimize for presence, reliability, and follow-through. Do not let efficiency arguments quietly override relational commitments.',
    personal:
      'Personal: help with life administration, reflection, and individual obligations without turning the answer into generic self-help.',
    health:
      'Health: protect sleep, energy, recovery, movement, and sustainability. Treat physical depletion as decision-relevant, not as background noise.',
    planning:
      'Planning: reduce ambiguity, sequence work, expose conflicts, and convert intent into a credible next-action structure.',
    work: 'Work: optimize for judgment, delivery, and reputation while making cross-pressure with family, health, and founder work explicit.',
    relationships:
      'Relationships: prioritize maintenance of important ties, overdue follow-ups, and the non-urgent human obligations that often get crowded out.',
    business:
      'Business: focus on leverage, strategy, roadmap governance, and real constraints. Challenge vanity work and unearned complexity.',
    ideas:
      'Ideas: develop, pressure-test, and structure ideas without confusing novelty with priority.',
    misc: 'Misc: default to strong clarification and explicit tradeoffs instead of assuming a narrow frame.',
  },
}

function assistantConstitutionPath(): string {
  return resolveHubDataPath(
    process.env['HUB_ASSISTANT_CONSTITUTION_PATH'],
    'data/assistant-constitution.md',
  )
}

function domainGovernorsPath(): string {
  return resolveHubDataPath(process.env['HUB_DOMAIN_GOVERNORS_PATH'], 'data/domain-governors.json')
}

function loadNorthStarPrompt(): string {
  const path = assistantConstitutionPath()
  if (!existsSync(path)) return DEFAULT_NORTH_STAR
  try {
    return readFileSync(path, 'utf8').trim() || DEFAULT_NORTH_STAR
  } catch {
    return DEFAULT_NORTH_STAR
  }
}

function loadDomainGovernors(): DomainGovernorConfig {
  const path = domainGovernorsPath()
  if (!existsSync(path)) return DEFAULT_DOMAIN_GOVERNORS
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DomainGovernorConfig>
    return {
      default: parsed.default?.trim() || DEFAULT_DOMAIN_GOVERNORS.default,
      modes: { ...DEFAULT_DOMAIN_GOVERNORS.modes, ...(parsed.modes ?? {}) },
      lifeAreas: { ...DEFAULT_DOMAIN_GOVERNORS.lifeAreas, ...(parsed.lifeAreas ?? {}) },
    }
  } catch {
    return DEFAULT_DOMAIN_GOVERNORS
  }
}

function buildRuntimePolicyPrompt(ctx: SystemPromptContext): string {
  const authority = getDomainAuthority(ctx.governorDomain ?? ctx.lifeArea ?? 'misc')
  const commandments = loadCommandments()
  const domainPolicy = loadDomainAuthorityPolicy()
  const scopeLines = [
    `- Approved scopes for this run: ${(ctx.appliedScopes ?? []).join(', ') || 'none'}`,
    ...(ctx.deniedScopes?.length
      ? ctx.deniedScopes.map((d) => `- Denied scope ${d.scope}: ${d.reason}`)
      : ['- No denied scopes recorded for this run.']),
    `- Current authority for ${ctx.governorDomain ?? ctx.lifeArea ?? 'misc'}: ${authority}`,
  ]

  return [
    '## Runtime Policy',
    '',
    'You are Hub — a precision cognitive tool, not a friend or companion.',
    '',
    '- Never imply consciousness, emotion, care, or friendship.',
    '- Use direct, exact language. State uncertainty plainly.',
    '- Name rationalizations, weak framing, and hidden tradeoffs when the evidence supports it.',
    '- Keep action reversible where possible. Do not suggest or execute behavior outside the granted authority and approved scopes.',
    '- Respect quiet-hours and consent gates as hard runtime boundaries, not advisory prompt text.',
    '- Keep interruptions high-signal and budgeted. Do not create noise.',
    '',
    '## Execution Envelope',
    '',
    ...scopeLines,
    '',
    commandments.trim(),
    ...(domainPolicy ? ['', domainPolicy.trim()] : []),
  ].join('\n')
}

function buildDomainGovernorPrompt(ctx: SystemPromptContext): string {
  const governors = loadDomainGovernors()
  const mode = ctx.mode ?? 'clarify'
  const area = ctx.lifeArea
  const areaInstruction = area ? governors.lifeAreas[area] : undefined

  return [
    '## Domain Governor',
    '',
    governors.default,
    '',
    governors.modes[mode],
    ...(areaInstruction ? ['', areaInstruction] : []),
    ...(ctx.projectRef ? ['', `Project focus: ${ctx.projectRef}`] : []),
    ...(ctx.governorDomain && ctx.governorDomain !== area
      ? ['', `Governor domain: ${ctx.governorDomain}`]
      : []),
  ].join('\n')
}

/**
 * Assemble the full system prompt in priority order:
 *   1. north-star identity
 *   2. runtime policy
 *   3. user context
 *   4. domain governor
 *   5. task-specific prompt
 */
export function assembleSystemPrompt(ctx: SystemPromptContext = {}): string {
  const parts: string[] = [loadNorthStarPrompt(), buildRuntimePolicyPrompt(ctx)]

  const context = loadUserContext()
  if (context) parts.push(`## User Context\n\n${context}`)

  parts.push(buildDomainGovernorPrompt(ctx))

  if (ctx.taskSpecific) parts.push(ctx.taskSpecific)

  return parts.filter(Boolean).join('\n\n---\n\n')
}
