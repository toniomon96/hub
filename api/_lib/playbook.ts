import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type SourceAdapter = 'local' | 'github'

export interface ConsoleChecklistItem {
  text: string
  checked: boolean
  priority: boolean
  children: string[]
}

export interface LegacyOutreachRow {
  date: string
  name: string
  channel: string
  ask: string
  status: string
  notes: string
}

export interface ConsoleRepoManifest {
  folder: string
  repo_id: string | null
  display_name: string | null
  repo_type: string | null
  owner: string | null
  sensitivity_tier: number | null
  status: string | null
  domains: string[]
  allowed_context_consumers: string[]
  artifact_roots: string[]
  source_of_truth_files: string[]
  validation_errors: string[]
}

export interface PlaybookSource {
  adapter: SourceAdapter
  playbookRoot: string | null
  generatedAt: string
  warnings: string[]
}

export interface PlaybookDashboardBase {
  source: PlaybookSource
  weekly: {
    weekOf: string | null
    items: ConsoleChecklistItem[]
    emptyMessage: string
    sourcePath: string
  }
  legacyOutreach: {
    rows: LegacyOutreachRow[]
    sentThisWeek: number
    target: number
    emptyMessage: string
    sourcePath: string
  }
  pipeline: {
    activeEngagements: number
    pipelineFiles: number
    emptyMessage: string
    sourcePath: string
  }
  proofArtifacts: {
    repos: ConsoleRepoManifest[]
    emptyMessage: string
  }
  roadmap: {
    currentPhase: string
    principle: string | null
    nextAction: string
    notToBuild: string[]
  }
}

export interface PlaybookRoadmapData {
  source: PlaybookSource & { sourcePath: string }
  title: string
  principle: string | null
  currentPhase: string
  phases: Array<{ title: string; body: string }>
  notToBuild: string[]
  cashFlow: Array<{ period: string; expectedRevenue: string }>
}

interface DataSource {
  adapter: SourceAdapter
  playbookRoot: string | null
  readText(relativePath: string): Promise<string | null>
  listFiles(relativePath: string): Promise<string[]>
  listRepoManifests(): Promise<Array<{ folder: string; body: string | null; error: string | null }>>
}

interface ParsedRoadmap {
  title: string
  principle: string | null
  currentPhase: string
  phases: Array<{ title: string; body: string }>
  notToBuild: string[]
  cashFlow: Array<{ period: string; expectedRevenue: string }>
}

const REQUIRED_MANIFEST_FIELDS = [
  'repo_id',
  'display_name',
  'repo_type',
  'owner',
  'client_id',
  'engagement_id',
  'sensitivity_tier',
  'domains',
  'allowed_context_consumers',
  'artifact_roots',
  'source_of_truth_files',
  'status',
  'created_at',
  'last_verified_at',
]

const PORTFOLIO_REPOS = [
  'consulting',
  'engineering-playbook',
  'hub',
  'hub-prompts',
  'hub-registry',
  'fitness-app',
  'FamilyTrips',
  'demario-pickleball-1',
  'dse-content',
]

