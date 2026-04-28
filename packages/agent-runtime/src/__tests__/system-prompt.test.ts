import { describe, expect, it } from 'vitest'
import { assembleSystemPrompt } from '../system-prompt.js'

describe('assembleSystemPrompt', () => {
  it('assembles north-star -> runtime policy -> context -> domain governor -> task prompt', () => {
    const prompt = assembleSystemPrompt({
      taskSpecific: 'Task-specific instruction.',
      mode: 'govern',
      lifeArea: 'family',
      governorDomain: 'family',
      projectRef: 'omnexus',
      appliedScopes: ['knowledge'],
      deniedScopes: [{ scope: 'tasks', reason: 'stored consent required before first use' }],
    })

    const northStarIdx = prompt.indexOf("You are Toni Montez's personal operating system")
    const runtimeIdx = prompt.indexOf('## Runtime Policy')
    const contextIdx = prompt.indexOf('## User Context')
    const governorIdx = prompt.indexOf('## Domain Governor')
    const taskIdx = prompt.indexOf('Task-specific instruction.')

    expect(northStarIdx).toBeGreaterThanOrEqual(0)
    expect(runtimeIdx).toBeGreaterThan(northStarIdx)
    expect(contextIdx).toBeGreaterThan(runtimeIdx)
    expect(governorIdx).toBeGreaterThan(contextIdx)
    expect(taskIdx).toBeGreaterThan(governorIdx)
    expect(prompt).toContain('# Hub Commandments')
    expect(prompt).toContain('Family: optimize for presence')
    expect(prompt).toContain('Denied scope tasks')
  })
})
