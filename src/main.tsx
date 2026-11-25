import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/im-fell-english/400.css'
import '@fontsource/im-fell-english/400-italic.css'
import { App } from './components/App'
import './style.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
