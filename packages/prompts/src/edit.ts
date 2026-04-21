import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import type { Document, YAMLMap, YAMLSeq } from 'yaml'
import { withLease } from '@hub/db'
import { loadEnv, getLogger } from '@hub/shared'
import { shallowClone, buildAuthUrl } from './git.js'
import { RegistryFile } from './schema.js'
import { syncPrompts, type SyncResult } from './sync.js'
import { simpleGit } from 'simple-git'

const log = getLogger('registry-edit')

export type AddTargetOpts = {
  repo: string
  branch?: string | undefined
  sensitivity?: 'low' | 'medium' | 'high' | undefined
  enabled?: boolean | undefined
  dryRun?: boolean | undefined
}

export type WirePromptOpts = {
  repo: string
  promptId: string
  trigger: string
  when?: string | undefined
  args?: Record<string, unknown> | undefined
  enabled?: boolean | undefined
  dryRun?: boolean | undefined
}

export type RemoveOpts = {
  repo: string
  promptId?: string | undefined
  trigger?: string | undefined
  dryRun?: boolean | undefined
}

export type EditResult = {
  diff: string
  committed: boolean
  commitSha?: string
  pushedTo?: string
  syncSummary?: SyncResult
}

/** Add (or update repo-level fields for) a repo block in targets.yml. */
export async function addTarget(opts: AddTargetOpts): Promise<EditResult> {
  const commitMsg = `registry: add ${opts.repo}`
  return applyEdit(
    (doc) => {
      const blocks = doc.get('targets') as YAMLSeq
      const idx = blocks.items.findIndex((b) => (b as YAMLMap).get('repo') === opts.repo)
      if (idx >= 0) {
        const block = blocks.items[idx] as YAMLMap
        let changed = false
        if (opts.branch !== undefined && block.get('branch') !== opts.branch) {
          block.set('branch', opts.branch)
          changed = true
        }
        if (opts.sensitivity !== undefined && block.get('sensitivity') !== opts.sensitivity) {
          block.set('sensitivity', opts.sensitivity)
          changed = true
        }
        if (opts.enabled !== undefined && block.get('enabled') !== opts.enabled) {
          block.set('enabled', opts.enabled)
          changed = true
        }
        return changed
      } else {
        const newBlock: Record<string, unknown> = { repo: opts.repo, targets: [] }
        if (opts.branch !== undefined) newBlock['branch'] = opts.branch
        if (opts.sensitivity !== undefined) newBlock['sensitivity'] = opts.sensitivity
        if (opts.enabled !== undefined) newBlock['enabled'] = opts.enabled
        blocks.add(doc.createNode(newBlock))
        return true
      }
    },
    commitMsg,
    opts.dryRun ?? false,
  )
}

/** Wire (upsert) a prompt binding to a repo in targets.yml. */
export async function wirePrompt(opts: WirePromptOpts): Promise<EditResult> {
  const commitMsg = `registry: wire ${opts.promptId} → ${opts.repo} (${opts.trigger})`
  return applyEdit(
    (doc) => {
      const blocks = doc.get('targets') as YAMLSeq
      const blockIdx = blocks.items.findIndex((b) => (b as YAMLMap).get('repo') === opts.repo)
      if (blockIdx < 0) {
        throw new Error(
          `repo "${opts.repo}" not in registry — run 'hub registry add ${opts.repo}' first`,
        )
      }
      const block = blocks.items[blockIdx] as YAMLMap
      let inner = block.get('targets') as YAMLSeq | undefined
      if (!inner) {
        inner = doc.createNode([]) as YAMLSeq
        block.set('targets', inner)
      }
      const existingIdx = inner.items.findIndex((t) => {
        const m = t as YAMLMap
        return m.get('prompt_id') === opts.promptId && m.get('trigger') === opts.trigger
      })
      const entry: Record<string, unknown> = {
        prompt_id: opts.promptId,
        trigger: opts.trigger,
      }
      if (opts.when !== undefined) entry['when_expr'] = opts.when
      if (opts.args !== undefined) entry['args'] = opts.args
      if (opts.enabled !== undefined) entry['enabled'] = opts.enabled
      if (existingIdx >= 0) {
        // Check if existing entry is identical to avoid spurious commits
        const existing = inner.items[existingIdx] as YAMLMap
        const existingJson = JSON.stringify(existing.toJSON())
        const entryJson = JSON.stringify(entry)
        if (existingJson === entryJson) return false
        inner.items[existingIdx] = doc.createNode(entry)
      } else {
        inner.add(doc.createNode(entry))
      }
      return true
    },
    commitMsg,
    opts.dryRun ?? false,
  )
}

