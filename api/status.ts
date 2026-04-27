import { requireHubAuth } from './_lib/auth'
import { loadHubStatus } from './_lib/hub-cloud-store'
import { json } from './_lib/http'

export async function GET(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError

  try {
    return json(await loadHubStatus())
  } catch (error) {
    return json(
      {
        error: 'status_unavailable',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    )
  }
}
