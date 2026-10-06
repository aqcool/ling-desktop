import { useId, useState } from 'react'
import type { LingCommandResult, LingPendingMessage } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

/** The Host owns queue order and removal; this strip only presents pending input. */
export function MessageQueue({ items, disabled, onAction }: {
  readonly items: readonly LingPendingMessage[]
  readonly disabled: boolean
  readonly onAction?: (itemId: string, action: 'steer' | 'remove') => Promise<LingCommandResult>
}) {
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string>()
  if (!items.length) return null
  const act = async (item: LingPendingMessage, action: 'steer' | 'remove') => {
    if (!item.queueId || !onAction || busy.has(item.id)) return
    setBusy(current => new Set(current).add(item.id)); setError(undefined)
    try {
      const result = await onAction(item.queueId, action)
      if (!result.accepted) setError(result.message)
    } catch { setError('无法更新待发送消息，请重试。') }
    finally { setBusy(current => { const next = new Set(current); next.delete(item.id); return next }) }
  }
  return <section aria-label="待发送消息" className={tw('mb-2 min-w-0 rounded-xl border border-[var(--panel-border)] bg-[var(--surface-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)]')}>
    <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}
      className={tw('flex w-full min-w-0 items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-left text-xs text-[var(--text-secondary)]')}>
      <Icon name="clock" size={14} /><span className={tw('shrink-0')}>待发送 · {items.length}</span>
      <span title={expanded ? undefined : items[0]?.text} className={tw('min-w-0 flex-1 truncate text-[var(--text-tertiary)]')}>{expanded ? items.some(item => item.delivery === 'queue') ? '当前轮次结束后依次发送' : '等待接入当前任务…' : items[0]?.text || items[0]?.attachments.map(attachment => attachment.name).join('、')}</span>
      <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />
    </button>
    <ul id={listId} className={tw('m-0 mt-1 max-h-40 list-none overflow-y-auto p-0')}>
      {(expanded ? items : items.slice(0, 1)).map(item => <li key={item.id} className={tw('flex min-w-0 items-start gap-2 py-1.5')}>
        <div className={tw('min-w-0 flex-1')}>
          {expanded ? <p className={tw('m-0 whitespace-pre-wrap break-words text-xs leading-5 [overflow-wrap:anywhere]')}>{item.text}</p> : null}
          {item.attachments.length ? <div className={tw('flex min-w-0 flex-wrap gap-x-2 gap-y-1')}>
            {item.attachments.map((attachment, index) => <span key={index} className={tw('inline-flex min-w-0 max-w-full items-center gap-1')}><Icon name={attachment.kind === 'image' ? 'image' : 'paperclip'} size={12} /><span className={tw('truncate')}>{attachment.name}</span></span>)}
          </div> : null}
          <span role="status" className={tw('text-caption text-[var(--text-tertiary)]')}>{item.status === 'sending' ? '正在发送…' : item.delivery === 'steer' ? '等待接入当前任务…' : '已排队，当前轮次结束后发送'}</span>
        </div>
        {item.queueId && item.delivery === 'queue' && onAction ? <div className={tw('flex shrink-0 items-center gap-1')}>
          <button type="button" aria-label={`立即插话：${item.text || '附件消息'}`} title="把这条排队消息转为插话" disabled={disabled || busy.has(item.id)}
            onClick={() => { void act(item, 'steer') }} className={tw('flex h-6 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40')}><Icon name="send" size={12} />插话</button>
          <button type="button" aria-label={`取消排队：${item.text || '附件消息'}`} title="取消这条排队消息" disabled={disabled || busy.has(item.id)}
            onClick={() => { void act(item, 'remove') }} className={tw('flex size-6 items-center justify-center rounded-md border-0 bg-transparent text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] disabled:opacity-40')}><Icon name="close" size={13} /></button>
        </div> : null}
      </li>)}
    </ul>
    {error ? <p role="alert" className={tw('m-0 mt-1 text-xs text-[var(--danger)]')}>{error}</p> : null}
  </section>
}
