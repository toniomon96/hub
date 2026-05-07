# Practice OS Runtime Readiness

Status: repo-local readiness note for the Practice OS strategic backlog.

Owner: `hub`

Canonical practice source: `C:\Users\tonimontez\Projects\diagnose-to-plan`

## Purpose

Hub should support the Practice OS where runtime is actually needed: intake,
private console operations, prompts, webhooks, health checks, and future
retrieval/runtime services. It should not become the Practice OS source of
truth.

## Current Boundary

Hub owns:

- consulting `/start` intake receiving;
- private console/runtime records;
- prompt execution and target sync evidence;
- webhook capture;
- cron/runtime support;
- health/status endpoints;
- runtime verification evidence.

Hub does not own:

- DTP roadmap state;
- private engagement kits;
- client proof packets;
- public consulting copy;
- CRM/billing/accounting;
- client portals by default;
- autonomous authority escalation.

## Near-Term Backlog

| Priority | Work | Gate |
|---|---|---|
| P0 | Keep `docs/HUB_RUNTIME_CURRENT_STATE.md` current before runtime expansion | classify every touched surface |
| P0 | Preserve v0.4 hardening order from `ROADMAP.md` | CI/security/auth/webhook gates first |
| P1 | Verify consulting intake path only when credentials and scope are explicit | live health, protected route, intake row, cleanup |
| P1 | Clarify legacy-proxy routes before building on them | route-by-route decision |
| P1 | Keep prompt/registry validation local-first | no private sibling CI access unless approved |
| P2 | Explore memory retrieval only after DTP Knowledge Base V1 corpus exists | privacy/citation/refusal tests |

## Draft-Only Automation

Hub can prepare:

- runtime readiness summaries;
- health/intake smoke checklists;
- prompt/registry validation notes;
- proposed console/admin work items;
- retrieval design drafts.

Hub must not automatically:

- send external communication;
- publish public proof;
- mutate DTP source-of-truth state;
- create client records as source truth;
- write CRM/billing/accounting state;
- grant new runtime authority.

## Acceptance

This note is accepted when future Hub work can answer:

- which surface is live-hosted, local-only, legacy-proxy, planned, or retired;
- whether the work supports intake/runtime or tries to become practice memory;
- which DTP gate owns proof, client state, or roadmap movement;
- which Hub verification commands and live checks are required.

