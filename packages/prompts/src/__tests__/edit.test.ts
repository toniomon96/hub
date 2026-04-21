import { afterAll, afterEach, beforeAll, beforeEach, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { _resetEnvCache } from '@hub/shared'

// Shared log dir to avoid pino async-open race on Windows
let sharedLogDir: string
let testDirs: string[] = []

beforeAll(() => {
  sharedLogDir = mkdtempSync(join(tmpdir(), 'hub-edit-logs-'))
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
  delete process.env['HUB_REGISTRY_REPO_URL']
  delete process.env['HUB_PROMPTS_REPO_URL']
  delete process.env['HUB_GIT_AUTHOR_NAME']
  delete process.env['HUB_GIT_AUTHOR_EMAIL']
  _resetEnvCache()
  for (const d of testDirs) rmSync(d, { recursive: true, force: true })
})

/** Create a local git repo with targets.yml and return its file:// URL. */
function makeRegistryRepo(targetsYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-edit-registry-'))
  testDirs.push(dir)

  execSync('git init -b main', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' })

  execSync('git config receive.denyCurrentBranch ignore', { cwd: dir, stdio: 'pipe' })
  writeFileSync(join(dir, 'targets.yml'), targetsYaml)
  execSync('git add -A', { cwd: dir, stdio: 'pipe' })
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' })
  return `file://${dir.replace(/\\/g, '/')}`
}

async function freshEnv(registryUrl: string) {
  const dbDir = mkdtempSync(join(tmpdir(), 'hub-edit-db-'))
  testDirs.push(dbDir)
  process.env['ANTHROPIC_API_KEY'] = 'test-key'
  process.env['HUB_DB_PATH'] = join(dbDir, 'hub.db')
  process.env['HUB_LOG_DIR'] = join(sharedLogDir, 'logs')
  process.env['HUB_LOG_LEVEL'] = 'error'
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['HUB_REGISTRY_REPO_URL'] = registryUrl
  process.env['HUB_GIT_AUTHOR_NAME'] = 'Test Bot'
  process.env['HUB_GIT_AUTHOR_EMAIL'] = 'bot@test.com'
  _resetEnvCache()
  // Run migrations so agent_locks and other tables exist
  const { closeDb } = await import('@hub/db')
  closeDb()
  const { migrate } = await import('@hub/db/migrate')
  migrate()
}

const INITIAL_YAML = `targets: []
`

const YAML_WITH_COMMENTS = `# Hub registry
# Managed by hub registry commands
targets:
  # Production repos
  - repo: org/existing-repo
    # daily review schedule
    targets:
      - prompt_id: daily-review
        trigger: "cron:0 9 * * 1-5"
        enabled: true
`

it('addTarget creates a new repo block', async () => {
  const registryUrl = makeRegistryRepo(INITIAL_YAML)
  await freshEnv(registryUrl)

  const { addTarget } = await import('../edit.js')
  const result = await addTarget({ repo: 'org/new-repo', branch: 'main', sensitivity: 'low' })

  expect(result.committed).toBe(true)
  expect(result.diff).toContain('+')
  expect(result.commitSha).toBeTruthy()
  expect(result.pushedTo).toBe('main')
})

it('comment preservation: comments survive addTarget round-trip', async () => {
  const registryUrl = makeRegistryRepo(YAML_WITH_COMMENTS)
  await freshEnv(registryUrl)

  const { addTarget } = await import('../edit.js')
  await addTarget({ repo: 'org/second-repo' })

  // Clone the registry and verify comments are still present
  const cloneDir = mkdtempSync(join(tmpdir(), 'hub-edit-verify-'))
  testDirs.push(cloneDir)
  execSync(`git clone "${registryUrl.replace('file://', '')}" "${cloneDir}/verify"`, {
    stdio: 'pipe',
  })
  const content = readFileSync(join(cloneDir, 'verify', 'targets.yml'), 'utf8')
  expect(content).toContain('# Hub registry')
  expect(content).toContain('# Managed by hub registry commands')
  expect(content).toContain('# Production repos')
  expect(content).toContain('# daily review schedule')
})

it('dry-run returns diff without committing', async () => {
  const registryUrl = makeRegistryRepo(INITIAL_YAML)
  await freshEnv(registryUrl)

  // Get the initial commit count
  const repoDir = registryUrl.replace('file://', '')
  const initialLog = execSync('git log --oneline', { cwd: repoDir, stdio: 'pipe' })
    .toString()
    .trim()
    .split('\n').length

  const { addTarget } = await import('../edit.js')
  const result = await addTarget({ repo: 'org/dry-run-repo', dryRun: true })

  expect(result.committed).toBe(false)
  expect(result.diff).toContain('+')
  expect(result.commitSha).toBeUndefined()

  // Verify no new commit was created
  const afterLog = execSync('git log --oneline', { cwd: repoDir, stdio: 'pipe' })
    .toString()
    .trim()
    .split('\n').length
  expect(afterLog).toBe(initialLog)
})

it('addTarget is idempotent: re-running updates branch, leaves existing targets intact', async () => {
  const yaml = `targets:
  - repo: org/my-repo
    targets:
      - prompt_id: daily-review
        trigger: "cron:0 9 * * 1-5"
`
  const registryUrl = makeRegistryRepo(yaml)
  await freshEnv(registryUrl)

  const { addTarget } = await import('../edit.js')
  // First call: update branch
  const r1 = await addTarget({ repo: 'org/my-repo', branch: 'develop' })
  expect(r1.committed).toBe(true)

  // Second call with same branch — idempotent, no changes
  const r2 = await addTarget({ repo: 'org/my-repo', branch: 'develop' })
  expect(r2.committed).toBe(false)
  expect(r2.diff).toBe('')

  // Verify the existing target binding is still there
  const cloneDir = mkdtempSync(join(tmpdir(), 'hub-edit-verify2-'))
  testDirs.push(cloneDir)
  execSync(`git clone "${registryUrl.replace('file://', '')}" "${cloneDir}/v"`, { stdio: 'pipe' })
  const content = readFileSync(join(cloneDir, 'v', 'targets.yml'), 'utf8')
  expect(content).toContain('daily-review')
})

it('wirePrompt upserts a binding and re-running with same tuple is idempotent', async () => {
  const yaml = `targets:
  - repo: org/my-repo
    targets: []
`
  const registryUrl = makeRegistryRepo(yaml)
  await freshEnv(registryUrl)

  const { wirePrompt } = await import('../edit.js')
  const r1 = await wirePrompt({
    repo: 'org/my-repo',
    promptId: 'daily-review',
    trigger: 'cron:0 9 * * 1-5',
  })
  expect(r1.committed).toBe(true)

  // Re-run same — no change
  const r2 = await wirePrompt({
    repo: 'org/my-repo',
    promptId: 'daily-review',
    trigger: 'cron:0 9 * * 1-5',
  })
  expect(r2.committed).toBe(false)
  expect(r2.diff).toBe('')
})

it('removeEntry is a no-op when entry does not exist', async () => {
  const registryUrl = makeRegistryRepo(INITIAL_YAML)
  await freshEnv(registryUrl)

  const { removeEntry } = await import('../edit.js')
  const result = await removeEntry({ repo: 'org/nonexistent' })
  expect(result.committed).toBe(false)
  expect(result.diff).toBe('')
})

it('add → wire → remove lifecycle leaves an empty targets list', async () => {
  const registryUrl = makeRegistryRepo(INITIAL_YAML)
  await freshEnv(registryUrl)

  const { addTarget, wirePrompt, removeEntry } = await import('../edit.js')

  await addTarget({ repo: 'org/lifecycle-repo' })
  await wirePrompt({
    repo: 'org/lifecycle-repo',
    promptId: 'daily-review',
    trigger: 'cron:0 9 * * 1',
  })
  // Remove just the prompt binding (leave the repo block)
  const r = await removeEntry({ repo: 'org/lifecycle-repo', promptId: 'daily-review' })
  expect(r.committed).toBe(true)

  const cloneDir = mkdtempSync(join(tmpdir(), 'hub-edit-lifecycle-'))
  testDirs.push(cloneDir)
  execSync(`git clone "${registryUrl.replace('file://', '')}" "${cloneDir}/l"`, { stdio: 'pipe' })
  const content = readFileSync(join(cloneDir, 'l', 'targets.yml'), 'utf8')
  // Repo block still present but no daily-review binding
  expect(content).toContain('org/lifecycle-repo')
  expect(content).not.toContain('daily-review')
}, 30000)

it('validation failure aborts without committing', async () => {
  const registryUrl = makeRegistryRepo(INITIAL_YAML)
  await freshEnv(registryUrl)

  const repoDir = registryUrl.replace('file://', '')
  const logBefore = execSync('git log --oneline', { cwd: repoDir, stdio: 'pipe' })
    .toString()
    .trim()
    .split('\n').length

  // wirePrompt on a repo that doesn't exist throws before writing
  const { wirePrompt } = await import('../edit.js')
  await expect(
    wirePrompt({ repo: 'org/not-added', promptId: 'foo', trigger: 'manual' }),
  ).rejects.toThrow(/not in registry/)

  const logAfter = execSync('git log --oneline', { cwd: repoDir, stdio: 'pipe' })
    .toString()
    .trim()
    .split('\n').length
  expect(logAfter).toBe(logBefore)
})
