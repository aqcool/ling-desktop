import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  LingCommandResult,
  LingRuntimeAdapter,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingTimelineItem,
} from './contract.js'

const EMPTY_TASKS: LingRuntimeSnapshot['tasks'] = []
const EMPTY_WORKSPACES: LingRuntimeSnapshot['workspaces'] = []

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

  const startNewTask = () => {
    setSelectedTaskId(undefined)
    setTimeline([])
  }

  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId)
  }

  const submit = async (text: string): Promise<LingCommandResult> => selectedTask
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
    })

  const reconnect = async (): Promise<LingCommandResult> => runtime.dispatch({
    type: 'runtime.reconnect',
    requestId: requestId(),
  })

  return {
    connection,
    reconnect,
    selectedTask,
    selectTask,
    startNewTask,
    submit,
    tasks,
    timeline,
    workspaces,
  }
}
