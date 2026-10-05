import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { redactDiagnostic, rendererFailure, type LingRendererFailure } from '../runtime/diagnostics.js'
import { CompactButton } from './SettingsControls.js'
import { tw } from './tailwind.js'

function Ready({ children, onReady }: { children: ReactNode; onReady(): void }) {
  useEffect(() => { onReady() }, [onReady])
  return children
}

function FailureView({ failure, started }: { failure: LingRendererFailure; started: boolean }) {
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const diagnostic = redactDiagnostic([failure.stack ?? failure.message, failure.componentStack].filter(Boolean).join('\n'))
  async function reload() {
    setLoading(true)
    try {
      if (window.__LING_RECOVERY__) await window.__LING_RECOVERY__.reload()
      else window.location.reload()
    } catch { setStatus('重新加载失败，请尝试重新启动应用。'); setLoading(false) }
  }
  async function copy() {
    try {
      if (window.__LING_RECOVERY__) await window.__LING_RECOVERY__.copy(failure)
      else await navigator.clipboard.writeText(`LING Renderer\n${diagnostic}`)
      setStatus('诊断信息已复制。')
    } catch { setStatus('复制失败，可以展开错误详情手动复制。') }
  }
  return <main className={tw('flex h-full min-h-0 flex-col overflow-auto bg-[var(--surface)] text-[var(--foreground)]')}>
    <div aria-hidden="true" className={tw('h-12 shrink-0 [-webkit-app-region:drag]')} />
    <section aria-labelledby="renderer-failure-title" className={tw('mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-8 py-12')}>
      <h1 id="renderer-failure-title" className={tw('m-0 text-xl font-semibold')}>{started ? '当前窗口发生错误' : '当前窗口加载失败'}</h1>
      <p className={tw('mb-0 mt-3 text-sm leading-6 text-[var(--text-secondary)]')}>可以重新加载窗口。此操作只刷新界面，已保存的会话会保留。</p>
      <p className={tw('mb-0 mt-2 text-xs leading-5 text-[var(--text-tertiary)]')}>未保存的输入与编辑内容可能丢失。</p>
      <div className={tw('mt-6 flex flex-wrap gap-2')}>
        <CompactButton isPending={loading} onPress={() => { void reload() }}>重新加载窗口</CompactButton>
        <CompactButton variant="secondary" onPress={() => { void copy() }}>复制诊断信息</CompactButton>
      </div>
      <p aria-live="polite" className={tw('mb-0 mt-3 min-h-5 text-xs text-[var(--text-secondary)]')}>{status}</p>
      <details className={tw('mt-3 text-xs text-[var(--text-tertiary)]')}>
        <summary className={tw('cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}>错误详情</summary>
        <pre className={tw('max-h-52 overflow-auto rounded-lg bg-[var(--surface-secondary)] p-3 font-mono leading-5 whitespace-pre-wrap break-all')}>{diagnostic}</pre>
      </details>
    </section>
  </main>
}

/** Rendering failures stay outside the chat and never dispatch a runtime command. */
export class RendererBoundary extends Component<{ children: ReactNode }, { failure?: LingRendererFailure }> {
  state: { failure?: LingRendererFailure } = {}
  private started = false
  static getDerivedStateFromError(error: unknown) { return { failure: rendererFailure(error) } }
  private ready = () => {
    this.started = true
    void window.__LING_RECOVERY__?.ready().catch(error => console.error('LING recovery readiness failed', error))
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const failure = rendererFailure(error, info.componentStack)
    this.setState({ failure })
    void window.__LING_RECOVERY__?.report(failure).catch(error => console.error('LING recovery report failed', error))
  }
  render() {
    return this.state.failure ? <FailureView failure={this.state.failure} started={this.started} /> : <Ready onReady={this.ready}>{this.props.children}</Ready>
  }
}
