import { useCallback, useEffect, useRef, useState } from 'react'
import type { LingReadResult, LingRuntimeAdapter, LingTaskMode } from '../runtime/contract.js'

interface ModeScope {
  taskId: string | undefined
  read: (taskId: string) => Promise<LingReadResult<LingTaskMode>>
  generation: number
  closed: boolean
  dirty: boolean
  pending?: Promise<void>
}

/** Keep asynchronous mode reads scoped to the selected conversation. */
export function useTaskMode(taskId: string | undefined, status: unknown, read: (taskId: string) => Promise<LingReadResult<LingTaskMode>>, subscribe?: LingRuntimeAdapter['subscribeTaskMode']) {
  const [snapshot, setSnapshot] = useState<{ taskId: string; value?: LingTaskMode }>()
  const scope = useRef<ModeScope>({ taskId, read, generation: 0, closed: false, dirty: false })
  if (scope.current.taskId !== taskId || scope.current.read !== read) scope.current = { taskId, read, generation: 0, closed: false, dirty: false }
  const refresh = useCallback(async (id: string) => {
    const current = scope.current
    if (current.taskId !== id || current.closed) return
    current.dirty = true
    if (!current.pending) {
      current.pending = (async () => {
        // Coalesce notifications from both faces before beginning one RPC.
        await Promise.resolve()
        try {
          while (current.dirty && scope.current === current && !current.closed) {
            current.dirty = false
            const generation = current.generation
            let value: LingTaskMode | undefined
            try {
              const result = await current.read(id)
              if (result.ok) value = result.value
            } catch { /* Preserve the existing unavailable-mode presentation. */ }
            if (scope.current === current && !current.closed && current.generation === generation && !current.dirty) {
              setSnapshot({ taskId: id, value })
            }
          }
        } finally { current.pending = undefined }
      })()
    }
    await current.pending
  }, [read])
  useEffect(() => {
    const current = scope.current
    current.closed = false
    current.generation++
    setSnapshot(undefined)
    const stop = taskId === undefined ? undefined : subscribe?.(taskId, () => {
      if (scope.current === current && !current.closed) void refresh(taskId)
    })
    if (taskId !== undefined) void refresh(taskId)
    return () => {
      current.closed = true
      current.generation++
      current.dirty = false
      stop?.()
    }
  }, [taskId, subscribe, refresh])
  useEffect(() => { if (taskId !== undefined) void refresh(taskId) }, [taskId, status, refresh])
  return { mode: snapshot?.taskId === taskId ? snapshot?.value : undefined, refreshMode: refresh }
}
