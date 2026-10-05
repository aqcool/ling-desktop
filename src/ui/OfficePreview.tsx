import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@heroui/react/spinner'
import type { LingWorkspaceDocument } from '../runtime/contract.js'
import type { OfficeViewer } from '../office/viewer.js'
import { tw } from './tailwind.js'

export function OfficePreview({ document }: { readonly document: LingWorkspaceDocument }) {
  const container = useRef<HTMLDivElement>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [warnings, setWarnings] = useState<string[]>([])
  useEffect(() => {
    const target = container.current
    if (!target) return
    const abort = new AbortController()
    let viewer: OfficeViewer | undefined
    setLoading(true); setError(undefined); setWarnings([])
    void import('../office/viewer.js').then(module => {
      if (abort.signal.aborted) return
      return module.mountOfficeViewer(target, document.path, document.data ?? '', abort.signal)
    }).then(result => {
      if (abort.signal.aborted) { result?.dispose(); return }
      viewer = result
      setWarnings(result?.warnings ?? []); setLoading(false)
    }).catch(reason => {
      if (abort.signal.aborted) return
      setError(reason instanceof Error ? reason.message : '无法预览此文档。'); setLoading(false)
    })
    return () => { abort.abort(); viewer?.dispose() }
  }, [document.path, document.data, revision])

  return <section aria-label={`${document.path} 只读预览`} className={tw('office-preview flex h-full min-h-0 flex-col overflow-hidden')}>
    {warnings.length ? <details className={tw('shrink-0 border-b border-[var(--panel-border)] px-3 py-2 text-xs text-[var(--text-secondary)]')}>
      <summary className={tw('cursor-pointer')}>部分内容未完整还原</summary>
      {warnings.map(warning => <p className={tw('mb-0 mt-1.5')} key={warning}>{warning}</p>)}
    </details> : null}
    <div className={tw('relative min-h-0 flex-1')}>
      <div className={tw('office-preview__canvas absolute inset-0 overflow-hidden')} ref={container} />
      {loading || error ? <div className={tw('absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--surface)] px-6 text-center text-sm text-[var(--text-secondary)]')} role={error ? 'alert' : 'status'}>
        {loading ? <><Spinner size="sm" />正在预览文档…</> : <><p className={tw('m-0')}>{error}</p><button className={tw('rounded-md border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-1.5 text-xs hover:bg-[var(--surface-hover)]')} type="button" onClick={() => setRevision(value => value + 1)}>重试</button></>}
      </div> : null}
    </div>
  </section>
}
