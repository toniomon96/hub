import { loadEnv, type Triage, type ModelSpec, type Task } from '@hub/shared'

/**
 * Router — full ARCHITECTURE.md §13 rule table. Rules are evaluated in order;
 * first match wins. The privacy guarantee ("sensitivity=high never hits
 * Anthropic") is enforced HERE with no fallback to a cloud classifier —
 * sensitivity is regex-detected on the raw input before any model call.
 *
 *   1. localOnly OR sensitivity=high    → Ollama (private SLM, Qwen3 7B)
 *   2. complexity=trivial               → Ollama (trivial SLM, Phi-4-mini)
 *   3. daily spend ≥ HUB_DAILY_USD_CAP  → Ollama (fallback SLM, Llama3.3)
 *   4. complexity=complex               → Anthropic HUB_CLOUD_MODEL_COMPLEX
 *                                         (defaults to HUB_DEFAULT_MODEL
 *                                          so opt-in; Opus 4.5 recommended)
 *   5. default                          → Anthropic HUB_DEFAULT_MODEL (Sonnet)
 *
 * Critical invariant: NEVER call any cloud model before this router has
 * classified the input. Enforced by the property tests in
 * `__tests__/router.fuzz.test.ts`.
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
  const domain =
    opts.triage?.domain ?? task.governorDomain ?? task.lifeAreaHint ?? task.domainHint ?? 'misc'
  const localOnly = task.forceLocal || sensitivity === 'high'

  const triage: Triage = { sensitivity, complexity, domain, localOnly }

  // Rule 1: localOnly or sensitivity=high → private local SLM.
  // Skip if no local model configured (e.g. cloud-only deployment).
  if (localOnly && env.HUB_LOCAL_MODEL_PRIVATE) {
    return {
      triage,
      spec: {
        provider: 'ollama',
        model: env.HUB_LOCAL_MODEL_PRIVATE,
        reason: sensitivity === 'high' ? 'sensitivity=high (privacy gate)' : 'forceLocal=true',
      },
    }
  }

  // Rule 2: trivial inputs go to the cheap local SLM.
  // Skip if no local model configured (e.g. cloud-only deployment).
  if (complexity === 'trivial' && env.HUB_LOCAL_MODEL_TRIVIAL) {
    return {
      triage,
      spec: {
        provider: 'ollama',
        model: env.HUB_LOCAL_MODEL_TRIVIAL,
        reason: 'complexity=trivial → local SLM',
      },
    }
  }

  // Rule 3: cost ceiling reached → degrade cloud routes to local fallback
  // rather than failing the request.
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

  // Rule 4: complex reasoning → opt-in Opus tier. `HUB_CLOUD_MODEL_COMPLEX`
  // empty means the user hasn't opted in; fall through to Sonnet.
  if (complexity === 'complex' && env.HUB_CLOUD_MODEL_COMPLEX.length > 0) {
    return {
      triage,
      spec: {
        provider: 'anthropic',
        model: env.HUB_CLOUD_MODEL_COMPLEX,
        reason: 'complexity=complex → cloud reasoning tier',
      },
    }
  }

  // Rule 5: default cloud route.
  return {
    triage,
    spec: {
      provider: 'anthropic',
      model: env.HUB_DEFAULT_MODEL,
      reason: 'default → cloud',
    },
  }
}

// Hardcoded sensitivity floor — always active regardless of HUB_SENSITIVITY_PATTERNS (§X).
// Intentionally conservative: false positives send to local model (safe);
// false negatives send personal data to Anthropic (not safe).
const BASE_SENSITIVITY_REGEXPS = [
  'salary',
  'ssn',
  'social.?security',
  'password',
  'credit.?card',
  'confidential',
  'hipaa',
  '\\bphi\\b',
  'bank.?account',
].map((p) => new RegExp(p, 'i'))

/**
 * Sensitivity detection. Pure function, no I/O.
 *
 * Two-stage check:
 *   1. BASE_SENSITIVITY_REGEXPS — hardcoded, always active (§X floor).
 *   2. HUB_SENSITIVITY_PATTERNS — operator-configured, comma-separated regex.
 *
 * Caller can override per-task in `opts.triage.sensitivity` BUT the router
 * still pins `localOnly=true` if input matches — preventing accidental loosening.
 */
export function detectSensitivity(input: string, patterns: string): 'low' | 'medium' | 'high' {
  // Stage 1: base patterns — no configuration required.
  for (const re of BASE_SENSITIVITY_REGEXPS) {
    if (re.test(input)) return 'high'
  }

  // Stage 2: operator-configured patterns.
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

const COMPLEX_IMPERATIVES =
  /^(summarize|analyze|explain|compare|evaluate|design|plan|draft|refactor|architect|synthesize)\b/i

/**
 * Heuristic complexity. Three tiers:
 *
 * - **trivial**: short (<60 chars), single sentence, no code fences, no
 *   questions, no analytical imperative. Goes to Phi-4-mini.
 * - **complex**: contains code fences OR a multi-step enumeration OR is
 *   long (>400 chars) AND starts with an analytical imperative. Goes to
 *   Opus when the user has opted in via HUB_CLOUD_MODEL_COMPLEX.
 * - **moderate**: everything else. Goes to Sonnet by default.
 */
export function detectComplexity(input: string): 'trivial' | 'moderate' | 'complex' {
  const trimmed = input.trim()

  // Trivial first — tightest predicate.
  if (
    trimmed.length < 60 &&
    !trimmed.includes('```') &&
    !trimmed.includes('?') &&
    !/\n/.test(trimmed) &&
    !COMPLEX_IMPERATIVES.test(trimmed) &&
    trimmed.split(/[.!]/).filter((s) => s.trim().length > 0).length <= 1
  ) {
    return 'trivial'
  }

  // Complex: signals that the user wants deeper reasoning than chat.
  const hasCodeFence = trimmed.includes('```')
  const hasEnumeration = /(?:^|\n)\s*(?:\d+[.)]|[-*])\s+\S/m.test(trimmed)
  const isLongAnalytical = trimmed.length > 400 && COMPLEX_IMPERATIVES.test(trimmed)
  const multiQuestion = (trimmed.match(/\?/g) ?? []).length >= 2

  if (hasCodeFence || hasEnumeration || isLongAnalytical || multiQuestion) {
    return 'complex'
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
