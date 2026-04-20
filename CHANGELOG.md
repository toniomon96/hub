# Changelog

All notable changes are listed here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versioning is CalVer-ish (`0.MAJOR.MINOR+YYYY-MM-DD`) — no SemVer ceremony.

Conventional Commits drive release notes; this file captures the human-facing summary.

## [Unreleased]

### Added

- Process bootstrap: issue + PR templates, Dependabot, split CI jobs, CodeQL + gitleaks + pnpm audit workflows, release workflow on tag, husky pre-commit/pre-push with lint-staged, `pnpm verify` one-shot gate.

## [0.3.0] — 2026-04-21

### Added

- v0.3 MVP scaffold: privacy-gated model router, Drizzle + `node:sqlite` schema + migrations, `hub migrate`, capture ingest with content-hash dedup, Agent SDK `query()` wiring, Hono webhook stubs, CLI (`status`, `capture`, `brief`, `ask`).