/** Remove a repo block or a specific prompt binding from targets.yml. */
export async function removeEntry(opts: RemoveOpts): Promise<EditResult> {
  const commitMsg = opts.promptId
    ? `registry: remove ${opts.promptId} from ${opts.repo}`
    : `registry: remove ${opts.repo}`
  return applyEdit(
    (doc) => {
      const blocks = doc.get('targets') as YAMLSeq
      const blockIdx = blocks.items.findIndex((b) => (b as YAMLMap).get('repo') === opts.repo)
      if (blockIdx < 0) return false // no-op: repo not found
      if (!opts.promptId) {
        blocks.items.splice(blockIdx, 1)
        return true
      }
      const block = blocks.items[blockIdx] as YAMLMap
      const inner = block.get('targets') as YAMLSeq | undefined
      if (!inner) return false // no-op: no targets array
      const before = inner.items.length
      inner.items = inner.items.filter((t) => {
        const m = t as YAMLMap
        const matchPrompt = m.get('prompt_id') === opts.promptId
        const matchTrigger = opts.trigger ? m.get('trigger') === opts.trigger : true
        return !(matchPrompt && matchTrigger)
      })
      return inner.items.length !== before
    },
    commitMsg,
    opts.dryRun ?? false,
  )
}

/**
 * Shared scaffold for all registry mutations.
 * Dry-run path: clone → mutate → diff → return (no commit, no lease).
 * Write path: acquire lease → clone → mutate → validate → diff → commit → push → sync.
 */
async function applyEdit(
  mutate: (doc: Document) => boolean,
  commitMsg: string,
  dryRun: boolean,
): Promise<EditResult> {
  const env = loadEnv()
  const registryUrl = env.HUB_REGISTRY_REPO_URL
  if (!registryUrl) {
    throw new Error('HUB_REGISTRY_REPO_URL is not configured')
  }
  const token = env.HUB_GITHUB_TOKEN
  const authorName = env.HUB_GIT_AUTHOR_NAME
  const authorEmail = env.HUB_GIT_AUTHOR_EMAIL
  const authUrl = token ? buildAuthUrl(registryUrl, token) : registryUrl

  if (dryRun) {
    return runMutation(authUrl, registryUrl, authorName, authorEmail, mutate, commitMsg, true)
  }

  const leaseResult = await withLease('registry:edit', () =>
    runMutation(authUrl, registryUrl, authorName, authorEmail, mutate, commitMsg, false),
  )
  if (leaseResult === null) {
    throw new Error('registry is being edited by another process — try again shortly')
  }
  return leaseResult
}

async function runMutation(
  authUrl: string,
  registryUrl: string,
  authorName: string,
  authorEmail: string,
  mutate: (doc: Document) => boolean,
  commitMsg: string,
  dryRun: boolean,
): Promise<EditResult> {
  let dir: string | undefined
  try {
    const cloneResult = await shallowClone(authUrl, 'main')
    dir = cloneResult.dir

    const targetsPath = join(dir, 'targets.yml')
    const originalContent = readFileSync(targetsPath, 'utf8')
    const doc = YAML.parseDocument(originalContent)

    const changed = mutate(doc)

    // Idempotent no-op — skip write/commit entirely
    if (!changed) {
      return { diff: '', committed: false }
    }

    const newContent = doc.toString()

    // Validate mutated document before any write
    const parsed = YAML.parse(newContent) as unknown
    const validation = RegistryFile.safeParse(parsed)
    if (!validation.success) {
      throw new Error(`Registry validation failed: ${validation.error.message}`)
    }

    writeFileSync(targetsPath, newContent, 'utf8')

    const repoGit = simpleGit(dir)
    const diff = await repoGit.diff(['targets.yml'])

    if (dryRun) {
      return { diff, committed: false }
    }

    await repoGit.addConfig('user.name', authorName)
    await repoGit.addConfig('user.email', authorEmail)
    await repoGit.add('targets.yml')
    await repoGit.commit(commitMsg)
    await repoGit.push('origin', 'main')
    const commitSha = (await repoGit.revparse(['HEAD'])).trim()

    log.info({ commitSha, commitMsg }, 'registry commit pushed')

    // Auto-sync in-process so DB reflects the change immediately
    let syncSummary: SyncResult | undefined
    try {
      syncSummary = await syncPrompts({ registryRepoUrl: registryUrl })
    } catch (err) {
      log.warn({ err: String(err) }, 'auto-sync after registry edit failed — push succeeded')
    }

    return {
      diff,
      committed: true,
      commitSha,
      pushedTo: 'main',
      ...(syncSummary !== undefined ? { syncSummary } : {}),
    }
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}
