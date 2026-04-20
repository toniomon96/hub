import { useState } from 'react'
import { api } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Capture() {
  const [text, setText] = useState('')
  const [source, setSource] = useState('manual')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setLoading(true)
    setErr(null)
    setMessage(null)
    try {
      const r = await api.capture(text, source)
      setMessage(r.isDuplicate ? `Duplicate of ${r.id}` : `Captured ${r.id}`)
      setText('')
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Capture</h1>
        <p className="text-sm text-neutral-400 mt-1">Drop a thought. Deduped by content hash.</p>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your thought..."
          rows={6}
          className="w-full rounded-lg bg-neutral-900 border border-neutral-800 px-4 py-3 text-sm focus:outline-none focus:border-neutral-600"
          disabled={loading}
        />
        <div className="flex items-center justify-between">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm"
            disabled={loading}
          >
            <option value="manual">manual</option>
            <option value="superwhisper">superwhisper</option>
            <option value="martin">martin</option>
            <option value="granola">granola</option>
            <option value="plaud">plaud</option>
          </select>
          <button
            type="submit"
            disabled={loading || !text.trim()}
            className="px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-sm font-medium transition-colors"
          >
            {loading ? 'Saving...' : 'Capture'}
          </button>
        </div>
      </form>

      {message && (
        <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-300 font-mono">
          {message}
        </div>
      )}
      {err && <ErrorBox message={err} />}
    </div>
  )
}
