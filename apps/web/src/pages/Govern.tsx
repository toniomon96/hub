import { useState } from 'react'
import { api, type AskResponse, type AskRequest } from '../api.js'
import { ErrorBox } from './Dashboard.js'

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

export function Govern() {
  const [prompt, setPrompt] = useState(
    'What matters now, what conflicts exist across work, family, health, and business, what is at risk, and what should happen next?',
  )
  const [lifeArea, setLifeArea] = useState<AskRequest['lifeArea']>()
  const [projectRef, setProjectRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setErr(null)
    try {
      const response = await api.ask({
        input: prompt,
        mode: 'govern',
        ...(lifeArea ? { lifeArea } : {}),
        ...(projectRef.trim() ? { projectRef: projectRef.trim() } : {}),
      })
      setResult(response)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Govern</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Cross-domain review surface for tradeoffs, stale commitments, protected time, and the next
          highest-leverage move.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm leading-relaxed focus:border-neutral-600 focus:outline-none"
        />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-neutral-400">Life area focus</span>
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
              placeholder="optional project anchor"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {loading ? 'Reviewing...' : 'Run govern review'}
        </button>
      </form>

      {err && <ErrorBox message={err} />}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-neutral-500">
            <span>run {result.runId}</span>
            <span>{result.modelUsed}</span>
            {result.governorDomain && <span>domain {result.governorDomain}</span>}
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {result.output}
          </div>
        </div>
      )}
    </div>
  )
}
