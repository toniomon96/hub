import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { withLease } from '@hub/db'
import { getLogger } from '@hub/shared'

const log = getLogger('context')

// ~16KB budget; leaves room for task-specific prompt + model response headroom.
// Rough estimate: 4 chars per token. Adjust via opts.maxTokens if needed.
const CONTEXT_TOKEN_BUDGET = 4000
const CHARS_PER_TOKEN = 4

// Priority sections kept when context.md exceeds the token budget.
// Order matters — model attention weights earlier content more heavily.
const PRIORITY_SECTIONS = [
  'Active Projects',
  'Planning and Commitments',
  'Plural Self',
  'Health and Energy',
  'Business and Ideas',
  'Engineering Conventions',
]

const DEFAULT_COMMANDMENTS = `# Hub Commandments

These are hard refusals. Edit deliberately, not impulsively. Not at 2am.

- No message to any person outside my org without showing me the full text + 60s confirmation window.
- No financial action (invoices, expenses, transfers) without explicit in-session confirmation.
- No irreversible action during HUB_QUIET_HOURS.
- No fabrication. If uncertain, say "I don't know."
- No language implying consciousness, emotion, or friendship.
- No collapsing trade-offs. Surface them; let me decide.`

function makeDefaultContext(): string {
  return `---
updated: ${new Date().toISOString().slice(0, 10)}
version: 2
---

## Active Projects
<!-- What you are building right now + status -->

## Family and Relationships
<!-- People, obligations, and presence requirements that should shape planning -->

## Health and Energy
<!-- Sleep, training, recovery, travel fatigue, health constraints -->

## Work and Career
<!-- Employment commitments, deadlines, and reputation-sensitive work -->

## Business and Ideas
<!-- Founder priorities, product bets, writing, and idea pipeline -->

## Planning and Commitments
<!-- Promises made, follow-ups owed, deadlines, and finite-calendar constraints -->

## Plural Self
<!-- Named selves + their declared needs -->
<!-- - **Toni-the-founder**: needs uninterrupted deep work blocks -->
<!-- - **Toni-the-family-man**: needs evening presence and weekend protection -->

## Decisions
<!-- Architectural + life decisions with date + reasoning -->

## Preferences
<!-- How you want Hub to behave, what to emphasize, what to skip -->

## Engineering Conventions
<!-- Coding standards applied to every agent code run -->

## Project Registry
<!-- Per-repo: stack, constraints, verification command, decision log -->

## Theories
<!-- Hub's falsifiable hypotheses about your patterns -->

## System Observations
<!-- Feedback-review findings — which prompts you acted on vs ignored -->

## Domain Authority
<!-- Per-domain trust level. Format: "- domain-name: suggest|draft|act" -->
<!-- Defaults to suggest for any unlisted domain. -->
- family: suggest
- health: suggest
- planning: draft
- work: suggest
- business: suggest
- ideas: suggest
- Todoist task creation: suggest
- GitHub PR creation: suggest
- Calendar creates: suggest

## Protected Emptiness
<!-- Unstructured thinking time, recovery blocks, and anti-overload constraints -->

## Stale
<!-- Entries moved here for confirmation before deletion -->`
}

function contextPath(): string {
  return resolveHubDataPath(process.env['HUB_CONTEXT_PATH'], 'data/context.md')
}

function commandmentsPath(): string {
  return resolveHubDataPath(process.env['HUB_COMMANDMENTS_PATH'], 'data/commandments.md')
}

export function resolveHubDataPath(explicitPath: string | undefined, relativePath: string): string {
  if (explicitPath) return resolve(explicitPath)

  const direct = resolve(relativePath)
  if (existsSync(direct)) return direct

  let current = process.cwd()
  while (true) {
    const candidate = join(current, relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current || current === parse(current).root) break
    current = parent
  }

  return direct
}

// --- Commandments -----------------------------------------------------------

export function ensureCommandments(): void {
  const path = commandmentsPath()
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, DEFAULT_COMMANDMENTS, 'utf8')
  log.info({ path }, 'commandments bootstrapped')
}

export function loadCommandments(): string {
  ensureCommandments()
  try {
    return readFileSync(commandmentsPath(), 'utf8')
  } catch {
    return DEFAULT_COMMANDMENTS
  }
}

// --- User context -----------------------------------------------------------

interface ParsedSection {
  name: string
  content: string
}

function parseContextSections(raw: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  // Skip frontmatter block if present
  let body = raw
  const fmMatch = raw.match(/^---\n[\s\S]*?\n---\n/)
  if (fmMatch) body = raw.slice(fmMatch[0].length)

  const lines = body.split('\n')
  let current: ParsedSection | null = null

  for (const line of lines) {
    const m = line.match(/^## (.+)$/)
    if (m) {
      if (current) sections.push(current)
      current = { name: m[1]!.trim(), content: '' }
    } else if (current) {
      current.content += line + '\n'
    }
  }
  if (current) sections.push(current)
  return sections
}

/**
 * Load context.md with token budget enforcement.
 * Returns '' if the file does not exist (graceful — agent runs fine without it).
 * Returns condensed priority sections when the file exceeds the budget.
 */
export function loadUserContext(opts: { maxTokens?: number } = {}): string {
  const path = contextPath()
  if (!existsSync(path)) return ''

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return ''
  }

  const budget = opts.maxTokens ?? CONTEXT_TOKEN_BUDGET
  const estimated = Math.ceil(raw.length / CHARS_PER_TOKEN)
  if (estimated <= budget) return raw

  // Over budget: emit priority sections only, each truncated proportionally
  const sections = parseContextSections(raw)
  const charPerSection = Math.floor((budget * CHARS_PER_TOKEN) / PRIORITY_SECTIONS.length)

  const reduced = PRIORITY_SECTIONS.map((name) => {
    const s = sections.find((sec) => sec.name === name)
    if (!s) return `## ${name}\n(no entries)`
    const truncated =
      s.content.length > charPerSection ? s.content.slice(0, charPerSection) + '\n…' : s.content
    return `## ${name}\n${truncated}`
  }).join('\n\n')

  log.warn({ path, estimatedTokens: estimated, budget }, 'context condensed — over token budget')
  return `[Context condensed — full version at ${path}]\n\n${reduced}`
}

