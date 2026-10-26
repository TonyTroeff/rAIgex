// Hand-written recursive-descent regex parser.
// Precedence (highest to lowest): postfix * + ?, concatenation, alternation |.
// Matcher objects follow the regex-deep-dive visualizer JSON conventions.

const QUANTIFIERS = { '*': 'star', '+': 'plus', '?': 'optional' }

// Zero-width assertions (outside character classes only).
const ANCHORS = { '^': 'start', $: 'end' }

const CATEGORIES = {
  d: { name: 'digit', negated: false },
  w: { name: 'word', negated: false },
  s: { name: 'space', negated: false },
  D: { name: 'digit', negated: true },
  W: { name: 'word', negated: true },
  S: { name: 'space', negated: true },
}

const CONTROL_ESCAPES = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v' }

class RegexSyntaxError extends Error {
  constructor(message, index) {
    super(message)
    this.index = index
  }
}

export function parseRegex(pattern) {
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
  constructor(pattern) {
    this.src = pattern
    this.pos = 0
    this.nextId = 0
  }

  parse() {
    const ast = this.parseAlternation()
    if (this.pos < this.src.length) {
      // parseAlternation only stops early on ')'
      this.fail("Unmatched ')'", this.pos)
    }
    return ast
  }

  // --- helpers ---

  peek() {
    return this.src[this.pos]
  }

  atEnd() {
    return this.pos >= this.src.length
  }

  fail(message, index = this.pos) {
    throw new RegexSyntaxError(message, index)
  }

  node(type, props) {
    return { id: `n${this.nextId++}`, type, ...props }
  }

  // --- grammar ---

  // alternation := concat ('|' concat)*
  parseAlternation() {
    const alternatives = [this.parseConcat()]
    while (this.peek() === '|') {
      this.pos++
      alternatives.push(this.parseConcat())
    }
    return alternatives.length === 1 ? alternatives[0] : this.node('alternation', { alternatives })
  }

  // concat := repeat*
  parseConcat() {
    const items = []
    while (!this.atEnd() && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.parseRepeat())
    }
    if (items.length === 0) return this.node('empty')
    return items.length === 1 ? items[0] : this.node('concat', { items })
  }

  // repeat := atom quantifier?
  parseRepeat() {
    let body = this.parseAtom()
    const ch = this.peek()
    if (ch in QUANTIFIERS) {
      // Anchors are zero-width, so there is nothing to repeat.
      if (body.type === 'assertion') this.fail('Nothing to repeat')
      this.pos++
      body = this.node(QUANTIFIERS[ch], { body })
      const next = this.peek()
      if (next in QUANTIFIERS) {
        this.fail('Unsupported: lazy/possessive or stacked quantifiers are not supported')
      }
    }
    if (this.peek() === '{') {
      this.fail('Unsupported: counted repetition {m,n} is not supported')
    }
    return body
  }

  parseAtom() {
    const start = this.pos
    const ch = this.peek()

    if (ch in QUANTIFIERS) this.fail('Nothing to repeat')
    if (ch === '{') this.fail('Unsupported: counted repetition {m,n} is not supported')

    if (ch in ANCHORS) {
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

  char(label, matcher) {
    return this.node('char', { label, matcher })
  }

  // Parses an escape sequence starting at '\'. Returns a matcher.
  parseEscape() {
    const start = this.pos
    this.pos++ // skip '\'
    if (this.atEnd()) this.fail('Trailing backslash', start)
    const ch = this.src[this.pos++]

    if (ch in CATEGORIES) return { kind: 'category', ...CATEGORIES[ch] }
    if (ch in CONTROL_ESCAPES) return { kind: 'literal', value: CONTROL_ESCAPES[ch] }
    if (ch === 'b' || ch === 'B') {
      this.fail('Unsupported: word boundaries (\\b, \\B) are not supported', start)
    }
    if (/[1-9]/.test(ch)) this.fail('Unsupported: backreferences are not supported', start)
    if (/[A-Za-z0-9]/.test(ch)) this.fail(`Unsupported escape \\${ch}`, start)
    return { kind: 'literal', value: ch }
  }

  // class := '[' '^'? item+ ']'
  parseClass() {
    const start = this.pos
    this.pos++ // skip '['
    let negated = false
    if (this.peek() === '^') {
      negated = true
      this.pos++
    }

    const items = []
    while (this.peek() !== ']') {
      if (this.atEnd()) this.fail('Unterminated character class', start)
      const itemStart = this.pos
      const from = this.parseClassAtom()

      // Range: a literal followed by '-' and another atom (a trailing '-' is literal).
      const isRange =
        from.kind === 'literal' && this.peek() === '-' && this.src[this.pos + 1] !== undefined && this.src[this.pos + 1] !== ']'
      if (!isRange) {
        items.push(from)
        continue
      }
      this.pos++ // skip '-'
      const to = this.parseClassAtom()
      if (to.kind !== 'literal') this.fail('Invalid range: endpoints must be single characters', itemStart)
      if (from.value > to.value) this.fail(`Invalid range ${from.value}-${to.value}`, itemStart)
      items.push({ kind: 'range', from: from.value, to: to.value })
    }
    this.pos++ // skip ']'

    if (items.length === 0) this.fail('Empty character class', start)
    return this.char(this.src.slice(start, this.pos), { kind: 'class', negated, items })
  }

  parseClassAtom() {
    if (this.peek() === '\\') return this.parseEscape()
    return { kind: 'literal', value: this.src[this.pos++] }
  }
}
