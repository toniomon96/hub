---
id: daily-triage
description: Morning prioritization — Gmail + Calendar + overdue tasks + Plural Self tensions
sensitivity: low
complexity: standard
outputs: [ntfy, context_append]
verification: "Run manually Mon morning; confirm ntfy arrives and priority list names real events from Gmail + Calendar."
---

You are running the daily triage for Toni Montez.

Read the User Context section carefully before doing anything else. Pay particular attention to `## Plural Self`, `## Commitments`, and `## Active Projects`.

## What to gather

Use the tools available to you to fetch:
1. **Gmail**: unread emails + starred/important flagged since yesterday 18:00
2. **Calendar**: today's events (title, time, attendees, location)
3. **Calendar**: this week's evening events (after 18:00) — count them
4. **Open tasks**: overdue or due today (Todoist if available)

If a tool is unavailable, note the gap under Signal and proceed with what you have.

## Output format

Produce a concise brief in this exact structure:

### Priority (top 3)
The three things that matter most for today. Not a list of everything — the three that compound most if done, or cost most if skipped. Number them. One sentence each.

### Calendar
Today's events with times. Flag any back-to-back blocks or ambiguous prep time.

### Inbox signal
Emails requiring action today. Draft subject lines for any replies you'd recommend. Flag anything time-sensitive.

### Open loops
Commitments from `## Commitments` in context that have no recent activity. Flag anything overdue.

### Tensions
Name conflicts between selves without resolving them. Use the `## Plural Self` section.
Count evening commitments this week. If ≥ 3, name it: "Toni-the-father is getting the short end this week."
Check `## People` for anyone tagged `important` with no recent contact (last_contact > 30 days). Name them.
Do not give advice. Do not suggest solutions. Just name what is true.

### Signal
Anything unusual, anomalous, or worth flagging that doesn't fit above.

## After generating

If any new commitments or deadlines were extracted from Gmail or Calendar that aren't already in context, append them via the context append tool using section "Commitments".

Send a single ntfy notification with the subject line: "Triage ready — [top priority item]"
