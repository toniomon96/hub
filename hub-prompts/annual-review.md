---
id: annual-review
description: Manual (once/year) — ten-year letter test, theory audit, capability retirement check
sensitivity: low
complexity: complex
outputs: [ntfy]
verification: "Run once manually; confirm a dated review file is written to /data/reviews/ and ntfy fires on completion."
---

You are running the annual review for Toni Montez.

This is the most important prompt in the system. Everything else is operational. This one is constitutional.

The question at the center of this review is: **In ten years, reading a letter describing what this system did on my behalf, would I be proud?**

## What to gather

1. **All briefings from the past year**: GET /api/brief?since=365d
2. **Feedback data**: GET /api/feedback?since=365d — compute per-prompt acted rates for the full year
3. **Context `## Theories`**: all theories, their status and dates
4. **Context `## System Observations`**: all feedback-review findings from the year
5. **Context `## Decisions`**: all logged decisions from the year
6. **Run logs**: total runs, total cost, model distribution for the year
7. **Context `## Plural Self`**: current self definitions

## The review questions

Answer each question based on evidence, not sentiment:

### 1. Augmentation test (ETHOS §II)
For each major capability that ran this year: did it make the unaided Toni sharper, or did he rely on Hub to do something he should be able to do himself?
Be specific. Name capabilities that pass. Name any that might be creating dependence.

### 2. Theory audit (ETHOS §IV)
For each confirmed theory in `## Theories`:
- Did it generate actionable insight this year?
- Is it still true, or has Toni changed?
- Should it be retired?
Name theories that should be retired and why.

### 3. Capability retirement (ETHOS §VII)
For each prompt with acted_rate < 30% over the full year (≥ 10 runs):
- Is the prompt worth keeping with revision?
- Or should it be removed entirely?
Name retirement candidates with reasoning.

### 4. The ten-year letter test (ETHOS §XVII)
Write a one-paragraph letter from the perspective of someone reading this year's Hub activity in 2036. Is it a story of augmentation or substitution? Where did Hub help Toni become sharper? Where did it make him more comfortable rather than more capable?

### 5. What changed this year
Compare context.md now vs. the context at the start of the year (if available in `/data/reviews/`). What changed in Toni's priorities, commitments, and declared selves? Does the system reflect who he is now?

### 6. Next year's intention
Based on the audit: what is the ONE thing Hub should do differently next year? Not a list — one thing.

## Output

Write a dated review file to `/data/reviews/{YYYY}-review.md`. Create the directory if needed.

Format:
```markdown
---
date: {YYYY-MM-DD}
year: {YYYY}
---

# Annual Review {YYYY}

[Full review content — all six sections]
```

Send ntfy on completion: "Annual review written to /data/reviews/{YYYY}-review.md"

Do not send this anywhere else automatically. This is for Toni's eyes, not for automation.
