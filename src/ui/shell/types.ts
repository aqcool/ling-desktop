import type { ReactNode } from 'react'
import type {
  LingAttachmentContent,
  LingAuthorizationInteraction,
  LingAuthorizationStatus,
  LingBackgroundJob,
  LingCommandResult,
  LingCustomProviderDraft,
  LingDiscoveredModel,
  LingExtensionSettingsService,
  LingFileDiff,
  LingModelSelection,
  LingModelSettings,
  LingPendingInteraction,
  LingPendingMessage,
  LingPluginEntry,
  LingPluginManager,
  LingPresetSettings,
  LingProviderTestTarget,
  LingQuestionAnswer,
  LingReadResult,
  LingRuntimeAdapter,
  LingRuntimeConnection,
  LingServerService,
  LingSkill,
  LingSlashCommand,
  LingSubagentCatalog,
  LingTaskAgentPreset,
  LingTaskChanges,
  LingTaskGoal,
  LingTaskMode,
  LingTaskPermission,
  LingTaskSchedule,
  LingTaskSearchMatch,
  LingTaskSummary,
  LingTerminalService,
  LingTimelineAttachment,
  LingTimelineItem,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
  LingWorkspaceSummary
} from '../../runtime/contract.js'
import type { LingPresentedFile, LingReplyFeatures } from '../../runtime/reply-features.js'
import type { ComposerAttachment, WorkspaceContextReference } from '../attachments.js'
import type { ChangeSelection } from '../ChangeReview.js'
import type { LingTheme } from '../GeneralSettings.js'
import type { GitRequest } from '../GitPanel.js'
import type { LingSettingsTab } from '../settings-navigation.js'
import type { SideTaskState } from '../SideTaskPanel.js'
import type { LingUiSlots } from '../slots.js'
import type { WorkspaceToolsRequest } from '../WorkspaceTools.js'

export interface LingExtensionProps {
  readonly manager?: LingPluginManager
  readonly settings?: LingExtensionSettingsService
  readonly onSettingsChanged?: (settings: LingPresetSettings) => Promise<void>
  readonly onCreatePreset?: (id: string) => void
  readonly listPlugins: () => Promise<LingReadResult<readonly LingPluginEntry[]>>
  readonly onSelectPreset: (taskId: string, presetId: string) => Promise<LingCommandResult>
  readonly readAgentPresets: (taskId: string) => Promise<LingReadResult<LingTaskAgentPreset>>
  readonly readWorkspaceSkills?: (workspaceId: string | undefined, signal: AbortSignal, agentPreset?: string) => Promise<LingReadResult<readonly LingSkill[]>>
  readonly readSkills: (taskId: string, signal: AbortSignal) => Promise<LingReadResult<readonly LingSkill[]>>
}

export type WorkbenchTabKind = 'side-task' | 'files' | 'browser' | 'review' | 'terminal' | 'document'
export interface WorkbenchTab {
  readonly delivery?: { taskId: string; file: LingPresentedFile }
  readonly sideTask?: SideTaskState
  readonly id: string
  readonly kind: WorkbenchTabKind
  readonly label: string
}
export interface DialogState {
  readonly kind: 'rename-task' | 'add-workspace' | 'delete-workspace'
  readonly id?: string
  readonly initial?: string
}

