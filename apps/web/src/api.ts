export interface ObsRun {
  id: string
  agentName: string
  startedAt: number
  endedAt: number | null
  modelUsed: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  status: string
  promptId: string | null
  adversarialNote: string | null
}

export interface ObsCostRow {
  promptId: string | null
  modelUsed: string
  totalUsd: number
  runCount: number
}

export interface ObsPromptRow {
  promptId: string
  runCount: number
  actedCount: number
  ignoredCount: number
  wrongCount: number
  lastRunAt: number | null
}

export interface ObsSensRow {
  provider: string
  count: number
}

export interface ExportFileMeta {
  name: string
  sizeBytes: number
  createdAt: string
}

export interface PromptRow {
  id: string
  title: string
  description: string
  sensitivity: 'low' | 'medium' | 'high'
  complexity: 'trivial' | 'standard' | 'complex'
  enabled: number
}

export interface PromptTarget {
  id: number
  repo: string
  promptId: string
  trigger: string
  enabled: number
  lastRunAt: number | null
}

export interface SyncResult {
  promptsUpserted: number
  targetsUpserted: number
  targetsRemoved: number
  errors: Array<{ file: string; error: string }>
}

export interface EditResult {
  diff: string
  committed: boolean
  commitSha?: string
  pushedTo?: string
  syncSummary?: SyncResult
}

export interface PromptRunResult {
  runId: string
}

export interface StatusResponse {
  version: string
  counts: { captures: number; runs: number; leases: number }
  leases: Array<{
    name: string
    holderPid: number
    leaseUntil: number
    acquiredAt: number
  }>
  recentRuns: Array<{
    id: string
    agent: string
    model: string
    status: string
    startedAt: number
    endedAt: number | null
    costUsd: number | null
  }>
}

export interface CaptureRow {
  id: string
  source: string
  receivedAt: number
  classifiedDomain: string | null
  classifiedType: string | null
  status: string
  rawContentRef: string
}

export interface CaptureDetail extends CaptureRow {
  contentHash: string
  confidence: number | null
  modelUsed: string | null
  errorMessage: string | null
  entities: Array<{ name?: string; type?: string }>
  actionItems: Array<{ text?: string; due?: string }>
  decisions: Array<{ text?: string }>
  dispatchedTo: string[]
  body: string | null
}

export interface BriefingRow {
  date: string
  generatedAt: number
  runId: string
  obsidianRef: string
  rating: number | null
}

export interface BriefingDetail extends BriefingRow {
  notes: string | null
  body: string | null
}

export interface Settings {
  version: string
  timezone: string
  port: number
  host: string
  vaultPath: string | null
  dbPath: string
  logLevel: string
  models: {
    default: string
    localTrivial: string
    localPrivate: string
    localFallback: string
  }
  dailyUsdCap: number
  ollamaUrl: string
  integrations: Record<string, boolean>
}

export interface AskResponse {
  runId: string
  output: string
  modelUsed: string
  status: 'success' | 'error' | 'partial'
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (res.status === 401) {
    const back = encodeURIComponent(window.location.pathname + window.location.search)
    if (!window.location.pathname.startsWith('/login')) {
      window.location.replace(`/login?return=${back}`)
    }
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return (await res.json()) as T
}

export const api = {
  status: () => request<StatusResponse>('/api/status'),
  captures: (limit = 50) =>
    request<{ captures: CaptureRow[] }>(`/api/captures?limit=${limit}`).then((r) => r.captures),
  captureDetail: (id: string) => request<CaptureDetail>(`/api/captures/${encodeURIComponent(id)}`),
  briefings: (limit = 30) =>
    request<{ briefings: BriefingRow[] }>(`/api/briefings?limit=${limit}`).then((r) => r.briefings),
  briefingDetail: (date: string) =>
    request<BriefingDetail>(`/api/briefings/${encodeURIComponent(date)}`),
  settings: () => request<Settings>('/api/settings'),
  capture: (text: string, source = 'manual') =>
    request<{ id: string; isDuplicate: boolean }>('/api/captures', {
      method: 'POST',
      body: JSON.stringify({ text, source }),
    }),
  briefLatest: () => request<BriefingDetail>('/api/brief/latest'),
  briefRegenerate: () =>
    request<BriefingDetail>('/api/brief/regenerate', { method: 'POST', body: '{}' }),
  feedbackCreate: (
    sourceType: 'ask' | 'brief' | 'prompt_run',
    sourceId: string,
    signal: 'acted' | 'ignored' | 'wrong',
  ) =>
    request<{ id: string }>('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({ sourceType, sourceId, signal }),
    }),
  contextGet: () => request<{ body: string; updatedAt: string | null }>('/api/context'),
  contextPut: (body: string) =>
    request<{ ok: true }>('/api/context', {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),
  contextAppend: (section: string, entry: string) =>
    request<{ ok: true }>('/api/context/append', {
      method: 'POST',
      body: JSON.stringify({ section, entry }),
    }),
  ask: (input: string, forceLocal = false) =>
    request<AskResponse>('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ input, forceLocal }),
    }),
  obsRuns: (since?: string, limit?: number) =>
    request<ObsRun[]>(`/api/observability/runs?since=${since ?? '7d'}&limit=${limit ?? 50}`),
  obsCosts: (since?: string) =>
    request<ObsCostRow[]>(`/api/observability/costs?since=${since ?? '30d'}`),
  obsPrompts: (since?: string) =>
    request<ObsPromptRow[]>(`/api/observability/prompts?since=${since ?? '30d'}`),
  obsSensitivity: (since?: string) =>
    request<ObsSensRow[]>(`/api/observability/sensitivity?since=${since ?? '30d'}`),
  exports: () => request<ExportFileMeta[]>('/api/exports'),
  promptsList: () => request<PromptRow[]>('/api/prompts/list'),
  registryTargets: (repo?: string) =>
    request<PromptTarget[]>(
      `/api/registry/targets${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`,
    ),
  promptSync: () => request<SyncResult>('/api/prompts/sync', { method: 'POST', body: '{}' }),
  promptRun: (promptId: string, repo: string, args?: Record<string, unknown>) =>
    request<PromptRunResult>('/api/prompts/run', {
      method: 'POST',
      body: JSON.stringify({ promptId, repo, args }),
    }),
  registryAdd: (
    repo: string,
    opts?: { sensitivity?: 'low' | 'medium' | 'high'; branch?: string },
  ) =>
    request<EditResult>('/api/registry/add', {
      method: 'POST',
      body: JSON.stringify({ repo, ...opts }),
    }),
  registryWire: (repo: string, promptId: string, trigger: string) =>
    request<EditResult>('/api/registry/wire', {
      method: 'POST',
      body: JSON.stringify({ repo, promptId, trigger }),
    }),
  registryRemove: (repo: string, promptId?: string, trigger?: string) =>
    request<EditResult>('/api/registry/remove', {
      method: 'POST',
      body: JSON.stringify({ repo, promptId, trigger }),
    }),
  login: (token: string) =>
    fetch('/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then((r) => {
      if (!r.ok) throw new Error(r.status === 401 ? 'Invalid token' : `Login failed (${r.status})`)
      return true
    }),
  logout: () =>
    fetch('/auth/logout', { method: 'POST', credentials: 'include' }).then(() => {
      window.location.replace('/login')
    }),
}
