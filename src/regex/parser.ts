// Hand-written recursive-descent regex parser.
// Precedence (highest to lowest): postfix * + ?, concatenation, alternation |.
// Matcher objects follow the regex-deep-dive visualizer JSON conventions.

export type CategoryName = 'digit' | 'word' | 'space'
export type AnchorName = 'start' | 'end'
export type AnchorLabel = '^' | '$'
export type QuantifierType = 'star' | 'plus' | 'optional'

export type LiteralMatcher = { kind: 'literal'; value: string }
export type AnyMatcher = { kind: 'any' }
export type CategoryMatcher = { kind: 'category'; name: CategoryName; negated: boolean }
export type RangeMatcher = { kind: 'range'; from: string; to: string }
export type ClassItem = LiteralMatcher | RangeMatcher | CategoryMatcher
export type ClassMatcher = { kind: 'class'; negated: boolean; items: ClassItem[] }
export type Matcher = LiteralMatcher | AnyMatcher | CategoryMatcher | ClassMatcher

type NodeBase = { id: string }

export type EmptyNode = NodeBase & { type: 'empty' }
export type CharNode = NodeBase & { type: 'char'; label: string; matcher: Matcher }
export type AssertionNode = NodeBase & { type: 'assertion'; name: AnchorName; label: AnchorLabel }
export type GroupNode = NodeBase & { type: 'group'; body: AstNode }
export type StarNode = NodeBase & { type: 'star'; body: AstNode }
export type PlusNode = NodeBase & { type: 'plus'; body: AstNode }
export type OptionalNode = NodeBase & { type: 'optional'; body: AstNode }
export type ConcatNode = NodeBase & { type: 'concat'; items: AstNode[] }
export type AlternationNode = NodeBase & { type: 'alternation'; alternatives: AstNode[] }
export type QuantifierNode = StarNode | PlusNode | OptionalNode

export type AstNode =
  | EmptyNode
  | CharNode
  | AssertionNode
  | GroupNode
  | StarNode
  | PlusNode
  | OptionalNode
  | ConcatNode
  | AlternationNode

export type ParseError = { message: string; index: number }

export type ParseResult = { ok: true; ast: AstNode } | { ok: false; error: ParseError }

const QUANTIFIERS = {
  '*': 'star',
  '+': 'plus',
  '?': 'optional',
} as const satisfies Record<string, QuantifierType>

type QuantifierChar = keyof typeof QUANTIFIERS

// Zero-width assertions (outside character classes only).
const ANCHORS = {
  '^': 'start',
  $: 'end',
} as const satisfies Record<string, AnchorName>

type AnchorChar = keyof typeof ANCHORS

const CATEGORIES = {
  d: { name: 'digit', negated: false },
  w: { name: 'word', negated: false },
  s: { name: 'space', negated: false },
  D: { name: 'digit', negated: true },
  W: { name: 'word', negated: true },
  S: { name: 'space', negated: true },
} as const satisfies Record<string, { name: CategoryName; negated: boolean }>

type CategoryChar = keyof typeof CATEGORIES

const CONTROL_ESCAPES = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v' } as const

type ControlEscapeChar = keyof typeof CONTROL_ESCAPES

function isQuantifier(ch: string | undefined): ch is QuantifierChar {
  return typeof ch === 'string' && ch in QUANTIFIERS
}

function isAnchor(ch: string | undefined): ch is AnchorChar {
  return typeof ch === 'string' && ch in ANCHORS
}

function isCategory(ch: string): ch is CategoryChar {
  return ch in CATEGORIES
}

function isControlEscape(ch: string): ch is ControlEscapeChar {
  return ch in CONTROL_ESCAPES
}

class RegexSyntaxError extends Error {
  readonly index: number

  constructor(message: string, index: number) {
    super(message)
    this.name = 'RegexSyntaxError'
    this.index = index
  }
}

export function parseRegex(pattern: string): ParseResult {
  try {
    return { ok: true, ast: new Parser(pattern).parse() }
  } catch (err) {
    if (err instanceof RegexSyntaxError) {
      return { ok: false, error: { message: err.message, index: err.index } }
    }
    throw err
  }
}

class Parser {
  private readonly src: string
  private pos = 0
  private nextId = 0

  constructor(pattern: string) {
    this.src = pattern
  }

  parse(): AstNode {
    const ast = this.parseAlternation()
    if (this.pos < this.src.length) {
      // parseAlternation only stops early on ')'
      this.fail("Unmatched ')'", this.pos)
    }
    return ast
  }

  private peek(): string | undefined {
    return this.pos < this.src.length ? this.src[this.pos] : undefined
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length
  }

  private fail(message: string, index = this.pos): never {
    throw new RegexSyntaxError(message, index)
  }

  private node(type: 'empty'): EmptyNode
  private node(type: 'concat', props: { items: AstNode[] }): ConcatNode
  private node(type: 'alternation', props: { alternatives: AstNode[] }): AlternationNode
  private node(type: 'group', props: { body: AstNode }): GroupNode
  private node(type: QuantifierType, props: { body: AstNode }): QuantifierNode
  private node(type: 'char', props: { label: string; matcher: Matcher }): CharNode
  private node(type: 'assertion', props: { name: AnchorName; label: AnchorLabel }): AssertionNode
  private node(type: AstNode['type'], props?: object): AstNode {
    // Overloads above check each call. The implementation only assembles the node.
    return Object.assign({ id: `n${this.nextId++}`, type }, props) as AstNode
  }

