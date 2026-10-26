import { useCallback, useEffect } from 'react'
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow,
  useNodesInitialized, useNodesState, useReactFlow, useStore, type NodeProps, type OnSelectionChangeParams,
} from '@xyflow/react'
import type { AstNode } from '../regex/parser.ts'
import type { RegexDiagram as DiagramData, RegexFlowNode } from '../regex/diagram.ts'

function Ports() {
  return <>
    <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
    <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
  </>
}
function RegexLeaf({ data, selected }: NodeProps<RegexFlowNode>) {
  const { presentation } = data
  return (
    <div className={`regex-node leaf-node tone-${presentation.tone}${selected ? ' is-selected' : ''}`}>
      <Ports />
      <span className="leaf-symbol" title={presentation.symbol}>{presentation.symbol}</span>
      <span className="leaf-title">{presentation.title}</span>
      {data.ast.type === 'assertion' && <span className="zero-width">zero-width</span>}
    </div>
  )
}
function RegexContainer({ data, selected }: NodeProps<RegexFlowNode>) {
  const { presentation, separators } = data
  return (
    <div className={`regex-node container-node tone-${presentation.tone}${selected ? ' is-selected' : ''}`}>
      <Ports />
      <div className="container-heading"><span className="container-symbol">{presentation.symbol}</span><span>{presentation.title}</span></div>
      {separators.map((top) => <div key={top} className="alternative-divider" style={{ top }}><span>or</span></div>)}
    </div>
  )
}
const nodeTypes = { regexLeaf: RegexLeaf, regexContainer: RegexContainer }
const fitOptions = { padding: 0.08, maxZoom: 1.15 }
const ariaLabels = {
  'node.a11yDescription.default': 'Press Enter or Space to inspect this expression. Press Escape to clear selection.',
  'node.a11yDescription.keyboardDisabled': 'Press Enter or Space to inspect this expression. Press Escape to clear selection.',
}
function FitDiagram() {
  const { fitView } = useReactFlow()
  const initialized = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  useEffect(() => {
    if (!initialized) return
    const frame = requestAnimationFrame(() => { void fitView(fitOptions) })
    return () => cancelAnimationFrame(frame)
  }, [fitView, initialized, width, height])
  return null
}
export default function RegexDiagram({ diagram, onSelect }: {
  diagram: DiagramData
  onSelect: (ast: AstNode | null) => void
}) {
  const [nodes, , onNodesChange] = useNodesState(diagram.nodes)
  const onSelectionChange = useCallback(({ nodes: selection }: OnSelectionChangeParams<RegexFlowNode>) => {
    onSelect(selection[0]?.data.ast ?? null)
  }, [onSelect])
  return (
    <div className="diagram-canvas" aria-label="Nested regular expression diagram">
      <ReactFlow<RegexFlowNode>
        nodes={nodes}
        edges={diagram.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        elevateNodesOnSelect={false}
        fitView
        fitViewOptions={fitOptions}
        minZoom={0.05}
        maxZoom={2}
        ariaLabelConfig={ariaLabels}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d8dfe8" />
        <Controls showInteractive={false} fitViewOptions={fitOptions} />
        <FitDiagram />
      </ReactFlow>
    </div>
  )
}
