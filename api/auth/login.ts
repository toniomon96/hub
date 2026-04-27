import { issueSessionCookie, verifyHeaderToken } from '../_lib/auth'
import { badRequest, json, readRequestObject } from '../_lib/http'

export async function POST(request: Request): Promise<Response> {
  if (!process.env['HUB_UI_TOKEN']) {
    return json({ error: 'ui_not_configured' }, { status: 503 })
  }

  const body = await readRequestObject(request)
  const token = typeof body['token'] === 'string' ? body['token'] : ''
  if (!token) return badRequest('Token is required.')
  if (!verifyHeaderToken(token)) return json({ error: 'unauthorized' }, { status: 401 })

  return json(
    { ok: true },
    {
      headers: {
        'set-cookie': issueSessionCookie(request),
      },
    },
  )
}

export function GET(): Response {
  return json({ error: 'method_not_allowed', allowed: ['POST'] }, { status: 405 })
}
