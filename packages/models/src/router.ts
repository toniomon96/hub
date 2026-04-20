import { loadEnv, type Triage, type ModelSpec, type Task } from '@hub/shared'

/**
 * MVP Router — minimal but real (LOAD-BEARING v0.3 fix #1).
 *
 * Four rules, evaluated in order. First match wins. The privacy guarantee
 * ("sensitivity=high never hits Anthropic") is enforced HERE, day one, with
 * no fallback to a cloud classifier — sensitivity is computed by regex on the
 * raw input string before any model call.
 *
 *   1. localOnly OR sensitivity=high  → local SLM (Qwen3 7B by default)
 *   2. complexity=trivial             → local SLM (Phi-4-mini)
 *   3. cost cap reached for today     → local SLM (fallback, Llama3.3)
 *   4. default                        → Anthropic Sonnet
 *
 * V1 expands to the full table from ARCHITECTURE.md §13.
 *
 * Critical invariant: NEVER call any cloud model (Anthropic/OpenAI/etc.)
 * before this router has classified the input. Tested via network mock in
 * tests/router.privacy.test.ts.
 */

export interface RouterDecision {
  spec: ModelSpec
  triage: Triage
}

export interface RouteOpts {
  triage?: Partial<Triage>
  /**
   * Current USD spent today (all providers) as seen by the caller.
   * When `>= HUB_DAILY_USD_CAP` the router downgrades cloud routes to the
   * local fallback model. Omitted → treated as 0 (no cap enforcement).
   * This stays an input (not a DB call from the router) so `route()` remains
   * pure and sync; callers query spend once per invocation.
   */
  todaySpendUsd?: number
}

export function route(task: Task, opts: RouteOpts = {}): RouterDecision {
  const env = loadEnv()

  // 1. Compute sensitivity FIRST, locally, by regex. ALWAYS run the regex —
  //    a caller-supplied triage override can RAISE sensitivity but never
  //    lower it below the regex result. This makes the gate unbypassable.
  const regexSens = detectSensitivity(task.input, env.HUB_SENSITIVITY_PATTERNS)
  const callerSens = opts.triage?.sensitivity
  const sensitivity = maxSensitivity(regexSens, callerSens)
  const complexity = opts.triage?.complexity ?? detectComplexity(task.input)
  const domain = opts.triage?.domain ?? task.domainHint ?? 'misc'
  const localOnly = task.forceLocal || sensitivity === 'high'

  const triage: Triage = { sensitivity, complexity, domain, localOnly }

  // 2. Apply rules in order.
  if (localOnly) {
    return {
      triage,
      spec: {
        provider: 'ollama',
        model: env.HUB_LOCAL_MODEL_PRIVATE,
        reason: sensitivity === 'high' ? 'sensitivity=high (privacy gate)' : 'forceLocal=true',
      },
    }
  }

  if (complexity === 'trivial') {
    return {
      triage,
      spec: {
        provider: 'ollama',
        model: env.HUB_LOCAL_MODEL_TRIVIAL,
        reason: 'complexity=trivial → local SLM',
      },
    }
  }

  // 3. Cost ceiling — spend tracked today reached the cap.
  //    Degrade silently to local fallback rather than failing the request.
  const spend = opts.todaySpendUsd ?? 0
  if (env.HUB_DAILY_USD_CAP > 0 && spend >= env.HUB_DAILY_USD_CAP) {
    return {
      triage,
      spec: {
        provider: 'ollama',
        model: env.HUB_LOCAL_MODEL_FALLBACK,
        reason: `daily cost cap reached ($${spend.toFixed(2)} ≥ $${env.HUB_DAILY_USD_CAP.toFixed(2)}) → local fallback`,
      },
    }
  }

  return {
    triage,
    spec: {
      provider: 'anthropic',
      model: env.HUB_DEFAULT_MODEL,
      reason: 'default → cloud',
    },
  }
}

/**
 * Sensitivity detection. Pure function, no I/O.
 *
 * Pattern source: env HUB_SENSITIVITY_PATTERNS (comma-separated regex).
 * Caller can override per-task in `opts.triage.sensitivity` BUT the router
 * still pins `localOnly=true` if input matches — preventing accidental loosening.
 *
 * Default behavior on uncertainty: caller did not supply patterns → 'low'.
 * This is the right default for an empty inbox / fresh install. Once the user
 * configures patterns, the gate is meaningful.
 */
export function detectSensitivity(input: string, patterns: string): 'low' | 'medium' | 'high' {
  if (!patterns.trim()) return 'low'
  const groups = patterns
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  for (const g of groups) {
    try {
      if (new RegExp(g, 'i').test(input)) return 'high'
    } catch {
      // skip invalid patterns; surface via lint job not here
    }
  }
  return 'low'
}

/**
 * Heuristic complexity. Trivial = short, no question marks, no code fences,
 * no enumerations, single sentence. Everything else is moderate at MVP.
 * The 'complex' tier ships in V1 alongside the full router rule table.
 */
export function detectComplexity(input: string): 'trivial' | 'moderate' | 'complex' {
  const trimmed = input.trim()
  // Trivial: short imperative-style or simple statement. Tightened to 60 chars
  // because longer prose is usually not trivial even if it parses as one sentence.
  if (
    trimmed.length < 60 &&
    !trimmed.includes('```') &&
    !trimmed.includes('?') &&
    !/\n/.test(trimmed) &&
    !/^(summarize|analyze|explain|compare|evaluate|design|plan|draft)\b/i.test(trimmed) &&
    trimmed.split(/[.!]/).filter((s) => s.trim().length > 0).length <= 1
  ) {
    return 'trivial'
  }
  return 'moderate'
}

const SENS_RANK = { low: 0, medium: 1, high: 2 } as const

function maxSensitivity(
  a: 'low' | 'medium' | 'high',
  b: 'low' | 'medium' | 'high' | undefined,
): 'low' | 'medium' | 'high' {
  if (!b) return a
  return SENS_RANK[a] >= SENS_RANK[b] ? a : b
}
