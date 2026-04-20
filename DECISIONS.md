# Decisions

Append-only log. Newest at the bottom. Update when you change your mind.

---

## 2026-04-21 — TypeScript over Python
Better Agent SDK + MCP story on Windows. Unified language with frontend.

## 2026-04-21 — Monolithic server, not microservices
One Hono process for API + webhooks + (V2) MCP server + agent runtime. Fewer failure modes at personal scale.

## 2026-04-21 — SQLite + Obsidian, not Postgres
Embedded DB, zero ops, portable markdown. SQLite rebuildable from Obsidian where Obsidian-derived; runs/captures/cost history is NOT rebuildable — separate nightly encrypted dump → Drive.

## 2026-04-21 — Claude Agent SDK as agent core
Not a framework — Anthropic's primitives exposed. Skip LangGraph, Mastra, CrewAI, VoltAgent.

## 2026-04-21 — Hub is both MCP client and MCP server
Composition is the point. Claude Desktop calls `hub.*`; Hub calls Notion/Obsidian/etc.

## 2026-04-21 — Rule-based model router
Local SLM for private/trivial, Claude otherwise. Readable, testable.

## 2026-04-21 — Scheduler: local cron authoritative; Routines for cloud-only agents
**v0.3 fix**: no cross-scheduler coordination. Local cron with DB-backed lease table is authoritative. Routines used only for agents that don't need local Hub state. If a Routine needs Hub data, it fires a webhook into the local Hub and waits.

## 2026-04-21 — Obsidian + Notion split
Obsidian for prose and durability. Notion for the 8 structured databases.

## 2026-04-21 — Todoist + Linear, two systems unified at the Hub
Personal commitments vs. software execution; unify in retrieval, not by flattening.

## 2026-04-21 — Martin AI as partner surface, not component
Integrate via shared Google Workspace + email forwarding. Hold tighter API integration for when Martin's developer surface matures.

## 2026-04-21 — Superwhisper is the default voice capture path
Lowest friction on Windows + iPhone. Custom-mode webhook for programmatic; dictate-then-dispatch fallback.

## 2026-04-21 — No dedicated memory layer at start
Obsidian + SQLite + sqlite-vec. Revisit Mem0 / MemLayer in V2 month 3.

## 2026-04-21 — Skip MCP aggregators
Agent SDK handles MCP natively per-query. Aggregators are premature.

## 2026-04-21 — Skip Microsoft 365 Copilot
Wrong ecosystem, redundant with Claude.

## 2026-04-21 — Todoist MCP: `sjvadrevu/todoist-mcp-server` with permanent token
Avoids the OAuth refresh bug in the "official" Todoist MCP.

## 2026-04-21 — Google Workspace MCP: `taylorwilsdon/google_workspace_mcp`
One server covers Gmail, Calendar, Drive, Docs, Sheets with OAuth 2.1.

---

## 2026-04-21 — v0.3 load-bearing fixes (from review)

### Privacy router ships at MVP, not V1
The v0.2 cut list deferred the router and "hardcoded Sonnet" at MVP — that contradicted the privacy guarantee. Three-rule router ships day one. Sensitivity computed by regex BEFORE any cloud call. Caller cannot override downward (see `packages/models/src/router.ts`, `maxSensitivity` helper). Tested in `__tests__/router.test.ts`.

### Gmail send is R2 with NO undo
Removed the 30-second undo claim for Gmail send. Once the API call returns, the message is gone. Confirm-only.

### Capture classifier is NOT an Agent SDK subagent
Subagents inherit the parent's provider; you can't have an Ollama-backed subagent inside a Claude `query()`. Classifier lives in `packages/capture/src/classify.ts` as a direct Ollama call.

### Decision-log consistency: Obsidian-first, reconcile to Notion
Documented in `.claude/skills/obsidian-writer/SKILL.md`. Avoids silent inconsistency between dual-write destinations.

### Scheduler coordination via DB lease, not in-process mutex
`packages/db/src/locks.ts` implements `tryAcquireLease` / `withLease`. Survives restart. Routines do NOT compete for the same lease — they fire webhooks into local Hub instead.

### Per-action confidence thresholds, not single 0.8 scalar
Documented as backlog ticket. Not yet implemented; the placeholder constant is in capture pipeline.

### Reranker between top-K=20 and top-5 in retrieval
Backlog ticket E-extension. `bge-reranker-base` local OR Voyage hosted. Not in MVP; required before V1 RAG ships.
