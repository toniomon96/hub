import pino, { type Logger, type LoggerOptions } from 'pino'
import { createWriteStream, mkdirSync } from 'node:fs'
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

export function getLogger(component?: string): Logger {
  if (!rootLogger) {
    const env = loadEnv()
    mkdirSync(env.HUB_LOG_DIR, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const logFile = join(env.HUB_LOG_DIR, `${date}.log`)

    const opts: LoggerOptions = {
      level: env.HUB_LOG_LEVEL,
      redact: { paths: REDACT_PATHS, remove: false, censor: '[REDACTED]' },
      base: { pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
    }

    rootLogger = pino(
      opts,
      pino.multistream([
        { level: env.HUB_LOG_LEVEL, stream: createWriteStream(logFile, { flags: 'a' }) },
        { level: env.HUB_LOG_LEVEL, stream: process.stderr },
      ]),
    )
  }
  return component ? rootLogger.child({ component }) : rootLogger
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
