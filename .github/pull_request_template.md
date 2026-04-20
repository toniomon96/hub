## What

Closes #

## Why

<!-- User-facing reason. Link to DECISIONS.md if load-bearing. -->

## How

<!-- Approach + trade-offs. -->

## Checklist

- [ ] `pnpm verify` green locally
- [ ] New behavior tested OR `no-test:` reason in PR description
- [ ] No new `any` / disabled lint rules without justification
- [ ] Secrets / PII: none added; redaction list updated if a new field is logged
- [ ] Privacy router untouched OR router tests reviewed
- [ ] CLI: `--help`, exit codes, and `--json` contract updated if applicable
- [ ] `DECISIONS.md` appended if a load-bearing choice changed
- [ ] `CHANGELOG.md` line added (or commit type covers it)

## Load-bearing?

Check if this PR touches `packages/models` (router), `packages/db/src/locks.ts`,
`packages/capture/src/classify.ts`, Gmail send, or DB migrations.

- [ ] Yes — applying `load-bearing` label and extra scrutiny
- [ ] No
