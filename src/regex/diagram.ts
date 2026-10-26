import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { AstNode, CategoryMatcher, ClassItem, Matcher } from './parser.ts'

export type NodePresentation = {
  title: string
  symbol: string
  description: string
  tone: 'character' | 'assertion' | 'empty' | 'sequence' | 'choice' | 'group' | 'repeat'
}
export type RegexFlowNode = Node<{
  ast: AstNode
  presentation: NodePresentation
  separators: number[]
}, 'regexLeaf' | 'regexContainer'>
export type RegexDiagram = { nodes: RegexFlowNode[]; edges: Edge[] }

function categoryName(matcher: CategoryMatcher): string {
  const name = { digit: 'digit', word: 'word character', space: 'whitespace character' }[matcher.name]
  return matcher.negated ? `non-${name}` : name
}
export function describeClassItem(item: ClassItem): string {
  switch (item.kind) {
    case 'literal': return JSON.stringify(item.value)
    case 'range': return `${JSON.stringify(item.from)} to ${JSON.stringify(item.to)}`
    case 'category': return categoryName(item)
  }
}
function describeMatcher(matcher: Matcher): string {
  switch (matcher.kind) {
    case 'literal': return `Matches the literal character ${JSON.stringify(matcher.value)}.`
    case 'any': return 'Matches any single character.'
    case 'category': return `Matches one ${categoryName(matcher)}.`
    case 'class': return `Matches one character ${matcher.negated ? 'outside' : 'from'} this set: ${matcher.items.map(describeClassItem).join(', ')}.`
  }
}
function times(count: number): string {
  return count === 1 ? '1 time' : `${count} times`
}
export function presentNode(ast: AstNode): NodePresentation {
  switch (ast.type) {
    case 'char': {
      const titles = { literal: 'Literal', any: 'Any character', category: 'Character category', class: 'Character class' }
      return {
        title: ast.matcher.kind === 'class' && ast.matcher.negated ? 'Negated class' : titles[ast.matcher.kind],
        symbol: ast.label === ' ' ? '␠' : ast.label,
        description: describeMatcher(ast.matcher),
        tone: 'character',
      }
    }
    case 'assertion': return { title: ast.name === 'start' ? 'Start' : 'End', symbol: ast.label, description: `Asserts the ${ast.name} of the input without consuming a character (zero-width).`, tone: 'assertion' }
    case 'empty': return { title: 'Empty expression', symbol: 'ε', description: 'Matches the empty string without consuming a character.', tone: 'empty' }
    case 'concat': return { title: 'Sequence', symbol: '→', description: 'Matches every child in order, from left to right.', tone: 'sequence' }
    case 'alternation': return { title: 'Any of', symbol: '|', description: 'Matches any one of the alternatives shown in separate lanes.', tone: 'choice' }
    case 'group': return { title: 'Group', symbol: '(…)', description: 'Keeps the enclosed expression together as one group.', tone: 'group' }
    case 'star': return { title: 'Zero or more', symbol: '*', description: 'Repeats the enclosed expression zero or more times.', tone: 'repeat' }
    case 'plus': return { title: 'One or more', symbol: '+', description: 'Repeats the enclosed expression one or more times.', tone: 'repeat' }
    case 'optional': return { title: 'Optional', symbol: '?', description: 'Matches the enclosed expression zero or one time.', tone: 'repeat' }
    case 'counted': {
      const { min, max } = ast
      if (max === min) return { title: `Exactly ${min}`, symbol: `{${min}}`, description: `Repeats the enclosed expression exactly ${times(min)}.`, tone: 'repeat' }
      if (max === null) return { title: `${min} or more`, symbol: `{${min},}`, description: `Repeats the enclosed expression at least ${times(min)}.`, tone: 'repeat' }
      return { title: `${min} to ${max}`, symbol: `{${min},${max}}`, description: `Repeats the enclosed expression between ${min} and ${times(max)}.`, tone: 'repeat' }
    }
  }
}
export function astChildren(ast: AstNode): AstNode[] {
  switch (ast.type) {
    case 'concat': return ast.items
    case 'alternation': return ast.alternatives
    case 'group':
    case 'star':
    case 'plus':
    case 'optional':
    case 'counted': return [ast.body]
    default: return []
  }
}

