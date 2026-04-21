import { describe, it, expect, beforeEach } from 'vitest'
import { route } from '../router.js'
import { _resetEnvCache } from '@hub/shared'

/**
 * Exhaustive rule-table matrix for ARCHITECTURE §13. Every combination of
 * (sensitivity, complexity, forceLocal, cost-cap-hit, HUB_CLOUD_MODEL_COMPLEX)
 * is asserted to land on exactly one rule. If a future rule reorder breaks
 * one of these rows, CI catches it before Anthropic sees private input.
 */

const PATTERNS = 'ssn,medical,wife'

beforeEach(() => {
  _resetEnvCache()
  process.env['HUB_SKIP_DOTENV'] = '1'
  process.env['ANTHROPIC_API_KEY'] = 'sk-test'
  process.env['HUB_SENSITIVITY_PATTERNS'] = PATTERNS
  process.env['HUB_DEFAULT_MODEL'] = 'claude-sonnet-4-5'
  process.env['HUB_CLOUD_MODEL_COMPLEX'] = ''
  process.env['HUB_DAILY_USD_CAP'] = '5'
  process.env['HUB_LOCAL_MODEL_TRIVIAL'] = 'phi4-mini'
  process.env['HUB_LOCAL_MODEL_PRIVATE'] = 'qwen3:7b'
  process.env['HUB_LOCAL_MODEL_FALLBACK'] = 'llama3.3'
})

// Inputs engineered to land in exactly one complexity tier.
const TRIVIAL = 'remind me to call Bob' // <60 chars, no ?, no fences, no imperatives
const MODERATE = 'what is the weather today in Chicago and should I wear a jacket'
const COMPLEX = '```\nfunction x() { return 1 }\n```\nrefactor this to async'
const SENSITIVE_COMPLEX = "```\nfunction x() {}\n```\nrefactor my wife's project"

describe('router rule-table matrix (ARCHITECTURE §13)', () => {
  it('Rule 1a: sensitivity=high (via regex) → ollama private, regardless of complexity', () => {
    for (const input of ['my ssn is 123', 'medical records', SENSITIVE_COMPLEX]) {
      const d = route({ input, source: 'cli', forceLocal: false })
      expect(d.spec.provider).toBe('ollama')
      expect(d.spec.model).toBe('qwen3:7b')
      expect(d.triage.sensitivity).toBe('high')
      expect(d.triage.localOnly).toBe(true)
    }
  })

  it('Rule 1b: forceLocal=true → ollama private even for benign complex input', () => {
    const d = route({ input: COMPLEX, source: 'cli', forceLocal: true })
    expect(d.spec.provider).toBe('ollama')
    expect(d.spec.model).toBe('qwen3:7b')
    expect(d.triage.localOnly).toBe(true)
  })

  it('Rule 2: complexity=trivial (benign) → ollama trivial', () => {
    const d = route({ input: TRIVIAL, source: 'cli', forceLocal: false })
    expect(d.spec.provider).toBe('ollama')
    expect(d.spec.model).toBe('phi4-mini')
    expect(d.triage.complexity).toBe('trivial')
  })

  it('Rule 3: cost cap reached → ollama fallback (preempts rules 4+5)', () => {
    const d = route({ input: MODERATE, source: 'cli', forceLocal: false }, { todaySpendUsd: 5 })
    expect(d.spec.provider).toBe('ollama')
    expect(d.spec.model).toBe('llama3.3')
    expect(d.spec.reason).toMatch(/cost cap/)
  })

  it('Rule 3 does NOT fire when HUB_DAILY_USD_CAP=0 (disabled)', () => {
    process.env['HUB_DAILY_USD_CAP'] = '0'
    _resetEnvCache()
    const d = route({ input: MODERATE, source: 'cli', forceLocal: false }, { todaySpendUsd: 1000 })
    expect(d.spec.provider).toBe('anthropic')
  })

  it('Rule 4: complexity=complex + HUB_CLOUD_MODEL_COMPLEX set → Opus', () => {
    process.env['HUB_CLOUD_MODEL_COMPLEX'] = 'claude-opus-4-5'
    _resetEnvCache()
    const d = route({ input: COMPLEX, source: 'cli', forceLocal: false })
    expect(d.spec.provider).toBe('anthropic')
    expect(d.spec.model).toBe('claude-opus-4-5')
    expect(d.triage.complexity).toBe('complex')
  })

  it('Rule 4 fall-through: complexity=complex but HUB_CLOUD_MODEL_COMPLEX unset → Sonnet', () => {
    // Default env (unset) preserves pre-v0.5 routing behavior.
    const d = route({ input: COMPLEX, source: 'cli', forceLocal: false })
    expect(d.spec.provider).toBe('anthropic')
    expect(d.spec.model).toBe('claude-sonnet-4-5')
    expect(d.triage.complexity).toBe('complex')
  })

  it('Rule 5: moderate benign input → Sonnet', () => {
    const d = route({ input: MODERATE, source: 'cli', forceLocal: false })
    expect(d.spec.provider).toBe('anthropic')
    expect(d.spec.model).toBe('claude-sonnet-4-5')
  })

  it('Rule precedence: sensitivity beats trivial (trivial-shaped sensitive input → ollama private)', () => {
    const d = route({ input: 'my ssn', source: 'cli', forceLocal: false })
    expect(d.spec.model).toBe('qwen3:7b') // private, not phi4-mini
  })

  it('Rule precedence: trivial beats cost cap (trivial never hits cloud so cap is irrelevant)', () => {
    const d = route({ input: TRIVIAL, source: 'cli', forceLocal: false }, { todaySpendUsd: 100 })
    expect(d.spec.model).toBe('phi4-mini')
  })

  it('Rule precedence: cost cap beats complex (cap downgrades cloud reasoning)', () => {
    process.env['HUB_CLOUD_MODEL_COMPLEX'] = 'claude-opus-4-5'
    _resetEnvCache()
    const d = route({ input: COMPLEX, source: 'cli', forceLocal: false }, { todaySpendUsd: 5 })
    expect(d.spec.model).toBe('llama3.3')
  })
})
