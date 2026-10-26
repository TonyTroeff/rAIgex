import assert from 'node:assert/strict'
import { test } from 'node:test'
import { astChildren, buildRegexDiagram, describeClassItem, presentNode } from './diagram.ts'
import { parseRegex, type AstNode } from './parser.ts'

function ast(pattern: string): AstNode {
  const result = parseRegex(pattern)
  assert.ok(result.ok)
  return result.ast
}
function flatten(node: AstNode): AstNode[] {
  return [node, ...astChildren(node).flatMap(flatten)]
}

const patterns = ['', 'a', 'ab', '(ab)c', '(ab)+', '(ab|cd)*', '()', 'a|', '|a', '^((a|b)+[c-e]?)\\d*$', '(a|b)*abb', '((a?)*|bc)+', '.[^a-z\\d_]\\W\\t', '[abcdefghijklmnopqrstuvwxyz0123456789]']

test('every non-concat AST node is displayed once, retaining identity and metadata', () => {
  const types = new Set<string>()
  for (const pattern of patterns) {
    const root = ast(pattern)
    const diagram = buildRegexDiagram(root)
    const treeNodes = flatten(root).filter((node) => node.type !== 'concat')
    assert.ok(diagram.nodes.every((node) => node.data.ast.type !== 'concat'))
    assert.equal(diagram.nodes.length, treeNodes.length, pattern)
    assert.equal(new Set(diagram.nodes.map((node) => node.id)).size, treeNodes.length)
    for (const treeNode of treeNodes) {
      types.add(treeNode.type)
      const node = diagram.nodes.find((candidate) => candidate.id === treeNode.id)
      assert.ok(node)
      assert.equal(node.data.ast, treeNode)
      assert.equal(node.draggable, false)
      assert.equal(node.connectable, false)
      assert.equal(node.deletable, false)
      assert.ok(node.ariaLabel)
      assert.equal(node.type, astChildren(treeNode).length ? 'regexContainer' : 'regexLeaf')
    }
  }
  assert.equal(types.size, 8)
})

test('parents precede descendants and every child fits inside its parent below the header', () => {
  for (const pattern of patterns) {
    const root = ast(pattern)
    const { nodes } = buildRegexDiagram(root)
    const roots = root.type === 'concat' ? root.items : [root]
    assert.deepEqual(nodes.filter((node) => !node.parentId).map((node) => node.id), roots.map((node) => node.id))
    for (const [index, node] of nodes.entries()) {
      assert.ok(Number.isFinite(node.position.x) && Number.isFinite(node.position.y))
      assert.ok(node.width! > 0 && node.height! > 0)
      if (!node.parentId) continue
      const parentIndex = nodes.findIndex((candidate) => candidate.id === node.parentId)
      assert.ok(parentIndex >= 0 && parentIndex < index, pattern)
      const parent = nodes[parentIndex]
      assert.equal(node.extent, 'parent')
      assert.ok(node.position.x >= 16 && node.position.y >= 50)
      assert.ok(node.position.x + node.width! <= parent.width! - 16)
      assert.ok(node.position.y + node.height! <= parent.height! - 16)
      assert.ok(node.zIndex! > parent.zIndex!)
    }
    for (const parent of nodes) {
      const children = nodes.filter((node) => node.parentId === parent.id)
      for (let i = 0; i < children.length; i++) {
        for (const second of children.slice(i + 1)) {
          const first = children[i]
          assert.ok(first.position.x + first.width! <= second.position.x || second.position.x + second.width! <= first.position.x || first.position.y + first.height! <= second.position.y || second.position.y + second.height! <= first.position.y, `overlap in ${pattern}`)
        }
      }
    }
  }
})

test('layout is deterministic and does not mutate the AST', () => {
  for (const pattern of patterns) {
    const root = ast(pattern)
    const before = JSON.stringify(root)
    assert.deepEqual(buildRegexDiagram(root), buildRegexDiagram(root))
    assert.equal(JSON.stringify(root), before)
  }
})

