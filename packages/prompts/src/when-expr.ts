type Primitive = string | number | boolean | null | undefined

type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'operator'
  | 'leftParen'
  | 'rightParen'
  | 'eof'

interface Token {
  type: TokenType
  value: string
}

export type WhenContext = Record<string, unknown>

export function evaluateWhenExpression(expression: string, context: WhenContext = {}): Primitive {
  const parser = new Parser(tokenize(expression), context)
  return parser.parse()
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < expression.length) {
    const char = expression[index] ?? ''
    if (/\s/.test(char)) {
      index += 1
      continue
    }

    if (char === '(') {
      tokens.push({ type: 'leftParen', value: char })
      index += 1
      continue
    }

    if (char === ')') {
      tokens.push({ type: 'rightParen', value: char })
      index += 1
      continue
    }

    const twoChar = expression.slice(index, index + 2)
    if (['==', '!=', '<=', '>='].includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar })
      index += 2
      continue
    }

    if (['+', '-', '*', '/', '%', '<', '>'].includes(char)) {
      tokens.push({ type: 'operator', value: char })
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      const { value, nextIndex } = readString(expression, index)
      tokens.push({ type: 'string', value })
      index = nextIndex
      continue
    }

    if (/\d/.test(char)) {
      const match = expression.slice(index).match(/^\d+(?:\.\d+)?/)
      if (!match) {
        throw new Error(`Invalid number at position ${index}`)
      }
      const value = match[0]
      if (value === undefined) {
        throw new Error(`Invalid number at position ${index}`)
      }
      tokens.push({ type: 'number', value })
      index += value.length
      continue
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = expression.slice(index).match(/^[A-Za-z_][A-Za-z0-9_.]*/)
      if (!match) {
        throw new Error(`Invalid identifier at position ${index}`)
      }
      const value = match[0]
      if (value === undefined) {
        throw new Error(`Invalid identifier at position ${index}`)
      }
      if (['and', 'or', 'not'].includes(value)) {
        tokens.push({ type: 'operator', value })
      } else {
        tokens.push({ type: 'identifier', value })
      }
      index += value.length
      continue
    }

    throw new Error(`Unexpected token "${char}" at position ${index}`)
  }

  tokens.push({ type: 'eof', value: '' })
  return tokens
}

function readString(expression: string, startIndex: number): { value: string; nextIndex: number } {
  const quote = expression[startIndex]
  if (quote === undefined) {
    throw new Error('Missing string delimiter')
  }
  let value = ''
  let index = startIndex + 1

  while (index < expression.length) {
    const char = expression[index] ?? ''
    if (char === quote) {
      return { value, nextIndex: index + 1 }
    }

    if (char === '\\') {
      const next = expression[index + 1]
      if (next === undefined) {
        throw new Error('Unterminated escape sequence')
      }
      value += next
      index += 2
      continue
    }

    value += char
    index += 1
  }

  throw new Error('Unterminated string literal')
}

class Parser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly context: WhenContext,
  ) {}

  parse(): Primitive {
    const result = this.parseOr()
    this.expect('eof')
    return result
  }

  private parseOr(): Primitive {
    let left = this.parseAnd()
    while (this.matchOperator('or')) {
      const right = this.parseAnd()
      left = isTruthy(left) || isTruthy(right)
    }
    return left
  }

  private parseAnd(): Primitive {
    let left = this.parseNot()
    while (this.matchOperator('and')) {
      const right = this.parseNot()
      left = isTruthy(left) && isTruthy(right)
    }
    return left
  }

  private parseNot(): Primitive {
    if (this.matchOperator('not')) {
      return !isTruthy(this.parseNot())
    }
    return this.parseComparison()
  }

  private parseComparison(): Primitive {
    const left = this.parseAdditive()
    const token = this.peek()
    if (token.type === 'operator' && ['==', '!=', '<', '>', '<=', '>='].includes(token.value)) {
      this.advance()
      const right = this.parseAdditive()
      return compare(left, right, token.value)
    }
    return left
  }

  private parseAdditive(): Primitive {
    let left = this.parseMultiplicative()
    while (this.peek().type === 'operator' && ['+', '-'].includes(this.peek().value)) {
      const operator = this.advance().value
      const right = this.parseMultiplicative()
      left = operator === '+' ? toNumber(left) + toNumber(right) : toNumber(left) - toNumber(right)
    }
    return left
  }

  private parseMultiplicative(): Primitive {
    let left = this.parseUnary()
    while (this.peek().type === 'operator' && ['*', '/', '%'].includes(this.peek().value)) {
      const operator = this.advance().value
      const right = this.parseUnary()
      if (operator === '*') left = toNumber(left) * toNumber(right)
      if (operator === '/') left = toNumber(left) / toNumber(right)
      if (operator === '%') left = toNumber(left) % toNumber(right)
    }
    return left
  }

  private parseUnary(): Primitive {
    if (this.matchOperator('-')) {
      return -toNumber(this.parseUnary())
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Primitive {
    const token = this.advance()

    if (token.type === 'number') return Number(token.value)
    if (token.type === 'string') return token.value
    if (token.type === 'identifier') return this.resolveIdentifier(token.value)
    if (token.type === 'leftParen') {
      const value = this.parseOr()
      this.expect('rightParen')
      return value
    }

    throw new Error(`Expected expression, found "${token.value}"`)
  }

  private resolveIdentifier(name: string): Primitive {
    if (name === 'true') return true
    if (name === 'false') return false
    if (name === 'null') return null

    const parts = name.split('.')
    let value: unknown = this.context
    for (const part of parts) {
      if (value === null || typeof value !== 'object' || !(part in value)) {
        throw new Error(`Unknown identifier "${name}"`)
      }
      value = (value as Record<string, unknown>)[part]
    }

    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value
    }

    throw new Error(`Identifier "${name}" does not resolve to a primitive value`)
  }

  private matchOperator(value: string): boolean {
    const token = this.peek()
    if (token.type !== 'operator' || token.value !== value) {
      return false
    }
    this.advance()
    return true
  }

  private expect(type: TokenType): Token {
    const token = this.advance()
    if (token.type !== type) {
      throw new Error(`Expected ${type}, found "${token.value}"`)
    }
    return token
  }

  private advance(): Token {
    const token = this.tokens[this.index]
    if (!token) {
      throw new Error('Unexpected end of expression')
    }
    this.index += 1
    return token
  }

  private peek(): Token {
    const token = this.tokens[this.index]
    if (!token) {
      throw new Error('Unexpected end of expression')
    }
    return token
  }
}

function compare(left: Primitive, right: Primitive, operator: string): boolean {
  if (operator === '==') return left === right
  if (operator === '!=') return left !== right

  const leftNumber = toNumber(left)
  const rightNumber = toNumber(right)
  if (operator === '<') return leftNumber < rightNumber
  if (operator === '>') return leftNumber > rightNumber
  if (operator === '<=') return leftNumber <= rightNumber
  if (operator === '>=') return leftNumber >= rightNumber

  throw new Error(`Unsupported comparison operator "${operator}"`)
}

function toNumber(value: Primitive): number {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  throw new Error(`Expected numeric value, found ${String(value)}`)
}

function isTruthy(value: Primitive): boolean {
  return Boolean(value)
}
