# Architecture

Quick reference. Verified against the codebase — trust the code, not this file, when they diverge.

## Topology

```text
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
| --- | --- | --- |
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

The `prompts` table stores the prompt library synced from `hub-prompts`: `id`, `version`, `source_sha`, `title`, `description`, `body`, `sensitivity` (low|medium|high), `complexity` (trivial|standard|complex), `inputs_schema` (JSON), `output_config` (JSON), `tags` (JSON), `synced_at`, `enabled`. The `prompt_targets` table stores bindings from `hub-registry`: `repo` (owner/repo slug), `prompt_id` (FK → prompts.id), `trigger` (cron:…|manual|event:…), `when_expr`, `branch`, `sensitivity_override`, `args` (JSON), `enabled`, `source_sha`, `last_run_id`, `last_run_at`, with a unique index on `(repo, prompt_id, trigger)`. Full DDL is in `packages/db/migrations/`.

`syncPrompts()` in `packages/prompts/src/sync.ts` clones hub-prompts into a temp dir, calls `parsePromptsDir()` in `packages/prompts/src/parser.ts` (uses gray-matter) to parse markdown files with YAML frontmatter, then clones hub-registry and parses `targets.yml` with the `yaml` package. Zod validates the registry against `RegistryFile` from `packages/prompts/src/schema.ts`. Referential integrity is enforced before any writes: every `prompt_id` in the registry must exist in the parsed prompt set, and the whole sync throws on violation. All DB writes happen in a single `BEGIN IMMEDIATE` transaction — upsert prompts, remove stale target rows absent from the new set, upsert new targets. Parse errors on individual prompt files accumulate in `SyncResult.errors` rather than aborting the sync.

`dispatchPromptRun(opts)` in `packages/prompts/src/dispatcher.ts` is the single entry point for all trigger types (cron/scheduled, event, manual). It resolves the target and prompt from the DB, evaluates `when_expr` via `expr-eval` if present (falsy result records a skipped run without invoking any model), acquires a per-target lease keyed `prompt:{id}:{repo}` from `agent_locks`, merges target base args with call-time overrides, interpolates `{{key}}` placeholders in the prompt body, calls `run()` from `@hub/agent-runtime` (which routes through the privacy router), then passes the output to `handleOutputs()` in `packages/prompts/src/outputs.ts`. Output handlers cover Obsidian path writes, GitHub issues, GitHub PR comments, and ntfy notifications by priority level. The target row's `last_run_id` and `last_run_at` are updated on completion.

Effective sensitivity for a dispatch is `target.sensitivity_override ?? prompt.sensitivity`. When `high`, this passes `forceLocal: true` to the task, routing through the privacy router to Ollama — the router is never bypassed by the dispatcher.

### Companion repos

Hub is the execution layer. The prompt library and target registry live in separate git repos, giving each its own version history and making them independent of the Hub's deployment lifecycle.

| Repo | Role |
| --- | --- |
| `toniomon96/hub` | Execution: router, dispatcher, lease table, audit trail, state stores |
| `toniomon96/hub-prompts` | Prompt library: versioned markdown files with YAML frontmatter |
| `toniomon96/hub-registry` | Target registry: single `targets.yml` wiring prompts to repos |

Hub points to the companion repos via `HUB_PROMPTS_REPO_URL` and `HUB_REGISTRY_REPO_URL`; auth uses `HUB_GITHUB_TOKEN`. The separation is load-bearing: rebuild the Hub without losing the prompt library or registry; swap git providers without touching the execution engine.

### Registry editing

`packages/prompts/src/edit.ts` provides three mutation functions — `addTarget`, `wirePrompt`, `removeEntry` — exposed via CLI (`hub registry add|wire|remove`; listing is via `hub prompt targets`), HTTP (`POST /api/registry/add`, `/api/registry/wire`, `/api/registry/remove`, `GET /api/registry/targets`), and MCP (`hub.registry.add`, `hub.registry.wire`, `hub.registry.remove`, `hub.registry.list`).

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

## Engineering playbook

`toniomon96/engineering-playbook` is the canonical home for cross-project operating principles. Three files are referenced from Hub sessions:

- `HANDBOOK.md` — Agent-Assisted Engineering handbook: working agreements, review standards, commit discipline
- `DESIGN_WORKFLOW.md` — Claude Design + Claude Code workflow: from Figma handoff to merged PR
- `ARCHITECTURE_PROMPT.md` — the prompt that generates ARCHITECTURE.md files across project repos, including this one

This repo carries `docs/PLAYBOOK.md` — a short file linking back to the playbook by raw URL. Do not copy playbook content into this repository; it lives in one place so it stays coherent.

---

## What's not in scope

Not built, deliberately deferred, or explicitly out of scope:

- **PWA** — mobile-first UI (V1+)
- **Hub-as-MCP-server** — exposing Hub's own tools as an MCP endpoint for external agents (V1+)
- **Embeddings + retrieval** — semantic search over captures and context (V1+)
- **Subagent spawning** — agent-runtime launching child runs autonomously (V1+)
- **`/webhooks/github` endpoint** — event-driven PR-triggered prompts; requires VPS cutover for reliable inbound webhooks (v0.6)
- **Bulk registry import from a GitHub org** — not planned; the registry's value is that it is a considered list, not an automatic mirror of everything in an org
- **Auto-enrollment of new repos into the registry** — same reason as above; deliberate exclusion, not an oversight
- **Per-repo `.hub/prompts.yml` merging** — adds complexity without clear benefit over the central registry model
- **Claude Design invocation automation** — requires a public API that does not yet exist; and even with one, the generation step benefits from human taste at every invocation
- **`design-implement` prompt in hub-prompts** triggered on `push` to `design/**` paths — deferred until the manual Claude Design → Claude Code flow has been exercised at least twice end-to-end; when built, PRs it opens should auto-run `codebase-audit`

---

Last reviewed: 2026-04-22
