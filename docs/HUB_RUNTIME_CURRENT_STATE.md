# Hub Runtime Current-State Map

Status: current-state map for Hub runtime ownership and expansion decisions.

Owner: `hub`

Purpose: classify Hub surfaces before adding features, treating runtime evidence as current, or expanding Hub into adjacent business responsibilities.

This map is based on repo documentation and static config. Live Vercel, Railway, Supabase, webhook, cron, and auth state still require targeted runtime verification before being used as release evidence.

Practice OS runtime readiness is tracked in
`docs/PRACTICE_OS_RUNTIME_READINESS.md`. Use it when DTP asks Hub to support the
Client OS pilot wave, consulting intake, future retrieval, or runtime evidence.
It does not transfer DTP source-of-truth ownership into Hub.

## Latest Packaging Check

2026-05-04 local validation passed:

- `pnpm verify`
- `pnpm test`
- `pnpm hub doctor`
- `git diff --check`

Open GitHub PRs observed during packaging: `#64`, `#65`, `#66`, `#67`, and
`#68`, all Dependabot dependency PRs. Treat older memory saying Hub has no open
PRs as stale.

## Status Vocabulary

| Status | Meaning |
|---|---|
| `live-hosted` | Documented as hosted through Hub Vercel/Supabase today; still verify live before release evidence |
| `local-only` | Works from the local Hub/runtime environment or local machine assumptions |
| `legacy-proxy` | Still routed to the legacy Railway/server path or depends on older local assumptions |
| `planned` | Documented as future or deferred |
| `retired` | Should not be expanded; only preserved as historical context |

## Current Surface Map

| Surface | Status | Evidence | Owner boundary | Next action |
|---|---|---|---|---|
| `/console` private admin console | `live-hosted` | `docs/CONSULTING_CONSOLE_FULL_STACK.md` names private Vercel admin console at `/console` | Hub owns runtime actions, todos, outreach, inbound review | Verify auth and data before treating as release proof |
| Consulting `/start` intake into `/api/intake` | `live-hosted` | consulting/Hub docs name `PUBLIC_CONSULTING_INTAKE_ENDPOINT` and `/api/intake`; Hub accepts structured `practice-start-v1` triage fields plus legacy aliases | Hub receives runtime intake; DTP decides accepted practice work | Keep Hub primary and Formspree fallback on consulting |
| Supabase consulting console tables | `live-hosted` | `202604270001_consulting_console_ops.sql` creates `admin_todos`, `outreach_events`, `intake_submissions`; `202605080001_consulting_intake_triage_fields.sql` adds structured intake review fields | Hub runtime store only | Verify both consulting migrations before runtime evidence |
| Supabase Hub cloud runtime tables | `live-hosted` | `202604270002_hub_cloud_runtime_foundation.sql` adds captures, runs, briefings, projects, prompts, targets, locks, cron, webhooks | Hub cloud runtime support | Do not assume embeddings/vector search migrated |
| `/auth/login` and `/auth/logout` | `live-hosted` | `vercel.json` rewrites `/auth/:path*` to `/api/auth/:path*` | Hub auth boundary | Verify protected console behavior |
| `/health` | `live-hosted` | `vercel.json` rewrites `/health` to `/api/health` | Health/status only | Use for live health checks, not proof of full runtime |
| `/api/status` | `live-hosted` | Hub docs say backed by Supabase Hub cloud tables | Status reporting | Verify with live domain before quoting |
| `/api/console/*` | `live-hosted` | Hub docs name hosted console API routes | Private console runtime | Must remain protected and private |
| `/webhooks/*` | `live-hosted` | `vercel.json` rewrites to `/api/webhooks/*`; docs require secrets | Capture/runtime ingest | Secret headers required; never print values |
| `/api/cron/*` | `live-hosted` | `vercel.json` lists cron paths and docs require `CRON_SECRET` | Scheduled runtime support | Verify Vercel cron and Supabase records before evidence |
| Other `/api/*` paths | `legacy-proxy` | `vercel.json` still includes a broad `/api/:path*` Railway fallback while docs state other legacy paths still proxy to Railway | Legacy runtime bridge | Retire, move behind local worker, or document route-by-route before expansion |
| Local SQLite ops database | `local-only` | `ARCHITECTURE.md` documents SQLite `captures`, `runs`, `embeddings`, `briefings`, `projects`, locks, consents | Local/private runtime data | Do not expose as hosted source of truth |
| Ollama privacy router | `local-only` | README and architecture require local Ollama models | Private local model routing | Keep privacy-sensitive tasks local unless hosted privacy design exists |
| Obsidian/local filesystem outputs | `local-only` | Architecture references Obsidian path writes and local filesystem assumptions | Personal/local memory support | Do not mix with hosted proof or client records |
| Prompt catalog sync from `hub-prompts` | `local-only` | Architecture documents git clone/parse/sync into DB | Hub prompt execution support | Keep prompt content versioned outside Hub |
| Target registry sync from `hub-registry` | `local-only` | Architecture documents registry parse/validation and edit flow | Automation routing config | Treat changes as automation-impacting mutations |
| Registry edit CLI/HTTP/MCP tools | `local-only` | README documents CLI, HTTP, and MCP operations | Controlled registry mutation | Prefer dry-run first; do not auto-enroll repos |
| Hub as MCP server for external agents | `planned` | Architecture lists Hub-as-MCP-server as V1+ | Future integration | Do not build before runtime scope is clean |
| GitHub PR-triggered prompt endpoint | `planned` | Architecture lists `/webhooks/github` as deferred until reliable inbound cutover | Future automation | Keep manual until event safety is accepted |
| Bulk registry import or auto-enrollment | `retired` | Architecture says bulk import and auto-enrollment are not planned | None | Preserve deliberate registry curation |
| Per-repo `.hub/prompts.yml` merging | `retired` | Architecture rejects it as extra complexity | None | Keep central registry model |

