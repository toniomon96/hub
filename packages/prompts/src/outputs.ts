import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { loadEnv, getLogger, publishNtfy } from '@hub/shared'
import { Octokit } from '@octokit/rest'
import {
  ObsidianOutputConfig,
  GithubIssueOutputConfig,
  GithubPrCommentOutputConfig,
  NtfyOnOutputConfig,
} from './schema.js'

const log = getLogger('prompt-outputs')

export interface OutputContext {
  repo: string
  promptId: string
  runId: string
  args: Record<string, unknown>
  date?: string
}

/**
 * Dispatch all output handlers declared in a prompt's output_config.
 * Handlers run concurrently; individual failures are logged but do not
 * abort remaining handlers.
 */
export async function handleOutputs(
  config: Record<string, unknown>,
  output: string,
  ctx: OutputContext,
): Promise<void> {
  const handlers: Promise<void>[] = []

  if (config['obsidian']) {
    const parsed = ObsidianOutputConfig.safeParse(config['obsidian'])
    if (parsed.success) {
      handlers.push(handleObsidian(parsed.data, output, ctx))
    } else {
      log.warn({ runId: ctx.runId, error: parsed.error.message }, 'invalid obsidian output config')
    }
  }

  if (config['github_issue']) {
    const parsed = GithubIssueOutputConfig.safeParse(config['github_issue'])
    if (parsed.success) {
      handlers.push(handleGithubIssue(parsed.data, output, ctx))
    } else {
      log.warn(
        { runId: ctx.runId, error: parsed.error.message },
        'invalid github_issue output config',
      )
    }
  }

  if (config['github_pr_comment']) {
    const parsed = GithubPrCommentOutputConfig.safeParse(config['github_pr_comment'])
    if (parsed.success) {
      handlers.push(handleGithubPrComment(parsed.data, output, ctx))
    } else {
      log.warn(
        { runId: ctx.runId, error: parsed.error.message },
        'invalid github_pr_comment output config',
      )
    }
  }

  if (config['ntfy_on']) {
    const parsed = NtfyOnOutputConfig.safeParse(config['ntfy_on'])
    if (parsed.success) {
      handlers.push(handleNtfy(parsed.data, output, ctx))
    } else {
      log.warn({ runId: ctx.runId, error: parsed.error.message }, 'invalid ntfy_on output config')
    }
  }

  const results = await Promise.allSettled(handlers)
  for (const r of results) {
    if (r.status === 'rejected') {
      log.error({ runId: ctx.runId, err: String(r.reason) }, 'output handler failed')
    }
  }
}

async function handleObsidian(
  cfg: { path_template: string },
  output: string,
  ctx: OutputContext,
): Promise<void> {
  const env = loadEnv()
  if (!env.OBSIDIAN_VAULT_PATH) {
    log.warn({ runId: ctx.runId }, 'obsidian output skipped: OBSIDIAN_VAULT_PATH not set')
    return
  }
  const date = ctx.date ?? new Date().toISOString().slice(0, 10)
  const rendered = renderTemplate(cfg.path_template, {
    repo: ctx.repo,
    date,
    ...ctx.args,
  })
  const filePath = join(env.OBSIDIAN_VAULT_PATH, rendered)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, output, 'utf8')
  log.info({ path: filePath, runId: ctx.runId }, 'obsidian output written')
}

async function handleGithubIssue(
  cfg: { title: string; labels?: string[] | undefined },
  output: string,
  ctx: OutputContext,
): Promise<void> {
  const env = loadEnv()
  const token = env.HUB_GITHUB_TOKEN ?? env.GITHUB_PAT
  if (!token) {
    log.warn({ runId: ctx.runId }, 'github_issue output skipped: no GitHub token configured')
    return
  }
  const parts = ctx.repo.split('/')
  const owner = parts[0]
  const repoName = parts[1]
  if (!owner || !repoName) {
    throw new Error(`Invalid repo slug "${ctx.repo}" — expected "owner/repo" format`)
  }
  const octokit = new Octokit({ auth: token })
  const issue = await octokit.rest.issues.create({
    owner,
    repo: repoName,
    title: renderTemplate(cfg.title, ctx.args),
    body: output,
    ...(cfg.labels !== undefined ? { labels: cfg.labels } : {}),
  })
  log.info({ runId: ctx.runId, issueUrl: issue.data.html_url }, 'github issue created')
}

async function handleGithubPrComment(
  cfg: { pr_number_arg: string },
  output: string,
  ctx: OutputContext,
): Promise<void> {
  const env = loadEnv()
  const token = env.HUB_GITHUB_TOKEN ?? env.GITHUB_PAT
  if (!token) {
    log.warn({ runId: ctx.runId }, 'github_pr_comment output skipped: no GitHub token configured')
    return
  }
  const prNumber = Number(ctx.args[cfg.pr_number_arg])
  if (!prNumber || !Number.isInteger(prNumber)) {
    throw new Error(`pr_number_arg "${cfg.pr_number_arg}" not provided or not an integer`)
  }
  const parts = ctx.repo.split('/')
  const owner = parts[0]
  const repoName = parts[1]
  if (!owner || !repoName) {
    throw new Error(`Invalid repo slug "${ctx.repo}"`)
  }
  const octokit = new Octokit({ auth: token })
  await octokit.rest.issues.createComment({
    owner,
    repo: repoName,
    issue_number: prNumber,
    body: output,
  })
  log.info({ runId: ctx.runId, prNumber }, 'github pr comment posted')
}

async function handleNtfy(
  cfg: { priority?: number | undefined },
  output: string,
  ctx: OutputContext,
): Promise<void> {
  // Scan for P1/P2/P3 headings: # P1, ## P2, ### P3, etc.
  const headingMatch = output.match(/^#+\s+(P[123])\b/m)
  const priorityMap: Record<string, number> = { P1: 5, P2: 4, P3: 3 }
  const priority =
    (headingMatch?.[1] ? priorityMap[headingMatch[1]] : undefined) ?? cfg.priority ?? 3

  const title = `Prompt ${ctx.promptId} (${ctx.repo})`
  await publishNtfy({
    message: output.slice(0, 4096),
    title,
    priority: priority as 1 | 2 | 3 | 4 | 5,
  })
}

/** Replace {key} placeholders in a template string. */
export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  )
}