/**
 * Append a dated entry under `section` in context.md.
 * Creates context.md from the default template if it does not exist.
 * Acquires a DB-backed lease to prevent concurrent corruption.
 */
export async function appendToContext(section: string, entry: string): Promise<void> {
  const path = contextPath()

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, makeDefaultContext(), 'utf8')
    log.info({ path }, 'context.md bootstrapped')
  }

  const result = await withLease(
    'context:write',
    async () => {
      const raw = readFileSync(path, 'utf8')
      const dated = `- [${new Date().toISOString().slice(0, 10)}] ${entry.trim()}`
      const heading = `## ${section}`
      // Handle heading at position 0 (no leading newline) as well as mid-file.
      const headingAtStart = raw.startsWith(`${heading}\n`) || raw.startsWith(`${heading}`)
      const headingIdx = headingAtStart ? 0 : raw.indexOf(`\n${heading}`)
      // headingStart is the index of the `#` character; afterHeading skips past the heading line.
      const headingStart = headingIdx === 0 ? 0 : headingIdx + 1
      const afterHeading = headingStart + heading.length

      let newContent: string
      if (headingIdx === -1) {
        // Section not found — create it at the end
        newContent = raw.trimEnd() + `\n\n${heading}\n${dated}\n`
      } else {
        // Find where this section ends (next ## heading or EOF)
        const nextHeadingIdx = raw.indexOf('\n## ', afterHeading)
        const insertAt = nextHeadingIdx === -1 ? raw.length : nextHeadingIdx
        newContent = raw.slice(0, insertAt).trimEnd() + '\n' + dated + '\n' + raw.slice(insertAt)
      }

      // Update frontmatter `updated` date
      newContent = newContent.replace(
        /^updated: \d{4}-\d{2}-\d{2}/m,
        `updated: ${new Date().toISOString().slice(0, 10)}`,
      )

      writeFileSync(path, newContent, 'utf8')
      log.info({ section, path }, 'context appended')
    },
    { leaseMs: 15_000 },
  )

  if (result === null) {
    throw new Error('context write skipped: lease busy')
  }
}

/**
 * Formats the ## Domain Authority section as a clear system-prompt directive.
 * Included in assembleSystemPrompt() so the model knows what it can and cannot do
 * without being told per-request.
 *
 * Returns '' if context.md doesn't exist or has no Domain Authority section.
 */
export function loadDomainAuthorityPolicy(): string {
  const path = contextPath()
  if (!existsSync(path)) return ''

  try {
    const raw = readFileSync(path, 'utf8')
    const sections = parseContextSections(raw)
    const section = sections.find((s) => s.name === 'Domain Authority')
    if (!section || !section.content.trim()) return ''

    const entries = section.content
      .split('\n')
      .filter((l) => /^-\s+.+:\s+(suggest|draft|act)/i.test(l))

    if (entries.length === 0) return ''

    const lines = entries.map((e) => {
      const m = e.match(/^-\s+(.+?):\s+(suggest|draft|act)/i)
      if (!m) return e
      const [, domain, level] = m
      // eslint-disable-next-line no-control-regex
      const safeDomain = domain!.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').trim()
      if (level!.toLowerCase() === 'suggest')
        return `  - ${safeDomain}: PROPOSE only — write the action text, show it, do not execute.`
      if (level!.toLowerCase() === 'draft')
        return `  - ${safeDomain}: DRAFT — execute but surface output for confirmation before external effect.`
      return `  - ${safeDomain}: ACT — execute with a 60-second confirmation window.`
    })

    return `## Domain Authority (current trust levels)\n\nBefore any tool execution, apply these domain rules:\n${lines.join('\n')}\n\nAny domain not listed above defaults to PROPOSE only.`
  } catch {
    return ''
  }
}

/**
 * Domain authority check — reads `## Domain Authority` section from context.md.
 * Returns the authority level for a domain, defaulting to 'suggest'.
 * Format: `- domain-name: Level`
 */
export function getDomainAuthority(domain: string): 'suggest' | 'draft' | 'act' {
  const path = contextPath()
  if (!existsSync(path)) return 'suggest'

  try {
    const raw = readFileSync(path, 'utf8')
    const sections = parseContextSections(raw)
    const authoritySection = sections.find((s) => s.name === 'Domain Authority')
    if (!authoritySection) return 'suggest'

    const lines = authoritySection.content.split('\n')
    for (const line of lines) {
      const m = line.match(/^-\s+(.+?):\s+(suggest|draft|act)\b/i)
      if (m && m[1]!.toLowerCase().includes(domain.toLowerCase())) {
        return m[2]!.toLowerCase() as 'suggest' | 'draft' | 'act'
      }
    }
  } catch {
    // fall through
  }

  return 'suggest'
}