export async function loadPlaybookDashboardBase(): Promise<PlaybookDashboardBase> {
  const source = createDataSource()
  const warnings: string[] = []

  const [weeklyText, outreachText, roadmapText, pipelineFiles, engagementFiles, manifests] =
    await Promise.all([
      readRequired(source, 'log/weekly.md', warnings),
      readRequired(source, 'log/outreach.md', warnings),
      readRequired(source, '90_DAY_EXECUTION_ROADMAP_v2.md', warnings),
      source.listFiles('pipeline'),
      source.listFiles('engagements'),
      loadRepoManifests(source, warnings),
    ])

  const weekly = weeklyText ? parseWeeklyLog(weeklyText) : { weekOf: null, items: [] }
  const legacyOutreachRows = outreachText ? parseOutreachLog(outreachText) : []
  const roadmap = roadmapText ? parseRoadmap(roadmapText) : emptyRoadmap()
  const pipelineMdFiles = pipelineFiles.filter((file) => file.endsWith('.md')).length
  const activeEngagements = engagementFiles.filter((file) => file.endsWith('.md')).length

  warnings.push(
    ...manifests.flatMap((repo) =>
      repo.validation_errors.map((error) => `${repo.folder}: ${error}`),
    ),
  )

  return {
    source: {
      adapter: source.adapter,
      playbookRoot: source.playbookRoot,
      generatedAt: new Date().toISOString(),
      warnings,
    },
    weekly: {
      weekOf: weekly.weekOf,
      items: weekly.items,
      emptyMessage: 'no weekly checklist yet - add this week in log/weekly.md',
      sourcePath: 'log/weekly.md',
    },
    legacyOutreach: {
      rows: legacyOutreachRows,
      sentThisWeek: countLegacyRowsThisWeek(legacyOutreachRows, weekly.weekOf),
      target: 3,
      emptyMessage: 'no outreach logged yet - send the three referral DMs',
      sourcePath: 'log/outreach.md',
    },
    pipeline: {
      activeEngagements,
      pipelineFiles: pipelineMdFiles,
      emptyMessage: 'no inbound yet - send the dms',
      sourcePath: 'pipeline/',
    },
    proofArtifacts: {
      repos: manifests,
      emptyMessage: 'no repo manifests found - add .repo.yml before indexing anything',
    },
    roadmap: {
      currentPhase: roadmap.currentPhase,
      principle: roadmap.principle,
      nextAction: 'Send three referral DMs and verify /start routes to toni@tonimontez.co.',
      notToBuild: roadmap.notToBuild,
    },
  }
}

export async function loadPlaybookRoadmap(): Promise<PlaybookRoadmapData> {
  const source = createDataSource()
  const warnings: string[] = []
  const roadmapText = await readRequired(source, '90_DAY_EXECUTION_ROADMAP_v2.md', warnings)
  const roadmap = roadmapText ? parseRoadmap(roadmapText) : emptyRoadmap()

  return {
    source: {
      adapter: source.adapter,
      playbookRoot: source.playbookRoot,
      generatedAt: new Date().toISOString(),
      warnings,
      sourcePath: '90_DAY_EXECUTION_ROADMAP_v2.md',
    },
    title: roadmap.title,
    principle: roadmap.principle,
    currentPhase: roadmap.currentPhase,
    phases: roadmap.phases,
    notToBuild: roadmap.notToBuild,
    cashFlow: roadmap.cashFlow,
  }
}

export function parseRepoManifest(folder: string, body: string | null): ConsoleRepoManifest {
  if (!body) return emptyManifest(folder, ['.repo.yml missing or unreadable'])

  const parsed = parseYamlish(body)
  const errors: string[] = []

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) {
      errors.push(`missing required field: ${field}`)
    }
  }

  const sensitivity = parsed['sensitivity_tier']
  if (
    Object.prototype.hasOwnProperty.call(parsed, 'sensitivity_tier') &&
    typeof sensitivity !== 'number'
  ) {
    errors.push('sensitivity_tier must be a number')
  }

  for (const listField of [
    'domains',
    'allowed_context_consumers',
    'artifact_roots',
    'source_of_truth_files',
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(parsed, listField) &&
      !Array.isArray(parsed[listField])
    ) {
      errors.push(`${listField} must be a list`)
    }
  }

  return {
    folder,
    repo_id: asStringOrNull(parsed['repo_id']),
    display_name: asStringOrNull(parsed['display_name']),
    repo_type: asStringOrNull(parsed['repo_type']),
    owner: asStringOrNull(parsed['owner']),
    sensitivity_tier: typeof sensitivity === 'number' ? sensitivity : null,
    status: asStringOrNull(parsed['status']),
    domains: asStringList(parsed['domains']),
    allowed_context_consumers: asStringList(parsed['allowed_context_consumers']),
    artifact_roots: asStringList(parsed['artifact_roots']),
    source_of_truth_files: asStringList(parsed['source_of_truth_files']),
    validation_errors: errors,
  }
}

