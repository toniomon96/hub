import { createIntakeSubmission, parseIntakeCreateInput } from './_lib/console-store'
import {
  corsHeaders,
  isFormSubmission,
  json,
  methodNotAllowed,
  readRequestObject,
  redirectBack,
} from './_lib/http'
import { isSupabaseConfigured } from './_lib/supabase'

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export async function POST(request: Request): Promise<Response> {
  const formSubmission = isFormSubmission(request)
  const headers = corsHeaders(request)

  if (!isSupabaseConfigured()) {
    return json({ error: 'supabase_not_configured' }, { status: 503, headers })
  }

  const parsed = parseIntakeCreateInput(await readRequestObject(request))
  if (!parsed.ok) {
    return formSubmission
      ? redirectWithState(request, 'error')
      : json({ error: 'bad_request', message: parsed.error }, { status: 400, headers })
  }

  try {
    await createIntakeSubmission(parsed.value)
  } catch (error) {
    return formSubmission
      ? redirectWithState(request, 'error')
      : json(
          {
            error: 'intake_create_failed',
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 500, headers },
        )
  }

  if (formSubmission) {
    return redirectBack(
      request,
      process.env['CONSULTING_INTAKE_SUCCESS_URL'] ?? 'https://tonimontez.co/start',
    )
  }

  return json({ ok: true }, { status: 201, headers })
}

export function GET(): Response {
  return methodNotAllowed('GET', ['POST', 'OPTIONS'])
}

function redirectWithState(request: Request, state: string): Response {
  const referer = request.headers.get('referer')
  const destination = safeUrl(referer) ?? 'https://tonimontez.co/start'
  const url = new URL(destination)
  url.searchParams.set('intake', state)
  url.hash = 'contact'
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString(),
      'cache-control': 'no-store',
    },
  })
}

function safeUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.toString() : null
  } catch {
    return null
  }
}
