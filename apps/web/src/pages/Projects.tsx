import { useEffect, useRef, useState } from 'react'
import { api, type PromptRow, type PromptTarget, type SyncResult } from '../api.js'

// ─── Helpers ─────────────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function TriggerBadge({ trigger }: { trigger: string }) {
  let color = 'bg-neutral-800 text-neutral-400'
  if (trigger.startsWith('cron:')) color = 'bg-blue-900/40 text-blue-400'
  else if (trigger.startsWith('event:')) color = 'bg-amber-900/40 text-amber-400'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono ${color}`}>
      {trigger}
    </span>
  )
}

function SensitivityDot({ level }: { level: 'low' | 'medium' | 'high' }) {
  const color =
    level === 'high' ? 'bg-red-400' : level === 'medium' ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${color}`}
      title={`sensitivity: ${level}`}
    />
  )
}

// ─── Run button per target ────────────────────────────────────────────────

type RunState = 'idle' | 'running' | 'done' | 'error'

function RunButton({
  promptId,
  repo,
  runState,
  onRun,
}: {
  promptId: string
  repo: string
  runState: RunState
  onRun: (promptId: string, repo: string) => void
}) {
  if (runState === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        running
      </span>
    )
  }
  if (runState === 'done') {
    return <span className="text-xs text-emerald-400">✓ done</span>
  }
  if (runState === 'error') {
    return <span className="text-xs text-red-400">✗ error</span>
  }
  return (
    <button
      type="button"
      onClick={() => onRun(promptId, repo)}
      className="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors"
    >
      Run
    </button>
  )
}

// ─── Wire prompt form ─────────────────────────────────────────────────────

function WireForm({
  availablePrompts,
  onWire,
  onClose,
}: {
  availablePrompts: PromptRow[]
  onWire: (promptId: string, trigger: string) => Promise<void>
  onClose: () => void
}) {
  const [promptId, setPromptId] = useState(availablePrompts[0]?.id ?? '')
  const [trigger, setTrigger] = useState('manual')
  const [wiring, setWiring] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!promptId || !trigger) return
    setWiring(true)
    setErr(null)
    try {
      await onWire(promptId, trigger)
      onClose()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setWiring(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 p-3 rounded-lg border border-neutral-700 bg-neutral-900/60 space-y-2"
    >
      <p className="text-xs text-neutral-400 font-medium">Wire a prompt</p>
      <div className="flex flex-wrap gap-2">
        <select
          value={promptId}
          onChange={(e) => setPromptId(e.target.value)}
          className="flex-1 min-w-0 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 focus:outline-none"
        >
          {availablePrompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} — {p.title}
            </option>
          ))}
          {availablePrompts.length === 0 && <option value="">No prompts synced yet</option>}
        </select>
        <input
          type="text"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          placeholder="trigger (manual, cron:0 9 * * 1, event:pr.opened)"
          className="flex-[2] min-w-0 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none font-mono"
        />
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-neutral-500 hover:text-neutral-300"
        >
          cancel
        </button>
        <button
          type="submit"
          disabled={wiring || !promptId}
          className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
        >
          {wiring ? 'Wiring…' : 'Wire'}
        </button>
      </div>
    </form>
  )
}

// ─── Project card (one per repo) ─────────────────────────────────────────

