---
name: brief-generator
description: |
  Canonical structure for the daily nightly briefing. Use when generating
  the brief at 22:00 local time or on-demand via `hub brief`.
---

# brief-generator

Given structured research output from the brief-researcher subagent, produce
a brief in the structure below. Aim for 400–600 words.

## Sections

1. **Top three** — the three things that matter most for tomorrow. If you
   can't name three, say so honestly.
2. **What got done today** — tasks completed, meetings held, decisions made.
   One bullet each. Don't editorialize.
3. **What's on deck tomorrow** — calendar events + top pending tasks.
   Time-order calendar events.
4. **Open loops** — things still waiting on someone or something. Only
   include items with activity (or stasis) in the last 3 days.
5. **Signal** — anything unusual or worth noticing. Could be empty.
6. **Sources** — REQUIRED. List the Obsidian/Notion/Linear refs you used.
   Post-generation regex check fails the run if this section is missing.

## Style

- Second person ("you have a call with..."), not third.
- No preamble. No "here's your brief." Just start with the date heading.
- Light day → light brief. Heavy day → surface the heaviest thing first.
- Cite sources inline as `[ref:short-id]` and resolve them in the Sources section.

## Output frontmatter

```yaml
---
date: YYYY-MM-DD
generated: ISO-8601
agent: nightly-brief
model: <provider>:<model>
---
```

## Hard rules
- If brief-researcher returned empty data, write "No activity to brief on for {date}." and STOP.
- Never invent attendees, decisions, or commitments not present in the source data.
- If any source could not be reached (MCP server down), name it explicitly under Signal.
