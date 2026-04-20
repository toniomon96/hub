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
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
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
  capture: (text: string, source = 'manual') =>
    request<{ id: string; isDuplicate: boolean }>('/api/captures', {
      method: 'POST',
      body: JSON.stringify({ text, source }),
    }),
  ask: (input: string, forceLocal = false) =>
    request<AskResponse>('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ input, forceLocal }),
    }),
}
