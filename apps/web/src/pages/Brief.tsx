import { useEffect, useState } from 'react'
import { api, type BriefingRow } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Brief() {
  const [rows, setRows] = useState<BriefingRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .briefings(30)
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!rows) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Brief</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Daily and weekly briefings. Body lives in your Obsidian vault under
          <span className="font-mono text-neutral-300"> Daily/</span>.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          <p className="mb-2">No briefings generated yet.</p>
          <p className="text-neutral-500">
            Run <code className="font-mono text-neutral-300">hub brief</code> from the CLI, or
            enable the scheduled daily brief at 05:00 local.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Generated</th>
                <th className="px-3 py-2 font-medium">Obsidian</th>
                <th className="px-3 py-2 font-medium">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((r) => (
                <tr key={r.date} className="hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-mono">{r.date}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {new Date(r.generatedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400 truncate max-w-xs">
                    {r.obsidianRef}
                  </td>
                  <td className="px-3 py-2">{r.rating ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
