import { useEffect, useRef, useState } from 'react'
import { Modal } from '@heroui/react/modal'
import { CompactButton } from './SettingsControls.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

type Entry = { id: number; file: File; status: 'waiting' | 'saving' | 'done' | 'failed'; error?: string }
export function KnowledgeImportDialog({ onClose, onImport, onDone }: {
  onClose: () => void
  onImport: (file: File) => Promise<string>
  onDone: (firstId: string) => void
}) {
  const [entries, setEntries] = useState<Entry[]>([]), [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null), nextId = useRef(0), first = useRef<string | undefined>(undefined)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const add = (files: File[]) => setEntries(current => [...current, ...files.filter(file => !current.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)).map(file => ({ id: ++nextId.current, file, status: 'waiting' as const }))])
  const update = (id: number, state: Partial<Entry>) => setEntries(current => current.map(item => item.id === id ? { ...item, ...state } : item))
  const save = async () => {
    setBusy(true)
    let failed = false
    for (const item of entries.filter(item => item.status !== 'done')) {
      if (!live.current) return
      update(item.id, { status: 'saving', error: undefined })
      try {
        const id = await onImport(item.file)
        if (!live.current) return
        first.current ??= id
        update(item.id, { status: 'done' })
      } catch (error) {
        failed = true
        update(item.id, { status: 'failed', error: error instanceof Error ? error.message : '导入失败。' })
      }
    }
    if (!live.current) return
    setBusy(false)
    if (!failed && first.current) onDone(first.current)
  }
  return <Modal.Backdrop isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(open: boolean) => { if (!open && !busy) onClose() }}>
    <Modal.Container size="sm"><Modal.Dialog className={tw('w-[520px] max-w-[calc(100vw-32px)]')}>
      <Modal.CloseTrigger aria-label="关闭" isDisabled={busy} />
      <Modal.Header><Modal.Heading>添加本地文件</Modal.Heading></Modal.Header>
      <Modal.Body className={tw('grid gap-4')}>
        <input ref={input} type="file" multiple accept=".md,.markdown,.txt" aria-label="选择知识库文件" className={tw('hidden')} onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
        <div onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) add(Array.from(event.dataTransfer.files)) }} className={tw('flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--panel-border)] p-5 text-center')}>
          <Icon name="file" size={26} className={tw('text-[var(--text-tertiary)]')} />
          <p className={tw('m-0 text-sm font-medium')}>拖入文件，或点击选择</p>
          <p className={tw('m-0 text-xs leading-5 text-[var(--text-secondary)]')}>Markdown、TXT · 每个文件最多 512 KB / 128,000 字符</p>
          <CompactButton variant="secondary" isDisabled={busy} onPress={() => input.current?.click()}>选择文件</CompactButton>
        </div>
        {entries.length ? <ul aria-label="待导入文件" className={tw('m-0 grid max-h-60 list-none gap-1 overflow-y-auto p-0')}>
          {entries.map(item => <li key={item.id} className={tw('flex items-start gap-2 rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-xs')}>
            <div className={tw('min-w-0 flex-1')}><div className={tw('truncate')}>{item.file.name}</div><div className={tw('mt-1 text-[var(--text-tertiary)]')}>{Math.ceil(item.file.size / 1024)} KB · {{ waiting: '等待导入', saving: '正在保存…', done: '已添加', failed: '导入失败' }[item.status]}</div>{item.error ? <p role="alert" className={tw('mb-0 mt-1 text-[var(--danger)]')}>{item.error}</p> : null}</div>
            {item.status !== 'done' ? <CompactButton variant="tertiary" isIconOnly aria-label={`移除 ${item.file.name}`} isDisabled={busy} onPress={() => setEntries(current => current.filter(entry => entry.id !== item.id))}><Icon name="close" size={14} /></CompactButton> : null}
          </li>)}
        </ul> : null}
      </Modal.Body>
      <Modal.Footer><CompactButton variant="tertiary" isDisabled={busy} onPress={onClose}>取消</CompactButton><CompactButton isDisabled={busy || !entries.length} onPress={() => { if (entries.every(item => item.status === 'done') && first.current) onDone(first.current); else void save() }}>{busy ? '正在导入…' : entries.length && entries.every(item => item.status === 'done') ? '完成' : entries.some(item => item.status === 'failed') ? '重试未完成文件' : '添加知识'}</CompactButton></Modal.Footer>
    </Modal.Dialog></Modal.Container>
  </Modal.Backdrop>
}
