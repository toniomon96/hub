import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  type ConsoleChecklistItem,
  type ConsoleDashboard as ConsoleDashboardT,
  type ConsoleOutreachRow,
  type ConsoleRepoManifest,
  type ConsoleTodo,
} from '../api.js'
import { ErrorBox } from './Dashboard.js'

type SavingState =
  | null
  | 'todo-create'
  | `todo-${string}`
  | 'outreach-create'
  | `outreach-${string}`

type OutreachFormStatus = 'sent' | 'replied' | 'declined' | 'converted' | 'stale'

interface OutreachFormState {
  happened_on: string
  name: string
  channel: string
  ask: string
  status: OutreachFormStatus
  notes: string
}

export function Console() {
  const [data, setData] = useState<ConsoleDashboardT | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState<SavingState>(null)
  const [todoTitle, setTodoTitle] = useState('')
  const [todoHigh, setTodoHigh] = useState(true)
  const [outreachForm, setOutreachForm] = useState<OutreachFormState>({
    happened_on: todayDate(),
    name: '',
    channel: 'LinkedIn DM',
    ask: 'Audit referral ask',
    status: 'sent',
    notes: '',
  })

  const refresh = useCallback(async () => {
    setErr(null)
    const next = await api.consoleDashboard()
    setData(next)
  }, [])

  useEffect(() => {
    refresh().catch((e: Error) => setErr(e.message))
  }, [refresh])

  const todos = data?.todos ?? {
    rows: [] as ConsoleTodo[],
    openCount: 0,
    completedThisWeek: 0,
    configured: false,
    emptyMessage: 'configure Supabase to manage todos from the console',
    sourcePath: 'supabase.admin_todos',
  }

  const intake = data?.intake ?? {
    rows: [],
    newCount: 0,
    configured: false,
    emptyMessage: 'configure Supabase to capture consulting intake submissions',
    sourcePath: 'supabase.intake_submissions',
  }

  const priorityItems = data?.weekly.items.filter((item) => item.priority) ?? []
  const ordinaryItems = data?.weekly.items.filter((item) => !item.priority) ?? []
  const openTodos = useMemo(() => todos.rows.filter((todo) => todo.status === 'open'), [todos.rows])
  const completedTodos = useMemo(
    () => todos.rows.filter((todo) => todo.status === 'done'),
    [todos.rows],
  )

  async function submitTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = todoTitle.trim()
    if (!title) return
    setSaving('todo-create')
    setNotice(null)
    try {
      await api.consoleTodoCreate({ title, priority: todoHigh ? 'high' : 'normal' })
      setTodoTitle('')
      setNotice('todo added')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function updateTodo(todo: ConsoleTodo, status: 'open' | 'done' | 'archived') {
    setSaving(`todo-${todo.id}`)
    setNotice(null)
    try {
      if (status === 'archived') await api.consoleTodoArchive(todo.id)
      else await api.consoleTodoUpdate({ id: todo.id, status })
      setNotice(status === 'archived' ? 'todo archived' : 'todo updated')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function submitOutreach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!outreachForm.name.trim() || !outreachForm.ask.trim()) return
    setSaving('outreach-create')
    setNotice(null)
    try {
      await api.consoleOutreachCreate(outreachForm)
      setOutreachForm({
        happened_on: todayDate(),
        name: '',
        channel: 'LinkedIn DM',
        ask: 'Audit referral ask',
        status: 'sent',
        notes: '',
      })
      setNotice('outreach logged')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  async function markOutreach(row: ConsoleOutreachRow, status: 'replied' | 'converted' | 'stale') {
    if (!row.id) return
    setSaving(`outreach-${row.id}`)
    setNotice(null)
    try {
      await api.consoleOutreachUpdate({ id: row.id, status })
      setNotice('outreach updated')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  if (err) return <ErrorBox message={err} />
  if (!data) return <div className="text-neutral-400">Loading console...</div>

  return (
    <div className="console-page space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--console-line)] pb-5">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--console-muted)]">
            toni montez consulting
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--console-ink)]">
            operating console<span className="text-[var(--console-accent)]">.</span>
          </h1>
        </div>
        <div className="text-right text-xs text-[var(--console-muted)]">
          <div className="font-mono">{data.source.adapter} source</div>
          <div>{data.source.playbookRoot ?? 'source not configured'}</div>
        </div>
      </header>

      {notice && (
        <div className="rounded-md border border-[rgba(0,255,136,0.34)] bg-[rgba(0,255,136,0.07)] px-3 py-2 text-sm text-[var(--console-accent)]">
          {notice}
        </div>
      )}
      {data.source.warnings.length > 0 && <Warnings warnings={data.source.warnings} />}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel title="todos" source={todos.sourcePath}>
          <form onSubmit={submitTodo} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input
              value={todoTitle}
              onChange={(event) => setTodoTitle(event.target.value)}
              disabled={!todos.configured || saving !== null}
              maxLength={180}
              className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
              placeholder={todos.configured ? 'Next action' : 'Supabase not configured'}
            />
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--console-line)] px-3 text-xs text-[var(--console-muted)]">
              <input
                type="checkbox"
                checked={todoHigh}
                onChange={(event) => setTodoHigh(event.target.checked)}
                disabled={!todos.configured || saving !== null}
              />
              high
            </label>
            <button
              type="submit"
              disabled={!todos.configured || saving !== null || !todoTitle.trim()}
              className="min-h-10 rounded-md border border-[var(--console-accent)] px-3 text-xs text-[var(--console-accent)] disabled:cursor-not-allowed disabled:border-[var(--console-line)] disabled:text-[var(--console-muted)]"
            >
              add
            </button>
          </form>

          <div className="mt-4 space-y-2">
            {todos.rows.length === 0 ? (
              <EmptyState text={todos.emptyMessage} />
            ) : (
              <>
                {openTodos.map((todo) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    busy={saving === `todo-${todo.id}`}
                    onUpdate={updateTodo}
                  />
                ))}
                {completedTodos.length > 0 && (
                  <div className="pt-2">
                    <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--console-muted)]">
                      done
                    </div>
                    <div className="space-y-2">
                      {completedTodos.slice(0, 6).map((todo) => (
                        <TodoRow
                          key={todo.id}
                          todo={todo}
                          busy={saving === `todo-${todo.id}`}
                          onUpdate={updateTodo}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>

        <Panel title="outreach" source={data.outreach.sourcePath}>
          <form onSubmit={submitOutreach} className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-[0.55fr_1fr]">
              <input
                type="date"
                value={outreachForm.happened_on}
                onChange={(event) =>
                  setOutreachForm((form) => ({ ...form, happened_on: event.target.value }))
                }
                disabled={!data.outreach.configured || saving !== null}
                className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
              />
              <input
                value={outreachForm.name}
                onChange={(event) =>
                  setOutreachForm((form) => ({ ...form, name: event.target.value }))
                }
                disabled={!data.outreach.configured || saving !== null}
                className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
                placeholder={data.outreach.configured ? 'Name' : 'Supabase not configured'}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-[0.75fr_1fr_0.55fr_auto]">
              <input
                value={outreachForm.channel}
                onChange={(event) =>
                  setOutreachForm((form) => ({ ...form, channel: event.target.value }))
                }
                disabled={!data.outreach.configured || saving !== null}
                className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
              />
              <input
                value={outreachForm.ask}
                onChange={(event) =>
                  setOutreachForm((form) => ({ ...form, ask: event.target.value }))
                }
                disabled={!data.outreach.configured || saving !== null}
                className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
              />
              <select
                value={outreachForm.status}
                onChange={(event) =>
                  setOutreachForm((form) => ({
                    ...form,
                    status: event.target.value as OutreachFormStatus,
                  }))
                }
                disabled={!data.outreach.configured || saving !== null}
                className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
              >
                <option value="sent">sent</option>
                <option value="replied">replied</option>
                <option value="declined">declined</option>
                <option value="converted">converted</option>
                <option value="stale">stale</option>
              </select>
              <button
                type="submit"
                disabled={!data.outreach.configured || saving !== null || !outreachForm.name.trim()}
                className="min-h-10 rounded-md border border-[var(--console-accent)] px-3 text-xs text-[var(--console-accent)] disabled:cursor-not-allowed disabled:border-[var(--console-line)] disabled:text-[var(--console-muted)]"
              >
                log
              </button>
            </div>
            <input
              value={outreachForm.notes}
              onChange={(event) =>
                setOutreachForm((form) => ({ ...form, notes: event.target.value }))
              }
              disabled={!data.outreach.configured || saving !== null}
              className="min-h-10 rounded-md border border-[var(--console-line)] bg-black/20 px-3 text-sm text-[var(--console-ink)] outline-none focus:border-[var(--console-accent)]"
              placeholder="Notes"
            />
          </form>

          <div className="mt-4 space-y-2">
            {data.outreach.rows.length === 0 ? (
              <EmptyState text={data.outreach.emptyMessage} />
            ) : (
              data.outreach.rows
                .slice(0, 8)
                .map((row) => (
                  <OutreachRow
                    key={row.id ?? `${row.date}-${row.name}`}
                    row={row}
                    busy={Boolean(row.id && saving === `outreach-${row.id}`)}
                    onMark={markOutreach}
                  />
                ))
            )}
          </div>
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
        <Panel
          title={data.weekly.weekOf ? `weekly source: ${data.weekly.weekOf}` : 'weekly source'}
          source={data.weekly.sourcePath}
        >
          {data.weekly.items.length === 0 ? (
            <EmptyState text={data.weekly.emptyMessage} />
          ) : (
            <div className="space-y-4">
              {priorityItems.length > 0 && (
                <div className="space-y-2">
                  {priorityItems.map((item) => (
                    <ChecklistRow key={item.text} item={item} priority />
                  ))}
                </div>
              )}
              {ordinaryItems.length > 0 && (
                <div className="space-y-2">
                  {ordinaryItems.map((item) => (
                    <ChecklistRow key={item.text} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel title="inbound" source={intake.sourcePath}>
          {intake.rows.length === 0 ? (
            <EmptyState text={intake.emptyMessage} />
          ) : (
            <div className="space-y-2">
              {intake.rows.slice(0, 5).map((submission) => (
                <div
                  key={submission.id}
                  className="rounded-md border border-[var(--console-line)] bg-black/10 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-[var(--console-ink)]">{submission.name}</div>
                    <span className="rounded bg-[var(--console-panel-strong)] px-2 py-0.5 text-xs text-[var(--console-muted)]">
                      {submission.status}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-[var(--console-muted)]">
                    {submission.email}
                  </div>
                  <p className="mt-2 text-sm leading-5 text-[var(--console-muted)]">
                    {submission.project}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <Panel title="proof artifacts" source=".repo.yml across local repos">
          {data.proofArtifacts.repos.length === 0 ? (
            <EmptyState text={data.proofArtifacts.emptyMessage} />
          ) : (
            <div className="space-y-2">
              {data.proofArtifacts.repos.map((repo) => (
                <RepoRow key={repo.folder} repo={repo} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="roadmap gates" source="90_DAY_EXECUTION_ROADMAP_v2.md">
          <div className="mb-4 rounded-md border border-[var(--console-line)] bg-[var(--console-panel-strong)] p-3">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--console-muted)]">
              current phase
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--console-ink)]">
              {data.roadmap.currentPhase}
            </div>
            {data.roadmap.principle && (
              <p className="mt-2 text-xs leading-5 text-[var(--console-muted)]">
                {data.roadmap.principle}
              </p>
            )}
          </div>

          <div className="space-y-2">
            {data.roadmap.notToBuild.slice(0, 5).map((gate) => (
              <div
                key={gate}
                className="rounded-md border border-[var(--console-line)] px-3 py-2 text-xs text-[var(--console-muted)]"
              >
                {gate}
              </div>
            ))}
          </div>

          <Link
            to="/console/roadmap"
            className="mt-4 inline-flex rounded-md border border-[var(--console-line)] px-3 py-1.5 text-xs text-[var(--console-ink)] hover:border-[var(--console-accent)]"
          >
            open roadmap
          </Link>
        </Panel>
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  subtext,
  tone,
}: {
  label: string
  value: string
  subtext: string
  tone: 'ok' | 'warn' | 'empty'
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-[var(--console-accent)]'
      : tone === 'warn'
        ? 'text-[var(--console-warn)]'
        : 'text-[var(--console-muted)]'
  return (
    <div className="rounded-lg border border-[var(--console-line)] bg-[var(--console-panel)] p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--console-muted)]">{label}</div>
      <div className={`mt-2 font-mono text-3xl font-semibold ${toneClass}`}>{value}</div>
      <p className="mt-2 text-xs leading-5 text-[var(--console-muted)]">{subtext}</p>
    </div>
  )
}

function Panel({
  title,
  source,
  children,
}: {
  title: string
  source: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-[var(--console-line)] bg-[var(--console-panel)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold lowercase tracking-normal text-[var(--console-ink)]">
          {title}
          <span className="text-[var(--console-accent)]">.</span>
        </h2>
        <span className="font-mono text-[11px] text-[var(--console-muted)]">{source}</span>
      </div>
      {children}
    </section>
  )
}

function TodoRow({
  todo,
  busy,
  onUpdate,
}: {
  todo: ConsoleTodo
  busy: boolean
  onUpdate: (todo: ConsoleTodo, status: 'open' | 'done' | 'archived') => void
}) {
  const done = todo.status === 'done'
  return (
    <div
      className={[
        'rounded-md border px-3 py-2',
        todo.priority === 'high'
          ? 'border-[var(--console-accent)] bg-[rgba(0,255,136,0.07)]'
          : 'border-[var(--console-line)] bg-black/10',
        done ? 'opacity-70' : '',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate(todo, done ? 'open' : 'done')}
          className={[
            'inline-flex h-5 w-5 items-center justify-center rounded-sm border text-[10px]',
            done
              ? 'border-[var(--console-accent)] bg-[var(--console-accent)] text-black'
              : 'border-[var(--console-muted)] text-[var(--console-muted)]',
          ].join(' ')}
          aria-label={done ? 'reopen todo' : 'complete todo'}
        >
          {done ? 'x' : ''}
        </button>
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm text-[var(--console-ink)]">{todo.title}</div>
          <div className="mt-1 font-mono text-[11px] text-[var(--console-muted)]">
            {todo.week_of} / {todo.priority}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onUpdate(todo, 'archived')}
          className="rounded-md border border-[var(--console-line)] px-2 py-1 text-xs text-[var(--console-muted)] hover:border-[var(--console-warn)] hover:text-[var(--console-warn)] disabled:opacity-50"
        >
          archive
        </button>
      </div>
    </div>
  )
}

function OutreachRow({
  row,
  busy,
  onMark,
}: {
  row: ConsoleOutreachRow
  busy: boolean
  onMark: (row: ConsoleOutreachRow, status: 'replied' | 'converted' | 'stale') => void
}) {
  return (
    <div className="rounded-md border border-[var(--console-line)] bg-black/10 px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-[var(--console-ink)]">{row.name}</div>
          <div className="mt-1 font-mono text-[11px] text-[var(--console-muted)]">
            {row.date} / {row.channel}
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--console-muted)]">{row.ask}</p>
          {row.notes && (
            <p className="mt-1 text-xs leading-5 text-[var(--console-muted)]">{row.notes}</p>
          )}
        </div>
        <span className="rounded bg-[var(--console-panel-strong)] px-2 py-0.5 text-xs text-[var(--console-ink)]">
          {row.status}
        </span>
      </div>
      {row.id && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(['replied', 'converted', 'stale'] as const).map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy || row.status === status}
              onClick={() => onMark(row, status)}
              className="rounded-md border border-[var(--console-line)] px-2 py-1 text-xs text-[var(--console-muted)] hover:border-[var(--console-accent)] hover:text-[var(--console-accent)] disabled:opacity-50"
            >
              {status}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ChecklistRow({
  item,
  priority = false,
}: {
  item: ConsoleChecklistItem
  priority?: boolean
}) {
  return (
    <div
      className={[
        'rounded-md border px-3 py-2',
        priority
          ? 'border-[var(--console-accent)] bg-[rgba(0,255,136,0.07)]'
          : 'border-[var(--console-line)] bg-black/10',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            'mt-1 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[9px]',
            item.checked
              ? 'border-[var(--console-accent)] bg-[var(--console-accent)] text-black'
              : 'border-[var(--console-muted)] text-[var(--console-muted)]',
          ].join(' ')}
        >
          {item.checked ? 'x' : ''}
        </span>
        <div>
          <div className="text-sm text-[var(--console-ink)]">{item.text}</div>
          {item.children.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-[var(--console-muted)]">
              {item.children.map((child) => (
                <li key={child}>{child}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function RepoRow({ repo }: { repo: ConsoleRepoManifest }) {
  const hasWarnings = repo.validation_errors.length > 0
  return (
    <div
      className={[
        'rounded-md border px-3 py-2',
        hasWarnings
          ? 'border-[rgba(255,184,108,0.55)] bg-[rgba(255,184,108,0.06)]'
          : 'border-[var(--console-line)] bg-black/10',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-sm text-[var(--console-ink)]">
            {repo.display_name ?? repo.folder}
          </div>
          <div className="text-xs text-[var(--console-muted)]">
            {repo.repo_type ?? 'type missing'} / tier {repo.sensitivity_tier ?? '?'}
          </div>
        </div>
        <span
          className={[
            'rounded px-2 py-0.5 text-xs',
            hasWarnings
              ? 'bg-[rgba(255,184,108,0.12)] text-[var(--console-warn)]'
              : 'bg-[rgba(0,255,136,0.1)] text-[var(--console-accent)]',
          ].join(' ')}
        >
          {hasWarnings ? `${repo.validation_errors.length} warning` : 'valid'}
        </span>
      </div>
      {hasWarnings && (
        <ul className="mt-2 space-y-1 text-xs text-[var(--console-warn)]">
          {repo.validation_errors.slice(0, 3).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--console-line)] p-5 text-sm text-[var(--console-muted)]">
      {text}
    </div>
  )
}

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-lg border border-[rgba(255,184,108,0.45)] bg-[rgba(255,184,108,0.07)] p-4">
      <div className="text-sm font-semibold text-[var(--console-warn)]">source warnings</div>
      <ul className="mt-2 space-y-1 text-xs text-[var(--console-warn)]">
        {warnings.slice(0, 8).map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  )
}

function todayDate(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
