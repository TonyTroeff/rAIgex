import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseRegex,
  type AssertionNode,
  type AstNode,
  type CharNode,
  type ClassMatcher,
  type ConcatNode,
  type ParseError,
} from './parser.ts'

type Shaped<T> = T extends { id: string }
  ? { [K in keyof Omit<T, 'id'>]: Shaped<T[K]> }
  : T extends (infer U)[]
    ? Shaped<U>[]
    : T

type ShapedAst = Shaped<AstNode>

// Strip ids so tests compare structure only.
function shape<T>(value: T): Shaped<T> {
  if (Array.isArray(value)) return value.map((item) => shape(item)) as Shaped<T>
  if (value !== null && typeof value === 'object') {
    const shaped: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'id') continue
      shaped[key] = shape(nested)
    }
    return shaped as Shaped<T>
  }
  return value as Shaped<T>
}

function ast(pattern: string): ShapedAst {
  const result = parseRegex(pattern)
  assert.ok(result.ok, `expected ${pattern} to parse: ${result.ok ? '' : result.error.message}`)
  return shape(result.ast)
}

function error(pattern: string): ParseError {
  const result = parseRegex(pattern)
  assert.ok(!result.ok, `expected ${pattern} to fail`)
  return result.error
}

function expectChar(pattern: string): Shaped<CharNode> {
  const node = ast(pattern)
  assert.ok(node.type === 'char')
  return node
}

function expectClass(pattern: string): ClassMatcher {
  const matcher = expectChar(pattern).matcher
  assert.ok(matcher.kind === 'class')
  return matcher
}

function expectConcat(pattern: string): Shaped<ConcatNode> {
  const node = ast(pattern)
  assert.ok(node.type === 'concat')
  return node
}

const lit = (value: string): Shaped<CharNode> => ({
  type: 'char',
  label: value,
  matcher: { kind: 'literal', value },
})

test('postfix binds tighter than concatenation: ab*', () => {
  assert.deepEqual(ast('ab*'), { type: 'concat', items: [lit('a'), { type: 'star', body: lit('b') }] })
})

test('concatenation binds tighter than alternation: ab|c', () => {
  assert.deepEqual(ast('ab|c'), {
    type: 'alternation',
    alternatives: [{ type: 'concat', items: [lit('a'), lit('b')] }, lit('c')],
  })
})

test('(a|b)*abb', () => {
  assert.deepEqual(ast('(a|b)*abb'), {
    type: 'concat',
    items: [
      { type: 'star', body: { type: 'group', body: { type: 'alternation', alternatives: [lit('a'), lit('b')] } } },
      lit('a'),
      lit('b'),
      lit('b'),
    ],
  })
})

test('plus and optional', () => {
  assert.deepEqual(ast('a+b?'), {
    type: 'concat',
    items: [{ type: 'plus', body: lit('a') }, { type: 'optional', body: lit('b') }],
  })
})

test('dot, negated class with category, shorthand: .[^\\d]\\w', () => {
  assert.deepEqual(ast('.[^\\d]\\w'), {
    type: 'concat',
    items: [
      { type: 'char', label: '.', matcher: { kind: 'any' } },
      {
        type: 'char',
        label: '[^\\d]',
        matcher: { kind: 'class', negated: true, items: [{ kind: 'category', name: 'digit', negated: false }] },
      },
      { type: 'char', label: '\\w', matcher: { kind: 'category', name: 'word', negated: false } },
    ],
  })
})

test('negated shorthands', () => {
  assert.deepEqual(expectChar('\\S').matcher, { kind: 'category', name: 'space', negated: true })
})

test('class with ranges and literal', () => {
  assert.deepEqual(expectChar('[a-z0-9_]').matcher, {
    kind: 'class',
    negated: false,
    items: [
      { kind: 'range', from: 'a', to: 'z' },
      { kind: 'range', from: '0', to: '9' },
      { kind: 'literal', value: '_' },
    ],
  })
})

test('negated class [^abc]', () => {
  const matcher = expectClass('[^abc]')
  assert.equal(matcher.negated, true)
  assert.equal(matcher.items.length, 3)
})

test('leading/trailing dash in class is literal', () => {
  assert.deepEqual(expectClass('[-a-]').items, [
    { kind: 'literal', value: '-' },
    { kind: 'literal', value: 'a' },
    { kind: 'literal', value: '-' },
  ])
})

test('escaped metacharacters are literals', () => {
  assert.deepEqual(expectChar('\\.').matcher, { kind: 'literal', value: '.' })
  assert.deepEqual(
    expectClass('[\\]\\-\\^]').items.map((item) => {
      assert.ok(item.kind === 'literal')
      return item.value
    }),
    [']', '-', '^'],
  )
  assert.deepEqual(expectChar('\\t').matcher, { kind: 'literal', value: '\t' })
})

