import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type ConsoleRoadmap as ConsoleRoadmapT } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function ConsoleRoadmap() {
  const [data, setData] = useState<ConsoleRoadmapT | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .consoleRoadmap()
      .then(setData)
      .catch((e) => setErr(e.message))
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!data) return <div className="text-neutral-400">Loading roadmap...</div>

  return (
    <div className="console-page space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--console-line)] pb-5">
        <div>
          <Link to="/console" className="font-mono text-xs text-[var(--console-muted)]">
            /console
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-[var(--console-ink)]">
            roadmap gates<span className="text-[var(--console-accent)]">.</span>
          </h1>
        </div>
        <div className="text-right font-mono text-xs text-[var(--console-muted)]">
          {data.source.sourcePath}
        </div>
      </header>

      {data.source.warnings.length > 0 && (
        <section className="rounded-lg border border-[rgba(255,184,108,0.45)] bg-[rgba(255,184,108,0.07)] p-4 text-xs text-[var(--console-warn)]">
          {data.source.warnings.join(' | ')}
        </section>
      )}

      <section className="rounded-lg border border-[var(--console-line)] bg-[var(--console-panel)] p-5">
        <div className="text-xs uppercase tracking-[0.18em] text-[var(--console-muted)]">
          current phase
        </div>
        <div className="mt-2 text-xl font-semibold text-[var(--console-ink)]">
          {data.currentPhase}
        </div>
        {data.principle && (
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--console-muted)]">
            {data.principle}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-[rgba(255,184,108,0.55)] bg-[rgba(255,184,108,0.06)] p-5">
        <h2 className="text-sm font-semibold text-[var(--console-warn)]">
          what not to build<span className="text-[var(--console-accent)]">.</span>
        </h2>
        {data.notToBuild.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--console-muted)]">
            no build gates found - verify the roadmap source.
          </p>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {data.notToBuild.map((gate) => (
              <div
                key={gate}
                className="rounded-md border border-[rgba(255,184,108,0.35)] bg-black/10 px-3 py-2 text-sm text-[var(--console-ink)]"
              >
                {gate}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.7fr]">
        <div className="space-y-3">
          {data.phases.map((phase) => (
            <RoadmapSection
              key={phase.title}
              title={phase.title}
              body={phase.body}
              active={phase.title === data.currentPhase}
            />
          ))}
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[var(--console-line)] bg-[var(--console-panel)] p-4">
            <h2 className="text-sm font-semibold text-[var(--console-ink)]">
              cash flow<span className="text-[var(--console-accent)]">.</span>
            </h2>
            {data.cashFlow.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--console-muted)]">
                no cash-flow table found in the roadmap.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-[var(--console-line)]">
                {data.cashFlow.map((row) => (
                  <div key={row.period} className="flex items-center justify-between gap-4 py-2">
                    <span className="text-sm text-[var(--console-muted)]">{row.period}</span>
                    <span className="text-right font-mono text-xs text-[var(--console-ink)]">
                      {row.expectedRevenue}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-[var(--console-line)] bg-[var(--console-panel)] p-4">
            <h2 className="text-sm font-semibold text-[var(--console-ink)]">
              operator note<span className="text-[var(--console-accent)]">.</span>
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--console-muted)]">
              schemas before population, population before indexing, indexing before UI. the console
              keeps that line visible while the practice gets its first paid audit.
            </p>
          </section>
        </aside>
      </section>
    </div>
  )
}

function RoadmapSection({ title, body, active }: { title: string; body: string; active: boolean }) {
  return (
    <section
      className={[
        'rounded-lg border p-4',
        active
          ? 'border-[var(--console-accent)] bg-[rgba(0,255,136,0.06)]'
          : 'border-[var(--console-line)] bg-[var(--console-panel)]',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--console-ink)]">{title}</h2>
        {active && (
          <span className="rounded bg-[rgba(0,255,136,0.12)] px-2 py-0.5 text-xs text-[var(--console-accent)]">
            current
          </span>
        )}
      </div>
      <div className="mt-3 space-y-2 text-sm leading-6 text-[var(--console-muted)]">
        {body
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 10)
          .map((line) => (
            <p key={line}>{cleanLine(line)}</p>
          ))}
      </div>
    </section>
  )
}

function cleanLine(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
}
