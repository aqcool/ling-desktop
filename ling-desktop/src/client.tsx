import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { createDshRuntimeAdapter, type DshRuntimeFacades } from './runtime/dsh-adapter.js'
import type { LingRuntimeAdapter } from './runtime/contract.js'

export function mountLingApp(container: HTMLElement, runtime?: LingRuntimeAdapter): () => void {
  const root = createRoot(container)
  root.render(
    <StrictMode>
      <App runtime={runtime} />
    </StrictMode>,
  )
  return () => { root.unmount() }
}

export function mountLingRenderer(container: HTMLElement, facades: DshRuntimeFacades): () => void {
  return mountLingApp(container, createDshRuntimeAdapter(facades))
}
