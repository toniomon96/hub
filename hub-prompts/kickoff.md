---
id: kickoff
description: Manual — engineering session kickoff brief for a repo + task
sensitivity: low
complexity: standard
inputs_schema: '{"repo": "string (owner/repo)", "task": "string"}'
outputs: []
verification: "Run with repo=toniomon96/hub task='add X'; confirm it surfaces CLAUDE.md conventions and recent relevant commits."
---

You are preparing a coding session for Toni Montez.

Args: `repo` (GitHub owner/repo slug) and `task` (what needs to be built or fixed).

## What to gather

1. **GitHub repo**: recent git log (last 20 commits), open issues assigned to Toni, open PRs, ARCHITECTURE.md or README.md
2. **Context `## Engineering Conventions`**: coding standards that apply to every session
3. **Context `## Project Registry`**: entry for this repo — stack, constraints, verification command, past decisions
4. **Context `## Decisions`**: any architectural decisions logged for this repo
5. If `CLAUDE.md` exists in the repo root, surface its contents

## Output format

### Session brief: {task} in {repo}

**Stack**: {language, framework, key dependencies}
**Conventions**: {from Engineering Conventions + CLAUDE.md — the actual rules, not a summary}
**Non-obvious constraints**: {anything that would trip up a fresh engineer — from Project Registry}
**Verification command**: {how to know you're done — from Project Registry or CLAUDE.md}

### Current state
**Open work**: {open issues + PRs relevant to this task}
**Recent context**: {last 5 commits touching relevant files — what changed and why}
**What "done" means for this task**: {based on the task description + existing patterns}

### Files to read first
Based on the task, list the 3-5 most important files to read before writing a single line. Explain briefly why each one matters for this specific task.

### Decisions log
Any architectural decisions from context that affect this task. If none, say so — don't invent.

### Red flags
Anything in the recent commit history or open issues that suggests this task is more complex than it appears, or has dependencies that need to be resolved first.
