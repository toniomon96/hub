import { useEffect, useState } from 'react'
import { api, type StatusResponse } from '../api.js'

export function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      api
        .status()
        .then((s) => !cancelled && setStatus(s))
        .catch((e) => !cancelled && setErr(e.message))
    load()
    const t = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!status) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Captures" value={status.counts.captures} />
        <StatCard label="Runs" value={status.counts.runs} />
        <StatCard label="Active leases" value={status.counts.leases} />
      </div>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500 mb-3">
          Recent runs
        </h2>
        {status.recentRuns.length === 0 ? (
          <p className="text-neutral-500">No runs yet. Try the Ask page.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {status.recentRuns.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-900/50">
                    <td className="px-3 py-2 text-neutral-400 font-mono text-xs">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{r.agent}</td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-400">{r.model}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right text-neutral-400 font-mono text-xs">
                      {r.costUsd ? `$${r.costUsd.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-3xl font-semibold mt-2">{value.toLocaleString()}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success'
      ? 'bg-emerald-500/10 text-emerald-400'
      : status === 'error'
        ? 'bg-red-500/10 text-red-400'
        : status === 'running'
          ? 'bg-sky-500/10 text-sky-400'
          : 'bg-neutral-500/10 text-neutral-400'
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{status}</span>
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-900 bg-red-950/30 p-4 text-red-300 text-sm">
      <div className="font-medium mb-1">Error</div>
      <div className="font-mono text-xs break-all">{message}</div>
      <div className="mt-2 text-neutral-400 text-xs">
        Is the Hub server running? Try <code>pnpm --filter @hub/server dev</code>.
      </div>
    </div>
  )
}
