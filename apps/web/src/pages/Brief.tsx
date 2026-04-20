import { useEffect, useState } from 'react'
import { api, type BriefingRow, type BriefingDetail } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Brief() {
  const [rows, setRows] = useState<BriefingRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeDate, setActiveDate] = useState<string | null>(null)

  useEffect(() => {
    api
      .briefings(30)
      .then((list) => {
        setRows(list)
        if (list.length > 0) setActiveDate(list[0]!.date)
      })
      .catch((e) => setErr(e.message))
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!rows) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Brief</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Daily and weekly briefings. Bodies live in your Obsidian vault under
          <span className="font-mono text-neutral-300"> Daily/</span>.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-6 text-sm text-neutral-400">
          <p className="mb-2">No briefings generated yet.</p>
          <p className="text-neutral-500">
            Run <code className="font-mono text-neutral-300">hub brief</code> from the CLI, or set{' '}
            <code className="font-mono text-neutral-300">HUB_BRIEF_ENABLED=1</code> on the server to
            enable the 05:00 + 22:00 cron jobs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
          <aside className="rounded-lg border border-neutral-800 overflow-hidden self-start">
            <ul className="divide-y divide-neutral-800 text-sm max-h-[70vh] overflow-y-auto">
              {rows.map((r) => (
                <li key={r.date}>
                  <button
                    onClick={() => setActiveDate(r.date)}
                    className={[
                      'w-full text-left px-3 py-2 transition-colors',
                      activeDate === r.date
                        ? 'bg-neutral-800 text-neutral-100'
                        : 'hover:bg-neutral-900/50 text-neutral-300',
                    ].join(' ')}
                  >
                    <div className="font-mono">{r.date}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(r.generatedAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 min-h-[60vh]">
            {activeDate ? <BriefBody date={activeDate} /> : null}
          </section>
        </div>
      )}
    </div>
  )
}

function BriefBody({ date }: { date: string }) {
  const [detail, setDetail] = useState<BriefingDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setErr(null)
    api
      .briefingDetail(date)
      .then(setDetail)
      .catch((e) => setErr(e.message))
  }, [date])

  if (err) return <p className="text-red-400 text-sm">{err}</p>
  if (!detail) return <p className="text-neutral-500 text-sm">Loading...</p>

  return (
    <article className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-3 pb-2 border-b border-neutral-800">
        <h2 className="text-lg font-semibold font-mono">{detail.date}</h2>
        <span className="text-xs text-neutral-500">run {detail.runId.slice(0, 10)}</span>
        <span className="ml-auto text-xs font-mono text-neutral-500 truncate max-w-full sm:max-w-sm">
          {detail.obsidianRef}
        </span>
      </header>
      {detail.body ? (
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
          {detail.body}
        </pre>
      ) : (
        <p className="text-neutral-500 text-sm">
          Body not found on disk — the vault file may have been moved or deleted.
        </p>
      )}
    </article>
  )
}
