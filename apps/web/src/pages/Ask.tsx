import { useState } from 'react'
import { api, type AskResponse, type AskRequest } from '../api.js'
import { ErrorBox } from './Dashboard.js'
import { FeedbackBar } from '../components/FeedbackBar.js'

const LIFE_AREAS: NonNullable<AskRequest['lifeArea']>[] = [
  'family',
  'personal',
  'health',
  'planning',
  'work',
  'relationships',
  'business',
  'ideas',
  'misc',
]

const WRITE_SCOPES: NonNullable<AskRequest['requestedScopes']> = [
  'tasks',
  'workspace',
  'code',
  'system',
]

export function Ask() {
  const [input, setInput] = useState('')
  const [forceLocal, setForceLocal] = useState(false)
  const [mode, setMode] = useState<NonNullable<AskRequest['mode']>>('clarify')
  const [lifeArea, setLifeArea] = useState<AskRequest['lifeArea']>()
  const [projectRef, setProjectRef] = useState('')
  const [requestedScopes, setRequestedScopes] = useState<
    NonNullable<AskRequest['requestedScopes']>
  >([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setLoading(true)
    setErr(null)
    setResult(null)
    try {
      const r = await api.ask({
        input,
        forceLocal,
        mode,
        ...(lifeArea ? { lifeArea } : {}),
        ...(projectRef.trim() ? { projectRef: projectRef.trim() } : {}),
        ...(requestedScopes.length ? { requestedScopes } : {}),
      })
      setResult(r)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setLoading(false)
    }
  }

  function toggleScope(scope: NonNullable<AskRequest['requestedScopes']>[number]) {
    setRequestedScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    )
  }

  const projectedScopes = mode === 'execute' ? ['knowledge', ...requestedScopes] : ['knowledge']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ask</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Governed assistant entry point. Default scopes stay read-only until you explicitly request
          more and the runtime allows them.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What do you want Hub to clarify, govern, or execute?"
          rows={5}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm focus:border-neutral-600 focus:outline-none"
          disabled={loading}
        />

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-neutral-400">Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as NonNullable<AskRequest['mode']>)}
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <option value="clarify">clarify</option>
              <option value="govern">govern</option>
              <option value="execute">execute</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-neutral-400">Life area</span>
            <select
              value={lifeArea ?? ''}
              onChange={(e) =>
                setLifeArea(
                  e.target.value
                    ? (e.target.value as NonNullable<AskRequest['lifeArea']>)
                    : undefined,
                )
              }
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <option value="">cross-domain</option>
              {LIFE_AREAS.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-neutral-400">Project</span>
            <input
              value={projectRef}
              onChange={(e) => setProjectRef(e.target.value)}
              placeholder="omnexus, dse, launch plan..."
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="mb-2 text-sm font-medium">Authority / scope envelope</div>
          <div className="text-xs text-neutral-400">
            Mode <span className="font-mono text-neutral-200">{mode}</span> · projected scopes{' '}
            <span className="font-mono text-neutral-200">{projectedScopes.join(', ')}</span>
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            Write-capable scopes require `execute` mode, earned life-area authority, and stored
            consent before the server will attach them.
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {WRITE_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={requestedScopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  disabled={loading}
                  className="rounded border-neutral-700 bg-neutral-900"
                />
                request {scope}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-400">
            <input
              type="checkbox"
              checked={forceLocal}
              onChange={(e) => setForceLocal(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-900"
            />
            Force local (Ollama)
          </label>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500"
          >
            {loading ? 'Thinking...' : 'Ask'}
          </button>
        </div>
      </form>

      {err && <ErrorBox message={err} />}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-neutral-500">
            <span>run {result.runId}</span>
            <span>{result.modelUsed}</span>
            {result.appliedMode && <span>mode {result.appliedMode}</span>}
            {result.authority && <span>authority {result.authority}</span>}
            {result.appliedScopes && <span>scopes {result.appliedScopes.join(', ')}</span>}
            {typeof result.costUsd === 'number' && <span>${result.costUsd.toFixed(4)}</span>}
          </div>

          {result.deniedScopes && result.deniedScopes.length > 0 && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-sm text-amber-200">
              {result.deniedScopes.map((denied) => (
                <div key={`${denied.scope}-${denied.reason}`}>
                  denied {denied.scope}: {denied.reason}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {result.output}
          </div>
          <FeedbackBar sourceType="ask" sourceId={result.runId} />
        </div>
      )}
    </div>
  )
}
