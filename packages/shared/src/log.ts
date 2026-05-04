import pino, { type Logger, type LoggerOptions } from 'pino'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from './env.js'

/**
 * Redaction paths cover common secret-bearing fields. Pino redact does
 * structured-path masking; for free-text PII (SSN/account#) use the
 * `redactText` helper before logging.
 */
const REDACT_PATHS = [
  '*.token',
  '*.apiKey',
  '*.api_key',
  '*.password',
  '*.secret',
  '*.authorization',
  '*.Authorization',
  '*.bearer',
  'headers.authorization',
  'headers.Authorization',
  'env.*_TOKEN',
  'env.*_KEY',
  'env.*_SECRET',
  'env.*_PAT',
]

let rootLogger: Logger | undefined
let logFileStream: ReturnType<typeof pino.destination> | undefined

function buildRoot(): Logger {
  const env = loadEnv()
  mkdirSync(env.HUB_LOG_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const logFile = join(env.HUB_LOG_DIR, `${date}.log`)
  logFileStream = pino.destination({
    dest: logFile,
    mkdir: true,
    sync: process.env['NODE_ENV'] === 'test',
  })

  const opts: LoggerOptions = {
    level: env.HUB_LOG_LEVEL,
    redact: { paths: REDACT_PATHS, remove: false, censor: '[REDACTED]' },
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  return pino(
    opts,
    pino.multistream([
      { level: env.HUB_LOG_LEVEL, stream: logFileStream },
      { level: env.HUB_LOG_LEVEL, stream: process.stderr },
    ]),
  )
}

function resolveRoot(): Logger {
  if (!rootLogger) rootLogger = buildRoot()
  return rootLogger
}

/**
 * Returns a Logger-shaped proxy that defers `loadEnv()` and pino construction
 * until the first property access. Safe to assign at module top level — tests
 * can import modules that hold `const log = getLogger('x')` without first
 * seeding the env schema, which was the whole reason the v0.3 test suite
 * needed `_resetEnvCache()` gymnastics.
 */
export function getLogger(component?: string): Logger {
  let resolved: Logger | undefined
  const resolve = (): Logger => {
    if (!resolved) {
      resolved = component ? resolveRoot().child({ component }) : resolveRoot()
    }
    return resolved
  }
  return new Proxy({} as Logger, {
    get(_target, prop, receiver) {
      const real = resolve() as unknown as Record<string | symbol, unknown>
      const value = real[prop]
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(real)
      }
      return Reflect.get(real as object, prop, receiver)
    },
    has(_target, prop) {
      return prop in (resolve() as unknown as object)
    },
  })
}

/** Test hook: force the root logger to be rebuilt on next use. */
export function _resetLoggerCache(): void {
  rootLogger = undefined
  logFileStream?.flushSync()
  logFileStream?.end()
  logFileStream = undefined
}

/**
 * Free-text PII redactor for log messages. Conservative: matches obvious
 * SSN / account / card patterns. NOT a substitute for not logging the field
 * in the first place — use only as defense-in-depth.
 *
 * Edge-case test corpus lives in tests/redaction-corpus.
 */
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/\b\d{13,19}\b/g, '[ACCT]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[APIKEY]'],
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'],
]

export function redactText(input: string): string {
  let out = input
  for (const [re, sub] of PII_PATTERNS) out = out.replace(re, sub)
  return out
}
