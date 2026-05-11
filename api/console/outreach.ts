import { requireHubAuth } from '../_lib/auth'
import {
  archiveOutreachEvent,
  ConsoleStoreError,
  createOutreachEvent,
  listOutreachEvents,
  parseOutreachCreateInput,
  parseOutreachPatchInput,
  updateOutreachEvent,
} from '../_lib/console-store'
import { badRequest, json, methodNotAllowed, readRequestObject } from '../_lib/http'
import { isSupabaseConfigured } from '../_lib/supabase'

export async function GET(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError
  if (!isSupabaseConfigured()) return supabaseNotConfigured()

  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '50')
  return json({
    rows: await listOutreachEvents(Number.isFinite(limit) ? Math.min(limit, 100) : 50),
  })
}

export async function POST(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError
  if (!isSupabaseConfigured()) return supabaseNotConfigured()

  const parsed = parseOutreachCreateInput(await readRequestObject(request))
  if ('error' in parsed) return badRequest(parsed.error)

  try {
    return json({ row: await createOutreachEvent(parsed.value) }, { status: 201 })
  } catch (error) {
    return storeError(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError
  if (!isSupabaseConfigured()) return supabaseNotConfigured()

  const parsed = parseOutreachPatchInput(await readRequestObject(request))
  if ('error' in parsed) return badRequest(parsed.error)

  try {
    return json({ row: await updateOutreachEvent(parsed.value) })
  } catch (error) {
    return storeError(error)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError
  if (!isSupabaseConfigured()) return supabaseNotConfigured()

  const body = await readRequestObject(request)
  const id = new URL(request.url).searchParams.get('id') ?? (body['id'] as string | undefined)
  if (!id) return badRequest('Outreach id is required.')

  try {
    return json({ row: await archiveOutreachEvent(id) })
  } catch (error) {
    return storeError(error)
  }
}

export function OPTIONS(): Response {
  return methodNotAllowed('OPTIONS', ['GET', 'POST', 'PATCH', 'DELETE'])
}

function supabaseNotConfigured(): Response {
  return json({ error: 'supabase_not_configured' }, { status: 503 })
}

function storeError(error: unknown): Response {
  if (error instanceof ConsoleStoreError) {
    return json({ error: 'console_store_error', message: error.message }, { status: error.status })
  }
  return json(
    {
      error: 'console_store_error',
      message: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  )
}
