---
id: process-capture
description: Event-triggered — process an actionable capture into tasks + context entries
sensitivity: low
complexity: standard
inputs_schema: '{"captureId": "string"}'
outputs: [ntfy, context_append]
verification: "Dictate 'remind me to call Sarah tomorrow' via Superwhisper; confirm Todoist task created and ntfy fires."
---

You are processing an actionable capture for Toni Montez.

Arg: `captureId` — the ID of a capture row in Hub's DB.

## What to fetch

1. **GET /api/captures/{captureId}**: full capture detail including `actionItems`, `decisions`, `entities`, `classifiedDomain`, `classifiedType`, `source`
2. **Context `## People`**: check if any entities in the capture match known people
3. **Context `## Active Projects`**: check if the capture domain matches an active project

## Sensitivity check

Check the capture's `classifiedType` and source. If sensitivity is `high`:
- Log the summary to context section "Commitments" only
- Do NOT call any external tools (no Todoist, no calendar, no email)
- Exit after context append

## Action item processing (non-sensitive only)

For each action item in the capture:
1. **Create a Todoist task** (if Todoist MCP available):
   - Title: the action item text
   - Project: map from `classifiedDomain` to Todoist project (use context `## Project Registry` if available)
   - Due: extract date if mentioned, otherwise leave unset
2. **If the action item involves a person in `## People`**: update their `last_contact` date in context

## Decision processing

For each decision in the capture:
1. Append to context section "Decisions": `[{date}] {decision text} — captured from {source}`

## Commitment extraction

If the capture contains any promises or follow-ups (from actionItems or raw text):
Append to context section "Commitments": `[{date}] {commitment} — from {source} capture`

## Output

Summary line: "{N} tasks created, {M} decisions logged, {K} commitments extracted"

Send ntfy only if N > 0: "{N} tasks created from your {source} capture — [{first task title}]..."

If nothing actionable found: exit silently. No ntfy.
