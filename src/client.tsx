import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NativeQuickNotesWindow } from './ui/QuickNotes.js'
import { App } from './App.js'
import { RendererBoundary } from './ui/RendererBoundary.js'
import { rendererFailure } from './runtime/diagnostics.js'
import { initializeAppearance } from './theme.js'
import { createDshRuntimeAdapter, type DshRuntimeFacades } from './runtime/dsh-adapter.js'
import type { LingRuntimeAdapter } from './runtime/contract.js'

export function mountLingApp(container: HTMLElement, runtime?: LingRuntimeAdapter): () => void {
  if (navigator.userAgent.includes('Mac') || navigator.platform.startsWith('Mac')) {
    document.documentElement.dataset.platform = 'darwin'
  }
  initializeAppearance()
  const root = createRoot(container, {
    // Last resort if the boundary's own fallback fails to render.
    onUncaughtError(error, info) {
      console.error('LING Renderer could not render its recovery page', error)
      void window.__LING_RECOVERY__?.report(rendererFailure(error, info.componentStack))
        .catch(error => console.error('LING recovery report failed', error))
    },
  })
  root.render(
    <StrictMode>
      <RendererBoundary>
        {new URLSearchParams(window.location.search).get('surface') === 'quick-notes' ? <NativeQuickNotesWindow /> : <App runtime={runtime} />}
      </RendererBoundary>
    </StrictMode>,
  )
  return () => { root.unmount() }
}

export function mountLingRenderer(container: HTMLElement, facades: DshRuntimeFacades): () => void {
  if (new URLSearchParams(window.location.search).get('surface') === 'quick-notes') return mountLingApp(container)
  return mountLingApp(container, createDshRuntimeAdapter(facades))
}
