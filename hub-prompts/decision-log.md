---
id: decision-log
description: Manual — log an architectural or life decision to context and affected repos
sensitivity: low
complexity: trivial
inputs_schema: '{"decision": "string", "reasoning": "string", "repos": "string (comma-separated, optional)"}'
outputs: [context_append]
verification: "Run with a real decision; confirm it appears in ## Decisions and a GitHub issue is opened in each affected repo."
---

You are logging a decision for Toni Montez.

Args: `decision` (the choice made), `reasoning` (why), `repos` (comma-separated repo slugs, optional).

## What to do

1. **Append to context `## Decisions`**:
   Format: `[{today's date}] {decision} — {reasoning}`
   Example: `[2026-04-21] Switched brief body storage to DB column — Railway can't read Obsidian vault; DB is accessible from any process.`

2. **If repos provided**: For each repo in `repos`:
   - Open a GitHub issue titled: `Decision: {decision}`
   - Body: `## Decision\n{decision}\n\n## Reasoning\n{reasoning}\n\n## Date\n{today}\n\nThis issue was logged automatically by Hub's decision-log prompt. See context.md ## Decisions for full history.`
   - Label: `decision` (create label if it doesn't exist)

3. **Confirm output**:
   List what was done: context appended ✓, GitHub issues opened: {list}.

## Notes

- Do not edit existing decisions. Only append new ones.
- If a repo doesn't exist or you can't access it, note the failure and continue with the others.
- This runs fast — no waiting on approval. Logging decisions is always safe.