test('empty pattern, empty group and empty branches', () => {
  assert.deepEqual(ast(''), { type: 'empty' })
  assert.deepEqual(ast('()'), { type: 'group', body: { type: 'empty' } })
  assert.deepEqual(ast('a|'), { type: 'alternation', alternatives: [lit('a'), { type: 'empty' }] })
})

test('node ids are unique', () => {
  const result = parseRegex('(a|b)*[x-z]\\d')
  assert.ok(result.ok)
  const ids: string[] = []
  JSON.stringify(result.ast, (key, value: unknown) => {
    if (key === 'id' && typeof value === 'string') ids.push(value)
    return value
  })
  assert.equal(new Set(ids).size, ids.length)
})

const start = { type: 'assertion', name: 'start', label: '^' } as const satisfies Shaped<AssertionNode>
const end = { type: 'assertion', name: 'end', label: '$' } as const satisfies Shaped<AssertionNode>

test('anchors are assertion atoms: ^ab$', () => {
  assert.deepEqual(ast('^ab$'), { type: 'concat', items: [start, lit('a'), lit('b'), end] })
})

test('anchors bind inside alternation branches: ^ab|c$', () => {
  assert.deepEqual(ast('^ab|c$'), {
    type: 'alternation',
    alternatives: [
      { type: 'concat', items: [start, lit('a'), lit('b')] },
      { type: 'concat', items: [lit('c'), end] },
    ],
  })
})

test('anchors around a group and alone', () => {
  assert.deepEqual(expectConcat('^(a|b)$').items[1].type, 'group')
  assert.deepEqual(ast('^'), start)
  assert.deepEqual(ast('$'), end)
  assert.deepEqual(expectConcat('a^b').items[1], start)
})

test('^ and $ are literals inside a class or when escaped', () => {
  assert.deepEqual(expectChar('[a^$]').matcher, {
    kind: 'class',
    negated: false,
    items: [
      { kind: 'literal', value: 'a' },
      { kind: 'literal', value: '^' },
      { kind: 'literal', value: '$' },
    ],
  })
  assert.deepEqual(ast('\\^\\$'), {
    type: 'concat',
    items: [
      { type: 'char', label: '\\^', matcher: { kind: 'literal', value: '^' } },
      { type: 'char', label: '\\$', matcher: { kind: 'literal', value: '$' } },
    ],
  })
})

test('anchors cannot be quantified', () => {
  assert.deepEqual(error('^*a'), { message: 'Nothing to repeat', index: 1 })
  assert.deepEqual(error('a$+'), { message: 'Nothing to repeat', index: 2 })
})

test('structural errors', () => {
  assert.deepEqual(error('a)'), { message: "Unmatched ')'", index: 1 })
  assert.deepEqual(error('(a'), { message: "Missing ')'", index: 0 })
  assert.deepEqual(error('[abc'), { message: 'Unterminated character class', index: 0 })
  assert.deepEqual(error('[]'), { message: 'Empty character class', index: 0 })
  assert.deepEqual(error('*a'), { message: 'Nothing to repeat', index: 0 })
  assert.deepEqual(error('(+)'), { message: 'Nothing to repeat', index: 1 })
  assert.deepEqual(error('a|?'), { message: 'Nothing to repeat', index: 2 })
  assert.deepEqual(error('[z-a]'), { message: 'Invalid range z-a', index: 1 })
  assert.deepEqual(error('ab\\'), { message: 'Trailing backslash', index: 2 })
})

test('counted repetition {m}, {m,} and {m,n}', () => {
  assert.deepEqual(ast('a{3}'), { type: 'counted', min: 3, max: 3, body: lit('a') })
  assert.deepEqual(ast('a{2,}'), { type: 'counted', min: 2, max: null, body: lit('a') })
  assert.deepEqual(ast('a{0,5}'), { type: 'counted', min: 0, max: 5, body: lit('a') })
  assert.deepEqual(ast('a{007}'), { type: 'counted', min: 7, max: 7, body: lit('a') })
  assert.deepEqual(ast('(ab){2}c'), {
    type: 'concat',
    items: [{ type: 'counted', min: 2, max: 2, body: { type: 'group', body: { type: 'concat', items: [lit('a'), lit('b')] } } }, lit('c')],
  })
})

test('email pattern with an open-ended count', () => {
  const items = expectConcat('^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$').items
  assert.deepEqual(items.map((item) => item.type), ['assertion', 'plus', 'char', 'plus', 'char', 'counted', 'assertion'])
  assert.deepEqual(items[5], {
    type: 'counted',
    min: 2,
    max: null,
    body: {
      type: 'char',
      label: '[a-zA-Z]',
      matcher: { kind: 'class', negated: false, items: [{ kind: 'range', from: 'a', to: 'z' }, { kind: 'range', from: 'A', to: 'Z' }] },
    },
  })
})

