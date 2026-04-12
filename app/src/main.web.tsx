import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppWeb } from './web/AppWeb'
import './web/styles.css'

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/web-lite-sw.js')
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWeb />
  </StrictMode>,
)
