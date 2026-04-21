import { describe, it, expect } from 'vitest'
import { Parser } from 'expr-eval'

const parser = new Parser()

describe('when_expr evaluation via expr-eval', () => {
  it('evaluates arithmetic', () => {
    expect(parser.evaluate('2 + 3')).toBe(5)
    expect(parser.evaluate('10 % 3')).toBe(1)
  })

  it('evaluates comparison operators', () => {
    expect(parser.evaluate('x > 1', { x: 2 })).toBeTruthy()
    expect(parser.evaluate('x == 1', { x: 1 })).toBeTruthy()
    expect(parser.evaluate('x != 1', { x: 2 })).toBeTruthy()
    expect(parser.evaluate('x <= 3', { x: 3 })).toBeTruthy()
  })

  it('evaluates logical operators (expr-eval word form)', () => {
    expect(parser.evaluate('a and b', { a: 1, b: 1 })).toBeTruthy()
    expect(parser.evaluate('a and b', { a: 1, b: 0 })).toBeFalsy()
    expect(parser.evaluate('a or b', { a: 0, b: 1 })).toBeTruthy()
    expect(parser.evaluate('not a', { a: 0 })).toBeTruthy()
  })

  it('evaluates string equality via context variable', () => {
    expect(parser.evaluate('action == "opened"', { action: 'opened' })).toBeTruthy()
    expect(parser.evaluate('action == "opened"', { action: 'closed' })).toBeFalsy()
  })

  it('returns falsy when variable value is 0', () => {
    const result = parser.evaluate('pr_number > 0', { pr_number: 0 })
    expect(result).toBeFalsy()
  })

  it('throws on syntax error', () => {
    expect(() => parser.evaluate('???')).toThrow()
  })

  it('uses payload fields as context variables', () => {
    const context = { repo: 'org/my-repo', branch: 'main' }
    expect(parser.evaluate('branch == "main"', context)).toBeTruthy()
    expect(parser.evaluate('branch == "dev"', context)).toBeFalsy()
  })
})
