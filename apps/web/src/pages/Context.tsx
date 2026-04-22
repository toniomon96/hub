import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { ErrorBox } from './Dashboard.js'

const SECTION_NAMES = [
  'Active Projects',
  'People',
  'Plural Self',
  'Commitments',
  'Decisions',
  'Preferences',
  'Engineering Conventions',
  'Project Registry',
  'Theories',
  'System Observations',
  'Domain Authority',
  'Stale',
]

// Rough token estimate — same 4 chars/token heuristic as the server budget check.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function parseUpdatedDate(raw: string): string | null {
  const m = raw.match(/^updated: (\S+)/m)
  return m ? m[1]! : null
}

function jumpToSection(textarea: HTMLTextAreaElement, section: string): void {
  const heading = `## ${section}`
  const idx = textarea.value.indexOf(heading)
  if (idx === -1) return
  textarea.focus()
  textarea.setSelectionRange(idx, idx + heading.length)
  // Scroll the textarea so the heading is visible
  const lines = textarea.value.slice(0, idx).split('\n')
  const lineHeight = 20 // approximate px
  textarea.scrollTop = (lines.length - 1) * lineHeight
}

export function Context() {
  const [body, setBody] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api
      .contextGet()
      .then((r) => {
        setBody(r.body)
        setDraft(r.body)
        setUpdatedAt(r.updatedAt)
      })
      .catch((e) => setLoadErr(e.message))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaveErr(null)
    setSaved(false)
    try {
      await api.contextPut(draft)
      setBody(draft)
      const now = new Date().toISOString()
      setUpdatedAt(now)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const isDirty = draft !== body
  const tokens = estimateTokens(draft)
  const overBudget = tokens > 4000
  const frontmatterDate = draft ? parseUpdatedDate(draft) : null

  if (loadErr) return <ErrorBox message={loadErr} />
  if (body === null) return <div className="text-neutral-400">Loading...</div>

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold">Context</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Your living memory. Hub reads this at the start of every run.
            {frontmatterDate && (
              <span className="ml-2 text-neutral-500">Updated {frontmatterDate}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={[
              'text-xs font-mono px-2 py-1 rounded',
              overBudget
                ? 'bg-red-950/50 text-red-400 border border-red-800'
                : 'bg-neutral-800 text-neutral-400',
            ].join(' ')}
            title="Approximate token count — budget is 4000 tokens. Over budget triggers condensed mode."
          >
            ~{tokens.toLocaleString()} tok
          </span>
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={[
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              saved
                ? 'border-green-700 bg-green-900/40 text-green-300'
                : isDirty
                  ? 'border-blue-700 bg-blue-900/40 text-blue-200 hover:bg-blue-800/50'
                  : 'border-neutral-700 bg-neutral-800 text-neutral-500',
              'disabled:opacity-50',
            ].join(' ')}
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {saveErr && (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-400">
          {saveErr}
        </div>
      )}

      {overBudget && (
        <div className="rounded-md border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-400">
          Context exceeds the 4 000-token budget. Hub will condense to priority sections only
          (Active Projects, Commitments, Plural Self, Engineering Conventions, Decisions). Consider
          moving older entries to the Stale section.
        </div>
      )}

      {/* Section jump links */}
      <div className="flex flex-wrap gap-1.5">
        {SECTION_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              if (textareaRef.current && !showPreview) {
                jumpToSection(textareaRef.current, name)
              }
            }}
            className="rounded px-2 py-0.5 text-xs bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
          >
            {name}
          </button>
        ))}
      </div>

      {/* Editor / Preview */}
      {showPreview ? (
        <div className="flex-1 overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/30 p-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-200">
            {draft || <span className="text-neutral-500">(empty)</span>}
          </pre>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-[60vh] rounded-lg border border-neutral-800 bg-neutral-900/30 p-4 font-mono text-sm text-neutral-200 leading-relaxed resize-none focus:outline-none focus:border-neutral-600 transition-colors"
          placeholder="# context.md not found on server — save to create it."
        />
      )}

      <p className="text-xs text-neutral-600">
        Editing context.md directly on the server volume. Changes take effect on the next agent run.
        {updatedAt && <> Last saved: {new Date(updatedAt).toLocaleString()}.</>}
      </p>
    </div>
  )
}
