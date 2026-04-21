# Hub Roadmap

> Living document. Edit freely. Checkboxes = tracked work.
> Source of truth for what's next; `CHANGELOG.md` = what shipped; `DECISIONS.md` = why.

**Last edited:** 2026-04-20
**Current:** `main` @ v0.3 post-Phase F · 84 tests · 8 workspaces · CI not yet
**Horizon:** v0.4 → v1.0, roughly one milestone per 1–2 weeks of evenings

---

## How to use this doc

- Each milestone has a **goal**, a **PR table**, **acceptance criteria**, and **out of scope**.
- PRs are sized to ≤500 LOC and ordered so gates stay green between merges.
- Tick boxes as you merge. When a PR's scope changes, edit the row — don't append a new one.
- When a milestone slips, move unfinished rows down, don't renumber.
- Reprioritize by reordering the milestone blocks. Anything labeled **V1+** lives in §7.

### Global invariants (never weaken)

1. Privacy router: `sensitivity=high` NEVER hits Anthropic. `maxSensitivity` always wins.
2. Obsidian = prose. Notion = structured DBs. SQLite = ops/telemetry. No collapsing.
3. No breaking changes to webhook URLs, CLI command names, or `x-hub-secret` header shape without a major bump + migration note.
4. No new heavyweight deps (LangGraph, Mastra, Prisma, Redis, Docker, Postgres) — see `DECISIONS.md`.
5. Solo maintainer reality: Windows arm64 + Node 24 + pnpm + SQLite. Every PR must pass on Windows **and** Ubuntu 24.04.

### Definition of done (per PR)

