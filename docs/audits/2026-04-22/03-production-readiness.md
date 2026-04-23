# Production Readiness Audit — 2026-04-22

Profile: `core + production-readiness`

Assumed context:
- `expected_load`: low, single-user MVP
- `availability_target`: not yet defined
- `largest_blast_radius_acceptable`: one user environment

Tools run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Findings:
- `HB-004` open: no dedicated ask-endpoint throttling or queueing. Evidence: `apps/server/src/api.ts:237-336`, `apps/server/src/rate-limit.ts:1-11`.
- `HB-003` open: reversibility and MCP consent are still mostly schema surfaces, not operational controls. Evidence: `packages/db/src/schema.ts:35-68`, `packages/db/src/schema.ts:155-168`, `packages/agent-runtime/src/persist.ts:22-31`.
- `HB-006` open: critical context file is absent, so recovery/context quality depends on future manual bootstrapping. Evidence: `packages/agent-runtime/src/context.ts:148-176`, local `data/context.md` check returned false.

Closed in this run:
- `HB-007` quiet-hours denials are now auditable instead of silent.
- `HB-009` failed prompt runs no longer emit downstream output side effects.

Operational note:
- CI coverage is present and healthy. Evidence: `.github/workflows/ci.yml`.
