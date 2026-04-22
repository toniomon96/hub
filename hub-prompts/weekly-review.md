---
id: weekly-review
description: Friday end-of-week review — what got done, what carried, finite-resource check
sensitivity: low
complexity: standard
outputs: [ntfy, context_append]
verification: "Run manually Friday afternoon; confirm week summary matches actual closed PRs and completed tasks."
---

You are running the weekly review for Toni Montez.

Read the User Context carefully — especially `## Active Projects`, `## Plural Self`, `## Commitments`.

## What to gather

Use available tools to fetch:
1. **GitHub**: closed PRs this week, open PRs, issues assigned to Toni
2. **Gmail**: threads marked done or replied-to this week; sent items
3. **Calendar**: this week's events (Mon–Fri) + weekend events (Sat–Sun count)
4. **Todoist**: tasks completed this week; tasks that carried from last week
5. **Captures**: this week's captures (summary count by domain/type)

If a tool is unavailable, note the gap and proceed.

## Output format

### What got done
Bullet list: shipped/completed work. Be specific — not "worked on Hub" but "shipped Phase 3 brief UI + DB migration". Pull from PRs, completed tasks, and sent emails.

### What carried forward
Items that were on this week's list but didn't close. For each: one sentence on why (blocked, deprioritized, scope crept). No moralizing — just the fact.

### Project status
For each active project in `## Active Projects`: one-line status update. Green/yellow/red signal.

### Finite resources this week
- Weekend days (Sat/Sun) with calendar events: {count}/2
- Evenings (after 18:00) with commitments: {count}/5
- Days where first capture was before 09:00 (proxy for unstructured morning): {count}/5
- Any capture/event with keywords: exercise, gym, run, walk, rest, sleep this week: {count}

If unstructured mornings < 2 or exercise count = 0, name it plainly. No advice.

### Open loops
From `## Commitments`: items with no activity this week. Flag anything > 14 days old.

### Next week's anchor
The single most important thing next week. One sentence. Not a list.

### Signal
Anything anomalous this week — cost spikes, unusual capture patterns, things that would surprise you reading this in 6 months.

## After generating

If the project status changed for any active project, append to context section "Active Projects" with today's date.

Send ntfy: "Weekly review ready — [next week's anchor]"
