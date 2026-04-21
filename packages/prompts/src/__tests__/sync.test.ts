import { afterAll, afterEach, beforeAll, beforeEach, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { _resetEnvCache } from '@hub/shared'

// Single log dir to avoid pino async-open race on Windows
let sharedLogDir: string
let testDirs: string[] = []

beforeAll(() => {
  sharedLogDir = mkdtempSync(join(tmpdir(), 'hub-sync-logs-'))
  mkdirSync(join(sharedLogDir, 'logs'), { recursive: true })
})

afterAll(() => {
  rmSync(sharedLogDir, { recursive: true, force: true })
})

beforeEach(() => {
  testDirs = []
})

afterEach(async () => {
  const { closeDb } = await import('@hub/db')
  closeDb()
  delete process.env['HUB_DB_PATH']
  delete process.env['HUB_PROMPTS_REPO_URL']
  delete process.env['HUB_REGISTRY_REPO_URL']
  _resetEnvCache()
  for (const d of testDirs) rmSync(d, { recursive: true, force: true })
})

/** Create a local git repo with a `prompts/` directory of .md files. Returns file:// URL. */
function makePromptRepo(prompts: Array<{ name: string; content: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-sync-prompts-'))
  testDirs.push(dir)

  execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })

  mkdirSync(join(dir, 'prompts'), { recursive: true })
  for (const p of prompts) {
    writeFileSync(join(dir, 'prompts', p.name), p.content)
  }
  execSync('git add -A', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
  return `file://${dir.replace(/\\/g, '/')}`
}

function makeRegistryRepo(targetsYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-sync-registry-'))
  testDirs.push(dir)

  execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })

  writeFileSync(join(dir, 'targets.yml'), targetsYaml)
  execSync('git add -A', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
  return `file://${dir.replace(/\\/g, '/')}`
}

function freshDbEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-sync-db-'))
  testDirs.push(dir)
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(dir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(sharedLogDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  _resetEnvCache()
}

const VALID_PROMPT_MD = `---
id: daily-review
version: 1
title: Daily Review
description: Review the day
sensitivity: low
complexity: standard
output_config: {}
---
Review {{repo}} for today.
`

it('syncs prompts from a local repo into the DB', async () => {
  const promptsDir = makePromptRepo([{ name: 'daily-review.md', content: VALID_PROMPT_MD }])
  freshDbEnv()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  const { syncPrompts } = await import('../sync.js')
  const result = await syncPrompts({ promptsRepoUrl: promptsDir, branch: 'main' })

  expect(result.promptsUpserted).toBe(1)
  expect(result.targetsUpserted).toBe(0)
  expect(result.errors).toHaveLength(0)

  const { getRawDb } = await import('@hub/db')
  const rows = getRawDb().prepare('SELECT id, title, body FROM prompts').all() as Array<{
    id: string
    title: string
    body: string
  }>

  expect(rows).toHaveLength(1)
  expect(rows[0]!.id).toBe('daily-review')
  expect(rows[0]!.title).toBe('Daily Review')
  expect(rows[0]!.body).toContain('Review {{repo}} for today.')
})

it('syncs prompts and registry targets into the DB', async () => {
  const promptsDir = makePromptRepo([{ name: 'daily-review.md', content: VALID_PROMPT_MD }])
  const registryDir = makeRegistryRepo(`
targets:
  - repo: org/my-repo
    targets:
      - prompt_id: daily-review
        trigger: "cron:0 9 * * 1-5"
        enabled: true
`)
  freshDbEnv()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  const { syncPrompts } = await import('../sync.js')
  const result = await syncPrompts({
    promptsRepoUrl: promptsDir,
    registryRepoUrl: registryDir,
    branch: 'main',
  })

  expect(result.promptsUpserted).toBe(1)
  expect(result.targetsUpserted).toBe(1)
  expect(result.errors).toHaveLength(0)

  const { getRawDb } = await import('@hub/db')
  const targets = getRawDb()
    .prepare('SELECT repo, prompt_id, trigger FROM prompt_targets')
    .all() as Array<{ repo: string; prompt_id: string; trigger: string }>

  expect(targets).toHaveLength(1)
  expect(targets[0]!.repo).toBe('org/my-repo')
  expect(targets[0]!.prompt_id).toBe('daily-review')
  expect(targets[0]!.trigger).toBe('cron:0 9 * * 1-5')
})

it('throws when registry references unknown prompt_id', async () => {
  const promptsDir = makePromptRepo([{ name: 'daily-review.md', content: VALID_PROMPT_MD }])
  const registryDir = makeRegistryRepo(`
targets:
  - repo: org/repo
    targets:
      - prompt_id: does-not-exist
        trigger: manual
`)
  freshDbEnv()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  const { syncPrompts } = await import('../sync.js')
  await expect(
    syncPrompts({ promptsRepoUrl: promptsDir, registryRepoUrl: registryDir, branch: 'main' }),
  ).rejects.toThrow(/unknown prompt_id.*does-not-exist/)
})

it('removes stale targets that no longer appear in registry', async () => {
  const promptsDir = makePromptRepo([{ name: 'daily-review.md', content: VALID_PROMPT_MD }])
  const registryDir = makeRegistryRepo(`
targets:
  - repo: org/my-repo
    targets:
      - prompt_id: daily-review
        trigger: "cron:0 9 * * 1-5"
`)
  freshDbEnv()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  // First sync: adds 1 target
  const { syncPrompts } = await import('../sync.js')
  await syncPrompts({ promptsRepoUrl: promptsDir, registryRepoUrl: registryDir, branch: 'main' })

  // Second sync with empty registry: removes the target
  const emptyRegistryDir = makeRegistryRepo('targets: []')
  const result = await syncPrompts({
    promptsRepoUrl: promptsDir,
    registryRepoUrl: emptyRegistryDir,
    branch: 'main',
  })

  expect(result.targetsRemoved).toBe(1)
  expect(result.targetsUpserted).toBe(0)

  const { getRawDb } = await import('@hub/db')
  const count = (
    getRawDb().prepare('SELECT count(*) as c FROM prompt_targets').get() as { c: number }
  ).c
  expect(count).toBe(0)
})

it('accumulates parse errors but still upserts valid prompts', async () => {
  const promptsDir = makePromptRepo([
    { name: 'good.md', content: VALID_PROMPT_MD },
    {
      name: 'bad.md',
      content: `---
id: bad
title: Bad
---
missing required fields
`,
    },
  ])
  freshDbEnv()

  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()

  const { syncPrompts } = await import('../sync.js')
  const result = await syncPrompts({ promptsRepoUrl: promptsDir, branch: 'main' })

  expect(result.promptsUpserted).toBe(1)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]!.file).toBe('bad.md')
})
