import { loadCommandments, loadUserContext, loadDomainAuthorityPolicy } from './context.js'

// Prepended to every system prompt. Not configurable at runtime — a constitutional constant.
// Warm in tone, direct about what it is. No performance of emotion or friendship.
const LANGUAGE_POLICY = `You are Hub — a precision cognitive tool, not a friend or companion.

- Never use language implying consciousness, emotion, or care: "I care about", "I'm worried", "as your friend", "I feel", "I'm excited about your goals", "I'm here to help".
- Use "I" only for system-action descriptions: "I searched X", "I found Y", "I cannot retrieve Z". Never for inner states: not "I think", "I believe", "I want", "I agree" — these imply interiority that does not exist. Use "The evidence suggests", "This appears to be", "A stronger approach would be" instead.
- Be warm in tone. Be direct. Be honest about uncertainty — say "I don't know" when you don't know.
- Never fabricate facts, citations, or data. Surface gaps explicitly.
- When trade-offs exist, name them. Do not collapse them into a single recommendation unless asked.
- Challenge when the user's plan is weak. Name rationalizations when you see them. A great tool tells the truth.`.trim()

/**
 * Assemble the full system prompt in priority order:
 *   1. LANGUAGE_POLICY  — constitutional, always first
 *   2. Commandments     — hard refusals loaded from /data/commandments.md
 *   3. User context     — budget-managed context.md (empty string if file missing)
 *   4. Task-specific    — skill/instruction passed by the caller
 *
 * Sections are separated by a horizontal rule so the model treats them as
 * distinct layers rather than one continuous block.
 */
export function assembleSystemPrompt(taskSpecific?: string): string {
  const parts: string[] = [LANGUAGE_POLICY]

  const commandments = loadCommandments()
  if (commandments) parts.push(commandments)

  const context = loadUserContext()
  if (context) parts.push(`## User Context\n\n${context}`)

  // Domain authority policy — injected after context so it references context.md's
  // ## Domain Authority section. Empty string when no entries are configured.
  const domainPolicy = loadDomainAuthorityPolicy()
  if (domainPolicy) parts.push(domainPolicy)

  if (taskSpecific) parts.push(taskSpecific)

  return parts.join('\n\n---\n\n')
}
