export * from './compaction.js'
import type { LingPluginManager } from './plugins.js'
import type { LingComputerControlService } from './computer-control.js'
export * from './computer-control.js'
import type { LingServerService } from './servers.js'
export type * from './plugins.js'
export type * from './servers.js'
export type LingConnectionPhase = 'offline' | 'connecting' | 'ready' | 'failed'

export * from './knowledge.js'
export * from './automation.js'
export * from './hooks.js'

export interface LingRuntimeConnection {
  readonly phase: LingConnectionPhase
  readonly message?: string
}

export interface LingWorkspaceSummary {
  readonly workspaceId: string
  readonly label: string
  readonly locationLabel?: string
}

export interface LingWorkspaceApplication {
  readonly id: string
  readonly name: string
  readonly icon?: string
}
export interface LingWorkspaceRun {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly output: string
  readonly running: boolean
  readonly exitCode?: number | null
}
export interface LingWorkspaceTools {
  readonly applications: readonly LingWorkspaceApplication[]
  readonly runs: readonly LingWorkspaceRun[]
}
export type LingWorkspaceToolRequest =
  | { readonly type: 'inspect' }
  | { readonly type: 'open'; readonly applicationId: string }
  | { readonly type: 'run'; readonly name: string; readonly command: string }
  | { readonly type: 'stop'; readonly runId: string }

export interface LingGitFile {
  readonly path: string
  readonly originalPath?: string
  readonly index: string
  readonly worktree: string
  readonly conflict: boolean
}
export interface LingGitWorktree {
  readonly path: string
  readonly branch: string | null
  readonly head: string
  readonly main: boolean
  readonly locked: boolean
  readonly prunable: boolean
}
export interface LingGitSnapshot {
  readonly repository: boolean
  readonly root: string
  readonly branch: string | null
  readonly detached: boolean
  readonly unborn: boolean
  readonly upstream: string | null
  readonly ahead: number
  readonly behind: number
  readonly files: readonly LingGitFile[]
  readonly branches: readonly string[]
  readonly remotes: readonly string[]
  readonly worktrees: readonly LingGitWorktree[]
  readonly lineChanges?: { readonly added: number; readonly deleted: number }
}
export type LingGitRequest =
  | { readonly type: 'inspect'; readonly lineChanges?: boolean }
  | { readonly type: 'fetch' | 'pull' }
  | { readonly type: 'diff'; readonly path: string; readonly staged: boolean }
  | { readonly type: 'stage' | 'unstage'; readonly paths: readonly string[] }
  | { readonly type: 'commit'; readonly message: string }
  | { readonly type: 'switch' | 'create-branch'; readonly branch: string }
  | { readonly type: 'push'; readonly remote?: string }
  | { readonly type: 'worktree-add'; readonly path: string; readonly branch: string; readonly newBranch: boolean }
  | { readonly type: 'worktree-remove' | 'worktree-open'; readonly path: string }
export interface LingGitResult {
  readonly snapshot: LingGitSnapshot
  readonly diff?: string
  readonly message?: string
}

export interface LingModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface LingModelEffortOption {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface LingModelOption {
  readonly id: string
  readonly name: string
  readonly enabled?: boolean
  readonly description?: string
  readonly efforts?: readonly LingModelEffortOption[]
  readonly defaultEffort?: string
}

export type LingProviderCredentialState = 'configured' | 'missing' | 'not-required' | 'unknown'

export interface LingProviderAuthorization {
  readonly key: string
  readonly label: string
  readonly configured: boolean
  readonly writable: boolean
  readonly inFlight: boolean
  readonly methods: readonly { readonly id: string; readonly label: string }[]
}

export interface LingAuthorizationNotice {
  readonly message: string
  readonly url?: string
  readonly code?: string
}

export interface LingAuthorizationPrompt {
  readonly kind: 'text' | 'secret' | 'select'
  readonly message: string
  readonly placeholder?: string
  readonly options?: readonly {
    readonly id: string
    readonly label: string
    readonly description?: string
  }[]
  readonly signal?: AbortSignal
}

export interface LingAuthorizationInteraction {
  notify(notice: LingAuthorizationNotice): void
  prompt(prompt: LingAuthorizationPrompt): Promise<string>
}

export type LingAuthorizationStatus = 'authorized' | 'cancelled'

export interface LingModelProvider {
  readonly providerId: string
  readonly displayName: string
  readonly active: boolean
  readonly configurable: boolean
  readonly configured: boolean
  readonly credential: LingProviderCredentialState
  readonly canStoreApiKey: boolean
  readonly authorization?: LingProviderAuthorization
  readonly canEdit?: boolean
  readonly canDelete?: boolean
  readonly canTest?: boolean
  readonly draft?: LingCustomProviderDraft
  readonly models: readonly LingModelOption[]
  readonly error?: string
}

export interface LingModelSettings {
  readonly writable: boolean
  readonly defaultSelection: LingModelSelection
  readonly providers: readonly LingModelProvider[]
}

export interface LingCustomProviderModel {
  readonly id: string
  readonly name?: string
}

export interface LingCustomProviderDraft {
  readonly providerId: string
  readonly displayName?: string
  readonly baseUrl: string
  readonly protocol: string
  readonly models: readonly LingCustomProviderModel[]
  readonly apiKey?: string
}

export interface LingDiscoveredModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
}

