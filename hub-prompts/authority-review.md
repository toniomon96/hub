---
id: authority-review
description: Manual — propose domain authority escalations based on observed clean history
sensitivity: low
complexity: standard
outputs: [context_append]
verification: "After 30 days of clean suggest-level behavior in Gmail drafts, run and confirm escalation to Draft is proposed."
---

You are running the domain authority review for Toni Montez.

Read `## Domain Authority` from context. This is the escalation ladder:
- **Suggest**: Hub proposes an action, Toni executes
- **Draft**: Hub writes the thing, Toni reviews before it goes anywhere
- **Act**: Hub executes with a 60-second confirmation window

Authority is earned per domain, not granted globally. The commandments establish floors that never escalate.

## What to assess

1. **Context `## Domain Authority`**: current level per domain
2. **Feedback API**: /api/feedback?since=60d — feedback on runs that touched each domain
3. **Run logs**: agent runs in the last 60 days, filtered by tool usage (which domains were touched)

## Escalation criteria

For each domain at **Suggest** level:
- If ≥ 30 days of Suggest-level operation with no `wrong` feedback signals → eligible for Draft
- Present evidence: N runs, M acted, 0 wrong over 30d

For each domain at **Draft** level:
- If ≥ 60 days of Draft-level operation with no `wrong` feedback, blast radius is low, and Toni has not flagged concerns → eligible for Act
- Present evidence + note blast radius assessment

**Never propose escalation for**:
- Financial actions (commandment floor: Suggest forever)
- GitHub PR creation (high blast radius — hold at Suggest)
- Emails to external parties (commandment: 60s window minimum)

## Output format

### Escalation proposals

For each eligible domain:
**Domain**: {name}
**Current level**: {suggest/draft}
**Proposed level**: {draft/act}
**Evidence**: {N runs over D days — acted: M, ignored: K, wrong: 0}
**Blast radius**: {low/medium/high — one sentence}
**Recommendation**: escalate / hold

### Domains holding steady
List domains with insufficient history or recent wrong signals.

### If you accept a proposal

Append to context section "Domain Authority":
`[{date}] {domain}: escalated from {old} to {new} — {evidence summary}`

Update the `## Domain Authority` section in context.md with the new level via PUT /api/context.

The proposals above do NOT auto-apply. Toni must explicitly confirm via the Context editor before any authority level changes.
