import { describe, it, expect } from 'vitest'
import { evaluateWhenExpression } from '../when-expr.js'

describe('when_expr evaluation', () => {
  it('evaluates arithmetic', () => {
    expect(evaluateWhenExpression('2 + 3')).toBe(5)
    expect(evaluateWhenExpression('10 % 3')).toBe(1)
  })

  it('evaluates comparison operators', () => {
    expect(evaluateWhenExpression('x > 1', { x: 2 })).toBeTruthy()
    expect(evaluateWhenExpression('x == 1', { x: 1 })).toBeTruthy()
    expect(evaluateWhenExpression('x != 1', { x: 2 })).toBeTruthy()
    expect(evaluateWhenExpression('x <= 3', { x: 3 })).toBeTruthy()
  })

  it('evaluates word-form logical operators', () => {
    expect(evaluateWhenExpression('a and b', { a: 1, b: 1 })).toBeTruthy()
    expect(evaluateWhenExpression('a and b', { a: 1, b: 0 })).toBeFalsy()
    expect(evaluateWhenExpression('a or b', { a: 0, b: 1 })).toBeTruthy()
    expect(evaluateWhenExpression('not a', { a: 0 })).toBeTruthy()
  })

  it('evaluates string equality via context variable', () => {
    expect(evaluateWhenExpression('action == "opened"', { action: 'opened' })).toBeTruthy()
    expect(evaluateWhenExpression('action == "opened"', { action: 'closed' })).toBeFalsy()
  })

  it('returns falsy when variable value is 0', () => {
    const result = evaluateWhenExpression('pr_number > 0', { pr_number: 0 })
    expect(result).toBeFalsy()
  })

  it('throws on syntax error', () => {
    expect(() => evaluateWhenExpression('???')).toThrow()
  })

  it('uses nested payload fields as context variables', () => {
    const context = { payload: { branch: 'main' }, branch: 'dev' }
    expect(evaluateWhenExpression('payload.branch == "main"', context)).toBeTruthy()
    expect(evaluateWhenExpression('branch == "main"', context)).toBeFalsy()
  })
})
