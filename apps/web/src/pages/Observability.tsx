import { useEffect, useState } from 'react'
import {
  api,
  type ObsRun,
  type ObsCostRow,
  type ObsPromptRow,
  type ObsSensRow,
  type ExportFileMeta,
} from '../api.js'
import { ErrorBox } from './Dashboard.js'

function fmt(ms: number) {
  return new Date(ms).toLocaleString()
}

function fmtDuration(startedAt: number, endedAt: number | null) {
  if (!endedAt) return '—'
  const s = Math.round((endedAt - startedAt) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono ${color}`}>{text}</span>
  )
}

// ─── Panel 1: Model Trace ────────────────────────────────────────────────
function RunTrace() {
  const [rows, setRows] = useState<ObsRun[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    api
      .obsRuns()
      .then(setRows)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-neutral-400 text-sm">Loading runs...</div>
  if (err) return <ErrorBox message={err} />
  if (rows.length === 0)
    return <div className="text-neutral-500 text-sm">No runs in the last 7 days.</div>

  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.id} className="rounded-md border border-neutral-800 overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-neutral-900/50 text-sm"
            onClick={() => setExpanded(expanded === r.id ? null : r.id)}
          >
            <span className="font-mono text-xs text-neutral-500 w-32 shrink-0">
              {fmt(r.startedAt)}
            </span>
            <span className="font-medium text-neutral-200 flex-1">{r.agentName}</span>
            <span className="font-mono text-xs text-neutral-400">
              {r.modelUsed.split(':')[1] ?? r.modelUsed}
            </span>
            <Badge
              text={r.status}
              color={
                r.status === 'success'
                  ? 'bg-emerald-900/40 text-emerald-400'
                  : r.status === 'error'
                    ? 'bg-red-900/40 text-red-400'
                    : 'bg-neutral-800 text-neutral-400'
              }
            />
            <span className="font-mono text-xs text-neutral-500 w-24 text-right">
              {r.costUsd > 0 ? `$${r.costUsd.toFixed(4)}` : '—'}
            </span>
            <span className="font-mono text-xs text-neutral-500 w-14 text-right">
              {fmtDuration(r.startedAt, r.endedAt)}
            </span>
          </button>
          {expanded === r.id && (
            <div className="px-3 pb-3 text-xs font-mono text-neutral-400 space-y-1 border-t border-neutral-800 pt-2">
              <div>
                <span className="text-neutral-500">id:</span> {r.id}
              </div>
              <div>
                <span className="text-neutral-500">tokens:</span> {r.inputTokens} in /{' '}
                {r.outputTokens} out
              </div>
              {r.promptId && (
                <div>
                  <span className="text-neutral-500">prompt:</span> {r.promptId}
                </div>
              )}
              {r.adversarialNote && (
                <div className="text-amber-400">
                  <span className="text-neutral-500">adversarial:</span> {r.adversarialNote}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Panel 2: Cost Breakdown ─────────────────────────────────────────────
function CostBreakdown() {
  const [rows, setRows] = useState<ObsCostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .obsCosts()
      .then(setRows)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-neutral-400 text-sm">Loading costs...</div>
  if (err) return <ErrorBox message={err} />
  if (rows.length === 0)
    return <div className="text-neutral-500 text-sm">No cost data in the last 30 days.</div>

  const total = rows.reduce((s, r) => s + r.totalUsd, 0)

  return (
    <div className="space-y-2">
      <div className="text-neutral-400 text-xs">
        Total last 30d: <span className="font-mono text-neutral-200">${total.toFixed(4)}</span>
      </div>
      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Prompt</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium text-right">Runs</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {rows
              .sort((a, b) => b.totalUsd - a.totalUsd)
              .map((r, i) => (
                <tr key={i} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-mono text-xs">{r.promptId ?? '(ask)'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">{r.modelUsed}</td>
                  <td className="px-3 py-2 text-right text-neutral-400">{r.runCount}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    ${r.totalUsd.toFixed(4)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Panel 3: Prompt Performance ─────────────────────────────────────────
function PromptPerformance() {
  const [rows, setRows] = useState<ObsPromptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .obsPrompts()
      .then(setRows)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-neutral-400 text-sm">Loading prompt stats...</div>
  if (err) return <ErrorBox message={err} />
  if (rows.length === 0)
    return <div className="text-neutral-500 text-sm">No prompt runs in the last 30 days.</div>

  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900 text-neutral-400 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Prompt</th>
            <th className="px-3 py-2 font-medium text-right">Runs</th>
            <th className="px-3 py-2 font-medium text-right">Acted</th>
            <th className="px-3 py-2 font-medium text-right">Ignored</th>
            <th className="px-3 py-2 font-medium text-right">Wrong</th>
            <th className="px-3 py-2 font-medium">Last Run</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows
            .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
            .map((r) => {
              const total = r.actedCount + r.ignoredCount + r.wrongCount
              const actedRate = total > 0 ? Math.round((r.actedCount / total) * 100) : null
              const isUnderperforming = r.runCount >= 10 && actedRate !== null && actedRate < 30
              return (
                <tr
                  key={r.promptId}
                  className={`hover:bg-neutral-900/50 ${isUnderperforming ? 'bg-red-950/20' : ''}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.promptId}</td>
                  <td className="px-3 py-2 text-right text-neutral-400">{r.runCount}</td>
                  <td className="px-3 py-2 text-right text-emerald-400">{r.actedCount}</td>
                  <td className="px-3 py-2 text-right text-neutral-400">{r.ignoredCount}</td>
                  <td className="px-3 py-2 text-right text-red-400">{r.wrongCount}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {r.lastRunAt ? fmt(r.lastRunAt) : '—'}
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Panel 4: Sensitivity Distribution ───────────────────────────────────
function SensitivityDist() {
  const [rows, setRows] = useState<ObsSensRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .obsSensitivity()
      .then(setRows)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-neutral-400 text-sm">Loading sensitivity data...</div>
  if (err) return <ErrorBox message={err} />
  if (rows.length === 0) return <div className="text-neutral-500 text-sm">No data yet.</div>

  const total = rows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0
        const color = r.provider === 'anthropic' ? 'bg-blue-500' : 'bg-amber-500'
        return (
          <div key={r.provider} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-neutral-300">{r.provider}</span>
              <span className="font-mono text-neutral-400">
                {r.count} runs ({pct}%)
              </span>
            </div>
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
      <div className="text-xs text-neutral-500">
        Ollama = local (private routing). Anthropic = cloud. Last 30 days.
      </div>
    </div>
  )
}

// ─── Exports Panel ────────────────────────────────────────────────────────
function ExportsList() {
  const [files, setFiles] = useState<ExportFileMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .exports()
      .then(setFiles)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-neutral-400 text-sm">Loading exports...</div>
  if (err) return <ErrorBox message={err} />
  if (files.length === 0)
    return (
      <div className="text-neutral-500 text-sm">
        No exports yet. First export runs Sunday 23:00.
      </div>
    )

  return (
    <div className="space-y-1">
      {files.map((f) => (
        <div key={f.name} className="flex items-center justify-between text-sm">
          <a
            href={`/api/exports/${encodeURIComponent(f.name)}`}
            className="font-mono text-xs text-blue-400 hover:text-blue-300"
          >
            {f.name}
          </a>
          <span className="text-neutral-500 text-xs font-mono">
            {(f.sizeBytes / 1024).toFixed(1)}KB
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-neutral-200">{title}</h2>
      {children}
    </section>
  )
}

export function Observability() {
  return (
    <div className="space-y-10">
      <h1 className="text-xl font-semibold">Observability</h1>
      <Panel title="Model Trace — last 7 days">
        <RunTrace />
      </Panel>
      <Panel title="Cost Breakdown — last 30 days">
        <CostBreakdown />
      </Panel>
      <Panel title="Prompt Performance — last 30 days">
        <PromptPerformance />
      </Panel>
      <Panel title="Sensitivity Distribution — last 30 days">
        <SensitivityDist />
      </Panel>
      <Panel title="Exports">
        <ExportsList />
      </Panel>
    </div>
  )
}
