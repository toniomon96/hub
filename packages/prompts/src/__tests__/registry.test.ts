import { it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRegistryFile } from '../registry.js'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-registry-test-'))
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const VALID_YAML = `
targets:
  - repo: org/my-repo
    targets:
      - prompt_id: daily-review
        trigger: "cron:0 9 * * 1-5"
        branch: main
        enabled: true
      - prompt_id: pr-check
        trigger: "event:pull_request"
        when_expr: "action == 'opened'"
        args:
          pr_number: 42
        enabled: true
`

it('parses a valid targets.yml', () => {
  const file = join(tmpDir, 'valid.yml')
  writeFileSync(file, VALID_YAML)

  const result = parseRegistryFile(file)
  expect(result.entries).toHaveLength(1)
  expect(result.entries[0]!.repo).toBe('org/my-repo')
  expect(result.entries[0]!.targets).toHaveLength(2)
  expect(result.entries[0]!.targets[0]!.prompt_id).toBe('daily-review')
  expect(result.entries[0]!.targets[0]!.trigger).toBe('cron:0 9 * * 1-5')
  expect(result.entries[0]!.targets[1]!.when_expr).toBe("action == 'opened'")
})

it('applies defaults: branch=main, enabled=true', () => {
  const file = join(tmpDir, 'defaults.yml')
  writeFileSync(
    file,
    `
targets:
  - repo: org/repo
    targets:
      - prompt_id: p1
        trigger: manual
`,
  )
  const result = parseRegistryFile(file)
  const t = result.entries[0]!.targets[0]!
  expect(t.branch).toBe('main')
  expect(t.enabled).toBe(true)
})

it('throws on YAML parse error', () => {
  const file = join(tmpDir, 'bad.yml')
  writeFileSync(file, 'targets: [invalid: yaml: here')
  expect(() => parseRegistryFile(file)).toThrow(/YAML parse error/)
})

it('throws on schema violation', () => {
  const file = join(tmpDir, 'schema-err.yml')
  writeFileSync(file, 'targets:\n  - repo: ""\n    targets: []\n')
  expect(() => parseRegistryFile(file)).toThrow(/Registry schema error/)
})

it('throws when file does not exist', () => {
  expect(() => parseRegistryFile(join(tmpDir, 'missing.yml'))).toThrow(/Cannot read registry file/)
})

it('handles multiple repo blocks', () => {
  const file = join(tmpDir, 'multi.yml')
  writeFileSync(
    file,
    `
targets:
  - repo: org/repo-a
    targets:
      - prompt_id: p1
        trigger: manual
  - repo: org/repo-b
    targets:
      - prompt_id: p2
        trigger: manual
`,
  )
  const result = parseRegistryFile(file)
  expect(result.entries).toHaveLength(2)
  expect(result.entries[0]!.repo).toBe('org/repo-a')
  expect(result.entries[1]!.repo).toBe('org/repo-b')
})