type Layout = {
  ast: AstNode
  width: number
  height: number
  children: { layout: Layout; x: number; y: number }[]
  separators: number[]
}
const CARD_WIDTH = 156
const CARD_HEIGHT = 88
const ASSERTION_WIDTH = 140
const ASSERTION_HEIGHT = 52
const PADDING = 22
const CONTENT_TOP = 62
const SEQUENCE_GAP = 40
const LANE_GAP = 28

function measure(ast: AstNode): Layout {
  const children = astChildren(ast).map(measure)
  if (children.length === 0) {
    const leaf = ast.type === 'assertion'
      ? { width: ASSERTION_WIDTH, height: ASSERTION_HEIGHT }
      : { width: CARD_WIDTH, height: CARD_HEIGHT }
    return { ast, ...leaf, children: [], separators: [] }
  }
  const horizontal = ast.type === 'concat'
  const vertical = ast.type === 'alternation'
  const contentWidth = horizontal
    ? children.reduce((sum, child) => sum + child.width, 0) + SEQUENCE_GAP * (children.length - 1)
    : Math.max(...children.map((child) => child.width))
  const contentHeight = vertical
    ? children.reduce((sum, child) => sum + child.height, 0) + LANE_GAP * (children.length - 1)
    : Math.max(...children.map((child) => child.height))
  // Concatenation is a layout-only row, without its own enclosure or padding.
  const width = horizontal ? contentWidth : Math.max(240, contentWidth + PADDING * 2)
  const contentTop = horizontal ? 0 : CONTENT_TOP
  let x = (width - contentWidth) / 2
  let y = contentTop
  const separators: number[] = []
  const positioned = children.map((child, index) => {
    const position = {
      layout: child,
      x: horizontal ? x : (width - child.width) / 2,
      y: vertical ? y : contentTop + (contentHeight - child.height) / 2,
    }
    x += child.width + SEQUENCE_GAP
    y += child.height + LANE_GAP
    if (vertical && index < children.length - 1) separators.push(y - LANE_GAP / 2)
    return position
  })
  return { ast, width, height: horizontal ? contentHeight : CONTENT_TOP + contentHeight + PADDING, children: positioned, separators }
}

type Endpoints = { entry: string; exit: string }

/** Concatenations become connected rows inside the nearest visible enclosure. */
export function buildRegexDiagram(ast: AstNode): RegexDiagram {
  const nodes: RegexFlowNode[] = []
  const edges: Edge[] = []
  function emit(layout: Layout, x: number, y: number, depth: number, parentId?: string): Endpoints {
    const { ast, width, height, children, separators } = layout
    if (ast.type === 'concat') {
      const fragments = children.map((child) => emit(child.layout, x + child.x, y + child.y, depth, parentId))
      fragments.slice(1).forEach((target, index) => {
        const source = fragments[index]
        edges.push({
          id: `${ast.id}:${source.exit}-${target.entry}`,
          source: source.exit,
          target: target.entry,
          sourceHandle: 'out',
          targetHandle: 'in',
          type: 'straight',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: '#9aa5b5' },
          style: { stroke: '#9aa5b5', strokeWidth: 1.5 },
          zIndex: depth * 2 + 1,
          selectable: false,
          focusable: false,
          deletable: false,
        })
      })
      return { entry: fragments[0].entry, exit: fragments[fragments.length - 1].exit }
    }

    const presentation = presentNode(ast)
    // Parser IDs are allocated bottom-up; React Flow needs visible parents first.
    nodes.push({
      id: ast.id,
      type: children.length ? 'regexContainer' : 'regexLeaf',
      position: { x, y },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      width,
      height,
      style: { width, height },
      data: { ast, presentation, separators },
      draggable: false,
      connectable: false,
      deletable: false,
      ariaLabel: `${presentation.title}: ${presentation.symbol}. ${presentation.description}`,
      zIndex: depth * 2,
    })
    children.forEach((child) => emit(child.layout, child.x, child.y, depth + 1, ast.id))
    return { entry: ast.id, exit: ast.id }
  }
  emit(measure(ast), 0, 0, 0)
  return { nodes, edges }
}
