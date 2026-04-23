# Performance Audit — 2026-04-22

Profile: `core + performance`

Assumed context:
- `critical_user_paths`: CLI ask, webhook ingest, prompt dispatch
- `perf_pain_points`: not yet established
- `current_slos_or_targets`: not yet defined

Tools run:
- `pnpm build`
- `pnpm test`

Tool skips:
- `[TOOL_SKIPPED: Lighthouse — not installed in this environment]`
- `[TOOL_SKIPPED: axe/pa11y — not installed in this environment]`
- `[TOOL_SKIPPED: bundle analyzer — not configured in this repo]`

Findings:
- `HB-005` open, P2, Debt, `performance`: there are still no performance budgets or automated perf/a11y checks. Evidence: `pnpm build` on 2026-04-22 produced `apps/web` bundle `assets/index-B1ghgKyE.js` at `219.90 kB` (`65.84 kB` gzip), and no perf tooling was available.

Notes:
- No obvious hot-path regression surfaced from typecheck/build/test.
- This profile remains shallow until a stable runnable web target and runtime measurements are added.
