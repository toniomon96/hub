# Hub Setup Guide

Work through these tiers in order. Each tier has a concrete verification step —
if it passes, move to the next. Nothing in a later tier depends on being able
to do anything not verified in an earlier tier.

**Current status:** Phase 1 of the live-loop plan is complete. The capture
pipeline (Superwhisper → ingest → classify → Obsidian inbox) is fully wired
and tested; it just needs your credentials to turn on.

---

## Tier 0 — Machine prerequisites (one-time)

Not env vars — software that has to exist before anything runs.

| What | Why | How |
|---|---|---|
| **Node ≥22.5** | `node:sqlite` is built-in as of 22.5 | `node -v` — if <22.5, install from [nodejs.org](https://nodejs.org) or `nvm install 22 && nvm use 22` |
| **pnpm ≥9** | workspace manager this repo uses | `npm i -g pnpm` |
| **Ollama running** | backs the classifier + privacy routes + cost-cap fallback | Install from [ollama.com](https://ollama.com), then `ollama serve` (leave running) |
| **Ollama models pulled** | at minimum the classifier model | In a second shell: `ollama pull phi4-mini` |
| **Git with LF line endings (recommended)** | repo uses LF | `git config --global core.autocrlf input` |
| **BitLocker on your drive** | SECURITY.md requirement — the DB holds everything | Check: Settings → Privacy & Security → Device encryption |

**One-time repo setup:**
```pwsh
cd C:\Users\tonimontez\hub
pnpm install
cp .env.example .env
pnpm build
pnpm hub migrate     # creates data\hub.db and applies schema
```

**Verify Tier 0:**
```pwsh
pnpm hub doctor
```
You should see ✓ marks for node version, node:sqlite, DB file, migrations.
Ollama will ✗ if not running — fix before continuing.

---

## Tier 1 — The minimum to use Hub as *your* assistant

This is the smallest set of env vars that makes the live capture loop work.
Edit `.env` in the repo root. Nothing else needs to change.

### 1.1 Anthropic API key
Get one at [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key.
```
ANTHROPIC_API_KEY=<your-anthropic-api-key>
```
**Why Hub needs it:** cloud routes (the non-private, non-trivial inputs) go to Claude.
Without this key, `hub ask` and `hub brief` can't run at all (env validation fails fast).

**Budget note:** `HUB_DAILY_USD_CAP=5` is the default cap; the router silently
downgrades to Ollama when the day's spend hits it. Tune this in `.env` to your comfort
level; set `0` to disable enforcement.

### 1.2 Obsidian vault path
Point at wherever you want Hub to write capture notes.
```
OBSIDIAN_VAULT_PATH=C:\Users\tonimontez\Documents\ObsidianVault
```
**Why:** classified captures land as `$VAULT/inbox/YYYY-MM-DD-<hash8>.md`.
If this is unset, captures live in SQLite only. If it's set but the folder
doesn't exist, Hub creates `$VAULT/inbox/` on first write.

### 1.3 Privacy patterns (load-bearing)
The router's sensitivity gate is regex-driven. **An empty pattern list makes the
privacy gate dormant** — set this or high-sensitivity content will flow to Claude.
```
HUB_SENSITIVITY_PATTERNS=medical|prescription|diagnosis|therapist,SSN|social.security,bank.*account|routing.*number,salary|compensation,wife|kid|child
```
Format: comma-separated regex groups. Any match anywhere in the input text
forces the request to the local private model (`qwen3:7b` by default) AND
suppresses Obsidian inbox filing for that row (stays in SQLite only).

Add your own names, project codenames, client names, health terms — anything
you never want leaving the machine.

### 1.4 Timezone
```
HUB_TIMEZONE=America/Chicago
```
Affects "today" for both the cost cap and the date stamp on inbox markdown files.

### 1.5 Webhook secret
Required for Superwhisper / any webhook. Generate one:
```pwsh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
Paste the output:
```
HUB_WEBHOOK_SECRET=<64 hex chars>
```
**Empty = server returns 503 on every webhook** (fail-closed by design).

### Verify Tier 1
```pwsh
pnpm build
pnpm hub doctor           # should be fully green
pnpm hub capture "buy milk tomorrow"
pnpm hub status           # row should show classified_domain=personal within a second
```
Check `$OBSIDIAN_VAULT_PATH\inbox\` — you should see a new `.md` file with
frontmatter. This proves classifier + inbox filing.

---

## Tier 2 — Webhook capture (the voice loop)

Once Tier 1 verifies, turn on the server and wire Superwhisper.

### 2.1 Start the server
```pwsh
pnpm --filter @hub/server dev
```
Leave this running. It binds `127.0.0.1:4567` by default.

### 2.2 Configure Superwhisper (iPhone or Windows)
In Superwhisper → Modes → pick your dictation mode → **Webhook**:

| Field | Value |
|---|---|
| URL | `http://127.0.0.1:4567/webhooks/superwhisper` (LAN) or your tunnel URL (remote) |
| Method | `POST` |
| Headers | `x-hub-secret: <your HUB_WEBHOOK_SECRET>`<br>`content-type: application/json` |
| Body | `{"text": "{{transcription}}", "ref": "superwhisper://{{id}}"}` |

### 2.3 Remote access (only if dictating from your phone outside LAN)
**Do not publish port 4567 to the public internet.** Use one of:
- **Cloudflare Tunnel** — `cloudflared tunnel --url http://127.0.0.1:4567`, paste the resulting URL into Superwhisper.
- **Tailscale Funnel** — simpler if you already use Tailscale; exposes a `*.ts.net` URL.
- **ngrok** — fine for testing; not recommended for always-on.

### Verify Tier 2
Dictate a test phrase to Superwhisper → within a second or two:
- New row in `hub status`
- New file in `$VAULT/inbox/`
- Response from webhook: `{ "id": "...", "filed": true, "classified": true }`

If you get `401` → the secret header doesn't match. `503` → `HUB_WEBHOOK_SECRET`
is empty in `.env` (restart the server after editing `.env`).

---

## Tier 3 — Connect the real data (MCP scopes)

Each of these unlocks an MCP server in
[`packages/agent-runtime/src/mcp-config.ts`](packages/agent-runtime/src/mcp-config.ts).
Hub spins up only the servers whose env vars are set, so you can turn them on one at a time.
**I'd do them in this order — each one has the biggest marginal value at its step.**

### 3.1 Obsidian Local REST API (read your vault)
1. In Obsidian → Settings → Community plugins → Browse → install **"Local REST API"** (by coddingtonbear).
2. Enable it → copy the API key from the plugin's settings pane.
3. In `.env`:
   ```
   OBSIDIAN_API_KEY=<the key>
   # OBSIDIAN_HOST and OBSIDIAN_PORT default to 127.0.0.1:27123 which matches the plugin
   ```

**What Hub does with it:** briefs can now read your vault, not just write to it.
Agents can search existing notes, pull up past decisions, reference project docs.

### 3.2 Google Workspace (Calendar + Gmail)
This is the single biggest "feels like an assistant" unlock.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project (or reuse one) → APIs & Services → OAuth consent screen.
2. Set user type = **External**, fill in name/email, add scopes: `calendar.readonly`, `gmail.readonly`, `gmail.send` (add `gmail.send` only if you want assistant-composed drafts — the current code is read-only).
3. Credentials → **Create Credentials → OAuth client ID** → Application type **Desktop app**.
4. Copy the client ID and secret into `.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=<id>.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=<secret>
   ```
5. First time an agent uses workspace scope, the MCP server ([`workspace-mcp`](https://github.com/taylorwilsdon/google_workspace_mcp)) will open a browser window to complete OAuth. It caches the refresh token.

**What Hub does with it:** your morning brief can actually read today's calendar and your overnight email triage.

### 3.3 Todoist (personal task layer)
1. [todoist.com/app/settings/integrations](https://todoist.com/app/settings/integrations) → scroll to **API token** → copy.
2. Clone the Todoist MCP server somewhere permanent and build it:
   ```pwsh
   cd C:\Users\tonimontez
   git clone https://github.com/sjvadrevu/todoist-mcp-server.git
   cd todoist-mcp-server
   npm install
   npm run build
   ```
3. In `.env`:
   ```
   TODOIST_API_TOKEN=<the token>
   TODOIST_MCP_PATH=C:\Users\tonimontez\todoist-mcp-server\dist\index.js
   ```

**What Hub does with it:** briefs include open tasks; action-items detected in
captures can be pushed to Todoist (Phase 3 work).

### 3.4 Notion (structured DBs per your landscape report)
1. [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → **New integration** → give it a name, type = **Internal**, capabilities = read content + update content + insert content.
2. Copy the **Internal Integration Secret**.
3. In Notion itself, open each DB you want Hub to see (Areas, Projects, People, Decisions, etc.) → `···` menu → **Connect to → your integration**.
4. In `.env`:
   ```
   NOTION_TOKEN=secret_<...>
   ```

**What Hub does with it:** read your Areas/Projects/Decisions DBs for brief context;
write decisions/meetings/captures to the right DB (Phase 3+).

### 3.5 GitHub (optional — only if you want assistant on your code)
[github.com/settings/tokens](https://github.com/settings/tokens) → **Fine-grained token** → select repos → scopes: `contents:read`, `issues:read/write`, `pull_requests:read/write`.
```
GITHUB_PAT=github_pat_<...>
```

### Verify Tier 3
```pwsh
pnpm hub doctor
```
Each connected service should now show a green check. Any you haven't configured
shows "skipped" — that's fine and expected.

---

## Tier 4 — Personalization (what turns this into *your* assistant, not a generic one)

Tier 1-3 is plumbing. This is where you tell Hub who you are. **Plain markdown
files in specific places** — no coding.

### 4.1 Identity + preferences
Create `C:\Users\tonimontez\hub\.claude\user.md` with something like:

```markdown
# About me

- Name: <you>
- Timezone: America/Chicago
- Primary domains I work in: family, personal, hobby, client, omnexus, dse
  (these match the classifier's domain enum)
- Communication style: direct, no throat-clearing. Prefer bullets over prose for lists.
- Hard preferences:
  - Never commit to a time block without asking me first
  - Default to markdown, not JSON, in responses
  - My Obsidian vault: <path>. Use existing folder structure when filing new notes.
- Projects I'm active on: <list>
- People I work with often: <name → relationship + context>
- Recurring meetings: <cadence + purpose>
```

Agents loaded via `@anthropic-ai/claude-agent-sdk` pick up anything in
`.claude/` as auto-loaded context. Keep this file short (< 500 lines); it's
read on every invocation.

### 4.2 Domain routing hints
In `.env`, the classifier already knows the domain enum
(`family | personal | hobby | client | omnexus | dse | misc`). If you use
different domain names, edit `packages/shared/src/types.ts` → the
`Domain` enum — **ask me to do this**, it cascades to the classifier prompt
and the sensitivity gate.

### 4.3 Obsidian vault structure (only if it doesn't already exist)
The [`obsidian-writer` skill](.claude/skills/obsidian-writer/SKILL.md) expects:
```
<vault>/
├── briefings/              # daily briefs
├── meetings/
│   ├── family/
│   ├── personal/
│   ├── hobby/
│   ├── client/
│   ├── omnexus/
│   ├── dse/
│   └── misc/
├── decisions/              # one file per project-slug
├── inbox/                  # Hub writes here automatically
├── projects/               # one folder per project-slug
└── journal/                # YYYY/MM/YYYY-MM-DD.md
```
Create any missing folders. If you want a different layout, tell me and I'll
patch the skill to match yours — it's the one place paths are defined.

### 4.4 (Optional) Named entities
If you're going to rely heavily on entity recognition for family/work names,
drop a list in `.claude/entities.md`:
```markdown
# People I talk about by first name

- Alice = my spouse
- Bob = client at Acme
- Carol = my kid's teacher

# Projects by codename

- Omnexus = my main SaaS
- DSE = daily-shorts-engine content channel
```
The classifier will later be able to cross-reference this (Phase 3+). Creating
the file now is forward-compatible; nothing breaks without it.

---

## What I need from you — minimum checklist

The shortest path from where you are now to "it works":

- [ ] **Ollama running locally** with `phi4-mini` pulled.
- [ ] `.env` populated with:
  - [ ] `ANTHROPIC_API_KEY`
  - [ ] `OBSIDIAN_VAULT_PATH` (absolute path)
  - [ ] `HUB_SENSITIVITY_PATTERNS` (tuned to you)
  - [ ] `HUB_TIMEZONE`
  - [ ] `HUB_WEBHOOK_SECRET` (generated hex)
- [ ] `pnpm install && pnpm build && pnpm hub migrate` run once.
- [ ] `pnpm hub doctor` fully green.
- [ ] `pnpm hub capture "test"` produces a file in `$VAULT/inbox/`.

After that, Tier 3 (MCP scopes) is additive — you can wire them in whatever
order maps to what you care about most. Tier 4 (personalization) is what
separates this from being a capture tool vs. an actual assistant — do this
*before* you start leaning on `hub brief` and `hub ask`.

---

## Asks for you (help me help you)

These are things only you can decide. Paste your answers in chat and I'll
either wire them up or we'll discuss:

1. **Domain list.** The current enum is `family | personal | hobby | client | omnexus | dse | misc`. Is that your actual taxonomy, or do we need to edit it?
2. **Sensitivity patterns.** What topics / names should *never* hit Claude? (I'll help refine the regex.)
3. **Brief cadence.** Once / day at what local time? Any other cadences (Monday weekly review, Friday retro)?
4. **Vault layout.** Stock (as in §4.3 above) or do you have an existing structure I should match?
5. **Remote access posture.** Cloudflare Tunnel, Tailscale, LAN-only?
6. **Approval posture.** For R1+ actions (anything non-read-only: sending an email, writing to Notion, pushing to GitHub) — do you want: (a) CLI prompt every time, (b) dashboard approval queue, (c) ntfy push on phone, (d) fully autonomous with audit log?
7. **What do you want me to do with captures?** Just file them for now, or also: create Todoist tasks from action items, open GitHub issues for code thoughts, draft Gmail replies for email captures? I'll build whatever dispatch rules you want.

When you're ready, give me answers to those seven questions + confirmation that
Tier 1 verified on your machine, and I'll start on Phase 3 (real `hub brief`
that uses all of this).
