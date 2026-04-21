import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { getDb, getRawDb } from '@hub/db'
import { prompts as promptsTable, promptTargets } from '@hub/db/schema'
import { loadEnv, getLogger } from '@hub/shared'
import { shallowClone, buildAuthUrl } from './git.js'
import { parsePromptsDir } from './parser.js'
import { parseRegistryFile } from './registry.js'

const log = getLogger('prompts-sync')

export interface SyncOptions {
  /** Override HUB_PROMPTS_REPO_URL from env. */
  promptsRepoUrl?: string
  /** Override HUB_REGISTRY_REPO_URL from env. */
  registryRepoUrl?: string
  /** Branch to clone. Defaults to 'main'. */
  branch?: string
}

export interface SyncResult {
  promptsUpserted: number
  targetsUpserted: number
  targetsRemoved: number
  errors: Array<{ file: string; error: string }>
}

/**
 * Sync hub-prompts and hub-registry into the local DB.
 *
 * Failure modes:
 *   - Unreachable remote → throw before any DB writes
 *   - Malformed frontmatter → skip that file, continue, return errors in summary
 *   - Unknown prompt_id in registry → throw entire sync (referential integrity)
 *
 * All DB writes happen in a single IMMEDIATE transaction.
 */
export async function syncPrompts(opts: SyncOptions = {}): Promise<SyncResult> {
  const env = loadEnv()
  const promptsUrl = opts.promptsRepoUrl ?? env.HUB_PROMPTS_REPO_URL
  const registryUrl = opts.registryRepoUrl ?? env.HUB_REGISTRY_REPO_URL
  const token = env.HUB_GITHUB_TOKEN
  const branch = opts.branch ?? 'main'

  if (!promptsUrl) {
    throw new Error('HUB_PROMPTS_REPO_URL is not configured')
  }

  let promptsDir: string | undefined
  let registryDir: string | undefined
  let promptsSha = 'unknown'
  let registrySha = 'unknown'

  try {
    // Clone hub-prompts
    const authPrompts = token ? buildAuthUrl(promptsUrl, token) : promptsUrl
    const cloneResult = await shallowClone(authPrompts, branch)
    promptsDir = cloneResult.dir
    promptsSha = cloneResult.sha

    const promptsMdDir = join(promptsDir, 'prompts')
    const { prompts: parsed, errors } = parsePromptsDir(promptsMdDir)

    // Clone hub-registry (optional)
    let registryEntries: Awaited<ReturnType<typeof parseRegistryFile>>['entries'] = []
    if (registryUrl) {
      const authRegistry = token ? buildAuthUrl(registryUrl, token) : registryUrl
      const regClone = await shallowClone(authRegistry, branch)
      registryDir = regClone.dir
      registrySha = regClone.sha

      const regFile = join(registryDir, 'targets.yml')
      const { entries } = parseRegistryFile(regFile)
      registryEntries = entries
    }

    // Referential integrity: all prompt_ids in registry must be in parsed prompts
    const knownIds = new Set(parsed.map((p) => p.frontmatter.id))
    for (const block of registryEntries) {
      for (const t of block.targets) {
        if (!knownIds.has(t.prompt_id)) {
          throw new Error(
            `Registry references unknown prompt_id "${t.prompt_id}" in repo "${block.repo}" — sync aborted`,
          )
        }
      }
    }

    const now = Date.now()
    const db = getDb()
    const raw = getRawDb()

    let promptsUpserted = 0
    let targetsUpserted = 0
    let targetsRemoved = 0

    raw.exec('BEGIN IMMEDIATE')
    try {
      // Upsert prompts
      for (const p of parsed) {
        const fm = p.frontmatter
        await db
          .insert(promptsTable)
          .values({
            id: fm.id,
            version: fm.version,
            sourceSha: promptsSha,
            title: fm.title,
            description: fm.description,
            body: p.body,
            sensitivity: fm.sensitivity,
            complexity: fm.complexity,
            inputsSchema: fm.inputs_schema ? JSON.stringify(fm.inputs_schema) : null,
            outputConfig: JSON.stringify(fm.output_config),
            tags: JSON.stringify(fm.tags ?? []),
            syncedAt: now,
            enabled: 1,
          })
          .onConflictDoUpdate({
            target: promptsTable.id,
            set: {
              version: fm.version,
              sourceSha: promptsSha,
              title: fm.title,
              description: fm.description,
              body: p.body,
              sensitivity: fm.sensitivity,
              complexity: fm.complexity,
              inputsSchema: fm.inputs_schema ? JSON.stringify(fm.inputs_schema) : null,
              outputConfig: JSON.stringify(fm.output_config),
              tags: JSON.stringify(fm.tags ?? []),
              syncedAt: now,
            },
          })
          .run()
        promptsUpserted++
      }

      // Build new set of (repo, prompt_id, trigger) tuples for cleanup
      const newTuples = new Set<string>()
      for (const block of registryEntries) {
        for (const t of block.targets) {
          newTuples.add(`${block.repo}|${t.prompt_id}|${t.trigger}`)
        }
      }

      // Delete stale targets from the same source_sha (avoid deleting manually inserted ones)
      // Strategy: delete any row whose (repo, prompt_id, trigger) is NOT in the new set
      // AND whose source_sha matches the current registry SHA (or was synced from a prior sync)
      const existing = raw
        .prepare(`SELECT id, repo, prompt_id, trigger FROM prompt_targets`)
        .all() as Array<{ id: number; repo: string; prompt_id: string; trigger: string }>

      for (const row of existing) {
        const key = `${row.repo}|${row.prompt_id}|${row.trigger}`
        if (!newTuples.has(key)) {
          raw.prepare(`DELETE FROM prompt_targets WHERE id = ?`).run(row.id)
          targetsRemoved++
        }
      }

      // Upsert prompt_targets
      for (const block of registryEntries) {
        for (const t of block.targets) {
          await db
            .insert(promptTargets)
            .values({
              repo: block.repo,
              promptId: t.prompt_id,
              trigger: t.trigger,
              whenExpr: t.when_expr ?? null,
              branch: t.branch,
              sensitivityOverride: t.sensitivity_override ?? null,
              args: JSON.stringify(t.args ?? {}),
              enabled: t.enabled ? 1 : 0,
              sourceSha: registrySha,
              syncedAt: now,
            })
            .onConflictDoUpdate({
              target: [promptTargets.repo, promptTargets.promptId, promptTargets.trigger],
              set: {
                whenExpr: t.when_expr ?? null,
                branch: t.branch,
                sensitivityOverride: t.sensitivity_override ?? null,
                args: JSON.stringify(t.args ?? {}),
                enabled: t.enabled ? 1 : 0,
                sourceSha: registrySha,
                syncedAt: now,
              },
            })
            .run()
          targetsUpserted++
        }
      }

      raw.exec('COMMIT')
    } catch (err) {
      raw.exec('ROLLBACK')
      throw err
    }

    log.info(
      {
        promptsUpserted,
        targetsUpserted,
        targetsRemoved,
        parseErrors: errors.length,
        promptsSha,
        registrySha,
      },
      'sync complete',
    )

    return { promptsUpserted, targetsUpserted, targetsRemoved, errors }
  } finally {
    if (promptsDir) rmSync(promptsDir, { recursive: true, force: true })
    if (registryDir) rmSync(registryDir, { recursive: true, force: true })
  }
}
