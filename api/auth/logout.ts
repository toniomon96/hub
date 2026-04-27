import { clearSessionCookie } from '../_lib/auth'
import { json } from '../_lib/http'

export function POST(): Response {
  return json(
    { ok: true },
    {
      headers: {
        'set-cookie': clearSessionCookie(),
      },
    },
  )
}

export function GET(): Response {
  return POST()
}
