# Changelog

All notable changes are listed here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versioning is CalVer-ish (`0.MAJOR.MINOR+YYYY-MM-DD`) — no SemVer ceremony.

Conventional Commits drive release notes; this file captures the human-facing summary.

## [Unreleased]

### Added

- Process bootstrap: issue + PR templates, Dependabot, split CI jobs, CodeQL + gitleaks + pnpm audit workflows, release workflow on tag, husky pre-commit/pre-push with lint-staged, `pnpm verify` one-shot gate.
- CI: build-test matrix extended to `{ubuntu-24.04, windows-latest} × {Node 22, 24}`; new `smoke-cli` job runs `hub migrate` + `hub doctor` against a tmp DB to catch ESM/`node:sqlite` wiring regressions.

### Changed

- Security workflow's `deps-audit` job now runs on Node 22 (was 20, below the repo's `>=22.5.0` engines floor).

## [0.3.0] — 2026-04-21

### Added

- v0.3 MVP scaffold: privacy-gated model router, Drizzle + `node:sqlite` schema + migrations, `hub migrate`, capture ingest with content-hash dedup, Agent SDK `query()` wiring, Hono webhook stubs, CLI (`status`, `capture`, `brief`, `ask`).
