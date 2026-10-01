import { TaskNotes, openTaskNotes, openTaskNotesEvent, readTaskNotes, taskNotesEvent } from './TaskNotes.js'
import { browserNavigationEvent, requestBrowserNavigation, type BrowserNavigationRequest } from './browser-navigation.js'
import { SideTaskPanel, type SideTaskState } from './SideTaskPanel.js'
import { releaseComposerAttachment, toComposerQuote, type ComposerAttachment } from './attachments.js'
import { CompactSelect } from './SettingsControls.js'
import { AgentPresetSettings, BuiltinPluginSettings } from './AgentSettings.js'
import { BehaviorSettings } from './BehaviorSettings.js'
import { useBehavior, updateBehavior } from './behavior-preferences.js'
import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { TextArea } from '@heroui/react/textarea'
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type {
  LingAuthorizationInteraction,
  LingExtensionSettingsService,
  LingPluginManager,
  LingPresetSettings,
  LingAuthorizationStatus,
  LingAttachmentContent,
  LingBackgroundJob,
  LingCommandResult,
  LingCustomProviderDraft,
  LingDiscoveredModel,
  LingFileDiff,
  LingGitSnapshot,
  LingModelSelection,
  LingModelSettings,
  LingPendingInteraction,
  LingPluginEntry,
  LingProviderTestTarget,
  LingQuestionAnswer,
  LingReadResult,
  LingRuntimeConnection,
  LingRuntimeAdapter,
  LingServerService,
  LingSlashCommand,
  LingSkill,
  LingSubagentCatalog,
  LingTaskAgentPreset,
  LingTaskChanges,
  LingTimelineAttachment,
  LingTaskGoal,
  LingTaskMode,
  LingTaskPermission,
  LingTaskSchedule,
  LingTaskSearchMatch,
  LingTaskStatus,
  LingTaskSummary,
  LingTerminalService,
  LingTimelineItem,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
  LingWorkspaceSummary,
} from '../runtime/contract.js'
import { BrowserPanel, type BrowserAnnotation } from './BrowserPanel.js'
import { GitBranchMenu, GitDialog, GitPanel, GitSettings, type GitRequest } from './GitPanel.js'
import { CatalogSettings } from './CatalogSettings.js'
import { ComputerControlSettings } from './ComputerControlSettings.js'
import { ServerSettings } from './ServerSettings.js'
import { ArchivedSettings } from './ArchivedSettings.js'
import { ChangeReview, type ChangeSelection } from './ChangeReview.js'
import { Composer } from './Composer.js'
import { WorkspaceModeMenu } from './WorkspaceModeMenu.js'
import { ComposerContext } from './ComposerContext.js'
import { WorkspaceToolsToolbar, WorkspaceActionOutput, useWorkspaceTools, type WorkspaceToolsRequest } from './WorkspaceTools.js'
import { Conversation } from './Conversation.js'
import { ExtensionSettings } from './ExtensionSettings.js'
import { FileBrowser } from './FileBrowser.js'
import { ServerFileBrowser } from './ServerFileBrowser.js'
import { GeneralSettings, type LingTheme } from './GeneralSettings.js'
import { SettingsSidebar } from './SettingsSidebar.js'
import { type LingSettingsTab } from './settings-navigation.js'
import { TerminalPanel } from './TerminalPanel.js'
import { ServerTerminalPanel } from './ServerTerminalPanel.js'
import { Icon, type IconName } from './Icon.js'
import { InteractionPanel } from './InteractionPanel.js'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu.js'
import { ModelSettings } from './ModelSettings.js'
import { MonitorSettings } from './MonitorSettings.js'
import { effectiveMonitorPresentation, monitorPreferencesStorageKey, readMonitorPreferences, type MonitorPreferences } from './monitor-preferences.js'
import { PromptDialog } from './PromptDialog.js'
import { ComposerNotice } from './ComposerNotice.js'
import { TaskSearch } from './TaskSearch.js'
import { TokenUsagePopover } from './TokenUsagePopover.js'
import { UsageSettings } from './UsageSettings.js'
import { TaskRow } from './TaskRow.js'
import { TaskViewMenu } from './TaskViewMenu.js'
import { TaskGroupDialog } from './TaskGroupDialog.js'
import { WorkspaceCreateDialog, type WorkspaceDraft } from './WorkspaceCreateDialog.js'
import { WorkspaceRow } from './WorkspaceRow.js'
import { defaultTaskViewState, readTaskViewState, taskAgeDays, taskViewStorageKey, visibleTasks, type TaskViewState } from './task-view.js'
import type { LingUiSlots } from './slots.js'
import type { LingServer } from '../runtime/servers.js'
import { tw } from './tailwind.js'

const statusLabels: Record<LingTaskStatus, string> = {
  queued: '排队中',
  running: '进行中',
  'waiting-for-input': '等待输入',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

interface RemoteFingerprint { readonly algorithm: string; readonly sha256: string }
interface NativeRemoteBroker {
  status(id: string): Promise<{ trusted: boolean; fingerprint?: RemoteFingerprint; credential: 'none' | 'password' | 'key' }>
  inspect(id: string): Promise<RemoteFingerprint>
  probe(id: string): Promise<{ home: string }>
  credentials(id: string): Promise<void>
}
interface RemoteIssue { readonly title: string; readonly previous?: RemoteFingerprint; readonly observed?: RemoteFingerprint }
function nativeRemoteBroker(): NativeRemoteBroker | undefined {
  return (globalThis as { __LING_SERVER_BROKER__?: NativeRemoteBroker }).__LING_SERVER_BROKER__
}
async function remoteIssue(serverId: string): Promise<RemoteIssue | undefined> {
  const broker = nativeRemoteBroker()
  if (!broker) return { title: '远端任务需要桌面应用' }
  const status = await broker.status(serverId)
  if (status.trusted && status.credential !== 'none') {
    try { await broker.probe(serverId); return undefined } catch { /* inspect below */ }
  }
  let observed: RemoteFingerprint | undefined
  try { observed = await broker.inspect(serverId) } catch { /* connection error */ }
  const changed = status.fingerprint && observed && (status.fingerprint.algorithm !== observed.algorithm || status.fingerprint.sha256 !== observed.sha256)
  return { title: changed ? '服务器指纹已变更' : !status.trusted ? '需要确认服务器指纹' : status.credential === 'none' ? '需要服务器登录凭证' : '服务器连接已中断',
    previous: changed ? status.fingerprint : undefined, observed }
}

function positionResizeMarker(event: ReactPointerEvent<HTMLDivElement>, orientation: 'vertical' | 'horizontal') {
  const bounds = event.currentTarget.getBoundingClientRect()
  const length = orientation === 'vertical' ? bounds.height : bounds.width
  const halfMarker = Math.min(144, length / 2)
  const pointerPosition = orientation === 'vertical' ? event.clientY - bounds.top : event.clientX - bounds.left
  const position = Math.max(halfMarker, Math.min(length - halfMarker, pointerPosition))
  event.currentTarget.style.setProperty(orientation === 'vertical' ? '--resize-marker-y' : '--resize-marker-x', `${String(position)}px`)
}

export type { LingSettingsTab } from './settings-navigation.js'

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

const sidebarStorageKey = 'ling.sidebar'
const sidebarWidthStorageKey = 'ling.sidebar-width'
const sidebarMinWidth = 250
const sidebarMaxWidth = 440
const sidebarMaxRatio = 0.25
const workspaceMinWidth = 372
const workbenchWidthStorageKey = 'ling.workbench-width.v3'
const workbenchMinWidth = 288
type WorkbenchTabKind = 'side-task' | 'files' | 'browser' | 'review' | 'terminal' | 'notes'
interface WorkbenchTab {
  readonly notesTaskId?: string
  readonly sideTask?: SideTaskState
  readonly id: string
  readonly kind: WorkbenchTabKind
  readonly label: string
}
const conversationMinWidth = 336
const terminalHeightStorageKey = 'ling.terminal-height'
const terminalMinHeight = 160
const terminalMaxHeight = 560
const terminalMaxRatio = 0.55
const terminalContentMinHeight = 320

function terminalHeightLimit(workspaceHeight: number): number {
  return Math.max(terminalMinHeight, Math.min(terminalMaxHeight, Math.floor(workspaceHeight * terminalMaxRatio), Math.floor(workspaceHeight - terminalContentMinHeight)))
}

function clampTerminalHeight(height: number, workspaceHeight: number): number {
  const maximum = terminalHeightLimit(workspaceHeight)
  return Math.round(Math.max(terminalMinHeight, Math.min(maximum, height)))
}

function sidebarWidthLimit(shellWidth: number): number {
  return Math.max(sidebarMinWidth, Math.min(sidebarMaxWidth, Math.floor(shellWidth * sidebarMaxRatio), shellWidth - workspaceMinWidth))
}

function clampSidebarWidth(width: number, shell: HTMLElement): number {
  return Math.round(Math.max(sidebarMinWidth, Math.min(sidebarWidthLimit(shell.getBoundingClientRect().width), width)))
}

function workbenchWidthBounds(workspaceWidth: number): { minimum: number; maximum: number } {
  if (workspaceWidth <= workbenchMinWidth + conversationMinWidth) return { minimum: 50, maximum: 50 }
  return {
    minimum: Math.max(19, workbenchMinWidth / workspaceWidth * 100),
    maximum: Math.min(80, (workspaceWidth - conversationMinWidth) / workspaceWidth * 100),
  }
}

function clampWorkbenchWidth(width: number, workspaceWidth: number): number {
  const { minimum, maximum } = workbenchWidthBounds(workspaceWidth)
  return Math.round(Math.max(minimum, Math.min(maximum, width)) * 10) / 10
}

function modelDisplayName(
  settings: LingModelSettings | undefined,
  selection: LingModelSelection | undefined,
): string {
  if (!settings || !selection) return ''
  const provider = settings.providers.find(candidate => candidate.providerId === selection.provider)
  return provider?.models.find(model => model.id === selection.model)?.name ?? selection.model
}

function defaultModelName(settings: LingModelSettings | undefined): string {
  return modelDisplayName(settings, settings?.defaultSelection)
}

interface DialogState {
  readonly kind: 'rename-task' | 'add-workspace' | 'rename-workspace' | 'delete-workspace'
  readonly id?: string
  readonly initial?: string
}

export interface LingShellProps {
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
  readonly environmentOpen: boolean
  readonly environmentPinned: boolean
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
  readonly modelSettings?: LingModelSettings
  readonly modelSettingsLoading: boolean
  readonly modelSettingsMessage?: string
  readonly mode?: LingTaskMode
  readonly notice: string
  readonly onNoticeRetry?: () => void
  readonly pendingInteractions: readonly LingPendingInteraction[]
  readonly permission?: LingTaskPermission
  readonly prompt: string
  readonly running: boolean
  readonly screen: 'workspace' | 'settings'
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
  readonly onEnvironmentToggle: () => void
  readonly onEnvironmentPinToggle: () => void
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
  readonly onToggleTaskArchive: (taskId: string, archived: boolean) => void
  readonly onWorkspaceOpen: () => void
}

function SlotItems({ items, prefix }: { readonly items?: readonly ReactNode[]; readonly prefix: string }) {
  return items?.map((item, index) => (
    <Fragment key={`${prefix}-${String(index)}`}>{item}</Fragment>
  ))
}

function copyTaskId(taskId: string) {
  const field = document.createElement('textarea')
  field.value = taskId
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) void navigator.clipboard?.writeText(taskId).catch(() => {})
}