const escaped = (value: string): Shaped<CharNode> => ({
  type: 'char',
  label: `\\${value}`,
  matcher: { kind: 'literal', value },
})

test('escaped braces and braces inside a class are literals', () => {
  assert.deepEqual(ast('\\{a\\}'), { type: 'concat', items: [escaped('{'), lit('a'), escaped('}')] })
  assert.deepEqual(ast('\\{2\\}*'), {
    type: 'concat',
    items: [escaped('{'), lit('2'), { type: 'star', body: escaped('}') }],
  })
  assert.deepEqual(ast('a\\{2,3\\}'), {
    type: 'concat',
    items: [lit('a'), escaped('{'), lit('2'), lit(','), lit('3'), escaped('}')],
  })
  assert.deepEqual(expectClass('[{}]').items, [
    { kind: 'literal', value: '{' },
    { kind: 'literal', value: '}' },
  ])
})

test('unescaped braces must form a valid count', () => {
  const invalid = 'Invalid counted repetition: expected {m}, {m,} or {m,n} (escape literal braces as \\{ and \\})'
  assert.deepEqual(error('{2}'), { message: 'Nothing to repeat', index: 0 })
  assert.deepEqual(error('a|{2}'), { message: 'Nothing to repeat', index: 2 })
  assert.deepEqual(error('^{2}'), { message: 'Nothing to repeat', index: 1 })
  assert.deepEqual(error('a}'), { message: "Unmatched '}'", index: 1 })
  assert.deepEqual(error('a\\{2}'), { message: "Unmatched '}'", index: 4 })
  for (const pattern of ['a{', 'a{}', 'a{,3}', 'a{2', 'a{2,3', 'a{x}', 'a{ 2}', 'a{2,x}']) {
    assert.deepEqual(error(pattern), { message: invalid, index: 1 }, pattern)
  }
  assert.deepEqual(error('a{3,2}'), { message: 'Invalid counted repetition {3,2}: minimum exceeds maximum', index: 1 })
})

test('named groups (?<name>...)', () => {
  assert.deepEqual(ast('(?<year>\\d{4})'), {
    type: 'group',
    name: 'year',
    body: { type: 'counted', min: 4, max: 4, body: { type: 'char', label: '\\d', matcher: { kind: 'category', name: 'digit', negated: false } } },
  })
  assert.deepEqual(ast('(?<_$a1>)+'), { type: 'plus', body: { type: 'group', name: '_$a1', body: { type: 'empty' } } })
  assert.deepEqual(ast('(?<outer>(?<inner>a)|b)'), {
    type: 'group',
    name: 'outer',
    body: { type: 'alternation', alternatives: [{ type: 'group', name: 'inner', body: lit('a') }, lit('b')] },
  })
  // Unnamed groups keep their original shape, without a name key.
  assert.equal('name' in expectConcat('(a)(?<b>b)').items[0], false)
})

test('email pattern with a named domain group', () => {
  const items = expectConcat('^[a-zA-Z0-9._%+-]+@(?<domain>[a-zA-Z0-9.-]+\\.[a-zA-Z])$').items
  assert.deepEqual(items.map((item) => item.type), ['assertion', 'plus', 'char', 'group', 'assertion'])
  const domain = items[3]
  assert.ok(domain.type === 'group')
  assert.equal(domain.name, 'domain')
  assert.ok(domain.body.type === 'concat')
  assert.deepEqual(domain.body.items.map((item) => item.type), ['plus', 'char', 'char'])
})

test('invalid group names', () => {
  const invalid = 'Invalid group name: use letters, digits, _ or $, not starting with a digit, followed by >'
  for (const pattern of ['(?<>a)', '(?<1a>a)', '(?<a-b>a)', '(?<a b>a)', '(?<name', '(?<']) {
    assert.deepEqual(error(pattern), { message: invalid, index: 3 }, pattern)
  }
  assert.deepEqual(error('(?<x>a)(?<x>b)'), { message: 'Duplicate group name "x"', index: 10 })
  assert.deepEqual(error('(?<x>a'), { message: "Missing ')'", index: 0 })
})

test('unsupported features are reported, not dropped', () => {
  const patterns = ['(?<=a)b', '(?<!a)b', '(?!a)', '(?i)a', '(?<x>a)\\k<x>', '(?', 'a{2}?','a{2}{3}', 'a*{2}', 'a{2}+','\\bx', 'x\\B', '(a)\\1', '\\k', '(?:a)', '(?=a)', 'a*?', 'a+?', 'a??', 'a*+', 'a**']
  for (const pattern of patterns) {
    assert.match(error(pattern).message, /^Unsupported/, pattern)
  }
})
