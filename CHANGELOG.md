# Changelog

All notable changes are listed here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versioning is CalVer-ish (`0.MAJOR.MINOR+YYYY-MM-DD`) — no SemVer ceremony.

Conventional Commits drive release notes; this file captures the human-facing summary.

## [Unreleased]

### Added

- Process bootstrap: issue + PR templates, Dependabot, split CI jobs, CodeQL + gitleaks + pnpm audit workflows, release workflow on tag, husky pre-commit/pre-push with lint-staged, `pnpm verify` one-shot gate.
- `apps/server/src/__tests__/capture-ollama-mock.test.ts`: regression test pinning the apps/server → capture → classify → `@hub/models/ollama` import graph so mocks intercept across workspace boundaries.

### Changed

- `packages/capture/tsup.config.ts` sets `bundle: false` — each dist entry preserves its cross-package imports (notably `@hub/models/ollama`) rather than hoisting them into opaque shared chunks, keeping the classifier mockable from outside the package.
- `apps/server/vitest.config.ts` aliases `@hub/capture/*` and `@hub/models/*` to their `src/*.ts` sources for tests, so Vite transforms the full import graph and `vi.mock()` intercepts at any hop.

### Changed

- `getLogger()` is now lazy: returns a proxy that defers `loadEnv()` + pino construction to first property access, so modules can hold `const log = getLogger('x')` at top level without making tests pay the env-schema cost at import time. New `_resetLoggerCache()` hook for tests that re-seed env.
- CI: build-test matrix extended to `{ubuntu-24.04, windows-latest} × {Node 22, 24}`; new `smoke-cli` job runs `hub migrate` + `hub doctor` against a tmp DB to catch ESM/`node:sqlite` wiring regressions.

### Changed

- Security workflow's `deps-audit` job now runs on Node 22 (was 20, below the repo's `>=22.5.0` engines floor).

### Changed

- `packages/shared/testing/vitest-sqlite-shim.ts`: single source for the `node:sqlite` / `node:test` Vite shim. `db`, `capture`, `agent-runtime`, and `server` vitest configs now import it instead of each carrying their own copy (~120 lines of duplication removed).

### Changed

- `apps/server` dev loop now uses `tsup --watch --onSuccess` instead of `tsx watch`, which was silently swallowing `node:sqlite` imports under the repo's Node 24 + Windows arm64 combo. `pnpm dev:tsx` preserved as fallback.

## [0.3.0] — 2026-04-21

### Added

- v0.3 MVP scaffold: privacy-gated model router, Drizzle + `node:sqlite` schema + migrations, `hub migrate`, capture ingest with content-hash dedup, Agent SDK `query()` wiring, Hono webhook stubs, CLI (`status`, `capture`, `brief`, `ask`).
