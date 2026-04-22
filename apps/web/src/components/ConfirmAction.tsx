import { useEffect, useRef, useState } from 'react'

interface ConfirmActionProps {
  action: string
  description: string
  onConfirm: () => void
  onCancel: () => void
  /** Countdown seconds. Defaults to 60. */
  countdownSeconds?: number
}

/**
 * Confirmation card for irreversible or external actions (Phase 10 / ETHOS §V, §XIV).
 * Auto-cancels after `countdownSeconds` if the user does nothing — inaction is not consent.
 * The Confirm button is the only path to execution.
 */
export function ConfirmAction({
  action,
  description,
  onConfirm,
  onCancel,
  countdownSeconds = 60,
}: ConfirmActionProps) {
  const [remaining, setRemaining] = useState(countdownSeconds)
  const confirmedRef = useRef(false)

  useEffect(() => {
    if (remaining <= 0) {
      if (!confirmedRef.current) {
        confirmedRef.current = true
        onCancel()
      }
      return
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000)
    return () => clearTimeout(id)
  }, [remaining, onConfirm])

  const pct = ((countdownSeconds - remaining) / countdownSeconds) * 100

  return (
    <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-amber-400">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm0 2.25a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4.75zm0 6a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">{action}</p>
          <p className="text-sm text-neutral-300 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>

      {/* Countdown progress bar */}
      <div className="space-y-1">
        <div className="h-1 w-full rounded-full bg-neutral-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-600 transition-all duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-neutral-500">
          Auto-cancels in {remaining}s — confirm now to proceed.
        </p>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            confirmedRef.current = true
            onConfirm()
          }}
          className="rounded-md border border-amber-700 bg-amber-900/50 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-800/50 transition-colors"
        >
          Confirm now
        </button>
      </div>
    </div>
  )
}
