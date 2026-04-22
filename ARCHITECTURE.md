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

`packages/models/src/router.ts`. Five rules, first match wins:

1. `localOnly OR sensitivity=high` → Ollama private (`HUB_LOCAL_MODEL_PRIVATE`, Qwen3 7B)
2. `complexity=trivial` → Ollama trivial (`HUB_LOCAL_MODEL_TRIVIAL`, Phi-4-mini)
3. `todaySpendUsd >= HUB_DAILY_USD_CAP` → Ollama fallback (`HUB_LOCAL_MODEL_FALLBACK`, Llama 3.3)
4. `complexity=complex` AND `HUB_CLOUD_MODEL_COMPLEX` is set → Anthropic reasoning tier (opt-in Opus)
5. default → Anthropic Sonnet (`HUB_DEFAULT_MODEL`)

Sensitivity is regex-detected on raw input; `maxSensitivity` ensures caller-supplied triage cannot loosen the gate. Property test at `router.fuzz.test.ts` asserts `sensitivity=high ⇒ vendor !== 'anthropic'` across 10,000 fuzzed samples.

## State layers

- **SQLite** (ops): `captures`, `runs`, `embeddings`, `briefings`, `projects`, `agent_locks`, `mcp_consents`. WAL mode + 5s busy_timeout. Single Windows machine.
- **Obsidian** (durable prose): vault on Windows + iPhone via Obsidian Sync. Source of truth for briefings, meetings, decisions, journals.
- **Notion** (structured): 8 DBs — Areas, Projects, People, SOPs, Meetings, Decisions, Open Loops, Incubator.

## Scheduler coordination

Local cron is authoritative. `agent_locks` table provides DB-backed lease (see `packages/db/src/locks.ts`). Stale leases auto-evict via the WHERE predicate on lease_until. Routines fire webhooks into the local Hub for cross-scheduler safety — they do NOT acquire the lease directly.

## Prompt orchestration

Prompts are stored in a separate git repo (`HUB_PROMPTS_REPO_URL`) as Markdown files with YAML front-matter. A parallel `hub-registry` repo (`HUB_REGISTRY_REPO_URL`) holds `targets.yml`, which maps repos → prompt bindings with triggers (cron, PR events, manual).

`syncPrompts()` clones both repos, parses them, and upserts the `prompts` and `prompt_targets` tables. The cron scheduler fires `dispatchPromptRun()` for each enabled target whose trigger expression is due.

### Registry editing

`packages/prompts/src/edit.ts` provides three mutation functions — `addTarget`, `wirePrompt`, `removeEntry` — exposed via CLI (`hub registry`), HTTP (`POST /api/registry/*`), and MCP (`hub.registry.*`).

**Comment preservation**: All mutations use `YAML.parseDocument()` (the `yaml` package Document API) rather than `YAML.parse()` → `YAML.stringify()`. The Document API preserves comments, whitespace, and key order when serialised via `doc.toString()`. The plain parse/stringify path silently drops comments.

**Write flow**: clone → parse → mutate → validate (Zod `RegistryFile`) → diff → commit → push → `syncPrompts()` in-process. The in-process sync means the local DB reflects the change immediately after the push, with no separate sync step required.

**Auto-sync failure**: If `syncPrompts()` fails after a successful push (e.g. API quota), the error is logged as a warning and `EditResult.syncSummary` is `undefined`. The commit already landed; the DB will catch up on the next scheduled sync.

**Concurrency**: Write operations acquire `withLease('registry:edit', fn)` from `@hub/db`. A second concurrent edit gets `null` and throws a clear error. Dry-run calls skip the lease entirely.

**Idempotency**: Each mutate function returns `true` when it makes a change, `false` for a no-op. The scaffold short-circuits on `false` without writing, committing, or syncing.

---

## Domain Authority

Trust is earned per domain, not granted globally. Every external tool action has a level:

| Level | What Hub does |
| --- | --- |
| **suggest** | Proposes the action as text, shows it — does not execute. |
| **draft** | Executes the tool, surfaces output for review before any external effect. |
| **act** | Executes with a 60-second ConfirmAction window. |

Authority levels are stored in `## Domain Authority` in `/data/context.md`. Format: `- domain-name: suggest|draft|act`. Any unlisted domain defaults to `suggest`.

**Enforcement**: `loadDomainAuthorityPolicy()` in `packages/agent-runtime/src/context.ts` reads the section and formats it as a system-prompt directive. This is injected by `assembleSystemPrompt()` in `run.ts` before every agent run, so the model always knows the current authority boundaries.

**Escalation**: Run `hub prompt run authority-review` (manual trigger) after 30+ days of clean track record for a domain. The prompt presents evidence and proposals — Toni confirms manually via the Context editor. Hub never self-escalates.

**Commandment floors** (never escalate above `suggest`):

- Financial actions (invoices, expenses, transfers)
- External emails (commandment: 60s window minimum)
- GitHub PR creation (blast radius — hold at `suggest` indefinitely unless explicitly overridden)

---

## If Hub Dies

Everything Hub does is exportable. Recovery does not require Hub.

Weekly exports land in `/data/exports/` (Sunday 23:00) via `apps/server/src/jobs/export.ts`. Download from `/api/exports` in the web UI or via `curl`.

| Export file | Contains | Without Hub |
| --- | --- | --- |
| `captures-YYYY-MM-DD.jsonl` | All captures from the past week, one JSON object per line | Read with `jq` or any text editor |
| `context-YYYY-MM-DD.md` | Snapshot of context.md (projects, commitments, decisions, etc.) | Plain markdown — readable immediately |
| `briefs-YYYY-MM-DD.md` | All briefings from the past week | Plain markdown |

**Gmail**: open gmail.com — no Hub dependency.
**Calendar**: open calendar.google.com — no Hub dependency.
**Tasks**: open todoist.com — no Hub dependency.

The unaided self can still walk. This is not morbid maintenance — it is the proof of the augmentation test (ETHOS §II). If Hub is needed to function, Hub has failed.

---

## What's NOT in MVP

PWA, Hub-as-MCP-server, embeddings + retrieval, full router rule table, capture dispatch, subagent spawning. All in V1+.