export interface LingShellProps {
  readonly replyFeatures?: LingReplyFeatures
  readonly automation?: import('../../runtime/automation.js').LingAutomationService
  readonly hooks?: import('../../runtime/hooks.js').LingHooksService
  readonly knowledge?: import('../../runtime/knowledge.js').LingKnowledgeService
  readonly computerControl?: import('../../runtime/contract.js').LingComputerControlService
  readonly sideTaskRuntime?: LingRuntimeAdapter
  readonly serverManager?: LingServerService
  readonly agentPresetControl?: ReactNode
  readonly composerAgentPreset?: string
  readonly composerPresetPending?: boolean
  readonly supportsGoalLimit?: boolean
  readonly workspaceGit?: GitRequest
  readonly workspaceTools?: WorkspaceToolsRequest
  readonly loadWorkspaceBranch?: (workspaceId: string) => Promise<string | null>
  readonly attachments: readonly ComposerAttachment[]
  readonly recordedAttachments?: readonly LingTimelineAttachment[]
  readonly onRemoveRecordedAttachment?: (id: string) => void
  readonly composerFocusKey?: number
  readonly changeDiff?: LingFileDiff
  readonly changeDiffLoading: boolean
  readonly changeDiffMessage?: string
  readonly changes: readonly LingTaskChanges[]
  readonly changesLoading: boolean
  readonly changesMessage?: string
  readonly backgroundJobs: readonly LingBackgroundJob[]
  readonly onSubagentsRefresh: () => void
  readonly onSubagentPrompt?: (subagentSessionId: string, text: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
  readonly onSubagentInterrupt?: (subagentSessionId: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
  readonly subagents?: LingSubagentCatalog
  readonly supportsSubagents: boolean
  readonly schedules?: readonly LingTaskSchedule[]
  readonly schedulesLoading: boolean
  readonly schedulesMessage?: string
  readonly supportsSchedules: boolean
  readonly onSchedulesRefresh: () => void
  readonly terminalService?: LingTerminalService
  readonly connection: LingRuntimeConnection
  readonly demo: boolean
  readonly browserOpen: boolean
  readonly extensions?: LingExtensionProps
  readonly getTaskCommands?: (taskId: string) => Promise<LingReadResult<readonly LingSlashCommand[]>>
  readonly hasOlder: boolean
  readonly loadingOlder: boolean
  readonly loadWorkspaceDirectory: (
    taskId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingWorkspaceDirectory>>
  readonly loadAttachment: (
    taskId: string,
    attachmentId: string,
  ) => Promise<LingReadResult<LingAttachmentContent>>
  readonly loadWorkspaceDocument: (
    taskId: string,
    path: string,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingWorkspaceDocument>>
  readonly saveWorkspaceDocument?: (taskId: string, path: string, text: string, version: string, signal: AbortSignal) => Promise<LingReadResult<{ readonly version: string }>>
  readonly listDraftWorkspaceDirectory?: (workspaceId: string, path: string, signal: AbortSignal) => Promise<LingReadResult<LingWorkspaceDirectory>>
  readonly readDraftWorkspaceDocument?: (workspaceId: string, path: string, signal: AbortSignal) => Promise<LingReadResult<LingWorkspaceDocument>>
  readonly saveDraftWorkspaceDocument?: (workspaceId: string, path: string, text: string, version: string, signal: AbortSignal) => Promise<LingReadResult<{ readonly version: string }>>
  readonly modelSettings?: LingModelSettings
  readonly modelSettingsLoading: boolean
  readonly modelSettingsMessage?: string
  readonly mode?: LingTaskMode
  readonly notice: string
  readonly onNoticeRetry?: () => void
  readonly pendingInteractions: readonly LingPendingInteraction[]
  readonly pendingMessages?: readonly LingPendingMessage[]
  readonly onQueueAction?: (itemId: string, action: 'steer' | 'remove') => Promise<LingCommandResult>
  readonly onQueueWithdraw?: (itemId: string) => Promise<LingCommandResult>
  readonly onQueueReorder?: (itemIds: readonly string[]) => Promise<LingCommandResult>
  readonly permission?: LingTaskPermission
  readonly prompt: string
  readonly running: boolean
  readonly screen: 'workspace' | 'settings' | 'knowledge' | 'automation'
  readonly canNavigateBack: boolean
  readonly canNavigateForward: boolean
  readonly searchHasMore: boolean
  readonly searchLoading: boolean
  readonly searchMessage?: string
  readonly searchOpen: boolean
  readonly searchQuery: string
  readonly searchResults: readonly LingTaskSearchMatch[]
  readonly selectedChange?: ChangeSelection
  readonly selectedTask?: LingTaskSummary
  readonly settingsTab: LingSettingsTab
  readonly slots?: LingUiSlots
  readonly supportsWorkspaceFiles: boolean
  readonly taskModel?: LingModelSelection
  readonly taskModelScoped: boolean
  readonly tasks: readonly LingTaskSummary[]
  readonly theme: LingTheme
  readonly localePreference: 'zh' | 'en' | undefined
  readonly localeLoading: boolean
  readonly localeMessage?: string
  readonly onLocaleChange: (preference: 'zh' | 'en' | undefined) => void
  readonly timeline: readonly LingTimelineItem[]
  readonly version: string
  readonly workspaces: readonly LingWorkspaceSummary[]
  readonly onAddFiles: (files: File[]) => void
  readonly onAddWorkspaceContext?: (reference: WorkspaceContextReference, scope?: string) => void
  readonly onWorkspaceContextScopeChange?: (scope: string) => void
  readonly onAddQuote: (text: string, preview: string) => void
  readonly onAnswerQuestion: (interactionId: string, answers: readonly LingQuestionAnswer[]) => void | Promise<unknown>
  readonly onApprove: (interactionId: string, decision: 'allowed-once' | 'rejected') => void | Promise<unknown>
  readonly onCancelInteraction: (interactionId: string) => void | Promise<unknown>
  readonly onChangeDiffClose: () => void
  readonly onChangeSelect: (selection: ChangeSelection) => void
  readonly onSelectWorkspacePath: (path: string) => Promise<LingCommandResult>
  readonly onCreateWorkspace: (path: string, name?: string) => Promise<LingCommandResult>
  readonly onPickDirectory?: () => Promise<LingReadResult<string | undefined>>
  readonly onPlanModeToggle: (active: boolean) => void
  readonly onCompactContext: () => void
  readonly onDeleteWorkspace: (workspaceId: string) => Promise<LingCommandResult>
  readonly onExportTask: (task: LingTaskSummary) => void
  readonly onBrowserToggle: () => void
  readonly onGoalAction: (action: 'pause' | 'resume' | 'complete' | 'clear', goal: LingTaskGoal) => void
  readonly onFork: (taskId: string, atSeq?: number) => void | Promise<void>
  readonly onEditMessage?: (item: LingTimelineItem) => void
  readonly onRetryMessage?: (item: LingTimelineItem) => Promise<void>
  readonly onLoadOlder: () => void
  readonly onModelDefaultSelect: (selection: LingModelSelection) => Promise<LingCommandResult>
  readonly onModelEnabledChange: (selection: LingModelSelection, enabled: boolean) => Promise<string | undefined>
  readonly onModelSelect: (selection: LingModelSelection) => Promise<LingCommandResult>
  readonly onModelSettingsRefresh: () => void
  readonly onProviderModelsRefresh?: (providerId: string) => Promise<LingReadResult<import('../../runtime/contract.js').LingModelCatalogState>>
  readonly onProviderAuthorize: (
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ) => Promise<LingReadResult<LingAuthorizationStatus>>
  readonly onNewTask: () => void
  readonly onNewTaskInWorkspace: (workspaceId: string) => void
  readonly onNewTaskOnServer: (serverId: string) => void
  readonly onSelectOperationsServer: (serverId: string) => Promise<boolean>
  readonly onClearOperationsServer: () => void
  readonly onNewTaskWithoutWorkspace: () => void
  readonly newTaskWorkspaceId?: string
  readonly newTaskServerId?: string
  readonly newTaskOperationsServerId?: string
  readonly newTaskWithoutWorkspace: boolean
  readonly onNavigateBack: () => void
  readonly onNavigateForward: () => void
  readonly onPromptChange: (value: string) => void
  readonly onProviderCreate: (provider: LingCustomProviderDraft) => Promise<LingCommandResult>
  readonly onProviderDelete: (providerId: string) => Promise<LingCommandResult>
  readonly onProviderSaveApiKey: (providerId: string, apiKey: string) => Promise<LingCommandResult>
  readonly onProviderSignOut: (providerId: string) => Promise<LingReadResult<void>>
  readonly onProviderTest: (target: LingProviderTestTarget) => Promise<LingReadResult<readonly LingDiscoveredModel[]>>
  readonly onProviderUpdate: (provider: LingCustomProviderDraft) => Promise<LingCommandResult>
  readonly onReconnect: () => void
  readonly onRemoveAttachment: (id: string) => void
  readonly onRenameTask: (taskId: string, title: string) => Promise<LingCommandResult>
  readonly onRenameWorkspace: (workspaceId: string, title: string) => Promise<LingCommandResult>
  readonly onSearchClose: () => void
  readonly onSearchOpen: () => void
  readonly onSearchQueryChange: (value: string) => void
  readonly onSearchSelect: (taskId: string) => void
  readonly onSelectPermission: (value: string) => void
  readonly onSelectTask: (taskId: string) => void
  readonly onSettingsOpen: () => void
  readonly onSettingsTabChange: (tab: LingSettingsTab) => void
  readonly onSubmit: (textOverride?: string, onAccepted?: () => void) => void
  readonly onStop: () => void
  readonly onThemeChange: (theme: LingTheme) => void
  readonly onDeleteTask?: (taskId: string) => Promise<LingCommandResult>
  readonly onToggleTaskArchive: (taskId: string, archived: boolean) => void
  readonly onWorkspaceOpen: () => void
  readonly onKnowledgeOpen: () => void
  readonly onAutomationOpen: () => void
}
