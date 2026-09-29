import { Dropdown } from '@heroui/react/dropdown'
import { Label } from '@heroui/react/label'
import { Separator } from '@heroui/react/separator'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LingTaskSummary, LingWorkspaceSummary } from '../runtime/contract.js'
import { Icon, type IconName } from './Icon.js'
import { tw } from './tailwind.js'

interface WorkspaceRowProps {
  readonly workspace: LingWorkspaceSummary
  readonly tasks: readonly LingTaskSummary[]
  readonly unreadCount: number
  readonly appearance?: { readonly color: string; readonly marker: string }
  readonly collapsed: boolean
  readonly pinned: boolean
  readonly archived: boolean
  readonly onToggle: () => void
  readonly onNewTask: () => void
  readonly onPin: () => void
  readonly onEdit: () => void
  readonly onArchive: () => void
  readonly onRemove: () => void
  readonly children?: ReactNode
}

const previewWidth = 320

export function WorkspaceRow({ workspace, tasks, unreadCount, appearance, collapsed, pinned, archived, onToggle, onNewTask, onPin, onEdit, onArchive, onRemove, children }: WorkspaceRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const rowHovered = useRef(false)
  const menuOpenRef = useRef(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  const updatePosition = () => {
    const row = rowRef.current?.getBoundingClientRect()
    if (!row) return
    const right = row.right + 14
    setPosition({
      left: right + previewWidth <= window.innerWidth - 8 ? right : Math.max(8, row.left - previewWidth - 14),
      top: Math.max(8, Math.min(row.top, window.innerHeight - 104)),
    })
  }
  const showPreview = () => {
    rowHovered.current = true
    window.clearTimeout(closeTimer.current)
    if (menuOpenRef.current) return
    updatePosition()
    setPreviewOpen(true)
  }
  const scheduleClose = () => {
    rowHovered.current = false
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { if (!menuOpenRef.current) setPreviewOpen(false) }, 300)
  }

  useEffect(() => {
    if (!previewOpen) return
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [previewOpen])
  useEffect(() => () => { window.clearTimeout(closeTimer.current) }, [])

  const marker = (appearance?.marker ?? 'folder') as IconName
  const disclosureMarker = marker === 'folder' && !collapsed ? 'folderOpen' : marker
  const iconStyle = appearance?.color ? { color: appearance.color } as CSSProperties : undefined
  const activeCount = tasks.filter(task => task.status === 'running' || task.status === 'queued').length
  const action = (callback: () => void) => { menuOpenRef.current = false; setMenuOpen(false); setPreviewOpen(false); callback() }

  return (
    <section className={tw(`sidebar-project [margin-bottom:0.75rem] sidebar-project--workspace${archived ? " sidebar-project--archived-workspace [opacity:0.72]" : ""}`)}>
      <div className={tw("sidebar-project__heading workspace-row group relative flex min-h-8 items-center gap-0 rounded-lg pr-1 font-[590] hover:bg-[var(--surface-hover)] focus-within:bg-[var(--surface-hover)]")} onMouseEnter={showPreview} onMouseLeave={scheduleClose} ref={rowRef}>
        <button aria-expanded={!collapsed} aria-label={`${collapsed ? '展开' : '折叠'}工作目录 ${workspace.label}`} className={tw("workspace-row__disclosure grid h-7 w-4 flex-none place-items-center border-0 bg-transparent p-0 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")} onClick={onToggle} type="button">
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
        </button>
        <button aria-label={workspace.label} className={tw("sidebar-project__toggle inline-flex items-center justify-start border-0 bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:var(--foreground)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px] min-w-0 [min-height:2rem] flex-1 [gap:0.35rem] [padding:0_0.45rem] [border-radius:0.45rem] text-left")} onClick={onToggle} type="button">
          <span className={tw("sidebar-project__icon inline-flex flex-none")} style={iconStyle}><Icon name={disclosureMarker} size={16} /></span>
          <span className={tw("sidebar-project__name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [color:var(--text-secondary)] [font-size:0.8125rem] [font-weight:500]")} title={workspace.label}>{workspace.label}</span>
          {pinned ? <span className={tw("workspace-row__pinned inline-flex [color:var(--text-tertiary)]")}><Icon active name="pin" size={12} /></span> : null}
        </button>
        <span className={tw("workspace-row__actions pointer-events-none absolute top-1/2 right-1 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-[var(--surface-hover)] opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100")}>
          <Dropdown isOpen={menuOpen} onOpenChange={(open: boolean) => {
            menuOpenRef.current = open
            setMenuOpen(open)
            if (open) setPreviewOpen(false)
            else if (rowHovered.current) showPreview()
          }}>
            <Dropdown.Trigger aria-label={`工作区 ${workspace.label} 更多操作`} className={tw("sidebar-project__more inline-flex [width:1.65rem] [height:1.65rem] flex-none items-center justify-center p-0 border-0 [border-radius:0.4rem] bg-transparent [color:var(--text-tertiary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:var(--text-secondary)] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:1px]")} title="更多工作目录操作"><Icon name="more" size={16} /></Dropdown.Trigger>
            <Dropdown.Popover className={tw("workspace-row__menu min-w-42 rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-0 shadow-[0_12px_26px_rgb(0_0_0_/_0.14)]")} crossOffset={-116} offset={4} placement="bottom start">
              <Dropdown.Menu aria-label={`${workspace.label} 操作`} className={tw("gap-0 p-1")}>
                {!archived ? <Dropdown.Item id="pin" onAction={() => { action(onPin) }} textValue={pinned ? '取消置顶' : '置顶'}><Icon name="pin" size={16} /><Label>{pinned ? '取消置顶' : '置顶'}</Label></Dropdown.Item> : null}
                {!archived ? <Dropdown.Item id="edit" onAction={() => { action(onEdit) }} textValue="编辑"><Icon name="edit" size={16} /><Label>编辑</Label></Dropdown.Item> : null}
                {!archived ? <Separator /> : null}
                <Dropdown.Item id="archive" onAction={() => { action(onArchive) }} textValue={archived ? '恢复工作区' : '归档工作区'} variant={archived ? 'default' : 'danger'}><Icon name={archived ? 'refresh' : 'archive'} size={16} /><Label>{archived ? '恢复工作区' : '归档工作区'}</Label></Dropdown.Item>
                {archived ? <><Separator /><Dropdown.Item id="remove" onAction={() => { action(onRemove) }} textValue="移除工作区" variant="danger"><Icon name="trash" size={16} /><Label>移除工作区</Label></Dropdown.Item></> : null}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
          {!archived ? <button aria-label={`在 ${workspace.label} 中新建任务`} className={tw("workspace-row__add grid [width:1.65rem] [height:1.65rem] place-items-center border-0 [border-radius:0.35rem] bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-tertiary)] hover:[color:var(--foreground)]")} onClick={onNewTask} title="新任务" type="button"><Icon name="plus" size={15} /></button> : null}
        </span>
      </div>
      {!collapsed && !archived ? children : null}
      {previewOpen ? createPortal(
        <div className={tw("workspace-preview fixed [z-index:45] [width:20rem] [padding:0.55rem_0.7rem] [border:1px_solid_var(--panel-border)] [border-radius:0.6rem] [background:var(--surface)] [box-shadow:0_8px_18px_rgb(0_0_0_/_0.13)] [color:var(--foreground)]")} onMouseEnter={showPreview} onMouseLeave={scheduleClose} style={{ left: position.left, top: position.top }}>
          <div className={tw("workspace-preview__header flex min-h-5.5 min-w-0 items-center gap-2")}>
            <span className={tw("workspace-preview__icon inline-flex flex-none [color:#c96343]")} style={iconStyle}><Icon name={marker} size={16} /></span>
            <strong className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8125rem] font-[650]")}>{workspace.label}</strong>
            <button aria-label={pinned ? '取消置顶工作区' : '置顶工作区'} aria-pressed={pinned} className={tw("workspace-preview__pin grid [width:1.35rem] [height:1.35rem] place-items-center border-0 [border-radius:0.3rem] bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:var(--foreground)] aria-pressed:[color:#c96343]")} onClick={onPin} type="button"><Icon active={pinned} name="pin" size={15} /></button>
          </div>
          <div className={tw("workspace-preview__detail mt-1 flex min-h-5 min-w-0 items-center gap-2 text-xs text-[var(--text-secondary)]")}><Icon className={tw("flex-none text-[var(--text-tertiary)]")} name="refresh" size={14} /><span className={tw("min-w-0 overflow-hidden text-ellipsis whitespace-nowrap")}>{tasks.length} 个任务 · {unreadCount} 个未读 · {activeCount} 个活跃</span></div>
          <div className={tw("workspace-preview__detail workspace-preview__path mt-1 flex min-h-5 min-w-0 items-center gap-2 text-xs text-[var(--text-secondary)]")} title={workspace.locationLabel}><Icon className={tw("flex-none text-[var(--text-tertiary)]")} name="folder" size={15} /><span className={tw("min-w-0 overflow-hidden text-ellipsis whitespace-nowrap")}>{workspace.locationLabel ?? '未指定路径'}</span></div>
        </div>, document.body,
      ) : null}
    </section>
  )
}