- [ ] `pnpm -r typecheck` green
- [ ] `pnpm -r build` green
- [ ] `pnpm -r test` green (Windows + Ubuntu via CI)
- [ ] New behavior has at least one test
- [ ] Docs updated if user-visible (`SETUP.md`, `ARCHITECTURE.md`, `SECURITY.md`)
- [ ] `CHANGELOG.md` entry under `## Unreleased`
- [ ] No new top-level `getLogger()` calls (see v0.4 #9)
- [ ] No new hand-rolled API types in `apps/web` after v0.5 #2

### PR template stub

```
### What
<one line>

### Why
<link to roadmap row / issue>

### Risk
<L/M/H + blast radius>

### Tests
- [ ] <new test>
- [ ] <regression>

### Checklist
- [ ] typecheck / build / test green locally
- [ ] Changelog entry
- [ ] Docs touched if needed
```

---

## 1. v0.4 — Harden  *(security + CI + known bugs)*

**Goal.** Ship CI, close the top security gaps, and clear the sharp edges before building features on top.

### PRs

| # | Title | Scope | LOC | Risk | Status |
|---|---|---|---|---|---|
| 1 | `ci: GH Actions workflow + Dependabot` | `.github/workflows/ci.yml`, `.github/dependabot.yml`, README badge | ~120 | L | [ ] |
| 2 | `chore(vitest): extract shared node:sqlite shim` | `packages/shared/testing/sqlite-shim.ts`, 4× `vitest.config.ts` | -80 | L | [ ] |
| 3 | `fix(capture): disable dist hoisting so ollama mock works` | `packages/capture/tsup.config.ts`, new regression test | ~60 | M | [ ] |
| 4 | `security(auth): split HUB_UI_TOKEN from HUB_COOKIE_SECRET in prod` | `shared/env.ts`, `server/auth.ts`, docs | ~120 | M | [ ] |
| 5 | `security(auth): rate-limit /auth/login` | `server/auth.ts` + tests | ~100 | L | [ ] |
| 6 | `security(webhooks): per-vendor signatures` | `server/webhooks.ts`, env schema, docs | ~200 | M | [ ] |
| 7 | `fix(server): drop tsx watch, document tsup-watch dev` | package scripts, CONTRIBUTING | ~40 | L | [ ] |
| 8 | `fix(brief): HUB_TIMEZONE-aware dayStartMs` | `agent-runtime/brief.ts`, env | ~120 | M | [ ] |
| 9 | `chore(log): lazy getLogger()` | `shared/log.ts` + ~8 call sites | -120 | M | [ ] |
| 10 | `docs: drizzle vs raw-sqlite policy` | ARCHITECTURE, DECISIONS, health.ts comment | ~80 | L | [ ] |
| 11 | `security(mcp): enforce Desktop Commander allowlist` | `agent-runtime/mcp-config.ts` + tests | ~150 | M | [ ] |

**Merge order:** 1 → 2 → 9 → 3 → 7 → 8 → 4 → 5 → 6 → 11 → 10

### Acceptance criteria

- [ ] CI required on six checks: lint, typecheck, build-test (22), build-test (24), deps-audit, secrets-scan.
- [ ] Total tests ≥ 100.
- [ ] `HUB_COOKIE_SECRET === HUB_UI_TOKEN` refused in prod, warned in dev.
- [ ] 6th `/auth/login` in <60s from one IP → 429.
- [ ] Each webhook path rejects another vendor's signature.
- [ ] Same local-day brief twice = cache hit across UTC midnight.
- [ ] No module calls `getLogger()` at top level (grep check in CI).

### Out of scope

Streaming, Decisions page, MCP server surface, `sqlite-vec`, VPS cutover, generated web client.

---

## 2. v0.5 — Close the loop  *(streaming, Decisions, UI polish, contract types)*

**Goal.** Daily surfaces feel live: streaming answers, typed client, Decisions end-to-end, optimistic captures.

### PRs

| # | Title | Scope | LOC | Risk | Status |
|---|---|---|---|---|---|
| 1 | `feat(server): @hono/zod-openapi routes` | `server/api.ts`, schemas → `shared/contracts/` | ~400 | M | [ ] |
| 2 | `feat(shared): generated web+cli client` | `shared/client.ts`, delete `web/api.ts` types | -250 | M | [ ] |
| 3 | `feat(ask): SSE streaming endpoint` | `server/api.ts`, `agent-runtime/run.ts`, CLI `--stream` | ~300 | M | [ ] |
| 4 | `feat(web): streaming Ask + toasts + skeletons` | `pages/Ask.tsx`, `components/{Toast,Skeleton}`, `hooks/useSSE` | ~350 | L | [ ] |
| 5 | `feat(captures): body + FTS5 search + optimistic add` | api routes, migration, `pages/Capture.tsx` | ~400 | M | [ ] |
| 6 | `feat(decisions): hub.log_decision + /api/decisions + page` | agent tool, api, Obsidian writer, `pages/Decisions.tsx` | ~450 | M | [ ] |
| 7 | `feat(router): complete ARCHITECTURE §13 rule table` | `models/router.ts`, exhaustive tests + property test | ~250 | H | [ ] |
| 8 | `feat(spend): 80% pre-warning via ntfy` | `db/spend.ts`, `shared/ntfy.ts`, cron | ~150 | L | [ ] |
| 9 | `feat(undo): R1 reversalPayload writers + CLI/web undo` | persist, CLI cmd, dashboard button | ~350 | M | [ ] |
| 10 | `feat(ui): visibility-gated polling + keyboard shortcuts` | `App.tsx`, `hooks/usePolling`, shortcut help | ~200 | L | [ ] |
| 11 | `chore(capture): Dispatcher abstraction` | `capture/dispatcher.ts`, refactor ingest | ~250 | M | [ ] |

**Merge order:** 1 → 2 → 7 → 8 → 3 → 4 → 5 → 11 → 9 → 6 → 10

### Acceptance criteria

- [ ] `hub ask --stream` prints tokens incrementally; Ctrl-C aborts server within 500ms.
- [ ] `GET /api/captures?q=foo` FTS-ranked, <50ms on 10k rows.
- [ ] `hub.log_decision` writes both Obsidian file (obsidian-writer skill frontmatter) **and** `decisions` row.
- [ ] Router property test: `sensitivity=high ⇒ vendor !== 'anthropic'` across 10k samples.
- [ ] Spend = 80% fires exactly one ntfy per window; 100% still hard-stops.
- [ ] `hub undo <run-id>` restores R1 runs; second invocation no-op.
- [ ] Dashboard polling stops when tab hidden.
- [ ] `apps/web/src/api.ts` has zero hand-rolled types.
- [ ] Total tests ≥ 140.

### Out of scope

MCP server surface, `sqlite-vec`, R2/R3 consent, light theme, iOS PWA, Notion write-back, Martin ingestion.

---

## 3. v0.6 — Hub-as-MCP-server  *(+ first external consumer)*

**Goal.** Claude Desktop can call `hub.*` tools against the running server; memory search is real; R2/R3 consent gates live.

### PRs

| # | Title | Scope | LOC | Risk | Status |
|---|---|---|---|---|---|
| 1 | `feat(mcp): hub-server package (stdio)` | new `packages/mcp-server/` | ~450 | M | [ ] |
| 2 | `feat(mcp): http+sse transport /mcp` | `server/mcp.ts`, auth reuses v0.4 #5 | ~250 | M | [ ] |
| 3 | `feat(memory): sqlite-vec + fastembed + backfill` | `db/vec.ts`, migration, `capture/embed.ts` | ~400 | H | [ ] |
| 4 | `feat(mcp): hub.search_memory real impl` | hybrid FTS + vector | ~250 | M | [ ] |
| 5 | `feat(brief): inject real bodies via search_memory` | `brief.ts`, gated by `HUB_BRIEF_CONTEXT=v2` | ~200 | M | [ ] |
| 6 | `feat(consent): R2/R3 prompts (CLI + web + ntfy)` | `agent-runtime/consent.ts`, modal, `mcp_consents` table | ~400 | H | [ ] |
| 7 | `feat(mcp): consent enforcement on R2/R3 tools` | classify each tool, refuse w/o consent | ~200 | M | [ ] |
| 8 | `chore(mcp): strict allowlist ON by default` | flip default, drop Desktop Commander from default scope | ~40 | M | [ ] |
| 9 | `docs+deploy: VPS cutover runbook exercised` | deploy docs, smoke script | ~250 | L | [ ] |
| 10 | `feat(settings): /healthz + MCP health + secret rotation UI` | `pages/Settings.tsx`, admin routes behind re-auth | ~350 | M | [ ] |

**Merge order:** 1 → 2 → 8 → 3 → 4 → 5 → 6 → 7 → 10 → 9

### Acceptance criteria

- [ ] Claude Desktop stdio config calls `hub.status` / `hub.capture` round-trip.
- [ ] `sqlite-vec` loads on Windows arm64 **or** falls back to FTS-only with one warning.
- [ ] `hub.search_memory` p95 < 200ms on 10k captures.
- [ ] Nightly brief quotes actual capture bodies (golden snapshot).
- [ ] R2 tool → ntfy approve/deny; 60s no-response = deny; logged in `mcp_consents`.
- [ ] R3 requires fresh consent each call.
- [ ] Settings page rotates `HUB_UI_TOKEN` live; old cookies invalid.
- [ ] VPS cutover runbook executed on staging droplet; smoke passes.
- [ ] Total tests ≥ 180.

### Out of scope

Notion write-back, Martin bidirectional, multi-user, light theme, iOS PWA polish.

---

## 4. v0.7 — Ingestion & capture breadth  *(sketched)*

**Goal.** Every real capture source is first-class and dedup/classification is trustworthy.

### Candidate PRs (refine before starting)

- [ ] Martin AI email-forward ingestion (parse, dedup, link to thread).
- [ ] Granola real HMAC path end-to-end (PR in v0.4 #6 laid groundwork).
- [ ] Plaud audio capture: store blob, queue whisper locally.
- [ ] Superwhisper iOS shortcut → webhook with `x-hub-secret`.
- [ ] `projects` table wired: auto-link captures to project by rule or embedding.
- [ ] Classifier v2: include recent captures context, quality eval harness.
- [ ] Capture review queue in web UI (approve/reclassify/merge duplicates).
- [ ] Export: `hub export --since 2026-01-01 --format jsonl`.

### Probable acceptance

- [ ] All five webhook sources have a golden-file test.
- [ ] Dedup recall ≥ 0.95 on a labeled fixture.
- [ ] Classifier agreement vs. fixture ≥ 0.9.

---

## 5. v0.8 — Notion bridge  *(sketched)*

**Goal.** Structured DBs in Notion are read/writable from Hub without violating the reconcile rules.

### Candidate PRs

- [ ] `packages/notion` client (read-only first).
- [ ] Sync: Notion Areas/Projects/People/SOPs → SQLite mirror tables (read-only).
- [ ] `hub.notion_lookup` MCP tool.
- [ ] Write-back for Decisions (Obsidian primary, Notion mirror).
- [ ] Write-back for Open Loops (Notion primary, Obsidian link back).
- [ ] Conflict policy doc in `DECISIONS.md`.

### Probable acceptance

- [ ] No write without a corresponding Obsidian log entry.
- [ ] Round-trip test: create in Hub → appears in Notion → edit in Notion → mirror updates.

---

## 6. v0.9 → v1.0 — Agents, schedule, polish  *(sketched)*

**Goal.** Move from "I run `hub brief` manually" to a believable personal OS.

### Themes

- **Scheduler:** migrate `node-cron` agents to Anthropic Routines where cloud scope is fine; keep local-only on `node-cron`.
- **Agents:** nightly review, weekly review, inbox-zero helper, project-status digest.
- **Routing:** model-cost telemetry per agent; auto-demote agents that don't need Opus.
- **Mobile:** validate PWA install on iOS; push via ntfy verified end-to-end.
- **Voice:** Superwhisper default; quick-capture shortcut benchmarked.
- **Backups:** `deploy/backup.sh` tested on real VPS, restore rehearsed.
- **Observability:** pino → log rotation + optional OTLP exporter (off by default).
- **Threat model refresh:** `SECURITY.md` walkthrough after MCP server is public.

### v1.0 readiness gate

- [ ] Used daily for 30 consecutive days without manual DB surgery.
- [ ] Backup restored from cold storage successfully.
- [ ] Spend ceiling tripped and recovered at least once.
- [ ] All R2/R3 surfaces have a consent audit trail.
- [ ] Privacy-router property test still passes.
- [ ] No `TODO(security)` / `FIXME(privacy)` comments in repo.

---

## 7. V1+ / don't-build-yet

Parked deliberately. Each needs a trigger before we start.

| Item | Trigger to reconsider |
|---|---|
| LangGraph / Mastra / CrewAI | >15 agents or need visual traces |
| Voyage / OpenAI embeddings default | fastembed recall <0.7 on real corpus |
| Native `drizzle-orm/node-sqlite` swap | upstream stable release |
| Prisma / Redis / Docker / Postgres | multi-node requirement (won't happen solo) |
| Martin bidirectional adapter | 2+ months of email-forward usage data |
| Notion write-back for Meetings | after v0.8 reconcile rules proven |
| Multi-user / team mode | second human user exists |
| Light theme + iOS PWA polish | daily iOS usage becomes blocker |
| Custom vector DB (Qdrant, LanceDB, Chroma) | corpus > 100k documents |
| Self-hosted auth (Authelia) | share the hub with anyone |
| CLI TUI with `ink` | interactive flow needs panes |
| LLM-generated migrations | schema changes outpace manual writing |

---

## 8. Cross-cutting debt tracker

Edit in place. Move to a milestone when picked up.

- [ ] `drizzle-orm/sqlite-proxy` async contract — keep, revisit on upstream
- [ ] `tsx watch` bug — workaround in place (`chore/server-dev-workaround`)
- [ ] `embeddings` table exists, `sqlite-vec` not installed — v0.6 #3
- [ ] `mcp_consents` unwired — v0.6 #6
- [ ] `projects` unwired — v0.7
- [ ] `rawContentRef` in brief context — v0.6 #5
- [ ] Hand-rolled `apps/web/src/api.ts` types — v0.5 #2
- [ ] No rate limit on `/auth/login` — v0.4 #5
- [ ] `HUB_UI_TOKEN` defaults to cookie HMAC — v0.4 #4
- [ ] `dayStartMs()` UTC — v0.4 #8
- [ ] 4× duplicated vitest `node:sqlite` shim — v0.4 #2
- [ ] Top-level `getLogger()` — v0.4 #9
- [ ] Drizzle-vs-raw-sqlite policy undocumented — v0.4 #10
- [ ] Desktop Commander in default MCP scope — v0.4 #11 + v0.6 #8
- [ ] No CI — v0.4 #1
- [ ] Dashboard polls when backgrounded — v0.5 #10
- [ ] No streaming / skeletons / toasts / optimistic — v0.5 #3–#5, #10
- [ ] No search on Captures — v0.5 #5
- [ ] Settings read-only — v0.6 #10
- [ ] Dark-only theme — V1+
- [ ] PWA iOS install unvalidated — v0.9

---

## 9. Security checklist  *(re-verify each milestone)*

- [ ] `HUB_COOKIE_SECRET` ≠ `HUB_UI_TOKEN` in prod (v0.4 #4)
- [ ] Rate limit on `/auth/login` (v0.4 #5)
- [ ] Per-vendor webhook signatures (v0.4 #6)
- [ ] Dependabot enabled (v0.4 #1)
- [ ] Pino redact list matches `SECURITY.md`
- [ ] `Desktop Commander` MCP allowlist enforced (v0.4 #11, v0.6 #8)
- [ ] Consent audit trail for R2/R3 (v0.6 #6)
- [ ] Secret rotation path exercised (v0.6 #10)
- [ ] Backup+restore rehearsed (v0.9)

---

## 10. Changelog discipline

- Every PR updates `CHANGELOG.md` under `## Unreleased`.
- On milestone close: rename `## Unreleased` → `## v0.X - YYYY-MM-DD`, tag, push tag.
- `DECISIONS.md` gets one entry per reversed-or-committed architectural choice. Append-only.
- `ROADMAP.md` (this file) gets edited in place; history lives in git.