## Hub Owns

Hub is allowed to own:

- private runtime intake and console operations;
- `/start` intake receiving and validation;
- protected console actions, todos, outreach, inbound, and dashboard support;
- prompt execution evidence and prompt/target runtime state;
- webhook capture and cron scheduling;
- Supabase runtime rows for Hub-owned tables;
- runtime verification evidence for intake and console behavior.

## Hub Does Not Own

Hub must not own:

- DTP source-of-truth docs;
- Client Operating Kits;
- proof packet creation or approval;
- public consulting proof pages;
- CRM, billing, time tracking, or accounting;
- client portals by default;
- Notion source-of-truth state;
- private engagement vaults;
- autonomous escalation of authority.

Hub may link to DTP surfaces later, but those links do not transfer ownership.

## Expansion Gate

Before adding or expanding any Hub feature:

1. Classify the surface with this file's status vocabulary.
2. Confirm whether the target is hosted, local-only, legacy-proxy, planned, or retired.
3. If proof, client records, COI, public copy, or roadmap ownership is involved, route to DTP first.
4. If a route still depends on Railway, SQLite, Ollama, Obsidian, MCP, shell, or local filesystem behavior, do not treat it as clean hosted runtime.
5. Prefer narrow runtime support over generalized cockpit expansion.
6. Update this file when the classification changes.

## Verification Path

Local/documentation verification:

```powershell
pnpm verify
pnpm test
pnpm hub doctor
```

Runtime verification when credentials and live scope are explicit:

- call the live health route;
- confirm protected console routes reject unauthenticated requests;
- confirm consulting uses the intended `PUBLIC_CONSULTING_INTAKE_ENDPOINT`;
- submit one practical structured test intake, verify the private Hub row includes the triage fields, then delete or archive test data;
- verify Supabase migrations before claiming runtime table readiness;
- verify Vercel cron and webhook behavior before treating scheduled/capture evidence as current.

Secret scanning:

```powershell
pnpm security:secrets
```

If the scanner is missing, record a missing hard-gate tool. Do not call the scan passed.

## Current Decision

Hub is valuable because it supports the practice runtime without becoming the practice itself. The next Hub work should reduce ambiguity, retire or isolate legacy routes, and make intake/console evidence clearer. It should not add CRM, billing, client portal, DTP cockpit, or public proof behavior.
