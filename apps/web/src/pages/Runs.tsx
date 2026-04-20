import { useEffect, useState } from 'react'
import { api, type StatusResponse } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Runs() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((e) => setErr(e.message))
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!status) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Runs</h1>
      {status.recentRuns.length === 0 ? (
        <p className="text-neutral-500">No runs yet.</p>
      ) : (
        <div className="rounded-lg border border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Finished</th>
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {status.recentRuns.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {r.endedAt ? new Date(r.endedAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-3 py-2">{r.agent}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">{r.model}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 text-right text-neutral-400 font-mono text-xs">
                    {r.costUsd ? `$${r.costUsd.toFixed(4)}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
