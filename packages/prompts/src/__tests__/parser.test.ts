import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePromptsDir } from '../parser.js'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'hub-parser-test-'))
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const VALID_MD = `---
id: test-prompt
version: 1
title: Test Prompt
description: A test prompt
sensitivity: low
complexity: standard
output_config: {}
---
Do the thing with {{repo}}.
`

it('parses a valid prompt markdown file', () => {
  const dir = join(tmpDir, 'valid')
  mkdirSync(dir)
  writeFileSync(join(dir, 'test.md'), VALID_MD)

  const result = parsePromptsDir(dir)
  expect(result.errors).toHaveLength(0)
  expect(result.prompts).toHaveLength(1)
  const p = result.prompts[0]!
  expect(p.frontmatter.id).toBe('test-prompt')
  expect(p.frontmatter.version).toBe(1)
  expect(p.frontmatter.sensitivity).toBe('low')
  expect(p.body).toBe('Do the thing with {{repo}}.')
})

it('accumulates error for missing required field, continues parsing others', () => {
  const dir = join(tmpDir, 'mixed')
  mkdirSync(dir)
  writeFileSync(
    join(dir, 'bad.md'),
    `---
id: bad
title: Bad
---
body
`,
  )
  writeFileSync(join(dir, 'good.md'), VALID_MD)

  const result = parsePromptsDir(dir)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]!.file).toBe('bad.md')
  expect(result.prompts).toHaveLength(1)
  expect(result.prompts[0]!.frontmatter.id).toBe('test-prompt')
})

it('ignores non-.md files', () => {
  const dir = join(tmpDir, 'ignore')
  mkdirSync(dir)
  writeFileSync(join(dir, 'readme.txt'), 'ignore me')
  writeFileSync(join(dir, 'test.md'), VALID_MD)

  const result = parsePromptsDir(dir)
  expect(result.prompts).toHaveLength(1)
  expect(result.errors).toHaveLength(0)
})

it('returns error when directory does not exist', () => {
  const result = parsePromptsDir(join(tmpDir, 'nonexistent'))
  expect(result.prompts).toHaveLength(0)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]!.error).toMatch(/cannot read directory/)
})

it('accepts all valid sensitivity and complexity values', () => {
  const dir = join(tmpDir, 'sensitivity')
  mkdirSync(dir)
  const variants = [
    ['low', 'trivial'],
    ['medium', 'standard'],
    ['high', 'complex'],
  ] as const
  variants.forEach(([sens, complex], i) => {
    writeFileSync(
      join(dir, `p${i}.md`),
      `---
id: prompt-${i}
version: 1
title: P${i}
description: desc
sensitivity: ${sens}
complexity: ${complex}
output_config: {}
---
body
`,
    )
  })
  const result = parsePromptsDir(dir)
  expect(result.errors).toHaveLength(0)
  expect(result.prompts).toHaveLength(3)
})
