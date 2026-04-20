import { ulid } from 'ulid'

/** Generate a new ULID. Use for run IDs, capture IDs, etc. */
export function newId(): string {
  return ulid()
}

/** Stable content hash (FNV-1a 32-bit hex) for dedup keys. Not crypto. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
