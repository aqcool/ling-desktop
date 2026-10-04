import type { LingTimelineItem } from '../runtime/contract.js'
import { Icon } from './Icon.js'
import { Markdown } from './Markdown.js'
import { CompactButton } from './SettingsControls.js'
import { tw } from './tailwind.js'

/** Always one quiet row, independent of tool-group auto-expansion preferences. */
export function CompactionActivity({ item, disabled, onRetry }: { item: LingTimelineItem; disabled: boolean; onRetry?: () => void }) {
  const record = item.compaction!
  const active = item.status === 'running'
  return <article className={tw('flex min-w-0 items-start gap-2 px-4 text-xs text-[var(--text-secondary)]')} data-compaction={record.id} data-status={item.status}>
    <details className={tw('group/compact min-w-0 flex-1')}>
      <summary className={tw('flex min-h-7 cursor-pointer list-none items-center gap-2 rounded-md py-1 outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] [&::-webkit-details-marker]:hidden')}>
        {active ? <span aria-hidden className={tw('size-3 shrink-0 animate-spin rounded-full border border-[var(--text-tertiary)] border-r-transparent motion-reduce:animate-none')} /> : <Icon name="compressContext" size={14} className={tw('shrink-0', item.status === 'failed' && 'text-[var(--warning)]')} />}
        <span className={tw('shrink-0')}>{item.title}</span>
        {item.status === 'completed' ? <span className={tw('min-w-0 truncate text-[var(--text-tertiary)]')}>{item.text}</span> : null}
        <Icon name="chevronRight" size={12} className={tw('ml-auto shrink-0 text-[var(--text-tertiary)] transition-transform group-open/compact:rotate-90')} />
      </summary>
      <div className={tw('mb-2 ml-5 mt-1 grid min-w-0 gap-2 leading-5')}>
        <p className={tw('m-0')}>{item.status === 'completed' ? '早期内容已摘要，近期原文继续保留。原始聊天记录未删除。' : item.text}</p>
        {record.range ? <p className={tw('m-0 text-[var(--text-tertiary)]')}>处理范围：记录 {record.range.start} → {record.range.end}{record.model ? ` · ${record.provider ?? ''} / ${record.model}` : ''}</p> : null}
        {record.summary ? <div className={tw('max-h-72 min-w-0 overflow-auto rounded-lg bg-[var(--surface-secondary)] p-3')}><Markdown subdued source={record.summary} /></div> : null}
        {record.error ? <details className={tw('text-[var(--text-tertiary)]')}><summary className={tw('cursor-pointer')}>技术详情</summary><pre className={tw('max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs')}>{record.error}</pre></details> : null}
      </div>
    </details>
    {record.canRetry && onRetry ? <CompactButton variant="ghost" isDisabled={disabled} onPress={onRetry}>重新整理</CompactButton> : null}
  </article>
}
