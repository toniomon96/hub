# Hub Dependency Cleanup Assessment - May 14, 2026

Status: assessment only. No dependency PRs were merged, closed, rebased, or
modified.

## Result

Hub `main` is healthy. The cleanup lane should target the two current open
Dependabot PRs, not the older PR #68 pointer.

## Current Evidence

| Surface | State | Evidence |
|---|---|---|
| Local `main` | Clean and current | `main...origin/main` before assessment. |
| `pnpm verify` on `main` | Pass | Format, lint, build, typecheck, and tests passed locally. |
| PR #68 | Closed | Old Tailwind 4.2.4 PR is no longer the active blocker. |
| PR #77 | Open, conflicting | `@hono/zod-openapi` 0.18.4 to 1.4.0; touches `apps/server/package.json` and `pnpm-lock.yaml`; CI has failing build-test jobs. |
| PR #78 | Open, conflicting | `tailwindcss` 3.4.19 to 4.3.0; touches `apps/web/package.json` and `pnpm-lock.yaml`; CI has failing typecheck/build-test jobs. |

## Recommendation

Handle this as two narrow dependency cleanup branches:

1. Resolve or close/replace PR #77 first.
   - It is server/API-adjacent and should be checked before the visual Tailwind
     migration.
   - Rebase/recreate the Dependabot branch or create a manual branch only after
     confirming the lockfile conflict.
   - Required gates: `pnpm verify` and `pnpm security:secrets`.
2. Resolve or close/replace PR #78 second.
   - Treat Tailwind 4 as a real migration, not a routine patch.
   - Reproduce typecheck/build-test failures locally before changing UI code.
   - Keep the change scoped to package/config/CSS compatibility.

Do not mix these with consulting site copy, DTP source-of-truth docs, Hub
runtime expansion, intake cleanup, Supabase schema changes, or prompt/registry
mutation.

## What Not To Do Yet

- Do not build Hub archive/delete runtime cleanup until the dependency lane is
  green or explicitly deferred.
- Do not use Hub as a Practice OS source of truth.
- Do not submit live consulting intake test rows unless scope and cleanup are
  explicit.
- Do not treat old PR #68 as active except as historical evidence of the same
  Tailwind migration risk.

## Next Action

Start with PR #77 because it is smaller and server-scoped. If it still conflicts
after Dependabot rebase/recreate, close it and open a manual `chore(deps)` branch
with the same package bump plus the smallest lockfile repair.
