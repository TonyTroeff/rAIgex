import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRegex } from './parser.js'

// Strip ids so tests compare structure only.
function shape(node) {
  if (Array.isArray(node)) return node.map(shape)
  if (node && typeof node === 'object') {
    const { id, ...rest } = node
    return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, shape(v)]))
  }
  return node
}

function ast(pattern) {
  const result = parseRegex(pattern)
  assert.ok(result.ok, `expected ${pattern} to parse: ${result.error?.message}`)
  return shape(result.ast)
}

function error(pattern) {
  const result = parseRegex(pattern)
  assert.ok(!result.ok, `expected ${pattern} to fail`)
  return result.error
}

const lit = (value) => ({ type: 'char', label: value, matcher: { kind: 'literal', value } })

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
  assert.deepEqual(ast('\\S').matcher, { kind: 'category', name: 'space', negated: true })
})

test('class with ranges and literal', () => {
  assert.deepEqual(ast('[a-z0-9_]').matcher, {
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
  const m = ast('[^abc]').matcher
  assert.equal(m.negated, true)
  assert.equal(m.items.length, 3)
})

test('leading/trailing dash in class is literal', () => {
  assert.deepEqual(ast('[-a-]').matcher.items, [
    { kind: 'literal', value: '-' },
    { kind: 'literal', value: 'a' },
    { kind: 'literal', value: '-' },
  ])
})

test('escaped metacharacters are literals', () => {
  assert.deepEqual(ast('\\.').matcher, { kind: 'literal', value: '.' })
  assert.deepEqual(ast('[\\]\\-\\^]').matcher.items.map((i) => i.value), [']', '-', '^'])
  assert.deepEqual(ast('\\t').matcher, { kind: 'literal', value: '\t' })
})

test('empty pattern, empty group and empty branches', () => {
  assert.deepEqual(ast(''), { type: 'empty' })
  assert.deepEqual(ast('()'), { type: 'group', body: { type: 'empty' } })
  assert.deepEqual(ast('a|'), { type: 'alternation', alternatives: [lit('a'), { type: 'empty' }] })
})

test('node ids are unique', () => {
  const ids = []
  JSON.stringify(parseRegex('(a|b)*[x-z]\\d').ast, (k, v) => {
    if (k === 'id') ids.push(v)
    return v
  })
  assert.equal(new Set(ids).size, ids.length)
})

const start = { type: 'assertion', name: 'start', label: '^' }
const end = { type: 'assertion', name: 'end', label: '$' }

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
  assert.deepEqual(ast('^(a|b)$').items[1].type, 'group')
  assert.deepEqual(ast('^'), start)
  assert.deepEqual(ast('$'), end)
  assert.deepEqual(ast('a^b').items[1], start)
})

test('^ and $ are literals inside a class or when escaped', () => {
  assert.deepEqual(ast('[a^$]').matcher, {
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
