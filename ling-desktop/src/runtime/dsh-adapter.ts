import type {
  ISessions,
  SessionBinding,
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
  readonly conversation: {
    timeline(binding: SessionBinding): {
      getSnapshot(): readonly LingTimelineItem[]
      subscribe(listener: () => void): () => void
    }
  }
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
      return await withSession(facades, taskId, binding => {
        return facades.conversation.timeline(binding).getSnapshot()
      })
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
        const source = facades.conversation.timeline(binding)
        const publish = () => { listener(source.getSnapshot()) }
        disposeEvents = source.subscribe(publish)
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
