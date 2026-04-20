# Contributing (solo edition)

This is a solo-maintainer repo. These rules exist to keep future-me honest.

## Workflow

1. Pick or file an issue. Label it (`type:*`, `area:*`, priority, risk).
2. Branch: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. **Max 48h lifetime.**
3. Commit in [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `sec:`.
4. Open a PR early. Self-review against the checklist in the PR template.
5. CI must be green: `lint`, `typecheck`, `build-test (20)`, `build-test (24)`, `codeql`, `deps-audit`, `secrets-scan`.
6. **Squash-merge.** Linear history only.

## Local dev

```pwsh
pnpm install
pnpm verify    # format:check + lint + typecheck + test + build
```

Husky hooks:

- `pre-commit` → `lint-staged` (eslint --fix + prettier)
- `pre-push` → `pnpm typecheck && pnpm -r test`

## Definition of Done

See PR template. Load-bearing changes (privacy router, DB locks, capture classifier,
Gmail send, migrations) get the `load-bearing` label and extra test scrutiny.

## Decisions

Append to [DECISIONS.md](./DECISIONS.md) when a load-bearing choice changes.
Do not create `docs/adr/` — one file, newest at the bottom.

## Releases

Tag `v0.X.Y+YYYY-MM-DD`. `release.yml` builds artifacts and generates notes from
Conventional Commits.
