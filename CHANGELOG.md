# Changelog

All notable changes are listed here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versioning is CalVer-ish (`0.MAJOR.MINOR+YYYY-MM-DD`) — no SemVer ceremony.

Conventional Commits drive release notes; this file captures the human-facing summary.

## [Unreleased]

### Added

- Process bootstrap: issue + PR templates, Dependabot, split CI jobs, CodeQL + gitleaks + pnpm audit workflows, release workflow on tag, husky pre-commit/pre-push with lint-staged, `pnpm verify` one-shot gate.

### Changed

- `getLogger()` is now lazy: returns a proxy that defers `loadEnv()` + pino construction to first property access, so modules can hold `const log = getLogger('x')` at top level without making tests pay the env-schema cost at import time. New `_resetLoggerCache()` hook for tests that re-seed env.
- CI: build-test matrix extended to `{ubuntu-24.04, windows-latest} × {Node 22, 24}`; new `smoke-cli` job runs `hub migrate` + `hub doctor` against a tmp DB to catch ESM/`node:sqlite` wiring regressions.

### Changed

- Security workflow's `deps-audit` job now runs on Node 22 (was 20, below the repo's `>=22.5.0` engines floor).

### Changed

- `packages/shared/testing/vitest-sqlite-shim.ts`: single source for the `node:sqlite` / `node:test` Vite shim. `db`, `capture`, `agent-runtime`, and `server` vitest configs now import it instead of each carrying their own copy (~120 lines of duplication removed).

### Fixed

- `runBrief` day window is now evaluated in `HUB_TIMEZONE`, not UTC. Previous behavior silently dropped captures and runs whose `receivedAt`/`startedAt` fell into the tz-offset gap at either end of the local day. New `dayStartMs(date, tz)` handles DST transitions correctly (Europe/Madrid spring-forward = 23h, fall-back = 25h, both tested). `HUB_TIMEZONE` default changed from `America/Chicago` to `UTC` — `deploy/env.template` still sets `America/Chicago` explicitly for the VPS.

### Changed

- Documented the Drizzle-vs-raw-`node:sqlite` split in `DECISIONS.md` (2026-04-23) and cross-referenced from `ARCHITECTURE.md` and `packages/db/src/locks.ts`. Intent: make the mixed approach a durable, defensible decision instead of reading like half-finished cleanup.

## [0.3.0] — 2026-04-21

### Added

- v0.3 MVP scaffold: privacy-gated model router, Drizzle + `node:sqlite` schema + migrations, `hub migrate`, capture ingest with content-hash dedup, Agent SDK `query()` wiring, Hono webhook stubs, CLI (`status`, `capture`, `brief`, `ask`).
