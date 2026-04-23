import { existsSync, accessSync, constants, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import type * as NodeSqlite from 'node:sqlite'
import kleur from 'kleur'
import { loadEnv, type Env } from '@hub/shared'

// esbuild (bundled in tsup) rewrites `node:sqlite` to bare `sqlite` in the
// output even with `external: [/^node:/]`. Pull it via createRequire so the
// string is opaque to the bundler.
const requireFromHere = createRequire(import.meta.url)
const builtinName = 'node:' + 'sqlite'
const { DatabaseSync } = requireFromHere(builtinName) as typeof NodeSqlite

export type CheckStatus = 'ok' | 'fail' | 'skip'

export interface CheckResult {
  name: string
  status: CheckStatus
  detail?: string
  required: boolean
}

const MIN_NODE = [22, 5] as const

function checkNode(): CheckResult {
  const m = process.versions.node.match(/^(\d+)\.(\d+)/)
  if (!m) {
    return { name: 'node version', status: 'fail', detail: process.versions.node, required: true }
  }
  const major = Number(m[1])
  const minor = Number(m[2])
  const ok = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])
  return {
    name: 'node version',
    status: ok ? 'ok' : 'fail',
    detail: `${process.versions.node} (need >= ${MIN_NODE[0]}.${MIN_NODE[1]})`,
    required: true,
  }
}

function checkSqliteBuiltin(): CheckResult {
  return {
    name: 'node:sqlite builtin',
    status: typeof DatabaseSync === 'function' ? 'ok' : 'fail',
    required: true,
  }
}

function checkEnv(): { result: CheckResult; env: Env | undefined } {
  try {
    const env = loadEnv()
    return { result: { name: 'env (.env + zod)', status: 'ok', required: true }, env }
  } catch (err) {
    return {
      result: {
        name: 'env (.env + zod)',
        status: 'fail',
        detail: err instanceof Error ? err.message.split('\n').slice(0, 3).join(' ') : String(err),
        required: true,
      },
      env: undefined,
    }
  }
}

function checkPathWritable(label: string, path: string, required: boolean): CheckResult {
  try {
    mkdirSync(path, { recursive: true })
    const probe = join(path, `.doctor-${process.pid}-${Date.now()}`)
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return { name: label, status: 'ok', detail: path, required }
  } catch (err) {
    return {
      name: label,
      status: 'fail',
      detail: `${path}: ${err instanceof Error ? err.message : String(err)}`,
      required,
    }
  }
}

function checkDbFileWritable(dbPath: string): CheckResult {
  const dir = dirname(dbPath)
  try {
    mkdirSync(dir, { recursive: true })
    if (existsSync(dbPath)) {
      accessSync(dbPath, constants.R_OK | constants.W_OK)
      return { name: 'db file', status: 'ok', detail: dbPath, required: true }
    }
    accessSync(dir, constants.W_OK)
    return {
      name: 'db file',
      status: 'ok',
      detail: `${dbPath} (will be created)`,
      required: true,
    }
  } catch (err) {
    return {
      name: 'db file',
      status: 'fail',
      detail: `${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      required: true,
    }
  }
}

function checkMigrations(dbPath: string): CheckResult {
  if (!existsSync(dbPath)) {
    return {
      name: 'db migrations',
      status: 'skip',
      detail: 'db not yet created - run `hub migrate`',
      required: false,
    }
  }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const row = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`,
        )
        .get() as { name?: string } | undefined
      if (!row?.name) {
        return {
          name: 'db migrations',
          status: 'fail',
          detail: 'no journal table - run `hub migrate`',
          required: true,
        }
      }
      const count = db.prepare(`SELECT count(*) AS n FROM __drizzle_migrations`).get() as {
        n: number
      }
      return { name: 'db migrations', status: 'ok', detail: `${count.n} applied`, required: true }
    } finally {
      db.close()
    }
  } catch (err) {
    return {
      name: 'db migrations',
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
      required: true,
    }
  }
}

