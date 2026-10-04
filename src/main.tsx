import { mountLingApp } from './client.js'
import './styles.css'

const root = document.getElementById('root')

if (!root) throw new Error('LING Renderer could not find its root element.')

if (import.meta.env.VITE_LING_DEMO === '1') {
  void import('./runtime/demo-adapter.js').then(({ createDemoRuntimeAdapter }) => {
    mountLingApp(root, createDemoRuntimeAdapter())
  })
} else {
  root.innerHTML = "<main class=\"flex min-h-screen items-center justify-center font-sans text-sm leading-relaxed text-[var(--foreground)]\"><p class=\"max-w-[34em]\">This Vite page is the renderer preview.<br>Run <code>corepack pnpm dev</code> for the desktop app or <code>corepack pnpm serve:web</code> for the local browser app.<br>Use <code>corepack pnpm dev:demo</code> for the UI demo.</p></main>"
}
