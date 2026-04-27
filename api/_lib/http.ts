export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('cache-control', 'no-store')
  return headers
}

export function methodNotAllowed(method: string, allowed: string[]): Response {
  return json(
    { error: 'method_not_allowed', method, allowed },
    { status: 405, headers: { allow: allowed.join(', ') } },
  )
}

export function badRequest(message: string): Response {
  return json({ error: 'bad_request', message }, { status: 400 })
}

export async function readRequestObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => null)
    return isRecord(body) ? body : {}
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const form = await request.formData()
    const result: Record<string, unknown> = {}
    for (const [key, value] of form.entries()) {
      result[key] = typeof value === 'string' ? value : value.name
    }
    return result
  }

  const text = await request.text().catch(() => '')
  if (!text.trim()) return {}

  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function isFormSubmission(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? ''
  return (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  )
}

export function redirectBack(request: Request, fallback: string): Response {
  const referer = request.headers.get('referer')
  const destination = safeRedirectUrl(referer) ?? fallback
  const url = new URL(destination)
  url.searchParams.set('intake', 'sent')
  url.hash = 'contact'
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString(),
      'cache-control': 'no-store',
    },
  })
}

export function corsHeaders(request: Request): Headers {
  const headers = noStoreHeaders()
  const origin = request.headers.get('origin')
  const allowed = (process.env['CONSULTING_INTAKE_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'origin')
  }

  headers.set('access-control-allow-methods', 'POST, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type')
  return headers
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeRedirectUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') return null
    return parsed.toString()
  } catch {
    return null
  }
}
