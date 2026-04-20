# Hub

Personal AI operating layer. TypeScript monorepo on the Claude Agent SDK + MCP.

> Status: **v0.3 scaffold** — MVP foundation in place. See [DECISIONS.md](./DECISIONS.md)
> for what's decided, [ARCHITECTURE.md](./ARCHITECTURE.md) for how it fits together.

## Quick start

Preconditions:
- Node ≥20 LTS (tested on 24)
- pnpm ≥9 (`npm i -g pnpm`)
- Windows BitLocker enabled (mandatory — see [SECURITY.md](./SECURITY.md))
- Ollama running locally with `phi4-mini` and `qwen3:7b` pulled (for privacy router)

```pwsh
# install
pnpm install

# build all packages
pnpm build

# typecheck
pnpm typecheck

# test
pnpm test

# run server (dev)
pnpm --filter @hub/server dev

# run CLI (dev)
pnpm --filter @hub/cli dev -- status
pnpm --filter @hub/cli dev -- ask "remind me to call Bob"
```

Copy `.env.example` to `.env` and fill in. Minimum for MVP: `ANTHROPIC_API_KEY`,
`NOTION_TOKEN`, `OBSIDIAN_API_KEY` + `OBSIDIAN_VAULT_PATH`,
`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `HUB_SENSITIVITY_PATTERNS`.

## Layout

```
hub/
├── apps/
│   ├── cli/          # `hub` command
│   └── server/       # Hono: API, MCP server (V2), webhooks, agent runtime
├── packages/
│   ├── shared/       # zod env, pino logger, types, ULID
│   ├── db/           # Drizzle schema + agent_locks lease table
│   ├── models/       # 3-rule MVP router (privacy-gated)
│   ├── agent-runtime/# Agent SDK wrapper + MCP scope builder + run persistence
│   └── capture/      # Webhook ingest + Ollama-backed classifier
└── .claude/          # Skills + subagents (loaded by Agent SDK)
```

## What's load-bearing in v0.3

These are the corrections from v0.2 review (see [DECISIONS.md](./DECISIONS.md)):

1. **Privacy router at MVP** — `packages/models/src/router.ts`. Sensitivity is computed by regex BEFORE any cloud call. Caller cannot override downward.
2. **Gmail send has no undo** — fixed in `ARCHITECTURE.md` permission tier table.
3. **Classifier is NOT an Agent SDK subagent** — `packages/capture/src/classify.ts` calls Ollama directly.
4. **Decision-log consistency: Obsidian-first, reconcile to Notion** — see `.claude/skills/obsidian-writer/SKILL.md`.
5. **DB-backed lease table replaces in-process mutex** — `packages/db/src/locks.ts`.
