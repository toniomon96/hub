import { useState } from 'react'
import { api } from '../api.js'

type Signal = 'acted' | 'ignored' | 'wrong'
type SourceType = 'ask' | 'brief' | 'prompt_run'

interface FeedbackBarProps {
  sourceType: SourceType
  sourceId: string
}

const SIGNALS: { value: Signal; label: string; title: string; activeClass: string }[] = [
  {
    value: 'acted',
    label: '✓',
    title: 'I acted on this',
    activeClass: 'border-green-700 bg-green-900/50 text-green-300',
  },
  {
    value: 'ignored',
    label: '—',
    title: 'I ignored this',
    activeClass: 'border-neutral-600 bg-neutral-700 text-neutral-300',
  },
  {
    value: 'wrong',
    label: '✕',
    title: 'This was wrong',
    activeClass: 'border-red-800 bg-red-900/50 text-red-400',
  },
]

/**
 * Three-button feedback strip rendered below Ask responses and Brief sections.
 * Signals feed the feedback flywheel (Phase 8): feedback-review.md reads these
 * and proposes prompt revisions when acted rate drops below 30% over ≥10 runs.
 */
export function FeedbackBar({ sourceType, sourceId }: FeedbackBarProps) {
  const [selected, setSelected] = useState<Signal | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSignal(signal: Signal) {
    if (selected || loading) return
    setLoading(true)
    try {
      await api.feedbackCreate(sourceType, sourceId, signal)
      setSelected(signal)
    } catch {
      // Feedback is best-effort — don't disrupt the user for a logging failure.
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5 pt-2 mt-2 border-t border-neutral-800/60">
      <span className="text-xs text-neutral-600 mr-1">Useful?</span>
      {SIGNALS.map((s) => (
        <button
          key={s.value}
          type="button"
          title={s.title}
          disabled={loading || selected !== null}
          onClick={() => handleSignal(s.value)}
          className={[
            'w-7 h-7 rounded border text-xs font-mono transition-colors',
            selected === s.value
              ? s.activeClass
              : selected !== null
                ? 'border-neutral-800 text-neutral-700 cursor-default'
                : 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300',
          ].join(' ')}
        >
          {s.label}
        </button>
      ))}
      {selected && <span className="text-xs text-neutral-600 ml-1">Recorded.</span>}
    </div>
  )
}
