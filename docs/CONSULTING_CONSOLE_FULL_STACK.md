# Consulting Console Full-Stack Setup

The consulting console is split across three surfaces:

- `consulting`: public Vercel site and `/start` intake path.
- `hub`: private Vercel admin console at `/console`.
- Supabase: live operational store for todos, outreach, and intake submissions.
- `diagnose-to-plan`: canonical Practice OS roadmap, Client Operating Kits, redaction, COI, hosted DTP direction, and pattern promotion.

`engineering-playbook` remains the markdown source for portfolio schemas, templates, historical decisions, and general operating doctrine. Practice-wide production sequencing now lives in `diagnose-to-plan/docs/PRACTICE_PRODUCTION_ROADMAP.md`.

Practice-wide sequencing lives in `diagnose-to-plan/docs/PRACTICE_PRODUCTION_ROADMAP.md`. Hub owns runtime intake and operator records; it does not own DTP engagement kits or public proof pages.

## Supabase

Apply this migration first:

```sql
supabase/migrations/202604270001_consulting_console_ops.sql
```

Required tables:

- `admin_todos`
- `outreach_events`
- `intake_submissions`

RLS is enabled on all three. The browser does not talk to Supabase directly; Hub Vercel Functions use a server-only Supabase secret/service key.

For the Railway exit foundation, also apply:

```sql
supabase/migrations/202604270002_hub_cloud_runtime_foundation.sql
```

That migration adds Supabase-backed cloud tables for Hub captures, runs, briefings, projects, feedback, prompts, prompt targets, locks, cron runs, and webhook receipts. It intentionally does not migrate embeddings or vector search.

## Hub Vercel Environment

Set these in the Hub Vercel project:

```dotenv
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
HUB_UI_TOKEN=
HUB_COOKIE_SECRET=
CONSOLE_SOURCE_ADAPTER=github
CONSOLE_PLAYBOOK_REPO=
CONSOLE_PLAYBOOK_REF=main
CONSOLE_PORTFOLIO_REPOS=
CONSULTING_INTAKE_ALLOWED_ORIGINS=https://tonimontez.co,https://www.tonimontez.co
CONSULTING_INTAKE_SUCCESS_URL=https://tonimontez.co/start
HUB_WEBHOOK_SECRET=
HUB_WEBHOOK_SECRET_GRANOLA=
HUB_WEBHOOK_SECRET_PLAUD=
HUB_WEBHOOK_SECRET_MARTIN=
```

Use `SUPABASE_SECRET_KEY` for current Supabase projects. `SUPABASE_SERVICE_ROLE_KEY` is supported for legacy projects.

## Consulting Vercel Environment

Set this in the consulting Vercel project:

```dotenv
PUBLIC_CONSULTING_INTAKE_ENDPOINT=https://<hub-domain>/api/intake
```

Leave `PUBLIC_FORMSPREE_ENDPOINT` in place during the transition if you want a quick rollback path.

## Admin Console Flow

1. Open `/console`.
2. Add the next concrete business action in `todos`.
3. Log every referral DM or follow-up in `outreach`.
4. Watch `/start` submissions appear in `inbound`.
5. Keep the roadmap gates visible before building new surfaces.

The console can now manage actions. It should still not become a CRM, billing surface, time tracker, client portal, vector search layer, or generalized project cockpit.

It should also not become the DTP cockpit by another name. Hosted DTP, Client Operating Kits, redaction review, COI review, pattern promotion, and case-study packet preparation belong in `diagnose-to-plan`. Hub may link to those surfaces later, but it should keep its own data model focused on runtime support and intake operations.

## Railway Exit Foundation

The Hub Vercel project now owns these hosted routes:

- `/auth/login` and `/auth/logout` via Vercel rewrites to `/api/auth/*`.
- `/health` via `/api/health`.
- `/api/status`, backed by Supabase Hub cloud tables.
- `/api/console/*` and `/api/intake`.
- `/webhooks/*` via Vercel rewrites to `/api/webhooks/*`.
- `/api/cron/*`, protected by `CRON_SECRET`.

Other legacy `/api/*` routes still proxy to Railway until their SQLite, local-filesystem, Ollama, Obsidian, MCP, and shell assumptions are retired or moved behind a local worker.

To seed Supabase from the current local SQLite database after applying both migrations:

```powershell
pnpm migrate:hub:supabase
```

The export is idempotent: existing rows are upserted by their primary keys or natural unique keys. Run it from the Hub repo with the Supabase service credentials in the environment.
