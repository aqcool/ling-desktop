import { useEffect, useState } from 'react'
import type { LingCommandResult } from '../../runtime/contract.js'
import { readTaskViewState, taskViewStorageKey, type TaskViewState } from '../task-view.js'
import type { WorkspaceDraft } from '../WorkspaceCreateDialog.js'
import type { DialogState, LingShellProps } from './types.js'

export function useTaskSidebar(props: Pick<LingShellProps, 'onCreateWorkspace' | 'onDeleteWorkspace' | 'onRenameTask' | 'onRenameWorkspace' | 'tasks' | 'workspaces'>) {
  const { tasks, workspaces } = props
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string>()
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string>()
  const [taskViewState, setTaskViewState] = useState(() => readTaskViewState(window.localStorage.getItem(taskViewStorageKey)))
  const [workspaceAppearance, setWorkspaceAppearance] = useState<Record<string, Pick<WorkspaceDraft, 'color' | 'marker'>>>(() => {
    try { return JSON.parse(window.localStorage.getItem('ling.workspace-appearance.v1') ?? '{}') as Record<string, Pick<WorkspaceDraft, 'color' | 'marker'>> }
    catch { return {} }
  })
  useEffect(() => { window.localStorage.setItem(taskViewStorageKey, JSON.stringify(taskViewState)) }, [taskViewState])
  useEffect(() => { window.localStorage.setItem('ling.workspace-appearance.v1', JSON.stringify(workspaceAppearance)) }, [workspaceAppearance])
  useEffect(() => {
    setTaskViewState(current => {
      const unseen = tasks.filter(task => !task.createdAt && !current.createdAtByTask[task.taskId])
      if (unseen.length === 0) return current
      return { ...current, createdAtByTask: { ...current.createdAtByTask, ...Object.fromEntries(unseen.map(task => [task.taskId, task.updatedAt])) } }
    })
  }, [tasks])

  const beginAddWorkspace = () => {
    setCreatingWorkspace(true)
  }

  const createWorkspace = async (draft: WorkspaceDraft): Promise<LingCommandResult> => {
    const result = await props.onCreateWorkspace(draft.path, draft.name)
    if (result.accepted) setWorkspaceAppearance(current => ({ ...current, [result.output?.workspaceId ?? draft.path]: { color: draft.color, marker: draft.marker } }))
    return result
  }

  const workspace = workspaces.find(item => item.workspaceId === editingWorkspaceId)
  const appearance = workspace && (workspaceAppearance[workspace.workspaceId] ?? workspaceAppearance[workspace.locationLabel ?? ''])
  const editingWorkspace = workspace ? {
    workspaceId: workspace.workspaceId,
    path: workspace.locationLabel ?? '',
    name: workspace.label,
    color: appearance?.color ?? '',
    marker: appearance?.marker ?? 'folder',
  } : undefined

  const saveWorkspace = async (workspaceId: string, draft: WorkspaceDraft): Promise<LingCommandResult> => {
    const target = workspaces.find(item => item.workspaceId === workspaceId)
    if (!target || !draft.name.trim()) return { accepted: false, requestId: '', reason: 'invalid-command', message: '工作区不存在或名称为空。', retryable: false }
    // DSH binds session membership to the immutable workspace path and session cwd.
    if (draft.path !== (target.locationLabel ?? '')) return { accepted: false, requestId: '', reason: 'invalid-command', message: '当前不支持直接修改工作区路径。', retryable: false }
    const result: LingCommandResult = draft.name.trim() === target.label
      ? { accepted: true, requestId: '' }
      : await props.onRenameWorkspace(workspaceId, draft.name.trim())
    if (result.accepted) setWorkspaceAppearance(current => ({ ...current, [workspaceId]: { color: draft.color, marker: draft.marker } }))
    return result
  }

  const saveGroup = (group: TaskViewState['groups'][number]) => {
    setTaskViewState(current => ({
      ...current, groups: current.groups.some(item => item.id === group.id)
        ? current.groups.map(item => item.id === group.id ? group : item)
        : [...current.groups, group]
    }))
  }

  const visibleSectionIds = taskViewState.view.groupBy === 'workspace'
    ? [...workspaces.filter(workspace => !taskViewState.archivedWorkspaceIds.includes(workspace.workspaceId)).map(workspace => workspace.workspaceId), 'unassigned']
    : taskViewState.view.groupBy === 'activity' ? ['today', 'week', 'month', 'older'] : [...taskViewState.groups.map(group => group.id), 'ungrouped']
  const allCollapsed = visibleSectionIds.every(id => taskViewState.collapsedIds.includes(id))
  const toggleAll = () => {
    setTaskViewState(current => ({
      ...current, collapsedIds: allCollapsed
        ? current.collapsedIds.filter(id => !visibleSectionIds.includes(id))
        : [...new Set([...current.collapsedIds, ...visibleSectionIds])]
    }))
  }

  const confirmDialog = async (value: string): Promise<LingCommandResult> => {
    if (!dialog) return { accepted: false, requestId: '', reason: 'invalid-command', message: '无效操作。', retryable: false }
    switch (dialog.kind) {
      case 'rename-task': return await props.onRenameTask(dialog.id ?? '', value)
      case 'delete-workspace': return await props.onDeleteWorkspace(dialog.id ?? '')
      case 'add-workspace': return await props.onCreateWorkspace(value)
    }
  }

  const dialogCopy: Record<DialogState['kind'], { title: string; label: string; placeholder?: string; confirm?: string; danger?: boolean; description?: string }> = {
    'rename-task': { title: '重命名任务', label: '任务名称' },
    'add-workspace': { title: '添加工作区', label: '目录路径', placeholder: '/absolute/path/to/project', confirm: '添加', description: '输入要纳入灵创管理的本地目录绝对路径。' },
    'delete-workspace': { title: '移除工作区', label: '工作区名称', confirm: '移除', danger: true, description: '仅从灵创移除该工作区，不会删除磁盘文件。' },
  }

  return {
    dialog,
    setDialog,
    creatingWorkspace,
    setCreatingWorkspace,
    editingWorkspace,
    setEditingWorkspaceId,
    creatingGroup,
    setCreatingGroup,
    editingGroupId,
    setEditingGroupId,
    taskViewState,
    setTaskViewState,
    workspaceAppearance,
    beginAddWorkspace,
    createWorkspace,
    saveWorkspace,
    saveGroup,
    allCollapsed,
    toggleAll,
    confirmDialog,
    dialogCopy,
  }
}
