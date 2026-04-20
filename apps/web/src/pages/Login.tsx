import { useState, type FormEvent } from 'react'
import { api } from '../api.js'

export function Login() {
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await api.login(token.trim())
      const params = new URLSearchParams(window.location.search)
      const back = params.get('return') || '/'
      window.location.replace(back)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Login failed')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Hub</h1>
          <p className="text-sm text-neutral-500 mt-1">Enter the UI token to continue.</p>
        </div>
        <label className="block">
          <span className="sr-only">UI token</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="hub ui token"
            className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm font-mono text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-emerald-600"
          />
        </label>
        {err ? <p className="text-sm text-red-400">{err}</p> : null}
        <button
          type="submit"
          disabled={busy || token.trim().length === 0}
          className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-sm font-medium text-neutral-950"
        >
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="text-xs text-neutral-500">
          The token is configured on the server as <code className="font-mono">HUB_UI_TOKEN</code>.
        </p>
      </form>
    </div>
  )
}
