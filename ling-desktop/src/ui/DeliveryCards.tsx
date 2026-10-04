import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react/button'
import type { LingReadResult, LingWorkspaceDocument } from '../runtime/contract.js'
import type { LingPresentedFile } from '../runtime/reply-features.js'
import { DocumentBody } from './FileBrowser.js'
import { Icon } from './Icon.js'
import { FileIcon } from './FileIcon.js'
import { tw } from './tailwind.js'

export function deliveryName(path: string): string { return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path }
export type OpenDelivery = (taskId: string, file: LingPresentedFile) => Promise<LingReadResult<void>>

function DeliveryCard({ taskId, file, onOpen, onPreview }: { taskId: string; file: LingPresentedFile; onOpen: OpenDelivery; onPreview: (taskId: string, file: LingPresentedFile) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const name = deliveryName(file.path)
  return <div className={tw('min-w-0 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)]')}>
    <div className={tw('flex min-w-0 items-center gap-2 p-2')}>
      <FileIcon path={file.path} size={18} className={tw('shrink-0 text-[var(--text-secondary)]')} />
      <Button size="sm" variant="ghost" aria-label={`打开 ${name}`} isDisabled={pending} title={file.path} className={tw('h-auto min-w-0 flex-1 flex-col items-start gap-0 rounded-md px-1 py-0.5 text-left')} onPress={() => {
        if (pending) return
        setPending(true); setError('')
        void onOpen(taskId, file).then(result => { if (active.current && !result.ok) setError(result.message) }, () => { if (active.current) setError('文件打开失败，请重试。') }).finally(() => { if (active.current) setPending(false) })
      }}>
        <span className={tw('max-w-full truncate text-xs font-medium')}>{pending ? '正在打开…' : name}</span>
        {file.description ? <span className={tw('max-w-full truncate text-micro font-normal text-[var(--text-tertiary)]')}>{file.description}</span> : null}
      </Button>
      <Button size="sm" variant="ghost" aria-label={`预览 ${name}`} className={tw('h-control-xs min-w-0 shrink-0 rounded-md px-2 text-xs font-normal text-[var(--text-secondary)]')} onPress={() => { setError(''); onPreview(taskId, file) }}>预览</Button>
    </div>
    {error ? <p role="alert" className={tw('m-0 px-3 pb-2 text-xs text-[var(--danger)]')}>{error}</p> : null}
  </div>
}

export function DeliveryCards({ taskId, files, onOpen, onPreview }: { taskId: string; files: readonly LingPresentedFile[]; onOpen: OpenDelivery; onPreview: (taskId: string, file: LingPresentedFile) => void }) {
  return <div aria-label="交付文件" data-copy-ignore className={tw('mt-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2')}>
    {files.map(file => <DeliveryCard key={`${file.seq}:${file.index}`} taskId={taskId} file={file} onOpen={onOpen} onPreview={onPreview} />)}
  </div>
}

export function DeliveryPreview({ taskId, file, load }: { taskId: string; file: LingPresentedFile; load: (taskId: string, path: string, signal: AbortSignal) => Promise<LingReadResult<LingWorkspaceDocument>> }) {
  const [document, setDocument] = useState<LingWorkspaceDocument>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const abort = new AbortController(); setDocument(undefined); setError('')
    void load(taskId, file.path, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) setDocument(result.value); else setError(result.message)
    }).catch(() => { if (!abort.signal.aborted) setError('文件读取失败，请重试。') })
    return () => abort.abort()
  }, [taskId, file.path, load, revision])
  return <section aria-label="产物预览" className={tw('flex min-h-0 min-w-0 flex-1 flex-col')}>
    <div className={tw('flex h-control-lg shrink-0 items-center gap-2 border-b border-[var(--panel-border)] px-3 text-xs text-[var(--text-secondary)]')}>
      <span className={tw('min-w-0 flex-1 truncate')} title={file.path}>{file.path}</span>
      <Button isIconOnly size="sm" variant="ghost" aria-label="刷新产物预览" onPress={() => setRevision(value => value + 1)}><Icon name="refresh" size={14} /></Button>
    </div>
    <div className={tw('min-h-0 min-w-0 flex-1 overflow-auto p-4')}>
      {document ? <DocumentBody document={document} /> : <p role={error ? 'alert' : 'status'} className={tw('text-xs text-[var(--text-tertiary)]')}>{error || '正在读取文件…'}</p>}
    </div>
  </section>
}
