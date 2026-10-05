import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../Icon.js'
import { Menu, MenuItem } from '../Menu.js'
import { tw } from '../tailwind.js'
import type { WorkbenchTab, WorkbenchTabKind } from './types.js'

export function WorkbenchHomeAction({ detail, icon, onClick, title }: { readonly detail?: string; readonly icon: IconName; readonly onClick: () => void; readonly title: string }) {
  return (
    <button className={tw("mx-auto grid min-h-13 w-[min(15rem,calc(100%_-_1rem))] cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 py-1.5 text-left [color:var(--foreground)] hover:bg-[var(--surface-secondary)]")} onClick={onClick} type="button">
      <span className={tw("grid size-control-lg place-items-center rounded-md bg-[var(--surface-tertiary)] [color:var(--text-secondary)]")}><Icon name={icon} size={17} /></span>
      <span className={tw("flex min-w-0 flex-col justify-center gap-0.5")}><strong className={tw("block overflow-hidden text-ellipsis whitespace-nowrap text-compact font-medium leading-[18px]")}>{title}</strong>{detail ? <small className={tw("block overflow-hidden text-ellipsis whitespace-nowrap text-caption leading-[14px] [color:var(--text-tertiary)]")}>{detail}</small> : null}</span>
    </button>
  )
}

function workbenchTabIcon(kind: WorkbenchTabKind): IconName {
  return kind === 'document' ? 'file' : kind === 'side-task' ? 'sideChat' : kind === 'files' ? 'folderOpen' : kind === 'browser' ? 'globe' : kind === 'review' ? 'review' : 'terminalSquare'
}

export function WorkbenchTabs({ tabs, activeId, onSelect, onClose }: {
  readonly tabs: readonly WorkbenchTab[]
  readonly activeId?: string
  readonly onSelect: (id: string) => void
  readonly onClose: (id: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const visibleCount = Math.max(1, Math.floor((availableWidth + 4) / 120))
  const overflow = availableWidth > 0 && tabs.length > visibleCount
  const tabWidth = overflow ? (availableWidth - (visibleCount - 1) * 4) / visibleCount : undefined

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let frame = 0
    const revealActive = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setAvailableWidth(list.clientWidth)
        const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement
        if (!selected) return
        const bounds = list.getBoundingClientRect()
        const tab = selected.getBoundingClientRect()
        if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left
        else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right
      })
    }
    revealActive()
    const observer = new ResizeObserver(revealActive)
    observer.observe(list)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [activeId, tabs, availableWidth])

  return <div className={tw("flex min-w-0 flex-1 items-center gap-0.5")}>
    <div aria-label="工作面与文件标签页" className={tw("flex h-control min-w-0 flex-1 items-center gap-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none]")} ref={listRef} role="tablist">
      {tabs.map((tab, index) => <div className={tw("group/tab [-webkit-app-region:no-drag] flex h-control-sm min-w-0 shrink-0 snap-start items-center rounded-md px-1", !overflow && "max-w-44", tab.id === activeId ? "bg-[var(--surface-tertiary)] text-[var(--foreground)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]")} key={tab.id} style={tabWidth ? { width: tabWidth } : undefined}>
        <button aria-selected={tab.id === activeId} className={tw("flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm border-0 bg-transparent px-1 text-compact outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]")} onClick={() => { onSelect(tab.id) }} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
          const target = tabs[next]
          if (target) { onSelect(target.id); listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus() }
        }} role="tab" tabIndex={tab.id === activeId ? 0 : -1} title={tab.label} type="button">
          <Icon className={tw("shrink-0")} name={workbenchTabIcon(tab.kind)} size={16} />
          <span className={tw("min-w-0 truncate")}>{tab.label}</span>
        </button>
        <button aria-label={`关闭 ${tab.label} 标签页`} className={tw("grid size-5 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--focus)]")} onClick={() => { onClose(tab.id) }} type="button"><Icon name="close" size={11} /></button>
      </div>)}
    </div>
    {overflow ? <Menu align="end" triggerAriaLabel="已打开的标签页" triggerClassName="[-webkit-app-region:no-drag] size-control-xs shrink-0 justify-center rounded-md p-0" triggerLabel={<Icon name="chevronDown" size={14} />}>
      {tabs.map(tab => <MenuItem suffix={tab.id === activeId ? <Icon name="check" size={13} /> : undefined} icon={workbenchTabIcon(tab.kind)} key={tab.id} onPress={() => { onSelect(tab.id) }}>{tab.label}</MenuItem>)}
    </Menu> : null}
  </div>
}

export function WorkbenchHeaderAction({ active = false, expanded, controls, icon, label, onClick }: {
  readonly active?: boolean
  readonly expanded?: boolean
  readonly controls?: string
  readonly icon: IconName
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      className={tw(
        "[-webkit-app-region:no-drag] grid size-control-sm shrink-0 place-items-center rounded-md border-0 p-0 text-[var(--text-secondary)] shadow-none outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        active ? "bg-[var(--surface-secondary)] text-[var(--foreground)]" : "bg-transparent",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon active={active} name={icon} size={17} />
    </button>
  )
}
