export type LingConnectionPhase = 'offline' | 'connecting' | 'ready' | 'failed'

export interface LingRuntimeConnection {
  readonly phase: LingConnectionPhase
  readonly message?: string
}

export interface LingWorkspaceSummary {
  readonly workspaceId: string
  readonly label: string
  readonly locationLabel?: string
}

export type LingTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-for-input'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface LingTaskSummary {
  readonly taskId: string
  readonly title: string
  readonly status: LingTaskStatus
  readonly updatedAt: string
  readonly workspaceId?: string
  readonly preview?: string
}

export type LingTimelineItemKind =
  | 'user-message'
  | 'assistant-message'
  | 'tool-activity'
  | 'system-notice'

export type LingTimelineItemStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface LingTimelineItem {
  readonly itemId: string
  readonly taskId: string
  readonly kind: LingTimelineItemKind
  readonly title?: string
  readonly text: string
  readonly detail?: string
  readonly createdAt: string
  readonly status?: LingTimelineItemStatus
  readonly streaming?: boolean
}

export interface LingRuntimeSnapshot {
  readonly connection: LingRuntimeConnection
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly tasks: readonly LingTaskSummary[]
}

export type LingRuntimeEvent =
  | { readonly type: 'connection.changed'; readonly connection: LingRuntimeConnection }
  | { readonly type: 'task.upsert'; readonly task: LingTaskSummary }
  | { readonly type: 'task.removed'; readonly taskId: string }
  | { readonly type: 'timeline.append'; readonly item: LingTimelineItem }
  | { readonly type: 'snapshot.replaced'; readonly snapshot: LingRuntimeSnapshot }

interface LingRuntimeCommandBase {
  readonly requestId: string
}

export type LingRuntimeCommand =
  | (LingRuntimeCommandBase & {
      readonly type: 'runtime.reconnect'
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.create'
      readonly prompt: string
      readonly workspaceId?: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.send-message'
      readonly taskId: string
      readonly text: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.cancel'
      readonly taskId: string
    })

export type LingCommandRejectionReason =
  | 'runtime-unavailable'
  | 'invalid-command'
  | 'task-not-found'
  | 'permission-denied'

export type LingCommandResult =
  | {
      readonly accepted: true
      readonly requestId: string
    }
  | {
      readonly accepted: false
      readonly requestId: string
      readonly reason: LingCommandRejectionReason
      readonly message: string
      readonly retryable: boolean
    }

export interface LingRuntimeAdapter {
  getSnapshot(): Promise<LingRuntimeSnapshot>
  getTaskTimeline(taskId: string): Promise<readonly LingTimelineItem[]>
  dispatch(command: LingRuntimeCommand): Promise<LingCommandResult>
  subscribe(listener: (event: LingRuntimeEvent) => void): () => void
  subscribeTaskTimeline(taskId: string, listener: (items: readonly LingTimelineItem[]) => void): () => void
}
