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
  readonly archived: boolean
  readonly updatedAt: string
  readonly workspaceId?: string
  readonly preview?: string
}

export interface LingTaskSearchMatch {
  readonly taskId: string
  readonly snippet: string
  readonly title?: string
  readonly workspaceId?: string
}

export interface LingTaskSearchPage {
  readonly items: readonly LingTaskSearchMatch[]
  readonly hasMore: boolean
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

export interface LingQuestionOption {
  readonly label: string
  readonly description?: string
}

export interface LingQuestion {
  readonly questionId: string
  readonly prompt: string
  readonly detail?: string
  readonly header?: string
  readonly options: readonly LingQuestionOption[]
  readonly multiple: boolean
}

export type LingPendingInteraction =
  | {
      readonly interactionId: string
      readonly taskId: string
      readonly kind: 'approval'
      readonly toolName: string
      readonly callId?: string
      readonly reason?: string
    }
  | {
      readonly interactionId: string
      readonly taskId: string
      readonly kind: 'question' | 'plan-review'
      readonly questions: readonly LingQuestion[]
    }

export interface LingQuestionAnswer {
  readonly questionId: string
  readonly selected: readonly string[]
  readonly custom?: string
}

export interface LingChangedFile {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
  readonly binary?: true
  readonly oversized?: true
}

export interface LingTaskChanges {
  readonly taskId: string
  readonly turn: number
  readonly seq: number
  readonly files: readonly LingChangedFile[]
  readonly total: number
  readonly added: number
  readonly deleted: number
}

export interface LingDiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

export type LingFileDiff =
  | {
      readonly kind: 'text'
      readonly path: string
      readonly display: string
      readonly before: boolean
      readonly after: boolean
      readonly hunks: readonly LingDiffHunk[]
      readonly coarse: boolean
    }
  | {
      readonly kind: 'binary' | 'oversized'
      readonly path: string
      readonly display: string
    }

export type LingImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export type LingPromptAttachment =
  | {
      readonly kind: 'image'
      readonly mediaType: LingImageMediaType
      readonly data: string
      readonly name?: string
      readonly width?: number
      readonly height?: number
    }
  | {
      readonly kind: 'file'
      readonly data: Uint8Array
      readonly name?: string
    }

export interface LingRuntimeSnapshot {
  readonly connection: LingRuntimeConnection
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly tasks: readonly LingTaskSummary[]
  readonly pendingInteractions: readonly LingPendingInteraction[]
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
      readonly attachments?: readonly LingPromptAttachment[]
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.send-message'
      readonly taskId: string
      readonly text: string
      readonly mode?: 'queue' | 'steer'
      readonly attachments?: readonly LingPromptAttachment[]
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.cancel'
      readonly taskId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.rename'
      readonly taskId: string
      readonly title: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.fork'
      readonly taskId: string
      readonly atSeq?: number
      readonly increaseTitle?: boolean
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.archive' | 'task.unarchive'
      readonly taskId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.load-older'
      readonly taskId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.run-command'
      readonly taskId: string
      readonly line: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'workspace.create'
      readonly path: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'workspace.rename'
      readonly workspaceId: string
      readonly title: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'workspace.delete'
      readonly workspaceId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'interaction.answer-approval'
      readonly interactionId: string
      readonly decision: 'allowed-once' | 'rejected'
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'interaction.answer-question'
      readonly interactionId: string
      readonly answers: readonly LingQuestionAnswer[]
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'interaction.cancel'
      readonly interactionId: string
    })

export type LingCommandRejectionReason =
  | 'runtime-unavailable'
  | 'invalid-command'
  | 'task-not-found'
  | 'interaction-stale'
  | 'permission-denied'

export type LingCommandResult =
  | {
      readonly accepted: true
      readonly requestId: string
      readonly output?: {
        readonly taskId: string
      }
    }
  | {
      readonly accepted: false
      readonly requestId: string
      readonly reason: LingCommandRejectionReason
      readonly message: string
      readonly retryable: boolean
    }

export type LingReadResult<Value> =
  | {
      readonly ok: true
      readonly value: Value
    }
  | {
      readonly ok: false
      readonly reason: LingCommandRejectionReason
      readonly message: string
      readonly retryable: boolean
    }

export interface LingRuntimeAdapter {
  getSnapshot(): Promise<LingRuntimeSnapshot>
  getTaskTimeline(taskId: string): Promise<readonly LingTimelineItem[]>
  searchTasks(query: string, signal?: AbortSignal): Promise<LingReadResult<LingTaskSearchPage>>
  getTaskChanges(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingTaskChanges[]>>
  getTaskFileDiff(
    taskId: string,
    seq: number,
    index: number,
    signal?: AbortSignal,
  ): Promise<LingReadResult<LingFileDiff>>
  dispatch(command: LingRuntimeCommand): Promise<LingCommandResult>
  subscribe(listener: (event: LingRuntimeEvent) => void): () => void
  subscribeTaskTimeline(taskId: string, listener: (items: readonly LingTimelineItem[]) => void): () => void
}
