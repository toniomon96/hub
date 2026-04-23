# Hub Audit Master Backlog — 2026-04-22

Context: `project=Hub`, `stage=pre-launch`, `team_size=solo`, `risk_tolerance=balanced`, `current_priority=ship`, `audit_scope=whole-repo`.

Verification baseline:
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

Completed in this execution wave:
- `HB-007` Quiet-hours blocks now persist audit rows in both `run()` and `runStream()`.
- `HB-008` Streaming runs now receive the same constitutional system prompt stack as non-streaming runs.
- `HB-009` Prompt output handlers now skip external side effects when the underlying run fails.
- `HB-010` Lint and flaky-test hygiene issues were cleaned up so the repo verifies cleanly.

Wave order:
- Wave 1: `HB-001`, `HB-004`
- Wave 2: `HB-002`, `HB-003`
- Wave 3: `HB-006`, `HB-012`
- Wave 4: `HB-005`

## Findings

### `HB-001`
- `profile_source`: comprehensive, security, ai-llm, due-diligence
- `status`: open
- `severity`: P1
- `category`: Risk
- `primary_dimension`: security
- `also_touches`: ai-llm, reliability, dx
- `title`: Generic ask surfaces still attach write-capable task tools without code-level consent enforcement.
- `evidence`: `apps/server/src/api.ts:249-256`, `apps/server/src/api.ts:274-300`, `apps/cli/src/main.ts:38-77`, `packages/agent-runtime/src/mcp-config.ts:87-93`, `packages/agent-runtime/src/context.ts:241-303`, `packages/db/src/schema.ts:155-168`
- `impact`: A bad model decision on `/api/ask`, `/api/ask/stream`, or `hub ask` can still reach Todoist-capable MCP tooling because domain authority and MCP consent exist only as prompt/schema surfaces, not runtime gates.
- `remediation`: Default generic ask flows to `knowledge` only; require explicit opt-in before attaching `tasks`, `workspace`, or other write-capable scopes; wire `mcp_consents` and/or `getDomainAuthority()` into scope assembly.
- `effort`: M
- `verification`: Attempt a task-creation ask while authority remains `suggest`; confirm no task MCP scope is attached and no side effect occurs.

### `HB-002`
- `profile_source`: comprehensive, security, production-readiness
- `status`: open
- `severity`: P2
- `category`: Risk
- `primary_dimension`: security
- `also_touches`: privacy, reliability
- `title`: Capture detail API can read arbitrary markdown paths from persisted `rawContentRef`.
- `evidence`: `packages/db/src/schema.ts:15`, `apps/server/src/webhooks.ts:80-82`, `apps/server/src/api.ts:207-214`
- `impact`: Any capture whose `rawContentRef` ends in `.md` becomes a potential local file read through `/api/captures/:id`; webhook payloads can currently set `ref` directly.
- `remediation`: Restrict readable capture bodies to allow-listed roots or a dedicated stored-body mechanism; treat non-allow-listed refs as metadata only.
- `effort`: S
- `verification`: Insert a capture with a non-allow-listed markdown path and confirm the API returns `body: null`.

### `HB-003`
- `profile_source`: comprehensive, production-readiness, due-diligence
- `status`: open
- `severity`: P2
- `category`: Debt
- `primary_dimension`: reliability
- `also_touches`: security, code-quality
- `title`: `reversalPayload` and `mcp_consents` are still mostly schema promises rather than enforced runtime capabilities.
- `evidence`: `packages/db/src/schema.ts:35-68`, `packages/db/src/schema.ts:155-168`, `packages/agent-runtime/src/persist.ts:22-31`, `packages/agent-runtime/src/persist.ts:59-76`
- `impact`: The repo advertises reversibility and consent state, but operators still cannot rely on those guarantees during real tool execution or rollback review.
- `remediation`: Produce reversal payloads for reversible actions and consume `mcp_consents` during scope/tool authorization.
- `effort`: M
- `verification`: Execute a reversible R1 action and confirm `reversalPayload` is non-null; attempt first-time MCP attachment without consent and confirm it is blocked.

### `HB-004`
- `profile_source`: comprehensive, security, production-readiness
- `status`: open
- `severity`: P2
- `category`: Risk
- `primary_dimension`: reliability
- `also_touches`: security, cost
- `title`: `/api/ask` and `/api/ask/stream` have no dedicated request throttling or abuse guard.
- `evidence`: `apps/server/src/api.ts:237-336`, `apps/server/src/auth.ts:132-156`, `apps/server/src/rate-limit.ts:1-11`
- `impact`: The login path is rate-limited, but the expensive model paths are not. If the UI token leaks or the server is exposed too broadly, the service can burn spend or saturate the local/cloud model path.
- `remediation`: Add per-IP or per-session rate limits and a simple spend/queue guard for ask endpoints.
- `effort`: M
- `verification`: Rapidly repeat `/api/ask` and confirm throttling or graceful degradation instead of unlimited processing.

