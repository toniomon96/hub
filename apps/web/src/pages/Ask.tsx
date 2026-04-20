import { useState } from 'react'
import { api, type AskResponse } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Ask() {
  const [input, setInput] = useState('')
  const [forceLocal, setForceLocal] = useState(false)
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
      const r = await api.ask(input, forceLocal)
      setResult(r)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Ask</h1>
        <p className="text-sm text-neutral-400 mt-1">
          One-shot query. Goes through the privacy router - sensitive input stays local.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What do you want to know?"
          rows={4}
          className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-sm focus:outline-none focus:border-neutral-600 font-mono"
          disabled={loading}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
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
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-sm font-medium transition-colors"
          >
            {loading ? 'Thinking...' : 'Ask'}
          </button>
        </div>
      </form>

      {err && <ErrorBox message={err} />}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-xs text-neutral-500 font-mono">
            <span>run {result.runId}</span>
            <span>-</span>
            <span>{result.modelUsed}</span>
            {typeof result.costUsd === 'number' && (
              <>
                <span>-</span>
                <span>${result.costUsd.toFixed(4)}</span>
              </>
            )}
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 whitespace-pre-wrap text-sm leading-relaxed">
            {result.output}
          </div>
        </div>
      )}
    </div>
  )
}
