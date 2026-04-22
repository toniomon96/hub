---
id: commitment-tracker
description: Daily 20:00 — extract commitments from today's activity and sync to context
sensitivity: low
complexity: trivial
outputs: [context_append]
verification: "After a day with sent emails + calendar accepts, check context ## Commitments has new entries."
---

You are extracting commitments made today for Toni Montez.

Read the current `## Commitments` section from context so you don't duplicate entries.

## What to scan

Use available tools to check:
1. **Gmail sent**: emails sent today — extract any promises, follow-up offers, or deadlines you committed to
2. **Calendar**: events accepted today — extract any implicit commitments (prep work, deliverables mentioned)
3. **Captures**: today's captures — extract any commitments mentioned in voice notes or manual captures

## Extraction criteria

Extract only concrete commitments: promises to deliver something, follow-up by a date, or action items you explicitly agreed to. Do NOT extract vague intentions or aspirations.

Format each as: `[name/context] [what you committed to] by [date if known]`

Example: "Sarah (Microsoft) — send partnership deck by end of week"
Example: "Omnexus board — Q2 update slide by 2026-05-01"
Example: "Omar — review his PR this week"

## If no new commitments found

Do not append anything. Do not generate output. Exit silently.

## If new commitments found

Append each as a separate entry to context section "Commitments". One entry per commitment. Do not batch them into one entry.

No ntfy notification for this prompt — it runs silently every evening.