function browserAnnotationText(annotations: readonly BrowserAnnotation[]): string {
  if (annotations.length === 0) return ''
  return [
    '请根据以下网页元素注释调整页面：',
    ...annotations.map((annotation, index) => [
      `${String(index + 1)}. ${annotation.note}`,
      `   页面：${annotation.url}`,
      `   元素：${annotation.element.selector}`,
      annotation.element.text ? `   当前内容：${annotation.element.text}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n')
}

function WorkspaceSection({
  newTaskWorkspaceId,
  onExportTask,
  onNewTask,
  onOpenDialog,
  onSelectTask,
  onToggleArchive,
  selectedTask,
  tasks,
  viewState,
  onViewStateChange,
  onEditGroup,
  onNewTaskInWorkspace,
  onCreateGroup,
  workspaceAppearance,
  workspaces,
}: Pick<LingShellProps, 'onExportTask' | 'onNewTask' | 'onSelectTask' | 'newTaskWorkspaceId'> & {
  readonly onToggleArchive: (taskId: string, archived: boolean) => void
  readonly onOpenDialog: (dialog: DialogState) => void
  readonly selectedTask?: LingTaskSummary
  readonly tasks: readonly LingTaskSummary[]
  readonly viewState: TaskViewState
  readonly onViewStateChange: (next: TaskViewState) => void
  readonly onEditGroup: (id: string) => void
  readonly onNewTaskInWorkspace: (workspaceId: string) => void
  readonly onCreateGroup: () => void
  readonly workspaceAppearance: Readonly<Record<string, Pick<WorkspaceDraft, 'color' | 'marker'>>>
  readonly workspaces: readonly LingWorkspaceSummary[]
}) {
  const activeTasks = visibleTasks(tasks.filter(task => !task.archived), viewState.view, new Date(), viewState.manualOrder, viewState.createdAtByTask)
  const toggle = (id: string) => {
    const collapsed = new Set(viewState.collapsedIds)
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    onViewStateChange({ ...viewState, collapsedIds: [...collapsed] })
  }
  const assign = (taskId: string, groupId: string | undefined) => {
    const assignments = { ...viewState.assignments }
    if (groupId) assignments[taskId] = groupId
    else delete assignments[taskId]
    onViewStateChange({ ...viewState, assignments })
  }
  const move = (sourceId: string, targetId: string) => {
    const source = activeTasks.find(task => task.taskId === sourceId)
    const target = activeTasks.find(task => task.taskId === targetId)
    if (!source || !target || source.workspaceId !== target.workspaceId) return
    const ids = activeTasks.map(task => task.taskId).filter(id => id !== sourceId)
    const targetIndex = ids.indexOf(targetId)
    if (targetIndex < 0) return
    ids.splice(targetIndex, 0, sourceId)
    onViewStateChange({ ...viewState, manualOrder: ids })
  }

  const toggleTaskFlag = (field: 'pinnedTaskIds' | 'workspacePinnedTaskIds' | 'unreadTaskIds', taskId: string) => {
    const current = viewState[field]
    onViewStateChange({ ...viewState, [field]: current.includes(taskId) ? current.filter(id => id !== taskId) : [...current, taskId] })
  }
  const selectTask = (taskId: string) => {
    if (viewState.unreadTaskIds.includes(taskId)) {
      onViewStateChange({ ...viewState, unreadTaskIds: viewState.unreadTaskIds.filter(id => id !== taskId) })
    }
    onSelectTask(taskId)
  }

  const renderTasks = (list: readonly LingTaskSummary[], archived: boolean) => (
    <div className={tw("sidebar-tasks grid mt-0.5")}>
      {list.length === 0 ? <p className={tw("sidebar-tasks__empty mt-0.5 mx-0 mb-1.5 pl-7 [color:var(--text-tertiary)] text-xs")}>暂无任务</p> : null}
      {[...list].sort((left, right) =>
        Number(viewState.workspacePinnedTaskIds.includes(right.taskId)) - Number(viewState.workspacePinnedTaskIds.includes(left.taskId)),
      ).map(task => (
        <TaskRow
          archived={archived}
          groups={viewState.groups}
          onAssignGroup={assign}
          assignedGroupId={viewState.assignments[task.taskId]}
          onCopyId={copyTaskId}
          onCreateGroup={onCreateGroup}
          onExport={onExportTask}
          onGlobalPin={taskId => { toggleTaskFlag('pinnedTaskIds', taskId) }}
          onMarkUnread={taskId => { toggleTaskFlag('unreadTaskIds', taskId) }}
          onOpenWindow={taskId => { const url = new URL(window.location.href); url.searchParams.set('task', taskId); window.open(url.href, '_blank', 'noopener,noreferrer') }}
          onRename={target => { onOpenDialog({ kind: 'rename-task', id: target.taskId, initial: target.title }) }}
          onWorkspacePin={taskId => { toggleTaskFlag('workspacePinnedTaskIds', taskId) }}
          key={task.taskId}
          onMove={viewState.view.sortBy === 'manual' ? move : undefined}
          onSelect={selectTask}
          onToggleArchive={onToggleArchive}
          selected={selectedTask?.taskId === task.taskId}
          task={task}
          unread={viewState.unreadTaskIds.includes(task.taskId)}
          globallyPinned={viewState.pinnedTaskIds.includes(task.taskId)}
          workspacePinned={viewState.workspacePinnedTaskIds.includes(task.taskId)}
          workspaceLabel={workspaces.find(workspace => workspace.workspaceId === task.workspaceId)?.label}
        />
      ))}
    </div>
  )

  const globallyPinnedTasks = activeTasks.filter(task => viewState.pinnedTaskIds.includes(task.taskId) && !viewState.archivedWorkspaceIds.includes(task.workspaceId ?? ''))
  const unpinnedTasks = activeTasks.filter(task => !viewState.pinnedTaskIds.includes(task.taskId))
  const byWorkspace = (workspaceId: string) => unpinnedTasks.filter(task => task.workspaceId === workspaceId)
  const unassigned = unpinnedTasks.filter(task => !task.workspaceId || !workspaces.some(workspace => workspace.workspaceId === task.workspaceId))
  const workspaceRows = workspaces.filter(workspace => viewState.view.workspaceId === 'all' || viewState.view.workspaceId === workspace.workspaceId)
  const shownWorkspaces = workspaceRows.filter(workspace => !viewState.archivedWorkspaceIds.includes(workspace.workspaceId))
    .sort((left, right) => Number(viewState.pinnedWorkspaceIds.includes(right.workspaceId)) - Number(viewState.pinnedWorkspaceIds.includes(left.workspaceId)))
  const togglePinned = (workspaceId: string) => {
    const pinned = viewState.pinnedWorkspaceIds.includes(workspaceId)
    onViewStateChange({ ...viewState, pinnedWorkspaceIds: pinned
      ? viewState.pinnedWorkspaceIds.filter(id => id !== workspaceId)
      : [...viewState.pinnedWorkspaceIds, workspaceId] })
  }
  const toggleArchivedWorkspace = (workspaceId: string) => {
    if (newTaskWorkspaceId === workspaceId) onNewTask()
    onViewStateChange({ ...viewState,
      archivedWorkspaceIds: [...viewState.archivedWorkspaceIds, workspaceId],
      view: viewState.view.workspaceId === workspaceId ? { ...viewState.view, workspaceId: 'all' } : viewState.view,
    })
  }
  const workspaceRow = (workspace: LingWorkspaceSummary) => (
    <WorkspaceRow
      appearance={workspaceAppearance[workspace.locationLabel ?? '']}
      archived={false}
      collapsed={viewState.collapsedIds.includes(workspace.workspaceId)}
      key={workspace.workspaceId}
      onArchive={() => { toggleArchivedWorkspace(workspace.workspaceId) }}
      onEdit={() => { onOpenDialog({ kind: 'rename-workspace', id: workspace.workspaceId, initial: workspace.label }) }}
      onNewTask={() => { onNewTaskInWorkspace(workspace.workspaceId) }}
      onPin={() => { togglePinned(workspace.workspaceId) }}
      onRemove={() => { onOpenDialog({ kind: 'delete-workspace', id: workspace.workspaceId, initial: workspace.label }) }}
      onToggle={() => { toggle(workspace.workspaceId) }}
      pinned={viewState.pinnedWorkspaceIds.includes(workspace.workspaceId)}
      tasks={tasks.filter(task => !task.archived && task.workspaceId === workspace.workspaceId)}
      unreadCount={tasks.filter(task => !task.archived && task.workspaceId === workspace.workspaceId && viewState.unreadTaskIds.includes(task.taskId)).length}
      workspace={workspace}
    >{renderTasks(byWorkspace(workspace.workspaceId), false)}</WorkspaceRow>
  )

  const section = (id: string, label: string, list: readonly LingTaskSummary[], icon: IconName = 'folder', actions?: ReactNode, color?: string) => (
    <section className={tw("sidebar-project mb-3")} key={id}>
      <div className={tw("sidebar-project__heading flex min-h-control items-center gap-0 px-0.5 font-[590] hover:bg-transparent focus-within:bg-transparent")}>
        <button aria-expanded={!viewState.collapsedIds.includes(id)} aria-label={`${viewState.collapsedIds.includes(id) ? '展开' : '折叠'}${label}`} className={tw("sidebar-project__toggle inline-flex items-center justify-start border-0 bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:var(--foreground)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px] min-w-0 [min-height:2rem] flex-1 gap-1.5 py-0 px-2 rounded-lg text-left")} onClick={() => { toggle(id) }} type="button">
          <Icon name={viewState.collapsedIds.includes(id) ? 'chevronRight' : 'chevronDown'} size={13} />
          <span className={tw("sidebar-project__icon inline-flex flex-none")} style={color ? { color } as CSSProperties : undefined}><Icon name={icon} size={16} /></span>
          <span className={tw("sidebar-project__name flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap [color:var(--text-secondary)] text-compact [font-weight:500]")} title={label}>{label}</span>
        </button>
        {actions}
      </div>
      {!viewState.collapsedIds.includes(id) ? renderTasks(list, false) : null}
    </section>
  )

  return (
    <div className={tw("sidebar-projects__list grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-px overflow-x-hidden overflow-y-auto")}>
      {viewState.view.groupBy === 'workspace' && globallyPinnedTasks.length > 0 ? section('global-pinned', '已置顶', globallyPinnedTasks, 'pin') : null}
      {viewState.view.groupBy === 'workspace' ? shownWorkspaces.map(workspace => workspaceRow(workspace)) : null}
      {viewState.view.groupBy === 'workspace' && unassigned.length > 0 ? section('unassigned', '无工作区', unassigned) : null}
      {viewState.view.groupBy === 'activity' ? [
        { id: 'today', label: '今天', matches: (days: number) => days === 0 },
        { id: 'week', label: '最近 7 天', matches: (days: number) => days > 0 && days < 7 },
        { id: 'month', label: '最近 30 天', matches: (days: number) => days >= 7 && days < 30 },
        { id: 'older', label: '更早', matches: (days: number) => days >= 30 },
      ].map(bucket => {
        const list = activeTasks.filter(task => bucket.matches(taskAgeDays(task)))
        return list.length > 0 ? section(bucket.id, bucket.label, list, 'clock') : null
      }) : null}
      {viewState.view.groupBy === 'custom' ? <>
        {viewState.groups.map(group => section(group.id, group.name, activeTasks.filter(task => viewState.assignments[task.taskId] === group.id), group.marker as IconName,
          <Menu triggerAriaLabel={`分组 ${group.name} 操作`} triggerClassName="sidebar-project__more" triggerLabel={<Icon name="more" size={15} />}>
            <MenuItem icon="edit" onPress={() => { onEditGroup(group.id) }}>编辑分组</MenuItem>
            <MenuItem danger icon="trash" onPress={() => {
              const assignments = Object.fromEntries(Object.entries(viewState.assignments).filter(([, id]) => id !== group.id))
              onViewStateChange({ ...viewState, groups: viewState.groups.filter(item => item.id !== group.id), assignments })
            }}>删除分组</MenuItem>
          </Menu>, group.color))}
        {section('ungrouped', '未分组对话', activeTasks.filter(task => !viewState.groups.some(group => group.id === viewState.assignments[task.taskId])))}
      </> : null}
    </div>
  )
}

const jobStatusLabels: Record<LingBackgroundJob['status'], string> = {
  running: '运行中',
  stopping: '停止中',
  completed: '已完成',
  killed: '已终止',
  failed: '已失败',
}

function BackgroundJobList({ jobs }: { readonly jobs: readonly LingBackgroundJob[] }) {
  if (jobs.length === 0) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>当前任务没有后台作业。</p>
  return (
    <ul className={tw("job-list m-0 p-0 [list-style:none]")}>
      {jobs.map(job => (
        <li className={tw("job-list__item flex min-w-0 items-center gap-2 py-1.5 px-1.5 text-xs")} key={job.jobId}>
          <span className={tw(
            "job-list__state size-[0.45rem] flex-none rounded-full bg-[var(--disabled-background)]",
            job.status === 'running' && "job-list__state--running bg-[var(--success)]",
            job.status === 'stopping' && "job-list__state--stopping bg-[var(--warning)]",
            (job.status === 'failed' || job.status === 'killed') && "job-list__state--failed bg-[var(--danger)]",
          )} />
          <span className={tw("job-list__label min-w-0 overflow-hidden mr-auto [color:var(--foreground)] text-ellipsis whitespace-nowrap")} title={job.label}>{job.label}</span>
          <span className={tw("job-list__kind [flex-shrink:0] py-0 px-1.5 rounded-md [background:var(--surface-secondary)] [color:var(--text-secondary)] text-caption")}>{job.kind}</span>
          <span className={tw("job-list__status [flex-shrink:0] [max-width:9rem] overflow-hidden [color:var(--text-secondary)] text-caption text-ellipsis whitespace-nowrap")} title={job.detail ?? jobStatusLabels[job.status]}>
            {job.detail ?? jobStatusLabels[job.status]}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function SubagentList({ catalog, onPrompt, onInterrupt }: {
  readonly catalog: LingSubagentCatalog | undefined
  readonly onPrompt?: (subagentSessionId: string, text: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
  readonly onInterrupt?: (subagentSessionId: string) => Promise<{ readonly accepted: boolean; readonly message?: string }>
}) {
  const [promptTarget, setPromptTarget] = useState<string>()
  const [busyTarget, setBusyTarget] = useState<string>()
  const [actionMessage, setActionMessage] = useState<string>()

  const interrupt = async (subagentSessionId: string) => {
    if (busyTarget !== undefined || onInterrupt === undefined) return
    setBusyTarget(subagentSessionId)
    setActionMessage(undefined)
    try {
      const result = await onInterrupt(subagentSessionId)
      if (!result.accepted) setActionMessage(result.message ?? '中断子任务失败。')
    } catch {
      setActionMessage('中断子任务失败。')
    } finally {
      setBusyTarget(undefined)
    }
  }
  if (catalog === undefined || catalog.state === 'loading') {
    return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>正在读取子任务…</p>
  }
  if (catalog.state === 'error') {
    return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>{catalog.message ?? '子任务读取失败。'}</p>
  }
  if (catalog.subagents.length === 0 && catalog.unreadable.length === 0) {
    return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>当前任务没有子任务。</p>
  }
  return (
    <>
      <ul className={tw("subagent-list m-0 p-0 [list-style:none]")}>
        {catalog.subagents.map(subagent => (
          <li className={tw("subagent-list__item flex min-w-0 items-center gap-2 py-1.5 px-1.5 text-xs")} key={subagent.sessionId}>
            <span className={tw("subagent-list__state size-[0.45rem] flex-none rounded-full bg-[var(--disabled-background)]", subagent.activity === 'running' && "subagent-list__state--running bg-[var(--success)]")} />
            <span className={tw("subagent-list__title min-w-0 overflow-hidden mr-auto [color:var(--foreground)] text-ellipsis whitespace-nowrap")} title={subagent.title}>{subagent.title}</span>
            <span className={tw("subagent-list__mode [flex-shrink:0] py-0 px-1.5 rounded-md [background:var(--surface-secondary)] [color:var(--text-secondary)] text-caption")}>{subagent.mode === 'continuable' ? '可持续' : '一次性'}</span>
            {onPrompt && subagent.mode === 'continuable' ? (
              <button
                aria-label={`向子任务 ${subagent.title} 追加指令`}
                className={tw("subagent-list__action [flex-shrink:0] py-0 px-2 [border:1px_solid_var(--panel-border)] rounded-md [background:var(--surface)] [color:var(--text-secondary)] text-caption cursor-pointer hover:[background:var(--surface-secondary)]")}
                disabled={busyTarget !== undefined}
                onClick={() => { setPromptTarget(subagent.sessionId) }}
                type="button"
              >
                追加指令
              </button>
            ) : null}
            {onInterrupt && subagent.activity === 'running' ? (
              <button
                aria-busy={busyTarget === subagent.sessionId}
                aria-label={`中断子任务 ${subagent.title}`}
                className={tw("subagent-list__action [flex-shrink:0] py-0 px-2 [border:1px_solid_var(--panel-border)] rounded-md [background:var(--surface)] [color:var(--text-secondary)] text-caption cursor-pointer hover:[background:var(--surface-secondary)]")}
                disabled={busyTarget !== undefined}
                onClick={() => { void interrupt(subagent.sessionId) }}
                type="button"
              >
                {busyTarget === subagent.sessionId ? '中断中…' : '中断'}
              </button>
            ) : null}
          </li>
        ))}
        {catalog.unreadable.length === 0
          ? null
          : <li className={tw("subagent-list__unreadable py-1.5 px-1.5 [color:var(--text-secondary)] text-caption")}>{`${String(catalog.unreadable.length)} 个子任务无法读取`}</li>}
      </ul>
      {actionMessage ? <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")} role="status">{actionMessage}</p> : null}
      {promptTarget !== undefined && onPrompt ? (
        <PromptDialog
          confirmLabel="发送"
          description="指令会排队送达该子任务。"
          label="指令"
          onCancel={() => { setPromptTarget(undefined) }}
          onConfirm={value => onPrompt(promptTarget, value)}
          open
          placeholder="输入要追加给该子任务的指令"
          title="追加指令"
        />
      ) : null}
    </>
  )
}

const scheduleKindLabels: Record<LingTaskSchedule['kind'], string> = {
  after: '延时',
  at: '定时',
  every: '周期',
}

function ScheduleList(props: {
  readonly schedules: readonly LingTaskSchedule[]
  readonly loading: boolean
  readonly message?: string
}) {
  if (props.loading) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>正在读取定时提醒…</p>
  if (props.message) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>{props.message}</p>
  if (props.schedules.length === 0) return <p className={tw("environment-panel__state flex [min-height:2.4rem] items-center gap-2 m-0 py-1.5 px-1.5 [color:var(--text-secondary)] text-xs")}>当前任务没有定时提醒。</p>
  return (
    <ul className={tw("schedule-list m-0 p-0 [list-style:none]")}>
      {props.schedules.map(schedule => (
        <li className={tw("schedule-list__item flex min-w-0 items-center gap-2 py-1.5 px-1.5 text-xs")} key={schedule.scheduleId}>
          <span className={tw("schedule-list__prompt min-w-0 overflow-hidden mr-auto [color:var(--foreground)] text-ellipsis whitespace-nowrap")} title={schedule.prompt}>{schedule.prompt}</span>
          <span className={tw("schedule-list__kind [flex-shrink:0] py-0 px-1.5 rounded-md [background:var(--surface-secondary)] [color:var(--text-secondary)] text-caption")}>{scheduleKindLabels[schedule.kind]}</span>
          <span className={tw("schedule-list__status [flex-shrink:0] [max-width:9rem] overflow-hidden [color:var(--text-secondary)] text-caption text-ellipsis whitespace-nowrap")}>{new Date(schedule.scheduledAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}

function MonitorSection({ title, children, initiallyOpen = true, accessory }: { readonly title: string; readonly children: ReactNode; readonly initiallyOpen?: boolean; readonly accessory?: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen)
  return <section className={tw("task-monitor__section min-w-0 pb-2")}>
    <div className={tw("flex h-control-lg min-w-0 items-center justify-between gap-2")}>
      <h3 className={tw("m-0 min-w-0")}><button aria-expanded={open} className={tw("flex min-h-control-sm items-center gap-1 rounded-sm border-0 bg-transparent p-0 text-compact font-normal text-[var(--text-tertiary)] outline-none hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]")} onClick={() => { setOpen(current => !current) }} type="button"><span>{title}</span><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /></button></h3>
      {accessory}
    </div>
    {open ? <div className={tw("min-w-0 pb-1")}>{children}</div> : null}
  </section>
}

const monitorRowClassName = "flex min-h-control min-w-0 items-center gap-2 text-compact text-[var(--foreground)]"
const monitorIconClassName = "grid size-control-xs shrink-0 place-items-center rounded bg-[var(--surface-tertiary)] text-[var(--text-secondary)]"

function taskSkillNames(items: readonly LingTimelineItem[]): readonly string[] {
  const names = new Set<string>()
  for (const item of items) {
    for (const match of item.text.matchAll(/-\s+`([^`]+)`\s*:/g)) names.add(match[1] ?? '')
  }
  return [...names].filter(Boolean)
}

function taskWebLinks(items: readonly LingTimelineItem[]): readonly string[] {
  const links = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'tool-activity') continue
    for (const match of `${item.text} ${item.detail ?? ''}`.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) {
      links.add((match[0] ?? '').replace(/[.,;:!?]+$/, ''))
    }
  }
  return [...links]
}

