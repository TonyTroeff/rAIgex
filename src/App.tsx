import { useMemo, useState } from 'react'
import logo from './assets/logo.svg'
import RegexDiagram from './components/RegexDiagram.tsx'
import { buildRegexDiagram, presentNode } from './regex/diagram.ts'
import { parseRegex } from './regex/parser.ts'
import type { AstNode } from './regex/parser.ts'
import '@xyflow/react/dist/style.css'

export default function App() {
  const [pattern, setPattern] = useState('(a|b)*abb')
  const [view, setView] = useState<'diagram' | 'json'>('diagram')
  const [selected, setSelected] = useState<AstNode | null>(null)
  const result = useMemo(() => parseRegex(pattern), [pattern])
  const diagram = useMemo(() => result.ok ? buildRegexDiagram(result.ast) : null, [result])
  const selectedPresentation = selected ? presentNode(selected) : null
  const guidance = selectedPresentation
    ? `${selectedPresentation.title}. ${selectedPresentation.description}`
    : 'Select a card or enclosure to learn what it means.'

  function changePattern(value: string) {
    if (value === pattern) return
    setPattern(value)
    setSelected(null)
  }

  return (
    <main className="app">
      <header className="app-header">
        <a className="brand" href="./" aria-label="rAIgex home">
          <img className="brand-mark" src={logo} width="34" height="34" alt="" aria-hidden="true" />
          <h1>rAIgex</h1>
        </a>
      </header>
      <section className="input-section" aria-label="Regular expression input">
        <div className="input-label-row"><label htmlFor="regex-input">Your expression</label></div>
        <div className={`input-shell${result.ok ? '' : ' has-error'}`}>
          <input
            id="regex-input"
            className="regex-input"
            value={pattern}
            onChange={(event) => changePattern(event.target.value)}
            placeholder="e.g. (a|b)*abb"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={!result.ok}
            aria-describedby={result.ok ? undefined : 'parse-error'}
            autoFocus
          />
        </div>
        <div className="examples"><span>Try a pattern</span>{['(a|b)*abb', '^([a-z]+|\\d*)$', 'a+b?', 'a|'].map((example) => <button key={example} onClick={() => changePattern(example)}>{example}</button>)}</div>
      </section>
      {result.ok && diagram ? (
        <section className="workspace" aria-label="Expression explorer">
          <div className="workspace-toolbar">
            <div className="workspace-title"><span className="status-dot" /><h2>Expression explorer</h2><span className="node-count">{diagram.nodes.length} {diagram.nodes.length === 1 ? 'node' : 'nodes'}</span></div>
            <div className="view-toggle" role="group" aria-label="Output view">
              <button aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>Diagram</button>
              <button aria-pressed={view === 'json'} onClick={() => setView('json')}>JSON</button>
            </div>
          </div>
          {view === 'diagram' ? <>
            <RegexDiagram key={pattern} diagram={diagram} onSelect={setSelected} />
            <div className="workspace-footer">
              <div className="diagram-guidance" role="status">
                <span className="info-icon" aria-hidden="true">i</span>
                <p title={guidance}>{selectedPresentation ? <><strong>{selectedPresentation.title}.</strong> {selectedPresentation.description}</> : guidance}</p>
              </div>
              <span className="canvas-hint">Drag to pan · Scroll to zoom</span>
            </div>
          </> : <div className="json-view"><pre aria-label="Parsed regex JSON">{JSON.stringify(result.ast, null, 2)}</pre></div>}
        </section>
      ) : !result.ok ? (
        <div id="parse-error" className="error" role="alert">
          <strong>Invalid regex:</strong> {result.error.message} at position {result.error.index}
          <pre>{`${pattern}\n${' '.repeat(result.error.index)}^`}</pre>
        </div>
      ) : null}
      <footer className="app-footer"><span>Small pieces. Clearer patterns.</span><span>Built for curious minds.</span></footer>
    </main>
  )
}
