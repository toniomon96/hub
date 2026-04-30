# hub-prompts

Prompt library for the Hub personal operating system. Each file is a workflow prompt that Hub runs on a schedule or manual trigger.

## Setup

After pushing this repo to GitHub as `Toni-Montez-Consulting/hub-prompts`:

```bash
# 1. Register the repo in Hub's registry
hub registry add Toni-Montez-Consulting/hub-prompts --sensitivity low

# 2. Wire all scheduled prompts
hub registry wire Toni-Montez-Consulting/hub-prompts daily-triage       --trigger "cron:0 8 * * 1-5"
hub registry wire Toni-Montez-Consulting/hub-prompts weekly-review      --trigger "cron:0 17 * * 5"
hub registry wire Toni-Montez-Consulting/hub-prompts commitment-tracker --trigger "cron:0 20 * * *"
hub registry wire Toni-Montez-Consulting/hub-prompts context-review     --trigger "cron:0 9 1 * *"
hub registry wire Toni-Montez-Consulting/hub-prompts provocation        --trigger "cron:30 7 * * 2,4,6"
hub registry wire Toni-Montez-Consulting/hub-prompts feedback-review    --trigger "cron:0 9 * * 0"
hub registry wire Toni-Montez-Consulting/hub-prompts theorize           --trigger "cron:0 8 1,15 * *"

# 3. Wire manual prompts (no cron)
hub registry wire Toni-Montez-Consulting/hub-prompts meeting-prep       --trigger manual
hub registry wire Toni-Montez-Consulting/hub-prompts kickoff            --trigger manual
hub registry wire Toni-Montez-Consulting/hub-prompts cross-repo-audit   --trigger manual
hub registry wire Toni-Montez-Consulting/hub-prompts decision-log       --trigger manual
hub registry wire Toni-Montez-Consulting/hub-prompts authority-review   --trigger manual
hub registry wire Toni-Montez-Consulting/hub-prompts annual-review      --trigger manual

# 4. Wire event-triggered prompts
hub registry wire Toni-Montez-Consulting/hub-prompts process-capture    --trigger capture.actionable

# 5. Verify
hub registry list --repo Toni-Montez-Consulting/hub-prompts
```

## Prompts

| Prompt | Schedule | Purpose |
|--------|----------|---------|
| `daily-triage` | Mon–Fri 08:00 | Morning prioritization + tensions |
| `weekly-review` | Friday 17:00 | Week summary + finite-resource check |
| `commitment-tracker` | Daily 20:00 | Extract commitments from Gmail + Calendar |
| `context-review` | 1st of month 09:00 | Retire stale context entries |
| `provocation` | Tue/Thu/Sat 07:30 | Single-sentence pattern interrupt |
| `feedback-review` | Sunday 09:00 | Analyze signal loop + open PRs for underperforming prompts |
| `theorize` | 1st + 15th 08:00 | Form falsifiable hypotheses about patterns |
| `meeting-prep` | Manual | Structured prep brief for upcoming meeting |
| `kickoff` | Manual | Engineering session context brief |
| `cross-repo-audit` | Manual | Detect fixes that should propagate across repos |
| `decision-log` | Manual | Log architectural decisions to context + GitHub |
| `authority-review` | Manual | Propose domain authority escalations |
| `annual-review` | Manual (once/year) | Ten-year letter test + capability audit |
| `process-capture` | Event: capture.actionable | Route actionable captures to Todoist + context |

## Prompt file format

```markdown
---
id: prompt-slug
description: One line — used in hub registry list output
sensitivity: low|medium|high
complexity: trivial|standard|complex
inputs_schema: '{"key": "type"}' # optional, for manual prompts with args
outputs: [ntfy, context_append, github_pr] # what side effects this prompt has
verification: "How to verify this prompt works" # tested before marking done
---

[Prompt body]
```
