import { useEffect, useState } from 'react'
import { api, type CaptureRow } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Captures() {
  const [rows, setRows] = useState<CaptureRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .captures(100)
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!rows) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Captures</h1>
      {rows.length === 0 ? (
        <p className="text-neutral-500">No captures yet.</p>
      ) : (
        <div className="rounded-lg border border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {new Date(r.receivedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{r.source}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.classifiedDomain ?? '-'}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.classifiedType ?? '-'}</td>
                  <td className="px-3 py-2">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
