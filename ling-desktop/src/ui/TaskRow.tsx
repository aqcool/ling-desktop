import { Dropdown } from '@heroui/react/dropdown'
import { Label } from '@heroui/react/label'
import { Separator } from '@heroui/react/separator'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LingTaskSummary } from '../runtime/contract.js'
import type { TaskGroup } from './task-view.js'
import { Icon } from './Icon.js'
import { tw } from './tailwind.js'

interface TaskRowProps {
  readonly task: LingTaskSummary
  readonly workspaceLabel?: string
  readonly archived: boolean
  readonly selected: boolean
  readonly unread: boolean
  readonly globallyPinned: boolean
  readonly workspacePinned: boolean
  readonly groups: readonly TaskGroup[]
  readonly assignedGroupId?: string
  readonly onSelect: (taskId: string) => void
  readonly onMove?: (sourceId: string, targetId: string) => void
  readonly onOpenWindow: (taskId: string) => void
  readonly onCopyId: (taskId: string) => void
  readonly onRename: (task: LingTaskSummary) => void
  readonly onExport: (task: LingTaskSummary) => void
  readonly onGlobalPin: (taskId: string) => void
  readonly onWorkspacePin: (taskId: string) => void
  readonly onAssignGroup: (taskId: string, groupId: string | undefined) => void
  readonly onCreateGroup: () => void
  readonly onMarkUnread: (taskId: string) => void
  readonly onToggleArchive: (taskId: string, archived: boolean) => void
}

function relativeTime(iso: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(iso))
  if (!Number.isFinite(elapsed)) return ''
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${String(minutes)}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${String(days)}天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

