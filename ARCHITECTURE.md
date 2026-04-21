# Architecture

Quick reference. Full plan lives in the Hub spec v0.3 (in user memory).

## Topology

```
You ──► CLI / PWA(V2) / Claude Desktop / Martin
              │
              ▼
     ┌─────────────────────────┐
     │  Hub (Hono + Node)      │
     │  ┌───────────────────┐  │
     │  │ agent-runtime     │──┼──► Anthropic Agent SDK ──► Anthropic API
     │  │  + router (priv.) │──┼──► Ollama (local SLM)
     │  │  + persist        │  │
     │  └───────────────────┘  │
     │  ┌───────────────────┐  │
     │  │ webhooks          │──┼── Granola, Plaud, Superwhisper, Martin
     │  │  → capture.ingest │  │
     │  └───────────────────┘  │
     │  ┌───────────────────┐  │
     │  │ MCP server (V2)   │──┼──► Claude Desktop / Martin / iPhone
     │  └───────────────────┘  │
     └────────────┬────────────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   SQLite     Obsidian    Notion
  (ops/runs/   (prose,    (8 structured
   captures/   durable)    DBs)
   embeddings/
   leases)
```

## Permission tiers (R0–R3)

| Tier | Examples | Handling |
|---|---|---|
| **R0** | `hub.search_memory`, `hub.brief_me` | Auto |
| **R1** | Todoist/Linear create, Obsidian inbox write, Gmail **draft** | Auto, logged, reversible via `hub undo <id>` for 24h |
| **R2** | Calendar event create, Gmail **send** (no undo), `/decisions/` writes, deletes | Confirm prompt; some have undo (Calendar = delete sends cancellation), most do not. Spell out per-action. |
| **R3** | Martin SMS, spending, irreversible API calls | y/N + 60s timeout + audit log |

## Privacy router (load-bearing)

`packages/models/src/router.ts`. Three rules, first match wins:

1. `localOnly OR sensitivity=high` → Ollama (Qwen3 7B)
2. `complexity=trivial` → Ollama (Phi-4-mini)
3. default → Anthropic Sonnet

Sensitivity is regex-detected on raw input; `maxSensitivity` ensures caller-supplied triage cannot loosen the gate.

## State layers

- **SQLite** (ops): `captures`, `runs`, `embeddings`, `briefings`, `projects`, `agent_locks`, `mcp_consents`. WAL mode + 5s busy_timeout. Single Windows machine. Schema + queries via Drizzle; connection lifecycle, migrations, and the `agent_locks` atomic upserts use raw `node:sqlite` — see DECISIONS.md (2026-04-23) for why.
- **Obsidian** (durable prose): vault on Windows + iPhone via Obsidian Sync. Source of truth for briefings, meetings, decisions, journals.
- **Notion** (structured): 8 DBs — Areas, Projects, People, SOPs, Meetings, Decisions, Open Loops, Incubator.

## Scheduler coordination

Local cron is authoritative. `agent_locks` table provides DB-backed lease (see `packages/db/src/locks.ts`). Stale leases auto-evict via the WHERE predicate on lease_until. Routines fire webhooks into the local Hub for cross-scheduler safety — they do NOT acquire the lease directly.

## What's NOT in MVP

PWA, Hub-as-MCP-server, embeddings + retrieval, full router rule table, capture dispatch, subagent spawning. All in V1+.
