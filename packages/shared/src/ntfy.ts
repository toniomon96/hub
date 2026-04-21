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

/**
 * Post a notification to ntfy. No-op (logged at info) when NTFY_TOPIC is not
 * configured — alerting is opt-in. Never throws: alert delivery is best-effort.
 *
 * Server-side only. Don't use from the web UI.
 */
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
