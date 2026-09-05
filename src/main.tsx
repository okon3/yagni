import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { followSystemColorScheme } from './gantt/theme.ts'

// Before the first render: the attribute it sets is what dhtmlx reads for its
// own palette, and nothing about it belongs to a component's lifecycle.
followSystemColorScheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