  // alternation := concat ('|' concat)*
  private parseAlternation(): AstNode {
    const alternatives = [this.parseConcat()]
    while (this.peek() === '|') {
      this.pos++
      alternatives.push(this.parseConcat())
    }
    const only = alternatives.at(0)
    if (alternatives.length === 1 && only !== undefined) return only
    return this.node('alternation', { alternatives })
  }

  // concat := repeat*
  private parseConcat(): AstNode {
    const items: AstNode[] = []
    while (!this.atEnd() && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseRepeat())
    }
    if (items.length === 0) return this.node('empty')
    const only = items.at(0)
    if (items.length === 1 && only !== undefined) return only
    return this.node('concat', { items })
  }

  // repeat := atom quantifier?
  private parseRepeat(): AstNode {
    let body = this.parseAtom()
    const ch = this.peek()
    if (isQuantifier(ch)) {
      // Anchors are zero-width, so there is nothing to repeat.
      if (body.type === 'assertion') this.fail('Nothing to repeat')
      this.pos++
      body = this.node(QUANTIFIERS[ch], { body })
      if (isQuantifier(this.peek())) {
        this.fail('Unsupported: lazy/possessive or stacked quantifiers are not supported')
      }
    }
    if (this.peek() === '{') {
      this.fail('Unsupported: counted repetition {m,n} is not supported')
    }
    return body
  }

  private parseAtom(): AstNode {
    const start = this.pos
    const ch = this.peek()
    if (ch === undefined) this.fail('Unexpected end of pattern')

    if (isQuantifier(ch)) this.fail('Nothing to repeat')
    if (ch === '{') this.fail('Unsupported: counted repetition {m,n} is not supported')

    if (isAnchor(ch)) {
      this.pos++
      return this.node('assertion', { name: ANCHORS[ch], label: ch })
    }

    if (ch === '(') {
      this.pos++
      if (this.peek() === '?') {
        this.fail('Unsupported: special groups and lookarounds (?...) are not supported')
      }
      const body = this.parseAlternation()
      if (this.peek() !== ')') this.fail("Missing ')'", start)
      this.pos++
      return this.node('group', { body })
    }

    if (ch === '[') return this.parseClass()

    if (ch === '.') {
      this.pos++
      return this.char('.', { kind: 'any' })
    }

    if (ch === '\\') {
      const matcher = this.parseEscape()
      return this.char(this.src.slice(start, this.pos), matcher)
    }

    this.pos++
    return this.char(ch, { kind: 'literal', value: ch })
  }

  private char(label: string, matcher: Matcher): CharNode {
    return this.node('char', { label, matcher })
  }

  // Parses an escape sequence starting at '\'. Returns a matcher.
  private parseEscape(): LiteralMatcher | CategoryMatcher {
    const start = this.pos
    this.pos++ // skip '\'
    if (this.atEnd()) this.fail('Trailing backslash', start)
    const ch = this.src[this.pos]
    if (ch === undefined) this.fail('Trailing backslash', start)
    this.pos++

    if (isCategory(ch)) {
      const category = CATEGORIES[ch]
      return { kind: 'category', name: category.name, negated: category.negated }
    }
    if (isControlEscape(ch)) return { kind: 'literal', value: CONTROL_ESCAPES[ch] }
    if (ch === 'b' || ch === 'B') {
      this.fail('Unsupported: word boundaries (\\b, \\B) are not supported', start)
    }
    if (/[1-9]/.test(ch)) this.fail('Unsupported: backreferences are not supported', start)
    if (/[A-Za-z0-9]/.test(ch)) this.fail(`Unsupported escape \\${ch}`, start)
    return { kind: 'literal', value: ch }
  }

  // class := '[' '^'? item+ ']'
  private parseClass(): CharNode {
    const start = this.pos
    this.pos++ // skip '['
    let negated = false
    if (this.peek() === '^') {
      negated = true
      this.pos++
    }

    const items: ClassItem[] = []
    while (this.peek() !== ']') {
      if (this.atEnd()) this.fail('Unterminated character class', start)
      const itemStart = this.pos
      const from = this.parseClassAtom()

      // Range: a literal followed by '-' and another atom (a trailing '-' is literal).
      const next = this.src[this.pos + 1]
      if (from.kind === 'literal' && this.peek() === '-' && next !== undefined && next !== ']') {
        this.pos++ // skip '-'
        const to = this.parseClassAtom()
        if (to.kind !== 'literal') this.fail('Invalid range: endpoints must be single characters', itemStart)
        if (from.value > to.value) this.fail(`Invalid range ${from.value}-${to.value}`, itemStart)
        items.push({ kind: 'range', from: from.value, to: to.value })
      } else {
        items.push(from)
      }
    }
    this.pos++ // skip ']'

    if (items.length === 0) this.fail('Empty character class', start)
    return this.char(this.src.slice(start, this.pos), { kind: 'class', negated, items })
  }

  private parseClassAtom(): LiteralMatcher | CategoryMatcher {
    if (this.peek() === '\\') return this.parseEscape()
    const ch = this.src[this.pos]
    if (ch === undefined) this.fail('Unterminated character class')
    this.pos++
    return { kind: 'literal', value: ch }
  }
}
