import { useEffect, useMemo, useState } from 'react'
import { api, type CaptureRow, type CaptureDetail } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Captures() {
  const [rows, setRows] = useState<CaptureRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    api
      .captures(100)
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return null
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (sourceFilter && r.source !== sourceFilter) return false
      if (!needle) return true
      return [r.id, r.source, r.classifiedDomain, r.classifiedType, r.status, r.rawContentRef]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    })
  }, [rows, q, sourceFilter])

  if (err) return <ErrorBox message={err} />
  if (!rows) return <div className="text-neutral-400">Loading...</div>

  const sources = Array.from(new Set(rows.map((r) => r.source))).sort()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold mr-auto">Captures</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter..."
          className="rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-neutral-600"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-sm"
        >
          <option value="">all sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {filtered && filtered.length === 0 ? (
        <p className="text-neutral-500">No captures match.</p>
      ) : (
        <div className="rounded-lg border border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Domain</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Type</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {filtered!.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  className="hover:bg-neutral-900/50 cursor-pointer"
                >
                  <td className="px-3 py-2 font-mono text-xs text-neutral-400">
                    {new Date(r.receivedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{r.source}</td>
                  <td className="px-3 py-2 text-neutral-400">{r.classifiedDomain ?? '-'}</td>
                  <td className="px-3 py-2 text-neutral-400 hidden sm:table-cell">
                    {r.classifiedType ?? '-'}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeId ? <CaptureDetailModal id={activeId} onClose={() => setActiveId(null)} /> : null}
    </div>
  )
}

function CaptureDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<CaptureDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .captureDetail(id)
      .then(setDetail)
      .catch((e) => setErr(e.message))
  }, [id])

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-0 sm:p-6 z-50"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-lg w-full max-w-2xl max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
          <div className="text-sm font-mono text-neutral-300 flex-1 truncate">{id}</div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 text-sm"
            aria-label="Close"
          >
            close
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {err ? <ErrorBox message={err} /> : null}
          {!detail && !err ? <p className="text-neutral-500">Loading...</p> : null}
          {detail ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <KV label="Source" value={detail.source} />
                <KV label="Status" value={detail.status} />
                <KV label="Domain" value={detail.classifiedDomain ?? '-'} />
                <KV label="Type" value={detail.classifiedType ?? '-'} />
                <KV
                  label="Confidence"
                  value={detail.confidence != null ? detail.confidence.toFixed(2) : '-'}
                />
                <KV label="Model" value={detail.modelUsed ?? '-'} />
                <KV label="Hash" value={detail.contentHash.slice(0, 12)} />
                <KV label="Received" value={new Date(detail.receivedAt).toLocaleString()} />
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                  Raw ref
                </div>
                <div className="font-mono text-xs text-neutral-300 break-all">
                  {detail.rawContentRef}
                </div>
              </div>

              {detail.actionItems.length ? (
                <div>
                  <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                    Action items
                  </div>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {detail.actionItems.map((a, i) => (
                      <li key={i}>{a.text ?? JSON.stringify(a)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {detail.decisions.length ? (
                <div>
                  <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                    Decisions
                  </div>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {detail.decisions.map((d, i) => (
                      <li key={i}>{d.text ?? JSON.stringify(d)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {detail.body ? (
                <div>
                  <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">
                    Filed body
                  </div>
                  <pre className="text-xs font-mono bg-neutral-900 border border-neutral-800 rounded-md p-3 whitespace-pre-wrap">
                    {detail.body}
                  </pre>
                </div>
              ) : null}

              {detail.errorMessage ? (
                <div>
                  <div className="text-xs uppercase tracking-wider text-red-500 mb-1">Error</div>
                  <pre className="text-xs font-mono bg-red-950/30 border border-red-900 rounded-md p-3 whitespace-pre-wrap text-red-300">
                    {detail.errorMessage}
                  </pre>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-neutral-200 text-sm">{value}</div>
    </div>
  )
}
