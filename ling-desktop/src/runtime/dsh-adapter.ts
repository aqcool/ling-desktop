import type {
  ISessions,
  SessionBinding,
  SessionEventWindow,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces,
  WorkspaceSnapshot,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  LingCommandRejectionReason,
  LingCommandResult,
  LingRuntimeAdapter,
  LingRuntimeCommand,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingTaskStatus,
  LingTaskSummary,
  LingTimelineItem,
  LingWorkspaceSummary,
} from './contract.js'

interface DshRemoteFailure {
  readonly code: string
  readonly message?: string
}

type DshRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: DshRemoteFailure }

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    lingRenderer: unknown
  }
}

export interface DshRuntimeFacades {
  readonly sessions: Pick<ISessions, 'create' | 'list' | 'refresh' | 'retain' | 'using'>
  readonly workspaces: Pick<IWorkspaces, 'list'>
  readonly reconnect?: () => void | Promise<void>
}

function workspaceProjection(snapshot: WorkspaceSnapshot): readonly LingWorkspaceSummary[] {
  return snapshot.items.map(workspace => ({
    label: workspace.title,
    locationLabel: workspace.path,
    workspaceId: workspace.workspaceId,
  }))
}

function taskStatus(summary: SessionListState['byId'][string]): LingTaskStatus {
  if (summary.running) return 'running'
  return summary.blank ? 'queued' : 'completed'
}

function taskProjection(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
): readonly LingTaskSummary[] {
  const workspaceByTask = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const taskId of workspace.sessionIds) workspaceByTask.set(taskId, workspace.workspaceId)
  }

  return sessions.ids.flatMap(taskId => {
    const summary = sessions.byId[taskId]
    if (!summary) return []
    const workspaceId = workspaceByTask.get(taskId)
    return [{
      taskId,
      title: summary.displayTitle,
      status: taskStatus(summary),
      updatedAt: new Date(summary.updatedAt).toISOString(),
      ...(workspaceId ? { workspaceId } : {}),
    }]
  })
}

function connectionProjection(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
): LingRuntimeSnapshot['connection'] {
  if (workspaces.state === 'error') return { phase: 'failed', message: '无法读取工作区。' }
  if (sessions.phase === 'ready' && workspaces.phase === 'ready') return { phase: 'ready' }
  return { phase: 'connecting', message: '正在连接…' }
}

