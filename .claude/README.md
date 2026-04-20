# Hub `.claude/` directory

This directory is loaded by the Claude Agent SDK when `settingSources: ['project']`
is passed to `query()`. It holds:

- `skills/<name>/SKILL.md` — reusable behaviors Claude invokes by description match
- `agents/<name>.md` — subagent definitions (with `tools` + `mcpServers` frontmatter)

## CWD pinning (load-bearing)

The Agent SDK loads this directory **relative to process CWD**. The
`agent-runtime` wrapper pins CWD to the repo root before calling `query()`
to ensure skills/agents are found regardless of where `hub` was invoked from.

## Adding a new skill or agent

1. Create the folder + `SKILL.md` (or single `.md` for agents).
2. Frontmatter `description:` field is what Claude matches against — make it specific.
3. Commit. No code change needed; SDK picks it up on the next run.

## Versioning

Skills are version-controlled with the rest of the repo. Track meaningful
prose changes via conventional commits (`feat(skill): ...`, `fix(skill): ...`).
