import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { seedTestEnv, restoreTestEnv } from '@hub/shared/testing/test-env'

/**
 * Smoke test for v0.5 #1: /api/openapi.json is served and lists every
 * route the UI + CLI expect to consume in v0.5 #2. Pinning the path set
 * catches accidental removals or renames.
 */
beforeEach(() => {
  seedTestEnv({
    HUB_UI_TOKEN: 'test-token',
    HUB_COOKIE_SECRET: 'test-cookie-secret-32chars-xxxxxxxxx',
  })
})
afterEach(() => {
  restoreTestEnv()
})

describe('GET /api/openapi.json', () => {
  it('lists every route the UI + CLI consume', async () => {
    const { api } = await import('../api.js')
    const res = await api.request('/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      info: { title: string }
      paths: Record<string, Record<string, unknown>>
      components?: { schemas?: Record<string, unknown> }
    }
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.info.title).toBe('Hub API')

    const expected: Array<[string, string]> = [
      ['/status', 'get'],
      ['/captures', 'get'],
      ['/captures', 'post'],
      ['/captures/{id}', 'get'],
      ['/ask', 'post'],
      ['/runs/{id}', 'get'],
      ['/briefings', 'get'],
      ['/briefings/{date}', 'get'],
      ['/settings', 'get'],
      ['/console/dashboard', 'get'],
      ['/console/roadmap', 'get'],
    ]
    for (const [path, method] of expected) {
      expect(doc.paths[path], `missing path ${path}`).toBeDefined()
      expect(doc.paths[path]?.[method], `missing ${method.toUpperCase()} ${path}`).toBeDefined()
    }

    // Named schemas — the generated client in PR #2 keys off these refs.
    const schemas = doc.components?.schemas ?? {}
    for (const name of [
      'StatusResponse',
      'CapturesList',
      'CaptureDetail',
      'CaptureCreateRequest',
      'CaptureCreateResponse',
      'AskRequest',
      'AskResponse',
      'RunDetail',
      'BriefingsList',
      'BriefingDetail',
      'Settings',
      'ErrorEnvelope',
    ]) {
      expect(schemas[name], `missing schema ${name}`).toBeDefined()
    }
  })
})