function snapshotProjection(facades: DshRuntimeFacades): LingRuntimeSnapshot {
  const sessions = facades.sessions.list.getSnapshot()
  const workspaces = facades.workspaces.list.getSnapshot()
  return {
    connection: connectionProjection(sessions, workspaces),
    tasks: taskProjection(sessions, workspaces),
    workspaces: workspaceProjection(workspaces),
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap(block => {
    const candidate = record(block)
    if (candidate?.['type'] === 'text' && typeof candidate['text'] === 'string') return [candidate['text']]
    return []
  }).join('\n').trim()
}

function isoTime(value: unknown): string {
  return new Date(typeof value === 'number' && Number.isFinite(value) ? value : Date.now()).toISOString()
}

function timelineProjection(taskId: string, window: SessionEventWindow): readonly LingTimelineItem[] {
  const items: LingTimelineItem[] = []
  const streaming = new Map<string, { text: string; time: number }>()

  for (const entry of window.entries) {
    const event = entry.event
    const data = record(event.data)
    const seq = typeof event.seq === 'number' ? String(event.seq) : String(items.length)
    if (event.type === 'user/message') {
      const text = contentText(data?.['content'])
      const source = record(data?.['source'])
      if (text && source?.['kind'] === 'user') {
        items.push({
          itemId: `${taskId}:${seq}:user`,
          taskId,
          kind: 'user-message',
          text,
          createdAt: isoTime(event.time),
        })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const message = record(data?.['message'])
      const text = contentText(message?.['content'])
      if (text) {
        items.push({
          itemId: `${taskId}:${seq}:assistant`,
          taskId,
          kind: 'assistant-message',
          text,
          createdAt: isoTime(event.time),
        })
      }
      continue
    }
    if (event.type === 'tool/call') {
      const name = typeof data?.['name'] === 'string' ? data['name'] : '工具'
      items.push({
        itemId: `${taskId}:${seq}:tool`,
        taskId,
        kind: 'tool-activity',
        text: name,
        createdAt: isoTime(event.time),
      })
      continue
    }
    if (event.type === 'assistant/live-chunk') {
      const attemptId = String(data?.['attemptId'] ?? 'active')
      const chunk = record(data?.['chunk'])
      if (chunk?.['type'] !== 'text-delta' || typeof chunk['text'] !== 'string') continue
      const previous = streaming.get(attemptId)
      streaming.set(attemptId, {
        text: (previous?.text ?? '') + chunk['text'],
        time: typeof event.time === 'number' ? event.time : (previous?.time ?? Date.now()),
      })
    }
  }

  for (const [attemptId, value] of streaming) {
    if (!value.text.trim()) continue
    items.push({
      itemId: `${taskId}:stream:${attemptId}`,
      taskId,
      kind: 'assistant-message',
      text: value.text,
      createdAt: isoTime(value.time),
      streaming: true,
    })
  }
  return items
}

function rejectionReason(code: string): LingCommandRejectionReason {
  if (/permission|denied|forbidden/i.test(code)) return 'permission-denied'
  if (/not-found|missing/i.test(code)) return 'task-not-found'
  if (/invalid|validation/i.test(code)) return 'invalid-command'
  return 'runtime-unavailable'
}

function rejected(requestId: string, error: DshRemoteFailure): LingCommandResult {
  return {
    accepted: false,
    requestId,
    reason: rejectionReason(error.code),
    message: error.message?.trim() || '操作未能完成。',
    retryable: /transport|connection|timeout|unavailable/i.test(error.code),
  }
}

async function withSession<Value>(
  facades: DshRuntimeFacades,
  taskId: string,
  operation: (binding: SessionBinding) => Promise<Value> | Value,
): Promise<Value> {
  return await facades.sessions.using(
    taskId,
    { source: 'lingRenderer' },
    reference => operation(reference.binding),
  )
}

async function sendPrompt(
  facades: DshRuntimeFacades,
  requestId: string,
  taskId: string,
  text: string,
): Promise<LingCommandResult> {
  return await withSession(facades, taskId, async ({ session }) => {
    const submission = session.beginSubmission({ mode: 'queue', text, attachments: [] })
    try {
      const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, submission.requestId)
      return result.ok ? { accepted: true, requestId } : rejected(requestId, result.error)
    } catch {
      submission.abandon()
      return {
        accepted: false,
        requestId,
        reason: 'runtime-unavailable',
        message: '无法发送消息。',
        retryable: true,
      }
    }
  })
}

export function createDshRuntimeAdapter(facades: DshRuntimeFacades): LingRuntimeAdapter {
  const listeners = new Set<(event: LingRuntimeEvent) => void>()
  let disposeSources: (() => void) | undefined

  const publishSnapshot = () => {
    const event: LingRuntimeEvent = { type: 'snapshot.replaced', snapshot: snapshotProjection(facades) }
    for (const listener of [...listeners]) listener(event)
  }

  return {
    async getSnapshot() {
      return snapshotProjection(facades)
    },
    async getTaskTimeline(taskId) {
      return await withSession(facades, taskId, ({ eventSource }) => (
        timelineProjection(taskId, eventSource.getSnapshot())
      ))
    },
    async dispatch(command: LingRuntimeCommand) {
      try {
        if (command.type === 'runtime.reconnect') {
          if (facades.reconnect) await facades.reconnect()
          else await facades.sessions.refresh()
          return { accepted: true, requestId: command.requestId }
        }
        if (command.type === 'task.create') {
          const taskId = await facades.sessions.create({
            ...(command.workspaceId ? { workspaceId: command.workspaceId } : {}),
          })
          return await sendPrompt(facades, command.requestId, taskId, command.prompt)
        }
        if (command.type === 'task.send-message') {
          return await sendPrompt(facades, command.requestId, command.taskId, command.text)
        }
        return await withSession(facades, command.taskId, async ({ session }) => {
          const result = await session.cancel()
          return result.ok
            ? { accepted: true, requestId: command.requestId }
            : rejected(command.requestId, result.error)
        })
      } catch {
        return {
          accepted: false,
          requestId: command.requestId,
          reason: 'runtime-unavailable',
          message: '无法连接 LING。',
          retryable: true,
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        const disposeWorkspaces = facades.workspaces.list.subscribe(publishSnapshot)
        const disposeSessions = facades.sessions.list.subscribe(publishSnapshot)
        disposeSources = () => {
          disposeWorkspaces()
          disposeSessions()
        }
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          disposeSources?.()
          disposeSources = undefined
        }
      }
    },
    subscribeTaskTimeline(taskId, listener) {
      const abort = new AbortController()
      const reference = facades.sessions.retain(taskId, {
        source: 'lingRenderer',
        signal: abort.signal,
      })
      let disposeEvents: (() => void) | undefined
      void reference.ready.then(binding => {
        if (abort.signal.aborted) return
        const publish = () => { listener(timelineProjection(taskId, binding.eventSource.getSnapshot())) }
        disposeEvents = binding.eventSource.subscribe(publish)
        publish()
      }).catch(() => {})
      return () => {
        abort.abort()
        disposeEvents?.()
        reference.release()
      }
    },
  }
}
