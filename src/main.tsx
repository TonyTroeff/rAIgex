import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './App.css'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Root element #root was not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
