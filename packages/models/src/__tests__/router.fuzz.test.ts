import { describe, it, expect, beforeEach } from 'vitest'
import fc from 'fast-check'
import { route, detectSensitivity } from '../router.js'
import { _resetEnvCache } from '@hub/shared'

// Known-sensitive tokens used for property generators. Keep simple strings
// (no regex metacharacters) so we can interpolate them freely into arbitrary
// surrounding garbage.
const SENSITIVE_TOKENS = [
  'medical',
  'prescription',
  'ssn',
  'wife',
  'kid',
  'therapist',
  'diagnosis',
] as const
const PATTERNS = SENSITIVE_TOKENS.join(',')
const BASE_SENSITIVE_REGEXPS = [
  /salary/i,
  /ssn/i,
  /social.?security/i,
  /password/i,
  /credit.?card/i,
  /confidential/i,
  /hipaa/i,
  /\bphi\b/i,
  /bank.?account/i,
] as const

beforeEach(() => {
  _resetEnvCache()
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['ANTHROPIC_API_KEY'] = 'sk-test'
  process.env['HUB_SENSITIVITY_PATTERNS'] = PATTERNS
})

/**
 * Build a string that is guaranteed to contain at least one sensitive token.
 * The surrounding noise is arbitrary unicode + ascii + control chars so we
 * stress the regex + slicing code paths.
 */
const sensitiveInput = fc
  .tuple(fc.constantFrom(...SENSITIVE_TOKENS), fc.string(), fc.string(), fc.boolean())
  .map(([tok, before, after, upper]) => {
    const t = upper ? tok.toUpperCase() : tok
    return `${before} ${t} ${after}`
  })

/**
 * Build a string guaranteed NOT to contain any sensitive token. We filter
 * out any generated string whose lowercase contains a forbidden substring.
 */
const benignInput = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => {
  const lower = s.toLowerCase()
  return (
    !SENSITIVE_TOKENS.some((t) => lower.includes(t)) &&
    !BASE_SENSITIVE_REGEXPS.some((re) => re.test(s))
  )
})

const callerSensitivity = fc.option(
  fc.constantFrom('low', 'medium', 'high') as fc.Arbitrary<'low' | 'medium' | 'high'>,
)

describe('router fuzz — load-bearing privacy invariants', () => {
  it('INVARIANT: any input containing a sensitive token routes to ollama, no matter what the caller claims (10k samples)', () => {
    fc.assert(
      fc.property(sensitiveInput, callerSensitivity, fc.boolean(), (input, claim, forceLocal) => {
        const decision = route(
          { input, source: 'cli', forceLocal },
          claim ? { triage: { sensitivity: claim } } : {},
        )
        // The roadmap v0.5 #7 acceptance gate: sensitivity=high ⇒ vendor !== 'anthropic'.
        expect(decision.spec.provider).not.toBe('anthropic')
        expect(decision.spec.provider).toBe('ollama')
        expect(decision.triage.sensitivity).toBe('high')
        expect(decision.triage.localOnly).toBe(true)
      }),
      { numRuns: 10_000 },
    )
  })

  it('INVARIANT: forceLocal=true ALWAYS routes to ollama regardless of input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (input) => {
        const decision = route({ input, source: 'cli', forceLocal: true })
        expect(decision.spec.provider).toBe('ollama')
        expect(decision.triage.localOnly).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('INVARIANT: caller-supplied sensitivity can only RAISE, never lower regex result', () => {
    // When input matches patterns, regex says high. Caller claiming low/medium
    // must not shift the actual routing decision below high.
    fc.assert(
      fc.property(
        sensitiveInput,
        fc.constantFrom('low', 'medium') as fc.Arbitrary<'low' | 'medium'>,
        (input, claim) => {
          const decision = route(
            { input, source: 'cli', forceLocal: false },
            { triage: { sensitivity: claim } },
          )
          expect(decision.triage.sensitivity).toBe('high')
        },
      ),
      { numRuns: 300 },
    )
  })

  it('INVARIANT: caller claiming HIGH on benign input still gets local (monotonic upward)', () => {
    fc.assert(
      fc.property(benignInput, (input) => {
        const decision = route(
          { input, source: 'cli', forceLocal: false },
          { triage: { sensitivity: 'high' } },
        )
        expect(decision.triage.sensitivity).toBe('high')
        expect(decision.spec.provider).toBe('ollama')
      }),
      { numRuns: 200 },
    )
  })

  it('INVARIANT: benign input + no forceLocal + no caller override → never ollama-private model', () => {
    fc.assert(
      fc.property(benignInput, (input) => {
        const decision = route({ input, source: 'cli', forceLocal: false })
        // Must NOT be high sensitivity path
        expect(decision.triage.sensitivity).not.toBe('high')
      }),
      { numRuns: 300 },
    )
  })
})

describe('detectSensitivity fuzz — robustness', () => {
  it('never throws on arbitrary input strings (with configured patterns)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1000 }), (input) => {
        expect(() => detectSensitivity(input, PATTERNS)).not.toThrow()
      }),
      { numRuns: 500 },
    )
  })

  it('never throws on arbitrary pattern strings (including malformed regex)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 200 }), (input, pat) => {
        expect(() => detectSensitivity(input, pat)).not.toThrow()
      }),
      { numRuns: 500 },
    )
  })

  it('returns only one of {low, medium, high}', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), fc.string({ maxLength: 100 }), (input, pat) => {
        const result = detectSensitivity(input, pat)
        expect(['low', 'medium', 'high']).toContain(result)
      }),
      { numRuns: 500 },
    )
  })

  it('empty custom patterns return low outside the base sensitivity floor', () => {
    fc.assert(
      fc.property(benignInput, (input) => {
        expect(detectSensitivity(input, '')).toBe('low')
        expect(detectSensitivity(input, '   ')).toBe('low')
      }),
      { numRuns: 200 },
    )
  })
})
