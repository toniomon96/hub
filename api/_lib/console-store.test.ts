import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSessionCookie,
  issueSessionCookie,
  verifyCookieValue,
  verifyHeaderToken,
} from './auth'
import {
  parseIntakeCreateInput,
  parseOutreachCreateInput,
  parseTodoCreateInput,
  parseTodoPatchInput,
} from './console-store'
import { parseRepoManifest, parseWeeklyLog } from './playbook'
import { parseWebhookSource, verifyWebhookRequest } from './webhook-auth'

describe('console Vercel API helpers', () => {
  afterEach(() => {
    delete process.env['HUB_UI_TOKEN']
    delete process.env['HUB_COOKIE_SECRET']
    delete process.env['HUB_WEBHOOK_SECRET']
  })

  it('validates the existing Hub header token without exposing it to the client', () => {
    process.env['HUB_UI_TOKEN'] = 'test-token'

    expect(verifyHeaderToken('test-token')).toBe(true)
    expect(verifyHeaderToken('wrong-token')).toBe(false)
  })

  it('validates signed Hub cookies using the shared cookie secret', () => {
    process.env['HUB_UI_TOKEN'] = 'test-token'
    process.env['HUB_COOKIE_SECRET'] = 'cookie-secret'
    const nonce = Buffer.from('0123456789abcdef')
    const signature = createHmac('sha256', 'cookie-secret').update(nonce).digest()
    const cookie = `${b64url(nonce)}.${b64url(signature)}`

    expect(verifyCookieValue(cookie)).toBe(true)
    expect(verifyCookieValue(`${b64url(nonce)}.${b64url(Buffer.alloc(32))}`)).toBe(false)
  })

  it('issues and clears Vercel session cookies for the existing Hub auth model', () => {
    process.env['HUB_UI_TOKEN'] = 'test-token'
    process.env['HUB_COOKIE_SECRET'] = 'cookie-secret'

    const cookie = issueSessionCookie(new Request('https://hub.example.com/auth/login'))
    const value = cookie.match(/^hub_ui=([^;]+)/)?.[1] ?? ''

    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(verifyCookieValue(decodeURIComponent(value))).toBe(true)
    expect(clearSessionCookie()).toContain('Max-Age=0')
  })

  it('defaults todo creation to the current operating week and high-level source', () => {
    const parsed = parseTodoCreateInput({ title: ' Send three referral DMs ', priority: 'high' })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        title: 'Send three referral DMs',
        priority: 'high',
        source: 'console',
      })
      expect(parsed.value.week_of).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('rejects malformed todo patch input before Supabase is touched', () => {
    const parsed = parseTodoPatchInput({ id: 'todo_1', status: 'blocked' })

    expect(parsed).toEqual({
      ok: false,
      error: 'Todo status must be open, done, or archived.',
    })
  })

  it('validates outreach rows with explicit statuses', () => {
    const parsed = parseOutreachCreateInput({
      name: 'Marcus T.',
      channel: 'LinkedIn DM',
      ask: 'Audit referral ask',
      status: 'sent',
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.happened_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(parsed.value.status).toBe('sent')
    }
  })

  it('rejects intake honeypot submissions', () => {
    const parsed = parseIntakeCreateInput({
      _gotcha: 'bot',
      name: 'Example',
      email: 'example@example.com',
      project: 'Workflow',
      messy_context: 'Messy',
      thirty_day_target: 'Cleaner',
    })

    expect(parsed).toEqual({ ok: false, error: 'Submission rejected.' })
  })

  it('accepts structured consulting triage and derives legacy summaries', () => {
    const parsed = parseIntakeCreateInput({
      name: 'Northline Owner',
      email: 'owner@example.com',
      phone: '214-555-0101',
      project_goal: 'An existing process that is messy or too manual.',
      offer_door: 'Improve The System.',
      primary_friction: 'Leads, clients, or tasks are falling through cracks.',
      current_state: 'A live business with manual workflows.',
      success_outcome: 'Better intake, follow-up, or handoff.',
      timeline: 'This month.',
      investment_readiness: 'I am looking for a focused Blueprint or diagnostic first.',
      call_context: 'Intake and follow-up depend on owner memory.',
      triage_version: 'practice-start-v1',
      source: 'tonimontez.co',
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        phone: '214-555-0101',
        project: 'An existing process that is messy or too manual.',
        project_goal: 'An existing process that is messy or too manual.',
        offer_door: 'Improve The System.',
        primary_friction: 'Leads, clients, or tasks are falling through cracks.',
        current_state: 'A live business with manual workflows.',
        success_outcome: 'Better intake, follow-up, or handoff.',
        timeline: 'This month.',
        investment_readiness: 'I am looking for a focused Blueprint or diagnostic first.',
        call_context: 'Intake and follow-up depend on owner memory.',
        triage_version: 'practice-start-v1',
      })
      expect(parsed.value.messy_context).toContain('friction: Leads, clients')
      expect(parsed.value.thirty_day_target).toContain('success: Better intake')
      expect(parsed.value.already_tried).toContain('current state: A live business')
    }
  })

  it('keeps older consulting form aliases compatible with the intake parser', () => {
    const parsed = parseIntakeCreateInput({
      name: 'Legacy Owner',
      email: 'legacy@example.com',
      project: 'Website and workflow cleanup',
      current_challenge: 'Everything lives in texts and spreadsheets.',
      current_site_or_tool: 'A partial website and a spreadsheet',
      success_target: 'A cleaner intake and booking path',
      timeline: 'This month',
      source: 'tonimontez.co',
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.project).toBe('Website and workflow cleanup')
      expect(parsed.value.messy_context).toContain('Everything lives in texts')
      expect(parsed.value.thirty_day_target).toContain('A cleaner intake')
      expect(parsed.value.current_state).toBe('A partial website and a spreadsheet')
    }
  })

  it('surfaces partial repo manifests instead of dropping the portfolio row', () => {
    const manifest = parseRepoManifest(
      'partial-repo',
      ['repo_id: partial-repo', 'display_name: "Partial Repo"', 'owner: toni'].join('\n'),
    )

    expect(manifest.repo_id).toBe('partial-repo')
    expect(manifest.validation_errors).toContain('missing required field: sensitivity_tier')
  })

  it('parses priority weekly checklist items from markdown source', () => {
    const weekly = parseWeeklyLog(`
## Week of 2026-04-27

- [ ] **Send three referral DMs**
  - Marcus
`)

    expect(weekly.items[0]).toMatchObject({
      text: 'Send three referral DMs',
      priority: true,
      checked: false,
      children: ['Marcus'],
    })
  })

  it('keeps Vercel webhook auth compatible with the legacy shared secret path', () => {
    process.env['HUB_WEBHOOK_SECRET'] = 'webhook-secret'

    expect(parseWebhookSource('manual')).toBe('manual')
    expect(
      verifyWebhookRequest('manual', new Headers({ 'x-hub-secret': 'webhook-secret' }), '{}'),
    ).toEqual({ ok: true })
    expect(verifyWebhookRequest('manual', new Headers({ 'x-hub-secret': 'nope' }), '{}')).toEqual({
      ok: false,
      status: 401,
      reason: 'bad_secret',
    })

    delete process.env['HUB_WEBHOOK_SECRET']
  })
})

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