async function checkOllama(baseUrl: string): Promise<CheckResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1500)
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: ctrl.signal })
    if (!res.ok) {
      return {
        name: 'ollama',
        status: 'fail',
        detail: `${baseUrl} -> HTTP ${res.status}`,
        required: false,
      }
    }
    const body = (await res.json()) as { models?: Array<{ name: string }> }
    const n = body.models?.length ?? 0
    return { name: 'ollama', status: 'ok', detail: `${baseUrl} (${n} models)`, required: false }
  } catch (err) {
    return {
      name: 'ollama',
      status: 'fail',
      detail: `${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      required: false,
    }
  } finally {
    clearTimeout(t)
  }
}

function optionalEnvCheck(label: string, value: string | undefined): CheckResult {
  return value
    ? { name: label, status: 'ok', detail: 'configured', required: false }
    : { name: label, status: 'skip', detail: 'not configured', required: false }
}

function checkGitAvailable(): CheckResult {
  try {
    const out = execSync('git --version', { stdio: 'pipe' }).toString().trim()
    return { name: 'git binary', status: 'ok', detail: out, required: false }
  } catch {
    return {
      name: 'git binary',
      status: 'fail',
      detail: 'not found on PATH — required for hub prompt sync',
      required: false,
    }
  }
}

async function checkRegistryReachable(url: string, token?: string): Promise<CheckResult> {
  const authUrl = token ? url.replace(/^(https?:\/\/)/, `$1oauth2:${token}@`) : url
  const displayUrl = url
  try {
    execSync(`git ls-remote --heads "${authUrl}"`, { stdio: 'pipe', timeout: 5000 })
    return {
      name: 'registry repo reachable',
      status: 'ok',
      detail: `${displayUrl} (read access verified; push requires repo scope on token)`,
      required: false,
    }
  } catch (err) {
    return {
      name: 'registry repo reachable',
      status: 'fail',
      detail: `${displayUrl}: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`,
      required: false,
    }
  }
}

function symbol(s: CheckStatus): string {
  if (s === 'ok') return kleur.green('OK')
  if (s === 'fail') return kleur.red('FAIL')
  return kleur.gray('--')
}

export async function runDoctor(): Promise<{ results: CheckResult[]; ok: boolean }> {
  const results: CheckResult[] = []
  results.push(checkNode())
  results.push(checkSqliteBuiltin())
  const { result: envResult, env } = checkEnv()
  results.push(envResult)

  if (env) {
    results.push(checkPathWritable('log dir', env.HUB_LOG_DIR, true))
    results.push(checkDbFileWritable(env.HUB_DB_PATH))
    results.push(checkMigrations(env.HUB_DB_PATH))
    results.push(await checkOllama(env.OLLAMA_BASE_URL))
    results.push(optionalEnvCheck('notion token', env.NOTION_TOKEN))
    results.push(optionalEnvCheck('obsidian api key', env.OBSIDIAN_API_KEY))
    results.push(optionalEnvCheck('todoist token', env.TODOIST_API_TOKEN))
    results.push(optionalEnvCheck('github pat', env.GITHUB_PAT))
    results.push(optionalEnvCheck('hub github token', env.HUB_GITHUB_TOKEN))
    results.push(optionalEnvCheck('prompts repo url', env.HUB_PROMPTS_REPO_URL))
    results.push(optionalEnvCheck('registry repo url', env.HUB_REGISTRY_REPO_URL))
    results.push(checkGitAvailable())
    results.push(optionalEnvCheck('git author name', env.HUB_GIT_AUTHOR_NAME))
    results.push(optionalEnvCheck('git author email', env.HUB_GIT_AUTHOR_EMAIL))
    if (env.HUB_REGISTRY_REPO_URL) {
      results.push(await checkRegistryReachable(env.HUB_REGISTRY_REPO_URL, env.HUB_GITHUB_TOKEN))
    }
  }

  const ok = results.every((r) => !(r.required && r.status === 'fail'))
  return { results, ok }
}

export function printDoctorReport(results: CheckResult[], ok: boolean): void {
  console.log(kleur.bold('hub doctor'))
  for (const r of results) {
    const tag = r.required ? '' : kleur.gray(' (optional)')
    const detail = r.detail ? kleur.gray(`  ${r.detail}`) : ''
    console.log(`  ${symbol(r.status)} ${r.name}${tag}${detail}`)
  }
  console.log()
  console.log(
    ok
      ? kleur.green('all required checks passed')
      : kleur.red('one or more required checks failed'),
  )
}
