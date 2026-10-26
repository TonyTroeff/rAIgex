import { useMemo, useState } from 'react'
import { parseRegex } from './regex/parser.ts'

export default function App() {
  const [pattern, setPattern] = useState('(a|b)*abb')
  const result = useMemo(() => parseRegex(pattern), [pattern])

  return (
    <main className="app">
      <h1>rAIgex</h1>
      <input
        className="regex-input"
        value={pattern}
        onChange={(event) => setPattern(event.target.value)}
        placeholder="Enter a regular expression, e.g. (a|b)*abb"
        spellCheck={false}
        autoComplete="off"
        autoFocus
      />
      {result.ok ? (
        <pre className="output">{JSON.stringify(result.ast, null, 2)}</pre>
      ) : (
        <div className="error" role="alert">
          <strong>Invalid regex:</strong> {result.error.message} at position {result.error.index}
          <pre>{`${pattern}\n${' '.repeat(result.error.index)}^`}</pre>
        </div>
      )}
    </main>
  )
}