### `HB-005`
- `profile_source`: performance, ux-a11y
- `status`: open
- `severity`: P2
- `category`: Debt
- `primary_dimension`: performance
- `also_touches`: ux
- `title`: Performance budgets and automated perf/a11y checks are still missing.
- `evidence`: `pnpm build` on 2026-04-22 produced `apps/web` bundle `assets/index-B1ghgKyE.js` at `219.90 kB` (`65.84 kB` gzip); no Lighthouse/axe/pa11y tooling is installed in this environment
- `impact`: The current web bundle is reasonable for MVP size, but there is no automated boundary to catch future regressions or perceived-speed issues.
- `remediation`: Add bundle-size budget checks plus a lightweight Lighthouse/axe CI pass once a stable runnable target exists.
- `effort`: M
- `verification`: CI fails on budget regressions and publishes perf/a11y reports for the web app.

### `HB-006`
- `profile_source`: comprehensive, ai-llm, due-diligence, production-readiness
- `status`: open
- `severity`: P2
- `category`: Risk
- `primary_dimension`: code-quality
- `also_touches`: ai-llm, dx
- `title`: `context.md` is still absent, so the memory and authority layers run mostly from empty state.
- `evidence`: `packages/agent-runtime/src/context.ts:148-176`, `packages/agent-runtime/src/context.ts:187-190`, local check on `data/context.md` returned `False`
- `impact`: The system can boot and answer, but its memory substrate, plural-self framing, and domain-authority guidance are materially weaker until the file is populated.
- `remediation`: Bootstrap `data/context.md` intentionally with non-placeholder content and treat it as a required MVP setup step, not an optional follow-up.
- `effort`: S
- `verification`: `data/context.md` exists with populated sections and run logs show non-empty injected user context.

### `HB-007`
- `profile_source`: comprehensive, security, production-readiness
- `status`: closed in this execution
- `severity`: P1
- `category`: Bug
- `primary_dimension`: reliability
- `also_touches`: security
- `title`: Quiet-hours blocks dropped the audit trail for high-authority runs.
- `evidence`: fixed in `packages/agent-runtime/src/run.ts:57-78`, `packages/agent-runtime/src/stream.ts:59-73`, verified by `packages/agent-runtime/src/__tests__/run.test.ts`
- `impact`: Before this fix, the most important blocked actions returned early without a persisted run record.
- `remediation`: Done.
- `effort`: S
- `verification`: Covered by `pnpm test` via `packages/agent-runtime/src/__tests__/run.test.ts`.

### `HB-008`
- `profile_source`: comprehensive, ai-llm
- `status`: closed in this execution
- `severity`: P1
- `category`: Risk
- `primary_dimension`: ai-llm
- `also_touches`: security, ux
- `title`: Streaming runs were bypassing the constitutional prompt stack.
- `evidence`: fixed in `packages/agent-runtime/src/system-prompt.ts`, `packages/agent-runtime/src/run.ts:118`, `packages/agent-runtime/src/stream.ts:95-145`, verified by `packages/agent-runtime/src/__tests__/stream.test.ts`
- `impact`: `/api/ask/stream` and `hub ask --stream` previously had weaker behavioral guarantees than non-streaming asks.
- `remediation`: Done.
- `effort`: S
- `verification`: Covered by `pnpm test` via `packages/agent-runtime/src/__tests__/stream.test.ts`.

### `HB-009`
- `profile_source`: comprehensive, production-readiness
- `status`: closed in this execution
- `severity`: P2
- `category`: Bug
- `primary_dimension`: reliability
- `also_touches`: dx
- `title`: Prompt outputs could still fire after a failed run.
- `evidence`: fixed in `packages/prompts/src/dispatcher.ts:171-188`, verified by `packages/prompts/src/__tests__/dispatcher.test.ts`
- `impact`: Failed or empty prompt runs could still create downstream issues/comments/notifications.
- `remediation`: Done.
- `effort`: S
- `verification`: Covered by `pnpm --filter @hub/prompts test`.

### `HB-010`
- `profile_source`: comprehensive
- `status`: closed in this execution
- `severity`: P3
- `category`: Debt
- `primary_dimension`: dx
- `also_touches`: code-quality
- `title`: Minor lint and test-timeout hygiene issues obscured the verification signal.
- `evidence`: fixed in `apps/cli/src/doctor.ts`, `apps/server/src/__tests__/spend-warn.test.ts`, `packages/prompts/src/__tests__/*.test.ts`, `apps/web/src/pages/Projects.tsx`
- `impact`: Low, but it made full-suite verification noisier than necessary.
- `remediation`: Done.
- `effort`: XS
- `verification`: `pnpm lint`, `pnpm test`.

### `HB-012`
- `profile_source`: ux-a11y
- `status`: open
- `severity`: P3
- `category`: Bug
- `primary_dimension`: ux
- `also_touches`: dx
- `title`: The registry wire form still accepts raw trigger strings with no validation or affordance beyond a placeholder.
- `evidence`: `apps/web/src/pages/Projects.tsx:138-143`
- `impact`: Mis-typed `cron:` and `event:` expressions are easy to enter and hard to diagnose before the server rejects or misinterprets them.
- `remediation`: Add client-side validation and clearer trigger presets/examples.
- `effort`: XS
- `verification`: Invalid trigger strings are rejected inline before the API call.
