import { parseWebhookSource, verifyWebhookRequest } from '../_lib/webhook-auth'
import { recordWebhook } from '../_lib/hub-cloud-store'
import { json } from '../_lib/http'

export async function POST(request: Request): Promise<Response> {
  const source = parseWebhookSource(routePart(request))
  if (!source) return json({ error: 'unknown_source' }, { status: 404 })

  const rawBody = await request.text()
  const auth = verifyWebhookRequest(source, request.headers, rawBody)
  if ('reason' in auth) return json({ error: auth.reason }, { status: auth.status })

  let payload: Record<string, unknown>
  try {
    payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
  } catch {
    return json({ error: 'invalid_json' }, { status: 400 })
  }

  try {
    const deliveryId =
      request.headers.get('x-hub-delivery') ??
      request.headers.get('x-github-delivery') ??
      (typeof payload['ref'] === 'string' ? payload['ref'] : null)
    const result = await recordWebhook(source, rawBody, payload, deliveryId)
    return json(result, { status: result.status === 'no_text_field' ? 400 : 202 })
  } catch (error) {
    return json(
      {
        error: 'webhook_store_error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export function GET(): Response {
  return json({ error: 'method_not_allowed', allowed: ['POST'] }, { status: 405 })
}

function routePart(request: Request): string | null {
  const path = new URL(request.url).pathname
  return path.split('/').filter(Boolean).at(-1) ?? null
}
