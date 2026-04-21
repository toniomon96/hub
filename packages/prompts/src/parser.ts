import matter from 'gray-matter'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PromptFrontmatter } from './schema.js'
import type { PromptFrontmatter as FM } from './schema.js'

export interface ParsedPrompt {
  frontmatter: FM
  body: string
}

export interface ParsePromptsResult {
  prompts: ParsedPrompt[]
  errors: Array<{ file: string; error: string }>
}

/**
 * Parse all *.md files in `dir` as hub-prompts prompt definitions.
 * Malformed files are accumulated in `errors`; parsing continues for others.
 */
export function parsePromptsDir(dir: string): ParsePromptsResult {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { prompts: [], errors: [{ file: dir, error: `cannot read directory: ${msg}` }] }
  }

  const prompts: ParsedPrompt[] = []
  const errors: Array<{ file: string; error: string }> = []

  for (const file of files) {
    const filePath = join(dir, file)
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = matter(raw)
      const result = PromptFrontmatter.safeParse(parsed.data)
      if (!result.success) {
        errors.push({ file, error: result.error.message })
        continue
      }
      prompts.push({ frontmatter: result.data, body: parsed.content.trim() })
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { prompts, errors }
}
