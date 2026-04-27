import { requireHubAuth } from '../_lib/auth'
import { json } from '../_lib/http'
import { loadPlaybookRoadmap } from '../_lib/playbook'

export async function GET(request: Request): Promise<Response> {
  const authError = requireHubAuth(request)
  if (authError) return authError

  try {
    return json(await loadPlaybookRoadmap())
  } catch (error) {
    return json({ error: 'console_roadmap_failed', message: errorMessage(error) }, { status: 500 })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
