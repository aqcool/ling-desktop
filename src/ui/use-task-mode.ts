import { useCallback, useEffect, useRef, useState } from 'react'
import type { LingReadResult, LingTaskMode } from '../runtime/contract.js'

/** Keep asynchronous mode reads scoped to the selected conversation. */
export function useTaskMode(taskId: string | undefined, status: unknown, read: (taskId: string) => Promise<LingReadResult<LingTaskMode>>) {
  const [snapshot, setSnapshot] = useState<{ taskId: string; value?: LingTaskMode }>()
  const scope = useRef({ taskId, read, revision: 0 })
  if (scope.current.taskId !== taskId || scope.current.read !== read) scope.current = { taskId, read, revision: scope.current.revision + 1 }
  const refresh = useCallback(async (id: string) => {
    if (scope.current.taskId !== id) return
    const current = scope.current
    const revision = ++current.revision
    try {
      const result = await read(id)
      if (scope.current !== current || current.revision !== revision) return
      setSnapshot({ taskId: id, value: result.ok ? result.value : undefined })
    } catch {
      if (scope.current === current && current.revision === revision) setSnapshot({ taskId: id })
    }
  }, [read])
  useEffect(() => {
    setSnapshot(undefined)
    if (taskId !== undefined) void refresh(taskId)
    return () => { scope.current.revision++ }
  }, [taskId, status, refresh])
  return { mode: snapshot?.taskId === taskId ? snapshot?.value : undefined, refreshMode: refresh }
}