test('only adjacent sequence children have edges, in the original order', () => {
  for (const pattern of patterns) {
    const root = ast(pattern)
    const { nodes, edges } = buildRegexDiagram(root)
    const expected = flatten(root).flatMap((node) => {
      return node.type === 'concat' ? node.items.slice(1).map((target, index) => [node.items[index].id, target.id]) : []
    })
    assert.deepEqual(edges.map((edge) => `${edge.source}->${edge.target}`).sort(), expected.map(([source, target]) => `${source}->${target}`).sort())
    for (const edge of edges) {
      const source = nodes.find((node) => node.id === edge.source)!
      const target = nodes.find((node) => node.id === edge.target)!
      assert.equal(source.parentId, target.parentId)
      assert.ok(source.position.x < target.position.x)
      assert.equal(edge.sourceHandle, 'out')
      assert.equal(edge.targetHandle, 'in')
    }
  }
})

test('sequence children use the nearest visible parent with no invisible sequence frame', () => {
  const top = buildRegexDiagram(ast('ab'))
  assert.deepEqual(top.nodes.map((node) => node.data.ast.type), ['char', 'char'])
  assert.deepEqual(top.nodes.map((node) => node.parentId), [undefined, undefined])
  assert.deepEqual(top.nodes.map((node) => node.position), [{ x: 0, y: 0 }, { x: 196, y: 0 }])

  const nested = buildRegexDiagram(ast('(ab)+'))
  assert.deepEqual(nested.nodes.map((node) => node.data.ast.type), ['plus', 'group', 'char', 'char'])
  const group = nested.nodes[1]
  assert.equal(group.width, 396)
  assert.equal(group.height, 172)
  assert.ok(nested.nodes.slice(2).every((node) => node.parentId === group.id))
  assert.equal(nested.edges.length, 1)

  const branches = buildRegexDiagram(ast('ab|cd'))
  const choice = branches.nodes[0]
  assert.equal(choice.data.ast.type, 'alternation')
  assert.equal(choice.data.separators.length, 1)
  assert.ok(branches.nodes.slice(1).every((node) => node.parentId === choice.id))
  assert.equal(branches.nodes[1].position.y, branches.nodes[2].position.y)
  assert.equal(branches.nodes[3].position.y, branches.nodes[4].position.y)
  assert.ok(branches.nodes[1].position.y < branches.nodes[3].position.y)
  assert.equal(branches.edges.length, 2)
})

test('alternatives occupy vertical lanes while nested group and repetition wrappers remain', () => {
  const { nodes, edges } = buildRegexDiagram(ast('(a|b)*'))
  assert.deepEqual(nodes.map((node) => node.data.ast.type), ['star', 'group', 'alternation', 'char', 'char'])
  const choices = nodes.filter((node) => node.parentId === nodes[2].id)
  assert.equal(choices[0].position.x, choices[1].position.x)
  assert.ok(choices[0].position.y < choices[1].position.y)
  assert.equal(nodes[2].data.separators.length, 1)
  assert.equal(edges.length, 0)
})

test('leaf meanings preserve escapes, ranges, categories, negation, and zero-width assertions', () => {
  assert.equal(presentNode(ast('\\t')).symbol, '\\t')
  assert.equal(presentNode(ast(' ')).symbol, '␠')
  assert.match(presentNode(ast('\\W')).description, /non-word character/)
  assert.match(presentNode(ast('^')).description, /zero-width/)
  assert.equal(presentNode(ast('')).symbol, 'ε')
  const node = ast('[^a-z\\d_]')
  assert.equal(presentNode(node).title, 'Negated class')
  assert.match(presentNode(node).description, /outside this set/)
  assert.match(presentNode(node).description, /"a" to "z", digit, "_"/)
  assert.equal(buildRegexDiagram(node).nodes.length, 1)
  assert.equal(describeClassItem({ kind: 'literal', value: '\n' }), '"\\n"')
  const long = ast('[abcdefghijklmnopqrstuvwxyz0123456789]')
  assert.equal(presentNode(long).symbol, '[abcdefghijklmnopqrstuvwxyz0123456789]')
})
