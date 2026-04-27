import { describe, expect, it } from 'vitest'
import { parseOutreachLog, parseRepoManifest, parseWeeklyLog } from '../console-data.js'

describe('console data parsers', () => {
  it('reports partial repo manifests instead of rejecting them', () => {
    const manifest = parseRepoManifest(
      'partial-repo',
      [
        'repo_id: partial-repo',
        'display_name: "Partial Repo"',
        'repo_type: internal-platform',
        'owner: toni',
      ].join('\n'),
    )

    expect(manifest.folder).toBe('partial-repo')
    expect(manifest.repo_id).toBe('partial-repo')
    expect(manifest.display_name).toBe('Partial Repo')
    expect(manifest.validation_errors).toContain('missing required field: sensitivity_tier')
    expect(manifest.validation_errors).toContain(
      'missing required field: allowed_context_consumers',
    )
  })

  it('parses the current weekly checklist and priority markers', () => {
    const weekly = parseWeeklyLog(`
## Week of 2026-04-20

- [x] Old done item

## Week of 2026-04-27

- [x] Ship docs
- [ ] **Send three referral DMs**
  - Marcus
  - Priya
`)

    expect(weekly.weekOf).toBe('2026-04-27')
    expect(weekly.items).toHaveLength(2)
    expect(weekly.items[1]).toMatchObject({
      text: 'Send three referral DMs',
      checked: false,
      priority: true,
      children: ['Marcus', 'Priya'],
    })
  })

  it('parses outreach rows and ignores the commented examples', () => {
    const rows = parseOutreachLog(`
| Date | Name | Channel | Ask | Status | Notes |
|---|---|---|---|---|---|
| 2026-04-27 | Marcus T. | LinkedIn DM | Audit referral ask | Sent | First pass |

<!--
| 2026-04-27 | Example | Email | Example | Sent | Do not count |
-->
`)

    expect(rows).toEqual([
      {
        date: '2026-04-27',
        name: 'Marcus T.',
        channel: 'LinkedIn DM',
        ask: 'Audit referral ask',
        status: 'Sent',
        notes: 'First pass',
      },
    ])
  })
})
