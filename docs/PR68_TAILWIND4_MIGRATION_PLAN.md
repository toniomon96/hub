# Hub PR #68 Tailwind 4 Migration Plan

Status: targeted dependency blocker plan.

Owner repo: `hub`

Purpose: keep PR #68 parked until the Tailwind 4 dependency migration is fixed
or deliberately replaced by a smaller, safer PR.

## Current Reading

The workspace roadmap treats PR #68 as the active visible Hub dependency
blocker. GitHub may mark the PR mergeable, but the roadmapped blocker is that
typecheck and build-test checks fail. Do not merge on mergeability alone.

## Migration Path

1. Inspect the PR diff and failing checks.
2. Reproduce locally on the PR branch.
3. Identify whether failures come from Tailwind config, CSS entrypoints,
   PostCSS/Vite plugin wiring, generated types, or downstream component usage.
4. Prefer the smallest fix that restores current behavior.
5. If the PR mixes unrelated dependency changes, close or replace it with a
   narrower Tailwind-only migration PR.
6. Record any config or package-manager decision in Hub docs if it changes the
   runtime shape.

## Required Gates Before Merge

Run the Hub-local gate set on the fixed branch:

```powershell
pnpm format:check
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm hub doctor
pnpm verify
```

If a command is unavailable or superseded, record the current command and the
reason in the PR notes before merging.

## Out Of Scope

- No consulting copy changes.
- No Hub-as-CRM expansion.
- No prompt/registry changes.
- No Supabase schema or environment changes.
- No live intake submission from this dependency plan.

