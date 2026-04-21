# Changelog

All notable changes are listed here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versioning is CalVer-ish (`0.MAJOR.MINOR+YYYY-MM-DD`) — no SemVer ceremony.

Conventional Commits drive release notes; this file captures the human-facing summary.

## [Unreleased]

### Added

- **v0.5 #1: zod-openapi contracts.** All HTTP shapes live in `@hub/shared/contracts` (subpath export) as zod schemas. `apps/server/src/api.ts` is rewritten on `OpenAPIHono` + `createRoute`, and the server emits an OpenAPI 3.0 document at `GET /api/openapi.json` (gated by the `/api/*` auth middleware). PR #2 (generated web + CLI client) consumes this spec; until then, `apps/web/src/api.ts` keeps its hand-rolled types.
- `apps/server/src/rate-limit.ts` grows a periodic `sweep()` + `startSweeper()` (unref'd hourly `setInterval`) that evicts client buckets whose attempts are all older than the long window. Prevents unbounded Map growth if an attacker rotates IPs. Called from the server bootstrap.
- `@hub/shared/testing/test-env` exports `seedTestEnv()` + `restoreTestEnv()` — seeds the minimum env (`ANTHROPIC_API_KEY`, `HUB_SKIP_DOTENV=1`, `HUB_LOG_LEVEL=fatal`) every suite needs so `loadEnv()` doesn't throw in CI where no `.env` exists. Replaces scattered per-suite `process.env[...] = ...` blocks.
- `HUB_MCP_STRICT` env flag (default `0`). When `1`, `buildMcpScopes()` filters out any MCP server whose stdio command+args (or HTTP URL) is not on the hardcoded allowlist in `packages/agent-runtime/src/mcp-config.ts`. In the default permissive mode, unknown servers are still spawned but logged at `warn`. Planned to flip default to `1` in v0.6.
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

### Security

- `HUB_COOKIE_SECRET` and `HUB_UI_TOKEN` are now treated as distinct secrets. Prior behavior reused the bearer token as the cookie HMAC key whenever `HUB_COOKIE_SECRET` was blank, so a leak of one compromised both. `loadEnv()` now refuses to return with `NODE_ENV=production` unless `HUB_COOKIE_SECRET` is set AND differs from `HUB_UI_TOKEN`; dev-mode falls back to a derived-but-distinct secret and warns on stderr. `apps/server/src/auth.ts` dropped its `|| HUB_UI_TOKEN` fallback. `deploy/env.template` updated.

### Changed

- `apps/server` dev loop now uses `tsup --watch --onSuccess` instead of `tsx watch`, which was silently swallowing `node:sqlite` imports under the repo's Node 24 + Windows arm64 combo. `pnpm dev:tsx` preserved as fallback.

### Security

- `/auth/login` is now rate-limited per client (5 failed attempts / minute, 20 failed attempts / hour, sliding window, in-process `Map`). Successful login clears the bucket. Returns `429` with `Retry-After` on block. Client key is derived from `x-forwarded-for` (cloudflared) then `cf-connecting-ip` then a shared `unknown` bucket. Closes a theoretical brute-force surface on the UI bearer token.

## [0.3.0] — 2026-04-21

### Added

- v0.3 MVP scaffold: privacy-gated model router, Drizzle + `node:sqlite` schema + migrations, `hub migrate`, capture ingest with content-hash dedup, Agent SDK `query()` wiring, Hono webhook stubs, CLI (`status`, `capture`, `brief`, `ask`).
