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

test('unsupported features are reported, not dropped', () => {
  const patterns = ['a{2}', 'a{2,3}', '\\bx', 'x\\B', '(a)\\1', '\\k', '(?:a)', '(?=a)', 'a*?', 'a+?', 'a??', 'a*+', 'a**']
  for (const pattern of patterns) {
    assert.match(error(pattern).message, /^Unsupported/, pattern)
  }
})
