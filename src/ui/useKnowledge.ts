import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  KnowledgeRequest,
  KnowledgeSnapshot,
  LingKnowledgeService,
} from '../runtime/knowledge.js'
export type KnowledgeScopeInput = {
  workspaceId: string | null
  taskId?: string
  libraryId?: string
}
export function useKnowledge(
  service: LingKnowledgeService | undefined,
  scope: KnowledgeScopeInput,
) {
  const [snapshot, setSnapshot] = useState<KnowledgeSnapshot>(),
    [error, setError] = useState(''),
    [pending, setPending] = useState(0),
    [refresh, setRefresh] = useState(0)
  const mounted = useRef(false)
  const generation = useRef(0),
    controllers = useRef(new Set<AbortController>())
  const workspaceId = scope.workspaceId,
    taskId = scope.taskId,
    libraryId = scope.libraryId
  useEffect(() => {
    mounted.current = true
    generation.current++
    setSnapshot(undefined)
    setError('')
    setPending(0)
    return () => {
      mounted.current = false
      generation.current++
      for (const controller of controllers.current) controller.abort()
      controllers.current.clear()
    }
  }, [service, workspaceId, taskId, libraryId])
  const request = useCallback(
    async (input: KnowledgeRequest, throwOnError = false) => {
      if (!service || !mounted.current) return
      const epoch = generation.current,
        controller = new AbortController()
      controllers.current.add(controller)
      setPending((n) => n + 1)
      setError('')
      try {
        const result = await service.request(
          {
            ...input,
            workspaceId,
            ...(taskId ? { taskId } : {}),
            ...(libraryId ? { libraryId } : {}),
          },
          controller.signal,
        )
        if (controller.signal.aborted || epoch !== generation.current) return
        if (result.ok) return result.value
        const message = result.message ?? '读取失败，请重试。'
        setError(message)
        if (throwOnError) throw new Error(message)
      } catch (error) {
        if (!controller.signal.aborted && epoch === generation.current) {
          setError(error instanceof Error ? error.message : '操作失败。')
          if (throwOnError) throw error
        }
      } finally {
        controllers.current.delete(controller)
        if (epoch === generation.current) setPending((n) => Math.max(0, n - 1))
      }
    },
    [service, workspaceId, taskId, libraryId],
  )
  useEffect(() => {
    if (!service) return
    const controller = new AbortController(),
      epoch = generation.current
    let loading = false
    const load = async () => {
      if (loading || controller.signal.aborted) return
      loading = true
      try {
        const result = await service.request(
          {
            type: 'snapshot',
            workspaceId,
            ...(taskId ? { taskId } : {}),
            ...(libraryId ? { libraryId } : {}),
          },
          controller.signal,
        )
        if (controller.signal.aborted || epoch !== generation.current) return
        if (result.ok) setSnapshot(result.value.snapshot)
        else setError(result.message ?? '无法读取项目知识。')
      } catch (error) {
        if (!controller.signal.aborted && epoch === generation.current)
          setError(error instanceof Error ? error.message : '读取失败。')
      } finally { loading = false }
    }
    void load()
    const timer = setInterval(() => {
      if (!document.hidden) void load()
    }, 3000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [service, workspaceId, taskId, libraryId, refresh])
  return {
    snapshot,
    error,
    pending: pending > 0,
    request,
    reload: () => setRefresh((n) => n + 1),
    report: setError,
  }
}