export interface LingProviderTestTarget {
  readonly providerId?: string
  readonly baseUrl?: string
  readonly protocol?: string
  readonly apiKey?: string
}

export type LingTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting-for-input'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface LingTokenUsage {
  readonly uncachedInputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
}

export interface LingContextPressure {
  /** The latest advertised model capacity. */
  readonly contextWindow?: number
  /** Provider-reported prompt size of the latest request. */
  readonly pressureTokens?: number
  /** Estimated size of the next prompt after changes to the visible context. */
  readonly projectedTokens?: number
}

export interface LingContextBreakdown {
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly messageTokens: number
}

export interface LingTaskSummary {
  readonly blank?: boolean
  readonly taskId: string
  readonly title: string
  readonly status: LingTaskStatus
  readonly archived: boolean
  readonly updatedAt: string
  readonly createdAt?: string
  readonly workspaceId?: string
  readonly preview?: string
  readonly hasOlder?: boolean
  readonly tokenUsage?: LingTokenUsage
  readonly contextPressure?: LingContextPressure
  readonly contextBreakdown?: LingContextBreakdown
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

export interface LingTimelineAttachment {
  readonly attachmentId: string
  readonly kind: 'file' | 'image'
  readonly name: string
  readonly bytes?: number
  readonly mediaType?: string
}

export interface LingTimelineItem {
  readonly presentedFiles?: readonly import('./reply-features.js').LingPresentedFile[]
  readonly compaction?: import('./compaction.js').LingCompactionRecord
  readonly itemId: string
  readonly taskId: string
  readonly seq?: number
  readonly turn?: number
  /** Explicit turn-opening question; absent when history is incomplete. */
  readonly retrySourceId?: string
  readonly kind: LingTimelineItemKind
  readonly title?: string
  readonly text: string
  readonly detail?: string
  readonly createdAt: string
  readonly status?: LingTimelineItemStatus
  readonly streaming?: boolean
  /** True only while the last assistant block is reasoning. */
  readonly reasoningStreaming?: boolean
  /** Whether this is the last visible assistant response of a settled runtime turn. */
  readonly turnComplete?: boolean
  readonly attachments?: readonly LingTimelineAttachment[]
  readonly execution?: LingServerExecution
}

export interface LingApprovalDetails {
  readonly summary: string
  readonly server: string
  readonly cwd: string
  readonly impact: string
  readonly command?: string
  readonly source?: string
  readonly destination?: string
}

export interface LingServerExecution {
  readonly callId: string
  readonly summary: string
  readonly server: string
  readonly cwd: string
  readonly command: string
  readonly output: string
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted'
  readonly exitCode?: number
  readonly error?: string
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
      readonly details?: LingApprovalDetails
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

export interface LingSlashCommand {
  readonly name: string
  readonly description?: string
  readonly hint?: string
}

export interface LingPermissionOption {
  readonly value: string
  readonly label: string
  readonly description?: string
}

export interface LingTaskPermission {
  readonly options: readonly LingPermissionOption[]
  readonly currentValue?: string
}

export interface LingSkill {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}

export interface LingAgentPreset {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly unavailableReason?: string
  readonly isDefault: boolean
  readonly trust: 'system' | 'user'
}

export interface LingTaskAgentPreset {
  readonly modeSelectionEnabled?: boolean
  readonly options: readonly LingAgentPreset[]
  readonly currentValue?: string
}

export interface LingPluginEntry {
  readonly id: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly phase?: string
}

export interface LingPresetSettings {
  readonly presets: readonly LingAgentPreset[]
  readonly authorable: boolean
  readonly modeSelectionEnabled: boolean
  readonly writable: boolean
  readonly hasDocument: boolean
}

export interface LingPresetPlugin {
  readonly id: string | null
  readonly moduleName: string
  readonly enabled: boolean | 'conditional'
  readonly condition?: string
  readonly phase?: string
}

export interface LingPluginInventory {
  readonly entries: readonly LingPluginEntry[]
  readonly presets: readonly (LingAgentPreset & { readonly plugins: readonly LingPresetPlugin[] })[]
}

export interface LingExtensionSettingsService {
  presets(): Promise<LingReadResult<LingPresetSettings>>
  update(patch: { default?: string; modeSelectionEnabled?: boolean }): Promise<LingReadResult<void>>
  read(id: string): Promise<LingReadResult<{ content: string; name?: string }>>
  copy(from: string, id: string, name?: string): Promise<LingReadResult<void>>
  delete(id: string): Promise<LingReadResult<void>>
  openDirectory(id: string): Promise<LingReadResult<{ opened: boolean; path?: string }>>
  openConfig(): Promise<LingReadResult<void>>
  inventory(): Promise<LingReadResult<LingPluginInventory>>
}

export type LingGoalPhase = 'active' | 'paused' | 'blocked' | 'complete'

export interface LingTaskGoal {
  readonly goalId: string
  readonly revision: number
  readonly objective: string
  readonly phase: LingGoalPhase
  readonly roundsStarted: number
  readonly maxGoalRounds: number
  readonly blockedReason?: string
}

export interface LingTaskMode {
  readonly planActive?: boolean
  readonly planPending?: boolean
  readonly goal?: LingTaskGoal
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

export type LingWorkspaceEntryKind = 'file' | 'directory' | 'other'

export interface LingWorkspaceEntry {
  readonly name: string
  readonly path: string
  readonly kind: LingWorkspaceEntryKind
  readonly bytes?: number
}

export interface LingWorkspaceDirectory {
  readonly path: string
  readonly entries: readonly LingWorkspaceEntry[]
  readonly truncated: boolean
}

export type LingWorkspaceDocumentKind = 'markdown' | 'code' | 'text' | 'image' | 'pdf' | 'unsupported'

export interface LingWorkspaceDocument {
  readonly path: string
  readonly kind: LingWorkspaceDocumentKind
  readonly mediaType: string
  readonly text?: string
  readonly lines?: number
  readonly truncated?: boolean
  readonly version?: string
  /** Base64 payload for image and PDF previews. */
  readonly data?: string
  readonly bytes?: number
  /** The preview PDF was converted from an Office document. */
  readonly converted?: boolean
  readonly missingFonts?: readonly string[]
}

export interface LingAttachmentContent {
  readonly mediaType: string
  readonly data: Uint8Array
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
      readonly data: Uint8Array<ArrayBuffer>
      readonly name?: string
    }

export interface LingBackgroundJob {
  readonly jobId: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

export interface LingSubagent {
  readonly sessionId: string
  readonly title: string
  readonly activity: 'running' | 'inactive'
  readonly mode: 'one-shot' | 'continuable'
  readonly hasChildren: boolean
}

export interface LingSubagentCatalog {
  readonly state: 'loading' | 'ready' | 'error'
  readonly subagents: readonly LingSubagent[]
  readonly unreadable: readonly string[]
  readonly message?: string
}

export interface LingLocalePreference {
  readonly preference?: 'zh' | 'en'
}

export interface LingTaskTerminal {
  readonly terminalId: string
  readonly title: string
  readonly shell: string
  readonly cwd: string
  readonly state: 'running' | 'exited' | 'failed'
  readonly exitCode?: number
  readonly error?: string
}

/** Renderer-owned terminal boundary. DSH controls streams, retention and input ordering. */
export interface LingTerminalState {
  readonly phase: 'idle' | 'loading' | 'creating' | 'connecting' | 'connected' | 'disconnected' | 'closing' | 'closed' | 'failed'
  readonly writable: boolean
  readonly terminal?: LingTaskTerminal
  readonly error?: string
  readonly maxCols?: number
  readonly maxRows?: number
  readonly scrollback?: number
  readonly cols?: number
  readonly rows?: number
  readonly render?: { readonly revision: number; readonly data: string; readonly reset: boolean; readonly cols?: number; readonly rows?: number }
}

export interface LingTerminalView {
  getSnapshot(): LingTerminalState
  subscribe(listener: () => void): () => void
  mount(): () => void
  write(data: string): void
  resize(cols: number, rows: number): void
  acknowledge(revision: number): void
  reconnect(): void
}

export interface LingTerminalPanelState {
  readonly terminals: readonly LingTaskTerminal[]
  readonly loading: boolean
  readonly error?: string
}

export interface LingTerminalPanel {
  getSnapshot(): LingTerminalPanelState
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  create(): Promise<void>
  close(terminalId: string): Promise<void>
  rename(terminalId: string, title: string): Promise<LingReadResult<void>>
  view(terminalId: string): LingTerminalView
}

export interface LingTerminalService {
  panel(taskId: string, placement: 'side' | 'bottom'): LingTerminalPanel
  workspacePanel?(workspaceId: string | undefined, placement: 'side' | 'bottom'): LingTerminalPanel
}

export interface LingTaskSchedule {
  readonly scheduleId: string
  readonly kind: 'after' | 'at' | 'every'
  readonly prompt: string
  readonly scheduledAt: string
  readonly afterSeconds?: number
  readonly everySeconds?: number
}

export interface LingRuntimeSnapshot {
  readonly connection: LingRuntimeConnection
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly tasks: readonly LingTaskSummary[]
  readonly pendingInteractions: readonly LingPendingInteraction[]
  readonly backgroundJobs: Readonly<Record<string, readonly LingBackgroundJob[]>>
  readonly subagents: Readonly<Record<string, LingSubagentCatalog>>
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
      readonly type: 'model.select-default'
      readonly selection: LingModelSelection
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'model.select-task'
      readonly taskId: string
      readonly selection: LingModelSelection
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'provider.store-api-key'
      readonly providerId: string
      readonly apiKey: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'provider.create-custom'
      readonly provider: LingCustomProviderDraft
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'provider.update-custom'
      readonly provider: LingCustomProviderDraft
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'provider.delete'
      readonly providerId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.create'
      readonly model?: LingModelSelection
      readonly agentPreset?: string
      readonly maxGoalRounds?: number
      readonly prompt: string
      readonly workspaceId?: string
      readonly serverId?: string
      readonly operationsServerId?: string
      readonly attachments?: readonly LingPromptAttachment[]
      readonly permissionPreset?: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.send-message'
      readonly recordedAttachments?: { readonly seq: number; readonly attachmentIds: readonly string[] }
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
      readonly type: 'task.resend-message'
      readonly taskId: string
      readonly itemId: string
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
      readonly type: 'task.archive' | 'task.unarchive' | 'task.delete'
      readonly taskId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.load-older'
      readonly taskId: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.run-command'
      readonly maxGoalRounds?: number
      readonly taskId: string
      readonly line: string
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.goal-action'
      readonly taskId: string
      readonly action: 'pause' | 'resume' | 'complete' | 'clear'
      readonly goalId: string
      readonly revision: number
    })
  | (LingRuntimeCommandBase & {
      readonly type: 'task.select-agent-preset'
      readonly taskId: string
      readonly agentPreset: string
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
  | 'settings-conflict'
  | 'document-conflict'
  | 'task-not-found'
  | 'interaction-stale'
  | 'permission-denied'

export type LingCommandResult =
  | {
      readonly accepted: true
      readonly requestId: string
      readonly output?: {
        readonly workspaceId?: string
        readonly taskId?: string
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

export type LingRuntimeAdapterKind = 'dsh' | 'offline' | 'offline-demo'

export interface LingRuntimeAdapter {
  readonly hooks?: import('./hooks.js').LingHooksService
  readonly replyFeatures?: import('./reply-features.js').LingReplyFeatures
  readonly automation?: import('./automation.js').LingAutomationService
  readonly knowledge?: import('./knowledge.js').LingKnowledgeService
  readonly computerControl?: LingComputerControlService
  readonly pluginManager?: LingPluginManager
  readonly serverManager?: LingServerService
  readonly extensionSettings?: LingExtensionSettingsService
  readonly supportsGoalLimit?: boolean
  readonly kind?: LingRuntimeAdapterKind
  getSnapshot(): Promise<LingRuntimeSnapshot>
  getModelSettings(signal?: AbortSignal): Promise<LingReadResult<LingModelSettings>>
  getTaskTimeline(taskId: string): Promise<readonly LingTimelineItem[]>
  searchTasks(query: string, signal?: AbortSignal): Promise<LingReadResult<LingTaskSearchPage>>
  getTaskChanges(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingTaskChanges[]>>
  getTaskCommands?(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingSlashCommand[]>>
  getPermissionCatalog?(): Promise<LingReadResult<readonly LingPermissionOption[]>>
  getTaskPermissions?(taskId: string): Promise<LingReadResult<LingTaskPermission>>
  getTaskMode?(taskId: string): Promise<LingReadResult<LingTaskMode>>
  workspaceGit?(workspaceId: string, request: LingGitRequest): Promise<LingReadResult<LingGitResult>>
  getWorkspaceBranch?(workspaceId: string): Promise<string | null>
  workspaceTools?(workspaceId: string, request: LingWorkspaceToolRequest): Promise<LingReadResult<LingWorkspaceTools>>
  getWorkspaceSkills?(workspaceId: string | undefined, signal?: AbortSignal, agentPreset?: string): Promise<LingReadResult<readonly LingSkill[]>>
  getTaskSkills?(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingSkill[]>>
  promptTaskSubagent?(
    parentTaskId: string,
    subagentSessionId: string,
    text: string,
  ): Promise<LingReadResult<void>>
  interruptTaskSubagent?(parentTaskId: string, subagentSessionId: string): Promise<LingReadResult<void>>
  getLocalePreference?(): Promise<LingReadResult<LingLocalePreference>>
  setLocalePreference?(preference: 'zh' | 'en' | undefined): Promise<LingReadResult<void>>
  getTaskAgentPresets?(taskId?: string): Promise<LingReadResult<LingTaskAgentPreset>>
  listPlugins?(): Promise<LingReadResult<readonly LingPluginEntry[]>>
  getTaskFileDiff(
    taskId: string,
    seq: number,
    index: number,
    signal?: AbortSignal,
  ): Promise<LingReadResult<LingFileDiff>>
  listWorkspaceDirectory?(
    taskId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<LingReadResult<LingWorkspaceDirectory>>
  readWorkspaceDocument?(
    taskId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<LingReadResult<LingWorkspaceDocument>>
  saveWorkspaceDocument?(
    taskId: string,
    path: string,
    text: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<LingReadResult<{ readonly version: string }>>
  listDraftWorkspaceDirectory?(workspaceId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>>
  readDraftWorkspaceDocument?(workspaceId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>>
  saveDraftWorkspaceDocument?(workspaceId: string, path: string, text: string, version: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly version: string }>>
  getTaskAttachment?(taskId: string, attachmentId: string): Promise<LingReadResult<LingAttachmentContent>>
  getTaskModel?(taskId: string): Promise<LingReadResult<LingModelSelection | undefined>>
  readonly terminalService?: LingTerminalService
  getTaskTerminals?(taskId: string): Promise<LingReadResult<readonly LingTaskTerminal[]>>
  getTaskSchedules?(taskId: string): Promise<LingReadResult<readonly LingTaskSchedule[] | undefined>>
  createTaskTerminal?(taskId: string): Promise<LingReadResult<LingTaskTerminal>>
  setTaskSubagentsOpen?(taskId: string, open: boolean): void
  refreshTaskSubagents?(taskId: string): Promise<LingReadResult<void>>
  testProvider?(target: LingProviderTestTarget, signal?: AbortSignal): Promise<LingReadResult<readonly LingDiscoveredModel[]>>
  authorizeProvider?(
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ): Promise<LingReadResult<LingAuthorizationStatus>>
  signOutProvider?(providerId: string): Promise<LingReadResult<void>>
  pickDirectory?(): Promise<LingReadResult<string | undefined>>
  dispatch(command: LingRuntimeCommand): Promise<LingCommandResult>
  subscribe(listener: (event: LingRuntimeEvent) => void): () => void
  subscribeModelSettings(listener: () => void): () => void
  subscribeTaskModel?(taskId: string, listener: (model: LingModelSelection | undefined) => void): () => void
  subscribeTaskTimeline(taskId: string, listener: (items: readonly LingTimelineItem[]) => void): () => void
}
export type { LingPresentedFile, LingReplyFeatures } from './reply-features.js'
