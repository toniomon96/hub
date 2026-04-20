# Security

## Preconditions (mandatory)

- **Windows BitLocker** must be enabled on the drive holding the Hub repo + `data/` + `logs/`. The Hub stores captures, run history, and embeddings at rest; full-disk encryption is the baseline.
- `.env` is gitignored. Never commit secrets. Use `keytar` / `@napi-rs/keyring` for long-lived tokens once V1 ships.
- Repo is a single-user system. Multi-user would require auth, partitioning, and audit changes.

## Secrets policy

- `.env` for local dev only.
- Long-lived tokens (Notion, Todoist, GitHub PAT) → OS keychain in V1.
- Anthropic API key → environment only. Never log.
- pino `redact` config masks `*.token`, `*.apiKey`, `*.password`, `*.secret`, `Authorization` headers, env vars matching `*_TOKEN|*_KEY|*_SECRET|*_PAT`.
- Free-text PII (SSN, account numbers, `sk-...` keys, Bearer tokens in messages) is masked by `redactText()` helper. Use it before logging untrusted strings.

## Privacy guarantee

Sensitivity-flagged input never leaves the machine. Enforced by `packages/models/src/router.ts` via regex match on `HUB_SENSITIVITY_PATTERNS` BEFORE any cloud call. Caller-supplied triage can RAISE sensitivity but never lower it (see `maxSensitivity` helper). Tested in `packages/models/src/__tests__/router.test.ts`.

## Consent model

- Per-MCP-server consent prompt on first connect. Stored in `mcp_consents` table.
- Per-tool allowlist for servers with destructive tools (Desktop Commander especially — default-deny `Bash`/`execute`).
- Per-domain filter: family + personal require `--include` flag or local-only route.

## Encryption

- At rest: BitLocker (mandatory precondition).
- In transit: HTTPS for all Anthropic / MCP HTTP endpoints. Cloudflare Tunnel + Access policies for remote (V2).

## Audit / logging

- pino → `logs/YYYY-MM-DD.log` with 30-day rotation.
- Tool names logged; tool args NOT logged by default (opt-in `run_messages` table for debug).
- `hub audit <date>` (V1) replays a day from logs + runs table.
- Every R1+ run has reversal payload (capped at 64KB) for `hub undo`.

## Backup

- Obsidian Sync (vendor-encrypted) for the vault.
- Nightly `data/hub.db` → encrypted 7zip → rclone to Google Drive (V1 ticket).
- Test the restore quarterly.

## Reporting

If you find a security issue, open a private issue or contact the maintainer directly. Do not PR fixes that include the exploit string.
