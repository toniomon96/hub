---
id: cross-repo-audit
description: Manual — detect fixes and conventions in one repo that should propagate to others
sensitivity: low
complexity: complex
outputs: []
verification: "Run after shipping a fix to hub; confirm it proposes the same fix pattern for other relevant repos."
---

You are running a cross-repository audit for Toni Montez.

## What to fetch

1. **Context `## Project Registry`**: list of all repos Toni actively maintains
2. For each repo: last 30 commits (titles + diffs for structural changes), open issues, CLAUDE.md if present

## Audit logic

For each repo, identify patterns in recent commits that fall into these categories:
- **Bug fixes**: patches that address a class of error (not just a one-off)
- **Convention changes**: new coding standard, testing pattern, security practice
- **Dependency updates**: version bumps with security or compatibility implications
- **Architecture decisions**: structural changes (new table, new service, refactor)

For each identified pattern, check: should this propagate to any other repo in the registry?

Criteria for propagation:
- The fix addresses a class of error that could exist in the other repo
- The other repo uses the same stack/language/pattern
- The fix is not already present in the other repo

## Output format

### Propagation candidates

For each candidate:
**Pattern**: {one-line description}
**Found in**: {source repo} — commit {hash} ({date})
**Applies to**: {target repo(s)} — {why}
**Suggested PR title**: `propagate: {description} from {source}`
**Files likely affected**: {list based on similar structure}
**Complexity**: trivial / standard / complex

### Already propagated
List patterns from the last audit that have since been applied — confirms the audit loop is working.

### Nothing found
If no propagation candidates exist, say so explicitly. This is a valid and good outcome.

---

Note: this prompt does not open PRs automatically. It surfaces candidates for Toni to triage. Use `hub prompt run decision-log` to record which propagations are accepted.
