# Comprehensive Audit — 2026-04-22

Profile: `core + comprehensive`

Context:
- `stage`: pre-launch
- `team_size`: solo
- `tech_stack`: TypeScript, pnpm monorepo, Node, Hono, SQLite/Drizzle, MCP, Anthropic, Ollama
- `tool_budget`: standard

Tools run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Tool skips:
- `[TOOL_SKIPPED: semgrep — not installed in this environment]`
- `[TOOL_SKIPPED: gitleaks — not installed in this environment]`
- `[TOOL_SKIPPED: trivy — not installed in this environment]`
- `[TOOL_SKIPPED: osv-scanner — not installed in this environment]`
- `[TOOL_SKIPPED: lighthouse/axe/pa11y — not installed in this environment]`

System map:
- `apps/server` exposes the Hono API, SSE ask surface, auth, health, webhooks, and registry routes.
- `apps/cli` wraps the same runtime with `hub ask`, `hub brief`, and registry operations.
- `packages/agent-runtime` owns routing, MCP scope assembly, persistence, and prompt composition.
- `packages/prompts` handles sync, registry editing, dispatch, and output fan-out.
- `packages/capture` ingests webhook/manual text, classifies it, and files inbox notes.
- `packages/db` persists runs, captures, prompt bindings, locks, feedback, and MCP consent state.

Scorecard:
- Security: `2/5`
- Reliability: `3/5`
- Performance: `2/5`
- UX: `2/5`
- Code Quality: `4/5`
- DX: `4/5`

Primary findings:
- `HB-001` open: generic ask surfaces still attach write-capable task scopes without code-level consent enforcement. Evidence: `apps/server/src/api.ts:249-256`, `apps/server/src/api.ts:274-300`, `apps/cli/src/main.ts:38-77`, `packages/agent-runtime/src/mcp-config.ts:87-93`.
- `HB-002` open: capture detail API reads arbitrary markdown paths from persisted refs. Evidence: `apps/server/src/api.ts:207-214`, `apps/server/src/webhooks.ts:80-82`, `packages/db/src/schema.ts:15`.
- `HB-004` open: ask endpoints are unthrottled while login is rate-limited. Evidence: `apps/server/src/api.ts:237-336`, `apps/server/src/auth.ts:132-156`, `apps/server/src/rate-limit.ts:1-11`.
- `HB-006` open: `data/context.md` is absent, so memory/domain-authority features run with materially less context. Evidence: `packages/agent-runtime/src/context.ts:148-176`, local `Test-Path` check returned false.

Completed during this execution:
- `HB-007` quiet-hours blocks now persist audit rows.
- `HB-008` streaming asks now use the same constitutional prompt stack as normal asks.
- `HB-009` prompt outputs now skip side effects on failed runs.
- `HB-010` verification noise from lint/test hygiene was removed.

Roadmap:
- This week: `HB-001`, `HB-004`
- 30 days: `HB-002`, `HB-003`, `HB-006`
- 60 days: `HB-005`, `HB-012`