function ProjectCard({
  repo,
  targets,
  availablePrompts,
  runStates,
  onRun,
  onWire,
  onRemove,
}: {
  repo: string
  targets: PromptTarget[]
  availablePrompts: PromptRow[]
  runStates: Record<string, RunState>
  onRun: (promptId: string, repo: string) => void
  onWire: (repo: string, promptId: string, trigger: string) => Promise<void>
  onRemove: (repo: string, promptId: string, trigger: string) => Promise<void>
}) {
  const [showWire, setShowWire] = useState(false)

  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900/60 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-neutral-500" fill="currentColor" viewBox="0 0 16 16">
            <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z" />
          </svg>
          <span className="font-mono text-sm text-neutral-200">{repo}</span>
          <span className="text-xs text-neutral-500">
            {targets.length} prompt{targets.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowWire((v) => !v)}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          {showWire ? 'cancel' : '+ wire'}
        </button>
      </div>

      {targets.length === 0 ? (
        <div className="px-4 py-3 text-xs text-neutral-500">No prompts wired yet.</div>
      ) : (
        <div className="divide-y divide-neutral-800/60">
          {targets.map((t) => {
            const key = `${t.repo}:${t.promptId}:${t.trigger}`
            const neverRun = t.lastRunAt === null
            return (
              <div
                key={t.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm ${neverRun ? 'bg-amber-950/10' : ''}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.enabled ? 'bg-emerald-500' : 'bg-neutral-600'}`}
                  title={t.enabled ? 'enabled' : 'disabled'}
                />
                <span className="font-mono text-xs text-neutral-300 min-w-0">{t.promptId}</span>
                <TriggerBadge trigger={t.trigger} />
                <span className="text-xs text-neutral-500 ml-auto">
                  {neverRun ? (
                    <span className="text-amber-500/80">never run</span>
                  ) : (
                    relativeTime(t.lastRunAt!)
                  )}
                </span>
                <RunButton
                  promptId={t.promptId}
                  repo={t.repo}
                  runState={runStates[key] ?? 'idle'}
                  onRun={onRun}
                />
                <button
                  type="button"
                  onClick={() => onRemove(t.repo, t.promptId, t.trigger)}
                  className="text-neutral-600 hover:text-red-400 transition-colors text-xs"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showWire && (
        <div className="px-4 pb-3">
          <WireForm
            availablePrompts={availablePrompts}
            onWire={(promptId, trigger) => onWire(repo, promptId, trigger)}
            onClose={() => setShowWire(false)}
          />
        </div>
      )}
    </div>
  )
}

// ─── Add repo form ────────────────────────────────────────────────────────

function AddRepoForm({
  onAdd,
}: {
  onAdd: (repo: string, sensitivity: 'low' | 'medium' | 'high') => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [repo, setRepo] = useState('')
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('low')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function toggle() {
    setOpen((v) => !v)
    setErr(null)
    setRepo('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const slug = repo.trim()
    if (!slug || !slug.includes('/')) {
      setErr('Format must be org/repo (e.g. toniomon96/my-project)')
      return
    }
    setAdding(true)
    setErr(null)
    try {
      await onAdd(slug, sensitivity)
      setRepo('')
      setOpen(false)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setAdding(false)
    }
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
      >
        {open ? 'Cancel' : '+ Add project'}
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="mt-3 p-4 rounded-lg border border-neutral-700 bg-neutral-900/60 space-y-3"
        >
          <p className="text-sm font-medium text-neutral-200">Add a project to the registry</p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="org/repo  (e.g. toniomon96/hub)"
              className="flex-[2] min-w-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none font-mono"
            />
            <select
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value as 'low' | 'medium' | 'high')}
              className="rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200 focus:outline-none"
            >
              <option value="low">low sensitivity</option>
              <option value="medium">medium sensitivity</option>
              <option value="high">high sensitivity (local model only)</option>
            </select>
          </div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="submit"
              disabled={adding || !repo.trim()}
              className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-800/40 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding…' : 'Add project'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Sync bar ─────────────────────────────────────────────────────────────

function SyncBar({ onSync }: { onSync: (result: SyncResult) => void }) {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function doSync() {
    setSyncing(true)
    setErr(null)
    setResult(null)
    try {
      const r = await api.promptSync()
      setResult(r)
      onSync(r)
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={doSync}
          disabled={syncing}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Syncing…' : 'Sync hub-prompts + registry'}
        </button>
        {result && !syncing && (
          <span className="text-xs text-neutral-400 font-mono">
            {result.promptsUpserted} prompts · {result.targetsUpserted} targets ·{' '}
            {result.targetsRemoved} removed
          </span>
        )}
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>
      {result && result.errors.length > 0 && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 space-y-1">
          <p className="text-xs font-medium text-red-400">
            {result.errors.length} parse error{result.errors.length !== 1 ? 's' : ''}
          </p>
          {result.errors.map((e, i) => (
            <div key={i} className="text-xs font-mono">
              <span className="text-neutral-400">{e.file}:</span>{' '}
              <span className="text-red-300">{e.error}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────

export function Projects() {
  const [targets, setTargets] = useState<PromptTarget[]>([])
  const [availablePrompts, setAvailablePrompts] = useState<PromptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [runStates, setRunStates] = useState<Record<string, RunState>>({})

  async function loadData() {
    try {
      const [t, p] = await Promise.all([api.registryTargets(), api.promptsList()])
      setTargets(t)
      setAvailablePrompts(p)
    } catch (ex) {
      setLoadErr(ex instanceof Error ? ex.message : String(ex))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function handleSyncComplete(_result: SyncResult) {
    loadData()
  }

  async function handleRun(promptId: string, repo: string) {
    const key = `${repo}:${promptId}`
    // find matching target's trigger for key
    const target = targets.find((t) => t.promptId === promptId && t.repo === repo)
    const fullKey = target ? `${repo}:${promptId}:${target.trigger}` : key
    setRunStates((s) => ({ ...s, [fullKey]: 'running' }))
    try {
      await api.promptRun(promptId, repo)
      setRunStates((s) => ({ ...s, [fullKey]: 'done' }))
      setTimeout(() => setRunStates((s) => ({ ...s, [fullKey]: 'idle' })), 5000)
      loadData()
    } catch {
      setRunStates((s) => ({ ...s, [fullKey]: 'error' }))
      setTimeout(() => setRunStates((s) => ({ ...s, [fullKey]: 'idle' })), 5000)
    }
  }

  async function handleWire(repo: string, promptId: string, trigger: string) {
    await api.registryWire(repo, promptId, trigger)
    await loadData()
  }

  async function handleRemove(repo: string, promptId: string, trigger: string) {
    await api.registryRemove(repo, promptId, trigger)
    await loadData()
  }

  async function handleAddRepo(repo: string, sensitivity: 'low' | 'medium' | 'high') {
    await api.registryAdd(repo, { sensitivity })
    await loadData()
  }

  const repos = [...new Set(targets.map((t) => t.repo))]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold">Projects</h1>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          {!loading && (
            <>
              <span>
                {repos.length} repo{repos.length !== 1 ? 's' : ''}
              </span>
              <span>·</span>
              <span>
                {targets.length} target{targets.length !== 1 ? 's' : ''}
              </span>
              <span>·</span>
              <span>
                {availablePrompts.length} prompt{availablePrompts.length !== 1 ? 's' : ''} in
                library
              </span>
            </>
          )}
        </div>
      </div>

      <SyncBar onSync={handleSyncComplete} />

      <AddRepoForm onAdd={handleAddRepo} />

      {loading && <div className="text-neutral-400 text-sm">Loading projects…</div>}
      {loadErr && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-400">
          {loadErr}
        </div>
      )}

      {!loading && repos.length === 0 && (
        <div className="rounded-lg border border-neutral-800 p-8 text-center space-y-2">
          <p className="text-neutral-400 text-sm">No projects registered yet.</p>
          <p className="text-neutral-500 text-xs">
            Add a project above, then sync to pull prompts from hub-prompts and wire them here.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {repos.map((repo) => (
          <ProjectCard
            key={repo}
            repo={repo}
            targets={targets.filter((t) => t.repo === repo)}
            availablePrompts={availablePrompts}
            runStates={runStates}
            onRun={handleRun}
            onWire={handleWire}
            onRemove={handleRemove}
          />
        ))}
      </div>

      {/* Prompt library summary */}
      {!loading && availablePrompts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-neutral-200">Prompt library</h2>
          <div className="rounded-lg border border-neutral-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium hidden sm:table-cell">Title</th>
                  <th className="px-3 py-2 font-medium">Sensitivity</th>
                  <th className="px-3 py-2 font-medium hidden sm:table-cell">Complexity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {availablePrompts.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-900/50">
                    <td className="px-3 py-2 font-mono text-xs text-neutral-300">{p.id}</td>
                    <td className="px-3 py-2 text-neutral-400 text-xs hidden sm:table-cell">
                      {p.title}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <SensitivityDot level={p.sensitivity} />
                        <span className="text-xs text-neutral-400">{p.sensitivity}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-500 hidden sm:table-cell">
                      {p.complexity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
