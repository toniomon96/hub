import { parse } from 'yaml'
import { readFileSync } from 'node:fs'
import { RegistryFile } from './schema.js'
import type { RepoBlock } from './schema.js'

export interface ParseRegistryResult {
  entries: RepoBlock[]
}

/**
 * Parse hub-registry/targets.yml.
 * Throws on malformed YAML or schema violations — the registry is atomic,
 * so a partial result would be misleading.
 */
export function parseRegistryFile(filePath: string): ParseRegistryResult {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    throw new Error(
      `Cannot read registry file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let doc: unknown
  try {
    doc = parse(raw)
  } catch (err) {
    throw new Error(
      `YAML parse error in ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const result = RegistryFile.safeParse(doc)
  if (!result.success) {
    throw new Error(`Registry schema error in ${filePath}: ${result.error.message}`)
  }

  return { entries: result.data.targets }
}