export function parseWeeklyLog(body: string): {
  weekOf: string | null
  items: ConsoleChecklistItem[]
} {
  const sections = [...body.matchAll(/^## Week of (\d{4}-\d{2}-\d{2}).*$/gm)]
  if (sections.length === 0) return { weekOf: null, items: [] }

  const today = new Date()
  let selected = sections[0]
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const section of sections) {
    const weekDate = section[1]
    if (!weekDate) continue
    const parsed = new Date(`${weekDate}T00:00:00`)
    const time = parsed.getTime()
    if (parsed <= today && time > selectedTime) {
      selected = section
      selectedTime = time
    }
  }

  const weekOf = selected?.[1] ?? null
  const start = selected?.index ?? 0
  const next = body.slice(start + 1).search(/^## Week of /m)
  const sectionBody = next >= 0 ? body.slice(start, start + 1 + next) : body.slice(start)
  const items: ConsoleChecklistItem[] = []
  let current: ConsoleChecklistItem | null = null

  for (const line of sectionBody.split(/\r?\n/)) {
    const itemMatch = line.match(/^- \[( |x|X)\] (.+)$/)
    if (itemMatch) {
      const rawText = itemMatch[2] ?? ''
      current = {
        text: stripMarkdown(rawText),
        checked: (itemMatch[1] ?? ' ') !== ' ',
        priority: /\*\*.+\*\*/.test(rawText),
        children: [],
      }
      items.push(current)
      continue
    }

    const childMatch = line.match(/^\s{2,}- (.+)$/)
    if (childMatch && current) current.children.push(stripMarkdown(childMatch[1] ?? ''))
  }

  return { weekOf, items }
}

export function parseOutreachLog(body: string): LegacyOutreachRow[] {
  const rows: LegacyOutreachRow[] = []
  let inComment = false

  for (const line of body.split(/\r?\n/)) {
    if (line.includes('<!--')) inComment = true
    if (!inComment && line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
      const first = cells[0]
      if (
        cells.length >= 6 &&
        first &&
        /^\d{4}-\d{2}-\d{2}$/.test(first) &&
        !cells.every((cell) => /^-+$/.test(cell))
      ) {
        rows.push({
          date: cells[0] ?? '',
          name: cells[1] ?? '',
          channel: cells[2] ?? '',
          ask: cells[3] ?? '',
          status: cells[4] ?? '',
          notes: cells[5] ?? '',
        })
      }
    }
    if (line.includes('-->')) inComment = false
  }

  return rows
}

function parseRoadmap(body: string): ParsedRoadmap {
  const title = body.match(/^#\s+(.+)$/m)?.[1] ?? '90 Day Execution Roadmap'
  const principle =
    body
      .match(/\*\*Principle:\s*(.+?)\*\*/s)?.[1]
      ?.replace(/\s+/g, ' ')
      .trim() ?? null
  const phases = parseHeadingSections(body)
  const notToBuild = parseBulletsUnderMatchingHeading(body, (heading) =>
    heading.toLowerCase().includes('what not to build'),
  )
  const cashFlow = parseCashFlow(body)
  const configuredPhase = process.env['CONSOLE_CURRENT_PHASE']?.trim()
  const currentPhase =
    configuredPhase ||
    phases.find((phase) => /week\s*3.*first soft outreach/i.test(normalizeDash(phase.title)))
      ?.title ||
    phases[0]?.title ||
    'unknown'

  return { title, principle, currentPhase, phases, notToBuild, cashFlow }
}

function parseHeadingSections(body: string): Array<{ title: string; body: string }> {
  const matches = [...body.matchAll(/^## (.+)$/gm)]
  return matches.map((match, index) => {
    const title = match[1] ?? 'Untitled'
    const start = (match.index ?? 0) + match[0].length
    const next = matches[index + 1]?.index ?? body.length
    return { title, body: body.slice(start, next).trim() }
  })
}

function parseBulletsUnderMatchingHeading(
  body: string,
  predicate: (heading: string) => boolean,
): string[] {
  const sections = parseHeadingSections(body)
  const section = sections.find((candidate) => predicate(candidate.title))
  if (!section) return []
  return section.body
    .split(/\r?\n/)
    .map((line) => line.match(/^- (.+)$/)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(stripMarkdown)
}

function parseCashFlow(body: string): Array<{ period: string; expectedRevenue: string }> {
  const sections = parseHeadingSections(body)
  const section = sections.find((candidate) => candidate.title.toLowerCase().includes('cash flow'))
  if (!section) return []

  const rows: Array<{ period: string; expectedRevenue: string }> = []
  for (const line of section.body.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    const period = cells[0]
    const expectedRevenue = cells[1]
    if (!period || !expectedRevenue || period === 'Period' || /^-+$/.test(period)) continue
    rows.push({ period, expectedRevenue })
  }
  return rows
}

function emptyRoadmap(): ParsedRoadmap {
  return {
    title: '90 Day Execution Roadmap',
    principle: null,
    currentPhase: 'unknown',
    phases: [],
    notToBuild: [],
    cashFlow: [],
  }
}

async function readRequired(
  source: DataSource,
  relativePath: string,
  warnings: string[],
): Promise<string | null> {
  const text = await source.readText(relativePath)
  if (text === null) warnings.push(`${relativePath} missing or unreadable`)
  return text
}

async function loadRepoManifests(
  source: DataSource,
  warnings: string[],
): Promise<ConsoleRepoManifest[]> {
  const entries = await source.listRepoManifests()
  if (entries.length === 0) warnings.push('no .repo.yml manifests found')
  return entries.map((entry) => {
    const manifest = parseRepoManifest(entry.folder, entry.body)
    if (entry.error) manifest.validation_errors.push(entry.error)
    return manifest
  })
}

function createDataSource(): DataSource {
  const adapter = process.env['CONSOLE_SOURCE_ADAPTER'] === 'github' ? 'github' : 'local'
  return adapter === 'github' ? createGithubSource() : createLocalSource()
}

function createLocalSource(): DataSource {
  const playbookRoot = resolvePlaybookRoot()
  const portfolioRoot =
    process.env['CONSOLE_PORTFOLIO_ROOT'] ?? (playbookRoot ? path.dirname(playbookRoot) : null)

  return {
    adapter: 'local',
    playbookRoot,
    async readText(relativePath: string) {
      if (!playbookRoot) return null
      return readFile(path.join(playbookRoot, relativePath), 'utf8').catch(() => null)
    },
    async listFiles(relativePath: string) {
      if (!playbookRoot) return []
      return readdir(path.join(playbookRoot, relativePath)).catch(() => [])
    },
    async listRepoManifests() {
      if (!portfolioRoot) return []
      return Promise.all(
        PORTFOLIO_REPOS.map(async (folder) => {
          const manifestPath = path.join(portfolioRoot, folder, '.repo.yml')
          const body = await readFile(manifestPath, 'utf8').catch(() => null)
          return { folder, body, error: body ? null : '.repo.yml missing or unreadable' }
        }),
      )
    },
  }
}

function createGithubSource(): DataSource {
  const repo = process.env['CONSOLE_PLAYBOOK_REPO'] ?? ''
  const ref = process.env['CONSOLE_PLAYBOOK_REF'] ?? 'main'
  const token =
    process.env['CONSOLE_GITHUB_TOKEN'] ??
    process.env['HUB_GITHUB_TOKEN'] ??
    process.env['GITHUB_PAT'] ??
    ''

  return {
    adapter: 'github',
    playbookRoot: repo || null,
    async readText(relativePath: string) {
      if (!repo || !token) return null
      return fetchGithubText(repo, relativePath, ref, token)
    },
    async listFiles(relativePath: string) {
      if (!repo || !token) return []
      const listing = await fetchGithubJson(repo, relativePath, ref, token)
      if (!Array.isArray(listing)) return []
      return listing
        .map((item) => (isGithubListingItem(item) ? item.name : null))
        .filter((name): name is string => Boolean(name))
    },
    async listRepoManifests() {
      const repoList = (process.env['CONSOLE_PORTFOLIO_REPOS'] ?? repo)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      return Promise.all(
        repoList.map(async (repoName) => {
          const body = token ? await fetchGithubText(repoName, '.repo.yml', ref, token) : null
          return {
            folder: repoName.split('/').pop() ?? repoName,
            body,
            error: body ? null : '.repo.yml missing or unreadable from GitHub',
          }
        }),
      )
    },
  }
}

function resolvePlaybookRoot(): string | null {
  const explicit = process.env['CONSOLE_PLAYBOOK_LOCAL_PATH']
  if (explicit && existsSync(explicit)) return explicit

  const cwd = process.cwd()
  const candidates = [
    path.resolve(cwd, '..', 'engineering-playbook'),
    path.resolve(cwd, '..', '..', 'engineering-playbook'),
    path.resolve(cwd, '..', '..', '..', 'engineering-playbook'),
    path.resolve(cwd, '..', '..', '..', '..', 'engineering-playbook'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

async function fetchGithubText(
  repo: string,
  relativePath: string,
  ref: string,
  token: string,
): Promise<string | null> {
  const payload = await fetchGithubJson(repo, relativePath, ref, token)
  if (!isGithubFile(payload)) return null
  return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8')
}

async function fetchGithubJson(
  repo: string,
  relativePath: string,
  ref: string,
  token: string,
): Promise<unknown> {
  const url = new URL(`https://api.github.com/repos/${repo}/contents/${relativePath}`)
  url.searchParams.set('ref', ref)
  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!res.ok) return null
  return res.json()
}

function parseYamlish(body: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = body.split(/\r?\n/)
  let currentListKey: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed === '---' || trimmed.startsWith('#')) continue

    const listMatch = line.match(/^\s*-\s+(.+)$/)
    if (listMatch && currentListKey) {
      const current = result[currentListKey]
      const list = Array.isArray(current) ? current : []
      list.push(parseScalar(listMatch[1] ?? ''))
      result[currentListKey] = list
      continue
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
    if (!keyMatch) {
      currentListKey = null
      continue
    }

    const key = keyMatch[1]
    const rawValue = keyMatch[2] ?? ''
    if (!key) continue
    if (rawValue === '') {
      result[key] = []
      currentListKey = key
    } else {
      result[key] = parseScalar(rawValue)
      currentListKey = null
    }
  }

  return result
}

function parseScalar(rawValue: string): unknown {
  const value = rawValue.trim()
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value)
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function emptyManifest(folder: string, errors: string[]): ConsoleRepoManifest {
  return {
    folder,
    repo_id: null,
    display_name: null,
    repo_type: null,
    owner: null,
    sensitivity_tier: null,
    status: null,
    domains: [],
    allowed_context_consumers: [],
    artifact_roots: [],
    source_of_truth_files: [],
    validation_errors: errors,
  }
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function stripMarkdown(value: string): string {
  return value.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

function countLegacyRowsThisWeek(rows: LegacyOutreachRow[], weekOf: string | null): number {
  if (!weekOf) return 0
  const start = new Date(`${weekOf}T00:00:00`)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return rows.filter((row) => {
    const date = new Date(`${row.date}T00:00:00`)
    return date >= start && date < end
  }).length
}

function normalizeDash(value: string): string {
  return value.replace(/[\u2014\u2013]/g, '-')
}

function isGithubFile(value: unknown): value is { content: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    typeof (value as { content?: unknown }).content === 'string'
  )
}

function isGithubListingItem(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name?: unknown }).name === 'string'
  )
}
