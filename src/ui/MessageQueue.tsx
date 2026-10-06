import { useRef, useState } from 'react'
import type { LingCommandResult, LingPendingMessage } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

/** Pending input stays visible above the composer; only the Host mutates its order. */
export function MessageQueue({ items, disabled, onAction, onWithdraw, onReorder }: {
  readonly items: readonly LingPendingMessage[]
  readonly disabled: boolean
  readonly onAction?: (itemId: string, action: 'steer' | 'remove') => Promise<LingCommandResult>
  readonly onWithdraw?: (itemId: string) => Promise<LingCommandResult>
  readonly onReorder?: (itemIds: readonly string[]) => Promise<LingCommandResult>
}) {
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  const [dragged, setDragged] = useState<string>()
  const [dropTarget, setDropTarget] = useState<string>()
  const [error, setError] = useState<string>()
  if (!items.length) return error ? <p role="alert" className={tw('mx-4 mb-2 text-xs text-[var(--danger)]')}>{error}</p> : null
  const locked = disabled || busy
  const ordered = items.filter(item => item.queueId && item.delivery === 'queue' && item.status === 'pending')
  const reorderable = ordered.length > 1 && !!onReorder
  const run = async (operation: () => Promise<LingCommandResult>) => {
    if (locked || mutation.current) return
    mutation.current = true
    setBusy(true); setError(undefined)
    try {
      const result = await operation()
      if (!result.accepted) setError(result.message)
    } catch { setError('无法更新待发送消息，请重试。') }
    finally { mutation.current = false; setBusy(false) }
  }
  const move = (from: string, to: string) => {
    if (!onReorder || from === to) return
    const order = ordered.map(item => item.queueId!)
    const start = order.indexOf(from), end = order.indexOf(to)
    if (start < 0 || end < 0) return
    order.splice(end, 0, ...order.splice(start, 1))
    void run(() => onReorder(order))
  }
  return <section aria-label="待发送消息" aria-busy={busy} className={tw('relative mx-4 -mb-px min-w-0 shrink-0 rounded-t-xl border border-b-0 border-[var(--panel-border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text-secondary)] max-[700px]:mx-2')}>
    <span role="status" className={tw('sr-only')}>{items.length} 条消息待发送</span>
    <ul className={tw('m-0 max-h-[min(12rem,25vh)] list-none overflow-y-auto p-0')}>
      {items.map(item => <li key={item.id}
        onDragOver={event => { if (dragged && item.queueId && !locked && item.delivery === 'queue') { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(item.queueId) } }}
        onDragLeave={() => setDropTarget(undefined)}
        onDrop={event => { event.preventDefault(); if (dragged && item.queueId) move(dragged, item.queueId); setDragged(undefined); setDropTarget(undefined) }}
        className={tw('flex min-h-9 min-w-0 items-center gap-1.5 rounded-md px-1 py-1', dropTarget === item.queueId && 'bg-[var(--surface-hover)]', dragged === item.queueId && 'opacity-50')}>
        {reorderable && item.queueId && item.delivery === 'queue' ? <button type="button" draggable={!locked}
          aria-label={`调整排队顺序：${item.text || '附件消息'}`} title="拖动调整顺序；聚焦后可使用上下方向键" disabled={locked}
          onDragStart={event => { setDragged(item.queueId); event.dataTransfer.setData('text/plain', item.queueId!); event.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => { setDragged(undefined); setDropTarget(undefined) }}
          onKeyDown={event => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); const index = ordered.findIndex(candidate => candidate.queueId === item.queueId); const target = ordered[index + (event.key === 'ArrowUp' ? -1 : 1)]; if (target?.queueId) move(item.queueId!, target.queueId) }}
          className={tw('flex size-6 shrink-0 cursor-grab items-center justify-center rounded border-0 bg-transparent p-0 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] active:cursor-grabbing disabled:opacity-40')}><Icon name="gripVertical" size={14} /></button>
          : <span className={tw('flex size-6 shrink-0 items-center justify-center text-[var(--text-tertiary)]')}><Icon name={item.status === 'sending' ? 'clock' : 'cornerDownLeft'} size={14} /></span>}
        <div className={tw('min-w-0 flex-1')}>
          {item.text ? <p title={item.text} className={tw('m-0 truncate text-xs leading-5 text-[var(--foreground)]')}>{item.text}</p> : null}
          {item.attachments.length ? <div className={tw('flex min-w-0 flex-wrap gap-x-2 gap-y-1')}>
            {item.attachments.map((attachment, index) => <span key={index} title={attachment.name} className={tw('inline-flex min-w-0 max-w-full items-center gap-1')}><Icon name={attachment.kind === 'image' ? 'image' : 'paperclip'} size={12} /><span className={tw('truncate')}>{attachment.name}</span></span>)}
          </div> : null}
          {item.status === 'sending' || item.delivery === 'steer' ? <span role="status" className={tw('text-caption text-[var(--text-tertiary)]')}>{item.status === 'sending' ? '正在发送…' : '等待接入当前任务…'}</span> : null}
        </div>
        {item.queueId && item.delivery === 'queue' && onAction ? <div className={tw('flex shrink-0 items-center gap-0.5')}>
          <button type="button" aria-label={`立即插话：${item.text || '附件消息'}`} title="将这条排队消息接入当前任务" disabled={locked}
            onClick={() => { void run(() => onAction(item.queueId!, 'steer')) }} className={tw('flex h-7 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40')}><Icon name="cornerDownLeft" size={13} />插话</button>
          {onWithdraw ? <button type="button" aria-label={`撤回到输入框编辑：${item.text || '附件消息'}`} title="撤回到输入框编辑" disabled={locked}
            onClick={() => { void run(() => onWithdraw(item.queueId!)) }} className={tw('flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40')}><Icon name="edit" size={14} /></button> : null}
          <button type="button" aria-label={`移除消息：${item.text || '附件消息'}`} title="移除消息" disabled={locked}
            onClick={() => { void run(() => onAction(item.queueId!, 'remove')) }} className={tw('flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] disabled:opacity-40')}><Icon name="trash" size={14} /></button>
        </div> : null}
      </li>)}
    </ul>
    {error ? <p role="alert" className={tw('m-0 px-1 pt-1 text-xs text-[var(--danger)]')}>{error}</p> : null}
  </section>
}