export function EnvironmentPanel({ preferences, presentation, sideChats, onSelectSideChat, workspaceBranch, gitLineChanges, onGitOpen, onGitReview, ...props }: LingShellProps & {
  readonly onGitOpen?: () => void
  readonly onGitReview?: () => void
  readonly workspaceBranch?: string | null
  readonly gitLineChanges?: LingGitSnapshot['lineChanges']
  readonly preferences: MonitorPreferences
  readonly presentation: MonitorPreferences['presentation']
  readonly sideChats: readonly WorkbenchTab[]
  readonly onSelectSideChat: (id: string) => void
}) {
  const behavior = useBehavior()
  const { selectedTask, workspaces } = props
  const subscribeNotes = useCallback((refresh: () => void) => {
    window.addEventListener(taskNotesEvent, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(taskNotesEvent, refresh); window.removeEventListener('storage', refresh) }
  }, [])
  const readNoteCount = () => {
    try { return selectedTask ? readTaskNotes(selectedTask.taskId).length : 0 }
    catch { return 0 }
  }
  const noteCount = useSyncExternalStore(subscribeNotes, readNoteCount, readNoteCount)
  const [skills, setSkills] = useState<readonly LingSkill[]>([])
  const activeWorkspace = workspaces.find(workspace => workspace.workspaceId === selectedTask?.workspaceId)
  const attachments = props.timeline.flatMap(item => (item.attachments ?? []).map(attachment => ({ ...attachment, taskId: item.taskId })))
  const sourceInput = useRef<HTMLInputElement>(null)
  const [sourceError, setSourceError] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const downloadSource = async (taskId: string, attachmentId: string, name: string) => {
    setSourceError(undefined); setDownloading(attachmentId)
    try {
      const result = await props.loadAttachment(taskId, attachmentId)
      if (!result.ok) { setSourceError(result.message); return }
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.value.data)], { type: result.value.mediaType }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = name
      document.body.append(anchor); anchor.click(); anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setSourceError(cause instanceof Error ? cause.message : '附件下载失败。') }
    finally { setDownloading(undefined) }
  }
  const recap = props.timeline.findLast(item => item.kind === 'assistant-message' && item.text.trim())?.text
  const visibleSkillNames = skills.length > 0 ? skills.map(skill => skill.name) : taskSkillNames(props.timeline)
  const webLinks = taskWebLinks(props.timeline)
  const goal = props.mode?.goal
  const hasSubagents = props.supportsSubagents && selectedTask && props.subagents?.state === 'ready'
    && (props.subagents.subagents.length > 0 || props.subagents.unreadable.length > 0)
  const fixed = presentation === 'fixed'

  useEffect(() => {
    const readSkills = props.extensions?.readSkills
    setSkills([])
    if (!selectedTask || !readSkills) return
    const controller = new AbortController()
    void readSkills(selectedTask.taskId, controller.signal).then(result => {
      if (!controller.signal.aborted) setSkills(result.ok ? result.value : [])
    }).catch(() => { if (!controller.signal.aborted) setSkills([]) })
    return () => { controller.abort() }
  }, [props.extensions?.readSkills, selectedTask?.taskId])

  return <div className={tw('task-monitor min-w-0', fixed && 'pt-2')}>
    {!fixed ? <div className={tw("sticky top-0 z-2 flex h-10 items-center justify-between bg-[var(--surface)]")}>
      <h2 className={tw("m-0 text-compact font-medium text-[var(--text-secondary)]")}>任务监控</h2>
      <button aria-pressed={props.environmentPinned} aria-label={props.environmentPinned ? '取消固定任务监控' : '固定任务监控'} className={tw("grid size-control-xs place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] aria-pressed:text-[var(--foreground)]")} onClick={props.onEnvironmentPinToggle} title={props.environmentPinned ? '取消固定任务监控' : '固定任务监控'} type="button"><Icon active={props.environmentPinned} name="pin" size={14} /></button>
    </div> : null}
    {preferences.recap && recap ? <details className={tw("group/recap mb-3 rounded-lg border border-[var(--panel-border)] p-3")}>
      <summary className={tw("flex cursor-pointer list-none items-center gap-1 text-xs font-medium")}><span>任务回顾</span><span className={tw("ml-auto text-caption font-normal text-[var(--text-tertiary)]")}>最近回复</span><Icon className={tw("transition-transform group-open/recap:rotate-90")} name="chevronRight" size={13} /></summary>
      <p className={tw("mb-0 mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-[var(--text-secondary)]")}>{recap}</p>
    </details> : null}
    {preferences.goal && goal ? <MonitorSection title="任务目标"><p className={tw("mb-2 mt-0 break-words text-compact leading-6")}>{goal.objective}</p><span className={tw("text-caption text-[var(--text-tertiary)]")}>{goal.phase === 'complete' ? '已完成' : goal.phase === 'paused' ? '已暂停' : goal.phase === 'blocked' ? '已阻塞' : '进行中'} · 第 {goal.roundsStarted} / {goal.maxGoalRounds} 轮</span></MonitorSection> : null}
    {preferences.plan && (props.mode?.planActive || props.mode?.planPending) ? <MonitorSection title="计划"><div className={tw(monitorRowClassName)}><span className={tw(monitorIconClassName)}><Icon name="listCheck" size={14} /></span><span>{props.mode.planPending ? '等待确认' : '按计划执行'}</span></div></MonitorSection> : null}
    {behavior.modes[behavior.workMode].monitorEnvironment ? <MonitorSection title="环境信息">
      <div className={tw("grid gap-0.5")}>
        {gitLineChanges ? <button aria-label="审阅未提交更改" className={tw(monitorRowClassName, 'w-full rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')} disabled={!onGitReview} onClick={onGitReview} type="button"><span className={tw(monitorIconClassName)}><Icon name="branch" size={14} /></span>{!fixed ? <span className={tw("text-[var(--text-secondary)]")}>未提交</span> : null}<span className={tw('flex gap-1.5 tabular-nums', !fixed && 'ml-auto')}><span className={tw("text-[var(--success)]")}>+{gitLineChanges.added.toLocaleString()}</span><span className={tw("text-[var(--danger)]")}>−{gitLineChanges.deleted.toLocaleString()}</span></span></button> : null}
        <div className={tw(monitorRowClassName)}><span className={tw(monitorIconClassName)}><Icon name="desktop" size={14} /></span><span>本地</span>{!fixed ? <span className={tw("ml-auto min-w-0 truncate text-[var(--text-secondary)]")} title={activeWorkspace?.label}>{activeWorkspace?.label ?? '未指定'}</span> : null}</div>
        {workspaceBranch ? <div className={tw(monitorRowClassName)}><span className={tw(monitorIconClassName)}><Icon name="branch" size={14} /></span>{!fixed ? <span className={tw("text-[var(--text-secondary)]")}>分支</span> : null}<span className={tw('min-w-0 truncate text-[var(--foreground)]', !fixed && 'ml-auto')} title={workspaceBranch}>{workspaceBranch}</span></div> : null}
        <button className={tw(monitorRowClassName, 'w-full border-0 bg-transparent p-0 text-left disabled:text-[var(--text-tertiary)]')} disabled={!onGitOpen} onClick={onGitOpen} title="Git：查看更改、提交或推送" type="button"><span className={tw(monitorIconClassName)}><Icon name="gitCommit" size={14} /></span><span>提交或推送</span></button>
      </div>
    </MonitorSection> : null}
    {preferences.subagents && hasSubagents ? <MonitorSection title="子智能体"><SubagentList catalog={props.subagents} onInterrupt={props.onSubagentInterrupt} onPrompt={props.onSubagentPrompt} /></MonitorSection> : null}
    {preferences.processes && props.backgroundJobs.length > 0 ? <MonitorSection title="后台进程"><BackgroundJobList jobs={props.backgroundJobs} /></MonitorSection> : null}
    {preferences.sideChats && sideChats.length > 0 ? <MonitorSection title="侧边聊天">{sideChats.map(chat => <button className={tw(monitorRowClassName, 'w-full rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')} key={chat.id} onClick={() => { onSelectSideChat(chat.id) }} type="button"><span className={tw(monitorIconClassName)}><Icon name="sideChat" size={14} /></span><span className={tw("min-w-0 truncate")}>{chat.label}</span><Icon className={tw("ml-auto shrink-0 text-[var(--text-tertiary)]")} name="external" size={12} /></button>)}</MonitorSection> : null}
    {preferences.skills && visibleSkillNames.length > 0 ? <MonitorSection accessory={<span className={tw("shrink-0 text-caption text-[var(--text-tertiary)]")} title="当前任务可用的技能">可用 {visibleSkillNames.length}</span>} title="技能与 MCP">
      <ul className={tw("m-0 grid list-none gap-0.5 p-0")}>{visibleSkillNames.map(name => <li className={tw(monitorRowClassName)} key={name}><span className={tw(monitorIconClassName)}><Icon name="hammer" size={14} /></span><span className={tw("min-w-0 truncate")} title={name}>{name}</span></li>)}</ul>
    </MonitorSection> : null}
    {preferences.outputs && props.changes.some(change => change.files.length > 0) ? <MonitorSection title="产出" initiallyOpen={props.selectedChange !== undefined}>
      <ChangeReview changes={props.changes} diff={props.changeDiff} diffLoading={props.changeDiffLoading} diffMessage={props.changeDiffMessage} loading={props.changesLoading} message={props.changesMessage} onCloseDiff={props.onChangeDiffClose} onSelect={props.onChangeSelect} selection={props.selectedChange} />
    </MonitorSection> : null}
    {preferences.web && webLinks.length > 0 ? <MonitorSection initiallyOpen={false} title="网页查阅"><ul className={tw("m-0 grid list-none gap-0.5 p-0")}>{webLinks.slice(0, 8).map(link => <li key={link}><button type="button" onClick={() => requestBrowserNavigation(link)} className={tw(monitorRowClassName, 'w-full rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')}><span className={tw(monitorIconClassName)}><Icon name="globe" size={14} /></span><span className={tw("min-w-0 truncate")} title={link}>{link}</span></button></li>)}</ul></MonitorSection> : null}
    {preferences.sources && attachments.length > 0 ? <MonitorSection accessory={<button aria-label="添加来源" className={tw("grid size-control-xs place-items-center rounded border-0 bg-transparent p-0 text-[var(--text-tertiary)]")} onClick={() => sourceInput.current?.click()} title="添加附件到输入框" type="button"><Icon name="plus" size={14} /></button>} title="来源">
      <input ref={sourceInput} type="file" multiple hidden onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) props.onAddFiles(files) }} />
      {sourceError ? <p role="alert" className={tw('text-xs text-[var(--danger)]')}>{sourceError}</p> : null}
      <ul className={tw("m-0 grid list-none gap-1 p-0")}>{attachments.map((attachment, index) => <li className={tw(monitorRowClassName)} key={`${attachment.attachmentId}-${index}`}><button type="button" disabled={Boolean(downloading)} onClick={() => { void downloadSource(attachment.taskId, attachment.attachmentId, attachment.name) }} className={tw('flex w-full min-w-0 items-center gap-2 rounded-md border-0 bg-transparent p-0 text-left hover:bg-[var(--surface-hover)]')}><span className={tw(monitorIconClassName, 'text-[var(--focus)]')}><Icon name={attachment.kind === 'image' ? 'image' : 'file'} size={14} /></span><span className={tw("min-w-0 truncate")} title={attachment.name}>{attachment.name}</span><Icon name="download" size={12} className={tw('ml-auto shrink-0')} /></button></li>)}</ul>
    </MonitorSection> : null}
    {preferences.quickNotes && behavior.quickNotes && selectedTask && noteCount > 0 ? <button className={tw("flex h-control-lg w-full items-center justify-between border-0 bg-transparent p-0 text-left text-compact text-[var(--text-tertiary)]")} onClick={() => openTaskNotes(selectedTask.taskId)} title="打开任务速记" type="button"><span>速记</span><Icon name="external" size={13} /></button> : null}
  </div>
}

function WorkbenchHomeAction({ detail, icon, onClick, title }: { readonly detail?: string; readonly icon: IconName; readonly onClick: () => void; readonly title: string }) {
  return (
    <button className={tw("mx-auto grid min-h-13 w-[min(15rem,calc(100%_-_1rem))] cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2.5 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-2.5 py-1.5 text-left [color:var(--foreground)] hover:bg-[var(--surface-secondary)]")} onClick={onClick} type="button">
      <span className={tw("grid size-control-lg place-items-center rounded-md bg-[var(--surface-tertiary)] [color:var(--text-secondary)]")}><Icon name={icon} size={17} /></span>
      <span className={tw("flex min-w-0 flex-col justify-center gap-0.5")}><strong className={tw("block overflow-hidden text-ellipsis whitespace-nowrap text-compact font-medium leading-[18px]")}>{title}</strong>{detail ? <small className={tw("block overflow-hidden text-ellipsis whitespace-nowrap text-caption leading-[14px] [color:var(--text-tertiary)]")}>{detail}</small> : null}</span>
    </button>
  )
}

function workbenchTabIcon(kind: WorkbenchTabKind): IconName {
  return kind === 'notes' ? 'book' : kind === 'side-task' ? 'sideChat' : kind === 'files' ? 'folderOpen' : kind === 'browser' ? 'globe' : kind === 'review' ? 'review' : 'terminalSquare'
}

function WorkbenchTabs({ tabs, activeId, onSelect, onClose }: {
  readonly tabs: readonly WorkbenchTab[]
  readonly activeId?: string
  readonly onSelect: (id: string) => void
  readonly onClose: (id: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const visibleCount = Math.max(1, Math.floor((availableWidth + 4) / 120))
  const overflow = availableWidth > 0 && tabs.length > visibleCount
  const tabWidth = overflow ? (availableWidth - (visibleCount - 1) * 4) / visibleCount : undefined

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let frame = 0
    const revealActive = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setAvailableWidth(list.clientWidth)
        const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement
        if (!selected) return
        const bounds = list.getBoundingClientRect()
        const tab = selected.getBoundingClientRect()
        if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left
        else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right
      })
    }
    revealActive()
    const observer = new ResizeObserver(revealActive)
    observer.observe(list)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [activeId, tabs, availableWidth])

  return <div className={tw("flex min-w-0 flex-1 items-center gap-0.5")}>
    <div aria-label="工作面与文件标签页" className={tw("flex h-control min-w-0 flex-1 items-center gap-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none]")} ref={listRef} role="tablist">
      {tabs.map((tab, index) => <div className={tw("group/tab [-webkit-app-region:no-drag] flex h-control-sm min-w-0 shrink-0 snap-start items-center rounded-md px-1", !overflow && "max-w-44", tab.id === activeId ? "bg-[var(--surface-tertiary)] text-[var(--foreground)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]")} key={tab.id} style={tabWidth ? { width: tabWidth } : undefined}>
        <button aria-selected={tab.id === activeId} className={tw("flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm border-0 bg-transparent px-1 text-compact outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]")} onClick={() => { onSelect(tab.id) }} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
          const target = tabs[next]
          if (target) { onSelect(target.id); listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus() }
        }} role="tab" tabIndex={tab.id === activeId ? 0 : -1} title={tab.label} type="button">
          <Icon className={tw("shrink-0")} name={workbenchTabIcon(tab.kind)} size={16} />
          <span className={tw("min-w-0 truncate")}>{tab.label}</span>
        </button>
        <button aria-label={`关闭 ${tab.label} 标签页`} className={tw("grid size-5 shrink-0 place-items-center rounded border-0 bg-transparent p-0 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] group-hover/tab:opacity-100 group-focus-within/tab:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--focus)]")} onClick={() => { onClose(tab.id) }} type="button"><Icon name="close" size={11} /></button>
      </div>)}
    </div>
    {overflow ? <Menu align="end" triggerAriaLabel="已打开的标签页" triggerClassName="[-webkit-app-region:no-drag] size-control-xs shrink-0 justify-center rounded-md p-0" triggerLabel={<Icon name="chevronDown" size={14} />}>
      {tabs.map(tab => <MenuItem suffix={tab.id === activeId ? <Icon name="check" size={13} /> : undefined} icon={workbenchTabIcon(tab.kind)} key={tab.id} onPress={() => { onSelect(tab.id) }}>{tab.label}</MenuItem>)}
    </Menu> : null}
  </div>
}

