import { existsSync } from 'node:fs'
import { access, stat, readdir } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { loadEnv, getLogger } from '@hub/shared'
import { getRawDb } from '@hub/db'

const log = getLogger('health')

export interface HealthCheck {
  name: string
  ok: boolean
  detail?: string
  latencyMs?: number
}

export interface HealthReport {
  ok: boolean
  service: 'hub'
  version: string
  timestamp: string
  checks: HealthCheck[]
}

/**
 * /healthz deep-check. Returns 200 if everything critical is up, 503 if any
 * check fails. Cheap enough to poll every 30s.
 *
 *   - db:     SELECT 1 round-trip (fails if SQLite is locked or gone)
 *   - ollama: GET /api/tags (skipped if OLLAMA_BASE_URL unreachable — soft check)
 *   - vault:  fs.access W_OK on OBSIDIAN_VAULT_PATH (skipped if unset)
 *   - backup: mtime of latest backup < 26h (skipped if no backup dir configured)
 */
export async function runHealthCheck(): Promise<HealthReport> {
  const checks: HealthCheck[] = []
  const env = loadEnv()

  checks.push(await checkDb())
  checks.push(await checkOllama(env.OLLAMA_BASE_URL))
  checks.push(await checkVault(env.OBSIDIAN_VAULT_PATH))
  checks.push(await checkBackup(env.HUB_BACKUP_DIR, env.HUB_BACKUP_MAX_AGE_H))

  // Only "critical" checks gate ok=false. Ollama + vault + backup are soft —
  // they return ok=true when not configured, and ok=false only when
  // configured-but-broken.
  const ok = checks.every((c) => c.ok)

  return {
    ok,
    service: 'hub',
    version: '0.3.0',
    timestamp: new Date().toISOString(),
    checks,
  }
}

async function checkDb(): Promise<HealthCheck> {
  const t0 = Date.now()
  try {
    // Use the raw node:sqlite handle directly — drizzle's proxy get() isn't
    // ergonomic for a literal SELECT and we don't want to go through the
    // async promise layer for a pure liveness probe.
    const row = getRawDb().prepare('SELECT 1 as one').get() as { one: number } | undefined
    if (!row || row.one !== 1) {
      return { name: 'db', ok: false, detail: 'unexpected result', latencyMs: Date.now() - t0 }
    }
    return { name: 'db', ok: true, latencyMs: Date.now() - t0 }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    return { name: 'db', ok: false, detail: m, latencyMs: Date.now() - t0 }
  }
}

async function checkOllama(baseUrl: string): Promise<HealthCheck> {
  const t0 = Date.now()
  const url = `${baseUrl.replace(/\/$/, '')}/api/tags`
  try {
    // AbortController for a fast fail if Ollama is down; we don't want
    // /healthz to block for 30s on a hung connection.
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 2000)
    const res = await fetch(url, { signal: ctl.signal })
    clearTimeout(timer)
    if (!res.ok) {
      return {
        name: 'ollama',
        ok: false,
        detail: `http ${res.status}`,
        latencyMs: Date.now() - t0,
      }
    }
    return { name: 'ollama', ok: true, latencyMs: Date.now() - t0 }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    // Soft check: if Ollama isn't running we still return ok=false so the
    // report shows the real state; systemd health decides what to do.
    return { name: 'ollama', ok: false, detail: m, latencyMs: Date.now() - t0 }
  }
}

async function checkVault(vaultPath: string | undefined): Promise<HealthCheck> {
  if (!vaultPath) {
    return { name: 'vault', ok: true, detail: 'not configured' }
  }
  const t0 = Date.now()
  try {
    if (!existsSync(vaultPath)) {
      return {
        name: 'vault',
        ok: false,
        detail: `path does not exist: ${vaultPath}`,
        latencyMs: Date.now() - t0,
      }
    }
    await access(vaultPath, fsConstants.W_OK)
    return { name: 'vault', ok: true, latencyMs: Date.now() - t0 }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    return { name: 'vault', ok: false, detail: m, latencyMs: Date.now() - t0 }
  }
}

async function checkBackup(
  backupDir: string | undefined,
  maxAgeHours: number,
): Promise<HealthCheck> {
  if (!backupDir) {
    return { name: 'backup', ok: true, detail: 'not configured' }
  }
  try {
    if (!existsSync(backupDir)) {
      return {
        name: 'backup',
        ok: false,
        detail: `backup dir does not exist: ${backupDir}`,
      }
    }
    // Look for the newest *.db file in the backup dir.
    const entries = await readdir(backupDir)
    const dbFiles = entries.filter((e) => e.endsWith('.db') || e.endsWith('.db.gz'))
    if (dbFiles.length === 0) {
      return { name: 'backup', ok: false, detail: 'no backups found' }
    }
    let newest = 0
    for (const f of dbFiles) {
      try {
        const s = await stat(`${backupDir}/${f}`)
        if (s.mtimeMs > newest) newest = s.mtimeMs
      } catch {
        // ignore
      }
    }
    const ageH = (Date.now() - newest) / 3_600_000
    if (ageH > maxAgeHours) {
      return {
        name: 'backup',
        ok: false,
        detail: `latest backup is ${ageH.toFixed(1)}h old (> ${maxAgeHours}h threshold)`,
      }
    }
    return { name: 'backup', ok: true, detail: `latest ${ageH.toFixed(1)}h ago` }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    log.warn({ err: m }, 'backup check failed')
    return { name: 'backup', ok: false, detail: m }
  }
}