export function TaskRow({ task, workspaceLabel, archived, selected, unread, globallyPinned, workspacePinned, groups, assignedGroupId, onSelect, onMove, onOpenWindow, onCopyId, onRename, onExport, onGlobalPin, onWorkspacePin, onAssignGroup, onCreateGroup, onMarkUnread, onToggleArchive }: TaskRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const previewWidth = 300

  const updatePosition = () => {
    const row = rowRef.current?.getBoundingClientRect()
    if (!row) return
    const right = row.right + 8
    setPosition({
      left: right + previewWidth <= window.innerWidth - 8 ? right : Math.max(8, row.left - previewWidth - 8),
      top: Math.max(8, Math.min(row.top - 1, window.innerHeight - 70)),
    })
  }
  const showPreview = () => {
    window.clearTimeout(closeTimer.current)
    if (menuOpen) return
    updatePosition()
    setPreviewOpen(true)
  }
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { setPreviewOpen(false) }, 150)
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

  return (
    <div
      className={tw("sidebar-task group relative flex min-h-7 min-w-0 items-center gap-0 rounded-md border-0 bg-transparent pr-1 pl-2 text-left hover:bg-[var(--surface-hover)] focus-within:bg-[var(--surface-hover)] dark:hover:bg-[#2a2a2d] dark:hover:text-[#ededee]", selected && "sidebar-task--active bg-[var(--surface-selected)] hover:bg-[var(--surface-selected)] focus-within:bg-[var(--surface-selected)] dark:bg-[#2a2a2d] dark:text-[#ededee]", unread && "sidebar-task--unread")}
      draggable={!!onMove}
      onDragStart={event => { event.dataTransfer.setData('text/plain', task.taskId); event.dataTransfer.effectAllowed = 'move' }}
      onDragOver={event => { if (onMove) event.preventDefault() }}
      onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain'); if (sourceId && sourceId !== task.taskId) onMove?.(sourceId, task.taskId) }}
      onMouseEnter={showPreview}
      onMouseLeave={scheduleClose}
      ref={rowRef}
    >
      <button className={tw("sidebar-task__main flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded-md border-0 bg-transparent py-0.5 pr-1.5 pl-5 text-left")} onClick={() => { onSelect(task.taskId) }} title={task.title} type="button">
        <span className={tw("sidebar-task__title flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.8125rem] font-medium text-[var(--text-secondary)] dark:text-[#e4e4e6]", selected && "font-semibold text-[#171717] dark:text-[#f2f2f3]", unread && "font-[650] text-[var(--foreground)]")}>{task.title}</span>
        {globallyPinned || workspacePinned ? <Icon className={tw("flex-none text-[var(--text-tertiary)]")} active name="pin" size={12} /> : null}
        {unread ? <span className={tw("sidebar-task__unread-dot [width:0.4rem] [height:0.4rem] flex-none [border-radius:50%] [background:#c96343]")} aria-label="未读" /> : null}
      </button>
      <Dropdown isOpen={menuOpen} onOpenChange={(open: boolean) => { setMenuOpen(open); if (open) { window.clearTimeout(closeTimer.current); setPreviewOpen(false) } }}>
        <Dropdown.Trigger aria-label={`任务 ${task.title} 操作`} className={tw("sidebar-task__more pointer-events-none absolute top-1/2 right-1 inline-flex h-6.5 w-6.5 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-[var(--surface-hover)] p-0 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100")} title="更多会话操作"><Icon name="more" size={16} /></Dropdown.Trigger>
        <Dropdown.Popover className={tw("task-row__menu max-h-[min(25rem,calc(100vh-1rem))] min-w-40 overflow-auto rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-0 shadow-[0_12px_26px_rgb(0_0_0_/_0.14)]")} offset={4} placement="bottom end">
          <Dropdown.Menu aria-label={`任务 ${task.title} 操作`} className={tw("gap-0 p-1")}>
            <Dropdown.Item id="open-window" onAction={() => { onOpenWindow(task.taskId) }} textValue="在新窗口中打开"><Icon name="window" size={16} /><Label>在新窗口中打开</Label></Dropdown.Item>
            <Dropdown.Item id="copy-id" onAction={() => { onCopyId(task.taskId) }} textValue="复制任务 ID"><Icon name="copy" size={16} /><Label>复制任务 ID</Label></Dropdown.Item>
            <Dropdown.Item id="rename" onAction={() => { onRename(task) }} textValue="重命名"><Icon name="edit" size={16} /><Label>重命名</Label></Dropdown.Item>
            <Dropdown.Item id="export" onAction={() => { onExport(task) }} textValue="导出记录"><Icon name="download" size={16} /><Label>导出记录</Label></Dropdown.Item>
            <Dropdown.Item id="global-pin" onAction={() => { onGlobalPin(task.taskId) }} textValue={globallyPinned ? '取消全局置顶' : '全局置顶'}><Icon name="pin" size={16} /><Label>{globallyPinned ? '取消全局置顶' : '全局置顶'}</Label></Dropdown.Item>
            <Dropdown.Item id="workspace-pin" onAction={() => { onWorkspacePin(task.taskId) }} textValue={workspacePinned ? '取消工作区内置顶' : '在工作区内置顶'}><Icon name="pin" size={16} /><Label>{workspacePinned ? '取消工作区内置顶' : '在工作区内置顶'}</Label></Dropdown.Item>
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="move-group" textValue="移动到分组"><Icon name="folderMove" size={16} /><Label>移动到分组</Label><Dropdown.SubmenuIndicator /></Dropdown.Item>
              <Dropdown.Popover className={tw("task-row__submenu max-h-[min(25rem,calc(100vh-1rem))] min-w-40 overflow-auto rounded-xl border border-[var(--panel-border)] bg-[var(--surface)] p-0 shadow-[0_12px_26px_rgb(0_0_0_/_0.14)]")} placement="right top">
                <Dropdown.Menu aria-label="移动到分组" className={tw("gap-0 p-1")}>
                  <Dropdown.Item id="ungrouped" onAction={() => { onAssignGroup(task.taskId, undefined) }} textValue="未分组"><Icon name="folder" size={16} /><Label>未分组{!assignedGroupId ? ' ✓' : ''}</Label></Dropdown.Item>
                  {groups.map(group => <Dropdown.Item id={group.id} key={group.id} onAction={() => { onAssignGroup(task.taskId, group.id) }} textValue={group.name}><Icon name="folder" size={16} /><Label>{group.name}{assignedGroupId === group.id ? ' ✓' : ''}</Label></Dropdown.Item>)}
                  <Separator />
                  <Dropdown.Item id="create-group" onAction={onCreateGroup} textValue="新建分组"><Icon name="folderPlus" size={16} /><Label>新建分组</Label></Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>
            <Dropdown.Item id="unread" onAction={() => { onMarkUnread(task.taskId) }} textValue={unread ? '标记为已读' : '标记为未读'}><Icon name="mailUnread" size={16} /><Label>{unread ? '标记为已读' : '标记为未读'}</Label></Dropdown.Item>
            <Dropdown.Item id="side-task" isDisabled textValue="开始侧边任务" title="当前运行时尚不支持从会话菜单启动侧边任务"><Icon name="branch" size={16} /><Label>开始侧边任务</Label></Dropdown.Item>
            <Separator />
            <Dropdown.Item id="archive" onAction={() => { onToggleArchive(task.taskId, !archived) }} textValue={archived ? '恢复任务' : '归档'} variant={archived ? 'default' : 'danger'}><Icon name={archived ? 'refresh' : 'archive'} size={16} /><Label>{archived ? '恢复任务' : '归档'}</Label></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
      {previewOpen ? createPortal(
        <div className={tw("task-preview fixed [z-index:45] [width:18.75rem] [padding:0.65rem_0.75rem] [border:1px_solid_var(--panel-border)] [border-radius:0.65rem] [background:var(--surface)] [box-shadow:0_10px_24px_rgb(0_0_0_/_0.14)] [color:var(--foreground)]")} onMouseEnter={showPreview} onMouseLeave={scheduleClose} style={{ left: position.left, top: position.top }}>
          <div className={tw("task-preview__heading flex min-w-0 items-center gap-2.5")}><strong className={tw("min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[0.84rem] font-[650]")}>{task.title}</strong><time className={tw("flex-none text-[0.76rem] text-[var(--text-tertiary)]")} dateTime={task.updatedAt} title={new Date(task.updatedAt).toLocaleString('zh-CN')}>{relativeTime(task.updatedAt)}</time></div>
          <div className={tw("task-preview__workspace mt-2.5 flex min-w-0 items-center gap-2 text-[0.78rem] text-[var(--text-secondary)]")}><Icon className={tw("flex-none text-[var(--text-tertiary)]")} name="folder" size={16} /><span className={tw("overflow-hidden text-ellipsis whitespace-nowrap")}>{workspaceLabel ?? '无工作区'}</span></div>
        </div>, document.body,
      ) : null}
    </div>
  )
}
