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
  LingFileDiff,
  LingPendingInteraction,
  LingPromptAttachment,
  LingReadResult,
  LingRuntimeAdapter,
  LingRuntimeCommand,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingTaskStatus,
  LingTaskChanges,
  LingTaskSearchPage,
  LingTaskSummary,
  LingTimelineItem,
  LingWorkspaceSummary,
} from './contract.js'

interface DshRemoteFailure {
  readonly code: string
  readonly message?: string
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    lingRenderer: unknown
  }
}

export interface DshRuntimeFacades {
  readonly sessions: Pick<ISessions, 'create' | 'fork' | 'list' | 'refresh' | 'retain' | 'search' | 'using'>
  readonly workspaces: Pick<IWorkspaces,
    'archiveSession' | 'create' | 'delete' | 'list' | 'rename' | 'unarchiveSession'>
  readonly conversation: {
    timeline(binding: SessionBinding): {
      getSnapshot(): readonly LingTimelineItem[]
      subscribe(listener: () => void): () => void
    }
  }
  readonly changes: {
    list(binding: SessionBinding, signal: AbortSignal): Promise<readonly LingTaskChanges[]>
    diff(binding: SessionBinding, seq: number, index: number, signal: AbortSignal): Promise<LingFileDiff | undefined>
  }
  readonly attachments: {
    prepare(taskId: string, attachments: readonly LingPromptAttachment[]): Promise<{
      readonly content: Parameters<SessionBinding['session']['prompt']>[0]
      readonly pending: Parameters<SessionBinding['session']['beginSubmission']>[0]['attachments']
    }>
  }
  readonly interactions: {
    readonly list: {
      getSnapshot(): readonly LingPendingInteraction[]
      subscribe(listener: () => void): () => void
    }
    respond(command: Extract<LingRuntimeCommand, {
      type: 'interaction.answer-approval' | 'interaction.answer-question' | 'interaction.cancel'
    }>): Promise<boolean>
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

function taskStatus(summary: SessionListState['byId'][string], waitingForInput: boolean): LingTaskStatus {
  if (waitingForInput) return 'waiting-for-input'
  if (summary.running) return 'running'
  return summary.blank ? 'queued' : 'completed'
}

function taskProjection(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
  interactions: readonly LingPendingInteraction[],
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
      status: taskStatus(summary, interactions.some(interaction => interaction.taskId === taskId)),
      archived: workspaces.archivedSessionIds.includes(taskId),
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
  const pendingInteractions = facades.interactions.list.getSnapshot()
  return {
    connection: connectionProjection(sessions, workspaces),
    tasks: taskProjection(sessions, workspaces, pendingInteractions),
    workspaces: workspaceProjection(workspaces),
    pendingInteractions,
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

function readRejected<Value>(error: DshRemoteFailure): LingReadResult<Value> {
  return {
    ok: false,
    reason: rejectionReason(error.code),
    message: error.message?.trim() || '读取未能完成。',
    retryable: /transport|connection|timeout|unavailable/i.test(error.code),
  }
}

function unavailableRead<Value>(message: string): LingReadResult<Value> {
  return {
    ok: false,
    reason: 'runtime-unavailable',
    message,
    retryable: true,
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
  mode: 'queue' | 'steer' = 'queue',
  attachments: readonly LingPromptAttachment[] = [],
): Promise<LingCommandResult> {
  return await withSession(facades, taskId, async ({ session }) => {
    const prepared = await facades.attachments.prepare(taskId, attachments)
    const submission = session.beginSubmission({ mode, text, attachments: prepared.pending })
    try {
      const content = [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...prepared.content,
      ]
      const result = await session.prompt(content, mode, undefined, submission.requestId)
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
    async searchTasks(query, signal = new AbortController().signal) {
      const value = query.trim()
      if (!value) {
        return {
          ok: false,
          reason: 'invalid-command',
          message: '请输入搜索内容。',
          retryable: false,
        }
      }
      try {
        const result = await facades.sessions.search(value, signal)
        if (!result.ok) return readRejected<LingTaskSearchPage>(result.error)
        const snapshot = snapshotProjection(facades)
        const tasks = new Map(snapshot.tasks.map(task => [task.taskId, task]))
        return {
          ok: true,
          value: {
            hasMore: result.value.hasMore,
            items: result.value.items.map((item: { sessionId: string; snippet: string }) => {
              const task = tasks.get(String(item.sessionId))
              return {
                taskId: String(item.sessionId),
                snippet: item.snippet,
                ...(task === undefined ? {} : {
                  title: task.title,
                  ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
                }),
              }
            }),
          },
        }
      } catch {
        return unavailableRead('无法搜索任务。')
      }
    },
    async getTaskChanges(taskId, signal = new AbortController().signal) {
      try {
        const value = await withSession(facades, taskId, binding => facades.changes.list(binding, signal))
        return { ok: true, value }
      } catch {
        return unavailableRead('无法读取文件变更。')
      }
    },
    async getTaskFileDiff(taskId, seq, index, signal = new AbortController().signal) {
      if (!Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(index) || index < 0) {
        return {
          ok: false,
          reason: 'invalid-command',
          message: '文件变更坐标无效。',
          retryable: false,
        }
      }
      try {
        const value = await withSession(facades, taskId, binding => {
          return facades.changes.diff(binding, seq, index, signal)
        })
        return value === undefined
          ? {
              ok: false,
              reason: 'task-not-found',
              message: '这项文件变更已经不可用。',
              retryable: false,
            }
          : { ok: true, value }
      } catch {
        return unavailableRead('无法读取文件差异。')
      }
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
          const result = await sendPrompt(
            facades,
            command.requestId,
            taskId,
            command.prompt,
            'queue',
            command.attachments,
          )
          return result.accepted
            ? { ...result, output: { taskId: String(taskId) } }
            : result
        }
        if (command.type === 'task.fork') {
          const taskId = await facades.sessions.fork({
            sessionId: command.taskId,
            ...(command.atSeq === undefined ? {} : { atSeq: command.atSeq }),
            ...(command.increaseTitle === undefined ? {} : { increaseTitle: command.increaseTitle }),
          })
          return {
            accepted: true,
            requestId: command.requestId,
            output: { taskId: String(taskId) },
          }
        }
        if (command.type === 'task.send-message') {
          return await sendPrompt(
            facades,
            command.requestId,
            command.taskId,
            command.text,
            command.mode,
            command.attachments,
          )
        }
        if (command.type === 'workspace.create') {
          await facades.workspaces.create({ path: command.path })
          return { accepted: true, requestId: command.requestId }
        }
        if (command.type === 'workspace.rename') {
          await facades.workspaces.rename(command.workspaceId, command.title)
          return { accepted: true, requestId: command.requestId }
        }
        if (command.type === 'workspace.delete') {
          await facades.workspaces.delete(command.workspaceId)
          return { accepted: true, requestId: command.requestId }
        }
        if (command.type === 'interaction.answer-approval'
          || command.type === 'interaction.answer-question'
          || command.type === 'interaction.cancel') {
          const accepted = await facades.interactions.respond(command)
          return accepted
            ? { accepted: true, requestId: command.requestId }
            : {
                accepted: false,
                requestId: command.requestId,
                reason: 'interaction-stale',
                message: '这项请求已经结束。',
                retryable: false,
              }
        }
        if (command.type === 'task.archive' || command.type === 'task.unarchive') {
          await (command.type === 'task.archive'
            ? facades.workspaces.archiveSession(command.taskId)
            : facades.workspaces.unarchiveSession(command.taskId))
          return { accepted: true, requestId: command.requestId }
        }
        return await withSession(facades, command.taskId, async ({ session }) => {
          if (command.type === 'task.rename') {
            const result = await session.rename(command.title)
            return result.ok
              ? { accepted: true, requestId: command.requestId }
              : rejected(command.requestId, result.error)
          }
          if (command.type === 'task.load-older') {
            await session.loadOlder()
            return { accepted: true, requestId: command.requestId }
          }
          if (command.type === 'task.run-command') {
            const result = await session.command(command.line)
            if (!result.ok) return rejected(command.requestId, result.error)
            return result.value.matched
              ? { accepted: true, requestId: command.requestId }
              : {
                  accepted: false,
                  requestId: command.requestId,
                  reason: 'invalid-command',
                  message: '没有可执行这条指令的命令。',
                  retryable: false,
                }
          }
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
        const disposeInteractions = facades.interactions.list.subscribe(publishSnapshot)
        disposeSources = () => {
          disposeWorkspaces()
          disposeSessions()
          disposeInteractions()
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
