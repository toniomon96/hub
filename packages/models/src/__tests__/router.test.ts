import { describe, it, expect, beforeEach } from 'vitest'
import { route, detectSensitivity, detectComplexity } from '../router.js'
import { _resetEnvCache } from '@hub/shared'

const TEST_ENV = {
  ANTHROPIC_API_KEY: 'sk-test',
  HUB_SENSITIVITY_PATTERNS: 'medical|prescription,SSN,bank.*account,wife|kid',
  HUB_SKIP_DOTENV: '1',
}

beforeEach(() => {
  _resetEnvCache()
  Object.assign(process.env, TEST_ENV)
})

describe('detectSensitivity', () => {
  it('returns high on pattern match (case-insensitive)', () => {
    expect(detectSensitivity('My SSN is bad', TEST_ENV.HUB_SENSITIVITY_PATTERNS)).toBe('high')
    expect(detectSensitivity('what did my wife say', TEST_ENV.HUB_SENSITIVITY_PATTERNS)).toBe(
      'high',
    )
    expect(
      detectSensitivity('check my bank account balance', TEST_ENV.HUB_SENSITIVITY_PATTERNS),
    ).toBe('high')
  })
  it('returns low when no pattern matches', () => {
    expect(detectSensitivity('what is the weather', TEST_ENV.HUB_SENSITIVITY_PATTERNS)).toBe('low')
  })
  it('returns low when no patterns configured (fresh install)', () => {
    expect(detectSensitivity('SSN 123-45-6789', '')).toBe('low')
  })
  it('skips invalid regex patterns silently', () => {
    // [invalid( is malformed; wife is valid; input contains "wife" so should hit
    expect(detectSensitivity('what did my wife say', '[invalid(,wife')).toBe('high')
  })
})

describe('detectComplexity', () => {
  it('flags short single-statement strings as trivial', () => {
    expect(detectComplexity('remind me to call Bob')).toBe('trivial')
  })
  it('flags long strings as moderate', () => {
    expect(detectComplexity('a'.repeat(200))).toBe('moderate')
  })
  it('flags questions as moderate', () => {
    expect(detectComplexity('what time is it?')).toBe('moderate')
  })
  it('flags code fences as moderate', () => {
    expect(detectComplexity('```\nx\n```')).toBe('moderate')
  })
})

describe('route — privacy gate (LOAD-BEARING)', () => {
  it('high-sensitivity → ollama, never anthropic', () => {
    const decision = route({ input: 'my prescription notes', source: 'cli', forceLocal: false })
    expect(decision.spec.provider).toBe('ollama')
    expect(decision.triage.sensitivity).toBe('high')
    expect(decision.triage.localOnly).toBe(true)
  })

  it('forceLocal=true → ollama even on benign input', () => {
    const decision = route({ input: 'hello world', source: 'cli', forceLocal: true })
    expect(decision.spec.provider).toBe('ollama')
  })

  it('caller cannot override sensitivity downward when input matches (LOAD-BEARING)', () => {
    // Even if a caller (e.g., a misbehaving classifier) claims sensitivity=low,
    // the regex result wins via maxSensitivity. This is the unbypassable gate.
    const decision = route(
      { input: 'my SSN is sensitive', source: 'cli', forceLocal: false },
      { triage: { sensitivity: 'low' } },
    )
    expect(decision.triage.sensitivity).toBe('high')
    expect(decision.triage.localOnly).toBe(true)
    expect(decision.spec.provider).toBe('ollama')
  })

  it('trivial benign input → ollama trivial model', () => {
    const decision = route({ input: 'remind me to call Bob', source: 'cli', forceLocal: false })
    expect(decision.spec.provider).toBe('ollama')
    expect(decision.spec.model).toBe('phi4-mini')
  })

  it('moderate benign input → anthropic default', () => {
    const decision = route({
      input: 'Summarize the implications of switching from Postgres to SQLite for our project.',
      source: 'cli',
      forceLocal: false,
    })
    expect(decision.spec.provider).toBe('anthropic')
  })
})

describe('route — daily cost cap', () => {
  it('spend below cap still routes to anthropic', () => {
    process.env['HUB_DAILY_USD_CAP'] = '5'
    _resetEnvCache()
    const decision = route(
      {
        input: 'Summarize the implications of switching from Postgres to SQLite for our project.',
        source: 'cli',
        forceLocal: false,
      },
      { todaySpendUsd: 2.5 },
    )
    expect(decision.spec.provider).toBe('anthropic')
  })

  it('spend at/above cap downgrades cloud routes to local fallback', () => {
    process.env['HUB_DAILY_USD_CAP'] = '5'
    _resetEnvCache()
    const decision = route(
      {
        input: 'Summarize the implications of switching from Postgres to SQLite for our project.',
        source: 'cli',
        forceLocal: false,
      },
      { todaySpendUsd: 5 },
    )
    expect(decision.spec.provider).toBe('ollama')
    expect(decision.spec.model).toBe('llama3.3')
    expect(decision.spec.reason).toMatch(/cost cap/i)
  })

  it('cap is not checked before the privacy gate (high-sens still goes to private model)', () => {
    process.env['HUB_DAILY_USD_CAP'] = '5'
    _resetEnvCache()
    const decision = route(
      { input: 'my prescription notes', source: 'cli', forceLocal: false },
      { todaySpendUsd: 100 },
    )
    expect(decision.spec.provider).toBe('ollama')
    // Privacy route uses PRIVATE model, not FALLBACK — cap didn't short-circuit.
    expect(decision.spec.model).toBe('qwen3:7b')
  })

  it('cap of 0 disables enforcement entirely', () => {
    process.env['HUB_DAILY_USD_CAP'] = '0'
    _resetEnvCache()
    const decision = route(
      {
        input: 'Summarize the implications of switching from Postgres to SQLite for our project.',
        source: 'cli',
        forceLocal: false,
      },
      { todaySpendUsd: 9999 },
    )
    expect(decision.spec.provider).toBe('anthropic')
  })
})
