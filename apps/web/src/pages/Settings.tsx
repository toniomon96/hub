import { useEffect, useState } from 'react'
import { api, type Settings as SettingsT } from '../api.js'
import { ErrorBox } from './Dashboard.js'

export function Settings() {
  const [s, setS] = useState<SettingsT | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then(setS)
      .catch((e) => setErr(e.message))
  }, [])

  if (err) return <ErrorBox message={err} />
  if (!s) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Read-only view of the server config. Edit via <code className="font-mono">.env</code> on
          the host and restart.
        </p>
      </div>

      <Section title="Server">
        <KV label="Version" value={s.version} />
        <KV label="Timezone" value={s.timezone} />
        <KV label="Host" value={`${s.host}:${s.port}`} />
        <KV label="Log level" value={s.logLevel} />
        <KV label="DB" value={s.dbPath} mono />
        <KV label="Vault" value={s.vaultPath ?? '(not set)'} mono />
        <KV label="Daily USD cap" value={`$${s.dailyUsdCap.toFixed(2)}`} />
      </Section>

      <Section title="Models">
        <KV label="Default (cloud)" value={s.models.default} mono />
        <KV label="Local trivial" value={s.models.localTrivial} mono />
        <KV label="Local private" value={s.models.localPrivate} mono />
        <KV label="Local fallback" value={s.models.localFallback} mono />
        <KV label="Ollama URL" value={s.ollamaUrl} mono />
      </Section>

      <Section title="Integrations">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(s.integrations).map(([k, v]) => (
            <div
              key={k}
              className={[
                'rounded-md border px-3 py-2 text-sm flex items-center gap-2',
                v
                  ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
                  : 'border-neutral-800 bg-neutral-900/40 text-neutral-500',
              ].join(' ')}
            >
              <span
                className={[
                  'w-1.5 h-1.5 rounded-full',
                  v ? 'bg-emerald-400' : 'bg-neutral-600',
                ].join(' ')}
              />
              <span className="font-mono">{k}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500 mb-3">
        {title}
      </h2>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/30 divide-y divide-neutral-800">
        {children}
      </div>
    </section>
  )
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className={mono ? 'font-mono text-neutral-200 text-xs text-right' : 'text-neutral-200'}>
        {value}
      </span>
    </div>
  )
}
