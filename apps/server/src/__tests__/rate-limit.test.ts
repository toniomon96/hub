import { describe, it, expect, beforeEach } from 'vitest'
import { check, recordFailure, clear, _reset } from '../rate-limit.js'

describe('rate-limit (sliding window 5/min + 20/hr)', () => {
  beforeEach(() => {
    _reset()
  })

  it('allows first attempt', () => {
    const r = check('ip:1')
    expect(r.allowed).toBe(true)
    expect(r.remainingShort).toBe(5)
    expect(r.remainingLong).toBe(20)
  })

  it('blocks after 5 failures in a minute', () => {
    const t0 = 1_000_000_000_000
    for (let i = 0; i < 4; i++) {
      const r = recordFailure('ip:1', t0 + i * 1000)
      expect(r.allowed).toBe(true)
    }
    const fifth = recordFailure('ip:1', t0 + 4000)
    expect(fifth.allowed).toBe(false)
    expect(fifth.retryAfterSec).toBeGreaterThan(0)
  })

  it('unblocks after the short window rolls off', () => {
    const t0 = 1_000_000_000_000
    for (let i = 0; i < 5; i++) recordFailure('ip:2', t0 + i * 1000)
    // 5 attempts at t0..t0+4s; at t0+61s all are older than SHORT_MS (60s)
    const r = check('ip:2', t0 + 61_000)
    expect(r.allowed).toBe(true)
  })

  it('long window: 20 failures spread over an hour block', () => {
    const t0 = 1_000_000_000_000
    // 20 failures spaced 2 minutes apart — short window never trips (only 1
    // per 2 minutes), but long window hits exactly 20 at the final.
    for (let i = 0; i < 19; i++) {
      const r = recordFailure('ip:3', t0 + i * 120_000)
      expect(r.allowed).toBe(true)
    }
    const twentieth = recordFailure('ip:3', t0 + 19 * 120_000)
    expect(twentieth.allowed).toBe(false)
    expect(twentieth.remainingLong).toBe(0)
  })

  it('clear() resets the bucket', () => {
    const t0 = 1_000_000_000_000
    for (let i = 0; i < 5; i++) recordFailure('ip:4', t0 + i * 1000)
    expect(check('ip:4', t0 + 5000).allowed).toBe(false)
    clear('ip:4')
    expect(check('ip:4', t0 + 5000).allowed).toBe(true)
  })

  it('independent keys do not share buckets', () => {
    const t0 = 1_000_000_000_000
    for (let i = 0; i < 5; i++) recordFailure('ip:a', t0 + i * 1000)
    expect(check('ip:a', t0 + 5000).allowed).toBe(false)
    expect(check('ip:b', t0 + 5000).allowed).toBe(true)
  })
})
