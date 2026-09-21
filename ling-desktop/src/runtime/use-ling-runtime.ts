import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LingCommandResult,
  LingRuntimeAdapter,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingTimelineItem,
} from './contract.js'

const EMPTY_TASKS: LingRuntimeSnapshot['tasks'] = []
const EMPTY_WORKSPACES: LingRuntimeSnapshot['workspaces'] = []
const EMPTY_INTERACTIONS: LingRuntimeSnapshot['pendingInteractions'] = []

function applyRuntimeEvent(
  snapshot: LingRuntimeSnapshot | undefined,
  event: LingRuntimeEvent,
): LingRuntimeSnapshot | undefined {
  if (!snapshot) return snapshot

  switch (event.type) {
    case 'snapshot.replaced':
      return event.snapshot
    case 'connection.changed':
      return { ...snapshot, connection: event.connection }
    case 'task.upsert': {
      const index = snapshot.tasks.findIndex(task => task.taskId === event.task.taskId)
      const tasks = [...snapshot.tasks]
      if (index === -1) tasks.unshift(event.task)
      else tasks[index] = event.task
      return { ...snapshot, tasks }
    }
    case 'task.removed':
      return { ...snapshot, tasks: snapshot.tasks.filter(task => task.taskId !== event.taskId) }
    case 'timeline.append':
      return snapshot
  }
}

function appendTimelineItem(
  current: readonly LingTimelineItem[],
  item: LingTimelineItem,
): readonly LingTimelineItem[] {
  return current.some(candidate => candidate.itemId === item.itemId)
    ? current
    : [...current, item]
}

function requestId() {
  return `renderer-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

export function useLingRuntime(runtime: LingRuntimeAdapter) {
  const [snapshot, setSnapshot] = useState<LingRuntimeSnapshot>()
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [timeline, setTimeline] = useState<readonly LingTimelineItem[]>([])
  const selectedTaskIdRef = useRef(selectedTaskId)
  selectedTaskIdRef.current = selectedTaskId

  useEffect(() => {
    let active = true
    void runtime.getSnapshot().then(nextSnapshot => {
      if (active) setSnapshot(nextSnapshot)
    })
    return () => {
      active = false
    }
  }, [runtime])

  useEffect(() => runtime.subscribe(event => {
    setSnapshot(current => applyRuntimeEvent(current, event))
    if (event.type === 'timeline.append' && event.item.taskId === selectedTaskIdRef.current) {
      setTimeline(current => appendTimelineItem(current, event.item))
    }
    if (event.type === 'task.removed' && event.taskId === selectedTaskIdRef.current) {
      setSelectedTaskId(undefined)
      setTimeline([])
    }
  }), [runtime])

  const tasks = snapshot?.tasks ?? EMPTY_TASKS
  const workspaces = snapshot?.workspaces ?? EMPTY_WORKSPACES
  const pendingInteractions = snapshot?.pendingInteractions ?? EMPTY_INTERACTIONS
  const connection = snapshot?.connection ?? {
    phase: 'connecting' as const,
    message: '正在连接…',
  }
  const selectedTask = useMemo(
    () => tasks.find(task => task.taskId === selectedTaskId),
    [selectedTaskId, tasks],
  )

  useEffect(() => {
    if (selectedTaskId && snapshot && !selectedTask) {
      setSelectedTaskId(undefined)
      setTimeline([])
    }
  }, [selectedTask, selectedTaskId, snapshot])

  useEffect(() => {
    if (!selectedTaskId) {
      setTimeline([])
      return
    }

    let active = true
    const unsubscribe = runtime.subscribeTaskTimeline(selectedTaskId, items => {
      if (active) setTimeline(items)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runtime, selectedTaskId])

  const startNewTask = useCallback(() => {
    setSelectedTaskId(undefined)
    setTimeline([])
  }, [])

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId)
  }, [])

  const selectCreatedTask = useCallback(async (result: LingCommandResult) => {
    if (!result.accepted || result.output === undefined) return result
    try {
      const nextSnapshot = await runtime.getSnapshot()
      setSnapshot(nextSnapshot)
      setSelectedTaskId(result.output.taskId)
    } catch {}
    return result
  }, [runtime])

  const submit = useCallback(async (text: string): Promise<LingCommandResult> => {
    const result = await (selectedTask
      ? runtime.dispatch({
        type: 'task.send-message',
        requestId: requestId(),
        taskId: selectedTask.taskId,
        text,
      })
      : runtime.dispatch({
        type: 'task.create',
        requestId: requestId(),
        prompt: text,
      }))
    return await selectCreatedTask(result)
  }, [runtime, selectCreatedTask, selectedTask])

  const reconnect = useCallback(async (): Promise<LingCommandResult> => runtime.dispatch({
    type: 'runtime.reconnect',
    requestId: requestId(),
  }), [runtime])

  const forkTask = useCallback(async (taskId: string, atSeq?: number): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({
      type: 'task.fork',
      requestId: requestId(),
      taskId,
      ...(atSeq === undefined ? {} : { atSeq }),
      increaseTitle: true,
    })
    return await selectCreatedTask(result)
  }, [runtime, selectCreatedTask])

  const searchTasks = useCallback((query: string, signal?: AbortSignal) => {
    return runtime.searchTasks(query, signal)
  }, [runtime])

  const getTaskChanges = useCallback((taskId: string, signal?: AbortSignal) => {
    return runtime.getTaskChanges(taskId, signal)
  }, [runtime])

  const getTaskFileDiff = useCallback((taskId: string, seq: number, index: number, signal?: AbortSignal) => {
    return runtime.getTaskFileDiff(taskId, seq, index, signal)
  }, [runtime])

  return {
    connection,
    forkTask,
    getTaskChanges,
    getTaskFileDiff,
    pendingInteractions,
    reconnect,
    searchTasks,
    selectedTask,
    selectTask,
    startNewTask,
    submit,
    tasks,
    timeline,
    workspaces,
  }
}
