import type { LingTaskSummary } from '../runtime/contract.js'

export type TaskGroupBy = 'workspace' | 'custom' | 'activity'
export type TaskSortBy = 'manual' | 'updated' | 'name' | 'created'
export type TaskRecency = 'all' | 'today' | '7days' | '30days'

export interface TaskView {
  readonly groupBy: TaskGroupBy
  readonly sortBy: TaskSortBy
  readonly workspaceId: string
  readonly recency: TaskRecency
}

export interface TaskGroup {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly marker: string
}

export interface TaskViewState {
  readonly view: TaskView
  readonly groups: readonly TaskGroup[]
  readonly assignments: Readonly<Record<string, string>>
  readonly collapsedIds: readonly string[]
  readonly manualOrder: readonly string[]
  readonly pinnedWorkspaceIds: readonly string[]
  readonly archivedWorkspaceIds: readonly string[]
  readonly pinnedTaskIds: readonly string[]
  readonly workspacePinnedTaskIds: readonly string[]
  readonly unreadTaskIds: readonly string[]
  readonly createdAtByTask: Readonly<Record<string, string>>
  readonly sectionVisible: boolean
}

export const taskViewStorageKey = 'ling.task-view.v1'

export const defaultTaskViewState: TaskViewState = {
  view: { groupBy: 'workspace', sortBy: 'manual', workspaceId: 'all', recency: 'all' },
  groups: [],
  assignments: {},
  collapsedIds: [],
  manualOrder: [],
  pinnedWorkspaceIds: [],
  archivedWorkspaceIds: [],
  pinnedTaskIds: [],
  workspacePinnedTaskIds: [],
  unreadTaskIds: [],
  createdAtByTask: {},
  sectionVisible: true,
}

export function readTaskViewState(value: string | null): TaskViewState {
  if (!value) return defaultTaskViewState
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return defaultTaskViewState
    const data = parsed as Partial<TaskViewState>
    const view = data.view
    return {
      view: {
        groupBy: view?.groupBy === 'custom' || view?.groupBy === 'activity' ? view.groupBy : 'workspace',
        sortBy: view?.sortBy === 'updated' || view?.sortBy === 'name' || view?.sortBy === 'created' ? view.sortBy : 'manual',
        workspaceId: typeof view?.workspaceId === 'string' ? view.workspaceId : 'all',
        recency: view?.recency === 'today' || view?.recency === '7days' || view?.recency === '30days' ? view.recency : 'all',
      },
      groups: Array.isArray(data.groups) ? data.groups.filter((group): group is TaskGroup =>
        !!group && typeof group.id === 'string' && typeof group.name === 'string' && typeof group.color === 'string' && typeof group.marker === 'string') : [],
      assignments: data.assignments && typeof data.assignments === 'object' && !Array.isArray(data.assignments) ? data.assignments : {},
      collapsedIds: Array.isArray(data.collapsedIds) ? data.collapsedIds.filter((id): id is string => typeof id === 'string') : [],
      manualOrder: Array.isArray(data.manualOrder) ? data.manualOrder.filter((id): id is string => typeof id === 'string') : [],
      pinnedWorkspaceIds: Array.isArray(data.pinnedWorkspaceIds) ? data.pinnedWorkspaceIds.filter((id): id is string => typeof id === 'string') : [],
      archivedWorkspaceIds: Array.isArray(data.archivedWorkspaceIds) ? data.archivedWorkspaceIds.filter((id): id is string => typeof id === 'string') : [],
      pinnedTaskIds: Array.isArray(data.pinnedTaskIds) ? data.pinnedTaskIds.filter((id): id is string => typeof id === 'string') : [],
      workspacePinnedTaskIds: Array.isArray(data.workspacePinnedTaskIds) ? data.workspacePinnedTaskIds.filter((id): id is string => typeof id === 'string') : [],
      unreadTaskIds: Array.isArray(data.unreadTaskIds) ? data.unreadTaskIds.filter((id): id is string => typeof id === 'string') : [],
      createdAtByTask: data.createdAtByTask && typeof data.createdAtByTask === 'object' && !Array.isArray(data.createdAtByTask)
        ? Object.fromEntries(Object.entries(data.createdAtByTask).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {},
      sectionVisible: data.sectionVisible !== false,
    }
  } catch {
    return defaultTaskViewState
  }
}

export function taskAgeDays(task: LingTaskSummary, now = new Date()): number {
  const updated = new Date(task.updatedAt)
  if (Number.isNaN(updated.getTime())) return Number.POSITIVE_INFINITY
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const taskStart = new Date(updated.getFullYear(), updated.getMonth(), updated.getDate()).getTime()
  return Math.round((start - taskStart) / 86_400_000)
}

export function visibleTasks(tasks: readonly LingTaskSummary[], view: TaskView, now = new Date(), manualOrder: readonly string[] = [], createdAtByTask: Readonly<Record<string, string>> = {}): LingTaskSummary[] {
  const days = { all: Number.POSITIVE_INFINITY, today: 0, '7days': 6, '30days': 29 }[view.recency]
  const filtered = tasks.filter(task => {
    if (view.workspaceId === 'none' && task.workspaceId) return false
    if (view.workspaceId !== 'all' && view.workspaceId !== 'none' && task.workspaceId !== view.workspaceId) return false
    return taskAgeDays(task, now) <= days
  })
  if (view.sortBy === 'manual') return filtered.sort((left, right) => {
    const leftIndex = manualOrder.indexOf(left.taskId)
    const rightIndex = manualOrder.indexOf(right.taskId)
    if (leftIndex < 0 && rightIndex < 0) return 0
    if (leftIndex < 0) return 1
    if (rightIndex < 0) return -1
    return leftIndex - rightIndex
  })
  return filtered.sort((left, right) => {
    if (view.sortBy === 'name') return left.title.localeCompare(right.title, 'zh-CN')
    const leftTime = Date.parse(view.sortBy === 'created' ? left.createdAt ?? createdAtByTask[left.taskId] ?? left.updatedAt : left.updatedAt)
    const rightTime = Date.parse(view.sortBy === 'created' ? right.createdAt ?? createdAtByTask[right.taskId] ?? right.updatedAt : right.updatedAt)
    return rightTime - leftTime
  })
}
