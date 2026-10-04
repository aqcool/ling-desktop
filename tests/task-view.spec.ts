import { describe, expect, it } from 'vitest'
import type { LingTaskSummary } from '../src/runtime/contract.js'
import { defaultTaskViewState, readTaskViewState, visibleTasks } from '../src/ui/task-view.js'

const tasks: LingTaskSummary[] = [
  { taskId: 'old', title: '旧任务', status: 'completed', archived: false, updatedAt: '2026-09-01T12:00:00.000Z', workspaceId: 'a' },
  { taskId: 'recent', title: '近期任务', status: 'completed', archived: false, updatedAt: '2026-09-22T12:00:00.000Z', workspaceId: 'b' },
  { taskId: 'today', title: '今日任务', status: 'running', archived: false, updatedAt: '2026-09-23T12:00:00.000Z' },
]

describe('task view', () => {
  it('filters by workspace and activity without mutating source order', () => {
    const view = { ...defaultTaskViewState.view, workspaceId: 'none', recency: 'today' } as const
    expect(visibleTasks(tasks, view, new Date('2026-09-23T13:00:00.000Z')).map(task => task.taskId)).toEqual(['today'])
    expect(tasks.map(task => task.taskId)).toEqual(['old', 'recent', 'today'])
  })

  it('orders tasks by update time, name, and manual placement', () => {
    const now = new Date('2026-09-23T13:00:00.000Z')
    expect(visibleTasks(tasks, { ...defaultTaskViewState.view, sortBy: 'updated' }, now).map(task => task.taskId)).toEqual(['today', 'recent', 'old'])
    expect(visibleTasks(tasks, { ...defaultTaskViewState.view, sortBy: 'name' }, now).map(task => task.taskId)).toEqual(['today', 'recent', 'old'])
    expect(visibleTasks(tasks, defaultTaskViewState.view, now, ['recent', 'old', 'today']).map(task => task.taskId)).toEqual(['recent', 'old', 'today'])
    const changed = tasks.map(task => task.taskId === 'old' ? { ...task, updatedAt: '2026-09-23T12:30:00.000Z' } : task)
    expect(visibleTasks(changed, { ...defaultTaskViewState.view, sortBy: 'created' }, now, [], { old: '2026-09-01T12:00:00.000Z' }).map(task => task.taskId)).toEqual(['today', 'recent', 'old'])
  })

  it('restores validated preferences and ignores corrupt storage', () => {
    expect(readTaskViewState('{')).toEqual(defaultTaskViewState)
    const stored = { ...defaultTaskViewState, view: { ...defaultTaskViewState.view, groupBy: 'custom' }, collapsedIds: ['a'], manualOrder: ['today'] }
    expect(readTaskViewState(JSON.stringify(stored))).toEqual(stored)
  })
})