function WorkbenchHeaderAction({ active = false, expanded, controls, icon, label, onClick }: {
  readonly active?: boolean
  readonly expanded?: boolean
  readonly controls?: string
  readonly icon: IconName
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={label}
      className={tw(
        "[-webkit-app-region:no-drag] grid size-control-sm shrink-0 place-items-center rounded-md border-0 p-0 text-[var(--text-secondary)] shadow-none outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        active ? "bg-[var(--surface-tertiary)] text-[var(--foreground)]" : "bg-transparent",
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon active={active} name={icon} size={18} />
    </button>
  )
}

export function LingShell(props: LingShellProps) {
  const {
    attachments,
    browserOpen,
    connection,
    demo,
    environmentOpen,
    environmentPinned,
    hasOlder,
    loadingOlder,
    notice,
    onAddFiles,
    onAnswerQuestion,
    onApprove,
    onCancelInteraction,
    onLoadOlder,
    onNewTask,
    onNavigateBack,
    onNavigateForward,
    onPromptChange,
    onReconnect,
    onRemoveAttachment,
    onSearchClose,
    onSearchOpen,
    onSearchQueryChange,
    onSearchSelect,
    onSelectTask,
    onSettingsOpen,
    onSubmit,
    onStop,
    onThemeChange,
    pendingInteractions,
    prompt,
    running,
    screen,
    selectedTask,
    slots,
    tasks,
    theme,
    timeline,
    workspaces,
  } = props
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(sidebarStorageKey) === 'collapsed')
  const behavior = useBehavior()
  const modePreferences = behavior.modes[behavior.workMode]
  const [monitorPreferences, setMonitorPreferences] = useState(() => readMonitorPreferences(window.localStorage.getItem(monitorPreferencesStorageKey)))
  const previousMonitorTask = useRef<string | undefined>(undefined)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(sidebarWidthStorageKey))
    const initial = Number.isFinite(saved) && saved >= sidebarMinWidth ? saved : Math.round(window.innerWidth * 0.15)
    return Math.round(Math.max(sidebarMinWidth, Math.min(initial, sidebarMaxWidth)))
  })
  const [sidebarAvailableWidth, setSidebarAvailableWidth] = useState(() => sidebarWidthLimit(window.innerWidth))
  const displayedSidebarWidth = Math.min(sidebarWidth, sidebarAvailableWidth)
  const [reviewSource, setReviewSource] = useState<'git' | 'task' | 'worktrees'>('git')
  const [gitOpen, setGitOpen] = useState(false)
  const [settingsGitWorkspace, setSettingsGitWorkspace] = useState<string>()
  const [workspaceGit, setWorkspaceGit] = useState<{ workspaceId: string; branch: string | null }>()
  const [monitorGit, setMonitorGit] = useState<{ id: string; request: GitRequest; lineChanges: LingGitSnapshot['lineChanges'] }>()
  const [servers, setServers] = useState<readonly LingServer[]>([])
  const [taskServerId, setTaskServerId] = useState<string>()
  const [taskRemoteCwd, setTaskRemoteCwd] = useState<string>()
  const [remoteGitBranch, setRemoteGitBranch] = useState<string | null>(null)
  const remoteGitRequest = useCallback<GitRequest>((taskId, request) => props.serverManager
    ? props.serverManager.gitRequest(taskId, request)
    : Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '远端 Git 服务不可用。', retryable: true }), [props.serverManager])
  const [taskOperationsBinding, setTaskOperationsBinding] = useState<{ taskId: string; serverId: string }>()
  const activeServerId = selectedTask ? taskServerId : props.newTaskServerId
  const activeOperationsServerId = activeServerId ? undefined : selectedTask
    ? taskOperationsBinding?.taskId === selectedTask.taskId ? taskOperationsBinding.serverId : undefined
    : props.newTaskOperationsServerId
  const issueServerId = selectedTask ? taskServerId ?? activeOperationsServerId : undefined
  const [serverIssue, setServerIssue] = useState<RemoteIssue>()
  const [serverIssuePending, setServerIssuePending] = useState(false)
  useEffect(() => {
    if (!props.serverManager) return
    let active = true
    void props.serverManager.list().then(result => { if (active && result.ok) setServers(result.value) })
    return () => { active = false }
  }, [props.serverManager, props.screen])
  useEffect(() => {
    setTaskServerId(undefined)
    setTaskRemoteCwd(undefined)
    setRemoteGitBranch(null)
    setServerIssue(undefined)
    if (!selectedTask || !props.serverManager) return
    let active = true
    void props.serverManager.taskBinding(selectedTask.taskId).then(result => {
      if (active && result.ok) { setTaskServerId(result.value?.serverId); setTaskRemoteCwd(result.value?.cwd) }
    })
    return () => { active = false }
  }, [selectedTask?.taskId, props.serverManager])
  useEffect(() => {
    if (!selectedTask || !props.serverManager || !taskServerId) return
    let active = true
    void props.serverManager.taskBinding(selectedTask.taskId).then(result => {
      if (active && result.ok) setTaskRemoteCwd(result.value?.cwd)
    })
    return () => { active = false }
  }, [selectedTask?.taskId, props.serverManager, taskServerId, timeline.length])
  useEffect(() => {
    setTaskOperationsBinding(undefined)
    if (!selectedTask || !props.serverManager) return
    let active = true
    void props.serverManager.operationsBinding(selectedTask.taskId).then(result => {
      if (active && result.ok && result.value) setTaskOperationsBinding({ taskId: selectedTask.taskId, serverId: result.value.serverId })
    })
    return () => { active = false }
  }, [selectedTask?.taskId, props.serverManager])
  useEffect(() => {
    if (!issueServerId || props.screen !== 'workspace') return
    let active = true
    const check = () => { void remoteIssue(issueServerId).then(issue => { if (active) setServerIssue(issue) }).catch(() => {
      if (active) setServerIssue({ title: '服务器连接已中断' })
    }) }
    check()
    window.addEventListener('focus', check)
    return () => { active = false; window.removeEventListener('focus', check) }
  }, [issueServerId, props.screen, timeline.length])
  const sidebarDragStart = useRef<{ pointerX: number; width: number } | null>(null)
  const [utilityPanel, setUtilityPanel] = useState<'knowledge' | 'automation' | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string>()
  const [taskViewState, setTaskViewState] = useState(() => readTaskViewState(window.localStorage.getItem(taskViewStorageKey)))
  const [workspaceAppearance, setWorkspaceAppearance] = useState<Record<string, Pick<WorkspaceDraft, 'color' | 'marker'>>>(() => {
    try { return JSON.parse(window.localStorage.getItem('ling.workspace-appearance.v1') ?? '{}') as Record<string, Pick<WorkspaceDraft, 'color' | 'marker'>> }
    catch { return {} }
  })
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [actionOutputOpen, setActionOutputOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = Number(window.localStorage.getItem(terminalHeightStorageKey))
    return Number.isFinite(saved) && saved >= terminalMinHeight
      ? Math.round(Math.min(saved, terminalMaxHeight))
      : clampTerminalHeight(window.innerHeight * 0.25, window.innerHeight)
  })
  const [workbenchMaximized, setWorkbenchMaximized] = useState(false)
  const [workbenchTabs, setWorkbenchTabs] = useState<readonly WorkbenchTab[]>([])
  useEffect(() => {
    if (!activeServerId) return
    setWorkbenchTabs(current => current.filter(tab => tab.kind === 'browser' || tab.kind === 'notes' || tab.kind === 'files' || tab.kind === 'terminal'))
  }, [activeServerId])
  const [activeWorkbenchTabId, setActiveWorkbenchTabId] = useState<string>()
  const sideTaskSequence = useRef(0)
  const [browserInitialized, setBrowserInitialized] = useState(false)
  const [browserNavigation, setBrowserNavigation] = useState<BrowserNavigationRequest>()
  const [browserAnnotations, setBrowserAnnotations] = useState<readonly BrowserAnnotation[]>([])
  const [browserAnnotationResetKey, setBrowserAnnotationResetKey] = useState(0)
  const [workbenchWidth, setWorkbenchWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem(workbenchWidthStorageKey))
    return Number.isFinite(saved) && saved >= 19 && saved <= 80 ? saved : 44
  })
  const [workspaceAvailableWidth, setWorkspaceAvailableWidth] = useState(() => Math.max(1, window.innerWidth - (sidebarCollapsed ? 0 : displayedSidebarWidth)))
  const [workspaceAvailableHeight, setWorkspaceAvailableHeight] = useState(() => window.innerHeight)
  const displayedWorkbenchWidth = clampWorkbenchWidth(workbenchWidth, workspaceAvailableWidth)
  const workbenchBounds = workbenchWidthBounds(workspaceAvailableWidth)
  const displayedTerminalHeight = clampTerminalHeight(terminalHeight, workspaceAvailableHeight)
  const workbenchOpen = screen === 'workspace' && (browserOpen || utilityPanel !== null)
  const monitorPresentation = effectiveMonitorPresentation(monitorPreferences.presentation, workbenchOpen)
  const monitorOpen = environmentOpen && screen === 'workspace'
  const monitorFloating = monitorOpen && monitorPresentation === 'floating'
  const monitorFixed = monitorOpen && !monitorFloating
  const terminalVisible = terminalOpen && screen === 'workspace'
  const isDarwin = document.documentElement.dataset.platform === 'darwin'
  const activeWorkbenchTab = workbenchTabs.find(tab => tab.id === activeWorkbenchTabId)

  useEffect(() => {
    window.localStorage.setItem(sidebarStorageKey, sidebarCollapsed ? 'collapsed' : 'expanded')
  }, [sidebarCollapsed])

  useEffect(() => { window.localStorage.setItem(monitorPreferencesStorageKey, JSON.stringify(monitorPreferences)) }, [monitorPreferences])

  useEffect(() => {
    const taskId = screen === 'workspace' ? selectedTask?.taskId : undefined
    if (taskId === previousMonitorTask.current) return
    previousMonitorTask.current = taskId
    if (taskId && monitorPreferences.presentation === 'fixed' && monitorPreferences.showByDefault && !environmentOpen && !browserOpen) props.onEnvironmentToggle()
  }, [browserOpen, environmentOpen, monitorPreferences.presentation, monitorPreferences.showByDefault, props.onEnvironmentToggle, screen, selectedTask?.taskId])

  useEffect(() => {
    const timeout = window.setTimeout(() => { window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth)) }, 150)
    return () => { window.clearTimeout(timeout) }
  }, [sidebarWidth])

  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>('main.workspace')
    if (!workspace || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect.width ?? workspace.getBoundingClientRect().width)
      const height = Math.round(entries[0]?.contentRect.height ?? workspace.getBoundingClientRect().height)
      setWorkspaceAvailableWidth(width)
      setWorkspaceAvailableHeight(height)
    })
    observer.observe(workspace)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { window.localStorage.setItem(workbenchWidthStorageKey, String(workbenchWidth)) }, 150)
    return () => { window.clearTimeout(timeout) }
  }, [workbenchWidth])

  useEffect(() => {
    const onResize = () => {
      const shell = document.querySelector<HTMLElement>('.desktop-shell')
      if (!shell) return
      setSidebarAvailableWidth(sidebarWidthLimit(shell.getBoundingClientRect().width))
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => { window.localStorage.setItem(taskViewStorageKey, JSON.stringify(taskViewState)) }, [taskViewState])
  useEffect(() => {
    const timeout = window.setTimeout(() => { window.localStorage.setItem(terminalHeightStorageKey, String(terminalHeight)) }, 150)
    return () => { window.clearTimeout(timeout) }
  }, [terminalHeight])
  useEffect(() => { window.localStorage.setItem('ling.workspace-appearance.v1', JSON.stringify(workspaceAppearance)) }, [workspaceAppearance])
  useEffect(() => {
    setTaskViewState(current => {
      const unseen = tasks.filter(task => !task.createdAt && !current.createdAtByTask[task.taskId])
      if (unseen.length === 0) return current
      return { ...current, createdAtByTask: { ...current.createdAtByTask, ...Object.fromEntries(unseen.map(task => [task.taskId, task.updatedAt])) } }
    })
  }, [tasks])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialog || event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setSidebarCollapsed(current => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [dialog])

  useEffect(() => {
    if (screen !== 'workspace' || (browserOpen && activeWorkbenchTab?.kind === 'browser')) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 't') return
      event.preventDefault()
      setBrowserInitialized(true)
      openWorkbenchTab('browser')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [activeWorkbenchTab?.kind, browserOpen, screen, workbenchTabs])

  const emptyConversation = timeline.length === 0 && !loadingOlder
  const activeWorkspaceId = activeServerId ? undefined : selectedTask ? selectedTask.workspaceId
    : props.newTaskWithoutWorkspace ? undefined : props.newTaskWorkspaceId ?? workspaces[0]?.workspaceId
  const gitSettingsWorkspaceId = workspaces.find(workspace => workspace.workspaceId === settingsGitWorkspace)?.workspaceId ?? activeWorkspaceId ?? workspaces[0]?.workspaceId
  const workspaceTools = useWorkspaceTools(activeWorkspaceId, props.workspaceTools)
  const workspaceBranch = workspaceGit?.workspaceId === activeWorkspaceId ? workspaceGit?.branch : null
  const activeGitId = activeServerId ? selectedTask?.taskId : activeWorkspaceId
  const activeGitRequest = activeServerId ? remoteGitRequest : props.workspaceGit
  const gitBranch = activeServerId ? remoteGitBranch : workspaceBranch
  const gitLineChanges = monitorGit?.id === activeGitId && monitorGit?.request === activeGitRequest ? monitorGit?.lineChanges : undefined
  useEffect(() => {
    if (!monitorOpen || !activeGitId || !activeGitRequest) return
    let active = true, pending = false
    const id = activeGitId, request = activeGitRequest
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const result = await request(id, { type: 'inspect', lineChanges: true })
        if (active) setMonitorGit({ id, request, lineChanges: result.ok ? result.value.snapshot.lineChanges : undefined })
      } catch { if (active) setMonitorGit({ id, request, lineChanges: undefined }) }
      finally { pending = false }
    }
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === id) void refresh() }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    window.addEventListener('focus', refresh)
    window.addEventListener('ling:git-changed', changed)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('ling:git-changed', changed); document.removeEventListener('visibilitychange', refresh) }
  }, [monitorOpen, activeGitId, activeGitRequest])
  const onGitChanged = (branch: string | null) => {
    if (activeServerId) {
      setRemoteGitBranch(branch)
      if (selectedTask && props.serverManager) void props.serverManager.taskBinding(selectedTask.taskId).then(result => {
        if (result.ok) setTaskRemoteCwd(result.value?.cwd)
      })
    } else if (activeWorkspaceId) setWorkspaceGit({ workspaceId: activeWorkspaceId, branch })
  }
  useEffect(() => {
    if (!activeServerId || !selectedTask || !props.serverManager) return
    let active = true
    void props.serverManager.gitRequest(selectedTask.taskId, { type: 'inspect' }).then(result => {
      if (active && result.ok) setRemoteGitBranch(result.value.snapshot.branch)
    })
    return () => { active = false }
  }, [activeServerId, selectedTask?.taskId, props.serverManager])
  useEffect(() => {
    if (!activeWorkspaceId || !props.loadWorkspaceBranch) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return
      pending = true
      try {
        const branch = await props.loadWorkspaceBranch!(activeWorkspaceId)
        if (active) setWorkspaceGit({ workspaceId: activeWorkspaceId, branch })
      } catch {
        if (active) setWorkspaceGit({ workspaceId: activeWorkspaceId, branch: null })
      } finally { pending = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [activeWorkspaceId, props.loadWorkspaceBranch])

  const workspaceLabel = activeServerId ? servers.find(server => server.id === activeServerId)?.name ?? '服务器'
    : (selectedTask && !selectedTask.workspaceId) || (!selectedTask && props.newTaskWithoutWorkspace)
    ? '不指定工作区'
    : workspaces.find(workspace => workspace.workspaceId === (selectedTask?.workspaceId ?? props.newTaskWorkspaceId))?.label
      ?? workspaces[0]?.label ?? '不指定工作区'
  const defaultLabel = defaultModelName(props.modelSettings)
  const modelLabel = (props.taskModelScoped
    ? (modelDisplayName(props.modelSettings, props.taskModel) || defaultLabel)
    : defaultLabel) || '选择模型'

  const clearBrowserAnnotations = () => {
    setBrowserAnnotations([])
    setBrowserAnnotationResetKey(current => current + 1)
  }

  const submitWithBrowserAnnotations = (annotations: readonly BrowserAnnotation[] = browserAnnotations) => {
    const annotationText = browserAnnotationText(annotations)
    const combined = [prompt.trim(), annotationText].filter(Boolean).join('\n\n')
    if (!combined) return
    onSubmit(combined, clearBrowserAnnotations)
  }

  const beginAddWorkspace = () => {
    setCreatingWorkspace(true)
  }

  const toggleUtilityPanel = (kind: 'knowledge' | 'automation') => {
    if (browserOpen) props.onBrowserToggle()
    setUtilityPanel(current => current === kind ? null : kind)
  }

  const openWorkbenchTab = (kind: WorkbenchTabKind, initialSideTask?: Pick<SideTaskState, 'attachments' | 'prompt'>) => {
    setUtilityPanel(null)
    if (!browserOpen) props.onBrowserToggle()
    const existing = kind === 'side-task' ? undefined : workbenchTabs.find(tab => tab.kind === kind)
    if (existing) {
      setActiveWorkbenchTabId(existing.id)
      return
    }
    const id = kind === 'side-task' ? `side-task-${String(++sideTaskSequence.current)}` : kind
    const label = kind === 'side-task' ? `新任务 ${String(sideTaskSequence.current)}` : kind === 'files' ? '工作区文件' : kind === 'browser' ? '内置浏览器' : kind === 'review' ? '审阅' : '终端'
    setWorkbenchTabs(current => [...current, { id, kind, label, ...(kind === 'side-task' ? { sideTask: { workspaceId: activeWorkspaceId, workspaceLabel, agentPreset: props.composerAgentPreset, permissionPreset: props.permission?.currentValue, prompt: '', attachments: [], ...initialSideTask } } : {}) }])
    setActiveWorkbenchTabId(id)
    if (kind === 'browser') setBrowserInitialized(true)
  }

  useEffect(() => {
    const service = props.serverManager
    if (screen !== 'workspace' || !selectedTask || !(activeOperationsServerId || taskServerId) || !service) return
    let active = true
    const taskId = selectedTask.taskId
    const check = () => { void service.takeTerminalUiRequest(taskId).then(result => {
      if (!active || !result.ok || !result.value.open) return
      setUtilityPanel(null)
      if (!browserOpen) props.onBrowserToggle()
      setWorkbenchTabs(current => current.some(tab => tab.id === 'terminal') ? current : [...current, { id: 'terminal', kind: 'terminal', label: '终端' }])
      setActiveWorkbenchTabId('terminal')
    }) }
    check()
    const timer = window.setInterval(check, 800)
    return () => { active = false; window.clearInterval(timer) }
  }, [screen, selectedTask?.taskId, activeOperationsServerId, taskServerId, props.serverManager, browserOpen, props.onBrowserToggle])

  useEffect(() => {
    const navigate = (event: Event) => {
      const request = (event as CustomEvent<BrowserNavigationRequest>).detail
      if (!request?.id || typeof request.url !== 'string') return
      openWorkbenchTab('browser'); setBrowserInitialized(true); setBrowserNavigation(request)
    }
    const notes = (event: Event) => {
      const taskId = (event as CustomEvent<{ taskId: string }>).detail?.taskId
      if (!taskId || !behavior.quickNotes) return
      const id = `notes-${taskId}`
      setWorkbenchTabs(current => current.some(tab => tab.id === id) ? current : [...current, { id, kind: 'notes', label: '速记', notesTaskId: taskId }])
      setActiveWorkbenchTabId(id); setUtilityPanel(null)
      if (!browserOpen) props.onBrowserToggle()
    }
    window.addEventListener(browserNavigationEvent, navigate)
    window.addEventListener(openTaskNotesEvent, notes)
    return () => { window.removeEventListener(browserNavigationEvent, navigate); window.removeEventListener(openTaskNotesEvent, notes) }
  }, [browserOpen, workbenchTabs, behavior.quickNotes])

  const closeWorkbenchTab = (id: string) => {
    const index = workbenchTabs.findIndex(tab => tab.id === id)
    if (index < 0) return
    workbenchTabs[index]?.sideTask?.attachments.forEach(releaseComposerAttachment)
    const remaining = workbenchTabs.filter(tab => tab.id !== id)
    setWorkbenchTabs(remaining)
    if (activeWorkbenchTabId === id) setActiveWorkbenchTabId(remaining[Math.min(index, remaining.length - 1)]?.id)
  }

  const toggleLocalStatus = () => {
    if (!environmentOpen && monitorPresentation === 'fixed') {
      setUtilityPanel(null)
      if (browserOpen) props.onBrowserToggle()
    }
    props.onEnvironmentToggle()
  }

  const toggleMonitorPin = () => {
    props.onEnvironmentPinToggle()
  }

  const closeWorkbench = () => {
    setWorkbenchMaximized(false)
    if (utilityPanel) setUtilityPanel(null)
    else if (browserOpen) props.onBrowserToggle()
  }

  const openExtensions = () => {
    setUtilityPanel(null)
    onSettingsOpen()
    props.onSettingsTabChange('extensions')
  }

  const createWorkspace = async (draft: WorkspaceDraft): Promise<LingCommandResult> => {
    const result = await props.onCreateWorkspace(draft.path, draft.name)
    if (result.accepted) setWorkspaceAppearance(current => ({ ...current, [draft.path]: { color: draft.color, marker: draft.marker } }))
    return result
  }

  const saveGroup = (group: TaskViewState['groups'][number]) => {
    setTaskViewState(current => ({ ...current, groups: current.groups.some(item => item.id === group.id)
      ? current.groups.map(item => item.id === group.id ? group : item)
      : [...current.groups, group] }))
  }

  const visibleSectionIds = taskViewState.view.groupBy === 'workspace'
    ? [...workspaces.filter(workspace => !taskViewState.archivedWorkspaceIds.includes(workspace.workspaceId)).map(workspace => workspace.workspaceId), 'unassigned']
    : taskViewState.view.groupBy === 'activity' ? ['today', 'week', 'month', 'older'] : [...taskViewState.groups.map(group => group.id), 'ungrouped']
  const allCollapsed = visibleSectionIds.every(id => taskViewState.collapsedIds.includes(id))
  const toggleAll = () => {
    setTaskViewState(current => ({ ...current, collapsedIds: allCollapsed
      ? current.collapsedIds.filter(id => !visibleSectionIds.includes(id))
      : [...new Set([...current.collapsedIds, ...visibleSectionIds])] }))
  }

  const confirmDialog = async (value: string): Promise<LingCommandResult> => {
    if (!dialog) return { accepted: false, requestId: '', reason: 'invalid-command', message: '无效操作。', retryable: false }
    switch (dialog.kind) {
      case 'rename-task': return await props.onRenameTask(dialog.id ?? '', value)
      case 'rename-workspace': return await props.onRenameWorkspace(dialog.id ?? '', value)
      case 'delete-workspace': return await props.onDeleteWorkspace(dialog.id ?? '')
      case 'add-workspace': return await props.onCreateWorkspace(value)
    }
  }

  const dialogCopy: Record<DialogState['kind'], { title: string; label: string; placeholder?: string; confirm?: string; danger?: boolean; description?: string }> = {
    'rename-task': { title: '重命名任务', label: '任务名称' },
    'rename-workspace': { title: '重命名工作区', label: '工作区名称' },
    'add-workspace': { title: '添加工作区', label: '目录路径', placeholder: '/absolute/path/to/project', confirm: '添加', description: '输入要纳入灵创管理的本地目录绝对路径。' },
    'delete-workspace': { title: '移除工作区', label: '工作区名称', confirm: '移除', danger: true, description: '仅从灵创移除该工作区，不会删除磁盘文件。' },
  }

  return (
    <div className={tw(
      "desktop-shell relative grid h-screen min-h-0 w-screen min-w-0 bg-[var(--sidebar-background)] [--workspace-inset:0.5rem]",
      sidebarCollapsed
        ? "grid-cols-[minmax(0,1fr)]"
        : "grid-cols-[var(--sidebar-width,17.5rem)_minmax(0,1fr)] max-[980px]:grid-cols-[var(--sidebar-width,15rem)_minmax(0,1fr)] max-[700px]:grid-cols-[3.6rem_minmax(0,1fr)]",
      screen === 'settings' && "desktop-shell--settings",
      sidebarCollapsed && "desktop-shell--sidebar-collapsed",
    )} style={{ '--sidebar-width': `${String(displayedSidebarWidth)}px` } as CSSProperties}>
      <div aria-hidden="true" className={tw("absolute inset-x-0 top-0 z-10 h-1 select-none [-webkit-app-region:drag]")} />
      <aside className={tw("sidebar min-h-0 min-w-0 flex-col bg-transparent dark:bg-transparent max-[700px]:h-full max-[700px]:w-14.5 max-[700px]:overflow-hidden", sidebarCollapsed ? "hidden" : "flex")}>
        <div className={tw(
          "sidebar__top select-none [-webkit-app-region:drag] flex h-13 flex-none items-center gap-1 px-2.5 pl-3 max-[700px]:justify-center max-[700px]:p-0",
          isDarwin && "min-[701px]:gap-0 min-[701px]:pl-22",
          screen === 'settings' && "max-[700px]:h-13 max-[700px]:pt-2",
        )}>
          <button aria-expanded={!sidebarCollapsed} aria-label="切换侧边栏" className={tw("icon-button [-webkit-app-region:no-drag] inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)]", isDarwin && "min-[701px]:size-7.5 min-[701px]:-translate-y-px")} onClick={() => { setSidebarCollapsed(current => !current) }} title="切换侧边栏（⌘ B）" type="button"><Icon active={!sidebarCollapsed} name="panelLeft" size={18} /></button>
          {!sidebarCollapsed ? (
            <>
              <button aria-label="后退" className={tw("icon-button [-webkit-app-region:no-drag] inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent max-[700px]:hidden", isDarwin && "min-[701px]:size-7.5 min-[701px]:-translate-y-px")} disabled={!props.canNavigateBack} onClick={onNavigateBack} title="后退" type="button"><Icon name="arrowLeft" size={16} /></button>
              <button aria-label="前进" className={tw("icon-button [-webkit-app-region:no-drag] inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent max-[700px]:hidden", isDarwin && "min-[701px]:size-7.5 min-[701px]:-translate-y-px")} disabled={!props.canNavigateForward} onClick={onNavigateForward} title="前进" type="button"><Icon name="arrowRight" size={16} /></button>
            </>
          ) : null}
        </div>

        {screen === 'settings' && !sidebarCollapsed ? (
          <SettingsSidebar
            onReturn={props.onWorkspaceOpen}
            onSelect={props.onSettingsTabChange}
            selected={props.settingsTab}
          />
        ) : sidebarCollapsed ? (
          <nav aria-label="导航" className={tw("sidebar-rail grid min-h-0 flex-1 content-start justify-items-center gap-1 px-0 pb-2 pt-0.5")}>
            {screen === 'settings' ? (
              <button aria-label="返回应用" className={tw("sidebar-rail__item grid [width:2.15rem] [height:2.15rem] place-items-center p-0 border-0 rounded-lg bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:inherit] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:1px]")} onClick={props.onWorkspaceOpen} title="返回应用" type="button"><Icon name="arrowLeft" size={18} /></button>
            ) : (
              <>
                <button aria-label="新任务" className={tw("sidebar-rail__item grid [width:2.15rem] [height:2.15rem] place-items-center p-0 border-0 rounded-lg bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:inherit] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:1px]")} onClick={onNewTask} title="新任务" type="button"><Icon name="compose" size={18} /></button>
                <button aria-label="搜索" className={tw("sidebar-rail__item grid [width:2.15rem] [height:2.15rem] place-items-center p-0 border-0 rounded-lg bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:inherit] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:1px]")} onClick={onSearchOpen} title="搜索任务" type="button"><Icon name="search" size={18} /></button>
                <span className={tw("sidebar-rail__separator [width:1.35rem] [height:1px] my-1 mx-0 [background:var(--separator)]")} />
                <SlotItems items={slots?.['sidebar.panellist']} prefix="sidebar-panel" />
                <span className={tw("sidebar-rail__separator [width:1.35rem] [height:1px] my-1 mx-0 [background:var(--separator)]")} />
                <button aria-label="打开设置" className={tw("sidebar-rail__item grid [width:2.15rem] [height:2.15rem] place-items-center p-0 border-0 rounded-lg bg-transparent [color:var(--text-secondary)] cursor-pointer hover:[background:var(--surface-hover)] hover:[color:inherit] focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:1px]")} onClick={onSettingsOpen} title="设置" type="button"><Icon name="settings" size={18} /></button>
              </>
            )}
          </nav>
        ) : (
          <>
            <div aria-label="工作模式" className={tw('mx-3 mb-2 flex w-fit gap-0.5 rounded-full border border-[var(--panel-border)] p-0.5 max-[700px]:mx-auto')}>
              {(['coding', 'general'] as const).map(mode => <button aria-label={mode === 'coding' ? '编程模式' : '通用模式'} aria-pressed={behavior.workMode === mode} className={tw("flex h-control-xs items-center gap-1.5 rounded-full border-0 px-2 text-xs", behavior.workMode === mode ? 'bg-[var(--surface-tertiary)] text-[var(--foreground)]' : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} key={mode} onClick={() => updateBehavior({ workMode: mode })} type="button"><Icon name={mode === 'coding' ? 'code' : 'sparkle'} size={14} />{behavior.workMode === mode ? <span className={tw('max-[700px]:hidden')}>{mode === 'coding' ? '编程' : '通用'}</span> : null}</button>)}
            </div>
            <nav aria-label="导航" className={tw("sidebar-nav grid gap-0.5 pt-1.5 px-2.5 pb-0 max-[700px]:py-1 max-[700px]:px-2")}>
              <button aria-label="新任务" className={tw("sidebar-nav__item group grid min-h-control grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 text-left text-sm hover:bg-[var(--surface-hover)] max-[700px]:size-11 max-[700px]:min-h-11 max-[700px]:place-items-center max-[700px]:p-0")} onClick={onNewTask} type="button">
                <Icon name="compose" size={16} />
                <span className={tw("max-[700px]:hidden")}>新任务</span>
                <kbd className={tw("pointer-events-none font-sans text-xs text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 border-[var(--panel-border)] bg-[var(--surface)] max-[700px]:hidden")}>⌘ N</kbd>
              </button>
              <button aria-label="搜索" className={tw("sidebar-nav__item group grid min-h-control grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 text-left text-sm hover:bg-[var(--surface-hover)] max-[700px]:size-11 max-[700px]:min-h-11 max-[700px]:place-items-center max-[700px]:p-0")} onClick={onSearchOpen} type="button">
                <Icon name="search" size={16} />
                <span className={tw("max-[700px]:hidden")}>搜索</span>
                <kbd className={tw("pointer-events-none font-sans text-xs text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 border-[var(--panel-border)] bg-[var(--surface)] max-[700px]:hidden")}>⌘ K</kbd>
              </button>
              <SlotItems items={slots?.['sidebar.panellist']} prefix="sidebar-panel" />
            </nav>

            <div className={tw("sidebar-projects flex min-h-0 flex-1 flex-col overflow-hidden pt-3 px-2 pb-4 max-[700px]:hidden")}>
              <div className={tw("sidebar-projects__toolbar group flex min-h-6 flex-none items-center gap-0.5 px-1 pb-px pl-2")}>
                <button aria-expanded={taskViewState.sectionVisible} className={tw("sidebar-projects__heading mr-auto inline-flex flex-none cursor-pointer items-center justify-start border-0 bg-transparent py-1 text-left text-xs font-semibold [color:var(--text-tertiary)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]")} onClick={() => { setTaskViewState(current => ({ ...current, sectionVisible: !current.sectionVisible })) }} type="button">
                  {taskViewState.view.groupBy === 'workspace' ? '工作区' : taskViewState.view.groupBy === 'activity' ? '最近对话' : '自定义分组'}
                </button>
                <span className={tw("sidebar-projects__info pointer-events-none inline-flex flex-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100")}>
                  <Tooltip delay={0} closeDelay={0} shouldSkipAnimation>
                    <Tooltip.Trigger aria-label="工作区说明" className={tw("sidebar-projects__tool inline-flex items-center justify-center border-0 bg-transparent [color:var(--text-secondary)] cursor-pointer [width:1.65rem] [height:1.65rem] flex-none rounded-md hover:[background:var(--surface-hover)] hover:[color:var(--foreground)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]")}><Icon name="info" size={14} /></Tooltip.Trigger>
                    <Tooltip.Content className={tw("workspace-info-tooltip [max-width:min(29rem,_calc(100vw_-_3rem))] py-2.5 px-3 rounded-xl [background:var(--strong-background)] [box-shadow:var(--overlay-shadow)] [color:var(--on-strong)] text-sm [line-height:1.45] [white-space:normal]")} offset={10} placement="right">
                      工作区就是 Agent 动手的地方：它会在这里看文件、改文件、跑命令，也会读取这里的 Git 状态。
                    </Tooltip.Content>
                  </Tooltip>
                </span>
                <TaskViewMenu className={tw("pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100")} view={taskViewState.view} workspaces={workspaces.filter(workspace => !taskViewState.archivedWorkspaceIds.includes(workspace.workspaceId))} onChange={view => { setTaskViewState(current => ({ ...current, view })) }} />
                <button aria-label={allCollapsed ? '展开全部工作区' : '折叠全部工作区'} className={tw("sidebar-projects__tool pointer-events-none inline-flex size-6.5 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent opacity-0 transition-opacity [color:var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100")} onClick={toggleAll} title={allCollapsed ? '展开全部' : '折叠全部'} type="button"><Icon name={allCollapsed ? 'expand' : 'collapse'} size={15} /></button>
                <button aria-label={taskViewState.view.groupBy === 'custom' ? '新建分组' : '新建工作区'} className={tw("sidebar-projects__tool pointer-events-none inline-flex size-6.5 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent opacity-0 transition-opacity [color:var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px] [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100")} onClick={taskViewState.view.groupBy === 'custom' ? () => { setCreatingGroup(true) } : beginAddWorkspace} type="button"><Icon name="plus" size={15} /></button>
              </div>
              {taskViewState.sectionVisible ? <WorkspaceSection
                newTaskWorkspaceId={props.newTaskWorkspaceId}
                onExportTask={props.onExportTask}
                onNewTask={onNewTask}
                onOpenDialog={setDialog}
                onSelectTask={onSelectTask}
                onToggleArchive={props.onToggleTaskArchive}
                selectedTask={selectedTask}
                tasks={tasks}
                workspaces={workspaces}
                viewState={taskViewState}
                onViewStateChange={setTaskViewState}
                onEditGroup={setEditingGroupId}
                onCreateGroup={() => { setCreatingGroup(true) }}
                onNewTaskInWorkspace={props.onNewTaskInWorkspace}
                workspaceAppearance={workspaceAppearance}
              /> : null}
            </div>

            <div className={tw("sidebar-bottom flex-none max-[700px]:mt-auto")}>
              <nav aria-label="本地工具" className={tw("sidebar-bottom__links grid gap-0.5 pt-2 px-0 pb-0 my-0 mx-3 max-[700px]:hidden")}>
                <button aria-expanded={utilityPanel === 'knowledge'} className={tw("sidebar-bottom__item flex min-h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-sm [color:var(--foreground)] hover:bg-[var(--surface-hover)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]", utilityPanel === 'knowledge' && "sidebar-bottom__item--active bg-[var(--surface-selected)] hover:bg-[var(--surface-selected)]")} onClick={() => { toggleUtilityPanel('knowledge') }} type="button">
                  <Icon className={tw("flex-none [color:var(--text-secondary)]")} name="book" size={17} /><span>知识中心</span>
                </button>
                <button aria-expanded={utilityPanel === 'automation'} className={tw("sidebar-bottom__item flex min-h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-sm [color:var(--foreground)] hover:bg-[var(--surface-hover)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]", utilityPanel === 'automation' && "sidebar-bottom__item--active bg-[var(--surface-selected)] hover:bg-[var(--surface-selected)]")} onClick={() => { toggleUtilityPanel('automation') }} type="button">
                  <Icon className={tw("flex-none [color:var(--text-secondary)]")} name="calendarClock" size={17} /><span>自动化</span>
                </button>
                <button className={tw("sidebar-bottom__item flex min-h-9.5 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-sm [color:var(--foreground)] hover:bg-[var(--surface-hover)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]")} onClick={openExtensions} type="button">
                  <Icon className={tw("flex-none [color:var(--text-secondary)]")} name="grid" size={17} /><span>扩展</span>
                </button>
              </nav>
              <div className={tw("sidebar-footer flex min-h-13.5 flex-none items-center justify-start gap-1 px-3.5 pb-2.5 pt-2 max-[700px]:flex-col max-[700px]:justify-center max-[700px]:gap-0.5 max-[700px]:px-0 max-[700px]:py-2")}>
                <Button aria-label="设置" className={tw("sidebar-footer__tool grid size-control min-w-0 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] max-[700px]:size-10")} isIconOnly size="sm" variant="ghost" onPress={onSettingsOpen} title="设置"><Icon name="settings" size={16} /></Button>
                <TokenUsagePopover tasks={tasks} selectedTask={selectedTask} />
                <SlotItems items={slots?.['sidebar.footer.action']} prefix="sidebar-footer" />
              </div>
            </div>
          </>
        )}
      </aside>

      {!sidebarCollapsed ? (
        <div
          aria-label="调整侧导航宽度"
          aria-orientation="vertical"
          aria-valuemax={sidebarAvailableWidth}
          aria-valuemin={0}
          aria-valuenow={displayedSidebarWidth}
          className={tw("sidebar-resizer absolute [z-index:12] [top:0.3rem] [bottom:0.3rem] left-[calc(var(--sidebar-width)_+_var(--workspace-inset)_-_4px)] [width:8px] cursor-col-resize [touch-action:none] select-none after:absolute after:[top:var(--resize-marker-y,_50%)] after:[left:3px] after:[width:2px] after:[height:min(18rem,_100%)] after:[clip-path:polygon(50%_0,_100%_50%,_50%_100%,_0_50%)] after:[background:linear-gradient(to_bottom,_transparent,_color-mix(in_srgb,var(--action)_18%,transparent)_18%,_color-mix(in_srgb,var(--action)_82%,transparent)_50%,_color-mix(in_srgb,var(--action)_18%,transparent)_82%,_transparent)] after:[content:''] after:opacity-0 after:pointer-events-none after:[transform:translateY(-50%)] hover:after:opacity-100 focus-visible:after:opacity-100 active:after:opacity-100 focus-visible:[outline:none] max-[700px]:hidden")}
          onPointerEnter={event => { positionResizeMarker(event, 'vertical') }}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            const shell = event.currentTarget.parentElement
            if (!shell) return
            event.preventDefault()
            const shellWidth = shell.getBoundingClientRect().width
            const next = event.key === 'End' ? sidebarWidthLimit(shellWidth)
              : displayedSidebarWidth + (event.key === 'ArrowRight' ? 1 : -1) * shellWidth * 0.05
            if (event.key === 'Home' || (event.key === 'ArrowLeft' && next <= sidebarMinWidth)) {
              setSidebarCollapsed(true)
              return
            }
            setSidebarWidth(clampSidebarWidth(next, shell))
          }}
          onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault()
            positionResizeMarker(event, 'vertical')
            sidebarDragStart.current = { pointerX: event.clientX, width: displayedSidebarWidth }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            positionResizeMarker(event, 'vertical')
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const shell = event.currentTarget.parentElement
            if (!shell) return
            const start = sidebarDragStart.current
            if (!start) return
            const next = start.width + event.clientX - start.pointerX
            if (next <= sidebarMinWidth) {
              setSidebarCollapsed(true)
              return
            }
            setSidebarWidth(clampSidebarWidth(next, shell))
          }}
          onPointerUp={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onLostPointerCapture={() => { sidebarDragStart.current = null }}
          role="separator"
          tabIndex={0}
        />
      ) : null}

      <main className={tw(
        "workspace relative min-h-0 min-w-0 overflow-hidden my-[0.3rem] mr-[0.3rem] ml-[var(--workspace-inset)] rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] shadow-[var(--overlay-shadow)]",
        workbenchOpen
          ? tw(
              "workspace--workbench-open grid grid-cols-[minmax(0,calc(100%_-_var(--workbench-width)))_minmax(0,var(--workbench-width))]",
              terminalVisible ? "grid-rows-[2.5rem_minmax(0,1fr)_var(--terminal-height)]" : "grid-rows-[2.5rem_minmax(0,1fr)]",
              "max-[700px]:grid-cols-[minmax(0,1fr)]",
              workbenchMaximized && "workspace--workbench-maximized grid-cols-[minmax(0,1fr)]",
            )
          : "flex flex-col",
        screen === 'settings' && "bg-[var(--surface)]",
        monitorOpen && "workspace--monitor-open [--monitor-width:clamp(19rem,18vw,22.5rem)] max-[700px]:[--monitor-width:min(22rem,90vw)]",
        monitorFloating && "workspace--monitor-floating",
        terminalVisible && "workspace--terminal-open",
        sidebarCollapsed ? "max-[700px]:col-start-1" : "max-[700px]:col-start-2",
      )} style={{ '--workbench-width': `${String(displayedWorkbenchWidth)}%`, '--terminal-height': `${String(displayedTerminalHeight)}px` } as CSSProperties}>
        {screen === 'settings' && sidebarCollapsed ? (
          <div className={tw("settings-collapsed-navigation [-webkit-app-region:no-drag] absolute z-2 top-2 left-3 flex items-center gap-1", isDarwin && "min-[701px]:top-1 min-[701px]:left-20 min-[701px]:gap-0")}>
            <button aria-expanded={false} aria-label="切换侧边栏" className={tw("icon-button inline-grid size-control-sm shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={() => { setSidebarCollapsed(false) }} title="展开侧边栏（⌘ B）" type="button"><Icon name="panelLeft" size={18} /></button>
            <button aria-label="后退" className={tw("icon-button inline-grid size-control place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35", isDarwin && "min-[701px]:size-7.5")} disabled={!props.canNavigateBack} onClick={onNavigateBack} title="后退" type="button"><Icon name="arrowLeft" size={16} /></button>
            <button aria-label="前进" className={tw("icon-button inline-grid size-control place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35", isDarwin && "min-[701px]:size-7.5")} disabled={!props.canNavigateForward} onClick={onNavigateForward} title="前进" type="button"><Icon name="arrowRight" size={16} /></button>
            <button className={tw("settings-collapsed-navigation__return py-1 px-2.5 border-0 rounded-md bg-transparent [color:var(--text-secondary)] text-compact cursor-pointer hover:[background:var(--surface-hover)]")} onClick={props.onWorkspaceOpen} type="button">返回应用</button>
          </div>
        ) : null}
        {screen === 'settings' ? <div aria-hidden="true" className={tw("h-10 shrink-0 select-none [-webkit-app-region:drag]")} /> : <header className={tw("workspace-header select-none [-webkit-app-region:drag] relative z-5 flex h-10 shrink-0 items-center justify-between bg-[var(--surface)] pr-2.5 pl-5", workbenchOpen && "col-start-1 row-start-1", workbenchMaximized && "hidden", workbenchOpen && "max-[700px]:hidden", sidebarCollapsed && isDarwin && "min-[701px]:pl-20")}>
          <div className={tw("workspace-header__leading flex items-center min-w-0 flex-1 gap-2")}>
            {sidebarCollapsed ? (
              <div className={tw("workspace-header__navigation [-webkit-app-region:no-drag] flex flex-none items-center gap-0.5", isDarwin && "min-[701px]:gap-0 min-[701px]:-translate-x-px min-[701px]:-translate-y-px")}>
                <button aria-expanded={false} aria-label="切换侧边栏" className={tw("icon-button inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)]", isDarwin && "min-[701px]:size-7.5")} onClick={() => { setSidebarCollapsed(false) }} title="展开侧边栏（⌘ B）" type="button"><Icon name="panelLeft" size={18} /></button>
                <button aria-label="后退" className={tw("icon-button inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent", isDarwin && "min-[701px]:size-7.5")} disabled={!props.canNavigateBack} onClick={onNavigateBack} title="后退" type="button"><Icon name="arrowLeft" size={16} /></button>
                <button aria-label="前进" className={tw("icon-button inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent", isDarwin && "min-[701px]:size-7.5")} disabled={!props.canNavigateForward} onClick={onNavigateForward} title="前进" type="button"><Icon name="arrowRight" size={16} /></button>
              </div>
            ) : null}
            <div className={tw("workspace-header__title flex min-w-0 items-center gap-1.5")}>
              <strong className={tw("min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold")} title={selectedTask?.title}>{selectedTask?.title ?? '新任务'}</strong>
              {selectedTask ? (
                <Menu
                  align="start"
                  triggerAriaLabel="任务操作"
                  triggerClassName="workspace-header__menu [-webkit-app-region:no-drag] size-control-sm rounded-md hover:bg-[var(--surface-hover)]"
                  triggerLabel={<Icon name="more" size={18} />}
                >
                  <MenuItem icon="edit" onPress={() => { setDialog({ kind: 'rename-task', id: selectedTask.taskId, initial: selectedTask.title }) }}>重命名</MenuItem>
                  <MenuItem icon="fork" onPress={() => { props.onFork(selectedTask.taskId) }}>分叉</MenuItem>
                  <MenuItem icon={selectedTask.archived ? 'refresh' : 'archive'} onPress={() => { props.onToggleTaskArchive(selectedTask.taskId, !selectedTask.archived) }}>
                    {selectedTask.archived ? '恢复任务' : '归档任务'}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon="settings" onPress={() => { onSettingsOpen(); props.onSettingsTabChange('models') }}>模型设置</MenuItem>
                </Menu>
              ) : null}
            </div>
          </div>
          <div className={tw("workspace-header__actions [-webkit-app-region:no-drag] flex shrink-0 items-center gap-1")}>
            {modePreferences.locationControls && activeWorkspaceId ? <WorkspaceToolsToolbar key={activeWorkspaceId} workspaceId={activeWorkspaceId} tools={workspaceTools} onRun={() => { setTerminalOpen(true); setActionOutputOpen(true) }} /> : null}
            <WorkbenchHeaderAction active={environmentOpen} controls="task-monitor" expanded={environmentOpen} icon="listCheck" label="任务监控" onClick={toggleLocalStatus} />
            {!browserOpen && !utilityPanel ? <>
              <WorkbenchHeaderAction active={terminalOpen} controls="workspace-terminal" expanded={terminalOpen} icon="terminalPanel" label="终端面板" onClick={() => { setTerminalOpen(current => !current) }} />
              <WorkbenchHeaderAction expanded={false} icon="panelRight" label="展开工作面" onClick={props.onBrowserToggle} />
            </> : null}
          </div>
        </header>}

        {screen === 'settings' ? (
          <div className={tw("settings-layout min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable]")}>
            <div className={tw("settings-body mx-auto min-h-full w-[min(100%,58rem)] min-w-0 px-20 pb-12 pt-2.5 max-[980px]:px-5 max-[980px]:pb-8 max-[700px]:px-3 max-[700px]:pb-8")}>
              {props.settingsTab === 'general' || props.settingsTab === 'modes' ? <BehaviorSettings section={props.settingsTab} supportsGoalLimit={props.supportsGoalLimit} /> : props.settingsTab === 'git' ? <GitSettings /> : props.settingsTab === 'worktrees' ? <section className={tw('flex min-h-[32rem] flex-col gap-5')}>
                <h1 className={tw('m-0 text-xl font-semibold')}>Worktrees</h1>
                <div className={tw('flex items-center gap-3 text-xs text-[var(--text-secondary)]')}>工作区<CompactSelect label="Worktrees 工作区" className={tw('w-full flex-1')} onChange={setSettingsGitWorkspace} value={gitSettingsWorkspaceId ?? ''} options={workspaces.map(workspace => ({ value: workspace.workspaceId, label: workspace.label }))} /></div>
                {gitSettingsWorkspaceId && props.workspaceGit ? <GitPanel onAddWorkspace={props.onCreateWorkspace} view="worktrees" key={gitSettingsWorkspaceId} request={props.workspaceGit} workspaceId={gitSettingsWorkspaceId} /> : <p className={tw('text-sm text-[var(--text-tertiary)]')}>先添加本地工作区</p>}
              </section> : props.settingsTab === 'usage' ? (
                <UsageSettings selectedTask={selectedTask} tasks={tasks} />
              ) : props.settingsTab === 'models' ? (
                <ModelSettings
                  loading={props.modelSettingsLoading}
                  message={props.modelSettingsMessage}
                  onCreateCustomProvider={props.onProviderCreate}
                  onDeleteProvider={props.onProviderDelete}
                  onAuthorizeProvider={props.onProviderAuthorize}
                  onRefresh={props.onModelSettingsRefresh}
                  onSaveApiKey={props.onProviderSaveApiKey}
                  onSelectDefault={props.onModelDefaultSelect}
                  onModelEnabledChange={props.onModelEnabledChange}
                  onSignOutProvider={props.onProviderSignOut}
                  onTestProvider={props.onProviderTest}
                  onUpdateCustomProvider={props.onProviderUpdate}
                  settings={props.modelSettings}
                />
              ) : props.settingsTab === 'monitor' ? (
                <MonitorSettings onChange={setMonitorPreferences} preferences={monitorPreferences} />
              ) : props.settingsTab === 'agent-presets' ? (
                <AgentPresetSettings service={props.extensions?.settings} onChanged={props.extensions?.onSettingsChanged ?? (async () => {})} onCreate={props.extensions?.onCreatePreset ?? (() => {})} />
              ) : props.settingsTab === 'builtin-plugins' ? (
                <BuiltinPluginSettings service={props.extensions?.settings} />
              ) : props.settingsTab === 'extensions' && props.extensions !== undefined ? (
                <ExtensionSettings
                  manager={props.extensions.manager}
                  readSkills={props.extensions.readSkills}
                  taskId={selectedTask?.taskId}
                />
              ) : props.settingsTab === 'appearance' || props.settingsTab === 'shortcuts' ? (
                <GeneralSettings
                  section={props.settingsTab}
                  localeLoading={props.localeLoading}
                  localeMessage={props.localeMessage}
                  localePreference={props.localePreference}
                  onLocaleChange={props.onLocaleChange}
                  onThemeChange={onThemeChange}
                  theme={theme}
                  version={props.version}
                />
              ) : props.settingsTab === 'archived' ? (
                <ArchivedSettings
                  archivedWorkspaceIds={taskViewState.archivedWorkspaceIds}
                  onOpenTask={taskId => { props.onWorkspaceOpen(); props.onSelectTask(taskId) }}
                  onRestoreTask={taskId => { props.onToggleTaskArchive(taskId, false) }}
                  onRestoreWorkspace={workspaceId => { setTaskViewState(current => ({ ...current, archivedWorkspaceIds: current.archivedWorkspaceIds.filter(id => id !== workspaceId) })) }}
                  onRemoveWorkspace={workspace => { setDialog({ kind: 'delete-workspace', id: workspace.workspaceId, initial: workspace.label }) }}
                  tasks={tasks.filter(task => task.archived)}
                  workspaces={workspaces}
                />
              ) : props.settingsTab === 'connections' ? (
                <ServerSettings service={props.serverManager} />
              ) : props.settingsTab === 'control' ? (
                <ComputerControlSettings service={props.extensions?.manager} />
              ) : (
                <CatalogSettings tab={props.settingsTab} modelSettings={props.modelSettings} onTestProvider={props.onProviderTest} />
              )}
            </div>
          </div>
        ) : (
          <>
            <div className={tw("workspace-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", workbenchOpen && "col-start-1 row-start-2", workbenchMaximized && "hidden", workbenchOpen && "max-[700px]:hidden", monitorFixed ? "w-[calc(100%_-_var(--monitor-width))] max-[980px]:w-full" : "w-full", selectedTask && "workspace-content--task", emptyConversation && "justify-center overflow-y-auto py-6")}>
            <section className={tw("conversation-canvas relative min-h-0 flex flex-1 overflow-hidden", emptyConversation && "flex-none overflow-visible")}>
              <Conversation
                connection={connection}
                demo={demo}
                hasOlder={hasOlder}
                items={timeline}
                latestChanges={modePreferences.fileChanges ? props.changes.at(-1) : undefined}
                onReviewChanges={selection => { setReviewSource('task'); openWorkbenchTab('review'); props.onChangeSelect(selection) }}
                loadAttachment={props.loadAttachment}
                loadingOlder={loadingOlder}
                onLoadOlder={onLoadOlder}
                onForkAt={selectedTask ? (seq: number) => props.onFork(selectedTask.taskId, seq) : undefined}
                onEditMessage={props.onEditMessage}
                onRetryMessage={props.onRetryMessage}
                onAddReply={(text, preview) => {
                  props.onAddQuote(text, preview)
                  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')?.focus()
                }}
                onAskInSideTask={(text, preview) => {
                  openWorkbenchTab('side-task', { attachments: [toComposerQuote(text, preview)], prompt: '' })
                  window.requestAnimationFrame(() => {
                    document.querySelector<HTMLTextAreaElement>('[aria-label="侧边任务"] textarea[aria-label="消息"]')?.focus()
                  })
                }}
                onReconnect={onReconnect}
                running={running}
                threadKey={selectedTask?.taskId ?? 'new'}
              />
            </section>

            <div className={tw("composer-wrap relative [z-index:4] flex flex-col [width:min(48rem,_calc(100%_-_2rem))] [flex:0_1_auto] min-h-0 mt-0 mx-auto mb-2 max-[1180px]:[width:min(48rem,_calc(100%_-_2rem))] max-[700px]:[width:calc(100%_-_2rem)]", emptyConversation && "shrink-0")}>
              {notice ? <ComposerNotice message={notice} onRetry={props.onNoticeRetry} /> : null}
              <InteractionPanel
                interactions={pendingInteractions}
                onAnswer={onAnswerQuestion}
                onApprove={onApprove}
                onCancel={onCancelInteraction}
              />
              {issueServerId && serverIssue ? <div className={tw('flex items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground)]')} role="status">
                <Icon name="globe" size={15} />
                <div className={tw('min-w-0 flex-1')}>
                  <div>{serverIssue.title}</div>
                  {serverIssue.previous ? <div className={tw("break-all font-mono text-caption text-[var(--text-tertiary)]")}>原 {serverIssue.previous.algorithm} · {serverIssue.previous.sha256}</div> : null}
                  {serverIssue.observed ? <div className={tw("break-all font-mono text-caption text-[var(--text-tertiary)]")}>现 {serverIssue.observed.algorithm} · {serverIssue.observed.sha256}</div> : null}
                </div>
                {nativeRemoteBroker() ? <button className={tw('shrink-0 rounded-md border border-[var(--panel-border)] bg-transparent px-2 py-1 text-xs hover:bg-[var(--surface-hover)] disabled:opacity-50')} disabled={serverIssuePending} onClick={() => {
                  const broker = nativeRemoteBroker()
                  if (!broker) return
                  setServerIssuePending(true)
                  void broker.credentials(issueServerId).then(() => remoteIssue(issueServerId)).then(issue => setServerIssue(issue)).catch(() => setServerIssue({ title: '服务器连接已中断' })).finally(() => setServerIssuePending(false))
                }} type="button">确认连接</button> : null}
              </div> : null}
              <Composer
                attachments={attachments}
                recordedAttachments={props.recordedAttachments}
                onRemoveRecordedAttachment={props.onRemoveRecordedAttachment}
                focusKey={props.composerFocusKey}
                browserAnnotationCount={browserAnnotations.length}
                disabled={connection.phase !== 'ready' || props.composerPresetPending === true || Boolean(taskServerId && serverIssue)}
                getTaskCommands={props.getTaskCommands}
                getTaskSkills={props.extensions?.readSkills}
                getWorkspaceSkills={props.extensions?.readWorkspaceSkills}
                workspaceId={activeWorkspaceId}
                agentPreset={props.composerAgentPreset}
                hasTask={!!selectedTask}
                modelLabel={modelLabel}
                modelSettings={props.modelSettings}
                mode={props.mode}
                onAddFiles={onAddFiles}
                onChange={onPromptChange}
                onGoalAction={props.onGoalAction}
                onPlanModeToggle={props.onPlanModeToggle}
                onRemoveAttachment={onRemoveAttachment}
                onRemoveBrowserAnnotations={clearBrowserAnnotations}
                onSelectModel={selection => { void props.onModelSelect(selection) }}
                onOpenModelSettings={() => { onSettingsOpen(); props.onSettingsTabChange('models') }}
                onSelectPermission={props.onSelectPermission}
                onSubmit={() => { submitWithBrowserAnnotations() }}
                onStop={onStop}
                permission={props.permission}
                running={running}
                taskModel={props.taskModel}
                taskScoped={props.taskModelScoped}
                taskId={selectedTask?.taskId}
                value={prompt}
              />
              <ComposerContext
                agentPresetControl={props.agentPresetControl}
                operationsControl={!activeServerId && props.serverManager ? activeOperationsServerId && selectedTask ? (
                  <span className={tw("inline-flex h-control-xs max-w-40 items-center gap-1 rounded-md px-1 text-[var(--text-secondary)]")} title={`运维服务器：${servers.find(server => server.id === activeOperationsServerId)?.name ?? '服务器'}`}><Icon name="globe" size={14} /><span className={tw('truncate')}>运维 · {servers.find(server => server.id === activeOperationsServerId)?.name ?? '服务器'}</span></span>
                ) : <Menu
                  align="start"
                  side="top"
                  triggerAriaLabel="选择运维服务器"
                  triggerClassName={tw("h-control-xs max-w-40 rounded-md px-1 text-xs hover:bg-[var(--surface-hover)]")}
                  triggerLabel={<><Icon name="globe" size={14} /><span className={tw('truncate')}>{activeOperationsServerId ? `运维 · ${servers.find(server => server.id === activeOperationsServerId)?.name ?? '服务器'}` : '运维服务器'}</span><Icon name="chevronDown" size={12} /></>}
                >
                  {servers.length ? servers.map(server => <MenuItem key={server.id} checked={activeOperationsServerId === server.id} icon="globe" onPress={() => {
                    const taskId = selectedTask?.taskId
                    void props.onSelectOperationsServer(server.id).then(accepted => {
                      if (accepted && taskId) setTaskOperationsBinding({ taskId, serverId: server.id })
                    })
                  }}>{server.name}</MenuItem>) : <MenuItem icon="plus" onPress={() => { onSettingsOpen(); props.onSettingsTabChange('connections') }}>添加服务器</MenuItem>}
                  {activeOperationsServerId && !selectedTask ? <MenuItem onPress={props.onClearOperationsServer}>不关联服务器</MenuItem> : null}
                </Menu> : undefined}
                locationControl={props.workspaceGit || props.serverManager ? <WorkspaceModeMenu
                  key={`location-${activeServerId ?? activeWorkspaceId ?? 'none'}`}
                  workspaceId={activeWorkspaceId ?? (activeServerId ? props.newTaskWorkspaceId ?? workspaces[0]?.workspaceId : undefined)}
                  request={props.workspaceGit}
                  interactive
                  taskSelected={Boolean(selectedTask)}
                  onSelectWorkspace={props.onSelectWorkspacePath}
                  serverId={activeServerId}
                  servers={props.serverManager ? servers : []}
                  onSelectServer={props.onNewTaskOnServer}
                  onSelectLocal={() => {
                    const workspaceId = props.newTaskWorkspaceId ?? workspaces[0]?.workspaceId
                    if (workspaceId) props.onNewTaskInWorkspace(workspaceId)
                    else props.onNewTaskWithoutWorkspace()
                  }}
                /> : undefined}
                showEnvironment
                interactive
                branchControl={activeGitId && activeGitRequest ? <GitBranchMenu key={`branch-${activeGitId}`} workspaceId={activeGitId} branch={gitBranch ?? null} request={activeGitRequest} onChanged={onGitChanged} onReview={() => { setReviewSource('git'); openWorkbenchTab('review') }} onCommit={() => setGitOpen(true)} onWorktrees={() => { if (activeServerId) { setReviewSource('worktrees'); openWorkbenchTab('review') } else if (activeWorkspaceId) { setSettingsGitWorkspace(activeWorkspaceId); onSettingsOpen(); props.onSettingsTabChange('worktrees') } }} /> : undefined}
                branch={workspaceBranch}
                onGitOpen={activeWorkspaceId && props.workspaceGit ? () => setGitOpen(true) : undefined}
                compactDisabled={connection.phase !== 'ready' || running}
                contextBreakdown={selectedTask?.contextBreakdown}
                contextPressure={selectedTask?.contextPressure}
                onCompactContext={props.onCompactContext}
                onCreateWorkspace={beginAddWorkspace}
                onSelectWorkspace={props.onNewTaskInWorkspace}
                onSelectWithoutWorkspace={props.onNewTaskWithoutWorkspace}
                workspaceLabel={workspaceLabel}
                serverLabel={activeServerId ? workspaceLabel : undefined}
                workspaces={workspaces}
              />
              <SlotItems items={slots?.['shell.overlay']} prefix="shell-overlay" />
            </div>
            </div>
            {monitorOpen ? (
              <aside aria-label="任务监控" className={tw(
                "workspace-monitor absolute min-w-0 overflow-y-auto bg-[var(--surface)] [overscroll-behavior:contain]",
                workbenchMaximized && "hidden",
                monitorFloating
                  ? tw(
                      "z-6 top-10 bottom-auto w-[min(17.5rem,calc(100%_-_1.1rem))] max-h-[calc(100%_-_3.25rem)] rounded-xl border border-[var(--panel-border)] px-4 pb-3 shadow-[var(--overlay-shadow)]",
                      workbenchOpen ? "right-[calc(var(--workbench-width)_+_0.55rem)]" : "right-2",
                      terminalVisible && "max-h-[calc(100%_-_var(--terminal-height)_-_4rem)]",
                    )
                  : tw(
                      "z-3 top-10 right-0 bottom-0 w-[var(--monitor-width)] px-3.5 pb-4 pl-8",
                      terminalVisible && "bottom-[var(--terminal-height)]",
                      "max-[980px]:z-6 max-[980px]:top-10 max-[980px]:right-2 max-[980px]:bottom-auto max-[980px]:w-[min(22.5rem,calc(100%_-_0.9rem))] max-[980px]:max-h-[calc(100%_-_3.25rem)] max-[980px]:rounded-xl max-[980px]:border max-[980px]:border-[var(--panel-border)] max-[980px]:px-4 max-[980px]:pb-3 max-[980px]:shadow-[var(--overlay-shadow)]",
                    ),
              )} id="task-monitor">
                {slots?.['rightbar.session'] ?? <EnvironmentPanel {...props} gitLineChanges={gitLineChanges} onGitReview={activeGitId && activeGitRequest ? () => { setReviewSource('git'); openWorkbenchTab('review') } : undefined} onGitOpen={activeGitId && activeGitRequest ? () => setGitOpen(true) : undefined} workspaceBranch={gitBranch} onEnvironmentPinToggle={toggleMonitorPin} onSelectSideChat={id => { setActiveWorkbenchTabId(id); if (!browserOpen) props.onBrowserToggle() }} preferences={monitorPreferences} presentation={monitorPresentation} sideChats={workbenchTabs.filter(tab => tab.kind === 'side-task')} />}
              </aside>
            ) : null}
          </>
        )}
        {(browserOpen || utilityPanel) && screen === 'workspace' ? (
        <aside aria-label={utilityPanel === 'knowledge' ? '知识中心' : utilityPanel === 'automation' ? '自动化' : '工作面'} className={tw("workspace-workbench row-[1/3] flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--panel-border)] bg-[var(--surface)]", workbenchMaximized ? "col-start-1" : "col-start-2", "max-[700px]:col-start-1")}>
          {utilityPanel ? (
            <div className={tw("inspector__bar select-none [-webkit-app-region:drag] mb-2.5 flex items-center justify-between gap-2 px-3.5 pt-3")}>
              <strong className={tw("text-sm")}>{utilityPanel === 'knowledge' ? '知识中心' : '自动化'}</strong>
              <WorkbenchHeaderAction active={terminalOpen} controls="workspace-terminal" expanded={terminalOpen} icon="terminalPanel" label="终端面板" onClick={() => { setTerminalOpen(current => !current) }} />
              <button
                aria-label={`关闭${utilityPanel === 'knowledge' ? '知识中心' : '自动化'}`}
                className={tw("icon-button [-webkit-app-region:no-drag] inline-grid size-control-sm shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")}
                onClick={closeWorkbench}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : null}
          {utilityPanel === 'knowledge' ? (
            <p className={tw("sidebar-utility-panel__empty my-1.5 mx-0 [color:var(--text-tertiary)] text-xs [line-height:1.5]")}>知识中心尚未接入本地版。</p>
          ) : utilityPanel === 'automation' ? (
            <section className={tw("sidebar-utility-panel grid min-w-0 gap-3")}>
              <div className={tw("sidebar-utility-panel__heading flex items-center justify-between [color:var(--foreground)] text-xs [font-weight:590]")}><span>当前任务的本地定时提醒</span>{props.supportsSchedules && selectedTask ? <button aria-label="刷新定时提醒" className={tw("icon-button inline-grid size-control-sm shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]")} onClick={props.onSchedulesRefresh} type="button"><Icon name="refresh" size={15} /></button> : null}</div>
              {props.supportsSchedules && selectedTask
                ? <ScheduleList loading={props.schedulesLoading} message={props.schedulesMessage} schedules={props.schedules ?? []} />
                : <p className={tw("sidebar-utility-panel__empty my-1.5 mx-0 [color:var(--text-tertiary)] text-xs [line-height:1.5]")}>{selectedTask ? '当前运行时尚不支持定时提醒。' : '打开一个任务后，可查看其本地定时提醒。'}</p>}
            </section>
          ) : browserOpen ? (
            <>
              <div className={tw("workbench-header select-none [-webkit-app-region:drag] flex h-10 flex-none items-center justify-between gap-2 px-2.5", workbenchTabs.length > 0 && "border-b border-solid border-[var(--panel-border)]")}>
                <WorkbenchTabs activeId={activeWorkbenchTabId} onClose={closeWorkbenchTab} onSelect={setActiveWorkbenchTabId} tabs={workbenchTabs} />
                <div className={tw("workbench-header__actions [-webkit-app-region:no-drag] ml-auto grid shrink-0 grid-flow-col auto-cols-7 items-center gap-1")}>
                  <Menu align="end" triggerAriaLabel="添加标签页" triggerClassName="size-control-sm shrink-0 rounded-md hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]" triggerLabel={<Icon name="plus" size={18} />}>
                    {!activeServerId ? <MenuItem icon="sideChat" onPress={() => { openWorkbenchTab('side-task') }}>打开侧边任务</MenuItem> : null}
                  <MenuItem icon="folderOpen" onPress={() => { openWorkbenchTab('files') }}>打开工作区文件</MenuItem>
                    <MenuItem icon="globe" onPress={() => { openWorkbenchTab('browser') }}>打开内置浏览器</MenuItem>
                    <MenuItem icon="review" onPress={() => { setReviewSource('git'); openWorkbenchTab('review') }}>打开审阅</MenuItem>
                  <MenuItem icon="terminalSquare" onPress={() => { openWorkbenchTab('terminal') }}>打开终端</MenuItem>
                  </Menu>
                  <WorkbenchHeaderAction icon={workbenchMaximized ? 'collapse' : 'expand'} label={workbenchMaximized ? '还原工作面' : '全屏显示工作面'} onClick={() => { setWorkbenchMaximized(current => !current) }} />
                  <WorkbenchHeaderAction active={terminalOpen} controls="workspace-terminal" expanded={terminalOpen} icon="terminalPanel" label="终端面板" onClick={() => { setTerminalOpen(current => !current) }} />
                  <WorkbenchHeaderAction active expanded icon="panelRight" label="收起工作面" onClick={closeWorkbench} />
                </div>
              </div>
              {activeWorkbenchTab?.kind === 'files' ? (
                activeServerId && selectedTask && props.serverManager ? <section className={tw('flex min-h-0 min-w-0 flex-1 flex-col')}><ServerFileBrowser key={`${selectedTask.taskId}:${taskRemoteCwd ?? ''}`} service={props.serverManager} taskId={selectedTask.taskId} workspaceLabel={taskRemoteCwd ? `${workspaceLabel} · ${taskRemoteCwd}` : workspaceLabel} /></section>
                  : props.supportsWorkspaceFiles && selectedTask ? <section className={tw("flex min-h-0 min-w-0 flex-1 flex-col")}><FileBrowser key={selectedTask.taskId} loadDirectory={props.loadWorkspaceDirectory} loadDocument={props.loadWorkspaceDocument} taskId={selectedTask.taskId} workspaceLabel={workspaceLabel} /></section>
                  : <div className={tw("grid min-h-0 flex-1 place-items-center p-6 text-sm [color:var(--text-tertiary)]")}>{selectedTask ? '当前运行时尚未提供本地文件浏览。' : '打开任务后查看工作区文件。'}</div>
              ) : null}
              {workbenchTabs.filter(tab => tab.sideTask).map(tab => <div key={tab.id} hidden={activeWorkbenchTabId !== tab.id} className={tw('flex min-h-0 min-w-0 flex-1 flex-col [&[hidden]]:hidden')}>
                {props.sideTaskRuntime && tab.sideTask ? <SideTaskPanel runtime={props.sideTaskRuntime} state={tab.sideTask} modelSettings={props.modelSettings} onUpdate={patch => setWorkbenchTabs(current => current.map(item => item.id === tab.id && item.sideTask ? { ...item, sideTask: { ...item.sideTask, ...patch } } : item))} onTitle={label => setWorkbenchTabs(current => current.map(item => item.id === tab.id && item.label !== label ? { ...item, label } : item))} onOpenModels={() => { onSettingsOpen(); props.onSettingsTabChange('models') }} /> : <p role="status" className={tw('p-4 text-xs text-[var(--text-tertiary)]')}>侧边任务服务不可用</p>}
              </div>)}
              {browserInitialized ? <div className={tw("workbench-browser flex min-h-0 min-w-0 flex-1 [&[hidden]]:hidden")} hidden={activeWorkbenchTab?.kind !== 'browser'}><BrowserPanel navigationRequest={browserNavigation} onNavigationHandled={id => setBrowserNavigation(current => current?.id === id ? undefined : current)} active={activeWorkbenchTab?.kind === 'browser'} annotationResetKey={browserAnnotationResetKey} applicationOrigin={window.location.origin} onAnnotationsChange={setBrowserAnnotations} onSendAnnotations={submitWithBrowserAnnotations} /></div> : null}
              {activeWorkbenchTab?.kind === 'review' ? <section aria-label="审阅" className={tw('workbench-review flex min-h-0 flex-1 flex-col overflow-hidden pt-1')}>
                {(reviewSource === 'git' || reviewSource === 'worktrees') && activeGitId && activeGitRequest ? <GitPanel key={`${activeGitId}:${reviewSource}`} workspaceId={activeGitId} request={activeGitRequest} view={reviewSource === 'worktrees' ? 'worktrees' : 'review'} onChanged={onGitChanged} onCommit={() => setGitOpen(true)} onTaskReview={() => setReviewSource('task')} /> : <>
                  <div className={tw("flex h-control-lg shrink-0 items-center px-3")}><Menu align="start" triggerAriaLabel="选择改动来源" triggerClassName="h-control-sm gap-1.5 rounded-md px-2 text-xs" triggerLabel={<>最近一轮<Icon name="chevronDown" size={12} /></>}><MenuItem onPress={() => setReviewSource('task')}>最近一轮</MenuItem><MenuItem disabled={!activeGitId || !activeGitRequest} onPress={() => setReviewSource('git')}>未提交</MenuItem></Menu></div>
                  <div className={tw('min-h-0 flex-1 overflow-auto px-4 pb-4')}><ChangeReview changes={props.changes} diff={props.changeDiff} diffLoading={props.changeDiffLoading} diffMessage={props.changeDiffMessage} loading={props.changesLoading} message={props.changesMessage} onCloseDiff={props.onChangeDiffClose} onSelect={props.onChangeSelect} selection={props.selectedChange} /></div>
                </>}
              </section> : null}
              {activeWorkbenchTab?.kind === 'notes' && activeWorkbenchTab.notesTaskId ? <TaskNotes key={activeWorkbenchTab.notesTaskId} taskId={activeWorkbenchTab.notesTaskId} onAttach={text => onPromptChange([prompt, text].filter(Boolean).join('\n\n'))} /> : null}
              {activeWorkbenchTab?.kind === 'terminal' ? (activeServerId || activeOperationsServerId) && props.serverManager
                ? <ServerTerminalPanel service={props.serverManager} taskId={selectedTask?.taskId} serverId={activeServerId ?? activeOperationsServerId} placement="side" />
                : <TerminalPanel service={props.terminalService} taskId={selectedTask?.taskId} workspaceId={activeWorkspaceId} placement="side" /> : null}
              {!activeWorkbenchTab ? <div className={tw("workbench-home flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-4")}>
                <WorkbenchHomeAction icon="folderOpen" onClick={() => { openWorkbenchTab('files') }} title="打开工作区文件" />
                {!activeServerId ? <WorkbenchHomeAction icon="sideChat" onClick={() => { openWorkbenchTab('side-task') }} title="打开侧边任务" /> : null}
                <WorkbenchHomeAction detail="⌘ T" icon="globe" onClick={() => { openWorkbenchTab('browser') }} title="打开内置浏览器" />
                <WorkbenchHomeAction icon="review" onClick={() => { setReviewSource('git'); openWorkbenchTab('review') }} title="打开审阅" />
                <WorkbenchHomeAction icon="terminalSquare" onClick={() => { openWorkbenchTab('terminal') }} title="打开终端" />
              </div> : null}
            </>
          ) : null}
        </aside>
        ) : null}
        {(browserOpen || utilityPanel) && !workbenchMaximized && screen === 'workspace' ? (
          <div
            aria-label="调整任务与工作区宽度"
            aria-orientation="vertical"
            aria-valuemax={Math.round((100 - workbenchBounds.minimum) * 10) / 10}
            aria-valuemin={Math.round((100 - workbenchBounds.maximum) * 10) / 10}
            aria-valuenow={Math.round((100 - displayedWorkbenchWidth) * 10) / 10}
            className={tw("workspace-workbench__resizer absolute z-8 top-0 bottom-0 left-[calc(100%_-_var(--workbench-width)_-_5px)] w-2.5 cursor-col-resize touch-none select-none after:absolute after:top-[var(--resize-marker-y,50%)] after:left-1 after:h-[min(18rem,100%)] after:w-0.5 after:-translate-y-1/2 after:bg-[linear-gradient(to_bottom,transparent,color-mix(in_srgb,var(--action)_18%,transparent)_18%,color-mix(in_srgb,var(--action)_82%,transparent)_50%,color-mix(in_srgb,var(--action)_18%,transparent)_82%,transparent)] after:opacity-0 after:[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)] after:[content:''] hover:after:opacity-100 focus-visible:outline-none focus-visible:after:opacity-100 active:after:opacity-100 max-[700px]:hidden", terminalVisible && "bottom-[var(--terminal-height)]")}
            onPointerEnter={event => { positionResizeMarker(event, 'vertical') }}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              if (event.key === 'End' || (event.key === 'ArrowRight' && displayedWorkbenchWidth <= workbenchBounds.minimum + 0.1)) {
                if (utilityPanel) setUtilityPanel(null)
                else closeWorkbench()
                return
              }
              const workspace = event.currentTarget.parentElement
              if (!workspace) return
              const width = workspace.getBoundingClientRect().width
              const { minimum, maximum } = workbenchWidthBounds(width)
              const next = event.key === 'Home' ? maximum
                : displayedWorkbenchWidth + (event.key === 'ArrowLeft' ? 5 : -5)
              setWorkbenchWidth(clampWorkbenchWidth(next, width))
            }}
            onPointerDown={event => {
              if (event.button !== 0) return
              event.preventDefault()
              positionResizeMarker(event, 'vertical')
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={event => {
              positionResizeMarker(event, 'vertical')
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
              if (!bounds) return
              const next = (1 - (event.clientX - bounds.left) / bounds.width) * 100
              setWorkbenchWidth(clampWorkbenchWidth(next, bounds.width))
            }}
            onPointerUp={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            role="separator"
            tabIndex={0}
          />
        ) : null}
        {terminalVisible ? (
          <section aria-label="终端面板" className={tw(
            "workspace-terminal relative flex min-h-0 flex-col border-t border-[var(--panel-border)] bg-[var(--surface)]",
            workbenchOpen ? "col-[1/-1] row-start-3" : "flex-[0_0_var(--terminal-height)]",
          )} id="workspace-terminal">
            <div
              aria-label="调整终端面板高度"
              aria-orientation="horizontal"
              aria-valuemax={terminalHeightLimit(workspaceAvailableHeight)}
              aria-valuemin={terminalMinHeight}
              aria-valuenow={displayedTerminalHeight}
              className={tw("workspace-terminal__resizer absolute [z-index:9] [top:-5px] [right:0] [left:0] [height:9px] cursor-row-resize [touch-action:none] select-none after:absolute after:[top:4px] after:[left:var(--resize-marker-x,_50%)] after:[width:min(18rem,_100%)] after:[height:2px] after:[clip-path:polygon(0_50%,_50%_0,_100%_50%,_50%_100%)] after:[background:linear-gradient(to_right,_transparent,_color-mix(in_srgb,var(--action)_18%,transparent)_18%,_color-mix(in_srgb,var(--action)_82%,transparent)_50%,_color-mix(in_srgb,var(--action)_18%,transparent)_82%,_transparent)] after:[content:''] after:opacity-0 after:pointer-events-none after:[transform:translateX(-50%)] hover:after:opacity-100 focus-visible:after:opacity-100 active:after:opacity-100 focus-visible:[outline:none]")}
              onPointerEnter={event => { positionResizeMarker(event, 'horizontal') }}
              onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                const workspace = event.currentTarget.parentElement?.parentElement
                if (!workspace) return
                event.preventDefault()
                const workspaceHeight = workspace.getBoundingClientRect().height
                const current = event.currentTarget.parentElement?.getBoundingClientRect().height ?? displayedTerminalHeight
                const maximum = terminalHeightLimit(workspaceHeight)
                const next = event.key === 'Home' ? terminalMinHeight
                  : event.key === 'End' ? maximum
                    : current + (event.key === 'ArrowUp' ? 24 : -24)
                setTerminalHeight(clampTerminalHeight(next, workspaceHeight))
              }}
              onPointerDown={event => {
                if (event.button !== 0) return
                event.preventDefault()
                positionResizeMarker(event, 'horizontal')
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={event => {
                positionResizeMarker(event, 'horizontal')
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                const workspace = event.currentTarget.parentElement?.parentElement
                if (!workspace) return
                const bounds = workspace.getBoundingClientRect()
                setTerminalHeight(clampTerminalHeight(bounds.bottom - event.clientY, bounds.height))
              }}
              onPointerUp={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              role="separator"
              tabIndex={0}
            />
            {(activeServerId || activeOperationsServerId) && props.serverManager ? <ServerTerminalPanel service={props.serverManager} taskId={selectedTask?.taskId} serverId={activeServerId ?? activeOperationsServerId} placement="bottom" onClose={() => setTerminalOpen(false)} />
              : actionOutputOpen && workspaceTools.snapshot?.runs.length ? <WorkspaceActionOutput tools={workspaceTools} onClose={() => { setTerminalOpen(false) }} onShowTerminals={() => { setActionOutputOpen(false) }} />
                : <TerminalPanel service={props.terminalService} taskId={selectedTask?.taskId} workspaceId={activeWorkspaceId} placement="bottom" onClose={() => setTerminalOpen(false)} />}
          </section>
        ) : null}
      </main>

      {gitOpen && activeGitId && activeGitRequest ? <GitDialog onReview={() => { setReviewSource('git'); openWorkbenchTab('review') }} onAddWorkspace={activeServerId ? undefined : props.onCreateWorkspace} key={activeGitId} onChanged={onGitChanged} onClose={() => setGitOpen(false)} request={activeGitRequest} workspaceId={activeGitId} /> : null}

      <TaskSearch
        hasMore={props.searchHasMore}
        isLoading={props.searchLoading}
        message={props.searchMessage}
        onClose={onSearchClose}
        onQueryChange={onSearchQueryChange}
        onSelect={onSearchSelect}
        open={props.searchOpen}
        query={props.searchQuery}
        results={props.searchResults}
        workspaces={workspaces}
      />

      {creatingWorkspace ? <WorkspaceCreateDialog onCancel={() => { setCreatingWorkspace(false) }} onChooseDirectory={props.onPickDirectory} onConfirm={createWorkspace} /> : null}
      {creatingGroup || editingGroupId ? <TaskGroupDialog initial={taskViewState.groups.find(group => group.id === editingGroupId)} onCancel={() => { setCreatingGroup(false); setEditingGroupId(undefined) }} onConfirm={saveGroup} /> : null}

      {dialog ? (
        <PromptDialog
          confirmLabel={dialogCopy[dialog.kind].confirm}
          description={dialogCopy[dialog.kind].description}
          initialValue={dialog.initial}
          isDanger={dialogCopy[dialog.kind].danger}
          label={dialogCopy[dialog.kind].label}
          onCancel={() => { setDialog(null) }}
          onConfirm={confirmDialog}
          open={dialog !== null}
          placeholder={dialogCopy[dialog.kind].placeholder}
          title={dialogCopy[dialog.kind].title}
        />
      ) : null}
    </div>
  )
}
