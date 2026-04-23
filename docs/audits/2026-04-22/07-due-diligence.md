# Technical Due Diligence Audit — 2026-04-22

Profile: `core + due-diligence`

Assumed context:
- `dd_lens`: founder-side
- `next_stage`: private MVP launch and hardening
- `time_budget_minutes`: 120

Strengths:
- CI is present and multi-platform. Evidence: `.github/workflows/ci.yml`.
- The repo split between execution, prompt library, and registry is deliberate and coherent. Evidence: `ARCHITECTURE.md`.
- The privacy router has explicit property-test coverage. Evidence: `packages/models/src/__tests__/router.fuzz.test.ts`.

Findings:
- `HB-003` open, P2: reversibility and consent are still more promised than enforced. Evidence: `packages/db/src/schema.ts:35-68`, `packages/db/src/schema.ts:155-168`, `packages/agent-runtime/src/persist.ts:22-31`.
- `HB-006` open, P2: the memory substrate is not really live until `data/context.md` exists with real content. Evidence: `packages/agent-runtime/src/context.ts:148-176`, local `data/context.md` check returned false.
- `HB-001` open, P1: generic ask surfaces still over-attach capabilities relative to current code-level trust enforcement. Evidence: `apps/server/src/api.ts:249-256`, `packages/agent-runtime/src/mcp-config.ts:87-93`.

CTO memo:
- The architecture is directionally strong for an MVP.
- The biggest diligence gap is not build quality; it is control-surface credibility.
- The next investor-grade move is to make consent, authority, and reversibility true in code, not just true in schema and prompts.
