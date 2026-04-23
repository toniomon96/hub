# Security Audit — 2026-04-22

Profile: `core + security`

Tools run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Tool skips:
- `[TOOL_SKIPPED: semgrep — not installed in this environment]`
- `[TOOL_SKIPPED: gitleaks — not installed in this environment]`
- `[TOOL_SKIPPED: trivy — not installed in this environment]`
- `[TOOL_SKIPPED: osv-scanner — not installed in this environment]`

Findings:
- `HB-001` open, P1, Risk, `security`: generic ask surfaces still attach `tasks` scope even though the only hard policy is prompt text. Evidence: `apps/server/src/api.ts:253-255`, `apps/server/src/api.ts:297-299`, `apps/cli/src/main.ts:52-76`, `packages/agent-runtime/src/mcp-config.ts:87-93`, `packages/db/src/schema.ts:155-168`.
- `HB-002` open, P2, Risk, `security`: `/api/captures/:id` reads any `.md` path stored in `rawContentRef`, and webhook payloads can supply `ref`. Evidence: `apps/server/src/api.ts:207-214`, `apps/server/src/webhooks.ts:80-82`, `packages/db/src/schema.ts:15`.
- `HB-004` open, P2, Risk, `reliability`: authenticated ask endpoints have no dedicated request throttling. Evidence: `apps/server/src/api.ts:237-336`, `apps/server/src/rate-limit.ts:1-11`.

Closed in this run:
- `HB-007` quiet-hours blocks now leave an audit row in both runtime paths. Evidence: `packages/agent-runtime/src/run.ts:57-78`, `packages/agent-runtime/src/stream.ts:59-73`.
- `HB-009` prompt output side effects now require a successful underlying run. Evidence: `packages/prompts/src/dispatcher.ts:171-188`.

Threat model summary:
- External token holder -> spam `/api/ask` -> cloud/local model spend -> current control: auth token only -> residual risk: medium
- Compromised webhook source -> crafted `ref` markdown path -> local file read through capture detail -> current control: shared secret + auth -> residual risk: medium
- Bad model/tool choice -> task creation via generic ask surface -> current control: prompt-level domain authority only -> residual risk: high
