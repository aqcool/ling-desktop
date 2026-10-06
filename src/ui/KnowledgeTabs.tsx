import { useId, useLayoutEffect, useRef } from 'react'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

export interface KnowledgeTab { id: string; title: string; source?: boolean }

/** Reading tabs are navigation only; closing one never removes the saved document. */
export function KnowledgeTabs({ tabs, activeId, onSelect, onClose }: {
  tabs: KnowledgeTab[]
  activeId: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const prefix = useId(), list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])
  return <div ref={list} role="tablist" aria-label="阅读标签" className={tw('sticky top-0 z-20 flex h-11 min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--panel-border)] bg-[var(--surface)] px-3 [scrollbar-width:none]')}>
    {tabs.map((tab, index) => <div key={tab.id} role="presentation" className={tw('group/tab flex h-7 min-w-28 max-w-48 shrink-0 items-center rounded-md', activeId === tab.id ? 'bg-[var(--surface-selected)] text-[var(--foreground)]' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')}>
      <button type="button" id={`${prefix}-${index}`} role="tab" aria-selected={activeId === tab.id} tabIndex={activeId === tab.id ? 0 : -1} title={tab.title} onClick={() => onSelect(tab.id)} onKeyDown={event => {
        if (event.key === 'Delete') { event.preventDefault(); onClose(tab.id); return }
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
        if (next === undefined) return
        event.preventDefault(); list.current?.querySelector<HTMLButtonElement>(`[id="${prefix}-${next}"]`)?.focus(); onSelect(tabs[next]!.id)
      }} className={tw('flex h-full min-w-0 flex-1 items-center gap-2 rounded-md border-0 bg-transparent px-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--focus)]')}>
        <Icon name={tab.source ? 'code' : 'book'} size={14} className={tw('text-[var(--text-tertiary)]')} /><span className={tw('truncate')}>{tab.title}</span>
      </button>
      <button type="button" aria-label={`关闭标签：${tab.title}`} title="关闭标签" onClick={() => onClose(tab.id)} className={tw('mr-1 flex size-5 shrink-0 items-center justify-center rounded border-0 bg-transparent text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--focus)] group-hover/tab:opacity-100', activeId === tab.id && 'opacity-100')}><Icon name="close" size={12} /></button>
    </div>)}
  </div>
}
