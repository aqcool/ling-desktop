import { useEffect, useState } from 'react'
import type { LingCommandResult, LingTaskSummary } from '../runtime/contract.js'
import type { WorkMode } from './behavior-preferences.js'

export const taskWorkModesKey = 'ling.task-work-modes.v1'
const changedEvent = 'ling:task-work-modes-changed'
export type TaskWorkModes = Readonly<Record<string, WorkMode>>

export function readTaskWorkModes(): TaskWorkModes {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(taskWorkModesKey) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, WorkMode] => entry[1] === 'coding' || entry[1] === 'general'))
  } catch { return {} }
}

/** Only accepted creations get a label. A retry cannot relabel an existing task. */
export function rememberCreatedTaskMode(result: LingCommandResult, mode: WorkMode): void {
  if (!result.accepted || !result.output?.taskId) return
  const taskId = result.output.taskId
  const modes = readTaskWorkModes()
  if (Object.hasOwn(modes, taskId)) return
  localStorage.setItem(taskWorkModesKey, JSON.stringify({ ...modes, [taskId]: mode }))
  window.dispatchEvent(new Event(changedEvent))
}

export function filterTaskWorkMode(tasks: readonly LingTaskSummary[], modes: TaskWorkModes, mode?: WorkMode): readonly LingTaskSummary[] {
  // Imported and older tasks have no reliable label; keep them accessible in either mode.
  return mode ? tasks.filter(task => !Object.hasOwn(modes, task.taskId) || modes[task.taskId] === mode) : tasks
}

export function useTaskWorkModes(): TaskWorkModes {
  const [modes, setModes] = useState(readTaskWorkModes)
  useEffect(() => {
    const refresh = () => setModes(readTaskWorkModes())
    const storage = (event: StorageEvent) => { if (event.key === taskWorkModesKey || event.key === null) refresh() }
    window.addEventListener(changedEvent, refresh); window.addEventListener('storage', storage)
    return () => { window.removeEventListener(changedEvent, refresh); window.removeEventListener('storage', storage) }
  }, [])
  return modes
}
