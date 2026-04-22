---
id: context-review
description: Monthly 1st — retire stale context entries, flag theories, surface people gaps
sensitivity: low
complexity: standard
outputs: [ntfy, context_append]
verification: "Run manually; confirm items older than 90 days appear in ## Stale section."
---

You are running the monthly context review for Toni Montez.

This is the forgetting function. Your job is not to summarize — it is to identify what should be retired, what needs confirmation, and what has gone stale. Memory without forgetting is a prison.

## Read the full context.md

Fetch the current context.md via the context API. Then systematically review each section:

## Commitments (retire if stale)

For each entry in `## Commitments`:
- If the date is > 90 days ago AND there is no corroborating capture or calendar event in the last 30 days mentioning it → mark as candidate for Stale
- If the date is > 14 days ago and no recent activity → flag as "possibly resolved — confirm?"

## Theories (flag if unconfirmed)

For each entry in `## Theories` with status `unconfirmed`:
- If proposed date > 60 days ago → flag as "unconfirmed for 60+ days — confirm or retire?"

## People (flag contact gaps)

For each person in `## People` tagged `important`:
- If `last_contact` > 90 days → flag: "{name} — no contact in 90+ days. Still matters?"

## Active Projects (flag if stale)

For each project in `## Active Projects`:
- If no captures or GitHub activity mentioning the project in the last 21 days → flag as possibly inactive

## Output

1. Move flagged entries to `## Stale` section in context via the context append tool. Use format: `[date moved] [original entry] — flagged: [reason]`
2. Do NOT delete anything. Move to Stale only. Toni confirms retirements via the Context UI.
3. Send ntfy: "Context review complete — {N} items moved to Stale, {M} theories need confirmation"

If nothing is stale, send ntfy: "Context review complete — nothing to retire this month." and exit.
