import type { CSSProperties, ReactNode } from 'react'
import type { LingTaskSummary, LingWorkspaceSummary } from '../../runtime/contract.js'
import { useBehavior } from '../behavior-preferences.js'
import { Icon, type IconName } from '../Icon.js'
import { Menu, MenuItem } from '../Menu.js'
import { tw } from '../tailwind.js'
import { taskAgeDays, visibleTasks, type TaskViewState } from '../task-view.js'
import { filterTaskWorkMode, useTaskWorkModes } from '../task-work-modes.js'
import { TaskRow } from '../TaskRow.js'
import type { WorkspaceDraft } from '../WorkspaceCreateDialog.js'
import { WorkspaceRow } from '../WorkspaceRow.js'
import type { DialogState, LingShellProps } from './types.js'

function copyTaskId(taskId: string) {
  const field = document.createElement('textarea')
  field.value = taskId
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) void navigator.clipboard?.writeText(taskId).catch(() => { })
}

export function WorkspaceSection({
  newTaskWorkspaceId,
  onExportTask,
  onNewTask,
  onOpenDialog,
  onSelectTask,
  onToggleArchive,
  selectedTask,
  tasks,
  viewState,
  onViewStateChange,
  onEditGroup,
  onEditWorkspace,
  onNewTaskInWorkspace,
  onCreateGroup,
  workspaceAppearance,
  workspaces,
}: Pick<LingShellProps, 'onExportTask' | 'onNewTask' | 'onSelectTask' | 'newTaskWorkspaceId'> & {
  readonly onToggleArchive: (taskId: string, archived: boolean) => void
  readonly onOpenDialog: (dialog: DialogState) => void
  readonly selectedTask?: LingTaskSummary
  readonly tasks: readonly LingTaskSummary[]
  readonly viewState: TaskViewState
  readonly onViewStateChange: (next: TaskViewState) => void
  readonly onEditGroup: (id: string) => void
  readonly onEditWorkspace: (id: string) => void
  readonly onNewTaskInWorkspace: (workspaceId: string) => void
  readonly onCreateGroup: () => void
  readonly workspaceAppearance: Readonly<Record<string, Pick<WorkspaceDraft, 'color' | 'marker'>>>
  readonly workspaces: readonly LingWorkspaceSummary[]
}) {
  const behavior = useBehavior()
  const modes = useTaskWorkModes()
  const modeTasks = filterTaskWorkMode(tasks, modes, behavior.separateTaskLists && viewState.view.modeFilter !== 'all' ? behavior.workMode : undefined)
  const activeTasks = visibleTasks(modeTasks.filter(task => !task.archived), viewState.view, new Date(), viewState.manualOrder, viewState.createdAtByTask)
  const toggle = (id: string) => {
    const collapsed = new Set(viewState.collapsedIds)
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    onViewStateChange({ ...viewState, collapsedIds: [...collapsed] })
  }
  const assign = (taskId: string, groupId: string | undefined) => {
    const assignments = { ...viewState.assignments }
    if (groupId) assignments[taskId] = groupId
    else delete assignments[taskId]
    onViewStateChange({ ...viewState, assignments })
  }
  const move = (sourceId: string, targetId: string) => {
    const source = activeTasks.find(task => task.taskId === sourceId)
    const target = activeTasks.find(task => task.taskId === targetId)
    if (!source || !target || source.workspaceId !== target.workspaceId) return
    const ids = activeTasks.map(task => task.taskId).filter(id => id !== sourceId)
    const targetIndex = ids.indexOf(targetId)
    if (targetIndex < 0) return
    ids.splice(targetIndex, 0, sourceId)
    onViewStateChange({ ...viewState, manualOrder: ids })
  }

  const toggleTaskFlag = (field: 'pinnedTaskIds' | 'workspacePinnedTaskIds' | 'unreadTaskIds', taskId: string) => {
    const current = viewState[field]
    onViewStateChange({ ...viewState, [field]: current.includes(taskId) ? current.filter(id => id !== taskId) : [...current, taskId] })
  }
  const selectTask = (taskId: string) => {
    if (viewState.unreadTaskIds.includes(taskId)) {
      onViewStateChange({ ...viewState, unreadTaskIds: viewState.unreadTaskIds.filter(id => id !== taskId) })
    }
    onSelectTask(taskId)
  }

  const renderTasks = (list: readonly LingTaskSummary[], archived: boolean) => (
    <div className={tw("sidebar-tasks grid mt-0.5")}>
      {list.length === 0 ? <p className={tw("sidebar-tasks__empty mt-0.5 mx-0 mb-1.5 pl-7 [color:var(--text-tertiary)] text-xs")}>暂无任务</p> : null}
      {[...list].sort((left, right) =>
        Number(viewState.workspacePinnedTaskIds.includes(right.taskId)) - Number(viewState.workspacePinnedTaskIds.includes(left.taskId)),
      ).map(task => (
        <TaskRow
          archived={archived}
          groups={viewState.groups}
          onAssignGroup={assign}
          assignedGroupId={viewState.assignments[task.taskId]}
          onCopyId={copyTaskId}
          onCreateGroup={onCreateGroup}
          onExport={onExportTask}
          onGlobalPin={taskId => { toggleTaskFlag('pinnedTaskIds', taskId) }}
          onMarkUnread={taskId => { toggleTaskFlag('unreadTaskIds', taskId) }}
          onOpenWindow={taskId => { const url = new URL(window.location.href); url.searchParams.set('task', taskId); window.open(url.href, '_blank', 'noopener,noreferrer') }}
          onRename={target => { onOpenDialog({ kind: 'rename-task', id: target.taskId, initial: target.title }) }}
          onWorkspacePin={taskId => { toggleTaskFlag('workspacePinnedTaskIds', taskId) }}
          key={task.taskId}
          onMove={viewState.view.sortBy === 'manual' ? move : undefined}
          onSelect={selectTask}
          onToggleArchive={onToggleArchive}
          selected={selectedTask?.taskId === task.taskId}
          task={task}
          unread={viewState.unreadTaskIds.includes(task.taskId)}
          globallyPinned={viewState.pinnedTaskIds.includes(task.taskId)}
          workspacePinned={viewState.workspacePinnedTaskIds.includes(task.taskId)}
          workspaceLabel={workspaces.find(workspace => workspace.workspaceId === task.workspaceId)?.label}
        />
      ))}
    </div>
  )

  const globallyPinnedTasks = activeTasks.filter(task => viewState.pinnedTaskIds.includes(task.taskId) && !viewState.archivedWorkspaceIds.includes(task.workspaceId ?? ''))
  const unpinnedTasks = activeTasks.filter(task => !viewState.pinnedTaskIds.includes(task.taskId))
  const byWorkspace = (workspaceId: string) => unpinnedTasks.filter(task => task.workspaceId === workspaceId)
  const unassigned = unpinnedTasks.filter(task => !task.workspaceId || !workspaces.some(workspace => workspace.workspaceId === task.workspaceId))
  const workspaceRows = workspaces.filter(workspace => viewState.view.workspaceId === 'all' || viewState.view.workspaceId === workspace.workspaceId)
  const shownWorkspaces = workspaceRows.filter(workspace => !viewState.archivedWorkspaceIds.includes(workspace.workspaceId))
    .sort((left, right) => Number(viewState.pinnedWorkspaceIds.includes(right.workspaceId)) - Number(viewState.pinnedWorkspaceIds.includes(left.workspaceId)))
  const togglePinned = (workspaceId: string) => {
    const pinned = viewState.pinnedWorkspaceIds.includes(workspaceId)
    onViewStateChange({
      ...viewState, pinnedWorkspaceIds: pinned
        ? viewState.pinnedWorkspaceIds.filter(id => id !== workspaceId)
        : [...viewState.pinnedWorkspaceIds, workspaceId]
    })
  }
  const toggleArchivedWorkspace = (workspaceId: string) => {
    if (newTaskWorkspaceId === workspaceId) onNewTask()
    onViewStateChange({
      ...viewState,
      archivedWorkspaceIds: [...viewState.archivedWorkspaceIds, workspaceId],
      view: viewState.view.workspaceId === workspaceId ? { ...viewState.view, workspaceId: 'all' } : viewState.view,
    })
  }
  const workspaceRow = (workspace: LingWorkspaceSummary) => (
    <WorkspaceRow
      appearance={workspaceAppearance[workspace.workspaceId] ?? workspaceAppearance[workspace.locationLabel ?? '']}
      archived={false}
      collapsed={viewState.collapsedIds.includes(workspace.workspaceId)}
      key={workspace.workspaceId}
      onArchive={() => { toggleArchivedWorkspace(workspace.workspaceId) }}
      onEdit={() => { onEditWorkspace(workspace.workspaceId) }}
      onNewTask={() => { onNewTaskInWorkspace(workspace.workspaceId) }}
      onPin={() => { togglePinned(workspace.workspaceId) }}
      onRemove={() => { onOpenDialog({ kind: 'delete-workspace', id: workspace.workspaceId, initial: workspace.label }) }}
      onToggle={() => { toggle(workspace.workspaceId) }}
      pinned={viewState.pinnedWorkspaceIds.includes(workspace.workspaceId)}
      tasks={activeTasks.filter(task => task.workspaceId === workspace.workspaceId)}
      unreadCount={activeTasks.filter(task => task.workspaceId === workspace.workspaceId && viewState.unreadTaskIds.includes(task.taskId)).length}
      workspace={workspace}
    >{renderTasks(byWorkspace(workspace.workspaceId), false)}</WorkspaceRow>
  )

  const section = (id: string, label: string, list: readonly LingTaskSummary[], icon: IconName = 'folder', actions?: ReactNode, color?: string) => (
    <section className={tw("sidebar-project mb-3")} key={id}>
      <div className={tw("sidebar-project__heading flex min-h-control items-center gap-0 px-0.5 font-[590] hover:bg-transparent focus-within:bg-transparent")}>
        <button aria-expanded={!viewState.collapsedIds.includes(id)} aria-label={`${viewState.collapsedIds.includes(id) ? '展开' : '折叠'}${label}`} className={tw("sidebar-project__toggle inline-flex items-center justify-start border-0 bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:var(--foreground)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px] min-w-0 [min-height:2rem] flex-1 gap-1.5 py-0 px-2 rounded-lg text-left")} onClick={() => { toggle(id) }} type="button">
          <Icon name={viewState.collapsedIds.includes(id) ? 'chevronRight' : 'chevronDown'} size={13} />
          <span className={tw("sidebar-project__icon inline-flex flex-none")} style={color ? { color } as CSSProperties : undefined}><Icon name={icon} size={16} /></span>
          <span className={tw("sidebar-project__name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [color:var(--text-secondary)] text-compact [font-weight:500]")} title={label}>{label}</span>
        </button>
        {actions}
      </div>
      {!viewState.collapsedIds.includes(id) ? renderTasks(list, false) : null}
    </section>
  )

  return (
    <div className={tw("sidebar-projects__list grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-px overflow-x-hidden overflow-y-auto")}>
      {viewState.view.groupBy === 'workspace' && globallyPinnedTasks.length > 0 ? section('global-pinned', '已置顶', globallyPinnedTasks, 'pin') : null}
      {viewState.view.groupBy === 'workspace' ? shownWorkspaces.map(workspace => workspaceRow(workspace)) : null}
      {viewState.view.groupBy === 'workspace' && unassigned.length > 0 ? section('unassigned', '无工作区', unassigned) : null}
      {viewState.view.groupBy === 'activity' ? [
        { id: 'today', label: '今天', matches: (days: number) => days === 0 },
        { id: 'week', label: '最近 7 天', matches: (days: number) => days > 0 && days < 7 },
        { id: 'month', label: '最近 30 天', matches: (days: number) => days >= 7 && days < 30 },
        { id: 'older', label: '更早', matches: (days: number) => days >= 30 },
      ].map(bucket => {
        const list = activeTasks.filter(task => bucket.matches(taskAgeDays(task)))
        return list.length > 0 ? section(bucket.id, bucket.label, list, 'clock') : null
      }) : null}
      {viewState.view.groupBy === 'custom' ? <>
        {viewState.groups.map(group => section(group.id, group.name, activeTasks.filter(task => viewState.assignments[task.taskId] === group.id), group.marker as IconName,
          <Menu triggerAriaLabel={`分组 ${group.name} 操作`} triggerClassName="sidebar-project__more" triggerLabel={<Icon name="more" size={15} />}>
            <MenuItem icon="edit" onPress={() => { onEditGroup(group.id) }}>编辑分组</MenuItem>
            <MenuItem danger icon="trash" onPress={() => {
              const assignments = Object.fromEntries(Object.entries(viewState.assignments).filter(([, id]) => id !== group.id))
              onViewStateChange({ ...viewState, groups: viewState.groups.filter(item => item.id !== group.id), assignments })
            }}>删除分组</MenuItem>
          </Menu>, group.color))}
        {section('ungrouped', '未分组对话', activeTasks.filter(task => !viewState.groups.some(group => group.id === viewState.assignments[task.taskId])))}
      </> : null}
    </div>
  )
}
