# AI / LLM Audit — 2026-04-22

Profile: `core + ai-llm`

Assumed context:
- `ai_surface_summary`: local/cloud routing, webhook ingest, prompt dispatch, MCP/agent flows
- `model_providers`: Anthropic + Ollama
- `user_content_flows_to_model`: partial
- `agentic`: write-capable tools

Tools run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Findings:
- `HB-001` open, P1: generic ask surfaces still expose write-capable tools without code-level domain/consent enforcement. Evidence: `apps/server/src/api.ts:249-256`, `apps/server/src/api.ts:274-300`, `packages/agent-runtime/src/mcp-config.ts:87-93`, `packages/agent-runtime/src/context.ts:241-303`.
- `HB-006` open, P2: memory substrate is not operational until `data/context.md` exists and is populated. Evidence: `packages/agent-runtime/src/context.ts:148-176`, `packages/agent-runtime/src/context.ts:187-190`.

Closed in this run:
- `HB-008` streaming path now gets the same constitutional prompt stack as `run()`. Evidence: `packages/agent-runtime/src/system-prompt.ts`, `packages/agent-runtime/src/stream.ts:95-145`.

Risk note:
- The privacy router itself looks sound and is covered by tests. Evidence: `packages/models/src/router.ts`, `packages/models/src/__tests__/router.fuzz.test.ts`.
