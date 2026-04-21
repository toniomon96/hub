import { loadEnv } from './env.js'
import { getLogger } from './log.js'

const log = getLogger('ntfy')

export type NtfyPriority = 'min' | 'low' | 'default' | 'high' | 'max'

export interface NtfyMessage {
  title?: string
  body: string
  priority?: NtfyPriority
  tags?: string[]
  /** Override the topic (default: env.NTFY_TOPIC). */
  topic?: string
}

export interface PublishNtfyMessage {
  title?: string
  message: string
  /** ntfy priority 1 (min) … 5 (max). Omit for default (3). */
  priority?: 1 | 2 | 3 | 4 | 5
  tags?: string[]
  clickUrl?: string
}

export async function notify(msg: NtfyMessage): Promise<{ sent: boolean; reason?: string }> {
  const env = loadEnv()
  const topic = msg.topic ?? env.NTFY_TOPIC
  if (!topic) {
    log.debug({ title: msg.title }, 'ntfy not configured; skipping')
    return { sent: false, reason: 'NTFY_TOPIC not set' }
  }

  const url = `${env.NTFY_URL.replace(/\/$/, '')}/${topic}`
  const headers: Record<string, string> = { 'content-type': 'text/plain; charset=utf-8' }
  if (msg.title) headers['title'] = msg.title
  if (msg.priority) headers['priority'] = msg.priority
  if (msg.tags && msg.tags.length > 0) headers['tags'] = msg.tags.join(',')

  try {
    const res = await fetch(url, { method: 'POST', headers, body: msg.body })
    if (!res.ok) {
      log.warn({ status: res.status, url }, 'ntfy non-2xx')
      return { sent: false, reason: `http ${res.status}` }
    }
    log.info({ topic, title: msg.title, priority: msg.priority }, 'ntfy sent')
    return { sent: true }
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    log.warn({ err: m, url }, 'ntfy failed')
    return { sent: false, reason: m }
  }
}

/**
 * Publish a notification to the configured ntfy topic. Returns `false` when
 * `NTFY_TOPIC` is unset (no-op — ntfy is optional infra) or on transport
 * error; never throws. `fetchImpl` is injectable for tests.
 */
export async function publishNtfy(
  msg: PublishNtfyMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const env = loadEnv()
  if (!env.NTFY_TOPIC) return false

  const url = `${env.NTFY_URL.replace(/\/+$/, '')}/${env.NTFY_TOPIC}`
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
  }
  if (msg.title) headers['Title'] = msg.title
  if (msg.priority) headers['Priority'] = String(msg.priority)
  if (msg.tags?.length) headers['Tags'] = msg.tags.join(',')
  if (msg.clickUrl) headers['Click'] = msg.clickUrl

  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body: msg.message })
    if (!res.ok) {
      log.warn({ status: res.status, topic: env.NTFY_TOPIC }, 'ntfy publish non-200')
      return false
    }
    return true
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'ntfy publish failed')
    return false
  }
}
