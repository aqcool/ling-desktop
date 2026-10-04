import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NativeQuickNotesWindow } from './ui/QuickNotes.js'
import { App } from './App.js'
import { initializeAppearance } from './theme.js'
import { createDshRuntimeAdapter, type DshRuntimeFacades } from './runtime/dsh-adapter.js'
import type { LingRuntimeAdapter } from './runtime/contract.js'

export function mountLingApp(container: HTMLElement, runtime?: LingRuntimeAdapter): () => void {
  if (navigator.userAgent.includes('Mac') || navigator.platform.startsWith('Mac')) {
    document.documentElement.dataset.platform = 'darwin'
  }
  initializeAppearance()
  const root = createRoot(container)
  root.render(
    <StrictMode>
      {new URLSearchParams(window.location.search).get('surface') === 'quick-notes' ? <NativeQuickNotesWindow /> : <App runtime={runtime} />}
    </StrictMode>,
  )
  return () => { root.unmount() }
}

export function mountLingRenderer(container: HTMLElement, facades: DshRuntimeFacades): () => void {
  if (new URLSearchParams(window.location.search).get('surface') === 'quick-notes') return mountLingApp(container)
  return mountLingApp(container, createDshRuntimeAdapter(facades))
}
