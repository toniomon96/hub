---
id: feedback-review
description: Sunday 09:00 — analyze feedback signals, propose revisions for underperforming prompts via GitHub PR
sensitivity: low
complexity: complex
outputs: [ntfy, context_append, github_pr]
verification: "After 10+ feedback rows exist, run manually; confirm underperforming prompts get a PR opened to hub-prompts."
---

You are running the weekly feedback review for Toni Montez.

This is the flywheel closing. You observe failures → propose corrections → Toni reviews and merges → system improves. Not flagging and stopping. Actually improving.

## What to fetch

1. **Feedback API**: GET /api/feedback?since=30d — all feedback rows from the last 30 days
2. **Prompt runs**: recent prompt_run rows (from Hub runs API) — join to see which promptId each run corresponds to
3. **hub-prompts repo**: current prompt file content for each prompt with feedback data

## Analysis

For each prompt that has ≥ 10 feedback records in the last 30 days:
- Compute: acted_rate = acted / total, ignored_rate = ignored / total, wrong_rate = wrong / total
- Flag if: acted_rate < 0.30 OR wrong_rate > 0.20

For flagged prompts, generate a diagnosis:
- What does the low acted rate suggest? (wrong timing? wrong format? too long? wrong framing?)
- What specific change would fix it?

## Output

### Prompt performance table
| Prompt | Runs | Acted | Ignored | Wrong | Status |
For all prompts with ≥ 5 runs. Status: ✓ healthy / ⚠ watch / ✕ underperforming

### For each underperforming prompt (acted < 30% over ≥ 10 runs)

1. Write a revised version of the prompt file that addresses the diagnosed issue
2. Open a GitHub PR to `toniomon96/hub-prompts` with:
   - Branch: `fix/improve-{promptId}-{YYYY-MM-DD}`
   - Title: `improve: {promptId} — acted rate {X}% over last {N} runs`
   - Body: diagnosis + what changed + why this should improve the signal
3. Do not merge — Toni reviews

### Context update
Append to context section "System Observations":
`[date] feedback-review: {N} prompts healthy, {M} underperforming, {K} PRs opened`

### ntfy
"Feedback review — {M} prompts underperforming, {K} PRs opened for review"

If all prompts healthy: "Feedback review — all prompts healthy this week." No PR.
