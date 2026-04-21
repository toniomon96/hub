import { simpleGit } from 'simple-git'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLogger } from '@hub/shared'

const log = getLogger('prompts-git')

export interface CloneResult {
  dir: string
  sha: string
}

/**
 * Shallow-clone a remote URL into a fresh temp directory.
 *
 * For private repos, embed the GitHub token in the URL before calling:
 *   `buildAuthUrl(repoUrl, token)` → https://oauth2:{token}@github.com/...
 *
 * The caller is responsible for cleaning up `dir` after use.
 * Throws on network or auth errors — never leaves a partial clone.
 */
export async function shallowClone(url: string, branch = 'main'): Promise<CloneResult> {
  const dir = mkdtempSync(join(tmpdir(), 'hub-clone-'))
  log.info({ url: redactUrl(url), branch, dir }, 'shallow clone start')

  const git = simpleGit()
  try {
    await git.clone(url, dir, ['--depth', '1', '--branch', branch, '--single-branch'])
  } catch (err) {
    throw new Error(
      `git clone failed (${redactUrl(url)}): ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Get HEAD SHA for source_sha tracking
  const repoGit = simpleGit(dir)
  const sha = (await repoGit.revparse(['HEAD'])).trim()
  log.info({ url: redactUrl(url), sha }, 'shallow clone done')
  return { dir, sha }
}

/** Inject `oauth2:{token}@` after the protocol for HTTPS clone auth. */
export function buildAuthUrl(repoUrl: string, token: string): string {
  return repoUrl.replace(/^(https?:\/\/)/, `$1oauth2:${token}@`)
}

/** Strip token from URL before logging. */
function redactUrl(url: string): string {
  return url.replace(/oauth2:[^@]+@/, 'oauth2:[REDACTED]@')
}
